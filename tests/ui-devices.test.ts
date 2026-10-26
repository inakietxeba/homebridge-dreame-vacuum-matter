import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverUiRobots } from '../src/ui/devices';

const cloud = vi.hoisted(() => ({ login: vi.fn(), getDevices: vi.fn(), setCountry: vi.fn() }));
vi.mock('../src/dreame/cloud', () => ({ DreameCloud: class { constructor() { return cloud; } } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DREAME_EMAIL', '');
  vi.stubEnv('DREAME_PASSWORD', '');
  cloud.login.mockResolvedValue(undefined);
  cloud.getDevices.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('Robot picker backend', () => {
  const credentials = { username: 'test@example.com', password: 'secret', country: 'eu' };
  it('keeps Dreame, Mova and Trouver vacuum models returned by the same account', async () => {
    cloud.getDevices.mockResolvedValue([
      { did: 'a', name: 'Mova', model: 'mova.vacuum.r2519a' },
      { did: 'b', name: 'Trouver', model: 'trouver.vacuum.r2569r' },
      { did: 'c', name: 'Not a robot', model: 'mova.light.test' },
    ]);
    expect(await discoverUiRobots(credentials)).toEqual({ success: true, devices: [
      { id: 'a', name: 'Mova', model: 'mova.vacuum.r2519a' },
      { id: 'b', name: 'Trouver', model: 'trouver.vacuum.r2569r' },
    ] });
  });
  it('returns names and stable IDs, stripping tokens, IPs and account identifiers', async () => {
    cloud.getDevices.mockResolvedValue([
      { did: 'a', name: 'Robot A', model: 'dreame.vacuum.r2469x', token: 'secret-token', localip: 'private', mac: 'private', masterUid: 'private' },
      { did: 'b', name: 'D20', model: 'dreame.vacuum.r2563b', bindDomain: 'private' },
      { did: 'b', name: 'D20', model: 'dreame.vacuum.r2563b' },
      { did: 'other', name: 'Other appliance', model: 'dreame.light' },
      { did: '', name: 'Invalid', model: 'dreame.vacuum.test' },
    ]);
    expect(await discoverUiRobots(credentials)).toEqual({ success: true, devices: [
      { id: 'a', name: 'Robot A', model: 'dreame.vacuum.r2469x' },
      { id: 'b', name: 'D20', model: 'dreame.vacuum.r2563b' },
    ] });
    expect(cloud.login).toHaveBeenCalledWith(credentials.username, credentials.password);
    expect(cloud.setCountry).toHaveBeenCalledWith('eu');
  });

  it('uses the same server environment overrides as the plugin without returning secrets', async () => {
    vi.stubEnv('DREAME_EMAIL', 'env@example.com');
    vi.stubEnv('DREAME_PASSWORD', 'env-secret');
    expect(await discoverUiRobots({ country: 'us' })).toEqual({ success: true, devices: [] });
    expect(cloud.login).toHaveBeenCalledWith('env@example.com', 'env-secret');
    expect(cloud.setCountry).toHaveBeenCalledWith('us');
  });

  it.each([null, [], {}, { ...credentials, country: 'localhost' }, { ...credentials, username: 'x'.repeat(257) }])('validates request data without contacting the cloud: %j', async (payload) => {
    expect((await discoverUiRobots(payload)).success).toBe(false);
    expect(cloud.login).not.toHaveBeenCalled();
  });

  it.each(['login', 'getDevices'] as const)('does not leak error responses from %s', async (method) => {
    cloud[method].mockRejectedValueOnce(new Error('secret-password secret-token cloud-response'));
    const result = await discoverUiRobots(credentials);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/secret-password|secret-token|cloud-response/);
  });
});
