'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { changeOwnPasswordAction } from './actions';

const INPUT_CLASS =
  'w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]';

export function CambioPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [attuale, setAttuale] = useState('');
  const [nuova, setNuova] = useState('');
  const [conferma, setConferma] = useState('');

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (nuova !== conferma) {
      setError('Le due nuove password non coincidono');
      return;
    }
    startTransition(async () => {
      const res = await changeOwnPasswordAction(attuale, nuova);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAttuale('');
      setNuova('');
      setConferma('');
      setDone(true);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[12px] font-semibold text-pv-slate-700">Password attuale</span>
          <PasswordInput
            value={attuale}
            onChange={(e) => setAttuale(e.target.value)}
            autoComplete="current-password"
            required
            containerClassName="mt-1"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">Nuova password</span>
          <PasswordInput
            value={nuova}
            onChange={(e) => setNuova(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            containerClassName="mt-1"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">
            Ripeti nuova password
          </span>
          <PasswordInput
            value={conferma}
            onChange={(e) => setConferma(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            containerClassName="mt-1"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <p className="text-[12px] text-pv-slate-500">
        Almeno 8 caratteri, con maiuscole, minuscole e numeri. Non ricordi la password
        attuale?{' '}
        <Link
          href="/reset-password"
          className="font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          Reimpostala via email
        </Link>
        .
      </p>

      {error && <p className="text-[12px] text-pv-red-500">{error}</p>}
      {done && !error && (
        <p className="text-[12px] text-pv-green-500">
          Password aggiornata. Usala dal prossimo accesso.
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          size="md"
          disabled={pending || !attuale || !nuova || !conferma}
          loading={pending}
          loadingLabel="Aggiornamento…"
        >
          Aggiorna password
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Aggiornamento…" />
    </form>
  );
}
