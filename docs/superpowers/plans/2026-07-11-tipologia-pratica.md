# Tipologia pratica multipla — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In fattura (`FATTURA_PV`) aggiungere "multiplo (N veicoli)" per pratiche multiple; mostrare un chip con la tipologia (Semplice / Semplice Multiplo / Minivoltura / Minivoltura multipla) in tutte le viste pratica-centriche.

**Architecture:** Un helper puro `labelTipoPratica` (fonte unica delle 4 etichette) + un componente `TipoPraticaChip`; l'invoice usa il conteggio veicoli in `descrizioneDocumento`. Le viste già caricano la pratica via `include` (scalari `tipo`/`numeroVeicoli` presenti) tranne una query `select` da estendere.

**Tech Stack:** Next.js 16 App Router (server components), Prisma/Postgres (`@pv/db`), Vitest, Tailwind `pv-*`.

## Global Constraints

- **Runtime dev/test:** `node` NON è sul PATH di Git Bash. Eseguire pnpm da **PowerShell**: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma <cmd>`.
- **Vitest:** `include: ['src/**/*.test.ts']`, env node, alias `@`→`src`. NON modificare `vitest.config.ts`. Import type-only da `@pv/db`.
- **Etichette (verbatim, capitalizzazione inclusa):** SEMPLICE singolo → `Semplice`; SEMPLICE multiplo → `Semplice Multiplo`; MINIVOLTURA singolo → `Minivoltura`; MINIVOLTURA multiplo → `Minivoltura multipla`. **multiplo = `numeroVeicoli > 1`** (ortogonale al tipo).
- **Voce fattura (solo `FATTURA_PV`):** `numeroVeicoli > 1` → `Servizio di intermediazione per passaggio di proprietà multiplo (N veicoli)`; altrimenti invariata `Servizio di intermediazione per passaggio di proprietà`. Nessun altro tipo documento cambia.
- **Chip:** importato dal barrel `@/components/ui`; stile mirror di `StatusChip` ma **NON uppercase** (preserva la capitalizzazione delle etichette). Solo classi `pv-*`.
- **Non rompere i layout tabellari** (`PRATICHE_GRID`): niente nuove colonne di griglia; inserire il chip dentro una cella esistente (es. sotto il codice).
- **Scope:** SOLO le 8 viste pratica-centriche elencate. Rimuovere i `labelTipo` locali di `pratiche/[id]/page.tsx` e `inbox/[id]/page.tsx` (sostituiti dal chip).

---

## File Structure

- **Create** `apps/piattaforma/src/lib/pratiche/label-tipo.ts` (+ `.test.ts`) — helper puro.
- **Create** `apps/piattaforma/src/components/ui/tipo-pratica-chip.tsx`; **Modify** `components/ui/index.ts` (export).
- **Modify** `apps/piattaforma/src/lib/fatturazione/descrizione.ts` (+ **Create** `descrizione.test.ts`); **Modify** `lib/fatturazione/documento-pdf.ts` e `app/api/fatturazione/[id]/xml/route.ts` (include).
- **Modify** le 8 viste: `app/pratiche/page.tsx`, `app/pratiche/[id]/page.tsx`, `app/inbox/page.tsx`, `app/inbox/[id]/page.tsx`, `app/dashboard/agenzia-dashboard.tsx`, `app/dashboard/broker-dashboard.tsx`, `app/admin/pratiche/page.tsx`, `app/admin/escalation/page.tsx`.

---

## Task 1: Helper `labelTipoPratica`

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/label-tipo.ts`
- Test: `apps/piattaforma/src/lib/pratiche/label-tipo.test.ts`

**Interfaces:**
- Consumes: `type PraticaTipo` da `@pv/db`.
- Produces: `function labelTipoPratica(p: { tipo: PraticaTipo; numeroVeicoli: number }): string`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/pratiche/label-tipo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { labelTipoPratica } from './label-tipo';

