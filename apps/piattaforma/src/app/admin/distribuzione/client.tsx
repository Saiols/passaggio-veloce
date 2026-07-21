'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, NumberInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import type { DistribuzioneConfigDTO } from '@/lib/distribuzione/config';
import { salvaConfigDistribuzione } from './actions';
import { configDistribuzioneSchema, RAGGIO_MAX_MIN, RAGGIO_MAX_MAX } from './validate';

const GIORNI_LABEL: Record<string, string> = {
  LUN: 'Lun',
  MAR: 'Mar',
  MER: 'Mer',
  GIO: 'Gio',
  VEN: 'Ven',
  SAB: 'Sab',
  DOM: 'Dom',
};

export function DistribuzioneConfigClient({ config }: { config: DistribuzioneConfigDTO }) {
  const [raggioMaxM, setRaggioMaxM] = useState<number | null>(config.raggioMaxM);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  // NaN quando il campo è vuoto/incompleto: fa fallire la validazione zod
  // (invalid_type) invece di passare un valore fasullo — mai rosso finché
  // l'utente non ha toccato il campo o provato a inviare (useFieldErrorsState).
  const errors = zodFieldErrors(configDistribuzioneSchema, {
    raggioMaxM: raggioMaxM ?? NaN,
    raggioStartM: config.raggioStartM,
  });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fRaggioMax = field('raggioMaxM');

  const onValid = (): void => {
    setMsg(null);
    start(async () => {
      const res = await salvaConfigDistribuzione(raggioMaxM ?? 0);
      setMsg(
        res.ok
          ? { kind: 'ok', text: 'Configurazione aggiornata.' }
          : { kind: 'err', text: res.error },
      );
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="space-y-6">
      {msg && (
        <Alert variant={msg.kind === 'ok' ? 'success' : 'error'} title={msg.kind === 'ok' ? 'Fatto' : 'Errore'}>
          {msg.text}
        </Alert>
      )}

      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <Field
          label="Raggio massimo di ricerca (metri)"
          required
          error={fRaggioMax.error}
          hint={`Tra ${RAGGIO_MAX_MIN} e ${RAGGIO_MAX_MAX} m. Deve essere maggiore del raggio iniziale (${config.raggioStartM} m).`}
        >
          <NumberInput
            value={raggioMaxM}
            onChange={setRaggioMaxM}
            onBlur={fRaggioMax.onBlur}
            invalid={fRaggioMax.invalid}
            integer
            min={RAGGIO_MAX_MIN}
            max={RAGGIO_MAX_MAX}
            step={100}
          />
        </Field>

        <div className="mt-5 flex justify-end">
          <Button type="submit" loading={pending} loadingLabel="Salvataggio…">
            Salva
          </Button>
        </div>
      </div>

      <div className="rounded-[16px] border border-pv-slate-200 bg-pv-slate-50 p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Altri parametri (fissi, sola lettura)
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-pv-slate-500">Raggio iniziale</dt>
            <dd className="font-semibold text-pv-navy-800">{config.raggioStartM} m</dd>
          </div>
          <div>
            <dt className="text-pv-slate-500">Step espansione</dt>
            <dd className="font-semibold text-pv-navy-800">{config.stepM} m</dd>
          </div>
          <div>
            <dt className="text-pv-slate-500">Intervallo espansione</dt>
            <dd className="font-semibold text-pv-navy-800">{config.intervalloMin} min</dd>
          </div>
          <div>
            <dt className="text-pv-slate-500">Orario</dt>
            <dd className="font-semibold text-pv-navy-800">
              {config.orarioInizio}–{config.orarioFine}
            </dd>
          </div>
          <div>
            <dt className="text-pv-slate-500">Giorni</dt>
            <dd className="font-semibold text-pv-navy-800">
              {config.giorni.map((g) => GIORNI_LABEL[g] ?? g).join(', ') || '—'}
            </dd>
          </div>
        </dl>
      </div>

      <LoadingOverlay show={pending} label="Salvataggio…" />
    </form>
  );
}
