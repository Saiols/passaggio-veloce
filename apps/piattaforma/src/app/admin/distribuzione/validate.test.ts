import { describe, it, expect } from 'vitest';
import {
  configDistribuzioneSchema,
  toConfigPersistita,
  DURATA_ROUND_MIN_MAX,
  DURATA_ROUND_MIN_MIN,
  RAGGIO_MAX_KM_MAX,
  RAGGIO_MAX_KM_MIN,
  RAGGIO_START_KM_MIN,
  STEP_DURATA_MIN_INPUT,
  STEP_KM_INPUT,
  STEP_KM_MAX,
  STEP_KM_MIN,
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
  ])('%s: i valori tipici cadono sulla griglia min + n·step', (_campo, min, step, valori) => {
    for (const v of valori as number[]) {
      expect(suGriglia(v, min as number, step as number), `${v} non è su min+n·step`).toBe(true);
    }
  });
});

/** Settimana valida di riferimento: LUN-VEN attivi, weekend spento. */
const ORARI_OK = {
  LUN: { attivo: true, inizio: '09:00', fine: '19:00' },
  MAR: { attivo: true, inizio: '09:00', fine: '19:00' },
  MER: { attivo: true, inizio: '09:00', fine: '19:00' },
  GIO: { attivo: true, inizio: '09:00', fine: '19:00' },
  VEN: { attivo: true, inizio: '09:00', fine: '19:00' },
  SAB: { attivo: false, inizio: '09:00', fine: '13:00' },
  DOM: { attivo: false, inizio: '09:00', fine: '19:00' },
};

