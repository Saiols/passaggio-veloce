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
