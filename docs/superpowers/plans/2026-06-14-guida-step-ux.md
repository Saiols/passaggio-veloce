# Guida step UX (B2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere evidente "il prossimo passo" del flusso pratica con una guida (stepper + card con CTA pulsante/variante attesa) sul dettaglio, toast di conferma dopo le azioni, e hint leggeri su inbox/dashboard.

**Architecture:** Una funzione pura `guidaStep(stato, ruolo, hasValutazione)` calcola stepper + copy + quale CTA evidenziare; un componente presentazionale la rende. Un Toaster leggero (no deps) dà conferme post-azione. Hint leggeri (Alert) su inbox/dashboard.

**Tech Stack:** Next.js 16 (App Router, Server/Client Components), React 19 (context per i toast), TypeScript, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-guida-step-ux-design.md`

---

## Task 1: Funzione pura `guidaStep` + test

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/guida-step.ts`
- Test: `apps/piattaforma/src/lib/pratiche/guida-step.test.ts`

- [ ] **Step 1: Test (TDD)**

Create `guida-step.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { guidaStep } from './guida-step';

describe('guidaStep', () => {
  it('agenzia in ACCETTATA: azione → processata', () => {
    const g = guidaStep({ stato: 'ACCETTATA', ruolo: 'AGENZIA', hasValutazione: false });
    expect(g.variant).toBe('azione');
    expect(g.cta).toBe('processata');
    expect(g.steps.find((s) => s.key === 'accettata')?.stato).toBe('current');
  });

  it('agenzia in PROCESSATA: azione → firma', () => {
    const g = guidaStep({ stato: 'PROCESSATA', ruolo: 'AGENZIA', hasValutazione: false });
    expect(g.variant).toBe('azione');
    expect(g.cta).toBe('firma');
    expect(g.steps.find((s) => s.key === 'processata')?.stato).toBe('current');
  });

  it('broker in ACCETTATA: attesa (nessuna cta)', () => {
    const g = guidaStep({ stato: 'ACCETTATA', ruolo: 'DEALER', hasValutazione: false });
    expect(g.variant).toBe('attesa');
    expect(g.cta).toBeNull();
  });

  it('broker in FIRMATA senza valutazione: azione → valuta', () => {
    const g = guidaStep({ stato: 'FIRMATA', ruolo: 'DEALER', hasValutazione: false });
    expect(g.variant).toBe('azione');
    expect(g.cta).toBe('valuta');
    expect(g.steps.every((s) => s.stato === 'done')).toBe(true);
  });

  it('broker in FIRMATA con valutazione: chiusa', () => {
    const g = guidaStep({ stato: 'FIRMATA', ruolo: 'DEALER', hasValutazione: true });
    expect(g.variant).toBe('chiusa');
    expect(g.cta).toBeNull();
  });

  it('broker in attesa accettazione: attesa, step accettata = current con label attesa', () => {
    const g = guidaStep({ stato: 'IN_ATTESA_ROUND_1', ruolo: 'DEALER', hasValutazione: false });
    expect(g.variant).toBe('attesa');
    const acc = g.steps.find((s) => s.key === 'accettata');
    expect(acc?.stato).toBe('current');
    expect(acc?.label).toBe('In attesa agenzia');
  });

  it('ANNULLATA: chiusa negativa', () => {
    const g = guidaStep({ stato: 'ANNULLATA', ruolo: 'AGENZIA', hasValutazione: false });
    expect(g.variant).toBe('chiusa');
    expect(g.chiusaNegativa).toBe(true);
  });

  it('admin (ALTRO): mai azione', () => {
    const g = guidaStep({ stato: 'PROCESSATA', ruolo: 'ALTRO', hasValutazione: false });
    expect(g.variant).not.toBe('azione');
    expect(g.cta).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`cd apps/piattaforma && pnpm test -- guida-step`) — modulo inesistente.

- [ ] **Step 3: Implementazione**

Create `guida-step.ts`:

```ts
import type { PraticaStato } from '@/components/ui/status-chip';

export type StepKey = 'inviata' | 'accettata' | 'processata' | 'firmata';
export type GuidaVariant = 'azione' | 'attesa' | 'chiusa';
export type GuidaCta = 'processata' | 'firma' | 'annulla' | 'valuta' | null;
export type GuidaRuolo = 'DEALER' | 'AGENZIA' | 'ALTRO';

