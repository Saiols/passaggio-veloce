# Landing SEO/AEO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare la landing `passaggioveloce.it` da default Next 16 a production-grade SEO/AEO (lang it-IT, metadata completi, sitemap+robots host-aware, JSON-LD strutturati, OG image, llms.txt, manifest), target Lighthouse SEO ≥ 95 e Rich Results validi.

**Architecture:** Native Next 16 Metadata API + libreria condivisa `src/lib/seo/` (BRAND constants, FAQ items, JSON-LD generators, `<JsonLd>` component). Metadata co-located per route. File-route convention per sitemap/robots/manifest/opengraph-image/llms.txt, tutti host-aware via `next/headers` per evitare duplicate content su vercel.app/preview.

**Tech Stack:** Next 16 (App Router), TypeScript, Vitest + happy-dom (test runner co-located `.test.ts`), `next/og` `ImageResponse` (Node runtime), pnpm workspace `apps/piattaforma`.

**Spec di riferimento:** `docs/superpowers/specs/2026-05-24-landing-seo-aeo-design.md`

**Working directory per i comandi:** sempre `apps/piattaforma` (usa `pnpm --filter piattaforma <cmd>` da root oppure `cd apps/piattaforma && pnpm <cmd>`).

---

## File Structure

```
apps/piattaforma/src/
├── app/
│   ├── layout.tsx              [MODIFY]  metadata espansi, lang it-IT, JSON-LD globali
│   ├── page.tsx                [MODIFY]  metadata home, JSON-LD, address footer, FAQ_ITEMS import
│   ├── privacy/page.tsx        [MODIFY]  metadata override + WebPage JSON-LD
│   ├── cookie/page.tsx         [MODIFY]  metadata override + WebPage JSON-LD
│   ├── termini/page.tsx        [MODIFY]  metadata override + WebPage JSON-LD
│   ├── sitemap.ts              [CREATE]  host-aware
│   ├── robots.ts               [CREATE]  host-aware + AI crawlers
│   ├── manifest.ts             [CREATE]  PWA manifest
│   ├── opengraph-image.tsx     [CREATE]  ImageResponse 1200x630
│   ├── twitter-image.tsx       [CREATE]  re-export di opengraph-image
│   └── llms.txt/
│       └── route.ts            [CREATE]  text/plain handler host-aware
└── lib/seo/                    [CREATE dir]
    ├── brand.ts                [CREATE]  costanti immutabili (vat, address, etc.)
    ├── brand.test.ts           [CREATE]  smoke test su shape e valori chiave
    ├── faqItems.ts             [CREATE]  FAQ_ITEMS condiviso
    ├── jsonLd.ts               [CREATE]  generatori type-safe
    ├── jsonLd.test.ts          [CREATE]  test sui generatori
    └── JsonLd.tsx              [CREATE]  componente React di iniezione
```

---

## Task 1: Setup `src/lib/seo/brand.ts` (costanti brand)

**Files:**
- Create: `apps/piattaforma/src/lib/seo/brand.ts`
- Create: `apps/piattaforma/src/lib/seo/brand.test.ts`

- [ ] **Step 1: Scrivi il test che fallisce**

File: `apps/piattaforma/src/lib/seo/brand.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('ha tutti i campi anagrafici obbligatori popolati (no TODO)', () => {
    expect(BRAND.legalName).toBe('Passaggio Veloce SRL');
    expect(BRAND.shortName).toBe('Passaggio Veloce');
    expect(BRAND.url).toBe('https://passaggioveloce.it');
    expect(BRAND.email).toBe('info@passaggioveloce.it');
    expect(BRAND.vatId).toBe('14688390963');
    expect(BRAND.vatIdSchema).toBe('IT14688390963');
    expect(BRAND.phoneE164).toBe('+393462877310');
  });

  it('indirizzo sede legale completo', () => {
    expect(BRAND.address.street).toBe('Via delle Querce 5');
    expect(BRAND.address.postalCode).toBe('20057');
    expect(BRAND.address.city).toBe('Assago');
    expect(BRAND.address.region).toBe('MI');
    expect(BRAND.address.countryCode).toBe('IT');
  });

  it('founder list contiene i due co-founder', () => {
    expect(BRAND.founders).toEqual(['Andrea Saino', 'Francesco Sioli']);
  });

  it('siteUrl normalizza il path', () => {
    const { siteUrl } = require('./brand');
    expect(siteUrl('/')).toBe('https://passaggioveloce.it/');
    expect(siteUrl('/privacy')).toBe('https://passaggioveloce.it/privacy');
    expect(siteUrl('privacy')).toBe('https://passaggioveloce.it/privacy');
    expect(siteUrl()).toBe('https://passaggioveloce.it');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/seo/brand.test.ts`
Expected: FAIL con "Cannot find module './brand'"

- [ ] **Step 3: Crea `brand.ts` con tutte le costanti**

File: `apps/piattaforma/src/lib/seo/brand.ts`

```ts
// Single source of truth per i dati anagrafici/brand di Passaggio Veloce.
// Usato da: metadata, JSON-LD, sitemap, robots, llms.txt, OG image, manifest.
// MAI hardcodare gli stessi valori altrove nel codice.

export const BRAND = {
  legalName: 'Passaggio Veloce SRL',
  shortName: 'Passaggio Veloce',
  description:
    'Broker digitale italiano per passaggi di proprietà veicoli: connette dealer auto e agenzie pratiche in una piattaforma unica conforme ACI, GDPR e SDI.',
  url: 'https://passaggioveloce.it',
  email: 'info@passaggioveloce.it',
  // P.IVA italiana raw + formato schema.org (con prefisso paese ISO 3166-1 alpha-2).
  vatId: '14688390963',
  vatIdSchema: 'IT14688390963',
  taxId: '14688390963', // per SRL coincide con la P.IVA
  // E.164 senza spazi (richiesto da telephone URI e schema.org ContactPoint).
  phoneE164: '+393462877310',
  phoneDisplay: '+39 346 287 7310',
  address: {
    street: 'Via delle Querce 5',
    postalCode: '20057',
    city: 'Assago',
    region: 'MI',
    countryCode: 'IT',
  },
  founders: ['Andrea Saino', 'Francesco Sioli'] as const,
  // Popolare quando i social aziendali sono attivi.
  sameAs: [] as readonly string[],
} as const;

export function siteUrl(path?: string): string {
  if (!path) return BRAND.url;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BRAND.url}${normalized === '/' ? '/' : normalized}`;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/seo/brand.test.ts`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/seo/brand.ts apps/piattaforma/src/lib/seo/brand.test.ts
git commit -m "feat(seo): brand constants module con dati anagrafici PV SRL"
```

