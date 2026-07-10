# Filtri Feedback (range date + sede) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla pagina `/feedback` un filtro range-date per tutte le utenze dell'agenzia e, per il solo proprietario, un filtro per sede + la sede mostrata in ogni card.

**Architecture:** Tutta la logica di composizione del `where` (scope sede + narrowing owner + range date con timezone Europe/Rome) vive in un helper puro `lib/feedback/query.ts`, testabile senza DB. La pagina server (`feedback/page.tsx`) chiama l'helper e passa i default a un piccolo form client GET (`feedback/filters.tsx`) che rispecchia il pattern esistente `admin/pratiche/filters.tsx`.

**Tech Stack:** Next.js 16 App Router (server components), Prisma/Postgres (`@pv/db`), Vitest, Tailwind con design system `pv-*`.

## Global Constraints

- **Runtime dev:** Node 22 — dopo un riavvio la shell torna a Node 16; eseguire `nvm use 22.15.0` prima dei comandi pnpm (pnpm richiede ≥18).
- **"superadmin" = proprietario agenzia** `ADMIN_AZIENDA`, ossia `ctx.isOwner`. NON l'admin di piattaforma. Nessuna vista cross-agenzia.
- **Owner su `/feedback` = base SEMPRE aggregata** (tutte le sedi, `{ agenziaId }`): il select in pagina è l'unico controllo sede e **ignora** il cookie globale `pv_sede`. Questo è un cambio di comportamento deliberato per l'owner (prima ereditava il cookie); per i non-owner lo scoping resta identico.
- **Filtro sede + label sede = solo owner.** Gli utenti sede (`UTENTE_AZIENDA`) ottengono solo il filtro date.
- **Coerenza media/conteggio:** lo stesso `where` alimenta `findMany` e `aggregate` (media e conteggio devono riflettere l'insieme filtrato).
- **UX filtri:** form `method="get"`, apply su `onChange` via `requestSubmit()`; il `GlobalNavOverlay` del layout root copre il caricamento. Nessun bottone submit (come il pattern admin).
- **Niente colori hardcoded:** solo classi `pv-*` del design system.
- **Query param:** `da` e `a` in formato `YYYY-MM-DD`; `sede` = id sede. Tutti opzionali; bound malformato → ignorato (fail-open sul singolo bound), sede non accessibile → ignorata (fail-closed → "tutte").

---

## File Structure

- **Create** `apps/piattaforma/src/lib/feedback/query.ts` — helper puro: valida i param, calcola gli istanti UTC dai giorni Europe/Rome, compone il `Prisma.ValutazioneWhereInput`. Riusa `whereValutazione`.
- **Create** `apps/piattaforma/src/lib/feedback/query.test.ts` — unit test vitest dell'helper.
- **Create** `apps/piattaforma/src/app/feedback/filters.tsx` — form client GET (date + select sede opzionale).
- **Modify** `apps/piattaforma/src/app/feedback/page.tsx` — legge `searchParams`, usa l'helper, include `agenziaSede.nome`, rende i filtri e la sede in card, adatta empty-state.

---

## Task 1: Helper puro di composizione filtri (`lib/feedback/query.ts`)

**Files:**
- Create: `apps/piattaforma/src/lib/feedback/query.ts`
- Test: `apps/piattaforma/src/lib/feedback/query.test.ts`

**Interfaces:**
- Consumes: `whereValutazione(scope, agenziaId)` e `type SedeScope` da `@/lib/sedi/scope-filters`; `type Prisma` da `@pv/db`.
- Produces:
  ```ts
  type FeedbackFilterParams = { da?: string; a?: string; sede?: string };
  type ResolvedFeedbackFilters = {
    where: Prisma.ValutazioneWhereInput; // per findMany E aggregate
    sede: string; // sede validata (owner); '' = tutte → default del select
    da: string;   // bound valido ri-emesso (o '') → default input
    a: string;    // bound valido ri-emesso (o '') → default input
    attivi: boolean; // almeno un filtro attivo
  };
  function resolveFeedbackFilters(args: {
    isOwner: boolean;
    agenziaId: string;
    scopeIds: string[];
    accessibleSedeIds: string[];
    params: FeedbackFilterParams;
  }): ResolvedFeedbackFilters;
  ```

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/feedback/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveFeedbackFilters } from './query';

const base = { agenziaId: 'c1', scopeIds: ['s1', 's2'], accessibleSedeIds: ['s1', 's2'] };

