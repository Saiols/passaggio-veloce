# Passaggio Veloce — Sistema Fatturazione

> Sorgenti:
> - `docs/PassaggioVeloce FatturazioneDelegata.docx` (modello fiscale, aprile 2025)
> - `docs/PassaggioVeloce FatturazionePiattaforma.docx` (struttura tecnica UI/funzionale, aprile 2025)
>
> Owner: CTO Francesco Sioli. Source-of-truth della feature.
> Stato: **modello operativo definito, dettagli fiscali (TD01/TD06/IVA/ritenuta) e clausole T&C in attesa di validazione (B1 commercialista + B-LEGAL legale).**
> Sostituisce il vecchio flusso "rendiconto PDF → broker emette fattura a PV" descritto in `analisi-progetto.md` §3.3 e nel piano FASE 5.2/5.3.

---

## 1. Logica di base

PV adotta un modello di **fatturazione delegata** ispirato a Booking.com / Airbnb. Per ogni pratica completata coesistono tre soggetti fiscali distinti — agenzia, PV, broker — e PV gestisce per conto del broker l'emissione del documento fiscale, mantenendo separata la propria contabilità da quella delle somme di terzi.

### 1.1 Flusso economico (per tipo pratica e regime broker)

> **Nota listino (fonte autorevole = backoffice):** gli importi di costo agenzia, compenso broker e commissione di affiliazione riportati qui sotto sono **illustrativi** e riferiti al listino storico. Il **listino ufficiale corrente** è modificabile dal backoffice in `/admin/tariffe` e per i prezzi correnti fa fede quello (il chatbot lo inietta come fonte autorevole). Gli split fiscali per regime (50/25, 55/20, ecc.) restano il **modello di ripartizione**, da applicare ai valori correnti del listino. In particolare la minivoltura è descritta qui a €30/€20 ma il listino attivo può differire: fa fede `/admin/tariffe`.

Importi (LORDI IVA inclusa, convenzione PV) — coerenti con `analisi-progetto.md` §3.1 nella sua versione aggiornata.

**Trapasso netto — split dinamico in base al regime fiscale del broker:**

| Regime broker | Fee agenzia | Quota PV | Quota broker | Documenti generati |
|---|---|---|---|---|
| `ORDINARIO` | €75 | **€50** | **€25** | Fattura PV €50 (TD01, IVA 22%) + Doc. broker €25 (TD01, IVA 22%) |
| `FORFETTARIO` | €75 | **€55** | **€20** | Fattura PV €55 (TD01, IVA 22%) + Doc. broker €20 (TD06, fuori campo IVA) |
| `PRIVATO` | €75 | **TBD commercialista** (ipotesi €55) | **TBD** (ipotesi €20 con eventuale ritenuta d'acconto 20%) | Fattura PV + ricevuta non fiscale broker (no XML SDI) |

> **Razionale:** l'agenzia paga sempre €75 lordi a prescindere dal regime broker. Ciò che cambia è la ripartizione interna: il forfettario non scarica IVA quindi PV gli riconosce €20 lordi (≈ pari netto a €25 ordinario meno IVA scaricata), trattenendo €55 invece di €50. Per il broker privato lo split definitivo dipende dal trattamento fiscale (ritenuta d'acconto 20% applicabile?), da chiudere con commercialista (B1).

**Minivoltura — broker non maturà nulla, niente delega:**

| Tipo | Fee agenzia | Quota PV | Quota broker | Affiliazione | Documenti generati |
|---|---|---|---|---|---|
| **Minivoltura standard** (singola) | €30 | €30 | €0 (dealer=broker) | €5 lordi (€2,50+€2,50 doppio) | Solo Fattura PV €30 |
| **Minivoltura multipla** (lotto) | €20 / veicolo | €20 / veicolo | €0 | €5 lordi (€2,50+€2,50 doppio) | Solo Fattura PV per veicolo |

> **Affiliazione (FASE 13):** parallela alla fatturazione, gestita da `sistema-affiliazione.md`. Per trapasso netto: €10 lordi (€5+€5 doppio referral). Per minivoltura: €5 lordi (€2,50+€2,50). La commissione è erogata via wallet, non genera documenti fiscali nel modello attuale (rimanda a B1/AF1 commercialista).

### 1.2 Flusso documentale per **trapasso netto**

Quote indicate come `(ord)` ordinario / `(forf)` forfettario.

| Step | Evento | Documento generato | Emittente | Destinatario |
|---|---|---|---|---|
| 1 | Pratica `FIRMATA` | — | — | — |
| 2 | Accredito wallet broker (somme di terzi) | — (transazione interna) | — | Wallet broker (€25 ord / €20 forf) |
| 3 | Notifica firma a broker e agenzia | Email (N4 broker, N8 agenzia — **senza** fattura allegata) | Sistema | Broker + Agenzia |
| 4 | Addebito agenzia (SEPA, disposto alla firma) | — | — | PV incassa €75 totali |
| 5 | **Incasso confermato** → generazione fattura PV | Fattura €50 (ord) / €55 (forf) — PDF + XML TD01 | Passaggio Veloce S.r.l. | Agenzia |
| 6 | Notifica fattura disponibile (N53) | Email con PDF allegato | Sistema | Agenzia |
| 7 | Soglia payout raggiunta | — | — | Broker (notifica N5/N24) |
| 8 | Payout | Bonifico SEPA | PV | IBAN broker |
| 9 | Generazione documento broker (**al payout**) | Doc. €25 (ord, TD01) / €20 (forf, TD06) — PDF + XML | PV per conto del broker (delega contrattuale) | Passaggio Veloce (somme di terzi) |
| 10 | Trasmissione SDI doc. broker | — | Broker (manuale, fuori piattaforma) | SDI / Agenzia delle Entrate |

