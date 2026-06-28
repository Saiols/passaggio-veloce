# Blocco agenzia su addebito fee fallito + rimedio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Se l'addebito SEPA della fee all'agenzia fallisce, bloccare l'agenzia (soft, login permesso), avvisarla via email, e darle la possibilità da loggata di cambiare IBAN o ritentare; allo `SUCCESS` dell'addebito si sblocca.

**Architecture:** Nuovo stato `Company.bloccoPagamentoAt` (separato da `suspendedAt`, non impedisce il login). Due handler centralizzati (`bloccaAgenziaPerAddebito`, `rivalutaBloccoAgenzia`) agganciati ai punti di transizione del fee (job, webhook, retry). Il retry ri-processa il fee scoperto (reset a SCHEDULED + contatore `tentativi` + idempotency per-tentativo). Enforcement via guardie nelle azioni operative + esclusione dalla distribuzione + gate verso `/blocco-pagamento`.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/Postgres, Stripe SEPA (off_session), Vitest.

## Global Constraints

- **Blocco soft**: `Company.bloccoPagamentoAt` (DateTime?) — NON tocca `User.status`/`suspendedAt`, il login resta possibile. Distinto dalla sospensione admin.
- **Trigger blocco**: su `FeeAddebito` → `FAILED` **o** `RETRY` (qualsiasi mancato incasso).
- **Sblocco**: solo quando l'agenzia non ha più alcun `FeeAddebito` in `{FAILED, RETRY, IN_LAVORAZIONE}` (scoperto o in volo) — tipicamente al `SUCCESS` (sincrono con mock, via webhook con SEPA reale).
- **Idempotenza**: `bloccaAgenziaPerAddebito` non sovrascrive `bloccoPagamentoAt` se già settato; l'email N9 parte **solo alla prima transizione** null→bloccata.
- **Email N9** transazionale (NON in `OPTIONAL_TIPI`), da `noreply`. Copy esatta: «Non ha funzionato l'addebito automatico, il tuo account è stato momentaneamente sospeso. Aggiorna l'IBAN inserito nella piattaforma.» + CTA a `/blocco-pagamento`.
- **Retry**: reset del fee scoperto a `SCHEDULED`, `tentativi += 1`, `scheduledAt=now`; charge sincrono via `processFeeAddebito`; idempotency key `charge-fee:{id}:{tentativo}`.
- **Tabelle**: Company → `companies`; FeeAddebito → `fee_addebiti`; enum `NotificaTipo`.
- **Niente login-block**: NON riusare `suspendCompanyAction`.
- Branch: `main`. Migration da applicare a prod con `prisma migrate deploy`.

**Comandi:**
- Test file: `pnpm --filter piattaforma exec vitest run <path>`
- Typecheck: `pnpm --filter piattaforma run typecheck`
- Suite: `pnpm --filter piattaforma test`
- Prisma generate: `pnpm --filter @pv/db exec prisma generate`

---

## File Structure

- **Modify** `packages/db/prisma/schema.prisma` + **Create** migration — campi blocco + `tentativi` + enum N9.
- **Modify** `apps/piattaforma/src/lib/providers/payment/{types,stripe,mock}.ts` — `tentativo` + idempotency per-tentativo.
- **Modify** `apps/piattaforma/src/lib/notifiche/{templates,send}.ts` — email N9.
- **Create** `apps/piattaforma/src/lib/fee/blocco.ts` (+ test) — handler blocca/rivaluta/isBloccata.
- **Create** `apps/piattaforma/src/lib/fee/process.ts` (+ test) — `processFeeAddebito` (estratto dal job); **Modify** `process-fee-scheduled.ts` per riusarlo; **Modify** `stripe-webhook.ts` per gli hook.
- **Modify** enforcement: `lib/distribuzione/tick.ts`, `app/inbox/actions.ts`, `app/pratiche/actions.ts`, + gate pagine agenzia (`app/dashboard`, `app/inbox`, `app/pratiche`).
- **Create** `apps/piattaforma/src/app/blocco-pagamento/{page.tsx,client.tsx,actions.ts}` — pagina di rimedio.

Sequenza dipendente: schema → payment → email → handler → job/webhook → enforcement → UI. **7 task.**

---

## Task 1: Schema + migration (blocco + tentativi + enum N9)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260628140000_blocco_agenzia_addebito/migration.sql`

**Interfaces:**
- Produces (campi Prisma): `Company.bloccoPagamentoAt: DateTime?`, `Company.bloccoPagamentoMotivo: String?`, `FeeAddebito.tentativi: Int @default(0)`, enum `NotificaTipo` += `N9_AGENZIA_ADDEBITO_FALLITO`.

- [ ] **Step 1: Aggiungere i campi a `Company`**

In `model Company` (dopo `suspensionLastNote`, riga ~352):

```prisma
  /// Blocco "soft" per addebito fee non riuscito: l'agenzia può ancora fare
  /// login ma è confinata a /blocco-pagamento finché l'addebito non riesce.
  /// Distinto da suspendedAt (sospensione admin che impedisce il login).
  bloccoPagamentoAt     DateTime?
  bloccoPagamentoMotivo String?
```

- [ ] **Step 2: Aggiungere `tentativi` a `FeeAddebito`**

In `model FeeAddebito` (dopo `providerRef String?`, riga ~1086):

```prisma
  /// Numero di tentativi di addebito (incrementato a ogni retry manuale).
  /// Entra nell'idempotency key Stripe per forzare un nuovo PaymentIntent.
  tentativi Int @default(0)
```

