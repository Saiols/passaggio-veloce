import { randomInt } from 'node:crypto';

/** Durata di validità del codice OTP (10 minuti). */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** Genera un codice OTP numerico a 6 cifre (con eventuali zeri iniziali). */
export function generaCodiceOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** True se il codice è scaduto (o assente). */
export function otpScaduto(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}
