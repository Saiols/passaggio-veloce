import { describe, it, expect, vi, beforeEach } from 'vitest';

const notificaFindFirst = vi.fn();
const notificaUpdate = vi.fn();
const contactFindUnique = vi.fn();
const contactUpdate = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    notificaInviata: {
      findFirst: (...a: unknown[]) => notificaFindFirst(...a),
      update: (...a: unknown[]) => notificaUpdate(...a),
    },
    crmContact: {
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
  },
}));

import { handleResendEvent } from './resend-webhook';

const opened = (tags: Record<string, string> = { categoria: 'N26_EMAIL_PARTENZA' }) => ({
  type: 'email.opened',
  data: { email_id: 'em-1', tags },
});

const bounced = (subType: string) => ({
  type: 'email.bounced',
  data: {
    email_id: 'em-1',
    tags: { categoria: 'N26_EMAIL_PARTENZA' },
    bounce: { subType, message: 'mailbox unavailable' },
  },
});

describe('handleResendEvent', () => {
  beforeEach(() => {
    notificaFindFirst.mockReset();
    notificaUpdate.mockReset();
    contactFindUnique.mockReset();
    contactUpdate.mockReset();
    notificaFindFirst.mockResolvedValue({ id: 'n1', crmContactId: 'c1', readAt: null });
    contactFindUnique.mockResolvedValue({ id: 'c1', mailApertaAt: null });
    contactUpdate.mockResolvedValue({});
    notificaUpdate.mockResolvedValue({});
  });

  it('email.opened accende mailAperta e fissa la data', async () => {
    await handleResendEvent(opened());
    const data = contactUpdate.mock.calls[0][0].data;
    expect(data.mailAperta).toBe(true);
    expect(data.mailApertaAt).toBeInstanceOf(Date);
  });

  // Svix ritenta finché non riceve 200: lo stesso evento arriva più volte.
  it('una seconda apertura non sposta la data della prima', async () => {
    const prima = new Date('2026-08-01T09:00:00Z');
    contactFindUnique.mockResolvedValue({ id: 'c1', mailApertaAt: prima });
    await handleResendEvent(opened());
    expect(contactUpdate.mock.calls[0][0].data.mailApertaAt).toEqual(prima);
  });

  // La garanzia anti-contaminazione: una mail transazionale aperta da una
  // persona che è anche un contatto CRM non deve sporcare il funnel.
  it("ignora le email che non sono l'email di partenza", async () => {
    await handleResendEvent(opened({ categoria: 'N3_PRATICA_ACCETTATA' }));
    expect(notificaFindFirst).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('ignora i tipi di evento non gestiti', async () => {
    await handleResendEvent({ type: 'email.delivered', data: { email_id: 'em-1' } });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('bounce soft: registrato ma nessun blocco', async () => {
    await handleResendEvent(bounced('soft'));
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("bounce hard: blocca l'indirizzo con il motivo", async () => {
    await handleResendEvent(bounced('hard'));
    const data = contactUpdate.mock.calls[0][0].data;
    expect(data.emailBouncedAt).toBeInstanceOf(Date);
    expect(data.emailBounceMotivo).toBe('mailbox unavailable');
  });

  it('providerRef sconosciuto: nessuna scrittura, nessuna eccezione', async () => {
    notificaFindFirst.mockResolvedValue(null);
    await expect(handleResendEvent(opened())).resolves.toBeUndefined();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('payload malformato: non lancia', async () => {
    await expect(handleResendEvent(null)).resolves.toBeUndefined();
    await expect(handleResendEvent({ type: 'email.opened' })).resolves.toBeUndefined();
  });
});
