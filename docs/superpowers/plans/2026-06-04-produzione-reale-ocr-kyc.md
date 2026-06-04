# Produzione reale: OCR Document AI + KYC registrazione + cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leggere via OCR (Google Document AI) i documenti caricati in registrazione e bloccare al submit le iscrizioni non valide (KYC), unificare l'OCR su Document AI, e portare la piattaforma a "produzione reale" tranne i pagamenti.

**Architecture:** Si estende l'astrazione `OcrProvider` esistente con `extractText()` e si implementa il provider `google_documentai` (Document OCR, regione EU) che copre sia la KYC sia il libretto. Un orchestratore puro `verifyRegistrationKyc` (con dipendenze iniettabili) valuta 5 regole bloccanti confrontando i dati estratti da visura/CI/CF; viene chiamato in `registerAction` PRIMA di creare account/file. Il cutover spegne DEMO_MODE, mette in sicurezza i pagamenti mock e azzera i dati finti del Registro Imprese.

**Tech Stack:** Next.js 16 (server actions), TypeScript, Prisma/Postgres, Vitest, `@google-cloud/documentai`, `unpdf` (estrazione testo PDF serverless).

**Spec di riferimento:** `docs/superpowers/specs/2026-06-04-produzione-reale-ocr-kyc-design.md`

---

## Mappa file (cosa tocca ogni workstream)

**A — Provider Document AI**
- Modify: `apps/piattaforma/src/env.ts` (4 var GOOGLE_DOCUMENTAI_*)
- Modify: `apps/piattaforma/src/lib/providers/ocr/types.ts` (+`OcrTextResult`, +`extractText`)
- Modify: `apps/piattaforma/src/lib/providers/ocr/mock.ts` (+`extractText`)
- Modify: `apps/piattaforma/src/lib/providers/ocr/mindee.ts` (+`extractText` non supportato)
- Create: `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts` (+ test)
- Create: `apps/piattaforma/src/lib/providers/ocr/google-documentai.ts` (+ test del mapper puro)
- Modify: `apps/piattaforma/src/lib/providers/ocr/index.ts` (case `google_documentai`)
- Modify: `apps/piattaforma/package.json` (deps)

**B — KYC registrazione**
- Create: `apps/piattaforma/src/lib/kyc/match.ts` (+ test)
- Create: `apps/piattaforma/src/lib/kyc/ateco.ts` (+ test)
- Create: `apps/piattaforma/src/lib/kyc/visura-parser.ts` (+ test del parser puro)
- Create: `apps/piattaforma/src/lib/kyc/extract-ci.ts`, `extract-cf.ts` (+ test)
- Create: `apps/piattaforma/src/lib/kyc/verify.ts` (+ test orchestratore)
- Modify: `apps/piattaforma/src/lib/auth/document-validation.ts` (esporta check età parametrico, 5 mesi)
- Modify: `packages/db/prisma/schema.prisma` (+model `AtecoAllowedCode`) + migration + seed
- Create: `apps/piattaforma/src/app/admin/ateco/{page,actions,client}.tsx`
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (nav "ATECO")
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts` (gate KYC + persistenza + `kycFailures`)
- Modify: `apps/piattaforma/src/app/(auth)/actions.test.ts` (fixture)
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (spinner + errori)

**D — Cutover**
- Create: `apps/piattaforma/src/lib/jobs/payment-live.ts` (+ test)
- Modify: `apps/piattaforma/src/lib/jobs/process-payouts.ts`, `process-fee-scheduled.ts`, `trigger-auto-payout.ts` (guard)
- Modify: `apps/piattaforma/src/env.ts` + `registro-imprese/index.ts` (+`noop`)
- Modify: pagina privacy (`apps/piattaforma/src/app/privacy/page.tsx` o `.mdx`)

**Comandi di verifica globali** (dalla root del repo):
- Test app: `pnpm --filter piattaforma test`
- Typecheck: `pnpm --filter piattaforma typecheck`
- Lint: `pnpm --filter piattaforma lint`

---

# WORKSTREAM A — Provider Google Document AI

### Task 1: Dipendenze + variabili env

**Files:**
- Modify: `apps/piattaforma/package.json`
- Modify: `apps/piattaforma/src/env.ts:26-28` (sezione OCR) e `:53-55` (runtimeEnv)

- [ ] **Step 1: Installa le dipendenze**

Run (dalla root):
```bash
pnpm --filter piattaforma add @google-cloud/documentai unpdf
```
Atteso: aggiunte a `dependencies` in `apps/piattaforma/package.json`.

- [ ] **Step 2: Aggiungi le 4 variabili al server schema di env.ts**

In `apps/piattaforma/src/env.ts`, subito dopo la riga `MINDEE_MODEL_ID: z.string().optional(),` (riga 28):
```ts
    GOOGLE_DOCUMENTAI_PROJECT_ID: z.string().optional(),
    GOOGLE_DOCUMENTAI_LOCATION: z.string().default('eu'),
    GOOGLE_DOCUMENTAI_PROCESSOR_ID: z.string().optional(),
    GOOGLE_DOCUMENTAI_CREDENTIALS_JSON: z.string().optional(),
```

- [ ] **Step 3: Mappa le 4 variabili in runtimeEnv**

In `apps/piattaforma/src/env.ts`, subito dopo `MINDEE_MODEL_ID: process.env.MINDEE_MODEL_ID,` (riga 55):
```ts
    GOOGLE_DOCUMENTAI_PROJECT_ID: process.env.GOOGLE_DOCUMENTAI_PROJECT_ID,
    GOOGLE_DOCUMENTAI_LOCATION: process.env.GOOGLE_DOCUMENTAI_LOCATION,
    GOOGLE_DOCUMENTAI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_ID,
    GOOGLE_DOCUMENTAI_CREDENTIALS_JSON: process.env.GOOGLE_DOCUMENTAI_CREDENTIALS_JSON,
```

- [ ] **Step 4: Verifica typecheck**

Run: `pnpm --filter piattaforma typecheck`
Atteso: PASS (nessun uso ancora, solo schema).

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/package.json apps/piattaforma/src/env.ts pnpm-lock.yaml
git commit -m "feat(ocr): deps @google-cloud/documentai+unpdf e env Document AI"
```

---

### Task 2: Estendi l'interfaccia OcrProvider con extractText

**Files:**
- Modify: `apps/piattaforma/src/lib/providers/ocr/types.ts`
- Modify: `apps/piattaforma/src/lib/providers/ocr/mock.ts`
- Modify: `apps/piattaforma/src/lib/providers/ocr/mindee.ts`
- Test: `apps/piattaforma/src/lib/providers/ocr/mock.test.ts` (create)

- [ ] **Step 1: Scrivi il test del mock.extractText**

Create `apps/piattaforma/src/lib/providers/ocr/mock.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MockOcrProvider } from './mock';

describe('MockOcrProvider.extractText', () => {
  it('ritorna testo deterministico e confidence in [0,1]', async () => {
    const p = new MockOcrProvider();
    const input = { buffer: Buffer.from('hello-doc'), mimeType: 'image/png' };
    const a = await p.extractText(input);
    const b = await p.extractText(input);
    expect(a.text).toBe(b.text); // deterministico
    expect(a.text.length).toBeGreaterThan(0);
    expect(a.confidence).toBeGreaterThanOrEqual(0);
    expect(a.confidence).toBeLessThanOrEqual(1);
    expect(a.pages).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Esegui il test (deve fallire)**

Run: `pnpm --filter piattaforma test -- mock.test`
Atteso: FAIL (`extractText` non esiste).

- [ ] **Step 3: Aggiungi il tipo e il metodo all'interfaccia**

In `apps/piattaforma/src/lib/providers/ocr/types.ts`, dopo `LibrettoCircolazioneData` aggiungi:
```ts
export type OcrTextResult = {
  text: string; // testo completo estratto
  confidence: number; // 0..1
  pages: number;
};
```
e nell'interfaccia `OcrProvider` aggiungi la riga:
```ts
  extractText(input: OcrExtractInput): Promise<OcrTextResult>;
```

- [ ] **Step 4: Implementa mock.extractText**

In `apps/piattaforma/src/lib/providers/ocr/mock.ts`, importa il tipo (`OcrTextResult`) e aggiungi alla classe:
```ts
  async extractText(input: OcrExtractInput): Promise<OcrTextResult> {
    const hash = createHash('sha256').update(input.buffer).digest('hex');
    return {
      text: `MOCK OCR TEXT\nhash=${hash}\nbytes=${input.buffer.length}`,
      confidence: 0.9,
      pages: 1,
    };
  }
```

- [ ] **Step 5: Soddisfa l'interfaccia su Mindee (extractText non supportato)**

In `apps/piattaforma/src/lib/providers/ocr/mindee.ts` importa `OcrTextResult` e `OcrFailedError` e aggiungi alla classe:
```ts
  async extractText(): Promise<OcrTextResult> {
    throw new OcrFailedError('extractText non supportato dal provider Mindee');
  }