> La fattura PV nasce **all'incasso confermato dell'addebito**, non alla firma: per una prestazione di servizi il momento impositivo è il pagamento (art. 6 D.P.R. 633/1972). Con addebito SEPA la conferma arriva dopo alcuni giorni lavorativi, quindi fra la chiusura della pratica e la fattura passa del tempo.

### 1.3 Flusso documentale per **minivoltura** (singola o massiva)

Caso degenerato: dealer e broker coincidono, broker non maturà nulla in wallet, **non si applica delega**. Si genera solo la fattura PV verso l'agenzia.

| Step | Evento | Documento generato | Emittente | Destinatario |
|---|---|---|---|---|
| 1 | Pratica `FIRMATA` | — | — | — |
| 2 | Notifica firma all'agenzia | Email (N8 — **senza** fattura allegata) | Sistema | Agenzia |
| 3 | Addebito agenzia (SEPA, disposto alla firma) | — | — | PV incassa €30 (standard) o N×€20 (multipla) |
| 4 | **Incasso confermato** → generazione fattura PV | Fattura €30 (standard) / €20 per veicolo (multipla) — PDF + XML TD01 | Passaggio Veloce S.r.l. | Agenzia |
| 5 | Notifica fattura disponibile (N53) | Email con PDF allegato | Sistema | Agenzia |

> **Da confermare:** per la minivoltura multipla emettiamo una fattura unica multi-riga (1 fattura totale = N×€20) o N fatture separate da €20 ciascuna? La spec assume **una fattura unica multi-riga per lotto** (più snello per agenzia + numerazione progressiva pulita), da rivedere con commercialista.

### 1.4 Separazione contabile in PV

Per ogni trapasso netto:
- **Ricavo proprio PV:** €50 lordi → conto economico, fatturato
- **Somme di terzi:** €25 lordi → debito verso broker, contabilizzato separatamente, NON è ricavo

Per minivoltura: l'intero importo (€15) è ricavo PV, niente somme di terzi.

---

## 2. Decisioni prese

| # | Tema | Decisione |
|---|---|---|
| 1 | Modello | **Fatturazione delegata** (PV emette doc broker per suo conto). Sostituisce il vecchio "broker emette fattura a PV su rendiconto". |
| 2 | Importi | **Trapasso netto:** €75 lordi totale, split dinamico 50+25 (broker ord) / 55+20 (broker forf) / TBD privato. **Minivoltura standard:** €30 (tutto PV). **Minivoltura multipla:** €20/veicolo (tutto PV). Vedi §1.1. |
| 2bis | Affiliazione | Quote già definite in `sistema-affiliazione.md` §3 — €10 lordi trapasso (€5+€5 doppio), €5 lordi minivoltura (€2,50+€2,50 doppio). Erogata via wallet, niente documento fiscale dedicato. |
| 3 | Soglie payout | Coerenti con stato attuale: <€500 nessun payout, €500-999 manuale su richiesta, ≥€1000 automatico. |
| 4 | Trasmissione SDI broker | **Responsabilità del broker**. PV genera PDF+XML pronti, il broker li scarica e li trasmette via proprio canale FE. Toggle "Segna come trasmesso" manuale lato dashboard broker per audit interno. |
| 5 | Numerazione progressiva | Schema ibrido prefisso + ID soggetto con reset annuale: `PV-<anno>-NNNNN` (fattura PV → agenzia), `PV-<id4>-<anno>-NNNNN` (documento broker conto terzi, `<id4>` = `Company.numeroSoggetto` zero-pad 4 cifre), `NC-<anno>-NNNNN` / `NC-<id4>-<anno>-NNNNN` (note di credito), `PN-…` (penale). Zero-pad 5 cifre sul progressivo. Granularità **per azienda madre** (`Company`, P.IVA unica — non per sede). Contatori in tabella dedicata `contatori_fiscali` (chiave `idSoggetto, tipoDocumento, anno`); incremento atomico `INSERT … ON CONFLICT … RETURNING` dentro la stessa transazione del documento (no buchi, no duplicati, rollback automatico se la create fallisce). `Company.numeroSoggetto` assegnato da Postgres `SEQUENCE` univoca (`numero_soggetto_seq`), mai riusata nemmeno alla chiusura account. Note di credito su sequenza separata (`tipoDocumento = NOTA_CREDITO`, distinta da `FATTURA_PV` / `DOC_BROKER`). Decisioni verbalizzate in `docs/numerazione-fatture-decisioni.md`. |
| 6 | OTP agenzia | Verifica via SMS in fase di iscrizione agenzia, **obbligatoria** per autorizzare addebito automatico (clausola T&C). |
| 7 | Retention | 10 anni (obbligo fiscale italiano), tutti i PDF+XML su storage sicuro con accesso via URL firmato a scadenza. |
| 8 | Immutabilità | Documenti generati non modificabili. Errori → nota di variazione separata. |
| 9 | Notifica email | Ogni nuovo documento generato → email automatica al destinatario con PDF allegato. |
| 10 | Filtri/export | Lista pratiche embeds icona PDF inline + sezione `/fatturazione` dedicata con ricerca, filtri, export PDF/XML/CSV/ZIP. |

---

## 3. Schema impacts

### 3.1 Estensione `Company` (broker e agenzia)

