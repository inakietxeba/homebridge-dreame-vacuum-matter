export async function initRobotPicker(homebridge, root = document) {
  homebridge.disableSaveButton();
  const selection = root.getElementById('robot-selection');
  const load = root.getElementById('load-robots');
  const status = root.getElementById('robot-status');
  const list = root.getElementById('robot-list');
  const options = root.getElementById('robot-options');
  const blocks = await homebridge.getPluginConfig();
  let config = { platform: 'DreameVacuumMatter', name: 'Dreame Vacuum', ...blocks[0] };
  let devices = [];
  let fetched = false;
  let accountVersion = 0;
  let loading = false;
  let updates = Promise.resolve();
  let updateVersion = 0;
  let active = true;
  const schema = await homebridge.getPluginConfigSchema();
  const formSchema = structuredClone(schema);
  delete formSchema.schema.properties.deviceSelection;
  delete formSchema.schema.properties.deviceIds;
  const form = homebridge.createForm(formSchema, config);

  function show(message) { status.textContent = message; }

  function updateConfig() {
    const version = ++updateVersion;
    homebridge.disableSaveButton();
    const snapshot = structuredClone([{ ...config }, ...blocks.slice(1)]);
    updates = updates.catch(() => {}).then(() => homebridge.updatePluginConfig(snapshot));
    return updates.then(() => {
      if (active && version === updateVersion) homebridge.enableSaveButton();
    }).catch(() => {
      if (active && version === updateVersion) show('Could not update settings. Close and reopen settings before saving.');
    });
  }

  function render(focusId) {
    const mode = config.deviceSelection || 'all';
    selection.value = mode;
    options.replaceChildren();
    const known = new Set(devices.map((device) => device.id));
    const selected = new Set(config.deviceIds || []);
    const entries = [...devices, ...[...selected].filter((id) => !known.has(id)).map((id) => ({
      id, name: 'Previously selected robot (not in the current list)', model: id,
    }))];
    list.hidden = !fetched || entries.length === 0;
    for (const [index, device] of entries.entries()) {
      const row = root.createElement('div');
      row.className = 'form-check mb-2';
      const checkbox = root.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'form-check-input';
      checkbox.id = `dreame-robot-${index}`;
      checkbox.checked = mode === 'all' || (mode === 'selected' && selected.has(device.id));
      checkbox.disabled = loading;
      const label = root.createElement('label');
      label.className = 'form-check-label';
      label.htmlFor = checkbox.id;
      const name = root.createElement('strong');
      name.textContent = device.name;
      const detail = root.createElement('small');
      detail.className = 'd-block text-muted';
      detail.textContent = `${device.model} (${device.id})`;
      label.append(name, detail);
      checkbox.addEventListener('change', () => {
        const ids = mode === 'all' ? new Set(entries.map((entry) => entry.id)) : new Set(mode === 'none' ? [] : config.deviceIds || []);
        if (checkbox.checked) ids.add(device.id);
        else ids.delete(device.id);
        config = { ...config, deviceSelection: 'selected', deviceIds: [...ids] };
        render(checkbox.id);
        show(ids.size ? 'Selection updated. Save and restart Homebridge to apply.' : 'No robots selected. Saving and restarting will remove this plugin\'s accessories.');
        void updateConfig();
      });
      row.append(checkbox, label);
      options.append(row);
    }
    if (focusId) root.getElementById(focusId)?.focus();
  }

  selection.addEventListener('change', () => {
    config = { ...config, deviceSelection: selection.value };
    render();
    show('Selection updated. Save and restart Homebridge to apply.');
    void updateConfig();
  });

  form.onChange((change) => {
    const previousAccount = [config.username, config.password, config.country || 'eu'];
    config = { ...config, ...change, deviceSelection: config.deviceSelection || 'all', deviceIds: config.deviceIds || [] };
    const nextAccount = [config.username, config.password, config.country || 'eu'];
    if (previousAccount.some((value, index) => value !== nextAccount[index])) {
      accountVersion++;
      devices = [];
      fetched = false;
      render();
      show('Account details changed. Load robots again before changing the selection.');
    }
    void updateConfig();
  });

  load.addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    load.disabled = true;
    selection.disabled = true;
    render();
    show('Loading robots from Dreame...');
    const version = accountVersion;
    try {
      const result = await homebridge.request('/robots', {
        username: config.username, password: config.password, country: config.country || 'eu',
      });
      if (!active || version !== accountVersion) return;
      if (!result.success) {
        show(result.error || 'Could not load robots. Your selection has not changed.');
        return;
      }
      devices = result.devices;
      fetched = true;
      show(devices.length ? 'Check the robots you want to show. Loading this list does not change your selection.' : 'No Dreame robots returned. Your saved selection has not changed.');
    } catch {
      if (active && version === accountVersion) show('Could not load robots. Check your account details and retry. Your selection has not changed.');
    } finally {
      loading = false;
      if (active) {
        load.disabled = false;
        selection.disabled = false;
        render();
      }
    }
  });

  render();
  selection.disabled = false;
  load.disabled = false;
  homebridge.enableSaveButton();
  show('Load robots to choose them by name. Existing selection is preserved until you change it.');
  return { form, flush: () => updates, dispose: () => { active = false; form.end(); } };
}
