'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { requireOperativita } from '@/lib/auth/sospensione-guard';

export type UpdateCompanyResult = { ok: true } | { ok: false; error: string };

const updateSchema = z.object({
  ragioneSociale: z.string().trim().min(2).max(160),
  codiceSdi: z.string().trim().max(7).optional().or(z.literal('')),
  pec: z.string().trim().email('PEC non valida'),
  email: z.string().trim().email('Email non valida'),
  telefono: z.string().trim().max(30).optional().or(z.literal('')),
  indirizzo: z.string().trim().min(2).max(200),
  citta: z.string().trim().min(1).max(80),
  cap: z.string().regex(/^\d{5}$/, 'CAP non valido'),
  provincia: z
    .string()
    .trim()
    .length(2, 'Provincia 2 lettere')
    .transform((s) => s.toUpperCase()),
  iban: z.string().trim().max(34).optional().or(z.literal('')),
});

/**
 * Aggiorna i dati editabili dell'azienda dell'admin loggato (C-04).
 * Partita IVA NON è modificabile (richiede flow legale dedicato).
 */
export async function updateCompanyProfileAction(
  formData: FormData,
): Promise<UpdateCompanyResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può modificare il profilo" };
  }
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };
  const companyId = session.user.companyId;
  if (!companyId) return { ok: false, error: 'Account non associato a un\'azienda' };

  const raw = Object.fromEntries(formData.entries());
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const msg = first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi';
    return { ok: false, error: msg };
  }
  const d = parsed.data;

  await prisma.company.update({
    where: { id: companyId },
    data: {
      ragioneSociale: d.ragioneSociale,
      codiceSdi: d.codiceSdi || null,
      pec: d.pec.toLowerCase(),
      email: d.email.toLowerCase(),
      telefono: d.telefono || null,
      indirizzo: d.indirizzo,
      citta: d.citta,
      cap: d.cap,
      provincia: d.provincia,
      iban: d.iban ? d.iban.toUpperCase() : null,
    },
  });

  revalidatePath('/profilo');
  revalidatePath('/profilo/azienda');
  return { ok: true };
}
