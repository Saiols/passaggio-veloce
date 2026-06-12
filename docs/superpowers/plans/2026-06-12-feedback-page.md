# Feedback page agenzia + rimozione abuso prezzo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere una pagina `/feedback` (agenzia) con tutte le valutazioni ricevute, rendere cliccabile la card "Rating" della dashboard, e rimuovere completamente la feature "segnalazione abuso prezzo".

**Architecture:** Pagina server-component sola-lettura su `Valutazione` (filtrata per agenzia), riuso del `Button`/`Card`/`StatCard` esistenti + nuovo `Stars`. La rimozione abuso tocca form/action/display/seed/schema con migration `DROP COLUMN`. L'anti-abuso ranking e chatbot NON vengono toccati.

**Tech Stack:** Next.js 16 (App Router, Server Components, Server Actions), React 19, Prisma + Postgres, TypeScript, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-feedback-page-design.md`

---

## Task 1: Rimozione "segnalazione abuso prezzo"

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/valutazione-form.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts` (~486-537)
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (~258-262)
- Modify: `packages/db/prisma/seed.ts` (~2169-2243)
- Modify: `packages/db/prisma/schema.prisma:1060`
- Create: `packages/db/prisma/migrations/<timestamp>_drop_segnalazione_abuso/migration.sql` (via `prisma migrate dev`)
- Modify: `docs/piano-implementazione.md` (righe 398, 436)

- [ ] **Step 1: Form — rimuovere checkbox abuso**

In `valutazione-form.tsx`:
- Import: `import { Alert, Button, Card, Checkbox } from '@/components/ui';` → `import { Alert, Button, Card } from '@/components/ui';`
- Rimuovere lo stato: la riga `const [abuso, setAbuso] = useState(false);`
- In `handleSubmit`, rimuovere la riga `if (abuso) fd.append('segnalazioneAbuso', 'true');`
- Rimuovere il blocco JSX della checkbox:

```tsx
      <label className="mt-2 flex items-start gap-2 text-[13px] text-pv-slate-700">
        <Checkbox
          checked={abuso}
          onChange={(e) => setAbuso(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Segnalazione abuso prezzo: ho riscontrato un prezzo chiaramente fuori mercato.
          L&apos;admin prenderà in esame la pratica.
        </span>
      </label>
```

- [ ] **Step 2: Action — rimuovere il campo dallo schema zod e dalla create**

In `pratiche/actions.ts`:
- Rimuovere dal `valutazioneSchema` il campo:

```ts
  segnalazioneAbuso: z
    .preprocess((v) => v === 'true' || v === 'on' || v === true, z.boolean())
    .default(false),
```

- Destructure: `const { praticaId, stelle, note, segnalazioneAbuso } = parsed.data;` → `const { praticaId, stelle, note } = parsed.data;`
- Nella `tx.valutazione.create({ data: { ... } })` rimuovere la riga `segnalazioneAbuso,`.

- [ ] **Step 3: Dettaglio pratica — rimuovere il display**

In `pratiche/[id]/page.tsx` rimuovere il blocco:

```tsx
                  {pratica.valutazione.segnalazioneAbuso && (
                    <p className="mt-1 text-[12px] font-bold uppercase tracking-wider text-pv-red-500">
                      Segnalata per abuso prezzo
                    </p>
                  )}
```

- [ ] **Step 4: Seed — rimuovere il parametro abuso**

In `seed.ts`:
- Helper: rimuovere il parametro `segnalazioneAbuso: boolean,` dalla firma di `createValutazioneIfNotExists` e dalla `data:` della create (`data: { praticaId, agenziaId, dealerId, stelle, note }`).
- Primo call-site (loop 12 valutazioni): rimuovere l'ultimo argomento `false,` dalla chiamata `createValutazioneIfNotExists(p.id, demoPraticheComp.id, p.brokerId, stelle, notePosite[...] ?? null, false)`.
- Blocco "1 valutazione con segnalazioneAbuso": trasformarlo in una valutazione normale. Sostituire:

```ts
    // 1 valutazione con segnalazioneAbuso (cerca una pratica ancora senza valutazione)
    for (const p of pratiche) {
      const exists = await prisma.valutazione.findFirst({ where: { praticaId: p.id } });
      if (!exists) {
        await createValutazioneIfNotExists(
          p.id,
          demoPraticheComp.id,
          p.brokerId,
          4,
          'Inizialmente in ritardo, poi risolto. Segnalo comportamento non corretto nella prima fase.',
          true,
        );
        totalValutazioni++;
        break;
      }
    }
    console.log(`  · valutazioni Demo Pratiche Auto Snc: ~${created} create (target 12+1 abuso)`);
```

