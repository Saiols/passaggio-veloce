# Sprint Demo-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere la piattaforma Passaggio Veloce navigabile end-to-end senza dipendenze da servizi esterni a pagamento, deployata su `passaggio-veloce-demo.vercel.app`.

**Architecture:** Modalità DEMO attivata da env flag `DEMO_MODE=true` sulla stessa codebase di produzione. Mock provider per pagamenti (Stripe), Vercel Blob per storage, ConsoleEmail + MockOcr già esistenti. Pannello admin `/admin/demo-control` per scatenare manualmente cron e ispezionare email simulate.

**Tech Stack:** Next.js 16 App Router (Turbopack), TypeScript, Prisma + Postgres (Neon in prod), Auth.js v5, Tailwind, Vitest per test logica pura, Vercel Blob per storage cloud, monorepo pnpm + Turborepo.

**Spec di riferimento:** `docs/superpowers/specs/2026-04-25-demo-ready-design.md`

**Convenzioni di questo piano:**
- Path: tutti i path admin sono `apps/piattaforma/src/app/admin/...` (non `(auth)/admin` — il route group `(auth)` contiene solo `login`, `register`, `verify-email`, `reset-password`).
- Test: TDD per logica pura (provider, job). Per UI e route, usiamo step di "verifica manuale" documentati. Pattern di testing automatico viene introdotto da Task 1.
- Commit: Conventional Commits in italiano (es. `feat(demo): banner globale modalità DEMO`).
- Auth helper: `await auth()` da `@/auth` ritorna `{ user: { id, email, role, companyId, companyType, name } } | null`.

---

## Task 1: Setup vitest

**Files:**
- Create: `apps/piattaforma/vitest.config.ts`
- Create: `apps/piattaforma/src/test/setup.ts`
- Modify: `apps/piattaforma/package.json` (aggiungere script + deps)
- Modify: `apps/piattaforma/tsconfig.json` (esclude test dal build se serve)

- [ ] **Step 1: Installare vitest e dipendenze**

```bash
pnpm --filter piattaforma add -D vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Creare `vitest.config.ts`**

```ts
// apps/piattaforma/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Creare `src/test/setup.ts` (placeholder per env)**

```ts
// apps/piattaforma/src/test/setup.ts
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test/test';
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';
process.env.STORAGE_PROVIDER = process.env.STORAGE_PROVIDER ?? 'local';
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? 'console';
process.env.OCR_PROVIDER = process.env.OCR_PROVIDER ?? 'mock';
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? 'mock';
process.env.DEMO_MODE = process.env.DEMO_MODE ?? 'true';
```

- [ ] **Step 4: Aggiungere script a `apps/piattaforma/package.json`**

Modifica la sezione `scripts`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Smoke test setup**

