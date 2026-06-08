import { describe, it, expect } from 'vitest';
import { extractCi } from './extract-ci';

describe('extractCi', () => {
  it('CI cartacea: etichetta e valore sulla stessa riga (con punteggiatura OCR)', () => {
    // Testo OCR reale di una carta d'identità cartacea (Document AI).
    const txt = `Cognome, SAINO
Nome. FEDERICA
nato il 09/12/1994
a MILANO
Cittadinanza ITALIANA
Residenza MILANO`;
    const r = extractCi(txt);
    expect(r.cognome).toBe('SAINO');
    expect(r.nome).toBe('FEDERICA');
  });

  it('CIE elettronica: valore sulla riga successiva', () => {
    const txt = `COGNOME\nROSSI\nNOME\nMARIO\nCODICE FISCALE`;
    const r = extractCi(txt);
    expect(r.cognome).toBe('ROSSI');
    expect(r.nome).toBe('MARIO');
  });

  it('non confonde NOME con COGNOME', () => {
    const r = extractCi('Cognome: BIANCHI\nNome: LUCA');
    expect(r.cognome).toBe('BIANCHI');
    expect(r.nome).toBe('LUCA');
  });

  it('testo non pertinente → campi undefined', () => {
    const r = extractCi('documento qualsiasi senza etichette');
    expect(r.cognome).toBeUndefined();
    expect(r.nome).toBeUndefined();
  });
});
