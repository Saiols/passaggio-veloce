# Completamenti locali (no-external-account) — Design

> Data: 2026-06-01
> Obiettivo: chiudere tutto il lavoro residuo dell'MVP che **non dipende da account
> esterni** (Stripe, Resend, Document AI, Vapi, SDI) né da validazioni legali/fiscali.
> Fonte di verità roadmap: `docs/piano-implementazione.md`.

## Scope

Sotto-progetto unico "Completamenti locali", implementato a fasi con checkpoint.
Pacchetti inclusi: **P1, P2, P3, P4, P5(solo UTM), P7**.

### Esclusi (con motivazione)
- **Fatturazione FT-A/B/C** → bloccato B1 (validazione commercialista split fiscale). Rischio rework.
- **CRM conversazioni chatbot + storico stato S0→S3** → sganciato in ciclo dedicato (richiede 2 nuovi modelli).
- **Lotto massivo (FASE 3.5)** → ciclo dedicato successivo.
- **Mappa agenzie / raggio km reale** → richiede geocoding esterno.
- **Pulsante payout** → inutile senza Stripe.

### Decisioni prese (brainstorming 2026-06-01)
- Hard-block pre-invio su **qualsiasi** documento `gatingStato=FAILED` (non solo obbligatori).
- P5 ridotto al solo UTM capture.
- Nuovo tipo notifica = `N31_VALUTA_AGENZIA` (N26–N30 riservati a fatturazione FT-C).

---

## P1 · Gating documentale (chiusura killer feature)

