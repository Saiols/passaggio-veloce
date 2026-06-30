import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// Fixture realistico per AMMINISTRATRICE DONNA (estratto e ridotto dalla visura
// reale "PLANET AUTO S.R.L."): la carica è al FEMMINILE ("Amministratrice Unica"),
// perché l'amministratore è una donna. Il nome resta COGNOME NOME maiuscolo e il
// CF è presente. Regressione: il parser deve leggere nome+cognome anche al femminile.
const AMMINISTRATRICE_DONNA = [
  'viene esposto un estratto delle informazioni presenti in visura che non puo essere considerato esaustivo',
  "VISURA ORDINARIA SOCIETA' DI CAPITALE PLANET AUTO S.R.L.",
  'Indirizzo Sedelegale MAGENTA (MI) VIA A. VOLTA 10 CAP 20013',
  'Codice fiscale e n.iscr. al Registro Imprese 13880060960 Partita IVA 13880060960',
  'Amministratrice Unica SOLIANI LUIGIA Rappresentante dell Impresa',
  'Codice ATECO 46.71.10 Codice NACE 2.1 46.71',
  'Documento n . T 613996775 estratto dal Registro Imprese in data 30/05/2026',
  'informazioni costitutive Denominazione: PLANET AUTO S.R.L. Data atto di costituzione: 04/12/2024',
  '5 Amministratori Amministratrice Unica SOLIANI LUIGIA Rappresentante dell impresa',
  'Organi amministrativi in carica amministratore unico Numero componenti: 1',
  'Elenco amministratori Amministratrice Unica SOLIANI LUIGIA Rappresentante dell impresa Nata a SUZZARA (MN) il 04/07/1957 Codice fiscale: SLNLGU57L44L020L domicilio SANTO STEFANO TICINO (MI) VIA TRIESTE 21/C CAP 20010 carica amministratrice unica',
  'Classificazione ATECO 2025 Codice: 46.71.10 - commercio all ingrosso di automobili e autoveicoli leggeri',
].join(' ');

describe('parseVisuraText (amministratrice donna: carica al femminile)', () => {
  it('estrae nome+cognome+CF con carica "Amministratrice Unica"', () => {
    const r = parseVisuraText(AMMINISTRATRICE_DONNA);
    expect(r.amministratore?.cognome).toBe('SOLIANI');
    expect(r.amministratore?.nome).toBe('LUIGIA');
    expect(r.amministratore?.codiceFiscale).toBe('SLNLGU57L44L020L');
  });

  it('gestisce le altre cariche al femminile (Delegata / Consigliera / Socia / Liquidatrice)', () => {
    const cariche = [
      ['Amministratrice Delegata', 'BIANCHI', 'MARIA', 'BNCMRA80A41F205K'],
      ['Consigliera Delegata', 'VERDI', 'ANNA', 'VRDNNA75T50F205Q'],
      ['Socia Amministratrice', 'NERI', 'GIULIA', 'NREGLI82E45F205X'],
      ['Liquidatrice', 'GALLI', 'SARA', 'GLLSRA79H62F205T'],
    ] as const;
    for (const [carica, cognome, nome, cf] of cariche) {
      const text = `Elenco amministratori ${carica} ${cognome} ${nome} Rappresentante dell impresa Nata a MILANO (MI) Codice fiscale: ${cf} domicilio MILANO`;
      const r = parseVisuraText(text);
      expect(r.amministratore?.cognome).toBe(cognome);
      expect(r.amministratore?.nome).toBe(nome);
      expect(r.amministratore?.codiceFiscale).toBe(cf);
    }
  });
});

// REGRESSIONE su CORPUS REALE: testo esatto prodotto da unpdf sulla visura reale
// "PLANET AUTO S.R.L." (amministratrice donna SOLIANI LUIGIA). A differenza dei
// fixture sintetici sopra — dove carica/nome/CF sono adiacenti — qui i token sono
// nell'ordine REALE di unpdf (layout a due colonne): la carica è staccata dal nome
// e il CF dell'amministratrice PRECEDE la sezione "Amministratori". Era il caso che
// mandava in errore la registrazione in produzione ("Non siamo riusciti a leggere
// completamente l'amministratore nella visura"). Il file è il dump verbatim di unpdf.
const REAL_PLANET_AUTO = readFileSync(
  fileURLToPath(new URL('./__fixtures__/visura-planet-auto.unpdf.txt', import.meta.url)),
  'utf8',
);

describe('parseVisuraText (corpus reale unpdf: PLANET AUTO, ordine token non visivo)', () => {
  it('estrae l\'amministratrice (nome+cognome+CF) nonostante token scollegati', () => {
    const r = parseVisuraText(REAL_PLANET_AUTO);
    expect(r.amministratore?.cognome).toBe('SOLIANI');
    expect(r.amministratore?.nome).toBe('LUIGIA');
    expect(r.amministratore?.codiceFiscale).toBe('SLNLGU57L44L020L');
  });

  it('estrae anche P.IVA, data emissione e ATECO (gate "leggibile" superato)', () => {
    const r = parseVisuraText(REAL_PLANET_AUTO);
    expect(r.partitaIva).toBe('13880060960');
    expect(r.dataEmissione).toBe('2026-05-30');
    expect(r.atecoCodes).toContain('46.71.10');
    expect(r.denominazione).toContain('PLANET AUTO');
  });
});
