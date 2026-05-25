# Sprint OCR — Fase 1 Mindee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire `MockOcrProvider` con `MindeeOcrProvider` reale per estrazione dati libretto di circolazione, abilitando i beta tester ad usare il vero OCR su prod test.

**Architecture:** Implementazione concreta dell'interfaccia `OcrProvider` esistente (in `apps/piattaforma/src/lib/providers/ocr/types.ts`). L'app non cambia il modo in cui chiama l'OCR: lo switch tra `mock` / `mindee` / (futuro) `google_documentai` è guidato dalla sola env var `OCR_PROVIDER`. Su errore Mindee il chiamante (server action wizard) gracefully degrades a form vuoto editabile invece di lanciare 500.

**Tech Stack:** TypeScript, Next.js 16 server actions, Vitest, Zod env validation (`@t3-oss/env-nextjs`), Mindee Custom-Built API via REST (`fetch` nativo, niente SDK npm).

**Spec di riferimento:** `docs/superpowers/specs/2026-05-25-ocr-sprint-design.md`

**Scope:** solo Fase 1 (Mindee). Fase 2 (Google Document AI) ha un piano dedicato separato che verrà scritto quando il DB beta avrà ≥30 libretti reali raccolti — è bloccata da training set + account GCP, non pianificabile ora.