describe('resolveFeedbackFilters — scope base', () => {
  it('owner senza filtri: aggregato su tutta la madre', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: {} });
    expect(r.where).toEqual({ agenziaId: 'c1' });
    expect(r.attivi).toBe(false);
    expect(r.sede).toBe('');
  });

  it('non-owner senza filtri: solo le sedi in scope (invariato)', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: false, params: {} });
    expect(r.where).toEqual({ agenziaId: 'c1', agenziaSedeId: { in: ['s1', 's2'] } });
  });
});

describe('resolveFeedbackFilters — filtro sede (owner)', () => {
  it('owner con sede valida: restringe a quella sede', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { sede: 's1' } });
    expect(r.where).toEqual({ agenziaId: 'c1', agenziaSedeId: 's1' });
    expect(r.sede).toBe('s1');
    expect(r.attivi).toBe(true);
  });

  it('owner con sede NON accessibile: ignorata (fail-closed → tutte)', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { sede: 'sX' } });
    expect(r.where).toEqual({ agenziaId: 'c1' });
    expect(r.sede).toBe('');
  });

  it('non-owner: il param sede è ignorato del tutto', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: false, params: { sede: 's1' } });
    expect(r.where).toEqual({ agenziaId: 'c1', agenziaSedeId: { in: ['s1', 's2'] } });
    expect(r.sede).toBe('');
  });
});

describe('resolveFeedbackFilters — range date (Europe/Rome)', () => {
  it('da+a estivi (CEST, +2): createdAt gte/lte in istanti UTC corretti', () => {
    const r = resolveFeedbackFilters({
      ...base,
      isOwner: true,
      params: { da: '2026-07-15', a: '2026-07-20' },
    });
    const c = r.where.createdAt as { gte: Date; lte: Date };
    expect(c.gte.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(c.lte.toISOString()).toBe('2026-07-20T21:59:59.999Z');
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('2026-07-20');
    expect(r.attivi).toBe(true);
  });

  it('data invernale (CET, +1)', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { da: '2026-01-15' } });
    const c = r.where.createdAt as { gte: Date };
    expect(c.gte.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('solo "a": nessun gte', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { a: '2026-07-20' } });
    const c = r.where.createdAt as { gte?: Date; lte: Date };
    expect(c.gte).toBeUndefined();
    expect(c.lte.toISOString()).toBe('2026-07-20T21:59:59.999Z');
  });

  it('date malformate o impossibili: ignorate, nessun createdAt', () => {
    const r = resolveFeedbackFilters({
      ...base,
      isOwner: true,
      params: { da: '15/07/2026', a: '2026-02-30' },
    });
    expect(r.where).toEqual({ agenziaId: 'c1' });
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.attivi).toBe(false);
  });

  it('combina sede + date per l’owner', () => {
    const r = resolveFeedbackFilters({
      ...base,
      isOwner: true,
      params: { sede: 's2', da: '2026-07-15' },
    });
    expect(r.where).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: 's2',
      createdAt: { gte: new Date('2026-07-14T22:00:00.000Z') },
    });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisce**

Run: `pnpm --filter piattaforma test src/lib/feedback/query.test.ts`
Expected: FAIL — `Failed to resolve import "./query"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa l'helper**

Crea `apps/piattaforma/src/lib/feedback/query.ts`:

```ts
import type { Prisma } from '@pv/db';
import { whereValutazione, type SedeScope } from '@/lib/sedi/scope-filters';

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

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROME_TZ = 'Europe/Rome';

/** Valida che la stringa sia una data di calendario reale in formato YYYY-MM-DD. */
function parseYmd(value: string | undefined): [number, number, number] | null {
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
  const naive = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  // Doppio passaggio: stabilizza il caso raro di transizione DST.
  const utc = naive - romeOffsetMs(naive - romeOffsetMs(naive));
  return new Date(utc);
}

function romeStartOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 0, 0, 0, 0);
}

function romeEndOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 23, 59, 59, 999);
}

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
  const daYmd = parseYmd(params.da);
  const aYmd = parseYmd(params.a);
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (daYmd) createdAt.gte = romeStartOfDay(daYmd);
  if (aYmd) createdAt.lte = romeEndOfDay(aYmd);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  return {
    where,
    sede,
    da: daYmd ? params.da! : '',
    a: aYmd ? params.a! : '',
    attivi: Boolean(sede || daYmd || aYmd),
  };
}
```

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `pnpm --filter piattaforma test src/lib/feedback/query.test.ts`
Expected: PASS (tutti i `describe`/`it` verdi).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/feedback/query.ts apps/piattaforma/src/lib/feedback/query.test.ts
git commit -m "feat(feedback): helper puro filtri range-date + sede owner"
```

---

## Task 2: Form filtri client + integrazione pagina

