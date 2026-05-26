import { describe, it, expect, vi } from 'vitest';
import { CleaningAutomationSwitch } from '../src/homekit/automation-switch';
import { createInitialState } from '../src/dreame/models';

const identity = { deviceId: 'dev-1', model: 'dreame.vacuum.test', firmware: '1.0' };

function createCharacteristic() {
  return {
    onGet: vi.fn().mockReturnThis(),
    onSet: vi.fn().mockReturnThis(),
  };
}

function createService(characteristic = createCharacteristic()) {
  return {
    setCharacteristic: vi.fn().mockReturnThis(),
    getCharacteristic: vi.fn(() => characteristic),
    updateCharacteristic: vi.fn(),
  };
}

function createApi() {
  return {
    hap: {
      Service: {
        AccessoryInformation: 'AccessoryInformation',
        Switch: 'Switch',
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        On: 'On',
      },
    },
  } as any;
}

function createAccessory(infoService: ReturnType<typeof createService>, switchService: ReturnType<typeof createService>) {
  return {
    context: {},
    getService: vi.fn((serviceType: string) => serviceType === 'AccessoryInformation' ? infoService : undefined),
    addService: vi.fn(() => switchService),
  } as any;
}

describe('CleaningAutomationSwitch', () => {
  it('should turn on only while the robot is cleaning', () => {
    const infoService = createService();
    const switchService = createService();
    const accessory = createAccessory(infoService, switchService);
    const automationSwitch = new CleaningAutomationSwitch(
      createApi(),
      accessory,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      'Falete',
      'dev-1',
      'dreame.vacuum.test',
    );

    const cleaningState = createInitialState(identity);
    cleaningState.activity.runMode = 'cleaning';
    automationSwitch.updateState(cleaningState);

    expect(automationSwitch.currentValue).toBe(true);
    expect(switchService.updateCharacteristic).toHaveBeenLastCalledWith('On', true);

    const idleState = createInitialState(identity);
    idleState.activity.runMode = 'idle';
    automationSwitch.updateState(idleState);

    expect(automationSwitch.currentValue).toBe(false);
    expect(switchService.updateCharacteristic).toHaveBeenLastCalledWith('On', false);
  });
});
