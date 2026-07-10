# Sezione Addebiti — nascondi riepiloghi/prossimi-addebiti + filtro date sullo storico

**Data:** 2026-07-10
**Pagine:** `apps/piattaforma/src/app/addebiti/page.tsx`, `apps/piattaforma/src/app/dashboard/agenzia-dashboard.tsx`

## Obiettivo

Tre modifiche alla sezione addebiti (lato agenzia):

1. **Card "Prossimi addebiti" non più visibile** (tutto è istantaneo "in teoria"). È una card sulla dashboard agenzia.
2. **Nascondere i blocchi di riepilogo** su `/addebiti`: non mostrare all'agenzia quanto ha speso — via le 3 `StatCard` in alto **e** i subtotali € per mese nello storico. Resta solo la lista con l'importo del singolo addebito (i calcoli aggregati se li fa l'agenzia).
3. **Storico non vincolato al mese + filtro per range di date**: lo storico già mostra tutto (nessun limite temporale nel codice attuale); il deliverable concreto è un **filtro range date** su `/addebiti`.

## Decisioni (confermate con l'utente)

- **Reversibilità:** item 1 e 2 si realizzano **commentando** i blocchi con un **marker** (pattern già usato nel repo, es. `// LISTINI DISABILITATI (feature nascosta 2026-06-12) — riattivare…`), non cancellando. Marker: `ADDEBITI … DISABILITATO 2026-07-10 — riattivare`.
- **Item 2 scope:** si tolgono sia le 3 `StatCard` sia il subtotale € per mese. Resta l'importo del singolo addebito nella lista.
- **Item 3 layout:** si mantiene la suddivisione per mese come **sola intestazione** (senza totale); si aggiunge il filtro date.
- **DRY:** la conversione giorno→UTC in fuso Europe/Rome (con DST), oggi dentro `feedback/query.ts`, si **estrae** in un helper condiviso e viene riusata da feedback (già in prod su main) e addebiti. Fonte unica per la parte timezone delicata.

## Contesto attuale

- `agenzia-dashboard.tsx`: la card "Prossimi addebiti" (righe ~197-230) è gated `canAddebitiView && prossimiAddebiti.length > 0`. La query (`prossimiAddebiti`) è nel `Promise.all` (righe ~63-70): `feeAddebito` con `stato:'SCHEDULED'`, take 3. `canAddebitiView` (Promise.all righe ~11-16) e gli import `computeGiorniResidui`/`countdownLevel` (riga 5) sono usati **solo** da questa card.
- `addebiti/page.tsx`: fetch di **tutte** le fee (`whereFeeAddebito(toSedeScope(ctx), companyId)`, nessun `take`, nessun filtro data), map a `StoricoRow` con `refDate = scheduledAt ?? createdAt`, `groupFeeByMonth` (raggruppa tutto per mese, ordina desc, somma `totaleCent`). Render: 3 `StatCard` (anno/anno/mese), poi "Storico per mese" con per ogni gruppo header `{mese} — {totaleCent}` e lista righe con importo. `now`, `rowsAnno`, `totaleAnno`, `countAnno`, `totaleMese`, e l'import `StatCard` servono solo al riepilogo.
- `lib/fee/recap.ts` (`groupFeeByMonth`) resta invariato: continua a calcolare `totaleCent`, semplicemente non lo mostriamo.
- Pattern filtro date di riferimento: `feedback/filters.tsx` + query param `?da=&a=` (già in prod).

## Architettura

### Nuovo: `lib/date/rome-day.ts` (puro, condiviso)

Estrae la logica timezone da `feedback/query.ts` (parsing `YYYY-MM-DD`, offset Europe/Rome via `Intl.DateTimeFormat`, doppio-passaggio DST, ms fuori dal calcolo dell'offset).

```ts
export function parseYmd(value: string | undefined): [number, number, number] | null;
export function romeStartOfDay(ymd: [number, number, number]): Date;
export function romeEndOfDay(ymd: [number, number, number]): Date;
export type DayRange = { gte?: Date; lte?: Date; da: string; a: string; active: boolean };
/** Da due giorni YYYY-MM-DD ai bound UTC (start/end giornata in Europe/Rome). Bound malformato → ignorato. */
export function resolveDayRange(da: string | undefined, a: string | undefined): DayRange;
```

`resolveDayRange`: `gte = start del giorno da` (se valido), `lte = end del giorno a` (se valido); `da`/`a` ri-emessi solo se validi (o `''`); `active = Boolean(daYmd || aYmd)`.

Test `lib/date/rome-day.test.ts` (unit): estivo (+2), invernale (+1), spring-forward 2026-03-29, fall-back 2026-10-25, solo-`da`/solo-`a`, malformato/impossibile, `resolveDayRange` end-to-end.

### Refactor: `feedback/query.ts`

Rimuove le funzioni tz locali e delega a `resolveDayRange`. Comportamento invariato → i 12 test esistenti (`query.test.ts`) restano la guardia di regressione, immutati.

```ts
import { resolveDayRange } from '@/lib/date/rome-day';
// ... dentro resolveFeedbackFilters, al posto del blocco date attuale:
const range = resolveDayRange(params.da, params.a);
const createdAt: { gte?: Date; lte?: Date } = {};
if (range.gte) createdAt.gte = range.gte;
if (range.lte) createdAt.lte = range.lte;
if (range.gte || range.lte) where.createdAt = createdAt;
return { where, sede, da: range.da, a: range.a, attivi: Boolean(sede) || range.active };
```

### Nuovo: `lib/fee/date-filter.ts` (puro)

Costruisce il where del range date sul `refDate` degli addebiti (= `scheduledAt ?? createdAt`), coerente col campo mostrato/raggruppato.

```ts
import type { Prisma } from '@pv/db';
/** Filtro su refDate (scheduledAt, o createdAt se scheduledAt è null). null se range vuoto. */
export function feeRefDateWhere(range: { gte?: Date; lte?: Date }): Prisma.FeeAddebitoWhereInput | null {
  if (!range.gte && !range.lte) return null;
  const bound: { gte?: Date; lte?: Date } = {};
  if (range.gte) bound.gte = range.gte;
  if (range.lte) bound.lte = range.lte;
  return { OR: [{ scheduledAt: bound }, { AND: [{ scheduledAt: null }, { createdAt: bound }] }] };
}
```

Test `lib/fee/date-filter.test.ts`: range vuoto → `null`; solo `gte`; solo `lte`; `gte`+`lte` → struttura OR corretta.

### Nuovo: `addebiti/filters.tsx` (client)

Form GET Da/A, apply `onChange` via `requestSubmit()`, `action="/addebiti"`, niente bottone submit (come `feedback/filters.tsx` / `admin/pratiche/filters.tsx`). Solo due input date (nessun select sede: qui lo scoping resta quello globale). `GlobalNavOverlay` copre il caricamento.

### Modifica: `addebiti/page.tsx`

- Firma `searchParams: Promise<{ da?: string; a?: string }>`.
- `const range = resolveDayRange(sp.da, sp.a); const dateWhere = feeRefDateWhere(range);`
- `const base = whereFeeAddebito(toSedeScope(ctx), companyId); const where = dateWhere ? { AND: [base, dateWhere] } : base;`
- `findMany` invariato per il resto; map a rows + `groupFeeByMonth` invariati.
- **Commentare (marker)** le 3 `StatCard` (blocco `page.tsx:112-116`), il subtotale `{formatCurrencyCent(g.totaleCent)}` (`page.tsx:128`), e le aggregazioni ora inutili (`now`, `rowsAnno`, `totaleAnno`, `countAnno`, `totaleMese`) + import `StatCard`. `formatCurrencyCent` resta (importo per riga). `formatDate`, `groupFeeByMonth` restano.
- Rendere `<AddebitiFilters da={range.da} a={range.a} />` sotto l'header.
- Empty-state: `range.active ? 'Nessun addebito nel periodo selezionato.' : 'Nessun addebito registrato.'`

### Modifica: `agenzia-dashboard.tsx` (item 1)

Commentare con marker, mantenendo il lint verde:
- Il blocco render `<section>` "Prossimi addebiti" (`~197-230`).
- L'elemento `prossimiAddebiti` del `Promise.all` (`~61-70`) e il nome destrutturato `prossimiAddebiti` (`~18`).
- L'import `computeGiorniResidui, countdownLevel` (`riga 5`).
- `canAddebitiView` diventa inutilizzato: rimuoverlo dalla destrutturazione (`~11`) e commentare `hasPermesso('addebiti.view')` nel relativo `Promise.all`, mantenendo l'allineamento posizionale nomi↔promesse (`canInboxView, canPraticheView, canFeedbackView` ↔ 3 promesse).

## Edge cases

- **`refDate` = `scheduledAt ?? createdAt`**: il filtro DB replica esattamente questa scelta con la clausola `OR` (righe con `scheduledAt` valorizzato filtrate su `scheduledAt`; righe con `scheduledAt` null filtrate su `createdAt`).
- **Date malformate / impossibili** (`da`/`a`): il bound viene ignorato (`resolveDayRange` → `parseYmd` null).
- **`da > a`**: nessun risultato (legittimo), niente errore.
- **Nessun filtro**: comportamento identico a oggi (tutto lo storico).
- **Timezone**: giorni interpretati in Europe/Rome (stesso helper, stessi test DST del feedback).
- **Lint dopo i commenti**: nessun import/variabile inutilizzato deve restare (dashboard e page).

## Testing

- Unit: `rome-day.test.ts` (tz/DST + `resolveDayRange`), `date-filter.test.ts` (`feeRefDateWhere`).
- Regressione: `feedback/query.test.ts` (12 casi) resta verde dopo il refactor → prova che l'estrazione non cambia il comportamento.
- Full suite `pnpm --filter piattaforma test` verde; lint 0; typecheck ok.
- Verifica sul DB locale (read-only) che esistano `fee_addebiti` per un'agenzia con `scheduledAt` valorizzato e/o null, per esercitare entrambi i rami del filtro `refDate`.
- Smoke a fine fase: dashboard senza card "Prossimi addebiti"; `/addebiti` senza StatCard né subtotali, con filtro Da/A che restringe la lista; storico completo senza filtro.

## Fuori scope (YAGNI)

- Paginazione, export CSV, filtro per stato/importo.
- Modifiche a `recap.ts` o alla logica dei pagamenti (istantaneità): solo UI/lettura.
- Componente filtro-date condiviso tra feedback e addebiti (il markup dei due input è minimo; la parte condivisa preziosa — timezone — è già estratta in `rome-day.ts`).
- Filtro sede sulla pagina addebiti (non richiesto; lo scoping resta quello globale via `toSedeScope`).
