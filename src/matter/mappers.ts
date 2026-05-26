import { NormalizedState, PowerState, MaintenanceType } from '../dreame/models.js';
import { CleaningMode } from '../config.js';

export enum MatterOperationalState {
  STOPPED = 0x00,
  RUNNING = 0x01,
  PAUSED = 0x02,
  ERROR = 0x03,
  SEEKING_CHARGER = 0x40,
  CHARGING = 0x41,
  DOCKED = 0x42,
  // Matter 1.4.2 maintenance states
  EMPTYING_DUST_BIN = 0x43,
  CLEANING_MOP = 0x44,
  FILLING_WATER_TANK = 0x45,
  UPDATING_MAPS = 0x46,
}

export enum MatterRvcRunMode {
  IDLE = 0x00,
  CLEANING = 0x01,
  RETURNING_HOME = 0x02,
  MAPPING = 0x03,
}

export enum MatterChargeState {
  UNKNOWN = 0x00,
  IS_NOT_CHARGING = 0x01,
  IS_AT_MAX_CHARGE = 0x02,
  IS_CHARGING = 0x03,
}

export enum MatterRvcCleanMode {
  SWEEP = 0x00,
  MOP = 0x01,
  SWEEP_AND_MOP = 0x02,
}

export enum MatterRvcCleanModeTag {
  VACUUM = 0x4001,
  MOP = 0x4002,
  VACUUM_THEN_MOP = 0x4003,
}

export enum MatterRvcRunModeTag {
  IDLE = 0x4000,
  CLEANING = 0x4001,
  MAPPING = 0x4002,
}

export enum MatterOperationalErrorState {
  NO_ERROR = 0x00,
  STUCK = 0x41,
  DUST_BIN_MISSING = 0x42,
  WATER_TANK_EMPTY = 0x43,
  WATER_TANK_MISSING = 0x44,
  MOP_CLEANING_PAD_MISSING = 0x45,
  UNABLE_TO_START_OR_RESUME = 0x47,
  FAILED_TO_FIND_CHARGING_DOCK = 0x48,
}

/** Matter PowerSource BatChargeLevel. */
export enum MatterBatChargeLevel {
  OK = 0x00,
  WARNING = 0x01,
  CRITICAL = 0x02,
}

/** Matter PowerSource BatReplaceability. */
export enum MatterBatReplaceability {
  UNSPECIFIED = 0x00,
  NOT_REPLACEABLE = 0x01,
  USER_REPLACEABLE = 0x02,
  FACTORY_REPLACEABLE = 0x03,
}

/**
 * Maps Dreame error codes to Matter RVC error states.
 * Dreame error codes come from siid 2, piid 2.
 * Source: Home Assistant Dreame Vacuum integration (120+ codes).
 */
