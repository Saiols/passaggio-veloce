# Tabella lista pratiche: allineamento + colonna/filtro Sede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far combaciare le colonne della lista pratiche con la loro intestazione per ogni utenza, e aggiungere una colonna "Sede" (la filiale dell'agenzia assegnataria) filtrabile, nascosta a chi vede una sola sede.

**Architecture:** Le righe della tabella sono `<div>` block-level, non `<tr>` (scelta deliberata: iOS Safari non onora `position: relative` dentro le tabelle e rompe lo stretched-link della riga). Header e righe sono quindi griglie CSS **distinte**: oggi usano tracce `minmax(…, auto)`, che si dimensionano sul contenuto di ciascuna griglia, e non possono allinearsi. Le sostituiamo con tracce deterministiche (larghezze `rem` fisse + `minmax(0,1fr)` con `truncate`), centralizzate in un modulo condiviso. Sopra questa base innestiamo la colonna Sede, la cui visibilità e il cui filtro vivono in un modulo di logica pura, testato.

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma + Postgres, Tailwind CSS v4, vitest.

**Spec di riferimento:** `docs/superpowers/specs/2026-07-09-tabella-pratiche-sede-design.md`

## Global Constraints

- **Node**: `nvm use 22.15.0` prima di qualunque comando `pnpm` — dopo un riavvio la shell torna a una versione senza `node` sul PATH.
- **Le righe restano block-level.** Non convertire in `<table>`/`<tr>`/`<td>`: rompe lo stretched-link su iOS Safari (bug documentato nei commenti del codice).
- **Tailwind v4 non risolve nomi di classe costruiti a runtime.** Ogni classe (`lg:grid-cols-[…]`, `sm:grid-cols-[1fr_auto_auto]`) deve comparire come stringa letterale intera nel sorgente.
- **Numero di tracce = numero di celle visibili a quel breakpoint.** Le celle nascoste hanno `display:none` e non occupano traccia.
- **Nessun colore hardcoded**: solo token `pv-*` del design system.
- **Scoping sede**: il filtro restringe, non sostituisce. Mai `session.user.companyId` nudo in un `where`. Un `?sede=<uuid altrui>` deve produrre lista vuota.
- **Commit** in italiano, conventional commits, con trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`pnpm typecheck` a cache fredda è inaffidabile** (stack overflow / falsi errori Prisma). Se esplode con errori assurdi sui tipi Prisma è la cache, non la modifica.
- **Branch**: si continua su `feat/segnala-problema-creazione`, dove è già atterrata la spec (commit `6464e6e`). Questo lavoro è indipendente dalle segnalazioni: se preferisci un branch dedicato, va creato prima della Task 1.

## File Structure

Nuovi:

| File | Responsabilità |
|---|---|
| `apps/piattaforma/src/lib/pratiche/table-grid.ts` | Le stringhe di classe delle tre varianti di griglia. Nient'altro. |
| `apps/piattaforma/src/lib/pratiche/table-grid.test.ts` | Blinda l'invariante tracce/colonne e l'assenza di `auto`. |
| `apps/piattaforma/src/lib/pratiche/colonna-sede.ts` | Visibilità colonna e traduzione di `?sede=` in vincolo. Logica pura, niente IO. |
| `apps/piattaforma/src/lib/pratiche/colonna-sede.test.ts` | Test della logica pura, incluso il fail-closed. |
| `apps/piattaforma/src/lib/pratiche/opzioni-sede.ts` | Le tre query che producono le opzioni della select. Server-only. |
| `apps/piattaforma/src/components/sede/sede-cell.tsx` | Cella nome sede + città. |

Modificati:

| File | Modifica |
|---|---|
| `apps/piattaforma/src/app/pratiche/page.tsx` | griglia, densità, overflow, colonna Sede, filtro, paginazione |
| `apps/piattaforma/src/app/pratiche/filters.tsx` | select Sede |
| `apps/piattaforma/src/app/admin/pratiche/page.tsx` | griglia, densità, overflow, colonna Sede, filtro |
| `apps/piattaforma/src/app/admin/pratiche/filters.tsx` | select Sede |

Nessuna migration: `Pratica.agenziaSedeId` e la relazione `agenziaSede` esistono già, con indice.

---

### Task 1: Tracce deterministiche e allineamento

