# Passaggio Veloce — Sistema di Affiliazione

> **Fonte:** `PassaggioVeloce SistemaAffiliazione v3.docx` (Aprile 2026)
> **Tipo documento:** specifica business + requisiti tecnici, con annotazioni CTO
> **Stato:** da validare prima dell'implementazione (commercialista + Alberto/Andrea)
> **Collocazione roadmap:** FASE 13 del `piano-implementazione.md` (post-MVP, attivazione
> proposta dopo il raggiungimento di ~200 operatori attivi)

---

## 0. Nota monetaria

Tutti i valori economici di questa specifica sono **LORDI IVA inclusa**. Il netto
percepito dipende dal regime fiscale di ciascun operatore (forfettario / ordinario /
SRL). Il trattamento fiscale delle commissioni di affiliazione, la struttura di
fatturazione e le eventuali ritenute d'acconto devono essere definiti col
commercialista **prima** del lancio del programma.

Vedi blocco **B1** nel `piano-implementazione.md` — oggi la wallet lavora in
centesimi senza distinzione netto/lordo, la distinzione andrà modellata a schema.

---

## 1. Visione

Il programma trasforma ogni operatore iscritto (broker o agenzia) in canale di
acquisizione attiva. Chi porta un nuovo operatore guadagna commissione lorda
automatica **per sempre** sulle pratiche del referral, finché quest'ultimo resta
attivo. Il CAC per Passaggio Veloce diventa variabile e proporzionale al ricavo
generato dall'ecosistema.

---

## 2. Struttura wallet e soglia payout

### 2.1 Wallet broker (una wallet, due voci)

| Voce | Fonte | Importo lordo |
|---|---|---|
| Pratiche (LORDO) | ogni pratica completata dal broker stesso | €25 lordi/pratica (trapasso netto) |
| Affiliazione (LORDO) | pratiche completate dai referral del broker | €10 lordi pratica standard / €5 lordi mini voltura |
| **Totale wallet lordo** | Pratiche + Affiliazione | Soglia payout €500 lordi |

Dashboard broker mostra sempre: `Pratiche: €X` | `Affiliazione: €Y` | `Totale: €Z`
con barra avanzamento verso €500.

### 2.2 Wallet agenzia (unico wallet, solo affiliazione)

| Voce | Fonte | Importo lordo |
|---|---|---|
| Affiliazione (LORDO) | pratiche completate dai referral dell'agenzia | €10 lordi standard / €5 lordi mini voltura |
| **Totale wallet lordo** | Solo affiliazione | Soglia payout €500 lordi |

L'agenzia **non guadagna** dalle pratiche che riceve: il wallet agenzia esiste
esclusivamente per le commissioni di affiliazione.

### 2.3 Payout

- Soglia unica: **€500 lordi** sul totale wallet
- Richiesta manuale con un click quando la soglia è raggiunta
- Erogazione: **il 15 del mese successivo** alla richiesta

---

## 3. Meccanica commissioni

### 3.1 Un solo livello

Programma a livello unico: chi porta X guadagna solo sulle pratiche di X. Se X
porta Y, chi ha portato X non guadagna nulla sulle pratiche di Y. **Niente MLM.**

### 3.2 Tetto fisso per pratica

Il tetto commissione è **fisso per pratica completata** e non si moltiplica per
il numero di referrer coinvolti:

| Scenario | Tipo pratica | Tot. commissione lorda | Split |
|---|---|---|---|
| Solo broker tramite referral | Standard | €10 | €10 al referrer broker |
| Solo agenzia tramite referral | Standard | €10 | €10 al referrer agenzia |
| Broker E agenzia tramite referral | Standard | **€10 totali** | €5 + €5 |
| Solo broker tramite referral | Mini voltura | €5 | €5 al referrer broker |
| Broker E agenzia tramite referral | Mini voltura | **€5 totali** | €2,50 + €2,50 |
| Nessuno tramite referral | Qualsiasi | €0 | — |

### 3.3 Durata e validità

- Commissione attiva **per sempre**, finché il referral resta iscritto e attivo
- Nessuna scadenza temporale
- Interruzione automatica se il referral viene sospeso o smette di operare
- Non è referralizzabile chi è **già iscritto** o **già in trattativa** (pipeline CRM)
- Ogni iscritto attivo riceve automaticamente il proprio link di affiliazione

---

## 4. Pixel tracking e attribuzione

| Evento | Trigger | Azione |
|---|---|---|
| Click link | apertura link affiliazione | registra click con timestamp (+ UTM + IP) |
| Iscrizione completata | nuovo utente registrato | crea associazione permanente `referral_by` |
| Prima pratica | referral carica prima pratica | notifica al referrer |
| Pratica completata | pratica chiusa con successo | calcola commissione + accredita wallet |
| Soglia payout | wallet totale ≥ €500 lordi | notifica payout disponibile |

