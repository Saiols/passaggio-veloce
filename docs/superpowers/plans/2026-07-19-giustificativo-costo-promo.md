# Giustificativo interno costo promo ("Documento 2") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generare, al payout che incassa un bonus promozionale, un giustificativo interno di costo (art. 108 TUIR) separato dalla fattura conto terzi, con pagina admin e export CSV per il commercialista.

**Architecture:** Nuova tabella `GiustificativoInterno` (one-sided, nessuna controparte, fuori SdI), popolata da un engine best-effort/idempotente `createGiustificativoPromo` chiamato dentro `settlePayout` subito dopo `createDocBroker`. Le righe `CREDITO_PROMO` vengono agganciate al payout (via `payoutId`) per la tracciabilità; `createDocBroker` resta invariato perché filtra già per tipo compenso. Numerazione interna riusa `prossimoContatore` con un nuovo `ContatoreFiscaleTipo`. Superficie admin: pagina `/admin/costi-promozionali` + route CSV, filtri date condivisi in un unico modulo.

**Tech Stack:** Next.js 16 (App Router, RSC), Prisma + Postgres (locale = copia prod PG17), TypeScript, Vitest, pnpm/Turborepo.

## Global Constraints

- Node: eseguire `nvm use 22.15.0` prima di ogni comando pnpm (pnpm richiede ≥18).
- Migration: **mai** `pnpm db:migrate` (= `prisma migrate dev`, distruttivo: propone DROP SEQUENCE). Migration **a mano** (file SQL) + `pnpm --filter @pv/db db:deploy` (= `prisma migrate deploy`) sul DB **locale**. Il `.env` di `packages/db` (DIRECT_URL locale) vince sulla shell.
- Dopo ogni modifica a `schema.prisma`: `pnpm db:generate` per rigenerare il client Prisma.
- Test: `pnpm --filter piattaforma test <path>` (= `vitest run`). Vitest **non** fa typecheck.
- Typecheck a cache fredda è rotto (stack overflow / falsi errori Prisma): affidarsi ai test + review; lanciare `pnpm --filter piattaforma typecheck` solo se la cache è calda.
- **Non pushare**: `main` è molti commit avanti e include lavoro non pronto (visura) → `push` deploierebbe tutto. Solo commit locali. La migration su Neon prod NON fa parte di questo lavoro.
- Importi sempre in centesimi (`Int`, suffisso `Cent`). Colori solo dal design system (`components/ui`), mai hardcoded.
- Il giustificativo **non** va allo SdI e **non** deve mai comparire nelle pagine fatturazione lato broker/agenzia (è una tabella separata: nessun consumer di `DocumentoFiscale` lo vede).

---

## File Structure

- `packages/db/prisma/schema.prisma` — modello `GiustificativoInterno`, enum `GiustificativoInternoTipo`, valore `ContatoreFiscaleTipo.GIUSTIFICATIVO_INTERNO`, back-relation su `Payout` e `Company`.
- `packages/db/prisma/migrations/20260719120000_giustificativo_costo_promo/migration.sql` — migration a mano.
- `apps/piattaforma/src/lib/fatturazione/format.ts` — helper `numeroGiustificativo`.
- `apps/piattaforma/src/lib/fatturazione/giustificativo-filtri.ts` — parse + where filtri date (fonte unica per pagina + CSV).
- `apps/piattaforma/src/lib/fatturazione/giustificativo-promo.ts` — engine `createGiustificativoPromo`.
- `apps/piattaforma/src/lib/wallet/payout-exec.ts` — aggancio `CREDITO_PROMO` + chiamata engine.
- `apps/piattaforma/src/app/admin/costi-promozionali/page.tsx` — pagina admin.
- `apps/piattaforma/src/app/api/admin/costi-promozionali/export/route.ts` — export CSV.
- Test affiancati: `format.test.ts` (esteso), `giustificativo-filtri.test.ts`, `giustificativo-promo.test.ts`, `payout-exec.test.ts` (esteso), `export/route.test.ts`.

---

## Task 1: Schema + migration + client Prisma

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (enum `ContatoreFiscaleTipo` ~2186; modello `Payout` :1356; modello `Company` relations ~478; in coda ai modelli wallet)
- Create: `packages/db/prisma/migrations/20260719120000_giustificativo_costo_promo/migration.sql`

**Interfaces:**
- Produces: modello Prisma `GiustificativoInterno` (client: `prisma.giustificativoInterno`), enum `GiustificativoInternoTipo` (`COSTO_PROMO`), valore enum `ContatoreFiscaleTipo.GIUSTIFICATIVO_INTERNO`.

- [ ] **Step 1: Aggiungere l'enum e il modello a `schema.prisma`**

Aggiungere il valore all'enum esistente (`ContatoreFiscaleTipo`, ~riga 2186):

```prisma
enum ContatoreFiscaleTipo {
  FATTURA_PV
  DOC_BROKER
  NOTA_CREDITO
  PENALE
  GIUSTIFICATIVO_INTERNO
}
```

Aggiungere il nuovo enum e modello (vicino ai modelli wallet/pagamenti, es. dopo `model DocumentoFiscale { … }`):

