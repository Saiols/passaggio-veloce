import 'server-only';
import { Prisma } from '@pv/db';
import { computeFees, rowToTariffario, type PraticaTipoEconomico } from '@/lib/pricing';
import { detectCollusion } from './check';

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
  /** Multi-sede: sede della madre referente che ha affiliato (attribuzione/classifica). */
  brokerReferenteSedeId?: string | null;
  agenziaReferenteSedeId?: string | null;
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
export type AccreditoEseguito = {
  referenteId: string;
  tipo: 'REFERENTE_BROKER' | 'REFERENTE_AGENZIA';
  importoCent: number;
  walletPreCent: number;
  walletPostCent: number;
};

export async function accreditCommissioniAffiliazione(
  tx: Prisma.TransactionClient,
  input: AccreditCommissioniInput,
): Promise<{
  commissioniCreate: number;
  importoTotaleCent: number;
  accrediti: AccreditoEseguito[];
}> {
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
    return { commissioniCreate: 0, importoTotaleCent: 0, accrediti: [] };
  }

  const tariffario = rowToTariffario(
    await tx.tariffaPiattaforma.findFirst({
      where: { attivo: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
  const fees = computeFees({ tipo: input.tipo, numeroVeicoli: input.numeroVeicoli }, tariffario);
  const totale = fees.costoAffiliazioneTotaleCent;
  const quota = quotaPerReferente(totale, numReferenti as 1 | 2);

  let createdCount = 0;
  let totaleAccreditato = 0;
  const accrediti: AccreditoEseguito[] = [];

  // ID del referral (chi ha lavorato la pratica): il broker se questo
  // referente è REFERENTE_BROKER, l'agenzia se è REFERENTE_AGENZIA.
  for (const ref of [
    eligibleBroker
      ? {
          ref: eligibleBroker,
          tipo: 'REFERENTE_BROKER' as const,
          referralId: input.brokerId,
          referenteSedeId: input.brokerReferenteSedeId ?? null,
        }
      : null,
    eligibleAgenzia
      ? {
          ref: eligibleAgenzia,
          tipo: 'REFERENTE_AGENZIA' as const,
          referralId: input.agenziaAssegnataId,
          referenteSedeId: input.agenziaReferenteSedeId ?? null,
        }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)) {
    // AF-AC: detector anti-collusione. Se almeno un flag è triggered,
    // la commissione resta DA_REVISIONARE finché un admin non sblocca.
    const flags = await detectCollusion(tx, ref.ref.id, ref.referralId);
    const sospetta = flags.length > 0;

    const wallet = await tx.wallet.upsert({
      where: { companyId: ref.ref.id },
      update: {},
      create: { companyId: ref.ref.id, saldoCent: 0 },
    });
    const walletPreCent = wallet.saldoCent;

    let nuovoSaldo = walletPreCent;
    let transazioneId: string | null = null;

    // Wallet popolato solo se NON sospetta. Se sospetta, l'accredit
    // arriverà al momento della review admin (approveCommissioneAction).
    if (!sospetta) {
      nuovoSaldo = walletPreCent + quota;
      const transazione = await tx.transazioneWallet.create({
        data: {
          walletId: wallet.id,
          tipo: 'CREDITO_AFFILIAZIONE',
          importoCent: quota,
          saldoPostCent: nuovoSaldo,
          praticaId: input.praticaId,
        },
      });
      transazioneId = transazione.id;
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { saldoCent: nuovoSaldo },
      });
    }

    await tx.commissioneAffiliazione.create({
      data: {
        praticaId: input.praticaId,
        referenteId: ref.ref.id,
        referenteSedeId: ref.referenteSedeId,
        tipo: ref.tipo,
        stato: sospetta ? 'DA_REVISIONARE' : 'ACCREDITATA',
        importoLordoCent: quota,
        importoNettoCent: quota,
        // expiresAt null per D-04 (sempre attivo).
        transazioneWalletId: transazioneId,
        flagsDetected: sospetta ? flags.join(',') : null,
      },
    });

    createdCount += 1;
    if (!sospetta) {
      totaleAccreditato += quota;
      accrediti.push({
        referenteId: ref.ref.id,
        tipo: ref.tipo,
        importoCent: quota,
        walletPreCent,
        walletPostCent: nuovoSaldo,
      });
    }
  }

  return {
    commissioniCreate: createdCount,
    importoTotaleCent: totaleAccreditato,
    accrediti,
  };
}
