import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionContext, type SessionContext } from '@/lib/auth/session-context';
import { ERRORE_SOSPENSIONE } from '@/lib/auth/sospensione';
import { can, type PermessiCtx } from './check';
import { isLettura } from './sola-lettura';
import type { Permesso } from './catalogo';

/**
 * UNICO adattatore da `SessionContext` a `PermessiCtx`. Ogni sito di
 * produzione che chiama `can()` / `assignablePermessi()` / `validaPermessi()`
 * fuori da questo modulo deve passare da qui — un adattatore locale può
 * dimenticare `soloLettura` (è già successo: il modulo team ne aveva uno che
 * lasciava un titolare sospeso operativo su tutti i gate team).
 */
export function toPermessiCtx(ctx: SessionContext): PermessiCtx {
  return {
    userId: ctx.user.id,
    isOwner: ctx.isOwner,
    permessi: ctx.permessi,
    soloLettura: ctx.sospensione.sospeso,
  };
}

/** Il contesto ridotto che serve a `can()`. Null se non autenticato. */
export async function permessiCtx(): Promise<PermessiCtx | null> {
  const ctx = await getSessionContext();
  if (!ctx?.user) return null;
  return toPermessiCtx(ctx);
}

export async function hasPermesso(p: Permesso): Promise<boolean> {
  const ctx = await permessiCtx();
  if (!ctx) return false;
  return can(ctx, p);
}

/**
 * Gate per le server action: ritorna un result, non lancia.
 *
 * Quando il rifiuto viene dalla sospensione il messaggio è specifico: dire
 * «Non hai i permessi» a un utente che i permessi li ha lo manderebbe a
 * cercare un problema di permessi che non esiste.
 */
export async function requirePermesso(
  p: Permesso,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await permessiCtx();
  if (ctx && can(ctx, p)) return { ok: true };
  if (ctx?.soloLettura && !isLettura(p)) return { ok: false, error: ERRORE_SOSPENSIONE };
  return { ok: false, error: 'Non hai i permessi per questa azione' };
}

/** Gate per le pagine: rimanda alla dashboard. */
export async function assertPermesso(p: Permesso): Promise<void> {
  if (!(await hasPermesso(p))) redirect('/dashboard');
}
