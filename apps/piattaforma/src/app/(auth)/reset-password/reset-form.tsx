'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { InlineSpinner, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import {
  requestPasswordResetAction,
  confirmPasswordResetAction,
} from '@/app/(auth)/actions';

export function ResetForm({ token }: { token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleRequest(formData: FormData) {
    setError(null);
    setSuccess(null);
    setDemoLink(null);
    startTransition(async () => {
      const email = String(formData.get('email') ?? '');
      const res = await requestPasswordResetAction(email);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(
        "Se l'email è registrata, riceverai un link per reimpostare la password.",
      );
      if (res.demoToken) {
        const url = `${window.location.origin}/reset-password?token=${res.demoToken}`;
        setDemoLink(url);
      }
    });
  }

  function handleConfirm(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const newPassword = String(formData.get('password') ?? '');
      const res = await confirmPasswordResetAction(token!, newPassword);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/login?reset=success');
    });
  }

  if (token) {
    return (
      <form action={handleConfirm} className="mt-6 space-y-4">
        <PasswordInput
          name="password"
          required
          minLength={10}
          placeholder="Nuova password"
          className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-pv-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending && <InlineSpinner className="h-4 w-4" />}
          <span>{pending ? 'Salvataggio…' : 'Imposta password'}</span>
        </button>
        <LoadingOverlay show={pending} label="Salvataggio…" />
      </form>
    );
  }

  return (
    <form action={handleRequest} className="mt-6 space-y-4">
      <input
        type="email"
        name="email"
        required
        placeholder="email@esempio.it"
        className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-pv-red-600">{error}</p>}
      {success && <p className="text-sm text-pv-green-500">{success}</p>}
      {demoLink && (
        <div className="rounded-lg bg-pv-amber-50 border border-pv-amber-500 p-3 text-xs">
          <p className="font-bold text-pv-navy-900">🧪 Demo</p>
          <a href={demoLink} className="text-pv-navy-700 underline break-all">
            {demoLink}
          </a>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending && <InlineSpinner className="h-4 w-4" />}
        <span>{pending ? 'Invio…' : 'Invia link'}</span>
      </button>
      <LoadingOverlay show={pending} label="Invio…" />
    </form>
  );
}
