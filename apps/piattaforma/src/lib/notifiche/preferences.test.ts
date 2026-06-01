import { describe, it, expect } from 'vitest';
import { isOptionalTipo, shouldSend, OPTIONAL_TIPI } from './preferences';

describe('isOptionalTipo', () => {
  it('marks solleciti/promemoria/recap/valuta as optional', () => {
    expect(isOptionalTipo('N3_BROKER_SOLLECITO')).toBe(true);
    expect(isOptionalTipo('N31_VALUTA_AGENZIA')).toBe(true);
  });
  it('marks transactional notifications as non-optional', () => {
    expect(isOptionalTipo('N1_BROKER_INVIO_PRATICA')).toBe(false);
    expect(isOptionalTipo('N4_BROKER_FIRMA_E_CREDITO')).toBe(false);
  });
});

describe('shouldSend', () => {
  it('always sends mandatory notifications regardless of prefs', () => {
    expect(shouldSend('N4_BROKER_FIRMA_E_CREDITO', { N4_BROKER_FIRMA_E_CREDITO: false })).toBe(true);
  });
  it('sends optional by default (opt-in) when prefs missing', () => {
    expect(shouldSend('N31_VALUTA_AGENZIA', null)).toBe(true);
    expect(shouldSend('N31_VALUTA_AGENZIA', {})).toBe(true);
  });
  it('skips optional when explicitly disabled', () => {
    expect(shouldSend('N31_VALUTA_AGENZIA', { N31_VALUTA_AGENZIA: false })).toBe(false);
  });
  it('keeps optional when explicitly enabled', () => {
    expect(shouldSend('N3_BROKER_SOLLECITO', { N3_BROKER_SOLLECITO: true })).toBe(true);
  });
});

describe('OPTIONAL_TIPI', () => {
  it('contains exactly the 4 optional types', () => {
    expect([...OPTIONAL_TIPI].sort()).toEqual(
      ['N25_MONTHLY_AFFILIATION_RECAP', 'N31_VALUTA_AGENZIA', 'N3_BROKER_SOLLECITO', 'N7_AGENZIA_PROMEMORIA_COUNTDOWN'].sort(),
    );
  });
});
