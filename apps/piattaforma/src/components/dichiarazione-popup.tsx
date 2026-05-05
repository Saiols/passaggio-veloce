'use client';

import { Button } from '@/components/ui';

/**
 * Popup di responsabilità broker (Sistema Penali Broker — SP-A release 2026-05).
 * Spec: docs/sistema-penali-broker.md §"Popup di responsabilità broker".
 *
 * Componente isolato e riusabile: viene chiamato dal wizard pratica come
 * modale prima del submit finale. Il bottone "Conferma e invia" rimane
 * disabilitato finché il broker non spunta il checkbox di accettazione.
 *
 * IL CALLER è responsabile di:
 *  - Mantenere lo stato `accepted` (checkbox)
 *  - Chiamare `onConfirm()` quando l'utente clicca "Conferma e invia"
 *  - Passare la versione del popup (`POPUP_VERSION` da lib/penali/config) al
 *    submit, perché il backend deve registrarla nel BrokerDichiarazione.
 */
export function DichiarazionePopup({
  open,
  accepted,
  pending,
  onAcceptedChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  accepted: boolean;
  pending: boolean;
  onAcceptedChange: (v: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dichiarazione-title"
    >
      <div className="w-full max-w-lg rounded-[20px] bg-white p-6 shadow-[var(--pv-shadow-card-lg)] sm:p-7">
        <div className="mb-4 flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pv-amber-50 text-[18px] text-pv-amber-500"
          >
            ⚠️
          </span>
          <h2
            id="dichiarazione-title"
            className="text-[18px] font-extrabold text-pv-navy-900 sm:text-[20px]"
          >
            Verifica obbligatoria prima di inviare
          </h2>
        </div>

        <p className="mb-3 text-[13.5px] leading-relaxed text-pv-slate-700">
          Prima di inviare questa pratica, conferma di aver verificato
          personalmente che:
        </p>
        <ul className="mb-3 space-y-1.5 text-[13px] text-pv-slate-700">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-slate-400" />
            <span>
              Il veicolo <strong>NON</strong> ha fermi amministrativi attivi
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-slate-400" />
            <span>
              Il veicolo <strong>NON</strong> ha ipoteche o vincoli iscritti
              al PRA
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-slate-400" />
            <span>
              Tutti i documenti caricati sono autentici e corrispondenti al
              veicolo
            </span>
          </li>
        </ul>

        <p className="mb-4 text-[12.5px] leading-relaxed text-pv-slate-700">
          Puoi verificare lo stato del veicolo con una visura PRA su{' '}
          <a
            href="https://sportello.aci.it"
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold text-pv-navy-700 hover:underline"
          >
            sportello.aci.it
          </a>
          .
        </p>

        <div className="mb-5 rounded-[12px] border border-pv-amber-500/40 bg-pv-amber-50 px-4 py-3 text-[12.5px] text-pv-navy-800">
          In caso di pratica inviata con veicolo soggetto a fermo o ipoteca,
          la pratica verrà annullata e ti verrà addebitata una penale di{' '}
          <strong>€100,00 lordi</strong> dal tuo wallet.
        </div>

        <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-4 py-3 transition-colors hover:bg-pv-slate-100">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => onAcceptedChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-pv-navy-700"
          />
          <span className="text-[13px] font-semibold text-pv-navy-800">
            Confermo di aver verificato quanto sopra e mi assumo piena
            responsabilità
          </span>
        </label>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Annulla
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!accepted || pending}
            loading={pending}
            loadingLabel="Invio…"
          >
            Conferma e invia
          </Button>
        </div>
      </div>
    </div>
  );
}
