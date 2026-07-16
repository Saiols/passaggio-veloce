# Ciclo di vita visura camerale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La visura camerale dell'organizzazione vale 180 giorni; scaduta, il broker perde il payout e l'agenzia l'operatività, finché non ne carica una nuova.

**Architecture:** Lo stato è **derivato**, non memorizzato: `isVisuraScaduta(Company.visuraCameraleData, oggi)`. Nessun flag, nessun job che mantenga lo stato, nessuna migration (salvo i 4 nuovi `NotificaTipo`); lo sblocco è automatico appena la data cambia. Una funzione pura in `lib/visura/validita.ts` è la fonte unica, letta da registrazione, guard, banner e cron.

**Tech Stack:** Next.js 16 App Router (Server Actions), Prisma + Postgres, Vitest, Vercel Blob (client upload), Google Document AI / unpdf per l'OCR, Resend per le email.

**Spec:** `docs/superpowers/specs/2026-07-16-visura-camerale-ciclo-vita-design.md` (commit `9cb862d`, `c04c8f5`, `9c6a769`).

## Global Constraints

- **Validità = 180 giorni.** Scaduta ⟺ `giorniTrascorsi >= 180`. Preavviso ⟺ `175 <= giorniTrascorsi <= 179`. Mai riesumare l'aritmetica sui mesi.
- **"Oggi" è il giorno di Roma**, mai la mezzanotte UTC: usare `romeYmd` (Task 1.1). L'azienda opera in Italia.
- **`visuraCameraleData = NULL` → esente**, sempre, ovunque. Nessun preavviso, nessun blocco.
- **Solo `ADMIN_AZIENDA`** (`isOwner(role)`) carica la visura. Il gate va **ri-verificato nella Server Action**, non solo nella pagina.
- **Add, non replace**: ogni upload crea un nuovo `Documento`; i precedenti restano e **non vanno mai soft-deletati** (il cron `purge-deleted-documenti` li cancellerebbe). Il più recente vince: `orderBy: { createdAt: 'desc' }` + `deletedAt: null`.
- **Mai sovrascrivere `partitaIva` né `regimeFiscale`** dall'OCR. Solo `visuraCameraleData`, `ragioneSociale`, e la sede legale (`indirizzo`, `civico`, `cap`, `citta`, `provincia`).
- **`visuraCameraleData` e `ragioneSociale` vengono SEMPRE dall'estrazione del server**, mai da un campo del form. La sede legale è **l'unico** dato accettato dal client, e solo perché un umano l'ha confermata. Se la data fosse modificabile dal client, sbloccarsi sarebbe un POST.
- **`lib/kyc/parte-docs.ts` è un ALTRO dominio** (visura di venditore/acquirente in una pratica). `VISURA_VALIDITA_MESI = 6` lì **non si tocca e non si unifica**.
- **N46-N49 sono transazionali**: NON aggiungerle a `OPTIONAL_TIPI` (`lib/notifiche/preferences.ts:7`). Il default è già "obbligatoria".
- **Il cron è dormiente finché Vercel resta Hobby.** Va scritto e testato lo stesso; il resto del ciclo non dipende da lui.
- Ogni fase termina con `pnpm -F piattaforma typecheck` **verde con exit code 0** (usare `nvm use 22.15.0` prima: post-riavvio Node torna a 16).

## Ordine delle fasi — vincolo non negoziabile

**La Fase 4 (blocchi) non può essere rilasciata prima della Fase 3 (sezione di aggiornamento).** Bloccare qualcuno senza dargli il modo di sbloccarsi è un vicolo cieco. Se si spezza il rilascio, Fase 3 va in produzione per prima.

## File Structure

| File | Responsabilità | Fase |
|---|---|---|
| `lib/date/rome-day.ts` *(modifica)* | + `romeYmd(instant)`: giorno di calendario a Roma | 1 |
| `lib/visura/validita.ts` *(nuovo)* | **Fonte unica**: pura, niente IO. Soglie e calcoli. | 1 |
| `lib/visura/validita.test.ts` *(nuovo)* | Confini 179/180/181, DST, null | 1 |
| `lib/auth/document-validation.ts` *(modifica)* | − codice morto a mesi | 1 |
| `lib/kyc/parte-docs.ts` *(modifica)* | + commento "altro dominio, non unificare" | 1 |
| `lib/kyc/verify.ts` *(modifica)* | − regola `VISURA_SCADUTA` e costante 5 mesi | 2 |
| `app/(auth)/actions.ts` *(modifica)* | + età visura in `VerifyDocsResult` | 2 |
| `app/(auth)/register/register-wizard.tsx` *(modifica)* | + avviso allo step 3 | 2 |
| `lib/kyc/visura-parser.ts` *(modifica)* | + `sedeLegale` best-effort (àncora semantica) | 3 |
| `lib/visura/stato.ts` *(nuovo)* | `server-only`: legge il DB, dice se un'azienda è scaduta/in preavviso | 3 |
| `lib/visura/aggiorna.ts` *(nuovo)* | `server-only`: OCR + controlli + update + nuovo Documento | 3 |
| `lib/visura/aggiorna.test.ts` *(nuovo)* | Controlli e campi aggiornati (deps iniettate) | 3 |
| `app/visura/page.tsx` *(nuovo)* | Server Component: sessione, `isOwner`, stato | 3 |
| `app/visura/client.tsx` *(nuovo)* | Upload Blob + form | 3 |
| `app/visura/actions.ts` *(nuovo)* | Server Action, ri-verifica owner | 3 |
| `app/visura/actions.authz.test.ts` *(nuovo)* | Authz: non-owner, non loggato, altra azienda | 3 |
| `lib/wallet/payout-exec.ts` *(modifica)* | Guard payout su visura scaduta | 4 |
| `app/pratiche/actions.ts`, `app/inbox/actions.ts`, `lib/pratiche/firma-engine.ts` *(modifica)* | Guard operatività agenzia | 4 |
| `lib/distribuzione/tick.ts` *(modifica)* | Esclusione sedi con madre scaduta | 4 |
| `components/visura-banner.tsx` *(nuovo)* | Banner giallo/rosso | 4 |
| `lib/notifiche/templates.ts` *(modifica)* | + N46-N49 | 5 |
| `lib/notifiche/send.ts` *(modifica)* | + import, union, `render()` | 5 |
| `packages/db/prisma/schema.prisma` + migration *(modifica)* | + 4 valori `NotificaTipo` | 5 |
| `lib/jobs/preavviso-visura.ts` *(nuovo)* | Logica cron + idempotenza | 5 |
| `app/api/jobs/preavviso-visura/route.ts` *(nuovo)* | Endpoint sottile | 5 |
| `apps/piattaforma/vercel.json` *(modifica)* | + schedule | 5 |
| `app/termini/page.tsx`, `lib/legal/clausole-vessatorie.ts` *(modifica)* | Clausole 5/8/12 + `TERMS_VERSION` | 6 |

---

# FASE 1 — La fonte unica

### Task 1.1: `romeYmd` — il giorno di calendario a Roma

**Files:**
- Modify: `apps/piattaforma/src/lib/date/rome-day.ts`
- Test: `apps/piattaforma/src/lib/date/rome-day.test.ts` (se non esiste, crearlo)

**Interfaces:**
- Produces: `romeYmd(instant: Date): [number, number, number]` — anno, mese (1-12), giorno.

**Perché:** `rome-day.ts` sa convertire *un giorno* in istanti (`romeStartOfDay`), ma non sa dire *che giorno è adesso a Roma*. Serve quello: alle 00:30 del 17 luglio a Roma, in UTC sono ancora le 22:30 del 16 — usare UTC sposterebbe la scadenza di un giorno.

- [ ] **Step 1: Scrivere il test che fallisce**

