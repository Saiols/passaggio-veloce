import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tariffario } from '@/lib/pricing';

const { getSessionContextMock, getOperatingSedeMock, hasPermessoMock, tariffarioMock, prismaMock } =
  vi.hoisted(() => ({
    getSessionContextMock: vi.fn(),
    getOperatingSedeMock: vi.fn(),
    hasPermessoMock: vi.fn(),
    tariffarioMock: vi.fn(),
    prismaMock: {
      user: { findUnique: vi.fn(), updateMany: vi.fn() },
      sede: { findUnique: vi.fn() },
      company: { findUnique: vi.fn() },
    },
  }));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
// next-auth non risolve sotto Vitest: session-context.ts lo importa comunque.
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    getSessionContext: getSessionContextMock,
    getOperatingSede: getOperatingSedeMock,
  };
});
vi.mock('@/lib/auth/permessi/guard', () => ({ hasPermesso: hasPermessoMock }));
vi.mock('@/lib/tariffario', () => ({ getTariffarioCorrente: tariffarioMock }));

import { getAffiliazioneSpot, dismissAffiliazioneSpot, messaggioWhatsapp } from './spot';

// Volutamente NON i valori di listino (10€/5€): se il payload li restituisse
// comunque, vorrebbe dire che gli importi sono hardcodati da qualche parte
// invece di venire dal tariffario editabile in /admin/tariffe.
const TARIFFARIO_FINTO: Tariffario = {
  SEMPLICE: { feeAgenziaCent: 9000, creditoBrokerCent: 3000, affiliazioneCent: 1234 },
  MINIVOLTURA: { feeAgenziaCent: 2000, creditoBrokerCent: 0, affiliazioneCent: 567 },
};

const SEDE = { id: 'sede1', nome: 'Sede Padova', type: 'DEALER', citta: 'Padova' };

function ctxBroker(over: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', role: 'ADMIN_AZIENDA' },
    companyId: 'c1',
    companyType: 'DEALER',
    isOwner: true,
    accessibleSedi: [SEDE],
    currentSede: { kind: 'ONE', sede: SEDE },
    scopeIds: [SEDE.id],
    membershipRuoli: {},
    permessi: new Set(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
  getSessionContextMock.mockResolvedValue(ctxBroker());
  getOperatingSedeMock.mockResolvedValue(SEDE);
  hasPermessoMock.mockResolvedValue(true);
  tariffarioMock.mockResolvedValue(TARIFFARIO_FINTO);
  prismaMock.user.findUnique.mockResolvedValue({ affiliazioneSpotDismissedAt: null });
  prismaMock.sede.findUnique.mockResolvedValue({ referralCode: 'abc12345' });
  prismaMock.company.findUnique.mockResolvedValue({ referralCode: null });
});

describe('getAffiliazioneSpot — gate', () => {
  it('mostra la modale al broker con permesso e link disponibile', async () => {
    const spot = await getAffiliazioneSpot();

    expect(spot).not.toBeNull();
    expect(spot!.link).toBe('https://app.test/r/abc12345');
    // Nessuna ambiguità da spiegare: il link è quello della sede operativa.
    expect(spot!.sedeNomeFallback).toBeNull();
  });

  it('prende gli importi dal tariffario, non da costanti', async () => {
    const spot = await getAffiliazioneSpot();

    expect(spot!.sempliceCent).toBe(1234);
    expect(spot!.minivolturaCent).toBe(567);
    expect(spot!.minPayoutCent).toBe(50_000);
  });

  it("non mostra nulla allo staff di piattaforma (nessuna azienda)", async () => {
    getSessionContextMock.mockResolvedValue(
      ctxBroker({ companyId: undefined, companyType: undefined }),
    );

    expect(await getAffiliazioneSpot()).toBeNull();
  });

  it("non mostra nulla a un'azienda che non è broker né agenzia", async () => {
    getSessionContextMock.mockResolvedValue(ctxBroker({ companyType: 'ALTRO' }));

    expect(await getAffiliazioneSpot()).toBeNull();
  });

  it('non mostra nulla a chi non ha il permesso affiliazione.view', async () => {
    hasPermessoMock.mockResolvedValue(false);

    expect(await getAffiliazioneSpot()).toBeNull();
    // Fail-closed prima di toccare il DB dell'utente.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('non mostra nulla a chi ha spuntato "non mostrare più"', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      affiliazioneSpotDismissedAt: new Date('2026-07-01'),
    });

    expect(await getAffiliazioneSpot()).toBeNull();
  });

  it('non mostra nulla se non esiste un codice referral da sponsorizzare', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ referralCode: null });
    prismaMock.company.findUnique.mockResolvedValue({ referralCode: null });

    expect(await getAffiliazioneSpot()).toBeNull();
  });
});

describe('getAffiliazioneSpot — multi-sede', () => {
  it('per il proprietario in vista aggregata usa la prima sede e lo dichiara', async () => {
    // Vista ALL con più sedi: getOperatingSede() ritorna null (per una scrittura
    // dovrebbe prima sceglierne una). Il link però deve esserci comunque.
    getOperatingSedeMock.mockResolvedValue(null);
    getSessionContextMock.mockResolvedValue(
      ctxBroker({
        accessibleSedi: [SEDE, { id: 'sede2', nome: 'Sede Verona', type: 'DEALER', citta: 'Verona' }],
        currentSede: { kind: 'ALL' },
      }),
    );

    const spot = await getAffiliazioneSpot();

    expect(spot!.link).toBe('https://app.test/r/abc12345');
    expect(spot!.sedeNomeFallback).toBe('Sede Padova');
  });

  it('ricade su Company.referralCode legacy quando la sede non ne ha uno', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ referralCode: null });
    prismaMock.company.findUnique.mockResolvedValue({ referralCode: 'legacy99' });

    const spot = await getAffiliazioneSpot();

    expect(spot!.link).toBe('https://app.test/r/legacy99');
  });
});

describe('messaggioWhatsapp', () => {
  it('include il link, altrimenti lo share non affilia nessuno', () => {
    expect(messaggioWhatsapp('https://app.test/r/abc12345')).toContain(
      'https://app.test/r/abc12345',
    );
  });
});

describe('dismissAffiliazioneSpot', () => {
  it('scrive la presa visione solo se non era già scritta (idempotente)', async () => {
    await dismissAffiliazioneSpot('u1');

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', affiliazioneSpotDismissedAt: null },
      data: { affiliazioneSpotDismissedAt: expect.any(Date) },
    });
  });
});
