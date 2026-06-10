import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { CookieBanner } from '@/components/cookie-banner';
import { SiteChatbot } from '@/components/site-chatbot';
import { NumberInputWheelGuard } from '@/components/number-input-wheel-guard';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { BRAND } from '@/lib/seo/brand';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/jsonLd';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: {
    default: `${BRAND.shortName} — Broker digitale per passaggi di proprietà auto`,
    template: `%s · ${BRAND.shortName}`,
  },
  description: BRAND.description,
  applicationName: BRAND.shortName,
  generator: 'Next.js',
  keywords: [
    'passaggio di proprietà auto',
    'broker pratiche auto',
    'agenzie pratiche auto',
    'software dealer auto',
    'gestionale concessionaria',
    'ACI digitale',
    'pratica auto online',
    'passaggio proprietà veicoli',
  ],
  authors: [{ name: BRAND.legalName, url: BRAND.url }],
  creator: BRAND.legalName,
  publisher: BRAND.legalName,
  formatDetection: { telephone: false, email: false, address: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  alternates: {
    // canonical NON impostato qui: ogni pagina (home, privacy, cookie, termini)
    // setta il proprio canonical esplicitamente — evita default '/' contaminante.
    languages: { 'it-IT': '/' },
  },
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    url: BRAND.url,
    siteName: BRAND.shortName,
    title: `${BRAND.shortName} — Broker digitale automotive`,
    description: BRAND.description,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: `${BRAND.shortName} — Broker digitale automotive`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.shortName} — Broker digitale automotive`,
    description: BRAND.description,
    images: ['/opengraph-image'],
  },
  icons: {
    icon: [{ url: '/brand/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/brand/icon.svg', type: 'image/svg+xml' }],
  },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it-IT"
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="alternate" type="text/llms" href="/llms.txt" />
        <meta name="apple-mobile-web-app-title" content={BRAND.shortName} />
        <meta httpEquiv="content-language" content="it" />
      </head>
      <body className="min-h-full flex flex-col">
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
        {children}
        <SiteChatbot />
        <CookieBanner />
        <NumberInputWheelGuard />
      </body>
    </html>
  );
}
