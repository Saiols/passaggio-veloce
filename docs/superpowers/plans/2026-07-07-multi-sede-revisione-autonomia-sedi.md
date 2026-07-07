# Revisione Multi-Sede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere ogni sede un'unità autonoma (admin di sede che gestisce team, impostazioni, IBAN/payout della propria sede) e far arrivare la pratica a *tutte* le sedi in zona (prima che accetta vince), correggendo i due disallineamenti del multi-sede in prod.

**Architecture:** Autorizzazione "sede-aware" senza nuovi ruoli di piattaforma: un helper puro `resolveSedeRole()` deriva il ruolo effettivo dell'utente su una sede (`OWNER` implicito per `ADMIN_AZIENDA`, altrimenti `UserSede.ruolo`); tutte le server action operative/di-gestione passano da questo helper. La distribuzione cambia il tracking da "per madre" a "per sede" e rimuove `dedupeByMadre`. Nessun cambio di schema Prisma, nessuna migrazione dati.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 5 + Postgres, Vitest, pnpm/Turborepo, TypeScript.

## Global Constraints

- **Nessun cambio schema Prisma e nessuna migrazione dati.** Solo logica (autorizzazione + distribuzione). `UserSede.ruolo` e le colonne sede esistono già.
- **Nessun nuovo `UserRole`.** Il livello "admin di sede" resta espresso da `UserSede.ruolo` (`ADMIN_SEDE` | `OPERATORE`).
- **TDD**: per ogni unità di logica pura scrivere prima il test che fallisce.
- **Test runner**: `pnpm --filter piattaforma exec vitest run <path>` (singolo file); suite intera `pnpm --filter piattaforma test`.
- **Typecheck**: `pnpm --filter piattaforma typecheck`.
- **Commit** dopo ogni task verde. Si lavora **direttamente su `main`** (workflow deciso 2026-06-28). Commit message in italiano, prefisso `fix(multi-sede):` o `refactor(multi-sede):`.
- **Spec di riferimento**: `docs/superpowers/specs/2026-07-07-multi-sede-revisione-autonomia-sedi-design.md`.
- **Verità sede corrente**: cookie `pv_sede` risolto server-side via `getSessionContext()` (`apps/piattaforma/src/lib/auth/session-context.ts`). Mai fidarsi del solo `companyId`.

---

## Task 1: Core autorizzazione sede-aware (`resolveSedeRole` + helper + session-context)

Fondamenta usate da tutti i task successivi: le funzioni pure di scoping ruolo e l'esposizione della `ruolo` per sede nel contesto di sessione.

**Files:**
- Modify: `apps/piattaforma/src/lib/sedi/scope.ts` (aggiunge tipi + helper puri)
- Test: `apps/piattaforma/src/lib/sedi/scope.test.ts` (aggiunge describe block)
- Modify: `apps/piattaforma/src/lib/auth/session-context.ts` (espone `membershipRuoli` + `getSedeRole` + `getManageableSedi`)

**Interfaces:**
- Produces (scope.ts):
  - `type SedeRuolo = 'ADMIN_SEDE' | 'OPERATORE'`
  - `type SedeRole = 'OWNER' | 'ADMIN_SEDE' | 'OPERATORE' | null`
  - `resolveSedeRole(args: { isOwner: boolean; accessibleSedi: SedeRef[]; membershipRuoli: Record<string, SedeRuolo>; sedeId: string }): SedeRole`
  - `canManageSedeTeam(role: SedeRole): boolean`
  - `canEditSedeSettings(role: SedeRole): boolean`
  - `assignableSedeRoles(role: SedeRole): SedeRuolo[]`
  - `manageableSedi(args: { isOwner: boolean; accessibleSedi: SedeRef[]; membershipRuoli: Record<string, SedeRuolo> }): SedeRef[]`
  - `resolveTeamTargetSede(args: { requestedSedeId?: string; manageable: SedeRef[] }): { ok: true; sedeId: string } | { ok: false; error: string }`
- Produces (session-context.ts):
  - `SessionContext.membershipRuoli: Record<string, SedeRuolo>`
  - `getSedeRole(sedeId: string): Promise<SedeRole>`
  - `getManageableSedi(): Promise<SedeRef[]>`

- [ ] **Step 1: Scrivi i test che falliscono (helper puri)**

Aggiungi in fondo a `apps/piattaforma/src/lib/sedi/scope.test.ts`:

