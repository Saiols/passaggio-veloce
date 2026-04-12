# Passaggio Veloce - Piano di Implementazione MVP

> Documento operativo con checkbox per tracciare l'avanzamento lavori.
> Basato su: `riassunto-progetto.md`, `analisi-progetto.md`, `stima-costi.md`, Mockup, Policy Prezzi, Visione Strategica, Organigramma, CRM.
> Ultimo aggiornamento: 2026-04-12

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
- [ ] Scelta definitiva stack (React/Next.js + Node/Python + PostgreSQL)
- [ ] Scelta provider IA/OCR (GPT-4o Vision / Google Document AI / AWS Textract) + benchmark
- [ ] Scelta provider pagamenti (Stripe SEPA vs alternative)
- [ ] Scelta provider email transazionale
- [ ] Scelta provider SDI fatturazione elettronica
- [ ] Disegno architettura ambienti (dev / staging / prod)
- [ ] Schema database iniziale (ERD)
- [ ] Definizione data model utenti, pratiche, wallet, notifiche, valutazioni

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
- [ ] Repository Git + branching strategy
- [ ] Monorepo o repo separati (piattaforma / CRM interno / landing)
- [ ] CI/CD pipeline base
- [ ] Ambiente dev locale documentato
- [ ] Ambiente staging
- [ ] Ambiente produzione
- [ ] Secret management (env vars, vault)
- [ ] Logging + monitoring (Sentry, Datadog o equivalente)
- [ ] Backup automatici DB

### 1.2 Infrastruttura
- [ ] Hosting backend (cloud provider scelto)
- [ ] Storage S3-compatible con encryption at rest
- [ ] CDN per assets statici
- [ ] Dominio + certificati SSL
- [ ] Email transazionale configurata (SPF/DKIM/DMARC)
- [ ] Scheduler/cron jobs infrastruttura

### 1.3 Database e modelli base
- [ ] Schema utenti (admin, dealer, agenzia) con multi-utente
- [ ] Schema aziende (ragione sociale, P.IVA, SDI, PEC, IBAN)
- [ ] Schema documenti caricati (metadata + ref storage)
- [ ] Schema pratiche (tipo, stato, timeline, codice TF)
- [ ] Schema wallet broker + transazioni
- [ ] Schema fee / addebiti
- [ ] Schema valutazioni agenzie
- [ ] Schema listini raccolti
- [ ] Schema notifiche inviate (audit)
- [ ] Migrazioni versionate

---

## FASE 2 - Auth, Registrazione, Multi-utente

### 2.1 Registrazione (stesso form dealer/agenzia)
- [ ] Form registrazione azienda (ragione sociale, P.IVA, SDI, PEC, indirizzo)
- [ ] Form dati amministratore (Nome, Cognome, data/luogo nascita, CF)
- [ ] Upload CI + CF amministratore
- [ ] Upload Visura Camerale (validazione max 6 mesi)
- [ ] Inserimento IBAN + autorizzazione addebito SEPA
- [ ] Accettazione T&C con registro timestamp/IP
- [ ] Verifica email/PEC
- [ ] Approvazione automatica account
- [ ] Selezione ruolo (dealer / agenzia) in fase di registrazione
- [ ] Step aggiuntivo per agenzia: inserimento orari di apertura (giorni + fasce orarie multiple) + giorni di chiusura straordinaria

### 2.2 Auth e sicurezza
- [ ] Login JWT + refresh token
- [ ] Password policy + reset password
- [ ] 2FA opzionale (email/OTP)
- [ ] Rate limiting login
- [ ] Audit log accessi

### 2.3 Multi-utente e ruoli
- [ ] Utente admin azienda + utenti secondari
- [ ] Gestione permessi utenti secondari
- [ ] Invito utenti via email
- [ ] Revoca accessi

---

## FASE 3 - Core: Documenti, IA, Pratiche

### 3.1 Storage e upload documenti
- [ ] Upload file (PDF, JPG, PNG) con limite dimensione
- [ ] Anteprima documenti
- [ ] Encryption at rest
- [ ] Download singolo + download ZIP pratica completa
- [ ] Soft delete + retention policy

### 3.2 OCR libretto di circolazione
- [ ] Estrazione targa, telaio, proprietario, data immatricolazione
- [ ] Rilevamento comodato d'uso (da rimuovere)
- [ ] Rilevamento veicolo pre-10/2015 (richiede certificato proprietà)
- [ ] Fallback manuale in caso di OCR fallito
- [ ] UI correzione dati estratti

