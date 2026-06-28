import { describe, it, expect } from 'vitest';
import { MANDATO_TITOLO, MANDATO_CLAUSOLE } from './testo';

describe('testo mandato', () => {
  it('titolo corretto', () => {
    expect(MANDATO_TITOLO).toContain('Mandato per fatturazione per conto terzi');
  });
  it('contiene le 10 sezioni con le intestazioni attese', () => {
    const headings = MANDATO_CLAUSOLE.map((c) => c.heading);
    expect(MANDATO_CLAUSOLE).toHaveLength(10);
    expect(headings).toContain('1. Oggetto del mandato');
    expect(headings).toContain('7. Trattamento dei dati personali');
    expect(headings).toContain('10. Sottoscrizione');
  });
  it('il corpo GDPR cita il Regolamento UE 2016/679', () => {
    const gdpr = MANDATO_CLAUSOLE.find((c) => c.heading.startsWith('7.'))!;
    expect(gdpr.body).toContain('2016/679');
  });
});
