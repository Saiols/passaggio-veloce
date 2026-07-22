'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';
import { useFieldErrorsState, zodFieldErrors, hasBlockingErrors } from '@/components/forms';
import { loginSchema } from '@/lib/auth/schemas';
import { loginAction, resendVerificationAction, type LoginActionState } from '../actions';

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

  // Gate verifica email: se le credenziali sono corrette ma l'account non ha
  // confermato l'email, il login è bloccato. Mostriamo un pannello dedicato con
  // il reinvio del link, invece del form (che riproporrebbe lo stesso blocco).
  if (state.needsEmailVerification) {
    return <VerifyEmailPanel email={state.email ?? email} />;
  }

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
        noValidate
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

/**
 * Pannello mostrato quando email+password sono corrette ma l'email non è ancora
 * verificata. Permette di reinviare il link di conferma senza rivelare nulla di
 * più (la Server Action risponde sempre "ok" per non fare enumeration).
 */
function VerifyEmailPanel({ email }: { email: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [demoToken, setDemoToken] = useState<string | null>(null);

  async function handleResend() {
    if (status === 'sending') return;
    setStatus('sending');
    setDemoToken(null);
    try {
      const res = await resendVerificationAction(email);
      if (res.ok) {
        setStatus('sent');
        if (res.demoToken) setDemoToken(res.demoToken);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Area riservata
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Verifica la tua email
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Per accedere devi prima confermare il tuo indirizzo email.
        </p>
      </div>

      <Alert variant="warning" title="Email non ancora verificata">
        Al momento della registrazione ti abbiamo inviato un link di conferma
        {email ? (
          <>
            {' '}a <strong>{email}</strong>
          </>
        ) : null}
        . Aprilo per attivare l&apos;account, poi torna qui e accedi. Non lo trovi? Controlla lo
        spam o richiedi un nuovo link qui sotto.
      </Alert>

      {status === 'sent' && (
        <Alert variant="success">
          Ti abbiamo inviato un nuovo link di verifica. Controlla la posta (anche lo spam).
          {demoToken && (
            <>
              {' '}
              <a
                href={`/verify-email?token=${demoToken}`}
                className="font-semibold underline underline-offset-4"
              >
                Link diretto (solo demo)
              </a>
            </>
          )}
        </Alert>
      )}
      {status === 'error' && (
        <Alert variant="error">Non è stato possibile inviare l&apos;email. Riprova tra poco.</Alert>
      )}

      <Button
        type="button"
        onClick={handleResend}
        loading={status === 'sending'}
        loadingLabel="Invio in corso…"
        fullWidth
      >
        Reinvia email di verifica
      </Button>

      <div className="pt-1 text-[13px]">
        <a
          href="/login"
          className="font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Torna al login
        </a>
      </div>
    </div>
  );
}
