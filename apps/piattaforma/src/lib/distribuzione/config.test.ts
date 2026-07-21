import { describe, it, expect, vi } from 'vitest';

const findFirst = vi.fn();
vi.mock('@pv/db', () => ({ prisma: { distribuzioneConfig: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import { getDistribuzioneConfig, DISTRIBUZIONE_DEFAULT, parseGiorni } from './config';

describe('parseGiorni', () => {
  it('converte una lista CSV in array di giorni', () => {
    expect(parseGiorni('LUN,MAR')).toEqual(['LUN', 'MAR']);
  });

  it('converte il default a 5 giorni feriali', () => {
    expect(parseGiorni('LUN,MAR,MER,GIO,VEN')).toEqual(['LUN', 'MAR', 'MER', 'GIO', 'VEN']);
  });

  it('scarta token non riconosciuti e spazi superflui', () => {
    expect(parseGiorni('LUN, XXX ,MAR,')).toEqual(['LUN', 'MAR']);
  });

  it('stringa vuota → array vuoto', () => {
    expect(parseGiorni('')).toEqual([]);
  });
});

describe('getDistribuzioneConfig', () => {
  // Nota: reset del mock inline in ogni test, non in beforeEach (vedi
  // pricing.tariffario.test.ts per la motivazione: un reset in beforeEach
  // prima di un test che rigetta la promise del mock produce un falso
  // "unhandled rejection" in Vitest 4.1.5).

  it('mappa i campi della riga DB, incl. parse dei giorni', async () => {
    findFirst.mockReset();
    findFirst.mockResolvedValue({
      id: 'singleton',
      raggioStartM: 500,
      stepM: 200,
      raggioMaxM: 12000,
      intervalloMin: 15,
      orarioInizio: '08:30',
      orarioFine: '18:30',
      giorni: 'LUN,MAR,MER',
      updatedAt: new Date(),
    });

    const cfg = await getDistribuzioneConfig();

    expect(cfg).toEqual({
      raggioStartM: 500,
      stepM: 200,
      raggioMaxM: 12000,
      intervalloMin: 15,
      orarioInizio: '08:30',
      orarioFine: '18:30',
      giorni: ['LUN', 'MAR', 'MER'],
    });
  });

  it('fallback a DISTRIBUZIONE_DEFAULT quando la tabella è vuota', async () => {
    findFirst.mockReset();
    findFirst.mockResolvedValue(null);

    expect(await getDistribuzioneConfig()).toEqual(DISTRIBUZIONE_DEFAULT);
  });

  it('fallback a DISTRIBUZIONE_DEFAULT quando la query DB fallisce (fail-open)', async () => {
    findFirst.mockReset();
    findFirst.mockRejectedValue(new Error('db down'));

    expect(await getDistribuzioneConfig()).toEqual(DISTRIBUZIONE_DEFAULT);
  });
});
