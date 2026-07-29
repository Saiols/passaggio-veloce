# CRM — stato «Richiamare» (S11) con giorno e fascia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare al sales un nono stato del funnel CRM, `S11` «Richiamare», che porta con sé il giorno del richiamo e una fascia (mattina/pomeriggio/indifferente), visibile in lista e filtrabile con un chip dedicato.

**Architecture:** `S11` è un valore in più dell'enum `CrmStatoContatto`; il giorno riusa la colonna esistente `nextContactAt` e la fascia è una colonna nuova `nextContactFascia`. Un modulo puro `lib/crm/richiamo.ts` è la fonte unica di tre cose: la regola di azzeramento (giorno e fascia si cancellano **solo** quando un contatto esce da `S11`), l'etichetta di riga e la soglia «dovuto oggi o prima» calcolata nel fuso di Roma. I **quattro** write path che toccano `status` — le due server action della vista, `match/apply.ts` e `sync.ts` — chiamano tutti quell'helper.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 5.22 + Postgres 17, TypeScript, Vitest, Tailwind con i token del design system PV.

**Spec di riferimento:** `docs/superpowers/specs/2026-07-29-crm-stato-richiamare-design.md`

## Global Constraints

- **Node 22**: prima di qualunque comando `pnpm`, `nvm use 22.15.0` (dopo un riavvio la shell torna a Node 16 e pnpm richiede ≥18).
- **Migration a mano, mai `prisma migrate dev`**: su questo schema propone `DROP SEQUENCE`. Si scrive il file `migration.sql` e si applica con `pnpm --filter @pv/db db:deploy`.
- **`ALTER TYPE … ADD VALUE` in una migration separata**: Postgres non permette di *usare* un valore enum nella stessa transazione in cui lo aggiunge, e Prisma esegue ogni migration in una transazione.
- **`nextContactAt` resta a mezzanotte UTC** (helper `parseDate` già presente in `actions.ts`). Il fuso di Roma si usa **solo** nei confronti (`lib/date/rome-day.ts`). Scrivere l'inizio-giornata romano romperebbe `nextContactAt.slice(0, 10)` che riempie l'`<input type="date">`.
- **`S11` NON entra in `ORDINE`** di `lib/crm/match/stato.ts`: non è un gradino del funnel, è una parentesi — come `S10`.
- **`🔴 Urgenti` non si tocca**: resta `status in [S6, S5, S4, S3]`.
- **Test**: `pnpm --filter piattaforma test`. Typecheck: `pnpm typecheck` (funziona solo a cache calda; a cache fredda `tsc` dà falsi errori Prisma — non fidarsi di un errore isolato dopo una `prisma generate`, rilanciare).
- **Colori**: solo token del design system (`pv-*`) o le palette Tailwind già usate in `client.tsx`. Niente esadecimali.
- **Commit**: uno per task, messaggio in italiano, corpo che spiega il *perché*.

---

### Task 1: Schema e migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (enum `CrmStatoContatto` ~riga 2105, nuovo enum, model `CrmContact` ~riga 2209 e blocco `@@index` ~riga 2288)
- Create: `packages/db/prisma/migrations/20260729100000_crm_stato_richiamare/migration.sql`
- Create: `packages/db/prisma/migrations/20260729100100_crm_contacts_fascia_richiamo/migration.sql`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: valore enum `S11` in `CrmStatoContatto`; tipo `CrmFasciaContatto` (`'MATTINA' | 'POMERIGGIO'`) esportato da `@pv/db`; colonna `CrmContact.nextContactFascia: CrmFasciaContatto | null`

- [ ] **Step 1: Aggiungere `S11` all'enum del funnel**

In `packages/db/prisma/schema.prisma`, dentro `enum CrmStatoContatto`, dopo `S10 // Churned`:

```prisma
  S10 // Churned
  S11 // Richiamare — giorno in nextContactAt, fascia in nextContactFascia
```

- [ ] **Step 2: Aggiungere l'enum della fascia**

Subito dopo il blocco `enum CrmStatoContatto`, prima di `enum CrmFonteAcquisizione`:

```prisma
/// Fascia di un richiamo programmato. L'assenza di valore (null) significa
/// "indifferente": non è un terzo membro dell'enum, perché "indifferente" non
/// è una fascia della giornata ma il fatto che non ne sia stata chiesta una.
enum CrmFasciaContatto {
  MATTINA
  POMERIGGIO
}
```

- [ ] **Step 3: Aggiungere la colonna e l'indice al model**

In `model CrmContact`, sostituire la riga `nextContactAt DateTime?` con:

```prisma
  lastContactAt DateTime?
  nextContactAt DateTime?
  /// Fascia del richiamo programmato; null = indifferente. Ha senso solo con
  /// status = S11, e `lib/crm/richiamo.ts` la azzera quando il contatto esce
  /// da quello stato.
  nextContactFascia CrmFasciaContatto?
```

E nel blocco degli indici, dopo `@@index([status])`:

```prisma
  @@index([status, nextContactAt])
```

- [ ] **Step 4: Scrivere la prima migration (solo il valore enum)**

`packages/db/prisma/migrations/20260729100000_crm_stato_richiamare/migration.sql`:

```sql
-- packages/db/prisma/migrations/20260729100000_crm_stato_richiamare/migration.sql
-- Stato S11 "Richiamare": il cliente ha chiesto di essere richiamato, e quando.
--
-- Sta in una migration TUTTA SUA perché Postgres non permette di USARE un
-- valore enum nella stessa transazione in cui lo aggiunge, e Prisma esegue
-- ogni migration dentro una transazione. Separarlo è ciò che rende sicura la
-- migration successiva (e qualunque futura che voglia scrivere 'S11').
ALTER TYPE "CrmStatoContatto" ADD VALUE 'S11';
```

- [ ] **Step 5: Scrivere la seconda migration (fascia + indice)**

`packages/db/prisma/migrations/20260729100100_crm_contacts_fascia_richiamo/migration.sql`:

```sql
-- packages/db/prisma/migrations/20260729100100_crm_contacts_fascia_richiamo/migration.sql
-- Fascia del richiamo programmato (mattina/pomeriggio) e indice per il chip
-- "Da richiamare".
--
-- La colonna è nullable e null significa "indifferente": nessun backfill, le
-- righe esistenti sono già corrette.
--
-- L'indice serve alle DUE query che il chip fa a ogni apertura della pagina:
-- il listato filtrato e il conteggio nel badge.
CREATE TYPE "CrmFasciaContatto" AS ENUM ('MATTINA', 'POMERIGGIO');

ALTER TABLE "crm_contacts" ADD COLUMN "nextContactFascia" "CrmFasciaContatto";

CREATE INDEX "crm_contacts_status_nextContactAt_idx"
  ON "crm_contacts" ("status", "nextContactAt");
```

- [ ] **Step 6: Applicare in locale e rigenerare il client**

```bash
nvm use 22.15.0
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db exec prisma generate
```

Atteso: `2 migrations found`, entrambe applicate, `Generated Prisma Client`.

- [ ] **Step 7: Verificare che il DB locale abbia davvero il valore e la colonna**

```bash
docker exec -i pv-postgres psql -U postgres -d passaggio_veloce -c "SELECT unnest(enum_range(NULL::\"CrmStatoContatto\"))::text ORDER BY 1;"
docker exec -i pv-postgres psql -U postgres -d passaggio_veloce -c "\d crm_contacts" | grep -i fascia
```

Atteso: `S11` nell'elenco; una riga `nextContactFascia | CrmFasciaContatto`.