In `apps/piattaforma/src/lib/date/rome-day.test.ts` (creare il file se assente, con l'import in testa):

```ts
import { describe, it, expect } from 'vitest';
import { romeYmd } from './rome-day';

describe('romeYmd', () => {
  it('ora legale (CEST, +2): 23:30 UTC del 16/07 è già il 17/07 a Roma', () => {
    expect(romeYmd(new Date('2026-07-16T23:30:00Z'))).toEqual([2026, 7, 17]);
  });

  it('ora legale: 21:30 UTC del 16/07 è ancora il 16/07 a Roma', () => {
    expect(romeYmd(new Date('2026-07-16T21:30:00Z'))).toEqual([2026, 7, 16]);
  });

  it('ora solare (CET, +1): 23:30 UTC del 15/01 è già il 16/01 a Roma', () => {
    expect(romeYmd(new Date('2026-01-15T23:30:00Z'))).toEqual([2026, 1, 16]);
  });

  it('ora solare: 22:30 UTC del 15/01 è ancora il 15/01 a Roma', () => {
    expect(romeYmd(new Date('2026-01-15T22:30:00Z'))).toEqual([2026, 1, 15]);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```
nvm use 22.15.0
pnpm -F piattaforma exec vitest run src/lib/date/rome-day.test.ts
```
Atteso: FAIL — `romeYmd is not a function` / errore di import.

- [ ] **Step 3: Implementare**

In `apps/piattaforma/src/lib/date/rome-day.ts`, dopo `romeEndOfDay` (riga ~68):

```ts
/**
 * Giorno di calendario (anno, mese 1-12, giorno) a Roma per un dato istante.
 *
 * Serve a rispondere a "che giorno è OGGI per l'azienda": alle 00:30 del 17
 * luglio a Roma in UTC sono ancora le 22:30 del 16, e usare UTC sposterebbe di
 * un giorno ogni soglia calcolata su questo (scadenza visura, preavvisi).
 */
export function romeYmd(instant: Date): [number, number, number] {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  return [g.year!, g.month!, g.day!];
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

```
pnpm -F piattaforma exec vitest run src/lib/date/rome-day.test.ts
```
Atteso: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/date/rome-day.ts apps/piattaforma/src/lib/date/rome-day.test.ts
git commit -m "feat(date): romeYmd, il giorno di calendario a Roma"
```

---

### Task 1.2: `lib/visura/validita.ts` — la regola

**Files:**
- Create: `apps/piattaforma/src/lib/visura/validita.ts`
- Test: `apps/piattaforma/src/lib/visura/validita.test.ts`

**Interfaces:**
- Consumes: `romeYmd` (Task 1.1)
- Produces:
  - `VISURA_VALIDITA_GIORNI: 180`, `PREAVVISO_GIORNI: 5`
  - `giorniTrascorsi(emissione: Date, oggi: Date): number`
  - `isVisuraScaduta(emissione: Date | null, oggi: Date): boolean`
  - `isInPreavviso(emissione: Date | null, oggi: Date): boolean`
  - `giorniRimanenti(emissione: Date, oggi: Date): number`
  - `limiteVisuraUtc(oggi: Date): Date` — per il `where` Prisma

**Nota sul file:** **niente `import 'server-only'`**. Il banner (client) e il wizard usano queste funzioni.

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/lib/visura/validita.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  VISURA_VALIDITA_GIORNI,
  giorniTrascorsi,
  isVisuraScaduta,
  isInPreavviso,
  giorniRimanenti,
  limiteVisuraUtc,
} from './validita';

// Prisma @db.Date → Date a mezzanotte UTC.
const emissione = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
// Un istante a metà giornata romana, per non far dipendere i test dall'ora.
const oggi = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

describe('VISURA_VALIDITA_GIORNI', () => {
  it('è 180', () => {
    expect(VISURA_VALIDITA_GIORNI).toBe(180);
  });
});

describe('giorniTrascorsi', () => {
  it('stesso giorno → 0', () => {
    expect(giorniTrascorsi(emissione('2026-07-16'), oggi('2026-07-16'))).toBe(0);
  });

  it('conta i giorni di calendario, non le 24h', () => {
    expect(giorniTrascorsi(emissione('2026-01-01'), oggi('2026-07-01'))).toBe(181);
  });

  it('attraversa il cambio di ora legale senza perdere un giorno', () => {
    // 2026-03-29 è il passaggio a CEST: quel giorno dura 23 ore.
    expect(giorniTrascorsi(emissione('2026-03-28'), oggi('2026-03-30'))).toBe(2);
  });
});

describe('isVisuraScaduta — il confine è a 180', () => {
  const e = emissione('2026-01-01'); // +179 = 2026-06-29, +180 = 2026-06-30

  it('giorno 179 → valida', () => {
    expect(giorniTrascorsi(e, oggi('2026-06-29'))).toBe(179);
    expect(isVisuraScaduta(e, oggi('2026-06-29'))).toBe(false);
  });

  it('giorno 180 → SCADUTA (il confine è >=, non >)', () => {
    expect(giorniTrascorsi(e, oggi('2026-06-30'))).toBe(180);
    expect(isVisuraScaduta(e, oggi('2026-06-30'))).toBe(true);
  });

  it('giorno 181 → scaduta', () => {
    expect(isVisuraScaduta(e, oggi('2026-07-01'))).toBe(true);
  });

  it('null → MAI scaduta (esente)', () => {
    expect(isVisuraScaduta(null, oggi('2030-01-01'))).toBe(false);
  });

  it('data futura → non scaduta', () => {
    expect(isVisuraScaduta(emissione('2027-01-01'), oggi('2026-07-16'))).toBe(false);
  });
});

describe('isInPreavviso — finestra 175..179', () => {
  const e = emissione('2026-01-01');

  it('giorno 174 → no', () => {
    expect(isInPreavviso(e, oggi('2026-06-24'))).toBe(false);
  });

  it('giorno 175 → sì (primo giorno)', () => {
    expect(giorniTrascorsi(e, oggi('2026-06-25'))).toBe(175);
    expect(isInPreavviso(e, oggi('2026-06-25'))).toBe(true);
  });

  it('giorno 179 → sì (ultimo giorno)', () => {
    expect(isInPreavviso(e, oggi('2026-06-29'))).toBe(true);
  });

  it('giorno 180 → no: è già scaduta, non "in preavviso"', () => {
    expect(isInPreavviso(e, oggi('2026-06-30'))).toBe(false);
    expect(isVisuraScaduta(e, oggi('2026-06-30'))).toBe(true);
  });

  it('null → mai in preavviso', () => {
    expect(isInPreavviso(null, oggi('2026-06-25'))).toBe(false);
  });
});

describe('giorniRimanenti', () => {
  it('giorno 175 → ne restano 5', () => {
    expect(giorniRimanenti(emissione('2026-01-01'), oggi('2026-06-25'))).toBe(5);
  });

  it('giorno 180 → 0, mai negativo', () => {
    expect(giorniRimanenti(emissione('2026-01-01'), oggi('2026-06-30'))).toBe(0);
  });

  it('ampiamente scaduta → 0, non un numero negativo', () => {
    expect(giorniRimanenti(emissione('2024-12-13'), oggi('2026-07-16'))).toBe(0);
  });
});

describe('limiteVisuraUtc — soglia per il where Prisma', () => {
  it('NON scaduta ⟺ visuraCameraleData > limite: coerente con isVisuraScaduta', () => {
    const limite = limiteVisuraUtc(oggi('2026-06-30'));
    // emissione 2026-01-01 è scaduta al 2026-06-30 (giorno 180) → NON > limite
    expect(emissione('2026-01-01').getTime() > limite.getTime()).toBe(false);
    // emissione 2026-01-02 è al giorno 179 → valida → > limite
    expect(emissione('2026-01-02').getTime() > limite.getTime()).toBe(true);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```
pnpm -F piattaforma exec vitest run src/lib/visura/validita.test.ts
```
Atteso: FAIL — modulo `./validita` inesistente.

- [ ] **Step 3: Implementare**

`apps/piattaforma/src/lib/visura/validita.ts`:

```ts
/**
 * FONTE UNICA della validità della visura camerale **dell'organizzazione
 * iscritta** (broker/agenzia): registrazione e ciclo di vita successivo.
 *
 * ⚠️ NON è la fonte per la visura di venditori/acquirenti dentro una pratica:
 * quella è `lib/kyc/parte-docs.ts` (`VISURA_VALIDITA_MESI = 6`, e la freschezza
 * si applica solo ai commercianti d'auto). Sono due domini diversi con regole
 * diverse: NON unificarli. Accorparli cambierebbe in silenzio le regole
 * documentali delle pratiche.
 *
 * Puro: niente IO, niente `server-only` (lo usano anche wizard e banner).
 */
import { romeYmd } from '@/lib/date/rome-day';

/** Una visura vale 180 giorni. Dal giorno 180 è scaduta (confine `>=`). */
export const VISURA_VALIDITA_GIORNI = 180;

/** Giorni di preavviso prima della scadenza: finestra 175..179. */
export const PREAVVISO_GIORNI = 5;

const MS_PER_DAY = 86_400_000;

/** Numero seriale del giorno di calendario (giorni dall'epoch). */
function civilDay(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/**
 * Giorni di calendario trascorsi dall'emissione a oggi.
 *
 * `emissione` arriva da Prisma come colonna `@db.Date` → Date a mezzanotte UTC:
 * si legge in UTC. `oggi` è un istante: si legge nel **giorno di Roma**, perché
 * è il giorno in cui vive l'azienda. Il conteggio è per giorni di calendario,
 * non per multipli di 24h: così il cambio di ora legale non fa sparire un giorno.
 */
export function giorniTrascorsi(emissione: Date, oggi: Date): number {
  const e = civilDay(emissione.getUTCFullYear(), emissione.getUTCMonth() + 1, emissione.getUTCDate());
  const [y, m, d] = romeYmd(oggi);
  return civilDay(y, m, d) - e;
}

/**
 * `null` → MAI scaduta: non si afferma la scadenza di una data che non si ha.
 * È strutturale: `visuraCameraleData` si popola solo se il gate KYC passa, quindi
 * null ⟺ registrazione in DEMO_MODE oppure account creato da seed/admin.
 */
export function isVisuraScaduta(emissione: Date | null, oggi: Date): boolean {
  if (!emissione) return false;
  return giorniTrascorsi(emissione, oggi) >= VISURA_VALIDITA_GIORNI;
}

/** Finestra di preavviso: 175..179. Al giorno 180 è scaduta, non "in preavviso". */
export function isInPreavviso(emissione: Date | null, oggi: Date): boolean {
  if (!emissione) return false;
  const g = giorniTrascorsi(emissione, oggi);
  return g >= VISURA_VALIDITA_GIORNI - PREAVVISO_GIORNI && g < VISURA_VALIDITA_GIORNI;
}

/** Giorni che restano prima del blocco. Mai negativo: 0 = scaduta. */
export function giorniRimanenti(emissione: Date, oggi: Date): number {
  return Math.max(0, VISURA_VALIDITA_GIORNI - giorniTrascorsi(emissione, oggi));
}

/**
 * Soglia per i `where` Prisma: una visura è **valida** ⟺
 * `visuraCameraleData > limiteVisuraUtc(oggi)`.
 *
 * Deve restare coerente con `isVisuraScaduta` — il test lo verifica su entrambe.
 * Ricordarsi sempre il ramo `{ visuraCameraleData: null }` in OR: i null sono esenti.
 */
export function limiteVisuraUtc(oggi: Date): Date {
  const [y, m, d] = romeYmd(oggi);
  return new Date(Date.UTC(y, m - 1, d) - VISURA_VALIDITA_GIORNI * MS_PER_DAY);
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

```
pnpm -F piattaforma exec vitest run src/lib/visura/validita.test.ts
```
Atteso: PASS, tutti.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/visura/validita.ts apps/piattaforma/src/lib/visura/validita.test.ts
git commit -m "feat(visura): fonte unica della validita' (180 giorni)"
```

---

### Task 1.3: Rimuovere il codice morto a mesi

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/document-validation.ts` (rimuovere righe 27-70: `VISURA_MAX_AGE_MONTHS`, `subtractMonthsUtcDay`, `validateVisuraData`)
- Modify: `apps/piattaforma/src/lib/auth/document-validation.test.ts` (rimuovere il `describe('validateVisuraData')`, righe ~26-60)

**Attenzione:** `isVisuraDateValid` (riga 74) **è ancora usata** da `lib/kyc/verify.ts:87` fino alla Fase 2. Va rimossa **nella Task 2.1**, non qui — e con lei `subtractMonthsUtcDay`, di cui è l'ultima consumatrice. Qui si toglie solo ciò che non ha alcun chiamante di produzione.

- [ ] **Step 1: Verificare (di nuovo) che non ci siano chiamanti**

```bash
cd apps/piattaforma/src && grep -rn "validateVisuraData" .
```
Atteso: solo `document-validation.ts` (definizione + commento) e `document-validation.test.ts`. **Se compare qualsiasi altro file, fermarsi**: la premessa è cambiata.

- [ ] **Step 2: Rimuovere il test di `validateVisuraData`**

In `document-validation.test.ts`: eliminare l'intero blocco `describe('validateVisuraData', ...)` e togliere `validateVisuraData` dall'import in testa. Lasciare intatto `describe('isVisuraDateValid (parametrico)')`.

- [ ] **Step 3: Rimuovere la funzione e la costante**

In `document-validation.ts` eliminare `const VISURA_MAX_AGE_MONTHS = 6;` (riga 27) e l'intera `export function validateVisuraData(...)` (righe 46-70) con il suo blocco di commento. **Lasciare** `subtractMonthsUtcDay` (la usa ancora `isVisuraDateValid`) e `isVisuraDateValid`.

Aggiornare il commento di `validateRegistrationDocuments` (righe ~90-99), che cita `validateVisuraData`: sostituire l'ultima frase con

```
 * NB: la data di emissione visura non è richiesta a mano: viene estratta dall'OCR
 * sulla visura camerale. La sua validità è in `lib/visura/validita.ts` (180 giorni).
```

- [ ] **Step 4: Test + typecheck**

```
pnpm -F piattaforma exec vitest run src/lib/auth/document-validation.test.ts
pnpm -F piattaforma typecheck
```
Atteso: test PASS; typecheck exit code **0**.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/document-validation.ts apps/piattaforma/src/lib/auth/document-validation.test.ts
git commit -m "refactor(visura): rimuove validateVisuraData (codice morto, 6 mesi)"
```

---

### Task 1.4: Marcare `parte-docs.ts` come dominio separato

**Files:**
- Modify: `apps/piattaforma/src/lib/kyc/parte-docs.ts:55`

**Perché:** dopo aver introdotto una "fonte unica", il prossimo che trova `VISURA_VALIDITA_MESI = 6` lo accorpa in buona fede e cambia in silenzio le regole documentali delle pratiche. Il commento è l'unica cosa che glielo impedisce.

- [ ] **Step 1: Aggiungere il commento**

Sostituire la riga 55 di `parte-docs.ts` con:

```ts
/**
 * Freschezza della visura di una PARTE della pratica (venditore/acquirente
 * persona giuridica) — Schema Documentale v7. Si applica solo ai commercianti
 * d'auto (`verificaVisura(..., { requireFreshness })`).
 *
 * ⚠️ NON è la validità della visura dell'ORGANIZZAZIONE iscritta alla
 * piattaforma: quella vale 180 giorni e sta in `lib/visura/validita.ts`.
 * Sono due domini diversi con regole diverse: NON unificarli. Qui si parla di
 * un documento di un terzo dentro una pratica, là dell'anagrafica di chi ha
 * aderito e a cui fatturiamo.
 */
const VISURA_VALIDITA_MESI = 6;
```

- [ ] **Step 2: Typecheck**

```
pnpm -F piattaforma typecheck
```
Atteso: exit code 0. (Nessun test: è solo un commento.)

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/lib/kyc/parte-docs.ts
git commit -m "docs(kyc): parte-docs e' un dominio separato da lib/visura"
```

---

# FASE 2 — Registrazione: via il blocco sulla data

### Task 2.1: `verify.ts` — rimuovere `VISURA_SCADUTA`

**Files:**
- Modify: `apps/piattaforma/src/lib/kyc/verify.ts` (righe 4, 11, 14, 86-89)
- Modify: `apps/piattaforma/src/lib/kyc/verify.test.ts`
- Modify: `apps/piattaforma/src/lib/auth/document-validation.ts` (rimuovere `isVisuraDateValid` + `subtractMonthsUtcDay`, ora orfane)
- Modify: `apps/piattaforma/src/lib/auth/document-validation.test.ts`

**Interfaces:**
- Produces: `KycFailure['rule']` **senza** più `'VISURA_SCADUTA'`.

**Restano tutti gli altri gate**: `ILLEGGIBILE`, `ATECO_NON_IDONEO`, `AZIENDA_MISMATCH`, `CI_MISMATCH`, `CF_MISMATCH`. Solo l'età sparisce.

- [ ] **Step 1: Aggiornare i test perché falliscano**

In `verify.test.ts` cercare i test su `VISURA_SCADUTA` (visura vecchia per un DEALER). Sostituirli con l'aspettativa **inversa** — una visura vecchissima ora **passa**:

```ts
it('DEALER con visura di 2 anni: NON blocca piu\' (il ciclo di vita la gestisce dopo)', async () => {
  const r = await verifyRegistrationKyc(
    {
      files: { ciFronte: FILE, codiceFiscale: FILE, visura: FILE },
      company: { ragioneSociale: 'Rossi Auto', partitaIva: '12345678901', type: 'DEALER' },
      allowedAteco: [{ companyType: 'DEALER', code: '45.11.01', active: true }],
      now: new Date('2026-07-16T12:00:00Z'),
    },
    depsCon({ visura: { ...VISURA_OK, dataEmissione: '2024-12-13' } }),
  );
  expect(r.passed).toBe(true);
});

it('la data della visura resta comunque ESTRATTA (serve al ciclo di vita)', async () => {
  const r = await verifyRegistrationKyc(
    { /* come sopra */ } as never,
    depsCon({ visura: { ...VISURA_OK, dataEmissione: '2024-12-13' } }),
  );
  expect(r.passed && r.extracted.visura.dataEmissione).toBe('2024-12-13');
});

it('visura senza dataEmissione leggibile: ILLEGGIBILE (non e\' un blocco sulla data, e\' sulla leggibilita\')', async () => {
  const r = await verifyRegistrationKyc(
    { /* come sopra */ } as never,
    depsCon({ visura: { ...VISURA_OK, dataEmissione: undefined } }),
  );
  expect(r.passed).toBe(false);
  expect(!r.passed && r.failures.some((f) => f.rule === 'ILLEGGIBILE')).toBe(true);
});
```

> Adattare `FILE`, `VISURA_OK` e `depsCon` agli helper già presenti in `verify.test.ts` — **leggere il file prima**, non inventare nomi.

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/kyc/verify.test.ts
```
Atteso: FAIL sul primo test (oggi il DEALER con visura vecchia viene respinto).

- [ ] **Step 3: Rimuovere la regola**

In `verify.ts`:
1. riga 4 — eliminare `import { isVisuraDateValid } from '@/lib/auth/document-validation';`
2. riga 11 — eliminare `const VISURA_MAX_AGE_MONTHS = 5;`
3. riga 14 — togliere `'VISURA_SCADUTA' | ` dalla union `KycFailure['rule']`
4. righe 84-89 — eliminare l'intero blocco:

```ts
  // Il controllo sull'età della visura vale SOLO per i broker (DEALER): le agenzie
  // sono spesso imprese storiche e possono presentare una visura più datata.
  if (args.company.type === 'DEALER' && visura.dataEmissione) {
    const age = isVisuraDateValid(visura.dataEmissione, VISURA_MAX_AGE_MONTHS, now);
    if (!age.ok) failures.push({ rule: 'VISURA_SCADUTA', doc: 'VISURA', message: age.error });
  }
```

e sostituirlo con:

```ts
  // NIENTE controllo di età in registrazione, per nessuno dei due tipi: la visura
  // vecchia non impedisce di iscriversi, la gestisce il ciclo di vita a 180 giorni
  // (`lib/visura/validita.ts`) dopo l'accesso. `dataEmissione` resta comunque
  // obbligatoria e leggibile (regola ILLEGGIBILE sopra): senza, il ciclo non
  // sarebbe applicabile e l'azienda resterebbe esente per sempre.
```

5. `now` (riga 53) potrebbe diventare inutilizzato: se il typecheck lo segnala, verificare se lo usano `verificaPermesso`/altre regole. **Non rimuovere il parametro `now` dalla firma pubblica** senza aver controllato i chiamanti.

- [ ] **Step 4: Rimuovere le funzioni ora orfane**

```bash
cd apps/piattaforma/src && grep -rn "isVisuraDateValid\|subtractMonthsUtcDay" .
```
Se restano solo `document-validation.ts` e il suo test: rimuovere da `document-validation.ts` sia `isVisuraDateValid` (righe ~72-88) sia `subtractMonthsUtcDay` (righe ~29-44), e i rispettivi `describe` dal test. **Se compare un altro chiamante, lasciarle e annotarlo nel commit.**

- [ ] **Step 5: Test + typecheck**

```
pnpm -F piattaforma exec vitest run src/lib/kyc/verify.test.ts src/lib/auth/document-validation.test.ts
pnpm -F piattaforma typecheck
```
Atteso: PASS; typecheck exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/kyc/verify.ts apps/piattaforma/src/lib/kyc/verify.test.ts apps/piattaforma/src/lib/auth/document-validation.ts apps/piattaforma/src/lib/auth/document-validation.test.ts
git commit -m "feat(registrazione): niente blocco sull'eta' della visura

Restano ATECO, AZIENDA_MISMATCH, CI/CF_MISMATCH e ILLEGGIBILE. La data
resta obbligatoria e viene estratta: senza, il ciclo a 180 giorni non
sarebbe applicabile."
```

---

### Task 2.2: Avviso "visura già vecchia" allo step 3

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts` (`VerifyDocsResult` righe 709-711; return righe ~777-781)
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (stato + `handleDocuments` righe ~242-255; render `DocumentsStep` righe ~817-825)

**Interfaces:**
- Consumes: `giorniTrascorsi`, `isVisuraScaduta` (Task 1.2)
- Produces: `VerifyDocsResult` con `visuraGiorni?: number`

**Costo zero:** l'OCR gira già qui (`actions.ts:771`) e il risultato è già firmato nel token (`:780`). Si espone solo un numero già calcolato.

- [ ] **Step 1: Estendere il tipo di ritorno**

`actions.ts:709-711` diventa:

```ts
export type VerifyDocsResult =
  | {
      ok: true;
      token?: string;
      /**
       * Giorni di calendario trascorsi dall'emissione della visura appena
       * verificata. Assente in DEMO_MODE (il gate ritorna prima dell'OCR).
       * Serve solo ad AVVISARE: l'età non blocca più la registrazione.
       */
      visuraGiorni?: number;
    }
  | { ok: false; error: string; kycFailures?: import('@/lib/kyc/verify').KycFailure[] };
```

- [ ] **Step 2: Popolarlo**

In `verifyRegistrationDocumentsAction`, sostituire il return di successo (righe ~779-781):

```ts
    // Token firmato legato a QUESTI file: il submit lo usa per non ri-fare l'OCR.
    const token = signKycToken(hashDocs([ci.buffer, cf.buffer, vis.buffer]), kyc.extracted, Date.now());
    return { ok: true, token };
```

con:

```ts
    // Token firmato legato a QUESTI file: il submit lo usa per non ri-fare l'OCR.
    const token = signKycToken(hashDocs([ci.buffer, cf.buffer, vis.buffer]), kyc.extracted, Date.now());
    // L'età non blocca (nessuna regola VISURA_SCADUTA), ma va detta subito: qui
    // l'utente può ancora sostituire la visura, dopo il submit non più.
    const dataEmissione = kyc.extracted.visura.dataEmissione;
    return {
      ok: true,
      token,
      visuraGiorni: dataEmissione
        ? giorniTrascorsi(new Date(`${dataEmissione}T00:00:00Z`), new Date())
        : undefined,
    };
```

e aggiungere in testa a `actions.ts`, accanto agli altri import:

```ts
import { giorniTrascorsi } from '@/lib/visura/validita';
```

- [ ] **Step 3: Portare il dato nel wizard**

In `register-wizard.tsx`, accanto agli altri `useState` (vicino a riga 113):

```ts
  // Giorni della visura appena verificata: >= 180 → avviso "gia' da aggiornare".
  const [visuraGiorni, setVisuraGiorni] = useState<number | null>(null);
```

In `handleDocuments`, nel ramo `if (res.ok)` (righe ~243-247), aggiungere prima di `setStep(4)`:

```ts
        setVisuraGiorni(res.visuraGiorni ?? null);
```

e nel ramo di errore KYC (righe ~248-251) aggiungere `setVisuraGiorni(null);` per non lasciare un avviso stantìo.

- [ ] **Step 4: Renderizzare l'avviso**

Passare la prop a `DocumentsStep` (dove è istanziato, vicino a riga 371-380: `{step === 3 && <DocumentsStep ... />}`) aggiungendo `visuraGiorni={visuraGiorni}`, e aggiungerla alle sue props. Poi, dentro `DocumentsStep`, subito **sopra** l'`<Alert variant="error" title="Verifica documenti non superata">` (righe ~817-825):

```tsx
      {visuraGiorni !== null && visuraGiorni >= VISURA_VALIDITA_GIORNI && (
        <Alert variant="warning" title="Visura camerale da aggiornare">
          La visura che hai caricato è stata emessa <strong>{visuraGiorni} giorni fa</strong> e
          supera i {VISURA_VALIDITA_GIORNI} giorni di validità. Puoi completare la
          registrazione, ma dovrai aggiornarla subito dopo il primo accesso: fino ad allora{' '}
          {tipo === 'DEALER'
            ? 'non potrai prelevare il saldo del wallet'
            : 'non potrai gestire pratiche né riceverne di nuove'}
          . Se hai a disposizione una visura più recente, sostituiscila ora.
        </Alert>
      )}
```

Import in testa a `register-wizard.tsx`:

```ts
import { VISURA_VALIDITA_GIORNI } from '@/lib/visura/validita';
```

> `tipo` è il `CompanyType` già noto al wizard (`data.company.type`). **Leggere il componente** per usare il nome della variabile realmente in scope: se `DocumentsStep` non lo riceve, passarlo come prop insieme a `visuraGiorni`.

- [ ] **Step 5: Typecheck**

```
pnpm -F piattaforma typecheck
```
Atteso: exit code 0.

- [ ] **Step 6: Verifica nel browser (NON saltare)**

`DEMO_MODE=true` non produce `visuraGiorni` (il gate ritorna a `actions.ts:752`): per **vedere** l'avviso serve il gate reale.

1. In `apps/piattaforma/.env.local` mettere `DEMO_MODE=false` e configurare l'OCR reale (vedi memoria "Calibrazione OCR Document AI": project `passaggio-veloce`, eu, processor `af4b73239082e189`).
2. `pnpm -F piattaforma dev`, andare su `/register/dealer`, compilare gli step 1-2.
3. Allo step 3 caricare una visura **vera con più di 180 giorni** (es. quella della fixture reale) + CI e CF coerenti con l'amministratore.
4. **Atteso:** l'Alert giallo compare con il conteggio giorni, e il wizard **avanza comunque** allo step 4.
5. Ripetere con una visura fresca: **nessun** Alert.
6. Rimettere `DEMO_MODE=true` in `.env.local`.

> Se non si dispone di documenti reali coerenti, **dirlo apertamente nel commit e all'utente** invece di dichiarare verificato ciò che non lo è.

- [ ] **Step 7: Commit**

```bash
git add "apps/piattaforma/src/app/(auth)/actions.ts" "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx"
git commit -m "feat(registrazione): avvisa allo step 3 se la visura ha gia' >= 180 giorni"
```

---

# FASE 3 — La sezione di aggiornamento

> **Va rilasciata PRIMA della Fase 4.** È l'unica via d'uscita dal blocco.

## Il flusso di `/visura` è a DUE PASSI

Deciso il 2026-07-16, dopo aver scoperto che la sede legale non è estraibile in modo affidabile:

1. **Carica + verifica** → il server fa OCR, controlla, e **restituisce un'anteprima** dei dati
   estratti (data, ragione sociale, sede legale best-effort). Non scrive nulla.
2. **Conferma** → il titolare rivede la **sede legale** precompilata, la corregge se sbagliata, e
   salva. Solo qui si scrive.

**Vincolo di sicurezza, non negoziabile:** dal client si accetta **SOLO l'indirizzo**.
`visuraCameraleData` e `ragioneSociale` sono **sempre** ri-estratte dal server al passo 2 — mai
prese dal form. La data regge l'intero blocco: renderla modificabile dal client vorrebbe dire
consegnare all'utente la chiave del proprio sblocco (basterebbe un POST con `dataEmissione` di
oggi). La ri-estrazione al passo 2 costa poco: la visura è un PDF di testo, la legge `unpdf` in
locale, e Document AI interviene solo sulle scansioni.

### Task 3.0: `visura-parser.ts` — estrarre la sede legale (best-effort)

**Files:**
- Modify: `apps/piattaforma/src/lib/kyc/visura-parser.ts` (tipo `VisuraData` righe 4-12; `parseVisuraText` riga 24)
- Test: `apps/piattaforma/src/lib/kyc/visura-parser.test.ts`
- Fixture: `apps/piattaforma/src/lib/kyc/__fixtures__/visura-planet-auto.unpdf.txt` (**già esistente, non modificarla**)

**Interfaces:**
- Produces: `VisuraData.sedeLegale?: { comune?: string; provincia?: string; indirizzo?: string; cap?: string }`

**Il problema, in una riga:** nella fixture reale ci sono **quattro** indirizzi e vince il primo che
la regex incontra. Il test che conta non è "estrae un indirizzo" — è **"non estrae quello
sbagliato"**.

| Indirizzo nella fixture | Cos'è |
|---|---|
| `MAGENTA (MI) VIA A. VOLTA 10 CAP 20013` | **sede legale** ← l'unico giusto |
| `SANTO STEFANO TICINO (MI) VIA TRIESTE 21/C CAP 20010` | domicilio dell'**amministratrice** |
| `MILANO (MI) CORSO DI PORTA VITTORIA 18 CAP 20122` | indirizzo di una **socia** (ALL HOLDING S.R.L.) |
| `CASARILE (MI) VIA GIACOMO PUCCINI 63 CAP 20059` | **unità locale** |

- [ ] **Step 1: Scrivere i test dei DISCRIMINATORI (non solo dell'happy path)**

In `visura-parser.test.ts`, accanto ai test esistenti sulla fixture:

```ts
describe('sedeLegale — sulla fixture reale', () => {
  it('estrae la sede legale', () => {
    const v = parseVisuraText(FIXTURE); // helper già presente nel file
    expect(v.sedeLegale?.comune).toBe('MAGENTA');
    expect(v.sedeLegale?.provincia).toBe('MI');
    expect(v.sedeLegale?.indirizzo).toBe('VIA A. VOLTA 10');
    expect(v.sedeLegale?.cap).toBe('20013');
  });

  // I TRE test che contano davvero: il fallimento silenzioso e' pescare
  // l'indirizzo sbagliato, non il non-estrarre.
  it('NON prende il domicilio dell\'amministratrice', () => {
    const v = parseVisuraText(FIXTURE);
    expect(v.sedeLegale?.indirizzo).not.toContain('TRIESTE');
    expect(v.sedeLegale?.comune).not.toBe('SANTO STEFANO TICINO');
  });

  it('NON prende l\'indirizzo della societa\' socia', () => {
    const v = parseVisuraText(FIXTURE);
    expect(v.sedeLegale?.indirizzo).not.toContain('PORTA VITTORIA');
  });

  it('NON prende l\'unita\' locale', () => {
    const v = parseVisuraText(FIXTURE);
    expect(v.sedeLegale?.indirizzo).not.toContain('PUCCINI');
    expect(v.sedeLegale?.cap).not.toBe('20059');
  });

  it('testo senza sede legale → undefined, non un indirizzo a caso', () => {
    expect(parseVisuraText('testo qualunque senza indirizzi').sedeLegale).toBeUndefined();
  });
});
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/kyc/visura-parser.test.ts
```
Atteso: FAIL — `sedeLegale` non esiste.

- [ ] **Step 3: Implementare**

Estendere il tipo (`visura-parser.ts:4-12`):

```ts
export type VisuraData = {
  dataEmissione?: string; // ISO yyyy-mm-dd
  ateco?: string;
  atecoCodes?: string[];
  denominazione?: string;
  partitaIva?: string;
  amministratore?: { nome?: string; cognome?: string; codiceFiscale?: string };
  /**
   * Sede legale, BEST-EFFORT: una visura contiene 4+ indirizzi (sede legale,
   * domicilio dell'amministratore, indirizzi dei soci, unità locali) e il testo
   * unpdf è in ordine di oggetti PDF, non visivo. Non è affidabile al punto da
   * poterci scrivere su una fattura senza che un umano guardi: `/visura` la
   * mostra precompilata al titolare, che conferma o corregge.
   */
  sedeLegale?: { comune?: string; provincia?: string; indirizzo?: string; cap?: string };
  rawText: string;
};
```

e in `parseVisuraText`, prima del `return`:

```ts
  out.sedeLegale = parseSedeLegale(text);
```

Poi la funzione, in coda al file — **stessa strategia di `parseAmministratore`: àncora
semantica, non adiacenza visiva**:

```ts
/**
 * Sede legale dalla visura InfoCamere. BEST-EFFORT: il consumatore DEVE farla
 * confermare da un umano (cfr. /visura).
 *
 * Il testo unpdf non conserva l'ordine visivo, e nella stessa visura convivono
 * l'indirizzo della sede legale, il domicilio dell'amministratore, quelli dei
 * soci e delle unità locali: pescare "il primo VIA … CAP" significa, nella
 * fixture reale, restituire il domicilio di casa dell'amministratrice.
 *
 * Àncora usata: la sequenza InfoCamere `Indirizzo Sede legale` (con e senza
 * spazio: unpdf incolla spesso le etichette → `Sedelegale`) seguita, entro una
 * finestra breve, dal blocco `COMUNE (PR) VIA … CAP NNNNN`.
 *
 * Se l'àncora non c'è: `undefined`. MAI un fallback "primo indirizzo trovato" —
 * un indirizzo sbagliato è peggio di nessun indirizzo, perché finisce in fattura.
 */
function parseSedeLegale(text: string): VisuraData['sedeLegale'] {
  const anchor = /Indirizzo\s*Sede\s*legale/i.exec(text);
  if (!anchor) return undefined;
  const window = text.slice(anchor.index, anchor.index + 400);
  const m =
    /([A-ZÀ-Ù'’\s.]{2,40}?)\s*\(([A-Z]{2})\)\s+((?:VIA|VIALE|CORSO|PIAZZA|PIAZZALE|LARGO|STRADA|LOCALITA'|LOC\.|FRAZIONE|BORGO)\s+[^\n]{2,60}?)\s+CAP\s+(\d{5})/i.exec(
      window,
    );
  if (!m) return undefined;
  return {
    comune: m[1]!.trim(),
    provincia: m[2]!.toUpperCase(),
    indirizzo: m[3]!.trim(),
    cap: m[4],
  };
}
```

> **Aspettativa realistica:** questa regex è tarata su **una sola** visura reale. Se i test dei
> discriminatori non passano, **NON allargare la regex finché non pesca qualcosa**: è così che si
> finisce col domicilio dell'amministratore. Meglio `undefined` (il titolare compila a mano) che
> un indirizzo plausibile e sbagliato. Segnalarlo all'utente e chiedere altre visure reali per
> tarare (cfr. memoria "Corpus regressione reale").

- [ ] **Step 4: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/kyc/visura-parser.test.ts
```
Atteso: PASS, inclusi i tre test "NON prende…". Se passa solo l'happy path e falliscono i
discriminatori: la regex sta pescando l'indirizzo sbagliato → **fermarsi e ripensarla**, non
aggiustare le aspettative.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/kyc/visura-parser.ts apps/piattaforma/src/lib/kyc/visura-parser.test.ts
git commit -m "feat(kyc): estrae la sede legale dalla visura (best-effort, ancora semantica)"
```

---

### Task 3.1: `lib/visura/stato.ts` — lo stato di un'azienda

**Files:**
- Create: `apps/piattaforma/src/lib/visura/stato.ts`
- Test: `apps/piattaforma/src/lib/visura/stato.test.ts`

**Interfaces:**
- Consumes: `isVisuraScaduta`, `isInPreavviso`, `giorniRimanenti`, `giorniTrascorsi` (Task 1.2)
- Produces:
  - `type StatoVisura = { stato: 'OK' | 'PREAVVISO' | 'SCADUTA' | 'ESENTE'; dataEmissione: Date | null; giorniTrascorsi: number | null; giorniRimanenti: number | null }`
  - `getStatoVisura(companyId: string, now?: Date): Promise<StatoVisura>`
  - `isVisuraScadutaCompany(companyId: string, now?: Date): Promise<boolean>` — l'helper che useranno le guard

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/lib/visura/stato.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@pv/db', () => ({ prisma: { company: { findUnique } } }));

import { getStatoVisura, isVisuraScadutaCompany } from './stato';

const NOW = new Date('2026-06-30T12:00:00Z'); // 180 gg dopo il 2026-01-01

beforeEach(() => vi.clearAllMocks());

describe('getStatoVisura', () => {
  it('azienda inesistente → ESENTE (non blocca su un dato che non c\'e\')', async () => {
    findUnique.mockResolvedValue(null);
    expect((await getStatoVisura('x', NOW)).stato).toBe('ESENTE');
  });

  it('visuraCameraleData null → ESENTE', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: null });
    expect((await getStatoVisura('x', NOW)).stato).toBe('ESENTE');
  });

  it('giorno 180 → SCADUTA', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('SCADUTA');
    expect(s.giorniTrascorsi).toBe(180);
    expect(s.giorniRimanenti).toBe(0);
  });

  it('giorno 175 → PREAVVISO con 5 giorni rimanenti', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-06T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('PREAVVISO');
    expect(s.giorniRimanenti).toBe(5);
  });

  it('visura fresca → OK', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-06-01T00:00:00Z') });
    expect((await getStatoVisura('x', NOW)).stato).toBe('OK');
  });
});

describe('isVisuraScadutaCompany', () => {
  it('true solo su SCADUTA', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') });
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(true);
  });

  it('null → false (esente, mai bloccata)', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: null });
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/visura/stato.test.ts
```
Atteso: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

`apps/piattaforma/src/lib/visura/stato.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import {
  giorniRimanenti as calcRimanenti,
  giorniTrascorsi as calcTrascorsi,
  isInPreavviso,
  isVisuraScaduta,
} from './validita';

export type StatoVisura = {
  /** ESENTE = nessuna data nota → mai preavviso, mai blocco. */
  stato: 'OK' | 'PREAVVISO' | 'SCADUTA' | 'ESENTE';
  dataEmissione: Date | null;
  giorniTrascorsi: number | null;
  giorniRimanenti: number | null;
};

/**
 * Stato della visura di un'azienda (madre). Derivato: nessun flag su DB, quindi
 * non può divergere dalla realtà e lo sblocco è automatico appena la data cambia.
 *
 * Multi-sede: la visura sta sulla MADRE (P.IVA unica) → lo stato vale per tutte
 * le sedi. `companyId` è sempre l'id della madre.
 */
export async function getStatoVisura(companyId: string, now: Date = new Date()): Promise<StatoVisura> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { visuraCameraleData: true },
  });
  const d = c?.visuraCameraleData ?? null;
  if (!d) {
    return { stato: 'ESENTE', dataEmissione: null, giorniTrascorsi: null, giorniRimanenti: null };
  }
  const trascorsi = calcTrascorsi(d, now);
  const rimanenti = calcRimanenti(d, now);
  const stato = isVisuraScaduta(d, now) ? 'SCADUTA' : isInPreavviso(d, now) ? 'PREAVVISO' : 'OK';
  return { stato, dataEmissione: d, giorniTrascorsi: trascorsi, giorniRimanenti: rimanenti };
}

/** Helper per le guard: true SOLO se scaduta. Null/esente → false. */
export async function isVisuraScadutaCompany(companyId: string, now: Date = new Date()): Promise<boolean> {
  return (await getStatoVisura(companyId, now)).stato === 'SCADUTA';
}
```

- [ ] **Step 4: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/visura/stato.test.ts
```
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/visura/stato.ts apps/piattaforma/src/lib/visura/stato.test.ts
git commit -m "feat(visura): stato derivato per azienda (OK/PREAVVISO/SCADUTA/ESENTE)"
```

---

### Task 3.2: `lib/visura/aggiorna.ts` — OCR, controlli, update

**Files:**
- Create: `apps/piattaforma/src/lib/visura/aggiorna.ts`
- Test: `apps/piattaforma/src/lib/visura/aggiorna.test.ts`

**Interfaces:**
- Consumes: `extractVisura`/`VisuraData` (Task 3.0), `companyMatches` (`lib/kyc/match.ts`), `isAtecoAllowed` (`lib/kyc/ateco.ts`), `isVisuraScaduta` (Task 1.2), `storageGetBuffer`/`getStorage` (`lib/providers/storage`)
- Produces:
  - `type SedeLegaleInput = { indirizzo: string; civico: string; cap: string; citta: string; provincia: string }`
  - `type VerificaVisuraResult = { ok: true; dataEmissione: string; ragioneSociale: string | null; sedeLegale: VisuraData['sedeLegale']; atecoNonIdoneo: boolean } | { ok: false; error: string }`
  - `verificaVisuraPerAggiornamento(input, deps?): Promise<VerificaVisuraResult>` — **passo 1: non scrive nulla**
  - `type AggiornaVisuraInput = { companyId: string; userId: string; ref: {...}; sedeLegale: SedeLegaleInput; now?: Date }`
  - `type AggiornaVisuraResult = { ok: true; dataEmissione: string; atecoNonIdoneo: boolean } | { ok: false; error: string }`
  - `aggiornaVisura(input, deps?): Promise<AggiornaVisuraResult>` — **passo 2: ri-estrae e scrive**
  - `type AggiornaDeps = { getVisura: (i: { buffer: Buffer; mimeType: string; originalFilename: string }) => Promise<VisuraData> }`

**Controlli, in ordine (identici nei due passi):** leggibilità → P.IVA/ragione sociale = questa azienda → età < 180 → ATECO (**non blocca**, segnala).

**Entrambi i passi ri-eseguono i controlli.** Il passo 1 serve a mostrare l'anteprima, ma **non è autoritativo**: `aggiornaVisura` non si fida di nulla che venga dal client tranne la sede legale. La data e la ragione sociale vengono **sempre** dalla sua estrazione. Estrarre i controlli in una funzione condivisa (`eseguiControlli(company, visura, now)`) evita di scriverli due volte e di farli divergere.

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/lib/visura/aggiorna.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, update, create, txMock, atecoFindMany } = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), txMock: vi.fn(),
  atecoFindMany: vi.fn(),
}));
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findUnique },
    atecoAllowedCode: { findMany: atecoFindMany },
    $transaction: txMock,
  },
  Prisma: {},
}));
vi.mock('@/lib/providers/storage', () => ({
  storageGetBuffer: vi.fn(async () => Buffer.from('pdf')),
  getStorage: () => ({ name: 'local' }),
}));
vi.mock('@/env', () => ({ env: { OCR_PROVIDER: 'mock' } }));

