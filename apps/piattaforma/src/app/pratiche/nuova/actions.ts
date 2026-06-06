'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { getOcr, type LibrettoCircolazioneData } from '@/lib/providers/ocr';
import {
  extractIdentita,
  type IdentitaData,
  type IdentitaTipo,
} from '@/lib/kyc/extract-identita';
import { getStorage } from '@/lib/providers/storage';
import { avviaRound1ForPratica } from '@/lib/distribuzione';
import { sendNotification } from '@/lib/notifiche';
import { findBlockingDocuments, type GatingCandidate } from '@/lib/documenti/gating-block';
import { venditoriCrossCheck } from '@/lib/kyc/match';
import { computeFees } from '@/lib/pricing';
import { calcolaDocumentiRichiesti } from '@/lib/documenti/engine';
import {
  requiredUploadDocs,
  docKey,
  docLabel,
  parteToOwner,
} from '@/lib/documenti/richiesti';
import { env } from '@/env';

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
  const ocr = await getOcr();
  const input = {
    buffer,
    mimeType: file.type,
    originalFilename: file.name,
  };

  type AttemptResult =
    | { ok: true; data: LibrettoCircolazioneData }
    | {
        ok: false;
        errName: string;
        errCode: string | undefined;
        errMessage: string;
        elapsedMs: number;
        isTransient: boolean;
      };

  const startedAt = Date.now();
  const attemptExtract = async (): Promise<AttemptResult> => {
    try {
      const data = await ocr.extractLibretto(input);
      return { ok: true, data };
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const errName = e instanceof Error ? e.name : 'Unknown';
      const errMessage = e instanceof Error ? e.message : String(e);
      const errCode = (e as { code?: string })?.code;
      // Retry transient socket errors once: "other side closed", ECONNRESET,
      // "fetch failed" tipicamente indicano TCP socket chiuso mid-polling.
      const isTransient = /other side closed|ECONNRESET|fetch failed|socket hang up/i.test(errMessage);
      console.error(
        '[ocr] extractLibretto attempt failed:',
        JSON.stringify({ errName, errCode, errMessage, elapsedMs, isTransient }),
      );
      return { ok: false, errName, errCode, errMessage, elapsedMs, isTransient };
    }
  };

  let attempt = await attemptExtract();
  if (!attempt.ok && attempt.isTransient) {
    console.warn('[ocr] retrying once after transient error');
    attempt = await attemptExtract();
  }

  if (attempt.ok) return { ok: true, data: attempt.data };
  return {
    ok: false,
    error:
      'OCR non riuscito sul documento. Compila manualmente i campi del veicolo.',
  };
}

export type ExtractIdentitaResult =
  | { ok: true; data: IdentitaData }
  | { ok: false; error: string };

/**
 * OCR del documento d'identità (CI/passaporto/patente) della parte, per
 * pre-compilare nome/cognome/CF nel wizard. Estrae il testo grezzo via
 * provider OCR e applica il parser deterministico extractIdentita.
 */
export async function extractIdentitaAction(
  formData: FormData,
): Promise<ExtractIdentitaResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'File documento mancante' };
  }
  if (file.size > MAX_LIBRETTO_BYTES) {
    return { ok: false, error: 'File troppo grande (max 10 MB)' };
  }
  if (!ACCEPTED_MIME.includes(file.type)) {
    return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  }

  const tipoRaw = formData.get('tipo');
  const tipo = tipoRaw as IdentitaTipo;
  if (tipo !== 'CI' && tipo !== 'PASSAPORTO' && tipo !== 'PATENTE') {
    return { ok: false, error: 'Tipo documento non valido' };
  }

  try {
    const buffer = await bufferFromFile(file);
    const ocr = await getOcr();
    const text = (
      await ocr.extractText({
        buffer,
        mimeType: file.type,
        originalFilename: file.name,
      })
    ).text;
    const data = extractIdentita(text, tipo);
    return { ok: true, data };
  } catch (e) {
    console.error('[ocr] extractIdentita failed:', (e as Error).message);
    return {
      ok: false,
      error:
        'OCR non riuscito sul documento. Compila manualmente i campi della parte.',
    };
  }
}

// Tratta correttamente "false" / "true" / "on" / assenza di campo dalle FormData
const formBool = z.preprocess(
  (v) => v === 'true' || v === 'on' || v === true,
  z.boolean(),
);

