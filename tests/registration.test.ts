import { describe, expect, it, vi } from 'vitest';
import { buildMatterAccessory } from '../src/registration';
import { createInitialState } from '../src/dreame/models';

function createFixture() {
  const updateAccessoryState = vi.fn().mockResolvedValue(undefined);
  const matter = {
    uuid: { generate: vi.fn(() => 'matter-uuid') },
    deviceTypes: { RoboticVacuumCleaner: 'RoboticVacuumCleaner' },
    clusterNames: {
      RvcRunMode: 'rvcRunMode',
      RvcOperationalState: 'rvcOperationalState',
    },
    updateAccessoryState,
  };
  const handlers = {
    handleStopCommand: vi.fn().mockResolvedValue(undefined),
    handleStartCommand: vi.fn().mockResolvedValue(undefined),
    handleGoHomeCommand: vi.fn().mockResolvedValue(undefined),
    handlePauseCommand: vi.fn().mockResolvedValue(undefined),
    handleResumeCommand: vi.fn().mockResolvedValue(undefined),
    handleLocateCommand: vi.fn().mockResolvedValue(undefined),
    handleCleaningMode: vi.fn().mockResolvedValue(undefined),
    handleAreaSelection: vi.fn().mockResolvedValue(undefined),
    handleSkipArea: vi.fn().mockResolvedValue(undefined),
  };
  const identity = { deviceId: 'dev-1', model: 'dreame.vacuum.test', firmware: '1.0' };
  const accessory = buildMatterAccessory(
    matter as any,
    handlers as any,
    identity,
    createInitialState(identity),
    'Robot',
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
  )!;

  return { accessory, handlers, updateAccessoryState };
}

describe('Matter command state updates', () => {
  it('should mark the robot as cleaning and running after start', async () => {
    const { accessory, handlers, updateAccessoryState } = createFixture();

    await (accessory.handlers as any).rvcRunMode.changeToMode({ newMode: 0x01 });

    expect(handlers.handleStartCommand).toHaveBeenCalledWith(false);
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcRunMode', { currentMode: 0x01 });
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcOperationalState', { operationalState: 0x01 });
  });

  it('should mark the robot as returning and seeking its charger', async () => {
    const { accessory, handlers, updateAccessoryState } = createFixture();

    await (accessory.handlers as any).rvcOperationalState.goHome();

    expect(handlers.handleGoHomeCommand).toHaveBeenCalledOnce();
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcRunMode', { currentMode: 0x02 });
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcOperationalState', { operationalState: 0x40 });
  });
});
