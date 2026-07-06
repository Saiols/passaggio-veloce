import 'server-only';
import { prisma } from '@pv/db';
import { WALLET } from './config';
import { eseguiPayoutImmediato, type EseguiPayoutResult } from './payout-exec';

/**
 * Soglia payout automatico per un wallet: quella del wallet di sede (operativo)
 * o della madre (affiliazione), con fallback al default globale.
 */
function sogliaAuto(w: {
  sede: { payoutThresholdCent: number } | null;
  company: { payoutThresholdCent: number } | null;
}): number {
  return (
    w.sede?.payoutThresholdCent ??
    w.company?.payoutThresholdCent ??
    WALLET.AUTO_PAYOUT_DEFAULT_CENT
  );
}

/**
 * Innesco REAL-TIME del payout automatico: se il saldo del wallet ha raggiunto
 * la soglia configurata, esegue SUBITO il payout tramite lo stesso motore del
 * payout manuale/istantaneo (`eseguiPayoutImmediato` → provider + settlement).
 * In mock è la Strada B (erogazione istantanea, bonifico reale fuori
 * piattaforma), identica al payout manuale.
 *
 * Best-effort e idempotente: `eseguiPayoutImmediato` ricontrolla saldo minimo e
 * anti-doppione (nessun payout concomitante). Il cron `triggerAutoPayout` resta
 * come rete di sicurezza periodica su TUTTI i wallet.
 */
export async function maybeAutoPayoutForWallet(
  walletId: string,
): Promise<EseguiPayoutResult | null> {
  const w = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: {
      saldoCent: true,
      sede: { select: { payoutThresholdCent: true } },
      company: { select: { payoutThresholdCent: true } },
    },
  });
  if (!w) return null;
  if (w.saldoCent < sogliaAuto(w)) return null;
  return eseguiPayoutImmediato(walletId, { automatico: true });
}

/** Variante per sede: risolve il wallet operativo della sede e innesca il payout auto. */
export async function maybeAutoPayoutForSede(
  sedeId: string,
): Promise<EseguiPayoutResult | null> {
  const wallet = await prisma.wallet.findUnique({
    where: { sedeId },
    select: { id: true },
  });
  if (!wallet) return null;
  return maybeAutoPayoutForWallet(wallet.id);
}

/**
 * Post-firma: innesca il payout automatico sul wallet del broker (sede di
 * partenza), se il credito pratica appena accreditato ha raggiunto la soglia.
 * Da chiamare best-effort dopo il commit della firma.
 */
export async function autoPayoutBrokerDopoFirma(praticaId: string): Promise<void> {
  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: { brokerSedeId: true },
  });
  if (!pratica?.brokerSedeId) return;
  await maybeAutoPayoutForSede(pratica.brokerSedeId);
}
