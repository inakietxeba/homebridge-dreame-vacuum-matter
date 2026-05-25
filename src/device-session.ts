import { Logger } from './util/logger';
import { DreameMqttClient } from './dreame/mqtt';
import { DreameCloud } from './dreame/cloud';
import { MatterCommandHandlers } from './matter/handlers';
import { DreameVacuumAccessory } from './matter/accessory';
import { StateParser } from './dreame/parser';
import { POLL_PROPERTIES } from './dreame/models';

export class DeviceSession {
  private mqttClient: DreameMqttClient | null = null;
  private cloud: DreameCloud | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private mqttConnected = false;
  private isPolling = false;
  private disposed = false;
  private consecutivePollFailures = 0;

  /** Polling intervals. */
  private static readonly POLL_ACTIVE_MS = 15_000;       // 15s when cleaning without MQTT
  private static readonly POLL_MQTT_ACTIVE_MS = 60_000;   // 60s backup when MQTT + cleaning
  private static readonly POLL_MQTT_IDLE_MS = 300_000;    // 5min heartbeat when MQTT + idle
  private static readonly POLL_NO_MQTT_MS = 60_000;       // 60s when no MQTT + idle

  constructor(
    private readonly deviceId: string,
    private readonly deviceName: string,
    private readonly handlers: MatterCommandHandlers,
    private readonly accessoryHandler: DreameVacuumAccessory,
    private readonly parser: StateParser,
    private readonly log: Logger,
  ) {}

  setCloud(cloud: DreameCloud): void {
    this.cloud = cloud;
    this.schedulePoll();
  }

  connectMqtt(mqttClient: DreameMqttClient): void {
    this.mqttClient = mqttClient;

    mqttClient.on('message', (properties) => {
      try {
        this.processStateUpdate(properties);
      } catch (err: unknown) {
        this.log.error(`Failed to process MQTT message for ${this.deviceName}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Reschedule poll after receiving MQTT data (reset timer)
      this.schedulePoll();
    });

    mqttClient.on('connected', () => {
      this.mqttConnected = true;
      this.log.info(`MQTT connected for ${this.deviceName}`);
      this.schedulePoll();
    });

    mqttClient.on('error', (err) => {
      this.mqttConnected = false;
      this.log.error(`MQTT error for ${this.deviceName}: ${err.message}`);
      this.schedulePoll();
    });

    mqttClient.connect();
  }

  private getPollingInterval(): number {
    const isCleaning = this.accessoryHandler.getCurrentState().activity.runMode === 'cleaning';

    if (!this.mqttConnected) {
      // No MQTT: poll aggressively when cleaning, 60s otherwise
      return isCleaning ? DeviceSession.POLL_ACTIVE_MS : DeviceSession.POLL_NO_MQTT_MS;
    }

    // MQTT connected: backup poll — 60s cleaning, 180s idle
    return isCleaning ? DeviceSession.POLL_MQTT_ACTIVE_MS : DeviceSession.POLL_MQTT_IDLE_MS;
  }

  private schedulePoll(): void {
    if (!this.cloud || this.disposed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const interval = this.getPollingInterval();
    this.pollTimer = setTimeout(() => void this.poll(), interval);
  }

  private async poll(): Promise<void> {
    if (!this.cloud || this.isPolling || this.disposed) return;
    this.isPolling = true;

    try {
      const params = POLL_PROPERTIES.map((p) => ({
        did: this.deviceId,
        siid: p.siid,
        piid: p.piid,
      }));
      const props = await this.cloud.getProperties(this.deviceId, params);

      if (props && props.length > 0) {
        const propsWithValues = props
          .filter((p) => p.value !== undefined)
          .map((p) => ({ siid: p.siid, piid: p.piid, value: p.value }));
        this.processStateUpdate(propsWithValues);
      }
      this.consecutivePollFailures = 0;
    } catch (err: unknown) {
      this.consecutivePollFailures++;
      const level = this.consecutivePollFailures >= 3 ? 'warn' : 'debug';
      this.log[level](`HTTP poll failed for ${this.deviceName} (attempt ${this.consecutivePollFailures}): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isPolling = false;
      this.schedulePoll();
    }
  }

  private processStateUpdate(properties: Array<{ siid: number; piid: number; value: unknown }>): void {
    const currentState = this.accessoryHandler.getCurrentState();
    const newState = this.parser.processProperties(properties, currentState);
    const decodedCleanMode = newState.activity.cleanMode;
    newState.activity.cleanMode = this.handlers.resolveCleanModeForState(decodedCleanMode);
    this.accessoryHandler.onStateUpdate(newState);
    if (decodedCleanMode !== currentState.activity.cleanMode) {
      this.handlers.syncCleanModeFromDevice(decodedCleanMode);
    }
    // Keep suction/water levels in sync so room clean uses correct values
    this.handlers.syncLevelsFromDevice(newState.activity.suctionLevel, newState.activity.waterLevel);
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.mqttClient?.disconnect();
    this.mqttClient = null;
    this.cloud = null;
    this.accessoryHandler.dispose();
  }
}
