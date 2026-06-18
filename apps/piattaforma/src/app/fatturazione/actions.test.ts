import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({
  prisma: { documentoFiscale: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@pv/db';
import { segnaTrasmessoSdiAction } from './actions';

const findUnique = vi.mocked(prisma.documentoFiscale.findUnique);
const update = vi.mocked(prisma.documentoFiscale.update);

// Documento DOC_BROKER con XML, posseduto (da emittente) dalla company 'c1'.
const doc = { id: 'doc1', fatturaPaTipo: 'TD06', emittenteCompanyId: 'c1', trasmessoSdiAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUnique.mockResolvedValue(doc as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update.mockResolvedValue({} as any);
});

describe('segnaTrasmessoSdiAction (azione admin: segna "gestito dal commercialista")', () => {
  it('un non-admin (anche se emittente del documento) non può segnarlo', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'DEALER', companyId: 'c1' } });
    const r = await segnaTrasmessoSdiAction('doc1');
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('l’admin segna il documento: update con timestamp + id admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });
    const r = await segnaTrasmessoSdiAction('doc1');
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    const arg = update.mock.calls[0][0] as { data: { trasmessoSdiAt: Date; trasmessoSdiBy: string } };
    expect(arg.data.trasmessoSdiBy).toBe('admin1');
    expect(arg.data.trasmessoSdiAt).toBeInstanceOf(Date);
  });

  it('documento senza emissione fiscale (fatturaPaTipo null) → rifiutato', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique.mockResolvedValue({ ...doc, fatturaPaTipo: null } as any);
    const r = await segnaTrasmessoSdiAction('doc1');
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('idempotente: se già segnato non ri-aggiorna', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique.mockResolvedValue({ ...doc, trasmessoSdiAt: new Date() } as any);
    const r = await segnaTrasmessoSdiAction('doc1');
    expect(r.ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