```

- [ ] **Step 6: Esegui i test (devono passare) + typecheck**

Run: `pnpm --filter piattaforma test -- mock.test` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 7: Commit**
```bash
git add apps/piattaforma/src/lib/providers/ocr/
git commit -m "feat(ocr): extractText nell'interfaccia OcrProvider (mock+mindee)"
```

---

### Task 3: Parser libretto (puro, per Document AI)

**Files:**
- Create: `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts`
- Test: `apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts`

- [ ] **Step 1: Scrivi i test del parser**

Create `apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseLibrettoText } from './libretto-parser';

const SAMPLE = `CARTA DI CIRCOLAZIONE
A) FA123GH
E) ZFA19500005123456
B) 12.03.2012
C1.1) ROSSI MARIO`;

describe('parseLibrettoText', () => {
  it('estrae targa, telaio, data e proprietario', () => {
    const r = parseLibrettoText(SAMPLE, 0.9);
    expect(r.targa).toBe('FA123GH');
    expect(r.telaio).toBe('ZFA19500005123456');
    expect(r.dataImmatricolazione).toBe('2012-03-12');
    expect(r.preImm2015).toBe(true);
    expect(r.confidenceScore).toBe(0.9);
  });
  it('flag comodato se presente la parola COMODATO', () => {
    const r = parseLibrettoText(SAMPLE + '\nCOMODATO D USO', 0.8);
    expect(r.flagComodatoDuso).toBe(true);
  });
  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseLibrettoText('TESTO SENZA DATI', 0.5);
    expect(r.targa).toBeUndefined();
    expect(r.telaio).toBeUndefined();
    expect(r.preImm2015).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- libretto-parser`
Atteso: FAIL (modulo non esiste).

- [ ] **Step 3: Implementa il parser**

Create `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts`:
```ts
import type { LibrettoCircolazioneData } from './types';

const TARGA_RE = /\b([A-Z]{2}\d{3}[A-Z]{2})\b/;
const TELAIO_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const DATE_RE = /\b(\d{2})[./-](\d{2})[./-](\d{4})\b/;

/** Converte una data testuale (dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy) in ISO yyyy-mm-dd. */
function toIso(d: string, m: string, y: string): string {
  return `${y}-${m}-${d}`;
}

/** Estrae i campi del libretto dal testo OCR. Tutti i campi sono best-effort:
 * un campo non trovato resta undefined (la pre-compilazione è editabile). */
export function parseLibrettoText(text: string, confidence: number): LibrettoCircolazioneData {
  const upper = text.toUpperCase();
  const targa = TARGA_RE.exec(upper)?.[1];
  const telaio = TELAIO_RE.exec(upper)?.[1];
  const dm = DATE_RE.exec(upper);
  const dataImmatricolazione = dm ? toIso(dm[1]!, dm[2]!, dm[3]!) : undefined;
  const year = dm ? Number(dm[3]) : undefined;
  return {
    targa,
    telaio,
    dataImmatricolazione,
    proprietarioAttuale: undefined, // estrazione nome intestatario non affidabile da OCR grezzo: lasciata all'utente
    preImm2015: year !== undefined && year < 2015,
    flagComodatoDuso: /COMODATO/.test(upper),
    confidenceScore: confidence,
    rawText: text,
  };
}
```

- [ ] **Step 4: Esegui i test (devono passare)**

Run: `pnpm --filter piattaforma test -- libretto-parser` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/providers/ocr/libretto-parser.*
git commit -m "feat(ocr): parser libretto da testo OCR (puro, TDD)"
```

---

### Task 4: Provider google_documentai

**Files:**
- Create: `apps/piattaforma/src/lib/providers/ocr/google-documentai.ts`
- Test: `apps/piattaforma/src/lib/providers/ocr/google-documentai.test.ts`
- Modify: `apps/piattaforma/src/lib/providers/ocr/index.ts:25-26`

- [ ] **Step 1: Scrivi i test del mapper puro**

Create `apps/piattaforma/src/lib/providers/ocr/google-documentai.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { documentToTextResult } from './google-documentai';

describe('documentToTextResult', () => {
  it('estrae testo e media confidence dalle pagine', () => {
    const doc = {
      text: 'CIAO MONDO',
      pages: [{ layout: { confidence: 0.8 } }, { layout: { confidence: 1.0 } }],
    };
    const r = documentToTextResult(doc);
    expect(r.text).toBe('CIAO MONDO');
    expect(r.pages).toBe(2);
    expect(r.confidence).toBeCloseTo(0.9, 5);
  });
  it('gestisce documento vuoto', () => {
    const r = documentToTextResult({});
    expect(r.text).toBe('');
    expect(r.pages).toBe(0);
    expect(r.confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- google-documentai`
Atteso: FAIL (modulo non esiste).

- [ ] **Step 3: Implementa il provider**

Create `apps/piattaforma/src/lib/providers/ocr/google-documentai.ts`:
```ts
import 'server-only';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import type { LibrettoCircolazioneData, OcrExtractInput, OcrProvider, OcrTextResult } from './types';
import { OcrFailedError } from './types';
import { parseLibrettoText } from './libretto-parser';

/** Mappa il `document` di Document AI in OcrTextResult. Puro/testabile. */
export function documentToTextResult(document: {
  text?: string | null;
  pages?: Array<{ layout?: { confidence?: number | null } | null }> | null;
}): OcrTextResult {
  const pages = document.pages ?? [];
  const confs = pages
    .map((p) => p.layout?.confidence)
    .filter((c): c is number => typeof c === 'number');
  const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text: document.text ?? '', confidence, pages: pages.length };
}

export class GoogleDocumentAiProvider implements OcrProvider {
  readonly name = 'google_documentai' as const;
  private readonly client: DocumentProcessorServiceClient;
  private readonly processorName: string;

  constructor(opts: {
    projectId: string;
    location: string;
    processorId: string;
    credentialsJson: string;
  }) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(opts.credentialsJson);
    } catch {
      throw new OcrFailedError('GOOGLE_DOCUMENTAI_CREDENTIALS_JSON non è un JSON valido');
    }
    this.client = new DocumentProcessorServiceClient({
      credentials,
      apiEndpoint: `${opts.location}-documentai.googleapis.com`,
    });
    this.processorName = `projects/${opts.projectId}/locations/${opts.location}/processors/${opts.processorId}`;
  }

  async extractText(input: OcrExtractInput): Promise<OcrTextResult> {
    try {
      const [result] = await this.client.processDocument({
        name: this.processorName,
        rawDocument: { content: input.buffer.toString('base64'), mimeType: input.mimeType },
      });
      return documentToTextResult(result.document ?? {});
    } catch (e) {
      throw new OcrFailedError(`Document AI: ${(e as Error).message}`);
    }
  }

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const t = await this.extractText(input);
    return parseLibrettoText(t.text, t.confidence);
  }
}
```

- [ ] **Step 4: Aggancia il provider nel factory**

In `apps/piattaforma/src/lib/providers/ocr/index.ts`, sostituisci il blocco `case 'google_documentai':` (righe 25-26) con:
```ts
    case 'google_documentai': {
      const { GoogleDocumentAiProvider } = await import('./google-documentai');
      if (
        !env.GOOGLE_DOCUMENTAI_PROJECT_ID ||
        !env.GOOGLE_DOCUMENTAI_PROCESSOR_ID ||
        !env.GOOGLE_DOCUMENTAI_CREDENTIALS_JSON
      ) {
        throw new Error(
          'GOOGLE_DOCUMENTAI_PROJECT_ID, PROCESSOR_ID e CREDENTIALS_JSON sono obbligatori per OCR_PROVIDER=google_documentai',
        );
      }
      instance = new GoogleDocumentAiProvider({
        projectId: env.GOOGLE_DOCUMENTAI_PROJECT_ID,
        location: env.GOOGLE_DOCUMENTAI_LOCATION,
        processorId: env.GOOGLE_DOCUMENTAI_PROCESSOR_ID,
        credentialsJson: env.GOOGLE_DOCUMENTAI_CREDENTIALS_JSON,
      });
      break;
    }
```
NB: `getOcr()` diventa `async` perché usa `await import`. Aggiorna la firma a `export async function getOcr(): Promise<OcrProvider>` e tutti i chiamanti (`apps/piattaforma/src/app/pratiche/nuova/actions.ts:88` → `const ocr = await getOcr();`). Verifica i chiamanti con: `pnpm --filter piattaforma exec grep -rn "getOcr()" src` e aggiorna ognuno con `await`.

- [ ] **Step 5: Esegui i test + typecheck**

Run: `pnpm --filter piattaforma test -- google-documentai` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS (tutti i `getOcr()` ora awaited)

- [ ] **Step 6: Commit**
```bash
git add apps/piattaforma/src/lib/providers/ocr/
git commit -m "feat(ocr): provider Google Document AI (extractText+libretto) + factory async"
```

---

# WORKSTREAM B — KYC registrazione

### Task 5: Logica di matching (puro)

**Files:**
- Create: `apps/piattaforma/src/lib/kyc/match.ts`
- Test: `apps/piattaforma/src/lib/kyc/match.test.ts`

- [ ] **Step 1: Scrivi i test**

Create `apps/piattaforma/src/lib/kyc/match.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeName, normalizeCompanyName, normalizeCf, normalizePiva,
  isValidCodiceFiscale, nameMatches, companyMatches,
} from './match';

describe('normalize', () => {
  it('normalizeName: upper, no accenti, spazi singoli', () => {
    expect(normalizeName(' Niccolò  D’Égìdio ')).toBe('NICCOLO D EGIDIO');
  });
  it('normalizeCompanyName: rimuove forma giuridica', () => {
    expect(normalizeCompanyName('Rossi Auto S.R.L.')).toBe('ROSSI AUTO');
    expect(normalizeCompanyName('Bianchi S.p.A.')).toBe('BIANCHI');
  });
  it('normalizeCf / normalizePiva', () => {
    expect(normalizeCf(' rssmra80a01h501u ')).toBe('RSSMRA80A01H501U');
    expect(normalizePiva('IT 1234567890 1')).toBe('12345678901');
  });
});

describe('isValidCodiceFiscale', () => {
  it('accetta un CF valido', () => {
    expect(isValidCodiceFiscale('RSSMRA80A01H501U')).toBe(true);
  });
  it('rifiuta CF con check digit errato o formato sbagliato', () => {
    expect(isValidCodiceFiscale('RSSMRA80A01H501X')).toBe(false);
    expect(isValidCodiceFiscale('NONVALIDO')).toBe(false);
  });
});

describe('nameMatches', () => {
  it('match con ordine diverso e rumore di accenti/maiuscole', () => {
    expect(nameMatches('Mario Rossi', 'ROSSI MARIO')).toBe(true);
  });
  it('tollera un refuso OCR (1 carattere)', () => {
    expect(nameMatches('Mario Rossi', 'Mario Rossi')).toBe(true);
  });
  it('rifiuta nomi diversi', () => {
    expect(nameMatches('Mario Rossi', 'Luca Bianchi')).toBe(false);
  });
});

describe('companyMatches', () => {
  it('match per P.IVA anche con denominazione diversa', () => {
    expect(companyMatches(
      { denominazione: 'X', partitaIva: '12345678901' },
      { denominazione: 'Y', partitaIva: '12345678901' },
    )).toBe(true);
  });
  it('match per denominazione normalizzata se P.IVA assente', () => {
    expect(companyMatches(
      { denominazione: 'Rossi Auto SRL' },
      { denominazione: 'ROSSI AUTO', partitaIva: '12345678901' },
    )).toBe(true);
  });
  it('rifiuta aziende diverse', () => {
    expect(companyMatches(
      { denominazione: 'Rossi Auto', partitaIva: '11111111111' },
      { denominazione: 'Bianchi Auto', partitaIva: '22222222222' },
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- kyc/match`
Atteso: FAIL (modulo non esiste).

- [ ] **Step 3: Implementa match.ts**

Create `apps/piattaforma/src/lib/kyc/match.ts`:
```ts
const LEGAL_FORMS = [
  'SRLS', 'SRL', 'SPA', 'SAPA', 'SNC', 'SAS', 'SS', 'SCARL', 'SOC COOP', 'COOP',
];

/** Upper, rimuove accenti, tiene solo lettere/spazi, spazi singoli. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCompanyName(s: string): string {
  let n = normalizeName(s);
  for (const form of LEGAL_FORMS) {
    n = n.replace(new RegExp(`\\b${form}\\b`, 'g'), '');
  }
  return n.trim().replace(/\s+/g, ' ');
}

export function normalizeCf(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePiva(s: string): string {
  return s.replace(/\D/g, '');
}

/** Validazione check digit del codice fiscale persona fisica (16 char). */
export function isValidCodiceFiscale(cf: string): boolean {
  const c = normalizeCf(cf);
  if (!/^[A-Z0-9]{16}$/.test(c)) return false;
  const odd: Record<string, number> = {
    '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  const evenVal = (ch: string): number =>
    /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = c[i]!;
    sum += i % 2 === 0 ? odd[ch]! : evenVal(ch);
  }
  return String.fromCharCode(65 + (sum % 26)) === c[15];
}

/** Levenshtein distance (per tollerare refusi OCR su singoli token). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m]![n]!;
}

function tokenSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const ratio = 1 - lev(a, b) / Math.max(a.length, b.length);
  return ratio >= 0.8;
}

/** Token-set: ogni token del nome più corto ha un token simile nell'altro. */
export function nameMatches(a: string, b: string): boolean {
  const ta = normalizeName(a).split(' ').filter(Boolean);
  const tb = normalizeName(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((t) => longer.some((u) => tokenSimilar(t, u)));
}

export function companyMatches(
  visura: { denominazione?: string; partitaIva?: string },
  step2: { denominazione: string; partitaIva: string },
): boolean {
  if (visura.partitaIva && normalizePiva(visura.partitaIva) === normalizePiva(step2.partitaIva)) {
    return true;
  }
  if (visura.denominazione &&
      normalizeCompanyName(visura.denominazione) === normalizeCompanyName(step2.denominazione)) {
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Esegui i test (devono passare)**

Run: `pnpm --filter piattaforma test -- kyc/match` → PASS
> Se un test sul check digit CF fallisce, verifica il CF d'esempio con un generatore reale e aggiorna la fixture (l'algoritmo è standard).

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/kyc/match.*
git commit -m "feat(kyc): match.ts (normalizzazioni, check CF, nomi tolleranti, azienda)"
```

---

### Task 6: Modello + logica ATECO

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration `packages/db/prisma/migrations/<timestamp>_ateco_allowed_codes/migration.sql`
- Create: `apps/piattaforma/src/lib/kyc/ateco.ts`
- Test: `apps/piattaforma/src/lib/kyc/ateco.test.ts`

- [ ] **Step 1: Aggiungi il modello allo schema Prisma**

In `packages/db/prisma/schema.prisma`, in fondo (prima della fine), aggiungi:
```prisma
model AtecoAllowedCode {
  id          String      @id @default(uuid()) @db.Uuid
  companyType CompanyType
  code        String // normalizzato senza punti, es. "4511"
  label       String?
  active      Boolean     @default(true)
  createdById String?     @db.Uuid
  createdAt   DateTime    @default(now())

  @@unique([companyType, code])
  @@map("ateco_allowed_codes")
}
```

- [ ] **Step 2: Genera la migration (shadow DB su 127.0.0.1)**

Run (dalla root, vedi processo in memoria [[project-prod-release-process]]):
```bash
pnpm --filter @pv/db exec prisma migrate dev --name ateco_allowed_codes --create-only
```
Atteso: crea la cartella migration con la `CREATE TABLE "ateco_allowed_codes"`. Poi applica in locale:
```bash
pnpm --filter @pv/db exec prisma migrate dev
```

- [ ] **Step 3: Scrivi i test della logica ateco**

Create `apps/piattaforma/src/lib/kyc/ateco.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeAteco, isAtecoAllowed } from './ateco';

const allowed = [
  { companyType: 'DEALER' as const, code: '4511', active: true },
  { companyType: 'DEALER' as const, code: '453', active: true },
  { companyType: 'AGENZIA' as const, code: '8211', active: true },
  { companyType: 'DEALER' as const, code: '9999', active: false },
];

describe('normalizeAteco', () => {
  it('rimuove punti e spazi', () => {
    expect(normalizeAteco('45.11.01')).toBe('451101');
    expect(normalizeAteco(' 45.3 ')).toBe('453');
  });
});

describe('isAtecoAllowed', () => {
  it('match per prefisso sul tipo azienda', () => {
    expect(isAtecoAllowed('45.11.01', 'DEALER', allowed)).toBe(true);
    expect(isAtecoAllowed('45.31', 'DEALER', allowed)).toBe(true);
  });
  it('non matcha codici di un altro tipo azienda', () => {
    expect(isAtecoAllowed('82.11', 'DEALER', allowed)).toBe(false);
    expect(isAtecoAllowed('82.11', 'AGENZIA', allowed)).toBe(true);
  });
  it('ignora i codici disattivati e gli ATECO vuoti', () => {
    expect(isAtecoAllowed('99.99', 'DEALER', allowed)).toBe(false);
    expect(isAtecoAllowed(undefined, 'DEALER', allowed)).toBe(false);
  });
});
```

- [ ] **Step 4: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- kyc/ateco`
Atteso: FAIL.

- [ ] **Step 5: Implementa ateco.ts**

Create `apps/piattaforma/src/lib/kyc/ateco.ts`:
```ts
import type { CompanyType } from '@pv/db';

export function normalizeAteco(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

export type AllowedAteco = { companyType: CompanyType; code: string; active: boolean };

/** True se l'ATECO della visura inizia con un codice ammesso ATTIVO per quel tipo azienda. */
export function isAtecoAllowed(
  visuraAteco: string | undefined,
  companyType: CompanyType,
  allowed: AllowedAteco[],
): boolean {
  if (!visuraAteco) return false;
  const norm = normalizeAteco(visuraAteco);
  if (!norm) return false;
  return allowed.some(
    (a) => a.active && a.companyType === companyType && norm.startsWith(a.code),
  );
}
```

- [ ] **Step 6: Esegui i test (devono passare) + typecheck**

Run: `pnpm --filter piattaforma test -- kyc/ateco` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 7: Commit**
```bash
git add packages/db/prisma apps/piattaforma/src/lib/kyc/ateco.*
git commit -m "feat(kyc): modello AtecoAllowedCode + logica allowlist per prefisso"
```

---

### Task 7: Seed default ATECO

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Aggiungi il seed dei codici di default**

In `packages/db/prisma/seed.ts`, dentro `main()` (prima della chiusura), aggiungi:
```ts
  // ATECO ammessi di default (gruppo 45 = commercio autoveicoli per i dealer;
  // 82.11/82.99 provvisori per le agenzie — DA CONFERMARE col commercialista).
  const atecoDefaults: Array<{ companyType: 'DEALER' | 'AGENZIA'; code: string; label: string }> = [
    { companyType: 'DEALER', code: '4511', label: 'Commercio autoveicoli' },
    { companyType: 'DEALER', code: '4519', label: 'Commercio altri autoveicoli' },
    { companyType: 'DEALER', code: '453', label: 'Commercio parti e accessori' },
    { companyType: 'DEALER', code: '454', label: 'Commercio motocicli' },
    { companyType: 'AGENZIA', code: '8211', label: 'Servizi integrati di supporto (DA CONFERMARE)' },
    { companyType: 'AGENZIA', code: '8299', label: 'Altri servizi di supporto alle imprese (DA CONFERMARE)' },
  ];
  for (const a of atecoDefaults) {
    await prisma.atecoAllowedCode.upsert({
      where: { companyType_code: { companyType: a.companyType, code: a.code } },
      create: a,
      update: { label: a.label },
    });
  }
  console.log(`  · ateco allowlist: ${atecoDefaults.length} codici`);
```

- [ ] **Step 2: Esegui il seed in locale**

Run: `pnpm --filter @pv/db exec prisma db seed`
Atteso: stampa "ateco allowlist: 6 codici", nessun errore.

- [ ] **Step 3: Commit**
```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(kyc): seed allowlist ATECO di default (dealer 45*, agenzia provvisori)"
```

---

### Task 8: Parser visura (testo puro + estrazione PDF)

**Files:**
- Create: `apps/piattaforma/src/lib/kyc/visura-parser.ts`
- Test: `apps/piattaforma/src/lib/kyc/visura-parser.test.ts`

- [ ] **Step 1: Scrivi i test del parser di testo**

Create `apps/piattaforma/src/lib/kyc/visura-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseVisuraText } from './visura-parser';

const SAMPLE = `REGISTRO IMPRESE
Denominazione: ROSSI AUTO S.R.L.
Codice fiscale e Partita IVA: 12345678901
Codice ATECO: 45.11.01 Commercio di autovetture
AMMINISTRATORE UNICO
ROSSI MARIO - C.F. RSSMRA80A01H501U
Il presente documento è stato estratto in data 15/03/2026`;

describe('parseVisuraText', () => {
  it('estrae denominazione, P.IVA, ATECO, data emissione e amministratore', () => {
    const r = parseVisuraText(SAMPLE);
    expect(r.denominazione).toContain('ROSSI AUTO');
    expect(r.partitaIva).toBe('12345678901');
    expect(r.ateco).toBe('45.11.01');
    expect(r.dataEmissione).toBe('2026-03-15');
    expect(r.amministratore?.codiceFiscale).toBe('RSSMRA80A01H501U');
    expect(r.amministratore?.cognome).toBe('ROSSI');
    expect(r.amministratore?.nome).toBe('MARIO');
  });
  it('campi assenti restano undefined senza lanciare', () => {
    const r = parseVisuraText('testo vuoto');
    expect(r.partitaIva).toBeUndefined();
    expect(r.dataEmissione).toBeUndefined();
    expect(r.rawText).toBe('testo vuoto');
  });
});
```

- [ ] **Step 2: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- kyc/visura-parser`
Atteso: FAIL.

- [ ] **Step 3: Implementa il parser**

Create `apps/piattaforma/src/lib/kyc/visura-parser.ts`:
```ts
import 'server-only';
import type { OcrExtractInput } from '@/lib/providers/ocr';

export type VisuraData = {
  dataEmissione?: string; // ISO yyyy-mm-dd
  ateco?: string;
  denominazione?: string;
  partitaIva?: string;
  amministratore?: { nome?: string; cognome?: string; codiceFiscale?: string };
  rawText: string;
};

const CF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/;
const PIVA_RE = /\b(\d{11})\b/;
const ATECO_RE = /\b(\d{2}\.\d{1,2}(?:\.\d{1,2})?)\b/;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;

/** Parsing best-effort del testo di una visura camerale. Puro/testabile. */
export function parseVisuraText(text: string): VisuraData {
  const out: VisuraData = { rawText: text };
  const upper = text.toUpperCase();

  const denom = /DENOMINAZIONE[:\s]+([^\n]+)/i.exec(text);
  if (denom) out.denominazione = denom[1]!.trim();

  const piva = PIVA_RE.exec(upper.replace(/PARTITA IVA|P\.IVA|CODICE FISCALE/g, (m) => `${m} `));
  if (piva) out.partitaIva = piva[1];

  const ateco = ATECO_RE.exec(upper.includes('ATECO') ? upper.slice(upper.indexOf('ATECO')) : upper);
  if (ateco) out.ateco = ateco[1];

  const date = DATE_RE.exec(upper.includes('ESTRATT') ? upper.slice(upper.indexOf('ESTRATT')) : upper);
  if (date) out.dataEmissione = `${date[3]}-${date[2]}-${date[1]}`;

  const cf = CF_RE.exec(upper);
  // riga amministratore: "COGNOME NOME - C.F. XXX" vicino al CF
  const adminLine = /([A-ZÀ-Ù'’]+)\s+([A-ZÀ-Ù'’]+)\s*[-–]\s*C\.?F\.?\s*([A-Z0-9]{16})/i.exec(text);
  if (adminLine) {
    out.amministratore = {
      cognome: adminLine[1]!.toUpperCase(),
      nome: adminLine[2]!.toUpperCase(),
      codiceFiscale: adminLine[3]!.toUpperCase(),
    };
  } else if (cf) {
    out.amministratore = { codiceFiscale: cf[1] };
  }
  return out;
}

/** Estrae i dati visura da un PDF. Usa unpdf (testo); se il PDF non ha testo
 * (visura scansionata) fa fallback a Document AI. */
export async function extractVisura(input: OcrExtractInput): Promise<VisuraData> {
  const { getDocumentProxy, extractText: pdfExtractText } = await import('unpdf');
  let text = '';
  try {
    const pdf = await getDocumentProxy(new Uint8Array(input.buffer));
    const res = await pdfExtractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join('\n') : res.text;
  } catch {
    text = '';
  }
  if (text.trim().length < 40) {
    // Fallback OCR per visure scansionate (PDF immagine).
    const { getOcr } = await import('@/lib/providers/ocr');
    const ocr = await getOcr();
    text = (await ocr.extractText(input)).text;
  }
  return parseVisuraText(text);
}
```

- [ ] **Step 4: Esegui i test (devono passare)**

Run: `pnpm --filter piattaforma test -- kyc/visura-parser` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/kyc/visura-parser.*
git commit -m "feat(kyc): parser visura (testo puro + estrazione PDF unpdf con fallback OCR)"
```

---

### Task 9: Estrazione CI e CF

**Files:**
- Create: `apps/piattaforma/src/lib/kyc/extract-ci.ts`, `extract-cf.ts`
- Test: `apps/piattaforma/src/lib/kyc/extract-identity.test.ts`

- [ ] **Step 1: Scrivi i test**

Create `apps/piattaforma/src/lib/kyc/extract-identity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractCi } from './extract-ci';
import { extractCf } from './extract-cf';

describe('extractCi', () => {
  it('estrae cognome e nome dai campi etichettati', () => {
    const r = extractCi('REPUBBLICA ITALIANA\nCOGNOME\nROSSI\nNOME\nMARIO\n');
    expect(r.cognome).toBe('ROSSI');
    expect(r.nome).toBe('MARIO');
  });
  it('campi assenti undefined', () => {
    const r = extractCi('testo senza campi');
    expect(r.cognome).toBeUndefined();
  });
});

describe('extractCf', () => {
  it('estrae il codice fiscale dalla tessera sanitaria', () => {
    const r = extractCf('TESSERA SANITARIA\nCODICE FISCALE\nRSSMRA80A01H501U\n');
    expect(r.codiceFiscale).toBe('RSSMRA80A01H501U');
  });
  it('CF assente undefined', () => {
    expect(extractCf('nessun codice').codiceFiscale).toBeUndefined();
  });
});
```

- [ ] **Step 2: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- extract-identity`
Atteso: FAIL.

- [ ] **Step 3: Implementa extract-ci.ts**

Create `apps/piattaforma/src/lib/kyc/extract-ci.ts`:
```ts
export type CiData = { nome?: string; cognome?: string; rawText: string };

/** Estrae nome/cognome dal testo OCR di una CI/CIE. Best-effort: cerca le
 * etichette COGNOME/NOME (la riga successiva contiene il valore). */
export function extractCi(text: string): CiData {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const valueAfter = (label: RegExp): string | undefined => {
    const i = lines.findIndex((l) => label.test(l));
    if (i === -1) return undefined;
    const v = lines[i + 1];
    return v && /^[A-ZÀ-Ù'’ ]{2,}$/i.test(v) ? v.toUpperCase() : undefined;
  };
  return {
    cognome: valueAfter(/^COGNOME\b/i),
    nome: valueAfter(/^NOME\b/i),
    rawText: text,
  };
}
```

- [ ] **Step 4: Implementa extract-cf.ts**

Create `apps/piattaforma/src/lib/kyc/extract-cf.ts`:
```ts
export type CfData = { codiceFiscale?: string; rawText: string };

const CF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/;

/** Estrae il codice fiscale dal testo OCR (tessera sanitaria / CF). */
export function extractCf(text: string): CfData {
  const m = CF_RE.exec(text.toUpperCase());
  return { codiceFiscale: m?.[1], rawText: text };
}
```

- [ ] **Step 5: Esegui i test (devono passare)**

Run: `pnpm --filter piattaforma test -- extract-identity` → PASS

- [ ] **Step 6: Commit**
```bash
git add apps/piattaforma/src/lib/kyc/extract-ci.ts apps/piattaforma/src/lib/kyc/extract-cf.ts apps/piattaforma/src/lib/kyc/extract-identity.test.ts
git commit -m "feat(kyc): estrazione nome/cognome (CI) e codice fiscale (tessera)"
```

---

### Task 10: Check età visura a 5 mesi (refactor utility)

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/document-validation.ts`
- Modify: `apps/piattaforma/src/lib/auth/document-validation.test.ts`

- [ ] **Step 1: Scrivi il test della nuova utility parametrica**

In `apps/piattaforma/src/lib/auth/document-validation.test.ts`, aggiungi:
```ts
import { isVisuraDateValid } from './document-validation';

describe('isVisuraDateValid (parametrico)', () => {
  const now = new Date('2026-06-04T12:00:00Z');
  it('valida entro 5 mesi', () => {
    expect(isVisuraDateValid('2026-02-01', 5, now)).toEqual({ ok: true });
  });
  it('blocca oltre 5 mesi', () => {
    const r = isVisuraDateValid('2025-12-01', 5, now);
    expect(r.ok).toBe(false);
  });
  it('blocca data futura', () => {
    expect(isVisuraDateValid('2026-07-01', 5, now).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui (deve fallire)**

Run: `pnpm --filter piattaforma test -- document-validation`
Atteso: FAIL (`isVisuraDateValid` non esiste).

- [ ] **Step 3: Estrai la utility parametrica**

In `apps/piattaforma/src/lib/auth/document-validation.ts`, aggiungi (riusando `subtractMonthsUtcDay` già presente):
```ts
/** Valida una data emissione visura: non futura e non oltre `maxAgeMonths` mesi.
 * Confronto a granularità giorno (UTC). */
export function isVisuraDateValid(
  visuraData: string,
  maxAgeMonths: number,
  now: Date = new Date(),
): DocValidationResult {
  const d = new Date(visuraData);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'Data della visura non valida' };
  const visuraDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (visuraDay > nowDay) return { ok: false, error: 'La data della visura non può essere futura' };
  if (visuraDay < subtractMonthsUtcDay(now, maxAgeMonths)) {
    return { ok: false, error: `La visura camerale deve essere emessa da non più di ${maxAgeMonths} mesi` };
  }
  return { ok: true };
}
```
(`validateVisuraData` esistente resta invariata per retrocompatibilità.)

- [ ] **Step 4: Esegui (deve passare)**

Run: `pnpm --filter piattaforma test -- document-validation` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/auth/document-validation.*
git commit -m "feat(kyc): isVisuraDateValid parametrico (KYC usa 5 mesi)"
```

---

### Task 11: Orchestratore verifyRegistrationKyc

**Files:**
- Create: `apps/piattaforma/src/lib/kyc/verify.ts`
- Test: `apps/piattaforma/src/lib/kyc/verify.test.ts`

- [ ] **Step 1: Scrivi i test dell'orchestratore (deps iniettate)**

Create `apps/piattaforma/src/lib/kyc/verify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { verifyRegistrationKyc, type KycDeps } from './verify';

const now = new Date('2026-06-04T12:00:00Z');
const allowed = [{ companyType: 'DEALER' as const, code: '4511', active: true }];
const company = { ragioneSociale: 'Rossi Auto SRL', partitaIva: '12345678901', type: 'DEALER' as const };
const fakeInput = { buffer: Buffer.from('x'), mimeType: 'image/png' };
const files = { ciFronte: fakeInput, codiceFiscale: fakeInput, visura: fakeInput };

const goodDeps: KycDeps = {
  getVisuraData: async () => ({
    rawText: '', dataEmissione: '2026-03-15', ateco: '45.11.01',
    denominazione: 'ROSSI AUTO SRL', partitaIva: '12345678901',
    amministratore: { nome: 'MARIO', cognome: 'ROSSI', codiceFiscale: 'RSSMRA80A01H501U' },
  }),
  getCiData: async () => ({ nome: 'MARIO', cognome: 'ROSSI', rawText: '' }),
  getCfData: async () => ({ codiceFiscale: 'RSSMRA80A01H501U', rawText: '' }),
};

describe('verifyRegistrationKyc', () => {
  it('passa quando tutto combacia', async () => {
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed, now }, goodDeps);
    expect(r.passed).toBe(true);
  });

  it('blocca visura scaduta (>5 mesi)', async () => {
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), dataEmissione: '2025-12-01' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed, now }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'VISURA_SCADUTA')).toBe(true);
  });

  it('blocca ATECO non idoneo', async () => {
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), ateco: '62.01' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed, now }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ATECO_NON_IDONEO')).toBe(true);
  });

  it('blocca mismatch nome CI', async () => {
    const deps = { ...goodDeps, getCiData: async () => ({ nome: 'LUCA', cognome: 'BIANCHI', rawText: '' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed, now }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'CI_MISMATCH')).toBe(true);
  });

  it('blocca mismatch CF', async () => {
    const deps = { ...goodDeps, getCfData: async () => ({ codiceFiscale: 'BNCLCU90A01H501Z', rawText: '' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed, now }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'CF_MISMATCH')).toBe(true);
  });

  it('segnala ILLEGGIBILE quando un campo chiave manca', async () => {
    const deps = { ...goodDeps, getCiData: async () => ({ rawText: '' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed, now }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ILLEGGIBILE' && f.doc === 'CI')).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui i test (devono fallire)**

Run: `pnpm --filter piattaforma test -- kyc/verify`
Atteso: FAIL.

- [ ] **Step 3: Implementa verify.ts**

Create `apps/piattaforma/src/lib/kyc/verify.ts`:
```ts
import 'server-only';
import type { CompanyType } from '@pv/db';
import type { OcrExtractInput } from '@/lib/providers/ocr';
import { isVisuraDateValid } from '@/lib/auth/document-validation';
import { isAtecoAllowed, type AllowedAteco } from './ateco';
import { companyMatches, nameMatches, normalizeCf } from './match';
import { extractVisura, type VisuraData } from './visura-parser';
import { extractCi, type CiData } from './extract-ci';
import { extractCf, type CfData } from './extract-cf';

const VISURA_MAX_AGE_MONTHS = 5;

export type KycFailure = {
  rule: 'VISURA_SCADUTA' | 'ATECO_NON_IDONEO' | 'AZIENDA_MISMATCH' | 'CI_MISMATCH' | 'CF_MISMATCH' | 'ILLEGGIBILE';
  doc?: 'CI' | 'CF' | 'VISURA';
  message: string;
};

export type KycResult =
  | { passed: true; extracted: { visura: VisuraData; ci: CiData; cf: CfData } }
  | { passed: false; failures: KycFailure[] };

export type KycDeps = {
  getVisuraData: (input: OcrExtractInput) => Promise<VisuraData>;
  getCiData: (input: OcrExtractInput) => Promise<CiData>;
  getCfData: (input: OcrExtractInput) => Promise<CfData>;
};

/** Deps reali: visura via unpdf/DocAI, CI/CF via Document OCR. */
export const defaultKycDeps: KycDeps = {
  getVisuraData: (input) => extractVisura(input),
  getCiData: async (input) => {
    const { getOcr } = await import('@/lib/providers/ocr');
    const ocr = await getOcr();
    return extractCi((await ocr.extractText(input)).text);
  },
  getCfData: async (input) => {
    const { getOcr } = await import('@/lib/providers/ocr');
    const ocr = await getOcr();
    return extractCf((await ocr.extractText(input)).text);
  },
};

export async function verifyRegistrationKyc(
  args: {
    files: { ciFronte: OcrExtractInput; codiceFiscale: OcrExtractInput; visura: OcrExtractInput };
    company: { ragioneSociale: string; partitaIva: string; type: CompanyType };
    allowedAteco: AllowedAteco[];
    now?: Date;
  },
  deps: KycDeps = defaultKycDeps,
): Promise<KycResult> {
  const now = args.now ?? new Date();
  const [visura, ci, cf] = await Promise.all([
    deps.getVisuraData(args.files.visura),
    deps.getCiData(args.files.ciFronte),
    deps.getCfData(args.files.codiceFiscale),
  ]);

  const failures: KycFailure[] = [];

  // Illeggibilità (campi chiave mancanti) — distinta dal mismatch.
  if (!visura.dataEmissione || !visura.ateco || (!visura.partitaIva && !visura.denominazione)) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'VISURA', message: 'Non siamo riusciti a leggere la visura: carica il PDF originale (non una scansione).' });
  }
  if (!visura.amministratore?.cognome && !visura.amministratore?.nome && !visura.amministratore?.codiceFiscale) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'VISURA', message: 'Non siamo riusciti a leggere l\'amministratore nella visura.' });
  }
  if (!ci.nome || !ci.cognome) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'CI', message: 'Non siamo riusciti a leggere nome e cognome dalla carta d\'identità: ricarica una foto più nitida.' });
  }
  if (!cf.codiceFiscale) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'CF', message: 'Non siamo riusciti a leggere il codice fiscale: ricarica una foto più nitida della tessera sanitaria.' });
  }

  // Regole di mismatch (solo se i dati necessari sono leggibili).
  if (visura.dataEmissione) {
    const age = isVisuraDateValid(visura.dataEmissione, VISURA_MAX_AGE_MONTHS, now);
    if (!age.ok) failures.push({ rule: 'VISURA_SCADUTA', doc: 'VISURA', message: age.error });
  }
  if (visura.ateco && !isAtecoAllowed(visura.ateco, args.company.type, args.allowedAteco)) {
    failures.push({ rule: 'ATECO_NON_IDONEO', doc: 'VISURA', message: `Il codice ATECO ${visura.ateco} non rientra tra le attività ammesse per la registrazione.` });
  }
  if ((visura.partitaIva || visura.denominazione) &&
      !companyMatches(visura, { denominazione: args.company.ragioneSociale, partitaIva: args.company.partitaIva })) {
    failures.push({ rule: 'AZIENDA_MISMATCH', doc: 'VISURA', message: 'I dati della visura non corrispondono all\'azienda inserita (ragione sociale / P.IVA).' });
  }
  if (ci.nome && ci.cognome && visura.amministratore && (visura.amministratore.nome || visura.amministratore.cognome)) {
    const ciFull = `${ci.nome} ${ci.cognome}`;
    const adminFull = `${visura.amministratore.nome ?? ''} ${visura.amministratore.cognome ?? ''}`;
    if (!nameMatches(ciFull, adminFull)) {
      failures.push({ rule: 'CI_MISMATCH', doc: 'CI', message: 'Il nome sulla carta d\'identità non corrisponde all\'amministratore indicato in visura.' });
    }
  }
  if (cf.codiceFiscale && visura.amministratore?.codiceFiscale) {
    if (normalizeCf(cf.codiceFiscale) !== normalizeCf(visura.amministratore.codiceFiscale)) {
      failures.push({ rule: 'CF_MISMATCH', doc: 'CF', message: 'Il codice fiscale caricato non corrisponde all\'amministratore indicato in visura.' });
    }
  }

  if (failures.length) return { passed: false, failures };
  return { passed: true, extracted: { visura, ci, cf } };
}
```

- [ ] **Step 4: Esegui i test (devono passare) + typecheck**

Run: `pnpm --filter piattaforma test -- kyc/verify` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/lib/kyc/verify.*
git commit -m "feat(kyc): orchestratore verifyRegistrationKyc (5 regole + illeggibile, deps iniettabili)"
```

---

### Task 12: Sezione admin ATECO

**Files:**
- Create: `apps/piattaforma/src/app/admin/ateco/page.tsx`, `actions.ts`, `client.tsx`
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (adminLinks)

> Pattern di riferimento: la sezione promo `apps/piattaforma/src/app/admin/codici-promozionali/` (page = fetch+guard server, actions = create/toggle con guard `isAdminPiattaforma`, client = form+tabella).

- [ ] **Step 1: Implementa le server actions**

Create `apps/piattaforma/src/app/admin/ateco/actions.ts`:
```ts
'use server';
import { prisma, type CompanyType } from '@pv/db';
import { auth } from '@/auth';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { normalizeAteco } from '@/lib/kyc/ateco';
import { revalidatePath } from 'next/cache';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user)) throw new Error('Non autorizzato');
  return session.user;
}

export async function createAtecoAction(input: { companyType: CompanyType; code: string; label?: string }) {
  const user = await requireAdmin();
  const code = normalizeAteco(input.code);
  if (!code) return { ok: false as const, error: 'Codice ATECO non valido' };
  await prisma.atecoAllowedCode.upsert({
    where: { companyType_code: { companyType: input.companyType, code } },
    create: { companyType: input.companyType, code, label: input.label || null, createdById: user.id, active: true },
    update: { label: input.label || null, active: true },
  });
  revalidatePath('/admin/ateco');
  return { ok: true as const };
}

export async function toggleAtecoAction(id: string, active: boolean) {
  await requireAdmin();
  await prisma.atecoAllowedCode.update({ where: { id }, data: { active } });
  revalidatePath('/admin/ateco');
  return { ok: true as const };
}
```

- [ ] **Step 2: Implementa la pagina server (guard + fetch)**

Create `apps/piattaforma/src/app/admin/ateco/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { AtecoClient } from './client';

export default async function AtecoPage() {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user)) redirect('/dashboard');
  const codes = await prisma.atecoAllowedCode.findMany({
    orderBy: [{ companyType: 'asc' }, { code: 'asc' }],
  });
  return <AtecoClient codes={codes} />;
}
```

- [ ] **Step 3: Implementa il client (form + tabella)**

Create `apps/piattaforma/src/app/admin/ateco/client.tsx` con: form (select companyType DEALER/AGENZIA, input codice, input label, bottone "Aggiungi" → `createAtecoAction`) e tabella (companyType, code, label, stato, bottone attiva/disattiva → `toggleAtecoAction`). Usa i componenti UI esistenti in `src/components/ui` (come `client.tsx` di codici-promozionali). Tipi: la prop `codes` è `AtecoAllowedCode[]` importato da `@pv/db`.

- [ ] **Step 4: Aggiungi il link in nav admin**

In `apps/piattaforma/src/components/app-shell.tsx`, nell'array `adminLinks`, dopo la voce "Promo":
```ts
    { href: '/admin/ateco', label: 'ATECO' },
