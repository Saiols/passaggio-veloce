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
      <form onSubmit={gatedSubmit(onConfirm)} noValidate className="mt-6 space-y-4">
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
    <form onSubmit={gatedSubmit(onRequest)} noValidate className="mt-6 space-y-4">
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
