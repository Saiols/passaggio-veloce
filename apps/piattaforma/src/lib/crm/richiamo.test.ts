import { describe, it, expect } from 'vitest';
import {
  campiRichiamoDopoCambioStato,
  etichettaRichiamo,
  sogliaRichiamoDovuto,
} from './richiamo';

/**
 * Il giorno del richiamo è memorizzato a mezzanotte UTC (come ogni altra data
 * di quella scheda), ma "oggi", "scaduto" e la soglia del filtro sono domande
 * sul CALENDARIO ITALIANO. Alle 00:30 del 5 agosto a Roma, in UTC sono ancora
 * le 22:30 del 4: usare UTC sposterebbe di un giorno ogni richiamo, e lo
 * sposterebbe solo nelle ore serali — cioè in modo intermittente.
 */
describe('campiRichiamoDopoCambioStato', () => {
  it('uscire da S11 azzera giorno e fascia', () => {
    expect(campiRichiamoDopoCambioStato('S11', 'S3')).toEqual({
      nextContactAt: null,
      nextContactFascia: null,
    });
  });

  it('restare in S11 non tocca niente (riprogrammazione)', () => {
    expect(campiRichiamoDopoCambioStato('S11', 'S11')).toEqual({});
  });

  it('un cambio di stato che non parte da S11 non tocca niente', () => {
    // Regressione: azzerare in base allo stato FINALE invece che alla
    // transizione cancellerebbe una data messa a mano su un contatto S3 a
    // ogni salvataggio della scheda.
    expect(campiRichiamoDopoCambioStato('S3', 'S3')).toEqual({});
    expect(campiRichiamoDopoCambioStato('S3', 'S9')).toEqual({});
    expect(campiRichiamoDopoCambioStato('S0', 'S4')).toEqual({});
  });

  it("anche l'aggancio automatico a un'azienda registrata azzera", () => {
    // È il caso di match/apply.ts e sync.ts: un contatto da richiamare che si
    // iscrive davvero passa a S7/S8/S9 senza toccare le action.
    expect(campiRichiamoDopoCambioStato('S11', 'S8')).toEqual({
      nextContactAt: null,
      nextContactFascia: null,
    });
  });
});

describe('etichettaRichiamo', () => {
  const GIORNO_ESTATE = new Date('2026-08-04T00:00:00Z'); // 4 agosto

  it('compone testo con giorno e fascia', () => {
    const r = etichettaRichiamo(
      GIORNO_ESTATE,
      'MATTINA',
      new Date('2026-08-03T09:00:00Z'),
    );
    expect(r.testo).toBe('mar 4 ago · mattina');
    expect(r.scaduto).toBe(false);
    expect(r.oggi).toBe(false);
  });

  it('senza fascia mostra solo il giorno', () => {
    const r = etichettaRichiamo(
      GIORNO_ESTATE,
      null,
      new Date('2026-08-03T09:00:00Z'),
    );
    expect(r.testo).toBe('mar 4 ago');
  });

  it('ora legale: alle 23:30 di Roma è ancora oggi', () => {
    // 21:30Z = 23:30 a Roma del 4 agosto
    const r = etichettaRichiamo(GIORNO_ESTATE, 'MATTINA', new Date('2026-08-04T21:30:00Z'));
    expect(r.oggi).toBe(true);
    expect(r.scaduto).toBe(false);
  });

  it('ora legale: alle 00:30 di Roma del giorno dopo è scaduto', () => {
    // 22:30Z del 4 = 00:30 a Roma del 5 agosto
    const r = etichettaRichiamo(GIORNO_ESTATE, 'MATTINA', new Date('2026-08-04T22:30:00Z'));
    expect(r.oggi).toBe(false);
    expect(r.scaduto).toBe(true);
  });

  it('ora solare: alle 23:30 di Roma è ancora oggi', () => {
    const giornoInverno = new Date('2026-01-14T00:00:00Z');
    // 22:30Z = 23:30 a Roma del 14 gennaio (UTC+1)
    const r = etichettaRichiamo(giornoInverno, null, new Date('2026-01-14T22:30:00Z'));
    expect(r.oggi).toBe(true);
    expect(r.scaduto).toBe(false);
  });

  it('ora solare: alle 00:30 di Roma del giorno dopo è scaduto', () => {
    const giornoInverno = new Date('2026-01-14T00:00:00Z');
    const r = etichettaRichiamo(giornoInverno, null, new Date('2026-01-14T23:30:00Z'));
    expect(r.scaduto).toBe(true);
  });

  it('accetta anche la data serializzata in ISO dal server component', () => {
    const r = etichettaRichiamo(
      '2026-08-04T00:00:00.000Z',
      'POMERIGGIO',
      new Date('2026-08-04T09:00:00Z'),
    );
    expect(r.testo).toBe('mar 4 ago · pomeriggio');
    expect(r.oggi).toBe(true);
  });
});

describe('sogliaRichiamoDovuto', () => {
  it('include i richiami di oggi e esclude quelli di domani', () => {
    // Le 09:00 di Roma del 4 agosto.
    const soglia = sogliaRichiamoDovuto(new Date('2026-08-04T07:00:00Z'));
    expect(new Date('2026-08-04T00:00:00Z').getTime()).toBeLessThanOrEqual(soglia.getTime());
    expect(new Date('2026-08-05T00:00:00Z').getTime()).toBeGreaterThan(soglia.getTime());
  });

  it('a fine giornata romana include ancora i richiami di oggi', () => {
    // 21:30Z = 23:30 a Roma: la soglia deve essere ancora quella del 4.
    const soglia = sogliaRichiamoDovuto(new Date('2026-08-04T21:30:00Z'));
    expect(new Date('2026-08-04T00:00:00Z').getTime()).toBeLessThanOrEqual(soglia.getTime());
    expect(new Date('2026-08-05T00:00:00Z').getTime()).toBeGreaterThan(soglia.getTime());
  });

  it('ora legale: a mezzanotte passata a Roma la soglia è già del giorno dopo', () => {
    // 22:30Z del 4 agosto = 00:30 a Roma del 5: un'implementazione UTC-naive
    // (che leggesse il giorno da adesso.getUTCDate() invece che da Roma)
    // resterebbe ferma al 4 e questo test lo scoprirebbe: un richiamo
    // memorizzato al 5 agosto risulterebbe escluso invece che incluso.
    const soglia = sogliaRichiamoDovuto(new Date('2026-08-04T22:30:00Z'));
    expect(new Date('2026-08-05T00:00:00Z').getTime()).toBeLessThanOrEqual(soglia.getTime());
    expect(new Date('2026-08-06T00:00:00Z').getTime()).toBeGreaterThan(soglia.getTime());
  });

  it('ora solare: a mezzanotte passata a Roma la soglia è già del giorno dopo', () => {
    // 23:30Z del 14 gennaio = 00:30 a Roma del 15 (UTC+1): stesso discriminante
    // dell'ora legale, ma con l'offset invernale.
    const soglia = sogliaRichiamoDovuto(new Date('2026-01-14T23:30:00Z'));
    expect(new Date('2026-01-15T00:00:00Z').getTime()).toBeLessThanOrEqual(soglia.getTime());
    expect(new Date('2026-01-16T00:00:00Z').getTime()).toBeGreaterThan(soglia.getTime());
  });
});
