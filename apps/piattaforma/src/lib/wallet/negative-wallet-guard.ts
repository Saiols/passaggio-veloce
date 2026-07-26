import 'server-only';
import type { Prisma, PrismaClient } from '@pv/db';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Vero se ALMENO UN wallet dell'azienda indicata (una qualsiasi delle sue
 * sedi, o il wallet madre) ha saldo negativo.
 *
 * ⚠️ SERVE SOLO ALLA CESSAZIONE DEL RAPPORTO. Non è un guard sui payout
 * ordinari, e non va rimessa lì.
 *
 * Fino al 2026-07-26 questa funzione era anche il guard aziendale dei payout:
 * un solo wallet in rosso sospendeva l'incasso di TUTTI i wallet
 * dell'azienda. Il documento v8 dei Termini ha riscritto la clausola 5 nel
 * senso opposto — «Gli altri wallet dell'Utente (altre sedi e wallet di
 * affiliazione) non sono in alcun modo vincolati o bloccati per effetto del
 * saldo negativo di un singolo wallet» — quindi le tre chiamate sul percorso
 * di payout (`payout-exec.ts`, `jobs/trigger-auto-payout.ts`,
 * `app/wallet/page.tsx`) sono state rimosse. Il blocco per-wallet resta, ma
 * non ha bisogno di questa query: lo fa il controllo sul saldo del wallet
 * stesso, dentro `eseguiPayoutImmediato`.
 *
 * L'unico chiamante rimasto è `deleteCompanyAction`, come pre-check della
 * liquidazione: la clausola 5 (ultimo comma) e la 12.4 liquidano il residuo
 * «previa... regolarizzazione di quanto eventualmente dovuto a Passaggio
 * Veloce», quindi se esiste un debito su un qualsiasi wallet la liquidazione
 * automatica è sospesa nella sua interezza e la regolarizzazione passa
 * dall'admin. Questa È la lettura aziendale voluta: alla chiusura dei conti
 * si guarda l'azienda intera, durante il rapporto no.
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
