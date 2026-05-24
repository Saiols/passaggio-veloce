# Landing SEO/AEO — Fondamenta tecniche

**Data**: 2026-05-24
**Autore**: Francesco Sioli (CTO) + Claude
**Scope**: solo fondamenta tecniche SEO + AEO sulla landing pubblica `passaggioveloce.it` (gate host-based già attivo). Niente content guides B2C né local SEO in questa iterazione — pianificati come step successivi.
**Stato**: design approvato, pronto per writing-plans.

## Obiettivo

Portare la landing pubblica `passaggioveloce.it` dallo stato attuale ("default Next.js, metadata minimale") a uno stato production-grade per SEO classico e AEO (Answer Engine Optimization), così da massimizzare il punteggio Lighthouse SEO, l'indicizzazione Google e la citabilità da parte di LLM/AI assistants per query relative a passaggi di proprietà auto e broker pratiche.

Target: Lighthouse SEO ≥ 95, JSON-LD validi sul Rich Results Test, OpenGraph/Twitter preview corretti su LinkedIn/X/WhatsApp, indicizzazione completa solo del dominio canonico.

## Audit stato attuale (gap rilevati)

| Area | Stato | Impatto |
|---|---|---|
| `<html lang>` | `"en"` (errato) | Penalizza geo/lang targeting IT |
| `metadata` in `app/layout.tsx` | solo `title` + `description` | Nessun OG/Twitter/canonical/`metadataBase`/robots/keywords/alternates |
| `app/sitemap.ts` | mancante | Niente discovery automatica per Google |
| `app/robots.ts` | mancante | Crawler vanno a tentoni; vercel.app indicizzabile = duplicate content |
| JSON-LD structured data | zero | Niente rich snippets, niente FAQ box in SERP, basso E-E-A-T |
| OpenGraph image | nessuna | Share su social = anteprime nude |
| `llms.txt` (AEO) | mancante | I crawler AI non hanno una fonte canonica per il prodotto |
| `manifest.webmanifest` | mancante | Lighthouse PWA/SEO ne tiene conto |
| FAQ markup semantico | `<details>` (ok a11y) ma niente `FAQPage` schema | Persa la rich result più impattante |
| Definizione esplicita "PV è il…" | mancante nel hero | AEO predilige pattern *"X is the Y that…"* |
| Address visibile + microdata | assenti | Local SEO e trust E-E-A-T sotto-utilizzati |

## Decisioni di scope (dalla brainstorming session)

1. **Target SEO**: B2B (dealer + agenzie) prioritario; contenuti B2C rinviati a fase successiva.
2. **Sessione attuale**: solo **fondamenta tecniche** (no /guide, no local SEO).
3. **Dati esposti in Organization schema**: ragione sociale, P.IVA, sede legale, email, telefono. Profili social: campo presente ma vuoto fino ad attivazione.
4. **Canonical**: solo `passaggioveloce.it` indicizzato. Tutto il resto (vercel.app, preview URL) `noindex` totale via `robots.ts` host-aware.
5. **Approccio architetturale**: co-located metadata per route + libreria condivisa `src/lib/seo/` (no `next-seo`, native Next 16 Metadata API).

## Architettura (Approach B)

```
apps/piattaforma/src/
├── app/
│   ├── layout.tsx              [MOD]   lang it-IT, metadataBase, title template,
│   │                                   OG/Twitter defaults, icons, JSON-LD globali
│   │                                   (Organization + WebSite)
│   ├── page.tsx                [MOD]   metadata override home, JSON-LD
│   │                                   (Service + FAQPage + SoftwareApplication),
│   │                                   estrai FAQ_ITEMS, ritocca H1 e address footer
│   ├── privacy/page.tsx        [MOD]   metadata override + JSON-LD WebPage
│   ├── cookie/page.tsx         [MOD]   metadata override + JSON-LD WebPage
│   ├── termini/page.tsx        [MOD]   metadata override + JSON-LD WebPage
│   ├── sitemap.ts              [NEW]   sitemap dinamico host-aware
│   ├── robots.ts               [NEW]   robots dinamico host-aware
│   ├── manifest.ts             [NEW]   Web App Manifest minimo
│   ├── opengraph-image.tsx     [NEW]   OG programmatica via ImageResponse
│   ├── twitter-image.tsx       [NEW]   ri-export di opengraph-image
│   └── llms.txt/route.ts       [NEW]   endpoint text/plain per crawler AI
└── lib/seo/                    [NEW]
    ├── brand.ts                        costanti immutabili (BRAND_*)
    ├── faqItems.ts                     FAQ canoniche (usate da home + llms.txt)
    ├── jsonLd.ts                       generatori JSON-LD type-safe
    └── JsonLd.tsx                      componente React di iniezione
```

