# Delega/Procura a vendere sul libretto — Design

**Data:** 2026-06-18
**Area:** Wizard creazione pratica (`apps/piattaforma/src/app/pratiche/nuova`)
**Stato:** Approvato (con modifiche utente) — pronto per implementation plan

## Contesto

Nel wizard di creazione pratica, lo step 1 (Veicolo) carica il libretto di
circolazione ed estrae i dati via OCR. Lo step 2 (Venditore) raccoglie i dati e
i documenti d'identità dei venditori (co-intestatari), raggruppati per veicolo.

Esiste già un `flagProcura` nell'engine documentale (`lib/documenti/engine.ts`)
che richiederebbe documenti PROCURA + CI procuratore con gating, ma è **dormiente**:
nel wizard è hardcoded a `false` (`wizard.tsx` input di `calcolaDocumentiRichiesti`).
Il nuovo flusso è quindi indipendente e non tocca l'engine.

## Obiettivo

Aggiungere, **senza modificare nulla del comportamento attuale**, un flusso di
allegati per la delega/procura notarile a vendere:

1. Step 1, dopo il caricamento del libretto e l'estrazione dei dati, per **ogni
   veicolo** il sistema chiede: *"C'è una delega/procura notarile a vendere?"*
2. Risposta **No** → tutto invariato.
3. Risposta **Sì** → nello step 2 (Venditore), nel gruppo di quel veicolo,
   compaiono **due input file**: *Documento del delegato* e *Procura notarile a
   vendere*. Sono **obbligatori** per poter procedere (vedi §6), ma senza alcuna
   validazione di contenuto (no OCR, no controllo MIME/dimensione, no gating
   documentale): è richiesta solo la **presenza** dei due file.
4. I due file vengono allegati alla pratica e sono **consultabili dall'agenzia**
   nella lista documenti.

## Decisioni (fissate con l'utente)

- **Granularità: per veicolo.** Domanda e coppia di file agganciate al singolo
  veicolo (un veicolo può avere più co-intestatari, ma la delega è una sola per
  veicolo).
- **Controllo Sì/No: due bottoni espliciti** (segmented control), non checkbox.
  Default = **No** (così il flusso resta invariato finché il broker non sceglie Sì).
- **Flag persistito a DB**: nuova colonna `flagDelegaVendita` su `Veicolo`.
- **Due nuovi tipi documento dedicati**: `DELEGA_VENDITA` (procura notarile) e
  `DOCUMENTO_DELEGATO` (documento del delegato), così l'agenzia vede etichette
  chiare.
- **File obbligatori se Sì**: bloccano l'avanzamento dello step e l'invio finché
  non sono caricati. Nessuna validazione di contenuto, solo presenza.

## Modello dati e migration

`packages/db/prisma/schema.prisma`:

- `enum DocumentoTipo`: aggiungere `DELEGA_VENDITA` e `DOCUMENTO_DELEGATO`.
- `model Veicolo`: aggiungere `flagDelegaVendita Boolean @default(false)`
  (accanto a `preImm2015` / `flagComodatoDuso`).

Migration additiva e sicura (non tocca dati esistenti):
- `ALTER TYPE "DocumentoTipo" ADD VALUE 'DELEGA_VENDITA';`
- `ALTER TYPE "DocumentoTipo" ADD VALUE 'DOCUMENTO_DELEGATO';`
- `ALTER TABLE "Veicolo" ADD COLUMN "flagDelegaVendita" BOOLEAN NOT NULL DEFAULT false;`

Nota tecnica: in Postgres `ALTER TYPE ... ADD VALUE` non può girare nella stessa
transazione in cui il nuovo valore viene usato; con `prisma migrate` i due
`ADD VALUE` stanno in una migration separata dal primo uso (a runtime li usiamo
solo dopo il deploy della migration), quindi nessun problema.

`seed.ts`: i `veicolo.create` esistenti possono restare invariati (default
`false`); opzionale aggiungere un caso seed con delega per QA.

## Stato wizard

`apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`:

- `type VeicoloInput`: aggiungere `flagDelegaVendita: boolean`.
- `emptyVeicolo()`: `flagDelegaVendita: false`.
- Slot file: riusare la mappa esistente `documenti` (`Record<string, BlobSlot>`,
  già usata per CdP e doc richiesti). Chiavi per veicolo `ordine`:
  - `DELEGA_DELEGATO_<ordine>` — documento del delegato
  - `DELEGA_PROCURA_<ordine>` — procura notarile
- Helper chiave (stile `cdpDocKey`): `delegatoDocKey(ordine)`,
  `procuraDelegaDocKey(ordine)`.

## UI Step 1 — `VeicoloSection`

Dopo i campi estratti dal libretto (vicino alla checkbox "Pre-2015"), aggiungere
la domanda con **due bottoni** Sì/No:

```
C'è una delega/procura notarile a vendere?   [ No ]  [ Sì ]
```

- Bound a `veicolo.flagDelegaVendita` (No = false attivo di default, Sì = true).
- Stile coerente con il resto della sezione (bottoni segmented usando i
  componenti UI esistenti / `Button` con stato attivo).
- Compare insieme agli altri campi, cioè solo dopo upload + OCR del libretto.
- Nessun nuovo gate sullo step 1 (No è un default valido): `canStep1` invariato.

## UI Step 2 — Venditore

I venditori sono già raggruppati per veicolo (layout singolo e accordion
multi-veicolo). Per ogni gruppo-veicolo con `flagDelegaVendita === true`,
renderizzare una sezione "Delega a vendere" con **due `UploadCard`** (componente
riusato, stessa grafica + scanner + client-upload su Blob):

- *Documento del delegato* → slot `DELEGA_DELEGATO_<ordine>`
- *Procura notarile a vendere* → slot `DELEGA_PROCURA_<ordine>`

`UploadCard` props: `label`, `slot`, `onSelect`, `onRemove`. Nessun callback OCR
(`onMainRef`/`onVisuraRef`/...): sono allegati puri.

La sezione va resa in entrambi i rami di render dello step 2 (gruppo accordion
per multiplo e lista flat per singolo veicolo).

## Gating "file obbligatori se Sì"

**Client (`canStep2`)** — aggiungere la condizione: per ogni veicolo con
`flagDelegaVendita`, entrambi gli slot devono avere una `BlobRef` pronta
(caricata, non in upload):

```ts
const delegaCompleta = veicoli.every((v, i) => {
  if (!v.flagDelegaVendita) return true;
  const ord = i + 1;
  const a = documenti[delegatoDocKey(ord)];
  const b = documenti[procuraDelegaDocKey(ord)];
  return !!a?.ref && !a.uploading && !!b?.ref && !b.uploading;
});
// canStep2 = (...condizioni esistenti...) && delegaCompleta
```

Quando manca un file, il bottone "Avanti" dello step 2 è disabilitato; mostrare
un hint/`Alert` inline coerente con gli altri messaggi dello step.

**Server (`actions.ts`)** — fonte autoritativa. Prima della transazione (dove
già avvengono i redirect per documenti mancanti), per ogni veicolo con
`flagDelegaVendita = true` verificare la presenza di entrambe le ref negli slot
`DELEGA_DELEGATO_<ordine>` / `DELEGA_PROCURA_<ordine>`; se manca, `redirect`
`/pratiche/nuova?error=...` con messaggio chiaro. Nessuna validazione di
contenuto oltre la presenza (no MIME/size gating, no OCR).

## Submit + persistenza

**Submit (`wizard.tsx`)**: nel builder `veicoliPayload` aggiungere
`flagDelegaVendita: v.flagDelegaVendita`. Gli slot `DELEGA_*` confluiscono già
nella mappa `blobRefs` se hanno una ref (stesso meccanismo client-upload degli
altri documenti).

**Schema (`actions.ts`)**: aggiungere `flagDelegaVendita: z.boolean().default(false)`
allo schema zod del veicolo.

