'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { env } from '@/env';
import { isOwner } from '@/lib/auth/permissions';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { getEmail } from '@/lib/providers/email';
import { getStorage } from '@/lib/providers/storage';
import { generaCodiceOtp, otpScaduto, OTP_TTL_MS } from '@/lib/contratti/otp';
import { buildMandatoFatturazionePdf } from '@/lib/contratti/mandato-pdf';
import { tplOtpMandato } from '@/lib/auth/email-templates';
import { pvEmittente, snapshotCompany } from '@/lib/fatturazione/pv-emittente';

type Esito = { ok: true } | { ok: false; error: string };

async function utenteTitolare() {
  const session = await auth();
  const u = session?.user;
  if (!u || !u.companyId) return null;
  if (!isOwner(u.role as string)) return null;
  return { id: u.id as string, email: u.email as string, companyId: u.companyId as string };
}

/** Genera e invia un codice OTP all'email del titolare per firmare il mandato. */
export async function inviaOtpMandatoAction(): Promise<Esito> {
  const u = await utenteTitolare();
  if (!u) return { ok: false, error: 'Solo il titolare può firmare il mandato' };

  const codice = generaCodiceOtp();
  const hash = await hashPassword(codice);
  await prisma.user.update({
    where: { id: u.id },
    data: { mandatoOtpHash: hash, mandatoOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  const content = tplOtpMandato({ codice });
  await getEmail().send({
    to: u.email,
    from: env.EMAIL_FROM,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tag: 'OTP_MANDATO',
  });
  return { ok: true };
}

/** Verifica l'OTP, genera il PDF del mandato, lo salva e crea il record firmato. */
export async function firmaMandatoAction(codice: string): Promise<Esito> {
  const u = await utenteTitolare();
  if (!u) return { ok: false, error: 'Solo il titolare può firmare il mandato' };

  // Idempotente: se già firmato, ok.
  const esistente = await prisma.mandatoFatturazione.findUnique({
    where: { companyId: u.companyId },
    select: { id: true },
  });
  if (esistente) {
    revalidatePath('/wallet');
    return { ok: true };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: u.id },
    select: { nome: true, cognome: true, mandatoOtpHash: true, mandatoOtpExpiresAt: true },
  });
  if (!dbUser?.mandatoOtpHash || otpScaduto(dbUser.mandatoOtpExpiresAt)) {
    return { ok: false, error: 'Codice scaduto: richiedine uno nuovo' };
  }
  if (!(await verifyPassword(codice.trim(), dbUser.mandatoOtpHash))) {
    return { ok: false, error: 'Codice non valido' };
  }

  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: {
      ragioneSociale: true,
      partitaIva: true,
      codiceSdi: true,
      pec: true,
      indirizzo: true,
      cap: true,
      citta: true,
      provincia: true,
    },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };

  const mandante = snapshotCompany(company);
  const mandatario = pvEmittente();
  const rappresentante = `${dbUser.nome ?? ''} ${dbUser.cognome ?? ''}`.trim();
  const pvRappresentante = process.env.PV_RAPPRESENTANTE ?? 'Andrea Saino';
  const foro = mandatario.citta || 'Milano';
  const firmatoAt = new Date();

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip');

  const pdfBytes = await buildMandatoFatturazionePdf({
    mandante,
    mandanteRappresentante: rappresentante,
    mandatario,
    mandatarioRappresentante: pvRappresentante,
    foro,
    firmatoAt,
    otpAudit: { ip: ip ?? null },
  });

  const stored = await getStorage().put({
    scope: 'mandati',
    buffer: Buffer.from(pdfBytes),
    mimeType: 'application/pdf',
    originalFilename: `mandato-fatturazione-${u.companyId}.pdf`,
  });

  await prisma.mandatoFatturazione.create({
    data: {
      companyId: u.companyId,
      firmatarioUserId: u.id,
      firmatoAt,
      storageKey: stored.storageKey,
      storageProvider: stored.storageProvider,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      datiSnapshot: {
        mandante,
        mandatario,
        firmatario: { nome: dbUser.nome, cognome: dbUser.cognome },
        foro,
      },
      ip: ip ?? null,
      userAgent: hdrs.get('user-agent'),
      otpVerificatoAt: firmatoAt,
    },
  });

  // Consuma l'OTP.
  await prisma.user.update({
    where: { id: u.id },
    data: { mandatoOtpHash: null, mandatoOtpExpiresAt: null },
  });
  revalidatePath('/wallet');
  return { ok: true };
}
