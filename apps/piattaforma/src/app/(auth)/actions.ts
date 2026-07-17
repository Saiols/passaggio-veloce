'use server';

import { AuthError } from 'next-auth';
import bcrypt from 'bcryptjs';
import { Prisma } from '@pv/db';
import { prisma } from '@pv/db';

import { signIn, signOut } from '@/auth';
import { env } from '@/env';
import { hashPassword, validatePasswordPolicy } from '@/lib/auth/password';
import { generateSecureToken, expiresIn } from '@/lib/auth/tokens';
import { headers, cookies } from 'next/headers';
import { tryMatchCrmContact } from '@/lib/crm/sync';
import { parseUtmCookie } from '@/lib/crm/utm';
import { notifyReferralSignup } from '@/lib/affiliazione/notifications';
import { geocodeCompanySedi } from '@/lib/geo/geocode-sedi';
import { AFF_SPOT_COOKIE } from '@/lib/affiliazione/spot-cookie';
import { anonymizeIp, clientIp } from '@/lib/net/ip';
import { checkRateLimit, resetRateLimit } from '@/lib/auth/rate-limit';
import { activeUserCredentialsQuery } from '@/lib/auth/credentials-query';
import { loginSchema, registerFullSchema } from '@/lib/auth/schemas';
import { randomUUID } from 'node:crypto';
import { getStorage, storageGetBuffer } from '@/lib/providers/storage';
import { getRegistroImprese } from '@/lib/providers/registro-imprese';
import { applySepaMandateToAgency } from '@/lib/providers/payment/stripe-mandate';
import {
  validateRegistrationDocuments,
  type RegistrationDocInput,
} from '@/lib/auth/document-validation';
import { evaluatePromoCode, normalizePromoCode, type PromoCheckResult } from '@/lib/promo/evaluate';
import { redeemPromoCode, type PromoRedeemResult } from '@/lib/promo/redeem';
import { verifyRegistrationKyc } from '@/lib/kyc/verify';
import { signKycToken, verifyKycToken, hashDocs } from '@/lib/kyc/token';
import { TERMS_VERSION } from '@/lib/legal/clausole-vessatorie';
import { giorniTrascorsi } from '@/lib/visura/validita';

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

  // Ogni login ripropone la modale di lancio dell'affiliazione a chi non ha
  // spuntato "non mostrare più" (quello è un flag su User, e sta altrove).
  // Va cancellato PRIMA di signIn(): con `redirectTo` signIn lancia un
  // NEXT_REDIRECT e non torna mai.
  (await cookies()).delete(AFF_SPOT_COOKIE);

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
  'CODICE_FISCALE_RETRO',
  'VISURA_CAMERALE',
] as const;

type RegistrationDocSlot = (typeof REGISTRATION_DOC_SLOTS)[number];

/**
 * Riferimento a un file caricato dal browser direttamente su Vercel Blob
 * (mirror server di BlobRef in @/lib/blob/upload-client). I file NON viaggiano
 * più dentro le Server Action (limite 4,5 MB sul body serverless): qui arriva
 * solo la chiave + i metadati, e i byte si leggono da storage via storageKey.
 */
type BlobRef = { key: string; name: string; size: number; type: string };

function isBlobRef(v: unknown): v is BlobRef {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.key === 'string' &&
    r.key.length > 0 &&
    typeof r.name === 'string' &&
    typeof r.size === 'number' &&
    typeof r.type === 'string'
  );
}

/**
 * Estrae e valida la mappa slot→BlobRef dal campo FormData `blobRefs` (JSON).
 * Applica gli stessi controlli presenza/dimensione/MIME che prima erano sui
 * File, ma ora su ref.size / ref.type. Ritorna i 4 documenti nell'ordine degli
 * slot, oppure un messaggio d'errore (stessa UX dei controlli precedenti).
 */
function parseBlobRefs(
  formData: FormData,
):
  | { ok: true; docs: { tipo: RegistrationDocSlot; ref: BlobRef }[] }
  | { ok: false; error: string } {
  const raw = formData.get('blobRefs');
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(typeof raw === 'string' ? raw : '{}');
  } catch {
    return { ok: false, error: 'Carica tutti i documenti richiesti' };
  }
  const docs: { tipo: RegistrationDocSlot; ref: BlobRef }[] = [];
  for (const slot of REGISTRATION_DOC_SLOTS) {
    const ref = map[slot];
    if (!isBlobRef(ref) || ref.size === 0) {
      return { ok: false, error: 'Carica tutti i documenti richiesti' };
    }
    if (ref.size > MAX_DOC_BYTES) {
      return { ok: false, error: 'Un documento supera il limite di 10 MB' };
    }
    docs.push({ tipo: slot, ref });
  }
  return { ok: true, docs };
}

