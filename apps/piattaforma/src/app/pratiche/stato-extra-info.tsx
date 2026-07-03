'use client';

import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui';
import { formatCurrencyCent } from '@/lib/format';
import { tipoSegnalazioneLabel, type StatoExtra } from '@/lib/pratiche/stato-extra';

/**
 * Affordance informativa accanto al chip di stato (Sistema Penali Broker):
 * - pratica in revisione (segnalata dall'agenzia) → pill "⚠ Segnalata" + modale
 * - pratica annullata dal team → icona ⓘ + modale col motivo
 * Nessun trattamento (`extra === null`) → non rende nulla. Valido per broker e agenzia.
 */
export function StatoExtraInfo({ extra }: { extra: StatoExtra }) {
  const [open, setOpen] = useState(false);
  if (!extra) return null;

  let trigger: ReactNode;
  let title: string;
  let body: ReactNode;

  if (extra.kind === 'IN_REVISIONE') {
    title = 'Pratica in revisione';
    trigger = (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Dettagli segnalazione in revisione"
        className="inline-flex items-center gap-1 rounded-full bg-pv-red-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-red-500 transition hover:bg-pv-red-100"
      >
        <span aria-hidden>⚠</span>
        Segnalata
        <span
          aria-hidden
          className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px] normal-case"
        >
          i
        </span>
      </button>
    );
    body = (
      <div className="space-y-3 text-[13.5px] text-pv-slate-700">
        <p>
          L&apos;agenzia ha segnalato una possibile anomalia sul veicolo. Il team di
          Passaggio Veloce sta verificando la segnalazione.
        </p>
        {extra.tipo && (
          <MotivoBox
            label="Motivo segnalato"
            value={tipoSegnalazioneLabel(extra.tipo)}
            hint="in verifica da parte del team"
          />
        )}
        {extra.nota && <Nota label="Nota agenzia" testo={extra.nota} />}
        <p className="text-pv-slate-500">Ti aggiorneremo appena conclusa la verifica.</p>
      </div>
    );
  } else if (extra.origine === 'SEGNALAZIONE') {
    title = 'Pratica annullata';
    trigger = <InfoButton onClick={() => setOpen(true)} />;
    body = (
      <div className="space-y-3 text-[13.5px] text-pv-slate-700">
        <p>
          Questa pratica è stata annullata dal team a seguito di una segnalazione
          dell&apos;agenzia.
        </p>
        <MotivoBox
          label="Motivo"
          value={extra.tipo ? tipoSegnalazioneLabel(extra.tipo) : 'Segnalazione confermata'}
        />
        {extra.nota && <Nota label="Nota" testo={extra.nota} />}
        {extra.penaleCent != null && extra.penaleCent > 0 && (
          <p className="text-pv-slate-500">
            È stata addebitata una penale di {formatCurrencyCent(extra.penaleCent)} e non
            hai maturato il compenso di questa pratica.
          </p>
        )}
      </div>
    );
  } else {
    title = 'Pratica annullata';
    trigger = <InfoButton onClick={() => setOpen(true)} />;
    body = (
      <div className="space-y-3 text-[13.5px] text-pv-slate-700">
        <p>
          Questa pratica è stata annullata dal team a seguito della revisione documentale.
          Trovi i dettagli nella notifica che hai ricevuto.
        </p>
      </div>
    );
  }

  return (
    <>
      {trigger}
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="sm">
        {body}
      </Modal>
    </>
  );
}

function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Motivo dell'annullamento"
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-pv-red-200 text-[11px] font-bold text-pv-red-500 transition hover:bg-pv-red-50"
    >
      i
    </button>
  );
}

function MotivoBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[12px] border border-pv-red-100 bg-pv-red-50 px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-pv-red-500">{label}</p>
      <p className="mt-0.5 text-[14px] font-bold text-pv-navy-900">{value}</p>
      {hint && <p className="text-[12px] text-pv-slate-500">{hint}</p>}
    </div>
  );
}

function Nota({ label, testo }: { label: string; testo: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-pv-slate-700">{testo}</p>
    </div>
  );
}
