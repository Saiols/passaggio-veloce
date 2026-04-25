# Sprint Demo-Ready — Design

> **Data:** 2026-04-25
> **Owner tecnico:** Francesco Sioli (CTO)
> **Stato MVP all'inizio dello sprint:** ~72-75% (vedi `docs/piano-implementazione.md`)
> **Obiettivo:** rendere la piattaforma navigabile end-to-end senza dipendenze da servizi esterni a pagamento, deployata su un dominio di test, così che i soci possano provare, testare, stressare e raccogliere feedback.

---

## 1. Obiettivi e non-obiettivi

### Obiettivi

- Tutto il flusso utente per i tre ruoli (dealer, agenzia, admin) è raggiungibile e funzionante via mock provider dei servizi esterni.
- La piattaforma è deployata su `passaggio-veloce-demo.vercel.app` (HTTPS automatico Vercel).
- Un socio non tecnico può registrarsi, creare/gestire pratiche, vedere wallet/payout/notifiche/valutazioni — senza che nessun pezzo del flusso resti "bloccato" in attesa di un servizio esterno.
- L'admin demo ha un Centro Operazioni (`/admin/demo-control`) per scatenare manualmente i flussi cron e per ispezionare le email simulate.
- Tre account demo precostituiti (admin, dealer, agenzia) permettono il primo accesso senza dover registrarsi, ma la registrazione vera resta funzionante per chi vuole testarla.

### Non-obiettivi (out of scope esplicito)

Non implementeremo in questo sprint, anche se richiesti durante il test:

| Area | Motivazione del rinvio |
|---|---|
| Gating IA documentale (FASE 3.3) | Costoso, richiede Google Document AI |
| Lotto massivo (FASE 3.5) | Caso d'uso avanzato |
| Listini agenzia + Osservatorio Prezzi (FASE 8) | Tutta la fase a zero, complessa |
| Anteprima inline documenti | Solo download è sufficiente per la demo |
| Configurazione runtime parametri admin (N agenzie, soglie, T1/T2/T3) | Default in code/seed bastano |
| Report finanziari + export contabile | Non testabile dai soci business |
| Generazione PDF rendiconto/fattura | Fase 5 con Stripe reale |
| 2FA, rate limiting login, audit log UI | Sicurezza pre-produzione, non demo |
| Unsuspend manuale agenzie | La sospensione automatica funziona, unblock via DB |
| UTM capture + webhook CRM (FASE 10) | Sistema separato |
| Sistema affiliazione (FASE 13) | Sistema separato |
| Resend / Stripe / Google Document AI / S3 / SDI | Sostituiti da mock provider e Vercel Blob |
| Cookie banner GDPR + DPA + audit GDPR formale | Demo interna, no PII reale |
| Vercel Cron, backup automatici, staging dedicato, monitoring attivo | Infra demo minima |

I soci useranno la demo con account fittizi e dati seed (nessuna PII reale). Il banner globale "Modalità DEMO" lo dichiara esplicitamente in ogni pagina.

---

## 2. Architettura modalità DEMO

### 2.1 Concetto guida

La demo è una *configurazione* della stessa codebase di produzione, attivata da un singolo env flag. Niente branch separato, niente fork. Il giorno in cui si va in produzione vera, basta cambiare le env var.

### 2.2 Env flag nuovo

`DEMO_MODE: boolean (default false)` validato in `src/env.ts` lato server.

### 2.3 Comportamenti differenziati

| Comportamento | DEMO_MODE=true | DEMO_MODE=false (prod futuro) |
|---|---|---|
| Banner globale "Modalità DEMO" | visibile, sticky, non dismissable | nascosto |
| Verifica email | auto-completata + token mostrato in UI; email comunque generata in Inbox Demo | richiede click su link da email reale |
| Reset password | funzionante; link mostrato anche in UI oltre che inviato | solo via email reale |
| `FeeAddebito.autoAddebitoAt` | `now + 5 minuti` | `now + 20 giorni` |
| Soglie sollecito (N3 broker, N7 agenzia) | `+5 minuti` (anziché `+5 giorni`) | reali |
| Trigger payout automatici (soglia 1.000€) | manuale via Demo Control | cron Vercel reale |
| Pagina `/admin/demo-control` | accessibile (solo admin) | nascosta (404) |
| Provider default | `console` / `local` o `vercel-blob` / `mock` / `mock` | `resend` / `vercel-blob` / `google-docai` / `stripe` |

