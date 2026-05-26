import type { API } from 'homebridge';
import { DreameVacuumMatterPlatform } from './platform.js';

export default (api: API) => {
  api.registerPlatform('homebridge-dreame-vacuum-matter', 'DreameVacuumMatter', DreameVacuumMatterPlatform);
};
