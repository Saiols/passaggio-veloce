# Finanze — periodo personalizzato: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere alla pagina Finanze (`/admin/dashboard`) un quinto tab "Personalizzato" con range di date, estraendo il calcolo del periodo in una fonte unica letta anche dall'export CSV.

**Architecture:** un modulo puro `lib/finanze/periodo.ts` risolve `(periodo, da, a) → { gte, lte, label }`, delegando a `resolveDayRange` di `lib/date/rome-day.ts` per i giorni di calendario romani. Pagina e route di export smettono di calcolare il periodo per conto loro e chiamano il risolutore: così il tab nuovo nasce già coerente nei due consumer, e muore il difetto per cui `periodo=giorno` nell'export finiva nel ramo `anno`.

**Tech Stack:** Next.js 16 App Router (Server Components), Prisma, Vitest, Tailwind.

Spec: `docs/superpowers/specs/2026-07-27-finanze-periodo-personalizzato-design.md`

## Global Constraints

- Node 22: se dopo un riavvio `node -v` dice 16, lanciare `nvm use 22.15.0` (pnpm richiede ≥18).
- Test: `pnpm --filter piattaforma test <path>` oppure `npx vitest run <path>` dentro `apps/piattaforma`.
- `pnpm typecheck` è affidabile solo a cache calda (con `tsconfig.tsbuildinfo` presente); da zero va in stack overflow con falsi errori Prisma — non è un fallimento del task.
- Nessuna migration, nessuna variabile d'ambiente, nessun dato toccato.
- Colori: solo classi `pv-*` del design system, mai esadecimali (regola `no-hardcoded-colors`).
- Le finestre mobili esistenti (`giorno`/`settimana`/`mese`/`anno`) devono restituire **gli stessi identici bound** di oggi: nessuna metrica già in produzione si sposta.
- Commit in italiano, uno per task.

---

### Task 1: modulo `lib/finanze/periodo.ts`

**Files:**
- Create: `apps/piattaforma/src/lib/finanze/periodo.ts`
- Test: `apps/piattaforma/src/lib/finanze/periodo.test.ts`

