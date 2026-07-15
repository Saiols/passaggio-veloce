import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } }) }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const findUnique = vi.fn();
const update = vi.fn();
const promoFindUnique = vi.fn();
const redemptionCount = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: {
    crmContact: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
    promoCode: { findUnique: (...a: unknown[]) => promoFindUnique(...a) },
    promoCodeRedemption: { count: (...a: unknown[]) => redemptionCount(...a) },
  },
}));

const sendNotification = vi.fn();
vi.mock('@/lib/notifiche', () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }));

import { sendEmailPartenzaAction } from './actions';

describe('sendEmailPartenzaAction', () => {
  beforeEach(() => {
    findUnique.mockReset(); update.mockReset(); sendNotification.mockReset();
    promoFindUnique.mockReset(); redemptionCount.mockReset();
  });

  it('errore se il contatto non ha email', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: null, emailOptOutAt: null });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('email') });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errore se il lead è disiscritto', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: new Date() });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('disiscritto') });
  });

  it('happy path senza codice: invia, avanza a S4, salva token', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'AGENZIA', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    update.mockResolvedValue({});
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario Rossi' });
    expect(res).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const upd = update.mock.calls[0][0].data;
    expect(upd.linkInviato).toBe(true);
    expect(upd.status).toBe('S4');
    expect(upd.invitoToken).toBeTruthy();
    expect(upd.emailUnsubToken).toBeTruthy();
  });

  it('codice non più valido → errore, nessun invio', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    promoFindUnique.mockResolvedValue({ id: 'p1', code: 'OLD', amountCent: 5000, active: false, expiresAt: null, maxRedemptions: null });
    redemptionCount.mockResolvedValue(0);
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', promoCodeId: 'p1' });
    expect(res.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
