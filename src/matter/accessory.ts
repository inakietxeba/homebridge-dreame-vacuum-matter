import type {
  API,
  Logger as HomebridgeLogger,
} from 'homebridge';

import { isDeepStrictEqual } from 'node:util';

import { CleaningMode } from '../config.js';
import { NormalizedState } from '../dreame/models.js';
import { MatterClusterMapper, MatterState } from './clusters.js';
import { Logger } from '../util/logger.js';

export interface DreameVacuumAccessoryOptions {
  disableMatterStatePush?: boolean;
}

/** Detects transient Matter session errors that may self-resolve. */
function isTransientMatterSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('unknown session')
    || (normalized.includes('session') && normalized.includes('is closing'))
    || normalized.includes('ignoring message for unknown session')
    || normalized.includes('peer is no longer responding to active session')
    || normalized.includes('session timeout')
    || normalized.includes('session not found')
    || (normalized.includes('active session') && normalized.includes('timed out'));
}

type PushResult =
  | { kind: 'pushed' }
  | { kind: 'retry' }
  | { kind: 'session-error' }
  | { kind: 'unsupported'; cluster: string; message: string }
  | { kind: 'failed'; cluster: string; message: string };

export class DreameVacuumAccessory {
  private currentState: NormalizedState;
  private lastSyncedMatterState?: MatterState;
  private readonly platformLogger: Logger;
  private matterStatePushEnabled: boolean;
  private isRegistered = false;
  private syncInFlight = false;
  private pendingSync = false;
  private syncRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private registrationSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private syncRetryDelayMs = 2000;
  private syncRetryAttempts = 0;
  private syncDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicSyncTimer: ReturnType<typeof setInterval> | undefined;
  private consecutiveSessionErrors = 0;
  private sessionRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private transientSessionBackoffUntil = 0;
  private hasLoggedSessionBackoff = false;
  private readonly unsupportedClustersLogged = new Set<string>();

  private static readonly SYNC_DEBOUNCE_MS = 100;
  private static readonly INITIAL_REGISTRATION_SYNC_DELAY_MS = 5_000;
  private static readonly PERIODIC_SYNC_INTERVAL_MS = 300_000;
  private static readonly PER_CLUSTER_PUSH_TIMEOUT_MS = 3_000;
  private static readonly SESSION_ERROR_THRESHOLD = 3;
  private static readonly SESSION_RECOVERY_DELAY_MS = 60_000;

  constructor(
    private readonly platformLog: HomebridgeLogger,
    private readonly uuid: string,
    initialState: NormalizedState,
    private readonly api: API,
    options?: DreameVacuumAccessoryOptions,
  ) {
    this.currentState = initialState;
    this.platformLogger = new Logger(platformLog, 'MatterAccessory');
    this.matterStatePushEnabled = !options?.disableMatterStatePush;
  }

  public markRegistered(): void {
    if (this.isRegistered) return;
    this.isRegistered = true;
    this.platformLogger.debug(`Matter accessory ${this.uuid} marked registered`);
    this.registrationSyncTimer = setTimeout(() => {
      this.registrationSyncTimer = undefined;
      this.requestSync();
    }, DreameVacuumAccessory.INITIAL_REGISTRATION_SYNC_DELAY_MS);

    // Start periodic sync to recover from dropped Matter updates
    if (!this.periodicSyncTimer) {
      this.periodicSyncTimer = setInterval(() => {
        // Clear dedup cache so state is always pushed
        this.lastSyncedMatterState = undefined;
        this.requestSync();
      }, DreameVacuumAccessory.PERIODIC_SYNC_INTERVAL_MS);
    }
  }

  public markUnregistered(): void {
    this.isRegistered = false;
  }

  public getCurrentState(): NormalizedState {
    return this.currentState;
  }

  public onStateUpdate(newState: NormalizedState): void {
    this.currentState = newState;
    this.requestSync();
  }

  public applyUserCleanMode(mode: CleaningMode): void {
    if (this.currentState.activity.cleanMode === mode) return;
    this.currentState.activity.cleanMode = mode;
    this.requestSync();
  }

  public applyUserRoomSelection(roomIds: string[]): void {
    if (isDeepStrictEqual(this.currentState.activity.selectedRooms, roomIds)) return;
    this.currentState.activity.selectedRooms = [...roomIds];
    this.requestSync();
  }

  public applyUserReturnToDock(): void {
    this.currentState.activity.runMode = 'returning';
    this.currentState.activity.paused = false;
    this.currentState.activity.maintenanceType = undefined;
    this.currentState.power.docked = false;
    this.currentState.power.charging = false;
    this.requestSync();
  }

