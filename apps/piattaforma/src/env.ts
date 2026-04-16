import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.string().url().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Storage provider: local filesystem in dev, S3/GCS in prod
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./uploads'),

    // Email provider: console log in dev, Resend in prod
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    EMAIL_CONSOLE_DIR: z.string().default('./.dev-emails'),
    EMAIL_FROM: z.string().email().default('noreply@passaggioveloce.it'),
    RESEND_API_KEY: z.string().optional(),

    // OCR provider: mock in dev, Google Document AI in prod
    OCR_PROVIDER: z.enum(['mock', 'google_documentai']).default('mock'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_CONSOLE_DIR: process.env.EMAIL_CONSOLE_DIR,
    EMAIL_FROM: process.env.EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
});
