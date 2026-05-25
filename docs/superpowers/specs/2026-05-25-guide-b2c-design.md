# Guide B2C (Fase 2 SEO) — Design

**Data**: 2026-05-25
**Autore**: Francesco Sioli (CTO) + Claude
**Scope**: 3 pillar pages B2C + hub `/guide` per intercettare traffico organico su query "passaggio di proprietà auto" e adiacenti, con CTA dual-track che riportano valore al business B2B.
**Spec di partenza**: vedi `docs/superpowers/specs/2026-05-24-landing-seo-aeo-design.md` § "Out of scope (futuro)" — riga "Pagine /guide B2C ... — fase 2."
**Stato**: design approvato, pronto per writing-plans.

## Obiettivo

Costruire una sezione `/guide` con 3 articoli pillar evergreen che:
- Intercettino query B2C ad alto volume in Italia (es. "come fare passaggio di proprietà auto", "costo passaggio proprietà 2026", "documenti necessari passaggio auto")
- Massimizzino il punteggio Rich Results (HowTo, Article, FAQPage, BreadcrumbList)
- Convertano via CTA dual-track: principale B2B ("se sei dealer/agenzia →"), secondario B2C educational ("chiedi al tuo dealer →") che educa il mercato e produce ambassador effect
- Riusino al 100% la foundation SEO/AEO di Fase 1 (BRAND, JSON-LD generators, JsonLdScript component, host-aware gate)

Target misurabili (post-deploy):
- 4 nuove URL in sitemap.xml
- Tutti i pillar passano Google Rich Results Test senza errori
- Lighthouse SEO ≥ 95 per ogni pillar
- Reading time visibile in pagina (signal a Google + UX)

## Decisioni di scope (dalla brainstorming session 2026-05-25)

1. **Drafting**: Claude scrive contenuto completo SEO-optimized, Francesco approva. Numeri 2026 verificati con domain knowledge, da rifinire in revisione se necessario.
2. **URL strategy**: tutte evergreen, anno solo in title/H1/contenuto. URL stabili = link equity cumulativa.
3. **Slug docs**: `documenti-necessari` (keyword-rich) anziché `documenti`.
4. **CTA**: dual-track B2B principale + B2C educational, NO email capture (richiederebbe backend non in scope).
5. **Architettura**: plain React server components, no MDX, no CMS.
6. **Internal linking**: hub → pillar + pillar ↔ pillar via `otherGuides(currentSlug)`.

## Architettura

```
apps/piattaforma/src/
├── app/guide/                                       [NEW dir]
│   ├── page.tsx                                     [NEW]  hub
│   ├── come-fare-passaggio-di-proprieta/page.tsx    [NEW]  pillar 1 (HowTo)
│   ├── costi-passaggio-proprieta/page.tsx           [NEW]  pillar 2 (Article + CostsTable)
│   └── documenti-necessari/page.tsx                 [NEW]  pillar 3 (Article + Checklist)
├── components/guide/                                [NEW dir]
│   ├── Callout.tsx                                  [NEW]
│   ├── KeyTakeaway.tsx                              [NEW]
│   ├── CostsTable.tsx                               [NEW]
│   ├── GuideFooterCta.tsx                           [NEW]
│   ├── RelatedGuides.tsx                            [NEW]
│   └── Breadcrumbs.tsx                              [NEW]
├── lib/seo/
│   ├── guides.ts                                    [NEW]  metadata + helpers
│   ├── jsonLd.ts                                    [MOD]  + articleJsonLd, howToJsonLd, collectionPageJsonLd
│   └── jsonLd.test.ts                               [MOD]  + 3 nuovi describe
├── app/sitemap.ts                                   [MOD]  iterare GUIDES
├── app/llms.txt/route.ts                            [MOD]  + sezione ## Guide
├── lib/landing-gate.ts                              [MOD]  prefix-check per /guide
└── components/site-header.tsx                       [MOD]  + link "Guide"
```

URL finali (canonical):
- `https://passaggioveloce.it/guide`
- `https://passaggioveloce.it/guide/come-fare-passaggio-di-proprieta`
- `https://passaggioveloce.it/guide/costi-passaggio-proprieta`
- `https://passaggioveloce.it/guide/documenti-necessari`

