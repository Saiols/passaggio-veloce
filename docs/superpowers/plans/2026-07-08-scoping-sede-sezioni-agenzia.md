# Scoping per sede delle sezioni agenzia/broker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni sezione dati (badge, addebiti, feedback, fatture, affiliazione, download) mostra all'utente **solo la sua sede**, non l'intera azienda madre.

**Architecture:** Il `SessionContext` espone già `scopeIds` (sedi accessibili) e `isOwner`. Introduciamo un modulo **puro** `lib/sedi/scope-filters.ts` che traduce il contesto in predicati Prisma (`where`), testabile senza DB. Ogni pagina/route smette di filtrare per `session.user.companyId` e usa quel predicato. Il filtro madre (`agenziaId: companyId`) **resta sempre** come guardia: la sede non sostituisce la company, la restringe.

**Regola di visibilità (decisa con l'utente):**
- **Owner (ADMIN_AZIENDA) in vista aggregata (`ALL`)** → vede tutto il gruppo, come oggi. Nessuna regressione, incluse le righe legacy con sede `NULL`.
- **Owner con una sede selezionata**, oppure **ADMIN_SEDE / OPERATORE** → vede **solo** le righe delle sedi in `scopeIds`. Fail-closed: `scopeIds` vuoto ⇒ nessuna riga.

**Tech Stack:** Next.js 16 App Router (Server Components), Prisma 5.22, Vitest, Postgres 17.

## Global Constraints

- **Nessuna modifica di schema.** Le colonne sede esistono già: `Pratica.agenziaSedeId`/`brokerSedeId`, `PraticaAssegnazione.sedeId`, `FeeAddebito.agenziaSedeId`, `Valutazione.agenziaSedeId`, `Company.referenteSedeId`, `CommissioneAffiliazione.referenteSedeId`, `ReferralClick.sedeId`, `Sede.referralCode`, `Wallet.sedeId`. **Unica migration ammessa: il backfill dati del Task 1** (nessun DDL).
- `DocumentoFiscale` **non ha** colonna sede: si scopa via relazione (`pratica.agenziaSedeId` / `pratica.brokerSedeId` / `payout.wallet.sedeId`). I documenti senza pratica **né** payout restano visibili al solo owner aggregato.
- Il filtro company **non va mai rimosso**: ogni `where` mantiene `agenziaId`/`destinatarioCompanyId`/`referenteId` = `companyId`.
- Fail-closed ovunque: `scopeIds: []` ⇒ `{ in: [] }` ⇒ zero righe. Mai fallback a "tutta la madre" per un non-owner.
- Palette e componenti invariati: nessun colore hardcoded, nessun restyling. Questo è un intervento di **sola logica di query e autorizzazione**.
- `pnpm --filter piattaforma test` e `pnpm --filter piattaforma typecheck` devono restare verdi a ogni commit.

## File Structure

| File | Responsabilità |
|---|---|
| `apps/piattaforma/src/lib/sedi/scope-filters.ts` | **Nuovo.** Puro. `toSedeScope(ctx)` + un predicato `where*` per modello. Unica fonte dei filtri sede. |
| `apps/piattaforma/src/lib/sedi/scope-filters.test.ts` | **Nuovo.** Test dei predicati (owner aggregato / owner su sede / membro / scope vuoto). |
| `packages/db/prisma/migrations/20260708160000_fee_addebito_sede_backfill/migration.sql` | **Nuovo.** Backfill dati `fee_addebiti.agenziaSedeId` (no DDL). |
| `apps/piattaforma/src/app/pratiche/actions.ts:290-302` | Fix write: `feeAddebito.create` scrive `agenziaSedeId`. |
| `apps/piattaforma/src/app/api/badges/route.ts` | Conteggi inbox + pratiche attive per sede. |
| `apps/piattaforma/src/app/api/badges/route.test.ts` | **Nuovo.** Test di regressione del badge. |
| `apps/piattaforma/src/app/addebiti/page.tsx:48` | `where` per sede. |
| `apps/piattaforma/src/app/feedback/page.tsx:29-45` | `where` per sede (lista + media). |
| `apps/piattaforma/src/lib/fatturazione/access.ts` | `canViewDocumentoFiscale` diventa sede-aware. |
| `apps/piattaforma/src/lib/fatturazione/access.test.ts` | Estende i test al nuovo parametro. |
| `apps/piattaforma/src/app/fatturazione/page.tsx:110-112` | Scope lista fatture. |
| `apps/piattaforma/src/app/fatturazione/[id]/page.tsx:80` | Passa lo scope sede a `canViewDocumentoFiscale`. |
| `apps/piattaforma/src/app/pratiche/[id]/page.tsx:107` | **Terzo chiamante** di `canViewDocumentoFiscale`: adegua la chiamata (vedi Task 6 Step 6b). |
| `apps/piattaforma/src/app/api/fatturazione/[id]/pdf/route.ts`, `.../xml/route.ts`, `.../zip/route.ts` | Stessa autorizzazione della UI (no leak per ID). |
| `apps/piattaforma/src/app/affiliazione/page.tsx` | Vista sede (link + referral propri) vs owner (aggregato + classifica). |
| `apps/piattaforma/src/app/api/pratiche/[id]/pdf/route.ts`, `.../zip/route.ts`, `api/documenti/[id]/route.ts` | Autorizzazione download per sede. |

---

### Task 1: `FeeAddebito.agenziaSedeId` — write path + backfill

**Perché per prima:** oggi `feeAddebito.create` **non** valorizza `agenziaSedeId`. Ogni fee creata dopo la migration `20260624013750_multi_sede_expand` ha sede `NULL`. Se scopassimo `/addebiti` per sede *prima* di questa fix, la pagina risulterebbe **vuota per tutti**. Il backfill deriva la sede dalla pratica collegata.

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts:290-302`
- Create: `packages/db/prisma/migrations/20260708160000_fee_addebito_sede_backfill/migration.sql`

**Interfaces:**
- Produces: invariante "ogni `FeeAddebito` ha `agenziaSedeId` = `pratica.agenziaSedeId`", su cui si appoggia il Task 4.

- [ ] **Step 1: verificare che la pratica in scope esponga `agenziaSedeId`**

Nel `select` della pratica usato dalla transazione di firma, assicurarsi che `agenziaSedeId` sia presente. Se manca, aggiungerlo:

```ts
// apps/piattaforma/src/app/pratiche/actions.ts — select della pratica nella tx
select: {
  id: true,
  agenziaAssegnataId: true,
  agenziaSedeId: true, // <-- necessario per il fee addebito per-sede
  feeAgenziaCent: true,
  creditoBrokerCent: true,
  // ...resto invariato
}
```

Run: `grep -n "agenziaSedeId" apps/piattaforma/src/app/pratiche/actions.ts`
Expected: almeno una riga nel `select` della pratica, oltre a quella della `valutazione.create`.

- [ ] **Step 2: scrivere la sede nel `feeAddebito.create`**

```ts
// apps/piattaforma/src/app/pratiche/actions.ts:290-302
if (pratica.feeAgenziaCent > 0) {
  await tx.feeAddebito.create({
    data: {
      praticaId: pratica.id,
      agenziaId,
      // Multi-sede: l'addebito appartiene alla SEDE che ha lavorato la pratica.
      // Senza questo, /addebiti (scopato per sede) non vedrebbe la riga.
      agenziaSedeId: pratica.agenziaSedeId,
      importoCent: pratica.feeAgenziaCent,
      tipo: 'ADDEBITO_FIRMA',
      stato: 'SCHEDULED',
      scheduledAt: autoAddebitoAt,
    },
  });
}
```

- [ ] **Step 3: scrivere la migration di backfill (solo dati, nessun DDL)**

```sql
-- packages/db/prisma/migrations/20260708160000_fee_addebito_sede_backfill/migration.sql
-- Backfill dati: `fee_addebiti.agenziaSedeId` non veniva valorizzato alla creazione
-- (la colonna esiste dalla 20260624013750_multi_sede_expand, ma solo il backfill
-- iniziale la popolava). Le fee create da allora hanno sede NULL e sparirebbero
-- da /addebiti una volta introdotto lo scoping per sede.
-- Deriva la sede dalla pratica collegata. Idempotente: tocca solo le righe NULL.
-- Nessun DDL: nessun lock di tabella oltre agli UPDATE.

UPDATE "fee_addebiti" f
SET "agenziaSedeId" = p."agenziaSedeId"
FROM "pratiche" p
WHERE f."praticaId" = p."id"
  AND f."agenziaSedeId" IS NULL
  AND p."agenziaSedeId" IS NOT NULL;
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errori.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/actions.ts packages/db/prisma/migrations/20260708160000_fee_addebito_sede_backfill
git commit -m "fix(addebiti): FeeAddebito porta la sede della pratica (+ backfill righe esistenti)"
```

---

### Task 2: modulo puro `scope-filters.ts`

**Files:**
- Create: `apps/piattaforma/src/lib/sedi/scope-filters.ts`
- Test: `apps/piattaforma/src/lib/sedi/scope-filters.test.ts`

**Interfaces:**
- Consumes: `SessionContext` da `@/lib/auth/session-context` (`scopeIds`, `isOwner`, `currentSede`).
- Produces (usati da tutti i task successivi):
  - `type SedeScope = { scopeIds: string[]; aggregate: boolean }`
  - `toSedeScope(ctx: { isOwner: boolean; scopeIds: string[]; currentSede: { kind: 'ALL' } | { kind: 'ONE'; sede: { id: string } } | null }): SedeScope`
  - `whereFeeAddebito(scope: SedeScope, companyId: string): Prisma.FeeAddebitoWhereInput`
  - `whereValutazione(scope: SedeScope, agenziaId: string): Prisma.ValutazioneWhereInput`
  - `wherePraticaAttiva(scope: SedeScope, args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' }): Prisma.PraticaWhereInput`
  - `whereAssegnazionePending(scope: SedeScope, agenziaId: string): Prisma.PraticaAssegnazioneWhereInput`
  - `whereDocumentoFiscale(scope: SedeScope, args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' }): Prisma.DocumentoFiscaleWhereInput`

- [ ] **Step 1: Write the failing test**

```ts
// apps/piattaforma/src/lib/sedi/scope-filters.test.ts
import { describe, expect, it } from 'vitest';
import {
  toSedeScope,
  whereFeeAddebito,
  whereValutazione,
  wherePraticaAttiva,
  whereAssegnazionePending,
  whereDocumentoFiscale,
} from './scope-filters';

const OWNER_ALL = { isOwner: true, scopeIds: ['s1', 's2'], currentSede: { kind: 'ALL' as const } };
const OWNER_ONE = {
  isOwner: true,
  scopeIds: ['s1'],
  currentSede: { kind: 'ONE' as const, sede: { id: 's1' } },
};
const MEMBRO = {
  isOwner: false,
  scopeIds: ['s2'],
  currentSede: { kind: 'ONE' as const, sede: { id: 's2' } },
};
const SENZA_SEDI = { isOwner: false, scopeIds: [], currentSede: null };

describe('toSedeScope', () => {
  it('aggrega solo per il proprietario in vista ALL', () => {
    expect(toSedeScope(OWNER_ALL)).toEqual({ scopeIds: ['s1', 's2'], aggregate: true });
    expect(toSedeScope(OWNER_ONE)).toEqual({ scopeIds: ['s1'], aggregate: false });
    expect(toSedeScope(MEMBRO)).toEqual({ scopeIds: ['s2'], aggregate: false });
    expect(toSedeScope(SENZA_SEDI)).toEqual({ scopeIds: [], aggregate: false });
  });
});

describe('whereFeeAddebito', () => {
  it("owner aggregato: tutta la madre (include le righe legacy senza sede)", () => {
    expect(whereFeeAddebito(toSedeScope(OWNER_ALL), 'c1')).toEqual({ agenziaId: 'c1' });
  });

  it('membro: solo le sedi in scope, sempre dentro la madre', () => {
    expect(whereFeeAddebito(toSedeScope(MEMBRO), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: ['s2'] },
    });
  });

  it('senza sedi accessibili: fail-closed, nessuna riga', () => {
    expect(whereFeeAddebito(toSedeScope(SENZA_SEDI), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: [] },
    });
  });
});

describe('whereValutazione', () => {
  it('membro: feedback della sola sede', () => {
    expect(whereValutazione(toSedeScope(MEMBRO), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: ['s2'] },
    });
  });
});

describe('wherePraticaAttiva', () => {
  it('agenzia membro: filtra su agenziaSedeId', () => {
    expect(wherePraticaAttiva(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      agenziaAssegnataId: 'c1',
      agenziaSedeId: { in: ['s2'] },
      deletedAt: null,
    });
  });

  it('broker membro: filtra su brokerSedeId', () => {
    expect(wherePraticaAttiva(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'DEALER' })).toEqual({
      brokerId: 'c1',
      brokerSedeId: { in: ['s2'] },
      deletedAt: null,
    });
  });

  it('owner aggregato: nessun filtro sede', () => {
    expect(wherePraticaAttiva(toSedeScope(OWNER_ALL), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      agenziaAssegnataId: 'c1',
      deletedAt: null,
    });
  });
});

describe('whereAssegnazionePending', () => {
  it('membro: solo assegnazioni indirizzate alle sue sedi', () => {
    expect(whereAssegnazionePending(toSedeScope(MEMBRO), 'c1')).toEqual({
      agenziaId: 'c1',
      esito: 'PENDING',
      sedeId: { in: ['s2'] },
    });
  });
});

describe('whereDocumentoFiscale', () => {
  it('owner aggregato: tutti i documenti della madre', () => {
    expect(whereDocumentoFiscale(toSedeScope(OWNER_ALL), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual(
      { destinatarioCompanyId: 'c1' },
    );
  });

  it('agenzia membro: fattura della sua pratica oppure payout del suo wallet', () => {
    expect(whereDocumentoFiscale(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      AND: [
        { destinatarioCompanyId: 'c1' },
        {
          OR: [
            { pratica: { agenziaSedeId: { in: ['s2'] } } },
            { payout: { wallet: { sedeId: { in: ['s2'] } } } },
          ],
        },
      ],
    });
  });

  it('broker membro: si aggancia a brokerSedeId', () => {
    expect(whereDocumentoFiscale(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'DEALER' })).toEqual({
      AND: [
        { emittenteCompanyId: 'c1' },
        {
          OR: [
            { pratica: { brokerSedeId: { in: ['s2'] } } },
            { payout: { wallet: { sedeId: { in: ['s2'] } } } },
          ],
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/piattaforma && npx vitest run src/lib/sedi/scope-filters.test.ts`
Expected: FAIL — `Failed to load .../scope-filters` (modulo inesistente).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/piattaforma/src/lib/sedi/scope-filters.ts
import type { Prisma } from '@pv/db';

/**
 * Scoping sede per le query operative — logica pura (niente IO).
 *
 * `aggregate = true` SOLO per il proprietario in vista aggregata ("ALL"): vede
 * l'intero gruppo, comprese le righe legacy con sede NULL. In tutti gli altri
 * casi si filtra per `scopeIds` — fail-closed: lista vuota ⇒ nessuna riga.
 *
 * Il filtro sulla company NON viene mai rimosso: la sede restringe la madre,
 * non la sostituisce (una sede compromessa non può leggere altre aziende).
 */
export type SedeScope = { scopeIds: string[]; aggregate: boolean };

type CtxLike = {
  isOwner: boolean;
  scopeIds: string[];
  currentSede: { kind: 'ALL' } | { kind: 'ONE'; sede: { id: string } } | null;
};

export function toSedeScope(ctx: CtxLike): SedeScope {
  return {
    scopeIds: ctx.scopeIds,
    aggregate: ctx.isOwner && ctx.currentSede?.kind === 'ALL',
  };
}

export function whereFeeAddebito(scope: SedeScope, companyId: string): Prisma.FeeAddebitoWhereInput {
  if (scope.aggregate) return { agenziaId: companyId };
  return { agenziaId: companyId, agenziaSedeId: { in: scope.scopeIds } };
}

export function whereValutazione(scope: SedeScope, agenziaId: string): Prisma.ValutazioneWhereInput {
  if (scope.aggregate) return { agenziaId };
  return { agenziaId, agenziaSedeId: { in: scope.scopeIds } };
}

export function wherePraticaAttiva(
  scope: SedeScope,
  args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' },
): Prisma.PraticaWhereInput {
  const base: Prisma.PraticaWhereInput =
    args.ruolo === 'AGENZIA'
      ? { agenziaAssegnataId: args.companyId, deletedAt: null }
      : { brokerId: args.companyId, deletedAt: null };
  if (scope.aggregate) return base;
  return args.ruolo === 'AGENZIA'
    ? { ...base, agenziaSedeId: { in: scope.scopeIds } }
    : { ...base, brokerSedeId: { in: scope.scopeIds } };
}

export function whereAssegnazionePending(
  scope: SedeScope,
  agenziaId: string,
): Prisma.PraticaAssegnazioneWhereInput {
  const base: Prisma.PraticaAssegnazioneWhereInput = { agenziaId, esito: 'PENDING' };
  if (scope.aggregate) return base;
  return { ...base, sedeId: { in: scope.scopeIds } };
}

/**
 * `DocumentoFiscale` non ha colonna sede (P.IVA unica: il documento è
 * dell'entità legale). Si scopa via relazione: la pratica che l'ha generato,
 * oppure il wallet del payout per i documenti broker aggregati. I documenti
 * con nessuno dei due agganci restano visibili al solo owner aggregato.
 */
export function whereDocumentoFiscale(
  scope: SedeScope,
  args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' },
): Prisma.DocumentoFiscaleWhereInput {
  const base: Prisma.DocumentoFiscaleWhereInput =
    args.ruolo === 'AGENZIA'
      ? { destinatarioCompanyId: args.companyId }
      : { emittenteCompanyId: args.companyId };
  if (scope.aggregate) return base;
  const perPratica: Prisma.DocumentoFiscaleWhereInput =
    args.ruolo === 'AGENZIA'
      ? { pratica: { agenziaSedeId: { in: scope.scopeIds } } }
      : { pratica: { brokerSedeId: { in: scope.scopeIds } } };
  return {
    AND: [base, { OR: [perPratica, { payout: { wallet: { sedeId: { in: scope.scopeIds } } } }] }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/piattaforma && npx vitest run src/lib/sedi/scope-filters.test.ts`
Expected: PASS (tutti i blocchi `describe` verdi).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/sedi/scope-filters.ts apps/piattaforma/src/lib/sedi/scope-filters.test.ts
git commit -m "feat(sedi): predicati Prisma puri per lo scoping sede"
```

---

### Task 3: badge navigazione (`/api/badges`)

Questo è il sintomo segnalato: "il numerino mostra le pratiche dell'altra sede, poi entri ed è vuoto". La route oggi non chiama nemmeno `getSessionContext`.

**Files:**
- Modify: `apps/piattaforma/src/app/api/badges/route.ts`
- Test: `apps/piattaforma/src/app/api/badges/route.test.ts` (nuovo)

**Interfaces:**
- Consumes: `toSedeScope`, `wherePraticaAttiva`, `whereAssegnazionePending` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// apps/piattaforma/src/app/api/badges/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    pratica: { count: vi.fn(() => Promise.resolve(0)) },
    praticaAssegnazione: { count: vi.fn(() => Promise.resolve(0)) },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pratica.count.mockResolvedValue(0);
  prismaMock.praticaAssegnazione.count.mockResolvedValue(0);
});

describe('GET /api/badges — scoping sede', () => {
  it("l'agenzia non-owner conta solo le pratiche della sua sede", async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATORE', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: false,
      scopeIds: ['sedeAssago'],
      currentSede: { kind: 'ONE', sede: { id: 'sedeAssago' } },
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    expect(prismaMock.pratica.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ agenziaSedeId: { in: ['sedeAssago'] } }),
    });
    expect(prismaMock.praticaAssegnazione.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ sedeId: { in: ['sedeAssago'] } }),
    });
  });

  it("l'owner in vista aggregata conta tutta la madre", async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'ADMIN_AZIENDA', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: true,
      scopeIds: ['s1', 's2'],
      currentSede: { kind: 'ALL' },
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    const where = prismaMock.pratica.count.mock.calls[0][0].where;
    expect(where.agenziaSedeId).toBeUndefined();
    expect(where.agenziaAssegnataId).toBe('c1');
  });

  it('senza sedi accessibili non conta nulla (fail-closed)', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATORE', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: false,
      scopeIds: [],
      currentSede: null,
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    expect(prismaMock.pratica.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ agenziaSedeId: { in: [] } }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/piattaforma && npx vitest run src/app/api/badges/route.test.ts`
Expected: FAIL — la route chiama `count` con `agenziaAssegnataId` e nessun `agenziaSedeId`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/piattaforma/src/app/api/badges/route.ts
import { NextResponse } from 'next/server';
import { prisma, type PraticaStato } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import {
  toSedeScope,
  wherePraticaAttiva,
  whereAssegnazionePending,
} from '@/lib/sedi/scope-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stati esclusi dal conteggio "attive": terminali (FIRMATA/ANNULLATA/SCADUTA,
// nessuna azione attesa) + BOZZA (bozze non ancora inviate, non sono lavoro in
// corso). Resta attivo tutto il mezzo: in distribuzione, accettata, processata.
const STATI_ESCLUSI = ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as unknown as PraticaStato[];

/**
 * Conteggi per i badge di navigazione (polled dal client via NavBadge).
 * Multi-sede: i conteggi seguono le sedi in scope, ESATTAMENTE come le liste
 * che aprono. Un badge madre-wide su una lista sede-scopata produceva il
 * classico "numerino pieno, lista vuota".
 */
export async function GET(): Promise<Response> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let inbox = 0;
  let praticheAttive = 0;
  const companyId = ctx.companyId;
  const companyType = ctx.user.companyType as 'AGENZIA' | 'DEALER' | undefined;
  const scope = toSedeScope(ctx);

  if (companyId && companyType === 'AGENZIA') {
    inbox = await prisma.praticaAssegnazione.count({
      where: whereAssegnazionePending(scope, companyId),
    });
    praticheAttive = await prisma.pratica.count({
      where: {
        ...wherePraticaAttiva(scope, { companyId, ruolo: 'AGENZIA' }),
        stato: { notIn: STATI_ESCLUSI },
      },
    });
  } else if (companyId && companyType === 'DEALER') {
    praticheAttive = await prisma.pratica.count({
      where: {
        ...wherePraticaAttiva(scope, { companyId, ruolo: 'DEALER' }),
        stato: { notIn: STATI_ESCLUSI },
      },
    });
  }

  return NextResponse.json(
    { inbox, praticheAttive },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/piattaforma && npx vitest run src/app/api/badges/route.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/api/badges
git commit -m "fix(badge): conteggi inbox e pratiche attive per sede (stop numerino fantasma)"
```

---

### Task 4: `/addebiti`

**Files:**
- Modify: `apps/piattaforma/src/app/addebiti/page.tsx:45-49`

**Interfaces:**
- Consumes: `toSedeScope`, `whereFeeAddebito` (Task 2); invariante sede su `FeeAddebito` (Task 1).

- [ ] **Step 1: applicare il predicato**

```ts
// apps/piattaforma/src/app/addebiti/page.tsx
// (in cima al file, insieme agli altri import)
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, whereFeeAddebito } from '@/lib/sedi/scope-filters';

// ...dentro il componente, al posto di `const companyId = session.user.companyId!;`
const ctx = await getSessionContext();
if (!ctx?.companyId) redirect('/login');
const companyId = ctx.companyId;
const now = new Date();

const fees = await prisma.feeAddebito.findMany({
  // Multi-sede: gli addebiti sono della sede che ha lavorato la pratica.
  where: whereFeeAddebito(toSedeScope(ctx), companyId),
  orderBy: { createdAt: 'desc' },
  include: {
    pratica: {
      select: {
        id: true,
        codicePratica: true,
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    },
  },
});
```

Verificare che `redirect` sia importato da `next/navigation`; se il file non lo usa già, aggiungerlo all'import esistente.

- [ ] **Step 2: typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/addebiti/page.tsx
git commit -m "fix(addebiti): mostra solo gli addebiti della sede in scope"
```

---

### Task 5: `/feedback`

**Files:**
- Modify: `apps/piattaforma/src/app/feedback/page.tsx:28-45`

- [ ] **Step 1: applicare il predicato a lista e media**

```ts
// apps/piattaforma/src/app/feedback/page.tsx
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, whereValutazione } from '@/lib/sedi/scope-filters';

