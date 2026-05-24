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

// Pagine raggiungibili sul dominio gated: home + pagine legali.
// Tutto il resto viene rediretto qui.
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/privacy',
  '/cookie',
  '/termini',
]);

export function isGatedHost(host: string | null | undefined): boolean {
  if (!host) return false;
  // Toglie eventuale porta (host:port) — utile in dev/test.
  const bare = host.split(':')[0].toLowerCase();
  return GATED_HOSTS.has(bare);
}