export type RegisterActionResult =
  | {
      ok: true;
      /**
       * Scorciatoia di verifica email, esposta al client SOLO in DEMO_MODE (dove
       * l'email è simulata e il link non arriverebbe mai). In produzione è
       * `undefined`: il token viaggia esclusivamente via email.
       *
       * NON rimuovere la condizione. Ritornarlo sempre significa consegnare al
       * browser un link che scavalca la verifica dell'indirizzo — e il wizard,
       * che mostra il box "🧪 Modalità DEMO" appena il campo è valorizzato, lo
       * sbandiererebbe a un cliente vero in produzione.
       */
      emailVerificationToken?: string;
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

  // Token KYC (facoltativo): emesso dallo step Documenti dopo l'OCR. Se valido e
  // legato a questi file, evita di ri-eseguire l'OCR al submit.
  const kycTokenFromPayload =
    typeof (payloadObj as { kycToken?: unknown }).kycToken === 'string'
      ? (payloadObj as { kycToken: string }).kycToken
      : '';

  // 2. Estrai i 4 documenti obbligatori dalle BlobRef (campo FormData `blobRefs`).
  // I file sono già su Blob (client upload): qui arrivano solo chiave+metadati.
  const refsParsed = parseBlobRefs(formData);
  if (!refsParsed.ok) {
    return { ok: false, error: refsParsed.error };
  }
  const docRefs = refsParsed.docs;

  // 3. Validazione documenti (gating rule-based). Bloccante. La data emissione
  // visura non è più richiesta a mano: sarà estratta/validata dall'OCR.
  const docInputs: RegistrationDocInput[] = docRefs.map(({ tipo, ref }) => ({
    tipo,
    mimeType: ref.type,
    sizeBytes: ref.size,
    originalFilename: ref.name,
  }));
  const docCheck = validateRegistrationDocuments(docInputs);
  if (!docCheck.ok) {
    return { ok: false, error: docCheck.error };
  }

  const { account, company, payment, sedi } = parsed.data;

  const refByTipo = (t: RegistrationDocSlot) => docRefs.find((d) => d.tipo === t)!.ref;

  // GATE KYC (sincrono, bloccante). In DEMO_MODE è bypassato (banner "OCR simulati").
  // Hoisted fuori dal gate per riusare i dati estratti dentro la transaction
  // (persistenza ocrData/visuraCameraleData). null in DEMO_MODE (gate skippato).
  let kycExtracted: Awaited<ReturnType<typeof verifyRegistrationKyc>> | null = null;
  if (!env.DEMO_MODE) {
    // Byte letti da Blob via storageKey (client upload): servono per l'hash
    // KYC e per l'OCR. Solo i 3 doc che entrano nel gate (la CI_RETRO no).
    const [ciFronteBuf, cfBuf, visuraBuf] = await Promise.all([
      storageGetBuffer(refByTipo('CI_FRONTE').key),
      storageGetBuffer(refByTipo('CODICE_FISCALE').key),
      storageGetBuffer(refByTipo('VISURA_CAMERALE').key),
    ]);
    const bufBySlot: Partial<Record<RegistrationDocSlot, Buffer>> = {
      CI_FRONTE: ciFronteBuf,
      CODICE_FISCALE: cfBuf,
      VISURA_CAMERALE: visuraBuf,
    };
    const toInput = (t: RegistrationDocSlot) => {
      const ref = refByTipo(t);
      return { buffer: bufBySlot[t]!, mimeType: ref.type, originalFilename: ref.name };
    };
    // Token KYC: se il client ha già superato la verifica allo step Documenti e
    // porta un token valido legato a QUESTI file, NON ri-eseguiamo l'OCR.
    const docsHash = hashDocs([ciFronteBuf, cfBuf, visuraBuf]);
    const tokenCheck = kycTokenFromPayload
      ? verifyKycToken(kycTokenFromPayload, docsHash, Date.now())
      : ({ valid: false } as const);

    if (tokenCheck.valid) {
      kycExtracted = { passed: true, extracted: tokenCheck.extracted };
    } else {
      // Nessun token valido (es. chiamata API diretta o token scaduto): l'OCR è
      // autoritativo qui, così il gate non è bypassabile.
      const allowedAteco = await prisma.atecoAllowedCode.findMany({
        where: { companyType: company.type, active: true },
        select: { companyType: true, code: true, active: true },
      });
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
  }

  const refCodeInput = refCodeFromPayload?.trim().toLowerCase();

  // Lookup referente per SEDE (multi-sede): il codice referral vive su Sede.
  // referenteId = azienda madre (riceve la commissione), referenteSedeId = la
  // sede che ha condiviso il link (attribuzione/classifica). Silente se invalido.
  let referenteId: string | null = null;
  let referenteSedeId: string | null = null;
  if (refCodeInput) {
    const sede = await prisma.sede.findUnique({
      where: { referralCode: refCodeInput },
      select: {
        id: true,
        companyId: true,
        deletedAt: true,
        suspendedAt: true,
        company: { select: { deletedAt: true, suspendedAt: true } },
      },
    });
    if (
      sede &&
      !sede.deletedAt &&
      !sede.suspendedAt &&
      !sede.company.deletedAt &&
      !sede.company.suspendedAt
    ) {
      referenteId = sede.companyId;
      referenteSedeId = sede.id;
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

  // Pre-generiamo gli id così i Documento possono referenziare l'uploader
  // (User) nella stessa transaction.
  const companyId = randomUUID();
  const userId = randomUUID();

  // I file sono GIÀ su Blob (client upload): niente storage.put qui. Il nome del
  // provider corrente serve a popolare Documento.storageProvider.
  const storageProvider = getStorage().name;

  // Holder per l'esito del riscatto promozionale (aggiornato dentro la transazione).
  let promoResult: PromoRedeemResult = { applied: false };
  let createdCompanyId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Genera un codice referral univoco per una sede (retry su collisione).
      const genSedeReferralCode = async (): Promise<string> => {
        let code = generateReferralCode();
        for (let i = 0; i < 5; i++) {
          const collision = await tx.sede.findUnique({
            where: { referralCode: code },
            select: { id: true },
          });
          if (!collision) break;
          code = generateReferralCode();
        }
        return code;
      };

      const createdCompany = await tx.company.create({
        data: {
          id: companyId,
          type: company.type,
          ragioneSociale: company.ragioneSociale,
          partitaIva: company.partitaIva,
          // Regime fiscale del broker (FT-A). I DEALER lo scelgono in registrazione;
          // per le agenzie resta il default di colonna (ORDINARIO, irrilevante).
          regimeFiscale: company.regimeFiscale ?? undefined,
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
          // La seconda spunta (artt. 1341-1342) è validata da
          // registerStep4PaymentSchema come z.literal(true): se siamo qui,
          // l'utente l'ha messa. Prima veniva scartata e non lasciava traccia.
          clausoleVessatorieAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          // referralCode deprecato sulla Company: il codice vive sulla Sede.
          referenteId,
          referenteSedeId,
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

      // Multi-sede: crea le sedi definite nello step "Sedi". Se non fornite
      // (client vecchio/flusso ridotto), deriva 1 sede dai dati azienda (caso 1:1).
      // Ogni sede ha un referralCode univoco; l'IBAN sede ha fallback su quello madre.
      const sediInput =
        sedi && sedi.length > 0
          ? sedi
          : [
              {
                nome: company.ragioneSociale,
                indirizzo: company.indirizzo,
                civico: company.civico,
                citta: company.citta,
                cap: company.cap,
                provincia: company.provincia,
                telefono: company.telefono,
                email: company.email,
                iban: payment.iban,
              },
            ];
      for (const s of sediInput) {
        await tx.sede.create({
          data: {
            companyId: createdCompany.id,
            type: company.type,
            nome: s.nome,
            indirizzo: s.indirizzo,
            civico: s.civico || null,
            citta: s.citta,
            cap: s.cap,
            provincia: s.provincia.toUpperCase(),
            telefono: s.telefono || company.telefono || null,
            email: s.email || company.email || null,
            iban: s.iban || payment.iban,
            referralCode: await genSedeReferralCode(),
          },
        });
      }

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

      for (const { tipo, ref } of docRefs) {
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
            // Il file è già su Blob: la chiave è la ref ritornata dall'upload.
            storageKey: ref.key,
            storageProvider,
            mimeType: ref.type,
            sizeBytes: ref.size,
            originalFilename: ref.name,
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
      // Geocoda le sedi appena create (best-effort, fuori dalla transazione).
      // Se non fa in tempo/fallisce, il backfill le riprende (lat null).
      void geocodeCompanySedi(createdCompanyId);
    }

    // Mandato SEPA via Stripe — SOLO agenzie e SOLO con provider stripe.
    // Best-effort post-commit (come promo/CRM): un fallimento NON annulla la
    // registrazione; lascia sepaMandateStatus=FAILED, riparabile lato admin.
    if (
      createdCompanyId &&
      company.type === 'AGENZIA' &&
      env.PAYMENT_PROVIDER === 'stripe'
    ) {
      try {
        await applySepaMandateToAgency({
          companyId,
          iban: payment.iban,
          name: company.ragioneSociale,
          email: company.email,
          ip: clientIp(signupIpRaw),
          userAgent: hdrs.get('user-agent'),
        });
      } catch (e) {
        console.warn('[registrazione] setup mandato SEPA errore', (e as Error).message);
      }
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
      // Solo in DEMO: in produzione il link di verifica arriva via email (sopra),
      // e non deve finire nel payload della Server Action.
      emailVerificationToken: env.DEMO_MODE ? verificationToken : undefined,
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
// VERIFY DOCUMENTI (gate KYC anticipato allo step Documenti)
// ============================================================

export type VerifyDocsResult =
  | {
      ok: true;
      token?: string;
      /**
       * Giorni di calendario trascorsi dall'emissione della visura appena
       * verificata. Assente in DEMO_MODE (il gate ritorna prima dell'OCR).
       * Serve solo ad AVVISARE: l'età non blocca più la registrazione.
       */
      visuraGiorni?: number;
    }
  | { ok: false; error: string; kycFailures?: import('@/lib/kyc/verify').KycFailure[] };

/**
 * Esegue SOLO la verifica OCR/KYC dei documenti (nessuna creazione di account),
 * così il wizard può bloccare/sbloccare già al passaggio Documenti → Pagamento.
 * NON sostituisce il gate in `registerAction`, che resta autoritativo al submit
 * (non bypassabile via API) e persiste i dati estratti.
 */
export async function verifyRegistrationDocumentsAction(
  formData: FormData,
): Promise<VerifyDocsResult> {
  // Dati azienda necessari al cross-check (denominazione/P.IVA) e al tipo per
  // l'allowlist ATECO. Arrivano dallo step 2 già compilato.
  let company: { type: 'DEALER' | 'AGENZIA'; ragioneSociale: string; partitaIva: string };
  try {
    const raw = formData.get('company');
    const p = JSON.parse(typeof raw === 'string' ? raw : '{}');
    company = { type: p.type, ragioneSociale: p.ragioneSociale, partitaIva: p.partitaIva };
  } catch {
    return { ok: false, error: 'Completa prima i dati azienda' };
  }
  if (!company.type || !company.ragioneSociale || !company.partitaIva) {
    return { ok: false, error: 'Completa prima i dati azienda' };
  }

  // Estrai e valida i 4 documenti dalle BlobRef (presenza/dimensione/mime),
  // come nel submit. I file sono già su Blob: qui arrivano solo chiave+metadati.
  const refsParsed = parseBlobRefs(formData);
  if (!refsParsed.ok) return { ok: false, error: refsParsed.error };
  const docRefs = refsParsed.docs;
  const docCheck = validateRegistrationDocuments(
    docRefs.map(({ tipo, ref }) => ({
      tipo,
      mimeType: ref.type,
      sizeBytes: ref.size,
      originalFilename: ref.name,
    })),
  );
  if (!docCheck.ok) return { ok: false, error: docCheck.error };

  // In DEMO_MODE l'OCR è simulato/bypassato (coerente col gate del submit).
  if (env.DEMO_MODE) return { ok: true };

  const allowedAteco = await prisma.atecoAllowedCode.findMany({
    where: { companyType: company.type, active: true },
    select: { companyType: true, code: true, active: true },
  });
  const inputFor = async (tipo: RegistrationDocSlot) => {
    const ref = docRefs.find((x) => x.tipo === tipo)!.ref;
    return {
      // Byte letti da Blob via storageKey (client upload).
      buffer: await storageGetBuffer(ref.key),
      mimeType: ref.type,
      originalFilename: ref.name,
    };
  };
  try {
    const ci = await inputFor('CI_FRONTE');
    const cf = await inputFor('CODICE_FISCALE');
    const vis = await inputFor('VISURA_CAMERALE');
    const kyc = await verifyRegistrationKyc({
      files: { ciFronte: ci, codiceFiscale: cf, visura: vis },
      company,
      allowedAteco,
    });
    if (!kyc.passed) {
      return { ok: false, error: 'Verifica documenti non superata', kycFailures: kyc.failures };
    }
    // Token firmato legato a QUESTI file: il submit lo usa per non ri-fare l'OCR.
    const token = signKycToken(hashDocs([ci.buffer, cf.buffer, vis.buffer]), kyc.extracted, Date.now());
    // L'età non blocca (nessuna regola VISURA_SCADUTA), ma va detta subito: qui
    // l'utente può ancora sostituire la visura, dopo il submit non più.
    const dataEmissione = kyc.extracted.visura.dataEmissione;
    return {
      ok: true,
      token,
      visuraGiorni: dataEmissione
        ? giorniTrascorsi(new Date(`${dataEmissione}T00:00:00Z`), new Date())
        : undefined,
    };
  } catch (e) {
    console.error('[kyc] verifica documenti (step) fallita', (e as Error).message);
    return {
      ok: false,
      error: 'Non siamo riusciti a verificare i documenti in questo momento. Riprova tra qualche minuto.',
    };
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
  const invalid = validatePasswordPolicy(newPassword);
  if (invalid) return { ok: false, error: invalid };

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
