# Scanner documenti in upload (ritaglio + raddrizzamento + miglioramento)

**Data:** 2026-06-08
**Stato:** approvato (design)
**Branch:** main

## Goal
Dare a tutti gli upload di documenti (registrazione **e** invio pratica) un'esperienza tipo CamScanner: alla selezione di un'**immagine**, un editor permette di **ritagliare**, **raddrizzare la prospettiva** (dewarp) e **migliorare** (filtri "scansione"). Migliora la leggibilità OCR nei casi borderline e produce un archivio documentale molto più pulito per l'agenzia.

## Decisioni acquisite
1. **Fedeltà: CamScanner completo** via **OpenCV.js** (rilevamento bordi automatico + dewarp prospettico + filtri). Angoli sempre regolabili a mano (l'auto-detect fallisce su sfondi a basso contrasto).
2. **Attivazione automatica ma saltabile**: l'editor si apre alla selezione di un'immagine; "Usa originale" salta.
3. **Scatto da fotocamera su mobile** oltre all'upload da file.
4. **OpenCV.js self-hosted** in `/public` (niente CDN esterno, niente account/servizi a pagamento), caricato **lazy** solo all'apertura dell'editor.

## Architettura

### Nuovi moduli
- **`apps/piattaforma/public/opencv/opencv.js`** — build ufficiale OpenCV.js (~8–10 MB) servita dal nostro dominio.
- **`apps/piattaforma/src/lib/scanner/opencv-loader.ts`** — `loadOpenCv(): Promise<cv>`: inietta `<script src="/opencv/opencv.js">` una sola volta (singleton promise), risolve su `cv.onRuntimeInitialized`. Errore di rete → reject (gestito a monte con fallback).
- **`apps/piattaforma/src/lib/scanner/process.ts`** — funzioni che lavorano su `HTMLCanvasElement`/`ImageBitmap`:
  - `detectCorners(canvas) → Corners | null` (via **jscanify** `getCornerPoints`).
  - `warpAndEnhance(canvas, corners, preset) → Promise<Blob>` (JPEG): dewarp prospettico (`extractPaper`/`warpPerspective`) + filtro del preset.
  - `downscaleIfNeeded(canvas, maxPx)`: ridimensiona foto enormi prima del processing (perf).
  - preset: `'originale' | 'colore' | 'bn'` (colore = contrasto/luminosità; bn = grayscale + `adaptiveThreshold`).
- **`apps/piattaforma/src/components/document-scanner-modal.tsx`** — l'editor + un hook condiviso:
  - `DocumentScannerModal({ file, onConfirm(File), onCancel() })`: mostra l'immagine, **4 angoli trascinabili** (init da `detectCorners`, fallback bordi immagine), **rotazione 90°**, **preset filtro** con anteprima, pulsanti **Conferma / Usa originale / Annulla**, e su mobile **"Scatta foto"** (`<input accept="image/*" capture="environment">`).
  - `useDocumentScanner({ onFile }) → { pick(file), modal }`: `pick(file)` apre il modal se `file.type` è immagine, altrimenti chiama `onFile(file)` (PDF e altri bypassano). `modal` è il nodo `<DocumentScannerModal>` (o null).

### Dipendenze
- `jscanify` (npm, ~decine di KB) — wrapper su OpenCV.js per detect/extract.
- OpenCV.js **self-hosted** (file statico, non npm) — lazy.

## Flusso
1. L'utente seleziona un file (o scatta foto) in `DocCard`/`UploadCard`.
2. `useDocumentScanner.pick(file)`: immagine → apre il modal; PDF → `onFile(file)` diretto.
3. Nel modal: `downscaleIfNeeded` → `detectCorners` (fallback bordi) → l'utente regola angoli + sceglie preset + ruota.
4. **Conferma** → `warpAndEnhance` → JPEG `File` (nome originale, estensione `.jpg`) → `onConfirm(file)`.
5. **Usa originale** → `onConfirm(originalFile)`. **Annulla** → `onCancel()` (nessun upload, selezione azzerata).
6. Il File risultante entra nella pipeline esistente: `DocCard.onChange` / `UploadCard.onSelect` → `uploadToBlob` → Blob. **Nessuna modifica a server/`uploadToBlob`.**

## Integrazione (copre registrazione + pratica)
- `components/doc-card.tsx` (registrazione): l'`<input>` chiama `pick` invece di `onChange` diretto; render del `modal`.
- `app/pratiche/nuova/wizard.tsx` `UploadCard`: idem con `onSelect`.
- Stesso hook/modal in entrambi → comportamento uniforme.

## Preset filtri
- **Originale** (default): solo ritaglio + dewarp, colore invariato. Sicuro per documenti con foto (es. CI).
- **Colore migliorato**: contrasto/luminosità per foto sbiadite.
- **Bianco e nero**: `adaptiveThreshold` (look "scansione"), massima pulizia per testi.

## Edge / fallback
- **OpenCV non carica** (rete): il modal mostra un avviso e consente comunque l'upload dell'originale (graceful, non blocca).
- **Auto-detect fallisce**: angoli iniziali = bordi immagine (ritaglio manuale).
- **Immagine enorme**: `downscaleIfNeeded` (es. lato max ~2500 px) prima di detect/warp.
- **Output > 10 MB**: ricomprimi JPEG (qualità ↓) / scala finché sotto `MAX_UPLOAD_BYTES`.
- **PDF / non-immagine**: bypassano l'editor (upload diretto).
- Dopo il primo load, OpenCV.js è in cache → funziona offline.

## Vincoli/Non-goal
- Nessun cambiamento alla verifica documentale OCR, all'engine, al submit: l'output è semplicemente un'immagine migliore nello stesso slot.
- Niente multi-pagina/PDF-da-immagini in v1 (un'immagine = un file).
- Niente servizi esterni a pagamento.

## Testing
- **Unit** (`lib/scanner/process` + hook): scelta preset/format, `downscaleIfNeeded` (soglie), routing immagine-vs-PDF dell'hook, generazione nome/estensione output. (Il warp/threshold OpenCV richiede `cv` + canvas → coperto da verifica manuale.)
- **E2E manuale**: upload foto storta → ritaglio/dewarp/filtro → conferma → l'immagine caricata è pulita; "Usa originale" e "Annulla"; PDF bypassa; scatto da fotocamera su mobile; fallback se OpenCV non carica.

## Sequenza implementazione
1. opencv-loader + self-host opencv.js + dipendenza jscanify.
2. process.ts (detect/warp/enhance/downscale) + unit.
3. DocumentScannerModal + useDocumentScanner + unit hook.
4. Integrazione DocCard (registrazione) + UploadCard (pratica).
5. Gate (typecheck·lint·test·build) + verifica manuale (E2E) → deploy.

## Follow-up
- Eventuale auto-detect più robusto / multi-pagina in futuro.
