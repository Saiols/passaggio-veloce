# Numerazione Fatture — Allineamento al paper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allineare la numerazione fiscale al paper `docs/PassaggioVeloce NumerazioneFatture.docx`, adottando il formato con prefisso + ID soggetto, una tabella contatori dedicata con incremento atomico, e sequenze separate per le note di credito.

**Architecture:** Si introduce un modello `ContatoreFiscale` (chiave `idSoggetto + tipoDocumento + anno`) con incremento atomico via `INSERT … ON CONFLICT … RETURNING` (no race, no buchi). Ogni `Company` riceve un `numeroSoggetto` numerico univoco (Postgres sequence, mai riusato). Ogni `DocumentoFiscale` congela la stringa formattata (`numeroDocumentoStr`) all'emissione; UI/PDF/XML la leggono così com'è (immutabilità fiscale).

**Tech Stack:** Next.js 16 (App Router) · Prisma + Postgres (docker locale / Neon prod) · pnpm + Turborepo · Vitest · TypeScript.

## Decisioni fissate (Francesco, 2026-06-29)

1. **Schema = Ibrido** — prefisso + ID broker **con reset annuale** e anno nel numero.
   - Fattura PV → agenzia: `PV-2026-00001`
   - Documento broker (conto terzi): `PV-0047-2026-00001` (`0047` = `numeroSoggetto` del broker, 4 cifre)
   - Nota di credito PV: `NC-2026-00001` · Nota di credito broker: `NC-0047-2026-00001`
   - (Penale, fuori scope paper, prefisso `PN-` per coerenza — nessun path di creazione oggi)
2. **Granularità broker = per azienda madre** (`Company`, P.IVA unica). `numeroSoggetto` su `Company`, **non** su `Sede`. Eventuale tracciabilità per-sede = futuro campo informativo, non fiscale.
3. **Note di credito = sequenza separata** (`tipoDocumento = NOTA_CREDITO`, contatore distinto per soggetto).

## Global Constraints

- **Obbligo fiscale:** la numerazione non può avere **buchi** né **duplicati**. L'assegnazione del numero deve essere **atomica**; se la creazione del documento fallisce, la transazione fa rollback e **il numero non viene consumato** (l'incremento avviene dentro la stessa `prisma.$transaction` della create).
- **Reset annuale:** nuovo anno fiscale (anno solare) → la sequenza riparte da 1 per ogni `(idSoggetto, tipoDocumento)`. Gestito automaticamente dalla chiave `anno` del contatore.
- **`numeroSoggetto`:** univoco su tutta la piattaforma, **mai riassegnato** (Postgres `SEQUENCE`, non si riusa nemmeno alla chiusura account).
- **Immutabilità:** documenti fiscali immutabili dopo la creazione; correzioni solo via `NOTA_VARIAZIONE`. La stringa `numeroDocumentoStr` è congelata all'emissione.
- **Importi in centesimi** (`*Cent: Int`); negativi per le note di credito.
- **Monorepo:** comandi da `apps/piattaforma` salvo le migrazioni Prisma che girano da `packages/db`. Node 22 (`nvm use 22.15.0`). `@pv/db` espone `prisma`, i tipi e gli enum.
- **Assunzione di rischio basso:** la fatturazione **non emette ancora documenti fiscali reali verso SDI** (`AcubeProvider` in attesa account). Le migrazioni di backfill sono difensive ma di fatto operano su dati di test/assenti. **Verificare** con `SELECT count(*) FROM documenti_fiscali` prima di applicare in prod; se ci sono documenti reali, rivedere la strategia di backfill con il commercialista.

---

### Task 1: Schema DB — `ContatoreFiscale`, `Company.numeroSoggetto`, `DocumentoFiscale.numeroDocumentoStr`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Company` ~448-454, model `DocumentoFiscale` ~1350-1384, nuovo enum + model `ContatoreFiscale`)
- Create: `packages/db/prisma/migrations/<timestamp>_numerazione_paper/migration.sql` (generata `--create-only`, poi editata a mano per sequence + backfill)

**Interfaces:**
- Produces (tipi generati da `@pv/db`):
  - enum `ContatoreFiscaleTipo = 'FATTURA_PV' | 'DOC_BROKER' | 'NOTA_CREDITO' | 'PENALE'`
  - model `ContatoreFiscale { id, idSoggetto: string, tipoDocumento: ContatoreFiscaleTipo, anno: number, contatore: number, aggiornatoAt: Date }`
  - `Company.numeroSoggetto: number` (non-null dopo backfill)
  - `DocumentoFiscale.numeroDocumentoStr: string | null`
- Consumes: niente (prima task).

- [ ] **Step 1: Modificare lo schema Prisma**

In `model Company`, sostituire il blocco `// Fatturazione (FT-A)` (righe ~448-454) con:

```prisma
  // Fatturazione (FT-A)
  regimeFiscale RegimeFiscale @default(ORDINARIO)
  // Numerazione paper: ID soggetto univoco a 4 cifre nel numero documento broker
  // (es. PV-0047-2026-00001). Postgres sequence: univoco, mai riassegnato.
  numeroSoggetto    Int                @unique @default(dbgenerated("nextval('numero_soggetto_seq')"))
  documentiEmessi   DocumentoFiscale[] @relation("DocumentiEmessi")
  documentiRicevuti DocumentoFiscale[] @relation("DocumentiRicevuti")
```

(Rimuovere `numeratoreFiscaleAnno` e `numeratoreFiscaleNum`: sostituiti da `ContatoreFiscale`.)

In `model DocumentoFiscale`, dopo `anno Int` (riga ~1351) aggiungere:

```prisma
  // Stringa formattata congelata all'emissione (immutabile): es. "PV-0047-2026-00001".
  numeroDocumentoStr String? @unique
```

Aggiungere in fondo al file (dopo `DocumentoFiscale`) il nuovo enum e model:

```prisma
enum ContatoreFiscaleTipo {
  FATTURA_PV
  DOC_BROKER
  NOTA_CREDITO
  PENALE
}

// Contatore di numerazione fiscale (paper NumerazioneFatture). Una riga per
// (soggetto emittente, tipo documento, anno fiscale). idSoggetto = "PV" per i
// documenti propri di Passaggio Veloce, oppure Company.id del broker per i
// documenti conto terzi. Incremento atomico via INSERT … ON CONFLICT.
model ContatoreFiscale {
  id            String               @id @default(uuid()) @db.Uuid
  idSoggetto    String
  tipoDocumento ContatoreFiscaleTipo
  anno          Int
  contatore     Int                  @default(0)
  aggiornatoAt  DateTime             @updatedAt

  @@unique([idSoggetto, tipoDocumento, anno])
  @@map("contatori_fiscali")
}
```

- [ ] **Step 2: Generare la migration (solo SQL, senza applicarla)**

Run (da `packages/db`):
```bash
cd packages/db && pnpm prisma migrate dev --create-only --name numerazione_paper
```
Expected: crea `migrations/<timestamp>_numerazione_paper/migration.sql` con DROP delle colonne `numeratoreFiscale*`, ADD `numeroDocumentoStr`, CREATE enum + tabella. **Non** applicata ancora.

- [ ] **Step 3: Editare la migration — aggiungere sequence + backfill atomici**

Aprire la `migration.sql` generata e **anteporre** (prima di qualsiasi `ALTER TABLE "companies"` sul `numeroSoggetto`) la creazione della sequence, poi **inserire** i blocchi di backfill. Il file finale deve, nell'ordine:

```sql
-- 1) Sequence per numeroSoggetto (univoco, mai riusato)
CREATE SEQUENCE IF NOT EXISTS numero_soggetto_seq START 1;

-- 2) Colonna numeroSoggetto (nullable in transitorio, poi backfill, poi NOT NULL)
ALTER TABLE "companies" ADD COLUMN "numeroSoggetto" INTEGER;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn FROM "companies"
)
UPDATE "companies" c SET "numeroSoggetto" = o.rn FROM ordered o WHERE c.id = o.id;

SELECT setval('numero_soggetto_seq', (SELECT COALESCE(MAX("numeroSoggetto"), 0) FROM "companies"), true);

ALTER TABLE "companies" ALTER COLUMN "numeroSoggetto" SET DEFAULT nextval('numero_soggetto_seq');
ALTER TABLE "companies" ALTER COLUMN "numeroSoggetto" SET NOT NULL;
CREATE UNIQUE INDEX "companies_numeroSoggetto_key" ON "companies"("numeroSoggetto");

-- 3) numeroDocumentoStr su documenti_fiscali
ALTER TABLE "documenti_fiscali" ADD COLUMN "numeroDocumentoStr" TEXT;

-- 4) Enum + tabella contatori
CREATE TYPE "ContatoreFiscaleTipo" AS ENUM ('FATTURA_PV', 'DOC_BROKER', 'NOTA_CREDITO', 'PENALE');
CREATE TABLE "contatori_fiscali" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "idSoggetto"    TEXT NOT NULL,
  "tipoDocumento" "ContatoreFiscaleTipo" NOT NULL,
  "anno"          INTEGER NOT NULL,
  "contatore"     INTEGER NOT NULL DEFAULT 0,
  "aggiornatoAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contatori_fiscali_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contatori_fiscali_idSoggetto_tipoDocumento_anno_key"
  ON "contatori_fiscali"("idSoggetto", "tipoDocumento", "anno");

-- 5) Seed contatori broker (DOC_BROKER) dal vecchio stato Company.numeratoreFiscale*
INSERT INTO "contatori_fiscali" ("id","idSoggetto","tipoDocumento","anno","contatore","aggiornatoAt")
SELECT gen_random_uuid(), c.id::text, 'DOC_BROKER', c."numeratoreFiscaleAnno", c."numeratoreFiscaleNum", now()
FROM "companies" c
WHERE c."numeratoreFiscaleAnno" IS NOT NULL AND c."numeratoreFiscaleNum" IS NOT NULL;

-- 6) Seed contatori PV (FATTURA_PV e NOTA_CREDITO) dal max progressivo già usato
--    Si parte dal max tra TUTTI i doc PV dell'anno per evitare collisioni con
--    la vecchia sequenza interlacciata (fatture+note nello stesso registro).
INSERT INTO "contatori_fiscali" ("id","idSoggetto","tipoDocumento","anno","contatore","aggiornatoAt")
SELECT gen_random_uuid(), 'PV', t.tipo, d."anno", MAX(d."numeroProgressivo"), now()
FROM "documenti_fiscali" d
CROSS JOIN (VALUES ('FATTURA_PV'::"ContatoreFiscaleTipo'), ('NOTA_CREDITO'::"ContatoreFiscaleTipo")) AS t(tipo)
WHERE d."emittenteCompanyId" IS NULL
GROUP BY t.tipo, d."anno";

-- 7) Backfill numeroDocumentoStr sui documenti esistenti (formato nuovo, progressivo storico)
UPDATE "documenti_fiscali" d SET "numeroDocumentoStr" =
  CASE
    WHEN d."tipo" = 'FATTURA_PV'   THEN 'PV-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."tipo" = 'PENALE_BROKER' THEN 'PN-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."emittenteCompanyId" IS NULL AND d."tipo" = 'NOTA_VARIAZIONE'
      THEN 'NC-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."tipo" = 'DOC_BROKER'
      THEN 'PV-' || lpad(em."numeroSoggetto"::text, 4, '0') || '-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."tipo" = 'NOTA_VARIAZIONE'
      THEN 'NC-' || lpad(em."numeroSoggetto"::text, 4, '0') || '-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
  END
FROM "companies" em WHERE em.id = d."emittenteCompanyId" OR d."emittenteCompanyId" IS NULL;

-- 8) Rimozione vecchie colonne (sostituite da contatori_fiscali)
ALTER TABLE "companies" DROP COLUMN "numeratoreFiscaleAnno";
ALTER TABLE "companies" DROP COLUMN "numeratoreFiscaleNum";
```