```ts
import {
  resolveSedeRole,
  canManageSedeTeam,
  canEditSedeSettings,
  assignableSedeRoles,
  manageableSedi,
  resolveTeamTargetSede,
} from './scope';

const S = (id: string): { id: string; nome: string; type: 'AGENZIA' } => ({
  id,
  nome: id,
  type: 'AGENZIA',
});

describe('resolveSedeRole', () => {
  it('OWNER su qualunque sede accessibile della madre', () => {
    expect(
      resolveSedeRole({
        isOwner: true,
        accessibleSedi: [S('a'), S('b')],
        membershipRuoli: {},
        sedeId: 'b',
      }),
    ).toBe('OWNER');
  });

  it('OWNER → null se la sede non è tra le accessibili', () => {
    expect(
      resolveSedeRole({ isOwner: true, accessibleSedi: [S('a')], membershipRuoli: {}, sedeId: 'x' }),
    ).toBeNull();
  });

  it('non-owner: ritorna il ruolo di membership sulla sede', () => {
    expect(
      resolveSedeRole({
        isOwner: false,
        accessibleSedi: [S('a')],
        membershipRuoli: { a: 'ADMIN_SEDE' },
        sedeId: 'a',
      }),
    ).toBe('ADMIN_SEDE');
  });

  it('non-owner: default OPERATORE se accessibile ma senza ruolo esplicito', () => {
    expect(
      resolveSedeRole({ isOwner: false, accessibleSedi: [S('a')], membershipRuoli: {}, sedeId: 'a' }),
    ).toBe('OPERATORE');
  });

  it('non-owner: null se la sede non è accessibile', () => {
    expect(
      resolveSedeRole({
        isOwner: false,
        accessibleSedi: [S('a')],
        membershipRuoli: { b: 'ADMIN_SEDE' },
        sedeId: 'b',
      }),
    ).toBeNull();
  });
});

describe('canManageSedeTeam / canEditSedeSettings / assignableSedeRoles', () => {
  it('OWNER e ADMIN_SEDE possono gestire team e impostazioni', () => {
    for (const r of ['OWNER', 'ADMIN_SEDE'] as const) {
      expect(canManageSedeTeam(r)).toBe(true);
      expect(canEditSedeSettings(r)).toBe(true);
      expect(assignableSedeRoles(r)).toEqual(['ADMIN_SEDE', 'OPERATORE']);
    }
  });
  it('OPERATORE e null non possono', () => {
    for (const r of ['OPERATORE', null] as const) {
      expect(canManageSedeTeam(r)).toBe(false);
      expect(canEditSedeSettings(r)).toBe(false);
      expect(assignableSedeRoles(r)).toEqual([]);
    }
  });
});

describe('manageableSedi', () => {
  it('OWNER: tutte le sedi accessibili', () => {
    expect(
      manageableSedi({ isOwner: true, accessibleSedi: [S('a'), S('b')], membershipRuoli: {} }).map((s) => s.id),
    ).toEqual(['a', 'b']);
  });
  it('non-owner: solo le sedi dove è ADMIN_SEDE', () => {
    expect(
      manageableSedi({
        isOwner: false,
        accessibleSedi: [S('a'), S('b'), S('c')],
        membershipRuoli: { a: 'ADMIN_SEDE', b: 'OPERATORE' },
      }).map((s) => s.id),
    ).toEqual(['a']);
  });
});

describe('resolveTeamTargetSede', () => {
  it('id richiesto valido → quello', () => {
    expect(resolveTeamTargetSede({ requestedSedeId: 'a', manageable: [S('a'), S('b')] })).toEqual({
      ok: true,
      sedeId: 'a',
    });
  });
  it('id richiesto non gestibile → errore', () => {
    expect(resolveTeamTargetSede({ requestedSedeId: 'z', manageable: [S('a')] }).ok).toBe(false);
  });
  it('nessun id + una sola gestibile → default', () => {
    expect(resolveTeamTargetSede({ manageable: [S('a')] })).toEqual({ ok: true, sedeId: 'a' });
  });
  it('nessun id + più gestibili → errore (serve scelta)', () => {
    expect(resolveTeamTargetSede({ manageable: [S('a'), S('b')] }).ok).toBe(false);
  });
  it('nessuna gestibile → errore', () => {
    expect(resolveTeamTargetSede({ manageable: [] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui i test per verificarne il fallimento**

Run: `pnpm --filter piattaforma exec vitest run src/lib/sedi/scope.test.ts`
Expected: FAIL (import di funzioni non ancora esportate da `./scope`).

- [ ] **Step 3: Implementa gli helper puri in `scope.ts`**

Aggiungi in fondo a `apps/piattaforma/src/lib/sedi/scope.ts`:

```ts
export type SedeRuolo = 'ADMIN_SEDE' | 'OPERATORE';
export type SedeRole = 'OWNER' | 'ADMIN_SEDE' | 'OPERATORE' | null;

/**
 * Ruolo effettivo dell'utente su una sede specifica.
 * - OWNER: proprietario madre (accesso implicito a tutte le sue sedi);
 * - altrimenti il ruolo della membership (default OPERATORE se accessibile ma
 *   senza ruolo esplicito);
 * - null se la sede non è accessibile all'utente.
 */
export function resolveSedeRole(args: {
  isOwner: boolean;
  accessibleSedi: SedeRef[];
  membershipRuoli: Record<string, SedeRuolo>;
  sedeId: string;
}): SedeRole {
  const { isOwner, accessibleSedi, membershipRuoli, sedeId } = args;
  const accessible = accessibleSedi.some((s) => s.id === sedeId);
  if (isOwner) return accessible ? 'OWNER' : null;
  if (!accessible) return null;
  return membershipRuoli[sedeId] ?? 'OPERATORE';
}

export function canManageSedeTeam(role: SedeRole): boolean {
  return role === 'OWNER' || role === 'ADMIN_SEDE';
}

export function canEditSedeSettings(role: SedeRole): boolean {
  return role === 'OWNER' || role === 'ADMIN_SEDE';
}

export function assignableSedeRoles(role: SedeRole): SedeRuolo[] {
  return canManageSedeTeam(role) ? ['ADMIN_SEDE', 'OPERATORE'] : [];
}

/** Sedi su cui l'utente può gestire team/impostazioni (OWNER o ADMIN_SEDE). */
export function manageableSedi(args: {
  isOwner: boolean;
  accessibleSedi: SedeRef[];
  membershipRuoli: Record<string, SedeRuolo>;
}): SedeRef[] {
  if (args.isOwner) return args.accessibleSedi;
  return args.accessibleSedi.filter((s) => args.membershipRuoli[s.id] === 'ADMIN_SEDE');
}

/**
 * Sede destinataria di un'operazione team: id richiesto (se gestibile) oppure,
 * in assenza, la sede gestibile unica. Errore se serve una scelta esplicita.
 */
