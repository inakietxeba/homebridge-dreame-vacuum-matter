import { PlatformConfig } from 'homebridge';
import { z } from 'zod';

export const platformConfigSchema = z.object({
  name: z.string().max(256).optional(),
  platform: z.string().max(256).optional(),
  username: z.string().max(256).optional(),
  password: z.string().max(256).optional(),
  country: z.enum(['cn', 'eu', 'us', 'sg', 'kr', 'ru']).optional().default('eu'),
});

export type DreamePlatformConfig = PlatformConfig & z.infer<typeof platformConfigSchema>;

export type CleaningMode = 'SWEEP' | 'MOP' | 'SWEEP_AND_MOP';

export function parsePlatformConfig(config: PlatformConfig): DreamePlatformConfig {
  const overrides = { ...config };
  if (process.env['DREAME_EMAIL']) {
    overrides.username = process.env['DREAME_EMAIL'];
  }
  if (process.env['DREAME_PASSWORD']) {
    overrides.password = process.env['DREAME_PASSWORD'];
  }
  return platformConfigSchema.parse(overrides) as DreamePlatformConfig;
}
