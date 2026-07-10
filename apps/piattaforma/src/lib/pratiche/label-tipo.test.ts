import { describe, expect, it } from 'vitest';
import { labelTipoPratica } from './label-tipo';

describe('labelTipoPratica', () => {
  it('SEMPLICE singolo', () => {
    expect(labelTipoPratica({ tipo: 'SEMPLICE', numeroVeicoli: 1 })).toBe('Semplice');
  });
  it('SEMPLICE multiplo', () => {
    expect(labelTipoPratica({ tipo: 'SEMPLICE', numeroVeicoli: 3 })).toBe('Semplice Multiplo');
  });
  it('MINIVOLTURA singolo', () => {
    expect(labelTipoPratica({ tipo: 'MINIVOLTURA', numeroVeicoli: 1 })).toBe('Minivoltura');
  });
  it('MINIVOLTURA multiplo', () => {
    expect(labelTipoPratica({ tipo: 'MINIVOLTURA', numeroVeicoli: 2 })).toBe('Minivoltura multipla');
  });
  it('numeroVeicoli 0 → singolo', () => {
    expect(labelTipoPratica({ tipo: 'SEMPLICE', numeroVeicoli: 0 })).toBe('Semplice');
  });
});
