'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal, Checkbox } from '@/components/ui';
import { formatCurrencyCent } from '@/lib/format';
import { AFF_SPOT_COOKIE } from '@/lib/affiliazione/spot-cookie';

type Spot = {
  link: string;
  sedeNomeFallback: string | null;
  sempliceCent: number;
  minivolturaCent: number;
  minPayoutCent: number;
  messaggioWhatsapp: string;
};

function cookiePresente(): boolean {
  if (typeof document === 'undefined') return true;
  return document.cookie
    .split('; ')
    .some((c) => c.startsWith(`${AFF_SPOT_COOKIE}=`));
}

/**
 * Modale di lancio del programma affiliazione, mostrata dopo il login (in
 * pratica sulla dashboard: `loginAction` redirige sempre lì).
 *
 * Montata negli shell di broker e agenzia, che rimontano a OGNI cambio rotta:
 * il cookie di sessione `pv_aff_spot` — settato dalla GET, letto qui prima di
 * chiamarla — è ciò che impedisce alla modale di riaprirsi a ogni click e al
 * client di rifare la fetch a ogni pagina. Il "non mostrare più" è un'altra
 * cosa: sta su `User.affiliazioneSpotDismissedAt` e lo scrive la POST.
 */
export function AffiliazioneSpot() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [open, setOpen] = useState(false);
  const [nonMostrarePiu, setNonMostrarePiu] = useState(false);
  const [copiato, setCopiato] = useState(false);

  useEffect(() => {
    // Già mostrata in questa sessione di browser: nessuna richiesta, nessuna
    // modale. È il ramo che vale per quasi tutte le navigazioni.
    if (cookiePresente()) return;

    let annullato = false;
    void (async () => {
      try {
        const res = await fetch('/api/affiliazione/spot', { cache: 'no-store' });
        if (!res.ok || annullato) return;
        const data = (await res.json()) as { show?: boolean } & Partial<Spot>;
        if (annullato || !data.show || !data.link) return;
        setSpot(data as Spot);
        setOpen(true);
      } catch {
        /* rete assente: la modale semplicemente non appare, riproverà al prossimo login */
      }
    })();
    return () => {
      annullato = true;
    };
  }, []);

  const chiudi = (): void => {
    setOpen(false);
    if (!nonMostrarePiu) return;
    // Best-effort: se la POST fallisce la modale ricompare al prossimo login,
    // che è il fallback innocuo. Non blocchiamo la chiusura su una fetch.
    void fetch('/api/affiliazione/spot', { method: 'POST' }).catch(() => {});
  };

  const copia = async (): Promise<void> => {
    if (!spot) return;
    try {
      await navigator.clipboard.writeText(spot.link);
      setCopiato(true);
      window.setTimeout(() => setCopiato(false), 2000);
    } catch {
      /* clipboard non disponibile: il link è comunque visibile e selezionabile */
    }
  };

  if (!spot) return null;

  const numeri = [
    { valore: formatCurrencyCent(spot.sempliceCent), label: 'per veicolo, su ogni passaggio semplice' },
    { valore: formatCurrencyCent(spot.minivolturaCent), label: 'per veicolo, su ogni minivoltura' },
    { valore: 'Per sempre', label: 'finché il collega resta attivo' },
  ];

  const passi = [
    'Condividi il tuo link con un collega broker o un’agenzia.',
    'Lui si registra dal tuo link e inizia a lavorare su Passaggio Veloce.',
    'Ogni sua pratica firmata ti accredita una commissione, in automatico.',
  ];

  return (
    <Modal
      open={open}
      onClose={chiudi}
      size="lg"
      title="Invita un collega, guadagna su ogni sua pratica"
      description="Programma affiliazione Passaggio Veloce"
    >
      <div className="grid grid-cols-3 gap-3">
        {numeri.map((n) => (
          <div
            key={n.label}
            className="rounded-[12px] border border-pv-slate-200 bg-pv-slate-50/60 px-3 py-3 text-center"
          >
            <p className="text-[19px] font-extrabold leading-tight text-pv-navy-900">{n.valore}</p>
            <p className="mt-1 text-[11px] leading-snug text-pv-slate-500">{n.label}</p>
          </div>
        ))}
      </div>

      <ol className="mt-5 space-y-2">
        {passi.map((p, i) => (
          <li key={p} className="flex gap-3 text-[13px] text-pv-slate-700">
            <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pv-navy-700 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-[12px] border border-pv-slate-200 p-4">
        <p className="text-[13px] font-bold text-pv-navy-800">Il tuo link, già pronto</p>
        {spot.sedeNomeFallback && (
          <p className="mt-1 text-[11.5px] text-pv-slate-500">
            È il link della sede{' '}
            <span className="font-semibold text-pv-navy-800">{spot.sedeNomeFallback}</span>. Gli
            altri li trovi nella pagina Affiliazione.
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="flex-1 truncate rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
            {spot.link}
          </code>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void copia()}
              className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
            >
              {copiato ? 'Copiato ✓' : 'Copia'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(spot.messaggioWhatsapp)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[10px] border border-pv-slate-300 px-4 py-2 text-[13px] font-semibold text-pv-navy-800 hover:bg-pv-slate-50"
            >
              WhatsApp
            </a>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-pv-slate-500">
          Le commissioni si accreditano sul wallet della tua azienda; il payout si richiede a
          partire da {formatCurrencyCent(spot.minPayoutCent)}.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-pv-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-pv-slate-600">
          <Checkbox
            checked={nonMostrarePiu}
            onChange={(e) => setNonMostrarePiu(e.target.checked)}
          />
          Non mostrare più questo messaggio
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={chiudi}
            className="rounded-[10px] border border-pv-slate-300 px-4 py-2 text-[13px] font-semibold text-pv-navy-800 hover:bg-pv-slate-50"
          >
            Chiudi
          </button>
          <Link
            href="/affiliazione"
            onClick={chiudi}
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
          >
            Scopri il programma
          </Link>
        </div>
      </div>
    </Modal>
  );
}
