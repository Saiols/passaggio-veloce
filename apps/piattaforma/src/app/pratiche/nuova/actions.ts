'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { resolveSubmittedSede } from '@/lib/sedi/scope';
import { prisma, Prisma } from '@pv/db';
import { getOcr, type LibrettoCircolazioneData } from '@/lib/providers/ocr';
import { parseLibrettoText } from '@/lib/providers/ocr/libretto-parser';
import { parseFoglioComplementareText } from '@/lib/providers/ocr/foglio-complementare-parser';
import {
  extractIdentita,
  type IdentitaData,
  type IdentitaTipo,
} from '@/lib/kyc/extract-identita';
import { getStorage, storageGetBuffer } from '@/lib/providers/storage';
import { avviaRound1ForPratica } from '@/lib/distribuzione';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariBroker } from '@/lib/notifiche/pratica';
import { findBlockingDocuments, type GatingCandidate } from '@/lib/documenti/gating-block';
import { crossCheckPerVeicolo } from './venditori-per-veicolo';
import {
  delegaDocsComplete,
  delegatoDocKey,
  procuraDelegaDocKey,
} from './delega-docs';
import { extractVisura } from '@/lib/kyc/visura-parser';
import { parsePermessoText } from '@/lib/kyc/extract-permesso';
import {
  validaParte,
  documentiRichiestiParte,
  type VisuraEstratta,
  type PermessoEstratto,
  type ParteDati,
  type OcrParte,
} from '@/lib/kyc/parte-docs';
import { extractCf } from '@/lib/kyc/extract-cf';
import type { AllowedAteco } from '@/lib/kyc/ateco';
import { computeFees } from '@/lib/pricing';
import { getTariffarioCorrente } from '@/lib/tariffario';
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

/**
 * Riferimento a un file già caricato su Vercel Blob (client upload). Il browser
 * carica i file DIRETTAMENTE su Blob (aggira il limite 4,5 MB sul body delle
 * Server Action) e passa qui solo la chiave + i metadati. Forma identica a
 * `BlobRef` lato client (@/lib/blob/upload-client).
 */
type FileRef = { key: string; name: string; size: number; type: string };

const CURRENT_YEAR = new Date().getFullYear();

export type ExtractLibrettoResult =
  | { ok: true; data: LibrettoCircolazioneData }
  | { ok: false; error: string };

/**
 * Gate condiviso dalle sei action OCR: chi non crea pratiche non ha motivo di
 * far girare l'OCR, e ogni chiamata costa un'estrazione Document AI a
 * pagamento. Un solo punto invece di ripetere il gate sei volte.
 */
async function gateCreazione(): Promise<{ ok: false; error: string } | null> {
  const gate = await requirePermesso('pratiche.create');
  return gate.ok ? null : gate;
}

export async function extractLibrettoAction(
  fronte: FileRef,
  retro: FileRef,
): Promise<ExtractLibrettoResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  // Autenticazione → permesso → scope.
  const gate = await gateCreazione();
  if (gate) return gate;

  for (const [ref, label] of [[fronte, 'fronte'], [retro, 'retro']] as const) {
    if (!ref?.key || ref.size === 0) {
      return { ok: false, error: `File libretto ${label} mancante` };
    }
    if (ref.size > MAX_LIBRETTO_BYTES) {
      return { ok: false, error: 'File troppo grande (max 10 MB)' };
    }
    if (!ACCEPTED_MIME.includes(ref.type)) {
      return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
    }
  }

  const ocr = await getOcr();

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
      const tFronte = (
        await ocr.extractText({
          buffer: await storageGetBuffer(fronte.key),
          mimeType: fronte.type,
          originalFilename: fronte.name,
        })
      ).text;
      const tRetro = (
        await ocr.extractText({
          buffer: await storageGetBuffer(retro.key),
          mimeType: retro.type,
          originalFilename: retro.name,
        })
      ).text;
      const data = parseLibrettoText(`${tFronte}\n${tRetro}`, 1);
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

/**
 * OCR del foglio complementare (ricevuta PRA): un solo PDF. Estrae il testo via
 * provider OCR e applica parseFoglioComplementareText. Best-effort: in caso di
 * errore il wizard lascia l'inserimento manuale (niente blocco).
 */
