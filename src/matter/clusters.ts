import { MatterMappers } from './mappers.js';
import { NormalizedState, RoomInfo } from '../dreame/models.js';

export interface SupportedArea {
  areaId: number;
  mapId: number | null;
  areaInfo: {
    locationInfo: {
      locationName: string;
      floorNumber: number | null;
      areaType: number | null;
    } | null;
    landmarkInfo: null;
  };
}

export interface SupportedMap {
  mapId: number;
  name: string;
}

export interface DreameAreaTarget {
  areaId: number;
  mapId: number | null;
  segmentId: string;
}

export interface ServiceAreaPayload {
  supportedMaps: SupportedMap[];
  supportedAreas: SupportedArea[];
  selectedAreas: number[];
  currentArea: number | null;
}

export interface MatterState {
  RvcRunMode: { supportedModes: unknown[]; currentMode: number };
  RvcCleanMode: { supportedModes: unknown[]; currentMode: number };
  RvcOperationalState: { operationalStateList: unknown[]; operationalState: number; operationalError: unknown };
  PowerSource: {
    status: number;
    order: number;
    description: string;
    batPercentRemaining: number;
    batChargeLevel: number;
    batReplaceability: number;
    batChargeState: number;
  };
  ServiceArea?: ServiceAreaPayload;
}

const NON_NUMERIC_AREA_OFFSET = 0x10000;
const MAX_UINT32 = 0xffffffff;
const MAX_SUPPORTED_AREAS = 255;
const MAP_NAME_BYTES = 64;
const ROOM_NAME_BYTES = 128;

function truncateUtf8(value: string, limit: number): string {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > limit) break;
    result += char;
  }
  return result;
}

