'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { firmaPraticaCore } from '@/lib/pratiche/firma-engine';
import type { QuickActionResult } from '@/lib/pratiche/quick-action';

/**
 * Attestazione della firma da parte del Gestore (Termini, art. 11).
 *
 * Produce ESATTAMENTE gli stessi effetti della firma segnalata dall'agenzia —
 * addebito, fattura, credito al broker, payout — perché usa lo stesso motore
 * (`firmaPraticaCore`). Cambia solo l'attore, e che restiamo tracciati: chi,
 * quando, perché (il motore scrive `firmaForzataDaId`/`At`/`Motivo` leggendo
 * l'autore SEMPRE da `session.user.id`, mai da un parametro — vedi il
 * commento su `AttoreFirma` in firma-engine.ts).
 *
 * Riservata ad ADMIN_PIATTAFORMA: l'ASSISTENTE non ha leve finanziarie
 * (decisione D-02) e questa azione ne muove — addebito all'agenzia, credito
 * al broker.
 */
export async function attestaFirmaAdminAction(
  praticaId: string,
  motivo: string,
): Promise<QuickActionResult> {
  const session = await auth();
  if (!isAdminPiattaforma(session?.user?.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  if (!motivo.trim()) {
    return { ok: false, error: 'La motivazione è obbligatoria' };
  }

  const res = await firmaPraticaCore(praticaId, { tipo: 'ADMIN', motivo });
  if (!res.ok) return res;

  revalidatePath('/admin/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}
