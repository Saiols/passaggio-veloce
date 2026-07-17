import { describe, it, expect, vi } from 'vitest';
import { logCambioStato, STATO_EVENTO } from './stato-log';

describe('logCambioStato', () => {
  it('crea la riga con tipoEvento dentro meta e i default null', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { praticaStatoLog: { create } } as never;

    await logCambioStato(tx, {
      praticaId: 'p1',
      statoA: 'ACCETTATA',
      tipoEvento: STATO_EVENTO.ACCEPT,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      data: {
        praticaId: 'p1',
        statoDa: null,
        statoA: 'ACCETTATA',
        motivo: null,
        attoreUserId: null,
        meta: { tipoEvento: 'ACCEPT' },
      },
    });
  });

  it('propaga statoDa/motivo/attore e fonde meta extra', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { praticaStatoLog: { create } } as never;

    await logCambioStato(tx, {
      praticaId: 'p2',
      statoDa: 'ACCETTATA',
      statoA: 'IN_ATTESA_ROUND_1',
      tipoEvento: STATO_EVENTO.RECIRCULATE,
      attoreUserId: 'u1',
      motivo: 'agenzia inattiva',
      meta: { ciclo: 2 },
    });

    expect(create.mock.calls[0][0].data).toMatchObject({
      statoDa: 'ACCETTATA',
      attoreUserId: 'u1',
      motivo: 'agenzia inattiva',
      meta: { tipoEvento: 'RECIRCULATE', ciclo: 2 },
    });
  });
});
