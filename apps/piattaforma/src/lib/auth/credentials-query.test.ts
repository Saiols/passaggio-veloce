import { describe, it, expect } from 'vitest';
import { activeUserCredentialsQuery } from './credentials-query';

/**
 * Test della query condivisa per il login con credenziali. È una funzione pura
 * (nessuna dipendenza da Prisma): verifichiamo che il filtro `where` resti
 * stabile, perché sia il pre-check 2FA in `loginAction` sia `authorize`
 * dipendono da questa forma identica (entrambi con `findFirst`, email
 * univoca: al più un record può combaciare).
 */
describe('activeUserCredentialsQuery', () => {
  it('usa l\'email passata verbatim (il chiamante la normalizza a lowercase)', () => {
    const q = activeUserCredentialsQuery('mario@example.it');
    expect(q.where.email).toBe('mario@example.it');
  });

  it('filtra utenti non eliminati e SOLO attivi (gate verifica email)', () => {
    // Solo ACTIVE: un account PENDING_EMAIL_VERIFICATION (email non confermata)
    // o SUSPENDED non deve poter autenticarsi. La regressione a `{ not:
    // 'SUSPENDED' }` riaprirebbe il login ai PENDING.
    const q = activeUserCredentialsQuery('mario@example.it');
    expect(q.where.deletedAt).toBeNull();
    expect(q.where.status).toBe('ACTIVE');
  });
});
