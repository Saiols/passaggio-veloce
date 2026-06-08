# Scanner documenti in upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** All'upload di un'immagine (registrazione + pratica) aprire un editor tipo CamScanner: ritaglio + raddrizzamento prospettico + filtri, con output che sostituisce il file caricato.

**Architecture:** OpenCV.js lazy-importato (npm `@techstark/opencv-js`, code-split → servito dal nostro dominio, niente CDN esterno) + `jscanify` per detect/extract bordi. Un modal condiviso `DocumentScannerModal` + hook `useDocumentScanner` intercettano la selezione immagine in `DocCard` (registrazione) e `UploadCard` (pratica); i PDF bypassano. Nessuna modifica a server/`uploadToBlob`.

**Tech Stack:** Next.js 16, React 19, TS, `@techstark/opencv-js`, `jscanify`, Canvas API. Spec: `docs/superpowers/specs/2026-06-08-scanner-documenti-upload-design.md`.

---

## File structure
- Create `apps/piattaforma/src/lib/scanner/opencv-loader.ts` — lazy singleton load di OpenCV.js + bind a `globalThis.cv` (per jscanify).
- Create `apps/piattaforma/src/lib/scanner/process.ts` — helper PURI: `imageFileToCanvas`, `downscaleCanvas`, `canvasToJpegFile`, `presetLabel`, `isImageFile`. (warp/enhance vivono nel modal perché richiedono cv runtime.)
- Create `apps/piattaforma/src/lib/scanner/process.test.ts` — unit dei puri (no cv/canvas DOM: testo `isImageFile`, naming output, soglie downscale via stub di dimensioni).
- Create `apps/piattaforma/src/components/document-scanner-modal.tsx` — `DocumentScannerModal` + hook `useDocumentScanner`.
- Create `apps/piattaforma/src/components/use-document-scanner.test.ts` — unit routing immagine-vs-PDF dell'hook (logica pura estratta).
- Modify `apps/piattaforma/src/components/doc-card.tsx` — instrada la selezione nell'hook.
- Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — `UploadCard` instrada nell'hook.

## Note di realtà
- OpenCV.js è ~8 MB: caricato SOLO all'apertura dell'editor (dynamic `import('@techstark/opencv-js')`), code-split da Next. Niente file binario committato a mano, niente CDN.
- Warp/threshold OpenCV e UI canvas **non sono unit-testabili** (servono cv+DOM) → verifica manuale E2E. La logica PURA (routing, naming, soglie, scelta preset) è testata.

---

## Task 1: Dipendenze + OpenCV loader

**Files:**
- Modify: `apps/piattaforma/package.json` (deps)
- Create: `apps/piattaforma/src/lib/scanner/opencv-loader.ts`

- [ ] **Step 1: Installa le dipendenze**

Run: `pnpm --filter piattaforma add @techstark/opencv-js jscanify`
Expected: aggiunte a package.json, install ok. (Se il registry non è raggiungibile, FERMARSI e segnalare: serve installazione manuale o fallback.)

- [ ] **Step 2: Scrivi il loader (singleton lazy)**

```ts
// apps/piattaforma/src/lib/scanner/opencv-loader.ts
'use client';

// Carica OpenCV.js una sola volta e lo espone come globalThis.cv (richiesto da
// jscanify). Lazy: il chunk (~8 MB) si scarica solo alla prima chiamata.
let promise: Promise<unknown> | null = null;

export function loadOpenCv(): Promise<unknown> {
  if (promise) return promise;
  promise = (async () => {
    const mod = await import('@techstark/opencv-js');
    const cv = (mod as { default?: unknown }).default ?? mod;
    // @techstark espone una Promise-like quando il runtime wasm è pronto.
    if (cv && typeof (cv as { then?: unknown }).then === 'function') {
      await cv;
    } else if (cv && typeof (cv as { onRuntimeInitialized?: unknown }).onRuntimeInitialized !== 'undefined') {
      await new Promise<void>((res) => {
        (cv as { onRuntimeInitialized: () => void }).onRuntimeInitialized = () => res();
      });
    }
    (globalThis as { cv?: unknown }).cv = cv;
    return cv;
  })();
  return promise;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/package.json apps/piattaforma/src/lib/scanner/opencv-loader.ts pnpm-lock.yaml
git commit -m "feat(scanner): dipendenze OpenCV.js/jscanify + loader lazy"
```

---

## Task 2: Helper puri + test

**Files:**
- Create: `apps/piattaforma/src/lib/scanner/process.ts`
- Create: `apps/piattaforma/src/lib/scanner/process.test.ts`

