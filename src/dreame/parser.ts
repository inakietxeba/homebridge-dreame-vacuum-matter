import { Logger } from '../util/logger.js';
import {
  NormalizedState,
  DREAME_STATE,
  DREAME_CHARGE_STATUS,
  DREAME_MAINTENANCE_TYPE,
  DREAME_PAUSED_STATES,
  SuctionLevel,
  WaterLevel,
} from './models.js';
import { DreameCleaningModeCodec } from './cleaning-mode.js';

/**
 * Parses Dreame device properties (siid/piid pairs) into a NormalizedState.
 * Property mappings are based on the MIoT spec used by Dreame devices.
 */
export class StateParser {
  constructor(
    private readonly log: Logger,
    private readonly cleaningModeCodec = new DreameCleaningModeCodec(),
  ) {}

  /**
   * Process an array of property updates and return a new NormalizedState.
   */
  processProperties(
    properties: Array<{ siid: number; piid: number; value: unknown }>,
    currentState: NormalizedState,
  ): NormalizedState {
    const state = structuredClone(currentState);
    let rawDeviceState: number | undefined;
    let rawCleaningMode: number | undefined;

    for (const prop of properties) {
      if (prop.siid === 2 && prop.piid === 1 && typeof prop.value === 'number') {
        rawDeviceState = prop.value;
      }
      if (prop.siid === 4 && prop.piid === 23 && typeof prop.value === 'number') {
        rawCleaningMode = prop.value;
      }
    }

    const previousLiftingMopEncoding = this.cleaningModeCodec.usesLiftingMopEncoding;
    this.cleaningModeCodec.observeLiveState(rawDeviceState, rawCleaningMode);
    if (previousLiftingMopEncoding !== this.cleaningModeCodec.usesLiftingMopEncoding) {
      this.log.debug(
        `Dreame cleaning-mode encoding learned from live state: `
        + `${this.cleaningModeCodec.usesLiftingMopEncoding ? 'lifting-mop' : 'standard'} `
        + `(state=${rawDeviceState}, raw 4.23=${rawCleaningMode})`,
      );
    }

    for (const prop of properties) {
      this.applyProperty(state, prop.siid, prop.piid, prop.value);
    }

    this.normalizeCombinedState(state, rawDeviceState);

    return state;
  }

  private normalizeCombinedState(state: NormalizedState, rawDeviceState: number | undefined): void {
    if (rawDeviceState === 1) state.activity.cleanMode = 'SWEEP';
    if (rawDeviceState === 7) state.activity.cleanMode = 'MOP';
    if (rawDeviceState === 12) state.activity.cleanMode = 'SWEEP_AND_MOP';

    if (rawDeviceState === 29) {
      state.activity.runMode = 'idle';
      state.activity.paused = false;
      state.power.docked = true;
    }
  }

  private applyProperty(state: NormalizedState, siid: number, piid: number, value: unknown): void {
    switch (siid) {
      case 2: // Device state
        this.applyDeviceState(state, piid, value);
        break;
      case 3: // Battery
        this.applyBatteryState(state, piid, value);
        break;
      case 4: // Vacuum settings
        this.applyVacuumSettings(state, piid, value);
        break;
      default:
        break;
    }
  }

  private applyDeviceState(state: NormalizedState, piid: number, value: unknown): void {
    switch (piid) {
      case 1: { // State
        const numValue = value as number;
        const runMode = DREAME_STATE[numValue];
        if (runMode) {
          state.activity.rawDeviceState = numValue;
          state.activity.runMode = runMode;
          state.activity.paused = DREAME_PAUSED_STATES.has(numValue);
          // Clear error if no longer in error state
          if (runMode !== 'error') {
            state.activity.activeError = null;
            state.activity.activeErrorCode = undefined;
          }
          // Maintenance sub-type
          state.activity.maintenanceType = DREAME_MAINTENANCE_TYPE[numValue];
          // Docked states
          const dockedStates = [2, 6, 9, 13, 21, 22, 24, 29, 30, 32, 33, 34, 35, 36, 105, 106];
          if (dockedStates.includes(numValue)) {
            state.power.docked = true;
          }
        }
        break;
      }
      case 2: { // Error code
        const errorCode = value as number;
        if (errorCode !== 0 && state.activity.runMode === 'error') {
          state.activity.activeError = `Error ${errorCode}`;
          state.activity.activeErrorCode = errorCode;
        } else {
          state.activity.activeError = null;
          state.activity.activeErrorCode = undefined;
        }
        break;
      }
    }
  }

  private applyBatteryState(state: NormalizedState, piid: number, value: unknown): void {
    switch (piid) {
      case 1: // Battery level
        state.power.batteryPercent = Math.max(0, Math.min(100, value as number));
        break;
      case 2: { // Charge status
        const chargeInfo = DREAME_CHARGE_STATUS[value as number];
        if (chargeInfo) {
          state.power.charging = chargeInfo.charging;
          state.power.docked = chargeInfo.docked;
        }
        break;
      }
    }
  }

  private applyVacuumSettings(state: NormalizedState, piid: number, value: unknown): void {
    switch (piid) {
      case 1: // Cleaning status (additional state info)
        break;
      case 4: { // Suction level
        const level = value as number;
        if (level >= 0 && level <= 3) {
          state.activity.suctionLevel = level as SuctionLevel;
        }
        break;
      }
      case 5: { // Water level
        const wLevel = value as number;
        if (wLevel >= 1 && wLevel <= 3) {
          state.activity.waterLevel = wLevel as WaterLevel;
        }
        break;
      }
      case 23: { // Cleaning mode
        const rawMode = value as number;
        const mode = this.cleaningModeCodec.decode(rawMode);
        if (mode) {
          state.activity.cleanMode = mode;
        }
        // Unknown mode values (e.g. 5120 on newer models) — keep current cleanMode unchanged
        break;
      }
    }
  }
}
