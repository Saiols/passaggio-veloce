# P1 · Gating documentale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere la "killer feature" del gating documentale: hard-block pre-invio su documenti FAILED, fallback manuale su OCR fallito, download ZIP della pratica e job di purge documenti/bozze.

**Architecture:** Logica pura isolata in `lib/**` (testabile senza prisma, pattern del repo), integrata nelle server action / route esistenti. Nessuna nuova dipendenza salvo `jszip` per lo ZIP in-memory (serverless-friendly come `pdf-lib`). Tutte le migrazioni evitate (il flag OCR manuale va nello snapshot JSON `ocrData`).

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/Postgres, Vitest, `jszip`.

Spec di riferimento: `docs/superpowers/specs/2026-06-01-completamenti-locali-design.md` (§P1).

## File Structure

- Create `apps/piattaforma/src/lib/documenti/gating-block.ts` — funzione pura `findBlockingDocuments`.
- Create `apps/piattaforma/src/lib/documenti/gating-block.test.ts` — test.
- Modify `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — pre-check hard-block + flag `ocrManuale`.
- Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — pulsante "Inserisci manualmente" + invio flag.
- Create `apps/piattaforma/src/lib/documenti/zip.ts` — `buildPraticaZip` (pura) + `streamToBuffer`.
- Create `apps/piattaforma/src/lib/documenti/zip.test.ts` — test.
- Create `apps/piattaforma/src/app/api/pratiche/[id]/zip/route.ts` — endpoint download ZIP.
- Modify `apps/piattaforma/src/app/pratiche/[id]/page.tsx:172-177` — cabla pulsante "Scarica ZIP".
- Create `apps/piattaforma/src/lib/documenti/retention.ts` — costanti + `cutoffDate` (pura).
- Create `apps/piattaforma/src/lib/documenti/retention.test.ts` — test.
- Create `apps/piattaforma/src/lib/jobs/purge-deleted-documenti.ts` — job purge.
- Create `apps/piattaforma/src/app/api/jobs/purge-deleted-documenti/route.ts` — route job.
- Modify `apps/piattaforma/vercel.json` — cron entry.

---

### Task 1: `findBlockingDocuments` (pura)

**Files:**
- Create: `apps/piattaforma/src/lib/documenti/gating-block.ts`
- Test: `apps/piattaforma/src/lib/documenti/gating-block.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/piattaforma/src/lib/documenti/gating-block.test.ts
import { describe, it, expect } from 'vitest';
import { findBlockingDocuments } from './gating-block';

