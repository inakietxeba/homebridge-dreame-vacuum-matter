import { MatterMappers } from './mappers';
import { NormalizedState, RoomInfo } from '../dreame/models';

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
}

const NON_NUMERIC_AREA_OFFSET = 0x10000;

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
        name: `Floor ${index + 1}`,
      }));

      let globalIndex = 0;
      for (const map of mapsWithRooms) {
        for (const room of map.rooms) {
          const parsed = Number.parseInt(room.id, 10);
          const areaId = Number.isFinite(parsed) && parsed > 0 ? parsed : NON_NUMERIC_AREA_OFFSET + globalIndex;
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

      supportedAreas = rooms.map((room, index) => {
        const parsed = Number.parseInt(room.id, 10);
        const areaId = Number.isFinite(parsed) && parsed > 0 ? parsed : NON_NUMERIC_AREA_OFFSET + index;
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

    return { supportedMaps, supportedAreas, selectedAreas };
  }

  public static toMatterState(state: NormalizedState): Record<string, unknown> {
    const result: Record<string, unknown> = {
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
        batPercentRemaining: MatterMappers.mapBatteryLevel(state.power.batteryPercent),
        batChargeState: MatterMappers.mapChargeState(state.power),
      },
    };

    const serviceArea = MatterClusterMapper.buildServiceArea(state);
    if (serviceArea) {
      result['ServiceArea'] = serviceArea;
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
