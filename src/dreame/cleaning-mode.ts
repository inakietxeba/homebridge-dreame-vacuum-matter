import { CleaningMode } from '../config.js';
import { DREAME_CLEAN_MODE } from './models.js';

const STANDARD_MODE_TO_VALUE: Record<CleaningMode, number> = {
  SWEEP: 0,
  MOP: 1,
  SWEEP_AND_MOP: 2,
};

const LIFTING_MOP_MODE_TO_VALUE: Record<CleaningMode, number> = {
  SWEEP: 2,
  MOP: 1,
  SWEEP_AND_MOP: 0,
};

/**
 * Dreame reuses cleaning-mode property 4.23 with different encodings.
 * Models with lifting mop pads swap the raw values for sweep and combined
 * cleaning, and may pack additional settings into the upper bits.
 */
export class DreameCleaningModeCodec {
  private liftingMopPads = false;
  private lastRawValue: number | undefined;

  public configureLiftingMopPads(enabled: boolean): void {
    this.liftingMopPads = enabled;
  }

  public get usesLiftingMopEncoding(): boolean {
    return this.liftingMopPads;
  }

  /**
   * Learn the encoding from an unambiguous live cleaning state. Dreame state
   * 1 means sweep and state 12 means sweep-and-mop across supported models.
   */
  public observeLiveState(rawDeviceState: number | undefined, rawMode: number | undefined): void {
    if (rawDeviceState === undefined || rawMode === undefined) return;

    const modeBits = rawMode & 0x03;
    if ((rawDeviceState === 1 && modeBits === 2) || (rawDeviceState === 12 && modeBits === 0)) {
      this.liftingMopPads = true;
    } else if ((rawDeviceState === 1 && modeBits === 0) || (rawDeviceState === 12 && modeBits === 2)) {
      this.liftingMopPads = false;
    }
  }

  public decode(rawValue: number): CleaningMode | undefined {
    this.lastRawValue = rawValue;
    if (!this.liftingMopPads) {
      return DREAME_CLEAN_MODE[rawValue];
    }

    switch (rawValue & 0x03) {
      case 2: return 'SWEEP';
      case 1: return 'MOP';
      case 0: return 'SWEEP_AND_MOP';
      default: return undefined;
    }
  }

  public encode(mode: CleaningMode): number {
    const modeValue = this.liftingMopPads
      ? LIFTING_MOP_MODE_TO_VALUE[mode]
      : STANDARD_MODE_TO_VALUE[mode];

    if (!this.liftingMopPads || this.lastRawValue === undefined) {
      return modeValue;
    }

    return (this.lastRawValue & ~0x03) | modeValue;
  }
}
