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

function createAccessory() {
  const contactService = createService();
  const infoService = createService();
  const accessory = {
    context: {},
    getService: vi.fn((serviceType: string) => serviceType === 'AccessoryInformation' ? infoService : undefined),
    addService: vi.fn(() => contactService),
  } as any;
  return { accessory, contactService, infoService };
}

function createAccessories() {
  const entries = {
    idle: createAccessory(),
    busy: createAccessory(),
    cleaning: createAccessory(),
    error: createAccessory(),
  };

  return {
    entries,
    map: new Map([
      ['idle', entries.idle.accessory],
      ['busy', entries.busy.accessory],
      ['cleaning', entries.cleaning.accessory],
      ['error', entries.error.accessory],
    ]),
  };
}

describe('AutomationContactSensors', () => {
  it('should expose idle as detected only when the robot is truly idle', () => {
    const { entries, map } = createAccessories();
    const sensors = new AutomationContactSensors(
      createApi(),
      map as any,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Robot',
      'dev-1',
      'dreame.vacuum.test',
    );

    const idleState = createInitialState(identity);
    idleState.activity.runMode = 'idle';
    sensors.updateState(idleState);

    expect(sensors.getValue('idle')).toBe(true);
    expect(entries.idle.contactService.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      1,
    );

    const maintenanceState = createInitialState(identity);
    maintenanceState.activity.runMode = 'maintenance';
    sensors.updateState(maintenanceState);

    expect(sensors.getValue('idle')).toBe(false);
    expect(sensors.getValue('busy')).toBe(true);
    expect(entries.idle.contactService.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      0,
    );
  });

  it('should expose cleaning and error contact sensors', () => {
    const { entries, map } = createAccessories();
    const sensors = new AutomationContactSensors(
      createApi(),
      map as any,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Robot',
      'dev-1',
      'dreame.vacuum.test',
    );

    const cleaningState = createInitialState(identity);
    cleaningState.activity.runMode = 'cleaning';
    sensors.updateState(cleaningState);

    expect(sensors.getValue('cleaning')).toBe(true);
    expect(sensors.getValue('busy')).toBe(true);
    expect(entries.cleaning.contactService.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      1,
    );

    const errorState = createInitialState(identity);
    errorState.activity.runMode = 'error';
    errorState.activity.activeError = 'Error 5';
    sensors.updateState(errorState);

    expect(sensors.getValue('cleaning')).toBe(false);
    expect(sensors.getValue('error')).toBe(true);
    expect(entries.error.contactService.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      1,
    );
  });

  it('should publish inactive initial values as contact detected', () => {
    const { entries, map } = createAccessories();
    const sensors = new AutomationContactSensors(
      createApi(),
      map as any,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Robot',
      'dev-1',
      'dreame.vacuum.test',
    );

    const idleState = createInitialState(identity);
    idleState.activity.runMode = 'idle';
    sensors.updateState(idleState);

    expect(sensors.getValue('cleaning')).toBe(false);
    expect(sensors.getValue('error')).toBe(false);
    expect(entries.cleaning.contactService.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      0,
    );
    expect(entries.error.contactService.updateCharacteristic).toHaveBeenLastCalledWith(
      { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
      0,
    );
  });

  it('should name each contact sensor service with its state', () => {
    const { entries, map } = createAccessories();

    new AutomationContactSensors(
      createApi(),
      map as any,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Robot',
      'dev-1',
      'dreame.vacuum.test',
    );

    expect(entries.idle.contactService.setCharacteristic).toHaveBeenCalledWith('Name', 'Robot Idle');
    expect(entries.busy.contactService.setCharacteristic).toHaveBeenCalledWith('Name', 'Robot Busy');
    expect(entries.cleaning.contactService.setCharacteristic).toHaveBeenCalledWith('Name', 'Robot Cleaning');
    expect(entries.error.contactService.setCharacteristic).toHaveBeenCalledWith('Name', 'Robot Error');
  });
});
