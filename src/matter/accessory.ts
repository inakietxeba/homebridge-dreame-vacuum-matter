import {
  API,
  Logger as HomebridgeLogger,
  PlatformAccessory,
} from 'homebridge';

import { isDeepStrictEqual } from 'node:util';

import { CleaningMode } from '../config';
import { MapRooms, NormalizedState, RoomInfo } from '../dreame/models';
import { MatterMappers } from './mappers';
import { MatterClusterMapper } from './clusters';
import { Logger } from '../util/logger';

export function isTransientMatterSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('unknown session')
    || (normalized.includes('session') && normalized.includes('is closing'))
    || normalized.includes('ignoring message for unknown session')
    || normalized.includes('peer is no longer responding to active session')
    || (normalized.includes('active session') && normalized.includes('timed out'));
}

export interface DreameVacuumAccessoryOptions {
  disableMatterStatePush?: boolean;
  serviceAreaActive?: boolean;
  onRoomsDiscovered?: (rooms: RoomInfo[], knownMaps: MapRooms[]) => void;
}

export class DreameVacuumAccessory {
  private currentState: NormalizedState;
  private lastSyncedMatterState?: Record<string, unknown>;
  private readonly platformLogger: Logger;
  private matterStatePushEnabled: boolean;
  private serviceAreaActive: boolean;
  private lastNotifiedRoomsSignature: string | undefined;
  private isRegistered = false;
  private syncInFlight = false;
  private pendingSync = false;
  private syncDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private static readonly SYNC_DEBOUNCE_MS = 100;
  private syncRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private syncRetryDelayMs = 2000;
  private syncRetryAttempts = 0;
  private unknownSessionBackoffUntil = 0;
  private hasLoggedUnknownSessionBackoff = false;
  private consecutiveUnknownSessionErrors = 0;
  private statePushRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicSyncTimer: ReturnType<typeof setInterval> | undefined;
  private static readonly PERIODIC_SYNC_INTERVAL_MS = 60_000;
  private static readonly PER_CLUSTER_PUSH_TIMEOUT_MS = 3_000;
  private readonly unsupportedClustersLogged = new Set<string>();
  private readonly onRoomsDiscovered: ((rooms: RoomInfo[], knownMaps: MapRooms[]) => void) | undefined;

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
    this.startPeriodicSync();
  }

  public markRegistered(): void {
    if (this.isRegistered) return;
    this.isRegistered = true;
    this.platformLogger.debug(`Matter accessory ${this.accessory.UUID} marked registered`);
    this.requestSync();
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

  private requestSync(): void {
    if (!this.isRegistered || !this.matterStatePushEnabled) return;
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = setTimeout(() => void this.doSync(), DreameVacuumAccessory.SYNC_DEBOUNCE_MS);
  }

  private async doSync(): Promise<void> {
    if (this.syncInFlight) {
      this.pendingSync = true;
      return;
    }

    if (Date.now() < this.unknownSessionBackoffUntil) return;

    this.syncInFlight = true;
    try {
      const matterState = MatterClusterMapper.toMatterState(this.currentState);

      if (!this.serviceAreaActive) {
        delete matterState['ServiceArea'];
      }

      if (this.lastSyncedMatterState && isDeepStrictEqual(matterState, this.lastSyncedMatterState)) {
        return;
      }

      const matterApi = (this.api as unknown as { matter?: { updateAccessoryState?: (uuid: string, cluster: string, payload: unknown) => void | Promise<void> } }).matter;
      if (!matterApi?.updateAccessoryState) return;

      const pushPromises: Promise<void>[] = [];
      for (const [cluster, payload] of Object.entries(matterState)) {
        const promise = Promise.race([
          Promise.resolve(matterApi.updateAccessoryState(this.accessory.UUID, cluster, payload)),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout pushing ${cluster}`)), DreameVacuumAccessory.PER_CLUSTER_PUSH_TIMEOUT_MS),
          ),
        ]).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (isTransientMatterSessionError(message)) {
            this.consecutiveUnknownSessionErrors++;
            if (this.consecutiveUnknownSessionErrors >= 3) {
              this.unknownSessionBackoffUntil = Date.now() + 30_000;
              if (!this.hasLoggedUnknownSessionBackoff) {
                this.platformLogger.warn(`Backing off Matter pushes for 30s after ${this.consecutiveUnknownSessionErrors} session errors`);
                this.hasLoggedUnknownSessionBackoff = true;
              }
              this.scheduleStatePushRecovery();
            }
          } else if (message.includes('not registered') || message.includes('Unsupported')) {
            if (!this.unsupportedClustersLogged.has(cluster)) {
              this.platformLogger.debug(`Cluster ${cluster} not supported — skipping`);
              this.unsupportedClustersLogged.add(cluster);
            }
          } else {
            this.platformLogger.warn(`Failed to push ${cluster}: ${message}`);
          }
        });
        pushPromises.push(promise);
      }

      await Promise.allSettled(pushPromises);
      this.lastSyncedMatterState = matterState;
      this.syncRetryAttempts = 0;
      this.syncRetryDelayMs = 2000;
      this.consecutiveUnknownSessionErrors = 0;
      this.hasLoggedUnknownSessionBackoff = false;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.platformLogger.warn(`State sync failed: ${message}`);

      this.syncRetryAttempts++;
      this.syncRetryDelayMs = Math.min(15_000, this.syncRetryDelayMs * 2);
      if (this.syncRetryTimer) clearTimeout(this.syncRetryTimer);
      this.syncRetryTimer = setTimeout(() => this.requestSync(), this.syncRetryDelayMs);
    } finally {
      this.syncInFlight = false;
      if (this.pendingSync) {
        this.pendingSync = false;
        this.requestSync();
      }
    }
  }

  private scheduleStatePushRecovery(): void {
    if (this.statePushRecoveryTimer) return;
    this.statePushRecoveryTimer = setTimeout(() => {
      this.statePushRecoveryTimer = undefined;
      this.unknownSessionBackoffUntil = 0;
      this.consecutiveUnknownSessionErrors = 0;
      this.hasLoggedUnknownSessionBackoff = false;
      this.lastSyncedMatterState = undefined;
      this.requestSync();
    }, 60_000);
  }

  private startPeriodicSync(): void {
    this.periodicSyncTimer = setInterval(() => {
      this.lastSyncedMatterState = undefined;
      this.requestSync();
    }, DreameVacuumAccessory.PERIODIC_SYNC_INTERVAL_MS);
  }

  public dispose(): void {
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    if (this.syncRetryTimer) clearTimeout(this.syncRetryTimer);
    if (this.statePushRecoveryTimer) clearTimeout(this.statePushRecoveryTimer);
    if (this.periodicSyncTimer) clearInterval(this.periodicSyncTimer);
  }

  private static computeRoomsSignature(rooms: RoomInfo[], knownMaps: MapRooms[]): string {
    const roomPart = rooms.map((r) => `${r.id}:${r.name}`).sort().join('|');
    const mapPart = knownMaps.map((m) => `${m.mapId}:${m.rooms.map((r) => r.id).sort().join(',')}`).sort().join('|');
    return `${roomPart}||${mapPart}`;
  }
}
