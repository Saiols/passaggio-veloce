import { describe, it, expect } from 'vitest';
import { parsePermessoText } from './extract-permesso';

describe('parsePermessoText', () => {
  it('estrae cognome/nome/scadenza da layout bilingue', () => {
    const txt = `PERMESSO DI SOGGIORNO
PERMIT OF STAY
COGNOME / SURNAME  SMITH
NOME / NAME  JOHN
SCADENZA / EXPIRY  01/01/2027`;
    const r = parsePermessoText(txt);
    expect(r.cognome).toBe('SMITH');
    expect(r.nome).toBe('JOHN');
    expect(r.scadenza).toBe('2027-01-01');
  });

  it('gestisce etichette solo italiane su righe separate', () => {
    const txt = `COGNOME\nROSSI\nNOME\nMARIA\nVALIDO FINO AL 31/12/2026`;
    const r = parsePermessoText(txt);
    expect(r.cognome).toBe('ROSSI');
    expect(r.nome).toBe('MARIA');
    expect(r.scadenza).toBe('2026-12-31');
  });

  it('non confonde SURNAME col valore di COGNOME', () => {
    expect(parsePermessoText('COGNOME / SURNAME BIANCHI').cognome).toBe('BIANCHI');
  });

  it('campi assenti → undefined senza lanciare', () => {
    const r = parsePermessoText('TESTO NON PERTINENTE');
    expect(r.cognome).toBeUndefined();
    expect(r.scadenza).toBeUndefined();
  });
});
