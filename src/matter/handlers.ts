import { CommandBuilder } from '../dreame/commands';
import { Logger } from '../util/logger';
import { CleaningMode } from '../config';

export class MatterCommandHandlers {
  private pauseSuppressionUntil = 0;
  private currentCleanMode: CleaningMode;
  private modeCommandSentUntil = 0;
  private onCleanModeSelected?: (mode: CleaningMode) => void;

  constructor(
    private readonly commandBuilder: CommandBuilder,
    private readonly log: Logger,
    defaultCleanMode: CleaningMode = 'SWEEP_AND_MOP',
  ) {
    this.currentCleanMode = defaultCleanMode;
  }

  public setOnCleanModeSelected(callback: (mode: CleaningMode) => void): void {
    this.onCleanModeSelected = callback;
  }

  public isCleanModeSuppressionActive(): boolean {
    return Date.now() < this.modeCommandSentUntil;
  }

  public resolveCleanModeForState(candidate: CleaningMode): CleaningMode {
    return this.isCleanModeSuppressionActive() ? this.currentCleanMode : candidate;
  }

  public async handleStartCommand(isPaused = false): Promise<void> {
    this.log.info('Handling Matter Start Command...');
    this.suppressPauseForCommandSequence();

    // Set cleaning mode first
    await this.commandBuilder.setCleaningMode(this.currentCleanMode);
    this.modeCommandSentUntil = Date.now() + 10_000;

    if (isPaused) {
      // Resume is just start on Dreame
      this.log.debug('Robot is paused — sending START');
    }

    await this.commandBuilder.startCleaning();
    this.log.debug('START_CLEANING sent successfully');
  }

  public async handleStopCommand(): Promise<void> {
    this.log.info('Handling Matter Stop Command...');
    await this.commandBuilder.stopCleaning();
  }

  public async handlePauseCommand(): Promise<void> {
    if (Date.now() < this.pauseSuppressionUntil) return;
    await this.commandBuilder.pauseCleaning();
  }

  public async handleResumeCommand(): Promise<void> {
    this.suppressPauseForCommandSequence();
    await this.commandBuilder.startCleaning();
  }

  public async handleGoHomeCommand(): Promise<void> {
    this.log.info('Handling Matter Go Home Command...');
    this.suppressPauseForCommandSequence();
    await this.commandBuilder.returnToDock();
  }

  public async handleCleaningMode(mode: CleaningMode): Promise<void> {
    this.currentCleanMode = mode;
    this.modeCommandSentUntil = Date.now() + 10_000;
    this.log.debug(`User selected cleaning mode: ${mode} — suppressing device echo for 10s`);

    try {
      this.onCleanModeSelected?.(mode);
    } catch (error: unknown) {
      this.log.warn(`onCleanModeSelected callback threw: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.commandBuilder.setCleaningMode(mode);
  }

  public async handleSuctionLevel(level: 0 | 1 | 2 | 3): Promise<void> {
    await this.commandBuilder.setSuctionLevel(level);
  }

  public async handleWaterLevel(level: 1 | 2 | 3): Promise<void> {
    await this.commandBuilder.setWaterLevel(level);
  }

  public syncCleanModeFromDevice(mode: CleaningMode): void {
    if (Date.now() < this.modeCommandSentUntil) {
      this.log.debug(`Ignoring device-reported mode ${mode} (echo suppression active)`);
      return;
    }
    this.currentCleanMode = mode;
  }

  private suppressPauseForCommandSequence(durationMs = 8000): void {
    this.pauseSuppressionUntil = Date.now() + durationMs;
  }
}