```prisma
model Company {
  // ... campi esistenti

  /// Regime fiscale del soggetto emittente. Determina il tipo documento
  /// generato per i suoi compensi (TD01 ordinario, TD06 forfettario,
  /// ricevuta non fiscale per privati). Da definire con commercialista.
  regimeFiscale RegimeFiscale?

  /// Per agenzie: codice destinatario SDI (7 char alfanumerici) OPPURE PEC.
  /// Almeno uno dei due è obbligatorio per ricevere fatture elettroniche.
  /// Già presente: codiceSdi String?, pec String. Validazione applicativa.

  /// Numerazione (paper NumerazioneFatture): ID soggetto univoco a 4 cifre
  /// nel numero documento broker (es. "PV-0047-2026-00001").
  /// Assegnato da Postgres SEQUENCE `numero_soggetto_seq`; univoco, mai riusato.
  /// I contatori progressivi per (soggetto, tipo, anno) sono nella tabella
  /// `contatori_fiscali` (vedi §6.5 e `docs/numerazione-fatture-decisioni.md`).
  /// Le vecchie colonne numeratoreFiscaleAnno / numeratoreFiscaleNum
  /// sono state rimosse dalla migration `numerazione_paper`.
  numeroSoggetto Int @unique // Postgres SEQUENCE numero_soggetto_seq

  /// OTP verificato in fase di iscrizione (obbligatorio per agenzie:
  /// abilita addebito automatico). Per broker: opzionale.
  otpVerifiedAt DateTime?
  otpPhone      String?      // numero su cui è stato inviato l'OTP

  /// Accettazione esplicita clausola fatturazione delegata (broker)
  /// o doppia fatturazione (agenzia). Distinta da termsAcceptedAt.
  fatturazioneClauseAcceptedAt DateTime?
  fatturazioneClauseVersion    String?   // es. "v1.0"
}

enum RegimeFiscale {
  ORDINARIO    // P.IVA con IVA — TD01, IVA 22%
  FORFETTARIO  // P.IVA forfettario — TD06 fuori campo IVA (art. 1 c. 54-89 L. 190/2014)
  PRIVATO      // CF, niente P.IVA — ricevuta non fiscale, possibile ritenuta d'acconto
}
```

### 3.2 Estensione `User` (broker rappresentante legale)

`User.codiceFiscale` esiste già ma è opzionale. Per i broker che agiscono come persone fisiche (regime PRIVATO) il CF deve essere obbligatorio applicativamente in fase di iscrizione.

Per broker PRIVATO i dati di residenza e il regime fiscale sono richiesti sull'utente, non sulla Company (che potrebbe non esistere come azienda).

> Decidere: estendere `User` con `regimeFiscale`/`indirizzoResidenza`/`iban` oppure forzare la creazione di una Company "fittizia" anche per broker privati. **Proposta:** mantenere il pattern attuale (Company per tutti) e popolare i campi fiscali sulla Company. Coerente con `Company.iban` già esistente.

### 3.3 Nuovo modello `DocumentoFiscale`

Modello dedicato perché:
- I documenti fiscali sono **immutabili** (non si modifica `FeeAddebito`, si emette nota di variazione)
- Devono essere indicizzati e queryati con filtri/ricerca pesanti
- Servono entrambi i formati PDF + XML su storage
- Numerazione progressiva separata per emittente

```prisma
model DocumentoFiscale {
  id String @id @default(uuid()) @db.Uuid

  /// Pratica di riferimento. Una pratica trapasso genera 2 DocumentoFiscale,
  /// una minivoltura ne genera 1.
  praticaId String  @db.Uuid
  pratica   Pratica @relation(fields: [praticaId], references: [id])

  /// Tipo documento (vedi enum sotto). Determina chi è emittente, importo, formato XML.
  tipo DocumentoFiscaleTipo

  /// Soggetto emittente reale (chi compare in CedentePrestatore nell'XML).
  /// FATTURA_PV → company di PV stessa (Settings o costante)
  /// DOC_BROKER → company del broker
  /// PENALE_BROKER → mai valorizzato: la penale non genera DocumentoFiscale
  /// (fuori campo IVA, clausola 10.4(b) dei Termini — vedi §6.4).
  emittenteCompanyId String?  @db.Uuid
  emittenteCompany   Company? @relation("DocumentiEmessi", fields: [emittenteCompanyId], references: [id])

  /// Soggetto destinatario (CessionarioCommittente nell'XML). Sempre l'agenzia.
  destinatarioCompanyId String  @db.Uuid
  destinatarioCompany   Company @relation("DocumentiRicevuti", fields: [destinatarioCompanyId], references: [id])

  /// Tipo XML FatturaPA dinamico in base al regime fiscale dell'emittente.
  /// Per FATTURA_PV: sempre TD01.
  /// Per DOC_BROKER: TD01 (ordinario) / TD06 (forfettario) / nessun XML (privato).
  /// Per PENALE_BROKER: N/A — non genera mai un DocumentoFiscale (§6.4).
  fatturaPaTipo FatturaPaTipo?

  /// Numero progressivo nel registro dell'emittente, per anno fiscale.
  /// Es. "1/2026" → numeroProgressivo=1, anno=2026
  numeroProgressivo Int
  anno              Int

  /// Importi in centesimi (convenzione interna PV).
  importoLordoCent     Int   // es. 5000 (€50) o 2500 (€25) o 1500 (€15)
  imponibileCent       Int?  // calcolato in base al regime emittente
  ivaCent              Int?  // 0 per forfettario/privato
  aliquotaIvaPct       Int?  // 22 per ordinario, 0 per forfettario/privato
  ritenutaAccontoCent  Int?  // se applicabile (privato), TBD commercialista

  /// Stato pagamento (solo per FATTURA_PV verso agenzia).
  statoPagamento DocumentoFiscaleStatoPagamento @default(IN_ATTESA)

  /// Stato trasmissione SDI (solo per DOC_BROKER, aggiornato manualmente
  /// dal broker dopo trasmissione via proprio canale FE).
  trasmessoSdiAt DateTime?
  trasmessoSdiBy String?  @db.Uuid

  /// Storage keys (PDF generato + XML FatturaPA quando applicabile).
  pdfStorageKey String
  xmlStorageKey String?

  /// Hash SHA256 del contenuto per audit/anti-tamper.
  pdfHash String

  /// Eventuale fee/transazione che ha originato il documento (audit).
  feeAddebitoId         String?              @db.Uuid
  feeAddebito           FeeAddebito?         @relation(fields: [feeAddebitoId], references: [id])
  transazioneWalletId   String?              @db.Uuid @unique
  transazioneWallet     TransazioneWallet?   @relation(fields: [transazioneWalletId], references: [id])

  /// Ref a eventuale nota di variazione (rettifica/storno).
  notaVariazionePerId String?           @db.Uuid
  notaVariazionePer   DocumentoFiscale? @relation("NoteVariazione", fields: [notaVariazionePerId], references: [id])
  notaVariazioneFiglie DocumentoFiscale[] @relation("NoteVariazione")

  emessoAt    DateTime @default(now())
  inviatoEmailAt DateTime?

  @@unique([emittenteCompanyId, anno, numeroProgressivo, tipo])
  @@index([praticaId])
  @@index([destinatarioCompanyId, statoPagamento])
  @@index([emittenteCompanyId, anno])
  @@index([emessoAt])
  @@map("documenti_fiscali")
}

enum DocumentoFiscaleTipo {
  FATTURA_PV       // €50 (trapasso) o €15 (minivoltura) — emessa da PV
  DOC_BROKER       // €25 — emesso da PV per conto del broker
  PENALE_BROKER    // valore di riserva, MAI creato: la penale è fuori campo IVA
                    // (clausola 10.4(b)) e resta solo movimento wallet — vedi §6.4
  NOTA_VARIAZIONE  // Storno / rettifica di altro DocumentoFiscale
}

enum FatturaPaTipo {
  TD01  // Fattura ordinaria
  TD06  // Parcella professionale (regime forfettario tipico)
  TD04  // Nota di credito
  TD05  // Nota di debito
}

enum DocumentoFiscaleStatoPagamento {
  IN_ATTESA   // Generato, addebito agenzia non ancora eseguito
  PAGATA      // FeeAddebito EXECUTED con successo
  SCADUTA     // > 15gg da emissione, non pagata (alert admin)
  STORNATA    // Coperta da nota di variazione
}
```

