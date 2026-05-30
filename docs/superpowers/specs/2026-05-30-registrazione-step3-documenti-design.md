# Step 3 Registrazione — Upload Documenti KYC

**Data:** 2026-05-30
**Stato:** Design approvato
**Autore:** Francesco Sioli (CTO) + Claude

## Contesto

Lo step 3 del wizard di registrazione (`apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`, componente `DocumentsStep`) è oggi un placeholder: mostra un `Alert` "disponibile in Fase 3" e un pulsante "Avanti" che salta al pagamento senza raccogliere nulla.

La spec di prodotto prevede in questo step la raccolta dei documenti KYC dell'azienda:
- `docs/piano-implementazione.md` FASE 2.1 (righe 192-193): upload CI + CF amministratore, upload Visura Camerale (max 6 mesi) — entrambi rimandati a "Fase 3 con storage".
- `docs/analisi-progetto.md` (riga 25): documenti KYC azienda = CI + CF dell'amministratore + Visura Camerale (max 6 mesi).

### Infrastruttura già disponibile (riusata, non ricostruita)

- **`StorageProvider`** (`src/lib/providers/storage/`) con impl locale, già usato da `submitNuovaPraticaAction`.
- **Model `Documento`** (`packages/db/prisma/schema.prisma`): ha già sia `praticaId?` sia `companyId?` (relazione `DocumentiCompany`, commento esplicito "anagrafica aziendale (visura)"), più i campi storage/OCR/gating.
- **Enum `DocumentoTipo`**: già contiene `CI_FRONTE`, `CI_RETRO`, `CODICE_FISCALE`, `VISURA_CAMERALE`.
- **`classifyDocumento()`** (`src/lib/documenti/classifier.ts`): gating rule-based (MIME, dimensione min 30KB/max 10MB, hint fronte/retro sul nome file).

### Chiarimento sull'OCR (premessa fondamentale)

L'OCR implementato di recente usa il modello Mindee **"European Vehicle Registration"**, addestrato sul **libretto di circolazione**. Estrae targa/telaio/proprietario/data immatricolazione e basta. **Non sa leggere CI, codice fiscale o visura camerale.** Di conseguenza `extractLibretto()` **non è riutilizzabile** per lo step 3.

Per i documenti KYC non c'è quindi estrazione dati via OCR: si usa solo il gating rule-based (`classifyDocumento`). La vera validazione IA dei documenti d'identità (Google Document AI) resta parcheggiata a Fase 3.3 / Fase 2 ed è **fuori scope**.

## Decisioni di scope (concordate)

1. **Caricamento obbligatorio**: senza i documenti richiesti non si completa la registrazione.
2. **Account attivo subito dopo l'upload**: basta che i file siano presenti e superino il gating rule-based. La revisione admin avviene eventualmente dopo, **non bloccante** (e fuori scope per questa feature). Nessun cambiamento allo stato account attuale (`PENDING_EMAIL_VERIFICATION` → `ACTIVE` in `DEMO_MODE`).
3. **Documenti obbligatori**: CI fronte + CI retro (amministratore), Codice Fiscale / Tessera Sanitaria (immagine), Visura Camerale + data emissione (max 6 mesi).
4. **Persistenza data visura**: nuovo campo `Company.visuraCameraleData`.
5. **Verifica Registro Imprese**: in questa feature **solo upload manuale**; si predispone un provider abstraction `RegistroImpreseProvider` con impl mock, swap-ready (nessun account/costo ora).

## Architettura

### Flusso (Opzione A — raccolta in step 3, upload unico al submit)

```
Step 1 (Account) → Step 2 (Azienda) → Step 3 (Documenti) → Step 4 (Pagamento+T&C) → submit
                                          │ File tenuti in stato client          │
                                          └──────────── FormData ────────────────┘
                                                                                  ▼
                                          registerAction(FormData):
                                          1. parse payload JSON + valida (registerFullSchema)
                                          2. check unicità (email admin / P.IVA)
                                          3. valida file: gating rule-based + visura ≤ 6 mesi
                                          4. storage.put dei 4 file → storageKey
                                          5. transaction: Company + User + VerificationToken + 4× Documento(companyId)
                                          6. best-effort: getRegistroImprese().lookupByPiva(piva) (mock = no-op)
                                          7. DEMO_MODE activation + CRM match + referral notify (invariati)
```

**Ordine deliberato**: i file vengono validati *prima* di creare qualsiasi record (file invalido → errore, niente creato). L'`storage.put` avviene *prima* della transaction così i `Documento` si creano nella stessa transaction della Company avendo già il `companyId`. Se la transaction fallisce restano al massimo file orfani su storage (raro, ripulibili) — stesso compromesso già accettato in `submitNuovaPraticaAction`.

Questo riusa esattamente il pattern di `submitNuovaPraticaAction` (crea entità → poi/insieme carica file).

## Componenti

### 1. Step 3 UI — `DocumentsStep` (`register-wizard.tsx`)

Sostituisce il placeholder con un form a 4 slot di upload + 1 campo data.