- [ ] **Step 1: Scrivi il test dei puri**

```ts
// apps/piattaforma/src/lib/scanner/process.test.ts
import { describe, it, expect } from 'vitest';
import { isImageFile, scaledSize, outputFileName } from './process';

describe('scanner/process', () => {
  it('isImageFile riconosce jpg/png, esclude pdf', () => {
    expect(isImageFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
  });
  it('scaledSize ridimensiona oltre il lato max mantenendo le proporzioni', () => {
    expect(scaledSize(4000, 3000, 2500)).toEqual({ w: 2500, h: 1875 });
    expect(scaledSize(2000, 1000, 2500)).toEqual({ w: 2000, h: 1000 }); // sotto soglia: invariato
  });
  it('outputFileName forza estensione .jpg conservando il nome', () => {
    expect(outputFileName('Foto CI.png')).toBe('Foto CI.jpg');
    expect(outputFileName('doc')).toBe('doc.jpg');
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm --filter piattaforma test -- scanner/process`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementa i puri + helper canvas**

```ts
// apps/piattaforma/src/lib/scanner/process.ts
'use client';

export const SCANNER_ACCEPTED_MIME = ['image/jpeg', 'image/png'];
export type Preset = 'originale' | 'colore' | 'bn';

export function isImageFile(f: File): boolean {
  return SCANNER_ACCEPTED_MIME.includes(f.type);
}

export function scaledSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { w, h };
  const k = maxSide / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export function outputFileName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.jpg`;
}

/** Decodifica un File immagine in un canvas (downscalato se troppo grande). */
export async function imageFileToCanvas(file: File, maxSide = 2500): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = scaledSize(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas;
}

/** Canvas → File JPEG (ricomprime finché sotto maxBytes). */
export async function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  name: string,
  maxBytes = 10 * 1024 * 1024,
): Promise<File> {
  let quality = 0.92;
  let blob = await toBlob(canvas, quality);
  while (blob.size > maxBytes && quality > 0.4) {
    quality -= 0.15;
    blob = await toBlob(canvas, quality);
  }
  return new File([blob], outputFileName(name), { type: 'image/jpeg' });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/jpeg', quality),
  );
}
```

- [ ] **Step 4: Verifica pass**

Run: `pnpm --filter piattaforma test -- scanner/process`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/scanner/process.ts apps/piattaforma/src/lib/scanner/process.test.ts
git commit -m "feat(scanner): helper puri (downscale/naming/canvas→jpeg) + test"
```

---

## Task 3: DocumentScannerModal + hook

**Files:**
- Create: `apps/piattaforma/src/components/document-scanner-modal.tsx`
- Create: `apps/piattaforma/src/components/use-document-scanner.test.ts`

Comportamento del modal:
- All'apertura: `imageFileToCanvas(file)` → mostra l'immagine in un `<canvas>` scalato a video; `loadOpenCv()` in background → quando pronto, `new jscanify().getCornerPoints(srcMat)` per inizializzare i 4 angoli (fallback: angoli ai bordi). Se OpenCV fallisce → avviso + solo "Usa originale".
- 4 maniglie `<div>` trascinabili (mouse + touch) sopra il canvas; stato `corners` in coord immagine.
- Toolbar: **Ruota 90°**, preset **Originale/Colore/Bianco e nero** (default Originale), **Scatta foto** (`<input type="file" accept="image/*" capture="environment">` → ricarica il flusso), **Annulla** / **Usa originale** / **Conferma**.
- **Conferma**: `jscanify.extractPaper(canvas, outW, outH, corners)` (dewarp) → applica preset (colore: `cv.convertScaleAbs` α/β; bn: `cvtColor`+`adaptiveThreshold`) su un mat → canvas → `canvasToJpegFile` → `onConfirm(file)`.

- [ ] **Step 1: Test del routing dell'hook (logica pura)**

```ts
// apps/piattaforma/src/components/use-document-scanner.test.ts
import { describe, it, expect } from 'vitest';
import { routeSelection } from './document-scanner-modal';

describe('routeSelection', () => {
  it('immagine → apre editor', () => {
    expect(routeSelection(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe('editor');
  });
  it('pdf → passa diretto', () => {
    expect(routeSelection(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe('passthrough');
  });
  it('null → noop', () => {
    expect(routeSelection(null)).toBe('noop');
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm --filter piattaforma test -- use-document-scanner`
Expected: FAIL.

- [ ] **Step 3: Implementa modal + hook + `routeSelection`**