Il fix del bug, senza toccare la colonna Sede. Alla fine di questa task le colonne combaciano con l'intestazione in entrambe le pagine.

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/table-grid.ts`
- Test: `apps/piattaforma/src/lib/pratiche/table-grid.test.ts`
- Modify: `apps/piattaforma/src/app/pratiche/page.tsx` (rimuove `GRID_COLS` locale, righe 25-29)
- Modify: `apps/piattaforma/src/app/admin/pratiche/page.tsx` (rimuove `GRID_COLS` locale, righe 44-47)

**Interfaces:**
- Produces: `PRATICHE_GRID.utenteSenzaSede`, `PRATICHE_GRID.utenteConSede`, `PRATICHE_GRID.admin` (stringhe di classe); `PRATICHE_TABLE_MIN_W` (stringa `min-w-[29rem]`).

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/pratiche/table-grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PRATICHE_GRID } from './table-grid';

/**
 * Estrae, per ogni breakpoint dichiarato nella stringa di classe, quante tracce
 * definisce. `minmax(0,1fr)` non contiene underscore, quindi lo split è sicuro.
 */
function traccePerBreakpoint(cls: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const token of cls.split(/\s+/).filter(Boolean)) {
    const m = /^(?:(sm|md|lg):)?grid-cols-\[(.+)\]$/.exec(token);
    if (!m) throw new Error(`token non riconosciuto: ${token}`);
    out[m[1] ?? 'base'] = m[2].split('_').length;
  }
  return out;
}

describe('PRATICHE_GRID — le tracce combaciano con le celle visibili', () => {
  it('utenteSenzaSede: 4 → +proprietario → +controparte → +fee', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.utenteSenzaSede)).toEqual({
      base: 4,
      sm: 5,
      md: 6,
      lg: 7,
    });
  });

  it('utenteConSede: come utenteSenzaSede, con una traccia in più su lg', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.utenteConSede)).toEqual({
      base: 4,
      sm: 5,
      md: 6,
      lg: 8,
    });
  });

  it('admin: nessuna colonna nuova su sm, broker+agenzia da md, fee da lg', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.admin)).toEqual({
      base: 4,
      sm: 4,
      md: 6,
      lg: 7,
    });
  });
});

describe('PRATICHE_GRID — nessuna traccia dipende dal contenuto', () => {
  // È la causa originale del disallineamento: con `auto` ogni riga si dimensiona
  // sul proprio contenuto e non combacia né con l'header né con le altre righe.
  it.each(Object.entries(PRATICHE_GRID))('%s non usa `auto`', (_nome, cls) => {
    expect(cls).not.toMatch(/auto/);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
nvm use 22.15.0
pnpm --filter piattaforma exec vitest run src/lib/pratiche/table-grid.test.ts
```

Atteso: FAIL — `Failed to resolve import "./table-grid"`.

- [ ] **Step 3: Crea il modulo**

Crea `apps/piattaforma/src/lib/pratiche/table-grid.ts`:

```ts
/**
 * Tracce della griglia della lista pratiche (header + righe).
 *
 * Header e righe NON sono la stessa griglia CSS: la classe viene applicata al
 * contenitore dell'header e poi a ogni singola riga (le righe devono restare
 * block-level, perché iOS Safari non onora `position: relative` dentro le
 * tabelle e lo stretched-link della riga si rompe). Di conseguenza una traccia
 * `auto` si dimensiona sul contenuto della PROPRIA griglia: la riga col
 * pulsante azione allarga "Stato", l'header no, e le colonne non combaciano.
 *
 * Qui nessuna traccia dipende dal contenuto: griglie di uguale larghezza
 * calcolano per forza le stesse colonne. Le celle testuali compensano con
 * `min-w-0 truncate`; la cella "Stato" con `flex-wrap`, così il pulsante azione
 * va a capo invece di allargare la traccia.
 *
 * Il numero di tracce per breakpoint deve combaciare con le celle VISIBILI a
 * quel breakpoint: le celle nascoste hanno `display:none` e non occupano
 * traccia. `table-grid.test.ts` blinda l'invariante.
 *
 * Le stringhe sono letterali per intero: Tailwind non risolve nomi di classe
 * costruiti a runtime.
 */
export const PRATICHE_GRID = {
  /** Codice · Targa · Proprietario(sm) · Controparte(md) · Stato · Fee(lg) · Quando */
  utenteSenzaSede:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',

  /** Come sopra, con Sede(lg) fra Controparte e Stato. */
  utenteConSede:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',

  /** Codice · Targa · Broker(md) · Agenzia(md) · Stato · Fee(lg) · Quando */
  admin:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',
} as const;

/**
 * Larghezza minima del contenuto della tabella: sotto questa soglia il
 * contenitore scorre in orizzontale invece di tagliare le colonne in silenzio.
 *
 * Somma delle tracce fisse del breakpoint base (8.5 + 7.5 + 6.5 = 22.5rem) più
 * lo spazio che la targa deve avere per non venire troncata (~6.5rem). Se
 * cambi le larghezze base, ricalcola questo valore: se resta troppo basso la
 * colonna targa si schiaccia invece di far scorrere la tabella.
 */
export const PRATICHE_TABLE_MIN_W = 'min-w-[29rem]';
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/pratiche/table-grid.test.ts
```

Atteso: PASS, 6 test (3 conteggi + 3 `it.each` su `auto`).

- [ ] **Step 5: Applica la griglia a `/pratiche`**

In `apps/piattaforma/src/app/pratiche/page.tsx`:

Cancella il blocco `const GRID_COLS = …` con il suo commento (righe 18-29) e aggiungi l'import accanto agli altri:

```ts
import { PRATICHE_GRID, PRATICHE_TABLE_MIN_W } from '@/lib/pratiche/table-grid';
```

Subito dopo `const companyId = session.user.companyId;` aggiungi:

```ts
const isAgenzia = companyType === 'AGENZIA';
```

Sostituisci l'intero blocco della tabella (dal `<div className="overflow-hidden rounded-[16px] …">` fino alla sua chiusura) con:

```tsx
        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {items.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica trovata.</p>
              {!isAgenzia && (
                <Link href="/pratiche/nuova" className="mt-3 inline-block">
                  <Button size="sm">Crea la prima</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={`${PRATICHE_TABLE_MIN_W} text-[13px]`}>
                <div
                  className={`grid ${PRATICHE_GRID.utenteSenzaSede} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="hidden px-3 py-3 sm:block">Proprietario</div>
                  <div className="hidden px-3 py-3 md:block">
                    {isAgenzia ? 'Broker' : 'Agenzia'}
                  </div>
                  <div className="px-3 py-3">Stato</div>
                  <div className="hidden px-3 py-3 lg:block">Fee</div>
                  <div className="py-3 pl-3 pr-5 text-right">Quando</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {items.map((p) => {
                    const extra = statoExtra({
                      stato: p.stato as PraticaStato,
                      flagSegnalata: p.flagSegnalata,
                      segnalazioneStato: p.segnalazioneStato,
                      tipoSegnalazione: p.tipoSegnalazione,
                      notaSegnalazione: p.notaSegnalazione,
                      penaleAddebitatoCent: p.penaleAddebitatoCent,
                      revisioneCompletata: p.revisioneCompletata,
                      richiedeRevisioneManuale: p.richiedeRevisioneManuale,
                    });
                    return (
                      <div
                        key={p.id}
                        className={`relative grid ${PRATICHE_GRID.utenteSenzaSede} items-center transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50`}
                      >
                        {/* Anchor a tutta riga: block-level parent → containing block
                            affidabile su ogni browser (fix iOS). Resta un vero <a>,
                            quindi overlay di navigazione, apri-in-nuova-scheda e
                            focus da tastiera continuano a funzionare. */}
                        <Link
                          href={`/pratiche/${p.id}`}
                          aria-label={`Apri pratica ${p.codicePratica ?? 'in bozza'}`}
                          className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
                        />
                        <div className="min-w-0 truncate py-3 pl-5 pr-3 font-mono font-semibold text-pv-navy-800">
                          {p.codicePratica ?? 'BOZZA'}
                        </div>
                        <div className="min-w-0 truncate px-3 py-3 font-semibold text-pv-slate-900">
                          {p.veicoli[0]?.targa
                            ? p.veicoli.length > 1
                              ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                              : p.veicoli[0].targa
                            : '—'}
                        </div>
                        <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 sm:block">
                          {p.veicoli[0]?.proprietarioAttuale ?? '—'}
                        </div>
                        <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 md:block">
                          {isAgenzia
                            ? p.broker.ragioneSociale
                            : p.agenziaAssegnata?.ragioneSociale ?? '—'}
                        </div>
                        <div className="min-w-0 px-3 py-3">
                          {/* z-10 per stare SOPRA lo stretched-link: chip, info e i
                              pulsanti azione restano cliccabili senza navigare.
                              flex-wrap: il pulsante va a capo invece di allargare
                              la traccia e disallineare la colonna. */}
                          <span className="relative z-10 inline-flex flex-wrap items-center gap-2">
                            <StatusChip
                              stato={p.stato as PraticaStato}
                              tone={extra?.kind === 'ANNULLATA_TEAM' ? 'danger' : undefined}
                              viewerRole={isAgenzia ? 'AGENZIA' : 'BROKER'}
                            />
                            <StatoExtraInfo extra={extra} />
                            {isAgenzia &&
                              p.agenziaAssegnataId === companyId &&
                              p.stato === 'ACCETTATA' && (
                                <QuickActionButton praticaId={p.id} action="processata" />
                              )}
                            {isAgenzia &&
                              p.agenziaAssegnataId === companyId &&
                              p.stato === 'PROCESSATA' && (
                                <QuickActionButton praticaId={p.id} action="firma" />
                              )}
                          </span>
                        </div>
                        <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 lg:block">
                          {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                        </div>
                        <div className="min-w-0 truncate py-3 pl-3 pr-5 text-right text-pv-slate-500">
                          {formatRelative(p.submittedAt ?? p.createdAt)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
```

Sostituisci anche le altre due occorrenze di `companyType === 'AGENZIA'` / `companyType !== 'AGENZIA'` nell'header della pagina con `isAgenzia` / `!isAgenzia`.

- [ ] **Step 6: Applica la griglia a `/admin/pratiche`**

In `apps/piattaforma/src/app/admin/pratiche/page.tsx`, cancella il blocco `const GRID_COLS = …` con il suo commento (righe 40-47) e aggiungi:

```ts
import { PRATICHE_GRID, PRATICHE_TABLE_MIN_W } from '@/lib/pratiche/table-grid';
```

Sostituisci il blocco della tabella con:

```tsx
        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {sorted.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica trovata.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={`${PRATICHE_TABLE_MIN_W} text-[13px]`}>
                <div
                  className={`grid ${PRATICHE_GRID.admin} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="hidden px-3 py-3 md:block">Broker</div>
                  <div className="hidden px-3 py-3 md:block">Agenzia</div>
                  <div className="px-3 py-3">Stato</div>
                  <div className="hidden px-3 py-3 lg:block">Fee</div>
                  <div className="py-3 pl-3 pr-5 text-right">Quando</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {sorted.map((p) => (
                    <div
                      key={p.id}
                      className={`relative grid ${PRATICHE_GRID.admin} items-center transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50`}
                    >
                      {/* Anchor a tutta riga su parent block-level: containing
                          block affidabile su iOS Safari (fix tap/landscape). */}
                      <Link
                        href={`/pratiche/${p.id}`}
                        aria-label={`Apri pratica ${p.codicePratica ?? 'in bozza'}`}
                        className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
                      />
                      <div className="min-w-0 truncate py-3 pl-5 pr-3 font-mono font-semibold text-pv-navy-800">
                        {p.codicePratica ?? 'BOZZA'}
                      </div>
                      <div className="min-w-0 truncate px-3 py-3">
                        {p.veicoli[0]?.targa
                          ? p.veicoli.length > 1
                            ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                            : p.veicoli[0].targa
                          : '—'}
                      </div>
                      <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 md:block">
                        {p.broker.ragioneSociale}
                      </div>
                      <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 md:block">
                        {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                      </div>
                      <div className="min-w-0 px-3 py-3">
                        <span className="relative z-10 inline-flex flex-wrap items-center gap-2">
                          <StatusChip stato={p.stato as PraticaStato} />
                        </span>
                      </div>
                      <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 lg:block">
                        {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                      </div>
                      <div className="min-w-0 truncate py-3 pl-3 pr-5 text-right text-pv-slate-500">
                        {formatRelative(p.submittedAt ?? p.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
```

- [ ] **Step 7: Verifica a video**

```bash
pnpm --filter piattaforma dev
```

Apri `/pratiche` come agenzia con almeno una pratica in `ACCETTATA` o `PROCESSATA` (quella col pulsante azione: è la riga che oggi sfonda la colonna Stato). Restringi la finestra attraverso i breakpoint 640 / 768 / 1024 px e controlla che ogni cella resti sotto la propria intestazione. Ripeti su `/pratiche` come broker e su `/admin/pratiche`.

Verifica anche che il click sulla riga apra la pratica, e che il click su chip, icona info e pulsante azione **non** navighi.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/table-grid.ts apps/piattaforma/src/lib/pratiche/table-grid.test.ts apps/piattaforma/src/app/pratiche/page.tsx apps/piattaforma/src/app/admin/pratiche/page.tsx
git commit -m "$(cat <<'EOF'
fix(pratiche): allinea le colonne della lista con l'intestazione

Header e righe sono griglie CSS distinte (le righe devono restare block-level
per lo stretched-link su iOS). Con tracce minmax(...,auto) ognuna si dimensiona
sul proprio contenuto: la riga col pulsante azione allargava "Stato" a ~15rem,
l'header la teneva a 7rem. Tracce ora deterministiche, centralizzate in
lib/pratiche/table-grid.ts e blindate da un test sul conteggio.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Logica pura della colonna Sede

Visibilità della colonna e traduzione del parametro `?sede=`. Nessuna UI, nessun IO.

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/colonna-sede.ts`
- Test: `apps/piattaforma/src/lib/pratiche/colonna-sede.test.ts`

**Interfaces:**
- Produces:
  - `SEDE_NON_ASSEGNATA: 'nessuna'`
  - `mostraColonnaSede(args: { companyType: string | undefined; scopeIds: string[] }): boolean`
  - `type FiltroSede = { tipo: 'nessuno' } | { tipo: 'sede'; sedeIds: string[] } | { tipo: 'nonAssegnata' }`
  - `filtroSede(args: { selezione: string | undefined; opzioniIds: string[]; scopeIds: string[] | null; consentiNonAssegnata: boolean }): FiltroSede`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/pratiche/colonna-sede.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mostraColonnaSede, filtroSede, SEDE_NON_ASSEGNATA } from './colonna-sede';

describe('mostraColonnaSede', () => {
  it('broker: sempre — le sedi agenzia variano riga per riga', () => {
    expect(mostraColonnaSede({ companyType: 'DEALER', scopeIds: ['s1'] })).toBe(true);
    expect(mostraColonnaSede({ companyType: 'DEALER', scopeIds: ['s1', 's2'] })).toBe(true);
  });

  it('agenzia con più sedi in vista aggregata: sì', () => {
    expect(mostraColonnaSede({ companyType: 'AGENZIA', scopeIds: ['s1', 's2'] })).toBe(true);
  });

  it('agenzia su una sola sede (admin di sede, operatore, owner mono-sede): no', () => {
    expect(mostraColonnaSede({ companyType: 'AGENZIA', scopeIds: ['s1'] })).toBe(false);
  });

  it('agenzia senza sedi accessibili: no', () => {
    expect(mostraColonnaSede({ companyType: 'AGENZIA', scopeIds: [] })).toBe(false);
  });
});

describe('filtroSede — selezione assente o non ammessa', () => {
  const base = { opzioniIds: ['s1'], scopeIds: null, consentiNonAssegnata: true };

  it('nessuna selezione → nessun filtro', () => {
    expect(filtroSede({ ...base, selezione: undefined })).toEqual({ tipo: 'nessuno' });
    expect(filtroSede({ ...base, selezione: '' })).toEqual({ tipo: 'nessuno' });
  });

  it('id fuori dalle opzioni ammesse → ignorato, non applicato alla cieca', () => {
    expect(filtroSede({ ...base, selezione: 'sede-di-un-altra-azienda' })).toEqual({
      tipo: 'nessuno',
    });
  });
});

describe('filtroSede — broker e admin (nessuno scope sede sulle pratiche)', () => {
  const base = { opzioniIds: ['s1', 's2'], scopeIds: null, consentiNonAssegnata: true };

  it('id ammesso → filtra su quella sede', () => {
    expect(filtroSede({ ...base, selezione: 's2' })).toEqual({ tipo: 'sede', sedeIds: ['s2'] });
  });

  it('"nessuna" → pratiche senza sede assegnata', () => {
    expect(filtroSede({ ...base, selezione: SEDE_NON_ASSEGNATA })).toEqual({
      tipo: 'nonAssegnata',
    });
  });
});

describe('filtroSede — agenzia (il filtro restringe lo scope, non lo sostituisce)', () => {
  const base = { opzioniIds: ['s1', 's2'], consentiNonAssegnata: false };

  it('sede nello scope → filtra su quella sede', () => {
    expect(filtroSede({ ...base, selezione: 's2', scopeIds: ['s1', 's2'] })).toEqual({
      tipo: 'sede',
      sedeIds: ['s2'],
    });
  });

  it('sede fuori dallo scope → lista vuota, mai dati di un altro scope', () => {
    expect(filtroSede({ ...base, selezione: 's2', scopeIds: ['s1'] })).toEqual({
      tipo: 'sede',
      sedeIds: [],
    });
  });

  it('"nessuna" non è ammessa: sovrascriverebbe il vincolo di scope', () => {
    expect(
      filtroSede({ ...base, selezione: SEDE_NON_ASSEGNATA, scopeIds: ['s1', 's2'] }),
    ).toEqual({ tipo: 'nessuno' });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm --filter piattaforma exec vitest run src/lib/pratiche/colonna-sede.test.ts
```

Atteso: FAIL — `Failed to resolve import "./colonna-sede"`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `apps/piattaforma/src/lib/pratiche/colonna-sede.ts`:

```ts
/**
 * Colonna "Sede" della lista pratiche — logica pura (niente IO, niente Prisma).
 *
 * La colonna mostra sempre la sede dell'AGENZIA assegnataria, cioè la filiale
 * dove la pratica si svolge: non la sede di chi guarda.
 */

/** Valore del filtro per le pratiche non ancora assegnate a una sede. */
export const SEDE_NON_ASSEGNATA = 'nessuna';

/**
 * La colonna serve solo dove può assumere valori diversi riga per riga.
 *
 * - broker: le sedi agenzia variano sempre, indipendentemente dal suo scope;
 * - agenzia: solo se vede più di una sede propria. `resolveCurrentSede`
 *   restituisce sempre `ONE` ai non-owner, quindi `scopeIds.length === 1` copre
 *   in un colpo solo admin di sede, operatore e owner con una filiale sola —
 *   tutti casi in cui ogni riga mostrerebbe la stessa sede.
 */
export function mostraColonnaSede(args: {
  companyType: string | undefined;
  scopeIds: string[];
}): boolean {
  if (args.companyType === 'AGENZIA') return args.scopeIds.length > 1;
  return true;
}

export type FiltroSede =
  | { tipo: 'nessuno' }
  | { tipo: 'sede'; sedeIds: string[] }
  | { tipo: 'nonAssegnata' };

/**
 * Traduce `?sede=` in un vincolo su `agenziaSedeId`, fail-closed.
 *
 * Il valore arriva dalla querystring: un id fuori dalle opzioni ammesse viene
 * ignorato, non applicato alla cieca. Per l'agenzia si INTERSECA con `scopeIds`
 * invece di sostituirlo — la sede restringe la madre, non la rimpiazza — quindi
 * un id fuori scope produce `sedeIds: []`, cioè lista vuota, mai dati altrui.
 *
 * `scopeIds` è `null` per broker e admin: lì `agenziaSedeId` non è il campo su
 * cui poggia lo scoping, quindi non c'è nulla da intersecare.
 */
export function filtroSede(args: {
  selezione: string | undefined;
  opzioniIds: string[];
  scopeIds: string[] | null;
  consentiNonAssegnata: boolean;
}): FiltroSede {
  const sel = args.selezione?.trim();
  if (!sel) return { tipo: 'nessuno' };

  if (sel === SEDE_NON_ASSEGNATA) {
    // Per l'agenzia è vietata: `agenziaSedeId: null` sovrascriverebbe il
    // vincolo `{ in: scopeIds }`. E una pratica senza sede non è comunque sua.
    return args.consentiNonAssegnata ? { tipo: 'nonAssegnata' } : { tipo: 'nessuno' };
  }

  if (!args.opzioniIds.includes(sel)) return { tipo: 'nessuno' };

  if (args.scopeIds) return { tipo: 'sede', sedeIds: args.scopeIds.filter((id) => id === sel) };
  return { tipo: 'sede', sedeIds: [sel] };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/pratiche/colonna-sede.test.ts
```

Atteso: PASS, 10 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/colonna-sede.ts apps/piattaforma/src/lib/pratiche/colonna-sede.test.ts
git commit -m "$(cat <<'EOF'
feat(pratiche): logica pura per visibilità colonna sede e filtro fail-closed

mostraColonnaSede: per l'agenzia basta scopeIds.length > 1, perché ai non-owner
resolveCurrentSede dà sempre una sede sola. filtroSede: valida contro le opzioni
ammesse e per l'agenzia interseca con lo scope invece di sostituirlo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Colonna e filtro Sede in `/pratiche`

**Files:**
- Create: `apps/piattaforma/src/components/sede/sede-cell.tsx`
- Create: `apps/piattaforma/src/lib/pratiche/opzioni-sede.ts`
- Modify: `apps/piattaforma/src/app/pratiche/page.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/filters.tsx`

**Interfaces:**
- Consumes: `PRATICHE_GRID.utenteConSede`, `PRATICHE_GRID.utenteSenzaSede`, `PRATICHE_TABLE_MIN_W` (Task 1); `mostraColonnaSede`, `filtroSede`, `SEDE_NON_ASSEGNATA` (Task 2).
- Produces:
  - `SedeCell({ sede }: { sede: { nome: string; citta: string } | null })`
  - `type OpzioneSede = { value: string; label: string }`
  - `opzioniSedeProprie(scopeIds: string[]): Promise<OpzioneSede[]>`
  - `opzioniSedeAgenziaDaPratiche(wherePratiche: Prisma.PraticaWhereInput): Promise<OpzioneSede[]>`
  - `opzioniSedeAgenziaTutte(): Promise<OpzioneSede[]>`

- [ ] **Step 1: Crea la cella**

Crea `apps/piattaforma/src/components/sede/sede-cell.tsx`:

```tsx
/**
 * Cella "Sede" della lista pratiche: nome della filiale e, sotto, la città.
 * La città disambigua i nomi che si ripetono fra agenzie diverse ("Sede
 * centrale"). `null` = pratica non ancora assegnata a una sede.
 */
export function SedeCell({ sede }: { sede: { nome: string; citta: string } | null }) {
  if (!sede) return <span className="text-pv-slate-500">—</span>;

  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-pv-slate-700">{sede.nome}</div>
      <div className="truncate text-[11px] text-pv-slate-500">{sede.citta}</div>
    </div>
  );
}
```

- [ ] **Step 2: Crea le query delle opzioni**

Crea `apps/piattaforma/src/lib/pratiche/opzioni-sede.ts`:

```ts
import 'server-only';
import { prisma, Prisma } from '@pv/db';

export type OpzioneSede = { value: string; label: string };

/**
 * Le sedi dell'agenzia stessa, ristrette allo scope corrente: le uniche fra cui
 * ha senso che scelga, e le uniche che il filtro accetterà.
 */
export async function opzioniSedeProprie(scopeIds: string[]): Promise<OpzioneSede[]> {
  if (scopeIds.length === 0) return [];

  const sedi = await prisma.sede.findMany({
    where: { id: { in: scopeIds }, deletedAt: null },
    select: { id: true, nome: true, citta: true },
    orderBy: [{ citta: 'asc' }, { nome: 'asc' }],
  });

  return sedi.map((s) => ({ value: s.id, label: `${s.nome} (${s.citta})` }));
}

/**
 * Sedi agenzia che compaiono davvero nelle pratiche selezionate da
 * `wherePratiche` (caso broker).
 *
 * Passare lo where del solo scoping, SENZA il filtro sede già applicato:
 * altrimenti le opzioni si restringerebbero a quella selezionata e non si
 * potrebbe più cambiare scelta.
 */
export async function opzioniSedeAgenziaDaPratiche(
  wherePratiche: Prisma.PraticaWhereInput,
): Promise<OpzioneSede[]> {
  return conEtichettaAgenzia({
    type: 'AGENZIA',
    deletedAt: null,
    praticheAgenzia: { some: wherePratiche },
  });
}

/** Tutte le sedi agenzia della piattaforma (caso admin). */
export async function opzioniSedeAgenziaTutte(): Promise<OpzioneSede[]> {
  return conEtichettaAgenzia({ type: 'AGENZIA', deletedAt: null });
}

/**
 * Etichetta `Ragione sociale · Nome sede`: chi vede sedi di agenzie diverse ha
 * bisogno del nome dell'agenzia per distinguerle.
 */
async function conEtichettaAgenzia(where: Prisma.SedeWhereInput): Promise<OpzioneSede[]> {
  const sedi = await prisma.sede.findMany({
    where,
    select: { id: true, nome: true, company: { select: { ragioneSociale: true } } },
    orderBy: [{ company: { ragioneSociale: 'asc' } }, { nome: 'asc' }],
  });

  return sedi.map((s) => ({ value: s.id, label: `${s.company.ragioneSociale} · ${s.nome}` }));
}
```

- [ ] **Step 3: Aggiungi la select al form filtri**

In `apps/piattaforma/src/app/pratiche/filters.tsx`, sostituisci il tipo `Props`, la firma e il `<form>` di apertura, e aggiungi la select dopo quella del periodo:

```tsx
type Props = {
  q?: string;
  stato?: string;
  periodo?: string;
  sede?: string;
  stati: Option[];
  periodi: Option[];
  /** Vuoto quando la colonna Sede non si mostra: la select sparisce. */
  sedi: Option[];
};

export function PraticheFilters({ q, stato, periodo, sede, stati, periodi, sedi }: Props) {
```

Il `<form>`:

```tsx
    <form
      ref={formRef}
      action="/pratiche"
      method="get"
      className={`mb-5 grid grid-cols-1 gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] ${
        sedi.length > 0 ? 'sm:grid-cols-[1fr_auto_auto_auto]' : 'sm:grid-cols-[1fr_auto_auto]'
      }`}
    >
```

E, subito prima di `</form>`:

```tsx
      {sedi.length > 0 && (
        <select
          name="sede"
          defaultValue={sede ?? ''}
          onChange={submit}
          className="rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
        >
          {sedi.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}
```

- [ ] **Step 4: Collega la pagina**

In `apps/piattaforma/src/app/pratiche/page.tsx`:

Aggiungi gli import:

```ts
import { mostraColonnaSede, filtroSede, SEDE_NON_ASSEGNATA } from '@/lib/pratiche/colonna-sede';
import { opzioniSedeProprie, opzioniSedeAgenziaDaPratiche } from '@/lib/pratiche/opzioni-sede';
import { SedeCell } from '@/components/sede/sede-cell';
```

Estendi `SearchParams`:

```ts
type SearchParams = {
  stato?: string;
  q?: string;
  periodo?: string;
  sede?: string;
  page?: string;
};
```

Subito dopo il blocco che imposta lo scope (`if (companyType === 'AGENZIA') { where.agenziaSedeId = … } else { where.brokerSedeId = … }`) inserisci:

```ts
  // Colonna Sede: sempre la sede dell'agenzia assegnataria. Il broker la vede
  // sempre; l'agenzia solo se il suo scope copre più di una sede propria.
  const mostraSede = mostraColonnaSede({ companyType, scopeIds });

  const sediDisponibili = !mostraSede
    ? []
    : isAgenzia
      ? await opzioniSedeProprie(scopeIds)
      : await opzioniSedeAgenziaDaPratiche({ deletedAt: null, brokerSedeId: { in: scopeIds } });

  const fSede = filtroSede({
    selezione: sp.sede,
    opzioniIds: sediDisponibili.map((o) => o.value),
    // Per l'agenzia `agenziaSedeId` È lo scope: il filtro deve intersecarlo.
    scopeIds: isAgenzia ? scopeIds : null,
    consentiNonAssegnata: !isAgenzia,
  });
  if (fSede.tipo === 'sede') where.agenziaSedeId = { in: fSede.sedeIds };
  else if (fSede.tipo === 'nonAssegnata') where.agenziaSedeId = null;

  const sediSelect = mostraSede
    ? [
        { value: '', label: 'Tutte le sedi' },
        ...(isAgenzia ? [] : [{ value: SEDE_NON_ASSEGNATA, label: 'Non assegnate' }]),
        ...sediDisponibili,
      ]
    : [];

  const grid = mostraSede ? PRATICHE_GRID.utenteConSede : PRATICHE_GRID.utenteSenzaSede;
```

Nell'`include` di `prisma.pratica.findMany` aggiungi:

```ts
        agenziaSede: { select: { nome: true, citta: true } },
```

Nella riga dei risultati filtrati, aggiorna il contatore per riconoscere il nuovo filtro:

```tsx
              {sp.stato || sp.periodo || sp.sede || q ? ' · filtri attivi' : ''}
```

Passa le nuove prop ai filtri:

```tsx
        <PraticheFilters
          q={q}
          stato={sp.stato}
          periodo={sp.periodo}
          sede={sp.sede}
          stati={STATI_USER}
          periodi={PERIODI}
          sedi={sediSelect}
        />
```

Sostituisci le due occorrenze di `PRATICHE_GRID.utenteSenzaSede` nel JSX della tabella con `grid`, e inserisci la colonna Sede fra la controparte e lo stato. Nell'header:

```tsx
                  {mostraSede && <div className="hidden px-3 py-3 lg:block">Sede</div>}
```

Nella riga:

```tsx
                        {mostraSede && (
                          <div className="hidden min-w-0 px-3 py-3 lg:block">
                            <SedeCell sede={p.agenziaSede} />
                          </div>
                        )}
```

Infine, in `Pagination.makeHref`, propaga il filtro — altrimenti si perde cambiando pagina:

```ts
    if (sp.stato) params.set('stato', sp.stato);
    if (sp.q) params.set('q', sp.q);
    if (sp.periodo) params.set('periodo', sp.periodo);
    if (sp.sede) params.set('sede', sp.sede);
    if (p > 1) params.set('page', String(p));
```

- [ ] **Step 5: Verifica a video**

```bash
pnpm --filter piattaforma dev
```

Su `/pratiche` a larghezza ≥ 1024px:

1. **Broker** → colonna Sede presente, select "Tutte le sedi / Non assegnate / *Agenzia · Sede*". Le pratiche in bozza o in attesa mostrano `—`.
2. **Agenzia owner con ≥2 sedi**, vista aggregata → colonna e select presenti, etichette `Nome (Città)`.
3. **Agenzia owner** che seleziona una sede sola dallo switcher → colonna e select spariscono.
4. **Agenzia admin di sede / operatore** → colonna e select assenti.
5. Filtra per una sede, poi vai a pagina 2: il filtro **resta**.
6. Come agenzia, forza a mano `?sede=<uuid di un'altra azienda>` → lista vuota, nessun dato altrui.

- [ ] **Step 6: Esegui tutti i test del modulo**

```bash
pnpm --filter piattaforma exec vitest run src/lib/pratiche
```

Atteso: PASS su `table-grid`, `colonna-sede`, `stato-extra`, `access`, `countdown`, `guida-step`.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/components/sede/sede-cell.tsx apps/piattaforma/src/lib/pratiche/opzioni-sede.ts apps/piattaforma/src/app/pratiche/page.tsx apps/piattaforma/src/app/pratiche/filters.tsx
git commit -m "$(cat <<'EOF'
feat(pratiche): colonna e filtro "Sede" nella lista broker/agenzia

Mostra la sede dell'agenzia assegnataria (nome + città). Visibile al broker
sempre, all'agenzia solo se il suo scope copre più sedi. Il filtro propaga anche
in paginazione e per l'agenzia interseca lo scope invece di sostituirlo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Colonna e filtro Sede in `/admin/pratiche`

L'admin di piattaforma non è associato ad alcuna sede: la colonna c'è sempre.

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/table-grid.ts` (variante `admin`: 8 tracce su `lg`)
- Modify: `apps/piattaforma/src/lib/pratiche/table-grid.test.ts` (attesa `lg: 8`)
- Modify: `apps/piattaforma/src/app/admin/pratiche/page.tsx`
- Modify: `apps/piattaforma/src/app/admin/pratiche/filters.tsx`

**Interfaces:**
- Consumes: `filtroSede`, `SEDE_NON_ASSEGNATA` (Task 2); `SedeCell`, `opzioniSedeAgenziaTutte` (Task 3).

- [ ] **Step 1: Aggiorna il test per la nuova colonna**

In `apps/piattaforma/src/lib/pratiche/table-grid.test.ts`, cambia l'attesa di `admin`:

```ts
  it('admin: nessuna colonna nuova su sm, broker+agenzia da md, sede+fee da lg', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.admin)).toEqual({
      base: 4,
      sm: 4,
      md: 6,
      lg: 8,
    });
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm --filter piattaforma exec vitest run src/lib/pratiche/table-grid.test.ts
```

Atteso: FAIL — `expected { base: 4, sm: 4, md: 6, lg: 7 } to deeply equal { … lg: 8 }`.

- [ ] **Step 3: Aggiungi la traccia**

In `apps/piattaforma/src/lib/pratiche/table-grid.ts`, sostituisci la variante `admin`:

```ts
  /** Codice · Targa · Broker(md) · Agenzia(md) · Sede(lg) · Stato · Fee(lg) · Quando */
  admin:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/pratiche/table-grid.test.ts
```

Atteso: PASS.

- [ ] **Step 5: Aggiungi la select al form filtri admin**

In `apps/piattaforma/src/app/admin/pratiche/filters.tsx`:

```tsx
type Props = {
  q?: string;
  stato?: string;
  sede?: string;
  stati: Option[];
  sedi: Option[];
};

export function AdminPraticheFilters({ q, stato, sede, stati, sedi }: Props) {
```

Il `<form>` guadagna una traccia:

```tsx
      className="mb-5 grid grid-cols-1 gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:grid-cols-[1fr_auto_auto]"
```

E, prima di `</form>`:

```tsx
      <select
        name="sede"
        defaultValue={sede ?? ''}
        onChange={submit}
        className="rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      >
        {sedi.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
```

- [ ] **Step 6: Collega la pagina admin**

In `apps/piattaforma/src/app/admin/pratiche/page.tsx`:

Import:

```ts
import { filtroSede, SEDE_NON_ASSEGNATA } from '@/lib/pratiche/colonna-sede';
import { opzioniSedeAgenziaTutte } from '@/lib/pratiche/opzioni-sede';
import { SedeCell } from '@/components/sede/sede-cell';
```

`SearchParams`:

```ts
type SearchParams = { q?: string; stato?: string; sede?: string };
```

Dopo il blocco del filtro `q`, aggiungi:

```ts
  // L'admin di piattaforma non è associato a nessuna sede: nessuno scope da
  // intersecare, e le pratiche non ancora assegnate sono un filtro legittimo.
  const sediDisponibili = await opzioniSedeAgenziaTutte();
  const fSede = filtroSede({
    selezione: sp.sede,
    opzioniIds: sediDisponibili.map((o) => o.value),
    scopeIds: null,
    consentiNonAssegnata: true,
  });
  if (fSede.tipo === 'sede') where.agenziaSedeId = { in: fSede.sedeIds };
  else if (fSede.tipo === 'nonAssegnata') where.agenziaSedeId = null;

  const sediSelect = [
    { value: '', label: 'Tutte le sedi' },
    { value: SEDE_NON_ASSEGNATA, label: 'Non assegnate' },
    ...sediDisponibili,
  ];
```

Nell'`include` di `prisma.pratica.findMany`:

```ts
      agenziaSede: { select: { nome: true, citta: true } },
```

Aggiorna il contatore dei filtri attivi:

```tsx
            {q || sp.stato || sp.sede ? ' (filtri attivi)' : ' (più recenti, escalation in cima)'}
```

Passa le prop:

```tsx
        <AdminPraticheFilters q={q} stato={sp.stato} sede={sp.sede} stati={STATI} sedi={sediSelect} />
```

Header, fra Agenzia e Stato:

```tsx
                  <div className="hidden px-3 py-3 lg:block">Sede</div>
```

Riga, nella stessa posizione:

```tsx
                      <div className="hidden min-w-0 px-3 py-3 lg:block">
                        <SedeCell sede={p.agenziaSede} />
                      </div>
```

- [ ] **Step 7: Verifica a video**

```bash
pnpm --filter piattaforma dev
```

Su `/admin/pratiche` a larghezza ≥ 1024px: colonna Sede presente fra Agenzia e Stato, allineata con l'intestazione; select con "Tutte le sedi", "Non assegnate" e le sedi etichettate `Agenzia · Sede`. Filtra per una sede e per "Non assegnate" e controlla che i risultati corrispondano.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/table-grid.ts apps/piattaforma/src/lib/pratiche/table-grid.test.ts apps/piattaforma/src/app/admin/pratiche/page.tsx apps/piattaforma/src/app/admin/pratiche/filters.tsx
git commit -m "$(cat <<'EOF'
feat(admin): colonna e filtro "Sede" nella gestione pratiche

L'admin di piattaforma non è associato ad alcuna sede: la colonna c'è sempre,
con la select su tutte le sedi agenzia più l'opzione "Non assegnate".

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verifica finale

**Files:** nessuno (solo verifica).

- [ ] **Step 1: Suite di test completa**

```bash
nvm use 22.15.0
pnpm --filter piattaforma test
```

Atteso: PASS su tutta la suite.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Atteso: nessun errore. Se compaiono errori incomprensibili sui tipi Prisma o uno stack overflow di `tsc`, è il problema noto della cache fredda, non questa modifica: rilancia dopo un `pnpm build` che ripopoli il `tsbuildinfo`.

- [ ] **Step 3: Lint**

```bash
pnpm --filter piattaforma lint
```

Atteso: nessun errore.

- [ ] **Step 4: Passata di regressione sullo stretched-link**

Con `pnpm --filter piattaforma dev`, su `/pratiche` come agenzia:

- click su una riga → apre la pratica;
- click sul chip di stato, sull'icona info e sul pulsante azione → **non** naviga;
- `Tab` fino alla riga → focus ring visibile;
- finestra a ~360px → la tabella scorre in orizzontale, nessuna colonna tagliata.

---

## Note per chi implementa

- Le larghezze in `rem` di `table-grid.ts` sono un punto di partenza ragionato, non un dogma. Se a video una colonna respira male, cambia il valore **nel modulo** e aggiorna il test solo se cambia il *numero* di tracce.
- La cella Sede è alta due righe: le righe della tabella diventano un po' più alte quando la colonna è visibile. È voluto.
- `opzioniSedeAgenziaDaPratiche` riceve lo where del **solo scoping**, non quello completo con stato/periodo/ricerca: le opzioni della select devono restare stabili mentre l'utente filtra.
