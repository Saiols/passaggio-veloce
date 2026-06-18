# Indirizzo di residenza acquirente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allo step Acquirente del wizard pratica, chiedere se la residenza coincide col documento; se "No", raccogliere un indirizzo (Google Autocomplete) obbligatorio, persisterlo su `Pratica` e mostrarlo nel dettaglio (broker + agenzia).

**Architecture:** Domanda con due bottoni Sì/No (default Sì) nello step 3; quando "No" compare `AddressAutocomplete` (fallback `Input` se manca la maps key). L'indirizzo selezionato è composto in una stringa via helper puro `formatIndirizzo` e persistito in un'unica colonna `Pratica.acquirenteIndirizzoResidenza`. Gating "obbligatorio se No" solo lato client (`canStep3`): il caso limite degrada in modo benigno a null.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React client component, Prisma 5.22 + Postgres, Vitest, TypeScript, Google Places (`AddressAutocomplete` esistente).

## Global Constraints

- Node tooling: `nvm use 22.15.0` se compare un errore di versione (pnpm ≥18). pnpm è globale.
- App package `piattaforma` (`apps/piattaforma`). DB package `@pv/db` (`packages/db`).
- Verifiche app: `pnpm --filter piattaforma run typecheck` · `lint` · `test` · `build`.
- Niente colori hardcoded: token design system (`pv-navy-*`, `pv-slate-*`, `text-white`).
- Solo lato **acquirente** (non venditore).
- Domanda con **due bottoni espliciti Sì/No**, default **Sì** (= residenza uguale al documento).
- Campo indirizzo **obbligatorio se No** (solo presenza), gate **client-only** (nessun check server).
- Modello dati: **una sola colonna stringa** `Pratica.acquirenteIndirizzoResidenza String?` (`null` = stesso del documento). Migration additiva.
- Stringa indirizzo formattata es. `"Via Roma 12, 20100 Milano (MI)"`.

---

### Task 1: Helper puro `formatIndirizzo` (composizione indirizzo)

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/nuova/acquirente-indirizzo.ts`
- Test: `apps/piattaforma/src/app/pratiche/nuova/acquirente-indirizzo.test.ts`

**Interfaces:**
- Produces:
  - `type IndirizzoParti = { indirizzo: string; civico: string; citta: string; cap: string; provincia: string }`
  - `formatIndirizzo(p: IndirizzoParti): string`

- [ ] **Step 1: Write the failing test**

Create `apps/piattaforma/src/app/pratiche/nuova/acquirente-indirizzo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatIndirizzo } from './acquirente-indirizzo';