> Se il nome del container non è `pv-postgres`, ricavarlo con `docker ps --format '{{.Names}}'`. Non passare oltre senza aver visto le due prove a schermo: `$LASTEXITCODE` non dice niente se il comando non è nemmeno partito.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(crm): stato S11 Richiamare e fascia del richiamo"
```

---

### Task 2: Modulo puro `lib/crm/richiamo.ts`

**Files:**
- Create: `apps/piattaforma/src/lib/crm/richiamo.ts`
- Create: `apps/piattaforma/src/lib/crm/richiamo.test.ts`

**Interfaces:**
- Consumes: `romeYmd`, `romeEndOfDay` da `@/lib/date/rome-day` (già esistenti)
- Produces:
  - `STATO_RICHIAMARE: 'S11'`
  - `type FasciaRichiamo = 'MATTINA' | 'POMERIGGIO'`
  - `LABEL_FASCIA: Record<FasciaRichiamo, string>`
  - `OPZIONI_FASCIA: Array<{ value: string; label: string }>`
  - `campiRichiamoDopoCambioStato(precedente: string, nuovo: string): { nextContactAt?: null; nextContactFascia?: null }`
  - `sogliaRichiamoDovuto(adesso: Date): Date`
  - `etichettaRichiamo(giorno: Date | string, fascia: string | null, adesso: Date): { testo: string; scaduto: boolean; oggi: boolean }`

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/lib/crm/richiamo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  campiRichiamoDopoCambioStato,
  etichettaRichiamo,
  sogliaRichiamoDovuto,
} from './richiamo';

/**
 * Il giorno del richiamo è memorizzato a mezzanotte UTC (come ogni altra data
 * di quella scheda), ma "oggi", "scaduto" e la soglia del filtro sono domande
 * sul CALENDARIO ITALIANO. Alle 00:30 del 5 agosto a Roma, in UTC sono ancora
 * le 22:30 del 4: usare UTC sposterebbe di un giorno ogni richiamo, e lo
 * sposterebbe solo nelle ore serali — cioè in modo intermittente.
 */
describe('campiRichiamoDopoCambioStato', () => {
  it('uscire da S11 azzera giorno e fascia', () => {
    expect(campiRichiamoDopoCambioStato('S11', 'S3')).toEqual({
      nextContactAt: null,
      nextContactFascia: null,
    });
  });

  it('restare in S11 non tocca niente (riprogrammazione)', () => {
    expect(campiRichiamoDopoCambioStato('S11', 'S11')).toEqual({});
  });

  it('un cambio di stato che non parte da S11 non tocca niente', () => {
    // Regressione: azzerare in base allo stato FINALE invece che alla
    // transizione cancellerebbe una data messa a mano su un contatto S3 a
    // ogni salvataggio della scheda.
    expect(campiRichiamoDopoCambioStato('S3', 'S3')).toEqual({});
    expect(campiRichiamoDopoCambioStato('S3', 'S9')).toEqual({});
    expect(campiRichiamoDopoCambioStato('S0', 'S4')).toEqual({});
  });

  it('anche l aggancio automatico a un azienda registrata azzera', () => {
    // È il caso di match/apply.ts e sync.ts: un contatto da richiamare che si
    // iscrive davvero passa a S7/S8/S9 senza toccare le action.
    expect(campiRichiamoDopoCambioStato('S11', 'S8')).toEqual({
      nextContactAt: null,
      nextContactFascia: null,
    });
  });
});

describe('etichettaRichiamo', () => {
  const GIORNO_ESTATE = new Date('2026-08-04T00:00:00Z'); // 4 agosto

  it('compone testo con giorno e fascia', () => {
    const r = etichettaRichiamo(
      GIORNO_ESTATE,
      'MATTINA',
      new Date('2026-08-03T09:00:00Z'),
    );
    expect(r.testo).toBe('mar 4 ago · mattina');
    expect(r.scaduto).toBe(false);
    expect(r.oggi).toBe(false);
  });

  it('senza fascia mostra solo il giorno', () => {
    const r = etichettaRichiamo(
      GIORNO_ESTATE,
      null,
      new Date('2026-08-03T09:00:00Z'),
    );
    expect(r.testo).toBe('mar 4 ago');
  });

  it('ora legale: alle 23:30 di Roma è ancora oggi', () => {
    // 21:30Z = 23:30 a Roma del 4 agosto
    const r = etichettaRichiamo(GIORNO_ESTATE, 'MATTINA', new Date('2026-08-04T21:30:00Z'));
    expect(r.oggi).toBe(true);
    expect(r.scaduto).toBe(false);
  });

  it('ora legale: alle 00:30 di Roma del giorno dopo è scaduto', () => {
    // 22:30Z del 4 = 00:30 a Roma del 5 agosto
    const r = etichettaRichiamo(GIORNO_ESTATE, 'MATTINA', new Date('2026-08-04T22:30:00Z'));
    expect(r.oggi).toBe(false);
    expect(r.scaduto).toBe(true);
  });

  it('ora solare: alle 23:30 di Roma è ancora oggi', () => {
    const giornoInverno = new Date('2026-01-14T00:00:00Z');
    // 22:30Z = 23:30 a Roma del 14 gennaio (UTC+1)
    const r = etichettaRichiamo(giornoInverno, null, new Date('2026-01-14T22:30:00Z'));
    expect(r.oggi).toBe(true);
    expect(r.scaduto).toBe(false);
  });

  it('ora solare: alle 00:30 di Roma del giorno dopo è scaduto', () => {
    const giornoInverno = new Date('2026-01-14T00:00:00Z');
    const r = etichettaRichiamo(giornoInverno, null, new Date('2026-01-14T23:30:00Z'));
    expect(r.scaduto).toBe(true);
  });

  it('accetta anche la data serializzata in ISO dal server component', () => {
    const r = etichettaRichiamo(
      '2026-08-04T00:00:00.000Z',
      'POMERIGGIO',
      new Date('2026-08-04T09:00:00Z'),
    );
    expect(r.testo).toBe('mar 4 ago · pomeriggio');
    expect(r.oggi).toBe(true);
  });
});

describe('sogliaRichiamoDovuto', () => {
  it('include i richiami di oggi e esclude quelli di domani', () => {
    // Le 09:00 di Roma del 4 agosto.
    const soglia = sogliaRichiamoDovuto(new Date('2026-08-04T07:00:00Z'));
    expect(new Date('2026-08-04T00:00:00Z').getTime()).toBeLessThanOrEqual(soglia.getTime());
    expect(new Date('2026-08-05T00:00:00Z').getTime()).toBeGreaterThan(soglia.getTime());
  });

  it('a fine giornata romana include ancora i richiami di oggi', () => {
    // 21:30Z = 23:30 a Roma: la soglia deve essere ancora quella del 4.
    const soglia = sogliaRichiamoDovuto(new Date('2026-08-04T21:30:00Z'));
    expect(new Date('2026-08-04T00:00:00Z').getTime()).toBeLessThanOrEqual(soglia.getTime());
    expect(new Date('2026-08-05T00:00:00Z').getTime()).toBeGreaterThan(soglia.getTime());
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test src/lib/crm/richiamo.test.ts
```

Atteso: FAIL — `Failed to resolve import "./richiamo"`.

- [ ] **Step 3: Scrivere il modulo**

`apps/piattaforma/src/lib/crm/richiamo.ts`:

