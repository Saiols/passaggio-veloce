# Step 3 Registrazione — Upload Documenti KYC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere funzionante lo step 3 (placeholder) del wizard di registrazione: upload obbligatorio di CI fronte/retro + Codice Fiscale + Visura Camerale (≤ 6 mesi), con gating rule-based, persistenza su `Documento` legati alla Company, e provider abstraction `RegistroImpreseProvider` (mock, swap-ready).

**Architecture:** I file vengono raccolti in stato client allo step 3 e inviati tutti insieme al submit dello step 4 via `FormData`. `registerAction` (firma cambiata da oggetto a `FormData`) valida i file *prima* di creare qualsiasi record, carica su storage, poi crea Company + User + VerificationToken + 4× `Documento` nella transaction esistente. Pattern identico a `submitNuovaPraticaAction`.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19 + react-hook-form, Zod, Prisma + Postgres, Vitest, pnpm/Turborepo. Spec di riferimento: `docs/superpowers/specs/2026-05-30-registrazione-step3-documenti-design.md`.

**Prerequisiti esecuzione:** DB dev raggiungibile (Postgres docker) con `DATABASE_URL`/`DIRECT_URL` configurati per `prisma migrate dev`. Tutti i comandi `pnpm` si lanciano dalla root del repo `C:/Users/fsiol/Desktop/passaggio_veloce`.

---

## File Structure

**Creati:**
- `apps/piattaforma/src/lib/providers/registro-imprese/types.ts` — interfaccia provider + tipi dato
- `apps/piattaforma/src/lib/providers/registro-imprese/mock.ts` — impl mock deterministica
- `apps/piattaforma/src/lib/providers/registro-imprese/index.ts` — factory `getRegistroImprese()`
- `apps/piattaforma/src/lib/providers/registro-imprese/mock.test.ts` — test mock + factory
- `apps/piattaforma/src/lib/auth/document-validation.ts` — helper puro validazione documenti KYC
- `apps/piattaforma/src/lib/auth/document-validation.test.ts` — test helper

**Modificati:**
- `packages/db/prisma/schema.prisma` — campo `Company.visuraCameraleData` (+ migration generata)
- `apps/piattaforma/src/env.ts` — env `REGISTRO_IMPRESE_PROVIDER` + `REGISTRO_IMPRESE_API_KEY`
- `apps/piattaforma/src/lib/auth/schemas.ts` — `registerStep3DocumentsSchema` reale
- `apps/piattaforma/src/app/(auth)/actions.ts` — `registerAction(formData)` + persistenza documenti + chiamata provider
- `apps/piattaforma/src/app/(auth)/actions.test.ts` — test early-return validazione (nuovo file)
- `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` — `DocumentsStep` reale + stato `documents` + submit FormData
- `docs/piano-implementazione.md` — spunta item FASE 2.1 (righe 192-193)

---

## Task 1: Foundation — env vars + campo Prisma + migration

**Files:**
- Modify: `apps/piattaforma/src/env.ts`
- Modify: `packages/db/prisma/schema.prisma:362-366` (dentro `model Company`, dopo `payoutThresholdCent`)

- [ ] **Step 1: Aggiungi le env per il provider Registro Imprese**

In `apps/piattaforma/src/env.ts`, nel blocco `server`, dopo le righe `OCR_*` (riga 28), aggiungi:

```ts
    REGISTRO_IMPRESE_PROVIDER: z.enum(['mock', 'openapi', 'infocamere']).default('mock'),
    REGISTRO_IMPRESE_API_KEY: z.string().optional(),
```

E nel blocco `runtimeEnv`, dopo `MINDEE_MODEL_ID` (riga 52), aggiungi:

```ts
    REGISTRO_IMPRESE_PROVIDER: process.env.REGISTRO_IMPRESE_PROVIDER,
    REGISTRO_IMPRESE_API_KEY: process.env.REGISTRO_IMPRESE_API_KEY,
```

- [ ] **Step 2: Aggiungi il campo `visuraCameraleData` al model Company**

In `packages/db/prisma/schema.prisma`, dentro `model Company`, subito dopo il campo `payoutThresholdCent Int @default(100000)` (riga ~362), aggiungi:

```prisma
  // KYC registrazione (step 3): data emissione della visura camerale caricata
  // in fase di iscrizione. Usata per validare il vincolo "max 6 mesi" e, in
  // futuro, per rilevare visure scadute lato admin.
  visuraCameraleData DateTime? @db.Date
```

- [ ] **Step 3: Genera e applica la migration**

Run: `pnpm --filter @pv/db exec prisma migrate dev --name add_company_visura_camerale_data`
Expected: crea `packages/db/prisma/migrations/<timestamp>_add_company_visura_camerale_data/migration.sql` con `ALTER TABLE "companies" ADD COLUMN "visuraCameraleData" DATE;` e rigenera il client Prisma senza errori.

- [ ] **Step 4: Verifica typecheck del pacchetto db e dell'app**