---

## Task 2: `src/lib/seo/faqItems.ts` (FAQ canoniche condivise)

**Files:**
- Create: `apps/piattaforma/src/lib/seo/faqItems.ts`

- [ ] **Step 1: Crea il modulo `faqItems.ts`**

Le FAQ sono attualmente hardcoded in `apps/piattaforma/src/app/page.tsx` (cinque componenti `<FAQ q="..." a="..." />`). Le estraiamo qui così sono riusate sia dal JSON-LD `FAQPage` sia da `llms.txt`. Stesso contenuto, copy/incolla 1:1.

File: `apps/piattaforma/src/lib/seo/faqItems.ts`

```ts
// FAQ canoniche della landing — single source of truth.
// Usate da:
//   - app/page.tsx (rendering visuale + JSON-LD FAQPage)
//   - app/llms.txt/route.ts (canonicizzazione per crawler AI)
// Modifica qui per propagare ovunque.

export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: 'Quanto costa registrarsi?',
    a: "L'iscrizione è gratuita sia per dealer che per agenzie. Paghi solo quando una pratica viene completata: il dealer accumula crediti, l'agenzia riceve la fee al netto della nostra commissione.",
  },
  {
    q: 'Quanto tempo serve per chiudere una pratica?',
    a: "In media 48 ore lavorative dal caricamento del libretto alla firma in agenzia. La distribuzione automatica trova un'agenzia disponibile entro 1 giorno lavorativo nel 92% dei casi.",
  },
  {
    q: 'Cosa succede se nessuna agenzia accetta la pratica?',
    a: 'Il sistema estende la ricerca prima ai comuni limitrofi, poi all\'intera provincia. In ultima istanza, il nostro team si attiva manualmente per garantire la chiusura.',
  },
  {
    q: 'I dati dei miei clienti sono al sicuro?',
    a: "Sì. CI, codici fiscali e visure sono criptati end-to-end. Solo l'agenzia assegnata può scaricarli, e tutti gli accessi sono loggati. Conforme GDPR e direttive ACI.",
  },
  {
    q: 'Come vengo pagato come dealer?',
    a: 'Ogni pratica chiusa ti accredita 25€ sul wallet. Sotto i 500€ il saldo si accumula, fra 500 e 999€ puoi richiedere payout manuale, da 1.000€ il payout è automatico mensile su IBAN.',
  },
] as const;
```

- [ ] **Step 2: Verifica che il modulo compili**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS (zero errori TypeScript)

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/lib/seo/faqItems.ts
git commit -m "feat(seo): FAQ canoniche estratte in modulo condiviso"
```

---

## Task 3: `src/lib/seo/jsonLd.ts` (generatori JSON-LD)

**Files:**
- Create: `apps/piattaforma/src/lib/seo/jsonLd.ts`
- Create: `apps/piattaforma/src/lib/seo/jsonLd.test.ts`

- [ ] **Step 1: Scrivi i test che falliscono**

File: `apps/piattaforma/src/lib/seo/jsonLd.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  organizationJsonLd,
  websiteJsonLd,
  webPageJsonLd,
  faqJsonLd,
  serviceJsonLd,
  breadcrumbJsonLd,
  softwareApplicationJsonLd,
  ORGANIZATION_ID,
} from './jsonLd';

describe('organizationJsonLd', () => {
  const org = organizationJsonLd();

  it('ha @context e @type corretti', () => {
    expect(org['@context']).toBe('https://schema.org');
    expect(org['@type']).toEqual(['Organization', 'ProfessionalService']);
  });

  it('ha @id riferibile da altri schema', () => {
    expect(org['@id']).toBe(ORGANIZATION_ID);
    expect(ORGANIZATION_ID).toBe('https://passaggioveloce.it/#organization');
  });

  it('include P.IVA in formato schema.org (con prefisso IT)', () => {
    expect(org.vatID).toBe('IT14688390963');
    expect(org.taxID).toBe('14688390963');
  });

  it('include indirizzo PostalAddress completo', () => {
    expect(org.address).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: 'Via delle Querce 5',
      postalCode: '20057',
      addressLocality: 'Assago',
      addressRegion: 'MI',
      addressCountry: 'IT',
    });
  });

  it('include ContactPoint con telefono e email', () => {
    expect(org.contactPoint).toMatchObject({
      '@type': 'ContactPoint',
      telephone: '+393462877310',
      email: 'info@passaggioveloce.it',
      contactType: 'customer service',
      availableLanguage: ['Italian'],
    });
  });

  it('include founder come array di Person', () => {
    expect(org.founder).toEqual([
      { '@type': 'Person', name: 'Andrea Saino' },
      { '@type': 'Person', name: 'Francesco Sioli' },
    ]);
  });
});

describe('websiteJsonLd', () => {
  const ws = websiteJsonLd();

  it('ha @type WebSite con SearchAction', () => {
    expect(ws['@type']).toBe('WebSite');
    expect(ws.potentialAction).toMatchObject({
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://passaggioveloce.it/?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    });
  });

  it('publisher riferisce Organization via @id', () => {
    expect(ws.publisher).toEqual({ '@id': ORGANIZATION_ID });
  });
});

describe('faqJsonLd', () => {
  it('mappa items in mainEntity con Question/Answer', () => {
    const faq = faqJsonLd([
      { q: 'Domanda 1?', a: 'Risposta 1.' },
      { q: 'Domanda 2?', a: 'Risposta 2.' },
    ]);
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'Domanda 1?',
      acceptedAnswer: { '@type': 'Answer', text: 'Risposta 1.' },
    });
  });
});

describe('serviceJsonLd', () => {
  const svc = serviceJsonLd();

  it('@type Service con areaServed Italia', () => {
    expect(svc['@type']).toBe('Service');
    expect(svc.areaServed).toMatchObject({ '@type': 'Country', name: 'Italy' });
  });

  it('provider riferisce Organization via @id', () => {
    expect(svc.provider).toEqual({ '@id': ORGANIZATION_ID });
  });

  it('audience B2B', () => {
    expect(svc.audience).toMatchObject({ '@type': 'BusinessAudience' });
  });
});