describe('configDistribuzioneSchema', () => {
  const OK = {
    raggioStartKm: 1,
    stepKm: 1,
    raggioMaxKm: 10,
    durataRoundMin: 60,
    orariSettimana: ORARI_OK,
    festivi: [],
  };

  it('accetta i valori di default', () => {
    expect(configDistribuzioneSchema.safeParse(OK).success).toBe(true);
  });

  it('accetta gli estremi ammessi', () => {
    const estremi = {
      raggioStartKm: RAGGIO_START_KM_MIN,
      stepKm: STEP_KM_MAX,
      raggioMaxKm: RAGGIO_MAX_KM_MAX,
      durataRoundMin: DURATA_ROUND_MIN_MAX,
      orariSettimana: ORARI_OK,
      festivi: [],
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
    expect(configDistribuzioneSchema.safeParse({ ...OK, durataRoundMin: NaN }).success).toBe(false);
  });
});

describe('toConfigPersistita', () => {
  it('converte km→metri arrotondando a interi; i minuti passano invariati', () => {
    expect(
      toConfigPersistita({
        raggioStartKm: 0.3,
        stepKm: 1.5,
        raggioMaxKm: 12.4,
        durataRoundMin: 15,
        orariSettimana: ORARI_OK,
        festivi: [],
      }),
    ).toEqual({
      raggioStartM: 300,
      stepM: 1500,
      raggioMaxM: 12400,
      intervalloMin: 15,
      orariSettimana: ORARI_OK,
      festivi: [],
    });
  });

  // 0,1 km in floating point è 100.00000000000001 m: senza arrotondamento
  // finirebbe in una colonna INTEGER.
  it('nessun residuo decimale sui valori scomodi in binario (km)', () => {
    const out = toConfigPersistita({
      raggioStartKm: 0.1,
      stepKm: 0.7,
      raggioMaxKm: 2.9,
      durataRoundMin: 21,
      orariSettimana: ORARI_OK,
      festivi: [],
    });
    for (const [k, v] of Object.entries(out)) {
      if (k === 'orariSettimana' || k === 'festivi') continue; // non sono numeri: passano invariati
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(out).toEqual({
      raggioStartM: 100,
      stepM: 700,
      raggioMaxM: 2900,
      intervalloMin: 21,
      orariSettimana: ORARI_OK,
      festivi: [],
    });
  });
});

const BASE = {
  raggioStartKm: 1,
  stepKm: 1,
  raggioMaxKm: 10,
  durataRoundMin: 60,
  orariSettimana: ORARI_OK,
  festivi: [],
};

describe('durata round in minuti', () => {
  it('accetta il minimo e il massimo', () => {
    expect(configDistribuzioneSchema.safeParse({ ...BASE, durataRoundMin: 1 }).success).toBe(true);
    expect(configDistribuzioneSchema.safeParse({ ...BASE, durataRoundMin: 60 }).success).toBe(true);
  });

  it('rifiuta sotto 1 e sopra 60', () => {
    expect(configDistribuzioneSchema.safeParse({ ...BASE, durataRoundMin: 0 }).success).toBe(false);
    expect(configDistribuzioneSchema.safeParse({ ...BASE, durataRoundMin: 61 }).success).toBe(false);
  });

  it('rifiuta i minuti frazionari: il cron gira al minuto', () => {
    expect(configDistribuzioneSchema.safeParse({ ...BASE, durataRoundMin: 1.5 }).success).toBe(false);
  });

  it('copia i minuti in intervalloMin senza convertire', () => {
    const out = toConfigPersistita({ ...BASE, durataRoundMin: 7 });
    expect(out.intervalloMin).toBe(7);
  });

  it('lo step dell input divide la griglia dei valori ammessi', () => {
    // Il browser considera validi solo `min + n·step`: uno step che non divide
    // l'intervallo marcherebbe come invalidi dei valori legittimi.
    expect((DURATA_ROUND_MIN_MAX - DURATA_ROUND_MIN_MIN) % STEP_DURATA_MIN_INPUT).toBe(0);
  });
});

const BASE_ORARI = { ...BASE, orariSettimana: ORARI_OK };

describe('orari settimana', () => {
  it('accetta una settimana valida', () => {
    expect(configDistribuzioneSchema.safeParse(BASE_ORARI).success).toBe(true);
  });

  it('rifiuta fine <= inizio su un giorno ATTIVO', () => {
    const out = configDistribuzioneSchema.safeParse({
      ...BASE_ORARI,
      orariSettimana: { ...ORARI_OK, LUN: { attivo: true, inizio: '19:00', fine: '09:00' } },
    });
    expect(out.success).toBe(false);
  });

  it('tollera fine <= inizio su un giorno SPENTO: quegli orari non hanno effetto', () => {
    const out = configDistribuzioneSchema.safeParse({
      ...BASE_ORARI,
      orariSettimana: { ...ORARI_OK, DOM: { attivo: false, inizio: '19:00', fine: '09:00' } },
    });
    expect(out.success).toBe(true);
  });

  it('rifiuta zero giorni attivi: congelerebbe ogni pratica dopo il primo round', () => {
    const spenti = Object.fromEntries(
      Object.entries(ORARI_OK).map(([g, f]) => [g, { ...f, attivo: false }]),
    );
    const out = configDistribuzioneSchema.safeParse({ ...BASE_ORARI, orariSettimana: spenti });
    expect(out.success).toBe(false);
    if (!out.success) {
      expect(out.error.issues.some((i) => i.message.includes('almeno un giorno'))).toBe(true);
    }
  });

  it('rifiuta un orario malformato', () => {
    const out = configDistribuzioneSchema.safeParse({
      ...BASE_ORARI,
      orariSettimana: { ...ORARI_OK, LUN: { attivo: true, inizio: '9:00', fine: '19:00' } },
    });
    expect(out.success).toBe(false);
  });

  it('gli orari escono da toConfigPersistita così come sono entrati', () => {
    expect(toConfigPersistita(BASE_ORARI).orariSettimana).toEqual(ORARI_OK);
  });
});

describe('festivi', () => {
  it('accetta una lista valida', () => {
    const out = configDistribuzioneSchema.safeParse({
      ...BASE_ORARI,
      festivi: [{ data: '2026-12-25', nome: 'Natale' }],
    });
    expect(out.success).toBe(true);
  });

  it('accetta la lista vuota', () => {
    expect(configDistribuzioneSchema.safeParse({ ...BASE_ORARI, festivi: [] }).success).toBe(true);
  });

  it('rifiuta una data impossibile', () => {
    const out = configDistribuzioneSchema.safeParse({
      ...BASE_ORARI,
      festivi: [{ data: '2026-02-30', nome: 'Mai' }],
    });
    expect(out.success).toBe(false);
  });

  it('rifiuta un nome vuoto', () => {
    const out = configDistribuzioneSchema.safeParse({
      ...BASE_ORARI,
      festivi: [{ data: '2026-12-25', nome: '  ' }],
    });
    expect(out.success).toBe(false);
  });
});