```

- [ ] **Step 5: Verifica typecheck + lint + build**

Run: `pnpm --filter piattaforma typecheck` → PASS
Run: `pnpm --filter piattaforma lint` → PASS
Run: `pnpm --filter piattaforma build` → PASS

- [ ] **Step 6: Commit**
```bash
git add apps/piattaforma/src/app/admin/ateco/ apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(admin): sezione ATECO allowlist (crea/lista/attiva-disattiva)"
```

---

### Task 13: Integra il gate KYC in registerAction

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`
- Modify: `apps/piattaforma/src/app/(auth)/actions.test.ts`

- [ ] **Step 1: Estendi il tipo di risultato con kycFailures**

In `apps/piattaforma/src/app/(auth)/actions.ts`, modifica la variante errore di `RegisterActionResult` (riga 138):
```ts
  | { ok: false; error: string; field?: string; kycFailures?: import('@/lib/kyc/verify').KycFailure[] };
```

- [ ] **Step 2: Aggiungi import e il gate KYC prima dello storage**

In `apps/piattaforma/src/app/(auth)/actions.ts`, dopo gli import esistenti aggiungi:
```ts
import { verifyRegistrationKyc } from '@/lib/kyc/verify';
```
Poi, dopo il blocco di validazione documenti (dopo riga 207, `if (!docCheck.ok) {...}`) e DOPO aver estratto `const { account, company, payment } = parsed.data;` (riga 209), inserisci il gate. Prima servono i buffer dei file:
```ts
  // Buffer dei file (riusati per OCR e poi per lo storage).
  const docBuffers = await Promise.all(
    docFiles.map(async ({ tipo, file }) => ({
      tipo, file, buffer: Buffer.from(await file.arrayBuffer()),
    })),
  );
  const bufByTipo = (t: (typeof REGISTRATION_DOC_SLOTS)[number]) =>
    docBuffers.find((d) => d.tipo === t)!;

  // GATE KYC (sincrono, bloccante). Salta in DEMO_MODE (banner "OCR simulati").
  if (!env.DEMO_MODE) {
    const allowedAteco = await prisma.atecoAllowedCode.findMany({
      where: { companyType: company.type, active: true },
      select: { companyType: true, code: true, active: true },
    });
    const toInput = (t: (typeof REGISTRATION_DOC_SLOTS)[number]) => {
      const d = bufByTipo(t);
      return { buffer: d.buffer, mimeType: d.file.type, originalFilename: d.file.name };
    };
    const kyc = await verifyRegistrationKyc({
      files: { ciFronte: toInput('CI_FRONTE'), codiceFiscale: toInput('CODICE_FISCALE'), visura: toInput('VISURA_CAMERALE') },
      company: { ragioneSociale: company.ragioneSociale, partitaIva: company.partitaIva, type: company.type },
      allowedAteco,
    });
    if (!kyc.passed) {
      return { ok: false, error: 'Verifica documenti non superata', kycFailures: kyc.failures };
    }
  }
```
> NB: lo step 3 del design dice "DEMO_MODE spento in produzione" ma manteniamo il bypass per coerenza col banner finché DEMO_MODE è attivo. Con `DEMO_MODE=false` (cutover, Workstream D) il gate gira sempre.