con:

```ts
    // 13ª valutazione normale (cerca una pratica ancora senza valutazione)
    for (const p of pratiche) {
      const exists = await prisma.valutazione.findFirst({ where: { praticaId: p.id } });
      if (!exists) {
        await createValutazioneIfNotExists(
          p.id,
          demoPraticheComp.id,
          p.brokerId,
          4,
          'Inizialmente in ritardo, poi risolto nei tempi.',
        );
        totalValutazioni++;
        break;
      }
    }
    console.log(`  · valutazioni Demo Pratiche Auto Snc: ~${created} create (target 13)`);
```

- Verificare gli ALTRI call-site di `createValutazioneIfNotExists` più sotto nel file (agenzie attive aggiuntive, ~riga 2247+) e rimuovere da ciascuno l'ultimo argomento booleano.

- [ ] **Step 5: Schema — rimuovere il campo**

In `schema.prisma` (model `Valutazione`) rimuovere la riga:

```prisma
  segnalazioneAbuso Boolean @default(false)
```

- [ ] **Step 6: Migration + regen client**

Assicurarsi che il Postgres dev (docker) sia attivo, poi:

Run: `cd packages/db && pnpm exec prisma migrate dev --name drop_segnalazione_abuso`
Expected: crea `migrations/<ts>_drop_segnalazione_abuso/migration.sql` con `ALTER TABLE "valutazioni" DROP COLUMN "segnalazioneAbuso";`, applica al DB dev, rigenera il client.

(Se il DB dev non è raggiungibile: avviarlo con il comando docker del progetto, poi ripetere.)

- [ ] **Step 7: Doc — segnare la feature rimossa**

In `docs/piano-implementazione.md`:
- Riga ~398 `- [x] Segnalazione abuso prezzo nelle note (flag segnalazioneAbuso in Valutazione)` → `- [x] ~~Segnalazione abuso prezzo~~ **RIMOSSA (giu-2026)**: flag e UI eliminati, colonna droppata.`
- Riga ~436 `- [ ] Gestione segnalazioni abusi (lista Valutazione.segnalazioneAbuso=true)` → `- [~] ~~Gestione segnalazioni abusi~~ **CANCELLATA (giu-2026)**: feature segnalazione abuso prezzo rimossa.`

- [ ] **Step 8: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore (nessun riferimento residuo a `segnalazioneAbuso`).

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/pratiche packages/db/prisma docs/piano-implementazione.md
git commit -m "feat(valutazioni): rimuovi segnalazione abuso prezzo (UI + action + schema + migration)"
```

---

## Task 2: `StatCard` cliccabile + card Rating → /feedback

**Files:**
- Modify: `apps/piattaforma/src/components/ui/stat-card.tsx`
- Modify: `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`

- [ ] **Step 1: Aggiungere prop `href` opzionale a StatCard**

In `stat-card.tsx`, sostituire il componente con una versione che, se `href` è
presente, rende l'intera card come `<Link>` con affordance hover:

```tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from './cn';

type Props = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: 'navy' | 'orange' | 'green' | 'red' | 'slate';
  href?: string;
};

const accents = {
  navy: 'bg-pv-navy-100 text-pv-navy-700',
  orange: 'bg-[color-mix(in_srgb,#ff7a00_12%,white)] text-pv-orange-500',
  green: 'bg-pv-green-50 text-pv-green-500',
  red: 'bg-pv-red-50 text-pv-red-500',
  slate: 'bg-pv-slate-100 text-pv-slate-700',
};

