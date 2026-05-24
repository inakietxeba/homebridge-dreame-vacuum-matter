import { describe, it, expect } from 'vitest';
import { parsePlatformConfig } from '../src/config';

describe('Config', () => {
  it('should parse minimal config with defaults', () => {
    const config = parsePlatformConfig({
      platform: 'DreameVacuumMatter',
      name: 'Dreame',
      username: 'test@example.com',
      password: 'secret',
    } as any);
    expect(config.country).toBe('eu');
    expect(config.defaultMode).toBe('SWEEP_AND_MOP');
    expect(config.defaultSuction).toBe(1);
    expect(config.defaultWaterLevel).toBe(2);
    expect(config.disableMatterStatePush).toBe(false);
    expect(config.rooms).toEqual([]);
  });

  it('should accept env var overrides', () => {
    process.env['DREAME_USERNAME'] = 'env@example.com';
    process.env['DREAME_PASSWORD'] = 'env-secret';
    const config = parsePlatformConfig({
      platform: 'DreameVacuumMatter',
      name: 'Dreame',
    } as any);
    expect(config.username).toBe('env@example.com');
    expect(config.password).toBe('env-secret');
    delete process.env['DREAME_USERNAME'];
    delete process.env['DREAME_PASSWORD'];
  });
});
