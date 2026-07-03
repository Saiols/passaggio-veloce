'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { validateTariffaInput, type TariffaFormInput } from './validate';

export type SalvaTariffarioResult = { ok: true } | { ok: false; error: string };

export async function salvaTariffarioAction(
  input: TariffaFormInput & { note?: string },
): Promise<SalvaTariffarioResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo Admin Piattaforma può modificare le tariffe' };
  }
  const parsed = validateTariffaInput(input);
  if (!parsed.ok) return parsed;

  await prisma.$transaction([
    prisma.tariffaPiattaforma.updateMany({ where: { attivo: true }, data: { attivo: false } }),
    prisma.tariffaPiattaforma.create({
      data: {
        ...parsed.cents,
        attivo: true,
        note: input.note?.trim() || null,
        createdById: session.user.id,
      },
    }),
  ]);

  // La freschezza dei bot è già garantita (getTariffarioCorrente non è cacheata);
  // revalidiamo le pagine che mostrano importi derivati.
  revalidatePath('/admin/tariffe');
  revalidatePath('/affiliazione');
  return { ok: true };
}
