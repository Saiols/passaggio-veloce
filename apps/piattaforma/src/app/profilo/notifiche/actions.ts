'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { OPTIONAL_TIPI } from '@/lib/notifiche/preferences';

export async function updateNotifPrefsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const prefs: Record<string, boolean> = {};
  for (const tipo of OPTIONAL_TIPI) {
    prefs[tipo] = formData.get(tipo) === 'on';
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { notifPrefs: prefs },
  });
  revalidatePath('/profilo/notifiche');
}
