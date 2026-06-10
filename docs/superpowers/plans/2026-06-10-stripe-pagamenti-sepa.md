# Stripe Pagamenti SEPA — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le agenzie si registrano e configurano un mandato SEPA Direct Debit reale via Stripe (TEST mode), e il flusso pratica monetario (addebito agenzia → wallet broker → payout) è completo e validabile senza muovere denaro reale.

**Architecture:** `PAYMENT_PROVIDER=stripe` con chiavi di test accende i job esistenti contro l'API test di Stripe (denaro finto). Mandato raccolto server-side in registrazione (solo AGENZIA) tramite `SetupIntent` con IBAN + accettazione online. `StripePaymentProvider` implementa `chargeFee` (PaymentIntent SEPA `off_session`) ed `executePayout` (no-op Strada B: bonifico dal conto PV fuori Stripe). Il settlement SEPA asincrono è finalizzato da un webhook.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 5 + Postgres, Stripe Node SDK, vitest, pnpm/Turborepo.

**Riferimento spec:** `docs/superpowers/specs/2026-06-10-stripe-pagamenti-sepa-design.md`

---

## File Structure

**Nuovi file:**
- `apps/piattaforma/src/lib/providers/payment/stripe-client.ts` — singleton client Stripe (`getStripe()`), asserzione env.
- `apps/piattaforma/src/lib/providers/payment/stripe-mandate.ts` — `setupSepaMandate()` (Stripe puro) + `applySepaMandateToAgency()` (setup + persistenza Company).
- `apps/piattaforma/src/lib/providers/payment/stripe.ts` — `StripePaymentProvider` (`chargeFee` + `executePayout`).
- `apps/piattaforma/src/lib/jobs/fee-outcome.ts` — helper puro `feeOutcomeFromResult()` (mapping `PaymentResult` → stato fee, gestisce `pending`).
- `apps/piattaforma/src/lib/jobs/stripe-webhook.ts` — `handleStripeEvent()` (routing eventi → update DB).
- `apps/piattaforma/src/app/api/webhooks/stripe/route.ts` — endpoint webhook (verifica firma + dispatch).
- Test: `stripe-client.test.ts`, `stripe-mandate.test.ts`, `stripe.test.ts`, `fee-outcome.test.ts`, `stripe-webhook.test.ts`.

**File modificati:**
- `packages/db/prisma/schema.prisma` — campi `Company` Stripe + enum `SepaMandateStatus` (+ migration `add_stripe_sepa`).
- `apps/piattaforma/src/lib/providers/payment/types.ts` — `PaymentResult.pending`.
- `apps/piattaforma/src/lib/providers/payment/index.ts` — `case 'stripe'`.
- `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts` — usa `feeOutcomeFromResult`.
- `apps/piattaforma/src/env.ts` — `STRIPE_WEBHOOK_SECRET`.
- `apps/piattaforma/src/app/(auth)/actions.ts` — setup mandato post-commit (AGENZIA).
- `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` — testo mandato role-aware.
- `.env.example`, `apps/piattaforma/package.json`.

---

### Task 1: Aggiungere la dipendenza `stripe`

**Files:**
- Modify: `apps/piattaforma/package.json`

- [ ] **Step 1: Installare lo SDK Stripe**

Run (dalla root del repo):
```
pnpm --filter piattaforma add stripe
```
Expected: `stripe` compare in `apps/piattaforma/package.json` → `dependencies`, lockfile aggiornato.

- [ ] **Step 2: Verificare l'import**

Run:
```
pnpm --filter piattaforma exec node -e "require('stripe'); console.log('stripe ok')"
```
Expected: stampa `stripe ok` senza errori.

- [ ] **Step 3: Commit**

```
git add apps/piattaforma/package.json pnpm-lock.yaml
git commit -m "build(stripe): aggiunge SDK stripe a piattaforma"
```

---

### Task 2: Schema — campi Stripe su Company + enum `SepaMandateStatus`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Company`, ~riga 296-298; aggiunta enum)

- [ ] **Step 1: Aggiungere i campi al model `Company`**

In `model Company`, subito dopo le righe esistenti `iban` / `sepaMandateAccepted` / `sepaMandateAcceptedAt`, aggiungere:

```prisma
  /// Stripe Customer dell'agenzia (null per dealer/broker).
  stripeCustomerId String?

  /// PaymentMethod sepa_debit salvato, usato per gli addebiti off_session.
  stripePaymentMethodId String?

  /// Id del mandato SEPA Stripe (audit legale / dichiarazioni).
  sepaMandateId String?

  /// Stato del mandato SEPA. PENDING finché Stripe non conferma,
  /// ACTIVE quando utilizzabile per addebiti, FAILED se il setup fallisce.
  sepaMandateStatus SepaMandateStatus @default(PENDING)
```

- [ ] **Step 2: Aggiungere l'enum**

In fondo alla sezione enum (vicino agli altri enum pagamento, es. dopo `FeeAddebitoStato`), aggiungere:

```prisma
enum SepaMandateStatus {
  PENDING
  ACTIVE
  FAILED
}
```

- [ ] **Step 3: Creare la migration**

Run (dalla root):
```
pnpm --filter @pv/db db:migrate --name add_stripe_sepa
```
Expected: crea `packages/db/prisma/migrations/<timestamp>_add_stripe_sepa/migration.sql`, applica al DB locale, rigenera il client.

- [ ] **Step 4: Verificare la generazione client**

