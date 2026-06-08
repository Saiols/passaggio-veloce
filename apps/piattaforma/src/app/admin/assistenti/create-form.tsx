'use client';

import { useState, useTransition } from 'react';
import { PasswordInput } from '@/components/ui';
import { createAssistenteAction } from './actions';

export function CreateAssistenteForm({
  onSuccess,
}: { onSuccess?: () => void } = {}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const email = String(formData.get('email') ?? '');
      const nome = String(formData.get('nome') ?? '');
      const cognome = String(formData.get('cognome') ?? '');
      const password = String(formData.get('password') ?? '');
      const res = await createAssistenteAction(email, nome, cognome, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(
        `Assistente creato per ${email}. Comunica le credenziali fuori piattaforma.`,
      );
      onSuccess?.();
    });
  }

  return (
    <form action={handleSubmit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input
        type="email"
        name="email"
        required
        placeholder="assistente@passaggioveloce.it"
        className="rounded-lg border border-pv-slate-300 px-3 py-2 text-sm sm:col-span-2"
      />
      <input
        type="text"
        name="nome"
        required
        placeholder="Nome"
        className="rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        name="cognome"
        required
        placeholder="Cognome"
        className="rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
      />
      <PasswordInput
        name="password"
        required
        minLength={8}
        placeholder="Password iniziale (min 8, A-z, 0-9)"
        className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
        containerClassName="sm:col-span-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"
      >
        {pending ? 'Creazione…' : 'Crea assistente'}
      </button>
      {error && <p className="text-sm text-pv-red-500 sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 sm:col-span-2">{success}</p>}
    </form>
  );
}
