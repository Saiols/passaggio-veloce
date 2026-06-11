import { describe, it, expect } from 'vitest';
import { parseVisuraText } from './visura-parser';

// Fixture realistico nel formato InfoCamere/CCIAA (estratto e ridotto da una
// visura ordinaria reale: testo unpdf su una sola riga, dual ATECO 2025/2007,
// sezione amministratori con nome e CF separati).
const SAMPLE = [
  'viene esposto un estratto delle informazioni presenti in visura che non puo essere considerato esaustivo',
  "VISURA ORDINARIA SOCIETA' DI CAPITALE DIMENSIONE AUTO MILANO SRLS",
  'Partita IVA 13180640966 Forma giuridica societa a responsabilita limitata semplificata',
  'Data atto di costituzione 11/10/2023 Data iscrizione 18/10/2023',
  'Amministratore Unico SAINO ANDREA Rappresentante dell Impresa',
  'Codice ATECO 47.81.10 Codice NACE 2.1 47.81',
  'Documento n . A AW2F39FDQ81DF2015EEB estratto dal Registro Imprese in data 02/03/2026',
  'informazioni costitutive Denominazione: DIMENSIONE AUTO MILANO SRLS Data atto di costituzione: 11/10/2023',
  '5 Amministratori Amministratore Unico SAINO ANDREA Rappresentante dell impresa',
  'Elenco amministratori Amministratore Unico SAINO ANDREA Rappresentante dell impresa Nato a MILANO (MI) il 23/04/1996 Codice fiscale: SNANDR96D23F205Z domicilio CORSICO (MI)',
  'Classificazione ATECO 2025 Codice: 47.81.10 - commercio al dettaglio di automobili e autoveicoli leggeri',
  'Classificazione ATECORI 2007-2022 Codice: 45.11.01 - commercio all ingrosso e al dettaglio di autovetture',
].join(' ');

describe('parseVisuraText (formato InfoCamere reale)', () => {
  it('estrae denominazione, P.IVA, amministratore (nome+cognome+CF)', () => {
    const r = parseVisuraText(SAMPLE);
    expect(r.denominazione).toContain('DIMENSIONE AUTO MILANO');
    expect(r.partitaIva).toBe('13180640966');
    expect(r.amministratore?.cognome).toBe('SAINO');
    expect(r.amministratore?.nome).toBe('ANDREA');
    expect(r.amministratore?.codiceFiscale).toBe('SNANDR96D23F205Z');
  });

  it('raccoglie TUTTI i codici ATECO (2025 + ATECORI 2007)', () => {
    const r = parseVisuraText(SAMPLE);
    expect(r.atecoCodes).toContain('47.81.10');
    expect(r.atecoCodes).toContain('45.11.01');
  });

  it('estrae la data dalla frase ufficiale, non dal disclaimer/costituzione', () => {
    const r = parseVisuraText(SAMPLE);
    // 02/03/2026 (estratto dal Registro Imprese), NON 11/10/2023 (costituzione)
    expect(r.dataEmissione).toBe('2026-03-02');
  });

  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseVisuraText('testo vuoto');
    expect(r.partitaIva).toBeUndefined();
    expect(r.dataEmissione).toBeUndefined();
    expect(r.amministratore).toBeUndefined();
    expect(r.rawText).toBe('testo vuoto');
  });
});

// Fixture realistico per IMPRESA INDIVIDUALE (estratto e ridotto dalla visura
// reale "AGENZIA CORSICO"): qui non c'è la sezione "Amministratori" ma "Titolari
// di cariche o qualifiche" con il "Titolare Firmatario" (COGNOME NOME), e il CF
// del titolare coincide col CF dell'impresa.
const IMPRESA_INDIVIDUALE = [
  'viene esposto un estratto delle informazioni presenti in visura che non puo essere considerato esaustivo',
  "VISURA ORDINARIA DELL'IMPRESA AGENZIA CORSICO PRATICHE AUTOMOBILISTICHE E AMMINISTRATIVE DI CIAVARELLA ANTONIO",
  'DATI ANAGRAFICI Codice fiscale e n.iscr. al Registro Imprese CVRNTN59R31D643G Partita IVA 06199680155',
  'Forma giuridica impresa individuale Data iscrizione 16/02/1983',
  'Titolare di impresa individuale CIAVARELLA ANTONIO ATTIVITA Stato attivita attiva',
  'Codice ATECO 82.99.4 Codice NACE 82.99',
  'Documento n . T 585392977 estratto dal Registro Imprese in data 13/12/2024',
  'informazioni costitutive Denominazione: AGENZIA CORSICO PRATICHE AUTOMOBILISTICHE E AMMINISTRATIVE DI CIAVARELLA ANTONIO Data fondazione: 05/06/1981',
  '3 Titolari di cariche o qualifiche Titolare Firmatario CIAVARELLA ANTONIO Registro Imprese Archivio ufficiale della CCIAA',
  'AGENZIA CORSICO PRATICHE AUTOMOBILISTICHE E AMMINISTRATIVE DI CIAVARELLA ANTONIO Codice Fiscale CVRNTN59R31D643G',
  'Titolare Firmatario CIAVARELLA ANTONIO Nato a FOGGIA (FG) il 31/10/1959 Codice fiscale: CVRNTN59R31D643G residenza BUCCINASCO (MI) VIA ANDREA SOLARI 1 CAP 20090 carica titolare firmatario',
  'Classificazione ATECORI 2007-2022 Codice: 45.11.01 - commercio all ingrosso e al dettaglio di autovetture',
].join(' ');

describe('parseVisuraText (impresa individuale: titolare al posto dell\'amministratore)', () => {
  it('estrae il titolare (nome+cognome+CF) dalla sezione "Titolari di cariche"', () => {
    const r = parseVisuraText(IMPRESA_INDIVIDUALE);
    expect(r.amministratore?.cognome).toBe('CIAVARELLA');
    expect(r.amministratore?.nome).toBe('ANTONIO');
    expect(r.amministratore?.codiceFiscale).toBe('CVRNTN59R31D643G');
  });

  it('estrae P.IVA, data emissione e ATECO anche per l\'impresa individuale', () => {
    const r = parseVisuraText(IMPRESA_INDIVIDUALE);
    expect(r.partitaIva).toBe('06199680155');
    expect(r.dataEmissione).toBe('2024-12-13');
    expect(r.atecoCodes).toContain('82.99.4');
    expect(r.atecoCodes).toContain('45.11.01');
  });
});