**Persistenza (`actions.ts`)**: dentro il loop di creazione veicolo (dove è già
disponibile `veicolo.id` e si crea il `Documento` LIBRETTO), se
`v.flagDelegaVendita` creare due righe `Documento` dalle ref risolte:

```ts
// per ciascuno dei due slot, dalla BlobRef risolta (put) come per il libretto:
await tx.documento.create({
  data: {
    tipo: 'DOCUMENTO_DELEGATO', // poi 'DELEGA_VENDITA'
    owner: 'VENDITORE',
    praticaId: created.id,
    veicoloId: veicolo.id,
    storageKey: put.storageKey,
    storageProvider: put.storageProvider,
    mimeType: put.mimeType,
    sizeBytes: put.sizeBytes,
    originalFilename: put.originalFilename,
    uploadedById: userId,
    ocrStato: 'NONE',
    gatingStato: 'PASSED', // gating non applicabile
  },
});
```

Le `BlobRef` degli slot `DELEGA_*` vanno risolte in `StoragePutResult` con lo
stesso meccanismo già usato per gli altri upload (mappa BlobRef → metadati).

## Vista agenzia / broker

I due file diventano righe `Documento` standard sulla pratica (linkate al veicolo)
e compaiono nella lista "Documenti" della pratica come tutti gli altri, sia per
l'agenzia (`inbox/[id]`) sia per il broker (`pratiche/[id]`), con stato gating "ok".

Aggiungere le etichette in **entrambe** le funzioni `labelDocumento`:
- `apps/piattaforma/src/app/inbox/[id]/page.tsx` (riga ~318)
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (riga ~570)

con:
- `DELEGA_VENDITA: 'Procura a vendere'`
- `DOCUMENTO_DELEGATO: 'Documento delegato'`

**Nota su "consultabile / scaricabile":** il download dei file passa per la route
`GET /api/documenti/[id]` (già esistente), che autorizza admin, broker proprietario
e **agenzia assegnata** (`pratica.agenziaAssegnataId === userCompanyId`). Poiché i
due allegati sono righe `Documento` linkate alla pratica e al veicolo, sono
**scaricabili dall'agenzia come tutti gli altri** documenti (il filename include
anche la targa del veicolo). Nessuna nuova infrastruttura di serving necessaria.

Dettaglio UI: il dettaglio broker (`pratiche/[id]`) mostra già un link "Scarica"
per documento; la lista dell'inbox agenzia (`inbox/[id]`) mostra i documenti per
etichetta + stato gating ma **oggi non espone un link di download per riga**
(comportamento pre-esistente, valido per tutti i documenti). Aggiungere il link
nell'inbox è **fuori scope** di questa feature (eventuale miglioria separata).

## Fuori scope (non si tocca)

- Engine documentale (`lib/documenti/engine.ts`): nessuna modifica; `flagProcura`
  resta dormiente.
- OCR / scanner: i due allegati non passano per OCR.
- Gating rule-based (`lib/documenti/gating-block.ts`): i due allegati non vi
  passano (solo presenza richiesta lato wizard/server).

## Test

- **Engine**: invariato (nessun nuovo test richiesto lato engine).
- **Server action** (`actions.test.ts` o equivalente): 
  - veicolo con `flagDelegaVendita` + entrambi gli slot → 2 `Documento`
    (`DELEGA_VENDITA`, `DOCUMENTO_DELEGATO`) creati e linkati a `veicoloId`;
  - veicolo con `flagDelegaVendita` ma slot mancante → redirect errore, nessuna
    pratica creata;
  - veicolo senza flag → nessun documento extra.
- **Label**: se esiste un test sulle label documento, aggiungere i due nuovi tipi.

## File toccati (riepilogo)

- `packages/db/prisma/schema.prisma` (+ migration)
- `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts`
- `apps/piattaforma/src/app/inbox/[id]/page.tsx` (label)
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (label)
- eventuali test in `apps/piattaforma/src/app/pratiche/nuova/`
