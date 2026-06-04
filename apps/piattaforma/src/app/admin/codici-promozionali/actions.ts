'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { normalizePromoCode } from '@/lib/promo/evaluate';

export type CreatePromoResult = { ok: true } | { ok: false; error: string };

export async function createPromoCodeAction(input: {
  code: string;
  amountEuro: number;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
}): Promise<CreatePromoResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo Admin Piattaforma può creare codici promozionali' };
  }
  const code = normalizePromoCode(input.code ?? '');
  if (!code) return { ok: false, error: 'Codice obbligatorio' };
  const amountCent = Math.round(Number(input.amountEuro) * 100);
  if (!Number.isFinite(amountCent) || amountCent <= 0) return { ok: false, error: 'Importo non valido' };

  const exists = await prisma.promoCode.findUnique({ where: { code } });
  if (exists) return { ok: false, error: 'Codice già esistente' };

  await prisma.promoCode.create({
    data: {
      code,
      amountCent,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      maxRedemptions: input.maxRedemptions && input.maxRedemptions > 0 ? Math.floor(input.maxRedemptions) : null,
      createdById: session.user.id,
    },
  });
  revalidatePath('/admin/codici-promozionali');
  return { ok: true };
}

export async function togglePromoCodeAction(id: string, active: boolean): Promise<CreatePromoResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  await prisma.promoCode.update({ where: { id }, data: { active } });
  revalidatePath('/admin/codici-promozionali');
  return { ok: true };
}