```ts
/**
 * Richiamo programmato di un contatto CRM (stato S11). Modulo PURO.
 *
 * È la sola definizione di tre cose, e sta in un modulo proprio perché i write
 * path che possono chiudere un richiamo sono QUATTRO, non due: le due server
 * action della vista contatti, l'aggancio del motore di match
 * (`match/apply.ts`) e la firma di una pratica (`sync.ts`). Gli ultimi due
 * passano da `datiFunnel()`, che per uno stato fuori da `ORDINE` — e S11 lo è,
 * come S10 — restituisce direttamente S7/S8/S9: un contatto da richiamare che
 * si registra davvero esce da S11 senza che nessuna action se ne accorga. Se
 * la regola vivesse dentro le action, resterebbe un richiamo fantasma su un
 * cliente già a bordo, e continuerebbe a comparire nel chip "Da richiamare".
 */
import { romeYmd, romeEndOfDay } from '@/lib/date/rome-day';

/** Stato del funnel che porta con sé un richiamo programmato. */
export const STATO_RICHIAMARE = 'S11';

export type FasciaRichiamo = 'MATTINA' | 'POMERIGGIO';

/** Minuscole: finiscono in coda al giorno ("mar 4 ago · mattina"). */
export const LABEL_FASCIA: Record<FasciaRichiamo, string> = {
  MATTINA: 'mattina',
  POMERIGGIO: 'pomeriggio',
};

/**
 * Opzioni della tendina. Il valore vuoto è "Indifferente": l'assenza di fascia
 * non è un terzo membro dell'enum, è il fatto che nessuno ne abbia chiesta una.
 */
export const OPZIONI_FASCIA: Array<{ value: string; label: string }> = [
  { value: '', label: 'Indifferente' },
  { value: 'MATTINA', label: 'Mattina' },
  { value: 'POMERIGGIO', label: 'Pomeriggio' },
];

/**
 * Campi da aggiungere alla `data` di un update che cambia lo stato.
 *
 * L'azzeramento è sulla TRANSIZIONE (si esce da S11), non sullo stato finale:
 * azzerare ogni volta che lo stato salvato non è S11 cancellerebbe la data che
 * un admin ha messo a mano su un contatto S3, a ogni salvataggio della scheda.
 */
export function campiRichiamoDopoCambioStato(
  precedente: string,
  nuovo: string,
): { nextContactAt?: null; nextContactFascia?: null } {
  if (precedente === STATO_RICHIAMARE && nuovo !== STATO_RICHIAMARE) {
    return { nextContactAt: null, nextContactFascia: null };
  }
  return {};
}

/** Bound `lte` per «richiamo dovuto oggi o prima», in giorni romani. */
export function sogliaRichiamoDovuto(adesso: Date): Date {
  return romeEndOfDay(romeYmd(adesso));
}

const FMT_GIORNO = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Rome',
});

/** -1 se a viene prima di b, 0 se stesso giorno, 1 se dopo. */
function confrontaGiorni(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/**
 * Etichetta della riga sotto lo stato, con la posizione nel tempo.
 *
 * Il confronto è fra GIORNI DI CALENDARIO romani, non fra istanti: così non
 * dipende dall'ora a cui il giorno è stato memorizzato né dall'ora legale.
 */
export function etichettaRichiamo(
  giorno: Date | string,
  fascia: string | null,
  adesso: Date,
): { testo: string; scaduto: boolean; oggi: boolean } {
  const d = giorno instanceof Date ? giorno : new Date(giorno);
  const label = LABEL_FASCIA[fascia as FasciaRichiamo];
  const testo = label ? `${FMT_GIORNO.format(d)} · ${label}` : FMT_GIORNO.format(d);
  const cmp = confrontaGiorni(romeYmd(d), romeYmd(adesso));
  return { testo, scaduto: cmp < 0, oggi: cmp === 0 };
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

```bash
pnpm --filter piattaforma test src/lib/crm/richiamo.test.ts
```

Atteso: PASS, 13 test.

> Se il testo atteso non combacia (`mar 4 ago` vs `mar 4 ago.`), **non cambiare l'asserzione a caso**: stampare il valore reale e allineare il test a ciò che `Intl` produce davvero su questo runtime, poi verificare a occhio che sia leggibile in italiano.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/richiamo.ts apps/piattaforma/src/lib/crm/richiamo.test.ts
git commit -m "feat(crm): fonte unica del richiamo programmato"
```

---

### Task 3: Server action della vista contatti

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts` (`CRM_CONTACT_INPUT` righe 53-119, `dataFromInput` righe 134-182, `updateCrmContactAction` righe 245-308, `updateCrmContactStatusAction` righe 329-364)
- Create: `apps/piattaforma/src/app/admin/crm/contatti/actions.richiamo.test.ts`

**Interfaces:**
- Consumes: `campiRichiamoDopoCambioStato`, `STATO_RICHIAMARE` da `@/lib/crm/richiamo` (Task 2)
- Produces:
  - `updateCrmContactStatusAction(id: string, status: string, richiamo?: { giorno: string; fascia: string }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `CrmContactInput` con in più `nextContactFascia?: '' | 'MATTINA' | 'POMERIGGIO'` e `status` che accetta `'S11'`

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/app/admin/crm/contatti/actions.richiamo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Presidio sulle due action che possono aprire e chiudere un richiamo.
 *
 * Il caso che conta di più non è quello felice: è che un salvataggio della
 * scheda su un contatto che NON era in S11 non debba cancellare la data messa
 * a mano nel campo "Prossimo contatto pianificato". È la differenza fra
 * azzerare in base alla transizione e azzerare in base allo stato finale, e
 * nessun typecheck la vede.
 */
const { crmContactMock } = vi.hoisted(() => ({
  crmContactMock: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@pv/db', () => ({
  prisma: { crmContact: crmContactMock },
  Prisma: {},
}));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  canEditCrmContact: () => true,
  canDeleteCrmContact: () => true,
  canBulkImportCrm: () => true,
}));

import { auth } from '@/auth';
import { updateCrmContactAction, updateCrmContactStatusAction } from './actions';

const authMock = vi.mocked(auth);

/** Payload minimo valido per la scheda contatto. */
const BASE = {
  nome: 'Agenzia Corsico Pratiche Auto',
  cat: 'AGENZIA' as const,
  tel: '+39 02 447 8712',
  fonte: 'CSV_INIZIALE' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' },
  } as never);
  crmContactMock.update.mockResolvedValue({ id: 'x1' });
});

describe('updateCrmContactStatusAction — tendina di riga', () => {
  it('S11 senza giorno viene rifiutato e non scrive niente', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11');

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });

  it('S11 con giorno e fascia scrive stato, giorno e fascia in un colpo solo', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11', {
      giorno: '2026-08-04',
      fascia: 'MATTINA',
    });

    expect(res.ok).toBe(true);
    expect(crmContactMock.update).toHaveBeenCalledTimes(1);
    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.status).toBe('S11');
    expect(data.nextContactAt).toEqual(new Date('2026-08-04'));
    expect(data.nextContactFascia).toBe('MATTINA');
  });

  it('fascia vuota significa indifferente, cioè null', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    await updateCrmContactStatusAction('x1', 'S11', { giorno: '2026-08-04', fascia: '' });

    expect(crmContactMock.update.mock.calls[0][0].data.nextContactFascia).toBeNull();
  });

  it('uscire da S11 azzera giorno e fascia', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S11' });

    await updateCrmContactStatusAction('x1', 'S3');

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.status).toBe('S3');
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });

  it('un cambio di stato che non parte da S11 non tocca il richiamo', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    await updateCrmContactStatusAction('x1', 'S9');

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toBeUndefined();
    expect(data.nextContactFascia).toBeUndefined();
  });

  it('un SALES non tocca i contatti che non sono suoi', async () => {
    authMock.mockResolvedValue({ user: { id: 'sales-1', role: 'SALES' } } as never);
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: 'altro', status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11', {
      giorno: '2026-08-04',
      fascia: '',
    });

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });
});

