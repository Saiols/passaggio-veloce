'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';
import { loginAction, type LoginActionState } from '../actions';

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

      <form action={formAction} className="space-y-4">
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="nome@azienda.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={state.needTotp}
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
