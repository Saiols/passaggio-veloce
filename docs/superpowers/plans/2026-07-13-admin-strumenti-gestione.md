# Strumenti di gestione admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'admin di piattaforma tre strumenti che oggi mancano: scaricare i documenti aziendali di broker/agenzie, isolare a colpo d'occhio le fatture non ancora emesse allo SdI, e filtrare la lista pratiche con gli stessi tab che hanno broker e agenzia.

**Architecture:** Nessuna migration: i dati esistono già. Tre interventi indipendenti, ognuno costruito sopra una fonte unica già presente nel codebase (`lib/documenti/zip.ts`, `lib/fatturazione/filtri.ts`, `lib/pratiche/stati.ts`) estesa invece che duplicata. I tab sono link `GET` server-side sullo stesso search param del filtro, come in `/pratiche`: niente stato client.

**Tech Stack:** Next.js App Router (Server Components), Prisma, Vitest, JSZip, Tailwind (design system PV).

## Global Constraints

- **Nessuna migration.** Se un task sembra richiederne una, fermati: hai sbagliato strada.
- ⚠️ **Node NON gira su Git Bash.** Test/lint/typecheck/build SOLO da PowerShell, con il path di Node in testa:
  `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma <cmd>`
  Il package si chiama **`piattaforma`** (non `@pv/piattaforma`).
