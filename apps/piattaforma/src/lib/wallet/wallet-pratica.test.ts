import { describe, it, expect, vi, beforeEach } from 'vitest';
import { walletBrokerDellaPratica } from './wallet-pratica';

const upsert = vi.fn();
const tx = { wallet: { upsert } } as unknown as Parameters<typeof walletBrokerDellaPratica>[0];

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ id: 'w1', saldoCent: 0 });
});

describe('walletBrokerDellaPratica', () => {
  it('pratica con sede: usa il wallet della SEDE, mai quello della madre', async () => {
    await walletBrokerDellaPratica(tx, { brokerId: 'c1', brokerSedeId: 's1' });

    expect(upsert).toHaveBeenCalledWith({
      where: { sedeId: 's1' },
      update: {},
      create: { sedeId: 's1', saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
  });

  it('pratica legacy senza sede: ricade sul wallet della madre', async () => {
    await walletBrokerDellaPratica(tx, { brokerId: 'c1', brokerSedeId: null });

    expect(upsert).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      update: {},
      create: { companyId: 'c1', saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
  });

  it('restituisce id e saldo del wallet risolto', async () => {
    upsert.mockResolvedValue({ id: 'w9', saldoCent: 4200 });

    await expect(walletBrokerDellaPratica(tx, { brokerId: 'c1', brokerSedeId: 's1' })).resolves.toEqual({
      id: 'w9',
      saldoCent: 4200,
    });
  });
});