describe('findBlockingDocuments', () => {
  const ok = {
    owner: 'venditore' as const,
    tipo: 'CODICE_FISCALE',
    mimeType: 'application/pdf',
    sizeBytes: 200 * 1024,
    originalFilename: 'cf.pdf',
  };

  it('returns empty when all documents pass', () => {
    expect(findBlockingDocuments([ok])).toEqual([]);
  });

  it('flags a document with unsupported MIME', () => {
    const blocking = findBlockingDocuments([{ ...ok, mimeType: 'application/zip' }]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].owner).toBe('venditore');
    expect(blocking[0].tipo).toBe('CODICE_FISCALE');
    expect(blocking[0].reason).toContain('Formato');
  });

  it('flags a file too small and keeps the passing ones out', () => {
    const blocking = findBlockingDocuments([ok, { ...ok, tipo: 'CI_FRONTE', sizeBytes: 100 }]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].tipo).toBe('CI_FRONTE');
  });

  it('returns empty for an empty input list', () => {
    expect(findBlockingDocuments([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma test -- gating-block`
Expected: FAIL — `findBlockingDocuments` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/piattaforma/src/lib/documenti/gating-block.ts
import { classifyDocumento } from './classifier';

export type GatingCandidate = {
  owner: 'venditore' | 'acquirente';
  tipo: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

export type BlockingDocument = {
  owner: 'venditore' | 'acquirente';
  tipo: string;
  reason: string;
};

/**
 * Dato l'elenco dei documenti di parte allegati alla pratica, restituisce
 * quelli che NON passano il gating rule-based (classifyDocumento → FAILED).
 * Se la lista è vuota, il submit può procedere. Funzione pura: nessun I/O.
 */
export function findBlockingDocuments(
  candidates: readonly GatingCandidate[],
): BlockingDocument[] {
  const blocking: BlockingDocument[] = [];
  for (const c of candidates) {
    const res = classifyDocumento({
      tipo: c.tipo,
      mimeType: c.mimeType,
      sizeBytes: c.sizeBytes,
      originalFilename: c.originalFilename,
    });
    if (res.stato === 'FAILED') {
      blocking.push({ owner: c.owner, tipo: c.tipo, reason: res.reason });
    }
  }
  return blocking;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma test -- gating-block`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/documenti/gating-block.ts apps/piattaforma/src/lib/documenti/gating-block.test.ts
git commit -m "feat(gating): findBlockingDocuments pure helper + test"
```

---

### Task 2: Hard-block pre-invio in `submitNuovaPraticaAction`

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

Contesto: oggi i documenti di parte sono classificati e creati DOPO `avviaRound1ForPratica` (righe 452-501), quindi un FAILED non blocca nulla. Spostiamo un **pre-check** prima della creazione della pratica (subito dopo i controlli `esitoSchema`, riga ~299). Riusa `findBlockingDocuments` e gli stessi nomi campo `${owner}_${docTipo}` già usati nel loop esistente (righe 454-464).

- [ ] **Step 1: Add the import**

Aggiungi accanto agli import esistenti (dopo riga 13 `classifyDocumento`):

```ts
import { findBlockingDocuments, type GatingCandidate } from '@/lib/documenti/gating-block';
```

- [ ] **Step 2: Insert the pre-check block**

Subito dopo il blocco `if (esitoSchema.kind === 'INPUT_INCOMPLETO') { ... }` (riga ~299) e PRIMA del commento `// Pricing derivato...` (riga ~301), inserisci:

```ts
  // P1.1 — Hard-block pre-invio: classifica i documenti di parte allegati e
  // blocca il submit se almeno uno NON passa il gating rule-based. L'override
  // admin resta la valvola di sfogo post-submit (qui i FAILED non vengono mai
  // creati). Stessi nomi campo del loop di persistenza più sotto.
  const PARTY_DOC_TIPI = [
    'CI_FRONTE',
    'CI_RETRO',
    'CODICE_FISCALE',
    'PROCURA',
    'VISURA_CAMERALE',
    'PERMESSO_SOGGIORNO',
  ] as const;
  const gatingCandidates: GatingCandidate[] = [];
  for (const owner of ['venditore', 'acquirente'] as const) {
    for (const docTipo of PARTY_DOC_TIPI) {
      const f = formData.get(`${owner}_${docTipo}`);
      if (!(f instanceof File) || f.size === 0) continue;
      gatingCandidates.push({
        owner,
        tipo: docTipo,
        mimeType: f.type,
        sizeBytes: f.size,
        originalFilename: f.name,
      });
    }
  }
  const blocking = findBlockingDocuments(gatingCandidates);
  if (blocking.length > 0) {
    const summary = blocking
      .map((b) => `${b.owner} ${b.tipo}: ${b.reason}`)
      .join(' | ');
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        `Documenti non validi, ricaricali prima di inviare — ${summary}`,
      )}`,
    );
  }
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS (nessun errore di tipo; `GatingCandidate` e `findBlockingDocuments` risolti).

- [ ] **Step 4: Manual verification note**

La verifica funzionale (submit con file < 30 KB → redirect con errore, niente pratica creata) è coperta dall'E2E in P7. Per ora basta il typecheck verde.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(gating): hard-block pre-invio pratica su documenti FAILED"
```

---

### Task 3: Fallback manuale OCR fallito (wizard) + flag audit

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

Contesto: in `wizard.tsx` lo state `ocr` (riga 141) resta `null` su errore OCR, quindi i campi editabili (`{ocr && (...)}`, riga ~499) non compaiono e il broker è bloccato. Aggiungiamo, sotto l'Alert `ocrError` (righe 493-499), un pulsante che inizializza `ocr` vuoto e abilita l'inserimento manuale, marcando un flag.

- [ ] **Step 1: Add manual-mode state**

Accanto a `const [ocrError, setOcrError] = useState<string | null>(null);` (riga 140), aggiungi:

```tsx
  const [ocrManuale, setOcrManuale] = useState(false);
```

- [ ] **Step 2: Add the "Inserisci manualmente" button under the error Alert**

Sostituisci il blocco dell'Alert errore (righe ~493-499):

```tsx
              {ocrError && (
                <div className="mt-4">
                  <Alert variant="error">{ocrError}</Alert>
                </div>
              )}
```

con:

```tsx
              {ocrError && (
                <div className="mt-4 space-y-3">
                  <Alert variant="error">{ocrError}</Alert>
                  {!ocr && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setOcr({
                          targa: '',
                          telaio: '',
                          proprietarioAttuale: '',
                          dataImmatricolazione: '',
                          preImm2015: false,
                          flagComodatoDuso: false,
                        });
                        setOcrManuale(true);
                        setOcrError(null);
                      }}
                    >
                      Inserisci i dati manualmente
                    </Button>
                  )}
                </div>
              )}