- [ ] **Step 3: Aggiungere il valore all'enum `NotificaTipo`**

In `enum NotificaTipo` (dopo `N8_AGENZIA_ADDEBITO`):

```prisma
  N9_AGENZIA_ADDEBITO_FALLITO
```

- [ ] **Step 4: Creare la migration**

Crea `packages/db/prisma/migrations/20260628140000_blocco_agenzia_addebito/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "companies" ADD COLUMN "bloccoPagamentoAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "bloccoPagamentoMotivo" TEXT;

-- AlterTable
ALTER TABLE "fee_addebiti" ADD COLUMN "tentativi" INTEGER NOT NULL DEFAULT 0;

-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N9_AGENZIA_ADDEBITO_FALLITO';
```

- [ ] **Step 5: Rigenerare il client Prisma + typecheck**

Run: `pnpm --filter @pv/db exec prisma generate`
Expected: client rigenerato senza errori.

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS (nessun consumer ancora; lo schema compila).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260628140000_blocco_agenzia_addebito/migration.sql
git commit -m "feat(db): blocco pagamento agenzia + FeeAddebito.tentativi + enum N9"
```

---

## Task 2: Idempotency addebito per-tentativo

**Files:**
- Modify: `apps/piattaforma/src/lib/providers/payment/types.ts`
- Modify: `apps/piattaforma/src/lib/providers/payment/stripe.ts`
- Modify: `apps/piattaforma/src/lib/providers/payment/mock.ts`
- Modify: `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts` (call site)
- Test: i test esistenti dei provider (`stripe.test.ts`, `mock.test.ts`, `index.test.ts`) che costruiscono `ChargeFeeInput`.

**Interfaces:**
- Produces: `ChargeFeeInput` guadagna `tentativo: number`.

- [ ] **Step 1: Estendere `ChargeFeeInput`**

In `types.ts`:

```typescript
export type ChargeFeeInput = {
  feeAddebitoId: string;
  importoCent: number;
  agenziaId: string;
  /** Numero tentativo (0-based): entra nell'idempotency key per forzare un nuovo PaymentIntent al retry. */
  tentativo: number;
};
```

- [ ] **Step 2: Usare il tentativo nell'idempotency key (stripe.ts)**

In `stripe.ts`, nella `chargeFee`, cambia l'idempotency key:

```typescript
        { idempotencyKey: `charge-fee:${input.feeAddebitoId}:${input.tentativo}` },
```

- [ ] **Step 3: Aggiornare il call site del job**

In `process-fee-scheduled.ts`, nella chiamata `payment.chargeFee` del loop, aggiungi `tentativo: fee.tentativi` (questo file verrà comunque rifattorizzato in Task 5; qui basta non rompere il typecheck):

```typescript
    const result = await payment.chargeFee({
      feeAddebitoId: fee.id,
      importoCent: fee.importoCent,
      agenziaId: fee.agenziaId,
      tentativo: fee.tentativi,
    });
```

- [ ] **Step 4: Aggiornare i test dei provider**

In ogni test che chiama `chargeFee({...})` senza `tentativo` (`mock.test.ts`, `stripe.test.ts`, `index.test.ts`), aggiungi `tentativo: 0` all'oggetto input. (Il mock ignora il campo; per stripe è irrilevante al di fuori della key.) Cerca le occorrenze con: `pnpm --filter piattaforma exec vitest run src/lib/providers/payment`.

- [ ] **Step 5: Eseguire i test dei provider + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/providers/payment`
Expected: PASS.

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/providers/payment apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts
git commit -m "feat(payment): tentativo nell'idempotency key di chargeFee (retry-safe)"
```

---

## Task 3: Email N9 (addebito fallito)

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts`
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts`
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts`

**Interfaces:**
- Produces: `type N9AgenziaAddebitoFallitoPayload = { nomeAgenzia: string; rimedioUrl: string }`; `tplN9AgenziaAddebitoFallito(p)`; tipo `'N9_AGENZIA_ADDEBITO_FALLITO'` in `SendInput`/`render`.

- [ ] **Step 1: Scrivere il test del template (RED)**

Aggiungi a `templates.test.ts`:

```typescript
import { tplN9AgenziaAddebitoFallito } from './templates';

describe('N9 addebito fallito agenzia', () => {
  it('contiene il messaggio di sospensione, l\'invito a aggiornare l\'IBAN e il CTA', () => {
    const { subject, text, html } = tplN9AgenziaAddebitoFallito({
      nomeAgenzia: 'Agenzia Rossi',
      rimedioUrl: 'https://passaggioveloce.it/blocco-pagamento',
    });
    expect(subject.length).toBeGreaterThan(0);
    const hay = `${subject}\n${text}\n${html}`.toLowerCase();
    expect(hay).toContain('addebito');
    expect(hay).toContain('iban');
    expect(hay).toContain('sospeso');
    expect(html).toContain('https://passaggioveloce.it/blocco-pagamento');
  });
});
```

