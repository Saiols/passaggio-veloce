# Badge Inbox real-time (B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare sulla voce Inbox (agenzie) un badge real-time col numero di pratiche in arrivo, aggiornato via polling, con auto-refresh della lista all'aumento.

**Architecture:** Endpoint leggero `/api/badges` che conta le `PraticaAssegnazione` PENDING dell'agenzia; componente client `NavBadge` montato sulla voce Inbox della shell, che polla ogni 25s (a tab visibile), refetcha al focus e fa `router.refresh()` quando il conteggio cresce. Nessun websocket.

**Tech Stack:** Next.js 16 (App Router, Route Handler), React 19 (client component, useEffect/useState), Prisma, TypeScript, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-14-notifiche-realtime-badge-design.md`

---

## Task 1: Endpoint `/api/badges` + componente `NavBadge`

**Files:**
- Create: `apps/piattaforma/src/app/api/badges/route.ts`
- Create: `apps/piattaforma/src/components/nav-badge.tsx`

- [ ] **Step 1: Endpoint conteggi**

Create `apps/piattaforma/src/app/api/badges/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Conteggi per i badge di navigazione (polled dal client). Endpoint generico:
 * oggi ritorna solo `inbox` (pratiche in arrivo per l'agenzia), estendibile.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let inbox = 0;
  if (session.user.companyType === 'AGENZIA' && session.user.companyId) {
    inbox = await prisma.praticaAssegnazione.count({
      where: { agenziaId: session.user.companyId, esito: 'PENDING' },
    });
  }

  return NextResponse.json(
    { inbox },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
```

- [ ] **Step 2: Componente client `NavBadge`**

Create `apps/piattaforma/src/components/nav-badge.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 25_000;

/**
 * Badge real-time per una voce di navigazione. Legge il conteggio da
 * /api/badges (campo `keyName`), polla ogni 25s SOLO a tab visibile e refetcha
 * al ritorno del focus. Quando il conteggio AUMENTA fa router.refresh() così la
 * lista sottostante (Inbox/Dashboard) si aggiorna senza reload manuale.
 */
export function NavBadge({ keyName = 'inbox' }: { keyName?: string }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const fetchCount = async (): Promise<void> => {
      try {
        const res = await fetch('/api/badges', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, number>;
        const next = data[keyName] ?? 0;
        if (cancelled) return;
        setCount(next);
        if (next > prev.current) router.refresh();
        prev.current = next;
      } catch {
        // rete assente: mantieni l'ultimo valore noto
      }
    };

    const start = (): void => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void fetchCount();
      }, POLL_MS);
    };
    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void fetchCount();
        start();
      } else {
        stop();
      }
    };

    void fetchCount(); // primo fetch al mount
    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [keyName, router]);

  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-pv-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#1a1a1a]">
      {count > 99 ? '99+' : count}
    </span>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/api/badges/route.ts apps/piattaforma/src/components/nav-badge.tsx
git commit -m "feat(notifiche): endpoint /api/badges + componente NavBadge (polling)"
```

---

## Task 2: Integrazione badge nella shell (voce Inbox)

**Files:**
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (import + render nav ~136-155)

- [ ] **Step 1: Import del componente**

In cima a `app-shell.tsx`, accanto agli altri import, aggiungere:

```tsx
import { NavBadge } from '@/components/nav-badge';
```

- [ ] **Step 2: Rendere il badge sulla voce Inbox**

Nel `links.map`, sostituire `{l.label}` con label + badge condizionale:

```tsx
                  <Link
                    href={l.href}
                    className={cn(
                      'inline-block whitespace-nowrap px-3.5 py-2.5 font-semibold transition-colors',
                      isActive
                        ? 'border-b-2 border-pv-orange-500 text-white'
                        : 'border-b-2 border-transparent text-[#b8cdea] hover:text-white',
                    )}
                  >
                    {l.label}
                    {l.href === '/inbox' && <NavBadge />}
                  </Link>
```

(La voce `/inbox` esiste solo nel ramo AGENZIA di `navForRole`, quindi il badge appare solo alle agenzie.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(notifiche): badge Inbox real-time nella sidebar agenzia"
```

---

## Task 3: Verifica finale

- [ ] **Step 1: Test suite** — Run: `cd apps/piattaforma && pnpm test` → tutti verdi (nessuna regressione).
- [ ] **Step 2: Build** — Run: `cd apps/piattaforma && pnpm build` → OK, route `/api/badges` presente.
- [ ] **Step 3: Verifica manuale** — login agenzia con pratiche PENDING in arrivo: la voce Inbox mostra il badge col numero entro ~25s dal mount; distribuendo una nuova pratica all'agenzia, entro ~25s (o subito al focus) il numero sale e la lista Inbox/Dashboard si aggiorna senza reload. Con 0 pending, nessun badge. Per dealer/admin nessun badge (l'endpoint ritorna inbox=0 e la voce /inbox non esiste).

---

## Self-Review (coverage vs spec)

- Endpoint `/api/badges` (conteggio PENDING agenzia, 401 se non auth, no-store) → Task 1 ✓
- `NavBadge` (mount fetch + poll 25s a tab visibile + refetch al focus + router.refresh all'aumento + nascosto se 0) → Task 1 ✓
- Integrazione shell sulla voce Inbox (solo agenzie) → Task 2 ✓
- No websocket, nessuna nuova infra, IN_APP/readAt non usati → rispettato ✓
- Testing typecheck/build/manuale → Task 3 ✓
- Fuori scope (toast/banner/CTA/centro notifiche) → non inclusi ✓
- Commit logici → 1 per Task ✓