```

> Nota: se il tipo `Ocr` (riga ~36) ha campi aggiuntivi oltre a quelli sopra, inizializzali al loro valore vuoto/`false` coerente. I 6 campi elencati sono quelli letti dal submit (righe 257-262).

- [ ] **Step 3: Append the manual flag in handleSubmit**

Nel builder FormData del submit (dopo riga 262 `fd.append('flagComodatoDuso', ...)`), aggiungi:

```tsx
    fd.append('ocrManuale', ocrManuale ? 'true' : 'false');
```

- [ ] **Step 4: Record the flag in the libretto document (actions.ts)**

In `submitNuovaPraticaAction`, nel costruire `ocrSnapshot` (righe ~425-432), aggiungi la lettura del flag prima e includilo nello snapshot; poi imposta `ocrStato` di conseguenza nella `prisma.documento.create` del libretto (riga ~444).

Sostituisci:

```ts
  const ocrSnapshot: Prisma.InputJsonValue = {
    targa: d.targa,
    telaio: d.telaio,
    proprietarioAttuale: d.proprietarioAttuale,
    dataImmatricolazione: d.dataImmatricolazione,
    preImm2015: d.preImm2015,
    flagComodatoDuso: d.flagComodatoDuso,
  };
```

con:

```ts
  const ocrManuale = formData.get('ocrManuale') === 'true';
  const ocrSnapshot: Prisma.InputJsonValue = {
    targa: d.targa,
    telaio: d.telaio,
    proprietarioAttuale: d.proprietarioAttuale,
    dataImmatricolazione: d.dataImmatricolazione,
    preImm2015: d.preImm2015,
    flagComodatoDuso: d.flagComodatoDuso,
    ocrManuale,
  };
```

E nella create del libretto sostituisci `ocrStato: 'SUCCESS',` con:

```ts
      ocrStato: ocrManuale ? 'NONE' : 'SUCCESS',
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(ocr): fallback inserimento manuale su OCR fallito + flag audit ocrManuale"
```

---

### Task 4: ZIP builder puro + `streamToBuffer` + dipendenza jszip

**Files:**
- Create: `apps/piattaforma/src/lib/documenti/zip.ts`
- Test: `apps/piattaforma/src/lib/documenti/zip.test.ts`
- Modify: `apps/piattaforma/package.json` (via pnpm add)

- [ ] **Step 1: Add the jszip dependency**

Run: `pnpm --filter piattaforma add jszip`
Expected: `jszip` compare in `apps/piattaforma/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// apps/piattaforma/src/lib/documenti/zip.test.ts
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { buildPraticaZip, streamToBuffer, zipEntryName } from './zip';

describe('streamToBuffer', () => {
  it('drains a Readable into a single Buffer', async () => {
    const stream = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    const buf = await streamToBuffer(stream);
    expect(buf.toString()).toBe('hello world');
  });
});

describe('zipEntryName', () => {
  it('builds a readable name with owner and extension', () => {
    expect(
      zipEntryName({ tipo: 'CI_FRONTE', owner: 'VENDITORE', originalFilename: 'scan.jpg' }, 0),
    ).toBe('1-CI_FRONTE-VENDITORE.jpg');
  });

  it('omits owner when null and defaults extension to bin', () => {
    expect(
      zipEntryName({ tipo: 'LIBRETTO_CIRCOLAZIONE', owner: null, originalFilename: 'libretto' }, 2),
    ).toBe('3-LIBRETTO_CIRCOLAZIONE.bin');
  });
});

