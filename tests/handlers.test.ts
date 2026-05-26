import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatterCommandHandlers } from '../src/matter/handlers';
import { MIOT } from '../src/dreame/models';

function createMockCloud() {
  return {
    action: vi.fn().mockResolvedValue(undefined),
    setProperties: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe('MatterCommandHandlers', () => {
  let cloud: ReturnType<typeof createMockCloud>;
  let log: ReturnType<typeof createMockLogger>;
  let handlers: MatterCommandHandlers;

  beforeEach(() => {
    cloud = createMockCloud();
    log = createMockLogger();
    handlers = new MatterCommandHandlers(cloud, 'dev-1', log);
  });

  describe('handleStartCommand', () => {
    it('should set cleaning mode then send START action', async () => {
      await handlers.handleStartCommand();

      expect(cloud.setProperties).toHaveBeenCalledWith('dev-1', [
        { did: 'dev-1', siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: 2 },
      ]);
      expect(cloud.action).toHaveBeenCalledWith('dev-1', MIOT.VACUUM.siid, MIOT.ACTION.START);
    });

    it('should use the configured clean mode', async () => {
      await handlers.handleCleaningMode('SWEEP');
      cloud.setProperties.mockClear();

      await handlers.handleStartCommand();

      expect(cloud.setProperties).toHaveBeenCalledWith('dev-1', [
        { did: 'dev-1', siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: 0 },
      ]);
    });
  });

  describe('handleStopCommand', () => {
    it('should send STOP action', async () => {
      await handlers.handleStopCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', MIOT.VACUUM.siid, MIOT.ACTION.STOP);
    });
  });

  describe('handlePauseCommand', () => {
    it('should send PAUSE action', async () => {
      await handlers.handlePauseCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', MIOT.VACUUM.siid, MIOT.ACTION.PAUSE);
    });

    it('should suppress pause after start command', async () => {
      await handlers.handleStartCommand();
      cloud.action.mockClear();

      await handlers.handlePauseCommand();
      expect(cloud.action).not.toHaveBeenCalled();
    });
  });

  describe('handleResumeCommand', () => {
    it('should send START action', async () => {
      await handlers.handleResumeCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', MIOT.VACUUM.siid, MIOT.ACTION.START);
    });
  });

  describe('handleGoHomeCommand', () => {
    it('should send DOCK action on charge service', async () => {
      await handlers.handleGoHomeCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', MIOT.CHARGE.siid, MIOT.ACTION.DOCK);
    });

    it('should suppress pause', async () => {
      await handlers.handleGoHomeCommand();
      cloud.action.mockClear();

      await handlers.handlePauseCommand();
      expect(cloud.action).not.toHaveBeenCalled();
    });
  });

  describe('handleLocateCommand', () => {
    it('should send LOCATE action', async () => {
      await handlers.handleLocateCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', MIOT.LOCATE.siid, MIOT.ACTION.LOCATE);
    });

    it('should not throw when locate is unsupported', async () => {
      cloud.action.mockRejectedValueOnce(new Error('unsupported'));

      await expect(handlers.handleLocateCommand()).resolves.not.toThrow();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('unsupported'));
    });

    it('should warn when Dreame returns a non-zero locate code', async () => {
      cloud.action.mockResolvedValueOnce({ did: 'dev-1', siid: MIOT.LOCATE.siid, code: -1 });

      await expect(handlers.handleLocateCommand()).resolves.not.toThrow();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Dreame code -1'));
    });
  });

  describe('handleCleaningMode', () => {
    it('should set mode via cloud properties', async () => {
      await handlers.handleCleaningMode('MOP');
      expect(cloud.setProperties).toHaveBeenCalledWith('dev-1', [
        { did: 'dev-1', siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: 1 },
      ]);
    });

    it('should invoke onCleanModeSelected callback', async () => {
      const cb = vi.fn();
      handlers.setOnCleanModeSelected(cb);

      await handlers.handleCleaningMode('SWEEP');
      expect(cb).toHaveBeenCalledWith('SWEEP');
    });

    it('should not throw if callback throws', async () => {
      handlers.setOnCleanModeSelected(() => { throw new Error('boom'); });
      await expect(handlers.handleCleaningMode('MOP')).resolves.not.toThrow();
    });
  });

  describe('echo suppression', () => {
    it('should suppress device-reported mode after user command', async () => {
      await handlers.handleCleaningMode('SWEEP');

      // During suppression, resolveCleanModeForState returns user-set mode
      expect(handlers.resolveCleanModeForState('MOP')).toBe('SWEEP');
      expect(handlers.isCleanModeSuppressionActive()).toBe(true);
    });

    it('should not suppress when no command was sent', () => {
      expect(handlers.isCleanModeSuppressionActive()).toBe(false);
      expect(handlers.resolveCleanModeForState('MOP')).toBe('MOP');
    });

    it('should ignore syncCleanModeFromDevice during suppression', async () => {
      await handlers.handleCleaningMode('SWEEP');

      handlers.syncCleanModeFromDevice('MOP');
      // Mode should still be SWEEP
      expect(handlers.resolveCleanModeForState('MOP')).toBe('SWEEP');
    });

    it('should accept syncCleanModeFromDevice when not suppressed', () => {
      handlers.syncCleanModeFromDevice('MOP');
      // Next start should use MOP
      expect(handlers.resolveCleanModeForState('SWEEP')).toBe('SWEEP');
    });
  });

  describe('handleSuctionLevel', () => {
    it('should set suction property', async () => {
      await handlers.handleSuctionLevel(3);
      expect(cloud.setProperties).toHaveBeenCalledWith('dev-1', [
        { did: 'dev-1', siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.SUCTION, value: 3 },
      ]);
    });
  });

  describe('handleWaterLevel', () => {
    it('should set water property', async () => {
      await handlers.handleWaterLevel(1);
      expect(cloud.setProperties).toHaveBeenCalledWith('dev-1', [
        { did: 'dev-1', siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.WATER, value: 1 },
      ]);
    });
  });

  describe('handleRoomSelection', () => {
    it('should store pending room IDs', async () => {
      await handlers.handleRoomSelection([1, 3, 5]);
      // Verify by starting — should send cleaning properties
      cloud.setProperties.mockClear();
      await handlers.handleStartCommand();

      // Should have set CLEANING_PROPERTIES with room selects
      const cleaningPropsCall = cloud.setProperties.mock.calls.find(
        (call: any[]) => call[1]?.[0]?.piid === MIOT.VACUUM.CLEANING_PROPERTIES,
      );
      expect(cleaningPropsCall).toBeDefined();
      const payload = JSON.parse(cleaningPropsCall![1][0].value);
      expect(payload.selects).toHaveLength(3);
      expect(payload.selects[0][0]).toBe(1);
      expect(payload.selects[1][0]).toBe(3);
      expect(payload.selects[2][0]).toBe(5);
    });

    it('should clear pending rooms after start', async () => {
      await handlers.handleRoomSelection([1, 2]);
      await handlers.handleStartCommand();
      cloud.setProperties.mockClear();
      cloud.action.mockClear();

      // Second start should not send cleaning properties
      await handlers.handleStartCommand();
      const cleaningPropsCall = cloud.setProperties.mock.calls.find(
        (call: any[]) => call[1]?.[0]?.piid === MIOT.VACUUM.CLEANING_PROPERTIES,
      );
      expect(cleaningPropsCall).toBeUndefined();
    });

    it('should clear selection with empty array', async () => {
      await handlers.handleRoomSelection([1, 2]);
      await handlers.handleRoomSelection([]);
      cloud.setProperties.mockClear();

      await handlers.handleStartCommand();
      const cleaningPropsCall = cloud.setProperties.mock.calls.find(
        (call: any[]) => call[1]?.[0]?.piid === MIOT.VACUUM.CLEANING_PROPERTIES,
      );
      expect(cleaningPropsCall).toBeUndefined();
    });

    it('should use current suction/water levels in room clean params', async () => {
      await handlers.handleSuctionLevel(3);
      await handlers.handleWaterLevel(3);
      await handlers.handleRoomSelection([10]);
      cloud.setProperties.mockClear();

      await handlers.handleStartCommand();
      const cleaningPropsCall = cloud.setProperties.mock.calls.find(
        (call: any[]) => call[1]?.[0]?.piid === MIOT.VACUUM.CLEANING_PROPERTIES,
      );
      const payload = JSON.parse(cleaningPropsCall![1][0].value);
      // [roomId, repeat, suction, water, index]
      expect(payload.selects[0]).toEqual([10, 1, 3, 3, 1]);
    });

    it('should preserve pendingRoomIds if START action fails', async () => {
      await handlers.handleRoomSelection([1, 2]);
      cloud.action.mockRejectedValueOnce(new Error('network error'));

      await expect(handlers.handleStartCommand()).rejects.toThrow('network error');

      // Rooms should still be pending — retry should send them again
      cloud.setProperties.mockClear();
      cloud.action.mockResolvedValueOnce(undefined);
      await handlers.handleStartCommand();

      const cleaningPropsCall = cloud.setProperties.mock.calls.find(
        (call: any[]) => call[1]?.[0]?.piid === MIOT.VACUUM.CLEANING_PROPERTIES,
      );
      expect(cleaningPropsCall).toBeDefined();
    });
  });

  describe('syncLevelsFromDevice', () => {
    it('should update suction and water levels from device state', async () => {
      handlers.syncLevelsFromDevice(3, 3);
      await handlers.handleRoomSelection([10]);
      cloud.setProperties.mockClear();

      await handlers.handleStartCommand();
      const cleaningPropsCall = cloud.setProperties.mock.calls.find(
        (call: any[]) => call[1]?.[0]?.piid === MIOT.VACUUM.CLEANING_PROPERTIES,
      );
      const payload = JSON.parse(cleaningPropsCall![1][0].value);
      expect(payload.selects[0]).toEqual([10, 1, 3, 3, 1]);
    });
  });
});