**Interfaces:**
- Consumes: `resolveDayRange`, `romeYmd` da `@/lib/date/rome-day` (già esistenti, non modificare).
- Produces:
  - `type Periodo = 'giorno' | 'settimana' | 'mese' | 'anno' | 'custom'`
  - `type PeriodoRisolto = { gte?: Date; lte?: Date; label: string; da: string; a: string }`
  - `parsePeriodo(value: string | undefined | null): Periodo`
  - `periodoLabel(p: Periodo): string`
  - `resolvePeriodo(args: { periodo: Periodo; da?: string; a?: string; now?: Date }): PeriodoRisolto`
  - `defaultCustomRange(now: Date): { da: string; a: string }`
  - `periodoDateFilter(r: PeriodoRisolto): { gte?: Date; lte?: Date } | undefined`
  - `PERIODI: readonly Periodo[]`

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `apps/piattaforma/src/lib/finanze/periodo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parsePeriodo,
  periodoLabel,
  resolvePeriodo,
  defaultCustomRange,
  periodoDateFilter,
} from './periodo';

// Metà luglio: Roma e UTC sono entrambi in CEST, così le asserzioni sulle
// finestre mobili (che usano i setter locali, come il codice originale)
// valgono sia con runner in UTC sia con runner in Europe/Rome.
const NOW = new Date('2026-07-27T10:00:00.000Z');

describe('parsePeriodo', () => {
  it('accetta i cinque valori noti', () => {
    for (const p of ['giorno', 'settimana', 'mese', 'anno', 'custom'] as const) {
      expect(parsePeriodo(p)).toBe(p);
    }
  });
  it('assente o sconosciuto torna mese, non l ultimo ramo della catena', () => {
    expect(parsePeriodo(undefined)).toBe('mese');
    expect(parsePeriodo(null)).toBe('mese');
    expect(parsePeriodo('pippo')).toBe('mese');
  });
});

describe('resolvePeriodo — finestre mobili (comportamento invariato)', () => {
  it('giorno: 24h indietro, nessun estremo superiore', () => {
    const r = resolvePeriodo({ periodo: 'giorno', now: NOW });
    expect(r.gte!.toISOString()).toBe('2026-07-26T10:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.label).toBe('Ultime 24h');
  });
  it('settimana, mese, anno', () => {
    expect(resolvePeriodo({ periodo: 'settimana', now: NOW }).gte!.toISOString())
      .toBe('2026-07-20T10:00:00.000Z');
    expect(resolvePeriodo({ periodo: 'mese', now: NOW }).gte!.toISOString())
      .toBe('2026-06-27T10:00:00.000Z');
    expect(resolvePeriodo({ periodo: 'anno', now: NOW }).gte!.toISOString())
      .toBe('2025-07-27T10:00:00.000Z');
  });
  it('le finestre mobili non emettono da/a', () => {
    const r = resolvePeriodo({ periodo: 'mese', now: NOW });
    expect(r.da).toBe('');
    expect(r.a).toBe('');
  });
});

describe('resolvePeriodo — custom', () => {
  it('due estremi: giorni interi in Europe/Rome', () => {
    const r = resolvePeriodo({ periodo: 'custom', da: '2026-06-01', a: '2026-06-30', now: NOW });
    expect(r.gte!.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(r.lte!.toISOString()).toBe('2026-06-30T21:59:59.999Z');
    expect(r.label).toBe('Dal 01/06/2026 al 30/06/2026');
  });
  it('solo da: aperto a destra', () => {
    const r = resolvePeriodo({ periodo: 'custom', da: '2026-06-01', now: NOW });
    expect(r.gte!.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.label).toBe('Dal 01/06/2026');
  });
  it('solo a: aperto a sinistra', () => {
    const r = resolvePeriodo({ periodo: 'custom', a: '2026-06-30', now: NOW });
    expect(r.gte).toBeUndefined();
    expect(r.lte!.toISOString()).toBe('2026-06-30T21:59:59.999Z');
    expect(r.label).toBe('Fino al 30/06/2026');
  });
  it('estremo malformato ignorato in silenzio', () => {
    const r = resolvePeriodo({ periodo: 'custom', da: '01/06/2026', a: '2026-02-30', now: NOW });
    expect(r.gte).toBeUndefined();
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.label).toBe('Tutto lo storico');
  });
});

describe('defaultCustomRange', () => {
  it('ultimo mese in giorni di calendario', () => {
    expect(defaultCustomRange(new Date('2026-07-27T10:00:00.000Z')))
      .toEqual({ da: '2026-06-27', a: '2026-07-27' });
  });
  it('clampa al fondo del mese: 31 marzo torna al 28 febbraio, non al 3 marzo', () => {
    expect(defaultCustomRange(new Date('2026-03-31T10:00:00.000Z')))
      .toEqual({ da: '2026-02-28', a: '2026-03-31' });
  });
  it('anno bisestile: 31 marzo 2024 torna al 29 febbraio', () => {
    expect(defaultCustomRange(new Date('2024-03-31T10:00:00.000Z')))
      .toEqual({ da: '2024-02-29', a: '2024-03-31' });
  });
  it('cambio d anno: 15 gennaio torna al 15 dicembre precedente', () => {
    expect(defaultCustomRange(new Date('2026-01-15T10:00:00.000Z')))
      .toEqual({ da: '2025-12-15', a: '2026-01-15' });
  });
  it('usa il giorno di Roma, non quello UTC', () => {
    // 00:30 del 17 luglio a Roma sono le 22:30 del 16 in UTC: il runtime su
    // Vercel è UTC e senza romeYmd il default sbaglierebbe giorno ogni notte.
    expect(defaultCustomRange(new Date('2026-07-16T22:30:00.000Z')).a).toBe('2026-07-17');
  });
});

describe('periodoDateFilter', () => {
  it('finestra mobile: solo gte', () => {
    const f = periodoDateFilter(resolvePeriodo({ periodo: 'mese', now: NOW }));
    expect(Object.keys(f!)).toEqual(['gte']);
  });
  it('custom con due estremi: gte + lte', () => {
    const f = periodoDateFilter(
      resolvePeriodo({ periodo: 'custom', da: '2026-06-01', a: '2026-06-30', now: NOW }),
    );
    expect(f).toEqual({
      gte: new Date('2026-05-31T22:00:00.000Z'),
      lte: new Date('2026-06-30T21:59:59.999Z'),
    });
  });
  it('range vuoto: nessun filtro, non un oggetto vuoto', () => {
    expect(periodoDateFilter(resolvePeriodo({ periodo: 'custom', now: NOW }))).toBeUndefined();
  });
});

describe('periodoLabel', () => {
  it('etichette dei tab', () => {
    expect(periodoLabel('giorno')).toBe('Ultime 24h');
    expect(periodoLabel('anno')).toBe('Ultimo anno');
    expect(periodoLabel('custom')).toBe('Personalizzato');
  });
});
```