describe('buildPraticaZip', () => {
  it('produces a zip containing all entries', async () => {
    const buf = await buildPraticaZip([
      { name: 'a.txt', buffer: Buffer.from('AAA') },
      { name: 'b.txt', buffer: Buffer.from('BBB') },
    ]);
    const parsed = await JSZip.loadAsync(buf);
    expect(Object.keys(parsed.files).sort()).toEqual(['a.txt', 'b.txt']);
    expect(await parsed.files['a.txt'].async('string')).toBe('AAA');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter piattaforma test -- zip`
Expected: FAIL — module `./zip` not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// apps/piattaforma/src/lib/documenti/zip.ts
import type { Readable } from 'node:stream';
import JSZip from 'jszip';

export type ZipEntry = { name: string; buffer: Buffer };

/** Drena un Node Readable in un unico Buffer. */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Estrae l'estensione dal filename originale (fallback "bin"). */
function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return 'bin';
  return filename.slice(dot + 1).toLowerCase();
}

/** Nome leggibile dell'entry zip: "<n>-<tipo>[-<owner>].<ext>". */
export function zipEntryName(
  doc: { tipo: string; owner: string | null; originalFilename: string },
  index: number,
): string {
  const ext = extOf(doc.originalFilename);
  const ownerPart = doc.owner ? `-${doc.owner}` : '';
  return `${index + 1}-${doc.tipo}${ownerPart}.${ext}`;
}

/** Costruisce uno zip in-memory dalle entry. Pura (no I/O). */
export async function buildPraticaZip(entries: readonly ZipEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const e of entries) {
    zip.file(e.name, e.buffer);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter piattaforma test -- zip`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/documenti/zip.ts apps/piattaforma/src/lib/documenti/zip.test.ts apps/piattaforma/package.json pnpm-lock.yaml
git commit -m "feat(documenti): zip builder puro + streamToBuffer + jszip dep"
```

---

### Task 5: Endpoint `GET /api/pratiche/[id]/zip`

**Files:**
- Create: `apps/piattaforma/src/app/api/pratiche/[id]/zip/route.ts`

Riusa il pattern auth/ownership di `api/documenti/[id]/route.ts` (broker owner / agenzia assegnata / admin) e gli helper di Task 4.

- [ ] **Step 1: Write the route**

```ts
// apps/piattaforma/src/app/api/pratiche/[id]/zip/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { buildPraticaZip, streamToBuffer, zipEntryName, type ZipEntry } from '@/lib/documenti/zip';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pratica = await prisma.pratica.findUnique({
    where: { id },
    select: {
      id: true,
      codicePratica: true,
      brokerId: true,
      agenziaAssegnataId: true,
      documenti: {
        where: { deletedAt: null },
        select: {
          id: true,
          tipo: true,
          owner: true,
          storageKey: true,
          originalFilename: true,
        },
      },
    },
  });

  if (!pratica) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const userCompanyId = session.user.companyId;
  const allowed =
    isAdmin ||
    (pratica.brokerId && pratica.brokerId === userCompanyId) ||
    (pratica.agenziaAssegnataId && pratica.agenziaAssegnataId === userCompanyId);

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (pratica.documenti.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  const storage = getStorage();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < pratica.documenti.length; i++) {
    const doc = pratica.documenti[i];
    try {
      const file = await storage.get(doc.storageKey);
      const buffer = await streamToBuffer(file.stream);
      entries.push({ name: zipEntryName(doc, i), buffer });
    } catch (err) {
      if (err instanceof StorageNotFoundError) continue; // salta file mancanti
      throw err;
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 404 });
  }

  const zipBuffer = await buildPraticaZip(entries);
  const filename = `${pratica.codicePratica ?? pratica.id}.zip`;
  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  headers.set('Content-Length', String(zipBuffer.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(zipBuffer), { headers });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/api/pratiche/[id]/zip/route.ts
git commit -m "feat(documenti): endpoint download ZIP pratica con auth ownership"
```

---

### Task 6: Cabla il pulsante "Scarica ZIP"

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx:172-177`

- [ ] **Step 1: Replace the placeholder link**

Sostituisci (righe ~172-177):

```tsx
            <Link
              href="#"
              className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
            >
              Scarica ZIP
            </Link>
```

con (mostra il bottone solo se ci sono documenti; usa `<a>` per scaricare dal route):

```tsx
            {pratica.documenti.length > 0 && (
              <a
                href={`/api/pratiche/${pratica.id}/zip`}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Scarica ZIP
              </a>
            )}
```

> Nota: `pratica.documenti` è già caricato in pagina (usato a riga ~331). Se `Link` non è più usato altrove nel file, rimuovi l'import per evitare il warning lint.

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm --filter piattaforma lint && pnpm --filter piattaforma typecheck`
Expected: PASS (nessun import inutilizzato).

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/[id]/page.tsx
git commit -m "feat(documenti): cabla pulsante Scarica ZIP all'endpoint reale"
```

---

### Task 7: Retention — costanti + `cutoffDate` (pura)

**Files:**
- Create: `apps/piattaforma/src/lib/documenti/retention.ts`
- Test: `apps/piattaforma/src/lib/documenti/retention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/piattaforma/src/lib/documenti/retention.test.ts
import { describe, it, expect } from 'vitest';
import { cutoffDate, DOC_HARD_DELETE_DAYS, BOZZA_PURGE_DAYS } from './retention';

describe('retention constants', () => {
  it('uses 90gg per documenti e 30gg per bozze', () => {
    expect(DOC_HARD_DELETE_DAYS).toBe(90);
    expect(BOZZA_PURGE_DAYS).toBe(30);
  });
});

describe('cutoffDate', () => {
  it('returns now minus N days', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(cutoffDate(30, now).toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma test -- retention`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/piattaforma/src/lib/documenti/retention.ts
/** Giorni dopo cui un Documento soft-deleted viene hard-deleted. */
export const DOC_HARD_DELETE_DAYS = 90;

/** Giorni dopo cui una Pratica in BOZZA non finalizzata viene purgata (§0.5). */
export const BOZZA_PURGE_DAYS = 30;

/** Data di taglio = `now - days`. Pura (now iniettabile per i test). */
export function cutoffDate(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma test -- retention`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/documenti/retention.ts apps/piattaforma/src/lib/documenti/retention.test.ts
git commit -m "feat(retention): costanti retention + cutoffDate puro"
```

---

### Task 8: Job purge documenti + bozze

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/purge-deleted-documenti.ts`

Pattern preso da `lib/jobs/purge-deleted-team-users.ts`. Hard-delete dei `Documento` con `deletedAt` oltre i 90gg (rimuovendo anche il file su storage), e annullamento delle `Pratica` BOZZA più vecchie di 30gg con i loro documenti.

- [ ] **Step 1: Write the implementation**

```ts
// apps/piattaforma/src/lib/jobs/purge-deleted-documenti.ts
import 'server-only';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { cutoffDate, DOC_HARD_DELETE_DAYS, BOZZA_PURGE_DAYS } from '@/lib/documenti/retention';

const BATCH_SIZE = 100;

export type PurgeDeletedDocumentiResult = {
  documentiHardDeleted: number;
  bozzePurged: number;
};

/**
 * 1) Hard-delete dei Documento con `deletedAt < now - 90gg`: rimuove il file
 *    dallo storage (best-effort) e la riga DB.
 * 2) Purga le Pratica in BOZZA con `updatedAt < now - 30gg` (mai finalizzate):
 *    elimina prima i documenti collegati (file + riga), poi la pratica.
 * Idempotente e batched.
 */
export async function purgeDeletedDocumenti(
  now: Date = new Date(),
): Promise<PurgeDeletedDocumentiResult> {
  const storage = getStorage();

  // 1) Documenti soft-deleted oltre retention
  const docCutoff = cutoffDate(DOC_HARD_DELETE_DAYS, now);
  const staleDocs = await prisma.documento.findMany({
    where: { deletedAt: { lt: docCutoff, not: null } },
    select: { id: true, storageKey: true },
    take: BATCH_SIZE,
  });
  let documentiHardDeleted = 0;
  for (const doc of staleDocs) {
    try {
      await storage.delete(doc.storageKey);
    } catch (err) {
      if (!(err instanceof StorageNotFoundError)) throw err;
    }
    await prisma.documento.delete({ where: { id: doc.id } });
    documentiHardDeleted++;
  }

  // 2) Bozze pratica mai finalizzate
  const bozzaCutoff = cutoffDate(BOZZA_PURGE_DAYS, now);
  const staleBozze = await prisma.pratica.findMany({
    where: { stato: 'BOZZA', updatedAt: { lt: bozzaCutoff } },
    select: {
      id: true,
      documenti: { select: { id: true, storageKey: true } },
    },
    take: BATCH_SIZE,
  });
  let bozzePurged = 0;
  for (const bozza of staleBozze) {
    for (const doc of bozza.documenti) {
      try {
        await storage.delete(doc.storageKey);
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err;
      }
    }
    await prisma.$transaction([
      prisma.documento.deleteMany({ where: { praticaId: bozza.id } }),
      prisma.pratica.delete({ where: { id: bozza.id } }),
    ]);
    bozzePurged++;
  }

  return { documentiHardDeleted, bozzePurged };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

> Nota: se `Documento` ha relazioni figlie che bloccano la `delete` (FK), la `deleteMany` sui documenti della bozza va prima della delete pratica — già così nella transazione. Se compaiono errori FK su altre relazioni della Pratica (es. `PraticaAssegnazione`), una BOZZA non finalizzata non ne ha (gli round si aprono solo dopo submit completo), quindi non serve cascaddare oltre.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/lib/jobs/purge-deleted-documenti.ts
git commit -m "feat(jobs): purge documenti soft-deleted 90gg + bozze 30gg"
```

---

### Task 9: Route job + cron

**Files:**
- Create: `apps/piattaforma/src/app/api/jobs/purge-deleted-documenti/route.ts`
- Modify: `apps/piattaforma/vercel.json`

- [ ] **Step 1: Write the route**

```ts
// apps/piattaforma/src/app/api/jobs/purge-deleted-documenti/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { purgeDeletedDocumenti } from '@/lib/jobs/purge-deleted-documenti';
import { requireAdminOrCron } from '@/lib/jobs/auth';

async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await purgeDeletedDocumenti();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
```

- [ ] **Step 2: Add the cron entry**

In `apps/piattaforma/vercel.json`, aggiungi nell'array `crons` (dopo l'ultima entry, prima della chiusura `]`):

```json
    {
      "path": "/api/jobs/purge-deleted-documenti",
      "schedule": "30 3 * * *"
    }
```

(`30 3 * * *` = 03:30, sfalsato dal purge team-users delle 03:00.)

- [ ] **Step 3: Validate JSON + typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS. Verifica che `vercel.json` resti JSON valido (virgola dopo l'entry precedente).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/api/jobs/purge-deleted-documenti/route.ts apps/piattaforma/vercel.json
git commit -m "feat(jobs): route + cron purge documenti/bozze (03:30)"
```

---

### Task 10: Full test suite + checkpoint

- [ ] **Step 1: Run the whole unit suite**

Run: `pnpm --filter piattaforma test`
Expected: PASS (suite esistente + nuovi test gating-block/zip/retention).

- [ ] **Step 2: Typecheck + lint complessivi**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: PASS.

- [ ] **Step 3: Manual smoke (locale)**

Avvia l'app, crea una pratica con un documento di parte < 30 KB → atteso blocco con messaggio. Carica un documento valido → submit OK. Su pratica con documenti, click "Scarica ZIP" → scarica `PV-...zip` apribile. Forza un errore OCR (file non-libretto) → compare "Inserisci i dati manualmente" e si prosegue.

---

## Self-Review

**Spec coverage (§P1):**
- P1.1 hard-block → Task 1 (pura) + Task 2 (integrazione). ✓
- P1.2 fallback OCR → Task 3. ✓
- P1.3 download ZIP → Task 4 (builder) + Task 5 (route) + Task 6 (UI). ✓
- P1.4 retention/purge → Task 7 (costanti) + Task 8 (job) + Task 9 (route+cron). ✓

**Placeholder scan:** nessun TBD/TODO; ogni step di codice ha il blocco completo.

**Type consistency:** `findBlockingDocuments`/`GatingCandidate` (Task 1) usati identici in Task 2; `buildPraticaZip`/`streamToBuffer`/`zipEntryName`/`ZipEntry` (Task 4) usati identici in Task 5; `cutoffDate`/`DOC_HARD_DELETE_DAYS`/`BOZZA_PURGE_DAYS` (Task 7) usati identici in Task 8. `classifyDocumento` riusato senza modifica.

**Note di rischio:** la delete delle bozze assume che una Pratica BOZZA non abbia `PraticaAssegnazione` (vero: gli round si aprono solo a submit completo). Se in futuro le bozze persistono assegnazioni, estendere la transazione.
