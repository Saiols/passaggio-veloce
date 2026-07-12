import 'server-only';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Policy unica per le password scelte dall'utente (reset via email, cambio
 * password dal profilo). Ritorna il messaggio d'errore, o null se valida.
 */
export function validatePasswordPolicy(plain: string): string | null {
  if (!plain || plain.length < 8) return 'Password troppo corta (min 8 caratteri)';
  if (!/[A-Z]/.test(plain) || !/[a-z]/.test(plain) || !/[0-9]/.test(plain)) {
    return 'La password deve contenere maiuscole, minuscole e numeri';
  }
  return null;
}
