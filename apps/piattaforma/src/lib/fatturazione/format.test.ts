import { describe, it, expect } from 'vitest';
import { numeroDocumento, labelTipoDocumento } from './format';

describe('numeroDocumento', () => {
  it('formatta numero/anno', () => {
    expect(numeroDocumento({ numeroProgressivo: 7, anno: 2026 })).toBe('7/2026');
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
