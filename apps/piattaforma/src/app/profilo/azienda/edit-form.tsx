'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@/components/ui';
import { updateCompanyProfileAction } from './actions';

type Defaults = {
  ragioneSociale: string;
  codiceSdi: string | null;
  pec: string;
  email: string;
  telefono: string | null;
  indirizzo: string;
  citta: string;
  cap: string;
  provincia: string;
  iban: string | null;
};

export function CompanyEditForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateCompanyProfileAction(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Ragione sociale" required className="sm:col-span-2">
          <Input name="ragioneSociale" defaultValue={defaults.ragioneSociale} required />
        </Field>
        <Field label="Codice SDI">
          <Input name="codiceSdi" defaultValue={defaults.codiceSdi ?? ''} maxLength={7} />
        </Field>
        <Field label="Telefono">
          <Input
            name="telefono"
            type="tel"
            defaultValue={defaults.telefono ?? ''}
            placeholder="+39 ..."
          />
        </Field>
        <Field label="PEC" required>
          <Input name="pec" type="email" defaultValue={defaults.pec} required />
        </Field>
        <Field label="Email aziendale" required>
          <Input name="email" type="email" defaultValue={defaults.email} required />
        </Field>
        <Field label="Indirizzo" required className="sm:col-span-2">
          <Input name="indirizzo" defaultValue={defaults.indirizzo} required />
        </Field>
        <Field label="Città" required>
          <Input name="citta" defaultValue={defaults.citta} required />
        </Field>
        <Field label="CAP" required>
          <Input name="cap" defaultValue={defaults.cap} maxLength={5} required />
        </Field>
        <Field label="Provincia" required>
          <Input name="provincia" defaultValue={defaults.provincia} maxLength={2} required />
        </Field>
        <Field label="IBAN" className="sm:col-span-2">
          <Input
            name="iban"
            defaultValue={defaults.iban ?? ''}
            placeholder="IT60..."
            maxLength={34}
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-[10px] border border-pv-red-500/40 bg-pv-red-50 px-3 py-2 text-[13px] text-pv-red-500">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-[10px] border border-pv-green-500/40 bg-pv-green-50 px-3 py-2 text-[13px] text-pv-green-500">
          Profilo aziendale aggiornato.
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={pending} loadingLabel="Salvataggio…">
          Salva modifiche
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push('/profilo')}
        >
          Annulla
        </Button>
      </div>
    </form>
  );
}
