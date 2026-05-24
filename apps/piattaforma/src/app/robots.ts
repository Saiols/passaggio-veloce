import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';

export const dynamic = 'force-dynamic';

// Path dell'app autenticata che non devono mai essere indicizzati nemmeno
// quando vengono raggiunti tramite redirect del gate. Pattern centralizzati
// così se aggiungiamo nuove route protette li aggiorniamo solo qui.
const DISALLOW_APP_PATHS = [
  '/api/',
  '/admin/',
  '/dashboard/',
  '/inbox/',
  '/pratiche/',
  '/wallet/',
  '/profilo/',
  '/team/',
  '/notifiche/',
  '/orari/',
  '/affiliazione/',
  '/login',
  '/register',
  '/verify-email',
  '/reset-password',
  '/invito/',
];

const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host');

  // Su vercel.app, preview URLs e qualunque host non canonico: blocca tutto.
  // Evita duplicate content e dispersione di PageRank.
  if (!isGatedHost(host)) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOW_APP_PATHS,
      },
      // AI crawlers buoni: stessa policy, esplicita per chiarezza e per future
      // direttive granulari (es. delay, allow-specific-paths).
      {
        userAgent: AI_CRAWLERS,
        allow: '/',
        disallow: DISALLOW_APP_PATHS,
      },
    ],
    sitemap: `${BRAND.url}/sitemap.xml`,
  };
}