> **Gap nel documento v3:** la sezione 4 del .docx originale è vuota oltre alla
> tabella eventi. Da definire: finestra di attribuzione in caso di multi-click
> (last-click con cap temporale es. 30 giorni), comportamento cookie + server-side
> fingerprint, gestione click senza registrazione.

---

## 5. Pagina affiliazione in dashboard

Stesso layout per broker e agenzia, con variante wallet.

1. **Introduzione** — titolo "Guadagna invitando colleghi", 3 numeri chiave
   (€10 pratica standard / €5 mini voltura / Per sempre)
2. **Video tutorial integrato** — animato 60–90 s, spiega meccanica + tempistiche
3. **Il tuo link affiliazione** — link univoco, pulsante "Copia", share WhatsApp
   con messaggio precompilato, QR code scaricabile
4. **Statistiche** — click, iscrizioni generate, referral attivi, pratiche totali
   referral, commissioni del mese, totale storico
5. **Lista referral** — nome operatore, data iscrizione, pratiche completate,
   commissioni generate, stato
6. **Wallet** — vista broker (Pratiche + Affiliazione + Totale) o agenzia
   (solo Affiliazione), barra soglia, pulsante "Richiedi payout" attivo da €500

---

## 6. Simulazioni economiche (valori lordi)

### Scenario A — Broker con 3 agenzie referral

| Fonte | Pratiche/mese | Commissione | Wallet lordo mensile |
|---|---|---|---|
| Proprie pratiche | 30 | €25 | €750 |
| Agenzia referral 1 | 20 | €10 | €200 |
| Agenzia referral 2 | 15 | €10 | €150 |
| Agenzia referral 3 | 10 | €10 | €100 |
| **TOTALE** | — | — | **€1.200/mese** |

### Scenario B — Agenzia con 5 broker referral

| Fonte | Pratiche/mese | Commissione | Wallet lordo mensile |
|---|---|---|---|
| Broker referral 1 | 20 | €10 | €200 |
| Broker referral 2 | 15 | €10 | €150 |
| Broker referral 3 | 10 | €10 | €100 |
| Broker referral 4 | 8 | €10 | €80 |
| Broker referral 5 | 5 | €10 | €50 |
| **TOTALE** | — | — | **€580/mese** |

### Scenario C — Pratica con doppio referral

- Fee lorda incassata da PV: **€50**
- Commissione lorda totale affiliazione: **€10** (tetto)
- Split: €5 broker referrer + €5 agenzia referrer
- Margine PV per pratica: €40 (vs €50 senza affiliazione)

---

## 7. Requisiti tecnici

### 7.1 Backend / schema

- Campo `User.referralBy` (o meglio `Company.referralBy`) **permanente**
- Modello `AffiliationLink` (token univoco + `ownerCompanyId` + click counter)
- Modello `AffiliationClick` (timestamp, IP, UA, utm) — per attribuzione
- Split automatico commissione lorda al completamento pratica + ledger dedicato
- Wallet broker: doppia voce `Pratiche` / `Affiliazione` (oggi unica `saldoCent`)
- Wallet agenzia: nuovo wallet (oggi non esiste — agenzie non hanno wallet)
- Trigger notifica soglia €500
- Erogazione payout il 15 del mese successivo (cron + Stripe payout)

### 7.2 Frontend

- Pagina `/affiliazione` dedicata, menu dashboard broker + agenzia
- Etichetta esplicita LORDO su ogni importo
- Copia link + share WhatsApp + QR code downloadable
- Landing `/r/:token` separata dal `/register` — atterraggio tracciato prima del wizard

### 7.3 Notifiche

- Nuovo tipo `N_REFERRAL_SIGNUP` (il tuo referral si è iscritto)
- Nuovo tipo `N_REFERRAL_FIRST_PRATICA` (prima pratica del referral)
- Nuovo tipo `N_MONTHLY_AFFILIATION_RECAP` (riepilogo mensile)
- Nuovo tipo `N_PAYOUT_AVAILABLE` (wallet ≥ €500)

---

## 8. Osservazioni CTO — rischi, gap, proposte

> Questa sezione **non è nel .docx originale**: raccoglie il review del CTO
> sulla spec v3 per la validazione con Alberto / Andrea / commercialista.

### 8.1 LTV aperta — "per sempre" senza cap

Un'agenzia referral che macina 50 pratiche/mese per 5 anni genera
€10 × 50 × 12 × 5 = **€30.000 lordi** di payout su un singolo evento di
referral. In termini di revenue share è una cessione stabile del **20%** del
ricavo lordo TF su trapasso netto (€10 / €50) e del **33%** su mini voltura
(€5 / €15).

**Opzione mitigante:** durata massima 24 mesi dall'iscrizione del referral.
Ammortizza il CAC, mantiene attrattività, protegge il margine long-term.

### 8.2 Mini voltura — commissione sproporzionata