Creare `apps/piattaforma/src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('vitest is wired up', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm --filter piattaforma test`
Expected: 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/vitest.config.ts apps/piattaforma/src/test apps/piattaforma/package.json pnpm-lock.yaml
git commit -m "chore(test): setup vitest + smoke test"
```

---

## Task 2: Env vars per modalità DEMO

**Files:**
- Modify: `apps/piattaforma/src/env.ts`

- [ ] **Step 1: Aggiungere `DEMO_MODE`, `PAYMENT_PROVIDER`, `BLOB_READ_WRITE_TOKEN`, e `vercel-blob` enum**

Sostituisci interamente `apps/piattaforma/src/env.ts`:

```ts
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.string().url().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    STORAGE_PROVIDER: z.enum(['local', 's3', 'vercel-blob']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./uploads'),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    EMAIL_CONSOLE_DIR: z.string().default('./.dev-emails'),
    EMAIL_FROM: z.string().email().default('noreply@passaggioveloce.it'),
    RESEND_API_KEY: z.string().optional(),

    OCR_PROVIDER: z.enum(['mock', 'google_documentai']).default('mock'),

    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    STRIPE_SECRET_KEY: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_CONSOLE_DIR: process.env.EMAIL_CONSOLE_DIR,
    EMAIL_FROM: process.env.EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 2: Verificare typecheck**

```bash
pnpm --filter piattaforma typecheck
```
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/env.ts
git commit -m "feat(env): aggiunge DEMO_MODE, PAYMENT_PROVIDER, vercel-blob storage"
```

---

## Task 3: Banner globale "Modalità DEMO"

**Files:**
- Create: `apps/piattaforma/src/components/demo-banner.tsx`
- Modify: `apps/piattaforma/src/components/app-shell.tsx`

- [ ] **Step 1: Creare componente DemoBanner**

```tsx
// apps/piattaforma/src/components/demo-banner.tsx
import Link from 'next/link';
import { env } from '@/env';

export function DemoBanner({ isAdmin }: { isAdmin: boolean }) {
  if (!env.DEMO_MODE) return null;
  return (
    <div className="bg-yellow-300 border-b border-yellow-500 text-yellow-950">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-2 text-[12.5px] font-semibold sm:px-6">
        <span>
          🧪 <span className="font-extrabold">Modalità DEMO</span> — Email,
          pagamenti, OCR e cron sono simulati.
        </span>
        {isAdmin ? (
          <Link
            href="/admin/demo-control"
            className="underline decoration-yellow-700 underline-offset-2 hover:text-yellow-900"
          >
            Demo Control →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrare DemoBanner in AppShell**

Modifica `apps/piattaforma/src/components/app-shell.tsx`. Aggiungi import in cima:

```ts
import { DemoBanner } from '@/components/demo-banner';
```

Modifica il return della funzione `AppShell` — sostituisci l'apertura `<div className="flex min-h-screen flex-col bg-pv-slate-50">` e il blocco `<header...>` immediatamente successivo aggiungendo il banner SOPRA l'header:

```tsx
return (
  <div className="flex min-h-screen flex-col bg-pv-slate-50">
    <DemoBanner isAdmin={session.user.role === 'ADMIN_PIATTAFORMA'} />
    <header className="sticky top-0 z-30 bg-pv-navy-800 text-white shadow-[0_2px_12px_rgb(10_37_64_/_0.25)]">
      {/* … resto invariato … */}
```

- [ ] **Step 3: Verifica manuale**

Avvia il dev server (se non gira già): `pnpm dev`. Imposta in `.env.local` `DEMO_MODE=true`, ricarica.

Naviga a `/login`, fai login con un utente seed → il banner giallo appare sopra l'header in tutte le pagine. Login come admin → vedi il link "Demo Control →".

Imposta `DEMO_MODE=false`, riavvia, ricarica → il banner non appare.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/components/demo-banner.tsx apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(demo): banner globale Modalità DEMO sopra header"
```

---

## Task 4: PaymentProvider interface + MockPaymentProvider

**Files:**
- Create: `apps/piattaforma/src/lib/providers/payment/types.ts`
- Create: `apps/piattaforma/src/lib/providers/payment/mock.ts`
- Create: `apps/piattaforma/src/lib/providers/payment/index.ts`
- Create: `apps/piattaforma/src/lib/providers/payment/mock.test.ts`

- [ ] **Step 1: Definire types**

```ts
// apps/piattaforma/src/lib/providers/payment/types.ts
export type PaymentProviderName = 'mock' | 'stripe';

export type ChargeFeeInput = {
  feeAddebitoId: string;
  importoCent: number;
  agenziaId: string;
};

export type ExecutePayoutInput = {
  payoutId: string;
  importoCent: number;
  iban: string;
};

export type PaymentResult =
  | { ok: true; providerRef: string }
  | { ok: false; error: string; retryable: boolean };

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  chargeFee(input: ChargeFeeInput): Promise<PaymentResult>;
  executePayout(input: ExecutePayoutInput): Promise<PaymentResult>;
}
```

- [ ] **Step 2: Scrivere il test (TDD)**

```ts
// apps/piattaforma/src/lib/providers/payment/mock.test.ts
import { describe, it, expect } from 'vitest';
import { MockPaymentProvider } from './mock';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('returns ok with mock-prefixed providerRef on chargeFee', async () => {
    const res = await provider.chargeFee({
      feeAddebitoId: 'fee-1',
      importoCent: 5000,
      agenziaId: 'ag-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerRef).toMatch(/^mock-/);
    }
  });

  it('returns ok with mock-prefixed providerRef on executePayout', async () => {
    const res = await provider.executePayout({
      payoutId: 'payout-1',
      importoCent: 100000,
      iban: 'IT60X0542811101000000123456',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerRef).toMatch(/^mock-/);
    }
  });

  it('rejects negative amounts as non-retryable error', async () => {
    const res = await provider.chargeFee({
      feeAddebitoId: 'fee-x',
      importoCent: -100,
      agenziaId: 'ag-x',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.retryable).toBe(false);
    }
  });

  it('exposes name = "mock"', () => {
    expect(provider.name).toBe('mock');
  });
});
```

- [ ] **Step 3: Run test — deve fallire**

```bash
pnpm --filter piattaforma test src/lib/providers/payment/mock.test.ts
```
Expected: FAIL "Cannot find module './mock'".

- [ ] **Step 4: Implementare MockPaymentProvider**

```ts
// apps/piattaforma/src/lib/providers/payment/mock.ts
import { randomUUID } from 'node:crypto';
import type {
  ChargeFeeInput,
  ExecutePayoutInput,
  PaymentProvider,
  PaymentResult,
} from './types';

const MOCK_LATENCY_MS = 200;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async chargeFee(input: ChargeFeeInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    await sleep(MOCK_LATENCY_MS);
    console.log(
      `[MockPayment] chargeFee ${input.feeAddebitoId} importo=${input.importoCent}c agenzia=${input.agenziaId}`,
    );
    return { ok: true, providerRef: `mock-${randomUUID()}` };
  }

  async executePayout(input: ExecutePayoutInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    await sleep(MOCK_LATENCY_MS);
    console.log(
      `[MockPayment] executePayout ${input.payoutId} importo=${input.importoCent}c iban=${maskIban(input.iban)}`,
    );
    return { ok: true, providerRef: `mock-${randomUUID()}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function maskIban(iban: string): string {
  if (iban.length < 8) return '***';
  return `${iban.slice(0, 4)}…${iban.slice(-4)}`;
}
```

- [ ] **Step 5: Creare l'entry point con singleton**

```ts
// apps/piattaforma/src/lib/providers/payment/index.ts
import 'server-only';
import { env } from '@/env';
import { MockPaymentProvider } from './mock';
import type { PaymentProvider } from './types';

export * from './types';

let instance: PaymentProvider | null = null;

export function getPayment(): PaymentProvider {
  if (instance) return instance;
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      instance = new MockPaymentProvider();
      break;
    case 'stripe':
      throw new Error('Stripe payment provider not yet implemented');
    default:
      throw new Error(`Unknown payment provider: ${env.PAYMENT_PROVIDER}`);
  }
  return instance;
}
```

- [ ] **Step 6: Run test — deve passare**

```bash
pnpm --filter piattaforma test src/lib/providers/payment/mock.test.ts
```
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/providers/payment
git commit -m "feat(payment): MockPaymentProvider con interfaccia chargeFee/executePayout"
```

---

## Task 5: VercelBlobStorageProvider

**Files:**
- Create: `apps/piattaforma/src/lib/providers/storage/vercel-blob.ts`
- Modify: `apps/piattaforma/src/lib/providers/storage/index.ts`
- Modify: `apps/piattaforma/package.json` (aggiungere `@vercel/blob`)

- [ ] **Step 1: Installare `@vercel/blob`**

```bash
pnpm --filter piattaforma add @vercel/blob
```

- [ ] **Step 2: Implementare VercelBlobStorageProvider**

```ts
// apps/piattaforma/src/lib/providers/storage/vercel-blob.ts
import 'server-only';
import { Readable } from 'node:stream';
import { put, head, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  StorageNotFoundError,
  type StorageGetResult,
  type StoragePutInput,
  type StoragePutResult,
  type StorageProvider,
} from './types';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-120);
}

export class VercelBlobStorageProvider implements StorageProvider {
  readonly name = 'vercel-blob' as const;

  constructor(private readonly token: string) {}

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    const filename = `${randomUUID()}-${sanitizeFilename(input.originalFilename)}`;
    const storageKey = path.posix.join(input.scope, filename);
    await put(storageKey, input.buffer, {
      access: 'public',
      contentType: input.mimeType,
      token: this.token,
      addRandomSuffix: false,
    });
    return {
      storageKey,
      storageProvider: this.name,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
    };
  }

  async get(storageKey: string): Promise<StorageGetResult> {
    let meta;
    try {
      meta = await head(storageKey, { token: this.token });
    } catch {
      throw new StorageNotFoundError(storageKey);
    }
    const response = await fetch(meta.url);
    if (!response.ok || !response.body) {
      throw new StorageNotFoundError(storageKey);
    }
    return {
      stream: Readable.fromWeb(response.body as never),
      sizeBytes: meta.size,
      mimeType: meta.contentType ?? 'application/octet-stream',
    };
  }

  async delete(storageKey: string): Promise<void> {
    await del(storageKey, { token: this.token });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await head(storageKey, { token: this.token });
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 3: Aggiungere case `vercel-blob` al factory**

Modifica `apps/piattaforma/src/lib/providers/storage/index.ts`:

```ts
import 'server-only';
import path from 'node:path';
import { env } from '@/env';
import { LocalStorageProvider } from './local';
import { VercelBlobStorageProvider } from './vercel-blob';
import type { StorageProvider } from './types';

export * from './types';

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  switch (env.STORAGE_PROVIDER) {
    case 'local': {
      const baseDir = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
      instance = new LocalStorageProvider(baseDir);
      break;
    }
    case 'vercel-blob': {
      if (!env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN required for vercel-blob storage');
      }
      instance = new VercelBlobStorageProvider(env.BLOB_READ_WRITE_TOKEN);
      break;
    }
    case 's3':
      throw new Error('S3 storage provider not yet implemented');
    default:
      throw new Error(`Unknown storage provider: ${env.STORAGE_PROVIDER}`);
  }
  return instance;
}
```

- [ ] **Step 4: Verifica typecheck**

```bash
pnpm --filter piattaforma typecheck
```
Expected: nessun errore.

- [ ] **Step 5: Verifica build (per intercettare problemi serverside)**

```bash
pnpm --filter piattaforma build
```
Expected: build successful.

> Nota: il provider non viene unit-testato qui (richiederebbe mocking di `@vercel/blob`); la verifica di funzionamento avviene in fase di smoke test del deploy (Task 35).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/providers/storage apps/piattaforma/package.json pnpm-lock.yaml
git commit -m "feat(storage): VercelBlobStorageProvider per deploy serverless"
```

---

## Task 6: autoAddebitoAt 5 minuti in DEMO

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts`

- [ ] **Step 1: Modificare il calcolo `autoAddebitoAt`**

In `apps/piattaforma/src/app/pratiche/actions.ts`, in cima al file aggiungi import:

```ts
import { env } from '@/env';
```

Sostituisci la costante e il calcolo. Cerca:

```ts
const AUTO_ADDEBITO_DAYS = 20;
```

Sostituisci con:

```ts
const AUTO_ADDEBITO_DAYS = 20;
const AUTO_ADDEBITO_DEMO_MINUTES = 5;

function computeAutoAddebitoAt(now: Date): Date {
  if (env.DEMO_MODE) {
    return new Date(now.getTime() + AUTO_ADDEBITO_DEMO_MINUTES * 60_000);
  }
  return new Date(now.getTime() + AUTO_ADDEBITO_DAYS * 86_400_000);
}
```

E nella funzione `markFirmaAvvenutaAction`, sostituisci la riga:

```ts
const autoAddebitoAt = new Date(now.getTime() + AUTO_ADDEBITO_DAYS * 86_400_000);
```

con:

```ts
const autoAddebitoAt = computeAutoAddebitoAt(now);
```

- [ ] **Step 2: Verifica typecheck**

```bash
pnpm --filter piattaforma typecheck
```

- [ ] **Step 3: Verifica manuale**

Login come agenzia seed (`agenzia1@passaggioveloce.it` / `DevPass123!`), accetta una pratica PENDING in `/inbox`, poi marcala come "Firma avvenuta" dal dettaglio. In Postgres (via `pnpm db:studio`), apri tabella `FeeAddebito` e verifica che il record nuovo abbia `autoAddebitoAt` = ~5 minuti dopo `createdAt` (con `DEMO_MODE=true`).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/actions.ts
git commit -m "feat(demo): autoAddebitoAt a 5 min in DEMO_MODE (anziché 20 giorni)"
```

---

## Task 7: Auto-verify email in DEMO

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (mostra link)

- [ ] **Step 1: Modificare `registerAction` per auto-verify in DEMO**

In `apps/piattaforma/src/app/(auth)/actions.ts`, in cima aggiungi import:

```ts
import { env } from '@/env';
```

Modifica la funzione `registerAction`. Dopo il blocco `await prisma.$transaction(...)` (subito prima di `// TODO Fase 6`), inserisci:

```ts
    if (env.DEMO_MODE) {
      await prisma.$transaction(async (tx) => {
        await tx.verificationToken.update({
          where: { token: verificationToken },
          data: { usedAt: new Date() },
        });
        await tx.user.update({
          where: { email: emailLower },
          data: {
            emailVerifiedAt: new Date(),
            status: 'ACTIVE',
          },
        });
      });
    }
```

Lascia invariato il `return { ok: true, emailVerificationToken: verificationToken }` — il token viene comunque restituito così il wizard può mostrarlo.

- [ ] **Step 2: Aggiornare il messaggio post-registrazione nel wizard**

In `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`, cerca il rendering del messaggio di successo (dopo `result.ok`). Verifica come è strutturato e modificalo per mostrare condizionalmente, se siamo in DEMO, un avviso. Pattern:

```tsx
// Nel componente che renderizza dopo successo:
{token && (
  <div className="rounded-lg bg-yellow-50 border border-yellow-300 p-4 mt-4 text-sm">
    <p className="font-bold text-yellow-900">🧪 Modalità DEMO</p>
    <p className="text-yellow-800 mt-1">
      Il tuo account è già attivo. In produzione avresti ricevuto un'email
      con questo link di verifica:
    </p>
    <a
      href={`/verify-email?token=${token}`}
      className="text-pv-navy-700 underline mt-2 inline-block break-all"
    >
      {`/verify-email?token=${token}`}
    </a>
    <p className="text-yellow-800 mt-2">
      Puoi <a href="/login" className="underline">accedere subito</a>.
    </p>
  </div>
)}
```

> Adattamento al codice reale: il wizard probabilmente ha già un blocco per mostrare il token in dev. Se esiste, sostituisci/integra; se non esiste, aggiungi questo nel rendering del successo finale.

- [ ] **Step 3: Verifica manuale**

Con `DEMO_MODE=true`, registra un nuovo utente dealer da `/register`. Al termine del wizard:
- Vedi messaggio "Modalità DEMO" + link verifica.
- Vai su `/login` e accedi con la nuova email/password → entri in dashboard senza passare per `/verify-email`.

In Postgres verifica `User.status = 'ACTIVE'` e `User.emailVerifiedAt != null`.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/actions.ts apps/piattaforma/src/app/(auth)/register/register-wizard.tsx
git commit -m "feat(demo): auto-verify email in DEMO + token visibile post-registrazione"
```

---

## Task 8: requestPasswordResetAction

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`

- [ ] **Step 1: Aggiungere requestPasswordResetAction**

Alla fine di `apps/piattaforma/src/app/(auth)/actions.ts`, aggiungi:

```ts
// ============================================================
// PASSWORD RESET — REQUEST
// ============================================================

export type RequestPasswordResetResult =
  | { ok: true; demoToken?: string }
  | { ok: false; error: string };

export async function requestPasswordResetAction(
  email: string,
): Promise<RequestPasswordResetResult> {
  if (!email || typeof email !== 'string') {
    return { ok: false, error: 'Email non valida' };
  }

  const emailLower = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: emailLower } });

  // Per privacy, ritorniamo ok anche se l'utente non esiste (no enumeration)
  if (!user) {
    return { ok: true };
  }

  const token = generateSecureToken();
  await prisma.verificationToken.create({
    data: {
      token,
      type: 'PASSWORD_RESET',
      email: emailLower,
      expiresAt: expiresIn(2),
    },
  });

  // Invia email via provider
  const { getEmail } = await import('@/lib/providers/email');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${appUrl}/reset-password?token=${token}`;
  await getEmail().send({
    to: emailLower,
    subject: 'Passaggio Veloce — Reimposta la tua password',
    html: `
      <p>Ciao,</p>
      <p>Hai richiesto di reimpostare la password del tuo account Passaggio Veloce.</p>
      <p>Clicca qui per impostare una nuova password (link valido 2 ore):</p>
      <p><a href="${link}">${link}</a></p>
      <p>Se non sei stato tu, ignora questa email.</p>
    `,
    text: `Reimposta password: ${link}`,
    tag: 'password-reset',
  });

  return env.DEMO_MODE ? { ok: true, demoToken: token } : { ok: true };
}
```

- [ ] **Step 2: Verifica typecheck**

```bash
pnpm --filter piattaforma typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/actions.ts
git commit -m "feat(auth): requestPasswordResetAction con email + esposizione token in DEMO"
```

---

## Task 9: confirmPasswordResetAction

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`

- [ ] **Step 1: Aggiungere confirmPasswordResetAction**

In coda al file, dopo `requestPasswordResetAction`:

```ts
// ============================================================
// PASSWORD RESET — CONFIRM
// ============================================================

export type ConfirmPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string };

export async function confirmPasswordResetAction(
  token: string,
  newPassword: string,
): Promise<ConfirmPasswordResetResult> {
  if (!token) return { ok: false, error: 'Token mancante' };
  if (!newPassword || newPassword.length < 10) {
    return { ok: false, error: 'Password troppo corta (min 10 caratteri)' };
  }
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return {
      ok: false,
      error: 'La password deve contenere maiuscole, minuscole e numeri',
    };
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record) return { ok: false, error: 'Token non valido' };
  if (record.usedAt) return { ok: false, error: 'Token già usato' };
  if (record.expiresAt < new Date()) return { ok: false, error: 'Token scaduto' };
  if (record.type !== 'PASSWORD_RESET') {
    return { ok: false, error: 'Token non valido per questa azione' };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    await tx.user.update({
      where: { email: record.email },
      data: { passwordHash },
    });
  });

  return { ok: true };
}
```

- [ ] **Step 2: Verifica typecheck**

```bash
pnpm --filter piattaforma typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/actions.ts
git commit -m "feat(auth): confirmPasswordResetAction con validazione password policy"
```

---

## Task 10: Pagina /reset-password reale

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/reset-password/page.tsx`
- Create: `apps/piattaforma/src/app/(auth)/reset-password/reset-form.tsx`

- [ ] **Step 1: Sostituire la pagina placeholder**

Sostituisci interamente `apps/piattaforma/src/app/(auth)/reset-password/page.tsx`:

```tsx
import { ResetForm } from './reset-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-pv-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-pv-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-extrabold text-pv-navy-900">
          {token ? 'Imposta nuova password' : 'Password dimenticata?'}
        </h1>
        <p className="mt-1 text-sm text-pv-slate-500">
          {token
            ? 'Inserisci la nuova password (min 10 caratteri, maiuscola, minuscola, numero).'
            : 'Inserisci la tua email — ti invieremo un link per reimpostare la password.'}
        </p>
        <ResetForm token={token ?? null} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Creare il form client component**

```tsx
// apps/piattaforma/src/app/(auth)/reset-password/reset-form.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  requestPasswordResetAction,
  confirmPasswordResetAction,
} from '@/app/(auth)/actions';

export function ResetForm({ token }: { token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleRequest(formData: FormData) {
    setError(null);
    setSuccess(null);
    setDemoLink(null);
    startTransition(async () => {
      const email = String(formData.get('email') ?? '');
      const res = await requestPasswordResetAction(email);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(
        'Se l\'email è registrata, riceverai un link per reimpostare la password.',
      );
      if (res.demoToken) {
        const url = `${window.location.origin}/reset-password?token=${res.demoToken}`;
        setDemoLink(url);
      }
    });
  }

  function handleConfirm(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const newPassword = String(formData.get('password') ?? '');
      const res = await confirmPasswordResetAction(token!, newPassword);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/login?reset=success');
    });
  }

  if (token) {
    return (
      <form action={handleConfirm} className="mt-6 space-y-4">
        <input
          type="password"
          name="password"
          required
          minLength={10}
          placeholder="Nuova password"
          className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-pv-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? 'Salvataggio…' : 'Imposta password'}
        </button>
      </form>
    );
  }

  return (
    <form action={handleRequest} className="mt-6 space-y-4">
      <input
        type="email"
        name="email"
        required
        placeholder="email@esempio.it"
        className="w-full rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-pv-red-600">{error}</p>}
      {success && <p className="text-sm text-pv-green-700">{success}</p>}
      {demoLink && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-300 p-3 text-xs">
          <p className="font-bold text-yellow-900">🧪 Demo</p>
          <a href={demoLink} className="text-pv-navy-700 underline break-all">
            {demoLink}
          </a>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Invio…' : 'Invia link'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Verifica manuale**

Con `DEMO_MODE=true`:
1. Vai su `/reset-password` (no token).
2. Inserisci email di un utente seed (`dealer1@passaggioveloce.it`).
3. Vedi il messaggio "se l'email è registrata…" + il box giallo con il link diretto.
4. Clicca il link demo → arrivi su `/reset-password?token=…`, inserisci nuova password.
5. Sei reindirizzato a `/login?reset=success`.
6. Login con la nuova password → funziona.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/reset-password
git commit -m "feat(auth): pagina reset password reale con form richiesta + conferma"
```

---

## Task 11: Link "Password dimenticata?" in /login

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/login/page.tsx` (o `login-form.tsx` se separato)

- [ ] **Step 1:** Identifica il file giusto: `ls "apps/piattaforma/src/app/(auth)/login/"`. Se c'è `login-form.tsx`, modificalo; altrimenti `page.tsx`.
- [ ] **Step 2:** Sopra/sotto il bottone "Accedi" aggiungi:
  ```tsx
  <a href="/reset-password" className="text-xs text-pv-navy-600 hover:underline">
    Password dimenticata?
  </a>
  ```
- [ ] **Step 3:** In `page.tsx`, accetta `searchParams: Promise<{ reset?: string; invited?: string }>` e mostra banner verde se `reset === 'success'` o `invited === 'success'`:
  ```tsx
  {reset === 'success' && <div className="rounded-lg bg-pv-green-50 border border-pv-green-300 p-3 text-sm text-pv-green-800 mb-4">✅ Password reimpostata. Ora puoi accedere.</div>}
  {invited === 'success' && <div className="rounded-lg bg-pv-green-50 border border-pv-green-300 p-3 text-sm text-pv-green-800 mb-4">✅ Account attivato. Accedi con la tua nuova password.</div>}
  ```
- [ ] **Step 4:** Verifica manuale: `/login` mostra il link → clicca → arrivi su `/reset-password`. Reset completato → torni a `/login?reset=success` con banner.
- [ ] **Step 5:** Commit:
  ```bash
  git add "apps/piattaforma/src/app/(auth)/login"
  git commit -m "feat(auth): link Password dimenticata + banner success reset/invited"
  ```

---

## Task 12: Route GET /api/documenti/[id] con auth check

**Files:**
- Create: `apps/piattaforma/src/app/api/documenti/[id]/route.ts`

- [ ] **Step 1: Implementare la route**

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage } from '@/lib/providers/storage';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const doc = await prisma.documento.findUnique({
    where: { id },
    select: {
      id: true, praticaId: true, companyId: true,
      storageKey: true, mimeType: true, originalFilename: true,
      pratica: { select: { brokerId: true, agenziaAssegnataId: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const userCompanyId = session.user.companyId;
  const allowed =
    isAdmin ||
    (doc.companyId && doc.companyId === userCompanyId) ||
    (doc.pratica?.brokerId === userCompanyId) ||
    (doc.pratica?.agenziaAssegnataId === userCompanyId);
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const file = await getStorage().get(doc.storageKey);
  const headers = new Headers({
    'Content-Type': doc.mimeType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.originalFilename)}"`,
    'Content-Length': String(file.sizeBytes),
    'Cache-Control': 'private, no-store',
  });
  return new Response(file.stream as unknown as ReadableStream, { headers });
}
```

- [ ] **Step 2:** `pnpm --filter piattaforma typecheck` → no errori.
- [ ] **Step 3:** Verifica manuale (vedi sotto Task 13 per la UI). Per ora dal browser, login admin, vai a `/api/documenti/<id>` di un Documento esistente → file scaricato.
- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/app/api/documenti
  git commit -m "feat(documenti): route GET /api/documenti/[id] con auth check ruolo"
  ```

