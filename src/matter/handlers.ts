import { DreameCloud } from '../dreame/cloud';
import { Logger } from '../util/logger';
import { CleaningMode } from '../config';
import { MIOT, SuctionLevel, WaterLevel } from '../dreame/models';

const CLEANING_MODE_TO_VALUE: Record<CleaningMode, number> = {
  SWEEP: 0,
  MOP: 1,
  SWEEP_AND_MOP: 2,
};

class TemporalSuppression {
  private until = 0;

  suppress(durationMs: number): void {
    this.until = Date.now() + durationMs;
  }

  get isActive(): boolean {
    return Date.now() < this.until;
  }
}

export class MatterCommandHandlers {
  private readonly pauseSuppression = new TemporalSuppression();
  private currentCleanMode: CleaningMode;
  private readonly modeSuppression = new TemporalSuppression();
  private onCleanModeSelected?: (mode: CleaningMode) => void;
  private pendingRoomIds: number[] | null = null;

  constructor(
    private readonly cloud: DreameCloud,
    private readonly deviceId: string,
    private readonly log: Logger,
    defaultCleanMode: CleaningMode = 'SWEEP_AND_MOP',
  ) {
    this.currentCleanMode = defaultCleanMode;
  }

  public setOnCleanModeSelected(callback: (mode: CleaningMode) => void): void {
    this.onCleanModeSelected = callback;
  }

  public isCleanModeSuppressionActive(): boolean {
    return this.modeSuppression.isActive;
  }

  public resolveCleanModeForState(candidate: CleaningMode): CleaningMode {
    return this.isCleanModeSuppressionActive() ? this.currentCleanMode : candidate;
  }

  public async handleStartCommand(isPaused = false): Promise<void> {
    this.log.info('Handling Matter Start Command...');
    this.suppressPauseForCommandSequence();

    // Set cleaning mode first
    await this.setCleaningMode(this.currentCleanMode);
    this.modeSuppression.suppress(10_000);

    if (isPaused) {
      this.log.debug('Robot is paused — sending START');
    }

    // If rooms are selected, send room-specific clean command
    const roomsToClean = this.pendingRoomIds;
    if (roomsToClean && roomsToClean.length > 0) {
      const selects = roomsToClean.map((roomId, index) => [
        roomId,
        1, // repeat count
        this.getCurrentSuctionLevel(),
        this.getCurrentWaterLevel(),
        index + 1,
      ]);
      await this.cloud.setProperties(this.deviceId, [
        { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEANING_PROPERTIES, value: JSON.stringify({ selects }) },
      ]);
      this.log.debug(`Room clean sent for rooms [${roomsToClean.join(', ')}]`);
    }

    await this.cloud.action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.START);
    // Clear pending rooms only after START succeeds
    if (roomsToClean) this.pendingRoomIds = null;
    this.log.debug('START_CLEANING sent successfully');
  }

  public async handleRoomSelection(roomIds: number[]): Promise<void> {
    this.pendingRoomIds = roomIds.length > 0 ? [...roomIds] : null;
    this.log.debug(
      roomIds.length > 0
        ? `Room selection set for next start: [${roomIds.join(', ')}]`
        : 'Room selection cleared — next start will auto-clean.',
    );
  }

  /** Returns current suction level (used in room clean params). Default: 1 (Standard). */
  private getCurrentSuctionLevel(): number { return this._suctionLevel; }
  /** Returns current water level (used in room clean params). Default: 2 (Medium). */
  private getCurrentWaterLevel(): number { return this._waterLevel; }
  private _suctionLevel = 1;
  private _waterLevel = 2;

  public async handleStopCommand(): Promise<void> {
    this.log.info('Handling Matter Stop Command...');
    await this.cloud.action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.STOP);
  }

  public async handlePauseCommand(): Promise<void> {
    if (this.pauseSuppression.isActive) return;
    await this.cloud.action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.PAUSE);
  }

  public async handleResumeCommand(): Promise<void> {
    this.suppressPauseForCommandSequence();
    await this.cloud.action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.START);
  }

  public async handleGoHomeCommand(): Promise<void> {
    this.log.info('Handling Matter Go Home Command...');
    this.suppressPauseForCommandSequence();
    await this.cloud.action(this.deviceId, MIOT.CHARGE.siid, MIOT.ACTION.DOCK);
  }

  public async handleCleaningMode(mode: CleaningMode): Promise<void> {
    this.currentCleanMode = mode;
    this.modeSuppression.suppress(10_000);
    this.log.debug(`User selected cleaning mode: ${mode} — suppressing device echo for 10s`);

    try {
      this.onCleanModeSelected?.(mode);
    } catch (error: unknown) {
      this.log.warn(`onCleanModeSelected callback threw: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.setCleaningMode(mode);
  }

  public async handleSuctionLevel(level: 0 | 1 | 2 | 3): Promise<void> {
    this._suctionLevel = level;
    await this.cloud.setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.SUCTION, value: level },
    ]);
  }

  public async handleWaterLevel(level: 1 | 2 | 3): Promise<void> {
    this._waterLevel = level;
    await this.cloud.setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.WATER, value: level },
    ]);
  }

  public syncCleanModeFromDevice(mode: CleaningMode): void {
    if (this.modeSuppression.isActive) {
      this.log.debug(`Ignoring device-reported mode ${mode} (echo suppression active)`);
      return;
    }
    this.currentCleanMode = mode;
  }

  /** Sync suction and water levels from device state (called on poll/MQTT updates). */
  public syncLevelsFromDevice(suctionLevel: SuctionLevel, waterLevel: WaterLevel): void {
    this._suctionLevel = suctionLevel;
    this._waterLevel = waterLevel;
  }

  private suppressPauseForCommandSequence(durationMs = 8000): void {
    this.pauseSuppression.suppress(durationMs);
  }

  private async setCleaningMode(mode: CleaningMode): Promise<void> {
    await this.cloud.setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: CLEANING_MODE_TO_VALUE[mode] },
    ]);
  }
}