Run:
```
pnpm --filter @pv/db db:generate
pnpm --filter @pv/db typecheck
```
Expected: nessun errore; il client espone `Company.sepaMandateStatus` e i nuovi campi.

- [ ] **Step 5: Commit**

```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): campi Stripe + enum SepaMandateStatus su Company"
```

---

### Task 3: Estendere `PaymentResult` con `pending`

**Files:**
- Modify: `apps/piattaforma/src/lib/providers/payment/types.ts:15-17`

- [ ] **Step 1: Modificare il tipo**

Sostituire il blocco `PaymentResult` con:

```ts
export type PaymentResult =
  | { ok: true; providerRef: string; pending?: boolean }
  | { ok: false; error: string; retryable: boolean };
```

- [ ] **Step 2: Verificare che i test mock passino ancora (retro-compatibilità)**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/mock.test.ts
```
Expected: PASS (il mock non setta `pending`, comportamento invariato).

- [ ] **Step 3: Commit**

```
git add apps/piattaforma/src/lib/providers/payment/types.ts
git commit -m "feat(payment): PaymentResult.pending per settlement asincrono SEPA"
```

---

### Task 4: Client Stripe singleton (`getStripe`)

**Files:**
- Create: `apps/piattaforma/src/lib/providers/payment/stripe-client.ts`
- Test: `apps/piattaforma/src/lib/providers/payment/stripe-client.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getStripe', () => {
  beforeEach(() => vi.resetModules());

  it('lancia se STRIPE_SECRET_KEY manca', async () => {
    vi.doMock('@/env', () => ({ env: { STRIPE_SECRET_KEY: undefined } }));
    const { getStripe } = await import('./stripe-client');
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('ritorna un client Stripe quando la chiave è presente', async () => {
    vi.doMock('@/env', () => ({ env: { STRIPE_SECRET_KEY: 'sk_test_fake' } }));
    const { getStripe } = await import('./stripe-client');
    const s = getStripe();
    expect(s.customers).toBeTruthy();
    expect(s.paymentIntents).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test per verificare il fallimento**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/stripe-client.test.ts
```
Expected: FAIL — `Cannot find module './stripe-client'`.

- [ ] **Step 3: Implementare il client**

```ts
import 'server-only';
import Stripe from 'stripe';
import { env } from '@/env';

let instance: Stripe | null = null;

/** Istanza singleton Stripe. Lancia se la chiave manca (provider=stripe senza env). */
export function getStripe(): Stripe {
  if (instance) return instance;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY mancante con PAYMENT_PROVIDER=stripe');
  }
  instance = new Stripe(env.STRIPE_SECRET_KEY);
  return instance;
}
```

- [ ] **Step 4: Run test per verificare il successo**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/stripe-client.test.ts
```
Expected: PASS (2 test).

- [ ] **Step 5: Commit**

```
git add apps/piattaforma/src/lib/providers/payment/stripe-client.ts apps/piattaforma/src/lib/providers/payment/stripe-client.test.ts
git commit -m "feat(payment): client Stripe singleton con asserzione env"
```

---

### Task 5: Setup mandato SEPA (`setupSepaMandate` + `applySepaMandateToAgency`)

**Files:**
- Create: `apps/piattaforma/src/lib/providers/payment/stripe-mandate.ts`
- Test: `apps/piattaforma/src/lib/providers/payment/stripe-mandate.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { customersCreate, setupIntentsCreate, companyUpdate } = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  setupIntentsCreate: vi.fn(),
  companyUpdate: vi.fn(),
}));

vi.mock('./stripe-client', () => ({
  getStripe: () => ({
    customers: { create: customersCreate },
    setupIntents: { create: setupIntentsCreate },
  }),
}));
vi.mock('@pv/db', () => ({ prisma: { company: { update: companyUpdate } } }));

import { setupSepaMandate, applySepaMandateToAgency } from './stripe-mandate';

const input = {
  companyId: 'co-1',
  iban: 'IT60X0542811101000000123456',
  name: 'Agenzia X',
  email: 'a@x.it',
  ip: '1.2.3.0',
  userAgent: 'jest',
};

describe('setupSepaMandate', () => {
  beforeEach(() => {
    customersCreate.mockReset();
    setupIntentsCreate.mockReset();
  });

  it('crea customer + SetupIntent SEPA e ritorna gli id', async () => {
    customersCreate.mockResolvedValue({ id: 'cus_1' });
    setupIntentsCreate.mockResolvedValue({
      id: 'seti_1',
      payment_method: 'pm_1',
      mandate: 'mandate_1',
      status: 'succeeded',
    });

    const r = await setupSepaMandate(input);

    expect(r).toEqual({ ok: true, customerId: 'cus_1', paymentMethodId: 'pm_1', mandateId: 'mandate_1' });
    expect(setupIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        payment_method_types: ['sepa_debit'],
        confirm: true,
        payment_method_data: expect.objectContaining({
          type: 'sepa_debit',
          sepa_debit: { iban: input.iban },
        }),
        mandate_data: expect.objectContaining({
          customer_acceptance: expect.objectContaining({ type: 'online' }),
        }),
        metadata: { companyId: 'co-1' },
      }),
    );
  });

  it('ritorna ok:false in caso di errore Stripe', async () => {
    customersCreate.mockRejectedValue(new Error('stripe down'));
    const r = await setupSepaMandate(input);
    expect(r).toEqual({ ok: false, error: 'stripe down' });
  });
});

describe('applySepaMandateToAgency', () => {
  beforeEach(() => {
    customersCreate.mockReset();
    setupIntentsCreate.mockReset();
    companyUpdate.mockReset();
  });

  it('persiste gli id e ritorna ACTIVE quando il setup riesce', async () => {
    customersCreate.mockResolvedValue({ id: 'cus_1' });
    setupIntentsCreate.mockResolvedValue({ id: 'seti_1', payment_method: 'pm_1', mandate: 'mandate_1' });

    const status = await applySepaMandateToAgency(input);

    expect(status).toBe('ACTIVE');
    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: {
        stripeCustomerId: 'cus_1',
        stripePaymentMethodId: 'pm_1',
        sepaMandateId: 'mandate_1',
        sepaMandateStatus: 'ACTIVE',
      },
    });
  });

  it('marca FAILED quando il setup fallisce', async () => {
    customersCreate.mockRejectedValue(new Error('boom'));
    const status = await applySepaMandateToAgency(input);
    expect(status).toBe('FAILED');
    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { sepaMandateStatus: 'FAILED' },
    });
  });
});
```

- [ ] **Step 2: Run test per verificare il fallimento**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/stripe-mandate.test.ts
```
Expected: FAIL — modulo `./stripe-mandate` non trovato.

- [ ] **Step 3: Implementare il modulo**

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { getStripe } from './stripe-client';

export type SetupSepaMandateInput = {
  companyId: string;
  iban: string;
  name: string;
  email: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type SetupSepaMandateResult =
  | { ok: true; customerId: string; paymentMethodId: string; mandateId: string | null }
  | { ok: false; error: string };

/** Crea Customer + mandato SEPA Direct Debit (server-side). Non scrive sul DB. */
export async function setupSepaMandate(input: SetupSepaMandateInput): Promise<SetupSepaMandateResult> {
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.create(
      { name: input.name, email: input.email, metadata: { companyId: input.companyId } },
      { idempotencyKey: `setup-mandate-customer:${input.companyId}` },
    );
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['sepa_debit'],
      payment_method_data: {
        type: 'sepa_debit',
        sepa_debit: { iban: input.iban },
        billing_details: { name: input.name, email: input.email },
      },
      mandate_data: {
        customer_acceptance: {
          type: 'online',
          online: {
            ip_address: input.ip ?? '0.0.0.0',
            user_agent: input.userAgent ?? 'unknown',
          },
        },
      },
      confirm: true,
      metadata: { companyId: input.companyId },
    });
    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : (setupIntent.payment_method?.id ?? null);
    if (!paymentMethodId) {
      return { ok: false, error: 'PaymentMethod non creato dal SetupIntent' };
    }
    const mandateId =
      typeof setupIntent.mandate === 'string' ? setupIntent.mandate : (setupIntent.mandate?.id ?? null);
    return { ok: true, customerId: customer.id, paymentMethodId, mandateId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ApplySepaMandateStatus = 'ACTIVE' | 'FAILED';

/** Setup mandato + persistenza su Company. Best-effort dal flusso registrazione (AGENZIA). */
export async function applySepaMandateToAgency(
  input: SetupSepaMandateInput,
): Promise<ApplySepaMandateStatus> {
  const r = await setupSepaMandate(input);
  if (r.ok) {
    await prisma.company.update({
      where: { id: input.companyId },
      data: {
        stripeCustomerId: r.customerId,
        stripePaymentMethodId: r.paymentMethodId,
        sepaMandateId: r.mandateId,
        sepaMandateStatus: 'ACTIVE',
      },
    });
    return 'ACTIVE';
  }
  await prisma.company.update({
    where: { id: input.companyId },
    data: { sepaMandateStatus: 'FAILED' },
  });
  return 'FAILED';
}
```

- [ ] **Step 4: Run test per verificare il successo**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/stripe-mandate.test.ts
```
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```
git add apps/piattaforma/src/lib/providers/payment/stripe-mandate.ts apps/piattaforma/src/lib/providers/payment/stripe-mandate.test.ts
git commit -m "feat(payment): setup mandato SEPA server-side + persistenza Company"
```

---

### Task 6: `StripePaymentProvider` (chargeFee + executePayout)

**Files:**
- Create: `apps/piattaforma/src/lib/providers/payment/stripe.ts`
- Test: `apps/piattaforma/src/lib/providers/payment/stripe.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { paymentIntentsCreate, companyFindUnique } = vi.hoisted(() => ({
  paymentIntentsCreate: vi.fn(),
  companyFindUnique: vi.fn(),
}));

vi.mock('./stripe-client', () => ({
  getStripe: () => ({ paymentIntents: { create: paymentIntentsCreate } }),
}));
vi.mock('@pv/db', () => ({ prisma: { company: { findUnique: companyFindUnique } } }));

import { StripePaymentProvider } from './stripe';

const provider = new StripePaymentProvider();
const charge = { feeAddebitoId: 'fee-1', importoCent: 7500, agenziaId: 'ag-1' };
const activeAgency = {
  stripeCustomerId: 'cus_1',
  stripePaymentMethodId: 'pm_1',
  sepaMandateStatus: 'ACTIVE',
};

describe('StripePaymentProvider.chargeFee', () => {
  beforeEach(() => {
    paymentIntentsCreate.mockReset();
    companyFindUnique.mockReset();
  });

  it('processing → ok + pending', async () => {
    companyFindUnique.mockResolvedValue(activeAgency);
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', status: 'processing' });
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: true, providerRef: 'pi_1', pending: true });
  });

  it('succeeded → ok senza pending', async () => {
    companyFindUnique.mockResolvedValue(activeAgency);
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_2', status: 'succeeded' });
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: true, providerRef: 'pi_2' });
  });

  it('mandato non ACTIVE → ok:false non-retryable, niente chiamata Stripe', async () => {
    companyFindUnique.mockResolvedValue({ ...activeAgency, sepaMandateStatus: 'PENDING' });
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: false, error: 'Mandato SEPA non configurato', retryable: false });
    expect(paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it('errore Stripe → ok:false con retryable da tipo errore', async () => {
    companyFindUnique.mockResolvedValue(activeAgency);
    const err = Object.assign(new Error('rate limited'), { type: 'StripeRateLimitError' });
    paymentIntentsCreate.mockRejectedValue(err);
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: false, error: 'rate limited', retryable: true });
  });

  it('importo non valido → ok:false non-retryable', async () => {
    const r = await provider.chargeFee({ ...charge, importoCent: 0 });
    expect(r).toEqual({ ok: false, error: 'Importo non valido', retryable: false });
  });
});

