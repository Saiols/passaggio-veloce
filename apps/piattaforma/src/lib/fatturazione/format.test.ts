import { describe, it, expect } from 'vitest';
import { numeroDocumento, labelTipoDocumento } from './format';

describe('numeroDocumento', () => {
  it('FATTURA_PV → PV-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'FATTURA_PV', numeroProgressivo: 7, anno: 2026 })).toBe('PV-2026-00007');
  });
  it('DOC_BROKER → PV-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'DOC_BROKER', numeroProgressivo: 3, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('PV-0047-2026-00003');
  });
  it('NOTA_VARIAZIONE PV → NC-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'NOTA_VARIAZIONE', numeroProgressivo: 12, anno: 2026 })).toBe('NC-2026-00012');
  });
  it('NOTA_VARIAZIONE broker → NC-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'NOTA_VARIAZIONE', numeroProgressivo: 2, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('NC-0047-2026-00002');
  });
  it('PENALE_BROKER → PN-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'PENALE_BROKER', numeroProgressivo: 1, anno: 2026 })).toBe('PN-2026-00001');
  });
});

describe('labelTipoDocumento', () => {
  it('mappa i tipi', () => {
    expect(labelTipoDocumento('FATTURA_PV')).toBe('Fattura');
    expect(labelTipoDocumento('DOC_BROKER')).toBe('Compenso intermediazione');
    expect(labelTipoDocumento('NOTA_VARIAZIONE')).toBe('Nota di credito');
    expect(labelTipoDocumento('PENALE_BROKER')).toBe('Penale');
  });
});
