'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';
import { PENALI } from '@/lib/penali/config';
import { attestazioniCorrenti, type IdAttestazione } from '@/lib/legal/attestazioni';

/**
 * Popup di responsabilità broker (Sistema Penali Broker — SP-A release 2026-05).
 * Spec: docs/sistema-penali-broker.md §"Popup di responsabilità broker".
 *
 * Componente isolato e riusabile: viene chiamato dal wizard pratica come
 * modale prima del submit finale. Il bottone "Conferma e invia" rimane
 * disabilitato finché il broker non spunta TUTTE le attestazioni correnti
 * (dalla v4.0 sono due, non più una cumulativa).
 *
 * IL CALLER è responsabile di:
 *  - Mantenere lo stato `accettate` (una spunta per ogni attestazione)
 *  - Chiamare `onConfirm()` quando l'utente clicca "Conferma e invia"
 *  - Passare la versione delle attestazioni (`ATTESTAZIONI_VERSION` da
 *    lib/legal/attestazioni) al submit, perché il backend deve registrarla
 *    nel BrokerDichiarazione.
 */
export function DichiarazionePopup({
  open,
  accettate,
  pending,
  onToggle,
  onConfirm,
  onClose,
}: {
  open: boolean;
  accettate: Partial<Record<IdAttestazione, boolean>>;
  pending: boolean;
  onToggle: (id: IdAttestazione, valore: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const attestazioni = attestazioniCorrenti();
  const tutteAccettate = attestazioni.every((a) => accettate[a.id] === true);

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
          Se un veicolo di questa pratica risulta soggetto a fermo o ipoteca, la
          pratica verrà annullata e ti verrà addebitata dal wallet una penale di{' '}
          <strong>
            €{(PENALI.PENALE_BROKER_DEFAULT_CENT / 100).toFixed(2).replace('.', ',')}
          </strong>{' '}
          <strong>per ciascun veicolo segnalato</strong> (i veicoli regolari non
          vengono addebitati). La penale non è soggetta a IVA. Perderai inoltre il
          compenso previsto per la pratica annullata.
        </div>

        <div className="mb-5 flex items-start gap-2.5 rounded-[12px] border border-pv-navy-600/20 bg-pv-navy-100 px-4 py-3 text-[12.5px] text-pv-navy-800">
          <span aria-hidden className="mt-0.5 text-[15px]">
            📄
          </span>
          <span>
            Ricorda: <strong>tutti i documenti vanno portati in originale e di
            persona, fisicamente in agenzia</strong>, al momento della firma.
          </span>
        </div>

        <div className="mb-5 space-y-2.5">
          {attestazioni.map((a) => (
            <div key={a.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-4 py-3 transition-colors hover:bg-pv-slate-100">
                <input
                  type="checkbox"
                  checked={accettate[a.id] === true}
                  onChange={(e) => onToggle(a.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-pv-navy-700"
                />
                <span className="text-[13px] font-semibold text-pv-navy-800">{a.testo}</span>
              </label>
              {a.link && (
                <Link
                  href={a.link.href}
                  target="_blank"
                  className="mt-1 ml-11 inline-block text-[12px] font-semibold text-pv-navy-700 hover:underline"
                >
                  {a.link.label} ↗
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Annulla
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!tutteAccettate || pending}
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