- [ ] **Step 2: lancia il test e verifica che fallisca**

```
cd apps/piattaforma && npx vitest run src/lib/finanze/periodo.test.ts
```

Atteso: FAIL — `Failed to resolve import "./periodo"`.

- [ ] **Step 3: scrivi l'implementazione**

Crea `apps/piattaforma/src/lib/finanze/periodo.ts`:

```ts
/**
 * Periodo delle metriche finanziarie: fonte unica per la pagina Finanze
 * (`/admin/dashboard`) e per l'export CSV.
 *
 * Le due copie precedenti erano già divergenti: la route di export non
 * conosceva il valore `giorno`, che finiva nel ramo `else` di `anno`, e dal
 * tab "Ultime 24h" il CSV scaricava un anno intero senza dirlo. Chi aggiunge
 * un periodo tocca questo file e basta.
 *
 * Puro, niente IO: `now` è iniettabile per i test.
 */
import { resolveDayRange, romeYmd } from '@/lib/date/rome-day';

export const PERIODI = ['giorno', 'settimana', 'mese', 'anno', 'custom'] as const;
export type Periodo = (typeof PERIODI)[number];

export type PeriodoRisolto = {
  /** Estremo inferiore; assente = aperto a sinistra (solo su `custom`). */
  gte?: Date;
  /** Estremo superiore; le finestre mobili non ne hanno mai uno. */
  lte?: Date;
  /** Testo per l'intestazione: "Ultimo mese" o "Dal 01/06/2026 al 30/06/2026". */
  label: string;
  /** `YYYY-MM-DD` ri-emessi solo se validi, per i `defaultValue` degli input. */
  da: string;
  a: string;
};

const LABEL_MOBILE = {
  giorno: 'Ultime 24h',
  settimana: 'Ultima settimana',
  mese: 'Ultimo mese',
  anno: 'Ultimo anno',
} as const;

/** Valore assente o sconosciuto → `mese`, il default storico della pagina. */
export function parsePeriodo(value: string | undefined | null): Periodo {
  return (PERIODI as readonly string[]).includes(value ?? '') ? (value as Periodo) : 'mese';
}

export function periodoLabel(p: Periodo): string {
  return p === 'custom' ? 'Personalizzato' : LABEL_MOBILE[p];
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. La stringa arriva già validata da parseYmd. */
function itDate(ymd: string): string {
  const [y, mo, d] = ymd.split('-');
  return `${d}/${mo}/${y}`;
}

function labelCustom(da: string, a: string): string {
  if (da && a) return `Dal ${itDate(da)} al ${itDate(a)}`;
  if (da) return `Dal ${itDate(da)}`;
  if (a) return `Fino al ${itDate(a)}`;
  return 'Tutto lo storico';
}

/**
 * Finestra mobile: identica al calcolo che viveva in `page.tsx`, setter locali
 * compresi. Cambiarla sposterebbe metriche già in produzione.
 */
function inizioFinestraMobile(p: Exclude<Periodo, 'custom'>, now: Date): Date {
  const d = new Date(now.getTime());
  if (p === 'giorno') d.setDate(d.getDate() - 1);
  else if (p === 'settimana') d.setDate(d.getDate() - 7);
  else if (p === 'mese') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

export function resolvePeriodo(args: {
  periodo: Periodo;
  da?: string;
  a?: string;
  now?: Date;
}): PeriodoRisolto {
  if (args.periodo === 'custom') {
    // Giorni interi in Europe/Rome: DST e date impossibili sono già gestiti lì.
    const r = resolveDayRange(args.da, args.a);
    return { gte: r.gte, lte: r.lte, label: labelCustom(r.da, r.a), da: r.da, a: r.a };
  }
  return {
    gte: inizioFinestraMobile(args.periodo, args.now ?? new Date()),
    label: periodoLabel(args.periodo),
    da: '',
    a: '',
  };
}

function ymdString(y: number, mo: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Ultimo giorno del mese `mo` (1-12) dell'anno `y`. */
function giorniNelMese(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Range con cui nasce il tab personalizzato: ultimo mese in giorni di
 * calendario romani. Il giorno viene da `romeYmd` e non da `getDate()` perché
 * il runtime su Vercel è UTC e fino all'una di notte italiana sbaglierebbe
 * data. La sottrazione clampa al fondo del mese: dal 31 marzo si torna al 28
 * febbraio, non al 3 marzo come farebbe `setMonth` da solo.
 */
export function defaultCustomRange(now: Date): { da: string; a: string } {
  const [y, mo, d] = romeYmd(now);
  const annoPrec = mo === 1 ? y - 1 : y;
  const mesePrec = mo === 1 ? 12 : mo - 1;
  return {
    da: ymdString(annoPrec, mesePrec, Math.min(d, giorniNelMese(annoPrec, mesePrec))),
    a: ymdString(y, mo, d),
  };
}

/**
 * Bound del periodo come filtro Prisma su un campo data. `undefined` quando il
 * range è aperto da entrambi i lati: un `{}` passato a Prisma sarebbe un
 * filtro inerte, ma renderebbe impossibile distinguere "nessun filtro" dal
 * lato del chiamante.
 */
export function periodoDateFilter(r: PeriodoRisolto): { gte?: Date; lte?: Date } | undefined {
  if (!r.gte && !r.lte) return undefined;
  return { ...(r.gte ? { gte: r.gte } : {}), ...(r.lte ? { lte: r.lte } : {}) };
}
```