describe('softwareApplicationJsonLd', () => {
  const sw = softwareApplicationJsonLd();

  it('@type SoftwareApplication categoria Business', () => {
    expect(sw['@type']).toBe('SoftwareApplication');
    expect(sw.applicationCategory).toBe('BusinessApplication');
    expect(sw.operatingSystem).toBe('Web');
  });

  it('offers gratuito EUR', () => {
    expect(sw.offers).toMatchObject({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    });
  });
});

describe('webPageJsonLd', () => {
  it('crea WebPage con campi base', () => {
    const wp = webPageJsonLd({
      url: 'https://passaggioveloce.it/privacy',
      name: 'Privacy Policy',
      description: 'Informativa privacy.',
    });
    expect(wp['@type']).toBe('WebPage');
    expect(wp.url).toBe('https://passaggioveloce.it/privacy');
    expect(wp.name).toBe('Privacy Policy');
    expect(wp.isPartOf).toEqual({ '@id': `${ORGANIZATION_ID.replace('#organization', '#website')}` });
  });
});

describe('breadcrumbJsonLd', () => {
  it('crea BreadcrumbList ordinata', () => {
    const bc = breadcrumbJsonLd([
      { name: 'Home', url: 'https://passaggioveloce.it/' },
      { name: 'Privacy', url: 'https://passaggioveloce.it/privacy' },
    ]);
    expect(bc['@type']).toBe('BreadcrumbList');
    expect(bc.itemListElement[0]).toMatchObject({ '@type': 'ListItem', position: 1, name: 'Home' });
    expect(bc.itemListElement[1].position).toBe(2);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/seo/jsonLd.test.ts`
Expected: FAIL con "Cannot find module './jsonLd'"

- [ ] **Step 3: Implementa i generatori**

File: `apps/piattaforma/src/lib/seo/jsonLd.ts`

```ts
import { BRAND, siteUrl } from './brand';
import type { FaqItem } from './faqItems';

export const ORGANIZATION_ID = `${BRAND.url}/#organization`;
export const WEBSITE_ID = `${BRAND.url}/#website`;

const ADDRESS = {
  '@type': 'PostalAddress' as const,
  streetAddress: BRAND.address.street,
  postalCode: BRAND.address.postalCode,
  addressLocality: BRAND.address.city,
  addressRegion: BRAND.address.region,
  addressCountry: BRAND.address.countryCode,
};

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'ProfessionalService'] as const,
    '@id': ORGANIZATION_ID,
    name: BRAND.shortName,
    legalName: BRAND.legalName,
    url: BRAND.url,
    logo: siteUrl('/brand/logo-primary.svg'),
    image: siteUrl('/opengraph-image'),
    description: BRAND.description,
    email: BRAND.email,
    telephone: BRAND.phoneE164,
    vatID: BRAND.vatIdSchema,
    taxID: BRAND.taxId,
    address: ADDRESS,
    contactPoint: {
      '@type': 'ContactPoint' as const,
      telephone: BRAND.phoneE164,
      email: BRAND.email,
      contactType: 'customer service',
      availableLanguage: ['Italian'],
      areaServed: 'IT',
    },
    founder: BRAND.founders.map((name) => ({
      '@type': 'Person' as const,
      name,
    })),
    sameAs: BRAND.sameAs,
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite' as const,
    '@id': WEBSITE_ID,
    url: BRAND.url,
    name: BRAND.shortName,
    description: BRAND.description,
    inLanguage: 'it-IT',
    publisher: { '@id': ORGANIZATION_ID },
    potentialAction: {
      '@type': 'SearchAction' as const,
      target: {
        '@type': 'EntryPoint' as const,
        urlTemplate: `${BRAND.url}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function webPageJsonLd(opts: {
  url: string;
  name: string;
  description: string;
  lastModified?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage' as const,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    inLanguage: 'it-IT',
    isPartOf: { '@id': WEBSITE_ID },
    ...(opts.lastModified && { dateModified: opts.lastModified }),
  };
}

export function faqJsonLd(items: readonly FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage' as const,
    mainEntity: items.map((item) => ({
      '@type': 'Question' as const,
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer' as const,
        text: item.a,
      },
    })),
  };
}

export function serviceJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service' as const,
    name: 'Broker digitale per passaggi di proprietà veicoli',
    serviceType: 'Intermediazione passaggi di proprietà auto',
    description: BRAND.description,
    provider: { '@id': ORGANIZATION_ID },
    areaServed: {
      '@type': 'Country' as const,
      name: 'Italy',
    },
    audience: {
      '@type': 'BusinessAudience' as const,
      audienceType: 'Concessionarie auto e agenzie pratiche auto',
    },
    offers: {
      '@type': 'Offer' as const,
      price: '0',
      priceCurrency: 'EUR',
      description: 'Registrazione gratuita, paghi solo a pratica completata',
    },
  };
}

export function softwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication' as const,
    name: BRAND.shortName,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: BRAND.url,
    description: BRAND.description,
    publisher: { '@id': ORGANIZATION_ID },
    offers: {
      '@type': 'Offer' as const,
      price: '0',
      priceCurrency: 'EUR',
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList' as const,
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/seo/jsonLd.test.ts`
Expected: PASS (tutti i test, ~13 assertion)

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/seo/jsonLd.ts apps/piattaforma/src/lib/seo/jsonLd.test.ts
git commit -m "feat(seo): generatori JSON-LD type-safe (Organization, WebSite, FAQPage, Service, etc.)"
```

---

## Task 4: `src/lib/seo/JsonLd.tsx` (componente React di iniezione)

**Files:**
- Create: `apps/piattaforma/src/lib/seo/JsonLd.tsx`

- [ ] **Step 1: Crea il componente**

File: `apps/piattaforma/src/lib/seo/JsonLd.tsx`

```tsx
// Inietta uno o più oggetti JSON-LD in un <script type="application/ld+json">.
// Escape di `<` per safety XSS anche se il payload tipicamente non contiene
// user input (per ora i nostri schema sono interamente derivati da BRAND).

type Props = {
  data: object | object[];
};

export function JsonLd({ data }: Props) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
```

- [ ] **Step 2: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/lib/seo/JsonLd.tsx
git commit -m "feat(seo): componente <JsonLd> per iniezione schema strutturati"
```

---

## Task 5: Update `app/layout.tsx` (lang it-IT + metadata globali + JSON-LD)

**Files:**
- Modify: `apps/piattaforma/src/app/layout.tsx` (intero file)

- [ ] **Step 1: Sostituisci il contenuto del layout**

File: `apps/piattaforma/src/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { CookieBanner } from '@/components/cookie-banner';
import { JsonLd } from '@/lib/seo/JsonLd';
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
    canonical: '/',
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
  themeColor: '#0b1e3a',
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
        <CookieBanner />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS

- [ ] **Step 3: Verifica build**

Run: `pnpm --filter piattaforma build`
Expected: PASS, nessun warning su metadata

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/layout.tsx
git commit -m "feat(seo): layout con lang it-IT, metadata completi, JSON-LD Organization+WebSite globali"
```

---

## Task 6: Update `app/page.tsx` (home — metadata + JSON-LD + FAQ_ITEMS + address)

**Files:**
- Modify: `apps/piattaforma/src/app/page.tsx`

- [ ] **Step 1: Aggiungi gli import all'inizio del file**

In testa al file `apps/piattaforma/src/app/page.tsx`, dopo gli import esistenti (linee 1-6), aggiungi:

```tsx
import type { Metadata } from 'next';
import { JsonLd } from '@/lib/seo/JsonLd';
import { BRAND } from '@/lib/seo/brand';
import { FAQ_ITEMS } from '@/lib/seo/faqItems';
import {
  serviceJsonLd,
  faqJsonLd,
  softwareApplicationJsonLd,
  webPageJsonLd,
} from '@/lib/seo/jsonLd';

export const metadata: Metadata = {
  title: 'Broker digitale per passaggi di proprietà auto — dealer e agenzie',
  description:
    'Passaggio Veloce connette concessionarie e agenzie pratiche auto in un\'unica piattaforma SaaS: gestione documentale IA, payout automatici, conformità ACI/GDPR/SDI. Iscrizione gratuita.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Passaggio Veloce — Broker digitale per passaggi di proprietà auto',
    description:
      'Connettiamo dealer e agenzie pratiche auto in una piattaforma unica. Gestisci pratiche, documenti e pagamenti senza carta, in conformità ACI.',
    url: '/',
  },
};
```

- [ ] **Step 2: Inietta JSON-LD subito dopo `<SiteHeader />`**

Nella funzione `HomePage`, dopo `<SiteHeader />` e `<SiteChatbot ... />`, aggiungi il componente `<JsonLd>`:

Vecchio (linee ~26-28):
```tsx
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <SiteChatbot posizione="Homepage" />
```

Nuovo:
```tsx
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <SiteChatbot posizione="Homepage" />
      <JsonLd
        data={[
          webPageJsonLd({
            url: BRAND.url,
            name: 'Passaggio Veloce — Broker digitale automotive',
            description: BRAND.description,
          }),
          serviceJsonLd(),
          faqJsonLd(FAQ_ITEMS),
          softwareApplicationJsonLd(),
        ]}
      />
```

- [ ] **Step 3: Raffina il paragrafo Hero con la definizione AEO-friendly**

Il paragrafo descrittivo sotto l'H1 (linee ~41-44) attualmente recita:

```tsx
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-pv-slate-700 sm:text-base">
              Connettiamo dealer e agenzie pratiche auto in una piattaforma unica.
              Gestisci pratiche, documenti e pagamenti senza carta, in conformità ACI.
            </p>
```

Sostituiscilo con la versione AEO-friendly che apre con il pattern *"X è il Y che Z"* (i LLM premiano definizioni esplicite):

```tsx
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-pv-slate-700 sm:text-base">
              <strong>Passaggio Veloce</strong> è il broker digitale italiano che connette
              concessionarie auto e agenzie pratiche in un'unica piattaforma: gestisci pratiche,
              documenti e pagamenti senza carta, in conformità ACI, GDPR e SDI.
            </p>
```

- [ ] **Step 4: Aggiungi ID semantici alle sezioni**

Per le 5 macro-sezioni della home, aggiungi `id` e `aria-labelledby` sul `<section>` e `id` sull'`<h2>` corrispondente. Modifiche puntuali:

Sezione "Come funziona" (`<section className="bg-pv-slate-50">` con `<h2>Dal libretto alla firma in tre passi</h2>`):
- `<section className="bg-pv-slate-50" id="come-funziona" aria-labelledby="h-come-funziona">`
- `<h2 id="h-come-funziona" className="mt-2 text-[28px]...">Dal libretto alla firma in tre passi</h2>`

Sezione "Per dealer / Per agenzia" (`<section className="mx-auto w-full max-w-6xl ...">` con il grid lg:grid-cols-2 di PersonaCard):
- aggiungi `id="per-chi"` sul `<section>`

Sezione "Vantaggi tangibili" (`<section className="bg-pv-slate-50">` con `<h2>Tutto quello che serve, in un unico posto</h2>`):
- `<section className="bg-pv-slate-50" id="funzionalita" aria-labelledby="h-funzionalita">`
- `<h2 id="h-funzionalita" ...>Tutto quello che serve, in un unico posto</h2>`

Sezione "Tutele" (`<h2>Compliance e sicurezza, by design</h2>`):
- aggiungi `id="tutele" aria-labelledby="h-tutele"` al `<section>`
- `<h2 id="h-tutele" ...>Compliance e sicurezza, by design</h2>`

Sezione "FAQ" (`<section className="bg-pv-slate-50">` con `<h2>Le risposte rapide</h2>`):
- `<section className="bg-pv-slate-50" id="faq" aria-labelledby="h-faq">`
- `<h2 id="h-faq" ...>Le risposte rapide</h2>`

- [ ] **Step 5: Sostituisci le 5 `<FAQ ... />` hardcoded con `.map` su FAQ_ITEMS**

Il blocco attuale nella sezione FAQ (linee ~259-280) contiene 5 componenti `<FAQ q="..." a="..." />` hardcoded. Sostituiscili con:

```tsx
          <div className="mt-8 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <FAQ key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
```

Verifica: il contenuto renderizzato deve essere identico (5 accordion con le stesse Q&A) perché `FAQ_ITEMS` è stato popolato copiando esattamente i valori esistenti.

- [ ] **Step 6: Sostituisci il `<footer>` con address strutturato**

Il footer attuale (linee ~320-333) ha solo copyright + link legali. Aggiungilo come segue per esporre i dati anagrafici (boost LocalBusiness/trust):

Vecchio:
```tsx
      <footer className="mt-auto bg-pv-navy-900 text-pv-slate-300">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-5 py-6 text-[13px] sm:flex-row sm:items-center sm:px-6">
          <p>© {new Date().getFullYear()} Passaggio Veloce · Tutti i diritti riservati</p>
          <nav className="flex flex-wrap items-center gap-3 text-[12px]">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/cookie" className="hover:text-white">Cookie</Link>
            <Link href="/termini" className="hover:text-white">Termini</Link>
            <span className="text-pv-slate-500/40">·</span>
            <span className="font-mono text-[11px] text-pv-slate-500/70">
              build {(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}
            </span>
          </nav>
        </div>
      </footer>
```

Nuovo:
```tsx
      <footer className="mt-auto bg-pv-navy-900 text-pv-slate-300">
        <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto]">
            <address className="not-italic text-[13px] leading-relaxed">
              <p className="font-bold text-white">{BRAND.legalName}</p>
              <p>
                {BRAND.address.street} — {BRAND.address.postalCode} {BRAND.address.city} ({BRAND.address.region})
              </p>
              <p>
                P.IVA {BRAND.vatId} ·{' '}
                <a href={`mailto:${BRAND.email}`} className="hover:text-white">
                  {BRAND.email}
                </a>{' '}
                ·{' '}
                <a href={`tel:${BRAND.phoneE164}`} className="hover:text-white">
                  {BRAND.phoneDisplay}
                </a>
              </p>
            </address>
            <nav className="flex flex-wrap items-start gap-3 text-[12px]">
              <Link href="/privacy" className="hover:text-white">Privacy</Link>
              <Link href="/cookie" className="hover:text-white">Cookie</Link>
              <Link href="/termini" className="hover:text-white">Termini</Link>
            </nav>
          </div>
          <div className="mt-6 flex flex-col items-start justify-between gap-2 border-t border-pv-navy-800 pt-4 text-[12px] sm:flex-row sm:items-center">
            <p>© {new Date().getFullYear()} {BRAND.shortName} · Tutti i diritti riservati</p>
            <span className="font-mono text-[11px] text-pv-slate-500/70">
              build {(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}
            </span>
          </div>
        </div>
      </footer>
```

- [ ] **Step 7: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS senza warning

- [ ] **Step 8: Smoke test in dev**

Run: `pnpm --filter piattaforma dev` (in background)

In un altro shell:
```bash
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/ | grep -E '(lang="it-IT"|application/ld\+json|FAQPage|Passaggio Veloce SRL|Assago)'
```
Expected: tutti e 5 i pattern presenti nell'output.

Stoppa il dev server.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/page.tsx
git commit -m "feat(seo): home con metadata + JSON-LD (Service/FAQ/SoftwareApp), definizione AEO, address footer"
```

---

## Task 7: Metadata + WebPage JSON-LD su `/privacy`, `/cookie`, `/termini`

**Files:**
- Modify: `apps/piattaforma/src/app/privacy/page.tsx`
- Modify: `apps/piattaforma/src/app/cookie/page.tsx`
- Modify: `apps/piattaforma/src/app/termini/page.tsx`

- [ ] **Step 1: Aggiorna `privacy/page.tsx`**

Sostituisci l'`export const metadata` esistente (linee ~4-6) e aggiungi il JSON-LD nel body. Il pattern è identico per tutte e 3 le pagine — cambiano solo i testi.

In testa al file, dopo gli import esistenti:
```tsx
import type { Metadata } from 'next';
import { JsonLd } from '@/lib/seo/JsonLd';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Informativa privacy di Passaggio Veloce: titolare, dati raccolti, finalità, base giuridica, conservazione, diritti dell\'interessato.',
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};
```

Nel JSX, subito dopo `<SiteHeader />`:
```tsx
      <SiteHeader />
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/privacy'),
          name: 'Privacy Policy',
          description: 'Informativa privacy di Passaggio Veloce.',
          lastModified: '2026-05-06',
        })}
      />
```

- [ ] **Step 2: Aggiorna `cookie/page.tsx`**

Stessa struttura. In testa:
```tsx
import type { Metadata } from 'next';
import { JsonLd } from '@/lib/seo/JsonLd';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: 'Cookie policy di Passaggio Veloce: cookie tecnici, analytics, finalità, gestione delle preferenze.',
  alternates: { canonical: '/cookie' },
  robots: { index: true, follow: true },
};
```

Nel JSX, dopo `<SiteHeader />`:
```tsx
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/cookie'),
          name: 'Cookie Policy',
          description: 'Cookie policy di Passaggio Veloce.',
        })}
      />
