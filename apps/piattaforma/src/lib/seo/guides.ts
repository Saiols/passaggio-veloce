// Single source of truth per le pillar pages B2C.
// Consumato da: hub /guide, ogni pillar, sitemap, RelatedGuides, llms.txt.

export type GuideMeta = {
  slug: string;
  url: string;
  title: string;
  metaDescription: string;
  shortTitle: string;
  category: 'procedura' | 'costi' | 'documenti';
  jsonLdType: 'HowTo' | 'Article';
  lastModified: string;
  readingTimeMin: number;
};

export const GUIDES: readonly GuideMeta[] = [
  {
    slug: 'come-fare-passaggio-di-proprieta',
    url: '/guide/come-fare-passaggio-di-proprieta',
    title: "Come fare il passaggio di proprietà di un'auto: guida 2026",
    metaDescription:
      'Guida completa al passaggio di proprietà di un veicolo in Italia: 5 step, dove andare, tempi e costi, errori comuni. Aggiornata al 2026.',
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
    metaDescription:
      "Quanto costa il passaggio di proprietà di un'auto nel 2026: IPT, emolumenti ACI, bollo, marche da bollo. Tabella per provincia e potenza.",
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
    metaDescription:
      'Checklist completa dei documenti per venditore e acquirente: CI, codice fiscale, libretto, certificato di proprietà digitale. Casi speciali inclusi.',
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
