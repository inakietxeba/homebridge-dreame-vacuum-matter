import { API, DynamicPlatformPlugin, Logger as HomebridgeLogger, PlatformConfig, PlatformAccessory } from 'homebridge';
import { DreamePlatformConfig, parsePlatformConfig } from './config';
import { Logger } from './util/logger';
import { DreameCloud } from './dreame/cloud';
import { DreameMqttClient, MqttConnectionInfo } from './dreame/mqtt';
import { StateParser } from './dreame/parser';
import { MatterCommandHandlers } from './matter/handlers';
import { DreameVacuumAccessory } from './matter/accessory';
import { DeviceSession } from './device-session';
import { createInitialState, Identity, RoomInfo, MapRooms, POLL_PROPERTIES } from './dreame/models';
import { getMatterApi, registerOrUpdateMatterAccessory, cleanupStaleAccessories } from './registration';

const PLATFORM_NAME = 'DreameVacuumMatter';

export class DreameVacuumMatterPlatform implements DynamicPlatformPlugin {
  private readonly config: DreamePlatformConfig;
  private readonly log: Logger;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly activeAccessoryUuids: Set<string> = new Set();
  private readonly deviceSessions = new Map<string, DeviceSession>();
  private readonly accessoryHandlers = new Map<string, DreameVacuumAccessory>();

