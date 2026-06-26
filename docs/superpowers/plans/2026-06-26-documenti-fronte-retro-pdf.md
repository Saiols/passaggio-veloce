# Documenti fronte/retro + PDF ritagliabile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere ritaglio/migliora anche da PDF (oltre alle immagini) e rendere obbligatorio fronte+retro per libretto e patente, con OCR libretto combinato fronte+retro.

**Architecture:** Il PDF diventa un input dell'editor esistente: lo rasterizziamo client-side con `pdfjs-dist` in un canvas e da lì entra nella stessa pipeline ritaglio→omografia→migliora→JPEG già usata per le immagini. Libretto e patente passano a doppio slot Fronte/Retro come già fanno CI e Tessera/CF; il libretto OCR-a due file concatena i testi e li passa a `parseLibrettoText` (che già gestisce sticker sul retro). Due nuovi valori enum additivi persistono i retro.

**Tech Stack:** Next.js 16, React, TypeScript, Prisma + Postgres, Vitest, `pdfjs-dist` (nuova dip), canvas/Web Worker (scanner esistente), Vercel Blob client upload.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-06-26-documenti-fronte-retro-pdf-design.md`.
- Comandi dalla dir app: `cd apps/piattaforma`. Test: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit -p tsconfig.json`. Lint: `npx eslint <files>`.
- Node 22 (`nvm use 22.15.0`). pnpm monorepo.
- Output dell'editor sempre **JPEG** (invariato): upload/OCR/persistenza a valle non cambiano.
- Documenti fronte/retro: CI (già), Tessera/CF (già), **Libretto**, **Patente**. Singoli: passaporto, visura, permesso, certificati/atti, delega.
- Persistenza patente: `PATENTE` resta il fronte, nuovo `PATENTE_RETRO` per il retro (no rename).
- OCR libretto: parte quando fronte **e** retro sono entrambi presenti; testo = fronte + "\n" + retro.
- Migration enum **additive**, applicate con DB Docker attivo (`pnpm --filter @pv/db db:migrate`); il client va rigenerato (`pnpm --filter @pv/db exec prisma generate`).
- Limite file 10 MB, MIME PDF/JPG/PNG (invariato).

---

## File Structure

- Create: `apps/piattaforma/src/lib/scanner/pdf-render.ts` — render PDF→canvas client-side (pdfjs) + helper puri.
- Create: `apps/piattaforma/src/lib/scanner/pdf-render.test.ts` — test dei puri (`isPdfFile`, `clampPageIndex`).
- Modify: `apps/piattaforma/src/lib/scanner/process.ts` — (eventuale) nessun cambiamento di firma; resta sorgente di `isImageFile`.
- Modify: `apps/piattaforma/src/components/document-scanner-modal.tsx` — routeSelection PDF→editor; modal gestisce PDF (render + selettore pagina).
- Modify: `apps/piattaforma/src/components/use-document-scanner.test.ts` — test routeSelection per PDF.
- Modify: `packages/db/prisma/schema.prisma` — enum `PATENTE_RETRO`, `LIBRETTO_CIRCOLAZIONE_RETRO`.
- Create: `packages/db/prisma/migrations/<ts>_patente_libretto_retro/migration.sql`.
- Modify: `apps/piattaforma/src/lib/documenti/engine.ts` — `DocumentoTipoEngine` + `documentiPerParte` (patente retro; libretto resta gestito a parte).
- Modify: `apps/piattaforma/src/lib/documenti/richiesti.ts` — `TIPI_RACCOLTI_NELLA_PARTE` + `TIPO_LABEL`.
- Modify: `apps/piattaforma/src/lib/documenti/engine.test.ts` — attese patente fronte+retro.
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — patente F/R, libretto F/R, OCR trigger, submit slots, validazione.
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — `extractLibrettoAction` due file; `collectIdentita` patente F/R; raccolta libretto F/R + persistenza retro.
- Modify: `apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts` — fixture testo combinato fronte+retro.
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` + `apps/piattaforma/src/app/inbox/[id]/page.tsx` — label nuovi tipi.

---

## FASE 1 — PDF nell'editor

### Task 1.1: Modulo `pdf-render` (pdfjs) + helper puri

**Files:**
- Modify: `apps/piattaforma/package.json` (dip `pdfjs-dist`)
- Create: `apps/piattaforma/src/lib/scanner/pdf-render.ts`
- Test: `apps/piattaforma/src/lib/scanner/pdf-render.test.ts`

**Interfaces:**
- Produces: `isPdfFile(f: File): boolean`, `clampPageIndex(index: number, count: number): number`, `pdfPageCount(file: File): Promise<number>`, `renderPdfPage(file: File, pageIndex?: number, scale?: number): Promise<HTMLCanvasElement>`.

- [ ] **Step 1: Aggiungi la dipendenza**

Run: `cd apps/piattaforma && pnpm add pdfjs-dist`
Expected: `pdfjs-dist` in `dependencies`.

- [ ] **Step 2: Scrivi i test dei puri**

Create `apps/piattaforma/src/lib/scanner/pdf-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPdfFile, clampPageIndex } from './pdf-render';

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe('isPdfFile', () => {
  it('riconosce il mime application/pdf', () => {
    expect(isPdfFile(file('doc.bin', 'application/pdf'))).toBe(true);
  });
  it('riconosce l’estensione .pdf anche senza mime', () => {
    expect(isPdfFile(file('doc.PDF', ''))).toBe(true);
  });
  it('le immagini non sono PDF', () => {
    expect(isPdfFile(file('foto.jpg', 'image/jpeg'))).toBe(false);
  });
});