describe('StripePaymentProvider.executePayout', () => {
  it('Strada B no-op → ok con providerRef manual-bonifico', async () => {
    const r = await provider.executePayout({ payoutId: 'po-1', importoCent: 50000, iban: 'IT60X0542811101000000123456' });
    expect(r).toEqual({ ok: true, providerRef: 'manual-bonifico:po-1' });
  });

  it('importo non valido → ok:false non-retryable', async () => {
    const r = await provider.executePayout({ payoutId: 'po-x', importoCent: -1, iban: 'IT60' });
    expect(r).toEqual({ ok: false, error: 'Importo non valido', retryable: false });
  });
});
```

- [ ] **Step 2: Run test per verificare il fallimento**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/stripe.test.ts
```
Expected: FAIL — modulo `./stripe` non trovato.

- [ ] **Step 3: Implementare il provider**

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { getStripe } from './stripe-client';
import type { ChargeFeeInput, ExecutePayoutInput, PaymentProvider, PaymentResult } from './types';

function isRetryableStripeError(err: unknown): boolean {
  const type = (err as { type?: string } | null)?.type;
  return (
    type === 'StripeConnectionError' ||
    type === 'StripeAPIError' ||
    type === 'StripeRateLimitError'
  );
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  async chargeFee(input: ChargeFeeInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    const agenzia = await prisma.company.findUnique({
      where: { id: input.agenziaId },
      select: { stripeCustomerId: true, stripePaymentMethodId: true, sepaMandateStatus: true },
    });
    if (
      !agenzia ||
      agenzia.sepaMandateStatus !== 'ACTIVE' ||
      !agenzia.stripeCustomerId ||
      !agenzia.stripePaymentMethodId
    ) {
      return { ok: false, error: 'Mandato SEPA non configurato', retryable: false };
    }
    try {
      const stripe = getStripe();
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.importoCent,
          currency: 'eur',
          customer: agenzia.stripeCustomerId,
          payment_method: agenzia.stripePaymentMethodId,
          payment_method_types: ['sepa_debit'],
          off_session: true,
          confirm: true,
          metadata: { feeAddebitoId: input.feeAddebitoId },
        },
        { idempotencyKey: `charge-fee:${input.feeAddebitoId}` },
      );
      switch (pi.status) {
        case 'succeeded':
          return { ok: true, providerRef: pi.id };
        case 'processing':
          return { ok: true, providerRef: pi.id, pending: true };
        case 'requires_payment_method':
        case 'canceled':
          return { ok: false, error: `PaymentIntent stato ${pi.status}`, retryable: true };
        default:
          return { ok: false, error: `PaymentIntent stato ${pi.status}`, retryable: false };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: isRetryableStripeError(e) };
    }
  }

  async executePayout(input: ExecutePayoutInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    // Strada B: bonifico dal conto PV (fuori Stripe). No-op che registra il payout.
    // Al go-live sostituire con conferma admin o generazione file SEPA XML (pain.001).
    console.warn(
      `[stripe] payout Strada B no-op (bonifico manuale): payout=${input.payoutId} importo=${input.importoCent}c`,
    );
    return { ok: true, providerRef: `manual-bonifico:${input.payoutId}` };
  }
}
```

- [ ] **Step 4: Run test per verificare il successo**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/stripe.test.ts
```
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```
git add apps/piattaforma/src/lib/providers/payment/stripe.ts apps/piattaforma/src/lib/providers/payment/stripe.test.ts
git commit -m "feat(payment): StripePaymentProvider (chargeFee SEPA + executePayout no-op Strada B)"
```