describe('formatIndirizzo', () => {
  it('compone un indirizzo completo', () => {
    expect(
      formatIndirizzo({ indirizzo: 'Via Roma', civico: '12', cap: '20100', citta: 'Milano', provincia: 'MI' }),
    ).toBe('Via Roma 12, 20100 Milano (MI)');
  });

  it('omette le parti mancanti', () => {
    expect(
      formatIndirizzo({ indirizzo: 'Via Roma', civico: '', cap: '', citta: 'Milano', provincia: '' }),
    ).toBe('Via Roma, Milano');
  });

  it('stringa vuota se tutte le parti sono vuote', () => {
    expect(formatIndirizzo({ indirizzo: '', civico: '', cap: '', citta: '', provincia: '' })).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/acquirente-indirizzo.test.ts`
Expected: FAIL — `Cannot find module './acquirente-indirizzo'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/piattaforma/src/app/pratiche/nuova/acquirente-indirizzo.ts`:

```ts
/**
 * Composizione di un indirizzo (parti Google Places) in una singola stringa
 * leggibile per il dettaglio pratica. Modulo puro (nessun import client/server).
 * `IndirizzoParti` è strutturalmente compatibile con `AddressParts` del
 * componente AddressAutocomplete.
 */
export type IndirizzoParti = {
  indirizzo: string;
  civico: string;
  citta: string;
  cap: string;
  provincia: string;
};

export function formatIndirizzo(p: IndirizzoParti): string {
  const via = [p.indirizzo, p.civico].filter(Boolean).join(' ').trim();
  const localita = [p.cap, p.citta].filter(Boolean).join(' ').trim();
  const prov = p.provincia ? `(${p.provincia})` : '';
  const localitaProv = [localita, prov].filter(Boolean).join(' ').trim();
  return [via, localitaProv].filter(Boolean).join(', ').trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/acquirente-indirizzo.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/acquirente-indirizzo.ts apps/piattaforma/src/app/pratiche/nuova/acquirente-indirizzo.test.ts
git commit -m "feat(pratiche): helper puro formatIndirizzo (residenza acquirente)"
```

---

### Task 2: DB migration — `Pratica.acquirenteIndirizzoResidenza`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Pratica`, dopo `acquirenteEmail` ~riga 556)
- Create: `packages/db/prisma/migrations/<timestamp>_acquirente_indirizzo_residenza/migration.sql` (generata da Prisma)

**Interfaces:**
- Produces: campo `Pratica.acquirenteIndirizzoResidenza: string | null`. Consumato da Task 4/5.

- [ ] **Step 1: Aggiungi la colonna al model `Pratica`**

In `schema.prisma`, nel `model Pratica`, subito dopo `acquirenteEmail String?`:

```prisma
  acquirenteEmail              String?
  acquirenteIndirizzoResidenza String?   // null = stesso del documento; valorizzato = residenza diversa
```

- [ ] **Step 2: Genera e applica la migration (dev)**

Assicurati che il Postgres locale (docker `pv-postgres`) sia attivo, poi:

Run: `nvm use 22.15.0; pnpm --filter @pv/db exec prisma migrate dev --name acquirente_indirizzo_residenza`

Expected: crea `packages/db/prisma/migrations/<timestamp>_acquirente_indirizzo_residenza/migration.sql` con:

```sql
-- AlterTable
ALTER TABLE "pratiche" ADD COLUMN "acquirenteIndirizzoResidenza" TEXT;
```

e rigenera il Prisma Client. Output finale: "Your database is now in sync with your schema."

- [ ] **Step 3: Verifica typecheck del package db**

Run: `pnpm --filter @pv/db run typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): Pratica.acquirenteIndirizzoResidenza (residenza diversa dal documento)"
```

**Nota prod (NON in questo task):** in produzione la migration si applica con `prisma migrate deploy`.

---

### Task 3: Wizard — stato + UI step 3 + gate + submit

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
  - import `formatIndirizzo` (vicino agli altri import locali)
  - stato acquirente (~dopo riga 365)
  - `canStep3` (~righe 918-922)
  - UI step 3: card domanda + campo indirizzo (dopo `IdentitaSection` dell'acquirente, ~riga 1236)
  - submit FormData (~dopo riga 658)

**Interfaces:**
- Consumes (da Task 1): `formatIndirizzo`.
- Consumes (esistenti nel file): `AddressAutocomplete` (già importato), `Input`, `Field`, `Alert`, `Button`, `hasMaps` (`const hasMaps = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).

- [ ] **Step 1: Import di `formatIndirizzo`**

In cima a `wizard.tsx`, accanto agli altri import locali (es. dopo l'import di `./delega-docs`):

```ts
import { formatIndirizzo } from './acquirente-indirizzo';
```

- [ ] **Step 2: Stato wizard per la residenza acquirente**

Subito DOPO `const [acquirenteIdentita, setAcquirenteIdentita] = useState<IdentitaFiles>({});` (~riga 365):

```ts
  // Residenza acquirente: domanda "uguale al documento?" (default Sì = false) +
  // indirizzo alternativo quando il broker risponde No (stringa formattata).
  const [acquirenteResidenzaDiversa, setAcquirenteResidenzaDiversa] = useState(false);
  const [acquirenteIndirizzoResidenza, setAcquirenteIndirizzoResidenza] = useState('');
```

- [ ] **Step 3: Aggiorna `canStep3` con l'obbligatorietà condizionale**

Sostituisci il blocco `const canStep3 = ...` (~righe 918-922) con:

```ts
  const residenzaOk =
    !acquirenteResidenzaDiversa || acquirenteIndirizzoResidenza.trim().length > 0;
  const canStep3 =
    parteValida(acquirente) &&
    identitaPresente(acquirenteDocId, acquirenteIdentita) &&
    !identitaUploading(acquirenteIdentita) &&
    verdettoAcquirente.ok &&
    residenzaOk;
```

- [ ] **Step 4: UI — card domanda + campo indirizzo nello step 3**

Subito DOPO la chiusura `/>` del componente `IdentitaSection` dell'acquirente (la riga `/>` a ~riga 1236) e PRIMA del commento `{/* Verifica documentale OCR ... */}`, inserisci:

```tsx
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <p className="mb-2 text-[14px] font-semibold text-pv-navy-800">
                L&apos;indirizzo di residenza è lo stesso indicato nel documento?
              </p>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
                <button
                  type="button"
                  onClick={() => {
                    setAcquirenteResidenzaDiversa(false);
                    setAcquirenteIndirizzoResidenza('');
                  }}
                  className={`px-5 py-2 text-[13px] font-semibold transition ${
                    !acquirenteResidenzaDiversa
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  Sì
                </button>
                <button
                  type="button"
                  onClick={() => setAcquirenteResidenzaDiversa(true)}
                  className={`border-l border-pv-slate-300 px-5 py-2 text-[13px] font-semibold transition ${
                    acquirenteResidenzaDiversa
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  No
                </button>
              </div>

              {acquirenteResidenzaDiversa && (
                <div className="mt-4">
                  <p className="mb-2 text-[12.5px] text-pv-slate-500">
                    Indica la residenza attuale dell&apos;acquirente: l&apos;agenzia
                    intesterà il passaggio a questo indirizzo.
                  </p>
                  {hasMaps ? (
                    <>
                      <AddressAutocomplete
                        label="Nuovo indirizzo di residenza"
                        placeholder="Via, civico, città…"
                        helpText="Inizia a digitare e seleziona dall'elenco."
                        onSelect={(p) => setAcquirenteIndirizzoResidenza(formatIndirizzo(p))}
                      />
                      {acquirenteIndirizzoResidenza && (
                        <p className="mt-2 text-[13px] text-pv-slate-700">
                          Indirizzo selezionato: <strong>{acquirenteIndirizzoResidenza}</strong>
                        </p>
                      )}
                    </>
                  ) : (
                    <Field label="Nuovo indirizzo di residenza" required>
                      <Input
                        value={acquirenteIndirizzoResidenza}
                        onChange={(e) => setAcquirenteIndirizzoResidenza(e.target.value)}
                        placeholder="Via Roma 12, 20100 Milano (MI)"
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>
```

- [ ] **Step 5: Hint quando l'indirizzo manca**

Il gate `canStep3` già disabilita "Avanti". Per chiarezza, subito PRIMA del blocco
`<div className="flex flex-col-reverse gap-3 ...">` dei bottoni Indietro/Avanti dello
step 3 (~riga 1251), aggiungi:

```tsx
            {acquirenteResidenzaDiversa && !acquirenteIndirizzoResidenza.trim() && (
              <Alert variant="error">
                Inserisci il nuovo indirizzo di residenza dell&apos;acquirente per procedere.
              </Alert>
            )}
```

- [ ] **Step 6: Submit — invia l'indirizzo solo se "No" e valorizzato**

Nel builder FormData, subito DOPO `fd.append('acquirenteEmail', acquirente.email);` (~riga 658):

```ts
    if (acquirenteResidenzaDiversa && acquirenteIndirizzoResidenza.trim()) {
      fd.append('acquirenteIndirizzoResidenza', acquirenteIndirizzoResidenza.trim());
    }
```

- [ ] **Step 7: Verifica typecheck + lint + build**

Run: `pnpm --filter piattaforma run typecheck` → nessun errore.
Run: `pnpm --filter piattaforma run lint` → 0 errori (warning pre-esistenti OK).
Run: `pnpm --filter piattaforma run build` → build OK.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): domanda residenza acquirente + indirizzo autocomplete (step 3)"
```

---

### Task 4: Server action — zod + persistenza

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`
  - schema zod acquirente (~righe 368-374)
  - `pratica.create` blocco acquirente (~righe 881-887)

**Interfaces:**
- Consumes: campo FormData `acquirenteIndirizzoResidenza` (inviato da Task 3); colonna `Pratica.acquirenteIndirizzoResidenza` (Task 2).

- [ ] **Step 1: Aggiungi il campo allo schema zod**

Nello schema dell'azione, subito DOPO `acquirenteEmail: z.string().trim().max(120).optional(),` (~riga 374):

```ts
  acquirenteEmail: z.string().trim().max(120).optional(),
  acquirenteIndirizzoResidenza: z.string().trim().max(250).optional(),
```

- [ ] **Step 2: Persisti il campo in `pratica.create`**

Nel blocco `data: { ... }` del `tx.pratica.create`, subito DOPO
`acquirenteEmail: d.acquirenteEmail?.toLowerCase() || null,` (~riga 887):

```ts
      acquirenteEmail: d.acquirenteEmail?.toLowerCase() || null,
      acquirenteIndirizzoResidenza: d.acquirenteIndirizzoResidenza || null,
```

- [ ] **Step 3: Verifica typecheck + lint**

Run: `pnpm --filter piattaforma run typecheck` → nessun errore (la colonna esiste dal Task 2; il campo zod produce `string | undefined`).
Run: `pnpm --filter piattaforma run lint` → 0 errori.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): persisti acquirenteIndirizzoResidenza nella creazione pratica"
```

---

### Task 5: Display dettaglio (broker + agenzia)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (sezione Acquirente, ~righe 344-349)
- Modify: `apps/piattaforma/src/app/inbox/[id]/page.tsx` (sezione Acquirente, ~righe 202-205)

Entrambe le query usano `include` (non `select` su Pratica), quindi la nuova
colonna scalare è già disponibile su `pratica.*` senza modifiche alla query.

**Interfaces:**
- Consumes: `pratica.acquirenteIndirizzoResidenza: string | null`.

- [ ] **Step 1: Riga residenza nel dettaglio broker**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx`, subito DOPO il blocco
`{(pratica.acquirenteTelefono || pratica.acquirenteEmail) && ( <ContattiParte ... /> )}`
(la `)}` a ~riga 349), e PRIMA della `</div>` di chiusura della sezione acquirente:

```tsx
                  {pratica.acquirenteIndirizzoResidenza && (
                    <p className="mt-1.5 text-[12px] text-pv-slate-700">
                      <span className="font-semibold">Residenza (diversa dal documento):</span>{' '}
                      {pratica.acquirenteIndirizzoResidenza}
                    </p>
                  )}
```

- [ ] **Step 2: Riga residenza nel dettaglio agenzia (inbox)**

In `apps/piattaforma/src/app/inbox/[id]/page.tsx`, subito DOPO il
`<ContattiParte telefono={pratica.acquirenteTelefono} email={pratica.acquirenteEmail} />`
dell'acquirente (la `/>` a ~riga 205), e PRIMA della `</div>` di chiusura:

```tsx
                  {pratica.acquirenteIndirizzoResidenza && (
                    <p className="mt-1.5 text-[12px] text-pv-slate-700">
                      <span className="font-semibold">Residenza (diversa dal documento):</span>{' '}
                      {pratica.acquirenteIndirizzoResidenza}
                    </p>
                  )}
```

- [ ] **Step 3: Verifica completa app**

Run: `pnpm --filter piattaforma run typecheck` → nessun errore.
Run: `pnpm --filter piattaforma run lint` → 0 errori (warning pre-esistenti OK).
Run: `pnpm --filter piattaforma run test` → tutti i test PASS (inclusi i 3 di `acquirente-indirizzo`).
Run: `pnpm --filter piattaforma run build` → build OK.

- [ ] **Step 4: Verifica manuale (dev) — opzionale, gestita dal controller**

`pnpm --filter piattaforma run dev`: nuova pratica → step Acquirente → la domanda
compare con Sì attivo; "No" mostra l'autocomplete obbligatorio; senza indirizzo
"Avanti" è disabilitato; con indirizzo si procede; nel dettaglio pratica compare
"Residenza (diversa dal documento): …".

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/[id]/page.tsx apps/piattaforma/src/app/inbox/[id]/page.tsx
git commit -m "feat(pratiche): mostra residenza acquirente diversa nel dettaglio (broker + agenzia)"
```

---

## Note finali

- **Engine documentale / altre feature:** nessun impatto.
- **Deploy prod:** migration additiva da applicare con `prisma migrate deploy` PRIMA del push del codice (il nuovo `pratica.create` scrive la colonna).
- **Gate solo client:** deliberato — "No + indirizzo vuoto" degrada a `null` benigno, nessun documento legale a rischio (vedi spec §Gating).
