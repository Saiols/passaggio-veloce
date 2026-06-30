import 'server-only';
import { prisma } from '@pv/db';
import { createDocBroker } from '@/lib/fatturazione/engine';
import { WALLET } from './config';

export type EseguiPayoutResult =
  | { ok: true; payoutId: string; importoCent: number }
  | { ok: false; error: string };

/**
 * Tipi di transazione-credito che compongono il compenso maturato e che,
 * al payout, vengono agganciati al payout stesso: è ciò che alimenta il
 * documento broker conto terzi (FT-A). Promo e penali NON sono compensi per
 * servizi resi e restano fuori dall'aggregazione documentale (pur concorrendo
 * al saldo cassa erogato).
 */
const TIPI_CREDITO_COMPENSO = ['CREDITO_PRATICA', 'CREDITO_AFFILIAZIONE'] as const;

/**
 * Esegue SUBITO un payout per il wallet indicato (Strada B: il bonifico
 * effettivo è gestito fuori piattaforma, nessuna chiamata al provider di
 * pagamento). In una sola transazione: verifica il saldo, crea il Payout già
 * ESEGUITO, aggancia i crediti maturati, azzera il saldo e registra il
 * movimento. Genera poi il documento broker (best-effort, idempotente).
 *
 * Nessuna approvazione admin e nessuna attesa del job: la richiesta utente è
 * istantanea.
 */
export async function eseguiPayoutImmediato(
  walletId: string,
  opts: { automatico?: boolean } = {},
): Promise<EseguiPayoutResult> {
  const automatico = opts.automatico ?? false;

  const out = await prisma.$transaction(async (tx): Promise<EseguiPayoutResult> => {
    const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return { ok: false, error: 'Wallet non trovato' };
    if (wallet.saldoCent < WALLET.MIN_PAYOUT_CENT) {
      return {
        ok: false,
        error: `Saldo sotto la soglia minima di ${WALLET.MIN_PAYOUT_CENT / 100}€`,
      };
    }

    const inflight = await tx.payout.findFirst({
      where: { walletId, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
      select: { id: true },
    });
    if (inflight) return { ok: false, error: 'Payout già in corso, attendi' };

    const importoCent = wallet.saldoCent;

    const payout = await tx.payout.create({
      data: {
        walletId,
        importoCent,
        stato: 'ESEGUITO',
        automatico,
        eseguitoAt: new Date(),
      },
    });

    // Aggancia i compensi maturati (pratiche + affiliazione) a questo payout:
    // è ciò che il documento broker aggrega.
    await tx.transazioneWallet.updateMany({
      where: {
        walletId,
        payoutId: null,
        tipo: { in: [...TIPI_CREDITO_COMPENSO] },
      },
      data: { payoutId: payout.id },
    });

    const nuovoSaldo = wallet.saldoCent - importoCent;
    await tx.wallet.update({
      where: { id: walletId },
      data: { saldoCent: nuovoSaldo },
    });
    await tx.transazioneWallet.create({
      data: {
        walletId,
        tipo: automatico ? 'PAYOUT_AUTOMATICO' : 'PAYOUT_MANUALE',
        importoCent: -importoCent,
        saldoPostCent: nuovoSaldo,
        payoutId: payout.id,
      },
    });

    return { ok: true, payoutId: payout.id, importoCent };
  });

  if (out.ok) {
    // FT-A: documento broker (conto terzi) aggregato al payout (best-effort).
    await createDocBroker({ payoutId: out.payoutId }).catch(() => undefined);
  }
  return out;
}
