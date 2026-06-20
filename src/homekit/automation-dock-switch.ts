import type { API, PlatformAccessory, Service } from 'homebridge';
import { Logger } from '../util/logger.js';

export const AUTOMATION_DOCK_SWITCH_CONTEXT_KIND = 'dreameAutomationDockSwitch';

export class AutomationDockSwitch {
  private readonly service: Service;

  constructor(
    private readonly api: API,
    accessory: PlatformAccessory,
    private readonly log: Logger,
    deviceName: string,
    deviceId: string,
    model: string,
    private readonly returnToDock: () => Promise<void>,
  ) {
    const { Service: HapService, Characteristic } = this.api.hap;
    const name = `${deviceName} Return to Dock`;

    accessory.context.kind = AUTOMATION_DOCK_SWITCH_CONTEXT_KIND;
    accessory.context.deviceId = deviceId;
    accessory.context.model = model;

    accessory
      .getService(HapService.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Dreame')
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, `${deviceId}-return-to-dock`);

    this.service = accessory.getService(HapService.Switch)
      ?? accessory.addService(HapService.Switch, name);
    this.service.setCharacteristic(Characteristic.Name, name);
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (!value) return;

        this.log.info(`Return-to-dock automation triggered for ${deviceName}`);
        try {
          await this.returnToDock();
        } finally {
          this.service.updateCharacteristic(Characteristic.On, false);
        }
      });
    this.service.updateCharacteristic(Characteristic.On, false);
  }
}
