import type { API, DynamicPlatformPlugin, Logger as HomebridgeLogger, MatterAccessory, MatterAPI, PlatformAccessory, PlatformConfig } from 'homebridge';
import { DreamePlatformConfig, parsePlatformConfig } from './config.js';
import { Logger } from './util/logger.js';
import { DreameCloud } from './dreame/cloud.js';
import { applyMapOverrides, fetchDreameMapRooms } from './dreame/maps.js';
import { DreameMqttClient, MqttConnectionInfo } from './dreame/mqtt.js';
import { StateParser } from './dreame/parser.js';
import { DreameCleaningModeCodec } from './dreame/cleaning-mode.js';
import { MatterClusterMapper } from './matter/clusters.js';
import { MatterCommandHandlers } from './matter/handlers.js';
import { DreameVacuumAccessory } from './matter/accessory.js';
import { DeviceSession } from './device-session.js';
import { createInitialState, Identity, MIOT, NormalizedState, POLL_PROPERTIES } from './dreame/models.js';
import { getMatterApi, buildMatterAccessory, buildMatterClusters, reattachHandlers, registerNewMatterAccessory, updateCachedMatterAccessory, cleanupStaleAccessories } from './registration.js';
import {
  AUTOMATION_CONTACT_SENSORS_CONTEXT_KIND,
  AUTOMATION_SENSOR_DEFINITIONS,
  AutomationContactSensors,
  SensorKey,
} from './homekit/automation-sensors.js';