### 2.4 Banner globale

Implementato in `src/components/app-shell.tsx`, sticky in alto sopra l'header, fascia gialla:

> 🧪 **Modalità DEMO** — Email, pagamenti, OCR e cron sono simulati. Vai su [Demo Control] per gestire i flussi.

Non dismissable per non dare false impressioni durante il test.

### 2.5 Punti di lettura del flag

- `src/components/app-shell.tsx` — visibilità banner
- `src/app/(auth)/actions.ts` — branch `registerAction` (auto-verify) e `requestPasswordResetAction` (esposizione link)
- `src/app/pratiche/actions.ts` — `markFirmaAvvenutaAction` (calcolo `autoAddebitoAt`)
- `src/app/(auth)/admin/layout.tsx` — guard accesso `/admin/demo-control`
- `src/lib/jobs/send-solleciti.ts` — soglia `5 min` vs `5 gg`

---

## 3. Provider abstractions

### 3.1 `MockPaymentProvider` (nuovo)

Modulo: `src/lib/providers/payment/`

```ts
interface PaymentProvider {
  name: 'mock' | 'stripe'
  chargeFee(input: { feeAddebitoId: string; importoCent: number; agenziaId: string }): Promise<PaymentResult>
  executePayout(input: { payoutId: string; importoCent: number; iban: string }): Promise<PaymentResult>
}

type PaymentResult =
  | { ok: true; providerRef: string }
  | { ok: false; error: string; retryable: boolean }
```

`MockPaymentProvider` ritorna sempre `{ ok: true, providerRef: 'mock-' + uuid }` con latenza simulata 200ms. Loggato in console. Selezione via env `PAYMENT_PROVIDER` (default `mock`).

### 3.2 `VercelBlobStorageProvider` (nuovo)

Implementa la `StorageProvider` esistente. Wrapper su `@vercel/blob` (`put`, `head`, `del`, fetch su URL pubblico autenticato per `get`).

`storageKey` ritornato è il pathname del blob (es. `documenti/<uuid>-<filename>.pdf`). Selezionato via `STORAGE_PROVIDER=vercel-blob` in produzione Vercel. In locale resta `local` (default).

### 3.3 Provider esistenti riutilizzati

- `ConsoleEmailProvider`: già esistente, scrive su `NotificaInviata` + dump HTML in `EMAIL_CONSOLE_DIR`. Il consumer pattern resta `getEmail().send(...)`.
- `MockOcrProvider`: già esistente, deterministico su hash buffer.

### 3.4 Modifiche al consumer code

- `src/app/pratiche/actions.ts:markFirmaAvvenutaAction` — il flusso esistente (creazione `FeeAddebito SCHEDULED` con `autoAddebitoAt`) resta invariato. La differenza è solo nel valore di `autoAddebitoAt` (5 min vs 20 gg).
- Nuovo modulo `src/lib/jobs/process-fee-scheduled.ts` esposto via `POST /api/jobs/process-fee-scheduled` chiamato dal pulsante in `/admin/demo-control`.
- Nuovo modulo `src/lib/jobs/process-payouts.ts` analogo per payout.
- Nuovo modulo `src/lib/jobs/trigger-auto-payout.ts` per scansione wallet >= soglia.
- Nuovo modulo `src/lib/jobs/send-solleciti.ts` per N3/N7.

### 3.5 Cosa non cambia

- Schema Prisma: i campi `providerRef`, `errorMessage` esistono già su `FeeAddebito` e `Payout`.
- Le interfacce esistenti `EmailProvider`, `StorageProvider`, `OcrProvider` non vengono toccate.

---

## 4. Centro Operazioni Admin (`/admin/demo-control`)

Pagina unica, accessibile solo se `DEMO_MODE=true` e ruolo `ADMIN_PIATTAFORMA`.

### 4.1 Sezione "Email simulate" (Inbox Demo)

