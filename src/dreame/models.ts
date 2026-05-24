import { CleaningMode } from '../config';

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
export type RunMode = 'idle' | 'cleaning' | 'returning' | 'error';

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

/** Creates an initial blank state. */
export function createInitialState(identity: Identity, defaultMode: CleaningMode): NormalizedState {
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
      cleanMode: defaultMode,
      suctionLevel: 1,
      waterLevel: 2,
      activeError: null,
      activeErrorCode: undefined,
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
  3: 'idle',       // Sleeping (idle)
  4: 'error',      // Error
  5: 'returning',  // Returning
  6: 'idle',       // Charging (idle + docked)
  7: 'cleaning',   // Mopping
  8: 'cleaning',   // Drying
  9: 'idle',       // Washing
  10: 'returning', // Going to wash
  11: 'cleaning',  // Building map
  12: 'cleaning',  // Sweeping and mopping
  13: 'returning', // Charging completed
  14: 'cleaning',  // Upgrading
  15: 'cleaning',  // Clean Summon
  16: 'returning', // Station reset
  17: 'cleaning',  // Returning install mop
  18: 'cleaning',  // Returning remove mop
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