import { aggiornaVisura } from './aggiorna';

const REF = { key: 'visura/x.pdf', name: 'visura.pdf', size: 1000, type: 'application/pdf' };
const NOW = new Date('2026-07-16T12:00:00Z');
const AZIENDA = {
  id: 'c1', type: 'DEALER', ragioneSociale: 'Rossi Auto', partitaIva: '12345678901',
};
const VISURA_OK = {
  dataEmissione: '2026-07-01', partitaIva: '12345678901', denominazione: 'Rossi Auto',
  atecoCodes: ['45.11.01'], rawText: '',
};
const deps = (v: object) => ({ getVisura: vi.fn(async () => v as never) });

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(AZIENDA);
  atecoFindMany.mockResolvedValue([{ companyType: 'DEALER', code: '45.11.01', active: true }]);
  txMock.mockImplementation(async (fn: never) =>
    (fn as unknown as (tx: unknown) => unknown)({
      company: { update }, documento: { create },
    }),
  );
});

describe('aggiornaVisura — controlli', () => {
  it('data illeggibile → rifiuta', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: undefined }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('P.IVA di un\'ALTRA azienda → rifiuta (non e\' un aggiornamento, e\' un mismatch)', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, partitaIva: '99999999999', denominazione: 'Altra Srl' }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('visura gia\' oltre i 180 giorni → rifiuta (non sbloccherebbe nulla)', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: '2024-12-13' }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('ATECO non ammesso → ACCETTA e segnala (mai un vicolo cieco)', async () => {
    atecoFindMany.mockResolvedValue([{ companyType: 'DEALER', code: '45.11.01', active: true }]);
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, atecoCodes: ['99.99.99'] }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.atecoNonIdoneo).toBe(true);
    expect(update).toHaveBeenCalled();
  });
});

