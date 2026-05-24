import { describe, it, expect } from 'vitest';
import { MatterMappers } from '../src/matter/mappers';
import { MatterClusterMapper } from '../src/matter/clusters';
import { createInitialState } from '../src/dreame/models';

describe('MatterMappers', () => {
  const identity = { deviceId: 'test-123', model: 'dreame.vacuum.test', firmware: '1.0' };

  it('should map idle state to DOCKED when docked', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.power.docked = true;
    state.power.charging = false;
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x42); // DOCKED
  });

  it('should map idle+charging to CHARGING', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.power.docked = true;
    state.power.charging = true;
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x41); // CHARGING
  });

  it('should map cleaning to RUNNING', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.activity.runMode = 'cleaning';
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x01); // RUNNING
  });

  it('should map returning to SEEKING_CHARGER', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.activity.runMode = 'returning';
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x40); // SEEKING_CHARGER
  });

  it('should map paused to PAUSED', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.activity.paused = true;
    const result = MatterMappers.mapOperationalState(state);
    expect(result).toBe(0x02); // PAUSED
  });

  it('should map error to ERROR', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
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
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.power.batteryPercent = 80;
    const result = MatterClusterMapper.toMatterState(state);
    expect(result).toHaveProperty('RvcRunMode');
    expect(result).toHaveProperty('RvcCleanMode');
    expect(result).toHaveProperty('RvcOperationalState');
    expect(result).toHaveProperty('PowerSource');
  });

  it('should omit ServiceArea when no rooms', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    const result = MatterClusterMapper.toMatterState(state);
    expect(result).not.toHaveProperty('ServiceArea');
  });

  it('should include ServiceArea when rooms available', () => {
    const state = createInitialState(identity, 'SWEEP_AND_MOP');
    state.activity.availableRooms = [
      { id: '1', name: 'Living Room' },
      { id: '2', name: 'Kitchen' },
    ];
    const result = MatterClusterMapper.toMatterState(state);
    expect(result).toHaveProperty('ServiceArea');
  });
});
