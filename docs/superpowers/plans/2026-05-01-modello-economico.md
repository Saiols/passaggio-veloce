# Migrazione Modello Economico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il modello prezzi hardcoded (12000/9500/2500 cent) con il modello consolidato §1 del triage demo: 75 € passaggio privato singolo / 15 € × N minivolture multiple, derivato dal tipo + numero veicoli, con scaffold per il costo affiliazione.

**Architecture:** Pricing engine puro in `lib/pricing.ts` (TDD). Schema Prisma aggiornato con nuovo enum `PraticaTipo` (`PASSAGGIO_PRIVATO`, `MINIVOLTURE_MULTIPLE`), campo `numeroVeicoli`, scaffold `CommissioneAffiliazione` (popolato in FASE 13). `submitNuovaPraticaAction` chiama l'engine invece di hardcodare. Wizard rinominato + input N veicoli per le multiple. UI inbox/dettaglio nascondono il fee finché la pratica non è firmata.

**Tech Stack:** Next.js 16 App Router (webpack), Prisma 5 + Postgres, vitest, zod, Tailwind 4, React 19.

**Out of scope:**
- Sistema affiliazione completo (FASE 13): la tabella `CommissioneAffiliazione` viene creata ma le righe NON vengono popolate. La logica di accredito sui wallet referenti è un PR successivo.
- `WalletAgenzia`: usiamo il modello `Wallet` esistente (già `companyId @unique`, agnostic al tipo company). Il record viene creato lazily quando serve.
- Dashboard economica agenzia / Profilo agenzia "Listino piattaforma" / Mail N8 addebito programmato (UI consultiva, PR dedicato).
- Decisioni aperte D-04 (cap durata commissione) e D-05 (soglia payout agenzia): non bloccano lo schema pricing core; dove servono i campi ci sono nullable defaults.

---

## File Structure

**Nuovi:**
- `apps/piattaforma/src/lib/pricing.ts` — pure engine `computeFees(tipo, numeroVeicoli)`.
- `apps/piattaforma/src/lib/pricing.test.ts` — vitest unit tests.
- `packages/db/prisma/migrations/<TIMESTAMP>_pricing_model_v2/migration.sql` — generata da Prisma.

**Modificati:**
- `packages/db/prisma/schema.prisma` — enum `PraticaTipo` ridefinito, `Pratica.numeroVeicoli`, modello `CommissioneAffiliazione`.
- `packages/db/prisma/seed.ts` — usa nuovi enum values (`PASSAGGIO_PRIVATO`, `MINIVOLTURE_MULTIPLE`) e popola `numeroVeicoli`.
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — `submitSchema` accetta nuovi enum + `numeroVeicoli`, derivazione fee via `computeFees`.
- `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — Select tipi rinominato, input N veicoli condizionale, validation client.
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx` — `labelTipo` aggiornato, sezione "Parti commerciali" mostra fee solo se `firmaAvvenutaAt`.
- `apps/piattaforma/src/app/inbox/page.tsx` — rimuove colonna prezzo dalla card pratica.
- `apps/piattaforma/src/app/inbox/[id]/page.tsx` — sostituisce "Accetti per X €?" con "Confermi accettazione?".
- `apps/piattaforma/src/lib/distribuzione/tick.ts` — payload N6 mantiene `feeCent` (info admin/audit) ma il body email dovrà non mostrarlo all'agenzia (delegato al template, fuori scope qui).

**Strategia migration DB:** dev-only `prisma migrate reset --force`. Le pratiche storiche del seed vengono ricreate con il nuovo enum. Niente data migration custom necessaria (siamo in dev, no produzione).

---

## Task 1: Pricing Engine — schema dati e prima funzione

**Files:**
- Create: `apps/piattaforma/src/lib/pricing.ts`
- Test: `apps/piattaforma/src/lib/pricing.test.ts`

- [ ] **Step 1.1: Scrivi il test failing per il caso passaggio privato**

```typescript
// apps/piattaforma/src/lib/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { computeFees, type FeeBreakdown } from './pricing';

describe('computeFees', () => {
  it('passaggio privato: 75€ agenzia / 25€ broker / 50€ noi / 10€ affiliazione totale', () => {
    const result = computeFees({ tipo: 'PASSAGGIO_PRIVATO', numeroVeicoli: 1 });
    expect(result).toEqual<FeeBreakdown>({
      feeAgenziaCent: 7500,
      creditoBrokerCent: 2500,
      ricavoLordoCent: 5000,
      costoAffiliazioneTotaleCent: 1000,
    });
  });
});
```

