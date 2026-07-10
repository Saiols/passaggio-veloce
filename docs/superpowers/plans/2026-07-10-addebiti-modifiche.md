# Sezione Addebiti — modifiche — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nascondere card "Prossimi addebiti" (dashboard) e i riepiloghi di spesa su `/addebiti`, e aggiungere un filtro range-date allo storico addebiti.

**Architecture:** La logica timezone giorno→UTC (Europe/Rome, DST), oggi in `feedback/query.ts`, viene estratta in un helper puro condiviso `lib/date/rome-day.ts` e riusata da feedback (refactor, comportamento invariato) e addebiti. Un secondo helper puro `lib/fee/date-filter.ts` costruisce il where del range su `refDate`. Le pagine restano server component; i "blocchi di riepilogo" e la card vengono commentati con marker (riattivabili) mantenendo il lint verde.

**Tech Stack:** Next.js 16 App Router (server components), Prisma/Postgres (`@pv/db`), Vitest, Tailwind `pv-*`.

## Global Constraints

- **Runtime dev/test:** `node` NON è sul PATH di Git Bash. Eseguire pnpm da **PowerShell** anteponendo Node 22 al PATH nella stessa riga: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma <cmd>`.
- **Vitest:** config con `include: ['src/**/*.test.ts']`, `environment: 'node'`, alias `@`→`src`. NON modificare `vitest.config.ts`. Import type-only da `@pv/db` → nessun Prisma a runtime nei test.
- **Reversibilità:** item "nascondere" si realizzano **commentando** con marker `… DISABILITATO 2026-07-10 — riattivare …` (pattern esistente nel repo, es. `LISTINI DISABILITATI`). NON cancellare.
- **Lint verde dopo i commenti:** nessun import o variabile inutilizzato deve restare. In particolare, in `agenzia-dashboard.tsx` diventano inutilizzati `computeGiorniResidui`/`countdownLevel` (import), `formatCurrencyCent` (import), `canAddebitiView`, `prossimiAddebiti`; in `addebiti/page.tsx` diventano inutilizzati `StatCard` (import), `now`, `rowsAnno`, `totaleAnno`, `countAnno`, `totaleMese`.
- **Comportamento feedback invariato:** dopo il refactor di `feedback/query.ts`, i 12 test in `feedback/query.test.ts` restano immutati e verdi (guardia di regressione).
- **UX filtri:** form `method="get"`, apply su `onChange` via `requestSubmit()`, nessun bottone submit (come `feedback/filters.tsx`). `GlobalNavOverlay` copre il caricamento.
- **Niente colori hardcoded:** solo classi `pv-*` / token del design system.
- **`refDate` = `scheduledAt ?? createdAt`**: il filtro DB deve replicare esattamente questa scelta. Giorni interpretati in **Europe/Rome**. Query param `da`/`a` in formato `YYYY-MM-DD`, opzionali; bound malformato → ignorato.

---

## File Structure

- **Create** `apps/piattaforma/src/lib/date/rome-day.ts` — helper puro timezone (parse YMD, Rome start/end-of-day, `resolveDayRange`).
- **Create** `apps/piattaforma/src/lib/date/rome-day.test.ts` — unit test (incl. DST).
- **Modify** `apps/piattaforma/src/lib/feedback/query.ts` — delega al nuovo helper, rimuove le funzioni tz locali.
- **Create** `apps/piattaforma/src/lib/fee/date-filter.ts` — `feeRefDateWhere(range)`.
- **Create** `apps/piattaforma/src/lib/fee/date-filter.test.ts` — unit test.
- **Create** `apps/piattaforma/src/app/addebiti/filters.tsx` — form GET Da/A.
- **Modify** `apps/piattaforma/src/app/addebiti/page.tsx` — filtro date + commento riepiloghi.
- **Modify** `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx` — commento card "Prossimi addebiti".

---

## Task 1: Estrai helper timezone condiviso + refactor feedback

**Files:**
- Create: `apps/piattaforma/src/lib/date/rome-day.ts`
- Test: `apps/piattaforma/src/lib/date/rome-day.test.ts`
- Modify: `apps/piattaforma/src/lib/feedback/query.ts`

**Interfaces:**
- Produces:
  ```ts
  function parseYmd(value: string | undefined): [number, number, number] | null;
  function romeStartOfDay(ymd: [number, number, number]): Date;
  function romeEndOfDay(ymd: [number, number, number]): Date;
  type DayRange = { gte?: Date; lte?: Date; da: string; a: string; active: boolean };
  function resolveDayRange(da: string | undefined, a: string | undefined): DayRange;
  ```

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/date/rome-day.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseYmd, romeStartOfDay, romeEndOfDay, resolveDayRange } from './rome-day';

describe('parseYmd', () => {
  it('accetta una data di calendario valida', () => {
    expect(parseYmd('2026-07-15')).toEqual([2026, 7, 15]);
  });
  it('rifiuta undefined, formati errati e date impossibili', () => {
    expect(parseYmd(undefined)).toBeNull();
    expect(parseYmd('15/07/2026')).toBeNull();
    expect(parseYmd('2026-02-30')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
  });
});

describe('romeStartOfDay / romeEndOfDay (Europe/Rome, DST)', () => {
  it('estate CEST (+2)', () => {
    expect(romeStartOfDay([2026, 7, 15]).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(romeEndOfDay([2026, 7, 20]).toISOString()).toBe('2026-07-20T21:59:59.999Z');
  });
  it('inverno CET (+1)', () => {
    expect(romeStartOfDay([2026, 1, 15]).toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });
  it('giorno di spring-forward (29/03/2026)', () => {
    expect(romeStartOfDay([2026, 3, 29]).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(romeEndOfDay([2026, 3, 29]).toISOString()).toBe('2026-03-29T21:59:59.999Z');
  });
  it('giorno di fall-back (25/10/2026)', () => {
    expect(romeStartOfDay([2026, 10, 25]).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(romeEndOfDay([2026, 10, 25]).toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
});

describe('resolveDayRange', () => {
  it('da+a validi: bound + echo + active', () => {
    const r = resolveDayRange('2026-07-15', '2026-07-20');
    expect(r.gte?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(r.lte?.toISOString()).toBe('2026-07-20T21:59:59.999Z');
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('2026-07-20');
    expect(r.active).toBe(true);
  });
  it('solo da: nessun lte', () => {
    const r = resolveDayRange('2026-07-15', undefined);
    expect(r.gte?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('');
    expect(r.active).toBe(true);
  });
  it('vuoto o malformato: inattivo, nessun bound', () => {
    const r = resolveDayRange(undefined, '31/12/2026');
    expect(r.gte).toBeUndefined();
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.active).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisce**

Run (PowerShell): `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/date/rome-day.test.ts`
Expected: FAIL — `Failed to resolve import "./rome-day"`.

- [ ] **Step 3: Crea l'helper**

Crea `apps/piattaforma/src/lib/date/rome-day.ts`:

```ts
/**
 * Conversione giorno→istante UTC nel fuso Europe/Rome (con DST). Puro, senza IO.
 * Estratto per essere condiviso tra i filtri per range di date (feedback, addebiti).
 */

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROME_TZ = 'Europe/Rome';

