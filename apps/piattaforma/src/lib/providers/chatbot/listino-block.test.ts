import { describe, it, expect } from 'vitest';
import { buildListinoBlock } from './listino-block';
import { DEFAULT_TARIFFARIO } from '@/lib/pricing';

describe('buildListinoBlock', () => {
  it('include i costi e i compensi correnti, marcato come autorevole', () => {
    const s = buildListinoBlock(DEFAULT_TARIFFARIO);
    expect(s).toContain('LISTINO UFFICIALE');
    expect(s).toContain('75,00');   // costo agenzia SEMPLICE
    expect(s).toContain('25,00');   // compenso broker SEMPLICE
    expect(s).toContain('15,00');   // costo agenzia MINIVOLTURA
  });

  it('include anche il costo affiliazione per entrambi i tipi', () => {
    const s = buildListinoBlock(DEFAULT_TARIFFARIO);
    expect(s).toContain('affiliazione');
    expect(s).toContain('10,00');   // costo affiliazione SEMPLICE (€10)
    // entrambe le righe (SEMPLICE + MINIVOLTURA) citano la commissione affiliazione
    expect(s.match(/commissione affiliazione/g)?.length).toBe(2);
  });
});
