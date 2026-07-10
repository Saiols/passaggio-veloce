import { describe, expect, it } from 'vitest';
import {
  FILTRO_MOVIMENTI_AZIENDA,
  costruisciRigheSaldo,
  filtraMovimentiPerSede,
  normalizzaFiltroSede,
} from './wallet-aggregato-data';

describe('costruisciRigheSaldo', () => {
  it('attribuisce alle sedi le commissioni disponibili del wallet aziendale', () => {
    const righe = costruisciRigheSaldo({
      sedi: [
        { id: 's1', nome: 'Milano' },
        { id: 's2', nome: 'Roma' },
      ],
      wallets: [
        { sedeId: 's1', saldoCent: 0 },
        { sedeId: 's2', saldoCent: 0 },
      ],
      affiliazioni: [
        { referenteSedeId: 's1', saldoCent: 8_000 },
        { referenteSedeId: 's2', saldoCent: 2_000 },
      ],
      saldoAziendaleCent: 10_000,
    });

    expect(righe.map((r) => [r.nome, r.saldoCent])).toEqual([
      ['Milano', 8_000],
      ['Roma', 2_000],
    ]);
    expect(righe.reduce((totale, riga) => totale + riga.saldoCent, 0)).toBe(10_000);
  });

  it('espone separatamente il saldo aziendale che non può essere attribuito', () => {
    const righe = costruisciRigheSaldo({
      sedi: [{ id: 's1', nome: 'Milano' }],
      wallets: [{ sedeId: 's1', saldoCent: 1_000 }],
      affiliazioni: [{ referenteSedeId: 's1', saldoCent: 2_000 }],
      saldoAziendaleCent: 2_500,
    });

    expect(righe).toEqual([
      expect.objectContaining({ sedeId: 's1', saldoCent: 3_000 }),
      expect.objectContaining({ sedeId: null, saldoCent: 500 }),
    ]);
    expect(righe.reduce((totale, riga) => totale + riga.saldoCent, 0)).toBe(3_500);
  });
});

describe('filtro movimenti per sede', () => {
  const movimenti = [
    { id: 'm1', sedeId: 's1' },
    { id: 'm2', sedeId: 's2' },
    { id: 'm3', sedeId: null },
  ];

  it('accetta solo una sede accessibile o il filtro aziendale', () => {
    expect(normalizzaFiltroSede('s2', ['s1', 's2'])).toBe('s2');
    expect(normalizzaFiltroSede('s3', ['s1', 's2'])).toBeNull();
    expect(normalizzaFiltroSede(FILTRO_MOVIMENTI_AZIENDA, ['s1'])).toBe(FILTRO_MOVIMENTI_AZIENDA);
  });

  it('filtra sedi reali e movimenti aziendali non attribuiti', () => {
    expect(filtraMovimentiPerSede(movimenti, 's1')).toEqual([movimenti[0]]);
    expect(filtraMovimentiPerSede(movimenti, FILTRO_MOVIMENTI_AZIENDA)).toEqual([movimenti[2]]);
    expect(filtraMovimentiPerSede(movimenti, null)).toEqual(movimenti);
  });
});
