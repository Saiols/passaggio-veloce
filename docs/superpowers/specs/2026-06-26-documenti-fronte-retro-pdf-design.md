# Gestione documenti: fronte/retro obbligatorio + PDF ritagliabile — Design

Data: 2026-06-26
Branch di lavoro previsto: continua su `feat/multi-sede` (o branch dedicato in fase di implementazione)

## Problema

Le persone caricano i documenti in forme diverse: foto, PDF pronti, file separati fronte/retro,
oppure **un file unico (immagine o PDF) che contiene entrambi i lati**.

Oggi:
- L'editor di ritaglio/raddrizzamento/migliora (`components/document-scanner-modal.tsx` +
  `lib/scanner/*`) lavora **solo su immagini**: `routeSelection` manda le immagini all'editor e i
  **PDF passano dritti** (passthrough, nessun ritaglio).
- Chi ha tutto separato non ha problemi. Chi ha un'**immagine** unica fronte+retro se la cava:
  carica il file due volte (slot Fronte e slot Retro) e ritaglia una zona diversa ogni volta.
- Chi ha un **PDF** unico fronte+retro è **bloccato**: il PDF non entra nell'editor, quindi non
  può separare i due lati.

Inoltre alcuni documenti oggi sono a **upload singolo** ma hanno informazioni su entrambi i lati —
in particolare il **libretto di circolazione**, il cui retro può avere etichette di trasferimento
di proprietà che **sovrascrivono** i dati del fronte (caso già gestito dal parser).

## Obiettivi

1. Permettere il ritaglio/migliora **anche a partire da un PDF** (oltre che dalle immagini),
   riusando l'editor esistente.
2. Rendere **obbligatorio fronte + retro** per i documenti che ne hanno bisogno, **libretto incluso**.
3. Per il libretto, usare l'OCR di **entrambe** le facciate combinato, così le etichette del retro
   vengono lette e prevalgono (come da regola già implementata su `parseLibrettoText`).

## Documenti: classificazione fronte/retro vs singolo

- **Fronte/retro obbligatorio**: Carta d'identità (già), Tessera sanitaria/Codice fiscale (già),
  **Libretto di circolazione** (nuovo), **Patente** (nuovo).
- **Singoli** (intrinsecamente unici o multi-pagina): Passaporto, Visura camerale, Permesso di
  soggiorno, certificati/atti dello Schema Documentale v7, allegati delega/procura.

## Design

### A. PDF come cittadino di prima classe dell'editor

- Nuovo modulo client `lib/scanner/pdf-render.ts` basato su **`pdfjs-dist`**:
  - `pdfPageCount(file: File): Promise<number>`
  - `renderPdfPage(file: File, pageIndex: number, scale?: number): Promise<HTMLCanvasElement>`
    (scala ~2x per qualità adeguata al ritaglio).
- `routeSelection(file)`: i PDF tornano `'editor'` (non più `'passthrough'`).
- `DocumentScannerModal`:
  - Se il file è PDF: rende la pagina su canvas; se il PDF ha **>1 pagina** mostra un
    **selettore pagina** (prev/next o thumbnail) e si rirenderizza alla pagina scelta.
  - Da lì in poi la pipeline è **identica** alle immagini (4 angoli manuali → omografia nel Web
    Worker → filtro "colore migliorato" → output JPEG via `canvasToJpegFile`).
  - Le immagini restano invariate.
- Output sempre **JPEG**: a valle (upload, OCR, persistenza, PDF unificato) non cambia nulla.

Rischio: setup del worker `pdfjs` in Next 16 (bundling). Mitigazione: `pdfjs-dist` è la libreria
standard e ben supportata (caso diverso da OpenCV); worker via l'entry standard di `pdfjs-dist`.

### B. Workflow "file unico fronte+retro" (PDF o immagine)

