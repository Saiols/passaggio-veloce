import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock, buildCatalogoContattiMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    opposizioneCatalogo: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  buildCatalogoContattiMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((u: string) => {
    throw new Error(`__REDIRECT__:${u}`);
  }),
}));
vi.mock('@/lib/catalogo-contatti', () => ({
  buildCatalogoContatti: buildCatalogoContattiMock,
}));

import {
  registraOpposizioneCatalogoAction,
  revocaOpposizioneCatalogoAction,
} from './actions';

const CHIAVE = 'email:mario.rossi@example.com';
const CONTATTO = {
  key: CHIAVE,
  ruolo: 'VENDITORE' as const,
  nominativo: 'Mario Rossi',
  isPersonaGiuridica: false,
  email: 'mario.rossi@example.com',
  telefono: null,
  identificativoFiscale: null,
  numeroPratiche: 1,
  ultimoVistoAt: new Date('2026-07-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  buildCatalogoContattiMock.mockResolvedValue([CONTATTO]);
  prismaMock.opposizioneCatalogo.findUnique.mockResolvedValue(null);
});

describe('registraOpposizioneCatalogoAction — autorizzazione', () => {
  it('ADMIN_PIATTAFORMA → registra', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    const res = await registraOpposizioneCatalogoAction(CHIAVE, 'richiesta del 2026-07-14');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.opposizioneCatalogo.create).toHaveBeenCalledTimes(1);
  });

  it('ASSISTENTE → registra (stesso gate della pagina/export F-05)', async () => {
    authMock.mockResolvedValue({ user: { id: 'ass1', role: 'ASSISTENTE' } });
    const res = await registraOpposizioneCatalogoAction(CHIAVE);
    expect(res).toEqual({ ok: true });
    expect(prismaMock.opposizioneCatalogo.create).toHaveBeenCalledTimes(1);
  });

  it('UTENTE_AZIENDA → negato, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'UTENTE_AZIENDA' } });
    const res = await registraOpposizioneCatalogoAction(CHIAVE);
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.create).not.toHaveBeenCalled();
  });

  it('SALES (ruolo CRM interno, non ammesso su F-05) → negato', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', role: 'SALES' } });
    const res = await registraOpposizioneCatalogoAction(CHIAVE);
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.create).not.toHaveBeenCalled();
  });
});

describe('registraOpposizioneCatalogoAction — registrataDaId SEMPRE dalla sessione', () => {
  it('ignora qualunque registrataDaId che il client tentasse di forgiare (la firma non lo accetta nemmeno)', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm-vero', role: 'ADMIN_PIATTAFORMA' } });
    await registraOpposizioneCatalogoAction(CHIAVE);
    const data = prismaMock.opposizioneCatalogo.create.mock.calls[0]![0].data;
    expect(data.registrataDaId).toBe('adm-vero');
  });

  it('il nominativo salvato viene dal catalogo server-side, non da input client', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    await registraOpposizioneCatalogoAction(CHIAVE);
    const data = prismaMock.opposizioneCatalogo.create.mock.calls[0]![0].data;
    expect(data.nominativo).toBe('Mario Rossi');
    expect(data.chiave).toBe(CHIAVE);
  });
});

describe('registraOpposizioneCatalogoAction — validazione', () => {
  it('chiave con formato non valido → errore, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    const res = await registraOpposizioneCatalogoAction('non-una-chiave-valida');
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.create).not.toHaveBeenCalled();
  });

  it('chiave non presente nel catalogo corrente → errore (mai fidarsi ciecamente del client)', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    buildCatalogoContattiMock.mockResolvedValue([]); // contatto non esiste (più)
    const res = await registraOpposizioneCatalogoAction(CHIAVE);
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.create).not.toHaveBeenCalled();
  });

  it('opposizione già attiva sulla stessa chiave → errore, nessun duplicato', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.opposizioneCatalogo.findUnique.mockResolvedValue({
      id: 'opp1',
      revocataAt: null,
    });
    const res = await registraOpposizioneCatalogoAction(CHIAVE);
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.create).not.toHaveBeenCalled();
  });

  it('opposizione esistente ma REVOCATA sulla stessa chiave → riattiva (update, non create)', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm2', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.opposizioneCatalogo.findUnique.mockResolvedValue({
      id: 'opp1',
      revocataAt: new Date('2026-07-10'),
    });
    const res = await registraOpposizioneCatalogoAction(CHIAVE, 'nuova richiesta');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.opposizioneCatalogo.create).not.toHaveBeenCalled();
    expect(prismaMock.opposizioneCatalogo.update).toHaveBeenCalledTimes(1);
    const [args] = prismaMock.opposizioneCatalogo.update.mock.calls[0]!;
    expect(args.where).toEqual({ id: 'opp1' });
    expect(args.data.revocataAt).toBeNull();
    expect(args.data.revocataDaId).toBeNull();
    expect(args.data.registrataDaId).toBe('adm2');
  });
});

describe('revocaOpposizioneCatalogoAction', () => {
  it('non-admin → negato', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'UTENTE_AZIENDA' } });
    const res = await revocaOpposizioneCatalogoAction('opp1');
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.update).not.toHaveBeenCalled();
  });

  it('id inesistente → errore', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.opposizioneCatalogo.findUnique.mockResolvedValue(null);
    const res = await revocaOpposizioneCatalogoAction('opp-inesistente');
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.update).not.toHaveBeenCalled();
  });

  it('già revocata → errore, no doppia scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm1', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.opposizioneCatalogo.findUnique.mockResolvedValue({
      id: 'opp1',
      revocataAt: new Date('2026-07-10'),
    });
    const res = await revocaOpposizioneCatalogoAction('opp1');
    expect(res.ok).toBe(false);
    expect(prismaMock.opposizioneCatalogo.update).not.toHaveBeenCalled();
  });

  it('admin → revoca, registra revocataDaId dalla sessione', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm-revoca', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.opposizioneCatalogo.findUnique.mockResolvedValue({
      id: 'opp1',
      revocataAt: null,
    });
    const res = await revocaOpposizioneCatalogoAction('opp1');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.opposizioneCatalogo.update).toHaveBeenCalledTimes(1);
    const [args] = prismaMock.opposizioneCatalogo.update.mock.calls[0]!;
    expect(args.where).toEqual({ id: 'opp1' });
    expect(args.data.revocataAt).toBeInstanceOf(Date);
    expect(args.data.revocataDaId).toBe('adm-revoca');
  });
});
