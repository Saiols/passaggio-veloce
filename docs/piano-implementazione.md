# Passaggio Veloce - Piano di Implementazione MVP

> Documento operativo con checkbox per tracciare l'avanzamento lavori.
> Basato su: `riassunto-progetto.md`, `analisi-progetto.md`, `stima-costi.md`, Mockup, Policy Prezzi, Visione Strategica, Organigramma, CRM.
> Ultimo aggiornamento: 2026-07-19 (A12 distribuzione raggio-km + pool cumulativo, A13 giustificativo interno costo promo — vedi §0.5 e Mappa lavoro residuo)

> **Release post-demo 2026-05:** vedi `docs/bugfix-feature-list.md` (19/19 item completati e in prod).

> **Spec attive da implementare:**
> - `docs/sistema-penali-broker.md` — popup pre-invio, segnalazione agenzia, penale €25 × veicolo segnalato, wallet negativo (3 bundle SP-A/B/C) ✅ in prod
> - `docs/schema-documentale-v7.md` — engine documentale + wizard branching + revisione manuale (4 bundle SD-A/B/C/D, ultimo richiede AI/OCR account esterno) ✅ A/B/C in prod
> - `docs/crm-spec-implementativa.md` — CRM interno team PV (Pipeline Lead, Sales Agents, Campagne, Chatbot, Dashboard, RBAC interno). 8 bundle CRM-A..H. Sostituisce il placeholder "FASE 14 differita".
> - `docs/sistema-fatturazione.md` — modello fatturazione delegata + sezione UI admin/agenzia/broker (5 bundle FT-A/B/C/D/E). Sostituisce il vecchio "rendiconto + fattura broker" di FASE 5.2/5.3. Bloccato su B1 commercialista per parte XML/IVA, fondamenta UI fattibili.

---

## Legenda stato

- [ ] Da fare
- [~] In corso
- [x] Completato
- [!] Bloccato (vedi nota)

---

## FASE 0 - Pre-sviluppo (blocchi da sciogliere prima di toccare codice)

### 0.1 Decisioni strategiche aperte
- [x] Naming definitivo prodotto: **Passaggio Veloce**
- [ ] Registrazione dominio passaggioveloce.it + PEC aziendale
- [ ] Logo, brand identity, palette colori
- [ ] Area geografica di lancio (città/regione pilota)
- [ ] Definizione competitor diretti e posizionamento

### 0.2 Blocchi legali/fiscali
- [x] Validazione commercialista modello fatturazione delegata — **CONFERMATO 2026-06-17** (split forfettario 55+20, TD01/TD06/ricevuta privato, IVA forfettario, numerazione progressiva). Sblocca FT-D XML (fatto). Resta gated solo l'account provider SDI (A-Cube).
- [x] Definizione fallback se nessuna agenzia accetta la pratica entro il round 3 (vedi §0.5)
- [ ] Redazione T&C con clausola limitazione responsabilità + autorizzazione SEPA
- [ ] Informativa privacy GDPR (dati sensibili CI/CF/visura)
- [x] Policy data retention documenti caricati — `lib/documenti/retention.ts` (hard-delete 90gg, purge bozze 30gg) + job purge + Vercel cron daily 03:30
- [ ] Contratto tipo agenzia (obbligo +100 EUR, divieto sovraccarico)
- [ ] Contratto tipo dealer/broker (wallet, payout, fatturazione)

### 0.3 Setup societario e team
- [ ] Costituzione società
- [x] CTO socio fondatore: **Francesco Sioli**
- [ ] Identificazione commercialista / CFO esterno
- [ ] Identificazione Sales & Business Dev

### 0.4 Architettura e stack
- [ ] PRD tecnico completo
- [x] Scelta definitiva stack (Next.js 16 + TypeScript + PostgreSQL + Prisma) — vedi `stack-tecnico.md`
- [ ] Scelta provider IA/OCR (Google Document AI candidato + benchmark)
- [x] Scelta provider pagamenti: Stripe (da validare con commercialista)
- [x] Scelta provider email transazionale: Resend
- [ ] Scelta provider SDI fatturazione elettronica
- [ ] Scelta CRM vendite: **HubSpot** vs **Airtable** (decisione CTO — vedi `crm-architettura.md` §8)
- [ ] Scelta orchestratore automazioni CRM: Make (ex Integromat) confermato
- [ ] Scelta provider bot AI voce: Vapi.ai confermato (da budgetare)
- [ ] Scelta provider mail tracking outbound: Lemlist vs Customer.io
- [ ] Scelta provider video tracking tutorial: Wistia confermato
- [ ] Scelta provider SMS + VoIP chiamate: Twilio confermato
- [ ] Disegno architettura ambienti (dev / staging / prod)
- [~] Schema database iniziale (ERD) — scaffold base in `packages/db/prisma/schema.prisma`
- [~] Definizione data model utenti, pratiche, wallet, notifiche, valutazioni — base Company/User creata

### 0.5 Distribuzione pratica — raggio-km + pool cumulativo ✅ SHIPPED 2026-07-19

**Obiettivo:** garantire che ogni pratica trovi un'agenzia rispettando gli orari di lavoro reali delle agenzie, senza dare al dealer informazioni superflue.

> **Storico:** il disegno originale sotto (proposta iniziale, mai del tutto implementata) usava round per **comune → comuni limitrofi (15 km) → provincia intera**, cap `N`=5 agenzie/round 1-2 e `Nmax`=15 al round 3, selezione/ordinamento per ranking. **Sostituito il 2026-07-19** dal modello a raggio-km reale documentato qui sotto — vedi `superpowers/specs/2026-07-19-distribuzione-raggio-km-design.md` e changelog **A12** (§ Mappa lavoro residuo).

#### Orari di lavoro per agenzia
- Ogni agenzia, in fase di registrazione (e poi modificabile dal profilo), inserisce i propri **giorni e orari di apertura** (es. Lun-Ven 9:00-13:00 / 15:00-18:30, Sab 9:00-12:00, Domenica chiuso)
- Possibili più fasce orarie nello stesso giorno
- Possibilità di marcare giorni di chiusura straordinaria (ferie)
- Il countdown della pratica per ogni singola agenzia scorre **solo** durante le sue ore di apertura
- Le agenzie sono libere di indicare anche sabato pomeriggio / domenica se aperte

#### Comportamento broker
- Il broker può inviare la pratica **24/7** senza vincoli
- Il broker **deve selezionare il luogo di consegna dall'autocomplete** Google Places: le coordinate (`lat`/`lng`) sono **obbligatorie** al submit e guidano la distribuzione — non basta digitare comune/provincia a mano
- Notifica al broker: solo "Pratica inviata" + codice pratica + numero di agenzie contattate
- **Nessuna informazione** su orari delle singole agenzie o tempi attesi (rumore inutile, le agenzie hanno orari diversi)
- La dashboard mostra lo stato corrente (`in_attesa`, `accettata`, `in_escalation`) ma non countdown visibili al broker

#### Parametri (`lib/distribuzione/constants.ts`)
- `RAGGI_KM = [0.5, 0.75, 1]` → round 1 = **500 m**, round 2 = **750 m**, round 3 = **1000 m** dal luogo di consegna (distanza reale Haversine, non provincia/comune)
- `T1_HOURS`/`T2_HOURS`/`T3_HOURS` = **4h / 4h / 4h** lavorative (~12h totali, non più 8h/8h/16h)
- **Nessun cap** per round: spariti `N`=5 e `Nmax`=15 — **tutte** le sedi idonee nell'anello ricevono l'assegnazione simultaneamente
- Sedi senza `lat`/`lng` **escluse** dalla selezione (geocoding a monte + backfill + visibilità admin sulle non geocodate)

> Nota: il countdown è **per-agenzia**, basato sulle sue ore di apertura. A differenza del disegno originale, l'avanzamento di round **non chiude** le agenzie del round precedente: il pool è **cumulativo** — restano `PENDING` e accettabili finché qualcuno accetta o si arriva a escalation.

#### Flusso a raggio-km + pool cumulativo

