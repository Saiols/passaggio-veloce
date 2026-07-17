# Monitoraggio pratiche ferme + revoca e ricircolo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare al super-admin una pagina per monitorare le pratiche accettate ma non lavorate (rosse a ≥3 giorni) e revocarle rimettendole in circolo nella zona, con storico durevole dei cambi di stato.

**Architecture:** Nuova tabella append-only `PraticaStatoLog` alimentata da un helper `logCambioStato` chiamato ai punti che scrivono lo stato. La revoca sgancia l'agenzia, incrementa un `distribuzioneCiclo` sulla pratica e riavvia `avviaRound(1)`; l'engine esclude dai candidati le sedi del ciclo corrente **e** quelle con esito `REVOCATA_ADMIN` (esclusione permanente). Nuove email N50/N51 + riuso N40 per i clienti. Pagina server dedicata `/admin/monitoraggio` con azione + modale.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 5.22 + Postgres, TypeScript, Vitest, Tailwind v4 (design tokens PV).

## Global Constraints

- **Node:** eseguire `nvm use 22.15.0` prima di ogni comando pnpm (post-riavvio la shell torna a Node 16, pnpm richiede ≥18).
- **Migration a mano, MAI `prisma migrate dev`:** `migrate dev` propone DROP distruttivi. Si scrive `migration.sql` a mano e si applica in locale con `prisma migrate deploy` (`db:deploy`).
- **DB locale = copia di prod, dati usa-e-getta:** nessun backfill, nessuna grazia per i record esistenti. Il log parte da ora in avanti.
- **Test:** `pnpm --filter piattaforma test` (tutti) oppure `pnpm --filter piattaforma exec vitest run <path>` (singolo file). Vitest NON fa typecheck.
- **Typecheck:** `pnpm --filter piattaforma typecheck` e `pnpm --filter @pv/db typecheck`. Il typecheck a cache fredda del monorepo può dare falsi errori: eseguirlo dopo un build/generate riuscito.
- **Colori:** solo token esistenti. Su red/amber esistono SOLO le tonalità `-50` e `-500`; su slate `-100/-200/-300/-500/-700`. NON usare `-600/-700` su red/amber né `slate-600` (non esistono in globals.css). Niente colori hardcoded.
- **Barrel `@pv/db`:** `export * from '@prisma/client'` → importare tipi enum (`PraticaStato`, `Prisma`, `PrismaClient`) da `@pv/db`.
- **Notifiche transazionali** (N50/N51): NON passano dal gating preferenze (`preferences.ts` invariato).
- **Best-effort post-commit:** email ed eventi vanno fuori dalla transazione e non devono mai far fallire la mutazione (pattern `.catch(() => undefined)`).

---

### Task 1: Schema Prisma + migration (fondamenta dati)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260717130000_monitoraggio_revoca_ricircolo/migration.sql`

**Interfaces:**
- Produces: modello `PraticaStatoLog`; colonne `Pratica.distribuzioneCiclo`, `PraticaAssegnazione.ciclo`; enum `AssegnazioneEsito.REVOCATA_ADMIN`, `NotificaTipo.N50_AGENZIA_PRATICA_REVOCATA`, `NotificaTipo.N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO`.

- [ ] **Step 1: enum `AssegnazioneEsito` — aggiungi il valore**

In `schema.prisma`, nell'enum `AssegnazioneEsito` (attualmente `PENDING/ACCETTATA/RIFIUTATA/TIMEOUT/ASSEGNATA_ALTRO`), aggiungi in fondo:

```prisma
enum AssegnazioneEsito {
  PENDING
  ACCETTATA
  RIFIUTATA
  TIMEOUT
  ASSEGNATA_ALTRO
  // Revoca admin: l'agenzia aveva accettato ma non ha lavorato la pratica.
  // Segnale di esclusione PERMANENTE dai ricircoli successivi.
  REVOCATA_ADMIN
}
```

- [ ] **Step 2: enum `NotificaTipo` — aggiungi i due valori**

In `schema.prisma`, nell'enum `NotificaTipo`, subito dopo `N49_ADMIN_ATECO_NON_IDONEO`:

```prisma
  N49_ADMIN_ATECO_NON_IDONEO
  N50_AGENZIA_PRATICA_REVOCATA
  N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO
```

- [ ] **Step 3: `model Pratica` — colonna ciclo + relation storico**

Nel `model Pratica`, accanto a `codicePratica`/`stato`, aggiungi la colonna ciclo:

```prisma
  tipo  PraticaTipo
  stato PraticaStato @default(BOZZA)

  // Ciclo di distribuzione corrente. Incrementato a ogni revoca admin: fa
  // ripartire la distribuzione "pulita" ricontattando la zona, mentre le sedi
  // revocate (esito REVOCATA_ADMIN) restano escluse per sempre.
  distribuzioneCiclo Int @default(1)
```

E nel blocco `// Relations` dello stesso modello, aggiungi:

```prisma
  dichiarazioniBroker     BrokerDichiarazione[]
  storicoStato            PraticaStatoLog[]
```

- [ ] **Step 4: `model PraticaAssegnazione` — colonna ciclo**

Nel `model PraticaAssegnazione`, accanto a `round`:

```prisma
  round Int // 1, 2, 3

  // Ciclo di distribuzione (Pratica.distribuzioneCiclo) di questo tentativo.
  ciclo Int @default(1)
```

- [ ] **Step 5: nuovo `model PraticaStatoLog`**

Aggiungi (subito dopo il `model PraticaAssegnazione`, prima della sezione `MODELS — documenti`):

```prisma
// Storico append-only dei cambi di stato di una pratica: fonte di verità per
// ricostruire il ciclo di vita. `attoreUserId` è soft-ref (nessuna FK: come
// EventoPratica.seenByUserId) per non vincolare la cancellazione utenti.
// `meta.tipoEvento` è una costante app-level (lib/pratiche/stato-log.ts).
model PraticaStatoLog {
  id        String  @id @default(uuid()) @db.Uuid
  praticaId String  @db.Uuid
  pratica   Pratica @relation(fields: [praticaId], references: [id], onDelete: Cascade)

  statoDa PraticaStato?
  statoA  PraticaStato

  motivo       String?
  attoreUserId String? @db.Uuid
  meta         Json?

  createdAt DateTime @default(now())

  @@index([praticaId, createdAt])
  @@map("pratica_stato_log")
}
```

- [ ] **Step 6: scrivi la migration a mano**

Crea `packages/db/prisma/migrations/20260717130000_monitoraggio_revoca_ricircolo/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "AssegnazioneEsito" ADD VALUE 'REVOCATA_ADMIN';

-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N50_AGENZIA_PRATICA_REVOCATA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO';

-- AlterTable
ALTER TABLE "pratiche" ADD COLUMN "distribuzioneCiclo" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "pratiche_assegnazioni" ADD COLUMN "ciclo" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "pratica_stato_log" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "statoDa" "PraticaStato",
    "statoA" "PraticaStato" NOT NULL,
    "motivo" TEXT,
    "attoreUserId" UUID,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pratica_stato_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pratica_stato_log_praticaId_createdAt_idx" ON "pratica_stato_log"("praticaId", "createdAt");

-- AddForeignKey
ALTER TABLE "pratica_stato_log" ADD CONSTRAINT "pratica_stato_log_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 7: valida lo schema**

Run: `nvm use 22.15.0; pnpm --filter @pv/db exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 8: applica la migration in locale + rigenera il client**

Assicurati che il DB locale sia su (`pnpm db:up` se serve).
Run: `pnpm --filter @pv/db db:deploy`
Expected: `Applying migration 20260717130000_monitoraggio_revoca_ricircolo` senza errori.
Run: `pnpm --filter @pv/db db:generate`
Expected: `Generated Prisma Client` senza errori.

- [ ] **Step 9: typecheck del package db**

Run: `pnpm --filter @pv/db typecheck`
Expected: nessun errore.

