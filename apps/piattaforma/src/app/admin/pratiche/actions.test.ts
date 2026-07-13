import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, firmaPraticaCoreMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  firmaPraticaCoreMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/pratiche/firma-engine', () => ({ firmaPraticaCore: firmaPraticaCoreMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { attestaFirmaAdminAction } from './actions';

const MOTIVO = 'Confermato per telefono col cliente, agenzia irreperibile';

beforeEach(() => {
  vi.clearAllMocks();
  firmaPraticaCoreMock.mockResolvedValue({ ok: true });
});

describe('attestaFirmaAdminAction — gate ADMIN_PIATTAFORMA (Termini art. 11)', () => {
  it("ASSISTENTE → rifiutato, il motore NON viene chiamato (nessuna leva finanziaria all'Assistente)", async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ASSISTENTE' } });

    const res = await attestaFirmaAdminAction('p1', MOTIVO);

    expect(res).toEqual({ ok: false, error: 'Non autorizzato' });
    expect(firmaPraticaCoreMock).not.toHaveBeenCalled();
  });

  it('ADMIN_AZIENDA (utente azienda cliente) → rifiutato, il motore NON viene chiamato', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA', companyId: 'c1' } });

    const res = await attestaFirmaAdminAction('p1', MOTIVO);

    expect(res).toEqual({ ok: false, error: 'Non autorizzato' });
    expect(firmaPraticaCoreMock).not.toHaveBeenCalled();
  });

  it('nessuna sessione → rifiutato, il motore NON viene chiamato', async () => {
    authMock.mockResolvedValue(null);

    const res = await attestaFirmaAdminAction('p1', MOTIVO);

    expect(res).toEqual({ ok: false, error: 'Non autorizzato' });
    expect(firmaPraticaCoreMock).not.toHaveBeenCalled();
  });

  it('ADMIN_PIATTAFORMA con motivazione valida → chiama il motore con { tipo: ADMIN, motivo }', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });

    const res = await attestaFirmaAdminAction('p1', MOTIVO);

    expect(firmaPraticaCoreMock).toHaveBeenCalledTimes(1);
    expect(firmaPraticaCoreMock).toHaveBeenCalledWith('p1', { tipo: 'ADMIN', motivo: MOTIVO });
    expect(res).toEqual({ ok: true });
  });

  it('ADMIN_PIATTAFORMA con motivazione vuota → rifiutato, il motore NON viene chiamato', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });

    const res = await attestaFirmaAdminAction('p1', '');

    expect(res).toEqual({ ok: false, error: 'La motivazione è obbligatoria' });
    expect(firmaPraticaCoreMock).not.toHaveBeenCalled();
  });

  it('ADMIN_PIATTAFORMA con motivazione di soli spazi → rifiutato, il motore NON viene chiamato', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });

    const res = await attestaFirmaAdminAction('p1', '   \n  ');

    expect(res).toEqual({ ok: false, error: 'La motivazione è obbligatoria' });
    expect(firmaPraticaCoreMock).not.toHaveBeenCalled();
  });

  it('il motore ritorna ok:false → la action propaga l\'errore e NON invalida la cache', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });
    firmaPraticaCoreMock.mockResolvedValue({ ok: false, error: 'Pratica non trovata' });

    const res = await attestaFirmaAdminAction('p1', MOTIVO);

    expect(res).toEqual({ ok: false, error: 'Pratica non trovata' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('successo → invalida /admin/pratiche e /pratiche/:id', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN_PIATTAFORMA' } });

    const res = await attestaFirmaAdminAction('p1', MOTIVO);

    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/pratiche');
    expect(revalidatePath).toHaveBeenCalledWith('/pratiche/p1');
  });
});
