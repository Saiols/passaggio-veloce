'use client';

import { useMemo, useState, useTransition } from 'react';
import { z } from 'zod';
import { passwordSchema } from '@pv/lib';
import { Button, Field, Input, PasswordInput, Select } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { MatricePermessi } from '@/components/permessi/matrice-permessi';
import { applicaPreset, permessiConcedibili } from '@/components/permessi/matrice-logic';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
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
  puoScegliere: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ruoloSede, setRuoloSede] = useState<'ADMIN_SEDE' | 'OPERATORE'>('OPERATORE');
  const [permessi, setPermessi] = useState<Permesso[]>(
    applicaPreset('OPERATORE_BASE', companyType, permessiConcedibili(assegnabili, 'OPERATORE')),
  );

  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [password, setPassword] = useState('');
  const [sedeId, setSedeId] = useState('');

  const needSede = sedi.length > 1;
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email('Email non valida'),
        nome: z.string().trim().min(1, 'Nome obbligatorio'),
        cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
        password: passwordSchema,
        sedeId: needSede ? z.string().min(1, 'Seleziona una sede') : z.string().optional(),
      }),
    [needSede],
  );

  const errors = zodFieldErrors(schema, { email, nome, cognome, password, sedeId });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fEmail = field('email');
  const fNome = field('nome');
  const fCognome = field('cognome');
  const fPassword = field('password');
  const fSede = field('sedeId');

  function onRuoloChange(r: 'ADMIN_SEDE' | 'OPERATORE') {
    setRuoloSede(r);
    setPermessi(
      applicaPreset(
        r === 'ADMIN_SEDE' ? 'ADMIN_SEDE' : 'OPERATORE_BASE',
        companyType,
        permessiConcedibili(assegnabili, r),
      ),
    );
  }

  const onValid = (): void => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await createUserDirectAction(
        email,
        nome,
        cognome,
        password,
        needSede ? sedeId : undefined,
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
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Email" required error={fEmail.error} className="sm:col-span-2">
        <Input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={fEmail.onBlur}
          invalid={fEmail.invalid}
          placeholder="dipendente@azienda.it"
        />
      </Field>
      <Field label="Nome" required error={fNome.error}>
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={fNome.onBlur}
          invalid={fNome.invalid}
          placeholder="Nome"
        />
      </Field>
      <Field label="Cognome" required error={fCognome.error}>
        <Input
          name="cognome"
          value={cognome}
          onChange={(e) => setCognome(e.target.value)}
          onBlur={fCognome.onBlur}
          invalid={fCognome.invalid}
          placeholder="Cognome"
        />
      </Field>
      <Field
        label="Password iniziale"
        required
        error={fPassword.error}
        hint="Min 8, con maiuscole, minuscole e numeri"
        className="sm:col-span-2"
      >
        <PasswordInput
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={fPassword.onBlur}
          invalid={fPassword.invalid}
          placeholder="Password iniziale"
        />
      </Field>
      {needSede && (
        <Field label="Sede" required error={fSede.error}>
          <Select
            name="sedeId"
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            onBlur={fSede.onBlur}
            invalid={fSede.invalid}
          >
            <option value="" disabled>
              Sede…
            </option>
            {sedi.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Ruolo" className={needSede ? undefined : 'sm:col-span-2'}>
        <Select
          name="ruoloSede"
          value={ruoloSede}
          onChange={(e) => onRuoloChange(e.target.value as 'ADMIN_SEDE' | 'OPERATORE')}
        >
          <option value="OPERATORE">Operatore</option>
          <option value="ADMIN_SEDE">Admin di sede</option>
        </Select>
      </Field>
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
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending} loadingLabel="Creazione…" fullWidth>
          Crea account
        </Button>
      </div>
      {error && <p className="text-sm text-pv-red-500 sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 sm:col-span-2">{success}</p>}
      <LoadingOverlay show={pending} label="Creazione…" />
    </form>
  );
}
