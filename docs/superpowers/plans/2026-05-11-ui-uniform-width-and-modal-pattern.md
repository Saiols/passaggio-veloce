# UI uniform width + modal pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uniformare tutte le pagine autenticate a `max-w-6xl` e convertire `/team` + `/admin/assistenti` al pattern lista-first con modale di creazione.

**Architecture:** Nuova primitiva `<Modal>` Tailwind-only in `components/ui/`. Refactor di `/team` e `/admin/assistenti` per spostare i form di creazione in modali invocate da CTA top-right. Replace meccanico della className container su ~30 page.tsx. Form anagrafici sotto-pagina passano a grid 2 colonne.

**Tech Stack:** Next.js 16, React 19, Tailwind, TypeScript strict, Playwright per smoke e2e.

**Spec di riferimento:** `docs/superpowers/specs/2026-05-11-ui-uniform-width-and-modal-pattern-design.md`

---

## Task 1: Primitiva `<Modal>` riutilizzabile

**Files:**
- Create: `apps/piattaforma/src/components/ui/modal.tsx`
- Modify: `apps/piattaforma/src/components/ui/index.ts`

- [ ] **Step 1.1: Creare modal.tsx con scheletro tipi + render**

Create `apps/piattaforma/src/components/ui/modal.tsx`:

```tsx
'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'sm' | 'md' | 'lg';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  children: ReactNode;
};

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

/**
 * Dialog modale riutilizzabile (primitiva UI). Tailwind puro, niente
 * dipendenze esterne. Caratteristiche:
 *  - Close su Esc, click overlay, click X
 *  - Focus trap basico (Tab/Shift+Tab restano dentro)
 *  - Body scroll-lock quando aperto
 *  - Portal in <body> (client-only, no SSR mismatch)
 *  - Markup ARIA (role=dialog, aria-modal, aria-labelledby)
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('overflow-hidden');
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    queueMicrotask(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'input, button, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    });
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.documentElement.classList.remove('overflow-hidden');
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pv-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`pv-modal-panel relative w-full ${SIZE_CLASS[size]} overflow-hidden rounded-2xl bg-white shadow-[var(--pv-shadow-card)]`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-pv-slate-500 hover:bg-pv-slate-100 hover:text-pv-navy-900"
        >
          ✕
        </button>
        <div className="border-b border-pv-slate-200 px-6 py-4 pr-12">
          <h2
            id={titleId}
            className="text-[16px] font-bold text-pv-navy-900"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[12.5px] text-pv-slate-500">
              {description}
            </p>
          )}
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 1.2: Aggiungere keyframes CSS per fade-in + scale**

Modify `apps/piattaforma/src/app/globals.css` — aggiungere in fondo:

```css
@keyframes pv-modal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes pv-modal-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.pv-modal-backdrop {
  background-color: rgb(15 23 42 / 0.5);
  backdrop-filter: blur(2px);
  animation: pv-modal-fade-in 120ms ease-out;
}

.pv-modal-panel {
  animation: pv-modal-scale-in 140ms ease-out;
}
```

- [ ] **Step 1.3: Export Modal da components/ui/index.ts**

Modify `apps/piattaforma/src/components/ui/index.ts` — aggiungere:

```ts
export { Modal, type ModalProps, type ModalSize } from './modal';
```

- [ ] **Step 1.4: Run typecheck**

Run: `pnpm -F piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 1.5: Commit**

```bash
git add apps/piattaforma/src/components/ui/modal.tsx apps/piattaforma/src/components/ui/index.ts apps/piattaforma/src/app/globals.css
git commit -m "feat(ui): primitiva Modal riutilizzabile con focus trap e Esc/overlay close"
```

---

## Task 2: Refactor /team — lista-first + modale due-tab

**Files:**
- Create: `apps/piattaforma/src/app/team/add-user-modal.tsx`
- Modify: `apps/piattaforma/src/app/team/page.tsx`
- Modify: `apps/piattaforma/src/app/team/create-user-form.tsx` (aggiungere prop `onSuccess`)
- Modify: `apps/piattaforma/src/app/team/invite-form.tsx` (aggiungere prop `onSuccess`)

