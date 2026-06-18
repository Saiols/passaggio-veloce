import { describe, it, expect } from 'vitest';
import { formatIndirizzo } from './acquirente-indirizzo';

describe('formatIndirizzo', () => {
  it('compone un indirizzo completo', () => {
    expect(
      formatIndirizzo({ indirizzo: 'Via Roma', civico: '12', cap: '20100', citta: 'Milano', provincia: 'MI' }),
    ).toBe('Via Roma 12, 20100 Milano (MI)');
  });

  it('omette le parti mancanti', () => {
    expect(
      formatIndirizzo({ indirizzo: 'Via Roma', civico: '', cap: '', citta: 'Milano', provincia: '' }),
    ).toBe('Via Roma, Milano');
  });

  it('stringa vuota se tutte le parti sono vuote', () => {
    expect(formatIndirizzo({ indirizzo: '', civico: '', cap: '', citta: '', provincia: '' })).toBe('');
  });
});
