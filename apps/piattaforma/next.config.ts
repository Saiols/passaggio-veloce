import path from 'node:path';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo pnpm: serve outputFileTracingRoot per risolvere correttamente i path
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Prisma engine binary va incluso esplicitamente nel bundle serverless Vercel
  // (webpack non lo copia automaticamente come fa Turbopack)
  outputFileTracingIncludes: {
    '/**/*': [
      './node_modules/.pnpm/@prisma+client*/**/libquery_engine-*',
      './node_modules/.pnpm/.prisma/client/**',
      './node_modules/.prisma/client/**',
    ],
  },
};

const sentryEnabled = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      tunnelRoute: '/monitoring',
      disableLogger: true,
    })
  : nextConfig;
