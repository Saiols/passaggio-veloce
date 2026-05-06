# Passaggio Veloce - Piano di Implementazione MVP

> Documento operativo con checkbox per tracciare l'avanzamento lavori.
> Basato su: `riassunto-progetto.md`, `analisi-progetto.md`, `stima-costi.md`, Mockup, Policy Prezzi, Visione Strategica, Organigramma, CRM.
> Ultimo aggiornamento: 2026-05-06 (CRM interno: bundle A/B/C/F in prod; FASE 14 tracking aggiunta)

> **Release post-demo 2026-05:** vedi `docs/bugfix-feature-list.md` (19/19 item completati e in prod).

> **Spec attive da implementare:**
> - `docs/sistema-penali-broker.md` — popup pre-invio, segnalazione agenzia, penale €100, wallet negativo (3 bundle SP-A/B/C) ✅ in prod
> - `docs/schema-documentale-v7.md` — engine documentale + wizard branching + revisione manuale (4 bundle SD-A/B/C/D, ultimo richiede AI/OCR account esterno) ✅ A/B/C in prod
> - `docs/crm-spec-implementativa.md` — CRM interno team PV (Pipeline Lead, Sales Agents, Campagne, Chatbot, Dashboard, RBAC interno). 8 bundle CRM-A..H. Sostituisce il placeholder "FASE 14 differita".

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
- [!] Validazione commercialista modello wallet / rendiconto / fattura broker (in attesa risposta)
- [x] Definizione fallback se nessuna delle 5 agenzie accetta la pratica (vedi §0.5)
- [ ] Redazione T&C con clausola limitazione responsabilità + autorizzazione SEPA
- [ ] Informativa privacy GDPR (dati sensibili CI/CF/visura)
- [ ] Policy data retention documenti caricati
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

### 0.5 Flusso fallback "nessuna delle 5 agenzie accetta" (proposta da validare)

**Obiettivo:** garantire che ogni pratica trovi un'agenzia rispettando gli orari di lavoro reali delle agenzie, senza dare al dealer informazioni superflue.

#### Orari di lavoro per agenzia
- Ogni agenzia, in fase di registrazione (e poi modificabile dal profilo), inserisce i propri **giorni e orari di apertura** (es. Lun-Ven 9:00-13:00 / 15:00-18:30, Sab 9:00-12:00, Domenica chiuso)
- Possibili più fasce orarie nello stesso giorno
- Possibilità di marcare giorni di chiusura straordinaria (ferie)
- Il countdown della pratica per ogni singola agenzia scorre **solo** durante le sue ore di apertura
- Le agenzie sono libere di indicare anche sabato pomeriggio / domenica se aperte

#### Comportamento broker
- Il broker può inviare la pratica **24/7** senza vincoli
- Notifica al broker: solo "Pratica inviata" + codice pratica + numero di agenzie contattate
- **Nessuna informazione** su orari delle singole agenzie o tempi attesi (rumore inutile, le agenzie hanno orari diversi)
- La dashboard mostra lo stato corrente (`in_attesa`, `accettata`, `in_escalation`) ma non countdown visibili al broker

#### Parametri configurabili da admin (default proposti)
- `T1` finestra round 1 = **8 ore lavorative dell'agenzia** (~1 giornata operativa)
- `T2` finestra round 2 = **8 ore lavorative**
- `T3` finestra round 3 = **16 ore lavorative** (~2 giornate operative)
- `R1` raggio iniziale = **comune selezionato**
- `R2` raggio esteso = **comuni limitrofi entro 15 km**
- `R3` raggio massimo = **provincia intera**
- `N` agenzie per round 1 e 2 = **5**
- `Nmax` cap round 3 = **15**

> Nota: il countdown è **per-agenzia**, basato sulle sue ore di apertura. Il round avanza solo quando **tutte** le agenzie del round corrente hanno esaurito la loro finestra senza accettare (oppure hanno tutte rifiutato esplicitamente).

#### Flusso a 3 round + escalation manuale

