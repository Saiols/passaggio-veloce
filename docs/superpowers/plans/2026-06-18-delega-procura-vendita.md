# Delega/Procura a vendere sul libretto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al wizard pratica un flusso per-veicolo che, se il broker dichiara una delega/procura notarile a vendere, raccoglie due allegati obbligatori (documento del delegato + procura) consultabili dall'agenzia.

**Architecture:** Stato wizard per-veicolo `flagDelegaVendita` (persistito su `Veicolo`); domanda Sì/No nello step 1; due `UploadCard` riusate nello step 2 (per gruppo-veicolo) i cui file confluiscono in `blobRefs` con chiavi `DELEGA_*`; persistenza come righe `Documento` di due nuovi tipi enum linkate al veicolo. Logica di completezza/chiavi estratta in un modulo puro testabile condiviso client/server. L'engine documentale non viene toccato.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React client component, Prisma 5.22 + Postgres, Vitest, TypeScript, Vercel Blob (client upload).

## Global Constraints

- Node per tooling: `nvm use 22.15.0` (pnpm richiede ≥18; post-riavvio Node torna a 16).
- Monorepo pnpm + Turborepo. App: `apps/piattaforma` (package `piattaforma`). DB: `packages/db` (package `@pv/db`).
- Comandi verifica app: `pnpm --filter piattaforma run typecheck` · `lint` · `test` · `build`.
- Niente colori hardcoded: usare i token Tailwind del design system (`pv-navy-*`, `pv-slate-*`, `pv-red-*`, `text-white`).
- L'engine documentale (`lib/documenti/engine.ts`) NON va modificato; `flagProcura` resta dormiente.
- I due allegati: nessuna validazione di contenuto (no OCR, no MIME/size gating, no gating rule-based). Obbligatori (solo presenza) quando `flagDelegaVendita = true`.
- Migration additiva e sicura (2 valori enum + 1 colonna con default).
- Documento types: `DELEGA_VENDITA` (procura notarile), `DOCUMENTO_DELEGATO` (documento del delegato). Etichette agenzia: "Procura a vendere", "Documento delegato".
- Slot keys: `DELEGA_DELEGATO_<ordine>`, `DELEGA_PROCURA_<ordine>`.

---

### Task 1: Modulo puro `delega-docs.ts` (chiavi slot + predicato completezza)

Logica condivisa tra wizard (client) e action (server): nomi degli slot e
verifica "tutti i veicoli con delega hanno entrambi i file". Pura e testabile,
sullo stile di `venditori-per-veicolo.ts`.

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/nuova/delega-docs.ts`
- Test: `apps/piattaforma/src/app/pratiche/nuova/delega-docs.test.ts`

**Interfaces:**
- Produces:
  - `delegatoDocKey(ordine: number): string` → `"DELEGA_DELEGATO_<ordine>"`
  - `procuraDelegaDocKey(ordine: number): string` → `"DELEGA_PROCURA_<ordine>"`
  - `delegaDocsComplete(veicoli: { flagDelegaVendita: boolean }[], hasReadyFile: (key: string) => boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/piattaforma/src/app/pratiche/nuova/delega-docs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  delegatoDocKey,
  procuraDelegaDocKey,
  delegaDocsComplete,
} from './delega-docs';

describe('delega-docs — slot keys', () => {
  it('genera chiavi slot per veicolo', () => {
    expect(delegatoDocKey(1)).toBe('DELEGA_DELEGATO_1');
    expect(procuraDelegaDocKey(2)).toBe('DELEGA_PROCURA_2');
  });
});

