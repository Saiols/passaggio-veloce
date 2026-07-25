import { describe, it, expect } from 'vitest';
import {
  configDistribuzioneSchema,
  toConfigPersistita,
  DURATA_ROUND_ORE_MAX,
  DURATA_ROUND_ORE_MIN,
  RAGGIO_MAX_KM_MAX,
  RAGGIO_MAX_KM_MIN,
  RAGGIO_START_KM_MIN,
  STEP_KM_INPUT,
  STEP_KM_MAX,
  STEP_KM_MIN,
  STEP_ORE_INPUT,
  STEP_RAGGIO_MAX_KM_INPUT,
} from './validate';

/**
 * `<input type="number">` accetta solo i valori `min + n·step`. Verifica che
 * `valore` cada sulla griglia, in millesimi interi per non inciampare nella
 * rappresentazione binaria dei decimali (0,1 non è esatto in floating point).
 */
function suGriglia(valore: number, min: number, step: number): boolean {
  const scala = (n: number) => Math.round(n * 1000);
  const delta = scala(valore) - scala(min);
  return delta >= 0 && delta % scala(step) === 0;
}

describe('passo dei campi numerici — ogni valore ammesso è raggiungibile', () => {
  // La regressione originale: min=0,1 con step=0,5 rendeva "1 km" aria-invalid
  // nel browser (griglia 0,1 / 0,6 / 1,1…), invisibile a test e typecheck.
  it.each([
    ['raggio iniziale', RAGGIO_START_KM_MIN, STEP_KM_INPUT, [0.5, 1, 2, 10]],
    ['passo per round', STEP_KM_MIN, STEP_KM_INPUT, [0.5, 1, 2, STEP_KM_MAX]],
    ['raggio massimo', RAGGIO_MAX_KM_MIN, STEP_RAGGIO_MAX_KM_INPUT, [1, 10, RAGGIO_MAX_KM_MAX]],
    ['durata round', DURATA_ROUND_ORE_MIN, STEP_ORE_INPUT, [0.25, 0.5, 1, 2, DURATA_ROUND_ORE_MAX]],
  ])('%s: i valori tipici cadono sulla griglia min + n·step', (_campo, min, step, valori) => {
    for (const v of valori as number[]) {
      expect(suGriglia(v, min as number, step as number), `${v} non è su min+n·step`).toBe(true);
    }
  });
});

describe('configDistribuzioneSchema', () => {
  const OK = { raggioStartKm: 1, stepKm: 1, raggioMaxKm: 10, durataRoundOre: 1 };

  it('accetta i valori di default', () => {
    expect(configDistribuzioneSchema.safeParse(OK).success).toBe(true);
  });

  it('accetta gli estremi ammessi', () => {
    const estremi = {
      raggioStartKm: RAGGIO_START_KM_MIN,
      stepKm: STEP_KM_MAX,
      raggioMaxKm: RAGGIO_MAX_KM_MAX,
      durataRoundOre: DURATA_ROUND_ORE_MAX,
    };
    expect(configDistribuzioneSchema.safeParse(estremi).success).toBe(true);
  });

  it('il messaggio cross-field è agganciato a raggioMaxKm (il campo che diventa rosso)', () => {
    const res = configDistribuzioneSchema.safeParse({ ...OK, raggioStartKm: 8, raggioMaxKm: 5 });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(['raggioMaxKm']);
    }
  });

  it('NaN (campo vuoto nel form) non passa', () => {
    expect(configDistribuzioneSchema.safeParse({ ...OK, durataRoundOre: NaN }).success).toBe(false);
  });
});

describe('toConfigPersistita', () => {
  it('converte km→metri e ore→minuti arrotondando a interi', () => {
    expect(
      toConfigPersistita({ raggioStartKm: 0.3, stepKm: 1.5, raggioMaxKm: 12.4, durataRoundOre: 0.25 }),
    ).toEqual({ raggioStartM: 300, stepM: 1500, raggioMaxM: 12400, intervalloMin: 15 });
  });

  // 0,1 km in floating point è 100.00000000000001 m: senza arrotondamento
  // finirebbe in una colonna INTEGER.
  it('nessun residuo decimale sui valori scomodi in binario', () => {
    const out = toConfigPersistita({
      raggioStartKm: 0.1,
      stepKm: 0.7,
      raggioMaxKm: 2.9,
      durataRoundOre: 0.35,
    });
    for (const v of Object.values(out)) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(out).toEqual({ raggioStartM: 100, stepM: 700, raggioMaxM: 2900, intervalloMin: 21 });
  });
});