- [ ] **Step 10: commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260717130000_monitoraggio_revoca_ricircolo/
git commit -m "feat(monitoraggio): schema stato-log + ciclo distribuzione + enum revoca/notifiche"
```

---

### Task 2: helper puro `sediDaEscludere` (esclusione candidati)

**Files:**
- Create: `apps/piattaforma/src/lib/distribuzione/esclusioni.ts`
- Test: `apps/piattaforma/src/lib/distribuzione/esclusioni.test.ts`

**Interfaces:**
- Produces: `sediDaEscludere(pratica: { distribuzioneCiclo: number; assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[] }): string[]`

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `esclusioni.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sediDaEscludere } from './esclusioni';

describe('sediDaEscludere', () => {
  it('ciclo normale (mai revocata): esclude tutte le sedi del ciclo corrente', () => {
    const out = sediDaEscludere({
      distribuzioneCiclo: 1,
      assegnazioni: [
        { sedeId: 's1', ciclo: 1, esito: 'PENDING' },
        { sedeId: 's2', ciclo: 1, esito: 'RIFIUTATA' },
        { sedeId: null, ciclo: 1, esito: 'TIMEOUT' },
      ],
    });
    expect(out.sort()).toEqual(['s1', 's2']);
  });

  it('dopo revoca: esclude SOLO la revocata, ricontatta chi era nel ciclo vecchio', () => {
    const out = sediDaEscludere({
      distribuzioneCiclo: 2,
      assegnazioni: [
        { sedeId: 's1', ciclo: 1, esito: 'REVOCATA_ADMIN' }, // permanente
        { sedeId: 's2', ciclo: 1, esito: 'ASSEGNATA_ALTRO' }, // ciclo vecchio → ricontattabile
        { sedeId: 's3', ciclo: 1, esito: 'RIFIUTATA' }, // ciclo vecchio → ricontattabile
      ],
    });
    expect(out).toEqual(['s1']);
  });

  it('seconda revoca: accumula le esclusioni permanenti', () => {
    const out = sediDaEscludere({
      distribuzioneCiclo: 3,
      assegnazioni: [
        { sedeId: 's1', ciclo: 1, esito: 'REVOCATA_ADMIN' },
        { sedeId: 's2', ciclo: 2, esito: 'REVOCATA_ADMIN' },
        { sedeId: 's3', ciclo: 2, esito: 'ASSEGNATA_ALTRO' }, // ricontattabile
        { sedeId: 's4', ciclo: 3, esito: 'PENDING' }, // ciclo corrente → escluso
      ],
    });
    expect(out.sort()).toEqual(['s1', 's2', 's4']);
  });
});
```

- [ ] **Step 2: esegui il test — deve fallire**

Run: `pnpm --filter piattaforma exec vitest run src/lib/distribuzione/esclusioni.test.ts`
Expected: FAIL con "Failed to resolve import './esclusioni'".

- [ ] **Step 3: implementa il modulo**

Crea `esclusioni.ts`:

```ts
/**
 * Sedi da escludere dalla selezione candidati (multi-sede, distribuzione):
 *  - tutte quelle già contattate NEL CICLO corrente (nessun doppio invio nello
 *    stesso giro);
 *  - tutte quelle con esito REVOCATA_ADMIN su questa pratica, in QUALUNQUE
 *    ciclo → esclusione PERMANENTE (l'admin le ha tolte la gestione).
 *
 * Per una pratica mai revocata (distribuzioneCiclo sempre 1, tutte le righe
 * ciclo 1) coincide esattamente con l'insieme storico "sedi già contattate":
 * comportamento invariato rispetto a prima del ciclo.
 */
export function sediDaEscludere(pratica: {
  distribuzioneCiclo: number;
  assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
}): string[] {
  const out = new Set<string>();
  for (const a of pratica.assegnazioni) {
    if (a.sedeId == null) continue;
    if (a.ciclo === pratica.distribuzioneCiclo || a.esito === 'REVOCATA_ADMIN') {
      out.add(a.sedeId);
    }
  }
  return [...out];
}
```

- [ ] **Step 4: esegui il test — deve passare**

Run: `pnpm --filter piattaforma exec vitest run src/lib/distribuzione/esclusioni.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/esclusioni.ts apps/piattaforma/src/lib/distribuzione/esclusioni.test.ts
git commit -m "feat(distribuzione): helper sediDaEscludere (ciclo + esclusione permanente revocata)"
```

---

### Task 3: integra il ciclo in `avviaRound` (engine) + esporta gli helper

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts`

**Interfaces:**
- Consumes: `sediDaEscludere` (Task 2).
- Produces: `export async function avviaRound(tx, pratica, round)` e `export async function processPostCommitJobs(jobs)` (consumati dalla revoca in Task 9). Firma aggiornata di `avviaRound`: `pratica` ora richiede `distribuzioneCiclo: number` e `assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[]`.

- [ ] **Step 1: importa l'helper**

In cima a `tick.ts`, accanto agli altri import da `./`:

```ts
import { attachRating, rankCandidates } from './ranking';
import { checkAutoSuspendForSedi } from './auto-suspend';
import { sediDaEscludere } from './esclusioni';
```

- [ ] **Step 2: aggiorna la firma e l'esclusione di `avviaRound`**

Sostituisci l'attuale header di `avviaRound` e il calcolo di `sediContattate`:

```ts
async function avviaRound(
  tx: Prisma.TransactionClient,
  pratica: {
    id: string;
    provincia: string | null;
    distribuzioneCiclo: number;
    assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
  },
  round: 1 | 2 | 3,
): Promise<{ count: number; newAssegnazioniIds: string[]; escalated: boolean }> {
  const now = new Date();
  const provincia = (pratica.provincia ?? '').toUpperCase();
  const sediContattate = new Set(sediDaEscludere(pratica));
```

(Il resto della funzione resta invariato: `maxPerRound`, il `findMany`, il ranking, ecc. usano `sediContattate` come prima.)

- [ ] **Step 3: scrivi `ciclo` sulle nuove assegnazioni**

Dentro `avviaRound`, nel `tx.praticaAssegnazione.create({ data: {...} })`, aggiungi `ciclo`:

```ts
    const created = await tx.praticaAssegnazione.create({
      data: {
        praticaId: pratica.id,
        agenziaId: a.companyId, // madre (colonna legacy, NOT NULL)
        sedeId: a.id, // sede fisica assegnataria
        round,
        ciclo: pratica.distribuzioneCiclo,
        esito: 'PENDING',
        invioAt: now,
        countdownInizioAt: inizio,
        countdownFineAt: fine,
      },
    });
```

- [ ] **Step 4: allarga la select in `avviaRound1ForPratica`**

In `avviaRound1ForPratica`, il `findUnique` seleziona solo `sedeId`. Aggiorna la select delle assegnazioni:

```ts
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
    });
```

