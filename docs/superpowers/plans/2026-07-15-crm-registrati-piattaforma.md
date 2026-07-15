# Registrati piattaforma nella dashboard CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla dashboard CRM admin una sezione informativa che conta le aziende registrate sulla piattaforma per tipo (Broker/Agenzie), divise in "da lista CRM" vs "organici".

**Architecture:** Una funzione pura server-side (`lib/crm/platform-stats.ts`) fa due `groupBy` su `Company` (totali + filtro relazione `crmContactMatches`) e ne ricava lo split. La dashboard (server component) la chiama nel `Promise.all` esistente e rende una nuova `<section>`. Nessuna migration, nessuna modifica al motore di sync CRM↔piattaforma (già esistente), nessuna modifica alle metriche del funnel.

**Tech Stack:** Next.js 16 App Router (server components), Prisma 5 + Postgres, vitest, TypeScript, Tailwind (token `pv-*`).

## Global Constraints

- **`pnpm`/`node` SOLO da PowerShell** (Node NON è sul PATH di Git Bash; il silenzio di un comando non partito somiglia a un successo). `nvm use 22.15.0` è già attivo a livello di sistema. `docker`/`psql`/`git`/`curl` funzionano anche da Bash.
- **psql locale:** `docker exec -i pv-postgres psql -U pv -d passaggio_veloce` (container `pv-postgres`, user `pv`, db `passaggio_veloce`).
- **Typecheck warm obbligatorio ai confini Prisma:** dopo ogni task che tocca tipi Prisma eseguire `pnpm typecheck` (`tsc --noEmit`, cache calda). **vitest NON typecheck-a** — un test verde non prova la compilazione.
- **Design system:** nessun colore hardcodato; usare i token `pv-*` e i componenti/pattern già presenti nella pagina dashboard (`StatCard`, `ObiettivoBar`, `<section>` con `shadow-[var(--pv-shadow-card)]`).
- **Fatti di dominio verificati:** `Company.type` = enum `CompanyType { DEALER, AGENZIA }` → **DEALER = Broker**, **AGENZIA = Agenzie**. Tabelle Postgres: `companies`, `crm_contacts` (colonne camelCase quotate: `"deletedAt"`, `"companyId"`, `"type"`). Relazione su `Company`: `crmContactMatches CrmContact[] @relation("CrmContactCompany")`. `CrmContact.companyId` è valorizzato **solo** da `tryMatchCrmContact` (nessun form manuale) ⇒ "Company con contatto agganciato" ⟺ "era nella lista CRM".
- **Gate esistente:** la dashboard è protetta da `canViewCrmDashboard(session.user.role)` — riusarlo, nessuna nuova permission.
- **Rilascio:** commit su `main` + push (Vercel). Nessuna migration (feature di sola lettura).

---

### Task 1: Modulo `platform-stats.ts` (funzione pura + test + validazione DB reale)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/platform-stats.ts`
- Test: `apps/piattaforma/src/lib/crm/platform-stats.test.ts`

**Interfaces:**
- Consumes: `prisma` da `@pv/db`.
- Produces (usato dal Task 2):
  ```ts
  export type TipoRegistrati = { tot: number; daLista: number; organici: number };
  export type PlatformRegistrationStats = { broker: TipoRegistrati; agenzia: TipoRegistrati };
  export function getPlatformRegistrationStats(): Promise<PlatformRegistrationStats>;
  ```

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/platform-stats.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const groupBy = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: { company: { groupBy: (...a: unknown[]) => groupBy(...a) } },
}));

import { getPlatformRegistrationStats } from './platform-stats';

// La funzione fa due groupBy: totali (where senza relazione) e da-lista
// (where con crmContactMatches). Il mock distingue le due chiamate dal `where`,
// così il test non dipende dall'ordine di invocazione dentro Promise.all.
function mockGroupBy(
  totali: Array<{ type: string; n: number }>,
  daLista: Array<{ type: string; n: number }>,
) {
  groupBy.mockImplementation((args: { where?: { crmContactMatches?: unknown } }) => {
    const src = args.where?.crmContactMatches ? daLista : totali;
    return Promise.resolve(src.map((r) => ({ type: r.type, _count: { _all: r.n } })));
  });
}

