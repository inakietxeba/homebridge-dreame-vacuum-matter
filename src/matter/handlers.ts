import { DreameCloud } from '../dreame/cloud.js';
import { Logger } from '../util/logger.js';
import { CleaningMode } from '../config.js';
import { DREAME_STATUS, MIOT, SuctionLevel, WaterLevel } from '../dreame/models.js';
import { DreameCleaningModeCodec } from '../dreame/cleaning-mode.js';

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
  private onRoomSelectionChanged?: (roomIds: string[]) => void;
  private pendingRoomIds: number[] | null = null;
  private areaIdToRoomIdMap = new Map<number, string>();

  constructor(
    private cloud: DreameCloud | null,
    private readonly deviceId: string,
    private readonly log: Logger,
    defaultCleanMode: CleaningMode = 'SWEEP_AND_MOP',
    private cleaningModeCodec = new DreameCleaningModeCodec(),
  ) {
    this.currentCleanMode = defaultCleanMode;
  }

  /** Replace the cloud instance (used when Phase 1 placeholder is upgraded with a real connection). */
  public setCloud(cloud: DreameCloud): void {
    this.cloud = cloud;
  }

  public setCleaningModeCodec(codec: DreameCleaningModeCodec): void {
    this.cleaningModeCodec = codec;
  }

  private requireCloud(): DreameCloud {
    if (!this.cloud) throw new Error('Cloud connection not available yet');
    return this.cloud;
  }

  public setOnCleanModeSelected(callback: (mode: CleaningMode) => void): void {
    this.onCleanModeSelected = callback;
  }

  public setOnRoomSelectionChanged(callback: (roomIds: string[]) => void): void {
    this.onRoomSelectionChanged = callback;
  }

  public setAreaIdToRoomIdMap(map: Map<number, string>): void {
    this.areaIdToRoomIdMap = new Map(map);
    this.log.debug(
      this.areaIdToRoomIdMap.size > 0
        ? `Matter ServiceArea mapping loaded: ${[...this.areaIdToRoomIdMap.entries()].map(([areaId, roomId]) => `${areaId}->${roomId}`).join(', ')}`
        : 'Matter ServiceArea mapping cleared or empty',
    );
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
      const payload = { selects };
      this.log.debug(`Sending Dreame START_CUSTOM segment payload: ${JSON.stringify(payload)}`);
      await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.START_CUSTOM, [
        { piid: MIOT.VACUUM.STATUS, value: DREAME_STATUS.SEGMENT_CLEANING },
        {
          piid: MIOT.VACUUM.CLEANING_PROPERTIES,
          value: JSON.stringify(payload),
        },
      ]);
      this.log.debug(`Room clean sent for rooms [${roomsToClean.join(', ')}]`);
      return;
    }

    await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.START);
    this.log.debug('START_CLEANING sent successfully');
  }

  public async handleAreaSelection(areaIds: number[]): Promise<void> {
    this.log.debug(`Matter ServiceArea SelectAreas received: [${areaIds.join(', ')}]`);
    const roomIds: number[] = [];
    for (const areaId of areaIds) {
      const roomId = this.areaIdToRoomIdMap.get(areaId) ?? String(areaId);
      const segmentId = Number.parseInt(roomId, 10);
      if (Number.isFinite(segmentId) && segmentId > 0) {
        roomIds.push(segmentId);
      } else {
        this.log.warn(`Ignoring non-numeric Dreame room id "${roomId}" for Matter area ${areaId}`);
      }
    }
    this.log.debug(`Resolved Matter ServiceArea selection to Dreame segment(s): [${roomIds.join(', ')}]`);
    await this.handleRoomSelection(roomIds);
  }

  public async handleRoomSelection(roomIds: number[]): Promise<void> {
    this.pendingRoomIds = roomIds.length > 0 ? [...roomIds] : null;
    try {
      this.onRoomSelectionChanged?.(roomIds.map(String));
    } catch (err: unknown) {
      this.log.warn(`Failed to apply room selection to accessory state: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.STOP);
  }

  public async handlePauseCommand(): Promise<void> {
    if (this.pauseSuppression.isActive) return;
    await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.PAUSE);
  }

  public async handleResumeCommand(): Promise<void> {
    this.suppressPauseForCommandSequence();
    await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.ACTION.START);
  }

  public async handleGoHomeCommand(): Promise<void> {
    this.log.info('Handling Matter Go Home Command...');
    this.suppressPauseForCommandSequence();
    await this.requireCloud().action(this.deviceId, MIOT.CHARGE.siid, MIOT.ACTION.DOCK);
  }

  public async handleLocateCommand(): Promise<void> {
    this.log.info('Handling Matter Identify Command...');
    try {
      const result = await this.requireCloud().action(this.deviceId, MIOT.LOCATE.siid, MIOT.ACTION.LOCATE);
      this.assertDreameActionSucceeded('LOCATE', result);
      this.log.debug('LOCATE sent successfully');
    } catch (err: unknown) {
      this.log.warn(`Dreame locate action failed or is unsupported by this model: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    await this.requireCloud().setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.SUCTION, value: level },
    ]);
  }

  public async handleWaterLevel(level: 1 | 2 | 3): Promise<void> {
    this._waterLevel = level;
    await this.requireCloud().setProperties(this.deviceId, [
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
    const rawValue = this.cleaningModeCodec.encode(mode);
    this.log.debug(
      `Setting Dreame cleaning mode ${mode}: raw 4.23=${rawValue}`
      + ` (${this.cleaningModeCodec.usesLiftingMopEncoding ? 'lifting-mop encoding' : 'standard encoding'})`,
    );
    await this.requireCloud().setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: rawValue },
    ]);
  }

  private assertDreameActionSucceeded(actionName: string, result: unknown): void {
    if (!result || typeof result !== 'object') return;

    const code = (result as { code?: unknown }).code;
    if (typeof code === 'number' && code !== 0) {
      throw new Error(`${actionName} returned Dreame code ${code}`);
    }
  }
}
