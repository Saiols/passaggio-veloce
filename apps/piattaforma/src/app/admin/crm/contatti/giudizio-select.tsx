'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { etichettaRichiamo } from '@/lib/crm/richiamo';
import { updateCrmContactGiudizioAction, updateCrmContactRichiamoAction } from './actions';
import { RichiamoDialog } from './richiamo-dialog';
import type { ContactRow } from './client';

type Giudizio = '' | 'INTERESSATO' | 'NON_INTERESSATO';

const GIUDIZIO_LABEL: Record<Giudizio, string> = {
  '': '—',
  INTERESSATO: 'Interessato',
  NON_INTERESSATO: 'Non interessato',
};

const GIUDIZIO_COLOR: Record<Giudizio, string> = {
  '': 'bg-pv-slate-100 text-pv-slate-600',
  INTERESSATO: 'bg-pv-green-100 text-pv-green-700',
  NON_INTERESSATO: 'bg-pv-red-100 text-pv-red-700',
};

/**
 * Asse SOGGETTIVO (giudizio) + asse RICHIAMO, entrambi indipendenti dai fatti
 * (`status`). Il giudizio è una pill editabile; il richiamo è il chip 📞 con la
 * data, riprogrammabile. Nessuno dei due tocca `status`.
 */
export function GiudizioSelect({
  contact,
  currentUserRole,
  currentUserId,
}: {
  contact: ContactRow;
  currentUserRole: string;
  currentUserId: string;
}) {
  const [giudizio, setGiudizio] = useState<Giudizio>((contact.giudizio ?? '') as Giudizio);
  const [chiedeRichiamo, setChiedeRichiamo] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const disabled = currentUserRole === 'SALES' && contact.assignedToId !== currentUserId;

  const salvaGiudizio = (next: Giudizio): void => {
    const prev = giudizio;
    setGiudizio(next); // ottimistico
    startTransition(async () => {
      const res = await updateCrmContactGiudizioAction(contact.id, next || null);
      if (!res.ok) {
        setGiudizio(prev);
        alert(res.error);
        return;
      }
      router.refresh();
    });
  };

  const salvaRichiamo = (giorno: string, fascia: string): void => {
    startTransition(async () => {
      const res = await updateCrmContactRichiamoAction(contact.id, { giorno, fascia });
      if (!res.ok) {
        alert(res.error);
        return;
      }
      setChiedeRichiamo(false);
      router.refresh();
    });
  };

  const richiamo = contact.nextContactAt
    ? etichettaRichiamo(contact.nextContactAt, contact.nextContactFascia, new Date())
    : null;

  return (
    <>
      <select
        value={giudizio}
        disabled={disabled || pending}
        onChange={(e) => salvaGiudizio(e.target.value as Giudizio)}
        title={GIUDIZIO_LABEL[giudizio]}
        className={
          'rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wider disabled:opacity-60 ' +
          GIUDIZIO_COLOR[giudizio]
        }
      >
        {(Object.keys(GIUDIZIO_LABEL) as Giudizio[]).map((k) => (
          <option key={k} value={k}>
            {GIUDIZIO_LABEL[k]}
          </option>
        ))}
      </select>

      {richiamo ? (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => setChiedeRichiamo(true)}
          title="Riprogramma il richiamo"
          className={
            'mt-1 block text-[11.5px] font-semibold hover:underline disabled:no-underline ' +
            (richiamo.scaduto
              ? 'text-pv-red-500'
              : richiamo.oggi
                ? 'text-pv-orange-500'
                : 'text-pv-slate-500')
          }
        >
          📞 {richiamo.testo}
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => setChiedeRichiamo(true)}
          className="mt-1 block text-[11.5px] font-semibold text-pv-navy-600 hover:underline disabled:no-underline"
        >
          + Programma richiamo
        </button>
      )}

      {chiedeRichiamo && (
        <RichiamoDialog
          giornoIniziale={contact.nextContactAt?.slice(0, 10) ?? ''}
          fasciaIniziale={contact.nextContactFascia ?? ''}
          pending={pending}
          onConferma={salvaRichiamo}
          onAnnulla={() => setChiedeRichiamo(false)}
        />
      )}

      <LoadingOverlay show={pending} label="Aggiornamento…" />
    </>
  );
}
