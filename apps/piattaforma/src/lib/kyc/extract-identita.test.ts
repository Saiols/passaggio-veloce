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

// Fixture fedeli al TESTO REALE estratto da Google Document AI (campioni reali
// patente/passaporto). NB i quirk del layout reale: sulla patente "2." e il nome
// finiscono su righe separate; il passaporto riporta sia i campi VIZ etichettati
// sia la MRZ in fondo. Servono da test di regressione anti-rottura.
const PATENTE_REALE = [
  '9. AB', '|', 'PATENTE DI GUIDA REPUBBLICA ITALIANA',
  '1. SIOLI', '2.', 'FRANCESCO',
  '4a. 01/09/2025 4c. MIT-UCO', '3. 27/04/96 MILANO (MI)', '4b. 27/04/2032',
  '5.', 'Sinh Fa', 'U1592H180B',
  'Patente di guida Driving Licence Vadītāja apliecība',
  'Modello UE di patente di guida Modello UE',
].join('\n');

const PASSAPORTO_VIZ = [
  'PASSAPORTO', 'PASSPORT', 'PASSEPORT', 'REPUBBLICA ITALIANA',
  'Tipo. Type. Type. Codice Paese. Code of issuing State. Passaporto N. Passport No.',
  'P', 'ITA', 'YB3488424',
  'Cognome. Surname. Nom. (1)', 'SIOLI',
  'Nome. Given Names Prénoms (2)', 'FRANCESCO',
  'Cittadinanza, Nationality, Nationalité, (3)', 'ITALIANA',
  'Data di nascita, Date of birth Date de naissance. (4)', '27 APR/APR 1996',
  'Luogo di nascita. Place of birth. (6)', 'MILANO', '(MI)',
];
const PASSAPORTO_REALE = [
  ...PASSAPORTO_VIZ,
  'P<ITASIOLI<<FRANCESCO<<<<<<<<<<<<<<<<<<<<<<<',
  'YB34884242ITA9604272M2807085<<<<<<<<<<<<<<02',
].join('\n');
// Foto con MRZ tagliata/illeggibile: restano solo i campi VIZ.
const PASSAPORTO_SENZA_MRZ = PASSAPORTO_VIZ.join('\n');

describe('extractIdentita su layout OCR reale (Document AI)', () => {
  it('PATENTE reale: cognome/nome dai campi 1/2 (anche con nome su riga separata)', () => {
    const r = extractIdentita(PATENTE_REALE, 'PATENTE');
    expect(r.cognome).toBe('SIOLI');
    expect(r.nome).toBe('FRANCESCO');
  });

  it('PASSAPORTO reale: cognome/nome dalla MRZ', () => {
    const r = extractIdentita(PASSAPORTO_REALE, 'PASSAPORTO');
    expect(r.cognome).toBe('SIOLI');
    expect(r.nome).toBe('FRANCESCO');
  });

  it('PASSAPORTO con MRZ illeggibile: fallback ai campi etichettati (1)/(2)', () => {
    const r = extractIdentita(PASSAPORTO_SENZA_MRZ, 'PASSAPORTO');
    expect(r.cognome).toBe('SIOLI');
    expect(r.nome).toBe('FRANCESCO');
  });
});
