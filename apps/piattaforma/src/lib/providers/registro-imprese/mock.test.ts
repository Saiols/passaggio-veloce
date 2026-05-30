import { describe, it, expect } from 'vitest';
import { MockRegistroImpreseProvider } from './mock';

describe('MockRegistroImpreseProvider', () => {
  const provider = new MockRegistroImpreseProvider();

  it('ha name "mock"', () => {
    expect(provider.name).toBe('mock');
  });

  it('ritorna dati deterministici per lo stesso P.IVA', async () => {
    const a = await provider.lookupByPiva({ partitaIva: '12345678901' });
    const b = await provider.lookupByPiva({ partitaIva: '12345678901' });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.partitaIva).toBe('12345678901');
    expect(a!.statoAttivita).toBe('ATTIVA');
    expect(a!.denominazione.length).toBeGreaterThan(0);
  });

  it('varia i dati al variare del P.IVA', async () => {
    const a = await provider.lookupByPiva({ partitaIva: '11111111111' });
    const b = await provider.lookupByPiva({ partitaIva: '99999999999' });
    expect(a!.denominazione).not.toBe(b!.denominazione);
  });
});
