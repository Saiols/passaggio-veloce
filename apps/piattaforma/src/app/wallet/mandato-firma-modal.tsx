'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviaOtpMandatoAction, firmaMandatoAction } from './mandato-actions';
import { LoadingOverlay } from '@/components/ui/loading-overlay';

export function MandatoFirmaModal({
  open,
  onClose,
  isTitolare,
  ragioneSociale,
}: {
  open: boolean;
  onClose: () => void;
  isTitolare: boolean;
  ragioneSociale: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [codice, setCodice] = useState('');
  const [otpInviato, setOtpInviato] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const inviaOtp = () => {
    setError(null);
    start(async () => {
      const r = await inviaOtpMandatoAction();
      if (!r.ok) setError(r.error);
      else setOtpInviato(true);
    });
  };

  const firma = () => {
    setError(null);
    start(async () => {
      const r = await firmaMandatoAction(codice);
      if (!r.ok) setError(r.error);
      else {
        setDone(true);
        router.refresh();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-[18px] font-bold text-pv-navy-900">
          Mandato per fatturazione per conto terzi
        </h2>
        <p className="mt-2 text-[13px] text-pv-slate-600">
          Per richiedere il payout devi prendere visione e firmare il mandato che autorizza
          Passaggio Veloce a emettere fatture per conto di{' '}
          <strong>{ragioneSociale}</strong>. La firma avviene tramite codice OTP inviato
          alla tua email.
        </p>

        {/* Presa visione: il documento (compilato coi dati della tua azienda) è
            consultabile e scaricabile in PDF prima della firma. */}
        <a
          href="/api/mandato/pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-pv-navy-200 bg-pv-navy-50 px-3 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-navy-100"
        >
          📄 Visualizza il mandato (PDF)
        </a>

        {!isTitolare ? (
          <p className="mt-4 rounded-lg bg-pv-red-50 p-3 text-[13px] text-pv-red-500">
            La firma del mandato spetta al titolare/amministratore dell&apos;azienda.
          </p>
        ) : done ? (
          <p className="mt-4 rounded-lg bg-pv-green-50 p-3 text-[13px] font-semibold text-pv-green-500">
            Mandato firmato. Ora puoi richiedere il payout.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {!otpInviato ? (
              <button
                type="button"
                onClick={inviaOtp}
                disabled={pending}
                className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? 'Invio…' : 'Invia codice via email'}
              </button>
            ) : (
              <>
                <p className="text-[12.5px] text-pv-slate-500">
                  Inserisci il codice ricevuto via email.
                </p>
                <input
                  value={codice}
                  onChange={(e) => setCodice(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  disabled={pending}
                  className="w-40 rounded-lg border border-pv-slate-200 px-3 py-2 text-center text-lg tracking-widest"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={firma}
                    disabled={pending || codice.length < 6}
                    className="rounded-lg bg-pv-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {pending ? 'Firma…' : 'Firma il mandato'}
                  </button>
                  <button
                    type="button"
                    onClick={inviaOtp}
                    disabled={pending}
                    className="rounded-lg px-3 py-2 text-sm text-pv-slate-600"
                  >
                    Reinvia codice
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-[13px] text-pv-red-500">{error}</p>}
        <div className="mt-5 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-pv-slate-600"
          >
            {done ? 'Chiudi' : 'Annulla'}
          </button>
        </div>
      </div>
      <LoadingOverlay show={pending} label="Attendere…" />
    </div>
  );
}
