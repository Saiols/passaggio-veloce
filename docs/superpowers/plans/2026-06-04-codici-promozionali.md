# Codici promozionali — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codici promozionali: CRUD admin + riscatto in registrazione con accredito best-effort sul wallet della nuova azienda.

**Architecture:** Modelli Prisma `PromoCode`/`PromoCodeRedemption` + enum `CREDITO_PROMO`. Logica di validazione pura (`evaluatePromoCode`), server action `checkPromoCodeAction` per il feedback live, helper `redeemPromoCode(tx,...)` chiamato dentro la transazione di `registerAction` (non bloccante). Sezione admin `/admin/codici-promozionali` con guard `isAdminPiattaforma`.

**Tech Stack:** Next.js server actions, Prisma, Vitest, react-hook-form (solo step pagamento esistente).

**Spec:** `docs/superpowers/specs/2026-06-04-codici-promozionali-design.md`

---

## File Structure
- Modify `packages/db/prisma/schema.prisma` — modelli + enum + relazione Company.
- Create `packages/db/prisma/migrations/<ts>_promo_codes/migration.sql`.
- Create `apps/piattaforma/src/lib/promo/evaluate.ts` — tipi + `normalizePromoCode` + `evaluatePromoCode` (puro).
- Create `apps/piattaforma/src/lib/promo/evaluate.test.ts`.
- Create `apps/piattaforma/src/lib/promo/redeem.ts` — `redeemPromoCode(tx, code, companyId)`.
- Create `apps/piattaforma/src/lib/promo/redeem.test.ts`.
- Modify `apps/piattaforma/src/app/(auth)/actions.ts` — `checkPromoCodeAction` + wiring promo in `registerAction` + estende `RegisterActionResult`.
- Modify `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` — campo promo + Applica nello step Pagamento + esito nello schermo finale.
- Create `apps/piattaforma/src/app/admin/codici-promozionali/page.tsx` — lista + form.
- Create `apps/piattaforma/src/app/admin/codici-promozionali/actions.ts` — create + toggle.
- Create `apps/piattaforma/src/app/admin/codici-promozionali/client.tsx` — form/lista client.
- Modify `apps/piattaforma/src/components/app-shell.tsx` — voce nav admin.

---

## Task 1: Modelli Prisma + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260604140000_promo_codes/migration.sql`

- [ ] **Step 1: Aggiungi enum value** — in `TransazioneWalletTipo` (cerca `enum TransazioneWalletTipo`), aggiungi `CREDITO_PROMO` in fondo:
```prisma
enum TransazioneWalletTipo {
  CREDITO_PRATICA
  CREDITO_AFFILIAZIONE
  PAYOUT_AUTOMATICO
  PAYOUT_MANUALE
  RETTIFICA_ADMIN
  STORNO
  PENALE_BROKER
  CREDITO_PROMO
}
```

- [ ] **Step 2: Aggiungi i modelli** (in fondo allo schema, prima della fine):
```prisma
model PromoCode {
  id             String   @id @default(uuid()) @db.Uuid
  code           String   @unique
  amountCent     Int
  expiresAt      DateTime?
  maxRedemptions Int?
  active         Boolean  @default(true)
  createdById    String?  @db.Uuid
  redemptions    PromoCodeRedemption[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@map("promo_codes")
}

model PromoCodeRedemption {
  id                  String   @id @default(uuid()) @db.Uuid
  promoCodeId         String   @db.Uuid
  promoCode           PromoCode @relation(fields: [promoCodeId], references: [id], onDelete: Cascade)
  companyId           String   @db.Uuid
  company             Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  amountCent          Int
  transazioneWalletId String?  @db.Uuid
  createdAt           DateTime @default(now())
  @@unique([promoCodeId, companyId])
  @@index([promoCodeId])
  @@map("promo_code_redemptions")
}
```

