import { PlatformAccessory } from 'homebridge';
import { CleaningMode } from './config';
import { Logger } from './util/logger';
import { MatterCommandHandlers } from './matter/handlers';
import { MatterClusterMapper } from './matter/clusters';
import { NormalizedState, Identity } from './dreame/models';

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

export type RegistrationResult = {
  configured: boolean;
  statePushSupported: boolean;
  serviceAreaActive: boolean;
};

export function getMatterApi(api: { matter?: MatterPlatformApi }): MatterPlatformApi | undefined {
  return api.matter;
}

export async function registerOrUpdateMatterAccessory(
  matterApi: MatterPlatformApi,
  accessory: PlatformAccessory,
  isNew: boolean,
  handlers: MatterCommandHandlers,
  identity: Identity,
  initialState: NormalizedState,
  log: Logger,
  accessories: PlatformAccessory[],
  getState?: () => NormalizedState,
): Promise<RegistrationResult> {
  const meta = accessory as PlatformAccessory & MatterAccessoryMetadata;
  meta.deviceType = matterApi.deviceTypes?.RoboticVacuumCleaner;
  meta.serialNumber = identity.deviceId;
  meta.manufacturer = 'Dreame';
  meta.model = identity.model;
  meta.firmwareRevision = identity.firmware;

  if (!meta.deviceType) {
    log.warn('RoboticVacuumCleaner device type not available in Matter API');
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
      log.debug(`Matter command received: ${name}`);
      try {
        await fn(...args);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Matter command ${name} failed: ${message}`);
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
          default: log.warn(`Unknown rvcRunMode: ${request?.newMode}`);
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
    serviceArea: {
      selectAreas: wrapHandler('serviceArea.selectAreas', async (request?: { selectedAreas?: number[] }) => {
        const areaIds = request?.selectedAreas ?? [];
        // Convert Matter area IDs to Dreame room IDs (numeric)
        const currentState = getState ? getState() : initialState;
        const areaMap = MatterClusterMapper.buildAreaIdToRoomIdMap(currentState);
        const roomIds = areaIds
          .map((areaId) => {
            const roomIdStr = areaMap.get(areaId);
            return roomIdStr ? Number.parseInt(roomIdStr, 10) : areaId;
          })
          .filter((id) => Number.isFinite(id) && id > 0);
        await handlers.handleRoomSelection(roomIds);
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
      accessories.push(accessory);
      log.info(`Registered new Matter accessory: ${accessory.displayName}`);
    } else {
      matterApi.configureMatterAccessory?.(accessory);
      await matterApi.updatePlatformAccessories?.([accessory]);
      log.info(`Updated existing Matter accessory: ${accessory.displayName}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // If ServiceArea was active, retry without it (common on first boot)
    if (serviceAreaActive) {
      log.warn(`Registration failed with ServiceArea (${message}); retrying without...`);
      delete clusters['serviceArea'];
      try {
        if (isNew) {
          matterApi.configureMatterAccessory?.(accessory);
          await matterApi.registerPlatformAccessories?.(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          accessories.push(accessory);
        } else {
          matterApi.configureMatterAccessory?.(accessory);
          await matterApi.updatePlatformAccessories?.([accessory]);
        }
        log.info(`Registered ${accessory.displayName} without ServiceArea`);
        const statePushSupported = !!(matterApi as Record<string, unknown>)['updateAccessoryState'];
        return { configured: true, statePushSupported, serviceAreaActive: false };
      } catch (retryErr: unknown) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        log.error(`Registration retry also failed: ${retryMessage}`);
        return { configured: false, statePushSupported: false, serviceAreaActive: false };
      }
    }

    log.error(`Failed to register/update Matter accessory: ${message}`);
    return { configured: false, statePushSupported: false, serviceAreaActive: false };
  }

  const statePushSupported = !!(matterApi as Record<string, unknown>)['updateAccessoryState'];
  return { configured: true, statePushSupported, serviceAreaActive };
}

export async function cleanupStaleAccessories(
  matterApi: MatterPlatformApi,
  accessories: PlatformAccessory[],
  activeUuids: Set<string>,
  log: Logger,
): Promise<void> {
  const stale = accessories.filter((acc) => !activeUuids.has(acc.UUID));
  if (stale.length > 0 && matterApi.unregisterPlatformAccessories) {
    log.info(`Removing ${stale.length} stale accessory(ies)...`);
    await matterApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    for (const acc of stale) {
      const idx = accessories.indexOf(acc);
      if (idx >= 0) accessories.splice(idx, 1);
    }
  }
}
