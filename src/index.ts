import { API } from 'homebridge';
import { DreameVacuumMatterPlatform } from './platform';

export default (api: API) => {
  api.registerPlatform('homebridge-dreame-vacuum-mqtt', 'DreameVacuumMatter', DreameVacuumMatterPlatform);
};
