import { describe, it, expect, vi, beforeEach } from 'vitest';

const { crmContactMock } = vi.hoisted(() => ({
  crmContactMock: { deleteMany: vi.fn() },
}));
vi.mock('@pv/db', () => ({ prisma: { crmContact: crmContactMock }, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  canEditCrmContact: () => true,
  canDeleteCrmContact: (role: string) => role !== 'SALES',
  canBulkImportCrm: () => true,
  canViewCrm: () => true,
}));

import { auth } from '@/auth';
import { bulkHardDeleteCrmContactsAction } from './actions';
const authMock = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN_PIATTAFORMA' } } as never);
  crmContactMock.deleteMany.mockResolvedValue({ count: 3 });
});

describe('bulkHardDeleteCrmContactsAction', () => {
  it('modo ids: deleteMany con gli id passati', async () => {
    const res = await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids: ['a', 'b', 'c'] });
    expect(res).toEqual({ ok: true, eliminati: 3 });
    expect(crmContactMock.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b', 'c'] } } });
  });
  it('modo ids vuoto: nessuna delete', async () => {
    const res = await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids: [] });
    expect(res).toEqual({ ok: true, eliminati: 0 });
    expect(crmContactMock.deleteMany).not.toHaveBeenCalled();
  });
  it('modo filtro: applica whereContatti + notIn escludi', async () => {
    await bulkHardDeleteCrmContactsAction({
      modo: 'filtro',
      filtro: { adesso: '2026-08-01T00:00:00.000Z', cat: 'AGENZIA' },
      escludi: ['keep1'],
    });
    const where = crmContactMock.deleteMany.mock.calls[0][0].where;
    expect(where.cat).toBe('AGENZIA');
    expect(where.id).toEqual({ notIn: ['keep1'] });
  });
  it('SALES non autorizzato', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', role: 'SALES' } } as never);
    const res = await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids: ['a'] });
    expect(res.ok).toBe(false);
    expect(crmContactMock.deleteMany).not.toHaveBeenCalled();
  });
});