- [ ] **Step 3: Relazione inversa su Company** — nel `model Company` (vicino alle altre relazioni, es. dopo `crmContactMatches`), aggiungi:
```prisma
  promoRedemptions PromoCodeRedemption[]
```

- [ ] **Step 4: Genera la migration SQL** (shadow DB su 127.0.0.1, NON localhost). Da `packages/db`:
```
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "CREATE DATABASE pv_shadow_promo;"
pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://pv:pv_dev_password@127.0.0.1:5432/pv_shadow_promo" --script
```
Copia l'output in `prisma/migrations/20260604140000_promo_codes/migration.sql` (crea la cartella). Atteso: `ALTER TYPE "TransazioneWalletTipo" ADD VALUE 'CREDITO_PROMO';` + `CREATE TABLE "promo_codes"...` + `CREATE TABLE "promo_code_redemptions"...` + indici/unique + FK. Poi `docker exec pv-postgres psql -U pv -d passaggio_veloce -c "DROP DATABASE pv_shadow_promo;"`.

- [ ] **Step 5: Applica in locale + genera client**. Da `packages/db`:
```
DATABASE_URL="postgresql://pv:pv_dev_password@127.0.0.1:5432/passaggio_veloce?schema=public" DIRECT_URL="postgresql://pv:pv_dev_password@127.0.0.1:5432/passaggio_veloce?schema=public" pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Verifica: `migrate status` → "up to date"; le tabelle `promo_codes`/`promo_code_redemptions` esistono.
> NB: `ALTER TYPE ... ADD VALUE` non può stare nella stessa transazione che poi usa il valore; Prisma lo gestisce in migration separata-step. Su Postgres ≥12 (Neon) è ok.

- [ ] **Step 6: Commit**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260604140000_promo_codes/
git commit -m "feat(db): modelli PromoCode/PromoCodeRedemption + enum CREDITO_PROMO"
```
(trailer: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>)

Report STATUS.

---

## Task 2: Validazione pura (evaluatePromoCode)

**Files:**
- Create: `apps/piattaforma/src/lib/promo/evaluate.ts`
- Test: `apps/piattaforma/src/lib/promo/evaluate.test.ts`

- [ ] **Step 1: Test (RED)** — `evaluate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizePromoCode, evaluatePromoCode } from './evaluate';

const NOW = new Date('2026-06-04T12:00:00Z');
const base = { amountCent: 5000, expiresAt: null, active: true, maxRedemptions: null };

describe('normalizePromoCode', () => {
  it('trim + uppercase', () => {
    expect(normalizePromoCode('  benvenuto10 ')).toBe('BENVENUTO10');
  });
});

describe('evaluatePromoCode', () => {
  it('null → inesistente', () => {
    expect(evaluatePromoCode(null, 0, NOW)).toEqual({ stato: 'inesistente' });
  });
  it('non attivo → inesistente', () => {
    expect(evaluatePromoCode({ ...base, active: false }, 0, NOW)).toEqual({ stato: 'inesistente' });
  });
  it('scaduto', () => {
    expect(evaluatePromoCode({ ...base, expiresAt: new Date('2026-06-01') }, 0, NOW)).toEqual({ stato: 'scaduto' });
  });
  it('esaurito quando count >= maxRedemptions', () => {
    expect(evaluatePromoCode({ ...base, maxRedemptions: 2 }, 2, NOW)).toEqual({ stato: 'esaurito' });
  });
  it('valido con importo', () => {
    expect(evaluatePromoCode(base, 0, NOW)).toEqual({ stato: 'valido', amountCent: 5000 });
  });
  it('valido se scadenza futura e count < max', () => {
    expect(evaluatePromoCode({ ...base, expiresAt: new Date('2026-12-31'), maxRedemptions: 5 }, 4, NOW))
      .toEqual({ stato: 'valido', amountCent: 5000 });
  });
});
```

- [ ] **Step 2: Run (RED)**: `pnpm --filter piattaforma test -- src/lib/promo/evaluate.test.ts` → FAIL (modulo mancante).

