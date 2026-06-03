import { describe, it, expect } from 'vitest';
import { activeUserCredentialsQuery } from './credentials-query';

/**
 * Test della query condivisa per il login con credenziali. È una funzione pura
 * (nessuna dipendenza da Prisma): verifichiamo che filtro `where` e `orderBy`
 * restino stabili, perché sia il pre-check 2FA in `loginAction` sia `authorize`
 * dipendono da questa forma identica.
 */
describe('activeUserCredentialsQuery', () => {
  it('usa l\'email passata verbatim (il chiamante la normalizza a lowercase)', () => {
    const q = activeUserCredentialsQuery('mario@example.it');
    expect(q.where.email).toBe('mario@example.it');
  });

  it('filtra utenti non eliminati e non sospesi', () => {
    const q = activeUserCredentialsQuery('mario@example.it');
    expect(q.where.deletedAt).toBeNull();
    expect(q.where.status).toEqual({ not: 'SUSPENDED' });
  });

  it('ordina per companyId poi createdAt (l\'ordine conta: companyId per primo)', () => {
    const q = activeUserCredentialsQuery('mario@example.it');
    expect(q.orderBy).toEqual([{ companyId: 'asc' }, { createdAt: 'asc' }]);
  });
});
