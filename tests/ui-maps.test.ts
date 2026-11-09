import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverUiMaps } from '../src/ui/devices';

const cloud = vi.hoisted(() => ({ login: vi.fn(), getDevices: vi.fn(), getDeviceInfo: vi.fn(), setCountry: vi.fn() }));
const maps = vi.hoisted(() => vi.fn());
vi.mock('../src/dreame/cloud', () => ({ DreameCloud: class { constructor() { return cloud; } } }));
vi.mock('../src/dreame/maps', () => ({ fetchDreameMapRooms: maps }));
const payload = { username: 'test@example.com', password: 'fake', country: 'eu', deviceId: 'a' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DREAME_EMAIL', '');
  vi.stubEnv('DREAME_PASSWORD', '');
  cloud.getDevices.mockResolvedValue([{ did: 'a', name: 'Robot A', model: 'dreame.vacuum.test', token: 'private' }]);
  maps.mockResolvedValue([{ mapId: 10, name: 'Floor', rooms: [{ id: '1', name: 'Kitchen', secret: 'private' }], url: 'private' }]);
});
afterEach(() => vi.unstubAllEnvs());

describe('Map editor discovery', () => {
  it('returns only map/room names and IDs for a robot belonging to the account', async () => {
    expect(await discoverUiMaps(payload)).toEqual({ success: true, maps: [
      { mapId: 10, name: 'Floor', rooms: [{ id: '1', name: 'Kitchen' }] },
    ] });
    expect(maps).toHaveBeenCalledWith(cloud, expect.objectContaining({ did: 'a', model: 'dreame.vacuum.test' }), expect.anything());
    expect(cloud.getDeviceInfo).toHaveBeenCalledWith('a');
    expect(cloud.getDeviceInfo.mock.invocationCallOrder[0]).toBeLessThan(maps.mock.invocationCallOrder[0]);
  });

  it.each([null, {}, { ...payload, deviceId: '' }, { ...payload, country: 'invalid' }])('rejects invalid input: %j', async (input) => {
    expect((await discoverUiMaps(input)).success).toBe(false);
    expect(cloud.login).not.toHaveBeenCalled();
  });

  it.each(['missing', 'other'])('does not fetch maps for an unknown or non-vacuum device: %s', async (deviceId) => {
    cloud.getDevices.mockResolvedValue([{ did: 'other', name: 'Lamp', model: 'dreame.light' }]);
    expect((await discoverUiMaps({ ...payload, deviceId })).success).toBe(false);
    expect(maps).not.toHaveBeenCalled();
  });

  it('uses server environment credentials', async () => {
    vi.stubEnv('DREAME_EMAIL', 'env@example.com');
    vi.stubEnv('DREAME_PASSWORD', 'fake-env');
    await discoverUiMaps({ deviceId: 'a' });
    expect(cloud.login).toHaveBeenCalledWith('env@example.com', 'fake-env');
  });

  it('returns empty results without inventing maps', async () => {
    maps.mockResolvedValue([]);
    expect(await discoverUiMaps(payload)).toEqual({ success: true, maps: [] });
  });

  it.each(['login', 'getDevices', 'getDeviceInfo', 'maps'])('does not leak cloud errors from %s', async (method) => {
    (method === 'maps' ? maps : cloud[method as 'login' | 'getDevices' | 'getDeviceInfo']).mockRejectedValueOnce(new Error('private-token private-password'));
    const result = await discoverUiMaps(payload);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('private-password');
  });

  it('identifies connection initialization failures without requesting map data', async () => {
    cloud.getDeviceInfo.mockRejectedValueOnce(new Error('private-response'));
    expect(await discoverUiMaps(payload)).toEqual({ success: false, error: expect.stringContaining('initializing the robot connection') });
    expect(maps).not.toHaveBeenCalled();
  });

  it('explains robot reachability failures without claiming that the saved map is missing', async () => {
    maps.mockRejectedValueOnce(new Error('Dreame get_properties failed with cloud code 80001'));
    const result = await discoverUiMaps(payload);
    expect(result).toEqual({ success: false, error: expect.stringContaining('Dreame Cloud could not reach the robot') });
    if (!result.success) {
      expect(result.error).toContain('powered on, connected to the Internet');
      expect(result.error).toContain('available in Dreamehome');
      expect(result.error).toContain('Saved names have not changed');
    }
  });

  it('adds connectivity guidance to other map failures without leaking their details', async () => {
    maps.mockRejectedValueOnce(new Error('private-response'));
    const result = await discoverUiMaps(payload);
    expect(result).toEqual({ success: false, error: expect.stringContaining('powered on, connected to the Internet') });
    expect(JSON.stringify(result)).not.toContain('private-response');
  });
});