  constructor(
    log: HomebridgeLogger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log = new Logger(log, 'DreamePlatform');
    this.config = parsePlatformConfig(config);

    this.log.debug('Finished initializing platform:', this.config.name);

    if (!this.config.username || !this.config.password) {
      this.log.error('Missing username or password in config. Cannot start plugin.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      void this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      this.log.info('Homebridge shutdown detected. Disconnecting all sessions.');
      this.disconnectAllSessions();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices(): Promise<void> {
    this.log.info('Discovering Dreame devices...');
    const matterApi = getMatterApi(this.api as unknown as { matter?: ReturnType<typeof getMatterApi> });

    if (matterApi?.isMatterAvailable && !matterApi.isMatterAvailable()) {
      this.log.error('Matter API is unavailable. Requires Homebridge >= 2.0.0-beta.0.');
      return;
    }
    if (matterApi?.isMatterEnabled && !matterApi.isMatterEnabled()) {
      this.log.warn('Matter is disabled for this bridge.');
      return;
    }

    this.activeAccessoryUuids.clear();
    this.disconnectAllSessions();

    // Authenticate with Dreame Cloud
    const cloud = new DreameCloud(this.log);
    cloud.setCountry(this.config.country);

    try {
      await cloud.login(this.config.username!, this.config.password!);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`Dreame Cloud login failed: ${message}`);
      return;
    }

    const devices = await cloud.getDevices();
    if (!devices || devices.length === 0) {
      this.log.warn('No Dreame devices found under this account.');
      if (matterApi) await cleanupStaleAccessories(matterApi, this.accessories, this.activeAccessoryUuids, this.log);
      return;
    }

    this.log.info(`Found ${devices.length} Dreame device(s). Provisioning...`);
    const parser = new StateParser(this.log);

    for (const device of devices) {
      const deviceId = device.did;
      const deviceModel = device.model;
      const deviceName = device.name || deviceModel;
      const uuid = this.api.hap.uuid.generate(deviceId);
      this.activeAccessoryUuids.add(uuid);

      // Get device info (sets host for sendCommand routing)
      await cloud.getDeviceInfo(deviceId);

      // Build command handlers (direct cloud calls, no wrapper)
      const handlers = new MatterCommandHandlers(cloud, deviceId, this.log);
      let accessoryHandler: DreameVacuumAccessory | undefined;
      handlers.setOnCleanModeSelected((mode) => {
        accessoryHandler?.applyUserCleanMode(mode);
      });

      const firmware = cloud.lastDeviceFirmware ?? '1.0';
      const identity: Identity = { deviceId, model: deviceModel, firmware };
      const initialState = createInitialState(identity);

      // Fetch initial properties from cloud
      try {
        const params = POLL_PROPERTIES.map((p) => ({ did: deviceId, siid: p.siid, piid: p.piid }));
        const props = await cloud.getProperties(deviceId, params);
        if (props && props.length > 0) {
          const propsWithValues = props
            .filter((p) => p.value !== undefined)
            .map((p) => ({ siid: p.siid, piid: p.piid, value: p.value }));
          const parsed = parser.processProperties(propsWithValues, initialState);
          Object.assign(initialState, parsed);
        }
      } catch (err: unknown) {
        this.log.warn(`Failed to fetch initial state for ${deviceName}, using defaults. Device may not reflect actual state: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Find or create accessory
      let accessory = this.accessories.find((acc) => acc.UUID === uuid);
      const isNewAccessory = !accessory;

      if (isNewAccessory) {
        accessory = new this.api.platformAccessory(deviceName, uuid);
        accessory.category = this.api.hap.Categories.OTHER;
      }

      // Register Matter accessory
      if (!matterApi) continue;
      const setupResult = await registerOrUpdateMatterAccessory(
        matterApi,
        accessory!,
        isNewAccessory,
        handlers,
        identity,
        initialState,
        this.log,
        this.accessories,
        () => accessoryHandler?.getCurrentState() ?? initialState,
      );
      if (!setupResult.configured) continue;

      // Create accessory handler
      accessoryHandler = new DreameVacuumAccessory(this.log.getRaw(), accessory!, initialState, this.api, {
        disableMatterStatePush: !setupResult.statePushSupported,
        serviceAreaActive: setupResult.serviceAreaActive,
        onRoomsDiscovered: (rooms, knownMaps) => this.handleRoomsDiscovered(uuid, rooms, knownMaps),
      });
      accessoryHandler.markRegistered();
      this.accessoryHandlers.set(uuid, accessoryHandler);

      // Create device session with MQTT
      const session = new DeviceSession(
        deviceId,
        deviceName,
        handlers,
        accessoryHandler,
        parser,
        this.log,
      );

      // Connect MQTT if bindDomain is available
      if (device.bindDomain && cloud.uid && cloud.token) {
        const mqttInfo: MqttConnectionInfo = {
          host: device.bindDomain.includes(':') ? device.bindDomain : `${device.bindDomain}:19328`,
          did: deviceId,
          uid: cloud.uid,
          model: deviceModel,
          accessToken: cloud.token,
          country: this.config.country,
        };

        const mqttClient = new DreameMqttClient(this.log, mqttInfo);

        // Wire token refresh
        cloud.onTokenRefresh((newToken) => {
          mqttClient.updateToken(newToken);
        });

        session.connectMqtt(mqttClient);
        this.log.info(`MQTT provisioned for ${deviceName} via ${device.bindDomain}`);
      } else {
        this.log.warn(`No MQTT endpoint for ${deviceName} — state updates via polling only`);
      }

      // Enable HTTP polling backup (adaptive: 15s/60s/180s like original HomeKit plugin)
      session.setCloud(cloud);

      this.deviceSessions.set(uuid, session);
      this.log.info(`Device ${deviceName} (${deviceId}) ready — model: ${deviceModel}`);
    }

    if (matterApi) await cleanupStaleAccessories(matterApi, this.accessories, this.activeAccessoryUuids, this.log);
  }

  private handleRoomsDiscovered(uuid: string, rooms: RoomInfo[], knownMaps: MapRooms[]): void {
    this.log.info(`Rooms discovered for ${uuid}: ${rooms.map((r) => r.name).join(', ')}`);
  }

  private disconnectAllSessions(): void {
    for (const session of this.deviceSessions.values()) {
      session.dispose();
    }
    this.deviceSessions.clear();
    this.accessoryHandlers.clear();
  }
}
