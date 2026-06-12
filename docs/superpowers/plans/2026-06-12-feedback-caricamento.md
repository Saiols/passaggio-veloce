# Feedback di caricamento ovunque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare un feedback di caricamento visibile (spinner inline + bottone disabilitato) su ogni azione che scatena una Server Action, riusando il `Button loading` esistente.

**Architecture:** Nuovo `SubmitButton` (`useFormStatus`) per i `<form action={serverAction}>` senza stato client; per gli altri si aggiunge `loading={pending}` ai `Button` già presenti o si inietta uno spinner inline nei bottoni custom. Solo presentazione: nessun cambio di logica nelle action.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19 (`useFormStatus`, `useTransition`), TypeScript, Tailwind, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-12-feedback-caricamento-design.md`

---

## Regola di classificazione (vale per tutti i task)

Per ogni bottone toccato, decidere:

- **Primario** = il bottone che *avvia* l'azione asincrona (submit, conferma, salva, elimina, avanza stato) → **deve mostrare lo spinner** (`loading`/spinner inline) e `loadingLabel` adeguata.
- **Secondario** = Annulla / Indietro / Chiudi / Back accanto al primario → **lascia solo `disabled={pending}`** (corretto: non sta lavorando lui). NON aggiungere spinner.

Convenzione `loadingLabel` (IT): Salvataggio… · Invio in corso… · Eliminazione… · Aggiornamento… · Conferma in corso… · Annullamento…

---

## Task 1: Componente `SubmitButton`

**Files:**
- Create: `apps/piattaforma/src/components/ui/submit-button.tsx`
- Modify: `apps/piattaforma/src/components/ui/index.ts`

- [ ] **Step 1: Creare il componente**

```tsx
'use client';

import type { ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from './button';

type Props = Omit<ComponentProps<typeof Button>, 'loading' | 'type'>;

/**
 * Bottone di submit per <form action={serverAction}>. Legge useFormStatus()
 * e mostra automaticamente lo spinner del Button mentre la server action è in
 * corso. Drop-in di <Button type="submit"> dentro un <form>.
 */
export function SubmitButton(props: Props) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} {...props} />;
}
```

- [ ] **Step 2: Esportare da `ui/index.ts`**

Aggiungere accanto all'export di `Button`:

```ts
export { SubmitButton } from './submit-button';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma exec tsc --noEmit`
Expected: nessun errore relativo a `submit-button.tsx` / `useFormStatus`.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/components/ui/submit-button.tsx apps/piattaforma/src/components/ui/index.ts
git commit -m "feat(ui): SubmitButton con spinner automatico via useFormStatus"
```

---

## Task 2: Flusso pratiche (il buco principale)

Sostituire `<Button type="submit">` → `<SubmitButton ... loadingLabel=…>` dentro i `<form action={serverAction}>`, e dare uno spinner reale al bottone custom della lista.

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (righe ~150-178)
- Modify: `apps/piattaforma/src/app/pratiche/quick-action-button.tsx`

- [ ] **Step 1: Dettaglio pratica — import**

In `pratiche/[id]/page.tsx`, aggiungere `SubmitButton` all'import da `@/components/ui` (dove è già importato `Button`).

- [ ] **Step 2: Dettaglio pratica — swap dei 3 bottoni**

Trasformazione (mantenere `className="animate-pulse-soft"` come richiamo idle):

```tsx
{/* Pratica processata */}
<form action={processataBound}>
  <SubmitButton size="sm" className="animate-pulse-soft" loadingLabel="Aggiornamento…">
    Pratica processata
  </SubmitButton>
</form>

{/* Firma avvenuta */}
<form action={firmaBound}>
  <SubmitButton size="sm" className="animate-pulse-soft" loadingLabel="Aggiornamento…">
    Firma avvenuta
  </SubmitButton>
</form>

{/* Annulla pratica */}
<form action={annullaBound}>
  <SubmitButton size="sm" variant="danger" loadingLabel="Annullamento…">
    Annulla pratica
  </SubmitButton>
</form>
```

- [ ] **Step 3: Lista pratiche — spinner inline nella pill custom**

In `quick-action-button.tsx` il bottone è una pill custom (non `Button`). Sostituire il testo `{pending ? '…' : c.label}` con uno spinner inline + label, mantenendo le classi:

```tsx
return (
  <button
    type="button"
    onClick={onClick}
    disabled={pending}
    aria-busy={pending || undefined}
    className="animate-pulse-soft relative z-20 inline-flex items-center gap-1.5 rounded-full bg-pv-navy-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-pv-navy-700 disabled:opacity-50 disabled:animate-none"
  >
    {pending && (
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )}
    <span>{pending ? 'Invio…' : c.label}</span>
  </button>
);
```

- [ ] **Step 4: Typecheck + verifica**

Run: `pnpm --filter piattaforma exec tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/[id]/page.tsx apps/piattaforma/src/app/pratiche/quick-action-button.tsx
git commit -m "fix(pratiche): spinner sui bottoni di avanzamento stato (dettaglio + lista)"
```

---

## Task 3: Altri form-action server-action (Categoria A)

