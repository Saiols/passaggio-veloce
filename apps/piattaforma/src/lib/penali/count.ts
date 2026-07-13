import 'server-only';
import { prisma } from '@pv/db';

/**
 * Conta le transazioni `PENALE_BROKER` per ciascuna company, sommando sia il
 * wallet madre (pratiche legacy senza `brokerSedeId`) sia i wallet di TUTTE
 * le sedi della company.
 *
 * Il wallet operativo di una pratica è quello della SEDE del broker
 * (`walletBrokerDellaPratica`, dal 24 giugno / migration
 * `20260624013750_multi_sede_expand`), non quello della company. Filtrare le
 * penali solo su `wallet.companyId` ritorna 0 per ogni broker con wallet di
 * sede — il badge "⚠️ N penali" e l'alert (clausole 10.7 e 12.3 n.4 dei
 * Termini) restano codice morto. Stesso pattern OR di
 * `app/admin/suspension-actions.ts` (`deleteCompanyAction`).
 */
export async function countPenaliByCompany(
  companyIds: string[],
): Promise<Map<string, number>> {
  if (companyIds.length === 0) return new Map();

  const wallets = await prisma.wallet.findMany({
    where: {
      OR: [
        { companyId: { in: companyIds } },
        { sede: { companyId: { in: companyIds } } },
      ],
    },
    select: { id: true, companyId: true, sede: { select: { companyId: true } } },
  });
  if (wallets.length === 0) return new Map();

  const companyByWallet = new Map(
    wallets.map((w) => [w.id, w.companyId ?? w.sede?.companyId ?? null]),
  );

  const penaliCounts = await prisma.transazioneWallet.groupBy({
    by: ['walletId'],
    where: {
      walletId: { in: wallets.map((w) => w.id) },
      tipo: 'PENALE_BROKER',
    },
    _count: { _all: true },
  });

  const result = new Map<string, number>();
  for (const p of penaliCounts) {
    const companyId = companyByWallet.get(p.walletId);
    if (!companyId) continue;
    result.set(companyId, (result.get(companyId) ?? 0) + p._count._all);
  }
  return result;
}
