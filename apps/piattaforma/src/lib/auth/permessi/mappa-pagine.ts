/**
 * Ogni `page.tsx` dell'area azienda, col permesso che la protegge (o `null`
 * motivato). Gemella di `mappa-enforcement.ts` ma per le pagine invece delle
 * server action: senza questa mappa un `page.tsx` nuovo può restare senza
 * `assertPermesso` e rispondere 200 a chiunque digiti l'URL (il buco chiuso
 * da questo task su /affiliazione, /feedback, /notifiche — la sidebar
 * nascondeva la voce, ma la rotta non faceva redirect).
 *
 * Perimetro "area azienda" — ogni `page.tsx` sotto `src/app`, ESCLUSI:
 *  - `src/app/admin/**`  staff piattaforma: la gate è il ruolo
 *    (ADMIN_PIATTAFORMA/ASSISTENTE via `isAdminOrAssistente`/`admin/layout.tsx`),
 *    non il catalogo permessi azienda — un concetto diverso, fuori scopo qui.
 *  - `src/app/(auth)/**`  route group pre-sessione: login, registrazione,
 *    reset password, verifica email. Non c'è ancora un utente da gatare.
 *  - Pagine pubbliche raggiungibili SENZA sessione (nessuna chiamata ad
 *    `auth()`/redirect di login nel sorgente): `guide/**`, `r/[code]`
 *    (route.ts, non page.tsx — comunque fuori perimetro), `invito/[token]`,
 *    `unsubscribe`, `termini`, `privacy`, `cookie`, e la landing
 *    (`src/app/page.tsx`). Privacy/cookie non erano nell'elenco d'esempio del
 *    brief ma sono lo stesso pattern esatto di termini — `SiteHeader` +
 *    contenuto statico, zero `auth()` — quindi stesso bucket "pubbliche".
 *  - `layout.tsx`: non è un `page.tsx`, escluso per costruzione dall'enumerazione
 *    del test (non serve escluderlo esplicitamente).
 *
 * Il test enumera TUTTE le page.tsx sotto `src/app` e fallisce se una, non
 * appartenente al perimetro sopra, non è qui mappata: vedi mappa-pagine.test.ts.
 */
import type { Permesso } from './catalogo';

export const MAPPA_PAGINE: Record<string, Permesso | null> = {
  'src/app/dashboard/page.tsx': null, // sempre accessibile: è la destinazione di ogni redirect di assertPermesso
  'src/app/profilo/page.tsx': null, // proprio account (hub profilo)
  'src/app/profilo/personale/page.tsx': null, // proprio account
  'src/app/profilo/sicurezza/page.tsx': null, // proprio account (2FA)
  'src/app/profilo/notifiche/page.tsx': null, // proprio account: PREFERENZE di notifica, non lo storico (quello è notifiche.view)
  'src/app/profilo/azienda/page.tsx': null, // owner-only: redirect a /profilo se role !== 'ADMIN_AZIENDA' — identità fiscale, non delegabile
  'src/app/profilo/listino/page.tsx': null, // feature parcheggiata: notFound() sempre, vedi project_listini_parcheggiati — NON riattivare
  'src/app/blocco-pagamento/page.tsx': null, // D4: aperta a chiunque in agenzia quando la sede è bloccata, non è una capability delegabile
  'src/app/sedi/page.tsx': null, // owner-only: redirect a /dashboard se role !== 'ADMIN_AZIENDA', non un permesso del catalogo
  'src/app/sedi/[id]/page.tsx': null, // owner-only, stesso motivo di src/app/sedi/page.tsx
  // Doppio gate: `team.view` (capability) e `getManageableSedi()` (scope, owner o ADMIN_SEDE).
  // Senza il permesso la voce sparisce dalla sidebar: senza anche il redirect, bastava l'URL.
  'src/app/team/page.tsx': 'team.view',
  'src/app/team/[userId]/edit/page.tsx': 'team.view',
  'src/app/wallet/page.tsx': 'wallet.view',
  'src/app/addebiti/page.tsx': 'addebiti.view',
  'src/app/orari/page.tsx': 'orari.view',
  'src/app/inbox/page.tsx': 'inbox.view',
  'src/app/inbox/[id]/page.tsx': 'inbox.view',
  'src/app/pratiche/page.tsx': 'pratiche.view',
  'src/app/pratiche/nuova/page.tsx': 'pratiche.create',
  'src/app/pratiche/[id]/page.tsx': 'pratiche.view', // + bypass isAdminOrAssistente: pagina condivisa, linkata anche da /admin/pratiche
  'src/app/fatturazione/page.tsx': 'fatture.view',
  'src/app/fatturazione/[id]/page.tsx': 'fatture.view', // + bypass ADMIN_PIATTAFORMA: pagina condivisa, linkata anche da /admin/fatturazione
  'src/app/impostazioni-sede/page.tsx': 'sede.view',
  'src/app/affiliazione/page.tsx': 'affiliazione.view',
  'src/app/feedback/page.tsx': 'feedback.view',
  'src/app/notifiche/page.tsx': 'notifiche.view',
};