Nessuna modifica al gate `landing-gate.ts` e ai componenti di brand esistenti.

## Componenti

### `src/lib/seo/brand.ts`

Costanti `as const` con tutti i dati anagrafici e brand. Campi a placeholder TODO che l'utente compila prima del go-live: `vatId`, `taxId`, `phone`, `address.{street,city,postalCode,region}`, `sameAs[]`. Mai dati hardcoded altrove nel codice — single source of truth.

### `src/lib/seo/jsonLd.ts`

Funzioni pure che ritornano oggetti JSON-LD:
- `organizationJsonLd()` → `@type: ['Organization', 'ProfessionalService']` con `address`, `contactPoint`, `taxID`, `vatID`, `founder`, `sameAs`, `logo`, `image`. `@id: "${BRAND.url}/#organization"` (riferibile da altri schema).
- `websiteJsonLd()` → `WebSite` con `potentialAction: SearchAction` (future-proof per Sitelinks search box), `publisher: { @id: organizationId }`.
- `webPageJsonLd({ url, name, description, lastModified })` → `WebPage` generico per pagine legali.
- `faqJsonLd(items: { q: string; a: string }[])` → `FAQPage` con `mainEntity` array di `Question`/`Answer`.
- `serviceJsonLd()` → `Service` per "broker digitale passaggi di proprietà" con `provider: { @id: organizationId }`, `areaServed: { @type: Country, name: 'IT' }`, `serviceType`, `audience: { @type: BusinessAudience }`.
- `breadcrumbJsonLd(items: { name: string; url: string }[])` → `BreadcrumbList`. Helper pronto per pagine future, sulla home non viene usato (è root).
- `softwareApplicationJsonLd()` → `SoftwareApplication` con `applicationCategory: 'BusinessApplication'`, `operatingSystem: 'Web'`, `offers: { price: 0, priceCurrency: 'EUR' }` (registrazione gratuita).

Helper `siteUrl(path = '/')` che ritorna `BRAND.url + path` normalizzato.

### `src/lib/seo/JsonLd.tsx`

Componente React server-component:
```tsx
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
```
Escape `<` → `<` per safety (XSS-proof anche se mai entrasse user input).

### `app/layout.tsx`

Modifiche:
1. `<html lang="it-IT" dir="ltr">` (era `lang="en"`).
2. `metadata` espanso: `metadataBase: new URL(BRAND.url)`, `title: { default, template: '%s · Passaggio Veloce' }`, `description` keyword-rich 150–160 char, `applicationName`, `keywords[]`, `authors`, `creator`, `publisher`, `formatDetection`, `robots` (con `googleBot` granulare), `alternates: { canonical: '/', languages: { 'it-IT': '/' } }`, `openGraph` (type website, locale it_IT, siteName, immagine `/opengraph-image`), `twitter` (`summary_large_image`), `icons`.
3. Nel `<body>`: `<JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />` (presenti su ogni pagina).
4. Meta tag extra non gestiti dall'API: `<meta name="theme-color" content="#0b1e3a" />`, `<meta name="apple-mobile-web-app-title" content="Passaggio Veloce" />`, `<link rel="alternate" type="text/llms" href="/llms.txt" />`.

### `app/page.tsx`