## Componenti

### `src/lib/seo/guides.ts` (single source of truth)

```ts
export type GuideMeta = {
  slug: string;                   // 'come-fare-passaggio-di-proprieta'
  url: string;                    // '/guide/come-fare-passaggio-di-proprieta'
  title: string;                  // <h1> + <title>
  metaDescription: string;        // ~155 char keyword-rich
  shortTitle: string;             // per breadcrumb e card RelatedGuides
  category: 'procedura' | 'costi' | 'documenti';
  jsonLdType: 'HowTo' | 'Article';
  lastModified: string;           // YYYY-MM-DD
  readingTimeMin: number;         // mostrato in UI + signal SEO
};

export const GUIDES: readonly GuideMeta[] = [
  {
    slug: 'come-fare-passaggio-di-proprieta',
    url: '/guide/come-fare-passaggio-di-proprieta',
    title: 'Come fare il passaggio di proprietà di un\'auto: guida 2026',
    metaDescription: 'Guida completa al passaggio di proprietà di un veicolo in Italia: 5 step, dove andare, tempi e costi, errori comuni. Aggiornata al 2026.',
    shortTitle: 'Come fare il passaggio',
    category: 'procedura',
    jsonLdType: 'HowTo',
    lastModified: '2026-05-25',
    readingTimeMin: 8,
  },
  {
    slug: 'costi-passaggio-proprieta',
    url: '/guide/costi-passaggio-proprieta',
    title: 'Costi del passaggio di proprietà auto 2026: tabella completa',
    metaDescription: 'Quanto costa il passaggio di proprietà di un\'auto nel 2026: IPT, emolumenti ACI, bollo, marche da bollo. Tabella per provincia e potenza.',
    shortTitle: 'Costi 2026',
    category: 'costi',
    jsonLdType: 'Article',
    lastModified: '2026-05-25',
    readingTimeMin: 7,
  },
  {
    slug: 'documenti-necessari',
    url: '/guide/documenti-necessari',
    title: 'Documenti necessari per il passaggio di proprietà auto',
    metaDescription: 'Checklist completa dei documenti per venditore e acquirente: CI, codice fiscale, libretto, certificato di proprietà digitale. Casi speciali inclusi.',
    shortTitle: 'Documenti',
    category: 'documenti',
    jsonLdType: 'Article',
    lastModified: '2026-05-25',
    readingTimeMin: 6,
  },
] as const;

export function getGuide(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function otherGuides(currentSlug: string): readonly GuideMeta[] {
  return GUIDES.filter((g) => g.slug !== currentSlug);
}
```

Consumatori: hub page, ogni pillar, `app/sitemap.ts`, `RelatedGuides` component, `app/llms.txt/route.ts`.

### Componenti `src/components/guide/`

**`Callout.tsx`** — box informativo. Props: `variant: 'info' | 'warning' | 'tip'`, `title?: string`, `children`. Stili distinti per variante (info=`pv-navy-100`, warning=`pv-orange-50`, tip=`pv-green-50`). Icona SVG inline appropriata.

**`KeyTakeaway.tsx`** — riassunto top-of-article. Props: `items: readonly string[]`. Box prominente con background `pv-navy-50`, badge "TL;DR" + lista puntata. AEO-friendly perché concentra le risposte canoniche.

**`CostsTable.tsx`** — tabella riusabile. Props: `rows: readonly { voce: string; importo: string; note?: string }[]`, `total?: string`. Markup `<table>` semantico con `<thead>`/`<tbody>`/`<tfoot>`. Mobile-friendly via `overflow-x-auto`.

**`GuideFooterCta.tsx`** — il dual-track confermato. Server component perché consuma `headers()` per `isGatedHost`:
```tsx
async function GuideFooterCta() {
  const host = (await headers()).get('host');
  const landingOnly = isGatedHost(host);
  // box principale: B2B → /register o mailto
  // box secondario: B2C educational, no link
}
```

