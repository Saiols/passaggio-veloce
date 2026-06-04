# Produzione reale: OCR Google Document AI + KYC registrazione + cutover — Design

**Data:** 2026-06-04
**Autore:** Francesco Sioli (CTO) + Claude
**Stato:** approvato (design)

## Goal

Portare la piattaforma a funzionare **come produzione reale** (niente più dati mock, letture vere, logiche vere) **tranne i pagamenti** (in attesa dell'integrazione Stripe). Il cuore è la **KYC in registrazione**: leggere via OCR i documenti caricati e **bloccare al submit** le iscrizioni non valide. L'OCR viene unificato su **Google Document AI**.

## Decisioni acquisite (dal brainstorming)

1. **Gating sincrono**: la verifica OCR/KYC gira al submit finale, blocca la registrazione se fallisce (niente coda async).
2. **OCR unificato su Google Document AI**: un solo fornitore (account GCP esistente, quello di Maps); Document AI gestisce sia la KYC sia il libretto delle pratiche. Mindee resta come **fallback configurabile** (codice non cancellato).
3. **Cross-check**: lo step 1 (Account/login) è ignorato nel gating. Si verifica: visura ↔ step 2 azienda (denominazione/P.IVA); amministratore in visura ↔ documenti caricati (CI per nome/cognome, Tessera/CF per codice fiscale).
4. **OCR illeggibile** (foto sfocata, campo non estraibile) → **blocco con invito a ricaricare** quel documento, distinto dal mismatch.
5. **ATECO allowlist configurabile da admin**, separata dealer/agenzia, con seed di default; match per **prefisso**.
6. **Pagamenti**: con `PAYMENT_PROVIDER=mock` i job NON eseguono; payout restano `RICHIESTO`, addebiti `SCHEDULED` (nessun finto movimento). Si sbloccano con Stripe.
7. **DEMO_MODE spento** in produzione.
8. **Registro Imprese**: in prod ritorna `null` (niente dati finti), resta seam per il futuro account.
9. **Matching**: CF e P.IVA esatti dopo normalizzazione; nomi/denominazione con confronto tollerante (rumore OCR).

---

## Workstream A — Provider Google Document AI (fondazione)

### A.1 Interfaccia OCR (estensione)
File: `apps/piattaforma/src/lib/providers/ocr/types.ts`

Aggiungere al contratto `OcrProvider`:
```ts
export type OcrTextResult = {
  text: string;          // testo completo estratto
  confidence: number;    // 0..1 (media confidence pagine/token)
  pages: number;
};

export interface OcrProvider {
  readonly name: OcrProviderName;
  extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData>;
  extractText(input: OcrExtractInput): Promise<OcrTextResult>; // NUOVO
}
```
`OcrExtractInput` resta `{ buffer, mimeType, originalFilename? }`.

### A.2 Implementazione `google_documentai`
File: `apps/piattaforma/src/lib/providers/ocr/google-documentai.ts` (nuovo) + case in `index.ts` (oggi lancia "not implemented").

- Client `@google-cloud/documentai` (`DocumentProcessorServiceClient`), regione **EU** (`eu`).
- Credenziali da env (Vercel non ha filesystem): JSON service-account in `GOOGLE_DOCUMENTAI_CREDENTIALS_JSON`, passato al client come `credentials` (oggetto parsato) + `apiEndpoint: 'eu-documentai.googleapis.com'`.
- Un solo **processore "Document OCR"** (`processOcr`): input `{ rawDocument: { content: buffer.toString('base64'), mimeType } }` → `document.text` + `document.pages[].layout.confidence`.
- `extractText()`: ritorna `{ text: document.text, confidence: media, pages }`.
- `extractLibretto()`: chiama `extractText()` e applica il **parser libretto** (Workstream C) sul testo.
- Errori (auth, quota, timeout) → `OcrFailedError`.

### A.3 Mock provider (test/CI)
File: `apps/piattaforma/src/lib/providers/ocr/mock.ts` — aggiungere `extractText()` che ritorna testo deterministico (per i test del parser/verify). Nessuna chiamata di rete nei test.

### A.4 Env
File: `apps/piattaforma/src/env.ts`
```ts
GOOGLE_DOCUMENTAI_PROJECT_ID: z.string().optional(),
GOOGLE_DOCUMENTAI_LOCATION: z.string().default('eu'),
GOOGLE_DOCUMENTAI_PROCESSOR_ID: z.string().optional(),
GOOGLE_DOCUMENTAI_CREDENTIALS_JSON: z.string().optional(), // service-account JSON
```
`OCR_PROVIDER` ha già `'google_documentai'`. Il factory valida che le 4 var siano presenti quando `OCR_PROVIDER=google_documentai`.

### A.5 GDPR
Document AI tratta documenti d'identità (dati particolari) → regione **EU** obbligatoria, DPA Google Cloud standard, menzione in privacy policy (Workstream D).

---

## Workstream B — KYC registrazione (gating sincrono)

### B.1 Flusso
File: `apps/piattaforma/src/app/(auth)/actions.ts` (`registerAction`)

```
1. Leggi i 4 file dal FormData (già fatto) + valida presenza/size/mime (già fatto: validateRegistrationDocuments)
2. Buffer dei file (arrayBuffer)
3. [GATE KYC]  verifyRegistrationKyc({ files, company, allowedAteco, now })
     - se !passed → return { ok:false, error, kycFailures } (NIENTE storage, NIENTE transazione)
4. se passed → storage.put (riusa i buffer) → $transaction (company/user/documenti)
     - persisti per documento: ocrStato=SUCCESS, ocrProvider, ocrAt, ocrData (campi estratti)
     - Company.visuraCameraleData = data emissione estratta
     - gatingStato=PASSED
5. resto invariato (email verifica, ecc.)
```
Il gate è **prima** di storage/transazione: un blocco non lascia nulla a metà. I 3 OCR (CI, CF; la visura è parsing PDF + eventuale fallback DocAI) girano in **parallelo** (`Promise.all`). Aggiungere `export const maxDuration = 60;` alla route che ospita l'azione (o config server action) per stare nei limiti Vercel.

### B.2 Parser visura
File: `apps/piattaforma/src/lib/kyc/visura-parser.ts` (nuovo)

- PDF → testo con **`unpdf`** (serverless-friendly, no native deps). Se il testo è vuoto/povero (visura scansionata) → **fallback** `getOcr().extractText()` sul PDF.
- Dal testo, estrai con regex/euristiche etichettate:
  - `dataEmissione` (ISO) — riga tipo "Il presente documento … estratto il GG/MM/AAAA" / "Data: GG/MM/AAAA".
  - `ateco` — pattern `\d{2}[.]\d{1,2}([.]\d{1,2})?` vicino a "ATECO"/"Codice attività".
  - `denominazione` — riga "Denominazione" / intestazione.
  - `partitaIva` — `\d{11}` vicino a "Partita IVA"/"P.IVA".
  - `amministratore` — sezione amministratori/cariche: `nome`, `cognome`, `codiceFiscale` (pattern CF).
- Output:
```ts
export type VisuraData = {
  dataEmissione?: string; ateco?: string; denominazione?: string; partitaIva?: string;
  amministratore?: { nome?: string; cognome?: string; codiceFiscale?: string };
  rawText: string;
};
```

### B.3 Estrazione CI / CF
File: `apps/piattaforma/src/lib/kyc/extract-ci.ts`, `extract-cf.ts` (nuovi)
- Input: `OcrTextResult` (da `getOcr().extractText`).
- `extractCi(text): CiData` dove `CiData = { nome?: string; cognome?: string; rawText: string }`. CIE/CI cartacea: parsing campi "Cognome"/"Nome" + **MRZ** (righe finali `IDITA…`) come fonte robusta.
- `extractCf(text): CfData` dove `CfData = { codiceFiscale?: string; rawText: string }`. Regex CF `[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]` (Tessera Sanitaria ha il CF in chiaro).

### B.4 Matching (logica pura)
File: `apps/piattaforma/src/lib/kyc/match.ts` (nuovo)
```ts
normalizeName(s): string        // upper, no accenti, solo lettere, spazi singoli
normalizeCompanyName(s): string // come sopra + rimuove forma giuridica (SRL, S.R.L., SPA, SNC, SAS, SS, SAPA, …)
normalizeCf(s): string          // upper, trim, no spazi
normalizePiva(s): string        // solo cifre
isValidCodiceFiscale(cf): bool  // algoritmo checksum CF
nameMatches(a, b): bool         // token-set: tutti i token del più corto presenti nell'altro, con tolleranza Levenshtein per token (ratio ≥ 0.85)
companyMatches(visura, step2): bool // piva esatta OPPURE denominazione normalizzata uguale
```
CF e P.IVA → **match esatto** dopo normalizzazione. Nomi/denominazione → **tollerante**.

### B.5 ATECO configurabile
- **Modello Prisma** (`packages/db/prisma/schema.prisma`):
```prisma
model AtecoAllowedCode {
  id          String      @id @default(uuid()) @db.Uuid
  companyType CompanyType // DEALER | AGENZIA (enum esistente)
  code        String      // normalizzato senza punti, es. "4511"
  label       String?
  active      Boolean     @default(true)
  createdById String?     @db.Uuid
  createdAt   DateTime    @default(now())
  @@unique([companyType, code])
  @@map("ateco_allowed_codes")
}
```
- File `apps/piattaforma/src/lib/kyc/ateco.ts`: `normalizeAteco(s)` (rimuove punti/spazi), `isAtecoAllowed(visuraAteco, allowed[])` → `allowed.some(a => norm(visuraAteco).startsWith(a.code))`.
- **Admin** `apps/piattaforma/src/app/admin/ateco/{page,actions,client}.tsx`: CRUD (crea/attiva-disattiva) con guard `isAdminPiattaforma`, link nav "ATECO".
- **Seed di default** (migration data o seed.ts): dealer = `4511`, `45111`, `45112`, `4519`, `453`, `4531`, `4532`, `454` (gruppo 45 commercio autoveicoli/ricambi/moto); agenzia = lista iniziale conservativa da confermare col commercialista (es. `8211`, `8299`) — marcata come "da confermare".

### B.6 Orchestratore
File: `apps/piattaforma/src/lib/kyc/verify.ts` (nuovo)
```ts
export type KycFailure = {
  rule: 'VISURA_SCADUTA'|'ATECO_NON_IDONEO'|'AZIENDA_MISMATCH'|'CI_MISMATCH'|'CF_MISMATCH'|'ILLEGGIBILE';
  doc?: 'CI'|'CF'|'VISURA';
  message: string; // testo IT per l'utente
};
export type KycResult =
  | { passed: true; extracted: { visura: VisuraData; ci: CiData; cf: CfData } }
  | { passed: false; failures: KycFailure[] };

export async function verifyRegistrationKyc(args: {
  files: { ciFronte: OcrExtractInput; ciRetro?: OcrExtractInput; codiceFiscale: OcrExtractInput; visura: OcrExtractInput };
  company: { ragioneSociale: string; partitaIva: string; type: CompanyType };
  allowedAteco: AtecoAllowedCode[];
  now?: Date;
}): Promise<KycResult>
```
Logica: estrai (parallelo) → per ogni campo mancante necessario a una regola → `ILLEGGIBILE` sul doc relativo. Poi valuta regole 1-5 (sezione C del design originale), accumula tutte le failure (non short-circuit, così l'utente vede tutti i problemi insieme). `VISURA_MAX_AGE_MONTHS = 5`.

### B.7 UI wizard
File: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`
- Durante il submit: spinner "Verifica documenti in corso…" (l'OCR richiede qualche secondo).
- Su `kycFailures`: torna allo step Documenti, evidenzia i documenti coinvolti, mostra i `message` puntuali. Es. CI_MISMATCH → "Il nome sulla carta d'identità non corrisponde all'amministratore in visura".
- `RegisterActionResult` (variante errore) estesa: `{ ok:false; error:string; kycFailures?: KycFailure[] }`.

---

## Workstream C — Migrazione libretto → Document AI

File: `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts` (nuovo) usato da `google-documentai.ts#extractLibretto`.
- Input: testo Document OCR del libretto. Estrai con euristiche:
  - `targa` — pattern targa IT (`[A-Z]{2}\d{3}[A-Z]{2}`).
  - `telaio` — VIN 17 caratteri (`[A-HJ-NPR-Z0-9]{17}`).
  - `dataImmatricolazione` — data vicino a campo "B"/"immatricolazione".
  - `proprietarioAttuale` — sezione intestatario.
  - `preImm2015`, `flagComodatoDuso` (presenza "COMODATO"), `confidenceScore` dalla confidence OCR.
- È **pre-compilazione editabile** in creazione pratica (`pratiche/nuova`): l'utente conferma/corregge, quindi una precisione leggermente inferiore a Mindee non blocca.
- **Mindee resta** (`mindee.ts` non cancellato): `OCR_PROVIDER=mindee` continua a funzionare come fallback.

---

## Workstream D — Cutover produzione

### D.1 DEMO_MODE off
- `DEMO_MODE=false` su Vercel (tutti gli env scope) e in `.env.local`.
- Effetti automatici (già implementati): verifica email obbligatoria, token non più in chiaro, tempistiche reali (auto-addebito 20gg, solleciti 5gg), `/admin/demo-control` → 404, banner via.

### D.2 Guard pagamenti
File: `apps/piattaforma/src/lib/providers/payment/index.ts` o helper `apps/piattaforma/src/lib/jobs/payment-live.ts`:
```ts
export function isPaymentLive(): boolean { return env.PAYMENT_PROVIDER !== 'mock'; }
```
Nei job `process-payouts.ts`, `process-fee-scheduled.ts`, `trigger-auto-payout.ts`: se `!isPaymentLive()` → **non chiamare il provider**, log "[payment] esecuzione sospesa: in attesa Stripe", lasciare gli stati invariati (payout `RICHIESTO`, addebiti `SCHEDULED`). La UI payout resta utilizzabile (richiesta → "in elaborazione").

### D.3 Registro Imprese → null
File: `apps/piattaforma/src/lib/providers/registro-imprese/index.ts` (o il mock): in prod (provider non reale) `lookupByPiva` ritorna `null` invece di dati finti. La chiamata best-effort in `registerAction` resta (logga "non disponibile"). Seam invariato per il futuro account.

### D.4 Verifica email end-to-end
Collaudo del flusso reale (token → email Resend → `/verify-email` → ACTIVE) con chrome-devtools dopo il deploy.

### D.5 Privacy policy
File: pagina privacy (`apps/piattaforma/src/app/privacy/…`): aggiungere Google Document AI (OCR documenti, regione EU), Google Maps, Resend come responsabili/sub-processor del trattamento.

### D.6 Env da impostare (Vercel + locale)
```
DEMO_MODE=false
OCR_PROVIDER=google_documentai
GOOGLE_DOCUMENTAI_PROJECT_ID=…
GOOGLE_DOCUMENTAI_LOCATION=eu
GOOGLE_DOCUMENTAI_PROCESSOR_ID=…
GOOGLE_DOCUMENTAI_CREDENTIALS_JSON={…service account…}
# invariati: STORAGE_PROVIDER=vercel-blob, EMAIL_PROVIDER=resend, PAYMENT_PROVIDER=mock
```

---

## Modello dati (riepilogo migrazioni)
- **Nuovo**: `AtecoAllowedCode` (+ seed default).
- `Documento`: campi OCR/gating **già presenti** (`ocrStato`, `ocrData`, `ocrProvider`, `ocrAt`, `ocrError`, `gatingStato`, …). Nessuna modifica schema, solo valorizzazione reale.
- `Company.visuraCameraleData` già presente → valorizzata con la data emissione estratta.
- I dati estratti completi (ATECO, amministratore) vivono in `Documento.ocrData` (JSON) per audit.

## Gestione errori
- OCR/DocAI fallisce tecnicamente → `OcrFailedError` → mappato a `ILLEGGIBILE`/"riprova" (blocco, niente account).
- Visura senza testo → fallback DocAI; se ancora vuota → `ILLEGGIBILE` "carica il PDF originale".
- Mismatch (dato leggibile ma non combacia) → failure specifica con messaggio.
- Nessun account/file creato in caso di blocco (gate prima di storage/transazione).

## Strategia di test
- Unit (provider **mock**, niente rete): `match.ts` (normalizzazioni, CF checksum, P.IVA, nomi tolleranti), `visura-parser.ts` (fixture testo → campi), `ateco.ts` (prefisso/allowlist per tipo), `libretto-parser.ts`, `verify.ts` (tutti i casi: pass, ogni mismatch, illeggibile, visura scaduta, ATECO non idoneo).
- Guard pagamenti: test che con `PAYMENT_PROVIDER=mock` i job non chiamano il provider e lasciano gli stati.
- Smoke E2E (chrome-devtools) post-deploy: registrazione reale con documenti veri (DEMO off).

## Setup esterno richiesto (GCP) — guida al momento dell'esecuzione
Sull'account GCP esistente: abilitare **Document AI API**; creare processore **Document OCR** in regione **EU**; creare **service account** con ruolo *Document AI User*; scaricare la **chiave JSON**. Fornire: project ID, location `eu`, processor ID, JSON key (→ env). Citare il DPA Google e aggiornare la privacy policy.

## Fuori scope / follow-up
- Integrazione Stripe (sblocca i pagamenti reali).
- Provider reale Registro Imprese (openapi/infocamere) quando l'account è attivo.
- Eventuale processore Document AI dedicato/custom per visura o libretto se l'estrazione euristica risultasse insufficiente.
- Conferma definitiva allowlist ATECO col commercialista.

## Sequenza di esecuzione
A (provider DocAI) → B (KYC gating) → C (libretto su DocAI) → D (cutover: env, guard pagamenti, registro null, demo off, privacy) → deploy + verifica E2E.