describe('updateCrmContactAction — scheda contatto', () => {
  it('S11 senza giorno viene rifiutato', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S3', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    const res = await updateCrmContactAction('x1', {
      ...BASE, status: 'S11', nextContactAt: '',
    });

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });

  it('salvare un contatto S3 con una data pianificata NON la cancella', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S3', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    await updateCrmContactAction('x1', {
      ...BASE, status: 'S3', nextContactAt: '2026-08-04',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toEqual(new Date('2026-08-04'));
  });

  it('portare la scheda da S11 a S3 azzera giorno e fascia anche se il form li manda', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S11', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    await updateCrmContactAction('x1', {
      ...BASE, status: 'S3',
      nextContactAt: '2026-08-04',
      nextContactFascia: 'MATTINA',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });

  it('salvare restando in S11 aggiorna giorno e fascia dalla scheda', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S11', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    await updateCrmContactAction('x1', {
      ...BASE, status: 'S11',
      nextContactAt: '2026-08-06',
      nextContactFascia: 'POMERIGGIO',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toEqual(new Date('2026-08-06'));
    expect(data.nextContactFascia).toBe('POMERIGGIO');
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test src/app/admin/crm/contatti/actions.richiamo.test.ts
```

Atteso: FAIL — l'azione accetta `S11` come stato non valido / `nextContactFascia` non esiste.

- [ ] **Step 3: Estendere lo schema di input**

In `actions.ts`, importare l'helper in cima (dopo gli altri import `@/lib/crm/...`):

```ts
import { campiRichiamoDopoCambioStato, STATO_RICHIAMARE } from '@/lib/crm/richiamo';
```

Sostituire il campo `status` dentro `CRM_CONTACT_INPUT` (righe 67-79) con la versione che include `S11`, e aggiungere la fascia subito dopo `nextContactAt`:

```ts
  status: z.enum([
    'S0', 'S1', 'S2', 'S3', 'S4', 'S5',
    'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
  ]),
```

```ts
  nextContactAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  nextContactFascia: z.enum(['MATTINA', 'POMERIGGIO']).optional().or(z.literal('')),
```

Poi chiudere l'oggetto `z.object({...})` con un `superRefine` — cioè sostituire la riga `});` che chiude `CRM_CONTACT_INPUT` con:

```ts
}).superRefine((d, ctx) => {
  // Un richiamo senza giorno non è un promemoria: è una riga che nessun
  // filtro può far riemergere.
  if (d.status === 'S11' && !d.nextContactAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextContactAt'],
      message: 'Con lo stato Richiamare serve il giorno del richiamo',
    });
  }
});
```

- [ ] **Step 4: Scrivere la fascia in `dataFromInput`**

In `dataFromInput` (righe 134-182), subito dopo `nextContactAt: parseDate(d.nextContactAt),`:

```ts
    nextContactAt: parseDate(d.nextContactAt),
    nextContactFascia: emptyToNull(
      d.nextContactFascia,
    ) as Prisma.CrmContactCreateInput['nextContactFascia'],
```

- [ ] **Step 5: Applicare l'azzeramento in `updateCrmContactAction`**

Nella `findUnique` di `attuale` (riga ~257) aggiungere `status` alla select:

```ts
  const attuale = await prisma.crmContact.findUnique({
    where: { id },
    select: { assignedToId: true, status: true, ...SELECT_ARRICCHIMENTO },
  });
```

Subito dopo `const data = dataFromInputForUpdate(parsed.data);` (riga ~278):

```ts
  const data = dataFromInputForUpdate(parsed.data);

  // Va DOPO la costruzione di `data`: se il contatto esce da S11, il richiamo
  // è chiuso e vince sui valori che il form ha comunque mandato (il campo data
  // resta compilato nella scheda finché non si ricarica).
  Object.assign(
    data,
    campiRichiamoDopoCambioStato(attuale?.status ?? '', parsed.data.status),
  );
```

- [ ] **Step 6: Riscrivere `updateCrmContactStatusAction`**

Sostituire l'intera funzione (righe 329-364) con:

```ts
export async function updateCrmContactStatusAction(
  id: string,
  status: string,
  /** Presente solo quando `status` è S11: lo raccoglie il modale di riga. */
  richiamo?: { giorno: string; fascia: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per modificare contatti CRM' };
  }

  const STATI = [
    'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
  ] as const;
  if (!STATI.includes(status as (typeof STATI)[number])) {
    return { ok: false, error: 'Stato non valido' };
  }

  // Lo stato attuale serve SEMPRE, non solo ai SALES: è quello che dice se
  // questo cambio sta chiudendo un richiamo.
  const target = await prisma.crmContact.findUnique({
    where: { id },
    select: { assignedToId: true, status: true },
  });
  if (!target) return { ok: false, error: 'Contatto non trovato' };

  // SALES può modificare solo i propri assegnati (decisione 7)
  if (session.user.role === 'SALES' && target.assignedToId !== session.user.id) {
    return { ok: false, error: 'Puoi modificare solo i contatti a te assegnati' };
  }

  const data: Prisma.CrmContactUpdateInput = {
    status: status as (typeof STATI)[number],
    ...campiRichiamoDopoCambioStato(target.status, status),
  };

  if (status === STATO_RICHIAMARE) {
    const giorno = parseDate(richiamo?.giorno);
    if (!giorno) {
      return { ok: false, error: 'Serve il giorno del richiamo.' };
    }
    const fascia = richiamo?.fascia ?? '';
    if (fascia !== '' && fascia !== 'MATTINA' && fascia !== 'POMERIGGIO') {
      return { ok: false, error: 'Fascia non valida.' };
    }
    data.nextContactAt = giorno;
    data.nextContactFascia = fascia === '' ? null : fascia;
  }

  await prisma.crmContact.update({ where: { id }, data });

  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}
```

> `parseDate` è già definita in questo file (riga 128) e restituisce `null` per stringa vuota o data impossibile: copre da sola sia «giorno mancante» sia «giorno spazzatura».

- [ ] **Step 7: Lanciare i test e verificare che passino**

```bash
pnpm --filter piattaforma test src/app/admin/crm/contatti/
```

Atteso: PASS su tutti i file della cartella (il nuovo **e** `actions.norm-fields.test.ts`, `promo-codes-email.action.test.ts`, `email-partenza.action.test.ts`, `query.test.ts`, che non devono essere stati rotti).

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/actions.ts apps/piattaforma/src/app/admin/crm/contatti/actions.richiamo.test.ts
git commit -m "feat(crm): le action della vista contatti aprono e chiudono il richiamo"
```

---

### Task 4: I due write path automatici (aggancio e firma)

**Files:**
- Modify: `apps/piattaforma/src/lib/crm/match/apply.ts` (costruzione di `data`, righe ~62-77)
- Modify: `apps/piattaforma/src/lib/crm/sync.ts` (`allineaContattiAgganciati`, righe ~102-115)
- Modify: `apps/piattaforma/src/lib/crm/match/apply.test.ts` (aggiungere un caso)
- Modify: `apps/piattaforma/src/lib/crm/sync-firma.test.ts` (aggiungere un caso)

**Interfaces:**
- Consumes: `campiRichiamoDopoCambioStato` da `@/lib/crm/richiamo` (Task 2)
- Produces: niente di nuovo verso l'esterno

- [ ] **Step 1: Scrivere il test che fallisce in `apply.test.ts`**

Dentro `describe('applicaProposte', …)`, in fondo, aggiungere:

```ts
  it('agganciare un contatto da richiamare chiude il richiamo', async () => {
    // Un contatto in S11 che si registra davvero esce da S11 senza passare
    // dalle action: se il richiamo non venisse azzerato qui, resterebbe
    // appeso a un cliente già a bordo e continuerebbe a comparire nel chip.
    contactFindUnique.mockResolvedValue({
      status: 'S11',
      email: 'a@b.it', wa: '3331234567', piva: '01234567890',
      indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
      regione: 'Lombardia', arricchitoDa: null,
    });

    await applicaProposte([PROPOSTA]);

    const data = contactUpdateMany.mock.calls[0]![0].data;
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });
```

> `PROPOSTA` e i mock (`contactFindUnique`, `contactUpdateMany`) sono già definiti in cima al file, e il `beforeEach` esistente imposta `contactUpdateMany.mockResolvedValue({ count: 1 })`: questo caso ridefinisce solo lo stato di partenza del contatto.

- [ ] **Step 2: Scrivere il test che fallisce in `sync-firma.test.ts`**

Dentro `describe('onPraticaFirmata', …)`, in fondo:

