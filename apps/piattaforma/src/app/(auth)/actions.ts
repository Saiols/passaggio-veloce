'use server';

import { AuthError } from 'next-auth';
import { Prisma } from '@pv/db';
import { prisma } from '@pv/db';

import { signIn, signOut } from '@/auth';
import { env } from '@/env';
import { hashPassword } from '@/lib/auth/password';
import { generateSecureToken, expiresIn } from '@/lib/auth/tokens';
import { headers } from 'next/headers';
import { tryMatchCrmContact } from '@/lib/crm/sync';
import { notifyReferralSignup } from '@/lib/affiliazione/notifications';
import { anonymizeIp } from '@/lib/net/ip';
import { checkRateLimit, resetRateLimit } from '@/lib/auth/rate-limit';
import { loginSchema, registerFullSchema } from '@/lib/auth/schemas';
import { randomUUID } from 'node:crypto';
import { getStorage } from '@/lib/providers/storage';
import { getRegistroImprese } from '@/lib/providers/registro-imprese';
import {
  validateRegistrationDocuments,
  type RegistrationDocInput,
} from '@/lib/auth/document-validation';

// ============================================================
// LOGIN
// ============================================================

export type LoginActionState = {
  error?: string;
};

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: 'Email o password non valide' };
  }

  // A9 rate limit: chiave per IP+email, 5 tentativi / 15 min poi 15 min block
  const hdrs = await headers();
  const ipRaw = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? '';
  const ip = anonymizeIp(ipRaw) ?? 'unknown';
  const emailLower = parsed.data.email.toLowerCase();
  const rateKey = `login:${ip}:${emailLower}`;
  const rl = checkRateLimit(rateKey);
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return {
      error: `Troppi tentativi. Riprova tra ${minutes} minut${minutes === 1 ? 'o' : 'i'}.`,
    };
  }

  try {
    await signIn('credentials', {
      email: emailLower,
      password: parsed.data.password,
      redirectTo: '/dashboard',
    });
    resetRateLimit(rateKey);
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Credenziali non valide' };
    }
    throw error;
  }
}

// ============================================================
// LOGOUT
// ============================================================

export async function logoutAction() {
  await signOut({ redirectTo: '/login' });
}

// ============================================================
// REGISTER
// ============================================================

const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB

// Slot file attesi nel FormData del wizard (step 3). chiave === DocumentoTipo.
const REGISTRATION_DOC_SLOTS = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'VISURA_CAMERALE',
] as const;

export type RegisterActionResult =
  | { ok: true; emailVerificationToken: string }
  | { ok: false; error: string; field?: string };

