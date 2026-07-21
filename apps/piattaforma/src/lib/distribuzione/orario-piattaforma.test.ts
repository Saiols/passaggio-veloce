import { describe, it, expect } from 'vitest';
import { isOrarioLavorativo } from './orario-piattaforma';
import { DISTRIBUZIONE_DEFAULT, type DistribuzioneConfigDTO } from './config';

// DISTRIBUZIONE_DEFAULT: LUN-VEN, 09:00-19:00.
const CFG = DISTRIBUZIONE_DEFAULT;

// Tutte le date sono costruite come istanti UTC fissi (mai Date.now()/orologio del
// runner) e scelte in luglio (Europe/Rome = CEST, UTC+2) così l'ora "di parete" a
// Roma è UTC+2h. Verificate a monte con Intl.DateTimeFormat({timeZone:'Europe/Rome'}):
// 2026-07-22 è un mercoledì, 2026-07-25 un sabato.
function utc(h: number, m: number, day = 22): Date {
  return new Date(Date.UTC(2026, 6, day, h, m, 0));
}

describe('isOrarioLavorativo', () => {
  it('mercoledì 10:00 (Rome) con LUN-VEN 9-19 → true', () => {
    expect(isOrarioLavorativo(utc(8, 0), CFG)).toBe(true); // 08:00 UTC = 10:00 Rome
  });

  it('mercoledì 20:00 (Rome) → false (fuori finestra)', () => {
    expect(isOrarioLavorativo(utc(18, 0), CFG)).toBe(false); // 18:00 UTC = 20:00 Rome
  });

  it('mercoledì 08:59 (Rome) → false (prima di orarioInizio)', () => {
    expect(isOrarioLavorativo(utc(6, 59), CFG)).toBe(false); // 06:59 UTC = 08:59 Rome
  });

  it('sabato 10:00 (Rome), giorni default LUN-VEN → false', () => {
    expect(isOrarioLavorativo(utc(8, 0, 25), CFG)).toBe(false); // 2026-07-25 = sabato
  });

  it('bordo 09:00 (Rome) → true (orarioInizio incluso)', () => {
    expect(isOrarioLavorativo(utc(7, 0), CFG)).toBe(true); // 07:00 UTC = 09:00 Rome
  });

  it('bordo 19:00 (Rome) → false (orarioFine escluso)', () => {
    expect(isOrarioLavorativo(utc(17, 0), CFG)).toBe(false); // 17:00 UTC = 19:00 Rome
  });

  it('sabato 10:00 (Rome), config con SAB incluso → true', () => {
    const cfgConSabato: DistribuzioneConfigDTO = { ...CFG, giorni: [...CFG.giorni, 'SAB'] };
    expect(isOrarioLavorativo(utc(8, 0, 25), cfgConSabato)).toBe(true);
  });

  it('fuso orario: un istante UTC "naive fuori orario" ma dentro la finestra a Roma → true', () => {
    // 07:30 UTC: getHours() server-local (se il processo gira in UTC, come su Vercel)
    // leggerebbe le 7:30, FUORI dalla finestra 9-19 se calcolato ingenuamente.
    // In Europe/Rome (CEST, +2h) sono le 09:30: DENTRO la finestra.
    const naiveUtcHour = utc(7, 30).getUTCHours();
    expect(naiveUtcHour).toBeLessThan(9); // conferma che il "naive" fallirebbe
    expect(isOrarioLavorativo(utc(7, 30), CFG)).toBe(true);
  });
});