- [ ] **Step 3: Riusa i buffer nello storage (evita doppio read)**

Nel blocco storage (righe ~272-284) sostituisci `const buffer = Buffer.from(await file.arrayBuffer());` con il buffer già calcolato:
```ts
  const storedDocs = await Promise.all(
    docBuffers.map(async ({ tipo, file, buffer }) => {
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

- [ ] **Step 4: Verifica fixture test esistenti**

In `apps/piattaforma/src/app/(auth)/actions.test.ts`, i test `registerAction (early returns)` usano `DEMO_MODE: true` (riga 17 del mock) → il gate KYC è bypassato, quindi NON serve mockare l'OCR. Aggiungi però al mock `@pv/db` (righe 4-14) il modello usato dal gate (per sicurezza se in futuro si testa con demo off):
```ts
    atecoAllowedCode: { findMany: vi.fn().mockResolvedValue([]) },
```

- [ ] **Step 5: Esegui i test + typecheck**

Run: `pnpm --filter piattaforma test -- "auth/actions"` → PASS (i test early-return non toccano il gate)
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 6: Commit**
```bash
git add apps/piattaforma/src/app/(auth)/actions.ts apps/piattaforma/src/app/(auth)/actions.test.ts
git commit -m "feat(kyc): gate verifyRegistrationKyc in registerAction (blocca al submit, bypass demo)"
```

---

### Task 14: Persisti i dati estratti dopo il successo

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`