const ERROR_CODE_TO_MATTER: Record<number, MatterOperationalErrorState> = {
  // ── STUCK / physically trapped ────────────────────────────────────────
  1: MatterOperationalErrorState.STUCK,      // Wheels suspended (DROP)
  2: MatterOperationalErrorState.STUCK,      // Cliff sensor error
  3: MatterOperationalErrorState.STUCK,      // Collision sensor stuck (BUMPER)
  4: MatterOperationalErrorState.STUCK,      // Robot tilted (GESTURE)
  5: MatterOperationalErrorState.STUCK,      // Bumper repeat
  6: MatterOperationalErrorState.STUCK,      // Drop repeat
  7: MatterOperationalErrorState.STUCK,      // Optical flow sensor error
  15: MatterOperationalErrorState.STUCK,     // Left wheel motor blocked
  16: MatterOperationalErrorState.STUCK,     // Right wheel motor blocked
  17: MatterOperationalErrorState.STUCK,     // Cannot turn (TURN_SUFFOCATE)
  18: MatterOperationalErrorState.STUCK,     // Cannot go forward (FORWARD_SUFFOCATE)
  31: MatterOperationalErrorState.STUCK,     // Left wheel foreign objects
  32: MatterOperationalErrorState.STUCK,     // Right wheel foreign objects
  41: MatterOperationalErrorState.STUCK,     // Strong magnetic field
  47: MatterOperationalErrorState.STUCK,     // Route blocked, returning
  61: MatterOperationalErrorState.STUCK,     // Route blocked
  62: MatterOperationalErrorState.STUCK,     // Route blocked (variant)
  63: MatterOperationalErrorState.STUCK,     // Route blocked (variant)
  64: MatterOperationalErrorState.STUCK,     // Route blocked (variant)
  65: MatterOperationalErrorState.STUCK,     // Restricted area
  66: MatterOperationalErrorState.STUCK,     // Restricted area (variant)
  67: MatterOperationalErrorState.STUCK,     // Restricted area (variant)
  80: MatterOperationalErrorState.STUCK,     // LDS cannot be raised
  81: MatterOperationalErrorState.STUCK,     // Move to open area
  82: MatterOperationalErrorState.STUCK,     // Slippery floor
  88: MatterOperationalErrorState.STUCK,     // Retractable leg stuck
  90: MatterOperationalErrorState.STUCK,     // LDS positioning error
  91: MatterOperationalErrorState.STUCK,     // Stuck among tables
  92: MatterOperationalErrorState.STUCK,     // Stuck in narrow passage
  93: MatterOperationalErrorState.STUCK,     // Stuck at threshold
  94: MatterOperationalErrorState.STUCK,     // Stuck in low-clearance area
  95: MatterOperationalErrorState.STUCK,     // Detected fall ramp
  96: MatterOperationalErrorState.STUCK,     // Obstacles on path
  97: MatterOperationalErrorState.STUCK,     // People/pets on path
  98: MatterOperationalErrorState.STUCK,     // Stuck due to slipping
  99: MatterOperationalErrorState.STUCK,     // Slips on carpet
  200: MatterOperationalErrorState.STUCK,    // Slips in curtain area
  226: MatterOperationalErrorState.STUCK,    // Blocked by obstacle

  // ── DUST_BIN_MISSING ──────────────────────────────────────────────────
  8: MatterOperationalErrorState.DUST_BIN_MISSING,    // Dustbin not installed
  101: MatterOperationalErrorState.DUST_BIN_MISSING,  // Dust bag full or duct blocked
  102: MatterOperationalErrorState.DUST_BIN_MISSING,  // Cover not closed or bag missing
  104: MatterOperationalErrorState.DUST_BIN_MISSING,  // Dust bag full
  121: MatterOperationalErrorState.DUST_BIN_MISSING,  // Dust bag full or vents blocked

  // ── WATER_TANK_MISSING ────────────────────────────────────────────────
  9: MatterOperationalErrorState.WATER_TANK_MISSING,    // Water tank not installed
  76: MatterOperationalErrorState.WATER_TANK_MISSING,   // Dirty tank not installed
  105: MatterOperationalErrorState.WATER_TANK_MISSING,  // Clean water tank missing
  106: MatterOperationalErrorState.WATER_TANK_MISSING,  // Dirty water tank full/missing
  109: MatterOperationalErrorState.WATER_TANK_MISSING,  // Dirty tank blocked
  110: MatterOperationalErrorState.WATER_TANK_MISSING,  // Dirty tank pump error

  // ── WATER_TANK_EMPTY ──────────────────────────────────────────────────
  10: MatterOperationalErrorState.WATER_TANK_EMPTY,    // Water tank empty
  107: MatterOperationalErrorState.WATER_TANK_EMPTY,   // Low water in clean tank
  116: MatterOperationalErrorState.WATER_TANK_EMPTY,   // Check/fill clean water tank
  213: MatterOperationalErrorState.WATER_TANK_EMPTY,   // Onboard clean water box empty

  // ── MOP_CLEANING_PAD_MISSING ──────────────────────────────────────────
  69: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,   // Mop pad came off
  70: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,   // Mop pad came off (variant)
  71: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,   // Mop pad stopped rotating
  72: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,   // Mop pad stopped rotating
  74: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,   // Mop install failed
  85: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,   // Check mop installation
  111: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,  // Washboard not installed
  120: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,  // Mop pad not in station
  126: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,  // Mop not detected
  127: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,  // Mop holder error
  215: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING,  // Mop not installed

  // ── FAILED_TO_FIND_CHARGING_DOCK ──────────────────────────────────────
  19: MatterOperationalErrorState.FAILED_TO_FIND_CHARGING_DOCK,    // Cannot find base
  1000: MatterOperationalErrorState.FAILED_TO_FIND_CHARGING_DOCK,  // Return to charge failed

  // ── UNABLE_TO_START_OR_RESUME ─────────────────────────────────────────
  12: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Main brush wrapped
  14: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Filter not dry/blocked
  20: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Low battery
  21: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Charging error
  22: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Battery level error
  29: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Battery error
  75: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,   // Low battery shutdown
  117: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,  // Base station not powered
  128: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME,  // Dock error
};