```prisma
enum GiustificativoInternoTipo {
  COSTO_PROMO
}

/// Giustificativo interno di costo (art. 108 TUIR) — NON fiscale, NON SdI.
/// Documenta il bonus promozionale incassato in un payout ("Documento 2").
model GiustificativoInterno {
  id   String                    @id @default(uuid()) @db.Uuid
  tipo GiustificativoInternoTipo @default(COSTO_PROMO)

  // Numerazione interna progressiva (registro "GI", reset annuale) — separata
  // dal registro fiscale (ContatoreFiscale, idSoggetto "PV").
  numeroProgressivo Int
  anno              Int
  numeroStr         String @unique // es. "GI-2026-00001"

  importoCent Int    // sempre positivo (costo promozionale erogato)
  causale     String

  payoutId String @unique @db.Uuid
  payout   Payout @relation(fields: [payoutId], references: [id])

  beneficiarioCompanyId String?  @db.Uuid
  beneficiarioCompany   Company? @relation("GiustificativiPromo", fields: [beneficiarioCompanyId], references: [id])
  datiBeneficiario      Json     // snapshot immutabile (ragione sociale, p.iva…)

  righe Json // [{ code, dataIscrizione, amountCent, redemptionId }]

  emessoAt  DateTime @default(now())
  createdAt DateTime @default(now())

  @@unique([anno, numeroProgressivo])
  @@map("giustificativi_interni")
}
```

Aggiungere la back-relation su `Payout` (dopo `documentoFiscale DocumentoFiscale?`, riga 1356):

```prisma
  documentoFiscale DocumentoFiscale?
  giustificativoInterno GiustificativoInterno?
```

Aggiungere la back-relation su `Company` (nel blocco relazioni della Company, es. accanto a `promoRedemptions`):

```prisma
  giustificativiPromo GiustificativoInterno[] @relation("GiustificativiPromo")
```

- [ ] **Step 2: Scrivere la migration a mano**

Creare `packages/db/prisma/migrations/20260719120000_giustificativo_costo_promo/migration.sql`:

```sql
-- AlterEnum: nuovo registro di numerazione interna
ALTER TYPE "ContatoreFiscaleTipo" ADD VALUE 'GIUSTIFICATIVO_INTERNO';

-- CreateEnum
CREATE TYPE "GiustificativoInternoTipo" AS ENUM ('COSTO_PROMO');

-- CreateTable
CREATE TABLE "giustificativi_interni" (
    "id" UUID NOT NULL,
    "tipo" "GiustificativoInternoTipo" NOT NULL DEFAULT 'COSTO_PROMO',
    "numeroProgressivo" INTEGER NOT NULL,
    "anno" INTEGER NOT NULL,
    "numeroStr" TEXT NOT NULL,
    "importoCent" INTEGER NOT NULL,
    "causale" TEXT NOT NULL,
    "payoutId" UUID NOT NULL,
    "beneficiarioCompanyId" UUID,
    "datiBeneficiario" JSONB NOT NULL,
    "righe" JSONB NOT NULL,
    "emessoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "giustificativi_interni_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "giustificativi_interni_numeroStr_key" ON "giustificativi_interni"("numeroStr");
CREATE UNIQUE INDEX "giustificativi_interni_payoutId_key" ON "giustificativi_interni"("payoutId");
CREATE UNIQUE INDEX "giustificativi_interni_anno_numeroProgressivo_key" ON "giustificativi_interni"("anno", "numeroProgressivo");

-- AddForeignKey
ALTER TABLE "giustificativi_interni" ADD CONSTRAINT "giustificativi_interni_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "giustificativi_interni" ADD CONSTRAINT "giustificativi_interni_beneficiarioCompanyId_fkey" FOREIGN KEY ("beneficiarioCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Nota: su PG12+ `ALTER TYPE … ADD VALUE` è ammesso in transazione perché il valore NON viene usato nella stessa migration. Se `db:deploy` dovesse comunque protestare, spostare la sola riga `ALTER TYPE` in una migration precedente a sé stante.

- [ ] **Step 3: Applicare la migration in locale e rigenerare il client**

Run:
```bash
nvm use 22.15.0
pnpm --filter @pv/db db:deploy
pnpm db:generate
```
Expected: `db:deploy` stampa `Applying migration 20260719120000_giustificativo_costo_promo` e termina senza errori; `db:generate` rigenera il client (`✔ Generated Prisma Client`).

- [ ] **Step 4: Smoke check del client generato**

Run:
```bash
node -e "const{PrismaClient}=require('./node_modules/@prisma/client');console.log('giustificativoInterno' in new PrismaClient())"
```
Expected: `true` (il delegate del nuovo modello esiste sul client).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260719120000_giustificativo_costo_promo/
git commit -m "feat(db): modello GiustificativoInterno + registro numerazione GI"
```

---

## Task 2: Helper numero `numeroGiustificativo`

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/format.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/format.test.ts`

**Interfaces:**
- Produces: `numeroGiustificativo(anno: number, numeroProgressivo: number): string` → `"GI-<anno>-<5 cifre>"`.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in `format.test.ts`:

```ts
import { numeroGiustificativo } from './format';

