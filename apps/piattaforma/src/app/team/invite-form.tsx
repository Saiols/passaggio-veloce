'use client';

import { useMemo, useState, useTransition } from 'react';
import { z } from 'zod';
import { Button, Field, Input, Select } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { MatricePermessi } from '@/components/permessi/matrice-permessi';
import { applicaPreset, permessiConcedibili } from '@/components/permessi/matrice-logic';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { createInvitationAction } from './actions';

export function InviteForm({
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
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ruoloSede, setRuoloSede] = useState<'ADMIN_SEDE' | 'OPERATORE'>('OPERATORE');
  const [permessi, setPermessi] = useState<Permesso[]>(
    applicaPreset('OPERATORE_BASE', companyType, permessiConcedibili(assegnabili, 'OPERATORE')),
  );

  const [email, setEmail] = useState('');
  const [sedeId, setSedeId] = useState('');

  const needSede = sedi.length > 1;
  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email('Email non valida'),
        sedeId: needSede ? z.string().min(1, 'Seleziona una sede') : z.string().optional(),
      }),
    [needSede],
  );
  const errors = zodFieldErrors(schema, { email, sedeId });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fEmail = field('email');
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
    setDemoLink(null);
    startTransition(async () => {
      const res = await createInvitationAction(
        email,
        needSede ? sedeId : undefined,
        ruoloSede,
        puoScegliere ? permessi : undefined,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(`Invito inviato a ${email}.`);
      if (res.demoLink) setDemoLink(res.demoLink);
      if (!res.demoLink) onSuccess?.();
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
          placeholder="utente@azienda.it"
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
        <Button type="submit" loading={pending} loadingLabel="Invio…" fullWidth>
          Invia invito
        </Button>
      </div>
      {error && <p className="text-sm text-pv-red-500 sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-pv-green-500 sm:col-span-2">{success}</p>}
      {demoLink && (
        <div className="rounded-lg bg-pv-amber-50 border border-pv-amber-500 p-3 text-xs sm:col-span-2">
          <p className="font-bold text-pv-navy-900">🧪 Modalità DEMO — link diretto</p>
          <a href={demoLink} className="text-pv-navy-700 underline break-all">
            {demoLink}
          </a>
        </div>
      )}
      <LoadingOverlay show={pending} label="Invito…" />
    </form>
  );
}