```ts
  it('la firma di una pratica chiude un richiamo ancora aperto', async () => {
    soloAgenziaHaContatti([{ id: 'k1', status: 'S11' }]);
    companyFindUnique.mockResolvedValue(COMPANY_AGENZIA);
    praticaCount.mockResolvedValue(1);
    praticaFindFirst.mockResolvedValue({ createdAt: new Date('2026-03-15T00:00:00Z') });
    contactUpdateMany.mockResolvedValue({ count: 1 });

    await onPraticaFirmata('p1');

    const chiamata = contactUpdateMany.mock.calls.find(
      (c) => c[0].where.id === 'k1',
    );
    expect(chiamata).toBeDefined();
    expect(chiamata![0].data.nextContactAt).toBeNull();
    expect(chiamata![0].data.nextContactFascia).toBeNull();
  });
```

- [ ] **Step 3: Lanciare i due test e verificare che falliscano**

```bash
pnpm --filter piattaforma test src/lib/crm/match/apply.test.ts src/lib/crm/sync-firma.test.ts
```

Atteso: FAIL — `expected undefined to be null` su `nextContactAt`.

- [ ] **Step 4: Applicare l'helper in `apply.ts`**

Import in cima al file:

```ts
import { campiRichiamoDopoCambioStato } from '@/lib/crm/richiamo';
```

Nell'oggetto `data` (dopo `primaPraticaAt: funnel.primaPraticaAt,`):

```ts
        primaPraticaAt: funnel.primaPraticaAt,
        // Il contatto era da richiamare e adesso è un cliente: il promemoria
        // commerciale non ha più oggetto.
        ...campiRichiamoDopoCambioStato(attuale.status, funnel.status),
```

- [ ] **Step 5: Applicare l'helper in `sync.ts`**

Import in cima al file:

```ts
import { campiRichiamoDopoCambioStato } from '@/lib/crm/richiamo';
```

Nella `data` della `updateMany` dentro `allineaContattiAgganciati`, dopo `primaPraticaAt: funnel.primaPraticaAt,`:

```ts
        primaPraticaAt: funnel.primaPraticaAt,
        ...campiRichiamoDopoCambioStato(c.status, funnel.status),
```

- [ ] **Step 6: Lanciare i test e verificare che passino**

```bash
pnpm --filter piattaforma test src/lib/crm/
```

Atteso: PASS su tutta la cartella `lib/crm` (inclusi `match/stato.test.ts` e `sync-match.test.ts`, che non devono cambiare comportamento).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/apply.ts apps/piattaforma/src/lib/crm/sync.ts apps/piattaforma/src/lib/crm/match/apply.test.ts apps/piattaforma/src/lib/crm/sync-firma.test.ts
git commit -m "fix(crm): registrarsi chiude il richiamo, non lo lascia appeso"
```

---

### Task 5: Modale di riga e riga del richiamo in tabella

**Files:**
- Create: `apps/piattaforma/src/app/admin/crm/contatti/richiamo-dialog.tsx`
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (`STATI_LABEL` righe 110-122, `STATI_COLOR` righe 124-136, `StatusSelect` righe 527-577)

**Interfaces:**
- Consumes: `OPZIONI_FASCIA`, `etichettaRichiamo`, `STATO_RICHIAMARE` da `@/lib/crm/richiamo` (Task 2); `updateCrmContactStatusAction(id, status, richiamo?)` (Task 3)
- Produces: componente `RichiamoDialog` con props `{ giornoIniziale: string; fasciaIniziale: string; pending: boolean; onConferma: (giorno: string, fascia: string) => void; onAnnulla: () => void }`

- [ ] **Step 1: Creare il modale**

`apps/piattaforma/src/app/admin/crm/contatti/richiamo-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { OPZIONI_FASCIA } from '@/lib/crm/richiamo';

/**
 * Mini-modale che raccoglie giorno e fascia di un richiamo.
 *
 * Il giorno è obbligatorio e il bottone resta disabilitato finché manca: così
 * non esiste un istante in cui il contatto è in S11 senza sapere quando
 * richiamarlo. Riaprendolo su un richiamo già programmato, i campi arrivano
 * precompilati — riprogrammare è spostare un appuntamento, non riscriverlo.
 */
export function RichiamoDialog({
  giornoIniziale,
  fasciaIniziale,
  pending,
  onConferma,
  onAnnulla,
}: {
  giornoIniziale: string;
  fasciaIniziale: string;
  pending: boolean;
  onConferma: (giorno: string, fascia: string) => void;
  onAnnulla: () => void;
}) {
  const [giorno, setGiorno] = useState(giornoIniziale);
  const [fascia, setFascia] = useState(fasciaIniziale);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Programma il richiamo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      onClick={onAnnulla}
    >
      <div
        className="w-full max-w-sm rounded-[16px] bg-white p-5 shadow-[var(--pv-shadow-card-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold text-pv-navy-900">
          Richiamare questo contatto
        </h3>

        <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
          Giorno *
          <input
            type="date"
            value={giorno}
            disabled={pending}
            onChange={(e) => setGiorno(e.target.value)}
            className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          />
        </label>

        <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
          Fascia
          <select
            value={fascia}
            disabled={pending}
            onChange={(e) => setFascia(e.target.value)}
            className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          >
            {OPZIONI_FASCIA.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onAnnulla} disabled={pending}>
            Annulla
          </Button>
          <Button
            size="sm"
            onClick={() => onConferma(giorno, fascia)}
            disabled={pending || !giorno}
            loading={pending}
            loadingLabel="Salvataggio…"
          >
            Programma
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Aggiungere etichetta e colore di `S11`**

In `client.tsx`, in `STATI_LABEL` (dopo `S10`):

```ts
  S10: 'Churned',
  S11: 'Richiamare',
```

In `STATI_COLOR` (dopo `S10`):

```ts
  S10: 'bg-pv-slate-100 text-pv-slate-500',
  S11: 'bg-pv-navy-100 text-pv-navy-800',
```

- [ ] **Step 3: Riscrivere `StatusSelect`**

Aggiungere gli import in cima a `client.tsx`:

```ts
import { etichettaRichiamo, STATO_RICHIAMARE } from '@/lib/crm/richiamo';
import { RichiamoDialog } from './richiamo-dialog';
```

Sostituire l'intero componente `StatusSelect` (righe 527-577) con:

```tsx
function StatusSelect({
  contact,
  currentUserRole,
  currentUserId,
}: {
  contact: ContactRow;
  currentUserRole: string;
  currentUserId: string;
}) {
  const [value, setValue] = useState(contact.status);
  const [chiedeRichiamo, setChiedeRichiamo] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const disabled =
    currentUserRole === 'SALES' && contact.assignedToId !== currentUserId;

  const salva = (next: string, richiamo?: { giorno: string; fascia: string }): void => {
    const prev = value;
    setValue(next); // ottimistico
    startTransition(async () => {
      const res = await updateCrmContactStatusAction(contact.id, next, richiamo);
      if (!res.ok) {
        setValue(prev); // revert
        alert(res.error);
        return;
      }
      setChiedeRichiamo(false);
      router.refresh();
    });
  };

  // Scegliere "Richiamare" NON salva: prima serve sapere quando. Lo stato
  // ottimistico resta fermo finché il modale non conferma, così l'Annulla
  // riporta la tendina dov'era senza rimettere le mani sul valore.
  const onChange = (next: string): void => {
    if (next === STATO_RICHIAMARE) {
      setChiedeRichiamo(true);
      return;
    }
    salva(next);
  };

  const richiamo =
    value === STATO_RICHIAMARE && contact.nextContactAt
      ? etichettaRichiamo(contact.nextContactAt, contact.nextContactFascia, new Date())
      : null;

  return (
    <>
      <select
        value={value}
        disabled={disabled || pending}
        onChange={(e) => onChange(e.target.value)}
        title={STATI_LABEL[value] ?? value}
        className={
          'rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wider disabled:opacity-60 ' +
          (STATI_COLOR[value] ?? 'bg-pv-slate-100 text-pv-slate-700')
        }
      >
        {Object.entries(STATI_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {k} — {l}
          </option>
        ))}
      </select>

      {richiamo && (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => setChiedeRichiamo(true)}
          title="Riprogramma il richiamo"
          className={
            'mt-1 block text-[11.5px] font-semibold hover:underline disabled:no-underline ' +
            (richiamo.scaduto
              ? 'text-pv-red-500'
              : richiamo.oggi
                ? 'text-pv-orange-500'
                : 'text-pv-slate-500')
          }
        >
          📞 {richiamo.testo}
        </button>
      )}

      {chiedeRichiamo && (
        <RichiamoDialog
          giornoIniziale={contact.nextContactAt?.slice(0, 10) ?? ''}
          fasciaIniziale={contact.nextContactFascia ?? ''}
          pending={pending}
          onConferma={(giorno, fascia) =>
            salva(STATO_RICHIAMARE, { giorno, fascia })
          }
          onAnnulla={() => setChiedeRichiamo(false)}
        />
      )}

      <LoadingOverlay show={pending} label="Aggiornamento…" />
    </>
  );
}
```

- [ ] **Step 4: Aggiungere il campo al tipo `ContactRow`**

In `client.tsx`, dentro `type ContactRow`, dopo `nextContactAt: string | null;`:

```ts
  nextContactAt: string | null;
  nextContactFascia: string | null;
```

E in `initialData()`, dopo la riga di `nextContactAt`:

```ts
    nextContactAt: c?.nextContactAt?.slice(0, 10) ?? '',
    nextContactFascia: (c?.nextContactFascia ?? '') as CrmContactInput['nextContactFascia'],
```

- [ ] **Step 5: Verificare che compili**

```bash
pnpm --filter piattaforma exec tsc --noEmit
```

Atteso: nessun errore. Se ne compare uno su `nextContactFascia` mancante in `page.tsx`, è previsto: lo aggiunge il Task 7. In quel caso proseguire e ricontrollare a fine Task 7.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/richiamo-dialog.tsx apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): scegliere Richiamare chiede quando, e la riga lo mostra"
```

---

### Task 6: Fascia e validazione nella scheda contatto

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (`contactSchema` righe 143-146, `ContactModal.handleSave` righe 920-937, `TabStato` righe 1442-1540)

**Interfaces:**
- Consumes: `OPZIONI_FASCIA` da `@/lib/crm/richiamo` (Task 2); primitivi `useFieldErrorsState`/`zodFieldErrors` già importati nel file
- Produces: niente verso altri task

- [ ] **Step 1: Estendere la validazione client**

In `client.tsx`, sostituire `contactSchema` (righe 143-146) con:

```ts
// Obbligatori compilabili a mano nel modale contatto (cat/status hanno sempre un
// valore di default). Stesse regole del server (createCrmContactAction).
const contactSchema = z
  .object({
    nome: z.string().trim().min(1, 'Nome obbligatorio'),
    tel: z.string().trim().min(1, 'Telefono obbligatorio'),
    status: z.string(),
    nextContactAt: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.status === 'S11' && !d.nextContactAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextContactAt'],
        message: 'Con lo stato Richiamare serve il giorno',
      });
    }
  });