describe('aggiornaVisura — cosa scrive', () => {
  it('aggiorna data, ragione sociale e sede legale; MAI la P.IVA ne\' il regime', async () => {
    await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, denominazione: 'Rossi Auto Srl' }));
    const data = update.mock.calls[0]![0].data;
    expect(data.visuraCameraleData).toEqual(new Date('2026-07-01T00:00:00Z'));
    // Gating di un campo = OMETTERE la chiave: calcolarla a null AZZERA il dato.
    expect('partitaIva' in data).toBe(false);
    expect('regimeFiscale' in data).toBe(false);
  });

  it('AGGIUNGE un Documento, non ne sostituisce/cancella nessuno', async () => {
    await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, now: NOW }, deps(VISURA_OK));
    expect(create).toHaveBeenCalledTimes(1);
    const d = create.mock.calls[0]![0].data;
    expect(d.tipo).toBe('VISURA_CAMERALE');
    expect(d.companyId).toBe('c1');
    expect(d.storageKey).toBe(REF.key);
    expect(d.uploadedById).toBe('u1');
    // Nessun soft-delete dei precedenti: il cron purge-deleted-documenti li
    // cancellerebbe e lo storico e' un requisito.
    expect(d.deletedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/visura/aggiorna.test.ts
```
Atteso: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

`apps/piattaforma/src/lib/visura/aggiorna.ts`:

```ts
import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { env } from '@/env';
import { getStorage, storageGetBuffer } from '@/lib/providers/storage';
import { isAtecoAllowed } from '@/lib/kyc/ateco';
import { companyMatches } from '@/lib/kyc/match';
import { extractVisura, type VisuraData } from '@/lib/kyc/visura-parser';
import { isVisuraScaduta, VISURA_VALIDITA_GIORNI } from './validita';

export type AggiornaVisuraInput = {
  companyId: string;
  userId: string;
  ref: { key: string; name: string; size: number; type: string };
  now?: Date;
};

export type AggiornaVisuraResult =
  | { ok: true; dataEmissione: string; atecoNonIdoneo: boolean }
  | { ok: false; error: string };

export type AggiornaDeps = {
  getVisura: (i: { buffer: Buffer; mimeType: string; originalFilename: string }) => Promise<VisuraData>;
};

const defaultDeps: AggiornaDeps = { getVisura: (i) => extractVisura(i) };

/**
 * Aggiorna la visura camerale dell'azienda: OCR, controlli, persistenza.
 *
 * Differenze VOLUTE dal gate di registrazione:
 * - NIENTE cross-match CI/CF dell'amministratore: in 180 giorni può essere
 *   cambiato legittimamente, e rifiutare una visura nuova perché l'admin non è
 *   più quello dell'iscrizione sarebbe un falso positivo.
 * - ATECO non ammesso NON blocca: bloccare qui creerebbe un vicolo cieco
 *   (azienda bloccata senza alcun modo di sbloccarsi). Si accetta e si segnala.
 */
export async function aggiornaVisura(
  input: AggiornaVisuraInput,
  deps: AggiornaDeps = defaultDeps,
): Promise<AggiornaVisuraResult> {
  const now = input.now ?? new Date();

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, type: true, ragioneSociale: true, partitaIva: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };

  let visura: VisuraData;
  try {
    visura = await deps.getVisura({
      buffer: await storageGetBuffer(input.ref.key),
      mimeType: input.ref.type,
      originalFilename: input.ref.name,
    });
  } catch {
    return { ok: false, error: 'Non siamo riusciti a leggere il documento. Riprova tra qualche minuto.' };
  }

  // 1. Leggibilità.
  if (!visura.dataEmissione || (!visura.partitaIva && !visura.denominazione)) {
    return {
      ok: false,
      error: 'Non siamo riusciti a leggere la visura: carica il PDF originale (non una scansione).',
    };
  }

  // 2. È la visura di QUESTA azienda? (Le visure sono documenti pubblici.)
  if (!companyMatches(visura, { denominazione: company.ragioneSociale, partitaIva: company.partitaIva })) {
    return {
      ok: false,
      error: "I dati della visura non corrispondono alla tua azienda (ragione sociale / P.IVA).",
    };
  }

  // 3. Deve essere fresca, altrimenti non sbloccherebbe niente.
  const dataEmissione = new Date(`${visura.dataEmissione}T00:00:00Z`);
  if (isVisuraScaduta(dataEmissione, now)) {
    return {
      ok: false,
      error: `Questa visura è già oltre i ${VISURA_VALIDITA_GIORNI} giorni di validità: caricane una più recente.`,
    };
  }

  // 4. ATECO: segnala, non blocca.
  const allowed = await prisma.atecoAllowedCode.findMany({
    where: { companyType: company.type, active: true },
    select: { companyType: true, code: true, active: true },
  });
  const codes = visura.atecoCodes ?? (visura.ateco ? [visura.ateco] : []);
  const atecoNonIdoneo =
    codes.length > 0 && !codes.some((c) => isAtecoAllowed(c, company.type, allowed));

  const storageProvider = getStorage().name;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: company.id },
      data: {
        // DAL SERVER, sempre: la data regge l'intero blocco. Se arrivasse dal
        // form, all'utente basterebbe un POST con la data di oggi per sbloccarsi.
        visuraCameraleData: dataEmissione,
        ...(visura.denominazione ? { ragioneSociale: visura.denominazione } : {}),
        // DALL'UTENTE, che l'ha confermata o corretta: l'estrazione della sede
        // legale è best-effort (4 indirizzi per visura) e non è affidabile
        // abbastanza da scriverla in fattura senza che un umano la guardi.
        indirizzo: input.sedeLegale.indirizzo,
        civico: input.sedeLegale.civico,
        cap: input.sedeLegale.cap,
        citta: input.sedeLegale.citta,
        provincia: input.sedeLegale.provincia,
        // partitaIva e regimeFiscale NON compaiono di proposito: la chiave va
        // OMESSA, non calcolata a null (null AZZEREREBBE il dato).
      },
    });
    // ADD, non replace: lo storico delle visure è un requisito. Le precedenti
    // NON vanno soft-deletate (purge-deleted-documenti le cancellerebbe).
    await tx.documento.create({
      data: {
        tipo: 'VISURA_CAMERALE',
        companyId: company.id,
        storageKey: input.ref.key,
        storageProvider,
        mimeType: input.ref.type,
        sizeBytes: input.ref.size,
        originalFilename: input.ref.name,
        uploadedById: input.userId,
        ocrStato: 'SUCCESS',
        ocrProvider: env.OCR_PROVIDER,
        ocrData: visura as unknown as Prisma.InputJsonValue,
        ocrAt: new Date(),
        gatingStato: 'PASSED',
      },
    });
  });

  return { ok: true, dataEmissione: visura.dataEmissione, atecoNonIdoneo };
}
```

> **`verificaVisuraPerAggiornamento` (passo 1)** è la stessa funzione senza la `$transaction`: esegue i controlli e ritorna `{ dataEmissione, ragioneSociale, sedeLegale, atecoNonIdoneo }` per precompilare il form. Fattorizzare i controlli in un helper condiviso — **duplicarli qui e là è il modo sicuro per farli divergere** e ritrovarsi il passo 2 più permissivo del passo 1.
>
> **Test aggiuntivi da scrivere per la sede legale:**
> ```ts
> it('la sede legale viene dal FORM, non dall\'OCR', async () => {
>   await aggiornaVisura(
>     { companyId: 'c1', userId: 'u1', ref: REF, now: NOW,
>       sedeLegale: { indirizzo: 'VIA CORRETTA', civico: '1', cap: '20100', citta: 'MILANO', provincia: 'MI' } },
>     deps({ ...VISURA_OK, sedeLegale: { indirizzo: 'VIA SBAGLIATA', comune: 'ROMA', provincia: 'RM', cap: '00100' } }),
>   );
>   const data = update.mock.calls[0]![0].data;
>   expect(data.indirizzo).toBe('VIA CORRETTA'); // vince l'umano
> });
>
> it('la DATA viene dall\'OCR, mai dal chiamante', async () => {
>   await aggiornaVisura(
>     { companyId: 'c1', userId: 'u1', ref: REF, now: NOW,
>       sedeLegale: SEDE_OK, dataEmissione: '2026-07-16' } as never, // tentativo di override
>     deps({ ...VISURA_OK, dataEmissione: '2026-07-01' }),
>   );
>   expect(update.mock.calls[0]![0].data.visuraCameraleData).toEqual(new Date('2026-07-01T00:00:00Z'));
> });
> ```

- [ ] **Step 4: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/visura/aggiorna.test.ts
```
Atteso: PASS.

- [ ] **Step 5: Provare la query di lettura sul DB reale**

I test mockano Prisma: non dimostrano che il `create`/`update` sia valido per lo schema. Verificare la forma su Postgres locale in sola lettura:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "
SELECT tipo, \"companyId\", \"storageKey\", \"ocrStato\", \"gatingStato\", \"createdAt\"
FROM documenti WHERE tipo='VISURA_CAMERALE' AND \"companyId\" IS NOT NULL
ORDER BY \"createdAt\" DESC LIMIT 5;"
```
Atteso: righe esistenti con la stessa forma di campi (conferma che il pattern anagrafico aziendale è quello).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/visura/aggiorna.ts apps/piattaforma/src/lib/visura/aggiorna.test.ts
git commit -m "feat(visura): aggiornamento visura (OCR, controlli, add-non-replace)"
```

---

### Task 3.3: `/visura` — Server Action + pagina

**Files:**
- Create: `apps/piattaforma/src/app/visura/actions.ts`
- Create: `apps/piattaforma/src/app/visura/page.tsx`
- Create: `apps/piattaforma/src/app/visura/client.tsx`
- Test: `apps/piattaforma/src/app/visura/actions.authz.test.ts`

**Interfaces:**
- Consumes: `verificaVisuraPerAggiornamento` + `aggiornaVisura` (3.2), `getStatoVisura` (3.1), `isOwner` (`lib/auth/permissions`), `uploadToBlob`/`BlobRef` (`lib/blob/upload-client`), `Alert` (`components/ui`), `DocCard` (`components/doc-card`), `useFieldErrorsState`/`zodFieldErrors`/`Field` (`@/components/forms`)
- Produces:
  - `verificaVisuraAction(formData): Promise<{ ok: true; dataEmissione: string; sedeLegale: {...} | null; atecoNonIdoneo: boolean } | { ok: false; error: string }>` — passo 1
  - `aggiornaVisuraAction(formData): Promise<{ ok: true; atecoNonIdoneo: boolean } | { ok: false; error: string }>` — passo 2

