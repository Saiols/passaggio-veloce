'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { deleteCompanyAction } from '../../suspension-actions';

export function DeleteCompanyButton({
  companyId,
  ragioneSociale,
  redirectAfter,
}: {
  companyId: string;
  ragioneSociale: string;
  redirectAfter: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  if (!confirming) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setConfirming(true)}
      >
        Elimina definitivamente
      </Button>
    );
  }

  const handleDelete = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await deleteCompanyAction(companyId, confirmText);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(redirectAfter);
      router.refresh();
    });
  };

  return (
    <div className="rounded-[12px] border border-pv-red-500/40 bg-pv-red-50 p-4">
      <p className="text-[13px] font-semibold text-pv-red-500">
        Eliminazione definitiva
      </p>
      <p className="mt-1 text-[12px] text-pv-slate-700">
        L&apos;account verra&apos; eliminato. I dati personali saranno cancellati
        a 90 giorni (compliance GDPR), le pratiche storiche restano per audit
        ma anonimizzate. Operazione non reversibile.
      </p>
      <p className="mt-3 text-[12px] font-semibold text-pv-slate-700">
        Per confermare, digita esattamente:{' '}
        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px]">
          {ragioneSociale}
        </code>
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={ragioneSociale}
        className="mt-2 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:border-pv-red-500 focus:outline-none"
      />
      {error && (
        <p className="mt-2 text-[12px] text-pv-red-500">{error}</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={handleDelete}
          disabled={pending || confirmText.trim() !== ragioneSociale.trim()}
        >
          {pending ? 'Eliminazione…' : 'Elimina'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setConfirming(false);
            setConfirmText('');
            setError(null);
          }}
          disabled={pending}
        >
          Annulla
        </Button>
      </div>
    </div>
  );
}
