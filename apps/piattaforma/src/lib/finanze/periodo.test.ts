import { describe, it, expect } from 'vitest';
import {
  parsePeriodo,
  parseTipo,
  periodoLabel,
  resolvePeriodo,
  defaultCustomRange,
  periodoDateFilter,
  filtriPratiche,
} from './periodo';

// Metà luglio: in questa finestra non c'è nessuna transizione DST (né a
// Roma né altrove), quindi le asserzioni sulle finestre mobili (che usano i
// setter locali, come il codice originale) danno lo stesso risultato
// qualunque sia il fuso del runner — verificato anche lanciando la suite con
// TZ=UTC. UTC stesso non è mai "in CEST": la proprietà che conta è l'assenza
// di transizione, non una coincidenza di fuso.
const NOW = new Date('2026-07-27T10:00:00.000Z');

describe('parsePeriodo', () => {
  it('accetta i cinque valori noti', () => {
    for (const p of ['giorno', 'settimana', 'mese', 'anno', 'custom'] as const) {
      expect(parsePeriodo(p)).toBe(p);
    }
  });
  it('assente o sconosciuto torna mese, non l ultimo ramo della catena', () => {
    expect(parsePeriodo(undefined)).toBe('mese');
    expect(parsePeriodo(null)).toBe('mese');
    expect(parsePeriodo('pippo')).toBe('mese');
  });
});

