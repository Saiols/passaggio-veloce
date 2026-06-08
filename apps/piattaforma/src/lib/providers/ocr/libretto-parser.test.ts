import { describe, it, expect } from 'vitest';
import { parseLibrettoText } from './libretto-parser';

// Fixture basato sulla struttura OCR reale di Document AI su una carta di
// circolazione (Mod. MC 820 D), con dati personali ANONIMIZZATI. Riproduce:
// - i codici della sezione dati: (A) targa, (B) prima immatric., (C.2.1)/(C.2.2)
//   proprietario, (E) telaio, (I) — reso "(1)" dall'OCR — data della carta;
// - la legenda sul retro ("SIGNIFICATO DEI CODICI...") che ripete i codici come
//   DESCRIZIONI (la fonte del vecchio bug: il parser leggeva la legenda).
const REAL = `Mod. MC 820 D
REPUBBLICA ITALIANA
CARTA DI CIRCOLAZIONE
N°
(A)
A000000M000
AB123CD
(D.1) FIAT
(D.2) 312 AXA1A 00E
N° A000000M000
(B) 14.02.2012
(C.2.1) ROSSI
(C.2.2) MARIA
(A)
AB123CD
NATO IL 09.12.1980 (RSSMRA80A01F205X)
A MILANO (MI)
(C.2.3) VIA ROMA 1
MILANO (MI)
(D.3) FIAT 500
(E) ZFA31200000999999
(F.1)
(F.2) 1305 (F.3) 2105 (G)
(1) 21.04.2026
(J) M1
(K) OEZFA33EA
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(A) Numero di immatricolazione
(B) Data della prima immatricolazione del veicolo
(C.2) proprietario del veicolo
(C.2.1) cognome o ragione sociale
(C.2.2) nome/i o iniziale/i (se del caso)
(C.2.3) indirizzo nello Stato di immatricolazione
(E) numero di identificazione del veicolo
(1) data di immatricolazione alla quale si riferisce la carta di circolazione`;

describe('parseLibrettoText — carta reale (anonimizzata)', () => {
  const r = parseLibrettoText(REAL, 0.92);

  it('targa da (A), non il numero della carta', () => {
    expect(r.targa).toBe('AB123CD');
  });
  it('telaio da (E)', () => {
    expect(r.telaio).toBe('ZFA31200000999999');
  });
  it('data prima immatricolazione da (B)', () => {
    expect(r.dataImmatricolazione).toBe('2012-02-14');
  });
  it('data acquisto da (I) reso "(1)" dall’OCR', () => {
    expect(r.dataAcquisto).toBe('2026-04-21');
  });
  it('proprietario = (C.2.1) cognome + (C.2.2) nome', () => {
    expect(r.proprietarioAttuale).toBe('ROSSI MARIA');
    expect(r.proprietari).toEqual(['ROSSI MARIA']);
  });
  it('estrae il CF del proprietario tra (C.2.2) e (C.2.3)', () => {
    expect(r.proprietarioCf).toBe('RSSMRA80A01F205X');
  });
  it('pre-2015 dalla data di acquisto (I), NON dalla prima immatricolazione', () => {
    // (I)=2026 → post-2015, anche se (B)=2012.
    expect(r.preImm2015).toBe(false);
  });
  it('non legge la legenda come proprietario', () => {
    expect(r.proprietarioAttuale).not.toMatch(/COGNOME|RAGIONE|SOCIALE|NOME/);
  });
  it('confidence propagata', () => {
    expect(r.confidenceScore).toBe(0.92);
  });
});

describe('parseLibrettoText — co-intestatari (C.2 azienda + C.3 persona)', () => {
  // Caso leasing reale (anonimizzato): C.2 = società proprietaria (P.IVA),
  // C.3 = utilizzatore persona fisica (CF).
  const LEASE = `(A) AB123CD
(B) 18.08.2023
(C.2.1) ACME LEASING SPA
(C.2.3) CORSO ORBASSANO 367
TORINO (TO)
(08349560014)
(E) ZFA31200000999999
(C.3.1) ROSSI
(C.3.2) MARIO
NATO IL 22.02.1965 (RSSMRA80A01F205X)
A MILANO (MI)
(C.3.3) VIA ROMA 21
(1) 18.08.2023
SIGNIFICATO DEI CODICI COMUNITARI ARMONIZZATI
(C.2.1) cognome o ragione sociale`;

  it('estrae entrambi gli intestatari, strutturati', () => {
    const r = parseLibrettoText(LEASE, 0.9);
    expect(r.proprietari).toEqual(['ACME LEASING SPA', 'ROSSI MARIO']);
    expect(r.proprietariInfo).toEqual([
      { isPersonaGiuridica: true, ragioneSociale: 'ACME LEASING SPA', piva: '08349560014', display: 'ACME LEASING SPA' },
      { isPersonaGiuridica: false, cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA80A01F205X', display: 'ROSSI MARIO' },
    ]);
  });
});

describe('parseLibrettoText — pre-2015 da (I)', () => {
  it('(I) anteriore al 2015 → preImm2015 true', () => {
    const txt = '(B) 20.06.2009\n(C.2.1) BIANCHI\n(C.2.2) LUCA\n(A) FA123GH\n(1) 10.03.2010';
    const r = parseLibrettoText(txt, 0.9);
    expect(r.dataAcquisto).toBe('2010-03-10');
    expect(r.preImm2015).toBe(true);
  });
  it('senza (I): fallback alla prima immatricolazione', () => {
    const r = parseLibrettoText('(B) 12.03.2012\n(A) AB123CD', 0.9);
    expect(r.dataAcquisto).toBeUndefined();
    expect(r.preImm2015).toBe(true); // (B) 2012 < 2015
  });
});

describe('parseLibrettoText — robustezza', () => {
  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseLibrettoText('TESTO SENZA DATI', 0.5);
    expect(r.targa).toBeUndefined();
    expect(r.telaio).toBeUndefined();
    expect(r.proprietarioAttuale).toBeUndefined();
    expect(r.preImm2015).toBe(false);
  });
  it('rileva comodato in varie formulazioni', () => {
    expect(parseLibrettoText("... COMODATO D'USO ...", 0.9).flagComodatoDuso).toBe(true);
    expect(parseLibrettoText('... locazione/comodato ...', 0.9).flagComodatoDuso).toBe(true);
  });
  it('non segnala comodato se assente', () => {
    expect(parseLibrettoText('CARTA DI CIRCOLAZIONE (A) AB123CD', 0.9).flagComodatoDuso).toBe(false);
  });
});
