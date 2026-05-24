import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/seo/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.shortName,
    short_name: 'PV',
    description: BRAND.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: BRAND.themeColor,
    lang: 'it-IT',
    dir: 'ltr',
    icons: [
      {
        src: '/brand/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/brand/icon-mono-navy.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