(Le colonne scalari della pratica — incluse `distribuzioneCiclo` e `stato` — sono già tutte incluse perché non c'è `select` sulla pratica. `tickPratica` carica già le assegnazioni complete, quindi `ciclo`/`esito` sono presenti senza modifiche.)

- [ ] **Step 5: esporta `avviaRound` e `processPostCommitJobs`**

Aggiungi la keyword `export` alle due dichiarazioni (servono alla revoca in Task 9):

```ts
export async function avviaRound(
```
```ts
export async function processPostCommitJobs(jobs: PostCommitJobs): Promise<void> {
```

- [ ] **Step 6: typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore. (Se emergono switch esaustivi su `AssegnazioneEsito` che non gestiscono `REVOCATA_ADMIN`, aggiungi il ramo mancante trattandolo come un esito chiuso/non-pending, es. in `lib/pratiche/stati.ts` o `app/inbox/storico.ts`.)

- [ ] **Step 7: esegui i test dell'engine esistenti (non-regressione)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/distribuzione`
Expected: PASS (ranking + esclusioni).

- [ ] **Step 8: commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/tick.ts
git commit -m "feat(distribuzione): ciclo di distribuzione in avviaRound + export per la revoca"
```

---

### Task 4: helper `logCambioStato` + costanti tipoEvento

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/stato-log.ts`
- Test: `apps/piattaforma/src/lib/pratiche/stato-log.test.ts`

**Interfaces:**
- Produces: `STATO_EVENTO` (const), `type StatoEvento`, `logCambioStato(client, { praticaId, statoDa?, statoA, tipoEvento, attoreUserId?, motivo?, meta? }): Promise<void>`.

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `stato-log.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { logCambioStato, STATO_EVENTO } from './stato-log';

describe('logCambioStato', () => {
  it('crea la riga con tipoEvento dentro meta e i default null', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { praticaStatoLog: { create } } as never;

    await logCambioStato(tx, {
      praticaId: 'p1',
      statoA: 'ACCETTATA',
      tipoEvento: STATO_EVENTO.ACCEPT,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      data: {
        praticaId: 'p1',
        statoDa: null,
        statoA: 'ACCETTATA',
        motivo: null,
        attoreUserId: null,
        meta: { tipoEvento: 'ACCEPT' },
      },
    });
  });

  it('propaga statoDa/motivo/attore e fonde meta extra', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { praticaStatoLog: { create } } as never;

    await logCambioStato(tx, {
      praticaId: 'p2',
      statoDa: 'ACCETTATA',
      statoA: 'IN_ATTESA_ROUND_1',
      tipoEvento: STATO_EVENTO.RECIRCULATE,
      attoreUserId: 'u1',
      motivo: 'agenzia inattiva',
      meta: { ciclo: 2 },
    });

    expect(create.mock.calls[0][0].data).toMatchObject({
      statoDa: 'ACCETTATA',
      attoreUserId: 'u1',
      motivo: 'agenzia inattiva',
      meta: { tipoEvento: 'RECIRCULATE', ciclo: 2 },
    });
  });
});
```

- [ ] **Step 2: esegui il test — deve fallire**

Run: `pnpm --filter piattaforma exec vitest run src/lib/pratiche/stato-log.test.ts`
Expected: FAIL con "Failed to resolve import './stato-log'".

- [ ] **Step 3: implementa il modulo**

Crea `stato-log.ts`:

```ts
import 'server-only';
import type { Prisma, PrismaClient, PraticaStato } from '@pv/db';

type StatoLogClient = PrismaClient | Prisma.TransactionClient;

/** Costanti app-level (finiscono in meta.tipoEvento). Nessun enum DB. */
export const STATO_EVENTO = {
  SUBMIT: 'SUBMIT',
  ROUND_ADVANCE: 'ROUND_ADVANCE',
  ESCALATION: 'ESCALATION',
  ACCEPT: 'ACCEPT',
  ADMIN_ASSIGN: 'ADMIN_ASSIGN',
  PROCESS: 'PROCESS',
  SIGN: 'SIGN',
  CANCEL: 'CANCEL',
  RECIRCULATE: 'RECIRCULATE',
} as const;

export type StatoEvento = (typeof STATO_EVENTO)[keyof typeof STATO_EVENTO];

/**
 * Registra un cambio di stato nel log append-only. Va chiamato DENTRO la stessa
 * transazione della mutazione di stato, così l'audit è atomico con la
 * transizione. `client` accetta sia il client globale sia una tx.
 */
export async function logCambioStato(
  client: StatoLogClient,
  args: {
    praticaId: string;
    statoDa?: PraticaStato | null;
    statoA: PraticaStato;
    tipoEvento: StatoEvento;
    attoreUserId?: string | null;
    motivo?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await client.praticaStatoLog.create({
    data: {
      praticaId: args.praticaId,
      statoDa: args.statoDa ?? null,
      statoA: args.statoA,
      motivo: args.motivo ?? null,
      attoreUserId: args.attoreUserId ?? null,
      meta: { tipoEvento: args.tipoEvento, ...(args.meta ?? {}) } as Prisma.InputJsonValue,
    },
  });
}
```

- [ ] **Step 4: esegui il test — deve passare**

Run: `pnpm --filter piattaforma exec vitest run src/lib/pratiche/stato-log.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: commit**

```bash
git add apps/piattaforma/src/lib/pratiche/stato-log.ts apps/piattaforma/src/lib/pratiche/stato-log.test.ts
git commit -m "feat(pratiche): helper logCambioStato + costanti tipoEvento"
```

---

### Task 5: aggancia `logCambioStato` alle transizioni esistenti

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts`
- Modify: `apps/piattaforma/src/app/inbox/actions.ts`
- Modify: `apps/piattaforma/src/app/admin/escalation/actions.ts`
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts`
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts`
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts`

**Interfaces:**
- Consumes: `logCambioStato`, `STATO_EVENTO` (Task 4).

> Nota: queste sono chiamate transaction-embedded a `logCambioStato` accanto ai `pratica.update({ stato })` esistenti. Sono verificate dal typecheck (Task 4 ha già testato l'helper) e, a runtime, dalla verifica browser finale (Task 11). Ogni chiamata usa il **tx** locale, non `prisma`.

- [ ] **Step 1: `tick.ts` — round advance + escalation**

Aggiungi l'import in cima:

```ts
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';
```

Aggiungi un helper accanto a `statoPerRound`:

```ts
function statoNomePerRound(round: 1 | 2 | 3): 'IN_ATTESA_ROUND_1' | 'IN_ATTESA_ROUND_2' | 'IN_ATTESA_ROUND_3' {
  return round === 1 ? 'IN_ATTESA_ROUND_1' : round === 2 ? 'IN_ATTESA_ROUND_2' : 'IN_ATTESA_ROUND_3';
}
```

In `tickPratica`, nel ramo `currentRound < 3` (subito dopo `const { count, newAssegnazioniIds, escalated } = await avviaRound(tx, pratica, nextRound);` e prima del `return`):

```ts
      const { count, newAssegnazioniIds, escalated } = await avviaRound(tx, pratica, nextRound);
      await logCambioStato(tx, {
        praticaId,
        statoDa: pratica.stato,
        statoA: escalated ? 'IN_ESCALATION' : statoNomePerRound(nextRound),
        tipoEvento: escalated ? STATO_EVENTO.ESCALATION : STATO_EVENTO.ROUND_ADVANCE,
        meta: { round: nextRound, ciclo: pratica.distribuzioneCiclo },
      });
```

E nel ramo "Round 3 esaurito → escalation" (subito dopo il `tx.pratica.update({ ... stato: 'IN_ESCALATION' ... })`):

```ts
    await tx.pratica.update({
      where: { id: praticaId },
      data: { stato: 'IN_ESCALATION', escalationAt: now },
    });
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: 'IN_ESCALATION',
      tipoEvento: STATO_EVENTO.ESCALATION,
      meta: { round: currentRound, ciclo: pratica.distribuzioneCiclo },
    });
```

In `avviaRound1ForPratica`, dentro la transazione, dopo aver letto `updated`:

```ts
    const updated = await tx.pratica.findUnique({
      where: { id: praticaId },
      select: { stato: true },
    });
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: updated!.stato,
      tipoEvento: updated!.stato === 'IN_ESCALATION' ? STATO_EVENTO.ESCALATION : STATO_EVENTO.SUBMIT,
      meta: { round: 1, ciclo: pratica.distribuzioneCiclo },
    });
```

- [ ] **Step 2: `inbox/actions.ts` — ACCEPT**

Import in cima: `import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';`

Dentro la transazione di `acceptPratica`, subito dopo il `tx.pratica.update({ ... stato: 'ACCETTATA' ... })`:

```ts
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: 'ACCETTATA',
      tipoEvento: STATO_EVENTO.ACCEPT,
      attoreUserId: session.user.id,
      meta: { sedeId: assegnazione.sedeId },
    });
```

(`pratica` e `assegnazione` sono le variabili già presenti nella tx; `session` è già in scope.)

- [ ] **Step 3: `admin/escalation/actions.ts` — ADMIN_ASSIGN**

Import: `import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';`

Dentro la tx di `assegnaEscalationAction`, dopo il `tx.pratica.update({ ... stato: 'ACCETTATA' ... })`:

```ts
        await logCambioStato(tx, {
          praticaId,
          statoDa: 'IN_ESCALATION',
          statoA: 'ACCETTATA',
          tipoEvento: STATO_EVENTO.ADMIN_ASSIGN,
          attoreUserId: session.user.id,
          meta: { sedeId: sede.id },
        });
```