1. **Round 1 — Comune selezionato**
   - Invio a 5 agenzie ordinate per ranking nel comune
   - Ogni agenzia riceve notifica N6 immediatamente (anche fuori orario, l'email resta in inbox)
   - Countdown T1 parte per ciascuna agenzia all'apertura della propria prima fascia oraria utile
   - Se almeno 1 accetta → flusso normale, le altre vengono notificate "pratica già assegnata"
   - Stato pratica: `in_attesa_round_1`

2. **Round 2 — Estensione comuni limitrofi (15 km)**
   - Trigger automatico quando tutte le 5 agenzie del round 1 hanno esaurito T1 senza accettare
   - Esclude le agenzie già contattate
   - Invio a max 5 nuove agenzie nei comuni limitrofi
   - Stato pratica: `in_attesa_round_2`

3. **Round 3 — Provincia intera**
   - Trigger automatico quando tutte le agenzie del round 2 hanno esaurito T2
   - Esclude le precedenti
   - Invio a tutte le agenzie attive in provincia, fino a `Nmax` = 15
   - Stato pratica: `in_attesa_round_3`

4. **Escalation admin**
   - Se anche il round 3 fallisce → stato `in_escalation`
   - Notifica N10 (nuova) all'admin con priorità alta
   - Notifica N11 (nuova) al dealer: "la pratica è in gestione al nostro team, ti contatteremo a breve"
   - L'admin può: assegnare manualmente a un'agenzia partner di fiducia, contattare il dealer per cambiare comune, annullare

5. **Annullamento volontario**
   - In qualsiasi momento, il dealer può annullare la pratica dalla dashboard senza costi
   - I documenti restano salvati come bozza per 30 giorni

#### Regole anti-abuso ranking
- Agenzia che rifiuta esplicitamente >3 pratiche consecutive → decay ranking interno -0.5 per 7 giorni
- Agenzia che ignora (timeout senza risposta) >5 pratiche consecutive → marcata `inattiva`, sospesa dall'algoritmo finché non si riconnette
- Parametri configurabili da admin

#### Audit e KPI da tracciare
- % pratiche risolte al round 1 / 2 / 3 / escalation
- Tempo medio reale di assegnazione (clock time) e tempo lavorativo
- Top comuni con più escalation (segnale per onboarding commerciale agenzie)
- Top agenzie per tasso di accettazione e tasso di rifiuto
- Scostamento tra orari dichiarati e orari di effettiva attività (login/risposta)

#### Da validare con Alberto e Andrea prima dello sviluppo
- [ ] Conferma parametri di default (T1, T2, T3, R2, R3, N, Nmax)
- [ ] Conferma testi notifiche N6 / N9 (rimossa) / N10 / N11
- [ ] Conferma policy anti-abuso ranking
- [ ] Conferma esistenza di un'agenzia "partner di fiducia" per escalation manuale
- [ ] Conferma comportamento email N6 fuori orario (inviata subito vs schedulata all'apertura)

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
- [ ] Upload CI + CF amministratore (placeholder: attivato in Fase 3 con storage)
- [ ] Upload Visura Camerale (max 6 mesi) (placeholder: Fase 3)
- [x] Inserimento IBAN + flag autorizzazione SEPA (mandato Stripe reale in Fase 5)
- [x] Accettazione T&C con timestamp (registro IP da aggiungere)
- [~] Verifica email — token generato e tabella `verification_tokens` pronta; invio email reale in Fase 6
- [x] Approvazione automatica account (stato `PENDING_EMAIL_VERIFICATION` → `ACTIVE`)
- [x] Selezione ruolo (dealer / agenzia) in fase di registrazione
- [x] Step aggiuntivo per agenzia: inserimento orari di apertura — pagina `/orari` con fasce settimanali salvate su `OrariApertura`
- [ ] **UTM capture**: salvataggio `utm_contact` / `utm_source` da landing + `/register` → campo `User.crmContactId` (per matching CRM, vedi `crm-architettura.md` §10.3)
- [ ] **Webhook `user.signup.started`** emesso all'apertura del wizard Step 1 (evento pixel CRM §3.4)
- [ ] **Webhook `user.signup.completed`** emesso al termine del wizard (Caso A/B §4 doc CRM)
- [ ] Outbox `CrmOutboundEvent` + worker retry con backoff (vedi `crm-architettura.md` §10.4)

### 2.2 Auth e sicurezza
- [x] Login con Auth.js v5 (Credentials provider, JWT strategy)
- [x] Password policy (min 10, maiusc/minusc/numero) + hashing bcrypt 12 rounds
- [~] Reset password — pagina placeholder, flusso reale in Fase 6
- [ ] 2FA opzionale (email/OTP)
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
- [ ] Download singolo + download ZIP pratica completa
- [ ] Soft delete + retention policy

### 3.2 OCR libretto di circolazione
- [x] Provider abstraction `OcrProvider` con `MockOcrProvider` (dati plausibili deterministici su hash buffer)
- [x] Estrazione targa, telaio, proprietario, data immatricolazione (mock)
- [x] Rilevamento veicolo pre-2015
- [x] Rilevamento comodato d'uso (mock flag)
- [x] UI correzione dati estratti (wizard step 1, form editabile pre-submit)
- [ ] Fallback manuale in caso di OCR fallito (richiede UI skip)
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
- [x] Ricerca agenzie per comune/provincia selezionata (round 1)
- [x] Ordinamento per rating (avg desc, non rankate a fine, sospese escluse)
- [x] Soglia minima 5 valutazioni per applicare ranking (`RANKING.MIN_RATINGS_FOR_RANK`)
- [x] Gestione race condition "prima che accetta vince" (transazione accept chiude altre PENDING come ASSEGNATA_ALTRO)
- [x] Implementazione flusso fallback 3 round + escalation (vedi §0.5)
- [x] Countdown per-agenzia basato sui suoi orari di apertura
- [x] Engine "ore lavorative" (calcolo finestre, esclusione ChiusuraStraordinaria, multi-fascia)
- [x] Trigger passaggio round successivo (on-event via reject, on-schedule via tickPratica)
- [x] Stato pratica `IN_ATTESA_ROUND_1/2/3`, `IN_ESCALATION`
- [x] UI admin per visualizzazione escalation (`/admin/escalation`)
- [ ] UI admin per assegnazione manuale a partner di fiducia (solo lista, non ancora assign)
- [x] Invio notifiche (N6) alle agenzie del round corrente
- [x] Endpoint `/api/jobs/distribuzione-tick` + pulsante admin manuale
- [ ] Cron automatico scheduling (Vercel Cron / GitHub Actions)
- [ ] Anti-abuso ranking (decay rifiuti consecutivi, sospensione timeout >5)
- [ ] KPI dashboard fallback (% per round, tempi medi, comuni critici)
- [ ] Raggio km reale 15 km per round 2 (oggi mappa province limitrofe hardcoded Veneto)

### 4.2 Dashboard Agenzia
- [x] Lista pratiche in arrivo (`/inbox` con PENDING + storico ultime decisioni)
- [x] Pulsante Accetta / Rifiuta (transazionale, con motivazione rifiuto opzionale)
- [ ] Messaggio "Dossier completo e verificato da TF" (aspetta gating IA completo)
- [ ] Download singolo + ZIP pratica (pulsante placeholder presente)
- [x] Generazione codice pratica (`PV-YYYY-NNNNN`)
- [ ] Campo codice pratica interno agenzia + note (campo DB presente, UI da fare)
- [ ] Countdown 20 giorni visibile (autoAddebitoAt salvato, UI countdown da fare)
- [x] Pulsante "Firma avvenuta" (Step 3) — transazionale: pratica FIRMATA + credito wallet broker + FeeAddebito SCHEDULED
- [x] Storico pratiche completate (`/pratiche` filtrabile per stato)
- [ ] Riepilogo fee mensili e auto-addebiti (dati in DB, dashboard da comporre)

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
- [x] Accredito automatico 25 EUR per trapasso netto a firma confermata
- [x] Visualizzazione saldo wallet (`/wallet`)
- [x] Storico movimenti (ultimi 20 con saldo-post per audit)
- [x] Soglia <500 EUR: nessun payout (logica frontend + badge)
- [x] Soglia 500-999 EUR: alert payout manuale disponibile
- [ ] Pulsante richiesta payout manuale (UI placeholder — Stripe in Fase 5)
- [ ] Soglia ≥1000 EUR: payout automatico (logica da implementare + cron)
- [ ] Generazione rendiconto payout (PDF)
- [ ] Flusso fattura broker → TF basato su rendiconto

### 5.3 Fatturazione
- [ ] Fatturazione elettronica SDI verso agenzie (fee incassate)
- [ ] Ricezione fatture broker (da rendiconto)
- [ ] Gestione codici IVA / esenzioni
- [ ] Export contabile per commercialista

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
- [ ] Unsubscribe / preferenze notifiche (solo per quelle non obbligatorie)

---

## FASE 7 - Valutazioni e Ranking

- [ ] Notifica al dealer post-firma per valutare (form già visibile sul detail FIRMATA, manca la push proattiva)
- [x] Form 5 stelle + note opzionali (client component con hover preview)
- [x] Segnalazione abuso prezzo nelle note (flag `segnalazioneAbuso` in `Valutazione`)
- [x] Calcolo rating medio agenzia (`attachRating` con GROUP BY on-demand)
- [x] Soglia minima 5 valutazioni (`RANKING.MIN_RATINGS_FOR_RANK`)
- [x] Integrazione rating nell'algoritmo distribuzione (`rankCandidates` in `avviaRound`)
- [x] Sospensione automatica rating <2.5 (`RANKING.MIN_AVG_TO_STAY_ACTIVE`, visibile in `/admin/agenzie`)
- [ ] Review admin per agenzie sospese (UI di unsuspension / note)
- [x] Ranking NON pubblico (visibile solo lato admin e usato dall'engine distribuzione)

---

## FASE 8 - Raccolta Listini e Osservatorio Prezzi

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
- [ ] Gestione segnalazioni abusi (lista `Valutazione.segnalazioneAbuso=true`)
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
- [ ] Unit test core (gating documentale, wallet, algoritmo distribuzione)
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

### 13.4 Notifiche dedicate
- [ ] `N_REFERRAL_SIGNUP` (referral registrato)
- [ ] `N_REFERRAL_FIRST_PRATICA` (referral ha caricato la prima pratica)
- [ ] `N_MONTHLY_AFFILIATION_RECAP` (riepilogo mensile cron)
- [ ] `N_PAYOUT_AFFILIATION_AVAILABLE` (soglia €500 raggiunta)

### 13.5 Payout affiliazione
- [ ] Pulsante "Richiedi payout" attivo da €500 lordi
- [ ] Cron giorno 15 per erogazione mensile (integrato con Stripe Payout FASE 5)
- [ ] Rendiconto PDF dedicato (separare quota pratiche da quota affiliazione)

### 13.6 Admin
- [ ] Dashboard programma (click, iscrizioni da referral, % conversione, costo aggregato)
- [ ] Lista `AffiliationLink` + referral chain navigabile
- [ ] Vista flag anti-collusione per review manuale
- [ ] Override admin su singolo referral (disattiva / riattiva commissioni)

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
- [ ] Dashboard conversazioni per bot (storico, tagging, escalation umana) — differita a CRM-H
- [ ] Embed Chatbot WhatsApp/mail (WATI/Manychat) — differito a CRM-H

### 14.6 CRM-E — Dashboard CRM
- [ ] `/admin/crm/dashboard` aggregati (lead per stato S0..S10, conversion funnel S0→S7, fonti, agenti per performance)
- [ ] Grafici call-volume per giorno/ora (pre Vapi: dati mock; post Vapi: real)
- [ ] Tabella campagne attive con tasso risposta + conversione
- [ ] KPI: tempo medio S0→S3, S3→S7, costo per acquisizione

### 14.7 CRM-G — Sync con piattaforma (cron + webhook)
- [ ] Cron giornaliero che porta su `CrmContact` lo stato platform-side (`statusAccount`, `praticheTotali`, `ultimoAccesso`)
- [ ] Webhook outbound piattaforma → CRM su signup/pratica events (`user.signup.completed`, `pratica.first.created`, ecc.)
- [ ] Matching email/telefono/P.IVA e merge automatico (Caso A: contatto esistente → aggancia user; Caso B: nuovo iscritto → crea CrmContact)
- [ ] Outbox `CrmOutboundEvent` con retry esponenziale + HMAC firma + idempotency-key

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

## Stato MVP al 2026-05-06

**Progresso complessivo (effort-weighted): ~75-78%**

| Fase | % | Note |
|---|---|---|
| 0 Pre-sviluppo | ~30% | Stack scelto, naming, CTO. Resto su decisioni business/legali |
| 1 Fondamenta | ~75% | Monorepo, CI, DB, Prisma, Sentry, Docker, seed. Manca staging/prod/backup |
| 2 Auth | ~60% | Login, wizard registrazione, logout. Manca invito utenti, 2FA, rate limit, email reale |
| 2.5 Design system | 100% | Palette Trust Blue, componenti UI, layout role-based, restyle completo |
| 3 Documenti/OCR/Pratiche | ~50% | Storage+OCR mock operativi, wizard nuova pratica, lista/detail. Manca gating IA + upload CI/CF/visura |
| 4 Distribuzione + agenzia | ~85% | Engine 3-round + ore lavorative + ranking. Manca cron automatico, anti-abuso, raggio km reale |
| 5 Pagamenti/Wallet/SDI | ~25% | Logica DB completa (wallet, fee, transazioni, payout). Blocca Stripe → commercialista |
| 6 Notifiche | ~60% | 7/10 tipi agganciati + audit. Manca N3/N5/N7 (cron-based), unsubscribe |
| 7 Valutazioni/Ranking | ~85% | Form 5⭐, rating integrato in distribuzione, sospensione auto. Manca push notification + unsuspend UI |
| 8 Listini / Osservatorio | 0% | — |
| 9 Admin panel | ~50% | Route guard, overview, lista pratiche/utenti/agenzie/escalation, tick manuale. Manca assegnazione manuale, report |
| 10 CRM vendite esterno | 0% | Architettura + paper operativo pronti (`crm-architettura.md` + `ecosistema-crm-ai.md`), pronta a partire |
| 11 QA/Compliance/Lancio | 0% | — |
| 13 Sistema Affiliazione | 0% | Spec v3 + review CTO pronto (`sistema-affiliazione.md`), lancio pieno in parallelo a FASE 10 |
| 14 CRM interno team PV | ~62% | Bundle A/B/C/D/F in prod. Mancano E (dashboard), G (sync), H (Vapi — bloccato da account esterno) |

**Servono account esterni per:** email reale (Resend), storage (S3), OCR reale (Google Document AI), pagamenti (Stripe), CRM vendite stack (HubSpot/Make/Vapi/Twilio/Lemlist/Wistia).

---

## Note e blocchi attivi

| # | Blocco | Stato | Impatto | Owner |
|---|--------|-------|---------|-------|
| B1 | Validazione commercialista wallet/rendiconto | Aperto | Blocca Fase 5 | Andrea + Commercialista |
| B2 | Fallback 5 agenzie non accettano | Proposta in §0.5, da validare | Sblocca Fase 4.1 una volta approvato | Alberto + Andrea |
| B3 | Naming definitivo | Risolto: **Passaggio Veloce** | — | — |
| B4 | CTO socio fondatore | Risolto: **Francesco Sioli** | — | — |
| B5 | Scelta CRM core (HubSpot vs Airtable) | Aperto | Sblocca Fase 10.3 | CTO |
| B6 | Budget bot AI Vapi.ai | Aperto | Impatta Fase 10.5 + stima costi complessiva | Andrea + CTO |
| B7 | Testi SMS / script vocale / copy mail per stati S0-S10 | Aperto | Blocca Fase 10.7 | Sales + marketing |
| B8 | Validazioni AF1–AF5 sistema affiliazione (fiscale + CRM + anti-collusione + cap durata + mini voltura) | Aperto | Blocca Fase 13 | Alberto + Andrea + Commercialista + CTO |
| B9 | Dubbi 1-6 release post-demo 2026-05 (vedi `bugfix-feature-list.md` §"Dubbi aperti") | Risolto in `bugfix-feature-list.md` §"Decisioni prese" | — | — |
| B10 | Validazione legale clausole popup penale + wallet negativo (vedi `sistema-penali-broker.md` §"Punti di accordo legale") | Aperto | Blocca prod-launch sistema penali | Legale + Alberto |
| B11 | Validazione legale documenti successione/procura/comodato (vedi `schema-documentale-v7.md` §"Punti aperti") | Aperto | Blocca prod-launch schema documentale | Notaio + Legale + Alberto |
