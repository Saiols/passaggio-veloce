'use server';

/**
 * `/visura` — Server Action a DUE PASSI (cfr. `lib/visura/aggiorna.ts`):
 *  1. `verificaVisuraAction` — OCR + controlli, NON scrive nulla. Serve a
 *     precompilare il form di conferma con la sede legale letta dal parser.
 *  2. `aggiornaVisuraAction` — ri-estrae ed effettivamente scrive.
 *
 * Entrambe ri-verificano `isOwner` qui (la pagina nasconde il form ai non
 * titolari, ma le Server Action sono raggiungibili comunque via POST) e
 * prendono `companyId`/`userId` SEMPRE dalla sessione: un form che li
 * proponesse sarebbe scavalcabile da chiunque sappia il nome del campo.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { aggiornaVisura, verificaVisuraPerAggiornamento, type DocRef } from '@/lib/visura/aggiorna';

/** Anteprima della sede legale letta dal parser: best-effort, può mancare del tutto. */
export type SedeLegalePreview = {
  comune?: string;
  provincia?: string;
  indirizzo?: string;
  cap?: string;
};

export type VerificaVisuraActionResult =
  | { ok: true; dataEmissione: string; sedeLegale: SedeLegalePreview | null; atecoNonIdoneo: boolean }
  | { ok: false; error: string };

export type AggiornaVisuraActionResult =
  | { ok: true; atecoNonIdoneo: boolean }
  | { ok: false; error: string };

const blobRefSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().positive(),
  // La visura si carica SOLO in PDF (DocCard `pdfOnly` la impone lato client):
  // niente altri MIME accettati, nemmeno via POST diretto.
  type: z.enum(['application/pdf']),
});

/**
 * Sede legale confermata dal titolare. NB: NON contiene la data di emissione
 * né la ragione sociale — quelle le ri-estrae sempre il server (vedi il
 * commento in `lib/visura/aggiorna.ts`): se la data arrivasse dal form,
 * sbloccarsi sarebbe un semplice POST con la data di oggi.
 *
 * Niente campo `civico` separato: il parser dà `indirizzo` col numero civico
 * già dentro (es. "VIA A. VOLTA 10") e nessun consumer legge un civico a
 * parte (`snapshotCompany`, l'unico mapper verso fattura, non lo accetta
 * nemmeno nel tipo). `indirizzo` si scrive quindi COSÌ COM'È dato dal parser.
 *
 * I campi `Company.indirizzo/citta/cap/provincia` sono `String` non-nullable
 * e alimentano FatturaPA: senza un `min` che rifiuti la stringa vuota, un
 * form sottomesso senza dati (es. da un client che salta il passo 1)
 * azzererebbe l'indirizzo esistente invece di lasciarlo intatto.
 */
const sedeLegaleSchema = z.object({
  indirizzo: z.string().trim().min(2, "Inserisci l'indirizzo"),
  cap: z.string().trim().regex(/^\d{5}$/, 'Il CAP deve avere 5 cifre'),
  citta: z.string().trim().min(2, 'Inserisci la città'),
  provincia: z.string().trim().length(2, 'La provincia è di 2 lettere').toUpperCase(),
});

type OwnerCtx = { companyId: string; userId: string };

/** Gate comune ai due passi: sessione valida + titolare, companyId/userId dalla sessione. */
async function requireOwnerCtx(): Promise<{ ctx: OwnerCtx } | { error: string }> {
  const session = await auth();
  const u = session?.user;
  if (!u || !u.companyId || !u.id) return { error: 'Non autorizzato' };
  if (!isOwner(u.role)) {
    return { error: "Solo il titolare dell'account può aggiornare la visura camerale" };
  }
  return { ctx: { companyId: u.companyId, userId: u.id } };
}

function parseBlobRef(formData: FormData): DocRef | null {
  try {
    return blobRefSchema.parse(JSON.parse(String(formData.get('blobRef') ?? '')));
  } catch {
    return null;
  }
}

/**
 * Passo 1: carica + verifica. OCR + controlli identici al passo 2, ma NON
 * scrive nulla — serve solo a mostrare l'anteprima (data, sede legale
 * best-effort, ATECO) prima che il titolare confermi.
 */
export async function verificaVisuraAction(formData: FormData): Promise<VerificaVisuraActionResult> {
  const gate = await requireOwnerCtx();
  if ('error' in gate) return { ok: false, error: gate.error };

  const ref = parseBlobRef(formData);
  if (!ref) return { ok: false, error: 'Carica la visura camerale in PDF' };

  const r = await verificaVisuraPerAggiornamento({ companyId: gate.ctx.companyId, ref });
  if (!r.ok) return { ok: false, error: r.error };

  return {
    ok: true,
    dataEmissione: r.dataEmissione,
    sedeLegale: r.sedeLegale ?? null,
    atecoNonIdoneo: r.atecoNonIdoneo,
  };
}

/**
 * Passo 2: conferma. Ri-estrae dal documento (non si fida dell'anteprima del
 * passo 1) e scrive. L'UNICO dato accettato dal client è la sede legale,
 * confermata o corretta da un umano.
 */
export async function aggiornaVisuraAction(formData: FormData): Promise<AggiornaVisuraActionResult> {
  const gate = await requireOwnerCtx();
  if ('error' in gate) return { ok: false, error: gate.error };

  const ref = parseBlobRef(formData);
  if (!ref) return { ok: false, error: 'Carica la visura camerale in PDF' };

  const sedeParsed = sedeLegaleSchema.safeParse({
    indirizzo: formData.get('indirizzo'),
    cap: formData.get('cap'),
    citta: formData.get('citta'),
    provincia: formData.get('provincia'),
  });
  if (!sedeParsed.success) return { ok: false, error: 'Controlla i dati della sede legale' };

  const r = await aggiornaVisura({
    // SEMPRE dalla sessione: un companyId/userId dal form sarebbe scavalcabile.
    companyId: gate.ctx.companyId,
    userId: gate.ctx.userId,
    ref,
    // L'UNICO dato accettato dal client. Data e ragione sociale le ri-estrae
    // il server (vedi `aggiornaVisura`).
    sedeLegale: sedeParsed.data,
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath('/visura');
  revalidatePath('/dashboard');
  return { ok: true, atecoNonIdoneo: r.atecoNonIdoneo };
}
