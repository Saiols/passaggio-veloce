# Pratica (A): documento d'identità per parte + cross-check venditore↔libretto + riordino step + permesso — Design

**Data:** 2026-06-06
**Stato:** approvato (design)
**Branch:** feat/tipi-pratica-multiveicolo (continua)
**Tappa A di 2** (B = co-intestatari multi-venditore, spec successiva)

## Goal
Riordinare il wizard pratica (venditore → acquirente), far caricare a ciascuna parte un documento d'identità (CI/passaporto/patente) con OCR che pre-compila il form, estrarre il proprietario dal libretto e **bloccare** se il venditore non corrisponde, e gestire il permesso di soggiorno (opzionale, obbligatorio per stranieri).

## Decisioni acquisite
1. Cross-check identità↔libretto **solo sul venditore** (l'acquirente: OCR solo per pre-compilare).
2. Permesso: **obbligatorio per STRANIERO_EXTRA_UE** (engine attuale), opzionale per gli altri.
3. Identità nel **passo della parte** (CI/passaporto/patente alternativi); engine aggiornato; le card Documenti **escludono** i documenti d'identità personali.
4. Azienda: identità = quella dell'**amministratore** (nel passo parte); **visura** resta una card; cross-check azienda confronta la **ragione sociale** col proprietario libretto.
5. Co-intestatari (N venditori) = **tappa B**, qui venditore singolo.

## 1. Riordino step
`1` Tipo & veicoli → `2` Venditore → `3` Acquirente → `4` Documenti → `5` Invio. Si separa l'attuale step Parti in due step (venditore, acquirente) riusando `ParteForm`. Rinumerare `STEPS`, i blocchi `step === N`, i `setStep`, e i gate `canStepN`.

## 2. Documento d'identità per parte (nuovo, nel passo parte)
Sezione "Documento d'identità" in ciascuno step parte:
- Selettore tipo: **Carta d'identità** (upload fronte + retro), **Passaporto** (upload singolo), **Patente** (upload singolo).
- All'upload → OCR (`getOcr().extractText`) → `extractIdentita(text, tipo)` → `{ nome?, cognome?, codiceFiscale? }` → **pre-compila** i campi del form parte (nome/cognome/CF, editabili).
- **Permesso di soggiorno**: campo upload opzionale (sempre disponibile). Per STRANIERO_EXTRA_UE resta obbligatorio (engine BLOCCO se mancante/scaduto, già esistente).
- Stato per parte: `identita: { tipo: 'CI'|'PASSAPORTO'|'PATENTE'; fileFronte?: File; fileRetro?: File; file?: File; ocr?: ... }` + `permesso?: File`.

## 3. Estrazione proprietario dal libretto
Estendere `lib/providers/ocr/libretto-parser.ts`: estrarre `proprietarioAttuale` (nominativo intestatario, singolo per A) dal testo OCR. Calibrazione su libretti reali (campi C / "INTESTATO A" / cognome+nome). Best-effort: se non estraibile resta `undefined` (vedi gestione cross-check sotto).

## 4. Modulo estrazione identità
Create `lib/kyc/extract-identita.ts`: `extractIdentita(text: string, tipo: 'CI'|'PASSAPORTO'|'PATENTE'): { nome?: string; cognome?: string; codiceFiscale?: string }`:
- CI → riusa `extractCi` (nome/cognome) + `extractCf` (CF).
- PASSAPORTO → parsing MRZ (righe `P<...`): cognome/nome; CF non presente.
- PATENTE → parsing campi 1 (cognome) / 2 (nome); CF in campo 4b/5 se presente.
Baseline regex + calibrazione su documenti reali. Riusa `lib/kyc/match` per la normalizzazione.

## 5. Cross-check venditore↔libretto
Funzione pura `lib/kyc/match` (riuso `nameMatches`, `normalizeCompanyName`). Nel passo venditore (e in `registerAction`... no, qui `submitNuovaPraticaAction`):
- Identificativo venditore = se persona fisica `"${nome} ${cognome}"`; se azienda la `ragioneSociale`.
- Confronto con `libretto.proprietarioAttuale` (del veicolo; per A un solo veicolo rilevante per il cross-check — se multi-veicolo, confronta col proprietario del **primo** veicolo, gli altri non bloccano in A).
- Se entrambi presenti e **non** combaciano (`nameMatches` / company match) → **blocco**: messaggio "Il venditore non corrisponde all'intestatario del libretto" + impossibile procedere (UI: blocco step venditore; server: errore nell'action).
- Se il proprietario del libretto non è estraibile (`undefined`) → niente blocco (best-effort), ma logghiamo; non si inventa un mismatch.

## 6. Engine (documenti identità alternativi)
- `packages/db/prisma/schema.prisma`: aggiungere a `enum DocumentoTipo` i valori **PASSAPORTO**, **PATENTE**. Migration `ALTER TYPE "DocumentoTipo" ADD VALUE`.
- `lib/documenti/engine.ts`: aggiungere a `DocumentoTipoEngine` 'PASSAPORTO'|'PATENTE'. Estendere l'input persona con `documentoIdentita: 'CI'|'PASSAPORTO'|'PATENTE'` (per venditore e acquirente). `aggiungiDocumentiPersona`:
  - PRIVATO con CI (CIE) → CI_FRONTE + CI_RETRO; CI cartacea → + CODICE_FISCALE.
  - PRIVATO con PASSAPORTO → PASSAPORTO. Con PATENTE → PATENTE.
  - STRANIERO_EXTRA_UE → (identità scelta) + PERMESSO_SOGGIORNO (+ blocco se scaduto, come oggi).
  - AZIENDA/OPERATORE_AUTO → VISURA_CAMERALE + (identità amministratore scelta: CI_FRONTE+CI_RETRO oppure PASSAPORTO oppure PATENTE, parte AMMINISTRATORE_*).
- `lib/documenti/richiesti.ts`: `requiredUploadDocs` esclude, oltre a LIBRETTO_CIRCOLAZIONE, anche i **tipi identità personali**: CI_FRONTE, CI_RETRO, CODICE_FISCALE, PASSAPORTO, PATENTE, PERMESSO_SOGGIORNO (catturati nel passo parte). Aggiornare i test. Le card Documenti restano: VISURA_CAMERALE, CERTIFICATO_PROPRIETA, PROCURA, CERTIFICATO_MORTE, ATTO_ACCETTAZIONE_EREDITA, DICHIARAZIONE_QUALITA_EREDE, AUTORIZZAZIONE_TUTORE.

## 7. Wizard
- Step Venditore / Acquirente: `ParteForm` + sezione identità (selettore tipo + upload + OCR pre-fill) + permesso opzionale. Il selettore `documentoIdentita` guida i campi.
- Pre-compilazione: l'OCR identità popola nome/cognome/CF della parte (editabili).
- Blocco venditore: se cross-check fallisce, Alert error + Avanti disabilitato.
- Submit: i file identità + permesso vanno come slot dedicati (es. `VEND_ID_FRONTE`, `VEND_ID_RETRO`/`VEND_ID`, `VEND_PERMESSO`, e analoghi `ACQ_*`), oltre allo state esistente; più `venditoreDocumentoIdentita`/`acquirenteDocumentoIdentita` per il tipo.

## 8. Action (`pratiche/nuova/actions.ts`)
- Riceve i tipi identità + i file identità/permesso per parte. Ricalcola l'engine con `documentoIdentita` per parte. Valida la presenza dei documenti identità richiesti dall'engine per ciascuna parte (e permesso per stranieri). Riapplica il **cross-check venditore↔libretto** server-side (blocco). Persiste i `Documento` (tipo CI_FRONTE/CI_RETRO/PASSAPORTO/PATENTE/CODICE_FISCALE/PERMESSO_SOGGIORNO, owner VENDITORE/ACQUIRENTE). → ZIP automatico.
- I documenti non-identità (visura/CdP/procura/…) continuano dallo step card (`DOC__<docKey>`), come già implementato.

## Edge / vincoli
- Multi-veicolo (A): cross-check venditore col proprietario del **primo** veicolo (estensione multi-owner = tappa B).
- Passaporto/patente: CF non sempre estraibile → il campo CF resta editabile; per CI cartacea il CF è richiesto (CODICE_FISCALE).
- Calibrazione OCR (libretto owner, passaporto MRZ, patente) su documenti reali: baseline + rifinitura post-test, come per la visura.

## Testing
- `extract-identita` (unit, fixture per CI/passaporto/patente).
- `libretto-parser` owner extraction (unit fixture).
- cross-check (riuso match, unit sulla funzione di confronto venditore↔proprietario).
- `richiesti` aggiornato (esclusione tipi identità) — unit.
- engine: documenti per tipo identità (unit).
- E2E post-deploy: venditore mismatch → blocco; passaporto upload → pre-fill; permesso opzionale.

## Migration
`ALTER TYPE "DocumentoTipo" ADD VALUE 'PASSAPORTO'; ALTER TYPE "DocumentoTipo" ADD VALUE 'PATENTE';` (additive; applicare a prod col deploy in blocco).

## Fuori scope (→ tappa B)
- Co-intestatari / N venditori (modello multi-venditore, multi-owner libretto, N form, cross-check per ciascuno).

## Sequenza
enum+migration PASSAPORTO/PATENTE → extract-identita → libretto owner → richiesti (esclusione identità) → engine (documentoIdentita) → wizard (riordino + identità per parte + cross-check) → action (persistenza + cross-check server) → test.