- [ ] **Step 3: Implementa `evaluate.ts`**:
```ts
export type PromoEvalInput = {
  amountCent: number;
  expiresAt: Date | null;
  active: boolean;
  maxRedemptions: number | null;
} | null;

export type PromoCheckResult =
  | { stato: 'inesistente' }
  | { stato: 'scaduto' }
  | { stato: 'esaurito' }
  | { stato: 'valido'; amountCent: number };

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

export function evaluatePromoCode(
  promo: PromoEvalInput,
  redemptionsCount: number,
  now: Date = new Date(),
): PromoCheckResult {
  if (!promo || !promo.active) return { stato: 'inesistente' };
  if (promo.expiresAt && promo.expiresAt.getTime() < now.getTime()) return { stato: 'scaduto' };
  if (promo.maxRedemptions != null && redemptionsCount >= promo.maxRedemptions) return { stato: 'esaurito' };
  return { stato: 'valido', amountCent: promo.amountCent };
}
```

- [ ] **Step 4: Run (GREEN)** + typecheck. Expected PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/promo/evaluate.ts apps/piattaforma/src/lib/promo/evaluate.test.ts
git commit -m "feat(promo): logica pura evaluatePromoCode + normalizePromoCode"
```
Report STATUS.

---

## Task 3: Helper redeemPromoCode (transazionale)

**Files:**
- Create: `apps/piattaforma/src/lib/promo/redeem.ts`
- Test: `apps/piattaforma/src/lib/promo/redeem.test.ts`

- [ ] **Step 1: Test (RED)** con un `tx` mockato — `redeem.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { redeemPromoCode } from './redeem';

function makeTx(promo: unknown, count = 0) {
  return {
    promoCode: { findUnique: vi.fn().mockResolvedValue(promo) },
    promoCodeRedemption: { count: vi.fn().mockResolvedValue(count), create: vi.fn().mockResolvedValue({ id: 'r1' }) },
    wallet: {
      upsert: vi.fn().mockResolvedValue({ id: 'w1', saldoCent: 1000 }),
      update: vi.fn().mockResolvedValue({}),
    },
    transazioneWallet: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
  };
}

const validPromo = { id: 'p1', amountCent: 5000, expiresAt: null, active: true, maxRedemptions: null };

