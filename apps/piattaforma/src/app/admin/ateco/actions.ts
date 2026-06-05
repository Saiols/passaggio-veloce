'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CompanyType } from '@pv/db';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { normalizeAteco } from '@/lib/kyc/ateco';

export type AtecoActionResult = { ok: true } | { ok: false; error: string };

export async function createAtecoAction(input: {
  companyType: CompanyType;
  code: string;
  label?: string;
}): Promise<AtecoActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo Admin Piattaforma può gestire i codici ATECO' };
  }
  const code = normalizeAteco(input.code ?? '');
  if (!code) return { ok: false, error: 'Codice ATECO obbligatorio' };
  const label = input.label?.trim() || null;

  await prisma.atecoAllowedCode.upsert({
    where: { companyType_code: { companyType: input.companyType, code } },
    create: {
      companyType: input.companyType,
      code,
      label,
      active: true,
      createdById: session.user.id,
    },
    update: { label, active: true },
  });
  revalidatePath('/admin/ateco');
  return { ok: true };
}

export async function toggleAtecoAction(id: string, active: boolean): Promise<AtecoActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  await prisma.atecoAllowedCode.update({ where: { id }, data: { active } });
  revalidatePath('/admin/ateco');
  return { ok: true };
}