Sorgente: tabella `NotificaInviata` (già esistente, popolata da `ConsoleEmailProvider`).

UI:
- Lista delle ultime 50 email ordinate desc per `sentAt`.
- Per ogni riga: subject, destinatario (email + ruolo + company), tag, data.
- Click sulla riga → modal con HTML rendered (sandboxed iframe).
- Filtri: tipo (verifica / reset / notifica pratica / fee), destinatario.
- Quick action "Estrai link": parsing dell'HTML, trova href `/verify-email?token=...` o `/reset-password?token=...`, copia in clipboard.

### 4.2 Sezione "Esegui job"

Cinque pulsanti, ognuno chiama `POST /api/jobs/<job>` con auth admin, ritorna toast con counters.

| Pulsante | Endpoint | Comportamento |
|---|---|---|
| ⚡ Processa addebiti SCHEDULED | `POST /api/jobs/process-fee-scheduled` | `FeeAddebito` con `stato=SCHEDULED` e `autoAddebitoAt <= now()` → `MockPaymentProvider.chargeFee()` → `SUCCESS`, audit `errorMessage=null`, `providerRef=mock-…` |
| 💰 Processa payout pendenti | `POST /api/jobs/process-payouts` | `Payout` con `stato=RICHIESTO` → `executePayout()` → `ESEGUITO`, crea `TransazioneWallet` `PAYOUT_AUTOMATICO` o `PAYOUT_MANUALE` |
| 🔁 Avanza tick distribuzione | `POST /api/jobs/distribuzione-tick` *(esistente)* | Avanza round per pratiche con countdown scaduto |
| 📨 Invia solleciti pratiche | `POST /api/jobs/send-solleciti` | Pratiche in attesa firma > soglia (5 min in DEMO) → invia N3 broker + N7 agenzia |
| 🎯 Trigger payout automatici | `POST /api/jobs/trigger-auto-payout` | Wallet con saldo >= 1.000€ → crea `Payout` `automatico=true` `RICHIESTO` (poi processabile col pulsante 💰) |

### 4.3 Sezione "Counters live"

Cinque card a colpo d'occhio:
- N. addebiti SCHEDULED in coda (di cui X scaduti, processabili ora)
- N. payout RICHIESTI in coda
- N. pratiche in `IN_ATTESA_ROUND_*`
- N. pratiche in `IN_ESCALATION`
- N. email inviate nelle ultime 24h

### 4.4 Reset demo

Non incluso. La pagina mostra avvertenza: "Per resettare i dati, contatta lo sviluppatore." Reset manuale via `pnpm db:seed` puntando al DB Neon.

### 4.5 Layout

