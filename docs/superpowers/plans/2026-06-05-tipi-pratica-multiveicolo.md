# Tipi pratica (semplice/minivoltura) + multi-veicolo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rinominare i tipi pratica in `SEMPLICE`/`MINIVOLTURA` (acquirente privato vs commerciante) e supportare la cattura di **n veicoli** per pratica (modello `Veicolo`), con le 4 opzioni semplice/minivoltura × singolo/multiplo.

**Architecture:** Enum `PraticaTipo` ridotto a `SEMPLICE|MINIVOLTURA`; "singolo/multiplo" deriva da `numeroVeicoli`. Nuovo modello `Veicolo` (1 pratica → n veicoli) con i campi veicolo (oggi denormalizzati su `Pratica`, che vengono rimossi). Libretto = `Documento` legato al `Veicolo`. Pricing per-veicolo ×n. Engine documenti per-veicolo. Wizard con 4 card + sezione veicolo ripetuta; per minivoltura l'acquirente è `OPERATORE_AUTO`.

**Tech Stack:** Next.js 16, Prisma/Postgres (Neon prod), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-05-tipi-pratica-multiveicolo-design.md`

**Processo prod:** migration manuale su Neon `solitary-night` PRIMA del push (vedi [[project-prod-release-process]]). Locale: `db push` + reseed.

---

## Mappa file
- `apps/piattaforma/src/lib/pricing.ts` (+test) — enum + fee per-veicolo
- `packages/db/prisma/schema.prisma` — enum, modello `Veicolo`, `Documento.veicoloId`, rimozione campi veicolo da `Pratica`
- `packages/db/prisma/migrations/<ts>_tipi_pratica_multiveicolo/migration.sql` — rename enum + create veicoli + backfill + drop colonne
- `apps/piattaforma/src/lib/documenti/engine.ts` (+test) — input multi-veicolo, doc per-veicolo, acquirente OPERATORE_AUTO
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — submit con veicoli[], create Veicolo, fee
- `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — 4 card + sezione veicoli ripetuta + acquirente operatore-auto
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx` — labelTipo + lista veicoli
- `apps/piattaforma/src/lib/documenti/revisione.ts` — adeguare placeholder tipo
- `packages/db/prisma/seed.ts` — enum + veicoli

**Comandi:** test `pnpm --filter piattaforma test` · typecheck `pnpm --filter piattaforma typecheck` · lint `pnpm --filter piattaforma lint` · build `pnpm --filter piattaforma build`.

---

### Task 1: Pricing — enum SEMPLICE/MINIVOLTURA, fee per-veicolo

**Files:** Modify `apps/piattaforma/src/lib/pricing.ts`; Modify `apps/piattaforma/src/lib/pricing.test.ts`

- [ ] **Step 1: Aggiorna i test** (`pricing.test.ts`) — sostituisci i casi esistenti con i 4 nuovi:
```ts
import { describe, it, expect } from 'vitest';
import { computeFees } from './pricing';