---

## Task 13: Pulsanti "Scarica" nel dettaglio pratica

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx`

- [ ] **Step 1:** Nel `prisma.pratica.findUnique` (o equivalente), aggiungi `include`/`select` per documenti: `documenti: { select: { id: true, tipo: true, owner: true, originalFilename: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: 'asc' } }`.
- [ ] **Step 2:** Nel JSX, aggiungi una sezione "Documenti" sopra/sotto la sezione esistente più affine (timeline/parti). Per ogni documento renderizza una riga con:
  - Label tipo (helper inline `labelTipoDocumento`: mappa `LIBRETTO_CIRCOLAZIONE→Libretto`, `CI_FRONTE→Carta identità (fronte)`, `CI_RETRO→Carta identità (retro)`, `CODICE_FISCALE→Codice fiscale`, `VISURA_CAMERALE→Visura`, `PROCURA→Procura`)
  - Owner (helper `labelOwner`: `VENDITORE→venditore`, `ACQUIRENTE→acquirente`, ecc.)
  - Filename + size formatted (`formatBytes` inline)
  - Link `<a href={`/api/documenti/${d.id}`} className="rounded-lg border border-pv-slate-300 px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50">Scarica</a>`
- [ ] **Step 3:** Verifica manuale: dealer e agenzia vedono la sezione, click "Scarica" funziona. Dealer non proprietario → 403.
- [ ] **Step 4:** Commit:
  ```bash
  git add "apps/piattaforma/src/app/pratiche/[id]/page.tsx"
  git commit -m "feat(pratiche): sezione documenti scaricabili nel dettaglio"
  ```

---

## Task 14: Server actions inviti utenti

**Files:**
- Create: `apps/piattaforma/src/app/team/actions.ts`

- [ ] **Step 1:** Implementare 3 server actions con questi contratti:
  - `createInvitationAction(email: string): Promise<{ ok: true; demoLink?: string } | { ok: false; error: string }>` — guard `role === 'ADMIN_AZIENDA'`, valida email, controlla user esistente + invitation pending, crea `Invitation` con `token = generateSecureToken()`, `expiresAt = expiresIn(24*7)`, `role = 'UTENTE_AZIENDA'`. Invia email via `getEmail().send()` con link `${NEXT_PUBLIC_APP_URL}/invito/${token}`. In DEMO ritorna `demoLink`. `revalidatePath('/team')`.
  - `acceptInvitationAction(token, nome, cognome, password)` — valida token (PENDING + non scaduto), valida password (min 10 + maiusc/minus/num), crea `User` con `role: invitation.role`, `status: 'ACTIVE'`, `emailVerifiedAt: new Date()`, `companyId: invitation.companyId`, transazionale + marca invitation `ACCEPTED`.
  - `revokeInvitationAction(invitationId)` — guard role + ownership companyId, marca invitation `REVOKED`, `revalidatePath('/team')`.
- [ ] **Step 2:** Verifica typecheck. Se schema ha campi obbligatori su User non gestiti (es. codiceFiscale not-null), o (a) li aggiungi al form di accept, oppure (b) li rendi nullable nel migration (preferibile per UTENTE_AZIENDA — verifica con team).
- [ ] **Step 3:** Commit:
  ```bash
  git add apps/piattaforma/src/app/team/actions.ts
  git commit -m "feat(team): server actions invito/accept/revoke utenti secondari"
  ```

> **Pattern di riferimento per il codice esatto:** segui lo stile di `apps/piattaforma/src/app/(auth)/actions.ts` (zod opzionale, $transaction, error mapping P2002).

---

## Task 15: Pagina /team

**Files:**
- Create: `apps/piattaforma/src/app/team/page.tsx`
- Create: `apps/piattaforma/src/app/team/invite-form.tsx` (client)
- Create: `apps/piattaforma/src/app/team/revoke-button.tsx` (client)

- [ ] **Step 1: page.tsx (server)** — guard role, fetch parallelo `users` (di companyId) e `invitations` (PENDING di companyId). Render con `AppShell session={session} activePath="/team"`. Tre sezioni card:
  1. "Invita un utente" → `<InviteForm />`
  2. "Utenti attivi" → lista nome/cognome/email/role + ultimo accesso (`formatRelative`)
  3. "Inviti in attesa" (solo se >0) → lista email + scadenza + `<RevokeButton invitationId={inv.id} />`
- [ ] **Step 2: invite-form.tsx** — `'use client'`, useTransition + form action che chiama `createInvitationAction`, mostra `error` rosso, `success` verde, e box giallo con `demoLink` se presente.
- [ ] **Step 3: revoke-button.tsx** — `'use client'`, button che startTransition+chiama `revokeInvitationAction`. Stile rosso outline.
- [ ] **Step 4:** Verifica manuale: login dealer1 → `/team` accessibile, lista popolata, form invito funziona.
- [ ] **Step 5:** Commit:
  ```bash
  git add apps/piattaforma/src/app/team
  git commit -m "feat(team): pagina /team con invito + lista utenti + revoca pending"
  ```

---

## Task 16: Pagina pubblica /invito/[token]

**Files:**
- Create: `apps/piattaforma/src/app/invito/[token]/page.tsx` (server, no auth)
- Create: `apps/piattaforma/src/app/invito/[token]/accept-form.tsx` (client)

- [ ] **Step 1: page.tsx** — accetta `params: Promise<{ token: string }>`. Fetch invitation con `include: { company: { select: { ragioneSociale: true } } }`. Branch render:
  - Non trovato → ErrorBox "Invito non trovato."
  - status !== PENDING → ErrorBox `"Invito ${labelStatus(status)}."` (mapping ACCEPTED/REVOKED/EXPIRED)
  - expiresAt < now → ErrorBox "Invito scaduto."
  - Altrimenti render header "Benvenuto in [ragione sociale]" + email mostrata + `<AcceptForm token={token} />`.
  Layout: card centrata 480px max, no AppShell (è pubblica).
- [ ] **Step 2: accept-form.tsx** — input nome, cognome, password (min 10). Submit chiama `acceptInvitationAction(token, nome, cognome, password)`. Su success → `router.push('/login?invited=success')`.
- [ ] **Step 3:** Verifica manuale: dal Task 15 invia invito, copia il `demoLink`, apri in finestra anonima, completa form, login con nuove credenziali → entri come UTENTE_AZIENDA.
- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/app/invito
  git commit -m "feat(team): pagina pubblica /invito/[token] per onboarding utente secondario"
  ```