```

Verifica la data esatta di "Ultimo aggiornamento" nel file e usala come `lastModified` se presente.

- [ ] **Step 3: Aggiorna `termini/page.tsx`**

Stessa struttura. In testa:
```tsx
import type { Metadata } from 'next';
import { JsonLd } from '@/lib/seo/JsonLd';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Termini e Condizioni',
  description: 'Termini e condizioni di utilizzo della piattaforma Passaggio Veloce: registrazione, account, responsabilità, foro competente.',
  alternates: { canonical: '/termini' },
  robots: { index: true, follow: true },
};
```

Nel JSX, dopo `<SiteHeader />`:
```tsx
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/termini'),
          name: 'Termini e Condizioni',
          description: 'Termini e condizioni di utilizzo di Passaggio Veloce.',
        })}
      />
```

- [ ] **Step 4: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS

- [ ] **Step 5: Smoke test**

Run: `pnpm --filter piattaforma dev` (background)

```bash
for path in privacy cookie termini; do
  echo "=== /$path ==="
  curl -s -H 'Host: passaggioveloce.it' "http://localhost:3000/$path" \
    | grep -E '(<title>|application/ld\+json|canonical)' | head -5
done
```
Expected: title personalizzato per ogni pagina + 1+ blocco `application/ld+json` + `<link rel="canonical">` corretto.

Stoppa dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/privacy/page.tsx apps/piattaforma/src/app/cookie/page.tsx apps/piattaforma/src/app/termini/page.tsx
git commit -m "feat(seo): metadata override e WebPage JSON-LD su pagine legali"
```