- [ ] **Step 4: lancia il test e verifica che passi**

```
cd apps/piattaforma && npx vitest run src/lib/finanze/periodo.test.ts
```

Atteso: PASS, 18 test.

- [ ] **Step 5: commit**

```bash
git add apps/piattaforma/src/lib/finanze/periodo.ts apps/piattaforma/src/lib/finanze/periodo.test.ts
git commit -m "feat(finanze): un solo risolutore del periodo, che sa anche dire da e a"
```

---

### Task 2: l'export CSV smette di inventarsi il periodo

Chiude il difetto in produzione: da "Ultime 24h" il CSV scarica un anno.

**Files:**
- Modify: `apps/piattaforma/src/app/api/admin/dashboard/export/route.ts`
- Test: `apps/piattaforma/src/app/api/admin/dashboard/export/route.test.ts` (nuovo)

**Interfaces:**
- Consumes: `parsePeriodo`, `resolvePeriodo`, `periodoDateFilter` dal Task 1.
- Produces: nessuna nuova interfaccia. La route accetta ora anche `da` e `a` in query.

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `apps/piattaforma/src/app/api/admin/dashboard/export/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La route deve passare per il risolutore condiviso `lib/finanze/periodo`, non
 * per una sua copia: la copia locale era già divergente (nessun ramo per
 * `giorno`, catturato dall'`else` di `anno`) e dal tab 24h il CSV scaricava un
 * anno intero. Qui si verifica il comportamento, non l'import.
 */

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { pratica: { findMany: vi.fn() } },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { GET } from './route';

const URL_BASE = 'http://localhost/api/admin/dashboard/export';

function whereDellaChiamata() {
  return prismaMock.pratica.findMany.mock.calls[0]![0].where as {
    createdAt?: { gte?: Date; lte?: Date };
    tipo?: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.pratica.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/dashboard/export — permessi', () => {
  it('senza sessione: 401 e nessuna query', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request(`${URL_BASE}?periodo=mese`));
    expect(res.status).toBe(401);
    expect(prismaMock.pratica.findMany).not.toHaveBeenCalled();
  });
  it('ruolo non admin piattaforma: 403 e nessuna query', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA' } });
    const res = await GET(new Request(`${URL_BASE}?periodo=mese`));
    expect(res.status).toBe(403);
    expect(prismaMock.pratica.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/dashboard/export — periodo', () => {
  it('periodo=giorno esporta 24 ore, non un anno (regressione)', async () => {
    await GET(new Request(`${URL_BASE}?periodo=giorno`));
    const gte = whereDellaChiamata().createdAt!.gte!;
    const oreIndietro = (Date.now() - gte.getTime()) / 3_600_000;
    expect(oreIndietro).toBeGreaterThan(23.5);
    expect(oreIndietro).toBeLessThan(24.5);
  });

  it('periodo=custom filtra fra i due giorni interi, in Europe/Rome', async () => {
    await GET(new Request(`${URL_BASE}?periodo=custom&da=2026-06-01&a=2026-06-30`));
    const createdAt = whereDellaChiamata().createdAt!;
    expect(createdAt.gte!.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(createdAt.lte!.toISOString()).toBe('2026-06-30T21:59:59.999Z');
  });

  it('periodo sconosciuto ricade su mese, non sull ultimo ramo', async () => {
    await GET(new Request(`${URL_BASE}?periodo=pippo`));
    const gte = whereDellaChiamata().createdAt!.gte!;
    const giorniIndietro = (Date.now() - gte.getTime()) / 86_400_000;
    expect(giorniIndietro).toBeGreaterThan(27);
    expect(giorniIndietro).toBeLessThan(32);
  });

  it('il filtro tipo resta indipendente dal periodo', async () => {
    await GET(new Request(`${URL_BASE}?periodo=custom&da=2026-06-01&tipo=MINIVOLTURA`));
    expect(whereDellaChiamata().tipo).toBe('MINIVOLTURA');
  });

  it('il nome del file riporta il range, non la parola custom', async () => {
    const res = await GET(new Request(`${URL_BASE}?periodo=custom&da=2026-06-01&a=2026-06-30`));
    expect(res.headers.get('Content-Disposition')).toContain('pratiche-2026-06-01_2026-06-30');
  });
});
```

