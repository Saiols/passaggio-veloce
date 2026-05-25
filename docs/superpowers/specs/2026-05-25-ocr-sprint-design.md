# Sprint OCR — Mindee → Document AI ibrido — Design

**Data**: 2026-05-25
**Autore**: Francesco Sioli (CTO) + Claude
**Scope**: portare `OCR_PROVIDER` da `mock` a provider reale per sbloccare i beta tester (dealer + agenzie reali su prod test). Strategia in 2 fasi: Mindee subito per partire in 3-5 giorni lavorativi, Document AI custom-trained dopo raccolta libretti reali dal beta per andare a regime con accuratezza e costo ottimali.
**Stato**: design approvato 2026-05-25, pronto per writing-plans.

## Obiettivo

Sostituire `MockOcrProvider` con un provider OCR reale, mantenendo invariata l'interfaccia `OcrProvider` esistente (`apps/piattaforma/src/lib/providers/ocr/types.ts`), così che il wizard nuova pratica e il gating documentale non richiedano cambi downstream.

**Target misurabili:**
- Fase 1: accuratezza ≥70% su 10 libretti reali di test (≥7/10 estrazioni con tutti i campi target corretti)
- Fase 2: accuratezza ≥95% sui campi `targa` + `telaio` sul validation set Document AI
- Costo a regime: ~€0,028/pagina (Document AI custom extractor) → ~€840/anno a target MVP

## Decisioni di scope (dalla brainstorming session 2026-05-25)

1. **Strategia ibrida 2 fasi**: Mindee oggi, Document AI dopo training set raccolto dal beta. La provider abstraction esistente (`OcrProvider` interface) permette di affiancare implementazioni concrete senza toccare il codice chiamante (wizard pratica, gating documentale); lo switch tra provider attivi è guidato dalla sola env var `OCR_PROVIDER`.
2. **Solo OCR in sprint**: niente Resend email, niente R2 storage, niente disclaimer beta in-app, niente completamento UI gating hard / countdown / dashboard fee. Tutto questo resta backlog non bloccante.
3. **Email rimane `console`**: Francesco gestisce manualmente onboarding e comunicazioni ai beta tester. Niente verify email reale richiesto durante il beta.
4. **Storage rimane Vercel Blob**: già attivo in prod test, soddisfa i requisiti di persistenza libretti per training set Fase 2.
5. **Modalità Mock-fallback**: se Mindee è down / API key esaurita / accuratezza inaccettabile, il sistema non blocca l'upload — il wizard mostra i campi vuoti e l'utente li compila a mano (UX già esistente, basta non lanciare exception non-recuperabili).
6. **Niente cambio dello schema `LibrettoCircolazioneData`**: i campi estratti restano `targa, telaio, proprietarioAttuale, dataImmatricolazione, preImm2015, flagComodatoDuso, confidenceScore, rawText`. Eventuali campi extra (kW, alimentazione, classeEuro) sono fuori scope sprint, restano backlog.

## Architettura

```
apps/piattaforma/src/
├── lib/providers/ocr/
│   ├── types.ts            [MOD]  + 'mindee' | 'google_documentai' in OcrProviderName
│   ├── mock.ts             [unchanged]
│   ├── mindee.ts           [NEW]  Fase 1
│   ├── google.ts           [NEW]  Fase 2
│   └── index.ts            [MOD]  switch case mindee/google + fallback mock se errore
├── lib/providers/ocr/
│   ├── mindee.test.ts      [NEW]  unit test mapping risposta → LibrettoCircolazioneData
│   └── google.test.ts      [NEW]  unit test mapping (Fase 2)
└── env.ts                  [MOD]  zod schema + env vars Mindee/GCP
```

**Cambi env (`.env.example` + Vercel):**

Fase 1:
- `OCR_PROVIDER=mindee` (era `mock`)
- `MINDEE_API_KEY=...` (segreto)
- `MINDEE_ENDPOINT_URL=...` (URL completo del Custom OCR endpoint dopo setup dashboard)