// ...al posto di `const agenziaId = session.user.companyId!;`
const ctx = await getSessionContext();
if (!ctx?.companyId) redirect('/login');
// Multi-sede: i feedback sono della sede valutata, non di tutta la madre.
// La media va calcolata sullo stesso insieme della lista, altrimenti la
// pagina mostrerebbe "3 recensioni" e una media su 40.
const where = whereValutazione(toSedeScope(ctx), ctx.companyId);

const [valutazioni, agg] = await Promise.all([
  prisma.valutazione.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      dealer: { select: { ragioneSociale: true } },
      pratica: { select: { id: true, codicePratica: true } },
    },
  }),
  prisma.valutazione.aggregate({
    where,
    _avg: { stelle: true },
    _count: { _all: true },
  }),
]);
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/feedback/page.tsx
git commit -m "fix(feedback): valutazioni e media della sola sede in scope"
```

---

### Task 6: fatturazione (lista, dettaglio, download)

Il punto delicato: la UI e le route di download devono usare **la stessa** regola, altrimenti un ADMIN_SEDE non vede la fattura in lista ma la scarica indovinando l'ID.

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/access.ts`
- Modify: `apps/piattaforma/src/lib/fatturazione/access.test.ts`
- Modify: `apps/piattaforma/src/app/fatturazione/page.tsx:110-112`
- Modify: `apps/piattaforma/src/app/fatturazione/[id]/page.tsx:80`
- Modify: `apps/piattaforma/src/app/api/fatturazione/[id]/pdf/route.ts`, `.../xml/route.ts`
- Modify: `apps/piattaforma/src/app/api/fatturazione/zip/route.ts:47-57`

