import { describe, it, expect } from 'vitest';
import {
  VISURA_VALIDITA_GIORNI,
  giorniTrascorsi,
  isVisuraScaduta,
  isInPreavviso,
  giorniRimanenti,
  limiteVisuraUtc,
} from './validita';

// Prisma @db.Date → Date a mezzanotte UTC.
const emissione = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
// Un istante a metà giornata romana, per non far dipendere i test dall'ora.
const oggi = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

describe('VISURA_VALIDITA_GIORNI', () => {
  it('è 180', () => {
    expect(VISURA_VALIDITA_GIORNI).toBe(180);
  });
});

describe('giorniTrascorsi', () => {
  it('stesso giorno → 0', () => {
    expect(giorniTrascorsi(emissione('2026-07-16'), oggi('2026-07-16'))).toBe(0);
  });

  it('conta i giorni di calendario, non le 24h', () => {
    expect(giorniTrascorsi(emissione('2026-01-01'), oggi('2026-07-01'))).toBe(181);
  });

  it('attraversa il cambio di ora legale senza perdere un giorno', () => {
    // 2026-03-29 è il passaggio a CEST: quel giorno dura 23 ore.
    expect(giorniTrascorsi(emissione('2026-03-28'), oggi('2026-03-30'))).toBe(2);
  });
});

describe('isVisuraScaduta — il confine è a 180', () => {
  const e = emissione('2026-01-01'); // +179 = 2026-06-29, +180 = 2026-06-30

  it('giorno 179 → valida', () => {
    expect(giorniTrascorsi(e, oggi('2026-06-29'))).toBe(179);
    expect(isVisuraScaduta(e, oggi('2026-06-29'))).toBe(false);
  });

  it('giorno 180 → SCADUTA (il confine è >=, non >)', () => {
    expect(giorniTrascorsi(e, oggi('2026-06-30'))).toBe(180);
    expect(isVisuraScaduta(e, oggi('2026-06-30'))).toBe(true);
  });

  it('giorno 181 → scaduta', () => {
    expect(isVisuraScaduta(e, oggi('2026-07-01'))).toBe(true);
  });

  it('null → MAI scaduta (esente)', () => {
    expect(isVisuraScaduta(null, oggi('2030-01-01'))).toBe(false);
  });

  it('data futura → non scaduta', () => {
    expect(isVisuraScaduta(emissione('2027-01-01'), oggi('2026-07-16'))).toBe(false);
  });
});

describe('isInPreavviso — finestra 175..179', () => {
  const e = emissione('2026-01-01');

  it('giorno 174 → no', () => {
    expect(isInPreavviso(e, oggi('2026-06-24'))).toBe(false);
  });

  it('giorno 175 → sì (primo giorno)', () => {
    expect(giorniTrascorsi(e, oggi('2026-06-25'))).toBe(175);
    expect(isInPreavviso(e, oggi('2026-06-25'))).toBe(true);
  });

  it('giorno 179 → sì (ultimo giorno)', () => {
    expect(isInPreavviso(e, oggi('2026-06-29'))).toBe(true);
  });

  it('giorno 180 → no: è già scaduta, non "in preavviso"', () => {
    expect(isInPreavviso(e, oggi('2026-06-30'))).toBe(false);
    expect(isVisuraScaduta(e, oggi('2026-06-30'))).toBe(true);
  });

  it('null → mai in preavviso', () => {
    expect(isInPreavviso(null, oggi('2026-06-25'))).toBe(false);
  });
});

describe('giorniRimanenti', () => {
  it('giorno 175 → ne restano 5', () => {
    expect(giorniRimanenti(emissione('2026-01-01'), oggi('2026-06-25'))).toBe(5);
  });

  it('giorno 180 → 0, mai negativo', () => {
    expect(giorniRimanenti(emissione('2026-01-01'), oggi('2026-06-30'))).toBe(0);
  });

  it('ampiamente scaduta → 0, non un numero negativo', () => {
    expect(giorniRimanenti(emissione('2024-12-13'), oggi('2026-07-16'))).toBe(0);
  });
});

describe('limiteVisuraUtc — soglia per il where Prisma', () => {
  it('NON scaduta ⟺ visuraCameraleData > limite: coerente con isVisuraScaduta', () => {
    const limite = limiteVisuraUtc(oggi('2026-06-30'));
    // emissione 2026-01-01 è scaduta al 2026-06-30 (giorno 180) → NON > limite
    expect(emissione('2026-01-01').getTime() > limite.getTime()).toBe(false);
    // emissione 2026-01-02 è al giorno 179 → valida → > limite
    expect(emissione('2026-01-02').getTime() > limite.getTime()).toBe(true);
  });
});
