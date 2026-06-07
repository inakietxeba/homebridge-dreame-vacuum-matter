import * as zlib from 'zlib';
import { DreameCloud, DreameDevice } from './cloud.js';
import { MapRooms, MIOT, RoomInfo } from './models.js';
import { Logger } from '../util/logger.js';

export interface MapOverride {
  mapId: number;
  deviceId?: string;
  name?: string;
  rooms: Array<{
    segmentId: string;
    name: string;
  }>;
}

const SEGMENT_TYPE_CODE_TO_NAME: Record<number, string> = {
  0: 'Room',
  1: 'Living Room',
  2: 'Primary Bedroom',
  3: 'Study',
  4: 'Kitchen',
  5: 'Dining Hall',
  6: 'Bathroom',
  7: 'Balcony',
  8: 'Corridor',
  9: 'Utility Room',
  10: 'Closet',
  11: 'Meeting Room',
  12: 'Office',
  13: 'Fitness Area',
  14: 'Recreation Area',
  15: 'Secondary Bedroom',
};

interface DecodedSegment {
  id: number;
  name: string;
  visible: boolean;
  pixels: number;
}

interface DecodedMap {
  mapId: number;
  rooms: RoomInfo[];
}

export async function fetchDreameMapRooms(
  cloud: DreameCloud,
  device: Pick<DreameDevice, 'did' | 'model' | 'name'>,
  log: Logger,
): Promise<MapRooms[]> {
  const props = await cloud.getProperties(device.did, [
    { did: device.did, siid: MIOT.MAP.siid, piid: MIOT.MAP.MAP_LIST },
  ]);
  const mapList = props.find((prop) => prop.siid === MIOT.MAP.siid && prop.piid === MIOT.MAP.MAP_LIST);
  const objectName = extractObjectName(mapList?.value);
  if (!objectName) {
    log.debug(`No Dreame MAP_LIST object found for ${device.name || device.did}`);
    return [];
  }

  const url = await cloud.getFileDownloadUrl({
    deviceId: device.did,
    model: device.model,
    objectName,
  });
  if (!url) {
    log.warn(`Dreame MAP_LIST download URL was empty for ${device.name || device.did}`);
    return [];
  }

  const mapListText = await cloud.downloadText(url);
  return parseDreameMapList(mapListText);
}

export function parseDreameMapList(text: string): MapRooms[] {
  const json = JSON.parse(text) as Record<string, unknown>;
  const mapEntries = pickArray(json['mapstr'], json['mapStr'], json['maps']);
  if (!mapEntries) return [];

  return mapEntries
    .map((entry, index) => parseMapEntry(entry, index))
    .filter((map): map is MapRooms => map !== null);
}

export function applyMapOverrides(
  maps: MapRooms[],
  overrides: MapOverride[],
  deviceId: string,
): MapRooms[] {
  if (overrides.length === 0) return maps;

  return maps.map((map) => {
    const mapOverride = overrides
      .filter((candidate) =>
        candidate.mapId === map.mapId
        && (candidate.deviceId === undefined || candidate.deviceId === deviceId),
      )
      .sort((a, b) => Number(b.deviceId !== undefined) - Number(a.deviceId !== undefined))[0];

    if (!mapOverride) return map;

    return {
      ...map,
      name: mapOverride.name ?? map.name,
      rooms: map.rooms.map((room) => {
        const roomOverride = mapOverride.rooms.find((candidate) => candidate.segmentId === room.id);
        return roomOverride ? { ...room, name: roomOverride.name } : room;
      }),
    };
  });
}

function parseMapEntry(entry: unknown, index: number): MapRooms | null {
  if (!entry || typeof entry !== 'object') return null;
  const data = entry as Record<string, unknown>;
  const inlineMap = data['map'];
  if (typeof inlineMap !== 'string' || inlineMap.length === 0) return null;

  const decoded = decodeMapPayload(inlineMap);
  const entryMapId = firstNumber(data['mapid'], data['map_id'], data['id']);
  const mapId = decoded.mapId || entryMapId || index + 1;
  const name = firstString(data['name'], data['map_name']);

  return {
    mapId,
    name: name ?? undefined,
    rooms: decoded.rooms,
  };
}

function decodeMapPayload(rawMap: string): DecodedMap {
  const normalized = rawMap.replaceAll('_', '/').replaceAll('-', '+');
  const decoded = Buffer.from(normalized, 'base64');
  const inflated = zlib.inflateSync(decoded);
  const mapId = readInt16Le(inflated, 0);
  const width = readInt16Le(inflated, 19);
  const height = readInt16Le(inflated, 21);
  const imageSize = 27 + width * height;
  const pixels = inflated.subarray(27, imageSize);
  const dataJsonText = inflated.length > imageSize ? inflated.subarray(imageSize).toString('utf8') : '{}';
  const dataJson = dataJsonText ? JSON.parse(dataJsonText) as Record<string, unknown> : {};
  const segments = decodeSegments(dataJson, pixels);

  return {
    mapId,
    rooms: segments.map((segment) => ({ id: String(segment.id), name: segment.name })),
  };
}

function decodeSegments(dataJson: Record<string, unknown>, pixels: Buffer): DecodedSegment[] {
  const segmentInfo = toRecord(dataJson['seg_inf']);
  const deletedSegments = arrayOfNumbers(dataJson['delsr']);
  const pixelCounts = new Map<number, number>();

  for (const pixel of pixels) {
    if (pixel <= 0) continue;
    const segmentId = pixel & 0x3f;
    if (segmentId > 0) {
      pixelCounts.set(segmentId, (pixelCounts.get(segmentId) ?? 0) + 1);
    }
  }

  return [...pixelCounts.entries()]
    .map(([id, pixelCount]) => {
      const info = toRecord(segmentInfo[String(id)]);
      const name = decodeSegmentName(info, id);
      return {
        id,
        name,
        visible: !deletedSegments.includes(id),
        pixels: pixelCount,
      };
    })
    .filter((segment) => segment.visible)
    .sort((a, b) => a.id - b.id);
}

function decodeSegmentName(info: Record<string, unknown>, id: number): string {
  const encodedName = firstString(info['name'], info['custom_name']);
  const customName = encodedName ? decodeMaybeBase64(encodedName).trim() : '';
  if (customName.length > 0) return customName;

  const type = firstNumber(info['type']);
  const typeName = type === undefined ? undefined : SEGMENT_TYPE_CODE_TO_NAME[type];
  const index = firstNumber(info['index']);
  if (typeName && index !== undefined && index > 0) {
    return `${typeName} ${index + 1}`;
  }
  return typeName ?? `Room ${id}`;
}

function extractObjectName(value: unknown): string | undefined {
  const parsed = typeof value === 'string' ? parseJsonIfPossible(value) : value;
  if (typeof parsed === 'string') return parsed;
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  return firstString(record['object_name'], record['obj_name']);
}

function parseJsonIfPossible(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function decodeMaybeBase64(value: string): string {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded.includes('\uFFFD') ? value : decoded;
  } catch {
    return value;
  }
}

function pickArray(...values: unknown[]): unknown[] | undefined {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayOfNumbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length > 0) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readInt16Le(bytes: Buffer, offset: number): number {
  return bytes.readInt16LE(offset);
}