**Interfaces:**
- Consumes: `toSedeScope`, `whereDocumentoFiscale` (Task 2).
- Produces: `canViewDocumentoFiscale(doc, viewer)` con `doc` esteso a `{ praticaAgenziaSedeId, praticaBrokerSedeId, payoutWalletSedeId }` e `viewer` esteso a `{ scope: SedeScope }`.

- [ ] **Step 1: Write the failing test (access.ts sede-aware)**

Aggiungere in coda a `apps/piattaforma/src/lib/fatturazione/access.test.ts`:

```ts
import { canViewDocumentoFiscale } from './access';

const docSede = (over: Partial<Parameters<typeof canViewDocumentoFiscale>[0]> = {}) => ({
  emittenteCompanyId: null,
  destinatarioCompanyId: 'c1',
  praticaAgenziaSedeId: null,
  praticaBrokerSedeId: null,
  payoutWalletSedeId: null,
  ...over,
});

describe('canViewDocumentoFiscale — scoping sede', () => {
  const aggregate = { scopeIds: ['s1', 's2'], aggregate: true };
  const membro = { scopeIds: ['s2'], aggregate: false };

  it("l'owner aggregato vede anche i documenti senza pratica né payout", () => {
    expect(
      canViewDocumentoFiscale(docSede(), { companyId: 'c1', isAdminPiattaforma: false, scope: aggregate }),
    ).toBe(true);
  });

  it('il membro vede la fattura della pratica della sua sede', () => {
    expect(
      canViewDocumentoFiscale(docSede({ praticaAgenziaSedeId: 's2' }), {
        companyId: 'c1',
        isAdminPiattaforma: false,
        scope: membro,
      }),
    ).toBe(true);
  });

  it("il membro NON vede la fattura di un'altra sede della stessa madre", () => {
    expect(
      canViewDocumentoFiscale(docSede({ praticaAgenziaSedeId: 's1' }), {
        companyId: 'c1',
        isAdminPiattaforma: false,
        scope: membro,
      }),
    ).toBe(false);
  });

  it('il membro vede il documento del payout del suo wallet sede', () => {
    expect(
      canViewDocumentoFiscale(docSede({ payoutWalletSedeId: 's2' }), {
        companyId: 'c1',
        isAdminPiattaforma: false,
        scope: membro,
      }),
    ).toBe(true);
  });

  it('il membro NON vede i documenti senza aggancio a sede', () => {
    expect(
      canViewDocumentoFiscale(docSede(), { companyId: 'c1', isAdminPiattaforma: false, scope: membro }),
    ).toBe(false);
  });

  it("l'admin piattaforma vede tutto, a prescindere dallo scope", () => {
    expect(
      canViewDocumentoFiscale(docSede(), { companyId: null, isAdminPiattaforma: true, scope: membro }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/piattaforma && npx vitest run src/lib/fatturazione/access.test.ts`
