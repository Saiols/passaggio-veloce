'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { AddressAutocomplete, type AddressParts } from '@/components/address-autocomplete';
import { formatCurrencyCent } from '@/lib/format';
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
 * che apre il form editabile (solo proprietario). */
export function SedeEdit({ sedeId, data }: { sedeId: string; data: SedeEditData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    ...data,
    payoutEuro: (data.payoutThresholdCent / 100).toString(),
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
    }));

  const ibanOk = f.iban.trim() === '' || /^IT\d{2}[A-Z0-9]{1,30}$/i.test(f.iban.trim());
  const payoutOk = f.payoutEuro.trim() === '' || Number(f.payoutEuro.replace(',', '.')) >= 0;
  const valid =
    f.nome.trim().length >= 2 &&
    f.indirizzo.trim().length >= 2 &&
    f.citta.trim().length >= 2 &&
    f.cap.trim().length >= 4 &&
    f.provincia.trim().length === 2 &&
    ibanOk &&
    payoutOk;

  const cancel = () => {
    setF({ ...data, payoutEuro: (data.payoutThresholdCent / 100).toString() });
    setError(null);
    setEditing(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError('Controlla i campi: nome, indirizzo, città, CAP, provincia (2 lettere), IBAN e soglia.');
      return;
    }
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
      fd.set('iban', f.iban);
      fd.set('payoutThresholdEuro', f.payoutEuro);
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
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
            >
              Modifica
            </button>
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
        </Card>
      </>
    );
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-4 text-[15px] font-bold text-pv-navy-800">Modifica sede</h2>
      <form onSubmit={submit} className="space-y-4">
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
          <Field label="Codice interno">
            <Input value={f.codiceInterno} onChange={(e) => set('codiceInterno', e.target.value)} />
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
          <Field
            label="Soglia payout automatico (€)"
            error={!payoutOk ? 'Importo non valido' : undefined}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={f.payoutEuro}
              invalid={!payoutOk}
              onChange={(e) => set('payoutEuro', e.target.value)}
            />
          </Field>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            Annulla
          </Button>
          <Button type="submit" disabled={!valid} loading={pending} loadingLabel="Salvataggio…">
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
