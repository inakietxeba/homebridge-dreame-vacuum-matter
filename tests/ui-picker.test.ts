import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initRobotPicker } from '../homebridge-ui/public/picker.js';

const html = readFileSync(new URL('../homebridge-ui/public/index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
const robots = [
  { id: 'a', name: 'Robot A', model: 'dreame.vacuum.r2469x' },
  { id: 'b', name: 'D20', model: 'dreame.vacuum.r2563b' },
];
const open: JSDOM[] = [];
afterEach(() => { for (const dom of open.splice(0)) dom.window.close(); });

async function fixture(config: Record<string, unknown> = {}, devices = robots) {
  const dom = new JSDOM(html);
  open.push(dom);
  const doc = dom.window.document;
  let changeForm: (data: Record<string, unknown>) => void = () => {};
  const existing = { platform: 'DreameVacuumMatter', username: 'fake', password: 'fake', country: 'eu', mapOverrides: [{ mapId: 10, name: 'Upstairs' }], _bridge: { username: 'bridge-id' }, ...config };
  const otherBlock = { platform: 'DreameVacuumMatter', name: 'Preserved block' };
  const homebridge = {
    getPluginConfig: vi.fn(async () => [existing, otherBlock]),
    getPluginConfigSchema: vi.fn(async () => structuredClone(schema)),
    createForm: vi.fn(() => ({ onChange: (cb: typeof changeForm) => { changeForm = cb; }, end: vi.fn() })),
    updatePluginConfig: vi.fn(async () => undefined),
    savePluginConfig: vi.fn(),
    disableSaveButton: vi.fn(), enableSaveButton: vi.fn(),
    request: vi.fn(async () => ({ success: true, devices })),
  };
  const picker = await initRobotPicker(homebridge, doc);
  const checkboxes = () => [...doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  const status = () => doc.getElementById('robot-status')!.textContent;
  const load = async () => {
    (doc.getElementById('load-robots') as HTMLButtonElement).click();
    await vi.waitFor(() => expect((doc.getElementById('load-robots') as HTMLButtonElement).disabled).toBe(false));
  };
  const select = async (mode: string) => {
    (doc.getElementById('robot-selection') as HTMLSelectElement).value = mode;
    doc.getElementById('robot-selection')!.dispatchEvent(new dom.window.Event('change'));
    await picker.flush();
  };
  return { dom, doc, homebridge, picker, existing, otherBlock, checkboxes, status, load, select, changeForm: (data: Record<string, unknown>) => changeForm(data) };
}

describe('Robot name selector', () => {
  it('renders account names, saves stable IDs and preserves unrelated settings/blocks', async () => {
    const f = await fixture();
    await f.load();
    expect(f.doc.querySelector('label[for=dreame-robot-0] strong')!.textContent).toBe('Robot A');
    expect(f.doc.querySelector('label[for=dreame-robot-1] strong')!.textContent).toBe('D20');
    expect(f.checkboxes().map((input) => input.checked)).toEqual([true, true]);
    f.checkboxes()[1].click();
    await f.picker.flush();
    expect(f.homebridge.updatePluginConfig).toHaveBeenLastCalledWith([
      { name: 'Dreame Vacuum', ...f.existing, deviceSelection: 'selected', deviceIds: ['a'] }, f.otherBlock,
    ]);
    expect(f.homebridge.savePluginConfig).not.toHaveBeenCalled();
    const properties = f.homebridge.createForm.mock.calls[0][0].schema.properties;
    expect(properties.deviceIds).toBeUndefined();
    expect(properties.deviceSelection).toBeUndefined();
    expect(properties.username).toBeDefined();
    expect(properties.mapOverrides).toBeDefined();
  });

  it('restores saved selection by ID even when names change', async () => {
    const f = await fixture({ deviceSelection: 'selected', deviceIds: ['b'] }, [robots[0], { ...robots[1], name: 'Renamed robot' }]);
    await f.load();
    expect(f.checkboxes().map((input) => input.checked)).toEqual([false, true]);
    expect(f.doc.querySelector('label[for=dreame-robot-1] strong')!.textContent).toBe('Renamed robot');
    expect(f.homebridge.updatePluginConfig).not.toHaveBeenCalled();
  });

  it('supports all, none, both explicitly selected, and no checked robots', async () => {
    const f = await fixture();
    await f.load();
    await f.select('none');
    expect(f.checkboxes().map((input) => input.checked)).toEqual([false, false]);
    f.checkboxes()[0].click();
    await f.picker.flush();
    f.checkboxes()[1].click();
    await f.picker.flush();
    expect(f.homebridge.updatePluginConfig.mock.calls.at(-1)![0][0]).toMatchObject({ deviceSelection: 'selected', deviceIds: ['a', 'b'] });
    await f.select('all');
    expect(f.checkboxes().every((input) => input.checked)).toBe(true);
    f.checkboxes()[0].click();
    f.checkboxes()[1].click();
    await f.picker.flush();
    expect(f.homebridge.updatePluginConfig.mock.calls.at(-1)![0][0]).toMatchObject({ deviceSelection: 'selected', deviceIds: [] });
  });

  it('preserves selection on cloud failures or empty responses', async () => {
    const f = await fixture({ deviceSelection: 'selected', deviceIds: ['a'] });
    f.homebridge.request.mockRejectedValueOnce(new Error('private backend detail'));
    await f.load();
    expect(f.status()).toContain('selection has not changed');
    expect(f.status()).not.toContain('private');
    f.homebridge.request.mockResolvedValueOnce({ success: true, devices: [] });
    await f.load();
    expect(f.homebridge.updatePluginConfig).not.toHaveBeenCalled();
    expect(f.checkboxes()).toHaveLength(1);
    expect(f.checkboxes()[0].checked).toBe(true);
  });

  it('preserves absent selected IDs when changing another checkbox', async () => {
    const f = await fixture({ deviceSelection: 'selected', deviceIds: ['missing', 'a'] });
    await f.load();
    f.checkboxes()[1].click();
    await f.picker.flush();
    expect(f.homebridge.updatePluginConfig.mock.calls.at(-1)![0][0].deviceIds).toEqual(['missing', 'a', 'b']);
  });

  it('renders untrusted robot names as text, not HTML', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const f = await fixture({}, [{ ...robots[0], name }]);
    await f.load();
    expect(f.doc.querySelector('label strong')!.textContent).toBe(name);
    expect(f.doc.querySelector('img')).toBeNull();
  });

  it('retains keyboard focus when a checkbox updates the list', async () => {
    const f = await fixture();
    await f.load();
    f.checkboxes()[1].focus();
    f.checkboxes()[1].click();
    await f.picker.flush();
    expect(f.doc.activeElement!.id).toBe('dreame-robot-1');
  });

  it('prevents saving when a configuration update fails', async () => {
    const f = await fixture();
    await f.load();
    f.homebridge.enableSaveButton.mockClear();
    f.homebridge.updatePluginConfig.mockRejectedValueOnce(new Error('update failed'));
    f.checkboxes()[0].click();
    await expect(f.picker.flush()).rejects.toThrow('update failed');
    await vi.waitFor(() => expect(f.status()).toContain('Could not update settings'));
    expect(f.homebridge.disableSaveButton).toHaveBeenCalled();
    expect(f.homebridge.enableSaveButton).not.toHaveBeenCalled();
  });

  it('uses newly edited account details and preserves selection when the schema form changes', async () => {
    const f = await fixture({ deviceSelection: 'selected', deviceIds: ['b'] });
    f.changeForm({ username: 'new@example.com', country: 'us', automationDockSwitch: true, deviceIds: [] });
    await f.picker.flush();
    await f.load();
    expect(f.homebridge.request).toHaveBeenCalledWith('/robots', { username: 'new@example.com', password: 'fake', country: 'us' });
    expect(f.homebridge.updatePluginConfig.mock.calls.at(-1)![0][0]).toMatchObject({ deviceSelection: 'selected', deviceIds: ['b'], automationDockSwitch: true });
  });

  it('ignores a stale device list when account details change during loading', async () => {
    const f = await fixture();
    let resolve!: (response: unknown) => void;
    f.homebridge.request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }) as any);
    (f.doc.getElementById('load-robots') as HTMLButtonElement).click();
    expect((f.doc.getElementById('load-robots') as HTMLButtonElement).disabled).toBe(true);
    f.changeForm({ username: 'other@example.com' });
    resolve({ success: true, devices: robots });
    await vi.waitFor(() => expect((f.doc.getElementById('load-robots') as HTMLButtonElement).disabled).toBe(false));
    expect(f.doc.getElementById('robot-list')!.hidden).toBe(true);
    expect(f.status()).toContain('Account details changed');
  });
});