export type GuidaStepItem = {
  key: StepKey;
  label: string;
  stato: 'done' | 'current' | 'todo';
};

export type GuidaStepResult = {
  steps: GuidaStepItem[];
  variant: GuidaVariant;
  titolo: string;
  descrizione: string;
  cta: GuidaCta;
  chiusaNegativa: boolean;
};

const STEP_ORDER: StepKey[] = ['inviata', 'accettata', 'processata', 'firmata'];
const STEP_LABEL: Record<StepKey, string> = {
  inviata: 'Inviata',
  accettata: 'Accettata',
  processata: 'Processata',
  firmata: 'Firmata',
};

const WAITING_STATI: PraticaStato[] = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
  'IN_ESCALATION',
];

function currentIndex(stato: PraticaStato): number {
  if (WAITING_STATI.includes(stato) || stato === 'ACCETTATA') return 1;
  if (stato === 'PROCESSATA') return 2;
  if (stato === 'FIRMATA') return 3;
  return 0; // BOZZA, SCADUTA, ANNULLATA
}

function buildSteps(stato: PraticaStato): GuidaStepItem[] {
  const idx = currentIndex(stato);
  const waiting = WAITING_STATI.includes(stato);
  const terminalNeg = stato === 'SCADUTA' || stato === 'ANNULLATA';
  const firmata = stato === 'FIRMATA';
  return STEP_ORDER.map((key, i) => {
    let stepStato: GuidaStepItem['stato'];
    if (firmata) stepStato = 'done';
    else if (terminalNeg) stepStato = i === 0 ? 'done' : 'todo';
    else if (i < idx) stepStato = 'done';
    else if (i === idx) stepStato = 'current';
    else stepStato = 'todo';
    const label = waiting && key === 'accettata' ? 'In attesa agenzia' : STEP_LABEL[key];
    return { key, label, stato: stepStato };
  });
}

/** Calcola la guida "prossimo step" (pura, testabile) per stato × ruolo. */
export function guidaStep(input: {
  stato: PraticaStato;
  ruolo: GuidaRuolo;
  hasValutazione: boolean;
}): GuidaStepResult {
  const { stato, ruolo, hasValutazione } = input;
  const steps = buildSteps(stato);
  const base = { steps, chiusaNegativa: false } as const;

  // Stati terminali (uguali per tutti i ruoli)
  if (stato === 'ANNULLATA') {
    return { ...base, variant: 'chiusa', cta: null, chiusaNegativa: true,
      titolo: 'Pratica annullata', descrizione: 'La pratica è stata annullata e le assegnazioni chiuse.' };
  }
  if (stato === 'SCADUTA') {
    return { ...base, variant: 'chiusa', cta: null, chiusaNegativa: true,
      titolo: 'Pratica scaduta', descrizione: 'Nessuna agenzia ha accettato in tempo.' };
  }
  if (stato === 'BOZZA') {
    return { ...base, variant: 'chiusa', cta: null,
      titolo: 'Bozza', descrizione: 'Pratica non ancora inviata.' };
  }

  const isAgenzia = ruolo === 'AGENZIA';
  const isBroker = ruolo === 'DEALER';

  if (stato === 'FIRMATA') {
    if (isBroker && !hasValutazione) {
      return { ...base, variant: 'azione', cta: 'valuta',
        titolo: 'Valuta l’agenzia', descrizione: 'La pratica è completata: lascia una valutazione all’agenzia qui sotto.' };
    }
    return { ...base, variant: 'chiusa', cta: null,
      titolo: 'Pratica completata', descrizione: 'Firma avvenuta: la pratica è chiusa.' };
  }

  if (stato === 'ACCETTATA') {
    if (isAgenzia) {
      return { ...base, variant: 'azione', cta: 'processata',
        titolo: 'Lavora la pratica', descrizione: 'Completa la lavorazione e poi segna “Pratica processata”.' };
    }
    return { ...base, variant: 'attesa', cta: null,
      titolo: 'L’agenzia sta lavorando la pratica', descrizione: 'Ti avvisiamo appena ci sono aggiornamenti.' };
  }

  if (stato === 'PROCESSATA') {
    if (isAgenzia) {
      return { ...base, variant: 'azione', cta: 'firma',
        titolo: 'Segna la firma avvenuta', descrizione: 'Conferma quando il cliente ha firmato in agenzia.' };
    }
    return { ...base, variant: 'attesa', cta: null,
      titolo: 'In attesa della firma del cliente', descrizione: 'L’agenzia ha lavorato la pratica; manca la firma.' };
  }

  // WAITING_STATI (IN_ATTESA_*/IN_ESCALATION)
  return { ...base, variant: 'attesa', cta: null,
    titolo: 'In attesa che un’agenzia accetti',
    descrizione: 'La pratica è stata distribuita alle agenzie della zona. Ti avvisiamo appena una accetta.' };
}
```

- [ ] **Step 4: Run test → PASS**. Run: `cd apps/piattaforma && pnpm test -- guida-step`.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/guida-step.ts apps/piattaforma/src/lib/pratiche/guida-step.test.ts
git commit -m "feat(pratiche): funzione pura guidaStep (prossimo passo per stato x ruolo) + test"
```

