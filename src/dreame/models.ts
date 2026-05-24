import type { CleaningMode } from '../config';

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

/** Power state snapshot. */
export interface PowerState {
  batteryPercent: number;
  charging: boolean;
  docked: boolean;
}

/** Activity state snapshot. */
export interface ActivityState {
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
  14: 'cleaning',  // Upgrading
  15: 'cleaning',  // Clean Summon
  16: 'returning', // Station reset
  17: 'cleaning',  // Returning install mop
  18: 'cleaning',  // Returning remove mop
};

/** Maps Dreame state values to maintenance sub-types (when runMode === 'maintenance'). */
export const DREAME_MAINTENANCE_TYPE: Record<number, MaintenanceType> = {
  8: 'cleaning_mop',   // Drying
  9: 'cleaning_mop',   // Washing
  10: 'cleaning_mop',  // Going to wash
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
