'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { buildCatalogoContatti } from '@/lib/catalogo-contatti';

const BASE_PATH = '/admin/crm/contatti-operativi';

type Result = { ok: true } | { ok: false; error: string };

// Stesso formato di dedupKey() in lib/catalogo-contatti.ts: email:/tel:/cf:/piva:.
const CHIAVE_SCHEMA = z
  .string()
  .trim()
  .regex(/^(email|tel|cf|piva):.+$/, 'Chiave contatto non valida');
const NOTE_SCHEMA = z.string().trim().max(1000).optional();

/**
 * GDPR art. 21 — registra l'opposizione al trattamento per un contatto del
 * catalogo (F-05, `app/privacy/clienti/page.tsx` la dichiara come diritto
 * esercitabile). Da qui in poi `buildCatalogoContatti()` esclude questo
 * contatto ovunque — pagina admin ED export CSV — perché è la fonte unica
 * del catalogo.
 *
 * `chiaveRaw` DEVE essere la dedupKey del contatto (vedi
 * lib/catalogo-contatti.ts, campo `Contatto.key` mostrato in pagina). Non ci
 * fidiamo comunque del client: verifichiamo che corrisponda a un contatto
 * REALMENTE presente nel catalogo corrente prima di scrivere.
 *
 * Autorizzazione: stesso gate di pagina ed export F-05 (isAdminOrAssistente).
 * `registrataDaId` viene SEMPRE dalla sessione, mai da un parametro client.
 */
export async function registraOpposizioneCatalogoAction(
  chiaveRaw: string,
  noteRaw?: string,
): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }

  const chiaveParsed = CHIAVE_SCHEMA.safeParse(chiaveRaw);
  if (!chiaveParsed.success) {
    return { ok: false, error: 'Chiave contatto non valida' };
  }
  const noteParsed = NOTE_SCHEMA.safeParse(noteRaw);
  if (!noteParsed.success) {
    return { ok: false, error: 'Nota non valida' };
  }
  const chiave = chiaveParsed.data;

  const esistente = await prisma.opposizioneCatalogo.findUnique({
    where: { chiave },
    select: { id: true, revocataAt: true },
  });
  if (esistente && esistente.revocataAt === null) {
    return { ok: false, error: 'Opposizione già registrata per questo contatto' };
  }

  // Il catalogo corrente (già filtrato dalle opposizioni attive, ma questa
  // chiave non lo è: o non esiste riga, o è revocata) deve contenere
  // davvero questo contatto: niente scritture su chiavi arbitrarie.
  const catalogo = await buildCatalogoContatti();
  const contatto = catalogo.find((c) => c.key === chiave);
  if (!contatto) {
    return { ok: false, error: 'Contatto non trovato nel catalogo corrente' };
  }

  if (esistente) {
    // Era stata revocata: riattiva invece di duplicare (chiave è @unique).
    await prisma.opposizioneCatalogo.update({
      where: { id: esistente.id },
      data: {
        nominativo: contatto.nominativo,
        note: noteParsed.data || null,
        registrataDaId: session.user.id,
        createdAt: new Date(),
        revocataAt: null,
        revocataDaId: null,
      },
    });
  } else {
    await prisma.opposizioneCatalogo.create({
      data: {
        chiave,
        nominativo: contatto.nominativo,
        note: noteParsed.data || null,
        registrataDaId: session.user.id,
      },
    });
  }

  revalidatePath(BASE_PATH);
  return { ok: true };
}

/**
 * Revoca un'opposizione: legittima, l'interessato può cambiare idea. La riga
 * resta (audit), solo `revocataAt`/`revocataDaId` vengono valorizzati — il
 * contatto ricompare nel catalogo (e nell'export CSV) alla chiamata successiva.
 */
export async function revocaOpposizioneCatalogoAction(id: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }

  const opposizione = await prisma.opposizioneCatalogo.findUnique({
    where: { id },
    select: { id: true, revocataAt: true },
  });
  if (!opposizione) {
    return { ok: false, error: 'Opposizione non trovata' };
  }
  if (opposizione.revocataAt !== null) {
    return { ok: false, error: 'Opposizione già revocata' };
  }

  await prisma.opposizioneCatalogo.update({
    where: { id },
    data: {
      revocataAt: new Date(),
      revocataDaId: session.user.id,
    },
  });

  revalidatePath(BASE_PATH);
  return { ok: true };
}
