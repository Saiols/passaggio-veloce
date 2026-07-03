'use client';

import { useState, useTransition, type ChangeEvent } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { formatCurrencyCent } from '@/lib/format';
import { salvaTariffarioAction } from './actions';
import type { TariffaFormInput } from './validate';

type StoricoRow = {
  id: string;
  createdAt: string;
  attivo: boolean;
  autore: string | null;
  note: string | null;
  cents: {
    sempliceFeeAgenziaCent: number; sempliceCreditoBrokerCent: number; sempliceAffiliazioneCent: number;
    minivolturaFeeAgenziaCent: number; minivolturaCreditoBrokerCent: number; minivolturaAffiliazioneCent: number;
  };
};

const EMPTY = (v: number) => (Number.isFinite(v) ? String(v) : '');

export function TariffeClient(props: { iniziale: TariffaFormInput; storico: StoricoRow[] }) {
  const [f, setF] = useState<TariffaFormInput>(props.iniziale);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const num = (v: string) => (v === '' ? NaN : Number(v));
  const set = (k: keyof TariffaFormInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: num(e.target.value) }));

  const lordo = (fee: number, comm: number) =>
    Number.isFinite(fee) && Number.isFinite(comm) ? formatCurrencyCent(Math.round((fee - comm) * 100)) : '—';

  const submit = () => {
    setMsg(null);
    start(async () => {
      const r = await salvaTariffarioAction({ ...f, note });
      setMsg(r.ok ? { kind: 'ok', text: 'Listino aggiornato.' } : { kind: 'err', text: r.error });
    });
  };

  const Row = (label: string, feeK: keyof TariffaFormInput, commK: keyof TariffaFormInput, affK: keyof TariffaFormInput) => (
    <div className="grid grid-cols-4 items-end gap-3">
      <div className="text-[13px] font-semibold text-pv-navy-800">{label}</div>
      <label className="text-[12px] text-pv-slate-500">Costo agenzia €
        <input type="number" step="0.01" min="0" value={EMPTY(f[feeK])} onChange={set(feeK)}
          className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]" />
      </label>
      <label className="text-[12px] text-pv-slate-500">Commissione broker €
        <input type="number" step="0.01" min="0" value={EMPTY(f[commK])} onChange={set(commK)}
          className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]" />
      </label>
      <label className="text-[12px] text-pv-slate-500">Costo affiliazione €
        <input type="number" step="0.01" min="0" value={EMPTY(f[affK])} onChange={set(affK)}
          className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]" />
      </label>
      <div className="col-span-4 text-[12px] text-pv-slate-500">
        Ricavo lordo PV derivato: <strong className="text-pv-navy-800">{lordo(f[feeK], f[commK])}</strong> / veicolo
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {msg && <Alert variant={msg.kind === 'ok' ? 'success' : 'error'} title={msg.kind === 'ok' ? 'Fatto' : 'Errore'}>{msg.text}</Alert>}
      <Card>
        <div className="space-y-5">
          {Row('Passaggio SEMPLICE', 'sempliceFeeEuro', 'sempliceCommissioneEuro', 'sempliceAffiliazioneEuro')}
          <hr className="border-pv-slate-100" />
          {Row('Minivoltura', 'minivolturaFeeEuro', 'minivolturaCommissioneEuro', 'minivolturaAffiliazioneEuro')}
          <label className="block text-[12px] text-pv-slate-500">Nota (opzionale)
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]" />
          </label>
          <Button onClick={submit} disabled={pending} loading={pending}>Salva nuovo listino</Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-[15px] font-bold text-pv-navy-800">Storico versioni</h2>
        <table className="mt-3 w-full text-[12.5px]">
          <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            <tr><th className="py-2">Data</th><th>SEMPLICE (costo/comm)</th><th>MINIVOLTURA (costo/comm)</th><th>Autore</th></tr>
          </thead>
          <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
            {props.storico.map((s) => (
              <tr key={s.id} className={s.attivo ? 'font-semibold text-pv-navy-800' : ''}>
                <td className="py-2">{new Date(s.createdAt).toLocaleString('it-IT')}{s.attivo ? ' · attivo' : ''}</td>
                <td>{formatCurrencyCent(s.cents.sempliceFeeAgenziaCent)} / {formatCurrencyCent(s.cents.sempliceCreditoBrokerCent)}</td>
                <td>{formatCurrencyCent(s.cents.minivolturaFeeAgenziaCent)} / {formatCurrencyCent(s.cents.minivolturaCreditoBrokerCent)}</td>
                <td>{s.autore ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