export function resolveTeamTargetSede(args: {
  requestedSedeId?: string;
  manageable: SedeRef[];
}): { ok: true; sedeId: string } | { ok: false; error: string } {
  const { requestedSedeId, manageable } = args;
  if (requestedSedeId) {
    return manageable.some((s) => s.id === requestedSedeId)
      ? { ok: true, sedeId: requestedSedeId }
      : { ok: false, error: 'Sede non gestibile' };
  }
  if (manageable.length === 1) return { ok: true, sedeId: manageable[0].id };
  if (manageable.length === 0) return { ok: false, error: 'Nessuna sede gestibile' };
  return { ok: false, error: 'Specifica una sede per il nuovo utente' };
}
```

- [ ] **Step 4: Esegui i test per verificarne il successo**

Run: `pnpm --filter piattaforma exec vitest run src/lib/sedi/scope.test.ts`
Expected: PASS (tutti i nuovi describe verdi).

- [ ] **Step 5: Esponi `membershipRuoli` + `getSedeRole` + `getManageableSedi` nel session-context**

In `apps/piattaforma/src/lib/auth/session-context.ts`:

(a) estendi gli import da `./scope` (aggiungi `resolveSedeRole`, `manageableSedi`, `SedeRole`, `SedeRuolo`):

```ts
import {
  resolveAccessibleSedi,
  resolveCurrentSede,
  resolveOperatingSede,
  resolveSedeRole,
  manageableSedi,
  sedeScopeIds,
  type SedeRef,
  type CurrentSede,
  type SedeRole,
  type SedeRuolo,
} from '@/lib/sedi/scope';
```

(b) aggiungi il campo al tipo `SessionContext`:

```ts
export type SessionContext = {
  user: SessionUser;
  companyId: string | undefined;
  isOwner: boolean;
  accessibleSedi: SedeRef[];
  currentSede: CurrentSede | null;
  scopeIds: string[];
  /** Ruolo per sede dell'utente (solo membership non-owner). */
  membershipRuoli: Record<string, SedeRuolo>;
};
```

(c) nel ramo `!companyId` aggiungi `membershipRuoli: {}` all'oggetto ritornato.

(d) cambia la query memberships per includere `ruolo` e costruisci la mappa:

```ts
    prisma.userSede.findMany({
      where: { userId: user.id, sede: { companyId, deletedAt: null } },
      select: { sedeId: true, ruolo: true },
    }),
```

Dopo aver calcolato `accessibleSedi`, prima del `return` finale:

```ts
  const membershipRuoli: Record<string, SedeRuolo> = {};
  for (const m of memberships) membershipRuoli[m.sedeId] = m.ruolo as SedeRuolo;
```

e aggiungi `membershipRuoli` all'oggetto ritornato finale.

(e) aggiungi in fondo al file i due helper server:

```ts
/** Ruolo effettivo dell'utente su una sede specifica (OWNER/ADMIN_SEDE/OPERATORE/null). */
export async function getSedeRole(sedeId: string): Promise<SedeRole> {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  return resolveSedeRole({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
    sedeId,
  });
}

