import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IMPORTANT (review finale branch): l'alert "N penali confermate" (admin
 * broker list, clausole 10.7 e 11.3 n.4 dei Termini) non scattava mai. Il
 * conteggio filtrava solo i wallet MADRE (`wallet.companyId`), ma la penale
 * è addebitata sul wallet di SEDE (`walletBrokerDellaPratica`, dal 24 giugno
 * / migration `20260624013750_multi_sede_expand`). Verificato sul DB reale:
 * 0 wallet con `companyId` popolato, l'unica penale esistente è su un wallet
 * di sede -> il conteggio tornava 0 per ogni broker.
 *
 * Fix: contare le `PENALE_BROKER` su TUTTI i wallet della company — madre E
 * di sede — stesso pattern OR di `app/admin/suspension-actions.ts`
 * (`deleteCompanyAction`): `OR: [{ companyId }, { sede: { companyId } }]`.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    wallet: { findMany: vi.fn() },
    transazioneWallet: { groupBy: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('server-only', () => ({}));

import { countPenaliByCompany } from './count';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countPenaliByCompany', () => {
  it('conta le penali sui wallet di SEDE (oggi con la query solo-companyId tornerebbe 0)', async () => {
    // Wallet operativo reale: appartiene a una sede, `companyId` è null.
    prismaMock.wallet.findMany.mockResolvedValue([
      { id: 'wallet-sede-a', companyId: null, sede: { companyId: COMPANY_A } },
    ]);
    prismaMock.transazioneWallet.groupBy.mockResolvedValue([
      { walletId: 'wallet-sede-a', _count: { _all: 2 } },
    ]);

    const result = await countPenaliByCompany([COMPANY_A]);

    expect(result.get(COMPANY_A)).toBe(2);
    // La query a `wallet.findMany` deve includere il ramo di sede, non solo companyId.
    const where = prismaMock.wallet.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      OR: [
        { companyId: { in: [COMPANY_A] } },
        { sede: { companyId: { in: [COMPANY_A] } } },
      ],
    });
  });

  it('somma le penali di wallet madre + wallet di sede per la stessa company', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      { id: 'wallet-madre-a', companyId: COMPANY_A, sede: null },
      { id: 'wallet-sede-a1', companyId: null, sede: { companyId: COMPANY_A } },
      { id: 'wallet-sede-a2', companyId: null, sede: { companyId: COMPANY_A } },
    ]);
    prismaMock.transazioneWallet.groupBy.mockResolvedValue([
      { walletId: 'wallet-madre-a', _count: { _all: 1 } },
      { walletId: 'wallet-sede-a1', _count: { _all: 3 } },
      { walletId: 'wallet-sede-a2', _count: { _all: 1 } },
    ]);

    const result = await countPenaliByCompany([COMPANY_A]);

    expect(result.get(COMPANY_A)).toBe(5);
  });

  it('nessun wallet per la company -> Map vuota, nessuna chiamata a groupBy', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([]);

    const result = await countPenaliByCompany([COMPANY_A]);

    expect(result.size).toBe(0);
    expect(prismaMock.transazioneWallet.groupBy).not.toHaveBeenCalled();
  });

  it('non mescola le penali tra company diverse', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      { id: 'wallet-sede-a', companyId: null, sede: { companyId: COMPANY_A } },
      { id: 'wallet-sede-b', companyId: null, sede: { companyId: COMPANY_B } },
    ]);
    prismaMock.transazioneWallet.groupBy.mockResolvedValue([
      { walletId: 'wallet-sede-a', _count: { _all: 2 } },
      { walletId: 'wallet-sede-b', _count: { _all: 7 } },
    ]);

    const result = await countPenaliByCompany([COMPANY_A, COMPANY_B]);

    expect(result.get(COMPANY_A)).toBe(2);
    expect(result.get(COMPANY_B)).toBe(7);
  });

  it('array vuoto di companyIds: nessuna query, Map vuota', async () => {
    const result = await countPenaliByCompany([]);

    expect(result.size).toBe(0);
    expect(prismaMock.wallet.findMany).not.toHaveBeenCalled();
  });
});
