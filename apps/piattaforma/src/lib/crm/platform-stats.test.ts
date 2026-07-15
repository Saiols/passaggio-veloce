import { describe, it, expect, vi, beforeEach } from 'vitest';

const groupBy = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: { company: { groupBy: (...a: unknown[]) => groupBy(...a) } },
}));

import { getPlatformRegistrationStats } from './platform-stats';

// La funzione fa due groupBy: totali (where senza relazione) e da-lista
// (where con crmContactMatches). Il mock distingue le due chiamate dal `where`,
// così il test non dipende dall'ordine di invocazione dentro Promise.all.
function mockGroupBy(
  totali: Array<{ type: string; n: number }>,
  daLista: Array<{ type: string; n: number }>,
) {
  groupBy.mockImplementation((args: { where?: { crmContactMatches?: unknown } }) => {
    const src = args.where?.crmContactMatches ? daLista : totali;
    return Promise.resolve(src.map((r) => ({ type: r.type, _count: { _all: r.n } })));
  });
}

describe('getPlatformRegistrationStats', () => {
  beforeEach(() => {
    groupBy.mockReset();
  });

  it('mappa DEALER→broker, AGENZIA→agenzia con split da-lista/organici', async () => {
    mockGroupBy(
      [{ type: 'DEALER', n: 5 }, { type: 'AGENZIA', n: 3 }],
      [{ type: 'DEALER', n: 2 }, { type: 'AGENZIA', n: 1 }],
    );
    const res = await getPlatformRegistrationStats();
    expect(res.broker).toEqual({ tot: 5, daLista: 2, organici: 3 });
    expect(res.agenzia).toEqual({ tot: 3, daLista: 1, organici: 2 });
  });

  it('tipo assente nei gruppi → zeri', async () => {
    mockGroupBy([{ type: 'DEALER', n: 4 }], []);
    const res = await getPlatformRegistrationStats();
    expect(res.broker).toEqual({ tot: 4, daLista: 0, organici: 4 });
    expect(res.agenzia).toEqual({ tot: 0, daLista: 0, organici: 0 });
  });

  it('organici mai negativo se da-lista > totale (guard difensivo)', async () => {
    mockGroupBy([{ type: 'DEALER', n: 1 }], [{ type: 'DEALER', n: 3 }]);
    const res = await getPlatformRegistrationStats();
    expect(res.broker.organici).toBe(0);
  });

  it('esegue esattamente due groupBy (totali + da-lista)', async () => {
    mockGroupBy([], []);
    await getPlatformRegistrationStats();
    expect(groupBy).toHaveBeenCalledTimes(2);
    const calls = groupBy.mock.calls.map((c) => c[0]);
    // uno senza filtro relazione, uno con crmContactMatches.some
    expect(calls.some((a) => !a.where?.crmContactMatches)).toBe(true);
    expect(calls.some((a) => a.where?.crmContactMatches?.some)).toBe(true);
  });
});