1. **Round 1 — 500 m dal luogo di consegna**
   - Invio a **tutte** le sedi agenzia idonee (coordinate presenti, non sospese/eliminate, azienda madre non bloccata/sospesa, visura valida) entro 500 m
   - Ogni agenzia riceve notifica N6 immediatamente (anche fuori orario, l'email resta in inbox)
   - Countdown di 4h parte per ciascuna agenzia all'apertura della propria prima fascia oraria utile
   - Se almeno 1 accetta → flusso normale, le altre vengono notificate "pratica già assegnata"
   - Stato pratica: `IN_ATTESA_ROUND_1`

2. **Round 2 — estensione a 750 m**
   - Trigger automatico quando **tutte** le `PENDING` (di qualunque round, non solo quello corrente) hanno esaurito la finestra senza che nessuno accetti
   - Si aprono le sedi **nuove** nella corona 500m→750m; le sedi del round 1 **restano `PENDING`** (nessun TIMEOUT, pool cumulativo) e vengono **ri-armate** con una finestra fresca di 4h
   - Stato pratica: `IN_ATTESA_ROUND_2`

3. **Round 3 — estensione a 1000 m**
   - Stesso meccanismo sulla corona 750m→1000m; tutte le `PENDING` precedenti restano accettabili e vengono ri-armate
   - **Anello vuoto → cascade immediato** al raggio successivo nello stesso tick (nessuna attesa se non ci sono sedi nuove; vuoto anche a 1 km → escalation immediata)
   - Stato pratica: `IN_ATTESA_ROUND_3`

4. **Escalation admin**
   - Round 3 scaduto senza che nessuno accetti → **TIMEOUT a tutte le `PENDING`** + stato `IN_ESCALATION` (qui scatta l'anti-abuso sui no-show)
   - Notifica N10 all'admin con priorità alta
   - Notifica N11 al dealer: "la pratica è in gestione al nostro team, ti contatteremo a breve"
   - L'admin può: assegnare manualmente a un'agenzia partner di fiducia, contattare il dealer, annullare

5. **Annullamento volontario**
   - In qualsiasi momento, il dealer può annullare la pratica dalla dashboard senza costi
   - I documenti restano salvati come bozza per 30 giorni

#### Ranking e anti-abuso
- Il **ranking non seleziona più i candidati** (era così nel disegno originale sopra): la selezione è **solo a raggio-km**, tutte le sedi nell'anello ricevono la pratica, nessun ordinamento/tie-break per rating. Il ranking (media valutazioni, soglia 5 per essere "rankata", evidenza rating <2.5) resta **solo un badge visivo per l'admin** su `/admin/agenzie`, **senza alcun effetto operativo** su distribuzione o sospensione.
- **Auto-sospensione**: solo timeout/no-show. 5 `TIMEOUT` consecutivi sulla stessa sede (non intervallati da un'accettata/rifiutata) → `Sede.suspendedAt` automatico (`ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD`). **Nessun decay** per rifiuti espliciti (il rifiuto esclude quella sede dal pool per quella pratica, non penalizza il ranking).

#### Audit e KPI da tracciare
- % pratiche risolte al round 1 / 2 / 3 / escalation
- Tempo medio reale di assegnazione (clock time) e tempo lavorativo
- Zone scoperte (escalation per assenza di sedi entro 1 km — segnale onboarding commerciale agenzie)
- Top agenzie per tasso di accettazione e tasso di rifiuto
- Copertura geocoding sedi agenzia attive (sedi senza `lat`/`lng` = zero pratiche ricevute)

---

## FASE 1 - Fondamenta tecniche

### 1.1 Setup progetto
- [x] Repository Git + branching strategy (trunk-based, conventional commits)
- [x] Monorepo pnpm + Turborepo (apps/piattaforma + packages/db, lib, config, ui, email)
- [x] CI base GitHub Actions (`.github/workflows/ci.yml` — lint + typecheck + build)
- [x] Ambiente dev locale documentato (README + stack-tecnico.md + Docker Compose Postgres)
- [ ] Ambiente staging
- [ ] Ambiente produzione
- [x] Secret management base (.env.example versionato, .env.local ignorato)
- [x] Sentry integrato in Next.js (no-op se DSN vuoto, attivabile con env var)
- [ ] Backup automatici DB

### 1.2 Infrastruttura
- [ ] Hosting backend (Vercel scelto, da provisionare)
- [ ] Storage S3-compatible con encryption at rest
- [ ] CDN per assets statici
- [ ] Dominio + certificati SSL
- [ ] Email transazionale configurata (SPF/DKIM/DMARC)
- [ ] Scheduler/cron jobs infrastruttura
- [x] Database Postgres locale via Docker Compose (`docker-compose.yml`)
- [x] Prima migrazione applicata (`init`)

### 1.3 Database e modelli base
- [x] Schema utenti (admin, dealer, agenzia) con multi-utente
- [x] Schema aziende (ragione sociale, P.IVA, SDI, PEC, IBAN)
- [x] Schema documenti caricati (metadata + ref storage, OCR + gating fields)
- [x] Schema pratiche (tipo, stato, timeline, codicePratica) + `PraticaAssegnazione` per round 1/2/3
- [x] Schema wallet broker + transazioni (importi in centesimi, saldo-post per audit)
- [x] Schema fee / addebiti (tipo firma / auto-addebito-giorno-20)
- [x] Schema valutazioni agenzie (5⭐ + segnalazione abuso)
- [x] Schema listini raccolti
- [x] Schema notifiche inviate (audit con canale/stato/providerRef)
- [x] Schema orari apertura + chiusure straordinarie (engine ore lavorative)
- [x] Sistema migrazioni versionate configurato (Prisma Migrate)
- [x] Seed dev: 1 admin + 2 dealer + 3 agenzie + 5 pratiche stati misti

---

## FASE 2 - Auth, Registrazione, Multi-utente

### 2.1 Registrazione (stesso form dealer/agenzia)
- [x] Form registrazione azienda (ragione sociale, P.IVA, SDI, PEC, indirizzo)
- [x] Form dati amministratore (Nome, Cognome, data/luogo nascita, CF)
- [x] Upload CI + CF amministratore (attivato in Fase 3 con storage — step 3 registrazione)
- [x] Upload Visura Camerale (max 6 mesi) — campo data + validazione + storage
- [x] Inserimento IBAN + flag autorizzazione SEPA (mandato Stripe reale in Fase 5)
- [x] Accettazione T&C con timestamp (registro IP da aggiungere)
- [~] Verifica email — token generato e tabella `verification_tokens` pronta; invio email reale in Fase 6
- [x] Approvazione automatica account (stato `PENDING_EMAIL_VERIFICATION` → `ACTIVE`)
- [x] Selezione ruolo (dealer / agenzia) in fase di registrazione
- [x] Step aggiuntivo per agenzia: inserimento orari di apertura — pagina `/orari` con fasce settimanali salvate su `OrariApertura`
- [x] **UTM capture**: cookie first-touch `pv_utm` (utm_source/medium/campaign/content) catturato in landing, persistito alla registrazione sui nuovi campi `Company.utmSource/utmMedium/utmCampaign/utmContent`. Enrichment CRM conservativo (`tryMatchCrmContact` setta `CrmContact.fonte=REFERRAL` solo se `company.referenteId` presente, preservando la fonte storica del lead). Il param referral `ref` era già gestito separatamente.
- [ ] **Webhook `user.signup.started`** emesso all'apertura del wizard Step 1 (evento pixel CRM §3.4)
- [ ] **Webhook `user.signup.completed`** emesso al termine del wizard (Caso A/B §4 doc CRM)
- [ ] Outbox `CrmOutboundEvent` + worker retry con backoff (vedi `crm-architettura.md` §10.4)

### 2.2 Auth e sicurezza
- [x] Login con Auth.js v5 (Credentials provider, JWT strategy)
- [x] Password policy (min 10, maiusc/minusc/numero) + hashing bcrypt 12 rounds
- [~] Reset password — pagina placeholder, flusso reale in Fase 6
- [x] 2FA opzionale — TOTP (authenticator app) + backup codes, ENFORCED al sign-in (non email/OTP): `authorize` verifica TOTP o backup code, `loginAction` pre-check `needTotp` per il secondo step
- [ ] Rate limiting login
- [ ] Audit log accessi (campo `lastLoginAt` già presente)

### 2.3 Multi-utente e ruoli
- [x] Modello dati `Invitation` pronto, ruoli `ADMIN_AZIENDA` / `UTENTE_AZIENDA` / `ADMIN_PIATTAFORMA`
- [ ] UI gestione utenti secondari
- [ ] Invito utenti via email (server action, da fare nel prossimo chunk)
- [ ] Accettazione invito + creazione utente secondario
- [ ] Revoca accessi

---

## FASE 3 - Core: Documenti, IA, Pratiche

### 3.1 Storage e upload documenti
- [x] Upload file (PDF, JPG, PNG) con limite dimensione (10 MB, via wizard pratica)
- [x] Provider abstraction `StorageProvider` con impl locale (`./uploads/`) swap-ready a S3
- [ ] Anteprima documenti (richiede route serve file + auth check)
- [ ] Encryption at rest (S3 SSE quando swap)
- [x] Download singolo + download ZIP pratica completa — download singolo già disponibile; ZIP completato via `buildPraticaZip` (jszip) + endpoint `app/api/pratiche/[id]/zip/route.ts` (auth ownership, nodejs runtime, force-dynamic)
- [x] Soft delete + retention policy — `lib/documenti/retention.ts` + job `purge-deleted-documenti` + Vercel cron daily 03:30 (hard-delete 90gg, purge bozze 30gg)

### 3.2 OCR libretto di circolazione
- [x] Provider abstraction `OcrProvider` con `MockOcrProvider` (dati plausibili deterministici su hash buffer)
- [x] Estrazione targa, telaio, proprietario, data immatricolazione (mock)
- [x] Rilevamento veicolo pre-2015
- [x] Rilevamento comodato d'uso (mock flag)
- [x] UI correzione dati estratti (wizard step 1, form editabile pre-submit)
- [ ] Fallback manuale in caso di OCR fallito (richiede UI skip)
- [x] Integrazione Mindee SDK V2 + modello pre-trained "European Vehicle Registration" (Fase 1 sprint OCR, 2026-05) — spec `docs/superpowers/specs/2026-05-25-ocr-sprint-design.md`, plan `docs/superpowers/plans/2026-05-25-ocr-mindee-fase1.md`. Smoke test 2026-05-30 ✅: estrazione campi targa/telaio/proprietario/data funzionante in prod test, accuratezza sub-ottimale su targa italiana (atteso, modello generico EU non specifico libretto IT — Fase 2 Document AI custom-trained riadrà il gap). Fix tecnici applicati durante smoke: schema drift Neon Production, undici no-keep-alive dispatcher (other side closed), polling stretto, maxDuration=60s, banner UX con spinner per attesa 30-60s.
- [ ] Integrazione Google Document AI (richiede account, swap del provider)

### 3.3 Gating documentale IA (killer feature)
- [x] Schema `Documento.gatingStato` (PASSED/FAILED/PENDING/OVERRIDDEN/NONE) + `GatingStato` enum
- [ ] Classificatore tipo documento (CI, CF/Tessera Sanitaria, Visura, Permesso soggiorno, Procura, Libretto)
- [ ] Verifica fronte/retro CI
- [ ] Verifica leggibilità / scadenza
- [ ] Blocco invio pratica se un documento non passa la validazione
- [ ] Messaggi errore chiari all'utente
- [ ] Override manuale admin (caso eccezionale)
- [ ] Test set di validazione con documenti reali (non PII)
- [ ] Wizard: step aggiuntivo con upload CI venditore / CI acquirente / CF / visura

### 3.4 Dashboard Broker - flusso pratica
- [x] Step 1: tipo pratica (trapasso netto / minivoltura) + upload libretto + OCR + conferma dati
- [x] Step 2: dati venditore + acquirente + flag (cointestazione, minivoltura, procura)
- [x] Step 3: selezione comune + provincia + riepilogo + invio
- [x] Pratica inviata → redirect a detail + assegnazioni round 1 create
- [ ] Mappa agenzie (richiede coordinate)
- [ ] Salva bozza pratica (stato BOZZA esiste ma non è persistito dal wizard)
- [x] Lista pratiche con stato + filtri (stato / periodo) + ricerca (targa, codice, proprietario) + paginazione
- [x] Dettaglio pratica con timeline + round distribuzione + parti commerciali
- [x] Azione "Annulla pratica" (broker) — transazionale

### 3.5 Lotto massivo
- [ ] Flusso dedicato: 1 acquirente, N venditori, N libretti
- [ ] Upload bulk libretti con OCR batch
- [ ] Generazione pratiche in serie
- [ ] Fee 15 EUR/veicolo

---

## FASE 4 - Distribuzione pratica e Dashboard Agenzia

### 4.1 Algoritmo distribuzione
- [x] Ricerca sedi agenzia **per raggio-km reale** dal luogo di consegna (Haversine su `lat`/`lng`, `distanceKm`) — **SHIPPED 2026-07-19**, sostituisce comune/provincia (vedi §0.5)
- [x] ~~Ordinamento per rating~~ **rimosso 2026-07-19**: nessuna selezione/ordinamento per ranking, tutte le sedi nell'anello ricevono la pratica; il ranking resta solo badge visivo admin
- [x] Soglia minima 5 valutazioni per il badge "rankata" (`RANKING.MIN_RATINGS_FOR_RANK`) — solo visualizzazione admin, nessun effetto su selezione/sospensione
- [x] Gestione race condition "prima che accetta vince" (transazione accept chiude altre PENDING come ASSEGNATA_ALTRO)
- [x] Implementazione flusso raggio-km (500/750/1000 m) + pool cumulativo + escalation (vedi §0.5)
- [x] Countdown per-agenzia basato sui suoi orari di apertura (finestre 4h/4h/4h)
- [x] Engine "ore lavorative" (calcolo finestre, esclusione ChiusuraStraordinaria, multi-fascia)
- [x] Trigger passaggio round successivo (on-event via reject, on-schedule via tickPratica) — pool cumulativo: le `PENDING` dei round precedenti si ri-armano, non vanno in TIMEOUT
- [x] Stato pratica `IN_ATTESA_ROUND_1/2/3`, `IN_ESCALATION`
- [x] UI admin per visualizzazione escalation (`/admin/escalation`)
- [ ] UI admin per assegnazione manuale a partner di fiducia (solo lista, non ancora assign)
- [x] Invio notifiche (N6) solo alle sedi **nuove** che entrano nel raggio del round corrente
- [x] Endpoint `/api/jobs/distribuzione-tick` + pulsante admin manuale
- [x] Cron automatico scheduling (Vercel Cron, vedi A2)
- [x] ~~Anti-abuso ranking (decay rifiuti consecutivi)~~ **rimosso**: resta solo auto-sospensione su 5 TIMEOUT consecutivi (no-show), nessun decay per rifiuti
- [ ] KPI dashboard fallback (% per round, tempi medi, zone critiche)
- [x] Raggio km reale (Haversine su `lat`/`lng`) — **SHIPPED 2026-07-19**, sostituisce la mappa province limitrofe hardcoded (rimossa `province-limitrofe.ts`)

### 4.2 Dashboard Agenzia
- [x] Lista pratiche in arrivo (`/inbox` con PENDING + storico ultime decisioni)
- [x] Pulsante Accetta / Rifiuta (transazionale, con motivazione rifiuto opzionale)
- [ ] Messaggio "Dossier completo e verificato da TF" (aspetta gating IA completo)
- [x] Download singolo + ZIP pratica — ZIP completato: il pulsante "Scarica ZIP" su `/pratiche/[id]` (prima placeholder) ora chiama l'endpoint reale `app/api/pratiche/[id]/zip/route.ts`
- [x] Generazione codice pratica (`PV-YYYY-NNNNN`)
- [ ] Campo codice pratica interno agenzia + note (campo DB presente, UI da fare)
- [x] Countdown 20 giorni visibile — `lib/pratiche/countdown.ts` (`computeGiorniResidui` + `countdownLevel`), countdown ora mostrato in UI dashboard agenzia
- [x] Pulsante "Firma avvenuta" (Step 3) — transazionale: pratica FIRMATA + credito wallet broker + FeeAddebito SCHEDULED
- [x] Storico pratiche completate (`/pratiche` filtrabile per stato)
- [x] Riepilogo fee mensili e auto-addebiti — `lib/fee/recap.ts` (`groupFeeByMonth`), nuova pagina `/addebiti` + voce nav AGENZIA, sezione "Prossimi addebiti" sulla dashboard agenzia

---

## FASE 5 - Pagamenti, Wallet, Fatturazione (MODULO CRITICO)

> **Prerequisito:** validazione commercialista completata (blocco 0.2)

### 5.1 Addebito agenzia
- [ ] Integrazione Stripe SEPA / card (bloccato su validazione commercialista)
- [x] Creazione `FeeAddebito` schedulato al flag "firma avvenuta" (Stripe reale in follow-up)
- [x] Schedulazione auto-addebito giorno 20 (campo `autoAddebitoAt`, esecuzione reale con cron Stripe)
- [ ] Gestione fallimenti addebito + retry
- [x] Audit trail addebiti (tabella `FeeAddebito` con stato/errorMessage/providerRef)
- [x] Notifica agenzia pre-addebito automatico (N8 al momento della firma)

### 5.2 Wallet broker
- [x] Accredito automatico per trapasso netto a firma confermata (25 EUR ord / 20 EUR forf — split dinamico per regime, vedi `sistema-fatturazione.md` §1.1)
- [x] Visualizzazione saldo wallet (`/wallet`)
- [x] Storico movimenti (ultimi 20 con saldo-post per audit)
- [x] Soglia <500 EUR: nessun payout (logica frontend + badge)
- [x] Soglia 500-999 EUR: alert payout manuale disponibile
- [ ] Pulsante richiesta payout manuale (UI placeholder — Stripe in Fase 5)
- [ ] Soglia ≥1000 EUR: payout automatico (logica da implementare + cron)
- [x] Generazione rendiconto payout (PDF) — A6 in prod
- [~] Modello fatturazione: passaggio dal vecchio "rendiconto → fattura broker manuale" al nuovo modello delegato (vedi `docs/sistema-fatturazione.md`)

### 5.3 Fatturazione (riferimento: `docs/sistema-fatturazione.md`)

**Modello adottato:** fatturazione delegata stile Booking/Airbnb. PV emette per conto del broker, broker trasmette allo SDI.

> **STATO 2026-06-17 (in deploy su `main`):** commercialista ha **confermato il modello fiscale** (split, TD01/TD06/TD04, IVA forfettario, no-XML privato). IMPLEMENTATI: FT-A schema/engine, FT-B, FT-C (KPI+CSV), **FT-D parte nostra** (PDF, segna-trasmesso, **generatore XML FatturaPA**, mapper, route download XML, adapter provider+mock).
> **Provider deciso:** **A-Cube** = motore d'integrazione (via adapter, gated su account) + **Fatture in Cloud** = strumento manuale. La **trasmissione SDI reale resta gated** sull'account A-Cube.
> **Restano (parte nostra):** raccolta dati fiscali + OTP in registrazione (FT-A wizard), notifiche N26-30 + cron (FT-C), QR nel PDF, FT-E.

**Bundle FT-A — Schema + iscrizione** _(schema FATTO; wizard fiscale/OTP/seed DA FARE)_
- [x] Migrazione `RegimeFiscale` enum + estensione `Company` (numeratore fiscale annuale, OTP, accettazione clausola delega, regime fiscale) — migration `fatturazione_ft_a`
- [x] Migrazione `DocumentoFiscale` (modello + enum: tipo, FatturaPaTipo, statoPagamento) — migration `fatturazione_ft_a` + `fattura_destinatario_nullable`
- [~] Wizard broker: **regimeFiscale RACCOLTO** in registrazione (Step Azienda, solo DEALER, ORDINARIO/FORFETTARIO; persistito su Company) — 2026-06-17. Restano: P.IVA condizionale per PRIVATO + checkbox delega esplicito
- [ ] Wizard agenzia: validazione "SDI OR PEC obbligatori" + step OTP SMS verifica — **NON ancora**
- [ ] Provider OTP (mock dev → Twilio prod swap-ready) — **NON ancora**
- [ ] Aggiornamento `seed.ts` con regime fiscale per utenti test — **NON ancora**

**Bundle FT-B — Generazione PDF + lista lato agenzia/broker** _(FATTO)_
- [x] Engine `lib/fatturazione/` (`calcolo`/`numerazione`/`engine`) + `pdf.ts` PDF on-the-fly (pdf-lib, no Chromium) servito da `GET /api/fatturazione/[id]/pdf`
- [x] Numerazione progressiva per emittente/anno — **allineata al paper `NumerazioneFatture.docx`** (2026-06-29): schema ibrido `PV-<anno>-NNNNN` / `PV-<id4>-<anno>-NNNNN` con reset annuale; tabella `contatori_fiscali` con incremento atomico `INSERT … ON CONFLICT`; `Company.numeroSoggetto` da Postgres SEQUENCE; note di credito su sequenza separata. Stringa congelata in `DocumentoFiscale.numeroDocumentoStr`. Decisioni in `docs/numerazione-fatture-decisioni.md`.
- [x] Hook in `completaPratica`/payout: split dinamico per regime, `FATTURA_PV` alla firma + `DOC_BROKER` aggregato al payout (best-effort)
- [x] Sezione `/fatturazione` agenzia + broker (dettaglio documento, ricerca, access-control)
- [x] Blocco "Documenti fiscali" nel dettaglio pratica (download PDF)

**Bundle FT-C — Admin panel + KPI + export** _(KPI+lista+CSV FATTO; notifiche/cron DA FARE)_
- [x] Sezione `/admin/fatturazione` con KPI (StatCard per tipo) + lista + filtri/ricerca
- [~] Export **CSV** `GET /api/admin/fatturazione/export` (on-the-fly, separatore `;`); ZIP background non fatto
- [ ] Notifiche `N26/N27/N28` cablate con allegato PDF — **NON ancora**
- [ ] Cron `N29` (fatture non pagate >15gg) + `N30` (doc non trasmessi >30gg) — **NON ancora**

**Bundle FT-D — XML FatturaPA + integrazione SDI** _(parte nostra FATTO; trasmissione live gated A-Cube)_
- [x] `lib/fatturazione/xml-fatturapa.ts` generazione XSD-compliant (FPR12, TD01/TD06/TD04, per-conto-terzi `SoggettoEmittente TZ`, Natura `N2.2` forfettario)
- [x] `lib/fatturazione/xml-mapper.ts` + helper `descrizione.ts` + `GET /api/fatturazione/[id]/xml` (on-the-fly) + bottone "Scarica XML"
- [x] Adapter `lib/fatturazione/provider/` (`FatturazioneProvider` + `MockFatturazioneProvider` + selezione via env, **A-Cube swap-ready**)
- [x] Toggle "Segna come trasmesso allo SDI" lato broker (manuale)
- [~] Validazione XML contro XSD ufficiale → demandata al provider (no validatore runtime in-app)
- [ ] QR code verifica autenticità nel PDF — **NON ancora**
- [ ] `AcubeFatturazioneProvider` reale (emetti/stato/webhook) + campi DB `idSdiProvider`/`statoSdi` — **gated su account A-Cube**

**Bundle FT-E — Note di variazione + casi speciali** _(bloccato B1)_
- [~] Engine `createNotaCredito` (TD04, importi negativi, storna l'originale) presente; trigger/UI admin non cablati
- [ ] Pratica `ANNULLATA` post-emissione → genera automaticamente nota di credito
- [x] ~~Penale broker → eventuale documento separato (post-decisione commercialista)~~ **Chiuso**: nessun documento fiscale, la penale è fuori campo IVA (clausola 10.4(b) dei Termini — vedi `sistema-fatturazione.md` §6.4), resta solo movimento wallet

---

## FASE 6 - Notifiche (10 tipi)

- [x] N1 Broker: conferma invio pratica a N agenzie (on-submit)
- [x] N2 Broker: agenzia accetta + codice pratica + dati agenzia (on-accept)
- [ ] N3 Broker: sollecito ogni 5 giorni senza firma (richiede cron)
- [x] N4 Broker: firma avvenuta + credito wallet (on-firma)
- [ ] N5 Broker: payout automatico eseguito + rendiconto (richiede Stripe)
- [x] N6 Agenzia: nuova pratica disponibile + fee + altri N-1 destinatari (on-round-open)
- [ ] N7 Agenzia: promemoria countdown + giorni rimasti + importo (richiede cron)
- [x] N8 Agenzia: addebito pratica schedulato (on-firma, con data auto-addebito)
- [x] N10 Admin: pratica in escalation (round 3 fallito) (broadcast a tutti gli admin)
- [x] N11 Broker: pratica in gestione al team (escalation)
- [x] Helper `sendNotification` + audit su `NotificaInviata` (SCHEDULED → SENT/FAILED)
- [x] Provider abstraction `EmailProvider` (ConsoleEmailProvider dev → Resend prod swap)
- [x] Template MVP branded (header navy + card bianca + footer) — copy definitivi da sales
- [x] Pattern outbox post-commit (no email fantasma su rollback tx)
- [x] Pagina `/notifiche` con audit per user/company
- [ ] Scheduler cron solleciti (ogni 5gg)
- [ ] Scheduler cron auto-addebiti (giorno 20)
- [ ] Scheduler cron payout (soglia 1000)
- [x] Unsubscribe / preferenze notifiche (solo per quelle non obbligatorie) — `lib/notifiche/preferences.ts` (OPTIONAL_TIPI N3/N7/N25/N31, `shouldSend`), campi `User.notifPrefs` + `User.unsubscribeToken`, pagina pubblica `/unsubscribe` (token), pagina `/profilo/notifiche`, NotificaStato SKIPPED + footer unsubscribe nelle email. Nuova notifica N31 (valuta agenzia al dealer post-firma).

---

## FASE 7 - Valutazioni e Ranking

- [ ] Notifica al dealer post-firma per valutare (form già visibile sul detail FIRMATA, manca la push proattiva)
- [x] Form 5 stelle + note opzionali (client component con hover preview)
- [x] ~~Segnalazione abuso prezzo nelle note (flag `segnalazioneAbuso` in `Valutazione`)~~ **RIMOSSA (giu-2026)**: UI e logica eliminate, colonna `segnalazioneAbuso` droppata via migration.
- [x] Calcolo rating medio agenzia (`attachRating` con GROUP BY on-demand)
- [x] Soglia minima 5 valutazioni (`RANKING.MIN_RATINGS_FOR_RANK`)
- [x] ~~Integrazione rating nell'algoritmo distribuzione (`rankCandidates` in `avviaRound`)~~ **rimosso 2026-07-19**: `lib/distribuzione/ranking.ts` eliminato, la selezione è solo a raggio-km (vedi §0.5); il rating resta calcolato ma non entra più in `avviaRound`
- [x] ~~Sospensione automatica rating <2.5~~ **non più operativo**: rating basso è solo evidenza visiva in `/admin/agenzie` (badge "⚠ Rating basso"), nessuna sospensione automatica per rating — la sospensione automatica resta solo su 5 TIMEOUT consecutivi (`ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD`, `lib/distribuzione/auto-suspend.ts`)
- [ ] Review admin per agenzie sospese (UI di unsuspension / note)
- [x] Ranking NON pubblico (visibile solo lato admin, badge senza effetto operativo sulla distribuzione)

---

## FASE 8 - Raccolta Listini e Osservatorio Prezzi

> ⚠️ **STATO (giugno 2026): FEATURE SOSPESA.** Il modulo Listini / Osservatorio Prezzi è stato disattivato e nascosto dall'app (UI e route `/profilo/listino` e `/admin/listini` disabilitate, codice commentato). Documentazione conservata per eventuale riattivazione futura. Da NON proporre come funzione disponibile.

- [ ] Popup post-registrazione agenzia (non bloccante, skippabile)
- [ ] Sezione profilo agenzia sempre accessibile
- [ ] Modalità upload PDF/Word listino
- [ ] Modalità form strutturato (prezzo base trapasso, minivoltura, maggiorazioni)
- [ ] Normalizzazione dati listini
- [ ] Calcolo medie per zona/comune
- [ ] Benchmark personale agenzia ("Media zona: X - Tu: Y")
- [ ] Dashboard admin Osservatorio Prezzi (conteggio, province, medie, max)

---

## FASE 9 - Admin Panel Piattaforma

- [x] Overview base (pratiche totali, in distribuzione, escalation, dealer/agenzie attivi)
- [x] Layout `AppShell` role-based con nav dedicata admin
- [x] Route guard `(auth)/admin/layout.tsx` che redirige non-admin
- [x] Gestione pratiche (`/admin/pratiche`, lista con stato + filtri impliciti)
- [x] Gestione utenti (`/admin/utenti`, lista con ruolo/stato/company)
- [x] Gestione agenzie + ranking (`/admin/agenzie` con stato rankata/non/sospesa)
- [x] Gestione escalation (`/admin/escalation`, pratiche in gestione manuale)
- [x] Tick distribuzione manuale (pulsante sulla dashboard)
- [ ] Assegnazione manuale pratica in escalation a partner di fiducia (UI)
- [ ] Ricerca avanzata utenti + sospensione/blocco
- [ ] Osservatorio Prezzi (richiede Fase 8)
- [~] ~~Gestione segnalazioni abusi (lista `Valutazione.segnalazioneAbuso=true`)~~ **CANCELLATA (giu-2026)**: feature segnalazione abuso prezzo rimossa.
- [ ] Report finanziari
- [ ] Configurazione parametri (N agenzie per invio, timeout giorni, soglie wallet)
- [ ] Log di sistema / audit

---

## FASE 10 - CRM Vendite + Growth Stack

> **Architettura tecnica:** `docs/crm-architettura.md` (integrazione webhook, schema, matching)
> **Paper operativo:** `docs/ecosistema-crm-ai.md` (function calling, multi-canale, 3 pagine, chatbot)
> Il CRM è un **sistema esterno** (HubSpot/Airtable + Make + Vapi.ai + Lemlist +
> Wistia + Twilio + WATI/Manychat) — la piattaforma è solo **emettitore di eventi** verso il CRM.
> Questo permette di avviare il CRM in parallelo allo sviluppo piattaforma,
> con un team/contractor separato focalizzato su growth e sales ops.

### 10.1 Piattaforma — eventi in uscita (lato codebase)

Outbox pattern con retry per garantire delivery affidabile anche sotto carico.

- [ ] Aggiungere `User.crmContactId` nullable unique + `crmSyncedAt`
- [ ] Modello `CrmOutboundEvent` (outbox) con stato pending/sent/failed + retry count
- [ ] Worker cron/queue che processa outbox con backoff esponenziale
- [ ] Firma webhook HMAC-SHA256 con shared secret (`CRM_WEBHOOK_SECRET` env)
- [ ] Idempotency-key header per retry sicuri
- [ ] Eventi emessi:
  - [ ] `user.signup.started` (apertura wizard Step 1)
  - [ ] `user.signup.completed` (wizard terminato)
  - [ ] `pratica.first.created` (broker — prima pratica caricata)
  - [ ] `pratica.first.accepted` (agenzia — prima pratica accettata)
  - [ ] `pratica.completed` (firma avvenuta)
  - [ ] `user.inactive.30d` (nessun accesso/pratica da 30 giorni)

### 10.2 Piattaforma — API read-only per CRM

Endpoint protetti da API key + IP allowlist Make, per permettere al bot AI / Make
di leggere lo stato corrente dell'utente prima di una chiamata.

- [ ] `GET /api/crm/user/:platformUserId/state` → JSON con `statusAccount`, `ultimoAccesso`, `praticheTotali`, `praticheUltimoMese`, `tassoCompletamento`
- [ ] Middleware auth API key + rate limiting
- [ ] Log richieste per audit

### 10.3 CRM esterno — Setup (settimana 1, lato CTO/growth)

- [ ] Scelta tool CRM (HubSpot free/starter vs Airtable)
- [ ] Creazione campi custom (vedi `crm-architettura.md` §3)
- [ ] Import prospect esistenti (~600 contatti Veneto)
- [ ] Configurazione pipeline stati S0–S10

### 10.4 CRM esterno — Integrazione piattaforma (settimana 1-2)

- [ ] Endpoint Make riceve webhook piattaforma
- [ ] Logica matching email → telefono → P.IVA
- [ ] Scenario Make per Caso A (contatto esistente)
- [ ] Scenario Make per Caso B (nuovo iscritto)
- [ ] Alert manuale sales su conflitti matching
- [ ] Test end-to-end su utenti di test

### 10.5 CRM esterno — Bot AI + tracking (settimana 2-3)

- [ ] Vapi.ai function calling — lettura stato pre-chiamata
- [ ] Vapi.ai function calling — scrittura post-chiamata (stato, note, sentiment, tag obiezioni, trascrizione)
- [ ] Pixel su link iscrizione con UTM univoci per contatto (link tracciati Lemlist)
- [ ] Webhook Wistia per tracking video tutorial (minuti visti, %)
- [ ] Trigger Make su eventi stato (vedi `crm-architettura.md` §6):
  - [ ] SMS + mail su fine chiamata positiva (S0/S1 → S3)
  - [ ] Reminder SMS link non aperto a 24h / chiamata AI a 48h / SMS finale a 7gg
  - [ ] Chiamata AI pixel-aware su link aperto non iscritto (S5)
  - [ ] SMS+chiamata supporto su iscrizione iniziata non completata (S6)
  - [ ] Onboarding S7 (mail benvenuto + guida prima pratica + chiamata AI attivazione)
  - [ ] Celebrazione S8 + feedback call +7gg
  - [ ] Re-engagement S9/S10 su inattività

### 10.6 CRM esterno — Test & go-live (settimana 3-4)

- [ ] Test E2E su campione 20-30 contatti
- [ ] Verifica qualità trascrizioni + riassunti AI
- [ ] Verifica matching robusto (Caso A, Caso B, conflitti)
- [ ] Go-live su database prospect completo

### 10.7 Testi e copy (documento complementare)

- [ ] Script vocale per ogni stato (S0–S10)
- [ ] Testi SMS per ogni trigger
- [ ] Template mail branded per ogni trigger
- [ ] A/B test varianti testo + sentiment tracking
- [ ] **Database Q&A obiezioni ≥80–100 voci** (agenzie + broker separati, vedi `ecosistema-crm-ai.md` §8.7)
- [ ] Raccolta obiezioni reali via 20–30 chiamate sales umane di briefing pre-bot

### 10.8 Sales Agent vocale — configurazione avanzata (paper v2)

- [ ] Pagina Sales CRM: creazione/edit agenti AI (nome, voce, accento, prompt, script per fase)
- [ ] Creazione campagna (selezione contatti, max tentativi/giorno, orari, giorni, behaviors)
- [ ] Multi-sales agent (più agenti selezionabili per campagna)
- [ ] Dashboard live chiamate (volumi, tasso risposta per giorno/ora, blacklist)
- [ ] Blacklist automatica su "stop" verbale (opt-out immediato)
- [ ] Chiusura automatica campagna al raggiungimento target/esaurimento contatti

### 10.9 Function calling Vapi — raccolta dati real-time

- [ ] Layer proxy (Cloudflare Worker / Vercel Edge) tra Vapi e CRM con async write + cache read (§8.4)
- [ ] Function `collectEmail` con conferma verbale spelling
- [ ] Function `collectWhatsApp` con conferma verbale numero
- [ ] Function `updateContactState` (S0 → S3 ecc.)
- [ ] Function `tagObjection` (aggiunge tag obiezione al contatto)
- [ ] Function `scheduleNextContact` (data/canale prossimo contatto)
- [ ] Benchmark accuratezza STT spelling italiano (target ≥95% §8.1)

### 10.10 Invio multi-canale post-chiamata

- [ ] Trigger Make `S0/S1 → S3`: SMS sempre + WhatsApp se numero WA + Mail se email
- [ ] Template SMS approvato + pixel tracking
- [ ] Template WhatsApp approvato Meta + limite finestra 24h
- [ ] Template email con pixel Lemlist + video tutorial Wistia allegato
- [ ] Fallback "solo fisso, no digital": rimane S3 + richiamata AI a 48h con script recupero recapito

### 10.11 Chatbot testuale (inbound)

- [ ] Pagina Chatbot CRM: creazione/configurazione bot testuali multipli
- [ ] Chatbot sito — widget su passaggioveloce.it + wizard `/register`
- [ ] Chatbot WhatsApp — risposta inbound in finestra 24h (WATI/Manychat)
- [ ] Chatbot mail — risposte preimpostate a mail in arrivo
- [ ] Dashboard conversazioni (storico, FAQ, escalation umana)
- [ ] Integrazione Q&A DB condiviso col Sales Agent vocale
- [ ] **Priorità CTO:** il chatbot sito è **primo nell'ordine** (§8.6), bot vocale outbound secondo

### 10.12 Compliance & legal (bloccanti go-live outbound)

- [ ] Informativa verbale AI nelle prime 10 parole chiamata
- [ ] Consenso registrazione esplicito a inizio chiamata + fallback no-record
- [ ] Check Registro Pubblico Opposizioni (RPO) pre-campagna per tutti i numeri fissi
- [ ] Base giuridica legittimo interesse documentata + registro trattamenti aggiornato
- [ ] DPO review scritta + firma
- [ ] Process opt-out immediato ("stop" = blacklist + conferma scritta)

---

## FASE 11 - QA, Compliance, Lancio

### 11.1 Testing
- [~] Unit test core (gating documentale, wallet, algoritmo distribuzione) — coverage chiusa per i nuovi helper puri (gating hard-block, retention, countdown, fee recap, verifyTwoFactor). E2E Playwright: smoke aggiornato + login 2FA (happy path + codice errato), eseguiti serialmente (workers=1) per il rate-limiter login. Non aggiunti E2E full-UI registrazione→firma né hard-block (coperti a livello unit).
- [ ] Integration test flussi end-to-end
- [ ] Test race condition invio multiplo
- [ ] Test auto-addebito giorno 20
- [ ] Test OCR su dataset reale
- [ ] Load test / stress test
- [ ] Test sicurezza (OWASP top 10, penetration test)

### 11.2 Compliance
- [ ] Audit GDPR
- [ ] Cookie banner e consensi
- [ ] Registro trattamenti
- [ ] DPA con fornitori (storage, IA, email, pagamenti)
- [ ] Verifica fatturazione elettronica conforme SDI

### 11.3 Pre-lancio
- [ ] Landing page marketing
- [ ] Documentazione utente (dealer + agenzia)
- [ ] Video tutorial / onboarding
- [ ] Supporto clienti (email / ticket)
- [ ] Beta test con 2-3 dealer e 2-3 agenzie pilota
- [ ] Onboarding commerciale (team Sales)

### 11.4 Lancio
- [ ] Go-live ambiente produzione
- [ ] Monitoraggio attivo prime 2 settimane
- [ ] Hotfix backlog
- [ ] KPI tracking: dealer attivi, agenzie partner, pratiche completate, rating medio

---

## FASE 12 - Post-MVP (Fase 2 roadmap strategica)

> Da avviare dopo consolidamento MVP e raggiungimento target anno 1 (100 dealer, 50 agenzie, 5000 pratiche).

- [ ] Pubblicazione primo "Osservatorio Prezzi TF" (semestrale)
- [ ] Sistema certificazione volontaria agenzie + badge
- [ ] Benchmark esteso per agenzie
- [ ] Tariffario di riferimento TF
- [ ] Espansione ai privati (C2C)
- [ ] Integrazione banche dati verifica targhe/veicoli

---

## FASE 13 - Sistema di Affiliazione

> **Architettura di riferimento:** `docs/sistema-affiliazione.md` (spec v3 Aprile 2026 + review CTO).
> Società costituita e rete di contatti già pronta: si procede al lancio pieno
> del programma in parallelo alla FASE 10 CRM per sfruttare da subito la leva virale.
> Sinergia esplicita con CRM via tie-breaker paternità lead (`ecosistema-crm-ai.md` §8.8).

### 13.1 Validazione e pre-requisiti (bloccanti)
- [ ] Validazione commercialista trattamento fiscale commissioni affiliazione (AF1)
- [ ] Review §8 osservazioni CTO con Alberto + Andrea (AF2)
- [ ] Completamento policy pixel tracking e finestra di attribuzione (AF3)
- [ ] Verifica bidirezionale CRM per stato S0–S10 (dipende B5 FASE 10) (AF4)
- [ ] Policy controlli anti-collusione (same IBAN / admin / IP / dominio) (AF5)
- [ ] Decisione durata cap commissione (per sempre vs 24 mesi — §8.1)
- [ ] Decisione commissione su mini voltura (€5 vs €0 — §8.2)
- [ ] Decisione soglia payout agenzie (€500 uniforme vs differenziato — §8.7)

### 13.2 Schema e backend
- [ ] `AffiliationLink` (token univoco + `ownerCompanyId` + counter click)
- [ ] `AffiliationClick` (timestamp, IP, UA, UTM, cookie-id) per attribuzione
- [ ] `Company.referralBy` campo permanente (FK self-relation)
- [ ] Wallet broker: doppia voce `importoPraticheCent` / `importoAffiliazioneCent` (oggi saldo unico)
- [ ] Wallet agenzia: modello wallet dedicato (oggi agenzie non hanno wallet)
- [ ] Engine split commissione al trigger `Pratica.FIRMATA` (integrato in `completaPratica`)
- [ ] Generazione automatica link al passaggio `User.status = ACTIVE`
- [ ] Job guardia anti-collusione pre-accredito

### 13.3 Frontend
- [ ] Landing pubblica `/r/:token` con UTM capture + fingerprint + cookie 30gg
- [ ] Redirect `/r/:token` → `/register?ref=token` con sessione tracciata
- [ ] Pagina `/affiliazione` menu dashboard broker
- [ ] Pagina `/affiliazione` menu dashboard agenzia
- [ ] Componente "Il tuo link" (copy + share WhatsApp + QR code PNG/SVG)
- [ ] Componente statistiche (click, iscrizioni, referral attivi, commissioni)
- [ ] Componente lista referral con stato + pratiche completate
- [ ] Componente wallet con etichette LORDO e barra soglia €500
- [ ] Video tutorial integrato 60–90s (asset esterno, Wistia)

### 13.4 Notifiche dedicate (AF-N ✅ DONE — manca solo recap mensile)
- [x] `N22_REFERRAL_SIGNUP` (referral registrato) — hook in registrazione
- [x] `N23_REFERRAL_FIRST_PRATICA` (referral ha caricato la prima pratica) — hook post-firma
- [x] `N24_PAYOUT_AFFILIATION_AVAILABLE` (cross-over soglia payout per-company)
- [x] Enum `N25_MONTHLY_AFFILIATION_RECAP` aggiunto allo schema (cron in arrivo, no template)

### 13.5 Payout affiliazione
- [ ] Pulsante "Richiedi payout" attivo da €500 lordi
- [ ] Cron giorno 15 per erogazione mensile (integrato con Stripe Payout FASE 5)
- [ ] Rendiconto PDF dedicato (separare quota pratiche da quota affiliazione)

### 13.6 Admin (parzialmente DONE)
- [x] Dashboard programma `/admin/affiliazioni` (click, iscrizioni, % conversione, KPI)
- [x] Lista referral chain (drill-down per agenzia/pratica già implementato)
- [x] **AF-AC** ✅: vista flag anti-collusione `/admin/affiliazioni/sospette` con approva/rifiuta + nota review
- [x] **AF-AC** ✅: detector `lib/affiliazione/check.ts` (SAME_IBAN, SAME_IP_SIGNUP, SAME_EMAIL_DOMAIN, SAME_ADMIN) integrato nell'engine accredit
- [x] **AF-AC** ✅: stato `DA_REVISIONARE` su `CommissioneAffiliazione` + audit trail `reviewedAt/By/Notes`
- [x] **AF-AC** ✅: cattura `signupIp` (anonymizzato GDPR) su `Company.create` da wizard registrazione
- [ ] Override admin "soft" su singolo referral attivo (disattiva commissioni future, mantiene storico) — backlog

### 13.7 Aperti residui FASE 13 (blocchi esterni o backlog)
- [ ] **AF-PDF** Rendiconto PDF dedicato (separare quota pratiche da quota affiliazione) — backlog
- [ ] **AF-P** Pulsante "Richiedi payout" + cron giorno 15 — bloccato da B5 (Stripe Connect)
- [ ] N25 recap mensile — solo cron + query, da fare in qualsiasi momento

---

## FASE 14 - CRM interno team PV

> Spec di riferimento: `docs/crm-spec-implementativa.md` (12 decisioni, 8 bundle CRM-A..H).
> CRM nativo dentro `apps/piattaforma`, riservato al team interno (companyId NULL),
> ruoli ADMIN_PIATTAFORMA / AD / CTO / CFO / SALES_MANAGER / SALES.
> Sostituisce il vecchio approccio "CRM esterno HubSpot+Make+Vapi" della FASE 10
> (mantenuta come riferimento per integrazione vocale Vapi a CRM-H).

### 14.1 CRM-A — Schema + ruoli + migrazione ✅ DONE
- [x] 11 enum (`CrmContactCategoria`, `CrmStatoContatto` S0..S10, `CrmFonteAcquisizione`, `CrmCallEsito`, `CrmSentiment`, `CrmPlatStatus`, `CrmAgentLingua/Voce/Accento`, `CrmCampaignGiorni/Stato`, `CrmChatbotCanale`)
- [x] 5 modelli (`CrmContact`, `CrmSalesAgent`, `CrmCampaign` + `CrmCampaignAssegnazione`, `CrmCall`, `CrmChatbot`)
- [x] `UserRole` esteso: AD / CTO / CFO / SALES_MANAGER / SALES
- [x] 14 helper RBAC in `lib/auth/permissions.ts` (incluso `canManageCrmCampaign` owner-based)

### 14.2 CRM-B — Pipeline contatti + modale 4 tab ✅ DONE
- [x] `/admin/crm` hub a 6 tab (Contatti / Sales / Chatbot / Dashboard / Utenti team / Permessi)
- [x] `/admin/crm/contatti` con sub-tab Pipeline / Operativi
- [x] Stat card (totale, S0, S3, S7, ultimi 30gg)
- [x] Modale 4 tab create/edit (Anagrafica, Contatti, Stato/Note, Storia)
- [x] Filtri (categoria, stato S0..S10, fonte, regione, owner)
- [x] Import CSV (admin + sales manager)
- [x] Soft delete + cron purge 90gg

### 14.3 CRM-F — Utenti team interno + permessi ✅ DONE
- [x] `/admin/crm/utenti` lista + create/edit/reset password
- [x] Filtri ruolo via `creatableCrmRoles(role)` (gerarchia: ADMIN > AD/CTO > SALES_MANAGER > SALES)
- [x] `/admin/crm/permessi` matrice readonly delle policy

### 14.4 CRM-C — Sales Agents + Campagne ✅ DONE
- [x] `/admin/crm/sales` 2 colonne (agent / campagne)
- [x] CRUD Sales Agent (10 campi: nome, lingua/voce/accento, prompt, script primo+followup, Q&A, post-call) — delete bloccato se ha campagne attive/pausate
- [x] CRUD Campagna (12 campi) con filtri target (regione/cat/statoTarget) e parametri call (maxTry, intervallo, finestra oraria, giorni attivi)
- [x] Lancio campagna in transazione: bulk-create `CrmCampaignAssegnazione` per i contatti che matchano i filtri
- [x] Status transitions ATTIVA / PAUSATA / CHIUSA
- [x] RBAC owner-based: SALES_MANAGER edita solo le proprie campagne, ADMIN/AD/CTO edita tutte

### 14.5 CRM-D — Chatbot config + embed sito ✅ DONE
- [x] `/admin/crm/chatbot` lista bot multipli (sito / WA / mail) con badge canale/target/posizione/stato
- [x] CRUD bot: nome, canale, posizione, prompt, obiettivo, Q&A, escalation message
- [x] Toggle Attiva/Disattiva inline + soft delete
- [x] Widget chatbot embed inline (`<SiteChatbot posizione="..." />`) montato su home (decisione D-09: stessa Next app, no iframe)
- [x] Provider stub `lib/providers/chatbot/` con parser Q&A e matching keyword (sostituibile con LLM reale post-Manychat/WATI)
- [x] API `POST /api/chatbot/[botId]` per il widget (rate-limit a 1000 char/messaggio)
- [x] Unit test provider (parseQa + respondAsBot, 6 case)
- [x] **Chatbot LLM (Haiku 4.5)** — KB auto-estratta dai docs per tier (public/clients/internal, default-safe), montaggio platform-wide (root layout, loggati e non), multi-turn, anti-abuso (rate-limit per-IP + tetto globale su Neon), fallback deterministico fail-open, logging metriche + domande senza risposta (spec `docs/superpowers/specs/2026-06-10-chatbot-llm-design.md`, branch `feat/chatbot-llm`)
- [ ] Dashboard conversazioni per bot (storico, tagging, escalation umana) — differita a CRM-H
- [ ] Embed Chatbot WhatsApp/mail (WATI/Manychat) — differito a CRM-H

### 14.6 CRM-E — Dashboard CRM ✅ DONE
- [x] `/admin/crm/dashboard` 6 stat cards (totale, iscritti S8+S9, conversione S3+S5+S6, link aperti, sales agent, campagne attive)
- [x] Grafico "Contatti per mese" (ultimi 6 mesi) — riusa `RendimentoChart` con prop `formatValue` (refactor light)
- [x] Progress bars distribuzione stato S0..S10 con conteggio + percentuale
- [x] Sezione "Dati economici" gated da `canViewCrmFinancials` — Revenue mese, Pratiche mese, Wallet broker aggregato, Revenue/pratica
- [ ] Grafici call-volume per giorno/ora — differiti a CRM-H (richiedono dati Vapi)
- [ ] Tempo medio S0→S3 / S3→S7 — differiti a CRM-G (richiedono storico stato)

### 14.7 CRM-G — Sync con piattaforma (cron + hook in-process) ✅ DONE
- [x] `lib/crm/sync.ts` engine sync interno (CRM nativo, no webhook esterno HMAC)
- [x] `tryMatchCrmContact(companyId)` cascade email → tel → P.IVA + auto-promote a S7
- [x] Hook post-registrazione (`app/(auth)/actions.ts`) chiama il match best-effort
- [x] `onPraticaFirmata(praticaId)` hook in `app/pratiche/actions.ts`: S7→S8 prima volta, S8→S9 ricorrente, set `primaPratica`
- [x] Cron `syncCrmFromPlatform()` aggrega `platStatus`, `praticheTotal`, `praticheMonth`, `lastAccessAt`, `tassoComp` per i contatti agganciati
- [x] Endpoint `POST /api/jobs/crm-sync` admin-only, con bottone in `/admin/demo-control` per trigger manuale
- [x] Util puri (`normalizePhone`, `isPreIscrizione`) testabili senza prisma — 7 unit test
- L'outbox HMAC + retry è applicabile solo per CRM esterno e resta nella vecchia FASE 10 (non più attiva)

### 14.8 CRM-H — Vapi.ai integration (deferito post account esterno)
- [ ] Sblocco account Vapi.ai (B6 — Budget bot AI)
- [ ] Push agent config (prompt, voce, accento, script) → Vapi via API
- [ ] Function calling Vapi: `collectEmail`, `collectWhatsApp`, `updateContactState`, `tagObjection`, `scheduleNextContact`
- [ ] Webhook inbound Vapi → `CrmCall` (esito, sentiment, trascrizione, tag obiezioni)
- [ ] Trigger campagna scheduler (rispetta finestra oraria, giorni attivi, max tentativi)
- [ ] Blacklist automatica su "stop" verbale + RPO check (B7 + §10.12)

---

## Target MVP - KPI da raggiungere

- [ ] 100 dealer attivi
- [ ] 50 agenzie partner (≥5 pratiche/mese cadauna)
- [ ] 5.000 pratiche completate
- [ ] ≥30 listini caricati (database prezzi iniziale)
- [ ] Sistema valutazioni operativo su tutte le agenzie attive
- [ ] Revenue ~180.000 EUR

---

## Stato MVP al 2026-06-03

**Progresso complessivo (effort-weighted): ~95%** · **Production:** https://passaggio-veloce-piattaforma-cm8unpjkg-saiols-projects.vercel.app/

| Fase | % | Note |
|---|---|---|
| 0 Pre-sviluppo | ~30% | Stack scelto, naming, CTO. Resto su decisioni business/legali |
| 1 Fondamenta | ~85% | Monorepo, CI, DB Prisma, Sentry, Docker, seed, **deploy Vercel attivo + Vercel Cron schedule (A2)**. Manca staging dedicato + backup automatici Neon |
| 2 Auth | ~96% | Login, wizard split dealer/agenzia, invito utenti team, reset password, **2FA TOTP ora ENFORCED al sign-in (TOTP + backup code), non più solo setup (A9)** + rate-limit login attivo. Manca solo email reale (Resend) |
| 2.5 Design system | 100% | Palette Trust Blue, componenti UI, layout role-based, restyle completo |
| 3 Documenti/OCR/Pratiche | ~88% | Storage+OCR mock + Vercel Blob ready, wizard nuova pratica con scansione mobile, schema documentale v7 (SD-A/B/C in prod), **gating documentale UI rule-based + override admin (A4)**, **hard-block pre-invio su doc FAILED + fallback OCR manuale + download ZIP pratica + retention/purge cron**, **OCR Mindee provider integrato (Fase 1 sprint OCR 2026-05) — pronto per swap su prod test appena env vars disponibili**. Document AI custom-trained in attesa di raccolta libretti reali dal beta (Fase 2 sprint OCR). |
| 4 Distribuzione + agenzia | 100% | Engine **raggio-km reale (500/750/1000 m) + pool cumulativo, no cap, escalation (A12, 2026-07-19)** — sostituisce il vecchio comune/limitrofi/provincia + ranking (A3); ore lavorative, auto-suspend 5 timeout, cron automatico (A2). Tutto pronto |
| 5 Pagamenti/Wallet/SDI | ~35% | Wallet completo, FeeAddebito SCHEDULED, payout job, MockPaymentProvider, **rendiconto PDF AF-PDF (A6)**. Blocca Stripe → commercialista (B1). Modello fatturazione delegata in spec — vedi `sistema-fatturazione.md` (5 bundle FT-A/B/C/D/E) |
| 6 Notifiche | ~98% | **25 NotificaTipo cablati** (N1-N25 incluso N25 recap mensile A6) + N31 valuta agenzia post-firma. Cron Vercel automatico (A2). **Unsubscribe granulare + preferenze opt-out ora implementati** |
| 7 Valutazioni/Ranking | 100% | Form 5⭐, **ranking dal 2026-07-19 è solo badge visivo admin (A12) — nessun effetto su distribuzione/sospensione**, sospensione auto solo su timeout, **unsuspend UI con nota motivazione + banner valuta dashboard dealer (A7)** |
| 8 Listini / Osservatorio | 100% | **Modulo intero in prod (A1)**: form/upload listino agenzia, engine osservatorio per provincia, benchmark "tu vs media zona", dashboard admin |
| 9 Admin panel | ~95% | Tutto in prod incluso **audit log accessi (A5)**. Manca solo configurazione parametri runtime (DB-driven, backlog) |
| 10 CRM vendite esterno | — | **Superato** dalla FASE 14 (CRM nativo) post-decisione 2026-05-06 |
| 11 QA/Compliance/Lancio | ~60% | 116 unit test, **cookie banner GDPR + pagine privacy/cookie/termini (A8) + Playwright setup con 4 smoke test (A8) + SEO/AEO fondamenta (A10) + pillar pages B2C (A11)**. Manca audit GDPR formale, copy legali revisionati, beta test |
| 13 Sistema Affiliazione | ~95% | Backend/UI/notifiche/AF-N/AF-AC in prod, **AF-PDF + N25 cron mensile (A6)**. Aperti: AF-P payout (bloccato Stripe) |
| 14 CRM interno team PV | ~88% | Bundle A/B/C/D/E/F/G in prod. Manca solo H Vapi (bloccato B6 account esterno) |

**Account esterni richiesti per:**
- **Resend** → email reale (oggi `ConsoleEmailProvider` salva `.dev-emails/*.html`)
- **S3** o Vercel Blob attivato → storage producton (Vercel Blob è già implementato e swap-ready, manca env)
- **Google Document AI** → OCR custom-trained (Fase 2 sprint OCR) — oggi `MindeeOcrProvider` in Fase 1 attesa di env vars
- **Stripe Connect** → addebiti SEPA + payout (mock provider, schema completo)
- **Vapi.ai + Twilio** → bot vocale CRM-H + SMS post-call
- **SDI provider** (Aruba/altro) → fatturazione elettronica B2B

---

## Mappa lavoro residuo (per pianificazione)

### A · Fattibile ORA — nessuna dipendenza esterna

**A0. ✅ DONE (2026-07-10) — Permessi granulari per le utenze azienda**
- Terzo asse di autorizzazione accanto a `UserRole` e `RuoloSede`: **22 permessi** per un dealer, **28** per un'agenzia (31 chiavi distinte, 4 azioni sensibili). `RuoloSede` + `SedeScope` restano «su quali record», i permessi sono «quali azioni».
- `User.permessi` / `Invitation.permessi` (`String[]`), snapshot esplicito senza eredità. Il ruolo di sede è solo un **preset** che pre-spunta le caselle.
- Risolti nel `SessionContext`, **non nel JWT**: revocare un permesso ha effetto alla richiesta successiva, non al re-login (verificato: 403 → 200 → 403 senza rilogin).
- Matrice a accordion in creazione, invito e modifica utenza. Anti-escalation: non concedi ciò che non hai, serve `team.permessi` per scegliere, non modifichi te stesso né il titolare — la chiamata sbagliata **non compila** (union discriminata).
- Fail-closed su 5 livelli: sidebar, pagina, server action, route API (`403`), componente.
- Due guardie anti-drift: `mappa-enforcement.ts` (51 server action classificate) e `mappa-pagine.ts` (26 pagine). Aggiungere un'action o una pagina senza classificarla fa fallire i test.
- Chiude tre buchi trovati **guidando l'app viva**: la dashboard mostrava il saldo wallet a chi non aveva `wallet.view`; `/affiliazione`, `/feedback`, `/notifiche` erano raggiungibili via URL; `/team` non verificava `team.view`.
- Coerente con la spec `2026-07-10-iban-solo-super-admin-design.md`: `sede.iban`, `pagamenti.iban` e `pagamenti.ritenta` sono **ritirati** dal catalogo perché sarebbero caselle inerti.
- Spec: `docs/superpowers/specs/2026-07-10-permessi-granulari-design.md` · Piano: `docs/superpowers/plans/2026-07-10-permessi-granulari.md`
- ⚠️ **Rilascio in tre passi ordinati**: migration → backfill → deploy dei gate. Vedi la checklist nella spec.

**A1. ✅ DONE — Listini & Osservatorio Prezzi (FASE 8 intera)** — ⚠️ **SOSPESA (giugno 2026): modulo disattivato e nascosto dall'app, route rese 404, codice commentato. Da NON proporre come funzione disponibile.**
- `/profilo/listino` con toggle Form strutturato / Upload PDF (toggle button)
  - Form: prezzoBaseTrapasso, prezzoMinivoltura, maggiorazione pre-2015, sconto lotto massivo, province coperte (sigle CSV)
  - Upload: PDF/JPG/PNG (max 10MB), province coperte, riusa StorageProvider esistente
- Server actions `saveListinoFormAction`, `uploadListinoFileAction`, `deleteListinoAction` (gated AGENZIA)
- Engine `lib/listini/observatory.ts`: `statsForProvincia`, `statsAllProvincie`, `getBenchmarkForAgenzia` (count/min/media/max per trapasso e minivoltura)
- Benchmark "Tu vs media zona" sulla pagina /profilo/listino (provincia principale del listino)
- Dashboard admin `/admin/listini` con: 4 stat card (totale listini, strutturati, upload, province coperte), tabella per provincia con colonne min/media/max trapasso e minivoltura, footer rilevazioni totali
- Banner "📋 Pubblica il tuo listino" sulla dashboard agenzia se nessun listino è ancora pubblicato (sostituisce popup post-registrazione)
- Card "Listino prezzi" nella pagina /profilo per accesso diretto
- Link admin "Listini" in nav

**A2. ✅ DONE — Vercel Cron schedule**
- `apps/piattaforma/vercel.json` con 6 cron paths (distribuzione-tick ogni 30min, send-solleciti 9:00, process-fee-scheduled ogni 6h, process-payouts 1:00, trigger-auto-payout 1:30, crm-sync 2:00)
- Helper `lib/jobs/auth.ts` con `requireAdminOrCron(req)`: bearer `CRON_SECRET` (Vercel) OR sessione `ADMIN_PIATTAFORMA` (admin manuale)
- Tutti i 6 route job ora supportano sia `GET` (Vercel) sia `POST` (admin demo-control)
- `.env.example`: aggiunto `CRON_SECRET` con doc
- Da fare lato Vercel dashboard: aggiungere env var `CRON_SECRET` con valore casuale

**A3. ✅ DONE (storico — superato da A12 il 2026-07-19) — Anti-abuso ranking + raggio territoriale esteso**
> ⚠️ **Superato da A12**: la selezione per ranking (`effectiveScore`, decay rifiuti) e la mappa `province-limitrofe.ts` sono state **rimosse** il 2026-07-19 con il passaggio al raggio-km reale. Voce lasciata per storico/tracciabilità: quanto descritto sotto **non riflette più il codice attuale**.
- ~~`ANTI_ABUSO` constants: `REJECT_DECAY_PER_REJECT=0.2`, `REJECT_DECAY_LOOKBACK=10`, `AUTO_SUSPEND_TIMEOUT_THRESHOLD=5`~~ — resta solo `AUTO_SUSPEND_TIMEOUT_THRESHOLD=5`, il decay è stato rimosso
- ~~`effectiveScore = ratingAvg − recentRejects × 0.2`~~ — rimosso, nessuna selezione per ranking
- ~~`attachRating` carica le ultime 10 assegnazioni e conta i rifiuti consecutivi~~ — rimosso insieme a `ranking.ts`
- `checkAutoSuspendForAgenzie` (oggi `checkAutoSuspendForSedi`, multi-sede) resta cablato nel tick dopo updateMany TIMEOUT: se 5 timeout consecutivi → sospensione automatica + nota audit — **questa parte è rimasta invariata**
- ~~`province-limitrofe.ts` espanso da 7 voci Veneto a 110 province italiane complete~~ — file **rimosso** il 2026-07-19 (sostituito da `distanceKm` su coordinate reali)
- Backlog risolto da A12: raggio km vero (Haversine su lat/lng) — implementato il 2026-07-19

**A4. ✅ DONE — Gating documentale UI (rule-based)**
- `lib/documenti/classifier.ts` con `classifyDocumento(input)` puro: regole MIME accettato (PDF/JPG/PNG), size minima 30KB, size massima 10MB, naming hints fronte/retro per CI
- 8 unit test verdi
- Cablato in `createPraticaAction`: ogni Documento per parte (CI, CF, procura, visura, permesso) viene classificato all'upload, `gatingStato` = PASSED/FAILED, `gatingError` valorizzato in caso di FAILED
- UI `/pratiche/[id]` mostra badge gating (✓ ok / ✗ scartato / ⓿ override / pending / —) per ogni documento
- Per documenti FAILED: messaggio errore chiaro inline (es. "File troppo piccolo (12 KB). Probabilmente vuoto o placeholder.")
- Bottone "Forza PASSED" (admin-only) → `overrideGatingAction` setta `gatingStato=OVERRIDDEN` con audit `gatingOverrideById/At`
- Indicatore "ⓘ Validazione forzata da admin" dopo override
- Quando arriva Document AI: swap interno di `classifyDocumento`, UI invariata
- Backlog: blocco hard pre-invio pratica se almeno un documento richiesto è FAILED senza override (oggi soft, broker vede il warning ma può procedere)

**A5. ✅ DONE — Admin completamento (4/4 voci coperte)**
- ✅ **Assegnazione manuale escalation** — già implementata (`/admin/escalation` con `<AssignForm>` + `assegnaEscalationAction`, preload agenzie per provincia con rating + count valutazioni)
- ✅ **Report finanziari export CSV** — già implementati per affiliazioni (`/api/admin/affiliazioni/export`), dashboard finanze (`/api/admin/dashboard/export`), contatti (`/api/admin/contatti/export`)
- ✅ **Audit log accessi** — pagina `/admin/audit-log` con: 4 stat cards (utenti totali, login oggi, login ultimi 7gg, mai loggati), filtro ruolo + ricerca testuale (email/nome/ragione sociale), paginazione 50/pagina, sortato per `lastLoginAt` desc, gated `ADMIN_PIATTAFORMA`
- ⏭ **Configurazione parametri runtime** — differita a backlog: richiede modello DB `Settings` chiave-valore o approccio simile, scope troppo grosso per scope A5. Oggi: parametri hardcoded in `lib/distribuzione/constants.ts` (raggi/finestre/ranking-badge, vedi A12), `lib/wallet/config.ts`, con `payoutThresholdCent` configurabile per company.

**A6. ✅ DONE — AF-PDF rendiconto + N25 cron mensile**
- `lib/pdf/rendiconto.ts` con `pdf-lib` (puro JS, no chromium): rendiconto A4 portrait con sezioni separate "Crediti da pratiche" + "Crediti da affiliazione" + totali e subtotali
- Endpoint `GET /api/wallet/rendiconto?year=YYYY&month=MM` (auth dealer/agenzia)
- `RendicontoCard` su `/wallet` con picker mese/anno e download diretto
- Job `lib/jobs/affiliation-monthly-recap.ts` aggrega commissioni ACCREDITATA del mese precedente per referenteId, manda N25 a tutti gli admin azienda
- Endpoint `POST/GET /api/jobs/affiliation-monthly-recap` con `requireAdminOrCron`
- `vercel.json` cron schedule `0 9 1 * *` (1° del mese alle 9:00)
- Bottone "📊 Recap mensile affiliazione" in `/admin/demo-control` per trigger manuale
- Smoke test: PDF 200 OK con magic bytes %PDF, endpoint N25 risponde scanned/notified count

**A7. ✅ DONE — Unsuspend UI + banner valuta post-firma**
- `SuspendButton` ora apre dialog con nota motivazione (sospensione + riattivazione) — salvata su `Company.suspensionLastNote` per audit
- Template N15_ACCOUNT_RIATTIVATO accetta `motivo` opzionale (incluso nell'email)
- Banner "Da valutare" sulla dashboard broker con elenco delle ultime 5 pratiche FIRMATA non valutate + CTA "Valuta ora →"
- Smoke test: sospensione + riattivazione + banner verde end-to-end
- Schema: nuovo campo `Company.suspensionLastNote` (push schema applicato dev+prod)

**A8. ✅ DONE — Compliance + QA setup**
- `<CookieBanner />` GDPR-compliant montato in root layout: 3 azioni "Accetta tutti" / "Solo necessari" / "Personalizza" con toggle granulare analytics/marketing. Persistenza LocalStorage via `useSyncExternalStore` (SSR-safe, multi-tab consistency).
- Pagine `/privacy`, `/cookie`, `/termini` con copy boilerplate ITA, footer pubblico e AppShell linkano sempre alle 3 pagine.
- `<title>` e meta description del root layout aggiornati ("Passaggio Veloce — Broker digitale automotive").
- Setup Playwright: `playwright.config.ts` (base URL configurabile, project chromium), scripts `test:e2e` e `test:e2e:install`.
- 4 smoke test E2E in `e2e/smoke.spec.ts`: home pubblica + CTA, pagine legali raggiungibili, cookie banner accept flow, login admin con credenziali seed.
- `.gitignore` esteso (playwright-report, test-results).
- Backlog: copy legali definitivi (B10/B11), test E2E avanzati (registrazione + wizard pratica + firma — richiedono fixtures e teardown DB).

**A9. ✅ DONE — 2FA TOTP setup + rate limit login + ENFORCEMENT al sign-in**
- Schema: `User.twoFactorEnabled`, `twoFactorSecret`, `twoFactorBackupCodes` (JSON, hashed bcrypt)
- `lib/auth/totp.ts` con `otplib` v13: generateTotpSecret, verifyTotpCode (epochTolerance ±30s), generateBackupCodes (10× 8-char), hashBackupCodes, verifyBackupCode
- Pagina `/profilo/sicurezza`: setup wizard con QR code (qrcode lib), conferma con codice TOTP, mostra backup codes UNA VOLTA, disable con password
- Card "Sicurezza account" su /profilo
- `lib/auth/rate-limit.ts`: sliding window in-memory (Map), 5 tentativi / 15 min poi block 15 min, swap-ready a Redis. 4 unit test verdi
- Cablato in `loginAction`: chiave `login:{ip-anonimizzato}:{email}`, reset al login OK
- ✅ Check 2FA al sign-in ora ENFORCED: `authorize` (auth.ts) è il verificatore autoritativo (TOTP via `otplib` OPPURE backup code, con consumo+persistenza del backup code usato), `loginAction` fa un pre-check che ritorna `needTotp` per mostrare il campo 2FA come secondo step, login form controllato con campo TOTP condizionale. Nuovo helper `verifyTwoFactor` + test, query condivisa `activeUserCredentialsQuery`.

**A10. ✅ DONE — [2026-05-24] Landing SEO/AEO fondamenta tecniche**
- `lang="it-IT"` su `<html>`, metadata completi Next.js (title, description, canonical, OG, Twitter Card) su layout + ogni pagina pubblica
- `src/lib/seo/brand.ts`: costanti anagrafiche PV SRL (P.IVA 14688390963, Assago, themeColor)
- `src/lib/seo/faqItems.ts`: 5 FAQ canoniche condivise tra JSON-LD e llms.txt
- `src/lib/seo/jsonLd.ts`: generatori type-safe Organization, WebSite, FAQPage, Service, SoftwareApplication, WebPage, BreadcrumbList
- `src/lib/seo/JsonLdScript.tsx`: componente `<JsonLd>` per iniezione `<script type="application/ld+json">`
- `app/sitemap.ts`: sitemap host-aware (solo passaggioveloce.it, 4 URL pubblici)
- `app/robots.ts`: robots host-aware (allow AI crawler GPTBot/Claude/Perplexity su prod, Disallow: / su Vercel preview)
- `app/manifest.ts`: Web App Manifest (theme color BRAND, icone SVG)
- `app/opengraph-image.tsx`: OG image programmatica 1200×630 (gradient brand, logo, pill compliance)
- `app/twitter-image.tsx`: Twitter Card image (riusa OG image)
- `app/llms.txt/route.ts`: endpoint AEO gated (solo passaggioveloce.it) con dati aziendali + 5 FAQ structured
- `src/lib/landing-gate.ts`: PUBLIC_PATHS esteso con 4 nuovi asset path SEO
- 21 unit test (brand.test.ts × 5, jsonLd.test.ts × 16)
- Spec: `docs/superpowers/specs/2026-05-24-landing-seo-aeo-design.md` · Plan: `docs/superpowers/plans/2026-05-24-landing-seo-aeo.md`

**A11. ✅ DONE —** [2026-05-25] Landing SEO/AEO Fase 2 — pillar pages B2C
- Hub `/guide` + 3 pillar evergreen: come fare, costi 2026, documenti necessari (~6500 parole totali)
- JSON-LD HowTo, Article, CollectionPage, BreadcrumbList aggiunti
- CTA dual-track B2B principale + B2C educational
- Internal linking pillar↔pillar via RelatedGuides
- 4 nuove URL in sitemap (totale 8); /llms.txt include sezione Guide; SiteHeader link sempre visibile
- Refactor: SiteFooter estratto componente, isPublicPath helper con prefix /guide
- Spec: `docs/superpowers/specs/2026-05-25-guide-b2c-design.md` · Plan: `docs/superpowers/plans/2026-05-25-guide-b2c.md`

**A12. ✅ DONE — [2026-07-19] Distribuzione a raggio-km reale + pool cumulativo (sostituisce comune/limitrofi/provincia + ranking)**
- `Pratica.lat/lng` (nuovi campi, migration a mano): coordinate del luogo di consegna scelto dal broker via `AddressAutocomplete` (Google Places), **obbligatorie al submit** (validate con `parseCoords`; senza selezione dall'elenco il submit è bloccato con errore sul campo luogo)
- `lib/geo/coords.ts` → nuovo `distanceKm` (Haversine, puro, testato: distanze note, simmetria, zero su punto identico)
- `lib/distribuzione/constants.ts` riscritto: `RAGGI_KM=[0.5,0.75,1]` (round 1/2/3 = 500/750/1000 m), `T1_HOURS/T2_HOURS/T3_HOURS=4/4/4`; spariti `N_PER_ROUND`/`N_MAX`
- `avviaRound` (`lib/distribuzione/tick.ts`) riscritto: seleziona **tutte** le sedi agenzia idonee (coordinate presenti, non sospese/eliminate, madre non bloccata, visura valida) entro il raggio del round, cascade su anello vuoto (salta subito al raggio successivo), nessuna selezione/ordinamento per ranking
- `tickPratica` riscritto per **pool cumulativo**: guarda tutte le `PENDING` di qualunque round (non solo quello corrente); all'avanzamento le `PENDING` scadute **non vanno in TIMEOUT** ma si ri-armano con finestra fresca; l'escalation (solo a round 3 scaduto) mette in TIMEOUT tutte le `PENDING` in un colpo solo
- `lib/distribuzione/ranking.ts` **rimosso** (codice morto dopo la riscrittura): il ranking non seleziona più i candidati, resta **solo badge visivo admin** su `/admin/agenzie` (nessun effetto operativo su distribuzione/sospensione)
- `lib/distribuzione/province-limitrofe.ts` (+ test) **rimosso**: la mappa 110 province ISTAT non serve più
- Auto-sospensione (`auto-suspend.ts`) rimane ma **solo timeout/no-show** (5 TIMEOUT consecutivi sulla sede), nessun decay per rifiuti
- N6 inviata solo alle sedi **nuove** che entrano nel raggio del round; le sedi già contattate restano nella loro inbox senza nuova email
- Spec: `docs/superpowers/specs/2026-07-19-distribuzione-raggio-km-design.md` · Plan: `docs/superpowers/plans/2026-07-19-distribuzione-raggio-km.md`
- Aggiorna §0.5, FASE 4.1, FASE 7 sopra (dettagli completi lì)

**A13. ✅ DONE — [2026-07-19] Giustificativo interno costo promo ("Documento 2", art. 108 TUIR)**
- Nuovo modello `GiustificativoInterno` (+ `GiustificativoInternoTipo`, nuovo `ContatoreFiscaleTipo.GIUSTIFICATIVO_INTERNO` per numerazione interna `GI-<anno>-NNNNN` via `prossimoContatore` con `idSoggetto` fisso PV) — migration a mano, tabella separata da `DocumentoFiscale` (mai esposto su `/fatturazione` del broker)
- `lib/fatturazione/giustificativo-promo.ts`: `createGiustificativoPromo({ payoutId })` chiamato dopo `settlePayout` quando il payout aggancia credito `CREDITO_PROMO`; best-effort e idempotente (`payoutId` unique); somma il promo lordo, risale ai `PromoCodeRedemption` via `transazioneWalletId` per popolare `righe`/`datiBeneficiario`
- `createDocBroker` **invariato**: filtra esplicitamente `CREDITO_PRATICA`/`CREDITO_AFFILIAZIONE`, il bonus promo resta sempre fuori dalla fattura (regressione blindata da test)
- Pagina `/admin/costi-promozionali`: lista + filtro intervallo date + export CSV (`lib/fatturazione/giustificativo-filtri.ts`), internal only, nessuna esposizione lato broker/agenzia
- Spec: `docs/superpowers/specs/2026-07-19-giustificativo-costo-promo-design.md` · Plan: `docs/superpowers/plans/2026-07-19-giustificativo-costo-promo.md`

### B · Bloccato da account/decisione esterna

| Blocco | Cosa serve | Cosa sblocca |
|---|---|---|
| **B1 Stripe Connect + commercialista fatturazione** | Validazione modello fatturazione delegata (split forfettario 55+20, TD01/TD06/IVA, ritenuta privato, somme di terzi) + onboarding Stripe | FASE 5 intera (addebiti SEPA, payout broker/affiliazione, fattura elettronica). Spec: `sistema-fatturazione.md` §9 |
| **B6 Vapi.ai account** | Budget approvato + sottoscrizione | CRM-H (chiamate vocali AI, function calling, blacklist) |
| **B7 Testi vocali** | Script S0-S10 da Sales + Q&A obiezioni | CRM-H (configurazione agent base) |
| **B8 Validazione AF1-AF5** | Commercialista + legale + CTO review | Sblocca produzione FASE 13 (oggi è in prod ma in attesa di sign-off legale) |
| **B10 Legale popup penali** | Review clausole `sistema-penali-broker.md` | Sblocca enforcement reale del wallet negativo |
| **B11 Legale procura/successione** | Notaio + legale review | Sblocca SD-D (revisione manuale + AI documenti speciali) |
| **Resend** | Account + DNS SPF/DKIM/DMARC | Email reali (oggi sviluppo via `.dev-emails/*.html`) |
| **Google Document AI** | Account + key + addestramento OCR libretto | OCR reale (oggi `MockOcrProvider`) |
| **Vercel Blob env var** | Generare token in dashboard Vercel | Storage prod (provider già implementato, manca env `BLOB_READ_WRITE_TOKEN`) |
| **SDI provider** | Scelta tra Aruba/altro + onboarding | Fatturazione elettronica FASE 5.3 |

### C · Da decidere

- ~~B2 fallback nessuna agenzia accetta~~ **risolto**: shippato come raggio-km + pool cumulativo (vedi §0.5, A12)
- B5 era "scelta HubSpot vs Airtable" — **superato** dalla FASE 14 CRM nativo
- Cap durata commissione affiliazione (sempre vs 24 mesi) — D-04 risolto a "sempre"
- Soglia payout uniforme — D-05 risolto a "uguale per tutti"

---

## Note e blocchi attivi

| # | Blocco | Stato | Impatto | Owner |
|---|--------|-------|---------|-------|
| B1 | Validazione commercialista modello fatturazione delegata (`sistema-fatturazione.md` §9) | **Confermato 2026-06-17** | Sbloccata FT-D XML (fatta); resta gated solo l'account provider SDI (A-Cube) | Andrea + Commercialista |
| B2 | Fallback se nessuna agenzia accetta | **Risolto (shipped 2026-07-19)**: raggio-km + pool cumulativo, vedi §0.5 / A12 | Sblocca Fase 4.1 (fatto) | — |
| B3 | Naming definitivo | Risolto: **Passaggio Veloce** | — | — |
| B4 | CTO socio fondatore | Risolto: **Francesco Sioli** | — | — |
| B5 | Scelta CRM core (HubSpot vs Airtable) | Aperto | Sblocca Fase 10.3 | CTO |
| B6 | Budget bot AI Vapi.ai | Aperto | Impatta Fase 10.5 + stima costi complessiva | Andrea + CTO |
| B7 | Testi SMS / script vocale / copy mail per stati S0-S10 | Aperto | Blocca Fase 10.7 | Sales + marketing |
| B8 | Validazioni AF1–AF5 sistema affiliazione (fiscale + CRM + anti-collusione + cap durata + mini voltura) | Aperto | Blocca Fase 13 | Alberto + Andrea + Commercialista + CTO |
| B9 | Dubbi 1-6 release post-demo 2026-05 (vedi `bugfix-feature-list.md` §"Dubbi aperti") | Risolto in `bugfix-feature-list.md` §"Decisioni prese" | — | — |
| B10 | Validazione legale clausole popup penale + wallet negativo (vedi `sistema-penali-broker.md` §"Punti di accordo legale") | Aperto | Blocca prod-launch sistema penali | Legale + Alberto |
| B11 | Validazione legale documenti successione/procura (vedi `schema-documentale-v7.md` §"Punti aperti") — comodato non più ostativo, escluso | Aperto | Blocca prod-launch schema documentale | Notaio + Legale + Alberto |