### P1.1 Hard-block pre-invio pratica
- **Dove**: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` → `submitNuovaPraticaAction`, prima di `avviaRound1`.
- **Regola**: caricare i `Documento` collegati alla pratica; se esiste almeno un documento con `gatingStato = FAILED` e `gatingStato != OVERRIDDEN` → **interrompere il submit** e restituire errore strutturato che elenca `{ tipo documento, gatingError }` per ogni documento bloccante.
- **Sblocco**: l'override admin esistente (`admin/documenti/actions.ts`) imposta `gatingStato=OVERRIDDEN`, che bypassa il blocco.
- **UI**: lo step finale del wizard mostra il messaggio di blocco con la lista dei documenti da ricaricare (riusa lo stile badge già presente in `pratiche/[id]/page.tsx`).
- **Interfaccia (unità testabile)**: funzione pura `findBlockingDocuments(docs): BlockingDoc[]` in `lib/documenti/gating-block.ts` — input array di `{tipo, gatingStato, gatingError}`, output documenti bloccanti. Testabile senza prisma.

### P1.2 Fallback manuale OCR fallito
- **Dove**: step 1 wizard (`pratiche/nuova`), client component che chiama `extractLibrettoAction`.
- **Comportamento**: se l'action ritorna errore OCR, mostrare CTA "Inserisci manualmente" che apre il form veicolo (targa, telaio, proprietario, data immatricolazione, flag pre-2015/comodato) vuoto ed editabile, e consente di proseguire allo step 2.
- **Dato**: i campi manuali confluiscono nello stesso payload del submit (`librettoData`), con flag `ocrManuale: true` salvato su `Documento`/`Pratica` per audit.
- Nessuna nuova dipendenza.

### P1.3 Download ZIP pratica
- **Endpoint**: `GET /api/pratiche/[id]/zip` — auth: broker owner OR agenzia assegnata (PENDING/ACCETTATA/FIRMATA) OR `ADMIN_PIATTAFORMA`. Riusa il check ownership di `api/documenti/[id]/route.ts`.
- **Implementazione**: zip in-memory con **`jszip`** (documenti piccoli, evita streaming/Chromium → serverless-friendly come `pdf-lib`). Nome file `PV-YYYY-NNNNN.zip`, entry per documento con nome leggibile `{tipo}-{parte}.{ext}`.
- **UI**: cablare il pulsante placeholder `href="#"` in `pratiche/[id]/page.tsx:176` all'endpoint.

### P1.4 Retention/purge documenti + bozze
- **Job**: `lib/jobs/purge-deleted-documenti.ts` sul pattern di `purge-deleted-team-users.ts`.
  - Hard-delete `Documento` con `deletedAt` più vecchio di **90 giorni** (incl. file su `StorageProvider`).
  - Annulla/purga `Pratica` in stato `BOZZA` con `updatedAt` più vecchio di **30 giorni** (coerente §0.5) + relativi documenti.
- **Endpoint**: `POST/GET /api/jobs/purge-deleted-documenti` con `requireAdminOrCron`.
- **Cron**: nuova entry in `vercel.json` (es. `0 3 * * *` sfalsato dagli altri, o accorpato al purge esistente).
- **Costanti retention** centralizzate in `lib/documenti/retention.ts` (`DOC_HARD_DELETE_DAYS=90`, `BOZZA_PURGE_DAYS=30`).

---

## P2 · Completamento dashboard agenzia

### P2.1 Countdown 20 giorni
- **Dove**: dashboard agenzia (`dashboard/agenzia-dashboard.tsx`) + lista `/pratiche` lato agenzia.
- **Logica**: per pratiche `FIRMATA` con `autoAddebitoAt` valorizzato, mostrare giorni residui (`giorniResidui = ceil((autoAddebitoAt - now)/giorno)`), badge a 3 livelli colore (verde >7gg, ambra 3–7gg, rosso <3gg / scaduto).
- **Unità testabile**: `computeGiorniResidui(autoAddebitoAt, now)` puro in `lib/pratiche/countdown.ts`.

### P2.2 Riepilogo fee mensili / auto-addebiti
- **Pagina**: nuova sezione agenzia (es. `/fee` o tab in `/pratiche`) con `FeeAddebito` della company raggruppati per mese: stato (SCHEDULED/EXECUTED/FAILED), importo, data schedulata/eseguita, link alla pratica.
- **Aggregato**: totali per mese + totale anno. Server query con `groupBy` su `FeeAddebito`.

---

## P3 · Notifiche & preferenze

### P3.1 Preferenze / unsubscribe
- **Modello**: classificare i `NotificaTipo` in **obbligatori** (transazionali: invio, accettata, firma, addebito, escalation, account, penale, segnalazione, payout) vs **opzionali** (solleciti N3, promemoria N7, recap N25, valuta N31).
- **Schema**: campo `User.notifPrefs Json?` (mappa `tipo→bool`, default opt-in) + `User.unsubscribeToken String? @unique` per link one-click.
- **Gating**: in `sendNotification`, prima dell'invio, se il tipo è opzionale e l'utente (via `target.userId`) ha opt-out → marcare `NotificaInviata.stato='SKIPPED'` (nuovo valore enum `NotificaStato`) e non inviare.
- **UI**: pagina `/profilo/notifiche` con toggle per tipo opzionale. Pagina pubblica `/unsubscribe?token=...` (one-click, no login) che disattiva tutte le opzionali. Link unsubscribe in footer email opzionali.
- **Unità testabile**: `isOptionalTipo(tipo)` + `shouldSend(tipo, prefs)` puri.

### P3.2 Notifica proattiva "valuta agenzia"
- **Nuovo tipo**: `N31_VALUTA_AGENZIA` (enum schema + template `tplN31ValutaAgenzia` + ramo union/render in `send.ts`).
- **Trigger**: in `onPraticaFirmata` / `completaPratica` (`app/pratiche/actions.ts`), inviare al dealer la notifica con link al form valutazione (già esistente sul detail).
- **Idempotenza**: una sola N31 per pratica (guardia su `NotificaInviata` esistente per `praticaId`+tipo nel payload).

---

## P4 · Auth hardening — check 2FA al sign-in

- **Stato attuale**: `User.twoFactorEnabled/twoFactorSecret/twoFactorBackupCodes` esistono; setup `/profilo/sicurezza` pronto; `lib/auth/totp.ts` con verify. Il login NON interroga il codice.
- **Flusso a due passi in `loginAction`** (dove c'è già il rate-limit):
  1. Pre-check: trova user + verifica password (bcrypt). Se KO → errore generico + rate-limit.
  2. Se password OK e `twoFactorEnabled` e codice assente → ritorna `{ needTotp: true }` senza creare sessione.
  3. UI mostra campo codice TOTP (+ "usa backup code").
  4. Resubmit con codice → `verifyTotpCode` / `verifyBackupCode`; se OK chiama `signIn`, altrimenti errore.
- **Difesa in profondità**: `authorize` in `auth.ts` accetta credenziale opzionale `totp`; se `twoFactorEnabled` ricontrolla il codice e rifiuta se mancante/errato (impedisce bypass chiamando signIn direttamente).
- **Backup code consumato**: marcare il codice usato come speso (rimozione dall'array hashed).

---

## P5 · UTM capture (solo)

- **Cattura**: query param `utm_source/utm_medium/utm_campaign/utm_content/ref` su landing e `/register`, propagati nel wizard (hidden field / cookie sessione registrazione).
- **Persistenza**: salvati su `Company` (es. `utmSource`, `utmCampaign`) o `User.crmFonte` alla creazione.
- **Uso**: `tryMatchCrmContact` (CRM-G) arricchisce `fonteAcquisizione` del `CrmContact` matchato con la UTM.
- Nessun nuovo modello, nessun account esterno.

---

## P7 · QA

- **Unit** (Vitest, pattern esistente): `findBlockingDocuments`, `computeGiorniResidui`, `isOptionalTipo/shouldSend`, retention selector, TOTP login pre-check.
- **E2E** (Playwright, setup A8): estendere `e2e/` con
  - registrazione dealer → wizard nuova pratica (con OCR mock) → invio,
  - blocco hard-block su documento FAILED,
  - login con 2FA attivo (campo codice).
- Richiede fixtures/seed dedicato per E2E (DB di test).

---

## Sequenza di implementazione

`P1 → P2 → P3 → P4 → P5 → P7`, ogni pacchetto = commit logico, con checkpoint di review.
QA (P7) per-pacchetto durante l'implementazione + smoke E2E finale (preferenza utente: test e2e end-of-phase).

## Vincoli architetturali

- Logica pura isolata in `lib/**` testabile senza prisma (pattern esistente del repo).
- Nessuna nuova dipendenza esterna salvo **`jszip`** (P1.3).
- Migrazioni Prisma additive (`notifPrefs`, `unsubscribeToken`, enum `N31`, enum `SKIPPED`, eventuali campi UTM).
- Coerenza serverless Vercel (no Chromium, no streaming pesante).

## Rischi

- Migrazione enum `NotificaTipo`/`NotificaStato` su Neon prod: applicare con `prisma migrate`/`db push` come da prassi repo.
- 2FA: rischio lock-out utenti → garantire path backup code + nessun blocco per chi non ha 2FA attivo.
- Hard-block: rischio falsi positivi del classificatore rule-based → l'override admin è la valvola di sfogo (documentare in UI).
