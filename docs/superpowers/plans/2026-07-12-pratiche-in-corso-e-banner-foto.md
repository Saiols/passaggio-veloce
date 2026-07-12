# Pratiche in corso (tab + evidenza) e banner qualità foto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nella lista pratiche, dare accesso rapido alle pratiche "in corso" tramite tab ed evidenziarle nella lista completa; nel wizard di creazione, aggiungere un banner sulla qualità delle foto che dica anche che da telefono si può scattare direttamente.

**Architecture:** La classificazione degli stati diventa un modulo puro condiviso (`lib/pratiche/stati.ts`), usato sia dal badge di navigazione sia dai tab, così i due numeri non possono divergere. I tab sono link `GET` che scrivono sullo **stesso** parametro `?stato=` già esistente, con due nuovi valori aggregati (`IN_CORSO`, `CONCLUSE`) sul modello di `IN_ATTESA` già in uso: nessun parametro nuovo, nessuno stato conflittuale. I contatori arrivano da una sola `groupBy`. Il banner del wizard è un componente presentazionale riusato negli step con upload.

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma + Postgres, Tailwind, vitest (`environment: 'node'`), pnpm monorepo Turborepo.

## Global Constraints

- **Nessuna migration**: solo lettura, zero cambi di schema.
- **`vitest` gira in `environment: 'node'`** (`apps/piattaforma/vitest.config.ts:6`) e nel progetto **non c'è testing-library**: si testano moduli **puri**, mai il markup dei componenti. Non introdurre test di rendering.
- **Definizione di "in corso"** (decisa in spec): `IN_ATTESA_ROUND_1|2|3`, `IN_ESCALATION`, `ACCETTATA`, `PROCESSATA`. **Fuori**: `BOZZA`, `FIRMATA`, `ANNULLATA`, `SCADUTA`. È la stessa già usata dal badge.
- **Tailwind non risolve nomi di classe costruiti a runtime**: le classi vanno scritte per intero come stringhe letterali (vedi il commento in `lib/pratiche/table-grid.ts:20`).
- **Palette**: usare solo token del design system (`pv-navy-*`, `pv-slate-*`, …). Nessun colore hardcoded.
- **`pnpm typecheck` a cache fredda è inaffidabile** in questo repo (stack overflow / falsi errori Prisma): usarlo solo con il `tsbuildinfo` già presente. Il segnale affidabile è `pnpm test` + `pnpm lint` + `pnpm build`.
- **Comandi** (dalla root del repo): `pnpm --filter @pv/piattaforma test`, `pnpm --filter @pv/piattaforma lint`. Node ≥ 18: se la shell è appena stata riavviata, `nvm use 22.15.0`.
- Commit in italiano, formato `tipo(scope): descrizione`, senza `--no-verify`.

---

### Task 1: Fonte unica per la classificazione degli stati

Estrae la definizione di "in corso" dal badge (dove oggi vive nascosta come lista di esclusi) in un modulo puro, e ricollega il badge a quel modulo. È la base di tutto il resto: i tab e il badge devono contare la stessa cosa.

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/stati.ts`
- Test: `apps/piattaforma/src/lib/pratiche/stati.test.ts`
- Modify: `apps/piattaforma/src/app/api/badges/route.ts:14-17` (rimuove `STATI_ESCLUSI`), `:62` e `:71` (usano il nuovo filtro)

**Interfaces:**
- Consumes: `PraticaStato` da `@pv/db` (enum Prisma).
- Produces:
  - `STATI_IN_CORSO: readonly PraticaStato[]`
  - `STATI_CONCLUSI: readonly PraticaStato[]`
  - `STATI_IN_ATTESA: readonly PraticaStato[]` (i 3 round + escalation; oggi duplicata in `pratiche/page.tsx:39`)
  - `isInCorso(stato: PraticaStato): boolean`
  - `whereStato(param: string | undefined): PraticaStato | { in: PraticaStato[] } | undefined`
  - `contaGruppi(rows: { stato: PraticaStato; _count: { _all: number } }[]): ConteggiTab`
  - `type ConteggiTab = { tutte: number; inCorso: number; bozze: number; concluse: number }`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `apps/piattaforma/src/lib/pratiche/stati.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PraticaStato } from '@pv/db';
import {
  STATI_IN_CORSO,
  STATI_CONCLUSI,
  isInCorso,
  whereStato,
  contaGruppi,
} from './stati';

// Tutti i valori dell'enum Prisma, presi dall'enum stesso: se domani ne viene
// aggiunto uno, questa lista cresce da sola e i test sotto lo intercettano.
const TUTTI = Object.values(PraticaStato) as PraticaStato[];