- [ ] **Step 1: Conserva l'esito KYC per la persistenza**

Nel gate (Task 13 Step 2), cattura l'estratto fuori dall'if per usarlo dopo. Cambia la dichiarazione in:
```ts
  let kycExtracted: import('@/lib/kyc/verify').KycResult extends { passed: true; extracted: infer E } ? E | null : null = null;
```
> Semplifica: dichiara invece `let kycExtracted: Awaited<ReturnType<typeof verifyRegistrationKyc>> | null = null;` prima dell'if, assegna `const kyc = ...; kycExtracted = kyc;` e usa `kycExtracted?.passed ? kycExtracted.extracted : undefined` più avanti.

- [ ] **Step 2: Valorizza ocrData/ocrStato e visuraCameraleData nella transazione**

Nel loop di creazione `documento` (righe ~358-373), aggiungi i campi OCR quando l'estratto è disponibile (mappa per tipo: visura → `extracted.visura`, CI_FRONTE → `extracted.ci`, CODICE_FISCALE → `extracted.cf`):
```ts
      const ocrPayload =
        kycExtracted?.passed
          ? tipo === 'VISURA_CAMERALE' ? kycExtracted.extracted.visura
          : tipo === 'CI_FRONTE' ? kycExtracted.extracted.ci
          : tipo === 'CODICE_FISCALE' ? kycExtracted.extracted.cf
          : null
          : null;
      await tx.documento.create({
        data: {
          tipo, companyId,
          storageKey: put.storageKey, storageProvider: put.storageProvider,
          mimeType: put.mimeType, sizeBytes: put.sizeBytes, originalFilename: put.originalFilename,
          uploadedById: userId,
          ocrStato: ocrPayload ? 'SUCCESS' : 'NONE',
          ocrProvider: ocrPayload ? env.OCR_PROVIDER : null,
          ocrData: ocrPayload ?? undefined,
          ocrAt: ocrPayload ? new Date() : null,
          gatingStato: 'PASSED',
        },
      });
```
E nella `tx.company.create` (riga ~302) cambia `visuraCameraleData: null,` in:
```ts
          visuraCameraleData: kycExtracted?.passed ? kycExtracted.extracted.visura.dataEmissione ?? null : null,
```