- [ ] **Step 2: Eseguire il test (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/templates.test.ts`
Expected: FAIL — `tplN9AgenziaAddebitoFallito` non esportato.

- [ ] **Step 3: Implementare il template**

In `templates.ts`, aggiungi (vicino agli altri payload/template; `ctaButton` è importabile da `./layout`):

```typescript
export type N9AgenziaAddebitoFallitoPayload = {
  nomeAgenzia: string;
  rimedioUrl: string;
};

export function tplN9AgenziaAddebitoFallito(p: N9AgenziaAddebitoFallitoPayload): NotificaContent {
  const subject = 'Addebito automatico non riuscito — account momentaneamente sospeso';
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `non ha funzionato l'addebito automatico, il tuo account è stato momentaneamente sospeso. ` +
    `Aggiorna l'IBAN inserito nella piattaforma (o richiedi un nuovo tentativo se hai già sistemato con la banca).\n` +
    `Vai a: ${p.rimedioUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Addebito automatico non riuscito</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      non ha funzionato l&apos;addebito automatico e il tuo account è stato
      <strong>momentaneamente sospeso</strong>. Aggiorna l&apos;IBAN inserito nella
      piattaforma, oppure richiedi un nuovo tentativo se hai già sistemato con la banca.
    </p>
    ${ctaButton(p.rimedioUrl, 'Aggiorna IBAN / Riprova')}
  `);
  return { subject, html, text };
}
```

> `ctaButton` è esportato da `./layout`; verifica che sia già importato in `templates.ts` (lo usa N31). Se non lo fosse: `import { emailLayout, ctaButton } from './layout';`.

- [ ] **Step 4: Registrare il tipo in `send.ts`**

In `send.ts`: import (`tplN9AgenziaAddebitoFallito`, `type N9AgenziaAddebitoFallitoPayload`); membro union dopo `N8_AGENZIA_ADDEBITO`:

```typescript
  | { tipo: 'N9_AGENZIA_ADDEBITO_FALLITO'; target: Target; payload: N9AgenziaAddebitoFallitoPayload }
```

e il case in `render`:

```typescript
    case 'N9_AGENZIA_ADDEBITO_FALLITO':
      return tplN9AgenziaAddebitoFallito(input.payload);
```

- [ ] **Step 5: Test (GREEN) + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/templates.test.ts`
Expected: PASS.

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/templates.test.ts apps/piattaforma/src/lib/notifiche/send.ts
git commit -m "feat(notifiche): email N9 addebito fallito agenzia"
```

---

## Task 4: Handler blocco/sblocco (`lib/fee/blocco.ts`)

**Files:**
- Create: `apps/piattaforma/src/lib/fee/blocco.ts`
- Test: `apps/piattaforma/src/lib/fee/blocco.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@pv/db`), `sendNotification` (`@/lib/notifiche`), `env` (`@/env`).
- Produces:
  - `bloccaAgenziaPerAddebito(feeId: string, motivo: string): Promise<void>`
  - `rivalutaBloccoAgenzia(agenziaId: string): Promise<void>`
  - `isAgenziaBloccata(agenziaId: string): Promise<boolean>`

- [ ] **Step 1: Scrivere i test (RED)**

Crea `apps/piattaforma/src/lib/fee/blocco.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindUnique, companyFindUnique, companyUpdate, feeCount, sendMock } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  companyFindUnique: vi.fn(),
  companyUpdate: vi.fn(),
  feeCount: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { findUnique: feeFindUnique, count: feeCount },
    company: { findUnique: companyFindUnique, update: companyUpdate },
  },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));

import { bloccaAgenziaPerAddebito, rivalutaBloccoAgenzia, isAgenziaBloccata } from './blocco';

beforeEach(() => {
  vi.clearAllMocks();
  companyUpdate.mockResolvedValue({});
  sendMock.mockResolvedValue(undefined);
});

describe('bloccaAgenziaPerAddebito', () => {
  it('prima transizione: setta bloccoPagamentoAt + invia N9', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: null });
    await bloccaAgenziaPerAddebito('f1', 'SEPA rifiutato');
    expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a1' },
      data: expect.objectContaining({ bloccoPagamentoMotivo: 'SEPA rifiutato' }),
    }));
    expect(companyUpdate.mock.calls[0][0].data.bloccoPagamentoAt).toBeInstanceOf(Date);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].tipo).toBe('N9_AGENZIA_ADDEBITO_FALLITO');
  });

  it('già bloccata: aggiorna solo il motivo, niente email', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: new Date() });
    await bloccaAgenziaPerAddebito('f1', 'altro errore');
    expect(companyUpdate.mock.calls[0][0].data.bloccoPagamentoAt).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non propaga errori (best-effort)', async () => {
    feeFindUnique.mockRejectedValue(new Error('db down'));
    await expect(bloccaAgenziaPerAddebito('f1', 'x')).resolves.toBeUndefined();
  });
});

describe('rivalutaBloccoAgenzia', () => {
  it('sblocca se non ci sono fee scoperti/in volo', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: new Date() });
    feeCount.mockResolvedValue(0);
    await rivalutaBloccoAgenzia('a1');
    expect(companyUpdate).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { bloccoPagamentoAt: null, bloccoPagamentoMotivo: null } });
  });

  it('NON sblocca se restano fee scoperti', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: new Date() });
    feeCount.mockResolvedValue(2);
    await rivalutaBloccoAgenzia('a1');
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('no-op se non bloccata', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: null });
    await rivalutaBloccoAgenzia('a1');
    expect(feeCount).not.toHaveBeenCalled();
    expect(companyUpdate).not.toHaveBeenCalled();
  });
});