Implementa `apps/piattaforma/src/components/document-scanner-modal.tsx` con:

```ts
export function routeSelection(file: File | null): 'editor' | 'passthrough' | 'noop' {
  if (!file) return 'noop';
  return isImageFile(file) ? 'editor' : 'passthrough';
}
```

e l'hook:

```ts
export function useDocumentScanner({ onFile }: { onFile: (f: File | null) => void }) {
  const [pending, setPending] = useState<File | null>(null);
  const pick = (file: File | null) => {
    switch (routeSelection(file)) {
      case 'editor': setPending(file); break;
      case 'passthrough': onFile(file); break;
      case 'noop': onFile(null); break;
    }
  };
  const modal = pending ? (
    <DocumentScannerModal
      file={pending}
      onConfirm={(f) => { onFile(f); setPending(null); }}
      onCancel={() => setPending(null)}
    />
  ) : null;
  return { pick, modal };
}
```

Il `DocumentScannerModal` (full-screen overlay, palette Trust Blue) implementa canvas + maniglie + toolbar + preset + camera + `loadOpenCv`/`jscanify` come descritto sopra. Su errore OpenCV: stato `cvError` → mostra avviso e disabilita Conferma, lascia "Usa originale". Import: `loadOpenCv` da `@/lib/scanner/opencv-loader`; `imageFileToCanvas/canvasToJpegFile/isImageFile/Preset` da `@/lib/scanner/process`; `jscanify` da `'jscanify'` (dynamic import insieme a cv). Riusa `Button`/`Alert` da `@/components/ui`.

- [ ] **Step 4: Verifica test pass + typecheck**

Run: `pnpm --filter piattaforma test -- use-document-scanner && pnpm --filter piattaforma typecheck`
Expected: PASS, typecheck pulito.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/components/document-scanner-modal.tsx apps/piattaforma/src/components/use-document-scanner.test.ts
git commit -m "feat(scanner): DocumentScannerModal + hook useDocumentScanner"
```

---

## Task 4: Integrazione in DocCard (registrazione) + UploadCard (pratica)

**Files:**
- Modify: `apps/piattaforma/src/components/doc-card.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (componente `UploadCard`)

- [ ] **Step 1: DocCard usa l'hook**

In `DocCard`: importa `useDocumentScanner`. `const { pick, modal } = useDocumentScanner({ onFile: onChange });`. L'`<input onChange>` chiama `pick(e.target.files?.[0] ?? null)` invece di `onChange(...)`. Aggiungi `{modal}` nel render. Aggiungi un pulsante/area "Scatta foto" opzionale (il modal ha già la camera; in DocCard basta l'input file → l'editor poi offre lo scatto).

- [ ] **Step 2: UploadCard usa l'hook**

In `UploadCard` (wizard.tsx): idem con `onFile: onSelect`. L'input file chiama `pick`. Render `{modal}`.

- [ ] **Step 3: Gate completi**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && pnpm --filter piattaforma test`
Expected: tutto verde.

- [ ] **Step 4: Build**

Run: `pnpm --filter piattaforma build`
Expected: build OK (verifica che il chunk OpenCV sia separato/lazy).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/components/doc-card.tsx apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(scanner): editor di scansione in DocCard (registrazione) + UploadCard (pratica)"
```

---

## Task 5: Verifica manuale E2E + deploy
- [ ] Deploy (push main) e test in prod: upload foto storta → editor con angoli auto/manuali → preset → Conferma → l'immagine caricata è ritagliata/raddrizzata/migliorata; "Usa originale"; "Annulla"; PDF bypassa; scatto fotocamera su mobile; fallback se OpenCV non carica (es. throttling rete).
- [ ] Verifica che l'OCR sui documenti scansionati continui a funzionare (la verifica documentale vede l'immagine migliorata).

---

## Self-review
- **Copertura spec:** loader (T1), puri+canvas (T2), modal+hook+camera+preset+fallback (T3), integrazione registrazione+pratica (T4), E2E (T5). ✓
- **Placeholder:** nessuno; codice reale nei puri/hook; il corpo del modal (canvas/OpenCV) è descritto con API esatte (jscanify `getCornerPoints`/`extractPaper`, OpenCV `cvtColor`/`adaptiveThreshold`/`convertScaleAbs`) — non unit-testabile, verifica manuale.
- **Coerenza tipi:** `Preset` ('originale'|'colore'|'bn'), `isImageFile`, `routeSelection` ('editor'|'passthrough'|'noop'), `useDocumentScanner({onFile})→{pick,modal}` usati coerentemente in T3/T4.