---

### Task 7: Cablare `getPayment()` sul provider Stripe

**Files:**
- Modify: `apps/piattaforma/src/lib/providers/payment/index.ts:1-22`

- [ ] **Step 1: Sostituire il ramo `case 'stripe'`**

Aggiungere l'import in testa (dopo l'import di `MockPaymentProvider`):
```ts
import { StripePaymentProvider } from './stripe';
```
Sostituire:
```ts
    case 'stripe':
      throw new Error('Stripe payment provider not yet implemented');
```
con:
```ts
    case 'stripe':
      instance = new StripePaymentProvider();
      break;
```

- [ ] **Step 2: Scrivere il test che fallisce**

Create `apps/piattaforma/src/lib/providers/payment/index.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./stripe', () => ({
  StripePaymentProvider: class {
    readonly name = 'stripe' as const;
    async chargeFee() { return { ok: true as const, providerRef: 'x' }; }
    async executePayout() { return { ok: true as const, providerRef: 'y' }; }
  },
}));

describe('getPayment', () => {
  beforeEach(() => vi.resetModules());

  it('ritorna il provider stripe quando PAYMENT_PROVIDER=stripe', async () => {
    vi.doMock('@/env', () => ({ env: { PAYMENT_PROVIDER: 'stripe' } }));
    const { getPayment } = await import('./index');
    expect(getPayment().name).toBe('stripe');
  });

  it('ritorna il provider mock quando PAYMENT_PROVIDER=mock', async () => {
    vi.doMock('@/env', () => ({ env: { PAYMENT_PROVIDER: 'mock' } }));
    const { getPayment } = await import('./index');
    expect(getPayment().name).toBe('mock');
  });
});
```