- [ ] **Step 4: `pratiche/actions.ts` — PROCESS + CANCEL**

Import: `import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';`

In `processaPraticaCore`, dopo il `tx.pratica.update({ ... stato: 'PROCESSATA' ... })`:

```ts
    await logCambioStato(tx, {
      praticaId,
      statoDa: 'ACCETTATA',
      statoA: 'PROCESSATA',
      tipoEvento: STATO_EVENTO.PROCESS,
      attoreUserId: session.user.id,
    });
```

In `annullaPraticaAction`, `annullaPraticaAction` carica la pratica prima di aggiornarla (per verificare che non sia FIRMATA/ANNULLATA/bloccata): usa quella variabile `pratica.stato` come `statoDa`. Dopo il `tx.pratica.update({ ... stato: 'ANNULLATA' ... })`:

```ts
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato, // pratica caricata prima dell'update (già in scope)
      statoA: 'ANNULLATA',
      tipoEvento: STATO_EVENTO.CANCEL,
      attoreUserId: session.user.id,
    });
```

- [ ] **Step 5: `firma-engine.ts` — SIGN (dopo compare-and-set)**

Import: `import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';`

Il passaggio a `FIRMATA` è un compare-and-set `updateMany` (ritorna `{ count }`). Logga SOLO se il CAS ha avuto effetto, dentro la stessa tx:

```ts
    const res = await tx.pratica.updateMany({
      where: { id: praticaId, stato: 'PROCESSATA' },
      data: { stato: 'FIRMATA', firmaAvvenutaAt: now /* ...campi esistenti... */ },
    });
    if (res.count === 0) {
      // ...gestione esistente del CAS fallito...
    } else {
      await logCambioStato(tx, {
        praticaId,
        statoDa: 'PROCESSATA',
        statoA: 'FIRMATA',
        tipoEvento: STATO_EVENTO.SIGN,
        attoreUserId: attoreUserId ?? null, // usa l'id disponibile nel motore firma (utente o admin attestante)
      });
    }
```

(Adatta i nomi delle variabili a quelli reali di `firma-engine.ts`: l'importante è loggare solo nel ramo in cui `count > 0`.)

- [ ] **Step 6: `penali/segnalazione.ts` — CANCEL (annullamento con penale)**

Import: `import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';`

In `confermaAnnullamentoConPenaleAction`, dopo il `tx.pratica.update({ ... stato: 'ANNULLATA' ... })`:

```ts
    await logCambioStato(tx, {
      praticaId,
      statoDa: 'ACCETTATA',
      statoA: 'ANNULLATA',
      tipoEvento: STATO_EVENTO.CANCEL,
      attoreUserId: session.user.id,
      meta: { conPenale: true },
    });
```

- [ ] **Step 7: typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 8: esegui la suite di test (non-regressione)**

Run: `pnpm --filter piattaforma test`
Expected: PASS (nessuna regressione).

- [ ] **Step 9: commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/tick.ts apps/piattaforma/src/app/inbox/actions.ts apps/piattaforma/src/app/admin/escalation/actions.ts apps/piattaforma/src/app/pratiche/actions.ts apps/piattaforma/src/lib/pratiche/firma-engine.ts apps/piattaforma/src/lib/penali/segnalazione.ts
git commit -m "feat(pratiche): storico stati su tutte le transizioni del ciclo di vita"
```

---

### Task 6: email N50 (agenzia revocata) + N51 (broker) + arm N40 clienti

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts`
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts`
- Test: `apps/piattaforma/src/lib/notifiche/templates-revoca.test.ts`

**Interfaces:**
- Consumes: `NotificaTipo.N50_*`, `NotificaTipo.N51_*` (Task 1).
- Produces: `tplN50AgenziaRevocata`, `tplN51BrokerRimessaInCircolo`, i loro payload, e il valore `'RIMESSA_IN_CIRCOLO'` del tipo `ClienteAvanzamentoStato`.

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `templates-revoca.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  tplN50AgenziaRevocata,
  tplN51BrokerRimessaInCircolo,
  tplN40ClienteAvanzamento,
} from './templates';

describe('template revoca/ricircolo', () => {
  it('N50: informa l\'agenzia della revoca con codice e motivo', () => {
    const c = tplN50AgenziaRevocata({
      codicePratica: 'PV-2026-001', targa: 'AB123CD', nomeAgenzia: 'Auto MI', motivo: 'ferma da giorni',
    });
    expect(c.subject).toContain('PV-2026-001');
    expect(c.text).toContain('Auto MI');
    expect(c.text).toContain('ferma da giorni');
    expect(c.html).toContain('PV-2026-001');
  });

  it('N51: informa il broker della rimessa in circolo', () => {
    const c = tplN51BrokerRimessaInCircolo({ codicePratica: 'PV-2026-002', targa: null, nomeBroker: 'Rossi' });
    expect(c.subject).toContain('PV-2026-002');
    expect(c.text).toContain('Rossi');
    expect(c.text.toLowerCase()).toContain('distribuzione');
  });

  it('N40: arm RIMESSA_IN_CIRCOLO non mostra l\'indirizzo agenzia', () => {
    const c = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-003', veicoloDescrizione: 'AB123CD', nomeDestinatario: 'Mario',
      ruolo: 'ACQUIRENTE', stato: 'RIMESSA_IN_CIRCOLO',
      agenziaNome: 'NON DEVE COMPARIRE', agenziaIndirizzo: 'Via X', agenziaCitta: 'Roma',
    });
    expect(c.subject).toContain('PV-2026-003');
    expect(c.html).not.toContain('NON DEVE COMPARIRE');
  });
});
```

- [ ] **Step 2: esegui il test — deve fallire**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/templates-revoca.test.ts`
Expected: FAIL (export inesistenti / `'RIMESSA_IN_CIRCOLO'` non assegnabile).

- [ ] **Step 3: estendi `ClienteAvanzamentoStato` + arm N40**

In `templates.ts`, estendi il tipo:

```ts
export type ClienteAvanzamentoStato =
  | 'AVVIATA' | 'PRESA_IN_CARICO' | 'PRONTA_FIRMA' | 'COMPLETATA' | 'ANNULLATA' | 'RIMESSA_IN_CIRCOLO';
```

Nella mappa `M` dentro `tplN40ClienteAvanzamento`, aggiungi (dopo `ANNULLATA`):

```ts
    RIMESSA_IN_CIRCOLO: {
      titolo: 'Aggiornamento sulla tua pratica',
      subject: `Pratica ${p.codicePratica}: aggiornamento`,
      corpo: `stiamo affidando la pratica${veic} a una nuova agenzia della zona per completare ${operazione}. Ti aggiorniamo appena viene presa in carico.`,
    },
```