**Il client è a due schermate:** caricamento → *(verifica)* → form sede legale precompilato → *(conferma)*. Il form della sede legale usa il primitivo `@/components/forms` (`noValidate` obbligatorio, mai rossi all'apertura, CTA sempre attivo → reveal), come tutti gli altri form della piattaforma.

**Entrambe le action ri-verificano `isOwner`.** Ed entrambe prendono il `companyId` **dalla sessione**, mai dal form.

**Pattern di riferimento:** `app/blocco-pagamento/{page,client,actions}.tsx`. Regola dal precedente: **il gate owner si ri-verifica nella Server Action**, non ci si fida della pagina.

- [ ] **Step 1: Scrivere il test di authz che fallisce**

`apps/piattaforma/src/app/visura/actions.authz.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, aggiornaMock } = vi.hoisted(() => ({ authMock: vi.fn(), aggiornaMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/visura/aggiorna', () => ({ aggiornaVisura: aggiornaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { aggiornaVisuraAction } from './actions';

const REF = JSON.stringify({ key: 'visura/x.pdf', name: 'v.pdf', size: 100, type: 'application/pdf' });
const fd = (): FormData => {
  const f = new FormData();
  f.set('blobRef', REF);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  aggiornaMock.mockResolvedValue({ ok: true, dataEmissione: '2026-07-01', atecoNonIdoneo: false });
});

describe('aggiornaVisuraAction — authz', () => {
  it('non loggato → rifiuta, non tocca la visura', async () => {
    authMock.mockResolvedValue(null);
    const r = await aggiornaVisuraAction(fd());
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it('loggato ma NON titolare → rifiuta (il gate non e\' solo nella pagina)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', companyId: 'c1', role: 'OPERATORE' } });
    const r = await aggiornaVisuraAction(fd());
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });

  it('titolare → passa, e usa il companyId della SESSIONE (mai quello del form)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', companyId: 'c1', role: 'ADMIN_AZIENDA' } });
    const f = fd();
    f.set('companyId', 'AZIENDA-DI-QUALCUN-ALTRO'); // tentativo di override
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(true);
    expect(aggiornaMock.mock.calls[0]![0].companyId).toBe('c1');
  });

  it('blobRef malformato → rifiuta', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', companyId: 'c1', role: 'ADMIN_AZIENDA' } });
    const f = new FormData();
    f.set('blobRef', 'non-json');
    const r = await aggiornaVisuraAction(f);
    expect(r.ok).toBe(false);
    expect(aggiornaMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/app/visura/actions.authz.test.ts
```
Atteso: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare la Server Action**

`apps/piattaforma/src/app/visura/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { aggiornaVisura } from '@/lib/visura/aggiorna';

export type AggiornaVisuraActionResult =
  | { ok: true; atecoNonIdoneo: boolean }
  | { ok: false; error: string };

const blobRefSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().positive(),
  type: z.enum(['application/pdf']),
});

/** Sede legale confermata dal titolare. NB: NON contiene la data di emissione
 *  né la ragione sociale — quelle le ri-estrae il server, di proposito. */
const sedeLegaleSchema = z.object({
  indirizzo: z.string().trim().min(2, 'Inserisci l’indirizzo'),
  civico: z.string().trim().min(1, 'Inserisci il civico'),
  cap: z.string().trim().regex(/^\d{5}$/, 'Il CAP deve avere 5 cifre'),
  citta: z.string().trim().min(2, 'Inserisci la città'),
  provincia: z.string().trim().length(2, 'La provincia è di 2 lettere').toUpperCase(),
});

export async function aggiornaVisuraAction(formData: FormData): Promise<AggiornaVisuraActionResult> {
  const session = await auth();
  const u = session?.user;
  if (!u || !u.companyId || !u.id) return { ok: false, error: 'Non autorizzato' };
  // Ri-verifica server-side: la pagina nasconde il form ai non-titolari, ma la
  // Server Action è raggiungibile comunque.
  if (!isOwner(u.role)) {
    return { ok: false, error: "Solo il titolare dell'account può aggiornare la visura camerale" };
  }

  let ref: z.infer<typeof blobRefSchema>;
  try {
    ref = blobRefSchema.parse(JSON.parse(String(formData.get('blobRef') ?? '')));
  } catch {
    return { ok: false, error: 'Carica la visura camerale in PDF' };
  }

  const sedeParsed = sedeLegaleSchema.safeParse({
    indirizzo: formData.get('indirizzo'),
    civico: formData.get('civico'),
    cap: formData.get('cap'),
    citta: formData.get('citta'),
    provincia: formData.get('provincia'),
  });
  if (!sedeParsed.success) return { ok: false, error: 'Controlla i dati della sede legale' };

  const r = await aggiornaVisura({
    // SEMPRE dalla sessione: un companyId dal form sarebbe scavalcabile.
    companyId: u.companyId,
    userId: u.id,
    ref,
    // L'UNICO dato che accettiamo dal client. Data e ragione sociale le
    // ri-estrae il server: vedi il commento in aggiorna.ts.
    sedeLegale: sedeParsed.data,
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath('/visura');
  revalidatePath('/dashboard');
  return { ok: true, atecoNonIdoneo: r.atecoNonIdoneo };
}
```

- [ ] **Step 4: Eseguire i test di authz**

```
pnpm -F piattaforma exec vitest run src/app/visura/actions.authz.test.ts
```
Atteso: PASS, 4 test.

- [ ] **Step 4b: Aggiungere `verificaVisuraAction` (passo 1)**

Stessa forma di `aggiornaVisuraAction` — sessione, `isOwner`, `blobRefSchema` — ma chiama
`verificaVisuraPerAggiornamento` e **non scrive nulla**; ritorna `dataEmissione`, `sedeLegale`
(può essere `null`: il parser è best-effort) e `atecoNonIdoneo`. Aggiungere al test di authz gli
stessi 4 casi (non loggato / non titolare / companyId dalla sessione / blobRef malformato):
**è raggiungibile via POST esattamente come l'altra.**

- [ ] **Step 5: Implementare pagina e client**

> **Il client sotto è la versione a UN passo: va adattato ai DUE passi.** Struttura attesa:
> 1. `DocCard` → `uploadToBlob` → `verificaVisuraAction` → salva in stato `dataEmissione` e `sedeLegale`;
> 2. se ok, appare il form **sede legale precompilata** (`Field` + `useFieldErrorsState`, `noValidate`),
>    con un avviso quando `sedeLegale` è `null`: *"Non siamo riusciti a leggere la sede legale dalla
>    visura: inseriscila tu"* — precompilando in quel caso coi dati attuali dell'azienda;
> 3. il submit chiama `aggiornaVisuraAction` con `blobRef` + i campi della sede.
>
> La data estratta si **mostra** ("Visura emessa il gg/mm/aaaa") ma **non è un campo**: non deve
> esistere un input che la contenga, nemmeno hidden.

`apps/piattaforma/src/app/visura/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { getStatoVisura } from '@/lib/visura/stato';
import { VisuraClient } from './client';

export const metadata = { title: 'Visura camerale' };

export default async function VisuraPage() {
  const session = await auth();
  const u = session?.user;
  if (!u) redirect('/login');
  if (!u.companyId) redirect('/dashboard');

  const stato = await getStatoVisura(u.companyId);

  return (
    <VisuraClient
      isOwner={isOwner(u.role)}
      companyType={u.companyType === 'AGENZIA' ? 'AGENZIA' : 'DEALER'}
      stato={stato.stato}
      giorniTrascorsi={stato.giorniTrascorsi}
      giorniRimanenti={stato.giorniRimanenti}
    />
  );
}
```

`apps/piattaforma/src/app/visura/client.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { DocCard } from '@/components/doc-card';
import { uploadToBlob, type BlobRef } from '@/lib/blob/upload-client';
import { VISURA_VALIDITA_GIORNI } from '@/lib/visura/validita';
import { aggiornaVisuraAction } from './actions';

type Props = {
  isOwner: boolean;
  companyType: 'DEALER' | 'AGENZIA';
  stato: 'OK' | 'PREAVVISO' | 'SCADUTA' | 'ESENTE';
  giorniTrascorsi: number | null;
  giorniRimanenti: number | null;
};

export function VisuraClient({ isOwner, companyType, stato, giorniTrascorsi, giorniRimanenti }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ref, setRef] = useState<BlobRef | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const conseguenza =
    companyType === 'AGENZIA'
      ? 'non puoi gestire pratiche, non ne ricevi di nuove e non puoi prelevare dal wallet'
      : 'non puoi prelevare il saldo del tuo wallet';

  const onFile = async (f: File | null): Promise<void> => {
    setError(null);
    setOk(false);
    setFile(f);
    setRef(null);
    if (!f) return;
    try {
      setRef(await uploadToBlob(f, 'visura'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito');
    }
  };

  const onSubmit = (): void => {
    if (!ref) {
      setError('Carica prima la visura camerale in PDF');
      return;
    }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set('blobRef', JSON.stringify(ref));
      const r = await aggiornaVisuraAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOk(true);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-6">
      <h1 className="text-xl font-bold text-pv-navy-900">Visura camerale</h1>
      <p className="mt-1 text-sm text-pv-navy-700">
        La visura camerale ci serve per fatturarti correttamente. Vale{' '}
        {VISURA_VALIDITA_GIORNI} giorni dalla data di emissione.
      </p>

      {stato === 'SCADUTA' && (
        <Alert variant="error" title="Visura scaduta — operazioni bloccate" className="mt-5">
          La tua visura è stata emessa {giorniTrascorsi} giorni fa e ha superato i{' '}
          {VISURA_VALIDITA_GIORNI} giorni di validità. Finché non ne carichi una aggiornata,{' '}
          {conseguenza}. Lo sblocco è immediato appena il documento viene accettato.
        </Alert>
      )}
      {stato === 'PREAVVISO' && (
        <Alert variant="warning" title="La visura sta per scadere" className="mt-5">
          Mancano {giorniRimanenti} giorni. Alla scadenza {conseguenza}: aggiornala ora per non
          interrompere l&apos;operatività.
        </Alert>
      )}
      {stato === 'OK' && (
        <Alert variant="success" className="mt-5">
          La tua visura è valida: emessa {giorniTrascorsi} giorni fa, ne restano {giorniRimanenti}.
        </Alert>
      )}
      {stato === 'ESENTE' && (
        <Alert variant="info" className="mt-5">
          Non risulta una data di emissione per la tua visura camerale. Puoi caricarne una
          aggiornata quando vuoi.
        </Alert>
      )}

      {ok && (
        <Alert variant="success" title="Visura aggiornata" className="mt-5">
          Grazie: il documento è stato accettato e le operazioni sono di nuovo attive.
        </Alert>
      )}

      {isOwner ? (
        <div className="mt-6">
          <DocCard
            label="Visura camerale (PDF)"
            pdfOnly
            file={file}
            onChange={onFile}
          />
          {error && (
            <Alert variant="error" className="mt-4">
              {error}
            </Alert>
          )}
          <Button
            type="button"
            className="mt-4"
            onClick={onSubmit}
            loading={pending}
            loadingLabel="Verifica in corso…"
            disabled={!ref}
          >
            Aggiorna visura
          </Button>
          <LoadingOverlay show={pending} label="Stiamo verificando la visura…" />
        </div>
      ) : (
        <Alert variant="info" className="mt-6">
          Solo il titolare dell&apos;account può aggiornare la visura camerale. Contattalo per
          procedere.
        </Alert>
      )}
    </div>
  );
}
```

> **Leggere `components/doc-card.tsx` prima di scrivere questo file**: le props reali (`label`, `pdfOnly`, `file`, `onChange`, `uploaded`, `uploadedName`, `uploadedIsPdf`, `invalid`) vanno usate con i nomi esatti. Idem per `Button` (`loading`/`loadingLabel`) e `LoadingOverlay`. **Non inventare firme.**

- [ ] **Step 6: Typecheck**

```
pnpm -F piattaforma typecheck
```
Atteso: exit code 0.

- [ ] **Step 7: Verifica nel browser (NON saltare)**

`/visura` è dietro login. Vedere la memoria "Credenziali dev locali": le password del seed **non** valgono sul DB locale (è copia di prod).

1. `pnpm -F piattaforma dev`, login come `ADMIN_AZIENDA` di un'azienda con `visuraCameraleData` valorizzata.
2. Andare su `/visura`: verificare che lo stato mostrato corrisponda ai giorni reali (confrontare col DB: `SELECT "ragioneSociale", "visuraCameraleData" FROM companies WHERE id='...'`).
3. Caricare un PDF **non** visura → atteso: errore di leggibilità, **nessuna** scrittura su DB.
4. Caricare la visura di **un'altra** azienda → atteso: errore di mismatch.
5. Caricare una visura valida della propria azienda → atteso: appare il **form sede legale
   precompilato** con l'indirizzo estratto. **Controllare che sia la sede legale e non il
   domicilio dell'amministratore**: è il fallimento silenzioso di questa feature.
6. Correggere l'indirizzo a mano e confermare → atteso: banner verde, e su DB:
   ```bash
   docker exec pv-postgres psql -U pv -d passaggio_veloce -c "
   SELECT \"visuraCameraleData\", \"ragioneSociale\", indirizzo, civico, cap, citta, provincia
   FROM companies WHERE id='<ID>';
   SELECT count(*) FROM documenti WHERE \"companyId\"='<ID>' AND tipo='VISURA_CAMERALE';"
   ```
   - la data è quella **della visura**, non di oggi;
   - l'indirizzo è quello **corretto a mano**, non quello estratto → prova che vince l'umano;
   - il conteggio documenti è **AUMENTATO di 1** (add, non replace).
7. Login come utente **non** titolare della stessa azienda → atteso: nessun form, solo l'avviso "solo il titolare".

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/visura
git commit -m "feat(visura): sezione /visura per aggiornare la visura camerale"
```

---

# FASE 4 — Le conseguenze

> Non rilasciare senza la Fase 3 in produzione.

### Task 4.1: Guard payout (broker e agenzia)

**Files:**
- Modify: `apps/piattaforma/src/lib/wallet/payout-exec.ts` (dentro `eseguiPayoutImmediato`, riga ~135)
- Test: `apps/piattaforma/src/lib/wallet/payout-exec.test.ts` (esiste già)

**Interfaces:**
- Consumes: `isVisuraScadutaCompany` (Task 3.1)

**Dove:** dentro la transazione `reserve`, **accanto al guard del wallet negativo** (righe 172-181), che è lo stesso identico schema ("l'azienda ha una pendenza → payout sospeso").

⚠️ `isVisuraScadutaCompany` usa `prisma`, non `tx`: va chiamata **prima** di aprire la transazione, per non annidare una query fuori transazione dentro `$transaction`.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in `payout-exec.test.ts` (adattare i mock a quelli già presenti nel file — **leggerlo prima**):

```ts
it('visura scaduta → payout rifiutato, nessun Payout creato', async () => {
  visuraScadutaMock.mockResolvedValue(true);
  const r = await eseguiPayoutImmediato('w1');
  expect(r.ok).toBe(false);
  expect(payoutCreate).not.toHaveBeenCalled();
});

it('visura valida → payout procede', async () => {
  visuraScadutaMock.mockResolvedValue(false);
  const r = await eseguiPayoutImmediato('w1');
  expect(r.ok).toBe(true);
});
```

con, in testa al file, `vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }))` (dichiarare `visuraScadutaMock` in `vi.hoisted`). **Aggiungere lo stesso mock, che ritorna `false`, in TUTTI i test file che importano `payout-exec`**, altrimenti falliranno con "prisma undefined": cercarli con
```bash
cd apps/piattaforma/src && grep -rln "payout-exec" .
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/wallet/payout-exec.test.ts
```
Atteso: FAIL — il payout viene creato lo stesso.

- [ ] **Step 3: Implementare**

In `payout-exec.ts`, import in testa:

```ts
import { isVisuraScadutaCompany } from '@/lib/visura/stato';
```

Dentro `eseguiPayoutImmediato`, **prima** di `const reserve = await prisma.$transaction(...)` (riga ~144):

```ts
  // Ciclo di vita visura (clausola 5 dei Termini): senza una visura aggiornata
  // non possiamo fatturare correttamente, quindi il payout è sospeso — per il
  // broker è l'UNICA conseguenza, per l'agenzia si somma al blocco operativo.
  // NB: query fuori dalla transazione (usa `prisma`, non `tx`).
  const walletOwner = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { companyId: true, sede: { select: { companyId: true } } },
  });
  const ownerCompanyId = walletOwner?.companyId ?? walletOwner?.sede?.companyId ?? null;
  if (ownerCompanyId && (await isVisuraScadutaCompany(ownerCompanyId))) {
    return {
      ok: false,
      error:
        'La visura camerale della tua azienda è scaduta: i prelievi sono sospesi finché non la aggiorni.',
    };
  }
