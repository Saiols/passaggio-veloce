import { describe, it, expect } from 'vitest';
import { extractCi } from './extract-ci';
import { extractCf } from './extract-cf';

describe('extractCi', () => {
  it('estrae cognome e nome dai campi etichettati', () => {
    const r = extractCi('REPUBBLICA ITALIANA\nCOGNOME\nROSSI\nNOME\nMARIO\n');
    expect(r.cognome).toBe('ROSSI');
    expect(r.nome).toBe('MARIO');
  });
  it('campi assenti undefined', () => {
    const r = extractCi('testo senza campi');
    expect(r.cognome).toBeUndefined();
  });
});

describe('extractCf', () => {
  it('estrae il codice fiscale dalla tessera sanitaria', () => {
    const r = extractCf('TESSERA SANITARIA\nCODICE FISCALE\nRSSMRA80A01H501U\n');
    expect(r.codiceFiscale).toBe('RSSMRA80A01H501U');
  });
  it('CF assente undefined', () => {
    expect(extractCf('nessun codice').codiceFiscale).toBeUndefined();
  });
});
