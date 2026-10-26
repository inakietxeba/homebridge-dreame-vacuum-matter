import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatterCommandHandlers } from '../src/matter/handlers';
import { DreameVacuumAccessory } from '../src/matter/accessory';
import { MatterClusterMapper } from '../src/matter/clusters';
import { buildMatterAccessory } from '../src/registration';
import { createInitialState } from '../src/dreame/models';
import { DreameCleaningModeCodec } from '../src/dreame/cleaning-mode';

const identity = { deviceId: 'fake', model: 'test', firmware: '1' };
const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

function fixture(liftingMop = false) {
  const cloud = {
    action: vi.fn().mockResolvedValue({ code: 0 }),
    setProperties: vi.fn().mockResolvedValue([{ code: 0 }]),
    getProperties: vi.fn().mockResolvedValue([]),
  };
  const codec = new DreameCleaningModeCodec();
  codec.configureLiftingMopPads(liftingMop);
  const handlers = new MatterCommandHandlers(cloud as any, 'fake', log, 'SWEEP_AND_MOP', codec);
  const matter = {
    uuid: { generate: () => 'fake' }, deviceTypes: { RoboticVacuumCleaner: 123 },
    updateAccessoryState: vi.fn().mockResolvedValue(undefined),
  };
  const state = createInitialState(identity);
  const accessory = buildMatterAccessory(matter as any, handlers, identity, state, 'Fake', log)!;
  return { cloud, handlers, matter, state, commands: accessory.handlers as any };
}

afterEach(() => vi.useRealTimers());

