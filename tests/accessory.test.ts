import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DreameVacuumAccessory } from '../src/matter/accessory';
import { createInitialState } from '../src/dreame/models';

const identity = { deviceId: 'test-123', model: 'dreame.vacuum.test', firmware: '1.0' };

function createMockApi(updateFn?: (...args: unknown[]) => void | Promise<void>) {
  return {
    hap: {
      Service: {
        AccessoryInformation: 'AccessoryInformation',
        Switch: 'Switch',
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        FirmwareRevision: 'FirmwareRevision',
      },
    },
    matter: {
      updateAccessoryState: updateFn ?? vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function createMockAccessory() {
  const infoService = {
    setCharacteristic: vi.fn().mockReturnThis(),
  };
  return {
    UUID: 'test-uuid-123',
    displayName: 'Test Vacuum',
    getService: vi.fn((name: string) => name === 'AccessoryInformation' ? infoService : null),
    removeService: vi.fn(),
  } as any;
}

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe('DreameVacuumAccessory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('debounced sync', () => {
    it('should not push immediately on state update', () => {
      const updateFn = vi.fn().mockResolvedValue(undefined);
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        createMockLogger(), createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();

      // Drain the initial sync from markRegistered
      vi.advanceTimersByTime(100);
      updateFn.mockClear();

      const newState = createInitialState(identity);
      newState.power.batteryPercent = 50;
      accessory.onStateUpdate(newState);

      // Should not have pushed yet (debounce window)
      expect(updateFn).not.toHaveBeenCalled();
    });

    it('should push after 100ms debounce window', async () => {
      const updateFn = vi.fn().mockResolvedValue(undefined);
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        createMockLogger(), createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();
      vi.advanceTimersByTime(100);
      await vi.waitFor(() => expect(updateFn).toHaveBeenCalled());
      updateFn.mockClear();

      const newState = createInitialState(identity);
      newState.power.batteryPercent = 50;
      accessory.onStateUpdate(newState);

      vi.advanceTimersByTime(100);
      await vi.waitFor(() => expect(updateFn).toHaveBeenCalled());
    });

    it('should coalesce rapid updates into single push', async () => {
      const updateFn = vi.fn().mockResolvedValue(undefined);
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        createMockLogger(), createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();
      vi.advanceTimersByTime(100);
      await vi.waitFor(() => expect(updateFn).toHaveBeenCalled());
      updateFn.mockClear();

      // Fire 5 updates in quick succession
      for (let i = 1; i <= 5; i++) {
        const s = createInitialState(identity);
        s.power.batteryPercent = i * 10;
        accessory.onStateUpdate(s);
      }

      vi.advanceTimersByTime(100);
      await vi.waitFor(() => expect(updateFn).toHaveBeenCalled());

      // Should have pushed only once (not 5 times) — one push covers ~5 clusters
      // So total calls = number of clusters (4-5), not 5 * clusters
      const callCount = updateFn.mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(5); // max 5 clusters
    });
  });

  describe('periodic sync', () => {
    it('should re-push state every 60s even if unchanged', async () => {
      const updateFn = vi.fn().mockResolvedValue(undefined);
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        createMockLogger(), createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();

      // Drain initial sync
      await vi.advanceTimersByTimeAsync(100);
      const initialCallCount = updateFn.mock.calls.length;
      expect(initialCallCount).toBeGreaterThan(0);

      // Advance 60s — periodic sync clears dedup cache and re-pushes
      // periodic timer fires at 60s, then debounce at +100ms
      await vi.advanceTimersByTimeAsync(60_100);
      expect(updateFn.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('parallel cluster pushes', () => {
    it('should push all clusters in parallel', async () => {
      const callOrder: string[] = [];
      const updateFn = vi.fn(async (_uuid: string, cluster: string) => {
        callOrder.push(cluster);
      });
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        createMockLogger(), createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();

      vi.advanceTimersByTime(100);
      await vi.waitFor(() => expect(updateFn).toHaveBeenCalled());

      // Should have pushed multiple clusters
      expect(callOrder.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle per-cluster timeout gracefully', async () => {
      const log = createMockLogger();
      const updateFn = vi.fn(async (_uuid: string, cluster: string) => {
        if (cluster === 'rvcRunMode') {
          // Simulate timeout — never resolves within test
          return new Promise(() => {});
        }
      });
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        log, createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();

      // Advance past debounce + timeout
      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(3_000);

      // Should not crash — other clusters should still have been attempted
      await vi.waitFor(() => expect(updateFn).toHaveBeenCalled());
    });
  });

  describe('session error recovery', () => {
    it('should disable pushes after repeated session errors and recover after 60s', async () => {
      const log = createMockLogger();
      const updateFn = vi.fn().mockRejectedValue(new Error('unknown session'));
      const api = createMockApi(updateFn);
      const accessory = new DreameVacuumAccessory(
        log, createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();

      // Each sync cycle: debounce 100ms → doSync → all pushes fail → counter++
      // Then we update state to force a new sync (different state bypasses dedup)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(200);
        const s = createInitialState(identity);
        s.power.batteryPercent = (i + 1) * 10;
        accessory.onStateUpdate(s);
      }

      // Let all retries and debounce settle
      await vi.advanceTimersByTimeAsync(10_000);

      // Should have warned about pausing
      const warned = log.warn.mock.calls.some(
        (call: string[]) => call[0]?.includes('Pausing Matter state pushes'),
      );
      expect(warned).toBe(true);

      // Now let it recover
      updateFn.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(60_200);

      const recovered = log.info.mock.calls.some(
        (call: string[]) => call[0]?.includes('Re-enabling Matter state pushes'),
      );
      expect(recovered).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clean up all timers', () => {
      const api = createMockApi();
      const accessory = new DreameVacuumAccessory(
        createMockLogger(), createMockAccessory(), createInitialState(identity), api,
      );
      accessory.markRegistered();
      accessory.dispose();

      // Should not throw when advancing timers after dispose
      vi.advanceTimersByTime(120_000);
    });
  });
});
