# Fatturazione — Fase FT-A (schema + engine + record) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creare il modello `DocumentoFiscale` + dati fiscali, e generare automaticamente i record dei documenti (fattura PV→agenzia alla firma; documento broker aggregato al payout) con numerazione progressiva e split importi per regime. Nessun PDF/XML/UI (fasi successive).

**Architecture:** Schema additivo (`Company.regimeFiscale` + `DocumentoFiscale` + back-ref); funzioni pure testabili per split importi e tipo documento; numerazione progressiva transaction-safe per emittente/anno; engine `lib/fatturazione/` con `createFatturaPv`/`createDocBroker`/`createNotaCredito`; hook best-effort su firma e su payout eseguito.

**Tech Stack:** Prisma + Postgres, TypeScript, Vitest, Next.js server actions/jobs.

**Spec:** `docs/superpowers/specs/2026-06-14-fatturazione-completa-design.md` (+ design `docs/sistema-fatturazione.md`).

---

## Task 1: Schema — `regimeFiscale`, `DocumentoFiscale`, back-ref + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration `packages/db/prisma/migrations/<ts>_fatturazione_ft_a/migration.sql`

- [ ] **Step 1: Enum + estensione `Company`**

In `schema.prisma`, aggiungere gli enum e i campi a `Company`:
```prisma
enum RegimeFiscale {
  ORDINARIO
  FORFETTARIO
  PRIVATO
}
```
Dentro `model Company { … }` aggiungere:
```prisma
  regimeFiscale         RegimeFiscale @default(ORDINARIO)
  // Registro progressivo dei documenti emessi PER CONTO di questo broker (DOC_BROKER)
  numeratoreFiscaleAnno Int?
  numeratoreFiscaleNum  Int?
  documentiEmessi   DocumentoFiscale[] @relation("DocumentiEmessi")
  documentiRicevuti DocumentoFiscale[] @relation("DocumentiRicevuti")
```

- [ ] **Step 2: Enum documento + modello `DocumentoFiscale`**

Aggiungere:
```prisma
enum DocumentoFiscaleTipo {
  FATTURA_PV
  DOC_BROKER
  PENALE_BROKER
  NOTA_VARIAZIONE
}
enum FatturaPaTipo {
  TD01
  TD06
  TD04
  TD05
}
enum DocumentoFiscaleStatoPagamento {
  IN_ATTESA
  PAGATA
  SCADUTA
  STORNATA
}

model DocumentoFiscale {
  id String @id @default(uuid()) @db.Uuid

  tipo          DocumentoFiscaleTipo
  fatturaPaTipo FatturaPaTipo?

  // Riferimenti: FATTURA_PV → pratica; DOC_BROKER → payout; NOTA_VARIAZIONE → originale
  praticaId String?  @db.Uuid
  pratica   Pratica? @relation(fields: [praticaId], references: [id])
  payoutId  String?  @db.Uuid
  payout    Payout?  @relation(fields: [payoutId], references: [id])

  emittenteCompanyId String?  @db.Uuid
  emittenteCompany   Company? @relation("DocumentiEmessi", fields: [emittenteCompanyId], references: [id])
  destinatarioCompanyId String  @db.Uuid
  destinatarioCompany   Company @relation("DocumentiRicevuti", fields: [destinatarioCompanyId], references: [id])

  // Snapshot immutabili dei dati fiscali al momento dell'emissione (ragione sociale,
  // P.IVA, indirizzo, SDI/PEC) — i documenti non cambiano se l'azienda aggiorna i dati.
  datiEmittente    Json
  datiDestinatario Json

  numeroProgressivo Int
  anno              Int

  importoLordoCent    Int // negativo per NOTA_VARIAZIONE (TD04)
  imponibileCent      Int?
  ivaCent             Int?
  aliquotaIvaPct      Int?
  ritenutaAccontoCent Int?

  statoPagamento DocumentoFiscaleStatoPagamento @default(IN_ATTESA)
  trasmessoSdiAt DateTime?
  trasmessoSdiBy String?  @db.Uuid

  pdfStorageKey String?
  xmlStorageKey String?
  pdfHash       String?

  feeAddebitoId       String? @db.Uuid
  transazioneWalletId String? @db.Uuid @unique

  notaVariazionePerId  String?            @db.Uuid
  notaVariazionePer    DocumentoFiscale?  @relation("NoteVariazione", fields: [notaVariazionePerId], references: [id])
  notaVariazioneFiglie DocumentoFiscale[] @relation("NoteVariazione")

  emessoAt       DateTime  @default(now())
  inviatoEmailAt DateTime?

  @@unique([emittenteCompanyId, anno, numeroProgressivo, tipo])
  @@index([praticaId])
  @@index([payoutId])
  @@index([destinatarioCompanyId, statoPagamento])
  @@index([emittenteCompanyId, anno])
  @@index([emessoAt])
  @@map("documenti_fiscali")
}
```

