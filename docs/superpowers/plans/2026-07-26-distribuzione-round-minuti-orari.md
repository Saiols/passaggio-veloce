# Distribuzione: round in minuti, calendario piattaforma, copertura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere la durata del round configurabile in minuti (1–60) con cron al minuto, sostituire la fascia oraria unica con un calendario per giorno più festivi, misurare l'attesa fra round in minuti *lavorativi*, e rendere diagnosticabile perché una sede non è stata contattata.

**Architecture:** Il calendario (fasce per giorno + festivi) vive in due colonne `JSONB` sulla riga singleton `distribuzione_config`, parsate in modo difensivo da un modulo puro `lib/distribuzione/calendario.ts`. Il gate orario di `orario-piattaforma.ts` valuta giorno attivo → non festivo → dentro fascia, e una nuova funzione pura `minutiLavorativiTra` sostituisce la sottrazione di calendario nel gate del tick. La UI admin diventa editabile su durata, giorni/orari e festivi. Un modulo separato `lib/distribuzione/copertura.ts` ri-esegue la query dei candidati **senza** i filtri di idoneità e classifica ogni sede, alimentando una card admin sul dettaglio pratica.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), Prisma + Postgres (Neon in prod), zod, vitest, Tailwind con design system PV, cron Vercel.

## Global Constraints

- **Fuso orario:** ogni ragionamento su giorni e ore è in `Europe/Rome`, mai nel fuso del processo (su Vercel è UTC). La conversione wall-clock→UTC ha **una sola** implementazione: `lib/date/rome-day.ts`. Non riscriverla altrove.
- **Fail-open:** la config malformata o illeggibile degrada ai default, mai a "distribuzione ferma". Un JSON storto non deve bloccare la piattaforma.
- **Persistenza in metri e minuti:** il DB non cambia unità. `intervalloMin` è già in minuti; è il form che smette di convertire.
- **Migration a mano + `db:deploy`.** Mai `pnpm db:migrate` (propone `DROP SEQUENCE`, distruttivo).
- **Il primo round ignora il calendario:** `avviaRound1ForPratica` parte a qualsiasi ora, in qualsiasi giorno, festivi inclusi. Nessun task cambia questo.
- **Test:** `pnpm --filter piattaforma test <path>` (vitest). Il typecheck a cache fredda è inaffidabile in questo repo: fidarsi dei test e di `pnpm --filter piattaforma typecheck` solo con tsbuildinfo caldo.
- **Niente colori hardcoded** nei componenti: usare le classi `pv-*` del design system.
- **Commit** in italiano, imperativo, scope fra parentesi (es. `feat(distribuzione): ...`).

---

### Task 1: Modulo calendario (tipi, default, parsing difensivo)

Modulo puro e browser-safe: lo importeranno sia il motore (server) sia la validazione zod del form admin (client). Nessun import di `@pv/db` né di `server-only`.

**Files:**
- Create: `apps/piattaforma/src/lib/distribuzione/calendario.ts`
- Test: `apps/piattaforma/src/lib/distribuzione/calendario.test.ts`

**Interfaces:**
- Consumes: `GiornoSettimana` da `./ore-lavorative`, `parseYmd` da `@/lib/date/rome-day`.
- Produces: `FasciaGiorno`, `Festivo`, `CalendarioPiattaforma`, `GIORNI_ORDINE`, `ORARI_SETTIMANA_DEFAULT`, `FESTIVI_DEFAULT`, `CALENDARIO_DEFAULT`, `isHHMM(v): v is string`, `hhmmToMinuti(s): number`, `parseOrariSettimana(raw): Record<GiornoSettimana, FasciaGiorno>`, `parseFestivi(raw): Festivo[]`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/distribuzione/calendario.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CALENDARIO_DEFAULT,
  ORARI_SETTIMANA_DEFAULT,
  hhmmToMinuti,
  isHHMM,
  parseFestivi,
  parseOrariSettimana,
} from './calendario';

describe('isHHMM', () => {
  it('accetta 09:00 e 23:59', () => {
    expect(isHHMM('09:00')).toBe(true);
    expect(isHHMM('23:59')).toBe(true);
  });

  it('rifiuta ore o minuti fuori range e formati sbagliati', () => {
    expect(isHHMM('24:00')).toBe(false);
    expect(isHHMM('09:60')).toBe(false);
    expect(isHHMM('9:00')).toBe(false); // ore sempre a due cifre
    expect(isHHMM('0900')).toBe(false);
    expect(isHHMM(900)).toBe(false);
    expect(isHHMM(null)).toBe(false);
  });
});

describe('hhmmToMinuti', () => {
  it('converte in minuti dalla mezzanotte', () => {
    expect(hhmmToMinuti('00:00')).toBe(0);
    expect(hhmmToMinuti('09:30')).toBe(570);
    expect(hhmmToMinuti('19:00')).toBe(1140);
  });
});

describe('parseOrariSettimana', () => {
  it('null → default completi (fail-open)', () => {
    expect(parseOrariSettimana(null)).toEqual(ORARI_SETTIMANA_DEFAULT);
  });

  it('valore non-oggetto → default completi', () => {
    expect(parseOrariSettimana('9-19')).toEqual(ORARI_SETTIMANA_DEFAULT);
    expect(parseOrariSettimana([])).toEqual(ORARI_SETTIMANA_DEFAULT);
  });

  it('legge le fasce valide', () => {
    const out = parseOrariSettimana({
      LUN: { attivo: true, inizio: '08:00', fine: '20:00' },
      SAB: { attivo: true, inizio: '09:00', fine: '13:00' },
    });
    expect(out.LUN).toEqual({ attivo: true, inizio: '08:00', fine: '20:00' });
    expect(out.SAB).toEqual({ attivo: true, inizio: '09:00', fine: '13:00' });
  });

  it('giorno assente → default DI QUEL giorno, gli altri restano validi', () => {
    const out = parseOrariSettimana({ LUN: { attivo: false, inizio: '10:00', fine: '12:00' } });
    expect(out.LUN).toEqual({ attivo: false, inizio: '10:00', fine: '12:00' });
    expect(out.MAR).toEqual(ORARI_SETTIMANA_DEFAULT.MAR);
  });

  it('fascia malformata → default di quel giorno, NON "chiuso"', () => {
    // Interpretare un JSON storto come chiusura fermerebbe la distribuzione:
    // il fail-open del modulo config vale anche qui.
    const out = parseOrariSettimana({
      LUN: { attivo: true, inizio: '25:00', fine: '19:00' },
      MAR: { attivo: 'si', inizio: '09:00', fine: '19:00' },
      MER: 'aperto',
    });
    expect(out.LUN).toEqual(ORARI_SETTIMANA_DEFAULT.LUN);
    expect(out.MAR).toEqual(ORARI_SETTIMANA_DEFAULT.MAR);
    expect(out.MER).toEqual(ORARI_SETTIMANA_DEFAULT.MER);
  });

  it('fine <= inizio → default di quel giorno', () => {
    const out = parseOrariSettimana({ LUN: { attivo: true, inizio: '19:00', fine: '09:00' } });
    expect(out.LUN).toEqual(ORARI_SETTIMANA_DEFAULT.LUN);
  });
});

describe('parseFestivi', () => {
  it('null o non-array → lista vuota', () => {
    expect(parseFestivi(null)).toEqual([]);
    expect(parseFestivi({ data: '2026-12-25' })).toEqual([]);
  });

  it('scarta le date impossibili senza invalidare le altre', () => {
    const out = parseFestivi([
      { data: '2026-02-30', nome: 'Inesistente' },
      { data: '2026-12-25', nome: 'Natale' },
      { data: 'domani', nome: 'Boh' },
      { nome: 'Senza data' },
    ]);
    expect(out).toEqual([{ data: '2026-12-25', nome: 'Natale' }]);
  });

  it('ordina per data e deduplica tenendo la prima occorrenza', () => {
    const out = parseFestivi([
      { data: '2026-12-25', nome: 'Natale' },
      { data: '2026-08-15', nome: 'Ferragosto' },
      { data: '2026-12-25', nome: 'Duplicato' },
    ]);
    expect(out).toEqual([
      { data: '2026-08-15', nome: 'Ferragosto' },
      { data: '2026-12-25', nome: 'Natale' },
    ]);
  });

  it('nome mancante o vuoto → etichetta di ripiego, mai scarto della data', () => {
    expect(parseFestivi([{ data: '2026-12-25', nome: '   ' }])).toEqual([
      { data: '2026-12-25', nome: 'Festivo' },
    ]);
    expect(parseFestivi([{ data: '2026-12-25' }])).toEqual([
      { data: '2026-12-25', nome: 'Festivo' },
    ]);
  });

  it('tronca i nomi lunghissimi a 60 caratteri', () => {
    const out = parseFestivi([{ data: '2026-12-25', nome: 'x'.repeat(200) }]);
    expect(out[0]!.nome).toHaveLength(60);
  });
});

