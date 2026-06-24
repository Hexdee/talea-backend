import { z } from 'zod';
import {
  DEFAULT_DEVNET_SOLANA_RPC_URL,
  DEVNET_USDC_MINT_ADDRESS,
  MAINNET_USDC_MINT_ADDRESS,
} from './solana.constants';

const integerString = z.string().regex(/^\d+$/, 'Must be a number');
const isTest = process.env.NODE_ENV === 'test';
const requiredChainSecret = (fallback: string) =>
  isTest ? z.string().default(fallback) : z.string().min(1);
const requiredStorageSetting = (fallback: string) =>
  isTest ? z.string().default(fallback) : z.string().min(1);
const mainnetLabels = new Set(['mainnet', 'mainnet-beta']);

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
    SOLANA_RPC_URL: z.string().default(DEFAULT_DEVNET_SOLANA_RPC_URL),
    SOLANA_USDC_MINT_ADDRESS: requiredChainSecret(DEVNET_USDC_MINT_ADDRESS),
    SOLANA_TREASURY_SECRET_SOURCE: z
      .enum(['env', 'file', 'vault'])
      .default('file'),
    SOLANA_TREASURY_SECRET_KEY: z.string().optional(),
    SOLANA_TREASURY_SECRET_KEY_FILE: z.string().optional(),
    SOLANA_CONFIRMATION_COMMITMENT: z
      .enum(['processed', 'confirmed', 'finalized'])
      .default('confirmed'),
    HASHICORP_VAULT_ADDR: z.string().optional(),
    HASHICORP_VAULT_NAMESPACE: z.string().optional(),
    HASHICORP_VAULT_TOKEN: z.string().optional(),
    HASHICORP_VAULT_TOKEN_FILE: z.string().optional(),
    HASHICORP_VAULT_SECRET_PATH: z.string().optional(),
    HASHICORP_VAULT_SECRET_FIELD: z.string().default('secret'),
    PINATA_JWT: requiredChainSecret('test-pinata-jwt'),
    IPFS_GATEWAY_BASE: z.string().optional(),
    COINGECKO_API_BASE: z.string().default('https://api.coingecko.com/api/v3'),
    SOL_USD_FALLBACK: z.string().optional(),
    RISK_DAILY_PURCHASE_LIMIT_USDC_MINOR: integerString.default('200000000'),
    RISK_DAILY_WITHDRAWAL_LIMIT_USDC_MINOR: integerString.default('500000000'),
    RISK_PER_MINUTE_REQUEST_LIMIT: integerString.default('20'),
    RISK_BLOCKED_WALLET_ADDRESSES: z.string().default(''),
    RISK_MANUAL_APPROVAL_THRESHOLD_USDC_MINOR: integerString.default('100000000'),
    RISK_MAX_SINGLE_WITHDRAWAL_USDC_MINOR: integerString.default('100000000'),
    RISK_MAX_REQUESTS_PER_DAY_PER_WALLET: integerString.default('5'),
    RISK_MAX_AMOUNT_PER_DAY_PER_WALLET_USDC_MINOR: integerString.default('500000000'),
    RISK_MAX_REQUESTS_PER_DAY_GLOBAL: integerString.default('50'),
    RISK_MAX_AMOUNT_PER_DAY_GLOBAL_USDC_MINOR: integerString.default('2000000000'),
    EMAILS_ENABLED: z.enum(['true', 'false']).default('false'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().default('Lesenpad <onboarding@resend.dev>'),
    RESEND_REPLY_TO: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (
      config.NODE_ENV === 'production' &&
      !mainnetLabels.has(config.SOLANA_NETWORK)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SOLANA_NETWORK'],
        message:
          'SOLANA_NETWORK must be mainnet or mainnet-beta in production.',
      });
    }

    if (
      config.NODE_ENV === 'production' &&
      config.SOLANA_RPC_URL.includes('devnet')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SOLANA_RPC_URL'],
        message:
          'SOLANA_RPC_URL must point to a mainnet RPC endpoint in production.',
      });
    }

    if (
      config.NODE_ENV === 'production' &&
      config.SOLANA_USDC_MINT_ADDRESS !== MAINNET_USDC_MINT_ADDRESS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SOLANA_USDC_MINT_ADDRESS'],
        message:
          'SOLANA_USDC_MINT_ADDRESS must be the mainnet USDC mint in production.',
      });
    }

    if (
      config.NODE_ENV === 'production' &&
      config.SOLANA_TREASURY_SECRET_SOURCE === 'file' &&
      !config.SOLANA_TREASURY_SECRET_KEY_FILE?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SOLANA_TREASURY_SECRET_KEY_FILE'],
        message:
          'SOLANA_TREASURY_SECRET_KEY_FILE is required in production when using file-based treasury secrets.',
      });
    }

    if (
      config.NODE_ENV === 'production' &&
      config.SOLANA_TREASURY_SECRET_SOURCE === 'vault'
    ) {
      if (!config.HASHICORP_VAULT_ADDR?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['HASHICORP_VAULT_ADDR'],
          message: 'HASHICORP_VAULT_ADDR is required when using vault secrets.',
        });
      }
      if (
        !config.HASHICORP_VAULT_TOKEN?.trim() &&
        !config.HASHICORP_VAULT_TOKEN_FILE?.trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['HASHICORP_VAULT_TOKEN'],
          message:
            'Set HASHICORP_VAULT_TOKEN or HASHICORP_VAULT_TOKEN_FILE when using vault secrets.',
        });
      }
      if (!config.HASHICORP_VAULT_SECRET_PATH?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['HASHICORP_VAULT_SECRET_PATH'],
          message:
            'HASHICORP_VAULT_SECRET_PATH is required when using vault secrets.',
        });
      }
    }

    if (config.EMAILS_ENABLED === 'true' && !config.RESEND_API_KEY?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAILS_ENABLED=true.',
      });
    }
  });

export type EnvSchema = z.infer<typeof envSchema>;