/** Valida che la stringa sia una data di calendario reale in formato YYYY-MM-DD. */
export function parseYmd(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const m = RE_YMD.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Round-trip: scarta le date impossibili (es. 2026-02-30 → marzo).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return [y, mo, d];
}

/** Offset (ms) di Europe/Rome per un dato istante UTC (positivo a est di UTC). */
function romeOffsetMs(instant: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute, g.second);
  return asUtc - instant;
}

/** Istante UTC corrispondente all'ora di parete indicata nel fuso di Roma. */
function romeWallClockToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s, 0); // ms fuori dal calcolo dell'offset
  // Doppio passaggio: stabilizza il caso raro di transizione DST.
  const utc = naive - romeOffsetMs(naive - romeOffsetMs(naive));
  return new Date(utc + ms); // ms riaggiunti dopo la conversione
}

export function romeStartOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 0, 0, 0, 0);
}

export function romeEndOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 23, 59, 59, 999);
}

export type DayRange = { gte?: Date; lte?: Date; da: string; a: string; active: boolean };

/**
 * Da due giorni `YYYY-MM-DD` ai bound UTC (inizio/fine giornata in Europe/Rome).
 * Bound malformato → ignorato. `da`/`a` ri-emessi solo se validi (per i default input).
 */
export function resolveDayRange(da: string | undefined, a: string | undefined): DayRange {
  const daYmd = parseYmd(da);
  const aYmd = parseYmd(a);
  return {
    gte: daYmd ? romeStartOfDay(daYmd) : undefined,
    lte: aYmd ? romeEndOfDay(aYmd) : undefined,
    da: daYmd ? da! : '',
    a: aYmd ? a! : '',
    active: Boolean(daYmd || aYmd),
  };
}
```

- [ ] **Step 4: Esegui il test e verifica che passa**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/date/rome-day.test.ts`
Expected: PASS (tutti verdi).