- [ ] **Step 1.2: Esegui il test, verifica che fallisca per file non trovato**

Run (da `apps/piattaforma/`): `pnpm test pricing`
Expected: ERR `Cannot find module './pricing'`.

- [ ] **Step 1.3: Crea `pricing.ts` con tipi + funzione minimale**

```typescript
// apps/piattaforma/src/lib/pricing.ts
export type PraticaTipoEconomico = 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';

export type FeeBreakdown = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  ricavoLordoCent: number;
  costoAffiliazioneTotaleCent: number;
};

export function computeFees(input: {
  tipo: PraticaTipoEconomico;
  numeroVeicoli: number;
}): FeeBreakdown {
  if (input.tipo === 'PASSAGGIO_PRIVATO') {
    return {
      feeAgenziaCent: 7500,
      creditoBrokerCent: 2500,
      ricavoLordoCent: 5000,
      costoAffiliazioneTotaleCent: 1000,
    };
  }
  throw new Error(`tipo non supportato: ${input.tipo}`);
}
```

- [ ] **Step 1.4: Esegui il test, verifica passi**

Run: `pnpm test pricing`
Expected: 1 passed.

- [ ] **Step 1.5: Aggiungi test per minivolture multiple (N=2 e N=5)**

```typescript
  it('minivolture multiple N=2: 30€ agenzia / 0 broker / 30€ noi / 10€ affiliazione', () => {
    const result = computeFees({ tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 2 });
    expect(result).toEqual<FeeBreakdown>({
      feeAgenziaCent: 3000,
      creditoBrokerCent: 0,
      ricavoLordoCent: 3000,
      costoAffiliazioneTotaleCent: 1000,
    });
  });

  it('minivolture multiple N=5: scala lineare', () => {
    const result = computeFees({ tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 5 });
    expect(result).toEqual<FeeBreakdown>({
      feeAgenziaCent: 7500,
      creditoBrokerCent: 0,
      ricavoLordoCent: 7500,
      costoAffiliazioneTotaleCent: 2500,
    });
  });
```

- [ ] **Step 1.6: Esegui i test, verifica che il caso N=2 fallisca (missing branch)**

Run: `pnpm test pricing`
Expected: 1 passed (passaggio privato), 2 failed (minivolture).

- [ ] **Step 1.7: Estendi `computeFees` con il branch MINIVOLTURE_MULTIPLE**

```typescript
  if (input.tipo === 'MINIVOLTURE_MULTIPLE') {
    const N = input.numeroVeicoli;
    return {
      feeAgenziaCent: 1500 * N,
      creditoBrokerCent: 0,
      ricavoLordoCent: 1500 * N,
      costoAffiliazioneTotaleCent: 500 * N,
    };
  }
```

- [ ] **Step 1.8: Esegui tutti i test, verifica passino**

Run: `pnpm test pricing`
Expected: 3 passed.

- [ ] **Step 1.9: Aggiungi validation test per casi invalidi**

```typescript
  it('lancia errore se passaggio privato ha N != 1', () => {
    expect(() => computeFees({ tipo: 'PASSAGGIO_PRIVATO', numeroVeicoli: 2 })).toThrow(
      /numeroVeicoli deve essere 1/i,
    );
  });

  it('lancia errore se minivolture multiple ha N < 2', () => {
    expect(() => computeFees({ tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 1 })).toThrow(
      /numeroVeicoli deve essere ≥ 2/i,
    );
  });
```

- [ ] **Step 1.10: Aggiungi le validazioni a `pricing.ts`**