Run: `pnpm --filter @pv/db typecheck && pnpm --filter piattaforma typecheck`
Expected: nessun errore (il client Prisma ora espone `visuraCameraleData` e le env sono tipizzate).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/env.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(registrazione): env RegistroImprese + campo Company.visuraCameraleData"
```

---

## Task 2: Provider abstraction `RegistroImpreseProvider`

**Files:**
- Create: `apps/piattaforma/src/lib/providers/registro-imprese/types.ts`
- Create: `apps/piattaforma/src/lib/providers/registro-imprese/mock.ts`
- Create: `apps/piattaforma/src/lib/providers/registro-imprese/index.ts`
- Test: `apps/piattaforma/src/lib/providers/registro-imprese/mock.test.ts`

- [ ] **Step 1: Scrivi i tipi e l'interfaccia**

Create `apps/piattaforma/src/lib/providers/registro-imprese/types.ts`:

```ts
export type RegistroImpreseProviderName = 'mock' | 'openapi' | 'infocamere';

export type StatoAttivita =
  | 'ATTIVA'
  | 'CESSATA'
  | 'IN_LIQUIDAZIONE'
  | 'SOSPESA'
  | 'SCONOSCIUTO';

export type CompanyRegistryData = {
  partitaIva: string;
  denominazione: string;
  formaGiuridica?: string;
  sedeLegale?: {
    indirizzo?: string;
    citta?: string;
    cap?: string;
    provincia?: string;
  };
  statoAttivita: StatoAttivita;
  dataIscrizione?: string; // ISO yyyy-mm-dd
  ateco?: string;
  pec?: string;
  capitaleSociale?: number;
  amministratori?: Array<{ nome: string; cognome: string; carica?: string }>;
  numeroRea?: string;
};

export type RegistroImpreseLookupInput = { partitaIva: string };

export interface RegistroImpreseProvider {
  readonly name: RegistroImpreseProviderName;
  /** Ritorna i dati ufficiali dell'azienda dato il P.IVA, o null se non trovata. */
  lookupByPiva(input: RegistroImpreseLookupInput): Promise<CompanyRegistryData | null>;
}
```

- [ ] **Step 2: Scrivi il test del mock + factory (FAIL atteso)**

Create `apps/piattaforma/src/lib/providers/registro-imprese/mock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockRegistroImpreseProvider } from './mock';

describe('MockRegistroImpreseProvider', () => {
  const provider = new MockRegistroImpreseProvider();

  it('ha name "mock"', () => {
    expect(provider.name).toBe('mock');
  });

  it('ritorna dati deterministici per lo stesso P.IVA', async () => {
    const a = await provider.lookupByPiva({ partitaIva: '12345678901' });
    const b = await provider.lookupByPiva({ partitaIva: '12345678901' });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.partitaIva).toBe('12345678901');
    expect(a!.statoAttivita).toBe('ATTIVA');
    expect(a!.denominazione.length).toBeGreaterThan(0);
  });

  it('varia i dati al variare del P.IVA', async () => {
    const a = await provider.lookupByPiva({ partitaIva: '11111111111' });
    const b = await provider.lookupByPiva({ partitaIva: '99999999999' });
    expect(a!.denominazione).not.toBe(b!.denominazione);
  });
});
```

Run: `pnpm --filter piattaforma exec vitest run src/lib/providers/registro-imprese/mock.test.ts`
Expected: FAIL — `Cannot find module './mock'`.

- [ ] **Step 3: Implementa il mock**

Create `apps/piattaforma/src/lib/providers/registro-imprese/mock.ts`:

```ts
import { createHash } from 'node:crypto';
import type {
  CompanyRegistryData,
  RegistroImpreseLookupInput,
  RegistroImpreseProvider,
} from './types';

const SAMPLE_DENOMINAZIONI = [
  'Auto Service Italia',
  'Rossi Motori',
  'Bianchi Veicoli',
  'Verdi Automobili',
  'Neri Trasporti',
];
const SAMPLE_FORME = ['SRL', 'SRLS', 'SPA', 'SNC', 'Ditta Individuale'];
const SAMPLE_CITTA = ['Milano', 'Roma', 'Torino', 'Napoli', 'Bologna'];

export class MockRegistroImpreseProvider implements RegistroImpreseProvider {
  readonly name = 'mock' as const;