---

## Task 8: `app/sitemap.ts` (host-aware)

**Files:**
- Create: `apps/piattaforma/src/app/sitemap.ts`

- [ ] **Step 1: Crea il sitemap**

File: `apps/piattaforma/src/app/sitemap.ts`

```ts
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';

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
    { url: `${BRAND.url}/privacy`, lastModified, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${BRAND.url}/cookie`,  lastModified, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${BRAND.url}/termini`, lastModified, changeFrequency: 'yearly',  priority: 0.3 },
  ];
}
```

- [ ] **Step 2: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS, in build output deve apparire `/sitemap.xml` come route generata.

- [ ] **Step 3: Smoke test entrambi gli host**

Run: `pnpm --filter piattaforma dev` (background)

```bash
# Host gated (prod): deve ritornare XML con 4 URL
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/sitemap.xml \
  | grep -E '(<loc>|priority)' | head -10

# Host non-gated: deve ritornare XML vuoto (urlset senza url)
curl -s -H 'Host: localhost' http://localhost:3000/sitemap.xml
```

Expected:
- Primo comando: 4 `<loc>` con URL `https://passaggioveloce.it/*` e relative priority.
- Secondo comando: `<?xml version=...><urlset .../>` vuoto.

Stoppa dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/sitemap.ts
git commit -m "feat(seo): sitemap.xml host-aware (solo passaggioveloce.it)"
```

---

## Task 9: `app/robots.ts` (host-aware + AI crawlers)

**Files:**
- Create: `apps/piattaforma/src/app/robots.ts`

- [ ] **Step 1: Crea robots**

File: `apps/piattaforma/src/app/robots.ts`

```ts
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
```

- [ ] **Step 2: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS, `/robots.txt` route generata.

- [ ] **Step 3: Smoke test entrambi gli host**

Run: `pnpm --filter piattaforma dev` (background)

```bash
echo "=== passaggioveloce.it ==="
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/robots.txt
echo ""
echo "=== vercel.app ==="
curl -s -H 'Host: passaggio-veloce-piattaforma.vercel.app' http://localhost:3000/robots.txt
```

Expected:
- Primo: `User-Agent: *` con `Allow: /` e disallow su `/api/`, `/admin/`, etc. + sezione per `GPTBot, ClaudeBot, ...` + `Sitemap: https://passaggioveloce.it/sitemap.xml`.
- Secondo: solo `User-Agent: *` con `Disallow: /`.