```

E aggiornare la riga che lo usa (riga ~902):

```ts
  const errors = zodFieldErrors(contactSchema, {
    nome: data.nome,
    tel: data.tel,
    status: data.status,
    nextContactAt: data.nextContactAt ?? '',
  });
```

- [ ] **Step 2: Portare l'utente sul tab giusto quando l'errore è lì**

In `handleSave` (righe ~920-937), sostituire il blocco che sceglie il tab:

```ts
    reveal();
    if (hasBlockingErrors(errors)) {
      // Il giorno del richiamo vive nel tab "Stato & Chiamate", gli altri
      // obbligatori in "Anagrafica": portare l'utente dove sta l'errore.
      setTab(field('nextContactAt').invalid ? 'stato' : 'anagrafica');
      return;
    }
```

- [ ] **Step 3: Passare `field` al tab Stato**

Dove `TabStato` viene renderizzato (riga ~1027):

```tsx
          {tab === 'stato' && (
            <TabStato data={data} set={set} readOnly={isReadOnlyForSales} field={field} />
          )}
```

- [ ] **Step 4: Aggiungere il campo fascia e l'errore sul giorno**

In `TabStato`, cambiare la firma e i due campi. Sostituire da `function TabStato({ data, set, readOnly }: TabProps) {` fino alla fine del `FieldText` di «Prossimo contatto pianificato»:

```tsx
function TabStato({
  data,
  set,
  readOnly,
  field,
}: TabProps & { field: (key: string) => FieldState }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FieldSelect
        label="Stato CRM"
        value={data.status}
        required
        readOnly={readOnly}
        onChange={(v) => set('status', v as CrmContactInput['status'])}
        options={Object.entries(STATI_LABEL).map(([k, l]) => ({
          value: k,
          label: `${k} — ${l}`,
        }))}
      />
      <FieldText
        label="Ultimo contatto"
        type="date"
        value={data.lastContactAt ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('lastContactAt', v)}
      />
      <FieldText
        label="Prossimo contatto pianificato"
        type="date"
        value={data.nextContactAt ?? ''}
        required={data.status === 'S11'}
        readOnly={readOnly}
        onChange={(v) => set('nextContactAt', v)}
        invalid={field('nextContactAt').invalid}
        error={field('nextContactAt').error}
        onBlur={field('nextContactAt').onBlur}
      />
      <FieldSelect
        label="Fascia del richiamo"
        value={(data.nextContactFascia as string) ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('nextContactFascia', v as never)}
        options={OPZIONI_FASCIA}
      />
```

Il resto del componente (da `<FieldText label="N. chiamate totali" …` in poi) resta invariato.

- [ ] **Step 5: Importare `OPZIONI_FASCIA`**

Estendere l'import già aggiunto nel Task 5:

```ts
import { etichettaRichiamo, OPZIONI_FASCIA, STATO_RICHIAMARE } from '@/lib/crm/richiamo';
```

- [ ] **Step 6: Verificare che compili e che i test tengano**

```bash
pnpm --filter piattaforma exec tsc --noEmit
pnpm --filter piattaforma test src/app/admin/crm/
```

Atteso: nessun errore TS (salvo quello atteso su `page.tsx`, vedi Task 5 Step 5); test verdi.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): fascia e giorno del richiamo anche nella scheda contatto"
```

---

### Task 7: Chip «Da richiamare», filtro e conteggio

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/page.tsx` (`STATI` righe 11-23, `SearchParams` righe 25-34, filtro righe 69-73, `orderBy` righe 86-89, `Promise.all` righe 94-121, serializzazione righe 146-167, props del client)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (`toggleUrgenti` righe 207-209, barra filtri righe 287-298)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/query.test.ts` (nuovo caso sul preset)

**Interfaces:**
- Consumes: `sogliaRichiamoDovuto` da `@/lib/crm/richiamo` (Task 2)
- Produces: prop `richiamiDovuti: number` verso `CrmContactsClient`; valore `preset=richiamo` nella querystring

- [ ] **Step 1: Scrivere il test che fallisce sulla querystring**

In `apps/piattaforma/src/app/admin/crm/contatti/query.test.ts`, aggiungere:

```ts
  it('il preset dei richiami finisce in querystring come gli altri', () => {
    expect(buildContactsQuery({ preset: 'richiamo' })).toBe('preset=richiamo');
  });
```

- [ ] **Step 2: Lanciare il test**

```bash
pnpm --filter piattaforma test src/app/admin/crm/contatti/query.test.ts
```

Atteso: PASS già adesso — `buildContactsQuery` è generica sul valore di `preset`. È un presidio, non un cambio: se qualcuno restringesse il preset a `'urgenti'`, questo test lo intercetta.

- [ ] **Step 3: Estendere `page.tsx` — stati, tipi e filtro**

`STATI` (righe 11-23) diventa:

```ts
const STATI = [
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5',
  'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
] as const;
```

`SearchParams.preset` (riga 32):

```ts
  preset?: 'urgenti' | 'richiamo' | '';
```

Import in cima:

```ts
import { sogliaRichiamoDovuto, STATO_RICHIAMARE } from '@/lib/crm/richiamo';
```

Il blocco filtro (righe 69-73) diventa:

```ts
  const adesso = new Date();
  if (sp.preset === 'urgenti') {
    where.status = { in: ['S6', 'S5', 'S4', 'S3'] };
  } else if (sp.preset === 'richiamo') {
    // Dovuti = oggi o già passati. La soglia è la fine della giornata ROMANA:
    // con l'ora UTC, dalle 22:00 in poi i richiami di oggi sparirebbero dal
    // chip pur essendo ancora di oggi.
    where.status = STATO_RICHIAMARE as (typeof STATI)[number];
    where.nextContactAt = { lte: sogliaRichiamoDovuto(adesso) };
  } else if (sp.status && STATI.includes(sp.status as (typeof STATI)[number])) {
    where.status = sp.status as (typeof STATI)[number];
  }
```

- [ ] **Step 4: Ordinamento del preset**

Sostituire il blocco `orderBy` (righe 86-89) con:

```ts
  const sort = sp.sort ?? 'recente';
  const orderBy: Prisma.CrmContactOrderByWithRelationInput[] =
    sp.preset === 'richiamo'
      ? // Il più arretrato in cima, e a parità di giorno prima la mattina.
        // L'enum ordina per posizione di dichiarazione (MATTINA, POMERIGGIO) e
        // i null ("indifferente") finiscono in coda.
        [{ nextContactAt: 'asc' }, { nextContactFascia: 'asc' }]
      : sort === 'nome'
        ? [{ nome: 'asc' }]
        : [{ lastContactAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
```

- [ ] **Step 5: Conteggio per il badge del chip**

Aggiungere alla `Promise.all` (righe 94-121) una sesta query, e ricordarsi di estendere la destrutturazione:

```ts
  // Lo scoping SALES vale anche per il badge: un venditore deve vedere il
  // numero dei SUOI richiami, non di tutti. Non si riusa `where` perché il
  // conteggio non deve dipendere dagli altri filtri attivi.
  const whereRichiamiDovuti: Prisma.CrmContactWhereInput = {
    deletedAt: null,
    status: STATO_RICHIAMARE as (typeof STATI)[number],
    nextContactAt: { lte: sogliaRichiamoDovuto(adesso) },
    ...(session.user.role === 'SALES' ? { assignedToId: session.user.id } : {}),
  };

Poi due modifiche chirurgiche alla `Promise.all` esistente. La riga di apertura (riga 94) diventa:

```ts
  const [pageContacts, total, salesUsers, statsCounts, promoCodes, richiamiDovuti] = await Promise.all([
```

e come **ultimo** elemento dell'array, subito dopo `listPromoCodesEmailPartenzaAction(),` e prima di `]);`:

```ts
    listPromoCodesEmailPartenzaAction(),
    prisma.crmContact.count({ where: whereRichiamiDovuti }),
  ]);