> Nota: `vi.resetModules()` in `beforeEach` azzera il singleton `instance` cablato a livello di modulo, così i due rami non si contaminano.

- [ ] **Step 3: Run test**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/providers/payment/index.test.ts
```
Expected: PASS (2 test).

- [ ] **Step 4: Commit**

```
git add apps/piattaforma/src/lib/providers/payment/index.ts apps/piattaforma/src/lib/providers/payment/index.test.ts
git commit -m "feat(payment): getPayment() istanzia StripePaymentProvider"
```

---

### Task 8: env — `STRIPE_WEBHOOK_SECRET` + `.env.example`

**Files:**
- Modify: `apps/piattaforma/src/env.ts:37-38` (server) e `:66-67` (runtimeEnv)
- Modify: `.env.example`

- [ ] **Step 1: Aggiungere la var al server schema**

In `env.ts`, nel blocco `server`, subito dopo `STRIPE_SECRET_KEY: z.string().optional(),`:
```ts
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
```

- [ ] **Step 2: Aggiungere al runtimeEnv**

Nel blocco `runtimeEnv`, dopo `STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,`:
```ts
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
```

- [ ] **Step 3: Aggiornare `.env.example`**

Aggiungere/aggiornare la sezione Stripe in `.env.example`:
```
# Pagamenti — Stripe (Fase 1: TEST mode, nessun denaro reale)
# Con PAYMENT_PROVIDER=mock i job di pagamento restano sospesi.
PAYMENT_PROVIDER=mock
# STRIPE_SECRET_KEY=sk_test_...          # da Stripe Dashboard → Developers → API keys
# STRIPE_WEBHOOK_SECRET=whsec_...        # da `stripe listen` (dev) o webhook dashboard (deploy)
```

- [ ] **Step 4: Verificare il typecheck**

Run:
```
pnpm --filter piattaforma typecheck
```
Expected: nessun errore.

- [ ] **Step 5: Commit**

```
git add apps/piattaforma/src/env.ts .env.example
git commit -m "feat(payment): env STRIPE_WEBHOOK_SECRET + esempio Stripe TEST mode"
```

---

### Task 9: Gestione settlement asincrono in `process-fee-scheduled`

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/fee-outcome.ts`
- Test: `apps/piattaforma/src/lib/jobs/fee-outcome.test.ts`
- Modify: `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts:31-66`

- [ ] **Step 1: Scrivere il test dell'helper puro**

```ts
import { describe, it, expect } from 'vitest';
import { feeOutcomeFromResult } from './fee-outcome';

describe('feeOutcomeFromResult', () => {
  it('ok senza pending → SUCCESS', () => {
    expect(feeOutcomeFromResult({ ok: true, providerRef: 'pi_1' })).toEqual({
      status: 'SUCCESS', providerRef: 'pi_1',
    });
  });

  it('ok con pending → PENDING (resta IN_LAVORAZIONE)', () => {
    expect(feeOutcomeFromResult({ ok: true, providerRef: 'pi_1', pending: true })).toEqual({
      status: 'PENDING', providerRef: 'pi_1',
    });
  });

  it('fallimento retryable → RETRY', () => {
    expect(feeOutcomeFromResult({ ok: false, error: 'x', retryable: true })).toEqual({
      status: 'RETRY', error: 'x',
    });
  });

  it('fallimento non-retryable → FAILED', () => {
    expect(feeOutcomeFromResult({ ok: false, error: 'y', retryable: false })).toEqual({
      status: 'FAILED', error: 'y',
    });
  });
});
```

- [ ] **Step 2: Run test per verificare il fallimento**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/jobs/fee-outcome.test.ts
```
Expected: FAIL — modulo `./fee-outcome` non trovato.

- [ ] **Step 3: Implementare l'helper**

```ts
import type { PaymentResult } from '@/lib/providers/payment';

export type FeeOutcome =
  | { status: 'SUCCESS'; providerRef: string }
  | { status: 'PENDING'; providerRef: string }
  | { status: 'RETRY'; error: string }
  | { status: 'FAILED'; error: string };

/** Mappa l'esito del provider sullo stato del FeeAddebito.
 *  PENDING = SEPA in settlement: il fee resta IN_LAVORAZIONE, il webhook finalizza. */
export function feeOutcomeFromResult(result: PaymentResult): FeeOutcome {
  if (result.ok) {
    return result.pending
      ? { status: 'PENDING', providerRef: result.providerRef }
      : { status: 'SUCCESS', providerRef: result.providerRef };
  }
  return result.retryable
    ? { status: 'RETRY', error: result.error }
    : { status: 'FAILED', error: result.error };
}
```

- [ ] **Step 4: Run test per verificare il successo**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/jobs/fee-outcome.test.ts
```
Expected: PASS (4 test).

- [ ] **Step 5: Usare l'helper nel job**

