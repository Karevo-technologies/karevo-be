import { z } from 'zod';

const base64Key = (name: string) =>
  z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: `${name} must be 32 bytes, base64-encoded`,
    });

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: boolish.default('true'),
  DATA_ENCRYPTION_KEY: base64Key('DATA_ENCRYPTION_KEY'),
  BLIND_INDEX_KEY: base64Key('BLIND_INDEX_KEY'),
  NIN_PROVIDER: z.enum(['stub']).default('stub'),
  /** Query the Have I Been Pwned range API for new passwords (D-11). */
  BREACHED_PASSWORD_CHECK: boolish.default('true'),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule; fails startup with every bad key listed. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.NIN_PROVIDER === 'stub') {
    throw new Error('NIN_PROVIDER=stub is not allowed in production');
  }
  return parsed.data;
}