### 3.3 Gating documentale IA (killer feature)
- [ ] Classificatore tipo documento (CI, CF/Tessera Sanitaria, Visura, Permesso soggiorno, Procura, Libretto)
- [ ] Verifica fronte/retro CI
- [ ] Verifica leggibilità / scadenza
- [ ] Blocco invio pratica se un documento non passa la validazione
- [ ] Messaggi errore chiari all'utente
- [ ] Override manuale admin (caso eccezionale)
- [ ] Test set di validazione con documenti reali (non PII)

### 3.4 Dashboard Broker - 4 step pratica
- [ ] Step 0: selezione tipo pratica (trapasso netto / minivoltura / lotto massivo)
- [ ] Step 1: upload libretto + OCR + conferma dati
- [ ] Step 2: upload documenti venditore + acquirente (con flag cointestazione, minivoltura, procura)
- [ ] Step 3: selezione comune (input + autocomplete) + mappa agenzie
- [ ] Step 4: invio e schermata "in attesa"
- [ ] Salva bozza pratica
- [ ] Lista pratiche con stato (in attesa / accettata / in corso / firmata / scaduta)
- [ ] Dettaglio pratica con timeline

### 3.5 Lotto massivo
- [ ] Flusso dedicato: 1 acquirente, N venditori, N libretti
- [ ] Upload bulk libretti con OCR batch
- [ ] Generazione pratiche in serie
- [ ] Fee 15 EUR/veicolo

---

## FASE 4 - Distribuzione pratica e Dashboard Agenzia

### 4.1 Algoritmo distribuzione
- [ ] Ricerca 5 agenzie per comune selezionato
- [ ] Ordinamento per rating (4.5-5 priorità massima, <2.5 sospesa)
- [ ] Soglia minima 5 valutazioni per applicare ranking
- [ ] Gestione race condition "prima che accetta vince" (lock DB / atomic update)
- [ ] Implementazione flusso fallback 3 round + escalation (vedi §0.5)
- [ ] Countdown per-agenzia basato sui suoi orari di apertura
- [ ] Engine "ore lavorative" (calcolo finestre, esclusione ferie, multi-fascia)
- [ ] Trigger automatico passaggio round successivo
- [ ] Stato pratica `in_attesa_round_1/2/3`, `in_escalation`
- [ ] Gestione UI admin per escalation manuale + assegnazione partner di fiducia
- [ ] Invio parallelo notifiche alle agenzie del round corrente
- [ ] Gestione anti-abuso ranking (decay rifiuti, sospensione timeout)
- [ ] KPI dashboard fallback (% per round, tempi medi, comuni critici)

### 4.2 Dashboard Agenzia
- [ ] Lista pratiche in arrivo
- [ ] Pulsante Accetta / Rifiuta
- [ ] Messaggio "Dossier completo e verificato da TF"
- [ ] Download singolo + ZIP pratica
- [ ] Generazione codice pratica (es. TF-2026-04821)
- [ ] Campo codice pratica interno agenzia + note
- [ ] Countdown 20 giorni
- [ ] Pulsante "Firma avvenuta" (Step 3)
- [ ] Storico pratiche completate
- [ ] Riepilogo fee mensili e auto-addebiti

---

## FASE 5 - Pagamenti, Wallet, Fatturazione (MODULO CRITICO)

> **Prerequisito:** validazione commercialista completata (blocco 0.2)

### 5.1 Addebito agenzia
- [ ] Integrazione Stripe SEPA / card
- [ ] Addebito al flag "firma avvenuta" (Step 3)
- [ ] Auto-addebito al giorno 20 se firma non flaggata
- [ ] Gestione fallimenti addebito + retry
- [ ] Audit trail addebiti
- [ ] Notifica agenzia pre-addebito automatico

### 5.2 Wallet broker
- [ ] Accredito automatico 25 EUR per trapasso netto a firma confermata
- [ ] Visualizzazione saldo wallet
- [ ] Storico movimenti
- [ ] Soglia <500 EUR: nessun payout
- [ ] Soglia 500-999 EUR: pulsante richiesta payout manuale
- [ ] Soglia ≥1000 EUR: payout automatico
- [ ] Generazione rendiconto payout (PDF)
- [ ] Flusso fattura broker → TF basato su rendiconto

