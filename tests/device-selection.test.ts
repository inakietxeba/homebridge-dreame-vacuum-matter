import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DreameVacuumMatterPlatform } from '../src/platform';
import { AUTOMATION_CONTACT_SENSORS_CONTEXT_KIND } from '../src/homekit/automation-sensors';
import { AUTOMATION_DOCK_SWITCH_CONTEXT_KIND } from '../src/homekit/automation-dock-switch';

const cloud = vi.hoisted(() => ({
  login: vi.fn(), getDevices: vi.fn(), getDeviceInfo: vi.fn(), getDeviceFirmware: vi.fn(),
  getProperties: vi.fn(), setCountry: vi.fn(),
  action: vi.fn(), setProperties: vi.fn(),
}));
const mapCloud = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../src/dreame/cloud', () => ({ DreameCloud: class { constructor() { return cloud; } } }));
vi.mock('../src/dreame/maps', () => ({ fetchDreameMapState: mapCloud.fetch, applyMapOverrides: (maps: unknown) => maps }));

function fixture(config: Record<string, unknown> = {}) {
  const callbacks = new Map<string, () => void>();
  const matter = {
    uuid: { generate: (id: string) => `uuid-${id}` },
    deviceTypes: { RoboticVacuumCleaner: 'robot' },
    registerPlatformAccessories: vi.fn(async () => undefined),
    unregisterPlatformAccessories: vi.fn(async () => undefined),
    updateAccessoryState: vi.fn(async () => undefined),
  };
  const api = {
    on: vi.fn((event: string, cb: () => void) => callbacks.set(event, cb)),
    matter, unregisterPlatformAccessories: vi.fn(),
  };
  const log = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const platform = new DreameVacuumMatterPlatform(log as any, {
    platform: 'DreameVacuumMatter', username: 'fake', password: 'fake', ...config,
  } as any, api as any);
  return { platform, api, matter, log, shutdown: () => callbacks.get('shutdown')?.() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  cloud.login.mockResolvedValue(undefined);
  cloud.getDevices.mockResolvedValue([
    { did: 'a', name: 'Robot A', model: 'dreame.test' },
    { did: 'b', name: 'Robot B', model: 'dreame.test' },
  ]);
  cloud.getDeviceInfo.mockResolvedValue({});
  cloud.getDeviceFirmware.mockReturnValue('1');
  cloud.getProperties.mockResolvedValue([]);
  cloud.action.mockResolvedValue({ code: 0 });
  cloud.setProperties.mockResolvedValue([{ code: 0 }]);
  mapCloud.fetch.mockResolvedValue({ maps: [] });
});
afterEach(() => vi.useRealTimers());

