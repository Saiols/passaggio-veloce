import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txMock } = vi.hoisted(() => ({ txMock: vi.fn() }));
vi.mock('@pv/db', () => ({
  prisma: { $transaction: txMock, company: {}, user: {}, verificationToken: {} },
  Prisma: { PrismaClientKnownRequestError: class {} },
}));
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
vi.mock('@/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/env', () => ({ env: { DEMO_MODE: true } }));
vi.mock('next/headers', () => ({ headers: async () => new Map() }));
vi.mock('@/lib/crm/sync', () => ({ tryMatchCrmContact: vi.fn() }));
vi.mock('@/lib/affiliazione/notifications', () => ({ notifyReferralSignup: vi.fn() }));
vi.mock('@/lib/providers/storage', () => ({ getStorage: vi.fn() }));
vi.mock('@/lib/providers/registro-imprese', () => ({ getRegistroImprese: vi.fn() }));

import { registerAction } from './actions';

const validPayload = {
  account: {
    email: 'mario@example.com',
    password: 'Password123',
    passwordConfirm: 'Password123',
    nome: 'Mario',
    cognome: 'Rossi',
    codiceFiscale: 'RSSMRA80A01H501U',
    dataNascita: '1980-01-01',
    luogoNascita: 'Roma',
  },
  company: {
    type: 'DEALER',
    ragioneSociale: 'Rossi Auto',
    partitaIva: '12345678901',
    pec: 'rossi@pec.it',
    email: 'info@rossi.it',
    indirizzo: 'Via Roma 1',
    citta: 'Roma',
    cap: '00100',
    provincia: 'RM',
  },
  payment: { iban: 'IT60X0542811101000000123456', sepaMandateAccepted: true, termsAccepted: true },
  visuraData: '2026-05-01',
};

function makeFile(): File {
  return new File([new Uint8Array(200 * 1024)], 'doc.pdf', { type: 'application/pdf' });
}

function fdWith(payload: unknown, opts: { omit?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('payload', JSON.stringify(payload));
  for (const slot of ['CI_FRONTE', 'CI_RETRO', 'CODICE_FISCALE', 'VISURA_CAMERALE']) {
    if (opts.omit === slot) continue;
    fd.set(slot, makeFile());
  }
  return fd;
}

describe('registerAction (early returns)', () => {
  beforeEach(() => txMock.mockReset());

  it('fallisce se manca il payload', async () => {
    const r = await registerAction(new FormData());
    expect(r.ok).toBe(false);
    expect(txMock).not.toHaveBeenCalled();
  });

  it('fallisce se manca un documento', async () => {
    const r = await registerAction(fdWith(validPayload, { omit: 'CODICE_FISCALE' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
    expect(txMock).not.toHaveBeenCalled();
  });

  it('fallisce se la visura è scaduta (> 6 mesi)', async () => {
    const r = await registerAction(fdWith({ ...validPayload, visuraData: '2020-01-01' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6 mesi');
    expect(txMock).not.toHaveBeenCalled();
  });
});