- [ ] **Step 5: Refactoring di `feedback/query.ts` per delegare all'helper**

Sostituisci integralmente `apps/piattaforma/src/lib/feedback/query.ts` con (rimuove `RE_YMD`, `ROME_TZ`, `parseYmd`, `romeOffsetMs`, `romeWallClockToUtc`, `romeStartOfDay`, `romeEndOfDay` locali; delega a `resolveDayRange`):

```ts
import type { Prisma } from '@pv/db';
import { whereValutazione, type SedeScope } from '@/lib/sedi/scope-filters';
import { resolveDayRange } from '@/lib/date/rome-day';

export type FeedbackFilterParams = { da?: string; a?: string; sede?: string };

export type ResolvedFeedbackFilters = {
  /** Where per findMany E aggregate (stesso insieme → media/conteggio coerenti). */
  where: Prisma.ValutazioneWhereInput;
  /** Sede selezionata validata (solo owner); '' = tutte → default del select. */
  sede: string;
  /** Bound date validi ri-emessi per i default degli input (o ''). */
  da: string;
  a: string;
  /** Almeno un filtro attivo (per testo header / empty-state). */
  attivi: boolean;
};

/**
 * Compone il `where` dei feedback per la pagina `/feedback`.
 *
 * Owner: base SEMPRE aggregata (tutte le sedi), il select in pagina è l'unico
 * controllo sede → ignora il cookie globale `pv_sede`. Non-owner: scope invariato
 * per sede. Il range date vale per tutti; i giorni sono interpretati in Europe/Rome.
 */
export function resolveFeedbackFilters(args: {
  isOwner: boolean;
  agenziaId: string;
  scopeIds: string[];
  accessibleSedeIds: string[];
  params: FeedbackFilterParams;
}): ResolvedFeedbackFilters {
  const { isOwner, agenziaId, scopeIds, accessibleSedeIds, params } = args;

  // Base per sede. Owner → aggregate=true ⇒ { agenziaId } (tutte le sedi).
  const scope: SedeScope = { scopeIds, aggregate: isOwner, isOwner };
  const where: Prisma.ValutazioneWhereInput = whereValutazione(scope, agenziaId);

  // Narrowing sede: solo owner, solo se la sede è tra quelle accessibili.
  let sede = '';
  if (isOwner && params.sede && accessibleSedeIds.includes(params.sede)) {
    sede = params.sede;
    where.agenziaSedeId = sede;
  }

  // Range date (tutti). Bound malformato → ignorato.
  const range = resolveDayRange(params.da, params.a);
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (range.gte) createdAt.gte = range.gte;
  if (range.lte) createdAt.lte = range.lte;
  if (range.gte || range.lte) where.createdAt = createdAt;

  return { where, sede, da: range.da, a: range.a, attivi: Boolean(sede) || range.active };
}
```

- [ ] **Step 6: Esegui i test feedback (regressione) + il nuovo helper**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/date/rome-day.test.ts src/lib/feedback/query.test.ts`
Expected: PASS — `query.test.ts` 12/12 invariati (prova che il refactor non cambia il comportamento) + `rome-day.test.ts` verdi.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/date/rome-day.ts apps/piattaforma/src/lib/date/rome-day.test.ts apps/piattaforma/src/lib/feedback/query.ts
git commit -m "refactor(date): estrai helper Europe/Rome condiviso; feedback lo riusa"
```

