import 'server-only';
import { randomBytes } from 'node:crypto';

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function expiresIn(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
