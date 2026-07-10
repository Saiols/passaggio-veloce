'use client';

import { useState, useTransition } from 'react';
import { InlineSpinner, PasswordInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { MatricePermessi } from '@/components/permessi/matrice-permessi';
import { applicaPreset, permessiConcedibili } from '@/components/permessi/matrice-logic';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import { createUserDirectAction } from './actions';

export function CreateUserForm({
  onSuccess,
  sedi = [],
  companyType,
  assegnabili,
  puoScegliere,
}: {
  onSuccess?: () => void;
  sedi?: { id: string; nome: string }[];
  companyType: CompanyTypeP;
  assegnabili: Permesso[];
  /** Il chiamante ha `team.permessi`. Se no, la matrice non si mostra. */
  puoScegliere: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ruoloSede, setRuoloSede] = useState<'ADMIN_SEDE' | 'OPERATORE'>('OPERATORE');
  const [permessi, setPermessi] = useState<Permesso[]>(
    applicaPreset('OPERATORE_BASE', companyType, permessiConcedibili(assegnabili, 'OPERATORE')),
  );

  function onRuoloChange(r: 'ADMIN_SEDE' | 'OPERATORE') {
    setRuoloSede(r);
    // Il set concedibile cambia col ruolo: ricalcolare il preset con i NUOVI concedibili,
    // altrimenti passando ad «Operatore» resterebbero accesi dei team.* inerti.
    setPermessi(
      applicaPreset(
        r === 'ADMIN_SEDE' ? 'ADMIN_SEDE' : 'OPERATORE_BASE',
        companyType,
        permessiConcedibili(assegnabili, r),
      ),
    );
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const email = String(formData.get('email') ?? '');
      const nome = String(formData.get('nome') ?? '');
      const cognome = String(formData.get('cognome') ?? '');
      const password = String(formData.get('password') ?? '');
      const sedeId = String(formData.get('sedeId') ?? '') || undefined;
      const res = await createUserDirectAction(
        email,
        nome,
        cognome,
        password,
        sedeId,
        ruoloSede,
        puoScegliere ? permessi : undefined,
      );
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
        value={ruoloSede}
        onChange={(e) => onRuoloChange(e.target.value as 'ADMIN_SEDE' | 'OPERATORE')}
        className={`rounded-lg border border-pv-slate-300 px-3 py-2 text-sm ${sedi.length > 1 ? '' : 'sm:col-span-2'}`}
      >
        <option value="OPERATORE">Operatore</option>
        <option value="ADMIN_SEDE">Admin di sede</option>
      </select>
      {puoScegliere ? (
        <div className="sm:col-span-2">
          <MatricePermessi
            companyType={companyType}
            ruoloSede={ruoloSede}
            value={permessi}
            onChange={setPermessi}
            assegnabili={assegnabili}
          />
        </div>
      ) : (
        <p className="text-sm text-pv-slate-500 sm:col-span-2">
          L&apos;utente riceverà i permessi di base. Per personalizzarli, chiedi al titolare.
        </p>
      )}
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
