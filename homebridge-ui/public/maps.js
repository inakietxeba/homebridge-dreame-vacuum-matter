export function initMapEditor(homebridge, root, getConfig, setOverrides) {
  const robot = root.getElementById('map-robot');
  const load = root.getElementById('load-maps');
  const status = root.getElementById('map-status');
  const content = root.getElementById('map-editor');
  let generation = 0;
  let active = true;
  let loading = false;

  function invalidate(message) {
    generation++;
    content.replaceChildren();
    status.textContent = message;
  }

  function setDevices(devices) {
    const previous = robot.value;
    robot.replaceChildren();
    for (const device of devices) {
      const option = root.createElement('option');
      option.value = device.id;
      option.textContent = device.name;
      robot.append(option);
    }
    if (devices.some((device) => device.id === previous)) robot.value = previous;
    robot.disabled = devices.length === 0 || loading;
    load.disabled = devices.length === 0 || loading;
    invalidate(devices.length ? 'Choose a robot and load its maps. Saved names are preserved.' : 'Load robots above to choose a robot. Saved names are preserved.');
  }

  function effectiveOverride(deviceId, mapId) {
    const overrides = getConfig().mapOverrides || [];
    return overrides.find((entry) => entry.deviceId === deviceId && entry.mapId === mapId)
      || overrides.find((entry) => entry.deviceId === undefined && entry.mapId === mapId);
  }

  function edit(deviceId, mapId, roomId, value) {
    const version = generation;
    const entries = getConfig().mapOverrides || [];
    const draft = structuredClone(effectiveOverride(deviceId, mapId) || { mapId, rooms: [] });
    draft.deviceId = deviceId;
    draft.rooms ||= [];
    const name = value.trim();
    if (roomId === undefined) {
      if (name) draft.name = name;
      else delete draft.name;
    } else {
      draft.rooms = draft.rooms.filter((room) => room.segmentId !== roomId);
      if (name) draft.rooms.push({ segmentId: roomId, name });
    }
    const next = entries.filter((entry) => !(entry.deviceId === deviceId && entry.mapId === mapId));
    // An empty scoped entry intentionally masks a legacy global override for this robot.
    const hasGlobal = entries.some((entry) => entry.deviceId === undefined && entry.mapId === mapId);
    if (draft.name || draft.rooms.length || hasGlobal) next.push(draft);
    void setOverrides(next).then(() => {
      if (active && version === generation) status.textContent = 'Names updated. Save and restart Homebridge to apply.';
    }).catch(() => {
      if (active && version === generation) status.textContent = 'Could not update names. Close and reopen settings before saving.';
    });
  }

  function field(parent, labelText, original, value, onChange, id) {
    const wrapper = root.createElement('div');
    wrapper.className = 'mb-3';
    const label = root.createElement('label');
    label.className = 'form-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const input = root.createElement('input');
    input.id = id;
    input.type = 'text';
    input.className = 'form-control';
    input.maxLength = 256;
    input.placeholder = original;
    input.value = value || '';
    const hint = root.createElement('small');
    hint.className = 'dreame-secondary dreame-device-detail';
    hint.textContent = `Robot name: ${original}. Leave blank to use it.`;
    input.addEventListener('input', () => onChange(input.value));
    wrapper.append(label, input, hint);
    parent.append(wrapper);
  }

  function render(maps, deviceId) {
    content.replaceChildren();
    for (const [index, map] of maps.entries()) {
      const group = root.createElement('fieldset');
      group.className = 'dreame-map mb-3';
      const legend = root.createElement('legend');
      legend.className = 'h6';
      const name = map.name || `Map ${map.mapId}`;
      legend.textContent = name;
      group.append(legend);
      const saved = effectiveOverride(deviceId, map.mapId);
      field(group, 'Map name in Apple Home', name, saved?.name,
        (value) => edit(deviceId, map.mapId, undefined, value), `map-name-${index}`);
      for (const [roomIndex, room] of map.rooms.entries()) {
        field(group, `${room.name} - name in Apple Home`, room.name,
          saved?.rooms?.find((entry) => entry.segmentId === room.id)?.name,
          (value) => edit(deviceId, map.mapId, room.id, value), `map-${index}-room-${roomIndex}`);
      }
      content.append(group);
    }
  }

  robot.addEventListener('change', () => invalidate('Load maps for this robot. Saved names are preserved.'));
  load.addEventListener('click', async () => {
    if (loading || !robot.value) return;
    loading = true;
    robot.disabled = true;
    load.disabled = true;
    invalidate('Loading maps and rooms from Dreame...');
    const version = generation;
    const deviceId = robot.value;
    const { username, password, country = 'eu' } = getConfig();
    try {
      const result = await homebridge.request('/maps', { username, password, country, deviceId });
      if (!active || version !== generation) return;
      if (!result.success) {
        status.textContent = result.error || 'Could not load maps. Saved names have not changed.';
        return;
      }
      render(result.maps, deviceId);
      status.textContent = result.maps.length ? 'Only edit names you want to change in Apple Home. Dreamehome names are not modified.' : 'No maps returned. Saved names have not changed.';
    } catch {
      if (active && version === generation) status.textContent = 'Could not load maps. Saved names have not changed.';
    } finally {
      loading = false;
      if (active) {
        robot.disabled = robot.options.length === 0;
        load.disabled = robot.options.length === 0;
      }
    }
  });
  return { setDevices, dispose() { active = false; generation++; } };
}
