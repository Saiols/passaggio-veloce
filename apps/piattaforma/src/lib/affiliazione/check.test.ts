import { describe, it, expect } from 'vitest';
import { flagLabel } from './check-util';

describe('flagLabel', () => {
  it('returns human-friendly label for SAME_IBAN', () => {
    expect(flagLabel('SAME_IBAN')).toBe('Stesso IBAN');
  });
  it('returns human-friendly label for SAME_IP_SIGNUP', () => {
    expect(flagLabel('SAME_IP_SIGNUP')).toBe('Stesso IP di signup');
  });
  it('returns human-friendly label for SAME_EMAIL_DOMAIN', () => {
    expect(flagLabel('SAME_EMAIL_DOMAIN')).toBe('Stesso dominio email aziendale');
  });
  it('returns human-friendly label for SAME_ADMIN', () => {
    expect(flagLabel('SAME_ADMIN')).toBe('Stesso utente admin condiviso');
  });
});
