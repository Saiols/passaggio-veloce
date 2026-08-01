'use server';

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { env } from '@/env';
import {
  canEditCrmContact,
  canDeleteCrmContact,
  canBulkImportCrm,
} from '@/lib/auth/permissions';
import { parseContactsCsv } from '@/lib/crm/csv-import';
import { normalizeTel, normalizeEmail } from '@/lib/crm/match/normalize';
import { crmNormFields } from '@/lib/crm/match/norm-fields';
import {
  SELECT_ARRICCHIMENTO,
  scollegaCampiModificati,
} from '@/lib/crm/match/arricchimento';
import { sendNotification } from '@/lib/notifiche';
import { nextStatoInvio } from '@/lib/crm/email-partenza';
import { campiRichiamoDopoCambioStato, STATO_RICHIAMARE } from '@/lib/crm/richiamo';
import { evaluatePromoCode } from '@/lib/promo/evaluate';

export type CrmContactResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const REGIONI = [
  'Abruzzo',
  'Basilicata',
  'Calabria',
  'Campania',
  'Emilia-Romagna',
  'Friuli-Venezia Giulia',
  'Lazio',
  'Liguria',
  'Lombardia',
  'Marche',
  'Molise',
  'Piemonte',
  'Puglia',
  'Sardegna',
  'Sicilia',
  'Toscana',
  'Trentino-Alto Adige',
  'Umbria',
  "Valle d'Aosta",
  'Veneto',
] as const;

const CRM_CONTACT_INPUT = z.object({
  // Anagrafica
  nome: z.string().trim().min(2).max(160),
  cat: z.enum(['BROKER', 'AGENZIA']),
  tel: z.string().trim().min(5).max(40), // sempre obbligatorio (decisione 11)
  wa: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  piva: z.string().trim().max(16).optional().or(z.literal('')),
  indirizzo: z.string().trim().max(160).optional().or(z.literal('')),
  citta: z.string().trim().max(80).optional().or(z.literal('')),
  cap: z.string().trim().max(8).optional().or(z.literal('')),
  regione: z.enum(REGIONI).optional().or(z.literal('')),

  // Stato
  status: z.enum([
    'S0', 'S1', 'S2', 'S3', 'S4', 'S5',
    'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
  ]),
  fonte: z.enum(['CSV_INIZIALE', 'ISCRIZIONE_DIRETTA', 'REFERRAL', 'ALTRO']),
  assignedToId: z.string().uuid().optional().or(z.literal('')),
  lastContactAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  nextContactAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  nextContactFascia: z.enum(['MATTINA', 'POMERIGGIO']).optional().or(z.literal('')),

  // Chiamate (aggregati editabili manualmente)
  callCount: z.coerce.number().int().min(0).default(0),
  callEsito: z
    .enum(['NON_RISPONDE', 'NON_INTERESSATO', 'INTERESSATO', 'RICHIAMA', 'ISCRITTO'])
    .optional()
    .or(z.literal('')),
  sentiment: z.enum(['POSITIVO', 'NEUTRO', 'NEGATIVO']).optional().or(z.literal('')),
  obiezioni: z.string().trim().max(500).optional().or(z.literal('')),
  noteAI: z.string().trim().max(4000).optional().or(z.literal('')),
  trascrizione: z.string().trim().max(20000).optional().or(z.literal('')),
  noteManuali: z.string().trim().max(4000).optional().or(z.literal('')),

  // Tracking
  linkInviato: z.coerce.boolean().default(false),
  linkInviatoAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  linkAperto: z.coerce.boolean().default(false),
  linkAperture: z.coerce.number().int().min(0).default(0),
  videoInviato: z.coerce.boolean().default(false),
  videoMin: z.coerce.number().int().min(0).max(600).default(0),
  mailAperta: z.coerce.boolean().default(false),
  smsInviato: z.coerce.boolean().default(false),
  waInviato: z.coerce.boolean().default(false),
  iscrizioneInit: z.coerce.boolean().default(false),
  iscrizioneComp: z.coerce.boolean().default(false),
  iscrizioneAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),

  // Piattaforma (override manuale; il sync cron li sovrascrive)
  platStatus: z.enum(['ATTIVO', 'INATTIVO', 'SOSPESO']).optional().or(z.literal('')),
  primaPratica: z.coerce.boolean().default(false),
  primaPraticaAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  praticheTotal: z.coerce.number().int().min(0).default(0),
  praticheMonth: z.coerce.number().int().min(0).default(0),
  lastAccessAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  tassoComp: z.coerce.number().int().min(0).max(100).default(0),
}).superRefine((d, ctx) => {
  // Un richiamo senza giorno non è un promemoria: è una riga che nessun
  // filtro può far riemergere.
  if (d.status === 'S11' && !d.nextContactAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextContactAt'],
      message: 'Con lo stato Richiamare serve il giorno del richiamo',
    });
  }
});