Modifiche additive (zero refactor visivo):
1. Export `metadata` con title verboso keyword-rich (es. *"Passaggio Veloce — Broker digitale per passaggi di proprietà auto, dealer e agenzie"*) e description focalizzata sul valore B2B.
2. Importare `FAQ_ITEMS` da `@/lib/seo/faqItems` (estratto in modulo dedicato così è condiviso anche con `llms.txt`). Usato sia per renderizzare i `<FAQ>` componenti (`.map`) sia passato a `faqJsonLd(FAQ_ITEMS)`. Single source of truth: cambi una FAQ in un solo posto, propaga ovunque.
3. Subito dopo `<SiteHeader />`: `<JsonLd data={[serviceJsonLd(), faqJsonLd(FAQ_ITEMS), softwareApplicationJsonLd()]} />`.
4. Hero: aggiungere una frase definitoria esplicita *"Passaggio Veloce è il broker digitale italiano che connette dealer e agenzie pratiche auto in una piattaforma unica."* nel `<p>` sotto l'H1 (sostituisce/raffina la copy esistente — AEO predilige pattern *"X is the Y that Z"*).
5. Sezioni: aggiungere `id` semantici (`#come-funziona`, `#per-dealer`, `#per-agenzie`, `#tutele`, `#faq`) e `aria-labelledby` legato al rispettivo H2. Migliora a11y e dà ancore stabili per AEO.
6. Footer: nuovo blocco `<address>` con ragione sociale, sede legale, P.IVA (formato microdata-friendly), link mail. Boost trust + reinforce Organization schema.

### `app/privacy/page.tsx`, `app/cookie/page.tsx`, `app/termini/page.tsx`

Per ognuna:
- Export `metadata` con title e description specifici (es. `"Privacy Policy"` → diventa `"Privacy Policy · Passaggio Veloce"` via template).
- `<JsonLd data={webPageJsonLd({ url, name, description })} />`.
- Niente modifiche al contenuto.

### `app/sitemap.ts`

