import 'server-only';
import type { Prisma, PrismaClient } from '@pv/db';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Vero se ALMENO UN wallet dell'azienda indicata (una qualsiasi delle sue
 * sedi, o il wallet madre) ha saldo negativo.
 *
 * Clausola 5 dei Termini (IMPORTANT 3, review finale pre-merge): finché ciò
 * accade, TUTTI i payout dell'azienda sono sospesi — non solo quelli del
 * wallet in negativo. Prima di questo fix `richiediPayoutAction` filtrava
 * gli eleggibili wallet per wallet: un broker con la sede in penale (saldo
 * negativo) e l'affiliazione in positivo poteva comunque incassare
 * quest'ultima, lasciando il debito a registro indefinitamente.
 *
 * ⚠️ Non va invocata DENTRO `eseguiPayoutImmediato` per la liquidazione alla
 * cessazione del rapporto (`ignoraSoglia`, clausola 11.4): quel payout deve
 * poter svuotare il residuo positivo indipendentemente dal debito su altri
 * wallet — i chiamanti gestiscono l'eccezione a monte (vedi
 * `payout-exec.ts`).
 *
 * È invece invocata direttamente da `deleteCompanyAction` (fuori da
 * `eseguiPayoutImmediato`) come pre-check: la clausola 11.4 liquida il
 * residuo "previa... regolarizzazione di quanto eventualmente dovuto a
 * Passaggio Veloce", quindi se esiste un debito la liquidazione automatica
 * viene sospesa nella sua interezza (nessun payout su nessun wallet),
 * lasciando la regolarizzazione all'admin. Due scopi diversi della stessa
 * funzione: qui decide SE liquidare, in `payout-exec.ts` decideva se
 * BLOCCARE un payout utente — non sono in conflitto.
 */
export async function hasNegativeCompanyWallet(
  client: Client,
  companyId: string,
): Promise<boolean> {
  const negativo = await client.wallet.findFirst({
    where: {
      OR: [{ companyId }, { sede: { companyId } }],
      saldoCent: { lt: 0 },
    },
    select: { id: true },
  });
  return negativo != null;
}
