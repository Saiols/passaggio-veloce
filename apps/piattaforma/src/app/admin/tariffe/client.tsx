'use client';

import { useState, useTransition, type ChangeEvent } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { formatCurrencyCent } from '@/lib/format';
import { annullaVariazioneProgrammataAction, salvaTariffarioAction } from './actions';
import type { TariffaFormInput } from './validate';

type Cents = {
  sempliceFeeAgenziaCent: number;
  sempliceCreditoBrokerCent: number;
  sempliceAffiliazioneCent: number;
  minivolturaFeeAgenziaCent: number;
  minivolturaCreditoBrokerCent: number;
  minivolturaAffiliazioneCent: number;
};

type StoricoRow = {
  id: string;
  createdAt: string;
  efficaceDal: string;
  inVigore: boolean;
  programmata: boolean;
  annullataAt: string | null;
  richiedeRiaccettazione: boolean;
  autore: string | null;
  note: string | null;
  cents: Cents;
};

export type Programmata = {
  id: string;
  efficaceDal: string;
  richiedeRiaccettazione: boolean;
  riaccettazioni: number;
  aziendeDaRiaccettare: number;
};

const EMPTY = (v: number) => (Number.isFinite(v) ? String(v) : '');

const dataOra = (iso: string) => new Date(iso).toLocaleString('it-IT');