- [ ] **Step 2: lancia il test e verifica che fallisca**

```
cd apps/piattaforma && npx vitest run src/app/api/admin/dashboard/export/route.test.ts
```

Atteso: FAIL sul test `periodo=giorno` (riceve ~365 giorni invece di 1) e su quello del nome file.

- [ ] **Step 3: modifica la route**

In `apps/piattaforma/src/app/api/admin/dashboard/export/route.ts`:

1. Cancella le righe 9-17 (il `type Periodo` locale e `startOfPeriodo`).
2. Aggiungi l'import dopo quello di `canViewAggregatedFinancials`:

```ts
import { parsePeriodo, resolvePeriodo, periodoDateFilter } from '@/lib/finanze/periodo';
```

3. Sostituisci il blocco che legge la query e costruisce il `where`:

```ts
  const url = new URL(req.url);
  const periodo = parsePeriodo(url.searchParams.get('periodo'));
  const range = resolvePeriodo({
    periodo,
    da: url.searchParams.get('da') ?? undefined,
    a: url.searchParams.get('a') ?? undefined,
  });
  const tipo = url.searchParams.get('tipo') ?? '';

  const where: Prisma.PraticaWhereInput = { deletedAt: null };
  const dateFilter = periodoDateFilter(range);
  if (dateFilter) where.createdAt = dateFilter;
  if (tipo === 'SEMPLICE' || tipo === 'MINIVOLTURA') {
    where.tipo = tipo;
  }
```

