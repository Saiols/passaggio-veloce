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
  '/cookie',
  '/termini',
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