```ts
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';

// force-dynamic esplicito: il pattern del progetto ha gi� dovuto aggiungere
// questa direttiva altrove (es. /api/version) per via dei Vercel Sensitive
// env vars; meglio non affidarsi all'inferenza automatica da headers().
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host');
  if (!isGatedHost(host)) return []; // niente sitemap su vercel.app/preview

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

### `app/robots.ts`

```ts
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isGatedHost } from '@/lib/landing-gate';
import { BRAND } from '@/lib/seo/brand';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host');

  if (!isGatedHost(host)) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  const disallowApp = [
    '/api/', '/admin/', '/dashboard/', '/inbox/', '/pratiche/', '/wallet/',
    '/profilo/', '/team/', '/notifiche/', '/orari/', '/affiliazione/',
    '/login', '/register', '/verify-email', '/reset-password', '/invito/',
  ];

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: disallowApp },
      // AI crawlers buoni esplicitamente ammessi sulla vetrina
      { userAgent: ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'], allow: '/', disallow: disallowApp },
    ],
    sitemap: `${BRAND.url}/sitemap.xml`,
  };
}
```

Nota: `host` (estensione Yandex) non � supportato dal tipo `MetadataRoute.Robots` di Next 16, quindi viene omesso. Per Google il `Sitemap:` pointer + `metadataBase` sono sufficienti per la canonicalizzazione.

### `app/manifest.ts`

Web App Manifest minimo: `name: 'Passaggio Veloce'`, `short_name: 'PV'`, `description`, `start_url: '/'`, `display: 'standalone'`, `theme_color: '#0b1e3a'`, `background_color: '#ffffff'`, `icons` da `/brand/icon.svg` (any) + un PNG 512×512 generato a build (o se troppo costoso, lasciamo solo SVG).

### `app/opengraph-image.tsx`

Edge runtime, `next/og` `ImageResponse` 1200×630:
- Background gradient `#0b1e3a` → `#1e3a8a`
- Logo bianco SVG inline (letto da `public/brand/logo-mono-white.svg` via `fs.readFileSync` nell'edge — alternativa: SVG inline duplicato per evitare fs)
- Titolo "Passaggio Veloce" (~80px bold, bianco)
- Sottotitolo "Broker digitale per passaggi di proprietà auto" (~36px, `#b8cdea`)
- Badge top-left: "passaggioveloce.it" (mono, opacità 0.6)
- Pill bottom-right arancione `#f97316`: "ACI · GDPR · SDI"

### `app/twitter-image.tsx`

Re-export 1-riga di `opengraph-image` (Next 16 cerca esplicitamente `twitter-image.*` separato).

### `app/llms.txt/route.ts`

Route handler che ritorna `text/plain` (header `Content-Type: text/plain; charset=utf-8`). `export const dynamic = 'force-dynamic'`. Host-aware come sitemap/robots: su host non-gated risponde `404` (o testo vuoto `204`), su `passaggioveloce.it` risponde il contenuto.

Il contenuto è generato a runtime a partire da `BRAND` (lib/seo/brand.ts) e da `FAQ_ITEMS` (lib/seo/faqItems.ts — estratto dalla home come single source of truth). Struttura template (i campi `${...}` sono sostituiti dai valori reali):

```
# Passaggio Veloce
> Broker digitale italiano per passaggi di proprietà veicoli; connette
> dealer auto e agenzie pratiche in un'unica piattaforma SaaS conforme
> ACI, GDPR e SDI.

## Identità
- Ragione sociale: ${BRAND.legalName}
- Sito: ${BRAND.url}
- Email: ${BRAND.email}
- Sede: ${BRAND.address.street}, ${BRAND.address.postalCode} ${BRAND.address.city} (${BRAND.address.region})
- P.IVA: ${BRAND.vatId}

## Cosa fa
[1 paragrafo descrittivo hardcoded — vedi prossima iterazione]

## A chi è rivolto
- Dealer e concessionarie auto
- Agenzie pratiche auto

## Come funziona (3 step)
1. Carica i documenti (libretto, CI, CF) — l'IA verifica completezza.
2. Distribuzione automatica alle agenzie partner della zona, prima accetta vince.
3. Firma in agenzia, accredito wallet automatico, fattura SDI emessa.

## FAQ canoniche
${FAQ_ITEMS.map(({q, a}) => `Q: ${q}\nA: ${a}\n`).join('\n')}

## Risorse
- ${BRAND.url}/privacy
- ${BRAND.url}/cookie
- ${BRAND.url}/termini
```

Per estrarre `FAQ_ITEMS` in un modulo condiviso (così sia `page.tsx` che `llms.txt/route.ts` lo usano), aggiungiamo `src/lib/seo/faqItems.ts` con `export const FAQ_ITEMS: readonly { q: string; a: string }[]`.

## Data flow

```
Request
  ├─→ middleware (gate redirect esistente, invariato)
  └─→ app/layout.tsx
        ├─ metadata (Next 16 Metadata API renderizza <head>)
        ├─ <html lang="it-IT">
        ├─ <body>
        │   ├─ <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} /> ← sempre
        │   ├─ <CookieBanner />
        │   └─ {children}
        │       └─ page.tsx (route-specific)
        │           ├─ metadata (override layout default)
        │           └─ <JsonLd data={[serviceJsonLd(), faqJsonLd(...), softwareApplicationJsonLd()]} />
        │
        └─ (separato) /sitemap.xml, /robots.txt, /opengraph-image,
                       /twitter-image, /manifest.webmanifest, /llms.txt
            → tutti host-aware via headers()
```

## Error handling

- `headers()` può lanciare in static rendering — già `force-dynamic` implicito perché la home usa `headers()`. Per le route nuove (sitemap, robots, llms.txt) Next forza dynamic automaticamente per via di `headers()`.
- OG image: `ImageResponse` può fallire silenziosamente; fallback a `/brand/logo-primary.svg` come immagine statica nel `metadata.openGraph.images` come secondo elemento, così se l'edge fallisce il social ha comunque un'immagine.
- JSON-LD: i generatori sono funzioni pure senza I/O — non possono fallire. Se un campo TODO non è popolato in `brand.ts`, lo schema ha valori placeholder che Google flagga come invalid → captured nel test di pre-deploy.
- `robots.ts` su host non-gated: ritorna `disallow: /` totale (fail-safe: se mai un host nuovo non riconosciuto venisse aggiunto, non si indicizza per errore).

## Testing

### Pre-merge (locale)

1. `pnpm --filter piattaforma build` → zero errori, zero warning su metadata.
2. `pnpm --filter piattaforma dev` + curl checks:
   - `curl -H 'Host: passaggioveloce.it' http://localhost:3000/sitemap.xml` → 4 URL canonici
   - `curl -H 'Host: passaggioveloce.it' http://localhost:3000/robots.txt` → Allow + Sitemap pointer corretti
   - `curl -H 'Host: vercel.app' http://localhost:3000/robots.txt` → `Disallow: /`
   - `curl -H 'Host: passaggioveloce.it' http://localhost:3000/llms.txt` → testo plain valido
   - `curl http://localhost:3000/manifest.webmanifest` → JSON valido
   - `curl -H 'Host: passaggioveloce.it' http://localhost:3000/` | grep -E '(<html lang|application/ld\+json|og:image|twitter:card)' → tutti presenti
   - `curl -I http://localhost:3000/opengraph-image` → `200`, `Content-Type: image/png`, ~50–150KB
3. Snapshot test sui generatori `jsonLd`: verifica struttura attesa con `JSON.stringify` deterministico (campi richiesti presenti, `@context`/`@type` corretti).

### Post-deploy (su passaggioveloce.it prod)

Validatori esterni (l'utente clicca):
- [Google Rich Results Test](https://search.google.com/test/rich-results?url=https://passaggioveloce.it) → FAQ + Organization + Service riconosciuti
- [Schema.org Validator](https://validator.schema.org/?url=https://passaggioveloce.it) → zero errori
- [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) → preview OG corretto
- [Meta Sharing Debugger](https://developers.facebook.com/tools/debug/) → preview OG corretto
- [X Cards Validator](https://cards-dev.twitter.com/validator) → summary_large_image corretto
- Lighthouse SEO ≥ 95 (mobile + desktop), Best Practices ≥ 95
- Google Search Console: submit sitemap, verificare 0 errori, verificare "Pagina indicizzata" entro 7 giorni

### Regression

- Il gate landing-only continua a funzionare: `curl -I -H 'Host: passaggioveloce.it' http://localhost:3000/dashboard` → 307 redirect (invariato).
- I componenti del brand (`SiteHeader`, `SiteChatbot`, `CookieBanner`) restano invariati.
- `pnpm typecheck` (se presente) passa.

## Out of scope (futuro)

- Pagine /guide B2C ("come fare passaggio di proprietà", "costi 2026", "documenti necessari") — fase 2.
- Pagine /agenzie-pratiche-auto/[città] per local SEO — fase 3.
- Google Business Profile e Trustpilot/recensioni — fase 2.
- Hreflang multilingua (it/en) — solo se internazionalizziamo.
- Web Vitals tuning (LCP/CLS/INP) — separato, da fare con Chrome DevTools.
- AMP / Speed insights tuning — non prioritario nel 2026.
- Backlink strategy, outreach, content marketing — non tecnico.

## Dati anagrafici (confermati dall'utente, 2026-05-24)

Da inserire direttamente in `src/lib/seo/brand.ts`, niente placeholder:

| Campo | Valore |
|---|---|
| `legalName` | `Passaggio Veloce SRL` |
| `vatId` | `14688390963` (formato schema.org: `IT14688390963`) |
| `taxId` | `14688390963` (stesso della P.IVA — standard SRL italiane) |
| `phone` | `+39 3462877310` (formato E.164 per ContactPoint) |
| `address.street` | `Via delle Querce 5` |
| `address.postalCode` | `20057` |
| `address.city` | `Assago` |
| `address.region` | `MI` (Milano) |
| `address.countryCode` | `IT` |
| `email` | `info@passaggioveloce.it` (già esposta nelle CTA) |
| `sameAs` | `[]` (vuoto fino ad attivazione social) |
| `founders` | `['Andrea Saino', 'Francesco Sioli']` |

## Riferimenti

- Next.js 16 Metadata API: https://nextjs.org/docs/app/api-reference/file-conventions/metadata
- Schema.org Organization: https://schema.org/Organization
- Schema.org FAQPage: https://schema.org/FAQPage
- Schema.org Service: https://schema.org/Service
- llms.txt proposal: https://llmstxt.org/
- Google Search Central — Structured Data: https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