€5 su una fee di €15 = **33%** di revenue share. Sulle altre pratiche è 20%.
Proposta: **commissione affiliazione solo su trapasso netto**, zero su mini
voltura e lotto massivo (entrambi a fee €15). Semplifica messaggio e protegge
margine sulle pratiche a basso ricavo.

### 8.3 Rischio collusione — auto-referral

Un broker può aprire società di comodo con P.IVA diversa per darsi €10 in più
a pratica. Controlli minimi da implementare prima dello scatto commissione:

- stesso IBAN referrer ↔ referral → blocco automatico
- stesso admin/CF → blocco automatico
- stesso IP di registrazione → flag manuale admin
- stesso dominio email (post @) → flag manuale admin

### 8.4 Conflitto con pipeline CRM (S0–S10)

Il doc afferma: *"non si può referralizzare chi è già iscritto o in
trattativa"*. Oggi il CRM è esterno (HubSpot/Make) e la piattaforma è solo
emettitore. Serve **verifica bidirezionale** al click/registrazione: la
landing `/r/:token` interroga il CRM per stato contatto. Se stato ≠ S0, il
referral non viene registrato (o viene registrato con flag `disputed` per
review admin).

Dipendenza: blocco **B5** (scelta CRM core) della FASE 10.

### 8.5 Sezione §4 del .docx è incompleta

Pixel tracking: solo tabella eventi, mancano finestra di attribuzione,
policy multi-click, fallback no-cookie. Da riempire prima dell'implementazione.

### 8.6 Ambiguità fiscale lordo/netto

Il doc insiste sul "lordo IVA inclusa" ma la wallet attuale è a saldo unico in
centesimi. Impatti:

- broker forfettario (no IVA) riceve effettivamente lordo = netto dichiarato
- broker SRL riceve lordo, deve emettere fattura con IVA 22% → cash flow -22%
- split €5/€5 nel doppio referral ha significati diversi per regimi diversi

**Blocco dipendenza:** B1 (validazione commercialista) del piano.

### 8.7 Soglia payout €500 — orizzonte per agenzie

Broker raggiunge la soglia praticamente sempre (20 pratiche proprie =
€500 già dalla wallet pratiche, l'affiliazione è accessorio). Agenzie puntano
**solo** sull'affiliazione: con 5 broker medi serve ~1 mese per €500, con
2–3 broker leggeri >3 mesi. Rischio disengagement per agenzie piccole.

**Proposta:** soglia differenziata (es. €250 agenzie / €500 broker), oppure
soglia unica più bassa €300.

### 8.8 Timing di lancio

MVP target = 100 dealer + 50 agenzie. Network effects emergono sopra ~200–300
operatori. Lanciare il programma al go-live significa:

- bassa viralità iniziale (pochi referrer potenziali)
- molti payout €25 da pratiche proprie broker senza boost affiliazione
- rischio di "bruciare" il programma come novità prima che funzioni

**Proposta:** MVP include schema + `referralBy` field + landing
`/r/:token` in attribution-only, attivazione piena commissioni alla **FASE
2 strategica** (target 200 operatori).

### 8.9 Margine reale TF

Il doc afferma: *"margine TF identico indipendentemente dal numero di
affiliati"*. Vero rispetto al numero di referrer sulla stessa pratica, **non**
rispetto alla presenza o meno di affiliazione. Appena c'è ≥1 referrer il
margine TF scende del 20% (standard) / 33% (mini voltura). Da comunicare
internamente con chiarezza per non sottostimare l'impatto nei forecast.

### 8.10 Privacy e trasparenza referral

La "Lista referral" del referrer mostra pratiche completate del referral.
Info aziendale sensibile — va disclosed nei T&C come condizione accettata dal
referral al momento dell'iscrizione tramite link.

---

## 9. Dipendenze e blocchi

| # | Blocco | Stato | Impatto |
|---|---|---|---|
| AF1 | Validazione commercialista trattamento fiscale commissioni | Aperto | Blocca lancio |
| AF2 | Review §8.1–8.7 con Alberto + Andrea | Da fare | Blocca sviluppo |
| AF3 | Completamento §4 pixel tracking (policy attribuzione) | Da fare | Blocca attribuzione |
| AF4 | Scelta CRM core (B5 piano) per verifica S0 | Aperto | Blocca §8.4 |
| AF5 | Policy controlli anti-collusione (§8.3) | Da definire | Blocca scatto commissione |

---

## 10. Prossimi passi (se validato)

1. Aggiungere schema Prisma: `AffiliationLink`, `AffiliationClick`,
   `Company.referralBy`, wallet split voci pratiche/affiliazione
2. Landing `/r/:token` con UTM capture + cookie persistence + stato CRM check
3. Pagina `/affiliazione` nel menu dashboard (broker + agenzia)
4. Engine commissione: hook su transizione `Pratica.FIRMATA` per split wallet
5. Notifiche nuove (§7.3)
6. Cron payout giorno 15 (sincronizzato con Stripe Payout della FASE 5)
7. Pannello admin affiliazione (lista link, referral chain, anti-collusione flag)