Confermato: **carica due volte, ritaglia ogni lato** (coerente con l'attuale flusso immagini).
- Carico il file nello slot **Fronte** → editor (scelgo pagina se PDF) → ritaglio il fronte → conferma.
- Carico lo **stesso** file nello slot **Retro** → editor → ritaglio il retro → conferma.

Nessuno split automatico: niente nuova logica multi-slot, massima coerenza con oggi.

### C. Patente → fronte/retro (come la CI)

- Wizard `IdentitaUploader`: condizione `docId === 'CI' || docId === 'PATENTE'` → due `UploadCard`
  (Fronte/Retro). Passaporto resta `UploadCard` singolo.
- `identitaPresente` / `parteCompleta` / `mancanzeParte`: CI **e** patente richiedono entrambe le
  facciate.
- Server `collectIdentita`: per la patente usa gli slot `<PREFIX>_ID_FRONTE` / `<PREFIX>_ID_RETRO`;
  l'OCR identità (`extractIdentita`) gira sul **fronte**.
- Persistenza: `PATENTE` (fronte) + nuovo `PATENTE_RETRO` (retro).

### D. Libretto → fronte/retro + OCR combinato

- Wizard: per ogni veicolo **due** `UploadCard` libretto (Fronte/Retro) al posto di una.
- `extractLibrettoAction`: accetta i due `FileRef` (fronte + retro). Lato server fa l'OCR di
  entrambi, **concatena i testi** (fronte poi retro) e passa il testo unico a `parseLibrettoText`,
  che già: àncora telaio a `(E)`, riconosce l'etichetta di trasferimento sul retro (override C.2.x)
  e sceglie l'etichetta più recente. Pre-fill del wizard sui dati combinati.
- Trigger OCR: quando **entrambi** i file (fronte+retro) sono caricati; re-OCR se cambia un file.
- Submit: slot `LIBRETTO_<ordine>_FRONTE` / `LIBRETTO_<ordine>_RETRO`.
- Persistenza: `LIBRETTO_CIRCOLAZIONE` (fronte) + nuovo `LIBRETTO_CIRCOLAZIONE_RETRO` (retro),
  entrambi collegati al `Veicolo`.

### E. Schema/DB

Due nuovi valori enum **additivi** in `DocumentoTipo`:
- `LIBRETTO_CIRCOLAZIONE_RETRO`
- `PATENTE_RETRO`

Una migration additiva (basso rischio, come `CODICE_FISCALE_RETRO`). Aggiornare:
- `DocumentoTipoEngine` (engine) + `TIPI_RACCOLTI_NELLA_PARTE` + `TIPO_LABEL` (`richiesti.ts`).
- Le mappe label di visualizzazione in `pratiche/[id]/page.tsx` e `inbox/[id]/page.tsx`.

### F. Validazione (fail-closed)

- Fronte/retro mancante per libretto o patente → blocco con messaggio chiaro (gate wizard + server).
- L'OCR del libretto resta best-effort per il pre-fill; la presenza dei file fronte+retro è
  obbligatoria.

## Implementazione in 3 fasi

1. **PDF nell'editor**: `pdfjs-dist` + `lib/scanner/pdf-render.ts` + `routeSelection` + selettore
   pagina nel modal. Valore immediato anche da solo (qualunque slot accetta PDF ritagliabile).
2. **Patente fronte/retro**: enum `PATENTE_RETRO` + plumbing wizard/server/engine/label.
3. **Libretto fronte/retro + OCR combinato**: enum `LIBRETTO_CIRCOLAZIONE_RETRO` + slot per-veicolo
   + `extractLibrettoAction` a due file + validazione.

## Test

- `lib/scanner/pdf-render.ts`: parti pure dove possibile (conteggio pagine, naming, scelta scala);
  il rendering canvas è verificato manualmente (richiede browser reale), come già per l'editor.
- `parseLibrettoText`: fixture con **testo combinato fronte+retro** (fronte con (E)/(D.2),
  retro con etichetta di trasferimento) → verifica telaio da (E) + proprietario dall'etichetta.
- Validazione fronte/retro per patente e libretto (gate wizard + server).
- `engine` / `richiesti`: i nuovi tipi sono riconosciuti e raccolti nella parte (non nello step
  documenti), con label corrette.

## Out of scope

- Split automatico di un file unico in fronte+retro (scelto esplicitamente "carica due volte").
- Auto-detect dei bordi nell'editor (resta ritaglio manuale, invariato).
- Passaporto fronte/retro (resta singolo).
- Cambiamenti al PDF unificato della pratica (`lib/documenti/pdf.ts`): continua a funzionare,
  riceve JPEG come oggi.

## Rischi / note

- `pdfjs-dist` aggiunge una dipendenza e un worker: verificare bundling Next 16 (entry worker).
- Doppio upload dello stesso PDF (fronte+retro) = doppio trasferimento del file: accettabile per
  coerenza; i file restano sotto il limite 10 MB.
- Migration enum additiva: va applicata in locale (DB Docker) e in prod (migrate deploy), come per
  `CODICE_FISCALE_RETRO`.