describe('labelTipoPratica', () => {
  it('SEMPLICE singolo', () => {
    expect(labelTipoPratica({ tipo: 'SEMPLICE', numeroVeicoli: 1 })).toBe('Semplice');
  });
  it('SEMPLICE multiplo', () => {
    expect(labelTipoPratica({ tipo: 'SEMPLICE', numeroVeicoli: 3 })).toBe('Semplice Multiplo');
  });
  it('MINIVOLTURA singolo', () => {
    expect(labelTipoPratica({ tipo: 'MINIVOLTURA', numeroVeicoli: 1 })).toBe('Minivoltura');
  });
  it('MINIVOLTURA multiplo', () => {
    expect(labelTipoPratica({ tipo: 'MINIVOLTURA', numeroVeicoli: 2 })).toBe('Minivoltura multipla');
  });
  it('numeroVeicoli 0 → singolo', () => {
    expect(labelTipoPratica({ tipo: 'SEMPLICE', numeroVeicoli: 0 })).toBe('Semplice');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisce**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/pratiche/label-tipo.test.ts`
Expected: FAIL — `Failed to resolve import "./label-tipo"`.

- [ ] **Step 3: Implementa l'helper**

Crea `apps/piattaforma/src/lib/pratiche/label-tipo.ts`:

```ts
import type { PraticaTipo } from '@pv/db';

/**
 * Etichetta tipologia pratica per liste/card/chip. "Multiplo" = più veicoli,
 * ortogonale al tipo (vale sia per SEMPLICE sia per MINIVOLTURA).
 */
export function labelTipoPratica(p: { tipo: PraticaTipo; numeroVeicoli: number }): string {
  const multiplo = p.numeroVeicoli > 1;
  if (p.tipo === 'SEMPLICE') return multiplo ? 'Semplice Multiplo' : 'Semplice';
  return multiplo ? 'Minivoltura multipla' : 'Minivoltura';
}
```

- [ ] **Step 4: Esegui il test e verifica che passa**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/pratiche/label-tipo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/label-tipo.ts apps/piattaforma/src/lib/pratiche/label-tipo.test.ts
git commit -m "feat(pratiche): helper labelTipoPratica (4 etichette tipologia)"
```

---

## Task 2: Componente `TipoPraticaChip`

**Files:**
- Create: `apps/piattaforma/src/components/ui/tipo-pratica-chip.tsx`
- Modify: `apps/piattaforma/src/components/ui/index.ts`

**Interfaces:**
- Consumes: `labelTipoPratica` (Task 1); `type PraticaTipo` da `@pv/db`; `cn` da `./cn`.
- Produces: `function TipoPraticaChip(props: { tipo: PraticaTipo; numeroVeicoli: number; className?: string }): JSX.Element`, esportato da `@/components/ui`.

- [ ] **Step 1: Crea il componente**

Crea `apps/piattaforma/src/components/ui/tipo-pratica-chip.tsx`:

```tsx
import type { PraticaTipo } from '@pv/db';
import { labelTipoPratica } from '@/lib/pratiche/label-tipo';
import { cn } from './cn';

/**
 * Chip con la tipologia della pratica (Semplice / Semplice Multiplo /
 * Minivoltura / Minivoltura multipla). Le pratiche multiple hanno un accent
 * navy per distinguerle a colpo d'occhio. Non-uppercase: l'etichetta ha una
 * capitalizzazione voluta.
 */
export function TipoPraticaChip({
  tipo,
  numeroVeicoli,
  className,
}: {
  tipo: PraticaTipo;
  numeroVeicoli: number;
  className?: string;
}) {
  const multiplo = numeroVeicoli > 1;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        multiplo ? 'bg-pv-navy-100 text-pv-navy-700' : 'bg-pv-slate-100 text-pv-slate-600',
        className,
      )}
    >
      {labelTipoPratica({ tipo, numeroVeicoli })}
    </span>
  );
}
```

- [ ] **Step 2: Esporta dal barrel**

In `apps/piattaforma/src/components/ui/index.ts`, dopo la riga `export { StatusChip } from './status-chip';` (riga 22), aggiungi:

```ts
export { TipoPraticaChip } from './tipo-pratica-chip';
```

- [ ] **Step 3: Typecheck + lint**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma typecheck`
Expected: PASS. (Se `tsc` esplode a cache fredda — problema noto — riscaldare con un build o riportare come concern.)

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma lint`
Expected: 0 errori.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/components/ui/tipo-pratica-chip.tsx apps/piattaforma/src/components/ui/index.ts
git commit -m "feat(ui): TipoPraticaChip (chip tipologia pratica)"
```

---

## Task 3: Voce fattura "multiplo (N veicoli)"

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/descrizione.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/descrizione.test.ts` (create)
- Modify: `apps/piattaforma/src/lib/fatturazione/documento-pdf.ts`
- Modify: `apps/piattaforma/src/app/api/fatturazione/[id]/xml/route.ts`

**Interfaces:**
- `DescrizioneDoc.pratica` acquista `numeroVeicoli?: number`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/fatturazione/descrizione.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { descrizioneDocumento } from './descrizione';

const vuoto = { payout: null, notaVariazionePer: null } as const;

describe('descrizioneDocumento — FATTURA_PV multiplo', () => {
  it('pratica singola: descrizione invariata', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'FATTURA_PV',
      pratica: { codicePratica: 'PV-1', numeroVeicoli: 1 },
    });
    expect(r.descrizione).toBe('Servizio di intermediazione per passaggio di proprietà');
    expect(r.riferimento).toBe('Pratica PV-1');
  });

  it('pratica multipla: aggiunge "multiplo (N veicoli)"', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'FATTURA_PV',
      pratica: { codicePratica: 'PV-2', numeroVeicoli: 3 },
    });
    expect(r.descrizione).toBe(
      'Servizio di intermediazione per passaggio di proprietà multiplo (3 veicoli)',
    );
  });

  it('numeroVeicoli assente → singolare', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'FATTURA_PV',
      pratica: { codicePratica: 'PV-3' },
    });
    expect(r.descrizione).toBe('Servizio di intermediazione per passaggio di proprietà');
  });

  it('altri tipi (PENALE_BROKER) invariati anche con più veicoli', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'PENALE_BROKER',
      pratica: { codicePratica: 'PV-4', numeroVeicoli: 5 },
    });
    expect(r.descrizione).toBe('Penale');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisce**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/fatturazione/descrizione.test.ts`
Expected: FAIL — il ramo multiplo non esiste ancora (la descrizione multipla non contiene "multiplo (3 veicoli)").

- [ ] **Step 3: Estendi il tipo e il ramo FATTURA_PV**

In `apps/piattaforma/src/lib/fatturazione/descrizione.ts`, cambia il campo `pratica` di `DescrizioneDoc` (righe 6-14) da:

```ts
  pratica: { codicePratica: string | null } | null;