```typescript
export function computeFees(input: {
  tipo: PraticaTipoEconomico;
  numeroVeicoli: number;
}): FeeBreakdown {
  const { tipo, numeroVeicoli } = input;
  if (tipo === 'PASSAGGIO_PRIVATO') {
    if (numeroVeicoli !== 1) {
      throw new Error(`PASSAGGIO_PRIVATO: numeroVeicoli deve essere 1, ricevuto ${numeroVeicoli}`);
    }
    return {
      feeAgenziaCent: 7500,
      creditoBrokerCent: 2500,
      ricavoLordoCent: 5000,
      costoAffiliazioneTotaleCent: 1000,
    };
  }
  if (tipo === 'MINIVOLTURE_MULTIPLE') {
    if (numeroVeicoli < 2) {
      throw new Error(
        `MINIVOLTURE_MULTIPLE: numeroVeicoli deve essere ≥ 2, ricevuto ${numeroVeicoli}`,
      );
    }
    return {
      feeAgenziaCent: 1500 * numeroVeicoli,
      creditoBrokerCent: 0,
      ricavoLordoCent: 1500 * numeroVeicoli,
      costoAffiliazioneTotaleCent: 500 * numeroVeicoli,
    };
  }
  throw new Error(`tipo non supportato: ${tipo satisfies never}`);
}
```

- [ ] **Step 1.11: Esegui tutti i test, verifica passino**

Run: `pnpm test pricing`
Expected: 5 passed.

- [ ] **Step 1.12: Commit**

```bash
git add apps/piattaforma/src/lib/pricing.ts apps/piattaforma/src/lib/pricing.test.ts
git commit -m "feat(pricing): engine deterministico per fee + commissione affiliazione

Spec §1 demo: 75€ passaggio privato (25 broker / 50 noi),
15€×N minivolture multiple (0 broker / 15×N noi),
costo affiliazione 10€ fisso o 5€×N. Validation N=1 / N>=2."
```

---

## Task 2: Schema Prisma — nuovo enum PraticaTipo + numeroVeicoli + scaffold CommissioneAffiliazione

**Files:**
- Modify: `packages/db/prisma/schema.prisma:53-57` (enum), `:354-403` (Pratica model), nuovo modello dopo `Valutazione`.

- [ ] **Step 2.1: Sostituisci l'enum `PraticaTipo`**

In `packages/db/prisma/schema.prisma` linee 53-57, sostituisci:

```prisma
enum PraticaTipo {
  TRAPASSO_NETTO
  MINIVOLTURA
  LOTTO_MASSIVO
}
```

con:

```prisma
enum PraticaTipo {
  PASSAGGIO_PRIVATO
  MINIVOLTURE_MULTIPLE
}
```

- [ ] **Step 2.2: Aggiungi `numeroVeicoli` al modello `Pratica`**

In `packages/db/prisma/schema.prisma`, dentro il modello `Pratica` (intorno alla linea 354), aggiungi dopo `tipo  PraticaTipo`:

```prisma
  // Numero veicoli: 1 per passaggio privato, ≥ 2 per minivolture multiple.
  numeroVeicoli Int @default(1)
```

- [ ] **Step 2.3: Aggiungi enum + modello `CommissioneAffiliazione` (scaffold per FASE 13)**

In `packages/db/prisma/schema.prisma`, prima della sezione `MODELS — valutazioni`, aggiungi:

```prisma
// ============================================================
// ENUMS — affiliazione (scaffold FASE 13)
// ============================================================

enum CommissioneAffiliazioneTipo {
  REFERENTE_BROKER
  REFERENTE_AGENZIA
}

enum CommissioneAffiliazioneStato {
  MATURATA
  ACCREDITATA
  ANNULLATA
}

// ============================================================
// MODELS — affiliazione (scaffold FASE 13)
// ============================================================

model CommissioneAffiliazione {
  id String @id @default(uuid()) @db.Uuid

  praticaId String  @db.Uuid
  pratica   Pratica @relation(fields: [praticaId], references: [id], onDelete: Cascade)

  // Chi riceve la commissione (Company referente)
  referenteId String  @db.Uuid
  referente   Company @relation("ReferenteCommissioni", fields: [referenteId], references: [id])

  tipo  CommissioneAffiliazioneTipo
  stato CommissioneAffiliazioneStato @default(MATURATA)

  // In centesimi: lordo = nostra spesa totale per quella pratica/referente,
  // netto = quanto effettivamente accreditato (se 1 referente lordo == netto;
  // se 2 referenti lordo / 2 a testa).
  importoLordoCent Int
  importoNettoCent Int

  // Cap durata commissione (D-04): null = sempre, valorizzato = scade.
  expiresAt DateTime?

  // Riferimento alla transazione wallet di accredito (popolato quando stato = ACCREDITATA).
  transazioneWalletId String?            @unique @db.Uuid
  transazioneWallet   TransazioneWallet? @relation(fields: [transazioneWalletId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([praticaId])
  @@index([referenteId, stato])
  @@map("commissioni_affiliazione")
}
```

