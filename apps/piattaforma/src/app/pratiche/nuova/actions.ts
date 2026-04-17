'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { getOcr, type LibrettoCircolazioneData } from '@/lib/providers/ocr';
import { getStorage } from '@/lib/providers/storage';
import { avviaRound1ForPratica } from '@/lib/distribuzione';
import { sendNotification } from '@/lib/notifiche';

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
  tipo: z.enum(['TRAPASSO_NETTO', 'MINIVOLTURA', 'LOTTO_MASSIVO']),

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

  // Acquirente
  acquirenteIsPG: formBool.default(false),
  acquirenteNome: z.string().trim().max(80).optional(),
  acquirenteCognome: z.string().trim().max(80).optional(),
  acquirenteCF: z.string().trim().max(16).optional(),
  acquirenteRagioneSociale: z.string().trim().max(160).optional(),
  acquirentePIVA: z.string().trim().max(11).optional(),

  // Flag
  flagCointestazione: formBool.default(false),
  flagMinivoltura: formBool.default(false),
  flagProcura: formBool.default(false),

  // Localizzazione
  comune: z.string().trim().min(1).max(100),
  provincia: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase()),
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

  // Fee plausibile in base al tipo (placeholder — Fase 5 Stripe farà la logica vera)
  const feeAgenziaCent = d.tipo === 'MINIVOLTURA' ? 9500 : 12000;
  const creditoBrokerCent = d.tipo === 'TRAPASSO_NETTO' ? 2500 : 0;

  const codicePratica = await nextCodicePratica();
  const now = new Date();

  // Crea la pratica in BOZZA — l'apertura del round 1 avviene subito dopo
  // tramite l'engine di distribuzione (gestisce selezione agenzie + countdown).
  const pratica = await prisma.pratica.create({
    data: {
      codicePratica,
      tipo: d.tipo,
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

      acquirenteIsPersonaGiuridica: d.acquirenteIsPG,
      acquirenteNome: d.acquirenteIsPG ? null : d.acquirenteNome,
      acquirenteCognome: d.acquirenteIsPG ? null : d.acquirenteCognome,
      acquirenteCF: d.acquirenteIsPG ? null : d.acquirenteCF?.toUpperCase(),
      acquirenteRagioneSociale: d.acquirenteIsPG ? d.acquirenteRagioneSociale : null,
      acquirentePIVA: d.acquirenteIsPG ? d.acquirentePIVA : null,

      flagCointestazione: d.flagCointestazione,
      flagMinivoltura: d.flagMinivoltura,
      flagProcura: d.flagProcura,

      comune: d.comune,
      provincia: d.provincia,

      brokerId,
      feeAgenziaCent,
      creditoBrokerCent,

      submittedAt: now,
    },
  });

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

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  redirect(`/pratiche/${pratica.id}`);
}
