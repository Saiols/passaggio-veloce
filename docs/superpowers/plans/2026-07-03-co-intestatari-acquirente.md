# Co-intestatari acquirente + tipo soggetto in cima — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consentire più intestatari acquirente (CTA "aggiungi co-intestatario", solo pratiche SEMPLICE) con le stesse verifiche documentali del principale, e spostare il selettore "tipo soggetto" in cima allo step acquirente.

**Architecture:** L'acquirente principale resta *embedded* sui campi `Pratica` (retrocompatibile). I co-intestatari sono una nuova tabella `CoAcquirente` (mirror di `Venditore`, a livello pratica), coi documenti d'identità linkati via nuova FK `Documento.coAcquirenteId`. Il wizard replica il blocco acquirente (tipo soggetto + anagrafica + documento + residenza) per ogni co-intestatario; il submit li invia come JSON `coAcquirenti` + slot blob `COACQ<n>_*`, e il server li verifica per-parte (fail-closed) e li persiste in transazione.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Prisma 5.22 + Postgres, Zod, Vitest, Playwright, TypeScript, pnpm/Turborepo.

## Global Constraints

- **Scope tipi pratica:** i co-intestatari acquirente esistono **solo** per `tipo === 'SEMPLICE'`. Fuori da SEMPLICE la UI li nasconde/azzera e il server li ignora.
- **Nessuna migrazione dati:** l'acquirente principale NON si sposta in tabella; migration solo **additiva** (nuova tabella + colonna nullable).
- **Verifica documentale:** riusa `validaParte`/`verificaDocumentaleParte` (OCR identità che combacia coi dati; visura fresca per PG; permesso valido per stranieri). **Nessun** cross-check col libretto per gli acquirenti.
- **Prefissi slot blob:** `COACQ<n>_*` con gli stessi suffissi di `ACQ_*`/`VEND<n>_*`: `_ID_FRONTE`, `_ID_RETRO`, `_ID`, `_PERMESSO`, `_VISURA`, `_CF`, `_CF_RETRO`.
- **Node dev:** usare Node 22 (`nvm use 22.15.0`) per i comandi pnpm.
- **Comandi ripetuti:** typecheck app = `pnpm --filter piattaforma typecheck`; lint file = `pnpm --filter piattaforma lint <path>`; test app = `pnpm --filter piattaforma test`; Prisma = script del package `@pv/db`.
- **DB prod:** Neon `ep-solitary-night`; migration applicata a mano con `db:deploy` (fuori da questo piano, in rilascio).

---

### Task 1: DB — modello `CoAcquirente` + FK `Documento.coAcquirenteId` + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Pratica` ~667-776, model `Documento` ~859-914, aggiunta nuovo model)
- Create: `packages/db/prisma/migrations/<timestamp>_co_acquirenti/migration.sql` (generata da Prisma)

**Interfaces:**
- Produces: tabella `co_acquirenti`; `Documento.coAcquirenteId` (nullable, FK `SetNull`); relazione `Pratica.coAcquirenti`; client Prisma con `tx.coAcquirente.create(...)`.

- [ ] **Step 1: Aggiungere la relazione inversa al model `Pratica`**

In `model Pratica`, accanto a `venditori Venditore[]` (riga ~770), aggiungere:

```prisma
  venditori               Venditore[]
  coAcquirenti            CoAcquirente[]
```

- [ ] **Step 2: Aggiungere la FK al model `Documento`**

In `model Documento`, dopo il blocco `venditore` (righe ~876-878), aggiungere:

```prisma
  // Co-intestatario acquirente: documenti identità/permesso per parte
  coAcquirenteId String?       @db.Uuid
  coAcquirente   CoAcquirente? @relation("DocumentiCoAcquirente", fields: [coAcquirenteId], references: [id], onDelete: SetNull)
```

E aggiungere l'indice, accanto a `@@index([venditoreId])` (riga ~910):

```prisma
  @@index([venditoreId])
  @@index([coAcquirenteId])
```

- [ ] **Step 3: Aggiungere il model `CoAcquirente`**

Subito dopo `model Venditore { ... }` (riga ~968), aggiungere:

```prisma
model CoAcquirente {
  id                 String        @id @default(uuid()) @db.Uuid
  praticaId          String        @db.Uuid
  pratica            Pratica       @relation(fields: [praticaId], references: [id], onDelete: Cascade)
  ordine             Int
  nome               String?
  cognome            String?
  cf                 String?
  isPersonaGiuridica Boolean       @default(false)
  ragioneSociale     String?
  piva               String?
  telefono           String?
  email              String?
  tipoSoggetto       TipoSoggetto?
  visuraData         DateTime?     @db.Date
  permessoData       DateTime?     @db.Date
  documentoIdentita  String?
  indirizzoResidenza String? // null = stesso del documento
  documenti          Documento[]   @relation("DocumentiCoAcquirente")
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@index([praticaId])
  @@map("co_acquirenti")
}
```

- [ ] **Step 4: Generare la migration + client**

Assicurarsi che il DB Postgres locale (docker) sia attivo, poi:

Run: `cd packages/db && pnpm db:migrate -- --name co_acquirenti`
Expected: Prisma crea `migrations/<timestamp>_co_acquirenti/migration.sql` (CREATE TABLE co_acquirenti + ALTER TABLE documenti ADD coAcquirenteId + FK + indici), applica al DB locale e rigenera il client. Nessun prompt di data-loss (è additivo).

- [ ] **Step 5: Verificare typecheck del package DB**

Run: `pnpm --filter @pv/db typecheck`
Expected: PASS (il client rigenerato espone `coAcquirente` e `coAcquirenteId`).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): modello CoAcquirente + FK Documento.coAcquirenteId (co-intestatari acquirente)"
```

---

### Task 2: Client — helper puro `residenzaOk` (TDD) + riuso nel gate esistente

Piccolo refactor DRY che introduciamo *prima* dei co-intestatari: estrarre la logica "residenza ok" oggi inline nel gate acquirente, testarla, e riusarla (poi la useremo anche per i co-intestatari).

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/nuova/residenza.ts`
- Create: `apps/piattaforma/src/app/pratiche/nuova/residenza.test.ts`
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (riga ~1428-1429)

