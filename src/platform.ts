import { API, DynamicPlatformPlugin, Logger as HomebridgeLogger, PlatformConfig, PlatformAccessory } from 'homebridge';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DreamePlatformConfig, parsePlatformConfig, CleaningMode } from './config';
import { Logger } from './util/logger';
import { DreameCloud } from './dreame/cloud';
import { DreameMqttClient, MqttConnectionInfo } from './dreame/mqtt';
import { StateParser } from './dreame/parser';
import { CommandBuilder } from './dreame/commands';
import { MatterCommandHandlers } from './matter/handlers';
import { DreameVacuumAccessory, DreameVacuumAccessoryOptions } from './matter/accessory';
import { MatterMappers } from './matter/mappers';
import { MatterClusterMapper } from './matter/clusters';
import { DeviceSession } from './device-session';
import { createInitialState, Identity, RoomInfo, MapRooms, NormalizedState } from './dreame/models';

const PLUGIN_NAME = 'homebridge-dreame-vacuum-matter';
const PLATFORM_NAME = 'DreameVacuumMatter';

type MatterPlatformApi = {
  isMatterAvailable?: () => boolean;
  isMatterEnabled?: () => boolean;
  configureMatterAccessory?: (accessory: PlatformAccessory) => void;
  registerPlatformAccessories?: (
    pluginName: string,
    platformName: string,
    accessories: PlatformAccessory[]
  ) => Promise<void>;
  updatePlatformAccessories?: (accessories: PlatformAccessory[]) => Promise<void>;
  unregisterPlatformAccessories?: (
    pluginName: string,
    platformName: string,
    accessories: PlatformAccessory[]
  ) => Promise<void>;
  deviceTypes?: { RoboticVacuumCleaner?: unknown };
};