(`RIMESSA_IN_CIRCOLO` non è in `mostraAgenzia` → nessun indirizzo mostrato: corretto, non c'è agenzia assegnata.)

- [ ] **Step 4: aggiungi i template N50/N51**

In `templates.ts`, in fondo (dopo `tplN40ClienteAvanzamento`), aggiungi:

```ts
export type N50AgenziaRevocataPayload = {
  codicePratica: string;
  targa: string | null;
  nomeAgenzia: string;
  motivo: string | null;
};

export function tplN50AgenziaRevocata(p: N50AgenziaRevocataPayload): NotificaContent {
  const subject = `Gestione revocata — pratica ${p.codicePratica}`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `la gestione della pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} ` +
    `è stata revocata da Passaggio Veloce perché non risultava lavorata.` +
    `${p.motivo ? `\nMotivo: ${p.motivo}` : ''}\n` +
    `La pratica è stata rimessa in distribuzione ad altre agenzie della zona. Non sono richieste altre azioni.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Gestione revocata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la gestione della pratica <strong>${escapeHtml(p.codicePratica)}</strong>${p.targa ? ` (${escapeHtml(p.targa)})` : ''}
      è stata revocata perché non risultava lavorata. La pratica è stata rimessa in distribuzione ad altre agenzie della zona.
    </p>
    ${p.motivo ? `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">Motivo: ${escapeHtml(p.motivo)}</div>` : ''}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Non sono richieste altre azioni.</p>
  `);
  return { subject, html, text };
}

export type N51BrokerRimessaInCircoloPayload = {
  codicePratica: string;
  targa: string | null;
  nomeBroker: string;
};

export function tplN51BrokerRimessaInCircolo(p: N51BrokerRimessaInCircoloPayload): NotificaContent {
  const subject = `Pratica ${p.codicePratica} di nuovo in distribuzione`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata rimessa in distribuzione: ` +
    `l'agenzia che l'aveva presa in carico non l'ha lavorata nei tempi, quindi la stiamo riassegnando ` +
    `a un'altra agenzia della zona. Ti aggiorniamo appena viene accettata.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Pratica di nuovo in distribuzione</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${escapeHtml(p.codicePratica)}</strong>${p.targa ? ` (${escapeHtml(p.targa)})` : ''}
      è stata rimessa in distribuzione: l'agenzia che l'aveva presa in carico non l'ha lavorata nei tempi,
      quindi la stiamo riassegnando a un'altra agenzia della zona.
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Ti aggiorniamo appena viene accettata.</p>
  `);
  return { subject, html, text };
}
```

- [ ] **Step 5: aggiungi gli arm in `send.ts` (union + render + import)**

In `send.ts`, aggiungi i due tpl all'import esistente da `'./templates'` (che già importa gli altri `tplNxx` e i payload). Servono: `tplN50AgenziaRevocata`, `N50AgenziaRevocataPayload`, `tplN51BrokerRimessaInCircolo`, `N51BrokerRimessaInCircoloPayload`.

Nel tipo `SendInput`, dopo l'arm `N49_ADMIN_ATECO_NON_IDONEO`:

```ts
  | { tipo: 'N50_AGENZIA_PRATICA_REVOCATA'; target: Target; payload: N50AgenziaRevocataPayload }
  | { tipo: 'N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO'; target: Target; payload: N51BrokerRimessaInCircoloPayload };
```

(Sposta il `;` finale: l'ultimo arm dell'union chiude con `;`.)

Nello `switch (input.tipo)` di `render`, dopo il `case 'N49_ADMIN_ATECO_NON_IDONEO':`:

```ts
    case 'N50_AGENZIA_PRATICA_REVOCATA':
      return tplN50AgenziaRevocata(input.payload);
    case 'N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO':
      return tplN51BrokerRimessaInCircolo(input.payload);
```

- [ ] **Step 6: esegui il test — deve passare + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/templates-revoca.test.ts`
Expected: PASS (3 test).
Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore (lo `switch` di `render` è esaustivo → i due nuovi arm devono esserci). Se il typecheck segnala uno switch esaustivo su `NotificaTipo` (es. una mappa tipo→label in una pagina admin notifiche), aggiungi le voci N50/N51 con etichette leggibili.

- [ ] **Step 7: commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/send.ts apps/piattaforma/src/lib/notifiche/templates-revoca.test.ts
git commit -m "feat(notifiche): email N50 agenzia revocata + N51 broker + arm N40 rimessa in circolo"
```

---

### Task 7: evento in-app `PRATICA_REVOCATA`

**Files:**
- Modify: `apps/piattaforma/src/lib/eventi/tipi.ts`
- Modify: `apps/piattaforma/src/lib/eventi/pratica-eventi.ts`
- Test: `apps/piattaforma/src/lib/eventi/pratica-eventi.test.ts` (append)

**Interfaces:**
- Produces: `EVENTO.PRATICA_REVOCATA`; `eventoPraticaRevocata({ praticaId, agenziaId, sedeId?, codicePratica }): EventoPraticaInput`.

- [ ] **Step 1: aggiungi il test (fallisce)**

In fondo a `pratica-eventi.test.ts`, aggiungi (adatta l'import in cima al file se `eventoPraticaRevocata` non è ancora importato):

```ts
import { eventoPraticaRevocata } from './pratica-eventi';

describe('eventoPraticaRevocata', () => {
  it('targetizza la sede agenzia revocata, senza CTA', () => {
    const e = eventoPraticaRevocata({ praticaId: 'p1', agenziaId: 'a1', sedeId: 's1', codicePratica: 'PV-1' });
    expect(e.tipo).toBe('PRATICA_REVOCATA');
    expect(e.targetCompanyId).toBe('a1');
    expect(e.targetSedeId).toBe('s1');
    expect(e.testo).toContain('PV-1');
    expect(e.ctaHref).toBeNull();
  });
});
```

- [ ] **Step 2: esegui — deve fallire**

Run: `pnpm --filter piattaforma exec vitest run src/lib/eventi/pratica-eventi.test.ts`
Expected: FAIL (`eventoPraticaRevocata` inesistente / `PRATICA_REVOCATA` non nel tipo).

- [ ] **Step 3: aggiungi la costante evento**

In `tipi.ts`, nell'oggetto `EVENTO`, dopo `PRATICA_ANNULLATA`:

```ts
  PRATICA_ANNULLATA: 'PRATICA_ANNULLATA',
  PRATICA_REVOCATA: 'PRATICA_REVOCATA',
  PRATICA_PENALE: 'PRATICA_PENALE',
```

- [ ] **Step 4: aggiungi il builder**

In `pratica-eventi.ts`, dopo `eventoPraticaAnnullata`:

```ts
/** Admin revoca una pratica accettata-non-lavorata → la sede agenzia revocata lo vede. */
export function eventoPraticaRevocata(args: {
  praticaId: string;
  agenziaId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.agenziaId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_REVOCATA,
    titolo: 'Gestione revocata',
    testo: `La gestione della pratica ${args.codicePratica} è stata revocata perché non risultava lavorata. Non sono richieste altre azioni.`,
    ctaLabel: null,
    ctaHref: null,
  };
}
```

- [ ] **Step 5: esegui — deve passare**

Run: `pnpm --filter piattaforma exec vitest run src/lib/eventi/pratica-eventi.test.ts`
Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add apps/piattaforma/src/lib/eventi/tipi.ts apps/piattaforma/src/lib/eventi/pratica-eventi.ts apps/piattaforma/src/lib/eventi/pratica-eventi.test.ts
git commit -m "feat(eventi): evento in-app PRATICA_REVOCATA per l'agenzia"
```

---

### Task 8: helper puri `giorni-fermi` (conteggio + soglia)

**Files:**
- Create: `apps/piattaforma/src/lib/monitoraggio/giorni-fermi.ts`
- Test: `apps/piattaforma/src/lib/monitoraggio/giorni-fermi.test.ts`

**Interfaces:**
- Produces: `giorniCalendarioTrascorsi(from: Date | null, now: Date): number | null`; `fermaLevel(giorni: number | null): 'ok' | 'warn' | 'urgent'`; costanti `FERMA_SOGLIA_ROSSO = 3`, `FERMA_SOGLIA_AMBRA = 2`.

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `giorni-fermi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { giorniCalendarioTrascorsi, fermaLevel } from './giorni-fermi';

describe('giorniCalendarioTrascorsi', () => {
  it('null se from è null', () => {
    expect(giorniCalendarioTrascorsi(null, new Date('2026-07-17T12:00:00Z'))).toBeNull();
  });
  it('stesso giorno di calendario Roma → 0', () => {
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-17T06:00:00Z'), new Date('2026-07-17T20:00:00Z')),
    ).toBe(0);
  });
  it('conta i confini di mezzanotte, non i periodi di 24h', () => {
    // from = 2026-07-14 (Roma), now = 2026-07-17 (Roma) → 3 giorni di calendario
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-14T12:00:00Z'), new Date('2026-07-17T09:00:00Z')),
    ).toBe(3);
  });
  it('mezzanotte Roma: 23:30Z del 16 è già il 17 a Roma (estate +2)', () => {
    // from Roma 2026-07-17 01:30, now Roma 2026-07-19 10:00 → 2 giorni
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-16T23:30:00Z'), new Date('2026-07-19T08:00:00Z')),
    ).toBe(2);
  });
});

describe('fermaLevel', () => {
  it('rosso a ≥3, ambra a 2, neutro sotto, ok se null', () => {
    expect(fermaLevel(null)).toBe('ok');
    expect(fermaLevel(0)).toBe('ok');
    expect(fermaLevel(1)).toBe('ok');
    expect(fermaLevel(2)).toBe('warn');
    expect(fermaLevel(3)).toBe('urgent');
    expect(fermaLevel(9)).toBe('urgent');
  });
});
```

