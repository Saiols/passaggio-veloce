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

  const MSG = 'Testo di prova.';

  it('errore se il contatto non ha email', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: null, emailOptOutAt: null });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: MSG });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('email') });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errore se il lead è disiscritto', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: new Date() });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: MSG });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('disiscritto') });
  });

  it('errore se il messaggio è vuoto: nessun invio', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: '   ' });
    expect(res.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('happy path senza codice: invia, avanza a S4, salva token', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'AGENZIA', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    update.mockResolvedValue({});
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario Rossi', messaggio: '  Ciao, ecco il link.  ' });
    expect(res).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    // il messaggio (trim) finisce nel payload della notifica
    expect(sendNotification.mock.calls[0][0].payload.messaggio).toBe('Ciao, ecco il link.');
    const upd = update.mock.calls[0][0].data;
    expect(upd.linkInviato).toBe(true);
    expect(upd.status).toBe('S4');
    expect(upd.invitoToken).toBeTruthy();
    expect(upd.emailUnsubToken).toBeTruthy();
  });

  // Regressione (review finale): i link dell'email DEVONO usare NEXT_PUBLIC_APP_URL
  // (host dell'app raggiungibile), MAI il dominio marketing passaggioveloce.it che è
  // in GATED_HOSTS — lì il lead anonimo verrebbe rimbalzato alla vetrina. In test
  // NEXT_PUBLIC_APP_URL non è settato → default http://localhost:3000.
  it('i link puntano all\'host app, non al dominio marketing gated', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    update.mockResolvedValue({});
    await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: MSG });
    const { linkUrl, unsubUrl } = sendNotification.mock.calls[0][0].payload;
    expect(linkUrl).not.toContain('passaggioveloce.it');
    expect(unsubUrl).not.toContain('passaggioveloce.it');
    expect(linkUrl).toMatch(/^http:\/\/localhost:3000\/i\//);
    expect(unsubUrl).toMatch(/^http:\/\/localhost:3000\/unsubscribe\?token=/);
  });

  // Invariante GDPR: al reinvio l'emailUnsubToken esistente NON va rigenerato,
  // altrimenti il link di disiscrizione nelle email precedenti muore.
  it('reinvio: riusa l\'emailUnsubToken esistente (link unsub stabile)', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S4', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: 'tok-stabile-123' });
    update.mockResolvedValue({});
    await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: MSG });
    expect(update.mock.calls[0][0].data.emailUnsubToken).toBe('tok-stabile-123');
    expect(sendNotification.mock.calls[0][0].payload.unsubUrl).toContain('tok-stabile-123');
  });

  it('codice non più valido → errore, nessun invio', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    promoFindUnique.mockResolvedValue({ id: 'p1', code: 'OLD', amountCent: 5000, active: false, expiresAt: null, maxRedemptions: null });
    redemptionCount.mockResolvedValue(0);
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: MSG, promoCodeId: 'p1' });
    expect(res.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
