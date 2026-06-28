# Retro del CF/Tessera sanitaria in registrazione — Design

**Data:** 2026-06-28
**Branch:** main
**Stato:** approvato (design confermato dall'utente)

## Obiettivo

In fase di **registrazione** (onboarding azienda/utente), lo step "Documenti"
chiede il **Codice Fiscale / Tessera Sanitaria** ma solo il **fronte**. Aggiungere
la richiesta del **retro**, obbligatorio, per **entrambi i ruoli** (broker/DEALER
e agenzia).

## Contesto esistente (verificato)

- Wizard registrazione: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`,
  step 3 "Documenti" (`DocumentsStep`). Oggi richiede 4 documenti, **identici per
  broker e agenzia** (nessuna condizione per ruolo): `ciFronte`, `ciRetro`,
  `codiceFiscale` (solo fronte), `visuraCamerale`. Componente UI: `DocCard`.
  Upload via Vercel Blob client (`uploadToBlob` → `BlobRef`); i `BlobRef` vengono
  spediti come JSON `blobRefs` alla server action.
- Server action: `apps/piattaforma/src/app/(auth)/actions.ts`. Lista
  `REGISTRATION_DOC_SLOTS` (`CI_FRONTE`, `CI_RETRO`, `CODICE_FISCALE`,
  `VISURA_CAMERALE`). Persistenza: un loop crea una riga `Documento` per ogni
  ref (tipo = valore enum `DocumentoTipo`). **Gate KYC/OCR** su soli 3 documenti
  (`CI_FRONTE`, `CODICE_FISCALE`, `VISURA_CAMERALE`); `CI_RETRO` è persistito ma
  **non** entra nel gate.
- Validazione tipi documento: `apps/piattaforma/src/lib/auth/document-validation.ts`
  (`REQUIRED_DOC_TIPI` + tipo `RegistrationDocTipo`).
- Enum Prisma: `DocumentoTipo` contiene **già** `CODICE_FISCALE_RETRO` (aggiunto
  dalla migration `20260626120000_codice_fiscale_retro`, già applicata in prod;
  finora usato solo dal wizard pratica). **Nessuna nuova migration necessaria.**
- Pattern fronte/retro per il CF già esistente nel wizard pratica
  (`pratiche/nuova/wizard.tsx`): slot `codiceFiscale` + `codiceFiscaleRetro`,
  entrambi obbligatori quando il CF è richiesto, retro persistito ma non
  OCR-gated. Replichiamo lo stesso comportamento in registrazione.

## Architettura

Aggiungere uno slot `codiceFiscaleRetro` allo step 3 del wizard registrazione e
includere `CODICE_FISCALE_RETRO` nelle liste di documenti richiesti lato server.
Mappa al valore enum già esistente. Nessuna logica per ruolo (vale per entrambi,
come gli altri documenti).

### UI

Una seconda `DocCard` **"Codice Fiscale / Tessera Sanitaria — Retro"** accanto al
fronte, stesso componente e stesso meccanismo di upload (Vercel Blob client) degli
altri slot di registrazione.

### Comportamento

- **Obbligatorio**, come il fronte e come `CI_RETRO`. Entra nella validazione di
  completezza dello step (non si prosegue/invia senza). Listato separatamente nei
  messaggi "cosa manca" (es. "codice fiscale / tessera sanitaria (retro)").
- **Persistito** come riga `Documento` separata con `tipo = 'CODICE_FISCALE_RETRO'`,
  via lo stesso loop di persistenza degli altri documenti.
- **NON entra nel gate KYC/OCR** — identico a `CI_RETRO` (l'OCR identità si fa solo
  sul fronte del CF). Il gate resta sui 3 documenti attuali.

## File toccati

- `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`:
  - tipo `DocumentsData`: campo `codiceFiscaleRetro: BlobRef`;
  - `DocumentsStep`: nuovo stato slot, chiave in `SlotKey`, voce in `SLOT_TIPO`
    (`codiceFiscaleRetro → 'CODICE_FISCALE_RETRO'`), chiave nell'array di
    validazione `keys`, render `DocCard` retro;
  - submit: aggiungere `CODICE_FISCALE_RETRO: docs.codiceFiscaleRetro` ai `blobRefs`.
- `apps/piattaforma/src/app/(auth)/actions.ts`: aggiungere `'CODICE_FISCALE_RETRO'`
  a `REGISTRATION_DOC_SLOTS` (e niente nel gate KYC, come `CI_RETRO`).
- `apps/piattaforma/src/lib/auth/document-validation.ts`: aggiungere
  `'CODICE_FISCALE_RETRO'` a `REQUIRED_DOC_TIPI` e al tipo `RegistrationDocTipo`.

## Edge cases

- **Draft registrazione (se presente) precedente** privo del retro: il form
  risulta incompleto e l'utente carica il retro per proseguire (nessun crash, è
  uno slot in più non valorizzato).
- **Ordine slot**: il retro va reso adiacente al fronte per chiarezza.

## Test / verifica

- `pnpm --filter piattaforma run typecheck` pulito + `pnpm --filter piattaforma test`
  (suite invariata; se esistono test sui doc richiesti — es. `document-validation.test.ts`
  o gating — aggiornarli per includere `CODICE_FISCALE_RETRO`).
- Check visivo manuale dello step 3: il retro compare, è obbligatorio (blocca
  l'avanzamento se mancante), si carica via Blob come gli altri.

## Non in scope

- OCR/estrazione dal retro del CF (resta non gated, come CI_RETRO).
- Modifiche al wizard pratica (già ha il retro CF).
- Nessuna migration DB (enum già presente e applicato in prod).
