import { describe, it, expect } from 'vitest';
import { generaCodiceOtp, otpScaduto, OTP_TTL_MS } from './otp';

describe('OTP mandato', () => {
  it('genera un codice di 6 cifre numeriche', () => {
    for (let i = 0; i < 50; i++) {
      const c = generaCodiceOtp();
      expect(c).toMatch(/^\d{6}$/);
    }
  });
  it('OTP_TTL_MS è ~10 minuti', () => {
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
  });
  it('otpScaduto: true se null, true se passato, false se futuro', () => {
    const now = new Date('2026-06-28T12:00:00Z');
    expect(otpScaduto(null, now)).toBe(true);
    expect(otpScaduto(new Date('2026-06-28T11:59:00Z'), now)).toBe(true);
    expect(otpScaduto(new Date('2026-06-28T12:05:00Z'), now)).toBe(false);
  });
});