/** Sedi su cui l'utente può gestire team/impostazioni (OWNER o ADMIN_SEDE). */
export async function getManageableSedi(): Promise<SedeRef[]> {
  const ctx = await getSessionContext();
  if (!ctx) return [];
  return manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/sedi/scope.ts apps/piattaforma/src/lib/sedi/scope.test.ts apps/piattaforma/src/lib/auth/session-context.ts
git commit -m "feat(multi-sede): core autorizzazione sede-aware (resolveSedeRole + helper + getSedeRole)"
```

---

## Task 2: Distribuzione per sede (tracking per sede, rimozione `dedupeByMadre`)

La pratica raggiunge tutte le sedi in zona (più filiali dello stesso gruppo sono candidati indipendenti); prima che accetta vince. Round/ranking/cap/countdown/escalation invariati.

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/index.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.test.ts`
- Delete: `apps/piattaforma/src/lib/distribuzione/dedupe.ts`, `apps/piattaforma/src/lib/distribuzione/dedupe.test.ts`

**Interfaces:**
- Consumes: `avviaRound`, `avviaRound1ForPratica`, `tickPratica` (già esistenti in `index.ts`).
- Produces: comportamento distribuzione invariato nelle firme; cambia solo la selezione candidati (per sede).

- [ ] **Step 1: Riscrivi il test di `avviaRound1ForPratica` per attendersi TUTTE le sedi**

Sostituisci il blocco `describe('avviaRound1ForPratica (multi-sede)', ...)` in `apps/piattaforma/src/lib/distribuzione/tick.test.ts` (righe ~53-75) con:

```ts
describe('avviaRound1ForPratica (multi-sede: tutte le sedi in zona)', () => {
  it('seleziona SEDI agenzia attive per provincia (non Company)', async () => {
    await avviaRound1ForPratica('p1');
    expect(tx.sede.findMany).toHaveBeenCalledTimes(1);
    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('AGENZIA');
    expect(where.suspendedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it('contatta OGNI sede in zona, anche più sedi della stessa madre', async () => {
    await avviaRound1ForPratica('p1');
    const pairs = tx.praticaAssegnazione.create.mock.calls.map((c) => ({
      agenziaId: c[0].data.agenziaId,
      sedeId: c[0].data.sedeId,
    }));
    expect(pairs).toHaveLength(3); // s1, s2 (stessa madre m1), s3 — nessun dedup
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's1' });
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's2' });
    expect(pairs).toContainEqual({ agenziaId: 'm2', sedeId: 's3' });
  });
});
```

- [ ] **Step 2: Esegui il test per verificarne il fallimento**

Run: `pnpm --filter piattaforma exec vitest run src/lib/distribuzione/tick.test.ts`
Expected: FAIL (oggi `dedupeByMadre` produce 2 assegnazioni, il test ne attende 3).

- [ ] **Step 3: Traccia per sede e rimuovi il dedup in `avviaRound`**

In `apps/piattaforma/src/lib/distribuzione/index.ts`:

(a) rimuovi l'import: elimina la riga `import { dedupeByMadre } from './dedupe';`.

(b) cambia la firma di `avviaRound` (il parametro `assegnazioni`) da `{ agenziaId: string }[]` a `{ sedeId: string | null }[]`:

```ts
async function avviaRound(
  tx: Prisma.TransactionClient,
  pratica: {
    id: string;
    provincia: string | null;
    assegnazioni: { sedeId: string | null }[];
  },
  round: 1 | 2 | 3,
): Promise<{ count: number; newAssegnazioniIds: string[]; escalated: boolean }> {
```

(c) sostituisci il calcolo `giaContattate` (traccia le SEDI già contattate, non le madri):

```ts
  const now = new Date();
  const provincia = (pratica.provincia ?? '').toUpperCase();
  const sediContattate = new Set(
    pratica.assegnazioni.map((a) => a.sedeId).filter((x): x is string => x != null),
  );
```

(d) nella query `tx.sede.findMany`, sostituisci l'esclusione per madre con l'esclusione per sede:

```ts
  const rawSedi = await tx.sede.findMany({
    where: {
      type: 'AGENZIA',
      deletedAt: null,
      suspendedAt: null,
      provincia: { in: provincieTarget as string[] },
      id: { notIn: Array.from(sediContattate) },
      company: { deletedAt: null, suspendedAt: null, bloccoPagamentoAt: null },
    },
    select: { id: true, createdAt: true, nome: true, provincia: true, companyId: true },
  });
```

(e) aggiorna `maxPerRound` (round 3 usa il conteggio delle sedi già contattate):

```ts
  const maxPerRound =
    round === 3
      ? Math.max(0, DISTRIBUZIONE.N_MAX - sediContattate.size)
      : DISTRIBUZIONE.N_PER_ROUND;
```

(f) rimuovi la riga `dedupeByMadre` e prendi direttamente i candidati ordinati per ranking:

```ts
  // Tutte le sedi idonee competono in modo indipendente (prima che accetta vince).
  const candidate = eligible.slice(0, maxPerRound);
```

(g) in `avviaRound1ForPratica`, cambia il `select` dell'include assegnazioni da `agenziaId` a `sedeId`:

```ts
      include: { assegnazioni: { select: { sedeId: true } } },
```

(Nota: `tickPratica` include già le assegnazioni complete — `a.sedeId` è disponibile, nessun cambio di select lì. La `create` continua a scrivere `agenziaId: a.companyId` (colonna legacy NOT NULL) + `sedeId: a.id`.)

- [ ] **Step 4: Elimina i file del dedup**

```bash
git rm apps/piattaforma/src/lib/distribuzione/dedupe.ts apps/piattaforma/src/lib/distribuzione/dedupe.test.ts
```

- [ ] **Step 5: Verifica che nessun altro file importi `dedupe`/`dedupeByMadre`**

Run: `pnpm --filter piattaforma exec vitest run src/lib/distribuzione` e in più cerca riferimenti residui.
Grep atteso vuoto: cerca `dedupeByMadre` e `from './dedupe'` in `apps/piattaforma/src` → nessun match.

- [ ] **Step 6: Esegui i test distribuzione + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/distribuzione/tick.test.ts`
Expected: PASS (3 assegnazioni).
Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/
git commit -m "fix(multi-sede): distribuzione a tutte le sedi in zona (tracking per sede, rimosso dedupeByMadre)"
```

---

## Task 3: Autorizzazione team sede-aware (server actions)

Apre le azioni team all'`ADMIN_SEDE` sulla propria sede, mantenendo il superadmin onnipotente. Sostituisce il gate `role === 'ADMIN_AZIENDA'`.

**Files:**
- Modify: `apps/piattaforma/src/app/team/actions.ts`
- Test: `apps/piattaforma/src/app/team/actions.authz.test.ts` (nuovo)

**Interfaces:**
- Consumes: `getSessionContext`, `getManageableSedi` (Task 1); `manageableSedi`, `resolveSedeRole`, `resolveTeamTargetSede`, `assignableSedeRoles` (Task 1).
- Produces: helper interni `authorizeTeamCreate(requestedSedeId, requestedRuolo)` e `authorizeTeamTargetUser(userId)`; le action `createUserDirectAction`, `createInvitationAction`, `updateTeamUserAction`, `resetTeamUserPasswordAction`, `disableTeamUserAction`, `revokeInvitationAction` mantengono le stesse firme e tipi di ritorno.

- [ ] **Step 1: Scrivi il test di autorizzazione (mock sessione/prisma)**

Crea `apps/piattaforma/src/app/team/actions.authz.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn(() => Promise.resolve({ ragioneSociale: 'Acme' })) },
    userSede: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('@/auth', () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: 'u1' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/providers/email', () => ({ getEmail: () => ({ send: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(() => Promise.resolve('hash')) }));

import { createUserDirectAction } from './actions';

const sede = (id: string) => ({ id, nome: id, type: 'AGENZIA' as const });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue(null); // nessun duplicato email
});

describe('createUserDirectAction — autorizzazione sede-aware', () => {
  it('ADMIN_SEDE crea un OPERATORE nella propria sede', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'ADMIN_SEDE' },
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.userSede.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sedeId: 's1', ruolo: 'OPERATORE' }) }),
    );
  });

  it('OPERATORE non può creare account', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'OPERATORE' },
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('ADMIN_SEDE non può creare su una sede che non amministra', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      isOwner: false,
      accessibleSedi: [sede('s1'), sede('s2')],
      membershipRuoli: { s1: 'ADMIN_SEDE', s2: 'OPERATORE' },
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's2', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui il test per verificarne il fallimento**

Run: `pnpm --filter piattaforma exec vitest run src/app/team/actions.authz.test.ts`
Expected: FAIL (oggi le action usano `auth()` + gate ADMIN_AZIENDA e non `getSessionContext`).

- [ ] **Step 3: Sostituisci l'autorizzazione in `team/actions.ts`**

In `apps/piattaforma/src/app/team/actions.ts`:

(a) aggiorna gli import in testa:

```ts
import { getSessionContext } from '@/lib/auth/session-context';
import {
  manageableSedi,
  resolveSedeRole,
  resolveTeamTargetSede,
  assignableSedeRoles,
} from '@/lib/sedi/scope';
```

(b) **rimuovi** la funzione `resolveTargetSede` (righe ~20-35) e sostituiscila con i due helper:

```ts
type RuoloSedeInput = 'ADMIN_SEDE' | 'OPERATORE';

/**
 * Autorizza la CREAZIONE di un utente su una sede: risolve la sede destinataria
 * tra quelle gestibili dall'utente e valida il ruolo richiesto.
 */
async function authorizeTeamCreate(
  requestedSedeId: string | undefined,
  requestedRuolo: RuoloSedeInput | undefined,
): Promise<
  | { ok: true; companyId: string; sedeId: string; ruolo: RuoloSedeInput }
  | { ok: false; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  if (manageable.length === 0) {
    return { ok: false, error: 'Non hai i permessi per gestire il team' };
  }
  const target = resolveTeamTargetSede({ requestedSedeId, manageable });
  if (!target.ok) return { ok: false, error: target.error };
  const role = resolveSedeRole({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
    sedeId: target.sedeId,
  });
  const ruolo = requestedRuolo ?? 'OPERATORE';
  if (!assignableSedeRoles(role).includes(ruolo)) {
    return { ok: false, error: 'Ruolo non assegnabile' };
  }
  return { ok: true, companyId: ctx.companyId, sedeId: target.sedeId, ruolo };
}

/**
 * Autorizza un'operazione su un utente ESISTENTE (modifica/reset/disabilita):
 * il chiamante deve gestire una delle sedi di membership del target. Il
 * proprietario gestisce tutti. Il target deve essere nella stessa madre.
 */
async function authorizeTeamTargetUser(
  userId: string,
): Promise<
  | { ok: true; companyId: string; isOwner: boolean; manageableIds: string[] }
  | { ok: false; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  if (manageable.length === 0) return { ok: false, error: 'Non hai i permessi' };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== ctx.companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }
  const manageableIds = manageable.map((s) => s.id);
  if (!ctx.isOwner) {
    // Il target deve avere una membership in una sede gestita dal chiamante.
    const membership = await prisma.userSede.findFirst({
      where: { userId, sedeId: { in: manageableIds } },
      select: { id: true },
    });
    if (!membership) return { ok: false, error: 'Utente non nella tua sede' };
  }
  return { ok: true, companyId: ctx.companyId, isOwner: ctx.isOwner, manageableIds };
}
```

(c) **`createUserDirectAction`**: rimpiazza il blocco iniziale (da `const session = await auth()` fino al `const targetSede = ...`) con:

```ts
export async function createUserDirectAction(
  email: string,
  nome: string,
  cognome: string,
  password: string,
  sedeId?: string,
  ruoloSede?: RuoloSedeInput,
): Promise<CreateUserResult> {
  const authz = await authorizeTeamCreate(sedeId, ruoloSede);
  if (!authz.ok) return { ok: false, error: authz.error };
  const { companyId } = authz;
```

e più sotto, nella `tx.userSede.create`, usa il ruolo autorizzato:

```ts
    await tx.userSede.create({
      data: { userId: user.id, sedeId: authz.sedeId, ruolo: authz.ruolo },
    });
```

(d) **`createInvitationAction`**: rimpiazza l'inizio (auth + gate + `resolveTargetSede`) con:

```ts
export async function createInvitationAction(
  email: string,
  sedeId?: string,
  ruoloSede?: RuoloSedeInput,
): Promise<InviteResult> {
  const authz = await authorizeTeamCreate(sedeId, ruoloSede);
  if (!authz.ok) return { ok: false, error: authz.error };
  const companyId = authz.companyId;
  const session = await auth();
  const invitedById = session!.user!.id!;
```

e nella `prisma.invitation.create`, imposta `sedeId: authz.sedeId, ruoloSede: authz.ruolo`.

(e) **`updateTeamUserAction`**: sostituisci il gate iniziale con `authorizeTeamTargetUser`:

```ts
export async function updateTeamUserAction(
  userId: string,
  email: string,
  nome: string,
  cognome: string,
  sedeId?: string,
  ruoloSede?: RuoloSedeInput,
): Promise<UpdateTeamUserResult> {
  const authz = await authorizeTeamTargetUser(userId);
  if (!authz.ok) return { ok: false, error: authz.error };
  const { companyId } = authz;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }
```

Nel blocco `aggiornaMembership`, per i non-proprietari la sede di destinazione deve essere gestibile:

```ts
  const aggiornaMembership = target.role !== 'ADMIN_AZIENDA' && sedeId !== undefined;
  if (aggiornaMembership) {
    const sede = await prisma.sede.findFirst({
      where: { id: sedeId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!sede) return { ok: false, error: 'Sede non valida' };
    if (!authz.isOwner && !authz.manageableIds.includes(sedeId!)) {
      return { ok: false, error: 'Non puoi spostare l’utente su questa sede' };
    }
  }
```

(f) **`resetTeamUserPasswordAction`**, **`disableTeamUserAction`**: sostituisci il gate iniziale (`auth` + `role !== 'ADMIN_AZIENDA'` + ricalcolo `companyId`/target) con `authorizeTeamTargetUser`. Per `disableTeamUserAction` mantieni il controllo "non puoi eliminare te stesso":

```ts
export async function disableTeamUserAction(userId: string): Promise<DisableTeamUserResult> {
  const ctx = await getSessionContext();
  if (ctx?.user?.id === userId) {
    return { ok: false, error: 'Non puoi eliminare il tuo stesso account' };
  }
  const authz = await authorizeTeamTargetUser(userId);
  if (!authz.ok) return { ok: false, error: authz.error };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== authz.companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }
  if (target.deletedAt) return { ok: false, error: 'Utente già eliminato' };
  await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED', deletedAt: new Date() } });
  revalidatePath('/team');
  return { ok: true };
}
```

(g) **`revokeInvitationAction`**: sostituisci il gate con `authorizeTeamTargetUser`-analogo sull'invito. Poiché l'invito ha `sedeId`, verifica che sia gestibile:

```ts
export async function revokeInvitationAction(invitationId: string): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/login');
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.companyId !== ctx.companyId || inv.status !== 'PENDING') return;
  if (!ctx.isOwner && (!inv.sedeId || !manageable.some((s) => s.id === inv.sedeId))) return;
  await prisma.invitation.update({ where: { id: invitationId }, data: { status: 'REVOKED' } });
  revalidatePath('/team');
}
```

(Mantieni `import { auth } from '@/auth'` — ancora usato in `createInvitationAction` per `invitedById` e in `acceptInvitationAction`, invariata.)

- [ ] **Step 4: Esegui i test authz + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/app/team/actions.authz.test.ts`
Expected: PASS.
Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/team/
git commit -m "feat(multi-sede): ADMIN_SEDE gestisce il team della propria sede (server actions sede-aware)"
```

---

## Task 4: Team page + form + nav sede-aware (UI)

L'`ADMIN_SEDE` vede/gestisce solo la propria sede; il superadmin vede tutto filtrabile per sede; l'`OPERATORE` non accede. La voce nav "Team" compare per chi gestisce almeno una sede.

**Files:**
- Modify: `apps/piattaforma/src/app/team/page.tsx`
- Modify: `apps/piattaforma/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `getSessionContext`, `getManageableSedi` (Task 1).

- [ ] **Step 1: Rendi `team/page.tsx` sede-aware**

Sostituisci il corpo iniziale di `TeamPage` (righe ~11-36) con:

```ts
export default async function TeamPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!ctx.companyId) redirect('/dashboard');
  const manageable = await getManageableSedi();
  if (manageable.length === 0) redirect('/dashboard'); // né owner né admin di sede
  const companyId = ctx.companyId;
  const manageableIds = manageable.map((s) => s.id);

  // Owner: vede tutti gli utenti della madre. Admin di sede: solo gli utenti
  // con membership nelle sedi che amministra.
  const usersWhere = ctx.isOwner
    ? { companyId, deletedAt: null }
    : {
        companyId,
        deletedAt: null,
        sediMembership: { some: { sedeId: { in: manageableIds } } },
      };
  const invitationsWhere = ctx.isOwner
    ? { companyId, status: 'PENDING' as const }
    : { companyId, status: 'PENDING' as const, sedeId: { in: manageableIds } };

  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      where: usersWhere,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, nome: true, cognome: true,
        role: true, status: true, lastLoginAt: true,
      },
    }),
    prisma.invitation.findMany({
      where: invitationsWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, createdAt: true, expiresAt: true },
    }),
  ]);
  const sedi = manageable.map((s) => ({ id: s.id, nome: s.nome }));
  const session = { user: ctx.user };
```

> Nota: il `<AppShell session={session} ...>` più sotto richiede la sessione completa. Recupera la sessione con `const authSession = await auth();` in cima (mantieni l'import `auth`) e passala all'AppShell; usa `ctx` solo per lo scoping. In alternativa mantieni `const session = await auth()` e affianca `ctx`/`manageable`. **Scelta consigliata**: mantieni `const session = await auth(); if (!session?.user) redirect('/login');` e aggiungi `const ctx = await getSessionContext();` subito dopo, riusando `session` per l'AppShell e `ctx` per lo scoping.

Aggiorna gli import in testa al file:

```ts
import { getSessionContext, getManageableSedi } from '@/lib/auth/session-context';
```

La lista utenti mostra il ruolo: sostituisci l'etichetta hardcoded per riflettere anche l'admin di sede (facoltativo ma consigliato) — lascia invariata la riga `{u.role === 'ADMIN_AZIENDA' ? 'Admin' : 'Utente'}` per non introdurre query aggiuntive in questo task.

`<TeamPageClient sedi={sedi} />` resta invariato: riceve solo le sedi gestibili (per l'admin di sede sarà una sola → il `<select>` sede sparisce e le action risolvono la sede unica).

- [ ] **Step 2: Esponi la voce nav "Team" a chi gestisce una sede**

In `apps/piattaforma/src/components/app-shell.tsx`:

(a) cambia la firma di `navForRole` per accettare un flag e usalo per la voce Team. Sostituisci il blocco (righe ~80-82):

```ts
  if (role === 'ADMIN_AZIENDA') {
    links.push({ href: '/team', label: 'Team' });
  }
```

con:

```ts
  if (canManageTeam) {
    links.push({ href: '/team', label: 'Team' });
  }
```

e aggiorna la firma:

```ts
function navForRole(
  role: string | undefined,
  companyType: string | undefined,
  canManageTeam: boolean,
): NavLink[] {
```

(b) nel corpo del componente shell (dove viene chiamata `navForRole`, riga ~158), calcola il flag e passalo:

```ts
  const manageableSediList = await getManageableSedi();
  const links = navForRole(
    session.user.role,
    session.user.companyType,
    manageableSediList.length > 0,
  );
```

Aggiungi l'import in testa: `import { getManageableSedi } from '@/lib/auth/session-context';`

> Se il componente shell non è già `async`, rendilo `async` (è un Server Component). Verifica che l'export sia `export async function ...`.

- [ ] **Step 3: Typecheck + build check**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 4: Verifica manuale rapida (dev)**

Avvia `pnpm --filter piattaforma dev`. Con un utente `ADMIN_SEDE` (membership ruolo ADMIN_SEDE) la voce "Team" compare e la pagina mostra solo gli utenti della sua sede; con un `OPERATORE` la pagina reindirizza a `/dashboard` e la voce non compare. (Se non hai un utente di prova, salta e affidati ai test unit di Task 3 + e2e di Task 7.)

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/team/page.tsx apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(multi-sede): team page e nav sede-aware (admin di sede vede solo la propria sede)"
```

---

## Task 5: Impostazioni sede per ADMIN_SEDE (anagrafica/IBAN/soglia/orari)

L'`ADMIN_SEDE` modifica anagrafica, IBAN, soglia payout e orari della **propria** sede. Il CRUD sedi (crea/sospendi/riattiva) resta al superadmin. L'editing orari viene ristretto ad ADMIN_SEDE/OWNER (oggi lo può fare qualunque utente della sede).

**Files:**
- Modify: `apps/piattaforma/src/app/sedi/actions.ts` (`updateSedeAction`)
- Modify: `apps/piattaforma/src/app/wallet/actions.ts` (`updatePayoutThresholdAction`)
- Modify: `apps/piattaforma/src/app/orari/actions.ts` (`updateOrariAction`)

**Interfaces:**
- Consumes: `getSedeRole`, `getOperatingSede` (Task 1 + esistente); `canEditSedeSettings` (Task 1).

- [ ] **Step 1: `updateSedeAction` → aperta ad ADMIN_SEDE della sede**

In `apps/piattaforma/src/app/sedi/actions.ts`, aggiungi gli import:

```ts
import { getSedeRole } from '@/lib/auth/session-context';
import { canEditSedeSettings } from '@/lib/sedi/scope';
```

Sostituisci il gate iniziale di `updateSedeAction` (auth + `role !== 'ADMIN_AZIENDA'` + verifica sede-in-company) con:

```ts
export async function updateSedeAction(
  sedeId: string,
  formData: FormData,
): Promise<SedeActionResult> {
  const role = await getSedeRole(sedeId);
  if (!canEditSedeSettings(role)) {
    return { ok: false, error: 'Non hai i permessi per modificare questa sede' };
  }
```

> `getSedeRole` ritorna non-null solo per una sede accessibile della propria madre, quindi copre già il controllo "sede appartiene alla company". Rimuovi il vecchio blocco `const session = await auth()` + lookup `sede.companyId`. `createSedeAction`, `suspendSedeAction`, `reactivateSedeAction` restano **invariate** (solo proprietario).

- [ ] **Step 2: `updatePayoutThresholdAction` → aperta ad ADMIN_SEDE della sede operativa**

In `apps/piattaforma/src/app/wallet/actions.ts`, aggiungi gli import:

```ts
import { getSedeRole } from '@/lib/auth/session-context';
import { canEditSedeSettings } from '@/lib/sedi/scope';
```

Sostituisci il gate `if (session.user.role !== 'ADMIN_AZIENDA')` in `updatePayoutThresholdAction` con una risoluzione sede + controllo ruolo. La sede operativa va risolta *prima* del controllo:

```ts
  const sede = await getOperatingSede();
  if (!sede) return { ok: false, error: 'Seleziona una sede per modificarne la soglia' };
  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) {
    return { ok: false, error: 'Non hai i permessi per modificare la soglia di questa sede' };
  }
```

Rimuovi il vecchio `const session = await auth(); if (!session?.user) redirect('/login'); if (session.user.role !== 'ADMIN_AZIENDA') {...}` in testa alla funzione e la seconda risoluzione `const sede = await getOperatingSede()` più in basso (ora è in cima). Mantieni la validazione `validatePayoutThresholdCent`.

- [ ] **Step 3: `updateOrariAction` → ristretta ad ADMIN_SEDE/OWNER**

In `apps/piattaforma/src/app/orari/actions.ts`, aggiungi gli import:

```ts
import { getSedeRole } from '@/lib/auth/session-context';
import { canEditSedeSettings } from '@/lib/sedi/scope';
```

Dopo aver risolto `const sede = await getOperatingSede();` (righe ~39-40), aggiungi il controllo ruolo:

```ts
  const sede = await getOperatingSede();
  if (!sede) return { ok: false, error: 'Seleziona una sede per modificarne gli orari' };
  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) {
    return { ok: false, error: 'Solo l’admin di sede può modificare gli orari' };
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/sedi/actions.ts apps/piattaforma/src/app/wallet/actions.ts apps/piattaforma/src/app/orari/actions.ts
git commit -m "feat(multi-sede): ADMIN_SEDE modifica impostazioni/IBAN/soglia/orari della propria sede"
```

---

## Task 6: Wallet affiliazione — payout ristretto al superadmin (R5)

Il wallet madre (commissioni affiliazione) è incassabile e visibile solo al proprietario. Gli utenti di sede vedono/incassano solo il wallet della loro sede.

**Files:**
- Modify: `apps/piattaforma/src/app/wallet/actions.ts` (`richiediPayoutAction`)
- Modify: `apps/piattaforma/src/app/wallet/page.tsx`
- Test: `apps/piattaforma/src/app/wallet/actions.test.ts` (aggiunge caso)

**Interfaces:**
- Consumes: `getSessionContext`/`isOwner` (già disponibili); `getOperatingSede`.

- [ ] **Step 1: Scrivi il test — non-owner non incassa il wallet madre**

Apri `apps/piattaforma/src/app/wallet/actions.test.ts` e aggiungi un caso che verifica che, per un utente **non owner**, `richiediPayoutAction` non consideri il wallet madre tra gli eleggibili (solo il wallet sede). Adatta il pattern di mock già presente nel file (stessa struttura `vi.hoisted`/`vi.mock` usata dagli altri test del file); asserisci che `eseguiPayoutImmediato` sia chiamato solo con l'id del wallet sede e mai con quello del wallet madre quando `session.user.role !== 'ADMIN_AZIENDA'`.

> Se il file non mocka già `auth`/`getOperatingSede`, riusa i mock esistenti nel file; l'obiettivo del test è: con ruolo non-owner e wallet madre sopra soglia, il payout del wallet madre **non** avviene.

- [ ] **Step 2: Esegui il test per verificarne il fallimento**

Run: `pnpm --filter piattaforma exec vitest run src/app/wallet/actions.test.ts`
Expected: FAIL (oggi il wallet madre è sempre incassato).

- [ ] **Step 3: Restringi il wallet madre al proprietario in `richiediPayoutAction`**

In `apps/piattaforma/src/app/wallet/actions.ts`, aggiungi l'import `import { isOwner } from '@/lib/auth/permissions';` (se non presente) e modifica la costruzione degli eleggibili: il wallet madre entra solo se il chiamante è owner.

```ts
  const sede = await getOperatingSede();
  const includeAffiliazione = isOwner(session.user.role);
  const [walletSede, walletMadre] = await Promise.all([
    sede
      ? prisma.wallet.findUnique({
          where: { sedeId: sede.id },
          select: { id: true, saldoCent: true },
        })
      : null,
    includeAffiliazione
      ? prisma.wallet.findUnique({
          where: { companyId: session.user.companyId },
          select: { id: true, saldoCent: true },
        })
      : null,
  ]);
```

Il resto (`wallets = [walletSede, walletMadre].filter(...)`, soglia, gate mandato, loop) resta invariato: per i non-owner `walletMadre` è `null` e viene filtrato via.

- [ ] **Step 4: Nascondi la sezione affiliazione nel wallet ai non-owner**

In `apps/piattaforma/src/app/wallet/page.tsx`, carica il wallet madre solo per l'owner. Alla riga ~93 sostituisci la condizione della query `walletMadre`:

```ts
    // Wallet madre: affiliazione — visibile/incassabile solo dal proprietario.
    isOwner(session.user.role as string) && session.user.companyId
      ? prisma.wallet.findUnique({
          where: { companyId: session.user.companyId },
          include: { transazioni: txInclude, payouts: payoutsInclude },
        })
      : null,
```

`isOwner` è già importato nel file (riga 17). Così `hasAffiliazione`, saldi, movimenti e payout mostrano l'affiliazione solo al proprietario, senza altri cambi.

- [ ] **Step 5: (già coperto) soglia payout form**

Il form soglia è oggi gated `isAdminAzienda`. Con Task 5 l'action è aperta ad ADMIN_SEDE; per coerenza UI, sostituisci il gate di render (riga ~316) da `{isAdminAzienda && (` a un flag calcolato dal ruolo di sede: aggiungi in cima al render `const sedeRole = await getSedeRole(sede.id);` (import `getSedeRole` + `canEditSedeSettings`) e usa `{canEditSedeSettings(sedeRole) && (`. Rimuovi `const isAdminAzienda = ...` se non più usato altrove nel file.

- [ ] **Step 6: Esegui test wallet + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/app/wallet/actions.test.ts`
Expected: PASS.
Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/wallet/
git commit -m "fix(multi-sede): payout e vista wallet affiliazione riservati al proprietario; soglia editabile da admin di sede"
```

---

## Task 7: Verifica di regressione (suite completa + typecheck + caso 1:1)

Nessun codice nuovo se tutto è verde: è il gate di chiusura.

**Files:** nessuno (solo esecuzione).

- [ ] **Step 1: Suite unit completa**

Run: `pnpm --filter piattaforma test`
Expected: tutti i test verdi (i test preesistenti + i nuovi di Task 1/2/3/6). Se un test preesistente falliva perché assumeva il vecchio comportamento (es. dedup madre), correggilo per riflettere il nuovo modello.

- [ ] **Step 2: Typecheck monorepo**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 3: Lint**

Run: `pnpm --filter piattaforma lint`
Expected: nessun errore.

- [ ] **Step 4: Regressione 1:1 (manuale, dev)**

Con `pnpm --filter piattaforma dev`, per una madre con **una sola sede** (caso 1:1) verifica che:
- il selettore sede resta nascosto;
- il proprietario opera la sede unica (crea pratica, wallet, orari) come prima;
- team, payout e impostazioni funzionano identici a prima.

- [ ] **Step 5: Build (opzionale, pre-deploy)**

Run: `pnpm --filter piattaforma build`
Expected: build ok. (Il deploy in prod = push `main` + eventuale nulla-osta; nessuna migration da applicare — vedi Global Constraints.)

- [ ] **Step 6: Commit finale (se necessarie correzioni di regressione)**

```bash
git add -A
git commit -m "test(multi-sede): allinea la suite al nuovo modello sedi-autonome + distribuzione per sede"
```

---

## Self-Review (esito)

**1. Copertura spec.**
- Spec §4 (distribuzione per sede / R1) → **Task 2**.
- Spec §5.1 (team sede-aware / G2) → **Task 3** (server) + **Task 4** (UI/nav).
- Spec §5.2 (impostazioni sede: anagrafica/IBAN/soglia/orari / R2) → **Task 5**.
- Spec §3 (autorizzazione sede-aware, `getSedeRole`, no nuovi ruoli) → **Task 1**.
- Spec §6/R5 (wallet affiliazione al superadmin) → **Task 6**.
- Spec §7 (nessun cambio schema/migrazione) → rispettato (Global Constraints; nessun task tocca Prisma schema).
- Spec §8 (testing: distribuzione, autorizzazione, payout, 1:1) → Task 2/3/6 + **Task 7**.
- Spec R3/R4 (superadmin unico, auto-sede in registrazione) → nessun cambio richiesto (confermato in spec §6 "nessuna modifica al flusso di registrazione"); coperto per non-regressione da Task 7 step 4.

**2. Placeholder scan.** Nessun "TBD/TODO"; ogni step di logica pura/azione mostra il codice. I due punti UI con margine descrittivo (Task 4 shell async, Task 6 step 5) indicano file, righe e snippet esatti da sostituire.

**3. Coerenza tipi.** `SedeRole`/`SedeRuolo` definiti in Task 1 e usati coerentemente in Task 3/5/6. `resolveSedeRole`, `canManageSedeTeam`, `canEditSedeSettings`, `assignableSedeRoles`, `manageableSedi`, `resolveTeamTargetSede`, `getSedeRole`, `getManageableSedi` hanno firme identiche tra "Produces" (Task 1) e consumo (Task 3–6).