export async function extractFoglioComplementareAction(
  ref: FileRef,
): Promise<ExtractLibrettoResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  const gate = await gateCreazione();
  if (gate) return gate;
  if (!ref?.key || ref.size === 0) return { ok: false, error: 'File foglio complementare mancante' };
  if (ref.size > MAX_LIBRETTO_BYTES) return { ok: false, error: 'File troppo grande (max 10 MB)' };
  if (!ACCEPTED_MIME.includes(ref.type)) return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };

  try {
    const ocr = await getOcr();
    const t = await ocr.extractText({
      buffer: await storageGetBuffer(ref.key),
      mimeType: ref.type,
      originalFilename: ref.name,
    });
    return { ok: true, data: parseFoglioComplementareText(t.text, t.confidence) };
  } catch (e) {
    console.error('[ocr] extractFoglioComplementare failed:', (e as Error).message);
    return {
      ok: false,
      error: 'OCR non riuscito sul foglio complementare. Compila manualmente i campi del veicolo.',
    };
  }
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
  ref: FileRef,
  tipo: IdentitaTipo,
): Promise<ExtractIdentitaResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  const gate = await gateCreazione();
  if (gate) return gate;

  if (!ref?.key || ref.size === 0) {
    return { ok: false, error: 'File documento mancante' };
  }
  if (ref.size > MAX_LIBRETTO_BYTES) {
    return { ok: false, error: 'File troppo grande (max 10 MB)' };
  }
  if (!ACCEPTED_MIME.includes(ref.type)) {
    return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  }

  if (tipo !== 'CI' && tipo !== 'PASSAPORTO' && tipo !== 'PATENTE') {
    return { ok: false, error: 'Tipo documento non valido' };
  }

  try {
    const buffer = await storageGetBuffer(ref.key);
    const ocr = await getOcr();
    const text = (
      await ocr.extractText({
        buffer,
        mimeType: ref.type,
        originalFilename: ref.name,
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

export type ExtractVisuraResult =
  | { ok: true; data: VisuraEstratta }
  | { ok: false; error: string };

/**
 * OCR della visura camerale del venditore/acquirente (azienda/operatore). Estrae
 * denominazione, P.IVA, data emissione e amministratore per il cross-check
 * Visura↔azienda (vedi lib/kyc/parte-docs).
 */
export async function extractVisuraAction(ref: FileRef): Promise<ExtractVisuraResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  const gate = await gateCreazione();
  if (gate) return gate;
  if (!ref?.key || ref.size === 0) return { ok: false, error: 'File visura mancante' };
  if (ref.size > MAX_LIBRETTO_BYTES) return { ok: false, error: 'File troppo grande (max 10 MB)' };
  if (!ACCEPTED_MIME.includes(ref.type)) return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  try {
    const buffer = await storageGetBuffer(ref.key);
    const v = await extractVisura({ buffer, mimeType: ref.type, originalFilename: ref.name });
    return {
      ok: true,
      data: {
        denominazione: v.denominazione,
        partitaIva: v.partitaIva,
        dataEmissione: v.dataEmissione,
        amministratore: v.amministratore,
        // Codici ATECO: servono al gate operatore auto della minivoltura (lato
        // client per il preview; il submit ri-estrae e ri-valida autoritativo).
        ateco: v.ateco,
        atecoCodes: v.atecoCodes,
      },
    };
  } catch (e) {
    console.error('[ocr] extractVisura failed:', (e as Error).message);
    return { ok: false, error: 'OCR non riuscito sulla visura. Ricarica un file leggibile.' };
  }
}

export type ExtractPermessoResult =
  | { ok: true; data: PermessoEstratto }
  | { ok: false; error: string };

/**
 * OCR del permesso di soggiorno (venditore/acquirente straniero extra-UE).
 * Estrae cognome/nome/scadenza per il cross-check col soggetto (parte-docs).
 */
export async function extractPermessoAction(ref: FileRef): Promise<ExtractPermessoResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  const gate = await gateCreazione();
  if (gate) return gate;
  if (!ref?.key || ref.size === 0) return { ok: false, error: 'File permesso mancante' };
  if (ref.size > MAX_LIBRETTO_BYTES) return { ok: false, error: 'File troppo grande (max 10 MB)' };
  if (!ACCEPTED_MIME.includes(ref.type)) return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  try {
    const buffer = await storageGetBuffer(ref.key);
    const ocr = await getOcr();
    const text = (await ocr.extractText({ buffer, mimeType: ref.type, originalFilename: ref.name })).text;
    return { ok: true, data: parsePermessoText(text) };
  } catch (e) {
    console.error('[ocr] extractPermesso failed:', (e as Error).message);
    return { ok: false, error: 'OCR non riuscito sul permesso. Ricarica un file leggibile.' };
  }
}

export type ExtractCodiceFiscaleResult =
  | { ok: true; data: { codiceFiscale?: string } }
  | { ok: false; error: string };

/**
 * OCR della tessera sanitaria / codice fiscale (fronte). Estrae il CF per il
 * cross-check col soggetto (parte-docs). Richiesto quando l'identificazione non
 * è CIE (CI cartacea, passaporto, patente).
 */
export async function extractCodiceFiscaleAction(ref: FileRef): Promise<ExtractCodiceFiscaleResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  const gate = await gateCreazione();
  if (gate) return gate;
  if (!ref?.key || ref.size === 0) return { ok: false, error: 'File tessera sanitaria mancante' };
  if (ref.size > MAX_LIBRETTO_BYTES) return { ok: false, error: 'File troppo grande (max 10 MB)' };
  if (!ACCEPTED_MIME.includes(ref.type)) return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  try {
    const buffer = await storageGetBuffer(ref.key);
    const ocr = await getOcr();
    const text = (await ocr.extractText({ buffer, mimeType: ref.type, originalFilename: ref.name })).text;
    return { ok: true, data: { codiceFiscale: extractCf(text).codiceFiscale } };
  } catch (e) {
    console.error('[ocr] extractCodiceFiscale failed:', (e as Error).message);
    return { ok: false, error: 'OCR non riuscito sulla tessera sanitaria. Ricarica un file leggibile.' };
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
  tipoDocumento: z.enum(['LIBRETTO', 'FOGLIO_COMPLEMENTARE']).default('LIBRETTO'),
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
  flagDelegaVendita: z.boolean().default(false),
  // Prezzo di vendita del veicolo, in cent — obbligatorio.
  prezzoVenditaCent: z.coerce.number().int().positive(),
  // Snapshot OCR opzionale (così com'è arrivato dall'estrazione, pre-correzione).
  ocrData: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type VeicoloInputData = z.infer<typeof veicoloSchema>;

const tipoSoggettoEnum = z.enum([
  'PRIVATO_ITALIANO',
  'STRANIERO_EXTRA_UE',
  'AZIENDA',
  'OPERATORE_AUTO',
]);

// Variante CI (solo privato): elettronica (CIE, ha il CF) o cartacea.
const ciTipoEnum = z.enum(['CARTACEA', 'ELETTRONICA']);

/**
 * Tipi pratica multiveicolo (B7): dati di un singolo venditore (co-intestatario).
 * Arriva dal wizard come elemento dell'array `venditori` (JSON in FormData); i
 * file identità/permesso corrispondenti arrivano negli slot VEND<ordine>_*.
 */
const venditoreSchema = z.object({
  ordine: z.coerce.number().int().min(1).max(50),
  veicoloOrdine: z.coerce.number().int().min(1).max(50).default(1),
  isPG: z.boolean().default(false),
  tipoSoggetto: tipoSoggettoEnum.optional().nullable(),
  ciTipo: ciTipoEnum.optional().nullable(),
  nome: z.string().trim().max(80).optional().nullable(),
  cognome: z.string().trim().max(80).optional().nullable(),
  cf: z.string().trim().max(16).optional().nullable(),
  ragioneSociale: z.string().trim().max(160).optional().nullable(),
  piva: z.string().trim().max(11).optional().nullable(),
  telefono: z.string().trim().min(1, 'Numero di telefono del venditore obbligatorio').max(30),
  email: z.string().trim().min(1, 'Email del venditore obbligatoria').max(120).email('Email del venditore non valida'),
  docId: z.enum(['CI', 'PASSAPORTO', 'PATENTE']).default('CI'),
});

export type VenditoreInputData = z.infer<typeof venditoreSchema>;

/**
 * Co-intestatario acquirente (solo SEMPLICE): come il venditore ma senza
 * veicoloOrdine (è a livello pratica) + indirizzo di residenza opzionale.
 * I file identità arrivano negli slot COACQ<ordine>_*.
 */
const coAcquirenteSchema = z.object({
  ordine: z.coerce.number().int().min(1).max(50),
  isPG: z.boolean().default(false),
  tipoSoggetto: tipoSoggettoEnum.optional().nullable(),
  ciTipo: ciTipoEnum.optional().nullable(),
  nome: z.string().trim().max(80).optional().nullable(),
  cognome: z.string().trim().max(80).optional().nullable(),
  cf: z.string().trim().max(16).optional().nullable(),
  ragioneSociale: z.string().trim().max(160).optional().nullable(),
  piva: z.string().trim().max(11).optional().nullable(),
  telefono: z.string().trim().min(1, 'Numero di telefono del co-intestatario obbligatorio').max(30),
  email: z.string().trim().min(1, 'Email del co-intestatario obbligatoria').max(120).email('Email del co-intestatario non valida'),
  docId: z.enum(['CI', 'PASSAPORTO', 'PATENTE']).default('CI'),
  indirizzoResidenza: z.string().trim().max(250).optional().nullable(),
});

export type CoAcquirenteInputData = z.infer<typeof coAcquirenteSchema>;

// Coordinate del luogo di consegna: obbligatorie al submit (guidano la
// distribuzione a raggio). Da FormData arrivano come stringhe → coerce + range.
// Esportato standalone (oltre a essere spalmato dentro `submitSchema` sotto)
// così il test unit può validare la regola senza costruire l'intero FormData
// del wizard.
export const praticaCoordsSchema = z.object({
  lat: z.coerce.number().refine((n) => n >= -90 && n <= 90, 'lat fuori range'),
  lng: z.coerce.number().refine((n) => n >= -180 && n <= 180, 'lng fuori range'),
});

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
    .pipe(
      z
        .array(venditoreSchema)
        .min(1)
        .max(50)
        .refine(
          (arr) => new Set(arr.map((v) => v.ordine)).size === arr.length,
          { message: 'ordine venditore duplicato' },
        ),
    ),

  // Co-intestatari acquirente (solo SEMPLICE): lista JSON, default vuota.
  coAcquirenti: z
    .string()
    .optional()
    .default('[]')
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'coAcquirenti non è JSON valido' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(coAcquirenteSchema)
        .max(50)
        .refine(
          (arr) => new Set(arr.map((c) => c.ordine)).size === arr.length,
          { message: 'ordine co-intestatario duplicato' },
        ),
    ),

  // Acquirente
  acquirenteIsPG: formBool.default(false),
  acquirenteNome: z.string().trim().max(80).optional(),
  acquirenteCognome: z.string().trim().max(80).optional(),
  acquirenteCF: z.string().trim().max(16).optional(),
  acquirenteRagioneSociale: z.string().trim().max(160).optional(),
  acquirentePIVA: z.string().trim().max(11).optional(),
  acquirenteTelefono: z.string().trim().min(1, "Numero di telefono dell'acquirente obbligatorio").max(30),
  acquirenteEmail: z.string().trim().min(1, "Email dell'acquirente obbligatoria").max(120).email("Email dell'acquirente non valida"),
  acquirenteIndirizzoResidenza: z.string().trim().max(250).optional(),

  // Flag
  flagCointestazione: formBool.default(false),
  flagMinivoltura: formBool.default(false),
  flagProcura: formBool.default(false),
  flagSuccessione: formBool.default(false),
  flagMinore: formBool.default(false),

  // Schema Documentale v7 (SD-B): branching variables.
  // Quelle del venditore sono ora per-venditore (vedi `venditori` sopra).
  acquirenteTipoSoggetto: tipoSoggettoEnum.optional(),
  acquirenteCiTipo: ciTipoEnum.optional(),

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
  // Coordinate del luogo di consegna: obbligatorie al submit (guidano la
  // distribuzione a raggio, vedi `praticaCoordsSchema` sopra per il dettaglio).
  ...praticaCoordsSchema.shape,

  // Sistema Penali Broker (SP-A): popup di responsabilità accettato
  dichiarazioneAccettata: formBool,
  dichiarazionePopupVersion: z.string().trim().min(1).max(20),
});