- ⚠️ **PowerShell 5.1 corrompe le lettere accentate** quando riscrive un file. Usa gli strumenti di edit (Edit/Write), mai `Out-File`/`Set-Content` su file con accenti.
- ⚠️ **Test verdi NON implicano typecheck verde**: vitest non fa typecheck. Lancia **sempre anche** `typecheck`, mai solo i test.
- **Typecheck**: affidabile solo a cache calda (col `tsbuildinfo`). A cache fredda dà falsi errori Prisma / stack overflow: se è la prima esecuzione, rilancia prima di trarre conclusioni.
- **Test**: `pnpm --filter piattaforma test -- <path>`. Un test che non è mai stato rosso non dimostra nulla: esegui sempre lo step "verifica che fallisca".
- **Colori**: solo token del design system (`pv-navy-*`, `pv-slate-*`, `pv-red-*`, `pv-amber-*`/`pv-green-*` se esistono — verifica in `globals.css` prima di usarli, mai hex hardcoded).
- **Scope Prisma**: filtri e scope si compongono con `{ AND: [...] }`, **mai** con lo spread `{ ...scope, ...filtri }` (sovrascriverebbe l'`AND` dello scope: leak). Vincolo già documentato in `lib/fatturazione/filtri.ts:47-56`.
- **Query nuove**: prima di chiudere una feature, esegui le query nuove in read-only sul Postgres locale (i test mockano Prisma). Connessione: `docker exec -i <container> psql -U pv -d passaggio_veloce`.

---

## File Structure

**Feature 1 — Documenti aziendali**
- Modify: `apps/piattaforma/src/lib/documenti/zip.ts` — estrae `buildDocumentiZip` generico; `buildPraticaZip` diventa un alias.
- Create: `apps/piattaforma/src/app/api/admin/companies/[id]/documenti-zip/route.ts` — ZIP dei documenti aziendali + mandato.
- Create: `apps/piattaforma/src/app/admin/companies/[id]/documenti-aziendali.tsx` — la sezione (Server Component).
- Modify: `apps/piattaforma/src/app/admin/companies/[id]/page.tsx` — include i documenti nella query + rende la sezione.
- **Non** si tocca `lib/pratiche/access.ts` (vedi spec: l'Assistente è già bloccato lato API).

**Feature 2 — Fatture da emettere**
- Create: `apps/piattaforma/src/lib/fatturazione/emissione.ts` — fonte unica dei tre stati.
- Create: `apps/piattaforma/src/lib/fatturazione/emissione.test.ts`
- Modify: `apps/piattaforma/src/lib/fatturazione/filtri.ts` — `emissione` nei filtri condivisi (si propaga a lista, CSV, ZIP).
- Create: `apps/piattaforma/src/components/ui/stato-emissione-chip.tsx` + export dal barrel.
- Create: `apps/piattaforma/src/app/admin/fatturazione/tabs.tsx`
- Modify: `apps/piattaforma/src/app/admin/fatturazione/page.tsx` — tab + colonna Stato.
- Modify: `apps/piattaforma/src/app/fatturazione/page.tsx` — sostituisce il testo "Gestito/In attesa" col chip.

**Feature 3 — Tab pratiche admin**
- Modify: `apps/piattaforma/src/lib/pratiche/stati.ts` — `SINGOLI_ADMIN`, `whereStato(param, ammessi)`, `escalation` nei conteggi.
- Modify: `apps/piattaforma/src/lib/pratiche/stati.test.ts`
- Modify: `apps/piattaforma/src/lib/pratiche/tabs.ts` — `basePath` + `tabsPraticheAdmin`.
- Modify: `apps/piattaforma/src/app/pratiche/tabs.tsx` — prop `basePath`.
- Modify: `apps/piattaforma/src/app/admin/pratiche/page.tsx` — tab, paginazione, via il sort in memoria.

---

## Task 1: `buildDocumentiZip` generico

Oggi `lib/documenti/zip.ts` espone solo `buildPraticaZip`, che di "pratica" non ha nulla — è un builder di zip. Va **rinominato** `buildDocumentiZip` e i call site aggiornati. Niente alias: un secondo nome per la stessa funzione è indirezione morta, e il rename è meccanico (2 call site).

**Files:**
- Modify: `apps/piattaforma/src/lib/documenti/zip.ts:30`
- Modify: `apps/piattaforma/src/app/api/pratiche/[id]/zip/route.ts` (call site)
- Modify: `apps/piattaforma/src/app/api/pratiche/documenti-zip/route.ts` (call site)
- Test: `apps/piattaforma/src/lib/documenti/zip.test.ts` (creare se non esiste)

**Interfaces:**
- Produces: `buildDocumentiZip(entries: readonly ZipEntry[]): Promise<Buffer>` — usato dal Task 2.
- `buildPraticaZip` **non esiste più**: nessun riferimento residuo deve restare nel codice.

- [ ] **Step 1: Scrivi il test**

Se `zip.test.ts` esiste già, aggiungi solo il `describe` nuovo.

```ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildDocumentiZip } from './zip';

describe('buildDocumentiZip', () => {
  it('impacchetta le entry con nome e contenuto', async () => {
    const buf = await buildDocumentiZip([
      { name: 'Rossi Srl - CI fronte.jpg', buffer: Buffer.from('aaa') },
      { name: 'Rossi Srl - Visura camerale.pdf', buffer: Buffer.from('bbb') },
    ]);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual([
      'Rossi Srl - CI fronte.jpg',
      'Rossi Srl - Visura camerale.pdf',
    ]);
    expect(await zip.file('Rossi Srl - CI fronte.jpg')!.async('string')).toBe('aaa');
  });

  it('uno zip senza entry non esplode', async () => {
    const zip = await JSZip.loadAsync(await buildDocumentiZip([]));
    expect(Object.keys(zip.files)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run (da PowerShell, vedi Global Constraints): `pnpm --filter piattaforma test -- src/lib/documenti/zip.test.ts`
Expected: FAIL — `buildDocumentiZip` non è esportato.

- [ ] **Step 3: Rinomina**

In `apps/piattaforma/src/lib/documenti/zip.ts`, rinomina `buildPraticaZip` (riga 30) in `buildDocumentiZip`. Il corpo non cambia. Aggiorna il commento:

```ts
/** Costruisce uno zip in-memory dalle entry. Pura (no I/O). */
export async function buildDocumentiZip(entries: readonly ZipEntry[]): Promise<Buffer> {
```

- [ ] **Step 4: Aggiorna i call site**

Run: `grep -rn "buildPraticaZip" apps/piattaforma/src`
Aspettati due route (`api/pratiche/[id]/zip/route.ts`, `api/pratiche/documenti-zip/route.ts`). Aggiorna import e chiamata in entrambe. Rilancia il grep: **zero** occorrenze residue.

- [ ] **Step 5: Verifica che passi**

Run: `pnpm --filter piattaforma test -- src/lib/documenti/` e `pnpm --filter piattaforma typecheck`
Expected: test PASS, typecheck exit 0. Se il typecheck lamenta `buildPraticaZip`, un call site è rimasto indietro.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/documenti apps/piattaforma/src/app/api/pratiche
git commit -m "refactor(documenti): buildPraticaZip -> buildDocumentiZip (non e' specifico delle pratiche)"
```

---

## Task 2: Route ZIP dei documenti aziendali

**Files:**
- Create: `apps/piattaforma/src/app/api/admin/companies/[id]/documenti-zip/route.ts`

**Interfaces:**
- Consumes: `buildDocumentiZip` (Task 1), `documentoDownloadName` (`lib/documenti/labels.ts:63`), `storageGetBuffer` (`lib/providers/storage/index.ts:40`).
- Produces: `GET /api/admin/companies/[id]/documenti-zip` — usata dalla UI del Task 3.

**Contesto necessario:**
- I documenti aziendali sono `Documento` con `companyId` valorizzato e `praticaId` null (mutuamente esclusivi, verificato sul DB).
- Il mandato è un modello a parte, `MandatoFatturazione` (relazione 1-1 su `Company`), con `storageKey` valorizzato solo se firmato.
- `documentoDownloadName(doc, { codicePratica })` produce `"<codicePratica> - <label tipo>.<ext>"`. Passandogli la ragione sociale al posto del codice pratica si ottiene `"Rossi Srl - CI fronte.jpg"` — è il riuso giusto, e `appendToFilename` (`lib/documenti/filename.ts:9`) sanifica già i caratteri vietati.
- Guard: `isAdminPiattaforma` (**non** `isAdminOrAssistente`). Vedi spec.

- [ ] **Step 1: Scrivi la route**

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { storageGetBuffer } from '@/lib/providers/storage';
import { documentoDownloadName } from '@/lib/documenti/labels';
import { buildDocumentiZip, type ZipEntry } from '@/lib/documenti/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ZIP di tutti i documenti di un'azienda: i documenti KYC caricati in
 * registrazione (CI, codice fiscale, visura) più il PDF del mandato di
 * fatturazione, se firmato.
 *
 * Solo ADMIN_PIATTAFORMA: sono documenti d'identità del legale rappresentante.
 * L'Assistente è già negato da `canAccessDocumento` sul download singolo
 * (api/documenti/[id]/route.ts:50) — qui la stessa regola, esplicita.
 *
 * Un file mancante nello storage NON fa fallire lo zip: si scarica ciò che c'è
 * (un blob perso non deve rendere irraggiungibili gli altri documenti).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdminPiattaforma(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    select: {
      ragioneSociale: true,
      deletedAt: true,
      documenti: {
        where: { deletedAt: null, praticaId: null },
        orderBy: { createdAt: 'asc' },
        select: { tipo: true, owner: true, originalFilename: true, storageKey: true },
      },
      mandatoFatturazione: {
        select: { storageKey: true, firmatoAt: true },
      },
    },
  });

  if (!company || company.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const entries: ZipEntry[] = [];

  for (const [i, doc] of company.documenti.entries()) {
    const buffer = await storageGetBuffer(doc.storageKey).catch(() => null);
    if (!buffer) continue;
    entries.push({
      name: documentoDownloadName(doc, { codicePratica: company.ragioneSociale, index: i }),
      buffer,
    });
  }

  const mandato = company.mandatoFatturazione;
  if (mandato?.storageKey) {
    const buffer = await storageGetBuffer(mandato.storageKey).catch(() => null);
    if (buffer) {
      entries.push({ name: `${company.ragioneSociale} - Mandato fatturazione.pdf`, buffer });
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  const zip = await buildDocumentiZip(entries);
  const giorno = new Date().toISOString().slice(0, 10);
  const filename = `${company.ragioneSociale} - documenti - ${giorno}.zip`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  headers.set('Content-Length', String(zip.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(zip), { headers });
}
```

- [ ] **Step 2: Verifica la firma di `storageGetBuffer`**

Run: `grep -n "storageGetBuffer" -A 6 apps/piattaforma/src/lib/providers/storage/index.ts`
Expected: una funzione `(storageKey: string) => Promise<Buffer>`. Se la firma differisce (es. prende un oggetto), adegua la chiamata — **non** inventare un helper nuovo. Guarda anche come la usa `api/pratiche/[id]/zip/route.ts`, che è il precedente da imitare.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore nei file toccati. (Se è la prima esecuzione a cache fredda, ignora i falsi errori Prisma e rilancia.)

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/api/admin/companies
git commit -m "feat(admin): route ZIP documenti aziendali (KYC + mandato)"
```

---

## Task 3: Sezione "Documenti aziendali" nella scheda azienda

**Files:**
- Create: `apps/piattaforma/src/app/admin/companies/[id]/documenti-aziendali.tsx`
- Modify: `apps/piattaforma/src/app/admin/companies/[id]/page.tsx:25-46` (query) e il body (render)

**Interfaces:**
- Consumes: la route del Task 2; `labelDocumentoTipo` (`lib/documenti/labels.ts:41`); `formatDate` (`lib/format`); `Card` (`components/ui`).
- Produces: `<DocumentiAziendali company={...} />`

- [ ] **Step 1: Crea il componente**

```tsx
import Link from 'next/link';
import { Card } from '@/components/ui';
import { labelDocumentoTipo } from '@/lib/documenti/labels';
import { formatDate } from '@/lib/format';

type Doc = {
  id: string;
  tipo: string;
  sizeBytes: number;
  createdAt: Date;
};

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Documenti KYC dell'azienda (CI, codice fiscale, visura), caricati in
 * registrazione. Esistono da sempre come righe `Documento` con `companyId`, ma
 * finora nessuna pagina ne esponeva gli id: di fatto erano irraggiungibili.
 *
 * Riservata ad ADMIN_PIATTAFORMA: `/api/documenti/[id]` nega già l'Assistente
 * (documenti d'identità del legale rappresentante), quindi mostrargli i bottoni
 * significherebbe solo prometter loro dei 403.
 */
export function DocumentiAziendali({
  companyId,
  documenti,
}: {
  companyId: string;
  documenti: Doc[];
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold text-pv-navy-900">Documenti aziendali</h2>
          <p className="mt-0.5 text-[12px] text-pv-slate-500">
            Caricati in registrazione. Il mandato firmato, se presente, è incluso nello ZIP.
          </p>
        </div>
        {documenti.length > 0 && (
          <a
            href={`/api/admin/companies/${companyId}/documenti-zip`}
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Scarica tutti (ZIP)
          </a>
        )}
      </div>

      {documenti.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-pv-slate-500">
          Nessun documento caricato. Le aziende registrate prima del KYC non ne hanno.
        </p>
      ) : (
        <ul className="divide-y divide-pv-slate-100">
          {documenti.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-pv-navy-800">
                  {labelDocumentoTipo(d.tipo)}
                </p>
                <p className="text-[12px] text-pv-slate-500">
                  {formatDate(d.createdAt)} · {formatKb(d.sizeBytes)}
                </p>
              </div>
              <Link
                href={`/api/documenti/${d.id}`}
                className="shrink-0 rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Scarica
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Aggiungi i documenti alla query della pagina**

In `apps/piattaforma/src/app/admin/companies/[id]/page.tsx`, dentro l'`include` (righe 27-45), aggiungi:

```ts
      documenti: {
        where: { deletedAt: null, praticaId: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, tipo: true, sizeBytes: true, createdAt: true },
      },
```

- [ ] **Step 3: Rendi la sezione**

Aggiungi l'import in testa al file:

```ts
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { DocumentiAziendali } from './documenti-aziendali';
```

(`isAdminOrAssistente` resta importato: serve alla guard della pagina alla riga 23.)

Poi, subito **dopo** la sezione del mandato (che finisce a `page.tsx:213`) e **prima** della lista utenti (`:215`), inserisci:

```tsx
        {isAdminPiattaforma(session.user.role) && (
          <DocumentiAziendali companyId={company.id} documenti={company.documenti} />
        )}
```

Se le sezioni sono dentro un contenitore con spaziatura (es. `space-y-*`), la sezione va dentro lo stesso contenitore — non aggiungere wrapper.

- [ ] **Step 4: Verifica nel browser**

Avvia l'app (`pnpm dev`), fai login come admin di piattaforma (vedi la memoria "Credenziali dev locali": le password del seed NON valgono, il DB locale è copia di prod).

Naviga su `/admin/companies/<id>` di un'azienda che ha documenti. Sul DB locale, trovane una:

```bash
docker exec -i <container> psql -U pv -d passaggio_veloce -c \
  "SELECT c.id, c.\"ragioneSociale\", count(d.id) FROM companies c JOIN documenti d ON d.\"companyId\" = c.id AND d.\"deletedAt\" IS NULL GROUP BY 1,2;"
```

Attesi: 4 righe (CI fronte, CI retro, Codice fiscale, Visura camerale) con data e peso. **Clicca davvero** "Scarica" su una riga e "Scarica tutti (ZIP)" — non limitarti a navigare per URL: il file deve arrivare e il nome deve essere `<Ragione Sociale> - <tipo>.<ext>`. Apri lo ZIP e verifica che contenga i 4 file.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/admin/companies
git commit -m "feat(admin): sezione documenti aziendali con download singolo e ZIP"
```

---

## Task 4: Fonte unica dello stato di emissione

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/emissione.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/emissione.test.ts`

**Interfaces:**
- Produces:
  - `type StatoEmissione = 'DA_EMETTERE' | 'EMESSA' | 'FUORI_SDI'`
  - `statoEmissione(doc: { fatturaPaTipo: FatturaPaTipo | null; trasmessoSdiAt: Date | null }): StatoEmissione`
  - `whereEmissione(param: string | undefined): Prisma.DocumentoFiscaleWhereInput | undefined`
  - `labelEmissione(s: StatoEmissione): string`
- Usato da: Task 5 (filtri), 6 (chip), 7 (lista admin), 8 (lista broker).

**Il punto che conta:** `trasmessoSdiAt IS NULL` **non** significa "da emettere". `fatturaPaTipo` è `null` quando il documento non deve andare allo SdI — `DOC_BROKER` di un broker in regime PRIVATO, e `PENALE_BROKER` (fuori campo IVA, clausola 10.4b dei Termini). Vedi `lib/fatturazione/calcolo.ts:31-47`. Contarli tra i "da emettere" manderebbe il commercialista a emettere documenti che non devono esistere.

Il nome `StatoEmissione` è scelto per non collidere con `StatoSdi`, già esportato da `lib/fatturazione/provider/types.ts` con tutt'altro significato.

- [ ] **Step 1: Scrivi il test**

```ts
import { describe, it, expect } from 'vitest';
import { statoEmissione, whereEmissione, labelEmissione } from './emissione';

const T = new Date('2026-07-01T10:00:00Z');

describe('statoEmissione', () => {
  it('documento SdI non ancora trasmesso → DA_EMETTERE', () => {
    expect(statoEmissione({ fatturaPaTipo: 'TD01', trasmessoSdiAt: null })).toBe('DA_EMETTERE');
  });

  it('documento trasmesso → EMESSA', () => {
    expect(statoEmissione({ fatturaPaTipo: 'TD01', trasmessoSdiAt: T })).toBe('EMESSA');
  });

  // Il caso che giustifica l'esistenza di questo modulo: senza il terzo stato,
  // un doc broker in regime PRIVATO (o una penale) finirebbe tra i "da emettere"
  // e il commercialista emetterebbe un documento fuori campo IVA.
  it('fatturaPaTipo null → FUORI_SDI, non DA_EMETTERE', () => {
    expect(statoEmissione({ fatturaPaTipo: null, trasmessoSdiAt: null })).toBe('FUORI_SDI');
  });

  // Combinazione che il write path non produce (nessun percorso marca trasmesso
  // un documento fuori campo). Se un giorno accadesse, "emesso" è il fatto
  // osservato e vince sulla classificazione teorica: meglio mostrarlo emesso che
  // riproporlo eternamente da emettere.
  it('fuori SdI ma marcato trasmesso → EMESSA (il fatto vince)', () => {
    expect(statoEmissione({ fatturaPaTipo: null, trasmessoSdiAt: T })).toBe('EMESSA');
  });
});

describe('whereEmissione', () => {
  it('DA_EMETTERE esclude i documenti fuori campo SdI', () => {
    expect(whereEmissione('DA_EMETTERE')).toEqual({
      fatturaPaTipo: { not: null },
      trasmessoSdiAt: null,
    });
  });

  it('EMESSA filtra sui trasmessi', () => {
    expect(whereEmissione('EMESSA')).toEqual({ trasmessoSdiAt: { not: null } });
  });

  it('param assente o non riconosciuto → nessun filtro', () => {
    expect(whereEmissione(undefined)).toBeUndefined();
    expect(whereEmissione('PIPPO')).toBeUndefined();
  });
});

describe('labelEmissione', () => {
  it('etichette in italiano', () => {
    expect(labelEmissione('DA_EMETTERE')).toBe('Da emettere');
    expect(labelEmissione('EMESSA')).toBe('Emessa');
    expect(labelEmissione('FUORI_SDI')).toBe('Fuori campo SdI');
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `pnpm --filter piattaforma test -- src/lib/fatturazione/emissione.test.ts`
Expected: FAIL — il modulo `./emissione` non esiste.

- [ ] **Step 3: Implementa**

```ts
import type { Prisma, FatturaPaTipo } from '@pv/db';

/**
 * Stato di emissione di un documento fiscale. NON è uno stato del DB: la
 * piattaforma non trasmette allo SdI (lo fa il commercialista, fuori
 * piattaforma) e tiene solo il flag di tracciamento `trasmessoSdiAt`, alzato a
 * mano dall'admin (app/fatturazione/actions.ts:19).
 *
 * Tre stati, non due: `fatturaPaTipo` è `null` quando il documento NON deve
 * finire allo SdI (calcolo.ts:31-47) — DOC_BROKER di un broker in regime
 * PRIVATO e PENALE_BROKER, fuori campo IVA ex art. 15 D.P.R. 633/1972
 * (clausola 10.4b dei Termini). Trattarli come "da emettere" manderebbe il
 * commercialista a emettere documenti che non devono esistere.
 *
 * Non confondere con `StatoSdi` (provider/types.ts): quello è lo stato di
 * trasmissione restituito da un provider, oggi codice non raggiunto.
 */
export type StatoEmissione = 'DA_EMETTERE' | 'EMESSA' | 'FUORI_SDI';

export function statoEmissione(doc: {
  fatturaPaTipo: FatturaPaTipo | null;
  trasmessoSdiAt: Date | null;
}): StatoEmissione {
  if (doc.trasmessoSdiAt) return 'EMESSA';
  if (doc.fatturaPaTipo == null) return 'FUORI_SDI';
  return 'DA_EMETTERE';
}

const LABEL: Record<StatoEmissione, string> = {
  DA_EMETTERE: 'Da emettere',
  EMESSA: 'Emessa',
  FUORI_SDI: 'Fuori campo SdI',
};

export function labelEmissione(s: StatoEmissione): string {
  return LABEL[s];
}

/**
 * Clausola Prisma del filtro `?emissione=`. Un valore non riconosciuto (URL
 * manomesso) non filtra nulla, come in `whereStato`: meglio mostrare tutto che
 * mostrare una lista vuota inspiegabile.
 *
 * `FUORI_SDI` non è filtrabile: non è una coda di lavoro, è una constatazione.
 * Quei documenti restano visibili in "Tutte", col loro chip.
 */
export function whereEmissione(
  param: string | undefined,
): Prisma.DocumentoFiscaleWhereInput | undefined {
  if (param === 'DA_EMETTERE') return { fatturaPaTipo: { not: null }, trasmessoSdiAt: null };
  if (param === 'EMESSA') return { trasmessoSdiAt: { not: null } };
  return undefined;
}
```

- [ ] **Step 4: Verifica che passi**

Run: `pnpm --filter piattaforma test -- src/lib/fatturazione/emissione.test.ts`
Expected: PASS (tutti).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/emissione.ts apps/piattaforma/src/lib/fatturazione/emissione.test.ts
git commit -m "feat(fatturazione): fonte unica dello stato di emissione (3 stati, non 2)"
```

---

## Task 5: `emissione` nei filtri condivisi

`lib/fatturazione/filtri.ts` è la fonte unica usata da lista admin, lista broker, export CSV (`api/admin/fatturazione/export`) e ZIP (`api/fatturazione/zip`). Aggiungendo il filtro qui, si propaga a tutti: quello che vedi è quello che scarichi.

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/filtri.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/filtri.test.ts` (creare se non esiste)

**Interfaces:**
- Consumes: `whereEmissione` (Task 4).
- Produces: `FatturaFiltri` guadagna `emissione: StatoEmissione | null`; `parseFatturaFiltri` legge `?emissione=`; `fatturaFiltriToQuery` lo riemette.

- [ ] **Step 1: Scrivi il test**

```ts
import { describe, it, expect } from 'vitest';
import { parseFatturaFiltri, fatturaWhereFiltri, fatturaFiltriToQuery } from './filtri';

describe('filtro emissione', () => {
  it('parse legge ?emissione=', () => {
    expect(parseFatturaFiltri({ emissione: 'DA_EMETTERE' }).emissione).toBe('DA_EMETTERE');
    expect(parseFatturaFiltri({ emissione: 'PIPPO' }).emissione).toBeNull();
    expect(parseFatturaFiltri({}).emissione).toBeNull();
  });

  it('il where esclude i documenti fuori campo SdI dai "da emettere"', () => {
    const w = fatturaWhereFiltri(parseFatturaFiltri({ emissione: 'DA_EMETTERE' }));
    expect(w).toEqual({
      AND: [{ fatturaPaTipo: { not: null }, trasmessoSdiAt: null }],
    });
  });

  // Il vincolo del modulo: filtri e scope si compongono con AND. Se il filtro
  // emissione finisse fuori dall'array AND, un domani uno spread lo perderebbe.
  it('si combina con gli altri filtri dentro lo stesso AND', () => {
    const w = fatturaWhereFiltri(parseFatturaFiltri({ emissione: 'EMESSA', tipo: 'FATTURA_PV' }));
    expect(w.AND).toHaveLength(2);
  });

  it('round-trip: query → parse → query', () => {
    const f = parseFatturaFiltri({ emissione: 'DA_EMETTERE', q: 'PV-2026' });
    expect(fatturaFiltriToQuery(f)).toContain('emissione=DA_EMETTERE');
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `pnpm --filter piattaforma test -- src/lib/fatturazione/filtri.test.ts`
Expected: FAIL — `emissione` non esiste su `FatturaFiltri` (errore TS a runtime vitest o assert su `undefined`).

- [ ] **Step 3: Implementa**

In `apps/piattaforma/src/lib/fatturazione/filtri.ts`:

Import in testa:

```ts
import { whereEmissione, type StatoEmissione } from './emissione';
```

Nel tipo `FatturaFiltri` (riga 16), aggiungi il campo:

```ts
  emissione: StatoEmissione | null;
```

In `parseFatturaFiltri` (riga 29), aggiungi `emissione?: string` al tipo del parametro `sp` e, nell'oggetto ritornato:

```ts
    emissione:
      sp.emissione === 'DA_EMETTERE' || sp.emissione === 'EMESSA'
        ? sp.emissione
        : null,
```

(`FUORI_SDI` volutamente non è un valore di filtro: vedi il commento in `emissione.ts`.)

In `fatturaWhereFiltri` (riga 57), dopo `if (f.tipo) and.push({ tipo: f.tipo });`:

```ts
  const wEmissione = whereEmissione(f.emissione ?? undefined);
  if (wEmissione) and.push(wEmissione);
```

In `fatturaFiltriToQuery` (riga 90), prima del `return`:

```ts
  if (f.emissione) p.set('emissione', f.emissione);
```

- [ ] **Step 4: Verifica che passi**

Run: `pnpm --filter piattaforma test -- src/lib/fatturazione/`
Expected: PASS. Se esistevano già test su `filtri.ts`, devono restare verdi (il campo nuovo è additivo).

- [ ] **Step 5: Verifica i consumer**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore. `parseFatturaFiltri` è chiamata dalle route CSV/ZIP con `sp` grezzi: il campo nuovo è opzionale in input, quindi non rompe.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/filtri.ts apps/piattaforma/src/lib/fatturazione/filtri.test.ts
git commit -m "feat(fatturazione): filtro ?emissione= nei filtri condivisi (lista, CSV, ZIP)"
```

---

## Task 6: Chip dello stato di emissione

**Files:**
- Create: `apps/piattaforma/src/components/ui/stato-emissione-chip.tsx`
- Modify: `apps/piattaforma/src/components/ui/index.ts`

**Interfaces:**
- Consumes: `statoEmissione`, `labelEmissione` (Task 4), `cn` (`components/ui/cn`).
- Produces: `<StatoEmissioneChip doc={{ fatturaPaTipo, trasmessoSdiAt }} className? />`

- [ ] **Step 1: Verifica i token di colore disponibili**

Run: `grep -n "pv-amber\|pv-green\|pv-emerald" apps/piattaforma/src/app/globals.css | head`

Se non esistono token ambra/verde, usa quelli presenti nel design system (guarda `StatusChip` in `components/ui/status-chip.tsx:22`, che mappa già stati a classi: riusa le sue famiglie). **Non introdurre colori hardcoded.** Sostituisci le classi qui sotto con quelle vere prima di procedere.

- [ ] **Step 2: Crea il chip**

```tsx
import type { FatturaPaTipo } from '@pv/db';
import { statoEmissione, labelEmissione } from '@/lib/fatturazione/emissione';
import { cn } from './cn';

/**
 * Stato di emissione di un documento fiscale. Tre valori, non due: "Fuori campo
 * SdI" (grigio) NON è un'omissione da sanare, è un documento che per legge non
 * va allo SdI — mostrarlo come "da emettere" farebbe emettere al commercialista
 * documenti che non devono esistere. Vedi lib/fatturazione/emissione.ts.
 */
const STYLE: Record<ReturnType<typeof statoEmissione>, string> = {
  DA_EMETTERE: 'bg-pv-amber-100 text-pv-amber-800',
  EMESSA: 'bg-pv-green-100 text-pv-green-800',
  FUORI_SDI: 'bg-pv-slate-100 text-pv-slate-600',
};

export function StatoEmissioneChip({
  doc,
  className,
}: {
  doc: { fatturaPaTipo: FatturaPaTipo | null; trasmessoSdiAt: Date | null };
  className?: string;
}) {
  const stato = statoEmissione(doc);
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        STYLE[stato],
        className,
      )}
    >
      {labelEmissione(stato)}
    </span>
  );
}
```

- [ ] **Step 3: Esporta dal barrel**

In `apps/piattaforma/src/components/ui/index.ts`, dopo la riga 24 (`export { TipoPraticaChip }`):

```ts
export { StatoEmissioneChip } from './stato-emissione-chip';
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter piattaforma typecheck`

```bash
git add apps/piattaforma/src/components/ui
git commit -m "feat(ui): StatoEmissioneChip (da emettere / emessa / fuori campo SdI)"
```

---

## Task 7: Tab + colonna Stato nella lista fatture admin

**Files:**
- Create: `apps/piattaforma/src/app/admin/fatturazione/tabs.tsx`
- Modify: `apps/piattaforma/src/app/admin/fatturazione/page.tsx`

**Interfaces:**
- Consumes: `fatturaFiltriToQuery`, `parseFatturaFiltri`, `fatturaWhereFiltri` (Task 5); `whereEmissione` (Task 4); `StatoEmissioneChip` (Task 6).

**Il trucco dei conteggi** (lo stesso di `/pratiche`, `page.tsx:145-149`): i numeri sui tab devono nascere da un `whereBase` che contiene tutti i filtri **tranne** `emissione`, altrimenti ogni tab mostrerebbe il proprio numero e "Da emettere: 3" sarebbe vero solo dopo averci cliccato sopra.

- [ ] **Step 1: Crea il componente tab**

```tsx
import Link from 'next/link';

export type TabFattura = { value: '' | 'DA_EMETTERE' | 'EMESSA'; label: string; count: number };

/**
 * Tab della lista fatture: `<Link>` GET sullo stesso `?emissione=` dei filtri,
 * nessuno stato client (stesso pattern di app/pratiche/tabs.tsx).
 */
export function FattureTabs({
  tabs,
  attivo,
  queryBase,
}: {
  tabs: TabFattura[];
  attivo: string;
  /** Query-string degli altri filtri attivi, da preservare (senza `emissione`). */
  queryBase: string;
}) {
  const href = (value: string): string => {
    const qs = new URLSearchParams(queryBase);
    qs.delete('emissione');
    if (value) qs.set('emissione', value);
    const s = qs.toString();
    return s ? `/admin/fatturazione?${s}` : '/admin/fatturazione';
  };

  return (
    <nav
      aria-label="Filtri rapidi fatture"
      className="mb-3 flex flex-wrap gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
    >
      {tabs.map((t) => {
        const selezionato = attivo === t.value;
        return (
          <Link
            key={t.value || 'tutte'}
            href={href(t.value)}
            aria-current={selezionato ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[13px] font-semibold transition ${
              selezionato
                ? 'bg-pv-navy-800 text-white'
                : 'text-pv-slate-600 hover:bg-pv-slate-50 hover:text-pv-navy-800'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                selezionato ? 'bg-white/20 text-white' : 'bg-pv-slate-100 text-pv-slate-600'
              }`}
            >
              {t.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Modifica la pagina — searchParams e conteggi**

In `apps/piattaforma/src/app/admin/fatturazione/page.tsx`:

Import da aggiungere:

```ts
import { StatoEmissioneChip } from '@/components/ui';
import { whereEmissione } from '@/lib/fatturazione/emissione';
import { FattureTabs, type TabFattura } from './tabs';
```

Nel tipo di `searchParams` (righe 27-33), aggiungi `emissione?: string;`.

Sostituisci le righe 50-51:

```ts
  const filtri = parseFatturaFiltri(sp);
  const where: Prisma.DocumentoFiscaleWhereInput = fatturaWhereFiltri(filtri);
```

con:

```ts
  const filtri = parseFatturaFiltri(sp);
  const where: Prisma.DocumentoFiscaleWhereInput = fatturaWhereFiltri(filtri);

  // I conteggi dei tab usano gli STESSI filtri della lista MENO l'emissione: il
  // numero sul tab è esattamente quello che ottieni cliccandolo. Con `where`
  // (che include l'emissione) ogni tab mostrerebbe il proprio numero.
  const whereBase: Prisma.DocumentoFiscaleWhereInput = fatturaWhereFiltri({
    ...filtri,
    emissione: null,
  });
```

- [ ] **Step 3: Modifica la pagina — le query**

Sostituisci il blocco `const docs = await prisma.documentoFiscale.findMany({...})` (righe 60-68) e il `kpi` (71-76) con un unico `Promise.all` che aggiunge i due conteggi:

```ts
  const [docs, kpi, countDaEmettere, countEmesse, countTutte] = await Promise.all([
    prisma.documentoFiscale.findMany({
      where,
      orderBy: { emessoAt: 'desc' },
      take: 100,
      include: {
        pratica: { select: { id: true, codicePratica: true, agenziaSede: sedeSelect, brokerSede: sedeSelect } },
        payout: { select: { wallet: { select: { sede: sedeSelect } } } },
      },
    }),
    // KPI (rispetta i filtri correnti). Dati documentali; la P&L definitiva è del commercialista.
    prisma.documentoFiscale.groupBy({
      by: ['tipo'],
      where,
      _count: { _all: true },
      _sum: { imponibileCent: true, ivaCent: true, importoLordoCent: true },
    }),
    prisma.documentoFiscale.count({
      where: { AND: [whereBase, whereEmissione('DA_EMETTERE')!] },
    }),
    prisma.documentoFiscale.count({
      where: { AND: [whereBase, whereEmissione('EMESSA')!] },
    }),
    prisma.documentoFiscale.count({ where: whereBase }),
  ]);

  const tabs: TabFattura[] = [
    { value: '', label: 'Tutte', count: countTutte },
    { value: 'DA_EMETTERE', label: 'Da emettere', count: countDaEmettere },
    { value: 'EMESSA', label: 'Emesse', count: countEmesse },
  ];
  // Query-string degli altri filtri, per i link dei tab.
  const queryBase = fatturaFiltriToQuery({ ...filtri, emissione: null });
```

`exportQs` (riga 81) resta com'è: usa `filtri` completo, quindi lo ZIP e il CSV ereditano anche il filtro emissione. È voluto.

- [ ] **Step 4: Modifica la pagina — render dei tab e della colonna**

Subito **prima** del `<form ... action="/admin/fatturazione">` (riga 132), inserisci:

```tsx
        <FattureTabs tabs={tabs} attivo={filtri.emissione ?? ''} queryBase={queryBase} />
```

Nel `<thead>`, dopo `<th ...>Tipo</th>` (riga 211), aggiungi:

```tsx
                    <th className="whitespace-nowrap px-3 py-2.5">Stato</th>
```

Nel `<tbody>`, dopo la `<td>` del tipo (riga 231), aggiungi:

```tsx
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <StatoEmissioneChip doc={d} />
                        </td>
```

Nel `<form>`, aggiungi un campo nascosto perché il filtro emissione non venga perso quando si applica un altro filtro (il form fa un GET e riscrive tutti i parametri):

```tsx
          {filtri.emissione && <input type="hidden" name="emissione" value={filtri.emissione} />}
```

E nella condizione del bottone "Azzera" (riga 189) aggiungi `|| filtri.emissione`.

- [ ] **Step 5: Prova le query sul DB reale**

I test mockano Prisma: le due `count` con `AND` vanno provate davvero.

```bash
docker exec -i <container> psql -U pv -d passaggio_veloce -c \
  "SELECT count(*) FILTER (WHERE \"fatturaPaTipo\" IS NOT NULL AND \"trasmessoSdiAt\" IS NULL) AS da_emettere,
          count(*) FILTER (WHERE \"trasmessoSdiAt\" IS NOT NULL) AS emesse,
          count(*) AS tutte
   FROM documenti_fiscali;"
```

Atteso sul DB locale (copia di prod): `da_emettere = 12`, `emesse = 0`, `tutte = 12`.

- [ ] **Step 6: Verifica nel browser**

Login come admin, vai su `/admin/fatturazione`. Attesi: tre tab con `Tutte 12 · Da emettere 12 · Emesse 0`, e ogni riga con il chip ambra "Da emettere". **Clicca** il tab "Da emettere" (non navigare per URL) e verifica che la lista resti coerente e che il tab risulti selezionato. Applica anche un filtro di tipo e verifica che il tab non venga perso.

Poi prova il ciclo completo: apri una fattura, premi "Segna come trasmesso", torna in lista — quella riga deve passare a "Emessa" (verde) e i conteggi devono diventare 11/1.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/admin/fatturazione
git commit -m "feat(admin): tab Da emettere/Emesse e chip di stato nella lista fatture"
```

---

## Task 8: Chip anche nella lista broker/agenzia

La lista `/fatturazione` mostra oggi un testo grezzo "Gestito / In attesa" (`page.tsx:306`), che per di più ignora il caso fuori campo SdI.

**Files:**
- Modify: `apps/piattaforma/src/app/fatturazione/page.tsx:305-307`

- [ ] **Step 1: Sostituisci il testo col chip**

Import in testa (nel gruppo `@/components/ui` già presente, oppure una riga nuova):

```ts
import { StatoEmissioneChip } from '@/components/ui';
```

Sostituisci:

```tsx
                <td className={`${TD} text-[12px] text-pv-slate-500`}>
                  {d.trasmessoSdiAt ? 'Gestito' : 'In attesa'}
                </td>
```

con:

```tsx
                <td className={TD}>
                  <StatoEmissioneChip doc={d} />
                </td>
```

- [ ] **Step 2: Verifica che il `select`/`include` porti `fatturaPaTipo`**

Il chip legge `fatturaPaTipo` e `trasmessoSdiAt`. Se la query della pagina usa un `select` esplicito che non include `fatturaPaTipo`, il typecheck fallisce — aggiungilo. Se usa `include`/nessun select, i campi ci sono già.

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 3: Verifica nel browser**

Login come **broker** (non admin) e apri `/fatturazione`: le righe devono mostrare il chip, non più il testo. Le etichette cambiano da "In attesa" a "Da emettere": è voluto e coerente con l'admin.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/fatturazione/page.tsx
git commit -m "feat(fatturazione): chip di stato anche nella lista broker/agenzia"
```

---

## Task 9: `SINGOLI_ADMIN` e conteggio escalation

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/stati.ts`
- Modify: `apps/piattaforma/src/lib/pratiche/stati.test.ts`

**Interfaces:**
- Produces:
  - `SINGOLI_ADMIN: readonly PraticaStato[]`
  - `whereStato(param: string | undefined, ammessi?: readonly PraticaStato[])` — il secondo parametro è opzionale e default `SINGOLI`, quindi i call site esistenti (`app/pratiche/page.tsx:130`) non cambiano.
  - `ConteggiTab` guadagna `escalation: number`.

**La trappola da non calpestare:** oggi `/admin/pratiche` filtra con un match esatto (`page.tsx:54`), quindi `IN_ESCALATION`, `IN_ATTESA_ROUND_1/2/3` **funzionano**. Passare a `whereStato` senza `SINGOLI_ADMIN` li romperebbe *in silenzio*: `whereStato` ignora i valori non riconosciuti e restituisce `undefined`, cioè "nessun filtro" — la select mostrerebbe "Escalation" e la lista tutte le pratiche. Il test dello Step 1 esiste per rendere rossa questa regressione.

- [ ] **Step 1: Scrivi i test**

Aggiungi a `apps/piattaforma/src/lib/pratiche/stati.test.ts` (e aggiungi `SINGOLI_ADMIN` all'import in testa):

```ts
describe('whereStato con insieme admin', () => {
  // La regressione che questo test esiste per impedire: l'admin filtra oggi con
  // un match esatto e quindi IN_ESCALATION funziona. Passando a whereStato con
  // l'insieme di default (SINGOLI, pensato per il broker), tornerebbe undefined
  // = nessun filtro: la select direbbe "Escalation" e la lista mostrerebbe
  // tutto. Silenzioso, e quindi peggio di un errore.
  it.each(['IN_ESCALATION', 'IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3'])(
    '%s filtra davvero con SINGOLI_ADMIN (e non filtrerebbe con SINGOLI)',
    (stato) => {
      expect(whereStato(stato, SINGOLI_ADMIN)).toBe(stato);
      expect(whereStato(stato)).toBeUndefined();
    },
  );

  it('SINGOLI_ADMIN copre ogni valore dell’enum', () => {
    for (const s of TUTTI) {
      expect(SINGOLI_ADMIN).toContain(s);
    }
  });

  it('gli aggregati continuano a funzionare con l’insieme admin', () => {
    expect(whereStato('IN_CORSO', SINGOLI_ADMIN)).toEqual({ in: [...STATI_IN_CORSO] });
  });

  it('un valore non riconosciuto non filtra, nemmeno per l’admin', () => {
    expect(whereStato('PIPPO', SINGOLI_ADMIN)).toBeUndefined();
  });
});

describe('conteggio escalation', () => {
  it('escalation è un sottoinsieme di inCorso e non è sommato due volte in tutte', () => {
    const c = contaGruppi([
      { stato: 'IN_ESCALATION', _count: { _all: 2 } },
      { stato: 'ACCETTATA', _count: { _all: 3 } },
      { stato: 'BOZZA', _count: { _all: 1 } },
      { stato: 'FIRMATA', _count: { _all: 4 } },
    ]);
    expect(c.escalation).toBe(2);
    expect(c.inCorso).toBe(5); // escalation + accettata
    expect(c.bozze).toBe(1);
    expect(c.concluse).toBe(4);
    expect(c.tutte).toBe(10); // NON 12: l'escalation è già dentro inCorso
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `pnpm --filter piattaforma test -- src/lib/pratiche/stati.test.ts`
Expected: FAIL — `SINGOLI_ADMIN` non esiste, `whereStato` accetta un solo argomento, `escalation` non è su `ConteggiTab`.

- [ ] **Step 3: Implementa**

In `apps/piattaforma/src/lib/pratiche/stati.ts`:

Dopo `SINGOLI` (riga 56), aggiungi:

```ts
/**
 * Valori `?stato=` ammessi per l'ADMIN di piattaforma: tutti, inclusi i round
 * di distribuzione e l'escalation, che al broker restano nascosti (dettagli
 * interni del motore). L'unione con `STATI_IN_ATTESA` copre l'enum: lo garantisce
 * il test "cade in esattamente uno tra SINGOLI e STATI_IN_ATTESA" in stati.test.ts,
 * quindi un nuovo stato dell'enum entra qui automaticamente o rende rosso quel test.
 */
export const SINGOLI_ADMIN = [
  ...SINGOLI,
  ...STATI_IN_ATTESA,
] as const satisfies readonly PraticaStato[];
```

Sostituisci `whereStato` (righe 58-68) con:

```ts
export function whereStato(
  param: string | undefined,
  ammessi: readonly PraticaStato[] = SINGOLI,
): PraticaStato | { in: PraticaStato[] } | undefined {
  if (!param) return undefined;
  if (param === 'IN_CORSO') return { in: [...STATI_IN_CORSO] };
  if (param === 'CONCLUSE') return { in: [...STATI_CONCLUSI] };
  if (param === 'IN_ATTESA') return { in: [...STATI_IN_ATTESA] };
  if ((ammessi as readonly string[]).includes(param)) return param as PraticaStato;
  // Valore non riconosciuto (URL manomesso): nessun filtro, come se non ci fosse.
  return undefined;
}
```

Estendi `ConteggiTab` (riga 70):

```ts
export type ConteggiTab = {
  tutte: number;
  inCorso: number;
  /** Sottoinsieme di `inCorso`, non un gruppo a sé: non va sommato in `tutte`. */
  escalation: number;
  bozze: number;
  concluse: number;
};
```

E `contaGruppi` (riga 78):

```ts
export function contaGruppi(
  rows: { stato: PraticaStato; _count: { _all: number } }[],
): ConteggiTab {
  const out: ConteggiTab = { tutte: 0, inCorso: 0, escalation: 0, bozze: 0, concluse: 0 };
  for (const r of rows) {
    const n = r._count._all;
    out.tutte += n;
    if (r.stato === 'BOZZA') out.bozze += n;
    else if (isInCorso(r.stato)) out.inCorso += n;
    else out.concluse += n;
    // Trasversale, non alternativo: l'escalation è già contata in `inCorso`.
    if (r.stato === 'IN_ESCALATION') out.escalation += n;
  }
  return out;
}
```

- [ ] **Step 4: Verifica che passino**

Run: `pnpm --filter piattaforma test -- src/lib/pratiche/stati.test.ts`
Expected: PASS, inclusi i test preesistenti (l'invariante della partizione non cambia).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/stati.ts apps/piattaforma/src/lib/pratiche/stati.test.ts
git commit -m "feat(pratiche): SINGOLI_ADMIN e conteggio escalation negli stati"
```

---

## Task 10: `basePath` nei tab

I tab sono oggi inchiodati a `/pratiche` (`lib/pratiche/tabs.ts:53` e `:102`). Vanno parametrizzati per essere riusati dall'admin, invece di duplicarli.

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/tabs.ts`
- Modify: `apps/piattaforma/src/app/pratiche/tabs.tsx`
- Test: `apps/piattaforma/src/lib/pratiche/tabs.test.ts` (creare se non esiste)

**Interfaces:**
- Produces:
  - `ValoreTab` guadagna `'IN_ESCALATION'`
  - `hrefTab(value, filtri, basePath = '/pratiche')`
  - `hrefPaginaPratiche(page, filtri, basePath = '/pratiche')`
  - `tabsPraticheAdmin(conteggi: ConteggiTab): TabPratiche[]`
  - `tabAttivo` riconosce anche `'IN_ESCALATION'`
  - `<PraticheTabs ... basePath?: string />`

- [ ] **Step 1: Scrivi il test**

```ts
import { describe, it, expect } from 'vitest';
import { hrefTab, hrefPaginaPratiche, tabsPraticheAdmin, tabAttivo } from './tabs';

describe('basePath', () => {
  it('di default punta a /pratiche (comportamento invariato)', () => {
    expect(hrefTab('IN_CORSO', {})).toBe('/pratiche?stato=IN_CORSO');
    expect(hrefPaginaPratiche(2, {})).toBe('/pratiche?page=2');
  });

  it('con basePath punta alla lista admin, preservando i filtri', () => {
    expect(hrefTab('IN_ESCALATION', { q: 'AB123' }, '/admin/pratiche')).toBe(
      '/admin/pratiche?stato=IN_ESCALATION&q=AB123',
    );
    expect(hrefPaginaPratiche(3, { stato: 'BOZZA' }, '/admin/pratiche')).toBe(
      '/admin/pratiche?stato=BOZZA&page=3',
    );
  });

  it('tab "Tutte" e pagina 1 non sporcano l’URL', () => {
    expect(hrefTab('', {}, '/admin/pratiche')).toBe('/admin/pratiche');
    expect(hrefPaginaPratiche(1, {}, '/admin/pratiche')).toBe('/admin/pratiche');
  });
});

describe('tabsPraticheAdmin', () => {
  const conteggi = { tutte: 10, inCorso: 5, escalation: 2, bozze: 1, concluse: 4 };

  it('ha i cinque tab, con escalation dopo In corso', () => {
    expect(tabsPraticheAdmin(conteggi).map((t) => t.value)).toEqual([
      '',
      'IN_CORSO',
      'IN_ESCALATION',
      'BOZZA',
      'CONCLUSE',
    ]);
  });

  it('il tab escalation mostra il suo conteggio, non quello di In corso', () => {
    const t = tabsPraticheAdmin(conteggi).find((x) => x.value === 'IN_ESCALATION');
    expect(t?.count).toBe(2);
  });

  it('IN_ESCALATION accende il suo tab', () => {
    expect(tabAttivo('IN_ESCALATION')).toBe('IN_ESCALATION');
  });

  // Un filtro fine dalla select (es. R2) non accende nessun tab: mostrare "In
  // corso" attivo mentre vedi solo le R2 sarebbe fuorviante.
  it('un filtro fine non accende nessun tab', () => {
    expect(tabAttivo('IN_ATTESA_ROUND_2')).toBeNull();
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `pnpm --filter piattaforma test -- src/lib/pratiche/tabs.test.ts`
Expected: FAIL — `tabsPraticheAdmin` non esiste, `hrefTab` ignora il terzo argomento.

- [ ] **Step 3: Implementa in `lib/pratiche/tabs.ts`**

Estendi il tipo (riga 9):

```ts
export type ValoreTab = '' | 'IN_CORSO' | 'IN_ESCALATION' | 'BOZZA' | 'CONCLUSE';
```

Dopo `tabsPratiche` (riga 33), aggiungi:

```ts
/**
 * Tab della lista admin. Come quelli di broker/agenzia, più "In escalation":
 * è l'unica coda su cui l'admin deve davvero agire, e per il broker non esiste.
 *
 * `escalation` è un SOTTOINSIEME di `inCorso` (vedi ConteggiTab): i due tab si
 * sovrappongono di proposito — cliccando "In corso" vedi anche le escalation.
 */
export function tabsPraticheAdmin(conteggi: ConteggiTab): TabPratiche[] {
  return [
    { value: '', label: 'Tutte', count: conteggi.tutte },
    { value: 'IN_CORSO', label: 'In corso', count: conteggi.inCorso },
    { value: 'IN_ESCALATION', label: 'In escalation', count: conteggi.escalation },
    { value: 'BOZZA', label: 'Bozze', count: conteggi.bozze },
    { value: 'CONCLUSE', label: 'Concluse', count: conteggi.concluse },
  ];
}
```

In `tabAttivo` (riga 40), aggiungi `IN_ESCALATION` ai valori riconosciuti:

```ts
export function tabAttivo(stato: string | undefined): ValoreTab | null {
  if (!stato) return '';
  if (
    stato === 'IN_CORSO' ||
    stato === 'IN_ESCALATION' ||
    stato === 'BOZZA' ||
    stato === 'CONCLUSE'
  ) {
    return stato;
  }
  return null;
}
```

Aggiungi `basePath` a `hrefTab` (riga 46) e `hrefPaginaPratiche` (riga 94) — default `/pratiche`, così i call site esistenti non cambiano:

```ts
export function hrefTab(value: ValoreTab, filtri: FiltriTab, basePath = '/pratiche'): string {
  const qs = new URLSearchParams();
  if (value) qs.set('stato', value);
  if (filtri.q) qs.set('q', filtri.q);
  if (filtri.periodo) qs.set('periodo', filtri.periodo);
  if (filtri.sede) qs.set('sede', filtri.sede);
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
```

```ts
export function hrefPaginaPratiche(
  page: number,
  filtri: FiltriPagina,
  basePath = '/pratiche',
): string {
  const qs = new URLSearchParams();
  if (filtri.stato) qs.set('stato', filtri.stato);
  if (filtri.q) qs.set('q', filtri.q);
  if (filtri.periodo) qs.set('periodo', filtri.periodo);
  if (filtri.sede) qs.set('sede', filtri.sede);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
```

- [ ] **Step 4: Aggiungi `basePath` al componente**

In `apps/piattaforma/src/app/pratiche/tabs.tsx`, aggiungi la prop e passala a `hrefTab`:

```tsx
export function PraticheTabs({
  tabs,
  attivo,
  filtri,
  basePath = '/pratiche',
}: {
  tabs: TabPratiche[];
  /** `null` quando è attivo un filtro fine dalla select: nessun tab selezionato. */
  attivo: ValoreTab | null;
  filtri: FiltriTab;
  /** La lista admin riusa gli stessi tab su `/admin/pratiche`. */
  basePath?: string;
}) {
```

e nel `<Link>`: `href={hrefTab(t.value, filtri, basePath)}`.

- [ ] **Step 5: Verifica che passi**

Run: `pnpm --filter piattaforma test -- src/lib/pratiche/`
Expected: PASS. `/pratiche` non deve cambiare comportamento (i default coprono i call site esistenti).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/tabs.ts apps/piattaforma/src/lib/pratiche/tabs.test.ts apps/piattaforma/src/app/pratiche/tabs.tsx
git commit -m "feat(pratiche): tab parametrizzati per basePath + tabsPraticheAdmin"
```

---

## Task 11: Tab e paginazione nella lista pratiche admin

Il task che chiude il cerchio. Tre cambiamenti nella stessa pagina, perché sono lo stesso cambiamento: i tab hanno senso solo con conteggi veri, i conteggi veri rendono visibile la bugia del `take: 100`, e la paginazione è incompatibile col sort in memoria.

**Files:**
- Modify: `apps/piattaforma/src/app/admin/pratiche/page.tsx`

**Interfaces:**
- Consumes: `whereStato`, `SINGOLI_ADMIN`, `contaGruppi` (Task 9); `tabsPraticheAdmin`, `tabAttivo`, `hrefPaginaPratiche` (Task 10); `PraticheTabs` (Task 10).

**Cosa viene rimosso e perché:** la mappa `PRIORITY` (righe 29-40) e il re-sort in memoria (righe 100-108). Ordinano solo i 100 record già caricati — con la paginazione ordinerebbero *la pagina corrente*, che è peggio che non ordinare: l'utente vedrebbe le escalation "in cima" a pagina 3 senza che significhi nulla. Il tab "In escalation" fa lo stesso lavoro in modo esplicito. Va rimossa anche la stringa "escalation in cima" dall'intestazione (riga 122), che diventerebbe falsa.

- [ ] **Step 1: Riscrivi la testa del file**

Sostituisci gli import e le costanti (righe 1-42) con:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatusChip, TipoPraticaChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';
import { AdminPraticheFilters } from './filters';
import { PRATICHE_GRID, PRATICHE_TABLE_MIN_W } from '@/lib/pratiche/table-grid';
import { filtroSede, SEDE_NON_ASSEGNATA } from '@/lib/pratiche/colonna-sede';
import { opzioniSedeAgenziaTutte } from '@/lib/pratiche/opzioni-sede';
import { SedeCell } from '@/components/sede/sede-cell';
import { whereStato, SINGOLI_ADMIN, contaGruppi } from '@/lib/pratiche/stati';
import { tabsPraticheAdmin, tabAttivo, hrefPaginaPratiche } from '@/lib/pratiche/tabs';
import { PraticheTabs } from '@/app/pratiche/tabs';

const BASE_PATH = '/admin/pratiche';
const PAGE_SIZE = 15;

/**
 * Stati selezionabili dalla select. Più fini dei tab: l'admin è l'unico a vedere
 * i round di distribuzione (il broker no, sono dettagli interni del motore).
 * `whereStato` li accetta solo passando `SINGOLI_ADMIN`.
 */
const STATI: { value: string; label: string }[] = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'IN_ESCALATION', label: 'Escalation' },
  { value: 'IN_ATTESA_ROUND_1', label: 'In attesa · R1' },
  { value: 'IN_ATTESA_ROUND_2', label: 'In attesa · R2' },
  { value: 'IN_ATTESA_ROUND_3', label: 'In attesa · R3' },
  { value: 'ACCETTATA', label: 'Accettata' },
  { value: 'PROCESSATA', label: 'Processata' },
  { value: 'FIRMATA', label: 'Firmata' },
  { value: 'BOZZA', label: 'Bozza' },
  { value: 'SCADUTA', label: 'Scaduta' },
  { value: 'ANNULLATA', label: 'Annullata' },
];

type SearchParams = { q?: string; stato?: string; sede?: string; page?: string };
```

**Nota:** la mappa `PRIORITY` sparisce. Se `grep -rn "PRIORITY" apps/piattaforma/src` la trova usata altrove, fermati e segnala — qui si assume che sia locale a questo file.

- [ ] **Step 2: Riscrivi la query**

Sostituisci il corpo dalla riga 49 (`const session = await auth();`) fino alla fine del blocco `sorted` (riga 108) con:

```tsx
  const session = await auth();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.PraticaWhereInput = { deletedAt: null };

  const q = sp.q?.trim();
  if (q) {
    where.OR = [
      { codicePratica: { contains: q, mode: 'insensitive' } },
      { veicoli: { some: { targa: { contains: q, mode: 'insensitive' } } } },
      { veicoli: { some: { proprietarioAttuale: { contains: q, mode: 'insensitive' } } } },
      { comune: { contains: q, mode: 'insensitive' } },
      { broker: { ragioneSociale: { contains: q, mode: 'insensitive' } } },
      { agenziaAssegnata: { ragioneSociale: { contains: q, mode: 'insensitive' } } },
    ];
  }

  // L'admin di piattaforma non è associato a nessuna sede: nessuno scope da
  // intersecare, e le pratiche non ancora assegnate sono un filtro legittimo.
  const sediDisponibili = await opzioniSedeAgenziaTutte();
  const fSede = filtroSede({
    selezione: sp.sede,
    opzioniIds: sediDisponibili.map((o) => o.value),
    scopeIds: null,
    consentiNonAssegnata: true,
  });
  if (fSede.tipo === 'sede') where.agenziaSedeId = { in: fSede.sedeIds };
  else if (fSede.tipo === 'nonAssegnata') where.agenziaSedeId = null;

  const sediSelect = [
    { value: '', label: 'Tutte le sedi' },
    { value: SEDE_NON_ASSEGNATA, label: 'Non assegnate' },
    ...sediDisponibili,
  ];

  // `SINGOLI_ADMIN` (non il default): l'admin filtra anche per R1/R2/R3 ed
  // escalation. Col default, quei valori tornerebbero `undefined` = nessun
  // filtro, e la select mentirebbe in silenzio.
  const filtroStato = whereStato(sp.stato, SINGOLI_ADMIN);

  // I conteggi dei tab usano gli STESSI filtri della lista MENO lo stato: il
  // numero sul tab è esattamente quello che ottieni cliccandolo.
  const whereBase: Prisma.PraticaWhereInput = { ...where };
  if (filtroStato !== undefined) where.stato = filtroStato;

  const [pratiche, total, gruppi] = await Promise.all([
    prisma.pratica.findMany({
      where,
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        broker: { select: { ragioneSociale: true } },
        agenziaAssegnata: { select: { ragioneSociale: true } },
        agenziaSede: { select: { nome: true, citta: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    }),
    prisma.pratica.count({ where }),
    prisma.pratica.groupBy({ by: ['stato'], where: whereBase, _count: { _all: true } }),
  ]);

  const conteggi = contaGruppi(gruppi);
  const tabs = tabsPraticheAdmin(conteggi);
  const attivo = tabAttivo(sp.stato);
  const filtriTab = { q, sede: sp.sede };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // `?page=` fuori range: senza redirect la lista è vuota mentre intestazione e
  // pager riportano ancora i totali reali — una schermata che si contraddice.
  if (page > totalPages) {
    redirect(hrefPaginaPratiche(totalPages, { stato: sp.stato, q: sp.q, sede: sp.sede }, BASE_PATH));
  }
```

**Nota sull'ordinamento:** `orderBy` passa da `{ createdAt: 'desc' }` a `[{ submittedAt: desc nulls last }, { createdAt: desc }]`, lo stesso della lista broker. È il rimpiazzo onesto del sort in memoria: ordina *tutte* le pratiche, non le prime 100.

- [ ] **Step 3: Aggiorna il render**

Nell'intestazione, sostituisci le righe 120-123 con:

```tsx
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {total} pratic{total === 1 ? 'a' : 'he'}
            {q || sp.stato || sp.sede ? ' · filtri attivi' : ''}
          </p>
```

Subito **prima** di `<AdminPraticheFilters ... />` (riga 126), inserisci:

```tsx
        <PraticheTabs tabs={tabs} attivo={attivo} filtri={filtriTab} basePath={BASE_PATH} />
```

Sostituisci ovunque `sorted` con `pratiche` (righe 129, 149) — il re-sort non esiste più.

In fondo, **dopo** il `</div>` che chiude il contenitore della tabella e prima di `</div></AppShell>`, aggiungi il pager:

```tsx
        {totalPages > 1 && (
          <nav className="mt-5 flex items-center justify-between">
            <p className="text-[12px] text-pv-slate-500">
              Pagina {page} di {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={hrefPaginaPratiche(page - 1, { stato: sp.stato, q: sp.q, sede: sp.sede }, BASE_PATH)}
                  className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                >
                  ← Indietro
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={hrefPaginaPratiche(page + 1, { stato: sp.stato, q: sp.q, sede: sp.sede }, BASE_PATH)}
                  className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                >
                  Avanti →
                </Link>
              )}
            </div>
          </nav>
        )}
```

- [ ] **Step 4: Verifica che i filtri non perdano la pagina**

`AdminPraticheFilters` fa un GET su `/admin/pratiche`. Se cambi filtro mentre sei a pagina 3, il form non deve trascinare `page=3` (rischio: lista vuota). Verifica che il form **non** abbia un campo `page` nascosto; se ce l'ha, rimuovilo.

- [ ] **Step 5: Typecheck + test**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma test -- src/lib/pratiche/`
Expected: nessun errore, tutti i test verdi.

- [ ] **Step 6: Prova le query sul DB reale**

```bash
docker exec -i <container> psql -U pv -d passaggio_veloce -c \
  "SELECT stato, count(*) FROM pratiche WHERE \"deletedAt\" IS NULL GROUP BY 1 ORDER BY 2 DESC;"
```

Confronta i totali con quelli mostrati dai tab: devono coincidere (In corso = R1+R2+R3+escalation+accettata+processata; escalation = solo `IN_ESCALATION`).

- [ ] **Step 7: Verifica nel browser**

Login come admin, `/admin/pratiche`. **Cliccando** (non navigando per URL):
1. Ogni tab filtra e resta selezionato; il conteggio del tab coincide col numero di risultati mostrato nell'intestazione.
2. La select "Escalation" continua a filtrare davvero (è la regressione del Task 9: se mostra tutte le pratiche, `SINGOLI_ADMIN` non è arrivato fin qui).
3. Con più di 15 pratiche, il pager compare e "Avanti" funziona preservando tab e filtri.
4. Combina tab + ricerca: il tab resta attivo e i conteggi si aggiornano.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/admin/pratiche/page.tsx
git commit -m "feat(admin): tab e paginazione nella lista pratiche, via il sort in memoria"
```

---

## Task 12: Verifica finale

- [ ] **Step 1: Suite completa**

Run: `pnpm --filter piattaforma test`
Expected: tutti verdi. Nessun test preesistente rotto (in particolare `lib/pratiche/stati.test.ts` e i test delle route ZIP delle pratiche, che ora passano dall'alias `buildPraticaZip`).

- [ ] **Step 2: Typecheck e lint**

Run: `pnpm typecheck && pnpm lint`

- [ ] **Step 3: Walkthrough end-to-end come admin**

Un solo giro, cliccando davvero:
1. `/admin/companies/<id>` → scarica un documento singolo e lo ZIP. Apri lo ZIP.
2. `/admin/fatturazione` → tab "Da emettere", chip ambra. Segna una fattura come trasmessa, torna in lista, verifica che il chip diventi verde e i conteggi si spostino di uno.
3. `/admin/pratiche` → i cinque tab, la select Escalation, il pager.
4. Login come **broker**: `/pratiche` e `/fatturazione` devono funzionare **esattamente come prima** (i default di `hrefTab`/`whereStato` esistono per questo). L'unica differenza visibile: il chip di stato al posto del testo "Gestito/In attesa".

- [ ] **Step 4: Aggiorna il piano di implementazione**

`docs/piano-implementazione.md` è la fonte di verità del progresso: aggiungi la riga di questa release.

- [ ] **Step 5: Commit finale e push**

```bash
git add -A
git commit -m "docs: aggiorna piano implementazione con gli strumenti admin"
git push origin main
```

Il deploy su Vercel parte dal push su `main`. **Nessuna migration da applicare** — se il deploy la chiede, qualcosa è andato storto.
