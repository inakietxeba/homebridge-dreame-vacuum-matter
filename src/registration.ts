import type { API, MatterAccessory, MatterAPI } from 'homebridge';
import { CleaningMode } from './config.js';
import { Logger } from './util/logger.js';
import { MatterCommandHandlers } from './matter/handlers.js';
import { MatterClusterMapper } from './matter/clusters.js';
import { NormalizedState, Identity } from './dreame/models.js';

const PLUGIN_NAME = 'homebridge-dreame-vacuum-matter';
const PLATFORM_NAME = 'DreameVacuumMatter';

export type RegistrationResult = {
  configured: boolean;
  statePushSupported: boolean;
};

export function getMatterApi(api: API): MatterAPI | undefined {
  return api.matter;
}

type WrapHandlerFn = <T extends unknown[]>(
  name: string,
  fn: (...args: T) => Promise<void>,
) => (...args: T) => Promise<void>;

function buildHandlers(
  handlers: MatterCommandHandlers,
  matter: MatterAPI,
  uuid: string,
  log: Logger,
  wrapHandler: WrapHandlerFn,
): Record<string, Record<string, unknown>> {
  // Use cluster name constants per wiki best practice #7
  const cn = matter.clusterNames;

  return {
    identify: {
      identify: wrapHandler('identify.identify', async () => {
        await handlers.handleLocateCommand();
      }),
    },
    rvcRunMode: {
      changeToMode: wrapHandler('rvcRunMode.changeToMode', async (request?: { newMode?: number }) => {
        switch (request?.newMode) {
          case 0x00: await handlers.handleStopCommand(); break;
          case 0x01: await handlers.handleStartCommand(false); break;
          case 0x02: await handlers.handleGoHomeCommand(); break;
          default: log.warn(`Unknown rvcRunMode: ${request?.newMode}`); return;
        }
        // Command handler — MUST manually update state (wiki best practice #4)
        if (matter.updateAccessoryState && request?.newMode !== undefined) {
          await matter.updateAccessoryState(uuid, cn?.RvcRunMode ?? 'rvcRunMode', {
            currentMode: request.newMode,
          });
        }
      }),
    },
    rvcOperationalState: {
      // Command handlers — MUST manually update operationalState (wiki best practice #4)
      pause: wrapHandler('rvcOperationalState.pause', async () => {
        await handlers.handlePauseCommand();
        if (matter.updateAccessoryState) {
          await matter.updateAccessoryState(uuid, cn?.RvcOperationalState ?? 'rvcOperationalState', {
            operationalState: 2, // Paused
          });
        }
      }),
      resume: wrapHandler('rvcOperationalState.resume', async () => {
        await handlers.handleResumeCommand();
        if (matter.updateAccessoryState) {
          await matter.updateAccessoryState(uuid, cn?.RvcOperationalState ?? 'rvcOperationalState', {
            operationalState: 1, // Running
          });
        }
      }),
      goHome: wrapHandler('rvcOperationalState.goHome', async () => {
        await handlers.handleGoHomeCommand();
        if (matter.updateAccessoryState) {
          await matter.updateAccessoryState(uuid, cn?.RvcOperationalState ?? 'rvcOperationalState', {
            operationalState: 0, // Stopped (returning to dock)
          });
        }
      }),
    },
    rvcCleanMode: {
      changeToMode: wrapHandler('rvcCleanMode.changeToMode', async (request?: { newMode?: number }) => {
        const modeMap: Record<number, CleaningMode> = { 0: 'SWEEP', 1: 'MOP', 2: 'SWEEP_AND_MOP' };
        const mode = request?.newMode !== undefined ? modeMap[request.newMode] : undefined;
        if (mode) {
          await handlers.handleCleaningMode(mode);
          // Command handler — MUST manually update state
          if (matter.updateAccessoryState && request?.newMode !== undefined) {
            await matter.updateAccessoryState(uuid, cn?.RvcCleanMode ?? 'rvcCleanMode', {
              currentMode: request.newMode,
            });
          }
        }
      }),
    },
  };
}

/**
 * Build a plain MatterAccessory object following the official Homebridge Matter wiki.
 * This is NOT a PlatformAccessory — it's a plain object with typed fields.
 */