---

## Task 2: Componente `GuidaStep` + integrazione nel dettaglio

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/[id]/guida-step-card.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx`

- [ ] **Step 1: Componente presentazionale**

Create `guida-step-card.tsx` (server component, no interattività):

```tsx
import type { ReactNode } from 'react';
import type { GuidaStepResult } from '@/lib/pratiche/guida-step';

/** Stepper + card "prossimo passo". `cta` è lo slot dell'azione primaria. */
export function GuidaStepCard({ guida, cta }: { guida: GuidaStepResult; cta?: ReactNode }) {
  const accent =
    guida.variant === 'azione'
      ? 'border-l-pv-orange-500'
      : guida.chiusaNegativa
        ? 'border-l-pv-red-500'
        : 'border-l-pv-slate-300';
  const label =
    guida.variant === 'azione' ? 'Prossimo passo' : guida.variant === 'attesa' ? 'In corso' : 'Stato';
  const labelColor = guida.variant === 'azione' ? 'text-pv-orange-500' : 'text-pv-slate-500';

  return (
    <div className="mb-6">
      <ol className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold">
        {guida.steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-pv-slate-300">›</span>}
            <span
              className={
                s.stato === 'done'
                  ? 'text-pv-green-500'
                  : s.stato === 'current'
                    ? 'rounded-full border border-pv-orange-500 bg-[color-mix(in_srgb,#ff7a00_8%,white)] px-2 py-0.5 text-pv-navy-900'
                    : 'text-pv-slate-400'
              }
            >
              {s.stato === 'done' ? '✓ ' : s.stato === 'current' ? '● ' : ''}
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      <div
        className={`flex flex-col gap-3 rounded-[12px] border border-pv-slate-200 border-l-4 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:items-center ${accent}`}
      >
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>{label}</p>
          <p className="mt-1 text-[15px] font-extrabold text-pv-navy-900">{guida.titolo}</p>
          <p className="mt-0.5 text-[12.5px] text-pv-slate-500">{guida.descrizione}</p>
        </div>
        {guida.variant === 'azione' && cta && <div className="shrink-0">{cta}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrazione in `page.tsx` — import + calcolo guida**

In `page.tsx` aggiungere gli import:
```tsx
import { guidaStep, type GuidaRuolo } from '@/lib/pratiche/guida-step';
import { GuidaStepCard } from './guida-step-card';
```
Dopo il calcolo dei flag (dopo `canSegnalare`/`showFee`, ~riga 107) aggiungere:
```tsx
  const ruolo: GuidaRuolo =
    companyType === 'AGENZIA' ? 'AGENZIA' : companyType === 'DEALER' ? 'DEALER' : 'ALTRO';
  const guida = guidaStep({
    stato: pratica.stato as PraticaStato,
    ruolo,
    hasValutazione: !!pratica.valutazione,
  });
```

- [ ] **Step 3: Render della guida con la CTA primaria nello slot**

Subito dopo l'apertura del contenitore principale (dopo il `<Link>` "← Tutte le pratiche", prima o appena dopo lo `<header>`), inserire:
```tsx
        <GuidaStepCard
          guida={guida}
          cta={
            guida.cta === 'processata' && canProcessata ? (
              <form action={processataBound}>
                <SubmitButton size="sm" loadingLabel="Aggiornamento…">Pratica processata</SubmitButton>
              </form>
            ) : guida.cta === 'firma' && canFirma ? (
              <form action={firmaBound}>
                <SubmitButton size="sm" loadingLabel="Aggiornamento…">Firma avvenuta</SubmitButton>
              </form>
            ) : null
          }
        />
```
Rimuovere dalla **riga azioni** esistente (header, ~149-179) i bottoni primari `processata` e `firma` (ora nello slot della guida); **lasciare** lì `Annulla pratica`, `Segnala problema`, `Scarica PDF`. Per `guida.cta === 'valuta'` la guida è descrittiva e punta alla `ValutazioneForm` già renderizzata sotto (nessuna CTA nello slot).

- [ ] **Step 4: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck` → nessun errore (verificare che `SubmitButton`/`canProcessata`/`canFirma`/`processataBound`/`firmaBound` siano in scope; lo sono già).

- [ ] **Step 5: Commit**

```bash
git add "apps/piattaforma/src/app/pratiche/[id]/guida-step-card.tsx" "apps/piattaforma/src/app/pratiche/[id]/page.tsx"
git commit -m "feat(pratiche): guida prossimo step (stepper + card) nel dettaglio pratica"
```

---

## Task 3: Toaster + conferme post-azione

**Files:**
- Create: `apps/piattaforma/src/components/ui/toast.tsx`
- Create: `apps/piattaforma/src/app/pratiche/[id]/pratica-toasts.tsx`
- Modify: `apps/piattaforma/src/components/ui/index.ts` (export)
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (montare Toaster/Provider)
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (sostituire i banner `?param` con `<PraticaToasts/>`)
- Modify: `apps/piattaforma/src/app/pratiche/[id]/valutazione-form.tsx` + `segnala-button.tsx` (toast su successo)

- [ ] **Step 1: Toaster (context + provider + UI), senza dipendenze**

Create `components/ui/toast.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastVariant = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; variant: ToastVariant };

const ToastCtx = createContext<((message: string, variant?: ToastVariant) => void) | null>(null);

/** Hook per emettere un toast. Lancia se usato fuori dal provider. */
export function useToast(): (message: string, variant?: ToastVariant) => void {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast deve stare dentro <ToastProvider>');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = nextId++;
      setItems((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              'pointer-events-auto flex items-center gap-2 rounded-[10px] px-4 py-3 text-[13px] font-semibold text-white shadow-[var(--pv-shadow-card-lg)] ' +
              (t.variant === 'success'
                ? 'bg-pv-green-500'
                : t.variant === 'error'
                  ? 'bg-pv-red-500'
                  : 'bg-pv-navy-700')
            }
          >
            <span>{t.variant === 'success' ? '✓' : t.variant === 'error' ? '!' : 'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
```

- [ ] **Step 2: Export da `ui/index.ts`**

Aggiungere:
```ts
export { ToastProvider, useToast } from './toast';
```

- [ ] **Step 3: Montare il provider nella shell**

In `app-shell.tsx` importare `ToastProvider` da `@/components/ui` e avvolgere il contenuto renderizzato (il children/area principale) con `<ToastProvider>…</ToastProvider>` così i toast sono disponibili in tutte le pagine sotto la shell.

- [ ] **Step 4: `PraticaToasts` da searchParams**

Create `pratica-toasts.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui';

/** Converte i flag ?firmata/?processata/?annullata/?error in toast e pulisce l'URL. */
export function PraticaToasts() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (params.get('firmata')) toast('Firma registrata: credito accreditato al broker', 'success');
    else if (params.get('processata')) toast('Pratica processata: il broker è stato avvisato', 'success');
    else if (params.get('annullata')) toast('Pratica annullata', 'info');
    else if (params.get('error')) toast(params.get('error')!, 'error');
    if (
      params.get('firmata') || params.get('processata') ||
      params.get('annullata') || params.get('error')
    ) {
      router.replace(window.location.pathname);
    }
  }, [params, router, toast]);

  return null;
}
```

- [ ] **Step 5: Sostituire i banner `?param` nel dettaglio**

In `page.tsx` rimuovere i blocchi `{sp.firmata && …}`, `{sp.processata && …}`, `{sp.annullata && …}`, `{sp.error && …}` (~righe 200-225) e al loro posto rendere `<PraticaToasts />` (import da `./pratica-toasts`). Lasciare gli altri Alert non legati a questi param.

- [ ] **Step 6: Toast nelle azioni client**

In `valutazione-form.tsx`, nel ramo successo di `handleSubmit` (dopo `submitValutazioneAction` se `result.ok`), chiamare `toast('Valutazione inviata', 'success')` (importare `useToast`). In `segnala-button.tsx`, nel ramo ok di `handleConfirm`, `toast('Segnalazione inviata', 'success')`.

- [ ] **Step 7: Typecheck + commit**

Run: `cd apps/piattaforma && pnpm typecheck` → nessun errore.
```bash
git add apps/piattaforma/src/components/ui/toast.tsx apps/piattaforma/src/components/ui/index.ts apps/piattaforma/src/components/app-shell.tsx "apps/piattaforma/src/app/pratiche/[id]/pratica-toasts.tsx" "apps/piattaforma/src/app/pratiche/[id]/page.tsx" "apps/piattaforma/src/app/pratiche/[id]/valutazione-form.tsx" "apps/piattaforma/src/app/pratiche/[id]/segnala-button.tsx"
git commit -m "feat(ux): toaster + conferme toast nel flusso pratica (sostituisce banner ?param)"
```

---

## Task 4: Hint "cosa fare ora" (inbox + dashboard)

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/page.tsx`
- Modify: `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`
- Modify: `apps/piattaforma/src/app/dashboard/broker-dashboard.tsx`

- [ ] **Step 1: Inbox — banner pending**

In `inbox/page.tsx`, in cima alla lista, se il numero di pending > 0 mostrare un `Alert variant="warning"`/`info`:
```tsx
{inArrivo.length > 0 && (
  <div className="mb-5">
    <Alert variant="info" title={`Hai ${inArrivo.length} pratic${inArrivo.length === 1 ? 'a' : 'he'} in attesa di risposta`}>
      Accetta o rifiuta entro il countdown per non perderle.
    </Alert>
  </div>
)}
```
(usare la variabile/array dei pending già presente nella pagina; adattare il nome).

- [ ] **Step 2: Dashboard agenzia — banner azioni**

In `agenzia-dashboard.tsx`, calcolare i conteggi azioni (pending da accettare = `inArrivo`; da far avanzare = pratiche ACCETTATA/PROCESSATA assegnate). Se >0, mostrare in cima un `Alert variant="info"` con link a `/inbox` / `/pratiche` (es. "Hai N pratiche da gestire"). Riusare i conteggi già fetchati dove possibile; aggiungere una `count` se serve.

- [ ] **Step 3: Dashboard broker — banner valuta**

In `broker-dashboard.tsx`, contare le pratiche `FIRMATA` del broker senza valutazione; se >0 mostrare `Alert variant="info"` "Hai N pratiche da valutare" con link.

- [ ] **Step 4: Typecheck + commit**

Run: `cd apps/piattaforma && pnpm typecheck` → nessun errore.
```bash
git add apps/piattaforma/src/app/inbox/page.tsx apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx apps/piattaforma/src/app/dashboard/broker-dashboard.tsx
git commit -m "feat(ux): hint 'cosa fare ora' su inbox e dashboard"
```

---

## Task 5: Verifica finale

- [ ] **Step 1: Test** — `cd apps/piattaforma && pnpm test` → verde (incl. `guida-step`).
- [ ] **Step 2: Build** — `cd apps/piattaforma && pnpm build` → OK.
- [ ] **Step 3: Verifica manuale** — broker invia (attesa) → agenzia accetta (toast + guida "lavora") → processata (toast + guida "firma") → firma (toast + guida broker "valuta") → broker valuta (toast + guida "completata"). Inbox/dashboard mostrano gli hint. Stati terminali (annullata/scaduta) mostrano la card chiusa.

---

## Self-Review (coverage vs spec)

- Parte 1 funzione pura `guidaStep` + test → Task 1 ✓
- Componente `GuidaStep` (stepper + card barra arancione/attesa/chiusa) + integrazione, CTA primaria nello slot, secondarie nella riga → Task 2 ✓
- Parte 2 Toaster (no deps) + provider nella shell + `PraticaToasts` da searchParams (sostituisce banner) + toast azioni client → Task 3 ✓
- Parte 3 hint inbox + dashboard (agenzia/broker) → Task 4 ✓
- Mapping stato×ruolo coperto (azione/attesa/chiusa, valuta su FIRMATA broker, terminali) → Task 1 ✓
- Copy "firma" senza più "auto-addebito programmato" (addebito istantaneo) → Task 3 Step 4 ✓
- Testing unit/build/manuale → Task 1 + Task 5 ✓
- Fuori scope (campanella, toast non-pratica) → non inclusi ✓
- Commit logici per area → 1 per Task ✓