Expected: FAIL — `canViewDocumentoFiscale` non accetta `scope` e ignora le sedi.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/piattaforma/src/lib/fatturazione/access.ts
import type { SedeScope } from '@/lib/sedi/scope-filters';

/**
 * Chi può vedere un documento fiscale.
 *
 * Company: emittente o destinatario. Sede: il documento appartiene alla sede
 * che ha generato la pratica, oppure al wallet del payout. I documenti senza
 * nessuno dei due agganci (es. note di variazione slegate) sono visibili solo
 * al proprietario in vista aggregata: nessuna sede può rivendicarli.
 */
export function canViewDocumentoFiscale(
  doc: {
    emittenteCompanyId: string | null;
    destinatarioCompanyId: string | null;
    praticaAgenziaSedeId?: string | null;
    praticaBrokerSedeId?: string | null;
    payoutWalletSedeId?: string | null;
  },
  viewer: {
    companyId: string | null | undefined;
    isAdminPiattaforma: boolean;
    scope: SedeScope;
  },
): boolean {
  if (viewer.isAdminPiattaforma) return true;
  const cid = viewer.companyId;
  if (!cid) return false;

  const inCompany = doc.emittenteCompanyId === cid || doc.destinatarioCompanyId === cid;
  if (!inCompany) return false;
  if (viewer.scope.aggregate) return true;

  const sedi = viewer.scope.scopeIds;
  return (
    (doc.praticaAgenziaSedeId != null && sedi.includes(doc.praticaAgenziaSedeId)) ||
    (doc.praticaBrokerSedeId != null && sedi.includes(doc.praticaBrokerSedeId)) ||
    (doc.payoutWalletSedeId != null && sedi.includes(doc.payoutWalletSedeId))
  );
}
```

Aggiornare i test preesistenti in `access.test.ts` passando `scope: { scopeIds: [], aggregate: true }` dove prima non c'era scope (il comportamento company-level è quello dell'owner aggregato).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/piattaforma && npx vitest run src/lib/fatturazione/access.test.ts`
Expected: PASS (vecchi + 6 nuovi).

