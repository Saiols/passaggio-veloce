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
    }
    return config;
  },
  // Header di sicurezza globali (finding H1). Deliberatamente SOLO la difesa
  // anti-clickjacking/sniffing: nessuna CSP restrittiva su script/connect-src,
  // per non rompere Google Maps, Vercel Blob, Sentry e il widget chatbot.
  // `camera=()` è sicuro qui: lo scanner documenti NON usa mai getUserMedia
  // in pagina (nessun <video>/MediaDevices nel codice) — il picker "Scatta
  // foto" arriva dalla fotocamera nativa del sistema operativo tramite
  // <input type="file"> (vedi banner-foto-documenti.tsx), fuori dal contesto
  // pagina e quindi non gatato da questa policy.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
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
