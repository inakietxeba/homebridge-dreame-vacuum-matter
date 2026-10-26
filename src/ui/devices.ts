import { z } from 'zod';
import { DreameCloud } from '../dreame/cloud.js';
import { platformConfigSchema } from '../config.js';
import { Logger } from '../util/logger.js';

const credentialsSchema = platformConfigSchema.pick({ username: true, password: true, country: true });
const robotSchema = z.object({ did: z.string().min(1), name: z.string(), model: z.string() });
const quietLogger = new Logger({ info() {}, debug() {}, warn() {}, error() {} } as any, 'RobotPicker');

export async function discoverUiRobots(payload: unknown): Promise<
  { success: true; devices: Array<{ id: string; name: string; model: string }> }
  | { success: false; error: string }
> {
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const parsed = credentialsSchema.safeParse({
    ...input,
    username: process.env['DREAME_EMAIL'] || (input as Record<string, unknown>)['username'],
    password: process.env['DREAME_PASSWORD'] || (input as Record<string, unknown>)['password'],
  });
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