export class DreameVacuumMatterPlatform implements DynamicPlatformPlugin {
  private readonly config: DreamePlatformConfig;
  private readonly log: Logger;
  public readonly accessories: PlatformAccessory[] = [];
  private readonly matterAccessories = new Map<string, MatterAccessory>();
  private readonly activeAccessoryUuids: Set<string> = new Set();
  private readonly deviceSessions = new Map<string, DeviceSession>();
  private readonly accessoryHandlers = new Map<string, DreameVacuumAccessory>();
  private readonly commandHandlers = new Map<string, MatterCommandHandlers>();
  private readonly automationSensors = new Map<string, AutomationContactSensors>();
  private readonly activeHapAccessoryUuids: Set<string> = new Set();
  private isDiscovering = false;
  private readonly tokenRefreshUnsubs: Array<() => void> = [];

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
      this.discoverDevices().catch((err) => {
        this.log.error(`Device discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    this.api.on('shutdown', () => {
      this.log.info('Homebridge shutdown detected. Disconnecting all sessions.');
      this.disconnectAllSessions();
    });
  }

  /**
   * Required by DynamicPlatformPlugin interface (for HAP accessories).
   * Not used for Matter accessories.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Loading HAP accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Called by Homebridge for each cached Matter accessory on startup.
   * This is the Matter equivalent of configureAccessory().
   * Re-attach handlers in didFinishLaunching, not here — keep this callback fast.
   */
  configureMatterAccessory(accessory: MatterAccessory): void {
    this.log.info('Loading Matter accessory from cache:', accessory.displayName);
    this.log.debug(`  UUID=${accessory.UUID}, context=${JSON.stringify(accessory.context)}`);
    this.matterAccessories.set(accessory.UUID, accessory);
  }

  async discoverDevices(): Promise<void> {
    if (this.isDiscovering) {
      this.log.warn('Device discovery already in progress, skipping.');
      return;
    }
    this.isDiscovering = true;
    try {
      await this.discoverDevicesInternal();
    } finally {
      this.isDiscovering = false;
    }
  }

  private async discoverDevicesInternal(): Promise<void> {
    this.log.info('Discovering Dreame devices...');
    const matter = getMatterApi(this.api);

    if (!matter) {
      this.log.error('Matter API is unavailable. Requires Homebridge >= 2.0.0-beta.0 with Matter enabled.');
      return;
    }

    this.activeAccessoryUuids.clear();
    this.activeHapAccessoryUuids.clear();
    this.disconnectAllSessions();

    this.log.info(`${this.matterAccessories.size} cached Matter accessory(ies) found`);

    // Phase 1: Re-attach placeholder handlers to cached accessories immediately
    this.restoreCachedAccessories(matter);

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
      await cleanupStaleAccessories(matter, this.matterAccessories, this.activeAccessoryUuids, this.log);
      this.cleanupStaleHapAccessories();
      return;
    }

    this.log.info(`Found ${devices.length} Dreame device(s). Provisioning...`);
    for (const device of devices) {
      const deviceId = device.did;
      const deviceModel = device.model;
      const deviceName = device.name || deviceModel;
      const uuid = matter.uuid.generate(deviceId);
      this.activeAccessoryUuids.add(uuid);
      if (this.config.automationContactSensors) {
        for (const definition of AUTOMATION_SENSOR_DEFINITIONS) {
          this.activeHapAccessoryUuids.add(this.getAutomationSensorUuid(deviceId, definition.key));
        }
      }

      // Get device info (sets host for sendCommand routing)
      await cloud.getDeviceInfo(deviceId);
      const cleaningModeCodec = new DreameCleaningModeCodec();
      const parser = new StateParser(this.log, cleaningModeCodec);

      // Build command handlers — reuse Phase 1 handler if available, otherwise create new
      let handlers = this.commandHandlers.get(uuid);
      if (handlers) {
        handlers.setCloud(cloud);
        handlers.setCleaningModeCodec(cleaningModeCodec);
      } else {
        handlers = new MatterCommandHandlers(cloud, deviceId, this.log, 'SWEEP_AND_MOP', cleaningModeCodec);
      }
      let accessoryHandler: DreameVacuumAccessory | undefined = this.accessoryHandlers.get(uuid);
      handlers.setOnCleanModeSelected((mode) => {
        accessoryHandler?.applyUserCleanMode(mode);
      });
      handlers.setOnRoomSelectionChanged((roomIds) => {
        accessoryHandler?.applyUserRoomSelection(roomIds);
      });

      const firmware = cloud.getDeviceFirmware(deviceId) ?? '1.0';
      const identity: Identity = { deviceId, model: deviceModel, firmware };
      const initialState = createInitialState(identity);

      try {
        const discoveredMaps = await fetchDreameMapRooms(cloud, device, this.log);
        const knownMaps = applyMapOverrides(discoveredMaps, this.config.mapOverrides, deviceId);
        if (knownMaps.length > 0) {
          initialState.activity.knownMaps = knownMaps;
          initialState.activity.currentMapId = knownMaps[0]?.mapId;
          initialState.activity.availableRooms = knownMaps[0]?.rooms ?? [];
          const roomCount = knownMaps.reduce((total, map) => total + map.rooms.length, 0);
          this.log.info(`Loaded ${roomCount} room segment(s) from ${knownMaps.length} Dreame map(s) for ${deviceName}`);
          const suggestedRoomConfig = {
            mapOverrides: knownMaps.map((map) => ({
              deviceId,
              mapId: map.mapId,
              name: map.name || `Map ${map.mapId}`,
              rooms: map.rooms.map((room) => ({
                segmentId: room.id,
                name: room.name || `Room ${room.id}`,
              })),
            })),
          };
          this.log.info(
            `Suggested room naming config for ${deviceName} (copy and edit names if needed): `
            + JSON.stringify(suggestedRoomConfig),
          );
        } else {
          this.log.debug(`No room segments loaded from Dreame maps for ${deviceName}`);
        }
      } catch (err: unknown) {
        this.log.warn(`Failed to fetch Dreame map segments for ${deviceName}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Fetch initial properties from cloud
      try {
        const params = [
          ...POLL_PROPERTIES.map((p) => ({ did: deviceId, siid: p.siid, piid: p.piid })),
          { did: deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.SELF_WASH_BASE_STATUS },
          { did: deviceId, siid: MIOT.DOCK.siid, piid: MIOT.DOCK.DUST_COLLECTION },
        ];
        const props = await cloud.getProperties(deviceId, params);
        if (props && props.length > 0) {
          const hasSelfWashBase = props.some(
            (p) => p.siid === MIOT.VACUUM.siid
              && p.piid === MIOT.VACUUM.SELF_WASH_BASE_STATUS
              && (p.code === undefined || p.code === 0)
              && p.value !== undefined
              && p.value !== null,
          );
          const hasAutoEmptyBase = props.some(
            (p) => p.siid === MIOT.DOCK.siid
              && p.piid === MIOT.DOCK.DUST_COLLECTION
              && (p.code === undefined || p.code === 0)
              && p.value !== undefined
              && p.value !== null,
          );
          const liftingMopPads = hasSelfWashBase && hasAutoEmptyBase;
          cleaningModeCodec.configureLiftingMopPads(liftingMopPads);
          this.log.debug(
            `Dreame cleaning-mode encoding for ${deviceName}: `
            + `${liftingMopPads ? 'lifting-mop' : 'standard'} `
            + `(selfWashBase=${hasSelfWashBase}, autoEmptyBase=${hasAutoEmptyBase})`,
          );
          const propsWithValues = props
            .filter((p) => p.value !== undefined)
            .map((p) => ({ siid: p.siid, piid: p.piid, value: p.value }));
          const parsed = parser.processProperties(propsWithValues, initialState);
          Object.assign(initialState, parsed);
        }
      } catch (err: unknown) {
        this.log.warn(`Failed to fetch initial state for ${deviceName}, using defaults: ${err instanceof Error ? err.message : String(err)}`);
      }

      handlers.setAreaIdToRoomIdMap(MatterClusterMapper.buildAreaIdToRoomIdMap(initialState));

      // Check if this device was cached
      const cachedAccessory = this.matterAccessories.get(uuid);
      let setupResult;

      if (cachedAccessory) {
        cachedAccessory.clusters = buildMatterClusters(initialState);
        // Cached: re-attach handlers with real cloud connection and update metadata
        reattachHandlers(cachedAccessory, handlers, matter, this.log);
        setupResult = await updateCachedMatterAccessory(matter, cachedAccessory, this.log);
      } else {
        // New: build and register a fresh MatterAccessory
        const newAccessory = buildMatterAccessory(matter, handlers, identity, initialState, deviceName, this.log);
        if (!newAccessory) continue;
        setupResult = await registerNewMatterAccessory(matter, newAccessory, this.log);
        if (setupResult.configured) {
          this.matterAccessories.set(uuid, newAccessory);
        }
      }

      if (!setupResult.configured) continue;

      const automationSensors = this.config.automationContactSensors
        ? this.setupAutomationSensors(deviceName, deviceId, deviceModel, initialState)
        : undefined;

      // Create accessory handler for state push
      accessoryHandler = new DreameVacuumAccessory(this.log.getRaw(), uuid, initialState, this.api, {
        disableMatterStatePush: !setupResult.statePushSupported,
      });
      accessoryHandler.markRegistered();
      this.accessoryHandlers.set(uuid, accessoryHandler);
      this.commandHandlers.set(uuid, handlers);

      // Create device session with MQTT
      const session = new DeviceSession(
        deviceId,
        deviceName,
        handlers,
        accessoryHandler,
        parser,
        this.log,
        automationSensors,
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
        const unsub = cloud.onTokenRefresh((newToken) => {
          mqttClient.updateToken(newToken);
        });
        this.tokenRefreshUnsubs.push(unsub);

        session.connectMqtt(mqttClient);
        this.log.info(`MQTT provisioned for ${deviceName} via ${device.bindDomain}`);
      } else {
        this.log.warn(`No MQTT endpoint for ${deviceName} — state updates via polling only`);
      }

      // Enable HTTP polling backup
      session.setCloud(cloud);

      this.deviceSessions.set(uuid, session);
      this.log.info(`Device ${deviceName} (${deviceId}) ready — model: ${deviceModel}`);
    }

    await cleanupStaleAccessories(matter, this.matterAccessories, this.activeAccessoryUuids, this.log);
    this.cleanupStaleHapAccessories();
  }

  private setupAutomationSensors(
    deviceName: string,
    deviceId: string,
    model: string,
    initialState: NormalizedState,
  ): AutomationContactSensors {
    const sensorAccessories = new Map<SensorKey, PlatformAccessory>();

    for (const definition of AUTOMATION_SENSOR_DEFINITIONS) {
      const uuid = this.getAutomationSensorUuid(deviceId, definition.key);
      const name = `${deviceName} ${definition.displaySuffix}`;
      let accessory = this.accessories.find((cached) => cached.UUID === uuid);

      if (!accessory) {
        accessory = new this.api.platformAccessory(name, uuid);
        accessory.category = this.api.hap.Categories.SENSOR;
        this.api.registerPlatformAccessories(
          'homebridge-dreame-vacuum-matter',
          'DreameVacuumMatter',
          [accessory],
        );
        this.accessories.push(accessory);
        this.log.info(`Registered automation contact sensor: ${name}`);
      }

      sensorAccessories.set(definition.key, accessory);
    }

    const automationSensors = new AutomationContactSensors(this.api, sensorAccessories, this.log, deviceName, deviceId, model);
    automationSensors.updateState(initialState);
    this.automationSensors.set(deviceId, automationSensors);
    return automationSensors;
  }

  private getAutomationSensorUuid(deviceId: string, key: SensorKey): string {
    return this.api.hap.uuid.generate(`${deviceId}:automation-contact-sensor:${key}`);
  }

  private cleanupStaleHapAccessories(): void {
    const stale = this.accessories.filter((accessory) =>
      accessory.context.kind === AUTOMATION_CONTACT_SENSORS_CONTEXT_KIND
      && !this.activeHapAccessoryUuids.has(accessory.UUID),
    );

    if (stale.length === 0) return;

    this.log.info(`Removing ${stale.length} stale automation accessory(ies)...`);
    this.api.unregisterPlatformAccessories(
      'homebridge-dreame-vacuum-matter',
      'DreameVacuumMatter',
      stale,
    );
    for (const accessory of stale) {
      const index = this.accessories.indexOf(accessory);
      if (index >= 0) this.accessories.splice(index, 1);
    }
  }

  /**
   * Phase 1: Re-attach placeholder handlers to cached Matter accessories.
   * configureMatterAccessory() was already called by Homebridge for each cached
   * Matter accessory. Here we re-wire command handlers so the accessory responds
   * immediately (with placeholder handlers until cloud auth completes).
   */
  private restoreCachedAccessories(matter: MatterAPI): void {
    let restoredCount = 0;

    for (const [uuid, accessory] of this.matterAccessories) {
      const ctx = accessory.context as { deviceId?: string; model?: string; firmware?: string } | undefined;
      const name = accessory.displayName ?? uuid;
      if (!ctx?.deviceId || !ctx?.model) {
        this.log.debug(`Phase 1: skipping ${name} — missing deviceId or model in context`);
        continue;
      }

      // Create placeholder handlers (no cloud yet — commands will fail gracefully)
      const handlers = new MatterCommandHandlers(null, ctx.deviceId, this.log);
      reattachHandlers(accessory, handlers, matter, this.log);
      this.commandHandlers.set(uuid, handlers);
      restoredCount++;
    }

    if (restoredCount > 0) {
      this.log.info(`Phase 1: Restored ${restoredCount} cached Matter accessory(ies) with placeholder handlers`);
    }
  }

  private disconnectAllSessions(): void {
    for (const unsub of this.tokenRefreshUnsubs) {
      unsub();
    }
    this.tokenRefreshUnsubs.length = 0;
    for (const session of this.deviceSessions.values()) {
      session.dispose();
    }
    this.deviceSessions.clear();
    this.accessoryHandlers.clear();
    this.commandHandlers.clear();
    this.automationSensors.clear();
  }
}
