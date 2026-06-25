# Tessera sanitaria / Codice fiscale obbligatoria quando l'identificazione non è CIE

**Data:** 2026-06-25
**Branch:** feat/multi-sede (o branch dedicato)
**Stato:** Design approvato — pronto per il piano d'implementazione

## Obiettivo

In fase di creazione pratica, sia per il **venditore** sia per l'**acquirente**, se il
soggetto **non** è identificato con Carta d'Identità Elettronica (CIE) ma con una delle
altre opzioni (CI cartacea, passaporto, patente), il sistema deve richiedere
**obbligatoriamente** la tessera sanitaria / codice fiscale. È sufficiente il **fronte**
(file singolo).

## Decisioni di scope (confermate)

1. **Ambito soggetti:** l'obbligo vale per **tutti** — privato italiano, straniero
   extra-UE e **legale rappresentante** di azienda/operatore auto — ogni volta che
   l'identificazione non è una CIE.
2. **Livello di verifica:** **presenza + match OCR del codice fiscale**, fail-closed,
   coerente col resto della verifica documentale (`lib/kyc/parte-docs`).

## Contesto / stato attuale

La lista documenti è prodotta dall'engine deterministico `lib/documenti/engine.ts`
(Schema Documentale v7). Oggi `emettiIdentita` emette `CODICE_FISCALE` **solo** per
`PRIVATO_ITALIANO_CARTACEA` + CI.

**Gap latente attuale:** quel requisito è di fatto *orfano*. `CODICE_FISCALE` è incluso
in `TIPI_RACCOLTI_NELLA_PARTE` (`lib/documenti/richiesti.ts`), quindi è escluso dagli
slot dello step "Documenti"; ma lo step parte (`IdentitaSection` in `wizard.tsx` e
`collectIdentita` in `actions.ts`) **non ha alcuna card/slot per la tessera sanitaria**.
Risultato: anche oggi, per una CI cartacea, la tessera sanitaria non viene mai
effettivamente richiesta. Questa implementazione chiude anche questo gap.

L'enum Prisma `DocumentoTipo` contiene già `CODICE_FISCALE` → **nessuna migration**.
Esiste già `lib/kyc/extract-cf.ts` (`extractCf(text)` con regex CF).

## Regola (single source of truth)

Nuovo helper puro esportato da `engine.ts`:

```ts
export function richiedeCodiceFiscale(
  tipoSoggetto: TipoSoggetto,
  docId: 'CI' | 'PASSAPORTO' | 'PATENTE',
): boolean {
  // CF richiesto SEMPRE tranne quando il documento è una CI e il soggetto è CIE.
  return !(docId === 'CI' && tipoSoggetto === 'PRIVATO_ITALIANO_CIE');
}
```

Conseguenze (valide identiche per venditore e acquirente):

| Caso | CF richiesto |
|---|---|
| CIE (`PRIVATO_ITALIANO_CIE` + CI) | No |
| CI cartacea (`PRIVATO_ITALIANO_CARTACEA` + CI) | Sì *(oggi orfano → reso reale)* |
| Passaporto (qualsiasi tipo soggetto) | Sì |
| Patente (qualsiasi tipo soggetto) | Sì |
| Straniero extra-UE + CI / passaporto / patente | Sì |
| Legale rappr. azienda/operatore con passaporto/patente | Sì |
| Legale rappr. azienda/operatore con CI | No (vedi boundary) |

### Boundary documentato — legale rappresentante con CI

`aggiungiDocumentiPersona` chiama `emettiIdentita` con `tipoSoggetto` **hardcoded a
`PRIVATO_ITALIANO_CIE`** per l'amministratore di una PG. Quindi un rappresentante che
presenta una **CI** è trattato come CIE → niente CF. Un rappresentante con
**passaporto/patente** → CF sì (il ramo passaporto/patente di `richiedeCodiceFiscale`
non dipende dal tipo soggetto).

Questo è coerente col comportamento attuale (non raccogliamo la distinzione
CIE/cartacea per i rappresentanti) e copre l'intento dominante (passaporto/patente).
Estenderlo alla CI cartacea del rappresentante richiederebbe un toggle CIE/cartacea per
i rappresentanti → **fuori scope**.

## Componenti e modifiche

### 1. `lib/documenti/engine.ts`