In `process-fee-scheduled.ts`, aggiungere l'import in testa:
```ts
import { feeOutcomeFromResult } from './fee-outcome';
```
Sostituire il blocco `if (result.ok) { ... } else { ... }` (righe ~43-65) con:
```ts
    const outcome = feeOutcomeFromResult(result);
    if (outcome.status === 'SUCCESS') {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: { stato: 'SUCCESS', providerRef: outcome.providerRef, executedAt: new Date(), errorMessage: null },
      });
      succeeded++;
      // TODO: invia N8_AGENZIA_ADDEBITO — richiede query pratica+agenzia per payload
    } else if (outcome.status === 'PENDING') {
      // SEPA in settlement: resta IN_LAVORAZIONE, il webhook payment_intent.*
      // finalizzerà SUCCESS/FAILED. Salviamo solo il providerRef.
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: { providerRef: outcome.providerRef },
      });
    } else {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: { stato: outcome.status, errorMessage: outcome.error, executedAt: new Date() },
      });
      failed++;
    }
```

- [ ] **Step 6: Verificare typecheck + suite job**

Run:
```
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma exec vitest run src/lib/jobs
```
Expected: nessun errore TS; test job verdi.

- [ ] **Step 7: Commit**

```
git add apps/piattaforma/src/lib/jobs/fee-outcome.ts apps/piattaforma/src/lib/jobs/fee-outcome.test.ts apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts
git commit -m "feat(payment): settlement SEPA asincrono (fee PENDING resta IN_LAVORAZIONE)"
```

---

### Task 10: Webhook Stripe (handler + route)

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/stripe-webhook.ts`
- Test: `apps/piattaforma/src/lib/jobs/stripe-webhook.test.ts`
- Create: `apps/piattaforma/src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Scrivere il test dell'handler**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, companyUpdateMany } = vi.hoisted(() => ({
  feeUpdateMany: vi.fn(),
  companyUpdateMany: vi.fn(),
}));
vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { updateMany: feeUpdateMany },
    company: { updateMany: companyUpdateMany },
  },
}));

import { handleStripeEvent } from './stripe-webhook';

beforeEach(() => {
  feeUpdateMany.mockReset();
  companyUpdateMany.mockReset();
});

it('payment_intent.succeeded → fee SUCCESS via metadata', async () => {
  await handleStripeEvent({
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', metadata: { feeAddebitoId: 'fee-1' } } },
  } as never);
  expect(feeUpdateMany).toHaveBeenCalledWith({
    where: { id: 'fee-1', stato: { not: 'SUCCESS' } },
    data: { stato: 'SUCCESS', providerRef: 'pi_1', executedAt: expect.any(Date), errorMessage: null },
  });
});

it('payment_intent.payment_failed → fee FAILED', async () => {
  await handleStripeEvent({
    type: 'payment_intent.payment_failed',
    data: { object: { id: 'pi_2', metadata: { feeAddebitoId: 'fee-2' }, last_payment_error: { message: 'rifiutato' } } },
  } as never);
  expect(feeUpdateMany).toHaveBeenCalledWith({
    where: { id: 'fee-2', stato: { notIn: ['SUCCESS', 'FAILED'] } },
    data: { stato: 'FAILED', errorMessage: 'rifiutato' },
  });
});

it('setup_intent.succeeded → mandato ACTIVE via metadata.companyId', async () => {
  await handleStripeEvent({
    type: 'setup_intent.succeeded',
    data: { object: { id: 'seti_1', metadata: { companyId: 'co-1' } } },
  } as never);
  expect(companyUpdateMany).toHaveBeenCalledWith({
    where: { id: 'co-1' },
    data: { sepaMandateStatus: 'ACTIVE' },
  });
});

