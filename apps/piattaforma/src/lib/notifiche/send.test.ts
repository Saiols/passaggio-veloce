import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Fix round 1 (review Task 3): `email-partenza.action.test.ts` mocka
 * `sendNotification` per intero, quindi dimostra solo che il chiamante passa
 * `{ crmContactId }` come secondo argomento — mai che `send.ts` lo scrive
 * davvero su `NotificaInviata`. Qui `@pv/db` è mockato (per catturare gli
 * argomenti di `notificaInviata.create`) e il provider email pure, ma
 * `sendNotification` è il modulo reale sotto test.
 */

const { createMock, updateMock, emailSendMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  emailSendMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  // Usato solo come tipo (`Prisma.InputJsonValue`) in send.ts: nessun valore
  // a runtime serve davvero, stesso placeholder di email-partenza.action.test.ts.
  Prisma: {},
  prisma: {
    notificaInviata: { create: createMock, update: updateMock },
  },
}));
vi.mock('@/lib/providers/email', () => ({ getEmail: () => ({ send: emailSendMock }) }));

import { sendNotification } from './send';

// N26_EMAIL_PARTENZA: unico tipo che non richiede target.userId né opts.praticaId,
// quindi salta sia il gating preferenze (prisma.user) sia il blocco "Sede della
// firma" (prisma.pratica) — il minimo indispensabile per isolare la scrittura
// su NotificaInviata senza un'impalcatura di mock sproporzionata.
const PAYLOAD = {
  nomeReferente: 'Mario',
  messaggio: 'Ciao, ecco il link.',
  categoria: 'BROKER' as const,
  linkUrl: 'http://localhost:3000/i/tok',
  unsubUrl: 'http://localhost:3000/unsubscribe?token=tok',
};

describe('sendNotification — persistenza crmContactId (NotificaInviata)', () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
    emailSendMock.mockReset();
    createMock.mockResolvedValue({ id: 'n1' });
    updateMock.mockResolvedValue({});
    emailSendMock.mockResolvedValue({ ok: true, messageId: 'msg-1' });
  });

  it('opts.crmContactId finisce su data.crmContactId nella create', async () => {
    await sendNotification(
      { tipo: 'N26_EMAIL_PARTENZA', target: { email: 'x@y.it' }, payload: PAYLOAD },
      { crmContactId: 'c1' },
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0].data.crmContactId).toBe('c1');
  });

  // Inchioda il fallback `?? null`: senza opts (o senza crmContactId dentro
  // opts) la colonna deve essere esplicitamente null, non undefined — è quel
  // valore che il webhook Resend (Task 8) vedrà per le notifiche non legate
  // a un contatto CRM.
  it('senza opts, data.crmContactId è null (non undefined)', async () => {
    await sendNotification({ tipo: 'N26_EMAIL_PARTENZA', target: { email: 'x@y.it' }, payload: PAYLOAD });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0].data.crmContactId).toBeNull();
  });
});
