import { describe, it, expect } from 'vitest';
import { parseContactsCsv, parseCsvLine, detectDelimiter } from './csv-import';

// Header reale dei file scraping rivenditori (es. "313 riv TRENTINO ALTO ADIGE.csv"):
// quotato, capitalizzato, accentato, colonne diverse, niente `cat`.
const REAL_CSV = [
  '"Nome","Indirizzo","Città","Provincia","CAP","Telefono","Email","Network","Regione"',
  '"Auto-Center Trento","Via Bolzano, 12/E","Trento","TN","38121","+39 0461 993490","","","TRENTINO ALTO ADIGE"',
  '"Bosetti Auto","Via Alto Adige, 216","Trento","TN","38121","+39 0461 825777","info@bosetti.it","","TRENTINO ALTO ADIGE"',
].join('\n');

// Formato EFFETTIVO dei file scaricati: separatore `;` (default Excel italiano),
// campi NON quotati, con virgole DENTRO i campi (es. "Via Bolzano, 12/E").
const REAL_CSV_SEMICOLON = [
  'Nome;Indirizzo;Città;Provincia;CAP;Telefono;Email;Network;Regione',
  'Auto-Center Trento;Via Bolzano, 12/E;Trento;TN;38121;+39 0461 993490;;;TRENTINO ALTO ADIGE',
  'Bosetti Auto;Via Alto Adige, 216;Trento;TN;38121;+39 0461 825777;info@bosetti.it;;TRENTINO ALTO ADIGE',
].join('\r\n');

describe('parseContactsCsv — file reale (header quotato/italiano/senza cat)', () => {
  it('riconosce nome/telefono/città nonostante virgolette, accenti e nomi alias', () => {
    const r = parseContactsCsv(REAL_CSV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    const a = r.rows[0]!;
    expect(a.nome).toBe('Auto-Center Trento');
    expect(a.tel).toBe('+39 0461 993490');
    expect(a.citta).toBe('Trento');
    expect(a.cap).toBe('38121');
    expect(a.regione).toBe('TRENTINO ALTO ADIGE');
    expect(a.indirizzo).toBe('Via Bolzano, 12/E'); // virgola interna preservata
    expect(a.email).toBeNull(); // cella vuota → null
  });

  it('categoria default BROKER quando manca la colonna cat', () => {
    const r = parseContactsCsv(REAL_CSV);
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows[0]!.cat).toBe('BROKER');
  });

  it('rispetta defaultCat=AGENZIA', () => {
    const r = parseContactsCsv(REAL_CSV, 'AGENZIA');
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows[0]!.cat).toBe('AGENZIA');
  });

  it('normalizza email a minuscolo', () => {
    const r = parseContactsCsv(REAL_CSV);
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows[1]!.email).toBe('info@bosetti.it');
  });
});

describe('parseContactsCsv — separatore punto e virgola (Excel IT, campi non quotati)', () => {
  it('rileva il `;` come delimitatore e mappa le colonne', () => {
    const r = parseContactsCsv(REAL_CSV_SEMICOLON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    const a = r.rows[0]!;
    expect(a.nome).toBe('Auto-Center Trento');
    expect(a.tel).toBe('+39 0461 993490');
    expect(a.citta).toBe('Trento');
    expect(a.cap).toBe('38121');
    expect(a.regione).toBe('TRENTINO ALTO ADIGE');
    // virgola interna al campo NON quotato deve restare nel valore
    expect(a.indirizzo).toBe('Via Bolzano, 12/E');
    expect(a.email).toBeNull();
  });

  it('seconda riga: email valorizzata e minuscola', () => {
    const r = parseContactsCsv(REAL_CSV_SEMICOLON);
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows[1]!.email).toBe('info@bosetti.it');
  });
});

describe('detectDelimiter', () => {
  it('rileva `;` su header Excel italiano', () => {
    expect(detectDelimiter('Nome;Indirizzo;Telefono')).toBe(';');
  });
  it('rileva `,` su header quotato a virgole', () => {
    expect(detectDelimiter('"Nome","Indirizzo","Telefono"')).toBe(',');
  });
  it('rileva tab su header TSV', () => {
    expect(detectDelimiter('Nome\tIndirizzo\tTelefono')).toBe('\t');
  });
  it('default `,` su singola colonna senza delimitatori', () => {
    expect(detectDelimiter('Nome')).toBe(',');
  });
});

describe('parseContactsCsv — formato legacy PV', () => {
  it('continua a funzionare con header lowercase nome,cat,tel,...', () => {
    const csv = 'nome,cat,tel,email,citta\nMario Rossi,AGENZIA,06123,M@X.IT,Roma';
    const r = parseContactsCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]!.cat).toBe('AGENZIA');
    expect(r.rows[0]!.email).toBe('m@x.it');
    expect(r.rows[0]!.citta).toBe('Roma');
  });

  it('mappa valori cat sinonimi (rivenditore → BROKER)', () => {
    const csv = 'nome,tipo,tel\nGarage X,rivenditore,333';
    const r = parseContactsCsv(csv, 'AGENZIA');
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows[0]!.cat).toBe('BROKER');
  });
});

describe('parseContactsCsv — robustezza', () => {
  it('header senza colonna nome → errore esplicito', () => {
    const r = parseContactsCsv('foo,bar\n1,2');
    expect(r.ok).toBe(false);
  });

  it('riga senza telefono → saltata con rowError', () => {
    const csv = '"Nome","Telefono"\n"Mario",""\n"Luigi","333"';
    const r = parseContactsCsv(csv);
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.nome).toBe('Luigi');
    expect(r.rowErrors).toHaveLength(1);
  });

  it('strippa il BOM iniziale', () => {
    const csv = '﻿"Nome","Telefono"\n"Mario","333"';
    const r = parseContactsCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]!.nome).toBe('Mario');
  });
});

describe('parseContactsCsv — S11 non importabile da CSV', () => {
  it('una riga con Stato=S11 degrada a S0 (niente giorno di richiamo nel file)', () => {
    const csv = 'Nome,Telefono,Stato\nMario Rossi,333123456,S11';
    const r = parseContactsCsv(csv);
    if (!r.ok) throw new Error('parse fallito');
    expect(r.rows[0]!.status).toBe('S0');
  });
});

describe('parseCsvLine', () => {
  it('gestisce virgole interne alle virgolette', () => {
    expect(parseCsvLine('"a, b","c"')).toEqual(['a, b', 'c']);
  });
  it('gestisce virgolette escapate ("")', () => {
    expect(parseCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', 'x']);
  });
});
