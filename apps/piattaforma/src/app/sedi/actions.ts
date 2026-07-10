'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { prisma } from '@pv/db';
import { parseSedeFields } from '@/lib/sedi/form';

export type SedeActionResult = { ok: true } | { ok: false; error: string };

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function genReferralCode(): string {
  let c = '';
  for (let i = 0; i < 8; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

/** Mappa i campi del form sede in un oggetto stringa per parseSedeFields. */
function sedeFormRaw(form: FormData): Record<string, string> {
  const keys = [
    'nome', 'indirizzo', 'civico', 'citta', 'cap', 'provincia',
    'telefono', 'email', 'codiceInterno', 'iban', 'payoutThresholdEuro',
  ];
  return Object.fromEntries(keys.map((k) => [k, String(form.get(k) ?? '')]));
}

/** Crea una nuova sede sotto l'azienda madre (solo proprietario). */
export async function createSedeAction(formData: FormData): Promise<SedeActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può aggiungere sedi' };
  }
  const companyId = session.user.companyId!;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { type: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };

  const parsed = parseSedeFields(sedeFormRaw(formData));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;

  // referralCode univoco con retry su collisione.
  let referralCode = genReferralCode();
  for (let i = 0; i < 5; i++) {
    const collision = await prisma.sede.findUnique({
      where: { referralCode },
      select: { id: true },
    });
    if (!collision) break;
    referralCode = genReferralCode();
  }

  await prisma.sede.create({
    data: {
      companyId,
      type: company.type,
      nome: f.nome,
      indirizzo: f.indirizzo,
      civico: f.civico,
      citta: f.citta,
      cap: f.cap,
      provincia: f.provincia,
      telefono: f.telefono,
      email: f.email,
      codiceInterno: f.codiceInterno,
      iban: f.iban,
      payoutThresholdCent: f.payoutThresholdCent,
      referralCode,
    },
  });

  revalidatePath('/sedi');
  return { ok: true };
}

/**
 * Aggiorna i dati anagrafici, la soglia payout e l'IBAN di una sede.
 *
 * Doppio gate: `sede.edit` copre anagrafica e soglia payout; l'IBAN — il
 * conto su cui arrivano i payout — non è delegabile e resta owner-only,
 * proprio come per l'azienda. Il gate su `isOwner` scatta SOLO se l'IBAN
 * cambia davvero (confronto normalizzato su spazi e maiuscole), altrimenti
 * chi ha solo `sede.edit` non potrebbe salvare il form lasciando l'IBAN
 * intatto.
 */
export async function updateSedeAction(
  sedeId: string,
  formData: FormData,
): Promise<SedeActionResult> {
  // Autenticazione → permesso → scope.
  const gate = await requirePermesso('sede.edit');
  if (!gate.ok) return gate;

  // Scope: `sedeId` è un parametro esterno. Il permesso da solo non basta —
  // senza questo controllo un utente con `sede.edit` potrebbe scrivere su
  // una sede che non è la sua (non serve rivelare altro: stesso messaggio
  // usato per una sede inesistente).
  const ctx = await getSessionContext();
  if (!ctx || !ctx.accessibleSedi.some((s) => s.id === sedeId)) {
    return { ok: false, error: 'Sede non trovata' };
  }

  // Normalizza l'IBAN (spazi + maiuscole) PRIMA del parsing: un IBAN
  // incollato a blocchi ("IT60 X054 ...") è lo stesso IBAN di uno senza
  // spazi, sia per la validazione di formato sia per il confronto sotto.
  const raw = sedeFormRaw(formData);
  raw.iban = raw.iban.replace(/\s/g, '').toUpperCase();

  const parsed = parseSedeFields(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;

  const sedeCorrente = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { iban: true },
  });
  const ibanNormalizzato = (f.iban ?? '').toUpperCase();
  const ibanAttuale = (sedeCorrente?.iban ?? '').replace(/\s/g, '').toUpperCase();
  if (ibanNormalizzato !== ibanAttuale) {
    // L'IBAN della sede è il conto su cui arrivano i payout: non è delegabile.
    // Il form lo mostra solo al proprietario (canEditPaymentSettings), questo è
    // il gate che lo rende vero anche per una richiesta costruita a mano.
    if (!ctx.isOwner) {
      return { ok: false, error: "Solo il titolare può modificare l'IBAN della sede" };
    }
  }

  await prisma.sede.update({
    where: { id: sedeId },
    data: {
      nome: f.nome,
      indirizzo: f.indirizzo,
      civico: f.civico,
      citta: f.citta,
      cap: f.cap,
      provincia: f.provincia,
      telefono: f.telefono,
      email: f.email,
      codiceInterno: f.codiceInterno,
      iban: f.iban,
      payoutThresholdCent: f.payoutThresholdCent,
    },
  });

  revalidatePath('/sedi');
  revalidatePath(`/sedi/${sedeId}`);
  return { ok: true };
}

async function setSedeSuspended(sedeId: string, suspended: boolean): Promise<SedeActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può gestire le sedi' };
  }
  const companyId = session.user.companyId!;

  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { companyId: true },
  });
  if (!sede || sede.companyId !== companyId) {
    return { ok: false, error: 'Sede non trovata' };
  }

  await prisma.sede.update({
    where: { id: sedeId },
    data: { suspendedAt: suspended ? new Date() : null },
  });
  revalidatePath('/sedi');
  return { ok: true };
}

export async function suspendSedeAction(sedeId: string): Promise<SedeActionResult> {
  return setSedeSuspended(sedeId, true);
}

export async function reactivateSedeAction(sedeId: string): Promise<SedeActionResult> {
  return setSedeSuspended(sedeId, false);
}