describe('numeroGiustificativo', () => {
  it('formatta GI-<anno>-<5 cifre>', () => {
    expect(numeroGiustificativo(2026, 1)).toBe('GI-2026-00001');
    expect(numeroGiustificativo(2026, 47)).toBe('GI-2026-00047');
  });
});
```

- [ ] **Step 2: Lanciare il test → deve fallire**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/format.test.ts`
Expected: FAIL con `numeroGiustificativo is not a function` (o errore di import).

- [ ] **Step 3: Implementare l'helper**

In `format.ts`, sotto `numeroDocumento` (riusa la `pad` locale già presente):

```ts
/** Numero del giustificativo interno (registro "GI"): GI-<anno>-<5 cifre>. */
export function numeroGiustificativo(anno: number, numeroProgressivo: number): string {
  return `GI-${anno}-${pad(numeroProgressivo, 5)}`;
}
```

- [ ] **Step 4: Lanciare il test → deve passare**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/format.ts apps/piattaforma/src/lib/fatturazione/format.test.ts
git commit -m "feat(fatturazione): helper numeroGiustificativo"
```

---

## Task 3: Modulo filtri condiviso `giustificativo-filtri.ts`

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/giustificativo-filtri.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/giustificativo-filtri.test.ts`

**Interfaces:**
- Produces:
  - `type GiustificativoFiltri = { dataDa: string | null; dataA: string | null }`
  - `parseGiustificativoFiltri(sp: { dataDa?: string; dataA?: string }): GiustificativoFiltri`
  - `parseGiustificativoFiltriFromUrl(url: URL): GiustificativoFiltri`
  - `giustificativoWhere(f: GiustificativoFiltri): Prisma.GiustificativoInternoWhereInput`

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `giustificativo-filtri.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseGiustificativoFiltri,
  parseGiustificativoFiltriFromUrl,
  giustificativoWhere,
} from './giustificativo-filtri';

describe('parseGiustificativoFiltri', () => {
  it('normalizza le date valide, scarta le invalide', () => {
    expect(parseGiustificativoFiltri({ dataDa: ' 2026-06-01 ', dataA: 'nope' })).toEqual({
      dataDa: '2026-06-01',
      dataA: null,
    });
  });
});

describe('giustificativoWhere', () => {
  it('nessun filtro → {}', () => {
    expect(giustificativoWhere(parseGiustificativoFiltri({}))).toEqual({});
  });

  it('intervallo → emessoAt gte/lte (UTC)', () => {
    expect(giustificativoWhere(parseGiustificativoFiltri({ dataDa: '2026-06-01', dataA: '2026-06-30' }))).toEqual({
      emessoAt: {
        gte: new Date('2026-06-01T00:00:00.000Z'),
        lte: new Date('2026-06-30T23:59:59.999Z'),
      },
    });
  });
});

describe('parseGiustificativoFiltriFromUrl', () => {
  it('legge le chiavi dall’URL', () => {
    const url = new URL('http://x/api?dataDa=2026-06-01&dataA=2026-06-30&pippo=1');
    expect(parseGiustificativoFiltriFromUrl(url)).toEqual({ dataDa: '2026-06-01', dataA: '2026-06-30' });
  });
});
```

- [ ] **Step 2: Lanciare il test → deve fallire**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/giustificativo-filtri.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementare il modulo**

Creare `giustificativo-filtri.ts`:

```ts
import type { Prisma } from '@pv/db';

export type GiustificativoFiltri = { dataDa: string | null; dataA: string | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function normDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return ISO_DATE.test(s) ? s : null;
}

export function parseGiustificativoFiltri(sp: { dataDa?: string; dataA?: string }): GiustificativoFiltri {
  return { dataDa: normDate(sp.dataDa), dataA: normDate(sp.dataA) };
}

export function parseGiustificativoFiltriFromUrl(url: URL): GiustificativoFiltri {
  return parseGiustificativoFiltri({
    dataDa: url.searchParams.get('dataDa') ?? undefined,
    dataA: url.searchParams.get('dataA') ?? undefined,
  });
}

export function giustificativoWhere(f: GiustificativoFiltri): Prisma.GiustificativoInternoWhereInput {
  if (!f.dataDa && !f.dataA) return {};
  const emessoAt: Prisma.DateTimeFilter = {};
  if (f.dataDa) emessoAt.gte = new Date(`${f.dataDa}T00:00:00.000Z`);
  if (f.dataA) emessoAt.lte = new Date(`${f.dataA}T23:59:59.999Z`);
  return { emessoAt };
}
```

- [ ] **Step 4: Lanciare il test → deve passare**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/giustificativo-filtri.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/giustificativo-filtri.ts apps/piattaforma/src/lib/fatturazione/giustificativo-filtri.test.ts
git commit -m "feat(fatturazione): filtri date condivisi per giustificativi interni"
```

---

## Task 4: Engine `createGiustificativoPromo`

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/giustificativo-promo.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/giustificativo-promo.test.ts`