export class MatterMappers {
  private static readonly SUPPORTED_RUN_MODES = [
    { label: 'Idle', mode: MatterRvcRunMode.IDLE, modeTags: [{ value: MatterRvcRunModeTag.IDLE }] },
    { label: 'Cleaning', mode: MatterRvcRunMode.CLEANING, modeTags: [{ value: MatterRvcRunModeTag.CLEANING }] },
    { label: 'Returning Home', mode: MatterRvcRunMode.RETURNING_HOME, modeTags: [] },
    { label: 'Mapping', mode: MatterRvcRunMode.MAPPING, modeTags: [{ value: MatterRvcRunModeTag.MAPPING }] },
  ];

  public static getSupportedRunModes() { return MatterMappers.SUPPORTED_RUN_MODES; }

  private static readonly SUPPORTED_CLEAN_MODES = [
    { label: 'Sweep', mode: MatterRvcCleanMode.SWEEP, modeTags: [{ value: MatterRvcCleanModeTag.VACUUM }] },
    { label: 'Mop', mode: MatterRvcCleanMode.MOP, modeTags: [{ value: MatterRvcCleanModeTag.MOP }] },
    { label: 'Sweep and Mop', mode: MatterRvcCleanMode.SWEEP_AND_MOP, modeTags: [{ value: MatterRvcCleanModeTag.VACUUM_THEN_MOP }] },
  ];

  public static getSupportedCleanModes() { return MatterMappers.SUPPORTED_CLEAN_MODES; }

  private static readonly OPERATIONAL_STATE_LIST = [
    { operationalStateId: MatterOperationalState.STOPPED },
    { operationalStateId: MatterOperationalState.RUNNING },
    { operationalStateId: MatterOperationalState.PAUSED },
    { operationalStateId: MatterOperationalState.ERROR },
    { operationalStateId: MatterOperationalState.SEEKING_CHARGER },
    { operationalStateId: MatterOperationalState.CHARGING },
    { operationalStateId: MatterOperationalState.DOCKED },
    // Matter 1.4.2 maintenance states
    { operationalStateId: MatterOperationalState.EMPTYING_DUST_BIN },
    { operationalStateId: MatterOperationalState.CLEANING_MOP },
    { operationalStateId: MatterOperationalState.FILLING_WATER_TANK },
    { operationalStateId: MatterOperationalState.UPDATING_MAPS },
  ];

  public static getOperationalStateList() { return MatterMappers.OPERATIONAL_STATE_LIST; }

  private static readonly ERROR_STATE_LIST = [
    { errorStateId: MatterOperationalErrorState.NO_ERROR },
    { errorStateId: MatterOperationalErrorState.STUCK },
    { errorStateId: MatterOperationalErrorState.DUST_BIN_MISSING },
    { errorStateId: MatterOperationalErrorState.WATER_TANK_EMPTY },
    { errorStateId: MatterOperationalErrorState.WATER_TANK_MISSING },
    { errorStateId: MatterOperationalErrorState.MOP_CLEANING_PAD_MISSING },
    { errorStateId: MatterOperationalErrorState.UNABLE_TO_START_OR_RESUME },
    { errorStateId: MatterOperationalErrorState.FAILED_TO_FIND_CHARGING_DOCK },
  ];