- [ ] **Step 5: applicare lo scope alla lista fatture**

```ts
// apps/piattaforma/src/app/fatturazione/page.tsx — sostituire il blocco `scope`
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, whereDocumentoFiscale } from '@/lib/sedi/scope-filters';

const ctx = await getSessionContext();
if (!ctx?.companyId) redirect('/login');

const scope = whereDocumentoFiscale(toSedeScope(ctx), {
  companyId: ctx.companyId,
  ruolo: tipo, // 'AGENZIA' | 'DEALER', già validato sopra
});
// NON usare `{ ...scope, ...fatturaWhereFiltri(filtri) }`: entrambi possono
// restituire una chiave `AND`, e lo spread la sovrascriverebbe silenziosamente
// (i filtri utente cancellerebbero lo scope sede ⇒ leak). Combinare in AND.
const where: Prisma.DocumentoFiscaleWhereInput = { AND: [scope, fatturaWhereFiltri(filtri)] };
```

Inoltre il selettore sede della `FiltriBar` va limitato alle sedi accessibili:

```ts
const sedi = await prisma.sede.findMany({
  where: {
    companyId: ctx.companyId,
    deletedAt: null,
    ...(toSedeScope(ctx).aggregate ? {} : { id: { in: ctx.scopeIds } }),
  },
  select: { id: true, nome: true, citta: true },
  orderBy: { createdAt: 'asc' },
});
```