  async lookupByPiva(
    input: RegistroImpreseLookupInput,
  ): Promise<CompanyRegistryData | null> {
    const hash = createHash('sha256').update(input.partitaIva).digest();
    const pick = (arr: readonly string[], offset: number): string =>
      arr[hash[offset]! % arr.length]!;

    await new Promise((resolve) => setTimeout(resolve, 50)); // simula latenza API

    return {
      partitaIva: input.partitaIva,
      denominazione: `${pick(SAMPLE_DENOMINAZIONI, 0)} ${pick(SAMPLE_FORME, 1)}`,
      formaGiuridica: pick(SAMPLE_FORME, 1),
      sedeLegale: { citta: pick(SAMPLE_CITTA, 2) },
      statoAttivita: 'ATTIVA',
      dataIscrizione: `20${10 + (hash[3]! % 14)}-01-15`,
      ateco: '45.11.01',
      numeroRea: `MI-${100000 + (hash[4]! % 800000)}`,
    };
  }
}
```

- [ ] **Step 4: Implementa la factory**

Create `apps/piattaforma/src/lib/providers/registro-imprese/index.ts`:

```ts
import 'server-only';
import { env } from '@/env';
import { MockRegistroImpreseProvider } from './mock';
import type { RegistroImpreseProvider } from './types';

export * from './types';

let instance: RegistroImpreseProvider | null = null;

export function getRegistroImprese(): RegistroImpreseProvider {
  if (instance) return instance;
  switch (env.REGISTRO_IMPRESE_PROVIDER) {
    case 'mock':
      instance = new MockRegistroImpreseProvider();
      break;
    case 'openapi':
      throw new Error(
        'RegistroImprese provider "openapi" non ancora implementato (in attesa account esterno)',
      );
    case 'infocamere':
      throw new Error(
        'RegistroImprese provider "infocamere" non ancora implementato (in attesa account esterno)',
      );
    default:
      throw new Error(
        `Unknown RegistroImprese provider: ${env.REGISTRO_IMPRESE_PROVIDER}`,
      );
  }
  return instance;
}
```

Nota: `mock.test.ts` importa solo `./mock` (non `./index`) per evitare il vincolo `server-only` in ambiente test, come fa `ocr/mindee.test.ts`.

- [ ] **Step 5: Esegui i test (PASS atteso)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/providers/registro-imprese/mock.test.ts`
Expected: PASS (3 test verdi).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/providers/registro-imprese
git commit -m "feat(registrazione): provider abstraction RegistroImprese con mock"
```

---

## Task 3: Helper puro di validazione documenti KYC

**Files:**
- Create: `apps/piattaforma/src/lib/auth/document-validation.ts`
- Test: `apps/piattaforma/src/lib/auth/document-validation.test.ts`

- [ ] **Step 1: Scrivi i test (FAIL atteso)**

Create `apps/piattaforma/src/lib/auth/document-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  validateVisuraData,
  validateRegistrationDocuments,
  type RegistrationDocInput,
} from './document-validation';

const NOW = new Date('2026-05-30T12:00:00Z');

const validDoc = (tipo: RegistrationDocInput['tipo']): RegistrationDocInput => ({
  tipo,
  mimeType: 'application/pdf',
  sizeBytes: 200 * 1024,
  originalFilename: `${tipo.toLowerCase()}.pdf`,
});

const allDocs = (): RegistrationDocInput[] => [
  validDoc('CI_FRONTE'),
  validDoc('CI_RETRO'),
  validDoc('CODICE_FISCALE'),
  validDoc('VISURA_CAMERALE'),
];

