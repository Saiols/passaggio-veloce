'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { getOcr, type LibrettoCircolazioneData } from '@/lib/providers/ocr';
import { getStorage } from '@/lib/providers/storage';
import { avviaRound1ForPratica } from '@/lib/distribuzione';
import { sendNotification } from '@/lib/notifiche';
import { classifyDocumento } from '@/lib/documenti/classifier';
import { computeFees } from '@/lib/pricing';
import { calcolaDocumentiRichiesti } from '@/lib/documenti/engine';

/**
 * Anonimizza IP per GDPR (Sistema Penali Broker — SP-A).
 * IPv4: maschera l'ultimo ottetto. IPv6: tiene primi 4 hextet.
 */
function anonimizeIp(ip: string): string {
  if (!ip) return '';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (ip.includes(':')) {
    const hextets = ip.split(':').filter((h) => h.length > 0);
    return hextets.slice(0, 4).join(':') + '::x';
  }
  return ip;
}

async function getRequestMetadata(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') ?? '';
  const rawIp = xff.split(',')[0]?.trim() || h.get('x-real-ip') || '';
  return {
    ip: anonimizeIp(rawIp),
    userAgent: (h.get('user-agent') ?? '').slice(0, 300),
  };
}

const MAX_LIBRETTO_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];

const CURRENT_YEAR = new Date().getFullYear();

async function bufferFromFile(file: File): Promise<Buffer> {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

export type ExtractLibrettoResult =
  | { ok: true; data: LibrettoCircolazioneData }
  | { ok: false; error: string };

export async function extractLibrettoAction(
  formData: FormData,
): Promise<ExtractLibrettoResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  const file = formData.get('libretto');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'File libretto mancante' };
  }
  if (file.size > MAX_LIBRETTO_BYTES) {
    return { ok: false, error: 'File troppo grande (max 10 MB)' };
  }
  if (!ACCEPTED_MIME.includes(file.type)) {
    return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  }

  const buffer = await bufferFromFile(file);
  const ocr = getOcr();
  const data = await ocr.extractLibretto({
    buffer,
    mimeType: file.type,
    originalFilename: file.name,
  });
  return { ok: true, data };
}

// Tratta correttamente "false" / "true" / "on" / assenza di campo dalle FormData
const formBool = z.preprocess(
  (v) => v === 'true' || v === 'on' || v === true,
  z.boolean(),
);

const submitSchema = z.object({
  tipo: z.enum(['PASSAGGIO_PRIVATO', 'MINIVOLTURE_MULTIPLE']),
  numeroVeicoli: z.coerce.number().int().min(1).max(50).default(1),

  // Dati veicolo (OCR + correzioni)
  targa: z.string().trim().min(5).max(10),
  telaio: z.string().trim().min(11).max(17),
  proprietarioAttuale: z.string().trim().min(1).max(120),
  dataImmatricolazione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preImm2015: formBool.default(false),
  flagComodatoDuso: formBool.default(false),

  // Venditore
  venditoreIsPG: formBool.default(false),
  venditoreNome: z.string().trim().max(80).optional(),
  venditoreCognome: z.string().trim().max(80).optional(),
  venditoreCF: z.string().trim().max(16).optional(),
  venditoreRagioneSociale: z.string().trim().max(160).optional(),
  venditorePIVA: z.string().trim().max(11).optional(),
  venditoreTelefono: z.string().trim().max(30).optional(),
  venditoreEmail: z.string().trim().max(120).optional(),

  // Acquirente
  acquirenteIsPG: formBool.default(false),
  acquirenteNome: z.string().trim().max(80).optional(),
  acquirenteCognome: z.string().trim().max(80).optional(),
  acquirenteCF: z.string().trim().max(16).optional(),
  acquirenteRagioneSociale: z.string().trim().max(160).optional(),
  acquirentePIVA: z.string().trim().max(11).optional(),
  acquirenteTelefono: z.string().trim().max(30).optional(),
  acquirenteEmail: z.string().trim().max(120).optional(),

  // Flag
  flagCointestazione: formBool.default(false),
  flagMinivoltura: formBool.default(false),
  flagProcura: formBool.default(false),
  flagSuccessione: formBool.default(false),
  flagMinore: formBool.default(false),

  // Schema Documentale v7 (SD-B): branching variables
  venditoreTipoSoggetto: z
    .enum([
      'PRIVATO_ITALIANO_CIE',
      'PRIVATO_ITALIANO_CARTACEA',
      'STRANIERO_EXTRA_UE',
      'AZIENDA',
      'OPERATORE_AUTO',
    ])
    .optional(),
  venditoreVisuraData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  venditorePermessoData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acquirenteTipoSoggetto: z
    .enum([
      'PRIVATO_ITALIANO_CIE',
      'PRIVATO_ITALIANO_CARTACEA',
      'STRANIERO_EXTRA_UE',
      'AZIENDA',
      'OPERATORE_AUTO',
    ])
    .optional(),
  acquirenteVisuraData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acquirentePermessoData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  // Localizzazione
  comune: z.string().trim().min(1).max(100),
  provincia: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase()),

  // Sistema Penali Broker (SP-A): popup di responsabilità accettato
  dichiarazioneAccettata: formBool,
  dichiarazionePopupVersion: z.string().trim().min(1).max(20),
});