**Prerequisiti esterni (owner: Francesco, NON in questo piano):**
- Account Mindee aziendale (https://platform.mindee.com)
- Accesso al modello pre-trained **European Vehicle Registration** in Libraries → EU Documents. **Nessun training necessario**: il modello è già addestrato da Mindee — non servono 5-10 libretti per training.
- API key Mindee (`MINDEE_API_KEY`) — da Account Settings → API Keys
- UUID del modello (`MINDEE_MODEL_ID`, es. `3788acbb-63ba-4554-b7d0-b1937e14eb14`) — visibile nel tab "Documentation" del modello nella dashboard Mindee. Non più `MINDEE_ENDPOINT_URL`: il V2 SDK gestisce gli endpoint internamente.
- 5-10 libretti reali di test (anonimizzati o autorizzati) per smoke test finale (accuratezza, non training)

---

## File Structure

```
apps/piattaforma/src/
├── lib/providers/ocr/
│   ├── types.ts                [MOD]  add 'mindee' to OcrProviderName union
│   ├── mock.ts                 [unchanged]
│   ├── mindee.ts               [NEW]  MindeeOcrProvider implementation
│   ├── mindee.test.ts          [NEW]  unit tests (mocked fetch)
│   └── index.ts                [MOD]  add 'mindee' switch case in getOcr()
├── env.ts                      [MOD]  add MINDEE_API_KEY, MINDEE_ENDPOINT_URL, expand OCR_PROVIDER enum
└── app/pratiche/nuova/
    └── actions.ts              [MOD]  wrap extractLibretto in try/catch, return graceful error

apps/piattaforma/.env.example   [MOD]  document new env vars
docs/piano-implementazione.md   [MOD]  update FASE 3.2 status
```

Ogni file ha responsabilità chiara:
- `types.ts` definisce il contratto (interface, enum nomi, error class)
- `mindee.ts` implementa il provider Mindee, niente altro
- `mindee.test.ts` testa il mapping risposta Mindee → `LibrettoCircolazioneData` con `fetch` mockato
- `index.ts` (factory) decide quale provider instanziare in base a env, sola responsabilità
- `env.ts` valida le env vars all'avvio app
- `actions.ts` gestisce l'errore OCR a livello server action (gracious degrade UX)

---

## Task 1: Aggiornare `OcrProviderName` in `types.ts`

**Files:**
- Modify: `apps/piattaforma/src/lib/providers/ocr/types.ts:1`

- [ ] **Step 1: Modifica `OcrProviderName` per includere `'mindee'`**

```ts
export type OcrProviderName = 'mock' | 'mindee' | 'google_documentai';
```

- [ ] **Step 2: Verifica typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore. Il file `mindee.ts` non esiste ancora ma non è importato da nessuna parte, quindi il typecheck passa.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/lib/providers/ocr/types.ts
git commit -m "feat(ocr): add 'mindee' to OcrProviderName union"
```

---

## Task 2: Estendere `env.ts` con env vars Mindee

**Files:**
- Modify: `apps/piattaforma/src/env.ts:26` (server schema), `apps/piattaforma/src/env.ts:48` (runtimeEnv)

- [ ] **Step 1: Aggiungere `'mindee'` a `OCR_PROVIDER` enum + 2 nuove env vars opzionali**

Nel blocco `server: { ... }`, sostituire la riga:
```ts
OCR_PROVIDER: z.enum(['mock', 'google_documentai']).default('mock'),
```
con:
```ts
OCR_PROVIDER: z.enum(['mock', 'mindee', 'google_documentai']).default('mock'),
MINDEE_API_KEY: z.string().optional(),
MINDEE_ENDPOINT_URL: z.string().url().optional(),
```

- [ ] **Step 2: Cablare le 2 nuove env vars in `runtimeEnv`**

Nel blocco `runtimeEnv: { ... }`, aggiungere subito dopo `OCR_PROVIDER: process.env.OCR_PROVIDER,`:
```ts
MINDEE_API_KEY: process.env.MINDEE_API_KEY,
MINDEE_ENDPOINT_URL: process.env.MINDEE_ENDPOINT_URL,
```

- [ ] **Step 3: Verifica typecheck + boot env locale**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

Run: `cd apps/piattaforma && pnpm dev` per ~5 secondi, poi Ctrl+C.
Expected: il server parte senza throw di env validation (le nuove vars sono optional, OCR_PROVIDER default `mock` resta valido senza le altre).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/env.ts
git commit -m "feat(env): add MINDEE_API_KEY, MINDEE_ENDPOINT_URL, expand OCR_PROVIDER enum"
```

---

## Task 3: TDD — `MindeeOcrProvider`, scrivi i test prima

**Files:**
- Create: `apps/piattaforma/src/lib/providers/ocr/mindee.test.ts`

- [ ] **Step 1: Scrivi i test fallenti**

Crea il file `apps/piattaforma/src/lib/providers/ocr/mindee.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindeeOcrProvider } from './mindee';
import { OcrFailedError } from './types';

const API_KEY = 'test-key';
const ENDPOINT = 'https://api.mindee.net/v1/products/u/libretto/v1/predict';

describe('MindeeOcrProvider', () => {
  const provider = new MindeeOcrProvider(API_KEY, ENDPOINT);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockMindeeResponse(prediction: Record<string, unknown>, status = 200) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          document: { inference: { prediction } },
        }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  it('exposes name = "mindee"', () => {
    expect(provider.name).toBe('mindee');
  });

  it('maps a full Mindee response to LibrettoCircolazioneData with normalized fields', async () => {
    mockMindeeResponse({
      targa: { value: 'fa 123 gh', confidence: 0.95 },
      telaio: { value: 'zfa19500005123456', confidence: 0.92 },
      proprietario_attuale: { value: 'Mario Rossi', confidence: 0.9 },
      data_immatricolazione: { value: '2012-06-15', confidence: 0.88 },
      flag_comodato_uso: { value: 'no', confidence: 0.99 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('fake pdf'),
      mimeType: 'application/pdf',
      originalFilename: 'libretto.pdf',
    });

    expect(result.targa).toBe('FA123GH');
    expect(result.telaio).toBe('ZFA19500005123456');
    expect(result.proprietarioAttuale).toBe('Mario Rossi');
    expect(result.dataImmatricolazione).toBe('2012-06-15');
    expect(result.preImm2015).toBe(true);
    expect(result.flagComodatoDuso).toBe(false);
    expect(result.confidenceScore).toBeCloseTo((0.95 + 0.92 + 0.9 + 0.88) / 4, 3);
  });

  it('flags comodato d\'uso when Mindee returns "sì"', async () => {
    mockMindeeResponse({
      targa: { value: 'AB123CD', confidence: 0.9 },
      flag_comodato_uso: { value: 'sì', confidence: 0.95 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });

    expect(result.flagComodatoDuso).toBe(true);
  });

  it('handles missing data_immatricolazione gracefully', async () => {
    mockMindeeResponse({
      targa: { value: 'CD456EF', confidence: 0.85 },
      telaio: { value: 'ABCDEFGH123456789', confidence: 0.8 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
    });

    expect(result.dataImmatricolazione).toBeUndefined();
    expect(result.preImm2015).toBe(false);
  });

  it('marks post-2015 vehicles correctly', async () => {
    mockMindeeResponse({
      data_immatricolazione: { value: '2020-03-01', confidence: 0.9 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'application/pdf',
    });

    expect(result.preImm2015).toBe(false);
  });

  it('returns confidenceScore 0 when no fields have confidence', async () => {
    mockMindeeResponse({});

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'application/pdf',
    });

    expect(result.confidenceScore).toBe(0);
  });

  it('throws OcrFailedError on HTTP 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(
      provider.extractLibretto({
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('throws OcrFailedError on HTTP 500', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Server error', { status: 500 }),
    );

    await expect(
      provider.extractLibretto({
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('sends the file as multipart form-data with Authorization header', async () => {
    mockMindeeResponse({ targa: { value: 'XX000XX', confidence: 0.9 } });

    await provider.extractLibretto({
      buffer: Buffer.from('hello'),
      mimeType: 'application/pdf',
      originalFilename: 'mybook.pdf',
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: `Token ${API_KEY}` });
    expect(init.body).toBeInstanceOf(FormData);
  });
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd apps/piattaforma && pnpm vitest run src/lib/providers/ocr/mindee.test.ts`
Expected: FAIL con errore "Cannot find module './mindee'" o equivalente (il file non esiste ancora).

- [ ] **Step 3: Commit (test rosso intenzionale)**

```bash
git add apps/piattaforma/src/lib/providers/ocr/mindee.test.ts
git commit -m "test(ocr): add failing tests for MindeeOcrProvider"
```

---

## Task 4: Implementare `MindeeOcrProvider`

**Files:**
- Create: `apps/piattaforma/src/lib/providers/ocr/mindee.ts`

- [ ] **Step 1: Scrivi l'implementazione minimale**

Crea il file `apps/piattaforma/src/lib/providers/ocr/mindee.ts`:

```ts
import 'server-only';
import {
  type LibrettoCircolazioneData,
  type OcrExtractInput,
  type OcrProvider,
  OcrFailedError,
} from './types';

type MindeeField = { value?: string; confidence?: number };

type MindeePrediction = {
  targa?: MindeeField;
  telaio?: MindeeField;
  proprietario_attuale?: MindeeField;
  data_immatricolazione?: MindeeField;
  flag_comodato_uso?: MindeeField;
};

type MindeeResponse = {
  document: {
    inference: {
      prediction: MindeePrediction;
    };
  };
};

export class MindeeOcrProvider implements OcrProvider {
  readonly name = 'mindee' as const;

  constructor(
    private readonly apiKey: string,
    private readonly endpointUrl: string,
  ) {}

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const form = new FormData();
    form.append(
      'document',
      new Blob([input.buffer], { type: input.mimeType }),
      input.originalFilename ?? 'libretto',
    );

    const res = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>');
      throw new OcrFailedError(`Mindee HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as MindeeResponse;
    const p = json.document.inference.prediction;

    const dataIso = p.data_immatricolazione?.value;
    const year = dataIso ? parseInt(dataIso.slice(0, 4), 10) : null;
    const preImm2015 = year !== null && !Number.isNaN(year) && year < 2015;

    return {
      targa: p.targa?.value?.toUpperCase().replace(/\s+/g, ''),
      telaio: p.telaio?.value?.toUpperCase().replace(/\s+/g, ''),
      proprietarioAttuale: p.proprietario_attuale?.value,
      dataImmatricolazione: dataIso,
      preImm2015,
      flagComodatoDuso: p.flag_comodato_uso?.value === 'sì',
      confidenceScore: averageConfidence(p),
      rawText: undefined,
    };
  }
}

