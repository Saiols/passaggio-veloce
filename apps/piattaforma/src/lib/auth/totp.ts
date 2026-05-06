import 'server-only';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { hashPassword as bcryptHash } from './password';
import bcrypt from 'bcryptjs';

/**
 * Helper 2FA TOTP (A9).
 *
 * - Genera secret base32 + URI otpauth da scansionare con app authenticator
 *   (Google Authenticator, Authy, 1Password, ecc.)
 * - Verifica codici TOTP a 6 cifre con finestra di tolleranza ±1 (30s)
 * - Genera + verifica backup codes (10 codici single-use, hashati bcrypt)
 */

const ISSUER = 'Passaggio Veloce';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

export type TotpSetup = {
  secret: string;
  /** otpauth://... URI per QR code generator */
  uri: string;
};

export function generateTotpSecret(email: string): TotpSetup {
  const secret = generateSecret();
  const uri = generateURI({
    secret,
    label: email,
    issuer: ISSUER,
  });
  return { secret, uri };
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const result = verifySync({
      token: code.trim(),
      secret,
      // Tolleranza ±30s per drift orologio device (1 step TOTP)
      epochTolerance: 30,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/** Genera N backup codes leggibili (es. "F3K9-7B2X"). */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let raw = '';
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      raw += chars[Math.floor(Math.random() * chars.length)];
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

/** Hasha gli N backup codes (bcrypt) per persistenza sicura. */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcryptHash(c)));
}

/**
 * Verifica un backup code contro la lista hashata. Ritorna l'indice del
 * codice consumato (da rimuovere lato chiamante) oppure -1 se nessun match.
 */
export async function verifyBackupCode(
  hashes: string[],
  code: string,
): Promise<number> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i]!)) return i;
  }
  return -1;
}
