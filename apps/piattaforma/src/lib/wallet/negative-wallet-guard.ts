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
 * ⚠️ Non va invocata per la liquidazione alla cessazione del rapporto
 * (`ignoraSoglia`, clausola 11.4): quel payout deve poter svuotare il
 * residuo positivo indipendentemente dal debito su altri wallet — i
 * chiamanti gestiscono l'eccezione a monte.
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