- [ ] **Step 6: dettaglio + route di download**

In `fatturazione/[id]/page.tsx` e nelle tre route API, il documento va caricato **includendo** i campi sede, e passato al nuovo `canViewDocumentoFiscale`:

```ts
const doc = await prisma.documentoFiscale.findUnique({
  where: { id },
  select: {
    // ...campi già selezionati dalla pagina/route, invariati
    emittenteCompanyId: true,
    destinatarioCompanyId: true,
    pratica: { select: { agenziaSedeId: true, brokerSedeId: true } },
    payout: { select: { wallet: { select: { sedeId: true } } } },
  },
});
if (!doc) notFound();

const ctx = await getSessionContext();
const allowed = canViewDocumentoFiscale(
  {
    emittenteCompanyId: doc.emittenteCompanyId,
    destinatarioCompanyId: doc.destinatarioCompanyId,
    praticaAgenziaSedeId: doc.pratica?.agenziaSedeId ?? null,
    praticaBrokerSedeId: doc.pratica?.brokerSedeId ?? null,
    payoutWalletSedeId: doc.payout?.wallet?.sedeId ?? null,
  },
  {
    companyId: ctx?.companyId ?? null,
    isAdminPiattaforma: ctx?.user.role === 'ADMIN_PIATTAFORMA',
    scope: ctx ? toSedeScope(ctx) : { scopeIds: [], aggregate: false },
  },
);
if (!allowed) notFound(); // nelle route API: 403
```

Per `api/fatturazione/zip/route.ts:47-57`, sostituire la costruzione di `scope` con `whereDocumentoFiscale(toSedeScope(ctx), { companyId, ruolo: companyType })`.

- [ ] **Step 6b: terzo chiamante — `pratiche/[id]/page.tsx:107`**

