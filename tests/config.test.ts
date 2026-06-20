import { describe, it, expect } from 'vitest';
import { parsePlatformConfig } from '../src/config';

describe('Config', () => {
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