- Esporta `richiedeCodiceFiscale(tipoSoggetto, docId)`.
- `emettiIdentita`: emette `CODICE_FISCALE` quando `richiedeCodiceFiscale` è vero, in
  **tutti** i rami (passaporto, patente e CI con tipo ≠ CIE). Sostituisce l'attuale
  `if (tipoSoggetto === 'PRIVATO_ITALIANO_CARTACEA')`.
- La parte VEICOLO/procura/successione/tutore resta invariata.

### 2. `lib/kyc/parte-docs.ts`

- `ParteDati`: aggiungere `documentoIdentita?: 'CI' | 'PASSAPORTO' | 'PATENTE'`.
- `DocRequisiti`: aggiungere `codiceFiscale: boolean`.
- `OcrParte`: aggiungere `codiceFiscale?: { codiceFiscale?: string }`.
- `documentiRichiestiParte(p)`: calcola `codiceFiscale` usando la regola condivisa.
  Per la PG il documento d'identità è del rappresentante: si applica la mappatura
  rep→CIE per la CI (quindi CF solo se passaporto/patente del rappresentante).
  Implementazione: `tipoEffettivo = isPG(p) ? 'PRIVATO_ITALIANO_CIE' : (p.tipoSoggetto ?? 'PRIVATO_ITALIANO_CIE')`,
  poi `richiedeCodiceFiscale(tipoEffettivo, p.documentoIdentita ?? 'CI')`.
- Nuova `verificaCodiceFiscale(expectedCf: string | undefined, e: { codiceFiscale?: string } | undefined): Verdetto`:
  - `!e?.codiceFiscale` → `ILLEGGIBILE`
  - `!expectedCf` → `MATCH` (presenza + leggibilità sufficienti, nessun CF atteso)
  - altrimenti `normalizeCf(expectedCf) === normalizeCf(e.codiceFiscale)` ? `MATCH` : `MISMATCH`
