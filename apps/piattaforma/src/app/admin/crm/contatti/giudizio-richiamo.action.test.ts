import { describe, it, expect, vi, beforeEach } from 'vitest';

const { crmContactMock } = vi.hoisted(() => ({
  crmContactMock: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@pv/db', () => ({ prisma: { crmContact: crmContactMock }, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  canEditCrmContact: () => true,
  canDeleteCrmContact: () => true,
  canBulkImportCrm: () => true,
  canViewCrm: () => true,
}));

import { auth } from '@/auth';
import { updateCrmContactGiudizioAction, updateCrmContactRichiamoAction } from './actions';

const authMock = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN_PIATTAFORMA' } } as never);
  crmContactMock.update.mockResolvedValue({ id: 'x1' });
});

describe('updateCrmContactGiudizioAction', () => {
  it('scrive solo il giudizio', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    const res = await updateCrmContactGiudizioAction('x1', 'INTERESSATO');
    expect(res.ok).toBe(true);
    expect(crmContactMock.update.mock.calls[0][0].data).toEqual({ giudizio: 'INTERESSATO' });
  });
  it('null azzera il giudizio', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactGiudizioAction('x1', null);
    expect(crmContactMock.update.mock.calls[0][0].data).toEqual({ giudizio: null });
  });
  it('SALES su contatto altrui: rifiuto senza scrivere', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', role: 'SALES' } } as never);
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: 'altro' });
    const res = await updateCrmContactGiudizioAction('x1', 'INTERESSATO');
    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });
});

describe('updateCrmContactRichiamoAction', () => {
  it('imposta nextContactAt e fascia, senza toccare status', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactRichiamoAction('x1', { giorno: '2026-08-04', fascia: 'MATTINA' });
    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toEqual(new Date('2026-08-04'));
    expect(data.nextContactFascia).toBe('MATTINA');
    expect(data.status).toBeUndefined();
  });
  it('fascia vuota → null', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactRichiamoAction('x1', { giorno: '2026-08-04', fascia: '' });
    expect(crmContactMock.update.mock.calls[0][0].data.nextContactFascia).toBeNull();
  });
  it('null rimuove il richiamo', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactRichiamoAction('x1', null);
    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });
  it('giorno in formato errato viene rifiutato', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    const res = await updateCrmContactRichiamoAction('x1', { giorno: '04/08/2026', fascia: '' });
    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });
});
