import { describe, it, expect } from 'vitest';
import { parseFoglioComplementareText } from './foglio-complementare-parser';

// Fixture: trascrizione fedele dei due fogli complementari reali (PRA) forniti
// 2026-06-29 (Renault Clio e Ford Fiesta, stesso commerciante DIMENSIONE AUTO
// MILANO). Testo "DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE" + N. Progressivo PRA
// + Scrittura Privata. NB: il foglio NON riporta la data di prima
// immatricolazione (campo B del libretto) → dataImmatricolazione deve restare
// undefined. Da rivalidare sul testo OCR reale (Document AI) quando disponibile.
const FOGLIO_A = [
  'Ministero delle Infrastrutture e dei Trasporti',
  'DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE',
  'A081814MI26 03/02/2026 M1',
  'GT440ZX VF1RJA00672164604',
  'RENAULT',
  'RJA BE2 MG5WA2HA5000',
  'CLIO',
  'AUTOVETTURA PER TRASPORTO DI PERSONE -USO PROPRIO',
  '049,00 kw EURO6E Massa massima 1540 kg',
  'DIMENSIONE AUTO MILANO SPL',
  '13180640966',
  'BUCCINASCO (MI)',
  'PZZA CAVALIERI DI VITT VENETO 23',
  'Art. 56 comma 6 D. Lgs. n. 446/1997',
  'N. Progressivo PRA 26/B504321K',
  'Scrittura Privata del 03-02-2026',
  'Vincoli/Gravami:No',
  'IMPOSTA DI BOLLO ASSOLTA IN MODO VIRTUALE',
  'MI1417',
].join('\n');

const FOGLIO_B = [
  'Ministero delle Infrastrutture e dei Trasporti',
  'DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE',
  'A684319MI25 03/10/2025',
  'DP243SK WF0DXXGAJD8G75490 OEWF017EST86 M1',
  'FORD W GMBH JD3 FUJA1 5BEBKA',
  'FIESTA',
  'AUTOVETTURA PER TRASPORTO DI PERSONE -USO PROPRIO',
  '055,00 kw EURO4 Massa massima 1520 kg',
  'DIMENSIONE AUTO MILANO SPL',
  '13180640966',
  'BUCCINASCO (MI)',
  'PZZA CAVALIERI DI VITT VENETO 23',
  'Art. 56 comma 6 D. Lgs. n. 446/1997',
  'N. Progressivo PRA 25/N620029S',
  'Scrittura Privata del 03-10-2025',
  'Vincoli/Gravami:No',
  'IMPOSTA DI BOLLO ASSOLTA IN MODO VIRTUALE',
  'MI1417',
].join('\n');

describe('parseFoglioComplementareText (foglio complementare PRA)', () => {
  it('Doc A (Renault Clio): targa, telaio, intestatario azienda+P.IVA, data scrittura', () => {
    const r = parseFoglioComplementareText(FOGLIO_A, 0.9);
    expect(r.targa).toBe('GT440ZX');
    expect(r.telaio).toBe('VF1RJA00672164604');
    expect(r.proprietarioAttuale).toBe('DIMENSIONE AUTO MILANO SPL');
    expect(r.proprietariInfo?.[0]?.isPersonaGiuridica).toBe(true);
    expect(r.proprietariInfo?.[0]?.piva).toBe('13180640966');
    expect(r.dataAcquisto).toBe('2026-02-03');
    expect(r.confidenceScore).toBe(0.9);
  });

  it('Doc B (Ford Fiesta): targa, telaio, intestatario azienda+P.IVA, data scrittura', () => {
    const r = parseFoglioComplementareText(FOGLIO_B, 0.8);
    expect(r.targa).toBe('DP243SK');
    expect(r.telaio).toBe('WF0DXXGAJD8G75490');
    expect(r.proprietarioAttuale).toBe('DIMENSIONE AUTO MILANO SPL');
    expect(r.proprietariInfo?.[0]?.piva).toBe('13180640966');
    expect(r.dataAcquisto).toBe('2025-10-03');
  });

  it('NON inventa la data di immatricolazione (assente sul foglio complementare)', () => {
    expect(parseFoglioComplementareText(FOGLIO_A, 0.9).dataImmatricolazione).toBeUndefined();
    expect(parseFoglioComplementareText(FOGLIO_B, 0.9).dataImmatricolazione).toBeUndefined();
  });

  it('foglio post-2015 (regime digitale) → preImm2015 false', () => {
    expect(parseFoglioComplementareText(FOGLIO_A, 0.9).preImm2015).toBe(false);
    expect(parseFoglioComplementareText(FOGLIO_B, 0.9).preImm2015).toBe(false);
  });

  it('non estrae l\'omologazione (12 char) come telaio: prende il VIN da 17', () => {
    // In Doc B "OEWF017EST86" (omologazione) precede spazialmente nulla di 17 char:
    // il telaio resta il VIN. Discriminatore anti-omologazione.
    const r = parseFoglioComplementareText(FOGLIO_B, 0.9);
    expect(r.telaio).toBe('WF0DXXGAJD8G75490');
    expect(r.telaio).not.toBe('OEWF017EST86');
  });

  it('campi assenti → undefined senza lanciare', () => {
    const r = parseFoglioComplementareText('testo non pertinente', 0.5);
    expect(r.targa).toBeUndefined();
    expect(r.telaio).toBeUndefined();
    expect(r.proprietarioAttuale).toBeUndefined();
    expect(r.rawText).toBe('testo non pertinente');
  });
});