function averageConfidence(p: MindeePrediction): number {
  const scores = [
    p.targa?.confidence,
    p.telaio?.confidence,
    p.proprietario_attuale?.confidence,
    p.data_immatricolazione?.confidence,
  ].filter((c): c is number => typeof c === 'number');
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
```

- [ ] **Step 2: Esegui i test, verifica che passino tutti**

Run: `cd apps/piattaforma && pnpm vitest run src/lib/providers/ocr/mindee.test.ts`
Expected: PASS, 9 test verdi.

Se qualcuno fallisce, leggi l'errore e correggi (le cause più probabili: normalizzazione targa/telaio diversa dall'attesa nel test, oppure errore TypeScript per importazione tipi).

- [ ] **Step 3: Verifica typecheck globale**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/lib/providers/ocr/mindee.ts
git commit -m "feat(ocr): implement MindeeOcrProvider against Custom API"
```

---

## Task 5: Cablare `MindeeOcrProvider` nel factory `getOcr()`

**Files:**
- Modify: `apps/piattaforma/src/lib/providers/ocr/index.ts:1-22`

- [ ] **Step 1: Aggiorna il file factory completo**

Sostituisci il contenuto di `apps/piattaforma/src/lib/providers/ocr/index.ts` con:

```ts
import 'server-only';
import { env } from '@/env';
import { MockOcrProvider } from './mock';
import { MindeeOcrProvider } from './mindee';
import type { OcrProvider } from './types';

export * from './types';

let instance: OcrProvider | null = null;

export function getOcr(): OcrProvider {
  if (instance) return instance;
  switch (env.OCR_PROVIDER) {
    case 'mock':
      instance = new MockOcrProvider();
      break;
    case 'mindee':
      if (!env.MINDEE_API_KEY || !env.MINDEE_ENDPOINT_URL) {
        throw new Error(
          'MINDEE_API_KEY e MINDEE_ENDPOINT_URL sono obbligatori per OCR_PROVIDER=mindee',
        );
      }
      instance = new MindeeOcrProvider(env.MINDEE_API_KEY, env.MINDEE_ENDPOINT_URL);
      break;
    case 'google_documentai':
      throw new Error('Google Document AI OCR provider not yet implemented (Fase 2)');
    default:
      throw new Error(`Unknown OCR provider: ${env.OCR_PROVIDER}`);
  }
  return instance;
}
```

- [ ] **Step 2: Verifica typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 3: Verifica che la suite test pre-esistente continui a passare (regression)**

Run: `cd apps/piattaforma && pnpm test`
Expected: tutti i test passano (i pre-esistenti del MockProvider + i 9 nuovi di Mindee).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/lib/providers/ocr/index.ts
git commit -m "feat(ocr): wire MindeeOcrProvider in getOcr() factory"
```

---

## Task 6: Gracious degrade in `extractLibrettoAction`

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts:75-82`

Oggi `extractLibrettoAction` chiama `ocr.extractLibretto(...)` senza try/catch. Se Mindee throw `OcrFailedError`, l'utente vede una Next.js error boundary invece del form vuoto editabile. Lo wrappo per restituire `{ ok: false, error: ... }` coerente con il tipo `ExtractLibrettoResult` già esposto.

- [ ] **Step 1: Wrap della chiamata OCR in try/catch**

Sostituisci nel file `apps/piattaforma/src/app/pratiche/nuova/actions.ts` il blocco corrente (righe ~75-82):

```ts
  const buffer = await bufferFromFile(file);
  const ocr = getOcr();
  const data = await ocr.extractLibretto({
    buffer,
    mimeType: file.type,
    originalFilename: file.name,
  });
  return { ok: true, data };
```

con:

```ts
  const buffer = await bufferFromFile(file);
  const ocr = getOcr();
  try {
    const data = await ocr.extractLibretto({
      buffer,
      mimeType: file.type,
      originalFilename: file.name,
    });
    return { ok: true, data };
  } catch (e) {
    console.error('[ocr] extractLibretto failed', e);
    return {
      ok: false,
      error:
        'OCR non riuscito sul documento. Compila manualmente i campi del veicolo.',
    };
  }
```

- [ ] **Step 2: Verifica che il messaggio d'errore venga gestito lato client**

Apri `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` e cerca dove `extractLibrettoAction` viene chiamata (Grep `extractLibrettoAction` nel file). Verifica che il branch `result.ok === false` mostri il messaggio di `result.error` all'utente e permetta comunque di avanzare nel wizard inserendo i dati a mano.

Run: `cd apps/piattaforma && grep -n 'extractLibrettoAction' src/app/pratiche/nuova/wizard.tsx`

Se il branch error non esiste o nasconde il form, fermarsi e segnalare al lead — il fix UX wizard è fuori scope di questo task, ma va annotato come follow-up. Se il branch error c'è ed è già gestito (cosa attesa), procedere.

- [ ] **Step 3: Verifica typecheck**

Run: `cd apps/piattaforma && pnpm typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "fix(ocr): gracious degrade su OcrFailedError nel wizard pratica"
```

---

## Task 7: Aggiornare `.env.example` con istruzioni Mindee

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Trova la sezione OCR e aggiungi le righe Mindee**

Run: `grep -n 'OCR_PROVIDER' .env.example`

Se la riga `OCR_PROVIDER=...` non esiste nel file, aggiungerla. Aggiungere subito sotto:

```bash
# OCR provider: mock (dev), mindee (prod-test Fase 1), google_documentai (prod Fase 2)
OCR_PROVIDER=mock

# Mindee Custom-Built API (richiesto se OCR_PROVIDER=mindee).
# Setup: https://platform.mindee.com → Custom Document Extractor "libretto-circolazione".
# Campi configurati nel processor: targa, telaio, proprietario_attuale, data_immatricolazione, flag_comodato_uso.
MINDEE_API_KEY=
MINDEE_ENDPOINT_URL=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): document MINDEE_API_KEY and MINDEE_ENDPOINT_URL"
```

---

## Task 8: Smoke test manuale su prod test (gate: env vars reali fornite)

**Prerequisito:** Francesco ha completato il setup esterno e ha fornito `MINDEE_API_KEY` + `MINDEE_MODEL_ID` reali, più 5-10 libretti reali per il smoke test.

**Files:** nessun file modificato (testing manuale + dashboard Vercel).

- [ ] **Step 1: Configurare le env vars su Vercel (ambiente prod test)**

Vercel Dashboard → progetto piattaforma → Settings → Environment Variables → ambiente "Preview" o l'ambiente associato al link di test:
- `OCR_PROVIDER` = `mindee`
- `MINDEE_API_KEY` = `<valore reale>` (encrypted)
- `MINDEE_MODEL_ID` = `<UUID modello EU Vehicle Registration>` (plain, es. `3788acbb-63ba-4554-b7d0-b1937e14eb14`)

- [ ] **Step 2: Trigger redeploy del prod test**

Dalla dashboard Vercel: Deployments → ultimo deploy del branch test → ⋯ → Redeploy (così le env vars vengono caricate).

- [ ] **Step 3: Smoke test manuale**

Per ognuno dei 5-10 libretti reali forniti:
1. Login su prod test come utente dealer di test
2. `/pratiche/nuova` → upload libretto → step 1
3. Verifica nei campi pre-compilati: `targa`, `telaio`, `proprietarioAttuale`, `dataImmatricolazione`
4. Annota su un foglio: corretti / errati / mancanti per ogni campo

Soglia di accettazione (definizione di "done" per smoke test):
- ≥7/10 libretti hanno `targa` + `telaio` corretti
- Latenza ≤4s tipica per libretto (dal click "Upload" alla pre-compilazione)

- [ ] **Step 4: Verifica gracious degrade**

Test del fallback: temporaneamente cambiare `MINDEE_API_KEY` su Vercel a un valore invalido (es. `BROKEN`), redeploy, ritentare l'upload di un libretto.
Atteso: il wizard mostra il messaggio "OCR non riuscito sul documento. Compila manualmente i campi del veicolo." e i campi del form restano vuoti ma editabili — niente Next.js error boundary, niente 500.
Ripristinare la `MINDEE_API_KEY` corretta + redeploy.

- [ ] **Step 5: Se smoke test PASS, archiviare i risultati**

Salvare un commento conciso in `docs/piano-implementazione.md` con la data dello smoke, accuratezza misurata (es. "8/10 libretti con targa+telaio corretti, latenza media 2.8s") e link al deploy Vercel di riferimento.

---

## Task 9: Aggiornare `docs/piano-implementazione.md` (stato FASE 3.2)

**Files:**
- Modify: `docs/piano-implementazione.md` — sezione "FASE 3.2 OCR libretto di circolazione" e riga di stato FASE 3 nella tabella riassuntiva.

- [ ] **Step 1: Marcare come completati gli item Mindee**

Trovare le righe nella sezione `### 3.2 OCR libretto di circolazione`:
```
- [ ] Integrazione Google Document AI (richiede account, swap del provider)
```

Aggiungere subito sopra (NUOVA voce):
```
- [x] Integrazione Mindee Custom API (Fase 1 sprint OCR, 2026-05) — spec `docs/superpowers/specs/2026-05-25-ocr-sprint-design.md`, plan `docs/superpowers/plans/2026-05-25-ocr-mindee-fase1.md`
```

E nella tabella "Stato MVP" (cerca riga "3 Documenti/OCR/Pratiche"), aggiornare la nota da:
```
| 3 Documenti/OCR/Pratiche | ~75% | ... Manca solo OCR reale (Document AI) |
```
a:
```
| 3 Documenti/OCR/Pratiche | ~80% | ... OCR Mindee in prod test (Fase 1 sprint OCR 2026-05). Document AI custom-trained in attesa di raccolta libretti reali dal beta (Fase 2). |
```

- [ ] **Step 2: Commit**

```bash
git add docs/piano-implementazione.md
git commit -m "docs(plan): registra completamento Fase 1 OCR Mindee in prod test"
```

---

## Follow-up (NON in questo piano)

- **Fase 2 — Google Document AI custom-trained**: piano dedicato sarà scritto quando il DB beta avrà ≥30 libretti reali raccolti (query di check nel spec). Bloccato da: account GCP aziendale + ≥30 libretti reali nel DB + 4-8h umane di labelling.
- **Logging Mindee su Sentry**: se durante il beta emerge bisogno di monitoring strutturato (latenza, success rate, errori per libretto), aggiungere `Sentry.captureMessage` / `Sentry.captureException` nelle 2 path di `MindeeOcrProvider.extractLibretto`. Non in scope sprint perché il `console.error` del Task 6 + i log Vercel coprono il debug iniziale.
- **Upgrade piano Mindee Free → Starter**: quando il consumo supera 250 doc/mese (≈ 8-9 libretti/giorno), passare al piano Starter ~€50/mese 2000 doc. Owner: Francesco. Non blocca lo sprint.