describe('resolvePeriodo — finestre mobili (comportamento invariato)', () => {
  it('giorno: 24h indietro, nessun estremo superiore', () => {
    const r = resolvePeriodo({ periodo: 'giorno', now: NOW });
    expect(r.gte!.toISOString()).toBe('2026-07-26T10:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.label).toBe('Ultime 24h');
  });
  it('settimana, mese, anno', () => {
    expect(resolvePeriodo({ periodo: 'settimana', now: NOW }).gte!.toISOString())
      .toBe('2026-07-20T10:00:00.000Z');
    expect(resolvePeriodo({ periodo: 'mese', now: NOW }).gte!.toISOString())
      .toBe('2026-06-27T10:00:00.000Z');
    expect(resolvePeriodo({ periodo: 'anno', now: NOW }).gte!.toISOString())
      .toBe('2025-07-27T10:00:00.000Z');
  });
  it('le finestre mobili non emettono da/a', () => {
    const r = resolvePeriodo({ periodo: 'mese', now: NOW });
    expect(r.da).toBe('');
    expect(r.a).toBe('');
  });
});

describe('resolvePeriodo — custom', () => {
  it('due estremi: giorni interi in Europe/Rome', () => {
    const r = resolvePeriodo({ periodo: 'custom', da: '2026-06-01', a: '2026-06-30', now: NOW });
    expect(r.gte!.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(r.lte!.toISOString()).toBe('2026-06-30T21:59:59.999Z');
    expect(r.label).toBe('Dal 01/06/2026 al 30/06/2026');
  });
  it('solo da: aperto a destra', () => {
    const r = resolvePeriodo({ periodo: 'custom', da: '2026-06-01', now: NOW });
    expect(r.gte!.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.label).toBe('Dal 01/06/2026');
  });
  it('solo a: aperto a sinistra', () => {
    const r = resolvePeriodo({ periodo: 'custom', a: '2026-06-30', now: NOW });
    expect(r.gte).toBeUndefined();
    expect(r.lte!.toISOString()).toBe('2026-06-30T21:59:59.999Z');
    expect(r.label).toBe('Fino al 30/06/2026');
  });
  it('estremo malformato ignorato in silenzio', () => {
    const r = resolvePeriodo({ periodo: 'custom', da: '01/06/2026', a: '2026-02-30', now: NOW });
    expect(r.gte).toBeUndefined();
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.label).toBe('Tutto lo storico');
  });
});

describe('defaultCustomRange', () => {
  it('ultimo mese in giorni di calendario', () => {
    expect(defaultCustomRange(new Date('2026-07-27T10:00:00.000Z')))
      .toEqual({ da: '2026-06-27', a: '2026-07-27' });
  });
  it('clampa al fondo del mese: 31 marzo torna al 28 febbraio, non al 3 marzo', () => {
    expect(defaultCustomRange(new Date('2026-03-31T10:00:00.000Z')))
      .toEqual({ da: '2026-02-28', a: '2026-03-31' });
  });
  it('anno bisestile: 31 marzo 2024 torna al 29 febbraio', () => {
    expect(defaultCustomRange(new Date('2024-03-31T10:00:00.000Z')))
      .toEqual({ da: '2024-02-29', a: '2024-03-31' });
  });
  it('cambio d anno: 15 gennaio torna al 15 dicembre precedente', () => {
    expect(defaultCustomRange(new Date('2026-01-15T10:00:00.000Z')))
      .toEqual({ da: '2025-12-15', a: '2026-01-15' });
  });
  it('usa il giorno di Roma, non quello UTC', () => {
    // 00:30 del 17 luglio a Roma sono le 22:30 del 16 in UTC: il runtime su
    // Vercel è UTC e senza romeYmd il default sbaglierebbe giorno ogni notte.
    expect(defaultCustomRange(new Date('2026-07-16T22:30:00.000Z')).a).toBe('2026-07-17');
  });
});

describe('periodoDateFilter', () => {
  it('finestra mobile: solo gte', () => {
    const f = periodoDateFilter(resolvePeriodo({ periodo: 'mese', now: NOW }));
    expect(Object.keys(f!)).toEqual(['gte']);
  });
  it('custom con due estremi: gte + lte', () => {
    const f = periodoDateFilter(
      resolvePeriodo({ periodo: 'custom', da: '2026-06-01', a: '2026-06-30', now: NOW }),
    );
    expect(f).toEqual({
      gte: new Date('2026-05-31T22:00:00.000Z'),
      lte: new Date('2026-06-30T21:59:59.999Z'),
    });
  });
  it('range vuoto: nessun filtro, non un oggetto vuoto', () => {
    expect(periodoDateFilter(resolvePeriodo({ periodo: 'custom', now: NOW }))).toBeUndefined();
  });
});

describe('periodoLabel', () => {
  it('etichette dei tab', () => {
    expect(periodoLabel('giorno')).toBe('Ultime 24h');
    expect(periodoLabel('anno')).toBe('Ultimo anno');
    expect(periodoLabel('custom')).toBe('Personalizzato');
  });
});

describe('parseTipo', () => {
  it('accetta i due valori noti', () => {
    expect(parseTipo('SEMPLICE')).toBe('SEMPLICE');
    expect(parseTipo('MINIVOLTURA')).toBe('MINIVOLTURA');
  });
  it('assente o sconosciuto torna stringa vuota, mai un valore che Prisma rifiuta', () => {
    expect(parseTipo(undefined)).toBe('');
    expect(parseTipo(null)).toBe('');
    expect(parseTipo('')).toBe('');
    expect(parseTipo('pippo')).toBe('');
  });
});

describe('filtriPratiche', () => {
  it('periodo mobile + tipo valido: where ha createdAt.gte e tipo, nessun lte', () => {
    const f = filtriPratiche({ periodo: 'mese', tipo: 'SEMPLICE', now: NOW });
    expect(f.periodo).toBe('mese');
    expect(f.tipo).toBe('SEMPLICE');
    expect(f.where).toEqual({
      deletedAt: null,
      createdAt: { gte: new Date('2026-06-27T10:00:00.000Z') },
      tipo: 'SEMPLICE',
    });
  });

  it('custom con due estremi: where ha createdAt.gte e .lte', () => {
    const f = filtriPratiche({ periodo: 'custom', da: '2026-06-01', a: '2026-06-30', now: NOW });
    expect(f.periodo).toBe('custom');
    expect(f.range.label).toBe('Dal 01/06/2026 al 30/06/2026');
    expect(f.where).toEqual({
      deletedAt: null,
      createdAt: {
        gte: new Date('2026-05-31T22:00:00.000Z'),
        lte: new Date('2026-06-30T21:59:59.999Z'),
      },
    });
  });

  it('custom senza estremi: nessun createdAt nel where', () => {
    const f = filtriPratiche({ periodo: 'custom', now: NOW });
    expect(f.where).toEqual({ deletedAt: null });
    expect('createdAt' in f.where).toBe(false);
  });

  it('tipo sconosciuto: nessun tipo nel where (e non finisce nel filename di chi chiama)', () => {
    const f = filtriPratiche({ periodo: 'mese', tipo: 'pippo', now: NOW });
    expect(f.tipo).toBe('');
    expect(f.where).toEqual({
      deletedAt: null,
      createdAt: { gte: new Date('2026-06-27T10:00:00.000Z') },
    });
    expect('tipo' in f.where).toBe(false);
  });

  it('periodo sconosciuto: ricade su mese', () => {
    const f = filtriPratiche({ periodo: 'pippo', now: NOW });
    expect(f.periodo).toBe('mese');
    expect(f.where).toEqual({
      deletedAt: null,
      createdAt: { gte: new Date('2026-06-27T10:00:00.000Z') },
    });
  });
});
