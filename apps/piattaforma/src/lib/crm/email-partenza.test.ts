import { describe, it, expect } from 'vitest';
import { nextStatoInvio, nextStatoApertura } from './email-partenza';

describe('nextStatoInvio — avanza-non-declassa', () => {
  it('porta S0..S3 a S4', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3']) {
      expect(nextStatoInvio(s)).toBe('S4');
    }
  });
  it('non declassa stati già avanzati', () => {
    for (const s of ['S5', 'S6', 'S7', 'S8', 'S9']) {
      expect(nextStatoInvio(s)).toBe(s);
    }
  });
  it('non tocca S10 (churned)', () => {
    expect(nextStatoInvio('S10')).toBe('S10');
  });
});

describe('nextStatoApertura — avanza-non-declassa', () => {
  it('porta S0..S4 a S5', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3', 'S4']) {
      expect(nextStatoApertura(s)).toBe('S5');
    }
  });
  it('non declassa S6/S7+', () => {
    for (const s of ['S6', 'S7', 'S8']) {
      expect(nextStatoApertura(s)).toBe(s);
    }
  });
});