export function TariffeClient(props: {
  iniziale: TariffaFormInput;
  storico: StoricoRow[];
  programmata: Programmata | null;
}) {
  const [f, setF] = useState<TariffaFormInput>(props.iniziale);
  const [note, setNote] = useState('');
  const [strutturale, setStrutturale] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const num = (v: string) => (v === '' ? NaN : Number(v));
  const set = (k: keyof TariffaFormInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: num(e.target.value) }));

  const lordo = (fee: number, comm: number) =>
    Number.isFinite(fee) && Number.isFinite(comm)
      ? formatCurrencyCent(Math.round((fee - comm) * 100))
      : '—';

  const submit = () => {
    setMsg(null);
    start(async () => {
      const r = await salvaTariffarioAction({ ...f, note, strutturale });
      if (!r.ok) {
        setMsg({ kind: 'err', text: r.error });
        return;
      }
      setMsg({
        kind: 'ok',
        text:
          r.fascia === 'NESSUNA'
            ? 'Nessun importo è cambiato: salvata senza preavviso e senza email.'
            : `Variazione programmata: ${r.giorniPreavviso} giorni di preavviso, in vigore dal ` +
              `${dataOra(r.efficaceDal)}. Avvisate ${r.destinatariAvvisati} aziende via email.` +
              (r.fascia === 'RILEVANTE'
                ? ' Oltre il 20%: prima dell’entrata in vigore serve la riaccettazione degli Utenti.'
                : ''),
      });
    });
  };

  const annulla = (id: string) => {
    setMsg(null);
    start(async () => {
      const r = await annullaVariazioneProgrammataAction(id);
      setMsg(
        r.ok
          ? { kind: 'ok', text: 'Variazione programmata annullata. Resta in vigore la tariffa attuale.' }
          : { kind: 'err', text: r.error },
      );
    });
  };

  const Row = (
    label: string,
    feeK: keyof TariffaFormInput,
    commK: keyof TariffaFormInput,
    affK: keyof TariffaFormInput,
  ) => (
    <div className="grid grid-cols-4 items-end gap-3">
      <div className="text-[13px] font-semibold text-pv-navy-800">{label}</div>
      <label className="text-[12px] text-pv-slate-500">
        Costo agenzia €
        <input
          type="number"
          step="0.01"
          min="0"
          value={EMPTY(f[feeK])}
          onChange={set(feeK)}
          className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]"
        />
      </label>
      <label className="text-[12px] text-pv-slate-500">
        Commissione broker €
        <input
          type="number"
          step="0.01"
          min="0"
          value={EMPTY(f[commK])}
          onChange={set(commK)}
          className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]"
        />
      </label>
      <label className="text-[12px] text-pv-slate-500">
        Costo affiliazione €
        <input
          type="number"
          step="0.01"
          min="0"
          value={EMPTY(f[affK])}
          onChange={set(affK)}
          className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]"
        />
      </label>
      <div className="col-span-4 text-[12px] text-pv-slate-500">
        Ricavo lordo PV derivato:{' '}
        <strong className="text-pv-navy-800">{lordo(f[feeK], f[commK])}</strong> / veicolo
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {msg && (
        <Alert
          variant={msg.kind === 'ok' ? 'success' : 'error'}
          title={msg.kind === 'ok' ? 'Fatto' : 'Errore'}
        >
          {msg.text}
        </Alert>
      )}

      {props.programmata && (
        <Alert variant="warning" title="Variazione già programmata">
          <p>
            Una variazione entra in vigore il{' '}
            <strong>{dataOra(props.programmata.efficaceDal)}</strong>. Fino a quel momento resta
            applicata la tariffa attuale.
            {props.programmata.richiedeRiaccettazione && (
              <>
                {' '}
                È una variazione oltre il 20%:{' '}
                <strong>
                  {props.programmata.riaccettazioni} di{' '}
                  {props.programmata.aziendeDaRiaccettare} aziende
                </strong>{' '}
                l’hanno già riaccettata.
              </>
            )}
          </p>
          <p className="mt-2">
            Salvare un nuovo listino sostituisce questa variazione. In alternativa puoi annullarla e
            restare alle condizioni attuali.
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => annulla(props.programmata!.id)}
              disabled={pending}
              loading={pending}
            >
              Annulla la variazione programmata
            </Button>
          </div>
        </Alert>
      )}

      <Card>
        <div className="space-y-5">
          {Row(
            'Passaggio SEMPLICE',
            'sempliceFeeEuro',
            'sempliceCommissioneEuro',
            'sempliceAffiliazioneEuro',
          )}
          <hr className="border-pv-slate-100" />
          {Row(
            'Minivoltura',
            'minivolturaFeeEuro',
            'minivolturaCommissioneEuro',
            'minivolturaAffiliazioneEuro',
          )}
          <label className="block text-[12px] text-pv-slate-500">
            Nota (opzionale)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-md border border-pv-slate-200 px-2 py-1 text-[14px]"
            />
          </label>
          <label className="flex items-start gap-2 text-[12.5px] text-pv-slate-700">
            <input
              type="checkbox"
              checked={strutturale}
              onChange={(e) => setStrutturale(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-pv-navy-700"
            />
            <span>
              Modifica <strong>strutturale</strong> alle tipologie di corrispettivo (clausola 3):
              forza 30 giorni di preavviso e riaccettazione, anche sotto il 20%.
            </span>
          </label>
          <div className="rounded-[10px] bg-pv-slate-50 px-3 py-2 text-[12px] text-pv-slate-600">
            Il salvataggio <strong>non cambia i prezzi subito</strong>: programma la variazione,
            avvisa via email tutte le aziende e la applica dopo il preavviso — 7 giorni fino al 20%,
            30 giorni oltre. Le pratiche già inviate restano alle condizioni di quando sono partite.
          </div>
          <Button onClick={submit} disabled={pending} loading={pending}>
            Programma la variazione
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-[15px] font-bold text-pv-navy-800">Storico versioni</h2>
        <table className="mt-3 w-full text-[12.5px]">
          <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            <tr>
              <th className="py-2">In vigore dal</th>
              <th>SEMPLICE (costo/comm)</th>
              <th>MINIVOLTURA (costo/comm)</th>
              <th>Autore</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
            {props.storico.map((s) => (
              <tr key={s.id} className={s.inVigore ? 'font-semibold text-pv-navy-800' : ''}>
                <td className="py-2">
                  {dataOra(s.efficaceDal)}
                  {s.inVigore ? ' · in vigore' : ''}
                  {s.programmata ? ' · programmata' : ''}
                  {s.annullataAt ? ' · annullata' : ''}
                </td>
                <td>
                  {formatCurrencyCent(s.cents.sempliceFeeAgenziaCent)} /{' '}
                  {formatCurrencyCent(s.cents.sempliceCreditoBrokerCent)}
                </td>
                <td>
                  {formatCurrencyCent(s.cents.minivolturaFeeAgenziaCent)} /{' '}
                  {formatCurrencyCent(s.cents.minivolturaCreditoBrokerCent)}
                </td>
                <td>{s.autore ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
