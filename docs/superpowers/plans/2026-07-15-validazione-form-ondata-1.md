# Validazione form — Ondata 1 (primitivo + 5 form) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire il primitivo di validazione condiviso (bordo rosso + messaggio-motivo, «mai rossi all'apertura», reveal al submit) e applicarlo a 5 form rappresentativi.

**Architecture:** Un hook `useFieldErrorsState(errors)` tiene lo stato `touched`/`revealed` e traduce una mappa `campo→messaggio` (prodotta dall'adapter puro `zodFieldErrors(schema, values)`) in `{ invalid, error, onBlur }` per campo, applicando la regola `(touched || revealed)`. Il rendering riusa i componenti esistenti `Field` (`error`) e `Input/Select/PasswordInput` (`invalid`). Il submit passa da `gatedSubmit`/`hasBlockingErrors`: al clic fa reveal e, se ci sono errori, blocca.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, Zod ^3.25, Vitest ^4 + happy-dom, Tailwind (design system Trust Blue).

## Global Constraints

- Zod è la **fonte unica** della validazione: riusare `packages/lib/src/validators.ts` (`@pv/lib`) e `apps/piattaforma/src/lib/auth/schemas.ts`. **Non** duplicare i messaggi a mano.
- Regola di visibilità (verbatim): `mostraErrore = (touched || revealed) && errors[campo] != null`. **All'apertura nessun campo è in errore.**
- CTA **sempre attivo**; al submit → `reveal()` + se `hasBlockingErrors` allora blocca (niente server action / niente navigazione).
- La validazione **server resta invariata** (difesa in profondità). Il client non la sostituisce.
- Percorso primitivo: `apps/piattaforma/src/components/forms/`. Non toccare la logica del wizard `/pratiche/nuova` (Ondata 3).
- Node: usare `nvm use 22.15.0` prima di pnpm. Typecheck a **cache calda** (a freddo `tsc` dà falsi errori).
- Zod v3: le issue stanno in `result.error.issues`; `issue.path` è `(string|number)[]`.

---

### Task 1: Primitivo condiviso `components/forms/`

**Files:**
- Create: `apps/piattaforma/src/components/forms/zod-field-errors.ts`
- Create: `apps/piattaforma/src/components/forms/field-errors-state.tsx`
- Create: `apps/piattaforma/src/components/forms/index.ts`
- Test: `apps/piattaforma/src/components/forms/zod-field-errors.test.ts`
- Test: `apps/piattaforma/src/components/forms/field-errors-state.test.tsx`

**Interfaces:**
- Consumes: `zod` (`z.ZodTypeAny`), React (`useState`).
- Produces (nomi/tipi che le Task 2-6 useranno **verbatim**):
  - `zodFieldErrors(schema: z.ZodTypeAny, values: unknown): Record<string, string>` — prima issue per `path[0]`.
  - `hasBlockingErrors(errors: Record<string, string | undefined>): boolean`.
  - `type FieldState = { invalid: boolean; error: string | undefined; onBlur: () => void }`.
  - `useFieldErrorsState(errors: Record<string, string | undefined>): { field: (key: string) => FieldState; gatedSubmit: (onValid: () => void) => (e: { preventDefault: () => void }) => void; reveal: () => void; resetReveal: () => void; revealed: boolean }`.

- [ ] **Step 1: Scrivere i test dell'adapter puro (falliscono)**

Create `apps/piattaforma/src/components/forms/zod-field-errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodFieldErrors, hasBlockingErrors } from './zod-field-errors';

const schema = z
  .object({
    email: z.string().email('Email non valida'),
    password: z.string().min(1, 'Password obbligatoria'),
    conferma: z.string(),
  })
  .refine((d) => d.password === d.conferma, {
    message: 'Le password non coincidono',
    path: ['conferma'],
  });

describe('zodFieldErrors', () => {
  it('nessun errore su valori validi', () => {
    expect(zodFieldErrors(schema, { email: 'a@b.it', password: 'x', conferma: 'x' })).toEqual({});
  });
  it('mappa la issue sul nome del campo (path[0])', () => {
    const e = zodFieldErrors(schema, { email: 'nope', password: 'x', conferma: 'x' });
    expect(e).toEqual({ email: 'Email non valida' });
  });
  it('più campi invalidi → una entry per campo', () => {
    const e = zodFieldErrors(schema, { email: 'nope', password: '', conferma: '' });
    expect(e.email).toBe('Email non valida');
    expect(e.password).toBe('Password obbligatoria');
  });
  it('prima issue vince per lo stesso campo', () => {
    const s = z.object({ p: z.string().min(2, 'primo').regex(/\d/, 'secondo') });
    expect(zodFieldErrors(s, { p: 'a' }).p).toBe('primo');
  });
  it('refine cross-field finisce sul path indicato', () => {
    const e = zodFieldErrors(schema, { email: 'a@b.it', password: 'x', conferma: 'y' });
    expect(e).toEqual({ conferma: 'Le password non coincidono' });
  });
});

describe('hasBlockingErrors', () => {
  it('false su mappa vuota', () => expect(hasBlockingErrors({})).toBe(false));
  it('false se tutti i valori sono undefined', () =>
    expect(hasBlockingErrors({ a: undefined })).toBe(false));
  it('true se almeno un messaggio è presente', () =>
    expect(hasBlockingErrors({ a: undefined, b: 'x' })).toBe(true));
});
```

- [ ] **Step 2: Eseguire i test → devono fallire**

Run: `cd apps/piattaforma && pnpm vitest run src/components/forms/zod-field-errors.test.ts`
Expected: FAIL (modulo `./zod-field-errors` inesistente).

- [ ] **Step 3: Implementare l'adapter puro**

Create `apps/piattaforma/src/components/forms/zod-field-errors.ts`:

```ts
import type { z } from 'zod';

export type FieldErrorsMap = Record<string, string | undefined>;

/**
 * Valida `values` con `schema` e restituisce una mappa campo→messaggio.
 * Prende la PRIMA issue per ciascun `path[0]` (i messaggi vengono dagli schemi
 * Zod condivisi, così client e server dicono la stessa cosa). Funzione pura.
 */
export function zodFieldErrors(
  schema: z.ZodTypeAny,
  values: unknown,
): Record<string, string> {
  const res = schema.safeParse(values);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** True se almeno un campo ha un messaggio (usata per gatare il submit). */
export function hasBlockingErrors(errors: FieldErrorsMap): boolean {
  return Object.values(errors).some(Boolean);
}
```

- [ ] **Step 4: Eseguire i test → devono passare**

Run: `cd apps/piattaforma && pnpm vitest run src/components/forms/zod-field-errors.test.ts`
Expected: PASS (8 test).

- [ ] **Step 5: Scrivere il test dell'hook (fallisce)**

Create `apps/piattaforma/src/components/forms/field-errors-state.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFieldErrorsState } from './field-errors-state';

// Sonda: espone il risultato dell'hook su un oggetto esterno per poterlo pilotare.
function makeProbe(errors: Record<string, string | undefined>) {
  const api: { current: ReturnType<typeof useFieldErrorsState> | null } = { current: null };
  function Probe() {
    api.current = useFieldErrorsState(errors);
    const f = api.current.field('email');
    return <span data-invalid={f.invalid ? '1' : '0'} data-error={f.error ?? ''} />;
  }
  return { api, Probe };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useFieldErrorsState', () => {
  it('all\'apertura nessun campo è in errore, anche con errori presenti', () => {
    const { Probe } = makeProbe({ email: 'Email non valida' });
    render(<Probe />);
    expect(host!.querySelector('span')!.getAttribute('data-invalid')).toBe('0');
    expect(host!.querySelector('span')!.getAttribute('data-error')).toBe('');
  });

  it('onBlur di un campo lo rende invalido con messaggio', () => {
    const { api, Probe } = makeProbe({ email: 'Email non valida' });
    render(<Probe />);
    act(() => api.current!.field('email').onBlur());
    expect(host!.querySelector('span')!.getAttribute('data-invalid')).toBe('1');
    expect(host!.querySelector('span')!.getAttribute('data-error')).toBe('Email non valida');
  });

  it('gatedSubmit con errori fa reveal e NON chiama onValid', () => {
    let called = false;
    const { api, Probe } = makeProbe({ email: 'Email non valida' });
    render(<Probe />);
    act(() => api.current!.gatedSubmit(() => { called = true; })({ preventDefault() {} }));
    expect(called).toBe(false);
    expect(host!.querySelector('span')!.getAttribute('data-invalid')).toBe('1');
  });

  it('gatedSubmit senza errori chiama onValid', () => {
    let called = false;
    const { api, Probe } = makeProbe({});
    render(<Probe />);
    act(() => api.current!.gatedSubmit(() => { called = true; })({ preventDefault() {} }));
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 6: Eseguire il test → deve fallire**

Run: `cd apps/piattaforma && pnpm vitest run src/components/forms/field-errors-state.test.tsx`
Expected: FAIL (modulo `./field-errors-state` inesistente).

- [ ] **Step 7: Implementare l'hook**

Create `apps/piattaforma/src/components/forms/field-errors-state.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { hasBlockingErrors, type FieldErrorsMap } from './zod-field-errors';

export type FieldState = {
  invalid: boolean;
  error: string | undefined;
  onBlur: () => void;
};

/**
 * Stato di validazione di un form a componente singolo. Riceve la mappa
 * campo→messaggio (da `zodFieldErrors`) e applica la regola di visibilità:
 * un campo mostra bordo+messaggio SOLO se toccato (blur) o dopo un submit
 * (reveal). All'apertura nessun campo è in errore.
 */
export function useFieldErrorsState(errors: FieldErrorsMap) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);

  const touch = (key: string): void =>
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  const field = (key: string): FieldState => {
    const show = (touched.has(key) || revealed) && errors[key] ? errors[key] : undefined;
    return { invalid: Boolean(show), error: show, onBlur: () => touch(key) };
  };

  const reveal = (): void => setRevealed(true);
  const resetReveal = (): void => setRevealed(false);

  const gatedSubmit =
    (onValid: () => void) =>
    (e: { preventDefault: () => void }): void => {
      e.preventDefault();
      setRevealed(true);
      if (hasBlockingErrors(errors)) return;
      onValid();
    };

  return { field, gatedSubmit, reveal, resetReveal, revealed };
}
```

- [ ] **Step 8: Eseguire il test → deve passare**

Run: `cd apps/piattaforma && pnpm vitest run src/components/forms/field-errors-state.test.tsx`
Expected: PASS (4 test).

- [ ] **Step 9: Creare il barrel `index.ts`**

Create `apps/piattaforma/src/components/forms/index.ts`:

```ts
export { zodFieldErrors, hasBlockingErrors, type FieldErrorsMap } from './zod-field-errors';
export { useFieldErrorsState, type FieldState } from './field-errors-state';
```

- [ ] **Step 10: Typecheck del pacchetto**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore introdotto da `src/components/forms/*`.

- [ ] **Step 11: Commit**

```bash
git add apps/piattaforma/src/components/forms
git commit -m "feat(forms): primitivo validazione condiviso (zodFieldErrors + useFieldErrorsState)"
```

---

### Task 2: Convertire `login-form` (archetipo A, esemplare)

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/login/login-form.tsx`

**Interfaces:**
- Consumes: `useFieldErrorsState`, `zodFieldErrors`, `hasBlockingErrors` da `@/components/forms`; `loginSchema` da `@/lib/auth/schemas` (già esistente: `email.email('Email non valida')`, `password.min(1, 'Password obbligatoria')`).

- [ ] **Step 1: Riscrivere il file completo**

Replace `apps/piattaforma/src/app/(auth)/login/login-form.tsx` con:

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';
import { useFieldErrorsState, zodFieldErrors, hasBlockingErrors } from '@/components/forms';
import { loginSchema } from '@/lib/auth/schemas';
import { loginAction, type LoginActionState } from '../actions';

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // In fase TOTP email/password sono readOnly e già validi: niente errori client.
  const errors = state.needTotp ? {} : zodFieldErrors(loginSchema, { email, password });
  const { field, reveal } = useFieldErrorsState(errors);
  const emailF = field('email');
  const pwF = field('password');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Area riservata
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Accedi
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          {state.needTotp
            ? 'Inserisci il codice del tuo autenticatore (o un backup code).'
            : 'Inserisci le credenziali del tuo account.'}
        </p>
      </div>

      {state.error && <Alert variant="error">{state.error}</Alert>}

      <form
        action={formAction}
        onSubmit={(e) => {
          reveal();
          if (hasBlockingErrors(errors)) e.preventDefault();
        }}
        className="space-y-4"
      >
        <Field label="Email" htmlFor="email" required error={emailF.error}>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="nome@azienda.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={emailF.onBlur}
            invalid={emailF.invalid}
            readOnly={state.needTotp}
          />
        </Field>

        <Field label="Password" htmlFor="password" required error={pwF.error}>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={pwF.onBlur}
            invalid={pwF.invalid}
            readOnly={state.needTotp}
          />
        </Field>

        {state.needTotp && (
          <Field label="Codice 2FA" htmlFor="totp" required>
            <Input
              id="totp"
              name="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456 oppure backup code"
            />
          </Field>
        )}

        <Button type="submit" loading={pending} loadingLabel="Accesso in corso…" fullWidth>
          {state.needTotp ? 'Verifica codice' : 'Accedi'}
        </Button>
      </form>

      <div className="flex items-center justify-between pt-1 text-[13px]">
        <Link
          href="/reset-password"
          className="font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          Password dimenticata?
        </Link>
        <Link
          href="/register"
          className="font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          Registra la tua azienda
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/login/login-form.tsx
git commit -m "feat(forms): validazione client su login (bordo + messaggio, reveal al submit)"
```

---

### Task 3: Convertire `profilo/personale/password-form` (conferma cross-field)

**Files:**
- Modify: `apps/piattaforma/src/app/profilo/personale/password-form.tsx`

**Interfaces:**
- Consumes: `useFieldErrorsState`, `zodFieldErrors` da `@/components/forms`; `passwordSchema` da `@pv/lib`.

- [ ] **Step 1: Riscrivere il file completo**

Replace `apps/piattaforma/src/app/profilo/personale/password-form.tsx` con:

```tsx
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { passwordSchema } from '@pv/lib';
import { Button, Field, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { changeOwnPasswordAction } from './actions';

const cambioPasswordSchema = z
  .object({
    attuale: z.string().min(1, 'Inserisci la password attuale'),
    nuova: passwordSchema,
    conferma: z.string().min(1, 'Ripeti la nuova password'),
  })
  .refine((d) => d.nuova === d.conferma, {
    message: 'Le due nuove password non coincidono',
    path: ['conferma'],
  });

export function CambioPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [attuale, setAttuale] = useState('');
  const [nuova, setNuova] = useState('');
  const [conferma, setConferma] = useState('');

  const errors = zodFieldErrors(cambioPasswordSchema, { attuale, nuova, conferma });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fAttuale = field('attuale');
  const fNuova = field('nuova');
  const fConferma = field('conferma');

  const onValid = (): void => {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const res = await changeOwnPasswordAction(attuale, nuova);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAttuale('');
      setNuova('');
      setConferma('');
      setDone(true);
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Password attuale" required error={fAttuale.error} className="sm:col-span-2">
          <PasswordInput
            value={attuale}
            onChange={(e) => setAttuale(e.target.value)}
            onBlur={fAttuale.onBlur}
            invalid={fAttuale.invalid}
            autoComplete="current-password"
          />
        </Field>
        <Field label="Nuova password" required error={fNuova.error}>
          <PasswordInput
            value={nuova}
            onChange={(e) => setNuova(e.target.value)}
            onBlur={fNuova.onBlur}
            invalid={fNuova.invalid}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Ripeti nuova password" required error={fConferma.error}>
          <PasswordInput
            value={conferma}
            onChange={(e) => setConferma(e.target.value)}
            onBlur={fConferma.onBlur}
            invalid={fConferma.invalid}
            autoComplete="new-password"
          />
        </Field>
      </div>

      <p className="text-[12px] text-pv-slate-500">
        Almeno 8 caratteri, con maiuscole, minuscole e numeri. Non ricordi la password
        attuale?{' '}
        <Link
          href="/reset-password"
          className="font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          Reimpostala via email
        </Link>
        .
      </p>

      {error && <p className="text-[12px] text-pv-red-500">{error}</p>}
      {done && !error && (
        <p className="text-[12px] text-pv-green-500">
          Password aggiornata. Usala dal prossimo accesso.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="md" loading={pending} loadingLabel="Aggiornamento…">
          Aggiorna password
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Aggiornamento…" />
    </form>
  );
}
```

Nota: rimosso il `disabled={... !attuale ...}` sul Button (il CTA resta sempre attivo, come da spec) e la validazione cross-field ora vive nello schema (niente più `if (nuova !== conferma)` a mano). Lo stile `INPUT_CLASS` custom è sostituito dallo stile di default del design system (bordo rosso corretto in errore). `Field` fornisce la label al posto delle `<label><span>` manuali.

- [ ] **Step 2: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/profilo/personale/password-form.tsx
git commit -m "feat(forms): validazione client su cambio password (policy + conferma cross-field)"
```

---

### Task 4: Convertire `invito/accept-form` (obbligatori testuali + password)

**Files:**
- Modify: `apps/piattaforma/src/app/invito/[token]/accept-form.tsx`
- Modify: `apps/piattaforma/src/lib/auth/schemas.ts` (aggiunta `acceptInviteSchema`)

**Interfaces:**
- Consumes: `useFieldErrorsState`, `zodFieldErrors` da `@/components/forms`; `acceptInviteSchema` (nuovo) da `@/lib/auth/schemas`.
- Produces: `acceptInviteSchema` (usata solo qui, ma vive nell'hub auth per coerenza).

- [ ] **Step 1: Aggiungere lo schema in `lib/auth/schemas.ts`**

In fondo a `apps/piattaforma/src/lib/auth/schemas.ts` aggiungere:

```ts
// Accettazione invito dipendente: nome/cognome + password (policy standard).
export const acceptInviteSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obbligatorio'),
  cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
  password: passwordSchema,
});
```

(`passwordSchema` è già importato da `@pv/lib` in cima al file.)

- [ ] **Step 2: Riscrivere il form completo**

Replace `apps/piattaforma/src/app/invito/[token]/accept-form.tsx` con:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { acceptInviteSchema } from '@/lib/auth/schemas';
import { acceptInvitationAction } from '@/app/team/actions';

export function AcceptForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [password, setPassword] = useState('');

  const errors = zodFieldErrors(acceptInviteSchema, { nome, cognome, password });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fNome = field('nome');
  const fCognome = field('cognome');
  const fPassword = field('password');

  const onValid = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await acceptInvitationAction(token, nome, cognome, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/login?invited=success');
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} className="mt-6 space-y-3">
      <Field label="Nome" required error={fNome.error}>
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={fNome.onBlur}
          invalid={fNome.invalid}
          placeholder="Nome"
        />
      </Field>
      <Field label="Cognome" required error={fCognome.error}>
        <Input
          name="cognome"
          value={cognome}
          onChange={(e) => setCognome(e.target.value)}
          onBlur={fCognome.onBlur}
          invalid={fCognome.invalid}
          placeholder="Cognome"
        />
      </Field>
      <Field label="Password" required error={fPassword.error}>
        <PasswordInput
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={fPassword.onBlur}
          invalid={fPassword.invalid}
          placeholder="Password (min 8, A-z, 0-9)"
        />
      </Field>
      {error && <p className="text-sm text-pv-red-500">{error}</p>}
      <Button type="submit" loading={pending} loadingLabel="Creazione…" fullWidth>
        Crea il mio account
      </Button>
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/invito/[token]/accept-form.tsx apps/piattaforma/src/lib/auth/schemas.ts
git commit -m "feat(forms): validazione client su accettazione invito"
```

---

### Task 5: Convertire `reset-password/reset-form` (email + password, due varianti)

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/reset-password/reset-form.tsx`
- Modify: `apps/piattaforma/src/lib/auth/schemas.ts` (aggiunta `resetRequestSchema`, `resetConfirmSchema`)

**Interfaces:**
- Consumes: `useFieldErrorsState`, `zodFieldErrors` da `@/components/forms`; `resetRequestSchema`/`resetConfirmSchema` (nuovi) da `@/lib/auth/schemas`.

**Nota policy:** il form oggi usa `minLength={10}` per la nuova password mentre la policy canonica (`passwordSchema`) è min 8. Lo schema usa `passwordSchema` (allinea alla policy di tutta la piattaforma). **Prima di committare, verificare** che `confirmPasswordResetAction` non richieda un minimo diverso; se lo richiede, replicare quel minimo nello schema.

- [ ] **Step 1: Aggiungere gli schemi in `lib/auth/schemas.ts`**

In fondo a `apps/piattaforma/src/lib/auth/schemas.ts` aggiungere:

```ts
// Reset password: richiesta (email) e conferma (nuova password, policy standard).
export const resetRequestSchema = z.object({
  email: z.string().email('Email non valida'),
});
export const resetConfirmSchema = z.object({
  password: passwordSchema,
});
```

- [ ] **Step 2: Verificare il minimo lato server**

Run: `grep -n "password" apps/piattaforma/src/app/(auth)/actions.ts`
Expected: individuare la validazione di `confirmPasswordResetAction`. Se usa un min diverso da `passwordSchema`, adeguare `resetConfirmSchema` prima di procedere.

- [ ] **Step 3: Riscrivere il form completo**

Replace `apps/piattaforma/src/app/(auth)/reset-password/reset-form.tsx` con:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { resetRequestSchema, resetConfirmSchema } from '@/lib/auth/schemas';
import {
  requestPasswordResetAction,
  confirmPasswordResetAction,
} from '@/app/(auth)/actions';

export function ResetForm({ token }: { token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const errors = token
    ? zodFieldErrors(resetConfirmSchema, { password })
    : zodFieldErrors(resetRequestSchema, { email });
  const { field, gatedSubmit } = useFieldErrorsState(errors);

  const onRequest = (): void => {
    setError(null);
    setSuccess(null);
    setDemoLink(null);
    startTransition(async () => {
      const res = await requestPasswordResetAction(email);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess("Se l'email è registrata, riceverai un link per reimpostare la password.");
      if (res.demoToken) {
        setDemoLink(`${window.location.origin}/reset-password?token=${res.demoToken}`);
      }
    });
  };

  const onConfirm = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await confirmPasswordResetAction(token!, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/login?reset=success');
    });
  };

  if (token) {
    const fPassword = field('password');
    return (
      <form onSubmit={gatedSubmit(onConfirm)} className="mt-6 space-y-4">
        <Field label="Nuova password" required error={fPassword.error}>
          <PasswordInput
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={fPassword.onBlur}
            invalid={fPassword.invalid}
            placeholder="Nuova password"
          />
        </Field>
        {error && <p className="text-sm text-pv-red-600">{error}</p>}
        <Button type="submit" loading={pending} loadingLabel="Salvataggio…" fullWidth>
          Imposta password
        </Button>
        <LoadingOverlay show={pending} label="Salvataggio…" />
      </form>
    );
  }

  const fEmail = field('email');
  return (
    <form onSubmit={gatedSubmit(onRequest)} className="mt-6 space-y-4">
      <Field label="Email" required error={fEmail.error}>
        <Input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={fEmail.onBlur}
          invalid={fEmail.invalid}
          placeholder="email@esempio.it"
        />
      </Field>
      {error && <p className="text-sm text-pv-red-600">{error}</p>}
      {success && <p className="text-sm text-pv-green-500">{success}</p>}
      {demoLink && (
        <div className="rounded-lg bg-pv-amber-50 border border-pv-amber-500 p-3 text-xs">
          <p className="font-bold text-pv-navy-900">🧪 Demo</p>
          <a href={demoLink} className="text-pv-navy-700 underline break-all">
            {demoLink}
          </a>
        </div>
      )}
      <Button type="submit" loading={pending} loadingLabel="Invio…" fullWidth>
        Invia link
      </Button>
      <LoadingOverlay show={pending} label="Invio…" />
    </form>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/reset-password/reset-form.tsx apps/piattaforma/src/lib/auth/schemas.ts
git commit -m "feat(forms): validazione client su reset password (richiesta + conferma)"
```

---

### Task 6: Convertire `team/create-user-form` (archetipo B: normalizzazione raw-HTML + select)

**Files:**
- Modify: `apps/piattaforma/src/app/team/create-user-form.tsx`

**Interfaces:**
- Consumes: `useFieldErrorsState`, `zodFieldErrors` da `@/components/forms`; `passwordSchema` da `@pv/lib`.

**Nota:** questo form era raw-HTML (`<input className="border…">`). La conversione lo normalizza su `Field`/`Input`/`PasswordInput`/`Select`. La matrice permessi e il select ruolo restano invariati (non sono campi «obbligatori con valore»). Il `sedeId` è obbligatorio solo quando ci sono più sedi → schema costruito con `useMemo` in base a `sedi.length > 1`.

- [ ] **Step 1: Riscrivere il file completo**

Replace `apps/piattaforma/src/app/team/create-user-form.tsx` con:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { z } from 'zod';
import { passwordSchema } from '@pv/lib';
import { Button, Field, Input, PasswordInput, Select } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { MatricePermessi } from '@/components/permessi/matrice-permessi';
import { applicaPreset, permessiConcedibili } from '@/components/permessi/matrice-logic';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { createUserDirectAction } from './actions';

export function CreateUserForm({
  onSuccess,
  sedi = [],
  companyType,
  assegnabili,
  puoScegliere,
}: {
  onSuccess?: () => void;
  sedi?: { id: string; nome: string }[];
  companyType: CompanyTypeP;
  assegnabili: Permesso[];
  puoScegliere: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ruoloSede, setRuoloSede] = useState<'ADMIN_SEDE' | 'OPERATORE'>('OPERATORE');
  const [permessi, setPermessi] = useState<Permesso[]>(
    applicaPreset('OPERATORE_BASE', companyType, permessiConcedibili(assegnabili, 'OPERATORE')),
  );

  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [password, setPassword] = useState('');
  const [sedeId, setSedeId] = useState('');

  const needSede = sedi.length > 1;
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email('Email non valida'),
        nome: z.string().trim().min(1, 'Nome obbligatorio'),
        cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
        password: passwordSchema,
        sedeId: needSede ? z.string().min(1, 'Seleziona una sede') : z.string().optional(),
      }),
    [needSede],
  );

  const errors = zodFieldErrors(schema, { email, nome, cognome, password, sedeId });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fEmail = field('email');
  const fNome = field('nome');
  const fCognome = field('cognome');
  const fPassword = field('password');
  const fSede = field('sedeId');

  function onRuoloChange(r: 'ADMIN_SEDE' | 'OPERATORE') {
    setRuoloSede(r);
    setPermessi(
      applicaPreset(
        r === 'ADMIN_SEDE' ? 'ADMIN_SEDE' : 'OPERATORE_BASE',
        companyType,
        permessiConcedibili(assegnabili, r),
      ),
    );
  }

  const onValid = (): void => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await createUserDirectAction(
        email,
        nome,
        cognome,
        password,
        needSede ? sedeId : undefined,
        ruoloSede,
        puoScegliere ? permessi : undefined,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(
        `Account creato per ${email}. Comunica le credenziali al dipendente fuori piattaforma.`,
      );
      onSuccess?.();
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Email" required error={fEmail.error} className="sm:col-span-2">
        <Input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={fEmail.onBlur}
          invalid={fEmail.invalid}
          placeholder="dipendente@azienda.it"
        />
      </Field>
      <Field label="Nome" required error={fNome.error}>
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={fNome.onBlur}
          invalid={fNome.invalid}
          placeholder="Nome"
        />
      </Field>
      <Field label="Cognome" required error={fCognome.error}>
        <Input
          name="cognome"
          value={cognome}
          onChange={(e) => setCognome(e.target.value)}
          onBlur={fCognome.onBlur}
          invalid={fCognome.invalid}
          placeholder="Cognome"
        />
      </Field>
      <Field
        label="Password iniziale"
        required
        error={fPassword.error}
        hint="Min 8, con maiuscole, minuscole e numeri"
        className="sm:col-span-2"
      >
        <PasswordInput
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={fPassword.onBlur}
          invalid={fPassword.invalid}
          placeholder="Password iniziale"
        />
      </Field>
      {needSede && (
        <Field label="Sede" required error={fSede.error}>
          <Select
            name="sedeId"
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            onBlur={fSede.onBlur}
            invalid={fSede.invalid}
          >
            <option value="" disabled>
              Sede…
            </option>
            {sedi.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Ruolo" className={needSede ? undefined : 'sm:col-span-2'}>
        <Select
          name="ruoloSede"
          value={ruoloSede}
          onChange={(e) => onRuoloChange(e.target.value as 'ADMIN_SEDE' | 'OPERATORE')}
        >
          <option value="OPERATORE">Operatore</option>
          <option value="ADMIN_SEDE">Admin di sede</option>
        </Select>
      </Field>
      {puoScegliere ? (
        <div className="sm:col-span-2">
          <MatricePermessi
            companyType={companyType}
            ruoloSede={ruoloSede}
            value={permessi}
            onChange={setPermessi}
            assegnabili={assegnabili}
          />
        </div>
      ) : (
        <p className="text-sm text-pv-slate-500 sm:col-span-2">
          L&apos;utente riceverà i permessi di base. Per personalizzarli, chiedi al titolare.
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending} loadingLabel="Creazione…" fullWidth>
          Crea account
        </Button>
      </div>
      {error && <p className="text-sm text-pv-red-500 sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 sm:col-span-2">{success}</p>}
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore. (Se `Button` non espone `fullWidth`/`loading`, verificarne l'API in `components/ui/button.tsx` e adeguare — vedi Task 2/3 che li usano già.)

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/team/create-user-form.tsx
git commit -m "feat(forms): validazione client su create-user (normalizzazione raw-HTML → design system)"
```

---

### Task 7: Verifica browser end-of-Ondata-1 + typecheck completo + memoria

**Files:** nessuna modifica di codice (salvo fix emersi dalla verifica).

Questa Task è il **gate** dell'Ondata 1: la mia memoria è categorica sul fatto che «solo il browser lo vede» e che navigare per URL o leggere i byte non prova il render. La verifica va fatta col **gesto utente** sul DOM.

- [ ] **Step 1: Typecheck completo a cache calda**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 2: Suite unit del primitivo**

Run: `cd apps/piattaforma && pnpm vitest run src/components/forms`
Expected: PASS (12 test), più `src/app/pratiche/nuova/field-errors.test.ts` ancora verde.

- [ ] **Step 3: Avviare il dev server**

Run: `nvm use 22.15.0 && pnpm --filter piattaforma dev`
(Login con l'admin di test — vedi memoria credenziali dev locali.)

- [ ] **Step 4: Verificare `/login` (usare la skill `verify` o Chrome DevTools MCP)**

Per ciascun punto osservare il **DOM renderizzato** (attributo `aria-invalid` sul controllo, testo del `<p>` messaggio), non il sorgente:
  1. Apertura: nessun input ha `aria-invalid`; nessun `<p>` di errore.
  2. Focus su Email, scrivere `nonvalida`, blur → Email ha `aria-invalid="true"` + messaggio «Email non valida»; Password **no**.
  3. Svuotare tutto, cliccare «Accedi» → sia Email che Password mostrano bordo + messaggio; **nessuna navigazione**.
  4. Compilare email valida + password non vuota → il submit procede (parte l'action).

- [ ] **Step 5: Verificare gli altri 4 form con gli stessi 4 controlli**

  - `/reset-password` (variante email) e `/reset-password?token=…` (variante password).
  - `/invito/<token>` (nome/cognome/password) — serve un token di invito valido dal DB locale; in mancanza, verificare almeno il render dei bordi/messaggi generando gli errori con submit a vuoto.
  - Cambio password in `/profilo/personale`: verificare in più che «Ripeti nuova password» diversa mostri «Le due nuove password non coincidono» dopo blur/submit.
  - Creazione utente in `/team` (modale): password debole → messaggio policy; con più sedi, sede non scelta → «Seleziona una sede».

- [ ] **Step 6: Aggiornare la memoria di progetto**

Aggiornare `[[project_wizard_pratica_migliorie]]` o creare una nuova memoria `project_validazione_form` che registri: primitivo `components/forms/` (`useFieldErrorsState` + `zodFieldErrors`), regola touched||reveal, CTA sempre-attivo-reveal, Ondata 1 completata, prossime ondate (2: onboarding/azienda/sedi; 3: `/pratiche/nuova` solo messaggi; 4: sweep admin/CRM). Collegare `[[project_design_system]]`, `[[feedback_verifica_sul_dom_e_gesto_utente]]`.

- [ ] **Step 7: Commit finale (se emersi fix in verifica)**

```bash
git add -A
git commit -m "test(forms): verifica browser Ondata 1 + fix emersi"
```

---

## Scostamenti dallo spec (decisi in fase di piano)

- **Hook invece di `FieldErrorsProvider`/context.** Tutti i form dell'Ondata 1
  sono a componente singolo: un hook `useFieldErrorsState(errors)` dà la stessa
  semantica (touched||reveal, messaggi, gating) senza il boilerplate di
  provider + split wrapper/inner. Il `FieldErrorsProvider`/context si introduce
  in Ondata 2 **solo** dove i campi vivono in figli lontani dal CTA (es.
  `register-wizard` a step). La regola di visibilità è identica a quella dello
  spec e al `computeInvalid` del wizard (che resta invariato: nessuna doppia
  copia reintrodotta — il nuovo modulo non ridefinisce `computeInvalid`).
- **Errori solo-server: restano top-level in Ondata 1.** Lo spec prevede di
  mappare l'errore del server sul campo (es. «email già registrata» → bordo su
  email). Le server action attuali tornano `{ ok: false, error: string }`
  **senza** una chiave-campo, quindi la mappatura richiederebbe di cambiarne la
  firma — fuori dallo scope «validazione client». In Ondata 1 l'errore server
  resta dov'è già oggi (`Alert`/`<p>`), che **non è una regressione**. La
  mappatura sul campo è un affinamento successivo (quando si toccano le action).

## Note per le ondate successive (fuori da questo piano)

- **Ondata 2** (onboarding + azienda/sedi): `register-wizard` (ha già gli schemi Zod per step; qui probabilmente serve il `FieldErrorsProvider`/context perché i campi sono in step/sotto-componenti), `sedi/create`+`edit`, `company-edit-form`, `profilo/azienda`, `team/invite`, `team/[userId]/edit`, `blocco-pagamento` (IBAN), `admin/assistenti/create`+`edit`, `profilo/personale/form`.
- **Ondata 3**: `/pratiche/nuova` — solo messaggi sui predicati esistenti, nessuna riscrittura in Zod.
- **Ondata 4**: sweep form data-entry admin/CRM residui.
- **Fuori scope permanente**: barre filtri, ricerche, form a singolo bottone-azione, toggle notifiche, input chatbot.