export type CrmContactInput = z.infer<typeof CRM_CONTACT_INPUT>;

function emptyToNull<T extends string | undefined>(v: T): string | null {
  if (!v || v === '') return null;
  return v;
}

function parseDate(v: string | undefined): Date | null {
  if (!v || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dataFromInput(d: CrmContactInput): Prisma.CrmContactCreateInput {
  const assignedToId = emptyToNull(d.assignedToId);
  return {
    nome: d.nome,
    cat: d.cat,
    tel: d.tel,
    wa: emptyToNull(d.wa),
    email: emptyToNull(d.email)?.toLowerCase() ?? null,
    piva: emptyToNull(d.piva),
    ...crmNormFields({ tel: d.tel, wa: d.wa, email: d.email, piva: d.piva }),
    indirizzo: emptyToNull(d.indirizzo),
    citta: emptyToNull(d.citta),
    cap: emptyToNull(d.cap),
    regione: emptyToNull(d.regione),
    status: d.status,
    fonte: d.fonte,
    assignedTo: assignedToId
      ? { connect: { id: assignedToId } }
      : undefined,
    lastContactAt: parseDate(d.lastContactAt),
    nextContactAt: parseDate(d.nextContactAt),
    nextContactFascia: emptyToNull(
      d.nextContactFascia,
    ) as Prisma.CrmContactCreateInput['nextContactFascia'],
    callCount: d.callCount,
    callEsito: emptyToNull(d.callEsito) as Prisma.CrmContactCreateInput['callEsito'],
    sentiment: emptyToNull(d.sentiment) as Prisma.CrmContactCreateInput['sentiment'],
    obiezioni: emptyToNull(d.obiezioni),
    noteAI: emptyToNull(d.noteAI),
    trascrizione: emptyToNull(d.trascrizione),
    noteManuali: emptyToNull(d.noteManuali),
    linkInviato: d.linkInviato,
    linkInviatoAt: parseDate(d.linkInviatoAt),
    linkAperto: d.linkAperto,
    linkAperture: d.linkAperture,
    videoInviato: d.videoInviato,
    videoMin: d.videoMin,
    mailAperta: d.mailAperta,
    smsInviato: d.smsInviato,
    waInviato: d.waInviato,
    iscrizioneInit: d.iscrizioneInit,
    iscrizioneComp: d.iscrizioneComp,
    iscrizioneAt: parseDate(d.iscrizioneAt),
    platStatus: emptyToNull(d.platStatus) as Prisma.CrmContactCreateInput['platStatus'],
    primaPratica: d.primaPratica,
    primaPraticaAt: parseDate(d.primaPraticaAt),
    praticheTotal: d.praticheTotal,
    praticheMonth: d.praticheMonth,
    lastAccessAt: parseDate(d.lastAccessAt),
    tassoComp: d.tassoComp,
  };
}

function dataFromInputForUpdate(
  d: CrmContactInput,
): Prisma.CrmContactUpdateInput {
  const create = dataFromInput(d);
  // Mappa la connect/disconnect per assignedTo
  const assignedToId = emptyToNull(d.assignedToId);
  return {
    ...create,
    assignedTo: assignedToId
      ? { connect: { id: assignedToId } }
      : { disconnect: true },
  };
}

export async function createCrmContactAction(
  raw: unknown,
): Promise<CrmContactResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per creare contatti CRM' };
  }

  const parsed = CRM_CONTACT_INPUT.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }

  // Anti-duplicato: query indicizzata sulle colonne normalizzate. Niente
  // overwrite: si modifica l'esistente dalla scheda.
  const norm = crmNormFields({ tel: parsed.data.tel, email: parsed.data.email });
  const orDup: Prisma.CrmContactWhereInput[] = [];
  if (norm.emailNorm) orDup.push({ emailNorm: norm.emailNorm });
  if (norm.telNorm) orDup.push({ telNorm: norm.telNorm });
  const dup =
    orDup.length > 0
      ? await prisma.crmContact.findFirst({
          where: { deletedAt: null, OR: orDup },
          select: { id: true },
        })
      : null;
  if (dup) {
    return {
      ok: false,
      error: 'Esiste già un contatto con questa email o questo telefono.',
    };
  }

  const created = await prisma.crmContact.create({
    data: dataFromInput(parsed.data),
    select: { id: true },
  });

  revalidatePath('/admin/crm/contatti');
  return { ok: true, id: created.id };
}