describe('redeemPromoCode', () => {
  it('codice vuoto → applied:false, nessuna scrittura', async () => {
    const tx = makeTx(null);
    const r = await redeemPromoCode(tx as never, '   ', 'c1');
    expect(r).toEqual({ applied: false });
    expect(tx.transazioneWallet.create).not.toHaveBeenCalled();
  });

  it('inesistente → applied:false', async () => {
    const tx = makeTx(null);
    const r = await redeemPromoCode(tx as never, 'NOPE', 'c1');
    expect(r).toEqual({ applied: false });
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
  });

  it('valido → accredita wallet + crea redemption, applied:true', async () => {
    const tx = makeTx(validPromo, 0);
    const r = await redeemPromoCode(tx as never, ' benv ', 'c1');
    expect(r).toEqual({ applied: true, amountCent: 5000 });
    expect(tx.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: 'w1', tipo: 'CREDITO_PROMO', importoCent: 5000, saldoPostCent: 6000 }) }),
    );
    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { saldoCent: 6000 } });
    expect(tx.promoCodeRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ promoCodeId: 'p1', companyId: 'c1', amountCent: 5000, transazioneWalletId: 't1' }) }),
    );
  });

  it('esaurito → applied:false, nessun accredito', async () => {
    const tx = makeTx({ ...validPromo, maxRedemptions: 1 }, 1);
    const r = await redeemPromoCode(tx as never, 'X', 'c1');
    expect(r).toEqual({ applied: false });
    expect(tx.transazioneWallet.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (RED)** → FAIL (modulo mancante).

- [ ] **Step 3: Implementa `redeem.ts`**:
```ts
import 'server-only';
import type { Prisma } from '@pv/db';
import { normalizePromoCode, evaluatePromoCode } from './evaluate';

export type PromoRedeemResult = { applied: true; amountCent: number } | { applied: false };

/**
 * Riscatta un codice promozionale DENTRO una transazione di registrazione.
 * Best-effort: se il codice non è valido ritorna { applied: false } senza errori.
 */
export async function redeemPromoCode(
  tx: Prisma.TransactionClient,
  codeRaw: string,
  companyId: string,
): Promise<PromoRedeemResult> {
  const code = normalizePromoCode(codeRaw);
  if (!code) return { applied: false };

  const promo = await tx.promoCode.findUnique({
    where: { code },
    select: { id: true, amountCent: true, expiresAt: true, active: true, maxRedemptions: true },
  });
  const count = promo ? await tx.promoCodeRedemption.count({ where: { promoCodeId: promo.id } }) : 0;
  const res = evaluatePromoCode(promo, count);
  if (res.stato !== 'valido' || !promo) return { applied: false };

  const wallet = await tx.wallet.upsert({
    where: { companyId },
    create: { companyId, saldoCent: 0 },
    update: {},
  });
  const nuovoSaldo = wallet.saldoCent + res.amountCent;
  const transazione = await tx.transazioneWallet.create({
    data: {
      walletId: wallet.id,
      tipo: 'CREDITO_PROMO',
      importoCent: res.amountCent,
      saldoPostCent: nuovoSaldo,
      note: `Codice promozionale ${code}`,
    },
  });
  await tx.wallet.update({ where: { id: wallet.id }, data: { saldoCent: nuovoSaldo } });
  await tx.promoCodeRedemption.create({
    data: {
      promoCodeId: promo.id,
      companyId,
      amountCent: res.amountCent,
      transazioneWalletId: transazione.id,
    },
  });
  return { applied: true, amountCent: res.amountCent };
}
```

- [ ] **Step 4: Run (GREEN)** `pnpm --filter piattaforma test -- src/lib/promo/redeem.test.ts` + typecheck. PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/promo/redeem.ts apps/piattaforma/src/lib/promo/redeem.test.ts
git commit -m "feat(promo): redeemPromoCode (accredito wallet transazionale)"
```
Report STATUS.

---

## Task 4: checkPromoCodeAction + wiring registerAction

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`

- [ ] **Step 1: Aggiungi `checkPromoCodeAction`** in fondo ad actions.ts (è 'use server' in cima al file). Importa in cima:
```ts
import { evaluatePromoCode, normalizePromoCode, type PromoCheckResult } from '@/lib/promo/evaluate';
import { redeemPromoCode, type PromoRedeemResult } from '@/lib/promo/redeem';
```
Funzione:
```ts
// ============================================================
// CODICI PROMOZIONALI
// ============================================================
export async function checkPromoCodeAction(codeRaw: string): Promise<PromoCheckResult> {
  const code = normalizePromoCode(codeRaw ?? '');
  if (!code) return { stato: 'inesistente' };
  const promo = await prisma.promoCode.findUnique({
    where: { code },
    select: { id: true, amountCent: true, expiresAt: true, active: true, maxRedemptions: true },
  });
  if (!promo) return { stato: 'inesistente' };
  const count = await prisma.promoCodeRedemption.count({ where: { promoCodeId: promo.id } });
  return evaluatePromoCode(promo, count);
}
```

- [ ] **Step 2: Estendi `RegisterActionResult`** (cerca `export type RegisterActionResult`):
```ts
export type RegisterActionResult =
  | {
      ok: true;
      emailVerificationToken: string;
      promo?: { applied: true; amountCent: number } | { applied: false };
    }
  | { ok: false; error: string; field?: string };
```

- [ ] **Step 3: Leggi il codice promo dal payload** — vicino a dove si legge `refCodeFromPayload` (cerca `refCodeFromPayload`), aggiungi:
```ts
  const promoCodeFromPayload =
    typeof (payloadObj as { promoCode?: unknown }).promoCode === 'string'
      ? (payloadObj as { promoCode: string }).promoCode
      : '';
```

- [ ] **Step 4: Riscatta dentro la transazione** — dichiara prima della `prisma.$transaction(...)` (vicino a `createdCompanyId`):
```ts
  let promoResult: PromoRedeemResult = { applied: false };
```
Dentro il callback della transazione, DOPO la creazione dell'azienda (cerca `const createdCompany = await tx.company.create`), aggiungi subito dopo il blocco user/documenti (prima della fine del callback, dove viene impostato `createdCompanyId = companyId;`):
```ts
      if (promoCodeFromPayload) {
        promoResult = await redeemPromoCode(tx, promoCodeFromPayload, createdCompany.id);
      }
```
(`createdCompany.id` === `companyId`.)

- [ ] **Step 5: Ritorna l'esito** — modifica il `return { ok: true, emailVerificationToken: verificationToken };` finale in:
```ts
    return {
      ok: true,
      emailVerificationToken: verificationToken,
      promo: promoCodeFromPayload ? promoResult : undefined,
    };
```

- [ ] **Step 6: Test** — in `apps/piattaforma/src/app/(auth)/actions.test.ts`, estendi il mock `@pv/db` aggiungendo al `prisma` mockato `promoCode: { findUnique: vi.fn() }` e `promoCodeRedemption: { count: vi.fn() }` (accanto agli altri). Aggiungi un `describe('checkPromoCodeAction')`:
```ts
describe('checkPromoCodeAction', () => {
  it('codice inesistente', async () => {
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(null as never);
    const r = await checkPromoCodeAction('NOPE');
    expect(r).toEqual({ stato: 'inesistente' });
  });
  it('codice valido ritorna importo', async () => {
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue({ id: 'p1', amountCent: 5000, expiresAt: null, active: true, maxRedemptions: null } as never);
    vi.mocked(prisma.promoCodeRedemption.count).mockResolvedValue(0 as never);
    const r = await checkPromoCodeAction(' benv ');
    expect(r).toEqual({ stato: 'valido', amountCent: 5000 });
  });
});
```
Importa `checkPromoCodeAction` nella riga di import esistente da `./actions`.
(Il path felice di `registerAction` col promo NON è integration-testato qui — coperto da redeem.test.ts + verifica reale in Task 6.)

- [ ] **Step 7: Run** full suite + typecheck + lint. Verde.

- [ ] **Step 8: Commit**
```bash
git add "apps/piattaforma/src/app/(auth)/actions.ts" "apps/piattaforma/src/app/(auth)/actions.test.ts"
git commit -m "feat(promo): checkPromoCodeAction + riscatto best-effort in registerAction"
```
Report STATUS.

---

## Task 5: UI registrazione (step Pagamento)

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`

- [ ] **Step 1: Import** — aggiungi in cima:
```ts
import { checkPromoCodeAction } from '../actions';
import type { PromoCheckResult } from '@/lib/promo/evaluate';
import { formatCurrencyCent } from '@/lib/format';
```

- [ ] **Step 2: Stato esito promo nel wizard** — nel componente `RegisterWizard`, accanto agli altri `useState`, aggiungi:
```ts
  const [promoOutcome, setPromoOutcome] = useState<
    { applied: true; amountCent: number } | { applied: false } | null
  >(null);
```

- [ ] **Step 3: `handlePayment` accetta il codice promo e lo invia** — cambia la firma di `handlePayment` in `(values: PaymentData, promoCode: string)`; nel corpo, nel `JSON.stringify({...})` del payload aggiungi `promoCode,`. Dopo `const result = await registerAction(fd);`, dentro `if (result.ok) { setToken(...) }` aggiungi `setPromoOutcome(result.promo ?? null);`.

- [ ] **Step 4: `PaymentStep` gestisce il campo promo** — modifica `PaymentStep`:
  - cambia la prop `onSubmit` in `(data: PaymentData, promoCode: string) => void`.
  - aggiungi stato locale:
```ts
  const [promoCode, setPromoCode] = useState('');
  const [promoState, setPromoState] = useState<PromoCheckResult | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    setCheckingPromo(true);
    try {
      setPromoState(await checkPromoCodeAction(promoCode));
    } finally {
      setCheckingPromo(false);
    }
  };

  const promoMessage = (): { text: string; ok: boolean } | null => {
    if (!promoState) return null;
    if (promoState.stato === 'valido')
      return { ok: true, text: `Codice valido: ${formatCurrencyCent(promoState.amountCent)} verranno accreditati sul tuo wallet.` };
    if (promoState.stato === 'scaduto') return { ok: false, text: 'Codice scaduto.' };
    if (promoState.stato === 'esaurito') return { ok: false, text: 'Codice non più disponibile.' };
    return { ok: false, text: 'Codice inesistente.' };
  };
```
  - cambia `onSubmit={handleSubmit(onSubmit)}` del form in `onSubmit={handleSubmit((v) => onSubmit(v, promoCode))}`.
  - aggiungi il campo promo nel form (sopra ai checkbox), usando i componenti UI esistenti (`Field`, `Input`, `Button`):
```tsx
      <Field label="Codice promozionale (opzionale)">
        <div className="flex gap-2">
          <Input
            value={promoCode}
            onChange={(e) => {
              setPromoCode(e.target.value);
              setPromoState(null);
            }}
            placeholder="Es. BENVENUTO"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={applyPromo}
            loading={checkingPromo}
            className="shrink-0"
          >
            Applica
          </Button>
        </div>
      </Field>
      {promoMessage() && (
        <p className={`text-[13px] font-medium ${promoMessage()!.ok ? 'text-pv-green-500' : 'text-pv-red-500'}`}>
          {promoMessage()!.text}
        </p>
      )}
```
  (Verifica che `Button` accetti `loading`; se no, usa `disabled={checkingPromo}`. Verifica il nome prop in `components/ui/button.tsx`.)

- [ ] **Step 5: Esito promo nello schermo finale** — dove il wizard mostra il box DEMO (`{token && (...)}`), aggiungi sotto un avviso basato su `promoOutcome`:
```tsx
          {promoOutcome?.applied && (
            <div className="rounded-lg border border-pv-green-500 bg-pv-green-50 p-4 mt-4 text-sm text-pv-navy-900">
              🎁 Promozione applicata: <strong>{formatCurrencyCent(promoOutcome.amountCent)}</strong> accreditati sul tuo wallet.
            </div>
          )}
          {promoOutcome && !promoOutcome.applied && (
            <div className="rounded-lg border border-pv-amber-500 bg-pv-amber-50 p-4 mt-4 text-sm text-pv-navy-900">
              Codice promozionale non valido: nessuna promozione attivata.
            </div>
          )}
```
(Posiziona questi blocchi nel render del wizard accanto al box `token`, dove `promoOutcome` è in scope.)

- [ ] **Step 6: Run** full suite + typecheck + lint. Verde. (Se `Button` non ha `loading`, sostituisci con `disabled`.)

- [ ] **Step 7: Commit**
```bash
git add "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx"
git commit -m "feat(promo): campo codice promozionale + esito nello step Pagamento"
```
Report STATUS.

---

## Task 6: Sezione admin /admin/codici-promozionali

**Files:**
- Create: `apps/piattaforma/src/app/admin/codici-promozionali/page.tsx`
- Create: `apps/piattaforma/src/app/admin/codici-promozionali/actions.ts`
- Create: `apps/piattaforma/src/app/admin/codici-promozionali/client.tsx`
- Modify: `apps/piattaforma/src/components/app-shell.tsx`

- [ ] **Step 1: Server actions** — `actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { normalizePromoCode } from '@/lib/promo/evaluate';

export type CreatePromoResult = { ok: true } | { ok: false; error: string };

export async function createPromoCodeAction(input: {
  code: string;
  amountEuro: number;
  expiresAt?: string | null;
  maxRedemptions?: number | null;
}): Promise<CreatePromoResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo Admin Piattaforma può creare codici promozionali' };
  }
  const code = normalizePromoCode(input.code ?? '');
  if (!code) return { ok: false, error: 'Codice obbligatorio' };
  const amountCent = Math.round(Number(input.amountEuro) * 100);
  if (!Number.isFinite(amountCent) || amountCent <= 0) return { ok: false, error: 'Importo non valido' };

  const exists = await prisma.promoCode.findUnique({ where: { code } });
  if (exists) return { ok: false, error: 'Codice già esistente' };

  await prisma.promoCode.create({
    data: {
      code,
      amountCent,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      maxRedemptions: input.maxRedemptions && input.maxRedemptions > 0 ? Math.floor(input.maxRedemptions) : null,
      createdById: session.user.id,
    },
  });
  revalidatePath('/admin/codici-promozionali');
  return { ok: true };
}

