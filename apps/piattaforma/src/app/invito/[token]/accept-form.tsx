'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { InlineSpinner, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { acceptInvitationAction } from '@/app/team/actions';

export function AcceptForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handle(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await acceptInvitationAction(
        token,
        String(formData.get('nome') ?? ''),
        String(formData.get('cognome') ?? ''),
        String(formData.get('password') ?? ''),
      );
      if (!res.ok) { setError(res.error); return; }
      router.push('/login?invited=success');
    });
  }

  return (
    <form action={handle} className="mt-6 space-y-3">
      <input name="nome" required placeholder="Nome"
        className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm" />
      <input name="cognome" required placeholder="Cognome"
        className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm" />
      <PasswordInput name="password" required minLength={8}
        placeholder="Password (min 8, A-z, 0-9)"
        className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm" />
      {error && <p className="text-sm text-pv-red-500">{error}</p>}
      <button type="submit" disabled={pending} aria-busy={pending || undefined}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending && <InlineSpinner className="h-4 w-4" />}
        <span>{pending ? 'Creazione…' : 'Crea il mio account'}</span>
      </button>
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