// FASE 13 affiliazione: codice referral 8 char alfanumerico minuscolo,
// generato on-register. Unique constraint sullo schema; in caso di collisione
// (probabilità ~1/2.8e12) ritentiamo.
function generateReferralCode(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

export async function registerAction(
  formData: FormData,
): Promise<RegisterActionResult> {
  // 1. Parse del payload strutturato (account/company/payment/referral/visura).
  const payloadRaw = formData.get('payload');
  if (typeof payloadRaw !== 'string') {
    return { ok: false, error: 'Dati di registrazione mancanti' };
  }
  let payloadObj: unknown;
  try {
    payloadObj = JSON.parse(payloadRaw);
  } catch {
    return { ok: false, error: 'Dati di registrazione non validi' };
  }

  const parsed = registerFullSchema.safeParse(payloadObj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? 'Dati non validi',
      field: first?.path.join('.'),
    };
  }

  const visuraData =
    typeof (payloadObj as { visuraData?: unknown }).visuraData === 'string'
      ? (payloadObj as { visuraData: string }).visuraData
      : '';
  const refCodeFromPayload =
    typeof (payloadObj as { referralCode?: unknown }).referralCode === 'string'
      ? (payloadObj as { referralCode: string }).referralCode
      : undefined;

  // 2. Estrai i 4 file obbligatori dal FormData.
  const docFiles: { tipo: (typeof REGISTRATION_DOC_SLOTS)[number]; file: File }[] = [];
  for (const slot of REGISTRATION_DOC_SLOTS) {
    const f = formData.get(slot);
    if (!(f instanceof File) || f.size === 0) {
      return { ok: false, error: 'Carica tutti i documenti richiesti' };
    }
    if (f.size > MAX_DOC_BYTES) {
      return { ok: false, error: 'Un documento supera il limite di 10 MB' };
    }
    docFiles.push({ tipo: slot, file: f });
  }

  // 3. Validazione documenti (gating rule-based + visura ≤ 6 mesi). Bloccante.
  const docInputs: RegistrationDocInput[] = docFiles.map(({ tipo, file }) => ({
    tipo,
    mimeType: file.type,
    sizeBytes: file.size,
    originalFilename: file.name,
  }));
  const docCheck = validateRegistrationDocuments(docInputs, visuraData);
  if (!docCheck.ok) {
    return { ok: false, error: docCheck.error };
  }

  const { account, company, payment } = parsed.data;
  const refCodeInput = refCodeFromPayload?.trim().toLowerCase();

  // Lookup referente (silente: se codice invalido, registrazione procede senza)
  let referenteId: string | null = null;
  if (refCodeInput) {
    const referente = await prisma.company.findUnique({
      where: { referralCode: refCodeInput },
      select: { id: true, deletedAt: true, suspendedAt: true },
    });
    if (referente && !referente.deletedAt && !referente.suspendedAt) {
      referenteId = referente.id;
    }
  }

  const emailLower = account.email.toLowerCase();

  // Multi-tenancy email scope-company (item 07 release 2026-05): la stessa
  // email puo' registrarsi in piu' aziende (stesso utente come dealer e come
  // agenzia, o consulente esterno con piu' clienti). Qui blocchiamo solo se
  // collide con un admin platform (companyId=null) per evitare ambiguita'
  // di login con account amministrativi.
  const existingAdmin = await prisma.user.findFirst({
    where: { email: emailLower, companyId: null },
  });
  if (existingAdmin) {
    return { ok: false, error: 'Email gia registrata', field: 'account.email' };
  }

  const existingCompany = await prisma.company.findUnique({
    where: { partitaIva: company.partitaIva },
  });
  if (existingCompany) {
    return {
      ok: false,
      error: 'P.IVA gia registrata',
      field: 'company.partitaIva',
    };
  }

  const passwordHash = await hashPassword(account.password);
  const verificationToken = generateSecureToken();

  // AF-AC: cattura IP signup (anonymizzato GDPR) per il check anti-collusione.
  const hdrs = await headers();
  const signupIpRaw =
    hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? null;
  const signupIp = anonymizeIp(signupIpRaw);

  // Pre-generiamo gli id così lo scope storage coincide col companyId e i
  // Documento possono referenziare l'uploader (User) nella stessa transaction.
  const companyId = randomUUID();
  const userId = randomUUID();

  // Upload dei file su storage PRIMA della transaction (filesystem/S3 sono
  // fuori dalla transaction DB). Se un put fallisce l'eccezione interrompe
  // tutto: nessun record creato. In caso di fallimento della transaction
  // restano al massimo file orfani su storage (raro, ripulibili).
  const storage = getStorage();
  const storedDocs = await Promise.all(
    docFiles.map(async ({ tipo, file }) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const put = await storage.put({
        scope: `company/${companyId}`,
        buffer,
        originalFilename: file.name,
        mimeType: file.type,
      });
      return { tipo, put };
    }),
  );

  let createdCompanyId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Genera codice referral con retry su collisione (rarissima ma possibile).
      let referralCode = generateReferralCode();
      for (let i = 0; i < 5; i++) {
        const collision = await tx.company.findUnique({
          where: { referralCode },
          select: { id: true },
        });
        if (!collision) break;
        referralCode = generateReferralCode();
      }

      const createdCompany = await tx.company.create({
        data: {
          id: companyId,
          type: company.type,
          ragioneSociale: company.ragioneSociale,
          partitaIva: company.partitaIva,
          codiceSdi: company.codiceSdi || null,
          pec: company.pec,
          email: company.email,
          telefono: company.telefono || null,
          indirizzo: company.indirizzo,
          citta: company.citta,
          cap: company.cap,
          provincia: company.provincia.toUpperCase(),
          iban: payment.iban,
          sepaMandateAccepted: true,
          sepaMandateAcceptedAt: new Date(),
          termsAcceptedAt: new Date(),
          referralCode,
          referenteId,
          signupIp,
          visuraCameraleData: new Date(visuraData),
        },
      });

      await tx.user.create({
        data: {
          id: userId,
          email: emailLower,
          passwordHash,
          nome: account.nome,
          cognome: account.cognome,
          codiceFiscale: account.codiceFiscale,
          dataNascita: account.dataNascita,
          luogoNascita: account.luogoNascita,
          role: 'ADMIN_AZIENDA',
          status: 'PENDING_EMAIL_VERIFICATION',
          companyId: createdCompany.id,
        },
      });

      await tx.verificationToken.create({
        data: {
          token: verificationToken,
          type: 'EMAIL_VERIFICATION',
          email: emailLower,
          expiresAt: expiresIn(24),
        },
      });

      for (const { tipo, put } of storedDocs) {
        await tx.documento.create({
          data: {
            tipo,
            companyId,
            storageKey: put.storageKey,
            storageProvider: put.storageProvider,
            mimeType: put.mimeType,
            sizeBytes: put.sizeBytes,
            originalFilename: put.originalFilename,
            uploadedById: userId,
            ocrStato: 'NONE',
            gatingStato: 'PASSED',
          },
        });
      }

      createdCompanyId = companyId;
    });

    // CRM-G: match best-effort post-iscrizione (Caso A: contatto lead
    // pre-esistente → aggancia + auto-promote a S7). Non deve bloccare
    // il flusso registrazione in caso di errore.
    if (createdCompanyId) {
      void tryMatchCrmContact(createdCompanyId);
      // AF-N: se il nuovo iscritto ha un referenteId, notifica al referente
      // (template N22 Referral Signup).
      void notifyReferralSignup(createdCompanyId);
    }

    // RegistroImprese (predisposizione swap): lookup best-effort non bloccante.
    // Col provider mock è di fatto un no-op informativo; quando l'account
    // esterno sarà attivo qui si potrà validare/arricchire i dati azienda.
    void Promise.resolve()
      .then(() => getRegistroImprese().lookupByPiva({ partitaIva: company.partitaIva }))
      .then((reg) => {
        if (reg) console.info('[registro-imprese] lookup', reg.partitaIva, reg.statoAttivita);
      })
      .catch((e) => console.warn('[registro-imprese] lookup fallito', e));

    if (env.DEMO_MODE) {
      await prisma.$transaction(async (tx) => {
        await tx.verificationToken.update({
          where: { token: verificationToken },
          data: { usedAt: new Date() },
        });
        // Multi-tenancy: colpisce solo il record con stato PENDING (quello
        // appena creato in questo flusso). Gli altri eventuali account con la
        // stessa email sono gia' ACTIVE.
        await tx.user.updateMany({
          where: { email: emailLower, status: 'PENDING_EMAIL_VERIFICATION' },
          data: {
            emailVerifiedAt: new Date(),
            status: 'ACTIVE',
          },
        });
      });
    }

    // TODO Fase 6: inviare email di verifica via Resend con link
    // /verify-email?token=verificationToken
    // Per ora ritorniamo il token cosi e' visibile in dev.

    return { ok: true, emailVerificationToken: verificationToken };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Dato gia esistente' };
    }
    throw error;
  }
}