  /**
   * Request a debounced state sync to Matter. Coalesces rapid updates
   * (e.g. multiple MQTT properties arriving within 100ms) into a single push.
   */
  private requestSync(): void {
    this.pendingSync = true;
    if (this.syncInFlight) return;
    if (this.syncDebounceTimer) return;

    this.syncDebounceTimer = setTimeout(() => {
      this.syncDebounceTimer = undefined;
      void this.flushSync();
    }, DreameVacuumAccessory.SYNC_DEBOUNCE_MS);
  }

  private async flushSync(): Promise<void> {
    if (this.syncInFlight) return;
    this.syncInFlight = true;
    try {
      while (this.pendingSync) {
        this.pendingSync = false;
        await this.doSync();
      }
    } finally {
      this.syncInFlight = false;
    }
  }

  private async doSync(): Promise<void> {
    try {
      if (!this.matterStatePushEnabled) return;

      if (!this.isRegistered) {
        this.platformLogger.debug(`Skipping Matter state push for ${this.uuid}; accessory not yet registered.`);
        return;
      }

      const matterState = MatterClusterMapper.toMatterState(this.currentState);

      if (this.lastSyncedMatterState && isDeepStrictEqual(matterState, this.lastSyncedMatterState)) {
        return;
      }

      const matterApi = this.api.matter;
      if (!matterApi?.updateAccessoryState) {
        this.platformLogger.warn('api.matter.updateAccessoryState is unavailable; skipping Matter sync.');
        return;
      }

      const now = Date.now();
      if (now < this.transientSessionBackoffUntil) {
        this.scheduleSyncRetry(this.transientSessionBackoffUntil - now);
        if (!this.hasLoggedSessionBackoff) {
          const seconds = Math.ceil((this.transientSessionBackoffUntil - now) / 1000);
          this.platformLogger.debug(`Skipping Matter state push for ${this.uuid}; waiting ${seconds}s after transient session error.`);
          this.hasLoggedSessionBackoff = true;
        }
        return;
      }

      const clusterNames: Record<string, string> = {
        RvcRunMode: matterApi.clusterNames?.RvcRunMode ?? 'rvcRunMode',
        RvcCleanMode: matterApi.clusterNames?.RvcCleanMode ?? 'rvcCleanMode',
        RvcOperationalState: matterApi.clusterNames?.RvcOperationalState ?? 'rvcOperationalState',
        ServiceArea: matterApi.clusterNames?.ServiceArea ?? 'serviceArea',
        PowerSource: matterApi.clusterNames?.PowerSource ?? 'powerSource',
      };

      // Push all clusters in parallel with per-cluster timeout
      const pushOne = async (clusterKey: string, payload: unknown): Promise<PushResult> => {
        const cluster = clusterNames[clusterKey] ?? clusterKey;
        try {
          const update = Promise.resolve(
            matterApi.updateAccessoryState(this.uuid, cluster, payload as Record<string, unknown>),
          );
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`updateAccessoryState timed out after ${DreameVacuumAccessory.PER_CLUSTER_PUSH_TIMEOUT_MS}ms`)),
              DreameVacuumAccessory.PER_CLUSTER_PUSH_TIMEOUT_MS,
            ),
          );
          await Promise.race([update, timeout]);
          return { kind: 'pushed' };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('not found or not registered') || message.includes('not registered or missing endpoint')) {
            return { kind: 'retry' };
          }
          if (isTransientMatterSessionError(message)) {
            return { kind: 'session-error' };
          }
          if (message.includes('Unknown cluster name') || message.includes('Behavior ID') || message.includes('Unsupported')) {
            return { kind: 'unsupported', cluster, message };
          }
          return { kind: 'failed', cluster, message };
        }
      };

      const results = await Promise.all(
        Object.entries(matterState)
          .filter(([, payload]) => payload !== undefined)
          .map(([key, payload]) => pushOne(key, payload)),
      );

      // Process results
      const anySucceeded = results.some((r) => r.kind === 'pushed');
      if (anySucceeded) {
        this.platformLogger.debug(`Matter state sent for ${this.uuid}: ${JSON.stringify({
          RvcRunMode: {
            currentMode: matterState.RvcRunMode.currentMode,
          },
          RvcCleanMode: {
            currentMode: matterState.RvcCleanMode.currentMode,
          },
          RvcOperationalState: {
            operationalState: matterState.RvcOperationalState.operationalState,
            operationalError: matterState.RvcOperationalState.operationalError,
          },
          ServiceArea: matterState.ServiceArea
            ? {
              selectedAreas: matterState.ServiceArea.selectedAreas,
              currentArea: matterState.ServiceArea.currentArea,
            }
            : undefined,
          PowerSource: {
            batPercentRemaining: matterState.PowerSource.batPercentRemaining,
            batChargeLevel: matterState.PowerSource.batChargeLevel,
            batChargeState: matterState.PowerSource.batChargeState,
          },
        })}`);
      }
      const shouldRetryRegistration = results.some((r) => r.kind === 'retry');
      if (shouldRetryRegistration) {
        this.syncRetryAttempts += 1;
        if (this.syncRetryAttempts === 1 || this.syncRetryAttempts % 5 === 0) {
          this.platformLogger.warn(
            `Matter state sync is waiting for accessory registration/session readiness (attempt ${this.syncRetryAttempts}).`,
          );
        }
        this.scheduleSyncRetry(this.syncRetryDelayMs);
        this.syncRetryDelayMs = Math.min(15_000, this.syncRetryDelayMs * 2);
        return;
      }

      for (const r of results) {
        if (r.kind === 'unsupported' && !this.unsupportedClustersLogged.has(r.cluster)) {
          this.platformLogger.debug(`Cluster ${r.cluster} not supported — skipping`);
          this.unsupportedClustersLogged.add(r.cluster);
        } else if (r.kind === 'failed') {
          this.platformLogger.warn(`Failed to push ${r.cluster}: ${r.message}`);
        }
      }

      // Session error tracking: circuit-break after repeated failures
      if (results.some((r) => r.kind === 'session-error')) {
        this.consecutiveSessionErrors += 1;
        if (this.consecutiveSessionErrors >= DreameVacuumAccessory.SESSION_ERROR_THRESHOLD) {
          this.matterStatePushEnabled = false;
          this.platformLogger.warn(
            `Pausing Matter state pushes after ${this.consecutiveSessionErrors} session errors. `
            + `Auto-recovery in ${DreameVacuumAccessory.SESSION_RECOVERY_DELAY_MS / 1000}s.`,
          );
          this.scheduleSessionRecovery();
          return;
        }
        this.transientSessionBackoffUntil = Date.now() + 30_000;
        this.hasLoggedSessionBackoff = false;
        this.scheduleSyncRetry(30_000);
        this.platformLogger.debug(`Matter session expired for ${this.uuid}; pausing state pushes briefly while the controller reconnects.`);
        return;
      } else if (anySucceeded) {
        this.consecutiveSessionErrors = 0;
      }

      if (anySucceeded) {
        this.lastSyncedMatterState = structuredClone(matterState);
        this.syncRetryAttempts = 0;
        this.transientSessionBackoffUntil = 0;
        this.hasLoggedSessionBackoff = false;
      }
      this.syncRetryDelayMs = 2000;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.platformLogger.warn(`State sync failed: ${message}`);

      this.scheduleSyncRetry(this.syncRetryDelayMs);
      this.syncRetryDelayMs = Math.min(30_000, this.syncRetryDelayMs * 2);
    }
  }

  private scheduleSyncRetry(delayMs: number): void {
    if (this.syncRetryTimer) return;
    this.syncRetryTimer = setTimeout(() => {
      this.syncRetryTimer = undefined;
      this.requestSync();
    }, delayMs);
  }

  private scheduleSessionRecovery(): void {
    if (this.sessionRecoveryTimer) return;
    this.sessionRecoveryTimer = setTimeout(() => {
      this.sessionRecoveryTimer = undefined;
      this.matterStatePushEnabled = true;
      this.consecutiveSessionErrors = 0;
      this.transientSessionBackoffUntil = 0;
      this.hasLoggedSessionBackoff = false;
      this.lastSyncedMatterState = undefined;
      this.platformLogger.info('Re-enabling Matter state pushes after session error recovery.');
      this.requestSync();
    }, DreameVacuumAccessory.SESSION_RECOVERY_DELAY_MS);
  }

  public dispose(): void {
    if (this.syncRetryTimer) clearTimeout(this.syncRetryTimer);
    if (this.registrationSyncTimer) clearTimeout(this.registrationSyncTimer);
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    if (this.periodicSyncTimer) clearInterval(this.periodicSyncTimer);
    if (this.sessionRecoveryTimer) clearTimeout(this.sessionRecoveryTimer);
    this.syncRetryTimer = undefined;
    this.registrationSyncTimer = undefined;
    this.syncDebounceTimer = undefined;
    this.periodicSyncTimer = undefined;
    this.sessionRecoveryTimer = undefined;
  }
}
