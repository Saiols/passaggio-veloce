'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  type TotpSetup,
} from '@/lib/auth/totp';

const CODE_SCHEMA = z.string().trim().regex(/^\d{6}$/);

/**
 * Genera un nuovo secret TOTP per l'utente loggato e ritorna l'URI
 * otpauth da renderizzare come QR code. Il secret NON viene salvato a
 * questo punto: serve prima la verifica con un codice valido (commit-once).
 */
export async function start2faSetupAction(): Promise<
  | { ok: true; setup: TotpSetup }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');

  const setup = generateTotpSecret(session.user.email);
  return { ok: true, setup };
}

/**
 * Conferma l'attivazione 2FA: salva secret + genera backup codes.
 * Il primo codice TOTP è la prova che l'utente ha effettivamente
 * scansionato il QR.
 */
export async function confirm2faSetupAction(
  secret: string,
  code: string,
): Promise<
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const codeOk = CODE_SCHEMA.safeParse(code);
  if (!codeOk.success) {
    return { ok: false, error: 'Il codice deve essere di 6 cifre.' };
  }

  if (!verifyTotpCode(secret, code)) {
    return {
      ok: false,
      error: 'Codice non valido. Verifica l\'orario del telefono e riprova.',
    };
  }

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: hashed,
    },
  });

  revalidatePath('/profilo/sicurezza');
  // Backup codes mostrati UNA SOLA VOLTA: poi non recuperabili
  return { ok: true, backupCodes };
}

export async function disable2faAction(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true, twoFactorEnabled: true },
  });
  if (!user || !user.twoFactorEnabled) {
    return { ok: false, error: '2FA non risulta attivo.' };
  }

  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: 'Password non corretta.' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: Prisma.JsonNull,
    },
  });

  revalidatePath('/profilo/sicurezza');
  return { ok: true };
}
