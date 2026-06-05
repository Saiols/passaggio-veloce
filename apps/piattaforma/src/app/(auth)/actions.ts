'use server';

import { AuthError } from 'next-auth';
import bcrypt from 'bcryptjs';
import { Prisma } from '@pv/db';
import { prisma } from '@pv/db';

import { signIn, signOut } from '@/auth';
import { env } from '@/env';
import { hashPassword } from '@/lib/auth/password';
import { generateSecureToken, expiresIn } from '@/lib/auth/tokens';
import { headers, cookies } from 'next/headers';
import { tryMatchCrmContact } from '@/lib/crm/sync';
import { parseUtmCookie } from '@/lib/crm/utm';
import { notifyReferralSignup } from '@/lib/affiliazione/notifications';
import { anonymizeIp } from '@/lib/net/ip';
import { checkRateLimit, resetRateLimit } from '@/lib/auth/rate-limit';
import { activeUserCredentialsQuery } from '@/lib/auth/credentials-query';
import { loginSchema, registerFullSchema } from '@/lib/auth/schemas';
import { randomUUID } from 'node:crypto';
import { getStorage } from '@/lib/providers/storage';
import { getRegistroImprese } from '@/lib/providers/registro-imprese';
import {
  validateRegistrationDocuments,
  type RegistrationDocInput,
} from '@/lib/auth/document-validation';
import { evaluatePromoCode, normalizePromoCode, type PromoCheckResult } from '@/lib/promo/evaluate';
import { redeemPromoCode, type PromoRedeemResult } from '@/lib/promo/redeem';
import { verifyRegistrationKyc } from '@/lib/kyc/verify';

// ============================================================
// LOGIN
// ============================================================

