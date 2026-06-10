import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.string().url().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    STORAGE_PROVIDER: z.enum(['local', 's3', 'vercel-blob']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./uploads'),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    EMAIL_CONSOLE_DIR: z.string().default('./.dev-emails'),
    EMAIL_FROM: z.string().email().default('noreply@passaggioveloce.it'),
    RESEND_API_KEY: z.string().optional(),

    OCR_PROVIDER: z.enum(['mock', 'mindee', 'google_documentai']).default('mock'),
    MINDEE_API_KEY: z.string().optional(),
    MINDEE_MODEL_ID: z.string().optional(),
    GOOGLE_DOCUMENTAI_PROJECT_ID: z.string().optional(),
    GOOGLE_DOCUMENTAI_LOCATION: z.string().default('eu'),
    GOOGLE_DOCUMENTAI_PROCESSOR_ID: z.string().optional(),
    GOOGLE_DOCUMENTAI_CREDENTIALS_JSON: z.string().optional(),

    REGISTRO_IMPRESE_PROVIDER: z.enum(['mock', 'noop', 'openapi', 'infocamere']).default('mock'),
    REGISTRO_IMPRESE_API_KEY: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_CONSOLE_DIR: process.env.EMAIL_CONSOLE_DIR,
    EMAIL_FROM: process.env.EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    MINDEE_API_KEY: process.env.MINDEE_API_KEY,
    MINDEE_MODEL_ID: process.env.MINDEE_MODEL_ID,
    GOOGLE_DOCUMENTAI_PROJECT_ID: process.env.GOOGLE_DOCUMENTAI_PROJECT_ID,
    GOOGLE_DOCUMENTAI_LOCATION: process.env.GOOGLE_DOCUMENTAI_LOCATION,
    GOOGLE_DOCUMENTAI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_ID,
    GOOGLE_DOCUMENTAI_CREDENTIALS_JSON: process.env.GOOGLE_DOCUMENTAI_CREDENTIALS_JSON,
    REGISTRO_IMPRESE_PROVIDER: process.env.REGISTRO_IMPRESE_PROVIDER,
    REGISTRO_IMPRESE_API_KEY: process.env.REGISTRO_IMPRESE_API_KEY,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
});
