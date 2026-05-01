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
  const params = new URLSearchParams({
    tick: '1',
    scanned: String(result.scanned),
    timeouts: String(result.timeoutsMarked),
    advanced: String(result.roundsAdvanced),
    escalated: String(result.escalated),
  });

  revalidatePath('/dashboard');
  revalidatePath('/admin/pratiche');
  revalidatePath('/admin/escalation');
  redirect(`/dashboard?${params.toString()}`);
}
