# Fatturazione completa — Design / spec implementativa

Data: 2026-06-14
Autore: Francesco Sioli (CTO) + Claude
Stato: approvato (scope completo, a fasi)

## Obiettivo

Sezione **"Fatture"** per **broker**, **agenzia** e **pannello admin**. In ogni
sezione: tutte le fatture/documenti emessi (**positivi e negativi**), ciascuno con
**riferimento al numero pratica** (link diretto al dettaglio pratica). Viceversa,
la **pratica** mostra il riferimento al/i documento/i fiscale/i. Tutto deve essere
**ricostruibile, ricercabile e coerente col flusso** reale.

Scope deciso: **sistema completo** (incl. PDF, XML FatturaPA, SDI), implementato
**a fasi** (bundle FT-A…FT-E). Le "negative" (note di credito TD04) sono **incluse**.

## Fonte di verità del design

`docs/sistema-fatturazione.md` è il brief di design canonico (più aggiornato del
docx `PassaggioVeloce FatturazioneCompleta.docx`, apr-2025, che ha numeri datati:
penale €100, mini €30/€20). **Questa spec** rende il design attuabile e lo
riconcilia col codice attuale; in caso di conflitto vale questa spec.

## Stato attuale (verificato)

- **Niente implementato**: nessun modello `DocumentoFiscale`, nessun codice/route
  fatturazione. Tutto da costruire.
- `Company`: ha già `partitaIva` (unique), `codiceSdi?`, `pec`, indirizzo/cap/
  citta/provincia. **Manca `regimeFiscale`** (broker) → da aggiungere.
- `Pratica`: ha gli importi reali `feeAgenziaCent`, `creditoBrokerCent`, `tipo`,
  `numeroVeicoli`, `codicePratica`. **Manca** il back-ref ai documenti fiscali.
- `Payout`: ha `transazioni TransazioneWallet[]`; ogni `TransazioneWallet` ha
  `praticaId` e `payoutId` → un payout conosce le pratiche che lo compongono.
- Penale broker = **€25** (`PENALI.PENALE_BROKER_DEFAULT_CENT`). Addebito agenzia
  **istantaneo** alla firma. 4 tipi pratica SEMPLICE/MINIVOLTURA × singolo/multiplo.

## Decisioni chiave (riconciliazioni)

1. **Importi derivati dal flusso reale**, non da tabelle statiche: la fattura
   PV→agenzia usa `Pratica.feeAgenziaCent`; il documento broker usa l'importo del
   payout (quota CREDITO_PRATICA); la penale usa la costante €25. Così i documenti
   combaciano sempre con ciò che è stato realmente addebitato/accreditato.
2. **Fattura PV→agenzia: per-pratica, generata alla firma** (TD01, IVA 22%).
3. **Documento broker (conto terzi): AGGREGATO AL PAYOUT** (un documento per
   payout, elenca le N pratiche del periodo). Tipo TD01 (ordinario) / TD06
   (forfettario) / ricevuta non fiscale (privato). Legato a `Payout`; le pratiche
   sono `Payout.transazioni` con `tipo = CREDITO_PRATICA`.
4. **Note di credito (TD04, importo negativo)**: emesse quando una pratica già
   fatturata viene annullata/stornata; collegate al documento originale e alla
   pratica.
5. **`Company.regimeFiscale`** nuovo (ORDINARIO/FORFETTARIO/PRIVATO, default
   ORDINARIO), raccolto in registrazione broker + modificabile in profilo.

## Architettura dati

### `Company` (estensione)
- `regimeFiscale RegimeFiscale @default(ORDINARIO)` (+ enum `RegimeFiscale { ORDINARIO FORFETTARIO PRIVATO }`).
- `numeratoreFiscaleAnno Int?`, `numeratoreFiscaleNum Int?` — registro progressivo
  per i documenti emessi PER CONTO di questo broker (separato da PV e dagli altri).
- Relazioni inverse `documentiEmessi` / `documentiRicevuti`.

