import { describe, it, expect } from 'vitest';
import { MatterMappers } from '../src/matter/mappers';
import { MatterClusterMapper } from '../src/matter/clusters';
import { createInitialState } from '../src/dreame/models';

describe('MatterMappers', () => {
  const identity = { deviceId: 'test-123', model: 'dreame.vacuum.test', firmware: '1.0' };

  it('should map idle state to DOCKED when docked', () => {
    const state = createInitialState(identity);
    state.power.docked = true;
    state.power.charging = false;
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x42); // DOCKED
  });

  it('should map idle+charging to CHARGING', () => {
    const state = createInitialState(identity);
    state.power.docked = true;
    state.power.charging = true;
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x41); // CHARGING
  });

  it('should map cleaning to RUNNING', () => {
    const state = createInitialState(identity);
    state.activity.runMode = 'cleaning';
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x01); // RUNNING
  });

  it('should map returning to SEEKING_CHARGER', () => {
    const state = createInitialState(identity);
    state.activity.runMode = 'returning';
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x40); // SEEKING_CHARGER
  });

  it('should map paused to PAUSED', () => {
    const state = createInitialState(identity);
    state.activity.paused = true;
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x02); // PAUSED
  });

  it('should map error to ERROR', () => {
    const state = createInitialState(identity);
    state.activity.activeError = 'Stuck';
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x03); // ERROR
  });

  it('should map battery level to Matter format (x2)', () => {
    expect(MatterMappers.mapBatteryLevel(50)).toBe(100);
    expect(MatterMappers.mapBatteryLevel(100)).toBe(200);
    expect(MatterMappers.mapBatteryLevel(0)).toBe(0);
  });

  it('should map clean modes correctly', () => {
    expect(MatterMappers.mapRvcCleanMode('SWEEP')).toBe(0);
    expect(MatterMappers.mapRvcCleanMode('MOP')).toBe(1);
    expect(MatterMappers.mapRvcCleanMode('SWEEP_AND_MOP')).toBe(2);
  });
});

describe('MatterClusterMapper', () => {
  const identity = { deviceId: 'test-123', model: 'dreame.vacuum.test', firmware: '1.0' };

  it('should produce full Matter state', () => {
    const state = createInitialState(identity);
    state.power.batteryPercent = 80;
    const result = MatterClusterMapper.toMatterState(state);
    expect(result).toHaveProperty('RvcRunMode');
    expect(result).toHaveProperty('RvcCleanMode');
    expect(result).toHaveProperty('RvcOperationalState');
    expect(result).toHaveProperty('PowerSource');
  });

  it('should omit ServiceArea when no rooms', () => {
    const state = createInitialState(identity);
    const result = MatterClusterMapper.toMatterState(state);
    expect(result).not.toHaveProperty('ServiceArea');
  });

  it('should include ServiceArea when rooms available', () => {
    const state = createInitialState(identity);
    state.activity.availableRooms = [
      { id: '1', name: 'Living Room' },
      { id: '2', name: 'Kitchen' },
    ];
    const result = MatterClusterMapper.toMatterState(state);
    expect(result).toHaveProperty('ServiceArea');
  });

  describe('expanded error code mapping', () => {
    const errorCases: Array<[string, number, number]> = [
      ['wheel motor stuck', 15, 0x41],       // STUCK
      ['stuck on carpet', 99, 0x41],          // STUCK
      ['blocked by obstacle', 226, 0x41],     // STUCK
      ['dust bag full', 101, 0x42],           // DUST_BIN_MISSING
      ['dirty tank not installed', 76, 0x44], // WATER_TANK_MISSING
      ['clean water tank empty', 107, 0x43],  // WATER_TANK_EMPTY
      ['mop pad came off', 69, 0x45],         // MOP_CLEANING_PAD_MISSING
      ['cannot find base', 19, 0x48],         // FAILED_TO_FIND_CHARGING_DOCK
      ['return to charge failed', 1000, 0x48],// FAILED_TO_FIND_CHARGING_DOCK
      ['low battery', 20, 0x47],              // UNABLE_TO_START_OR_RESUME
      ['dock error', 128, 0x47],              // UNABLE_TO_START_OR_RESUME
    ];

    it.each(errorCases)('should map %s (code %i) to error state 0x%s', (_desc, code, expected) => {
      const state = createInitialState(identity);
      state.activity.activeError = _desc;
      state.activity.activeErrorCode = code;
      const result = MatterMappers.mapOperationalError(state);
      expect(result.errorStateId).toBe(expected);
      expect(result).not.toHaveProperty('errorStateLabel');
    });

    it('should default unmapped codes to STUCK', () => {
      const state = createInitialState(identity);
      state.activity.activeError = 'Unknown error';
      state.activity.activeErrorCode = 9999;
      const result = MatterMappers.mapOperationalError(state);
      expect(result.errorStateId).toBe(0x41); // STUCK
    });
  });
});
