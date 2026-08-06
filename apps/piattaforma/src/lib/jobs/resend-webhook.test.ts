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

// `type` = Permanent | Temporary (definitivo vs ritentabile).
// `subType` viaggia insieme ma è solo la classificazione fine: non decide nulla.
const bounced = (tipo: string) => ({
  type: 'email.bounced',
  data: {
    email_id: 'em-1',
    tags: { categoria: 'N26_EMAIL_PARTENZA' },
    bounce: { type: tipo, subType: 'MessageRejected', message: 'mailbox unavailable' },
  },
});

describe('handleResendEvent', () => {
  beforeEach(() => {
    notificaFindFirst.mockReset();
    notificaUpdate.mockReset();
    contactFindUnique.mockReset();
    contactUpdate.mockReset();
    notificaFindFirst.mockResolvedValue({
      id: 'n1',
      crmContactId: 'c1',
      readAt: null,
      destinazione: 'em-1@example.it',
    });
    contactFindUnique.mockResolvedValue({ id: 'c1', mailApertaAt: null, email: 'em-1@example.it' });
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

  it('bounce temporaneo: nessuna scrittura, nessun blocco', async () => {
    await handleResendEvent(bounced('Temporary'));
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("bounce permanente: blocca l'indirizzo con il motivo", async () => {
    await handleResendEvent(bounced('Permanent'));
    const data = contactUpdate.mock.calls[0][0].data;
    expect(data.emailBouncedAt).toBeInstanceOf(Date);
    expect(data.emailBounceMotivo).toBe('mailbox unavailable');
  });

  // Se Resend cambiasse vocabolario, il blocco smetterebbe di funzionare: deve
  // restare fail-safe (nessun blocco) ma NON silenzioso.
  it('bounce con type sconosciuto: nessun blocco', async () => {
    await handleResendEvent(bounced('Qualcosaltro'));
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  // Il bug della review: un "indirizzo aggiuntivo" digitato a mano rimbalza,
  // ma non è l'email del contatto — non deve bloccare il contatto sbagliato.
  it("bounce su un indirizzo aggiuntivo (diverso da quello del contatto): nessun blocco", async () => {
    notificaFindFirst.mockResolvedValue({
      id: 'n1',
      crmContactId: 'c1',
      readAt: null,
      destinazione: 'titolare@personale.it',
    });
    contactFindUnique.mockResolvedValue({
      id: 'c1',
      mailApertaAt: null,
      email: 'em-1@example.it',
    });
    await handleResendEvent(bounced('Permanent'));
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('bounce sull\'indirizzo del contatto con maiuscole diverse: blocca comunque (confronto case-insensitive)', async () => {
    notificaFindFirst.mockResolvedValue({
      id: 'n1',
      crmContactId: 'c1',
      readAt: null,
      destinazione: 'EM-1@Example.it',
    });
    contactFindUnique.mockResolvedValue({
      id: 'c1',
      mailApertaAt: null,
      email: 'em-1@example.it',
    });
    await handleResendEvent(bounced('Permanent'));
    expect(contactUpdate).toHaveBeenCalledTimes(1);
    expect(contactUpdate.mock.calls[0][0].data.emailBouncedAt).toBeInstanceOf(Date);
  });

  it('providerRef sconosciuto: nessuna scrittura, nessuna eccezione', async () => {
    notificaFindFirst.mockResolvedValue(null);
    await expect(handleResendEvent(opened())).resolves.toBeUndefined();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  // L'invariante che impedisce davvero la contaminazione del funnel: una
  // notifica trovata ma senza contatto CRM agganciato non scrive nulla.
  it('notifica trovata ma senza crmContactId: nessuna query sul contatto, nessuna scrittura', async () => {
    notificaFindFirst.mockResolvedValue({ id: 'n1', crmContactId: null, readAt: null });
    await expect(handleResendEvent(opened())).resolves.toBeUndefined();
    expect(contactFindUnique).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('payload malformato: non lancia', async () => {
    await expect(handleResendEvent(null)).resolves.toBeUndefined();
    await expect(handleResendEvent({ type: 'email.opened' })).resolves.toBeUndefined();
  });

  // Il guard che impedisce di scrivere sul contatto SBAGLIATO.
  it('tag giusto ma email_id assente: nessuna query', async () => {
    await handleResendEvent({
      type: 'email.opened',
      data: { tags: { categoria: 'N26_EMAIL_PARTENZA' } },
    });
    expect(notificaFindFirst).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});