it('evento non gestito → no-op', async () => {
  await handleStripeEvent({ type: 'charge.updated', data: { object: {} } } as never);
  expect(feeUpdateMany).not.toHaveBeenCalled();
  expect(companyUpdateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test per verificare il fallimento**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/jobs/stripe-webhook.test.ts
```
Expected: FAIL — modulo `./stripe-webhook` non trovato.

- [ ] **Step 3: Implementare l'handler**

```ts
import 'server-only';
import { prisma } from '@pv/db';
import type Stripe from 'stripe';

/** Routing idempotente degli eventi Stripe rilevanti. Fonte di verità per il
 *  settlement SEPA asincrono e per lo stato del mandato. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        await prisma.feeAddebito.updateMany({
          where: { id: feeId, stato: { not: 'SUCCESS' } },
          data: { stato: 'SUCCESS', providerRef: pi.id, executedAt: new Date(), errorMessage: null },
        });
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        await prisma.feeAddebito.updateMany({
          where: { id: feeId, stato: { notIn: ['SUCCESS', 'FAILED'] } },
          data: { stato: 'FAILED', errorMessage: pi.last_payment_error?.message ?? 'SEPA payment failed' },
        });
      }
      break;
    }
    case 'setup_intent.succeeded': {
      const si = event.data.object as Stripe.SetupIntent;
      const companyId = si.metadata?.companyId;
      if (companyId) {
        await prisma.company.updateMany({
          where: { id: companyId },
          data: { sepaMandateStatus: 'ACTIVE' },
        });
      }
      break;
    }
    case 'setup_intent.setup_failed': {
      const si = event.data.object as Stripe.SetupIntent;
      const companyId = si.metadata?.companyId;
      if (companyId) {
        await prisma.company.updateMany({
          where: { id: companyId },
          data: { sepaMandateStatus: 'FAILED' },
        });
      }
      break;
    }
    default:
      // Evento non rilevante: ack senza azione.
      break;
  }
}
```

- [ ] **Step 4: Run test per verificare il successo**

Run:
```
pnpm --filter piattaforma exec vitest run src/lib/jobs/stripe-webhook.test.ts
```
Expected: PASS (4 test).

- [ ] **Step 5: Implementare la route (verifica firma + dispatch)**

Create `apps/piattaforma/src/app/api/webhooks/stripe/route.ts`:
```ts
import { env } from '@/env';
import { getStripe } from '@/lib/providers/payment/stripe-client';
import { handleStripeEvent } from '@/lib/jobs/stripe-webhook';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('stripe-signature');
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook non configurato', { status: 400 });
  }
  // Raw body obbligatorio per la verifica firma: niente parse JSON.
  const body = await req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Firma non valida: ${(e as Error).message}`, { status: 400 });
  }
  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error('[stripe-webhook] handler error', (e as Error).message);
    return new Response('Errore handler', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
```

- [ ] **Step 6: Verificare typecheck**

Run:
```
pnpm --filter piattaforma typecheck
```
Expected: nessun errore.

- [ ] **Step 7: Commit**

```
git add apps/piattaforma/src/lib/jobs/stripe-webhook.ts apps/piattaforma/src/lib/jobs/stripe-webhook.test.ts apps/piattaforma/src/app/api/webhooks/stripe/route.ts
git commit -m "feat(payment): webhook Stripe (settlement SEPA + stato mandato)"
```

---

### Task 11: Aggancio mandato in registrazione (AGENZIA, post-commit)

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts` (import in testa + blocco post-commit dopo `notifyReferralSignup`, ~riga 530-535)

- [ ] **Step 1: Aggiungere l'import**

In testa al file, tra gli import di `@/lib/...`:
```ts
import { applySepaMandateToAgency } from '@/lib/providers/payment/stripe-mandate';
```

- [ ] **Step 2: Aggiungere il blocco post-commit**

Subito dopo il blocco esistente:
```ts
    if (createdCompanyId) {
      void tryMatchCrmContact(createdCompanyId);
      // AF-N: ...
      void notifyReferralSignup(createdCompanyId);
    }
```
inserire:
```ts
    // Mandato SEPA via Stripe — SOLO agenzie e SOLO con provider stripe.
    // Best-effort post-commit (come promo/CRM): un fallimento NON annulla la
    // registrazione; lascia sepaMandateStatus=FAILED, riparabile lato admin.
    if (
      createdCompanyId &&
      company.type === 'AGENZIA' &&
      env.PAYMENT_PROVIDER === 'stripe'
    ) {
      try {
        await applySepaMandateToAgency({
          companyId,
          iban: payment.iban,
          name: company.ragioneSociale,
          email: company.email,
          ip: signupIpRaw,
          userAgent: hdrs.get('user-agent'),
        });
      } catch (e) {
        console.warn('[registrazione] setup mandato SEPA errore', (e as Error).message);
      }
    }
```

> `signupIpRaw`, `hdrs`, `company`, `payment`, `companyId`, `createdCompanyId`, `env` sono già in scope nella `registerAction` (definiti più sopra). Con `PAYMENT_PROVIDER=mock` il blocco è saltato: comportamento attuale invariato.

- [ ] **Step 3: Verificare typecheck + suite auth**

Run:
```
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma exec vitest run "src/app/(auth)/actions.test.ts"
```
Expected: nessun errore TS; i test esistenti restano verdi (in test `PAYMENT_PROVIDER` non è `stripe`, il blocco è skippato).

- [ ] **Step 4: Commit**

```
git add "apps/piattaforma/src/app/(auth)/actions.ts"
git commit -m "feat(registrazione): setup mandato SEPA agenzia post-commit (provider stripe)"
```

---

### Task 12: UI wizard — testo mandato role-aware

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (invocazione `PaymentStep` ~riga 278; firma + corpo `PaymentStep` ~riga 720-820)

- [ ] **Step 1: Passare il tipo company a `PaymentStep`**

Nell'invocazione (step === 4), aggiungere la prop:
```tsx
            <PaymentStep
              defaultValues={data.payment}
              companyType={data.company?.type}
              onBack={() => setStep(3)}
              onSubmit={handlePayment}
              isSubmitting={isPending}
            />
```

- [ ] **Step 2: Aggiungere la prop alla firma di `PaymentStep`**

Aggiornare destructuring e tipo:
```tsx
function PaymentStep({
  defaultValues,
  companyType,
  onBack,
  onSubmit,
  isSubmitting,
}: {
  defaultValues?: PaymentData;
  companyType?: 'DEALER' | 'AGENZIA';
  onBack: () => void;
  onSubmit: (data: PaymentData, promoCode: string) => void;
  isSubmitting: boolean;
}) {
  const isAgenzia = companyType === 'AGENZIA';
```

- [ ] **Step 3: Sostituire l'Alert "Fase 5" con nota role-aware**

Sostituire il blocco:
```tsx
      <Alert variant="info">
        Il mandato SEPA reale verrà attivato in Fase 5 tramite Stripe. Per ora salviamo solo
        l&apos;accettazione.
      </Alert>
```
con:
```tsx
      <Alert variant="info">
        {isAgenzia
          ? 'Inserendo l’IBAN e accettando il mandato autorizzi gli addebiti SEPA per gli importi delle pratiche.'
          : 'L’IBAN sarà usato per accreditare i compensi maturati sulla piattaforma.'}
      </Alert>
```

- [ ] **Step 4: Rendere role-aware il testo del mandato**

Sostituire il contenuto dello `<span>` nella label del checkbox `sepaMandateAccepted`:
```tsx
        <span>
          Autorizzo Passaggio Veloce a effettuare accrediti automatici sul conto indicato per
          l’erogazione dei compensi maturati sulla piattaforma.
          <span className="ml-1 text-pv-orange-500" aria-hidden="true">
            •
          </span>
        </span>
```
con:
```tsx
        <span>
          {isAgenzia
            ? 'Autorizzo Passaggio Veloce S.r.l. ad addebitare il mio conto tramite addebito diretto SEPA (SEPA Direct Debit) per gli importi delle pratiche completate, secondo le condizioni del servizio. Il mandato è revocabile secondo lo standard SDD.'
            : 'Autorizzo Passaggio Veloce a effettuare accrediti automatici sul conto indicato per l’erogazione dei compensi maturati sulla piattaforma.'}
          <span className="ml-1 text-pv-orange-500" aria-hidden="true">
            •
          </span>
        </span>
```

- [ ] **Step 5: Verificare typecheck + lint**

Run:
```
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma lint
```
Expected: nessun errore.

- [ ] **Step 6: Commit**

```
git add "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx"
git commit -m "feat(registrazione): testo mandato SEPA role-aware (addebito agenzia / accredito dealer)"
```

---

### Task 13: Validazione E2E manuale (TEST mode)

> Da eseguire quando l'account Stripe e le chiavi di test sono disponibili. Non TDD: è la validazione del flusso completo richiesta dall'obiettivo.

**Files:**
- Modify (locale, non committato): `.env.local` di `apps/piattaforma`

- [ ] **Step 1: Configurare le chiavi di test**

In `apps/piattaforma/.env.local`:
```
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # dal passo 2
```

- [ ] **Step 2: Avviare l'inoltro webhook**

In un terminale dedicato:
```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Copiare lo `whsec_...` stampato in `STRIPE_WEBHOOK_SECRET` e riavviare il dev server (`pnpm --filter piattaforma dev`).

- [ ] **Step 3: Registrare un'agenzia**

Aprire `/register/agenzia`, completare il wizard con un IBAN (in test mode usare un IBAN di test SEPA, es. `DE89370400440532013000`). Verificare:
- Su Stripe Dashboard (test) → Customers: nuovo customer con PaymentMethod SEPA + mandato.
- Su DB: `Company.sepaMandateStatus = ACTIVE`, `stripeCustomerId` / `stripePaymentMethodId` valorizzati.

- [ ] **Step 4: Completare una pratica e verificare l'addebito**

Creare una pratica (dealer) → assegnazione → firma agenzia. Verificare `FeeAddebito` `SCHEDULED` + wallet broker accreditato. Eseguire il job addebito (chiamando la route cron o tramite il countdown DEMO +5min):
```
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/process-fee-scheduled
```
Verificare: PaymentIntent SEPA `processing` su Stripe → il terminale `stripe listen` riceve `payment_intent.succeeded` → `FeeAddebito.stato = SUCCESS`.

- [ ] **Step 5: Verificare il payout (Strada B no-op)**

Portare il wallet broker sopra soglia, eseguire i job payout:
```
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/trigger-auto-payout
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/process-payouts
```
Verificare: `Payout.stato = ESEGUITO`, wallet decrementato, `providerRef = manual-bonifico:<id>` (nessun movimento reale).

- [ ] **Step 6: Eseguire l'intera suite di test**

Run:
```
pnpm --filter piattaforma exec vitest run
pnpm --filter piattaforma typecheck
```
Expected: tutto verde.

---

## Self-Review (eseguita su questo piano)

**1. Copertura spec:**
- §4 schema → Task 2 ✅
- §5.1 client → Task 4 ✅; §5.2 mandato → Task 5 ✅; §5.3 provider → Task 6 ✅; §5.4 PaymentResult.pending → Task 3 ✅; §5.5 getPayment → Task 7 ✅; §5.6 webhook → Task 10 ✅
- §6 env → Task 8 ✅
- §7 aggancio registrazione → Task 11 ✅
- §8 UI wizard → Task 12 ✅
- §9 flusso pratica (pending in process-fee-scheduled) → Task 9 ✅
- §10 idempotenza (idempotency key charge/customer, handler idempotente) → Task 5/6/10 ✅
- §11 testing → test in ogni task + Task 13 e2e ✅
- §12 change list → coperta dai file dei task ✅

**2. Placeholder scan:** nessun TBD/TODO operativo nel codice (il solo `// TODO: N8` è pre-esistente nel job, fuori scope, mantenuto identico). ✅

**3. Type consistency:** `SepaMandateStatus` (PENDING/ACTIVE/FAILED), `PaymentResult.pending`, `SetupSepaMandateInput`/`Result`, `FeeOutcome`, `applySepaMandateToAgency` → nomi e firme coerenti tra Task 2/3/5/6/9/10/11. ✅

---

## Note di rischio (dalla spec §14)
- Webhook mancante in dev → fee restano `IN_LAVORAZIONE`: serve `stripe listen` durante i test (Task 13).
- `executePayout` no-op segna `ESEGUITO` senza bonifico: solo TEST mode, denaro finto, `providerRef='manual-bonifico:'` evidente; sostituzione al go-live (checklist spec §13).
- Mandati TEST non validi in produzione: al go-live ri-raccolta (checklist spec §13).
