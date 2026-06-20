import type { CleaningMode } from '../config.js';

/** Device identity from cloud discovery. */
export interface Identity {
  deviceId: string;
  model: string;
  firmware: string;
}

/** Room info from device / config. */
export interface RoomInfo {
  id: string;
  name: string;
}

/** Per-map room grouping for multi-floor devices. */
export interface MapRooms {
  mapId: number;
  name?: string;
  rooms: RoomInfo[];
}

/** Dreame device run mode (derived from siid 2, piid 1). */
export type RunMode = 'idle' | 'cleaning' | 'returning' | 'maintenance' | 'mapping' | 'error';

/** Maintenance sub-type when runMode === 'maintenance'. */
export type MaintenanceType = 'emptying_dustbin' | 'cleaning_mop' | 'filling_water' | 'updating_maps' | undefined;

/** Dreame suction level (siid 4, piid 4): 0=Quiet, 1=Standard, 2=Strong, 3=Turbo. */
export type SuctionLevel = 0 | 1 | 2 | 3;

/** Dreame water level (siid 4, piid 5): 1=Low, 2=Medium, 3=High. */
export type WaterLevel = 1 | 2 | 3;

// ── MIoT spec IDs ──────────────────────────────────────────────────────────

/** MIoT service/property/action IDs for Dreame robot vacuums. */
export const MIOT = {
  /** siid 2 — Device state service. */
  STATE: { siid: 2, STATE: 1, ERROR: 2, START: 1, PAUSE: 2 },
  /** siid 3 — Battery service. */
  BATTERY: { siid: 3, LEVEL: 1, CHARGE_STATUS: 2 },
  /** siid 4 — Vacuum service. */
  VACUUM: {
    siid: 4,
    STATUS: 1,
    SUCTION: 4,
    WATER: 5,
    CLEANING_PROPERTIES: 10,
    CLEAN_MODE: 23,
    SELF_WASH_BASE_STATUS: 25,
    START_CUSTOM: 1,
    STOP: 2,
  },
  /** siid 15 — Dock capabilities. */
  DOCK: { siid: 15, DUST_COLLECTION: 3 },
  /** siid 3 — Battery and charging service. */
  CHARGE: { siid: 3, DOCK: 1 },
  /** siid 6 — Map service. Names follow HA's Dreame mapping for map objects. */
  MAP: { siid: 6, MAP_DATA: 1, FRAME_INFO: 2, OBJECT_NAME: 3, MAP_LIST: 8, RECOVERY_MAP_LIST: 9 },
  /** siid 7 — Find device service. Not present on every Dreame model. */
  LOCATE: { siid: 7, LOCATE: 1 },
} as const;

export const DREAME_STATUS = {
  SEGMENT_CLEANING: 18,
} as const;

/** Properties to poll via HTTP for state updates. */
export const POLL_PROPERTIES = [
  { siid: MIOT.STATE.siid, piid: MIOT.STATE.STATE },
  { siid: MIOT.STATE.siid, piid: MIOT.STATE.ERROR },
  { siid: MIOT.BATTERY.siid, piid: MIOT.BATTERY.LEVEL },
  { siid: MIOT.BATTERY.siid, piid: MIOT.BATTERY.CHARGE_STATUS },
  { siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.SUCTION },
  { siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.WATER },
  { siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE },
] as const;

/** Power state snapshot. */
export interface PowerState {
  batteryPercent: number;
  charging: boolean;
  docked: boolean;
}

/** Activity state snapshot. */
export interface ActivityState {
  rawDeviceState: number | undefined;
  runMode: RunMode;
  paused: boolean;
  cleanMode: CleaningMode;
  suctionLevel: SuctionLevel;
  waterLevel: WaterLevel;
  activeError: string | null;
  activeErrorCode: number | undefined;
  maintenanceType: MaintenanceType;
  availableRooms: RoomInfo[];
  selectedRooms: string[];
  knownMaps: MapRooms[];
  currentMapId: number | undefined;
}

/** Full normalized device state. */
export interface NormalizedState {
  identity: Identity;
  power: PowerState;
  activity: ActivityState;
}

/** Creates an initial blank state. Mode/suction/water will be read from the robot. */
export function createInitialState(identity: Identity): NormalizedState {
  return {
    identity,
    power: {
      batteryPercent: 0,
      charging: false,
      docked: true,
    },
    activity: {
      runMode: 'idle',
      rawDeviceState: undefined,
      paused: false,
      cleanMode: 'SWEEP_AND_MOP',
      suctionLevel: 1,
      waterLevel: 2,
      activeError: null,
      activeErrorCode: undefined,
      maintenanceType: undefined,
      availableRooms: [],
      selectedRooms: [],
      knownMaps: [],
      currentMapId: undefined,
    },
  };
}

/**
 * Dreame device state values (siid 2, piid 1).
 * From HA Tasshack integration.
 */
