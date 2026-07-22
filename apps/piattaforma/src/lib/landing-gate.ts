// Gate vetrina pre-lancio: alcuni domini servono solo le pagine
// marketing pubbliche, gli altri (Vercel default e preview URLs)
// servono la piattaforma completa. La logica è host-based, NON
// env-based: stesso deployment, comportamento differenziato per dominio.
//
// Comportamento atteso:
// - passaggioveloce.it / www.passaggioveloce.it → gate ATTIVO
//   (solo vetrina marketing pubblica, app non raggiungibile)
// - passaggio-veloce-piattaforma.vercel.app + URL preview → gate SPENTO
//   (app completa per testing interno)
//
// Al go-live della piattaforma: svuotare GATED_HOSTS (set vuoto) o
// rimuovere il check `isGatedHost` da auth.config.ts/page.tsx/site-header.tsx.

export const GATED_HOSTS: ReadonlySet<string> = new Set([
  'passaggioveloce.it',
  'www.passaggioveloce.it',
]);

// Pagine raggiungibili sul dominio gated: home + pagine legali + asset SEO/AEO (OG image, llms.txt, manifest).
// Tutto il resto viene rediretto qui.
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/privacy',
  '/privacy/clienti',
  '/cookie',
  '/termini',
  '/unsubscribe',
  '/opengraph-image',
  '/twitter-image',
  '/llms.txt',
  '/manifest.webmanifest',
]);

// Check unificato: include i path esatti in PUBLIC_PATHS più tutti quelli sotto /guide
// (future-proof per le pillar B2C). Usa questa funzione invece di PUBLIC_PATHS.has(path)
// direttamente nei consumer.
export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path === '/guide' || path.startsWith('/guide/')) return true;
  return false;
}

// Type guard: dopo `if (isGatedHost(host))` TypeScript sa che host è string,
// così il redirect può costruire l'URL `https://${host}/` senza null check.
export function isGatedHost(host: string | null | undefined): host is string {
  if (!host) return false;
  // Toglie eventuale porta (host:port) — utile in dev/test.
  const bare = host.split(':')[0].toLowerCase();
  return GATED_HOSTS.has(bare);
}

// ── Gate APP (modalità vetrina pre-lancio) ──────────────────────────────────
// Go-live 2026-07-22: false = app completa servita OVUNQUE (dominio incluso);
// true = solo vetrina marketing sui GATED_HOSTS. Per aprire/chiudere l'app usare
// SOLO questo flag. ⚠️ NON svuotare GATED_HOSTS: isGatedHost resta la fonte
// "host di produzione canonico" per la SEO (robots/sitemap/llms) — svuotarlo
// farebbe restituire a robots `Disallow: /`, de-indicizzando il sito.
export const LANDING_ONLY = false;

// Vero solo se la modalità vetrina è ATTIVA E l'host è di produzione. Consumato
// dai gate APP (auth.config, page.tsx, site-header, GuideFooterCta), NON dalla SEO.
export function isLandingOnlyHost(host: string | null | undefined): boolean {
  return LANDING_ONLY && isGatedHost(host);
}