Fase 2 (additivo, non rimuove Mindee):
- `OCR_PROVIDER=google_documentai`
- `GCP_PROJECT_ID=...`
- `GCP_LOCATION=eu` (region EU per compliance GDPR)
- `DOCAI_PROCESSOR_ID=...`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON=...` (base64-encoded service account JSON)

## Fase 1 — MindeeOcrProvider (giorni 1-5)

### Setup esterno (owner: Francesco)

1. Sottoscrizione account Mindee aziendale (https://platform.mindee.com)
   - Piano consigliato per beta: Free (250 doc/mese) — sufficiente per primi 30-60 giorni di beta. Upgrade Starter (~€50/mese, 2000 doc) quando si avvicina la soglia.
2. Creazione **Custom-Built API** (non i template pre-addestrati)
   - Tipo: Custom Document Extractor
   - Campi da configurare (esattamente i campi di `LibrettoCircolazioneData`):
     - `targa` — text field
     - `telaio` — text field (numero VIN, 17 caratteri)
     - `proprietario_attuale` — text field
     - `data_immatricolazione` — date field
     - `flag_comodato_uso` — classification (sì/no, basato su presenza dicitura "comodato")
   - Training: upload 5-10 libretti italiani campione (Francesco fornisce)
   - Mindee Auto-Train: training automatico in pochi minuti
3. Generazione API key + URL endpoint custom (formato `https://api.mindee.net/v1/products/{username}/{endpoint_name}/v{version}/predict`)
4. Consegna a Claude: `MINDEE_API_KEY` + `MINDEE_ENDPOINT_URL`

### Implementazione (owner: Claude)

#### `src/lib/providers/ocr/mindee.ts`

```ts
import 'server-only';
import type {
  LibrettoCircolazioneData,
  OcrExtractInput,
  OcrProvider,
} from './types';
import { OcrFailedError } from './types';

type MindeePrediction = {
  document: {
    inference: {
      prediction: {
        targa?: { value?: string; confidence?: number };
        telaio?: { value?: string; confidence?: number };
        proprietario_attuale?: { value?: string; confidence?: number };
        data_immatricolazione?: { value?: string; confidence?: number };
        flag_comodato_uso?: { value?: string; confidence?: number };
      };
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
      throw new OcrFailedError(`Mindee API error: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as MindeePrediction;
    const p = json.document.inference.prediction;

    const dataIso = p.data_immatricolazione?.value;
    const year = dataIso ? parseInt(dataIso.slice(0, 4), 10) : null;

    return {
      targa: p.targa?.value?.toUpperCase().replace(/\s/g, ''),
      telaio: p.telaio?.value?.toUpperCase().replace(/\s/g, ''),
      proprietarioAttuale: p.proprietario_attuale?.value,
      dataImmatricolazione: dataIso,
      preImm2015: year !== null && year < 2015,
      flagComodatoDuso: p.flag_comodato_uso?.value === 'sì',
      confidenceScore: averageConfidence(p),
      rawText: undefined,
    };
  }
}

