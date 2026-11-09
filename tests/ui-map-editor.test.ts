import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initMapEditor } from '../homebridge-ui/public/maps.js';

const html = readFileSync(new URL('../homebridge-ui/public/index.html', import.meta.url), 'utf8');
const open: JSDOM[] = [];
afterEach(() => { for (const dom of open.splice(0)) dom.window.close(); });
const discovered = [{ mapId: 10, name: 'Ground floor', rooms: [{ id: '1', name: 'Kitchen' }, { id: '2', name: 'Living room' }] }];

function fixture(overrides: any[] = []) {
  const dom = new JSDOM(html);
  open.push(dom);
  const doc = dom.window.document;
  let config = { username: 'test@example.com', password: 'fake', country: 'eu', mapOverrides: overrides };
  const homebridge = { request: vi.fn(async () => ({ success: true, maps: discovered })) };
  const set = vi.fn(async (mapOverrides) => { config = { ...config, mapOverrides }; });
  const editor = initMapEditor(homebridge, doc, () => config, set);
  const robot = doc.getElementById('map-robot') as HTMLSelectElement;
  const button = doc.getElementById('load-maps') as HTMLButtonElement;
  const status = () => doc.getElementById('map-status')!.textContent;
  editor.setDevices([{ id: 'a', name: 'Robot A' }, { id: 'b', name: 'Robot B' }]);
  const load = async () => {
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  };
  const edit = async (id: string, value: string) => {
    const input = doc.getElementById(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input'));
    await Promise.resolve();
  };
  const select = (id: string) => { robot.value = id; robot.dispatchEvent(new dom.window.Event('change')); };
  return { dom, doc, editor, homebridge, set, config: () => config, load, edit, select, button, status };
}

describe('Map name editor', () => {
  it('loads original names and saved custom names without writing configuration', async () => {
    const f = fixture([{ deviceId: 'a', mapId: 10, name: 'Home', rooms: [{ segmentId: '1', name: 'Cooking' }] }]);
    await f.load();
    expect(f.homebridge.request).toHaveBeenCalledWith('/maps', { username: 'test@example.com', password: 'fake', country: 'eu', deviceId: 'a' });
    expect((f.doc.getElementById('map-name-0') as HTMLInputElement).value).toBe('Home');
    expect((f.doc.getElementById('map-0-room-0') as HTMLInputElement).value).toBe('Cooking');
    expect((f.doc.getElementById('map-0-room-1') as HTMLInputElement).placeholder).toBe('Living room');
    expect(f.set).not.toHaveBeenCalled();
  });

  it('scopes edits to robot and map, preserving missing maps/rooms and other robots', async () => {
    const other = { deviceId: 'b', mapId: 10, name: 'Other', rooms: [{ segmentId: '1', name: 'Other kitchen' }] };
    const missing = { deviceId: 'a', mapId: 20, name: 'Upstairs', rooms: [] };
    const f = fixture([other, missing, { deviceId: 'a', mapId: 10, rooms: [{ segmentId: '99', name: 'Unavailable room' }] }]);
    await f.load();
    await f.edit('map-0-room-0', 'New kitchen');
    expect(f.config().mapOverrides).toEqual([other, missing, { deviceId: 'a', mapId: 10, rooms: [
      { segmentId: '99', name: 'Unavailable room' }, { segmentId: '1', name: 'New kitchen' },
    ] }]);
    await f.edit('map-name-0', 'My floor');
    expect(f.config().mapOverrides.at(-1)).toMatchObject({ name: 'My floor', rooms: expect.arrayContaining([{ segmentId: '1', name: 'New kitchen' }]) });
  });

  it('removes cleared custom names and empty overrides', async () => {
    const f = fixture([{ deviceId: 'a', mapId: 10, name: 'Custom floor', rooms: [{ segmentId: '1', name: 'Custom room' }] }]);
    await f.load();
    await f.edit('map-name-0', '  ');
    expect(f.config().mapOverrides[0].name).toBeUndefined();
    await f.edit('map-0-room-0', '');
    expect(f.config().mapOverrides).toEqual([]);
  });

  it('keeps identical room IDs on separate floors independent', async () => {
    const f = fixture();
    f.homebridge.request.mockResolvedValueOnce({ success: true, maps: [
      ...discovered, { mapId: 20, name: 'Upper floor', rooms: [{ id: '1', name: 'Bedroom' }] },
    ] });
    await f.load();
    await f.edit('map-0-room-0', 'Lower kitchen');
    await f.edit('map-1-room-0', 'Upper bedroom');
    expect(f.config().mapOverrides).toEqual([
      { deviceId: 'a', mapId: 10, rooms: [{ segmentId: '1', name: 'Lower kitchen' }] },
      { deviceId: 'a', mapId: 20, rooms: [{ segmentId: '1', name: 'Upper bedroom' }] },
    ]);
  });

  it('preserves legacy global overrides and masks them when restoring a robot original name', async () => {
    const global = { mapId: 10, name: 'Shared floor', rooms: [{ segmentId: '1', name: 'Shared kitchen' }] };
    const f = fixture([global]);
    await f.load();
    await f.edit('map-0-room-0', '');
    expect(f.config().mapOverrides).toEqual([global, { deviceId: 'a', mapId: 10, name: 'Shared floor', rooms: [] }]);
    await f.edit('map-name-0', '');
    expect(f.config().mapOverrides).toEqual([global, { deviceId: 'a', mapId: 10, rooms: [] }]);
  });

  it.each(['error', 'empty', 'throw'])('preserves configuration when discovery returns %s', async (kind) => {
    const original = [{ deviceId: 'a', mapId: 10, name: 'Saved', rooms: [] }];
    const f = fixture(original);
    if (kind === 'throw') f.homebridge.request.mockRejectedValueOnce(new Error('private'));
    else f.homebridge.request.mockResolvedValueOnce(kind === 'empty' ? { success: true, maps: [] } : { success: false } as any);
    await f.load();
    expect(f.config().mapOverrides).toEqual(original);
    expect(f.set).not.toHaveBeenCalled();
    expect(f.doc.querySelector('#map-editor input')).toBeNull();
  });

  it('clears visible fields when changing robots and ignores stale account responses', async () => {
    const f = fixture();
    await f.load();
    f.select('b');
    expect(f.doc.querySelector('#map-editor input')).toBeNull();
    let resolve!: (value: any) => void;
    f.homebridge.request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    f.button.click();
    f.editor.setDevices([]);
    resolve({ success: true, maps: discovered });
    await vi.waitFor(() => expect(f.status()).toContain('Load robots above'));
    expect(f.doc.querySelector('#map-editor input')).toBeNull();
    expect(f.set).not.toHaveBeenCalled();
  });

  it('renders map/room names as text and reports failed configuration updates', async () => {
    const f = fixture();
    f.homebridge.request.mockResolvedValueOnce({ success: true, maps: [{ mapId: 1, name: '<img src=x>', rooms: [{ id: '1', name: '<script>bad</script>' }] }] });
    await f.load();
    expect(f.doc.querySelector('img')).toBeNull();
    expect(f.doc.querySelector('#map-editor legend')!.textContent).toBe('<img src=x>');
    f.set.mockRejectedValueOnce(new Error('failed'));
    await f.edit('map-name-0', 'New');
    await vi.waitFor(() => expect(f.status()).toContain('Could not update names'));
  });
});