```

> **Attenzione al tipo di ritorno:** `EseguiPayoutResult` — leggerlo e usare la forma d'errore già in uso nel file (righe 150-160), non inventarne una nuova.

- [ ] **Step 4: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/wallet/
pnpm -F piattaforma typecheck
```
Atteso: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/wallet/payout-exec.ts apps/piattaforma/src/lib/wallet/payout-exec.test.ts
git commit -m "feat(visura): payout sospeso a visura scaduta"
```

---

### Task 4.2: Blocco operatività agenzia

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts` (riga ~39)
- Modify: `apps/piattaforma/src/app/inbox/actions.ts` (riga ~33)
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts` (riga ~164)

**Interfaces:**
- Consumes: `isVisuraScadutaCompany` (Task 3.1)

**Sono gli stessi tre punti** dove è già agganciato `isAgenziaBloccata`: si affianca la nuova condizione. **Solo AGENZIA**: il broker con visura scaduta continua a operare.

- [ ] **Step 1: Scrivere i test che falliscono**

In `apps/piattaforma/src/app/pratiche/actions.authz.test.ts` (esiste, riga 44 mocka già `@/lib/fee/blocco`), aggiungere il mock di `@/lib/visura/stato` e un test:

```ts
it('agenzia con visura scaduta → non puo\' lavorare la pratica', async () => {
  visuraScadutaMock.mockResolvedValue(true);
  await expect(/* la action di lavorazione, come negli altri test del file */)
    .rejects.toThrow(); // redirect() lancia in Next
});
```

> **Leggere il file prima**: replicare esattamente lo stile con cui testa `isAgenziaBloccata` (`redirect` mockato o meno). Aggiungere `vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: vi.fn(() => Promise.resolve(false)) }))` in **tutti** i test file che importano questi moduli:
> ```bash
> cd apps/piattaforma/src && grep -rln "fee/blocco" .
> ```
> (sono gli stessi che serviranno qui).

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/app/pratiche/actions.authz.test.ts
```
Atteso: FAIL.

- [ ] **Step 3: Implementare nei tre punti**

In ciascuno dei tre file, accanto alla riga con `isAgenziaBloccata`, aggiungere:

```ts
import { isVisuraScadutaCompany } from '@/lib/visura/stato';
```

e subito **dopo** il check esistente:

```ts
  // Ciclo di vita visura: senza visura aggiornata non possiamo fatturare
  // all'agenzia → operatività sospesa (Termini, clausola 12). Vale SOLO per le
  // agenzie: il broker con visura scaduta perde solo il payout e continua a
  // creare pratiche.
  if (await isVisuraScadutaCompany(agenziaId)) redirect('/visura');
```

> `agenziaId` è la variabile già in scope usata da `isAgenziaBloccata` in quel punto: **usare il nome reale del file**, non questo segnaposto. In `inbox/actions.ts:33` il pattern non è `redirect` ma un return: **replicare la forma locale**, non imporne una nuova.

- [ ] **Step 4: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/app/pratiche src/app/inbox src/lib/pratiche
pnpm -F piattaforma typecheck
```
Atteso: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/actions.ts apps/piattaforma/src/app/inbox/actions.ts apps/piattaforma/src/lib/pratiche/firma-engine.ts apps/piattaforma/src/app/pratiche/actions.authz.test.ts
git commit -m "feat(visura): agenzia con visura scaduta non lavora le pratiche"
```

---

### Task 4.3: Esclusione dalla distribuzione

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts:164`
- Test: `apps/piattaforma/src/lib/distribuzione/` (test esistenti del tick)

**Interfaces:**
- Consumes: `limiteVisuraUtc` (Task 1.2)

**Questa è la query più rischiosa della feature:** sbagliare il verso della disuguaglianza esclude in silenzio agenzie sane. La forma è già stata validata su Postgres reale (spec, sezione Punto 4).

- [ ] **Step 1: Implementare il filtro**

In `tick.ts`, import in testa:

```ts
import { limiteVisuraUtc } from '@/lib/visura/validita';
```

Sostituire la riga 164:

```ts
      company: { deletedAt: null, suspendedAt: null, bloccoPagamentoAt: null },
```

con:

```ts
      company: {
        deletedAt: null,
        suspendedAt: null,
        bloccoPagamentoAt: null,
        // Ciclo di vita visura: un'agenzia con visura scaduta non riceve nuove
        // pratiche. La visura sta sulla MADRE → escludendo la madre escono tutte
        // le sue sedi, che è il comportamento voluto.
        // `null` = ESENTE, deve restare idonea: senza questo ramo escluderemmo
        // tutte le aziende senza data (oggi 9 agenzie su 10).
        OR: [
          { visuraCameraleData: null },
          { visuraCameraleData: { gt: limiteVisuraUtc(now) } },
        ],
      },
```

> `now` è già un parametro in scope nella funzione del tick (usato a `handleNoCandidates(tx, pratica.id, round, now)`, riga 151). **Verificarlo**; se non lo fosse, passarlo dall'alto — **non** chiamare `new Date()` qui dentro: renderebbe il tick non testabile in modo deterministico.

- [ ] **Step 2: Scrivere il test**

Nel test del tick già esistente, aggiungere il caso: una sede la cui madre ha `visuraCameraleData` a 200 giorni **non** compare fra i candidati; una con `null` **sì**. **Leggere il file di test prima** per riusarne i factory.

- [ ] **Step 3: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/distribuzione/
pnpm -F piattaforma typecheck
```
Atteso: PASS; typecheck exit 0.

- [ ] **Step 4: Verificare la query sul DB reale**

I test mockano Prisma: non provano che il `where` sia valido. Rieseguire l'equivalente SQL già validato:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "
WITH p AS (SELECT DATE '2026-07-16' AS oggi)
SELECT s.nome, c.\"visuraCameraleData\",
       CASE WHEN c.\"visuraCameraleData\" IS NULL
              OR c.\"visuraCameraleData\" > ((SELECT oggi FROM p) - 180)
            THEN 'IDONEA' ELSE 'esclusa' END AS esito
FROM sedi s JOIN companies c ON c.id = s.\"companyId\"
WHERE s.type='AGENZIA' AND s.\"deletedAt\" IS NULL AND s.\"suspendedAt\" IS NULL
  AND c.\"deletedAt\" IS NULL AND c.\"suspendedAt\" IS NULL AND c.\"bloccoPagamentoAt\" IS NULL;"
```
Atteso: `AGENZIA CORSICO` (580 gg) → `esclusa`; tutte le `null` → `IDONEA`.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/
git commit -m "feat(visura): agenzia con visura scaduta esclusa dalla distribuzione"
```

---

### Task 4.4: Il banner

**Files:**
- Create: `apps/piattaforma/src/components/visura-banner.tsx`
- Modify: le pagine operative dove va mostrato

**Interfaces:**
- Consumes: `getStatoVisura` (3.1)
- Produces: `<VisuraBanner companyId={string} companyType={'DEALER'|'AGENZIA'} />` — Server Component, `null` se OK/ESENTE

- [ ] **Step 1: Implementare il componente**

`apps/piattaforma/src/components/visura-banner.tsx`:

```tsx
import Link from 'next/link';
import { Alert } from '@/components/ui';
import { getStatoVisura } from '@/lib/visura/stato';
import { VISURA_VALIDITA_GIORNI } from '@/lib/visura/validita';

/**
 * Banner del ciclo di vita visura. Server Component: legge lo stato derivato e
 * si auto-annulla quando non c'è nulla da dire (OK / ESENTE), come DemoBanner.
 */
export async function VisuraBanner({
  companyId,
  companyType,
}: {
  companyId: string;
  companyType: 'DEALER' | 'AGENZIA';
}) {
  const s = await getStatoVisura(companyId);
  if (s.stato === 'OK' || s.stato === 'ESENTE') return null;

  const conseguenza =
    companyType === 'AGENZIA'
      ? 'non puoi gestire pratiche, non ne ricevi di nuove e non puoi prelevare dal wallet'
      : 'non puoi prelevare il saldo del tuo wallet';

  if (s.stato === 'SCADUTA') {
    return (
      <Alert variant="error" title="Visura camerale scaduta — operazioni bloccate">
        La tua visura è stata emessa {s.giorniTrascorsi} giorni fa e ha superato i{' '}
        {VISURA_VALIDITA_GIORNI} giorni di validità: ci serve aggiornata per poterti fatturare
        correttamente. Finché non la carichi, {conseguenza}.{' '}
        <Link href="/visura" className="font-semibold underline">
          Aggiorna la visura
        </Link>{' '}
        — lo sblocco è immediato.
      </Alert>
    );
  }
  return (
    <Alert variant="warning" title="La visura camerale sta per scadere">
      Mancano {s.giorniRimanenti} giorni alla scadenza. Dopo, {conseguenza}.{' '}
      <Link href="/visura" className="font-semibold underline">
        Aggiornala ora
      </Link>
      .
    </Alert>
  );
}
```

- [ ] **Step 2: Collocarlo**

Mostrarlo nelle pagine operative — **le stesse dove è già agganciato `redirectSeAgenziaBloccata`** più la dashboard: `app/dashboard/page.tsx`, `app/pratiche/page.tsx`, `app/inbox/page.tsx`, `app/wallet/page.tsx`.

In ciascuna, in cima al contenuto:

```tsx
{u.companyId && (
  <VisuraBanner companyId={u.companyId} companyType={u.companyType === 'AGENZIA' ? 'AGENZIA' : 'DEALER'} />
)}
```

> **Leggere ogni pagina prima**: il nome della variabile di sessione (`u`, `session.user`, …) e il punto d'inserimento cambiano. `/wallet` è particolarmente importante per il broker: è lì che scopre perché non può prelevare.

- [ ] **Step 3: Typecheck**

```
pnpm -F piattaforma typecheck
```
Atteso: exit code 0.

- [ ] **Step 4: Verifica nel browser (NON saltare — questo è un componente React)**

Il banner ha due varianti e una condizione di auto-annullamento: i test non lo dimostrano, **solo il browser lo vede**.

1. Su DB locale, portare un'azienda di test a visura scaduta:
   ```bash
   docker exec pv-postgres psql -U pv -d passaggio_veloce -c "
   UPDATE companies SET \"visuraCameraleData\" = CURRENT_DATE - 200 WHERE id='<ID-TEST>';"
   ```
2. Login con quell'azienda → `/dashboard`: **atteso** banner rosso con il testo giusto per il tipo.
3. Cliccare "Aggiorna la visura" → deve portare a `/visura`.
4. Portarla in preavviso (`CURRENT_DATE - 177`) → **atteso** banner giallo con "Mancano 3 giorni".
5. Rimetterla fresca (`CURRENT_DATE - 10`) → **atteso** nessun banner.
6. Metterla a `NULL` → **atteso** nessun banner (esente).
7. **Ripristinare il valore originale** dell'azienda di test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/components/visura-banner.tsx apps/piattaforma/src/app/dashboard/page.tsx apps/piattaforma/src/app/pratiche/page.tsx apps/piattaforma/src/app/inbox/page.tsx apps/piattaforma/src/app/wallet/page.tsx
git commit -m "feat(visura): banner giallo (preavviso) e rosso (blocco)"
```

---

# FASE 5 — Notifiche e cron (dormiente su Hobby)

### Task 5.1: I 4 nuovi `NotificaTipo`

**Files:**
- Modify: `packages/db/prisma/schema.prisma:322`
- Create: `packages/db/prisma/migrations/20260716120000_notifica_visura_n46_n49/migration.sql`

**⚠️ MAI `pnpm db:migrate`**: `prisma migrate dev` propone DROP SEQUENCE su questo schema. Migration scritta **a mano** + `db:deploy`.

- [ ] **Step 1: Aggiungere i valori all'enum**

In `schema.prisma`, dopo `N45_UTENTE_SOSPESO` (riga 322):

```prisma
  N46_VISURA_IN_SCADENZA
  N47_VISURA_SCADUTA
  N48_BROKER_PRATICA_CONGELATA
  N49_ADMIN_ATECO_NON_IDONEO
```

- [ ] **Step 2: Scrivere la migration a mano**

`packages/db/prisma/migrations/20260716120000_notifica_visura_n46_n49/migration.sql`:

```sql
-- Ciclo di vita visura camerale: preavviso, scadenza, congelamento pratiche,
-- segnalazione ATECO non idoneo all'aggiornamento.
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N46_VISURA_IN_SCADENZA';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N47_VISURA_SCADUTA';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N48_BROKER_PRATICA_CONGELATA';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N49_ADMIN_ATECO_NON_IDONEO';
```

> Seguire il pattern di `20260708170100_notifica_n41_n42_segnalazione/migration.sql`.

- [ ] **Step 3: Applicare in locale e rigenerare il client**

```
nvm use 22.15.0
pnpm -F @pv/db db:deploy
pnpm -F @pv/db exec prisma generate
```

- [ ] **Step 4: Verificare sul DB**

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
WHERE t.typname='NotificaTipo' AND enumlabel LIKE 'N4%' ORDER BY enumlabel;"
```
Atteso: N40…N49 con i 4 nuovi presenti.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260716120000_notifica_visura_n46_n49
git commit -m "feat(db): NotificaTipo N46-N49 per il ciclo visura"
```

---

### Task 5.2: I template

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (tipi nel blocco che finisce a riga ~263; funzioni in coda)
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts`

**Interfaces:**
- Produces: `N46VisuraInScadenzaPayload`, `N47VisuraScadutaPayload`, `N48BrokerPraticaCongelataPayload`, `N49AdminAtecoNonIdoneoPayload` + `tplN46VisuraInScadenza`, `tplN47VisuraScaduta`, `tplN48BrokerPraticaCongelata`, `tplN49AdminAtecoNonIdoneo`, tutte `(p) => NotificaContent`.

- [ ] **Step 1: Scrivere i test che falliscono**

In `templates.test.ts`, seguendo il pattern di `describe('N9 addebito fallito agenzia')` (riga ~186):

```ts
describe('N46 visura in scadenza', () => {
  it('dice quanti giorni restano e cosa succede, differenziando broker e agenzia', () => {
    const broker = tplN46VisuraInScadenza({
      nomeAzienda: 'Rossi Auto', companyType: 'DEALER', giorniRimanenti: 3,
      rimedioUrl: 'https://app.test/visura',
    });
    expect(broker.subject).toContain('3');
    expect(broker.text).toContain('prelie'); // broker: solo payout
    expect(broker.html).toContain('https://app.test/visura');

    const agenzia = tplN46VisuraInScadenza({
      nomeAzienda: 'Agenzia X', companyType: 'AGENZIA', giorniRimanenti: 1,
      rimedioUrl: 'https://app.test/visura',
    });
    expect(agenzia.text).toContain('pratiche'); // agenzia: operativita'
  });

  it('escapa l\'HTML nel nome azienda', () => {
    const c = tplN46VisuraInScadenza({
      nomeAzienda: '<script>x</script>', companyType: 'DEALER', giorniRimanenti: 2,
      rimedioUrl: 'https://app.test/visura',
    });
    expect(c.html).not.toContain('<script>');
  });
});

describe('N47 visura scaduta', () => {
  it('dice che il blocco e\' gia\' attivo', () => {
    const c = tplN47VisuraScaduta({
      nomeAzienda: 'Agenzia X', companyType: 'AGENZIA', rimedioUrl: 'https://app.test/visura',
    });
    expect(c.subject.toLowerCase()).toContain('scadut');
    expect(c.html).toContain('https://app.test/visura');
  });
});
```

> Aggiungere `tplN46VisuraInScadenza`/`tplN47VisuraScaduta`/… all'import in testa al test file.

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/notifiche/templates.test.ts
```
Atteso: FAIL — funzioni inesistenti.

- [ ] **Step 3: Implementare i tipi**

In `templates.ts`, nel blocco tipi (prima di `NotificaContent`, riga ~265):

```ts
/**
 * `visuraData` (ISO yyyy-mm-dd) NON si usa nel testo dell'email: è la CHIAVE DI
 * DEDUPLICAZIONE del cron, che la rilegge da `NotificaInviata.payload`
 * (`payload->>'visuraData'`, colonna jsonb). Sta nel payload perché è l'unico
 * posto che `sendNotification` persiste. Ancorandola alla data della visura, un
 * nuovo caricamento cambia la chiave e riarma da solo il ciclo di avvisi.
 * Toglierla = il cron rispedisce le stesse email ogni giorno, per sempre.
 */
