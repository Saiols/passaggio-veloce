'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import {
  canEditCrmContact,
  canDeleteCrmContact,
  canBulkImportCrm,
} from '@/lib/auth/permissions';

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
    'S0',
    'S1',
    'S2',
    'S3',
    'S4',
    'S5',
    'S6',
    'S7',
    'S8',
    'S9',
    'S10',
  ]),
  fonte: z.enum(['CSV_INIZIALE', 'ISCRIZIONE_DIRETTA', 'REFERRAL', 'ALTRO']),
  assignedToId: z.string().uuid().optional().or(z.literal('')),
  lastContactAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  nextContactAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),

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

  // SALES può modificare solo i propri assegnati (decisione 7)
  if (session.user.role === 'SALES') {
    const target = await prisma.crmContact.findUnique({
      where: { id },
      select: { assignedToId: true },
    });
    if (!target || target.assignedToId !== session.user.id) {
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

  await prisma.crmContact.update({
    where: { id },
    data: dataFromInputForUpdate(parsed.data),
  });

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

// ════════════════════════════════════════════════════════
// CSV Import / Export
// ════════════════════════════════════════════════════════

export type CsvImportResult =
  | { ok: true; created: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

/**
 * Bulk import da CSV. Formato atteso (header obbligatorio):
 * nome,cat,tel,wa,email,piva,indirizzo,citta,cap,regione,status,fonte
 *
 * - Riga senza `nome`/`cat`/`tel` → saltata
 * - Riga con email duplicata → saltata (no overwrite massivo, evitare incidenti)
 * - Errori per riga restituiti come stringhe
 */
export async function bulkImportCrmContactsAction(
  csvText: string,
): Promise<CsvImportResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canBulkImportCrm(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per importare CSV' };
  }

  const lines = csvText.replace(/﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: 'CSV vuoto o senza header' };
  }
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const idxOf = (col: string): number => header.indexOf(col);
  const required = ['nome', 'cat', 'tel'];
  for (const r of required) {
    if (idxOf(r) < 0) {
      return { ok: false, error: `Colonna obbligatoria mancante: ${r}` };
    }
  }

  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const get = (col: string): string => {
      const j = idxOf(col);
      return j >= 0 ? (cols[j] ?? '').trim() : '';
    };
    const nome = get('nome');
    const catRaw = get('cat').toUpperCase();
    const tel = get('tel');
    if (!nome || !tel) {
      skipped++;
      errors.push(`Riga ${i + 1}: nome o telefono mancante`);
      continue;
    }
    if (catRaw !== 'BROKER' && catRaw !== 'AGENZIA') {
      skipped++;
      errors.push(`Riga ${i + 1}: cat deve essere BROKER o AGENZIA`);
      continue;
    }
    const email = get('email').toLowerCase();
    if (email) {
      const dup = await prisma.crmContact.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      });
      if (dup) {
        skipped++;
        errors.push(`Riga ${i + 1}: email "${email}" già presente — salto`);
        continue;
      }
    }

    const statusRaw = get('status') || 'S0';
    const fonteRaw = get('fonte') || 'CSV_INIZIALE';

    try {
      await prisma.crmContact.create({
        data: {
          nome,
          cat: catRaw as 'BROKER' | 'AGENZIA',
          tel,
          wa: get('wa') || null,
          email: email || null,
          piva: get('piva') || null,
          indirizzo: get('indirizzo') || null,
          citta: get('citta') || null,
          cap: get('cap') || null,
          regione: get('regione') || null,
          status: statusRaw as
            | 'S0'
            | 'S1'
            | 'S2'
            | 'S3'
            | 'S4'
            | 'S5'
            | 'S6'
            | 'S7'
            | 'S8'
            | 'S9'
            | 'S10',
          fonte: fonteRaw as
            | 'CSV_INIZIALE'
            | 'ISCRIZIONE_DIRETTA'
            | 'REFERRAL'
            | 'ALTRO',
        },
      });
      created++;
    } catch (err) {
      skipped++;
      errors.push(
        `Riga ${i + 1}: errore creazione (${(err as Error).message.slice(0, 80)})`,
      );
    }
  }

  revalidatePath('/admin/crm/contatti');
  return { ok: true, created, skipped, errors: errors.slice(0, 25) };
}

/** CSV line parser tollerante di virgolette doppie e virgole interne. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