| Campo | Tipo file | DocumentoTipo |
|---|---|---|
| CI amministratore — Fronte | PDF/JPG/PNG | `CI_FRONTE` |
| CI amministratore — Retro | PDF/JPG/PNG | `CI_RETRO` |
| Codice Fiscale / Tessera Sanitaria | PDF/JPG/PNG | `CODICE_FISCALE` |
| Visura Camerale | PDF/JPG/PNG | `VISURA_CAMERALE` |
| Data emissione visura | date | — (validazione ≤ 6 mesi) |

- Componente di upload coerente col design system (palette Trust Blue, componenti `src/components/ui`): input file con preview di nome + dimensione e pulsante "rimuovi". Nessun colore hardcoded.
- **Validazione client-side** (per abilitare "Avanti"): tutti e 4 i file presenti, MIME ∈ {pdf, jpg, png}, size ≤ 10 MB ciascuno, data visura presente e non più vecchia di 6 mesi.
- I `File` selezionati + la data visura vengono salvati in `WizardData.documents` (stato del wizard `RegisterWizard`), per essere allegati al submit dello step 4.
- `handleDocumentsSkip` viene rimosso/sostituito da `handleDocuments(values)` che salva i file in stato e avanza a step 4.

### 2. Stato wizard (`RegisterWizard`)

`WizardData` acquisisce:
```ts
documents?: {
  ciFronte: File;
  ciRetro: File;
  codiceFiscale: File;
  visuraCamerale: File;
  visuraData: string; // ISO yyyy-mm-dd
};
```
Al submit dello step 4 (`handlePayment`), invece di passare un oggetto strutturato a `registerAction`, si costruisce un `FormData`:
- `payload` = `JSON.stringify({ account, company, payment, referralCode, visuraData })`
- 4 file allegati con chiavi `CI_FRONTE`, `CI_RETRO`, `CODICE_FISCALE`, `VISURA_CAMERALE`.

Se `data.documents` è assente al submit → errore "Dati documenti mancanti, ricomincia il wizard" (coerente col controllo già presente su account/company).

### 3. Server action — `registerAction` (`(auth)/actions.ts`)

Cambia firma da `(input: RegisterFullInput & { referralCode? })` a `(formData: FormData)`.
`registerAction` è chiamato **solo** da `register-wizard.tsx`, quindi il cambio è sicuro.

Nuovo comportamento:
1. Estrae `payload` dal FormData, `JSON.parse`, valida con `registerFullSchema` (invariato) + parse `visuraData` con uno schema dedicato.
2. Estrae i 4 `File` dal FormData.
3. **Validazione file** (vedi sezione Validazione): se uno fallisce → ritorna `{ ok: false, error }` senza creare nulla.
4. Check unicità email admin / P.IVA (invariato).
5. `storage.put` dei 4 file con `scope: \`company/${companyId provvisorio}\``. Nota: il `companyId` non esiste ancora prima della transaction; lo scope usa un UUID generato in anticipo per la company (oppure si fa `storage.put` con scope basato su P.IVA/uuid temporaneo e si normalizza). **Approccio scelto**: generare l'`id` della company in anticipo (`crypto.randomUUID()`) e passarlo esplicitamente al `create`, così lo scope storage e il `companyId` dei documenti coincidono.
6. **Transaction** (estende quella esistente): crea Company (con `id` pre-generato + `visuraCameraleData`), User, VerificationToken, **+ 4× `Documento`** con `companyId`, `tipo`, `storageKey`, `storageProvider`, `mimeType`, `sizeBytes`, `originalFilename`, `uploadedById` (l'User appena creato), `ocrStato: 'NONE'`, `gatingStato: 'PASSED'`.
7. Best-effort, fuori transaction, non bloccante: `void getRegistroImprese().lookupByPiva(company.partitaIva)` — col provider mock ritorna dati plausibili che per ora vengono solo loggati (seam per lo swap futuro).
8. DEMO_MODE activation, CRM match, referral notify: invariati.

`uploadedById` richiede l'id dell'User: si crea prima l'User nella transaction, poi i Documento (o si pre-genera anche l'id User). I documenti referenziano l'User come uploader.

### 4. Schema DB — `Company.visuraCameraleData`

```prisma
model Company {
  // ...
  visuraCameraleData DateTime?
}
```
Migration Prisma dedicata. Applicazione su Neon con attenzione allo schema drift (riferimento: incidente OCR 2026-05-30). Verificare che la migration sia generata e applicata sia in locale che in produzione test prima del merge.

### 5. Provider abstraction — `RegistroImpreseProvider`

Nuova cartella `src/lib/providers/registro-imprese/`, struttura gemella di `ocr/`.