async function nextCodicePratica(): Promise<string> {
  const count = await prisma.pratica.count({ where: { codicePratica: { not: null } } });
  const n = String(count + 1).padStart(5, '0');
  return `PV-${CURRENT_YEAR}-${n}`;
}

export async function submitNuovaPraticaAction(
  formData: FormData,
): Promise<{ ok: true; id: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  const gate = await requirePermesso('pratiche.create');
  if (!gate.ok) {
    redirect(`/pratiche/nuova?error=${encodeURIComponent(gate.error)}`);
  }

  if (session.user.companyType !== 'DEALER') {
    redirect('/dashboard');
  }
  const brokerId = session.user.companyId!;
  const userId = session.user.id!;

  // Multi-sede: la pratica è creata da una sede broker. Il wizard invia la sede
  // scelta nel selettore "Sede di partenza" (campo brokerSedeId); il server la
  // valida contro le sedi accessibili. Senza id (dealer con una sola sede o
  // vista già su una singola sede) si ricade sulla sede operativa.
  const ctx = await getSessionContext();
  const submittedSedeId = formData.get('brokerSedeId');
  const operatingSede = ctx
    ? resolveSubmittedSede({
        submittedId: typeof submittedSedeId === 'string' ? submittedSedeId : null,
        currentSede: ctx.currentSede,
        accessibleSedi: ctx.accessibleSedi,
      })
    : null;
  if (!operatingSede) {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent('Seleziona una sede prima di creare una pratica')}`,
    );
  }
  const brokerSedeId = operatingSede.id;

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
  // Co-intestatari solo per SEMPLICE: fuori scope → ignorati (difensivo; la UI
  // già li nasconde/azzera). Ordine ricalcolato 1..n per coerenza con gli slot.
  const coAcquirenti = d.tipo === 'SEMPLICE' ? d.coAcquirenti : [];

  // Client uploads: i file sono già su Vercel Blob (browser → Blob diretto, per
  // aggirare il limite 4,5 MB sul body delle Server Action). Dalla FormData
  // arrivano solo le BlobRef in una mappa JSON `blobRefs` (slot → ref); i byte
  // NON transitano più dalla Server Action.
  const blobRefs: Record<string, FileRef> = (() => {
    try {
      const raw = JSON.parse(String(formData.get('blobRefs') ?? '{}')) as unknown;
      return raw && typeof raw === 'object' ? (raw as Record<string, FileRef>) : {};
    } catch {
      return {};
    }
  })();
  const getRef = (slot: string): FileRef | null => {
    const r = blobRefs[slot];
    return r && typeof r.key === 'string' && r.key.length > 0 ? r : null;
  };
  const storageName = getStorage().name;
  const refToPut = (ref: FileRef) => ({
    storageKey: ref.key,
    storageProvider: storageName,
    sizeBytes: ref.size,
    mimeType: ref.type,
    originalFilename: ref.name,
  });

  // Coerenza numeroVeicoli ↔ numero di veicoli inviati.
  if (veicoli.length !== d.numeroVeicoli) {
    redirect(
      '/pratiche/nuova?error=Numero%20veicoli%20incoerente%20con%20i%20dati%20inviati',
    );
  }

  // Guard autoritativo (bug #5/#10): nessun venditore può riferirsi a un veicolo
  // inesistente. Senza questo, un venditore orfano (veicoloOrdine > veicoli.length,
  // p.es. dopo aver ridotto il numero veicoli) verrebbe persistito con
  // veicoloId=null, scollegato da ogni veicolo e col cross-check saltato.
  if (venditori.some((v) => v.veicoloOrdine < 1 || v.veicoloOrdine > veicoli.length)) {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        'Un venditore è associato a un veicolo inesistente. Riprova.',
      )}`,
    );
  }

  // Invariante MINIVOLTURA (bug #6): l'acquirente DEVE essere un commerciante
  // d'auto (operatore auto, persona giuridica con visura). Lo forziamo qui
  // lato server — la UI lo impone già, ma un submit costruito a mano (FormData
  // o bozza) potrebbe aggirarlo e creare una minivoltura con acquirente privato.
  if (
    d.tipo === 'MINIVOLTURA' &&
    !(d.acquirenteIsPG && d.acquirenteTipoSoggetto === 'OPERATORE_AUTO')
  ) {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        "Nella minivoltura l'acquirente deve essere un commerciante d'auto (operatore auto con visura).",
      )}`,
    );
  }

  // Documento di circolazione per ciascun veicolo. Due forme:
  //  - LIBRETTO: fronte + retro (slot LIBRETTO_<i>_FRONTE / _RETRO), entrambi
  //    obbligatori (il retro può portare etichette di trasferimento).
  //  - FOGLIO_COMPLEMENTARE: un solo PDF (slot FOGLIO_COMPLEMENTARE_<i>), più
  //    gli allegati OPZIONALI del libretto originale (slot
  //    LIBRETTO_ORIGINALE_<i>_FRONTE/_RETRO): puri allegati, niente OCR, non
  //    obbligatori.
  type VeicoloDocRef =
    | { tipo: 'LIBRETTO'; fronte: FileRef; retro: FileRef }
    | {
        tipo: 'FOGLIO_COMPLEMENTARE';
        foglio: FileRef;
        libOrigFronte?: FileRef;
        libOrigRetro?: FileRef;
      };
  const veicoloDocRefs: VeicoloDocRef[] = [];
  for (let i = 1; i <= veicoli.length; i++) {
    if (veicoli[i - 1]!.tipoDocumento === 'FOGLIO_COMPLEMENTARE') {
      const rFoglio = getRef(`FOGLIO_COMPLEMENTARE_${i}`);
      if (!rFoglio || rFoglio.size === 0) {
        redirect(`/pratiche/nuova?error=Foglio%20complementare%20veicolo%20${i}%20mancante`);
      }
      if (rFoglio!.size > MAX_LIBRETTO_BYTES) {
        redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
      }
      // Libretto originale (fronte/retro): OPZIONALE, nessun redirect se assente.
      // Valida solo la size se presente.
      const rLibOrigFronte = getRef(`LIBRETTO_ORIGINALE_${i}_FRONTE`);
      if (rLibOrigFronte && rLibOrigFronte.size > MAX_LIBRETTO_BYTES) {
        redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
      }
      const rLibOrigRetro = getRef(`LIBRETTO_ORIGINALE_${i}_RETRO`);
      if (rLibOrigRetro && rLibOrigRetro.size > MAX_LIBRETTO_BYTES) {
        redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
      }
      veicoloDocRefs.push({
        tipo: 'FOGLIO_COMPLEMENTARE',
        foglio: rFoglio!,
        ...(rLibOrigFronte && rLibOrigFronte.size > 0 ? { libOrigFronte: rLibOrigFronte } : {}),
        ...(rLibOrigRetro && rLibOrigRetro.size > 0 ? { libOrigRetro: rLibOrigRetro } : {}),
      });
      continue;
    }
    const rFronte = getRef(`LIBRETTO_${i}_FRONTE`);
    const rRetro = getRef(`LIBRETTO_${i}_RETRO`);
    if (!rFronte || rFronte.size === 0) {
      redirect(`/pratiche/nuova?error=Libretto%20fronte%20veicolo%20${i}%20mancante`);
    }
    if (!rRetro || rRetro.size === 0) {
      redirect(`/pratiche/nuova?error=Libretto%20retro%20veicolo%20${i}%20mancante`);
    }
    if (rFronte!.size > MAX_LIBRETTO_BYTES || rRetro!.size > MAX_LIBRETTO_BYTES) {
      redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
    }
    veicoloDocRefs.push({ tipo: 'LIBRETTO', fronte: rFronte!, retro: rRetro! });
  }

  // Sistema Penali Broker (SP-A): la dichiarazione popup è bloccante
  if (!d.dichiarazioneAccettata) {
    redirect(
      '/pratiche/nuova?error=Devi%20accettare%20la%20dichiarazione%20di%20responsabilita%20prima%20di%20inviare',
    );
  }

  // Schema Documentale v7 (SD-B): l'engine deterministic calcola la lista
  // documenti richiesti dalla combinazione di variabili compilate dal broker.
  // Il comodato d'uso non è più ostativo. Se INPUT_INCOMPLETO (o BLOCCO, kind
  // generico riservato a blocchi futuri), redirect con motivo. Server-side è la
  // fonte autoritativa, il wizard usa lo stesso engine per UI in tempo reale.
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
      ciTipo: v.ciTipo ?? null,
    })),
    flagProcura: d.flagProcura,
    flagSuccessione: d.flagSuccessione,
    acquirenteTipoSoggetto: d.acquirenteTipoSoggetto ?? null,
    acquirenteDocumentoIdentita: d.acquirenteDocumentoIdentita,
    acquirenteCiTipo: d.acquirenteCiTipo ?? null,
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

  // Delega/procura a vendere: se il broker ha selezionato Sì per un veicolo,
  // entrambi gli allegati sono obbligatori (solo presenza, nessuna validazione
  // di contenuto). Server-side è la fonte autoritativa.
  const delegaCompleta = delegaDocsComplete(veicoli, (k) => !!getRef(k));
  if (!delegaCompleta) {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        'Per i veicoli con delega/procura a vendere servono il documento del delegato e la procura notarile.',
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
    ref: FileRef;
  };
  const docCandidates: DocUploadCandidate[] = [];
  const gatingCandidates: GatingCandidate[] = [];
  for (const docReq of richiesti) {
    const r = getRef(`DOC__${docKey(docReq)}`);
    if (!r || r.size === 0) {
      redirect(
        `/pratiche/nuova?error=${encodeURIComponent(
          `Manca un documento richiesto: ${docLabel(docReq)}`,
        )}`,
      );
    }
    const ref = r!;
    if (ref.size > MAX_LIBRETTO_BYTES) {
      redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
    }
    if (!ACCEPTED_MIME.includes(ref.type)) {
      redirect(
        `/pratiche/nuova?error=${encodeURIComponent(
          `Formato non supportato per ${docLabel(docReq)} (PDF/JPG/PNG)`,
        )}`,
      );
    }
    docCandidates.push({ d: docReq, ref });
    // P1.1 — Hard-block pre-invio: classifica i documenti allegati e blocca il
    // submit se almeno uno NON passa il gating rule-based. L'owner serve solo
    // come etichetta diagnostica nel messaggio d'errore.
    gatingCandidates.push({
      owner: parteToOwner(docReq.parte) === 'ACQUIRENTE' ? 'acquirente' : 'venditore',
      tipo: docReq.tipo,
      mimeType: ref.type,
      sizeBytes: ref.size,
      originalFilename: ref.name,
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
    tipo:
      | 'CI_FRONTE'
      | 'CI_RETRO'
      | 'PASSAPORTO'
      | 'PATENTE'
      | 'PATENTE_RETRO'
      | 'CODICE_FISCALE'
      | 'CODICE_FISCALE_RETRO'
      | 'PERMESSO_SOGGIORNO'
      | 'VISURA_CAMERALE';
    owner: 'VENDITORE' | 'ACQUIRENTE';
    // Per i documenti del venditore, l'ordine 1..n del venditore a cui il
    // documento appartiene (serve per il linkage Documento.venditoreId).
    venditoreOrdine?: number;
    // Per i documenti di un co-intestatario acquirente, l'ordine 1..n del
    // co-intestatario a cui il documento appartiene.
    coAcquirenteOrdine?: number;
    ref: FileRef;
  };
  const identitaCandidates: IdentitaDocCandidate[] = [];

  const validateIdentitaRef = (ref: FileRef, label: string): FileRef => {
    if (ref.size > MAX_LIBRETTO_BYTES) {
      redirect('/pratiche/nuova?error=File%20troppo%20grande%20(max%2010%20MB)');
    }
    if (!ACCEPTED_MIME.includes(ref.type)) {
      redirect(
        `/pratiche/nuova?error=${encodeURIComponent(
          `Formato non supportato per ${label} (PDF/JPG/PNG)`,
        )}`,
      );
    }
    return ref;
  };

  // Raccoglie i file identità di una parte secondo il tipo di documento scelto.
  // Slot CI: <PREFIX>_ID_FRONTE + <PREFIX>_ID_RETRO; patente: _ID_FRONTE/_ID_RETRO;
  // passaporto: <PREFIX>_ID. Permesso opzionale: <PREFIX>_PERMESSO. Per i venditori
  // `venditoreOrdine` tagga i candidati per il successivo linkage al Venditore.
  const collectIdentita = (
    owner: 'VENDITORE' | 'ACQUIRENTE',
    prefix: string,
    documentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
    labelParte: string,
    richiedeCf: boolean,
    venditoreOrdine?: number,
    coAcquirenteOrdine?: number,
  ): void => {
    const missingMsg = `/pratiche/nuova?error=${encodeURIComponent(
      `Documento d'identità mancante per ${labelParte}`,
    )}`;
    if (documentoIdentita === 'CI' || documentoIdentita === 'PATENTE') {
      const fronte = getRef(`${prefix}_ID_FRONTE`);
      const retro = getRef(`${prefix}_ID_RETRO`);
      if (!fronte || fronte.size === 0 || !retro || retro.size === 0) {
        redirect(missingMsg);
      }
      const [tFronte, tRetro] = documentoIdentita === 'CI'
        ? (['CI_FRONTE', 'CI_RETRO'] as const)
        : (['PATENTE', 'PATENTE_RETRO'] as const);
      identitaCandidates.push({
        tipo: tFronte,
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(fronte!, "documento d'identità"),
      });
      identitaCandidates.push({
        tipo: tRetro,
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(retro!, "documento d'identità"),
      });
    } else {
      // solo PASSAPORTO: slot singolo _ID → tipo 'PASSAPORTO'
      const id = getRef(`${prefix}_ID`);
      if (!id || id.size === 0) {
        redirect(missingMsg);
      }
      identitaCandidates.push({
        tipo: 'PASSAPORTO',
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(id!, "documento d'identità"),
      });
    }

    if (richiedeCf) {
      const cf = getRef(`${prefix}_CF`);
      const cfRetro = getRef(`${prefix}_CF_RETRO`);
      if (!cf || cf.size === 0 || !cfRetro || cfRetro.size === 0) {
        redirect(
          `/pratiche/nuova?error=${encodeURIComponent(
            `Tessera sanitaria / codice fiscale (fronte e retro) mancante per ${labelParte}`,
          )}`,
        );
      }
      identitaCandidates.push({
        tipo: 'CODICE_FISCALE',
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(cf!, 'tessera sanitaria / codice fiscale'),
      });
      identitaCandidates.push({
        tipo: 'CODICE_FISCALE_RETRO',
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(cfRetro!, 'tessera sanitaria / codice fiscale (retro)'),
      });
    }

    const permesso = getRef(`${prefix}_PERMESSO`);
    if (permesso && permesso.size > 0) {
      identitaCandidates.push({
        tipo: 'PERMESSO_SOGGIORNO',
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(permesso, 'permesso di soggiorno'),
      });
    }

    // Visura camerale (azienda/operatore): slot <PREFIX>_VISURA. La presenza
    // obbligatoria per le PG è imposta dalla verifica fail-closed più sotto.
    const visura = getRef(`${prefix}_VISURA`);
    if (visura && visura.size > 0) {
      // Solo PDF: la visura è multipagina e l'OCR deve leggerla tutta (ATECO,
      // data, sede, rappresentante). Un'immagine/ritaglio perderebbe pagine.
      if (visura.type !== 'application/pdf') {
        redirect(
          `/pratiche/nuova?error=${encodeURIComponent(
            `La visura camerale di ${labelParte} deve essere in PDF (con tutte le pagine).`,
          )}`,
        );
      }
      identitaCandidates.push({
        tipo: 'VISURA_CAMERALE',
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(visura, 'visura camerale'),
      });
    }
  };

  // Un blocco di file identità per ciascun venditore (slot VEND<ordine>_*).
  for (const v of venditori) {
    const label =
      venditori.length > 1 ? `il venditore ${v.ordine}` : 'il venditore';
    const richiedeCf = documentiRichiestiParte({
      isPersonaGiuridica: v.isPG,
      tipoSoggetto: v.tipoSoggetto ?? null,
      documentoIdentita: v.docId,
      ciTipo: v.ciTipo ?? null,
    }).codiceFiscale;
    collectIdentita('VENDITORE', `VEND${v.ordine}`, v.docId, label, richiedeCf, v.ordine);
  }
  const richiedeCfAcq = documentiRichiestiParte({
    isPersonaGiuridica: d.acquirenteIsPG,
    tipoSoggetto: d.acquirenteTipoSoggetto ?? null,
    documentoIdentita: d.acquirenteDocumentoIdentita,
    ciTipo: d.acquirenteCiTipo ?? null,
  }).codiceFiscale;
  collectIdentita('ACQUIRENTE', 'ACQ', d.acquirenteDocumentoIdentita, "l'acquirente", richiedeCfAcq);

  // Un blocco di file identità per ciascun co-intestatario (slot COACQ<ordine>_*).
  for (const c of coAcquirenti) {
    const label = `il co-intestatario ${c.ordine}`;
    const richiedeCf = documentiRichiestiParte({
      isPersonaGiuridica: c.isPG,
      tipoSoggetto: c.tipoSoggetto ?? null,
      documentoIdentita: c.docId,
      ciTipo: c.ciTipo ?? null,
    }).codiceFiscale;
    collectIdentita('ACQUIRENTE', `COACQ${c.ordine}`, c.docId, label, richiedeCf, undefined, c.ordine);
  }

  // Cross-check insiemistico venditori ↔ intestatari PER VEICOLO (server-side,
  // autoritativo): i venditori del veicolo i devono coincidere con gli
  // intestatari del libretto i (C.2 + C.3), con fallback al proprietarioAttuale
  // editabile. MISMATCH blocca il submit; OK/SCONOSCIUTO proseguono.
  // Bug #7: gli intestatari del libretto vengono RI-ESTRATTI server-side (non ci
  // fidiamo dell'ocrData inviato dal client, forgiabile per forzare un OK). Il
  // server OCR è la fonte autoritativa quando riesce; se l'OCR fallisce si
  // ripiega best-effort sull'ocrData client / proprietarioAttuale per non
  // introdurre un nuovo hard-fail di disponibilità sul submit.
  const clientProprietari = (v: (typeof veicoli)[number]): string[] | null => {
    const raw = (v.ocrData as { proprietari?: unknown } | null | undefined)?.proprietari;
    return Array.isArray(raw)
      ? raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : null;
  };
  const ocrProprietariLibretto = async (docRef: VeicoloDocRef): Promise<string[] | null> => {
    if (docRef.tipo !== 'LIBRETTO') return null;
    try {
      const ocr = await getOcr();
      const [tF, tR] = await Promise.all([
        ocr.extractText({
          buffer: await storageGetBuffer(docRef.fronte.key),
          mimeType: docRef.fronte.type,
          originalFilename: docRef.fronte.name,
        }),
        ocr.extractText({
          buffer: await storageGetBuffer(docRef.retro.key),
          mimeType: docRef.retro.type,
          originalFilename: docRef.retro.name,
        }),
      ]);
      const data = parseLibrettoText(`${tF.text}\n${tR.text}`, 1);
      return (data.proprietari ?? []).filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0,
      );
    } catch {
      return null; // OCR fallita: fallback best-effort sotto
    }
  };
  const proprietariEntries = await Promise.all(
    veicoli.map(async (v, i): Promise<readonly [number, string[]]> => {
      const clientProps = clientProprietari(v);
      if (v.tipoDocumento === 'FOGLIO_COMPLEMENTARE') {
        // Foglio: cross-check solo se l'OCR ha letto l'intestatario (niente
        // fallback al proprietarioAttuale manuale, per evitare MISMATCH spuri).
        return [i + 1, clientProps ?? []] as const;
      }
      const serverOcr = await ocrProprietariLibretto(veicoloDocRefs[i]!);
      // serverOcr: [] = OCR ok senza intestatari letti (→ SCONOSCIUTO, non si
      // blocca) ma comunque autoritativo; null = OCR fallita → fallback client.
      return [
        i + 1,
        serverOcr ?? clientProps ?? (v.proprietarioAttuale ? [v.proprietarioAttuale] : []),
      ] as const;
    }),
  );
  const proprietariPerVeicolo: Record<number, string[]> = Object.fromEntries(proprietariEntries);
  const cc = crossCheckPerVeicolo(
    venditori.map((v) => ({
      veicoloOrdine: v.veicoloOrdine,
      isPG: v.isPG,
      nome: v.nome ?? undefined,
      cognome: v.cognome ?? undefined,
      ragioneSociale: v.ragioneSociale ?? undefined,
    })),
    proprietariPerVeicolo,
    { flagProcura: d.flagProcura },
  );
  if (cc === 'MISMATCH') {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        "I venditori non corrispondono agli intestatari del libretto",
      )}`,
    );
  }

  // Verifica documentale fail-closed (autoritativa): per ogni parte ri-eseguiamo
  // l'OCR dei documenti caricati e confrontiamo coi dati inseriti
  // (lib/kyc/parte-docs). Se un documento non corrisponde, è scaduto o non è
  // leggibile → blocco. Lo stesso controllo gira nel wizard per il feedback.
  const ocrParteServer = async (
    prefix: string,
    docId: 'CI' | 'PASSAPORTO' | 'PATENTE',
  ): Promise<OcrParte> => {
    const out: OcrParte = {};
    const idRef = docId === 'CI' || docId === 'PATENTE' ? getRef(`${prefix}_ID_FRONTE`) : getRef(`${prefix}_ID`);
    if (idRef) {
      const text = (
        await (await getOcr()).extractText({
          buffer: await storageGetBuffer(idRef.key),
          mimeType: idRef.type,
          originalFilename: idRef.name,
        })
      ).text;
      out.identita = extractIdentita(text, docId);
    }
    const vRef = getRef(`${prefix}_VISURA`);
    if (vRef) {
      out.visura = await extractVisura({
        buffer: await storageGetBuffer(vRef.key),
        mimeType: vRef.type,
        originalFilename: vRef.name,
      });
    }
    const pRef = getRef(`${prefix}_PERMESSO`);
    if (pRef) {
      const text = (
        await (await getOcr()).extractText({
          buffer: await storageGetBuffer(pRef.key),
          mimeType: pRef.type,
          originalFilename: pRef.name,
        })
      ).text;
      out.permesso = parsePermessoText(text);
    }
    const cfRef = getRef(`${prefix}_CF`);
    if (cfRef) {
      const text = (
        await (await getOcr()).extractText({
          buffer: await storageGetBuffer(cfRef.key),
          mimeType: cfRef.type,
          originalFilename: cfRef.name,
        })
      ).text;
      out.codiceFiscale = { codiceFiscale: extractCf(text).codiceFiscale };
    }
    return out;
  };

  // ATECO commercianti auto (allowlist DEALER, gestita da admin in /admin/ateco).
  // Serve per OGNI società coinvolta: decide se la visura è di un commerciante
  // d'auto e quindi se applicare la freschezza ≤6 mesi. Il BLOCCO "deve essere
  // commerciante" resta solo per l'acquirente della minivoltura (richiedeOperatoreAuto).
  const atecoAllowedDealer: AllowedAteco[] = await prisma.atecoAllowedCode.findMany({
    where: { companyType: 'DEALER', active: true },
    select: { companyType: true, code: true, active: true },
  });

  const partiDaVerificare: {
    parte: ParteDati;
    prefix: string;
    docId: 'CI' | 'PASSAPORTO' | 'PATENTE';
    label: string;
    richiedeOperatoreAuto: boolean;
  }[] = [
    ...venditori.map((v) => ({
      parte: {
        isPersonaGiuridica: v.isPG,
        tipoSoggetto: v.tipoSoggetto ?? null,
        nome: v.nome ?? undefined,
        cognome: v.cognome ?? undefined,
        cf: v.cf ?? undefined,
        ragioneSociale: v.ragioneSociale ?? undefined,
        piva: v.piva ?? undefined,
        documentoIdentita: v.docId,
      } satisfies ParteDati,
      prefix: `VEND${v.ordine}`,
      docId: v.docId,
      label: venditori.length > 1 ? `Venditore ${v.ordine}` : 'Venditore',
      richiedeOperatoreAuto: false,
    })),
    {
      parte: {
        isPersonaGiuridica: d.acquirenteIsPG,
        tipoSoggetto: d.acquirenteTipoSoggetto ?? null,
        nome: d.acquirenteNome,
        cognome: d.acquirenteCognome,
        cf: d.acquirenteCF,
        ragioneSociale: d.acquirenteRagioneSociale,
        piva: d.acquirentePIVA,
        documentoIdentita: d.acquirenteDocumentoIdentita,
      } satisfies ParteDati,
      prefix: 'ACQ',
      docId: d.acquirenteDocumentoIdentita,
      label: 'Acquirente',
      // L'acquirente della minivoltura DEVE essere commerciante d'auto.
      richiedeOperatoreAuto: d.tipo === 'MINIVOLTURA',
    },
    ...coAcquirenti.map((c) => ({
      parte: {
        isPersonaGiuridica: c.isPG,
        tipoSoggetto: c.tipoSoggetto ?? null,
        nome: c.nome ?? undefined,
        cognome: c.cognome ?? undefined,
        cf: c.cf ?? undefined,
        ragioneSociale: c.ragioneSociale ?? undefined,
        piva: c.piva ?? undefined,
        documentoIdentita: c.docId,
      } satisfies ParteDati,
      prefix: `COACQ${c.ordine}`,
      docId: c.docId,
      label: `Co-intestatario ${c.ordine}`,
      richiedeOperatoreAuto: false,
    })),
  ];

  const verificheParti = await Promise.all(
    partiDaVerificare.map(async (x) => ({
      label: x.label,
      esito: validaParte(x.parte, await ocrParteServer(x.prefix, x.docId), new Date(), {
        atecoAllowed: atecoAllowedDealer,
        richiedeOperatoreAuto: x.richiedeOperatoreAuto,
      }),
    })),
  );
  const parteKo = verificheParti.find((v) => !v.esito.ok);
  if (parteKo) {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        `${parteKo.label} — ${parteKo.esito.problemi[0] ?? 'documenti non validi'}`,
      )}`,
    );
  }

  // Pricing derivato dal tipo + numero veicoli (engine in lib/pricing.ts).
  const tariffario = await getTariffarioCorrente();
  const fees = computeFees({ tipo: d.tipo, numeroVeicoli: d.numeroVeicoli }, tariffario);
  const feeAgenziaCent = fees.feeAgenziaCent;
  const creditoBrokerCent = fees.creditoBrokerCent;

  const codicePratica = await nextCodicePratica();
  const now = new Date();

  // I file sono già su Vercel Blob (client upload): non serve ri-caricarli.
  // Mappiamo ogni BlobRef nella forma StoragePutResult attesa dalle create
  // Documento (storageKey = chiave Blob, niente trasferimento di byte).
  const ocrManuale = formData.get('ocrManuale') === 'true';
  const veicoloDocUploads = veicoloDocRefs.map((vd) =>
    vd.tipo === 'FOGLIO_COMPLEMENTARE'
      ? {
          tipo: 'FOGLIO_COMPLEMENTARE' as const,
          foglio: refToPut(vd.foglio),
          libOrigFronte: vd.libOrigFronte ? refToPut(vd.libOrigFronte) : undefined,
          libOrigRetro: vd.libOrigRetro ? refToPut(vd.libOrigRetro) : undefined,
        }
      : { tipo: 'LIBRETTO' as const, fronte: refToPut(vd.fronte), retro: refToPut(vd.retro) },
  );

  // Schema Documentale v7 (SD-B): documenti richiesti.
  const docUploads = docCandidates.map(({ d: docReq, ref }) => ({
    d: docReq,
    put: refToPut(ref),
  }));

  // Tipi pratica multiveicolo (A8): documenti d'identità/permesso per parte.
  const identitaUploads = identitaCandidates.map((cand) => ({
    tipo: cand.tipo,
    owner: cand.owner,
    venditoreOrdine: cand.venditoreOrdine,
    coAcquirenteOrdine: cand.coAcquirenteOrdine,
    put: refToPut(cand.ref),
  }));

  // Delega/procura a vendere: due allegati per veicolo con flag (presenza già
  // verificata sopra). Nessun OCR/gating: solo persistenza, linkati al veicolo.
  const delegaUploads = veicoli.flatMap((v, i) => {
    if (!v.flagDelegaVendita) return [];
    const ord = i + 1;
    return [
      {
        veicoloOrdine: ord,
        tipo: 'DOCUMENTO_DELEGATO' as const,
        put: refToPut(getRef(delegatoDocKey(ord))!),
      },
      {
        veicoloOrdine: ord,
        tipo: 'DELEGA_VENDITA' as const,
        put: refToPut(getRef(procuraDelegaDocKey(ord))!),
      },
    ];
  });

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

      // Chi sta creando la pratica. Le email successive (accettata, processata,
      // sollecito) partono quando la sua sessione non esiste più: senza questa
      // colonna finirebbero all'admin dell'azienda madre.
      creatoDaUserId: userId,

      // Dati venditore: ora normalizzati in N righe Venditore (vedi sotto).

      acquirenteIsPersonaGiuridica: d.acquirenteIsPG,
      acquirenteNome: d.acquirenteIsPG ? null : d.acquirenteNome,
      acquirenteCognome: d.acquirenteIsPG ? null : d.acquirenteCognome,
      acquirenteCF: d.acquirenteIsPG ? null : d.acquirenteCF?.toUpperCase(),
      acquirenteRagioneSociale: d.acquirenteIsPG ? d.acquirenteRagioneSociale : null,
      acquirentePIVA: d.acquirenteIsPG ? d.acquirentePIVA : null,
      acquirenteTelefono: d.acquirenteTelefono || null,
      acquirenteEmail: d.acquirenteEmail?.toLowerCase() || null,
      acquirenteIndirizzoResidenza: d.acquirenteIndirizzoResidenza || null,

      // Derivato server-side (bug #12): il client non invia mai questo flag.
      // C'è cointestazione se più venditori o almeno un co-intestatario acquirente.
      flagCointestazione: venditori.length > 1 || coAcquirenti.length > 0,
      flagMinivoltura: d.tipo === 'MINIVOLTURA',
      flagProcura: d.flagProcura,

      comune: d.comune,
      provincia: d.provincia,
      lat: d.lat,
      lng: d.lng,

      // Schema Documentale v7 (SD-B): branching variables persistite.
      // Quelle del venditore sono ora per-venditore (modello Venditore, sotto).
      // Le date visura/permesso non sono più raccolte (verifica via OCR nello
      // step parte): le colonne restano null.
      acquirenteTipoSoggetto: d.acquirenteTipoSoggetto ?? null,
      // Variante CI persistita per ogni tipo soggetto (non più solo privato): la
      // cartacea richiede il CF anche per PG (legale rappresentante) e straniero.
      acquirenteCiTipo: d.acquirenteCiTipo ?? null,
      flagSuccessione: d.flagSuccessione,
      flagMinore: d.flagMinore,

      brokerId,
      brokerSedeId,
      feeAgenziaCent,
      creditoBrokerCent,

      submittedAt: now,
    },
  });

    // Un Veicolo per elemento (ordine 1..n) + i libretti (fronte + retro)
    // collegati come due righe Documento: LIBRETTO_CIRCOLAZIONE (fronte) e
    // LIBRETTO_CIRCOLAZIONE_RETRO (retro).
    const veicoloIdByOrdine = new Map<number, string>();
    for (let i = 0; i < veicoli.length; i++) {
      const v = veicoli[i]!;
      const docUp = veicoloDocUploads[i]!;
      const veicolo = await tx.veicolo.create({
        data: {
          praticaId: created.id,
          ordine: i + 1,
          tipoDocumento: v.tipoDocumento,
          targa: v.targa.toUpperCase(),
          telaio: v.telaio.toUpperCase(),
          proprietarioAttuale: v.proprietarioAttuale,
          dataImmatricolazione: v.dataImmatricolazione
            ? new Date(v.dataImmatricolazione)
            : null,
          preImm2015: v.preImm2015,
          flagComodatoDuso: v.flagComodatoDuso,
          flagDelegaVendita: v.flagDelegaVendita,
          prezzoVenditaCent: v.prezzoVenditaCent,
          // OCR: il libretto ce l'ha sempre; il foglio complementare solo se
          // l'OCR best-effort è andato a buon fine.
          ocrData: (v.ocrData ?? undefined) as Prisma.InputJsonValue | undefined,
          ocrProvider: v.ocrData ? env.OCR_PROVIDER : null,
          ocrAt: v.ocrData ? now : null,
        },
      });
      veicoloIdByOrdine.set(i + 1, veicolo.id);

      // Foglio complementare: un solo Documento, niente retro. OCR best-effort.
      if (docUp.tipo === 'FOGLIO_COMPLEMENTARE') {
        await tx.documento.create({
          data: {
            tipo: 'FOGLIO_COMPLEMENTARE',
            praticaId: created.id,
            veicoloId: veicolo.id,
            storageKey: docUp.foglio.storageKey,
            storageProvider: docUp.foglio.storageProvider,
            mimeType: docUp.foglio.mimeType,
            sizeBytes: docUp.foglio.sizeBytes,
            originalFilename: docUp.foglio.originalFilename,
            uploadedById: userId,
            ocrStato: v.ocrData ? 'SUCCESS' : 'NONE',
            ocrProvider: v.ocrData ? env.OCR_PROVIDER : null,
            ocrData: (v.ocrData ?? undefined) as Prisma.InputJsonValue | undefined,
            ocrAt: v.ocrData ? now : null,
            gatingStato: 'PASSED',
          },
        });
        // Libretto originale (fronte/retro): allegati OPZIONALI, puri (nessun
        // OCR). Riusano i tipi Documento esistenti del libretto standard, così
        // non serve una migration. Creati solo se presenti.
        if (docUp.libOrigFronte) {
          await tx.documento.create({
            data: {
              tipo: 'LIBRETTO_CIRCOLAZIONE',
              praticaId: created.id,
              veicoloId: veicolo.id,
              storageKey: docUp.libOrigFronte.storageKey,
              storageProvider: docUp.libOrigFronte.storageProvider,
              mimeType: docUp.libOrigFronte.mimeType,
              sizeBytes: docUp.libOrigFronte.sizeBytes,
              originalFilename: docUp.libOrigFronte.originalFilename,
              uploadedById: userId,
              ocrStato: 'NONE',
              gatingStato: 'PASSED',
            },
          });
        }
        if (docUp.libOrigRetro) {
          await tx.documento.create({
            data: {
              tipo: 'LIBRETTO_CIRCOLAZIONE_RETRO',
              praticaId: created.id,
              veicoloId: veicolo.id,
              storageKey: docUp.libOrigRetro.storageKey,
              storageProvider: docUp.libOrigRetro.storageProvider,
              mimeType: docUp.libOrigRetro.mimeType,
              sizeBytes: docUp.libOrigRetro.sizeBytes,
              originalFilename: docUp.libOrigRetro.originalFilename,
              uploadedById: userId,
              ocrStato: 'NONE',
              gatingStato: 'PASSED',
            },
          });
        }
        continue;
      }

      const uploadFronte = docUp.fronte;
      const uploadRetro = docUp.retro;

      const ocrSnapshot: Prisma.InputJsonValue = {
        targa: v.targa,
        telaio: v.telaio,
        proprietarioAttuale: v.proprietarioAttuale,
        dataImmatricolazione: v.dataImmatricolazione ?? null,
        preImm2015: v.preImm2015,
        flagComodatoDuso: v.flagComodatoDuso,
        ocrManuale,
      };

      // Fronte: porta l'OCR snapshot e il verdict.
      await tx.documento.create({
        data: {
          tipo: 'LIBRETTO_CIRCOLAZIONE',
          praticaId: created.id,
          veicoloId: veicolo.id,
          storageKey: uploadFronte.storageKey,
          storageProvider: uploadFronte.storageProvider,
          mimeType: uploadFronte.mimeType,
          sizeBytes: uploadFronte.sizeBytes,
          originalFilename: uploadFronte.originalFilename,
          uploadedById: userId,
          ocrStato: ocrManuale ? 'FAILED' : 'SUCCESS',
          ocrProvider: env.OCR_PROVIDER,
          ocrData: ocrSnapshot,
          ocrAt: now,
          gatingStato: 'PASSED',
        },
      });
      // Retro: nessun OCR autonomo (contribuisce all'OCR combinato del fronte).
      await tx.documento.create({
        data: {
          tipo: 'LIBRETTO_CIRCOLAZIONE_RETRO',
          praticaId: created.id,
          veicoloId: veicolo.id,
          storageKey: uploadRetro.storageKey,
          storageProvider: uploadRetro.storageProvider,
          mimeType: uploadRetro.mimeType,
          sizeBytes: uploadRetro.sizeBytes,
          originalFilename: uploadRetro.originalFilename,
          uploadedById: userId,
          ocrStato: 'NONE',
          gatingStato: 'PASSED',
        },
      });
    }

    // Delega/procura a vendere: righe Documento linkate al veicolo (no OCR,
    // gating non applicabile → PASSED). veicoloIdByOrdine è già popolata sopra.
    for (const u of delegaUploads) {
      await tx.documento.create({
        data: {
          tipo: u.tipo,
          owner: 'VENDITORE',
          praticaId: created.id,
          veicoloId: veicoloIdByOrdine.get(u.veicoloOrdine) ?? null,
          storageKey: u.put.storageKey,
          storageProvider: u.put.storageProvider,
          mimeType: u.put.mimeType,
          sizeBytes: u.put.sizeBytes,
          originalFilename: u.put.originalFilename,
          uploadedById: userId,
          ocrStato: 'NONE',
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
          veicoloId: veicoloIdByOrdine.get(v.veicoloOrdine) ?? null,
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
          ciTipo: v.ciTipo ?? null,
          documentoIdentita: v.docId,
        },
      });
      venditoreIdByOrdine.set(v.ordine, venditore.id);
    }

    // Co-intestatari acquirente (solo SEMPLICE): righe CoAcquirente (ordine 1..n).
    // I documenti identità vengono poi linkati via Documento.coAcquirenteId.
    const coAcquirenteIdByOrdine = new Map<number, string>();
    for (const c of coAcquirenti) {
      const co = await tx.coAcquirente.create({
        data: {
          praticaId: created.id,
          ordine: c.ordine,
          nome: c.isPG ? null : c.nome || null,
          cognome: c.isPG ? null : c.cognome || null,
          cf: c.isPG ? null : c.cf?.toUpperCase() || null,
          isPersonaGiuridica: c.isPG,
          ragioneSociale: c.isPG ? c.ragioneSociale || null : null,
          piva: c.isPG ? c.piva || null : null,
          telefono: c.telefono || null,
          email: c.email?.toLowerCase() || null,
          tipoSoggetto: c.tipoSoggetto ?? null,
          ciTipo: c.ciTipo ?? null,
          documentoIdentita: c.docId,
          indirizzoResidenza: c.indirizzoResidenza || null,
        },
      });
      coAcquirenteIdByOrdine.set(c.ordine, co.id);
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
    for (const { tipo, owner, venditoreOrdine, coAcquirenteOrdine, put } of identitaUploads) {
      await tx.documento.create({
        data: {
          tipo: tipo as Prisma.DocumentoCreateInput['tipo'],
          owner,
          praticaId: created.id,
          venditoreId:
            owner === 'VENDITORE' && venditoreOrdine
              ? (venditoreIdByOrdine.get(venditoreOrdine) ?? null)
              : null,
          coAcquirenteId: coAcquirenteOrdine
            ? (coAcquirenteIdByOrdine.get(coAcquirenteOrdine) ?? null)
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

  // N1 — conferma invio al broker.
  // Recapito dal DB, non dalla sessione (il JWT porta l'email congelata al
  // login). Il risolutore lo garantisce, e applica la regola del super admin:
  // se a creare è il titolare, riceve anche la sede da cui ha operato.
  if (round1.assegnazioni > 0) {
    const destinatari = await destinatariBroker(pratica.id);
    // Nome breve: "dest" per non ombreggiare "d" (i dati del form, usati sotto
    // per comune/provincia e ancora in scope in questa funzione).
    for (const dest of destinatari) {
      await sendNotification({
        tipo: 'N1_BROKER_INVIO_PRATICA',
        target: { email: dest.email, userId: dest.userId, companyId: brokerId },
        payload: {
          codicePratica,
          targa: veicoli[0]!.targa,
          comune: d.comune,
          provincia: d.provincia,
          numeroAgenzie: round1.assegnazioni,
          nomeBroker: dest.nome.split(' ')[0],
        },
      }).catch(() => undefined);
    }
  }

  // Email cliente: pratica avviata. Solo se è entrata in distribuzione
  // (le pratiche "caso dubbio" restano BOZZA in attesa di revisione → niente email).
  if (round1.stato !== 'BOZZA') {
    await notifyClientiAvanzamento(pratica.id, 'AVVIATA').catch(() => undefined);
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  // Navigazione lato client nel wizard (router.push), non redirect qui: il
  // redirect da Server Action causava il fallimento del fetch RSC della
  // soft-navigation ("This page couldn't load"), risolto solo al reload.
  return { ok: true as const, id: pratica.id };
}
