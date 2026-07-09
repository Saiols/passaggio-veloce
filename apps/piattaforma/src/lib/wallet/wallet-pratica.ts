import 'server-only';
import type { Prisma } from '@pv/db';

/**
 * Il wallet operativo del broker per questa pratica.
 *
 * Dal 24 giugno (migration `20260624013750_multi_sede_expand`) il wallet
 * operativo appartiene alla SEDE, non all'azienda: `UPDATE wallets SET sedeId =
 * …, companyId = NULL`. Chi cerca ancora per `companyId` non trova nulla e —
 * con un upsert — si ritrova a creare un wallet "madre" nuovo di zecca, che la
 * pagina wallet mostra al solo proprietario. È così che la penale spariva agli
 * occhi dell'operatore.
 *
 * Il wallet madre resta legittimo per le pratiche legacy senza `brokerSedeId`:
 * lì non c'è una sede a cui attribuire il movimento.
 */
export async function walletBrokerDellaPratica(
  tx: Prisma.TransactionClient,
  pratica: { brokerId: string; brokerSedeId: string | null },
): Promise<{ id: string; saldoCent: number }> {
  if (pratica.brokerSedeId) {
    return tx.wallet.upsert({
      where: { sedeId: pratica.brokerSedeId },
      update: {},
      create: { sedeId: pratica.brokerSedeId, saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
  }

  return tx.wallet.upsert({
    where: { companyId: pratica.brokerId },
    update: {},
    create: { companyId: pratica.brokerId, saldoCent: 0 },
    select: { id: true, saldoCent: true },
  });
}
