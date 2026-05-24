import { Logger } from './util/logger';
import { DreameMqttClient } from './dreame/mqtt';
import { DreameCloud } from './dreame/cloud';
import { MatterCommandHandlers } from './matter/handlers';
import { DreameVacuumAccessory } from './matter/accessory';
import { StateParser } from './dreame/parser';

export class DeviceSession {
  private mqttClient: DreameMqttClient | null = null;
  private cloud: DreameCloud | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private mqttConnected = false;
  private isPolling = false;
  private disposed = false;

  /** Polling intervals matching homebridge-dreame-vacuum (HomeKit). */
  private static readonly POLL_ACTIVE_MS = 15_000;      // 15s when cleaning
  private static readonly POLL_MQTT_ACTIVE_MS = 60_000;  // 60s backup when MQTT + cleaning
  private static readonly POLL_MQTT_IDLE_MS = 180_000;   // 180s backup when MQTT + idle
  private static readonly POLL_NO_MQTT_MS = 60_000;      // 60s when no MQTT

  /** Properties to poll via HTTP. */
  private static readonly POLL_PROPERTIES = [
    { siid: 2, piid: 1 }, // Device state
    { siid: 2, piid: 2 }, // Error
    { siid: 3, piid: 1 }, // Battery
    { siid: 3, piid: 2 }, // Charge status
    { siid: 4, piid: 4 }, // Suction
    { siid: 4, piid: 5 }, // Water level
    { siid: 4, piid: 23 }, // Cleaning mode
  ];

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
        const currentState = this.accessoryHandler.getCurrentState();
        const newState = this.parser.processProperties(properties, currentState);
        const decodedCleanMode = newState.activity.cleanMode;
        newState.activity.cleanMode = this.handlers.resolveCleanModeForState(decodedCleanMode);
        this.accessoryHandler.onStateUpdate(newState);
        if (decodedCleanMode !== currentState.activity.cleanMode) {
          this.handlers.syncCleanModeFromDevice(decodedCleanMode);
        }
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
      const params = DeviceSession.POLL_PROPERTIES.map((p) => ({
        did: this.deviceId,
        siid: p.siid,
        piid: p.piid,
      }));
      const props = await this.cloud.getProperties(this.deviceId, params);

      if (props && props.length > 0) {
        const currentState = this.accessoryHandler.getCurrentState();
        const propsWithValues = props
          .filter((p) => p.value !== undefined)
          .map((p) => ({ siid: p.siid, piid: p.piid, value: p.value }));
        const newState = this.parser.processProperties(propsWithValues, currentState);
        const decodedCleanMode = newState.activity.cleanMode;
        newState.activity.cleanMode = this.handlers.resolveCleanModeForState(decodedCleanMode);
        this.accessoryHandler.onStateUpdate(newState);
      }
    } catch (err: unknown) {
      this.log.debug(`HTTP poll failed for ${this.deviceName}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isPolling = false;
      this.schedulePoll();
    }
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
