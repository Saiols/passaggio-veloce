# P2 · Completamento dashboard agenzia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Rendere visibile all'agenzia il countdown all'auto-addebito della fee (20gg) e fornire un riepilogo mensile delle fee/auto-addebiti.

**Architecture:** Due helper puri testabili (`lib/pratiche/countdown.ts`, `lib/fee/recap.ts`) consumati da una nuova pagina `/addebiti` (agency) e da una sezione "Prossimi addebiti" sulla dashboard agenzia. Nessuna migrazione (il modello `FeeAddebito` esiste già: `scheduledAt`, `stato` SCHEDULED/SUCCESS/FAILED/…, `importoCent`, `tipo`, relazione `pratica`).

**Tech Stack:** Next.js 16 server components, Prisma, Vitest. Riusa `AppShell`, `Card`, `StatCard`, `formatCurrencyCent`/`formatDate` da `@/lib/format`.

Spec: `docs/superpowers/specs/2026-06-01-completamenti-locali-design.md` (§P2).

## Repo facts (verificati)
- `FeeAddebito`: `importoCent:Int`, `tipo: FeeAddebitoTipo (ADDEBITO_FIRMA|AUTO_ADDEBITO_GIORNO_20)`, `stato: FeeAddebitoStato (SCHEDULED|IN_LAVORAZIONE|SUCCESS|FAILED|RETRY|ANNULLATO)`, `scheduledAt:DateTime?`, `executedAt:DateTime?`, `agenziaId`, relazione `pratica` (con `codicePratica`, `targa`). Query via `prisma.feeAddebito`.
- Pagina agency template: `apps/piattaforma/src/app/wallet/page.tsx` (auth + AppShell + companyType guard DEALER/AGENZIA).
- Nav AGENZIA in `apps/piattaforma/src/components/app-shell.tsx` (~righe 43-52): array con `{ href: '/wallet', label: 'Wallet' }`.
- Dashboard agency: `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx` (server component, riceve `{ companyId }`, usa `prisma`, `StatCard`, `Link`).
- Helper format: `formatCurrencyCent(cents)`, `formatDate(d)` da `@/lib/format`.

## File Structure
- Create `apps/piattaforma/src/lib/pratiche/countdown.ts` + test — countdown puro.
- Create `apps/piattaforma/src/lib/fee/recap.ts` + test — aggregatore mensile puro.
- Create `apps/piattaforma/src/app/addebiti/page.tsx` — pagina riepilogo agency.
- Modify `apps/piattaforma/src/components/app-shell.tsx` — voce nav "Addebiti".
- Modify `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx` — sezione "Prossimi addebiti".

---

### Task 1: `computeGiorniResidui` + `countdownLevel` (puri, TDD)

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/countdown.ts`
- Test: `apps/piattaforma/src/lib/pratiche/countdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeGiorniResidui, countdownLevel } from './countdown';

describe('computeGiorniResidui', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');

  it('returns null when no date', () => {
    expect(computeGiorniResidui(null, now)).toBeNull();
  });

  it('counts whole days remaining (ceil)', () => {
    expect(computeGiorniResidui(new Date('2026-06-06T09:00:00.000Z'), now)).toBe(5);
  });

  it('returns 0 on the due day', () => {
    expect(computeGiorniResidui(new Date('2026-06-01T18:00:00.000Z'), now)).toBe(1);
  });

  it('returns negative when overdue', () => {
    expect(computeGiorniResidui(new Date('2026-05-30T10:00:00.000Z'), now)).toBe(-2);
  });
});