> ⚠ Correggere l'apostrofo tipografico nel blocco `VALUES` se l'editor lo introduce: deve essere `'FATTURA_PV'::"ContatoreFiscaleTipo"` (doppi apici sul nome tipo, singoli sul valore).

- [ ] **Step 4: Applicare la migration e rigenerare il client**

Run (da `packages/db`):
```bash
cd packages/db && pnpm prisma migrate dev --name numerazione_paper && pnpm prisma generate
```
Expected: migration applicata senza errori; client rigenerato con `prisma.contatoreFiscale`, `Company.numeroSoggetto`, `DocumentoFiscale.numeroDocumentoStr`.

- [ ] **Step 5: Verificare i tipi a livello monorepo**

Run (dalla root):
```bash
pnpm -w turbo run typecheck --filter=@pv/db
```
Expected: PASS (il package db compila; le rotture in `apps/piattaforma` per le colonne rimosse sono attese e risolte nelle task successive).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(fatturazione): schema numerazione paper (contatori_fiscali, numeroSoggetto)"
```

---

### Task 2: Helper di formato `numeroDocumento` (puro, TDD)

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/format.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/format.test.ts`

**Interfaces:**
- Consumes: `DocumentoFiscaleTipo` da `@pv/db`.
- Produces:
  - `numeroDocumento(d: { tipo: DocumentoFiscaleTipo; numeroProgressivo: number; anno: number; emittenteNumeroSoggetto?: number | null }): string`
  - `labelTipoDocumento(tipo: DocumentoFiscaleTipo): string` (invariata)

- [ ] **Step 1: Scrivere i test (falliscono)**

Sostituire il `describe('numeroDocumento', …)` in `format.test.ts` con:

```ts
import { describe, it, expect } from 'vitest';
import { numeroDocumento, labelTipoDocumento } from './format';

describe('numeroDocumento', () => {
  it('FATTURA_PV → PV-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'FATTURA_PV', numeroProgressivo: 7, anno: 2026 })).toBe('PV-2026-00007');
  });
  it('DOC_BROKER → PV-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'DOC_BROKER', numeroProgressivo: 3, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('PV-0047-2026-00003');
  });
  it('NOTA_VARIAZIONE PV → NC-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'NOTA_VARIAZIONE', numeroProgressivo: 12, anno: 2026 })).toBe('NC-2026-00012');
  });
  it('NOTA_VARIAZIONE broker → NC-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'NOTA_VARIAZIONE', numeroProgressivo: 2, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('NC-0047-2026-00002');
  });
  it('PENALE_BROKER → PN-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'PENALE_BROKER', numeroProgressivo: 1, anno: 2026 })).toBe('PN-2026-00001');
  });
});

describe('labelTipoDocumento', () => {
  it('mappa i tipi', () => {
    expect(labelTipoDocumento('FATTURA_PV')).toBe('Fattura');
    expect(labelTipoDocumento('DOC_BROKER')).toBe('Compenso intermediazione');
    expect(labelTipoDocumento('NOTA_VARIAZIONE')).toBe('Nota di credito');
    expect(labelTipoDocumento('PENALE_BROKER')).toBe('Penale');
  });
});
```

