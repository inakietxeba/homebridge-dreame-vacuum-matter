import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { discoverUiMaps, discoverUiRobots } from './devices.js';

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    let loading = false;
    this.onRequest('/robots', async (payload) => {
      if (loading) return { success: false, error: 'Robots are already being loaded. Please wait.' };
      loading = true;
      try {
        return await discoverUiRobots(payload);
      } finally {
        loading = false;
      }
    });
    let loadingMaps = false;
    this.onRequest('/maps', async (payload) => {
      if (loadingMaps) return { success: false, error: 'Maps are already being loaded. Please wait.' };
      loadingMaps = true;
      try {
        return await discoverUiMaps(payload);
      } finally {
        loadingMaps = false;
      }
    });
    this.ready();
  }
}

new UiServer();