export function StatCard({ label, value, hint, icon, accent = 'navy', href }: Props) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</p>
        {icon && (
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-[10px]', accents[accent])}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-pv-slate-500">{hint}</p>}
    </>
  );

  const base = 'block rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]';

  if (href) {
    return (
      <Link
        href={href}
        className={cn(base, 'transition-colors transition-shadow hover:border-pv-navy-300 hover:shadow-[var(--pv-shadow-card-lg)]')}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
```

- [ ] **Step 2: Passare `href` alla card Rating**

In `agenzia-dashboard.tsx`, sulla `StatCard label="Rating"` aggiungere `href="/feedback"`:

```tsx
        <StatCard label="Rating" value={ratingValue} hint={ratingHint} icon={<StarIcon />} accent="navy" href="/feedback" />
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/components/ui/stat-card.tsx apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx
git commit -m "feat(dashboard): card Rating cliccabile verso /feedback"
```

---

## Task 3: Pagina `/feedback` + componente `Stars`

**Files:**
- Create: `apps/piattaforma/src/app/feedback/stars.tsx`
- Create: `apps/piattaforma/src/app/feedback/page.tsx`

- [ ] **Step 1: Componente `Stars`**

Create `apps/piattaforma/src/app/feedback/stars.tsx`:

```tsx
/** Rende n stelle piene (arancio) + (5-n) vuote (slate). Presentazionale. */
export function Stars({ n }: { n: number }) {
  const full = Math.max(0, Math.min(5, n));
  return (
    <span className="text-[16px] leading-none" aria-label={`${full} su 5 stelle`}>
      <span className="text-pv-orange-500">{'★'.repeat(full)}</span>
      <span className="text-pv-slate-300">{'★'.repeat(5 - full)}</span>
    </span>
  );
}
```

- [ ] **Step 2: Pagina `/feedback`**

Create `apps/piattaforma/src/app/feedback/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { Stars } from './stars';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

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

  const agenziaId = session.user.companyId!;

  const [valutazioni, agg] = await Promise.all([
    prisma.valutazione.findMany({
      where: { agenziaId },
      orderBy: { createdAt: 'desc' },
      include: {
        dealer: { select: { ragioneSociale: true } },
        pratica: { select: { id: true, codicePratica: true } },
      },
    }),
    prisma.valutazione.aggregate({
      where: { agenziaId },
      _avg: { stelle: true },
      _count: { _all: true },
    }),
  ]);

  const count = agg._count._all;
  const media = agg._avg.stelle;

  return (
    <AppShell session={session} activePath="/feedback">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6 sm:py-10">
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
              {count} {count === 1 ? 'feedback' : 'feedback'} ricevut{count === 1 ? 'o' : 'i'}
            </p>
          )}
        </header>

        {valutazioni.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[14px] text-pv-slate-500">
              Nessun feedback ricevuto ancora.
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

- [ ] **Step 3: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/feedback
git commit -m "feat(feedback): pagina /feedback con valutazioni ricevute dall'agenzia"
```

---

## Task 4: Voce sidebar "Feedback" (agenzia)

**Files:**
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (~50-62)

- [ ] **Step 1: Aggiungere il link nel ramo AGENZIA**

In `getNavLinks`, nel ramo `companyType === 'AGENZIA'`, aggiungere la voce dopo
`{ href: '/pratiche', label: 'Pratiche attive' },`:

```tsx
          { href: '/pratiche', label: 'Pratiche attive' },
          { href: '/feedback', label: 'Feedback' },
          { href: '/orari', label: 'Orari' },
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(nav): voce sidebar Feedback per le agenzie"
```

---

## Task 5: Verifica finale

- [ ] **Step 1: Test suite** — Run: `cd apps/piattaforma && pnpm test` → 459 pass (nessuna regressione; nessun test referenzia `segnalazioneAbuso`).
- [ ] **Step 2: Build** — Run: `cd apps/piattaforma && pnpm build` → OK (route `/feedback` presente).
- [ ] **Step 3: Verifica manuale** — login agenzia → dashboard → click card "Rating" → atterra su `/feedback`; lista con stelle/testo/autore/numero pratica; click numero pratica → dettaglio pratica; voce sidebar "Feedback" evidenziata. Dal dealer: form valutazione non mostra più la checkbox abuso.

---

## Self-Review (coverage vs spec)

- Parte A: pagina `/feedback` (query + header media/conteggio + lista recente-first + empty state) → Task 3 ✓
- Componente `Stars` → Task 3 ✓
- Card Rating cliccabile (`StatCard` href + dashboard) → Task 2 ✓
- Voce sidebar agenzia → Task 4 ✓
- Parte B: rimozione abuso (form, action, display, seed, schema, migration DROP COLUMN, doc) → Task 1 ✓
- Guard agency-only (pattern orari, in-shell message) → Task 3 ✓
- NON toccare anti-abuso ranking/chatbot → nessuna task li include ✓
- Testing (typecheck/build/test/manuale) → Task 5 + typecheck per task ✓
- Commit logici per area → 1 commit per Task ✓