`pratiche/[id]/page.tsx` filtra `pratica.documentiFiscali` con `canViewDocumentoFiscale`. Quelle righe **non** hanno le relazioni `pratica`/`payout` caricate: se passate così al nuovo predicato, tutti i campi sede risultano `undefined` e per ogni non-owner le fatture della pratica **sparirebbero** dal dettaglio.

La pagina è già scopata per `scopeIds` (la pratica è visibile solo se in scope), quindi la sede del documento è quella della pratica. Passarla esplicitamente:

```ts
// apps/piattaforma/src/app/pratiche/[id]/page.tsx:107
const scope = toSedeScope(ctx); // ctx = await getSessionContext(), già presente nel file
const fattureVisibili = pratica.documentiFiscali.filter((d) =>
  canViewDocumentoFiscale(
    {
      emittenteCompanyId: d.emittenteCompanyId,
      destinatarioCompanyId: d.destinatarioCompanyId,
      // La pratica è già in scope sede: i suoi documenti ereditano la sua sede.
      praticaAgenziaSedeId: pratica.agenziaSedeId,
      praticaBrokerSedeId: pratica.brokerSedeId,
      payoutWalletSedeId: null,
    },
    {
      companyId,
      isAdminPiattaforma: session.user.role === 'ADMIN_PIATTAFORMA',
      scope,
    },
  ),
);
```

Verificare che `pratica.agenziaSedeId` e `pratica.brokerSedeId` siano nel `select`/`include` della pratica (la pagina già include `agenziaSede`); se assenti, aggiungerli.

- [ ] **Step 7: suite + typecheck**

Run: `pnpm --filter piattaforma typecheck && cd apps/piattaforma && npx vitest run`
Expected: typecheck 0 errori; suite verde.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione apps/piattaforma/src/app/fatturazione apps/piattaforma/src/app/api/fatturazione
git commit -m "fix(fatturazione): fatture della propria sede (lista, dettaglio, pdf/xml/zip)"
```

---

### Task 7: `/affiliazione`

Regola scelta: **la sede vede il proprio link e i propri referral**; totali di gruppo, classifica sedi e rendimento del wallet madre restano al **solo owner**.

**Files:**
- Modify: `apps/piattaforma/src/app/affiliazione/page.tsx:44-165`

**Interfaces:**
- Consumes: `getSessionContext`, `toSedeScope`.
- Attribuzione già presente in DB: `Company.referenteSedeId`, `CommissioneAffiliazione.referenteSedeId`, `ReferralClick.sedeId`.

- [ ] **Step 1: derivare lo scope e filtrare le query**

```ts
// apps/piattaforma/src/app/affiliazione/page.tsx
const ctx = await getSessionContext();
if (!ctx?.companyId) redirect('/login');
const companyId = ctx.companyId;
const scope = toSedeScope(ctx);
const operatingSede = await getOperatingSede();

// Multi-sede: chi non è proprietario in vista aggregata vede SOLO ciò che ha
// affiliato la propria sede. `referenteSedeId`/`sedeId` sono già valorizzati
// alla registrazione del referral e all'accredito della commissione.
const filtroSede = scope.aggregate ? {} : { referenteSedeId: { in: scope.scopeIds } };
const filtroClick = scope.aggregate ? {} : { sedeId: { in: scope.scopeIds } };

const [company, affWallet, sedeRow, referrals, commissioni, clickCount, mieCommissioni] =
  await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, ragioneSociale: true, referralCode: true },
    }),
    // Il wallet affiliazione è della madre: il rendimento resta all'owner.
    scope.aggregate
      ? prisma.wallet.findUnique({ where: { companyId }, select: { id: true } })
      : Promise.resolve(null),
    operatingSede
      ? prisma.sede.findUnique({ where: { id: operatingSede.id }, select: { referralCode: true } })
      : Promise.resolve(null),
    prisma.company.findMany({
      where: { referenteId: companyId, deletedAt: null, ...filtroSede },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ragioneSociale: true,
        type: true,
        citta: true,
        provincia: true,
        suspendedAt: true,
        createdAt: true,
      },
    }),
    prisma.commissioneAffiliazione.aggregate({
      where: { referenteId: companyId, stato: 'ACCREDITATA', ...filtroSede },
      _sum: { importoNettoCent: true },
      _count: { _all: true },
    }),
    prisma.referralClick.count({ where: { companyId, ...filtroClick } }),
    prisma.commissioneAffiliazione.findMany({
      where: { referenteId: companyId, ...filtroSede },
      select: {
        stato: true,
        importoNettoCent: true,
        pratica: { select: { brokerId: true, agenziaAssegnataId: true } },
      },
    }),
  ]);
```

- [ ] **Step 2: rendere owner-only rendimento e classifica sedi**

```ts
// Rendimento del wallet affiliazione (madre): solo owner aggregato.
const earningsRendimento = affWallet
  ? await getRendimento(affWallet.id, '12m', ['CREDITO_AFFILIAZIONE'])
  : null;

// Classifica "chi affilia di più": confronto tra sedi ⇒ ha senso solo per chi
// le vede tutte. Per un ADMIN_SEDE sarebbe una finestra sui numeri dei colleghi.
const sediMadre = scope.aggregate
  ? await prisma.sede.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, nome: true, referralCode: true },
      orderBy: { createdAt: 'asc' },
    })
  : [];
const [clicksBySede, commBySede] = scope.aggregate
  ? await Promise.all([
      prisma.referralClick.groupBy({
        by: ['sedeId'],
        where: { companyId, sedeId: { not: null } },
        _count: { _all: true },
      }),
      prisma.commissioneAffiliazione.groupBy({
        by: ['referenteSedeId'],
        where: { referenteId: companyId, stato: 'ACCREDITATA' },
        _sum: { importoNettoCent: true },
        _count: { _all: true },
      }),
    ])
  : [[], []];
