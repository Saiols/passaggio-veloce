import { describe, it, expect, vi } from 'vitest';

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock('@pv/db', () => ({
  prisma: { distribuzioneConfig: { findFirst: findFirstMock } },
}));
// React `cache()` dedup per-request: nei test va neutralizzato, altrimenti la
// prima risposta verrebbe riusata da tutti i casi successivi.
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));

import { getDistribuzioneConfig, DISTRIBUZIONE_DEFAULT } from './config';
import { ORARI_SETTIMANA_DEFAULT } from './calendario';

const ROW = {
  raggioStartM: 2000,
  stepM: 500,
  raggioMaxM: 20000,
  intervalloMin: 15,
  orariSettimana: {
    LUN: { attivo: true, inizio: '08:00', fine: '20:00' },
    SAB: { attivo: true, inizio: '09:00', fine: '13:00' },
  },
  festivi: [{ data: '2026-12-25', nome: 'Natale' }],
};

// Nota: reset del mock inline in ogni test, non in `beforeEach`. In Vitest
// 4.1.5 un `beforeEach(() => findFirstMock.mockReset())` seguito da un test
// che rigetta la promise del mock produce un falso "unhandled rejection"
// anche quando il codice la cattura correttamente (stesso problema già
// documentato in lib/pricing.tariffario.test.ts).

describe('getDistribuzioneConfig', () => {
  it('riga assente → default completi', async () => {
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(null);
    await expect(getDistribuzioneConfig()).resolves.toEqual(DISTRIBUZIONE_DEFAULT);
  });

  it('errore del DB → default (fail-open, la distribuzione non si ferma)', async () => {
    findFirstMock.mockReset();
    findFirstMock.mockRejectedValue(new Error('connessione persa'));
    await expect(getDistribuzioneConfig()).resolves.toEqual(DISTRIBUZIONE_DEFAULT);
  });

  it('legge raggi, durata, fasce e festivi dalla riga', async () => {
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(ROW);
    const cfg = await getDistribuzioneConfig();
    expect(cfg.raggioMaxM).toBe(20000);
    expect(cfg.intervalloMin).toBe(15);
    expect(cfg.orariSettimana.LUN).toEqual({ attivo: true, inizio: '08:00', fine: '20:00' });
    expect(cfg.orariSettimana.SAB).toEqual({ attivo: true, inizio: '09:00', fine: '13:00' });
    expect(cfg.festivi).toEqual([{ data: '2026-12-25', nome: 'Natale' }]);
  });

  it('colonne nuove a null → calendario di default, resto della riga rispettato', async () => {
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue({ ...ROW, orariSettimana: null, festivi: null });
    const cfg = await getDistribuzioneConfig();
    expect(cfg.orariSettimana).toEqual(ORARI_SETTIMANA_DEFAULT);
    expect(cfg.festivi).toEqual([]);
    expect(cfg.raggioMaxM).toBe(20000);
  });
});
