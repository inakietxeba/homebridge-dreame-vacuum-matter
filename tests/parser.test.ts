import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/dreame/models';
import { StateParser } from '../src/dreame/parser';

describe('StateParser', () => {
  const identity = { deviceId: 'test-123', model: 'dreame.vacuum.test', firmware: '1.0' };
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    getRaw: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  } as any;

  it('should parse battery level', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [{ siid: 3, piid: 1, value: 85 }],
      state,
    );
    expect(result.power.batteryPercent).toBe(85);
  });

  it('should parse device state', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [{ siid: 2, piid: 1, value: 1 }],
      state,
    );
    expect(result.activity.runMode).toBe('cleaning');
  });

  it('should parse paused state', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [{ siid: 2, piid: 1, value: 3 }],
      state,
    );
    expect(result.activity.paused).toBe(true);
  });

  it('should parse charging state', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [{ siid: 3, piid: 2, value: 1 }],
      state,
    );
    expect(result.power.charging).toBe(true);
    expect(result.power.docked).toBe(true);
  });

  it('should parse suction level', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [{ siid: 4, piid: 4, value: 3 }],
      state,
    );
    expect(result.activity.suctionLevel).toBe(3);
  });

  it('should parse cleaning mode', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [{ siid: 4, piid: 23, value: 0 }],
      state,
    );
    expect(result.activity.cleanMode).toBe('SWEEP');
  });

  it('should infer clean mode from Dreame cleaning state when mode property is model-specific', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    state.activity.cleanMode = 'SWEEP_AND_MOP';

    const result = parser.processProperties(
      [
        { siid: 4, piid: 23, value: 5120 },
        { siid: 2, piid: 1, value: 7 },
      ],
      state,
    );

    expect(result.activity.cleanMode).toBe('MOP');
  });

  it('should parse error code', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    state.activity.runMode = 'error';
    const result = parser.processProperties(
      [{ siid: 2, piid: 2, value: 5 }],
      state,
    );
    expect(result.activity.activeError).toBe('Error 5');
    expect(result.activity.activeErrorCode).toBe(5);
    expect(result.activity.runMode).toBe('error');
  });

  it('should ignore stale error code while the robot reports mop maintenance', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [
        { siid: 2, piid: 1, value: 8 },
        { siid: 2, piid: 2, value: 68 },
      ],
      state,
    );
    expect(result.activity.runMode).toBe('maintenance');
    expect(result.activity.maintenanceType).toBe('cleaning_mop');
    expect(result.activity.activeError).toBeNull();
    expect(result.activity.activeErrorCode).toBeUndefined();
  });

  it('should clear error on code 0', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    state.activity.activeError = 'Error 5';
    state.activity.activeErrorCode = 5;
    const result = parser.processProperties(
      [{ siid: 2, piid: 2, value: 0 }],
      state,
    );
    expect(result.activity.activeError).toBeNull();
  });

  it('should process multiple properties at once', () => {
    const parser = new StateParser(logger);
    const state = createInitialState(identity);
    const result = parser.processProperties(
      [
        { siid: 2, piid: 1, value: 1 },
        { siid: 3, piid: 1, value: 72 },
        { siid: 4, piid: 4, value: 2 },
        { siid: 4, piid: 23, value: 1 },
      ],
      state,
    );
    expect(result.activity.runMode).toBe('cleaning');
    expect(result.power.batteryPercent).toBe(72);
    expect(result.activity.suctionLevel).toBe(2);
    expect(result.activity.cleanMode).toBe('MOP');
  });
});
