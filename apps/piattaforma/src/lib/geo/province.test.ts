import { describe, it, expect } from 'vitest';
import { REGIONI_ITALIANE } from '@/lib/crm/regione';
import { regioneDaProvincia, PROVINCE_ITALIANE } from './province';

describe('regioneDaProvincia', () => {
  it('mappa le sigle note', () => {
    expect(regioneDaProvincia('MI')).toBe('Lombardia');
    expect(regioneDaProvincia('RM')).toBe('Lazio');
    expect(regioneDaProvincia('AO')).toBe("Valle d'Aosta");
    expect(regioneDaProvincia('SU')).toBe('Sardegna'); // Sud Sardegna, riforma 2016
  });

  it('tollera minuscolo e spazi', () => {
    expect(regioneDaProvincia(' mi ')).toBe('Lombardia');
  });

  it('sigla ignota o vuota → null (mai un valore inventato)', () => {
    expect(regioneDaProvincia('XX')).toBeNull();
    expect(regioneDaProvincia('')).toBeNull();
    expect(regioneDaProvincia(null)).toBeNull();
    // Province abolite nel 2016: non mappate di proposito, meglio nessun
    // valore che uno sbagliato.
    expect(regioneDaProvincia('OT')).toBeNull();
  });

  it('sono 107 sigle e ognuna punta a una regione canonica', () => {
    const sigle = Object.keys(PROVINCE_ITALIANE);
    expect(sigle).toHaveLength(107);
    for (const s of sigle) {
      expect(REGIONI_ITALIANE).toContain(PROVINCE_ITALIANE[s]);
    }
  });

  it('copre tutte e 20 le regioni', () => {
    const coperte = new Set(Object.values(PROVINCE_ITALIANE));
    expect([...coperte].sort()).toEqual([...REGIONI_ITALIANE].sort());
  });
});
