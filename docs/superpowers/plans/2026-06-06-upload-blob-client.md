# Fix upload >4.5MB — Vercel Blob client uploads

**Data:** 2026-06-06
**Branch:** feat/tipi-pratica-multiveicolo (continua)
**Causa root:** Vercel impone 4,5 MB sul body delle funzioni serverless (Server Actions incluse). Gli upload del wizard pratica e della registrazione passano i file DENTRO la Server Action → 413 in prod per file grandi (es. libretto PDF 8,7 MB) → "An unexpected response was received from the server". In locale non c'è il cap → funziona.

**Fix:** browser → Vercel Blob **diretto** (`@vercel/blob/client` `upload()` + route `handleUpload`). Alle Server Action arrivano solo le **chiavi** (BlobRef). Scope: wizard pratica + registrazione. (`profilo/listino` resta fuori scope — limite latente segnalato.)

## Contratto condiviso (FONDAMENTA)

### BlobRef
```ts
type BlobRef = { key: string; name: string; size: number; type: string }
```

### Client helper — `apps/piattaforma/src/lib/blob/upload-client.ts` ('use client')
`uploadToBlob(file: File, scope: string, onProgress?): Promise<BlobRef>`
- pathname = `${scope}/${crypto.randomUUID()}-${sanitize(name)}`
- `upload(pathname, file, { access:'public', handleUploadUrl:'/api/blob/upload', contentType:file.type, onUploadProgress })`
- ritorna `{ key: blob.pathname, name, size, type }`
- export anche `MAX_UPLOAD_BYTES = 10*1024*1024` e `ACCEPTED_MIME`.

### Route — `apps/piattaforma/src/app/api/blob/upload/route.ts` (runtime nodejs)
POST → `handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted })`:
- `onBeforeGenerateToken`: `auth()`; se non loggato → throw. Ritorna `{ allowedContentTypes:['application/pdf','image/jpeg','image/png'], maximumSizeInBytes:10MB, addRandomSuffix:false }`.
- `onUploadCompleted`: no-op (non ci affidiamo al webhook; la chiave si registra al submit).
- try/catch → 400 con messaggio su throw.

### Storage — `apps/piattaforma/src/lib/providers/storage/index.ts`
Aggiungi `storageGetBuffer(key): Promise<Buffer>` (consuma `getStorage().get(key).stream` → Buffer). Usato dalle action OCR per leggere i byte dal blob.

## Task 1 — Fondamenta (io, diretto)
Client helper + route + storageGetBuffer. Typecheck.

## Task 2 — Pratiche (subagent, dipende da 1)
`wizard.tsx`:
- Stato file → BlobRef: ogni `onFileSelected`/selezione identità/doc carica subito su Blob (`uploadToBlob(file,'pratiche-staging')`), salva BlobRef in stato, invalida su cambio file. Mostra stato "caricamento…".
- OCR: `extractLibrettoAction(ref)` / `extractIdentitaAction(ref, tipo)` ricevono BlobRef (non File).
- `handleFinalSubmit`: niente File in FormData. Invia un JSON `blobRefs` map `{ slotName: BlobRef }` per LIBRETTO_n / DOC__<key> / VEND<n>_* / ACQ_*. Tutto il resto invariato.

`actions.ts`:
- `extractLibrettoAction(ref: BlobRef)`: valida type/size da ref, `storageGetBuffer(ref.key)`, Document AI. Mantieni try/catch + retry.
- `extractIdentitaAction(ref: BlobRef, tipo)`: idem.
- `submitNuovaPraticaAction`: leggi `blobRefs` JSON; per ogni slot usa la BlobRef (valida size/type da ref); persisti `Documento` con `storageKey=ref.key, sizeBytes=ref.size, mimeType=ref.type, originalFilename=ref.name` SENZA `storage.put` (file già su Blob). Engine/cross-check/gating invariati (il gating usa mimeType/size/filename dal ref). Rimuovi `bufferFromFile`+`storage.put` per questi.

### Test
- `storageGetBuffer` unit (local provider).
- I test engine/richiesti/match restano verdi (logica pura invariata).

## Task 3 — Registrazione (subagent, dipende da 1, parallelo a 2)
`register-wizard.tsx`: upload documenti KYC client-side → BlobRef; invia chiavi.
`(auth)/actions.ts`:
- `verifyRegistrationDocumentsAction`: legge BlobRef, `storageGetBuffer` per OCR/gating.
- `registerAction`: persiste `Documento` con `storageKey=ref.key` (no `storage.put`).

## Verifica finale (io)
typecheck · lint · test · build. Poi push main → deploy → smoke test prod con il PDF 8,7 MB.

## Note
- Blob `access:'public'` (coerente col provider attuale); chiavi UUID non indovinabili.
- Webhook `onUploadCompleted` non gira in locale (serve URL pubblico) — non ci serve.
