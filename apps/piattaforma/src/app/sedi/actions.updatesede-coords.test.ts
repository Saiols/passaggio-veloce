import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, geocodeMock, ctxMock, permMock } = vi.hoisted(() => ({
  prismaMock: { sede: { update: vi.fn() } },
  geocodeMock: vi.fn(),
  ctxMock: vi.fn(),
  permMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/geo/geocode', () => ({ geocodeAddress: geocodeMock }));
// Gate permesso + scope: importa i nomi reali usati da updateSedeAction e mockali.
vi.mock('@/lib/auth/permessi/guard', () => ({ requirePermesso: permMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: ctxMock }));
// actions.ts importa `@/auth` a livello di modulo (usato da altre action nello
// stesso file): senza questo mock, caricare `./actions` in test trascina
// next-auth → next/server e fallisce a runtime, indipendentemente dal fatto
// che updateSedeAction non chiami auth() direttamente (vedi actions.authz.test.ts).
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { updateSedeAction } from './actions';

function fd(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    nome: 'Sede', indirizzo: 'Via Milano', civico: '2', citta: 'Torino',
    cap: '10100', provincia: 'TO', telefono: '', email: '', codiceInterno: '',
    iban: '', payoutThresholdEuro: '', lat: '', lng: '',
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ ok: true });
  ctxMock.mockResolvedValue({ isOwner: true, accessibleSedi: [{ id: 's-1' }] });
  prismaMock.sede.update.mockResolvedValue({});
});

describe('updateSedeAction — coordinate', () => {
  it('usa le coordinate dal client se presenti', async () => {
    await updateSedeAction('s-1', fd({ lat: '45.07', lng: '7.68' }));
    expect(geocodeMock).not.toHaveBeenCalled();
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data.lat).toBe(45.07);
    expect(data.lng).toBe(7.68);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('senza coord client geocoda e persiste', async () => {
    geocodeMock.mockResolvedValue({ lat: 45.07, lng: 7.68 });
    await updateSedeAction('s-1', fd());
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data.lat).toBe(45.07);
  });
});
