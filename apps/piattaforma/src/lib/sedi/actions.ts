'use server';

import { cookies } from 'next/headers';
import { getSessionContext, SEDE_COOKIE } from '@/lib/auth/session-context';
import { canSelectSede } from './scope';

export type SetCurrentSedeResult = { ok: boolean; error?: string };

/**
 * Imposta la sede operativa corrente nel cookie `pv_sede`.
 * `target` = id di una sede accessibile, oppure 'ALL' (solo proprietario).
 * Valida sempre l'accesso server-side prima di scrivere il cookie.
 */
export async function setCurrentSedeAction(target: string): Promise<SetCurrentSedeResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: 'Non autenticato' };

  if (!canSelectSede(target, { isOwner: ctx.isOwner, accessibleSedi: ctx.accessibleSedi })) {
    return { ok: false, error: 'Sede non accessibile' };
  }

  (await cookies()).set(SEDE_COOKIE, target, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