- [ ] **Step 2: Eseguire i test (verificare il FAIL)**

Run (da `apps/piattaforma`):
```bash
pnpm vitest run src/lib/fatturazione/format.test.ts
```
Expected: FAIL (`numeroDocumento` ancora con vecchia firma `'7/2026'`).

- [ ] **Step 3: Implementare il nuovo formato**

Sostituire le righe 1-6 di `format.ts` con:

```ts
import type { DocumentoFiscaleTipo } from '@pv/db';

const pad = (n: number, len: number): string => String(n).padStart(len, '0');

/**
 * Numero documento leggibile e fiscale (paper NumerazioneFatture):
 * - FATTURA_PV:        PV-<anno>-<5 cifre>            es. PV-2026-00007
 * - DOC_BROKER:        PV-<id4>-<anno>-<5 cifre>      es. PV-0047-2026-00003
 * - NOTA_VARIAZIONE:   NC-[<id4>-]<anno>-<5 cifre>    es. NC-2026-00012 / NC-0047-2026-00002
 * - PENALE_BROKER:     PN-[<id4>-]<anno>-<5 cifre>
 * `emittenteNumeroSoggetto` = Company.numeroSoggetto del broker (null per documenti PV).
 */
export function numeroDocumento(d: {
  tipo: DocumentoFiscaleTipo;
  numeroProgressivo: number;
  anno: number;
  emittenteNumeroSoggetto?: number | null;
}): string {
  const seq = pad(d.numeroProgressivo, 5);
  const id = d.emittenteNumeroSoggetto != null ? pad(d.emittenteNumeroSoggetto, 4) : null;
  switch (d.tipo) {
    case 'FATTURA_PV':
      return `PV-${d.anno}-${seq}`;
    case 'DOC_BROKER':
      return `PV-${id ?? '0000'}-${d.anno}-${seq}`;
    case 'NOTA_VARIAZIONE':
      return id ? `NC-${id}-${d.anno}-${seq}` : `NC-${d.anno}-${seq}`;
    case 'PENALE_BROKER':
      return id ? `PN-${id}-${d.anno}-${seq}` : `PN-${d.anno}-${seq}`;
  }
}
```

(Lasciare invariato il blocco `LABELS` / `labelTipoDocumento` sotto.)

- [ ] **Step 4: Eseguire i test (verificare il PASS)**

Run:
```bash
pnpm vitest run src/lib/fatturazione/format.test.ts
```
Expected: PASS (5 + 1 test verdi).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/format.ts apps/piattaforma/src/lib/fatturazione/format.test.ts
git commit -m "feat(fatturazione): formato numero documento con prefisso + id soggetto"
```

---

### Task 3: Contatore atomico + riscrittura engine

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/numerazione.ts` (rimpiazza `prossimoNumero` con `prossimoContatore`)
- Delete: `apps/piattaforma/src/lib/fatturazione/numerazione.test.ts` (il test sostituito da integration; vedi sotto)
- Create: `apps/piattaforma/src/lib/fatturazione/numerazione.integration.test.ts`
- Modify: `apps/piattaforma/src/lib/fatturazione/engine.ts`

**Interfaces:**
- Consumes: `numeroDocumento` (Task 2), `ContatoreFiscaleTipo`, `prisma`, `Prisma` da `@pv/db`.
- Produces:
  - `prossimoContatore(tx: Prisma.TransactionClient, idSoggetto: string, tipo: ContatoreFiscaleTipo, anno: number): Promise<number>`
  - `engine.ts` invariato come API pubblica: `createFatturaPv`, `createDocBroker`, `createNotaCredito` (stesse firme).

- [ ] **Step 1: Riscrivere `numerazione.ts` con l'incremento atomico**

Sostituire l'intero contenuto di `numerazione.ts` con:

```ts
import 'server-only';
import type { ContatoreFiscaleTipo, Prisma } from '@pv/db';

/**
 * Prossimo numero progressivo per (idSoggetto, tipo, anno). Atomico: un singolo
 * statement INSERT … ON CONFLICT … RETURNING; nessun altro processo può leggere
 * o modificare il contatore nel mezzo. La riga inesistente parte da 1 (anche al
 * cambio anno → reset automatico, perché l'anno fa parte della chiave). Va
 * chiamato DENTRO la stessa transazione della create del documento: se la create
 * fallisce, l'incremento fa rollback e il numero non viene consumato.
 */
export async function prossimoContatore(
  tx: Prisma.TransactionClient,
  idSoggetto: string,
  tipo: ContatoreFiscaleTipo,
  anno: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ contatore: number }[]>`
    INSERT INTO "contatori_fiscali" ("id", "idSoggetto", "tipoDocumento", "anno", "contatore", "aggiornatoAt")
    VALUES (gen_random_uuid(), ${idSoggetto}, ${tipo}::"ContatoreFiscaleTipo", ${anno}, 1, now())
    ON CONFLICT ("idSoggetto", "tipoDocumento", "anno")
    DO UPDATE SET "contatore" = "contatori_fiscali"."contatore" + 1, "aggiornatoAt" = now()
    RETURNING "contatore"
  `;
  return rows[0].contatore;
}
```