**Interfaces:**
- Produces: `residenzaOk(residenzaDiversa: boolean, indirizzo: string): boolean` — `true` se la residenza è uguale al documento, oppure se è diversa ma l'indirizzo (trim) non è vuoto.

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/app/pratiche/nuova/residenza.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { residenzaOk } from './residenza';

describe('residenzaOk', () => {
  it('ok quando la residenza è uguale al documento (nessun indirizzo richiesto)', () => {
    expect(residenzaOk(false, '')).toBe(true);
  });
  it('ok quando è diversa e l’indirizzo è compilato', () => {
    expect(residenzaOk(true, 'Via Roma 1, Milano')).toBe(true);
  });
  it('ko quando è diversa ma l’indirizzo è vuoto o solo spazi', () => {
    expect(residenzaOk(true, '')).toBe(false);
    expect(residenzaOk(true, '   ')).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire il test — deve fallire**

Run: `pnpm --filter piattaforma test residenza`
Expected: FAIL (`Cannot find module './residenza'`).

- [ ] **Step 3: Implementare il modulo**

`apps/piattaforma/src/app/pratiche/nuova/residenza.ts`:

```ts
/**
 * Gate residenza di una parte: se la residenza è "uguale al documento" non
 * serve indirizzo; se è "diversa" serve un indirizzo non vuoto. Puro/testabile,
 * riusato per l'acquirente principale e per i co-intestatari.
 */
export function residenzaOk(residenzaDiversa: boolean, indirizzo: string): boolean {
  return !residenzaDiversa || indirizzo.trim().length > 0;
}
```

- [ ] **Step 4: Eseguire il test — deve passare**

Run: `pnpm --filter piattaforma test residenza`
Expected: PASS (3 test).

- [ ] **Step 5: Riusare l'helper nel gate acquirente**

In `wizard.tsx`, importare (accanto agli altri import locali, es. dopo `./acquirente-indirizzo`):

```ts
import { residenzaOk } from './residenza';
```

E sostituire (righe ~1428-1429):

```ts
  const residenzaOk =
    !acquirenteResidenzaDiversa || acquirenteIndirizzoResidenza.trim().length > 0;
```

con l'uso dell'helper (rinominando la const locale per non collidere con l'import):

```ts
  const residenzaAcqOk = residenzaOk(
    acquirenteResidenzaDiversa,
    acquirenteIndirizzoResidenza,
  );
```

e aggiornare `canStep3` (riga ~1435) da `residenzaOk` a `residenzaAcqOk`.

- [ ] **Step 6: Verificare typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/residenza.ts apps/piattaforma/src/app/pratiche/nuova/residenza.test.ts apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "refactor(pratiche): estrai residenzaOk puro + test, riusa nel gate acquirente"
```

---

### Task 3: Client — Punto 1: "Tipo soggetto" in cima allo step acquirente

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (IdentitaSection ~2660-2782; step 3 render ~1804-1867)

**Interfaces:**
- Produces: prop `hideTipoSoggetto?: boolean` su `IdentitaSection` (default `false`); quando `true` la sezione NON renderizza il Field "Tipo soggetto" né il divider successivo.

- [ ] **Step 1: Aggiungere il prop a `IdentitaSection`**

Nel destructuring dei props di `IdentitaSection` (dopo `onInvalidateCf,` ~2677) aggiungere `hideTipoSoggetto = false,`; e nel tipo dei props (dopo `onInvalidateCf: () => void;` ~2695) aggiungere:

```ts
  /** Nasconde il selettore "Tipo soggetto" (reso esternamente sopra i dati:
   *  vale solo per lo step acquirente). Default: mostrato inline (venditore). */
  hideTipoSoggetto?: boolean;
```

- [ ] **Step 2: Rendere condizionale il Field "Tipo soggetto"**

Nel corpo di `IdentitaSection` (righe ~2766-2782), avvolgere il Field + il divider:

```tsx
      {!hideTipoSoggetto && (
        <>
          <Field label="Tipo soggetto" required>
            <Select
              value={tipoSoggetto ?? ''}
              onChange={(e) => onTipoSoggetto(e.target.value as TipoSoggetto)}
            >
              <option value="" disabled>
                Seleziona tipo…
              </option>
              {tipiSoggetto.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="my-3 h-px bg-pv-slate-200" />
        </>
      )}
```

- [ ] **Step 3: Rendere il "Tipo soggetto" in cima alla card Acquirente**

Nello step 3 (righe ~1804-1816), dentro la card "Acquirente", inserire il selettore PRIMA di `<ParteForm>`:

```tsx
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Acquirente</h2>
              {tipo === 'MINIVOLTURA' && (
                <p className="mb-3 text-[12px] text-pv-slate-500">
                  Nelle minivolture l&apos;acquirente è un commerciante d&apos;auto
                  (operatore auto), con visura camerale.
                </p>
              )}
              <Field label="Tipo soggetto" required>
                <Select
                  value={acquirente.tipoSoggetto ?? ''}
                  onChange={(e) => {
                    const next = e.target.value as TipoSoggetto;
                    const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
                    setAcquirente((prev) => ({
                      ...prev,
                      tipoSoggetto: next,
                      isPG,
                      visuraOcr: isPG ? prev.visuraOcr : undefined,
                      permessoOcr: next === 'STRANIERO_EXTRA_UE' ? prev.permessoOcr : undefined,
                    }));
                  }}
                >
                  <option value="" disabled>
                    Seleziona tipo…
                  </option>
                  {acquirenteTipiSoggetto.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="my-3 h-px bg-pv-slate-200" />
              <ParteForm parte={acquirente} onChange={setAcquirente} />
            </div>
```

- [ ] **Step 4: Passare `hideTipoSoggetto` all'`IdentitaSection` dell'acquirente**

Nell'`IdentitaSection` dell'acquirente (riga ~1818), aggiungere il prop `hideTipoSoggetto` (l'handler `onTipoSoggetto` resta invariato, non più usato per il render ma innocuo). Aggiungere subito dopo `titolo="Documento d'identità dell'acquirente"`:

```tsx
            <IdentitaSection
              titolo="Documento d'identità dell'acquirente"
              hideTipoSoggetto
              docId={acquirenteDocId}
```

- [ ] **Step 5: Verificare typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint src/app/pratiche/nuova/wizard.tsx`
Expected: PASS.

- [ ] **Step 6: Verifica manuale**

Avviare `pnpm --filter piattaforma dev`, aprire una nuova pratica SEMPLICE, andare allo step Acquirente: il selettore "Tipo soggetto" è in cima alla card, sopra i campi; scegliendo "Azienda"/"Operatore auto" i campi passano a ragione sociale/P.IVA. Lo step Venditore mostra ancora il tipo soggetto dentro la sezione documento (invariato).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): tipo soggetto in cima allo step acquirente (venditore invariato)"
```

---

### Task 4: Client — tipo, stato, helper e bozza dei co-intestatari

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (tipi ~253-264; WizardDraftState ~305-330; stato ~470-489; handleCardSelect ~430-443; draft save ~596-641; hydrate ~556-573)
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard-draft.ts` (DRAFT_VERSION ~17)

**Interfaces:**
- Produces:
  - `type CoAcquirenteInput = Parte & { docId: DocIdTipo; identita: IdentitaFiles; residenzaDiversa: boolean; indirizzoResidenza: string }`
  - `emptyCoAcquirente(): CoAcquirenteInput`
  - stato `coAcquirenti: CoAcquirenteInput[]` + `setCoAcquirenti`
  - `addCoAcquirente(): void`, `removeCoAcquirente(idx: number): void`, `updateCoAcquirente(idx: number, patch: Partial<CoAcquirenteInput>): void`

- [ ] **Step 1: Definire il tipo + factory**

In `wizard.tsx`, dopo `emptyVenditore` (riga ~264), aggiungere:

```ts
/**
 * Co-intestatario acquirente (solo pratiche SEMPLICE): stessi campi del blocco
 * acquirente principale (Parte + documento + residenza), a livello pratica.
 */
type CoAcquirenteInput = Parte & {
  docId: DocIdTipo;
  identita: IdentitaFiles;
  residenzaDiversa: boolean;
  indirizzoResidenza: string;
};

const emptyCoAcquirente = (): CoAcquirenteInput => ({
  ...emptyParte(),
  docId: 'CI',
  identita: {},
  residenzaDiversa: false,
  indirizzoResidenza: '',
});
```

- [ ] **Step 2: Aggiungere il campo a `WizardDraftState`**

In `WizardDraftState` (dopo `venditori: VenditoreInput[];` ~311) aggiungere:

```ts
  coAcquirenti: CoAcquirenteInput[];
```

- [ ] **Step 3: Aggiungere lo stato + gli helper**

Dopo `const [acquirenteIndirizzoResidenza, setAcquirenteIndirizzoResidenza] = useState('');` (~489), aggiungere:

```ts
  // Co-intestatari acquirente (solo SEMPLICE). Default: nessuno.
  const [coAcquirenti, setCoAcquirenti] = useState<CoAcquirenteInput[]>([]);
  const updateCoAcquirente = (idx: number, patch: Partial<CoAcquirenteInput>) =>
    setCoAcquirenti((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const addCoAcquirente = () => setCoAcquirenti((prev) => [...prev, emptyCoAcquirente()]);
  const removeCoAcquirente = (idx: number) =>
    setCoAcquirenti((prev) => prev.filter((_, i) => i !== idx));
```

- [ ] **Step 4: Azzerare i co-intestatari fuori da SEMPLICE**

In `handleCardSelect` (riga ~430), nel ramo `if (card.tipo !== 'MINIVOLTURA')` NON serve azzerare; nel ramo `else` (MINIVOLTURA, ~436) aggiungere in cima al blocco:

```ts
    } else {
      // MINIVOLTURA: acquirente singolo commerciante → via eventuali co-intestatari.
      setCoAcquirenti([]);
      // MINIVOLTURA: l'acquirente è un operatore auto → preimposta.
      setAcquirente((prev) =>
```

- [ ] **Step 5: Salvare i co-intestatari nella bozza**

Nell'oggetto `draft` della useEffect di salvataggio (dopo `venditori: ...` ~606) aggiungere:

```ts
          coAcquirenti: coAcquirenti.map((c) => ({
            ...c,
            identita: identitaForStorage(c.identita),
          })),
```

E aggiungere `coAcquirenti` all'array di dipendenze della useEffect (dopo `venditori,` ~633).

- [ ] **Step 6: Ripristinare i co-intestatari in hydration**

Nel blocco di restore della bozza (dopo `if (Array.isArray(d.venditori)) setVenditori(d.venditori);` ~566) aggiungere:

```ts
        if (Array.isArray(d.coAcquirenti)) setCoAcquirenti(d.coAcquirenti);
```

- [ ] **Step 7: Bump `DRAFT_VERSION`**

In `wizard-draft.ts`, portare `DRAFT_VERSION` da `3` a `4` e aggiungere alla docstring:

```ts
 * v4: aggiunto coAcquirenti (co-intestatari acquirente).
 */
export const DRAFT_VERSION = 4;
```

- [ ] **Step 8: Verificare typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx apps/piattaforma/src/app/pratiche/nuova/wizard-draft.ts
git commit -m "feat(pratiche): stato + bozza co-intestatari acquirente (client)"
```

---

### Task 5: Client — UI dei co-intestatari (render + CTA, solo SEMPLICE)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (step 3 render, dopo la card residenza del principale ~1930-1960)

**Interfaces:**
- Consumes: `coAcquirenti`, `addCoAcquirente`, `removeCoAcquirente`, `updateCoAcquirente`, `setCoAcquirenti`, `acquirenteTipiSoggetto`, `residenzaOk`, gli helper OCR (`runIdentitaOcr`, `runVisuraOcr`, `runPermessoOcr`, `runCfOcr`), `IdentitaSection`, `ParteForm`, `AddressAutocomplete`, `hasMaps`, `formatIndirizzo`.
- Produces: funzione locale `renderCoAcquirente(c: CoAcquirenteInput, idx: number)` che ripropone il blocco acquirente completo (tipo soggetto in cima + ParteForm + IdentitaSection con `hideTipoSoggetto` + residenza).

- [ ] **Step 1: Scrivere `renderCoAcquirente`**

In `wizard.tsx`, accanto a `renderVenditore` (dopo la sua chiusura ~1372), aggiungere una funzione che rende il blocco per un co-intestatario. Usa gli stessi handler OCR instradati su `setCoAcquirenti`:

```tsx
  // Blocco di un singolo co-intestatario acquirente (solo SEMPLICE): stesso
  // layout del principale (tipo soggetto in cima → anagrafica → documento →
  // residenza). Verifica documentale per-parte identica all'acquirente.
  const renderCoAcquirente = (c: CoAcquirenteInput, idx: number) => (
    <div key={idx} className="space-y-5">
      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Co-intestatario {idx + 1}
          </h2>
          <button
            type="button"
            onClick={() => removeCoAcquirente(idx)}
            className="text-[12.5px] font-semibold text-pv-red-500 underline hover:text-pv-red-600"
          >
            Rimuovi
          </button>
        </div>
        <Field label="Tipo soggetto" required>
          <Select
            value={c.tipoSoggetto ?? ''}
            onChange={(e) => {
              const next = e.target.value as TipoSoggetto;
              const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
              updateCoAcquirente(idx, {
                tipoSoggetto: next,
                isPG,
                visuraOcr: isPG ? c.visuraOcr : undefined,
                permessoOcr: next === 'STRANIERO_EXTRA_UE' ? c.permessoOcr : undefined,
              });
            }}
          >
            <option value="" disabled>
              Seleziona tipo…
            </option>
            {acquirenteTipiSoggetto.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="my-3 h-px bg-pv-slate-200" />
        <ParteForm parte={c} onChange={(p) => updateCoAcquirente(idx, p)} />
      </div>

      <IdentitaSection
        titolo={`Documento d'identità — co-intestatario ${idx + 1}`}
        hideTipoSoggetto
        docId={c.docId}
        onDocId={(t) => updateCoAcquirente(idx, { docId: t })}
        files={c.identita}
        isPG={c.isPG}
        tipoSoggetto={c.tipoSoggetto}
        tipiSoggetto={acquirenteTipiSoggetto}
        onTipoSoggetto={(next) => {
          const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
          updateCoAcquirente(idx, { tipoSoggetto: next, isPG });
        }}
        onFiles={(updater) =>
          setCoAcquirenti((prev) =>
            prev.map((cc, i) => (i === idx ? { ...cc, identita: updater(cc.identita) } : cc)),
          )
        }
        onMainRef={(ref) =>
          runIdentitaOcr<CoAcquirenteInput>(ref, c.docId, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc, i) => (i === idx ? upd(cc) : cc))),
          )
        }
        onVisuraRef={(ref) =>
          runVisuraOcr<CoAcquirenteInput>(ref, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc, i) => (i === idx ? upd(cc) : cc))),
          )
        }
        onPermessoRef={(ref) =>
          runPermessoOcr<CoAcquirenteInput>(ref, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc, i) => (i === idx ? upd(cc) : cc))),
          )
        }
        onInvalidateVisura={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc, i) => (i === idx ? { ...cc, visuraOcr: undefined } : cc)),
          )
        }
        onInvalidatePermesso={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc, i) => (i === idx ? { ...cc, permessoOcr: undefined } : cc)),
          )
        }
        onCfRef={(ref) =>
          runCfOcr<CoAcquirenteInput>(ref, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc, i) => (i === idx ? upd(cc) : cc))),
          )
        }
        onInvalidateCf={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc, i) => (i === idx ? { ...cc, codiceFiscaleOcr: undefined } : cc)),
          )
        }
        onInvalidateIdentita={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc, i) => (i === idx ? { ...cc, identitaOcr: undefined } : cc)),
          )
        }
      />

      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <p className="mb-2 text-[14px] font-semibold text-pv-navy-800">
          L&apos;indirizzo di residenza è lo stesso indicato nel documento?
        </p>
        <div className="inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
          <button
            type="button"
            onClick={() => updateCoAcquirente(idx, { residenzaDiversa: false, indirizzoResidenza: '' })}
            className={`px-5 py-2 text-[13px] font-semibold transition ${
              !c.residenzaDiversa
                ? 'bg-pv-navy-800 text-white'
                : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
            }`}
          >
            Sì
          </button>
          <button
            type="button"
            onClick={() => updateCoAcquirente(idx, { residenzaDiversa: true })}
            className={`border-l border-pv-slate-300 px-5 py-2 text-[13px] font-semibold transition ${
              c.residenzaDiversa
                ? 'bg-pv-navy-800 text-white'
                : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
            }`}
          >
            No
          </button>
        </div>
        {c.residenzaDiversa && (
          <div className="mt-4">
            {hasMaps ? (
              <AddressAutocomplete
                label="Nuovo indirizzo di residenza"
                placeholder="Via, civico, città…"
                helpText="Inizia a digitare e seleziona dall'elenco."
                onSelect={(p) => updateCoAcquirente(idx, { indirizzoResidenza: formatIndirizzo(p) })}
              />
            ) : (
              <Input
                value={c.indirizzoResidenza}
                onChange={(e) => updateCoAcquirente(idx, { indirizzoResidenza: e.target.value })}
                placeholder="Via, civico, città…"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
```

> Nota: se `runIdentitaOcr`/`runVisuraOcr`/`runPermessoOcr`/`runCfOcr` sono già generici `<P extends Parte>` (come usati per i venditori con `<VenditoreInput>`), l'istanziazione `<CoAcquirenteInput>` compila senza modifiche. Se una di esse NON fosse generica, renderla generica come le altre (stessa firma di `runIdentitaOcr`).

- [ ] **Step 2: Renderizzare lista + CTA nello step 3 (solo SEMPLICE)**

Nello step 3, DOPO la card residenza dell'acquirente principale e prima della chiusura del blocco `step === 3` (~1930-1958, subito prima di `</div>` che chiude `space-y-5`), aggiungere:

```tsx
            {tipo === 'SEMPLICE' && (
              <>
                {coAcquirenti.map((c, idx) => renderCoAcquirente(c, idx))}
                <button
                  type="button"
                  onClick={addCoAcquirente}
                  className="w-full rounded-[12px] border border-dashed border-pv-navy-300 bg-pv-navy-50 px-4 py-3 text-[13px] font-semibold text-pv-navy-700 transition hover:bg-pv-navy-100"
                >
                  + Aggiungi co-intestatario
                </button>
              </>
            )}
```

- [ ] **Step 3: Verificare typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint src/app/pratiche/nuova/wizard.tsx`
Expected: PASS.

- [ ] **Step 4: Verifica manuale**

Nel dev server, step Acquirente di una pratica SEMPLICE: compare "+ Aggiungi co-intestatario"; il click aggiunge un blocco identico al principale (tipo soggetto in cima, anagrafica, documento, residenza) con "Rimuovi"; in una MINIVOLTURA la CTA non compare.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): UI co-intestatari acquirente + CTA (solo SEMPLICE)"
```

---

### Task 6: Client — gate + submit dei co-intestatari

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (verdetti ~1255-1261; canStep3 ~1430-1435; mancanzeStep3 ~1492-1502; submit ~1128-1160)

**Interfaces:**
- Consumes: `verificaDocumentaleParte`, `parteValida`, `identitaPresente`, `identitaUploading`, `mancanzeParte`, `parteCompleta`, `residenzaOk`, `now`, `atecoAllowed`.
- Produces: `verdettiCoAcquirenti: EsitoVerifica[]` (stessa forma di `verdettiVenditori`); estensione di `canStep3` e `mancanzeStep3`; campi FormData `coAcquirenti` (JSON) + slot `COACQ<n>_*`.

- [ ] **Step 1: Calcolare i verdetti per-parte dei co-intestatari**

Accanto a `verdettoAcquirente` (riga ~1255) aggiungere:

```ts
  const verdettiCoAcquirenti = coAcquirenti.map((c) =>
    verificaDocumentaleParte(c, c.docId, now, atecoAllowed, false),
  );
```

(Usare gli stessi argomenti di `verdettoAcquirente`; l'ultimo `false` = non richiede operatore auto, come i venditori.)

- [ ] **Step 2: Estendere `canStep3`**

Sostituire `canStep3` (righe ~1430-1435) con:

```ts
  const coAcquirentiOk = coAcquirenti.every(
    (c, i) =>
      parteValida(c) &&
      identitaPresente(c.docId, c.identita) &&
      !identitaUploading(c.identita) &&
      verdettiCoAcquirenti[i]!.ok &&
      residenzaOk(c.residenzaDiversa, c.indirizzoResidenza),
  );
  const canStep3 =
    parteValida(acquirente) &&
    identitaPresente(acquirenteDocId, acquirenteIdentita) &&
    !identitaUploading(acquirenteIdentita) &&
    verdettoAcquirente.ok &&
    residenzaAcqOk &&
    coAcquirentiOk;
```

- [ ] **Step 3: Estendere `mancanzeStep3`**

In fondo a `mancanzeStep3` (prima di `return m;` ~1501) aggiungere:

```ts
    coAcquirenti.forEach((c, i) => {
      const tag = ` (co-intestatario ${i + 1})`;
      mancanzeParte(c, c.docId, c.identita).forEach((x) => m.push(`${x}${tag}`));
      if (parteCompleta(c, c.docId, c.identita) && !verdettiCoAcquirenti[i]!.ok)
        m.push(`documenti co-intestatario da correggere${tag}`);
      if (!residenzaOk(c.residenzaDiversa, c.indirizzoResidenza))
        m.push(`indirizzo di residenza${tag}`);
    });
```

- [ ] **Step 4: Serializzare i co-intestatari nel submit (JSON + slot blob)**

Nella funzione di submit, dopo il blocco degli slot acquirente `ACQ_*` (righe ~1145-1157) e prima di `fd.append('blobRefs', ...)`, aggiungere il JSON e gli slot `COACQ<n>_*`:

```ts
    // Co-intestatari acquirente (solo SEMPLICE): JSON + slot COACQ<n>_*.
    const coAcquirentiPayload = coAcquirenti.map((c, i) => ({
      ordine: i + 1,
      isPG: c.isPG,
      nome: c.nome,
      cognome: c.cognome,
      cf: c.cf,
      ragioneSociale: c.ragioneSociale,
      piva: c.piva,
      telefono: c.telefono,
      email: c.email,
      tipoSoggetto: c.tipoSoggetto,
      docId: c.docId,
      indirizzoResidenza: c.residenzaDiversa ? c.indirizzoResidenza.trim() : null,
    }));
    fd.append('coAcquirenti', JSON.stringify(coAcquirentiPayload));

    coAcquirenti.forEach((c, i) => {
      const n = i + 1;
      if (c.docId === 'CI' || c.docId === 'PATENTE') {
        if (c.identita.fronte?.ref) blobRefs[`COACQ${n}_ID_FRONTE`] = c.identita.fronte.ref;
        if (c.identita.retro?.ref) blobRefs[`COACQ${n}_ID_RETRO`] = c.identita.retro.ref;
      } else if (c.identita.single?.ref) {
        blobRefs[`COACQ${n}_ID`] = c.identita.single.ref;
      }
      if (c.identita.permesso?.ref) blobRefs[`COACQ${n}_PERMESSO`] = c.identita.permesso.ref;
      if (c.identita.visura?.ref) blobRefs[`COACQ${n}_VISURA`] = c.identita.visura.ref;
      if (c.identita.codiceFiscale?.ref) blobRefs[`COACQ${n}_CF`] = c.identita.codiceFiscale.ref;
      if (c.identita.codiceFiscaleRetro?.ref)
        blobRefs[`COACQ${n}_CF_RETRO`] = c.identita.codiceFiscaleRetro.ref;
    });
```

- [ ] **Step 5: Verificare typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint src/app/pratiche/nuova/wizard.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): gate + submit co-intestatari acquirente (client)"
```

---

### Task 7: Server — zod schema + raccolta identità + verifica per-parte

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (schemi ~392-473; parse ~534; collectIdentita ~756-868; partiDaVerificare ~975-1015)

**Interfaces:**
- Consumes: `coAcquirenti` payload (JSON), slot `COACQ<n>_*`.
- Produces: `coAcquirenteSchema`; campo `coAcquirenti` in `submitSchema`; `collectIdentita(..., coAcquirenteOrdine?: number)`; candidati identità taggati con `coAcquirenteOrdine`; co-intestatari in `partiDaVerificare` (prefix `COACQ<n>`).

- [ ] **Step 1: Aggiungere `coAcquirenteSchema`**

In `actions.ts`, dopo `venditoreSchema` / `export type VenditoreInputData` (~407), aggiungere:

```ts
/**
 * Co-intestatario acquirente (solo SEMPLICE): come il venditore ma senza
 * veicoloOrdine (è a livello pratica) + indirizzo di residenza opzionale.
 * I file identità arrivano negli slot COACQ<ordine>_*.
 */
const coAcquirenteSchema = z.object({
  ordine: z.coerce.number().int().min(1).max(50),
  isPG: z.boolean().default(false),
  tipoSoggetto: tipoSoggettoEnum.optional().nullable(),
  nome: z.string().trim().max(80).optional().nullable(),
  cognome: z.string().trim().max(80).optional().nullable(),
  cf: z.string().trim().max(16).optional().nullable(),
  ragioneSociale: z.string().trim().max(160).optional().nullable(),
  piva: z.string().trim().max(11).optional().nullable(),
  telefono: z.string().trim().min(1, 'Numero di telefono del co-intestatario obbligatorio').max(30),
  email: z.string().trim().min(1, 'Email del co-intestatario obbligatoria').max(120).email('Email del co-intestatario non valida'),
  docId: z.enum(['CI', 'PASSAPORTO', 'PATENTE']).default('CI'),
  indirizzoResidenza: z.string().trim().max(250).optional().nullable(),
});

export type CoAcquirenteInputData = z.infer<typeof coAcquirenteSchema>;
```

- [ ] **Step 2: Aggiungere il campo `coAcquirenti` a `submitSchema`**

In `submitSchema`, dopo il campo `venditori` (~446) e prima di `// Acquirente`, aggiungere:

```ts
  // Co-intestatari acquirente (solo SEMPLICE): lista JSON, default vuota.
  coAcquirenti: z
    .string()
    .optional()
    .default('[]')
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'coAcquirenti non è JSON valido' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(coAcquirenteSchema)
        .max(50)
        .refine(
          (arr) => new Set(arr.map((c) => c.ordine)).size === arr.length,
          { message: 'ordine co-intestatario duplicato' },
        ),
    ),
```

- [ ] **Step 3: Estrarre la lista dopo il parse + gating SEMPLICE**

Dove si estraggono i dati validati (accanto a `const venditori = d.venditori;` ~534), aggiungere:

```ts
  // Co-intestatari solo per SEMPLICE: fuori scope → ignorati (difensivo; la UI
  // già li nasconde/azzera). Ordine ricalcolato 1..n per coerenza con gli slot.
  const coAcquirenti = d.tipo === 'SEMPLICE' ? d.coAcquirenti : [];
```

- [ ] **Step 4: Generalizzare `collectIdentita` con `coAcquirenteOrdine`**

In `collectIdentita` (firma ~756-763) aggiungere il parametro finale:

```ts
  const collectIdentita = (
    owner: 'VENDITORE' | 'ACQUIRENTE',
    prefix: string,
    documentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
    labelParte: string,
    richiedeCf: boolean,
    venditoreOrdine?: number,
    coAcquirenteOrdine?: number,
  ): void => {
```

In OGNI `identitaCandidates.push({ ... })` dentro la funzione (ci sono più occorrenze: fronte, retro, passaporto, CF fronte, CF retro, permesso, visura), aggiungere `coAcquirenteOrdine,` accanto a `venditoreOrdine,`. Esempio sul primo push:

```ts
      identitaCandidates.push({
        tipo: tFronte,
        owner,
        venditoreOrdine,
        coAcquirenteOrdine,
        ref: validateIdentitaRef(fronte!, "documento d'identità"),
      });
```

- [ ] **Step 5: Estendere il tipo di `identitaCandidates`**

Individuare la dichiarazione di `identitaCandidates` (array con `{ tipo, owner, venditoreOrdine?, ref }`) e aggiungere `coAcquirenteOrdine?: number;` alla sua forma. (Se è tipizzato inline come `const identitaCandidates: { tipo: ...; owner: ...; venditoreOrdine?: number; ref: ... }[] = []`, aggiungere il campo lì.)

- [ ] **Step 6: Raccogliere gli slot dei co-intestatari**

Dopo il blocco che raccoglie l'identità dell'acquirente (dopo la chiamata `collectIdentita('ACQUIRENTE', 'ACQ', ...)`, ~869-875), aggiungere:

```ts
  // Un blocco di file identità per ciascun co-intestatario (slot COACQ<ordine>_*).
  for (const c of coAcquirenti) {
    const label = `il co-intestatario ${c.ordine}`;
    const richiedeCf = documentiRichiestiParte({
      isPersonaGiuridica: c.isPG,
      tipoSoggetto: c.tipoSoggetto ?? null,
      documentoIdentita: c.docId,
    }).codiceFiscale;
    collectIdentita('ACQUIRENTE', `COACQ${c.ordine}`, c.docId, label, richiedeCf, undefined, c.ordine);
  }
```

- [ ] **Step 7: Aggiungere i co-intestatari a `partiDaVerificare`**

In `partiDaVerificare` (array ~981-1015), dopo l'oggetto dell'acquirente principale, spalmare i co-intestatari:

```ts
    ...coAcquirenti.map((c) => ({
      parte: {
        isPersonaGiuridica: c.isPG,
        tipoSoggetto: c.tipoSoggetto ?? null,
        nome: c.nome ?? undefined,
        cognome: c.cognome ?? undefined,
        cf: c.cf ?? undefined,
        ragioneSociale: c.ragioneSociale ?? undefined,
        piva: c.piva ?? undefined,
        documentoIdentita: c.docId,
      } satisfies ParteDati,
      prefix: `COACQ${c.ordine}`,
      docId: c.docId,
      label: `Co-intestatario ${c.ordine}`,
      richiedeOperatoreAuto: false,
    })),
```

- [ ] **Step 8: Verificare typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): validazione + verifica per-parte co-intestatari acquirente (server)"
```

---

### Task 8: Server — persistenza in transazione (righe `CoAcquirente` + link documenti)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (transazione: dopo il loop venditori ~1281; loop identitaUploads ~1313-1333)

**Interfaces:**
- Consumes: `coAcquirenti` (validati), candidati identità con `coAcquirenteOrdine`.
- Produces: righe `CoAcquirente` + `Documento` con `coAcquirenteId` valorizzato.

- [ ] **Step 1: Creare le righe `CoAcquirente`**

Nella `$transaction`, subito dopo il loop che crea i venditori e popola `venditoreIdByOrdine` (dopo riga ~1281), aggiungere:

```ts
    // Co-intestatari acquirente (solo SEMPLICE): righe CoAcquirente (ordine 1..n).
    // I documenti identità vengono poi linkati via Documento.coAcquirenteId.
    const coAcquirenteIdByOrdine = new Map<number, string>();
    for (const c of coAcquirenti) {
      const co = await tx.coAcquirente.create({
        data: {
          praticaId: created.id,
          ordine: c.ordine,
          nome: c.isPG ? null : c.nome || null,
          cognome: c.isPG ? null : c.cognome || null,
          cf: c.isPG ? null : c.cf?.toUpperCase() || null,
          isPersonaGiuridica: c.isPG,
          ragioneSociale: c.isPG ? c.ragioneSociale || null : null,
          piva: c.isPG ? c.piva || null : null,
          telefono: c.telefono || null,
          email: c.email?.toLowerCase() || null,
          tipoSoggetto: c.tipoSoggetto ?? null,
          documentoIdentita: c.docId,
          indirizzoResidenza: c.indirizzoResidenza || null,
        },
      });
      coAcquirenteIdByOrdine.set(c.ordine, co.id);
    }
```

- [ ] **Step 2: Linkare i documenti identità dei co-intestatari**

Nel loop `for (const { tipo, owner, venditoreOrdine, put } of identitaUploads)` (~1313), destrutturare anche `coAcquirenteOrdine` e valorizzare la FK:

```ts
    for (const { tipo, owner, venditoreOrdine, coAcquirenteOrdine, put } of identitaUploads) {
      await tx.documento.create({
        data: {
          tipo: tipo as Prisma.DocumentoCreateInput['tipo'],
          owner,
          praticaId: created.id,
          venditoreId:
            owner === 'VENDITORE' && venditoreOrdine
              ? (venditoreIdByOrdine.get(venditoreOrdine) ?? null)
              : null,
          coAcquirenteId: coAcquirenteOrdine
            ? (coAcquirenteIdByOrdine.get(coAcquirenteOrdine) ?? null)
            : null,
          storageKey: put.storageKey,
          storageProvider: put.storageProvider,
          mimeType: put.mimeType,
          sizeBytes: put.sizeBytes,
          originalFilename: put.originalFilename,
          uploadedById: userId,
          ocrStato: 'NONE',
          gatingStato: 'PASSED',
        },
      });
    }
```

> Nota: `identitaUploads` è costruito dai candidati (`identitaCandidates`) — assicurarsi che `coAcquirenteOrdine` sia propagato dalla mappatura `identitaCandidates → identitaUploads` (righe ~1060-1065). Se la mappatura elenca i campi esplicitamente, aggiungere `coAcquirenteOrdine: cand.coAcquirenteOrdine,`.

- [ ] **Step 3: Verificare typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): persistenza co-intestatari acquirente in transazione (server)"
```

---

### Task 9: Downstream — dettaglio pratica mostra i co-intestatari

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (query include ~58-94; render acquirente ~405-427)

**Interfaces:**
- Consumes: relazione `pratica.coAcquirenti`.

- [ ] **Step 1: Includere i co-intestatari nella query**

Nella `include` della query pratica (accanto a `venditori: { orderBy: { ordine: 'asc' } },` riga ~94) aggiungere:

```ts
      venditori: { orderBy: { ordine: 'asc' } },
      coAcquirenti: { orderBy: { ordine: 'asc' } },
```

- [ ] **Step 2: Renderizzare il blocco co-intestatari**

Dopo il blocco che mostra la residenza acquirente (dopo la chiusura del blocco `acquirenteIndirizzoResidenza` ~423-427), aggiungere l'elenco dei co-intestatari:

```tsx
                  {pratica.coAcquirenti.length > 0 && (
                    <div className="mt-3 border-t border-pv-slate-200 pt-3">
                      <p className="mb-1 text-[12px] font-semibold text-pv-slate-500">
                        Co-intestatari ({pratica.coAcquirenti.length})
                      </p>
                      <ul className="space-y-1">
                        {pratica.coAcquirenti.map((c) => (
                          <li key={c.id} className="text-[13px] text-pv-slate-700">
                            {c.isPersonaGiuridica
                              ? (c.ragioneSociale ?? '—')
                              : `${c.nome ?? ''} ${c.cognome ?? ''}`.trim() || '—'}
                            {' · '}
                            {c.isPersonaGiuridica ? (c.piva ?? '—') : (c.cf ?? '—')}
                            {c.indirizzoResidenza ? ` · residenza: ${c.indirizzoResidenza}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
```

> Adattare le classi/il wrapper allo stile del blocco acquirente circostante se differisce; l'importante è mostrare per ogni co-intestatario nome/ragione sociale, CF/P.IVA ed eventuale residenza.

- [ ] **Step 3: Verificare typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint src/app/pratiche/[id]/page.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/[id]/page.tsx
git commit -m "feat(pratiche): dettaglio pratica mostra i co-intestatari acquirente"
```

---

### Task 10: E2E — pratica SEMPLICE con un co-intestatario (end-of-phase)

**Files:**
- Create: `apps/piattaforma/e2e/co-intestatari-acquirente.spec.ts` (adattare il path alla convenzione e2e esistente; ispezionare `apps/piattaforma/` per la cartella dei test Playwright e un test pratica esistente da usare come modello)

**Interfaces:**
- Consumes: l'intero flusso wizard + submit + persistenza.

- [ ] **Step 1: Individuare un e2e pratica esistente come modello**

Run: `ls apps/piattaforma/e2e 2>/dev/null || ls apps/piattaforma/tests 2>/dev/null; grep -rl "pratiche/nuova" apps/piattaforma --include=*.spec.ts`
Expected: elenco degli spec Playwright; scegliere quello che crea una pratica SEMPLICE come base (stessi helper di login/seed).

- [ ] **Step 2: Scrivere lo spec**

Sulla falsariga del test esistente, creare un flusso che: login broker (utente seed), nuova pratica SEMPLICE mono-veicolo, compila veicolo + venditore, allo step Acquirente compila il principale, clicca "+ Aggiungi co-intestatario", compila anche il co-intestatario (tipo soggetto PRIVATO, anagrafica, upload CI fronte/retro dalle fixture usate dagli altri test, residenza uguale al documento), procede all'invio e verifica il redirect a `/pratiche/<id>` e la presenza del co-intestatario nel dettaglio (`getByText('Co-intestatari')`).

> Riusare gli stessi selettori/fixtures degli e2e pratica esistenti (documenti d'identità di test, mock OCR se il flusso e2e gira con `OCR_PROVIDER=mock`). Se l'e2e locale è bloccato da chiavi/servizi (come noto per altri flussi), documentare qui il blocco e fornire in alternativa una checklist di verifica manuale equivalente.

- [ ] **Step 3: Eseguire l'e2e**

Run: `pnpm --filter piattaforma test:e2e co-intestatari-acquirente`
Expected: PASS (o, se l'ambiente e2e è bloccato, verifica manuale documentata: creazione pratica SEMPLICE con 1 co-intestatario → riga in `co_acquirenti` + documenti con `coAcquirenteId` valorizzato via `pnpm --filter @pv/db db:studio`).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/e2e/co-intestatari-acquirente.spec.ts
git commit -m "test(e2e): pratica SEMPLICE con co-intestatario acquirente"
```

---

## Self-Review

**Spec coverage:**
- Punto 1 (tipo soggetto in cima) → Task 3. ✓
- Co-intestatari solo SEMPLICE → Task 4 (azzeramento), Task 5 (CTA condizionata), Task 7 (gating server). ✓
- Verifica per-parte (no cross-check libretto) → Task 6 (verdetti client), Task 7 (partiDaVerificare). ✓
- Persistenza tabella dedicata + FK documenti → Task 1 (schema/migration), Task 8 (transazione). ✓
- Residenza per co-intestatario → Task 2 (helper), Task 4 (campi), Task 5 (UI), Task 6 (gate), Task 8 (persistenza). ✓
- Submit JSON + slot COACQ<n> → Task 6 (client), Task 7 (server). ✓
- Bozza (draft) → Task 4 (save/hydrate + DRAFT_VERSION bump). ✓
- Downstream dettaglio pratica → Task 9. ✓
- Testing (vitest pure + e2e) → Task 2 (vitest), Task 10 (e2e). ✓

**Placeholder scan:** i due punti che dipendono dal codice esistente (mappatura `identitaCandidates → identitaUploads` in Task 8 Step 2, e cartella e2e in Task 10) includono lo step di ispezione + la modifica concreta; nessun "TBD".

**Type consistency:** `CoAcquirenteInput` (client) ↔ `coAcquirenteSchema`/`CoAcquirenteInputData` (server) ↔ model `CoAcquirente` (DB) allineati sui campi. `coAcquirenteOrdine` usato coerentemente in `collectIdentita`, `identitaCandidates`, `identitaUploads`, e link `coAcquirenteId`. `residenzaOk(diversa, indirizzo)` firma coerente tra Task 2, 6. `hideTipoSoggetto` coerente tra Task 3 e 5.

## Note di rilascio (fuori scope implementativo)

- La migration è **additiva e nullable** → sicura su prod. In rilascio: `pnpm --filter @pv/db db:deploy` sul DB Neon `ep-solitary-night` prima del deploy dell'app; poi push su main (Vercel). Curare/ruotare le credenziali Neon come da processo.
