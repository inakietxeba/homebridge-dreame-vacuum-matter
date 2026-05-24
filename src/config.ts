import { PlatformConfig } from 'homebridge';
import { z } from 'zod';

export const roomSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
});

export const platformConfigSchema = z.object({
  name: z.string().max(256).optional(),
  platform: z.string().max(256).optional(),
  username: z.string().max(256).optional(),
  password: z.string().max(256).optional(),
  country: z.enum(['cn', 'eu', 'us', 'sg', 'kr', 'ru']).optional().default('eu'),
  defaultMode: z.enum(['SWEEP', 'MOP', 'SWEEP_AND_MOP']).optional().default('SWEEP_AND_MOP'),
  defaultSuction: z.number().int().min(0).max(3).optional().default(1),
  defaultWaterLevel: z.number().int().min(1).max(3).optional().default(2),
  disableMatterStatePush: z.boolean().optional().default(false),
  rooms: z.array(roomSchema).max(100).optional().default([]),
});

export type RoomConfig = z.infer<typeof roomSchema>;
export type DreamePlatformConfig = PlatformConfig & z.infer<typeof platformConfigSchema>;

export type CleaningMode = 'SWEEP' | 'MOP' | 'SWEEP_AND_MOP';

export function parsePlatformConfig(config: PlatformConfig): DreamePlatformConfig {
  const overrides = { ...config };
  if (process.env['DREAME_USERNAME']) {
    overrides.username = process.env['DREAME_USERNAME'];
  }
  if (process.env['DREAME_PASSWORD']) {
    overrides.password = process.env['DREAME_PASSWORD'];
  }
  return platformConfigSchema.parse(overrides) as DreamePlatformConfig;
}
