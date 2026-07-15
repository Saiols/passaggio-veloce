'use client';

import { useState, useTransition } from 'react';
import { z } from 'zod';
import { passwordSchema } from '@pv/lib';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { createAssistenteAction } from './actions';

const createAssistenteSchema = z.object({
  email: z.string().email('Email non valida'),
  nome: z.string().trim().min(1, 'Nome obbligatorio'),
  cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
  password: passwordSchema,
});

export function CreateAssistenteForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [password, setPassword] = useState('');

  const errors = zodFieldErrors(createAssistenteSchema, { email, nome, cognome, password });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fEmail = field('email');
  const fNome = field('nome');
  const fCognome = field('cognome');
  const fPassword = field('password');

  const onValid = (): void => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await createAssistenteAction(email, nome, cognome, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(`Assistente creato per ${email}. Comunica le credenziali fuori piattaforma.`);
      onSuccess?.();
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Email" required error={fEmail.error} className="sm:col-span-2">
        <Input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={fEmail.onBlur}
          invalid={fEmail.invalid}
          placeholder="assistente@passaggioveloce.it"
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
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending} loadingLabel="Creazione…" fullWidth>
          Crea assistente
        </Button>
      </div>
      {error && <p className="text-sm text-pv-red-500 sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 sm:col-span-2">{success}</p>}
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
