import {
  API,
  Logger as HomebridgeLogger,
  PlatformAccessory,
} from 'homebridge';

import { isDeepStrictEqual } from 'node:util';

import { CleaningMode } from '../config';
import { MapRooms, NormalizedState, RoomInfo } from '../dreame/models';
import { MatterMappers } from './mappers';
import { MatterClusterMapper, MatterState } from './clusters';
import { Logger } from '../util/logger';

export interface DreameVacuumAccessoryOptions {
  disableMatterStatePush?: boolean;
  serviceAreaActive?: boolean;
  onRoomsDiscovered?: (rooms: RoomInfo[], knownMaps: MapRooms[]) => void;
}

/** Detects transient Matter session errors that may self-resolve. */
function isTransientMatterSessionError(message: string): boolean {
  return message.includes('unknown session')
    || message.includes('session timeout')
    || message.includes('Session not found');
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
  private serviceAreaActive: boolean;
  private lastNotifiedRoomsSignature: string | undefined;
  private isRegistered = false;
  private syncInFlight = false;
  private pendingSync = false;
  private syncRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private syncRetryDelayMs = 2000;
  private syncDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicSyncTimer: ReturnType<typeof setInterval> | undefined;
  private consecutiveSessionErrors = 0;
  private sessionRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsupportedClustersLogged = new Set<string>();
  private readonly onRoomsDiscovered: ((rooms: RoomInfo[], knownMaps: MapRooms[]) => void) | undefined;

  private static readonly SYNC_DEBOUNCE_MS = 100;
  private static readonly PERIODIC_SYNC_INTERVAL_MS = 60_000;
  private static readonly PER_CLUSTER_PUSH_TIMEOUT_MS = 3_000;
  private static readonly SESSION_ERROR_THRESHOLD = 3;
  private static readonly SESSION_RECOVERY_DELAY_MS = 60_000;

  constructor(
    private readonly platformLog: HomebridgeLogger,
    private readonly accessory: PlatformAccessory,
    initialState: NormalizedState,
    private readonly api: API,
    options?: DreameVacuumAccessoryOptions,
  ) {
    this.currentState = initialState;
    this.platformLogger = new Logger(platformLog, 'MatterAccessory');
    this.matterStatePushEnabled = !options?.disableMatterStatePush;
    this.serviceAreaActive = options?.serviceAreaActive === true;
    this.onRoomsDiscovered = options?.onRoomsDiscovered;

    if (Array.isArray(initialState.activity.availableRooms) && initialState.activity.availableRooms.length > 0) {
      this.lastNotifiedRoomsSignature = DreameVacuumAccessory.computeRoomsSignature(
        initialState.activity.availableRooms,
        initialState.activity.knownMaps,
      );
    }

    this.setupMatterClusters();
  }

  public markRegistered(): void {
    if (this.isRegistered) return;
    this.isRegistered = true;
    this.platformLogger.debug(`Matter accessory ${this.accessory.UUID} marked registered`);
    this.requestSync();

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

  private setupMatterClusters(): void {
    const Service = this.api.hap.Service;
    const Characteristic = this.api.hap.Characteristic;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Dreame')
      .setCharacteristic(Characteristic.Model, this.currentState.identity.model)
      .setCharacteristic(Characteristic.SerialNumber, this.currentState.identity.deviceId)
      .setCharacteristic(Characteristic.FirmwareRevision, this.currentState.identity.firmware);

    const staleSwitch = this.accessory.getService(Service.Switch);
    if (staleSwitch) {
      this.accessory.removeService(staleSwitch);
    }

    this.requestSync();
  }

  public onStateUpdate(newState: NormalizedState): void {
    this.currentState = newState;
    this.maybeNotifyRoomsDiscovered(newState);
    this.requestSync();
  }

  public applyUserCleanMode(mode: CleaningMode): void {
    if (this.currentState.activity.cleanMode === mode) return;
    this.currentState.activity.cleanMode = mode;
    this.requestSync();
  }

  private maybeNotifyRoomsDiscovered(state: NormalizedState): void {
    const rooms = state.activity.availableRooms;
    const knownMaps = state.activity.knownMaps ?? [];
    if (!Array.isArray(rooms) || rooms.length === 0) return;

    const signature = DreameVacuumAccessory.computeRoomsSignature(rooms, knownMaps);
    if (signature === this.lastNotifiedRoomsSignature) return;
    this.lastNotifiedRoomsSignature = signature;
    this.onRoomsDiscovered?.(rooms, knownMaps);
  }

  /**
   * Request a debounced state sync to Matter. Coalesces rapid updates
   * (e.g. multiple MQTT properties arriving within 100ms) into a single push.
   */
  private requestSync(): void {
    if (!this.isRegistered || !this.matterStatePushEnabled) return;
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
      const matterState = MatterClusterMapper.toMatterState(this.currentState);

      if (!this.serviceAreaActive) {
        delete matterState.ServiceArea;
      }

      if (this.lastSyncedMatterState && isDeepStrictEqual(matterState, this.lastSyncedMatterState)) {
        return;
      }

      const matterApi = (this.api as unknown as {
        matter?: {
          updateAccessoryState?: (uuid: string, cluster: string, payload: unknown) => void | Promise<void>;
          clusterNames?: Record<string, string>;
        };
      }).matter;
      if (!matterApi?.updateAccessoryState) return;

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
            matterApi.updateAccessoryState!(this.accessory.UUID, cluster, payload),
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
        }
      } else if (anySucceeded) {
        this.consecutiveSessionErrors = 0;
      }

      if (anySucceeded) {
        this.lastSyncedMatterState = structuredClone(matterState);
      }
      this.syncRetryDelayMs = 2000;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.platformLogger.warn(`State sync failed: ${message}`);

      // Exponential backoff retry
      if (this.syncRetryTimer) clearTimeout(this.syncRetryTimer);
      this.syncRetryTimer = setTimeout(() => this.requestSync(), this.syncRetryDelayMs);
      this.syncRetryDelayMs = Math.min(30_000, this.syncRetryDelayMs * 2);
    }
  }

  private scheduleSessionRecovery(): void {
    if (this.sessionRecoveryTimer) return;
    this.sessionRecoveryTimer = setTimeout(() => {
      this.sessionRecoveryTimer = undefined;
      this.matterStatePushEnabled = true;
      this.consecutiveSessionErrors = 0;
      this.lastSyncedMatterState = undefined;
      this.platformLogger.info('Re-enabling Matter state pushes after session error recovery.');
      this.requestSync();
    }, DreameVacuumAccessory.SESSION_RECOVERY_DELAY_MS);
  }

  public dispose(): void {
    if (this.syncRetryTimer) clearTimeout(this.syncRetryTimer);
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    if (this.periodicSyncTimer) clearInterval(this.periodicSyncTimer);
    if (this.sessionRecoveryTimer) clearTimeout(this.sessionRecoveryTimer);
  }

  private static computeRoomsSignature(rooms: RoomInfo[], knownMaps: MapRooms[]): string {
    const roomPart = rooms.map((r) => `${r.id}:${r.name}`).sort().join('|');
    const mapPart = knownMaps.map((m) => `${m.mapId}:${m.rooms.map((r) => r.id).sort().join(',')}`).sort().join('|');
    return `${roomPart}||${mapPart}`;
  }
}
