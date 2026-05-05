'use client';

import { useState, useTransition } from 'react';
import { Alert, Button } from '@/components/ui';
import { resetAssistentePasswordAction } from '@/app/admin/assistenti/actions';

export function ResetAssistentePassword({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReset = (): void => {
    if (
      !confirm(
        'Confermi il reset password? La nuova password sara\' mostrata una sola volta.',
      )
    ) {
      return;
    }
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const res = await resetAssistentePasswordAction(userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNewPassword(res.newPassword);
    });
  };

  const handleCopy = async (): Promise<void> => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Impossibile copiare. Selezionala manualmente.');
    }
  };

  if (newPassword) {
    return (
      <div className="mt-4">
        <Alert variant="success" title="Password rigenerata">
          Copia subito la password: chiusa questa finestra non sara&apos; piu&apos;
          recuperabile.
        </Alert>
        <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-3 sm:flex-row sm:items-center">
          <code className="flex-1 select-all break-all rounded-[8px] bg-white px-3 py-2 text-[14px] font-mono font-semibold text-pv-navy-800">
            {newPassword}
          </code>
          <Button type="button" size="sm" onClick={handleCopy}>
            {copied ? 'Copiato!' : 'Copia'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {error && <p className="mb-2 text-[12px] text-pv-red-500">{error}</p>}
      <Button
        type="button"
        size="md"
        variant="danger"
        onClick={handleReset}
        disabled={pending}
      >
        {pending ? 'Generazione…' : 'Genera nuova password'}
      </Button>
    </div>
  );
}
