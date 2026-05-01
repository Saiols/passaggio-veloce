import 'server-only';
import { Prisma } from '@pv/db';
import { computeFees, type PraticaTipoEconomico } from '@/lib/pricing';

/**
 * Distribuisce un importo totale (in cent) tra N referenti.
 * Spec sez 3.2: tetto fisso, split 50/50 se 2 referenti.
 */
function quotaPerReferente(totaleCent: number, n: 1 | 2): number {
  if (n === 1) return totaleCent;
  // Math.floor evita di accreditare 1 cent in più se totale è dispari (es. 5€).
  // L'eventuale 1 cent residuo resta nostro margine.
  return Math.floor(totaleCent / 2);
}

export type AccreditCommissioniInput = {
  praticaId: string;
  tipo: PraticaTipoEconomico;
  numeroVeicoli: number;
  brokerId: string;
  agenziaAssegnataId: string;
  /** Se il referente è sospeso/eliminato, NON viene accreditato (spec 3.3). */
  brokerReferente: { id: string; suspendedAt: Date | null; deletedAt: Date | null } | null;
  agenziaReferente: { id: string; suspendedAt: Date | null; deletedAt: Date | null } | null;
};

/**
 * Crea le righe `CommissioneAffiliazione` ACCREDITATA + le rispettive
 * `TransazioneWallet` di tipo `CREDITO_AFFILIAZIONE`. Lazy-create del wallet
 * del referente se non esiste.
 *
 * Da chiamare DENTRO la transazione che marca la pratica FIRMATA.
 *
 * Auto-affiliazione consentita: nessun controllo che referente == broker pratica,
 * la quota viene comunque accreditata (decisione §1.2 triage).
 */
export async function accreditCommissioniAffiliazione(
  tx: Prisma.TransactionClient,
  input: AccreditCommissioniInput,
): Promise<{ commissioniCreate: number; importoTotaleCent: number }> {
  const eligibleBroker =
    input.brokerReferente &&
    !input.brokerReferente.suspendedAt &&
    !input.brokerReferente.deletedAt
      ? input.brokerReferente
      : null;
  const eligibleAgenzia =
    input.agenziaReferente &&
    !input.agenziaReferente.suspendedAt &&
    !input.agenziaReferente.deletedAt
      ? input.agenziaReferente
      : null;

  const numReferenti = (eligibleBroker ? 1 : 0) + (eligibleAgenzia ? 1 : 0);
  if (numReferenti === 0) {
    return { commissioniCreate: 0, importoTotaleCent: 0 };
  }

  const fees = computeFees({ tipo: input.tipo, numeroVeicoli: input.numeroVeicoli });
  const totale = fees.costoAffiliazioneTotaleCent;
  const quota = quotaPerReferente(totale, numReferenti as 1 | 2);

  let createdCount = 0;
  let totaleAccreditato = 0;

  for (const ref of [
    eligibleBroker
      ? { ref: eligibleBroker, tipo: 'REFERENTE_BROKER' as const }
      : null,
    eligibleAgenzia
      ? { ref: eligibleAgenzia, tipo: 'REFERENTE_AGENZIA' as const }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)) {
    const wallet = await tx.wallet.upsert({
      where: { companyId: ref.ref.id },
      update: {},
      create: { companyId: ref.ref.id, saldoCent: 0 },
    });

    const nuovoSaldo = wallet.saldoCent + quota;

    const transazione = await tx.transazioneWallet.create({
      data: {
        walletId: wallet.id,
        tipo: 'CREDITO_AFFILIAZIONE',
        importoCent: quota,
        saldoPostCent: nuovoSaldo,
        praticaId: input.praticaId,
      },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { saldoCent: nuovoSaldo },
    });

    await tx.commissioneAffiliazione.create({
      data: {
        praticaId: input.praticaId,
        referenteId: ref.ref.id,
        tipo: ref.tipo,
        stato: 'ACCREDITATA',
        importoLordoCent: quota,
        importoNettoCent: quota,
        // expiresAt null per D-04 (sempre attivo).
        transazioneWalletId: transazione.id,
      },
    });

    createdCount += 1;
    totaleAccreditato += quota;
  }

  return { commissioniCreate: createdCount, importoTotaleCent: totaleAccreditato };
}
