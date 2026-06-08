import path from 'node:path';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
// @ts-expect-error - no type declarations for the plugin
import { PrismaPlugin } from '@prisma/nextjs-monorepo-workaround-plugin';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Server Actions: il wizard pratica può inviare libretto + 6 doc per parte
  // (max 10 MB ciascuno). Alziamo il limite del body per consentire upload multipli.
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Plugin ufficiale Prisma per copiare il query engine nel bundle webpack su Vercel monorepo pnpm.
  // Solo lato server (le rotte API e i Server Component).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = [...(config.plugins ?? []), new PrismaPlugin()];
    } else {
      // OpenCV.js (@techstark/opencv-js, build emscripten) referenzia moduli
      // Node (fs/path/crypto) in rami di rilevamento ambiente che non girano
      // nel browser: forniamo fallback vuoti per il bundle client.
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
        crypto: false,
      };
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
