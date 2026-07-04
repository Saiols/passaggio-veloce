import 'server-only';
import { prisma } from '@pv/db';

/** Righe di payout: non concorrono alla composizione del saldo, ma lo azzerano. */
const TIPI_PAYOUT = ['PAYOUT_AUTOMATICO', 'PAYOUT_MANUALE'] as const;

export type VocePayout = { tipo: string; importoCent: number };

export type WalletBreakdown = {
  saldoCent: number;
  /** Composizione del saldo corrente per tipo di transazione (somma = saldoCent). */
  voci: VocePayout[];
};

/**
 * Scompone il saldo CORRENTE di un wallet per tipo di transazione, così da
 * mostrare all'utente "da cosa deriva" il payout (compensi pratiche,
 * affiliazione, bonus welcome, penali…).
 *
 * Il saldo viene azzerato ad ogni payout eseguito: la composizione corrente è
 * quindi la somma per tipo delle transazioni successive all'ultimo payout
 * eseguito (escluse le righe di payout stesse). Se la somma delle voci non
 * combacia col saldo (drift storico), aggiunge una voce residua così che il
 * dettaglio quadri sempre con l'importo effettivamente erogato.
 */
export async function getWalletBreakdown(
  walletId: string,
  saldoCent: number,
): Promise<WalletBreakdown> {
  const ultimoPayout = await prisma.payout.findFirst({
    where: { walletId, stato: 'ESEGUITO' },
    orderBy: { eseguitoAt: 'desc' },
    select: { eseguitoAt: true },
  });
  const since = ultimoPayout?.eseguitoAt ?? new Date(0);

  const rows = await prisma.transazioneWallet.groupBy({
    by: ['tipo'],
    where: {
      walletId,
      createdAt: { gt: since },
      tipo: { notIn: [...TIPI_PAYOUT] },
    },
    _sum: { importoCent: true },
  });

  const voci: VocePayout[] = rows
    .map((r) => ({ tipo: r.tipo as string, importoCent: r._sum.importoCent ?? 0 }))
    .filter((v) => v.importoCent !== 0)
    .sort((a, b) => b.importoCent - a.importoCent);

  // Riconciliazione: garantisce Σ voci === saldoCent (importo davvero erogato).
  const sommaVoci = voci.reduce((s, v) => s + v.importoCent, 0);
  const residuo = saldoCent - sommaVoci;
  if (residuo !== 0) voci.push({ tipo: 'ALTRO', importoCent: residuo });

  return { saldoCent, voci };
}