export async function updateCrmContactAction(
  id: string,
  raw: unknown,
): Promise<CrmContactResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per modificare contatti CRM' };
  }

  // Una lettura sola per due scopi: lo scoping SALES e i valori attuali dei
  // campi che l'iscrizione può aver riempito (servono sotto, per l'audit).
  const attuale = await prisma.crmContact.findUnique({
    where: { id },
    select: { assignedToId: true, status: true, ...SELECT_ARRICCHIMENTO },
  });

  // SALES può modificare solo i propri assegnati (decisione 7)
  if (session.user.role === 'SALES') {
    if (!attuale || attuale.assignedToId !== session.user.id) {
      return { ok: false, error: 'Puoi modificare solo i contatti a te assegnati' };
    }
  }

  const parsed = CRM_CONTACT_INPUT.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }

  const data = dataFromInputForUpdate(parsed.data);

  // Va DOPO la costruzione di `data`: se il contatto esce da S11, il richiamo
  // è chiuso e vince sui valori che il form ha comunque mandato (il campo data
  // resta compilato nella scheda finché non si ricarica).
  Object.assign(
    data,
    campiRichiamoDopoCambioStato(attuale?.status ?? '', parsed.data.status),
  );

  // Un campo ereditato dall'iscrizione e poi riscritto a mano non viene più
  // dall'iscrizione: esce dall'audit, altrimenti il pannello continuerebbe a
  // dire «Dati completati dall'iscrizione — Email» su un'email che l'ha
  // dettata un cliente al telefono. Il confronto è sui valori come finiscono
  // sul DB — si legge `data`, cioè l'oggetto che sta per essere scritto, non
  // l'input grezzo: `dataFromInput` abbassa l'email e mappa '' a null, e
  // ricalcolare quelle regole qui vorrebbe dire duplicarle.
  if (attuale?.arricchitoDa) {
    const scritto = (v: unknown): string | null =>
      typeof v === 'string' ? v : null;
    const restano = scollegaCampiModificati(attuale.arricchitoDa, attuale, {
      email: scritto(data.email),
      wa: scritto(data.wa),
      piva: scritto(data.piva),
      indirizzo: scritto(data.indirizzo),
      citta: scritto(data.citta),
      cap: scritto(data.cap),
      regione: scritto(data.regione),
    });
    data.arricchitoDa = restano;
    // Niente più campi ereditati: anche la data perde significato.
    if (!restano) data.arricchitoAt = null;
  }

  await prisma.crmContact.update({ where: { id }, data });

  revalidatePath('/admin/crm/contatti');
  return { ok: true, id };
}

export async function deleteCrmContactAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canDeleteCrmContact(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per eliminare contatti CRM' };
  }

  // Soft delete (decisione 4)
  await prisma.crmContact.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}