export function buildMatterAccessory(
  matter: MatterAPI,
  handlers: MatterCommandHandlers,
  identity: Identity,
  initialState: NormalizedState,
  deviceName: string,
  log: Logger,
): MatterAccessory | undefined {
  const uuid = matter.uuid.generate(identity.deviceId);
  const deviceType = matter.deviceTypes?.RoboticVacuumCleaner;

  if (!deviceType) {
    log.warn('RoboticVacuumCleaner device type not available in Matter API');
    return undefined;
  }

  // Build clusters from initial state
  const matterState = MatterClusterMapper.toMatterState(initialState);
  const clusters: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(matterState)) {
    if (key === 'ServiceArea') continue; // Not supported for Dreame
    const lowerKey = key.charAt(0).toLowerCase() + key.slice(1);
    clusters[lowerKey] = value as Record<string, unknown>;
  }

  // Handler error wrapper
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

  const accessoryHandlers = buildHandlers(handlers, matter, uuid, log, wrapHandler);

  log.debug(`Building MatterAccessory: uuid=${uuid}, clusters=${Object.keys(clusters).join(', ')}`);

  const accessory: MatterAccessory = {
    UUID: uuid,
    displayName: deviceName,
    deviceType,
    serialNumber: identity.deviceId,
    manufacturer: 'Dreame',
    model: identity.model,
    firmwareRevision: identity.firmware,
    context: {
      deviceId: identity.deviceId,
      model: identity.model,
      firmware: identity.firmware,
    },
    clusters,
    handlers: accessoryHandlers as MatterAccessory['handlers'],
  };

  return accessory;
}

/**
 * Re-attach handlers to a cached MatterAccessory restored via configureMatterAccessory.
 * The accessory is already registered — we just need to re-wire command handlers.
 */
export function reattachHandlers(
  accessory: MatterAccessory,
  handlers: MatterCommandHandlers,
  matter: MatterAPI,
  log: Logger,
): void {
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

  accessory.handlers = buildHandlers(handlers, matter, accessory.UUID, log, wrapHandler) as MatterAccessory['handlers'];

  log.debug(`Re-attached handlers for cached accessory: ${accessory.displayName}`);
}

/**
 * Register new Matter accessories.
 * Follows the official Homebridge Matter wiki:
 * - New accessories → registerPlatformAccessories (only once, then cached automatically)
 * - Cached accessories → no registration needed (already restored by configureMatterAccessory)
 */
export async function registerNewMatterAccessory(
  matter: MatterAPI,
  accessory: MatterAccessory,
  log: Logger,
): Promise<RegistrationResult> {
  try {
    log.info(`Registering new Matter accessory: ${accessory.displayName} (UUID=${accessory.UUID})`);
    await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    log.info(`Registered Matter accessory: ${accessory.displayName}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to register Matter accessory: ${message}`);
    return { configured: false, statePushSupported: false };
  }

  const statePushSupported = !!matter.updateAccessoryState;
  return { configured: true, statePushSupported };
}

export async function updateCachedMatterAccessory(
  matter: MatterAPI,
  accessory: MatterAccessory,
  log: Logger,
): Promise<RegistrationResult> {
  try {
    // RoboticVacuumCleaner accessories are published as external Matter
    // bridges by Homebridge. Their cache is owned by the dedicated external
    // server, so there is no bridged platform cache to update here.
    log.debug(`Reusing cached external Matter accessory: ${accessory.displayName}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to update Matter accessory: ${message}`);
    return { configured: false, statePushSupported: false };
  }

  const statePushSupported = !!matter.updateAccessoryState;
  return { configured: true, statePushSupported };
}

export async function cleanupStaleAccessories(
  matter: MatterAPI,
  cachedAccessories: Map<string, MatterAccessory>,
  activeUuids: Set<string>,
  log: Logger,
): Promise<void> {
  const stale = [...cachedAccessories.entries()]
    .filter(([uuid]) => !activeUuids.has(uuid))
    .map(([, acc]) => acc);

  if (stale.length > 0) {
    log.info(`Removing ${stale.length} stale Matter accessory(ies)...`);
    await matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    for (const acc of stale) {
      cachedAccessories.delete(acc.UUID);
    }
  }
}
