'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { codiceFiscaleSchema } from '@pv/lib';
import { Button, Field, Input } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { updateOwnProfileAction } from './actions';

const profiloPersonaleSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obbligatorio'),
  cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
  email: z.string().email('Email non valida'),
  // Codice fiscale: opzionale, ma se compilato dev'essere valido.
  codiceFiscale: z.union([z.literal(''), codiceFiscaleSchema]),
});

export function ProfiloPersonaleForm({
  defaultEmail,
  defaultNome,
  defaultCognome,
  defaultCodiceFiscale,
}: {
  defaultEmail: string;
  defaultNome: string;
  defaultCognome: string;
  defaultCodiceFiscale: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [nome, setNome] = useState(defaultNome);
  const [cognome, setCognome] = useState(defaultCognome);
  const [codiceFiscale, setCodiceFiscale] = useState(defaultCodiceFiscale);

  const errors = zodFieldErrors(profiloPersonaleSchema, { nome, cognome, email, codiceFiscale });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fNome = field('nome');
  const fCognome = field('cognome');
  const fEmail = field('email');
  const fCf = field('codiceFiscale');

  const onValid = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await updateOwnProfileAction(email, nome, cognome, codiceFiscale);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome" required error={fNome.error}>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={fNome.onBlur}
            invalid={fNome.invalid}
          />
        </Field>
        <Field label="Cognome" required error={fCognome.error}>
          <Input
            value={cognome}
            onChange={(e) => setCognome(e.target.value)}
            onBlur={fCognome.onBlur}
            invalid={fCognome.invalid}
          />
        </Field>
        <Field label="Email" required error={fEmail.error} className="sm:col-span-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={fEmail.onBlur}
            invalid={fEmail.invalid}
          />
        </Field>
        <Field label="Codice fiscale (opzionale)" error={fCf.error} className="sm:col-span-2">
          <Input
            value={codiceFiscale}
            onChange={(e) => setCodiceFiscale(e.target.value.toUpperCase())}
            onBlur={fCf.onBlur}
            invalid={fCf.invalid}
            className="font-mono"
          />
        </Field>
      </div>

      {error && <p className="text-[12px] text-pv-red-500">{error}</p>}
      {savedAt && !error && <p className="text-[12px] text-pv-green-500">Modifiche salvate.</p>}

      <div className="flex justify-end">
        <Button type="submit" size="md" loading={pending} loadingLabel="Salvataggio…">
          Salva modifiche
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Salvataggio…" />
    </form>
  );
}