export async function updateCrmContactStatusAction(
  id: string,
  status: string,
  /** Presente solo quando `status` è S11: lo raccoglie il modale di riga. */
  richiamo?: { giorno: string; fascia: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per modificare contatti CRM' };
  }

  const STATI = [
    'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
  ] as const;
  if (!STATI.includes(status as (typeof STATI)[number])) {
    return { ok: false, error: 'Stato non valido' };
  }

  // Lo stato attuale serve SEMPRE, non solo ai SALES: è quello che dice se
  // questo cambio sta chiudendo un richiamo. La lettura resta incondizionata
  // per tutti i ruoli — è la RISPOSTA sotto che deve restare indistinguibile.
  const target = await prisma.crmContact.findUnique({
    where: { id },
    select: { assignedToId: true, status: true },
  });

  // SALES può modificare solo i propri assegnati (decisione 7). Id inesistente
  // e id di un contatto altrui devono tornare lo STESSO messaggio: un SALES in
  // lista vede solo i propri contatti, quindi non conosce gli id degli altri —
  // se le due risposte differissero, la action diventerebbe un oracolo per
  // scoprire quali id esistono (provando id a caso e leggendo l'errore).
  const salesBloccato =
    session.user.role === 'SALES' &&
    (!target || target.assignedToId !== session.user.id);
  if (salesBloccato) {
    return { ok: false, error: 'Puoi modificare solo i contatti a te assegnati' };
  }
  if (!target) return { ok: false, error: 'Contatto non trovato' };

  const data: Prisma.CrmContactUpdateInput = {
    status: status as (typeof STATI)[number],
    ...campiRichiamoDopoCambioStato(target.status, status),
  };

  if (status === STATO_RICHIAMARE) {
    // Stesso formato YYYY-MM-DD imposto dal regex di `CRM_CONTACT_INPUT`: la
    // action è un endpoint pubblico, non può contare sul fatto che il modale
    // (task successivo) manderà sempre un `<input type="date">`. Senza questo
    // controllo `new Date('08/04/2026')` verrebbe letta come MM/DD/YYYY.
    const giornoRaw = richiamo?.giorno ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giornoRaw)) {
      return { ok: false, error: 'Serve il giorno del richiamo.' };
    }
    const giorno = parseDate(giornoRaw);
    if (!giorno) {
      return { ok: false, error: 'Serve il giorno del richiamo.' };
    }
    const fascia = richiamo?.fascia ?? '';
    if (fascia !== '' && fascia !== 'MATTINA' && fascia !== 'POMERIGGIO') {
      return { ok: false, error: 'Fascia non valida.' };
    }
    data.nextContactAt = giorno;
    data.nextContactFascia = fascia === '' ? null : fascia;
  }

  await prisma.crmContact.update({ where: { id }, data });

  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// CSV Import / Export
// ════════════════════════════════════════════════════════

export type CsvImportResult =
  | { ok: true; created: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

/**
 * Bulk import da CSV. Parsing robusto (vedi `lib/crm/csv-import.ts`):
 * - header quotato + nomi colonna con alias/accenti (es. `Nome`, `Telefono`, `Città`);
 * - obbligatorie solo **nome** e **telefono**; la categoria, se assente nel file,
 *   usa `defaultCat` (BROKER per le liste rivenditori);
 * - riga con email duplicata → saltata (no overwrite massivo, evitare incidenti);
 * - errori per riga restituiti come stringhe.
 */
export async function bulkImportCrmContactsAction(
  csvText: string,
  defaultCat: 'BROKER' | 'AGENZIA' = 'BROKER',
): Promise<CsvImportResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canBulkImportCrm(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per importare CSV' };
  }

  const parsed = parseContactsCsv(csvText, defaultCat);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const errors: string[] = parsed.rowErrors.map((e) => e.message);
  let created = 0;
  let skipped = parsed.rowErrors.length;

  // Dedup contro gli esistenti (email + telefono normalizzati), caricati una
  // volta sola dalle colonne già pronte; i Set si aggiornano man mano per
  // intercettare anche i duplicati interni allo stesso file. Niente overwrite:
  // nel dubbio si salta.
  const existing = await prisma.crmContact.findMany({
    where: { deletedAt: null },
    select: { emailNorm: true, telNorm: true },
  });
  const emailSet = new Set(
    existing.map((c) => c.emailNorm).filter((e): e is string => !!e),
  );
  const telSet = new Set(
    existing.map((c) => c.telNorm).filter((t): t is string => !!t),
  );

  for (const row of parsed.rows) {
    // Dedup per email e per telefono normalizzato (no overwrite massivo).
    const emailNorm = normalizeEmail(row.email);
    if (emailNorm !== '' && emailSet.has(emailNorm)) {
      skipped++;
      errors.push(`Riga ${row.line}: email "${row.email}" già presente — salto`);
      continue;
    }
    const telNorm = normalizeTel(row.tel);
    if (telNorm !== '' && telSet.has(telNorm)) {
      skipped++;
      errors.push(`Riga ${row.line}: telefono "${row.tel}" già presente — salto`);
      continue;
    }

    try {
      await prisma.crmContact.create({
        data: {
          nome: row.nome,
          cat: row.cat,
          tel: row.tel,
          wa: row.wa,
          email: row.email,
          piva: row.piva,
          indirizzo: row.indirizzo,
          citta: row.citta,
          cap: row.cap,
          regione: row.regione,
          ...crmNormFields({
            tel: row.tel,
            wa: row.wa,
            email: row.email,
            piva: row.piva,
          }),
          status: row.status,
          fonte: row.fonte,
        },
      });
      created++;
      if (emailNorm !== '') emailSet.add(emailNorm);
      if (telNorm !== '') telSet.add(telNorm);
    } catch (err) {
      skipped++;
      errors.push(
        `Riga ${row.line}: errore creazione (${(err as Error).message.slice(0, 80)})`,
      );
    }
  }

  revalidatePath('/admin/crm/contatti');
  return { ok: true, created, skipped, errors: errors.slice(0, 25) };
}

