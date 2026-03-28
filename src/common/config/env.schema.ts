import { z } from 'zod';

const integerString = z.string().regex(/^\d+$/, 'Must be a number');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: integerString.default('4000'),
  DATABASE_URL: z.url(),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  FRONTEND_APP_URL: z.string().default('http://localhost:3000'),
  BACKEND_PUBLIC_URL: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().default('talea_session'),
  SESSION_TTL_DAYS: integerString.default('14'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
});

export type EnvSchema = z.infer<typeof envSchema>;