**Interfaces:**
- Consumes: `prisma.giustificativoInterno`, `prossimoContatore` (Task nessuno — già esistente), `numeroGiustificativo` (Task 2), `snapshotCompany` (esistente).
- Produces: `createGiustificativoPromo(input: { payoutId: string }): Promise<void>` — idempotente per `payoutId`, best-effort (i chiamanti la avvolgono in `.catch`).

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `giustificativo-promo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, txMock, prossimoContatoreMock } = vi.hoisted(() => {
  const txMock = {
    giustificativoInterno: { findFirst: vi.fn(), create: vi.fn() },
    payout: { findUnique: vi.fn() },
    promoCodeRedemption: { findMany: vi.fn() },
  };
  return {
    txMock,
    prossimoContatoreMock: vi.fn(),
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./numerazione', () => ({ prossimoContatore: prossimoContatoreMock }));
vi.mock('./pv-emittente', () => ({
  snapshotCompany: (c: { id: string; ragioneSociale: string }) => ({ ragioneSociale: c.ragioneSociale }),
}));
vi.mock('@/lib/format', () => ({ formatDate: () => '10/07/2026' }));

import { createGiustificativoPromo } from './giustificativo-promo';

const ANNO = new Date().getFullYear();

function payoutConPromo(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    eseguitoAt: new Date('2026-07-10T10:00:00.000Z'),
    wallet: { sede: { company: { id: 'c1', ragioneSociale: 'Rossi Auto' } }, company: null },
    transazioni: [
      { id: 't1', tipo: 'CREDITO_PROMO', importoCent: 20_000 },
      { id: 't2', tipo: 'CREDITO_PRATICA', importoCent: 30_000 },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.giustificativoInterno.findFirst.mockResolvedValue(null);
  txMock.payout.findUnique.mockResolvedValue(payoutConPromo());
  txMock.promoCodeRedemption.findMany.mockResolvedValue([
    { id: 'r1', amountCent: 20_000, createdAt: new Date('2026-07-01T09:00:00.000Z'), promoCode: { code: 'WELCOME' } },
  ]);
  txMock.giustificativoInterno.create.mockResolvedValue({});
  prossimoContatoreMock.mockResolvedValue(1);
});

describe('createGiustificativoPromo', () => {
  it('somma il promo del payout e crea il giustificativo con righe dal redemption', async () => {
    await createGiustificativoPromo({ payoutId: 'p1' });

    expect(prossimoContatoreMock).toHaveBeenCalledWith(txMock, 'PV', 'GIUSTIFICATIVO_INTERNO', ANNO);
    expect(txMock.giustificativoInterno.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'COSTO_PROMO',
          importoCent: 20_000,
          numeroStr: `GI-${ANNO}-00001`,
          payoutId: 'p1',
          beneficiarioCompanyId: 'c1',
          causale: 'Bonus promozionale iscrizione — Rossi Auto — 10/07/2026',
          righe: [
            { code: 'WELCOME', dataIscrizione: '2026-07-01T09:00:00.000Z', amountCent: 20_000, redemptionId: 'r1' },
          ],
        }),
      }),
    );
  });

  it('payout senza promo → nessun giustificativo', async () => {
    txMock.payout.findUnique.mockResolvedValue(
      payoutConPromo({ transazioni: [{ id: 't2', tipo: 'CREDITO_PRATICA', importoCent: 30_000 }] }),
    );
    await createGiustificativoPromo({ payoutId: 'p1' });
    expect(txMock.giustificativoInterno.create).not.toHaveBeenCalled();
  });

  it('idempotente: se esiste già per il payout → non ricrea', async () => {
    txMock.giustificativoInterno.findFirst.mockResolvedValue({ id: 'g-esistente' });
    await createGiustificativoPromo({ payoutId: 'p1' });
    expect(txMock.payout.findUnique).not.toHaveBeenCalled();
    expect(txMock.giustificativoInterno.create).not.toHaveBeenCalled();
  });

  it('promo senza redemption collegato → crea comunque con righe vuote', async () => {
    txMock.promoCodeRedemption.findMany.mockResolvedValue([]);
    await createGiustificativoPromo({ payoutId: 'p1' });
    expect(txMock.giustificativoInterno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ importoCent: 20_000, righe: [] }) }),
    );
  });
});
```

- [ ] **Step 2: Lanciare il test → deve fallire**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/giustificativo-promo.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementare l'engine**

Creare `giustificativo-promo.ts`:

