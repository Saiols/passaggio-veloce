import { describe, it, expect } from 'vitest';
import { telHref } from './tel';

describe('telHref', () => {
  it('ripulisce spazi e separatori mantenendo cifre e +', () => {
    expect(telHref('+39 02 447 8712')).toBe('tel:+39024478712');
    expect(telHref('02-447/8712')).toBe('tel:024478712');
  });
  it('stringa vuota o solo simboli → null', () => {
    expect(telHref('')).toBeNull();
    expect(telHref('   ')).toBeNull();
    expect(telHref('--')).toBeNull();
  });
});