### 3.4 Migrazioni stimate

1. `add_regime_fiscale` — enum `RegimeFiscale` + campi `Company.regimeFiscale`, `numeratoreFiscaleAnno/Num`, `otpVerifiedAt/Phone`, `fatturazioneClauseAcceptedAt/Version`
2. `add_documento_fiscale` — modello completo + 4 enum (`DocumentoFiscaleTipo`, `FatturaPaTipo`, `DocumentoFiscaleStatoPagamento`)
3. `link_documento_to_fee_and_tx` — FK opzionali `FeeAddebito.documentoFiscaleId`, `TransazioneWallet` ↔ `DocumentoFiscale` 1:1 opzionale
4. `add_company_documenti_relations` — relazioni inverse `Company.documentiEmessi` e `Company.documentiRicevuti`

---

## 4. Componenti & flussi UI

### 4.1 Lista pratiche (tutti i ruoli) — accesso rapido

In ogni riga di `/pratiche` si aggiungono icone azione contestuali:

| Ruolo | Icone | Stato |
|---|---|---|
| **Broker** | `📄` Doc broker (PDF) — solo per trapasso netto | Badge "SDI: Trasmesso/Non trasmesso" |
| **Agenzia** | `📄` Fattura PV + `📄` Doc broker (se trapasso) | Badge pagamento (verde/arancio/rosso) |
| **Admin** | `📄` Tutti i documenti emessi sulla pratica | — |

Click sull'icona → download diretto del PDF. Nel dettaglio pratica `/pratiche/[id]` aggiunta sezione "Documenti fiscali" con PDF e XML scaricabili separatamente, e — per broker — toggle "Segna come trasmesso allo SDI".

### 4.2 Sezione `/fatturazione` Broker

**Path:** `/fatturazione` (sostituisce/affianca `/wallet` esistente, integrazione TBD).

Componenti:
- **Dashboard wallet** (riusa `WalletCard` esistente): saldo pratiche LORDO, saldo affiliazione LORDO, totale, barra avanzamento soglia €500/€1000, prossimo payout previsto.
- **Lista documenti fiscali emessi per conto del broker** (paginata 50/pagina, lazy load):
  - Colonne: data pratica, ID pratica, importo lordo, stato SDI, azioni (PDF/XML/segna trasmesso)
  - Ricerca: codice pratica o data
  - Filtri: periodo (oggi/settimana/mese/anno/custom), stato SDI (tutti/non trasmessi/trasmessi)
- **Storico payout** (riusa logica esistente): lista payout con data/importo/ref bonifico, storico penali con pratica, bottone "Richiedi payout" attivo da €500.
- **Export**: PDF singolo, XML singolo, ZIP periodo (PDF+XML), riepilogo PDF periodo, riepilogo CSV, anno completo.

### 4.3 Sezione `/fatturazione` Agenzia

**Path:** `/fatturazione` (nuova).

Componenti:
- **Dashboard riepilogativa**: totale pagato mese/anno, pratiche completate mese, totale da pagare (in attesa).
- **Lista documenti**: per ogni pratica trapasso 2 righe (Fattura PV €50 + Doc broker €25), per ogni minivoltura 1 riga.
  - Colonne: data, ID pratica, tipo documento, importo lordo, stato pagamento, azioni
  - Ricerca: codice pratica o numero fattura
  - Filtri: periodo, tipo (fattura PV / doc broker), stato (pagata/in attesa/scaduta)
- **Export**: stessi formati del broker (PDF/XML singoli, ZIP periodo, CSV riepilogo, anno completo).

### 4.4 Sezione `/admin/fatturazione`

**Path:** `/admin/fatturazione` (riservata `ADMIN_PIATTAFORMA` e `CFO`).

Tre sotto-sezioni in tab:

