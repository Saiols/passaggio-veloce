import path from 'node:path';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
// @ts-expect-error - no type declarations for the plugin
import { PrismaPlugin } from '@prisma/nextjs-monorepo-workaround-plugin';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Plugin ufficiale Prisma per copiare il query engine nel bundle webpack su Vercel monorepo pnpm.
  // Solo lato server (le rotte API e i Server Component).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = [...(config.plugins ?? []), new PrismaPlugin()];
    }
    return config;
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