```

a:

```ts
  pratica: { codicePratica: string | null; numeroVeicoli?: number } | null;
```

e sostituisci il ramo `case 'FATTURA_PV':` (righe 25-29) con:

```ts
    case 'FATTURA_PV': {
      const nVeicoli = doc.pratica?.numeroVeicoli ?? 1;
      const base = 'Servizio di intermediazione per passaggio di proprietà';
      return {
        descrizione: nVeicoli > 1 ? `${base} multiplo (${nVeicoli} veicoli)` : base,
        riferimento: doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null,
      };
    }
```

- [ ] **Step 4: Esegui il test e verifica che passa**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/fatturazione/descrizione.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungi `numeroVeicoli` ai due include**

In `apps/piattaforma/src/lib/fatturazione/documento-pdf.ts`, nel `documentoPdfInclude.pratica.select` (righe 19-25), aggiungi `numeroVeicoli: true` (accanto a `codicePratica: true`):

```ts
  pratica: {
    select: {
      codicePratica: true,
      numeroVeicoli: true,
      agenziaSedeId: true,
      brokerSedeId: true,
      agenziaSede: sedeSelect,
      brokerSede: sedeSelect,
    },
  },
```

In `apps/piattaforma/src/app/api/fatturazione/[id]/xml/route.ts`, nell'include (riga 43), aggiungi `numeroVeicoli: true`:

```ts
      pratica: { select: { codicePratica: true, numeroVeicoli: true, agenziaSedeId: true, brokerSedeId: true } },
