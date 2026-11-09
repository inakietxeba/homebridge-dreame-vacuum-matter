import { z } from 'zod';
import { DreameCloud } from '../dreame/cloud.js';
import { platformConfigSchema } from '../config.js';
import { Logger } from '../util/logger.js';
import { fetchDreameMapRooms } from '../dreame/maps.js';
import type { MapRooms } from '../dreame/models.js';

const credentialsSchema = platformConfigSchema.pick({ username: true, password: true, country: true });
const robotSchema = z.object({ did: z.string().min(1), name: z.string(), model: z.string() });
const quietLogger = new Logger({ info() {}, debug() {}, warn() {}, error() {} } as any, 'RobotPicker');

function parseCredentials(payload: unknown) {
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return credentialsSchema.safeParse({
    ...input,
    username: process.env['DREAME_EMAIL'] || (input as Record<string, unknown>)['username'],
    password: process.env['DREAME_PASSWORD'] || (input as Record<string, unknown>)['password'],
  });
}

export async function discoverUiMaps(payload: unknown): Promise<
  { success: true; maps: MapRooms[] } | { success: false; error: string }
> {
  const parsed = parseCredentials(payload);
  const deviceId = z.object({ deviceId: z.string().min(1).max(256) }).safeParse(payload);
  if (!parsed.success || !parsed.data.username || !parsed.data.password || !deviceId.success) {
    return { success: false, error: 'Enter your account details and select a robot before loading maps.' };
  }
  let stage = 'signing in';
  try {
    const cloud = new DreameCloud(quietLogger);
    cloud.setCountry(parsed.data.country);
    await cloud.login(parsed.data.username, parsed.data.password);
    // Resolve the device from this account; never trust a model supplied by the browser.
    stage = 'loading the robot list';
    const device = (await cloud.getDevices()).find((candidate) => candidate.did === deviceId.data.deviceId);
    if (!device || !robotSchema.safeParse(device).success || !/^(dreame|mova|trouver)\.vacuum\./.test(device.model)) {
      return { success: false, error: 'This robot was not found in your account. Load the robot list again.' };
    }
    stage = 'initializing the robot connection';
    // Device info configures the host used to route get_properties to this robot.
    await cloud.getDeviceInfo(device.did);
    stage = 'reading map data';
    const maps = await fetchDreameMapRooms(cloud, device, quietLogger);
    return { success: true, maps: maps.map((map) => ({
      mapId: map.mapId, name: map.name,
      rooms: map.rooms.map((room) => ({ id: room.id, name: room.name })),
    })) };
  } catch (error) {
    if (error instanceof Error && error.message === 'Dreame get_properties failed with cloud code 80001') {
      return { success: false, error: 'Dreame Cloud could not reach the robot. Make sure it is powered on, connected to the Internet and available in Dreamehome, then retry. Saved names have not changed.' };
    }
    const hint = stage === 'reading map data' || stage === 'initializing the robot connection'
      ? 'Make sure the robot is powered on, connected to the Internet and available in Dreamehome, then retry.'
      : 'Check your account details, region and Internet connection, then retry.';
    return { success: false, error: `Could not load maps from Dreame while ${stage}. ${hint} Saved names have not changed.` };
  }
}

export async function discoverUiRobots(payload: unknown): Promise<
  { success: true; devices: Array<{ id: string; name: string; model: string }> }
  | { success: false; error: string }
> {
  const parsed = parseCredentials(payload);
  if (!parsed.success || !parsed.data.username || !parsed.data.password) {
    return { success: false, error: 'Enter your Dreame email, password and region below, then load the robots again. Server environment credentials are also supported.' };
  }
  try {
    const cloud = new DreameCloud(quietLogger);
    cloud.setCountry(parsed.data.country);
    await cloud.login(parsed.data.username, parsed.data.password);
    const devices = await cloud.getDevices();
    const robots = new Map<string, { id: string; name: string; model: string }>();
    for (const candidate of devices) {
      const robot = robotSchema.safeParse(candidate);
      if (!robot.success || !/^(dreame|mova|trouver)\.vacuum\./.test(robot.data.model)) continue;
      const { did, name, model } = robot.data;
      robots.set(did, { id: did, name: name.trim() || model, model });
    }
    return { success: true, devices: [...robots.values()] };
  } catch {
    // Cloud exceptions may contain response bodies. Never send those to the UI or log.
    return { success: false, error: 'Could not load robots from Dreame. Check your credentials, account region and connection, then retry. Your selection has not changed.' };
  }
}
