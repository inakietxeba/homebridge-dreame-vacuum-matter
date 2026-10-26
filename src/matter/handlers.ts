import { DreameCloud } from '../dreame/cloud.js';
import { Logger } from '../util/logger.js';
import { CleaningMode, CleaningProfile } from '../config.js';
import { DREAME_STATUS, MIOT, SuctionLevel, WaterLevel } from '../dreame/models.js';
import { DreameCleaningModeCodec } from '../dreame/cleaning-mode.js';
import { DreameAreaTarget } from './clusters.js';
import { DreameCapabilities } from '../dreame/capabilities.js';

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
  private currentCleanMode: CleaningMode;
  private currentCleaningProfile?: CleaningProfile;
  private onCleaningProfileSelected?: (profile: CleaningProfile, mode: CleaningMode) => void;
  private readonly modeSuppression = new TemporalSuppression();
  private onCleanModeSelected?: (mode: CleaningMode) => void;
  private onAreaSelectionChanged?: (areaIds: string[]) => void;
  private pendingAreas: DreameAreaTarget[] | null = null;
  private areaIdToRoomTargetMap = new Map<number, DreameAreaTarget>();
  private currentMapId: number | undefined;
  private mapStateProvider?: () => Promise<number | undefined>;
  private capabilities?: DreameCapabilities;
  private cleaningSelectionExplicit = false;

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

  public syncCapabilities(capabilities: DreameCapabilities): void {
    this.capabilities = { ...capabilities };
  }

  private requireCloud(): DreameCloud {
    if (!this.cloud) throw new Error('Cloud connection not available yet');
    return this.cloud;
  }

  public setOnCleanModeSelected(callback: (mode: CleaningMode) => void): void {
    this.onCleanModeSelected = callback;
  }

  public setOnCleaningProfileSelected(callback: (profile: CleaningProfile, mode: CleaningMode) => void): void {
    this.onCleaningProfileSelected = callback;
  }

  public resolveCleaningProfileForState(candidate: CleaningProfile | undefined): CleaningProfile | undefined {
    if (!this.modeSuppression.isActive) this.currentCleaningProfile = candidate;
    return this.currentCleaningProfile;
  }

  public setOnAreaSelectionChanged(callback: (areaIds: string[]) => void): void {
    this.onAreaSelectionChanged = callback;
  }

  public setAreaIdToRoomTargetMap(map: Map<number, DreameAreaTarget>): void {
    this.areaIdToRoomTargetMap = new Map(map);
    this.log.debug(
      this.areaIdToRoomTargetMap.size > 0
        ? `Matter ServiceArea mapping loaded: ${[...this.areaIdToRoomTargetMap.values()]
          .map(({ areaId, mapId, segmentId }) => `${areaId}->map:${mapId ?? 'unknown'}/segment:${segmentId}`)
          .join(', ')}`
        : 'Matter ServiceArea mapping cleared or empty',
    );
  }

  public syncCurrentMapId(mapId: number | undefined): void {
    this.currentMapId = mapId;
  }

  public setMapStateProvider(provider: () => Promise<number | undefined>): void {
    this.mapStateProvider = provider;
  }

  public isCleanModeSuppressionActive(): boolean {
    return this.modeSuppression.isActive;
  }

  public resolveCleanModeForState(candidate: CleaningMode): CleaningMode {
    if (this.currentCleaningProfile === 'AUTO') return candidate;
    return this.isCleanModeSuppressionActive() ? this.currentCleanMode : candidate;
  }

  public async handleStartCommand(isPaused = false): Promise<void> {
    this.log.info('Handling Matter Start Command...');

    if (isPaused) {
      this.log.debug('Robot is paused — sending START');
      await this.handleResumeCommand();
      return;
    }

    const areasToClean = this.pendingAreas;
    if (areasToClean && areasToClean.length > 0) {
      await this.ensureAreasMapActive(areasToClean);
      await this.prepareCleaningTask();
      // Segment payloads carry suction and water levels, but not the cleaning mode.
      this.modeSuppression.suppress(10_000);
      const segmentIds = areasToClean.map((area) => Number.parseInt(area.segmentId, 10));
      const selects = segmentIds.map((segmentId, index) => [
        segmentId,
        1, // repeat count
        this.getCurrentSuctionLevel(),
        this.getCurrentWaterLevel(),
        this.capabilities?.customizedCleaningSupported === false && this.capabilities.gen5 === false ? index + 1 : 1,
      ]);
      const payload = { selects };
      const targetMapId = areasToClean[0]?.mapId ?? null;
      this.log.debug(
        `Starting Dreame segment cleaning: map=${targetMapId ?? 'unknown'}, segments=[${segmentIds.join(', ')}]`,
      );
      this.log.debug(`Sending Dreame START_CUSTOM segment payload: ${JSON.stringify(payload)}`);
      const result = await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.VACUUM.START_CUSTOM, [
        { piid: MIOT.VACUUM.STATUS, value: DREAME_STATUS.SEGMENT_CLEANING },
        {
          piid: MIOT.VACUUM.CLEANING_PROPERTIES,
          value: JSON.stringify(payload),
        },
      ]);
      this.assertDreameActionSucceeded('START_CUSTOM', result);
      this.log.debug(`Room clean sent for segments [${segmentIds.join(', ')}]`);
      return;
    }

    await this.prepareCleaningTask();
    this.modeSuppression.suppress(10_000);
    const result = await this.requireCloud().action(this.deviceId, MIOT.STATE.siid, MIOT.STATE.START);
    this.assertDreameActionSucceeded('START', result);
    this.log.debug('START_CLEANING sent successfully');
  }

  public async handleAreaSelection(areaIds: number[]): Promise<void> {
    this.log.debug(`Matter ServiceArea SelectAreas received: [${areaIds.join(', ')}]`);
    const areas: DreameAreaTarget[] = [];
    for (const areaId of areaIds) {
      const target = this.areaIdToRoomTargetMap.get(areaId);
      if (!target) {
        throw new Error(`Matter area ${areaId} is not mapped to a Dreame room`);
      }
      const segmentId = Number.parseInt(target.segmentId, 10);
      if (Number.isFinite(segmentId) && segmentId > 0) {
        areas.push(target);
      } else {
        throw new Error(`Dreame segment "${target.segmentId}" for Matter area ${areaId} is not numeric`);
      }
    }
    this.assertAreasShareMap(areas);
    this.pendingAreas = areas.length > 0 ? [...areas] : null;
    this.notifyAreaSelectionChanged(areaIds);
    this.log.debug(
      areas.length > 0
        ? `Area selection set for next start: ${areas.map((area) => `map:${area.mapId ?? 'unknown'}/segment:${area.segmentId}`).join(', ')}`
        : 'Area selection cleared — next start will auto-clean.',
    );
  }

  public async handleSkipArea(areaId: number | undefined): Promise<void> {
    const target = areaId === undefined ? undefined : this.areaIdToRoomTargetMap.get(areaId);
    const description = target
      ? `map:${target.mapId ?? 'unknown'}/segment:${target.segmentId}`
      : `Matter area ${areaId ?? 'unknown'}`;
    this.log.warn(`Cannot skip ${description}: Dreame does not expose a safe command to skip only the active room`);
    throw new Error('Skipping an active room is not supported by the Dreame API');
  }

  /** Convenience entry point for room IDs when no Matter map metadata is available. */
  public async handleRoomSelection(roomIds: number[]): Promise<void> {
    this.pendingAreas = roomIds.length > 0
      ? roomIds.map((segmentId) => ({ areaId: segmentId, mapId: null, segmentId: String(segmentId) }))
      : null;
    this.notifyAreaSelectionChanged(roomIds);
    this.log.debug(
      roomIds.length > 0
        ? `Room selection set for next start: [${roomIds.join(', ')}]`
        : 'Room selection cleared — next start will auto-clean.',
    );
  }

  private notifyAreaSelectionChanged(areaIds: number[]): void {
    try {
      this.onAreaSelectionChanged?.(areaIds.map(String));
    } catch (err: unknown) {
      this.log.warn(`Failed to apply area selection to accessory state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private assertAreasShareMap(areas: DreameAreaTarget[]): void {
    const mapIds = new Set(areas.map((area) => area.mapId).filter((mapId): mapId is number => mapId !== null));
    if (mapIds.size > 1) {
      throw new Error(`Dreame cannot clean rooms from multiple maps in one task: [${[...mapIds].join(', ')}]`);
    }
  }

  private async ensureAreasMapActive(areas: DreameAreaTarget[]): Promise<void> {
    this.assertAreasShareMap(areas);
    const targetMapId = areas.find((area) => area.mapId !== null)?.mapId;
    if (targetMapId === undefined || targetMapId === null) return;
    if (this.mapStateProvider) {
      this.currentMapId = await this.mapStateProvider();
      if (this.currentMapId === targetMapId) return;
      this.log.info(`Selecting Dreame map ${targetMapId} before room cleaning`);
      const result = await this.requireCloud().action(this.deviceId, MIOT.MAP.siid, MIOT.MAP.UPDATE_MAP_DATA, [
        { piid: MIOT.MAP.MAP_EXTEND_DATA, value: JSON.stringify({ sm: {}, mapid: targetMapId }) },
      ]);
      this.assertDreameActionSucceeded('SELECT_MAP', result);
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
        this.currentMapId = await this.mapStateProvider();
        if (this.currentMapId === targetMapId) return;
      }
      throw new Error(`Dreame map ${targetMapId} was not confirmed active; room cleaning was not started`);
    }
    if (targetMapId !== undefined && targetMapId !== null && this.currentMapId !== undefined && targetMapId !== this.currentMapId) {
      throw new Error(`Selected rooms belong to Dreame map ${targetMapId}, but current map is ${this.currentMapId}`);
    }
  }

  /** Returns current suction level (used in room clean params). Default: 1 (Standard). */
  private getCurrentSuctionLevel(): number { return this._suctionLevel; }
  /** Returns current water level (used in room clean params). Default: 2 (Medium). */
  private getCurrentWaterLevel(): number { return this._waterLevel; }
  private _suctionLevel = 1;
  private _waterLevel = 2;

  public async handleStopCommand(): Promise<void> {
    this.log.info('Handling Matter Stop Command...');
    const result = await this.requireCloud().action(this.deviceId, MIOT.VACUUM.siid, MIOT.VACUUM.STOP);
    this.assertDreameActionSucceeded('STOP', result);
  }

  public async handlePauseCommand(): Promise<void> {
    const result = await this.requireCloud().action(this.deviceId, MIOT.STATE.siid, MIOT.STATE.PAUSE);
    this.assertDreameActionSucceeded('PAUSE', result);
  }

  public async handleResumeCommand(): Promise<void> {
    const result = await this.requireCloud().action(this.deviceId, MIOT.STATE.siid, MIOT.STATE.START);
    this.assertDreameActionSucceeded('START', result);
  }

  public async handleGoHomeCommand(): Promise<void> {
    this.log.info('Handling Go Home Command...');
    const result = await this.requireCloud().action(this.deviceId, MIOT.CHARGE.siid, MIOT.CHARGE.DOCK);
    this.assertDreameActionSucceeded('DOCK', result);
    this.log.debug('DOCK sent successfully');
  }

  public async handleLocateCommand(): Promise<void> {
    this.log.info('Handling Matter Identify Command...');
    try {
      const result = await this.requireCloud().action(this.deviceId, MIOT.LOCATE.siid, MIOT.LOCATE.LOCATE);
      this.assertDreameActionSucceeded('LOCATE', result);
      this.log.debug('LOCATE sent successfully');
    } catch (err: unknown) {
      this.log.warn(`Dreame locate action failed or is unsupported by this model: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async handleCleaningMode(mode: CleaningMode): Promise<void> {
    await this.setCleanGenius(0);
    await this.setCleaningMode(mode);
    this.cleaningSelectionExplicit = true;
    this.currentCleaningProfile = undefined;
    this.currentCleanMode = mode;
    this.modeSuppression.suppress(10_000);
    this.log.debug(`User selected cleaning mode: ${mode} — suppressing device echo for 10s`);

    try {
      this.onCleanModeSelected?.(mode);
    } catch (error: unknown) {
      this.log.warn(`onCleanModeSelected callback threw: ${error instanceof Error ? error.message : String(error)}`);
    }

  }

  public async handleCleaningProfile(profile: CleaningProfile, mode: CleaningMode = 'SWEEP'): Promise<void> {
    if (profile === 'AUTO') {
      if (this.capabilities?.cleanGenius === false) {
        await this.setCleaningMode('SWEEP_AND_MOP');
        await this.handleSuctionLevel(1);
      } else await this.setCleanGenius(1);
      this.currentCleanMode = 'SWEEP_AND_MOP';
    } else {
      await this.setCleanGenius(0);
      await this.setCleaningMode(mode);
      await this.handleSuctionLevel(profile === 'QUIET' ? 0 : 1);
      this.currentCleanMode = mode;
    }
    this.currentCleaningProfile = profile;
    this.cleaningSelectionExplicit = true;
    this.modeSuppression.suppress(10_000);
    this.onCleaningProfileSelected?.(profile, this.currentCleanMode);
  }

  public async handleSuctionLevel(level: 0 | 1 | 2 | 3): Promise<void> {
    const result = await this.requireCloud().setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.SUCTION, value: level },
    ]);
    this.assertPropertyWriteSucceeded('SUCTION', result);
    this._suctionLevel = level;
  }

  public async handleWaterLevel(level: 1 | 2 | 3): Promise<void> {
    const result = await this.requireCloud().setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.WATER, value: level },
    ]);
    this.assertPropertyWriteSucceeded('WATER', result);
    this._waterLevel = level;
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

  private async setCleaningMode(mode: CleaningMode): Promise<void> {
    if (this.capabilities?.cleaningModeSupported === false) {
      throw new Error('Changing cleaning mode is not supported by this robot');
    }
    const tank = this.capabilities?.waterTankInstalled;
    if (tank === false && mode !== 'SWEEP') throw new Error('Install the water tank or mop before selecting mopping');
    if (tank === true && mode === 'SWEEP' && this.capabilities?.liftingMopPads === false) {
      throw new Error('Remove the water tank or mop before selecting vacuum-only on this robot');
    }
    const rawValue = this.cleaningModeCodec.encode(mode);
    this.log.debug(
      `Setting Dreame cleaning mode ${mode}: raw 4.23=${rawValue}`
      + ` (${this.cleaningModeCodec.usesLiftingMopEncoding ? 'lifting-mop encoding' : 'standard encoding'})`,
    );
    const result = await this.requireCloud().setProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: rawValue },
    ]);
    this.assertPropertyWriteSucceeded('CLEAN_MODE', result);
  }

  private async readCleanGenius(): Promise<number | undefined> {
    const properties = await this.requireCloud().getProperties(this.deviceId, [
      { did: this.deviceId, siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.AUTO_SWITCH_SETTINGS },
    ]);
    const property = properties.find((entry) => entry.siid === MIOT.VACUUM.siid
      && entry.piid === MIOT.VACUUM.AUTO_SWITCH_SETTINGS);
    if (!property || (property.code !== undefined && property.code !== 0) || property.value === undefined) {
      return undefined;
    }
    const settings: unknown = typeof property.value === 'string' ? JSON.parse(property.value) : property.value;
    if (!Array.isArray(settings)) throw new Error('Invalid Dreame auto-switch settings');
    const setting = settings.find((entry: unknown): entry is { k: string; v: number } =>
      typeof entry === 'object' && entry !== null && 'k' in entry && entry.k === 'SmartHost'
      && 'v' in entry && typeof entry.v === 'number');
    return setting?.v;
  }

  private async prepareCleaningTask(): Promise<void> {
    // Like HA's basic Start, keep app settings unless a controller selected a mode.
    if (this.capabilities && !this.cleaningSelectionExplicit) return;
    if (this.currentCleaningProfile === 'AUTO' && this.capabilities?.cleanGenius !== false) {
      await this.setCleanGenius(1);
      return;
    }
    await this.setCleanGenius(0);
    await this.setCleaningMode(this.currentCleanMode);
    if (this.currentCleaningProfile === 'QUIET') await this.handleSuctionLevel(0);
    if (this.currentCleaningProfile === 'NORMAL' || this.currentCleaningProfile === 'AUTO') await this.handleSuctionLevel(1);
  }

  private async setCleanGenius(value: 0 | 1): Promise<void> {
    if (this.capabilities?.cleanGenius === false) {
      if (value === 1) throw new Error('CleanGenius is not supported by this robot');
      return;
    }
    const cleanGenius = await this.readCleanGenius();
    if (cleanGenius === undefined) {
      if (value === 1) throw new Error('CleanGenius is not supported by this robot');
      return;
    }
    if (value === 1 ? cleanGenius > 0 : cleanGenius === 0) return;

    this.log.info(value === 1 ? 'Enabling CleanGenius for Auto cleaning' : 'Disabling CleanGenius for manual cleaning');
    const result = await this.requireCloud().setProperties(this.deviceId, [
      {
        did: this.deviceId,
        siid: MIOT.VACUUM.siid,
        piid: MIOT.VACUUM.AUTO_SWITCH_SETTINGS,
        value: JSON.stringify({ k: 'SmartHost', v: value }),
      },
    ]);
    this.assertPropertyWriteSucceeded('SmartHost', result);
    // An accepted cloud write can precede the actual device update.
    for (let attempt = 0; attempt < 5; attempt++) {
      const confirmed = await this.readCleanGenius();
      if (confirmed !== undefined && (value === 1 ? confirmed > 0 : confirmed === 0)) return;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(value === 0 ? 'CleanGenius is still active; cleaning was not started' : 'CleanGenius activation was not confirmed');
  }

  private assertPropertyWriteSucceeded(name: string, result: unknown): void {
    if (Array.isArray(result) && result.length === 0) throw new Error(`${name} returned an empty Dreame response`);
    for (const entry of Array.isArray(result) ? result : [result]) {
      this.assertDreameActionSucceeded(name, entry);
    }
  }

  private assertDreameActionSucceeded(actionName: string, result: unknown): void {
    if (!result || typeof result !== 'object') throw new Error(`${actionName} returned an invalid Dreame response`);

    const code = (result as { code?: unknown }).code;
    if (typeof code !== 'number') throw new Error(`${actionName} returned no Dreame status code`);
    if (code !== 0) {
      throw new Error(`${actionName} returned Dreame code ${code}`);
    }
  }
}