describe('isAgenziaBloccata', () => {
  it('true se bloccoPagamentoAt valorizzato', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: new Date() });
    expect(await isAgenziaBloccata('a1')).toBe(true);
  });
  it('false se null/assente', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: null });
    expect(await isAgenziaBloccata('a1')).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire i test (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/fee/blocco.test.ts`
Expected: FAIL — modulo `./blocco` inesistente.

- [ ] **Step 3: Implementare gli handler**

Crea `apps/piattaforma/src/lib/fee/blocco.ts`:

```typescript
import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
import { env } from '@/env';

/** Stati di un FeeAddebito che tengono l'agenzia bloccata (scoperto o in volo). */
const STATI_SCOPERTI = ['FAILED', 'RETRY', 'IN_LAVORAZIONE'] as const;

/**
 * Blocca l'agenzia per un addebito non riuscito. Best-effort, idempotente:
 * setta bloccoPagamentoAt solo alla prima transizione (e allora invia N9);
 * se già bloccata aggiorna solo il motivo. Non propaga errori.
 */
export async function bloccaAgenziaPerAddebito(feeId: string, motivo: string): Promise<void> {
  try {
    const fee = await prisma.feeAddebito.findUnique({
      where: { id: feeId },
      select: { agenziaId: true },
    });
    if (!fee) return;
    const agenzia = await prisma.company.findUnique({
      where: { id: fee.agenziaId },
      select: { id: true, ragioneSociale: true, email: true, bloccoPagamentoAt: true },
    });
    if (!agenzia) return;
    const giaBloccata = !!agenzia.bloccoPagamentoAt;
    await prisma.company.update({
      where: { id: agenzia.id },
      data: {
        ...(giaBloccata ? {} : { bloccoPagamentoAt: new Date() }),
        bloccoPagamentoMotivo: motivo.slice(0, 1000),
      },
    });
    if (!giaBloccata) {
      await sendNotification({
        tipo: 'N9_AGENZIA_ADDEBITO_FALLITO',
        target: { email: agenzia.email, companyId: agenzia.id },
        payload: {
          nomeAgenzia: agenzia.ragioneSociale,
          rimedioUrl: `${env.NEXT_PUBLIC_APP_URL}/blocco-pagamento`,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort: un errore qui non deve rompere il flusso di addebito
  }
}

/**
 * Sblocca l'agenzia se non ha più alcun addebito scoperto o in volo
 * (FAILED/RETRY/IN_LAVORAZIONE). Best-effort, idempotente.
 */
export async function rivalutaBloccoAgenzia(agenziaId: string): Promise<void> {
  try {
    const agenzia = await prisma.company.findUnique({
      where: { id: agenziaId },
      select: { bloccoPagamentoAt: true },
    });
    if (!agenzia?.bloccoPagamentoAt) return;
    const scoperti = await prisma.feeAddebito.count({
      where: { agenziaId, stato: { in: STATI_SCOPERTI as unknown as string[] } },
    });
    if (scoperti === 0) {
      await prisma.company.update({
        where: { id: agenziaId },
        data: { bloccoPagamentoAt: null, bloccoPagamentoMotivo: null },
      });
    }
  } catch {
    // best-effort
  }
}

/** True se l'agenzia è bloccata per addebito non riuscito. */
export async function isAgenziaBloccata(agenziaId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({
    where: { id: agenziaId },
    select: { bloccoPagamentoAt: true },
  });
  return !!c?.bloccoPagamentoAt;
}
```

> Nota typing: `stato: { in: STATI_SCOPERTI ... }` — se il client Prisma tipizza `FeeAddebitoStato`, sostituisci il cast con `stato: { in: ['FAILED', 'RETRY', 'IN_LAVORAZIONE'] }` (Prisma accetta i literal dell'enum). Il test mocka `count`, quindi il valore non incide sul test.

- [ ] **Step 4: Test (GREEN) + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/fee/blocco.test.ts`
Expected: PASS.

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fee/blocco.ts apps/piattaforma/src/lib/fee/blocco.test.ts
git commit -m "feat(fee): handler blocca/rivaluta blocco pagamento agenzia"
```

---

## Task 5: `processFeeAddebito` + hook nel job e nel webhook

**Files:**
- Create: `apps/piattaforma/src/lib/fee/process.ts`
- Test: `apps/piattaforma/src/lib/fee/process.test.ts`
- Modify: `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts` (usa `processFeeAddebito`)
- Modify: `apps/piattaforma/src/lib/jobs/stripe-webhook.ts` (hook blocca/rivaluta)

**Interfaces:**
- Consumes: `prisma`, `getPayment`, `feeOutcomeFromResult` (`@/lib/jobs/fee-outcome`), `bloccaAgenziaPerAddebito`/`rivalutaBloccoAgenzia` (`@/lib/fee/blocco`).
- Produces: `processFeeAddebito(feeId: string): Promise<'SUCCESS' | 'PENDING' | 'RETRY' | 'FAILED' | 'SKIPPED'>`.

- [ ] **Step 1: Scrivere i test (RED)**

Crea `apps/piattaforma/src/lib/fee/process.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindUnique, feeUpdate, chargeFee, blocca, rivaluta } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  feeUpdate: vi.fn(),
  chargeFee: vi.fn(),
  blocca: vi.fn(),
  rivaluta: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: { feeAddebito: { findUnique: feeFindUnique, update: feeUpdate } } }));
vi.mock('@/lib/providers/payment', () => ({ getPayment: () => ({ chargeFee }) }));
vi.mock('./blocco', () => ({ bloccaAgenziaPerAddebito: blocca, rivalutaBloccoAgenzia: rivaluta }));

import { processFeeAddebito } from './process';

const FEE = { id: 'f1', importoCent: 5000, agenziaId: 'a1', tentativi: 0, stato: 'SCHEDULED' };

beforeEach(() => {
  vi.clearAllMocks();
  feeUpdate.mockResolvedValue({});
  blocca.mockResolvedValue(undefined);
  rivaluta.mockResolvedValue(undefined);
  feeFindUnique.mockResolvedValue(FEE);
});

it('SUCCESS: marca SUCCESS e rivaluta lo sblocco', async () => {
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1' });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SUCCESS');
  expect(rivaluta).toHaveBeenCalledWith('a1');
  expect(blocca).not.toHaveBeenCalled();
});