4. Sostituisci la riga del `filename`:

```ts
  // Su `custom` la parola "custom" non direbbe nulla una volta salvato sul
  // disco: nel nome ci vanno le due date.
  const periodoSlug =
    periodo === 'custom' ? `${range.da || 'inizio'}_${range.a || 'oggi'}` : periodo;
  const filename = `pratiche-${periodoSlug}${tipo ? `-${tipo.toLowerCase()}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
```

- [ ] **Step 4: lancia il test e verifica che passi**

```
cd apps/piattaforma && npx vitest run src/app/api/admin/dashboard/export/route.test.ts
```

Atteso: PASS, 7 test.

- [ ] **Step 5: commit**

```bash
git add apps/piattaforma/src/app/api/admin/dashboard/export/route.ts apps/piattaforma/src/app/api/admin/dashboard/export/route.test.ts
git commit -m "fix(finanze): il CSV esportava un anno quando chiedevi le ultime 24 ore"
```

---

### Task 3: quinto tab e campi data nella pagina Finanze

**Files:**
- Create: `apps/piattaforma/src/app/admin/dashboard/filtri-periodo.tsx`
- Modify: `apps/piattaforma/src/app/admin/dashboard/page.tsx`

**Interfaces:**
- Consumes: `parsePeriodo`, `resolvePeriodo`, `periodoDateFilter`, `periodoLabel`, `defaultCustomRange`, `type Periodo` dal Task 1.
- Produces: `FiltriPeriodoCustom({ da, a, tipo }: { da: string; a: string; tipo: string })` — client component.

- [ ] **Step 1: crea il client component dei campi data**

Crea `apps/piattaforma/src/app/admin/dashboard/filtri-periodo.tsx`. Stesso pattern di `app/addebiti/filters.tsx` (form GET, auto-submit su `onChange`):

```tsx
'use client';

import { useRef } from 'react';

const CONTROL =
  'rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-pv-slate-500';

/**
 * Campi data del periodo personalizzato. `periodo` e `tipo` viaggiano come
 * hidden: senza di loro il submit del form perderebbe il tab attivo e il
 * filtro tipo pratica, riportando la pagina al default.
 */
export function FiltriPeriodoCustom({ da, a, tipo }: { da: string; a: string; tipo: string }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      action="/admin/dashboard"
      method="get"
      className="mt-3 flex flex-col gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:flex-wrap sm:items-end"
    >
      <input type="hidden" name="periodo" value="custom" />
      {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
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

- [ ] **Step 2: aggiorna `page.tsx` — testata del file**

Sostituisci le righe 10-29 (i due `type` locali, `startOfPeriodo`, `periodoLabel`) con:

```ts
type TipoFiltro = '' | 'SEMPLICE' | 'MINIVOLTURA';

type SearchParams = { periodo?: string; tipo?: TipoFiltro; da?: string; a?: string };
```

e aggiungi agli import in testa:

```ts
import {
  defaultCustomRange,
  parsePeriodo,
  periodoDateFilter,
  periodoLabel,
  resolvePeriodo,
  type Periodo,
} from '@/lib/finanze/periodo';
import { FiltriPeriodoCustom } from './filtri-periodo';
```

- [ ] **Step 3: aggiorna `page.tsx` — risoluzione del periodo e query**

Sostituisci il blocco che oggi calcola `periodo`/`since`/`where` (righe 52-61):

```ts
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.periodo);
  const tipo: TipoFiltro = sp.tipo ?? '';
  const range = resolvePeriodo({ periodo, da: sp.da, a: sp.a });
  const dateFilter = periodoDateFilter(range);

  const where: Prisma.PraticaWhereInput = { deletedAt: null };
  if (dateFilter) where.createdAt = dateFilter;
  if (tipo) where.tipo = tipo;
