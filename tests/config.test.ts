import { describe, it, expect } from 'vitest';
import { parsePlatformConfig, shouldExposeDevice } from '../src/config';

describe('Config', () => {
  it.each([true, false])('accepts and ignores the removed experimental setting (%s)', (value) => {
    const config = parsePlatformConfig({ platform: 'DreameVacuumMatter', experimentalCleaningProfiles: value } as any);
    expect(config).not.toHaveProperty('experimentalCleaningProfiles');
  });
  it.each([
    ['all', [], true, true],
    ['selected', ['a'], true, false],
    ['selected', ['a', 'b'], true, true],
    ['selected', [], false, false],
    ['none', ['a', 'b'], false, false],
  ] as const)('filters devices with %s selection and IDs %j', (selection, ids, a, b) => {
    const config = parsePlatformConfig({ platform: 'DreameVacuumMatter', deviceSelection: selection, deviceIds: [...ids] } as any);
    expect(shouldExposeDevice(config, 'a')).toBe(a);
    expect(shouldExposeDevice(config, 'b')).toBe(b);
  });

  it('rejects empty IDs and invalid selection modes', () => {
    expect(() => parsePlatformConfig({ platform: 'DreameVacuumMatter', deviceSelection: 'invalid' } as any)).toThrow();
    expect(() => parsePlatformConfig({ platform: 'DreameVacuumMatter', deviceIds: [' '] } as any)).toThrow();
  });
  it('should parse minimal config with defaults', () => {
    // Ensure env vars don't interfere
    const savedEmail = process.env['DREAME_EMAIL'];
    const savedPassword = process.env['DREAME_PASSWORD'];
    delete process.env['DREAME_EMAIL'];
    delete process.env['DREAME_PASSWORD'];

    const config = parsePlatformConfig({
      platform: 'DreameVacuumMatter',
      name: 'Dreame',
      username: 'test@example.com',
      password: 'secret',
    } as any);
    expect(config.country).toBe('eu');
    expect(config.deviceSelection).toBe('all');
    expect(shouldExposeDevice(config, 'any-robot')).toBe(true);
    expect(config.username).toBe('test@example.com');
    expect(config.password).toBe('secret');
    expect(config.automationDockSwitch).toBe(false);
    expect(config.mapOverrides).toEqual([]);

    // Restore
    if (savedEmail) process.env['DREAME_EMAIL'] = savedEmail;
    if (savedPassword) process.env['DREAME_PASSWORD'] = savedPassword;
  });

  it('should accept env var overrides', () => {
    process.env['DREAME_EMAIL'] = 'env@example.com';
    process.env['DREAME_PASSWORD'] = 'env-secret';
    const config = parsePlatformConfig({
      platform: 'DreameVacuumMatter',
      name: 'Dreame',
    } as any);
    expect(config.username).toBe('env@example.com');
    expect(config.password).toBe('env-secret');
    delete process.env['DREAME_EMAIL'];
    delete process.env['DREAME_PASSWORD'];
  });

  it('should accept map and room name overrides', () => {
    const config = parsePlatformConfig({
      platform: 'DreameVacuumMatter',
      name: 'Dreame',
      mapOverrides: [
        {
          mapId: 10,
          deviceId: 'robot-1',
          name: 'Ático',
          rooms: [
            { segmentId: '3', name: 'Cocina' },
            { segmentId: '1', name: 'Despacho' },
          ],
        },
      ],
    } as any);

    expect(config.mapOverrides).toEqual([
      {
        mapId: 10,
        deviceId: 'robot-1',
        name: 'Ático',
        rooms: [
          { segmentId: '3', name: 'Cocina' },
          { segmentId: '1', name: 'Despacho' },
        ],
      },
    ]);
  });
});
