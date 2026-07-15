import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, redirectMock, geocodeMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findUnique: vi.fn() },
    sede: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  geocodeMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/geo/geocode', () => ({ geocodeAddress: geocodeMock }));

import { createSedeAction } from './actions';

function fd(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    nome: 'Sede Nuova', indirizzo: 'Via Roma', civico: '1', citta: 'Milano',
    cap: '20100', provincia: 'MI', telefono: '', email: '', codiceInterno: '',
    iban: '', payoutThresholdEuro: '', lat: '', lng: '',
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN_AZIENDA', companyId: 'c-1' } });
  prismaMock.company.findUnique.mockResolvedValue({ type: 'AGENZIA' });
  prismaMock.sede.findFirst.mockResolvedValue(null); // nessuna sede sanzionata
  prismaMock.sede.findUnique.mockResolvedValue(null); // nessuna collisione referralCode
  prismaMock.sede.create.mockResolvedValue({});
});

describe('createSedeAction — coordinate', () => {
  it('usa le coordinate dal client (Places) e NON chiama il geocoder', async () => {
    await createSedeAction(fd({ lat: '45.46', lng: '9.19' }));
    expect(geocodeMock).not.toHaveBeenCalled();
    const data = prismaMock.sede.create.mock.calls[0][0].data;
    expect(data.lat).toBe(45.46);
    expect(data.lng).toBe(9.19);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('senza coordinate client geocoda server-side e le persiste', async () => {
    geocodeMock.mockResolvedValue({ lat: 41.9, lng: 12.5 });
    await createSedeAction(fd());
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.sede.create.mock.calls[0][0].data;
    expect(data.lat).toBe(41.9);
    expect(data.lng).toBe(12.5);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('se il geocoding fallisce salva comunque con coord null e geocodedAt null', async () => {
    geocodeMock.mockResolvedValue(null);
    await createSedeAction(fd());
    const data = prismaMock.sede.create.mock.calls[0][0].data;
    expect(data.lat).toBeNull();
    expect(data.lng).toBeNull();
    expect(data.geocodedAt).toBeNull();
  });
});
