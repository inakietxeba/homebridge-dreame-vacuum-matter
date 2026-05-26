import { describe, it, expect, vi } from 'vitest';
import { AutomationContactSensors } from '../src/homekit/automation-sensors';
import { createInitialState } from '../src/dreame/models';

const identity = { deviceId: 'dev-1', model: 'dreame.vacuum.test', firmware: '1.0' };

function createService() {
  return {
    setCharacteristic: vi.fn().mockReturnThis(),
    updateCharacteristic: vi.fn(),
  };
}

function createApi() {
  return {
    hap: {
      Service: {
        AccessoryInformation: 'AccessoryInformation',
        ContactSensor: 'ContactSensor',
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        ContactSensorState: {
          CONTACT_DETECTED: 0,
          CONTACT_NOT_DETECTED: 1,
        },
      },
    },
  } as any;
}

function createAccessory(infoService: ReturnType<typeof createService>) {
  const services = new Map<string, ReturnType<typeof createService>>();
  return {
    context: {},
    services,
    getService: vi.fn((serviceType: string) => serviceType === 'AccessoryInformation' ? infoService : undefined),
    getServiceById: vi.fn((_serviceType: string, subtype: string) => services.get(subtype)),
    addService: vi.fn((_serviceType: string, _name: string, subtype: string) => {
      const service = createService();
      services.set(subtype, service);
      return service;
    }),
  } as any;
}

describe('AutomationContactSensors', () => {
  it('should expose idle as detected only when the robot is truly idle', () => {
    const infoService = createService();
    const accessory = createAccessory(infoService);
    const sensors = new AutomationContactSensors(
      createApi(),
      accessory,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Falete',
      'dev-1',
      'dreame.vacuum.test',
    );

    const idleState = createInitialState(identity);
    idleState.activity.runMode = 'idle';
    sensors.updateState(idleState);

    expect(sensors.getValue('idle')).toBe(true);
    expect(accessory.services.get('idle-state')?.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      0,
    );

    const maintenanceState = createInitialState(identity);
    maintenanceState.activity.runMode = 'maintenance';
    sensors.updateState(maintenanceState);

    expect(sensors.getValue('idle')).toBe(false);
    expect(sensors.getValue('busy')).toBe(true);
    expect(accessory.services.get('idle-state')?.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      1,
    );
  });

  it('should expose cleaning and error contact sensors', () => {
    const infoService = createService();
    const accessory = createAccessory(infoService);
    const sensors = new AutomationContactSensors(
      createApi(),
      accessory,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Falete',
      'dev-1',
      'dreame.vacuum.test',
    );

    const cleaningState = createInitialState(identity);
    cleaningState.activity.runMode = 'cleaning';
    sensors.updateState(cleaningState);

    expect(sensors.getValue('cleaning')).toBe(true);
    expect(sensors.getValue('busy')).toBe(true);

    const errorState = createInitialState(identity);
    errorState.activity.runMode = 'error';
    errorState.activity.activeError = 'Error 5';
    sensors.updateState(errorState);

    expect(sensors.getValue('cleaning')).toBe(false);
    expect(sensors.getValue('error')).toBe(true);
  });
});
