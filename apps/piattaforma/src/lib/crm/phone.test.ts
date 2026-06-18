import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('toglie spazi e segni di formattazione', () => {
    expect(normalizePhone('02 1234-567')).toBe('021234567');
    expect(normalizePhone('348/123 4567')).toBe('3481234567');
    expect(normalizePhone('(02) 1234567')).toBe('021234567');
  });

  it('normalizza il prefisso internazionale italiano (+39 / 0039)', () => {
    expect(normalizePhone('+39 348 1234567')).toBe('3481234567');
    expect(normalizePhone('0039 348 1234567')).toBe('3481234567');
    expect(normalizePhone('348 1234567')).toBe('3481234567');
  });

  it('+39 e numero locale producono la stessa chiave (landline)', () => {
    expect(normalizePhone('+39 02 1234567')).toBe(normalizePhone('02 1234567'));
  });

  it('non tocca un prefisso 39 corto (numero non internazionale)', () => {
    expect(normalizePhone('39012345')).toBe('39012345');
  });

  it('null / vuoto → stringa vuota', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('---')).toBe('');
  });
});
