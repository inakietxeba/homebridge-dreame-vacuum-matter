import { Logger, safeError } from './util/logger.js';
import { DreameMqttClient } from './dreame/mqtt.js';
import { DreameCloud } from './dreame/cloud.js';
import { MatterCommandHandlers } from './matter/handlers.js';
import { DreameVacuumAccessory } from './matter/accessory.js';
import { StateParser } from './dreame/parser.js';
import { POLL_PROPERTIES } from './dreame/models.js';
import { AutomationContactSensors } from './homekit/automation-sensors.js';

export class DeviceSession {
  private readonly log: Logger;
  private mqttClient: DreameMqttClient | null = null;
  private cloud: DreameCloud | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pollDueAt = 0;
  private mqttConnected = false;
  private isPolling = false;
  private disposed = false;
  private consecutivePollFailures = 0;
  private lastLoggedState?: string;
  private mqttWasConnected = false;
  private mqttFailureWarned = false;
  private mqttAuthErrorLogged = false;
  private pollFailureStarted = 0;
  private lastPollWarning = 0;
  private lastPollCode = '';

  /** Polling intervals. */
  private static readonly POLL_ACTIVE_MS = 15_000;       // 15s when cleaning without MQTT
  private static readonly POLL_MQTT_ACTIVE_MS = 60_000;   // 60s backup when MQTT + cleaning
  private static readonly POLL_MQTT_IDLE_MS = 60_000;     // 60s heartbeat when MQTT + idle
  private static readonly POLL_NO_MQTT_MS = 60_000;       // 60s when no MQTT + idle

  constructor(
    private readonly deviceId: string,
    deviceName: string,
    private readonly handlers: MatterCommandHandlers,
    private readonly accessoryHandler: DreameVacuumAccessory,
    private readonly parser: StateParser,
    log: Logger,
    private readonly automationSensors?: AutomationContactSensors,
    private readonly diagnosticLogging = false,
  ) {
    this.log = log.forRobot(deviceName);
  }

  setCloud(cloud: DreameCloud): void {
    this.cloud = cloud;
    this.schedulePoll();
  }

  connectMqtt(mqttClient: DreameMqttClient): void {
    if (this.disposed) return;
    if (this.mqttClient) {
      this.mqttClient.removeAllListeners();
      this.mqttClient.disconnect();
    }
    this.mqttConnected = false;
    this.mqttClient = mqttClient;

    mqttClient.on('message', (properties) => {
      try {
        this.processStateUpdate(properties, 'MQTT');
      } catch (err: unknown) {
        this.log.error(`Failed to process MQTT message: ${safeError(err)}`);
      }
      // Reschedule poll after receiving MQTT data (reset timer)
      this.schedulePoll();
    });

    mqttClient.on('connected', () => {
      const wasConnected = this.mqttConnected;
      this.mqttConnected = true;
      if (!wasConnected) this.log.info(`MQTT ${this.mqttWasConnected ? 'reconnected' : 'connected'}`);
      this.mqttWasConnected = true;
      this.mqttFailureWarned = false;
      this.mqttAuthErrorLogged = false;
      this.schedulePoll();
    });

    mqttClient.on('disconnected', () => {
      if (!this.disposed && !this.mqttFailureWarned) {
        this.log.warn('MQTT unavailable; HTTP polling remains active.');
        this.mqttFailureWarned = true;
      }
      this.mqttConnected = false;
      this.schedulePoll();
    });

    mqttClient.on('error', (err) => {
      if ((err.code === 5 || err.message?.includes('Not authorized')) && !this.mqttAuthErrorLogged && !this.disposed) {
        this.log.error('MQTT authentication failed; HTTP polling remains active.');
        this.mqttAuthErrorLogged = true;
      }
      if (!this.disposed && !this.mqttFailureWarned) {
        this.log.warn('MQTT unavailable; HTTP polling remains active.');
        this.mqttFailureWarned = true;
      }
      this.mqttConnected = false;
      this.log.debug(`MQTT connection error${typeof err.code === 'number' ? ` (code ${err.code})` : ''}`);
      this.schedulePoll();
    });

    mqttClient.connect();
  }

  private getPollingInterval(): number {
    const runMode = this.accessoryHandler.getCurrentState().activity.runMode;
    const isActive = runMode === 'cleaning'
      || runMode === 'returning'
      || runMode === 'maintenance'
      || runMode === 'mapping';

    if (!this.mqttConnected) {
      // No MQTT: poll aggressively while the robot is active, 60s otherwise
      return isActive ? DeviceSession.POLL_ACTIVE_MS : DeviceSession.POLL_NO_MQTT_MS;
    }

    // MQTT connected: backup poll every 60s.
    return isActive ? DeviceSession.POLL_MQTT_ACTIVE_MS : DeviceSession.POLL_MQTT_IDLE_MS;
  }