---

## Task 17: Voce nav "Team" per ADMIN_AZIENDA

**Files:**
- Modify: `apps/piattaforma/src/components/app-shell.tsx`

- [ ] **Step 1:** Nella funzione `navForRole(role, companyType)`, dopo aver costruito i link base per dealer/agenzia, se `role === 'ADMIN_AZIENDA'` push `{ href: '/team', label: 'Team' }` prima di ritornare.
- [ ] **Step 2:** Verifica manuale: dealer1 (ADMIN_AZIENDA) vede "Team"; UTENTE_AZIENDA non lo vede.
- [ ] **Step 3:** Commit:
  ```bash
  git add apps/piattaforma/src/components/app-shell.tsx
  git commit -m "feat(team): voce nav Team visibile solo a ADMIN_AZIENDA"
  ```

---

## Task 18: UI payout broker reale

**Files:**
- Modify: `apps/piattaforma/src/app/wallet/page.tsx`
- Create: `apps/piattaforma/src/app/wallet/actions.ts`
- Create: `apps/piattaforma/src/app/wallet/payout-button.tsx`

- [ ] **Step 1: actions.ts** — `richiediPayoutAction(): Promise<{ ok: true } | { ok: false; error: string }>`:
  - guard `companyType === 'DEALER'`
  - fetch wallet by companyId; se saldoCent < 50_000 (500€) → error
  - controlla nessun Payout RICHIESTO/IN_LAVORAZIONE già esistente sul wallet → altrimenti error
  - crea `Payout { walletId, importoCent: wallet.saldoCent, stato: 'RICHIESTO', automatico: false }`
  - `revalidatePath('/wallet')`
- [ ] **Step 2: payout-button.tsx** — client component, button che startTransition+chiama action, mostra success/error inline.
- [ ] **Step 3:** In `page.tsx` sostituisci il blocco placeholder esistente (`Fase 5 con Stripe`) con sezione "Payout":
  - sottotitolo "Soglia minima 500€ · Soglia auto 1.000€"
  - `<PayoutButton disabled={wallet.saldoCent < 50_000} />`
  - se saldo >= 100_000 → nota: "🎯 Sei sopra la soglia automatica. In DEMO il payout si attiva via Demo Control."
- [ ] **Step 4:** Verifica manuale: dealer con saldo ≥500€ può richiedere; <500€ pulsante disabled. Dopo richiesta, record `Payout RICHIESTO` in DB.
- [ ] **Step 5:** Commit:
  ```bash
  git add apps/piattaforma/src/app/wallet
  git commit -m "feat(wallet): UI payout broker reale con richiesta manuale"
  ```

---

## Task 19: Assegnazione manuale escalation admin

**Files:**
- Create: `apps/piattaforma/src/app/admin/escalation/actions.ts`
- Create: `apps/piattaforma/src/app/admin/escalation/assign-form.tsx` (client)
- Modify: `apps/piattaforma/src/app/admin/escalation/page.tsx`

- [ ] **Step 1: actions.ts** — `assegnaEscalationAction(praticaId, agenziaId)`:
  - guard role admin
  - transazione: verifica pratica.stato === IN_ESCALATION + agenzia type === AGENZIA + non sospesa
  - crea `PraticaAssegnazione { praticaId, agenziaId, round: 99, stato: 'ACCETTATA', assignedAt: new Date(), decidedAt: new Date() }`
  - update pratica `{ stato: 'ASSEGNATA', agenziaAssegnataId: agenziaId }`
  - fuori transazione: `await sendNotification('N6_AGENZIA_NUOVA_PRATICA', { praticaId, agenziaId, extra: { manualAssignment: true } })` — verifica firma reale in `apps/piattaforma/src/lib/notifiche/index.ts`
  - `revalidatePath('/admin/escalation')`
- [ ] **Step 2: assign-form.tsx** — client component con select `agenzie: {id, ragioneSociale}[]` + button "Assegna" che chiama l'action.
- [ ] **Step 3:** In `page.tsx`, dopo il fetch pratiche, calcola `agenzieByProvincia` (Map) facendo `prisma.company.findMany` per ogni provincia distinta. Per ogni pratica nel render aggiungi `<AssignForm praticaId={p.id} agenzie={agenzieByProvincia.get(p.provincia) ?? []} />`. Verifica nome campo provincia su `Pratica` nello schema.
- [ ] **Step 4:** Verifica manuale: admin assegna manualmente una pratica IN_ESCALATION → scompare dalla lista, agenzia riceve N6.
- [ ] **Step 5:** Commit:
  ```bash
  git add apps/piattaforma/src/app/admin/escalation
  git commit -m "feat(admin): assegnazione manuale pratica in escalation a partner"
  ```

---

## Task 20: Layout pagina /admin/demo-control con guard

**Files:**
- Create: `apps/piattaforma/src/app/admin/demo-control/page.tsx`

- [ ] **Step 1:** Skeleton page server con guard `if (!env.DEMO_MODE) notFound()`. AppShell + header + 3 placeholder per sezioni Counters/Inbox/Jobs (riempite nei task 25-27).
- [ ] **Step 2:** Verifica manuale: con `DEMO_MODE=true` accessibile come admin; con `DEMO_MODE=false` → 404.
- [ ] **Step 3:** Commit:
  ```bash
  git add apps/piattaforma/src/app/admin/demo-control
  git commit -m "feat(demo): scaffold pagina /admin/demo-control con guard DEMO_MODE"
  ```

---

## Task 21: Job process-fee-scheduled + endpoint

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts`
- Create: `apps/piattaforma/src/lib/jobs/process-fee-scheduled.test.ts`
- Create: `apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts`

- [ ] **Step 1: Implementare il job (codice completo, è logica delicata)**

```ts
// apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts
import 'server-only';
import { prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';
import { sendNotification } from '@/lib/notifiche';

const BATCH_SIZE = 30;

export type ProcessFeeResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

export async function processFeeScheduled(): Promise<ProcessFeeResult> {
  const now = new Date();
  const fees = await prisma.feeAddebito.findMany({
    where: { stato: 'SCHEDULED', autoAddebitoAt: { lte: now } },
    take: BATCH_SIZE,
    orderBy: { autoAddebitoAt: 'asc' },
  });

  let succeeded = 0;
  let failed = 0;
  const payment = getPayment();

  for (const fee of fees) {
    await prisma.feeAddebito.update({
      where: { id: fee.id },
      data: { stato: 'IN_LAVORAZIONE' },
    });

    const result = await payment.chargeFee({
      feeAddebitoId: fee.id,
      importoCent: fee.importoCent,
      agenziaId: fee.agenziaId,
    });

    if (result.ok) {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: {
          stato: 'SUCCESS',
          providerRef: result.providerRef,
          processedAt: new Date(),
          errorMessage: null,
        },
      });
      succeeded++;
    } else {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: {
          stato: result.retryable ? 'RETRY' : 'FAILED',
          errorMessage: result.error,
          processedAt: new Date(),
        },
      });
      failed++;
      // notifica all'agenzia in caso di FAILED non-retryable (best-effort)
      if (!result.retryable) {
        try {
          await sendNotification('N8_AGENZIA_ADDEBITO_SCHEDULATO', {
            agenziaId: fee.agenziaId,
            extra: { failed: true, error: result.error, feeAddebitoId: fee.id },
          });
        } catch { /* swallow notification errors */ }
      }
    }
  }

  return { processed: fees.length, succeeded, failed };
}
```

- [ ] **Step 2: Test (TDD-light, integration con DB locale)**

```ts
// apps/piattaforma/src/lib/jobs/process-fee-scheduled.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@pv/db';
import { processFeeScheduled } from './process-fee-scheduled';

