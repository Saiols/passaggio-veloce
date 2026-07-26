import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tariffaPiattaforma: { findFirst: vi.fn() },
    riaccettazioneTariffa: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));

import { getRiaccettazionePendente, registraRiaccettazione } from './riaccettazione';

const NOW = new Date('2026-09-01T10:00:00.000Z');
const RILEVANTE = { id: 't-rilevante', efficaceDal: new Date('2026-08-25T00:00:00.000Z') };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.riaccettazioneTariffa.findUnique.mockResolvedValue(null);
});

/**
 * `getRiaccettazionePendente` fa DUE query sulla stessa tabella: la prima cerca
 * l'ultima tariffa rilevante già in vigore, la seconda l'ultima in vigore in
 * assoluto. Nei test si distinguono per l'ordine di chiamata.
 */
function rispondiConTariffe(rilevante: unknown, corrente: unknown) {
  prismaMock.tariffaPiattaforma.findFirst
    .mockResolvedValueOnce(rilevante)
    .mockResolvedValueOnce(corrente);
}

describe('getRiaccettazionePendente', () => {
  it('tariffa rilevante in vigore e mai riaccettata → pendente', () => {
    rispondiConTariffe(RILEVANTE, { id: 't-rilevante' });
    return expect(getRiaccettazionePendente('c1', NOW)).resolves.toEqual({
      tariffaId: 't-rilevante',
      efficaceDal: RILEVANTE.efficaceDal,
    });
  });

  it('già riaccettata da questa azienda → nessun blocco', async () => {
    rispondiConTariffe(RILEVANTE, { id: 't-rilevante' });
    prismaMock.riaccettazioneTariffa.findUnique.mockResolvedValue({ id: 'r1' });

    await expect(getRiaccettazionePendente('c1', NOW)).resolves.toBeNull();
  });

  it('nessuna tariffa rilevante in vigore → nessun blocco', async () => {
    rispondiConTariffe(null, { id: 't-normale' });
    await expect(getRiaccettazionePendente('c1', NOW)).resolves.toBeNull();
  });

  it('rilevante SUPERATA da una variazione successiva → nessun blocco', async () => {
    // Il caso che, senza il secondo controllo, murerebbe l'azienda per sempre:
    // una vecchia variazione rilevante mai riaccettata resterebbe "in vigore e
    // pendente" anche dopo essere stata sostituita, e nessuno potrebbe più
    // inviare pratiche accettando condizioni che non si applicano più.
    rispondiConTariffe(RILEVANTE, { id: 't-successiva' });

    await expect(getRiaccettazionePendente('c1', NOW)).resolves.toBeNull();
    // Non ha nemmeno senso chiedersi se sia stata riaccettata.
    expect(prismaMock.riaccettazioneTariffa.findUnique).not.toHaveBeenCalled();
  });

  it('interroga solo le tariffe GIÀ efficaci e non annullate', async () => {
    rispondiConTariffe(null, null);
    await getRiaccettazionePendente('c1', NOW);

    const where = prismaMock.tariffaPiattaforma.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      efficaceDal: { lte: NOW },
      annullataAt: null,
      richiedeRiaccettazione: true,
    });
  });

  it('una variazione rilevante ancora PROGRAMMATA non blocca: il preavviso non è un ultimatum', async () => {
    // `efficaceDal` futuro non passa il filtro `lte: now`, quindi la prima
    // query non la trova. Durante i 30 giorni di preavviso si lavora.
    rispondiConTariffe(null, { id: 't-corrente' });
    await expect(getRiaccettazionePendente('c1', NOW)).resolves.toBeNull();
  });
});

describe('registraRiaccettazione', () => {
  it('è idempotente: la seconda volta non sovrascrive nulla', async () => {
    await registraRiaccettazione({ companyId: 'c1', tariffaId: 't1', userId: 'u1' });

    const arg = prismaMock.riaccettazioneTariffa.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ companyId_tariffaId: { companyId: 'c1', tariffaId: 't1' } });
    expect(arg.update).toEqual({});
  });

  it('registra IP e user-agent: è l’accettazione che va dimostrata', async () => {
    await registraRiaccettazione({
      companyId: 'c1',
      tariffaId: 't1',
      userId: 'u1',
      ip: '1.2.3.0',
      userAgent: 'Mozilla/5.0',
    });

    expect(prismaMock.riaccettazioneTariffa.upsert.mock.calls[0][0].create).toMatchObject({
      companyId: 'c1',
      tariffaId: 't1',
      userId: 'u1',
      ip: '1.2.3.0',
      userAgent: 'Mozilla/5.0',
    });
  });
});