```ts
import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { prossimoContatore } from './numerazione';
import { numeroGiustificativo } from './format';
import { snapshotCompany } from './pv-emittente';
import { formatDate } from '@/lib/format';

const ID_SOGGETTO_PV = 'PV';

type RigaGiustificativo = {
  code: string;
  dataIscrizione: string; // ISO
  amountCent: number;
  redemptionId: string;
};

/**
 * Giustificativo interno di costo per il bonus promozionale incassato in un
 * payout ("Documento 2", art. 108 TUIR). NON è un documento fiscale, non va
 * allo SdI. Importo = somma delle CREDITO_PROMO agganciate al payout; risale ai
 * PromoCodeRedemption (via transazioneWalletId) per il log. Idempotente per
 * payout (payoutId unique). Payout senza promo → nessun record.
 */
export async function createGiustificativoPromo(input: { payoutId: string }): Promise<void> {
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const esiste = await tx.giustificativoInterno.findFirst({
      where: { payoutId: input.payoutId },
      select: { id: true },
    });
    if (esiste) return;

    const payout = await tx.payout.findUnique({
      where: { id: input.payoutId },
      include: {
        wallet: { include: { sede: { include: { company: true } }, company: true } },
        transazioni: true,
      },
    });
    if (!payout) return;

    const promoTx = payout.transazioni.filter((t) => t.tipo === 'CREDITO_PROMO');
    const importoCent = promoTx.reduce((s, t) => s + t.importoCent, 0);
    if (importoCent <= 0) return;

    const beneficiario = payout.wallet.sede?.company ?? payout.wallet.company;
    if (!beneficiario) return;

    const redemptions = await tx.promoCodeRedemption.findMany({
      where: { transazioneWalletId: { in: promoTx.map((t) => t.id) } },
      include: { promoCode: { select: { code: true } } },
    });
    const righe: RigaGiustificativo[] = redemptions.map((r) => ({
      code: r.promoCode.code,
      dataIscrizione: r.createdAt.toISOString(),
      amountCent: r.amountCent,
      redemptionId: r.id,
    }));

    const dati = snapshotCompany(beneficiario);
    const dataRif = redemptions[0]?.createdAt ?? payout.eseguitoAt ?? new Date();
    const causale = `Bonus promozionale iscrizione — ${dati.ragioneSociale} — ${formatDate(dataRif)}`;

    const num = await prossimoContatore(tx, ID_SOGGETTO_PV, 'GIUSTIFICATIVO_INTERNO', anno);
    const numeroStr = numeroGiustificativo(anno, num);

    await tx.giustificativoInterno.create({
      data: {
        tipo: 'COSTO_PROMO',
        numeroProgressivo: num,
        anno,
        numeroStr,
        importoCent,
        causale,
        payoutId: payout.id,
        beneficiarioCompanyId: beneficiario.id,
        datiBeneficiario: dati as unknown as Prisma.InputJsonValue,
        righe: righe as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
```

- [ ] **Step 4: Lanciare il test → deve passare**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/giustificativo-promo.test.ts`
Expected: PASS (4 test verdi).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/giustificativo-promo.ts apps/piattaforma/src/lib/fatturazione/giustificativo-promo.test.ts
git commit -m "feat(fatturazione): engine createGiustificativoPromo (Documento 2)"
```

---

## Task 5: Innesto in `settlePayout`

**Files:**
- Modify: `apps/piattaforma/src/lib/wallet/payout-exec.ts:20` (costante) e `:89-121` (tx settlement + chiamata engine)
- Test: `apps/piattaforma/src/lib/wallet/payout-exec.test.ts`

**Interfaces:**
- Consumes: `createGiustificativoPromo` (Task 4).
- Produces: nessuna nuova API; effetto = `CREDITO_PROMO` agganciato al payout + giustificativo generato best-effort.

- [ ] **Step 1: Aggiornare il test (mock + asserzioni) → deve fallire**

In `payout-exec.test.ts`:

1. Aggiungere `createGiustificativoPromoMock` all'oggetto `vi.hoisted(...)` (return):
```ts
    createGiustificativoPromoMock: vi.fn(),
```
2. Aggiungere il mock del modulo, sotto quello di `engine`:
```ts
vi.mock('@/lib/fatturazione/giustificativo-promo', () => ({
  createGiustificativoPromo: createGiustificativoPromoMock,
}));
```
3. In `beforeEach`, aggiungere:
```ts
  createGiustificativoPromoMock.mockResolvedValue(undefined);
```
4. Nel test happy path (`'happy path → crea IN_LAVORAZIONE, paga via provider, salda ESEGUITO, genera documento'`), dopo l'assert su `createDocBrokerMock`:
```ts
    expect(createGiustificativoPromoMock).toHaveBeenCalledWith({ payoutId: 'p1' });
```
5. Nel test `'provider rifiuta …'` e nel test `'IBAN mancante …'`, aggiungere:
```ts
    expect(createGiustificativoPromoMock).not.toHaveBeenCalled();
```
6. Aggiungere un nuovo test in `describe('eseguiPayoutImmediato', …)`:
```ts
  it('aggancia anche il CREDITO_PROMO al payout (per il giustificativo interno)', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    await eseguiPayoutImmediato('w1');
    const call = txMock.transazioneWallet.updateMany.mock.calls[0][0];
    expect(call.where.tipo.in).toEqual(
      expect.arrayContaining(['CREDITO_PRATICA', 'CREDITO_AFFILIAZIONE', 'CREDITO_PROMO']),
    );
  });
```

