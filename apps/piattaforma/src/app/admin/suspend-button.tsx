'use client';

import { useTransition } from 'react';
import {
  reactivateCompanyAction,
  reactivateUserAction,
  suspendCompanyAction,
  suspendUserAction,
} from './suspension-actions';

type Target = { kind: 'user' | 'company'; id: string };

export function SuspendButton({
  target,
  suspended,
}: {
  target: Target;
  suspended: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (
      !suspended &&
      !confirm(
        target.kind === 'company'
          ? 'Sospendere l\'azienda? Anche tutti gli utenti aziendali saranno sospesi.'
          : 'Sospendere questo utente? Non potrà più accedere alla piattaforma.',
      )
    )
      return;

    startTransition(async () => {
      if (target.kind === 'user') {
        suspended
          ? await reactivateUserAction(target.id)
          : await suspendUserAction(target.id);
      } else {
        suspended
          ? await reactivateCompanyAction(target.id)
          : await suspendCompanyAction(target.id);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={
        suspended
          ? 'rounded-[8px] border border-pv-green-500/40 bg-pv-green-50 px-3 py-1 text-[12px] font-semibold text-pv-green-500 hover:brightness-95 disabled:opacity-50'
          : 'rounded-[8px] border border-pv-red-500/40 bg-pv-red-50 px-3 py-1 text-[12px] font-semibold text-pv-red-500 hover:brightness-95 disabled:opacity-50'
      }
    >
      {pending ? '...' : suspended ? 'Riattiva' : 'Sospendi'}
    </button>
  );
}