**Tab 1 — Dashboard KPI:**
- Fatturato mese corrente (somma fatture PV emesse)
- Ricavo netto PV mese (somma €50/€15 → ricavo proprio)
- Somme di terzi in wallet (totale €25 trattenuti non ancora erogati)
- Payout erogati mese
- Penali incassate mese (TBD commercialista — vedi §6.4)
- Fatture non pagate (alert agenzie scadute >15gg)

**Tab 2 — Lista documenti fiscali:**
- Tutti i documenti emessi (Fattura PV / Doc broker / Penale / Note variazione)
- Colonne: data, ID pratica, tipo, agenzia destinataria, broker coinvolto (se applicabile), importo lordo, stato, azioni
- Ricerca full-text: codice pratica, ragione sociale agenzia/broker, importo, numero documento
- Filtri: periodo, tipo documento, stato, agenzia/broker specifico
- Export multipli (selezione/periodo/mese/anno) con PDF, XML, CSV, ZIP

**Tab 3 — Somme di terzi:**
- Lista broker con saldo wallet attuale
- Totale somme di terzi trattenute
- Storico payout per broker
- Alert wallet negativi (riusa logica `sistema-penali-broker.md`)
- Export mensile somme di terzi per commercialista

---

## 5. Iscrizione: dati obbligatori

### 5.1 Wizard registrazione **broker** — campi nuovi/obbligatori

| Campo | Tipo | Validazione | Obbligatorio per |
|---|---|---|---|
| Regime fiscale | `RegimeFiscale` enum | UI: radio selezione | Tutti i broker |
| Codice fiscale | String | Pattern CF italiano (16 char) | Tutti i broker |
| Partita IVA | String | 11 cifre | `ORDINARIO` + `FORFETTARIO` (no `PRIVATO`) |
| Indirizzo completo | String + città + CAP + provincia | Pattern italiano | Tutti i broker |
| IBAN | String | Pattern IT + 25 char | Tutti i broker (per payout) |
| Checkbox **delega fatturazione** | Boolean | Esplicito separato dai T&C generali | Tutti i broker |

`Company.regimeFiscale` valorizzato dal wizard. Per broker `PRIVATO`, P.IVA non chiesta. Tipo documento generato (TD01/TD06/ricevuta) viene scelto automaticamente in base al regime.

### 5.2 Wizard registrazione **agenzia** — campi nuovi/obbligatori

| Campo | Tipo | Validazione | Obbligatorio per |
|---|---|---|---|
| Ragione sociale | String | Già presente | Già presente |
| Partita IVA | String | 11 cifre, già presente | Già presente |
| Codice SDI **OR** PEC | String | Almeno uno valorizzato — UI mostra entrambi i campi con messaggio | **Obbligatorio almeno uno** |
| Indirizzo sede legale | Già presente | — | — |
| Dati pagamento (IBAN per SDD) | String | IT + 25 char | Per addebito automatico |
| **OTP SMS** verifica numero | Codice 6 cifre | Generato server, validità 10 min, max 5 tentativi | Obbligatorio (autorizza addebito) |
| Checkbox **doppia fatturazione** | Boolean | Esplicito | Tutti |

L'OTP è gestito da provider esterno (TBD: Twilio già pianificato — `piano-implementazione.md` 0.4). Persistito su `Company.otpVerifiedAt/otpPhone`.

### 5.3 Clausole T&C dedicate (bozze, da validare con legale)

Vedi §8 "Punti di accordo legale". Riepilogo:

**Broker — 4 clausole:**
1. Delega alla generazione del documento fiscale per suo conto
2. Trattenuta somme di terzi fino a soglia payout
3. Responsabilità trasmissione SDI e adempimenti fiscali
4. Obbligo dati fiscali completi

**Agenzia — 3 clausole:**
1. Doppia fatturazione (consapevolezza ricezione 2 documenti)
2. Autorizzazione addebito automatico €75/€15
3. Pratiche annullate non addebitate / completate non rimborsabili

---

## 6. Generazione documenti

### 6.1 Engine generazione (server-side)

Nuovo modulo `lib/fatturazione/`:
- `lib/fatturazione/generate.ts` — orchestrator: dato un `Pratica.id` FIRMATA, genera 1 o 2 `DocumentoFiscale` in transazione
- `lib/fatturazione/pdf.ts` — generazione PDF con `pdf-lib` (riuso libreria già adottata in A6 `lib/pdf/rendiconto.ts`, **no Chromium/Puppeteer** per coerenza serverless Vercel)
- `lib/fatturazione/xml-fatturapa.ts` — generazione XML FatturaPA conforme XSD ufficiale + validazione schema
- `lib/fatturazione/qr.ts` — QR code di verifica autenticità nel PDF
- `lib/fatturazione/numerazione.ts` — incremento atomico numero progressivo per `(idSoggetto, tipoDocumento, anno)` tramite `INSERT … ON CONFLICT … RETURNING` su `contatori_fiscali`; va chiamato dentro la stessa `$transaction` della create del documento
- `lib/fatturazione/format.ts` — formatta la stringa `numeroDocumentoStr` congelata all'emissione (es. `PV-0047-2026-00003`); UI/PDF/XML la leggono dal campo persistito, non la ricalcolano
- `lib/fatturazione/storage.ts` — upload PDF+XML su `StorageProvider` (riusa Vercel Blob già presente)

### 6.2 Hook trigger

In `completaPratica` (server action firma agenzia, già esistente in `apps/piattaforma/src/lib/pratiche/`):
- Dopo `Pratica.update({ stato: FIRMATA })` e accredito wallet broker
- Post-commit best-effort: enqueue `generateDocumentiFiscaliJob(praticaId)` (sincrono on-firma, retry 3x se fallisce)
- Generazione asincrona accettabile: il modello `DocumentoFiscale` è separato, l'UI in `/pratiche` mostra "Generazione in corso..." se non ancora pronto (raro: deve completare in pochi secondi)

### 6.3 Tipo documento + split importi dinamici