describe('CALENDARIO_DEFAULT', () => {
  it('LUN-VEN attivi, weekend spento — la configurazione oggi in produzione', () => {
    expect(CALENDARIO_DEFAULT.orariSettimana.LUN.attivo).toBe(true);
    expect(CALENDARIO_DEFAULT.orariSettimana.VEN.attivo).toBe(true);
    expect(CALENDARIO_DEFAULT.orariSettimana.SAB.attivo).toBe(false);
    expect(CALENDARIO_DEFAULT.orariSettimana.DOM.attivo).toBe(false);
    expect(CALENDARIO_DEFAULT.festivi).toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/calendario.test.ts`
Expected: FAIL — `Failed to resolve import "./calendario"`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `apps/piattaforma/src/lib/distribuzione/calendario.ts`:

```ts
/**
 * Calendario della piattaforma: quando la distribuzione può allargare il raggio.
 *
 * Puro e browser-safe (nessun `server-only`, nessun accesso al DB): lo usano sia
 * il motore sia la validazione del form admin.
 *
 * Tutto il parsing è DIFENSIVO e fail-open: un valore malformato ricade sul
 * default di quel giorno, mai su "chiuso". Interpretare un JSON storto come
 * chiusura fermerebbe l'espansione di ogni pratica in piattaforma — una
 * conseguenza peggiore di quella di un DB irraggiungibile, che in
 * `getDistribuzioneConfig` degrada già ai default.
 */
import { parseYmd } from '@/lib/date/rome-day';
import type { GiornoSettimana } from './ore-lavorative';

/** Finestra di apertura di un singolo giorno della settimana. */
export type FasciaGiorno = { attivo: boolean; inizio: string; fine: string };

/** Giorno di chiusura della piattaforma (data piena, non ricorrenza). */
export type Festivo = { data: string; nome: string };

export type CalendarioPiattaforma = {
  orariSettimana: Record<GiornoSettimana, FasciaGiorno>;
  festivi: Festivo[];
};

/** Ordine di presentazione (lunedì-first), non l'ordine di `Date.getDay()`. */
export const GIORNI_ORDINE: readonly GiornoSettimana[] = [
  'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM',
];

/** Lunghezza massima dell'etichetta di un festivo. */
const NOME_FESTIVO_MAX = 60;

/**
 * Default = la configurazione oggi in produzione (LUN-VEN 09:00-19:00, weekend
 * spento). I giorni spenti hanno comunque una fascia sensata: attivarli dal
 * pannello non deve costringere a digitare anche gli orari.
 */
export const ORARI_SETTIMANA_DEFAULT: Record<GiornoSettimana, FasciaGiorno> = {
  LUN: { attivo: true, inizio: '09:00', fine: '19:00' },
  MAR: { attivo: true, inizio: '09:00', fine: '19:00' },
  MER: { attivo: true, inizio: '09:00', fine: '19:00' },
  GIO: { attivo: true, inizio: '09:00', fine: '19:00' },
  VEN: { attivo: true, inizio: '09:00', fine: '19:00' },
  SAB: { attivo: false, inizio: '09:00', fine: '13:00' },
  DOM: { attivo: false, inizio: '09:00', fine: '19:00' },
};

export const FESTIVI_DEFAULT: Festivo[] = [];

export const CALENDARIO_DEFAULT: CalendarioPiattaforma = {
  orariSettimana: ORARI_SETTIMANA_DEFAULT,
  festivi: FESTIVI_DEFAULT,
};

const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True se `v` è un orario "HH:MM" a due cifre e nei range reali. */
export function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && RE_HHMM.test(v);
}

/** "09:30" → 570. Assume un valore già validato da `isHHMM`. */
export function hhmmToMinuti(s: string): number {
  const m = RE_HHMM.exec(s)!;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Una fascia è valida se ben tipata e con `fine` strettamente dopo `inizio`. */
function fasciaValida(v: unknown): v is FasciaGiorno {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  if (typeof f.attivo !== 'boolean') return false;
  if (!isHHMM(f.inizio) || !isHHMM(f.fine)) return false;
  return hhmmToMinuti(f.fine) > hhmmToMinuti(f.inizio);
}

/**
 * JSON persistito → fasce per giorno. Ogni giorno è valutato da solo: una riga
 * malformata non contamina le altre.
 */
export function parseOrariSettimana(raw: unknown): Record<GiornoSettimana, FasciaGiorno> {
  const src =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const out = {} as Record<GiornoSettimana, FasciaGiorno>;
  for (const g of GIORNI_ORDINE) {
    const v = src[g];
    out[g] = fasciaValida(v)
      ? { attivo: v.attivo, inizio: v.inizio, fine: v.fine }
      : ORARI_SETTIMANA_DEFAULT[g];
  }
  return out;
}

/**
 * JSON persistito → festivi ordinati e deduplicati. Una data impossibile viene
 * scartata da sola (`parseYmd` fa il round-trip su Date), senza invalidare la
 * lista: un errore di battitura su una riga non deve riaprire tutte le altre.
 */
export function parseFestivi(raw: unknown): Festivo[] {
  if (!Array.isArray(raw)) return [];

  const perData = new Map<string, Festivo>();
  for (const v of raw) {
    if (typeof v !== 'object' || v === null) continue;
    const f = v as Record<string, unknown>;
    if (typeof f.data !== 'string' || !parseYmd(f.data)) continue;
    if (perData.has(f.data)) continue; // prima occorrenza vince

    const nomeRaw = typeof f.nome === 'string' ? f.nome.trim() : '';
    perData.set(f.data, {
      data: f.data,
      nome: (nomeRaw || 'Festivo').slice(0, NOME_FESTIVO_MAX),
    });
  }

  return [...perData.values()].sort((a, b) => a.data.localeCompare(b.data));
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/calendario.test.ts`
Expected: PASS, 15 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/calendario.ts apps/piattaforma/src/lib/distribuzione/calendario.test.ts
git commit -m "feat(distribuzione): modulo calendario con parsing difensivo di fasce e festivi"
```

---

### Task 2: Esportare la conversione wall-clock → UTC

`romeWallClockToUtc` è già scritta e già corretta sul DST (doppio passaggio sull'offset), ma è privata. Il calcolo dei minuti lavorativi ha bisogno di costruire gli estremi di una fascia: va **esportata**, non ricopiata — una seconda implementazione del fuso è esattamente il tipo di duplicazione che poi diverge.

**Files:**
- Modify: `apps/piattaforma/src/lib/date/rome-day.ts:47`
- Test: `apps/piattaforma/src/lib/date/rome-day.test.ts` (creare se assente, altrimenti aggiungere il blocco)

**Interfaces:**
- Produces: `romeWallClockToUtc(y, mo, d, h, mi, s, ms): Date` — `mo` è 1-12.

- [ ] **Step 1: Scrivi il test che fallisce**

Aggiungi in `apps/piattaforma/src/lib/date/rome-day.test.ts` (se il file non esiste, crealo con questo contenuto):

```ts
import { describe, it, expect } from 'vitest';
import { romeWallClockToUtc } from './rome-day';

describe('romeWallClockToUtc', () => {
  // Offset verificati con Intl.DateTimeFormat({timeZone:'Europe/Rome'}):
  // 2026-03-28 (sab) = CET +1h; 2026-03-30 (lun) = CEST +2h — il cambio è
  // domenica 2026-03-29. 2026-10-24 (sab) = CEST +2h; 2026-10-26 (lun) = CET +1h.
  it('ora solare (CET, +1): 09:00 a Roma = 08:00 UTC', () => {
    expect(romeWallClockToUtc(2026, 3, 28, 9, 0, 0, 0).toISOString()).toBe(
      '2026-03-28T08:00:00.000Z',
    );
  });

  it('ora legale (CEST, +2): 09:00 a Roma = 07:00 UTC', () => {
    expect(romeWallClockToUtc(2026, 3, 30, 9, 0, 0, 0).toISOString()).toBe(
      '2026-03-30T07:00:00.000Z',
    );
  });

  it('ritorno all ora solare in ottobre', () => {
    expect(romeWallClockToUtc(2026, 10, 24, 19, 0, 0, 0).toISOString()).toBe(
      '2026-10-24T17:00:00.000Z',
    );
    expect(romeWallClockToUtc(2026, 10, 26, 19, 0, 0, 0).toISOString()).toBe(
      '2026-10-26T18:00:00.000Z',
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/date/rome-day.test.ts`
Expected: FAIL — `romeWallClockToUtc is not exported` (o `is not a function`).

- [ ] **Step 3: Esporta la funzione**

In `apps/piattaforma/src/lib/date/rome-day.ts`, aggiungi `export` alla dichiarazione esistente e documenta perché è pubblica:

```ts
/**
 * Istante UTC corrispondente all'ora di parete indicata nel fuso di Roma.
 *
 * Pubblica: la usa anche `lib/distribuzione/orario-piattaforma.ts` per
 * costruire gli estremi di una fascia oraria. Una seconda implementazione del
 * fuso finirebbe per divergere su DST — questa è la sola.
 */
export function romeWallClockToUtc(
```

Nessun'altra modifica al corpo.

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/date/rome-day.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/date/rome-day.ts apps/piattaforma/src/lib/date/rome-day.test.ts
git commit -m "refactor(date): esporto romeWallClockToUtc come fonte unica del wall-clock di Roma"
```

---

### Task 3: Migration additiva e schema Prisma

Solo DB e schema. Il codice non legge ancora le colonne nuove, quindi tutto resta verde. Le colonne sono **nullable**: `null` è un input legittimo che il parsing del Task 1 traduce nei default, il che rende superfluo un default SQL lungo e illeggibile.

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (modello `DistribuzioneConfig`)
- Create: `packages/db/prisma/migrations/20260726120000_distribuzione_calendario/migration.sql`

**Interfaces:**
- Produces: colonne `orariSettimana` e `festivi` (`JSONB`, nullable) su `distribuzione_config`; campi Prisma `orariSettimana Json?` e `festivi Json?`.

- [ ] **Step 1: Aggiorna lo schema Prisma**

In `packages/db/prisma/schema.prisma`, nel modello `DistribuzioneConfig`, aggiungi le due colonne **senza rimuovere** le tre vecchie (verranno droppate nel Task 11, dopo il deploy):

```prisma
model DistribuzioneConfig {
  id            String   @id @default("singleton")
  raggioStartM  Int      @default(1000)
  stepM         Int      @default(1000)
  raggioMaxM    Int      @default(10000)
  intervalloMin Int      @default(60)

  // Legacy: sostituite da `orariSettimana`. Droppate dalla migration
  // 20260726130000, DOPO il deploy del codice che non le legge più.
  orarioInizio String @default("09:00")
  orarioFine   String @default("19:00")
  giorni       String @default("LUN,MAR,MER,GIO,VEN")

  // Calendario della piattaforma. Nullable: `null` è un input legittimo che il
  // parsing difensivo (lib/distribuzione/calendario.ts) traduce nei default.
  orariSettimana Json?
  festivi        Json?

  updatedAt DateTime @updatedAt

  @@map("distribuzione_config")
}
```

- [ ] **Step 2: Scrivi la migration SQL**

Crea `packages/db/prisma/migrations/20260726120000_distribuzione_calendario/migration.sql`:

```sql
-- Calendario della piattaforma: fasce per giorno + festivi.
-- Colonne NULLABLE: null → il parsing applicativo usa i default (fail-open).
ALTER TABLE "distribuzione_config"
  ADD COLUMN "orariSettimana" JSONB,
  ADD COLUMN "festivi" JSONB;

-- Conversione FEDELE della configurazione esistente: la fascia unica diventa la
-- fascia di ogni giorno, e i giorni elencati in `giorni` restano gli attivi.
-- Il sabato corto NON viene introdotto qui: e' una scelta operativa da fare dal
-- pannello. I giorni spenti ricevono comunque una fascia sensata.
UPDATE "distribuzione_config" SET "orariSettimana" = jsonb_build_object(
  'LUN', jsonb_build_object('attivo', "giorni" LIKE '%LUN%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'MAR', jsonb_build_object('attivo', "giorni" LIKE '%MAR%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'MER', jsonb_build_object('attivo', "giorni" LIKE '%MER%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'GIO', jsonb_build_object('attivo', "giorni" LIKE '%GIO%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'VEN', jsonb_build_object('attivo', "giorni" LIKE '%VEN%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'SAB', jsonb_build_object('attivo', "giorni" LIKE '%SAB%', 'inizio', '09:00', 'fine', '13:00'),
  'DOM', jsonb_build_object('attivo', "giorni" LIKE '%DOM%', 'inizio', "orarioInizio", 'fine', "orarioFine")
) WHERE "id" = 'singleton';

-- Festivi nazionali italiani FUTURI (da agosto 2026) e tutto il 2027.
-- Pasquetta calcolata col computus gregoriano, non a memoria:
-- Pasqua 2027 = 28/03 (domenica) -> Pasquetta 29/03/2027.
-- La domenica di Pasqua non e' in elenco: la domenica e' gia' un giorno spento.
UPDATE "distribuzione_config" SET "festivi" = '[
  {"data":"2026-08-15","nome":"Ferragosto"},
  {"data":"2026-11-01","nome":"Ognissanti"},
  {"data":"2026-12-08","nome":"Immacolata"},
  {"data":"2026-12-25","nome":"Natale"},
  {"data":"2026-12-26","nome":"Santo Stefano"},
  {"data":"2027-01-01","nome":"Capodanno"},
  {"data":"2027-01-06","nome":"Epifania"},
  {"data":"2027-03-29","nome":"Lunedì dell''Angelo"},
  {"data":"2027-04-25","nome":"Liberazione"},
  {"data":"2027-05-01","nome":"Festa del Lavoro"},
  {"data":"2027-06-02","nome":"Festa della Repubblica"},
  {"data":"2027-08-15","nome":"Ferragosto"},
  {"data":"2027-11-01","nome":"Ognissanti"},
  {"data":"2027-12-08","nome":"Immacolata"},
  {"data":"2027-12-25","nome":"Natale"},
  {"data":"2027-12-26","nome":"Santo Stefano"}
]'::jsonb WHERE "id" = 'singleton';
```

Nota sull'apostrofo: `Lunedì dell''Angelo` usa il raddoppio, che è l'escape SQL standard dentro una stringa quotata.

- [ ] **Step 3: Applica la migration in locale e verifica il risultato**

```bash
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db db:generate
```

Poi verifica il contenuto reale, senza dedurlo dal fatto che il comando non ha protestato:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c \
  "SELECT jsonb_pretty(\"orariSettimana\"), jsonb_array_length(\"festivi\") FROM distribuzione_config;"
```

Expected: le sette chiavi LUN..DOM con `attivo` true su LUN-VEN e false su SAB/DOM, `inizio` 09:00 e `fine` 19:00; `jsonb_array_length` = 16.

- [ ] **Step 4: Verifica che la suite resti verde**

Run: `pnpm --filter piattaforma test`
Expected: PASS — nessun codice legge ancora le colonne nuove.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260726120000_distribuzione_calendario
git commit -m "feat(db): colonne orariSettimana e festivi su distribuzione_config"
```

---

### Task 4: Il DTO diventa un calendario e il gate orario ragiona per giorno

Task coeso: il tipo `DistribuzioneConfigDTO` e i suoi consumatori diretti cambiano insieme, perché è il tipo stesso a cambiare forma. Alla fine il gate valuta **giorno attivo → non festivo → dentro fascia**.

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/config.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.test.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/config.test.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.test.ts:59-67` (la costante `CFG`)
- Modify: `apps/piattaforma/src/app/admin/distribuzione/client.tsx:205-227` (box read-only)

**Interfaces:**
- Consumes: `CalendarioPiattaforma`, `CALENDARIO_DEFAULT`, `parseOrariSettimana`, `parseFestivi`, `hhmmToMinuti`, `GIORNI_ORDINE` dal Task 1; `romeYmd` da `@/lib/date/rome-day`.
- Produces: `DistribuzioneConfigDTO` con `orariSettimana: Record<GiornoSettimana, FasciaGiorno>` e `festivi: Festivo[]` al posto di `orarioInizio`/`orarioFine`/`giorni`; `isOrarioLavorativo(now: Date, cal: CalendarioPiattaforma): boolean`; `giornoSettimanaDa([y, mo, d]): GiornoSettimana`; `ymdKey([y, mo, d]): string`.

Nota di tipo: `isOrarioLavorativo` accetta `CalendarioPiattaforma`, non l'intero DTO. Il DTO lo soddisfa strutturalmente, quindi `isOrarioLavorativo(now, cfg)` in `tick.ts` continua a compilare senza modifiche, e la funzione resta testabile con un oggetto minimo.

- [ ] **Step 1: Scrivi i test che falliscono**

Sostituisci il contenuto di `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isOrarioLavorativo } from './orario-piattaforma';
import { CALENDARIO_DEFAULT, type CalendarioPiattaforma } from './calendario';

// Istanti UTC fissi (mai l'orologio del runner), scelti in luglio: a Roma è
// CEST (UTC+2), quindi l'ora di parete è UTC+2h. Weekday verificati con
// Intl: 2026-07-22 mercoledì, 24 venerdì, 25 sabato, 26 domenica.
function utc(h: number, m: number, day = 22): Date {
  return new Date(Date.UTC(2026, 6, day, h, m, 0));
}

const CAL = CALENDARIO_DEFAULT;

describe('isOrarioLavorativo', () => {
  it('mercoledì 10:00 (Rome) → true', () => {
    expect(isOrarioLavorativo(utc(8, 0), CAL)).toBe(true);
  });

  it('mercoledì 20:00 (Rome) → false (dopo la fine)', () => {
    expect(isOrarioLavorativo(utc(18, 0), CAL)).toBe(false);
  });

  it('bordo 09:00 incluso, bordo 19:00 escluso', () => {
    expect(isOrarioLavorativo(utc(7, 0), CAL)).toBe(true);
    expect(isOrarioLavorativo(utc(17, 0), CAL)).toBe(false);
  });

  it('sabato e domenica spenti nei default → false', () => {
    expect(isOrarioLavorativo(utc(8, 0, 25), CAL)).toBe(false);
    expect(isOrarioLavorativo(utc(8, 0, 26), CAL)).toBe(false);
  });

  it('sabato corto: attivo 09:00-13:00 → true alle 10:00, false alle 14:00', () => {
    const cal: CalendarioPiattaforma = {
      ...CAL,
      orariSettimana: {
        ...CAL.orariSettimana,
        SAB: { attivo: true, inizio: '09:00', fine: '13:00' },
      },
    };
    expect(isOrarioLavorativo(utc(8, 0, 25), cal)).toBe(true); // 10:00 Rome
    expect(isOrarioLavorativo(utc(12, 0, 25), cal)).toBe(false); // 14:00 Rome
  });

  it('un festivo spegne un giorno altrimenti attivo', () => {
    const cal: CalendarioPiattaforma = {
      ...CAL,
      festivi: [{ data: '2026-07-22', nome: 'Test' }],
    };
    expect(isOrarioLavorativo(utc(8, 0), CAL)).toBe(true);
    expect(isOrarioLavorativo(utc(8, 0), cal)).toBe(false);
  });

  it('il festivo si valuta sul GIORNO DI ROMA, non su quello UTC', () => {
    // 2026-07-22T22:30Z = 23 luglio 00:30 a Roma: se il festivo è il 23, il
    // gate deve essere chiuso anche se in UTC è ancora il 22.
    const cal: CalendarioPiattaforma = {
      ...CAL,
      festivi: [{ data: '2026-07-23', nome: 'Test' }],
      orariSettimana: {
        ...CAL.orariSettimana,
        GIO: { attivo: true, inizio: '00:00', fine: '23:59' },
      },
    };
    expect(isOrarioLavorativo(new Date(Date.UTC(2026, 6, 22, 22, 30)), cal)).toBe(false);
  });

  it('fuso: 07:30 UTC è dentro la finestra perché a Roma sono le 09:30', () => {
    expect(utc(7, 30).getUTCHours()).toBeLessThan(9); // il calcolo naive fallirebbe
    expect(isOrarioLavorativo(utc(7, 30), CAL)).toBe(true);
  });
});
```

Sostituisci il contenuto di `apps/piattaforma/src/lib/distribuzione/config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

beforeEach(() => findFirstMock.mockReset());

describe('getDistribuzioneConfig', () => {
  it('riga assente → default completi', async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(getDistribuzioneConfig()).resolves.toEqual(DISTRIBUZIONE_DEFAULT);
  });

  it('errore del DB → default (fail-open, la distribuzione non si ferma)', async () => {
    findFirstMock.mockRejectedValue(new Error('connessione persa'));
    await expect(getDistribuzioneConfig()).resolves.toEqual(DISTRIBUZIONE_DEFAULT);
  });

  it('legge raggi, durata, fasce e festivi dalla riga', async () => {
    findFirstMock.mockResolvedValue(ROW);
    const cfg = await getDistribuzioneConfig();
    expect(cfg.raggioMaxM).toBe(20000);
    expect(cfg.intervalloMin).toBe(15);
    expect(cfg.orariSettimana.LUN).toEqual({ attivo: true, inizio: '08:00', fine: '20:00' });
    expect(cfg.orariSettimana.SAB).toEqual({ attivo: true, inizio: '09:00', fine: '13:00' });
    expect(cfg.festivi).toEqual([{ data: '2026-12-25', nome: 'Natale' }]);
  });

  it('colonne nuove a null → calendario di default, resto della riga rispettato', async () => {
    findFirstMock.mockResolvedValue({ ...ROW, orariSettimana: null, festivi: null });
    const cfg = await getDistribuzioneConfig();
    expect(cfg.orariSettimana).toEqual(ORARI_SETTIMANA_DEFAULT);
    expect(cfg.festivi).toEqual([]);
    expect(cfg.raggioMaxM).toBe(20000);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/orario-piattaforma.test.ts src/lib/distribuzione/config.test.ts`
Expected: FAIL — `isOrarioLavorativo` riceve un calendario ma legge ancora `cfg.giorni`; `cfg.orariSettimana` è `undefined`.

- [ ] **Step 3: Aggiorna `config.ts`**

Sostituisci il DTO, i default e la lettura in `apps/piattaforma/src/lib/distribuzione/config.ts`:

```ts
import { cache } from 'react';
import { prisma, type Prisma, type PrismaClient } from '@pv/db';
import {
  CALENDARIO_DEFAULT,
  parseFestivi,
  parseOrariSettimana,
  type CalendarioPiattaforma,
} from './calendario';

/** Accetta sia il client globale sia una transazione. */
type DistribuzioneConfigClient = PrismaClient | Prisma.TransactionClient;

/**
 * Config del motore. Estende `CalendarioPiattaforma`, così le funzioni che
 * hanno bisogno solo del calendario (`isOrarioLavorativo`, `minutiLavorativiTra`)
 * accettano il DTO senza che il DTO le costringa a dipendere da raggi e durate.
 */
export type DistribuzioneConfigDTO = CalendarioPiattaforma & {
  raggioStartM: number;
  stepM: number;
  raggioMaxM: number;
  intervalloMin: number;
};

/**
 * Default: primo anello 1 km, +1 km per round, un round all'ora, max 10 km,
 * calendario LUN-VEN 09-19 senza festivi.
 *
 * Valgono solo finché la riga singleton non esiste (o non è leggibile).
 */
export const DISTRIBUZIONE_DEFAULT: DistribuzioneConfigDTO = {
  raggioStartM: 1000,
  stepM: 1000,
  raggioMaxM: 10000,
  intervalloMin: 60,
  ...CALENDARIO_DEFAULT,
};

/**
 * Config distribuzione corrente: la riga singleton `distribuzione_config`
 * (fallback a `DISTRIBUZIONE_DEFAULT` se assente).
 *
 * Avvolto in React `cache()` → dedup per-request, NESSUNA cache persistente:
 * ogni modifica dall'admin si riflette al tick successivo.
 *
 * Fail-open su qualunque errore: la distribuzione non deve mai bloccarsi per un
 * blip del DB. Stesso principio dentro il calendario, dove un JSON malformato
 * ricade sui default invece che su "chiuso".
 */
export const getDistribuzioneConfig = cache(
  async (client: DistribuzioneConfigClient = prisma): Promise<DistribuzioneConfigDTO> => {
    try {
      const row = await client.distribuzioneConfig.findFirst({ where: { id: 'singleton' } });
      if (!row) return DISTRIBUZIONE_DEFAULT;
      return {
        raggioStartM: row.raggioStartM,
        stepM: row.stepM,
        raggioMaxM: row.raggioMaxM,
        intervalloMin: row.intervalloMin,
        orariSettimana: parseOrariSettimana(row.orariSettimana),
        festivi: parseFestivi(row.festivi),
      };
    } catch {
      return DISTRIBUZIONE_DEFAULT;
    }
  },
);
```

La funzione `parseGiorni` e l'import di `GiornoSettimana` spariscono da questo file (il parsing vive nel calendario). Se qualche altro modulo importa `parseGiorni`, verificalo con `grep -rn "parseGiorni" apps/piattaforma/src` e aggiornalo.

- [ ] **Step 4: Aggiorna `orario-piattaforma.ts`**

Sostituisci il contenuto di `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.ts`:

```ts
/**
 * Gate "calendario piattaforma" per l'espansione della distribuzione a raggio.
 *
 * Puro, senza accessi DB: riceve `now` e il calendario già risolto.
 *
 * Tre livelli, in quest'ordine: il giorno è attivo? la data non è un festivo?
 * l'ora cade nella fascia di quel giorno? Basta un no per fermare l'espansione.
 *
 * Fuso: le fasce sono ore di parete italiane, ma su Vercel il processo gira in
 * UTC. Giorno e minuti si calcolano quindi in `Europe/Rome` tramite
 * `lib/date/rome-day.ts`, mai con `now.getHours()/getDay()`.
 */

import { romeYmd } from '@/lib/date/rome-day';
import type { GiornoSettimana } from './ore-lavorative';
import { hhmmToMinuti, type CalendarioPiattaforma } from './calendario';

/** Mapping in ordine `getUTCDay()`: domenica = 0. */
const GIORNI_GETDAY: readonly GiornoSettimana[] = [
  'DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB',
];

/** Giorno della settimana di una data di calendario (già risolta a Roma). */
export function giornoSettimanaDa([y, mo, d]: [number, number, number]): GiornoSettimana {
  // Date.UTC qui è solo un modo neutro di ricavare il weekday da (y, mo, d):
  // il fuso è già stato applicato a monte da romeYmd.
  return GIORNI_GETDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}

/** Chiave `YYYY-MM-DD` di una data di calendario, per il confronto coi festivi. */
export function ymdKey([y, mo, d]: [number, number, number]): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * True se `now` (in ora di Roma) cade in un giorno attivo, non festivo, e
 * dentro `[inizio, fine)` — l'estremo di fine è ESCLUSO (19:00 → false).
 */
export function isOrarioLavorativo(now: Date, cal: CalendarioPiattaforma): boolean {
  const ymd = romeYmd(now);
  const fascia = cal.orariSettimana[giornoSettimanaDa(ymd)];
  if (!fascia.attivo) return false;
  if (cal.festivi.some((f) => f.data === ymdKey(ymd))) return false;

  const minuti = minutiDelGiornoRoma(now);
  return minuti >= hhmmToMinuti(fascia.inizio) && minuti < hhmmToMinuti(fascia.fine);
}

/** Minuti dalla mezzanotte di `instant`, letti nel fuso di Roma. */
function minutiDelGiornoRoma(instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  return g.hour! * 60 + g.minute!;
}
```

- [ ] **Step 5: Adegua i due consumatori che non compilano più**

In `apps/piattaforma/src/lib/distribuzione/tick.test.ts`, nella costante `CFG` (righe 59-67), sostituisci le tre chiavi legacy:

```ts
const CFG = {
  raggioStartM: 500,
  stepM: 200,
  raggioMaxM: 10000,
  intervalloMin: 10,
  orariSettimana: {
    LUN: { attivo: true, inizio: '09:00', fine: '19:00' },
    MAR: { attivo: true, inizio: '09:00', fine: '19:00' },
    MER: { attivo: true, inizio: '09:00', fine: '19:00' },
    GIO: { attivo: true, inizio: '09:00', fine: '19:00' },
    VEN: { attivo: true, inizio: '09:00', fine: '19:00' },
    SAB: { attivo: false, inizio: '09:00', fine: '13:00' },
    DOM: { attivo: false, inizio: '09:00', fine: '19:00' },
  },
  festivi: [],
};
```

In `apps/piattaforma/src/app/admin/distribuzione/client.tsx`, il box read-only (righe 205-227) legge `config.orarioInizio` / `config.orarioFine` / `config.giorni`. Diventa editabile nel Task 7; qui va solo reso compilabile, mostrando il riepilogo dai nuovi campi. Sostituisci le due `<div>` "Orario" e "Giorni" con una sola:

```tsx
<div className="col-span-2">
  <dt className="text-pv-slate-500">Calendario</dt>
  <dd className="font-semibold text-pv-navy-800">
    {GIORNI_ORDINE.filter((g) => config.orariSettimana[g].attivo)
      .map((g) => `${GIORNI_LABEL[g]} ${config.orariSettimana[g].inizio}–${config.orariSettimana[g].fine}`)
      .join(' · ') || 'Nessun giorno attivo'}
  </dd>
</div>
```

e aggiungi l'import `import { GIORNI_ORDINE } from '@/lib/distribuzione/calendario';`.

- [ ] **Step 6: Esegui l'intera suite**

Run: `pnpm --filter piattaforma test`
Expected: PASS. Se `tick.test.ts` fallisce su `isOrarioLavorativo`, ricorda che è mockato (`vi.mock('./orario-piattaforma')`): il mock va lasciato com'è.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione apps/piattaforma/src/app/admin/distribuzione/client.tsx
git commit -m "feat(distribuzione): calendario per giorno con festivi al posto della fascia unica"
```

---

### Task 5: Attesa misurata in minuti lavorativi

Il pezzo più delicato della release e il meno osservabile a occhio: i test vengono **prima**. Il gate del tick smette di sottrarre due istanti e conta solo i minuti che cadono dentro le finestre di apertura.

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.test.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts:30-60` (costante di grazia + helper) e `:254-259` (il gate)
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.test.ts`

**Interfaces:**
- Consumes: `romeWallClockToUtc`, `romeYmd` da `@/lib/date/rome-day`; `giornoSettimanaDa`, `ymdKey` dal Task 4.
- Produces: `minutiLavorativiTra(da: Date, a: Date, cal: CalendarioPiattaforma, cap: number): number`.

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in coda a `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.test.ts`:

```ts
import { minutiLavorativiTra } from './orario-piattaforma';

// Luglio 2026, Roma = CEST (UTC+2). Finestra default 09:00-19:00 = 07:00-17:00 UTC.
// Weekday: 22 mer, 23 gio, 24 ven, 25 sab, 26 dom, 27 lun.
const U = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 6, day, h, m));

describe('minutiLavorativiTra', () => {
  it('stessa giornata, tutto dentro la finestra', () => {
    // 10:00 → 11:30 ora di Roma.
    expect(minutiLavorativiTra(U(22, 8), U(22, 9, 30), CAL, 10_000)).toBe(90);
  });

  it('ritaglia le code fuori finestra', () => {
    // 06:00 → 21:00 Roma: contano solo le 10 ore di apertura.
    expect(minutiLavorativiTra(U(22, 4), U(22, 19), CAL, 10_000)).toBe(600);
  });

  it('attraversa la notte: 18:00 → 09:30 del giorno dopo = 60 + 30', () => {
    expect(minutiLavorativiTra(U(22, 16), U(23, 7, 30), CAL, 10_000)).toBe(90);
  });

  it('attraversa il weekend: venerdì 18:00 → lunedì 09:30 = 60 + 30', () => {
    expect(minutiLavorativiTra(U(24, 16), U(27, 7, 30), CAL, 10_000)).toBe(90);
  });

  it('un festivo vale zero minuti', () => {
    const cal: CalendarioPiattaforma = {
      ...CAL,
      festivi: [{ data: '2026-07-23', nome: 'Test' }],
    };
    // Mercoledì 18:00 → giovedì 18:00. Senza festivo: 60 (mer) + 540 (gio 9-18).
    expect(minutiLavorativiTra(U(22, 16), U(23, 16), CAL, 10_000)).toBe(600);
    // Con giovedì festivo resta solo l'ora del mercoledì.
    expect(minutiLavorativiTra(U(22, 16), U(23, 16), cal, 10_000)).toBe(60);
  });

  it('intervallo interamente fuori finestra → 0', () => {
    // Sabato: giorno spento.
    expect(minutiLavorativiTra(U(25, 8), U(25, 12), CAL, 10_000)).toBe(0);
  });

  it('a <= da → 0', () => {
    expect(minutiLavorativiTra(U(22, 9), U(22, 8), CAL, 10_000)).toBe(0);
    expect(minutiLavorativiTra(U(22, 9), U(22, 9), CAL, 10_000)).toBe(0);
  });

  it('early-exit sul cap: si ferma al primo giorno che lo supera', () => {
    // Da mercoledì 09:00 Rome a cinque anni dopo. Senza early-exit il totale
    // sarebbe di centinaia di migliaia di minuti; con il cap la funzione si
    // ferma alla fine della PRIMA giornata utile: 09:00-19:00 = 600.
    const lontano = new Date(Date.UTC(2031, 6, 22, 7));
    expect(minutiLavorativiTra(U(22, 7), lontano, CAL, 60)).toBe(600);
  });

  it('calendario tutto spento su un intervallo enorme → 0 e termina', () => {
    // Nessun early-exit possibile: è la guardia sul numero di giorni a fermare
    // la scansione. Il test fallirebbe per timeout se la guardia mancasse.
    const spento: CalendarioPiattaforma = {
      festivi: [],
      orariSettimana: Object.fromEntries(
        (['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'] as const).map((g) => [
          g,
          { attivo: false, inizio: '09:00', fine: '19:00' },
        ]),
      ) as CalendarioPiattaforma['orariSettimana'],
    };
    expect(minutiLavorativiTra(new Date(Date.UTC(2020, 0, 1)), U(22, 8), spento, 60)).toBe(0);
  });

  it('DST: la finestra resta di 10 ore anche nel giorno del cambio', () => {
    // Lunedì 30 marzo 2026, primo giorno di ora legale (CEST, +2).
    const da = new Date(Date.UTC(2026, 2, 30, 7)); // 09:00 Rome
    const a = new Date(Date.UTC(2026, 2, 30, 17)); // 19:00 Rome
    expect(minutiLavorativiTra(da, a, CAL, 10_000)).toBe(600);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/orario-piattaforma.test.ts`
Expected: FAIL — `minutiLavorativiTra is not a function`.

- [ ] **Step 3: Implementa `minutiLavorativiTra`**

Aggiungi in coda a `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.ts` (e aggiungi `romeWallClockToUtc` all'import da `@/lib/date/rome-day`):

```ts
/**
 * Guardia anti-loop: oltre un anno di scansione l'input è patologico (o il
 * calendario è tutto spento, e allora non c'è nulla da sommare). Senza, un
 * `da` molto vecchio con calendario chiuso itererebbe indefinitamente.
 */
const MAX_GIORNI_SCANSIONE = 400;

/** Millisecondi in un minuto, per non ripetere il numero magico. */
const MS_PER_MIN = 60_000;

/**
 * Minuti di ORARIO LAVORATIVO fra `da` e `a`, secondo il calendario: i minuti
 * fuori finestra, nei giorni spenti e nei festivi valgono zero.
 *
 * È il metro con cui si misura la durata di un round. Serve a garantire che
 * ogni cerchio di agenzie abbia la sua finestra piena per rispondere: con una
 * semplice sottrazione, una pratica inviata di notte vedrebbe partire il round
 * successivo nell'istante stesso dell'apertura.
 *
 * `cap` è la soglia che interessa al chiamante: appena il totale la raggiunge
 * la scansione si ferma. Senza, una pratica ferma da settimane costerebbe una
 * iterazione per giorno a ogni tick, per ogni pratica.
 *
 * Pura: nessun DB, nessun `Date.now()` — solo i due istanti ricevuti.
 */
export function minutiLavorativiTra(
  da: Date,
  a: Date,
  cal: CalendarioPiattaforma,
  cap: number,
): number {
  if (!(a.getTime() > da.getTime())) return 0;

  const festivi = new Set(cal.festivi.map((f) => f.data));
  let totale = 0;
  let ymd = romeYmd(da);

  for (let i = 0; i < MAX_GIORNI_SCANSIONE; i += 1) {
    const chiave = ymdKey(ymd);
    const fascia = cal.orariSettimana[giornoSettimanaDa(ymd)];

    if (fascia.attivo && !festivi.has(chiave)) {
      const [y, mo, d] = ymd;
      const [hi, mi] = fascia.inizio.split(':').map(Number) as [number, number];
      const [hf, mf] = fascia.fine.split(':').map(Number) as [number, number];
      const apertura = romeWallClockToUtc(y, mo, d, hi, mi, 0, 0).getTime();
      const chiusura = romeWallClockToUtc(y, mo, d, hf, mf, 0, 0).getTime();

      const inizio = Math.max(da.getTime(), apertura);
      const fine = Math.min(a.getTime(), chiusura);
      if (fine > inizio) totale += (fine - inizio) / MS_PER_MIN;

      if (totale >= cap) return totale;
    }

    // Giorno successivo: si passa da mezzogiorno, l'unica ora di parete che il
    // DST non sposta mai fuori dal proprio giorno.
    const mezzogiorno = romeWallClockToUtc(ymd[0], ymd[1], ymd[2], 12, 0, 0, 0);
    const domani = new Date(mezzogiorno.getTime() + 24 * 60 * MS_PER_MIN);
    if (domani.getTime() > a.getTime() + 24 * 60 * MS_PER_MIN) break;
    ymd = romeYmd(domani);
  }

  return totale;
}
```

- [ ] **Step 4: Esegui i test del modulo**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/orario-piattaforma.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivi il test del gate nel tick**

In `apps/piattaforma/src/lib/distribuzione/tick.test.ts`, il mock del modulo orario va esteso alla nuova funzione. Sostituisci la riga `vi.mock('./orario-piattaforma', ...)`:

```ts
vi.mock('./orario-piattaforma', () => ({
  isOrarioLavorativo: orarioMock,
  minutiLavorativiTra: minutiLavorativiMock,
}));
```

e aggiungi `minutiLavorativiMock: vi.fn()` al blocco `vi.hoisted` in cima (accanto a `orarioMock`).

Aggiungi poi questi casi nel `describe('tickPratica')`:

```ts
it('attende se i minuti LAVORATIVI trascorsi sono sotto la durata del round', async () => {
  cfgMock.mockResolvedValue({ ...CFG, intervalloMin: 60 });
  orarioMock.mockReturnValue(true);
  // Otto ore di calendario, ma solo 5 minuti dentro la finestra: si attende.
  minutiLavorativiMock.mockReturnValue(5);
  prismaMock.pratica.findUnique.mockResolvedValue(
    praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T00:20:00Z') }),
  );

  const res = await tickPratica('p1');

  expect(res).toEqual({ status: 'noop', reason: 'durata round non trascorsa' });
  expect(prismaMock.sede.findMany).not.toHaveBeenCalled();
});

it('espande quando i minuti lavorativi raggiungono la durata del round', async () => {
  cfgMock.mockResolvedValue({ ...CFG, intervalloMin: 60 });
  orarioMock.mockReturnValue(true);
  minutiLavorativiMock.mockReturnValue(60);
  prismaMock.pratica.findUnique.mockResolvedValue(
    praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T07:00:00Z') }),
  );
  tx.pratica.findUnique.mockResolvedValue(
    praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T07:00:00Z') }),
  );
  prismaMock.sede.findMany.mockResolvedValue([
    { id: 's1', lat: kmLat(0.6), lng: LNG0, companyId: 'c1' },
  ]);
  tx.praticaAssegnazione.create.mockResolvedValue({ id: 'a1' });
  tx.pratica.update.mockResolvedValue({});
  tx.praticaStatoLog.create.mockResolvedValue({});

  const res = await tickPratica('p1');

  expect(res.status).toBe('notified');
});

it('la grazia è di secondi, non di un minuto intero', async () => {
  // Con durata 2 min, a 1 minuto e mezzo di lavoro NON si deve espandere:
  // la vecchia grazia da 1 minuto lo avrebbe fatto passare.
  cfgMock.mockResolvedValue({ ...CFG, intervalloMin: 2 });
  orarioMock.mockReturnValue(true);
  minutiLavorativiMock.mockReturnValue(1.5);
  prismaMock.pratica.findUnique.mockResolvedValue(
    praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T07:00:00Z') }),
  );

  const res = await tickPratica('p1');

  expect(res).toEqual({ status: 'noop', reason: 'durata round non trascorsa' });
});
```

Nei test già esistenti che arrivano oltre il gate, imposta `minutiLavorativiMock.mockReturnValue(10_000)` nel `beforeEach`, così il gate non li blocca: `beforeEach(() => { ...; minutiLavorativiMock.mockReturnValue(10_000); })`.

- [ ] **Step 6: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/tick.test.ts`
Expected: FAIL — il tick usa ancora `minutesSince`, quindi il caso "5 minuti lavorativi" espande invece di attendere.

- [ ] **Step 7: Aggiorna il gate in `tick.ts`**

In `apps/piattaforma/src/lib/distribuzione/tick.ts`:

1. Import: `import { isOrarioLavorativo, minutiLavorativiTra } from './orario-piattaforma';`
2. Sostituisci il commento e il valore di `ESPANSIONE_GRACE_MIN` (righe 30-38):

```ts
/**
 * Grazia (min) sul gate della durata round. Il cron gira ogni minuto e Vercel
 * non garantisce il trigger al secondo: senza grazia un tick che arriva un
 * istante prima della scadenza slitterebbe di un giro intero. 0,2 min = 12
 * secondi assorbono il jitter senza accorciare in modo percepibile un round.
 *
 * ⚠️ Deve restare MOLTO minore della durata minima configurabile (1 minuto):
 * il valore precedente, 1 minuto, avrebbe dimezzato ogni round da 2 minuti.
 */
const ESPANSIONE_GRACE_MIN = 0.2;
```

3. Elimina la funzione `minutesSince` (righe 57-60), ora senza chiamanti.
4. Sostituisci il gate (righe 254-259):

```ts
  // Gate durata round, misurata in minuti LAVORATIVI: i minuti fuori finestra,
  // nei giorni spenti e nei festivi non contano. Così ogni cerchio ha la sua
  // finestra piena per rispondere anche quando la pratica è arrivata di notte.
  // Solo le notifiche reali muovono `ultimaEspansioneAt`: un round vuoto non
  // consuma tempo.
  if (
    pratica.ultimaEspansioneAt &&
    minutiLavorativiTra(pratica.ultimaEspansioneAt, now, cfg, cfg.intervalloMin) <
      cfg.intervalloMin - ESPANSIONE_GRACE_MIN
  ) {
    return noop('durata round non trascorsa');
  }
```

- [ ] **Step 8: Esegui l'intera suite**

Run: `pnpm --filter piattaforma test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione
git commit -m "feat(distribuzione): attesa fra round misurata in minuti lavorativi"
```

---

### Task 6: Cron al minuto e durata round in minuti nel pannello

Il campo passa da ore a minuti e smette di convertire: il DB è già in minuti. Il cron scende a un minuto, altrimenti nessuna durata sotto i 10 minuti sarebbe rispettabile.

**Files:**
- Modify: `apps/piattaforma/vercel.json:5-7`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/validate.ts`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/validate.test.ts`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/client.tsx`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/actions.test.ts`

**Interfaces:**
- Produces: `DURATA_ROUND_MIN_MIN = 1`, `DURATA_ROUND_MIN_MAX = 60`, `STEP_DURATA_MIN_INPUT = 1`; il campo dello schema si chiama `durataRoundMin` e `toConfigPersistita` lo copia in `intervalloMin` senza conversione.
- Rimuove: `DURATA_ROUND_ORE_MIN`, `DURATA_ROUND_ORE_MAX`, `STEP_ORE_INPUT`, il campo `durataRoundOre`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `apps/piattaforma/src/app/admin/distribuzione/validate.test.ts` sostituisci i casi sulla durata:

```ts
import {
  configDistribuzioneSchema,
  toConfigPersistita,
  DURATA_ROUND_MIN_MAX,
  DURATA_ROUND_MIN_MIN,
  STEP_DURATA_MIN_INPUT,
} from './validate';

const BASE = { raggioStartKm: 1, stepKm: 1, raggioMaxKm: 10, durataRoundMin: 60 };

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
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/app/admin/distribuzione/validate.test.ts`
Expected: FAIL — `DURATA_ROUND_MIN_MIN` non esiste; lo schema non conosce `durataRoundMin`.

- [ ] **Step 3: Aggiorna `validate.ts`**

Sostituisci le costanti sulla durata e il campo dello schema:

```ts
/**
 * Durata del round in MINUTI: è l'unità con cui il DB già memorizza
 * `intervalloMin`, e quella in cui ragiona chi configura la piattaforma.
 *
 * Il minimo di 1 minuto è il limite del cron, che gira ogni minuto. Vercel non
 * garantisce il trigger al secondo, quindi un round da 1 minuto vale in pratica
 * 1-2 minuti: l'hint del form lo dice esplicitamente.
 */
export const DURATA_ROUND_MIN_MIN = 1;
export const DURATA_ROUND_MIN_MAX = 60;
export const STEP_DURATA_MIN_INPUT = 1;
```

Nello schema, sostituisci il campo `durataRoundOre`:

```ts
    durataRoundMin: numero('la durata del round')
      .int('La durata del round va indicata in minuti interi')
      .min(DURATA_ROUND_MIN_MIN, `La durata minima di un round è ${DURATA_ROUND_MIN_MIN} min`)
      .max(DURATA_ROUND_MIN_MAX, `La durata di un round non può superare ${DURATA_ROUND_MIN_MAX} min`),
```

In `toConfigPersistita`, sostituisci la conversione:

```ts
    intervalloMin: input.durataRoundMin,
```

Elimina `DURATA_ROUND_ORE_MIN`, `DURATA_ROUND_ORE_MAX` e `STEP_ORE_INPUT`.

- [ ] **Step 4: Aggiorna il form**

In `apps/piattaforma/src/app/admin/distribuzione/client.tsx`:

1. Import: sostituisci le tre costanti sulle ore con `DURATA_ROUND_MIN_MAX`, `DURATA_ROUND_MIN_MIN`, `STEP_DURATA_MIN_INPUT`.
2. Elimina la funzione `toOre` e inizializza lo stato con i minuti: `useState<number | null>(config.intervalloMin)`, rinominando la variabile in `durataRoundMin` / `setDurataRoundMin`.
3. Sostituisci il campo:

```tsx
<Field
  label="Durata round (minuti)"
  required
  error={fDurata.error}
  hint={`Attesa di orario lavorativo prima di allargare il raggio. Tra ${DURATA_ROUND_MIN_MIN} e ${DURATA_ROUND_MIN_MAX} minuti. Il cron gira ogni minuto: sotto i 2 minuti la cadenza reale può variare di un minuto.`}
>
  <NumberInput
    value={durataRoundMin}
    onChange={setDurataRoundMin}
    onBlur={fDurata.onBlur}
    invalid={fDurata.invalid}
    min={DURATA_ROUND_MIN_MIN}
    max={DURATA_ROUND_MIN_MAX}
    step={STEP_DURATA_MIN_INPUT}
  />
</Field>
```

4. Aggiorna le due chiamate a `zodFieldErrors` e a `salvaConfigDistribuzione` sostituendo `durataRoundOre: durataRoundOre ?? NaN` con `durataRoundMin: durataRoundMin ?? NaN`, e `field('durataRoundOre')` con `field('durataRoundMin')`.
5. Nella frase di riepilogo, sostituisci `formatOre((roundMax - 1) * durataRoundOre)` con `formatMinuti((roundMax - 1) * durataRoundMin)` e rinomina la funzione in fondo al file:

```tsx
/** "2 h", "30 min", "1 h 30 min" — dai minuti, senza passare dalle ore. */
function formatMinuti(minutiTotali: number): string {
  const tot = Math.round(minutiTotali);
  const h = Math.floor(tot / 60);
  const m = tot % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
```

- [ ] **Step 5: Aggiorna il cron**

In `apps/piattaforma/vercel.json`, solo la prima entry:

```json
    {
      "path": "/api/jobs/distribuzione-tick",
      "schedule": "* * * * *"
    },
```

- [ ] **Step 6: Aggiorna `actions.test.ts` e verifica**

In `apps/piattaforma/src/app/admin/distribuzione/actions.test.ts`, sostituisci ogni `durataRoundOre: <n>` con `durataRoundMin: <n*60>` e le asserzioni su `intervalloMin` di conseguenza (es. `durataRoundOre: 1` → `durataRoundMin: 60`, `intervalloMin` resta 60).

Run: `pnpm --filter piattaforma test src/app/admin/distribuzione`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/vercel.json apps/piattaforma/src/app/admin/distribuzione
git commit -m "feat(distribuzione): durata round in minuti (1-60) e cron al minuto"
```

---

### Task 7: Giorni e orari editabili dal pannello

**Files:**
- Modify: `apps/piattaforma/src/app/admin/distribuzione/validate.ts`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/validate.test.ts`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/actions.ts`
- Create: `apps/piattaforma/src/app/admin/distribuzione/orari-settimana.tsx`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/client.tsx`

**Interfaces:**
- Consumes: `GIORNI_ORDINE`, `FasciaGiorno`, `isHHMM`, `hhmmToMinuti` dal Task 1.
- Produces: `fasciaGiornoSchema` e il campo `orariSettimana` dentro `configDistribuzioneSchema`; componente `<OrariSettimanaEditor value onChange />`; `toConfigPersistita` restituisce anche `orariSettimana`.

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in `validate.test.ts`:

```ts
const ORARI_OK = {
  LUN: { attivo: true, inizio: '09:00', fine: '19:00' },
  MAR: { attivo: true, inizio: '09:00', fine: '19:00' },
  MER: { attivo: true, inizio: '09:00', fine: '19:00' },
  GIO: { attivo: true, inizio: '09:00', fine: '19:00' },
  VEN: { attivo: true, inizio: '09:00', fine: '19:00' },
  SAB: { attivo: false, inizio: '09:00', fine: '13:00' },
  DOM: { attivo: false, inizio: '09:00', fine: '19:00' },
};
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
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/app/admin/distribuzione/validate.test.ts`
Expected: FAIL — lo schema ignora `orariSettimana` e `toConfigPersistita` non lo restituisce.

- [ ] **Step 3: Estendi lo schema**

In `validate.ts`, aggiungi (importando `GIORNI_ORDINE`, `hhmmToMinuti`, `isHHMM` da `@/lib/distribuzione/calendario`):

```ts
const orarioHHMM = z.string().refine(isHHMM, 'Usa il formato HH:MM (es. 09:00)');

const fasciaGiornoSchema = z
  .object({ attivo: z.boolean(), inizio: orarioHHMM, fine: orarioHHMM })
  // Un giorno spento non ha effetto sulla distribuzione: i suoi orari restano
  // salvati come promemoria e non vanno validati fra loro.
  .refine((f) => !f.attivo || hhmmToMinuti(f.fine) > hhmmToMinuti(f.inizio), {
    message: "L'orario di fine deve essere successivo a quello di inizio",
    path: ['fine'],
  });

const orariSettimanaSchema = z
  .object(Object.fromEntries(GIORNI_ORDINE.map((g) => [g, fasciaGiornoSchema])) as Record<
    (typeof GIORNI_ORDINE)[number],
    typeof fasciaGiornoSchema
  >)
  .refine((o) => Object.values(o).some((f) => f.attivo), {
    message: 'Attiva almeno un giorno: senza, nessuna pratica avanzerebbe oltre il primo round',
  });
```

Aggiungi `orariSettimana: orariSettimanaSchema` all'oggetto di `configDistribuzioneSchema` e restituiscilo da `toConfigPersistita`:

```ts
    orariSettimana: input.orariSettimana,
```

aggiornando anche il tipo di ritorno della funzione con `orariSettimana: ConfigDistribuzioneInput['orariSettimana']`.

- [ ] **Step 4: Salva la colonna nell'action**

In `actions.ts` il corpo non cambia (`toConfigPersistita` produce già l'oggetto passato a `upsert`). Verifica solo che il commento sopra la funzione citi anche il calendario:

```ts
 * L'input arriva in km e minuti (le unità del form) e viene convertito in metri
 * dalla `toConfigPersistita` DOPO la validazione. Il calendario (fasce per
 * giorno) passa invariato: è già nella forma in cui viene persistito.
```

- [ ] **Step 5: Scrivi il componente della tabella**

Crea `apps/piattaforma/src/app/admin/distribuzione/orari-settimana.tsx`:

```tsx
'use client';

import { Checkbox, Input } from '@/components/ui';
import { GIORNI_ORDINE, type FasciaGiorno } from '@/lib/distribuzione/calendario';
import type { GiornoSettimana } from '@/lib/distribuzione/ore-lavorative';

const GIORNI_LABEL: Record<GiornoSettimana, string> = {
  LUN: 'Lunedì',
  MAR: 'Martedì',
  MER: 'Mercoledì',
  GIO: 'Giovedì',
  VEN: 'Venerdì',
  SAB: 'Sabato',
  DOM: 'Domenica',
};

type Orari = Record<GiornoSettimana, FasciaGiorno>;

/**
 * Finestra di apertura giorno per giorno. Un giorno spento tiene comunque i suoi
 * orari (restano modificabili): riattivarlo non deve costringere a ridigitarli.
 */
export function OrariSettimanaEditor({
  value,
  onChange,
  errore,
}: {
  value: Orari;
  onChange: (v: Orari) => void;
  errore?: string;
}) {
  const set = (g: GiornoSettimana, patch: Partial<FasciaGiorno>): void => {
    onChange({ ...value, [g]: { ...value[g], ...patch } });
  };

  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="text-[15px] font-bold text-pv-navy-800">Giorni e orari</h2>
      <p className="mt-1 text-[13px] text-pv-slate-500">
        Quando il motore può allargare il raggio. Fuori da questa finestra parte solo il
        primo round: l&apos;espansione riprende alla successiva apertura. Gli orari
        dichiarati dalle agenzie non hanno effetto sulla distribuzione.
      </p>

      <ul className="mt-4 space-y-2">
        {GIORNI_ORDINE.map((g) => (
          <li
            key={g}
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
          >
            <label className="flex min-w-[130px] items-center gap-2 text-[13px] font-semibold text-pv-navy-800">
              <Checkbox
                checked={value[g].attivo}
                onChange={(e) => set(g, { attivo: e.currentTarget.checked })}
                aria-label={`${GIORNI_LABEL[g]} attivo`}
              />
              {GIORNI_LABEL[g]}
            </label>

            <div className="flex items-center gap-2 text-[13px] text-pv-slate-500">
              <span>dalle</span>
              <Input
                type="time"
                value={value[g].inizio}
                onChange={(e) => set(g, { inizio: e.currentTarget.value })}
                aria-label={`${GIORNI_LABEL[g]} dalle`}
                className="w-[110px]"
              />
              <span>alle</span>
              <Input
                type="time"
                value={value[g].fine}
                onChange={(e) => set(g, { fine: e.currentTarget.value })}
                aria-label={`${GIORNI_LABEL[g]} alle`}
                className="w-[110px]"
              />
            </div>

            {!value[g].attivo && (
              <span className="text-[12px] text-pv-slate-500">chiuso</span>
            )}
          </li>
        ))}
      </ul>

      {errore && <p className="mt-3 text-[12.5px] text-pv-red-600">{errore}</p>}
    </div>
  );
}
```

Se `Input` non è esportato da `@/components/ui`, importalo dal percorso diretto `@/components/ui/input`. Verifica anche il nome esatto della classe di testo per gli errori nel design system (`grep -rn "text-pv-red" apps/piattaforma/src/components/ui/field.tsx`) e allineati a quella.

- [ ] **Step 6: Monta il componente nel form**

In `client.tsx`:

1. `const [orariSettimana, setOrariSettimana] = useState(config.orariSettimana);`
2. Passa `orariSettimana` a `zodFieldErrors` e a `salvaConfigDistribuzione`.
3. Rimuovi il box "Altri parametri (fissi, sola lettura)" — resta solo la riga "Misura del raggio: linea d'aria", che puoi spostare come nota sotto ai campi del raggio. Con il box sparisce anche l'ultimo uso di `GIORNI_LABEL` e `GIORNI_ORDINE` in `client.tsx` (introdotti nel Task 4): rimuovi la costante e l'import, ora morti — l'etichetta dei giorni vive nel nuovo componente.
4. Inserisci `<OrariSettimanaEditor value={orariSettimana} onChange={setOrariSettimana} errore={field('orariSettimana').error} />` sotto la card dei parametri numerici.

- [ ] **Step 7: Verifica nel browser**

Un componente con checkbox e input `time` non è dimostrato verde dai test: due bug identici (tab che si spegne, focus rubato) erano invisibili alla suite. Avvia `pnpm --filter piattaforma dev`, apri `/admin/distribuzione` da admin platform e verifica **cliccando**:

- spuntando "Sabato" i due campi orario restano modificabili e il salvataggio riporta "Configurazione aggiornata";
- togliendo la spunta a tutti e sette i giorni il submit è bloccato con il messaggio "Attiva almeno un giorno...";
- impostando su un giorno attivo `fine` prima di `inizio` compare l'errore sul campo, e **non** all'apertura della pagina;
- ricaricando la pagina i valori salvati sono quelli mostrati.

- [ ] **Step 8: Esegui i test e committa**

Run: `pnpm --filter piattaforma test src/app/admin/distribuzione`
Expected: PASS.

```bash
git add apps/piattaforma/src/app/admin/distribuzione
git commit -m "feat(distribuzione): giorni e orari della piattaforma editabili dal pannello"
```

---

### Task 8: Festivi editabili e avviso di calendario scaduto

**Files:**
- Modify: `apps/piattaforma/src/app/admin/distribuzione/validate.ts`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/validate.test.ts`
- Create: `apps/piattaforma/src/app/admin/distribuzione/festivi.tsx`
- Create: `apps/piattaforma/src/app/admin/distribuzione/festivi-avviso.ts`
- Create: `apps/piattaforma/src/app/admin/distribuzione/festivi-avviso.test.ts`
- Modify: `apps/piattaforma/src/app/admin/distribuzione/client.tsx`

**Interfaces:**
- Consumes: `Festivo`, `parseYmd`.
- Produces: campo `festivi` nello schema e in `toConfigPersistita`; `<FestiviEditor value onChange />`; `serveAggiornareFestivi(festivi: Festivo[], oggi: Date, giorni?: number): boolean`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `apps/piattaforma/src/app/admin/distribuzione/festivi-avviso.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serveAggiornareFestivi } from './festivi-avviso';

const OGGI = new Date(Date.UTC(2026, 6, 26, 10, 0)); // 26 luglio 2026

describe('serveAggiornareFestivi', () => {
  it('lista vuota → avviso', () => {
    expect(serveAggiornareFestivi([], OGGI)).toBe(true);
  });

  it('solo festivi passati → avviso', () => {
    expect(serveAggiornareFestivi([{ data: '2026-01-01', nome: 'Capodanno' }], OGGI)).toBe(true);
  });

  it('un festivo entro i 60 giorni → nessun avviso', () => {
    expect(serveAggiornareFestivi([{ data: '2026-08-15', nome: 'Ferragosto' }], OGGI)).toBe(false);
  });

  it('festivi tutti oltre i 60 giorni → avviso: la copertura vicina manca', () => {
    expect(serveAggiornareFestivi([{ data: '2026-12-25', nome: 'Natale' }], OGGI)).toBe(true);
  });

  it('il confine si valuta sul giorno di Roma', () => {
    // 2026-09-24 è a 60 giorni esatti dal 26 luglio: dentro la finestra.
    expect(serveAggiornareFestivi([{ data: '2026-09-24', nome: 'X' }], OGGI)).toBe(false);
    expect(serveAggiornareFestivi([{ data: '2026-09-25', nome: 'X' }], OGGI)).toBe(true);
  });
});
```

Aggiungi in `validate.test.ts`:

```ts
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
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/app/admin/distribuzione`
Expected: FAIL — `festivi-avviso` non esiste, lo schema ignora `festivi`.

- [ ] **Step 3: Implementa l'avviso**

Crea `apps/piattaforma/src/app/admin/distribuzione/festivi-avviso.ts`:

```ts
import { romeYmd } from '@/lib/date/rome-day';
import type { Festivo } from '@/lib/distribuzione/calendario';

/** Preavviso di default: due mesi bastano ad accorgersene con calma. */
export const GIORNI_PREAVVISO_FESTIVI = 60;

/**
 * True se nessun festivo configurato cade nei prossimi `giorni`.
 *
 * Serve a evitare il decadimento silenzioso del calendario: le date sono piene,
 * non ricorrenze, quindi a ogni cambio d'anno la lista si esaurisce e la
 * piattaforma tornerebbe ad allargare il raggio a Natale senza che nulla lo
 * segnali. Puro: il confronto è fra stringhe `YYYY-MM-DD`, che si ordinano
 * lessicograficamente, sul giorno di Roma.
 */
export function serveAggiornareFestivi(
  festivi: Festivo[],
  oggi: Date,
  giorni: number = GIORNI_PREAVVISO_FESTIVI,
): boolean {
  const [y, m, d] = romeYmd(oggi);
  const oggiKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const limite = new Date(Date.UTC(y, m - 1, d + giorni));
  const limiteKey = limite.toISOString().slice(0, 10);

  return !festivi.some((f) => f.data >= oggiKey && f.data <= limiteKey);
}
```

- [ ] **Step 4: Estendi lo schema**

In `validate.ts`, aggiungi (importando `parseYmd` da `@/lib/date/rome-day`):

```ts
const festivoSchema = z.object({
  data: z.string().refine((v) => parseYmd(v) !== null, 'Data non valida (formato YYYY-MM-DD)'),
  nome: z.string().trim().min(1, 'Dai un nome al festivo').max(60),
});
```

Aggiungi `festivi: z.array(festivoSchema)` allo schema e `festivi: input.festivi` a `toConfigPersistita` (con il tipo di ritorno aggiornato).

- [ ] **Step 5: Scrivi il componente**

Crea `apps/piattaforma/src/app/admin/distribuzione/festivi.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { parseYmd } from '@/lib/date/rome-day';
import type { Festivo } from '@/lib/distribuzione/calendario';
import { serveAggiornareFestivi } from './festivi-avviso';

/** "2026-12-25" → "25/12/2026". */
function formatData(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Giorni di chiusura della piattaforma. Sono date piene, non ricorrenze: le
 * passate restano visibili in grigio, perché nasconderle darebbe l'impressione
 * che la lista si sia svuotata.
 */
export function FestiviEditor({
  value,
  onChange,
  oggiIso,
}: {
  value: Festivo[];
  onChange: (v: Festivo[]) => void;
  oggiIso: string;
}) {
  const [data, setData] = useState('');
  const [nome, setNome] = useState('');

  const aggiungi = (): void => {
    const nomeTrim = nome.trim();
    if (!parseYmd(data) || !nomeTrim) return;
    if (value.some((f) => f.data === data)) return;
    onChange(
      [...value, { data, nome: nomeTrim.slice(0, 60) }].sort((a, b) => a.data.localeCompare(b.data)),
    );
    setData('');
    setNome('');
  };

  const avviso = serveAggiornareFestivi(value, new Date(`${oggiIso}T12:00:00Z`));

  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="text-[15px] font-bold text-pv-navy-800">Festivi</h2>
      <p className="mt-1 text-[13px] text-pv-slate-500">
        Giorni in cui il raggio non si allarga, anche se il giorno della settimana è
        attivo. Il primo round parte comunque.
      </p>

      {avviso && (
        <div className="mt-3">
          <Alert variant="warning" title="Calendario da aggiornare">
            Nessun festivo configurato nei prossimi due mesi. Sono date piene, non
            ricorrenze: senza aggiungere quelle dell&apos;anno prossimo, la distribuzione
            si allargherà normalmente anche a Natale.
          </Alert>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {value.map((f) => (
          <li
            key={f.data}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
          >
            <span className={f.data < oggiIso ? 'text-[13px] text-pv-slate-400' : 'text-[13px] text-pv-navy-800'}>
              <strong>{formatData(f.data)}</strong> · {f.nome}
              {f.data < oggiIso && ' (passato)'}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.data !== f.data))}
              className="shrink-0 text-[12px] font-bold uppercase tracking-wider text-pv-slate-500 hover:text-pv-navy-800"
            >
              Rimuovi
            </button>
          </li>
        ))}
        {value.length === 0 && (
          <li className="text-[13px] text-pv-slate-500">Nessun festivo configurato.</li>
        )}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Input
          type="date"
          value={data}
          onChange={(e) => setData(e.currentTarget.value)}
          aria-label="Data del festivo"
          className="w-[170px]"
        />
        <Input
          value={nome}
          onChange={(e) => setNome(e.currentTarget.value)}
          placeholder="Nome (es. Ferragosto)"
          aria-label="Nome del festivo"
          className="w-[220px]"
        />
        <Button type="button" variant="secondary" onClick={aggiungi}>
          Aggiungi
        </Button>
      </div>
    </div>
  );
}
```

Verifica i nomi delle prop di `Button` (`variant="secondary"` esiste?) con `grep -n "variant" apps/piattaforma/src/components/ui/button.tsx` e allineati.

- [ ] **Step 6: Monta nel form**

In `client.tsx`: `const [festivi, setFestivi] = useState(config.festivi);`, passa `festivi` a `zodFieldErrors` e all'action, e inserisci `<FestiviEditor value={festivi} onChange={setFestivi} oggiIso={oggiIso} />` sotto la tabella dei giorni.

`oggiIso` va calcolato lato server e passato come prop dalla page (`page.tsx`), non con `new Date()` dentro il client: il giorno che conta è quello di Roma, non quello del browser dell'admin.

In `page.tsx`:

```tsx
import { romeYmd } from '@/lib/date/rome-day';
...
const [y, m, d] = romeYmd(new Date());
const oggiIso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
...
<DistribuzioneConfigClient config={config} oggiIso={oggiIso} />
```

- [ ] **Step 7: Verifica nel browser**

Su `/admin/distribuzione`: aggiungi un festivo, salva, ricarica e verifica che sia ancora lì; rimuovilo e salva; svuota la lista e verifica che compaia l'avviso giallo.

- [ ] **Step 8: Esegui i test e committa**

Run: `pnpm --filter piattaforma test src/app/admin/distribuzione`
Expected: PASS.

```bash
git add apps/piattaforma/src/app/admin/distribuzione
git commit -m "feat(distribuzione): festivi configurabili con avviso di calendario in scadenza"
```

---

### Task 9: Modulo copertura

Risponde a "perché questa pratica non è arrivata a quella sede". Stessa query dei candidati, **senza** i filtri di idoneità, più la classificazione dei motivi.

**Files:**
- Create: `apps/piattaforma/src/lib/distribuzione/copertura.ts`
- Create: `apps/piattaforma/src/lib/distribuzione/copertura.test.ts`

**Interfaces:**
- Consumes: `getDistribuzioneConfig`, `distanceKm` da `@/lib/geo/coords`, `isVisuraScaduta` da `@/lib/visura/validita`.
- Produces: `MOTIVI_ESCLUSIONE`, `MotivoEsclusione`, `labelMotivo(m): string`, `SedeCopertura`, `Copertura`, `getCoperturaPratica(praticaId): Promise<Copertura | null>`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `apps/piattaforma/src/lib/distribuzione/copertura.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock, cfgMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn() },
    sede: { findMany: vi.fn() },
  },
  cfgMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./config', () => ({ getDistribuzioneConfig: cfgMock }));

import { getCoperturaPratica } from './copertura';

const LAT0 = 45;
const LNG0 = 12;
/** Latitudine spostata di `km` esatti rispetto a LAT0. */
function kmLat(km: number): number {
  return LAT0 + (km / 6371) * (180 / Math.PI);
}

const OGGI = new Date('2026-07-26T10:00:00Z');
const VISURA_OK = new Date('2026-06-01T00:00:00Z');
const VISURA_SCADUTA = new Date('2024-12-13T00:00:00Z');

function sede(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    nome: 'Sede 1',
    citta: 'Assago',
    lat: kmLat(4),
    lng: LNG0,
    companyId: 'c1',
    suspendedAt: null,
    company: {
      ragioneSociale: 'Agenzia 1',
      deletedAt: null,
      suspendedAt: null,
      bloccoPagamentoAt: null,
      visuraCameraleData: VISURA_OK,
    },
    ...over,
  };
}

// Il modulo chiama `new Date()` per valutare la visura: l'orologio va fissato,
// e poi RIPRISTINATO — dei fake timer lasciati attivi avvelenerebbero i file
// di test eseguiti dopo questo nello stesso worker.
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(OGGI);
  cfgMock.mockResolvedValue({ raggioMaxM: 10000 });
  prismaMock.pratica.findUnique.mockResolvedValue({
    id: 'p1',
    lat: LAT0,
    lng: LNG0,
    raggioCorrenteM: 2000,
    distribuzioneCiclo: 1,
    assegnazioni: [],
  });
});

describe('getCoperturaPratica', () => {
  it('pratica inesistente → null', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(null);
    await expect(getCoperturaPratica('nope')).resolves.toBeNull();
  });

  it('sede idonea oltre il raggio corrente → in attesa, con la distanza', async () => {
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(1);
    expect(out!.sedi[0]!.stato).toBe('in-attesa');
    expect(out!.sedi[0]!.distanzaM).toBe(4000);
    expect(out!.sedi[0]!.motivo).toBeNull();
  });

  it('sede già contattata → contattata, con round ed esito', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      id: 'p1',
      lat: LAT0,
      lng: LNG0,
      raggioCorrenteM: 5000,
      distribuzioneCiclo: 1,
      assegnazioni: [{ sedeId: 's1', ciclo: 1, round: 2, esito: 'PENDING' }],
    });
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('contattata');
    expect(out!.sedi[0]!.round).toBe(2);
    expect(out!.sedi[0]!.esito).toBe('PENDING');
  });

  it('visura oltre 180 giorni → esclusa con motivo VISURA_SCADUTA', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ company: { ...sede().company, visuraCameraleData: VISURA_SCADUTA } }),
    ]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('esclusa');
    expect(out!.sedi[0]!.motivo).toBe('VISURA_SCADUTA');
  });

  it('visura null → NON è un motivo di esclusione (i null sono esenti)', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ company: { ...sede().company, visuraCameraleData: null } }),
    ]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('in-attesa');
  });

  it('sede sospesa, azienda sospesa e blocco pagamento hanno motivi distinti', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ id: 'a', suspendedAt: OGGI }),
      sede({ id: 'b', company: { ...sede().company, suspendedAt: OGGI } }),
      sede({ id: 'c', company: { ...sede().company, bloccoPagamentoAt: OGGI } }),
    ]);
    const out = await getCoperturaPratica('p1');
    const motivi = Object.fromEntries(out!.sedi.map((s) => [s.sedeId, s.motivo]));
    expect(motivi).toEqual({ a: 'SEDE_SOSPESA', b: 'AZIENDA_SOSPESA', c: 'BLOCCO_PAGAMENTO' });
  });

  it('revoca admin → esclusione permanente, anche se la sede è idonea', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      id: 'p1',
      lat: LAT0,
      lng: LNG0,
      raggioCorrenteM: 5000,
      distribuzioneCiclo: 2,
      assegnazioni: [{ sedeId: 's1', ciclo: 1, round: 1, esito: 'REVOCATA_ADMIN' }],
    });
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('esclusa');
    expect(out!.sedi[0]!.motivo).toBe('REVOCATA_ADMIN');
  });

  it('sedi oltre il raggio massimo non compaiono', async () => {
    prismaMock.sede.findMany.mockResolvedValue([sede({ lat: kmLat(40) })]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(0);
  });

  it('sedi senza coordinate finiscono in una lista separata, senza distanza inventata', async () => {
    prismaMock.sede.findMany.mockResolvedValue([sede({ id: 'x', lat: null, lng: null })]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(0);
    expect(out!.senzaCoordinate).toEqual([{ sedeId: 'x', nome: 'Sede 1', citta: 'Assago' }]);
  });

  it('pratica senza coordinate → nessuna distanza calcolabile, solo la lista senza coord', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      id: 'p1',
      lat: null,
      lng: null,
      raggioCorrenteM: null,
      distribuzioneCiclo: 1,
      assegnazioni: [],
    });
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(0);
    expect(out!.senzaCoordinate).toHaveLength(0);
    expect(out!.origineMancante).toBe(true);
  });

  it('ordina per distanza crescente', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ id: 'lontana', lat: kmLat(6) }),
      sede({ id: 'vicina', lat: kmLat(1) }),
    ]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi.map((s) => s.sedeId)).toEqual(['vicina', 'lontana']);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/copertura.test.ts`
Expected: FAIL — `Failed to resolve import "./copertura"`.

- [ ] **Step 3: Implementa il modulo**

Crea `apps/piattaforma/src/lib/distribuzione/copertura.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { distanceKm } from '@/lib/geo/coords';
import { isVisuraScaduta } from '@/lib/visura/validita';
import { getDistribuzioneConfig } from './config';