  private schedulePoll(): void {
    if (!this.cloud || this.disposed) return;
    const interval = this.getPollingInterval();
    const dueAt = Date.now() + interval;

    // Keep an earlier poll deadline. Frequent partial MQTT messages must not
    // postpone the HTTP fallback indefinitely.
    if (this.pollTimer && this.pollDueAt <= dueAt) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollDueAt = dueAt;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      this.pollDueAt = 0;
      void this.poll();
    }, interval);
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
      if (this.disposed) return;

      const propsWithValues = props
        .filter((p) => (p.code === undefined || p.code === 0) && p.value !== undefined && p.value !== null)
        .map((p) => ({ siid: p.siid, piid: p.piid, value: p.value }));
      if (propsWithValues.length === 0) throw new Error('no readable properties');
      this.processStateUpdate(propsWithValues, 'HTTP');
      if (this.consecutivePollFailures >= 3) this.log.info(`HTTP polling recovered after ${this.consecutivePollFailures} failures (${Math.round((Date.now() - this.pollFailureStarted) / 1000)}s).`);
      this.consecutivePollFailures = 0;
      this.pollFailureStarted = 0;
      this.lastPollWarning = 0;
      this.lastPollCode = '';
    } catch (err: unknown) {
      if (this.disposed) return;
      if (this.consecutivePollFailures === 0) this.pollFailureStarted = Date.now();
      this.consecutivePollFailures++;
      const code = err instanceof Error
        ? err.message.match(/(?:HTTP|cloud code) \d+|^no readable properties$/)?.[0] ?? 'request failed'
        : 'request failed';
      const message = `HTTP poll failed (${code}; attempt ${this.consecutivePollFailures}).`;
      if (this.consecutivePollFailures < 3) this.log.debug(message);
      else if (this.consecutivePollFailures === 3 || code !== this.lastPollCode || Date.now() - this.lastPollWarning >= 300_000) {
        this.log.warn(`${message} Robot state updates may be delayed.`);
        this.lastPollWarning = Date.now();
        this.lastPollCode = code;
      }
    } finally {
      this.isPolling = false;
      if (!this.disposed) {
        this.schedulePoll();
      }
    }
  }

  private processStateUpdate(
    properties: Array<{ siid: number; piid: number; value: unknown }>,
    source: 'HTTP' | 'MQTT',
  ): void {
    if (this.disposed) return;
    if (this.diagnosticLogging) {
      const allowed = new Set(POLL_PROPERTIES.map((p) => `${p.siid}.${p.piid}`));
      const diagnostic = properties.filter((p) => allowed.has(`${p.siid}.${p.piid}`)).flatMap((p) => {
        const property = `${p.siid}.${p.piid}`;
        if (typeof p.value === 'number' && Number.isFinite(p.value) || typeof p.value === 'boolean') {
          return [{ property, value: p.value }];
        }
        if (property === '4.50' && typeof p.value === 'string') {
          try {
            const data: unknown = JSON.parse(p.value);
            if (!Array.isArray(data)) return [];
            const keys = new Set(['SmartHost', 'SmartAutoWash', 'CleanType', 'CleanRoute']);
            return data.filter((v) => v && typeof v === 'object' && keys.has(v.k) && (typeof v.v === 'boolean' || typeof v.v === 'number' && Number.isFinite(v.v)))
              .map((v) => ({ property: `${property}.${v.k}`, value: v.v }));
          } catch { return []; }
        }
        return [];
      });
      this.log.debug(`Dreame diagnostic ${source}: ${JSON.stringify(diagnostic)}`);
    }
    const currentState = this.accessoryHandler.getCurrentState();
    const newState = this.parser.processProperties(properties, currentState);
    this.handlers.syncCapabilities(newState.capabilities);
    newState.activity.cleaningProfile = this.handlers.resolveCleaningProfileForState(newState.activity.cleaningProfile);
    const decodedCleanMode = newState.activity.cleanMode;
    const resolvedCleanMode = this.handlers.resolveCleanModeForState(decodedCleanMode);
    newState.activity.cleanMode = resolvedCleanMode;
    const summary = JSON.stringify({
      rawDeviceState: newState.activity.rawDeviceState,
      runMode: newState.activity.runMode,
      paused: newState.activity.paused,
      maintenanceType: newState.activity.maintenanceType ?? null,
      cleanMode: newState.activity.cleanMode,
      cleaningProfile: newState.activity.cleaningProfile ?? null,
      currentMapId: newState.activity.currentMapId ?? null,
      activeErrorCode: newState.activity.activeErrorCode ?? null,
      batteryPercent: newState.power.batteryPercent,
      charging: newState.power.charging,
      docked: newState.power.docked,
      selectedRooms: newState.activity.selectedRooms,
    });
    if (summary !== this.lastLoggedState) {
      this.lastLoggedState = summary;
      this.log.debug(`Dreame normalized (${source}): ${summary}`);
    }
    this.accessoryHandler.onStateUpdate(newState);
    this.automationSensors?.updateState(newState);
    this.handlers.syncCleanModeFromDevice(decodedCleanMode);
    // Keep suction/water levels in sync so room clean uses correct values
    this.handlers.syncLevelsFromDevice(newState.activity.suctionLevel, newState.activity.waterLevel);
    this.handlers.syncCurrentMapId(newState.activity.currentMapId);
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollDueAt = 0;
    this.mqttClient?.removeAllListeners();
    this.mqttClient?.disconnect();
    this.mqttClient = null;
    this.cloud = null;
    this.accessoryHandler.dispose();
  }
}