### 5.3 Fatturazione
- [ ] Fatturazione elettronica SDI verso agenzie (fee incassate)
- [ ] Ricezione fatture broker (da rendiconto)
- [ ] Gestione codici IVA / esenzioni
- [ ] Export contabile per commercialista

---

## FASE 6 - Notifiche (8 tipi)

- [ ] N1 Broker: conferma invio pratica a 5 agenzie
- [ ] N2 Broker: agenzia accetta + codice pratica + dati agenzia
- [ ] N3 Broker: sollecito ogni 5 giorni senza firma
- [ ] N4 Broker: firma avvenuta + credito wallet
- [ ] N5 Broker: payout automatico eseguito + rendiconto
- [ ] N6 Agenzia: nuova pratica disponibile (urgenza: altre 4 agenzie)
- [ ] N7 Agenzia: promemoria countdown + giorni rimasti + importo
- [ ] N8 Agenzia: addebito automatico eseguito
- [ ] N10 Admin: pratica in escalation (round 3 fallito)
- [ ] N11 Broker: pratica in gestione al team (escalation)
- [ ] Scheduler cron solleciti (ogni 5gg)
- [ ] Scheduler cron auto-addebiti (giorno 20)
- [ ] Scheduler cron payout (soglia 1000)
- [ ] Template email branded
- [ ] Unsubscribe / preferenze notifiche (solo per quelle non obbligatorie)

---

## FASE 7 - Valutazioni e Ranking

- [ ] Notifica al dealer post-firma per valutare
- [ ] Form 5 stelle + note opzionali
- [ ] Segnalazione abuso prezzo nelle note (flag admin)
- [ ] Calcolo rating medio agenzia
- [ ] Soglia minima 5 valutazioni
- [ ] Integrazione rating nell'algoritmo distribuzione
- [ ] Sospensione automatica rating <2.5 → revisione admin
- [ ] Ranking NON pubblico (solo interno)

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

- [ ] Overview: pratiche mese, revenue, auto-addebiti, registrazioni, payout in coda, pratiche senza risposta
- [ ] Gestione utenti (ricerca, lista, dettaglio, sospensione, blocco)
- [ ] Gestione pratiche (monitoring, override, dispute)
- [ ] Osservatorio Prezzi
- [ ] Gestione segnalazioni abusi
- [ ] Report finanziari
- [ ] Configurazione parametri (N agenzie per invio, timeout giorni, soglie wallet)
- [ ] Log di sistema / audit

---

## FASE 10 - CRM Interno (sistema SEPARATO dalla piattaforma)

### 10.1 Base CRM
- [ ] Auth separato
- [ ] 6 ruoli gerarchici: Admin / AD / CTO / CFO / Sales Manager / Sales
- [ ] Matrice permessi (vedi analisi-progetto.md §16.3)
- [ ] Account predefiniti al lancio (6)

### 10.2 Funzionalità CRM
- [ ] Gestione lead (dealer e agenzie target)
- [ ] Assegnazione contatti a Sales
- [ ] Promemoria e task
- [ ] Notifiche interne
- [ ] Dashboard operativa (Admin/AD/CTO/Sales Mgr)
- [ ] Dashboard economica (Admin/AD/CTO, CFO solo lettura)
- [ ] Gestione account utenti CRM (con restrizioni per ruolo)
- [ ] Log attività

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

## Target MVP - KPI da raggiungere

- [ ] 100 dealer attivi
- [ ] 50 agenzie partner (≥5 pratiche/mese cadauna)
- [ ] 5.000 pratiche completate
- [ ] ≥30 listini caricati (database prezzi iniziale)
- [ ] Sistema valutazioni operativo su tutte le agenzie attive
- [ ] Revenue ~180.000 EUR

---

## Note e blocchi attivi

| # | Blocco | Stato | Impatto | Owner |
|---|--------|-------|---------|-------|
| B1 | Validazione commercialista wallet/rendiconto | Aperto | Blocca Fase 5 | Andrea + Commercialista |
| B2 | Fallback 5 agenzie non accettano | Proposta in §0.5, da validare | Sblocca Fase 4.1 una volta approvato | Alberto + Andrea |
| B3 | Naming definitivo | Risolto: **Passaggio Veloce** | — | — |
| B4 | CTO socio fondatore | Risolto: **Francesco Sioli** | — | — |
