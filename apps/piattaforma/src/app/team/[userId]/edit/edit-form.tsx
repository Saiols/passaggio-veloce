'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Button, Field, Input, Select } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { MatricePermessi } from '@/components/permessi/matrice-permessi';
import { permessiConcedibili } from '@/components/permessi/matrice-logic';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { updateTeamUserAction } from '@/app/team/actions';

type RuoloSede = 'OPERATORE' | 'ADMIN_SEDE';

export function TeamEditForm({
  userId,
  defaultEmail,
  defaultNome,
  defaultCognome,
  isOwner = false,
  sedi = [],
  defaultSedeId = '',
  defaultRuolo = 'OPERATORE',
  companyType,
  assegnabili,
  puoScegliere,
  permessiIniziali,
  currentUserId,
}: {
  userId: string;
  defaultEmail: string;
  defaultNome: string;
  defaultCognome: string;
  /** Proprietario (ADMIN_AZIENDA): accesso a tutte le sedi, niente sede/ruolo. */
  isOwner?: boolean;
  sedi?: { id: string; nome: string }[];
  defaultSedeId?: string;
  defaultRuolo?: RuoloSede;
  companyType: CompanyTypeP;
  /** Ciò che il chiamante può concedere: il resto appare disabilitato nella matrice. */
  assegnabili: Permesso[];
  /** Il chiamante ha `team.permessi`. Se no, la matrice non si mostra affatto. */
  puoScegliere: boolean;
  /** I permessi ATTUALI dell'utente target: aprire il form non li resetta a un preset. */
  permessiIniziali: Permesso[];
  /** L'id dell'utente loggato: nessuno modifica i propri permessi (il server rifiuterebbe comunque). */
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [nome, setNome] = useState(defaultNome);
  const [cognome, setCognome] = useState(defaultCognome);
  const [sedeId, setSedeId] = useState(defaultSedeId);
  const [ruolo, setRuolo] = useState<RuoloSede>(defaultRuolo);
  const [permessi, setPermessi] = useState<Permesso[]>(permessiIniziali);

  // Il server rifiuterebbe comunque (validaPermessi: owner o se stessi): mostrare
  // la matrice sarebbe una promessa non mantenuta.
  const modificabile = puoScegliere && !isOwner && userId !== currentUserId;

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email('Email non valida'),
        nome: z.string().trim().min(1, 'Nome obbligatorio'),
        cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
        sedeId: isOwner
          ? z.string().optional()
          : z.string().min(1, 'Seleziona la sede di appartenenza'),
      }),
    [isOwner],
  );
  const errors = zodFieldErrors(schema, { email, nome, cognome, sedeId });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fEmail = field('email');
  const fNome = field('nome');
  const fCognome = field('cognome');
  const fSede = field('sedeId');

  function onRuoloChange(r: RuoloSede) {
    setRuolo(r);
    // Il set concedibile cambia col ruolo: un OPERATORE non può avere team.* in
    // mano (manageableSedi() lo blocca comunque sullo scope) — sparisce dal
    // valore, non solo dalla matrice.
    const concedibili = permessiConcedibili(assegnabili, r);
    setPermessi((prev) => prev.filter((p) => concedibili.has(p)));
  }

  const onValid = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await updateTeamUserAction(
        userId,
        email,
        nome,
        cognome,
        isOwner ? undefined : sedeId,
        isOwner ? undefined : ruolo,
        modificabile ? permessi : undefined,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  };

  return (
    <form onSubmit={gatedSubmit(onValid)} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email" required error={fEmail.error} className="sm:col-span-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={fEmail.onBlur}
            invalid={fEmail.invalid}
          />
        </Field>
        <Field label="Nome" required error={fNome.error}>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={fNome.onBlur}
            invalid={fNome.invalid}
          />
        </Field>
        <Field label="Cognome" required error={fCognome.error}>
          <Input
            value={cognome}
            onChange={(e) => setCognome(e.target.value)}
            onBlur={fCognome.onBlur}
            invalid={fCognome.invalid}
          />
        </Field>

        {!isOwner && (
          <>
            <Field label="Sede di appartenenza" required error={fSede.error}>
              <Select
                value={sedeId}
                onChange={(e) => setSedeId(e.target.value)}
                onBlur={fSede.onBlur}
                invalid={fSede.invalid}
              >
                <option value="" disabled>
                  Seleziona una sede…
                </option>
                {sedi.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ruolo">
              <Select value={ruolo} onChange={(e) => onRuoloChange(e.target.value as RuoloSede)}>
                <option value="OPERATORE">Operatore</option>
                <option value="ADMIN_SEDE">Admin di sede</option>
              </Select>
            </Field>
          </>
        )}
      </div>

      {isOwner && (
        <p className="text-[12px] text-pv-slate-500">
          Questo utente è proprietario dell’azienda: ha accesso a tutte le sedi e a tutti i
          permessi, quindi non ha una singola sede di appartenenza, un ruolo di sede né un set di
          permessi da assegnare.
        </p>
      )}

      {modificabile ? (
        <MatricePermessi
          companyType={companyType}
          ruoloSede={ruolo}
          value={permessi}
          onChange={setPermessi}
          assegnabili={assegnabili}
        />
      ) : (
        !isOwner &&
        userId !== currentUserId && (
          <p className="text-[12px] text-pv-slate-500">
            Non hai il permesso di assegnare permessi ad altri utenti: i permessi di questo utente
            restano invariati.
          </p>
        )
      )}

      {error && <p className="text-[12px] text-pv-red-500">{error}</p>}
      {savedAt && !error && <p className="text-[12px] text-pv-green-500">Salvato.</p>}

      <div className="flex justify-end">
        <Button type="submit" size="md" loading={pending} loadingLabel="Salvataggio…">
          Salva modifiche
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Salvataggio…" />
    </form>
  );
}