export const MOTIVI_ESCLUSIONE = [
  'REVOCATA_ADMIN',
  'SEDE_SOSPESA',
  'AZIENDA_SOSPESA',
  'BLOCCO_PAGAMENTO',
  'VISURA_SCADUTA',
] as const;

export type MotivoEsclusione = (typeof MOTIVI_ESCLUSIONE)[number];

export type SedeCopertura = {
  sedeId: string;
  nome: string;
  citta: string;
  ragioneSociale: string;
  distanzaM: number;
  stato: 'contattata' | 'in-attesa' | 'esclusa';
  round: number | null;
  esito: string | null;
  motivo: MotivoEsclusione | null;
};

export type Copertura = {
  raggioMaxM: number;
  raggioCorrenteM: number | null;
  /** True se la pratica non ha coordinate: nessuna distanza è calcolabile. */
  origineMancante: boolean;
  sedi: SedeCopertura[];
  senzaCoordinate: { sedeId: string; nome: string; citta: string }[];
};

/** Etichetta italiana di un motivo, per la UI. */
export function labelMotivo(m: MotivoEsclusione): string {
  switch (m) {
    case 'REVOCATA_ADMIN':
      return 'esclusa dall’admin (revoca)';
    case 'SEDE_SOSPESA':
      return 'sede sospesa';
    case 'AZIENDA_SOSPESA':
      return 'azienda sospesa o eliminata';
    case 'BLOCCO_PAGAMENTO':
      return 'blocco pagamento attivo';
    case 'VISURA_SCADUTA':
      return 'visura camerale scaduta';
  }
}