```

Nel JSX: rendere condizionali il blocco rendimento (`earningsRendimento && ...`) e il blocco classifica (`scope.aggregate && ...`). Il link/QR della sede operativa resta **sempre** visibile: è il proprio strumento di lavoro.

- [ ] **Step 3: typecheck + suite**

Run: `pnpm --filter piattaforma typecheck && cd apps/piattaforma && npx vitest run`
Expected: typecheck 0 errori; suite verde.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/affiliazione/page.tsx
git commit -m "fix(affiliazione): la sede vede il proprio link e i propri referral; aggregato all'owner"
```

---

### Task 8: autorizzazione download pratiche per sede

`/pratiche/[id]` è già scopato per `scopeIds`, ma le route di download autorizzano ancora per `companyId`: un ADMIN_SEDE può scaricare i documenti della pratica di un'altra sede conoscendone l'ID.

**Files:**
- Modify: `apps/piattaforma/src/app/api/pratiche/[id]/pdf/route.ts:47-56`
- Modify: `apps/piattaforma/src/app/api/pratiche/[id]/zip/route.ts` (stesso blocco `allowed`)
- Modify: `apps/piattaforma/src/app/api/documenti/[id]/route.ts:42-54`

- [ ] **Step 1: `api/pratiche/[id]/pdf` — includere le sedi e restringere**

Nel `select` della pratica aggiungere `brokerSedeId: true, agenziaSedeId: true`, poi:

```ts
const ctx = await getSessionContext();
const isAdmin = ctx?.user.role === 'ADMIN_PIATTAFORMA';
const userCompanyId = ctx?.companyId;
const scope = ctx ? toSedeScope(ctx) : { scopeIds: [], aggregate: false };

// Multi-sede: la company non basta — un ADMIN_SEDE non scarica i documenti
// di un'altra filiale. L'owner aggregato mantiene l'accesso a tutto il gruppo.
const inSede = (sedeId: string | null): boolean =>
  scope.aggregate || (sedeId != null && scope.scopeIds.includes(sedeId));

const allowed =
  isAdmin ||
  (pratica.brokerId === userCompanyId && inSede(pratica.brokerSedeId)) ||
  (pratica.agenziaAssegnataId === userCompanyId && inSede(pratica.agenziaSedeId));

if (!allowed) {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
```

- [ ] **Step 2: `api/documenti/[id]` — stesso trattamento**

Nel `select` di `doc.pratica` aggiungere `brokerSedeId: true, agenziaSedeId: true`, poi:

```ts
const allowed =
  isAdmin ||
  // documento caricato dalla company stessa (non legato a pratica)
  (doc.companyId != null && doc.companyId === userCompanyId && !doc.praticaId) ||
  (doc.pratica?.brokerId === userCompanyId && inSede(doc.pratica.brokerSedeId)) ||
  (doc.pratica?.agenziaAssegnataId === userCompanyId && inSede(doc.pratica.agenziaSedeId));
```

- [ ] **Step 3: ripetere su `api/pratiche/[id]/zip` e `api/pratiche/documenti-zip`**

Applicare la stessa `inSede` al blocco `allowed` / al `where` della query.

- [ ] **Step 4: typecheck + suite**

Run: `pnpm --filter piattaforma typecheck && cd apps/piattaforma && npx vitest run`
Expected: typecheck 0 errori; suite verde.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/api/pratiche apps/piattaforma/src/app/api/documenti
git commit -m "fix(download): autorizzazione per sede su pdf/zip pratiche e documenti"
```

---

### Task 9: verifica end-to-end e rilascio

**Files:** nessuno (solo verifica).

- [ ] **Step 1: suite completa + typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && cd apps/piattaforma && npx vitest run`
Expected: 3 comandi verdi.

- [ ] **Step 2: verifica su DB locale con dati multi-sede**

Avviare Docker + `pnpm --filter @pv/db db:deploy && pnpm --filter @pv/db db:seed`, quindi creare (o seedare) un'agenzia con 2 sedi e 2 utenti, uno per sede. Loggarsi con l'utente della sede B e controllare, una per una:

| Sezione | Atteso |
|---|---|
| Badge sidebar | conteggio = numero di righe nella lista che apre |
| `/addebiti` | solo addebiti di pratiche della sede B |
| `/feedback` | recensioni e media della sola sede B |
| `/fatturazione` | solo fatture di pratiche della sede B |
| `/affiliazione` | link della sede B, referral portati dalla sede B, nessuna classifica |
| `/api/fatturazione/<id-fattura-sede-A>/pdf` | **403** |
| `/api/pratiche/<id-pratica-sede-A>/pdf` | **403** |

Poi rientrare come owner in vista `ALL`: tutte le sezioni devono mostrare **tutto il gruppo**, esattamente come prima della modifica (nessuna regressione).

- [ ] **Step 3: applicare il backfill in produzione**

```bash
# DIRECT_URL = endpoint Neon SENZA -pooler (Prisma migrate usa advisory lock)
cd packages/db && npx prisma migrate status --schema prisma/schema.prisma   # solo il backfill pendente
npx prisma migrate deploy --schema prisma/schema.prisma
```

Controllo post-migration: `SELECT COUNT(*) FROM fee_addebiti WHERE "agenziaSedeId" IS NULL;` deve tornare 0 (salvo fee di pratiche senza sede, che non esistono dopo `multi_sede_expand`).

- [ ] **Step 4: push e verifica deploy**

```bash
git push origin main
```

Attendere `state: READY` sul deployment, poi ricontrollare `get_runtime_errors` a 15 minuti dal rilascio.

- [ ] **Step 5: aggiornare la memoria di progetto**

Aggiungere a `project_multisede_revisione_2026_07.md` che lo scoping delle sezioni dati è stato completato e che `lib/sedi/scope-filters.ts` è **la fonte unica** dei filtri sede: ogni nuova pagina operativa deve usarla, mai `session.user.companyId` nudo.
