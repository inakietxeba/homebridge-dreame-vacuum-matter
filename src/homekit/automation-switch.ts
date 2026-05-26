import type { API, PlatformAccessory, Service } from 'homebridge';
import { NormalizedState } from '../dreame/models.js';
import { Logger } from '../util/logger.js';

export const AUTOMATION_SWITCH_CONTEXT_KIND = 'dreameCleaningAutomationSwitch';

export class CleaningAutomationSwitch {
  private readonly service: Service;
  private isCleaning = false;

  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly log: Logger,
    private readonly deviceName: string,
    private readonly deviceId: string,
    private readonly model: string,
  ) {
    const { Service: HapService, Characteristic } = this.api.hap;

    accessory.context.kind = AUTOMATION_SWITCH_CONTEXT_KIND;
    accessory.context.deviceId = deviceId;
    accessory.context.model = model;

    accessory
      .getService(HapService.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Dreame')
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, deviceId);

    this.service = accessory.getService(HapService.Switch)
      ?? accessory.addService(HapService.Switch, `${deviceName} Cleaning`, 'cleaning-state');

    this.service.setCharacteristic(Characteristic.Name, `${deviceName} Cleaning`);
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.isCleaning)
      .onSet((value) => {
        this.log.debug(
          `Ignoring manual change for ${deviceName} Cleaning automation switch (${String(value)}); it reflects robot state only.`,
        );
        this.service.updateCharacteristic(Characteristic.On, this.isCleaning);
      });
  }

  updateState(state: NormalizedState): void {
    const nextIsCleaning = state.activity.runMode === 'cleaning';
    if (nextIsCleaning === this.isCleaning) return;

    this.isCleaning = nextIsCleaning;
    this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.isCleaning);
    this.log.debug(`${this.deviceName} Cleaning automation switch is now ${this.isCleaning ? 'On' : 'Off'}`);
  }

  get currentValue(): boolean {
    return this.isCleaning;
  }
}
