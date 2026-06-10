import { describe, it, expect } from 'vitest';
import { tierForRole } from './tier';

describe('tierForRole', () => {
  it('nessun ruolo → public', () => {
    expect(tierForRole(null)).toBe('public');
    expect(tierForRole(undefined)).toBe('public');
  });

  it('ruoli azienda/assistente → clients', () => {
    expect(tierForRole('ADMIN_AZIENDA')).toBe('clients');
    expect(tierForRole('UTENTE_AZIENDA')).toBe('clients');
    expect(tierForRole('ASSISTENTE')).toBe('clients');
  });

  it('ruoli staff interno → internal', () => {
    for (const r of ['ADMIN_PIATTAFORMA', 'AD', 'CTO', 'CFO', 'SALES_MANAGER', 'SALES']) {
      expect(tierForRole(r)).toBe('internal');
    }
  });

  it('ruolo sconosciuto → public (default sicuro)', () => {
    expect(tierForRole('RUOLO_FANTASIOSO')).toBe('public');
  });
});
