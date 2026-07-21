'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { getDistribuzioneConfig } from '@/lib/distribuzione/config';
import { configDistribuzioneSchema } from './validate';

export type SalvaConfigDistribuzioneResult = { ok: true } | { ok: false; error: string };

/**
 * Salva `raggioMaxM` nella riga singleton `distribuzione_config` (Task 10).
 * Solo ADMIN_PIATTAFORMA (stesso gate di `/admin/tariffe` e
 * `/admin/monitoraggio`).
 *
 * Cross-valida contro il `raggioStartM` corrente, letto da DB via
 * `getDistribuzioneConfig()` — non dal client — vedi il commento in
 * validate.ts sul perché.
 *
 * `getDistribuzioneConfig` è avvolta in React `cache()`: dedup SOLO
 * per-request, nessuna cache persistente da invalidare esplicitamente. Il
 * prossimo request (dopo `revalidatePath`) rilegge già il valore fresco dal
 * DB — stesso pattern di `salvaTariffarioAction`.
 */
export async function salvaConfigDistribuzione(
  raggioMaxM: number,
): Promise<SalvaConfigDistribuzioneResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: 'Solo Admin Piattaforma può modificare la configurazione di distribuzione',
    };
  }

  const corrente = await getDistribuzioneConfig();
  const parsed = configDistribuzioneSchema.safeParse({
    raggioMaxM,
    raggioStartM: corrente.raggioStartM,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Dati non validi' };
  }

  await prisma.distribuzioneConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', raggioMaxM: parsed.data.raggioMaxM },
    update: { raggioMaxM: parsed.data.raggioMaxM },
  });

  revalidatePath('/admin/distribuzione');
  return { ok: true };
}
