'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canRunCrmReconciliation } from '@/lib/auth/permissions';
import { riconciliaTutto } from '@/lib/crm/match/apply';

export type EsitoRiconciliazione =
  | { ok: true; agganciati: number; errori: number }
  | { ok: false; error: string };

/**
 * Applica la riconciliazione. Le proposte si ricalcolano qui: quelle mostrate
 * in anteprima non tornano indietro dal client, così non c'è modo di far
 * agganciare al server una coppia che l'algoritmo non avrebbe scelto.
 */
export async function applicaRiconciliazioneAction(): Promise<EsitoRiconciliazione> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canRunCrmReconciliation(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per la riconciliazione CRM' };
  }

  const esito = await riconciliaTutto();
  revalidatePath('/admin/crm/riconciliazione');
  revalidatePath('/admin/crm/contatti');
  revalidatePath('/admin/crm/dashboard');
  return { ok: true, agganciati: esito.agganciati, errori: esito.errori };
}
