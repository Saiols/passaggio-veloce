import { describe, it, expect } from 'vitest';
import { regioneVarianti } from './regione';

describe('regioneVarianti', () => {
  it('copre maiuscolo/minuscolo della forma base', () => {
    const v = regioneVarianti('Veneto');
    expect(v).toContain('Veneto');
    expect(v).toContain('VENETO');
    expect(v).toContain('veneto');
  });

  it('copre la variante trattino->spazio in maiuscolo (dato import reale)', () => {
    const v = regioneVarianti('Trentino-Alto Adige');
    expect(v).toContain('TRENTINO ALTO ADIGE'); // come salvato nei CSV scraping
    expect(v).toContain('Trentino-Alto Adige');
  });

  it('mantiene la forma con trattino in maiuscolo (Emilia-Romagna)', () => {
    expect(regioneVarianti('Emilia-Romagna')).toContain('EMILIA-ROMAGNA');
  });

  it("gestisce l'apostrofo (Valle d'Aosta)", () => {
    const v = regioneVarianti("Valle d'Aosta");
    expect(v).toContain("VALLE D'AOSTA");
    expect(v).toContain("Valle d'Aosta");
  });
});
