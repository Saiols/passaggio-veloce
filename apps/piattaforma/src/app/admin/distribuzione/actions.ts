'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import {
  configDistribuzioneSchema,
  toConfigPersistita,
  type ConfigDistribuzioneInput,
} from './validate';

export type SalvaConfigDistribuzioneResult = { ok: true } | { ok: false; error: string };

/**
 * Salva i parametri di raggio e tempo nella riga singleton
 * `distribuzione_config`. Solo ADMIN_PIATTAFORMA (stesso gate di
 * `/admin/tariffe` e `/admin/monitoraggio`).
 *
 * L'input arriva in km e ore (le unità del form) e viene convertito in metri e
 * minuti da `toConfigPersistita` DOPO la validazione: i limiti e i messaggi
 * d'errore restano espressi nelle unità che l'admin vede.
 *
 * `getDistribuzioneConfig` è avvolta in React `cache()`: dedup SOLO
 * per-request, nessuna cache persistente da invalidare. Il prossimo request
 * (dopo `revalidatePath`) rilegge già il valore fresco dal DB — stesso pattern
 * di `salvaTariffarioAction`.
 */
export async function salvaConfigDistribuzione(
  input: ConfigDistribuzioneInput,
): Promise<SalvaConfigDistribuzioneResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: 'Solo Admin Piattaforma può modificare la configurazione di distribuzione',
    };
  }

  const parsed = configDistribuzioneSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? 'Dati non validi' };
  }

  const data = toConfigPersistita(parsed.data);

  await prisma.distribuzioneConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
  });

  revalidatePath('/admin/distribuzione');
  return { ok: true };
}