- [ ] **Step 2: esegui — deve fallire**

Run: `pnpm --filter piattaforma exec vitest run src/lib/monitoraggio/giorni-fermi.test.ts`
Expected: FAIL (import inesistente).

- [ ] **Step 3: implementa**

Crea `giorni-fermi.ts`:

```ts
import { romeYmd } from '@/lib/date/rome-day';

/**
 * Giorni di CALENDARIO (fuso Europe/Rome) trascorsi da `from` a `now`. Conta i
 * confini di mezzanotte a Roma, non i periodi di 24h: una pratica accettata ieri
 * sera è "1 giorno" anche se sono passate 14 ore. 0 lo stesso giorno; null se
 * `from` è null.
 */
export function giorniCalendarioTrascorsi(from: Date | null, now: Date): number | null {
  if (!from) return null;
  const [y1, m1, d1] = romeYmd(from);
  const [y2, m2, d2] = romeYmd(now);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type FermaLevel = 'ok' | 'warn' | 'urgent';

/** Rosso a partire da 3 giorni (spec); ambra come pre-avviso soft a 2. */
export const FERMA_SOGLIA_ROSSO = 3;
export const FERMA_SOGLIA_AMBRA = 2;

export function fermaLevel(giorni: number | null): FermaLevel {
  if (giorni === null) return 'ok';
  if (giorni >= FERMA_SOGLIA_ROSSO) return 'urgent';
  if (giorni >= FERMA_SOGLIA_AMBRA) return 'warn';
  return 'ok';
}
```

- [ ] **Step 4: esegui — deve passare**

Run: `pnpm --filter piattaforma exec vitest run src/lib/monitoraggio/giorni-fermi.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/piattaforma/src/lib/monitoraggio/giorni-fermi.ts apps/piattaforma/src/lib/monitoraggio/giorni-fermi.test.ts
git commit -m "feat(monitoraggio): conteggio giorni-fermi (calendario Roma) + soglia rosso/ambra"
```

---

### Task 9: server action `revocaERimettiInCircoloAction`

**Files:**
- Create: `apps/piattaforma/src/app/admin/monitoraggio/actions.ts`
- Test: `apps/piattaforma/src/app/admin/monitoraggio/actions.test.ts`

**Interfaces:**
- Consumes: `avviaRound`, `processPostCommitJobs` (Task 3); `logCambioStato`, `STATO_EVENTO` (Task 4); `tplN50/N51` via `sendNotification` (Task 6); `eventoPraticaRevocata` (Task 7); `isAdminPiattaforma`; `destinatariSedeAgenzia`, `destinatariBroker`; `notifyClientiAvanzamento`.
- Produces: `revocaERimettiInCircoloAction(praticaId: string, motivo?: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: scrivi il test (fallisce)**

Crea `actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, txMock, transactionMock, avviaRoundMock, postCommitMock,
  sendMock, notifyClientiMock, destSedeMock, destBrokerMock, emitEventoMock, logMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  txMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn(), findMany: vi.fn() },
  },
  transactionMock: vi.fn(),
  avviaRoundMock: vi.fn(),
  postCommitMock: vi.fn(),
  sendMock: vi.fn(),
  notifyClientiMock: vi.fn(),
  destSedeMock: vi.fn(),
  destBrokerMock: vi.fn(),
  emitEventoMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({ prisma: { $transaction: transactionMock } }));
vi.mock('@/lib/distribuzione/tick', () => ({ avviaRound: avviaRoundMock, processPostCommitJobs: postCommitMock }));
vi.mock('@/lib/pratiche/stato-log', () => ({ logCambioStato: logMock, STATO_EVENTO: { RECIRCULATE: 'RECIRCULATE' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock, notifyClientiAvanzamento: notifyClientiMock }));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariSedeAgenzia: destSedeMock, destinatariBroker: destBrokerMock }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: emitEventoMock }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaRevocata: vi.fn(() => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { revocaERimettiInCircoloAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
  txMock.praticaAssegnazione.findMany.mockResolvedValue([{ sedeId: 'sRev', ciclo: 1, esito: 'REVOCATA_ADMIN' }]);
  avviaRoundMock.mockResolvedValue({ count: 2, newAssegnazioniIds: ['n1', 'n2'], escalated: false });
  postCommitMock.mockResolvedValue(undefined);
  destSedeMock.mockResolvedValue([{ email: 'ag@x.it', userId: 'u9', nome: 'Auto MI' }]);
  destBrokerMock.mockResolvedValue([{ email: 'br@x.it', userId: 'u1', nome: 'Rossi' }]);
  sendMock.mockResolvedValue(undefined);
  notifyClientiMock.mockResolvedValue(undefined);
  emitEventoMock.mockResolvedValue(undefined);
});

const praticaAccettata = {
  id: 'p1', stato: 'ACCETTATA', provincia: 'MI', processataAt: null, distribuzioneCiclo: 1,
  agenziaAssegnataId: 'aRev', agenziaSedeId: 'sRev', brokerId: 'bMadre', codicePratica: 'PV-2026-1',
  veicoli: [{ targa: 'AB123CD' }],
};

describe('revocaERimettiInCircoloAction', () => {
  it('rifiuta i non super-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'x', role: 'ASSISTENTE' } });
    const res = await revocaERimettiInCircoloAction('p1', 'x');
    expect(res.ok).toBe(false);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rifiuta se la pratica non è accettata/non lavorata', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue({ ...praticaAccettata, stato: 'PROCESSATA' });
    const res = await revocaERimettiInCircoloAction('p1');
    expect(res.ok).toBe(false);
  });

  it('happy path: revoca, riavvia e invia le notifiche', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue(praticaAccettata);

    const res = await revocaERimettiInCircoloAction('p1', 'ferma da giorni');

    expect(res.ok).toBe(true);
    // assegnazione vincente → REVOCATA_ADMIN
    expect(txMock.praticaAssegnazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { praticaId: 'p1', ciclo: 1, esito: 'ACCETTATA' },
        data: expect.objectContaining({ esito: 'REVOCATA_ADMIN' }),
      }),
    );
    // pratica sganciata + ciclo incrementato
    expect(txMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ agenziaAssegnataId: null, distribuzioneCiclo: 2, accettataAt: null }),
      }),
    );
    expect(avviaRoundMock).toHaveBeenCalled();
    expect(logMock).toHaveBeenCalled();
    // N50 all'agenzia + N51 al broker + clienti + evento
    const tipiInviati = sendMock.mock.calls.map((c) => c[0].tipo);
    expect(tipiInviati).toContain('N50_AGENZIA_PRATICA_REVOCATA');
    expect(tipiInviati).toContain('N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO');
    expect(notifyClientiMock).toHaveBeenCalledWith('p1', 'RIMESSA_IN_CIRCOLO');
    expect(emitEventoMock).toHaveBeenCalled();
    expect(postCommitMock).toHaveBeenCalledWith({ newAssegnazioniIds: ['n1', 'n2'], escalationPraticaId: null });
  });
});
```

- [ ] **Step 2: esegui — deve fallire**

Run: `pnpm --filter piattaforma exec vitest run src/app/admin/monitoraggio/actions.test.ts`
Expected: FAIL (import inesistente).

- [ ] **Step 3: implementa la action**

Crea `actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { avviaRound, processPostCommitJobs } from '@/lib/distribuzione/tick';
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariSedeAgenzia, destinatariBroker } from '@/lib/notifiche/pratica';
import { emitEventoPratica } from '@/lib/eventi/emit';
import { eventoPraticaRevocata } from '@/lib/eventi/pratica-eventi';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

export type RevocaResult = { ok: true } | { ok: false; error: string };

