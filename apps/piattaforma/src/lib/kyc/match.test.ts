import { describe, it, expect } from 'vitest';
import {
  normalizeName, normalizeCompanyName, normalizeCf, normalizePiva,
  isValidCodiceFiscale, nameMatches, companyMatches,
} from './match';

describe('normalize', () => {
  it('normalizeName: upper, no accenti, spazi singoli', () => {
    expect(normalizeName(' Niccolò  D’Égìdio ')).toBe('NICCOLO D EGIDIO');
  });
  it('normalizeCompanyName: rimuove forma giuridica', () => {
    expect(normalizeCompanyName('Rossi Auto S.R.L.')).toBe('ROSSI AUTO');
    expect(normalizeCompanyName('Bianchi S.p.A.')).toBe('BIANCHI');
  });
  it('normalizeCf / normalizePiva', () => {
    expect(normalizeCf(' rssmra80a01h501u ')).toBe('RSSMRA80A01H501U');
    expect(normalizePiva('IT 1234567890 1')).toBe('12345678901');
  });
});

describe('isValidCodiceFiscale', () => {
  it('accetta un CF valido', () => {
    expect(isValidCodiceFiscale('RSSMRA80A01H501U')).toBe(true);
  });
  it('rifiuta CF con check digit errato o formato sbagliato', () => {
    expect(isValidCodiceFiscale('RSSMRA80A01H501X')).toBe(false);
    expect(isValidCodiceFiscale('NONVALIDO')).toBe(false);
  });
});

describe('nameMatches', () => {
  it('match con ordine diverso e rumore di accenti/maiuscole', () => {
    expect(nameMatches('Mario Rossi', 'ROSSI MARIO')).toBe(true);
  });
  it('tollera un refuso OCR (1 carattere)', () => {
    expect(nameMatches('Mario Rossi', 'Mario Rossi')).toBe(true);
  });
  it('rifiuta nomi diversi', () => {
    expect(nameMatches('Mario Rossi', 'Luca Bianchi')).toBe(false);
  });
});

describe('companyMatches', () => {
  it('match per P.IVA anche con denominazione diversa', () => {
    expect(companyMatches(
      { denominazione: 'X', partitaIva: '12345678901' },
      { denominazione: 'Y', partitaIva: '12345678901' },
    )).toBe(true);
  });
  it('match per denominazione normalizzata se P.IVA assente', () => {
    expect(companyMatches(
      { denominazione: 'Rossi Auto SRL' },
      { denominazione: 'ROSSI AUTO', partitaIva: '12345678901' },
    )).toBe(true);
  });
  it('rifiuta aziende diverse', () => {
    expect(companyMatches(
      { denominazione: 'Rossi Auto', partitaIva: '11111111111' },
      { denominazione: 'Bianchi Auto', partitaIva: '22222222222' },
    )).toBe(false);
  });
});
