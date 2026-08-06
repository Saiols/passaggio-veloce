import { describe, it, expect, vi, beforeEach } from 'vitest';

// `next-auth` importa `next/server` in un modo che il resolver di Vitest su
// questo repo non risolve (vedi actions.test.ts, stesso mock): senza,
// l'import di actions.ts fallisce prima ancora di arrivare ai nostri test.
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
vi.mock('@/auth', () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/rate-limit/durable', () => ({
  rateLimit: () => Promise.resolve({ allowed: true }),
  resetRateLimit: () => Promise.resolve(),
}));
vi.mock('@/lib/rate-limit/client-ip', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/auth/email-univoca', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  emailGiaInUso: () => Promise.resolve(false),
}));

const updateMany = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: { crmContact: { updateMany: (...a: unknown[]) => updateMany(...a) } },
}));

import { checkEmailDisponibileAction } from './actions';

describe('checkEmailDisponibileAction — accende iscrizioneInit', () => {
  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('marca il contatto CRM corrispondente', async () => {
    const res = await checkEmailDisponibileAction('Mario@Rossi.IT');
    expect(res).toEqual({ disponibile: true });
    const args = updateMany.mock.calls[0][0];
    expect(args.where.emailNorm).toBe('mario@rossi.it');
    expect(args.where.iscrizioneComp).toBe(false);
    expect(args.where.deletedAt).toBeNull();
    // "Vince la prima data": chi ce l'ha già non deve nemmeno matchare.
    expect(args.where.iscrizioneInitAt).toBeNull();
    expect(args.data.iscrizioneInit).toBe(true);
    expect(args.data.iscrizioneInitAt).toBeInstanceOf(Date);
  });

  // Il CRM è un effetto collaterale: se cade, la registrazione prosegue.
  it("se il CRM lancia, l'action risponde comunque", async () => {
    updateMany.mockRejectedValue(new Error('db giù'));
    await expect(checkEmailDisponibileAction('mario@rossi.it')).resolves.toEqual({
      disponibile: true,
    });
  });

  it('email malformata: nessuna scrittura', async () => {
    await checkEmailDisponibileAction('');
    expect(updateMany).not.toHaveBeenCalled();
  });
});
