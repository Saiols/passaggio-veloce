import { describe, it, expect } from 'vitest';
import { isOrarioLavorativo } from './orario-piattaforma';
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
