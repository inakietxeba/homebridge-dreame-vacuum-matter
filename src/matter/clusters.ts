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

function getStableAreaId(roomId: string, fallbackIndex: number, usedAreaIds: Set<number>): number {
  const parsed = Number.parseInt(roomId, 10);
  if (Number.isFinite(parsed) && parsed > 0 && !usedAreaIds.has(parsed)) {
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
  public static buildServiceArea(state: NormalizedState): ServiceAreaPayload | undefined {
    const knownMaps = state.activity.knownMaps ?? [];
    const mapsWithRooms = knownMaps
      .map((m) => ({ ...m, rooms: MatterClusterMapper.normalizeRooms(m.rooms) }))
      .filter((m) => m.rooms.length > 0);

    const useMapMode = mapsWithRooms.length > 0;

    let supportedMaps: SupportedMap[] = [];
    let supportedAreas: SupportedArea[] = [];

    if (useMapMode) {
      supportedMaps = mapsWithRooms.map((m, index) => ({
        mapId: m.mapId,
        name: m.name?.trim() || `Floor ${index + 1}`,
      }));

      let globalIndex = 0;
      const usedAreaIds = new Set<number>();
      for (const map of mapsWithRooms) {
        for (const room of map.rooms) {
          const areaId = getStableAreaId(room.id, globalIndex, usedAreaIds);
          const trimmedName = (room.name ?? '').trim();
          supportedAreas.push({
            areaId,
            mapId: map.mapId,
            areaInfo: {
              locationInfo: {
                locationName: trimmedName.length > 0 ? trimmedName : `Room ${areaId}`,
                floorNumber: null,
                areaType: null,
              },
              landmarkInfo: null,
            },
          });
          globalIndex += 1;
        }
      }
    } else {
      const rooms = MatterClusterMapper.normalizeRooms(state.activity.availableRooms);
      if (rooms.length === 0) return undefined;

      const usedAreaIds = new Set<number>();
      supportedAreas = rooms.map((room, index) => {
        const areaId = getStableAreaId(room.id, index, usedAreaIds);
        const trimmedName = (room.name ?? '').trim();
        return {
          areaId,
          mapId: null,
          areaInfo: {
            locationInfo: {
              locationName: trimmedName.length > 0 ? trimmedName : `Room ${areaId}`,
              floorNumber: null,
              areaType: null,
            },
            landmarkInfo: null,
          },
        };
      });
    }

    if (supportedAreas.length === 0) return undefined;

    const validAreaIds = new Set(supportedAreas.map((a) => a.areaId));
    const selectedSource = Array.isArray(state.activity.selectedRooms) ? state.activity.selectedRooms : [];
    const selectedAreas = selectedSource
      .map((roomId) => Number.parseInt(roomId, 10))
      .filter((areaId) => Number.isFinite(areaId) && validAreaIds.has(areaId));

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
        currentMode: MatterMappers.mapRvcCleanMode(state.activity.cleanMode),
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

  /**
   * Builds a reverse mapping from Matter areaId → Dreame room ID string.
   * Used by selectAreas handler to convert Matter area selections to device commands.
   */
  public static buildAreaIdToRoomIdMap(state: NormalizedState): Map<number, string> {
    const result = new Map<number, string>();
    const serviceArea = MatterClusterMapper.buildServiceArea(state);
    if (!serviceArea) return result;

    // Collect all room sources
    const knownMaps = state.activity.knownMaps ?? [];
    const mapsWithRooms = knownMaps
      .map((m) => ({ ...m, rooms: MatterClusterMapper.normalizeRooms(m.rooms) }))
      .filter((m) => m.rooms.length > 0);

    const allRooms: RoomInfo[] = mapsWithRooms.length > 0
      ? mapsWithRooms.flatMap((m) => m.rooms)
      : MatterClusterMapper.normalizeRooms(state.activity.availableRooms);

    // Map each areaId back to its room ID
    let globalIndex = 0;
    const usedAreaIds = new Set<number>();
    for (const room of allRooms) {
      const areaId = getStableAreaId(room.id, globalIndex, usedAreaIds);
      result.set(areaId, room.id);
      globalIndex += 1;
    }

    return result;
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