Stoppa dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/robots.ts
git commit -m "feat(seo): robots.txt host-aware con allow AI crawlers su prod, disallow totale altrove"
```

---

## Task 10: `app/manifest.ts` (PWA Web App Manifest)

**Files:**
- Create: `apps/piattaforma/src/app/manifest.ts`

- [ ] **Step 1: Crea manifest**

File: `apps/piattaforma/src/app/manifest.ts`

```ts
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
    theme_color: '#0b1e3a',
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
```

- [ ] **Step 2: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS, `/manifest.webmanifest` route generata.

- [ ] **Step 3: Smoke test**

Run: `pnpm --filter piattaforma dev` (background)

```bash
curl -s http://localhost:3000/manifest.webmanifest | head -30
```
Expected: JSON valido con `name: "Passaggio Veloce"`, `theme_color: "#0b1e3a"`, icone.

Stoppa dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/manifest.ts
git commit -m "feat(seo): Web App Manifest (theme color brand navy, icone SVG)"
```

---

## Task 11: `app/opengraph-image.tsx` + `app/twitter-image.tsx`

**Files:**
- Create: `apps/piattaforma/src/app/opengraph-image.tsx`
- Create: `apps/piattaforma/src/app/twitter-image.tsx`

- [ ] **Step 1: Crea opengraph-image programmatico**

File: `apps/piattaforma/src/app/opengraph-image.tsx`

```tsx
/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '@/lib/seo/brand';

// Node runtime (default per opengraph-image.tsx in Next 16) consente fs.
// Edge runtime sarebbe più veloce ma dovremmo embeddare il logo come stringa.
export const runtime = 'nodejs';

export const alt = `${BRAND.shortName} — Broker digitale per passaggi di proprietà auto`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  // Legge il logo SVG dal filesystem e lo inietta inline come <img src="data:...">.
  // Fallback grazioso: se il file non c'è, l'OG si genera senza logo (testo only).
  let logoDataUri: string | null = null;
  try {
    const logoBuffer = readFileSync(
      join(process.cwd(), 'public', 'brand', 'logo-mono-white.svg'),
    );
    logoDataUri = `data:image/svg+xml;base64,${logoBuffer.toString('base64')}`;
  } catch {
    logoDataUri = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          background: 'linear-gradient(135deg, #0b1e3a 0%, #1e3a8a 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#ffffff',
        }}
      >
        {/* Top: badge dominio */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 22,
            opacity: 0.65,
            fontFamily: 'monospace',
          }}
        >
          passaggioveloce.it
        </div>

        {/* Middle: titolo + sottotitolo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {logoDataUri ? (
            <img
              src={logoDataUri}
              alt=""
              width={420}
              height={72}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
            }}
          >
            Passaggio Veloce
          </div>
          <div
            style={{
              fontSize: 36,
              lineHeight: 1.25,
              color: '#b8cdea',
              maxWidth: 900,
            }}
          >
            Broker digitale per passaggi di proprietà auto.
          </div>
        </div>

        {/* Bottom: pill compliance */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div
            style={{
              display: 'flex',
              padding: '12px 22px',
              borderRadius: 999,
              background: '#f97316',
              color: '#ffffff',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            ACI · GDPR · SDI
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
```

- [ ] **Step 2: Crea twitter-image come re-export**

File: `apps/piattaforma/src/app/twitter-image.tsx`

```tsx
// Next 16 cerca esplicitamente twitter-image.* separato. Riusiamo l'OG.
export { default, alt, size, contentType, runtime } from './opengraph-image';
```

- [ ] **Step 3: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS, `/opengraph-image` e `/twitter-image` route generate.

- [ ] **Step 4: Smoke test**

Run: `pnpm --filter piattaforma dev` (background)

```bash
curl -s -o /tmp/og.png -w "Status: %{http_code} | Size: %{size_download} bytes | Content-Type: %{content_type}\n" \
  http://localhost:3000/opengraph-image

# Sanity check: deve essere PNG > 20KB
file /tmp/og.png
```
Expected:
- `Status: 200`
- `Content-Type: image/png`
- `Size: >= 20000` (immagine generata, non vuota)
- `file` riconosce "PNG image data, 1200 x 630"

(Opzionale ma raccomandato: aprire `http://localhost:3000/opengraph-image` nel browser per verificare visivamente che il logo, il titolo e la pill siano renderizzati correttamente.)