export async function togglePromoCodeAction(id: string, active: boolean): Promise<CreatePromoResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  await prisma.promoCode.update({ where: { id }, data: { active } });
  revalidatePath('/admin/codici-promozionali');
  return { ok: true };
}
```

- [ ] **Step 2: Page (server)** — `page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { PromoCodiClient } from './client';

export default async function AdminCodiciPromoPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/codici-promozionali">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono gestire i codici promozionali.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const codici = await prisma.promoCode.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, code: true, amountCent: true, expiresAt: true, maxRedemptions: true,
      active: true, createdAt: true, _count: { select: { redemptions: true } },
    },
  });

  const rows = codici.map((c) => ({
    id: c.id,
    code: c.code,
    amountCent: c.amountCent,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    maxRedemptions: c.maxRedemptions,
    active: c.active,
    redemptions: c._count.redemptions,
  }));

  return (
    <AppShell session={session} activePath="/admin/codici-promozionali">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Codici promozionali
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Crea codici riscattabili in registrazione: l&apos;importo viene accreditato sul wallet della nuova azienda.
        </p>
        <PromoCodiClient rows={rows} />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Client (form + lista)** — `client.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { createPromoCodeAction, togglePromoCodeAction } from './actions';

type Row = {
  id: string; code: string; amountCent: number; expiresAt: string | null;
  maxRedemptions: number | null; active: boolean; redemptions: number;
};

function stato(r: Row): string {
  if (!r.active) return 'Disattivato';
  if (r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()) return 'Scaduto';
  if (r.maxRedemptions != null && r.redemptions >= r.maxRedemptions) return 'Esaurito';
  return 'Attivo';
}

export function PromoCodiClient({ rows }: { rows: Row[] }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [expires, setExpires] = useState('');
  const [maxR, setMaxR] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setError(null);
    startTransition(async () => {
      const r = await createPromoCodeAction({
        code,
        amountEuro: Number(amount),
        expiresAt: expires || null,
        maxRedemptions: maxR ? Number(maxR) : null,
      });
      if (!r.ok) setError(r.error);
      else {
        setCode(''); setAmount(''); setExpires(''); setMaxR('');
      }
    });
  };

  const toggle = (id: string, active: boolean) => {
    startTransition(async () => {
      await togglePromoCodeAction(id, active);
    });
  };

  return (
    <div className="mt-6 space-y-8">
      <div className="rounded-xl border border-pv-slate-200 bg-white p-5">
        <h2 className="text-[16px] font-bold text-pv-navy-900">Nuovo codice</h2>
        {error && <Alert variant="error" className="mt-3">{error}</Alert>}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Codice" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BENVENUTO" />
          </Field>
          <Field label="Importo (€)" required>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Scadenza" hint="Opzionale">
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Field label="Max riscatti" hint="Opzionale">
            <Input type="number" min="1" step="1" value={maxR} onChange={(e) => setMaxR(e.target.value)} />
          </Field>
        </div>
        <Button type="button" onClick={create} loading={pending} className="mt-4">
          Crea codice
        </Button>
      </div>

      <div className="rounded-xl border border-pv-slate-200 bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-pv-slate-50 text-pv-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Codice</th>
              <th className="px-4 py-2 text-left font-semibold">Importo</th>
              <th className="px-4 py-2 text-left font-semibold">Scadenza</th>
              <th className="px-4 py-2 text-left font-semibold">Riscatti</th>
              <th className="px-4 py-2 text-left font-semibold">Stato</th>
              <th className="px-4 py-2 text-right font-semibold">Azione</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-pv-slate-500">Nessun codice creato.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-pv-slate-100">
                <td className="px-4 py-2 font-semibold text-pv-navy-900">{r.code}</td>
                <td className="px-4 py-2">{formatCurrencyCent(r.amountCent)}</td>
                <td className="px-4 py-2">{r.expiresAt ? formatDate(new Date(r.expiresAt)) : '—'}</td>
                <td className="px-4 py-2">{r.redemptions}{r.maxRedemptions != null ? ` / ${r.maxRedemptions}` : ''}</td>
                <td className="px-4 py-2">{stato(r)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(r.id, !r.active)}
                    disabled={pending}
                    className="font-semibold text-pv-navy-600 hover:underline"
                  >
                    {r.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Voce nav admin** — in `apps/piattaforma/src/components/app-shell.tsx`, dopo `adminLinks.push({ href: '/admin/affiliazioni', label: 'Affiliazioni' });` aggiungi:
```ts
      adminLinks.push({ href: '/admin/codici-promozionali', label: 'Promo' });
```

- [ ] **Step 5: Run** full suite + typecheck + lint. Verde. (Verifica che `Button` abbia `loading`; altrimenti `disabled={pending}`. Verifica che `Alert` accetti `className`; altrimenti rimuovi.)

- [ ] **Step 6: Commit**
```bash
git add apps/piattaforma/src/app/admin/codici-promozionali/ apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(admin): sezione codici promozionali (crea/lista/attiva-disattiva)"
```
Report STATUS.

---

## Task 7: Verifica finale + deploy

- [ ] **Step 1: Suite completa**: `pnpm --filter piattaforma test && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint` → tutto verde.
- [ ] **Step 2: Build**: `pnpm --filter piattaforma build` → ok.
- [ ] **Step 3: Migration prod** — applica a `solitary-night` PRIMA del push (vedi [[project-prod-release-process]]): `DATABASE_URL=<solitary-night> DIRECT_URL=<solitary-night> pnpm --filter @pv/db exec prisma migrate deploy`. Verifica le tabelle + enum.
- [ ] **Step 4: Deploy**: merge branch → `main` → push (Vercel rebuild).
- [ ] **Step 5: Verifica live** (chrome-devtools): in `/admin/codici-promozionali` crea un codice (es. BENVENUTO, 50€); poi in registrazione applica il codice (vedi "50€..."), completa, e verifica nel DB prod che la `promo_code_redemptions` + `transazioni_wallet` (CREDITO_PROMO) + `wallets.saldoCent` siano corretti. Test anche codice inesistente (avviso non bloccante).

---

## Note esecuzione
- DRY: validazione in `evaluate.ts`, riuso in checkAction (live) e redeem (autoritativo). YAGNI: niente edit/delete codici, niente tipi percentuali. TDD: evaluate + redeem testati prima. Best-effort: il promo non blocca mai la registrazione. Branch dedicato → migration prod → push, come [[project-prod-release-process]].
