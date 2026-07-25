'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { capSchema, ibanItSchema } from '@pv/lib';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { AddressAutocomplete, type AddressParts } from '@/components/address-autocomplete';
import { formatCurrencyCent } from '@/lib/format';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { updateSedeAction } from '../actions';

export type SedeEditData = {
  nome: string;
  indirizzo: string;
  civico: string;
  citta: string;
  cap: string;
  provincia: string;
  telefono: string;
  email: string;
  codiceInterno: string;
  iban: string;
  payoutThresholdCent: number;
};

/** Anagrafica + Pagamenti della sede: vista in sola lettura con toggle "Modifica"
 * che apre il form editabile (proprietario o admin della sede).
 *
 * `canEditPagamenti` (solo il proprietario della madre) governa IBAN e soglia
 * payout: senza, i due campi non compaiono nel form e non vengono inviati.
 * Il gate vero resta lato server in `updateSedeAction`. */
export function SedeEdit({
  sedeId,
  data,
  canEditPagamenti,
  soloLettura = false,
}: {
  sedeId: string;
  data: SedeEditData;
  canEditPagamenti: boolean;
  /** Account sospeso: la vista resta leggibile, il tasto "Modifica" non compare. */
  soloLettura?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    ...data,
    payoutEuro: (data.payoutThresholdCent / 100).toString(),
    lat: '',
    lng: '',
  });

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
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

  const schema = useMemo(() => {
    const base = {
      nome: z.string().trim().min(2, 'Nome sede obbligatorio'),
      indirizzo: z.string().trim().min(2, 'Indirizzo obbligatorio'),
      citta: z.string().trim().min(2, 'Città obbligatoria'),
      cap: capSchema,
      provincia: z.string().trim().length(2, 'Provincia (2 lettere)'),
    };
    if (!canEditPagamenti) return z.object(base);
    return z.object({
      ...base,
      iban: z.union([z.literal(''), ibanItSchema]),
      payoutEuro: z
        .string()
        .refine((v) => v.trim() === '' || Number(v.replace(',', '.')) >= 0, 'Importo non valido'),
    });
  }, [canEditPagamenti]);

  const errors = zodFieldErrors(schema, f);
  const { field, gatedSubmit } = useFieldErrorsState(errors);

  const cancel = () => {
    setF({ ...data, payoutEuro: (data.payoutThresholdCent / 100).toString(), lat: '', lng: '' });
    setError(null);
    setEditing(false);
  };

  const onValid = (): void => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set('nome', f.nome);
      fd.set('indirizzo', f.indirizzo);
      fd.set('civico', f.civico);
      fd.set('citta', f.citta);
      fd.set('cap', f.cap);
      fd.set('provincia', f.provincia);
      fd.set('telefono', f.telefono);
      fd.set('email', f.email);
      fd.set('codiceInterno', f.codiceInterno);
      // IBAN e soglia payout vanno sempre inviati, anche quando i campi non
      // sono editabili in questa vista: `f.iban`/`f.payoutEuro` restano il
      // valore caricato (non renderizzando l'input non vengono mai toccati),
      // quindi il round-trip è un no-op lato server.
      fd.set('iban', f.iban);
      fd.set('payoutThresholdEuro', f.payoutEuro);
      fd.set('lat', f.lat);
      fd.set('lng', f.lng);
      const res = await updateSedeAction(sedeId, fd);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  if (!editing) {
    return (
      <>
        <Card className="mb-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Anagrafica</h2>
            {!soloLettura && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Modifica
              </button>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="Nome sede" value={data.nome} />
            <Row label="Indirizzo" value={[data.indirizzo, data.civico].filter(Boolean).join(', ')} />
            <Row label="Città" value={`${data.citta} (${data.provincia})`} />
            <Row label="CAP" value={data.cap} />
            <Row label="Telefono" value={data.telefono || '—'} />
            <Row label="Email operativa" value={data.email || '—'} />
            <Row label="Codice interno" value={data.codiceInterno || '—'} />
          </dl>
        </Card>

        <Card className="mb-5">
          <h2 className="mb-4 text-[15px] font-bold text-pv-navy-800">Pagamenti</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="IBAN" value={data.iban || 'Usa l’IBAN aziendale (madre)'} />
            <Row
              label="Soglia payout automatico"
              value={formatCurrencyCent(data.payoutThresholdCent)}
            />
          </dl>
          {!canEditPagamenti && (
            <p className="mt-4 text-[12.5px] text-pv-slate-500">
              Solo il titolare dell’account può modificare queste impostazioni.
            </p>
          )}
        </Card>
      </>
    );
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-4 text-[15px] font-bold text-pv-navy-800">Modifica sede</h2>
      <form onSubmit={gatedSubmit(onValid)} noValidate className="space-y-4">
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
          <Field label="Codice interno">
            <Input value={f.codiceInterno} onChange={(e) => set('codiceInterno', e.target.value)} />
          </Field>
          {canEditPagamenti && (
            <>
              <Field label="IBAN dedicato (opzionale)" error={field('iban').error}>
                <Input
                  value={f.iban}
                  invalid={field('iban').invalid}
                  onBlur={field('iban').onBlur}
                  placeholder="IT60X0542811101000000123456"
                  onChange={(e) => set('iban', e.target.value)}
                />
              </Field>
              <Field label="Soglia payout automatico (€)" error={field('payoutEuro').error}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={f.payoutEuro}
                  invalid={field('payoutEuro').invalid}
                  onBlur={field('payoutEuro').onBlur}
                  onChange={(e) => set('payoutEuro', e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Annulla
          </Button>
          <Button type="submit" loading={pending} loadingLabel="Salvataggio…">
            Salva modifiche
          </Button>
        </div>
      </form>
      <LoadingOverlay show={pending} label="Salvataggio…" />
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[14px] text-pv-navy-900">{value}</dd>
    </div>
  );
}
