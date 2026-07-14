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

// Fixture fedeli al TESTO REALE estratto da Google Document AI da una CIE
// fotografata con un riflesso sulla riga anagrafica. Quirk del layout reale:
// l'etichetta è BILINGUE ("NOME / NAME") e quando la barra si perde — glifo
// sottile, ancor più fragile sotto il riflesso — le due parole restano sulla
// stessa riga, separate da uno spazio o addirittura fuse. Il valore è sempre
// sulla riga successiva. Servono da test di regressione anti-rottura.
const CIE_RIFLESSO_RITAGLIO = [
  'REPUBBLICA ITALIANA', "MINISTERO DELL'INTERNO",
  'CARTA DI IDENTITA / IDENTITY CARD', 'COMUNE DI / MUNICIPALITY', 'SPOLETO',
  'COGNOME/SURNAME', 'VARDARO',
  'NOME NAME', 'GIUSEPPE',
  'LUOGO E DATA DI NASCITA', 'PLACE AND DATE OF BIRTH', 'SPOLETO (PG) 02.01.1985',
  'SESSO', 'SEX', 'M', 'STATURA', 'HEIGHT', '179',
].join('\n');

// Stessa carta, foto non ritagliata: qui l'OCR fonde le due parole.
const CIE_RIFLESSO_FOTO = CIE_RIFLESSO_RITAGLIO.replace('NOME NAME', 'NOMENAME');

// Etichetta bilingue spezzata su due righe dalla segmentazione dell'OCR.
const CIE_ETICHETTA_SU_DUE_RIGHE = [
  'COGNOME', 'SURNAME', 'VARDARO',
  'NOME', 'NAME', 'GIUSEPPE',
  'CODICE FISCALE',
].join('\n');

describe('extractCi su layout OCR reale (Document AI)', () => {
  it('CIE con riflesso: "NOME NAME" è etichetta, non valore', () => {
    const r = extractCi(CIE_RIFLESSO_RITAGLIO);
    expect(r.cognome).toBe('VARDARO');
    expect(r.nome).toBe('GIUSEPPE');
  });

  it('CIE con riflesso, etichetta fusa ("NOMENAME")', () => {
    const r = extractCi(CIE_RIFLESSO_FOTO);
    expect(r.cognome).toBe('VARDARO');
    expect(r.nome).toBe('GIUSEPPE');
  });

  it('etichetta bilingue spezzata su due righe: salta la traduzione inglese', () => {
    const r = extractCi(CIE_ETICHETTA_SU_DUE_RIGHE);
    expect(r.cognome).toBe('VARDARO');
    expect(r.nome).toBe('GIUSEPPE');
  });

  it('anche il cognome è al riparo se l\'OCR perde la barra', () => {
    const r = extractCi('COGNOME SURNAME\nVARDARO\nNOME NAME\nGIUSEPPE');
    expect(r.cognome).toBe('VARDARO');
    expect(r.nome).toBe('GIUSEPPE');
  });
});