export const DREAME_STATE: Record<number, RunMode> = {
  1: 'cleaning',   // Sweeping
  2: 'idle',       // Idle
  3: 'cleaning',   // Paused (mid-clean pause)
  4: 'error',      // Error
  5: 'returning',  // Returning
  6: 'idle',       // Charging (idle + docked)
  7: 'cleaning',   // Mopping
  8: 'maintenance', // Drying (mop maintenance)
  9: 'maintenance', // Washing (mop maintenance)
  10: 'maintenance', // Going to wash (mop maintenance)
  11: 'mapping',      // Building map
  12: 'cleaning',   // Sweeping and mopping
  13: 'idle',        // Charging completed (docked)
  14: 'idle',       // Upgrading firmware (not cleaning)
  15: 'cleaning',  // Clean Summon
  16: 'returning', // Station reset
  17: 'cleaning',  // Returning install mop
  18: 'cleaning',  // Returning remove mop
  19: 'maintenance', // Water check
  20: 'maintenance', // Clean add water
  21: 'maintenance', // Washing paused
  22: 'maintenance', // Auto emptying
  23: 'cleaning',  // Remote control
  24: 'idle',      // Smart charging
  25: 'cleaning',  // Second cleaning
  26: 'cleaning',  // Human following
  27: 'cleaning',  // Spot cleaning
  28: 'returning', // Returning auto empty
  29: 'idle',      // Waiting for task (docked, not actively charging)
  30: 'maintenance', // Station cleaning
  31: 'returning', // Returning to drain
  32: 'maintenance', // Draining
  33: 'maintenance', // Auto water draining
  34: 'maintenance', // Emptying
  35: 'maintenance', // Dust bag drying
  36: 'maintenance', // Dust bag drying paused
  37: 'returning', // Heading to extra cleaning
  38: 'cleaning',  // Extra cleaning
  95: 'cleaning', // Finding pet paused
  96: 'cleaning', // Finding pet
  97: 'cleaning', // Shortcut
  98: 'cleaning', // Monitoring
  99: 'cleaning', // Monitoring paused
  101: 'cleaning', // Initial deep cleaning
  102: 'cleaning', // Initial deep cleaning paused
  103: 'cleaning', // Sanitizing
  104: 'cleaning', // Sanitizing with dry
  105: 'maintenance', // Changing mop
  106: 'maintenance', // Changing mop paused
  107: 'maintenance', // Floor maintaining
  108: 'maintenance', // Floor maintaining paused
};

/** Maps Dreame state values to maintenance sub-types (when runMode === 'maintenance'). */
export const DREAME_MAINTENANCE_TYPE: Record<number, MaintenanceType> = {
  8: 'cleaning_mop',   // Drying
  9: 'cleaning_mop',   // Washing
  10: 'cleaning_mop',  // Going to wash
  19: 'filling_water', // Water check
  20: 'filling_water', // Clean add water
  21: 'cleaning_mop',  // Washing paused
  22: 'emptying_dustbin', // Auto emptying
  30: 'cleaning_mop',  // Station cleaning
  32: 'filling_water', // Draining
  33: 'filling_water', // Auto water draining
  34: 'emptying_dustbin', // Emptying
  35: 'emptying_dustbin', // Dust bag drying
  36: 'emptying_dustbin', // Dust bag drying paused
  105: 'cleaning_mop', // Changing mop
  106: 'cleaning_mop', // Changing mop paused
  107: 'cleaning_mop', // Floor maintaining
  108: 'cleaning_mop', // Floor maintaining paused
};

export const DREAME_PAUSED_STATES = new Set([3, 21, 36, 95, 99, 102, 106, 108]);

export const DREAME_CUSTOM_STATE_LABELS: Record<number, string> = {
  19: 'Water check',
  20: 'Adding clean water',
  21: 'Washing paused',
  23: 'Remote control',
  24: 'Smart charging',
  25: 'Second cleaning',
  26: 'Human following',
  27: 'Spot cleaning',
  29: 'Waiting for task',
  31: 'Returning to drain',
  32: 'Draining',
  33: 'Auto water draining',
  35: 'Dust bag drying',
  36: 'Dust bag drying paused',
  37: 'Heading to extra cleaning',
  38: 'Extra cleaning',
  95: 'Finding pet paused',
  96: 'Finding pet',
  97: 'Shortcut',
  98: 'Monitoring',
  99: 'Monitoring paused',
  101: 'Initial deep cleaning',
  102: 'Initial deep cleaning paused',
  103: 'Sanitizing',
  104: 'Sanitizing with dry',
  105: 'Changing mop',
  106: 'Changing mop paused',
  107: 'Floor maintaining',
  108: 'Floor maintaining paused',
};

/** Dreame cleaning mode values (siid 4, piid 23). */
export const DREAME_CLEAN_MODE: Record<number, CleaningMode> = {
  0: 'SWEEP',
  1: 'MOP',
  2: 'SWEEP_AND_MOP',
};

/** Dreame charge status values (siid 3, piid 2). */
export const DREAME_CHARGE_STATUS: Record<number, { charging: boolean; docked: boolean }> = {
  1: { charging: true, docked: true },    // Charging
  2: { charging: false, docked: false },   // Not charging (undocked)
  3: { charging: false, docked: true },    // Charged (full, on dock)
  5: { charging: false, docked: false },   // Go charging
};
