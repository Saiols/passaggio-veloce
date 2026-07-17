import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, aggiornaMock, verificaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  aggiornaMock: vi.fn(),
  verificaMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/visura/aggiorna', () => ({
  aggiornaVisura: aggiornaMock,
  verificaVisuraPerAggiornamento: verificaMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { aggiornaVisuraAction, verificaVisuraAction } from './actions';

const REF = { key: 'visura/x.pdf', name: 'v.pdf', size: 100, type: 'application/pdf' };
const REF_JSON = JSON.stringify(REF);

// Provincia volutamente minuscola: dimostra che è il server (schema zod), non
// il mock, a normalizzarla in maiuscolo prima di passarla ad aggiornaVisura.
const SEDE = { indirizzo: 'Via Roma 10', cap: '20100', citta: 'Milano', provincia: 'mi' };

function sessione(role: string) {
  return { user: { id: 'u1', companyId: 'c1', role } };
}

function fdVerifica(ref: string | null = REF_JSON): FormData {
  const f = new FormData();
  if (ref !== null) f.set('blobRef', ref);
  return f;
}

function fdAggiorna(sede: Record<string, string> | null = SEDE, ref: string | null = REF_JSON): FormData {
  const f = fdVerifica(ref);
  if (sede) for (const [k, v] of Object.entries(sede)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  aggiornaMock.mockResolvedValue({ ok: true, dataEmissione: '2026-07-01', atecoNonIdoneo: false });
  verificaMock.mockResolvedValue({
    ok: true,
    dataEmissione: '2026-07-01',
    ragioneSociale: 'Acme S.r.l.',
    sedeLegale: { comune: 'Milano', provincia: 'MI', indirizzo: 'VIA ROMA 10', cap: '20100' },
    atecoNonIdoneo: false,
  });
});

describe('aggiornaVisuraAction — authz', () => {
  it('non loggato → rifiuta, non tocca la visura', async () => {
    authMock.mockResolvedValue(null);
    const r = await aggiornaVisuraAction(fdAggiorna());
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it("loggato ma NON titolare → rifiuta (il gate non e' solo nella pagina)", async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA'));
    const r = await aggiornaVisuraAction(fdAggiorna());
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it('titolare → passa, e usa il companyId/userId della SESSIONE (mai quelli del form)', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const f = fdAggiorna();
    f.set('companyId', 'AZIENDA-DI-QUALCUN-ALTRO');
    f.set('userId', 'UTENTE-DI-QUALCUN-ALTRO');
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(true);
    expect(aggiornaMock).toHaveBeenCalledWith({
      companyId: 'c1',
      userId: 'u1',
      ref: REF,
      sedeLegale: { indirizzo: 'Via Roma 10', cap: '20100', citta: 'Milano', provincia: 'MI' },
    });
  });

  it("civico NON compare nel payload passato ad aggiornaVisura (nessun consumer lo legge)", async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const r = await aggiornaVisuraAction(fdAggiorna());
    expect(r.ok).toBe(true);
    const sedeLegale = aggiornaMock.mock.calls[0]![0].sedeLegale;
    expect('civico' in sedeLegale).toBe(false);
  });

  it('blobRef malformato → rifiuta', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const f = fdAggiorna(SEDE, 'non-json');
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it('blobRef assente → rifiuta', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const f = fdAggiorna(SEDE, null);
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it('sede legale vuota (nessun campo) → rifiuta SENZA scrivere: non azzera l\'indirizzo esistente', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const f = fdAggiorna(null);
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it('CAP non a 5 cifre → rifiuta SENZA scrivere', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const f = fdAggiorna({ ...SEDE, cap: '2010' });
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });
});

describe('verificaVisuraAction — authz (passo 1, raggiungibile via POST come il passo 2)', () => {
  it('non loggato → rifiuta, non chiama la verifica', async () => {
    authMock.mockResolvedValue(null);
    const r = await verificaVisuraAction(fdVerifica());
    expect(r.ok).toBe(false);
    expect(verificaMock).not.toHaveBeenCalled();
  });

  it('loggato ma NON titolare → rifiuta', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA'));
    const r = await verificaVisuraAction(fdVerifica());
    expect(r.ok).toBe(false);
    expect(verificaMock).not.toHaveBeenCalled();
  });

  it('titolare → passa, e usa il companyId della SESSIONE (mai quello del form)', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const f = fdVerifica();
    f.set('companyId', 'AZIENDA-DI-QUALCUN-ALTRO');
    const r = await verificaVisuraAction(f);
    expect(r.ok).toBe(true);
    expect(verificaMock).toHaveBeenCalledWith({ companyId: 'c1', ref: REF });
  });

  it('blobRef malformato → rifiuta', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    const r = await verificaVisuraAction(fdVerifica('non-json'));
    expect(r.ok).toBe(false);
    expect(verificaMock).not.toHaveBeenCalled();
  });

  it('non scrive nulla: il passo 1 non chiama mai aggiornaVisura', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));
    await verificaVisuraAction(fdVerifica());
    expect(aggiornaMock).not.toHaveBeenCalled();
  });
});
