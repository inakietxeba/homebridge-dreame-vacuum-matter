import * as mqtt from 'mqtt';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { Logger } from '../util/logger';

export interface MqttConnectionInfo {
  host: string;
  did: string;
  uid: string;
  model: string;
  accessToken: string;
  country: string;
}

export interface DreameMqttClientEvents {
  message: [properties: Array<{ siid: number; piid: number; value: unknown }>];
  connected: [];
  error: [error: Error];
}

export class DreameMqttClient extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connectionInfo: MqttConnectionInfo;
  private _connected = false;
  private _reconnecting = false;
  private readonly reconnectMaxDelayMs: number;

  constructor(
    private readonly log: Logger,
    info: MqttConnectionInfo,
    options?: { reconnectMaxDelayMs?: number },
  ) {
    super();
    this.connectionInfo = info;
    this.reconnectMaxDelayMs = options?.reconnectMaxDelayMs ?? 30_000;
  }

  get connected(): boolean { return this._connected; }

  updateToken(accessToken: string): void {
    this.connectionInfo.accessToken = accessToken;
    if (this.client && this._connected) {
      this.log.debug('Updating MQTT credentials after token refresh');
      this.client.end(true);
      this.connectInternal();
    }
  }

  connect(): void {
    if (this.client) return;
    this.connectInternal();
  }

  private connectInternal(): void {
    const info = this.connectionInfo;
    const hostParts = info.host.split(':');
    const brokerHost = hostParts[0]!;
    const parsedPort = hostParts[1] ? parseInt(hostParts[1], 10) : NaN;
    const brokerPort = Number.isFinite(parsedPort) ? parsedPort : 19328;

    const randomId = this.getRandomAgentId();
    const clientId = `p_${info.uid}_${randomId}_${brokerHost}`;

    const mqttHost = info.country === 'kr'
      ? brokerHost.replace('10100', '10000')
      : brokerHost;

    const url = `mqtts://${mqttHost}:${brokerPort}`;
    this.log.debug(`Connecting to MQTT broker ${url}`);

    this.client = mqtt.connect(url, {
      clientId,
      username: info.uid,
      password: info.accessToken,
      clean: true,
      keepalive: 60,
      connectTimeout: 10_000,
      reconnectPeriod: Math.min(5_000, this.reconnectMaxDelayMs),
      rejectUnauthorized: false,
    });

    this.client.on('connect', () => {
      this._connected = true;
      this.log.info('Connected to Dreame MQTT broker');

      const topic = `/status/${info.did}/${info.uid}/${info.model}/${info.country}/`;
      this.client!.subscribe(topic, (err) => {
        if (err) {
          this.log.error(`Failed to subscribe to ${topic}: ${err.message}`);
        } else {
          this.log.debug(`Subscribed to ${topic}`);
        }
      });

      if (info.country === 'kr') {
        const sgTopic = `/status/${info.did}/${info.uid}/${info.model}/sg/`;
        this.client!.subscribe(sgTopic);
      }

      this.emit('connected');
    });

    this.client.on('message', (_topic, payload) => {
      try {
        const message = JSON.parse(payload.toString()) as Record<string, unknown>;
        if (message['method'] === 'properties_changed' && Array.isArray(message['params'])) {
          const properties = (message['params'] as Array<Record<string, unknown>>)
            .filter((p) => p['siid'] !== undefined && p['piid'] !== undefined && p['value'] !== undefined)
            .map((p) => ({ siid: p['siid'] as number, piid: p['piid'] as number, value: p['value'] }));

          if (properties.length > 0) {
            this.log.debug(`Received ${properties.length} property updates via MQTT`);
            this.emit('message', properties);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    this.client.on('disconnect', () => {
      this._connected = false;
      this.log.warn('Disconnected from MQTT broker');
    });

    this.client.on('error', (err: Error & { code?: number }) => {
      this.log.error(`MQTT error: ${err.message}`);

      if ((err.code === 5 || err.message?.includes('Not authorized')) && !this._reconnecting) {
        this._reconnecting = true;
        this.log.warn('MQTT auth rejected — emitting error for re-login');
        this.emit('error', err);
        this._reconnecting = false;
      }
    });

    this.client.on('reconnect', () => {
      this.log.debug('Reconnecting to MQTT broker...');
    });
  }

  disconnect(): void {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end(true);
      this.client = null;
      this._connected = false;
    }
  }

  private getRandomAgentId(): string {
    const letters = 'ABCDEF';
    let result = '';
    for (let i = 0; i < 13; i++) {
      result += letters[crypto.randomInt(letters.length)]!;
    }
    return result;
  }
}