Stoppa dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/opengraph-image.tsx apps/piattaforma/src/app/twitter-image.tsx
git commit -m "feat(seo): OG image programmatica 1200x630 (gradient brand, logo, pill compliance)"
```

---

## Task 12: `app/llms.txt/route.ts` (endpoint AEO per crawler AI)

**Files:**
- Create: `apps/piattaforma/src/app/llms.txt/route.ts`

- [ ] **Step 1: Crea il route handler**

File: `apps/piattaforma/src/app/llms.txt/route.ts`

```ts
import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';
import { FAQ_ITEMS } from '@/lib/seo/faqItems';

export const dynamic = 'force-dynamic';

const NOT_AVAILABLE = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

export async function GET() {
  const host = (await headers()).get('host');
  if (!isGatedHost(host)) return NOT_AVAILABLE;

  const body = renderLlmsTxt();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

function renderLlmsTxt(): string {
  const addr = BRAND.address;
  const faqBlock = FAQ_ITEMS.map(
    ({ q, a }) => `Q: ${q}\nA: ${a}`,
  ).join('\n\n');

  return `# Passaggio Veloce

> ${BRAND.description}

## Identità
- Ragione sociale: ${BRAND.legalName}
- Sito: ${BRAND.url}
- Email: ${BRAND.email}
- Telefono: ${BRAND.phoneDisplay}
- Sede legale: ${addr.street}, ${addr.postalCode} ${addr.city} (${addr.region}), Italia
- P.IVA: ${BRAND.vatId}
- Fondatori: ${BRAND.founders.join(', ')}

## Cosa fa
Passaggio Veloce è una piattaforma SaaS B2B che digitalizza l'intero ciclo del
passaggio di proprietà di un veicolo: dalla raccolta documenti (verificata da IA)
alla distribuzione automatica alle agenzie pratiche auto partner, fino alla firma
e all'emissione della fattura elettronica SDI. Elimina telefonate, mail con
allegati e fascicoli cartacei.

## A chi è rivolto
- Dealer e concessionarie auto che cercano di liberare tempo dalla burocrazia.
- Agenzie pratiche auto che vogliono ricevere pratiche già complete e verificate.

## Come funziona (3 step)
1. Il dealer carica libretto, CI e CF — l'IA legge i dati, compila i campi e
   segnala documenti incompleti prima dell'invio.
2. Il sistema distribuisce la pratica alle agenzie partner della zona, ordinate
   per affidabilità: la prima che accetta vince.
3. La pratica viene firmata in agenzia, l'accredito sul wallet del dealer è
   automatico e la fattura elettronica viene trasmessa al SDI.

## Conformità
- ACI / Motorizzazione: procedure aderenti alle ultime circolari.
- GDPR: documenti criptati at-rest, retention configurabile, audit completo.
- Fatturazione elettronica SDI per broker → agenzia e agenzia → cliente finale.
- Mandato SEPA tracciato per i payout dei dealer.

## FAQ canoniche

${faqBlock}

## Risorse
- Sito: ${BRAND.url}
- Privacy: ${BRAND.url}/privacy
- Cookie: ${BRAND.url}/cookie
- Termini: ${BRAND.url}/termini
- Contatti: ${BRAND.email}
`;
}
```

- [ ] **Step 2: Verifica typecheck + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build`
Expected: PASS, route `/llms.txt` generata.

- [ ] **Step 3: Smoke test entrambi gli host**

Run: `pnpm --filter piattaforma dev` (background)

```bash
echo "=== passaggioveloce.it ==="
curl -s -H 'Host: passaggioveloce.it' -i http://localhost:3000/llms.txt | head -20

echo ""
echo "=== vercel.app (deve essere 404) ==="
curl -s -H 'Host: example.vercel.app' -o /dev/null -w "%{http_code}\n" http://localhost:3000/llms.txt
```

Expected:
- Primo: `200 OK`, `content-type: text/plain; charset=utf-8`, contenuto markdown con `# Passaggio Veloce` e P.IVA `14688390963` visibili.
- Secondo: `404`.

Stoppa dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/llms.txt/route.ts
git commit -m "feat(seo): /llms.txt endpoint AEO per crawler AI (host-aware)"
```

---

## Task 13: Verifica finale, smoke test integrale, push

**Files:** nessuno modificato (solo verifica).

- [ ] **Step 1: Full typecheck e build dell'app**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS (0 errori)

Run: `pnpm --filter piattaforma build`
Expected: PASS, in output la lista delle route deve includere:
- `/` (Dynamic)
- `/sitemap.xml`
- `/robots.txt`
- `/manifest.webmanifest`
- `/opengraph-image`
- `/twitter-image`
- `/llms.txt`

- [ ] **Step 2: Test suite completa**

Run: `pnpm --filter piattaforma test`
Expected: PASS — tutti i test esistenti continuano a passare + 18 nuovi test (BRAND + jsonLd).

- [ ] **Step 3: Lint**

Run: `pnpm --filter piattaforma lint`
Expected: PASS o solo warning preesistenti (nessun nuovo warning introdotto dai file SEO).

- [ ] **Step 4: Smoke test integrale end-to-end**

Run: `pnpm --filter piattaforma dev` (background)

```bash
# 1. Home con tutto il payload SEO
echo "=== HOME ==="
HOME_HTML=$(curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/)
echo "$HOME_HTML" | grep -c 'lang="it-IT"' # atteso: 1
echo "$HOME_HTML" | grep -c 'application/ld+json' # atteso: >=2 (layout + page)
echo "$HOME_HTML" | grep -c 'og:image' # atteso: >=1
echo "$HOME_HTML" | grep -c 'twitter:card' # atteso: 1
echo "$HOME_HTML" | grep -c 'FAQPage' # atteso: 1
echo "$HOME_HTML" | grep -c 'Passaggio Veloce SRL' # atteso: >=1 (footer address)
echo "$HOME_HTML" | grep -c 'Assago' # atteso: >=1

# 2. Sitemap
echo "=== SITEMAP ==="
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/sitemap.xml | grep -c '<loc>' # atteso: 4

# 3. Robots
echo "=== ROBOTS ==="
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/robots.txt | grep -c 'Sitemap:' # atteso: 1
curl -s -H 'Host: example.vercel.app' http://localhost:3000/robots.txt | grep -c 'Disallow: /' # atteso: 1

# 4. llms.txt
echo "=== LLMS.TXT ==="
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/llms.txt | grep -c '14688390963' # atteso: 1

# 5. Manifest
echo "=== MANIFEST ==="
curl -s http://localhost:3000/manifest.webmanifest | grep -c 'Passaggio Veloce' # atteso: 1

# 6. OG image
echo "=== OG IMAGE ==="
curl -s -o /tmp/og.png -w "%{http_code} %{content_type} %{size_download}\n" http://localhost:3000/opengraph-image
# atteso: 200 image/png >50000

# 7. Gate redirect non rotto
echo "=== GATE REGRESSION ==="
curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: passaggioveloce.it' http://localhost:3000/dashboard
# atteso: 307 o 308 (redirect a /)
```

Expected: tutti i contatori `>= 1` come indicato. Se qualcuno è `0`, debug e fix prima di proseguire.

Stoppa dev server.

- [ ] **Step 5: Verifica regression sui test esistenti**

Run: `pnpm --filter piattaforma test --run`
Expected: tutti i test passano (vecchi + nuovi).

- [ ] **Step 6: Confronta git diff finale**

Run: `git log --oneline main..HEAD`
Expected: ~12 commit della serie `feat(seo): ...` (uno per task).

Run: `git diff --stat main..HEAD`
Expected: ~15 file toccati, ~700-900 righe aggiunte, ~30 righe rimosse.

- [ ] **Step 7: Push e deploy preview**

```bash
git push origin main
```

Vercel auto-deploya. Una volta deployato, l'utente eseguirà la validation post-deploy:

1. Aprire `https://passaggioveloce.it/sitemap.xml` → XML valido
2. Aprire `https://passaggioveloce.it/robots.txt` → policy corretta
3. Aprire `https://passaggioveloce.it/llms.txt` → contenuto markdown
4. Aprire `https://passaggioveloce.it/opengraph-image` → immagine PNG renderizzata
5. [Google Rich Results Test](https://search.google.com/test/rich-results?url=https://passaggioveloce.it) → FAQ, Organization, Service riconosciuti, zero errori
6. [Schema.org Validator](https://validator.schema.org/?url=https://passaggioveloce.it) → zero errori
7. [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) → preview OG corretto con immagine
8. [Meta Sharing Debugger](https://developers.facebook.com/tools/debug/) → preview OG corretto
9. Lighthouse SEO ≥ 95 su https://passaggioveloce.it (mobile + desktop)
10. Google Search Console: submit `https://passaggioveloce.it/sitemap.xml`

Se tutti i check post-deploy passano, il lavoro è completo.

- [ ] **Step 8: Aggiorna piano-implementazione.md (source of truth)**

Aggiungi una riga in `docs/piano-implementazione.md` (sezione progress / completati) con riferimento alla feature SEO/AEO appena chiusa. Format coerente con le voci esistenti del file.

```bash
# Apri il file e aggiungi una riga simile a:
# - [2026-05-24] Landing SEO/AEO fondamenta — metadata, JSON-LD, sitemap/robots host-aware, OG image, llms.txt. Spec in docs/superpowers/specs/2026-05-24-landing-seo-aeo-design.md
git add docs/piano-implementazione.md
git commit -m "docs: registra SEO/AEO landing in piano-implementazione"
git push
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Implementato in |
|---|---|
| `<html lang>` it-IT | Task 5 step 1 |
| metadata espansi (OG/Twitter/canonical/etc.) | Task 5 step 1 (globali) + Task 6 step 1 (home) + Task 7 (legali) |
| `app/sitemap.ts` host-aware | Task 8 |
| `app/robots.ts` host-aware + AI crawlers | Task 9 |
| `src/lib/seo/brand.ts` con dati reali | Task 1 |
| `src/lib/seo/faqItems.ts` condiviso | Task 2 |
| `src/lib/seo/jsonLd.ts` con tutti i generatori | Task 3 |
| `src/lib/seo/JsonLd.tsx` componente | Task 4 |
| JSON-LD globali (Org+WebSite) | Task 5 step 1 |
| JSON-LD home (Service+FAQ+SoftwareApp) | Task 6 step 2 |
| JSON-LD legali (WebPage) | Task 7 |
| OG image `opengraph-image.tsx` | Task 11 |
| `twitter-image.tsx` re-export | Task 11 |
| `manifest.ts` | Task 10 |
| `llms.txt` endpoint | Task 12 |
| Address visibile nel footer | Task 6 step 6 |
| Definizione AEO esplicita nel hero | Task 6 step 3 |
| ID semantici sulle sezioni | Task 6 step 4 |
| FAQ_ITEMS riusato in render+JSON-LD+llms.txt | Task 2 + Task 6 step 5 + Task 12 |
| Test pre-merge (curl checks) | Task 13 |

Tutte le voci della spec hanno un task.

**2. Placeholder scan**

Cercati pattern "TBD", "TODO", "implement later", "fill in details", "Add appropriate error handling": nessuna occorrenza nel piano. Tutti i blocchi codice sono completi e copy-pastabili.

**3. Type consistency**

- `BRAND.vatIdSchema` (Task 1) ↔ `organizationJsonLd().vatID` usa `BRAND.vatIdSchema` (Task 3) ✓
- `siteUrl()` (Task 1) ↔ usato in Task 6 step 6 + Task 7 ✓
- `FAQ_ITEMS` shape `{ q, a }[]` (Task 2) ↔ `faqJsonLd(items)` accetta `readonly FaqItem[]` (Task 3) ✓
- `ORGANIZATION_ID` esportato (Task 3) ↔ usato per `publisher: { '@id': ORGANIZATION_ID }` (Task 3) ✓
- `webPageJsonLd({ url, name, description, lastModified? })` signature (Task 3) ↔ chiamato in Task 6 step 2 + Task 7 ✓
- `JsonLd` props `{ data: object | object[] }` (Task 4) ↔ array passato in Task 5+6, singolo in Task 7 ✓

**4. Edge cases coperti**

- ImageResponse fallisce nel leggere SVG → fallback grazioso (try/catch, no logo)
- Host non-gated → sitemap vuoto, robots disallow totale, llms.txt 404 (fail-safe)
- `force-dynamic` esplicito ovunque per evitare la quirk Vercel
- `BRAND.sameAs` vuoto inizialmente (non si rompe lo schema)

---

## Out of scope (futuro)

Confermato dall'utente, NON in questa iterazione:
- Pillar pages B2C `/guide/come-fare-passaggio-di-proprieta`, `/guide/costi-2026`, `/guide/documenti-necessari`
- Local SEO con pagine `/agenzie-pratiche-auto/[citta]`
- Web Vitals tuning (LCP/CLS/INP)
- Google Business Profile + Trustpilot
- Hreflang multilingua

Pianificare come PR separate dopo aver misurato l'80% di gain con questa iterazione.