it('PENDING: resta IN_LAVORAZIONE, niente blocca/rivaluta', async () => {
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1', pending: true });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('PENDING');
  expect(blocca).not.toHaveBeenCalled();
  expect(rivaluta).not.toHaveBeenCalled();
});

it('FAILED: marca FAILED e blocca', async () => {
  chargeFee.mockResolvedValue({ ok: false, error: 'rifiutato', retryable: false });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('FAILED');
  expect(blocca).toHaveBeenCalledWith('f1', 'rifiutato');
});

it('RETRY: marca RETRY e blocca', async () => {
  chargeFee.mockResolvedValue({ ok: false, error: 'transiente', retryable: true });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('RETRY');
  expect(blocca).toHaveBeenCalledWith('f1', 'transiente');
});

it('passa il tentativo del fee a chargeFee', async () => {
  feeFindUnique.mockResolvedValue({ ...FEE, tentativi: 3 });
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1' });
  await processFeeAddebito('f1');
  expect(chargeFee).toHaveBeenCalledWith(expect.objectContaining({ feeAddebitoId: 'f1', tentativo: 3 }));
});

it('SKIPPED: fee già SUCCESS', async () => {
  feeFindUnique.mockResolvedValue({ ...FEE, stato: 'SUCCESS' });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SKIPPED');
  expect(chargeFee).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Eseguire i test (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/fee/process.test.ts`
Expected: FAIL — `./process` inesistente.

- [ ] **Step 3: Implementare `processFeeAddebito`**

Crea `apps/piattaforma/src/lib/fee/process.ts`:

```typescript
import 'server-only';
import { prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';
import { feeOutcomeFromResult } from '@/lib/jobs/fee-outcome';
import { bloccaAgenziaPerAddebito, rivalutaBloccoAgenzia } from './blocco';

export type ProcessFeeStatus = 'SUCCESS' | 'PENDING' | 'RETRY' | 'FAILED' | 'SKIPPED';

/**
 * Processa un singolo FeeAddebito: IN_LAVORAZIONE → chargeFee → aggiorna stato
 * e aggancia il blocco/sblocco agenzia. Usato dal job batch e dal retry manuale.
 * Su FAILED/RETRY blocca l'agenzia; su SUCCESS rivaluta lo sblocco.
 */
export async function processFeeAddebito(feeId: string): Promise<ProcessFeeStatus> {
  const fee = await prisma.feeAddebito.findUnique({ where: { id: feeId } });
  if (!fee || fee.stato === 'SUCCESS' || fee.stato === 'ANNULLATO') return 'SKIPPED';

  await prisma.feeAddebito.update({ where: { id: feeId }, data: { stato: 'IN_LAVORAZIONE' } });

  const result = await getPayment().chargeFee({
    feeAddebitoId: fee.id,
    importoCent: fee.importoCent,
    agenziaId: fee.agenziaId,
    tentativo: fee.tentativi,
  });
  const outcome = feeOutcomeFromResult(result);

  if (outcome.status === 'SUCCESS') {
    await prisma.feeAddebito.update({
      where: { id: feeId },
      data: { stato: 'SUCCESS', providerRef: outcome.providerRef, executedAt: new Date(), errorMessage: null },
    });
    await rivalutaBloccoAgenzia(fee.agenziaId);
  } else if (outcome.status === 'PENDING') {
    await prisma.feeAddebito.update({ where: { id: feeId }, data: { providerRef: outcome.providerRef } });
    // resta IN_LAVORAZIONE: l'agenzia (se bloccata) resta bloccata fino al webhook
  } else {
    await prisma.feeAddebito.update({
      where: { id: feeId },
      data: { stato: outcome.status, errorMessage: outcome.error, executedAt: new Date() },
    });
    await bloccaAgenziaPerAddebito(feeId, outcome.error);
  }
  return outcome.status;
}
```

- [ ] **Step 4: Rifattorizzare il job per usare `processFeeAddebito`**

In `process-fee-scheduled.ts`, sostituisci il corpo del `for` loop (le righe che fanno update IN_LAVORAZIONE + chargeFee + outcome) con:

```typescript
  for (const fee of fees) {
    const status = await processFeeAddebito(fee.id);
    if (status === 'SUCCESS') succeeded++;
    else if (status === 'RETRY' || status === 'FAILED') failed++;
  }
```

e aggiungi in cima l'import: `import { processFeeAddebito } from '@/lib/fee/process';`. Rimuovi gli import ora inutilizzati (`getPayment`, `feeOutcomeFromResult`) se non più referenziati altrove nel file (il typecheck/eslint segnalerà gli unused).

- [ ] **Step 5: Hook nel webhook Stripe**

In `stripe-webhook.ts`, import in cima: `import { bloccaAgenziaPerAddebito, rivalutaBloccoAgenzia } from '@/lib/fee/blocco';`

Nel case `payment_intent.succeeded`, dopo l'`updateMany`, se il fee esiste recupera l'agenzia e rivaluta:

```typescript
        if (r?.count && r.count > 0) {
          const fee = await prisma.feeAddebito.findUnique({ where: { id: feeId }, select: { agenziaId: true } });
          if (fee) await rivalutaBloccoAgenzia(fee.agenziaId);
        } else {
```

(adatta il blocco `if (r?.count === 0)` esistente di conseguenza: il warning resta nel ramo `else`).

Nel case `payment_intent.payment_failed`, dopo l'`updateMany`, blocca:

```typescript
        await bloccaAgenziaPerAddebito(feeId, pi.last_payment_error?.message ?? 'SEPA payment failed');
```

- [ ] **Step 6: Test (GREEN) + typecheck + suite**

Run: `pnpm --filter piattaforma exec vitest run src/lib/fee/process.test.ts`
Expected: PASS.

Run: `pnpm --filter piattaforma run typecheck` → PASS.
Run: `pnpm --filter piattaforma test` → PASS (il job esistente non ha test di regressione che si rompono; in caso, allinea i mock).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/fee/process.ts apps/piattaforma/src/lib/fee/process.test.ts apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts apps/piattaforma/src/lib/jobs/stripe-webhook.ts
git commit -m "feat(fee): processFeeAddebito + hook blocco su job e webhook"
```

---

## Task 6: Enforcement (distribuzione + guardie azioni + gate pagine)

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts`
- Modify: `apps/piattaforma/src/app/inbox/actions.ts` (`acceptPratica`)
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts` (`markPraticaProcessataAction`, `markFirmaAvvenutaAction`)
- Create: `apps/piattaforma/src/lib/fee/gate.ts` (helper redirect per pagine)
- Modify: pagine agenzia `app/dashboard/page.tsx`, `app/inbox/page.tsx`, `app/pratiche/page.tsx` (chiamano il gate)

**Interfaces:**
- Consumes: `isAgenziaBloccata` (Task 4).
- Produces: `redirectSeAgenziaBloccata(): Promise<void>` (`@/lib/fee/gate`).

- [ ] **Step 1: Escludere le agenzie bloccate dalla distribuzione**

In `tick.ts`, nella `tx.sede.findMany` dei candidati (clausola `company:`), aggiungi `bloccoPagamentoAt: null`:

```typescript
        company: { deletedAt: null, suspendedAt: null, bloccoPagamentoAt: null },
```

- [ ] **Step 2: Guardia in `acceptPratica`**

In `inbox/actions.ts`, import: `import { isAgenziaBloccata } from '@/lib/fee/blocco';`
Dopo `const agenziaId = session.user.companyId; if (!agenziaId) ...`, aggiungi:

```typescript
  if (await isAgenziaBloccata(agenziaId)) {
    return { ok: false, error: 'Account sospeso per addebito non riuscito: aggiorna l\'IBAN in /blocco-pagamento' };
  }
```

- [ ] **Step 3: Guardia in `markPraticaProcessataAction` e `markFirmaAvvenutaAction`**

In `pratiche/actions.ts`, import: `import { isAgenziaBloccata } from '@/lib/fee/blocco';`
In entrambe le funzioni, dopo `const agenziaId = session.user.companyId!;`, aggiungi:

```typescript
  if (await isAgenziaBloccata(agenziaId)) redirect('/blocco-pagamento');
```

- [ ] **Step 4: Helper gate per le pagine**

Crea `apps/piattaforma/src/lib/fee/gate.ts`:

```typescript
import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isAgenziaBloccata } from './blocco';

/**
 * Da chiamare in cima alle pagine operative dell'agenzia: se l'agenzia è
 * bloccata per addebito non riuscito, redirige alla pagina di rimedio.
 * No-op per ruoli non-agenzia o agenzie attive.
 */
export async function redirectSeAgenziaBloccata(): Promise<void> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.companyType !== 'AGENZIA' || !u.companyId) return;
  if (await isAgenziaBloccata(u.companyId)) redirect('/blocco-pagamento');
}
```

- [ ] **Step 5: Chiamare il gate nelle pagine agenzia**

In cima al componente server di `app/dashboard/page.tsx`, `app/inbox/page.tsx`, `app/pratiche/page.tsx` (subito dopo il recupero sessione/auth, prima di renderizzare), aggiungi:

```typescript
  await redirectSeAgenziaBloccata();
```

e l'import `import { redirectSeAgenziaBloccata } from '@/lib/fee/gate';`. (Se una pagina è condivisa broker/agenzia, il gate è no-op per i broker.)

- [ ] **Step 6: Typecheck + suite**

Run: `pnpm --filter piattaforma run typecheck` → PASS.
Run: `pnpm --filter piattaforma test` → PASS.

> Nota: queste guardie non hanno unit test dedicati (server action/page con auth — fuori dal pattern di test DOM del repo). La correttezza è coperta da typecheck + verifica manuale (Task 7 Step finale). La logica testabile (`isAgenziaBloccata`) è già coperta in Task 4.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/tick.ts apps/piattaforma/src/app/inbox/actions.ts apps/piattaforma/src/app/pratiche/actions.ts apps/piattaforma/src/lib/fee/gate.ts apps/piattaforma/src/app/dashboard/page.tsx apps/piattaforma/src/app/inbox/page.tsx apps/piattaforma/src/app/pratiche/page.tsx
git commit -m "feat(fee): enforcement blocco agenzia (distribuzione + guardie azioni + gate pagine)"
```

---

## Task 7: Pagina di rimedio `/blocco-pagamento` + azioni

**Files:**
- Create: `apps/piattaforma/src/app/blocco-pagamento/page.tsx`
- Create: `apps/piattaforma/src/app/blocco-pagamento/client.tsx`
- Create: `apps/piattaforma/src/app/blocco-pagamento/actions.ts`

**Interfaces:**
- Consumes: `processFeeAddebito` (Task 5), `applySepaMandateToAgency` (`@/lib/providers/payment/stripe-mandate`), `prisma`, `auth`.

- [ ] **Step 1: Server action di retry / aggiorna-IBAN**

Crea `apps/piattaforma/src/app/blocco-pagamento/actions.ts`:

```typescript
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { processFeeAddebito } from '@/lib/fee/process';
import { applySepaMandateToAgency } from '@/lib/providers/payment/stripe-mandate';

export type RimedioResult = { ok: true } | { ok: false; error: string };

async function getAgenziaIdLoggata(): Promise<string | null> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.companyType !== 'AGENZIA' || !u.companyId) return null;
  return u.companyId;
}

/** Ri-processa tutti gli addebiti scoperti (FAILED/RETRY) dell'agenzia. */
async function ritentaAddebitiScoperti(agenziaId: string): Promise<void> {
  const scoperti = await prisma.feeAddebito.findMany({
    where: { agenziaId, stato: { in: ['FAILED', 'RETRY'] } },
    select: { id: true },
  });
  for (const f of scoperti) {
    await prisma.feeAddebito.update({
      where: { id: f.id },
      data: { stato: 'SCHEDULED', scheduledAt: new Date(), tentativi: { increment: 1 }, errorMessage: null },
    });
    await processFeeAddebito(f.id);
  }
}

/** Riprova l'addebito col mandato esistente (l'agenzia ha sistemato con la banca). */
export async function ritentaAddebitoAction(): Promise<RimedioResult> {
  const agenziaId = await getAgenziaIdLoggata();
  if (!agenziaId) return { ok: false, error: 'Non autorizzato' };
  await ritentaAddebitiScoperti(agenziaId);
  revalidatePath('/blocco-pagamento');
  return { ok: true };
}

const ibanSchema = z.object({
  iban: z.string().trim().min(15).max(34).transform((s) => s.toUpperCase()),
});

/** Aggiorna l'IBAN, ri-crea il mandato SEPA, poi riprova l'addebito. */
export async function aggiornaIbanERitentaAction(formData: FormData): Promise<RimedioResult> {
  const agenziaId = await getAgenziaIdLoggata();
  if (!agenziaId) return { ok: false, error: 'Non autorizzato' };

  const parsed = ibanSchema.safeParse({ iban: formData.get('iban') });
  if (!parsed.success) return { ok: false, error: 'IBAN non valido' };
  const iban = parsed.data.iban;

  const agenzia = await prisma.company.findUnique({
    where: { id: agenziaId },
    select: { ragioneSociale: true, email: true },
  });
  if (!agenzia) return { ok: false, error: 'Azienda non trovata' };

  await prisma.company.update({ where: { id: agenziaId }, data: { iban } });

  const hdrs = await headers();
  const status = await applySepaMandateToAgency({
    companyId: agenziaId,
    iban,
    name: agenzia.ragioneSociale,
    email: agenzia.email,
    ip: hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip'),
    userAgent: hdrs.get('user-agent'),
  });

  if (status === 'FAILED') {
    revalidatePath('/blocco-pagamento');
    return { ok: false, error: 'Configurazione del mandato SEPA non riuscita con il nuovo IBAN. Verifica l\'IBAN e riprova.' };
  }
  if (status === 'PENDING') {
    // Mandato non ancora ACTIVE: l'addebito richiede mandato attivo. Si potrà
    // ritentare appena il mandato è confermato (webhook setup_intent.succeeded).
    revalidatePath('/blocco-pagamento');
    return { ok: true };
  }
  // ACTIVE → riprova subito
  await ritentaAddebitiScoperti(agenziaId);
  revalidatePath('/blocco-pagamento');
  return { ok: true };
}
```

- [ ] **Step 2: Pagina server (stato + render)**

Crea `apps/piattaforma/src/app/blocco-pagamento/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { BloccoPagamentoClient } from './client';

export default async function BloccoPagamentoPage() {
  const session = await auth();
  const u = session?.user;
  if (!u) redirect('/login');
  if (u.companyType !== 'AGENZIA' || !u.companyId) redirect('/dashboard');

  const agenzia = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: { bloccoPagamentoAt: true, bloccoPagamentoMotivo: true, iban: true },
  });
  // Non bloccata → torna all'operatività.
  if (!agenzia?.bloccoPagamentoAt) redirect('/dashboard');

  const [scoperti, inVolo] = await Promise.all([
    prisma.feeAddebito.count({ where: { agenziaId: u.companyId, stato: { in: ['FAILED', 'RETRY'] } } }),
    prisma.feeAddebito.count({ where: { agenziaId: u.companyId, stato: 'IN_LAVORAZIONE' } }),
  ]);

  // "in elaborazione" = nessun fee ritentabile ma uno o più in volo (retry processing)
  const inElaborazione = scoperti === 0 && inVolo > 0;

  return (
    <BloccoPagamentoClient
      ibanAttuale={agenzia.iban ?? ''}
      motivo={agenzia.bloccoPagamentoMotivo ?? null}
      inElaborazione={inElaborazione}
    />
  );
}
```

- [ ] **Step 3: Client (UI + azioni)**

Crea `apps/piattaforma/src/app/blocco-pagamento/client.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ritentaAddebitoAction, aggiornaIbanERitentaAction } from './actions';

