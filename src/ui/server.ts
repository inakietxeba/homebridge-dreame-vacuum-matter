import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { discoverUiRobots } from './devices.js';

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
    this.ready();
  }
}

new UiServer();