- [ ] **Step 2.4: Aggiungi le relations inverse a `Company`, `Pratica` e `TransazioneWallet`**

Nel modello `Company` (intorno alla linea 257, dopo `valutazioniFatte`):

```prisma
  // Commissioni affiliazione (questa company è referente di altri)
  commissioniGenerate CommissioneAffiliazione[] @relation("ReferenteCommissioni")
```

Nel modello `Pratica` (intorno alla linea 422, prima di `createdAt`):

```prisma
  commissioniAffiliazione CommissioneAffiliazione[]
```

Nel modello `TransazioneWallet` (intorno alla linea 599, prima di `createdAt`):

```prisma
  commissioneAffiliazione CommissioneAffiliazione?
```

- [ ] **Step 2.5: Genera la migration**

Run (da root): `pnpm db:migrate -- --name pricing_model_v2`
Expected: prompt "Drift detected" perché l'enum cambia. Risposta: `y` per accettare il reset (siamo in dev).

> Nota: se il prompt non parte interattivo (env CI), usa: `pnpm --filter @pv/db exec prisma migrate reset --force` poi `pnpm db:migrate -- --name pricing_model_v2`.

- [ ] **Step 2.6: Verifica che il client Prisma compili**

Run: `pnpm db:generate`
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 2.7: Commit (NON ancora il seed: lo aggiorniamo dopo)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): nuovo modello economico v2 + scaffold CommissioneAffiliazione

- PraticaTipo: PASSAGGIO_PRIVATO + MINIVOLTURE_MULTIPLE (drop TRAPASSO_NETTO/MINIVOLTURA/LOTTO_MASSIVO)
- Pratica.numeroVeicoli (default 1)
- CommissioneAffiliazione skeleton per FASE 13"
```

---

## Task 3: Aggiornamento seed con nuovi enum values

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 3.1: Cerca tutte le occorrenze degli enum vecchi**

Run: `grep -n "TRAPASSO_NETTO\|MINIVOLTURA\|LOTTO_MASSIVO" packages/db/prisma/seed.ts`
Annota le linee. Per ciascuna sostituisci secondo la mappa:
- `TRAPASSO_NETTO` → `PASSAGGIO_PRIVATO`
- `MINIVOLTURA` → `MINIVOLTURE_MULTIPLE` con `numeroVeicoli: 3` (esempio realistico)
- `LOTTO_MASSIVO` → `MINIVOLTURE_MULTIPLE` con `numeroVeicoli: 5`

- [ ] **Step 3.2: Sostituisci i valori e aggiungi `numeroVeicoli` ai literal di pratica**

Per ogni `prisma.pratica.create({ data: { tipo: 'TRAPASSO_NETTO', ... } })`, lascia `numeroVeicoli: 1` (default OK).
Per ogni `tipo: 'MINIVOLTURA'`, sostituisci con `tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 3`.
Per ogni `tipo: 'LOTTO_MASSIVO'`, sostituisci con `tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 5`.

Aggiorna anche eventuali pricing inline coerenti col nuovo modello:
- `PASSAGGIO_PRIVATO`: `feeAgenziaCent: 7500, creditoBrokerCent: 2500`
- `MINIVOLTURE_MULTIPLE` con N: `feeAgenziaCent: 1500*N, creditoBrokerCent: 0`

- [ ] **Step 3.3: Esegui reset + seed**

Run: `pnpm --filter @pv/db exec prisma migrate reset --force --skip-generate`
Expected: DB ricreato + seed eseguito senza errori.

- [ ] **Step 3.4: Verifica con quick query**

Run: `pnpm --filter @pv/db exec prisma db execute --stdin <<< "SELECT tipo, COUNT(*) FROM pratiche GROUP BY tipo;"`
Expected: solo `PASSAGGIO_PRIVATO` e `MINIVOLTURE_MULTIPLE`.

- [ ] **Step 3.5: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "chore(seed): allinea pratiche demo a PASSAGGIO_PRIVATO/MINIVOLTURE_MULTIPLE + numeroVeicoli"
```

---