// ════════════════════════════════════════════════════════
// Email di partenza
// ════════════════════════════════════════════════════════

/** Codici promo validi (attivi, non scaduti, non esauriti) per la select d'invio. */
export type PromoCodesEmailPartenza = {
  /** Codici che si possono davvero allegare all'email, oggi. */
  validi: Array<{ id: string; code: string; importoEuro: number }>;
  /**
   * Quanti codici esistono in piattaforma ma non sono utilizzabili (scaduti,
   * esauriti o disattivati).
   *
   * Non è una statistica: è ciò che permette alla modale di distinguere «non
   * ne hai ancora creati» da «ce ne sono, ma nessuno serve». Senza questo
   * numero la tendina vuota è indistinguibile da una funzione rotta — ed è
   * esattamente così che è stata segnalata.
   */
  scartati: number;
};

export async function listPromoCodesEmailPartenzaAction(): Promise<PromoCodesEmailPartenza> {
  const session = await auth();
  if (!session?.user || !canEditCrmContact(session.user.role)) {
    return { validi: [], scartati: 0 };
  }
  // Nessun `where: { active: true }`: i disattivati devono arrivare fin qui per
  // essere contati. A decidere chi è utilizzabile è `evaluatePromoCode` — la
  // stessa funzione del riscatto in registrazione — e non due filtri in due
  // punti diversi che un domani divergono.
  const codes = await prisma.promoCode.findMany({
    select: {
      id: true,
      code: true,
      amountCent: true,
      expiresAt: true,
      maxRedemptions: true,
      active: true,
      _count: { select: { redemptions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const validi = codes.filter(
    (c) =>
      evaluatePromoCode(
        {
          amountCent: c.amountCent,
          expiresAt: c.expiresAt,
          active: c.active,
          maxRedemptions: c.maxRedemptions,
        },
        c._count.redemptions,
      ).stato === 'valido',
  );

  return {
    validi: validi.map((c) => ({
      id: c.id,
      code: c.code,
      importoEuro: Math.round(c.amountCent / 100),
    })),
    scartati: codes.length - validi.length,
  };
}

/** Invia l'email di partenza a un lead. Gate: permessi, email, opt-out, codice valido. */
export async function sendEmailPartenzaAction(input: {
  contactId: string;
  nomeReferente: string;
  messaggio: string;
  promoCodeId?: string | null;
  /** Indirizzi extra a cui mandare la STESSA email (stesso link). Rivalidati qui. */
  emailAggiuntive?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non autorizzato.' };
  }

  // Il corpo del messaggio è precompilato dal client (default per categoria) ma
  // ritoccabile ad-hoc: validalo qui (non vuoto, entro il limite) prima di ogni
  // lavoro su DB.
  const messaggio = (input.messaggio ?? '').trim();
  if (!messaggio) {
    return { ok: false, error: 'Il messaggio non può essere vuoto.' };
  }
  if (messaggio.length > 4000) {
    return { ok: false, error: 'Il messaggio è troppo lungo (max 4000 caratteri).' };
  }

  const contact = await prisma.crmContact.findUnique({
    where: { id: input.contactId },
    select: {
      id: true, cat: true, status: true, email: true, nome: true,
      emailOptOutAt: true, emailUnsubToken: true, assignedToId: true,
      companyId: true,
    },
  });
  if (!contact) return { ok: false, error: 'Contatto non trovato.' };

  // Scoping SALES: può inviare solo ai contatti a lui assegnati.
  if (session.user.role === 'SALES' && contact.assignedToId !== session.user.id) {
    return { ok: false, error: 'Non autorizzato su questo contatto.' };
  }

  // Chi è già agganciato a un'azienda registrata resta fuori, come per le
  // campagne del sales agent (`createCampaignAction`): questa email propone
  // l'iscrizione e regala un codice welcome, e mandarla a un cliente già a
  // bordo è il danno peggiore che il CRM possa fare.
  //
  // Il percorso singolo finora era protetto solo per caso, dal controllo
  // sull'email qui sotto: le righe agganciate arrivavano dalla lista CSV senza
  // indirizzo. Da quando l'aggancio arricchisce il contatto quell'indirizzo
  // c'è, e la protezione va scritta invece che sperata.
  if (contact.companyId) {
    return { ok: false, error: 'Il contatto è già registrato sulla piattaforma.' };
  }
  if (contact.emailOptOutAt) return { ok: false, error: 'Il contatto si è disiscritto dalle email.' };

  // Destinatari = email del contatto (se c'è) + indirizzi extra rivalidati, dedup
  // case-insensitive, con un tetto di sicurezza. La stessa email/link parte a
  // ciascuno; senza nessun destinatario valido non si invia.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const extra = (input.emailAggiuntive ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e));
  const destinatari = Array.from(
    new Set([contact.email?.toLowerCase(), ...extra].filter((e): e is string => Boolean(e))),
  ).slice(0, 20);
  if (destinatari.length === 0) {
    return {
      ok: false,
      error: 'Nessun destinatario valido (email del contatto assente e nessun indirizzo aggiuntivo).',
    };
  }

  // Rivalida il codice (potrebbe essere stato disattivato dopo l'apertura del modale).
  let codice: { code: string; importoEuro: number } | undefined;
  let promoCodeInviatoId: string | null = null;
  if (input.promoCodeId) {
    const promo = await prisma.promoCode.findUnique({
      where: { id: input.promoCodeId },
      select: { id: true, code: true, amountCent: true, expiresAt: true, active: true, maxRedemptions: true },
    });
    if (!promo) return { ok: false, error: 'Codice non trovato.' };
    const count = await prisma.promoCodeRedemption.count({ where: { promoCodeId: promo.id } });
    if (evaluatePromoCode(promo, count).stato !== 'valido') {
      return { ok: false, error: 'Il codice selezionato non è più valido.' };
    }
    codice = { code: promo.code, importoEuro: Math.round(promo.amountCent / 100) };
    promoCodeInviatoId = promo.id;
  }

  const invitoToken = randomUUID();
  const emailUnsubToken = contact.emailUnsubToken ?? randomUUID();
  // NEXT_PUBLIC_APP_URL (host raggiungibile dell'app), NON BRAND.url: quest'ultimo
  // è il dominio marketing passaggioveloce.it, che è in GATED_HOSTS → il lead
  // anonimo verrebbe rimbalzato alla vetrina prima ancora dell'esenzione /i/ nel
  // gate auth. Stesso accessor di /r/ (affiliazione) e dell'unsub in send.ts.
  const linkUrl = `${env.NEXT_PUBLIC_APP_URL}/i/${invitoToken}`;
  const unsubUrl = `${env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${emailUnsubToken}`;

  // Un invio per destinatario: email individuali (nessuna visibilità incrociata
  // fra gli indirizzi), stesso link/token/codice per tutti.
  for (const email of destinatari) {
    await sendNotification({
      tipo: 'N26_EMAIL_PARTENZA',
      target: { email },
      payload: {
        nomeReferente: input.nomeReferente.trim() || contact.nome,
        messaggio,
        categoria: contact.cat as 'BROKER' | 'AGENZIA',
        linkUrl,
        unsubUrl,
        codice,
      },
    });
  }

  await prisma.crmContact.update({
    where: { id: contact.id },
    data: {
      linkInviato: true,
      linkInviatoAt: new Date(),
      invitoToken,
      emailUnsubToken,
      promoCodeInviatoId,
      status: nextStatoInvio(contact.status),
    },
  });

  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}