```

- [ ] **Step 6: Typecheck + suite completa**

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma typecheck`
Expected: PASS (i due `DocumentoFiscaleGetPayload` ora includono `numeroVeicoli`; `descrizioneDocumento` lo riceve).

Run: `$env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test`
Expected: PASS (inclusi i test PDF/XML esistenti, che passano `descrizione` come input diretto e non cambiano).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/descrizione.ts apps/piattaforma/src/lib/fatturazione/descrizione.test.ts apps/piattaforma/src/lib/fatturazione/documento-pdf.ts "apps/piattaforma/src/app/api/fatturazione/[id]/xml/route.ts"
git commit -m "feat(fatturazione): voce FATTURA_PV con multiplo (N veicoli)"
```

---

## Nota comune alle Task 4–7 (applicazione chip)

- Import: aggiungere `TipoPraticaChip` all'import esistente da `@/components/ui` (dove il file già importa `StatusChip`/`Card`/ecc.), oppure aggiungere `import { TipoPraticaChip } from '@/components/ui';`.
- Snippet chip (adatta il nome variabile: `p` / `a.pratica` / `pratica`): `<TipoPraticaChip tipo={<pratica>.tipo} numeroVeicoli={<pratica>.numeroVeicoli} />`.
- Le query che caricano la pratica via `include` espongono già `tipo`/`numeroVeicoli` (scalari): **nessuna modifica alla query** tranne dove indicato (Task 6, broker-dashboard `select`).
- Verifica per ogni task: `pnpm --filter piattaforma typecheck` + `pnpm --filter piattaforma lint` (0 errori) + `pnpm --filter piattaforma test` (verde). Non rompere le griglie.

---

## Task 4: Chip — pratiche (lista + dettaglio)

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/page.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx`

- [ ] **Step 1: Lista pratiche — cella codice**

In `apps/piattaforma/src/app/pratiche/page.tsx`, la cella del codice (righe 282-284) è dentro una riga a griglia. Sostituiscila con una versione che impila codice + chip senza rompere la griglia:

```tsx
                        <div className="min-w-0 py-3 pl-5 pr-3">
                          <div className="truncate font-mono font-semibold text-pv-navy-800">
                            {p.codicePratica ?? 'BOZZA'}
                          </div>
                          <TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} className="mt-1" />
                        </div>
```

Aggiungi `TipoPraticaChip` all'import da `@/components/ui`. (Nessuna modifica query: `findMany({ include })` espone gli scalari.)

- [ ] **Step 2: Dettaglio pratica — sostituisci la label locale col chip**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx`, alla riga 288 sostituisci `{labelTipo(pratica.tipo, pratica.numeroVeicoli)} · {pratica.comune ?? '—'}` con il chip seguito dal comune, es.:

```tsx
              <TipoPraticaChip tipo={pratica.tipo} numeroVeicoli={pratica.numeroVeicoli} /> · {pratica.comune ?? '—'}
```

Rimuovi la funzione locale `labelTipo` (righe 743-746) ora inutilizzata, e l'eventuale import `PraticaTipo` se non più usato altrove nel file (verifica col lint). Aggiungi `TipoPraticaChip` all'import da `@/components/ui`.

- [ ] **Step 3: Verifica (typecheck + lint + test)** — vedi "Nota comune". Expected: verde, nessun `labelTipo`/import orfano.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/page.tsx "apps/piattaforma/src/app/pratiche/[id]/page.tsx"
git commit -m "feat(pratiche): chip tipologia in lista e dettaglio"
```

---