- [ ] **Step 2: Riscrivere `engine.ts` per usare il contatore e congelare la stringa**

Sostituire `numerazione.ts` import e `nextNumeroPv` (righe 4-14) e le tre funzioni con la versione che usa `prossimoContatore` + `numeroDocumento`. Sostituire l'intero file `engine.ts` con:

```ts
import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { splitImporto, fatturaPaTipoPerRegime } from './calcolo';
import { prossimoContatore } from './numerazione';
import { numeroDocumento } from './format';
import { pvEmittente, snapshotCompany, type DatiFiscali } from './pv-emittente';

const ID_SOGGETTO_PV = 'PV';

/**
 * FATTURA_PV verso l'agenzia, generata alla firma. Importo = feeAgenziaCent
 * (PV regime ordinario → IVA 22% scorporata). Idempotente per pratica.
 */
export async function createFatturaPv(input: {
  praticaId: string;
  agenziaId: string;
  feeAgenziaCent: number;
}): Promise<void> {
  if (input.feeAgenziaCent <= 0) return;
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const esiste = await tx.documentoFiscale.findFirst({
      where: { praticaId: input.praticaId, tipo: 'FATTURA_PV' },
      select: { id: true },
    });
    if (esiste) return;
    const agenzia = await tx.company.findUnique({ where: { id: input.agenziaId } });
    if (!agenzia) return;

    const split = splitImporto(input.feeAgenziaCent, 'ORDINARIO');
    const num = await prossimoContatore(tx, ID_SOGGETTO_PV, 'FATTURA_PV', anno);
    const numeroStr = numeroDocumento({ tipo: 'FATTURA_PV', numeroProgressivo: num, anno });

    await tx.documentoFiscale.create({
      data: {
        tipo: 'FATTURA_PV',
        fatturaPaTipo: 'TD01',
        praticaId: input.praticaId,
        emittenteCompanyId: null,
        destinatarioCompanyId: agenzia.id,
        datiEmittente: pvEmittente() as unknown as Prisma.InputJsonValue,
        datiDestinatario: snapshotCompany(agenzia) as unknown as Prisma.InputJsonValue,
        numeroProgressivo: num,
        anno,
        numeroDocumentoStr: numeroStr,
        importoLordoCent: input.feeAgenziaCent,
        imponibileCent: split.imponibileCent,
        ivaCent: split.ivaCent,
        aliquotaIvaPct: split.aliquotaIvaPct,
        statoPagamento: 'IN_ATTESA',
      },
    });
  });
}

/**
 * DOC_BROKER (conto terzi) aggregato al payout: importo = somma dei CREDITO_PRATICA
 * del payout, tipo per regime del broker. Emittente = broker (madre), destinatario
 * = PV (snapshot). Numerato sul registro del broker. Idempotente per payout.
 */
export async function createDocBroker(input: { payoutId: string }): Promise<void> {
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const esiste = await tx.documentoFiscale.findFirst({
      where: { payoutId: input.payoutId, tipo: 'DOC_BROKER' },
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
    const broker = payout.wallet.sede?.company ?? payout.wallet.company;
    if (!broker) return;

    const lordo = payout.transazioni
      .filter((t) => t.tipo === 'CREDITO_PRATICA')
      .reduce((s, t) => s + t.importoCent, 0);
    if (lordo <= 0) return;

    const regime = broker.regimeFiscale;
    const split = splitImporto(lordo, regime);
    const tipoXml = fatturaPaTipoPerRegime('DOC_BROKER', regime);
    const num = await prossimoContatore(tx, broker.id, 'DOC_BROKER', anno);
    const numeroStr = numeroDocumento({
      tipo: 'DOC_BROKER',
      numeroProgressivo: num,
      anno,
      emittenteNumeroSoggetto: broker.numeroSoggetto,
    });

    await tx.documentoFiscale.create({
      data: {
        tipo: 'DOC_BROKER',
        fatturaPaTipo: tipoXml,
        payoutId: payout.id,
        emittenteCompanyId: broker.id,
        destinatarioCompanyId: null,
        datiEmittente: snapshotCompany(broker) as unknown as Prisma.InputJsonValue,
        datiDestinatario: pvEmittente() as unknown as Prisma.InputJsonValue,
        numeroProgressivo: num,
        anno,
        numeroDocumentoStr: numeroStr,
        importoLordoCent: lordo,
        imponibileCent: split.imponibileCent,
        ivaCent: split.ivaCent,
        aliquotaIvaPct: split.aliquotaIvaPct,
      },
    });
  });
}

/**
 * NOTA_VARIAZIONE (TD04, importi negativi) su un documento esistente. Numerata su
 * sequenza NOTA_CREDITO separata, nel registro dell'emittente dell'originale (PV o
 * broker). Marca l'originale STORNATA.
 */
export async function createNotaCredito(input: {
  documentoOriginaleId: string;
}): Promise<void> {
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const orig = await tx.documentoFiscale.findUnique({
      where: { id: input.documentoOriginaleId },
    });
    if (!orig || orig.tipo === 'NOTA_VARIAZIONE') return;

    const isPv = orig.emittenteCompanyId == null;
    const idSoggetto = isPv ? ID_SOGGETTO_PV : orig.emittenteCompanyId!;
    const em = isPv
      ? null
      : await tx.company.findUnique({
          where: { id: orig.emittenteCompanyId! },
          select: { numeroSoggetto: true },
        });
    const num = await prossimoContatore(tx, idSoggetto, 'NOTA_CREDITO', anno);
    const numeroStr = numeroDocumento({
      tipo: 'NOTA_VARIAZIONE',
      numeroProgressivo: num,
      anno,
      emittenteNumeroSoggetto: em?.numeroSoggetto ?? null,
    });

    await tx.documentoFiscale.create({
      data: {
        tipo: 'NOTA_VARIAZIONE',
        fatturaPaTipo: 'TD04',
        praticaId: orig.praticaId,
        payoutId: orig.payoutId,
        emittenteCompanyId: orig.emittenteCompanyId,
        destinatarioCompanyId: orig.destinatarioCompanyId,
        datiEmittente: orig.datiEmittente as Prisma.InputJsonValue,
        datiDestinatario: orig.datiDestinatario as Prisma.InputJsonValue,
        numeroProgressivo: num,
        anno,
        numeroDocumentoStr: numeroStr,
        importoLordoCent: -orig.importoLordoCent,
        imponibileCent: orig.imponibileCent == null ? null : -orig.imponibileCent,
        ivaCent: orig.ivaCent == null ? null : -orig.ivaCent,
        aliquotaIvaPct: orig.aliquotaIvaPct,
        notaVariazionePerId: orig.id,
      },
    });

    await tx.documentoFiscale.update({
      where: { id: orig.id },
      data: { statoPagamento: 'STORNATA' },
    });
  });
}

export type { DatiFiscali };
```