function uniqueName(name: string | undefined, fallback: string, limit: number, used: Set<string>): string {
  const base = typeof name === 'string' ? name.trim() || fallback : fallback;
  let candidate = truncateUtf8(base, limit);
  for (let index = 2; used.has(candidate); index++) {
    const suffix = ` (${index})`;
    candidate = truncateUtf8(base, limit - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

function getStableAreaId(roomId: string, fallbackIndex: number, usedAreaIds: Set<number>): number {
  const parsed = Number.parseInt(roomId, 10);
  if (parsed > 0 && parsed <= MAX_UINT32 && !usedAreaIds.has(parsed)) {
    usedAreaIds.add(parsed);
    return parsed;
  }

  let areaId = NON_NUMERIC_AREA_OFFSET + fallbackIndex;
  while (usedAreaIds.has(areaId)) {
    areaId += 1;
  }
  usedAreaIds.add(areaId);
  return areaId;
}

export class MatterClusterMapper {
  private static buildAreaCatalog(state: NormalizedState) {
    const supportedMaps: SupportedMap[] = [];
    const supportedAreas: SupportedArea[] = [];
    const areaTargets: DreameAreaTarget[] = [];
    const usedAreaIds = new Set<number>();
    const usedMapIds = new Set<number>();
    const usedMapNames = new Set<string>();
    const addRooms = (rooms: RoomInfo[], mapId: number | null) => {
      const usedRoomNames = new Set<string>();
      const usedSegments = new Set<string>();
      for (const room of rooms) {
        if (supportedAreas.length >= MAX_SUPPORTED_AREAS) break;
        if (usedSegments.has(room.id)) continue;
        usedSegments.add(room.id);
        const areaId = getStableAreaId(room.id, supportedAreas.length, usedAreaIds);
        areaTargets.push({ areaId, mapId, segmentId: room.id });
        supportedAreas.push({
          areaId,
          mapId,
          areaInfo: {
            locationInfo: {
              locationName: uniqueName(room.name, `Room ${areaId}`, ROOM_NAME_BYTES, usedRoomNames),
              floorNumber: null,
              areaType: null,
            },
            landmarkInfo: null,
          },
        });
      }
    };

    for (const map of state.activity.knownMaps ?? []) {
      if (supportedAreas.length >= MAX_SUPPORTED_AREAS) break;
      const { mapId } = map;
      if (!Number.isInteger(mapId) || mapId < 0 || mapId > MAX_UINT32 || usedMapIds.has(mapId)) continue;
      const rooms = MatterClusterMapper.normalizeRooms(map.rooms);
      if (rooms.length === 0) continue;
      usedMapIds.add(mapId);
      supportedMaps.push({
        mapId,
        name: uniqueName(map.name, `Floor ${supportedMaps.length + 1}`, MAP_NAME_BYTES, usedMapNames),
      });
      addRooms(rooms, mapId);
    }
    if (supportedMaps.length === 0) addRooms(MatterClusterMapper.normalizeRooms(state.activity.availableRooms), null);
    return { supportedMaps, supportedAreas, areaTargets };
  }

  public static buildServiceArea(state: NormalizedState): ServiceAreaPayload | undefined {
    const { supportedMaps, supportedAreas, areaTargets } = MatterClusterMapper.buildAreaCatalog(state);
    if (supportedAreas.length === 0) return undefined;
    const useMapMode = supportedMaps.length > 0;

    const selectedSource = Array.isArray(state.activity.selectedRooms) ? state.activity.selectedRooms : [];
    const selectedAreas = [...new Set(state.activity.selectedAreaIds !== undefined
      ? state.activity.selectedAreaIds.filter((id) => areaTargets.some((target) => target.areaId === id))
      : selectedSource
      .map((segmentId) => {
        const candidates = areaTargets.filter((target) => target.segmentId === segmentId);
        if (!useMapMode) return candidates[0]?.areaId;

        const currentMapTarget = candidates.find((target) => target.mapId === state.activity.currentMapId);
        if (currentMapTarget) return currentMapTarget.areaId;

        // Without an active map, only expose selections whose segment ID is unambiguous.
        return candidates.length === 1 ? candidates[0]?.areaId : undefined;
      })
      .filter((areaId): areaId is number => areaId !== undefined))];

    // currentArea: the first selected room being actively cleaned, or null
    const currentArea = (state.activity.runMode === 'cleaning' && selectedAreas.length > 0)
      ? selectedAreas[0]!
      : null;

    return { supportedMaps, supportedAreas, selectedAreas, currentArea };
  }

  public static toMatterState(state: NormalizedState): MatterState {
    const result: MatterState = {
      RvcRunMode: {
        supportedModes: MatterMappers.getSupportedRunModes(),
        currentMode: MatterMappers.mapRvcRunMode(state),
      },
      RvcCleanMode: {
        supportedModes: MatterMappers.getSupportedCleanModes(),
        currentMode: state.activity.cleaningProfile === 'AUTO' ? 2
          : state.activity.cleaningProfile === 'QUIET'
          && state.activity.cleanMode !== 'MOP' ? state.activity.cleanMode === 'SWEEP' ? 4 : 5
            : MatterMappers.mapRvcCleanMode(state.activity.cleanMode),
      },
      RvcOperationalState: {
        operationalStateList: MatterMappers.getOperationalStateList(),
        operationalState: MatterMappers.mapOperationalState(state),
        operationalError: MatterMappers.mapOperationalError(state),
      },
      PowerSource: {
        status: 0,  // 0 = Unspecified (battery-only device)
        order: 0,
        description: 'Battery',
        batPercentRemaining: MatterMappers.mapBatteryLevel(state.power.batteryPercent),
        batChargeLevel: MatterMappers.mapBatChargeLevel(state.power.batteryPercent),
        batReplaceability: 1, // NOT_REPLACEABLE
        batChargeState: MatterMappers.mapChargeState(state.power),
      },
    };

    const serviceArea = MatterClusterMapper.buildServiceArea(state);
    if (serviceArea) {
      result['ServiceArea'] = serviceArea;
    }

    return result;
  }

  /** Builds a reverse mapping from Matter areaId to its Dreame map and segment. */
  public static buildAreaIdToRoomTargetMap(state: NormalizedState): Map<number, DreameAreaTarget> {
    return new Map(MatterClusterMapper.buildAreaCatalog(state).areaTargets.map((target) => [target.areaId, target]));
  }

  /** Compatibility helper for consumers that only need the Dreame segment ID. */
  public static buildAreaIdToRoomIdMap(state: NormalizedState): Map<number, string> {
    return new Map(
      [...MatterClusterMapper.buildAreaIdToRoomTargetMap(state)]
        .map(([areaId, target]) => [areaId, target.segmentId]),
    );
  }

  private static normalizeRooms(value: RoomInfo[] | undefined): RoomInfo[] {
    if (!Array.isArray(value)) return [];
    return value.filter((room): room is RoomInfo =>
      typeof room === 'object'
      && room !== null
      && typeof room.id === 'string'
      && room.id.length > 0,
    );
  }
}
