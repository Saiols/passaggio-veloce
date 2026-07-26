'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, NumberInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import type { DistribuzioneConfigDTO } from '@/lib/distribuzione/config';
import { OrariSettimanaEditor } from './orari-settimana';
import { salvaConfigDistribuzione } from './actions';
import {
  configDistribuzioneSchema,
  DURATA_ROUND_MIN_MAX,
  DURATA_ROUND_MIN_MIN,
  RAGGIO_MAX_KM_MAX,
  RAGGIO_MAX_KM_MIN,
  RAGGIO_START_KM_MIN,
  STEP_DURATA_MIN_INPUT,
  STEP_KM_INPUT,
  STEP_KM_MAX,
  STEP_KM_MIN,
  STEP_RAGGIO_MAX_KM_INPUT,
} from './validate';

/** Metri → km per il form: la persistenza resta in metri. */
function toKm(metri: number): number {
  return metri / 1000;
}

/** "0,1" invece di "0.1" negli hint: sono testo italiano, non codice. */
function num(v: number): string {
  return v.toLocaleString('it-IT');
}

export function DistribuzioneConfigClient({ config }: { config: DistribuzioneConfigDTO }) {
  const [raggioStartKm, setRaggioStartKm] = useState<number | null>(toKm(config.raggioStartM));
  const [stepKm, setStepKm] = useState<number | null>(toKm(config.stepM));
  const [raggioMaxKm, setRaggioMaxKm] = useState<number | null>(toKm(config.raggioMaxM));
  const [durataRoundMin, setDurataRoundMin] = useState<number | null>(config.intervalloMin);
  const [orariSettimana, setOrariSettimana] = useState(config.orariSettimana);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  // NaN quando il campo è vuoto/incompleto: fa fallire la validazione zod
  // (invalid_type) invece di passare un valore fasullo — mai rosso finché
  // l'utente non ha toccato il campo o provato a inviare (useFieldErrorsState).
  const errors = zodFieldErrors(configDistribuzioneSchema, {
    raggioStartKm: raggioStartKm ?? NaN,
    stepKm: stepKm ?? NaN,
    raggioMaxKm: raggioMaxKm ?? NaN,
    durataRoundMin: durataRoundMin ?? NaN,
    orariSettimana,
  });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fStart = field('raggioStartKm');
  const fStep = field('stepKm');
  const fMax = field('raggioMaxKm');
  const fDurata = field('durataRoundMin');

  // Quanti round servono, al più, per arrivare dal raggio iniziale al massimo:
  // il primo anello vale 1, poi uno per ogni passo. È il tetto teorico — gli
  // anelli vuoti vengono saltati senza consumare round né tempo.
  //
  // Calcolato SOLO su una configurazione valida: con raggio iniziale > massimo
  // la formula darebbe "1 round, circa 0 min", una frase sensata accanto a un
  // campo in errore e quindi peggio che nessuna frase.
  const configValida = Object.keys(errors).length === 0;
  const roundMax =
    configValida && raggioStartKm != null && stepKm != null && raggioMaxKm != null && stepKm > 0
      ? 1 + Math.max(0, Math.ceil((raggioMaxKm - raggioStartKm) / stepKm))
      : null;

  const onValid = (): void => {
    setMsg(null);
    start(async () => {
      const res = await salvaConfigDistribuzione({
        raggioStartKm: raggioStartKm ?? NaN,
        stepKm: stepKm ?? NaN,
        raggioMaxKm: raggioMaxKm ?? NaN,
        durataRoundMin: durataRoundMin ?? NaN,
        orariSettimana,
      });
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
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Raggio iniziale (km)"
            required
            error={fStart.error}
            hint={`Il raggio del primo round. Minimo ${num(RAGGIO_START_KM_MIN)} km.`}
          >
            <NumberInput
              value={raggioStartKm}
              onChange={setRaggioStartKm}
              onBlur={fStart.onBlur}
              invalid={fStart.invalid}
              min={RAGGIO_START_KM_MIN}
              max={RAGGIO_MAX_KM_MAX}
              step={STEP_KM_INPUT}
            />
          </Field>

          <Field
            label="Passo per round (km)"
            required
            error={fStep.error}
            hint={`Quanto si allarga il raggio a ogni round. Tra ${num(STEP_KM_MIN)} e ${num(STEP_KM_MAX)} km.`}
          >
            <NumberInput
              value={stepKm}
              onChange={setStepKm}
              onBlur={fStep.onBlur}
              invalid={fStep.invalid}
              min={STEP_KM_MIN}
              max={STEP_KM_MAX}
              step={STEP_KM_INPUT}
            />
          </Field>

          <Field
            label="Raggio massimo (km)"
            required
            error={fMax.error}
            hint={`Oltre questo raggio la pratica è "zona non coperta". Tra ${num(RAGGIO_MAX_KM_MIN)} e ${num(RAGGIO_MAX_KM_MAX)} km.`}
          >
            <NumberInput
              value={raggioMaxKm}
              onChange={setRaggioMaxKm}
              onBlur={fMax.onBlur}
              invalid={fMax.invalid}
              min={RAGGIO_MAX_KM_MIN}
              max={RAGGIO_MAX_KM_MAX}
              step={STEP_RAGGIO_MAX_KM_INPUT}
            />
          </Field>

          <Field
            label="Durata round (minuti)"
            required
            error={fDurata.error}
            hint={`Attesa di orario lavorativo prima di allargare il raggio. Tra ${DURATA_ROUND_MIN_MIN} e ${DURATA_ROUND_MIN_MAX} minuti. Il cron gira ogni minuto: sotto i 2 minuti la cadenza reale può variare di un minuto.`}
          >
            <NumberInput
              value={durataRoundMin}
              onChange={setDurataRoundMin}
              onBlur={fDurata.onBlur}
              invalid={fDurata.invalid}
              min={DURATA_ROUND_MIN_MIN}
              max={DURATA_ROUND_MIN_MAX}
              step={STEP_DURATA_MIN_INPUT}
            />
          </Field>
        </div>

        {roundMax !== null && (
          <p className="mt-4 text-[13px] text-pv-slate-500">
            Con questi valori la distribuzione arriva al raggio massimo in al più{' '}
            <strong className="text-pv-navy-800">{roundMax}</strong>{' '}
            {roundMax === 1 ? 'round' : 'round'}
            {durataRoundMin != null && durataRoundMin > 0 && (
              <>
                , cioè circa{' '}
                <strong className="text-pv-navy-800">
                  {formatMinuti((roundMax - 1) * durataRoundMin)}
                </strong>{' '}
                di orario lavorativo
              </>
            )}
            . I round senza nemmeno un&apos;agenzia vengono saltati subito, senza attesa.
          </p>
        )}

        <p className="mt-3 text-[12.5px] text-pv-slate-500">
          Misura del raggio: linea d&apos;aria.
        </p>

        <div className="mt-5 flex justify-end">
          <Button type="submit" loading={pending} loadingLabel="Salvataggio…">
            Salva
          </Button>
        </div>
      </div>

      <OrariSettimanaEditor
        value={orariSettimana}
        onChange={setOrariSettimana}
        errore={field('orariSettimana').error}
      />

      <LoadingOverlay show={pending} label="Salvataggio…" />
    </form>
  );
}

/** "2 h", "30 min", "1 h 30 min" — dai minuti, senza passare dalle ore. */
function formatMinuti(minutiTotali: number): string {
  const tot = Math.round(minutiTotali);
  const h = Math.floor(tot / 60);
  const m = tot % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