---

## Task 2: Helper `feeRefDateWhere`

**Files:**
- Create: `apps/piattaforma/src/lib/fee/date-filter.ts`
- Test: `apps/piattaforma/src/lib/fee/date-filter.test.ts`

**Interfaces:**
- Consumes: `type Prisma` da `@pv/db`.
- Produces:
  ```ts
  function feeRefDateWhere(range: { gte?: Date; lte?: Date }): Prisma.FeeAddebitoWhereInput | null;
  ```

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/fee/date-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { feeRefDateWhere } from './date-filter';

const g = new Date('2026-07-14T22:00:00.000Z');
const l = new Date('2026-07-20T21:59:59.999Z');

describe('feeRefDateWhere', () => {
  it('range vuoto → null', () => {
    expect(feeRefDateWhere({})).toBeNull();
  });
  it('solo gte: filtra refDate ≥ g su scheduledAt o (scheduledAt null → createdAt)', () => {
    expect(feeRefDateWhere({ gte: g })).toEqual({
      OR: [
        { scheduledAt: { gte: g } },
        { AND: [{ scheduledAt: null }, { createdAt: { gte: g } }] },
      ],
    });
  });
  it('gte + lte: entrambi i bound su ciascun ramo', () => {
    expect(feeRefDateWhere({ gte: g, lte: l })).toEqual({
      OR: [
        { scheduledAt: { gte: g, lte: l } },
        { AND: [{ scheduledAt: null }, { createdAt: { gte: g, lte: l } }] },
      ],
    });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisce**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/fee/date-filter.test.ts`
Expected: FAIL — `Failed to resolve import "./date-filter"`.

- [ ] **Step 3: Implementa l'helper**

Crea `apps/piattaforma/src/lib/fee/date-filter.ts`:

```ts
import type { Prisma } from '@pv/db';

/**
 * Filtro range date sul `refDate` di un addebito, ossia `scheduledAt ?? createdAt`
 * (lo stesso campo mostrato/raggruppato nello storico). `null` se il range è vuoto.
 *
 * Le righe con `scheduledAt` valorizzato si filtrano su `scheduledAt`; quelle con
 * `scheduledAt` null ricadono su `createdAt`.
 */
export function feeRefDateWhere(range: {
  gte?: Date;
  lte?: Date;
}): Prisma.FeeAddebitoWhereInput | null {
  if (!range.gte && !range.lte) return null;
  const bound: { gte?: Date; lte?: Date } = {};
  if (range.gte) bound.gte = range.gte;
  if (range.lte) bound.lte = range.lte;
  return {
    OR: [{ scheduledAt: bound }, { AND: [{ scheduledAt: null }, { createdAt: bound }] }],
  };
}
```

- [ ] **Step 4: Esegui il test e verifica che passa**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/fee/date-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fee/date-filter.ts apps/piattaforma/src/lib/fee/date-filter.test.ts
git commit -m "feat(addebiti): helper feeRefDateWhere per il filtro range su refDate"
```

---

## Task 3: `/addebiti` — filtro date + nascondi riepiloghi

**Files:**
- Create: `apps/piattaforma/src/app/addebiti/filters.tsx`
- Modify: `apps/piattaforma/src/app/addebiti/page.tsx`

**Interfaces:**
- Consumes: `resolveDayRange` (Task 1), `feeRefDateWhere` (Task 2).
- Produces:
  ```ts
  function AddebitiFilters(props: { da: string; a: string }): JSX.Element;
  ```

- [ ] **Step 1: Crea il form filtri `filters.tsx`**

Crea `apps/piattaforma/src/app/addebiti/filters.tsx`:

```tsx
'use client';

import { useRef } from 'react';

const CONTROL =
  'rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-pv-slate-500';

export function AddebitiFilters({ da, a }: { da: string; a: string }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      action="/addebiti"
      method="get"
      className="mb-6 flex flex-col gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:flex-wrap sm:items-end"
    >
      <label className={LABEL}>
        Da
        <input type="date" name="da" defaultValue={da} onChange={submit} className={CONTROL} />
      </label>
      <label className={LABEL}>
        A
        <input type="date" name="a" defaultValue={a} onChange={submit} className={CONTROL} />
      </label>
    </form>
  );
}
```

- [ ] **Step 2: Riscrivi `page.tsx` (filtro date + commento riepiloghi con marker)**

Sostituisci integralmente `apps/piattaforma/src/app/addebiti/page.tsx` con:

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
// ADDEBITI RIEPILOGO DISABILITATO 2026-07-10 — riattivare `StatCard` insieme alle 3 card e ai subtotali:
import { Alert, Card } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { groupFeeByMonth, type FeeRow } from '@/lib/fee/recap';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, whereFeeAddebito } from '@/lib/sedi/scope-filters';
import { resolveDayRange } from '@/lib/date/rome-day';
import { feeRefDateWhere } from '@/lib/fee/date-filter';
import { assertPermesso } from '@/lib/auth/permessi/guard';
import { AddebitiFilters } from './filters';

export const dynamic = 'force-dynamic';

function statoLabel(s: string): string {
  switch (s) {
    case 'SCHEDULED': return 'In coda';
    case 'IN_LAVORAZIONE': return 'In lavorazione';
    case 'SUCCESS': return 'Addebitato';
    case 'FAILED': return 'Fallito';
    case 'RETRY': return 'Nuovo tentativo';
    case 'ANNULLATO': return 'Annullato';
    default: return s;
  }
}

type StoricoRow = FeeRow & {
  id: string;
  praticaId: string | null;
  codice: string | null;
  targa: string | null;
  scheduledAt: Date | null;
  executedAt: Date | null;
};

export default async function AddebitiPage({
  searchParams,
}: {
  searchParams: Promise<{ da?: string; a?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  await assertPermesso('addebiti.view');

  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/addebiti">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">La sezione addebiti è disponibile per le agenzie.</Alert>
        </div>
      </AppShell>
    );
  }
  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/login');
  const companyId = ctx.companyId;

  // Filtro range date sullo storico (su refDate = scheduledAt ?? createdAt).
  const sp = await searchParams;
  const range = resolveDayRange(sp.da, sp.a);
  const dateWhere = feeRefDateWhere(range);
  // Multi-sede: gli addebiti sono della sede che ha lavorato la pratica.
  const base = whereFeeAddebito(toSedeScope(ctx), companyId);
  const where: Prisma.FeeAddebitoWhereInput = dateWhere ? { AND: [base, dateWhere] } : base;

  const fees = await prisma.feeAddebito.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      pratica: {
        select: {
          id: true,
          codicePratica: true,
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
        },
      },
    },
  });

  const rows: StoricoRow[] = fees.map((f) => {
    const veicoli = f.pratica?.veicoli ?? [];
    const targa0 = veicoli[0]?.targa ?? null;
    const targa = targa0 && veicoli.length > 1 ? `${targa0} +${veicoli.length - 1}` : targa0;
    return {
      id: f.id,
      praticaId: f.pratica?.id ?? null,
      importoCent: f.importoCent,
      stato: f.stato,
      refDate: f.scheduledAt ?? f.createdAt,
      codice: f.pratica?.codicePratica ?? null,
      targa,
      scheduledAt: f.scheduledAt,
      executedAt: f.executedAt,
    };
  });
  const groups = groupFeeByMonth(rows);

  // ADDEBITI RIEPILOGO DISABILITATO 2026-07-10 — non mostriamo gli aggregati di spesa
  // all'agenzia (si fa i calcoli da sé). Riattivare insieme alle 3 StatCard e ai subtotali:
  // const now = new Date();
  // const rowsAnno = rows.filter((r) => r.refDate.getUTCFullYear() === now.getUTCFullYear());
  // const totaleAnno = rowsAnno.reduce((s, r) => s + r.importoCent, 0);
  // const countAnno = rowsAnno.length;
  // const totaleMese = rowsAnno
  //   .filter((r) => r.refDate.getUTCMonth() === now.getUTCMonth())
  //   .reduce((s, r) => s + r.importoCent, 0);

  return (
    <AppShell session={session} activePath="/addebiti">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Area finanziaria
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Addebiti
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Le fee delle pratiche gestite, addebitate automaticamente alla firma.
          </p>
        </header>

        {/* ADDEBITI RIEPILOGO DISABILITATO 2026-07-10 — riattivare le 3 StatCard di spesa:
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label={`Addebiti ${now.getUTCFullYear()}`} value={String(countAnno)} hint="Pratiche addebitate" accent="navy" />
          <StatCard label={`Totale ${now.getUTCFullYear()}`} value={formatCurrencyCent(totaleAnno)} accent="green" />
          <StatCard label="Questo mese" value={formatCurrencyCent(totaleMese)} accent="orange" />
        </div>
        */}

        <AddebitiFilters da={range.da} a={range.a} />

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">Storico per mese</h2>
          {groups.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              {range.active
                ? 'Nessun addebito nel periodo selezionato.'
                : 'Nessun addebito registrato.'}
            </p>
          ) : (
            <div className="mt-3 space-y-5">
              {groups.map((g) => (
                <div key={g.month}>
                  <div className="flex items-center justify-between border-b border-pv-slate-200 pb-1.5">
                    <p className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-500">{g.month}</p>
                    {/* ADDEBITI RIEPILOGO DISABILITATO 2026-07-10 — riattivare il subtotale del mese:
                    <p className="text-[13px] font-bold text-pv-navy-800">{formatCurrencyCent(g.totaleCent)}</p>
                    */}
                  </div>
                  <ul className="divide-y divide-pv-slate-100 text-[13px]">
                    {g.rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          {r.praticaId ? (
                            <Link href={`/pratiche/${r.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                              {r.codice ?? '—'}
                            </Link>
                          ) : (
                            <span className="font-mono font-semibold text-pv-navy-800">{r.codice ?? '—'}</span>
                          )}
                          {r.targa ? <span className="ml-2 text-[12px] text-pv-slate-500">{r.targa}</span> : null}
                          <p className="text-[11px] text-pv-slate-500">
                            {statoLabel(r.stato)} · {formatDate(r.executedAt ?? r.scheduledAt)}
                          </p>
                        </div>
                        <span className="font-semibold text-pv-navy-800">{formatCurrencyCent(r.importoCent)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Lint + typecheck + suite**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma lint`
Expected: 0 errori (nessun import/variabile inutilizzato: `StatCard`, `now`, `totaleAnno`, `countAnno`, `totaleMese`, `rowsAnno` sono tutti commentati; `formatCurrencyCent` resta usato dalla riga importo).

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma typecheck`
Expected: PASS. (Se `tsc` esplode a cache fredda — problema noto del repo — riportare come concern; lint verde + suite verde sono sufficienti al commit, il gate finale conferma il typecheck a caldo.)

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test`
Expected: PASS (intera suite, inclusi Task 1 e 2).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/addebiti/filters.tsx apps/piattaforma/src/app/addebiti/page.tsx
git commit -m "feat(addebiti): filtro range-date storico; nascondi riepiloghi di spesa"
```

---

## Task 4: Dashboard — nascondi card "Prossimi addebiti"

**Files:**
- Modify: `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`

**Interfaces:**
- Nessuna nuova interfaccia. Solo commenti con marker + pulizia import/var per lint verde.

- [ ] **Step 1: Commenta l'import countdown (riga 5)**

Sostituisci:

```tsx
import { computeGiorniResidui, countdownLevel } from '@/lib/pratiche/countdown';
```

con:

```tsx
// PROSSIMI-ADDEBITI DISABILITATO 2026-07-10 — riattivare insieme alla card "Prossimi addebiti":
// import { computeGiorniResidui, countdownLevel } from '@/lib/pratiche/countdown';
```

- [ ] **Step 2: Commenta `formatCurrencyCent` nell'import format (riga 4)**

`formatCurrencyCent` era usato solo dalla card. Sostituisci:

```tsx
import { formatRelative, formatCurrencyCent } from '@/lib/format';
```

con:

```tsx
// PROSSIMI-ADDEBITI DISABILITATO 2026-07-10 — `formatCurrencyCent` serviva solo alla card:
import { formatRelative } from '@/lib/format';
```

- [ ] **Step 3: Togli `canAddebitiView` dal primo Promise.all**

Sostituisci il blocco:

```tsx
  const [canInboxView, canPraticheView, canAddebitiView, canFeedbackView] = await Promise.all([
    hasPermesso('inbox.view'),
    hasPermesso('pratiche.view'),
    hasPermesso('addebiti.view'),
    hasPermesso('feedback.view'),
  ]);
```

con (allineamento posizionale mantenuto: 3 nomi ↔ 3 promesse):

```tsx
  const [canInboxView, canPraticheView, canFeedbackView] = await Promise.all([
    hasPermesso('inbox.view'),
    hasPermesso('pratiche.view'),
    // PROSSIMI-ADDEBITI DISABILITATO 2026-07-10 — `addebiti.view` serviva solo alla card:
    // hasPermesso('addebiti.view'),
    hasPermesso('feedback.view'),
  ]);
```

- [ ] **Step 4: Togli `prossimiAddebiti` dal secondo Promise.all (destructuring + query)**

Sostituisci la riga di destructuring:

```tsx
  const [inArrivo, inCorso, firmateMese, rating, assegnazioniRecenti, prossimiAddebiti] = await Promise.all([
```

con:

```tsx
  const [inArrivo, inCorso, firmateMese, rating, assegnazioniRecenti] = await Promise.all([
```

e sostituisci l'elemento query della card (il blocco `canAddebitiView ? prisma.feeAddebito.findMany(...) : Promise.resolve([])`, ultimo elemento dell'array):

```tsx
    // "Prossimi addebiti" mostra importi e collega a /addebiti: entrambi
    // richiedono addebiti.view, quindi niente query se manca il permesso.
    canAddebitiView
      ? prisma.feeAddebito.findMany({
          where: { agenziaSedeId: { in: scopeIds }, stato: 'SCHEDULED', scheduledAt: { not: null } },
          orderBy: { scheduledAt: 'asc' },
          take: 3,
          include: { pratica: { select: { id: true, codicePratica: true } } },
        })
      : Promise.resolve([]),
```

con:

```tsx
    // PROSSIMI-ADDEBITI DISABILITATO 2026-07-10 (tutto istantaneo) — riattivare la query,
    // il nome destrutturato `prossimiAddebiti`, `canAddebitiView`, gli import countdown/format e la card:
    // canAddebitiView
    //   ? prisma.feeAddebito.findMany({
    //       where: { agenziaSedeId: { in: scopeIds }, stato: 'SCHEDULED', scheduledAt: { not: null } },
    //       orderBy: { scheduledAt: 'asc' },
    //       take: 3,
    //       include: { pratica: { select: { id: true, codicePratica: true } } },
    //     })
    //   : Promise.resolve([]),
```

- [ ] **Step 5: Commenta il blocco render della card (righe ~197-230)**

Sostituisci il blocco JSX:

```tsx
      {canAddebitiView && prossimiAddebiti.length > 0 && (
        <section className="mb-6 rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Prossimi addebiti</h2>
            <Link href="/addebiti" className="text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4">
              Vedi tutti →
            </Link>
          </header>
          <ul className="divide-y divide-pv-slate-200">
            {prossimiAddebiti.map((f) => {
              const giorni = computeGiorniResidui(f.scheduledAt, new Date());
              const level = countdownLevel(giorni);
              const badge =
                level === 'overdue' ? 'text-pv-red-500'
                : level === 'urgent' ? 'text-pv-orange-500'
                : level === 'warn' ? 'text-pv-amber-500'
                : 'text-pv-slate-500';
              return (
                <li key={f.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <Link href={`/pratiche/${f.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                    {f.pratica?.codicePratica ?? '—'}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-pv-navy-800">{formatCurrencyCent(f.importoCent)}</span>
                    <span className={`text-[12px] font-bold ${badge}`}>
                      {giorni === null ? '—' : giorni < 0 ? `scaduto ${-giorni}g` : `tra ${giorni}g`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
```

con il medesimo blocco racchiuso in un commento JSX marker:

```tsx
      {/* PROSSIMI-ADDEBITI DISABILITATO 2026-07-10 (tutto istantaneo) — riattivare la card:
      {canAddebitiView && prossimiAddebiti.length > 0 && (
        <section className="mb-6 rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Prossimi addebiti</h2>
            <Link href="/addebiti" className="text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4">
              Vedi tutti →
            </Link>
          </header>
          <ul className="divide-y divide-pv-slate-200">
            {prossimiAddebiti.map((f) => {
              const giorni = computeGiorniResidui(f.scheduledAt, new Date());
              const level = countdownLevel(giorni);
              const badge =
                level === 'overdue' ? 'text-pv-red-500'
                : level === 'urgent' ? 'text-pv-orange-500'
                : level === 'warn' ? 'text-pv-amber-500'
                : 'text-pv-slate-500';
              return (
                <li key={f.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <Link href={`/pratiche/${f.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                    {f.pratica?.codicePratica ?? '—'}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-pv-navy-800">{formatCurrencyCent(f.importoCent)}</span>
                    <span className={`text-[12px] font-bold ${badge}`}>
                      {giorni === null ? '—' : giorni < 0 ? `scaduto ${-giorni}g` : `tra ${giorni}g`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      */}
```

- [ ] **Step 6: Lint + typecheck + suite**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma lint`
Expected: 0 errori. Se il lint segnala un import/variabile ancora inutilizzato (`Link`, `hasPermesso`, `prisma`, ecc.), verificare: `Link` è usato altrove nella dashboard (altre sezioni), `hasPermesso`/`prisma` restano usati. Non commentare import ancora necessari.

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma typecheck`
Expected: PASS (stesso caveat cache-fredda del Task 3).

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx
git commit -m "feat(dashboard): nascondi card Prossimi addebiti (tutto istantaneo)"
```

---

## Verifica end-to-end (fine fase)

- [ ] **Smoke manuale** — `$env:Path = "…v22.15.0;" + $env:Path; pnpm --filter piattaforma dev`:
  - Dashboard agenzia: **nessuna** card "Prossimi addebiti".
  - `/addebiti`: **nessuna** StatCard in alto, **nessun** subtotale € accanto ai mesi; resta la lista con l'importo per addebito; i mesi restano come intestazioni.
  - `/addebiti` con `?da=&a=`: gli input Da/A restringono la lista; senza filtro si vede tutto lo storico; empty-state coerente ("Nessun addebito nel periodo selezionato").
- [ ] **Check DB read-only** — sul Postgres locale (container `pv-postgres`, DB `passaggio_veloce`, utente `pv`), verifica la presenza di `fee_addebiti` con `scheduledAt` valorizzato e/o `NULL` per esercitare entrambi i rami del filtro `refDate`. Query di sola lettura via stdin (PowerShell 5.1 mangia i doppi apici passati al comando nativo):
  ```sql
  SELECT count(*) AS tot,
         count(*) FILTER (WHERE "scheduledAt" IS NOT NULL) AS con_scheduled,
         count(*) FILTER (WHERE "scheduledAt" IS NULL)     AS senza_scheduled
  FROM fee_addebiti;
  ```

---

## Self-review (eseguito)

- **Spec coverage:** item 1 (card dashboard) → Task 4; item 2 (StatCard + subtotali) → Task 3 (commenti marker); item 3 (filtro date + tutto lo storico) → Task 1 (`resolveDayRange`) + Task 2 (`feeRefDateWhere`) + Task 3 (page + `filters.tsx`); DRY timezone → Task 1 (estrazione + refactor feedback). Tutti coperti.
- **Placeholder scan:** nessun TBD/TODO; ogni step ha codice/comando reale.
- **Type consistency:** `resolveDayRange`/`DayRange` (Task 1) usati in `feedback/query.ts` e in `addebiti/page.tsx`; `feeRefDateWhere` (Task 2) → `Prisma.FeeAddebitoWhereInput | null` combaciato con `{ AND: [base, dateWhere] }` in `page.tsx` (import `Prisma` aggiunto); `AddebitiFilters` props `{da,a}` coincidono tra `filters.tsx` e la chiamata. Marker identico ovunque (`DISABILITATO 2026-07-10 — riattivare`).