async function nextCodicePratica(): Promise<string> {
  const count = await prisma.pratica.count({ where: { codicePratica: { not: null } } });
  const n = String(count + 1).padStart(5, '0');
  return `PV-${CURRENT_YEAR}-${n}`;
}

export async function submitNuovaPraticaAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    redirect('/dashboard');
  }
  const brokerId = session.user.companyId!;
  const userId = session.user.id!;

  const raw = Object.fromEntries(formData.entries());
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const msg = first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi';
    redirect(`/pratiche/nuova?error=${encodeURIComponent(msg)}`);
  }
  const d = parsed.data;

  // Libretto file (required)
  const libretto = formData.get('libretto');
  if (!(libretto instanceof File) || libretto.size === 0) {
    redirect('/pratiche/nuova?error=Libretto%20mancante');
  }
  if ((libretto as File).size > MAX_LIBRETTO_BYTES) {
    redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
  }

  // Validation business rule sul numeroVeicoli
  if (d.tipo === 'PASSAGGIO_PRIVATO' && d.numeroVeicoli !== 1) {
    redirect('/pratiche/nuova?error=Passaggio%20privato%20richiede%201%20veicolo');
  }
  if (d.tipo === 'MINIVOLTURE_MULTIPLE' && d.numeroVeicoli < 2) {
    redirect('/pratiche/nuova?error=Minivolture%20multiple%20richiedono%20almeno%202%20veicoli');
  }

  // Sistema Penali Broker (SP-A): la dichiarazione popup è bloccante
  if (!d.dichiarazioneAccettata) {
    redirect(
      '/pratiche/nuova?error=Devi%20accettare%20la%20dichiarazione%20di%20responsabilita%20prima%20di%20inviare',
    );
  }

  // Schema Documentale v7 (SD-B): l'engine deterministic verifica che la
  // combinazione di variabili compilate dal broker non porti a BLOCCO
  // (comodato attivo, permesso scaduto, visura > 6 mesi). Se INPUT_INCOMPLETO
  // o BLOCCO, redirect con motivo. Server-side è la fonte autoritativa, il
  // wizard usa lo stesso engine per UI in tempo reale.
  const esitoSchema = calcolaDocumentiRichiesti({
    preImm2015: d.preImm2015 ?? false,
    flagComodatoDuso: d.flagComodatoDuso ?? false,
    venditoreTipoSoggetto: d.venditoreTipoSoggetto ?? null,
    venditoreVisuraData: d.venditoreVisuraData
      ? new Date(d.venditoreVisuraData)
      : null,
    venditorePermessoData: d.venditorePermessoData
      ? new Date(d.venditorePermessoData)
      : null,
    flagProcura: d.flagProcura,
    flagSuccessione: d.flagSuccessione,
    acquirenteTipoSoggetto: d.acquirenteTipoSoggetto ?? null,
    acquirenteVisuraData: d.acquirenteVisuraData
      ? new Date(d.acquirenteVisuraData)
      : null,
    acquirentePermessoData: d.acquirentePermessoData
      ? new Date(d.acquirentePermessoData)
      : null,
    flagMinore: d.flagMinore,
  });
  if (esitoSchema.kind === 'BLOCCO') {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        `${esitoSchema.motivo}. ${esitoSchema.soluzione}`,
      )}`,
    );
  }
  if (esitoSchema.kind === 'INPUT_INCOMPLETO') {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        `Dati incompleti: ${esitoSchema.mancanti.join(', ')}`,
      )}`,
    );
  }

  // Pricing derivato dal tipo + numero veicoli (engine in lib/pricing.ts).
  const fees = computeFees({ tipo: d.tipo, numeroVeicoli: d.numeroVeicoli });
  const feeAgenziaCent = fees.feeAgenziaCent;
  const creditoBrokerCent = fees.creditoBrokerCent;

  const codicePratica = await nextCodicePratica();
  const now = new Date();

  // Crea la pratica in BOZZA — l'apertura del round 1 avviene subito dopo
  // tramite l'engine di distribuzione (gestisce selezione agenzie + countdown).
  const pratica = await prisma.pratica.create({
    data: {
      codicePratica,
      tipo: d.tipo,
      numeroVeicoli: d.numeroVeicoli,
      stato: 'BOZZA',
      targa: d.targa.toUpperCase(),
      telaio: d.telaio.toUpperCase(),
      proprietarioAttuale: d.proprietarioAttuale,
      dataImmatricolazione: new Date(d.dataImmatricolazione),
      preImm2015: d.preImm2015 ?? false,
      flagComodatoDuso: d.flagComodatoDuso ?? false,

      venditoreIsPersonaGiuridica: d.venditoreIsPG,
      venditoreNome: d.venditoreIsPG ? null : d.venditoreNome,
      venditoreCognome: d.venditoreIsPG ? null : d.venditoreCognome,
      venditoreCF: d.venditoreIsPG ? null : d.venditoreCF?.toUpperCase(),
      venditoreRagioneSociale: d.venditoreIsPG ? d.venditoreRagioneSociale : null,
      venditorePIVA: d.venditoreIsPG ? d.venditorePIVA : null,
      venditoreTelefono: d.venditoreTelefono || null,
      venditoreEmail: d.venditoreEmail?.toLowerCase() || null,

      acquirenteIsPersonaGiuridica: d.acquirenteIsPG,
      acquirenteNome: d.acquirenteIsPG ? null : d.acquirenteNome,
      acquirenteCognome: d.acquirenteIsPG ? null : d.acquirenteCognome,
      acquirenteCF: d.acquirenteIsPG ? null : d.acquirenteCF?.toUpperCase(),
      acquirenteRagioneSociale: d.acquirenteIsPG ? d.acquirenteRagioneSociale : null,
      acquirentePIVA: d.acquirenteIsPG ? d.acquirentePIVA : null,
      acquirenteTelefono: d.acquirenteTelefono || null,
      acquirenteEmail: d.acquirenteEmail?.toLowerCase() || null,

      flagCointestazione: d.flagCointestazione,
      flagMinivoltura: d.flagMinivoltura,
      flagProcura: d.flagProcura,

      comune: d.comune,
      provincia: d.provincia,

      // Schema Documentale v7 (SD-B): branching variables persistite.
      venditoreTipoSoggetto: d.venditoreTipoSoggetto ?? null,
      venditoreVisuraData: d.venditoreVisuraData
        ? new Date(d.venditoreVisuraData)
        : null,
      venditorePermessoData: d.venditorePermessoData
        ? new Date(d.venditorePermessoData)
        : null,
      acquirenteTipoSoggetto: d.acquirenteTipoSoggetto ?? null,
      acquirenteVisuraData: d.acquirenteVisuraData
        ? new Date(d.acquirenteVisuraData)
        : null,
      acquirentePermessoData: d.acquirentePermessoData
        ? new Date(d.acquirentePermessoData)
        : null,
      flagSuccessione: d.flagSuccessione,
      flagMinore: d.flagMinore,

      brokerId,
      feeAgenziaCent,
      creditoBrokerCent,

      submittedAt: now,
    },
  });

  // Sistema Penali Broker (SP-A): log immutabile dell'accettazione popup.
  // Best-effort: se fallisce il log non blocchiamo il submit, ma resta
  // tracciata l'accettazione via flag formData.
  try {
    const meta = await getRequestMetadata();
    await prisma.brokerDichiarazione.create({
      data: {
        praticaId: pratica.id,
        userId,
        ip: meta.ip || null,
        userAgent: meta.userAgent || null,
        popupVersion: d.dichiarazionePopupVersion,
      },
    });
  } catch {
    // best-effort log
  }

  // Apre il round 1 tramite engine distribuzione: crea PraticaAssegnazione
  // con countdown per-agenzia basato sugli orari di apertura dichiarati.
  const round1 = await avviaRound1ForPratica(pratica.id);

  // N1 — conferma invio al broker
  if (round1.assegnazioni > 0) {
    const me = session.user;
    await sendNotification({
      tipo: 'N1_BROKER_INVIO_PRATICA',
      target: { email: me.email ?? '', userId: me.id ?? null, companyId: brokerId },
      payload: {
        codicePratica,
        targa: d.targa,
        comune: d.comune,
        provincia: d.provincia,
        numeroAgenzie: round1.assegnazioni,
        nomeBroker: me.name?.split(' ')[0] ?? 'utente',
      },
    }).catch(() => undefined);
  }

  // Upload libretto su storage (fuori dalla transaction — filesystem)
  const storage = getStorage();
  const buffer = await bufferFromFile(libretto as File);
  const put = await storage.put({
    scope: `pratica/${pratica.id}`,
    buffer,
    originalFilename: (libretto as File).name,
    mimeType: (libretto as File).type,
  });

  // Salvo record documento + mock OCR result snapshot
  const ocrSnapshot: Prisma.InputJsonValue = {
    targa: d.targa,
    telaio: d.telaio,
    proprietarioAttuale: d.proprietarioAttuale,
    dataImmatricolazione: d.dataImmatricolazione,
    preImm2015: d.preImm2015,
    flagComodatoDuso: d.flagComodatoDuso,
  };

  await prisma.documento.create({
    data: {
      tipo: 'LIBRETTO_CIRCOLAZIONE',
      praticaId: pratica.id,
      storageKey: put.storageKey,
      storageProvider: put.storageProvider,
      mimeType: put.mimeType,
      sizeBytes: put.sizeBytes,
      originalFilename: put.originalFilename,
      uploadedById: userId,
      ocrStato: 'SUCCESS',
      ocrProvider: 'mock',
      ocrData: ocrSnapshot,
      ocrAt: now,
      gatingStato: 'PASSED',
    },
  });

  // Documenti aggiuntivi per parte (D-06): CI, CF, procura, visura, permesso.
  // Tutti opzionali. Salviamo file su storage + record Documento con owner.
  const DOC_TIPI_PARTE = [
    'CI_FRONTE',
    'CI_RETRO',
    'CODICE_FISCALE',
    'PROCURA',
    'VISURA_CAMERALE',
    'PERMESSO_SOGGIORNO',
  ] as const;
  for (const owner of ['venditore', 'acquirente'] as const) {
    for (const docTipo of DOC_TIPI_PARTE) {
      const f = formData.get(`${owner}_${docTipo}`);
      if (!(f instanceof File) || f.size === 0) continue;
      if (f.size > MAX_LIBRETTO_BYTES) continue; // skip silently se troppo grande
      if (!ACCEPTED_MIME.includes(f.type)) continue;
      const buf = await bufferFromFile(f);
      const partyPut = await storage.put({
        scope: `pratica/${pratica.id}`,
        buffer: buf,
        originalFilename: f.name,
        mimeType: f.type,
      });
      // A4: gating rule-based al momento dell'upload. Il classificatore
      // decide PASSED/FAILED in base a MIME, dimensioni e naming hints.
      // Quando arriva Document AI, swap del classifier; il resto è invariato.
      const gating = classifyDocumento({
        tipo: docTipo,
        mimeType: partyPut.mimeType,
        sizeBytes: partyPut.sizeBytes,
        originalFilename: partyPut.originalFilename,
      });
      await prisma.documento.create({
        data: {
          tipo: docTipo,
          owner: owner === 'venditore' ? 'VENDITORE' : 'ACQUIRENTE',
          praticaId: pratica.id,
          storageKey: partyPut.storageKey,
          storageProvider: partyPut.storageProvider,
          mimeType: partyPut.mimeType,
          sizeBytes: partyPut.sizeBytes,
          originalFilename: partyPut.originalFilename,
          uploadedById: userId,
          ocrStato: 'NONE',
          gatingStato: gating.stato,
          gatingError: gating.stato === 'FAILED' ? gating.reason : null,
        },
      });
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  redirect(`/pratiche/${pratica.id}`);
}
