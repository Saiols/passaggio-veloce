'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { updateTeamUserAction } from '@/app/team/actions';

type RuoloSede = 'OPERATORE' | 'ADMIN_SEDE';

const inputClass =
  'mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]';

export function TeamEditForm({
  userId,
  defaultEmail,
  defaultNome,
  defaultCognome,
  isOwner = false,
  sedi = [],
  defaultSedeId = '',
  defaultRuolo = 'OPERATORE',
}: {
  userId: string;
  defaultEmail: string;
  defaultNome: string;
  defaultCognome: string;
  /** Proprietario (ADMIN_AZIENDA): accesso a tutte le sedi, niente sede/ruolo. */
  isOwner?: boolean;
  sedi?: { id: string; nome: string }[];
  defaultSedeId?: string;
  defaultRuolo?: RuoloSede;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [nome, setNome] = useState(defaultNome);
  const [cognome, setCognome] = useState(defaultCognome);
  const [sedeId, setSedeId] = useState(defaultSedeId);
  const [ruolo, setRuolo] = useState<RuoloSede>(defaultRuolo);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    if (!isOwner && !sedeId) {
      setError('Seleziona la sede di appartenenza');
      return;
    }
    startTransition(async () => {
      const res = await updateTeamUserAction(
        userId,
        email,
        nome,
        cognome,
        isOwner ? undefined : sedeId,
        isOwner ? undefined : ruolo,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[12px] font-semibold text-pv-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} required className={inputClass} />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">Cognome</span>
          <input
            value={cognome}
            onChange={(e) => setCognome(e.target.value)}
            required
            className={inputClass}
          />
        </label>

        {!isOwner && (
          <>
            <label className="block">
              <span className="text-[12px] font-semibold text-pv-slate-700">Sede di appartenenza</span>
              <select
                value={sedeId}
                onChange={(e) => setSedeId(e.target.value)}
                required
                className={inputClass}
              >
                <option value="" disabled>
                  Seleziona una sede…
                </option>
                {sedi.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-pv-slate-700">Ruolo</span>
              <select
                value={ruolo}
                onChange={(e) => setRuolo(e.target.value as RuoloSede)}
                className={inputClass}
              >
                <option value="OPERATORE">Operatore</option>
                <option value="ADMIN_SEDE">Admin di sede</option>
              </select>
            </label>
          </>
        )}
      </div>

      {isOwner && (
        <p className="text-[12px] text-pv-slate-500">
          Questo utente è proprietario dell’azienda: ha accesso a tutte le sedi, quindi non ha una
          singola sede di appartenenza né un ruolo di sede.
        </p>
      )}

      {error && <p className="text-[12px] text-pv-red-500">{error}</p>}
      {savedAt && !error && <p className="text-[12px] text-pv-green-500">Salvato.</p>}

      <div className="flex justify-end">
        <Button type="submit" size="md" disabled={pending} loading={pending} loadingLabel="Salvataggio…">
          Salva modifiche
        </Button>
      </div>
    </form>
  );
}