describe('getPlatformRegistrationStats', () => {
  beforeEach(() => groupBy.mockReset());

  it('mappa DEALER→broker, AGENZIA→agenzia con split da-lista/organici', async () => {
    mockGroupBy(
      [{ type: 'DEALER', n: 5 }, { type: 'AGENZIA', n: 3 }],
      [{ type: 'DEALER', n: 2 }, { type: 'AGENZIA', n: 1 }],
    );
    const res = await getPlatformRegistrationStats();
    expect(res.broker).toEqual({ tot: 5, daLista: 2, organici: 3 });
    expect(res.agenzia).toEqual({ tot: 3, daLista: 1, organici: 2 });
  });

  it('tipo assente nei gruppi → zeri', async () => {
    mockGroupBy([{ type: 'DEALER', n: 4 }], []);
    const res = await getPlatformRegistrationStats();
    expect(res.broker).toEqual({ tot: 4, daLista: 0, organici: 4 });
    expect(res.agenzia).toEqual({ tot: 0, daLista: 0, organici: 0 });
  });

  it('organici mai negativo se da-lista > totale (guard difensivo)', async () => {
    mockGroupBy([{ type: 'DEALER', n: 1 }], [{ type: 'DEALER', n: 3 }]);
    const res = await getPlatformRegistrationStats();
    expect(res.broker.organici).toBe(0);
  });

  it('esegue esattamente due groupBy (totali + da-lista)', async () => {
    mockGroupBy([], []);
    await getPlatformRegistrationStats();
    expect(groupBy).toHaveBeenCalledTimes(2);
    const calls = groupBy.mock.calls.map((c) => c[0]);
    // uno senza filtro relazione, uno con crmContactMatches.some
    expect(calls.some((a) => !a.where?.crmContactMatches)).toBe(true);
    expect(calls.some((a) => a.where?.crmContactMatches?.some)).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run (PowerShell): `pnpm --filter piattaforma test src/lib/crm/platform-stats.test.ts`
Expected: FAIL — `Failed to resolve import "./platform-stats"` (il modulo non esiste ancora).

- [ ] **Step 3: Scrivi l'implementazione minima**

Crea `apps/piattaforma/src/lib/crm/platform-stats.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';

export type TipoRegistrati = { tot: number; daLista: number; organici: number };
export type PlatformRegistrationStats = {
  broker: TipoRegistrati; // Company.type = DEALER
  agenzia: TipoRegistrati; // Company.type = AGENZIA
};

/**
 * Conteggi informativi dei registrati sulla piattaforma per tipo, con split
 * "da lista CRM" (Company con almeno un CrmContact agganciato — relazione
 * `crmContactMatches`) vs "organici". NON è una metrica di conversione: è un
 * dato di contesto per la dashboard CRM.
 *
 * Due groupBy: totali (deletedAt: null) e da-lista (+ crmContactMatches.some).
 * organici = max(0, tot - daLista) — guard difensivo, matematicamente daLista
 * è un sottoinsieme dei totali.
 */
export async function getPlatformRegistrationStats(): Promise<PlatformRegistrationStats> {
  const [totali, daLista] = await Promise.all([
    prisma.company.groupBy({
      by: ['type'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.company.groupBy({
      by: ['type'],
      where: { deletedAt: null, crmContactMatches: { some: {} } },
      _count: { _all: true },
    }),
  ]);

  const countFor = (
    rows: Array<{ type: string; _count: { _all: number } }>,
    t: 'DEALER' | 'AGENZIA',
  ) => rows.find((r) => r.type === t)?._count._all ?? 0;

  const build = (t: 'DEALER' | 'AGENZIA'): TipoRegistrati => {
    const tot = countFor(totali, t);
    const dl = countFor(daLista, t);
    return { tot, daLista: dl, organici: Math.max(0, tot - dl) };
  };

  return { broker: build('DEALER'), agenzia: build('AGENZIA') };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run (PowerShell): `pnpm --filter piattaforma test src/lib/crm/platform-stats.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Typecheck warm (confine Prisma)**

Run (PowerShell): `pnpm typecheck` (dalla cartella app, oppure `pnpm --filter piattaforma typecheck`)
Expected: exit 0. In particolare deve accettare `crmContactMatches: { some: {} }` nel `where` di `groupBy` e la chiave `type` nel risultato — se `tsc` si lamenta del nome relazione o del tipo, correggere qui (è il confine tipizzato che vitest non vede).

- [ ] **Step 6: Validazione sul DB locale reale**

Convenzione progetto: le query nuove si provano in read-only sul postgres locale. Esegui (Bash o PowerShell):

```bash
docker exec -i pv-postgres psql -U pv -d passaggio_veloce -c "SELECT type, count(*) AS tot FROM companies WHERE \"deletedAt\" IS NULL GROUP BY type ORDER BY type;"
docker exec -i pv-postgres psql -U pv -d passaggio_veloce -c "SELECT c.type, count(*) AS da_lista FROM companies c WHERE c.\"deletedAt\" IS NULL AND EXISTS (SELECT 1 FROM crm_contacts cc WHERE cc.\"companyId\" = c.id) GROUP BY c.type ORDER BY c.type;"
```

Expected: due tabelline `type | count`. Verifica di coerenza: per ogni `type`, `da_lista <= tot`. Questi numeri sono quelli che la funzione deve riprodurre (il primo SELECT = `tot`, il secondo = `daLista`; `organici = tot - da_lista`). Annota i valori: serviranno da oracolo per la verifica browser del Task 2.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/crm/platform-stats.ts apps/piattaforma/src/lib/crm/platform-stats.test.ts
git commit -m "feat(crm): getPlatformRegistrationStats — registrati piattaforma per tipo con split da-lista/organici"
```

---

### Task 2: Sezione "Registrati sulla piattaforma" nella dashboard CRM

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getPlatformRegistrationStats` + tipo `PlatformRegistrationStats` dal Task 1; il componente `ObiettivoBar` **già presente** nello stesso file (riuso, non ridefinire).
- Produces: nessuna (foglia UI).

- [ ] **Step 1: Importa la funzione del Task 1**

In `apps/piattaforma/src/app/admin/crm/dashboard/page.tsx`, dopo l'import di `RendimentoChart` (riga ~11) aggiungi:

```ts
import { getPlatformRegistrationStats } from '@/lib/crm/platform-stats';
```

- [ ] **Step 2: Aggiungi la chiamata al `Promise.all` esistente**

Nel blocco `const [ … ] = await Promise.all([ … ])` che comincia a ~riga 69:
1. aggiungi `platformStats,` in coda alla lista di destructuring (dopo `contactsLast6m,`);
2. aggiungi `getPlatformRegistrationStats(),` in coda all'array di Promise (dopo la `prisma.crmContact.findMany({ … })` che produce `contactsLast6m`).

Risultato (estratto):

```ts
  const [
    totaleContatti,
    iscrittiAttivi,
    inConversione,
    linkAperti,
    salesAgentCount,
    campagneAttive,
    contactsByStato,
    contactsByStatoCat,
    contactsLast6m,
    platformStats,
  ] = await Promise.all([
    // …tutte le Promise esistenti invariate…
    prisma.crmContact.findMany({
      where: { deletedAt: null, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
    getPlatformRegistrationStats(),
  ]);
```

- [ ] **Step 3: Rendi la nuova sezione**

Subito **dopo** la `</section>` delle stat-card del funnel (quella che contiene `StatCard`, chiude a ~riga 264) e **prima** della sezione `{/* Raggiungimento obiettivo … */}` (~riga 266), inserisci:

```tsx
        {/* Registrati sulla piattaforma — dato informativo, NON metriche funnel */}
        <section className="mt-6 rounded-[12px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
          <h2 className="text-[14px] font-bold text-pv-navy-900">
            Registrati sulla piattaforma
          </h2>
          <p className="text-[11.5px] text-pv-slate-500">
            Dato informativo — non incide sulle metriche di conversione del funnel.
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <RegistratiBlock
              titolo="Broker"
              d={platformStats.broker}
              dot="bg-blue-500"
              bar="bg-blue-500"
            />
            <RegistratiBlock
              titolo="Agenzie"
              d={platformStats.agenzia}
              dot="bg-pv-orange-500"
              bar="bg-pv-orange-500"
            />
          </div>
        </section>
```

- [ ] **Step 4: Aggiungi il componente presentazionale `RegistratiBlock`**

In fondo al file, accanto agli altri helper (`StatCard`, `FinanceCard`, `ObiettivoBar`), aggiungi:

```tsx
function RegistratiBlock({
  titolo,
  d,
  dot,
  bar,
}: {
  titolo: string;
  d: { tot: number; daLista: number; organici: number };
  dot: string;
  bar: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[12.5px] font-bold text-pv-navy-900">
        <span className={'h-2 w-2 rounded-full ' + dot} />
        {titolo}
        <span className="ml-auto text-[18px] font-extrabold tracking-tight text-pv-navy-900">
          {d.tot.toLocaleString('it-IT')}
        </span>
      </p>
      <div className="mt-3 space-y-3">
        <ObiettivoBar label="Da lista CRM" value={d.daLista} tot={d.tot} barClass={bar} />
        <ObiettivoBar
          label="Organici / passaparola"
          value={d.organici}
          tot={d.tot}
          barClass={bar}
        />
      </div>
    </div>
  );
}
```

(`ObiettivoBar` è già definito nel file: mostra `value/tot · pct%` con mini-barra — riuso DRY.)

- [ ] **Step 5: Typecheck warm + lint**

Run (PowerShell):
```
pnpm typecheck
pnpm eslint src/app/admin/crm/dashboard/page.tsx src/lib/crm/platform-stats.ts
```
Expected: `tsc` exit 0; eslint 0 errori. In particolare `platformStats.broker/agenzia` devono tipizzare come `TipoRegistrati`.

- [ ] **Step 6: Verifica browser (gesto reale) sulla dashboard**

Avvia il dev (`pnpm dev` da PowerShell in background), fai login come **admin di test** sul DB locale (vedi memoria `project_dev_credentials`), apri `http://localhost:3000/admin/crm/dashboard`. Verifica:
- compare la sezione **"Registrati sulla piattaforma"** sotto le card del funnel;
- **Broker** e **Agenzie** mostrano `tot`, `Da lista CRM` e `Organici` **coincidenti con l'oracolo del Task 1 Step 6** (`tot` dal primo SELECT, `daLista` dal secondo, `organici = tot − daLista`);
- il gate resta rispettato (utente senza `canViewCrmDashboard` vede l'alert "Sezione riservata", non i numeri).

Se il login admin sul DB copia-prod non è praticabile senza interventi distruttivi, documentarlo esplicitamente e usare come prova compensativa: `tsc`/lint verdi + Task 1 provato sul DB reale + la sezione riusa `ObiettivoBar` e il pattern `<section>` già funzionanti nella stessa pagina. **Non dichiarare "verificato nel browser" se non lo è.**

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/dashboard/page.tsx
git commit -m "feat(crm): sezione 'Registrati sulla piattaforma' nella dashboard (split da-lista/organici)"
```

---

## Note finali

- **Nessuna migration.** Feature di sola lettura su modelli esistenti.
- **#2 (riconciliazione auto-registrazioni) è fuori scope:** già implementata e live in `lib/crm/sync.ts` (vedi spec §"Cosa NON facciamo"). Non toccarla.
- Deploy: dopo l'approvazione, commit già su `main`; push a discrezione dell'utente (processo standard Vercel).