export function BloccoPagamentoClient({
  ibanAttuale,
  motivo,
  inElaborazione,
}: {
  ibanAttuale: string;
  motivo: string | null;
  inElaborazione: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onRetry = () => {
    setError(null);
    start(async () => {
      const r = await ritentaAddebitoAction();
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  };

  const onAggiornaIban = (formData: FormData) => {
    setError(null);
    start(async () => {
      const r = await aggiornaIbanERitentaAction(formData);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-[22px] font-bold text-pv-navy-900">Account momentaneamente sospeso</h1>
      <Alert variant="error" className="mt-4">
        Non ha funzionato l&apos;addebito automatico, il tuo account è stato momentaneamente
        sospeso. Aggiorna l&apos;IBAN inserito nella piattaforma, oppure richiedi un nuovo
        tentativo se hai già sistemato con la banca.
      </Alert>
      {motivo && <p className="mt-2 text-[12.5px] text-pv-slate-500">Dettaglio: {motivo}</p>}

      {inElaborazione ? (
        <Alert variant="info" className="mt-6">
          Addebito in elaborazione: attendi la conferma. La pagina si aggiornerà quando
          l&apos;esito è disponibile.
        </Alert>
      ) : (
        <>
          <form action={onAggiornaIban} className="mt-6 space-y-3">
            <label className="block text-[13px] font-semibold text-pv-navy-900">Aggiorna IBAN</label>
            <Input name="iban" defaultValue={ibanAttuale} placeholder="IT60..." maxLength={34} disabled={pending} />
            <Button type="submit" loading={pending} loadingLabel="Aggiornamento…">
              Aggiorna IBAN e riprova
            </Button>
          </form>

          <div className="mt-6 border-t border-pv-slate-200 pt-6">
            <p className="text-[13px] text-pv-slate-600">
              Hai già sistemato con la banca senza cambiare IBAN?
            </p>
            <Button variant="secondary" onClick={onRetry} loading={pending} loadingLabel="Riprovo…" className="mt-2">
              Riprova l&apos;addebito
            </Button>
          </div>
        </>
      )}

      {error && <Alert variant="error" className="mt-4">{error}</Alert>}
    </div>
  );
}
```

> Verifica i percorsi/props reali dei componenti UI (`Alert`, `Button`, `Input`) — usa le stesse import e prop (`variant`, `loading`, `loadingLabel`) già usate altrove (es. `company-edit-form.tsx`, `DocumentsStep`). Se `Alert` non accetta `className`, avvolgi in un `div`.

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm --filter piattaforma run typecheck` → PASS.
Run: `pnpm --filter piattaforma test` → PASS.

- [ ] **Step 5: Verifica manuale (deferibile a preview/prod)**

Con uno **stub provider che fallisce** (o forzando un `FeeAddebito` FAILED in dev), verifica il ciclo: addebito fallito → `bloccoPagamentoAt` settato + email N9 in console → login agenzia → redirect a `/blocco-pagamento` → "Riprova" o "Aggiorna IBAN" → con mock l'addebito va a SUCCESS → sblocco → `/dashboard`. Verifica anche che un'agenzia bloccata NON riceva nuove pratiche (distribuzione) e che `acceptPratica`/firma siano rifiutate.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/blocco-pagamento
git commit -m "feat(blocco-pagamento): pagina di rimedio agenzia (aggiorna IBAN / riprova addebito)"
```

---

## Self-Review (eseguita in fase di scrittura)

**Spec coverage:**
- Stato blocco soft separato (`bloccoPagamentoAt`) → Task 1 + Task 4. ✓
- Trigger su FAILED/RETRY (job + webhook) → Task 5. ✓
- Email N9 con copy esatta + CTA → Task 3 + Task 4 (invio). ✓
- Enforcement (distribuzione + guardie + gate) → Task 6. ✓
- Pagina di rimedio: aggiorna IBAN (+re-setup mandato) / riprova → Task 7. ✓
- Sblocco solo a SUCCESS senza fee scoperti/in volo → Task 4 (`rivalutaBloccoAgenzia`) + Task 5 (chiamata su SUCCESS, job/webhook). ✓
- Idempotency per-tentativo → Task 2 + Task 5/7 (reset + increment). ✓
- "In elaborazione" + no doppio addebito → Task 7 (page calcola `inElaborazione`, nasconde le azioni). ✓
- Mandato PENDING dopo cambio IBAN → Task 7 (ritorna ok senza charge, attende webhook). ✓
- Stub provider per i test → Task 5 (mock `getPayment`). ✓

**Placeholder scan:** nessun TBD; ogni step ha codice o comando. Le note "verifica i prop reali dei componenti UI" (Task 7) sono istruzioni di integrazione, non placeholder logici.

**Type consistency:** `bloccaAgenziaPerAddebito(feeId, motivo)`, `rivalutaBloccoAgenzia(agenziaId)`, `isAgenziaBloccata(agenziaId)`, `processFeeAddebito(feeId)→ProcessFeeStatus`, `ChargeFeeInput.tentativo`, tipo `'N9_AGENZIA_ADDEBITO_FALLITO'` + payload `{nomeAgenzia, rimedioUrl}` usati coerentemente tra i task. ✓

**Rischi noti da validare in implementazione:**
- `session.user.companyType`/`companyId` devono esistere sul tipo sessione (usati già nelle azioni esistenti → ok).
- Prop reali dei componenti UI in Task 7 (allineare a quelli esistenti).
- Eventuali test di regressione del job `process-fee-scheduled` da allineare in Task 5.