**Files:**
- Create: `apps/piattaforma/src/app/feedback/filters.tsx`
- Modify: `apps/piattaforma/src/app/feedback/page.tsx`

**Interfaces:**
- Consumes: `resolveFeedbackFilters` (Task 1); `getSessionContext` (`ctx.isOwner`, `ctx.companyId`, `ctx.scopeIds`, `ctx.accessibleSedi: { id, nome }[]`).
- Produces:
  ```ts
  // filters.tsx
  type Option = { value: string; label: string };
  function FeedbackFilters(props: {
    da: string;
    a: string;
    sede?: string;
    sedi?: Option[]; // passato solo per l'owner → abilita il filtro sede
  }): JSX.Element;
  ```

- [ ] **Step 1: Crea il form client `filters.tsx`**

Crea `apps/piattaforma/src/app/feedback/filters.tsx`:

```tsx
'use client';

import { useRef } from 'react';

type Option = { value: string; label: string };

type Props = {
  da: string;
  a: string;
  sede?: string;
  /** Passato solo per il proprietario: abilita il filtro sede. */
  sedi?: Option[];
};

const CONTROL =
  'rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-pv-slate-500';

export function FeedbackFilters({ da, a, sede, sedi }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      action="/feedback"
      method="get"
      className="mb-5 flex flex-col gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:flex-wrap sm:items-end"
    >
      <label className={LABEL}>
        Da
        <input type="date" name="da" defaultValue={da} onChange={submit} className={CONTROL} />
      </label>
      <label className={LABEL}>
        A
        <input type="date" name="a" defaultValue={a} onChange={submit} className={CONTROL} />
      </label>
      {sedi && (
        <label className={`${LABEL} sm:ml-auto`}>
          Sede
          <select name="sede" defaultValue={sede ?? ''} onChange={submit} className={CONTROL}>
            {sedi.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Riscrivi `page.tsx` per usare l'helper, i filtri e la sede in card**

Sostituisci integralmente `apps/piattaforma/src/app/feedback/page.tsx` con:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { assertPermesso } from '@/lib/auth/permessi/guard';
import { getSessionContext } from '@/lib/auth/session-context';
import { resolveFeedbackFilters } from '@/lib/feedback/query';
import { FeedbackFilters } from './filters';
import { Stars } from './stars';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ da?: string; a?: string; sede?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  await assertPermesso('feedback.view');

  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/feedback">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">
            I feedback sono disponibili solo per le agenzie.
          </p>
        </div>
      </AppShell>
    );
  }

  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/login');
  const agenziaId = ctx.companyId;
  const sp = await searchParams;

  // Owner: base sempre aggregata (tutte le sedi), il select in pagina è l'unico
  // controllo sede → ignora il cookie globale. Non-owner: scope invariato.
  const { where, sede, da, a, attivi } = resolveFeedbackFilters({
    isOwner: ctx.isOwner,
    agenziaId,
    scopeIds: ctx.scopeIds,
    accessibleSedeIds: ctx.accessibleSedi.map((s) => s.id),
    params: sp,
  });

  // Media e conteggio calcolati sullo STESSO where della lista (coerenza voluta).
  const [valutazioni, agg] = await Promise.all([
    prisma.valutazione.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        dealer: { select: { ragioneSociale: true } },
        pratica: { select: { id: true, codicePratica: true } },
        agenziaSede: { select: { nome: true } },
      },
    }),
    prisma.valutazione.aggregate({
      where,
      _avg: { stelle: true },
      _count: { _all: true },
    }),
  ]);

  const count = agg._count._all;
  const media = agg._avg.stelle;

  // Filtro sede solo per l'owner (superadmin dell'agenzia).
  const sediOptions = ctx.isOwner
    ? [
        { value: '', label: 'Tutte le sedi' },
        ...ctx.accessibleSedi.map((s) => ({ value: s.id, label: s.nome })),
      ]
    : undefined;

  return (
    <AppShell session={session} activePath="/feedback">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Agenzia
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Feedback ricevuti
          </h1>
          {count > 0 && media !== null && (
            <p className="mt-1 text-[14px] text-pv-slate-500">
              Media <span className="font-bold text-pv-navy-800">{media.toFixed(1)} ★</span> ·{' '}
              {count} feedback ricevut{count === 1 ? 'o' : 'i'}
              {attivi ? ' (filtri attivi)' : ''}
            </p>
          )}
        </header>

        <FeedbackFilters da={da} a={a} sede={sede} sedi={sediOptions} />

        {valutazioni.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[14px] text-pv-slate-500">
              {attivi
                ? 'Nessun feedback per i filtri selezionati.'
                : 'Nessun feedback ricevuto ancora.'}
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {valutazioni.map((v) => (
              <li key={v.id}>
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <Stars n={v.stelle} />
                    <span className="text-[12px] text-pv-slate-500">
                      {formatRelative(v.createdAt)}
                    </span>
                  </div>
                  {v.note && (
                    <p className="mt-2 text-[13.5px] text-pv-slate-700">
                      &ldquo;{v.note}&rdquo;
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-pv-slate-500">
                    <span className="font-semibold text-pv-navy-700">
                      {v.dealer.ragioneSociale}
                    </span>
                    <span>·</span>
                    <Link
                      href={`/pratiche/${v.pratica.id}`}
                      className="font-mono font-semibold text-pv-navy-600 hover:underline"
                    >
                      {v.pratica.codicePratica ?? '—'}
                    </Link>
                    {ctx.isOwner && (
                      <>
                        <span>·</span>
                        <span className="font-semibold text-pv-navy-700">
                          {v.agenziaSede?.nome ?? 'Sede non assegnata'}
                        </span>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Typecheck e lint dell'app**

Run: `pnpm --filter piattaforma lint`
Expected: nessun errore sui file toccati.

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS. ⚠️ Se `tsc` esplode a cache fredda (stack overflow / falsi errori Prisma noti in questo repo), scaldare prima la cache con un `pnpm --filter piattaforma build` o affidarsi a `pnpm typecheck` (turbo, usa il `tsbuildinfo`).

- [ ] **Step 4: Esegui l'intera suite vitest dell'app (nessuna regressione)**

Run: `pnpm --filter piattaforma test`
Expected: PASS, inclusi i test di Task 1.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/feedback/filters.tsx apps/piattaforma/src/app/feedback/page.tsx
git commit -m "feat(feedback): filtro range-date (tutti) + filtro sede e sede in card (owner)"
```