- [ ] **Step 3: Back-ref su `Pratica` e `Payout`**

In `model Pratica` aggiungere: `documentiFiscali DocumentoFiscale[]`
In `model Payout` aggiungere: `documentoFiscale DocumentoFiscale?`

- [ ] **Step 4: Migration (additiva, backward-compatible) + generate**

Assicurarsi del Postgres dev attivo, poi:
Run: `cd packages/db && pnpm exec prisma migrate dev --name fatturazione_ft_a`
Expected: crea tabella `documenti_fiscali`, enum, colonne `Company.regime_fiscale` (default ORDINARIO) + numeratori (nullable) — tutto additivo (nessun data-loss → non-interattivo OK). Rigenera il client.
(Se l'ambiente blocca `migrate dev`: creare la migration a mano e `prisma migrate deploy`, come da `project-prod-release-process`.)

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/piattaforma && pnpm typecheck` → nessun errore.
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(fatturazione): schema DocumentoFiscale + regimeFiscale + back-ref (FT-A)"
```

---

## Task 2: Funzioni pure — split importi per regime + tipo documento

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/calcolo.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/calcolo.test.ts`

- [ ] **Step 1: Test (TDD)**

Create `calcolo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { splitImporto, fatturaPaTipoPerRegime } from './calcolo';

describe('splitImporto', () => {
  it('ORDINARIO: scorpora IVA 22% da lordo', () => {
    // 75,00€ lordi → 61,48 imponibile + 13,52 IVA
    expect(splitImporto(7500, 'ORDINARIO')).toEqual({
      imponibileCent: 6148,
      ivaCent: 1352,
      aliquotaIvaPct: 22,
    });
  });

  it('FORFETTARIO: fuori campo IVA (iva 0, imponibile = lordo)', () => {
    expect(splitImporto(2000, 'FORFETTARIO')).toEqual({
      imponibileCent: 2000,
      ivaCent: 0,
      aliquotaIvaPct: 0,
    });
  });

  it('PRIVATO: nessuna IVA (imponibile = lordo)', () => {
    expect(splitImporto(2000, 'PRIVATO')).toEqual({
      imponibileCent: 2000,
      ivaCent: 0,
      aliquotaIvaPct: 0,
    });
  });

  it('preserva il segno per importi negativi (note di credito)', () => {
    expect(splitImporto(-7500, 'ORDINARIO')).toEqual({
      imponibileCent: -6148,
      ivaCent: -1352,
      aliquotaIvaPct: 22,
    });
  });
});

describe('fatturaPaTipoPerRegime', () => {
  it('FATTURA_PV è sempre TD01', () => {
    expect(fatturaPaTipoPerRegime('FATTURA_PV', 'FORFETTARIO')).toBe('TD01');
  });
  it('DOC_BROKER ordinario → TD01', () => {
    expect(fatturaPaTipoPerRegime('DOC_BROKER', 'ORDINARIO')).toBe('TD01');
  });
  it('DOC_BROKER forfettario → TD06', () => {
    expect(fatturaPaTipoPerRegime('DOC_BROKER', 'FORFETTARIO')).toBe('TD06');
  });
  it('DOC_BROKER privato → null (ricevuta non fiscale, no XML)', () => {
    expect(fatturaPaTipoPerRegime('DOC_BROKER', 'PRIVATO')).toBeNull();
  });
  it('NOTA_VARIAZIONE → TD04', () => {
    expect(fatturaPaTipoPerRegime('NOTA_VARIAZIONE', 'ORDINARIO')).toBe('TD04');
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`cd apps/piattaforma && pnpm test -- fatturazione/calcolo`).

- [ ] **Step 3: Implementazione**

Create `calcolo.ts`:
```ts
import type { RegimeFiscale, DocumentoFiscaleTipo, FatturaPaTipo } from '@pv/db';

export type SplitImporto = {
  imponibileCent: number;
  ivaCent: number;
  aliquotaIvaPct: number;
};

/**
 * Scorpora un importo LORDO in imponibile + IVA secondo il regime.
 * ORDINARIO: IVA 22% scorporata. FORFETTARIO/PRIVATO: fuori campo (iva 0).
 * Preserva il segno (per le note di credito negative).
 */
export function splitImporto(lordoCent: number, regime: RegimeFiscale): SplitImporto {
  if (regime === 'ORDINARIO') {
    const imponibile = Math.round(lordoCent / 1.22);
    return { imponibileCent: imponibile, ivaCent: lordoCent - imponibile, aliquotaIvaPct: 22 };
  }
  return { imponibileCent: lordoCent, ivaCent: 0, aliquotaIvaPct: 0 };
}

/**
 * Tipo FatturaPA in base al tipo documento e al regime dell'emittente.
 * FATTURA_PV (emittente PV, ordinario) → TD01. NOTA_VARIAZIONE → TD04.
 * DOC_BROKER → TD01 (ordinario) / TD06 (forfettario) / null (privato, ricevuta non fiscale).
 */
export function fatturaPaTipoPerRegime(
  tipo: DocumentoFiscaleTipo,
  regime: RegimeFiscale,
): FatturaPaTipo | null {
  if (tipo === 'NOTA_VARIAZIONE') return 'TD04';
  if (tipo === 'FATTURA_PV') return 'TD01';
  if (tipo === 'DOC_BROKER') {
    if (regime === 'ORDINARIO') return 'TD01';
    if (regime === 'FORFETTARIO') return 'TD06';
    return null; // PRIVATO
  }
  return null; // PENALE_BROKER → TBD
}
```

- [ ] **Step 4: Run test → PASS**. Run: `cd apps/piattaforma && pnpm test -- fatturazione/calcolo`.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/calcolo.ts apps/piattaforma/src/lib/fatturazione/calcolo.test.ts
git commit -m "feat(fatturazione): split importi per regime + tipo FatturaPA (puro, testato)"
```

---

## Task 3: Numerazione progressiva (transaction-safe)

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/numerazione.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/numerazione.test.ts`

- [ ] **Step 1: Test sulla logica pura di prossimo numero**

Create `numerazione.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { prossimoNumero } from './numerazione';

describe('prossimoNumero', () => {
  it('primo documento dell'anno → 1', () => {
    expect(prossimoNumero({ anno: null, num: null }, 2026)).toEqual({ anno: 2026, num: 1 });
  });
  it('stesso anno → incremento', () => {
    expect(prossimoNumero({ anno: 2026, num: 5 }, 2026)).toEqual({ anno: 2026, num: 6 });
  });
  it('nuovo anno fiscale → reset a 1', () => {
    expect(prossimoNumero({ anno: 2025, num: 42 }, 2026)).toEqual({ anno: 2026, num: 1 });
  });
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implementazione**

Create `numerazione.ts`:
```ts
/** Logica pura: dato lo stato del registro {anno,num}, calcola il prossimo per l'anno corrente. */
export function prossimoNumero(
  registro: { anno: number | null; num: number | null },
  annoCorrente: number,
): { anno: number; num: number } {
  if (registro.anno === annoCorrente && registro.num != null) {
    return { anno: annoCorrente, num: registro.num + 1 };
  }
  return { anno: annoCorrente, num: 1 };
}
```
Nota implementativa per l'engine (Task 4): l'assegnazione effettiva del numero avviene **dentro la stessa `prisma.$transaction`** della create del documento, leggendo/aggiornando il registro (per PV: una riga di config dedicata o una company "PV"; per broker: `Company.numeratoreFiscaleAnno/Num`), con il `@@unique([emittenteCompanyId, anno, numeroProgressivo, tipo])` come rete di sicurezza anti-collisione.

- [ ] **Step 4: Run → PASS**. **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/fatturazione/numerazione.ts apps/piattaforma/src/lib/fatturazione/numerazione.test.ts
git commit -m "feat(fatturazione): numerazione progressiva per anno fiscale (puro, testato)"
```

---

## Task 4: Config emittente PV + engine generazione

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/pv-emittente.ts`
- Create: `apps/piattaforma/src/lib/fatturazione/engine.ts`

- [ ] **Step 1: Dati emittente PV (da env, con default brand)**

Create `pv-emittente.ts`:
```ts
import { BRAND } from '@/lib/seo/brand';

/**
 * Dati fiscali di Passaggio Veloce S.r.l. (emittente delle FATTURA_PV).
 * Da env per la prod; default dal brand per dev. Snapshot salvato su ogni documento.
 */
export function pvEmittente() {
  return {
    ragioneSociale: process.env.PV_RAGIONE_SOCIALE ?? BRAND.legalName,
    partitaIva: process.env.PV_PARTITA_IVA ?? '00000000000',
    codiceSdi: process.env.PV_CODICE_SDI ?? null,
    pec: process.env.PV_PEC ?? null,
    indirizzo: process.env.PV_INDIRIZZO ?? '',
    cap: process.env.PV_CAP ?? '',
    citta: process.env.PV_CITTA ?? '',
    provincia: process.env.PV_PROVINCIA ?? '',
  };
}
```
(Documentare in commit/PR che `PV_PARTITA_IVA`, `PV_CODICE_SDI`, `PV_PEC`, `PV_INDIRIZZO`, `PV_CAP`, `PV_CITTA`, `PV_PROVINCIA` vanno valorizzati su Vercel prima dei documenti reali.)

- [ ] **Step 2: Engine — `createFatturaPv`, `createDocBroker`, `createNotaCredito`**

Create `engine.ts` (`'server-only'`). Tre funzioni che girano dentro `prisma.$transaction`, assegnano il numero progressivo (Task 3) e salvano gli snapshot dati (Task: `pv-emittente` per PV, `Company` per broker/agenzia). Firma:
```ts
import 'server-only';
import { prisma } from '@pv/db';
import type { Prisma } from '@pv/db';
import { splitImporto, fatturaPaTipoPerRegime } from './calcolo';
import { prossimoNumero } from './numerazione';
import { pvEmittente } from './pv-emittente';

// Snapshot dei dati fiscali di una company (per datiEmittente/datiDestinatario)
function snapshotCompany(c: {
  ragioneSociale: string; partitaIva: string; codiceSdi: string | null;
  pec: string; indirizzo: string; cap: string; citta: string; provincia: string;
}) {
  return { ...c };
}

/** FATTURA_PV verso l'agenzia, alla firma. Importo = feeAgenziaCent. */
export async function createFatturaPv(input: {
  praticaId: string; agenziaId: string; feeAgenziaCent: number;
}): Promise<void> { /* tx: numero su registro PV; split ORDINARIO (PV è ordinario); destinatario = agenzia snapshot */ }

/** DOC_BROKER aggregato al payout. Importo = quota CREDITO_PRATICA del payout. */
export async function createDocBroker(input: { payoutId: string }): Promise<void> { /* tx: legge payout+transazioni CREDITO_PRATICA; importo = somma; regime del broker; numero su registro broker (Company.numeratore*) */ }

/** NOTA_VARIAZIONE (TD04, negativa) su una FATTURA_PV esistente. */
export async function createNotaCredito(input: { documentoOriginaleId: string; motivo: string }): Promise<void> { /* tx: importi negativi dell'originale; numero registro emittente; marca originale STORNATA */ }
```
Implementazione completa dei corpi seguendo: split via `splitImporto(lordo, regime)`, tipo via `fatturaPaTipoPerRegime(tipo, regime)`, numero via lettura+`prossimoNumero`+update registro nella stessa tx, snapshot via `snapshotCompany`/`pvEmittente`, e `pdfStorageKey/xmlStorageKey/pdfHash` lasciati `null` (FT-B/FT-D). Per `createDocBroker`: le pratiche del documento sono `payout.transazioni` con `tipo='CREDITO_PRATICA'`; `praticaId` resta null (aggregato), `payoutId` valorizzato; regime da `Company.regimeFiscale` del broker (wallet→company).

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/piattaforma && pnpm typecheck` → nessun errore.
```bash
git add apps/piattaforma/src/lib/fatturazione/pv-emittente.ts apps/piattaforma/src/lib/fatturazione/engine.ts
git commit -m "feat(fatturazione): engine generazione documenti (fattura PV, doc broker, nota credito)"
```

---

## Task 5: Hook — generazione su firma e su payout

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts` (firma)
- Modify: `apps/piattaforma/src/lib/jobs/process-payouts.ts` (payout eseguito)

- [ ] **Step 1: Hook firma → FATTURA_PV (best-effort post-commit)**

In `markFirmaAvvenutaAction`, dopo il commit della transazione di firma (vicino alle altre notifiche best-effort `void onPraticaFirmata(...)`), aggiungere:
```ts
import { createFatturaPv } from '@/lib/fatturazione/engine';
// ...dopo il commit, se la pratica ha feeAgenziaCent > 0 e un'agenzia assegnata:
void createFatturaPv({
  praticaId,
  agenziaId: pratica.agenziaAssegnataId!,
  feeAgenziaCent: pratica.feeAgenziaCent,
}).catch(() => undefined);
```
(Recuperare `agenziaAssegnataId`/`feeAgenziaCent` dalla pratica già caricata nello scope dell'azione.)

- [ ] **Step 2: Hook payout eseguito → DOC_BROKER (best-effort)**

In `process-payouts.ts`, nel ramo `result.ok` dopo il `prisma.$transaction` che marca `ESEGUITO` (dopo `succeeded++`), aggiungere:
```ts
import { createDocBroker } from '@/lib/fatturazione/engine';
// ...
await createDocBroker({ payoutId: payout.id }).catch(() => undefined);
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/piattaforma && pnpm typecheck` → nessun errore.
```bash
git add "apps/piattaforma/src/app/pratiche/actions.ts" apps/piattaforma/src/lib/jobs/process-payouts.ts
git commit -m "feat(fatturazione): genera fattura PV alla firma + doc broker al payout"
```

---

## Task 6: Verifica finale FT-A

- [ ] **Step 1: Test** — `cd apps/piattaforma && pnpm test` → verde (incl. fatturazione/calcolo, numerazione).
- [ ] **Step 2: db typecheck** — `cd packages/db && pnpm typecheck` → verde (seed/engine col client rigenerato).
- [ ] **Step 3: Build** — `cd apps/piattaforma && pnpm build` → OK.
- [ ] **Step 4: Verifica manuale (dev DB)** — eseguire una firma pratica (o seed) e verificare la creazione di un record `documenti_fiscali` FATTURA_PV con numero progressivo, split corretto, snapshot agenzia, `praticaId` valorizzato. Eseguire un payout e verificare il DOC_BROKER con `payoutId`, importo = somma CREDITO_PRATICA, registro broker.

---

## Self-Review (coverage vs spec, parte FT-A)
- `Company.regimeFiscale` + numeratori + relazioni → Task 1 ✓
- `DocumentoFiscale` (praticaId? + payoutId per aggregazione broker, snapshot immutabili, note variazione, indici) → Task 1 ✓
- Back-ref `Pratica.documentiFiscali` / `Payout.documentoFiscale` → Task 1 ✓
- Split importi per regime (segno preservato per TD04) → Task 2 ✓
- Tipo FatturaPA per regime (TD01/TD06/null/TD04) → Task 2 ✓
- Numerazione progressiva per anno, transaction-safe → Task 3 ✓
- Engine `createFatturaPv` (firma) / `createDocBroker` (payout aggregato) / `createNotaCredito` → Task 4 ✓
- Importi dal flusso reale (feeAgenziaCent, somma CREDITO_PRATICA payout) → Task 4/5 ✓
- Hook firma + payout (best-effort) → Task 5 ✓
- PDF/XML/UI/SDI → **fuori FT-A** (FT-B+), `pdf/xmlStorageKey` null ✓
- Nota credito trigger manuale admin → **FT-C** (in FT-A la funzione esiste) ✓
- Migration additiva backward-compatible → Task 1 ✓