describe('validateVisuraData', () => {
  it('accetta una visura emessa ieri', () => {
    expect(validateVisuraData('2026-05-29', NOW)).toEqual({ ok: true });
  });

  it('accetta una visura emessa esattamente entro 6 mesi', () => {
    expect(validateVisuraData('2025-12-01', NOW)).toEqual({ ok: true });
  });

  it('rifiuta una visura più vecchia di 6 mesi', () => {
    const r = validateVisuraData('2025-10-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6 mesi');
  });

  it('rifiuta una data futura', () => {
    const r = validateVisuraData('2026-06-15', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('futura');
  });

  it('rifiuta una data non valida', () => {
    const r = validateVisuraData('non-una-data', NOW);
    expect(r.ok).toBe(false);
  });
});

describe('validateRegistrationDocuments', () => {
  it('passa con 4 documenti validi e visura recente', () => {
    expect(validateRegistrationDocuments(allDocs(), '2026-05-01', NOW)).toEqual({
      ok: true,
    });
  });

  it('fallisce se manca un documento richiesto', () => {
    const docs = allDocs().filter((d) => d.tipo !== 'CODICE_FISCALE');
    const r = validateRegistrationDocuments(docs, '2026-05-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
  });

  it('fallisce se un documento ha MIME non supportato', () => {
    const docs = allDocs();
    docs[0] = { ...docs[0]!, mimeType: 'application/zip' };
    const r = validateRegistrationDocuments(docs, '2026-05-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Formato');
  });

  it('fallisce se la visura è scaduta', () => {
    const r = validateRegistrationDocuments(allDocs(), '2025-01-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6 mesi');
  });
});
```

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/document-validation.test.ts`
Expected: FAIL — `Cannot find module './document-validation'`.

- [ ] **Step 2: Implementa l'helper**

Create `apps/piattaforma/src/lib/auth/document-validation.ts`:

```ts
import { classifyDocumento } from '@/lib/documenti/classifier';

export type RegistrationDocTipo =
  | 'CI_FRONTE'
  | 'CI_RETRO'
  | 'CODICE_FISCALE'
  | 'VISURA_CAMERALE';

export type RegistrationDocInput = {
  tipo: RegistrationDocTipo;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

export type DocValidationResult = { ok: true } | { ok: false; error: string };

export const REQUIRED_DOC_TIPI: readonly RegistrationDocTipo[] = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'VISURA_CAMERALE',
];

const VISURA_MAX_AGE_MONTHS = 6;

/** Valida la data di emissione della visura: non futura e non oltre 6 mesi. */
export function validateVisuraData(
  visuraData: string,
  now: Date = new Date(),
): DocValidationResult {
  const d = new Date(visuraData);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: 'Data della visura non valida' };
  }
  if (d.getTime() > now.getTime()) {
    return { ok: false, error: 'La data della visura non può essere futura' };
  }
  const limite = new Date(now);
  limite.setMonth(limite.getMonth() - VISURA_MAX_AGE_MONTHS);
  if (d.getTime() < limite.getTime()) {
    return {
      ok: false,
      error: 'La visura camerale deve essere emessa da non più di 6 mesi',
    };
  }
  return { ok: true };
}

/**
 * Valida i documenti KYC della registrazione: tutti presenti, ciascuno passa
 * il gating rule-based (MIME/dimensione/naming), visura entro 6 mesi.
 * A differenza delle pratiche (dove un FAILED viene comunque salvato), qui i
 * documenti sono obbligatori: il primo errore blocca la registrazione.
 */
export function validateRegistrationDocuments(
  docs: RegistrationDocInput[],
  visuraData: string,
  now: Date = new Date(),
): DocValidationResult {
  for (const tipo of REQUIRED_DOC_TIPI) {
    if (!docs.some((d) => d.tipo === tipo)) {
      return { ok: false, error: 'Carica tutti i documenti richiesti' };
    }
  }
  for (const doc of docs) {
    const r = classifyDocumento(doc);
    if (r.stato === 'FAILED') {
      return { ok: false, error: r.reason };
    }
  }
  return validateVisuraData(visuraData, now);
}
```

- [ ] **Step 3: Esegui i test (PASS atteso)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/document-validation.test.ts`
Expected: PASS (tutti i test verdi).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/lib/auth/document-validation.ts apps/piattaforma/src/lib/auth/document-validation.test.ts
git commit -m "feat(registrazione): helper validazione documenti KYC + visura 6 mesi"
```

---

## Task 4: Schema step 3 (visuraData)

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/schemas.ts:54-58`

- [ ] **Step 1: Sostituisci il placeholder `registerStep3DocumentsSchema`**

In `apps/piattaforma/src/lib/auth/schemas.ts`, sostituisci le righe 54-58:

```ts
// Step 3 (documenti): in Fase 3 quando lo storage e' pronto.
// Per ora il wizard salta questo step (placeholder UI).
export const registerStep3DocumentsSchema = z.object({
  documentiCaricatiPlaceholder: z.boolean().default(false),
});
```

con:

```ts
// Step 3 (documenti KYC): i file (CI fronte/retro, CF, visura) sono gestiti
// fuori da Zod (FormData) perché File non è serializzabile/validabile qui.
// Lo schema valida solo la data di emissione della visura camerale.
export const registerStep3DocumentsSchema = z.object({
  visuraData: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data di emissione della visura obbligatoria'),
});

export type RegisterStep3DocumentsInput = z.infer<typeof registerStep3DocumentsSchema>;
```

- [ ] **Step 2: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore (lo schema non è ancora referenziato altrove; `registerFullSchema` resta invariato).

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/lib/auth/schemas.ts
git commit -m "feat(registrazione): schema step3 documenti (visuraData)"
```

---

## Task 5: `registerAction` — firma FormData + persistenza documenti

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts:96-262` (firma e corpo di `registerAction`, + import)
- Test: `apps/piattaforma/src/app/(auth)/actions.test.ts` (nuovo)

- [ ] **Step 1: Aggiorna gli import in `actions.ts`**

In testa a `apps/piattaforma/src/app/(auth)/actions.ts`, aggiungi dopo gli import esistenti (dopo riga 20):

```ts
import { randomUUID } from 'node:crypto';
import { getStorage } from '@/lib/providers/storage';
import { getRegistroImprese } from '@/lib/providers/registro-imprese';
import {
  validateRegistrationDocuments,
  type RegistrationDocInput,
} from '@/lib/auth/document-validation';
```

- [ ] **Step 2: Aggiungi le costanti file in cima alla sezione REGISTER**

In `actions.ts`, subito dopo il commento `// REGISTER` (riga ~83, prima di `RegisterActionResult`), aggiungi:

```ts
const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB

// Slot file attesi nel FormData del wizard (step 3). chiave === DocumentoTipo.
const REGISTRATION_DOC_SLOTS = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'VISURA_CAMERALE',
] as const;
```

- [ ] **Step 3: Riscrivi la firma e il preambolo di `registerAction`**

Sostituisci la firma e il parsing iniziale (righe 96-109, da `export async function registerAction(` fino a `const { account, company, payment } = parsed.data;` incluso) con:

```ts
export async function registerAction(
  formData: FormData,
): Promise<RegisterActionResult> {
  // 1. Parse del payload strutturato (account/company/payment/referral/visura).
  const payloadRaw = formData.get('payload');
  if (typeof payloadRaw !== 'string') {
    return { ok: false, error: 'Dati di registrazione mancanti' };
  }
  let payloadObj: unknown;
  try {
    payloadObj = JSON.parse(payloadRaw);
  } catch {
    return { ok: false, error: 'Dati di registrazione non validi' };
  }

  const parsed = registerFullSchema.safeParse(payloadObj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? 'Dati non validi',
      field: first?.path.join('.'),
    };
  }

  const visuraData =
    typeof (payloadObj as { visuraData?: unknown }).visuraData === 'string'
      ? (payloadObj as { visuraData: string }).visuraData
      : '';
  const refCodeFromPayload =
    typeof (payloadObj as { referralCode?: unknown }).referralCode === 'string'
      ? (payloadObj as { referralCode: string }).referralCode
      : undefined;

  // 2. Estrai i 4 file obbligatori dal FormData.
  const docFiles: { tipo: (typeof REGISTRATION_DOC_SLOTS)[number]; file: File }[] = [];
  for (const slot of REGISTRATION_DOC_SLOTS) {
    const f = formData.get(slot);
    if (!(f instanceof File) || f.size === 0) {
      return { ok: false, error: 'Carica tutti i documenti richiesti' };
    }
    if (f.size > MAX_DOC_BYTES) {
      return { ok: false, error: 'Un documento supera il limite di 10 MB' };
    }
    docFiles.push({ tipo: slot, file: f });
  }

  // 3. Validazione documenti (gating rule-based + visura ≤ 6 mesi). Bloccante.
  const docInputs: RegistrationDocInput[] = docFiles.map(({ tipo, file }) => ({
    tipo,
    mimeType: file.type,
    sizeBytes: file.size,
    originalFilename: file.name,
  }));
  const docCheck = validateRegistrationDocuments(docInputs, visuraData);
  if (!docCheck.ok) {
    return { ok: false, error: docCheck.error };
  }

  const { account, company, payment } = parsed.data;
```

- [ ] **Step 4: Aggiorna il riferimento al referral code**

Subito sotto, sostituisci la riga:

```ts
  const refCodeInput = input.referralCode?.trim().toLowerCase();
```

con:

```ts
  const refCodeInput = refCodeFromPayload?.trim().toLowerCase();
```

- [ ] **Step 5: Pre-genera gli id, carica i file e crea i Documento nella transaction**

Sostituisci il blocco da `const passwordHash = await hashPassword(account.password);` fino alla fine della `prisma.$transaction(async (tx) => { ... })` (righe ~149-220), con la versione che pre-genera gli id, carica i file su storage **prima** della transaction e crea i `Documento` **dentro** la transaction. Concretamente:

1. Subito dopo `const signupIp = anonymizeIp(signupIpRaw);` aggiungi:

```ts
    // Pre-generiamo gli id così lo scope storage coincide col companyId e i
    // Documento possono referenziare l'uploader (User) nella stessa transaction.
    const companyId = randomUUID();
    const userId = randomUUID();

    // Upload dei file su storage PRIMA della transaction (filesystem/S3 sono
    // fuori dalla transaction DB). Se un put fallisce l'eccezione interrompe
    // tutto: nessun record creato. In caso di fallimento della transaction
    // restano al massimo file orfani su storage (raro, ripulibili).
    const storage = getStorage();
    const storedDocs = await Promise.all(
      docFiles.map(async ({ tipo, file }) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const put = await storage.put({
          scope: `company/${companyId}`,
          buffer,
          originalFilename: file.name,
          mimeType: file.type,
        });
        return { tipo, put };
      }),
    );
```

2. Nella `tx.company.create`, aggiungi `id: companyId,` come prima proprietà di `data` e aggiungi `visuraCameraleData: new Date(visuraData),` tra gli altri campi.

3. Nella `tx.user.create`, aggiungi `id: userId,` come prima proprietà di `data`.

4. Subito dopo `tx.verificationToken.create({ ... })` e prima di `createdCompanyId = createdCompany.id;`, inserisci la creazione dei documenti:

```ts
      for (const { tipo, put } of storedDocs) {
        await tx.documento.create({
          data: {
            tipo,
            companyId,
            storageKey: put.storageKey,
            storageProvider: put.storageProvider,
            mimeType: put.mimeType,
            sizeBytes: put.sizeBytes,
            originalFilename: put.originalFilename,
            uploadedById: userId,
            ocrStato: 'NONE',
            gatingStato: 'PASSED',
          },
        });
      }
```

5. Sostituisci `createdCompanyId = createdCompany.id;` con `createdCompanyId = companyId;`.

- [ ] **Step 6: Aggiungi la chiamata best-effort al Registro Imprese**

Subito dopo il blocco `if (createdCompanyId) { void tryMatchCrmContact(...); void notifyReferralSignup(...); }` (riga ~225-230), aggiungi:

```ts
    // RegistroImprese (predisposizione swap): lookup best-effort non bloccante.
    // Col provider mock è di fatto un no-op informativo; quando l'account
    // esterno sarà attivo qui si potrà validare/arricchire i dati azienda.
    void Promise.resolve()
      .then(() => getRegistroImprese().lookupByPiva({ partitaIva: company.partitaIva }))
      .then((reg) => {
        if (reg) console.info('[registro-imprese] lookup', reg.partitaIva, reg.statoAttivita);
      })
      .catch((e) => console.warn('[registro-imprese] lookup fallito', e));
```

- [ ] **Step 7: Scrivi i test delle early-return (FAIL atteso)**

Create `apps/piattaforma/src/app/(auth)/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock di tutte le dipendenze server-side: se la validazione fallisce in
// anticipo, nessuna di queste deve essere raggiunta.
const txMock = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: { $transaction: txMock, company: {}, user: {}, verificationToken: {} },
  Prisma: { PrismaClientKnownRequestError: class {} },
}));
vi.mock('@/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/env', () => ({ env: { DEMO_MODE: true } }));
vi.mock('next/headers', () => ({ headers: async () => new Map() }));
vi.mock('@/lib/crm/sync', () => ({ tryMatchCrmContact: vi.fn() }));
vi.mock('@/lib/affiliazione/notifications', () => ({ notifyReferralSignup: vi.fn() }));
vi.mock('@/lib/providers/storage', () => ({ getStorage: vi.fn() }));
vi.mock('@/lib/providers/registro-imprese', () => ({ getRegistroImprese: vi.fn() }));

import { registerAction } from './actions';

const validPayload = {
  account: {
    email: 'mario@example.com',
    password: 'Password123',
    passwordConfirm: 'Password123',
    nome: 'Mario',
    cognome: 'Rossi',
    codiceFiscale: 'RSSMRA80A01H501U',
    dataNascita: '1980-01-01',
    luogoNascita: 'Roma',
  },
  company: {
    type: 'DEALER',
    ragioneSociale: 'Rossi Auto',
    partitaIva: '12345678901',
    pec: 'rossi@pec.it',
    email: 'info@rossi.it',
    indirizzo: 'Via Roma 1',
    citta: 'Roma',
    cap: '00100',
    provincia: 'RM',
  },
  payment: { iban: 'IT60X0542811101000000123456', sepaMandateAccepted: true, termsAccepted: true },
  visuraData: '2026-05-01',
};

function makeFile(): File {
  return new File([new Uint8Array(200 * 1024)], 'doc.pdf', { type: 'application/pdf' });
}

function fdWith(payload: unknown, opts: { omit?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('payload', JSON.stringify(payload));
  for (const slot of ['CI_FRONTE', 'CI_RETRO', 'CODICE_FISCALE', 'VISURA_CAMERALE']) {
    if (opts.omit === slot) continue;
    fd.set(slot, makeFile());
  }
  return fd;
}

describe('registerAction (early returns)', () => {
  beforeEach(() => txMock.mockReset());

  it('fallisce se manca il payload', async () => {
    const r = await registerAction(new FormData());
    expect(r.ok).toBe(false);
    expect(txMock).not.toHaveBeenCalled();
  });

  it('fallisce se manca un documento', async () => {
    const r = await registerAction(fdWith(validPayload, { omit: 'CODICE_FISCALE' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
    expect(txMock).not.toHaveBeenCalled();
  });

  it('fallisce se la visura è scaduta (> 6 mesi)', async () => {
    const r = await registerAction(fdWith({ ...validPayload, visuraData: '2020-01-01' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6 mesi');
    expect(txMock).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter piattaforma exec vitest run "src/app/(auth)/actions.test.ts"`
Expected: FAIL inizialmente se la firma non è ancora `FormData` (errore di tipo/runtime). Dopo gli step 1-6 deve diventare PASS.

- [ ] **Step 8: Esegui test + typecheck (PASS atteso)**

Run: `pnpm --filter piattaforma exec vitest run "src/app/(auth)/actions.test.ts" && pnpm --filter piattaforma typecheck`
Expected: 3 test verdi, nessun errore di tipo. Se `txMock` risulta chiamato, significa che una early-return manca: rivedi gli step 3.

- [ ] **Step 9: Commit**

```bash
git add "apps/piattaforma/src/app/(auth)/actions.ts" "apps/piattaforma/src/app/(auth)/actions.test.ts"
git commit -m "feat(registrazione): registerAction accetta FormData e persiste documenti KYC"
```

---

## Task 6: Wizard — `DocumentsStep` reale + stato + submit FormData

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`

- [ ] **Step 1: Aggiorna import e tipi del wizard**

In `register-wizard.tsx`, aggiorna l'import di React (riga 3) aggiungendo il tipo `FormEvent`:

```ts
import { useState, useTransition, type FormEvent } from 'react';
```

e aggiungi agli import (dopo riga 13):

```ts
import { validateRegistrationDocuments } from '@/lib/auth/document-validation';
```

Dopo i type alias `PaymentData` (riga 20), aggiungi:

```ts
type DocumentsData = {
  ciFronte: File;
  ciRetro: File;
  codiceFiscale: File;
  visuraCamerale: File;
  visuraData: string; // ISO yyyy-mm-dd
};
```

Aggiorna `WizardData` (righe 22-26) aggiungendo `documents?: DocumentsData;`.

- [ ] **Step 2: Sostituisci `handleDocumentsSkip` e `handlePayment`**

Sostituisci `const handleDocumentsSkip = () => setStep(4);` (riga 67) con:

```ts
  const handleDocuments = (values: DocumentsData) => {
    setData((d) => ({ ...d, documents: values }));
    setStep(4);
  };
```

Sostituisci l'intero corpo di `handlePayment` (righe 69-92) con:

```ts
  const handlePayment = (values: PaymentData) => {
    setData((d) => ({ ...d, payment: values }));
    if (!data.account || !data.company || !data.documents) {
      setSubmitError('Dati mancanti, ricomincia il wizard');
      setStep(1);
      return;
    }

    setSubmitError(null);
    const docs = data.documents;
    startTransition(async () => {
      const fd = new FormData();
      fd.set(
        'payload',
        JSON.stringify({
          account: data.account,
          company: data.company,
          payment: values,
          referralCode,
          visuraData: docs.visuraData,
        }),
      );
      fd.set('CI_FRONTE', docs.ciFronte);
      fd.set('CI_RETRO', docs.ciRetro);
      fd.set('CODICE_FISCALE', docs.codiceFiscale);
      fd.set('VISURA_CAMERALE', docs.visuraCamerale);

      const result = await registerAction(fd);

      if (result.ok) {
        setToken(result.emailVerificationToken);
      } else {
        setSubmitError(result.error);
      }
    });
  };
```

- [ ] **Step 3: Aggiorna il render dello step 3**

Sostituisci il blocco render dello step 3 (righe 144-146):

```tsx
          {step === 3 && (
            <DocumentsStep onBack={() => setStep(2)} onNext={handleDocumentsSkip} />
          )}
```

con:

```tsx
          {step === 3 && (
            <DocumentsStep
              defaultValues={data.documents}
              onBack={() => setStep(2)}
              onNext={handleDocuments}
            />
          )}
```

- [ ] **Step 4: Sostituisci il componente `DocumentsStep` placeholder**

Sostituisci l'intero componente `DocumentsStep` (righe 333-355, dal commento `// STEP 3 - DOCUMENTI` fino alla chiusura della funzione) con:

```tsx
// ============================================================
// STEP 3 - DOCUMENTI KYC
// ============================================================

const ACCEPT = 'application/pdf,image/jpeg,image/png';

function DocFileInput({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <Field label={label} required>
      <input
        type="file"
        accept={ACCEPT}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-pv-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-pv-navy-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-pv-navy-700"
      />
      {file && (
        <p className="mt-1 text-xs text-pv-slate-500">
          {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
        </p>
      )}
    </Field>
  );
}

function DocumentsStep({
  defaultValues,
  onBack,
  onNext,
}: {
  defaultValues?: DocumentsData;
  onBack: () => void;
  onNext: (data: DocumentsData) => void;
}) {
  const [ciFronte, setCiFronte] = useState<File | null>(defaultValues?.ciFronte ?? null);
  const [ciRetro, setCiRetro] = useState<File | null>(defaultValues?.ciRetro ?? null);
  const [codiceFiscale, setCodiceFiscale] = useState<File | null>(
    defaultValues?.codiceFiscale ?? null,
  );
  const [visuraCamerale, setVisuraCamerale] = useState<File | null>(
    defaultValues?.visuraCamerale ?? null,
  );
  const [visuraData, setVisuraData] = useState<string>(defaultValues?.visuraData ?? '');
  const [error, setError] = useState<string | null>(null);

  const allFiles = ciFronte && ciRetro && codiceFiscale && visuraCamerale;

  // Validazione live per abilitare "Avanti" (stessa logica del server).
  const validation =
    allFiles && visuraData
      ? validateRegistrationDocuments(
          [
            { tipo: 'CI_FRONTE', mimeType: ciFronte.type, sizeBytes: ciFronte.size, originalFilename: ciFronte.name },
            { tipo: 'CI_RETRO', mimeType: ciRetro.type, sizeBytes: ciRetro.size, originalFilename: ciRetro.name },
            { tipo: 'CODICE_FISCALE', mimeType: codiceFiscale.type, sizeBytes: codiceFiscale.size, originalFilename: codiceFiscale.name },
            { tipo: 'VISURA_CAMERALE', mimeType: visuraCamerale.type, sizeBytes: visuraCamerale.size, originalFilename: visuraCamerale.name },
          ],
          visuraData,
        )
      : { ok: false as const, error: 'Carica tutti i documenti e indica la data della visura' };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    onNext({
      ciFronte: ciFronte!,
      ciRetro: ciRetro!,
      codiceFiscale: codiceFiscale!,
      visuraCamerale: visuraCamerale!,
      visuraData,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Alert variant="info">
        Carica i documenti KYC dell&apos;amministratore e dell&apos;azienda. Formati
        ammessi: PDF, JPG, PNG (max 10 MB per file).
      </Alert>

      <DocFileInput label="Carta d'identità — Fronte" file={ciFronte} onChange={setCiFronte} />
      <DocFileInput label="Carta d'identità — Retro" file={ciRetro} onChange={setCiRetro} />
      <DocFileInput
        label="Codice Fiscale / Tessera Sanitaria"
        file={codiceFiscale}
        onChange={setCodiceFiscale}
      />
      <DocFileInput label="Visura Camerale" file={visuraCamerale} onChange={setVisuraCamerale} />

      <Field label="Data emissione visura" required>
        <Input
          type="date"
          value={visuraData}
          onChange={(e) => setVisuraData(e.target.value)}
        />
      </Field>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto">
          Indietro
        </Button>
        <Button type="submit" disabled={!validation.ok} className="sm:flex-1">
          Avanti
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Verifica typecheck + lint (PASS atteso)**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: nessun errore. Attenzione a `react/no-unescaped-entities` (usa `&apos;` per gli apostrofi, già fatto nel codice sopra).

- [ ] **Step 6: Build di produzione (PASS atteso)**

Run: `pnpm --filter piattaforma build`
Expected: build completata senza errori (verifica che il server action `registerAction(formData)` sia compatibile col call site del wizard).

- [ ] **Step 7: Commit**

```bash
git add "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx"
git commit -m "feat(registrazione): step 3 documenti KYC reale + submit FormData"
```

---

## Task 7: Verifica finale + aggiornamento roadmap

**Files:**
- Modify: `docs/piano-implementazione.md:192-193`

- [ ] **Step 1: Esegui l'intera suite di test dell'app**

Run: `pnpm --filter piattaforma test`
Expected: tutti i test verdi, inclusi i nuovi (`registro-imprese/mock`, `document-validation`, `actions`).

- [ ] **Step 2: Typecheck + lint + build complessivi**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && pnpm --filter piattaforma build`
Expected: nessun errore.

- [ ] **Step 3: Aggiorna la roadmap (source of truth)**

In `docs/piano-implementazione.md`, righe 192-193, spunta gli item completati:

```markdown
- [x] Upload CI + CF amministratore (attivato in Fase 3 con storage — step 3 registrazione)
- [x] Upload Visura Camerale (max 6 mesi) — campo data + validazione + storage
```

- [ ] **Step 4: Verifica manuale del flusso (smoke locale)**

Avvia l'app (`pnpm --filter piattaforma dev`), vai su `/register/dealer`, completa step 1-2, allo step 3 verifica:
- "Avanti" disabilitato finché mancano file o data visura;
- caricando un file non-PDF/JPG/PNG → errore al submit;
- data visura > 6 mesi → errore;
- con 4 file validi + data recente → avanza a step 4 e completa la registrazione (in DEMO_MODE compare il banner col token); in DB la Company ha `visuraCameraleData` e 4 record `Documento` con `companyId` e `gatingStato = PASSED`.

- [ ] **Step 5: Commit**

```bash
git add docs/piano-implementazione.md
git commit -m "docs(roadmap): step 3 registrazione documenti KYC completato"
```

---

## Note di esecuzione

- **OCR**: ribadito — nessun OCR reale su questi documenti. `extractLibretto` (Mindee European Vehicle Registration) non sa leggere CI/CF/visura. Si usa solo il gating rule-based.
- **Ordine dei task**: 1→7 in sequenza. I task 2, 3, 4 sono indipendenti tra loro e potrebbero essere parallelizzati, ma il task 5 dipende da 1+2+3 e il task 6 da 3+5.
- **E2E**: il test E2E completo della registrazione (Playwright) con fixtures DB è prassi end-of-phase (richiede teardown DB); non incluso qui se non come smoke manuale (Task 7 Step 4).
- **Fuori scope** (follow-up): integrazione reale provider `openapi`/`infocamere`, validazione IA documenti d'identità (Document AI), UI admin di review documenti azienda.
```
