import { describe, it, expect } from 'vitest';
import { isOwner } from './permissions';

describe('isOwner', () => {
  it('true per ADMIN_AZIENDA (proprietario madre)', () => {
    expect(isOwner('ADMIN_AZIENDA')).toBe(true);
  });

  it('false per gli altri ruoli', () => {
    expect(isOwner('UTENTE_AZIENDA')).toBe(false);
    expect(isOwner('ADMIN_PIATTAFORMA')).toBe(false);
    expect(isOwner(undefined)).toBe(false);
  });
});
