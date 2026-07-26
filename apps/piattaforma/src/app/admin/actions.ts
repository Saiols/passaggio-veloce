'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { tickAllPraticheInDistribuzione } from '@/lib/distribuzione';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

export async function runDistribuzioneTickAction(): Promise<void> {
  const session = await auth();
  if (!isAdminOrAssistente(session?.user?.role)) {
    redirect('/dashboard');
  }

  const result = await tickAllPraticheInDistribuzione();
  // `riprese` va tenuto in fila con gli altri: è l'unica osservabilità manuale
  // della ripresa da zona non coperta. Dimenticarlo qui non rompe niente, ma
  // fa leggere all'admin "Anelli espansi: 0 · Zona non coperta: 0" dopo un tick
  // che ha appena rimesso in gara delle pratiche.
  const params = new URLSearchParams({
    tick: '1',
    scanned: String(result.scanned),
    expanded: String(result.expanded),
    riprese: String(result.riprese),
    zonaNonCoperta: String(result.zonaNonCoperta),
  });

  revalidatePath('/dashboard');
  revalidatePath('/admin/pratiche');
  revalidatePath('/admin/escalation');
  redirect(`/dashboard?${params.toString()}`);
}
