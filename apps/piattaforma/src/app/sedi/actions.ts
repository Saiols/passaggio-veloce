'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export type SedeActionResult = { ok: true } | { ok: false; error: string };

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function genReferralCode(): string {
  let c = '';
  for (let i = 0; i < 8; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** Crea una nuova sede sotto l'azienda madre (solo proprietario). */
export async function createSedeAction(formData: FormData): Promise<SedeActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può aggiungere sedi' };
  }
  const companyId = session.user.companyId!;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { type: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };

  const nome = str(formData, 'nome');
  const indirizzo = str(formData, 'indirizzo');
  const citta = str(formData, 'citta');
  const cap = str(formData, 'cap');
  const provincia = str(formData, 'provincia').toUpperCase();
  if (!nome || !indirizzo || !citta || !cap || !provincia) {
    return { ok: false, error: 'Nome, indirizzo, città, CAP e provincia sono obbligatori' };
  }
  if (provincia.length !== 2) return { ok: false, error: 'Provincia: sigla di 2 lettere (es. VE)' };

  const iban = str(formData, 'iban') || null;
  if (iban && !/^IT\d{2}[A-Z0-9]{1,30}$/i.test(iban)) {
    return { ok: false, error: 'IBAN italiano non valido' };
  }
  const civico = str(formData, 'civico') || null;
  const telefono = str(formData, 'telefono') || null;
  const email = str(formData, 'email') || null;

  // referralCode univoco con retry su collisione.
  let referralCode = genReferralCode();
  for (let i = 0; i < 5; i++) {
    const collision = await prisma.sede.findUnique({
      where: { referralCode },
      select: { id: true },
    });
    if (!collision) break;
    referralCode = genReferralCode();
  }

  await prisma.sede.create({
    data: {
      companyId,
      type: company.type,
      nome,
      indirizzo,
      civico,
      citta,
      cap,
      provincia,
      telefono,
      email,
      iban,
      referralCode,
    },
  });

  revalidatePath('/sedi');
  return { ok: true };
}

async function setSedeSuspended(sedeId: string, suspended: boolean): Promise<SedeActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può gestire le sedi' };
  }
  const companyId = session.user.companyId!;

  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { companyId: true },
  });
  if (!sede || sede.companyId !== companyId) {
    return { ok: false, error: 'Sede non trovata' };
  }

  await prisma.sede.update({
    where: { id: sedeId },
    data: { suspendedAt: suspended ? new Date() : null },
  });
  revalidatePath('/sedi');
  return { ok: true };
}

export async function suspendSedeAction(sedeId: string): Promise<SedeActionResult> {
  return setSedeSuspended(sedeId, true);
}

export async function reactivateSedeAction(sedeId: string): Promise<SedeActionResult> {
  return setSedeSuspended(sedeId, false);
}