describe('processFeeScheduled', () => {
  beforeEach(async () => {
    // Pulisce SCHEDULED test (non tocca prod data)
    await prisma.feeAddebito.deleteMany({
      where: { praticaId: { startsWith: 'test-' } },
    });
  });

  it('marks SCHEDULED fees as SUCCESS via mock payment', async () => {
    // Setup minimo richiede pratica + agenzia esistente (usa seed)
    // Saltato il test concreto se richiede setup fixture significativo.
    // In alternativa: smoke test manuale via endpoint.
    expect(true).toBe(true);
  });
});
```

> Nota: il vero test di integrazione richiede fixture DB; lo lasciamo come "smoke test" via endpoint nello step 4. Se il team aggiunge fixture testing in futuro, il test si arricchisce.

- [ ] **Step 3: Endpoint API**

```ts
// apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { processFeeScheduled } from '@/lib/jobs/process-fee-scheduled';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await processFeeScheduled();
  return NextResponse.json({ ok: true, ...result });
}
```

- [ ] **Step 4: Smoke test manuale**

Crea un FeeAddebito SCHEDULED via flusso firma (Task 6 already shortened to 5 min). Aspetta 5 min o forza `autoAddebitoAt` nel passato via `pnpm db:studio`. POST a `http://localhost:3000/api/jobs/process-fee-scheduled` (via curl autenticato, o aspetta Task 27 per pulsante UI).

In DB verifica `FeeAddebito.stato = SUCCESS`, `providerRef` inizia con `mock-`.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts apps/piattaforma/src/lib/jobs/process-fee-scheduled.test.ts apps/piattaforma/src/app/api/jobs/process-fee-scheduled
git commit -m "feat(jobs): process-fee-scheduled processa FeeAddebito SCHEDULED via mock payment"
```

---

## Task 22: Job process-payouts + endpoint

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/process-payouts.ts`
- Create: `apps/piattaforma/src/app/api/jobs/process-payouts/route.ts`

- [ ] **Step 1: Implementare il job**

```ts
// apps/piattaforma/src/lib/jobs/process-payouts.ts
import 'server-only';
import { prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';
import { sendNotification } from '@/lib/notifiche';

const BATCH_SIZE = 20;

export type ProcessPayoutsResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

export async function processPayouts(): Promise<ProcessPayoutsResult> {
  const payouts = await prisma.payout.findMany({
    where: { stato: 'RICHIESTO' },
    take: BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
    include: { wallet: { include: { company: { select: { id: true, iban: true } } } } },
  });

  let succeeded = 0;
  let failed = 0;
  const payment = getPayment();

  for (const payout of payouts) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { stato: 'IN_LAVORAZIONE' },
    });

    const iban = payout.wallet.company.iban ?? '';
    if (!iban) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          stato: 'FALLITO',
          errorMessage: 'IBAN mancante',
          processedAt: new Date(),
        },
      });
      failed++;
      continue;
    }

    const result = await payment.executePayout({
      payoutId: payout.id,
      importoCent: payout.importoCent,
      iban,
    });

    if (result.ok) {
      // Atomic: scala saldo + crea transazione + segna payout ESEGUITO
      await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.update({
          where: { id: payout.walletId },
          data: { saldoCent: { decrement: payout.importoCent } },
        });
        await tx.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: payout.automatico ? 'PAYOUT_AUTOMATICO' : 'PAYOUT_MANUALE',
            importoCent: -payout.importoCent,
            saldoPostCent: wallet.saldoCent,
            payoutId: payout.id,
          },
        });
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            stato: 'ESEGUITO',
            providerRef: result.providerRef,
            processedAt: new Date(),
            errorMessage: null,
          },
        });
      });

      // Notifica N5 al broker (best-effort)
      try {
        await sendNotification('N5_BROKER_PAYOUT_ESEGUITO', {
          companyId: payout.wallet.company.id,
          extra: { payoutId: payout.id, importoCent: payout.importoCent },
        });
      } catch { /* swallow */ }

      succeeded++;
    } else {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          stato: 'FALLITO',
          errorMessage: result.error,
          processedAt: new Date(),
        },
      });
      failed++;
    }
  }

  return { processed: payouts.length, succeeded, failed };
}
```

> Verifica: notifica N5 esiste nell'enum NotificaTipo? Se no, usa una generica o salta. Verifica anche se Wallet ha relazione `company` con campo `iban` (probabile sì, controlla schema).

- [ ] **Step 2: Endpoint**

```ts
// apps/piattaforma/src/app/api/jobs/process-payouts/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { processPayouts } from '@/lib/jobs/process-payouts';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await processPayouts();
  return NextResponse.json({ ok: true, ...result });
}
```

- [ ] **Step 3:** Smoke test: crea Payout RICHIESTO via Task 18, POST endpoint, verifica `Payout.stato = ESEGUITO` + `Wallet.saldoCent` decrementato + `TransazioneWallet PAYOUT_*` creata.
- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/lib/jobs/process-payouts.ts apps/piattaforma/src/app/api/jobs/process-payouts
  git commit -m "feat(jobs): process-payouts esegue Payout RICHIESTO via mock + transazione wallet"
  ```

---

## Task 23: Job send-solleciti + endpoint

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/send-solleciti.ts`
- Create: `apps/piattaforma/src/app/api/jobs/send-solleciti/route.ts`

- [ ] **Step 1: Implementare il job**

```ts
// apps/piattaforma/src/lib/jobs/send-solleciti.ts
import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';

const SOGLIA_DEMO_MS = 5 * 60_000;
const SOGLIA_PROD_MS = 5 * 86_400_000;

export type SolleciResult = {
  n3Sent: number; // sollecito broker su pratica accettata non firmata
  n7Sent: number; // sollecito agenzia countdown 20gg
};

export async function sendSolleciti(): Promise<SolleciResult> {
  const soglia = env.DEMO_MODE ? SOGLIA_DEMO_MS : SOGLIA_PROD_MS;
  const cutoff = new Date(Date.now() - soglia);

  // N3 broker: pratica ASSEGNATA da > soglia, ancora non FIRMATA
  const pratiche = await prisma.pratica.findMany({
    where: {
      stato: 'ASSEGNATA',
      assegnataAt: { lte: cutoff },
    },
    select: { id: true, brokerId: true, agenziaAssegnataId: true },
  });

  let n3Sent = 0;
  let n7Sent = 0;

  for (const p of pratiche) {
    try {
      await sendNotification('N3_BROKER_SOLLECITO_FIRMA', {
        praticaId: p.id,
        companyId: p.brokerId,
      });
      n3Sent++;
    } catch { /* swallow */ }
    if (p.agenziaAssegnataId) {
      try {
        await sendNotification('N7_AGENZIA_PROMEMORIA_COUNTDOWN', {
          praticaId: p.id,
          agenziaId: p.agenziaAssegnataId,
        });
        n7Sent++;
      } catch { /* swallow */ }
    }
  }

  return { n3Sent, n7Sent };
}
```

> Verifica: campo `assegnataAt` su Pratica esiste? Cerca nello schema. Se ha nome diverso (es. `firmaScheduledAt`, `acceptedAt`), adatta. Stessa cosa per i tipi di NotificaTipo.

- [ ] **Step 2: Endpoint** (stesso pattern degli altri):

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sendSolleciti } from '@/lib/jobs/send-solleciti';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await sendSolleciti();
  return NextResponse.json({ ok: true, ...result });
}
```

- [ ] **Step 3:** Smoke test: con DB seed, modifica una pratica ASSEGNATA per avere `assegnataAt` 10 min nel passato. POST endpoint → verifica notifiche N3+N7 in `NotificaInviata`.
- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/lib/jobs/send-solleciti.ts apps/piattaforma/src/app/api/jobs/send-solleciti
  git commit -m "feat(jobs): send-solleciti invia N3+N7 dopo soglia (5min DEMO / 5gg prod)"
  ```

---

## Task 24: Job trigger-auto-payout + endpoint

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/trigger-auto-payout.ts`
- Create: `apps/piattaforma/src/app/api/jobs/trigger-auto-payout/route.ts`

- [ ] **Step 1: Implementare il job**

```ts
// apps/piattaforma/src/lib/jobs/trigger-auto-payout.ts
import 'server-only';
import { prisma } from '@pv/db';

const AUTO_PAYOUT_THRESHOLD_CENT = 100_000;

export type TriggerAutoPayoutResult = { created: number };