```
┌─────────────────────────────────────────────────┐
│  🧪 Banner Modalità DEMO                        │
├─────────────────────────────────────────────────┤
│  Header navy + nav admin                        │
├─────────────────────────────────────────────────┤
│  Demo Control                                   │
│  ┌──────────┬──────────┬──────────┬──────────┐ │
│  │ Counters live (4-5 card)                  │ │
│  └──────────┴──────────┴──────────┴──────────┘ │
│                                                 │
│  ┌─────────────────────┬───────────────────┐   │
│  │ Inbox Demo (lista)  │ Esegui Job (5 btn)│   │
│  │ [filtri]            │                   │   │
│  │ [riga email...]     │                   │   │
│  └─────────────────────┴───────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 5. Gap UI da chiudere nel codice esistente

### 5.1 Verifica email auto in DEMO

`src/app/(auth)/actions.ts:registerAction`

In DEMO, dopo aver creato `User` + `VerificationToken`:
- Consume immediato del token, `User.status = ACTIVE`, `User.emailVerifiedAt = now()`.
- Restituisce comunque il token nella response (la pagina post-registrazione mostra: "Demo: il tuo account è già attivo. In produzione avresti ricevuto questa email: [link]").
- L'email viene comunque inviata (= scritta nella Inbox Demo) per dimostrare il flusso reale.

### 5.2 Reset password reale

File:
- `src/app/(auth)/reset-password/page.tsx` *(esistente, oggi placeholder)* → due form gestiti via query param `?token=`: form "richiedi reset" (no token) e form "imposta nuova password" (con token).
- `src/app/(auth)/actions.ts` aggiungere:
  - `requestPasswordResetAction(email)` — genera `VerificationToken` tipo `PASSWORD_RESET`, invia email via provider.
  - `confirmPasswordResetAction(token, newPassword)` — valida (non used, non expired), hash bcrypt 12, update `User.passwordHash`, marca token `used`.
- Link "Password dimenticata?" in `/login`.

In DEMO il link viene mostrato anche in pagina dopo la richiesta.

### 5.3 Anteprima/download documenti

Nuova route `src/app/api/documenti/[id]/route.ts` — `GET` con auth check:
- Solo l'utente la cui `companyId` è `pratica.brokerCompanyId` o `pratica.agenziaAssegnataId` (o admin) può scaricare.
- Stream del file via `getStorage().get(documento.storageKey)`.
- Header: `Content-Disposition: attachment; filename="<originalFilename>"`, `Content-Type: <mimeType>`.

UI: pulsanti "Scarica" nella sezione documenti del dettaglio pratica (lato dealer e agenzia).

### 5.4 Inviti utenti secondari

Schema `Invitation` esiste già.

Da costruire:
- Server actions `src/app/(auth)/team/actions.ts`:
  - `createInvitationAction(email)` — crea `Invitation` con token UUID, `expiresAt = now + 7gg`, invia email "invito".
  - `acceptInvitationAction(token, password)` — crea `User` con role `UTENTE_AZIENDA` collegato alla `companyId` dell'invito.
  - `revokeInvitationAction(invitationId)` — marca `status=REVOKED`.
- Pagina `/team` (solo `ADMIN_AZIENDA`): lista utenti azienda + form invio invito + lista inviti pending con pulsante "Revoca" / "Reinvia".
- Pagina pubblica `/invito/[token]`: form "imposta password" → crea User.
- Email N invito: nuovo template "Sei stato invitato in [ragione sociale] su Passaggio Veloce".
- Voce "Team" nella nav admin azienda.

### 5.5 UI payout broker reale

`src/app/wallet/page.tsx` — sostituisce il placeholder:
- Pulsante "Richiedi payout manuale" abilitato se saldo tra 50.000 e 99.999 cent (500-999€):
  - Crea `Payout` con `stato=RICHIESTO`, `automatico=false`.
  - Toast: "Richiesta inviata. L'admin la processerà a breve. (In demo: vai su Demo Control → Processa payout pendenti.)"
- Sopra 1.000€: badge "Payout automatico abilitato" (in DEMO: nota "trigger via Demo Control").

### 5.6 Assegnazione manuale escalation admin

Pagina `/admin/escalation` esiste già (lista pratiche `IN_ESCALATION`). Aggiungere:
- Pulsante "Assegna a..." su ogni riga → dropdown con agenzie attive nella provincia della pratica.
- Server action `assegnaEscalationAction(praticaId, agenziaId)`:
  - Crea `PraticaAssegnazione` con `round=99` (escalation manuale).
  - Aggiorna stato pratica → `ASSEGNATA`.
  - Invia N6 (modificata: "Pratica assegnata manualmente dall'admin") all'agenzia.
  - Invia N11 (modificata) al dealer.

---

## 6. Seed narrativo

File: `packages/db/prisma/seed.ts` — esteso, deterministico, idempotente (`upsert` con id stabili).

### 6.1 Account demo precostituiti

Password unica: `DemoPass2026!` (documentata in README e su pagina di login DEMO).

| Email | Ruolo | Company | Note |
|---|---|---|---|
| `admin@demo.passaggioveloce.it` | ADMIN_PIATTAFORMA | — | Accede a Demo Control |
| `dealer@demo.passaggioveloce.it` | ADMIN_AZIENDA (dealer) | "Demo Auto Srl" (Padova) | Saldo wallet 1.250€ |
| `dealer-junior@demo.passaggioveloce.it` | UTENTE_AZIENDA | "Demo Auto Srl" | Per testare multi-utente |
| `agenzia@demo.passaggioveloce.it` | ADMIN_AZIENDA (agenzia) | "Demo Pratiche Auto Snc" (Padova) | 12 valutazioni, rating 4.6⭐ |

### 6.2 Cast aggiuntivo

**Dealer** (3 totali):
- "Auto Veneto Srl" (Venezia) — saldo 480€
- "Concessionaria Treviso Spa" (Treviso) — saldo 0€

**Agenzie** (8 totali, tutte attive con orari standard lun-ven 9-13/15-18:30, sab 9-12):
- 2 Padova (incl. demo) — rating 4.6, 4.2
- 2 Venezia — rating 4.8, 3.9
- 2 Treviso — rating 4.5, 4.0
- 1 Vicenza — rating 4.3
- 1 Verona — rating 2.3 → **automaticamente sospesa** (sotto MIN_AVG_TO_STAY_ACTIVE)

### 6.3 Pratiche con stati misti (~30)

| Stato | Quantità |
|---|---|
| BOZZA | 2 |
| IN_ATTESA_ROUND_1 | 5 |
| IN_ATTESA_ROUND_2 | 2 |
| IN_ATTESA_ROUND_3 | 1 |
| ASSEGNATA | 4 |
| FIRMATA | 12 |
| IN_ESCALATION | 2 |
| ANNULLATA_DEALER | 2 |

Per ognuna: `Documento` libretto fittizio (PDF placeholder ~10KB generato al volo), OCR data deterministico, comune/provincia coerenti.

### 6.4 Wallet & finanza

- "Demo Auto Srl": saldo 1.250€, ~15 transazioni (mix `CREDITO_PRATICA` + 1 `PAYOUT_AUTOMATICO` storico + 1 `RETTIFICA_ADMIN`)
- "Auto Veneto Srl": saldo 480€, 5 transazioni
- "Concessionaria Treviso": saldo 0€
- 3 `FeeAddebito SCHEDULED` con `autoAddebitoAt` già scaduto → cliccando "Processa addebiti" diventano `SUCCESS` subito
- 1 `Payout RICHIESTO` → processabile da Demo Control

### 6.5 Valutazioni storiche

L'agenzia demo ha 12 valutazioni storiche tra 4 e 5 stelle. Una con `segnalazioneAbuso=true` per popolare la futura UI segnalazioni.

### 6.6 Idempotenza

Tutti i record creati con `upsert` su id deterministici (cuid ricalcolato da hash dell'email). Eseguire `pnpm db:seed` due volte non duplica.

---

## 7. Deploy Vercel + Neon + Vercel Blob

### 7.1 Setup Neon

1. Account Neon (free tier, 3GB) → progetto `passaggio-veloce-demo`.
2. Branch `main` Neon = DB demo.
3. Due connection string:
   - `DATABASE_URL` (pooled, porta 6543, per app Next.js serverless)
   - `DIRECT_URL` (direct, porta 5432, per `prisma migrate deploy`)
4. `packages/db/prisma/schema.prisma` — aggiungere `directUrl = env("DIRECT_URL")` al datasource.

### 7.2 Setup Vercel Blob

1. Vercel dashboard → Storage → Create Blob Store → `BLOB_READ_WRITE_TOKEN`.
2. Installare `@vercel/blob` in `apps/piattaforma`.
3. Implementare `VercelBlobStorageProvider`.
4. Update `src/lib/providers/storage/index.ts` per case `vercel-blob`.

### 7.3 Setup progetto Vercel

1. Importo repo GitHub su Vercel (richiede push del codice su GitHub prima — verificare stato remote).
2. Root directory: `apps/piattaforma`.
3. Build command: `cd ../.. && pnpm build --filter piattaforma...`
4. Install command: `cd ../.. && pnpm install --frozen-lockfile`
5. Env vars (production + preview):

```
DATABASE_URL=<neon-pooled>
DIRECT_URL=<neon-direct>
BLOB_READ_WRITE_TOKEN=<vercel-blob-token>
STORAGE_PROVIDER=vercel-blob
EMAIL_PROVIDER=console
OCR_PROVIDER=mock
PAYMENT_PROVIDER=mock
DEMO_MODE=true
NEXTAUTH_URL=https://passaggio-veloce-demo.vercel.app
NEXTAUTH_SECRET=<openssl rand -base64 32>
SENTRY_DSN=
```

### 7.4 Migrazioni e seed in produzione

Procedura primo deploy demo (manuale dal terminale locale):

```bash
DATABASE_URL=<neon-direct> DIRECT_URL=<neon-direct> pnpm --filter @pv/db db:migrate deploy
DATABASE_URL=<neon-direct> DIRECT_URL=<neon-direct> pnpm --filter @pv/db db:seed
```

Documentare nel README sezione "Procedura primo deploy demo".

### 7.5 Deploy automatico

- Push su `main` → deploy production automatico.
- PR → preview deploy automatico.
- Hobby plan: 100GB bandwidth/mese, 6.000 build minutes/mese.

### 7.6 Dominio

Default Vercel: `passaggio-veloce-demo.vercel.app` (HTTPS automatico). Custom domain rinviato.

### 7.7 Rischi noti e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Cold start Neon free (~1s primo hit dopo idle) | Accettabile per demo |
| Vercel serverless 10s timeout su Hobby | Job admin restano sotto (cap 30 record per click) |
| Build failure prima volta per problemi monorepo | Test su preview prima di production |
| Connection limit Neon free (~100) | Useremo URL pooled |
| Vercel Blob free tier 1GB | Adeguato per 30 pratiche seed + ~20 upload extra |

---

## 8. Stima lavoro

| Macro-blocco | Stima |
|---|---|
| Sezione 2: Env flag + Banner DEMO + comportamenti differenziati | 0.5 gg |
| Sezione 3: MockPaymentProvider + VercelBlobStorageProvider | 0.5 gg |
| Sezione 4: `/admin/demo-control` + 5 jobs | 1 gg |
| Sezione 5.1-5.2: Auto-verify + reset password | 0.5 gg |
| Sezione 5.3: Anteprima/download documenti | 0.5 gg |
| Sezione 5.4: Inviti utenti secondari | 1 gg |
| Sezione 5.5: UI payout broker reale | 0.25 gg |
| Sezione 5.6: Assegnazione manuale escalation | 0.25 gg |
| Sezione 6: Seed narrativo | 0.75 gg |
| Sezione 7: Deploy Vercel + Neon + Blob + smoke test | 1 gg |
| Buffer + adjustments | 0.75 gg |
| **TOTALE** | **~7 gg uomo (1.5-2 settimane)** |

---

## 9. Criteri di accettazione

Lo sprint è considerato completo quando, sul deploy `passaggio-veloce-demo.vercel.app`:

1. Un utente nuovo può registrarsi come dealer o agenzia, vedere il banner DEMO, completare il wizard e accedere alla propria dashboard senza ricevere email reali.
2. Un dealer può creare una nuova pratica, caricare un libretto (mock OCR), inviarla, vederla distribuita ad agenzie reali del seed, monitorarne lo stato.
3. Un'agenzia (account demo o registrata) può accettare/rifiutare la pratica, generare il codice pratica, scaricare i documenti del dealer, marcare la firma.
4. Alla firma, il dealer vede l'accredito sul wallet e l'agenzia vede il `FeeAddebito SCHEDULED`.
5. L'admin demo può: vedere le email simulate, processare addebiti/payout/solleciti, avanzare tick distribuzione, assegnare manualmente una pratica in escalation.
6. Un admin azienda può invitare un secondo utente, l'invitato può accettare e accedere.
7. Tutti e tre gli account demo precostituiti funzionano al primo accesso con la password documentata.
8. Il deploy si auto-rigenera al push su `main`.
9. README aggiornato con: account demo, password, URL demo, procedura primo deploy, link a questo design doc.

---

## 10. Riferimenti

- `docs/piano-implementazione.md` — roadmap MVP completa
- `apps/piattaforma/src/lib/providers/email/` — pattern provider abstraction (modello)
- `apps/piattaforma/src/lib/providers/storage/` — pattern provider abstraction (modello)
- `packages/db/prisma/schema.prisma` — schema dati (già pronto)
- `packages/db/prisma/seed.ts` — seed da estendere
