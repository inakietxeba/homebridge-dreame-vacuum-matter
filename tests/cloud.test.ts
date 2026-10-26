import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DreameCloud } from '../src/dreame/cloud';

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

function jsonResponse(data: unknown) {
  return {
    status: 200,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

describe('DreameCloud', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    { code: -1, data: { result: { code: 0 } } },
    { code: 0, data: { error: { code: -1 } } },
    { code: 0, data: { code: -1 } },
    { code: 0, data: {} },
    { code: 0, data: { result: null } },
  ])('rejects unsuccessful or missing command results: %j', async (response) => {
    globalThis.fetch = vi.fn(async () => jsonResponse(response) as Response) as typeof fetch;
    const cloud = new DreameCloud(createMockLogger());
    (cloud as any).accessToken = 'token';
    (cloud as any).tokenExpireTime = Date.now() + 60_000;
    await expect(cloud.action('dev-a', 3, 1)).rejects.toThrow('Dreame');
  });

  it('keeps command routing host and firmware scoped per device', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, body });

      if (url.includes('/device/info')) {
        const request = JSON.parse(body ?? '{}') as { did?: string };
        return jsonResponse({
          code: 0,
          data: {
            bindDomain: request.did === 'dev-a' ? 'alpha.iot.dreame.tech' : 'beta.iot.dreame.tech',
            firmwareVersion: request.did === 'dev-a' ? '1.2.3' : '4.5.6',
          },
        }) as Response;
      }

      return jsonResponse({ code: 0, data: { result: 'ok' } }) as Response;
    }) as typeof fetch;

    const cloud = new DreameCloud(createMockLogger());
    (cloud as any).accessToken = 'token';
    (cloud as any).tokenExpireTime = Date.now() + 60_000;

    await cloud.getDeviceInfo('dev-a');
    await cloud.getDeviceInfo('dev-b');
    await cloud.sendCommand('dev-a', 'get_properties', []);
    await cloud.sendCommand('dev-b', 'get_properties', []);

    expect(cloud.getDeviceFirmware('dev-a')).toBe('1.2.3');
    expect(cloud.getDeviceFirmware('dev-b')).toBe('4.5.6');
    expect(calls.at(-2)?.url).toContain('/dreame-iot-com-alpha/device/sendCommand');
    expect(calls.at(-1)?.url).toContain('/dreame-iot-com-beta/device/sendCommand');
  });

  it('passes an abort signal to cloud requests', async () => {
    const signals: Array<AbortSignal | null> = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? null);
      return jsonResponse({ code: 0, data: { result: [] } }) as Response;
    }) as typeof fetch;

    const cloud = new DreameCloud(createMockLogger());
    (cloud as any).accessToken = 'token';
    (cloud as any).tokenExpireTime = Date.now() + 60_000;

    await cloud.sendCommand('dev-a', 'get_properties', []);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('prefers device firmware over a separate MCU version for capability thresholds', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ code: 0, data: {
      firmwareVersion: '4.3.9_1114', mcuVersion: '1.0', featureVersion: '1',
    } }) as Response) as typeof fetch;
    const cloud = new DreameCloud(createMockLogger());
    (cloud as any).accessToken = 'token';
    (cloud as any).tokenExpireTime = Date.now() + 60_000;
    await cloud.getDeviceInfo('test');
    expect(cloud.getDeviceFirmware('test')).toBe('4.3.9_1114');
  });
});