describe('Device exposure during discovery', () => {
  it('uses the reported active floor and refreshes app map changes before starting a room task', async () => {
    const maps = [
      { mapId: 10, rooms: [{ id: '1', name: 'Kitchen' }] },
      { mapId: 20, rooms: [{ id: '1', name: 'Bedroom' }] },
    ];
    mapCloud.fetch.mockResolvedValue({ maps, currentMapId: 20 });
    const { platform, matter, shutdown } = fixture({ deviceSelection: 'selected', deviceIds: ['a'] });
    await platform.discoverDevices();
    const accessory = (matter.registerPlatformAccessories.mock.calls[0] as any)[2][0];
    const handler = (platform as any).accessoryHandlers.get('uuid-a');
    expect(handler.getCurrentState().activity.currentMapId).toBe(20);
    expect(handler.getCurrentState().activity.availableRooms).toEqual(maps[1].rooms);

    const area = accessory.clusters.serviceArea.supportedAreas.find((entry: any) => entry.mapId === 10);
    await accessory.handlers.serviceArea.selectAreas({ newAreas: [area.areaId] });
    // The user selects the other floor in Dreamehome after discovery.
    mapCloud.fetch.mockResolvedValue({ maps, currentMapId: 10 });
    await accessory.handlers.rvcRunMode.changeToMode({ newMode: 1 });
    expect(cloud.action).toHaveBeenCalledExactlyOnceWith('a', 4, 1, expect.any(Array));
    expect(handler.getCurrentState().activity.currentMapId).toBe(10);
    expect(handler.getCurrentState().activity.availableRooms).toEqual(maps[0].rooms);
    shutdown();
  });

  it.each([undefined, false, true])('enables profiles for every robot regardless of the removed setting (%s)', async (legacyValue) => {
    const { platform, matter, shutdown } = fixture({ experimentalCleaningProfiles: legacyValue });
    await platform.discoverDevices();
    expect(matter.registerPlatformAccessories).toHaveBeenCalledTimes(2);
    for (const call of matter.registerPlatformAccessories.mock.calls as any) {
      const modes = call[2][0].clusters.rvcCleanMode.supportedModes;
      expect(modes).toContainEqual(expect.objectContaining({ mode: 4, modeTags: expect.arrayContaining([{ value: 2 }]) }));
      expect(modes).toContainEqual(expect.objectContaining({ mode: 5, modeTags: expect.arrayContaining([{ value: 2 }]) }));
      expect(modes).toContainEqual(expect.objectContaining({ mode: 2, modeTags: expect.arrayContaining([{ value: 0 }]) }));
    }
    shutdown();
  });

  it('initializes the second robot when the first fails, keeps its cached accessories and can retry', async () => {
    const { platform, matter, log, shutdown } = fixture();
    const cached = { UUID: 'uuid-a', displayName: 'A', context: { deviceId: 'a', model: 'test' } };
    platform.configureMatterAccessory(cached as any);
    cloud.getDeviceInfo.mockRejectedValueOnce(new Error('Device info timeout'));

    await expect(platform.discoverDevices()).resolves.toBeUndefined();
    expect(cloud.getDeviceInfo.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(matter.registerPlatformAccessories.mock.calls.map((call: any) => call[2][0].context.deviceId)).toEqual(['b']);
    expect(matter.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize Robot A (a)'));

    cloud.getDeviceInfo.mockClear();
    await platform.discoverDevices();
    expect(cloud.getDeviceInfo.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Device Robot A (a) ready'));
    shutdown();
  });

  it('continues to the second robot if registering the first throws', async () => {
    const { platform, matter, shutdown } = fixture();
    matter.registerPlatformAccessories.mockRejectedValueOnce(new Error('Registration failed'));
    await platform.discoverDevices();
    expect(matter.registerPlatformAccessories.mock.calls.map((call: any) => call[2][0].context.deviceId)).toEqual(['a', 'b']);
    shutdown();
  });
  it('preserves existing behavior by exposing all robots by default', async () => {
    const { platform, matter, log, shutdown } = fixture();
    await platform.discoverDevices();
    expect(matter.registerPlatformAccessories.mock.calls.map((call: any) => call[2][0].context.deviceId)).toEqual(['a', 'b']);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Pair Robot A using its own external Matter QR/manual code'));
    shutdown();
  });

  it('provisions only selected IDs and logs both names and IDs for configuration', async () => {
    const { platform, matter, log, shutdown } = fixture({ deviceSelection: 'selected', deviceIds: ['b'] });
    await platform.discoverDevices();
    expect(cloud.getDeviceInfo).toHaveBeenCalledExactlyOnceWith('b');
    expect(cloud.getProperties).toHaveBeenCalledOnce();
    expect(matter.registerPlatformAccessories).toHaveBeenCalledOnce();
    expect((matter.registerPlatformAccessories.mock.calls[0] as any)[2][0].context.deviceId).toBe('b');
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Robot A — ID: a — excluded'));
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Robot B — ID: b — selected'));
    shutdown();
  });

  it('removes a previously exposed excluded robot without registering it again', async () => {
    const { platform, matter, shutdown } = fixture({ deviceSelection: 'selected', deviceIds: ['a'] });
    const excluded = { UUID: 'uuid-b', displayName: 'Robot B', context: { deviceId: 'b', model: 'test' } };
    platform.configureMatterAccessory(excluded as any);
    await platform.discoverDevices();
    expect(matter.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-dreame-vacuum-matter', 'DreameVacuumMatter', [excluded]);
    expect(cloud.getDeviceInfo).not.toHaveBeenCalledWith('b');
    shutdown();
  });

  it.each([{ deviceSelection: 'none' }, { deviceSelection: 'selected', deviceIds: [] }])('exposes nothing and removes owned accessories without logging in: %j', async (config) => {
    const { platform, matter, api, shutdown } = fixture({ username: undefined, password: undefined, ...config });
    const robot = { UUID: 'uuid-a', displayName: 'A', context: { deviceId: 'a', model: 'test' } };
    const sensor = { UUID: 'sensor-a', context: { kind: AUTOMATION_CONTACT_SENSORS_CONTEXT_KIND } };
    const dock = { UUID: 'dock-a', context: { kind: AUTOMATION_DOCK_SWITCH_CONTEXT_KIND } };
    const other = { UUID: 'unrelated', context: { kind: 'other-plugin' } };
    platform.configureMatterAccessory(robot as any);
    for (const accessory of [sensor, dock, other]) platform.configureAccessory(accessory as any);
    await platform.discoverDevices();
    expect(cloud.login).not.toHaveBeenCalled();
    expect(matter.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(matter.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-dreame-vacuum-matter', 'DreameVacuumMatter', [robot]);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-dreame-vacuum-matter', 'DreameVacuumMatter', [sensor, dock]);
    expect(platform.accessories).toEqual([other]);
    shutdown();
  });

  it('warns about an unknown selected ID instead of falling back to all robots', async () => {
    const { platform, matter, log, shutdown } = fixture({ deviceSelection: 'selected', deviceIds: ['missing'] });
    platform.configureMatterAccessory({ UUID: 'uuid-a', displayName: 'A', context: { deviceId: 'a', model: 'test' } } as any);
    await platform.discoverDevices();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('missing was not found'));
    expect(matter.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(cloud.getDeviceInfo).not.toHaveBeenCalled();
    expect(matter.unregisterPlatformAccessories).not.toHaveBeenCalled();
    shutdown();
  });

  it('keeps cached accessories when the cloud unexpectedly returns no robots', async () => {
    const { platform, matter, shutdown } = fixture({ deviceSelection: 'selected', deviceIds: ['a'] });
    platform.configureMatterAccessory({ UUID: 'uuid-a', displayName: 'A', context: { deviceId: 'a', model: 'test' } } as any);
    cloud.getDevices.mockResolvedValueOnce([]);
    await platform.discoverDevices();
    expect(matter.unregisterPlatformAccessories).not.toHaveBeenCalled();
    shutdown();
  });

  it('does not remove cached robots on login failure', async () => {
    const { platform, matter, shutdown } = fixture({ deviceSelection: 'selected', deviceIds: ['a'] });
    platform.configureMatterAccessory({ UUID: 'uuid-b', displayName: 'B', context: { deviceId: 'b', model: 'test' } } as any);
    cloud.login.mockRejectedValueOnce(new Error('cloud unavailable'));
    await platform.discoverDevices();
    expect(matter.unregisterPlatformAccessories).not.toHaveBeenCalled();
    shutdown();
  });
});
