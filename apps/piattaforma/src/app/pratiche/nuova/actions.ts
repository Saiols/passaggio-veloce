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
import { findBlockingDocuments, type GatingCandidate } from '@/lib/documenti/gating-block';
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
  const veicoli = d.veicoli;

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
      flagMinivoltura: d.tipo === 'MINIVOLTURA',
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
