import { describe, expect, it, vi } from 'vitest';
import { resolveCapabilities, normalizeDeviceState } from '../src/dreame/capabilities';
import { HA_CAPABILITIES } from '../src/dreame/ha-capabilities.generated';
import { createInitialState } from '../src/dreame/models';
import { StateParser } from '../src/dreame/parser';
import { DreameCleaningModeCodec } from '../src/dreame/cleaning-mode';
import { MatterCommandHandlers } from '../src/matter/handlers';
import { DreameVacuumAccessory } from '../src/matter/accessory';
import { buildMatterAccessory } from '../src/registration';

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

function fixture(model = 'dreame.vacuum.r2380r') {
  const state = createInitialState({ deviceId: 'test', model, firmware: '4.3.9_2000' });
  const cloud = {
    getProperties: vi.fn(async () => [] as any[]),
    setProperties: vi.fn(async () => [{ code: 0 }]),
    action: vi.fn(async () => ({ code: 0 })),
  };
  const codec = new DreameCleaningModeCodec();
  codec.configureLiftingMopPads(state.capabilities.liftingMopPads === true, state.capabilities.knownModel);
  const handlers = new MatterCommandHandlers(cloud as any, 'test', log, 'SWEEP_AND_MOP', codec);
  handlers.syncCapabilities(state.capabilities);
  const accessory = new DreameVacuumAccessory(log, 'test', state, {} as any);
  handlers.setOnCleaningProfileSelected((profile, mode) => accessory.applyUserCleaningProfile(profile, mode));
  const matter = { uuid: { generate: () => 'test' }, deviceTypes: { RoboticVacuumCleaner: 'rvc' }, updateAccessoryState: vi.fn() };
  const commands = buildMatterAccessory(matter as any, handlers, state.identity, state, 'Test', log)!.handlers as any;
  return { state, cloud, handlers, codec, accessory, commands, matter };
}

describe('HA capability snapshot', () => {
  it('imports only the reviewed flag thresholds, without keys or resources', () => {
    expect(Object.keys(HA_CAPABILITIES.models)).toHaveLength(628);
    expect(Object.keys(HA_CAPABILITIES)).toEqual(['revision', 'flags', 'profiles', 'models']);
    for (const profile of HA_CAPABILITIES.profiles) {
      expect(profile).toHaveLength(7);
      expect(profile.every((value) => value === null || Number.isInteger(value))).toBe(true);
    }
  });

  it.each(['dreame.vacuum.r2380', 'dreame.vacuum.r2380r'])('does not invent CleanGenius or lifting for M1 %s', (model) => {
    expect(resolveCapabilities(model, '4.3.9_2000')).toMatchObject({ knownModel: true, cleanGenius: false, liftingMopPads: false, newState: false });
  });

  it('retains CleanGenius and lifting for the L10s Ultra Gen 2', () => {
    expect(resolveCapabilities('dreame.vacuum.r2469x', '4.3.9_2000')).toMatchObject({ knownModel: true, cleanGenius: true, liftingMopPads: true, newState: true });
  });

  it('honors firmware thresholds, including an unknown firmware build', () => {
    const column = HA_CAPABILITIES.flags.indexOf('CLEANGENIUS');
    const [model, index] = Object.entries(HA_CAPABILITIES.models).find(([, index]) => (HA_CAPABILITIES.profiles[index]![column] ?? 0) > 1)!;
    const threshold = HA_CAPABILITIES.profiles[index]![column]!;
    expect(resolveCapabilities(`dreame.vacuum.${model}`, `4.3.9_${threshold - 1}`).cleanGenius).toBe(false);
    expect(resolveCapabilities(`dreame.vacuum.${model}`, `4.3.9_${threshold}`).cleanGenius).toBe(true);
    expect(resolveCapabilities(`dreame.vacuum.${model}`, 'unknown').cleanGenius).toBe(false);
  });

  it.each(['dreame.vacuum.unknown', 'other.vacuum.r2380r'])('does not assume advanced features for %s', (model) => {
    expect(resolveCapabilities(model, '2000')).toEqual({ knownModel: false });
  });

  it.each([[19, 23], [23, 21], [24, 22], [25, 19], [26, 24]])('translates legacy state %s into canonical %s', (raw, expected) => {
    expect(normalizeDeviceState(raw, resolveCapabilities('dreame.vacuum.r2380r', '2000'))).toBe(expected);
    expect(normalizeDeviceState(raw, resolveCapabilities('dreame.vacuum.r2469x', '2000'))).toBe(raw);
  });

  it('normalizes M1 remote control before generating maintenance or dock state', () => {
    const state = createInitialState({ deviceId: 'test', model: 'dreame.vacuum.r2380r', firmware: '2000' });
    state.power.docked = false;
    const next = new StateParser(log).processProperties([{ siid: 2, piid: 1, value: 19 }], state);
    expect(next.activity.rawDeviceState).toBe(23);
    expect(next.activity.maintenanceType).toBeUndefined();
    expect(next.power.docked).toBe(false);
  });
});