## Task 5: Chip — inbox (lista + dettaglio)

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/page.tsx`
- Modify: `apps/piattaforma/src/app/inbox/[id]/page.tsx`

- [ ] **Step 1: Inbox lista — pending**

In `apps/piattaforma/src/app/inbox/page.tsx`, nel blocco pending, subito dopo lo `</StatusChip>`/chiusura dello `StatusChip` (righe 116-119) e prima dello `<span>` con `formatRelative` (riga 120), inserisci nel medesimo contenitore `flex flex-wrap`:

```tsx
                        <TipoPraticaChip tipo={a.pratica.tipo} numeroVeicoli={a.pratica.numeroVeicoli} />
```

- [ ] **Step 2: Inbox lista — storico recenti**

Nel blocco "Storico decisioni recenti", nel `<div className="min-w-0">` (riga 173), prima del `<p className="truncate ...">` (riga 174), inserisci il chip su una riga propria:

```tsx
                    <TipoPraticaChip tipo={a.pratica.tipo} numeroVeicoli={a.pratica.numeroVeicoli} className="mb-1" />
```

Aggiungi `TipoPraticaChip` all'import da `@/components/ui`. (Query via `include`: scalari presenti.)

- [ ] **Step 3: Inbox dettaglio — sostituisci la label locale**

In `apps/piattaforma/src/app/inbox/[id]/page.tsx`, alla riga 93 sostituisci `{labelTipo(pratica.tipo)} · {pratica.comune ?? '—'}` con:

```tsx
            <TipoPraticaChip tipo={pratica.tipo} numeroVeicoli={pratica.numeroVeicoli} /> · {pratica.comune ?? '—'}
```

Rimuovi la funzione locale `labelTipo` (righe 311-315). Aggiungi `TipoPraticaChip` all'import da `@/components/ui`. (Query via `include`: scalari presenti.)

- [ ] **Step 4: Verifica (typecheck + lint + test)** — vedi "Nota comune".

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/inbox/page.tsx "apps/piattaforma/src/app/inbox/[id]/page.tsx"
git commit -m "feat(inbox): chip tipologia in lista e dettaglio"
```

---

## Task 6: Chip — dashboard (agenzia + broker)

**Files:**
- Modify: `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`
- Modify: `apps/piattaforma/src/app/dashboard/broker-dashboard.tsx`

- [ ] **Step 1: Dashboard agenzia — assegnazioni recenti**

In `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`, nel contenitore `flex flex-wrap items-center gap-2` (righe 261-269), subito dopo lo `<StatusChip .../>` (chiuso a riga 268), inserisci:

```tsx
                        <TipoPraticaChip tipo={a.pratica.tipo} numeroVeicoli={a.pratica.numeroVeicoli} />
```

Aggiungi `TipoPraticaChip` all'import `@/components/ui` (dove già importa `StatusChip`/`StatCard`). (Query `pratica: { include }`: scalari presenti.)

- [ ] **Step 2: Dashboard broker — estendi la `select` e rendi il chip**

In `apps/piattaforma/src/app/dashboard/broker-dashboard.tsx`:
- La **seconda** query (`prisma.pratica.findMany` con `select:` alle righe ~61-66) NON espone gli scalari: aggiungi `tipo: true, numeroVeicoli: true` a quel `select` (accanto a `codicePratica: true`, riga 63).
- Rendi `<TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} />` accanto al codice pratica **in entrambe** le liste: la riga ~176 (`{p.codicePratica ?? p.id.slice(0, 8)}`, seconda query) e la riga ~264 (`{p.codicePratica ?? 'BOZZA'}`, prima query che usa `include` → scalari già presenti). Posizionare il chip senza rompere il layout (accanto o sotto il codice).

Aggiungi `TipoPraticaChip` all'import da `@/components/ui`.