// ============================================================
// VERIFY EMAIL
// ============================================================

export type VerifyEmailResult = { ok: true } | { ok: false; error: string };

export async function verifyEmailAction(token: string): Promise<VerifyEmailResult> {
  if (!token) return { ok: false, error: 'Token mancante' };

  const record = await prisma.verificationToken.findUnique({ where: { token } });

  if (!record) return { ok: false, error: 'Token non valido' };
  if (record.usedAt) return { ok: false, error: 'Token gia usato' };
  if (record.expiresAt < new Date()) return { ok: false, error: 'Token scaduto' };
  if (record.type !== 'EMAIL_VERIFICATION') {
    return { ok: false, error: 'Token non valido per questa azione' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    await tx.user.updateMany({
      where: { email: record.email, status: 'PENDING_EMAIL_VERIFICATION' },
      data: {
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
  });

  return { ok: true };
}

// ============================================================
// PASSWORD RESET — REQUEST
// ============================================================

export type RequestPasswordResetResult =
  | { ok: true; demoToken?: string }
  | { ok: false; error: string };

export async function requestPasswordResetAction(
  email: string,
): Promise<RequestPasswordResetResult> {
  if (!email || typeof email !== 'string') {
    return { ok: false, error: 'Email non valida' };
  }

  const emailLower = email.toLowerCase().trim();
  // Multi-tenancy: con stessa email su piu' User, mandiamo email reset agli
  // admin platform per primi (priorita' di sicurezza), altrimenti al primo
  // utente in ordine createdAt. Il token si lega a email e tutti gli account
  // con quell'email potranno essere ripristinati condividendo la nuova
  // password (caso raro multi-account: l'utente sceglie poi quale loggare).
  const user = await prisma.user.findFirst({
    where: { email: emailLower, deletedAt: null },
    orderBy: [{ companyId: 'asc' }, { createdAt: 'asc' }],
  });

  // Per privacy, ritorniamo ok anche se l'utente non esiste (no enumeration)
  if (!user) {
    return { ok: true };
  }

  const token = generateSecureToken();
  await prisma.verificationToken.create({
    data: {
      token,
      type: 'PASSWORD_RESET',
      email: emailLower,
      expiresAt: expiresIn(2),
    },
  });

  // Invia email via provider
  const { getEmail } = await import('@/lib/providers/email');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${appUrl}/reset-password?token=${token}`;
  await getEmail().send({
    to: emailLower,
    subject: 'Passaggio Veloce — Reimposta la tua password',
    html: `
      <p>Ciao,</p>
      <p>Hai richiesto di reimpostare la password del tuo account Passaggio Veloce.</p>
      <p>Clicca qui per impostare una nuova password (link valido 2 ore):</p>
      <p><a href="${link}">${link}</a></p>
      <p>Se non sei stato tu, ignora questa email.</p>
    `,
    text: `Reimposta password: ${link}`,
    tag: 'password-reset',
  });

  return env.DEMO_MODE ? { ok: true, demoToken: token } : { ok: true };
}

// ============================================================
// PASSWORD RESET — CONFIRM
// ============================================================

export type ConfirmPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string };

export async function confirmPasswordResetAction(
  token: string,
  newPassword: string,
): Promise<ConfirmPasswordResetResult> {
  if (!token) return { ok: false, error: 'Token mancante' };
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: 'Password troppo corta (min 8 caratteri)' };
  }
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return {
      ok: false,
      error: 'La password deve contenere maiuscole, minuscole e numeri',
    };
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record) return { ok: false, error: 'Token non valido' };
  if (record.usedAt) return { ok: false, error: 'Token già usato' };
  if (record.expiresAt < new Date()) return { ok: false, error: 'Token scaduto' };
  if (record.type !== 'PASSWORD_RESET') {
    return { ok: false, error: 'Token non valido per questa azione' };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // Multi-tenancy: la stessa email puo' avere piu' User record. Quando
    // l'utente reimposta la password, la propaghiamo a tutti i suoi account
    // (l'identita' fisica e' la stessa, e' come un "single sign-on" dal punto
    // di vista del recupero credenziali).
    await tx.user.updateMany({
      where: { email: record.email, deletedAt: null },
      data: { passwordHash },
    });
  });

  return { ok: true };
}
