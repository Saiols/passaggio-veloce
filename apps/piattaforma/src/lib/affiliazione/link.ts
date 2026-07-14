import 'server-only';
import { prisma } from '@pv/db';
import { getSessionContext, getOperatingSede } from '@/lib/auth/session-context';

export type ReferralLink = {
  /** URL completo `<APP_URL>/r/<code>`, null se nessun codice risolvibile. */
  link: string | null;
  code: string | null;
  /**
   * Nome della sede di cui è il link, valorizzato SOLO quando siamo caduti nel
   * fallback (proprietario in vista aggregata con più sedi): in quel caso la UI
   * deve dire di quale sede è il link che sta mostrando. Null quando il link è
   * quello della sede operativa corrente (nessuna ambiguità da spiegare).
   */
  sedeNomeFallback: string | null;
};

/**
 * FONTE UNICA del link di affiliazione dell'utente loggato.
 *
 * Multi-sede: il codice referral vive sulla SEDE (`Sede.referralCode`).
 * `Company.referralCode` è deprecato e resta solo come fallback per le aziende
 * registrate prima del multi-sede.
 *
 * Risoluzione, in ordine:
 *  1. sede operativa corrente (`getOperatingSede()`);
 *  2. prima sede accessibile — serve al proprietario in vista aggregata con più
 *     sedi, per cui `getOperatingSede()` ritorna null (per una SCRITTURA
 *     dovrebbe prima sceglierne una, ma il link è una LETTURA e deve esserci
 *     sempre). Senza questo fallback il proprietario vedeva "codice non
 *     disponibile" sul proprio link;
 *  3. `Company.referralCode` legacy.
 *
 * Letta sia dalla pagina `/affiliazione` sia dalla modale post-login: non
 * duplicare questa logica, o i due mostrerebbero link diversi.
 */
export async function resolveReferralLink(): Promise<ReferralLink> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { link: null, code: null, sedeNomeFallback: null };

  const operatingSede = await getOperatingSede();
  const sedeLink = operatingSede ?? ctx.accessibleSedi[0] ?? null;
  const sedeNomeFallback = !operatingSede && sedeLink ? sedeLink.nome : null;

  const [sedeRow, company] = await Promise.all([
    sedeLink
      ? prisma.sede.findUnique({
          where: { id: sedeLink.id },
          select: { referralCode: true },
        })
      : Promise.resolve(null),
    prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: { referralCode: true },
    }),
  ]);

  const code = sedeRow?.referralCode ?? company?.referralCode ?? null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return {
    // Punta a /r/<code> (non /register?ref=): il redirect passa dal pixel di
    // tracking del click prima di arrivare al wizard di registrazione.
    link: code ? `${appUrl}/r/${code}` : null,
    code,
    sedeNomeFallback,
  };
}
