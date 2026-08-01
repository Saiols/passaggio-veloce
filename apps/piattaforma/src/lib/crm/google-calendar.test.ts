import { describe, it, expect } from 'vitest';
import { googleCalendarUrl } from './google-calendar';

const giorno = new Date('2026-08-04T00:00:00.000Z'); // 4 ago, giorno romano = 4 ago

describe('googleCalendarUrl', () => {
  it('mattina → 09:00-13:00 con timezone Roma', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', giorno, fascia: 'MATTINA' }));
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('dates')).toBe('20260804T090000/20260804T130000');
    expect(u.searchParams.get('ctz')).toBe('Europe/Rome');
    expect(u.searchParams.get('text')).toBe('Richiamare Rossi');
  });
  it('pomeriggio → 15:00-19:00', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', giorno, fascia: 'POMERIGGIO' }));
    expect(u.searchParams.get('dates')).toBe('20260804T150000/20260804T190000');
  });
  it('indifferente → evento tutto il giorno (fine esclusiva il giorno dopo)', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', giorno, fascia: null }));
    expect(u.searchParams.get('dates')).toBe('20260804/20260805');
  });
  it('mette tel e città nei dettagli', () => {
    const u = new URL(
      googleCalendarUrl({ nome: 'Rossi', tel: '02 111', citta: 'Milano', giorno, fascia: 'MATTINA' }),
    );
    expect(u.searchParams.get('details')).toContain('02 111');
    expect(u.searchParams.get('details')).toContain('Milano');
  });
});
