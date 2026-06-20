import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatterCommandHandlers } from '../src/matter/handlers';
import { MIOT } from '../src/dreame/models';
import { DreameCleaningModeCodec } from '../src/dreame/cleaning-mode';

function createMockCloud() {
  return {
    action: vi.fn().mockResolvedValue(undefined),
    setProperties: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

function findStartCustomCall(cloud: ReturnType<typeof createMockCloud>) {
  return cloud.action.mock.calls.find(
    (call: any[]) =>
      call[1] === MIOT.VACUUM.siid
      && call[2] === MIOT.VACUUM.START_CUSTOM
      && Array.isArray(call[3])
      && call[3].some((item: any) => item.piid === MIOT.VACUUM.CLEANING_PROPERTIES),
  );
}

function parseStartCustomSelects(call: any[]) {
  const cleaningProperty = call[3].find((item: any) => item.piid === MIOT.VACUUM.CLEANING_PROPERTIES);
  return JSON.parse(cleaningProperty.value).selects;
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
      expect(cloud.action).toHaveBeenCalledWith('dev-1', 2, 1);
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
      expect(cloud.action).toHaveBeenCalledWith('dev-1', 4, 2);
    });
  });

  describe('handlePauseCommand', () => {
    it('should send PAUSE action', async () => {
      await handlers.handlePauseCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', 2, 2);
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
      expect(cloud.action).toHaveBeenCalledWith('dev-1', 2, 1);
    });
  });

  describe('handleGoHomeCommand', () => {
    it('should send DOCK action on charge service', async () => {
      await handlers.handleGoHomeCommand();
      expect(cloud.action).toHaveBeenCalledWith('dev-1', 3, 1);
    });

    it('should reject a failed DOCK response', async () => {
      cloud.action.mockResolvedValueOnce({ code: -1 });

      await expect(handlers.handleGoHomeCommand()).rejects.toThrow('DOCK returned Dreame code -1');
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
      expect(cloud.action).toHaveBeenCalledWith('dev-1', 7, 1);
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

    it('should encode modes for robots with lifting mop pads', async () => {
      const codec = new DreameCleaningModeCodec();
      codec.configureLiftingMopPads(true);
      handlers.setCleaningModeCodec(codec);

      await handlers.handleCleaningMode('SWEEP');

      expect(cloud.setProperties).toHaveBeenCalledWith('dev-1', [
        { did: 'dev-1', siid: MIOT.VACUUM.siid, piid: MIOT.VACUUM.CLEAN_MODE, value: 2 },
      ]);
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('lifting-mop encoding'));
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
      cloud.action.mockClear();
      await handlers.handleStartCommand();

      const startCustomCall = findStartCustomCall(cloud);
      expect(startCustomCall).toBeDefined();
      const selects = parseStartCustomSelects(startCustomCall!);
      expect(selects).toHaveLength(3);
      expect(selects[0][0]).toBe(1);
      expect(selects[1][0]).toBe(3);
      expect(selects[2][0]).toBe(5);
    });

    it('should preserve selected rooms after start', async () => {
      await handlers.handleRoomSelection([1, 2]);
      await handlers.handleStartCommand();
      cloud.action.mockClear();

      // Matter selection remains active until the controller changes it.
      await handlers.handleStartCommand();
      expect(findStartCustomCall(cloud)).toBeDefined();
    });

    it('should clear selection with empty array', async () => {
      await handlers.handleRoomSelection([1, 2]);
      await handlers.handleRoomSelection([]);
      cloud.action.mockClear();

      await handlers.handleStartCommand();
      expect(findStartCustomCall(cloud)).toBeUndefined();
    });

    it('should use current suction/water levels in room clean params', async () => {
      await handlers.handleSuctionLevel(3);
      await handlers.handleWaterLevel(3);
      await handlers.handleRoomSelection([10]);
      cloud.action.mockClear();

      await handlers.handleStartCommand();
      const startCustomCall = findStartCustomCall(cloud);
      const selects = parseStartCustomSelects(startCustomCall!);
      // [roomId, repeat, suction, water, index]
      expect(selects[0]).toEqual([10, 1, 3, 3, 1]);
    });

    it('should use customized-cleaning index 1 for every selected room', async () => {
      await handlers.handleRoomSelection([3, 5]);
      cloud.action.mockClear();

      await handlers.handleStartCommand();

      expect(parseStartCustomSelects(findStartCustomCall(cloud)!)).toEqual([
        [3, 1, 1, 2, 1],
        [5, 1, 1, 2, 1],
      ]);
    });

    it('should not set the global clean mode before a room-cleaning task', async () => {
      await handlers.handleRoomSelection([3]);
      cloud.setProperties.mockClear();

      await handlers.handleStartCommand();

      expect(cloud.setProperties).not.toHaveBeenCalled();
    });

    it('should preserve pendingRoomIds if START action fails', async () => {
      await handlers.handleRoomSelection([1, 2]);
      cloud.action.mockRejectedValueOnce(new Error('network error'));

      await expect(handlers.handleStartCommand()).rejects.toThrow('network error');

      // Rooms should still be pending — retry should send them again
      cloud.action.mockResolvedValueOnce(undefined);
      await handlers.handleStartCommand();

      expect(findStartCustomCall(cloud)).toBeDefined();
    });

    it('should reject a non-zero Dreame START_CUSTOM response', async () => {
      await handlers.handleRoomSelection([1]);
      cloud.action.mockResolvedValueOnce({ code: -1 });

      await expect(handlers.handleStartCommand()).rejects.toThrow('START_CUSTOM returned Dreame code -1');
    });

    it('should map Matter area IDs to Dreame segment IDs', async () => {
      handlers.setAreaIdToRoomTargetMap(new Map([[100, { areaId: 100, mapId: 10, segmentId: '7' }]]));
      handlers.syncCurrentMapId(10);
      await handlers.handleAreaSelection([100]);
      cloud.action.mockClear();

      await handlers.handleStartCommand();
      const startCustomCall = findStartCustomCall(cloud);
      const selects = parseStartCustomSelects(startCustomCall!);
      expect(selects[0][0]).toBe(7);
    });

    it('should sync resolved room selection to accessory state', async () => {
      const cb = vi.fn();
      handlers.setAreaIdToRoomTargetMap(new Map([[100, { areaId: 100, mapId: 10, segmentId: '7' }]]));
      handlers.setOnAreaSelectionChanged(cb);

      await handlers.handleAreaSelection([100]);

      expect(cb).toHaveBeenCalledWith(['100']);
    });

    it('should reject rooms from multiple maps in one task', async () => {
      handlers.setAreaIdToRoomTargetMap(new Map([
        [100, { areaId: 100, mapId: 10, segmentId: '7' }],
        [200, { areaId: 200, mapId: 20, segmentId: '8' }],
      ]));

      await expect(handlers.handleAreaSelection([100, 200])).rejects.toThrow('multiple maps');
    });

    it('should reject a room task when its map is not active', async () => {
      handlers.setAreaIdToRoomTargetMap(new Map([[100, { areaId: 100, mapId: 20, segmentId: '7' }]]));
      handlers.syncCurrentMapId(10);
      await handlers.handleAreaSelection([100]);

      await expect(handlers.handleStartCommand()).rejects.toThrow('current map is 10');
      expect(findStartCustomCall(cloud)).toBeUndefined();
    });
  });

  describe('handleSkipArea', () => {
    it('should reject skip without changing the selected rooms', async () => {
      handlers.setAreaIdToRoomTargetMap(new Map([[100, { areaId: 100, mapId: 10, segmentId: '7' }]]));
      await handlers.handleAreaSelection([100]);

      await expect(handlers.handleSkipArea(100)).rejects.toThrow('not supported');

      cloud.action.mockClear();
      await handlers.handleStartCommand();
      expect(parseStartCustomSelects(findStartCustomCall(cloud)!)[0][0]).toBe(7);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('map:10/segment:7'));
    });
  });

  describe('syncLevelsFromDevice', () => {
    it('should update suction and water levels from device state', async () => {
      handlers.syncLevelsFromDevice(3, 3);
      await handlers.handleRoomSelection([10]);
      cloud.action.mockClear();

      await handlers.handleStartCommand();
      const startCustomCall = findStartCustomCall(cloud);
      const selects = parseStartCustomSelects(startCustomCall!);
      expect(selects[0]).toEqual([10, 1, 3, 3, 1]);
    });
  });
});
