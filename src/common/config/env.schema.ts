import { z } from 'zod';

const integerString = z.string().regex(/^\d+$/, 'Must be a number');
const isTest = process.env.NODE_ENV === 'test';
const requiredChainSecret = (fallback: string) =>
  isTest ? z.string().default(fallback) : z.string().min(1);
const requiredStorageSetting = (fallback: string) =>
  isTest ? z.string().default(fallback) : z.string().min(1);

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: integerString.default('4000'),
    THROTTLE_TTL_SECONDS: integerString.default('60'),
    THROTTLE_LIMIT: integerString.default('120'),
    RECONCILIATION_ENABLED: z.enum(['true', 'false']).default('true'),
    RECONCILIATION_INTERVAL_SECONDS: integerString.default('300'),
    RECONCILIATION_INITIAL_DELAY_SECONDS: integerString.default('20'),
    DATABASE_URL: z.url(),
    FRONTEND_ORIGIN: z
      .string()
      .default('http://localhost:3000,http://localhost:3001'),
    FRONTEND_APP_URL: z.string().default('http://localhost:3000'),
    APP_NAME: z.string().default('Lesenpad'),
    EMAIL_BRAND_LOGO_URL: z.string().optional(),
    EMAIL_BRAND_LOGO_URL_INVERTED: z.string().optional(),
    BACKEND_PUBLIC_URL: z.string().optional(),
    MEDIA_STORAGE_PROVIDER: z.enum(['r2']).default('r2'),
    R2_BUCKET: requiredStorageSetting('test-bucket'),
    R2_PUBLIC_BASE_URL: requiredStorageSetting('https://cdn.example.com'),
    R2_ACCESS_KEY_ID: requiredStorageSetting('test-access-key'),
    R2_SECRET_ACCESS_KEY: requiredStorageSetting('test-secret-key'),
    R2_ENDPOINT: requiredStorageSetting(
      'https://example.r2.cloudflarestorage.com',
    ),
    SESSION_COOKIE_NAME: z.string().default('lesenpad_session'),
    SESSION_TTL_DAYS: integerString.default('14'),
    CHAIN_MASTER_KEY: requiredChainSecret('test-chain-master-key'),
    WALLET_PROVIDER: z.enum(['solana', 'circle']).default('solana'),
    SOLANA_NETWORK: z.string().default('devnet'),
    SOLANA_RPC_URL: z.string().default('https://api.devnet.solana.com'),
    SOLANA_USDC_MINT_ADDRESS: requiredChainSecret(
      'So11111111111111111111111111111111111111112',
    ),
    SOLANA_TREASURY_SECRET_KEY: requiredChainSecret('test-secret-key'),
    SOLANA_CONFIRMATION_COMMITMENT: z
      .enum(['processed', 'confirmed', 'finalized'])
      .default('confirmed'),
    PINATA_JWT: requiredChainSecret('test-pinata-jwt'),
    IPFS_GATEWAY_BASE: z.string().optional(),
    COINGECKO_API_BASE: z.string().default('https://api.coingecko.com/api/v3'),
    SOL_USD_FALLBACK: z.string().optional(),
    RISK_DAILY_PURCHASE_LIMIT_USDC_MINOR: integerString.default('200000000'),
    RISK_DAILY_WITHDRAWAL_LIMIT_USDC_MINOR: integerString.default('500000000'),
    RISK_PER_MINUTE_REQUEST_LIMIT: integerString.default('20'),
    RISK_BLOCKED_WALLET_ADDRESSES: z.string().default(''),
    EMAILS_ENABLED: z.enum(['true', 'false']).default('false'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().default('Lesenpad <onboarding@resend.dev>'),
    RESEND_REPLY_TO: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.EMAILS_ENABLED === 'true' && !config.RESEND_API_KEY?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAILS_ENABLED=true.',
      });
    }
  });

export type EnvSchema = z.infer<typeof envSchema>;