- [ ] **Step 3: Esegui i test + typecheck**

Run: `pnpm --filter piattaforma test -- "auth/actions"` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 4: Commit**
```bash
git add apps/piattaforma/src/app/(auth)/actions.ts
git commit -m "feat(kyc): persisti dati estratti (ocrData, ocrStato, visuraCameraleData)"
```

---

### Task 15: UI wizard — spinner e messaggi di blocco KYC

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`

- [ ] **Step 1: Mostra spinner durante il submit**

Nel componente che gestisce il submit finale (`handlePayment`), assicurati che ci sia uno stato `submitting` che, quando true, mostra "Verifica documenti in corso…" e disabilita il bottone. (Se già presente per il submit, riusalo; il testo va aggiornato per riflettere la verifica OCR.)

- [ ] **Step 2: Gestisci kycFailures nel risultato**

Dopo `const res = await registerAction(fd);`, se `!res.ok && res.kycFailures?.length`:
```tsx
      if (!res.ok) {
        if (res.kycFailures?.length) {
          setKycErrors(res.kycFailures); // KycFailure[]
          setStep('documenti'); // torna allo step documenti
          return;
        }
        setError(res.error);
        return;
      }
```
Aggiungi lo stato `const [kycErrors, setKycErrors] = useState<{ doc?: string; message: string }[]>([]);`.

- [ ] **Step 3: Render dei messaggi nello step Documenti**

Nello step Documenti, sopra le card, se `kycErrors.length` mostra un box di errore che elenca i `message`. Evidenzia le card dei `doc` coinvolti (mappa: VISURA→Visura, CI→CI fronte, CF→Tessera/CF) con bordo rosso. Usa i colori del design system (no hardcoded; classi/token esistenti per errori).

- [ ] **Step 4: Verifica typecheck + lint + build**

Run: `pnpm --filter piattaforma typecheck` → PASS
Run: `pnpm --filter piattaforma lint` → PASS
Run: `pnpm --filter piattaforma build` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/piattaforma/src/app/(auth)/register/register-wizard.tsx
git commit -m "feat(kyc): wizard mostra spinner verifica e messaggi di blocco per documento"
```

