import { describe, it, expect } from 'vitest';
import { prossimoNumero } from './numerazione';

describe('prossimoNumero', () => {
  it("primo documento dell'anno → 1", () => {
    expect(prossimoNumero({ anno: null, num: null }, 2026)).toEqual({ anno: 2026, num: 1 });
  });
  it('stesso anno → incremento', () => {
    expect(prossimoNumero({ anno: 2026, num: 5 }, 2026)).toEqual({ anno: 2026, num: 6 });
  });
  it('nuovo anno fiscale → reset a 1', () => {
    expect(prossimoNumero({ anno: 2025, num: 42 }, 2026)).toEqual({ anno: 2026, num: 1 });
  });
});
