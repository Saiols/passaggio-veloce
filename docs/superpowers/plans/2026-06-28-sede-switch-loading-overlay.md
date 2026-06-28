# Loading full-screen al cambio sede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare un overlay di caricamento a tutto schermo al cambio di sede operativa (broker e agenzia), finché i dati non sono ri-renderizzati con il nuovo scoping.

**Architecture:** Un nuovo componente presentazionale `SedeSwitchOverlay` (portal su `document.body`) viene mostrato in base al flag `pending` di `useTransition` già presente in `SedeSwitcherClient`. Essendo `SedeSwitcherClient` il componente condiviso (usato da `app-shell.tsx` per entrambi i ruoli, desktop+mobile), un'unica modifica copre tutti i casi.

**Tech Stack:** Next.js (App Router, client components), React `useTransition` + `createPortal`, Tailwind (design tokens `pv-*`), Vitest (suite esistente, nessun nuovo test DOM).

## Global Constraints

- **No hardcoded colors**: usare solo token `pv-*` per i colori brand (es. `text-pv-navy-700`, `text-pv-navy-900`); le utility di opacità neutre (`bg-white/70`, `backdrop-blur-sm`) sono ammesse.
- **Riusare** lo spinner esistente `InlineSpinner` (`@/components/ui/inline-spinner`), dimensionato via `className`.
- **Portal su `document.body`** con guardia `typeof document === 'undefined'` (SSR-safe).
- **z-index `z-[200]`**: sopra tutto (il massimo esistente è `z-[100]` dei toast; modali a `z-50`/`z-[60]`).
- **Copy esatta**: testo `Aggiornamento sede…` (con il carattere ellissi `…`).
- **Accessibilità**: `role="status"` + `aria-busy="true"` sul contenitore dell'overlay.
- **Nessun test DOM**: il repo non fa rendering DOM nei test (environment vitest `node`, nessun uso di testing-library; i `.tsx` presentazionali come `InlineSpinner` non hanno test). L'overlay è puramente presentazionale (nessuna logica oltre `show ? portal : null`) → verifica via typecheck + suite invariata + check visivo manuale.
- Branch di lavoro: `main` (lo sviluppo ora è diretto su main).

**Comandi di riferimento** (dalla root del monorepo):
- Typecheck: `pnpm --filter piattaforma run typecheck`
- Suite: `pnpm --filter piattaforma test`

---

## File Structure

- **Create** `apps/piattaforma/src/components/sede/sede-switch-overlay.tsx` — componente presentazionale `SedeSwitchOverlay({ show })`, portal full-screen.
- **Modify** `apps/piattaforma/src/components/sede/sede-switcher-client.tsx` — importa e renderizza `<SedeSwitchOverlay show={pending} />` accanto al `<select>` (che resta `disabled={pending}`).

---

## Task 1: Overlay full-screen al cambio sede

**Files:**
- Create: `apps/piattaforma/src/components/sede/sede-switch-overlay.tsx`
- Modify: `apps/piattaforma/src/components/sede/sede-switcher-client.tsx`

**Interfaces:**
- Produces: `function SedeSwitchOverlay({ show }: { show: boolean }): JSX.Element | null`
- Consumes: `InlineSpinner` da `@/components/ui/inline-spinner` (firma `({ className }: { className?: string })`).

- [ ] **Step 1: Creare il componente overlay**

Crea `apps/piattaforma/src/components/sede/sede-switch-overlay.tsx`:

```tsx
'use client';

import { createPortal } from 'react-dom';
import { InlineSpinner } from '@/components/ui/inline-spinner';

/**
 * Overlay di caricamento a tutto schermo mostrato durante il cambio di sede
 * operativa, finché i dati non sono ri-renderizzati con il nuovo scoping.
 * Blocca l'interazione. Renderizzato via portal su <body> per stare sopra
 * sidebar/modali a prescindere dallo stacking context dell'header che contiene
 * il selettore.
 */
export function SedeSwitchOverlay({ show }: { show: boolean }) {
  if (!show || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-busy="true"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-sm"
    >
      <InlineSpinner className="h-9 w-9 text-pv-navy-700" />
      <span className="text-[14px] font-semibold text-pv-navy-900">
        Aggiornamento sede…
      </span>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Renderizzare l'overlay nel selettore**

In `apps/piattaforma/src/components/sede/sede-switcher-client.tsx`:

(a) aggiungi l'import sotto gli altri import:

```tsx
import { SedeSwitchOverlay } from './sede-switch-overlay';
```

(b) avvolgi il `return` in un fragment e aggiungi l'overlay come sibling del `<label>` (il `<select>` resta invariato, già `disabled={pending}`). Il blocco `return ( ... )` diventa:

```tsx
  return (
    <>
      <label className="flex items-center gap-2 text-[12.5px] text-pv-slate-600">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-pv-slate-500">
          Sede
        </span>
        <select
          value={current}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            start(async () => {
              await setCurrentSedeAction(v);
              router.refresh();
            });
          }}
          className="rounded-[8px] border-[1.5px] border-pv-slate-200 bg-white px-2.5 py-1 text-[13px] font-medium text-pv-navy-900 focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)] disabled:opacity-60"
        >
          {isOwner && <option value="ALL">Tutte le sedi</option>}
          {sedi.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </label>
      <SedeSwitchOverlay show={pending} />
    </>
  );
```

> Nota: l'overlay portala su `body`, quindi la sua posizione nel JSX è irrilevante per il layout; il fragment serve solo perché un componente React deve avere un singolo nodo radice.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS (nessun errore).

- [ ] **Step 4: Suite invariata**

Run: `pnpm --filter piattaforma test`
Expected: PASS — 724 test verdi (nessuna regressione; non sono stati aggiunti test).

- [ ] **Step 5: Verifica visiva manuale**

Avvia l'app in locale (`pnpm --filter piattaforma dev`, provider console). Con un account **proprietario multi-sede** (broker e poi agenzia), dalla shell cambia la sede dal selettore in alto: deve comparire un overlay a tutto schermo (velo bianco sfumato + spinner + "Aggiornamento sede…") che blocca l'interazione e sparisce quando i dati della nuova sede sono caricati. Verifica sia su desktop sia su layout mobile (il selettore è renderizzato in entrambi da `app-shell.tsx`).

> Se non hai un ambiente locale pronto, questa verifica può essere fatta sul preview/prod dopo il deploy: il comportamento è puramente client e non dipende dal DB.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/components/sede/sede-switch-overlay.tsx apps/piattaforma/src/components/sede/sede-switcher-client.tsx
git commit -m "feat(sede): overlay loading full-screen al cambio sede (broker+agenzia)"
```

---

## Self-Review (eseguita in fase di scrittura)

**Spec coverage:**
- Overlay full-screen al cambio sede, broker+agenzia → Task 1 (componente + wiring nel componente condiviso). ✓
- Visibile finché i dati non sono aggiornati → legato a `pending` di `useTransition` (resta true fino al commit del `router.refresh()`). ✓
- Riuso `InlineSpinner`, no hardcoded colors, portal su body, z sopra tutto, copy esatta, role/aria → Global Constraints + Step 1. ✓
- Niente test DOM (convenzione repo) → verifica typecheck + suite + manuale. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice o comando concreto. ✓

**Type consistency:** `SedeSwitchOverlay({ show: boolean })` definito in Step 1 e usato con `show={pending}` in Step 2 (`pending` è `boolean` da `useTransition`). `InlineSpinner` usato con la firma reale (`className`). ✓