export type N46VisuraInScadenzaPayload = {
  nomeAzienda: string;
  companyType: 'DEALER' | 'AGENZIA';
  giorniRimanenti: number;
  rimedioUrl: string;
  visuraData: string;
};

export type N47VisuraScadutaPayload = {
  nomeAzienda: string;
  companyType: 'DEALER' | 'AGENZIA';
  rimedioUrl: string;
  visuraData: string;
  giorniTrascorsi: number;
};

export type N48BrokerPraticaCongelataPayload = {
  nomeBroker: string;
  nomeAgenzia: string;
  praticaId: string;
  praticaUrl: string;
  visuraData: string;
};

export type N49AdminAtecoNonIdoneoPayload = {
  nomeAzienda: string;
  companyType: 'DEALER' | 'AGENZIA';
  atecoCodes: string;
  adminUrl: string;
};
```

- [ ] **Step 4: Implementare i template**

In coda a `templates.ts`:

```ts
/** Conseguenza della visura scaduta, differenziata per tipo: il broker perde
 *  solo il payout, l'agenzia si ferma del tutto. */
function conseguenzaVisura(t: 'DEALER' | 'AGENZIA'): string {
  return t === 'AGENZIA'
    ? 'non potrai gestire pratiche, non ne riceverai di nuove e non potrai prelevare dal wallet'
    : 'non potrai prelevare il saldo del tuo wallet';
}

export function tplN46VisuraInScadenza(p: N46VisuraInScadenzaPayload): NotificaContent {
  const g = p.giorniRimanenti;
  const giorni = g === 1 ? '1 giorno' : `${g} giorni`;
  const subject = `La tua visura camerale scade fra ${giorni}`;
  const cons = conseguenzaVisura(p.companyType);
  const text =
    `Ciao ${p.nomeAzienda},\n` +
    `la visura camerale che ci hai fornito scade fra ${giorni}.\n` +
    `Ci serve aggiornata per poterti fatturare correttamente: alla scadenza ${cons}, ` +
    `finché non ne carichi una nuova.\n` +
    `Aggiornala qui: ${p.rimedioUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#b45309">La visura camerale sta per scadere</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAzienda)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la visura camerale che ci hai fornito scade <strong>fra ${escapeHtml(giorni)}</strong>.
      Ci serve aggiornata per poterti fatturare correttamente: alla scadenza ${escapeHtml(cons)},
      finché non ne carichi una nuova.
    </p>
    ${ctaButton(p.rimedioUrl, 'Aggiorna la visura')}
  `);
  return { subject, html, text };
}

export function tplN47VisuraScaduta(p: N47VisuraScadutaPayload): NotificaContent {
  const subject = 'Visura camerale scaduta — operazioni bloccate';
  const cons = conseguenzaVisura(p.companyType);
  const text =
    `Ciao ${p.nomeAzienda},\n` +
    `la visura camerale che ci hai fornito è scaduta. Da ora ${cons}.\n` +
    `L'accesso alla Piattaforma resta attivo. Lo sblocco è immediato appena carichi una visura aggiornata.\n` +
    `Aggiornala qui: ${p.rimedioUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Visura camerale scaduta</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAzienda)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la visura camerale che ci hai fornito è scaduta: ci serve aggiornata per poterti fatturare
      correttamente. <strong>Da ora ${escapeHtml(cons)}</strong>.
      L&apos;accesso alla Piattaforma resta attivo.
    </p>
    ${ctaButton(p.rimedioUrl, 'Aggiorna la visura')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Lo sblocco è immediato appena il documento viene accettato.
    </p>
  `);
  return { subject, html, text };
}

export function tplN48BrokerPraticaCongelata(p: N48BrokerPraticaCongelataPayload): NotificaContent {
  const subject = 'Una tua pratica è temporaneamente ferma';
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica affidata a ${p.nomeAgenzia} è temporaneamente ferma: l'agenzia deve aggiornare ` +
    `la propria visura camerale prima di poterla lavorare.\n` +
    `Non devi fare nulla: riprenderà appena l'agenzia avrà regolarizzato.\n` +
    `Dettagli: ${p.praticaUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#b45309">Una tua pratica è temporaneamente ferma</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica affidata a <strong>${escapeHtml(p.nomeAgenzia)}</strong> è temporaneamente ferma:
      l&apos;agenzia deve aggiornare la propria visura camerale prima di poterla lavorare.
      <strong>Non devi fare nulla</strong>: riprenderà appena avrà regolarizzato.
    </p>
    ${ctaButton(p.praticaUrl, 'Vedi la pratica')}
  `);
  return { subject, html, text };
}

export function tplN49AdminAtecoNonIdoneo(p: N49AdminAtecoNonIdoneoPayload): NotificaContent {
  const subject = `ATECO non idoneo dopo aggiornamento visura — ${p.nomeAzienda}`;
  const text =
    `${p.nomeAzienda} (${p.companyType}) ha aggiornato la visura camerale, ma i codici ATECO ` +
    `risultanti (${p.atecoCodes}) non rientrano fra quelli ammessi.\n` +
    `La visura è stata ACCETTATA (per non lasciare l'azienda bloccata senza via d'uscita): valutare il caso.\n` +
    `Scheda azienda: ${p.adminUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#b45309">ATECO non idoneo dopo aggiornamento visura</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.nomeAzienda)}</strong> (${escapeHtml(p.companyType)}) ha aggiornato la
      visura camerale, ma i codici ATECO risultanti (<strong>${escapeHtml(p.atecoCodes)}</strong>)
      non rientrano fra quelli ammessi.
    </p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      La visura è stata <strong>accettata</strong>, per non lasciare l&apos;azienda bloccata senza
      via d&apos;uscita autonoma. Valutare il caso.
    </p>
    ${ctaButton(p.adminUrl, 'Apri la scheda azienda')}
  `);
  return { subject, html, text };
}
```

- [ ] **Step 5: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/notifiche/templates.test.ts
```
Atteso: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/templates.test.ts
git commit -m "feat(notifiche): template N46-N49 del ciclo visura"
```

---

### Task 5.3: Cablare `send.ts`

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts` (import ~31 e ~63; union ~197-201; `render()` ~267-268)

**Il safety net è il typecheck**, non i test: `render()` è uno switch esaustivo senza `default`, quindi un ramo di union senza `case` dà **TS2366**.

- [ ] **Step 1: Aggiungere gli import**

Ai tpl (dopo `tplN45UtenteSospeso`, riga ~31):

```ts
  tplN46VisuraInScadenza,
  tplN47VisuraScaduta,
  tplN48BrokerPraticaCongelata,
  tplN49AdminAtecoNonIdoneo,
```

ai type (dopo `N45UtenteSospesoPayload`, riga ~63):

```ts
  type N46VisuraInScadenzaPayload,
  type N47VisuraScadutaPayload,
  type N48BrokerPraticaCongelataPayload,
  type N49AdminAtecoNonIdoneoPayload,
```

- [ ] **Step 2: Estendere la union `SendInput`**

Sostituire la chiusura dell'ultimo ramo (`N45_UTENTE_SOSPESO`, riga ~201: `};` → `}`) e accodare:

```ts
  | { tipo: 'N46_VISURA_IN_SCADENZA'; target: Target; payload: N46VisuraInScadenzaPayload }
  | { tipo: 'N47_VISURA_SCADUTA'; target: Target; payload: N47VisuraScadutaPayload }
  | { tipo: 'N48_BROKER_PRATICA_CONGELATA'; target: Target; payload: N48BrokerPraticaCongelataPayload }
  | { tipo: 'N49_ADMIN_ATECO_NON_IDONEO'; target: Target; payload: N49AdminAtecoNonIdoneoPayload };
```

- [ ] **Step 3: Verificare che il typecheck FALLISCA**

```
pnpm -F piattaforma typecheck
```
Atteso: **TS2366** su `render()` — "Function lacks ending return statement". È la prova che lo switch esaustivo funziona da rete di sicurezza.

- [ ] **Step 4: Aggiungere i `case`**

In `render()`, dopo `case 'N45_UTENTE_SOSPESO':` (riga ~267-268):

```ts
    case 'N46_VISURA_IN_SCADENZA':
      return tplN46VisuraInScadenza(input.payload);
    case 'N47_VISURA_SCADUTA':
      return tplN47VisuraScaduta(input.payload);
    case 'N48_BROKER_PRATICA_CONGELATA':
      return tplN48BrokerPraticaCongelata(input.payload);
    case 'N49_ADMIN_ATECO_NON_IDONEO':
      return tplN49AdminAtecoNonIdoneo(input.payload);
```

- [ ] **Step 5: Typecheck verde + verifica che NON siano opzionali**

```
pnpm -F piattaforma typecheck
pnpm -F piattaforma exec vitest run src/lib/notifiche/preferences.test.ts
```
Atteso: typecheck exit 0; `preferences.test.ts` PASS **senza modifiche** — conferma che N46-N49 non sono finite in `OPTIONAL_TIPI` (non sono disattivabili: un avviso che precede un blocco non è marketing).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/send.ts
git commit -m "feat(notifiche): cabla N46-N49 in send()"
```

---

### Task 5.4: Il job del preavviso

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/preavviso-visura.ts`
- Test: `apps/piattaforma/src/lib/jobs/preavviso-visura.test.ts`

**Interfaces:**
- Consumes: `sendNotification`, `limiteVisuraUtc`/`giorniTrascorsi`/`giorniRimanenti` (1.2)
- Produces: `preavvisoVisura(now?: Date): Promise<{ inScadenza: number; scadute: number; congelate: number }>`

**Idempotenza — il cuore della task.** `sendNotification` **non deduplica**: crea una riga e spedisce, ogni volta. Senza guardia, il cron manda N46 ogni giorno per sempre.

- **N46**: `175 <= età <= 179` **e** nessun N46 con quella `payload.visuraData` **nella giornata odierna** → 1 al giorno, max 5.
- **N47/N48**: `età >= 180` **e** nessun N47/N48 con quella `visuraData` → **una sola volta per ciclo**.
- L'ancoraggio è **`payload.visuraData`**: una visura nuova ha data diversa → nessun match → gli avvisi **si riarmano da soli**, senza stato da resettare.
- `>=` e **non** `== 180`: con l'uguaglianza esatta, un cron saltato (deploy, outage) = **nessuna email, mai**.

- [ ] **Step 1: Scrivere il test che fallisce**

`apps/piattaforma/src/lib/jobs/preavviso-visura.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { companyFindMany, notificaFindFirst, sendMock, praticaFindMany } = vi.hoisted(() => ({
  companyFindMany: vi.fn(), notificaFindFirst: vi.fn(), sendMock: vi.fn(), praticaFindMany: vi.fn(),
}));
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findMany: companyFindMany },
    notificaInviata: { findFirst: notificaFindFirst },
    pratica: { findMany: praticaFindMany },
  },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));

import { preavvisoVisura } from './preavviso-visura';

const NOW = new Date('2026-06-30T08:00:00Z');
const azienda = (over: object) => ({
  id: 'c1', type: 'DEALER', ragioneSociale: 'Rossi Auto',
  visuraCameraleData: new Date('2026-01-06T00:00:00Z'), // 175 gg → preavviso
  users: [{ id: 'u1', email: 'admin@rossi.it' }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  notificaFindFirst.mockResolvedValue(null);
  praticaFindMany.mockResolvedValue([]);
});

describe('preavvisoVisura', () => {
  it('giorno 175 → manda N46 all\'email dell\'ADMIN_AZIENDA', async () => {
    companyFindMany.mockResolvedValue([azienda({})]);
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza).toBe(1);
    const call = sendMock.mock.calls[0]![0];
    expect(call.tipo).toBe('N46_VISURA_IN_SCADENZA');
    expect(call.target.email).toBe('admin@rossi.it');
    expect(call.payload.giorniRimanenti).toBe(5);
  });

  it('N46 gia\' mandata OGGI per questa visura → non rimanda', async () => {
    companyFindMany.mockResolvedValue([azienda({})]);
    notificaFindFirst.mockResolvedValue({ id: 'n1' });
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('la dedup e\' ancorata a payload.visuraData (una visura nuova riarma il ciclo)', async () => {
    companyFindMany.mockResolvedValue([azienda({})]);
    await preavvisoVisura(NOW);
    const where = notificaFindFirst.mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('2026-01-06');
  });

  it('giorno 180 → N47 (scaduta), non N46', async () => {
    companyFindMany.mockResolvedValue([
      azienda({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    const r = await preavvisoVisura(NOW);
    expect(r.scadute).toBe(1);
    expect(r.inScadenza).toBe(0);
    expect(sendMock.mock.calls[0]![0].tipo).toBe('N47_VISURA_SCADUTA');
  });

  it('N47 e\' una-tantum per ciclo, N46 no', async () => {
    companyFindMany.mockResolvedValue([
      azienda({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    notificaFindFirst.mockResolvedValue({ id: 'gia-mandata' });
    const r = await preavvisoVisura(NOW);
    expect(r.scadute).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('agenzia scaduta con pratiche in volo → N48 al broker', async () => {
    companyFindMany.mockResolvedValue([
      azienda({ type: 'AGENZIA', visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    praticaFindMany.mockResolvedValue([
      { id: 'p1', broker: { ragioneSociale: 'Broker X', users: [{ id: 'b1', email: 'b@x.it' }] } },
    ]);
    const r = await preavvisoVisura(NOW);
    expect(r.congelate).toBe(1);
    expect(sendMock.mock.calls.some((c) => c[0].tipo === 'N48_BROKER_PRATICA_CONGELATA')).toBe(true);
  });

  it('azienda senza data visura → ignorata (esente)', async () => {
    companyFindMany.mockResolvedValue([]);
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza + r.scadute).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

```
pnpm -F piattaforma exec vitest run src/lib/jobs/preavviso-visura.test.ts
```
Atteso: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

`apps/piattaforma/src/lib/jobs/preavviso-visura.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';
import {
  giorniRimanenti,
  giorniTrascorsi,
  isInPreavviso,
  isVisuraScaduta,
} from '@/lib/visura/validita';
import { STATI_IN_CORSO } from '@/lib/pratiche/stati';
import { romeYmd, romeStartOfDay, romeEndOfDay } from '@/lib/date/rome-day';

/** `Company.visuraCameraleData` (@db.Date) → la stringa usata come chiave di dedup. */
function visuraKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Preavviso e notifica di scadenza della visura camerale. Girato 1x/giorno.
 *
 * IDEMPOTENZA — indispensabile: `sendNotification` NON deduplica (crea una riga
 * `NotificaInviata` e spedisce, a ogni chiamata). Senza la guardia qui sotto il
 * cron manderebbe N46 ogni giorno all'infinito.
 *
 * L'ancoraggio è `payload.visuraData`, non la data di invio: quando l'azienda
 * carica una visura nuova la chiave cambia, nessuna riga combacia e il ciclo di
 * avvisi si riarma da solo — nessuno stato da resettare a mano.
 *
 * La condizione è `>= 180`, non `== 180`: con l'uguaglianza esatta un cron
 * saltato (deploy, outage) significherebbe nessuna email, mai.
 */