---

## Verifica end-to-end (fine fase)

Non è una task TDD: è il gate di verifica prima di considerare la feature chiusa. Coerente con la prassi "e2e a fine fase" e "prova le query nuove sul DB reale".

- [ ] **Smoke manuale** — `nvm use 22.15.0` poi `pnpm --filter piattaforma dev`:
  - Login come **proprietario agenzia** (`ADMIN_AZIENDA`) di un'agenzia multi-sede → `/feedback`:
    - Compaiono gli input **Da/A** e il **select Sede** ("Tutte le sedi" + le sedi).
    - Ogni card mostra il **nome sede** (o "Sede non assegnata" per righe legacy).
    - Selezionando una sede → la lista + la riga "Media … N feedback" si restringono in modo coerente e appare "(filtri attivi)".
    - Impostando **Da/A** → la lista si restringe al periodo; media/conteggio coerenti.
  - Login come **utente sede** (`UTENTE_AZIENDA`) → `/feedback`:
    - Compaiono **solo** Da/A; **nessun** select sede; **nessuna** label sede in card.
    - Il filtro date funziona; i feedback restano scopati alle sue sedi.
- [ ] **Check DB read-only** (facoltativo ma consigliato) — sul Postgres locale (copia di prod), verifica che esistano `valutazioni` con `agenziaSedeId` valorizzato e/o `NULL` per un'agenzia multi-sede, così da coprire sia il caso "sede assegnata" sia il fallback "Sede non assegnata". Esempio query di sola lettura:
  ```sql
  SELECT "agenziaId", "agenziaSedeId", count(*)
  FROM valutazioni
  GROUP BY 1, 2
  ORDER BY 1;
  ```
- [ ] **Aggiorna la memoria** dopo il rilascio: annota la feature (filtri feedback owner-only sede) come fatta, coerente con lo stile delle altre note `project_*`.

---

## Self-review (eseguito)

- **Spec coverage:** filtro date tutti → Task 1 (`createdAt`) + Task 2 (input); filtro sede owner → Task 1 (narrowing) + Task 2 (select owner-only); sede in card → Task 2 (`include` + render owner-only); owner base aggregata/ignora cookie → Task 1 (`aggregate: isOwner`); coerenza media/conteggio → stesso `where`; edge (sede invalida, date malformate, righe null) → test Task 1 + fallback card. Tutti coperti.
- **Placeholder scan:** nessun TBD/TODO; ogni step ha codice/comando reale.
- **Type consistency:** `resolveFeedbackFilters` (firma e ritorno) coincide tra Task 1 e uso in Task 2; `FeedbackFilters` props coincidono tra `filters.tsx` e la chiamata in `page.tsx`; `ctx.accessibleSedi` usato come `{ id, nome }[]` (coerente con `SessionContext`).