/**
 * Dati di un singolo veicolo (libretto estratto via OCR + correzioni broker).
 * Arriva dal wizard come elemento dell'array `veicoli` (JSON in FormData); il
 * file libretto corrispondente arriva nello slot `LIBRETTO_<ordine>`.
 */
const veicoloSchema = z.object({
  targa: z.string().trim().min(5).max(10),
  telaio: z.string().trim().min(11).max(17),
  proprietarioAttuale: z.string().trim().min(1).max(120),
  dataImmatricolazione: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  preImm2015: z.boolean().default(false),
  flagComodatoDuso: z.boolean().default(false),
  // Snapshot OCR opzionale (così com'è arrivato dall'estrazione, pre-correzione).
  ocrData: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type VeicoloInputData = z.infer<typeof veicoloSchema>;

const tipoSoggettoEnum = z.enum([
  'PRIVATO_ITALIANO_CIE',
  'PRIVATO_ITALIANO_CARTACEA',
  'STRANIERO_EXTRA_UE',
  'AZIENDA',
  'OPERATORE_AUTO',
]);

/**
 * Tipi pratica multiveicolo (B7): dati di un singolo venditore (co-intestatario).
 * Arriva dal wizard come elemento dell'array `venditori` (JSON in FormData); i
 * file identità/permesso corrispondenti arrivano negli slot VEND<ordine>_*.
 */
const venditoreSchema = z.object({
  ordine: z.coerce.number().int().min(1).max(50),
  isPG: z.boolean().default(false),
  tipoSoggetto: tipoSoggettoEnum.optional().nullable(),
  visuraData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  permessoData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nome: z.string().trim().max(80).optional().nullable(),
  cognome: z.string().trim().max(80).optional().nullable(),
  cf: z.string().trim().max(16).optional().nullable(),
  ragioneSociale: z.string().trim().max(160).optional().nullable(),
  piva: z.string().trim().max(11).optional().nullable(),
  telefono: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().max(120).optional().nullable(),
  docId: z.enum(['CI', 'PASSAPORTO', 'PATENTE']).default('CI'),
});

export type VenditoreInputData = z.infer<typeof venditoreSchema>;

const submitSchema = z.object({
  tipo: z.enum(['SEMPLICE', 'MINIVOLTURA']),
  numeroVeicoli: z.coerce.number().int().min(1).max(50).default(1),

  // Lista veicoli (JSON stringificato in FormData). 1..n elementi.
  veicoli: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'veicoli non è JSON valido' });
        return z.NEVER;
      }
    })
    .pipe(z.array(veicoloSchema).min(1).max(50)),

  // Venditori (co-intestatari): lista (JSON stringificato in FormData). 1..n.
  venditori: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'venditori non è JSON valido' });
        return z.NEVER;
      }
    })
    .pipe(z.array(venditoreSchema).min(1).max(50)),

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

  // Schema Documentale v7 (SD-B): branching variables.
  // Quelle del venditore sono ora per-venditore (vedi `venditori` sopra).
  acquirenteTipoSoggetto: tipoSoggettoEnum.optional(),
  acquirenteVisuraData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acquirentePermessoData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  // Tipi pratica multiveicolo (A7): documento d'identità scelto per parte.
  acquirenteDocumentoIdentita: z
    .enum(['CI', 'PASSAPORTO', 'PATENTE'])
    .default('CI'),

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
  const veicoli = d.veicoli;
  const venditori = d.venditori;

  // Coerenza numeroVeicoli ↔ numero di veicoli inviati.
  if (veicoli.length !== d.numeroVeicoli) {
    redirect(
      '/pratiche/nuova?error=Numero%20veicoli%20incoerente%20con%20i%20dati%20inviati',
    );
  }

  // Libretto file per ciascun veicolo: slot LIBRETTO_1..LIBRETTO_<n> (in ordine).
  const librettoFiles: File[] = [];
  for (let i = 1; i <= veicoli.length; i++) {
    const f = formData.get(`LIBRETTO_${i}`);
    if (!(f instanceof File) || f.size === 0) {
      redirect(`/pratiche/nuova?error=Libretto%20veicolo%20${i}%20mancante`);
    }
    if ((f as File).size > MAX_LIBRETTO_BYTES) {
      redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
    }
    librettoFiles.push(f as File);
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
    veicoli: veicoli.map((v, i) => ({
      ordine: i + 1,
      preImm2015: v.preImm2015,
      flagComodatoDuso: v.flagComodatoDuso,
    })),
    venditori: venditori.map((v) => ({
      ordine: v.ordine,
      tipoSoggetto: v.tipoSoggetto ?? null,
      documentoIdentita: v.docId,
      visuraData: v.visuraData ? new Date(v.visuraData) : null,
      permessoData: v.permessoData ? new Date(v.permessoData) : null,
    })),
    flagProcura: d.flagProcura,
    flagSuccessione: d.flagSuccessione,
    acquirenteTipoSoggetto: d.acquirenteTipoSoggetto ?? null,
    acquirenteVisuraData: d.acquirenteVisuraData
      ? new Date(d.acquirenteVisuraData)
      : null,
    acquirentePermessoData: d.acquirentePermessoData
      ? new Date(d.acquirentePermessoData)
      : null,
    acquirenteDocumentoIdentita: d.acquirenteDocumentoIdentita,
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

  // Schema Documentale v7 (SD-B): i documenti richiesti (esclusi i libretti,
  // gestiti coi veicoli) arrivano nello slot DOC__<docKey>. Ognuno deve essere
  // presente, valido per MIME/dimensione e deve superare il gating rule-based.
  // Costruiamo qui il candidato per ciascun doc richiesto e validiamo presenza
  // + size + MIME prima del gating bloccante.
  const richiesti = requiredUploadDocs(esitoSchema);
  type DocUploadCandidate = {
    d: (typeof richiesti)[number];
    file: File;
  };
  const docCandidates: DocUploadCandidate[] = [];
  const gatingCandidates: GatingCandidate[] = [];
  for (const docReq of richiesti) {
    const f = formData.get(`DOC__${docKey(docReq)}`);
    if (!(f instanceof File) || f.size === 0) {
      redirect(
        `/pratiche/nuova?error=${encodeURIComponent(
          `Manca un documento richiesto: ${docLabel(docReq)}`,
        )}`,
      );
    }
    const file = f as File;
    if (file.size > MAX_LIBRETTO_BYTES) {
      redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
    }
    if (!ACCEPTED_MIME.includes(file.type)) {
      redirect(
        `/pratiche/nuova?error=${encodeURIComponent(
          `Formato non supportato per ${docLabel(docReq)} (PDF/JPG/PNG)`,
        )}`,
      );
    }
    docCandidates.push({ d: docReq, file });
    // P1.1 — Hard-block pre-invio: classifica i documenti allegati e blocca il
    // submit se almeno uno NON passa il gating rule-based. L'owner serve solo
    // come etichetta diagnostica nel messaggio d'errore.
    gatingCandidates.push({
      owner: parteToOwner(docReq.parte) === 'ACQUIRENTE' ? 'acquirente' : 'venditore',
      tipo: docReq.tipo,
      mimeType: file.type,
      sizeBytes: file.size,
      originalFilename: file.name,
    });
  }
  const blocking = findBlockingDocuments(gatingCandidates);
  if (blocking.length > 0) {
    const summary = blocking
      .map((b) => `${b.owner} ${b.tipo}: ${b.reason}`)
      .join(' | ');
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        `Documenti non validi, ricaricali prima di inviare — ${summary}`,
      )}`,
    );
  }

  // Tipi pratica multiveicolo (A8): documenti d'identità per parte.
  // Per ciascuna parte, in base al tipo di documento scelto, raccogliamo i file
  // identità dalle slot del wizard, ne validiamo presenza + MIME + dimensione,
  // e li mappiamo al rispettivo DocumentoTipo. Il permesso di soggiorno è
  // opzionale (la presenza per stranieri è già gestita dall'engine via BLOCCO).
  type IdentitaDocCandidate = {
    tipo: 'CI_FRONTE' | 'CI_RETRO' | 'PASSAPORTO' | 'PATENTE' | 'PERMESSO_SOGGIORNO';
    owner: 'VENDITORE' | 'ACQUIRENTE';
    // Per i documenti del venditore, l'ordine 1..n del venditore a cui il
    // documento appartiene (serve per il linkage Documento.venditoreId).
    venditoreOrdine?: number;
    file: File;
  };
  const identitaCandidates: IdentitaDocCandidate[] = [];

  const validateIdentitaFile = (file: File, label: string): File => {
    if (file.size > MAX_LIBRETTO_BYTES) {
      redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
    }
    if (!ACCEPTED_MIME.includes(file.type)) {
      redirect(
        `/pratiche/nuova?error=${encodeURIComponent(
          `Formato non supportato per ${label} (PDF/JPG/PNG)`,
        )}`,
      );
    }
    return file;
  };

  // Raccoglie i file identità di una parte secondo il tipo di documento scelto.
  // Slot CI: <PREFIX>_ID_FRONTE + <PREFIX>_ID_RETRO; passaporto/patente:
  // <PREFIX>_ID. Permesso opzionale: <PREFIX>_PERMESSO. Per i venditori
  // `venditoreOrdine` tagga i candidati per il successivo linkage al Venditore.
  const collectIdentita = (
    owner: 'VENDITORE' | 'ACQUIRENTE',
    prefix: string,
    documentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
    labelParte: string,
    venditoreOrdine?: number,
  ): void => {
    const missingMsg = `/pratiche/nuova?error=${encodeURIComponent(
      `Documento d'identità mancante per ${labelParte}`,
    )}`;
    if (documentoIdentita === 'CI') {
      const fronte = formData.get(`${prefix}_ID_FRONTE`);
      const retro = formData.get(`${prefix}_ID_RETRO`);
      if (
        !(fronte instanceof File) || fronte.size === 0 ||
        !(retro instanceof File) || retro.size === 0
      ) {
        redirect(missingMsg);
      }
      identitaCandidates.push({
        tipo: 'CI_FRONTE',
        owner,
        venditoreOrdine,
        file: validateIdentitaFile(fronte as File, "documento d'identità"),
      });
      identitaCandidates.push({
        tipo: 'CI_RETRO',
        owner,
        venditoreOrdine,
        file: validateIdentitaFile(retro as File, "documento d'identità"),
      });
    } else {
      const id = formData.get(`${prefix}_ID`);
      if (!(id instanceof File) || id.size === 0) {
        redirect(missingMsg);
      }
      identitaCandidates.push({
        tipo: documentoIdentita === 'PASSAPORTO' ? 'PASSAPORTO' : 'PATENTE',
        owner,
        venditoreOrdine,
        file: validateIdentitaFile(id as File, "documento d'identità"),
      });
    }

    const permesso = formData.get(`${prefix}_PERMESSO`);
    if (permesso instanceof File && permesso.size > 0) {
      identitaCandidates.push({
        tipo: 'PERMESSO_SOGGIORNO',
        owner,
        venditoreOrdine,
        file: validateIdentitaFile(permesso as File, 'permesso di soggiorno'),
      });
    }
  };

  // Un blocco di file identità per ciascun venditore (slot VEND<ordine>_*).
  for (const v of venditori) {
    const label =
      venditori.length > 1 ? `il venditore ${v.ordine}` : 'il venditore';
    collectIdentita('VENDITORE', `VEND${v.ordine}`, v.docId, label, v.ordine);
  }
  collectIdentita('ACQUIRENTE', 'ACQ', d.acquirenteDocumentoIdentita, "l'acquirente");

  // Cross-check insiemistico venditori ↔ intestatari del libretto (server-side,
  // autoritativo). Gli intestatari arrivano dall'OCR del primo veicolo (tutti i
  // co-intestatari, con fallback al proprietarioAttuale editabile). MISMATCH
  // blocca il submit; OK/SCONOSCIUTO proseguono.
  const ocrProprietari = (() => {
    const raw = veicoli[0]?.ocrData?.proprietari;
    if (Array.isArray(raw)) {
      return raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    }
    return [];
  })();
  const proprietari = ocrProprietari.length
    ? ocrProprietari
    : veicoli[0]?.proprietarioAttuale
      ? [veicoli[0].proprietarioAttuale]
      : [];
  const cc = venditoriCrossCheck(
    venditori.map((v) => ({
      isPersonaGiuridica: v.isPG,
      nome: v.nome ?? undefined,
      cognome: v.cognome ?? undefined,
      ragioneSociale: v.ragioneSociale ?? undefined,
    })),
    proprietari,
    { flagProcura: d.flagProcura },
  );
  if (cc === 'MISMATCH') {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        "I venditori non corrispondono agli intestatari del libretto",
      )}`,
    );
  }

  // Pricing derivato dal tipo + numero veicoli (engine in lib/pricing.ts).
  const fees = computeFees({ tipo: d.tipo, numeroVeicoli: d.numeroVeicoli });
  const feeAgenziaCent = fees.feeAgenziaCent;
  const creditoBrokerCent = fees.creditoBrokerCent;

  const codicePratica = await nextCodicePratica();
  const now = new Date();

  // Upload dei libretti su storage PRIMA della transazione DB (filesystem/R2,
  // fuori dal contesto transazionale di Prisma). Uno per veicolo, in ordine.
  const storage = getStorage();
  const ocrManuale = formData.get('ocrManuale') === 'true';
  const librettoUploads = await Promise.all(
    librettoFiles.map(async (file) => {
      const buffer = await bufferFromFile(file);
      return storage.put({
        scope: `pratica/new`,
        buffer,
        originalFilename: file.name,
        mimeType: file.type,
      });
    }),
  );

  // Schema Documentale v7 (SD-B): upload dei documenti richiesti su storage
  // PRIMA della transazione (storage non transazionale, come i libretti). Le
  // righe Documento vengono poi create dentro la transazione.
  const docUploads = await Promise.all(
    docCandidates.map(async ({ d: docReq, file }) => {
      const buffer = await bufferFromFile(file);
      const put = await storage.put({
        scope: `pratica/new`,
        buffer,
        originalFilename: file.name,
        mimeType: file.type,
      });
      return { d: docReq, put };
    }),
  );

  // Tipi pratica multiveicolo (A8): upload dei documenti d'identità/permesso su
  // storage PRIMA della transazione (storage non transazionale, come i libretti
  // e i doc DOC__). Le righe Documento vengono create dentro la transazione.
  const identitaUploads = await Promise.all(
    identitaCandidates.map(async (cand) => {
      const buffer = await bufferFromFile(cand.file);
      const put = await storage.put({
        scope: `pratica/new`,
        buffer,
        originalFilename: cand.file.name,
        mimeType: cand.file.type,
      });
      return {
        tipo: cand.tipo,
        owner: cand.owner,
        venditoreOrdine: cand.venditoreOrdine,
        put,
      };
    }),
  );

  // Crea la pratica in BOZZA + i veicoli + i libretti in un'unica transazione.
  // L'apertura del round 1 avviene subito dopo tramite l'engine di
  // distribuzione (gestisce selezione agenzie + countdown).
  const pratica = await prisma.$transaction(async (tx) => {
    const created = await tx.pratica.create({
    data: {
      codicePratica,
      tipo: d.tipo,
      numeroVeicoli: d.numeroVeicoli,
      stato: 'BOZZA',

      // Dati venditore: ora normalizzati in N righe Venditore (vedi sotto).

      acquirenteIsPersonaGiuridica: d.acquirenteIsPG,
      acquirenteNome: d.acquirenteIsPG ? null : d.acquirenteNome,
      acquirenteCognome: d.acquirenteIsPG ? null : d.acquirenteCognome,
      acquirenteCF: d.acquirenteIsPG ? null : d.acquirenteCF?.toUpperCase(),
      acquirenteRagioneSociale: d.acquirenteIsPG ? d.acquirenteRagioneSociale : null,
      acquirentePIVA: d.acquirenteIsPG ? d.acquirentePIVA : null,
      acquirenteTelefono: d.acquirenteTelefono || null,
      acquirenteEmail: d.acquirenteEmail?.toLowerCase() || null,

      flagCointestazione: d.flagCointestazione,
      flagMinivoltura: d.tipo === 'MINIVOLTURA',
      flagProcura: d.flagProcura,

      comune: d.comune,
      provincia: d.provincia,

      // Schema Documentale v7 (SD-B): branching variables persistite.
      // Quelle del venditore sono ora per-venditore (modello Venditore, sotto).
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

    // Un Veicolo per elemento (ordine 1..n) + il libretto collegato.
    const veicoloIdByOrdine = new Map<number, string>();
    for (let i = 0; i < veicoli.length; i++) {
      const v = veicoli[i]!;
      const upload = librettoUploads[i]!;
      const veicolo = await tx.veicolo.create({
        data: {
          praticaId: created.id,
          ordine: i + 1,
          targa: v.targa.toUpperCase(),
          telaio: v.telaio.toUpperCase(),
          proprietarioAttuale: v.proprietarioAttuale,
          dataImmatricolazione: v.dataImmatricolazione
            ? new Date(v.dataImmatricolazione)
            : null,
          preImm2015: v.preImm2015,
          flagComodatoDuso: v.flagComodatoDuso,
          ocrData: (v.ocrData ?? undefined) as Prisma.InputJsonValue | undefined,
          ocrProvider: env.OCR_PROVIDER,
          ocrAt: now,
        },
      });
      veicoloIdByOrdine.set(i + 1, veicolo.id);

      const ocrSnapshot: Prisma.InputJsonValue = {
        targa: v.targa,
        telaio: v.telaio,
        proprietarioAttuale: v.proprietarioAttuale,
        dataImmatricolazione: v.dataImmatricolazione ?? null,
        preImm2015: v.preImm2015,
        flagComodatoDuso: v.flagComodatoDuso,
        ocrManuale,
      };

      await tx.documento.create({
        data: {
          tipo: 'LIBRETTO_CIRCOLAZIONE',
          praticaId: created.id,
          veicoloId: veicolo.id,
          storageKey: upload.storageKey,
          storageProvider: upload.storageProvider,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          originalFilename: upload.originalFilename,
          uploadedById: userId,
          ocrStato: ocrManuale ? 'FAILED' : 'SUCCESS',
          ocrProvider: env.OCR_PROVIDER,
          ocrData: ocrSnapshot,
          ocrAt: now,
          gatingStato: 'PASSED',
        },
      });
    }

    // Tipi pratica multiveicolo (B7): N venditori (co-intestatari) normalizzati
    // in righe Venditore (ordine 1..n). I file identità/permesso vengono poi
    // collegati alla riga Venditore corrispondente via Documento.venditoreId.
    const venditoreIdByOrdine = new Map<number, string>();
    for (const v of venditori) {
      const venditore = await tx.venditore.create({
        data: {
          praticaId: created.id,
          ordine: v.ordine,
          nome: v.isPG ? null : v.nome || null,
          cognome: v.isPG ? null : v.cognome || null,
          cf: v.isPG ? null : v.cf?.toUpperCase() || null,
          isPersonaGiuridica: v.isPG,
          ragioneSociale: v.isPG ? v.ragioneSociale || null : null,
          piva: v.isPG ? v.piva || null : null,
          telefono: v.telefono || null,
          email: v.email?.toLowerCase() || null,
          tipoSoggetto: v.tipoSoggetto ?? null,
          visuraData: v.visuraData ? new Date(v.visuraData) : null,
          permessoData: v.permessoData ? new Date(v.permessoData) : null,
          documentoIdentita: v.docId,
        },
      });
      venditoreIdByOrdine.set(v.ordine, venditore.id);
    }

    // Schema Documentale v7 (SD-B): documenti richiesti (esclusi libretti).
    // Gli upload su storage sono già avvenuti prima della transazione; qui
    // creiamo solo le righe Documento collegate alla pratica (e al veicolo se
    // il documento è di tipo VEICOLO, es. certificato di proprietà).
    for (const { d: docReq, put } of docUploads) {
      await tx.documento.create({
        data: {
          tipo: docReq.tipo as Prisma.DocumentoCreateInput['tipo'],
          owner: parteToOwner(docReq.parte),
          praticaId: created.id,
          veicoloId:
            docReq.parte === 'VEICOLO' && docReq.veicoloOrdine
              ? (veicoloIdByOrdine.get(docReq.veicoloOrdine) ?? null)
              : null,
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

    // Tipi pratica multiveicolo (B7): documenti d'identità/permesso per parte.
    // Upload già avvenuti prima della transazione; qui creiamo le righe
    // Documento collegate alla pratica. I documenti del venditore vengono
    // collegati alla riga Venditore corrispondente via venditoreId.
    for (const { tipo, owner, venditoreOrdine, put } of identitaUploads) {
      await tx.documento.create({
        data: {
          tipo: tipo as Prisma.DocumentoCreateInput['tipo'],
          owner,
          praticaId: created.id,
          venditoreId:
            owner === 'VENDITORE' && venditoreOrdine
              ? (venditoreIdByOrdine.get(venditoreOrdine) ?? null)
              : null,
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

    return created;
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
        targa: veicoli[0]!.targa,
        comune: d.comune,
        provincia: d.provincia,
        numeroAgenzie: round1.assegnazioni,
        nomeBroker: me.name?.split(' ')[0] ?? 'utente',
      },
    }).catch(() => undefined);
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  redirect(`/pratiche/${pratica.id}`);
}