describe('clampPageIndex', () => {
  it('mantiene un indice valido', () => {
    expect(clampPageIndex(1, 3)).toBe(1);
  });
  it('clampa sotto 0', () => {
    expect(clampPageIndex(-2, 3)).toBe(0);
  });
  it('clampa oltre l’ultima pagina', () => {
    expect(clampPageIndex(9, 3)).toBe(2);
  });
  it('count 0 → 0', () => {
    expect(clampPageIndex(5, 0)).toBe(0);
  });
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `npx vitest run src/lib/scanner/pdf-render.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 4: Implementa il modulo**

Create `apps/piattaforma/src/lib/scanner/pdf-render.ts`:

```ts
'use client';

import * as pdfjs from 'pdfjs-dist';

// Worker pdf.js servito come modulo separato (Next 16 / webpack).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/** True se il file è un PDF (mime o estensione). */
export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/** Indice pagina valido entro [0, count-1]; count<=0 → 0. */
export function clampPageIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

/** Numero di pagine del PDF. */
export async function pdfPageCount(file: File): Promise<number> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

/** Renderizza una pagina del PDF su canvas (scala default 2x per il ritaglio). */
export async function renderPdfPage(
  file: File,
  pageIndex = 0,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(clampPageIndex(pageIndex, doc.numPages) + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 5: Verifica che passino**

Run: `npx vitest run src/lib/scanner/pdf-render.test.ts`
Expected: PASS (7 test).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: nessun errore. Se `pdfjs-dist` dà errori di tipi sul worker URL, verificare la versione e l'entry `build/pdf.worker.min.mjs` (alcune versioni usano `.js`); adeguare il path.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/package.json pnpm-lock.yaml apps/piattaforma/src/lib/scanner/pdf-render.ts apps/piattaforma/src/lib/scanner/pdf-render.test.ts
git commit -m "feat(scanner): pdf-render (pdfjs) per rasterizzare PDF in canvas"
```

### Task 1.2: Editor accetta PDF (routeSelection + modal con selettore pagina)

**Files:**
- Modify: `apps/piattaforma/src/components/document-scanner-modal.tsx`
- Test: `apps/piattaforma/src/components/use-document-scanner.test.ts`

**Interfaces:**
- Consumes: `isPdfFile`, `pdfPageCount`, `renderPdfPage` (Task 1.1); `canvasToJpegFile` (esistente, `lib/scanner/process.ts`).

- [ ] **Step 1: Aggiorna il test di routeSelection**

In `apps/piattaforma/src/components/use-document-scanner.test.ts` aggiungi/aggiorna:

```ts
it('PDF → editor (non più passthrough)', () => {
  const pdf = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
  expect(routeSelection(pdf)).toBe('editor');
});
```
(Se esiste un test che afferma `routeSelection(pdf) === 'passthrough'`, aggiornalo a `'editor'`.)

- [ ] **Step 2: Verifica che fallisca**

Run: `npx vitest run src/components/use-document-scanner.test.ts`
Expected: FAIL (oggi i PDF danno 'passthrough').

- [ ] **Step 3: routeSelection → editor per i PDF**

In `document-scanner-modal.tsx`, importa `isPdfFile` da `@/lib/scanner/pdf-render` e cambia:

```ts
export function routeSelection(file: File | null): 'editor' | 'passthrough' | 'noop' {
  if (!file) return 'noop';
  return isImageFile(file) || isPdfFile(file) ? 'editor' : 'passthrough';
}
```

- [ ] **Step 4: Verifica routeSelection**

Run: `npx vitest run src/components/use-document-scanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Modal gestisce il PDF (render + selettore pagina)**

In `DocumentScannerModal`, importa `isPdfFile, pdfPageCount, renderPdfPage`. Aggiungi stato pagina e sorgente da PDF. Sostituisci il caricamento sorgente (lo `useEffect` che fa `imageFileToCanvas`) con una logica che:
- per immagini: invariato (`imageFileToCanvas(file)`);
- per PDF: `pdfPageCount(file)` → salva `pageCount`; `renderPdfPage(file, pageIndex)` → canvas; rigenera al cambio di `pageIndex`.

Stato aggiuntivo:
```ts
const isPdf = isPdfFile(file);
const [pageIndex, setPageIndex] = useState(0);
const [pageCount, setPageCount] = useState(1);
```
useEffect (dipendenze `[file, pageIndex]`):
```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    setStatus('loading');
    setErrorMsg(null);
    let canvas: HTMLCanvasElement;
    try {
      if (isPdf) {
        if (pageIndex === 0) setPageCount(await pdfPageCount(file));
        canvas = await renderPdfPage(file, pageIndex, 2);
      } else {
        canvas = await imageFileToCanvas(file);
      }
    } catch {
      if (!cancelled) { setStatus('error'); setErrorMsg(isPdf ? 'PDF non leggibile.' : 'Immagine non leggibile.'); }
      return;
    }
    if (cancelled) return;
    setSrc({ canvas, url: canvas.toDataURL('image/jpeg', 0.92) });
    setCorners(boundsCorners(canvas.width, canvas.height));
    setStatus('ready');
  })();
  return () => { cancelled = true; };
}, [file, pageIndex, isPdf]);
```
Selettore pagina (mostralo solo se `isPdf && pageCount > 1`), nella barra inferiore accanto a "Ruota":
```tsx
{isPdf && pageCount > 1 && (
  <div className="flex items-center gap-2 text-[13px] text-pv-navy-700">
    <button type="button" disabled={pageIndex <= 0 || status === 'working'}
      onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
      className="rounded-[8px] border border-pv-slate-200 px-2 py-1 disabled:opacity-50">‹</button>
    <span>Pagina {pageIndex + 1} / {pageCount}</span>
    <button type="button" disabled={pageIndex >= pageCount - 1 || status === 'working'}
      onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
      className="rounded-[8px] border border-pv-slate-200 px-2 py-1 disabled:opacity-50">›</button>
  </div>
)}
```
Nota: `conferma()` e `rotate()` restano invariati (lavorano su `src.canvas`). "Usa originale" per un PDF: passare comunque l'output dell'editor — per coerenza, per i PDF il bottone "Usa originale" deve usare la pagina renderizzata corrente (non il PDF grezzo): cambia `onClick={() => onConfirm(file)}` in un handler che, se `isPdf`, produce il JPEG della pagina corrente:
```ts
const usaOriginale = async () => {
  if (!isPdf) return onConfirm(file);
  if (!src) return;
  const out = document.createElement('canvas');
  out.width = src.canvas.width; out.height = src.canvas.height;
  out.getContext('2d')!.drawImage(src.canvas, 0, 0);
  onConfirm(await canvasToJpegFile(out, file.name));
};
```
e usa `onClick={usaOriginale}`. Importa `canvasToJpegFile` (già importato `from '@/lib/scanner/process'`).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json` poi `npx eslint src/components/document-scanner-modal.tsx`
Expected: nessun errore.

- [ ] **Step 7: Verifica manuale (browser)**

Avvia l'app, vai su una qualunque UploadCard, carica un **PDF** (1 pagina e multi-pagina): l'editor si apre, mostra la pagina, il selettore pagina compare se >1, ritaglio+conferma producono un JPEG. Carica un'immagine: comportamento invariato.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/components/document-scanner-modal.tsx apps/piattaforma/src/components/use-document-scanner.test.ts
git commit -m "feat(scanner): l'editor accetta PDF (render pagina + selettore pagina)"
```

---

## FASE 2 — Patente fronte/retro

### Task 2.1: Enum `PATENTE_RETRO` + engine + label

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_patente_libretto_retro/migration.sql`
- Modify: `apps/piattaforma/src/lib/documenti/engine.ts`, `apps/piattaforma/src/lib/documenti/richiesti.ts`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx`, `apps/piattaforma/src/app/inbox/[id]/page.tsx`
- Test: `apps/piattaforma/src/lib/documenti/engine.test.ts`

> Nota: questa migration aggiunge **due** valori (PATENTE_RETRO ora; LIBRETTO_CIRCOLAZIONE_RETRO in Fase 3). Per non fare due migration, includere entrambi i valori nello schema **adesso** e in un'unica migration; la Fase 3 userà solo il plumbing.

- [ ] **Step 1: Schema enum (entrambi i valori)**

In `packages/db/prisma/schema.prisma`, enum `DocumentoTipo`, dopo `PATENTE`:
```prisma
  PATENTE
  PATENTE_RETRO
  LIBRETTO_CIRCOLAZIONE_RETRO
```
(LIBRETTO_CIRCOLAZIONE_RETRO può stare anche vicino a LIBRETTO_CIRCOLAZIONE; l'ordine nell'enum non conta.)

- [ ] **Step 2: Migration file**

Con DB Docker attivo: `pnpm --filter @pv/db db:migrate --name patente_libretto_retro`.
Se il DB è spento, creare a mano `packages/db/prisma/migrations/20260626130000_patente_libretto_retro/migration.sql`:
```sql
-- AlterEnum
ALTER TYPE "DocumentoTipo" ADD VALUE 'PATENTE_RETRO';
ALTER TYPE "DocumentoTipo" ADD VALUE 'LIBRETTO_CIRCOLAZIONE_RETRO';
```
poi `pnpm --filter @pv/db exec prisma generate`.

- [ ] **Step 3: engine — test atteso patente fronte+retro**

In `engine.test.ts`, aggiorna/aggiungi il caso patente: il venditore/acquirente con `documentoIdentita: 'PATENTE'` deve produrre `PATENTE` **e** `PATENTE_RETRO` (oltre a `CODICE_FISCALE`). Esempio:
```ts
it('patente: aggiunge PATENTE + PATENTE_RETRO', () => {
  const r = calcolaDocumentiRichiesti(/* input venditore patente, vedi casi esistenti */);
  const tipi = r.documentiRichiesti.map((d) => d.tipo);
  expect(tipi).toContain('PATENTE');
  expect(tipi).toContain('PATENTE_RETRO');
});
```
(Allinea i conteggi negli altri test patente esistenti: ora c'è un doc in più.)

- [ ] **Step 4: Verifica fallimento**

Run: `npx vitest run src/lib/documenti/engine.test.ts`
Expected: FAIL sul nuovo atteso.

- [ ] **Step 5: engine — genera PATENTE_RETRO**

In `engine.ts`: aggiungi `'PATENTE_RETRO'` a `DocumentoTipoEngine`. In `documentiPerParte` (dove oggi aggiunge `PATENTE`), aggiungi anche `PATENTE_RETRO` quando `docIdentita === 'PATENTE'`:
```ts
if (docIdentita === 'PATENTE') {
  out.push({ tipo: 'PATENTE', parte, motivo: `${motivoPrefix}: patente fronte`, venditoreOrdine });
  out.push({ tipo: 'PATENTE_RETRO', parte, motivo: `${motivoPrefix}: patente retro`, venditoreOrdine });
}
```
(Adegua all'attuale forma del codice; oggi PATENTE è aggiunta nel ramo non-CI.)

- [ ] **Step 6: richiesti.ts — label + raccolta nella parte**

In `richiesti.ts`: aggiungi a `TIPI_RACCOLTI_NELLA_PARTE` `'PATENTE_RETRO'` e `'LIBRETTO_CIRCOLAZIONE_RETRO'`; in `TIPO_LABEL` aggiungi `PATENTE_RETRO: 'Patente (retro)'` e `LIBRETTO_CIRCOLAZIONE_RETRO: 'Libretto di circolazione (retro)'` (TIPO_LABEL è `Record<DocumentoTipoEngine,...>` → richiede la chiave LIBRETTO_RETRO solo se aggiunta anche all'engine type; aggiungila al type in engine.ts in questo step per coerenza).

- [ ] **Step 7: Label visualizzazione**

In `pratiche/[id]/page.tsx` e `inbox/[id]/page.tsx` (mappe `Record<string,string>`), aggiungi:
```ts
PATENTE_RETRO: 'Patente (retro)',
LIBRETTO_CIRCOLAZIONE_RETRO: 'Libretto (retro)',
```

- [ ] **Step 8: Verifica + typecheck**

Run: `npx vitest run src/lib/documenti/` poi `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, nessun errore.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/piattaforma/src/lib/documenti/engine.ts apps/piattaforma/src/lib/documenti/richiesti.ts apps/piattaforma/src/lib/documenti/engine.test.ts apps/piattaforma/src/app/pratiche/[id]/page.tsx apps/piattaforma/src/app/inbox/[id]/page.tsx
git commit -m "feat(documenti): enum PATENTE_RETRO + LIBRETTO_CIRCOLAZIONE_RETRO + engine/label"
```

### Task 2.2: Wizard — patente fronte/retro

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

**Interfaces:**
- Consumes: pattern CI esistente (`docId === 'CI'` → due UploadCard `fronte`/`retro`; `identitaPresente` richiede entrambe).

- [ ] **Step 1: Render patente F/R**

Nell'`IdentitaUploader`, dove oggi `docId === 'CI' ? (fronte+retro) : (single)`, cambia la condizione del ramo fronte/retro in `docId === 'CI' || docId === 'PATENTE'`. Per la patente etichetta le card "Patente (fronte)" / "Patente (retro)". Il ramo singolo resta solo per `PASSAPORTO`. La OCR identità è già agganciata al `fronte` (`onMainRef`/`onInvalidateIdentita`), quindi la patente fronte alimenta l'OCR come la CI.

- [ ] **Step 2: Validazione presenza**

`identitaPresente(docId, files)`: cambia in
```ts
return docId === 'CI' || docId === 'PATENTE'
  ? !!files.fronte?.ref && !!files.retro?.ref
  : !!files.single?.ref;
```
(`parteCompleta`/`mancanzeParte` usano `identitaPresente`, quindi si adeguano da sole.)

- [ ] **Step 3: Submit slot retro patente**

In `handleFinalSubmit`, dove oggi mappa gli slot identità: per `docId === 'CI' || 'PATENTE'` invia `VEND<n>_ID_FRONTE`/`VEND<n>_ID_RETRO` (oggi il ramo CI fa già così); estendi la condizione del ramo "fronte/retro" a includere la patente, e il ramo `single` solo per passaporto. Idem acquirente (`ACQ_ID_FRONTE`/`ACQ_ID_RETRO`).

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json` poi `npx eslint src/app/pratiche/nuova/wizard.tsx`
Expected: nessun errore.

- [ ] **Step 5: Verifica manuale**

Wizard → venditore/acquirente con documento **Patente**: compaiono due card (fronte/retro), il gate "Avanti" richiede entrambe, l'OCR identità gira sul fronte.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): patente fronte/retro nel wizard"
```

### Task 2.3: Server — patente fronte/retro (raccolta + persistenza)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

- [ ] **Step 1: collectIdentita gestisce la patente F/R**

In `collectIdentita`, il ramo `documentoIdentita === 'CI'` (slot `_ID_FRONTE`/`_ID_RETRO`, push `CI_FRONTE`+`CI_RETRO`) va esteso alla patente, persistendo però i tipi patente. Ristruttura:
```ts
if (documentoIdentita === 'CI' || documentoIdentita === 'PATENTE') {
  const fronte = getRef(`${prefix}_ID_FRONTE`);
  const retro = getRef(`${prefix}_ID_RETRO`);
  if (!fronte || fronte.size === 0 || !retro || retro.size === 0) redirect(missingMsg);
  const [tFronte, tRetro] = documentoIdentita === 'CI'
    ? (['CI_FRONTE', 'CI_RETRO'] as const)
    : (['PATENTE', 'PATENTE_RETRO'] as const);
  identitaCandidates.push({ tipo: tFronte, owner, venditoreOrdine, ref: validateIdentitaRef(fronte!, "documento d'identità") });
  identitaCandidates.push({ tipo: tRetro, owner, venditoreOrdine, ref: validateIdentitaRef(retro!, "documento d'identità") });
} else {
  // solo PASSAPORTO: slot singolo _ID → tipo 'PASSAPORTO'
  const id = getRef(`${prefix}_ID`);
  if (!id || id.size === 0) redirect(missingMsg);
  identitaCandidates.push({ tipo: 'PASSAPORTO', owner, venditoreOrdine, ref: validateIdentitaRef(id!, "documento d'identità") });
}
```
Aggiungi `'PATENTE_RETRO'` al union `IdentitaDocCandidate.tipo`.

- [ ] **Step 2: OCR identità sul fronte patente**

In `ocrParteServer`, oggi `idRef = docId === 'CI' ? getRef('_ID_FRONTE') : getRef('_ID')`. Cambia in:
```ts
const idRef = docId === 'CI' || docId === 'PATENTE' ? getRef(`${prefix}_ID_FRONTE`) : getRef(`${prefix}_ID`);
```
(`extractIdentita(text, docId)` resta invariato.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: nessun errore.

- [ ] **Step 4: Verifica manuale (con DB)**

Invia una pratica con patente: nel dettaglio pratica compaiono i documenti "Patente" + "Patente (retro)".

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): patente fronte/retro lato server (raccolta + persistenza)"
```

---

## FASE 3 — Libretto fronte/retro + OCR combinato

### Task 3.1: `extractLibrettoAction` a due file (OCR combinato)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`
- Test: `apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts`

**Interfaces:**
- Produces: `extractLibrettoAction(fronte: FileRef, retro: FileRef): Promise<ExtractLibrettoResult>` (firma a due file).

- [ ] **Step 1: Test parser su testo combinato**

In `libretto-parser.test.ts` aggiungi un caso che simula l'OCR concatenato (fronte con (E)/(D.2), retro con etichetta di trasferimento). Esempio:
```ts
describe('parseLibrettoText — testo combinato fronte+retro', () => {
  const fronte = `(A) FW248XP
(D.2) A1 DGTEXOAC4 FM6FM62S0347CP1CA
(E) WVGZZZA1ZKV096161
(C.2.1) NOLEGGIO AUTO ITALIA
SPA
(12345678903)`;
  const retro = `SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2) proprietario del veicolo
*** TRASFERIMENTO DI PROPRIETA' ***
/19.09.2017
NATO IL 12.12.1975 A MILANO
PROPRIETARIO ROSSI MARA
-MI (RSSMRA80A01F205X)`;
  const r = parseLibrettoText(`${fronte}\n${retro}`, 0.9);
  it('telaio da (E) del fronte', () => {
    expect(r.telaio).toBe('WVGZZZA1ZKV096161');
  });
  it('proprietario dall’etichetta del retro (override C.2.1)', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARA');
    expect(r.proprietarioCf).toBe('RSSMRA80A01F205X');
  });
});
```

- [ ] **Step 2: Verifica che passino già (parser invariato)**

Run: `npx vitest run src/lib/providers/ocr/libretto-parser.test.ts`
Expected: PASS — il parser gestisce già il testo combinato (questo test blinda il contratto della concatenazione).

- [ ] **Step 3: `extractLibrettoAction` a due file**

In `actions.ts`, cambia la firma e il corpo:
```ts
export async function extractLibrettoAction(
  fronte: FileRef,
  retro: FileRef,
): Promise<ExtractLibrettoResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  for (const [ref, label] of [[fronte, 'fronte'], [retro, 'retro']] as const) {
    if (!ref?.key || ref.size === 0) return { ok: false, error: `File libretto ${label} mancante` };
    if (ref.size > MAX_LIBRETTO_BYTES) return { ok: false, error: 'File troppo grande (max 10 MB)' };
  }
  // OCR di entrambi i lati → testo concatenato → parser unico.
  const ocr = await getOcr();
  const attemptExtract = async (): Promise<AttemptResult> => {
    try {
      const tFronte = (await ocr.extractText({ buffer: await storageGetBuffer(fronte.key), mimeType: fronte.type, originalFilename: fronte.name })).text;
      const tRetro = (await ocr.extractText({ buffer: await storageGetBuffer(retro.key), mimeType: retro.type, originalFilename: retro.name })).text;
      const data = parseLibrettoText(`${tFronte}\n${tRetro}`, 1);
      return { ok: true, data };
    } catch (e) {
      // (mantieni la stessa gestione retry/transient già presente)
      ...
    }
  };
  ...
}
```
Mantieni la logica retry/transient esistente, applicandola all'estrazione combinata. (Se l'attuale `extractLibrettoAction` usa `ocr.extractLibretto(input)`, sostituiscila con due `extractText` + `parseLibrettoText` come sopra; importa `parseLibrettoText` da `@/lib/providers/ocr/libretto-parser`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errori SOLO nei chiamanti (wizard) → risolti in Task 3.2.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts
git commit -m "feat(pratiche): extractLibrettoAction OCR combinato fronte+retro"
```

### Task 3.2: Wizard — libretto fronte/retro + OCR trigger

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

**Interfaces:**
- Consumes: `extractLibrettoAction(fronte, retro)` (Task 3.1).

- [ ] **Step 1: Stato veicolo con due slot libretto**

Nel tipo `VeicoloInput`, sostituisci lo slot singolo `libretto` con `librettoFronte`/`librettoRetro` (BlobSlot) — oppure aggiungi `librettoRetro` mantenendo `libretto` come fronte (meno refactor; scegli una sola convenzione e applicala a `veicoloForStorage`, default, gate). Aggiorna `EMPTY`/default veicolo e `veicoloForStorage`.

- [ ] **Step 2: Due UploadCard libretto per veicolo**

Nella sezione veicolo (step 1) rendi due `UploadCard` (Fronte/Retro) collegate allo scanner (`useDocumentScanner`), come per la CI. Entrambe passano per l'editor (immagini e ora PDF).

- [ ] **Step 3: OCR quando entrambi presenti**

L'OCR libretto (oggi su upload singolo) si attiva quando **fronte e retro** hanno la BlobRef. Chiama `extractLibrettoAction(fronteRef, retroRef)`; pre-fill come oggi. Re-OCR se cambia un file (invalidando il pre-fill OCR del veicolo). Gestisci lo stato `extracting`/`ocrError` per veicolo come ora.

- [ ] **Step 4: Gate e submit**

`mancanzeStep1`/gate: il veicolo richiede fronte **e** retro (+ OCR riuscito). In `handleFinalSubmit` invia `LIBRETTO_<i+1>_FRONTE` e `LIBRETTO_<i+1>_RETRO` al posto di `LIBRETTO_<i+1>`.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json` poi `npx eslint src/app/pratiche/nuova/wizard.tsx`
Expected: nessun errore.

- [ ] **Step 6: Verifica manuale**

Wizard step 1: due card libretto per veicolo; carico fronte+retro (anche da PDF, ritagliando ciascun lato); l'OCR pre-compila targa/telaio/proprietario combinando i due lati (etichetta retro che prevale).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): libretto fronte/retro nel wizard + OCR combinato"
```

### Task 3.3: Server — raccolta + persistenza libretto fronte/retro

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

- [ ] **Step 1: Raccolta slot libretto F/R per veicolo**

Dove oggi si raccoglie `LIBRETTO_<i>` per ciascun veicolo (validazione presenza + dimensione), raccogli `LIBRETTO_<i>_FRONTE` e `LIBRETTO_<i>_RETRO` (entrambi obbligatori; stesso check `size`/MIME/limite). Mantieni il mapping per-veicolo (ordine 1..n).

- [ ] **Step 2: Persistenza due Documento per veicolo**

Nella creazione documenti del veicolo, crea due `Documento`: `LIBRETTO_CIRCOLAZIONE` (fronte) e `LIBRETTO_CIRCOLAZIONE_RETRO` (retro), entrambi con `veicoloId` del veicolo (come oggi per il libretto singolo).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: nessun errore.

- [ ] **Step 4: Verifica manuale (con DB)**

Invia una pratica: nel dettaglio compaiono "Libretto circolazione" + "Libretto (retro)" per ciascun veicolo; il proprietario riflette l'etichetta del retro quando presente.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): libretto fronte/retro lato server (raccolta + persistenza)"
```

---

## Self-Review

- **Spec coverage:** A (PDF editor) → Task 1.1/1.2. B (workflow carica-due-volte) → riuso editor su entrambi gli slot (nessun task dedicato: è il comportamento esistente esteso ai PDF). C (patente F/R) → Task 2.1-2.3. D (libretto F/R + OCR combinato) → Task 3.1-3.3. E (schema/enum) → Task 2.1. F (validazione) → Task 2.2/3.2 (gate) + 2.3/3.3 (server). Tutto coperto.
- **Placeholder scan:** i punti "adegua all'attuale forma del codice" si riferiscono a pattern già esistenti e citati (CI fronte/retro, raccolta LIBRETTO_<i>); ogni task indica file, firme e codice nuovo. Nessun TODO/TBD.
- **Type consistency:** `extractLibrettoAction(fronte, retro)` (3.1) ↔ chiamata wizard (3.2). Enum `PATENTE_RETRO`/`LIBRETTO_CIRCOLAZIONE_RETRO` definiti in 2.1 e usati in 2.3/3.3 e nelle label. Slot `LIBRETTO_<i>_FRONTE/_RETRO` e `*_ID_FRONTE/_RETRO` coerenti tra wizard (submit) e server (collect).
- **Note:** la migration unica (2.1) introduce entrambi i valori enum per evitare due migration; la Fase 3 fa solo plumbing.
