import * as zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import { applyMapOverrides, parseDreameMapList } from '../src/dreame/maps';

describe('Dreame map parsing', () => {
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