```

Le cinque query già presenti restano intatte.

- [ ] **Step 6: Serializzare la fascia e passare il conteggio**

Nel `.map()` di serializzazione (righe 146-167) non serve nulla: `nextContactFascia` è una stringa enum e passa con lo spread di `...c`. Verificarlo a occhio; se il tipo non torna, aggiungere esplicitamente `nextContactFascia: c.nextContactFascia ?? null,`.

Nel JSX, aggiungere la prop:

```tsx
        <CrmContactsClient
          contacts={contacts}
          salesUsers={…}
          promoCodes={promoCodes.validi}
          promoCodesScartati={promoCodes.scartati}
          richiamiDovuti={richiamiDovuti}
```

- [ ] **Step 7: Chip nel client**

In `client.tsx`, aggiungere la prop alla firma di `CrmContactsClient` (dopo `promoCodesScartati: number;`):

```ts
  /** Richiami dovuti oggi o già scaduti, nello scope dell'utente. */
  richiamiDovuti: number;
```

e al destructuring dei parametri, accanto a `promoCodesScartati,`:

```ts
  richiamiDovuti,
```

Accanto a `toggleUrgenti` (righe 207-209):

```ts
  const toggleRichiami = (): void => {
    updateFilter('preset', filters.preset === 'richiamo' ? '' : 'richiamo');
  };
```

E subito dopo il bottone `🔴 Urgenti` (riga ~298):

```tsx
        <button
          type="button"
          onClick={toggleRichiami}
          className={
            'rounded-[10px] border-[1.5px] px-3 py-2 text-[13px] font-semibold transition ' +
            (filters.preset === 'richiamo'
              ? 'border-pv-navy-700 bg-pv-navy-100 text-pv-navy-800'
              : 'border-pv-slate-300 bg-white text-pv-slate-700 hover:bg-pv-slate-50')
          }
        >
          📞 Da richiamare
          {richiamiDovuti > 0 && (
            <span className="ml-1.5 text-pv-navy-700">· {richiamiDovuti}</span>
          )}
        </button>
```

- [ ] **Step 8: Verificare compilazione e test**

```bash
pnpm --filter piattaforma exec tsc --noEmit
pnpm --filter piattaforma test src/app/admin/crm/
```

Atteso: **zero** errori TS adesso (anche quello rimandato dal Task 5), test verdi.

- [ ] **Step 9: Provare la query sul DB reale**

I test mockano Prisma: la `where` con `lte` su `nextContactAt` e l'`orderBy` su un enum non sono mai stati eseguiti davvero. Verificarli in sola lettura sul postgres locale:

```bash
docker exec -i pv-postgres psql -U postgres -d passaggio_veloce -c "SELECT id, nome, status, \"nextContactAt\", \"nextContactFascia\" FROM crm_contacts WHERE status = 'S11' AND \"nextContactAt\" <= now() AND \"deletedAt\" IS NULL ORDER BY \"nextContactAt\" ASC, \"nextContactFascia\" ASC LIMIT 10;"
```

Atteso: la query gira senza errori (zero righe va bene — è il piano di esecuzione che si sta verificando, non il contenuto).

- [ ] **Step 10: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/page.tsx apps/piattaforma/src/app/admin/crm/contatti/client.tsx apps/piattaforma/src/app/admin/crm/contatti/query.test.ts
git commit -m "feat(crm): chip Da richiamare con i richiami dovuti oggi o scaduti"
```

---

### Task 8: Allineare gli altri consumer del funnel

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/dashboard/page.tsx` (`STATI_ORDER` righe 17-29, `STATI_LABEL` righe 31-43)
- Modify: `apps/piattaforma/src/app/admin/crm/sales/actions.ts` (enum `statoTarget`, riga 128)
- Modify: `apps/piattaforma/src/app/admin/crm/sales/client.tsx` (tendina dello stato target)
- Modify: `apps/piattaforma/src/lib/crm/csv-import.ts` (`CrmStatus` riga 16, `STATUS_SET` righe 131-133)
- Modify: `docs/crm-spec-implementativa.md` (enum e sezione filtri)

**Interfaces:**
- Consumes: valore `S11` dell'enum (Task 1)
- Produces: niente verso altri task

- [ ] **Step 1: Dashboard — stato nell'elenco e nella legenda**

In `dashboard/page.tsx`, `STATI_ORDER` diventa:

```ts
const STATI_ORDER = [
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5',
  'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
] as const;
```

e `STATI_LABEL` prende in fondo:

```ts
  S10: 'Churned',
  S11: 'Richiamare',
