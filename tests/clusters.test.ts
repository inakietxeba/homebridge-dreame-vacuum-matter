import { describe, it, expect } from 'vitest';
import { MatterClusterMapper } from '../src/matter/clusters';
import { createInitialState, RoomInfo } from '../src/dreame/models';

describe('MatterClusterMapper', () => {
  const identity = { deviceId: 'test-123', model: 'dreame.vacuum.test', firmware: '1.0' };

  describe('buildServiceArea', () => {
    it('should return undefined when no rooms are available', () => {
      const state = createInitialState(identity);
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeUndefined();
    });

    it('should build service area from availableRooms', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [
        { id: '1', name: 'Living Room' },
        { id: '2', name: 'Kitchen' },
      ];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.supportedAreas).toHaveLength(2);
      expect(result!.supportedAreas[0]!.areaId).toBe(1);
      expect(result!.supportedAreas[0]!.areaInfo!.locationInfo!.locationName).toBe('Living Room');
      expect(result!.supportedAreas[1]!.areaId).toBe(2);
      expect(result!.supportedMaps).toHaveLength(0);
    });

    it('should use fallback name for rooms with empty names', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [{ id: '5', name: '' }];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.supportedAreas[0]!.areaInfo!.locationInfo!.locationName).toBe('Room 5');
    });

    it('should handle non-numeric room IDs with offset', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [{ id: 'abc', name: 'Study' }];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.supportedAreas[0]!.areaId).toBe(0x10000); // NON_NUMERIC_AREA_OFFSET + 0
      expect(result!.supportedAreas[0]!.areaInfo!.locationInfo!.locationName).toBe('Study');
    });

    it('should filter invalid rooms (missing id)', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [
        { id: '', name: 'Bad Room' },
        { id: '1', name: 'Good Room' },
      ] as RoomInfo[];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.supportedAreas).toHaveLength(1);
      expect(result!.supportedAreas[0]!.areaInfo!.locationInfo!.locationName).toBe('Good Room');
    });

    it('should build from knownMaps when available', () => {
      const state = createInitialState(identity);
      state.activity.knownMaps = [
        {
          mapId: 100,
          rooms: [
            { id: '1', name: 'Bedroom' },
            { id: '2', name: 'Bathroom' },
          ],
        },
        {
          mapId: 200,
          rooms: [{ id: '3', name: 'Garage' }],
        },
      ];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.supportedMaps).toHaveLength(2);
      expect(result!.supportedMaps[0]!.mapId).toBe(100);
      expect(result!.supportedMaps[0]!.name).toBe('Floor 1');
      expect(result!.supportedMaps[1]!.mapId).toBe(200);
      expect(result!.supportedMaps[1]!.name).toBe('Floor 2');
      expect(result!.supportedAreas).toHaveLength(3);
      expect(result!.supportedAreas[0]!.mapId).toBe(100);
      expect(result!.supportedAreas[2]!.mapId).toBe(200);
    });

    it('should map selectedRooms to selectedAreas', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [
        { id: '1', name: 'Room A' },
        { id: '2', name: 'Room B' },
      ];
      state.activity.selectedRooms = ['1', '2'];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.selectedAreas).toEqual([1, 2]);
    });

    it('should filter selectedRooms that are not in supportedAreas', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [{ id: '1', name: 'Room A' }];
      state.activity.selectedRooms = ['1', '99'];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.selectedAreas).toEqual([1]);
    });

    it('should set currentArea when cleaning with selected rooms', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [
        { id: '1', name: 'Room A' },
        { id: '2', name: 'Room B' },
      ];
      state.activity.selectedRooms = ['2', '1'];
      state.activity.runMode = 'cleaning';
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.currentArea).toBe(2);
    });

    it('should set currentArea to null when idle', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [{ id: '1', name: 'Room A' }];
      state.activity.selectedRooms = ['1'];
      state.activity.runMode = 'idle';
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.currentArea).toBeNull();
    });

    it('should ignore knownMaps entries with no valid rooms', () => {
      const state = createInitialState(identity);
      state.activity.knownMaps = [
        { mapId: 100, rooms: [] },
        { mapId: 200, rooms: [{ id: '1', name: 'Valid' }] },
      ];
      const result = MatterClusterMapper.buildServiceArea(state);
      expect(result).toBeDefined();
      expect(result!.supportedMaps).toHaveLength(1);
      expect(result!.supportedMaps[0]!.mapId).toBe(200);
    });
  });

  describe('toMatterState', () => {
    it('should produce all required clusters', () => {
      const state = createInitialState(identity);
      const result = MatterClusterMapper.toMatterState(state);
      expect(result).toHaveProperty('RvcRunMode');
      expect(result).toHaveProperty('RvcCleanMode');
      expect(result).toHaveProperty('RvcOperationalState');
      expect(result).toHaveProperty('PowerSource');
    });

    it('should not include ServiceArea when no rooms available', () => {
      const state = createInitialState(identity);
      const result = MatterClusterMapper.toMatterState(state);
      expect(result).not.toHaveProperty('ServiceArea');
    });

    it('should include ServiceArea when rooms available', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [{ id: '1', name: 'Room' }];
      const result = MatterClusterMapper.toMatterState(state);
      expect(result).toHaveProperty('ServiceArea');
    });

    it('should map PowerSource battery fields correctly', () => {
      const state = createInitialState(identity);
      state.power.batteryPercent = 75;
      state.power.charging = true;
      const result = MatterClusterMapper.toMatterState(state);
      const ps = result['PowerSource'] as Record<string, unknown>;
      expect(ps['batPercentRemaining']).toBe(150); // 75 * 2
      expect(ps['batChargeLevel']).toBe(0x00); // OK (>20%)
      expect(ps['batChargeState']).toBe(0x03); // IS_CHARGING
      expect(ps['batReplaceability']).toBe(1); // NOT_REPLACEABLE
    });

    it('should map PowerSource for low battery', () => {
      const state = createInitialState(identity);
      state.power.batteryPercent = 8;
      state.power.charging = false;
      state.power.docked = false;
      const result = MatterClusterMapper.toMatterState(state);
      const ps = result['PowerSource'] as Record<string, unknown>;
      expect(ps['batChargeLevel']).toBe(0x02); // CRITICAL (<=10%)
      expect(ps['batChargeState']).toBe(0x01); // IS_NOT_CHARGING
    });
  });

  describe('buildAreaIdToRoomIdMap', () => {
    it('should map numeric room IDs directly', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [
        { id: '1', name: 'Living Room' },
        { id: '5', name: 'Kitchen' },
      ];
      const map = MatterClusterMapper.buildAreaIdToRoomIdMap(state);
      expect(map.get(1)).toBe('1');
      expect(map.get(5)).toBe('5');
    });

    it('should map non-numeric room IDs with offset', () => {
      const state = createInitialState(identity);
      state.activity.availableRooms = [
        { id: 'room_a', name: 'Room A' },
        { id: 'room_b', name: 'Room B' },
      ];
      const map = MatterClusterMapper.buildAreaIdToRoomIdMap(state);
      expect(map.get(0x10000)).toBe('room_a');
      expect(map.get(0x10001)).toBe('room_b');
    });

    it('should return empty map when no rooms', () => {
      const state = createInitialState(identity);
      const map = MatterClusterMapper.buildAreaIdToRoomIdMap(state);
      expect(map.size).toBe(0);
    });

    it('should handle multi-floor maps', () => {
      const state = createInitialState(identity);
      state.activity.knownMaps = [
        { mapId: 100, rooms: [{ id: '1', name: 'Room 1' }] },
        { mapId: 200, rooms: [{ id: '2', name: 'Room 2' }] },
      ];
      const map = MatterClusterMapper.buildAreaIdToRoomIdMap(state);
      expect(map.get(1)).toBe('1');
      expect(map.get(2)).toBe('2');
    });
  });
});
