import { describe, it, expect } from 'vitest';
import { isOrarioLavorativo, minutiLavorativiTra } from './orario-piattaforma';
import { CALENDARIO_DEFAULT, type CalendarioPiattaforma } from './calendario';

// Istanti UTC fissi (mai l'orologio del runner), scelti in luglio: a Roma è
// CEST (UTC+2), quindi l'ora di parete è UTC+2h. Weekday verificati con
// Intl: 2026-07-22 mercoledì, 24 venerdì, 25 sabato, 26 domenica.
function utc(h: number, m: number, day = 22): Date {
  return new Date(Date.UTC(2026, 6, day, h, m, 0));
}

const CAL = CALENDARIO_DEFAULT;

describe('isOrarioLavorativo', () => {
  it('mercoledì 10:00 (Rome) → true', () => {
    expect(isOrarioLavorativo(utc(8, 0), CAL)).toBe(true);
  });

  it('mercoledì 20:00 (Rome) → false (dopo la fine)', () => {
    expect(isOrarioLavorativo(utc(18, 0), CAL)).toBe(false);
  });

  it('bordo 09:00 incluso, bordo 19:00 escluso', () => {
    expect(isOrarioLavorativo(utc(7, 0), CAL)).toBe(true);
    expect(isOrarioLavorativo(utc(17, 0), CAL)).toBe(false);
  });

  it('sabato e domenica spenti nei default → false', () => {
    expect(isOrarioLavorativo(utc(8, 0, 25), CAL)).toBe(false);
    expect(isOrarioLavorativo(utc(8, 0, 26), CAL)).toBe(false);
  });

  it('sabato corto: attivo 09:00-13:00 → true alle 10:00, false alle 14:00', () => {
    const cal: CalendarioPiattaforma = {
      ...CAL,
      orariSettimana: {
        ...CAL.orariSettimana,
        SAB: { attivo: true, inizio: '09:00', fine: '13:00' },
      },
    };
    expect(isOrarioLavorativo(utc(8, 0, 25), cal)).toBe(true); // 10:00 Rome
    expect(isOrarioLavorativo(utc(12, 0, 25), cal)).toBe(false); // 14:00 Rome
  });

  it('un festivo spegne un giorno altrimenti attivo', () => {
    const cal: CalendarioPiattaforma = {
      ...CAL,
      festivi: [{ data: '2026-07-22', nome: 'Test' }],
    };
    expect(isOrarioLavorativo(utc(8, 0), CAL)).toBe(true);
    expect(isOrarioLavorativo(utc(8, 0), cal)).toBe(false);
  });

  it('il festivo si valuta sul GIORNO DI ROMA, non su quello UTC', () => {
    // 2026-07-22T22:30Z = 23 luglio 00:30 a Roma: se il festivo è il 23, il
    // gate deve essere chiuso anche se in UTC è ancora il 22.
    const cal: CalendarioPiattaforma = {
      ...CAL,
      festivi: [{ data: '2026-07-23', nome: 'Test' }],
      orariSettimana: {
        ...CAL.orariSettimana,
        GIO: { attivo: true, inizio: '00:00', fine: '23:59' },
      },
    };
    expect(isOrarioLavorativo(new Date(Date.UTC(2026, 6, 22, 22, 30)), cal)).toBe(false);
  });

  it('fuso: 07:30 UTC è dentro la finestra perché a Roma sono le 09:30', () => {
    expect(utc(7, 30).getUTCHours()).toBeLessThan(9); // il calcolo naive fallirebbe
    expect(isOrarioLavorativo(utc(7, 30), CAL)).toBe(true);
  });
});

// Luglio 2026, Roma = CEST (UTC+2). Finestra default 09:00-19:00 = 07:00-17:00 UTC.
// Weekday: 22 mer, 23 gio, 24 ven, 25 sab, 26 dom, 27 lun.
const U = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 6, day, h, m));

