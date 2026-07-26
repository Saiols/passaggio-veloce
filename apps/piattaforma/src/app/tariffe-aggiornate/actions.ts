'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { requireOperativita } from '@/lib/auth/sospensione-guard';
import { anonymizeIp } from '@/lib/net/ip';
import { getRiaccettazionePendente, registraRiaccettazione } from '@/lib/tariffe/riaccettazione';

export type RiaccettaResult = { ok: true } | { ok: false; error: string };

/**
 * Riaccettazione esplicita delle nuove condizioni economiche (clausola 3,
 * fascia b).
 *
 * Riservata all'ADMIN_AZIENDA: è un'accettazione contrattuale che vincola
 * l'intera azienda, non un'impostazione operativa. Un collaboratore con
 * accesso alla piattaforma non può impegnare il titolare su un prezzo.
 *
 * L'ID della tariffa NON arriva dal client: lo si rilegge dal server, così
 * nessuno può accettare una variazione diversa da quella effettivamente
 * pendente inviando un id a mano.
 */
export async function riaccettaTariffaAction(): Promise<RiaccettaResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const companyId = session.user.companyId;
  if (!companyId) return { ok: false, error: 'Azienda non associata' };
  if (!isOwner(session.user.role)) {
    return {
      ok: false,
      error:
        'Solo il titolare dell’account può accettare le nuove condizioni economiche: è un impegno contrattuale dell’azienda.',
    };
  }

  // Sospensione (clausola 12.3) = sola lettura: un account sospeso non firma
  // impegni contrattuali. Non è un vicolo cieco — la sospensione si risolve
  // col riesame, e solo dopo ha senso riprendere a lavorare pratiche.
  const op = await requireOperativita();
  if (!op.ok) return op;

  const pendente = await getRiaccettazionePendente(companyId);
  if (!pendente) return { ok: true }; // già accettata (o non più dovuta): idempotente

  const h = await headers();
  await registraRiaccettazione({
    companyId,
    tariffaId: pendente.tariffaId,
    userId: session.user.id,
    ip: anonymizeIp(h.get('x-forwarded-for')),
    userAgent: h.get('user-agent'),
  });

  revalidatePath('/tariffe-aggiornate');
  revalidatePath('/pratiche/nuova');
  revalidatePath('/inbox');
  return { ok: true };
}