- [ ] **Step 3: Rimuovere il vecchio test puro e creare l'integration test del contatore**

Eliminare `numerazione.test.ts` (testava `prossimoNumero`, ora rimosso):
```bash
git rm apps/piattaforma/src/lib/fatturazione/numerazione.test.ts
```

Creare `apps/piattaforma/src/lib/fatturazione/numerazione.integration.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@pv/db';
import { prossimoContatore } from './numerazione';

const ID = 'TEST-NUMERAZIONE';
const ANNO = 2999;

// Integration: richiede il Postgres locale (DATABASE_URL). Salta in assenza di DB.
describe.skipIf(!process.env.DATABASE_URL)('prossimoContatore (integration)', () => {
  afterAll(async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
  });

  it('parte da 1 e incrementa', async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
    const a = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO));
    const b = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO));
    expect([a, b]).toEqual([1, 2]);
  });

  it('sequenze separate per tipo e per anno', async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
    const fatt = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO));
    const nota = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'NOTA_CREDITO', ANNO));
    const annoNuovo = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO + 1));
    expect([fatt, nota, annoNuovo]).toEqual([1, 1, 1]); // reset per (tipo, anno)
  });

  it('atomico sotto concorrenza: 1..N contigui, nessun duplicato', async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
    const N = 25;
    const out = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.$transaction((tx) => prossimoContatore(tx, ID, 'DOC_BROKER', ANNO)),
      ),
    );
    expect([...out].sort((x, y) => x - y)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });
});
```

- [ ] **Step 4: Verificare typecheck + integration**

Run (da `apps/piattaforma`):
```bash
pnpm typecheck
pnpm vitest run src/lib/fatturazione/numerazione.integration.test.ts
```
Expected: typecheck PASS; integration PASS (con Postgres locale attivo — `docker compose up -d` se serve; in CI senza `DATABASE_URL` i test sono `skipped`).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/numerazione.ts apps/piattaforma/src/lib/fatturazione/numerazione.integration.test.ts apps/piattaforma/src/lib/fatturazione/engine.ts
git commit -m "feat(fatturazione): contatore fiscale atomico (ON CONFLICT) + engine su tabella contatori"
```

---

### Task 4: Lettura del numero congelato in UI / PDF / XML

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/format.ts` (deprecare l'uso runtime: l'UI legge il campo, non ricalcola)
- Modify: `apps/piattaforma/src/lib/fatturazione/descrizione.ts:43`
- Modify: `apps/piattaforma/src/lib/fatturazione/pdf.ts:92`
- Modify: `apps/piattaforma/src/app/fatturazione/page.tsx:143,227`
- Modify: `apps/piattaforma/src/app/fatturazione/[id]/page.tsx:110,227,235`
- Modify: `apps/piattaforma/src/app/admin/fatturazione/page.tsx:179`
- Modify: `apps/piattaforma/src/app/api/admin/fatturazione/export/route.ts:67`
- Modify: `apps/piattaforma/src/app/api/fatturazione/[id]/xml/route.ts:71`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx:269`

**Interfaces:**
- Consumes: `DocumentoFiscale.numeroDocumentoStr` (Task 1), `labelTipoDocumento` (invariata).
- Produces: nessuna nuova API. Tutti i call site usano la stringa congelata.

- [ ] **Step 1: Sostituire ogni `numeroDocumento(d)` con il campo congelato**

In ciascun file sopra, sostituire le chiamate `numeroDocumento(x)` con `x.numeroDocumentoStr ?? ''`. Esempi puntuali:

- `descrizione.ts:43`: `\`Storno documento N° ${doc.notaVariazionePer.numeroDocumentoStr ?? ''}\``
- `pdf.ts:92`: `const numero = input.numeroDocumentoStr ?? '';` (assicurarsi che il tipo `input` includa `numeroDocumentoStr`)
- `fatturazione/page.tsx:143,227`: `{d.numeroDocumentoStr}`
- `fatturazione/[id]/page.tsx:110`: `N° {doc.numeroDocumentoStr}` · `:227`: `N° {doc.notaVariazionePer.numeroDocumentoStr}` · `:235`: `N° {n.numeroDocumentoStr}`
- `admin/fatturazione/page.tsx:179`: `{d.numeroDocumentoStr}`
- `api/admin/fatturazione/export/route.ts:67`: `d.numeroDocumentoStr ?? '',`
- `api/fatturazione/[id]/xml/route.ts:71`: `numero: doc.numeroDocumentoStr ?? '',`
- `pratiche/[id]/page.tsx:269`: `{labelTipoDocumento(d.tipo)} · N° {d.numeroDocumentoStr}`