describe('minutiLavorativiTra', () => {
  it('stessa giornata, tutto dentro la finestra', () => {
    // 10:00 → 11:30 ora di Roma.
    expect(minutiLavorativiTra(U(22, 8), U(22, 9, 30), CAL, 10_000)).toBe(90);
  });

  it('ritaglia le code fuori finestra', () => {
    // 06:00 → 21:00 Roma: contano solo le 10 ore di apertura.
    expect(minutiLavorativiTra(U(22, 4), U(22, 19), CAL, 10_000)).toBe(600);
  });

  it('attraversa la notte: 18:00 → 09:30 del giorno dopo = 60 + 30', () => {
    expect(minutiLavorativiTra(U(22, 16), U(23, 7, 30), CAL, 10_000)).toBe(90);
  });

  it('attraversa il weekend: venerdì 18:00 → lunedì 09:30 = 60 + 30', () => {
    expect(minutiLavorativiTra(U(24, 16), U(27, 7, 30), CAL, 10_000)).toBe(90);
  });

  it('un festivo vale zero minuti', () => {
    const cal: CalendarioPiattaforma = {
      ...CAL,
      festivi: [{ data: '2026-07-23', nome: 'Test' }],
    };
    // Mercoledì 18:00 → giovedì 18:00. Senza festivo: 60 (mer) + 540 (gio 9-18).
    expect(minutiLavorativiTra(U(22, 16), U(23, 16), CAL, 10_000)).toBe(600);
    // Con giovedì festivo resta solo l'ora del mercoledì.
    expect(minutiLavorativiTra(U(22, 16), U(23, 16), cal, 10_000)).toBe(60);
  });

  it('intervallo interamente fuori finestra → 0', () => {
    // Sabato: giorno spento.
    expect(minutiLavorativiTra(U(25, 8), U(25, 12), CAL, 10_000)).toBe(0);
  });

  it('a <= da → 0', () => {
    expect(minutiLavorativiTra(U(22, 9), U(22, 8), CAL, 10_000)).toBe(0);
    expect(minutiLavorativiTra(U(22, 9), U(22, 9), CAL, 10_000)).toBe(0);
  });

  it('early-exit sul cap: si ferma al primo giorno che lo supera', () => {
    // Da mercoledì 09:00 Rome a cinque anni dopo. Senza early-exit il totale
    // sarebbe di centinaia di migliaia di minuti; con il cap la funzione si
    // ferma alla fine della PRIMA giornata utile: 09:00-19:00 = 600.
    const lontano = new Date(Date.UTC(2031, 6, 22, 7));
    expect(minutiLavorativiTra(U(22, 7), lontano, CAL, 60)).toBe(600);
  });

  it('calendario tutto spento su un intervallo enorme → 0 e termina', () => {
    // Nessun early-exit possibile: è la guardia sul numero di giorni a fermare
    // la scansione. Il test fallirebbe per timeout se la guardia mancasse.
    const spento: CalendarioPiattaforma = {
      festivi: [],
      orariSettimana: Object.fromEntries(
        (['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'] as const).map((g) => [
          g,
          { attivo: false, inizio: '09:00', fine: '19:00' },
        ]),
      ) as CalendarioPiattaforma['orariSettimana'],
    };
    expect(minutiLavorativiTra(new Date(Date.UTC(2020, 0, 1)), U(22, 8), spento, 60)).toBe(0);
  });

  it('DST: la finestra resta di 10 ore anche nel giorno del cambio', () => {
    // Lunedì 30 marzo 2026, primo giorno di ora legale (CEST, +2).
    const da = new Date(Date.UTC(2026, 2, 30, 7)); // 09:00 Rome
    const a = new Date(Date.UTC(2026, 2, 30, 17)); // 19:00 Rome
    expect(minutiLavorativiTra(da, a, CAL, 10_000)).toBe(600);
  });
});
