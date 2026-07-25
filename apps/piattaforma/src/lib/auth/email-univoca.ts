import { Prisma, prisma } from '@pv/db';

/**
 * Unicità dell'email su TUTTA la piattaforma (spec 2026-07-25).
 *
 * Fonte unica della regola: i call site devono CHIAMARE queste funzioni, non
 * ricopiarne la `where`. Una regola aggiunta qui e non letta dai consumer
 * sparisce in silenzio.
 */

/** trim + lowercase. Unico posto in cui la normalizzazione è scritta. */
export function normalizzaEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Messaggio per i path interni (chi legge è già autenticato). */
export const EMAIL_GIA_IN_USO =
  'Questa email è già associata a un account Passaggio Veloce';

/**
 * Messaggio per la registrazione pubblica: l'utente è anonimo e non ha modo
 * di sapere cosa fare, quindi il testo porta una via d'uscita.
 */
export const EMAIL_GIA_REGISTRATA =
  "Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.";

/**
 * True se l'email appartiene già a un account, ovunque sulla piattaforma.
 *
 * Nessun filtro su `companyId`: aziende e staff condividono lo spazio dei nomi.
 * Nessun filtro su `deletedAt`: un utente eliminato continua a occupare la sua
 * email (decisione della spec — l'eliminazione non la libera).
 *
 * È un check best-effort: fra questa query e la scrittura c'è una finestra
 * TOCTOU. La garanzia vera è il vincolo `users_email_key` sul DB, da
 * intercettare con `isViolazioneEmailUnica`.
 */
export async function emailGiaInUso(
  emailLower: string,
  opts?: { escludiUserId?: string },
): Promise<boolean> {
  const found = await prisma.user.findFirst({
    where: {
      email: emailLower,
      ...(opts?.escludiUserId ? { NOT: { id: opts.escludiUserId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * True se l'errore è la violazione del vincolo di unicità sull'email.
 *
 * Match esatto e non per sottostringa: `meta.target` può arrivare come array
 * di campi (`['email']`) o come nome dell'indice (`'users_email_key'`), e sul
 * DB esiste `crm_contacts_emailUnsubToken_key`, che un match generico su
 * "email" classificherebbe male.
 */
export function isViolazioneEmailUnica(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const parts = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return parts.some((p) => p === 'email' || p === 'users_email_key');
}

/**
 * Esegue una scrittura su User traducendo la violazione del vincolo unique
 * sull'email in un errore applicativo, invece di lasciarla propagare come 500.
 *
 * Serve a chiudere la finestra TOCTOU fra `emailGiaInUso` e la scrittura: in
 * quella finestra un'altra registrazione puo' prendersi l'email, e l'utente
 * non deve vedere una schermata di errore diversa dal caso normale.
 *
 * Qualunque altro errore viene rilanciato: questo helper non maschera bug.
 */
export async function scriviUtente<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isViolazioneEmailUnica(e)) return { ok: false, error: EMAIL_GIA_IN_USO };
    throw e;
  }
}