**`types.ts`**
```ts
export type RegistroImpreseProviderName = 'mock' | 'openapi' | 'infocamere';

export type CompanyRegistryData = {
  denominazione: string;
  formaGiuridica?: string;
  sedeLegale?: { indirizzo?: string; citta?: string; cap?: string; provincia?: string };
  statoAttivita?: 'ATTIVA' | 'CESSATA' | 'IN_LIQUIDAZIONE' | 'SOSPESA' | 'SCONOSCIUTO';
  dataIscrizione?: string; // ISO
  ateco?: string;
  pec?: string;
  capitaleSociale?: number;
  amministratori?: Array<{ nome: string; cognome: string; carica?: string }>;
  numeroRea?: string;
};

export type RegistroImpreseLookupInput = { partitaIva: string };

export interface RegistroImpreseProvider {
  readonly name: RegistroImpreseProviderName;
  lookupByPiva(input: RegistroImpreseLookupInput): Promise<CompanyRegistryData | null>;
}
```

**`mock.ts`** — `MockRegistroImpreseProvider`: dati deterministici plausibili derivati dal P.IVA (stesso stile di `MockOcrProvider` sull'hash del buffer). `name = 'mock'`.

**`index.ts`** — `getRegistroImprese()` con cache singleton e switch su `env.REGISTRO_IMPRESE_PROVIDER`:
- `mock` → `MockRegistroImpreseProvider`
- `openapi` / `infocamere` → `throw new Error('... not yet implemented')` finché l'account esterno non è attivo.

**`env.ts`** — aggiunge `REGISTRO_IMPRESE_PROVIDER` (default `'mock'`) + placeholder chiave API (`REGISTRO_IMPRESE_API_KEY` opzionale).

## Validazione e gating

- Riuso di `classifyDocumento()` su ciascuno dei 4 file: MIME ∈ {pdf, jpg, png}, dimensione ∈ [30KB, 10MB], hint fronte/retro sul nome per `CI_FRONTE`/`CI_RETRO`.
- **Differenza rispetto alle pratiche**: nelle pratiche un documento `FAILED` viene comunque salvato col suo stato. Qui, essendo obbligatori, **un solo `FAILED` blocca la registrazione**: l'action ritorna `{ ok: false, error: <reason del classifier> }` e non crea nulla.
- **Visura ≤ 6 mesi**: validata client-side (per UX) e ri-validata server-side (autoritativa). Una data più vecchia di 6 mesi o futura → errore.
- I record `Documento` salvati hanno `ocrStato: 'NONE'` (nessun OCR reale su questi tipi), `gatingStato: 'PASSED'`.

## Error handling

Messaggi chiari, mostrati nello step 3 (client) e ricontrollati server-side:
- File mancante → "Carica tutti i documenti richiesti".
- Formato non supportato / troppo grande / troppo piccolo → motivo dal classifier.
- Visura scaduta (> 6 mesi) o data futura → "La visura camerale deve essere emessa da non più di 6 mesi".
- Fallimento storage/transaction → errore generico + nessun account parziale visibile all'utente (eventuali file orfani su storage sono accettabili e ripulibili).

## Testing

- **Unit `registro-imprese`**: il mock ritorna dati deterministici sullo stesso P.IVA; `getRegistroImprese()` rispetta l'env; `openapi` lancia not-implemented.
- **Unit `registerAction` (nuovo path FormData)**:
  - 4 file validi + visura recente → Company creata con `visuraCameraleData` + 4 `Documento` con `companyId` e `gatingStato PASSED`.
  - file con MIME non valido → `{ ok: false }`, nessuna Company creata.
  - visura > 6 mesi → `{ ok: false }`, nessuna Company creata.
  - payload strutturato invalido → comportamento invariato rispetto a oggi.
- **Estensione test registrazione esistente** per la nuova firma FormData.
- E2E (allineato alla prassi end-of-phase): registrazione completa con upload dei 4 documenti → account attivo + documenti presenti.

## Fuori scope (follow-up separati)

- Vera validazione IA dei documenti d'identità (Google Document AI) — resta a Fase 3.3.
- UI admin di review/approvazione documenti azienda (l'utente ha scelto "attivo subito", review non bloccante). I documenti vengono salvati e saranno visibili dove già si mostrano i documenti azienda; la coda di review dedicata è un item a parte.
- Integrazione reale del provider Registro Imprese (account `openapi.it`/InfoCamere): predisposta l'astrazione, lo swap avverrà quando l'account esterno sarà attivo, con eventuale auto-validazione/auto-compilazione dei dati azienda.

## File toccati (riepilogo)

- `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` — `DocumentsStep` reale + stato `documents` + submit FormData.
- `apps/piattaforma/src/app/(auth)/actions.ts` — `registerAction` accetta FormData, valida file, crea Documento, chiama provider best-effort.
- `apps/piattaforma/src/lib/auth/schemas.ts` — schema per `visuraData` (e eventuale schema step 3).
- `apps/piattaforma/src/lib/providers/registro-imprese/{types,mock,index}.ts` — nuova astrazione + mock.
- `apps/piattaforma/src/env.ts` — `REGISTRO_IMPRESE_PROVIDER` + chiave API placeholder.
- `packages/db/prisma/schema.prisma` + migration — `Company.visuraCameraleData`.
- Test: `registro-imprese` unit, `registerAction` unit, eventuale E2E.