/**
 * Revoca una pratica accettata-non-lavorata e la rimette in distribuzione:
 * sgancia l'agenzia (esito REVOCATA_ADMIN, esclusione permanente), incrementa il
 * ciclo e riavvia il round 1 sulla zona. Poi informa agenzia revocata, broker e
 * clienti. Best-effort per email/eventi. Solo super-admin.
 */
export async function revocaERimettiInCircoloAction(
  praticaId: string,
  motivo?: string,
): Promise<RevocaResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo il super-admin può revocare una pratica' };
  }
  const motivoPulito = motivo?.trim() || null;
  const adminId = session.user.id;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        select: {
          id: true,
          stato: true,
          provincia: true,
          processataAt: true,
          distribuzioneCiclo: true,
          agenziaAssegnataId: true,
          agenziaSedeId: true,
          brokerId: true,
          codicePratica: true,
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.stato !== 'ACCETTATA' || pratica.processataAt !== null) {
        throw new Error('La pratica non è in stato accettato/non lavorato');
      }

      const revokedSedeId = pratica.agenziaSedeId;
      const revokedCompanyId = pratica.agenziaAssegnataId;
      const nuovoCiclo = pratica.distribuzioneCiclo + 1;

      // 1) l'assegnazione vincente del ciclo corrente → revocata (esclusione permanente)
      await tx.praticaAssegnazione.updateMany({
        where: { praticaId, ciclo: pratica.distribuzioneCiclo, esito: 'ACCETTATA' },
        data: { esito: 'REVOCATA_ADMIN', esitoAt: new Date(), notaRifiuto: motivoPulito },
      });

      // 2) sgancia l'agenzia e apri il nuovo ciclo (lo stato lo imposta avviaRound)
      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          agenziaAssegnataId: null,
          agenziaSedeId: null,
          accettataAt: null,
          accettataDaUserId: null,
          distribuzioneCiclo: nuovoCiclo,
          round1StartedAt: null,
          round2StartedAt: null,
          round3StartedAt: null,
          escalationAt: null,
        },
      });

      // 3) ricarica le assegnazioni (incl. la REVOCATA_ADMIN appena scritta)
      const assegnazioni = await tx.praticaAssegnazione.findMany({
        where: { praticaId },
        select: { sedeId: true, ciclo: true, esito: true },
      });

      // 4) riparti dal round 1 sul nuovo ciclo: ricontatta la zona, esclude la revocata
      const r = await avviaRound(
        tx,
        { id: praticaId, provincia: pratica.provincia, distribuzioneCiclo: nuovoCiclo, assegnazioni },
        1,
      );

      await logCambioStato(tx, {
        praticaId,
        statoDa: 'ACCETTATA',
        statoA: r.escalated ? 'IN_ESCALATION' : 'IN_ATTESA_ROUND_1',
        tipoEvento: STATO_EVENTO.RECIRCULATE,
        attoreUserId: adminId,
        motivo: motivoPulito,
        meta: { ciclo: nuovoCiclo, revokedSedeId, round: 1, escalated: r.escalated },
      });

      const targa = pratica.veicoli[0]?.targa
        ? pratica.veicoli.length > 1
          ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
          : pratica.veicoli[0].targa
        : null;

      return {
        newAssegnazioniIds: r.newAssegnazioniIds,
        escalated: r.escalated,
        revokedSedeId,
        revokedCompanyId,
        brokerId: pratica.brokerId,
        codicePratica: pratica.codicePratica,
        targa,
      };
    });

    // 5) N6 + popup alle nuove sedi in zona (la revocata è esclusa a monte)
    await processPostCommitJobs({
      newAssegnazioniIds: outcome.newAssegnazioniIds,
      escalationPraticaId: outcome.escalated ? praticaId : null,
    }).catch(() => undefined);

    // 6) email + evento all'agenzia revocata
    if (outcome.revokedSedeId && outcome.revokedCompanyId && outcome.codicePratica) {
      const destinatari = await destinatariSedeAgenzia(outcome.revokedSedeId).catch(() => []);
      for (const d of destinatari) {
        await sendNotification({
          tipo: 'N50_AGENZIA_PRATICA_REVOCATA',
          target: { email: d.email, userId: d.userId, companyId: outcome.revokedCompanyId },
          payload: {
            codicePratica: outcome.codicePratica,
            targa: outcome.targa,
            nomeAgenzia: d.nome,
            motivo: motivoPulito,
          },
        }).catch(() => undefined);
      }
      await emitEventoPratica(
        prisma,
        eventoPraticaRevocata({
          praticaId,
          agenziaId: outcome.revokedCompanyId,
          sedeId: outcome.revokedSedeId,
          codicePratica: outcome.codicePratica,
        }),
      ).catch(() => undefined);
    }

    // 7) email al broker
    if (outcome.codicePratica) {
      const destinatariB = await destinatariBroker(praticaId).catch(() => []);
      for (const d of destinatariB) {
        await sendNotification({
          tipo: 'N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO',
          target: { email: d.email, userId: d.userId, companyId: outcome.brokerId },
          payload: { codicePratica: outcome.codicePratica, targa: outcome.targa, nomeBroker: d.nome },
        }).catch(() => undefined);
      }
    }

    // 8) email a venditori + acquirenti
    await notifyClientiAvanzamento(praticaId, 'RIMESSA_IN_CIRCOLO').catch(() => undefined);

    revalidatePath('/admin/monitoraggio');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Errore sconosciuto' };
  }
}
```

- [ ] **Step 4: esegui il test — deve passare + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/app/admin/monitoraggio/actions.test.ts`
Expected: PASS (3 test).
Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 5: commit**

```bash
git add apps/piattaforma/src/app/admin/monitoraggio/actions.ts apps/piattaforma/src/app/admin/monitoraggio/actions.test.ts
git commit -m "feat(monitoraggio): action revoca + ricircolo (ciclo, storico, email N50/N51/N40, evento)"
```

---

### Task 10: pagina `/admin/monitoraggio` + modale + nav + icona

**Files:**
- Create: `apps/piattaforma/src/app/admin/monitoraggio/page.tsx`
- Create: `apps/piattaforma/src/app/admin/monitoraggio/revoca-button.tsx`
- Modify: `apps/piattaforma/src/components/admin/admin-shell.tsx`
- Modify: `apps/piattaforma/src/components/admin/admin-icons.tsx`

**Interfaces:**
- Consumes: `revocaERimettiInCircoloAction` (Task 9); `giorniCalendarioTrascorsi`, `fermaLevel` (Task 8).

- [ ] **Step 1: aggiungi l'icona**

In `admin-icons.tsx`, dopo `IconEscalation` (o accanto alle altre), aggiungi:

```tsx
export function IconMonitoraggio({ className }: AdminIconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}
```

- [ ] **Step 2: aggiungi la voce di nav (super-admin)**

In `admin-shell.tsx`, aggiungi `IconMonitoraggio` all'import da `./admin-icons`, poi nel gruppo `Operatività` di `NAV_GROUPS`, dopo la voce Escalation:

```tsx
      { href: '/admin/escalation', label: 'Escalation', icon: IconEscalation },
      { href: '/admin/monitoraggio', label: 'Monitoraggio', icon: IconMonitoraggio, adminOnly: true },
```

- [ ] **Step 3: crea il client component modale**