describe('partizione degli stati', () => {
  // L'invariante che conta: uno stato nuovo aggiunto all'enum e non classificato
  // sparirebbe in silenzio dai tab e dai conteggi. Qui il test diventa rosso.
  it.each(TUTTI)('%s cade in esattamente un gruppo', (stato) => {
    const gruppi = [
      stato === 'BOZZA',
      STATI_IN_CORSO.includes(stato),
      STATI_CONCLUSI.includes(stato),
    ].filter(Boolean).length;
    expect(gruppi).toBe(1);
  });

  it('i gruppi non si sovrappongono', () => {
    const overlap = STATI_IN_CORSO.filter((s) => STATI_CONCLUSI.includes(s));
    expect(overlap).toEqual([]);
  });
});

describe('isInCorso', () => {
  it('la bozza non è in corso: non è ancora stata inviata', () => {
    expect(isInCorso('BOZZA')).toBe(false);
  });

  it("l'escalation è in corso: la pratica è viva, la sta assegnando il team", () => {
    expect(isInCorso('IN_ESCALATION')).toBe(true);
  });

  it('accettata e processata sono in corso', () => {
    expect(isInCorso('ACCETTATA')).toBe(true);
    expect(isInCorso('PROCESSATA')).toBe(true);
  });

  it('firmata, annullata e scaduta non sono in corso: sono terminali', () => {
    expect(isInCorso('FIRMATA')).toBe(false);
    expect(isInCorso('ANNULLATA')).toBe(false);
    expect(isInCorso('SCADUTA')).toBe(false);
  });
});

describe('whereStato', () => {
  it('senza parametro non filtra nulla', () => {
    expect(whereStato(undefined)).toBeUndefined();
    expect(whereStato('')).toBeUndefined();
  });

  it('un valore non riconosciuto non filtra nulla (niente lista vuota a sorpresa)', () => {
    expect(whereStato('PIPPO')).toBeUndefined();
  });

  it('IN_CORSO espande sui 6 stati vivi', () => {
    expect(whereStato('IN_CORSO')).toEqual({ in: [...STATI_IN_CORSO] });
  });

  it('CONCLUSE espande sui 3 stati terminali', () => {
    expect(whereStato('CONCLUSE')).toEqual({ in: [...STATI_CONCLUSI] });
  });

  it('IN_ATTESA espande sui round + escalation (aggregato già esistente)', () => {
    expect(whereStato('IN_ATTESA')).toEqual({
      in: ['IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3', 'IN_ESCALATION'],
    });
  });

  it('uno stato singolo filtra per uguaglianza', () => {
    expect(whereStato('PROCESSATA')).toBe('PROCESSATA');
  });

  it('gli stati interni del motore non sono selezionabili dall utente', () => {
    // R1/R2/R3 ed escalation non sono esposti singolarmente nella UI utente:
    // passarli a mano nell'URL non deve produrre un filtro.
    expect(whereStato('IN_ATTESA_ROUND_2')).toBeUndefined();
    expect(whereStato('IN_ESCALATION')).toBeUndefined();
  });
});