`<form action={serverAction}>` dove l'action è una server action legata direttamente al form (nessuno stato client). Swap del bottone primario a `<SubmitButton>`. Aggiungere l'import di `SubmitButton` dove serve.

**Files (bottone primario → SubmitButton):**
- `apps/piattaforma/src/app/inbox/[id]/page.tsx:103,108` — accept/reject (`acceptBound`/`rejectBound`). loadingLabel: accept → "Conferma in corso…", reject → "Rifiuto in corso…".
- `apps/piattaforma/src/app/inbox/page.tsx:121,126` — accept/reject (idem).
- `apps/piattaforma/src/app/dashboard/admin-dashboard.tsx:38` — `runDistribuzioneTickAction`. loadingLabel "Esecuzione…".
- `apps/piattaforma/src/app/profilo/notifiche/page.tsx:35` — `updateNotifPrefsAction`. loadingLabel "Salvataggio…".

**Logout (decisione):** `components/app-shell.tsx:206` e `components/admin/admin-shell.tsx:323` usano `<form action={logoutAction}>`. Swap a `<SubmitButton>` con loadingLabel "Uscita…" SE il bottone è un `Button`; se è markup custom, lasciare invariato (logout è rapido + naviga). Verificare il markup prima di toccare.

- [ ] **Step 1:** Per ciascun file, importare `SubmitButton` da `@/components/ui` e sostituire il `<Button type="submit">` primario dentro il form con `<SubmitButton loadingLabel="…">`, preservando `variant`/`size`/`className`. Lasciare invariati i bottoni secondari.
- [ ] **Step 2:** Typecheck: `pnpm --filter piattaforma exec tsc --noEmit` → nessun errore.
- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/inbox apps/piattaforma/src/app/dashboard/admin-dashboard.tsx apps/piattaforma/src/app/profilo/notifiche/page.tsx
git commit -m "fix(inbox/dashboard/notifiche): spinner sui submit delle server action"
```

---

## Task 4: `Button` con `disabled` ma senza `loading` (Categoria B)

Aggiungere `loading={pending}` (e `loadingLabel`) al `Button` **primario**. Rimuovere eventuale text-swap manuale (`{pending ? '…' : '…'}`) lasciando solo il testo normale come children (lo spinner+label li mette `loading`). Lasciare invariati i bottoni secondari (Annulla/Indietro).

**Files (bottone primario):**
- `apps/piattaforma/src/app/wallet/payout-threshold-form.tsx:67` → loadingLabel "Salvataggio…"
- `apps/piattaforma/src/app/(auth)/reset-password/reset-form.tsx:65,95` → "Invio in corso…"
- `apps/piattaforma/src/app/team/[userId]/edit/edit-form.tsx:80` → "Salvataggio…"
- `apps/piattaforma/src/app/team/[userId]/edit/reset-password.tsx:76` → "Invio in corso…" (verificare sia primario)
- `apps/piattaforma/src/app/team/create-user-form.tsx:67` → "Creazione…"
- `apps/piattaforma/src/app/team/invite-form.tsx:37` → "Invio invito…"
- `apps/piattaforma/src/app/team/disable-button.tsx:37` → "Aggiornamento…"
- `apps/piattaforma/src/app/team/revoke-button.tsx:11` → "Revoca…"
- `apps/piattaforma/src/app/admin/assistenti/create-form.tsx:67` → "Creazione…"
- `apps/piattaforma/src/app/admin/assistenti/[id]/edit/edit-form.tsx:80` → "Salvataggio…"
- `apps/piattaforma/src/app/admin/assistenti/[id]/edit/reset-password.tsx:71` → "Invio in corso…"
- `apps/piattaforma/src/app/profilo/personale/form.tsx:96` → "Salvataggio…"
- `apps/piattaforma/src/app/admin/companies/[id]/delete-button.tsx:83` → `loading={pending} loadingLabel="Eliminazione…"`, children `Elimina` (rimuovere il `{pending ? 'Eliminazione…' : 'Elimina'}`)
- `apps/piattaforma/src/app/profilo/listino/client.tsx:188,242` → verificare quale è primario (elimina/salva) e aggiungere `loading`; il `submitForm` a 180 ha già `loading`.

**Esempio di trasformazione (profilo/personale/form.tsx):**

```tsx
// prima
<Button type="submit" size="md" disabled={pending}>
  {pending ? 'Salvataggio…' : 'Salva modifiche'}
</Button>
// dopo
<Button type="submit" size="md" disabled={pending} loading={pending} loadingLabel="Salvataggio…">
  Salva modifiche
</Button>
```

- [ ] **Step 1:** Applicare la trasformazione a tutti i file elencati (solo bottoni primari).
- [ ] **Step 2:** Typecheck: `pnpm --filter piattaforma exec tsc --noEmit` → nessun errore.
- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/wallet apps/piattaforma/src/app/team apps/piattaforma/src/app/profilo apps/piattaforma/src/app/admin/assistenti apps/piattaforma/src/app/admin/companies apps/piattaforma/src/app/\(auth\)/reset-password
git commit -m "fix(ui): loading spinner sui Button submit che avevano solo disabled"
```

