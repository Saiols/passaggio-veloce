import { describe, it, expect } from 'vitest';
import { parseVisuraText } from './visura-parser';

const SAMPLE = `REGISTRO IMPRESE
Denominazione: ROSSI AUTO S.R.L.
Codice fiscale e Partita IVA: 12345678901
Codice ATECO: 45.11.01 Commercio di autovetture
AMMINISTRATORE UNICO
ROSSI MARIO - C.F. RSSMRA80A01H501U
Il presente documento è stato estratto in data 15/03/2026`;

describe('parseVisuraText', () => {
  it('estrae denominazione, P.IVA, ATECO, data emissione e amministratore', () => {
    const r = parseVisuraText(SAMPLE);
    expect(r.denominazione).toContain('ROSSI AUTO');
    expect(r.partitaIva).toBe('12345678901');
    expect(r.ateco).toBe('45.11.01');
    expect(r.dataEmissione).toBe('2026-03-15');
    expect(r.amministratore?.codiceFiscale).toBe('RSSMRA80A01H501U');
    expect(r.amministratore?.cognome).toBe('ROSSI');
    expect(r.amministratore?.nome).toBe('MARIO');
  });
  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseVisuraText('testo vuoto');
    expect(r.partitaIva).toBeUndefined();
    expect(r.dataEmissione).toBeUndefined();
    expect(r.rawText).toBe('testo vuoto');
  });
});
