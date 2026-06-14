import { describe, it, expect } from 'vitest';
import { splitImporto, fatturaPaTipoPerRegime } from './calcolo';

describe('splitImporto', () => {
  it('ORDINARIO: scorpora IVA 22% da lordo (75,00 → 61,48 + 13,52)', () => {
    expect(splitImporto(7500, 'ORDINARIO')).toEqual({
      imponibileCent: 6148,
      ivaCent: 1352,
      aliquotaIvaPct: 22,
    });
  });

  it('FORFETTARIO: fuori campo IVA (iva 0, imponibile = lordo)', () => {
    expect(splitImporto(2000, 'FORFETTARIO')).toEqual({
      imponibileCent: 2000,
      ivaCent: 0,
      aliquotaIvaPct: 0,
    });
  });

  it('PRIVATO: nessuna IVA (imponibile = lordo)', () => {
    expect(splitImporto(2000, 'PRIVATO')).toEqual({
      imponibileCent: 2000,
      ivaCent: 0,
      aliquotaIvaPct: 0,
    });
  });

  it('preserva il segno per importi negativi (note di credito)', () => {
    expect(splitImporto(-7500, 'ORDINARIO')).toEqual({
      imponibileCent: -6148,
      ivaCent: -1352,
      aliquotaIvaPct: 22,
    });
  });
});

describe('fatturaPaTipoPerRegime', () => {
  it('FATTURA_PV è sempre TD01', () => {
    expect(fatturaPaTipoPerRegime('FATTURA_PV', 'FORFETTARIO')).toBe('TD01');
  });
  it('DOC_BROKER ordinario → TD01', () => {
    expect(fatturaPaTipoPerRegime('DOC_BROKER', 'ORDINARIO')).toBe('TD01');
  });
  it('DOC_BROKER forfettario → TD06', () => {
    expect(fatturaPaTipoPerRegime('DOC_BROKER', 'FORFETTARIO')).toBe('TD06');
  });
  it('DOC_BROKER privato → null (ricevuta non fiscale, no XML)', () => {
    expect(fatturaPaTipoPerRegime('DOC_BROKER', 'PRIVATO')).toBeNull();
  });
  it('NOTA_VARIAZIONE → TD04', () => {
    expect(fatturaPaTipoPerRegime('NOTA_VARIAZIONE', 'ORDINARIO')).toBe('TD04');
  });
});
