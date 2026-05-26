import { Logger } from '../util/logger.js';
import {
  NormalizedState,
  DREAME_STATE,
  DREAME_CLEAN_MODE,
  DREAME_CHARGE_STATUS,
  DREAME_MAINTENANCE_TYPE,
  SuctionLevel,
  WaterLevel,
} from './models.js';

/**
 * Parses Dreame device properties (siid/piid pairs) into a NormalizedState.
 * Property mappings are based on the MIoT spec used by Dreame devices.
 */
export class StateParser {
  constructor(private readonly log: Logger) {}

  /**
   * Process an array of property updates and return a new NormalizedState.
   */
  processProperties(
    properties: Array<{ siid: number; piid: number; value: unknown }>,
    currentState: NormalizedState,
  ): NormalizedState {
    const state = structuredClone(currentState);

    for (const prop of properties) {
      this.applyProperty(state, prop.siid, prop.piid, prop.value);
    }

    return state;
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
          state.activity.runMode = runMode;
          state.activity.paused = numValue === 3;
          // Clear error if no longer in error state
          if (runMode !== 'error') {
            state.activity.activeError = null;
            state.activity.activeErrorCode = undefined;
          }
          // Maintenance sub-type
          state.activity.maintenanceType = DREAME_MAINTENANCE_TYPE[numValue];
          if (numValue === 1) state.activity.cleanMode = 'SWEEP';
          if (numValue === 7) state.activity.cleanMode = 'MOP';
          if (numValue === 12) state.activity.cleanMode = 'SWEEP_AND_MOP';
          // Docked states
          const dockedStates = [2, 6, 9, 13]; // idle, charging, washing, charge complete
          if (dockedStates.includes(numValue)) {
            state.power.docked = true;
          }
        }
        break;
      }
      case 2: { // Error code
        const errorCode = value as number;
        if (errorCode !== 0) {
          state.activity.activeError = `Error ${errorCode}`;
          state.activity.activeErrorCode = errorCode;
          state.activity.runMode = 'error';
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
        const mode = DREAME_CLEAN_MODE[rawMode];
        if (mode) {
          state.activity.cleanMode = mode;
        }
        // Unknown mode values (e.g. 5120 on newer models) — keep current cleanMode unchanged
        break;
      }
    }
  }
}
