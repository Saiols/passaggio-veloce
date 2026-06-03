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
  // Trust Blue navy — primary theme color, usato in viewport, manifest, OG image.
  themeColor: '#0b1e3a',
  // Popolare quando i social aziendali sono attivi.
  sameAs: [] as readonly string[],
  // Dati legali/contatti per footer email e altri usi.
  piva: '14688390963',
  sede: 'Via delle Querce 5 — 20057 Assago (MI)',
  supportEmail: 'assistenza@passaggioveloce.it',
  tel: '+39 346 287 7310',
} as const;

export function siteUrl(path?: string): string {
  if (!path) return BRAND.url;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return BRAND.url + normalized;
}
