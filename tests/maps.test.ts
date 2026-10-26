import * as zlib from 'zlib';
import { describe, expect, it, vi } from 'vitest';
import { applyMapOverrides, fetchDreameMapState, parseDreameMapList, parseDreameMapState } from '../src/dreame/maps';

describe('Dreame map parsing', () => {
  it('fetches the current map from the downloaded MAP_LIST metadata', async () => {
    const cloud = {
      getProperties: vi.fn(async () => [{ siid: 6, piid: 8, code: 0, value: JSON.stringify({ object_name: 'test-map-list' }) }]),
      getFileDownloadUrl: vi.fn(async () => 'https://example.invalid/maps'),
      downloadText: vi.fn(async () => JSON.stringify({ curr_id: 20, mapstr: [
        { id: 10, map: buildInlineMap() }, { id: 20, map: buildInlineMap() },
      ] })),
    };
    const result = await fetchDreameMapState(cloud as any, { did: 'fake', model: 'test', name: 'Robot' }, { debug: vi.fn(), warn: vi.fn() } as any);
    expect(result.currentMapId).toBe(20);
    expect(result.maps.map((map) => map.mapId)).toEqual([10, 20]);
    expect(cloud.getProperties).toHaveBeenCalledWith('fake', [{ did: 'fake', siid: 6, piid: 8 }]);
  });

  it('reads the selected saved-map ID instead of choosing the first inline frame', () => {
    const state = parseDreameMapState(JSON.stringify({ curr_id: '20', mapstr: [
      { id: 10, name: 'Downstairs', map: buildInlineMap() },
      { id: 20, name: 'Upstairs', map: buildInlineMap() },
    ] }));
    expect(state.maps.map((map) => map.mapId)).toEqual([10, 20]);
    expect(state.currentMapId).toBe(20);
  });

  it.each([undefined, 999, '20junk'])('does not invent an active map when curr_id is %s', (id) => {
    const state = parseDreameMapState(JSON.stringify({ curr_id: id, mapstr: [
      { id: 10, map: buildInlineMap() }, { id: 20, map: buildInlineMap() },
    ] }));
    expect(state.currentMapId).toBeUndefined();
  });

  it('parses saved map room segments from Dreame MAP_LIST JSON', () => {
    const fixture = JSON.stringify({
      mapstr: [
        {
          name: 'Test map',
          map: buildInlineMap(),
        },
      ],
    });
    const maps = parseDreameMapList(fixture);

    expect(maps).toHaveLength(1);
    expect(maps[0]?.name).toBe('Test map');
    expect(maps[0]?.mapId).toBe(10);
    expect(maps[0]?.rooms).toEqual([
      { id: '1', name: 'Kitchen' },
      { id: '2', name: 'Living Room' },
      { id: '3', name: 'Bathroom' },
      { id: '4', name: 'Bathroom 2' },
    ]);
  });

  it('applies map and room name overrides with optional device scope', () => {
    const maps = [{
      mapId: 10,
      name: 'Upstairs',
      rooms: [
        { id: '1', name: 'Kitchen' },
        { id: '2', name: 'Living Room' },
      ],
    }];

    expect(applyMapOverrides(maps, [
      {
        mapId: 10,
        name: 'Planta general',
        rooms: [{ segmentId: '1', name: 'Cocina' }],
      },
      {
        mapId: 10,
        deviceId: 'robot-1',
        name: 'Ático',
        rooms: [
          { segmentId: '1', name: 'Cocina del ático' },
          { segmentId: '2', name: 'Salón' },
        ],
      },
    ], 'robot-1')).toEqual([{
      mapId: 10,
      name: 'Ático',
      rooms: [
        { id: '1', name: 'Cocina del ático' },
        { id: '2', name: 'Salón' },
      ],
    }]);
  });
});

function buildInlineMap(): string {
  const width = 2;
  const height = 2;
  const header = Buffer.alloc(27);
  header.writeInt16LE(10, 0);
  header.writeInt16LE(50, 17);
  header.writeInt16LE(width, 19);
  header.writeInt16LE(height, 21);

  const pixels = Buffer.from([1, 2, 3, 4]);
  const data = Buffer.from(JSON.stringify({
    seg_inf: {
      1: { type: 4, index: 0 },
      2: { type: 1, index: 0 },
      3: { type: 6, index: 0 },
      4: { type: 6, index: 1 },
    },
  }));

  return zlib.deflateSync(Buffer.concat([header, pixels, data])).toString('base64');
}
