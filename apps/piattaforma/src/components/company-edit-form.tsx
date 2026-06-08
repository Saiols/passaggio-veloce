'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, NumberInput } from '@/components/ui';

export type CompanyEditDefaults = {
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
  /** Soglia auto-payout in cent. Editabile solo dall'admin platform. */
  payoutThresholdCent?: number;
};

type UpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Form modifica dati aziendali condiviso. Usato sia da:
 *  - /profilo/azienda (admin azienda modifica la propria)
 *  - /admin/companies/[id] (admin piattaforma/assistente modifica una qualsiasi)
 *
 * L'action e il path di "Annulla" sono parametrizzati.
 */
export function CompanyEditForm({
  defaults,
  action,
  cancelHref,
  successMessage = 'Profilo aziendale aggiornato.',
  showPayoutThreshold = false,
}: {
  defaults: CompanyEditDefaults;
  action: (formData: FormData) => Promise<UpdateResult>;
  cancelHref: string;
  successMessage?: string;
  /** Mostra il campo soglia payout (visibile solo all'admin platform). */
  showPayoutThreshold?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await action(formData);
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
        {showPayoutThreshold && (
          <Field
            label="Soglia payout automatico (€)"
            hint="Range 1.000 - 5.000 €"
            className="sm:col-span-2"
          >
            <NumberInput
              name="payoutThresholdEur"
              defaultValue={(defaults.payoutThresholdCent ?? 100000) / 100}
              min={1000}
              max={5000}
              step={100}
              integer
            />
          </Field>
        )}
      </div>

      {error && (
        <p className="rounded-[10px] border border-pv-red-500/40 bg-pv-red-50 px-3 py-2 text-[13px] text-pv-red-500">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-[10px] border border-pv-green-500/40 bg-pv-green-50 px-3 py-2 text-[13px] text-pv-green-500">
          {successMessage}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={pending} loadingLabel="Salvataggio…">
          Salva modifiche
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(cancelHref)}
        >
          Annulla
        </Button>
      </div>
    </form>
  );
}
