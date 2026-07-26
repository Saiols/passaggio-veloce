/**
 * Ogni route handler `src/app/api/**\/route.ts`, col permesso che lo protegge.
 * `null` = volutamente senza permesso azienda, con la ragione accanto.
 *
 * Gemella di `mappa-enforcement.ts` (server action) e `mappa-pagine.ts`
 * (page.tsx), ma per le route API: senza questa mappa una route nuova che
 * legge/scarica dati azienda può restare senza `hasPermesso`/`requirePermesso`
 * e rispondere 200 a chiunque abbia solo una sessione — un buco più grave di
 * un `page.tsx` scoperto, perché qui non c'è nemmeno un redirect di UX che
 * potrebbe insospettire: solo un JSON o un binario che parte.
 *
 * A differenza delle altre due mappe, qui NON si esclude un perimetro
 * "staff piattaforma"/"pre-sessione": le route API sono un namespace piatto
 * condiviso da azienda, staff e cron, e la mappa le enumera TUTTE (33), con
 * `null` per quelle staff/cron/pubbliche — enumerare tutto è più economico e
 * più sicuro che mantenere un secondo elenco di prefissi da tenere allineato.
 *
 * Il test enumera TUTTE le `route.ts` sotto `src/app/api` e fallisce se una
 * non è qui mappata; per le voci con un permesso, verifica anche che il
 * sorgente citi `hasPermesso('<permesso>')` o `requirePermesso('<permesso>')`.
 * Vedi mappa-api.test.ts.
 */
import type { Permesso } from './catalogo';

export const MAPPA_API: Record<string, Permesso | null> = {
  // --- Staff piattaforma (isAdminPiattaforma / isAdminOrAssistente / canViewAggregatedFinancials) ---
  // Stesso dominio di autorizzazione escluso da mappa-pagine.ts/mappa-enforcement.ts
  // (src/app/admin/**): gate a ruolo, non al catalogo permessi azienda.
  'src/app/api/admin/affiliazioni/export/route.ts': null, // isAdminPiattaforma
  'src/app/api/admin/companies/[id]/documenti-zip/route.ts': null, // isAdminPiattaforma
  'src/app/api/admin/contatti/export/route.ts': null, // isAdminOrAssistente
  'src/app/api/admin/costi-promozionali/export/route.ts': null, // isAdminPiattaforma
  'src/app/api/admin/dashboard/export/route.ts': null, // canViewAggregatedFinancials
  'src/app/api/admin/fatturazione/export/route.ts': null, // isAdminPiattaforma
  'src/app/api/admin/mandato/[companyId]/pdf/route.ts': null, // isAdminOrAssistente

  // --- Pre-sessione / infrastruttura non azienda ---
  'src/app/api/auth/[...nextauth]/route.ts': null, // NextAuth: login, non c'è ancora una sessione da gatare

  // --- Cron / job schedulati ---
  // Tutti gatati da `requireAdminOrCron` (bearer CRON_SECRET o sessione
  // ADMIN_PIATTAFORMA): autorizzazione a segreto/ruolo staff, non un permesso
  // azienda — nessun utente azienda arriva mai a queste route.
  'src/app/api/jobs/affiliation-monthly-recap/route.ts': null,
  'src/app/api/jobs/crm-sync/route.ts': null,
  'src/app/api/jobs/distribuzione-tick/route.ts': null,
  'src/app/api/jobs/preavviso-visura/route.ts': null,
  'src/app/api/jobs/process-fee-scheduled/route.ts': null,
  'src/app/api/jobs/process-payouts/route.ts': null,
  'src/app/api/jobs/purge-deleted-documenti/route.ts': null,
  'src/app/api/jobs/purge-deleted-team-users/route.ts': null,
  'src/app/api/jobs/purge-log-accessi/route.ts': null,
  'src/app/api/jobs/send-solleciti/route.ts': null,
  'src/app/api/jobs/trigger-auto-payout/route.ts': null,

  // --- Webhook / diagnostica / metadati, nessun dato azienda ---
  'src/app/api/webhooks/stripe/route.ts': null, // autenticato via firma Stripe (STRIPE_WEBHOOK_SECRET), non da un permesso
  'src/app/api/version/route.ts': null, // metadati di build (sha/branch/env), nessun dato azienda

  // --- Upload generico (infrastruttura, gate nella pagina/azione chiamante) ---
  'src/app/api/blob/upload/route.ts': null, // sessione richiesta salvo path KYC pre-sessione (uploadRequiresAuth); il permesso vive nell'azione che invoca l'upload
  'src/app/api/blob/upload-local/route.ts': null, // stesso motivo, variante storage locale (STORAGE_PROVIDER)

  // --- Widget pubblico ---
  'src/app/api/chatbot/[botId]/route.ts': null, // widget embeddabile pubblico, nessuna sessione azienda coinvolta (rate-limit + tier, non permessi)

  // --- Notifiche in-app (sessione + scope sede, non un permesso specifico) ---
  'src/app/api/badges/route.ts': null, // DA VALUTARE: conteggi di navigazione, richiede sessione ma nessun permesso — solo numeri aggregati, non contenuto pratiche
  'src/app/api/eventi/pending/route.ts': null, // notifica in-app cross-party, richiede sessione + scope sede (stesso pattern di badges)
  'src/app/api/eventi/seen/route.ts': null, // marca-come-visto, scritto solo sulla company della sessione

  // --- Wallet/mandato: dato della MADRE o identità fiscale, owner-only ---
  'src/app/api/wallet/rendiconto/route.ts': null, // owner-only via ctx.isOwner (rendiconto della madre, non di una sede — vedi commento nel file)
  'src/app/api/mandato/pdf/route.ts': null, // DA VALUTARE: richiede solo companyId di sessione (nessun ruolo/permesso); espone la stessa identità fiscale che altrove (profilo/azienda) è owner-only

  // --- Modale di lancio affiliazione (post-login) ---
  // GET espone il link referral dell'azienda ⇒ gate `affiliazione.view`.
  // POST è il "non mostrare più": scrive solo il flag dell'utente di sessione.
  'src/app/api/affiliazione/spot/route.ts': 'affiliazione.view',

  // --- Download gatati (le 7 "gatate a mano") ---
  'src/app/api/documenti/[id]/route.ts': 'pratiche.download',
  'src/app/api/fatturazione/[id]/pdf/route.ts': 'fatture.download',
  'src/app/api/fatturazione/[id]/xml/route.ts': 'fatture.xml',
  'src/app/api/fatturazione/zip/route.ts': 'fatture.download',
  'src/app/api/pratiche/[id]/pdf/route.ts': 'pratiche.download',
  'src/app/api/pratiche/[id]/zip/route.ts': 'pratiche.download',
  'src/app/api/pratiche/documenti-zip/route.ts': 'pratiche.download',
};