```

**Non** aggiungere `S11` alle metriche «Da contattare», «Interessati», «Iscritti», «Attivi» o «Churned»: non è nessuna di quelle cose, e infilarlo in una falserebbe un numero che qualcuno guarda. Entra solo nel totale e nella distribuzione per stato.

- [ ] **Step 2: Campagne — target selezionabile**

In `sales/actions.ts` riga 128:

```ts
  statoTarget: z
    .enum(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'])
    .optional()
    .or(z.literal('')),
```

In `sales/client.tsx`, `STATI_TARGET` (righe 80-88) si ferma a `S5` — di proposito: si telefona a chi non si è ancora iscritto. `S11` appartiene a quella famiglia, quindi va aggiunto in fondo:

```ts
  { v: 'S5', l: 'S5 — Link aperto' },
  { v: 'S11', l: 'S11 — Richiamare' },
];
```

Gli stati post-iscrizione (`S6`-`S10`) restano fuori dalla tendina, come sono adesso.

- [ ] **Step 3: Import CSV**

In `lib/crm/csv-import.ts`, riga 16:

```ts
export type CrmStatus =
  | 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
  | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S11';
```

e `STATUS_SET` (righe 131-133):

```ts
const STATUS_SET = new Set<string>([
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11',
]);
```

- [ ] **Step 4: Presidiare gli automatismi che NON devono spostare S11**

`nextStatoInvio` e `nextStatoApertura` fanno avanzare lo stato solo da `S0`-`S3` / `S0`-`S4`. `S11` non è in quei set, quindi inviare l'email di partenza a un contatto da richiamare **non lo sposta** e il richiamo sopravvive all'invio del link. Oggi è vero per caso: nessun test lo dice. In fondo a `apps/piattaforma/src/lib/crm/email-partenza.test.ts`, dentro il `describe` che copre quelle due funzioni:

```ts
  it('mandare il link a un contatto da richiamare non chiude il richiamo', () => {
    // Il cliente ha chiesto di essere risentito: ricevere il link non toglie
    // quella promessa, quindi lo stato (e con lui il promemoria) resta.
    expect(nextStatoInvio('S11')).toBe('S11');
    expect(nextStatoApertura('S11')).toBe('S11');
  });
```

Lanciare: `pnpm --filter piattaforma test src/lib/crm/email-partenza.test.ts` — atteso PASS senza toccare `email-partenza.ts`. Se fosse rosso, **non** modificare il test: significa che uno dei due set contiene `S11` e va tolto.

> Se i nomi importati nel file di test non sono già `nextStatoInvio`/`nextStatoApertura`, aggiungerli all'import esistente in cima al file.

- [ ] **Step 5: Aggiornare la spec di prodotto**

In `docs/crm-spec-implementativa.md`:
- nell'`enum CrmStatoContatto` (riga ~154) aggiungere `S11 // Richiamare — richiamo programmato (giorno + fascia)`;
- nel model, accanto a `nextContactAt`, aggiungere `nextContactFascia  CrmFasciaContatto?  // null = indifferente`;
- nella sezione **Filtri** (riga ~383) cambiare `Stato: tutti | S0..S10` in `S0..S11` e aggiungere una riga: `- Chip "📞 Da richiamare": status S11 con giorno ≤ oggi (fuso di Roma), ordinati dal più arretrato`.

Lasciare invariata la riga dell'ordinamento «urgenti»: quel chip non cambia.

- [ ] **Step 6: Rigenerare la KB del chatbot**

Il documento appena toccato alimenta la KB generata al prebuild: senza rigenerarla, il file `kb.generated.ts` committato resta indietro rispetto ai docs.

```bash
pnpm --filter piattaforma kb:build
pnpm --filter piattaforma test src/lib/providers/chatbot/kb/
```

Atteso: KB rigenerata, `leak.test.ts` e `assemble.test.ts` verdi.

- [ ] **Step 7: Verifica completa**

```bash
pnpm --filter piattaforma test
pnpm typecheck
```

Atteso: tutta la suite verde, typecheck pulito.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/dashboard/page.tsx apps/piattaforma/src/app/admin/crm/sales apps/piattaforma/src/lib/crm/csv-import.ts apps/piattaforma/src/lib/crm/email-partenza.test.ts docs/crm-spec-implementativa.md apps/piattaforma/src/lib/providers/chatbot/kb/kb.generated.ts
git commit -m "feat(crm): S11 visibile in dashboard, campagne, import CSV e spec"
```

---

### Task 9: Verifica nel browser

**Files:** nessuno da modificare — è il collaudo. Eventuali fix trovati qui vanno committati a parte.

**Interfaces:**
- Consumes: tutto quanto sopra
- Produces: la prova che la feature funziona davvero

> Due bug React di questo repo (un tab che si spegneva, un modale che rubava il focus) erano invisibili a vitest e a `tsc`: qui si guarda il DOM, non il sorgente. E navigare per URL non è cliccare — i chip vanno **cliccati**.

- [ ] **Step 1: Avviare l'app pulita**

Assicurarsi che non ci sia un dev server zombie sulla 3000 (fermare il task non uccide Next: resterebbe a servire il codice vecchio).

```bash
netstat -ano | findstr :3000
pnpm --filter piattaforma dev
```

- [ ] **Step 2: Programmare un richiamo dalla tendina**

Su `/admin/crm/contatti`, scegliere `S11 — Richiamare` sulla riga di un contatto.
Verificare: si apre il modale, «Programma» è **disabilitato** finché il giorno è vuoto.

- [ ] **Step 3: Annullare e controllare la tendina**

Premere «Annulla». Verificare che la tendina sia tornata allo stato **precedente**, non a Richiamare, e che il DB non sia stato toccato (ricaricare la pagina: lo stato deve essere ancora quello di prima).

- [ ] **Step 4: Confermare**

Riaprire, mettere un giorno **passato** e fascia Mattina, confermare.
Verificare: la riga mostra `📞 <giorno> · mattina` in **rosso**; ripetere su un altro contatto con giorno **oggi** (arancio) e uno **futuro** (grigio).

- [ ] **Step 5: Riprogrammare**

Cliccare sulla riga `📞`. Verificare che il modale si apra **precompilato** con giorno e fascia già programmati, cambiare giorno, confermare, e vedere la riga aggiornata.

- [ ] **Step 6: Chip**

Cliccare `📞 Da richiamare`. Verificare: il badge riporta il numero dei richiami dovuti; la lista mostra solo `S11` con giorno ≤ oggi, il più arretrato in cima; cliccando `🔴 Urgenti` il chip precedente si spegne (mutua esclusione); «Reset» pulisce tutto.

- [ ] **Step 7: Chiusura del richiamo**

Su un contatto in `S11`, cambiare stato in `S3` dalla tendina. Verificare che la riga `📞` sparisca, che il badge del chip cali di uno, e che riaprendo la scheda «Prossimo contatto pianificato» e «Fascia del richiamo» siano **vuoti**.

- [ ] **Step 8: Scheda contatto**

Aprire un contatto, tab «Stato & Chiamate», mettere stato `S11` lasciando il giorno vuoto e premere «Salva». Verificare: il modale **porta sul tab Stato**, il campo giorno è bordato di rosso con il messaggio, e nessun campo era rosso all'apertura.

- [ ] **Step 9: Commit di eventuali fix**

Se qualcosa non torna, sistemarlo e committare con un messaggio che dica **cosa** non funzionava. Se è tutto a posto, niente commit: il collaudo non produce codice.

---

## Note per il rilascio

- **Le due migration vanno applicate su Neon PRIMA del push su main**, altrimenti il codice nuovo interroga una colonna che in prod non esiste e la vista contatti va giù. Sono entrambe additive, quindi applicarle in anticipo non rompe il codice attualmente in produzione.
- DB di produzione: Neon **ep-solitary-night** (la fonte è `DATABASE_URL` su Vercel, non `ep-hidden-scene`).
- Deploy = push su `main`.
