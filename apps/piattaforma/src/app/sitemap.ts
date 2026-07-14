import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';
import { GUIDES } from '@/lib/seo/guides';

// force-dynamic: il pattern del progetto (vedi /api/version) richiede
// esplicito force-dynamic per via dei Vercel Sensitive env vars.
// Non affidarsi all'inferenza automatica da headers().
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host');

  // Niente sitemap su vercel.app / preview URLs: già noindex via robots.
  if (!isGatedHost(host)) return [];

  const lastModified = process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE
    ? new Date(process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE)
    : new Date();

  return [
    { url: `${BRAND.url}/`,        lastModified, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${BRAND.url}/guide`,   lastModified, changeFrequency: 'weekly',  priority: 0.6 },
    ...GUIDES.map((g) => ({
      url: `${BRAND.url}${g.url}`,
      lastModified: new Date(g.lastModified),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${BRAND.url}/privacy`,         lastModified, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${BRAND.url}/privacy/clienti`, lastModified, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${BRAND.url}/cookie`,          lastModified, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${BRAND.url}/termini`,         lastModified, changeFrequency: 'yearly',  priority: 0.3 },
  ];
}
