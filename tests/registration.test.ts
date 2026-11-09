import { describe, expect, it, vi } from 'vitest';
import { buildMatterAccessory, reattachHandlers } from '../src/registration';
import { createInitialState } from '../src/dreame/models';

function createFixture(cleanGeniusMode?: number) {
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
    handleCleaningProfile: vi.fn().mockResolvedValue(undefined),
    handleAreaSelection: vi.fn().mockResolvedValue(undefined),
    handleSkipArea: vi.fn().mockResolvedValue(undefined),
  };
  const identity = { deviceId: 'dev-1', model: 'dreame.vacuum.test', firmware: '1.0' };
  const state = createInitialState(identity);
  state.activity.cleanGeniusMode = cleanGeniusMode;
  const accessory = buildMatterAccessory(
    matter as any,
    handlers as any,
    identity,
    state,
    'Robot',
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
  )!;

  return { accessory, handlers, updateAccessoryState, matter };
}

describe('Matter command state updates', () => {
  it.each([4, 5])('enables Quiet mode %s without an opt-in setting', async (mode) => {
    const { accessory, handlers, updateAccessoryState } = createFixture();
    await (accessory.handlers as any).rvcCleanMode.changeToMode({ newMode: mode });
    expect(handlers.handleCleaningProfile).toHaveBeenCalledWith('QUIET', mode === 4 ? 'SWEEP' : 'SWEEP_AND_MOP');
    expect(handlers.handleCleaningMode).not.toHaveBeenCalled();
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcCleanMode', { currentMode: mode });
  });

  it('enables profiles after reattaching handlers to an old cached accessory', async () => {
    const { accessory, handlers, matter } = createFixture();
    (accessory.clusters as any).rvcCleanMode.supportedModes = [
      { mode: 0, label: 'Sweep', modeTags: [{ value: 0x4001 }] },
      { mode: 2, label: 'Sweep and Mop', modeTags: [{ value: 0x4001 }, { value: 0x4002 }] },
    ];
    reattachHandlers(accessory, handlers as any, matter as any, { debug: vi.fn() } as any);
    await (accessory.handlers as any).rvcCleanMode.changeToMode({ newMode: 4 });
    await (accessory.handlers as any).rvcCleanMode.changeToMode({ newMode: 2 });
    expect(handlers.handleCleaningProfile).toHaveBeenCalledWith('QUIET', 'SWEEP');
    expect(handlers.handleCleaningProfile).toHaveBeenCalledWith('AUTO', 'SWEEP_AND_MOP');
  });

  it.each([
    [0, 'NORMAL', 'SWEEP'], [1, 'NORMAL', 'MOP'], [2, 'AUTO', 'SWEEP_AND_MOP'],
    [4, 'QUIET', 'SWEEP'], [5, 'QUIET', 'SWEEP_AND_MOP'],
  ] as const)('should route enabled profile %s to its handler', async (mode, profile, cleanMode) => {
    const { accessory, handlers, updateAccessoryState } = createFixture(0);

    await (accessory.handlers as any).rvcCleanMode.changeToMode({ newMode: mode });

    expect(handlers.handleCleaningProfile).toHaveBeenCalledWith(profile, cleanMode);
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcCleanMode', { currentMode: mode });
  });

  it('accepts persisted legacy mode 3 as combined Auto', async () => {
    const { accessory, handlers } = createFixture();
    await (accessory.handlers as any).rvcCleanMode.changeToMode({ newMode: 3 });
    expect(handlers.handleCleaningProfile).toHaveBeenCalledWith('AUTO', 'SWEEP_AND_MOP');
    expect((accessory.clusters as any).rvcCleanMode.supportedModes.map((entry: any) => entry.mode)).toContain(3);
  });
  it('should mark the robot as cleaning and running after start', async () => {
    const { accessory, handlers, updateAccessoryState } = createFixture();

    await (accessory.handlers as any).rvcRunMode.changeToMode({ newMode: 0x01 });

    expect(handlers.handleStartCommand).toHaveBeenCalledWith(false);
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcRunMode', { currentMode: 0x01 });
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcOperationalState', { operationalState: 0x01 });
  });

  it('reports the dock command with idle run mode and seeking-charger state', async () => {
    const { accessory, handlers, updateAccessoryState } = createFixture();

    await (accessory.handlers as any).rvcOperationalState.goHome();

    expect(handlers.handleGoHomeCommand).toHaveBeenCalledOnce();
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcRunMode', { currentMode: 0x00 });
    expect(updateAccessoryState).toHaveBeenCalledWith('matter-uuid', 'rvcOperationalState', { operationalState: 0x40 });
  });

  it.each([0x02, 0x03, 0xff])('rejects unsupported run mode command %s', async (newMode) => {
    const { accessory, handlers, updateAccessoryState } = createFixture();

    await expect((accessory.handlers as any).rvcRunMode.changeToMode({ newMode })).rejects.toThrow('Unsupported Dreame run mode');

    expect(handlers.handleGoHomeCommand).not.toHaveBeenCalled();
    expect(updateAccessoryState).not.toHaveBeenCalled();
  });

  it('rejects malformed selections without clearing existing rooms', async () => {
    const { accessory, handlers, updateAccessoryState } = createFixture();
    await expect((accessory.handlers as any).serviceArea.selectAreas({ newAreas: [1, '2'] })).rejects.toThrow('Invalid Matter area selection');
    expect(handlers.handleAreaSelection).not.toHaveBeenCalled();
    expect(updateAccessoryState).not.toHaveBeenCalled();
  });

  it('sends each area only once and still accepts explicit empty selections', async () => {
    const { accessory, handlers, updateAccessoryState } = createFixture();
    await (accessory.handlers as any).serviceArea.selectAreas({ newAreas: [3, 3, 1] });
    expect(handlers.handleAreaSelection).toHaveBeenLastCalledWith([3, 1]);
    expect(updateAccessoryState).toHaveBeenLastCalledWith('matter-uuid', 'serviceArea', { selectedAreas: [3, 1] });
    await (accessory.handlers as any).serviceArea.selectAreas({ newAreas: [] });
    expect(handlers.handleAreaSelection).toHaveBeenLastCalledWith([]);
  });
});