## Task 4: `submitNuovaPraticaAction` usa `computeFees`

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts:60-99` (zod schema), `:135-136` (hardcode)

- [ ] **Step 4.1: Aggiorna `submitSchema` con nuovi enum + `numeroVeicoli`**

In `apps/piattaforma/src/app/pratiche/nuova/actions.ts`, sostituisci linea 61 e dintorni:

```typescript
const submitSchema = z.object({
  tipo: z.enum(['PASSAGGIO_PRIVATO', 'MINIVOLTURE_MULTIPLE']),
  numeroVeicoli: z.coerce.number().int().min(1).max(50),

  // Dati veicolo (OCR + correzioni)
  // ... resto identico
```

E aggiungi un `superRefine` o check post-parse subito dopo `parsed.data`:

```typescript
if (d.tipo === 'PASSAGGIO_PRIVATO' && d.numeroVeicoli !== 1) {
  redirect('/pratiche/nuova?error=Passaggio%20privato%20deve%20avere%201%20veicolo');
}
if (d.tipo === 'MINIVOLTURE_MULTIPLE' && d.numeroVeicoli < 2) {
  redirect('/pratiche/nuova?error=Minivolture%20multiple%20richiedono%20almeno%202%20veicoli');
}
```

- [ ] **Step 4.2: Sostituisci il pricing hardcoded con la chiamata all'engine**

In `apps/piattaforma/src/app/pratiche/nuova/actions.ts` linee 134-136, sostituisci:

```typescript
// Fee plausibile in base al tipo (placeholder — Fase 5 Stripe farà la logica vera)
const feeAgenziaCent = d.tipo === 'MINIVOLTURA' ? 9500 : 12000;
const creditoBrokerCent = d.tipo === 'TRAPASSO_NETTO' ? 2500 : 0;
```

con:

```typescript
const fees = computeFees({ tipo: d.tipo, numeroVeicoli: d.numeroVeicoli });
const feeAgenziaCent = fees.feeAgenziaCent;
const creditoBrokerCent = fees.creditoBrokerCent;
```

E aggiungi l'import in cima:

```typescript
import { computeFees } from '@/lib/pricing';
```

- [ ] **Step 4.3: Aggiungi `numeroVeicoli` al `prisma.pratica.create`**

In `apps/piattaforma/src/app/pratiche/nuova/actions.ts` linea 175 (dentro `data:`), aggiungi:

```typescript
      numeroVeicoli: d.numeroVeicoli,
```

- [ ] **Step 4.4: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errors.

- [ ] **Step 4.5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): submitNuovaPratica usa pricing engine + numeroVeicoli"
```

---

## Task 5: Wizard nuova pratica — UI nuovi tipi + input N veicoli

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

- [ ] **Step 5.1: Aggiorna il type `Tipo` e l'opzione di default**

In `wizard.tsx` linea 14:

```typescript
type Tipo = 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';
```

Linea 45:

```typescript
const [tipo, setTipo] = useState<Tipo>('PASSAGGIO_PRIVATO');
```

- [ ] **Step 5.2: Aggiungi state per `numeroVeicoli`**

Subito dopo `setTipo` (intorno linea 45):

```typescript
const [numeroVeicoli, setNumeroVeicoli] = useState<number>(1);
```

E logica per resettarlo quando cambia tipo:

```typescript
const handleTipoChange = (next: Tipo) => {
  setTipo(next);
  setNumeroVeicoli(next === 'PASSAGGIO_PRIVATO' ? 1 : 2);
};
```

- [ ] **Step 5.3: Aggiorna le `<option>` del Select tipo**

Linee 172-178 di `wizard.tsx`, sostituisci:

```tsx
<Select value={tipo} onChange={(e) => handleTipoChange(e.target.value as Tipo)}>
  <option value="PASSAGGIO_PRIVATO">Passaggio di proprietà privato</option>
  <option value="MINIVOLTURE_MULTIPLE">Minivolture multiple (commercianti)</option>
</Select>
```

- [ ] **Step 5.4: Aggiungi input `numeroVeicoli` condizionale**

Subito dopo il `<Field label="Tipo pratica">` (chiusura `</Field>` intorno alla linea 179), aggiungi:

```tsx
{tipo === 'MINIVOLTURE_MULTIPLE' && (
  <Field label="Numero veicoli" required>
    <Input
      type="number"
      min={2}
      max={50}
      value={numeroVeicoli}
      onChange={(e) => setNumeroVeicoli(Math.max(2, Number(e.target.value) || 2))}
    />
  </Field>
)}
```

- [ ] **Step 5.5: Aggiungi `numeroVeicoli` al FormData submit**

In `handleFinalSubmit`, intorno alla linea 97 (vicino a `fd.append('tipo', tipo)`):

```typescript
fd.append('numeroVeicoli', String(numeroVeicoli));
```

- [ ] **Step 5.6: Aggiorna `labelTipo` in fondo al file**

Linea 466-471, sostituisci:

```typescript
function labelTipo(t: Tipo): string {
  if (t === 'PASSAGGIO_PRIVATO') return 'Passaggio di proprietà privato';
  if (t === 'MINIVOLTURE_MULTIPLE') return 'Minivolture multiple';
  return t;
}
```

- [ ] **Step 5.7: Aggiungi riga "Numero veicoli" al riepilogo se applicabile**

In `step === 3`, intorno alla linea 360 (sezione riepilogo), aggiungi prima di `<RiepilogoRow label="Comune" ...>`:

```tsx
{tipo === 'MINIVOLTURE_MULTIPLE' && (
  <RiepilogoRow label="Numero veicoli" value={String(numeroVeicoli)} />
)}
```

- [ ] **Step 5.8: Verifica build wizard**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errors.

- [ ] **Step 5.9: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(wizard): rinomina tipi pratica + input numero veicoli per minivolture multiple

- 'Trapasso netto' -> 'Passaggio di proprietà privato'
- 'Minivoltura'/'Lotto massivo' -> 'Minivolture multiple' + N veicoli input"
```

---

## Task 6: Pratica detail page — `labelTipo` + gating fee post-firma

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx`

- [ ] **Step 6.1: Aggiorna `labelTipo` (linea 376-381)**

```typescript
function labelTipo(t: string): string {
  if (t === 'PASSAGGIO_PRIVATO') return 'Passaggio di proprietà privato';
  if (t === 'MINIVOLTURE_MULTIPLE') return 'Minivolture multiple';
  return t;
}
```

- [ ] **Step 6.2: Aggiungi flag `showFee` derivata da firmaAvvenutaAt**

Intorno alla linea 75, dopo `canValutare`:

```typescript
const showFee = pratica.firmaAvvenutaAt !== null && pratica.firmaAvvenutaAt !== undefined;
```

- [ ] **Step 6.3: Gate la sezione fee+credito al `showFee`**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx` linee 296-305, avvolgi le righe `Fee agenzia` / `Credito broker` in un fragment condizionale:

```tsx
{showFee && (
  <>
    <InfoRow
      label="Fee agenzia"
      value={pratica.feeAgenziaCent > 0 ? formatCurrencyCent(pratica.feeAgenziaCent) : '—'}
    />
    <InfoRow
      label="Credito broker"
      value={
        pratica.creditoBrokerCent > 0 ? formatCurrencyCent(pratica.creditoBrokerCent) : '—'
      }
    />
  </>
)}
```

- [ ] **Step 6.4: Aggiungi visualizzazione `numeroVeicoli` se MINIVOLTURE_MULTIPLE**

Nella sezione "Dati veicolo" (intorno alla linea 197), aggiungi prima di `<InfoRow label="Pre-2015" ...>`:

```tsx
{pratica.tipo === 'MINIVOLTURE_MULTIPLE' && (
  <InfoRow label="Numero veicoli" value={String(pratica.numeroVeicoli)} />
)}
```

- [ ] **Step 6.5: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errors.

- [ ] **Step 6.6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/[id]/page.tsx
git commit -m "feat(pratica-detail): nasconde fee finché non firmata + numero veicoli visibile"
```

---

## Task 7: Inbox agenzia — rimuovi prezzo dalla card pratica

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/page.tsx:104-111`

- [ ] **Step 7.1: Rimuovi il blocco prezzo dalla card pratica inbox**

In `apps/piattaforma/src/app/inbox/page.tsx`, intorno alla linea 104-111, sostituisci:

```tsx
<div className="text-right">
  <p className="text-[14px] font-bold text-pv-navy-800">
    {a.pratica.feeAgenziaCent > 0
      ? formatCurrencyCent(a.pratica.feeAgenziaCent)
      : '—'}
  </p>
  <p className="text-[11px] text-pv-slate-500">{formatRelative(a.invioAt)}</p>
</div>
```

con (mantieni solo il timestamp):

```tsx
<div className="text-right">
  <p className="text-[11px] text-pv-slate-500">{formatRelative(a.invioAt)}</p>
</div>
```

- [ ] **Step 7.2: Rimuovi l'import inutile se non più usato**

Run: `grep -c formatCurrencyCent apps/piattaforma/src/app/inbox/page.tsx`
Se 0, rimuovi l'import in cima al file.

- [ ] **Step 7.3: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errors.

- [ ] **Step 7.4: Commit**

```bash
git add apps/piattaforma/src/app/inbox/page.tsx
git commit -m "feat(inbox): rimuove prezzo dalla card pratica (visibile solo post-firma)"
```

---

## Task 8: Inbox detail — rimuovi "Accetti per X €?"

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/[id]/page.tsx:86-88`

- [ ] **Step 8.1: Sostituisci la copy di decisione**

In `apps/piattaforma/src/app/inbox/[id]/page.tsx` intorno alla linea 86-88, sostituisci:

```tsx
<p className="mt-1 text-[15px] font-bold text-pv-navy-800">
  Accetti questa pratica per {formatCurrencyCent(pratica.feeAgenziaCent)}?
</p>
```

con:

```tsx
<p className="mt-1 text-[15px] font-bold text-pv-navy-800">
  Confermi accettazione di questa pratica?
</p>
```

- [ ] **Step 8.2: Rimuovi l'import inutile se non più usato**

Run: `grep -c formatCurrencyCent apps/piattaforma/src/app/inbox/\[id\]/page.tsx`
Se 0, rimuovi l'import in cima al file.

- [ ] **Step 8.3: Aggiorna `labelTipo` se presente in fondo al file**

Cerca in fondo `function labelTipo` e se esiste replace con la versione `PASSAGGIO_PRIVATO/MINIVOLTURE_MULTIPLE`.

- [ ] **Step 8.4: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errors.

- [ ] **Step 8.5: Commit**

```bash
git add apps/piattaforma/src/app/inbox/\[id\]/page.tsx
git commit -m "feat(inbox-detail): rimuove prezzo dalla schermata accettazione"
```

---

## Task 9: Cleanup — Wallet page + altri riferimenti orfani

**Files:**
- Modify: `apps/piattaforma/src/app/wallet/page.tsx` (eventuali label tipo)
- Modify: `apps/piattaforma/src/lib/providers/ocr/mock.ts` (se contiene i vecchi enum)

- [ ] **Step 9.1: Cerca riferimenti residui ai vecchi enum**

Run: `grep -rn "TRAPASSO_NETTO\|MINIVOLTURA\|LOTTO_MASSIVO" apps/piattaforma/src packages/db/prisma/seed.ts`
Per ciascun match: applicare la mappa di Task 3 (`TRAPASSO_NETTO` → `PASSAGGIO_PRIVATO`, `MINIVOLTURA`/`LOTTO_MASSIVO` → `MINIVOLTURE_MULTIPLE`).

- [ ] **Step 9.2: Verifica `labelTipo` in `wallet/page.tsx`**

Apri `apps/piattaforma/src/app/wallet/page.tsx`, cerca eventuale `labelTipo` o sostituisci direttamente le stringhe vecchie.

- [ ] **Step 9.3: Aggiorna OCR mock se serve**

Se `apps/piattaforma/src/lib/providers/ocr/mock.ts` contiene logica per emettere targhe associate a tipi, normalizza al nuovo enum.

- [ ] **Step 9.4: Verifica typecheck globale**

Run: `pnpm typecheck`
Expected: 0 errors in tutti i package.

- [ ] **Step 9.5: Commit**

```bash
git add apps/piattaforma/src
git commit -m "chore(cleanup): rimuove riferimenti orfani enum pratica vecchio"
```

---

## Task 10: Smoke test end-to-end via Chrome DevTools

**Goal:** verificare che il flusso intero funzioni con il nuovo modello.

- [ ] **Step 10.1: Restart dev server (per ricaricare schema Prisma)**

Sul tuo Windows:
- Termina la cmd shell che hai lanciato per `next dev`.
- Riavvia: `pnpm exec next dev --webpack` (da `apps/piattaforma`).
- Attendi `Ready in...`.

- [ ] **Step 10.2: Login dealer1 + crea pratica PASSAGGIO_PRIVATO**

- Apri http://localhost:3000/login
- Email: `dealer1@passaggioveloce.it` / Password: `DevPass123!`
- Vai a **Nuova pratica**
- Tipo: "Passaggio di proprietà privato"
- Carica `apps/piattaforma/public/brand/icon.png`
- Step 2 venditore/acquirente con CF dummy 16 char
- Step 3 Comune `Venezia` Provincia `VE`
- Click **Invia**

Atteso:
- Redirect a `/pratiche/<id>` con stato `IN ATTESA · R1`
- Sezione "Parti commerciali" NON mostra `Fee agenzia` né `Credito broker` (perché non firmata).
- 2 agenzie in Round distribuzione (Venezia + Padova limitrofa? no, R1 è solo VE → 2 di VE).

- [ ] **Step 10.3: Crea una pratica MINIVOLTURE_MULTIPLE con N=4**

- Vai a **Nuova pratica**
- Tipo: "Minivolture multiple (commercianti)"
- Numero veicoli: 4
- Procedi fino allo step 3 con Comune `Padova` Provincia `PD`
- Click **Invia**

Atteso:
- Pratica creata
- Riepilogo dettaglio mostra "Numero veicoli: 4"
- DB: `feeAgenziaCent` = 6000 (4 × 1500), `creditoBrokerCent` = 0

- [ ] **Step 10.4: Verifica DB**

Run (PowerShell):
```powershell
pnpm --filter @pv/db exec prisma db execute --stdin "SELECT codicePratica, tipo, numeroVeicoli, feeAgenziaCent, creditoBrokerCent FROM pratiche WHERE codicePratica IS NOT NULL ORDER BY createdAt DESC LIMIT 2;"
```
Expected: due righe coerenti col modello.

- [ ] **Step 10.5: Verifica vista inbox come agenzia**

- Logout dealer1
- Login `agenzia1@passaggioveloce.it` / `DevPass123!`
- Inbox: la nuova pratica VE compare SENZA prezzo nella card.
- Click sulla pratica: schermata accettazione recita "Confermi accettazione di questa pratica?" senza importo.

- [ ] **Step 10.6: Marca firma e verifica fee visibile**

Da dealer1 di nuovo:
- Apri la pratica VE
- (Per simulare accettazione+firma serve l'agenzia, ma in dev possiamo usare admin demo control)
- Alternativa rapida: manuale via Prisma update — `pnpm --filter @pv/db exec prisma db execute --stdin "UPDATE pratiche SET firmaAvvenutaAt = NOW(), stato = 'FIRMATA' WHERE codicePratica = 'PV-2026-NNNNN'"`
- Reload `/pratiche/<id>` come dealer1: ora mostra Fee agenzia 75,00 € e Credito broker 25,00 €.

- [ ] **Step 10.7: Commit smoke test report (opzionale)**

Se hai modificato qualcosa in piano dopo gli smoke test, commitalo. Altrimenti niente.

---

## Self-review checklist

Spec coverage (rispetto a `docs/feedback-demo-2026-04-29.md` §1):
- [x] §1.1 tipi pratica da 3 a 2 → Task 2 (enum) + Task 5 (UI)
- [x] §1.1 prezzo non più scelto, derivato → Task 1 (engine) + Task 4 (action)
- [x] §1.1 numeroVeicoli per minivolture → Task 2 (schema) + Task 5 (UI)
- [x] §1.2 affiliazione invariante 1/2 referenti → coperto da `costoAffiliazioneTotaleCent` (la divisione 50/50 è in FASE 13)
- [~] §1.3 wallet agenzia da creare → coperto via `Wallet` esistente con `companyId @unique` (no nuovo modello, lazy create FASE 13)
- [x] §1.4 nascondere prezzo in inbox + accettazione → Task 7 + Task 8
- [x] §1.4 mostrare prezzo solo dashboard economica post-firma → Task 6 (gating su `firmaAvvenutaAt`)
- [~] §1.4 dashboard economica / profilo agenzia / N8 → out of scope, PR dedicato
- [x] §1.5 schema implications → Task 2

Placeholder scan: nessun "TBD" / "implementa dopo". Tutti gli step hanno codice o comandi.

Type consistency: `PraticaTipoEconomico` (engine) === `PraticaTipo` (Prisma) === literal string union (wizard) — controllato.

---

## Esecuzione

Inline execution con commit ad ogni Task (boundary naturale di review). Non subagent-driven perché il context è piccolo e i task sono tightly coupled (schema → action → UI è una catena lineare).
