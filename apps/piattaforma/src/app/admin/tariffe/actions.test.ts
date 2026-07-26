import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock, txMock, notificaMock, rigaCorrenteMock } = vi.hoisted(() => {
  const txMock = {
    tariffaPiattaforma: { updateMany: vi.fn(), create: vi.fn() },
  };
  return {
    authMock: vi.fn(),
    txMock,
    notificaMock: vi.fn(),
    rigaCorrenteMock: vi.fn(),
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      tariffaPiattaforma: { updateMany: vi.fn() },
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/tariffario', () => ({ getRigaTariffaCorrente: rigaCorrenteMock }));
vi.mock('@/lib/tariffe/notifica', () => ({ notificaVariazioneTariffe: notificaMock }));

import { annullaVariazioneProgrammataAction, salvaTariffarioAction } from './actions';

/** Tariffa in vigore: i default legacy. */
const CORRENTE = {
  id: 't-corrente',
  sempliceFeeAgenziaCent: 7500,
  sempliceCreditoBrokerCent: 2500,
  sempliceAffiliazioneCent: 1000,
  minivolturaFeeAgenziaCent: 1500,
  minivolturaCreditoBrokerCent: 0,
  minivolturaAffiliazioneCent: 500,
};

const FORM_INVARIATO = {
  sempliceFeeEuro: 75,
  sempliceCommissioneEuro: 25,
  sempliceAffiliazioneEuro: 10,
  minivolturaFeeEuro: 15,
  minivolturaCommissioneEuro: 0,
  minivolturaAffiliazioneEuro: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  rigaCorrenteMock.mockResolvedValue(CORRENTE);
  txMock.tariffaPiattaforma.updateMany.mockResolvedValue({ count: 0 });
  txMock.tariffaPiattaforma.create.mockResolvedValue({ id: 't-nuova' });
  notificaMock.mockResolvedValue({ destinatari: 19 });
});

/** I dati passati alla create della nuova riga. */
const datiCreati = () => txMock.tariffaPiattaforma.create.mock.calls[0][0].data;

describe('salvaTariffarioAction — clausola 3, il prezzo non cambia subito', () => {
  it('aumento del 10% → 7 giorni di preavviso ed efficacia futura, non immediata', async () => {
    const prima = Date.now();
    const r = await salvaTariffarioAction({ ...FORM_INVARIATO, sempliceFeeEuro: 82.5 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fascia).toBe('LIEVE');
    expect(r.giorniPreavviso).toBe(7);
    // Il punto dell'intera feature: la nuova tariffa NON è in vigore adesso.
    const efficacia = new Date(r.efficaceDal).getTime();
    expect(efficacia).toBeGreaterThan(prima + 6 * 24 * 3600 * 1000);
    expect(datiCreati().richiedeRiaccettazione).toBe(false);
  });

  it('aumento del 30% → 30 giorni e riaccettazione richiesta', async () => {
    const r = await salvaTariffarioAction({ ...FORM_INVARIATO, sempliceFeeEuro: 97.5 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fascia).toBe('RILEVANTE');
    expect(r.giorniPreavviso).toBe(30);
    expect(datiCreati().richiedeRiaccettazione).toBe(true);
    expect(datiCreati().scostamentoMassimoBp).toBe(3000);
  });

  it('avvisa gli Utenti: è la comunicazione da cui decorre il preavviso', async () => {
    const r = await salvaTariffarioAction({ ...FORM_INVARIATO, sempliceFeeEuro: 82.5 });

    expect(notificaMock).toHaveBeenCalledTimes(1);
    expect(r.ok && r.destinatariAvvisati).toBe(19);
  });

  it('nessun importo cambiato (solo la nota) → efficacia immediata e NESSUNA email', async () => {
    const r = await salvaTariffarioAction({ ...FORM_INVARIATO, note: 'refuso corretto' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fascia).toBe('NESSUNA');
    expect(r.giorniPreavviso).toBe(0);
    expect(notificaMock).not.toHaveBeenCalled();
  });

  it('la flag «strutturale» può solo allungare il preavviso, mai accorciarlo', async () => {
    const r = await salvaTariffarioAction({
      ...FORM_INVARIATO,
      sempliceFeeEuro: 75.75, // +1%: da sola sarebbe LIEVE
      strutturale: true,
    });

    expect(r.ok && r.giorniPreavviso).toBe(30);
    expect(datiCreati().strutturale).toBe(true);
  });

  it('sostituisce la variazione già programmata annullandola, non cancellandola', async () => {
    // La comunicazione della precedente è già partita: la riga resta a
    // registro con `annullataAt`, altrimenti si perde traccia di cosa era
    // stato annunciato agli Utenti.
    await salvaTariffarioAction({ ...FORM_INVARIATO, sempliceFeeEuro: 82.5 });

    const arg = txMock.tariffaPiattaforma.updateMany.mock.calls[0][0];
    expect(arg.where.annullataAt).toBeNull();
    expect(arg.where.efficaceDal.gt).toBeInstanceOf(Date);
    expect(arg.data.annullataAt).toBeInstanceOf(Date);
    expect(arg.data.annullataDaId).toBe('admin-1');
  });

  it('non-admin → rifiutato, nessuna riga creata', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA' } });

    const r = await salvaTariffarioAction({ ...FORM_INVARIATO, sempliceFeeEuro: 82.5 });

    expect(r.ok).toBe(false);
    expect(txMock.tariffaPiattaforma.create).not.toHaveBeenCalled();
    expect(notificaMock).not.toHaveBeenCalled();
  });

  it('input non valido (commissione > costo agenzia) → rifiutato prima di toccare il DB', async () => {
    const r = await salvaTariffarioAction({ ...FORM_INVARIATO, sempliceCommissioneEuro: 999 });

    expect(r.ok).toBe(false);
    expect(txMock.tariffaPiattaforma.create).not.toHaveBeenCalled();
  });
});

describe('annullaVariazioneProgrammataAction', () => {
  it('annulla solo se ancora futura e non già annullata', async () => {
    prismaMock.tariffaPiattaforma.updateMany.mockResolvedValue({ count: 1 });

    await expect(annullaVariazioneProgrammataAction('t-prog')).resolves.toEqual({ ok: true });

    const arg = prismaMock.tariffaPiattaforma.updateMany.mock.calls[0][0];
    expect(arg.where.id).toBe('t-prog');
    expect(arg.where.efficaceDal.gt).toBeInstanceOf(Date);
    expect(arg.where.annullataAt).toBeNull();
  });

  it('tariffa già IN VIGORE → non annullabile', async () => {
    // Annullarla a posteriori significherebbe applicare retroattivamente un
    // prezzo diverso da quello comunicato: il filtro `efficaceDal > now` non
    // la trova e `count` resta 0.
    prismaMock.tariffaPiattaforma.updateMany.mockResolvedValue({ count: 0 });

    const r = await annullaVariazioneProgrammataAction('t-in-vigore');

    expect(r.ok).toBe(false);
  });

  it('non-admin → rifiutato senza scrivere', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA' } });

    const r = await annullaVariazioneProgrammataAction('t-prog');

    expect(r.ok).toBe(false);
    expect(prismaMock.tariffaPiattaforma.updateMany).not.toHaveBeenCalled();
  });
});
