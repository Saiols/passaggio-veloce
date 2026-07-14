import 'server-only';
import { prisma } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { computeFees } from '@/lib/pricing';
import { getTariffarioCorrente } from '@/lib/tariffario';
import { WALLET } from '@/lib/wallet/config';
import { resolveReferralLink } from './link';

export type AffiliazioneSpot = {
  link: string;
  sedeNomeFallback: string | null;
  /** Commissione per VEICOLO, passaggio semplice (cent). Dal tariffario in DB. */
  sempliceCent: number;
  /** Commissione per VEICOLO, minivoltura (cent). Dal tariffario in DB. */
  minivolturaCent: number;
  /** Soglia di richiesta payout (cent), per non promettere incassi immediati. */
  minPayoutCent: number;
  /** Testo precompilato per lo share WhatsApp (già include il link). */
  messaggioWhatsapp: string;
};

/**
 * Payload della modale affiliazione post-login, oppure null se l'utente non
 * deve vederla. Gate fail-closed, tutte le condizioni sono necessarie:
 *
 *  1. sessione con azienda;
 *  2. azienda DEALER o AGENZIA (il programma è dedicato a broker e agenzie:
 *     stesso confine della pagina /affiliazione);
 *  3. permesso `affiliazione.view` (l'owner ce l'ha implicito; per gli altri è
 *     nei preset OPERATORE_COMPLETO e ADMIN_SEDE, non in OPERATORE_BASE);
 *  4. l'utente non ha spuntato "non mostrare più";
 *  5. esiste un link referral da mostrare (una modale che sponsorizza un link
 *     che non c'è sarebbe peggio di nessuna modale).
 *
 * Gli importi NON sono costanti: il listino autorevole è il tariffario
 * editabile da /admin/tariffe. Derivarli da `computeFees` è ciò che impedisce
 * al popup di promettere cifre che il sistema poi non accredita.
 */
export async function getAffiliazioneSpot(): Promise<AffiliazioneSpot | null> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return null;
  if (ctx.companyType !== 'DEALER' && ctx.companyType !== 'AGENZIA') return null;
  if (!(await hasPermesso('affiliazione.view'))) return null;

  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { affiliazioneSpotDismissedAt: true },
  });
  if (!user || user.affiliazioneSpotDismissedAt) return null;

  const { link, sedeNomeFallback } = await resolveReferralLink();
  if (!link) return null;

  const tariffario = await getTariffarioCorrente();
  const perVeicolo = (tipo: 'SEMPLICE' | 'MINIVOLTURA'): number =>
    computeFees({ tipo, numeroVeicoli: 1 }, tariffario).costoAffiliazioneTotaleCent;

  return {
    link,
    sedeNomeFallback,
    sempliceCent: perVeicolo('SEMPLICE'),
    minivolturaCent: perVeicolo('MINIVOLTURA'),
    minPayoutCent: WALLET.MIN_PAYOUT_CENT,
    messaggioWhatsapp: messaggioWhatsapp(link),
  };
}

/** Messaggio precompilato dello share WhatsApp. Puro: testabile senza sessione. */
export function messaggioWhatsapp(link: string): string {
  return [
    'Ciao! Ti segnalo Passaggio Veloce: i passaggi di proprietà si fanno online',
    'e la pratica la lavora un’agenzia certificata, senza code in agenzia.',
    `Se ti registri da qui sei subito operativo: ${link}`,
  ].join(' ');
}

/** Marca la presa visione come definitiva ("non mostrare più"). Idempotente. */
export async function dismissAffiliazioneSpot(userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, affiliazioneSpotDismissedAt: null },
    data: { affiliazioneSpotDismissedAt: new Date() },
  });
}