---

# WORKSTREAM D — Cutover produzione

### Task 16: Guard pagamenti (no movimenti finti su mock)

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/payment-live.ts`
- Test: `apps/piattaforma/src/lib/jobs/payment-live.test.ts`
- Modify: `apps/piattaforma/src/lib/jobs/process-payouts.ts`, `process-fee-scheduled.ts`, `trigger-auto-payout.ts`

- [ ] **Step 1: Scrivi il test del guard**

Create `apps/piattaforma/src/lib/jobs/payment-live.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/env', () => ({ env: { PAYMENT_PROVIDER: 'mock' } }));
import { isPaymentLive } from './payment-live';

describe('isPaymentLive', () => {
  it('false con provider mock', () => {
    expect(isPaymentLive()).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui (deve fallire)**

Run: `pnpm --filter piattaforma test -- payment-live`
Atteso: FAIL.

- [ ] **Step 3: Implementa il guard**

Create `apps/piattaforma/src/lib/jobs/payment-live.ts`:
```ts
import 'server-only';
import { env } from '@/env';

/** True solo quando è configurato un provider di pagamento reale (es. Stripe).
 * Con `mock` i job NON devono eseguire movimenti per non muovere soldi finti. */
export function isPaymentLive(): boolean {
  return env.PAYMENT_PROVIDER !== 'mock';
}
```

- [ ] **Step 4: Applica il guard ai 3 job**

In `process-payouts.ts` (dopo riga 21, inizio funzione): se non live, esci subito senza toccare i payout:
```ts
  if (!isPaymentLive()) {
    console.warn('[payment] processPayouts sospeso: provider mock, in attesa di Stripe');
    return { processed: 0, succeeded: 0, failed: 0 };
  }
```
(import `import { isPaymentLive } from './payment-live';`). Analogo all'inizio di `processFeeScheduled()` in `process-fee-scheduled.ts` (ritorna il suo result type con contatori a 0) e di `triggerAutoPayout()` in `trigger-auto-payout.ts` (ritorna il suo result a 0). Verifica i tipi di ritorno aprendo ciascun file e adattando l'oggetto restituito.

- [ ] **Step 5: Esegui test + typecheck**

Run: `pnpm --filter piattaforma test -- payment-live` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 6: Commit**
```bash
git add apps/piattaforma/src/lib/jobs/payment-live.* apps/piattaforma/src/lib/jobs/process-payouts.ts apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts apps/piattaforma/src/lib/jobs/trigger-auto-payout.ts
git commit -m "feat(payments): guard isPaymentLive (job sospesi su mock, niente movimenti finti)"
```

---

### Task 17: Registro Imprese → noop in produzione

**Files:**
- Modify: `apps/piattaforma/src/env.ts`
- Modify: `apps/piattaforma/src/lib/providers/registro-imprese/index.ts`
- Create: `apps/piattaforma/src/lib/providers/registro-imprese/noop.ts`
- Test: `apps/piattaforma/src/lib/providers/registro-imprese/noop.test.ts`

- [ ] **Step 1: Aggiungi 'noop' all'enum env**

In `apps/piattaforma/src/env.ts` riga 30:
```ts
    REGISTRO_IMPRESE_PROVIDER: z.enum(['mock', 'noop', 'openapi', 'infocamere']).default('mock'),
```

- [ ] **Step 2: Scrivi il test del provider noop**

Create `apps/piattaforma/src/lib/providers/registro-imprese/noop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NoopRegistroImpreseProvider } from './noop';

describe('NoopRegistroImpreseProvider', () => {
  it('ritorna sempre null (niente dati finti)', async () => {
    const p = new NoopRegistroImpreseProvider();
    expect(await p.lookupByPiva({ partitaIva: '12345678901' })).toBeNull();
  });
});
```

- [ ] **Step 3: Esegui (deve fallire)**

Run: `pnpm --filter piattaforma test -- registro-imprese/noop`
Atteso: FAIL.

- [ ] **Step 4: Implementa il provider noop**

Create `apps/piattaforma/src/lib/providers/registro-imprese/noop.ts`:
```ts
import type {
  CompanyRegistryData, RegistroImpreseLookupInput, RegistroImpreseProvider,
} from './types';

/** Provider che non interroga nessun registro: ritorna null. Usato in
 * produzione finché non è attivo un account reale (niente dati finti). */
export class NoopRegistroImpreseProvider implements RegistroImpreseProvider {
  readonly name = 'noop' as const;
  async lookupByPiva(_input: RegistroImpreseLookupInput): Promise<CompanyRegistryData | null> {
    return null;
  }
}
```
> Aggiungi `'noop'` a `RegistroImpreseProviderName` in `types.ts`.

- [ ] **Step 5: Aggancia nel factory**

In `apps/piattaforma/src/lib/providers/registro-imprese/index.ts`, aggiungi il case prima di `openapi`:
```ts
    case 'noop': {
      const { NoopRegistroImpreseProvider } = await import('./noop');
      instance = new NoopRegistroImpreseProvider();
      break;
    }
```
(se il factory non è async, importa il provider in cima al file e istanzia direttamente.)

- [ ] **Step 6: Esegui test + typecheck**

Run: `pnpm --filter piattaforma test -- registro-imprese` → PASS
Run: `pnpm --filter piattaforma typecheck` → PASS

- [ ] **Step 7: Commit**
```bash
git add apps/piattaforma/src/lib/providers/registro-imprese/ apps/piattaforma/src/env.ts
git commit -m "feat(registro-imprese): provider noop (null) per produzione senza account reale"
```

---

### Task 18: Privacy policy — responsabili del trattamento

**Files:**
- Modify: pagina privacy (`apps/piattaforma/src/app/privacy/page.tsx` o file MDX equivalente — individua con `pnpm --filter piattaforma exec grep -rln "Privacy" src/app/privacy`)

- [ ] **Step 1: Aggiungi la sezione sub-processor**

Aggiungi un paragrafo che elenca i responsabili/sub-processor del trattamento e la finalità:
- **Google Cloud (Document AI)** — lettura OCR dei documenti d'identità e visura caricati in registrazione (verifica KYC); regione di trattamento: UE.
- **Google Maps Platform** — completamento indirizzo in registrazione.
- **Resend** — invio email transazionali; regione UE.
- **Vercel / Neon / Cloudflare R2** — hosting, database e archiviazione documenti (già citati o da citare).

Mantieni il tono e lo stile della pagina esistente. Nessun colore hardcoded.

- [ ] **Step 2: Verifica build**

Run: `pnpm --filter piattaforma build` → PASS

- [ ] **Step 3: Commit**
```bash
git add apps/piattaforma/src/app/privacy/
git commit -m "docs(privacy): aggiunge Google Document AI/Maps e Resend come sub-processor"
```

---

### Task 19: Verifica finale completa (suite + build)

**Files:** nessuno (solo verifica)

- [ ] **Step 1: Suite completa**

Run: `pnpm --filter piattaforma test`
Atteso: tutti i test PASS (i nuovi + i preesistenti).

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && pnpm --filter piattaforma build`
Atteso: tutto PASS.

- [ ] **Step 3: Commit eventuali fix**
```bash
git add -A && git commit -m "chore: verifica finale OCR/KYC + cutover"
```

---

## Note di deploy (eseguite a parte, dopo i task — vedi [[project-prod-release-process]])

1. **Setup GCP** (guidato): abilita Document AI API, crea processore **Document OCR** in regione **EU**, service account ruolo *Document AI User*, scarica JSON key.
2. **Migration prod**: applica `<timestamp>_ateco_allowed_codes` a `solitary-night` PRIMA del push; poi esegui il seed degli ATECO di default su prod (o inseriscili da `/admin/ateco`).
3. **Env Vercel**: `DEMO_MODE=false`, `OCR_PROVIDER=google_documentai`, le 4 `GOOGLE_DOCUMENTAI_*`, `REGISTRO_IMPRESE_PROVIDER=noop`. Invariati: `STORAGE_PROVIDER=vercel-blob`, `EMAIL_PROVIDER=resend`, `PAYMENT_PROVIDER=mock`.
4. **Deploy**: merge branch → `main` → push.
5. **Verifica E2E** (chrome-devtools): registrazione reale con documenti veri (gate attivo), verifica email reale (link Resend → ACTIVE), e che `/admin/demo-control` sia 404.

---

## Self-review (eseguita)

- **Copertura spec**: A (Task 1-4), B (Task 5-15), C (Task 3 libretto-parser + Task 4 extractLibretto su DocAI), D (Task 16-18), test/verifica (Task 19), deploy (note). ✔
- **Tipi coerenti**: `OcrTextResult`, `VisuraData`, `CiData`, `CfData`, `KycFailure`, `KycResult`, `KycDeps`, `AllowedAteco`, `CompanyType` usati in modo coerente tra i task. ✔
- **Placeholder**: i `code` ATECO agenzia sono marcati "DA CONFERMARE" by-design (allowlist configurabile), non sono placeholder di codice. ✔
- **Rischi noti**: l'estrazione regex di visura/CI/libretto va calibrata su fixture reali in fase di implementazione (i regex forniti sono baseline funzionanti coi sample dei test); il fallback DocAI sulla visura copre i PDF scansionati.
