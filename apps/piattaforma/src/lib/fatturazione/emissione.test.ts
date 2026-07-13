import { describe, it, expect } from 'vitest';
import { statoEmissione, whereEmissione, labelEmissione } from './emissione';

const T = new Date('2026-07-01T10:00:00Z');

describe('statoEmissione', () => {
  it('documento SdI non ancora trasmesso → DA_EMETTERE', () => {
    expect(statoEmissione({ fatturaPaTipo: 'TD01', trasmessoSdiAt: null })).toBe('DA_EMETTERE');
  });

  it('documento trasmesso → EMESSA', () => {
    expect(statoEmissione({ fatturaPaTipo: 'TD01', trasmessoSdiAt: T })).toBe('EMESSA');
  });

  // Il caso che giustifica l'esistenza di questo modulo: senza il terzo stato,
  // un doc broker in regime PRIVATO (o una penale) finirebbe tra i "da emettere"
  // e il commercialista emetterebbe un documento fuori campo IVA.
  it('fatturaPaTipo null → FUORI_SDI, non DA_EMETTERE', () => {
    expect(statoEmissione({ fatturaPaTipo: null, trasmessoSdiAt: null })).toBe('FUORI_SDI');
  });

  // Combinazione che il write path non produce (nessun percorso marca trasmesso
  // un documento fuori campo). Se un giorno accadesse, "emesso" è il fatto
  // osservato e vince sulla classificazione teorica: meglio mostrarlo emesso che
  // riproporlo eternamente da emettere.
  it('fuori SdI ma marcato trasmesso → EMESSA (il fatto vince)', () => {
    expect(statoEmissione({ fatturaPaTipo: null, trasmessoSdiAt: T })).toBe('EMESSA');
  });
});

describe('whereEmissione', () => {
  it('DA_EMETTERE esclude i documenti fuori campo SdI', () => {
    expect(whereEmissione('DA_EMETTERE')).toEqual({
      fatturaPaTipo: { not: null },
      trasmessoSdiAt: null,
    });
  });

  it('EMESSA filtra sui trasmessi', () => {
    expect(whereEmissione('EMESSA')).toEqual({ trasmessoSdiAt: { not: null } });
  });

  it('param assente o non riconosciuto → nessun filtro', () => {
    expect(whereEmissione(undefined)).toBeUndefined();
    expect(whereEmissione('PIPPO')).toBeUndefined();
  });
});

describe('labelEmissione', () => {
  it('etichette in italiano', () => {
    expect(labelEmissione('DA_EMETTERE')).toBe('Da emettere');
    expect(labelEmissione('EMESSA')).toBe('Emessa');
    expect(labelEmissione('FUORI_SDI')).toBe('Fuori campo SdI');
  });
});