- [ ] **Step 3: Verifica (typecheck + lint + test)** — vedi "Nota comune". Attenzione: se manca `tipo`/`numeroVeicoli` nella `select`, il typecheck fallisce sul render → conferma di averli aggiunti.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx apps/piattaforma/src/app/dashboard/broker-dashboard.tsx
git commit -m "feat(dashboard): chip tipologia nelle card pratiche"
```

---

## Task 7: Chip — admin (pratiche + escalation)

**Files:**
- Modify: `apps/piattaforma/src/app/admin/pratiche/page.tsx`
- Modify: `apps/piattaforma/src/app/admin/escalation/page.tsx`

- [ ] **Step 1: Admin pratiche — cella codice (griglia)**

In `apps/piattaforma/src/app/admin/pratiche/page.tsx`, la cella del codice (righe 161-163) è:

```tsx
                      <div className="min-w-0 truncate py-3 pl-5 pr-3 font-mono font-semibold text-pv-navy-800">
                        {p.codicePratica ?? 'BOZZA'}
                      </div>
```

Sostituiscila impilando codice + chip senza aggiungere colonne alla griglia:

```tsx
                      <div className="min-w-0 py-3 pl-5 pr-3">
                        <div className="truncate font-mono font-semibold text-pv-navy-800">
                          {p.codicePratica ?? 'BOZZA'}
                        </div>
                        <TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} className="mt-1 relative z-10" />
                      </div>
```

(`relative z-10` tiene il chip sopra l'anchor a tutta riga.) Aggiungi `TipoPraticaChip` all'import da `@/components/ui`. (Query `findMany({ include })`: scalari presenti.)

- [ ] **Step 2: Admin escalation — accanto al codice**

In `apps/piattaforma/src/app/admin/escalation/page.tsx`, accanto al render del codice (riga ~105, `{p.codicePratica ?? '—'}`), inserisci `<TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} />` mantenendo il layout della riga. Aggiungi `TipoPraticaChip` all'import da `@/components/ui`. (Query `findMany({ include })`: scalari presenti.)

- [ ] **Step 3: Verifica (typecheck + lint + test)** — vedi "Nota comune".

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/admin/pratiche/page.tsx apps/piattaforma/src/app/admin/escalation/page.tsx
git commit -m "feat(admin): chip tipologia in pratiche ed escalation"
```

---

## Verifica end-to-end (fine fase)

- [ ] **DB read-only** — container `pv-postgres`, DB `passaggio_veloce`, utente `pv` (SQL via stdin, PowerShell 5.1 mangia i doppi apici):
  ```sql
  SELECT tipo, "numeroVeicoli", count(*) FROM pratiche GROUP BY 1,2 ORDER BY 1,2;
  ```
  Confermare l'esistenza di pratiche con `numeroVeicoli > 1` (SEMPLICE e/o MINIVOLTURA); altrimenti annotare nel report che il caso multiplo non è esercitabile con i dati locali.
- [ ] **Smoke** — `pnpm --filter piattaforma dev`: chip visibile e corretto nelle 8 viste (singolo e multiplo, capitalizzazione come da spec); PDF/XML di una FATTURA_PV multipla riporta "…proprietà multiplo (N veicoli)".

---

## Self-review (eseguito)

- **Spec coverage:** item 1 → Task 3 (descrizione + include + test); item 2 → Task 1 (helper) + Task 2 (chip) + Task 4-7 (8 superfici); centralizzazione (rimozione `labelTipo` locali) → Task 4 (pratiche/[id]) + Task 5 (inbox/[id]). Tutte le 8 superfici coperte.
- **Placeholder scan:** helper/chip/descrizione con codice verbatim; le task UI hanno anchor precisi (numeri di riga + snippet corrente) e lo snippet chip.
- **Type consistency:** `labelTipoPratica({tipo, numeroVeicoli})` (Task 1) usato da `TipoPraticaChip` (Task 2); `TipoPraticaChip` props `{tipo, numeroVeicoli, className?}` usate identiche in Task 4-7; `DescrizioneDoc.pratica.numeroVeicoli?` (Task 3) fornito dai due include estesi. Etichette e testo fattura verbatim dai Global Constraints.
