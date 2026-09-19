import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Load environment variables based on NODE_ENV if specified
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile =
  nodeEnv === 'production'
    ? '.env.production'
    : nodeEnv === 'staging'
      ? '.env.staging'
      : '.env.development';

dotenv.config({ path: path.resolve(process.cwd(), envFile) });
// Also load generic .env if present
dotenv.config();

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';
const defaultDbPath = isTest
  ? './data/ntm_test.sqlite'
  : isProd
    ? './data/ntm_prod.sqlite'
    : './data/ntm_dev.sqlite';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  HOST: z.string().default('127.0.0.1'),
  DB_PATH: z.string().default(defaultDbPath),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters for cryptographic security'),
  SESSION_EXPIRY_HOURS: z.coerce.number().positive().default(720),
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173'),
  PIN_ENCRYPTION_KEY: z
    .string()
    .min(32, 'PIN_ENCRYPTION_KEY must be at least 32 characters for cryptographic security')
    .default('dev_pin_encryption_secret_key_32_chars_local!'),
  BANK_ENCRYPTION_KEY: z
    .string()
    .min(32, 'BANK_ENCRYPTION_KEY must be at least 32 characters for cryptographic security')
    .default('dev_bank_encryption_secret_key_32_chars_local!'),
  // Optional Firebase Admin Configuration
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Environment configuration validation failed:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  // Production safety guard: Never use test or dev database in production
  if (result.data.NODE_ENV === 'production') {
    const dbName = path.basename(result.data.DB_PATH).toLowerCase();
    if (dbName.includes('test') || dbName.includes('dev')) {
      console.error('❌ FATAL: Production environment cannot use test or development database file:', result.data.DB_PATH);
      process.exit(1);
    }
    // Production safety guard: Never permit wildcard CORS in production
    const origins = result.data.CORS_ORIGIN.split(',').map((o) => o.trim());
    if (origins.includes('*')) {
      console.error('❌ FATAL: Production environment cannot use wildcard (*) CORS_ORIGIN');
      process.exit(1);
    }
  }

  return result.data;
};

export const env = parseEnv();