/**
 * Perché una pratica è (o non è) arrivata a ciascuna agenzia in zona.
 *
 * Ripete la selezione di `candidatiEntro` **senza i filtri di idoneità**, che
 * nel motore escludono in silenzio: coordinate mancanti, visura scaduta,
 * sospensioni e blocco pagamento fanno sparire una sede senza lasciare traccia
 * da nessuna parte. Qui diventano un motivo leggibile.
 *
 * Diagnostica admin-only: nessun dato di questa funzione va mostrato a broker o
 * agenzie.
 */
export async function getCoperturaPratica(praticaId: string): Promise<Copertura | null> {
  const [cfg, pratica] = await Promise.all([
    getDistribuzioneConfig(),
    prisma.pratica.findUnique({
      where: { id: praticaId },
      select: {
        id: true,
        lat: true,
        lng: true,
        raggioCorrenteM: true,
        distribuzioneCiclo: true,
        assegnazioni: { select: { sedeId: true, ciclo: true, round: true, esito: true } },
      },
    }),
  ]);
  if (!pratica) return null;

  const base: Copertura = {
    raggioMaxM: cfg.raggioMaxM,
    raggioCorrenteM: pratica.raggioCorrenteM ?? null,
    origineMancante: pratica.lat == null || pratica.lng == null,
    sedi: [],
    senzaCoordinate: [],
  };
  if (pratica.lat == null || pratica.lng == null) return base;
  const origine = { lat: pratica.lat, lng: pratica.lng };

  // Nessun filtro di idoneità: solo le sedi agenzia non cancellate.
  const sedi = await prisma.sede.findMany({
    where: { type: 'AGENZIA', deletedAt: null },
    select: {
      id: true,
      nome: true,
      citta: true,
      lat: true,
      lng: true,
      suspendedAt: true,
      company: {
        select: {
          ragioneSociale: true,
          deletedAt: true,
          suspendedAt: true,
          bloccoPagamentoAt: true,
          visuraCameraleData: true,
        },
      },
    },
  });

  const now = new Date();
  const perSede = new Map(
    pratica.assegnazioni
      .filter((a): a is typeof a & { sedeId: string } => a.sedeId !== null)
      .map((a) => [a.sedeId, a]),
  );

  for (const s of sedi) {
    if (s.lat == null || s.lng == null) {
      base.senzaCoordinate.push({ sedeId: s.id, nome: s.nome, citta: s.citta });
      continue;
    }

    const distanzaM = Math.round(distanceKm(origine, { lat: s.lat, lng: s.lng }) * 1000);
    if (distanzaM > cfg.raggioMaxM) continue;

    const ass = perSede.get(s.id);
    const comune = {
      sedeId: s.id,
      nome: s.nome,
      citta: s.citta,
      ragioneSociale: s.company.ragioneSociale,
      distanzaM,
    };

    // La revoca admin è permanente e vale su qualunque ciclo: si valuta per
    // prima, altrimenti una sede revocata sembrerebbe solo "contattata".
    if (ass?.esito === 'REVOCATA_ADMIN') {
      base.sedi.push({ ...comune, stato: 'esclusa', round: null, esito: null, motivo: 'REVOCATA_ADMIN' });
      continue;
    }

    if (ass && ass.ciclo === pratica.distribuzioneCiclo) {
      base.sedi.push({
        ...comune,
        stato: 'contattata',
        round: ass.round,
        esito: ass.esito,
        motivo: null,
      });
      continue;
    }

    const motivo = motivoEsclusione(s, now);
    base.sedi.push(
      motivo
        ? { ...comune, stato: 'esclusa', round: null, esito: null, motivo }
        : { ...comune, stato: 'in-attesa', round: null, esito: null, motivo: null },
    );
  }

  base.sedi.sort((a, b) => a.distanzaM - b.distanzaM);
  return base;
}