### `DocumentoFiscale` (nuovo) — basato su `sistema-fatturazione.md §3.3`, adattato
Campi principali:
- `tipo DocumentoFiscaleTipo` = `FATTURA_PV | DOC_BROKER | PENALE_BROKER | NOTA_VARIAZIONE`.
- `fatturaPaTipo FatturaPaTipo?` = `TD01 | TD06 | TD04 | TD05`.
- **Riferimenti (adattati per l'aggregazione al payout):**
  - `praticaId String?` → impostato per `FATTURA_PV` (e `PENALE_BROKER`); **null**
    per `DOC_BROKER` aggregato.
  - `payoutId String?` → impostato per `DOC_BROKER` (link al payout, da cui le
    pratiche). null per `FATTURA_PV`.
  - `notaVariazionePerId String?` → per `NOTA_VARIAZIONE`, punta al documento
    originale (eredita pratica/payout dall'originale).
- `emittenteCompanyId String?` (PV per FATTURA_PV; broker per DOC_BROKER) ·
  `destinatarioCompanyId String` (agenzia per FATTURA_PV; il broker stesso /
  destinatario per DOC_BROKER, da confermare con commercialista).
- `numeroProgressivo Int`, `anno Int` (registro per emittente/anno).
- `importoLordoCent Int` (può essere **negativo** per TD04), `imponibileCent Int?`,
  `ivaCent Int?`, `aliquotaIvaPct Int?`, `ritenutaAccontoCent Int?`.
- `statoPagamento DocumentoFiscaleStatoPagamento @default(IN_ATTESA)` (FATTURA_PV).
- `trasmessoSdiAt DateTime?`, `trasmessoSdiBy String?` (DOC_BROKER).
- `pdfStorageKey String?`, `xmlStorageKey String?`, `pdfHash String?` (PDF/XML
  nelle fasi FT-B/FT-D; in FT-A possono essere null).
- `feeAddebitoId String?`, `transazioneWalletId String? @unique` (audit/link flusso).
- `emessoAt DateTime @default(now())`, `inviatoEmailAt DateTime?`.
- Dati emittente/destinatario **congelati** alla generazione (snapshot: ragione
  sociale, P.IVA, indirizzo, SDI/PEC) → JSON `datiEmittente`/`datiDestinatario`,
  così i documenti restano immutabili anche se i dati azienda cambiano.
- `@@unique([emittenteCompanyId, anno, numeroProgressivo, tipo])` + indici su
  `praticaId`, `payoutId`, `destinatarioCompanyId+statoPagamento`, `emessoAt`.

### Back-references
- `Pratica.documentiFiscali DocumentoFiscale[]` (le FATTURA_PV + note credito
  della pratica). Il doc broker si raggiunge via `pratica → TransazioneWallet
  (CREDITO_PRATICA) → payout → documentoFiscale`.
- `Payout.documentoFiscale DocumentoFiscale?` (1:1, il DOC_BROKER).

## Generazione (engine server-side, `lib/fatturazione/`)

- **Numerazione progressiva** concorrenza-safe: dentro `prisma.$transaction`,
  incremento del contatore del registro (PV o broker) per anno fiscale + unique
  constraint come rete di sicurezza (pseudocodice in `sistema-fatturazione.md §6.5`).
- **Split importi per regime** (funzione **pura, testabile**): da `importoLordoCent`
  → `{ imponibile, iva, aliquota }`. ORDINARIO: scorporo IVA 22%. FORFETTARIO:
  fuori campo IVA (iva=0, TD06). PRIVATO: ricevuta non fiscale (eventuale ritenuta
  20% — **B1 commercialista**).
- **Hook trigger:**
  - **Firma pratica** (`markFirmaAvvenutaAction`): genera `FATTURA_PV` verso
    l'agenzia (`feeAgenziaCent`, TD01). Best-effort post-commit (non blocca la firma).
  - **Esecuzione payout** (job/azione payout): genera `DOC_BROKER` aggregato per il
    payout (quota CREDITO_PRATICA), tipo per regime, con elenco pratiche.
  - **Annullo/storno** pratica già fatturata: genera `NOTA_VARIAZIONE` (TD04,
    negativa) sulla relativa FATTURA_PV e marca l'originale `STORNATA`.
- **Penale**: documento `PENALE_BROKER` — formato/sede da chiarire (B1); in v1
  registrata come documento collegato alla pratica.
- **Punto aperto (B1 commercialista)**: le commissioni **affiliazione** nel payout
  rientrano nel documento broker "intermediazione" o vanno trattate a parte? La
  spec assume il doc broker = **quota pratiche** del payout; affiliazione separata.

## UI — sezioni "Fatture" + cross-reference (cuore dell'obiettivo)

Voce di navigazione **"Fatture"** (`/fatturazione`) per broker, agenzia e admin
(`/admin/fatturazione`).

- **Agenzia** `/fatturazione`: lista **FATTURA_PV ricevute** (per pratica) + note di
  credito. Per riga: data, **n° documento**, **codice pratica → link `/pratiche/[id]`**,
  tipo, imponibile/IVA/lordo, stato pagamento. Filtri periodo + **ricerca per codice
  pratica o n° documento**. Download PDF (FT-B), XML (FT-D), ZIP/CSV (FT-C).
- **Broker** `/fatturazione`: lista **DOC_BROKER** (per payout) — data, n° documento,
  periodo, **elenco pratiche (ognuna → link dettaglio)**, importo, **stato SDI** +
  "segna trasmesso" (FT-D). Riepilogo wallet/payout. Filtri + ricerca.
- **Admin** `/admin/fatturazione`: tutti i documenti, **separazione dei 3 flussi**
  (ricavi PV / somme di terzi broker / penali), KPI, ricerca globale, export CSV
  (FT-C).
- **Dettaglio pratica** (`/pratiche/[id]`): blocco "Documenti fiscali" con la/le
  FATTURA_PV + eventuali note credito (link), e il riferimento al **doc broker del
  payout** che ha incluso il compenso della pratica (link). → soddisfa "la pratica
  ha riferimento alla fattura".

Ricerca/filtri: per codice pratica, n° documento, periodo, tipo, stato. Tutto
indicizzato (vedi indici modello).

## Fasi di implementazione (bundle)

- **FT-A — Schema + engine + numerazione + record.** `Company.regimeFiscale`,
  `DocumentoFiscale` + enum + relazioni + back-ref, split importi (puro, testato),
  numerazione (testata), hook firma/payout/annullo (genera record, **senza** PDF/XML).
- **FT-B — Sezioni "Fatture" (broker/agenzia/admin) + cross-ref + ricerca + PDF.**
  Le 3 liste, la voce nav, i link bidirezionali pratica↔documento, ricerca/filtri,
  generazione PDF su storage. *(Completa l'obiettivo utente.)*
- **FT-C — Admin KPI + separazione 3 flussi + export CSV/ZIP.**
- **FT-D — XML FatturaPA (TD01/TD06/TD04) + export SDI PV + "segna trasmesso" broker.**
- **FT-E — Casi speciali: privato/ritenuta, premium futuro, note di variazione avanzate.**

Ogni fase è rilasciabile a sé. Il piano (writing-plans) partirà da **FT-A**.

## Testing
- Unit: split importi per regime; numerazione progressiva (concorrenza/anno);
  selezione tipo documento per regime; generazione nota credito su storno.
- e2e accettazione: firma → FATTURA_PV agenzia; payout → DOC_BROKER con pratiche;
  annullo pratica fatturata → TD04; le 3 sezioni mostrano i documenti con cross-ref;
  ricerca per codice pratica/n° documento; dal dettaglio pratica si raggiunge il
  documento e viceversa.
- typecheck/build verdi a ogni fase.

## Punti aperti (da chiudere)
- **B1 commercialista**: regime privato (ritenuta d'acconto?), affiliazione nel doc
  broker, formato penale, dicitura forfettario.
- **B-LEGAL**: clausole delega broker + privacy (snapshot dati fiscali).
- Destinatario del DOC_BROKER nell'XML (agenzia vs broker) da confermare col
  modello "conto terzi".

## Fuori scope (per ora)
- Pagamenti/SDI automatici end-to-end (la trasmissione resta manuale: PV esporta,
  broker trasmette). Premium/abbonamenti.
