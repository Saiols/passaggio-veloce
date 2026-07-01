'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { updateOwnProfileAction } from './actions';

export function ProfiloPersonaleForm({
  defaultEmail,
  defaultNome,
  defaultCognome,
  defaultCodiceFiscale,
}: {
  defaultEmail: string;
  defaultNome: string;
  defaultCognome: string;
  defaultCodiceFiscale: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [nome, setNome] = useState(defaultNome);
  const [cognome, setCognome] = useState(defaultCognome);
  const [codiceFiscale, setCodiceFiscale] = useState(defaultCodiceFiscale);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateOwnProfileAction(
        email,
        nome,
        cognome,
        codiceFiscale,
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
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">Nome</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">Cognome</span>
          <input
            value={cognome}
            onChange={(e) => setCognome(e.target.value)}
            required
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[12px] font-semibold text-pv-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[12px] font-semibold text-pv-slate-700">
            Codice fiscale (opzionale)
          </span>
          <input
            value={codiceFiscale}
            onChange={(e) => setCodiceFiscale(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 font-mono text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
          />
        </label>
      </div>

      {error && <p className="text-[12px] text-pv-red-500">{error}</p>}
      {savedAt && !error && (
        <p className="text-[12px] text-pv-green-500">Modifiche salvate.</p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="md" disabled={pending} loading={pending} loadingLabel="Salvataggio…">
          Salva modifiche
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Salvataggio…" />
    </form>
  );
}