```

Nella query dei payout, sostituisci `eseguitoAt: { gte: since }`:

```ts
    prisma.payout.aggregate({
      where: { stato: 'ESEGUITO', ...(dateFilter ? { eseguitoAt: dateFilter } : {}) },
      _sum: { importoCent: true },
      _count: true,
    }),
```

L'aggregato `wallet` resta invariato: è lo snapshot dei saldi correnti, non un aggregato di periodo.

- [ ] **Step 4: aggiorna `page.tsx` — intestazione, export e tab**

`exportHref` (riga 132):

```ts
  const exportParams = new URLSearchParams({ periodo });
  if (tipo) exportParams.set('tipo', tipo);
  if (range.da) exportParams.set('da', range.da);
  if (range.a) exportParams.set('a', range.a);
  const exportHref = `/api/admin/dashboard/export?${exportParams.toString()}`;
```

Sottotitolo dell'intestazione (riga 146): `{periodoLabel(periodo)}` → `{range.label}`.

Etichetta della card "Già erogato" (riga 212): `{periodoLabel(periodo).toLowerCase()}` → `{range.label.toLowerCase()}`.

Render dei tab (righe 158-159):

```tsx
        <PeriodoTabs current={periodo} tipo={tipo} da={range.da} a={range.a} />
        {periodo === 'custom' ? (
          <FiltriPeriodoCustom da={range.da} a={range.a} tipo={tipo} />
        ) : null}
        <TipoTabs current={tipo} periodo={periodo} da={range.da} a={range.a} />
```

- [ ] **Step 5: aggiorna `page.tsx` — i due componenti dei tab**

Sostituisci `PeriodoTabs` e `TipoTabs` in fondo al file:

```tsx
function PeriodoTabs({
  current,
  tipo,
  da,
  a,
}: {
  current: Periodo;
  tipo: TipoFiltro;
  da: string;
  a: string;
}) {
  const periodi: Periodo[] = ['giorno', 'settimana', 'mese', 'anno', 'custom'];
  // Il tab personalizzato porta le date già nell'href: precompilare solo il
  // defaultValue degli input lascerebbe i campi a dire una cosa e le card a
  // mostrarne un'altra finché non si tocca un input.
  const preset = defaultCustomRange(new Date());
  return (
    <div className="flex flex-wrap gap-2 border-b border-pv-slate-200">
      {periodi.map((p) => {
        const params = new URLSearchParams({ periodo: p });
        if (tipo) params.set('tipo', tipo);
        if (p === 'custom') {
          params.set('da', da || preset.da);
          params.set('a', a || preset.a);
        }
        const active = p === current;
        return (
          <a
            key={p}
            href={`/admin/dashboard?${params.toString()}`}
            className={
              active
                ? 'border-b-2 border-pv-navy-700 px-3 py-2 text-[13px] font-bold text-pv-navy-700'
                : 'px-3 py-2 text-[13px] font-semibold text-pv-slate-500 hover:text-pv-navy-700'
            }
          >
            {periodoLabel(p)}
          </a>
        );
      })}
    </div>
  );
}

