import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session-context';
import { can, type PermessiCtx } from './check';
import type { Permesso } from './catalogo';

/** Il contesto ridotto che serve a `can()`. Null se non autenticato. */
export async function permessiCtx(): Promise<PermessiCtx | null> {
  const ctx = await getSessionContext();
  if (!ctx?.user) return null;
  return { userId: ctx.user.id, isOwner: ctx.isOwner, permessi: ctx.permessi };
}

export async function hasPermesso(p: Permesso): Promise<boolean> {
  const ctx = await permessiCtx();
  if (!ctx) return false;
  return can(ctx, p);
}

/** Gate per le server action: ritorna un result, non lancia. */
export async function requirePermesso(
  p: Permesso,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await hasPermesso(p)) return { ok: true };
  return { ok: false, error: 'Non hai i permessi per questa azione' };
}

/** Gate per le pagine: rimanda alla dashboard. */
export async function assertPermesso(p: Permesso): Promise<void> {
  if (!(await hasPermesso(p))) redirect('/dashboard');
}
