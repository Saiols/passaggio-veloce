import { describe, it, expect } from 'vitest';
import { sediDaEscludere } from './esclusioni';

describe('sediDaEscludere', () => {
  it('ciclo normale (mai revocata): esclude tutte le sedi del ciclo corrente', () => {
    const out = sediDaEscludere({
      distribuzioneCiclo: 1,
      assegnazioni: [
        { sedeId: 's1', ciclo: 1, esito: 'PENDING' },
        { sedeId: 's2', ciclo: 1, esito: 'RIFIUTATA' },
        { sedeId: null, ciclo: 1, esito: 'TIMEOUT' },
      ],
    });
    expect(out.sort()).toEqual(['s1', 's2']);
  });

  it('dopo revoca: esclude SOLO la revocata, ricontatta chi era nel ciclo vecchio', () => {
    const out = sediDaEscludere({
      distribuzioneCiclo: 2,
      assegnazioni: [
        { sedeId: 's1', ciclo: 1, esito: 'REVOCATA_ADMIN' }, // permanente
        { sedeId: 's2', ciclo: 1, esito: 'ASSEGNATA_ALTRO' }, // ciclo vecchio → ricontattabile
        { sedeId: 's3', ciclo: 1, esito: 'RIFIUTATA' }, // ciclo vecchio → ricontattabile
      ],
    });
    expect(out).toEqual(['s1']);
  });

  it('seconda revoca: accumula le esclusioni permanenti', () => {
    const out = sediDaEscludere({
      distribuzioneCiclo: 3,
      assegnazioni: [
        { sedeId: 's1', ciclo: 1, esito: 'REVOCATA_ADMIN' },
        { sedeId: 's2', ciclo: 2, esito: 'REVOCATA_ADMIN' },
        { sedeId: 's3', ciclo: 2, esito: 'ASSEGNATA_ALTRO' }, // ricontattabile
        { sedeId: 's4', ciclo: 3, esito: 'PENDING' }, // ciclo corrente → escluso
      ],
    });
    expect(out.sort()).toEqual(['s1', 's2', 's4']);
  });
});