function TipoTabs({
  current,
  periodo,
  da,
  a,
}: {
  current: TipoFiltro;
  periodo: Periodo;
  da: string;
  a: string;
}) {
  const opzioni: { value: TipoFiltro; label: string }[] = [
    { value: '', label: 'Tutti i tipi' },
    { value: 'SEMPLICE', label: 'Passaggio di proprietà semplice' },
    { value: 'MINIVOLTURA', label: 'Minivoltura' },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {opzioni.map((o) => {
        const params = new URLSearchParams({ periodo });
        if (o.value) params.set('tipo', o.value);
        // Senza queste due, cambiare tipo pratica da un range personalizzato
        // riporterebbe la pagina al periodo di default.
        if (periodo === 'custom') {
          if (da) params.set('da', da);
          if (a) params.set('a', a);
        }
        const active = o.value === current;
        return (
          <a
            key={o.value || 'all'}
            href={`/admin/dashboard?${params.toString()}`}
            className={
              active
                ? 'rounded-full bg-pv-navy-700 px-3 py-1 text-[12px] font-semibold text-white'
                : 'rounded-full border border-pv-slate-300 px-3 py-1 text-[12px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50'
            }
          >
            {o.label}
          </a>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: lint e suite completa**

```
cd apps/piattaforma && npx eslint src/app/admin/dashboard src/lib/finanze && npx vitest run
```

Atteso: eslint pulito, suite verde. Se `pnpm typecheck` è già stato lanciato in questa sessione (cache calda) rilancialo; da cache fredda saltalo.

- [ ] **Step 7: commit**

```bash
git add apps/piattaforma/src/app/admin/dashboard/
git commit -m "feat(finanze): tab personalizzato, per chiedere un mese di calendario invece di trenta giorni fa"
```

---

### Task 4: verifica nel browser

I due bug che i test non avrebbero visto in passato — un tab che si spegne, il focus rubato — sono arrivati solo dal browser. Questo task non è opzionale e non si chiude navigando per URL: i tab vanno **cliccati**.

**Files:** nessuno (solo verifica; eventuali fix rientrano nei task sopra).

- [ ] **Step 1: avvia l'app**

```
nvm use 22.15.0
pnpm --filter piattaforma dev
```

Se la porta 3000 risponde con codice vecchio, il processo Next precedente è ancora vivo: va ucciso, fermare il task non basta.

- [ ] **Step 2: entra come admin piattaforma**

Login su `http://localhost:3000/login` con un utente `ADMIN_PIATTAFORMA` (le password del seed non valgono sul DB locale, che è una copia di prod). Vai su Finanze dalla sidebar.

- [ ] **Step 3: verifica il tab, cliccandolo**

- Clic su **Personalizzato**: i due campi compaiono già valorizzati con l'ultimo mese, il sottotitolo dice "Dal GG/MM/AAAA al GG/MM/AAAA", il tab resta evidenziato.
- Cambia la data "Da": la pagina si ricarica da sola e le card cambiano numero.
- Da tab personalizzato clicca **Minivoltura**: le date restano, il periodo non torna a "Ultimo mese".
- Clicca **Ultimo mese** e poi di nuovo **Personalizzato**: le date tornano al preset, nessuno stato sporco.

- [ ] **Step 4: verifica l'export**

Con un range personalizzato attivo, clicca **Esporta CSV**: il file scaricato si chiama `pratiche-<da>_<a>-<oggi>.csv` e contiene solo pratiche con `createdAt` dentro il range. Ripeti dal tab **Ultime 24h**: il CSV ora contiene le ultime 24 ore, non un anno.

- [ ] **Step 5: commit di eventuali fix**

Se la verifica ha prodotto correzioni, committale con un messaggio che dica cosa il browser ha mostrato e i test no.

---

## Note di chiusura

- La pagina resta un Server Component: i campi data sono l'unico pezzo client, come in Addebiti.
- Range invertito (`da` > `a`): nessuna validazione, Prisma torna zero righe e si vedono gli stati vuoti già presenti. Se in review si decide di renderlo esplicito, è un ramo in `labelCustom` più un `Alert`.
- Da valutare in un lavoro successivo, fuori da questo piano: la stessa fascia di filtri date esiste ora in tre punti (Addebiti, Feedback, Finanze) con markup copiato. Se ne nasce un quarto, conviene estrarre un componente condiviso.