describe('Capability-aware Matter commands', () => {
  it.each([2, 3])('routes combined Auto %s to normal manual cleaning on the M1', async (modeId) => {
    const { commands, cloud, state, accessory } = fixture();
    await commands.rvcCleanMode.changeToMode({ newMode: modeId });
    await commands.rvcRunMode.changeToMode({ newMode: 1 });
    expect(cloud.getProperties).not.toHaveBeenCalled();
    expect(cloud.setProperties).toHaveBeenCalledWith('test', [{ did: 'test', siid: 4, piid: 23, value: 2 }]);
    expect(cloud.setProperties).toHaveBeenCalledWith('test', [{ did: 'test', siid: 4, piid: 4, value: 1 }]);
    expect(cloud.setProperties.mock.calls.some((call) => call[1].some((prop) => prop.piid === 50))).toBe(false);
    expect(state.activity.cleanGeniusMode).toBe(0);
    expect(cloud.action).toHaveBeenCalledWith('test', 2, 1);
    accessory.dispose();
  });

  it('retains Quiet at minimum suction on the M1 without requiring SmartHost', async () => {
    const { commands, cloud, accessory } = fixture();
    await commands.rvcCleanMode.changeToMode({ newMode: 5 });
    await commands.rvcRunMode.changeToMode({ newMode: 1 });
    expect(cloud.getProperties).not.toHaveBeenCalled();
    expect(cloud.setProperties).toHaveBeenCalledWith('test', [{ did: 'test', siid: 4, piid: 4, value: 0 }]);
    accessory.dispose();
  });

  it('continues to use CleanGenius for combined Auto on a supported L10s', async () => {
    const { commands, cloud, accessory } = fixture('dreame.vacuum.r2469x');
    let smartHost = 0;
    cloud.getProperties.mockImplementation(async () => [{ siid: 4, piid: 50, value: [{ k: 'SmartHost', v: smartHost }] }]);
    cloud.setProperties.mockImplementation(async (_id, properties) => {
      const setting = properties.find((prop) => prop.piid === 50);
      if (setting) smartHost = JSON.parse(setting.value as string).v;
      return [{ code: 0 }];
    });
    await commands.rvcCleanMode.changeToMode({ newMode: 2 });
    await commands.rvcRunMode.changeToMode({ newMode: 1 });
    expect(smartHost).toBe(1);
    expect(cloud.action).toHaveBeenCalledWith('test', 2, 1);
    accessory.dispose();
  });

  it.each([['SWEEP', true, 'Remove'], ['MOP', false, 'Install'], ['SWEEP_AND_MOP', false, 'Install']] as const)('rejects %s with incompatible tank state', async (mode, installed, message) => {
    const { state, handlers, cloud, accessory } = fixture();
    handlers.syncCapabilities({ ...state.capabilities, waterTankInstalled: installed });
    await expect(handlers.handleCleaningMode(mode)).rejects.toThrow(message);
    expect(cloud.setProperties).not.toHaveBeenCalled();
    expect(cloud.action).not.toHaveBeenCalled();
    accessory.dispose();
  });

  it('allows basic Start when the robot explicitly has no writable cleaning mode', async () => {
    const { state, handlers, cloud, accessory } = fixture();
    handlers.syncCapabilities({ ...state.capabilities, cleaningModeSupported: false });
    handlers.resolveCleaningProfileForState('NORMAL');
    await handlers.handleStartCommand();
    expect(cloud.setProperties).not.toHaveBeenCalled();
    expect(cloud.action).toHaveBeenCalledExactlyOnceWith('test', 2, 1);
    await expect(handlers.handleCleaningProfile('NORMAL', 'SWEEP')).rejects.toThrow('not supported');
    accessory.dispose();
  });

  it('preserves device settings on a basic Start even if a writable mode is available', async () => {
    const { handlers, cloud, accessory } = fixture();
    handlers.resolveCleaningProfileForState('QUIET');
    await handlers.handleStartCommand();
    expect(cloud.getProperties).not.toHaveBeenCalled();
    expect(cloud.setProperties).not.toHaveBeenCalled();
    expect(cloud.action).toHaveBeenCalledExactlyOnceWith('test', 2, 1);
    accessory.dispose();
  });

  it('uses ordered segment indexes for older non-customized robots', async () => {
    const { state, handlers, cloud, accessory } = fixture();
    handlers.syncCapabilities({ ...state.capabilities, customizedCleaningSupported: false });
    await handlers.handleRoomSelection([1, 2]);
    await handlers.handleStartCommand();
    const args = cloud.action.mock.calls[0] as any;
    expect(JSON.parse(args[3][1].value).selects.map((room: number[]) => room[4])).toEqual([1, 2]);
    accessory.dispose();
  });
});