export async function preavvisoVisura(
  now: Date = new Date(),
): Promise<{ inScadenza: number; scadute: number; congelate: number }> {
  const aziende = await prisma.company.findMany({
    where: {
      deletedAt: null,
      suspendedAt: null,
      visuraCameraleData: { not: null }, // null = esente
    },
    select: {
      id: true,
      type: true,
      ragioneSociale: true,
      visuraCameraleData: true,
      // Destinatario = email di registrazione dell'admin azienda, SEMPRE dal DB.
      users: {
        where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
        select: { id: true, email: true },
        take: 1,
      },
    },
  });

  const rimedioUrl = `${env.NEXT_PUBLIC_APP_URL}/visura`;
  let inScadenza = 0;
  let scadute = 0;
  let congelate = 0;

  const [y, m, d] = romeYmd(now);
  const oggiDa = romeStartOfDay([y, m, d]);
  const oggiA = romeEndOfDay([y, m, d]);

  for (const a of aziende) {
    const data = a.visuraCameraleData!;
    const admin = a.users[0];
    if (!admin) continue; // nessun destinatario: niente da mandare
    const key = visuraKey(data);
    const target = { email: admin.email, userId: admin.id, companyId: a.id };
    const companyType = a.type === 'AGENZIA' ? ('AGENZIA' as const) : ('DEALER' as const);

    if (isInPreavviso(data, now)) {
      // Dedup PER GIORNATA: 1 email al giorno per i 5 giorni di preavviso.
      const gia = await prisma.notificaInviata.findFirst({
        where: {
          companyId: a.id,
          tipo: 'N46_VISURA_IN_SCADENZA',
          payload: { path: ['visuraData'], equals: key },
          scheduledAt: { gte: oggiDa, lte: oggiA },
        },
        select: { id: true },
      });
      if (gia) continue;
      await sendNotification({
        tipo: 'N46_VISURA_IN_SCADENZA',
        target,
        payload: {
          nomeAzienda: a.ragioneSociale,
          companyType,
          giorniRimanenti: giorniRimanenti(data, now),
          rimedioUrl,
          visuraData: key,
        },
      }).catch(() => undefined);
      inScadenza++;
      continue;
    }

    if (!isVisuraScaduta(data, now)) continue;

    // Dedup PER CICLO: una sola N47 per data visura.
    const giaScaduta = await prisma.notificaInviata.findFirst({
      where: {
        companyId: a.id,
        tipo: 'N47_VISURA_SCADUTA',
        payload: { path: ['visuraData'], equals: key },
      },
      select: { id: true },
    });
    if (giaScaduta) continue;

    await sendNotification({
      tipo: 'N47_VISURA_SCADUTA',
      target,
      payload: {
        nomeAzienda: a.ragioneSociale,
        companyType,
        rimedioUrl,
        visuraData: key,
        giorniTrascorsi: giorniTrascorsi(data, now),
      },
    }).catch(() => undefined);
    scadute++;

    // Agenzia bloccata: i broker delle pratiche in volo vanno avvisati che la
    // loro pratica è ferma per un adempimento altrui.
    if (companyType !== 'AGENZIA') continue;
    congelate += await avvisaBrokerPraticheCongelate(a.id, a.ragioneSociale, key);
  }

  return { inScadenza, scadute, congelate };
}

/**
 * N48 ai broker delle pratiche assegnate all'agenzia e non ancora concluse.
 * Dedup su (praticaId, visuraData): una volta per pratica per ciclo di visura.
 *
 * ⚠️ Gli stati "in volo" vanno letti dalla FONTE UNICA `lib/pratiche/stati.ts`,
 * mai riscritti a mano qui: ogni nuovo stato dell'enum va classificato là.
 */
async function avvisaBrokerPraticheCongelate(
  agenziaId: string,
  nomeAgenzia: string,
  visuraKeyStr: string,
): Promise<number> {
  const pratiche = await prisma.pratica.findMany({
    where: {
      agenziaAssegnataId: agenziaId,
      // Fonte unica degli stati "vive": lib/pratiche/stati.ts. Enumerarli a mano
      // qui significherebbe che il prossimo stato aggiunto all'enum sparisce in
      // silenzio da questo avviso.
      stato: { in: [...STATI_IN_CORSO] },
    },
    select: {
      id: true,
      broker: {
        select: {
          id: true,
          ragioneSociale: true,
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
            select: { id: true, email: true },
            take: 1,
          },
        },
      },
    },
  });

  let n = 0;
  for (const p of pratiche) {
    const admin = p.broker?.users[0];
    if (!admin) continue;
    const gia = await prisma.notificaInviata.findFirst({
      where: {
        tipo: 'N48_BROKER_PRATICA_CONGELATA',
        payload: { path: ['visuraData'], equals: visuraKeyStr },
        AND: [{ payload: { path: ['praticaId'], equals: p.id } }],
      },
      select: { id: true },
    });
    if (gia) continue;
    await sendNotification({
      tipo: 'N48_BROKER_PRATICA_CONGELATA',
      target: { email: admin.email, userId: admin.id, companyId: p.broker!.id },
      payload: {
        nomeBroker: p.broker!.ragioneSociale,
        nomeAgenzia,
        praticaId: p.id,
        praticaUrl: `${env.NEXT_PUBLIC_APP_URL}/pratiche/${p.id}`,
        visuraData: visuraKeyStr,
      },
    }).catch(() => undefined);
    n++;
  }
  return n;
}
```

> **`sendNotification(...).catch(() => undefined)` è voluto:** un errore del provider email non deve far abortire il giro sulle altre aziende. `sendNotification` traccia già il fallimento su `NotificaInviata` (stato `FAILED` + `errorMessage`).
>
> ⚠️ **Effetto collaterale da conoscere:** se l'invio fallisce, la riga `NotificaInviata` **viene comunque creata** (`send.ts:364`) — quindi la dedup la conta come "già mandata" e non ritenterà. È coerente col resto della piattaforma (stesso comportamento di N9), ma va detto: un'email persa è persa. Non introdurre un retry qui senza parlarne prima.

- [ ] **Step 4: Eseguire i test**

```
pnpm -F piattaforma exec vitest run src/lib/jobs/preavviso-visura.test.ts
pnpm -F piattaforma typecheck
```
Atteso: PASS; typecheck exit 0.

- [ ] **Step 5: Provare la query di dedup sul DB reale**

I test mockano Prisma: il filtro JSON `payload: { path: [...], equals: ... }` **non è provato**. Verificare che regga su Postgres (`payload` è `jsonb`):

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "
SELECT count(*) FROM notifiche_inviate
WHERE tipo='N46_VISURA_IN_SCADENZA' AND payload->>'visuraData' = '2026-01-06';"
```
Atteso: `0` **senza errori** (0 righe è corretto: la feature non è ancora attiva; conta che la query non esploda).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/jobs/preavviso-visura.ts apps/piattaforma/src/lib/jobs/preavviso-visura.test.ts
git commit -m "feat(jobs): preavviso visura (175-179) + scadenza, idempotente per data visura"
```

---

### Task 5.5: Endpoint + schedule

**Files:**
- Create: `apps/piattaforma/src/app/api/jobs/preavviso-visura/route.ts`
- Modify: `apps/piattaforma/vercel.json`

- [ ] **Step 1: Creare la route**

`apps/piattaforma/src/app/api/jobs/preavviso-visura/route.ts` (identica per forma alle altre 9):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { preavvisoVisura } from '@/lib/jobs/preavviso-visura';
import { requireAdminOrCron } from '@/lib/jobs/auth';

/**
 * Ciclo di vita visura camerale: N46 nei 5 giorni di preavviso (175-179, una al
 * giorno), N47 alla scadenza (>=180, una per ciclo), N48 ai broker delle
 * pratiche congelate. Schedule cron Vercel: 1x/giorno mattina.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await preavvisoVisura();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
```

- [ ] **Step 2: Registrare lo schedule**

In `apps/piattaforma/vercel.json`, nell'array `crons`, aggiungere:

```json
    {
      "path": "/api/jobs/preavviso-visura",
      "schedule": "30 9 * * *"
    }
```

> `9:30` per non accavallarsi a `send-solleciti` (`0 9 * * *`).

- [ ] **Step 3: Provarlo davvero (non solo scriverlo)**

```
pnpm -F piattaforma dev
```
In un altro terminale (login come `ADMIN_PIATTAFORMA` non serve se `CRON_SECRET` è in `.env.local`):

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET apps/piattaforma/.env.local | cut -d= -f2)" \
  http://localhost:3000/api/jobs/preavviso-visura
```
Atteso: `{"ok":true,"inScadenza":N,"scadute":N,"congelate":N}`.

**Poi rilanciarlo una seconda volta**: i contatori devono tornare **a zero** — è la prova che l'idempotenza funziona e che il cron non spammerà. Se la seconda esecuzione manda di nuovo le stesse email, la dedup è rotta.

Controllare le email prodotte in `apps/piattaforma/.dev-emails/` (`EMAIL_PROVIDER=console` in locale).

- [ ] **Step 4: Typecheck + commit**

```
pnpm -F piattaforma typecheck
```

```bash
git add apps/piattaforma/src/app/api/jobs/preavviso-visura apps/piattaforma/vercel.json
git commit -m "feat(cron): endpoint e schedule del preavviso visura

Dormiente finche' il progetto resta su piano Hobby (limite 2 cron): il
resto del ciclo visura non dipende dal cron, e' tutto derivato dalla data."
```

---

# FASE 6 — I Termini

### Task 6.1: Clausole 5, 8, 12 + `TERMS_VERSION`

**Files:**
- Modify: `apps/piattaforma/src/app/termini/page.tsx` (clausole 5, 8, 12)
- Modify: `apps/piattaforma/src/lib/legal/clausole-vessatorie.ts` (`TERMS_VERSION`, riga 61; eventualmente `DESCRIZIONI_VESSATORIE`, righe 43-54)

**Estendere, MAI inserire una clausola nuova in mezzo:** rinumerare fa citare per sempre la clausola sbagliata alle `BrokerDichiarazione` già firmate (`ART_DATI_TERZI = 17` è dentro record persistiti). Le tre clausole sono **già** in `CLAUSOLE_VESSATORIE` — essenziale, perché "sospendere l'esecuzione del contratto" è vessatoria ex art. 1341 c.c. co. 2: senza approvazione specifica il blocco è inefficace.

- [ ] **Step 1: Leggere le tre clausole**

```bash
cd apps/piattaforma/src/app/termini && grep -n "clausola\|<h2\|art\." page.tsx | head -40
```
Individuare i blocchi delle clausole **5**, **8** e **12**. **Non riscriverle**: aggiungere.

- [ ] **Step 2: Estendere la clausola 8 (visura camerale)**

Aggiungere in coda alla clausola 8 un comma con questo contenuto (adattare la forma a quella degli altri commi del file):

> **Validità e aggiornamento della visura camerale.** L'Utente garantisce che la visura
> camerale fornita in fase di registrazione sia autentica e riferita alla propria impresa. La
> visura ha una validità di **180 (centottanta) giorni** dalla data di emissione risultante dal
> Registro Imprese. Decorso tale termine, l'Utente è tenuto a caricare nell'apposita sezione
> della Piattaforma una visura aggiornata, emessa da non più di 180 giorni. L'aggiornamento è
> necessario a consentire al Gestore la corretta emissione dei documenti fiscali per conto e nei
> confronti dell'Utente. Il Gestore comunica all'Utente l'approssimarsi della scadenza nei
> 5 (cinque) giorni precedenti, all'indirizzo email indicato in registrazione. Il mancato
> aggiornamento comporta le conseguenze di cui alle clausole 5 e 12.

- [ ] **Step 3: Estendere la clausola 5 (payout)**

> **Sospensione del prelievo per visura non aggiornata.** Il prelievo del saldo del wallet è
> sospeso qualora la visura camerale dell'Utente risulti emessa da oltre 180 giorni (clausola 8),
> e fino al caricamento di una visura aggiornata. La sospensione non incide sulla maturazione né
> sulla titolarità delle somme, che restano acquisite all'Utente, ma ne differisce l'erogazione:
> lo sblocco è automatico e immediato al momento dell'accettazione del documento aggiornato.

- [ ] **Step 4: Estendere la clausola 12 (limitazione operativa)**

> **Limitazione operativa per visura non aggiornata.** Qualora la visura camerale di un Utente
> Agenzia risulti emessa da oltre 180 giorni (clausola 8), l'operatività dell'Utente è sospesa:
> l'Utente non riceve nuove pratiche, non può lavorare quelle già assegnate — che restano
> assegnate e riprendono alla regolarizzazione — e non può richiedere il prelievo (clausola 5).
> L'accesso alla Piattaforma resta attivo. La sospensione cessa automaticamente al caricamento di
> una visura aggiornata. Per l'Utente Broker il mancato aggiornamento comporta la sola
> sospensione del prelievo di cui alla clausola 5.

- [ ] **Step 5: Bumpare `TERMS_VERSION`**

In `clausole-vessatorie.ts:61`:

```ts
export const TERMS_VERSION = '2026-07-16';
```

Le descrizioni in `DESCRIZIONI_VESSATORIE` (5, 8, 12) restano valide: coprono già payout, visura e limitazione operativa. **Verificare** leggendole; se una non copre più il contenuto esteso, aggiornarla — le chiavi devono continuare a coprire esattamente `CLAUSOLE_VESSATORIE`, e `clausole-vessatorie.test.ts` blinda l'invariante.

- [ ] **Step 6: Test + typecheck**

```
pnpm -F piattaforma exec vitest run src/lib/legal/
pnpm -F piattaforma typecheck
```
Atteso: PASS; typecheck exit 0.

- [ ] **Step 7: Verifica nel DOM (NON saltare — e non lanciare prettier su questa pagina)**

Su questa pagina è già successo: **JSX mangia gli spazi a ridosso dei tag** e su `/termini` sono finite 21 parole incollate, invisibili sia ai test sia al sorgente.

1. `pnpm -F piattaforma dev`, aprire `http://localhost:3000/termini`.
2. **Leggere il testo renderizzato** delle clausole 5, 8 e 12 — non il sorgente.
3. Cercare parole incollate (`visuracamerale`, `180giorni`, `clausole5e12`). Nel browser:
   ```js
   document.body.innerText.match(/[a-zà-ù][A-ZÀ-Ù]|\d[a-zà-ù]{3,}/g)
   ```
4. Verificare che i rimandi "clausole 5 e 12" citino i numeri **giusti** (nessuna rinumerazione).

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/termini/page.tsx apps/piattaforma/src/lib/legal/clausole-vessatorie.ts
git commit -m "feat(termini): ciclo di vita visura nelle clausole 8, 5 e 12

Estese le clausole esistenti invece di aggiungerne una nuova: rinumerare
farebbe citare per sempre la clausola sbagliata alle BrokerDichiarazione
gia' firmate (ART_DATI_TERZI=17 e' dentro record persistiti).

Le tre sono gia' vessatorie con doppia accettazione ex art. 1341-1342:
'sospendere l'esecuzione del contratto' lo e' per legge, senza
approvazione specifica il blocco sarebbe inefficace.

TERMS_VERSION bumpata. NB: chi ha accettato la 2026-07-14 non ha
sottoscritto queste clausole; col DB di prod temporaneo non si pone, ma
a dati reali servira' la ri-accettazione prima di far mordere il blocco.
EOF"
```

- [ ] **Step 9: Avvisare l'utente (non è una task di codice)**

`/termini` è **DRAFT in attesa di revisione legale**. Queste clausole **sospendono un servizio a pagamento**: vanno nel giro col legale insieme al resto. Dirlo esplicitamente nel riepilogo finale, senza dichiararle definitive.

---

## Verifica finale (dopo tutte le fasi)

- [ ] `pnpm -F piattaforma typecheck` → exit code **0**
- [ ] `pnpm -F piattaforma exec vitest run` → tutti verdi
- [ ] Percorso completo nel browser, su un'azienda di test:
  1. `UPDATE companies SET "visuraCameraleData" = CURRENT_DATE - 200` → banner rosso, payout rifiutato (broker) / pratiche bloccate (agenzia)
  2. `/visura` → carica una visura valida → banner sparisce, operatività torna **senza alcun intervento manuale** (lo sblocco è derivato)
  3. `SELECT count(*) FROM documenti WHERE "companyId"='<ID>' AND tipo='VISURA_CAMERALE'` → **aumentato**, non sostituito
- [ ] Cron lanciato **due volte** di fila → la seconda non manda nulla
- [ ] Aggiornare `docs/piano-implementazione.md` (fonte di verità del progresso)
- [ ] Ricordare all'utente: **il cron resta dormiente finché Vercel è su Hobby**, e le clausole vanno dal legale
