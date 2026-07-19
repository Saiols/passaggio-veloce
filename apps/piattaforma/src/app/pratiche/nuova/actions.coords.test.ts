import { describe, it, expect, vi } from 'vitest';

/**
 * Distribuzione a raggio-km (R3): il submit deve rifiutare pratiche senza
 * coordinate valide del luogo di consegna. `praticaCoordsSchema` è lo schema
 * riusabile estratto per testare la regola a livello di zod, senza dover
 * costruire l'intero FormData del wizard (schema principale in `submitSchema`,
 * non esportato).
 *
 * `actions.ts` importa `@/auth` (next-auth) e `@pv/db` (Prisma) a livello di
 * modulo: come in `actions.authz.test.ts`, questi vanno mockati PRIMA
 * dell'import altrimenti l'import reale di next-auth rompe la risoluzione dei
 * moduli in questo ambiente di test (indipendente dal nostro schema).
 */
vi.mock('@pv/db', () => ({ prisma: {}, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { praticaCoordsSchema } from './actions';

describe('coordinate obbligatorie al submit', () => {
  it('accetta lat/lng validi (stringa da FormData)', () => {
    const r = praticaCoordsSchema.safeParse({ lat: '45.4642', lng: '9.19' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ lat: 45.4642, lng: 9.19 });
  });

  it('rifiuta lat/lng mancanti', () => {
    expect(praticaCoordsSchema.safeParse({}).success).toBe(false);
  });

  it('rifiuta valori fuori range', () => {
    expect(praticaCoordsSchema.safeParse({ lat: '999', lng: '9' }).success).toBe(false);
  });
});
