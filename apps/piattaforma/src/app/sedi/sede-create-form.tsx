'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { AddressAutocomplete, type AddressParts } from '@/components/address-autocomplete';
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
    }));

  const ibanOk = f.iban.trim() === '' || /^IT\d{2}[A-Z0-9]{1,30}$/i.test(f.iban.trim());
  const valid =
    f.nome.trim().length >= 2 &&
    f.indirizzo.trim().length >= 2 &&
    f.citta.trim().length >= 2 &&
    f.cap.trim().length >= 4 &&
    f.provincia.trim().length === 2 &&
    ibanOk;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError('Compila nome, indirizzo, città, CAP, provincia. L’IBAN (se inserito) dev’essere valido.');
      return;
    }
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
    <form onSubmit={submit} className="space-y-3">
      <AddressAutocomplete onSelect={applyAddress} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome sede" required>
          <Input value={f.nome} onChange={(e) => set('nome', e.target.value)} />
        </Field>
        <Field label="Indirizzo" required>
          <Input value={f.indirizzo} onChange={(e) => set('indirizzo', e.target.value)} />
        </Field>
        <Field label="Civico">
          <Input value={f.civico} onChange={(e) => set('civico', e.target.value)} />
        </Field>
        <Field label="Città" required>
          <Input value={f.citta} onChange={(e) => set('citta', e.target.value)} />
        </Field>
        <Field label="CAP" required>
          <Input value={f.cap} onChange={(e) => set('cap', e.target.value)} />
        </Field>
        <Field label="Provincia (sigla)" required>
          <Input maxLength={2} value={f.provincia} onChange={(e) => set('provincia', e.target.value)} />
        </Field>
        <Field label="Telefono">
          <Input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} />
        </Field>
        <Field label="Email operativa">
          <Input value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field
          label="IBAN dedicato (opzionale)"
          error={!ibanOk ? 'IBAN italiano non valido' : undefined}
        >
          <Input
            value={f.iban}
            invalid={!ibanOk}
            placeholder="IT60X0542811101000000123456"
            onChange={(e) => set('iban', e.target.value)}
          />
        </Field>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex justify-end">
        <Button type="submit" size="md" disabled={!valid} loading={pending}>
          Aggiungi sede
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
