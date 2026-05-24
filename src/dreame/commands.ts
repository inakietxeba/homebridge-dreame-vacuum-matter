import { CleaningMode } from '../config';
import { DreameCloud } from './cloud';
import { SuctionLevel, WaterLevel } from './models';

/**
 * Builds and sends commands to a Dreame device via Dreame Cloud HTTP API.
 * Commands use the MIoT siid/piid/aiid convention.
 *
 * Action IDs (siid 4):
 *   aiid 1 = Start cleaning
 *   aiid 2 = Stop cleaning
 *   aiid 3 = Pause (if supported)
 *
 * Action IDs (siid 6):
 *   aiid 1 = Return to dock
 */
export class CommandBuilder {
  constructor(
    private readonly cloud: DreameCloud,
    private readonly deviceId: string,
  ) {}

  async startCleaning(): Promise<void> {
    await this.cloud.action(this.deviceId, 4, 1);
  }

  async stopCleaning(): Promise<void> {
    await this.cloud.action(this.deviceId, 4, 2);
  }

  async pauseCleaning(): Promise<void> {
    await this.cloud.action(this.deviceId, 4, 3);
  }

  async returnToDock(): Promise<void> {
    await this.cloud.action(this.deviceId, 6, 1);
  }

  async setSuctionLevel(level: SuctionLevel): Promise<void> {
    await this.cloud.setProperties(this.deviceId, [
      { did: this.deviceId, siid: 4, piid: 4, value: level },
    ]);
  }

  async setWaterLevel(level: WaterLevel): Promise<void> {
    await this.cloud.setProperties(this.deviceId, [
      { did: this.deviceId, siid: 4, piid: 5, value: level },
    ]);
  }

  async setCleaningMode(mode: CleaningMode): Promise<void> {
    const modeValue = CLEANING_MODE_TO_VALUE[mode];
    await this.cloud.setProperties(this.deviceId, [
      { did: this.deviceId, siid: 4, piid: 23, value: modeValue },
    ]);
  }
}

const CLEANING_MODE_TO_VALUE: Record<CleaningMode, number> = {
  SWEEP: 0,
  MOP: 1,
  SWEEP_AND_MOP: 2,
};
