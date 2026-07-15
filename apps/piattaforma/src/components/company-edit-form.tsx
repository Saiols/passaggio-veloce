'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { capSchema, ibanItSchema, pecSchema } from '@pv/lib';
import { Button, Field, Input, NumberInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';

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
  showIban = true,
}: {
  defaults: CompanyEditDefaults;
  action: (formData: FormData) => Promise<UpdateResult>;
  cancelHref: string;
  successMessage?: string;
  /** Mostra il campo soglia payout (visibile solo all'admin platform). */
  showPayoutThreshold?: boolean;
  /**
   * Mostra il campo IBAN. Default `true` perché /profilo/azienda è già
   * owner-only a monte (pagina + action). In /admin/companies va passato
   * `role === 'ADMIN_PIATTAFORMA'`: l'ASSISTENTE non tocca l'IBAN.
   * Il gate autoritativo resta comunque nella server action.
   */
  showIban?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const [f, setF] = useState({
    ragioneSociale: defaults.ragioneSociale,
    codiceSdi: defaults.codiceSdi ?? '',
    telefono: defaults.telefono ?? '',
    pec: defaults.pec,
    email: defaults.email,
    indirizzo: defaults.indirizzo,
    citta: defaults.citta,
    cap: defaults.cap,
    provincia: defaults.provincia,
    iban: defaults.iban ?? '',
  });
  const [payoutEur, setPayoutEur] = useState<number | null>(
    (defaults.payoutThresholdCent ?? 100000) / 100,
  );

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const schema = useMemo(
    () =>
      z.object({
        ragioneSociale: z.string().trim().min(2, 'Ragione sociale obbligatoria'),
        codiceSdi: z.union([
          z.literal(''),
          z.string().trim().regex(/^[A-Za-z0-9]{7}$/, 'Codice SDI: 7 caratteri alfanumerici'),
        ]),
        telefono: z.string().optional(),
        pec: pecSchema,
        email: z.string().email('Email aziendale non valida'),
        indirizzo: z.string().trim().min(2, 'Indirizzo obbligatorio'),
        citta: z.string().trim().min(2, 'Città obbligatoria'),
        cap: capSchema,
        provincia: z.string().trim().length(2, 'Provincia (2 lettere)'),
        iban: showIban ? z.union([z.literal(''), ibanItSchema]) : z.string().optional(),
      }),
    [showIban],
  );
  const errors = zodFieldErrors(schema, f);
  const { field, gatedSubmit } = useFieldErrorsState(errors);

  const onValid = (): void => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('ragioneSociale', f.ragioneSociale);
      fd.set('codiceSdi', f.codiceSdi);
      fd.set('telefono', f.telefono);
      fd.set('pec', f.pec);
      fd.set('email', f.email);
      fd.set('indirizzo', f.indirizzo);
      fd.set('citta', f.citta);
      fd.set('cap', f.cap);
      fd.set('provincia', f.provincia);
      if (showIban) fd.set('iban', f.iban);
      if (showPayoutThreshold) fd.set('payoutThresholdEur', String(payoutEur ?? ''));
      const res = await action(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Ragione sociale" required error={field('ragioneSociale').error} className="sm:col-span-2">
          <Input
            name="ragioneSociale"
            value={f.ragioneSociale}
            onChange={(e) => set('ragioneSociale', e.target.value)}
            onBlur={field('ragioneSociale').onBlur}
            invalid={field('ragioneSociale').invalid}
          />
        </Field>
        <Field label="Codice SDI" error={field('codiceSdi').error}>
          <Input
            name="codiceSdi"
            value={f.codiceSdi}
            onChange={(e) => set('codiceSdi', e.target.value)}
            onBlur={field('codiceSdi').onBlur}
            invalid={field('codiceSdi').invalid}
            maxLength={7}
          />
        </Field>
        <Field label="Telefono">
          <Input
            name="telefono"
            type="tel"
            value={f.telefono}
            onChange={(e) => set('telefono', e.target.value)}
            placeholder="+39 ..."
          />
        </Field>
        <Field label="PEC" required error={field('pec').error}>
          <Input
            name="pec"
            type="email"
            value={f.pec}
            onChange={(e) => set('pec', e.target.value)}
            onBlur={field('pec').onBlur}
            invalid={field('pec').invalid}
          />
        </Field>
        <Field label="Email aziendale" required error={field('email').error}>
          <Input
            name="email"
            type="email"
            value={f.email}
            onChange={(e) => set('email', e.target.value)}
            onBlur={field('email').onBlur}
            invalid={field('email').invalid}
          />
        </Field>
        <Field label="Indirizzo" required error={field('indirizzo').error} className="sm:col-span-2">
          <Input
            name="indirizzo"
            value={f.indirizzo}
            onChange={(e) => set('indirizzo', e.target.value)}
            onBlur={field('indirizzo').onBlur}
            invalid={field('indirizzo').invalid}
          />
        </Field>
        <Field label="Città" required error={field('citta').error}>
          <Input
            name="citta"
            value={f.citta}
            onChange={(e) => set('citta', e.target.value)}
            onBlur={field('citta').onBlur}
            invalid={field('citta').invalid}
          />
        </Field>
        <Field label="CAP" required error={field('cap').error}>
          <Input
            name="cap"
            value={f.cap}
            onChange={(e) => set('cap', e.target.value)}
            onBlur={field('cap').onBlur}
            invalid={field('cap').invalid}
            maxLength={5}
          />
        </Field>
        <Field label="Provincia" required error={field('provincia').error}>
          <Input
            name="provincia"
            value={f.provincia}
            onChange={(e) => set('provincia', e.target.value)}
            onBlur={field('provincia').onBlur}
            invalid={field('provincia').invalid}
            maxLength={2}
          />
        </Field>
        {showIban && (
          <Field label="IBAN" error={field('iban').error} className="sm:col-span-2">
            <Input
              name="iban"
              value={f.iban}
              onChange={(e) => set('iban', e.target.value)}
              onBlur={field('iban').onBlur}
              invalid={field('iban').invalid}
              placeholder="IT60..."
              maxLength={34}
            />
          </Field>
        )}
        {showPayoutThreshold && (
          <Field
            label="Soglia payout automatico (€)"
            hint="Range 1.000 - 5.000 €"
            className="sm:col-span-2"
          >
            <NumberInput
              name="payoutThresholdEur"
              value={payoutEur}
              onChange={setPayoutEur}
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
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>
          Annulla
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Salvataggio…" />
    </form>
  );
}
