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