describe('contaGruppi', () => {
  it('somma i conteggi Prisma nei quattro gruppi dei tab', () => {
    const rows = [
      { stato: 'BOZZA' as PraticaStato, _count: { _all: 2 } },
      { stato: 'IN_ATTESA_ROUND_1' as PraticaStato, _count: { _all: 3 } },
      { stato: 'ACCETTATA' as PraticaStato, _count: { _all: 1 } },
      { stato: 'FIRMATA' as PraticaStato, _count: { _all: 4 } },
      { stato: 'ANNULLATA' as PraticaStato, _count: { _all: 1 } },
    ];
    expect(contaGruppi(rows)).toEqual({ tutte: 11, inCorso: 4, bozze: 2, concluse: 5 });
  });

  it('senza righe è tutto a zero', () => {
    expect(contaGruppi([])).toEqual({ tutte: 0, inCorso: 0, bozze: 0, concluse: 0 });
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```bash
pnpm --filter @pv/piattaforma test -- stati
```

Atteso: FAIL — `Failed to resolve import "./stati"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementare il modulo**

Crea `apps/piattaforma/src/lib/pratiche/stati.ts`:

```ts
import type { PraticaStato } from '@pv/db';

/**
 * Classificazione degli stati pratica per la UI. FONTE UNICA: la usano sia i tab
 * della lista (`/pratiche`) sia il badge di navigazione (`/api/badges`). Prima
 * la definizione viveva solo dentro la route del badge come lista di esclusi:
 * due definizioni separate = badge e tab che mostrano numeri diversi.
 *
 * `stati.test.ts` blinda l'invariante: ogni valore dell'enum Prisma deve cadere
 * in ESATTAMENTE uno tra BOZZA / IN_CORSO / CONCLUSI. Se domani viene aggiunto
 * uno stato senza classificarlo, il test diventa rosso invece di farlo sparire
 * in silenzio dai conteggi.
 */

/** Round di distribuzione + escalation: per l'utente sono tutti "In attesa". */
export const STATI_IN_ATTESA = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
  'IN_ESCALATION',
] as const satisfies readonly PraticaStato[];

/** Pratiche vive: inviate e non ancora concluse. Nessuna bozza. */
export const STATI_IN_CORSO = [
  ...STATI_IN_ATTESA,
  'ACCETTATA',
  'PROCESSATA',
] as const satisfies readonly PraticaStato[];

/** Terminali: nessuna azione attesa, né dal broker né dall'agenzia. */
export const STATI_CONCLUSI = [
  'FIRMATA',
  'ANNULLATA',
  'SCADUTA',
] as const satisfies readonly PraticaStato[];

export function isInCorso(stato: PraticaStato): boolean {
  return (STATI_IN_CORSO as readonly PraticaStato[]).includes(stato);
}

/**
 * Valori ammessi per `?stato=`. Gli aggregati (IN_CORSO, CONCLUSE, IN_ATTESA)
 * espandono su più stati DB; gli altri filtrano per uguaglianza.
 *
 * R1/R2/R3 ed escalation NON sono selezionabili singolarmente: sono dettagli
 * interni al motore di distribuzione e non vanno esposti all'utente (la lista
 * completa resta in /admin/pratiche).
 */
const SINGOLI = ['BOZZA', 'ACCETTATA', 'PROCESSATA', 'FIRMATA', 'SCADUTA', 'ANNULLATA'] as const;

export function whereStato(
  param: string | undefined,
): PraticaStato | { in: PraticaStato[] } | undefined {
  if (!param) return undefined;
  if (param === 'IN_CORSO') return { in: [...STATI_IN_CORSO] };
  if (param === 'CONCLUSE') return { in: [...STATI_CONCLUSI] };
  if (param === 'IN_ATTESA') return { in: [...STATI_IN_ATTESA] };
  if ((SINGOLI as readonly string[]).includes(param)) return param as PraticaStato;
  // Valore non riconosciuto (URL manomesso): nessun filtro, come se non ci fosse.
  return undefined;
}

export type ConteggiTab = {
  tutte: number;
  inCorso: number;
  bozze: number;
  concluse: number;
};

/** Riduce il risultato di `prisma.pratica.groupBy({ by: ['stato'] })` ai 4 gruppi dei tab. */
export function contaGruppi(
  rows: { stato: PraticaStato; _count: { _all: number } }[],
): ConteggiTab {
  const out: ConteggiTab = { tutte: 0, inCorso: 0, bozze: 0, concluse: 0 };
  for (const r of rows) {
    const n = r._count._all;
    out.tutte += n;
    if (r.stato === 'BOZZA') out.bozze += n;
    else if (isInCorso(r.stato)) out.inCorso += n;
    else out.concluse += n;
  }
  return out;
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

```bash
pnpm --filter @pv/piattaforma test -- stati
```

Atteso: PASS, tutti i test del file.

- [ ] **Step 5: Ricollegare il badge alla fonte unica**

In `apps/piattaforma/src/app/api/badges/route.ts`, **cancella** il blocco righe 14-17:

```ts
// Stati esclusi dal conteggio "attive": terminali (FIRMATA/ANNULLATA/SCADUTA,
// nessuna azione attesa) + BOZZA (bozze non ancora inviate, non sono lavoro in
// corso). Resta attivo tutto il mezzo: in distribuzione, accettata, processata.
const STATI_ESCLUSI = ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as unknown as PraticaStato[];
```

e sostituisci l'import di riga 2 e le due `where` (righe 62 e 71). L'import diventa:

```ts
import { prisma } from '@pv/db';
import { STATI_IN_CORSO } from '@/lib/pratiche/stati';
```

(`PraticaStato` non serve più in questo file: era importato solo per il cast di `STATI_ESCLUSI`.)

Entrambe le occorrenze di:

```ts
          { stato: { notIn: STATI_ESCLUSI } },
```

diventano:

```ts
          // "Attive" = in corso: stessa definizione dei tab della lista pratiche,
          // così badge e tab non possono mostrare numeri diversi.
          { stato: { in: [...STATI_IN_CORSO] } },
```

- [ ] **Step 6: Verificare lint e test**

```bash
pnpm --filter @pv/piattaforma lint
pnpm --filter @pv/piattaforma test -- stati
```

Atteso: lint pulito (nessun import inutilizzato in `route.ts`), test PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/stati.ts apps/piattaforma/src/lib/pratiche/stati.test.ts apps/piattaforma/src/app/api/badges/route.ts
git commit -m "refactor(pratiche): fonte unica per la classificazione degli stati"
```

---

### Task 2: Tab della lista pratiche

I tab sono link GET sullo stesso `?stato=`. La logica pura (quali tab per quale ruolo, come si costruisce l'href preservando i filtri) sta in un modulo testabile; il componente è solo markup.

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/tabs.ts`
- Test: `apps/piattaforma/src/lib/pratiche/tabs.test.ts`
- Create: `apps/piattaforma/src/app/pratiche/tabs.tsx` (Server Component: solo `<Link>`, nessun hook)
- Modify: `apps/piattaforma/src/app/pratiche/page.tsx` (righe 23-44: `STATI_USER` + rimozione di `STATI_IN_ATTESA`; righe 106-185: `whereBase` + `groupBy`; riga 219: render dei tab)

**Interfaces:**
- Consumes: da Task 1 — `STATI_IN_CORSO`, `STATI_CONCLUSI`, `STATI_IN_ATTESA`, `whereStato()`, `contaGruppi()`, `type ConteggiTab`.
- Produces:
  - `type ValoreTab = '' | 'IN_CORSO' | 'BOZZA' | 'CONCLUSE'`
  - `type TabPratiche = { value: ValoreTab; label: string; count: number }`
  - `tabsPratiche(opts: { isAgenzia: boolean; conteggi: ConteggiTab }): TabPratiche[]`
  - `tabAttivo(stato: string | undefined): ValoreTab | null`
  - `hrefTab(value: ValoreTab, filtri: { q?: string; periodo?: string; sede?: string }): string`
  - Componente `<PraticheTabs tabs={...} attivo={...} filtri={...} />`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `apps/piattaforma/src/lib/pratiche/tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tabsPratiche, tabAttivo, hrefTab } from './tabs';

const conteggi = { tutte: 11, inCorso: 4, bozze: 2, concluse: 5 };

describe('tabsPratiche', () => {
  it('il broker vede quattro tab, con i conteggi', () => {
    expect(tabsPratiche({ isAgenzia: false, conteggi })).toEqual([
      { value: '', label: 'Tutte', count: 11 },
      { value: 'IN_CORSO', label: 'In corso', count: 4 },
      { value: 'BOZZA', label: 'Bozze', count: 2 },
      { value: 'CONCLUSE', label: 'Concluse', count: 5 },
    ]);
  });

  it("l'agenzia non vede il tab Bozze: nella sua lista non entrano mai bozze", () => {
    // `agenziaSedeId` viene scritto solo all'accettazione (inbox/actions.ts:92):
    // una pratica in BOZZA non è ancora assegnata, quindi il tab sarebbe sempre 0.
    const tabs = tabsPratiche({ isAgenzia: true, conteggi });
    expect(tabs.map((t) => t.value)).toEqual(['', 'IN_CORSO', 'CONCLUSE']);
  });
});

describe('tabAttivo', () => {
  it('nessun filtro ⇒ tab Tutte', () => {
    expect(tabAttivo(undefined)).toBe('');
    expect(tabAttivo('')).toBe('');
  });

  it('gli aggregati dei tab accendono il tab corrispondente', () => {
    expect(tabAttivo('IN_CORSO')).toBe('IN_CORSO');
    expect(tabAttivo('BOZZA')).toBe('BOZZA');
    expect(tabAttivo('CONCLUSE')).toBe('CONCLUSE');
  });

  it('un filtro fine dalla select non accende nessun tab', () => {
    // "solo Processate" è più stretto di "In corso": accendere "In corso"
    // sarebbe una bugia (mostrerebbe selezionato un tab che non stai vedendo).
    expect(tabAttivo('PROCESSATA')).toBeNull();
    expect(tabAttivo('FIRMATA')).toBeNull();
    expect(tabAttivo('IN_ATTESA')).toBeNull();
  });
});

describe('hrefTab', () => {
  it('il tab Tutte non mette il parametro stato', () => {
    expect(hrefTab('', {})).toBe('/pratiche');
  });

  it('preserva gli altri filtri attivi', () => {
    const href = hrefTab('IN_CORSO', { q: 'AB123CD', periodo: '30d', sede: 'sede-1' });
    expect(href).toBe('/pratiche?stato=IN_CORSO&q=AB123CD&periodo=30d&sede=sede-1');
  });

  it('azzera la paginazione: cambiare tab riporta a pagina 1', () => {
    // `page` non è tra i filtri accettati, quindi non può essere trascinata:
    // restare a pagina 4 su un tab con 2 risultati darebbe una lista vuota.
    expect(hrefTab('BOZZA', { q: '' })).toBe('/pratiche?stato=BOZZA');
  });

  it('codifica i valori: la ricerca può contenere spazi e simboli', () => {
    expect(hrefTab('', { q: 'mario rossi & figli' })).toBe(
      '/pratiche?q=mario+rossi+%26+figli',
    );
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```bash
pnpm --filter @pv/piattaforma test -- tabs
```

Atteso: FAIL — `Failed to resolve import "./tabs"`.

- [ ] **Step 3: Implementare il modulo puro**

Crea `apps/piattaforma/src/lib/pratiche/tabs.ts`:

```ts
import type { ConteggiTab } from './stati';

/**
 * Tab della lista pratiche. NON introducono un parametro nuovo: scrivono sullo
 * stesso `?stato=` della select "Stato", usando i valori aggregati IN_CORSO e
 * CONCLUSE (stesso meccanismo di IN_ATTESA, già in uso). Un solo parametro ⇒
 * tab e select non possono entrare in conflitto e gli URL restano condivisibili.
 */
export type ValoreTab = '' | 'IN_CORSO' | 'BOZZA' | 'CONCLUSE';

export type TabPratiche = { value: ValoreTab; label: string; count: number };

/** Filtri che i tab devono trascinarsi dietro. `page` è volutamente fuori. */
export type FiltriTab = { q?: string; periodo?: string; sede?: string };

export function tabsPratiche({
  isAgenzia,
  conteggi,
}: {
  isAgenzia: boolean;
  conteggi: ConteggiTab;
}): TabPratiche[] {
  const tabs: TabPratiche[] = [
    { value: '', label: 'Tutte', count: conteggi.tutte },
    { value: 'IN_CORSO', label: 'In corso', count: conteggi.inCorso },
  ];
  // L'agenzia non ha bozze: `agenziaSedeId` viene scritto solo all'accettazione
  // (inbox/actions.ts:92), quindi le pratiche non ancora assegnate non compaiono
  // nella sua lista e il tab sarebbe perennemente a zero.
  if (!isAgenzia) tabs.push({ value: 'BOZZA', label: 'Bozze', count: conteggi.bozze });
  tabs.push({ value: 'CONCLUSE', label: 'Concluse', count: conteggi.concluse });
  return tabs;
}

/**
 * Quale tab risulta selezionato dato `?stato=`. Un filtro più fine di qualunque
 * tab (es. `PROCESSATA` scelto dalla select) non ne accende nessuno: mostrare
 * "In corso" attivo mentre vedi solo le processate sarebbe fuorviante.
 */
export function tabAttivo(stato: string | undefined): ValoreTab | null {
  if (!stato) return '';
  if (stato === 'IN_CORSO' || stato === 'BOZZA' || stato === 'CONCLUSE') return stato;
  return null;
}

export function hrefTab(value: ValoreTab, filtri: FiltriTab): string {
  const qs = new URLSearchParams();
  if (value) qs.set('stato', value);
  if (filtri.q) qs.set('q', filtri.q);
  if (filtri.periodo) qs.set('periodo', filtri.periodo);
  if (filtri.sede) qs.set('sede', filtri.sede);
  const s = qs.toString();
  return s ? `/pratiche?${s}` : '/pratiche';
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

```bash
pnpm --filter @pv/piattaforma test -- tabs
```

Atteso: PASS.

- [ ] **Step 5: Creare il componente dei tab**

Crea `apps/piattaforma/src/app/pratiche/tabs.tsx` (Server Component: solo link, nessun hook, nessun `'use client'`):

```tsx
import Link from 'next/link';
import { hrefTab, type FiltriTab, type TabPratiche, type ValoreTab } from '@/lib/pratiche/tabs';

/**
 * Accesso rapido ai gruppi della lista. Sono `<Link>` GET sullo stesso `?stato=`
 * usato dalla select: niente stato client, niente parametro nuovo.
 */
export function PraticheTabs({
  tabs,
  attivo,
  filtri,
}: {
  tabs: TabPratiche[];
  /** `null` quando è attivo un filtro fine dalla select: nessun tab selezionato. */
  attivo: ValoreTab | null;
  filtri: FiltriTab;
}) {
  return (
    <nav
      aria-label="Filtri rapidi pratiche"
      className="mb-3 flex flex-wrap gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
    >
      {tabs.map((t) => {
        const selezionato = attivo === t.value;
        return (
          <Link
            key={t.value || 'tutte'}
            href={hrefTab(t.value, filtri)}
            aria-current={selezionato ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[13px] font-semibold transition ${
              selezionato
                ? 'bg-pv-navy-800 text-white'
                : 'text-pv-slate-600 hover:bg-pv-slate-50 hover:text-pv-navy-800'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                selezionato ? 'bg-white/20 text-white' : 'bg-pv-slate-100 text-pv-slate-600'
              }`}
            >
              {t.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Aggiungere gli aggregati alla select e togliere la duplicazione**

In `apps/piattaforma/src/app/pratiche/page.tsx`, sostituisci il blocco righe 23-44 (`STATI_USER` + `STATI_IN_ATTESA`) con:

```ts
// Filtri stato per la lista pratiche broker/agenzia (item 10 release 2026-05).
// Niente R1/R2/R3 ne "Escalation": questi dettagli sono interni al motore di
// distribuzione e non devono apparire all'utente. Lato admin la lista
// completa rimane in /admin/pratiche.
//
// I primi due valori sono gli AGGREGATI dei tab: stando nella stessa select, il
// `defaultValue` mostra il valore giusto anche quando arrivi da un tab.
const STATI_USER: { value: string; label: string }[] = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'IN_CORSO', label: 'In corso' },
  { value: 'CONCLUSE', label: 'Concluse' },
  { value: 'BOZZA', label: 'Bozza' },
  { value: 'IN_ATTESA', label: 'In attesa' },
  { value: 'ACCETTATA', label: 'Accettata' },
  { value: 'PROCESSATA', label: 'Processata' },
  { value: 'FIRMATA', label: 'Firmata' },
  { value: 'SCADUTA', label: 'Scaduta' },
  { value: 'ANNULLATA', label: 'Annullata' },
];
```

(La costante locale `STATI_IN_ATTESA` sparisce: ora vive in `lib/pratiche/stati.ts`.)

Aggiungi gli import in cima al file, accanto agli altri `@/lib/pratiche/*` (riga 16-19):

```ts
import { whereStato, contaGruppi } from '@/lib/pratiche/stati';
import { tabsPratiche, tabAttivo } from '@/lib/pratiche/tabs';
import { PraticheTabs } from './tabs';
```

- [ ] **Step 7: Applicare il filtro stato e contare i gruppi**

Sempre in `page.tsx`, sostituisci il blocco righe 150-156:

```ts
  if (sp.stato && STATI_USER.some((s) => s.value === sp.stato)) {
    if (sp.stato === 'IN_ATTESA') {
      where.stato = { in: STATI_IN_ATTESA as unknown as PraticaStato[] };
    } else {
      where.stato = sp.stato as PraticaStato;
    }
  }
```

con:

```ts
  const filtroStato = whereStato(sp.stato);
```

**Attenzione all'ordine:** i filtri `periodo` e `q` (righe 158-169) mutano `where` e devono restare **prima** dello snapshot qui sotto.

Poi sostituisci il blocco `Promise.all` (righe 171-185) con:

```ts
  // I conteggi dei tab usano gli STESSI filtri della lista (ricerca, periodo,
  // sede, scope) MENO lo stato: il numero sul tab è esattamente quello che
  // ottieni cliccandolo. `where` include lo stato, `whereBase` no.
  const whereBase: Prisma.PraticaWhereInput = { ...where };
  if (filtroStato !== undefined) where.stato = filtroStato;

  const [items, total, gruppi] = await Promise.all([
    prisma.pratica.findMany({
      where,
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip,
      take: PAGE_SIZE,
      include: {
        agenziaAssegnata: { select: { ragioneSociale: true, citta: true } },
        broker: { select: { ragioneSociale: true } },
        agenziaSede: { select: { nome: true, citta: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, proprietarioAttuale: true } },
      },
    }),
    prisma.pratica.count({ where }),
    prisma.pratica.groupBy({ by: ['stato'], where: whereBase, _count: { _all: true } }),
  ]);

  const conteggi = contaGruppi(gruppi);
  const tabs = tabsPratiche({ isAgenzia, conteggi });
  const attivo = tabAttivo(sp.stato);
  const filtriTab = { q, periodo: sp.periodo, sede: sp.sede };
```

L'import di `PraticaStato` (riga 8) **resta necessario**: lo usa ancora il cast dentro `statoExtra({ stato: p.stato as PraticaStato, … })` a riga 259.

Verificato: `PraticaStato` è esportato da `@pv/db` anche come **valore** runtime (oggetto con i 10 stati), non solo come tipo — è ciò che rende possibile il test di partizione di Task 1.

- [ ] **Step 8: Renderizzare i tab sopra i filtri**

Sempre in `page.tsx`, subito **prima** di `<PraticheFilters ... />` (riga 219):

```tsx
        <PraticheTabs tabs={tabs} attivo={attivo} filtri={filtriTab} />
```

- [ ] **Step 9: Verificare test e lint**

```bash
pnpm --filter @pv/piattaforma test -- tabs stati
pnpm --filter @pv/piattaforma lint
```

Atteso: test PASS, lint pulito (nessun import o costante inutilizzati in `page.tsx`).

- [ ] **Step 10: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/tabs.ts apps/piattaforma/src/lib/pratiche/tabs.test.ts apps/piattaforma/src/app/pratiche/tabs.tsx apps/piattaforma/src/app/pratiche/page.tsx
git commit -m "feat(pratiche): tab In corso/Bozze/Concluse con contatori nella lista"
```

---

### Task 3: Evidenza delle righe in corso

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/page.tsx:242-244` (riga header) e `:269-272` (righe della lista)

**Interfaces:**
- Consumes: da Task 1 — `isInCorso(stato)`.
- Produces: nessuna interfaccia nuova (solo classi CSS).

- [ ] **Step 1: Importare `isInCorso`**

In `page.tsx`, estendi l'import da Task 2:

```ts
import { whereStato, contaGruppi, isInCorso } from '@/lib/pratiche/stati';
```

- [ ] **Step 2: Dare il bordo trasparente all'header**

La barra accento è un `border-l-[3px]` sulle righe. Se l'header non ha lo **stesso** bordo (trasparente), le sue colonne restano indietro di 3px rispetto a quelle delle righe e l'intestazione non combacia più.

In `page.tsx`, la riga 242-244 diventa:

```tsx
                <div
                  className={`grid ${grid} items-center border-b border-l-[3px] border-pv-slate-200 border-l-transparent bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
```

- [ ] **Step 3: Accendere la barra sulle righe in corso**

Il `border-l-[3px]` sta su **tutte** le righe (trasparente su quelle non in corso): un bordo aggiunto solo ad alcune sposterebbe il loro contenuto di 3px rispetto alle altre.

Sostituisci il `<div>` di riga 269-272 con:

```tsx
                      <div
                        key={p.id}
                        className={`relative grid ${grid} items-center border-l-[3px] transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50 ${
                          isInCorso(p.stato as PraticaStato)
                            ? 'border-l-pv-navy-600'
                            : 'border-l-transparent'
                        }`}
                      >
```

La barra è decorativa: lo stato resta scritto in chiaro nello `StatusChip` della stessa riga, quindi il significato non è affidato al solo colore.

Nota: `PraticaStato` serve qui come cast, quindi l'import di riga 8 resta necessario (ed è già usato più sotto da `statoExtra`).

- [ ] **Step 4: Verificare lint e build**

```bash
pnpm --filter @pv/piattaforma lint
```

Atteso: pulito. Le classi sono letterali (Tailwind non risolve nomi costruiti a runtime): `border-l-pv-navy-600` e `border-l-transparent` compaiono per intero nel sorgente.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/page.tsx
git commit -m "feat(pratiche): barra accento sulle righe delle pratiche in corso"
```

---

### Task 4: Banner qualità foto nel wizard

Il banner compare **una volta per step** (non una per persona o per veicolo), sopra l'area di upload. Gli upload dei co-intestatari vivono dentro gli step 2 e 3 (il blocco "Co-intestatario" a `wizard.tsx:1858` è renderizzato dentro le card persona), quindi il banner di step li copre già: non va aggiunto un quarto banner nello step 4, che è il riepilogo e non ha upload.

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/nuova/banner-foto-documenti.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (step 1 a riga 2266, step 2 dopo riga 2342, step 3 dopo riga 2471)

**Interfaces:**
- Consumes: `Alert` da `@/components/ui` (props: `variant?: 'success' | 'error' | 'warning' | 'info'`, `title?: string`, `children`).
- Produces: componente `<BannerFotoDocumenti />` (nessuna prop).

- [ ] **Step 1: Creare il componente**

Crea `apps/piattaforma/src/app/pratiche/nuova/banner-foto-documenti.tsx`:

```tsx
import { Alert } from '@/components/ui';

/**
 * Consigli sulla qualità delle foto dei documenti. Va mostrato UNA VOLTA PER
 * STEP (non per persona/veicolo), sopra l'area di upload.
 *
 * Il messaggio sulla fotocamera descrive un comportamento che ESISTE GIÀ: l'input
 * di UploadCard accetta `image/jpeg,image/png`, quindi il picker nativo di iOS e
 * Android offre già "Scatta foto". Deliberatamente NON usiamo l'attributo
 * `capture`: su molti browser mobile forza la fotocamera e toglie la scelta della
 * galleria, penalizzando chi la foto ce l'ha già.
 */
export function BannerFotoDocumenti() {
  return (
    <Alert variant="info" title="Come fotografare i documenti">
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          Foto <strong>nitide e ben illuminate</strong>, con il documento{' '}
          <strong>intero</strong> nell&apos;inquadratura.
        </li>
        <li>
          Evita riflessi, ombre e foto storte: se il testo non si legge, i dati non
          vengono compilati in automatico.
        </li>
        <li>
          <strong>Da telefono puoi scattare la foto direttamente</strong>: tocca
          &quot;Carica file&quot; e scegli la fotocamera. Poi puoi ritagliarla e
          raddrizzarla nell&apos;editor.
        </li>
      </ul>
    </Alert>
  );
}
```

- [ ] **Step 2: Importarlo nel wizard**

In `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`, accanto agli altri import locali (vicino a `import { UploadCard }`):

```ts
import { BannerFotoDocumenti } from './banner-foto-documenti';
```

- [ ] **Step 3: Step 1 — sopra le card veicolo**

Nello step 1, il banner va **dopo** la card "Tipo pratica" (che finisce a riga 2264) e **prima** di `{veicoli.map(...)}` (riga 2266):

```tsx
            <BannerFotoDocumenti />

            {veicoli.map((v, idx) => (
```

- [ ] **Step 4: Step 2 — sotto il warning esistente**

Nello step 2, subito dopo l'`</Alert>` di riga 2342 (il warning "I documenti vanno portati in agenzia", che resta dov'è: dice un'altra cosa):

```tsx
            </Alert>

            <BannerFotoDocumenti />

            {multiplo ? (
```

- [ ] **Step 5: Step 3 — sotto il warning esistente**

Nello step 3, subito dopo l'`</Alert>` di riga 2471:

```tsx
            </Alert>

            <BannerFotoDocumenti />

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
```

- [ ] **Step 6: Verificare lint**

```bash
pnpm --filter @pv/piattaforma lint
```

Atteso: pulito. In particolare nessun errore `react/no-unescaped-entities`: apostrofi e virgolette nel banner sono già come entità (`&apos;`, `&quot;`).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/banner-foto-documenti.tsx apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(wizard): banner sulla qualità delle foto dei documenti"
```

---

### Task 5: Verifica end-to-end

Niente di quanto sopra è "fatto" finché non lo si è visto funzionare: i test coprono i moduli puri, non la pagina. Qui si guida l'app vera.

**Files:** nessuno (solo verifica). Eventuali fix scoperti qui vanno committati a parte.

- [ ] **Step 1: Suite completa e build**

```bash
pnpm --filter @pv/piattaforma test
pnpm --filter @pv/piattaforma lint
pnpm --filter @pv/piattaforma build
```

Atteso: test tutti verdi, lint pulito, build completata. (`pnpm typecheck` a cache fredda in questo repo è inaffidabile: il segnale è la build.)

- [ ] **Step 2: Avviare l'app in locale**

```bash
pnpm --filter @pv/piattaforma dev
```

Serve il Postgres locale (copia di prod) attivo. Login con un utente **dealer/broker**.

- [ ] **Step 3: Verificare i tab lato broker**

Su `/pratiche`:
- Compaiono **4 tab**: Tutte · In corso · Bozze · Concluse, ognuno con il contatore.
- `Tutte` è selezionato all'apertura senza parametri.
- Somma: `Tutte` = `In corso` + `Bozze` + `Concluse`.
- Cliccando `In corso` l'URL diventa `/pratiche?stato=IN_CORSO`, la lista mostra solo pratiche vive, e il numero di risultati in header coincide col contatore del tab.
- Il contatore del tab **In corso** coincide con il **badge "Pratiche" nella sidebar** (è il punto del refactor di Task 1).
- Scrivi qualcosa nella ricerca: i contatori dei tab si aggiornano di conseguenza (riflettono i filtri attivi).
- Vai a pagina 2, poi cambia tab: torni a pagina 1 (nessun `?page=` trascinato, nessuna lista vuota).
- Seleziona "Processata" dalla select: **nessun tab** risulta selezionato.

- [ ] **Step 4: Verificare l'evidenza delle righe**

Sul tab `Tutte`:
- Le righe in corso hanno la barra navy a sinistra; bozze, firmate, annullate no.
- **Le colonne dell'header sono allineate con quelle delle righe** (è l'errore che il bordo trasparente sull'header previene).
- L'hover grigio continua a funzionare e non copre la barra.

- [ ] **Step 5: Verificare lato agenzia**

Login con un utente **agenzia**, su `/pratiche`:
- Compaiono **3 tab**: Tutte · In corso · Concluse. **Nessun tab Bozze.**
- Il contatore `In corso` coincide col badge della sidebar.

- [ ] **Step 6: Verificare il banner nel wizard**

Su `/pratiche/nuova`, da browser desktop e con viewport mobile (DevTools):
- Il banner "Come fotografare i documenti" compare negli step 1, 2 e 3, **una volta per step**.
- Non compare due volte nella stessa schermata quando ci sono più veicoli o co-intestatari.
- Nello step 4 (riepilogo) non c'è.
- Convive col warning "I documenti vanno portati in agenzia" senza rompere la spaziatura.

- [ ] **Step 7: Commit di eventuali fix**

Solo se la verifica ha scoperto problemi. Altrimenti niente: il lavoro è già committato.

---

## Note per chi implementa

- **Non toccare `/admin/pratiche`**: fuori scope, ha già il suo ordinamento per priorità.
- **Non riordinare la lista utente**: le pratiche in corso restano al loro posto cronologico (`submittedAt desc`), solo evidenziate.
- **Non aggiungere `capture="environment"`** all'input di `upload-card.tsx`: è una scelta esplicita, motivata nel commento del banner e nella spec.
- La select "Stato" continua a esporre all'agenzia voci che per lei danno sempre zero risultati (`Bozza`, `In attesa`, `Scaduta`). È un difetto **preesistente** e resta fuori scope: non sistemarlo in questo piano.