Per ogni `Pratica.FIRMATA` di tipo trapasso netto, l'orchestrator calcola congiuntamente:
- importo Fattura PV
- importo Doc broker
- tipo XML applicabile

```ts
type TrapassoSplit = {
  fatturaPvLordoCent: number;   // 5000 ord / 5500 forf / 5500 priv (TBD)
  docBrokerLordoCent: number;   // 2500 ord / 2000 forf / 2000 priv (TBD)
  docBrokerXml: FatturaPaTipo | null;
  docBrokerIvaPct: number;      // 22 ord / 0 forf / 0 priv
  ritenutaAccontoCent: number;  // 0 ord / 0 forf / TBD priv
};

function splitTrapasso(broker: Company): TrapassoSplit {
  switch (broker.regimeFiscale) {
    case "ORDINARIO":
      return {
        fatturaPvLordoCent: 5000,
        docBrokerLordoCent: 2500,
        docBrokerXml: "TD01",
        docBrokerIvaPct: 22,
        ritenutaAccontoCent: 0,
      };
    case "FORFETTARIO":
      // TBD commercialista: TD06 (parcella) vs TD01 con natura N2.2 (operazioni non soggette).
      return {
        fatturaPvLordoCent: 5500,
        docBrokerLordoCent: 2000,
        docBrokerXml: "TD06",
        docBrokerIvaPct: 0,
        ritenutaAccontoCent: 0,
      };
    case "PRIVATO":
      // TBD commercialista: ricevuta non fiscale, eventuale ritenuta d'acconto 20%.
      return {
        fatturaPvLordoCent: 5500,
        docBrokerLordoCent: 2000,
        docBrokerXml: null, // no XML SDI
        docBrokerIvaPct: 0,
        ritenutaAccontoCent: 0, // TBD: forse 400 (= 20% di 2000 imponibile)
      };
    default:
      throw new Error(`Regime fiscale non valorizzato per broker ${broker.id}`);
  }
}

// Per minivoltura: tutto PV, niente split, niente doc broker
function splitMinivoltura(tipo: "STANDARD" | "MULTIPLA", numVeicoli = 1) {
  const lordoPerVeicolo = tipo === "STANDARD" ? 3000 : 2000;
  return {
    fatturaPvLordoCent: lordoPerVeicolo * numVeicoli,
    fatturaPvXml: "TD01" as FatturaPaTipo, // PV è sempre ordinario
    fatturaPvIvaPct: 22,
  };
}
```

> **Invariante economica:** l'agenzia paga sempre lo stesso totale (€75 trapasso, €30/€20×N minivoltura) indipendentemente dal regime broker. Il regime broker ridistribuisce solo lo split interno tra PV e broker.

### 6.4 Penale broker (chiuso: fuori campo IVA, nessun documento fiscale)

`sistema-penali-broker.md` ha implementato `TransazioneWallet.PENALE_BROKER` come addebito interno di **€25 per ciascun veicolo effettivamente segnalato** (mai sui veicoli sani della stessa pratica; fallback a 1 veicolo per le segnalazioni legacy prive del flag `Veicolo.segnalato`). **Chiuso** (clausola 10.4(b) dei Termini): la penale è **fuori campo IVA** ai sensi dell'art. 15, co. 1, n. 1, D.P.R. 633/1972, costituendo somma dovuta a titolo di penalità — non genera alcun `DocumentoFiscale.PENALE_BROKER` autonomo, resta rettifica contabile interna sulle somme di terzi del broker.

**Comportamento attuale (definitivo):**
- KPI "Penali incassate mese" su `/admin/fatturazione` Tab 1 → calcolato da somma `TransazioneWallet` con tipo `PENALE_BROKER` (no documento fiscale, per costruzione, non per lacuna)
- Nessun `DocumentoFiscale` viene generato per la penale: è fuori campo IVA, quindi non è un documento fiscale — non c'è nulla da chiarire con il commercialista su questo punto

### 6.5 Numerazione progressiva — implementazione effettiva

Il counter risiede nella tabella `contatori_fiscali` (una riga per `idSoggetto` + `tipoDocumento` + `anno`). L'incremento è atomico via un singolo statement SQL, eseguito dentro la stessa `prisma.$transaction` della `create` del documento: se la create fallisce, la transazione fa rollback e il numero non viene consumato (no buchi).

```ts
// lib/fatturazione/numerazione.ts — pattern effettivo (ON CONFLICT, non SELECT FOR UPDATE)
export async function prossimoContatore(
  tx: Prisma.TransactionClient,
  idSoggetto: string,  // 'PV' per documenti propri, Company.id per documenti broker
  tipo: ContatoreFiscaleTipo,
  anno: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ contatore: number }[]>`
    INSERT INTO "contatori_fiscali" ("id", "idSoggetto", "tipoDocumento", "anno", "contatore", "aggiornatoAt")
    VALUES (gen_random_uuid(), ${idSoggetto}, ${tipo}::"ContatoreFiscaleTipo", ${anno}, 1, now())
    ON CONFLICT ("idSoggetto", "tipoDocumento", "anno")
    DO UPDATE SET "contatore" = "contatori_fiscali"."contatore" + 1, "aggiornatoAt" = now()
    RETURNING "contatore"
  `;
  return rows[0].contatore;
}
```

Il reset annuale è implicito: cambiando `anno` nella chiave si crea una nuova riga che parte da 1.

Per **PV emittente** l'`idSoggetto` è la costante letterale `'PV'` (non una Company dedicata): il contatore PV è una riga in `contatori_fiscali` con `idSoggetto = 'PV'`. La stringa numero (`PV-2026-00001`) viene formattata da `lib/fatturazione/format.ts → numeroDocumento(...)` e salvata immutabilmente nel campo `DocumentoFiscale.numeroDocumentoStr` all'emissione.

> Per i dettagli del formato e le decisioni di numerazione vedere `docs/numerazione-fatture-decisioni.md`.

---

