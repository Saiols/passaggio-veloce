import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { user: { findFirst: vi.fn() } },
}));

// Solo `prisma` è mockato: `Prisma` resta quello vero, altrimenti
// `instanceof PrismaClientKnownRequestError` sarebbe sempre false.
vi.mock('@pv/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: prismaMock };
});

import { Prisma } from '@pv/db';
import {
  normalizzaEmail,
  emailGiaInUso,
  isViolazioneEmailUnica,
  scriviUtente,
} from './email-univoca';

function p2002(target: string[] | string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

beforeEach(() => {
  prismaMock.user.findFirst.mockReset();
  prismaMock.user.findFirst.mockResolvedValue(null);
});

describe('normalizzaEmail', () => {
  it('taglia gli spazi e abbassa le maiuscole', () => {
    expect(normalizzaEmail('  Mario@Example.COM ')).toBe('mario@example.com');
  });
});

describe('emailGiaInUso', () => {
  it('cerca su TUTTA la piattaforma: nessun filtro companyId, nessun filtro deletedAt', async () => {
    await emailGiaInUso('mario@example.com');

    const where = prismaMock.user.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ email: 'mario@example.com' });
    // Espliciti, perché sono le due esclusioni volute dalla spec:
    expect(where).not.toHaveProperty('companyId');
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('true quando esiste un utente con quella email', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u1' });
    expect(await emailGiaInUso('mario@example.com')).toBe(true);
  });

  it('false quando non esiste nessuno', async () => {
    expect(await emailGiaInUso('nuovo@example.com')).toBe(false);
  });

  it('escludiUserId esclude se stessi dal confronto', async () => {
    await emailGiaInUso('mario@example.com', { escludiUserId: 'u1' });

    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toEqual({
      email: 'mario@example.com',
      NOT: { id: 'u1' },
    });
  });
});

describe('isViolazioneEmailUnica', () => {
  it('riconosce il target come array di campi', () => {
    expect(isViolazioneEmailUnica(p2002(['email']))).toBe(true);
  });

  it('riconosce il target come nome dell indice', () => {
    expect(isViolazioneEmailUnica(p2002('users_email_key'))).toBe(true);
  });

  it('NON scatta sulla P.IVA', () => {
    expect(isViolazioneEmailUnica(p2002(['partitaIva']))).toBe(false);
  });

  it('NON scatta su crm_contacts_emailUnsubToken_key (il nome contiene "email")', () => {
    // Trappola reale: un match generico su /email/ classificherebbe male
    // questo indice, che esiste davvero sul DB.
    expect(isViolazioneEmailUnica(p2002('crm_contacts_emailUnsubToken_key'))).toBe(false);
    expect(isViolazioneEmailUnica(p2002(['emailUnsubToken']))).toBe(false);
  });

  it('false su altri codici Prisma e su errori qualunque', () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
    expect(isViolazioneEmailUnica(p2025)).toBe(false);
    expect(isViolazioneEmailUnica(new Error('boom'))).toBe(false);
    expect(isViolazioneEmailUnica(null)).toBe(false);
  });
});

describe('scriviUtente', () => {
  it('restituisce il valore quando la scrittura riesce', async () => {
    const res = await scriviUtente(async () => ({ id: 'u1' }));
    expect(res).toEqual({ ok: true, value: { id: 'u1' } });
  });

  it('traduce la violazione unique sull email in errore applicativo', async () => {
    const res = await scriviUtente(async () => {
      throw p2002(['email']);
    });
    expect(res).toEqual({
      ok: false,
      error: 'Questa email è già associata a un account Passaggio Veloce',
    });
  });

  it('rilancia qualunque altro errore: non maschera i bug', async () => {
    await expect(
      scriviUtente(async () => {
        throw new Error('connessione persa');
      }),
    ).rejects.toThrow('connessione persa');

    await expect(
      scriviUtente(async () => {
        throw p2002(['partitaIva']);
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
