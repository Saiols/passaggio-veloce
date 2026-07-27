import { describe, expect, it } from 'vitest';
import {
  parseYmd,
  romeStartOfDay,
  romeEndOfDay,
  resolveDayRange,
  romeYmd,
  romeWallClockToUtc,
  romeAnnoCivile,
  romeIsoDate,
  romeDataLeggibile,
  romeDataOraLeggibile,
} from './rome-day';

describe('parseYmd', () => {
  it('accetta una data di calendario valida', () => {
    expect(parseYmd('2026-07-15')).toEqual([2026, 7, 15]);
  });
  it('rifiuta undefined, formati errati e date impossibili', () => {
    expect(parseYmd(undefined)).toBeNull();
    expect(parseYmd('15/07/2026')).toBeNull();
    expect(parseYmd('2026-02-30')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
  });
});

describe('romeStartOfDay / romeEndOfDay (Europe/Rome, DST)', () => {
  it('estate CEST (+2)', () => {
    expect(romeStartOfDay([2026, 7, 15]).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(romeEndOfDay([2026, 7, 20]).toISOString()).toBe('2026-07-20T21:59:59.999Z');
  });
  it('inverno CET (+1)', () => {
    expect(romeStartOfDay([2026, 1, 15]).toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });
  it('giorno di spring-forward (29/03/2026)', () => {
    expect(romeStartOfDay([2026, 3, 29]).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(romeEndOfDay([2026, 3, 29]).toISOString()).toBe('2026-03-29T21:59:59.999Z');
  });
  it('giorno di fall-back (25/10/2026)', () => {
    expect(romeStartOfDay([2026, 10, 25]).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(romeEndOfDay([2026, 10, 25]).toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
});

describe('romeYmd', () => {
  it('ora legale (CEST, +2): 23:30 UTC del 16/07 è già il 17/07 a Roma', () => {
    expect(romeYmd(new Date('2026-07-16T23:30:00Z'))).toEqual([2026, 7, 17]);
  });

  it('ora legale: 21:30 UTC del 16/07 è ancora il 16/07 a Roma', () => {
    expect(romeYmd(new Date('2026-07-16T21:30:00Z'))).toEqual([2026, 7, 16]);
  });

  it('ora solare (CET, +1): 23:30 UTC del 15/01 è già il 16/01 a Roma', () => {
    expect(romeYmd(new Date('2026-01-15T23:30:00Z'))).toEqual([2026, 1, 16]);
  });

  it('ora solare: 22:30 UTC del 15/01 è ancora il 15/01 a Roma', () => {
    expect(romeYmd(new Date('2026-01-15T22:30:00Z'))).toEqual([2026, 1, 15]);
  });
});

describe('resolveDayRange', () => {
  it('da+a validi: bound + echo + active', () => {
    const r = resolveDayRange('2026-07-15', '2026-07-20');
    expect(r.gte?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(r.lte?.toISOString()).toBe('2026-07-20T21:59:59.999Z');
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('2026-07-20');
    expect(r.active).toBe(true);
  });
  it('solo da: nessun lte', () => {
    const r = resolveDayRange('2026-07-15', undefined);
    expect(r.gte?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('');
    expect(r.active).toBe(true);
  });
  it('vuoto o malformato: inattivo, nessun bound', () => {
    const r = resolveDayRange(undefined, '31/12/2026');
    expect(r.gte).toBeUndefined();
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.active).toBe(false);
  });
});

describe('romeAnnoCivile', () => {
  it('capodanno: 23:30 UTC del 31/12 è già il 2027 a Roma', () => {
    expect(romeAnnoCivile(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
  });
  it('istante ordinario: segue lo stesso anno UTC', () => {
    expect(romeAnnoCivile(new Date('2026-06-17T10:00:00Z'))).toBe(2026);
  });
});

describe('romeIsoDate', () => {
  it('capodanno: 23:30 UTC del 31/12 diventa 2027-01-01 a Roma, non 2026-12-31 UTC', () => {
    expect(romeIsoDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
  it('istante ordinario: stessa data del giorno UTC', () => {
    expect(romeIsoDate(new Date('2026-06-17T10:00:00Z'))).toBe('2026-06-17');
  });
});

describe('romeDataLeggibile', () => {
  it('capodanno: 23:30 UTC del 31/12 si legge "1 gen 2027" a Roma, non "31 dic 2026"', () => {
    expect(romeDataLeggibile(new Date('2026-12-31T23:30:00Z'))).toBe('1 gen 2027');
  });
  it('istante ordinario: stile medium it-IT', () => {
    expect(romeDataLeggibile(new Date('2026-06-17T10:00:00Z'))).toBe('17 giu 2026');
  });
});

describe('romeWallClockToUtc', () => {
  // Offset verificati con Intl.DateTimeFormat({timeZone:'Europe/Rome'}):
  // 2026-03-28 (sab) = CET +1h; 2026-03-30 (lun) = CEST +2h — il cambio è
  // domenica 2026-03-29. 2026-10-24 (sab) = CEST +2h; 2026-10-26 (lun) = CET +1h.
  it('ora solare (CET, +1): 09:00 a Roma = 08:00 UTC', () => {
    expect(romeWallClockToUtc(2026, 3, 28, 9, 0, 0, 0).toISOString()).toBe(
      '2026-03-28T08:00:00.000Z',
    );
  });

  it('ora legale (CEST, +2): 09:00 a Roma = 07:00 UTC', () => {
    expect(romeWallClockToUtc(2026, 3, 30, 9, 0, 0, 0).toISOString()).toBe(
      '2026-03-30T07:00:00.000Z',
    );
  });

  it('ritorno all ora solare in ottobre', () => {
    expect(romeWallClockToUtc(2026, 10, 24, 19, 0, 0, 0).toISOString()).toBe(
      '2026-10-24T17:00:00.000Z',
    );
    expect(romeWallClockToUtc(2026, 10, 26, 19, 0, 0, 0).toISOString()).toBe(
      '2026-10-26T18:00:00.000Z',
    );
  });
});

describe('romeDataOraLeggibile', () => {
  // Il timestamp di un'attestazione e' una prova: mostrarlo in UTC su un server
  // Vercel significa dichiarare un'ora che l'utente non ha mai visto.
  it("rende l'ora italiana, non quella del server", () => {
    // 2026-07-15T12:00:00Z = 14:00 a Roma (CEST, UTC+2)
    const s = romeDataOraLeggibile(new Date('2026-07-15T12:00:00Z'));
    expect(s).toContain('14:00');
  });

  it('rende l ora italiana anche in ora solare', () => {
    // 2026-01-15T12:00:00Z = 13:00 a Roma (CET, UTC+1)
    const s = romeDataOraLeggibile(new Date('2026-01-15T12:00:00Z'));
    expect(s).toContain('13:00');
  });
});