## 7. Notifiche

Si aggiungono al sistema `NotificaInviata` esistente.

| Codice | Destinatario | Trigger | Subject (it) | Contenuto |
|---|---|---|---|---|
| `N26_FATTURA_GENERATA_AGENZIA` | Agenzia | Generazione `FATTURA_PV` | "Nuova fattura — pratica {codice}" | PDF in allegato, link a `/fatturazione` |
| `N27_DOC_BROKER_GENERATO` | Broker | Generazione `DOC_BROKER` | "Documento fiscale generato — pratica {codice}" | PDF+XML in allegato, ricorda di trasmettere allo SDI |
| `N28_DOC_BROKER_AGENZIA` | Agenzia | Generazione `DOC_BROKER` | "Documento broker — pratica {codice}" | PDF in allegato (per propria contabilità) |
| `N29_FATTURA_NON_PAGATA` | Admin | Cron 15gg post-emissione, stato IN_ATTESA | "Fattura scaduta — agenzia {nome}" | Lista fatture scadute |
| `N30_DOC_BROKER_NON_TRASMESSO` | Broker | Cron 30gg post-emissione, no `trasmessoSdiAt` | "Documento non trasmesso allo SDI" | Reminder con link ai documenti pendenti |

Aggiunta enum `NotificaTipo` (5 nuovi valori). Template MVP riusa il pattern A6 (header navy + card + footer). Allegati gestiti via `EmailProvider.sendWithAttachments` (estensione provider — Resend già supporta).

---

## 8. Punti di accordo legale (B-LEGAL)

> Da validare con legale prima del lancio. Le clausole nei docx sono **bozze orientative**.

### 8.1 Clausole broker

1. **Testo definitivo clausola delega** + checkbox separato in registrazione (non parte del checkbox T&C generico)
2. **Limiti responsabilità PV** sulla generazione del documento per conto (errori dati anagrafici, formati)
3. **Riferimento normativo** alla delega (art. 21 c. 2 DPR 633/72 + circolari Agenzia Entrate sulla fatturazione per conto)
4. **Modalità revoca delega** + impatti sui documenti già emessi
5. **Privacy:** dati fiscali del broker (CF/P.IVA/IBAN) trattati anche per emissione documento — informativa GDPR estesa

### 8.2 Clausole agenzia

1. **Testo definitivo doppia fatturazione** + consapevolezza che riceverà documenti da soggetti diversi (PV + N broker)
2. **Autorizzazione addebito automatico** SEPA: testo conforme allo standard SDD (mandato firmato) + scadenza 36 mesi + revoca
3. **Conservazione mandato OTP** per audit (log timestamp + numero verificato)
4. **Politica annullamenti / rimborsi** per pratiche FIRMATA con errori imputabili a PV vs broker

### 8.3 Privacy e GDPR

- Dati fiscali broker (CF/P.IVA/IBAN/regime) sono dati personali → informativa privacy estesa
- Retention 10 anni sui documenti fiscali è obbligo di legge → eccezione esplicita rispetto a "diritto all'oblio"
- Email automatiche con PDF in allegato → controllo che destinatario abbia consenso (opt-in implicito da T&C)

---

## 9. Punti aperti per commercialista (B1)

Sono i blocchi residui che impediscono il lancio in produzione. Da risolvere con commercialista identificato:

1. **Split forfettario 55+20 vs ordinario 50+25:** confermare che lo split sia corretto (l'idea è "il forfettario riceve meno perché non scarica IVA"). Eventuale tabella di equivalenza netto-broker tra regimi.
2. **Tipo documento per regime forfettario:** TD06 (parcella) o TD01 con natura N2.2? Confermare per generazione XML.
3. **Trattamento IVA per regime forfettario:** fuori campo IVA (art. 1 c. 54-89 L. 190/2014) — confermare codifica XSD
4. **Broker privato:** split economico definitivo (proposta interim: 55+20 come forfettario), ricevuta non fiscale o documento alternativo, applicabilità ritenuta d'acconto 20% (incidenza su payout netto al broker)
5. ~~**Penale:** come va contabilizzata?~~ **Chiuso** (clausola 10.4(b) dei Termini, vedi §6.4): fuori campo IVA (art. 15, co. 1, n. 1, D.P.R. 633/1972) → nessun documento fiscale, resta evento contabile interno PV (movimento wallet + rettifica sulle somme di terzi del broker).
6. **Somme di terzi nel bilancio PV:** conto patrimoniale dedicato, modalità di registrazione, riconciliazione con wallet
7. **Numerazione progressiva** per broker emittente: deve essere unica per registro broker (non globale PV) — confermare conformità normativa
8. **Validità clausola delega** nei T&C — sufficiente checkbox + log o serve firma digitale?
9. **Note di variazione:** processo per errori (TD04 nota credito / TD05 nota debito) e riferimenti
10. **Adempimenti dichiarativi PV** sui documenti emessi per conto (LIPE / dichiarazione annuale impatti)
11. **Minivoltura multipla:** una fattura unica multi-riga (N×€20) o N fatture separate? Impatto su numerazione e contabilità.
12. **Commissioni affiliazione (cross-ref AF1):** trattamento fiscale delle commissioni in wallet (€10/€5 lordi) — sono ricavo broker o restano in regime "premio" / "rimborso spese"?

---

## 10. Bundle implementativi (proposta di scope)

> Stima rough order da rivedere insieme prima di partire. Tutti bloccati dietro B1 (validazione commercialista) per la parte XML/IVA, ma le fondamenta UI/PDF si possono iniziare.

### Bundle FT-A — Schema + iscrizione (no XML, no SDI)
1. Migrazione `RegimeFiscale` + estensione `Company` (numeratore, OTP, clausola)
2. Migrazione `DocumentoFiscale` + 4 enum
3. Wizard broker: aggiunta step "Dati fiscali" (regime, P.IVA, indirizzo, IBAN, checkbox delega)
4. Wizard agenzia: aggiunta validazione "SDI OR PEC obbligatori" + step OTP SMS
5. Provider OTP (mock dev → Twilio prod swap-ready)
6. Aggiornamento `seed.ts` con regime fiscale per utenti test

**Sblocca:** raccolta dati fiscali, possibilità di generare documenti con dati corretti.

### Bundle FT-B — Generazione PDF + lista lato agenzia/broker
7. `lib/fatturazione/generate.ts` orchestrator + `pdf.ts` (template PDF con logo, dati emittente/destinatario, importi, QR placeholder)
8. `lib/fatturazione/numerazione.ts` con incremento atomico `INSERT … ON CONFLICT` su `contatori_fiscali` (vedi §6.5)
9. Hook in `completaPratica`: generazione 1 o 2 `DocumentoFiscale` post-firma (no XML in questo bundle, solo PDF)
10. Sezione `/fatturazione` agenzia: dashboard + lista + filtri base + download PDF
11. Sezione `/fatturazione` broker: lista doc broker emessi + stato SDI manuale
12. Icone PDF inline in `/pratiche` per agenzia e broker

**Sblocca:** UX completa per agenzia e broker, anche senza XML SDI valido.

### Bundle FT-C — Admin panel + KPI + export
13. Sezione `/admin/fatturazione` con 3 tab (KPI / Lista / Somme di terzi)
14. Endpoint export ZIP/CSV background con notifica al completamento
15. Notifiche `N26/N27/N28` cablate con allegato PDF
16. Cron `N29` (fatture non pagate >15gg) + `N30` (doc non trasmessi >30gg)

**Sblocca:** controllo admin completo + visibilità contabile.

### Bundle FT-D — XML FatturaPA + integrazione SDI broker
17. `lib/fatturazione/xml-fatturapa.ts` con generazione XSD-compliant
18. Validazione XML schema ufficiale Agenzia Entrate
19. QR code verifica autenticità nel PDF
20. Toggle "Segna come trasmesso allo SDI" lato broker (manuale)
21. Eventuale integrazione SDI provider PV per fatture PV verso agenzie (Aruba o equivalente — vedi B "SDI provider" piano)

**Bloccato da:** B1 (decisione TD01/TD06 forfettario), scelta SDI provider, validazione legale clausole.

### Bundle FT-E — Note di variazione + casi speciali
22. Workflow nota di credito / nota di debito (TD04/TD05)
23. Pratica `ANNULLATA` post-emissione → genera automaticamente nota di credito
24. ~~Penale broker → eventuale documento separato~~ **Chiuso** (§6.4): nessun documento fiscale, resta movimento wallet fuori campo IVA

---

## 11. Test e2e di accettazione

- Broker ORDINARIO → trapasso → 2 documenti (Fattura PV TD01 €50 + Doc broker TD01 €25), wallet +€25, agenzia riceve 2 email
- Broker FORFETTARIO → trapasso → Fattura PV TD01 €55 + Doc broker TD06 €20 (IVA 0), wallet +€20
- Broker PRIVATO → trapasso → Fattura PV TD01 €55 + ricevuta non fiscale broker €20 (no XML), wallet +€20 (eventuale ritenuta TBD)
- Minivoltura standard → solo Fattura PV €30, no doc broker, wallet invariato
- Minivoltura multipla 5 veicoli → Fattura PV €100 (5×€20) multi-riga, no doc broker
- Agenzia non paga entro 15gg → N29 admin
- Broker non aggiorna stato SDI entro 30gg → N30 broker
- Pratica ANNULLATA dopo emissione → nota di credito generata + storno wallet
- Numerazione progressiva: 2 broker diversi emettono nello stesso giorno → ognuno parte da 1/anno indipendente
- Export ZIP mese: contiene PDF e XML in struttura `/PDF/AAAAMMGG_IDpratica_tipo.pdf` e `/XML/...`

---

## 12. Riepilogo ruoli/azioni

| Azione | Broker | Agenzia | Admin |
|---|---|---|---|
| Genera documento | ❌ (PV genera per suo conto) | ❌ | ❌ (automatico al firma) |
| Scarica PDF documento | ✅ (suoi doc + tutti i doc delle sue pratiche) | ✅ (entrambi i doc per ogni sua pratica) | ✅ (tutti) |
| Scarica XML | ✅ (suo doc broker, per trasmissione SDI) | ✅ (per propria contabilità) | ✅ |
| Segna come trasmesso SDI | ✅ (sui propri doc broker) | ❌ | ❌ (visibilità) |
| Vedere wallet/somme di terzi | Solo proprio | — | Tutti |
| Esportare CSV/ZIP per periodo | ✅ propri | ✅ propri | ✅ globale |
| KPI fatturato globale | ❌ | ❌ | ✅ |
| Configurare regime fiscale | ✅ (proprio in iscrizione) | — | ✅ (override per company singola) |

---

## 13. Riferimenti incrociati

- `analisi-progetto.md` §3.1 — tabella importi per tipo pratica (autoritativa)
- `analisi-progetto.md` §3.3 — **da aggiornare**: rimuovere riferimento a "broker emette fattura su rendiconto", puntare qui
- `piano-implementazione.md` FASE 5.2/5.3 — **da aggiornare**: sostituire "rendiconto → fattura broker" con riferimento a questa spec; bundle FT-A/B/C/D/E aggiunti come scope nuovo
- `sistema-penali-broker.md` §3 — coordinato con questa spec sul tema penale (vedi §6.4)
- `sistema-affiliazione.md` §13.5 — payout affiliazione segue stessa logica, ma rendiconto separato (già implementato AF-PDF in A6)
- `crm-spec-implementativa.md` — invariato, CRM non tocca documenti fiscali
- `bugfix-feature-list.md` item 12 — payout threshold per company già implementato, coerente