Crea `revoca-button.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revocaERimettiInCircoloAction } from './actions';

export function RevocaButton({
  praticaId,
  codicePratica,
  agenzia,
}: {
  praticaId: string;
  codicePratica: string;
  agenzia: string;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function conferma() {
    setError(null);
    startTransition(async () => {
      const res = await revocaERimettiInCircoloAction(praticaId, motivo);
      if (res.ok) {
        setOpen(false);
        setMotivo('');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-pv-red-500 hover:bg-pv-red-50"
      >
        Revoca
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-[var(--pv-shadow-card)]">
            <h2 className="text-[18px] font-bold text-pv-navy-900">Revoca e rimetti in circolo</h2>
            <p className="mt-2 text-[13px] text-pv-slate-600">
              Stai per togliere <strong>{codicePratica}</strong> a <strong>{agenzia}</strong> e rimetterla in
              distribuzione nella zona. L&apos;agenzia riceverà una email e non verrà più ricontattata per questa
              pratica. Broker e clienti saranno informati.
            </p>
            <label htmlFor="motivo-revoca" className="mt-4 block text-[12px] font-semibold text-pv-slate-700">
              Nota (opzionale)
            </label>
            <textarea
              id="motivo-revoca"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-[10px] border border-pv-slate-300 p-2 text-[13px]"
              placeholder="Es. agenzia non risponde da giorni"
            />
            {error && <p className="mt-2 text-[12px] text-pv-red-500">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50 disabled:opacity-60"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={conferma}
                className="rounded-[10px] bg-pv-red-500 px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {pending ? 'Revoca in corso…' : 'Conferma revoca'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: crea la pagina server**

Crea `page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { TipoPraticaChip } from '@/components/ui';
import { SedeCell } from '@/components/sede/sede-cell';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { giorniCalendarioTrascorsi, fermaLevel } from '@/lib/monitoraggio/giorni-fermi';
import { RevocaButton } from './revoca-button';

const GRID = 'grid-cols-[1.3fr_0.9fr_1.1fr_1.4fr_0.7fr_0.9fr]';

export default async function MonitoraggioPage() {
  const session = await auth();
  if (!isAdminPiattaforma(session?.user?.role)) redirect('/admin/pratiche');

  const pratiche = await prisma.pratica.findMany({
    where: { stato: 'ACCETTATA', processataAt: null, deletedAt: null },
    orderBy: { accettataAt: 'asc' },
    include: {
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
      agenziaSede: { select: { nome: true, citta: true, telefono: true } },
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
    },
  });

  const now = new Date();

  return (
    <AppShell session={session!} activePath="/admin/monitoraggio">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Monitoraggio pratiche ferme
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {pratiche.length} pratic{pratiche.length === 1 ? 'a' : 'he'} accettat
            {pratiche.length === 1 ? 'a' : 'e'} ma non ancora lavorat{pratiche.length === 1 ? 'a' : 'e'}.
            In rosso quelle ferme da 3 giorni o più.
          </p>
        </header>

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {pratiche.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica ferma. 🎉</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[880px] text-[13px]">
                <div
                  className={`grid ${GRID} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="px-3 py-3">Broker</div>
                  <div className="px-3 py-3">Agenzia · Sede</div>
                  <div className="px-3 py-3 text-right">Ferma da</div>
                  <div className="py-3 pl-3 pr-5 text-right">Azione</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {pratiche.map((p) => {
                    const giorni = giorniCalendarioTrascorsi(p.accettataAt, now);
                    const level = fermaLevel(giorni);
                    const rowTone = level === 'urgent' ? 'bg-pv-red-50' : level === 'warn' ? 'bg-pv-amber-50' : '';
                    const badgeTone =
                      level === 'urgent'
                        ? 'bg-pv-red-50 text-pv-red-500'
                        : level === 'warn'
                          ? 'bg-pv-amber-50 text-pv-amber-500'
                          : 'bg-pv-slate-100 text-pv-slate-700';
                    const targa = p.veicoli[0]?.targa
                      ? p.veicoli.length > 1
                        ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                        : p.veicoli[0].targa
                      : '—';
                    return (
                      <div key={p.id} className={`grid ${GRID} items-center ${rowTone}`}>
                        <div className="min-w-0 py-3 pl-5 pr-3">
                          <Link
                            href={`/pratiche/${p.id}`}
                            className="block truncate font-mono font-semibold text-pv-navy-800 hover:underline"
                          >
                            {p.codicePratica ?? 'BOZZA'}
                          </Link>
                          <TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} className="mt-1" />
                        </div>
                        <div className="min-w-0 truncate px-3 py-3">{targa}</div>
                        <div className="min-w-0 truncate px-3 py-3 text-pv-slate-700">{p.broker.ragioneSociale}</div>
                        <div className="min-w-0 px-3 py-3">
                          <SedeCell sede={p.agenziaSede} agenzia={p.agenziaAssegnata?.ragioneSociale} />
                        </div>
                        <div className="px-3 py-3 text-right">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold ${badgeTone}`}>
                            {giorni === null ? '—' : giorni === 0 ? 'oggi' : `${giorni} g`}
                          </span>
                        </div>
                        <div className="py-3 pl-3 pr-5 text-right">
                          <RevocaButton
                            praticaId={p.id}
                            codicePratica={p.codicePratica ?? 'questa pratica'}
                            agenzia={p.agenziaSede?.nome ?? p.agenziaAssegnata?.ragioneSociale ?? "l'agenzia"}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: typecheck + build**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.
Run: `pnpm --filter piattaforma build`
Expected: build ok, la route `/admin/monitoraggio` compare nell'output.

- [ ] **Step 6: commit**

```bash
git add apps/piattaforma/src/app/admin/monitoraggio/page.tsx apps/piattaforma/src/app/admin/monitoraggio/revoca-button.tsx apps/piattaforma/src/components/admin/admin-shell.tsx apps/piattaforma/src/components/admin/admin-icons.tsx
git commit -m "feat(monitoraggio): pagina /admin/monitoraggio + modale revoca + voce nav"
```

---

### Task 11: verifica end-to-end (browser, super-admin)

**Files:** nessuno (checkpoint di verifica).

**Interfaces:**
- Consumes: tutta la feature.

- [ ] **Step 1: suite completa + typecheck**

Run: `pnpm --filter piattaforma test`
Expected: PASS (inclusi esclusioni, stato-log, templates-revoca, pratica-eventi, giorni-fermi, actions).
Run: `pnpm --filter piattaforma typecheck` e `pnpm --filter @pv/db typecheck`
Expected: nessun errore.

- [ ] **Step 2: prepara uno stato di test sul DB locale**

Con una query read-only + un update mirato sul DB locale (copia di prod), porta una pratica in `stato='ACCETTATA'`, `processataAt IS NULL`, con `accettataAt` indietro di 3+ giorni, e annota `agenziaSedeId`/`agenziaAssegnataId`. (Esegui prima la SELECT per scegliere una pratica reale con assegnazione ciclo 1 `ACCETTATA`.)

- [ ] **Step 3: verifica nel browser (gesto utente reale)**

Avvia l'app (`pnpm --filter piattaforma dev`), login come super-admin (`ADMIN_PIATTAFORMA`). Verifica:
1. la voce **Monitoraggio** compare nella sidebar admin (e NON per un ASSISTENTE);
2. `/admin/monitoraggio` lista la pratica con badge **rosso** (≥3 g);
3. click su **Revoca** → modale → **Conferma revoca**: la riga sparisce dalla lista (la pratica è tornata in distribuzione);
4. a DB: `SELECT * FROM pratica_stato_log WHERE "praticaId"=...` mostra la riga `ACCETTATA → IN_ATTESA_ROUND_1` con `meta.tipoEvento='RECIRCULATE'`; l'assegnazione vecchia è `REVOCATA_ADMIN`; `distribuzioneCiclo=2`; esistono nuove `pratiche_assegnazioni` con `ciclo=2` che **non** includono la sede revocata;
5. i log email (provider console/Resend) mostrano N50 all'agenzia, N51 al broker, N40 a venditori/acquirenti, N6 alle nuove sedi.

Verifica DOM/gesto reale (non navigazione per URL): il click sul bottone e la conferma devono innescare l'azione e il refresh.

- [ ] **Step 4: aggiorna la memoria di progetto**

Dopo la verifica, aggiorna `project_*` con lo stato "implementato su main, NON deployato (serve migration Neon)". Ricorda: il deploy richiede la migration a mano su Neon prod + `db:deploy`, poi push su main.

---

## Note di deploy (fuori dal ciclo di sviluppo)

- La feature introduce una **migration** → NON è deployabile con il solo push. Applicare `20260717130000_monitoraggio_revoca_ricircolo` su Neon prod a mano (`prisma migrate deploy` con `DATABASE_URL`/`DIRECT_URL` prod), poi push su `main`.
- Nessuna nuova env var richiesta.
- N50/N51 sono transazionali: nessuna voce nelle preferenze notifiche.