- [ ] **Step 2.1: Aggiungere callback onSuccess a CreateUserForm**

Modify `apps/piattaforma/src/app/team/create-user-form.tsx` — aggiungere prop `onSuccess?: () => void` e chiamarla dopo submit con esito ok. Mantenere il reset campi esistente.

Cerca nel file la firma componente attuale:
```tsx
export function CreateUserForm() {
```
Sostituire con:
```tsx
export function CreateUserForm({ onSuccess }: { onSuccess?: () => void } = {}) {
```

Cerca il punto dove la action torna `ok: true` (dentro `startTransition`):
```tsx
      if (!res.ok) {
        setError(res.error);
        return;
      }
```
Aggiungere subito dopo (prima del reset campi):
```tsx
      onSuccess?.();
```

- [ ] **Step 2.2: Aggiungere callback onSuccess a InviteForm**

Modify `apps/piattaforma/src/app/team/invite-form.tsx` — stesso pattern di Step 2.1: firma `{ onSuccess }: { onSuccess?: () => void } = {}` e chiamata `onSuccess?.()` dopo `if (res.ok)`.

- [ ] **Step 2.3: Creare add-user-modal.tsx con due tab**

Create `apps/piattaforma/src/app/team/add-user-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui';
import { CreateUserForm } from './create-user-form';
import { InviteForm } from './invite-form';

type Tab = 'password' | 'invite';

export function AddUserModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('password');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Aggiungi utente"
      description="Crea l'account direttamente impostando una password, oppure invia un invito via email."
    >
      <div className="mb-4 flex gap-1 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-1">
        <button
          type="button"
          onClick={() => setTab('password')}
          className={`flex-1 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            tab === 'password'
              ? 'bg-white text-pv-navy-900 shadow-sm'
              : 'text-pv-slate-500 hover:text-pv-navy-700'
          }`}
        >
          Imposta password
        </button>
        <button
          type="button"
          onClick={() => setTab('invite')}
          className={`flex-1 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            tab === 'invite'
              ? 'bg-white text-pv-navy-900 shadow-sm'
              : 'text-pv-slate-500 hover:text-pv-navy-700'
          }`}
        >
          Invita via email
        </button>
      </div>

      {tab === 'password' ? (
        <CreateUserForm onSuccess={onClose} />
      ) : (
        <InviteForm onSuccess={onClose} />
      )}
    </Modal>
  );
}
```

- [ ] **Step 2.4: Refactor /team/page.tsx — lista-first + CTA top-right**

Modify `apps/piattaforma/src/app/team/page.tsx`. Sostituire da `<AppShell ...>` fino a `</AppShell>` con il nuovo layout. Header + toolbar + lista + (eventuali) inviti pendenti.

Le import in cima cambiano:
```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { RevokeButton } from './revoke-button';
import { DisableTeamUserButton } from './disable-button';
import { TeamPageClient } from './team-page-client';
import { formatRelative } from '@/lib/format';
```

Rimuovere import `InviteForm`, `CreateUserForm`.

Mantieni la `default async function TeamPage()` invariata fino al `return`. Sostituisci il blocco `return (...)` con:

```tsx
  return (
    <AppShell session={session} activePath="/team">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Azienda
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Team
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Gestisci gli utenti che possono operare per conto della tua azienda.
            </p>
          </div>
          <TeamPageClient />
        </header>

        <section className="rounded-2xl border border-pv-slate-200 bg-white p-6 mb-6">
          <h2 className="text-base font-bold text-pv-navy-900">
            Utenti attivi ({users.length})
          </h2>
          <ul className="mt-3 divide-y divide-pv-slate-100">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-pv-navy-900">
                    {u.nome} {u.cognome}
                  </p>
                  <p className="truncate text-xs text-pv-slate-500">
                    {u.email} · {u.role === 'ADMIN_AZIENDA' ? 'Admin' : 'Utente'}
                  </p>
                </div>
                <span className="text-xs text-pv-slate-500 hidden sm:inline">
                  {u.lastLoginAt
                    ? `Ultimo accesso ${formatRelative(u.lastLoginAt)}`
                    : 'Mai entrato'}
                </span>
                {u.id !== session.user.id && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/team/${u.id}/edit`}
                      className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                    >
                      Modifica
                    </Link>
                    <DisableTeamUserButton
                      userId={u.id}
                      nome={u.nome}
                      cognome={u.cognome}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {invitations.length > 0 && (
          <section className="rounded-2xl border border-pv-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-pv-navy-900">Inviti in attesa</h2>
            <ul className="mt-3 divide-y divide-pv-slate-100">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-semibold text-pv-navy-900">{inv.email}</p>
                    <p className="text-xs text-pv-slate-500">
                      Inviato {formatRelative(inv.createdAt)} · scade {formatRelative(inv.expiresAt)}
                    </p>
                  </div>
                  <RevokeButton invitationId={inv.id} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
```

- [ ] **Step 2.5: Creare team-page-client.tsx (wrapper CTA + modale)**

Create `apps/piattaforma/src/app/team/team-page-client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { AddUserModal } from './add-user-modal';

export function TeamPageClient() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800 sm:self-end"
      >
        + Aggiungi utente
      </button>
      <AddUserModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2.6: Run typecheck**

Run: `pnpm -F piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 2.7: Smoke manuale browser**

Dev server già up. Apri `http://localhost:3000/login` con account `dealer1@passaggioveloce.it` / `DevPass123!`. Vai a `/team`. Verifica:
- Header con CTA "+ Aggiungi utente" in alto a destra.
- Lista utenti immediatamente sotto, senza form sopra.
- Click su CTA apre modale con due tab.
- Tab "Imposta password" → submit → modale chiude → utente in lista.
- Tab "Invita via email" → submit → modale chiude → invito in "Inviti in attesa".
- Esc / overlay click chiude modale.

- [ ] **Step 2.8: Commit**

```bash
git add apps/piattaforma/src/app/team/
git commit -m "feat(team): lista-first con modale Aggiungi utente (tab password/invito)"
```

---

## Task 3: Refactor /admin/assistenti — lista-first + modale single

**Files:**
- Create: `apps/piattaforma/src/app/admin/assistenti/add-assistente-modal.tsx`
- Create: `apps/piattaforma/src/app/admin/assistenti/assistenti-page-client.tsx`
- Modify: `apps/piattaforma/src/app/admin/assistenti/page.tsx`
- Modify: `apps/piattaforma/src/app/admin/assistenti/create-assistente-form.tsx` (prop `onSuccess`)

- [ ] **Step 3.1: Aggiungere onSuccess a CreateAssistenteForm**

Modify `apps/piattaforma/src/app/admin/assistenti/create-assistente-form.tsx`.

Trova firma componente. Sostituisci con:
```tsx
export function CreateAssistenteForm({ onSuccess }: { onSuccess?: () => void } = {}) {
```

Trova punto in cui la action ritorna ok. Aggiungere `onSuccess?.();` subito dopo il check `!res.ok` (prima di eventuali reset campi).

- [ ] **Step 3.2: Creare add-assistente-modal.tsx**

Create `apps/piattaforma/src/app/admin/assistenti/add-assistente-modal.tsx`:

```tsx
'use client';

import { Modal } from '@/components/ui';
import { CreateAssistenteForm } from './create-assistente-form';

export function AddAssistenteModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nuovo assistente"
      description="Account operativo con accesso a pratiche, anagrafiche, wallet, catalogo contatti ed escalation. L'account è attivo da subito."
    >
      <CreateAssistenteForm onSuccess={onClose} />
    </Modal>
  );
}
```

- [ ] **Step 3.3: Creare assistenti-page-client.tsx**

Create `apps/piattaforma/src/app/admin/assistenti/assistenti-page-client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { AddAssistenteModal } from './add-assistente-modal';

export function AssistentiPageClient() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800 sm:self-end"
      >
        + Nuovo assistente
      </button>
      <AddAssistenteModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 3.4: Refactor /admin/assistenti/page.tsx**

Modify `apps/piattaforma/src/app/admin/assistenti/page.tsx`:

1. Cambia il container outer da `max-w-4xl` a `max-w-6xl`.
2. Rimuovi import `CreateAssistenteForm` e l'intera `<Card className="mb-6">…<CreateAssistenteForm /></Card>` blocco.
3. Aggiungi import `AssistentiPageClient` da `'./assistenti-page-client'`.
4. Trasforma l'`<header>` in flex con CTA top-right (stesso pattern di /team). Sostituisci:

```tsx
<header className="mb-7">
```
con:
```tsx
<header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div>
```
e prima del `</header>` chiudi il `</div>` e aggiungi:
```tsx
  <AssistentiPageClient />
</header>
```

- [ ] **Step 3.5: Run typecheck**

Run: `pnpm -F piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 3.6: Smoke manuale browser**

Login admin (`admin@passaggioveloce.it` / `DevPass123!`). Vai a `/admin/assistenti`. Verifica:
- CTA "+ Nuovo assistente" in header a destra.
- Lista direttamente sotto, niente form sopra.
- Click su CTA apre modale con CreateAssistenteForm.
- Submit ok → modale chiude → assistente in lista.

- [ ] **Step 3.7: Commit**

```bash
git add apps/piattaforma/src/app/admin/assistenti/
git commit -m "feat(admin/assistenti): lista-first con modale Nuovo assistente"
```

---

## Task 4: Width refactor mass — pagine restanti a max-w-6xl

**Files modificati** (sostituire `max-w-{2xl,3xl,4xl,5xl}` con `max-w-6xl` nel container `<div>` outer di ogni pagina sotto):

- `apps/piattaforma/src/app/profilo/page.tsx` (max-w-4xl)
- `apps/piattaforma/src/app/profilo/azienda/page.tsx` (max-w-3xl)
- `apps/piattaforma/src/app/profilo/sicurezza/page.tsx` (max-w-2xl)
- `apps/piattaforma/src/app/profilo/personale/page.tsx` (max-w-2xl)
- `apps/piattaforma/src/app/profilo/listino/page.tsx` (max-w-3xl)
- `apps/piattaforma/src/app/team/[userId]/edit/page.tsx` (max-w-3xl)
- `apps/piattaforma/src/app/notifiche/page.tsx` (max-w-4xl)
- `apps/piattaforma/src/app/orari/page.tsx` (max-w-4xl)
- `apps/piattaforma/src/app/affiliazione/page.tsx` (max-w-4xl)
- `apps/piattaforma/src/app/admin/companies/[id]/page.tsx` (max-w-5xl)
- `apps/piattaforma/src/app/admin/affiliazioni/sospette/page.tsx` (max-w-5xl)
- `apps/piattaforma/src/app/admin/segnalazioni/page.tsx` (max-w-5xl)
- `apps/piattaforma/src/app/admin/revisioni/page.tsx` (max-w-5xl)
- `apps/piattaforma/src/app/admin/crm/permessi/page.tsx` (max-w-5xl)
- `apps/piattaforma/src/app/admin/assistenti/[id]/edit/page.tsx` (max-w-3xl)

- [ ] **Step 4.1: Replace puntuale su ogni file**

Per ogni file della lista sopra, usa Edit tool con:
- `old_string` = la riga esatta del `<div ... max-w-{old} ...>`
- `new_string` = stessa riga con `max-w-6xl`

Non toccare altri `max-w-*` nei sotto-elementi (es. `<header className="mb-7 max-w-2xl">` può restare per ragioni di leggibilità testo header — verifica caso per caso, ma di default lascia stare).

Esempio per `profilo/azienda/page.tsx`:

```
- <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
+ <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
```

Per pagine con branch error/redirect che hanno un secondo container (es. `wallet/page.tsx:38`), uniforma anch'esso.

- [ ] **Step 4.2: Run typecheck**

Run: `pnpm -F piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 4.3: Smoke manuale browser**

Login con tre ruoli in sequenza e visita ogni pagina elencata sopra. Verifica visualmente che:
- Container è uniformemente largo (≈1152px su desktop).
- Niente layout rotto, niente overflow orizzontale.
- Su mobile (resize browser <640px) il padding `px-5` resta corretto.

Pagine per ruolo:
- **Dealer/Agenzia** (`dealer1@`, `agenzia1@`): /dashboard, /pratiche, /wallet, /affiliazione, /notifiche, /profilo (+ sub), /team (+ /team/[id]/edit), /orari, /inbox.
- **Admin** (`admin@`): /admin/dashboard, /admin/pratiche, /admin/broker, /admin/agenzie, /admin/utenti, /admin/escalation, /admin/segnalazioni, /admin/revisioni, /admin/affiliazioni (+ sospette), /admin/assistenti (+ edit), /admin/audit-log, /admin/listini, /admin/companies/[id], /admin/crm (tutte).

- [ ] **Step 4.4: Commit**

```bash
git add apps/piattaforma/src/app/profilo apps/piattaforma/src/app/team/[userId] apps/piattaforma/src/app/notifiche apps/piattaforma/src/app/orari apps/piattaforma/src/app/affiliazione apps/piattaforma/src/app/admin
git commit -m "refactor(ui): uniforma container pagine autenticate a max-w-6xl"
```

---

## Task 5: Form sotto-pagina a grid 2 colonne

**Files:**
- Modify: `apps/piattaforma/src/app/profilo/personale/form.tsx`
- Modify: `apps/piattaforma/src/app/profilo/sicurezza/client.tsx`
- Modify: `apps/piattaforma/src/app/team/[userId]/edit/edit-form.tsx`
- Modify (se esiste form analogo): `apps/piattaforma/src/app/admin/assistenti/[id]/edit/edit-form.tsx`
- Modify: pagina `/profilo/azienda` (se ha campi anagrafici inline)

Per ogni form sotto, individua il wrapper dei campi (di solito `<div className="space-y-4">`) e convertilo in `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">`. Lascia in single-column (`sm:col-span-2`) i campi lunghi (indirizzo, email se l'unico campo della riga, IBAN). Lascia la `<Card>` outer della larghezza naturale (full width all'interno di `max-w-6xl` padre).

Submit bar (`<button type="submit">`) resta full-width sotto la grid, con `sm:col-span-2` o fuori dalla grid.

- [ ] **Step 5.1: profilo/personale/form.tsx → grid**

Leggi `apps/piattaforma/src/app/profilo/personale/form.tsx`. Trova i campi (nome, cognome, codiceFiscale, dataNascita, luogoNascita). Wrappa in:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
  {/* nome */}
  {/* cognome */}
  {/* codiceFiscale */}
  {/* dataNascita */}
  <div className="sm:col-span-2">
    {/* luogoNascita full width */}
  </div>
</div>
```

Il submit `<button>` resta sotto la grid, fuori.

- [ ] **Step 5.2: profilo/sicurezza/client.tsx → grid se applicabile**

Leggi `apps/piattaforma/src/app/profilo/sicurezza/client.tsx`. Se la pagina è solo password change (vecchia + nuova + conferma), restano single column (campi password meglio se larghi 100%). Se contiene anche sezione 2FA, separarla in `<Card>` a fianco usando `<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">` come outer.

Se l'analisi rivela che il contenuto è già minimal o non beneficia di 2 colonne, **annota lo step come no-op e procedi**.

- [ ] **Step 5.3: team/[userId]/edit/edit-form.tsx → grid**

Leggi `apps/piattaforma/src/app/team/[userId]/edit/edit-form.tsx`. I campi sono email, nome, cognome. Wrappa:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
  <div className="sm:col-span-2">
    {/* email full width */}
  </div>
  {/* nome */}
  {/* cognome */}
</div>
```

- [ ] **Step 5.4: admin/assistenti/[id]/edit/edit-form.tsx → grid**

Stesso pattern di Step 5.3 se la struttura del form lo permette. Se il file ha solo un campo email, no-op.

- [ ] **Step 5.5: profilo/azienda → grid form anagrafica**

Verifica se `apps/piattaforma/src/app/profilo/azienda/page.tsx` o un suo form sotto (`*-form.tsx`) ha campi anagrafici. Se sì, applica grid pattern: ragioneSociale full, P.IVA│codiceSdi, PEC│email, telefono│IBAN, indirizzo full, citta│cap, provincia full o accoppiata.

Se la pagina è in sola lettura (no form di edit), no-op.

- [ ] **Step 5.6: Run typecheck**

Run: `pnpm -F piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 5.7: Smoke manuale browser**

Naviga le sotto-pagine modificate e verifica:
- Su desktop (≥640px) i campi sono in due colonne dove pianificato.
- Su mobile (<640px) collassano a 1 colonna.
- I submit button restano cliccabili e correttamente posizionati.

- [ ] **Step 5.8: Commit**

```bash
git add apps/piattaforma/src/app/profilo apps/piattaforma/src/app/team apps/piattaforma/src/app/admin/assistenti
git commit -m "refactor(ui): form sotto-pagine in grid 2 colonne per riempire larghezza max-w-6xl"
```

---

## Task 6: Smoke test e2e Playwright per modale /team

**Files:**
- Modify: `apps/piattaforma/e2e/smoke.spec.ts`

- [ ] **Step 6.1: Aggiungere test e2e per flusso modale Aggiungi utente**

Modify `apps/piattaforma/e2e/smoke.spec.ts` — aggiungere in fondo:

```ts
test('team modale Aggiungi utente apre, chiude con Esc, crea utente con password', async ({
  page,
}) => {
  // Login dealer
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('dealer1@passaggioveloce.it');
  await page.getByLabel(/password/i).fill('DevPass123!');
  await page.getByRole('button', { name: /Accedi/i }).click();
  await page.waitForURL(/\/dashboard/);

  // Apri /team
  await page.goto('/team');
  await expect(
    page.getByRole('heading', { name: /^Team$/, level: 1 }),
  ).toBeVisible();

  // CTA in alto a destra
  const cta = page.getByRole('button', { name: /Aggiungi utente/i });
  await expect(cta).toBeVisible();

  // Apri modale
  await cta.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Aggiungi utente/i, level: 2 }),
  ).toBeVisible();

  // Esc chiude
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // Riapri, switch tab Invito
  await cta.click();
  await page.getByRole('button', { name: /Invita via email/i }).click();

  // Click overlay chiude (click su area fuori panel)
  await page.locator('.pv-modal-backdrop').click({
    position: { x: 10, y: 10 },
  });
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
```

- [ ] **Step 6.2: Run e2e**

Run: `pnpm -F piattaforma test:e2e --grep "Aggiungi utente"`
Expected: PASS.

Se il test fallisce per setup mancante (es. Playwright browsers non installati): `pnpm -F piattaforma exec playwright install chromium` poi rerun.

- [ ] **Step 6.3: Commit**

```bash
git add apps/piattaforma/e2e/smoke.spec.ts
git commit -m "test(team): smoke e2e flusso modale Aggiungi utente"
```

---

## Verifica finale di sessione

- [ ] **Final 1: Typecheck completo**

Run: `pnpm -F piattaforma typecheck`
Expected: zero errori.

- [ ] **Final 2: Suite e2e completa**

Run: `pnpm -F piattaforma test:e2e`
Expected: tutti i test verde (smoke esistente + nuovo modale).

- [ ] **Final 3: Smoke manuale ruoli**

In dev server, login ciclico con i tre profili (admin / dealer / agenzia) e click su ogni voce del menu navigation. Per ogni pagina conferma `max-w-6xl` e nessun layout rotto.

- [ ] **Final 4: Memory update (se applicabile)**

Se durante l'esecuzione emergono pattern nuovi del progetto che servirà ricordare in futuro (es. nuova primitiva UI da preferire, decisioni di layout), aggiornare la memoria via i file in `~/.claude/projects/.../memory/`.