**`RelatedGuides.tsx`** — Props: `currentSlug: string`. Internamente chiama `otherGuides(currentSlug)`. Render: grid di card con titolo + descrizione + reading time + link.

**`Breadcrumbs.tsx`** — Props: `items: { name: string; url: string }[]`. Render visivo (nav + ol semantico) + inietta `breadcrumbJsonLd` (generatore già esistente da T3) via `<JsonLd>`.

### Nuovi generatori JSON-LD in `src/lib/seo/jsonLd.ts`

**`articleJsonLd(opts)`**
```ts
export function articleJsonLd(opts: {
  url: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
  imageUrl?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article' as const,
    '@id': opts.url,
    headline: opts.headline,
    description: opts.description,
    image: opts.imageUrl ?? siteUrl('/opengraph-image'),
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    author: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
    inLanguage: 'it-IT',
    isPartOf: { '@id': WEBSITE_ID },
    mainEntityOfPage: opts.url,
  };
}
```

**`howToJsonLd(opts)`**
```ts
export function howToJsonLd(opts: {
  url: string;
  name: string;
  description: string;
  totalTime: string;                // ISO 8601 duration es. 'PT2D' (2 giorni)
  estimatedCostEUR?: string;        // es. '50-150'
  supplies?: readonly string[];     // documenti necessari
  tools?: readonly string[];        // strumenti (SPID, ecc.)
  steps: readonly { title: string; body: string }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo' as const,
    '@id': opts.url,
    name: opts.name,
    description: opts.description,
    totalTime: opts.totalTime,
    ...(opts.estimatedCostEUR && {
      estimatedCost: {
        '@type': 'MonetaryAmount' as const,
        currency: 'EUR',
        value: opts.estimatedCostEUR,
      },
    }),
    ...(opts.supplies && {
      supply: opts.supplies.map((name) => ({ '@type': 'HowToSupply' as const, name })),
    }),
    ...(opts.tools && {
      tool: opts.tools.map((name) => ({ '@type': 'HowToTool' as const, name })),
    }),
    step: opts.steps.map((s, i) => ({
      '@type': 'HowToStep' as const,
      position: i + 1,
      name: s.title,
      text: s.body,
      url: `${opts.url}#step-${i + 1}`,
    })),
    inLanguage: 'it-IT',
    isPartOf: { '@id': WEBSITE_ID },
  };
}
```

**`collectionPageJsonLd(opts)`** — per il hub `/guide`:
```ts
export function collectionPageJsonLd(opts: {
  url: string;
  name: string;
  description: string;
  items: readonly { url: string; name: string }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage' as const,
    '@id': opts.url,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    inLanguage: 'it-IT',
    isPartOf: { '@id': WEBSITE_ID },
    mainEntity: {
      '@type': 'ItemList' as const,
      itemListElement: opts.items.map((item, i) => ({
        '@type': 'ListItem' as const,
        position: i + 1,
        url: item.url,
        name: item.name,
      })),
    },
  };
}
```

## Contenuto delle 3 pillar

### Pillar 1: `/guide/come-fare-passaggio-di-proprieta` (~2500 parole)

JSON-LD bundle: `[breadcrumb, howTo, faq]`.

Struttura:
1. **Hero** — H1 (dal `guides.ts`), sottotitolo, reading time
2. **KeyTakeaway** — 5 punti chiave:
   - Tempo medio: 2 giorni lavorativi
   - Costo: 50–150€ (esclusi onorari)
   - Si fa: ACI, agenzia pratiche, notaio, online via SPID
   - Documenti chiave: libretto/CdC, CI, CF di entrambi
   - Entro 60 giorni dall'atto, altrimenti sanzione
3. **H2: Cos'è il passaggio di proprietà** — definizione legale (D.Lgs. 285/1992 art. 94), riferimento a Certificato di Proprietà Digitale (DT da nov 2015)
4. **H2: I 5 step (HowToStep)**:
   - Step 1: Accordo tra parti + atto di vendita
   - Step 2: Raccolta documenti
   - Step 3: Autenticazione firma (ACI/Comune/Notaio)
   - Step 4: Registrazione PRA — pagamento IPT + emolumenti
   - Step 5: Aggiornamento Motorizzazione (automatico dal STA dal 2015)
5. **H2: Dove andare** — tabella comparativa ACI / agenzia / notaio / online (pro, contro, tempi, costo medio)
6. **H2: Tempi realistici** — 1–3 giorni se documenti in ordine, fino a 2 settimane con casi speciali
7. **H2: Errori comuni** — 5 errori (es. firma non autenticata, IPT pagata in regione errata, ecc.)
8. **H2: FAQ topic-specific** — 5 domande (es. "Posso fare il passaggio online?", "Se compro un'auto da una società?", ecc.)
9. **GuideFooterCta**
10. **RelatedGuides**

### Pillar 2: `/guide/costi-passaggio-proprieta` (~2000 parole)

JSON-LD bundle: `[breadcrumb, article, faq]`.

Struttura:
1. **Hero** + reading time
2. **KeyTakeaway** — 4 punti:
   - Range totale 2026: ~50€ (auto piccola, Bolzano) – ~250€ (SUV alto, Genova)
   - Voce più variabile: IPT (provinciale)
   - Sempre fissi: marche da bollo (16€×2) e emolumenti ACI (~27€)
   - Risparmi: fare online vs agenzia (–50/100€)
3. **H2: Costo totale stimato 2026 (tabella riepilogo con range)**
4. **CostsTable principale** con righe:
   - IPT (variabile per provincia e kW): 150–200€
   - Emolumenti ACI: 27€
   - Bollo passaggio: 32€
   - Marche da bollo (×2): 32€
   - Diritti motorizzazione: 10,20€
   - Onorario agenzia (opzionale): 50–100€
5. **H2: IPT per provincia** — tabella top 10 città (Roma, Milano, Napoli, Torino, Bologna, Firenze, Genova, Palermo, Bari, Verona) con tariffa kW e calcolo esempio
6. **H2: Cosa influenza il costo** — kW del veicolo, residenza acquirente, tipo veicolo (auto/moto/storica), ecologico (Euro 6 ha sconti in alcune regioni)
7. **H2: Come risparmiare** — fare online via STA, scegliere provincia residenza, evitare onorari agenzia se documenti semplici
8. **H2: FAQ topic-specific** — 5 domande
9. **GuideFooterCta**
10. **RelatedGuides**

### Pillar 3: `/guide/documenti-necessari` (~1800 parole)

JSON-LD bundle: `[breadcrumb, article, faq]`.

Struttura:
1. **Hero** + reading time
2. **KeyTakeaway** — 4 punti:
   - Documenti base venditore: CI + CF + libretto + CdP digitale
   - Documenti base acquirente: CI + CF + residenza
   - Atto di vendita autenticato (ACI/Comune/Notaio)
   - 60 giorni dall'atto per registrarlo, altrimenti sanzione
3. **H2: Documenti del venditore** (lista dettagliata con Callout di warning su documenti scaduti)
4. **H2: Documenti dell'acquirente** (idem)
5. **H2: Documenti aggiuntivi per casi speciali**:
   - Intestazione/cessione a società (visura camerale, delega)
   - Eredità (atto di successione, accettazione eredità)
   - Leasing (lettera liberatoria società leasing)
   - Veicolo fuori uso o storico (collaudo, libretti speciali)
6. **H2: Dichiarazione di vendita autenticata** (cos'è, dove farla, costi)
7. **H2: Checklist scaricabile** — riassunto numerato (no PDF download in questa fase — solo blocco visuale con tutti gli item)
8. **H2: FAQ topic-specific** — 5 domande
9. **GuideFooterCta**
10. **RelatedGuides**

Tone: professionale ma accessibile, "tu" informale (coerente con la home), italiano standard, niente inglesismi.

## Hub `/guide`

JSON-LD: `[breadcrumb, collectionPage]`.

Struttura:
1. **Hero**: "Tutto quello che devi sapere sui passaggi di proprietà" + sottotitolo "Guide chiare e aggiornate per privati, dealer e agenzie"
2. **Grid 3 card** (auto-generata da `GUIDES`):
   - Card con title, metaDescription, reading time, badge categoria, CTA "Leggi la guida"
3. **Sezione "Perché scegliere un broker digitale"** — 3 micro-bullet che linkano alla home/registrazione (soft sell)
4. **GuideFooterCta**

Metadata:
- title: "Guide ai passaggi di proprietà auto" (template aggiunge "· Passaggio Veloce")
- description: "Guide complete e aggiornate sui passaggi di proprietà: come fare, costi, documenti. Utile per privati, dealer e agenzie pratiche."
- canonical: `/guide`

## Integrazioni con asset esistenti

### `app/sitemap.ts`
```ts
import { GUIDES } from '@/lib/seo/guides';
// ... aggiungere:
{ url: `${BRAND.url}/guide`, lastModified, changeFrequency: 'weekly', priority: 0.6 },
...GUIDES.map(g => ({
  url: `${BRAND.url}${g.url}`,
  lastModified: new Date(g.lastModified),
  changeFrequency: 'monthly' as const,
  priority: 0.8,
})),
```

### `app/robots.ts`
Nessuna modifica. `/guide` e `/guide/*` non sono in `DISALLOW_APP_PATHS`, sono già implicitamente Allow tramite la regola `*`.

### `src/lib/landing-gate.ts`
Refactor minimo: il check `PUBLIC_PATHS.has(path)` diventa una funzione esportata `isPublicPath(path)` che combina set + prefix:
```ts
export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/guide')) return true;
  return false;
}
```
Tutti i consumer attuali di `PUBLIC_PATHS` (proxy/middleware, layout) passano a `isPublicPath`. Future-proof per ulteriori contenuti.

### `app/llms.txt/route.ts`
Aggiungere sezione `## Guide` dopo `## Risorse`, iterando su `GUIDES`:
```
## Guide
- ${g.shortTitle}: ${BRAND.url}${g.url} — ${g.metaDescription}
```

### `src/components/site-header.tsx`
Aggiungere link "Guide" → `/guide` SEMPRE (sia gated sia non-gated), prima dei bottoni CTA esistenti. Su mobile può collassare se troppo stretto.

## Data flow

```
Request /guide/come-fare-passaggio-di-proprieta
  ├─→ middleware (isPublicPath aggiornato → passa)
  └─→ app/guide/come-fare-passaggio-di-proprieta/page.tsx
        ├─ metadata (override layout default, title + description + canonical da getGuide())
        ├─ <main>
        │   ├─ <SiteHeader />
        │   ├─ <Breadcrumbs items=[Home, Guide, "Come fare il passaggio"] />
        │   │   └─ inietta breadcrumbJsonLd
        │   ├─ <JsonLd data={[howToJsonLd(...), faqJsonLd(specificFAQs)]} />
        │   ├─ <Hero>, <KeyTakeaway>
        │   ├─ <article> con sezioni H2 + componenti (Callout, CostsTable, etc.)
        │   ├─ <GuideFooterCta />
        │   ├─ <RelatedGuides currentSlug="come-fare-..." />
        │   └─ <SiteFooter /> (componente condiviso estratto in Task 0)
```

**Decisione di scope (Task 0 del piano)**: il `<footer>` con address attualmente vive solo in `app/page.tsx` (T6 di Fase 1). Per le guide il riuso è obbligatorio; come prerequisite estraggo `SiteFooter.tsx` in `src/components/` (parametrizzato sul `currentYear` se serve) e aggiorno `app/page.tsx` a usarlo. Stesso markup, zero regressione visuale. Diventa il primo task del piano implementativo.

## Error handling

- `getGuide(slug)` può ritornare `undefined` se slug invalido → in `page.tsx` per route statica non serve handling (Next mostra 404 nativa se la route non esiste, e noi creiamo solo le 3 esistenti)
- JSON-LD generators: pure functions, no I/O, non possono fallire
- `headers()` nelle pagine richiede `force-dynamic` esplicito (pattern del progetto, vedi spec T1)
- `Breadcrumbs` con items array vuoto: non renderizza nulla, no errore

## Testing

### Unit tests
- `jsonLd.test.ts`: + 3 describe (`articleJsonLd`, `howToJsonLd`, `collectionPageJsonLd`) con ~10 assertion totali (shape, @id, sub-types come `HowToStep`, etc.)
- `guides.test.ts` (NEW): smoke test su `GUIDES` array (3 entry, slug univoci, URL coerenti), su `getGuide('valido')` e `getGuide('inesistente')`, su `otherGuides('slug1')` (ritorna 2 elementi)

### Component tests
- 6 nuovi componenti, ognuno con 1-2 test essenziali (rende props correttamente, varianti, JSON-LD iniettato per Breadcrumbs). Totale ~10 test.

### Smoke test e2e (curl + grep)
Per ogni pillar:
```
curl -s -H 'Host: passaggioveloce.it' http://localhost:3000/guide/<slug>
- title contiene la title della pillar
- canonical = https://passaggioveloce.it/guide/<slug>
- 1+ application/ld+json
- HowTo OR Article schema presente
- FAQPage presente
- BreadcrumbList presente
```

Per il hub:
- title "Guide ai passaggi..."
- CollectionPage schema
- ItemList con 3 elementi

Sitemap:
```
curl ... /sitemap.xml | grep -c '<loc>'  # atteso: 8 (4 vecchi + hub + 3 pillar)
```

llms.txt:
```
curl ... /llms.txt | grep -c '/guide/'   # atteso: 3 (i 3 pillar)
```

Gate regression:
```
curl -I -H 'Host: passaggioveloce.it' http://localhost:3000/guide          # 200 (non più redirect)
curl -I -H 'Host: passaggioveloce.it' http://localhost:3000/guide/costi-passaggio-proprieta  # 200
curl -I -H 'Host: passaggioveloce.it' http://localhost:3000/dashboard      # 307 (gate ancora attivo)
```

### Post-deploy validation
- Google Rich Results Test su ogni pillar URL → HowTo/Article/FAQ riconosciuti
- Schema.org Validator → zero errori
- Lighthouse SEO ≥ 95 su ogni pillar
- Google Search Console: submit del sitemap aggiornato, verificare indicizzazione delle 4 nuove URL entro 14 giorni

## Out of scope (futuro)

Confermato in brainstorming, NON in questa iterazione:
- PDF download della checklist documenti (richiede generazione lato server + storage)
- Email capture B2C (richiede backend, lista email, GDPR doppio opt-in)
- Local SEO `/agenzie-pratiche-auto/[città]` (Fase 3)
- Articoli aggiuntivi oltre i 3 pillar (es. "passaggio auto eredità", "passaggio auto fuori uso") — possibile Fase 2.1
- A/B testing CTA dual-track (richiede analytics + experiment framework)
- Hreflang multilingua (solo se internazionalizziamo)

## Dati di riferimento (verificati per 2026)

Numeri usati nei contenuti:
- **IPT base**: 150,81€ per veicoli fino a 53 kW; per veicoli oltre 53 kW si aggiungono ~3,5€ per kW eccedente. Maggiorazione provinciale fino al +30% (varia per provincia).
- **Emolumenti ACI**: ~27€ (composto da diritti DT + tariffa CdP)
- **Bollo per passaggio**: 32€
- **Marche da bollo**: 16€ × 2 = 32€ (atto + copia)
- **Diritti motorizzazione**: 10,20€
- **Termine entro cui registrare**: 60 giorni dall'atto, oltre c'è sanzione (artt. 247-bis e 247-ter D.Lgs. 285/1992)
- **Riferimenti normativi**: D.Lgs. 285/1992 art. 94 (passaggio proprietà), DPR 358/2000 (semplificazione)

Se l'utente in revisione riscontra numeri imperfetti, basta correggerli nei file pillar — sono hardcoded come testo, niente impatto su altri moduli.

## Riferimenti

- Schema.org HowTo: https://schema.org/HowTo
- Schema.org Article: https://schema.org/Article
- Schema.org CollectionPage: https://schema.org/CollectionPage
- Schema.org BreadcrumbList: https://schema.org/BreadcrumbList
- Google HowTo guidance: https://developers.google.com/search/docs/appearance/structured-data/how-to
- Codice della Strada art. 94: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285!vig=~art94
