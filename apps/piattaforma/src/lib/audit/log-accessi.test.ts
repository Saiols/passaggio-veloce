import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, headersMock } = vi.hoisted(() => ({
  prismaMock: { logAccesso: { create: vi.fn() } },
  headersMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));

import { registraLog } from './log-accessi';

const datiScritti = () => prismaMock.logAccesso.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.logAccesso.create.mockResolvedValue({});
  headersMock.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '203.0.113.42', 'user-agent': 'Mozilla/5.0' }),
  );
});

describe('registraLog', () => {
  it('registra azione, attore e risorsa', async () => {
    await registraLog({
      azione: 'DOCUMENTO_ACCESSO',
      userId: 'u1',
      email: 'Mario@Example.IT',
      companyId: 'c1',
      risorsaTipo: 'documento',
      risorsaId: 'd1',
    });

    expect(datiScritti()).toMatchObject({
      azione: 'DOCUMENTO_ACCESSO',
      userId: 'u1',
      companyId: 'c1',
      risorsaTipo: 'documento',
      risorsaId: 'd1',
      negato: false,
    });
  });

  it("anonimizza l'IP: il log è a sua volta un dato personale", async () => {
    await registraLog({ azione: 'LOGIN', userId: 'u1' });

    // IPv4 troncato al terzo ottetto, come ovunque nel progetto.
    expect(datiScritti().ip).toBe('203.0.113.0');
    expect(datiScritti().userAgent).toBe('Mozilla/5.0');
  });

  it("normalizza l'email a minuscolo, così i tentativi si aggregano", async () => {
    // Senza, `Mario@x.it` e `mario@x.it` sembrerebbero due bersagli diversi e
    // un attacco distribuito sulle maiuscole sfuggirebbe a qualunque conteggio.
    await registraLog({ azione: 'LOGIN_FALLITO', email: 'Mario@Example.IT' });

    expect(datiScritti().email).toBe('mario@example.it');
  });

  it('un login fallito su email inesistente si registra comunque, senza utente', async () => {
    await registraLog({ azione: 'LOGIN_FALLITO', email: 'ignoto@example.it' });

    expect(datiScritti()).toMatchObject({
      azione: 'LOGIN_FALLITO',
      userId: null,
      email: 'ignoto@example.it',
    });
  });

  it('NON lancia se il database è indisponibile', async () => {
    // È l'invariante che rende il log innocuo: un difetto dell'osservatore non
    // deve diventare un difetto della cosa osservata. Se questa promise
    // rifiutasse, un download di documento fallirebbe perché il log è rotto.
    prismaMock.logAccesso.create.mockRejectedValue(new Error('connessione persa'));

    await expect(registraLog({ azione: 'LOGIN', userId: 'u1' })).resolves.toBeUndefined();
  });

  it('NON lancia fuori da un contesto di richiesta: si perde solo IP e user-agent', async () => {
    // `headers()` lancia se chiamata fuori da una richiesta (job, script).
    headersMock.mockRejectedValue(new Error('headers() fuori contesto'));

    await expect(registraLog({ azione: 'LOGIN', userId: 'u1' })).resolves.toBeUndefined();
    expect(datiScritti()).toMatchObject({ ip: null, userAgent: null, userId: 'u1' });
  });

  it('il tentativo negato è marcato come tale', async () => {
    await registraLog({
      azione: 'DOCUMENTO_ACCESSO',
      userId: 'u1',
      risorsaId: 'd1',
      negato: true,
      dettaglio: 'scope o proprietà',
    });

    expect(datiScritti()).toMatchObject({ negato: true, dettaglio: 'scope o proprietà' });
  });

  it('bersaglioCompanyId separa il caso cross-azienda', async () => {
    await registraLog({
      azione: 'EXPORT_DATI',
      userId: 'admin-1',
      companyId: null,
      bersaglioCompanyId: 'c-altra',
      risorsaTipo: 'documenti-azienda-zip',
    });

    expect(datiScritti()).toMatchObject({ companyId: null, bersaglioCompanyId: 'c-altra' });
  });
});