Rimuovere gli import ora inutilizzati di `numeroDocumento` (lasciare `labelTipoDocumento` dove serve). **Mantenere** la funzione `numeroDocumento` in `format.ts` (la usa l'engine in Task 3) ma non importarla più nei componenti.

> Verificare che ogni query Prisma che alimenta questi componenti selezioni `numeroDocumentoStr` (di default `findMany`/`findUnique` senza `select` restituiscono tutti gli scalari, quindi è già incluso; controllare solo i punti con `select` esplicito).

- [ ] **Step 2: Aggiornare il tipo input del PDF**

In `pdf.ts`, individuare il tipo del parametro di `numeroDocumento(input)` (riga ~92) e sostituirlo con un campo `numeroDocumentoStr: string | null` nel tipo input della funzione di rendering; aggiornare i chiamanti del PDF a passare `doc.numeroDocumentoStr`.

- [ ] **Step 3: Verificare typecheck, lint e build**

Run (da `apps/piattaforma`):
```bash
pnpm typecheck && pnpm lint
```
Expected: PASS, nessun riferimento residuo a `numeroDocumento(` fuori da `engine.ts` e `format.ts`.

Run (controllo manuale):
```bash
grep -rn "numeroDocumento(" apps/piattaforma/src --include=*.ts --include=*.tsx
```
Expected: solo occorrenze in `engine.ts` (chiamata) e `format.ts` (definizione + test).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src
git commit -m "refactor(fatturazione): UI/PDF/XML leggono il numero documento congelato"
```

---

### Task 5: Aggiornare la documentazione di riferimento (source of truth)

**Files:**
- Modify: `docs/sistema-fatturazione.md` (sezione numerazione, §5)
- Create: `docs/numerazione-fatture-decisioni.md` (verbale decisioni — allinea/supera il `.docx`)
- Modify: `docs/piano-implementazione.md` (se traccia gli step fatturazione: aggiungere la voce numerazione)

**Interfaces:** documentazione, nessun codice.

- [ ] **Step 1: Riscrivere la sezione numerazione di `sistema-fatturazione.md`**

Sostituire la riga "Numerazione progressiva | Distinti registri…" con la descrizione del nuovo schema: formato `PV-<anno>-NNNNN` / `PV-<id4>-<anno>-NNNNN` / `NC-…`, tabella `contatori_fiscali` con chiave `(idSoggetto, tipoDocumento, anno)`, incremento atomico `INSERT … ON CONFLICT`, `numeroSoggetto` da sequence, reset annuale, note di credito su sequenza separata. Rimuovere il riferimento allo pseudocodice `SELECT FOR UPDATE` (§6.5) sostituendolo con il pattern `ON CONFLICT` effettivamente implementato.

- [ ] **Step 2: Creare il verbale decisioni**

Creare `docs/numerazione-fatture-decisioni.md` con: contesto (paper `NumerazioneFatture.docx` di Apr 2025 vs implementazione FT-A di Giu 2026), le 3 decisioni fissate (schema ibrido con reset annuale; granularità per azienda madre; note di credito separate), e la nota che il `.docx` originale (formato continuo senza reset, sequenza per sotto-account) è **superato** da queste decisioni. Aggiungere i 2 punti da confermare col commercialista: (a) legittimità del reset annuale sul registro broker conto terzi; (b) uso del prefisso `PV-` su documenti il cui emittente fiscale è il broker.

- [ ] **Step 3: Commit**

```bash
git add docs/sistema-fatturazione.md docs/numerazione-fatture-decisioni.md docs/piano-implementazione.md
git commit -m "docs(fatturazione): allinea spec numerazione al paper + verbale decisioni"
```

---

### Task 6: Verifica end-to-end e chiusura

**Files:** nessuna modifica; verifica integrata.

- [ ] **Step 1: Full check del package**

Run (dalla root):
```bash
pnpm -w turbo run typecheck lint test --filter=piattaforma
```
Expected: typecheck/lint PASS; suite vitest verde (format unit test PASS; integration `skipped` o PASS se DB su).

- [ ] **Step 2: E2E manuale sul flusso reale (Postgres locale + seed)**

Avviare l'app (`pnpm dev`) e, con gli utenti del seed:
1. Completare una pratica fino alla firma → verificare in `/fatturazione` (lato agenzia/admin) che la `FATTURA_PV` abbia numero `PV-<anno>-00001`.
2. Forzare un payout broker (job payout) → verificare il `DOC_BROKER` con numero `PV-<id4>-<anno>-00001` (dove `<id4>` = `numeroSoggetto` del broker).
3. Aprire il dettaglio documento e scaricare l'XML → verificare che il tag `Numero` FatturaPA contenga la stringa congelata.

Expected: numeri nel nuovo formato; nessun duplicato; sequenze indipendenti per soggetto.

- [ ] **Step 3: Verifica anti-buchi/duplicati a DB**

Run (psql sul DB locale):
```sql
SELECT "emittenteCompanyId", "tipo", "anno", count(*), count(DISTINCT "numeroProgressivo")
FROM documenti_fiscali GROUP BY 1,2,3 HAVING count(*) <> count(DISTINCT "numeroProgressivo");
```
Expected: 0 righe (nessun progressivo duplicato per registro).

- [ ] **Step 4: Commit finale / merge**

Procedere secondo `superpowers:finishing-a-development-branch` (merge su `main`; la migration in prod si applica a mano via `prisma migrate deploy` sul DB Neon `ep-solitary-night`, come da processo di rilascio).

---

## Self-Review

**Spec coverage (paper → task):**
- Due sistemi separati (PV / conto terzi) → Task 1 (`idSoggetto`), Task 2/3 (formato + engine). ✓
- Formato `PV-00001` / `PV-ID-00001` (+ anno, decisione ibrida) → Task 2. ✓
- Sequenza per broker indipendente, mai azzerata tra broker → `idSoggetto = Company.id` in `contatori_fiscali`. ✓ (reset annuale = decisione esplicita che diverge dal "mai" del paper, verbalizzata in Task 5.)
- ID soggetto assegnato alla creazione, univoco, mai riusato → Task 1 (Postgres `SEQUENCE` + default). ✓
- Tabella contatori dedicata (`id_soggetto`, `tipo_documento`, `contatore`, `ultimo_aggiornamento`) → Task 1 `contatori_fiscali` (`idSoggetto`, `tipoDocumento`, `contatore`, `aggiornatoAt`). ✓
- Incremento atomico, no buchi/duplicati, rollback se fallisce → Task 3 `INSERT … ON CONFLICT … RETURNING` dentro `$transaction`; verifica concorrenza Task 3 Step 4 + Task 6 Step 3. ✓
- Zero-padding 5 cifre (numero) / 4 cifre (id) → Task 2 `pad()`. ✓
- Nota di credito sequenza separata → Task 1 enum `NOTA_CREDITO` + Task 3 `createNotaCredito`. ✓

**Placeholder scan:** nessun "TBD/TODO" nei passi implementativi; codice completo in ogni step. (Il `PENALE_BROKER` resta senza path di creazione, coerente con lo stato attuale `fatturaPaTipoPerRegime` → null; gestito solo a livello di formato.)

**Type consistency:** `prossimoContatore(tx, idSoggetto, tipo, anno)` usato con la stessa firma in tutte e tre le funzioni engine; `ContatoreFiscaleTipo` ('FATTURA_PV'|'DOC_BROKER'|'NOTA_CREDITO'|'PENALE') distinto da `DocumentoFiscaleTipo` ('FATTURA_PV'|'DOC_BROKER'|'NOTA_VARIAZIONE'|'PENALE_BROKER') — il mapping NOTA_VARIAZIONE→NOTA_CREDITO è esplicito in `createNotaCredito`. `numeroDocumento` riceve `emittenteNumeroSoggetto?: number|null` coerente con `Company.numeroSoggetto: number`.

## Punti aperti per il commercialista (non bloccanti per lo sviluppo)

1. **Reset annuale sul registro broker conto terzi** — confermare che il registro dei documenti emessi da PV per conto del broker possa azzerarsi a inizio anno (come per il registro proprio PV). Se il commercialista preferisce il continuo perpetuo per i broker, basta togliere `anno` dalla chiave del contatore di quel `tipoDocumento` (modifica localizzata a `prossimoContatore` + migration).
2. **Prefisso `PV-` su documenti emessi dal broker** — il numero `PV-0047-…` è univoco nel registro del broker; confermare che il prefisso commerciale `PV-` su un documento il cui CedentePrestatore è il broker non crei ambiguità.