describe('Command regressions with real handlers', () => {
  it.each([[2, false], [2, true], [3, false], [3, true]] as const)('starts combined Auto %s with CleanGenius (rooms=%s)', async (modeId, rooms) => {
    vi.useFakeTimers();
    const { handlers, commands, cloud, state } = fixture(true);
    let smartHost = 0;
    cloud.getProperties.mockImplementation(async () => [{ siid: 4, piid: 50, value: [{ k: 'SmartHost', v: smartHost }] }] as any);
    cloud.setProperties.mockImplementation(async (_did, properties) => {
      const auto = properties.find((property: any) => property.piid === 50);
      if (auto) smartHost = JSON.parse(auto.value).v;
      return [{ code: 0 }];
    });
    const accessory = new DreameVacuumAccessory(log, 'fake', state, {} as any);
    handlers.setOnCleaningProfileSelected((profile, mode) => accessory.applyUserCleaningProfile(profile, mode));
    await commands.rvcCleanMode.changeToMode({ newMode: modeId });
    expect(smartHost).toBe(1);
    expect(accessory.getCurrentState().activity.cleaningProfile).toBe('AUTO');
    expect(MatterClusterMapper.toMatterState(accessory.getCurrentState()).RvcCleanMode.currentMode).toBe(2);
    if (rooms) await handlers.handleRoomSelection([1]);
    await commands.rvcRunMode.changeToMode({ newMode: 1 });
    expect(cloud.action).toHaveBeenCalledOnce();
    expect(smartHost).toBe(1);
    expect(cloud.setProperties).toHaveBeenCalledExactlyOnceWith('fake', [{ did: 'fake', siid: 4, piid: 50, value: JSON.stringify({ k: 'SmartHost', v: 1 }) }]);
    // CleanGenius may physically vacuum first; the selected profile remains combined Auto.
    accessory.getCurrentState().activity.cleanMode = 'SWEEP';
    expect(MatterClusterMapper.toMatterState(accessory.getCurrentState()).RvcCleanMode.currentMode).toBe(2);
    accessory.dispose();
  });

  it('rejects combined Auto without CleanGenius rather than silently starting manual cleaning', async () => {
    const { commands, cloud, matter } = fixture(true);
    await expect(commands.rvcCleanMode.changeToMode({ newMode: 2 })).rejects.toThrow('not supported');
    expect(cloud.action).not.toHaveBeenCalled();
    expect(matter.updateAccessoryState).not.toHaveBeenCalled();
  });

  it('keeps the previous persisted Auto ID valid by default', () => {
    const { state } = fixture();
    const modes = MatterClusterMapper.toMatterState(state).RvcCleanMode.supportedModes as Array<{ mode: number; modeTags: Array<{ value: number }> }>;
    // Matter validates stored currentMode/startUpMode/onMode against this list at startup.
    expect(modes.some((mode) => mode.mode === 3)).toBe(true);
    expect(modes.find((mode) => mode.mode === 3)!.modeTags).not.toContainEqual({ value: 0 });
  });
  it.each([
    [0, 'SWEEP', 2, 1], [1, 'MOP', 1, 1],
    [4, 'SWEEP', 2, 0], [5, 'SWEEP_AND_MOP', 0, 0],
  ] as const)('selects Matter profile %s with the correct lifting-mop mode and power', async (modeId, cleanMode, rawMode, suction) => {
    vi.useFakeTimers();
    const { handlers, commands, cloud, state } = fixture(true);
    let smartHost = 1;
    cloud.getProperties.mockImplementation(async () => [{ siid: 4, piid: 50, value: [{ k: 'SmartHost', v: smartHost }] }] as any);
    cloud.setProperties.mockImplementation(async (_did, properties) => {
      const auto = properties.find((property: any) => property.piid === 50);
      if (auto) smartHost = JSON.parse(auto.value).v;
      return [{ code: 0 }];
    });
    const accessory = new DreameVacuumAccessory(log, 'fake', state, {} as any);
    handlers.setOnCleaningProfileSelected((profile, mode) => accessory.applyUserCleaningProfile(profile, mode));
    await commands.rvcCleanMode.changeToMode({ newMode: modeId });
    expect(smartHost).toBe(0);
    expect(cloud.setProperties).toHaveBeenNthCalledWith(1, 'fake', [{ did: 'fake', siid: 4, piid: 50, value: JSON.stringify({ k: 'SmartHost', v: 0 }) }]);
    expect(cloud.setProperties).toHaveBeenCalledWith('fake', [{ did: 'fake', siid: 4, piid: 23, value: rawMode }]);
    expect(cloud.setProperties).toHaveBeenCalledWith('fake', [{ did: 'fake', siid: 4, piid: 4, value: suction }]);
    expect(accessory.getCurrentState().activity.cleanMode).toBe(cleanMode);
    expect(MatterClusterMapper.toMatterState(accessory.getCurrentState()).RvcCleanMode.currentMode).toBe(modeId);
    await handlers.handleRoomSelection([1]);
    await commands.rvcRunMode.changeToMode({ newMode: 1 });
    const args = cloud.action.mock.calls[0] as unknown as [string, number, number, Array<{ piid: number; value: string }>];
    expect(JSON.parse(args[3].find((entry) => entry.piid === 10)!.value).selects[0][2]).toBe(suction);
    accessory.dispose();
  });

  it('does not publish a selected Normal profile when its suction write fails', async () => {
    const { commands, cloud, matter } = fixture(true);
    cloud.setProperties.mockResolvedValueOnce([{ code: 0 }]).mockResolvedValueOnce([{ code: -1 }]);
    await expect(commands.rvcCleanMode.changeToMode({ newMode: 0 })).rejects.toThrow('SUCTION');
    expect(matter.updateAccessoryState).not.toHaveBeenCalled();
    expect(cloud.action).not.toHaveBeenCalled();
  });

  it.each([[4, 0, 2], [5, 0, 2]] as const)('switches Quiet %s to Normal %s before a whole-home start', async (quiet, normal, rawMode) => {
    const { commands, cloud } = fixture(true);
    await commands.rvcCleanMode.changeToMode({ newMode: quiet });
    await commands.rvcCleanMode.changeToMode({ newMode: normal });
    cloud.setProperties.mockClear();
    await commands.rvcRunMode.changeToMode({ newMode: 1 });
    expect(cloud.setProperties).toHaveBeenCalledWith('fake', [{ did: 'fake', siid: 4, piid: 23, value: rawMode }]);
    expect(cloud.setProperties).toHaveBeenLastCalledWith('fake', [{ did: 'fake', siid: 4, piid: 4, value: 1 }]);
    expect(cloud.action).toHaveBeenCalledExactlyOnceWith('fake', 2, 1);
  });
  it.each(['start', 'resume', 'dock'])('really sends pause immediately after %s, before publishing Paused', async (command) => {
    const { commands, cloud, matter } = fixture();
    if (command === 'start') await commands.rvcRunMode.changeToMode({ newMode: 1 });
    if (command === 'resume') await commands.rvcOperationalState.resume();
    if (command === 'dock') await commands.rvcOperationalState.goHome();
    cloud.action.mockClear();
    matter.updateAccessoryState.mockClear();
    await commands.rvcOperationalState.pause();
    expect(cloud.action).toHaveBeenCalledExactlyOnceWith('fake', 2, 2);
    expect(matter.updateAccessoryState).toHaveBeenCalledWith('fake', 'rvcOperationalState', { operationalState: 2 });
    expect(cloud.action.mock.invocationCallOrder[0]).toBeLessThan(matter.updateAccessoryState.mock.invocationCallOrder[0]!);
  });

  it.each([null, undefined, {}, { error: { code: -1 } }, { code: -1 }])('does not publish success for an unsuccessful dock response: %j', async (response) => {
    const { commands, cloud, matter } = fixture();
    cloud.action.mockResolvedValueOnce(response as any);
    await expect(commands.rvcOperationalState.goHome()).rejects.toThrow();
    expect(matter.updateAccessoryState).not.toHaveBeenCalled();
  });

  it('resumes a paused room task without preparing or restarting it', async () => {
    const { handlers, cloud } = fixture();
    await handlers.handleRoomSelection([1]);
    await handlers.handleStartCommand(true);
    expect(cloud.action).toHaveBeenCalledExactlyOnceWith('fake', 2, 1);
    expect(cloud.setProperties).not.toHaveBeenCalled();
  });

  it('preserves Matter area IDs separately from repeated Dreame room IDs on different floors', async () => {
    vi.useFakeTimers();
    const { handlers, state } = fixture();
    state.activity.knownMaps = [
      { mapId: 10, name: 'Downstairs', rooms: [{ id: '1', name: 'Kitchen' }] },
      { mapId: 20, name: 'Upstairs', rooms: [{ id: '1', name: 'Bedroom' }] },
    ];
    state.activity.currentMapId = 20;
    const accessory = new DreameVacuumAccessory(log, 'fake', state, {} as any);
    handlers.setAreaIdToRoomTargetMap(MatterClusterMapper.buildAreaIdToRoomTargetMap(state));
    handlers.setOnAreaSelectionChanged((ids) => accessory.applyUserRoomSelection(ids));
    const areaId = MatterClusterMapper.buildServiceArea(state)!.supportedAreas.find((area) => area.mapId === 20)!.areaId;
    expect(areaId).not.toBe(1);
    await handlers.handleAreaSelection([areaId]);
    expect(accessory.getCurrentState().activity.selectedRooms).toEqual(['1']);
    expect(MatterClusterMapper.buildServiceArea(accessory.getCurrentState())!.selectedAreas).toEqual([areaId]);
    await handlers.handleAreaSelection([]);
    expect(MatterClusterMapper.buildServiceArea(accessory.getCurrentState())!.selectedAreas).toEqual([]);
    accessory.dispose();
  });

  it.each(['suction', 'water'])('does not retain a rejected %s level in the next room payload', async (setting) => {
    const { handlers, cloud } = fixture();
    cloud.setProperties.mockResolvedValueOnce([{ code: -1 }]);
    await expect(setting === 'suction' ? handlers.handleSuctionLevel(3) : handlers.handleWaterLevel(3)).rejects.toThrow();
    await handlers.handleRoomSelection([1]);
    await handlers.handleStartCommand();
    const args = cloud.action.mock.calls[0] as unknown as [string, number, number, Array<{ piid: number; value: string }>];
    expect(JSON.parse(args[3].find((entry) => entry.piid === 10)!.value).selects[0]).toEqual([1, 1, 1, 2, 1]);
  });
});
