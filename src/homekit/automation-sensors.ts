import type { API, PlatformAccessory, Service } from 'homebridge';
import { NormalizedState } from '../dreame/models.js';
import { Logger } from '../util/logger.js';

export const AUTOMATION_CONTACT_SENSORS_CONTEXT_KIND = 'dreameAutomationContactSensors';
export const LEGACY_AUTOMATION_SWITCH_CONTEXT_KIND = 'dreameCleaningAutomationSwitch';

type SensorKey = 'idle' | 'busy' | 'cleaning' | 'error';

type SensorDefinition = {
  key: SensorKey;
  displaySuffix: string;
  subtype: string;
  isDetected: (state: NormalizedState) => boolean;
};

const SENSOR_DEFINITIONS: SensorDefinition[] = [
  {
    key: 'idle',
    displaySuffix: 'Idle',
    subtype: 'idle-state',
    isDetected: (state) => state.activity.runMode === 'idle',
  },
  {
    key: 'busy',
    displaySuffix: 'Busy',
    subtype: 'busy-state',
    isDetected: (state) => state.activity.runMode !== 'idle',
  },
  {
    key: 'cleaning',
    displaySuffix: 'Cleaning',
    subtype: 'cleaning-state',
    isDetected: (state) => state.activity.runMode === 'cleaning',
  },
  {
    key: 'error',
    displaySuffix: 'Error',
    subtype: 'error-state',
    isDetected: (state) => state.activity.runMode === 'error' || !!state.activity.activeError,
  },
];

export class AutomationContactSensors {
  private readonly services = new Map<SensorKey, Service>();
  private readonly values = new Map<SensorKey, boolean>();

  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly log: Logger,
    private readonly deviceName: string,
    private readonly deviceId: string,
    private readonly model: string,
  ) {
    const { Service: HapService, Characteristic } = this.api.hap;

    accessory.context.kind = AUTOMATION_CONTACT_SENSORS_CONTEXT_KIND;
    accessory.context.deviceId = deviceId;
    accessory.context.model = model;

    accessory
      .getService(HapService.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Dreame')
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, deviceId);

    for (const definition of SENSOR_DEFINITIONS) {
      const name = `${deviceName} ${definition.displaySuffix}`;
      const service = accessory.getServiceById(HapService.ContactSensor, definition.subtype)
        ?? accessory.addService(HapService.ContactSensor, name, definition.subtype);
      service.setCharacteristic(Characteristic.Name, name);
      this.services.set(definition.key, service);
      this.values.set(definition.key, false);
    }
  }

  updateState(state: NormalizedState): void {
    for (const definition of SENSOR_DEFINITIONS) {
      const nextValue = definition.isDetected(state);
      if (this.values.get(definition.key) === nextValue) continue;

      this.values.set(definition.key, nextValue);
      this.services
        .get(definition.key)
        ?.updateCharacteristic(
          this.api.hap.Characteristic.ContactSensorState,
          nextValue
            ? this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
            : this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
        );
      this.log.debug(`${this.deviceName} ${definition.displaySuffix} automation sensor is ${nextValue ? 'detected' : 'not detected'}`);
    }
  }

  getValue(key: SensorKey): boolean {
    return this.values.get(key) ?? false;
  }
}