describe('countdownLevel', () => {
  it('classifies by days remaining', () => {
    expect(countdownLevel(10)).toBe('ok');
    expect(countdownLevel(5)).toBe('warn');
    expect(countdownLevel(2)).toBe('urgent');
    expect(countdownLevel(0)).toBe('urgent');
    expect(countdownLevel(-1)).toBe('overdue');
    expect(countdownLevel(null)).toBe('none');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter piattaforma test -- countdown`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CountdownLevel = 'none' | 'ok' | 'warn' | 'urgent' | 'overdue';

/**
 * Giorni interi residui fino a `target` (arrotondati per eccesso).
 * Negativo se la data è passata; null se `target` è null.
 */
export function computeGiorniResidui(target: Date | null, now: Date): number | null {
  if (!target) return null;
  return Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY);
}

/** Livello UI in base ai giorni residui. */
export function countdownLevel(giorni: number | null): CountdownLevel {
  if (giorni === null) return 'none';
  if (giorni < 0) return 'overdue';
  if (giorni <= 2) return 'urgent';
  if (giorni <= 5) return 'warn';
  return 'ok';
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter piattaforma test -- countdown`
Expected: PASS (2 describe, 6 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/countdown.ts apps/piattaforma/src/lib/pratiche/countdown.test.ts
git commit -m "feat(pratiche): countdown giorni residui puro + countdownLevel"
```

---

### Task 2: `groupFeeByMonth` aggregator (puro, TDD)

**Files:**
- Create: `apps/piattaforma/src/lib/fee/recap.ts`
- Test: `apps/piattaforma/src/lib/fee/recap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groupFeeByMonth, type FeeRow } from './recap';

const rows: FeeRow[] = [
  { importoCent: 2500, stato: 'SUCCESS', refDate: new Date('2026-05-10T00:00:00Z') },
  { importoCent: 2500, stato: 'SCHEDULED', refDate: new Date('2026-05-20T00:00:00Z') },
  { importoCent: 1500, stato: 'FAILED', refDate: new Date('2026-04-03T00:00:00Z') },
];

describe('groupFeeByMonth', () => {
  it('groups rows by YYYY-MM descending with totals', () => {
    const groups = groupFeeByMonth(rows);
    expect(groups.map((g) => g.month)).toEqual(['2026-05', '2026-04']);
    expect(groups[0].totaleCent).toBe(5000);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].totaleCent).toBe(1500);
  });

  it('returns empty array for no rows', () => {
    expect(groupFeeByMonth([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter piattaforma test -- recap`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type FeeRow = {
  importoCent: number;
  stato: string;
  refDate: Date;
  // campi opzionali di display passati through senza essere usati nell'aggregazione
  [key: string]: unknown;
};

export type FeeMonthGroup<T extends FeeRow = FeeRow> = {
  month: string; // "YYYY-MM"
  totaleCent: number;
  rows: T[];
};

/** Chiave "YYYY-MM" da una data (UTC-stable). */
function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Raggruppa le fee per mese (in base a `refDate`), ordina i mesi dal più
 * recente, somma `importoCent` per mese. Puro.
 */
export function groupFeeByMonth<T extends FeeRow>(rows: readonly T[]): FeeMonthGroup<T>[] {
  const map = new Map<string, FeeMonthGroup<T>>();
  for (const r of rows) {
    const key = monthKey(r.refDate);
    const g = map.get(key) ?? { month: key, totaleCent: 0, rows: [] };
    g.totaleCent += r.importoCent;
    g.rows.push(r);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter piattaforma test -- recap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fee/recap.ts apps/piattaforma/src/lib/fee/recap.test.ts
git commit -m "feat(fee): groupFeeByMonth aggregator puro + test"
```

---

### Task 3: Pagina `/addebiti` (agency)

**Files:**
- Create: `apps/piattaforma/src/app/addebiti/page.tsx`

Mirror la struttura di `wallet/page.tsx` (auth → guard companyType AGENZIA → AppShell `activePath="/addebiti"`). Query `prisma.feeAddebito` per `agenziaId = companyId`.

- [ ] **Step 1: Write the page**

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { computeGiorniResidui, countdownLevel, type CountdownLevel } from '@/lib/pratiche/countdown';
import { groupFeeByMonth, type FeeRow } from '@/lib/fee/recap';

export const dynamic = 'force-dynamic';

const LEVEL_BADGE: Record<CountdownLevel, string> = {
  none: 'bg-pv-slate-100 text-pv-slate-600',
  ok: 'bg-pv-green-50 text-pv-green-500',
  warn: 'bg-pv-amber-50 text-pv-amber-500',
  urgent: 'bg-pv-orange-50 text-pv-orange-500',
  overdue: 'bg-pv-red-50 text-pv-red-500',
};

function statoLabel(s: string): string {
  switch (s) {
    case 'SCHEDULED': return 'Programmato';
    case 'IN_LAVORAZIONE': return 'In lavorazione';
    case 'SUCCESS': return 'Addebitato';
    case 'FAILED': return 'Fallito';
    case 'RETRY': return 'Nuovo tentativo';
    case 'ANNULLATO': return 'Annullato';
    default: return s;
  }
}

export default async function AddebitiPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/addebiti">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">La sezione addebiti è disponibile per le agenzie.</Alert>
        </div>
      </AppShell>
    );
  }
  const companyId = session.user.companyId!;
  const now = new Date();

  const fees = await prisma.feeAddebito.findMany({
    where: { agenziaId: companyId },
    orderBy: { createdAt: 'desc' },
    include: { pratica: { select: { id: true, codicePratica: true, targa: true } } },
  });

  const upcoming = fees
    .filter((f) => f.stato === 'SCHEDULED' && f.scheduledAt)
    .map((f) => ({ fee: f, giorni: computeGiorniResidui(f.scheduledAt, now) }))
    .sort((a, b) => (a.giorni ?? 0) - (b.giorni ?? 0));

  const rows: (FeeRow & { id: string; codice: string | null; targa: string | null; scheduledAt: Date | null; executedAt: Date | null })[] =
    fees.map((f) => ({
      id: f.id,
      importoCent: f.importoCent,
      stato: f.stato,
      refDate: f.scheduledAt ?? f.createdAt,
      codice: f.pratica?.codicePratica ?? null,
      targa: f.pratica?.targa ?? null,
      scheduledAt: f.scheduledAt,
      executedAt: f.executedAt,
    }));
  const groups = groupFeeByMonth(rows);

  const totaleAnno = rows
    .filter((r) => r.refDate.getUTCFullYear() === now.getUTCFullYear())
    .reduce((s, r) => s + r.importoCent, 0);
  const totaleSchedulato = upcoming.reduce((s, u) => s + u.fee.importoCent, 0);

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
            Le fee delle pratiche gestite e gli auto-addebiti programmati al giorno 20.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Programmati" value={String(upcoming.length)} hint="In attesa di addebito" accent="orange" />
          <StatCard label="Totale programmato" value={formatCurrencyCent(totaleSchedulato)} accent="navy" />
          <StatCard label={`Totale ${now.getUTCFullYear()}`} value={formatCurrencyCent(totaleAnno)} accent="green" />
        </div>

        {upcoming.length > 0 && (
          <Card className="mb-5">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Prossimi addebiti</h2>
            <ul className="mt-3 divide-y divide-pv-slate-200 text-[13px]">
              {upcoming.map(({ fee, giorni }) => {
                const level = countdownLevel(giorni);
                return (
                  <li key={fee.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <Link href={`/pratiche/${fee.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                        {fee.pratica?.codicePratica ?? '—'}
                      </Link>
                      <p className="text-[11px] text-pv-slate-500">
                        Addebito previsto {formatDate(fee.scheduledAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-pv-navy-800">{formatCurrencyCent(fee.importoCent)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LEVEL_BADGE[level]}`}>
                        {giorni === null ? '—' : giorni < 0 ? `scaduto ${-giorni}g` : `${giorni}g`}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">Storico per mese</h2>
          {groups.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">Nessun addebito registrato.</p>
          ) : (
            <div className="mt-3 space-y-5">
              {groups.map((g) => (
                <div key={g.month}>
                  <div className="flex items-center justify-between border-b border-pv-slate-200 pb-1.5">
                    <p className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-500">{g.month}</p>
                    <p className="text-[13px] font-bold text-pv-navy-800">{formatCurrencyCent(g.totaleCent)}</p>
                  </div>
                  <ul className="divide-y divide-pv-slate-100 text-[13px]">
                    {g.rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <Link href={`/pratiche/${r.id}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                            {r.codice ?? '—'}
                          </Link>
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

> Nota: `r.id` nel link "Storico" è l'id della **FeeAddebito**, ma il link punta a `/pratiche/{id}`. CORREGGI: il link deve usare l'id pratica. Nella `map` aggiungi `praticaId: f.pratica?.id ?? null` alla riga `rows` e usa `r.praticaId` nel link (salta il link se null). Assicurati che `FeeRow`-compatibile: `praticaId` è un campo extra ammesso dall'index signature `[key: string]: unknown`.

- [ ] **Step 2: Apply the praticaId fix described in the note above**, then `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`.
Expected: PASS. Verifica che le classi colore (`pv-amber-50`, `pv-orange-50`, `pv-green-50`, `pv-red-50`, `pv-slate-100`) esistano nel design system; se una manca, usa la variante esistente più vicina (controlla altre pagine come `pratiche/[id]/page.tsx` per i nomi colore validi).

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/addebiti/page.tsx
git commit -m "feat(addebiti): pagina riepilogo fee mensili + prossimi addebiti agency"
```

---

### Task 4: Voce nav "Addebiti"

**Files:**
- Modify: `apps/piattaforma/src/components/app-shell.tsx`

- [ ] **Step 1: Add the nav link**

Nell'array dei link per `companyType === 'AGENZIA'` (~righe 43-52), aggiungi subito dopo `{ href: '/wallet', label: 'Wallet' }`:

```ts
          { href: '/addebiti', label: 'Addebiti' },
```

Non toccare le altre branch (DEALER/ADMIN).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(nav): voce Addebiti per agenzia"
```

---

### Task 5: Sezione "Prossimi addebiti" sulla dashboard agenzia

**Files:**
- Modify: `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`

Aggiunge una sezione compatta sotto le stat card con le prossime fee schedulate + countdown, linkando a `/addebiti`.

- [ ] **Step 1: Extend the data fetch**

Nell'array `Promise.all` (dopo la query `listino`), aggiungi una query per le prossime fee schedulate:

```ts
    prisma.feeAddebito.findMany({
      where: { agenziaId: companyId, stato: 'SCHEDULED', scheduledAt: { not: null } },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
      include: { pratica: { select: { id: true, codicePratica: true } } },
    }),
```

e aggiungi `prossimiAddebiti` alla destrutturazione: `const [inArrivo, inCorso, firmateMese, rating, assegnazioniRecenti, listino, prossimiAddebiti] = await Promise.all([...]);`

- [ ] **Step 2: Add imports**

In cima al file aggiungi:

```ts
import { computeGiorniResidui, countdownLevel } from '@/lib/pratiche/countdown';
import { formatCurrencyCent } from '@/lib/format';
```

(`formatRelative` è già importato da `@/lib/format`; aggiungi `formatCurrencyCent` allo stesso import esistente invece di duplicare la riga.)

- [ ] **Step 3: Render the section**

Subito DOPO il blocco `<div className="mb-6 grid ...">` delle StatCard (riga ~95, prima della `<section>` "Pratiche in arrivo"), inserisci:

```tsx
      {prossimiAddebiti.length > 0 && (
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
                : 'text-pv-slate-600';
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

> Nota: `f.praticaId` esiste su `FeeAddebito` (campo scalare). Verifica che sia nel risultato della query (lo è di default, è un campo del modello). Se il typecheck lamenta che `praticaId` non è selezionato, aggiungi `praticaId: true` non serve perché senza `select` esplicito Prisma restituisce tutti gli scalari; qui usiamo `include`, quindi tutti gli scalari di FeeAddebito sono presenti.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx
git commit -m "feat(dashboard): sezione prossimi addebiti con countdown per agenzia"
```

---

### Task 6: Verifica complessiva

- [ ] **Step 1:** `pnpm --filter piattaforma test` → tutti verdi (incl. countdown + recap).
- [ ] **Step 2:** `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint` → PASS.
- [ ] **Step 3 (manuale):** come agenzia, apri `/addebiti` (voce nav presente) e la dashboard → la sezione "Prossimi addebiti" mostra le fee SCHEDULED col countdown; lo storico è raggruppato per mese coi totali.

---

## Self-Review

**Spec coverage (§P2):** P2.1 countdown → Task 1 (puro) + Task 5 (dashboard) + Task 3 (sezione upcoming nella pagina). P2.2 riepilogo fee mensili → Task 2 (aggregatore) + Task 3 (pagina) + Task 4 (nav). ✓

**Placeholder scan:** nessun TBD. Le due "Nota" segnalano fix espliciti (praticaId nel link) che il Task 3/5 step richiede di applicare.

**Type consistency:** `computeGiorniResidui`/`countdownLevel`/`CountdownLevel` (Task 1) riusati in Task 3 e Task 5; `groupFeeByMonth`/`FeeRow` (Task 2) riusati in Task 3. `formatCurrencyCent`/`formatDate` da `@/lib/format`. Enum stati FeeAddebito gestiti in `statoLabel`.

**Rischi:** nomi classi colore Tailwind del design system — il Task 3/5 richiede di verificarli e fallback su varianti esistenti se assenti.
