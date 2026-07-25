import { describe, it, expect } from 'vitest';
import {
  CALENDARIO_DEFAULT,
  ORARI_SETTIMANA_DEFAULT,
  hhmmToMinuti,
  isHHMM,
  parseFestivi,
  parseOrariSettimana,
} from './calendario';

describe('isHHMM', () => {
  it('accetta 09:00 e 23:59', () => {
    expect(isHHMM('09:00')).toBe(true);
    expect(isHHMM('23:59')).toBe(true);
  });

  it('rifiuta ore o minuti fuori range e formati sbagliati', () => {
    expect(isHHMM('24:00')).toBe(false);
    expect(isHHMM('09:60')).toBe(false);
    expect(isHHMM('9:00')).toBe(false); // ore sempre a due cifre
    expect(isHHMM('0900')).toBe(false);
    expect(isHHMM(900)).toBe(false);
    expect(isHHMM(null)).toBe(false);
  });
});

describe('hhmmToMinuti', () => {
  it('converte in minuti dalla mezzanotte', () => {
    expect(hhmmToMinuti('00:00')).toBe(0);
    expect(hhmmToMinuti('09:30')).toBe(570);
    expect(hhmmToMinuti('19:00')).toBe(1140);
  });
});

describe('parseOrariSettimana', () => {
  it('null → default completi (fail-open)', () => {
    expect(parseOrariSettimana(null)).toEqual(ORARI_SETTIMANA_DEFAULT);
  });

  it('valore non-oggetto → default completi', () => {
    expect(parseOrariSettimana('9-19')).toEqual(ORARI_SETTIMANA_DEFAULT);
    expect(parseOrariSettimana([])).toEqual(ORARI_SETTIMANA_DEFAULT);
  });

  it('legge le fasce valide', () => {
    const out = parseOrariSettimana({
      LUN: { attivo: true, inizio: '08:00', fine: '20:00' },
      SAB: { attivo: true, inizio: '09:00', fine: '13:00' },
    });
    expect(out.LUN).toEqual({ attivo: true, inizio: '08:00', fine: '20:00' });
    expect(out.SAB).toEqual({ attivo: true, inizio: '09:00', fine: '13:00' });
  });

  it('giorno assente → default DI QUEL giorno, gli altri restano validi', () => {
    const out = parseOrariSettimana({ LUN: { attivo: false, inizio: '10:00', fine: '12:00' } });
    expect(out.LUN).toEqual({ attivo: false, inizio: '10:00', fine: '12:00' });
    expect(out.MAR).toEqual(ORARI_SETTIMANA_DEFAULT.MAR);
  });

  it('fascia malformata → default di quel giorno, NON "chiuso"', () => {
    // Interpretare un JSON storto come chiusura fermerebbe la distribuzione:
    // il fail-open del modulo config vale anche qui.
    const out = parseOrariSettimana({
      LUN: { attivo: true, inizio: '25:00', fine: '19:00' },
      MAR: { attivo: 'si', inizio: '09:00', fine: '19:00' },
      MER: 'aperto',
    });
    expect(out.LUN).toEqual(ORARI_SETTIMANA_DEFAULT.LUN);
    expect(out.MAR).toEqual(ORARI_SETTIMANA_DEFAULT.MAR);
    expect(out.MER).toEqual(ORARI_SETTIMANA_DEFAULT.MER);
  });

  it('fine <= inizio → default di quel giorno', () => {
    const out = parseOrariSettimana({ LUN: { attivo: true, inizio: '19:00', fine: '09:00' } });
    expect(out.LUN).toEqual(ORARI_SETTIMANA_DEFAULT.LUN);
  });
});

describe('parseFestivi', () => {
  it('null o non-array → lista vuota', () => {
    expect(parseFestivi(null)).toEqual([]);
    expect(parseFestivi({ data: '2026-12-25' })).toEqual([]);
  });

  it('scarta le date impossibili senza invalidare le altre', () => {
    const out = parseFestivi([
      { data: '2026-02-30', nome: 'Inesistente' },
      { data: '2026-12-25', nome: 'Natale' },
      { data: 'domani', nome: 'Boh' },
      { nome: 'Senza data' },
    ]);
    expect(out).toEqual([{ data: '2026-12-25', nome: 'Natale' }]);
  });

  it('ordina per data e deduplica tenendo la prima occorrenza', () => {
    const out = parseFestivi([
      { data: '2026-12-25', nome: 'Natale' },
      { data: '2026-08-15', nome: 'Ferragosto' },
      { data: '2026-12-25', nome: 'Duplicato' },
    ]);
    expect(out).toEqual([
      { data: '2026-08-15', nome: 'Ferragosto' },
      { data: '2026-12-25', nome: 'Natale' },
    ]);
  });

  it('nome mancante o vuoto → etichetta di ripiego, mai scarto della data', () => {
    expect(parseFestivi([{ data: '2026-12-25', nome: '   ' }])).toEqual([
      { data: '2026-12-25', nome: 'Festivo' },
    ]);
    expect(parseFestivi([{ data: '2026-12-25' }])).toEqual([
      { data: '2026-12-25', nome: 'Festivo' },
    ]);
  });

  it('tronca i nomi lunghissimi a 60 caratteri', () => {
    const out = parseFestivi([{ data: '2026-12-25', nome: 'x'.repeat(200) }]);
    expect(out[0]!.nome).toHaveLength(60);
  });
});

describe('CALENDARIO_DEFAULT', () => {
  it('LUN-VEN attivi, weekend spento — la configurazione oggi in produzione', () => {
    expect(CALENDARIO_DEFAULT.orariSettimana.LUN.attivo).toBe(true);
    expect(CALENDARIO_DEFAULT.orariSettimana.VEN.attivo).toBe(true);
    expect(CALENDARIO_DEFAULT.orariSettimana.SAB.attivo).toBe(false);
    expect(CALENDARIO_DEFAULT.orariSettimana.DOM.attivo).toBe(false);
    expect(CALENDARIO_DEFAULT.festivi).toEqual([]);
  });
});
