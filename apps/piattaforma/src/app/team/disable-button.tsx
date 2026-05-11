'use client';

import { useState, useTransition } from 'react';
import { disableTeamUserAction } from './actions';

export function DisableTeamUserButton({
  userId,
  nome,
  cognome,
}: {
  userId: string;
  nome: string;
  cognome: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = (): void => {
    if (
      !confirm(
        `Confermi di eliminare l'utente ${nome} ${cognome}? L'accesso viene revocato subito. I dati personali vengono anonimizzati dopo 90 giorni (GDPR).`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await disableTeamUserAction(userId);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="rounded-lg border border-pv-red-500 px-3 py-1.5 text-xs font-semibold text-pv-red-500 hover:bg-pv-red-50 disabled:opacity-50"
      >
        {pending ? 'Eliminazione…' : 'Elimina'}
      </button>
      {error && <p className="text-[11px] text-pv-red-500">{error}</p>}
    </div>
  );
}
