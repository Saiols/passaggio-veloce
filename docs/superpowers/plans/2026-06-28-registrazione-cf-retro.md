# Retro CF/Tessera sanitaria in registrazione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In registrazione (step "Documenti") chiedere, obbligatoriamente e per entrambi i ruoli (broker e agenzia), anche il **retro** del Codice Fiscale / Tessera Sanitaria.

**Architecture:** Aggiungere uno slot `codiceFiscaleRetro` allo step 3 del wizard di registrazione, mappato al valore enum `DocumentoTipo` **già esistente** `CODICE_FISCALE_RETRO`, e includerlo nelle liste di documenti richiesti/persistiti lato server. Comportamento identico a `CI_RETRO`: obbligatorio, persistito, ma **non** nel gate KYC/OCR. Nessuna migration (enum già in prod).

**Tech Stack:** Next.js (App Router, Server Actions), React form state, Vercel Blob client upload, Vitest.

## Global Constraints

- **Obbligatorio** per **entrambi i ruoli** (broker/DEALER e agenzia): la lista documenti di registrazione non ha logica per ruolo, quindi nessun condizionale.
- Mappa al valore enum **già esistente** `CODICE_FISCALE_RETRO` (`DocumentoTipo`). **Nessuna migration** (aggiunta dalla `20260626120000_codice_fiscale_retro`, già applicata in prod).
- Comportamento **come `CI_RETRO`**: persistito come riga `Documento` separata, **escluso dal gate KYC/OCR** (l'OCR identità resta sui 3 doc: `CI_FRONTE`, `CODICE_FISCALE`, `VISURA_CAMERALE`).
- Etichetta UI: **"Codice Fiscale / Tessera Sanitaria — Retro"**, `DocCard` adiacente al fronte (niente `pdfOnly`, come il fronte).
- Il classifier (`classifyDocumento`) è generico (MIME PDF/JPG/PNG + size); `CODICE_FISCALE_RETRO` non ha regole speciali → passa senza modifiche al classifier.
- Il selettore invia i `BlobRef` in **due** punti (verifica KYC step 3 e submit finale): **entrambi** devono includere `CODICE_FISCALE_RETRO`.
- Branch di lavoro: `main` (sviluppo diretto su main).

**Comandi:**
- Test singolo: `pnpm --filter piattaforma exec vitest run src/lib/auth/document-validation.test.ts`
- Typecheck: `pnpm --filter piattaforma run typecheck`
- Suite: `pnpm --filter piattaforma test`

---

## File Structure

- **Modify** `apps/piattaforma/src/lib/auth/document-validation.ts` — `RegistrationDocTipo` + `REQUIRED_DOC_TIPI`.
- **Modify** `apps/piattaforma/src/lib/auth/document-validation.test.ts` — `allDocs()` + test del nuovo obbligo (gancio TDD).
- **Modify** `apps/piattaforma/src/app/(auth)/actions.ts` — `REGISTRATION_DOC_SLOTS`.
- **Modify** `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` — tipo `DocumentsData`, `SlotKey`, `SLOT_TIPO`, stato/slots/setters, validazione, render `DocCard`, due invii `blobRefs`.

Cambiamento coeso end-to-end (UI + server requisito + persistenza): uno stato a metà romperebbe la registrazione. **Un solo task**, con ciclo TDD sul layer di validazione (l'unico pezzo unit-testabile; il wizard UI è verificato da typecheck + check visivo, come da convenzione del repo).

---

## Task 1: Retro CF obbligatorio in registrazione (end-to-end)

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/document-validation.ts`
- Modify: `apps/piattaforma/src/lib/auth/document-validation.test.ts`
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts`
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`

**Interfaces:**
- `RegistrationDocTipo` (union di stringhe) guadagna `'CODICE_FISCALE_RETRO'`.
- `REQUIRED_DOC_TIPI` e `REGISTRATION_DOC_SLOTS` includono `'CODICE_FISCALE_RETRO'`.
- Nel wizard: nuovo `SlotKey` `'codiceFiscaleRetro'` → tipo `'CODICE_FISCALE_RETRO'`; campo `DocumentsData.codiceFiscaleRetro: BlobRef`.

- [ ] **Step 1: Aggiornare il test di validazione (RED)**

In `apps/piattaforma/src/lib/auth/document-validation.test.ts`:

(a) aggiungi `CODICE_FISCALE_RETRO` a `allDocs()`:

```typescript
const allDocs = (): RegistrationDocInput[] => [
  validDoc('CI_FRONTE'),
  validDoc('CI_RETRO'),
  validDoc('CODICE_FISCALE'),
  validDoc('CODICE_FISCALE_RETRO'),
  validDoc('VISURA_CAMERALE'),
];
```

(b) rinomina il test "passa con i 4 documenti validi" in "passa con i 5 documenti validi" (il corpo resta `expect(validateRegistrationDocuments(allDocs())).toEqual({ ok: true });`).

(c) aggiungi un test per il nuovo obbligo, dopo il test "fallisce se manca un documento":

```typescript
  it('fallisce se manca il retro del codice fiscale', () => {
    const docs = allDocs().filter((d) => d.tipo !== 'CODICE_FISCALE_RETRO');
    const r = validateRegistrationDocuments(docs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
  });
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/document-validation.test.ts`
Expected: FAIL sul nuovo test "fallisce se manca il retro del codice fiscale" — al momento `CODICE_FISCALE_RETRO` non è in `REQUIRED_DOC_TIPI`, quindi `validateRegistrationDocuments` ritorna `{ ok: true }` mentre il test si aspetta `ok: false`. (Il test "passa con i 5 documenti validi" passa già: i documenti extra sono innocui.)

- [ ] **Step 3: Implementare il requisito lato validazione**

In `apps/piattaforma/src/lib/auth/document-validation.ts`:

(a) estendi il tipo:

```typescript
export type RegistrationDocTipo =
  | 'CI_FRONTE'
  | 'CI_RETRO'
  | 'CODICE_FISCALE'
  | 'CODICE_FISCALE_RETRO'
  | 'VISURA_CAMERALE';
```

(b) aggiungi alla lista obbligatori:

```typescript
export const REQUIRED_DOC_TIPI: readonly RegistrationDocTipo[] = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'CODICE_FISCALE_RETRO',
  'VISURA_CAMERALE',
];
```

- [ ] **Step 4: Eseguire il test e verificare che passi (GREEN)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/document-validation.test.ts`
Expected: PASS (tutti i test del file verdi).

- [ ] **Step 5: Aggiungere lo slot lato server action**

In `apps/piattaforma/src/app/(auth)/actions.ts`, nella costante `REGISTRATION_DOC_SLOTS`:

```typescript
const REGISTRATION_DOC_SLOTS = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'CODICE_FISCALE_RETRO',
  'VISURA_CAMERALE',
] as const;
```

> Nota: `parseBlobRefs` itera `REGISTRATION_DOC_SLOTS` e richiede ogni slot nel JSON `blobRefs`; la persistenza crea una riga `Documento` per ciascuno (tipo = chiave). Il gate KYC (righe ~276-338) legge esplicitamente solo `CI_FRONTE`/`CODICE_FISCALE`/`VISURA_CAMERALE` per l'OCR: **non** va toccato, così `CODICE_FISCALE_RETRO` resta fuori dal gate (come `CI_RETRO`).

- [ ] **Step 6: Wizard — tipo, slot e mapping**

In `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`:

(a) tipo `DocumentsData`:

```typescript
type DocumentsData = {
  ciFronte: BlobRef;
  ciRetro: BlobRef;
  codiceFiscale: BlobRef;
  codiceFiscaleRetro: BlobRef;
  visuraCamerale: BlobRef;
};
```

(b) `SlotKey`:

```typescript
type SlotKey = 'ciFronte' | 'ciRetro' | 'codiceFiscale' | 'codiceFiscaleRetro' | 'visuraCamerale';
```

(c) `SLOT_TIPO` (aggiorna sia il tipo del `Record` sia le voci):

```typescript
const SLOT_TIPO: Record<
  SlotKey,
  'CI_FRONTE' | 'CI_RETRO' | 'CODICE_FISCALE' | 'CODICE_FISCALE_RETRO' | 'VISURA_CAMERALE'
> = {
  ciFronte: 'CI_FRONTE',
  ciRetro: 'CI_RETRO',
  codiceFiscale: 'CODICE_FISCALE',
  codiceFiscaleRetro: 'CODICE_FISCALE_RETRO',
  visuraCamerale: 'VISURA_CAMERALE',
};
```

- [ ] **Step 7: Wizard — stato, slots, setters, validazione, submit**

Sempre in `register-wizard.tsx`, dentro `DocumentsStep`:

(a) aggiungi lo stato, subito dopo lo stato `codiceFiscale`:

```typescript
  const [codiceFiscaleRetro, setCodiceFiscaleRetro] = useState<DocSlotState>(
    fromRef(defaultValues?.codiceFiscaleRetro),
  );
```

(b) aggiungi a `slots`:

```typescript
  const slots: Record<SlotKey, DocSlotState> = {
    ciFronte,
    ciRetro,
    codiceFiscale,
    codiceFiscaleRetro,
    visuraCamerale,
  };
```

(c) aggiungi a `setters`:

```typescript
  const setters: Record<SlotKey, (s: DocSlotState) => void> = {
    ciFronte: setCiFronte,
    ciRetro: setCiRetro,
    codiceFiscale: setCodiceFiscale,
    codiceFiscaleRetro: setCodiceFiscaleRetro,
    visuraCamerale: setVisuraCamerale,
  };
```

(d) nel `useMemo` di validazione, aggiorna l'array `keys` e le dipendenze:

```typescript
    const keys: SlotKey[] = ['ciFronte', 'ciRetro', 'codiceFiscale', 'codiceFiscaleRetro', 'visuraCamerale'];
```

e la dependency list del `useMemo` (ultima riga prima della `]`):

```typescript
  }, [ciFronte, ciRetro, codiceFiscale, codiceFiscaleRetro, visuraCamerale]);
```

(e) in `handleSubmit`, nell'oggetto passato a `onNext`:

```typescript
    onNext({
      ciFronte: ciFronte.ref!,
      ciRetro: ciRetro.ref!,
      codiceFiscale: codiceFiscale.ref!,
      codiceFiscaleRetro: codiceFiscaleRetro.ref!,
      visuraCamerale: visuraCamerale.ref!,
    });
```

- [ ] **Step 8: Wizard — render della DocCard retro**

In `DocumentsStep`, subito dopo il blocco `<div>` della `DocCard` "Codice Fiscale / Tessera Sanitaria" (il fronte), aggiungi:

```tsx
        <div>
          <DocCard
            label="Codice Fiscale / Tessera Sanitaria — Retro"
            file={codiceFiscaleRetro.file}
            onChange={onDocChange('codiceFiscaleRetro')}
            invalid={failedDocs.has('CF') || codiceFiscaleRetro.status === 'error'}
          />
          {uploadHint(codiceFiscaleRetro)}
        </div>
```

- [ ] **Step 9: Wizard — includere il retro nei due invii blobRefs**

In `register-wizard.tsx` ci sono due `JSON.stringify({...})` per `blobRefs`. Aggiungi `CODICE_FISCALE_RETRO` a entrambi.

(a) invio verifica KYC (step 3 → `verifyRegistrationDocumentsAction`), il blocco che usa `values.*`:

```typescript
        JSON.stringify({
          CI_FRONTE: values.ciFronte,
          CI_RETRO: values.ciRetro,
          CODICE_FISCALE: values.codiceFiscale,
          CODICE_FISCALE_RETRO: values.codiceFiscaleRetro,
          VISURA_CAMERALE: values.visuraCamerale,
        }),
```

(b) submit finale (`registerAction`), il blocco che usa `docs.*`:

```typescript
        JSON.stringify({
          CI_FRONTE: docs.ciFronte,
          CI_RETRO: docs.ciRetro,
          CODICE_FISCALE: docs.codiceFiscale,
          CODICE_FISCALE_RETRO: docs.codiceFiscaleRetro,
          VISURA_CAMERALE: docs.visuraCamerale,
        }),
```

- [ ] **Step 10: Typecheck + suite completa**

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS.

Run: `pnpm --filter piattaforma test`
Expected: PASS — suite verde (incluso `document-validation.test.ts` aggiornato). Atteso: il numero totale di test sale di 1 rispetto a prima.

- [ ] **Step 11: Verifica visiva manuale**

Avvia in locale (`pnpm --filter piattaforma dev`) e apri la registrazione (sia come DEALER sia come AGENZIA). Allo step 3 "Documenti" deve comparire la card **"Codice Fiscale / Tessera Sanitaria — Retro"**; senza caricarla il pulsante "Avanti" resta disabilitato / la validazione segnala il documento mancante; caricandola si carica su Blob come gli altri e si prosegue.

> Se non hai un ambiente locale pronto, la verifica è fattibile sul preview/prod dopo il deploy.

- [ ] **Step 12: Commit**

```bash
git add apps/piattaforma/src/lib/auth/document-validation.ts apps/piattaforma/src/lib/auth/document-validation.test.ts apps/piattaforma/src/app/\(auth\)/actions.ts "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx"
git commit -m "feat(registrazione): richiedi anche il retro del CF/tessera sanitaria (broker+agenzia)"
```

---

## Self-Review (eseguita in fase di scrittura)

**Spec coverage:**
- Retro CF in registrazione, obbligatorio, entrambi i ruoli → Step 5-9 (server requisito + UI), nessun condizionale per ruolo. ✓
- Mappa a `CODICE_FISCALE_RETRO`, niente migration → Global Constraints + Step 5/6. ✓
- Persistito ma fuori dal gate (come CI_RETRO) → Step 5 (REGISTRATION_DOC_SLOTS sì, gate non toccato). ✓
- Due invii blobRefs aggiornati → Step 9. ✓
- Test aggiornato (gancio TDD) → Step 1-4. ✓
- Verifica typecheck + suite + visivo → Step 10-11. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice o comando concreto. ✓

**Type consistency:** `'CODICE_FISCALE_RETRO'` usato coerentemente in `RegistrationDocTipo`, `REQUIRED_DOC_TIPI`, `REGISTRATION_DOC_SLOTS`, `SLOT_TIPO`, `DocumentsData.codiceFiscaleRetro`, e nelle chiavi `blobRefs`. Lo slot wizard `codiceFiscaleRetro` è coerente in stato/slots/setters/keys/onNext/DocCard. ✓