Run: `pnpm --filter piattaforma test src/lib/wallet/payout-exec.test.ts`
Expected: FAIL (il modulo `giustificativo-promo` non è ancora richiamato; l'assert su `.tipo.in` con CREDITO_PROMO fallisce).

- [ ] **Step 2: Implementare l'aggancio + la chiamata**

In `payout-exec.ts`, sostituire la costante (riga 20):
```ts
const TIPI_CREDITO_COMPENSO = ['CREDITO_PRATICA', 'CREDITO_AFFILIAZIONE'] as const;
// Il promo NON è compenso (resta fuori dal documento broker), ma va agganciato
// al payout per generare il giustificativo interno di costo (Documento 2).
const TIPI_AGGANCIATI_AL_PAYOUT = [...TIPI_CREDITO_COMPENSO, 'CREDITO_PROMO'] as const;
```

Aggiungere l'import in cima al file (accanto agli altri import):
```ts
import { createGiustificativoPromo } from '@/lib/fatturazione/giustificativo-promo';
```

Nella tx di settlement, aggiornare la `updateMany` (riga ~92) usando la nuova lista:
```ts
    await tx.transazioneWallet.updateMany({
      where: { walletId: payout.walletId, payoutId: null, tipo: { in: [...TIPI_AGGANCIATI_AL_PAYOUT] } },
      data: { payoutId },
    });
```

Dopo la chiamata a `createDocBroker` (riga ~121), aggiungere:
```ts
  // FT-A: documento broker (conto terzi) aggregato al payout (best-effort).
  await createDocBroker({ payoutId }).catch(() => undefined);
  // Documento 2: giustificativo interno di costo per il bonus promo (best-effort).
  await createGiustificativoPromo({ payoutId }).catch(() => undefined);
```

- [ ] **Step 3: Lanciare il test → deve passare**

Run: `pnpm --filter piattaforma test src/lib/wallet/payout-exec.test.ts`
Expected: PASS (tutti i test preesistenti + i nuovi).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/lib/wallet/payout-exec.ts apps/piattaforma/src/lib/wallet/payout-exec.test.ts
git commit -m "feat(wallet): genera il giustificativo interno promo al settlement del payout"
```

---

## Task 6: Route CSV `/api/admin/costi-promozionali/export`

**Files:**
- Create: `apps/piattaforma/src/app/api/admin/costi-promozionali/export/route.ts`
- Test: `apps/piattaforma/src/app/api/admin/costi-promozionali/export/route.test.ts`

**Interfaces:**
- Consumes: `parseGiustificativoFiltriFromUrl`, `giustificativoWhere` (Task 3); `isAdminPiattaforma` (esistente).
- Produces: `GET(req: Request): Promise<Response>` → CSV `text/csv` (403 per non-admin).

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock, isAdminMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { giustificativoInterno: { findMany: vi.fn() } },
  isAdminMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/permissions', () => ({ isAdminPiattaforma: isAdminMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { role: 'ADMIN_PIATTAFORMA' } });
  isAdminMock.mockReturnValue(true);
  prismaMock.giustificativoInterno.findMany.mockResolvedValue([
    {
      emessoAt: new Date('2026-07-10T10:00:00.000Z'),
      numeroStr: 'GI-2026-00001',
      importoCent: 20_000,
      datiBeneficiario: { ragioneSociale: 'Rossi Auto' },
      righe: [{ code: 'WELCOME' }],
    },
  ]);
});

describe('GET /api/admin/costi-promozionali/export', () => {
  it('403 per non-admin', async () => {
    isAdminMock.mockReturnValue(false);
    const res = await GET(new Request('http://x/api/admin/costi-promozionali/export'));
    expect(res.status).toBe(403);
  });

  it('CSV con header e riga per admin', async () => {
    const res = await GET(new Request('http://x/api/admin/costi-promozionali/export'));
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe('Data;Numero;Beneficiario;Importo;Codici promo');
    expect(body).toContain('2026-07-10;GI-2026-00001;Rossi Auto;200.00;WELCOME');
  });
});
```

- [ ] **Step 2: Lanciare il test → deve fallire**

Run: `pnpm --filter piattaforma test src/app/api/admin/costi-promozionali/export/route.test.ts`
Expected: FAIL (route inesistente).

- [ ] **Step 3: Implementare la route**

Creare `route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import {
  parseGiustificativoFiltriFromUrl,
  giustificativoWhere,
} from '@/lib/fatturazione/giustificativo-filtri';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cella CSV con quoting se contiene separatori/virgolette/newline. */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const filtri = parseGiustificativoFiltriFromUrl(new URL(req.url));
  const docs = await prisma.giustificativoInterno.findMany({
    where: giustificativoWhere(filtri),
    orderBy: { emessoAt: 'desc' },
  });

  const header = ['Data', 'Numero', 'Beneficiario', 'Importo', 'Codici promo'];
  const rows = docs.map((d) => {
    const b = d.datiBeneficiario as unknown as DatiFiscali;
    const righe = (d.righe as unknown as { code: string }[]) ?? [];
    return [
      d.emessoAt.toISOString().slice(0, 10),
      d.numeroStr,
      b?.ragioneSociale ?? '',
      (d.importoCent / 100).toFixed(2),
      righe.map((r) => r.code).join(' '),
    ]
      .map(csvCell)
      .join(';');
  });
  const csv = [header.map(csvCell).join(';'), ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="costi-promozionali.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
```

- [ ] **Step 4: Lanciare il test → deve passare**

Run: `pnpm --filter piattaforma test src/app/api/admin/costi-promozionali/export/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/api/admin/costi-promozionali/
git commit -m "feat(admin): export CSV costi promozionali"
```

---

## Task 7: Pagina admin `/admin/costi-promozionali` + link

**Files:**
- Create: `apps/piattaforma/src/app/admin/costi-promozionali/page.tsx`
- Modify: `apps/piattaforma/src/app/admin/fatturazione/page.tsx` (link alla nuova pagina, nell'header sopra la lista)

**Interfaces:**
- Consumes: `parseGiustificativoFiltri`, `giustificativoWhere` (Task 3); `AppShell`, `Card`, `StatCard`, `Alert` (`components/ui`); `formatCurrencyCent`, `formatDate` (`@/lib/format`); `isAdminPiattaforma`.

- [ ] **Step 1: Implementare la pagina**

Creare `page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { parseGiustificativoFiltri, giustificativoWhere } from '@/lib/fatturazione/giustificativo-filtri';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

export const dynamic = 'force-dynamic';

const TH = 'px-3 py-2 text-left text-[12px] font-semibold text-pv-navy-500';
const TD = 'px-3 py-2 text-[13px] text-pv-navy-900';

export default async function CostiPromozionaliPage({
  searchParams,
}: {
  searchParams: Promise<{ dataDa?: string; dataA?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/costi-promozionali">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin piattaforma possono consultare i costi promozionali.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const filtri = parseGiustificativoFiltri(sp);
  const where = giustificativoWhere(filtri);

  const [docs, aggregato] = await Promise.all([
    prisma.giustificativoInterno.findMany({ where, orderBy: { emessoAt: 'desc' }, take: 200 }),
    prisma.giustificativoInterno.aggregate({ where, _sum: { importoCent: true }, _count: true }),
  ]);

  const queryString = new URLSearchParams(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => v)),
  ).toString();

  return (
    <AppShell session={session} activePath="/admin/costi-promozionali">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <h1 className="text-[22px] font-bold text-pv-navy-900">Costi promozionali</h1>
        <p className="mt-1 text-[14px] text-pv-navy-500">
          Giustificativi interni dei bonus promozionali erogati (art. 108 TUIR). Non fiscali, non
          trasmessi allo SdI.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-md">
          <StatCard label="Giustificativi" value={String(aggregato._count)} />
          <StatCard label="Totale costo" value={formatCurrencyCent(aggregato._sum.importoCent ?? 0)} />
        </div>

        <form method="get" className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-[13px] text-pv-navy-700">
            Dal
            <input type="date" name="dataDa" defaultValue={filtri.dataDa ?? ''}
              className="mt-1 block rounded-lg border border-pv-navy-200 px-2 py-1 text-[13px]" />
          </label>
          <label className="text-[13px] text-pv-navy-700">
            Al
            <input type="date" name="dataA" defaultValue={filtri.dataA ?? ''}
              className="mt-1 block rounded-lg border border-pv-navy-200 px-2 py-1 text-[13px]" />
          </label>
          <button type="submit"
            className="rounded-lg bg-pv-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white">
            Filtra
          </button>
          <Link href={`/api/admin/costi-promozionali/export${queryString ? `?${queryString}` : ''}`}
            className="rounded-lg border border-pv-navy-200 px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700">
            Esporta CSV
          </Link>
        </form>

        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full border-collapse">
            <thead className="border-b border-pv-navy-100 bg-pv-navy-50">
              <tr>
                <th className={TH}>Data</th>
                <th className={TH}>Numero</th>
                <th className={TH}>Beneficiario</th>
                <th className={TH}>Codici promo</th>
                <th className={`${TH} text-right`}>Importo</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr>
                  <td className={`${TD} text-pv-navy-500`} colSpan={5}>
                    Nessun costo promozionale nel periodo selezionato.
                  </td>
                </tr>
              ) : (
                docs.map((d) => {
                  const b = d.datiBeneficiario as unknown as DatiFiscali;
                  const righe = (d.righe as unknown as { code: string }[]) ?? [];
                  return (
                    <tr key={d.id} className="border-b border-pv-navy-50">
                      <td className={TD}>{formatDate(d.emessoAt)}</td>
                      <td className={TD}>{d.numeroStr}</td>
                      <td className={TD}>{b?.ragioneSociale ?? '—'}</td>
                      <td className={TD}>{righe.map((r) => r.code).join(', ') || '—'}</td>
                      <td className={`${TD} text-right`}>{formatCurrencyCent(d.importoCent)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
}
```

Nota: verificare i nomi esatti delle utility colore/`StatCard`/`Card` in `components/ui` e allinearli a quelli usati da `admin/fatturazione/page.tsx` (importati lì da `@/components/ui`); se un componente ha props diverse, adeguarsi al pattern di quella pagina (stessa origine, stesso design system) — nessun colore hardcoded fuori dalle classi `pv-*` già in uso.

- [ ] **Step 2: Aggiungere il link dalla pagina fatturazione admin**

In `apps/piattaforma/src/app/admin/fatturazione/page.tsx`, nell'header (dopo il titolo, prima della lista), aggiungere:

```tsx
<Link
  href="/admin/costi-promozionali"
  className="text-[13px] font-semibold text-pv-blue-600 hover:underline"
>
  → Costi promozionali (giustificativi interni)
</Link>
```
(`Link` è già importato in quella pagina.)

- [ ] **Step 3: Verifica nel browser (gesto utente reale)**

Run: `nvm use 22.15.0 && pnpm --filter piattaforma dev` e, loggato come admin piattaforma (vedi credenziali dev locali), aprire `/admin/costi-promozionali`.
Expected: la pagina carica, mostra le due StatCard, la tabella (vuota se non ci sono ancora giustificativi), il filtro date funziona (submit GET aggiorna la lista) e "Esporta CSV" scarica `costi-promozionali.csv`. Verificare che dalla pagina `/admin/fatturazione` il link porti qui.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/admin/costi-promozionali/page.tsx apps/piattaforma/src/app/admin/fatturazione/page.tsx
git commit -m "feat(admin): pagina Costi promozionali + link da fatturazione"
```

---

## Task 8: Verifica end-to-end del flusso (dati reali locali)

**Files:** nessuna modifica — verifica su DB locale (copia prod).

- [ ] **Step 1: Suite completa dei moduli toccati**

Run:
```bash
pnpm --filter piattaforma test src/lib/fatturazione/ src/lib/wallet/payout-exec.test.ts src/app/api/admin/costi-promozionali/
```
Expected: tutti verdi.

- [ ] **Step 2: Verifica del flusso reale con uno script one-shot**

Query in sola lettura sul DB locale per confermare che un payout con promo produce un giustificativo e che il documento broker resta senza il promo. Individuare un wallet con una `CREDITO_PROMO` e simulare mentalmente, oppure — se esiste già un payout ESEGUITO con promo dopo l'implementazione — verificare:

Run (psql sul container locale, sola lettura):
```sql
SELECT g."numeroStr", g."importoCent", g."causale",
       (SELECT COALESCE(SUM(t."importoCent"),0) FROM "transazioni_wallet" t
         WHERE t."payoutId" = g."payoutId" AND t."tipo" = 'CREDITO_PROMO') AS promo_agganciato,
       d."numeroDocumentoStr" AS doc_broker, d."importoLordoCent" AS doc_broker_lordo
FROM "giustificativi_interni" g
LEFT JOIN "documenti_fiscali" d ON d."payoutId" = g."payoutId" AND d."tipo" = 'DOC_BROKER'
ORDER BY g."createdAt" DESC LIMIT 5;
```
Expected: `importoCent` = `promo_agganciato`; `doc_broker_lordo` NON include il promo (è la sola quota compenso). Se non ci sono ancora giustificativi reali, la query torna 0 righe: in tal caso creare a mano un payout di test o affidarsi ai test unitari di Task 4/5.

- [ ] **Step 3: Aggiornare la memoria di progetto**

Aggiornare `project_fatturazione_promo_split.md`: il gap "Documento 2" è ora implementato (engine `giustificativo-promo.ts`, pagina `/admin/costi-promozionali`, migration `20260719120000`), **non deployato** (locale). Restano gli open item non-codice (art. 108 + affiliazione col commercialista).

---

## Self-Review (compilata durante la stesura)

**Spec coverage:**
- Principio innesco per tipo → Task 5. ✓
- Modello dati `GiustificativoInterno` → Task 1. ✓
- Aggancio `CREDITO_PROMO` + engine best-effort → Task 4 + 5. ✓
- Numerazione interna riuso `prossimoContatore` + nuovo tipo → Task 1 (enum) + 2 (format) + 4 (uso). ✓
- Superficie admin (pagina + CSV) → Task 6 + 7. ✓
- Filtri condivisi (anti "fonte unica ricopiata") → Task 3. ✓
- Edge: promo=0 → nessun record (Task 4 test); compenso=0 & promo>0 → `createDocBroker` già guarda `lordo<=0`, giustificativo emesso (coperto da Task 4/5); idempotenza (Task 4 test). ✓
- Regressione: `createDocBroker` invariato dopo l'aggancio promo → garantito perché filtra per tipo (verificato sui 4 consumer) + Task 5 non tocca `engine.ts`. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice/comandi concreti. L'unico punto "di verifica" (nomi componenti `components/ui` in Task 7) è un allineamento a un pattern esistente citato, non un placeholder di logica.

**Type consistency:** `createGiustificativoPromo({ payoutId })` usato identico in Task 4 e 5; `numeroGiustificativo(anno, num)` def. Task 2, usato Task 4; `parseGiustificativoFiltri`/`parseGiustificativoFiltriFromUrl`/`giustificativoWhere` def. Task 3, usati Task 6 e 7; `GIUSTIFICATIVO_INTERNO` def. Task 1, usato Task 4; `TIPI_AGGANCIATI_AL_PAYOUT` def. e usato in Task 5.
