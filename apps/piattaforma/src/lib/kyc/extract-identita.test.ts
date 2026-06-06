import { describe, it, expect } from 'vitest';
import { extractIdentita } from './extract-identita';

describe('extractIdentita', () => {
  it('CI: nome/cognome/CF dai campi etichettati', () => {
    const r = extractIdentita('COGNOME\nROSSI\nNOME\nMARIO\nCODICE FISCALE\nRSSMRA80A01H501U', 'CI');
    expect(r.cognome).toBe('ROSSI'); expect(r.nome).toBe('MARIO'); expect(r.codiceFiscale).toBe('RSSMRA80A01H501U');
  });
  it('PASSAPORTO: cognome/nome da MRZ', () => {
    const mrz = 'P<ITAROSSI<<MARIO<<<<<<<<<<<<<<<<<<<<<<<<<<\nYA1234567ITA8001011M3001011<<<<<<<<<<<<<<04';
    const r = extractIdentita(mrz, 'PASSAPORTO');
    expect(r.cognome).toBe('ROSSI'); expect(r.nome).toBe('MARIO');
  });
  it('PATENTE: cognome/nome dai campi 1/2', () => {
    const r = extractIdentita('PATENTE DI GUIDA\n1. ROSSI\n2. MARIO\n3. 01.01.1980 ROMA', 'PATENTE');
    expect(r.cognome).toBe('ROSSI'); expect(r.nome).toBe('MARIO');
  });
  it('campi assenti → undefined senza lanciare', () => {
    expect(extractIdentita('testo', 'PASSAPORTO').cognome).toBeUndefined();
  });
});
