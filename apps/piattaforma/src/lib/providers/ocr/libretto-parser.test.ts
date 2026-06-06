import { describe, it, expect } from 'vitest';
import { parseLibrettoText } from './libretto-parser';

const SAMPLE = `CARTA DI CIRCOLAZIONE
A) FA123GH
E) ZFA19500005123456
B) 12.03.2012
C1.1) ROSSI MARIO`;

describe('parseLibrettoText', () => {
  it('estrae targa, telaio, data e proprietario', () => {
    const r = parseLibrettoText(SAMPLE, 0.9);
    expect(r.targa).toBe('FA123GH');
    expect(r.telaio).toBe('ZFA19500005123456');
    expect(r.dataImmatricolazione).toBe('2012-03-12');
    expect(r.preImm2015).toBe(true);
    expect(r.confidenceScore).toBe(0.9);
  });
  it('flag comodato se presente la parola COMODATO', () => {
    const r = parseLibrettoText(SAMPLE + '\nCOMODATO D USO', 0.8);
    expect(r.flagComodatoDuso).toBe(true);
  });
  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseLibrettoText('TESTO SENZA DATI', 0.5);
    expect(r.targa).toBeUndefined();
    expect(r.telaio).toBeUndefined();
    expect(r.preImm2015).toBe(false);
  });
  it('rileva comodato in varie formulazioni', () => {
    expect(parseLibrettoText("... COMODATO D'USO ...", 0.9).flagComodatoDuso).toBe(true);
    expect(parseLibrettoText('... locazione/comodato ...', 0.9).flagComodatoDuso).toBe(true);
    expect(parseLibrettoText('... CONTRATTO DI COMODATO ...', 0.9).flagComodatoDuso).toBe(true);
  });
  it('non segnala comodato se assente', () => {
    expect(parseLibrettoText('CARTA DI CIRCOLAZIONE targa AB123CD', 0.9).flagComodatoDuso).toBe(false);
  });
});