/** Primo motivo che rende la sede non candidabile, o null se è idonea. */
function motivoEsclusione(
  s: {
    suspendedAt: Date | null;
    company: {
      deletedAt: Date | null;
      suspendedAt: Date | null;
      bloccoPagamentoAt: Date | null;
      visuraCameraleData: Date | null;
    };
  },
  now: Date,
): MotivoEsclusione | null {
  if (s.suspendedAt) return 'SEDE_SOSPESA';
  if (s.company.deletedAt || s.company.suspendedAt) return 'AZIENDA_SOSPESA';
  if (s.company.bloccoPagamentoAt) return 'BLOCCO_PAGAMENTO';
  // `null` è esente: nessuna data, nessuna scadenza da affermare. Stessa regola
  // del ramo `{ visuraCameraleData: null }` nel where di `candidatiEntro`.
  if (isVisuraScaduta(s.company.visuraCameraleData, now)) return 'VISURA_SCADUTA';
  return null;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/copertura.test.ts`
Expected: PASS, 11 test.

- [ ] **Step 5: Prova la query sul DB reale**

I test mockano Prisma, quindi non dimostrano che la `select` sia valida. Verificala in sola lettura sul Postgres locale:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c \
  "SELECT s.id, s.nome, s.citta, s.lat, s.lng, s.\"suspendedAt\", c.\"ragioneSociale\", c.\"deletedAt\", c.\"suspendedAt\", c.\"bloccoPagamentoAt\", c.\"visuraCameraleData\" FROM sedi s JOIN companies c ON c.id = s.\"companyId\" WHERE s.type = 'AGENZIA' AND s.\"deletedAt\" IS NULL LIMIT 5;"
```

Expected: la query gira e restituisce righe — conferma che tutti i campi selezionati esistono con quei nomi.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/copertura.ts apps/piattaforma/src/lib/distribuzione/copertura.test.ts
git commit -m "feat(distribuzione): modulo copertura con i motivi di esclusione delle sedi"
```

---

### Task 10: Card "Copertura" sul dettaglio pratica

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/[id]/copertura-card.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx:740-780`

**Interfaces:**
- Consumes: `getCoperturaPratica`, `labelMotivo`, `Copertura` dal Task 9; `formatKm` da `@/lib/distribuzione/format`.
- Produces: `<CoperturaCard copertura={...} />` (componente sincrono, riceve i dati già caricati).

- [ ] **Step 1: Scrivi il componente**

Crea `apps/piattaforma/src/app/pratiche/[id]/copertura-card.tsx`:

```tsx
import { Card } from '@/components/ui';
import { formatKm } from '@/lib/distribuzione/format';
import { labelMotivo, type Copertura } from '@/lib/distribuzione/copertura';

/**
 * Diagnostica admin-only: quali agenzie ci sono in zona e, per ciascuna, se è
 * stata contattata, se aspetta il suo round o perché è stata esclusa.
 *
 * Esiste perché quattro dei cinque motivi di mancato contatto (coordinate,
 * visura, sospensioni, blocco pagamento) agiscono in silenzio: senza questa
 * card, "non è mai arrivata" non è distinguibile da "non è ancora il suo turno".
 */
export function CoperturaCard({ copertura }: { copertura: Copertura }) {
  const { sedi, senzaCoordinate, raggioMaxM, raggioCorrenteM, origineMancante } = copertura;

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-pv-navy-800">Copertura</h2>
      <p className="mt-1 text-[12px] text-pv-slate-500">
        Agenzie entro il raggio massimo ({formatKm(raggioMaxM)}), in linea d&apos;aria.
        {raggioCorrenteM != null && ` Raggio attuale: ${formatKm(raggioCorrenteM)}.`}
      </p>

      {origineMancante && (
        <p className="mt-3 rounded-[10px] bg-pv-amber-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
          La pratica non ha coordinate: nessuna distanza è calcolabile e la
          distribuzione automatica non può selezionare agenzie.
        </p>
      )}

      {!origineMancante && sedi.length === 0 && (
        <p className="mt-3 text-[13px] text-pv-slate-500">
          Nessuna agenzia entro il raggio massimo.
        </p>
      )}

      <ul className="mt-3 space-y-2 text-[13px]">
        {sedi.map((s) => (
          <li
            key={s.sedeId}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-pv-navy-800">{s.ragioneSociale}</p>
              <p className="text-[11px] text-pv-slate-500">
                {s.citta} · {formatKm(s.distanzaM)}
              </p>
            </div>
            <span className="shrink-0 text-right text-[11px]">
              {s.stato === 'contattata' && (
                <span className="font-bold uppercase tracking-wider text-pv-slate-500">
                  R{s.round} · {s.esito?.toLowerCase().replace('_', ' ')}
                </span>
              )}
              {s.stato === 'in-attesa' && (
                <span className="text-pv-slate-500">in attesa del round</span>
              )}
              {s.stato === 'esclusa' && s.motivo && (
                <span className="font-semibold text-pv-red-600">{labelMotivo(s.motivo)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {senzaCoordinate.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2">
          <p className="text-[12px] font-semibold text-pv-navy-800">
            {senzaCoordinate.length}{' '}
            {senzaCoordinate.length === 1 ? 'sede senza' : 'sedi senza'} coordinate
          </p>
          <p className="mt-1 text-[11.5px] text-pv-slate-500">
            Posizione ignota: non è possibile dire se siano in zona, e la distribuzione
            non le seleziona mai. {senzaCoordinate.map((s) => `${s.nome} (${s.citta})`).join(', ')}
          </p>
        </div>
      )}
    </Card>
  );
}
```

Verifica che le classi colore usate esistano nel design system (`grep -rn "pv-amber-50\|pv-red-600" apps/piattaforma/src --include=*.tsx | head`); se non ci sono, usa quelle equivalenti già in uso nel progetto per avvisi ed errori.

- [ ] **Step 2: Monta la card nella pagina**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx`:

1. Import: `import { getCoperturaPratica } from '@/lib/distribuzione/copertura';` e `import { CoperturaCard } from './copertura-card';`
2. Dopo il caricamento della pratica, calcola la copertura **solo per gli admin** — è una query su tutte le sedi, inutile per gli altri ruoli:

```tsx
const isStaff =
  session.user.role === 'ADMIN_PIATTAFORMA' || session.user.role === 'ASSISTENTE';
const copertura = isStaff ? await getCoperturaPratica(pratica.id) : null;
```

3. Subito **dopo** il blocco `{pratica.assegnazioni.length > 0 && (...)}` della card "Round distribuzione", aggiungi:

```tsx
{copertura && <CoperturaCard copertura={copertura} />}
```

Nota: la card sta fuori dalla condizione `assegnazioni.length > 0`. È proprio quando non c'è nessuna assegnazione che serve di più.

- [ ] **Step 3: Verifica nel browser**

`pnpm --filter piattaforma dev`, login come admin platform, apri una pratica in distribuzione da `/admin/pratiche`. Verifica che la card compaia, che le distanze siano plausibili e che una sede già contattata mostri il suo round. Poi apri la stessa pratica con un utente broker e verifica che la card **non** ci sia.

- [ ] **Step 4: Esegui la suite e committa**

Run: `pnpm --filter piattaforma test`
Expected: PASS.

```bash
git add apps/piattaforma/src/app/pratiche/\[id\]
git commit -m "feat(pratiche): card Copertura admin con i motivi di mancato contatto"
```

---

### Task 11: Migration di drop e messa in produzione

Questo task si esegue **a cavallo del deploy**, in tre momenti distinti. Non anticipare il drop: la versione di codice precedente legge ancora le tre colonne.

**Files:**
- Create: `packages/db/prisma/migrations/20260726130000_drop_orario_legacy/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (rimozione delle tre colonne legacy)

- [ ] **Step 1: Scrivi la migration di drop**

Crea `packages/db/prisma/migrations/20260726130000_drop_orario_legacy/migration.sql`:

```sql
-- Le tre colonne sono sostituite da "orariSettimana" (migration 20260726120000).
-- Da applicare SOLO DOPO il deploy del codice che non le legge più: la versione
-- precedente le legge in getDistribuzioneConfig, e senza di esse cadrebbe nel
-- catch fail-open, ignorando in silenzio la configurazione reale.
ALTER TABLE "distribuzione_config"
  DROP COLUMN "orarioInizio",
  DROP COLUMN "orarioFine",
  DROP COLUMN "giorni";
```

Rimuovi le tre righe corrispondenti dal modello `DistribuzioneConfig` in `schema.prisma` (incluso il commento "Legacy").

- [ ] **Step 2: Applica in locale e verifica**

```bash
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db db:generate
pnpm --filter piattaforma test
```

Expected: migration applicata, suite verde.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma
git commit -m "chore(db): droppo le colonne orario legacy di distribuzione_config"
```

- [ ] **Step 4: Sequenza di rilascio in produzione**

Da eseguire **in quest'ordine**, senza saltare passaggi:

1. Applica la migration **additiva** su Neon (`20260726120000_distribuzione_calendario`), col codice vecchio ancora in produzione. Le colonne nuove restano ignorate: nessun effetto.
2. Verifica su Neon che il singleton abbia il calendario e i 16 festivi:
   `SELECT jsonb_pretty("orariSettimana"), jsonb_array_length("festivi") FROM distribuzione_config;`
3. Push su `main` → deploy Vercel.
4. Verifica che il cron al minuto sia attivo: dopo ~10 minuti, i runtime log di produzione devono mostrare ~10 richieste su `/api/jobs/distribuzione-tick` invece di 1. Se Vercel avesse rifiutato lo schedule, ripiega su cron-job.org con header `Authorization: Bearer <CRON_SECRET>` sullo stesso path.
5. Solo ora applica la migration di **drop** (`20260726130000_drop_orario_legacy`).
6. Apri `/admin/distribuzione` in produzione e verifica che giorni, orari e festivi siano quelli attesi.

- [ ] **Step 5: Aggiorna la roadmap**

In `docs/piano-implementazione.md`, nella sezione della distribuzione, aggiungi la riga:

```markdown
- [x] Durata round in minuti (1–60) + cron al minuto, calendario piattaforma per giorno con festivi, attesa in minuti lavorativi, card Copertura admin — **SHIPPED 2026-07-26**
```

```bash
git add docs/piano-implementazione.md
git commit -m "docs(roadmap): distribuzione round in minuti e calendario piattaforma"
```

---

## Note per chi esegue

**Il DB di produzione è usa-e-getta.** Nessun backfill, nessuna grazia per i record esistenti: se un dato non torna, si corregge, non si scrive codice per tollerarlo.

**Il caso Corsico→Assago resta da chiudere.** È la ragione per cui esiste il Task 9. Quando la copia locale di prod sarà aggiornata, la diagnosi è una query sola:

```sql
SELECT s.citta, s.lat, s.lng, c."visuraCameraleData", c."suspendedAt", c."bloccoPagamentoAt"
FROM sedi s JOIN companies c ON c.id = s."companyId"
WHERE s.type = 'AGENZIA' AND s.citta ILIKE '%assago%';
```

Una `lat` nulla o una `visuraCameraleData` anteriore a 180 giorni fa è la risposta.