  public static getErrorStateList() { return MatterMappers.ERROR_STATE_LIST; }

  public static mapRvcRunMode(state: NormalizedState): MatterRvcRunMode {
    switch (state.activity.runMode) {
      case 'cleaning': return MatterRvcRunMode.CLEANING;
      case 'returning': return MatterRvcRunMode.RETURNING_HOME;
      case 'mapping': return MatterRvcRunMode.MAPPING;
      case 'maintenance': return MatterRvcRunMode.IDLE;
      case 'error':
      case 'idle':
      default: return MatterRvcRunMode.IDLE;
    }
  }

  public static mapRvcCleanMode(mode: CleaningMode): MatterRvcCleanMode {
    switch (mode) {
      case 'SWEEP': return MatterRvcCleanMode.SWEEP;
      case 'MOP': return MatterRvcCleanMode.MOP;
      case 'SWEEP_AND_MOP': return MatterRvcCleanMode.SWEEP_AND_MOP;
      default: return MatterRvcCleanMode.SWEEP_AND_MOP;
    }
  }

  public static mapOperationalState(state: NormalizedState): MatterOperationalState {
    if (state.activity.activeError) return MatterOperationalState.ERROR;
    if (state.activity.paused) return MatterOperationalState.PAUSED;

    switch (state.activity.runMode) {
      case 'cleaning': return MatterOperationalState.RUNNING;
      case 'mapping': return MatterOperationalState.RUNNING;
      case 'returning': return MatterOperationalState.SEEKING_CHARGER;
      case 'maintenance': return MatterMappers.mapMaintenanceOperationalState(state.activity.maintenanceType);
      case 'idle':
        if (state.power.docked) {
          return state.power.charging ? MatterOperationalState.CHARGING : MatterOperationalState.DOCKED;
        }
        return MatterOperationalState.STOPPED;
      case 'error':
      default: return MatterOperationalState.ERROR;
    }
  }

  public static mapOperationalError(state: NormalizedState): { errorStateId: number; errorStateLabel?: string } {
    if (!state.activity.activeError) {
      return { errorStateId: MatterOperationalErrorState.NO_ERROR };
    }
    const code = state.activity.activeErrorCode;
    const errorStateId = (code !== undefined && ERROR_CODE_TO_MATTER[code] !== undefined)
      ? ERROR_CODE_TO_MATTER[code]!
      : MatterOperationalErrorState.STUCK;
    return { errorStateId, errorStateLabel: state.activity.activeError };
  }

  public static mapBatteryLevel(percent: number): number {
    return Math.max(0, Math.min(200, Math.round(percent * 2)));
  }

  public static mapBatChargeLevel(percent: number): MatterBatChargeLevel {
    if (percent <= 10) return MatterBatChargeLevel.CRITICAL;
    if (percent <= 20) return MatterBatChargeLevel.WARNING;
    return MatterBatChargeLevel.OK;
  }

  public static mapChargeState(power: PowerState): MatterChargeState {
    if (power.charging) return MatterChargeState.IS_CHARGING;
    if (power.batteryPercent >= 100) return MatterChargeState.IS_AT_MAX_CHARGE;
    if (power.docked) return MatterChargeState.IS_NOT_CHARGING;
    return MatterChargeState.IS_NOT_CHARGING;
  }

  private static mapMaintenanceOperationalState(maintenanceType: MaintenanceType): MatterOperationalState {
    switch (maintenanceType) {
      case 'emptying_dustbin': return MatterOperationalState.EMPTYING_DUST_BIN;
      case 'cleaning_mop': return MatterOperationalState.CLEANING_MOP;
      case 'filling_water': return MatterOperationalState.FILLING_WATER_TANK;
      case 'updating_maps': return MatterOperationalState.UPDATING_MAPS;
      default: return MatterOperationalState.DOCKED;
    }
  }
}