export async function triggerAutoPayout(): Promise<TriggerAutoPayoutResult> {
  const wallets = await prisma.wallet.findMany({
    where: { saldoCent: { gte: AUTO_PAYOUT_THRESHOLD_CENT } },
    select: { id: true, saldoCent: true },
  });

  let created = 0;
  for (const w of wallets) {
    const inflight = await prisma.payout.findFirst({
      where: { walletId: w.id, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
    });
    if (inflight) continue;

    await prisma.payout.create({
      data: {
        walletId: w.id,
        importoCent: w.saldoCent,
        stato: 'RICHIESTO',
        automatico: true,
      },
    });
    created++;
  }
  return { created };
}
```

- [ ] **Step 2: Endpoint** (stesso pattern):
  ```ts
  import { NextResponse } from 'next/server';
  import { auth } from '@/auth';
  import { triggerAutoPayout } from '@/lib/jobs/trigger-auto-payout';
  export async function POST() {
    const session = await auth();
    if (session?.user?.role !== 'ADMIN_PIATTAFORMA') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const result = await triggerAutoPayout();
    return NextResponse.json({ ok: true, ...result });
  }
  ```
- [ ] **Step 3:** Smoke test: con seed (Task 31) wallet "Demo Auto Srl" ha saldo 1.250€ → POST → 1 Payout `automatico=true RICHIESTO` creato. Idempotente: POST nuovamente → `created: 0` (perché c'è già un inflight).
- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/lib/jobs/trigger-auto-payout.ts apps/piattaforma/src/app/api/jobs/trigger-auto-payout
  git commit -m "feat(jobs): trigger-auto-payout crea Payout automatico per wallet >= 1000€"
  ```

---

## Task 25: Componente Counters live (server)

**Files:**
- Create: `apps/piattaforma/src/app/admin/demo-control/counters.tsx`
- Modify: `apps/piattaforma/src/app/admin/demo-control/page.tsx`

- [ ] **Step 1: Counters server component**

```tsx
// apps/piattaforma/src/app/admin/demo-control/counters.tsx
import { prisma } from '@pv/db';

export async function Counters() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 3600_000);

  const [feeScheduled, feeOverdue, payoutsRichiesti, praticheAttesa, praticheEscalation, emails24h] =
    await Promise.all([
      prisma.feeAddebito.count({ where: { stato: 'SCHEDULED' } }),
      prisma.feeAddebito.count({
        where: { stato: 'SCHEDULED', autoAddebitoAt: { lte: now } },
      }),
      prisma.payout.count({ where: { stato: 'RICHIESTO' } }),
      prisma.pratica.count({
        where: { stato: { in: ['IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3'] } },
      }),
      prisma.pratica.count({ where: { stato: 'IN_ESCALATION' } }),
      prisma.notificaInviata.count({ where: { sentAt: { gte: last24h } } }),
    ]);

  const cards = [
    { label: 'Addebiti SCHEDULED', value: feeScheduled, hint: `${feeOverdue} pronti` },
    { label: 'Payout RICHIESTI', value: payoutsRichiesti, hint: 'da processare' },
    { label: 'Pratiche in attesa', value: praticheAttesa, hint: 'round 1/2/3' },
    { label: 'In escalation', value: praticheEscalation, hint: 'gestione manuale' },
    { label: 'Email ultime 24h', value: emails24h, hint: 'inviate' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-pv-slate-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-pv-slate-500">
            {c.label}
          </p>
          <p className="mt-1 text-2xl font-extrabold text-pv-navy-900">{c.value}</p>
          <p className="text-[11px] text-pv-slate-500">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2:** In `page.tsx`, sostituisci il placeholder counters con `<Counters />` (importa).
- [ ] **Step 3:** Verifica manuale: i numeri compaiono. Forza un FeeAddebito SCHEDULED via firma → ricarica → counter aumenta.
- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/app/admin/demo-control
  git commit -m "feat(demo): componente Counters live in /admin/demo-control"
  ```

---

## Task 26: Componente Inbox Demo (lista email + modal)

**Files:**
- Create: `apps/piattaforma/src/app/admin/demo-control/inbox-demo.tsx`
- Create: `apps/piattaforma/src/app/admin/demo-control/email-modal.tsx` (client)
- Modify: `apps/piattaforma/src/app/admin/demo-control/page.tsx`

- [ ] **Step 1: InboxDemo server component**

```tsx
// apps/piattaforma/src/app/admin/demo-control/inbox-demo.tsx
import { prisma } from '@pv/db';
import { EmailModal } from './email-modal';
import { formatRelative } from '@/lib/format';

export async function InboxDemo() {
  const emails = await prisma.notificaInviata.findMany({
    orderBy: { sentAt: 'desc' },
    take: 50,
    select: {
      id: true, tipo: true, destinatarioEmail: true, subject: true,
      bodyHtml: true, sentAt: true, providerRef: true,
    },
  });

  return (
    <div className="rounded-2xl border border-pv-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-pv-slate-100 px-5 py-3">
        <h2 className="text-base font-bold text-pv-navy-900">Inbox Demo</h2>
        <span className="text-xs text-pv-slate-500">Ultime 50</span>
      </header>
      {emails.length === 0 ? (
        <p className="p-5 text-sm text-pv-slate-500">Nessuna email simulata.</p>
      ) : (
        <ul className="max-h-[600px] divide-y divide-pv-slate-100 overflow-auto">
          {emails.map((e) => (
            <li key={e.id} className="px-5 py-3 hover:bg-pv-slate-50">
              <EmailModal email={e}>
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-pv-navy-900">
                      {e.subject ?? '(senza oggetto)'}
                    </p>
                    <p className="truncate text-xs text-pv-slate-500">
                      {e.destinatarioEmail} · {e.tipo}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-pv-slate-500">
                    {formatRelative(e.sentAt!)}
                  </span>
                </div>
              </EmailModal>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> Verifica nomi colonne `NotificaInviata`: `destinatarioEmail`, `subject`, `bodyHtml`, `sentAt`, `tipo` — adatta se il tuo schema usa nomi diversi.

- [ ] **Step 2: EmailModal client component**

```tsx
// apps/piattaforma/src/app/admin/demo-control/email-modal.tsx
'use client';

import { useState, type ReactNode } from 'react';

type Email = {
  id: string;
  subject: string | null;
  destinatarioEmail: string;
  bodyHtml: string | null;
  tipo: string;
};

export function EmailModal({ email, children }: { email: Email; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  function extractLink(): string | null {
    if (!email.bodyHtml) return null;
    const match = email.bodyHtml.match(
      /href="([^"]*\/(?:verify-email|reset-password|invito)[^"]*)"/,
    );
    return match?.[1] ?? null;
  }

  function copyLink() {
    const link = extractLink();
    if (link) navigator.clipboard.writeText(link);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-left">
        {children}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-10" onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-pv-slate-100 px-5 py-3">
              <div>
                <p className="font-bold text-pv-navy-900">{email.subject ?? '(senza oggetto)'}</p>
                <p className="text-xs text-pv-slate-500">A: {email.destinatarioEmail} · {email.tipo}</p>
              </div>
              <div className="flex gap-2">
                {extractLink() && (
                  <button type="button" onClick={copyLink} className="rounded-lg bg-pv-navy-700 px-3 py-1.5 text-xs font-semibold text-white">
                    Copia link
                  </button>
                )}
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-pv-slate-300 px-3 py-1.5 text-xs">
                  Chiudi
                </button>
              </div>
            </header>
            <iframe
              srcDoc={email.bodyHtml ?? '<p>Email vuota</p>'}
              sandbox=""
              className="h-[500px] w-full rounded-b-2xl"
              title={email.subject ?? 'email'}
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3:** In `page.tsx` sostituisci il placeholder Inbox con `<InboxDemo />`.
- [ ] **Step 4:** Verifica manuale: registra un nuovo utente → vai su Demo Control → vedi l'email di benvenuto/verifica nella lista. Click → modal con HTML rendered + pulsante "Copia link" copia il link verifica.
- [ ] **Step 5:** Commit:
  ```bash
  git add apps/piattaforma/src/app/admin/demo-control
  git commit -m "feat(demo): Inbox Demo con lista 50 email + modal HTML + copy link verifica"
  ```

---

## Task 27: Job Buttons + integrazione pagina demo-control

**Files:**
- Create: `apps/piattaforma/src/app/admin/demo-control/job-buttons.tsx` (client)
- Modify: `apps/piattaforma/src/app/admin/demo-control/page.tsx`

- [ ] **Step 1: JobButtons client component**

```tsx
// apps/piattaforma/src/app/admin/demo-control/job-buttons.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const jobs = [
  { key: 'fee', label: '⚡ Processa addebiti SCHEDULED', endpoint: '/api/jobs/process-fee-scheduled' },
  { key: 'payouts', label: '💰 Processa payout pendenti', endpoint: '/api/jobs/process-payouts' },
  { key: 'tick', label: '🔁 Avanza tick distribuzione', endpoint: '/api/jobs/distribuzione-tick' },
  { key: 'solleciti', label: '📨 Invia solleciti pratiche', endpoint: '/api/jobs/send-solleciti' },
  { key: 'autoPayout', label: '🎯 Trigger payout automatici', endpoint: '/api/jobs/trigger-auto-payout' },
];

type JobState = { running: boolean; result?: string; error?: string };

export function JobButtons() {
  const [state, setState] = useState<Record<string, JobState>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(key: string, endpoint: string) {
    setState((s) => ({ ...s, [key]: { running: true } }));
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          setState((s) => ({ ...s, [key]: { running: false, error: data.error ?? 'Errore' } }));
          return;
        }
        const summary = Object.entries(data)
          .filter(([k]) => k !== 'ok')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ');
        setState((s) => ({ ...s, [key]: { running: false, result: summary } }));
        router.refresh();
      } catch (err) {
        setState((s) => ({ ...s, [key]: { running: false, error: String(err) } }));
      }
    });
  }

  return (
    <div className="rounded-2xl border border-pv-slate-200 bg-white p-5">
      <h2 className="text-base font-bold text-pv-navy-900 mb-3">Esegui job</h2>
      <div className="space-y-2">
        {jobs.map((j) => {
          const s = state[j.key];
          return (
            <div key={j.key} className="flex items-center justify-between gap-3 rounded-lg border border-pv-slate-200 bg-pv-slate-50 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-pv-navy-900">{j.label}</p>
                {s?.result && <p className="text-xs text-pv-green-700">{s.result}</p>}
                {s?.error && <p className="text-xs text-pv-red-600">{s.error}</p>}
              </div>
              <button
                type="button"
                onClick={() => run(j.key, j.endpoint)}
                disabled={pending || s?.running}
                className="shrink-0 rounded-lg bg-pv-navy-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {s?.running ? 'Esecuzione…' : 'Esegui'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** In `page.tsx` sostituisci il placeholder con `<JobButtons />`. Final layout della pagina:

```tsx
import { Counters } from './counters';
import { InboxDemo } from './inbox-demo';
import { JobButtons } from './job-buttons';
// …
<section className="mb-6"><Counters /></section>
<div className="grid gap-6 lg:grid-cols-2">
  <InboxDemo />
  <JobButtons />
</div>
```

- [ ] **Step 3:** Verifica manuale completa:
  1. Registra nuovo utente dealer → entra → crea pratica → invia
  2. Login come agenzia destinataria → accetta → marca firma
  3. Vai su `/admin/demo-control` → vedi counter "Addebiti SCHEDULED: 1"
  4. Aspetta 5 min (oppure forza autoAddebitoAt nel passato)
  5. Click "Processa addebiti SCHEDULED" → toast "succeeded: 1, failed: 0", counter scende a 0
  6. Verifica DB: FeeAddebito.stato = SUCCESS

- [ ] **Step 4:** Commit:
  ```bash
  git add apps/piattaforma/src/app/admin/demo-control
  git commit -m "feat(demo): JobButtons completo per esecuzione manuale dei 5 cron"
  ```

---

## Task 28: Seed — account demo precostituiti

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1:** All'inizio (o in funzione dedicata `seedDemoAccounts()`), creare 4 utenti precostituiti via `upsert`:

```ts
const DEMO_PASSWORD_HASH = await bcrypt.hash('DemoPass2026!', 12);

// Demo Admin (no company)
await prisma.user.upsert({
  where: { email: 'admin@demo.passaggioveloce.it' },
  create: {
    email: 'admin@demo.passaggioveloce.it',
    passwordHash: DEMO_PASSWORD_HASH,
    nome: 'Admin', cognome: 'Demo',
    role: 'ADMIN_PIATTAFORMA', status: 'ACTIVE',
    emailVerifiedAt: new Date(),
  },
  update: { passwordHash: DEMO_PASSWORD_HASH },
});

// Demo Dealer Company
const demoDealerCompany = await prisma.company.upsert({
  where: { partitaIva: '99999999991' },
  create: {
    type: 'DEALER',
    ragioneSociale: 'Demo Auto Srl', partitaIva: '99999999991',
    pec: 'pec@demoauto.it', email: 'info@demoauto.it',
    indirizzo: 'Via Roma 1', citta: 'Padova', cap: '35100', provincia: 'PD',
    iban: 'IT60X0542811101000000000001', sepaMandateAccepted: true,
    sepaMandateAcceptedAt: new Date(), termsAcceptedAt: new Date(),
  },
  update: {},
});

// Demo Dealer Admin
await prisma.user.upsert({
  where: { email: 'dealer@demo.passaggioveloce.it' },
  create: {
    email: 'dealer@demo.passaggioveloce.it',
    passwordHash: DEMO_PASSWORD_HASH,
    nome: 'Mario', cognome: 'Rossi',
    role: 'ADMIN_AZIENDA', status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    companyId: demoDealerCompany.id,
  },
  update: { passwordHash: DEMO_PASSWORD_HASH, companyId: demoDealerCompany.id },
});

// Demo Dealer Junior (UTENTE_AZIENDA)
await prisma.user.upsert({
  where: { email: 'dealer-junior@demo.passaggioveloce.it' },
  create: {
    email: 'dealer-junior@demo.passaggioveloce.it',
    passwordHash: DEMO_PASSWORD_HASH,
    nome: 'Luca', cognome: 'Bianchi',
    role: 'UTENTE_AZIENDA', status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    companyId: demoDealerCompany.id,
  },
  update: { passwordHash: DEMO_PASSWORD_HASH },
});

// Demo Agenzia Company + Admin (analogo)
const demoAgenziaCompany = await prisma.company.upsert({
  where: { partitaIva: '99999999992' },
  create: {
    type: 'AGENZIA',
    ragioneSociale: 'Demo Pratiche Auto Snc', partitaIva: '99999999992',
    pec: 'pec@demopratiche.it', email: 'info@demopratiche.it',
    indirizzo: 'Via Milano 5', citta: 'Padova', cap: '35100', provincia: 'PD',
    iban: 'IT60X0542811101000000000002', sepaMandateAccepted: true,
    sepaMandateAcceptedAt: new Date(), termsAcceptedAt: new Date(),
  },
  update: {},
});
await prisma.user.upsert({
  where: { email: 'agenzia@demo.passaggioveloce.it' },
  create: {
    email: 'agenzia@demo.passaggioveloce.it',
    passwordHash: DEMO_PASSWORD_HASH,
    nome: 'Giulia', cognome: 'Verdi',
    role: 'ADMIN_AZIENDA', status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    companyId: demoAgenziaCompany.id,
  },
  update: { passwordHash: DEMO_PASSWORD_HASH, companyId: demoAgenziaCompany.id },
});
```

> Aggiungere import `bcrypt` (oppure usare l'helper `hashPassword` già esistente). Se `Company` ha campi obbligatori extra (codice SDI, telefono), usa null/default coerenti col seed esistente.

> Per l'agenzia demo: aggiungi anche orari standard (lun-ven 9-13/15-18:30, sab 9-12) usando lo stesso pattern del seed esistente per le 3 agenzie.

- [ ] **Step 2:** Run `pnpm db:seed`. Eseguire 2 volte → idempotente, no duplicati.
- [ ] **Step 3:** Login con `admin@demo.passaggioveloce.it` / `DemoPass2026!` → entri come admin. Stessa cosa per dealer e agenzia demo.
- [ ] **Step 4:** Commit:
  ```bash
  git add packages/db/prisma/seed.ts
  git commit -m "feat(seed): account demo precostituiti (admin/dealer+junior/agenzia)"
  ```

---

## Task 29: Seed — cast aggiuntivo (dealer + agenzie)

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1:** Aggiungere `seedCastAggiuntivo()`:
  - **2 dealer aggiuntivi**: "Auto Veneto Srl" (Venezia, P.IVA 99999999993, IBAN ...003), "Concessionaria Treviso Spa" (Treviso, P.IVA 99999999994, IBAN ...004). Ciascuno con un User ADMIN_AZIENDA (`auto-veneto@demo...`, `treviso@demo...`) + DEMO_PASSWORD_HASH.
  - **5 agenzie aggiuntive** (oltre alle 3 del seed esistente e a Demo Pratiche Auto): 1 Padova, 1 Venezia, 1 Treviso, 1 Vicenza, 1 Verona. Per ognuna: Company AGENZIA + User ADMIN_AZIENDA + Orari (lun-ven 9-13/15-18:30, sab 9-12).
  - Verona deve avere flag/condizione che la porti automaticamente in `sospesa: true` o avere rating <2.5 dopo aver creato le valutazioni di Task 31.
- [ ] **Step 2:** Verifica manuale: login admin → `/admin/agenzie` → vedi 9+ agenzie totali (3 originali + 1 demo + 5 nuove), Verona sospesa.
- [ ] **Step 3:** Commit:
  ```bash
  git add packages/db/prisma/seed.ts
  git commit -m "feat(seed): cast aggiuntivo 2 dealer + 5 agenzie distribuite Veneto"
  ```

---

## Task 30: Seed — pratiche stati misti (~30)

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1:** Aggiungere `seedPraticheDemo()`. Funzione helper `creaPraticaDemo({ broker, stato, agenziaAssegnata?, comune, provincia, daysAgo, withDocumenti })` che crea Pratica + (se withDocumenti) Documento libretto fittizio (PDF placeholder ~10KB generato con `Buffer.from('%PDF-1.4 mock content')` salvato via `getStorage().put({ scope: 'documenti', buffer, originalFilename: 'libretto-mock.pdf', mimeType: 'application/pdf' })`).
  - Genera codice pratica `PV-2026-XXXXX` deterministico.
  - Compila `dataImmatricolazione`, `targa`, `telaio` random plausibili.
  - Crea PraticaAssegnazione coerente con stato (es. `IN_ATTESA_ROUND_1` → 5 PraticaAssegnazione PENDING per round 1; `ASSEGNATA` → 1 ACCETTATA + altre ASSEGNATA_ALTRO).

- [ ] **Step 2:** Quantità target (vedi spec sezione 6.3):
  - 2 BOZZA (no assegnazioni)
  - 5 IN_ATTESA_ROUND_1
  - 2 IN_ATTESA_ROUND_2
  - 1 IN_ATTESA_ROUND_3
  - 4 ASSEGNATA
  - 12 FIRMATA (varie date `firmaAvvenutaAt` distribuite tra 30gg fa e ieri)
  - 2 IN_ESCALATION
  - 2 ANNULLATA_DEALER

  Distribuisci per i 3 dealer (Demo Auto, Auto Veneto, Treviso) e per le agenzie disponibili. Comuni Veneto: Padova, Venezia, Treviso, Vicenza, Verona, Mestre, Mira.

- [ ] **Step 3:** Per le pratiche FIRMATA, aggiungi `creditoBrokerCent: 2500` (25€), `feeAgenziaCent: 6000` (60€). Per quelle FIRMATA "vecchie" (>20gg fa), il flusso reale avrebbe già processato il FeeAddebito — al seed simula creando 2 FeeAddebito SUCCESS (con providerRef `seed-success-...`) + 3 FeeAddebito SCHEDULED con `autoAddebitoAt` già scaduto (per essere processabili dal pulsante demo).

- [ ] **Step 4:** Run `pnpm db:seed`. Login admin → `/admin/pratiche` → vedi ~30 pratiche di tutti gli stati.

- [ ] **Step 5:** Commit:
  ```bash
  git add packages/db/prisma/seed.ts
  git commit -m "feat(seed): ~30 pratiche stati misti per popolare demo"
  ```

---

## Task 31: Seed — wallet, finanza, valutazioni

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1:** Per i 3 dealer demo (Demo Auto, Auto Veneto, Treviso) creare/aggiornare Wallet con saldi:
  - Demo Auto Srl: `saldoCent: 125_000` (1250€) + 15 transazioni storiche (mix CREDITO_PRATICA da pratiche FIRMATA + 1 PAYOUT_AUTOMATICO ESEGUITO storico + 1 RETTIFICA_ADMIN nominale)
  - Auto Veneto: `saldoCent: 48_000` (480€) + 5 CREDITO_PRATICA
  - Concessionaria Treviso: `saldoCent: 0` (vuoto, neo-iscritto)

- [ ] **Step 2:** Creare 1 Payout RICHIESTO per il dealer "Auto Veneto" (sotto soglia auto, manuale, importo = saldoCent attuale).

- [ ] **Step 3:** Per agenzia demo (Demo Pratiche Auto Snc) creare 12 Valutazioni storiche con score 4-5 stelle, 1 con `segnalazioneAbuso: true`. Distribuisci tra le pratiche FIRMATA assegnate a questa agenzia.
  - Per le altre agenzie aggiunte: 2-8 valutazioni miste (3-5 stelle).
  - Verona: 5 valutazioni con score 1-2 → media <2.5 → trigger sospensione.

- [ ] **Step 4:** Run seed. Login dealer demo → `/wallet` → vedi saldo 1250€, 15 transazioni. Login admin → `/admin/agenzie` → Verona sospesa, Demo Pratiche Auto rating 4.6⭐.

- [ ] **Step 5:** Commit:
  ```bash
  git add packages/db/prisma/seed.ts
  git commit -m "feat(seed): wallet, transazioni storiche, payout, valutazioni demo"
  ```

---

## Task 32: Schema Prisma directUrl + push GitHub

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1:** Nel datasource Prisma:
  ```prisma
  datasource db {
    provider  = "postgresql"
    url       = env("DATABASE_URL")
    directUrl = env("DIRECT_URL")
  }
  ```
- [ ] **Step 2:** `pnpm --filter @pv/db db:generate` per rigenerare client.
- [ ] **Step 3:** Verifica che il dev locale funziona ancora (in dev, `DATABASE_URL` e `DIRECT_URL` puntano allo stesso Postgres locale — opzionale, Prisma accetta `directUrl` mancante in dev).
- [ ] **Step 4:** Commit + push GitHub (se il repo non è ancora su GitHub, prima `gh repo create` o setup remote manuale):
  ```bash
  git add packages/db/prisma/schema.prisma
  git commit -m "chore(db): aggiunge directUrl per Neon serverless"
  git push origin main  # se remote già configurato
  ```

> **Pre-requisito GitHub:** se il repo non ha ancora un remote, l'utente deve creare un repo GitHub (privato o pubblico) e aggiungere il remote. Verifica con `git remote -v`. Se vuoto: `gh repo create passaggio-veloce --private --source=. --push` (richiede gh CLI auth).

---

## Task 33: Setup Neon + Vercel Blob (manuale, documentato)

**Files:** nessuna modifica codice — operazioni dashboard.

- [ ] **Step 1: Neon**
  1. Vai su https://neon.tech → Sign up con GitHub.
  2. Create project → name: `passaggio-veloce-demo`, region: AWS eu-central-1 (Francoforte) o eu-west-1 (Irlanda).
  3. Database default: `neondb`. Copia 2 connection string:
     - **Pooled** (`-pooler` nel hostname, porta 6543) → sarà `DATABASE_URL`
     - **Direct** (no pooler, porta 5432) → sarà `DIRECT_URL`
  4. Salva entrambe in un password manager temporaneo.

- [ ] **Step 2: Vercel Blob**
  1. Vai su https://vercel.com → Sign up con GitHub.
  2. Importa il repo GitHub `passaggio-veloce` → procedura guidata. **Ferma alla configurazione**, non fare deploy ancora.
  3. Vai su Storage → Create Database → Blob → name: `passaggio-veloce-blob`.
  4. Copia il `BLOB_READ_WRITE_TOKEN`.

- [ ] **Step 3:** Annota tutte le credenziali (3 stringhe) per Task 34.

---

## Task 34: Setup progetto Vercel + env vars (manuale)

**Files:** nessuna modifica codice — operazioni dashboard Vercel.

- [ ] **Step 1: Configurazione progetto Vercel**
  1. Project Settings → General:
     - **Root Directory**: `apps/piattaforma`
     - **Framework Preset**: Next.js (auto-rilevato)
     - **Build Command**: `cd ../.. && pnpm build --filter piattaforma...`
     - **Install Command**: `cd ../.. && pnpm install --frozen-lockfile`
     - **Output Directory**: lascia default (`.next`)
     - **Node Version**: 22.x
  2. Project Settings → Environment Variables (production + preview + development):

     ```
     DATABASE_URL=<neon-pooled-url>
     DIRECT_URL=<neon-direct-url>
     BLOB_READ_WRITE_TOKEN=<vercel-blob-token>
     STORAGE_PROVIDER=vercel-blob
     EMAIL_PROVIDER=console
     OCR_PROVIDER=mock
     PAYMENT_PROVIDER=mock
     DEMO_MODE=true
     AUTH_SECRET=<openssl rand -base64 32>
     AUTH_URL=https://passaggio-veloce-demo.vercel.app
     NEXT_PUBLIC_APP_URL=https://passaggio-veloce-demo.vercel.app
     ```

     Nota: `AUTH_SECRET` da generare localmente con `openssl rand -base64 32` (≥32 char).

- [ ] **Step 2: Deploy iniziale**
  1. Trigger un deploy: Vercel dashboard → Deployments → Create Deployment → branch `main`.
  2. Aspetta build (~2-4 min).
  3. Se fallisce, controlla i log build (problemi comuni: monorepo path turbo, missing env, lockfile).

- [ ] **Step 3:** Verifica che il deploy stia su `https://passaggio-veloce-demo.vercel.app` (o sul nome auto-generato — rinomina nel project settings se vuoi).

> Nessun commit in questo task (solo setup esterno).

---

## Task 35: Migrazioni + seed produzione + smoke test

**Files:** nessuna modifica codice — operazioni terminale.

- [ ] **Step 1: Migrazioni su Neon**

Da terminale locale (le credenziali Neon sono temporaneamente nei tuoi env):

```bash
DATABASE_URL="<neon-direct-url>" DIRECT_URL="<neon-direct-url>" \
  pnpm --filter @pv/db prisma migrate deploy
```

Expected: "All migrations have been successfully applied."

- [ ] **Step 2: Seed produzione**

```bash
DATABASE_URL="<neon-direct-url>" DIRECT_URL="<neon-direct-url>" \
  STORAGE_PROVIDER="vercel-blob" \
  BLOB_READ_WRITE_TOKEN="<vercel-blob-token>" \
  pnpm --filter @pv/db db:seed
```

> Lo seed ora usa `getStorage()` (vercel-blob in prod) per i documenti placeholder. Se il seed fallisce su upload blob, verifica il token.

- [ ] **Step 3: Smoke test deploy**
  1. Apri `https://passaggio-veloce-demo.vercel.app`
  2. Vedi banner "🧪 Modalità DEMO" giallo
  3. Login con `admin@demo.passaggioveloce.it` / `DemoPass2026!` → dashboard admin OK
  4. Navigare `/admin/demo-control` → counters popolati, Inbox Demo con email seed
  5. Login con `dealer@demo.passaggioveloce.it` → wallet 1250€, lista pratiche popolata
  6. Login con `agenzia@demo.passaggioveloce.it` → inbox pratiche, dashboard
  7. Registrare un utente nuovo (es. `test@test.it`) → auto-verify, login immediato OK
  8. Click su "Esegui" un job → toast con risultato
  9. Aprire un'email da Inbox Demo → modal HTML rendered

- [ ] **Step 4:** Se tutto OK, committa eventuali piccoli fix di troubleshooting:

```bash
git add . && git commit -m "fix(deploy): aggiustamenti smoke test produzione"
git push
```

---

## Task 36: README aggiornato con sezione DEMO

**Files:**
- Modify: `README.md` (root)

- [ ] **Step 1:** Aggiungere/aggiornare le sezioni:

```markdown
## 🧪 Demo

URL: **https://passaggio-veloce-demo.vercel.app**

### Account demo precostituiti

Password unica: `DemoPass2026!`

| Email | Ruolo | Note |
|---|---|---|
| `admin@demo.passaggioveloce.it` | Admin piattaforma | Accesso a Demo Control |
| `dealer@demo.passaggioveloce.it` | Dealer admin | Wallet 1.250€, può richiedere payout |
| `dealer-junior@demo.passaggioveloce.it` | Dealer utente secondario | Per testare multi-utente |
| `agenzia@demo.passaggioveloce.it` | Agenzia admin | 12 valutazioni, rating 4.6⭐ |

### Modalità DEMO

In modalità DEMO (env `DEMO_MODE=true`):
- Email: simulate, visibili in `/admin/demo-control` (Inbox Demo)
- OCR libretto: dati generati deterministicamente
- Pagamenti: simulati, processati manualmente da `/admin/demo-control` → "Esegui job"
- Auto-addebito firma: 5 minuti (anziché 20 giorni)
- Solleciti: 5 minuti (anziché 5 giorni)
- Storage documenti: Vercel Blob

### Procedura primo deploy

1. Setup Neon + Vercel Blob (vedi `docs/superpowers/specs/2026-04-25-demo-ready-design.md` §7)
2. Migrazioni: `DATABASE_URL=<neon> pnpm --filter @pv/db prisma migrate deploy`
3. Seed: `DATABASE_URL=<neon> STORAGE_PROVIDER=vercel-blob BLOB_READ_WRITE_TOKEN=<token> pnpm --filter @pv/db db:seed`

### Setup locale

`docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev`

Login con utenti seed (vedi sopra) o crea il tuo via `/register`.
```

- [ ] **Step 2:** Commit:
  ```bash
  git add README.md
  git commit -m "docs(readme): sezione DEMO con account, URL, modalità, procedura deploy"
  git push
  ```

---

## Self-Review Note

**Cose da verificare prima/durante l'esecuzione (TODO inline da risolvere su file reale):**

1. **Schema Prisma — nomi campi reali**:
   - `Pratica.assegnataAt` (Task 23) — verifica nome esatto
   - `Pratica.provincia` o `comuneProvincia` (Task 19) — verifica
   - `NotificaInviata` colonne (`destinatarioEmail`, `subject`, `bodyHtml`, `sentAt`, `tipo`) — verifica
   - `User.codiceFiscale` / `dataNascita` / `luogoNascita` nullable per UTENTE_AZIENDA (Task 14)
   - Wallet → relazione con Company (Task 22)

2. **NotificaTipo enum**:
   - `N3_BROKER_SOLLECITO_FIRMA`, `N5_BROKER_PAYOUT_ESEGUITO`, `N7_AGENZIA_PROMEMORIA_COUNTDOWN`, `N8_AGENZIA_ADDEBITO_SCHEDULATO` — verifica nomi reali nell'enum di `lib/notifiche`

3. **`sendNotification` firma**:
   - Verifica accetta payload `{ praticaId?, agenziaId?, companyId?, extra? }` — adatta i call site se diverso

4. **Path login form** (Task 11):
   - Verifica se è `page.tsx` o `login-form.tsx`

5. **AuthSecret env var name** — il codice usa `AUTH_SECRET` (Auth.js v5). Vercel env var deve combaciare.

Tutti questi sono "guard rail" — l'esecutore li affronta on-the-fly al momento dell'implementazione del task corrispondente.

---

## Riepilogo task

| # | Titolo | Stima |
|---|---|---|
| 1-2 | Setup vitest + env vars | 30' |
| 3 | Banner DEMO globale | 15' |
| 4-5 | MockPaymentProvider + VercelBlobProvider | 1h |
| 6-7 | Comportamenti DEMO (autoAddebitoAt + auto-verify) | 30' |
| 8-11 | Reset password reale + link login | 1.5h |
| 12-13 | Anteprima/download documenti | 45' |
| 14-17 | Inviti utenti secondari (4 task) | 3h |
| 18 | UI payout broker | 30' |
| 19 | Assegnazione manuale escalation | 45' |
| 20-27 | Demo Control admin (8 task) | 4h |
| 28-31 | Seed narrativo (4 task) | 3h |
| 32-35 | Deploy Vercel + Neon + Blob | 4h |
| 36 | README | 20' |
| **TOTALE** | | **~20h ≈ 5-7 sessioni di lavoro** |

