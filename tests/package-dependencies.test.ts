import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

describe('Published dependencies', () => {
  it('matches the published manifest', () => {
    expect(lock.name).toBe(manifest.name);
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[''].dependencies).toEqual(manifest.dependencies);
    expect(lock.packages[''].devDependencies).toEqual(manifest.devDependencies);
  });

  it('bundles all runtime dependencies and no development dependencies', () => {
    expect([...manifest.bundleDependencies].sort()).toEqual(Object.keys(manifest.dependencies).sort());
    for (const name of manifest.bundleDependencies) {
      expect(manifest.devDependencies).not.toHaveProperty(name);
    }
  });

  it('locks the corrected IP parser in the MQTT dependency tree', () => {
    const ip = lock.packages['node_modules/ip-address'];
    const [major, minor, patch] = ip.version.split('.').map(Number);
    expect(major).toBe(10);
    expect(minor > 7 || (minor === 7 && patch >= 5)).toBe(true);
    expect(ip.dev).not.toBe(true);
    expect(lock.packages['node_modules/mqtt'].dev).not.toBe(true);
    expect(lock.packages['node_modules/socks'].dev).not.toBe(true);
  });

  it('does not publish private or local dependency locations', () => {
    for (const entry of Object.values(lock.packages) as Array<{ resolved?: string; integrity?: string }>) {
      if (!entry.resolved) continue;
      const url = new URL(entry.resolved);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('registry.npmjs.org');
      expect(url.username).toBe('');
      expect(url.password).toBe('');
      expect(url.search).toBe('');
      expect(entry.integrity).toMatch(/^sha512-/);
    }
  });
});
