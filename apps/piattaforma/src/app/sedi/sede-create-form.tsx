'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { AddressAutocomplete, type AddressParts } from '@/components/address-autocomplete';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { registerSedeSchema } from '@/lib/auth/schemas';
import { createSedeAction } from './actions';

const EMPTY = {
  nome: '',
  indirizzo: '',
  civico: '',
  citta: '',
  cap: '',
  provincia: '',
  telefono: '',
  email: '',
  iban: '',
  lat: '',
  lng: '',
};

export function SedeCreateForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ ...EMPTY });

  const set = (k: keyof typeof EMPTY, v: string) => setF((s) => ({ ...s, [k]: v }));
  const applyAddress = (p: AddressParts) =>
    setF((s) => ({
      ...s,
      indirizzo: p.indirizzo,
      civico: p.civico,
      citta: p.citta,
      cap: p.cap,
      provincia: p.provincia,
      lat: p.lat != null ? String(p.lat) : '',
      lng: p.lng != null ? String(p.lng) : '',
    }));

  const errors = zodFieldErrors(registerSedeSchema, f);
  const { field, gatedSubmit } = useFieldErrorsState(errors);

  const onValid = (): void => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(f)) fd.set(k, v);
      const res = await createSedeAction(fd);
      if (res.ok) {
        setF({ ...EMPTY });
        router.refresh();
        onSuccess?.();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="space-y-3">
      <AddressAutocomplete onSelect={applyAddress} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome sede" required error={field('nome').error}>
          <Input
            value={f.nome}
            invalid={field('nome').invalid}
            onBlur={field('nome').onBlur}
            onChange={(e) => set('nome', e.target.value)}
          />
        </Field>
        <Field label="Indirizzo" required error={field('indirizzo').error}>
          <Input
            value={f.indirizzo}
            invalid={field('indirizzo').invalid}
            onBlur={field('indirizzo').onBlur}
            onChange={(e) => set('indirizzo', e.target.value)}
          />
        </Field>
        <Field label="Civico">
          <Input value={f.civico} onChange={(e) => set('civico', e.target.value)} />
        </Field>
        <Field label="Città" required error={field('citta').error}>
          <Input
            value={f.citta}
            invalid={field('citta').invalid}
            onBlur={field('citta').onBlur}
            onChange={(e) => set('citta', e.target.value)}
          />
        </Field>
        <Field label="CAP" required error={field('cap').error}>
          <Input
            value={f.cap}
            invalid={field('cap').invalid}
            onBlur={field('cap').onBlur}
            onChange={(e) => set('cap', e.target.value)}
          />
        </Field>
        <Field label="Provincia (sigla)" required error={field('provincia').error}>
          <Input
            maxLength={2}
            value={f.provincia}
            invalid={field('provincia').invalid}
            onBlur={field('provincia').onBlur}
            onChange={(e) => set('provincia', e.target.value)}
          />
        </Field>
        <Field label="Telefono">
          <Input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} />
        </Field>
        <Field label="Email operativa">
          <Input value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="IBAN dedicato (opzionale)" error={field('iban').error}>
          <Input
            value={f.iban}
            invalid={field('iban').invalid}
            onBlur={field('iban').onBlur}
            placeholder="IT60X0542811101000000123456"
            onChange={(e) => set('iban', e.target.value)}
          />
        </Field>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex justify-end">
        <Button type="submit" size="md" loading={pending}>
          Aggiungi sede
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