---

## Task 5: Bottoni custom + admin CRM (Categoria C + residui)

Bottoni con markup custom (non `Button`) che mostrano solo `'…'`/cambio testo, e i client admin con molti `disabled={pending}` da classificare uno a uno con la **Regola di classificazione**.

### 5a — Bottoni custom: iniettare spinner inline

Per ogni bottone **primario** custom, aggiungere lo stesso spinner SVG inline del Task 2 Step 3 (dimensione coerente col testo: `h-3 w-3` per testi piccoli, `h-4 w-4` per testi normali) e `aria-busy={pending || undefined}`, mantenendo le classi esistenti. Bottoni secondari invariati.

**Files:**
- `apps/piattaforma/src/app/admin/suspend-button.tsx:159` (submit del dialog) e `:58` (trigger) → spinner inline al posto di `{pending ? '…' : …}`
- `apps/piattaforma/src/app/admin/escalation/assign-form.tsx:60` → spinner inline (bottone "Assegna")
- `apps/piattaforma/src/app/admin/documenti/override-gating-button.tsx:25` → verificare markup; spinner inline se custom
- `apps/piattaforma/src/app/invito/[token]/accept-form.tsx:37` → `<button type="submit">` dentro `<form action>`: convertire a `<SubmitButton>` se compatibile con lo stile, altrimenti spinner inline
- `apps/piattaforma/src/app/admin/ateco/client.tsx:84` → toggle attiva/disattiva: spinner inline o `loading` se è un `Button`
- `apps/piattaforma/src/app/admin/codici-promozionali/client.tsx:101` → toggle: come ateco

### 5b — Admin CRM client (classificare per file)

Aprire ciascun file, individuare i bottoni **primari** (azione async) e i **secondari** (Annulla/Chiudi). Ai primari che sono `Button` aggiungere `loading={pending}` + `loadingLabel`; ai primari custom lo spinner inline. Secondari invariati.

**Files:**
- `apps/piattaforma/src/app/admin/crm/sales/client.tsx` (righe 326,335,345,500,693,786,792 — 792 ha già loading)
- `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (440,451,647,662 — 663 ha già loading)
- `apps/piattaforma/src/app/admin/crm/chatbot/client.tsx` (192,370,381,388 — 389 ha già loading)
- `apps/piattaforma/src/app/admin/crm/utenti/client.tsx` (396,420,489,495 — 496 ha già loading)
- `apps/piattaforma/src/app/admin/segnalazioni/gestione-form.tsx` (79,109 — 87/118 hanno già loading; classificare 79/109)
- `apps/piattaforma/src/app/admin/affiliazioni/sospette/client.tsx` (227 — 236 ha già loading)
- `apps/piattaforma/src/components/chatbot-widget.tsx:169` → invio messaggio: spinner inline sul send se non già presente

**Esclusi (secondari verificati — lasciare `disabled` solo):** i bottoni Annulla/Chiudi dei popup `dichiarazione-popup.tsx:119`, `revisione-manuale-popup.tsx:132`, `pratiche/[id]/segnala-button.tsx:121`, `pratiche/nuova/wizard.tsx:1294` (Indietro), e gli analoghi "onClose"/"setStep" negli admin client.

- [ ] **Step 1:** Task 5a — spinner inline sui bottoni custom primari elencati.
- [ ] **Step 2:** Task 5b — classificare e correggere ogni admin CRM client file.
- [ ] **Step 3:** Typecheck: `pnpm --filter piattaforma exec tsc --noEmit` → nessun errore.
- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/admin apps/piattaforma/src/app/invito apps/piattaforma/src/components/chatbot-widget.tsx
git commit -m "fix(admin/crm): spinner di caricamento su azioni custom e CRM mancanti"
```

---

## Task 6: Verifica finale

- [ ] **Step 1: Typecheck monorepo**

Run: `pnpm --filter piattaforma exec tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 2: Build**

Run: `pnpm --filter piattaforma build`
Expected: build OK.

- [ ] **Step 3: Test suite**

Run: `pnpm --filter piattaforma test`
Expected: verde (i test esistenti non devono regredire; nessun nuovo test richiesto per i cambi presentazionali).

- [ ] **Step 4: Verifica manuale flusso pratica**

Avviare l'app, aprire una pratica e cliccare "Pratica processata" / "Firma avvenuta" / "Annulla pratica": il bottone deve disabilitarsi e mostrare lo spinner + label finché la server action completa/naviga. Idem inbox accept/reject e i form profilo/team.

---

## Self-Review (coverage vs spec)

- SubmitButton + export → Task 1 ✓
- Categoria A (form-action server action) → Task 2 (pratiche) + Task 3 ✓
- Categoria B (`disabled` senza `loading`) → Task 4 ✓
- Categoria C (custom) + admin CRM residui → Task 5 ✓
- Convenzione loadingLabel IT → "Regola di classificazione" + per-file ✓
- Fuori scope (download PDF, upload/scanner, skeleton) → non toccati ✓
- Testing (typecheck/build/test/manuale) → Task 6 ✓
- Commit logici per area → 1 commit per Task ✓