function averageConfidence(p: MindeePrediction['document']['inference']['prediction']): number {
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

**Note implementative:**
- Normalizzazione `targa` / `telaio`: uppercase + rimozione spazi (libretti italiani li scrivono con o senza spazi inconsistente).
- `flag_comodato_uso`: Mindee classification è in italiano (sì/no), si mappa direttamente.
- `confidenceScore`: media delle confidence dei campi critici (targa + telaio + proprietario + data), così il valore esposto al frontend è interpretabile (se <0.7 → badge "controlla i dati" nel wizard, UX già esistente).
- Niente retry interno: lasciato all'orchestratore (server action wizard). Se fallisce, throw `OcrFailedError` e il server action mostra il form vuoto editabile (UX gracious-degrade).

#### `src/lib/providers/ocr/index.ts` (modifica)

```ts
import 'server-only';
import { env } from '@/env';
import { MockOcrProvider } from './mock';
import { MindeeOcrProvider } from './mindee';
// import { GoogleDocumentAiOcrProvider } from './google'; // Fase 2

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
        throw new Error('MINDEE_API_KEY e MINDEE_ENDPOINT_URL obbligatori per OCR_PROVIDER=mindee');
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

**Niente fallback automatico Mindee → Mock nel provider**: se Mindee fallisce, il chiamante (server action wizard) gestisce l'errore catchando `OcrFailedError` e mostrando il form vuoto editabile. Questo evita di mascherare i fallimenti reali Mindee dietro dati mock plausibili che inquinerebbero il DB beta.

#### `src/env.ts` (modifica)

Aggiungere allo zod schema:
```ts
OCR_PROVIDER: z.enum(['mock', 'mindee', 'google_documentai']).default('mock'),
MINDEE_API_KEY: z.string().optional(),
MINDEE_ENDPOINT_URL: z.string().url().optional(),
```

E nel runtimeEnv corrispondente.

### Testing Fase 1

1. **Unit test** (`mindee.test.ts`): mock di `fetch`, 3 case:
   - Risposta valida tutti i campi → mapping corretto + `preImm2015` calcolato giusto
   - Risposta con `data_immatricolazione` mancante → `preImm2015=false`, dato `undefined`
   - Risposta HTTP 401 → throw `OcrFailedError`
2. **Smoke test manuale** (owner: Francesco + Claude):
   - 5-10 libretti reali (anonimizzati o autorizzati) caricati via wizard pratica esistente in prod test
   - Verifica: targa/telaio/proprietario corretti su ≥7/10
   - Misurazione latenza fetch (target < 4s per libretto)
   - Log Sentry su ogni chiamata Mindee con outcome (success / failure + reason)

### Definition of done Fase 1

- [ ] `MindeeOcrProvider` deployato in prod test con `OCR_PROVIDER=mindee`
- [ ] Smoke test su 10 libretti reali con accuratezza ≥7/10
- [ ] Fallback UX verificato: forzando un errore Mindee (es. API key invalida) il wizard mostra il form vuoto editabile, niente exception non gestita
- [ ] Unit test verdi
- [ ] `.env.example` aggiornato con commenti su dove ottenere le credenziali
- [ ] Aggiornamento `docs/piano-implementazione.md`: FASE 3.2 OCR libretto → "Mindee custom (Fase 1) in prod test, Document AI in attesa di training set"

## Fase 2 — GoogleDocumentAiOcrProvider (post raccolta ≥30 libretti reali)

### Trigger d'attivazione

Quando il DB prod test contiene ≥30 libretti reali caricati dai beta tester. Query di check:
```sql
SELECT COUNT(*) FROM "Documento"
WHERE "tipo" = 'LIBRETTO_CIRCOLAZIONE' AND "gatingStato" IN ('PASSED', 'OVERRIDDEN');
```

Realisticamente: 1-3 settimane dopo il go-live beta (a target 5-10 libretti/giorno tra tutti i dealer pilota).

### Setup esterno (owner: Francesco + Claude)

1. Creazione progetto GCP `passaggio-veloce-prod` (se non esistente) + abilitazione billing aziendale
2. Abilitazione Document AI API + creazione **Custom Extractor processor** (region `eu` per compliance GDPR)
3. Creazione service account `docai-prod@...iam.gserviceaccount.com` con ruolo `Document AI API User`, generazione key JSON
4. Encoding base64 della key JSON per `GOOGLE_APPLICATION_CREDENTIALS_JSON` env var (Vercel non supporta upload file)
5. **Labelling**: download dei libretti dal DB (Claude scrive script), upload nell'UI Document AI, etichettatura bounding box su:
   - `targa` (label)
   - `telaio` (label)
   - `proprietario_attuale` (label)
   - `data_prima_immatricolazione` (label)
   - `dicitura_comodato_uso` (label, opzionale — solo se presente nel libretto)
6. Training automatico (~1 ora compute Google) + validazione sul test set automatico
7. Deploy della versione trained come endpoint attivo del processor

### Implementazione (owner: Claude)

#### `src/lib/providers/ocr/google.ts`

Stesso pattern di `MindeeOcrProvider`:
- Costruttore riceve `projectId`, `location`, `processorId`, `credentialsJson`
- Usa il client ufficiale `@google-cloud/documentai` (Node SDK)
- Mapping risposta → `LibrettoCircolazioneData` con la stessa normalizzazione targa/telaio
- `confidenceScore` calcolato come media delle confidence dei campi entity Google

Pseudo-codice:
```ts
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

export class GoogleDocumentAiOcrProvider implements OcrProvider {
  readonly name = 'google_documentai' as const;
  private client: DocumentProcessorServiceClient;

  constructor(/* projectId, location, processorId, credentialsJson */) {
    this.client = new DocumentProcessorServiceClient({
      credentials: JSON.parse(Buffer.from(credentialsJson, 'base64').toString()),
    });
  }

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    const [result] = await this.client.processDocument({
      name,
      rawDocument: { content: input.buffer, mimeType: input.mimeType },
    });
    return mapEntities(result.document?.entities ?? []);
  }
}
```

#### `src/lib/providers/ocr/index.ts` (modifica)

Aggiungere il case `google_documentai` analogo a `mindee`. Mindee resta come provider valido — basta cambiare env var per switchare.

#### `src/env.ts` (modifica)

```ts
GCP_PROJECT_ID: z.string().optional(),
GCP_LOCATION: z.string().default('eu'),
DOCAI_PROCESSOR_ID: z.string().optional(),
GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),
```

### Testing Fase 2

1. **Unit test** (`google.test.ts`): mock del client `DocumentProcessorServiceClient`, mapping entity → `LibrettoCircolazioneData`
2. **Validation set Document AI** (UI Google): Google testa automaticamente sul 20% di documenti hold-out → metrica accuratezza per campo visibile nella dashboard processor
3. **Confronto A/B Mindee vs Document AI** su 20 libretti reali nuovi (non visti durante training):
   - Mindee accuracy baseline misurata in Fase 1
   - Document AI accuracy target ≥95% su targa + telaio
   - Document AI accuracy target ≥85% su proprietario + data

### Definition of done Fase 2

- [ ] Document AI custom processor trained con ≥30 libretti reali etichettati
- [ ] Validation accuracy ≥95% su targa + telaio
- [ ] `GoogleDocumentAiOcrProvider` deployato in prod test con `OCR_PROVIDER=google_documentai`
- [ ] A/B su 20 libretti nuovi documenta vantaggio Document AI rispetto a Mindee
- [ ] Aggiornamento `docs/piano-implementazione.md`: FASE 3.2 OCR libretto → completata, integrazione Document AI in prod

## Fuori scope

- Email Resend (rimane `ConsoleEmailProvider`)
- Cloudflare R2 storage (rimane Vercel Blob)
- Disclaimer beta in-app, video tutorial, widget supporto in-app
- Completamento gating documentale UI (blocco hard pre-invio, classificatore tipo documento esteso)
- FASE 3.5 Lotto massivo
- Anteprima documenti inline + download ZIP pratica
- Countdown 20gg UI agenzia, dashboard fee mensili
- Campi OCR aggiuntivi oltre quelli già nel tipo `LibrettoCircolazioneData` (kW, alimentazione, classe Euro)
- OCR su documenti diversi dal libretto (CI, CF, visura) — l'OCR è solo per libretto come oggi, gli altri documenti restano gating rule-based A4

## Blocchi e dipendenze

| Blocco | Owner | Sblocca |
|---|---|---|
| Account Mindee aziendale + API key + endpoint custom URL | Francesco | Fase 1 inizio |
| 5-10 libretti reali per training Mindee | Francesco | Fase 1 setup Mindee dashboard |
| Account GCP + billing aziendale | Francesco | Fase 2 setup |
| ≥30 libretti reali nel DB beta | Beta tester (organico, via uso reale) | Fase 2 labelling |
| 4-8h umane per labelling Document AI | Claude (con review Francesco) | Fase 2 training |

Nessuno di questi blocca l'inizio dell'altro: Fase 1 può partire appena Francesco fornisce credenziali Mindee, Fase 2 parte in parallelo appena il beta produce libretti a sufficienza.
