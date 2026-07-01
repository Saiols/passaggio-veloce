'use client';

import { useState, useTransition } from 'react';
import { InlineSpinner, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { createUserDirectAction } from './actions';

export function CreateUserForm({
  onSuccess,
  sedi = [],
}: { onSuccess?: () => void; sedi?: { id: string; nome: string }[] } = {}) {
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
      const sedeId = String(formData.get('sedeId') ?? '') || undefined;
      const ruoloSede = String(formData.get('ruoloSede') ?? 'OPERATORE') as
        | 'ADMIN_SEDE'
        | 'OPERATORE';
      const res = await createUserDirectAction(email, nome, cognome, password, sedeId, ruoloSede);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(
        `Account creato per ${email}. Comunica le credenziali al dipendente fuori piattaforma.`,
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
        placeholder="dipendente@azienda.it"
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
      {sedi.length > 1 && (
        <select
          name="sedeId"
          required
          defaultValue=""
          className="rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Sede…
          </option>
          {sedi.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      )}
      <select
        name="ruoloSede"
        defaultValue="OPERATORE"
        className={`rounded-lg border border-pv-slate-300 px-3 py-2 text-sm ${sedi.length > 1 ? '' : 'sm:col-span-2'}`}
      >
        <option value="OPERATORE">Operatore</option>
        <option value="ADMIN_SEDE">Admin di sede</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"
      >
        {pending && <InlineSpinner className="h-4 w-4" />}
        <span>{pending ? 'Creazione…' : 'Crea account'}</span>
      </button>
      {error && <p className="text-sm text-pv-red-500 sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 sm:col-span-2">{success}</p>}
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