describe('delegaDocsComplete', () => {
  const ready = (keys: string[]) => (k: string) => keys.includes(k);

  it('nessun veicolo con delega → completo', () => {
    const veicoli = [{ flagDelegaVendita: false }, { flagDelegaVendita: false }];
    expect(delegaDocsComplete(veicoli, ready([]))).toBe(true);
  });

  it('delega Sì con entrambi i file → completo', () => {
    const veicoli = [{ flagDelegaVendita: true }];
    expect(
      delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_1', 'DELEGA_PROCURA_1'])),
    ).toBe(true);
  });

  it('delega Sì con un file mancante → incompleto', () => {
    const veicoli = [{ flagDelegaVendita: true }];
    expect(delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_1']))).toBe(false);
  });

  it('multi-veicolo: vincola solo i veicoli con delega', () => {
    const veicoli = [{ flagDelegaVendita: false }, { flagDelegaVendita: true }];
    expect(
      delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_2', 'DELEGA_PROCURA_2'])),
    ).toBe(true);
    expect(delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_2']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/delega-docs.test.ts`
Expected: FAIL — `Cannot find module './delega-docs'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/piattaforma/src/app/pratiche/nuova/delega-docs.ts`:

```ts
/**
 * Delega/procura a vendere (per veicolo): chiavi slot dei due allegati e
 * predicato di completezza. Modulo puro condiviso wizard (client) ↔ action
 * (server): non importa nulla di client/server-only.
 *
 * I due allegati NON passano per l'engine documentale né per il gating: sono
 * obbligatori (solo presenza) quando il broker dichiara la delega sul veicolo.
 */

export function delegatoDocKey(ordine: number): string {
  return `DELEGA_DELEGATO_${ordine}`;
}

export function procuraDelegaDocKey(ordine: number): string {
  return `DELEGA_PROCURA_${ordine}`;
}

/**
 * True se, per OGNI veicolo con `flagDelegaVendita`, entrambi gli slot
 * (delegato + procura) hanno un file "pronto". Il significato di "pronto" è
 * fornito dal chiamante: client = BlobRef caricata e non in upload; server =
 * ref presente nella mappa blobRefs. I veicoli senza delega non vincolano.
 */
export function delegaDocsComplete(
  veicoli: { flagDelegaVendita: boolean }[],
  hasReadyFile: (key: string) => boolean,
): boolean {
  return veicoli.every((v, i) => {
    if (!v.flagDelegaVendita) return true;
    const ord = i + 1;
    return (
      hasReadyFile(delegatoDocKey(ord)) && hasReadyFile(procuraDelegaDocKey(ord))
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/delega-docs.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/delega-docs.ts apps/piattaforma/src/app/pratiche/nuova/delega-docs.test.ts
git commit -m "feat(pratiche): helper puro delega-docs (slot keys + completezza)"
```

---

### Task 2: Schema DB + migration (enum + colonna `flagDelegaVendita`)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (enum `DocumentoTipo` ~righe 93-111; model `Veicolo` ~righe 774-776)
- Create: `packages/db/prisma/migrations/<timestamp>_delega_procura_vendita/migration.sql` (generata da Prisma)

**Interfaces:**
- Produces: enum `DocumentoTipo` con `DELEGA_VENDITA`, `DOCUMENTO_DELEGATO`; campo `Veicolo.flagDelegaVendita: boolean` (default false). Consumati da Task 3/4/5/6.

- [ ] **Step 1: Aggiungi i due valori all'enum `DocumentoTipo`**

In `packages/db/prisma/schema.prisma`, dentro `enum DocumentoTipo { ... }`, dopo `ALTRO` (o in coda, prima di `}`):

```prisma
  ALTRO
  PASSAPORTO
  PATENTE
  // Delega/procura a vendere (allegati pratica, no engine/gating)
  DELEGA_VENDITA
  DOCUMENTO_DELEGATO
```

- [ ] **Step 2: Aggiungi la colonna al model `Veicolo`**

Sempre in `schema.prisma`, nel `model Veicolo`, accanto a `flagComodatoDuso`:

```prisma
  preImm2015           Boolean   @default(false)
  flagComodatoDuso     Boolean   @default(false)
  flagDelegaVendita    Boolean   @default(false)
```

- [ ] **Step 3: Genera e applica la migration (dev)**

Assicurati che il DB Postgres locale (docker) sia attivo, poi:

Run: `nvm use 22.15.0; pnpm --filter @pv/db exec prisma migrate dev --name delega_procura_vendita`

Expected: crea `packages/db/prisma/migrations/<timestamp>_delega_procura_vendita/migration.sql` con (circa):

```sql
-- AlterEnum
ALTER TYPE "DocumentoTipo" ADD VALUE 'DELEGA_VENDITA';
ALTER TYPE "DocumentoTipo" ADD VALUE 'DOCUMENTO_DELEGATO';

-- AlterTable
ALTER TABLE "Veicolo" ADD COLUMN "flagDelegaVendita" BOOLEAN NOT NULL DEFAULT false;
```

e rigenera il Prisma Client. Output finale: "Your database is now in sync with your schema" + "Generated Prisma Client".

- [ ] **Step 4: Verifica typecheck del package db**

Run: `pnpm --filter @pv/db run typecheck`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): enum DELEGA_VENDITA/DOCUMENTO_DELEGATO + Veicolo.flagDelegaVendita"
```

**Nota prod (NON in questo task):** in produzione la migration si applica con
`prisma migrate deploy` (processo di rilascio standard), non automaticamente.

---

### Task 3: Wizard — stato veicolo + domanda Sì/No (step 1)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
  - `type VeicoloInput` (~righe 121-135)
  - `emptyVeicolo()` (~righe 137-152)
  - `VeicoloSection` campi estratti (~dopo riga 1529, sotto il checkbox Pre-2015)

**Interfaces:**
- Consumes: `VeicoloInput` (da Task 1 niente; campo nuovo locale).
- Produces: `VeicoloInput.flagDelegaVendita: boolean`; UI Sì/No che chiama `onChange({ flagDelegaVendita })`.

- [ ] **Step 1: Aggiungi il campo a `VeicoloInput`**

In `wizard.tsx`, nel `type VeicoloInput`, dopo `flagComodatoDuso: boolean;`:

```ts
  preImm2015: boolean;
  flagComodatoDuso: boolean;
  flagDelegaVendita: boolean;
};
```

- [ ] **Step 2: Default in `emptyVeicolo()`**

```ts
    preImm2015: false,
    flagComodatoDuso: false,
    flagDelegaVendita: false,
  };
}
```

(Nessuna modifica all'autofill OCR: `updateVeicolo` fa merge parziale, quindi
`flagDelegaVendita` sopravvive all'estrazione.)

- [ ] **Step 3: Aggiungi i due bottoni Sì/No in `VeicoloSection`**

In `VeicoloSection`, dentro il blocco "Dati estratti", subito DOPO il `<div>` che
contiene il checkbox Pre-2015 (la riga `</div>` a ~riga 1530), aggiungi un nuovo
blocco a tutta larghezza:

```tsx
            <div className="flex flex-col gap-2 pt-6">
              <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                <Checkbox
                  checked={veicolo.preImm2015}
                  onChange={(e) => onChange({ preImm2015: e.target.checked })}
                />
                Pre-2015 (richiede certificato di proprietà)
              </label>
            </div>
            <div className="pt-2 sm:col-span-2">
              <p className="mb-2 text-[13px] font-semibold text-pv-navy-800">
                C&apos;è una delega/procura notarile a vendere?
              </p>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
                <button
                  type="button"
                  onClick={() => onChange({ flagDelegaVendita: false })}
                  className={`px-5 py-2 text-[13px] font-semibold transition ${
                    !veicolo.flagDelegaVendita
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ flagDelegaVendita: true })}
                  className={`border-l border-pv-slate-300 px-5 py-2 text-[13px] font-semibold transition ${
                    veicolo.flagDelegaVendita
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  Sì
                </button>
              </div>
            </div>
```

- [ ] **Step 4: Verifica typecheck + lint**

Run: `pnpm --filter piattaforma run typecheck`
Expected: nessun errore (nuovo campo presente ovunque `VeicoloInput` è costruito; `emptyVeicolo` lo fornisce; il submit payload verrà aggiornato nel Task 4).

Run: `pnpm --filter piattaforma run lint`
Expected: nessun errore nuovo.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): domanda Si/No delega a vendere per veicolo (step 1)"
```

---

### Task 4: Wizard — allegati delega (step 2) + gate `canStep2` + submit

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
  - import del modulo `delega-docs`
  - helper di render `renderDelegaDocs` (vicino a `renderVenditore`, ~riga 765)
  - `canStep2` (~righe 856-863)
  - inserimento sezione nei due layout step 2 (~riga 1070 e ~riga 1099)
  - hint pre-bottoni (~riga 1103)
  - submit: `veicoliPayload` (~righe 601-609) + loop `documenti`→`blobRefs` (~righe 652-655)

**Interfaces:**
- Consumes (da Task 1): `delegatoDocKey`, `procuraDelegaDocKey`, `delegaDocsComplete`.
- Consumes (esistenti nel file): `UploadCard`, `uploadDocumento(k, file|null)`, stato `documenti: Record<string, BlobSlot>`.

- [ ] **Step 1: Import del modulo delega-docs**

In cima a `wizard.tsx`, accanto agli altri import locali (es. dopo l'import di `./venditori-per-veicolo`):

```ts
import { intestatariPerVeicolo, crossCheckPerVeicolo } from './venditori-per-veicolo';
import {
  delegatoDocKey,
  procuraDelegaDocKey,
  delegaDocsComplete,
} from './delega-docs';
```

- [ ] **Step 2: Helper `renderDelegaDocs` accanto a `renderVenditore`**

Subito dopo la definizione di `renderVenditore` (dopo la sua `);` di chiusura, ~riga 851), aggiungi:

```tsx
  // Allegati delega/procura a vendere per un veicolo (solo se flag = Sì).
  // Due UploadCard riusate (stessa grafica + scanner). Nessun OCR.
  const renderDelegaDocs = (ord: number) => {
    const veic = veicoli[ord - 1];
    if (!veic?.flagDelegaVendita) return null;
    const kDel = delegatoDocKey(ord);
    const kProc = procuraDelegaDocKey(ord);
    return (
      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <h3 className="mb-1 text-[14px] font-bold text-pv-navy-800">
          Delega a vendere
        </h3>
        <p className="mb-4 text-[12.5px] text-pv-slate-500">
          Allega il documento del delegato e la procura notarile a vendere
          (obbligatori).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UploadCard
            label="Documento del delegato"
            slot={documenti[kDel]}
            onSelect={(file) => uploadDocumento(kDel, file)}
            onRemove={() => uploadDocumento(kDel, null)}
          />
          <UploadCard
            label="Procura notarile a vendere"
            slot={documenti[kProc]}
            onSelect={(file) => uploadDocumento(kProc, file)}
            onRemove={() => uploadDocumento(kProc, null)}
          />
        </div>
      </div>
    );
  };
```

- [ ] **Step 3: Aggiorna `canStep2` con la completezza delega**

Sostituisci il blocco `const canStep2 = ...` (~righe 856-863) con:

```ts
  const delegaCompleta = delegaDocsComplete(veicoli, (k) => {
    const s = documenti[k];
    return !!s?.ref && !s.uploading;
  });
  const canStep2 =
    venditori.every(
      (v, i) =>
        parteValida(v) &&
        identitaPresente(v.docId, v.identita) &&
        !identitaUploading(v.identita) &&
        verdettiVenditori[i]!.ok,
    ) &&
    ccVend !== 'MISMATCH' &&
    delegaCompleta;
```

- [ ] **Step 4: Inserisci la sezione nel layout multiplo (accordion)**

Nel ramo `multiplo ? (...)`, dentro il blocco `{aperto && (...)}`, subito DOPO il
`<div className="flex justify-start">...+ Aggiungi co-intestatario...</div>`
(la sua `</div>` a ~riga 1070), aggiungi:

```tsx
                        <div className="flex justify-start">
                          <Button variant="secondary" onClick={() => addVenditore(ord)}>
                            + Aggiungi co-intestatario
                          </Button>
                        </div>
                        {renderDelegaDocs(ord)}
```

- [ ] **Step 5: Inserisci la sezione nel layout singolo (flat)**

Nel ramo `: (<> ... </>)`, subito DOPO il
`<div className="flex justify-start">...+ Aggiungi venditore...</div>`
(la sua `</div>` a ~riga 1099), aggiungi:

```tsx
                <div className="flex justify-start">
                  <Button variant="secondary" onClick={() => addVenditore(1)}>
                    + Aggiungi venditore (co-intestatario)
                  </Button>
                </div>
                {renderDelegaDocs(1)}
```

- [ ] **Step 6: Hint quando la delega è incompleta**

Subito PRIMA del `<div className="flex flex-col-reverse gap-3 ...">` dei bottoni
Indietro/Avanti (~riga 1103), aggiungi:

```tsx
            {!delegaCompleta && (
              <Alert variant="error">
                Per i veicoli con delega/procura a vendere, carica sia il documento
                del delegato sia la procura notarile prima di procedere.
              </Alert>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
```

- [ ] **Step 7: Submit — aggiungi `flagDelegaVendita` a `veicoliPayload`**

Nel builder `veicoliPayload` (~righe 601-609):

```ts
    const veicoliPayload = veicoli.map((v) => ({
      targa: v.targa,
      telaio: v.telaio,
      proprietarioAttuale: v.proprietarioAttuale,
      dataImmatricolazione: v.dataImmatricolazione || null,
      preImm2015: v.preImm2015,
      flagComodatoDuso: v.flagComodatoDuso,
      flagDelegaVendita: v.flagDelegaVendita,
      ocrData: v.ocr ?? null,
    }));
```

- [ ] **Step 8: Submit — serializza gli slot DELEGA_ senza prefisso DOC__**

Sostituisci il loop `documenti`→`blobRefs` (~righe 652-655):

```ts
    // Documenti richiesti (step Documenti) come slot DOC__<docKey> (BlobRef).
    // Eccezione: i due allegati delega/procura usano la propria chiave DELEGA_*
    // (non passano per l'engine documenti richiesti).
    for (const [key, slot] of Object.entries(documenti)) {
      if (!slot.ref) continue;
      blobRefs[key.startsWith('DELEGA_') ? key : `DOC__${key}`] = slot.ref;
    }
```

- [ ] **Step 9: Verifica typecheck + lint + build**

Run: `pnpm --filter piattaforma run typecheck`
Expected: nessun errore.

Run: `pnpm --filter piattaforma run lint`
Expected: nessun errore nuovo.

Run: `pnpm --filter piattaforma run build`
Expected: build OK.

- [ ] **Step 10: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): allegati delega/procura obbligatori nello step venditore"
```

---

### Task 5: Server action — schema, check presenza, persistenza

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`
  - import `delega-docs`
  - `veicoloSchema` (~righe 274-287)
  - check presenza prima della transazione (~dopo riga 514)
  - descrittori upload prima della transazione (~dopo riga 828)
  - persistenza dentro il loop veicolo (~dopo riga 927)

**Interfaces:**
- Consumes (da Task 1): `delegaDocsComplete`, `delegatoDocKey`, `procuraDelegaDocKey`.
- Consumes (esistenti): `getRef(slot): FileRef | null`, `refToPut(ref)`, `veicoli` (= `d.veicoli`), `veicoloIdByOrdine`, `userId`, `tx.documento.create`.

- [ ] **Step 1: Import del modulo delega-docs**

In cima ad `actions.ts`, tra gli import locali:

```ts
import {
  delegaDocsComplete,
  delegatoDocKey,
  procuraDelegaDocKey,
} from './delega-docs';
```

- [ ] **Step 2: Aggiungi `flagDelegaVendita` a `veicoloSchema`**

Nel `veicoloSchema` (~righe 274-287):

```ts
  preImm2015: z.boolean().default(false),
  flagComodatoDuso: z.boolean().default(false),
  flagDelegaVendita: z.boolean().default(false),
  // Snapshot OCR opzionale (così com'è arrivato dall'estrazione, pre-correzione).
  ocrData: z.record(z.string(), z.unknown()).optional().nullable(),
});
```

- [ ] **Step 3: Check presenza obbligatoria (server autoritativo)**

Subito DOPO il blocco `if (esitoSchema.kind === 'INPUT_INCOMPLETO') { redirect(...) }`
(~riga 514), aggiungi:

```ts
  // Delega/procura a vendere: se il broker ha selezionato Sì per un veicolo,
  // entrambi gli allegati sono obbligatori (solo presenza, nessuna validazione
  // di contenuto). Server-side è la fonte autoritativa.
  const delegaCompleta = delegaDocsComplete(veicoli, (k) => !!getRef(k));
  if (!delegaCompleta) {
    redirect(
      `/pratiche/nuova?error=${encodeURIComponent(
        'Per i veicoli con delega/procura a vendere servono il documento del delegato e la procura notarile.',
      )}`,
    );
  }
```

- [ ] **Step 4: Descrittori upload prima della transazione**

Subito DOPO `const identitaUploads = identitaCandidates.map(...)` (~riga 828),
aggiungi:

```ts
  // Delega/procura a vendere: due allegati per veicolo con flag (presenza già
  // verificata sopra). Nessun OCR/gating: solo persistenza, linkati al veicolo.
  const delegaUploads = veicoli.flatMap((v, i) => {
    if (!v.flagDelegaVendita) return [];
    const ord = i + 1;
    return [
      {
        veicoloOrdine: ord,
        tipo: 'DOCUMENTO_DELEGATO' as const,
        put: refToPut(getRef(delegatoDocKey(ord))!),
      },
      {
        veicoloOrdine: ord,
        tipo: 'DELEGA_VENDITA' as const,
        put: refToPut(getRef(procuraDelegaDocKey(ord))!),
      },
    ];
  });
```

- [ ] **Step 5: Persistenza dentro la transazione (dopo il loop veicolo)**

Subito DOPO la chiusura del loop `for (let i = 0; i < veicoli.length; i++) { ... }`
che crea veicoli + libretto (la `}` a ~riga 927, prima del commento "Tipi pratica
multiveicolo (B7): N venditori..."), aggiungi:

```ts
    // Delega/procura a vendere: righe Documento linkate al veicolo (no OCR,
    // gating non applicabile → PASSED). veicoloIdByOrdine è già popolata sopra.
    for (const u of delegaUploads) {
      await tx.documento.create({
        data: {
          tipo: u.tipo,
          owner: 'VENDITORE',
          praticaId: created.id,
          veicoloId: veicoloIdByOrdine.get(u.veicoloOrdine) ?? null,
          storageKey: u.put.storageKey,
          storageProvider: u.put.storageProvider,
          mimeType: u.put.mimeType,
          sizeBytes: u.put.sizeBytes,
          originalFilename: u.put.originalFilename,
          uploadedById: userId,
          ocrStato: 'NONE',
          gatingStato: 'PASSED',
        },
      });
    }
```

- [ ] **Step 6: Verifica typecheck + lint**

Run: `pnpm --filter piattaforma run typecheck`
Expected: nessun errore (i tipi `'DOCUMENTO_DELEGATO'`/`'DELEGA_VENDITA'` ora esistono nell'enum Prisma dal Task 2; `owner: 'VENDITORE'` valido; `ocrStato: 'NONE'` valido).

Run: `pnpm --filter piattaforma run lint`
Expected: nessun errore nuovo.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): persistenza allegati delega/procura + check obbligatori server"
```

---

### Task 6: Etichette agenzia/broker + verifica finale

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/[id]/page.tsx` (`labelDocumento`, ~righe 318-330)
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (`labelDocumento`, ~riga 570)

**Interfaces:**
- Consumes: tipi `DELEGA_VENDITA` / `DOCUMENTO_DELEGATO` (string) dalle righe Documento.

- [ ] **Step 1: Etichette nell'inbox agenzia**

In `apps/piattaforma/src/app/inbox/[id]/page.tsx`, nella mappa di `labelDocumento`,
dopo `ALTRO: 'Altro',`:

```ts
    CERTIFICATO_PROPRIETA: 'Certificato di proprietà',
    ALTRO: 'Altro',
    DELEGA_VENDITA: 'Procura a vendere',
    DOCUMENTO_DELEGATO: 'Documento delegato',
  };
```

- [ ] **Step 2: Etichette nel dettaglio broker**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx`, nella mappa di `labelDocumento`
(~riga 570), aggiungi le stesse due voci:

```ts
    DELEGA_VENDITA: 'Procura a vendere',
    DOCUMENTO_DELEGATO: 'Documento delegato',
```

(Inserisci coerentemente con le voci già presenti nella mappa; se la mappa non ha
`ALTRO`, aggiungile comunque in coda prima della `}`.)

- [ ] **Step 3: Verifica completa app**

Run: `pnpm --filter piattaforma run typecheck`
Expected: nessun errore.

Run: `pnpm --filter piattaforma run lint`
Expected: nessun errore nuovo (warning pre-esistenti ammessi).

Run: `pnpm --filter piattaforma run test`
Expected: tutti i test PASS (inclusi i 5 nuovi di `delega-docs.test.ts`).

Run: `pnpm --filter piattaforma run build`
Expected: build OK.

- [ ] **Step 4: Verifica manuale del flusso (dev)**

Run: `nvm use 22.15.0; pnpm --filter piattaforma run dev` e nel browser:
1. Nuova pratica → carica un libretto → attendi estrazione → compare la domanda
   "C'è una delega/procura notarile a vendere?" con bottoni No/Sì (No attivo).
2. Lascia No → step 2 invariato (nessuna sezione delega). Avanza normalmente.
3. Torna, scegli Sì → step 2: nel gruppo del veicolo compare "Delega a vendere"
   con due UploadCard. Con file mancanti, "Avanti" è disabilitato + hint rosso.
4. Carica entrambi → "Avanti" si abilita. Completa e invia la pratica.
5. Verifica che la pratica creata abbia due Documento (`Procura a vendere`,
   `Documento delegato`) nella lista documenti del dettaglio.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/inbox/[id]/page.tsx apps/piattaforma/src/app/pratiche/[id]/page.tsx
git commit -m "feat(pratiche): etichette documenti delega/procura per agenzia e broker"
```

---

## Note finali

- **Seed (opzionale, fuori scope):** si può aggiungere un caso seed con
  `flagDelegaVendita: true` + due Documento per QA; non necessario al funzionamento.
- **Download agenzia:** già coperto dalla route esistente `GET /api/documenti/[id]`
  (autorizza l'agenzia assegnata). I due allegati sono righe Documento standard
  linkate al veicolo, quindi scaricabili come gli altri. Aggiungere un link di
  download nella lista inbox è una miglioria separata (fuori scope).
- **Engine documentale:** non toccato; `flagProcura` resta dormiente.