export type LoginActionState = {
  error?: string;
  /** true quando la password è corretta ma serve il codice 2FA. */
  needTotp?: boolean;
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

  const totp = (formData.get('totp') as string | null)?.trim() || undefined;

  // Pre-check: individua l'utente la cui password combacia (mirror di authorize)
  // per capire se il 2FA è richiesto. Non logga: serve solo a decidere se
  // mostrare il campo codice. La password NON viene mai ritornata al client.
  const candidates = await prisma.user.findMany({
    ...activeUserCredentialsQuery(emailLower),
    select: { passwordHash: true, twoFactorEnabled: true },
  });
  let matched: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await bcrypt.compare(parsed.data.password, c.passwordHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
    return { error: 'Credenziali non valide' };
  }
  if (matched.twoFactorEnabled && !totp) {
    return { needTotp: true };
  }

  try {
    await signIn('credentials', {
      email: emailLower,
      password: parsed.data.password,
      totp,
      redirectTo: '/dashboard',
    });
    resetRateLimit(rateKey);
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: matched.twoFactorEnabled ? 'Codice 2FA non valido' : 'Credenziali non valide',
        needTotp: matched.twoFactorEnabled || undefined,
      };
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
  | {
      ok: true;
      emailVerificationToken: string;
      promo?: { applied: true; amountCent: number } | { applied: false };
    }
  | { ok: false; error: string; field?: string; kycFailures?: import('@/lib/kyc/verify').KycFailure[] };

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

  const refCodeFromPayload =
    typeof (payloadObj as { referralCode?: unknown }).referralCode === 'string'
      ? (payloadObj as { referralCode: string }).referralCode
      : undefined;

  // Leggi il codice promozionale dal payload (facoltativo, silente se assente).
  const promoCodeFromPayload =
    typeof (payloadObj as { promoCode?: unknown }).promoCode === 'string'
      ? (payloadObj as { promoCode: string }).promoCode
      : '';

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

  // 3. Validazione documenti (gating rule-based). Bloccante. La data emissione
  // visura non è più richiesta a mano: sarà estratta/validata dall'OCR.
  const docInputs: RegistrationDocInput[] = docFiles.map(({ tipo, file }) => ({
    tipo,
    mimeType: file.type,
    sizeBytes: file.size,
    originalFilename: file.name,
  }));
  const docCheck = validateRegistrationDocuments(docInputs);
  if (!docCheck.ok) {
    return { ok: false, error: docCheck.error };
  }

  const { account, company, payment } = parsed.data;

  // Buffer dei file (riusati per OCR del gate KYC e poi per lo storage).
  const docBuffers = await Promise.all(
    docFiles.map(async ({ tipo, file }) => ({
      tipo, file, buffer: Buffer.from(await file.arrayBuffer()),
    })),
  );
  const bufByTipo = (t: (typeof REGISTRATION_DOC_SLOTS)[number]) =>
    docBuffers.find((d) => d.tipo === t)!;

  // GATE KYC (sincrono, bloccante). In DEMO_MODE è bypassato (banner "OCR simulati").
  // Hoisted fuori dal gate per riusare i dati estratti dentro la transaction
  // (persistenza ocrData/visuraCameraleData). null in DEMO_MODE (gate skippato).
  let kycExtracted: Awaited<ReturnType<typeof verifyRegistrationKyc>> | null = null;
  if (!env.DEMO_MODE) {
    const allowedAteco = await prisma.atecoAllowedCode.findMany({
      where: { companyType: company.type, active: true },
      select: { companyType: true, code: true, active: true },
    });
    const toInput = (t: (typeof REGISTRATION_DOC_SLOTS)[number]) => {
      const d = bufByTipo(t);
      return { buffer: d.buffer, mimeType: d.file.type, originalFilename: d.file.name };
    };
    let kyc: Awaited<ReturnType<typeof verifyRegistrationKyc>>;
    try {
      kyc = await verifyRegistrationKyc({
        files: {
          ciFronte: toInput('CI_FRONTE'),
          codiceFiscale: toInput('CODICE_FISCALE'),
          visura: toInput('VISURA_CAMERALE'),
        },
        company: {
          ragioneSociale: company.ragioneSociale,
          partitaIva: company.partitaIva,
          type: company.type,
        },
        allowedAteco,
      });
    } catch (e) {
      // Errore tecnico dell'OCR (timeout/quota/provider down): non deve
      // diventare un 500 opaco — messaggio chiaro, nessun account creato.
      console.error('[kyc] verifica documenti fallita', (e as Error).message);
      return {
        ok: false,
        error: 'Non siamo riusciti a verificare i documenti in questo momento. Riprova tra qualche minuto.',
      };
    }
    if (!kyc.passed) {
      return { ok: false, error: 'Verifica documenti non superata', kycFailures: kyc.failures };
    }
    kycExtracted = kyc;
  }

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

  // Attribuzione marketing: leggi il cookie pv_utm (first-touch catturato alla
  // landing) e persisti i parametri UTM sulla Company. Parsing difensivo.
  const utmRaw = (await cookies()).get('pv_utm')?.value;
  const utm = parseUtmCookie(utmRaw);

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
    docBuffers.map(async ({ tipo, file, buffer }) => {
      const put = await storage.put({
        scope: `company/${companyId}`,
        buffer,
        originalFilename: file.name,
        mimeType: file.type,
      });
      return { tipo, put };
    }),
  );

  // Holder per l'esito del riscatto promozionale (aggiornato dentro la transazione).
  let promoResult: PromoRedeemResult = { applied: false };
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
          civico: company.civico,
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
          utmSource: utm.source ?? null,
          utmMedium: utm.medium ?? null,
          utmCampaign: utm.campaign ?? null,
          utmContent: utm.content ?? null,
          // Popolata dall'OCR sulla visura (data emissione estratta dal gate KYC).
          // Colonna @db.Date: l'ISO yyyy-mm-dd va convertito in Date.
          visuraCameraleData:
            kycExtracted?.passed && kycExtracted.extracted.visura.dataEmissione
              ? new Date(kycExtracted.extracted.visura.dataEmissione)
              : null,
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
        // Riusa i dati estratti dal gate KYC (no re-OCR). In DEMO_MODE
        // kycExtracted è null → nessun payload, ocrStato resta NONE.
        const ocrPayload =
          kycExtracted?.passed
            ? tipo === 'VISURA_CAMERALE'
              ? kycExtracted.extracted.visura
              : tipo === 'CI_FRONTE'
                ? kycExtracted.extracted.ci
                : tipo === 'CODICE_FISCALE'
                  ? kycExtracted.extracted.cf
                  : null
            : null;
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
            ocrStato: ocrPayload ? 'SUCCESS' : 'NONE',
            ocrProvider: ocrPayload ? env.OCR_PROVIDER : null,
            ocrData: ocrPayload ? (ocrPayload as unknown as Prisma.InputJsonValue) : undefined,
            ocrAt: ocrPayload ? new Date() : null,
            gatingStato: 'PASSED',
          },
        });
      }

      createdCompanyId = companyId;
    });

    // Riscatto codice promozionale best-effort POST-commit: gira in una
    // transazione separata, cosi' un errore (anche imprevisto) non puo' mai
    // annullare una registrazione gia' committata. Codici non validi tornano
    // semplicemente { applied: false } senza sollevare eccezioni.
    if (promoCodeFromPayload && createdCompanyId) {
      try {
        promoResult = await prisma.$transaction((tx) =>
          redeemPromoCode(tx, promoCodeFromPayload, companyId),
        );
      } catch (e) {
        console.warn('[registrazione] riscatto promo fallito', (e as Error).message);
      }
    }

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

    // Email di conferma registrazione (best-effort: un errore non blocca la registrazione).
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const { getEmail } = await import('@/lib/providers/email');
      const { tplRegistrazioneConferma } = await import('@/lib/auth/email-templates');
      const mail = tplRegistrazioneConferma({
        nome: account.nome,
        ragioneSociale: company.ragioneSociale,
        tipo: company.type,
        verifyUrl: `${appUrl}/verify-email?token=${verificationToken}`,
        loginUrl: `${appUrl}/login`,
        needsVerification: !env.DEMO_MODE,
      });
      await getEmail().send({
        to: emailLower,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tag: 'registrazione',
      });
    } catch (e) {
      console.warn('[registrazione] invio email conferma fallito', (e as Error).message);
    }

    return {
      ok: true,
      emailVerificationToken: verificationToken,
      promo: promoCodeFromPayload ? promoResult : undefined,
    };
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
  const { tplResetPassword } = await import('@/lib/auth/email-templates');
  const mail = tplResetPassword({ resetUrl: link });
  await getEmail().send({
    to: emailLower,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
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

// ============================================================
// CODICI PROMOZIONALI
// ============================================================
export async function checkPromoCodeAction(codeRaw: string): Promise<PromoCheckResult> {
  const code = normalizePromoCode(codeRaw ?? '');
  if (!code) return { stato: 'inesistente' };
  const promo = await prisma.promoCode.findUnique({
    where: { code },
    select: { id: true, amountCent: true, expiresAt: true, active: true, maxRedemptions: true },
  });
  if (!promo) return { stato: 'inesistente' };
  const count = await prisma.promoCodeRedemption.count({ where: { promoCodeId: promo.id } });
  return evaluatePromoCode(promo, count);
}
