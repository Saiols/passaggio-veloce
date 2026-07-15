'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { prisma } from '@pv/db';
import { parseSedeFields } from '@/lib/sedi/form';
import { geocodeAddress } from '@/lib/geo/geocode';
import { parseCoords } from '@/lib/geo/coords';

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

  // L'anti-abuso non è aggirabile aprendo una sede nuova: un'azienda con
  // almeno una sede sospesa da Passaggio Veloce (5 no-show consecutivi) non
  // può crearne un'altra per rientrare in distribuzione. Altrimenti la
  // sanzione è aggirata in una sola mossa dal sanzionato stesso.
  const sanzionata = await prisma.sede.findFirst({
    where: { companyId, deletedAt: null, suspendedAt: { not: null }, suspensionOrigin: 'ANTI_ABUSO' },
    select: { id: true },
  });
  if (sanzionata) {
    return {
      ok: false,
      error:
        'La tua azienda ha una sede sospesa da Passaggio Veloce per mancate risposte reiterate: non puoi aprirne una nuova per aggirare la sospensione. Scrivi ad assistenza@passaggioveloce.it per chiedere la riattivazione.',
    };
  }

  const parsed = parseSedeFields(sedeFormRaw(formData));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;

  // Coordinate: preferisci quelle catturate dal client (Google Places); se
  // assenti (indirizzo digitato a mano) geocoda server-side best-effort.
  const coords =
    parseCoords(formData.get('lat'), formData.get('lng')) ??
    (await geocodeAddress({
      indirizzo: f.indirizzo,
      civico: f.civico,
      citta: f.citta,
      cap: f.cap,
      provincia: f.provincia,
    }));

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
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      geocodedAt: coords ? new Date() : null,
    },
  });

  revalidatePath('/sedi');
  return { ok: true };
}

/**
 * Aggiorna i dati anagrafici, la soglia payout e l'IBAN di una sede.
 *
 * Doppio gate: `sede.edit` (capability) copre anagrafica e soglia payout;
 * `ctx.isOwner` (scope, non delegabile) copre le impostazioni di incasso —
 * IBAN e soglia payout — che sono owner-only per decisione D1/D2 di
 * `docs/superpowers/specs/2026-07-10-iban-solo-super-admin-design.md`.
 *
 * I campi di incasso si OMETTONO dall'oggetto `data` se chi salva non è
 * owner, non si validano-e-rifiutano: l'omissione chiude due falle con un
 * solo meccanismo (§3.2 della spec) — (1) un ADMIN_SEDE che forgia la POST
 * con un IBAN diverso non scrive nulla; (2) un ADMIN_SEDE che salva la sola
 * anagrafica non azzera l'IBAN esistente, perché `parseSedeFields` mappa
 * `'' → null` e quel `null` va scartato insieme al resto, non applicato.
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
  // spazi.
  const raw = sedeFormRaw(formData);
  raw.iban = raw.iban.replace(/\s/g, '').toUpperCase();

  const parsed = parseSedeFields(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;

  // Coordinate: preferisci quelle catturate dal client (Google Places); se
  // assenti (indirizzo digitato a mano / non ricambiato) geocoda server-side
  // best-effort. Non owner-gated: chiunque possa modificare l'anagrafica
  // aggiorna anche la posizione sulla mappa distribuzione.
  const coords =
    parseCoords(formData.get('lat'), formData.get('lng')) ??
    (await geocodeAddress({
      indirizzo: f.indirizzo,
      civico: f.civico,
      citta: f.citta,
      cap: f.cap,
      provincia: f.provincia,
    }));

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
      // Impostazioni di incasso: solo il proprietario della madre (D1, D2).
      // Si OMETTONO, non si validano: chi forgia la POST non scrive nulla, e chi
      // salva la sola anagrafica non azzera l'IBAN (parseSedeFields mappa '' → null).
      ...(ctx.isOwner ? { iban: f.iban, payoutThresholdCent: f.payoutThresholdCent } : {}),
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      geocodedAt: coords ? new Date() : null,
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
    select: { companyId: true, suspensionOrigin: true },
  });
  if (!sede || sede.companyId !== companyId) {
    return { ok: false, error: 'Sede non trovata' };
  }

  // Una sanzione non è revocabile dal sanzionato, in NESSUNA direzione. La sede
  // sospesa dal sistema anti-abuso (5 no-show consecutivi) non può essere né
  // riattivata né ri-sospesa dall'utente: altrimenti bastano due chiamate
  // (suspendSedeAction sulla sede già ANTI_ABUSO riscrive suspensionOrigin a
  // 'UTENTE', poi reactivateSedeAction passa la guardia) per far rientrare in
  // distribuzione un'agenzia sanzionata. Solo Passaggio Veloce può sciogliere
  // la sanzione.
  if (sede.suspensionOrigin === 'ANTI_ABUSO') {
    return {
      ok: false,
      error:
        'Questa sede è stata sospesa da Passaggio Veloce per mancate risposte reiterate. Scrivi ad assistenza@passaggioveloce.it per chiederne la riattivazione.',
    };
  }

  await prisma.sede.update({
    where: { id: sedeId },
    data: suspended
      ? { suspendedAt: new Date(), suspensionOrigin: 'UTENTE' }
      : { suspendedAt: null, suspensionOrigin: null },
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
