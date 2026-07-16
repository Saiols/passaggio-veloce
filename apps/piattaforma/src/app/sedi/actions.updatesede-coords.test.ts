import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, geocodeMock, ctxMock, permMock } = vi.hoisted(() => ({
  prismaMock: { sede: { update: vi.fn(), findUnique: vi.fn() } },
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

/** Indirizzo memorizzato che coincide coi campi inviati da `fd()`. Usato per
 *  simulare una modifica in cui l'indirizzo NON cambia. */
const STORED_SAME = {
  indirizzo: 'Via Milano', civico: '2', citta: 'Torino', cap: '10100', provincia: 'TO',
};

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ ok: true });
  ctxMock.mockResolvedValue({ isOwner: true, accessibleSedi: [{ id: 's-1' }] });
  prismaMock.sede.update.mockResolvedValue({});
  // Default: la sede esiste con un indirizzo DIVERSO dai campi inviati da `fd()`
  // → i test che non sovrascrivono questo mock rappresentano una modifica di
  // indirizzo, quindi il geocode viene tentato.
  prismaMock.sede.findUnique.mockResolvedValue({
    indirizzo: 'Via Vecchia', civico: '9', citta: 'Torino', cap: '10100', provincia: 'TO',
  });
});

describe('updateSedeAction — coordinate', () => {
  it('usa le coordinate dal client se presenti (short-circuit prima del geocode)', async () => {
    await updateSedeAction('s-1', fd({ lat: '45.07', lng: '7.68' }));
    expect(geocodeMock).not.toHaveBeenCalled();
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data.lat).toBe(45.07);
    expect(data.lng).toBe(7.68);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('indirizzo cambiato, senza coord client: geocoda e persiste', async () => {
    geocodeMock.mockResolvedValue({ lat: 45.07, lng: 7.68 });
    await updateSedeAction('s-1', fd());
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data.lat).toBe(45.07);
    expect(data.lng).toBe(7.68);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  // REGRESSIONE CRITICA (data-loss): una modifica qualsiasi che ri-tenta il
  // geocode e fallisce (errore transitorio, ZERO_RESULTS, o — caso live in
  // finestra pre-go-live — Geocoding API non ancora abilitata) NON deve
  // azzerare le coordinate buone già a DB. Coord assenti ⇒ chiavi omesse
  // dall'update, non scritte a null.
  it('geocode fallito (null) su indirizzo cambiato: NON azzera le coord esistenti', async () => {
    geocodeMock.mockResolvedValue(null);
    await updateSedeAction('s-1', fd());
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('lat');
    expect(data).not.toHaveProperty('lng');
    expect(data).not.toHaveProperty('geocodedAt');
  });

  it('indirizzo invariato, senza coord client: NON geocoda e NON tocca le coord', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ ...STORED_SAME });
    await updateSedeAction('s-1', fd());
    expect(geocodeMock).not.toHaveBeenCalled();
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('lat');
    expect(data).not.toHaveProperty('lng');
    expect(data).not.toHaveProperty('geocodedAt');
  });
});