- `validaParte`:
  - Ramo persona fisica (`else`): se `req.codiceFiscale` →
    `push('Tessera sanitaria / Codice fiscale', verificaCodiceFiscale(p.cf, ocr.codiceFiscale))`.
  - Ramo PG (`if (req.visura)`): dopo i check identità del rappresentante, se
    `req.codiceFiscale` →
    `verificaCodiceFiscale(ocr.visura?.amministratore?.codiceFiscale, ocr.codiceFiscale)`
    (match col CF dell'amministratore se estraibile, altrimenti presenza+leggibilità).
- Messaggio in `messaggio()`: etichetta `Tessera sanitaria / Codice fiscale`.

### 3. `lib/documenti/richiesti.ts`

- Nessuna modifica funzionale: `CODICE_FISCALE` resta in `TIPI_RACCOLTI_NELLA_PARTE`
  (raccolto nello step parte, non nello step Documenti). `TIPO_LABEL` già mappa
  `CODICE_FISCALE: 'Codice fiscale / Tessera sanitaria'`.

### 4. `app/pratiche/nuova/wizard.tsx`

- `IdentitaFiles`: aggiungere `codiceFiscale?: BlobSlot`.
- `Parte` type: aggiungere `codiceFiscaleOcr?: { codiceFiscale?: string }`.
- `IdentitaSection`:
  - Calcolare `mostraCodiceFiscale` con la regola condivisa (in base a `docId`,
    `tipoSoggetto`, `isPG` — mappatura rep→CIE per la CI quando PG).
  - Nuove prop `onCfRef` / `onInvalidateCf`.
  - Renderizzare una `UploadCard` "Tessera sanitaria / Codice fiscale (fronte)"
    quando `mostraCodiceFiscale`, con `handleField('codiceFiscale', f, onCfRef, onInvalidateCf)`.
- Nuovo `runCfOcr(ref, onChange)` che chiama `extractCodiceFiscaleAction(ref)` e
  salva `codiceFiscaleOcr`. Cablato nei call site venditore e acquirente, con
  `onInvalidateCf` che azzera `codiceFiscaleOcr`.
- `verificaDocumentaleParte`: passare `documentoIdentita: docId` in `ParteDati` e
  `codiceFiscale: p.codiceFiscaleOcr` in `OcrParte`. La firma deve ricevere il `docId`
  (oggi non lo riceve: aggiungere il parametro e aggiornare i call site).
- `parteCompleta` / `mancanzeParte`: passare `documentoIdentita` a
  `documentiRichiestiParte` e, se `req.codiceFiscale`, richiedere
  `identita.codiceFiscale?.ref` (mancanza → "tessera sanitaria / codice fiscale").
- `identitaUploading`: includere lo slot `codiceFiscale`.
- `identitaForStorage`: includere lo slot `codiceFiscale` nella bozza persistita.
- `handleFinalSubmit`: mappare lo slot CF su `VEND<n>_CF` (venditori) e `ACQ_CF`
  (acquirente) in `blobRefs`.

### 5. `app/pratiche/nuova/actions.ts`

- Nuova Server Action `extractCodiceFiscaleAction(ref)` (mirror di
  `extractPermessoAction`): OCR del testo → `extractCf(text)` → `{ ok, data: { codiceFiscale } }`.
- `IdentitaDocCandidate.tipo`: aggiungere `'CODICE_FISCALE'`.
- `collectIdentita`: ricevere/derivare il flag `richiedeCf` (via helper condiviso) e:
  - se `richiedeCf` e lo slot `${prefix}_CF` è assente/vuoto → redirect
    "Tessera sanitaria / codice fiscale mancante per {parte}".
  - se presente → validare MIME/size e push candidato `CODICE_FISCALE`.
- `ocrParteServer`: se esiste `getRef(`${prefix}_CF`)` → OCR + `extractCf` →
  `out.codiceFiscale = { codiceFiscale }`.
- `partiDaVerificare`: includere `documentoIdentita` in `ParteDati` (già disponibile
  come `v.docId` / `d.acquirenteDocumentoIdentita`).
- Persistenza: il candidato `CODICE_FISCALE` confluisce in `identitaUploads` e crea una
  riga `Documento` con `tipo: 'CODICE_FISCALE'`, `owner`, `venditoreId` (come gli altri
  documenti identità). `ocrStato: 'NONE'`, `gatingStato: 'PASSED'`.

## Flusso dati

1. Broker sceglie il tipo documento nello step parte.
2. Se `richiedeCodiceFiscale` è vero, appare la card "Tessera sanitaria / Codice fiscale (fronte)".
3. Upload diretto su Vercel Blob (client upload) → `BlobRef`.
4. Al completamento, OCR client (`extractCodiceFiscaleAction` → `extractCf`) popola
   `codiceFiscaleOcr` → feedback live `validaParte`.
5. Al submit lo slot `_CF` viaggia in `blobRefs`; il server ri-esegue OCR
   (autoritativo) + `validaParte` fail-closed e crea la riga `Documento`.

## Error handling

- CF richiesto ma file assente → redirect "Tessera sanitaria / codice fiscale mancante per {parte}".
- OCR illeggibile (`ILLEGGIBILE`) o CF non corrispondente (`MISMATCH`) → blocco con
  messaggio "Tessera sanitaria / Codice fiscale: …" (dalla `validaParte`).
- MIME/size validati come gli altri documenti identità (`validateIdentitaRef`).

## Testing

### `lib/documenti/engine.test.ts`
- CIE + CI → **non** include `CODICE_FISCALE`.
- CI cartacea + CI → include `CODICE_FISCALE`.
- Passaporto → include `CODICE_FISCALE` (oltre a `PASSAPORTO`).
- Patente → include `CODICE_FISCALE` (oltre a `PATENTE`).
- Straniero extra-UE + CI → include `CODICE_FISCALE` (+ `PERMESSO_SOGGIORNO`).
- PG (AZIENDA) rep + CI → **non** include `CODICE_FISCALE`.
- PG (OPERATORE_AUTO) rep + passaporto → include `CODICE_FISCALE`.
- Verificare per entrambi i lati: venditore e acquirente.

### `lib/kyc/parte-docs.test.ts`
- `documentiRichiestiParte`: flag `codiceFiscale` corretto per i casi sopra
  (inclusa la mappatura rep→CIE per la PG).
- `verificaCodiceFiscale`: `MATCH` / `MISMATCH` / `ILLEGGIBILE` (incluso il caso
  `expectedCf` assente → `MATCH` su presenza+leggibilità).
- `validaParte` fail-closed: blocco quando CF richiesto ma assente/illeggibile o in
  mismatch col CF inserito (persona fisica) o col CF dell'amministratore (PG).

## Non-goals (YAGNI)

- Toggle CIE/cartacea per il legale rappresentante (vedi boundary).
- Raccolta del retro della tessera sanitaria / TEAM (basta il fronte).
- Modifiche allo step "Documenti" o all'engine per parti diverse da venditore/acquirente.
- Migration DB (l'enum `CODICE_FISCALE` esiste già).
