import { describe, it, expect } from 'vitest';
import {
  parseNumberInput,
  clampNumberInput,
  commitNumberInput,
} from './number-input';

describe('parseNumberInput', () => {
  it('parses valid numbers and accepts comma decimals', () => {
    expect(parseNumberInput('8')).toBe(8);
    expect(parseNumberInput('8.5')).toBe(8.5);
    expect(parseNumberInput('8,5')).toBe(8.5);
    expect(parseNumberInput('012', true)).toBe(12);
  });

  it('returns null for empty or incomplete input', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
    expect(parseNumberInput('-')).toBeNull();
    expect(parseNumberInput('.')).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
  });
});

describe('clampNumberInput', () => {
  it('clamps to [min, max]', () => {
    expect(clampNumberInput(5, 2, 50)).toBe(5);
    expect(clampNumberInput(1, 2, 50)).toBe(2);
    expect(clampNumberInput(99, 2, 50)).toBe(50);
    expect(clampNumberInput(1)).toBe(1); // nessun limite
  });
});

describe('commitNumberInput', () => {
  it('clamps a typed value to the allowed range', () => {
    expect(commitNumberInput('8', { min: 2, max: 50, integer: true })).toBe(8);
    expect(commitNumberInput('1', { min: 2, max: 50, integer: true })).toBe(2);
    expect(commitNumberInput('999', { min: 2, max: 50, integer: true })).toBe(50);
  });

  it('on empty input falls back to the last valid value, then min', () => {
    // niente fallback → usa min
    expect(commitNumberInput('', { min: 2, integer: true })).toBe(2);
    // con fallback (ultimo valore valido) → torna a quello
    expect(commitNumberInput('', { min: 2, integer: true, fallback: 5 })).toBe(5);
  });

  it('keeps empty as null when allowEmpty is set', () => {
    expect(commitNumberInput('', { allowEmpty: true })).toBeNull();
    expect(commitNumberInput('', { min: 1, allowEmpty: true })).toBeNull();
  });
});