type MatterAccessoryMetadata = {
  deviceType?: unknown;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  firmwareRevision?: string;
  handlers?: Record<string, Record<string, unknown>>;
  clusters?: Record<string, Record<string, unknown>>;
};

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

  private getMatterApi(): MatterPlatformApi | undefined {
    return (this.api as unknown as { matter?: MatterPlatformApi }).matter;
  }

  async discoverDevices(): Promise<void> {
    this.log.info('Discovering Dreame devices...');
    const matterApi = this.getMatterApi();

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

    // ── Phase 1: restore cached accessories ────────────────────────────────
    const restoredHandlers = new Map<string, MatterCommandHandlers>();

    // Phase 1 runs without cloud — handlers will get a CommandBuilder in Phase 2
    for (const accessory of this.accessories) {
      const meta = accessory as PlatformAccessory & MatterAccessoryMetadata;
      if (!meta.deviceType || !meta.serialNumber || !meta.model) continue;

      const deviceId = meta.serialNumber;
      const uuid = this.api.hap.uuid.generate(deviceId);

      // We can't build a CommandBuilder yet (no cloud), so skip handler setup
      // until Phase 2. Just mark the accessory as known.
      this.log.info(`Phase 1: found cached accessory ${accessory.displayName} (${deviceId})`);
    }

    // ── Phase 2: cloud auth + device provisioning ─────────────────────────
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
      await this.cleanupStaleAccessories();
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

      // Build command infrastructure
      const commandBuilder = new CommandBuilder(cloud, deviceId);
      const handlers = new MatterCommandHandlers(commandBuilder, this.log);
      let accessoryHandler: DreameVacuumAccessory | undefined;
      handlers.setOnCleanModeSelected((mode) => {
        accessoryHandler?.applyUserCleanMode(mode);
      });

      const identity: Identity = { deviceId, model: deviceModel, firmware: '1.0' };
      const initialState = createInitialState(identity);

      // Fetch initial properties from cloud
      try {
        const props = await cloud.getProperties(deviceId, [
          { did: deviceId, siid: 2, piid: 1 },
          { did: deviceId, siid: 2, piid: 2 },
          { did: deviceId, siid: 3, piid: 1 },
          { did: deviceId, siid: 3, piid: 2 },
          { did: deviceId, siid: 4, piid: 4 },
          { did: deviceId, siid: 4, piid: 5 },
          { did: deviceId, siid: 4, piid: 23 },
        ]);
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

      // Rooms are discovered automatically via MQTT/polling

      // Find or create accessory
      let accessory = this.accessories.find((acc) => acc.UUID === uuid);
      const isNewAccessory = !accessory;

      if (isNewAccessory) {
        accessory = new this.api.platformAccessory(deviceName, uuid);
        accessory.category = this.api.hap.Categories.OTHER;
      }

      // Register Matter accessory
      const setupResult = await this.registerOrUpdateMatterAccessory(
        accessory!,
        isNewAccessory,
        handlers,
        identity,
        initialState,
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

    await this.cleanupStaleAccessories();
  }

  private async registerOrUpdateMatterAccessory(
    accessory: PlatformAccessory,
    isNew: boolean,
    handlers: MatterCommandHandlers,
    identity: Identity,
    initialState: NormalizedState,
  ): Promise<{ configured: boolean; statePushSupported: boolean; serviceAreaActive: boolean }> {
    const matterApi = this.getMatterApi();
    if (!matterApi) {
      return { configured: false, statePushSupported: false, serviceAreaActive: false };
    }

    const meta = accessory as PlatformAccessory & MatterAccessoryMetadata;
    meta.deviceType = matterApi.deviceTypes?.RoboticVacuumCleaner;
    meta.serialNumber = identity.deviceId;
    meta.manufacturer = 'Dreame';
    meta.model = identity.model;
    meta.firmwareRevision = identity.firmware;

    if (!meta.deviceType) {
      this.log.warn('RoboticVacuumCleaner device type not available in Matter API');
      return { configured: false, statePushSupported: false, serviceAreaActive: false };
    }

    // Set up Matter clusters (lowercase keys for Homebridge v2 Matter API)
    const matterState = MatterClusterMapper.toMatterState(initialState);
    const clusters: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(matterState)) {
      const lowerKey = key.charAt(0).toLowerCase() + key.slice(1);
      clusters[lowerKey] = value as Record<string, unknown>;
    }
    meta.clusters = clusters;

    // Handler error wrapper — logs errors and re-throws
    const wrapHandler = <T extends unknown[]>(
      name: string,
      fn: (...args: T) => Promise<void>,
    ): ((...args: T) => Promise<void>) => {
      return async (...args: T) => {
        this.log.debug(`Matter command received: ${name}`);
        try {
          await fn(...args);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.log.error(`Matter command ${name} failed: ${message}`);
          throw error;
        }
      };
    };

    // Set up Matter handlers (lowercase cluster names)
    meta.handlers = {
      rvcRunMode: {
        changeToMode: wrapHandler('rvcRunMode.changeToMode', async (request?: { newMode?: number }) => {
          switch (request?.newMode) {
            case 0x00: await handlers.handleStopCommand(); return;
            case 0x01: await handlers.handleStartCommand(false); return;
            case 0x02: await handlers.handleGoHomeCommand(); return;
            default: this.log.warn(`Unknown rvcRunMode: ${request?.newMode}`);
          }
        }),
      },
      rvcOperationalState: {
        start: wrapHandler('rvcOperationalState.start', () => handlers.handleStartCommand(false)),
        stop: wrapHandler('rvcOperationalState.stop', () => handlers.handleStopCommand()),
        pause: wrapHandler('rvcOperationalState.pause', () => handlers.handlePauseCommand()),
        resume: wrapHandler('rvcOperationalState.resume', () => handlers.handleResumeCommand()),
        goHome: wrapHandler('rvcOperationalState.goHome', () => handlers.handleGoHomeCommand()),
      },
      rvcCleanMode: {
        changeToMode: wrapHandler('rvcCleanMode.changeToMode', async (request?: { newMode?: number }) => {
          const modeMap: Record<number, CleaningMode> = { 0: 'SWEEP', 1: 'MOP', 2: 'SWEEP_AND_MOP' };
          const mode = request?.newMode !== undefined ? modeMap[request.newMode] : undefined;
          if (mode) await handlers.handleCleaningMode(mode);
        }),
      },
    };

    // ServiceArea handler
    const serviceAreaPayload = MatterClusterMapper.buildServiceArea(initialState);
    const serviceAreaActive = !!serviceAreaPayload;

    try {
      if (isNew) {
        matterApi.configureMatterAccessory?.(accessory);
        await matterApi.registerPlatformAccessories?.(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
        this.log.info(`Registered new Matter accessory: ${accessory.displayName}`);
      } else {
        matterApi.configureMatterAccessory?.(accessory);
        await matterApi.updatePlatformAccessories?.([accessory]);
        this.log.info(`Updated existing Matter accessory: ${accessory.displayName}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      // If ServiceArea was active, retry without it (common on first boot)
      if (serviceAreaActive) {
        this.log.warn(`Registration failed with ServiceArea (${message}); retrying without...`);
        delete clusters['serviceArea'];
        try {
          if (isNew) {
            matterApi.configureMatterAccessory?.(accessory);
            await matterApi.registerPlatformAccessories?.(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
          } else {
            matterApi.configureMatterAccessory?.(accessory);
            await matterApi.updatePlatformAccessories?.([accessory]);
          }
          this.log.info(`Registered ${accessory.displayName} without ServiceArea`);
          const statePushSupported = !!(matterApi as Record<string, unknown>)['updateAccessoryState'];
          return { configured: true, statePushSupported, serviceAreaActive: false };
        } catch (retryErr: unknown) {
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          this.log.error(`Registration retry also failed: ${retryMessage}`);
          return { configured: false, statePushSupported: false, serviceAreaActive: false };
        }
      }

      this.log.error(`Failed to register/update Matter accessory: ${message}`);
      return { configured: false, statePushSupported: false, serviceAreaActive: false };
    }

    const statePushSupported = !!(matterApi as Record<string, unknown>)['updateAccessoryState'];
    return { configured: true, statePushSupported, serviceAreaActive };
  }

  private handleRoomsDiscovered(uuid: string, rooms: RoomInfo[], knownMaps: MapRooms[]): void {
    this.log.info(`Rooms discovered for ${uuid}: ${rooms.map((r) => r.name).join(', ')}`);
    this.writeRoomsSidecar(uuid, rooms, knownMaps);
  }

  private roomsSidecarPath(uuid: string): string {
    const storagePath = this.api.user.storagePath();
    return path.join(storagePath, `dreame-vacuum-matter-rooms-${uuid}.json`);
  }

  private writeRoomsSidecar(uuid: string, rooms: RoomInfo[], knownMaps: MapRooms[]): void {
    try {
      const filePath = this.roomsSidecarPath(uuid);
      fs.writeFileSync(filePath, JSON.stringify({ rooms, knownMaps }, null, 2), 'utf-8');
    } catch (err: unknown) {
      this.log.warn(`Failed to write rooms sidecar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private readRoomsSidecar(uuid: string): { rooms: RoomInfo[]; knownMaps: MapRooms[] } | null {
    try {
      const filePath = this.roomsSidecarPath(uuid);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as { rooms: RoomInfo[]; knownMaps: MapRooms[] };
    } catch {
      return null;
    }
  }

  private async cleanupStaleAccessories(): Promise<void> {
    const matterApi = this.getMatterApi();
    const stale = this.accessories.filter((acc) => !this.activeAccessoryUuids.has(acc.UUID));
    if (stale.length > 0 && matterApi?.unregisterPlatformAccessories) {
      this.log.info(`Removing ${stale.length} stale accessory(ies)...`);
      await matterApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const acc of stale) {
        const idx = this.accessories.indexOf(acc);
        if (idx >= 0) this.accessories.splice(idx, 1);
      }
    }
  }

  private disconnectAllSessions(): void {
    for (const session of this.deviceSessions.values()) {
      session.dispose();
    }
    this.deviceSessions.clear();
    this.accessoryHandlers.clear();
  }
}
