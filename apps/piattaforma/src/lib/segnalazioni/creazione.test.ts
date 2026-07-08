import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, getSessionContextMock } = vi.hoisted(() => ({
  prismaMock: {
    segnalazioneCreazione: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    documento: { createMany: vi.fn() },
    pratica: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`__REDIRECT__:${u}`); }) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([{ email: 'a@pv.it', userId: 'adm' }])),
}));
vi.mock('@/lib/providers/storage', () => ({ getStorage: () => ({ name: 'vercel-blob' }) }));

import { buildDatiSnapshot, documentiDaBlobRefs } from './snapshot';
import { inviaSegnalazioneCreazioneAction, gestisciSegnalazioneCreazioneAction } from './creazione';

const BROKER = 'br-1';
const SEDE = 'sede-1';
const REFS = {
  LIBRETTO_1_FRONTE: { key: 'k1', name: 'libretto.jpg', size: 111, type: 'image/jpeg' },
};

function brokerSession(): void {
  authMock.mockResolvedValue({ user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' } });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: BROKER, isOwner: false,
    accessibleSedi: [{ id: SEDE, nome: 'Mia', type: 'DEALER' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE, nome: 'Mia', type: 'DEALER' } },
    scopeIds: [SEDE], membershipRuoli: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.segnalazioneCreazione.create.mockResolvedValue({ id: 'seg1' });
  prismaMock.documento.createMany.mockResolvedValue({ count: 1 });
});

describe('buildDatiSnapshot', () => {
  it('include gli allegati come mappa slot→file', () => {
    const snap = buildDatiSnapshot({ tipo: 'SEMPLICE' }, REFS) as Record<string, unknown>;
    expect(snap.allegati).toEqual([
      { slot: 'LIBRETTO_1_FRONTE', filename: 'libretto.jpg', mimeType: 'image/jpeg' },
    ]);
  });
});

describe('documentiDaBlobRefs', () => {
  it('una riga per blobRef, tipo ALTRO, campi dal ref', () => {
    const docs = documentiDaBlobRefs(REFS, { userId: 'u1', storageProvider: 'vercel-blob' });
    expect(docs).toEqual([
      {
        tipo: 'ALTRO',
        storageKey: 'k1',
        storageProvider: 'vercel-blob',
        mimeType: 'image/jpeg',
        sizeBytes: 111,
        originalFilename: 'libretto.jpg',
        uploadedById: 'u1',
      },
    ]);
  });
});

describe('inviaSegnalazioneCreazioneAction', () => {
  const base = { step: 1, tipo: 'LETTURA_DATI' as const, datiGrezzi: { tipo: 'SEMPLICE' }, blobRefs: REFS };

  it('rifiuta descrizione troppo corta (nessuna scrittura)', async () => {
    brokerSession();
    const res = await inviaSegnalazioneCreazioneAction({ ...base, descrizione: 'corta' });
    expect(res.ok).toBe(false);
    expect(prismaMock.segnalazioneCreazione.create).not.toHaveBeenCalled();
  });

  it('crea la segnalazione e i documenti, NON crea una Pratica', async () => {
    brokerSession();
    const res = await inviaSegnalazioneCreazioneAction({
      ...base,
      descrizione: 'La targa del libretto è stata letta male dall OCR',
    });
    expect(res).toEqual({ ok: true, id: 'seg1' });
    expect(prismaMock.segnalazioneCreazione.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.documento.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  it('rifiuta un non-broker (agenzia)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', companyId: 'ag', companyType: 'AGENZIA', role: 'OPERATORE' } });
    getSessionContextMock.mockResolvedValue({ companyId: 'ag', isOwner: false, accessibleSedi: [], currentSede: null, scopeIds: [], membershipRuoli: {}, user: {} });
    const res = await inviaSegnalazioneCreazioneAction({ ...base, descrizione: 'x'.repeat(25) });
    expect(res.ok).toBe(false);
    expect(prismaMock.segnalazioneCreazione.create).not.toHaveBeenCalled();
  });
});

describe('gestisciSegnalazioneCreazioneAction', () => {
  it('rifiuta un non-admin (nessuna mutazione)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'OPERATORE', companyType: 'DEALER' } });
    const res = await gestisciSegnalazioneCreazioneAction('seg1', 'La targa corretta è AB123CD');
    expect(res.ok).toBe(false);
    expect(prismaMock.segnalazioneCreazione.update).not.toHaveBeenCalled();
  });

  it('admin: marca GESTITA, invia email al broker', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.segnalazioneCreazione.findUnique.mockResolvedValue({
      id: 'seg1', stato: 'APERTA', userId: 'u1',
      user: { email: 'broker@x.it', nome: 'Mario' },
    });
    prismaMock.segnalazioneCreazione.update.mockResolvedValue({});
    const res = await gestisciSegnalazioneCreazioneAction('seg1', 'La targa corretta è AB123CD');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.segnalazioneCreazione.update).toHaveBeenCalledTimes(1);
    const arg = prismaMock.segnalazioneCreazione.update.mock.calls[0][0];
    expect(arg.data.stato).toBe('GESTITA');
    expect(arg.data.notaGestione).toContain('AB123CD');
  });

  it('rifiuta nota vuota', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    const res = await gestisciSegnalazioneCreazioneAction('seg1', '   ');
    expect(res.ok).toBe(false);
  });
});
