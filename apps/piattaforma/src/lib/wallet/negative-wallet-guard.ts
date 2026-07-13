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
 * ⚠️ Non è invocata da `eseguiPayoutImmediato` per la liquidazione alla
 * cessazione del rapporto (`ignoraSoglia`, clausola 12.4): `payout-exec.ts`
 * salta questo controllo per-wallet in quel caso. Ciò NON significa che il
 * debito venga ignorato: per la cessazione il blocco è imposto a monte, a
 * livello di intera azienda anziché di singolo wallet, dal chiamante (vedi
 * sotto) — che se esiste un debito non richiama proprio `eseguiPayoutImmediato`.
 *
 * È infatti invocata direttamente da `deleteCompanyAction` (fuori da
 * `eseguiPayoutImmediato`) come pre-check: la clausola 12.4 liquida il
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
