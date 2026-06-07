import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceSession } from '../src/device-session';
import { createInitialState, NormalizedState } from '../src/dreame/models';
import { EventEmitter } from 'events';

const identity = { deviceId: 'dev-1', model: 'dreame.vacuum.test', firmware: '1.0' };

function createMockHandlers() {
  return {
    resolveCleanModeForState: vi.fn((mode: string) => mode),
    syncCleanModeFromDevice: vi.fn(),
  } as any;
}

function createMockAccessory(state?: NormalizedState) {
  const s = state ?? createInitialState(identity);
  return {
    getCurrentState: vi.fn(() => s),
    onStateUpdate: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

function createMockAutomationSensors() {
  return {
    updateState: vi.fn(),
  } as any;
}

function createMockParser() {
  return {
    processProperties: vi.fn((_props: any, currentState: NormalizedState) => {
      return structuredClone(currentState);
    }),
  } as any;
}

function createMockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

function createMockCloud() {
  return {
    getProperties: vi.fn().mockResolvedValue([
      { siid: 2, piid: 1, value: 6 },
      { siid: 3, piid: 1, value: 100 },
    ]),
  } as any;
}

function createMockMqtt() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
}

describe('DeviceSession', () => {
  let handlers: ReturnType<typeof createMockHandlers>;
  let accessory: ReturnType<typeof createMockAccessory>;
  let parser: ReturnType<typeof createMockParser>;
  let log: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = createMockHandlers();
    accessory = createMockAccessory();
    parser = createMockParser();
    log = createMockLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('MQTT message processing', () => {
    it('should process MQTT properties through parser and accessory', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const mqttClient = createMockMqtt();

      session.connectMqtt(mqttClient as any);

      const props = [{ siid: 2, piid: 1, value: 1 }];
      mqttClient.emit('message', props);

      expect(parser.processProperties).toHaveBeenCalledWith(props, accessory.getCurrentState());
      expect(handlers.resolveCleanModeForState).toHaveBeenCalled();
      expect(accessory.onStateUpdate).toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Dreame raw MQTT'));
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Dreame normalized'));
    });

    it('should update the automation sensors from MQTT state', () => {
      const automationSensors = createMockAutomationSensors();
      const newState = createInitialState(identity);
      newState.activity.runMode = 'cleaning';
      parser.processProperties.mockReturnValue(newState);
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log, automationSensors);
      const mqttClient = createMockMqtt();

      session.connectMqtt(mqttClient as any);
      mqttClient.emit('message', [{ siid: 2, piid: 1, value: 1 }]);

      expect(automationSensors.updateState).toHaveBeenCalledWith(newState);
    });

    it('should catch errors from MQTT processing', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const mqttClient = createMockMqtt();
      parser.processProperties.mockImplementation(() => { throw new Error('parse error'); });

      session.connectMqtt(mqttClient as any);
      mqttClient.emit('message', [{ siid: 2, piid: 1, value: 1 }]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('parse error'));
    });

    it('should sync clean mode when it changes', () => {
      const currentState = createInitialState(identity);
      currentState.activity.cleanMode = 'SWEEP';
      accessory = createMockAccessory(currentState);

      const newState = createInitialState(identity);
      newState.activity.cleanMode = 'MOP';
      parser = createMockParser();
      parser.processProperties.mockReturnValue(newState);

      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const mqttClient = createMockMqtt();
      session.connectMqtt(mqttClient as any);

      mqttClient.emit('message', [{ siid: 4, piid: 23, value: 1 }]);

      expect(handlers.syncCleanModeFromDevice).toHaveBeenCalledWith('MOP');
    });
  });

  describe('MQTT connection events', () => {
    it('should track MQTT connected state', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const mqttClient = createMockMqtt();

      session.connectMqtt(mqttClient as any);
      mqttClient.emit('connected');

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('MQTT connected'));
    });

    it('should handle MQTT errors', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const mqttClient = createMockMqtt();

      session.connectMqtt(mqttClient as any);
      mqttClient.emit('error', new Error('connection lost'));

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
    });

    it('should disconnect the previous MQTT client before replacing it', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const firstClient = createMockMqtt();
      const secondClient = createMockMqtt();

      session.connectMqtt(firstClient as any);
      session.connectMqtt(secondClient as any);

      expect(firstClient.disconnect).toHaveBeenCalled();
      expect(secondClient.connect).toHaveBeenCalled();
    });
  });

  describe('HTTP polling', () => {
    it('should schedule polling when cloud is set', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const cloud = createMockCloud();

      session.setCloud(cloud);

      // Advance timer to trigger poll (60s for idle, no MQTT)
      vi.advanceTimersByTime(60_000);

      expect(cloud.getProperties).toHaveBeenCalled();
    });

    it('should process polled properties through processStateUpdate', async () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const cloud = createMockCloud();

      session.setCloud(cloud);
      vi.advanceTimersByTime(60_000);

      // Wait for the async poll to complete
      await vi.waitFor(() => {
        expect(parser.processProperties).toHaveBeenCalled();
      });
      expect(accessory.onStateUpdate).toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Dreame raw HTTP'));
    });

    it('should use shorter interval when cleaning without MQTT', async () => {
      const cleaningState = createInitialState(identity);
      cleaningState.activity.runMode = 'cleaning';
      accessory = createMockAccessory(cleaningState);

      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const cloud = createMockCloud();

      session.setCloud(cloud);

      // Should not trigger at 14s
      vi.advanceTimersByTime(14_000);
      expect(cloud.getProperties).not.toHaveBeenCalled();

      // Should trigger at 15s
      vi.advanceTimersByTime(1_000);
      expect(cloud.getProperties).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should disconnect MQTT and clear state', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const mqttClient = createMockMqtt();
      session.connectMqtt(mqttClient as any);
      session.setCloud(createMockCloud());

      session.dispose();

      expect(mqttClient.disconnect).toHaveBeenCalled();
      expect(accessory.dispose).toHaveBeenCalled();
    });

    it('should not poll after dispose', () => {
      const session = new DeviceSession('dev-1', 'TestBot', handlers, accessory, parser, log);
      const cloud = createMockCloud();
      session.setCloud(cloud);

      session.dispose();
      vi.advanceTimersByTime(300_000);

      expect(cloud.getProperties).not.toHaveBeenCalled();
    });
  });
});
