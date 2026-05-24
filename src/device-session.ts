import { Logger } from './util/logger';
import { DreameMqttClient } from './dreame/mqtt';
import { MatterCommandHandlers } from './matter/handlers';
import { DreameVacuumAccessory } from './matter/accessory';
import { StateParser } from './dreame/parser';

export class DeviceSession {
  private mqttClient: DreameMqttClient | null = null;

  constructor(
    private readonly deviceId: string,
    private readonly deviceName: string,
    private readonly handlers: MatterCommandHandlers,
    private readonly accessoryHandler: DreameVacuumAccessory,
    private readonly parser: StateParser,
    private readonly log: Logger,
  ) {}

  connectMqtt(mqttClient: DreameMqttClient): void {
    this.mqttClient = mqttClient;

    mqttClient.on('message', (properties) => {
      const currentState = this.accessoryHandler.getCurrentState();
      const newState = this.parser.processProperties(properties, currentState);
      const decodedCleanMode = newState.activity.cleanMode;
      newState.activity.cleanMode = this.handlers.resolveCleanModeForState(decodedCleanMode);
      this.accessoryHandler.onStateUpdate(newState);
      if (decodedCleanMode !== currentState.activity.cleanMode) {
        this.handlers.syncCleanModeFromDevice(decodedCleanMode);
      }
    });

    mqttClient.on('connected', () => {
      this.log.info(`MQTT connected for ${this.deviceName}`);
    });

    mqttClient.on('error', (err) => {
      this.log.error(`MQTT error for ${this.deviceName}: ${err.message}`);
    });

    mqttClient.connect();
  }

  dispose(): void {
    this.mqttClient?.disconnect();
    this.mqttClient = null;
    this.accessoryHandler.dispose();
  }
}
