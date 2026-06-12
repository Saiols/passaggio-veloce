'use client';

import { useState, useTransition } from 'react';
import { InlineSpinner } from '@/components/ui';
import { createInvitationAction } from './actions';

export function InviteForm({
  onSuccess,
}: { onSuccess?: () => void } = {}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null); setSuccess(null); setDemoLink(null);
    startTransition(async () => {
      const email = String(formData.get('email') ?? '');
      const res = await createInvitationAction(email);
      if (!res.ok) { setError(res.error); return; }
      setSuccess(`Invito inviato a ${email}.`);
      if (res.demoLink) setDemoLink(res.demoLink);
      if (!res.demoLink) onSuccess?.();
    });
  }

  return (
    <form action={handleSubmit} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
      <input
        type="email"
        name="email"
        required
        placeholder="utente@azienda.it"
        className="flex-1 rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending && <InlineSpinner className="h-4 w-4" />}
        <span>{pending ? 'Invio…' : 'Invia invito'}</span>
      </button>
      {error && <p className="text-sm text-pv-red-500 basis-full">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 basis-full">{success}</p>}
      {demoLink && (
        <div className="basis-full rounded-lg bg-pv-amber-50 border border-pv-amber-500 p-3 text-xs">
          <p className="font-bold text-pv-navy-900">🧪 Modalità DEMO — link diretto</p>
          <a href={demoLink} className="text-pv-navy-700 underline break-all">{demoLink}</a>
        </div>
      )}
    </form>
  );
}
