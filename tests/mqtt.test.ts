import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as mqtt from 'mqtt';
import { DreameMqttClient } from '../src/dreame/mqtt';

vi.mock('mqtt', () => ({
  connect: vi.fn(),
}));

class MockMqttClient extends EventEmitter {
  end = vi.fn((_force?: boolean, cb?: () => void) => {
    cb?.();
  });

  subscribe = vi.fn();
}

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe('DreameMqttClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restarts the MQTT client when token changes while reconnecting', () => {
    const firstClient = new MockMqttClient();
    const secondClient = new MockMqttClient();
    vi.mocked(mqtt.connect)
      .mockReturnValueOnce(firstClient as any)
      .mockReturnValueOnce(secondClient as any);

    const client = new DreameMqttClient(createMockLogger(), {
      host: 'mqtt.example.com:19328',
      did: 'device-1',
      uid: 'user-1',
      model: 'dreame.vacuum.test',
      accessToken: 'old-token',
      country: 'eu',
    });

    client.connect();
    client.updateToken('new-token');

    expect(firstClient.end).toHaveBeenCalledWith(true, expect.any(Function));
    expect(mqtt.connect).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mqtt.connect).mock.calls[1]![1]?.password).toBe('new-token');
  });

  it.each([
    ['direct', { method: 'properties_changed', params: [{ siid: 2, piid: 1, value: 5 }] }],
    ['nested', { id: 750, data: { method: 'properties_changed', params: [{ siid: 2, piid: 1, value: 5 }] } }],
  ])('emits properties from the %s MQTT payload format', (_name, payload) => {
    const mqttClient = new MockMqttClient();
    vi.mocked(mqtt.connect).mockReturnValueOnce(mqttClient as any);
    const client = new DreameMqttClient(createMockLogger(), {
      host: 'mqtt.example.com:19328',
      did: 'device-1',
      uid: 'user-1',
      model: 'dreame.vacuum.test',
      accessToken: 'token',
      country: 'eu',
    });
    const onMessage = vi.fn();
    client.on('message', onMessage);
    client.connect();

    mqttClient.emit('message', '/status/topic', Buffer.from(JSON.stringify(payload)));

    expect(onMessage).toHaveBeenCalledWith([{ siid: 2, piid: 1, value: 5 }]);
  });
});