describe('computeFees', () => {
  it('SEMPLICE singolo (1 veicolo): 75/25/50/10', () => {
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 1 })).toEqual({
      feeAgenziaCent: 7500, creditoBrokerCent: 2500, ricavoLordoCent: 5000, costoAffiliazioneTotaleCent: 1000,
    });
  });
  it('SEMPLICE multiplo (3 veicoli): scala ×3', () => {
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 3 })).toEqual({
      feeAgenziaCent: 22500, creditoBrokerCent: 7500, ricavoLordoCent: 15000, costoAffiliazioneTotaleCent: 3000,
    });
  });
  it('MINIVOLTURA singola (1 veicolo): 15/0/15/5', () => {
    expect(computeFees({ tipo: 'MINIVOLTURA', numeroVeicoli: 1 })).toEqual({
      feeAgenziaCent: 1500, creditoBrokerCent: 0, ricavoLordoCent: 1500, costoAffiliazioneTotaleCent: 500,
    });
  });
  it('MINIVOLTURA multipla (4 veicoli): scala ×4', () => {
    expect(computeFees({ tipo: 'MINIVOLTURA', numeroVeicoli: 4 })).toEqual({
      feeAgenziaCent: 6000, creditoBrokerCent: 0, ricavoLordoCent: 6000, costoAffiliazioneTotaleCent: 2000,
    });
  });
  it('lancia se numeroVeicoli < 1', () => {
    expect(() => computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Esegui (fallisce)** — `pnpm --filter piattaforma test -- pricing` (vecchi valori enum non più validi).

- [ ] **Step 3: Implementa** — sostituisci `apps/piattaforma/src/lib/pricing.ts`:
```ts
// Engine economico Passaggio Veloce. Fee PER VEICOLO × numeroVeicoli.
// SEMPLICE (acquirente privato): agenzia 75€, broker 25€, lordo 50€, affiliazione 10€ — per veicolo.
// MINIVOLTURA (acquirente commerciante): agenzia 15€, broker 0, lordo 15€, affiliazione 5€ — per veicolo.

export type PraticaTipoEconomico = 'SEMPLICE' | 'MINIVOLTURA';

export type FeeBreakdown = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  ricavoLordoCent: number;
  costoAffiliazioneTotaleCent: number;
};

const PER_VEICOLO: Record<PraticaTipoEconomico, FeeBreakdown> = {
  SEMPLICE: { feeAgenziaCent: 7500, creditoBrokerCent: 2500, ricavoLordoCent: 5000, costoAffiliazioneTotaleCent: 1000 },
  MINIVOLTURA: { feeAgenziaCent: 1500, creditoBrokerCent: 0, ricavoLordoCent: 1500, costoAffiliazioneTotaleCent: 500 },
};

export function computeFees(input: { tipo: PraticaTipoEconomico; numeroVeicoli: number }): FeeBreakdown {
  const { tipo, numeroVeicoli } = input;
  if (!Number.isInteger(numeroVeicoli) || numeroVeicoli < 1) {
    throw new Error(`numeroVeicoli deve essere un intero >= 1, ricevuto ${numeroVeicoli}`);
  }
  const u = PER_VEICOLO[tipo];
  if (!u) throw new Error(`tipo non supportato: ${tipo}`);
  return {
    feeAgenziaCent: u.feeAgenziaCent * numeroVeicoli,
    creditoBrokerCent: u.creditoBrokerCent * numeroVeicoli,
    ricavoLordoCent: u.ricavoLordoCent * numeroVeicoli,
    costoAffiliazioneTotaleCent: u.costoAffiliazioneTotaleCent * numeroVeicoli,
  };
}
```

- [ ] **Step 4: Esegui (passa)** — `pnpm --filter piattaforma test -- pricing` → PASS. NB: il typecheck globale fallirà finché i chiamanti usano i vecchi valori enum: è atteso, lo sistemiamo nei task successivi. Non eseguire il typecheck globale qui.

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/pricing.ts apps/piattaforma/src/lib/pricing.test.ts
git commit -m "feat(pricing): tipi SEMPLICE/MINIVOLTURA con fee per-veicolo"
```

---

### Task 2: Modello dati Prisma + migration (Veicolo, enum, Documento.veicoloId)

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/20260605140000_tipi_pratica_multiveicolo/migration.sql`

> Pattern repo: locale = `db push`; prod = migration hand-written applicata con `migrate deploy` (vedi [[project-prod-release-process]]). La migration deve preservare i dati prod: rename enum (label) + backfill veicoli PRIMA di droppare le colonne.

- [ ] **Step 1: Modifica `schema.prisma`**

(a) Enum:
```prisma
enum PraticaTipo {
  SEMPLICE
  MINIVOLTURA
}
```
(b) Nel modello `Pratica`: RIMUOVI le righe `targa`, `telaio`, `proprietarioAttuale`, `dataImmatricolazione`, `preImm2015`, `flagComodatoDuso`. MANTIENI `numeroVeicoli Int @default(1)`. AGGIUNGI la relazione:
```prisma
  veicoli Veicolo[]
```
(c) Nuovo modello (vicino a `Documento`):
```prisma
model Veicolo {
  id                   String    @id @default(uuid()) @db.Uuid
  praticaId            String    @db.Uuid
  pratica              Pratica   @relation(fields: [praticaId], references: [id], onDelete: Cascade)
  ordine               Int
  targa                String?
  telaio               String?
  proprietarioAttuale  String?
  dataImmatricolazione DateTime?
  preImm2015           Boolean   @default(false)
  flagComodatoDuso     Boolean   @default(false)
  ocrData              Json?
  ocrProvider          String?
  ocrAt                DateTime?
  documenti            Documento[] @relation("DocumentiVeicolo")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([praticaId])
  @@map("veicoli")
}
```
(d) Nel modello `Documento`: aggiungi
```prisma
  veicoloId String?  @db.Uuid
  veicolo   Veicolo? @relation("DocumentiVeicolo", fields: [veicoloId], references: [id], onDelete: SetNull)
```
e l'indice `@@index([veicoloId])` insieme agli altri `@@index`.

- [ ] **Step 2: Applica in locale + regenera client**
```bash
pnpm --filter @pv/db exec prisma db push
pnpm --filter @pv/db exec prisma generate
```
Atteso: schema sincronizzato in locale (perdita dati dev accettabile; reseed nel Task 8).

- [ ] **Step 3: Scrivi la migration per PROD** — Create `packages/db/prisma/migrations/20260605140000_tipi_pratica_multiveicolo/migration.sql` (confronta lo stile con una migration esistente, es. `*_promo_codes`):
```sql
-- Tipi pratica SEMPLICE/MINIVOLTURA + modello Veicolo (n veicoli per pratica).

-- 1. Rename enum (le righe esistenti riflettono il nuovo label automaticamente)
ALTER TYPE "PraticaTipo" RENAME VALUE 'PASSAGGIO_PRIVATO' TO 'SEMPLICE';
ALTER TYPE "PraticaTipo" RENAME VALUE 'MINIVOLTURE_MULTIPLE' TO 'MINIVOLTURA';

-- 2. Tabella veicoli
CREATE TABLE "veicoli" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "targa" TEXT,
    "telaio" TEXT,
    "proprietarioAttuale" TEXT,
    "dataImmatricolazione" TIMESTAMP(3),
    "preImm2015" BOOLEAN NOT NULL DEFAULT false,
    "flagComodatoDuso" BOOLEAN NOT NULL DEFAULT false,
    "ocrData" JSONB,
    "ocrProvider" TEXT,
    "ocrAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "veicoli_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "veicoli_praticaId_idx" ON "veicoli"("praticaId");
ALTER TABLE "veicoli" ADD CONSTRAINT "veicoli_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. documenti.veicoloId
ALTER TABLE "documenti" ADD COLUMN "veicoloId" UUID;
CREATE INDEX "documenti_veicoloId_idx" ON "documenti"("veicoloId");
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_veicoloId_fkey" FOREIGN KEY ("veicoloId") REFERENCES "veicoli"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Backfill: 1 veicolo per pratica dai campi denormalizzati
INSERT INTO "veicoli" ("id","praticaId","ordine","targa","telaio","proprietarioAttuale","dataImmatricolazione","preImm2015","flagComodatoDuso","createdAt","updatedAt")
SELECT gen_random_uuid(), p."id", 1, p."targa", p."telaio", p."proprietarioAttuale", p."dataImmatricolazione", p."preImm2015", p."flagComodatoDuso", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pratiche" p;

-- 5. Collega il libretto esistente di ogni pratica al suo veicolo
UPDATE "documenti" d SET "veicoloId" = v."id"
FROM "veicoli" v
WHERE v."praticaId" = d."praticaId" AND d."tipo" = 'LIBRETTO_CIRCOLAZIONE';

-- 6. Droppa le colonne veicolo denormalizzate da pratiche
ALTER TABLE "pratiche"
  DROP COLUMN "targa",
  DROP COLUMN "telaio",
  DROP COLUMN "proprietarioAttuale",
  DROP COLUMN "dataImmatricolazione",
  DROP COLUMN "preImm2015",
  DROP COLUMN "flagComodatoDuso";
```
> Verifica i nomi colonna esatti in `pratiche` (apri un'altra migration o lo schema introspettato) prima di committare. Le `ALTER TYPE ... RENAME VALUE` sono supportate da Neon (PG15).

- [ ] **Step 4: Verifica typecheck di @pv/db** — `pnpm --filter @pv/db typecheck` (se presente) o `pnpm --filter piattaforma typecheck` (fallirà sui chiamanti dei campi rimossi: atteso, prossimi task).

- [ ] **Step 5: Commit**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260605140000_tipi_pratica_multiveicolo/
git commit -m "feat(db): modello Veicolo + enum SEMPLICE/MINIVOLTURA + migration"
```

---

### Task 3: Engine documenti — input multi-veicolo + acquirente operatore-auto

**Files:** Modify `apps/piattaforma/src/lib/documenti/engine.ts`; Modify `apps/piattaforma/src/lib/documenti/engine.test.ts`

- [ ] **Step 1: Aggiorna l'input type e i test.** L'input passa da campi veicolo singoli a una **lista veicoli**. Sostituisci in `SchemaDocumentaleInput` le righe `preImm2015`/`flagComodatoDuso` con:
```ts
  veicoli: { ordine: number; preImm2015: boolean; flagComodatoDuso: boolean }[];
```
Aggiungi a `DocumentoRichiesto` il campo opzionale:
```ts
  veicoloOrdine?: number;
```
In `engine.test.ts`: aggiorna i test esistenti a passare `veicoli: [{ ordine: 1, preImm2015: false, flagComodatoDuso: false }]` invece dei campi singoli, e AGGIUNGI:
```ts
it('due veicoli: libretto per ciascuno + CdP solo sul pre-2015', () => {
  const r = calcolaDocumentiRichiesti({
    veicoli: [
      { ordine: 1, preImm2015: false, flagComodatoDuso: false },
      { ordine: 2, preImm2015: true, flagComodatoDuso: false },
    ],
    venditoreTipoSoggetto: 'PRIVATO_ITALIANO_CIE', venditoreVisuraData: null, venditorePermessoData: null,
    flagProcura: false, flagSuccessione: false,
    acquirenteTipoSoggetto: 'PRIVATO_ITALIANO_CIE', acquirenteVisuraData: null, acquirentePermessoData: null,
    flagMinore: false,
  });
  expect(r.kind).toBe('OK');
  if (r.kind === 'OK') {
    const libretti = r.documentiRichiesti.filter((d) => d.tipo === 'LIBRETTO_CIRCOLAZIONE');
    expect(libretti.map((d) => d.veicoloOrdine)).toEqual([1, 2]);
    const cdp = r.documentiRichiesti.filter((d) => d.tipo === 'CERTIFICATO_PROPRIETA');
    expect(cdp).toHaveLength(1);
    expect(cdp[0]!.veicoloOrdine).toBe(2);
  }
});

it('acquirente OPERATORE_AUTO (minivoltura): blocco se visura non fresca', () => {
  const r = calcolaDocumentiRichiesti({
    veicoli: [{ ordine: 1, preImm2015: false, flagComodatoDuso: false }],
    venditoreTipoSoggetto: 'PRIVATO_ITALIANO_CIE', venditoreVisuraData: null, venditorePermessoData: null,
    flagProcura: false, flagSuccessione: false,
    acquirenteTipoSoggetto: 'OPERATORE_AUTO', acquirenteVisuraData: null, acquirentePermessoData: null,
    flagMinore: false,
  });
  expect(r.kind).toBe('BLOCCO');
});

it('comodato attivo su un veicolo qualsiasi: blocco', () => {
  const r = calcolaDocumentiRichiesti({
    veicoli: [
      { ordine: 1, preImm2015: false, flagComodatoDuso: false },
      { ordine: 2, preImm2015: false, flagComodatoDuso: true },
    ],
    venditoreTipoSoggetto: 'PRIVATO_ITALIANO_CIE', venditoreVisuraData: null, venditorePermessoData: null,
    flagProcura: false, flagSuccessione: false,
    acquirenteTipoSoggetto: 'PRIVATO_ITALIANO_CIE', acquirenteVisuraData: null, acquirentePermessoData: null,
    flagMinore: false,
  });
  expect(r.kind).toBe('BLOCCO');
});
```

- [ ] **Step 2: Esegui (fallisce)** — `pnpm --filter piattaforma test -- documenti/engine`.

- [ ] **Step 3: Implementa** in `engine.ts`:
  - Cambia il blocco comodato (riga ~192) da `if (input.flagComodatoDuso)` a `if (input.veicoli.some((v) => v.flagComodatoDuso))`.
  - Aggiungi il blocco visura acquirente per OPERATORE_AUTO: cambia la condizione (riga ~234-235) da `input.acquirenteTipoSoggetto === 'AZIENDA'` a `(input.acquirenteTipoSoggetto === 'AZIENDA' || input.acquirenteTipoSoggetto === 'OPERATORE_AUTO')`.
  - Sostituisci il blocco "Sempre: libretto" + "Pre-2015: CdP" (righe ~249-263) con un loop per veicolo:
```ts
  for (const v of input.veicoli) {
    out.push({
      tipo: 'LIBRETTO_CIRCOLAZIONE', parte: 'VEICOLO', veicoloOrdine: v.ordine,
      motivo: `Libretto di circolazione veicolo ${v.ordine} (sempre obbligatorio)`,
    });
    if (v.preImm2015) {
      out.push({
        tipo: 'CERTIFICATO_PROPRIETA', parte: 'VEICOLO', veicoloOrdine: v.ordine,
        motivo: `Veicolo ${v.ordine} immatricolato pre-2015: serve CdP`,
      });
    }
  }
```

- [ ] **Step 4: Esegui (passa)** — `pnpm --filter piattaforma test -- documenti/engine` → PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/documenti/engine.ts apps/piattaforma/src/lib/documenti/engine.test.ts
git commit -m "feat(engine): documenti per-veicolo + acquirente operatore-auto"
```

---

### Task 4: actions.ts creazione pratica — submit multi-veicolo + fee

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/actions.ts`; Modify `apps/piattaforma/src/lib/documenti/revisione.ts`

> Leggi `actions.ts` per intero prima. Adatta lo schema di validazione del submit e la creazione DB.

- [ ] **Step 1: Aggiorna lo schema submit** — il payload `tipo` ora è `z.enum(['SEMPLICE','MINIVOLTURA'])`; aggiungi `numeroVeicoli` (int 1..50) e un array `veicoli` con, per ciascuno: dati libretto estratti/correggibili (`targa`, `telaio`, `proprietarioAttuale`, `dataImmatricolazione` ISO, `preImm2015`, `flagComodatoDuso`, `ocrData?`) + il file libretto (i file libretto arrivano come slot FormData `LIBRETTO_<ordine>`). Rimuovi i vincoli vecchi (privato==1).

- [ ] **Step 2: Crea Pratica + Veicoli in transazione** — nella creazione: crea la `Pratica` (senza i campi veicolo rimossi; `tipo`, `numeroVeicoli`, `flagMinivoltura: tipo === 'MINIVOLTURA'`, parti, ecc.), poi per ogni veicolo `tx.veicolo.create({ data: { praticaId, ordine, targa, telaio, ... , ocrData } })`, e crea i `Documento` libretto con `veicoloId` del veicolo corrispondente. I documenti delle parti restano legati alla pratica.

- [ ] **Step 3: Fee** — `computeFees({ tipo, numeroVeicoli })` (import da `@/lib/pricing`); persisti `feeAgenziaCent`/`creditoBrokerCent` come oggi.

- [ ] **Step 4: Engine input** — dove si chiama `calcolaDocumentiRichiesti`, passa `veicoli: veicoli.map((v,i) => ({ ordine: i+1, preImm2015: v.preImm2015, flagComodatoDuso: v.flagComodatoDuso }))` invece dei campi singoli.

- [ ] **Step 5: revisione.ts** — in `apps/piattaforma/src/lib/documenti/revisione.ts:~90` il placeholder usa un valore tipo pratica: sostituisci `PASSAGGIO_PRIVATO` con `SEMPLICE` (apri il file e adatta il letterale al nuovo enum).

- [ ] **Step 6: typecheck + test** — `pnpm --filter piattaforma typecheck` e `pnpm --filter piattaforma test`. Aggiorna eventuali fixture in test che usano i vecchi enum/campi.

- [ ] **Step 7: Commit**
```bash
git add "apps/piattaforma/src/app/pratiche/nuova/actions.ts" apps/piattaforma/src/lib/documenti/revisione.ts
git commit -m "feat(pratiche): creazione multi-veicolo (SEMPLICE/MINIVOLTURA) + fee per-veicolo"
```

---

### Task 5: Wizard — 4 card tipo + sezione veicoli ripetuta + acquirente operatore-auto

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

> File grande (~1400 righe). Leggilo per intero. Mantieni i pattern esistenti (componenti UI, ParteForm, anteprima documenti). Modifiche mirate.

- [ ] **Step 1: Tipo + 4 card.** Sostituisci il `Select` tipo (righe ~380-415) con 4 card selezionabili (riusa lo stile card già presente nel wizard/registrazione). Le 4 opzioni e la mappatura su `(tipo, multiplo)`:
  - "Passaggio di proprietà semplice" → `tipo='SEMPLICE'`, multiplo=false
  - "Passaggio di proprietà semplice multiplo" → `tipo='SEMPLICE'`, multiplo=true
  - "Minivoltura singola" → `tipo='MINIVOLTURA'`, multiplo=false
  - "Minivoltura multipla" → `tipo='MINIVOLTURA'`, multiplo=true
  Stato: `tipo: 'SEMPLICE'|'MINIVOLTURA'`, `multiplo: boolean`, `numeroVeicoli: number`. Alla selezione: se non multiplo → `numeroVeicoli=1`; se multiplo → input numerico (min 2, max 50, default 2). Descrizione card: semplice = "chi acquista è un privato", minivoltura = "chi acquista è un commerciante d'auto".

- [ ] **Step 2: Sezione veicoli ripetuta.** Sostituisci la singola sezione libretto (righe ~437-582) con una lista di `numeroVeicoli` sezioni. Stato: `veicoli: VeicoloInput[]` dove `VeicoloInput = { file?: File; ocr?: LibrettoCircolazioneData; targa; telaio; proprietarioAttuale; dataImmatricolazione; preImm2015; flagComodatoDuso }`. Per ciascun veicolo: upload libretto → `extractLibrettoAction` (riusa la logica esistente per veicolo) → campi correggibili. Quando `numeroVeicoli` cambia, ridimensiona l'array (aggiungi/rimuovi in coda). Etichetta ogni sezione "Veicolo N".

- [ ] **Step 3: Acquirente operatore-auto per minivoltura.** I tipi soggetto acquirente: se `tipo==='MINIVOLTURA'` includi/forza `OPERATORE_AUTO` (con campo visura, come AZIENDA); se `tipo==='SEMPLICE'` usa la lista attuale senza OPERATORE_AUTO. Aggiorna `TIPI_SOGGETTO_ACQUIRENTE` in base al tipo (calcolalo dinamicamente dallo stato `tipo`).

- [ ] **Step 4: Anteprima documenti.** Dove si chiama `calcolaDocumentiRichiesti` per l'anteprima, passa `veicoli: veicoli.map((v,i)=>({ordine:i+1, preImm2015:v.preImm2015, flagComodatoDuso:v.flagComodatoDuso}))`. Raggruppa/mostra i documenti libretto per veicolo (usa `veicoloOrdine`).

- [ ] **Step 5: Submit.** Costruisci il FormData con i dati di tutti i veicoli + i file libretto come slot `LIBRETTO_1..LIBRETTO_n` (coerente col Task 4), `tipo`, `numeroVeicoli`. Adatta la chiamata all'action di submit.

- [ ] **Step 6: typecheck + lint + build** — `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && pnpm --filter piattaforma build` → PASS.

- [ ] **Step 7: Commit**
```bash
git add "apps/piattaforma/src/app/pratiche/nuova/wizard.tsx"
git commit -m "feat(pratiche): wizard 4 tipi + sezione veicoli ripetuta + acquirente operatore-auto"
```

---

### Task 6: Dettaglio pratica — label tipo + lista veicoli

**Files:** Modify `apps/piattaforma/src/app/pratiche/[id]/page.tsx`

- [ ] **Step 1: labelTipo** (righe ~536-539): mappa i nuovi valori:
```ts
function labelTipo(tipo: PraticaTipo, numeroVeicoli: number): string {
  const base = tipo === 'SEMPLICE' ? 'Passaggio di proprietà semplice' : 'Minivoltura';
  return numeroVeicoli > 1 ? `${base} (multiplo, ${numeroVeicoli} veicoli)` : base;
}
```
(adatta la firma/uso reale; importa `PraticaTipo` da `@pv/db` se serve).

- [ ] **Step 2: Lista veicoli.** Dove oggi si mostrano targa/telaio singoli (campi rimossi), carica e mostra `pratica.veicoli` (includi `veicoli` nella query). Mostra per ciascun veicolo: ordine, targa, telaio, data immatricolazione. Verifica le altre pagine che leggevano `pratica.targa` ecc. con `pnpm --filter piattaforma exec grep -rn "\\.targa\\|\\.telaio\\|proprietarioAttuale\\|dataImmatricolazione\\|preImm2015\\|flagComodatoDuso" src` e adattale a `veicoli[0]`/lista.

- [ ] **Step 3: typecheck + build** — `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma build` → PASS.

- [ ] **Step 4: Commit**
```bash
git add "apps/piattaforma/src/app/pratiche/[id]/page.tsx"
git commit -m "feat(pratiche): dettaglio con label tipo nuovo e lista veicoli"
```

---

### Task 7: Seed

**Files:** Modify `packages/db/prisma/seed.ts`

- [ ] **Step 1: Aggiorna enum + veicoli.** Sostituisci i valori `PASSAGGIO_PRIVATO`/`MINIVOLTURE_MULTIPLE` con `SEMPLICE`/`MINIVOLTURA`. Per ogni pratica di esempio, rimuovi i campi veicolo dalla create della Pratica e crea i `Veicolo` collegati (almeno 1; per le minivolture multiple, ≥2). Collega il `Documento` libretto al veicolo.

- [ ] **Step 2: Esegui il seed** — `pnpm --filter @pv/db exec prisma db seed` → completa senza errori.

- [ ] **Step 3: Commit**
```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(seed): pratiche con tipi nuovi e veicoli collegati"
```

---

### Task 8: Verifica finale

- [ ] **Step 1:** `pnpm --filter piattaforma test` → tutti PASS.
- [ ] **Step 2:** `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && pnpm --filter piattaforma build` → PASS.
- [ ] **Step 3:** Commit eventuali fix: `git add -A && git commit -m "chore: verifica finale tipi pratica multi-veicolo"`.

---

## Note di deploy (dopo i task)
1. **Migration prod** `solitary-night`: `migrate deploy` applica `20260605140000_tipi_pratica_multiveicolo` (rename enum + backfill veicoli + drop colonne) PRIMA del push. Verifica conteggio: `veicoli` creati == `pratiche` esistenti; libretti collegati.
2. **Deploy:** merge branch → main → push.
3. **E2E** (chrome-devtools): crea una minivoltura multipla con 2 libretti e verifica fee (15€×2) + documenti per-veicolo; crea un passaggio semplice singolo.

## Self-review (eseguita)
- **Copertura spec:** enum+Veicolo+Documento.veicoloId (Task 2), pricing (1), engine per-veicolo (3), actions (4), wizard 4 card + veicoli ripetuti + acquirente operatore-auto (5), dettaglio (6), seed (7), migration prod (Task 2 + note deploy), test (1/3/8). ✔
- **Tipi coerenti:** `SEMPLICE`/`MINIVOLTURA`, `PraticaTipoEconomico`, `Veicolo`, `veicoli[]` in engine input, `veicoloOrdine`, `LIBRETTO_<n>` slot — coerenti tra task. ✔
- **Rischi:** la migration prod (rename enum + drop colonne con backfill) è il punto critico → ordine esplicitato; verificare nomi colonna reali. Il wizard è ampio → task con sotto-step chiari, l'implementer legge il file e adatta ai pattern esistenti.
