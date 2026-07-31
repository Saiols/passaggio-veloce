# CRM — elimina massiva · tel cliccabile · calendario richiami · split Fatti/Giudizio · email multi-destinatario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere i 5 interventi CRM: eliminazione massiva (hard delete), telefono cliccabile, calendario richiami con "Aggiungi a Google Calendar", split della colonna stato in Fatti/Giudizio con storico (che chiude il bug S11), e invio email di partenza a più destinatari.

**Architecture:** Tre assi ortogonali sul contatto — **Fatti** (funnel oggettivo, derivato dai flag/timestamp), **Giudizio** (nuovo campo `giudizio`), **Richiamo** (campi `nextContactAt`/`nextContactFascia` esistenti, scollegati da `status`). Logica pura in helper testabili sotto `src/lib/crm/`; UI nel client della lista contatti e in una nuova pagina calendario; server actions in `contatti/actions.ts`. Nessuna delle 4 write path automatiche cambia la propria logica su `status`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 5.22 + Postgres, React, Tailwind (design system Trust Blue), Vitest, pnpm monorepo Turborepo.

## Global Constraints

- Package manager: **pnpm 10.33**. App = `piattaforma`. DB package = `@pv/db`.
- Import DB come `@pv/db` (`import { prisma, Prisma } from '@pv/db'`), auth come `@/auth`, notifiche come `@/lib/notifiche`, permessi come `@/lib/auth/permissions`, env come `@/env`.
- Test: da `apps/piattaforma`, `pnpm vitest run <path>` (singolo file) o `pnpm test`.
- Typecheck: `pnpm typecheck` (turbo, con cache — a cache fredda tsc dà falsi errori).
- **Migration a mano**: MAI `pnpm db:migrate` (`prisma migrate dev` è distruttivo su questo schema, propone DROP). Scrivere la cartella migration a mano e applicare con `pnpm --filter @pv/db db:deploy`, poi `pnpm --filter @pv/db db:generate`.
- Le query nuove vanno provate **read-only sul postgres locale reale** (i test mockano Prisma).
- **Enum `CrmStatoContatto` invariato**: non rimuovere S2/S3/S11 dalla definizione; il codice nuovo semplicemente non li scrive più.
- Le 4 write path automatiche (`sendEmailPartenzaAction`→S4, `app/i/[token]/route.ts`→S5, `lib/crm/match/apply.ts`, `lib/crm/sync.ts`) non cambiano la logica su `status`. L'unica modifica additiva è `linkApertoAt` nel route del token.
- Colori: usare le classi del design system (`pv-navy-*`, `pv-slate-*`, `pv-red-*`), niente colori hardcoded.
- Link email/funzionali: `env.NEXT_PUBLIC_APP_URL`, mai `BRAND.url`.
- Verifica finale **sul browser** con gesto utente reale (bug React invisibili ai test).

---

## File Structure

**Nuovi (logica pura + test):**
- `src/lib/crm/tel.ts` — `telHref`.
- `src/lib/crm/emails.ts` — `parseEmails`.
- `src/lib/crm/google-calendar.ts` — `googleCalendarUrl`.
- `src/lib/crm/fatti.ts` — `statoFattuale`, `timelineFatti`.
- `src/lib/crm/contatti-filtro.ts` — `FiltroContatti`, `whereContatti`.

**Nuovi (UI):**
- `src/app/admin/crm/richiami/page.tsx` + `client.tsx` — calendario richiami.
- `src/app/admin/crm/contatti/giudizio-select.tsx` — pill giudizio.
- `src/app/admin/crm/contatti/timeline-fatti.tsx` — timeline nel modale.
- `src/app/admin/crm/contatti/bulk-delete-bar.tsx` — barra azioni + dialog conferma.

**Modificati:**
- `packages/db/prisma/schema.prisma` + nuova migration a mano.
- `src/app/admin/crm/contatti/actions.ts`.
- `src/app/admin/crm/contatti/client.tsx`.
- `src/app/admin/crm/contatti/page.tsx`.
- `src/app/i/[token]/route.ts`.
- `src/lib/crm/richiamo.ts` (commento).
- La sidebar admin CRM (voce "Richiami").

---

## Phase 0 — Schema & migration

### Task 0.1: Aggiungere enum `CrmGiudizio` e campi `giudizio` / `linkApertoAt`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (enum `CrmStatoContatto` è a righe ~2105; model `CrmContact` righe 2200–2314)
- Create: `packages/db/prisma/migrations/20260801120000_crm_giudizio_link_aperto_at/migration.sql`

**Interfaces:**
- Produces: campi Prisma `CrmContact.giudizio: CrmGiudizio?`, `CrmContact.linkApertoAt: DateTime?`, enum `CrmGiudizio { INTERESSATO, NON_INTERESSATO }`.

- [ ] **Step 1: Aggiungere l'enum allo schema**

Dopo `enum CrmFasciaContatto { ... }` (riga ~2126) inserire:

```prisma
enum CrmGiudizio {
  INTERESSATO
  NON_INTERESSATO
}
```

- [ ] **Step 2: Aggiungere i due campi al model `CrmContact`**

Nel blocco "Pixel/funnel tracking" del model, subito dopo `linkAperture Int @default(0)` (riga ~2238) aggiungere:

```prisma
  linkApertoAt DateTime?
```

E nel blocco status/callback, subito dopo `nextContactFascia CrmFasciaContatto?` (riga ~2223) aggiungere:

```prisma
  /// Giudizio soggettivo dell'operatore, ortogonale al funnel fattuale (status)
  /// e al richiamo (nextContactAt). null = nessun giudizio espresso.
  giudizio CrmGiudizio?
```

- [ ] **Step 3: Scrivere la migration a mano**

Creare `packages/db/prisma/migrations/20260801120000_crm_giudizio_link_aperto_at/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "CrmGiudizio" AS ENUM ('INTERESSATO', 'NON_INTERESSATO');

-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN "giudizio" "CrmGiudizio";
ALTER TABLE "crm_contacts" ADD COLUMN "linkApertoAt" TIMESTAMP(3);

-- Data migration: i giudizi soggettivi (S2/S3) diventano `giudizio`.
UPDATE "crm_contacts" SET "giudizio" = 'INTERESSATO' WHERE "status" = 'S3';
UPDATE "crm_contacts" SET "giudizio" = 'NON_INTERESSATO' WHERE "status" = 'S2';

-- I contatti in S2/S3/S11 non devono più portare un valore soggettivo/di richiamo
-- in `status`: si ricalcola il traguardo fattuale dai flag (stessa logica di
-- statoFattuale). S11 mantiene nextContactAt/nextContactFascia (il richiamo è ora
-- un asse indipendente).
UPDATE "crm_contacts" SET "status" = (CASE
  WHEN "primaPratica" = true AND "praticheTotal" >= 2 THEN 'S9'
  WHEN "primaPratica" = true THEN 'S8'
  WHEN "iscrizioneComp" = true THEN 'S7'
  WHEN "iscrizioneInit" = true THEN 'S6'
  WHEN "linkAperto" = true THEN 'S5'
  WHEN "linkInviato" = true THEN 'S4'
  ELSE 'S0'
END)::"CrmStatoContatto"
WHERE "status" IN ('S2', 'S3', 'S11');
```

- [ ] **Step 4: Applicare la migration in locale**

Run: `pnpm --filter @pv/db db:deploy`
Expected: `Applying migration 20260801120000_crm_giudizio_link_aperto_at` senza errori.

- [ ] **Step 5: Rigenerare il client Prisma**

Run: `pnpm --filter @pv/db db:generate`
Expected: `Generated Prisma Client` senza errori.

- [ ] **Step 6: Verifica read-only sul DB locale**

Run (adatta le credenziali locali):
```bash
psql "$DATABASE_URL" -c "SELECT status, giudizio, count(*) FROM crm_contacts GROUP BY 1,2 ORDER BY 1,2 LIMIT 30;"
```
Expected: nessuna riga con `status IN ('S2','S3','S11')`; le righe ex-S3 hanno `giudizio=INTERESSATO`, le ex-S2 `NON_INTERESSATO`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260801120000_crm_giudizio_link_aperto_at
git commit -m "feat(crm): campo giudizio ortogonale + linkApertoAt + data migration S2/S3/S11"
```

---

## Phase 1 — Helper puri (TDD)

### Task 1.1: `telHref`

**Files:**
- Create: `src/lib/crm/tel.ts`
- Test: `src/lib/crm/tel.test.ts`

**Interfaces:**
- Produces: `telHref(tel: string): string | null` — `tel:<numero ripulito>`, o `null` se vuoto.

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, it, expect } from 'vitest';
import { telHref } from './tel';

describe('telHref', () => {
  it('ripulisce spazi e separatori mantenendo cifre e +', () => {
    expect(telHref('+39 02 447 8712')).toBe('tel:+390244788712');
    expect(telHref('02-447/8712')).toBe('tel:024478712');
  });
  it('stringa vuota o solo simboli → null', () => {
    expect(telHref('')).toBeNull();
    expect(telHref('   ')).toBeNull();
    expect(telHref('--')).toBeNull();
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/lib/crm/tel.test.ts`
Expected: FAIL ("telHref is not a function" / modulo non trovato).

- [ ] **Step 3: Implementazione**

```ts
/** Costruisce un href `tel:` da un numero libero. null se non resta nulla di componibile. */
export function telHref(tel: string): string | null {
  const cleaned = (tel ?? '').replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : null;
}
```

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/lib/crm/tel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crm/tel.ts src/lib/crm/tel.test.ts
git commit -m "feat(crm): helper telHref per numero cliccabile"
```

### Task 1.2: `parseEmails`

**Files:**
- Create: `src/lib/crm/emails.ts`
- Test: `src/lib/crm/emails.test.ts`

**Interfaces:**
- Produces: `parseEmails(raw: string): { validi: string[]; scartati: string[] }` — split multi-separatore, lowercase, dedup, validazione.

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, it, expect } from 'vitest';
import { parseEmails } from './emails';

describe('parseEmails', () => {
  it('separa su virgola, punto-e-virgola, spazio e newline', () => {
    const r = parseEmails('a@x.it, b@x.it; c@x.it\nd@x.it e@x.it');
    expect(r.validi).toEqual(['a@x.it', 'b@x.it', 'c@x.it', 'd@x.it', 'e@x.it']);
    expect(r.scartati).toEqual([]);
  });
  it('normalizza a minuscolo e deduplica', () => {
    const r = parseEmails('Mario@X.it, mario@x.it');
    expect(r.validi).toEqual(['mario@x.it']);
  });
  it('separa i validi dagli invalidi', () => {
    const r = parseEmails('buona@x.it, nonvale, altra@y.it');
    expect(r.validi).toEqual(['buona@x.it', 'altra@y.it']);
    expect(r.scartati).toEqual(['nonvale']);
  });
  it('input vuoto → liste vuote', () => {
    expect(parseEmails('')).toEqual({ validi: [], scartati: [] });
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/lib/crm/emails.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementazione**

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Estrae email valide (lowercase, dedup) e scarta il resto. Separatori: , ; spazi, newline. */
export function parseEmails(raw: string): { validi: string[]; scartati: string[] } {
  const parti = (raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const validi: string[] = [];
  const scartati: string[] = [];
  const visti = new Set<string>();
  for (const p of parti) {
    if (!EMAIL_RE.test(p)) {
      scartati.push(p);
      continue;
    }
    if (visti.has(p)) continue;
    visti.add(p);
    validi.push(p);
  }
  return { validi, scartati };
}
```

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/lib/crm/emails.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crm/emails.ts src/lib/crm/emails.test.ts
git commit -m "feat(crm): helper parseEmails per destinatari multipli"
```

### Task 1.3: `googleCalendarUrl`

**Files:**
- Create: `src/lib/crm/google-calendar.ts`
- Test: `src/lib/crm/google-calendar.test.ts`

**Interfaces:**
- Consumes: nulla (usa `Intl.DateTimeFormat` per il giorno romano).
- Produces: `googleCalendarUrl(input: { nome: string; tel?: string | null; citta?: string | null; giorno: Date; fascia: 'MATTINA' | 'POMERIGGIO' | null }): string`.

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, it, expect } from 'vitest';
import { googleCalendarUrl } from './google-calendar';

const giorno = new Date('2026-08-04T00:00:00.000Z'); // 4 ago, giorno romano = 4 ago

describe('googleCalendarUrl', () => {
  it('mattina → 09:00-13:00 con timezone Roma', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', giorno, fascia: 'MATTINA' }));
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('dates')).toBe('20260804T090000/20260804T130000');
    expect(u.searchParams.get('ctz')).toBe('Europe/Rome');
    expect(u.searchParams.get('text')).toBe('Richiamare Rossi');
  });
  it('pomeriggio → 15:00-19:00', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', giorno, fascia: 'POMERIGGIO' }));
    expect(u.searchParams.get('dates')).toBe('20260804T150000/20260804T190000');
  });
  it('indifferente → evento tutto il giorno (fine esclusiva il giorno dopo)', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', giorno, fascia: null }));
    expect(u.searchParams.get('dates')).toBe('20260804/20260805');
  });
  it('mette tel e città nei dettagli', () => {
    const u = new URL(googleCalendarUrl({ nome: 'Rossi', tel: '02 111', citta: 'Milano', giorno, fascia: 'MATTINA' }));
    expect(u.searchParams.get('details')).toContain('02 111');
    expect(u.searchParams.get('details')).toContain('Milano');
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/lib/crm/google-calendar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementazione**

```ts
const FASCE: Record<'MATTINA' | 'POMERIGGIO', { start: string; end: string }> = {
  MATTINA: { start: '090000', end: '130000' },
  POMERIGGIO: { start: '150000', end: '190000' },
};

/** Giorno romano di una Date come 'YYYYMMDD'. */
function giornoRoma(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts.replace(/-/g, '');
}

/** Link "Aggiungi a Google Calendar" per un richiamo. Nessun dato lascia PV finché non si clicca. */
export function googleCalendarUrl(input: {
  nome: string;
  tel?: string | null;
  citta?: string | null;
  giorno: Date;
  fascia: 'MATTINA' | 'POMERIGGIO' | null;
}): string {
  const g = giornoRoma(input.giorno);
  let dates: string;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `Richiamare ${input.nome}` });
  if (input.fascia) {
    const f = FASCE[input.fascia];
    dates = `${g}T${f.start}/${g}T${f.end}`;
    params.set('ctz', 'Europe/Rome');
  } else {
    const dopo = giornoRoma(new Date(input.giorno.getTime() + 24 * 60 * 60 * 1000));
    dates = `${g}/${dopo}`;
  }
  params.set('dates', dates);
  const dettagli = [input.tel ? `Tel: ${input.tel}` : null, input.citta ? `Città: ${input.citta}` : null]
    .filter(Boolean)
    .join(' · ');
  if (dettagli) params.set('details', dettagli);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
```

Nota: `URLSearchParams` codifica gli spazi come `+`. Il test usa `URL`/`searchParams.get`, che decodifica correttamente. Per l'href in UI va bene così.

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/lib/crm/google-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crm/google-calendar.ts src/lib/crm/google-calendar.test.ts
git commit -m "feat(crm): helper googleCalendarUrl per Aggiungi a Calendar"
```

### Task 1.4: `statoFattuale` + `timelineFatti`

**Files:**
- Create: `src/lib/crm/fatti.ts`
- Test: `src/lib/crm/fatti.test.ts`

**Interfaces:**
- Produces:
  - `type CodiceFattuale = 'S0' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9'`
  - `statoFattuale(c: ContattoFatti): { codice: CodiceFattuale; label: string; at: Date | null }`
  - `timelineFatti(c: ContattoFatti, calls: CallFatto[]): Array<{ tipo: string; label: string; at: Date }>` (ordinata crescente)
  - dove `ContattoFatti` = i flag/timestamp rilevanti e `CallFatto = { startedAt: Date; esito: string | null }`.

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, it, expect } from 'vitest';
import { statoFattuale, timelineFatti } from './fatti';

const vuoto = {
  createdAt: new Date('2026-01-01'),
  linkInviato: false, linkInviatoAt: null,
  linkAperto: false, linkApertoAt: null,
  iscrizioneInit: false, iscrizioneComp: false, iscrizioneAt: null,
  primaPratica: false, primaPraticaAt: null, praticheTotal: 0,
  matchedAt: null,
};

describe('statoFattuale', () => {
  it('nessun flag → S0', () => {
    expect(statoFattuale(vuoto).codice).toBe('S0');
  });
  it('link inviato → S4 con la sua data', () => {
    const at = new Date('2026-02-01');
    const r = statoFattuale({ ...vuoto, linkInviato: true, linkInviatoAt: at });
    expect(r.codice).toBe('S4');
    expect(r.at).toEqual(at);
  });
  it('link aperto batte link inviato → S5', () => {
    expect(statoFattuale({ ...vuoto, linkInviato: true, linkAperto: true }).codice).toBe('S5');
  });
  it('iscrizione completa → S7', () => {
    expect(statoFattuale({ ...vuoto, iscrizioneComp: true }).codice).toBe('S7');
  });
  it('prima pratica → S8, ≥2 pratiche → S9', () => {
    expect(statoFattuale({ ...vuoto, primaPratica: true, praticheTotal: 1 }).codice).toBe('S8');
    expect(statoFattuale({ ...vuoto, primaPratica: true, praticheTotal: 3 }).codice).toBe('S9');
  });
});

describe('timelineFatti', () => {
  it('unisce timestamp e chiamate, ordina per data crescente', () => {
    const c = {
      ...vuoto,
      linkInviato: true, linkInviatoAt: new Date('2026-01-05'),
      iscrizioneComp: true, iscrizioneAt: new Date('2026-01-20'),
    };
    const calls = [{ startedAt: new Date('2026-01-10'), esito: 'INTERESSATO' }];
    const t = timelineFatti(c, calls);
    expect(t.map((e) => e.at.toISOString())).toEqual([
      new Date('2026-01-01').toISOString(), // creato
      new Date('2026-01-05').toISOString(), // email inviata
      new Date('2026-01-10').toISOString(), // chiamata
      new Date('2026-01-20').toISOString(), // registrazione
    ]);
  });
  it('salta i timestamp null', () => {
    const t = timelineFatti(vuoto, []);
    expect(t).toHaveLength(1); // solo "Contatto creato"
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/lib/crm/fatti.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementazione**

```ts
export type CodiceFattuale = 'S0' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9';

export interface ContattoFatti {
  createdAt: Date;
  linkInviato: boolean;
  linkInviatoAt: Date | null;
  linkAperto: boolean;
  linkApertoAt: Date | null;
  iscrizioneInit: boolean;
  iscrizioneComp: boolean;
  iscrizioneAt: Date | null;
  primaPratica: boolean;
  primaPraticaAt: Date | null;
  praticheTotal: number;
  matchedAt: Date | null;
}

export interface CallFatto {
  startedAt: Date;
  esito: string | null;
}

const LABEL_FATTUALE: Record<CodiceFattuale, string> = {
  S0: 'Non contattato',
  S4: 'Email inviata',
  S5: 'Link aperto',
  S6: 'Iscrizione incompleta',
  S7: 'Registrato',
  S8: 'Prima pratica',
  S9: 'Attivo',
};

/** Traguardo di funnel più avanzato in base ai FLAG (non allo status). */
export function statoFattuale(c: ContattoFatti): { codice: CodiceFattuale; label: string; at: Date | null } {
  let codice: CodiceFattuale;
  let at: Date | null;
  if (c.primaPratica && c.praticheTotal >= 2) { codice = 'S9'; at = c.primaPraticaAt; }
  else if (c.primaPratica) { codice = 'S8'; at = c.primaPraticaAt; }
  else if (c.iscrizioneComp) { codice = 'S7'; at = c.iscrizioneAt; }
  else if (c.iscrizioneInit) { codice = 'S6'; at = c.iscrizioneAt; }
  else if (c.linkAperto) { codice = 'S5'; at = c.linkApertoAt; }
  else if (c.linkInviato) { codice = 'S4'; at = c.linkInviatoAt; }
  else { codice = 'S0'; at = c.createdAt; }
  return { codice, label: LABEL_FATTUALE[codice], at };
}

/** Storico datato dei fatti: timestamp del contatto + chiamate, ordinato crescente. */
export function timelineFatti(
  c: ContattoFatti,
  calls: CallFatto[],
): Array<{ tipo: string; label: string; at: Date }> {
  const eventi: Array<{ tipo: string; label: string; at: Date }> = [];
  const push = (tipo: string, label: string, at: Date | null) => {
    if (at) eventi.push({ tipo, label, at });
  };
  push('creato', 'Contatto creato', c.createdAt);
  push('email', 'Email inviata', c.linkInviatoAt);
  push('apertura', 'Link aperto', c.linkApertoAt);
  push('iscrizione', 'Registrazione completata', c.iscrizioneAt);
  push('pratica', 'Prima pratica', c.primaPraticaAt);
  push('match', 'Agganciato ad azienda', c.matchedAt);
  for (const call of calls) {
    push('chiamata', `Chiamata${call.esito ? `: ${call.esito}` : ''}`, call.startedAt);
  }
  return eventi.sort((a, b) => a.at.getTime() - b.at.getTime());
}
```

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/lib/crm/fatti.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crm/fatti.ts src/lib/crm/fatti.test.ts
git commit -m "feat(crm): statoFattuale e timelineFatti (asse Fatti)"
```

### Task 1.5: `FiltroContatti` + `whereContatti`

**Files:**
- Create: `src/lib/crm/contatti-filtro.ts`
- Test: `src/lib/crm/contatti-filtro.test.ts`
- Riferimento: `src/app/admin/crm/contatti/page.tsx:60-91` (costruzione `where` attuale)

**Interfaces:**
- Consumes: `sogliaRichiamoDovuto` da `@/lib/crm/richiamo`.
- Produces:
  - `interface FiltroContatti { q?: string; cat?: 'BROKER' | 'AGENZIA' | ''; regione?: string; assegnatoA?: string; preset?: 'urgenti' | 'richiamo' | ''; soloAssegnatoAId?: string; adesso: string }` (`adesso` = ISO, per il preset richiamo; `soloAssegnatoAId` per lo scoping SALES)
  - `whereContatti(f: FiltroContatti): Prisma.CrmContactWhereInput`

**Nota semantica (Punto 4):** il preset `richiamo` passa da `status=S11` a `nextContactAt<=soglia AND iscrizioneComp=false`; il preset `urgenti` include gli "interessati" via `giudizio=INTERESSATO` invece di `status=S3`.

- [ ] **Step 1: Leggere la costruzione `where` attuale**

Aprire `src/app/admin/crm/contatti/page.tsx:60-91` e replicarne i filtri base (q su nome/email/tel, cat, regione, assegnatoA, `deletedAt: null`). Mantenere identici i nomi campo.

- [ ] **Step 2: Test che fallisce**

```ts
import { describe, it, expect } from 'vitest';
import { whereContatti } from './contatti-filtro';

const adesso = '2026-08-01T10:00:00.000Z';

describe('whereContatti', () => {
  it('sempre esclude i soft-deleted', () => {
    expect(whereContatti({ adesso }).deletedAt).toBeNull();
  });
  it('preset richiamo: nextContactAt<=soglia e non ancora registrato', () => {
    const w = whereContatti({ preset: 'richiamo', adesso });
    expect(w.iscrizioneComp).toBe(false);
    expect(w.nextContactAt).toHaveProperty('lte');
  });
  it('preset urgenti: include interessati via giudizio', () => {
    const w = whereContatti({ preset: 'urgenti', adesso });
    expect(JSON.stringify(w)).toContain('INTERESSATO');
  });
  it('scoping SALES filtra per assegnatario', () => {
    expect(whereContatti({ adesso, soloAssegnatoAId: 'sales-1' }).assignedToId).toBe('sales-1');
  });
  it('testo libero cerca su nome/email/tel', () => {
    const w = whereContatti({ adesso, q: 'rossi' });
    expect(w.OR).toBeTruthy();
  });
});
```

- [ ] **Step 3: Verifica fallimento**

Run: `pnpm vitest run src/lib/crm/contatti-filtro.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementazione**

```ts
import { Prisma } from '@pv/db';
import { sogliaRichiamoDovuto } from '@/lib/crm/richiamo';

export interface FiltroContatti {
  q?: string;
  cat?: 'BROKER' | 'AGENZIA' | '';
  regione?: string;
  assegnatoA?: string;
  preset?: 'urgenti' | 'richiamo' | '';
  soloAssegnatoAId?: string;
  adesso: string;
}

export function whereContatti(f: FiltroContatti): Prisma.CrmContactWhereInput {
  const where: Prisma.CrmContactWhereInput = { deletedAt: null };
  if (f.cat) where.cat = f.cat;
  if (f.regione) where.regione = f.regione;
  if (f.assegnatoA) where.assignedToId = f.assegnatoA;
  if (f.soloAssegnatoAId) where.assignedToId = f.soloAssegnatoAId;
  if (f.q) {
    where.OR = [
      { nome: { contains: f.q, mode: 'insensitive' } },
      { email: { contains: f.q, mode: 'insensitive' } },
      { tel: { contains: f.q } },
    ];
  }
  if (f.preset === 'urgenti') {
    where.AND = [
      { OR: [{ status: { in: ['S6', 'S5', 'S4'] } }, { giudizio: 'INTERESSATO' }] },
    ];
  } else if (f.preset === 'richiamo') {
    where.iscrizioneComp = false;
    where.nextContactAt = { not: null, lte: sogliaRichiamoDovuto(new Date(f.adesso)) };
  }
  return where;
}
```

- [ ] **Step 5: Verifica pass**

Run: `pnpm vitest run src/lib/crm/contatti-filtro.test.ts`
Expected: PASS.

- [ ] **Step 6: Cablare `page.tsx` sull'helper (refactor behavior-updating)**

In `src/app/admin/crm/contatti/page.tsx`:
- Sostituire la costruzione inline del `where` (60–91) con `const where = whereContatti({ q, cat, regione, assegnatoA, preset, soloAssegnatoAId: session.user.role === 'SALES' ? session.user.id : undefined, adesso: new Date().toISOString() })`.
- Aggiornare il conteggio `richiamiDovuti` (111–116) e il preset per usare la stessa condizione (`nextContactAt<=soglia AND iscrizioneComp=false`). Riusare `whereContatti({ preset: 'richiamo', adesso, soloAssegnatoAId })` per il count.
- Includere `giudizio` e `linkApertoAt` nel `select`/serializzazione verso il client (righe ~171–192) e passare le `calls` del contatto solo on-demand (non nella lista).

- [ ] **Step 7: Typecheck + test**

Run: `pnpm vitest run src/lib/crm/contatti-filtro.test.ts && pnpm --filter piattaforma typecheck`
Expected: PASS (typecheck può richiedere cache calda).

- [ ] **Step 8: Verifica query sul DB locale reale**

Run: aprire la lista in dev e provare i preset "Urgenti" e "Da richiamare"; oppure una query psql equivalente al `where` del preset richiamo. Expected: la lista risponde e "Da richiamare" mostra i contatti con `nextContactAt` dovuto e non registrati.

- [ ] **Step 9: Commit**

```bash
git add src/lib/crm/contatti-filtro.ts src/lib/crm/contatti-filtro.test.ts src/app/admin/crm/contatti/page.tsx
git commit -m "feat(crm): whereContatti unico + preset richiamo su nextContactAt"
```

---

## Phase 2 — Punto 2: telefono cliccabile

### Task 2.1: `tel:` in lista e nella scheda

**Files:**
- Modify: `src/app/admin/crm/contatti/client.tsx:403` (cella telefono lista), `TabAnagrafica` (~1460-1470, campo Telefono nel modale)

**Interfaces:**
- Consumes: `telHref` da `@/lib/crm/tel`.

- [ ] **Step 1: Import**

In cima a `client.tsx` aggiungere `import { telHref } from '@/lib/crm/tel';`.

- [ ] **Step 2: Lista — rendere il numero un link**

Sostituire la cella a `client.tsx:403`:

```tsx
<td className="px-4 py-2.5 text-pv-slate-700">
  {telHref(c.tel) ? (
    <a
      href={telHref(c.tel)!}
      onClick={(e) => e.stopPropagation()}
      className="text-pv-navy-700 hover:underline"
    >
      {c.tel}
    </a>
  ) : (
    c.tel
  )}
</td>
```

- [ ] **Step 3: Modale — bottone "Chiama" accanto al campo telefono**

In `TabAnagrafica`, subito sotto il `FieldText` "Telefono fisso" (~1470), aggiungere:

```tsx
{telHref(data.tel) && (
  <a
    href={telHref(data.tel)!}
    className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-pv-navy-700 hover:underline"
  >
    📞 Chiama {data.tel}
  </a>
)}
```

- [ ] **Step 4: Verifica browser**

Avviare dev (`pnpm dev`), aprire `/admin/crm/contatti`. Verificare: il numero in lista è un link `tel:` (hover mostra l'URL; il click NON apre il modale); nella scheda compare "📞 Chiama". Su desktop il link apre il gestore chiamate/è inerte, su mobile chiama.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): numero di telefono cliccabile (tel:) in lista e scheda"
```

---

## Phase 3 — Punto 5: email di partenza a più destinatari

### Task 3.1: `sendEmailPartenzaAction` accetta `emailAggiuntive`

**Files:**
- Modify: `src/app/admin/crm/contatti/actions.ts:582-688`
- Test: `src/app/admin/crm/contatti/email-partenza.action.test.ts` (esiste già — aggiungere casi)

**Interfaces:**
- Consumes: `parseEmails` non serve qui (il client passa già `string[]` validati); l'action rivalida con la stessa regex.
- Produces: firma aggiornata `sendEmailPartenzaAction(input: { contactId; nomeReferente; messaggio; promoCodeId?; emailAggiuntive?: string[] })`.

- [ ] **Step 1: Test che fallisce (aggiungere al file esistente)**

Mirare l'harness già presente in `email-partenza.action.test.ts` (stessi `vi.mock`). Aggiungere:

```ts
it('invia a contatto + destinatari extra, aggiorna il contatto una volta sola', async () => {
  crmContactMock.findUnique.mockResolvedValue({
    id: 'c1', cat: 'AGENZIA', status: 'S4', email: 'primo@x.it', nome: 'Rossi',
    emailOptOutAt: null, emailUnsubToken: null, assignedToId: null, companyId: null,
  });
  const res = await sendEmailPartenzaAction({
    contactId: 'c1', nomeReferente: 'Rossi', messaggio: 'ciao',
    emailAggiuntive: ['due@x.it', 'PRIMO@x.it', 'tre@x.it'],
  });
  expect(res.ok).toBe(true);
  // dedup case-insensitive del primario: primo + due + tre = 3 invii
  expect(sendNotificationMock).toHaveBeenCalledTimes(3);
  expect(crmContactMock.update).toHaveBeenCalledTimes(1);
});

it('senza email primaria ma con extra validi, invia comunque agli extra', async () => {
  crmContactMock.findUnique.mockResolvedValue({
    id: 'c1', cat: 'AGENZIA', status: 'S0', email: null, nome: 'Rossi',
    emailOptOutAt: null, emailUnsubToken: null, assignedToId: null, companyId: null,
  });
  const res = await sendEmailPartenzaAction({
    contactId: 'c1', nomeReferente: 'Rossi', messaggio: 'ciao', emailAggiuntive: ['x@y.it'],
  });
  expect(res.ok).toBe(true);
  expect(sendNotificationMock).toHaveBeenCalledTimes(1);
});

it('contatto disiscritto blocca tutto, anche con extra', async () => {
  crmContactMock.findUnique.mockResolvedValue({
    id: 'c1', cat: 'AGENZIA', status: 'S4', email: 'primo@x.it', nome: 'Rossi',
    emailOptOutAt: new Date(), emailUnsubToken: null, assignedToId: null, companyId: null,
  });
  const res = await sendEmailPartenzaAction({
    contactId: 'c1', nomeReferente: 'Rossi', messaggio: 'ciao', emailAggiuntive: ['x@y.it'],
  });
  expect(res.ok).toBe(false);
  expect(sendNotificationMock).not.toHaveBeenCalled();
});
```

(Assicurarsi che il file esporti/mocki `sendNotification` come `sendNotificationMock`; se non c'è, aggiungere `vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }))` e `import { sendNotification } from '@/lib/notifiche'; const sendNotificationMock = vi.mocked(sendNotification);`.)

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/app/admin/crm/contatti/email-partenza.action.test.ts`
Expected: FAIL sui nuovi casi.

- [ ] **Step 3: Implementazione**

Modificare `sendEmailPartenzaAction`:
- Aggiungere `emailAggiuntive?: string[]` all'input.
- Dopo i controlli `companyId`/`emailOptOutAt`, sostituire il blocco `if (!contact.email) return ...` con la costruzione dei destinatari:

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const extra = (input.emailAggiuntive ?? [])
  .map((e) => e.trim().toLowerCase())
  .filter((e) => EMAIL_RE.test(e));
const destinatari = Array.from(
  new Set([contact.email?.toLowerCase(), ...extra].filter((e): e is string => Boolean(e))),
).slice(0, 20);
if (destinatari.length === 0) {
  return { ok: false, error: 'Nessun destinatario valido (email del contatto assente e nessun indirizzo aggiuntivo).' };
}
```

- Sostituire la singola `sendNotification({ ... target: { email: contact.email } ... })` con un loop:

```ts
for (const email of destinatari) {
  await sendNotification({
    tipo: 'N26_EMAIL_PARTENZA',
    target: { email },
    payload: {
      nomeReferente: input.nomeReferente.trim() || contact.nome,
      messaggio,
      categoria: contact.cat as 'BROKER' | 'AGENZIA',
      linkUrl,
      unsubUrl,
      codice,
    },
  });
}
```

L'`update` del contatto (con `status: nextStatoInvio(contact.status)`) resta invariato e una sola volta.

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/app/admin/crm/contatti/email-partenza.action.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/crm/contatti/actions.ts src/app/admin/crm/contatti/email-partenza.action.test.ts
git commit -m "feat(crm): email di partenza a più destinatari (loop invii, update contatto singolo)"
```

### Task 3.2: Campo "Altri destinatari" nella modale

**Files:**
- Modify: `src/app/admin/crm/contatti/client.tsx` — `EmailPartenzaModal` (805–958)

**Interfaces:**
- Consumes: `parseEmails` da `@/lib/crm/emails`.

- [ ] **Step 1: Stato + parsing nel componente**

In `EmailPartenzaModal`, dopo `const [promoCodeId, ...]` aggiungere:

```tsx
const [altriRaw, setAltriRaw] = useState('');
const parsedAltri = parseEmails(altriRaw);
```

E in `submit`, passare `emailAggiuntive: parsedAltri.validi` all'action.

- [ ] **Step 2: Riga "A:" con conteggio**

Aggiornare il paragrafo "A:" (859–862) per includere gli extra:

```tsx
<p className="mt-1 text-[12.5px] text-pv-slate-600">
  A: {contact.email ?? '—'}
  {parsedAltri.validi.length > 0 ? ` + ${parsedAltri.validi.length} altri` : ''} ·{' '}
  {contact.cat === 'BROKER' ? 'Broker' : 'Agenzia'}
  {contact.linkInviato ? ' · già inviata in precedenza' : ''}
</p>
```

- [ ] **Step 3: Campo textarea destinatari**

Dopo il `<label>` del Messaggio (dopo riga 888) aggiungere:

```tsx
<label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
  Altri destinatari (opzionale)
  <textarea
    value={altriRaw}
    onChange={(e) => setAltriRaw(e.target.value)}
    disabled={pending}
    rows={2}
    placeholder="email separate da virgola, spazio o a capo"
    className="mt-1 block w-full resize-y rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
  />
  <span className="mt-1 block text-[11px] font-normal text-pv-slate-500">
    {parsedAltri.validi.length} validi
    {parsedAltri.scartati.length > 0 ? ` · ${parsedAltri.scartati.length} ignorati` : ''}.
    La stessa email (con lo stesso link) parte a ciascun indirizzo.
  </span>
</label>
```

- [ ] **Step 4: Abilitare l'invio anche senza email primaria ma con extra**

Aggiornare il `disabled` del bottone Invia (948):

```tsx
disabled={
  pending || !nomeReferente.trim() || !messaggio.trim() ||
  (!contact.email && parsedAltri.validi.length === 0)
}
```

- [ ] **Step 5: Verifica browser**

Dev → lista → "Invia email" su un contatto. Incollare 2-3 indirizzi misti (validi/invalidi), verificare il conteggio "N validi · M ignorati", che "A:" mostri "+N altri", e che l'invio vada a buon fine. Controllare i log `.dev-emails/` (provider locale) o le `NotificaInviata` per confermare N invii.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): campo Altri destinatari nella modale email di partenza"
```

---

## Phase 4 — Punto 1: eliminazione massiva (hard delete)

### Task 4.1: `bulkHardDeleteCrmContactsAction`

**Files:**
- Modify: `src/app/admin/crm/contatti/actions.ts`
- Test: `src/app/admin/crm/contatti/bulk-delete.action.test.ts` (nuovo)

**Interfaces:**
- Consumes: `whereContatti`, `FiltroContatti` da `@/lib/crm/contatti-filtro`; `canDeleteCrmContact` da `@/lib/auth/permissions`.
- Produces: `bulkHardDeleteCrmContactsAction(input: { modo: 'ids'; ids: string[] } | { modo: 'filtro'; filtro: FiltroContatti; escludi: string[] }): Promise<{ ok: true; eliminati: number } | { ok: false; error: string }>`.

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { crmContactMock } = vi.hoisted(() => ({
  crmContactMock: { deleteMany: vi.fn() },
}));
vi.mock('@pv/db', () => ({ prisma: { crmContact: crmContactMock }, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  canEditCrmContact: () => true,
  canDeleteCrmContact: (role: string) => role !== 'SALES',
  canBulkImportCrm: () => true,
  canViewCrm: () => true,
}));

import { auth } from '@/auth';
import { bulkHardDeleteCrmContactsAction } from './actions';
const authMock = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN_PIATTAFORMA' } } as never);
  crmContactMock.deleteMany.mockResolvedValue({ count: 3 });
});

describe('bulkHardDeleteCrmContactsAction', () => {
  it('modo ids: deleteMany con gli id passati', async () => {
    const res = await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids: ['a', 'b', 'c'] });
    expect(res).toEqual({ ok: true, eliminati: 3 });
    expect(crmContactMock.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b', 'c'] } } });
  });
  it('modo ids vuoto: nessuna delete', async () => {
    const res = await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids: [] });
    expect(res).toEqual({ ok: true, eliminati: 0 });
    expect(crmContactMock.deleteMany).not.toHaveBeenCalled();
  });
  it('modo filtro: applica whereContatti + notIn escludi', async () => {
    await bulkHardDeleteCrmContactsAction({
      modo: 'filtro',
      filtro: { adesso: '2026-08-01T00:00:00.000Z', cat: 'AGENZIA' },
      escludi: ['keep1'],
    });
    const where = crmContactMock.deleteMany.mock.calls[0][0].where;
    expect(where.cat).toBe('AGENZIA');
    expect(where.id).toEqual({ notIn: ['keep1'] });
  });
  it('SALES non autorizzato', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', role: 'SALES' } } as never);
    const res = await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids: ['a'] });
    expect(res.ok).toBe(false);
    expect(crmContactMock.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/app/admin/crm/contatti/bulk-delete.action.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementazione (in `actions.ts`)**

Aggiungere l'import di `whereContatti`/`FiltroContatti` e:

```ts
export async function bulkHardDeleteCrmContactsAction(
  input:
    | { modo: 'ids'; ids: string[] }
    | { modo: 'filtro'; filtro: FiltroContatti; escludi: string[] },
): Promise<{ ok: true; eliminati: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canDeleteCrmContact(session.user.role)) {
    return { ok: false, error: 'Non autorizzato.' };
  }

  let where: Prisma.CrmContactWhereInput;
  if (input.modo === 'ids') {
    if (input.ids.length === 0) return { ok: true, eliminati: 0 };
    where = { id: { in: input.ids } };
  } else {
    where = { ...whereContatti(input.filtro), id: { notIn: input.escludi ?? [] } };
  }

  const res = await prisma.crmContact.deleteMany({ where });
  revalidatePath('/admin/crm/contatti');
  return { ok: true, eliminati: res.count };
}
```

(La cascade DB su `CrmCall` e `CrmCampaignAssegnazione` porta via i figli.)

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/app/admin/crm/contatti/bulk-delete.action.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/crm/contatti/actions.ts src/app/admin/crm/contatti/bulk-delete.action.test.ts
git commit -m "feat(crm): bulkHardDeleteCrmContactsAction (ids o filtro, hard delete)"
```

### Task 4.2: Selezione multipla + barra + dialog conferma

**Files:**
- Create: `src/app/admin/crm/contatti/bulk-delete-bar.tsx`
- Modify: `src/app/admin/crm/contatti/client.tsx` (tabella 360–449, header, stato del componente, filtro corrente)

**Interfaces:**
- Consumes: `bulkHardDeleteCrmContactsAction`; il `FiltroContatti` corrente serializzato dai filtri della lista; `canDelete` (già presente nel client via `ROLE_CAN_DELETE`).

- [ ] **Step 1: Stato di selezione nel client**

In `CrmContactsClient` aggiungere:

```tsx
const [selezionati, setSelezionati] = useState<Set<string>>(new Set());
const [tuttiIFiltrati, setTuttiIFiltrati] = useState(false); // "seleziona tutti i N"
const idsPagina = contacts.map((c) => c.id);
const tuttaLaPagina = idsPagina.length > 0 && idsPagina.every((id) => selezionati.has(id));
const toggleUno = (id: string) => {
  setTuttiIFiltrati(false);
  setSelezionati((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
};
const togglePagina = () => {
  setTuttiIFiltrati(false);
  setSelezionati((prev) => {
    const next = new Set(prev);
    if (tuttaLaPagina) idsPagina.forEach((id) => next.delete(id));
    else idsPagina.forEach((id) => next.add(id));
    return next;
  });
};
```

Reset della selezione ad ogni cambio pagina/filtro: in un `useEffect` su `[filters, page]` fare `setSelezionati(new Set()); setTuttiIFiltrati(false);`.

- [ ] **Step 2: Colonna checkbox in tabella**

Nell'header (363–371) anteporre `<th>` con una checkbox legata a `tuttaLaPagina`/`togglePagina`. In ogni riga (prima della cella Azienda) aggiungere:

```tsx
<td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
  <input
    type="checkbox"
    checked={selezionati.has(c.id)}
    onChange={() => toggleUno(c.id)}
    aria-label={`Seleziona ${c.nome}`}
  />
</td>
```

- [ ] **Step 3: Banner "seleziona tutti i N filtrati"**

Sotto la toolbar, quando `tuttaLaPagina && !tuttiIFiltrati && total > contacts.length`, mostrare:

```tsx
<div className="mb-2 rounded-[10px] border border-pv-navy-200 bg-pv-navy-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
  Selezionati {selezionati.size} in pagina.{' '}
  <button type="button" className="font-semibold underline" onClick={() => setTuttiIFiltrati(true)}>
    Seleziona tutti i {total} che corrispondono ai filtri
  </button>
</div>
```

Quando `tuttiIFiltrati` è attivo, mostrare invece "Tutti i {total} selezionati · [Annulla]".

- [ ] **Step 4: Barra azioni (nuovo componente `BulkDeleteBar`)**

`bulk-delete-bar.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { bulkHardDeleteCrmContactsAction } from './actions';
import type { FiltroContatti } from '@/lib/crm/contatti-filtro';

export function BulkDeleteBar({
  conteggio, tuttiIFiltrati, ids, filtro, escludi, onDone,
}: {
  conteggio: number;
  tuttiIFiltrati: boolean;
  ids: string[];
  filtro: FiltroContatti;
  escludi: string[];
  onDone: () => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [capito, setCapito] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elimina = async () => {
    setPending(true);
    setError(null);
    const res = tuttiIFiltrati
      ? await bulkHardDeleteCrmContactsAction({ modo: 'filtro', filtro, escludi })
      : await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids });
    setPending(false);
    if (res.ok) { setAperto(false); setCapito(false); onDone(); }
    else setError(res.error);
  };

  return (
    <>
      <div className="mb-2 flex items-center gap-3 rounded-[10px] border border-pv-red-200 bg-pv-red-50 px-3 py-2">
        <span className="text-[12.5px] font-semibold text-pv-red-700">{conteggio} selezionati</span>
        <Button variant="danger" size="sm" onClick={() => setAperto(true)}>
          Elimina definitivamente ({conteggio})
        </Button>
      </div>
      {aperto && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4" onClick={() => setAperto(false)}>
          <div className="w-full max-w-md rounded-[16px] bg-white p-5 shadow-[var(--pv-shadow-card-lg)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-pv-red-700">Eliminare {conteggio} contatti?</h3>
            <p className="mt-2 text-[12.5px] text-pv-slate-600">
              L'operazione è <strong>irreversibile</strong>: cancella i contatti dal database,
              insieme alle loro chiamate e assegnazioni campagne.
            </p>
            <label className="mt-3 flex items-center gap-2 text-[12.5px] text-pv-slate-700">
              <input type="checkbox" checked={capito} onChange={(e) => setCapito(e.target.checked)} />
              Capisco che è irreversibile
            </label>
            {error && <p className="mt-2 text-[12.5px] font-medium text-pv-red-500">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAperto(false)} disabled={pending}>Annulla</Button>
              <Button variant="danger" size="sm" onClick={elimina} disabled={!capito || pending} loading={pending} loadingLabel="Elimino…">
                Elimina definitivamente
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

(Verificare che `@/components/ui/button` abbia `variant="danger"`; altrimenti usare la classe rossa del design system come già fatto per "Elimina contatto" nel modale.)

- [ ] **Step 5: Montare la barra nel client**

Nel `CrmContactsClient`, quando `selezionati.size > 0 || tuttiIFiltrati`, renderizzare `<BulkDeleteBar>` con:
- `conteggio = tuttiIFiltrati ? total : selezionati.size`
- `ids = [...selezionati]`
- `filtro = filtroCorrente` (serializzare i filtri UI in `FiltroContatti`, con `adesso: new Date().toISOString()` e `soloAssegnatoAId` se SALES)
- `escludi = tuttiIFiltrati ? [] : []` (se in futuro si permette la deselezione dentro "tutti i filtrati", passare gli id deselezionati)
- `onDone = () => { setSelezionati(new Set()); setTuttiIFiltrati(false); router.refresh(); }`

Gate: solo se `canDelete`.

- [ ] **Step 6: Verifica browser (gesto reale)**

Dev → lista. Selezionare alcune righe → compare la barra rossa → "Elimina definitivamente (N)" → dialog → spuntare "Capisco" → confermare → le righe spariscono e il conteggio cala. Poi provare "Seleziona tutti i N filtrati" con un filtro categoria stretto su **pochi** record di test e confermare (NON su tutti i 19k). Verificare in psql che i record e i loro `CrmCall`/assegnazioni siano spariti.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/contatti/client.tsx src/app/admin/crm/contatti/bulk-delete-bar.tsx
git commit -m "feat(crm): selezione multipla + eliminazione massiva definitiva"
```

---

## Phase 5 — Punto 4: colonne Fatti/Giudizio + storico + superfici richiamo

### Task 5.1: Action `giudizio` e `richiamo` (decoupled da status)

**Files:**
- Modify: `src/app/admin/crm/contatti/actions.ts`
- Test: `src/app/admin/crm/contatti/giudizio-richiamo.action.test.ts` (nuovo)

**Interfaces:**
- Produces:
  - `updateCrmContactGiudizioAction(id: string, giudizio: 'INTERESSATO' | 'NON_INTERESSATO' | null): Promise<{ ok: true } | { ok: false; error: string }>`
  - `updateCrmContactRichiamoAction(id: string, richiamo: { giorno: string; fascia: string } | null): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Test che fallisce**

Riusare l'harness di `actions.richiamo.test.ts` (mock `@pv/db`, `@/auth`, ecc.). Nuovo file:

```ts
// stessi vi.mock di actions.richiamo.test.ts (crmContactMock con findUnique/update)
import { updateCrmContactGiudizioAction, updateCrmContactRichiamoAction } from './actions';

describe('updateCrmContactGiudizioAction', () => {
  it('scrive solo il giudizio', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    const res = await updateCrmContactGiudizioAction('x1', 'INTERESSATO');
    expect(res.ok).toBe(true);
    expect(crmContactMock.update.mock.calls[0][0].data).toEqual({ giudizio: 'INTERESSATO' });
  });
  it('null azzera il giudizio', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactGiudizioAction('x1', null);
    expect(crmContactMock.update.mock.calls[0][0].data).toEqual({ giudizio: null });
  });
  it('SALES su contatto altrui: rifiuto senza scrivere', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', role: 'SALES' } } as never);
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: 'altro' });
    const res = await updateCrmContactGiudizioAction('x1', 'INTERESSATO');
    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });
});

describe('updateCrmContactRichiamoAction', () => {
  it('imposta nextContactAt e fascia, senza toccare status', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactRichiamoAction('x1', { giorno: '2026-08-04', fascia: 'MATTINA' });
    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toEqual(new Date('2026-08-04'));
    expect(data.nextContactFascia).toBe('MATTINA');
    expect(data.status).toBeUndefined();
  });
  it('fascia vuota → null', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactRichiamoAction('x1', { giorno: '2026-08-04', fascia: '' });
    expect(crmContactMock.update.mock.calls[0][0].data.nextContactFascia).toBeNull();
  });
  it('null rimuove il richiamo', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    await updateCrmContactRichiamoAction('x1', null);
    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });
  it('giorno in formato errato viene rifiutato', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null });
    const res = await updateCrmContactRichiamoAction('x1', { giorno: '04/08/2026', fascia: '' });
    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm vitest run src/app/admin/crm/contatti/giudizio-richiamo.action.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementazione**

Aggiungere in `actions.ts` (riusare l'helper di scoping SALES già presente — stesso pattern di `updateCrmContactStatusAction`, con errore offuscato identico per not-found/not-owned; estrarre una funzioncina `assertPuoScrivere(id)` se comodo):

```ts
export async function updateCrmContactGiudizioAction(
  id: string,
  giudizio: 'INTERESSATO' | 'NON_INTERESSATO' | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) return { ok: false, error: 'Non autorizzato.' };
  const contact = await prisma.crmContact.findUnique({ where: { id }, select: { assignedToId: true } });
  const ERR = { ok: false, error: 'Contatto non trovato.' } as const;
  if (!contact) return ERR;
  if (session.user.role === 'SALES' && contact.assignedToId !== session.user.id) return ERR;
  await prisma.crmContact.update({ where: { id }, data: { giudizio } });
  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}

export async function updateCrmContactRichiamoAction(
  id: string,
  richiamo: { giorno: string; fascia: string } | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) return { ok: false, error: 'Non autorizzato.' };
  const contact = await prisma.crmContact.findUnique({ where: { id }, select: { assignedToId: true } });
  const ERR = { ok: false, error: 'Contatto non trovato.' } as const;
  if (!contact) return ERR;
  if (session.user.role === 'SALES' && contact.assignedToId !== session.user.id) return ERR;

  if (richiamo === null) {
    await prisma.crmContact.update({ where: { id }, data: { nextContactAt: null, nextContactFascia: null } });
    revalidatePath('/admin/crm/contatti');
    return { ok: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(richiamo.giorno)) {
    return { ok: false, error: 'Serve un giorno valido per il richiamo.' };
  }
  await prisma.crmContact.update({
    where: { id },
    data: {
      nextContactAt: new Date(richiamo.giorno),
      nextContactFascia: (richiamo.fascia || null) as 'MATTINA' | 'POMERIGGIO' | null,
    },
  });
  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}
```

- [ ] **Step 4: Verifica pass**

Run: `pnpm vitest run src/app/admin/crm/contatti/giudizio-richiamo.action.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/crm/contatti/actions.ts src/app/admin/crm/contatti/giudizio-richiamo.action.test.ts
git commit -m "feat(crm): action giudizio e richiamo decoupled da status"
```

### Task 5.2: Restringere le opzioni `status` alle sole fattuali + `giudizio` nel full update

**Files:**
- Modify: `src/app/admin/crm/contatti/actions.ts` (validazione status di `updateCrmContactAction`, ~68-71/355-357), `src/app/admin/crm/contatti/client.tsx` (opzioni della `FieldSelect` status nel `TabStato`, ~1544-1585)

- [ ] **Step 1: Includere `giudizio` nel `dataFromInput`/update del modale**

In `updateCrmContactAction` (e nel tipo `CrmContactInput` del client) aggiungere `giudizio` fra i campi salvati (`data.giudizio = d.giudizio ?? null`).

- [ ] **Step 2: Restringere le opzioni status nel modale**

Nel `TabStato`, la select dello status deve offrire solo i codici fattuali `S0,S1,S4,S5,S6,S7,S8,S9,S10` (togliere S2,S3,S11 dalle opzioni presentate). Aggiungere sotto una `FieldSelect` "Giudizio" (—/Interessato/Non interessato) legata a `giudizio`, e i campi richiamo (già presenti: `nextContactAt`/`nextContactFascia`) come sezione "Richiamo".

- [ ] **Step 3: Verifica browser + typecheck + commit**

Aprire un contatto → tab Stato → verificare le tre sezioni (Stato fattuale, Giudizio, Richiamo) e che il salvataggio persista `giudizio`.

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/contatti/actions.ts src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): status solo fattuale nel modale + giudizio salvato"
```

### Task 5.3: Colonna "Fatti" + `GiudizioSelect` in lista, chip richiamo su `nextContactAt`

**Files:**
- Create: `src/app/admin/crm/contatti/giudizio-select.tsx`
- Modify: `src/app/admin/crm/contatti/client.tsx` (tabella 360–449, sostituzione di `StatusSelect` nella cella stato 413–419)

**Interfaces:**
- Consumes: `statoFattuale` da `@/lib/crm/fatti`; `updateCrmContactGiudizioAction`, `updateCrmContactRichiamoAction`; `etichettaRichiamo` da `@/lib/crm/richiamo`; `RichiamoDialog`.

- [ ] **Step 1: `GiudizioSelect` (pill giudizio + azione richiamo)**

`giudizio-select.tsx`: pill con opzioni — / Interessato / Non interessato che chiama `updateCrmContactGiudizioAction` (ottimistico). Sotto, il chip richiamo (se `nextContactAt`) via `etichettaRichiamo`, e un pulsante "Programma richiamo" che apre `RichiamoDialog` → `updateCrmContactRichiamoAction`. (Mirare il pattern ottimistico di `StatusSelect`, 566–666.)

- [ ] **Step 2: Due colonne in tabella**

Nell'header sostituire la colonna unica "Stato" con due `<th>`: **Fatti** e **Stato**. Nelle righe:
- cella "Fatti": `const f = statoFattuale(c);` → badge sola-lettura `{f.label}` + data relativa (`f.at`), click sulla cella apre il modale sulla tab tracking (`setEditing(c); setTab('tracking')`).
- cella "Stato": `<GiudizioSelect contact={c} />` (sostituisce `<StatusSelect>`).

- [ ] **Step 3: Il chip filtro "Da richiamare" punta al conteggio nuovo**

Verificare che il badge `richiamiDovuti` (già calcolato lato server con la nuova condizione in Task 1.5) sia coerente. Nessun altra modifica qui.

- [ ] **Step 4: Verifica browser (il bug S11!)**

Scenario di regressione del bug: prendere un contatto, programmargli un richiamo (compare nel chip "Da richiamare"), poi inviargli l'email di partenza e aprire il suo link `/i/<token>` in incognito. Tornare alla lista: la colonna **Fatti** deve mostrare "Link aperto" (lo `status` è avanzato a S5), **mentre** il richiamo resta visibile finché non lo chiudi. Prima questo non avveniva (restava incastrato su S11).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/contatti/giudizio-select.tsx src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): colonne Fatti + Giudizio in lista, richiamo su nextContactAt (fix bug S11)"
```

### Task 5.4: Timeline nel modale

**Files:**
- Create: `src/app/admin/crm/contatti/timeline-fatti.tsx`
- Modify: `src/app/admin/crm/contatti/client.tsx` (`TabTracking`, 1660+); `page.tsx`/`ContactModal` per caricare le `calls` del contatto aperto

**Interfaces:**
- Consumes: `timelineFatti` da `@/lib/crm/fatti`.

- [ ] **Step 1: Caricare le `calls` del contatto aperto**

Quando si apre il modale, servono le `CrmCall` del contatto. Aggiungere una server action leggera `getContactCallsAction(id): Promise<CallFatto[]>` (auth `canViewCrm` + scoping SALES) oppure includere `calls: { select: { startedAt: true, esito: true } }` nella query del contatto quando si apre il modale. Preferire l'action on-open per non appesantire la lista.

- [ ] **Step 2: Componente `TimelineFatti`**

`timeline-fatti.tsx`: riceve `contact` + `calls`, chiama `timelineFatti(...)`, e renderizza gli eventi in ordine con la data (`etichettaRichiamo`/`Intl` per il formato) e il delta rispetto all'evento precedente ("+3 giorni"). Sola lettura.

- [ ] **Step 3: Montare in `TabTracking`**

In cima a `TabTracking` (1661) inserire `<TimelineFatti contact={...} calls={...} />` sopra i campi booleani esistenti.

- [ ] **Step 4: Verifica browser + typecheck + commit**

Aprire un contatto avanzato (registrato) → tab Tracking → la timeline mostra creato → email → apertura → registrazione con i delta.

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/contatti/timeline-fatti.tsx src/app/admin/crm/contatti/client.tsx src/app/admin/crm/contatti/actions.ts src/app/admin/crm/contatti/page.tsx
git commit -m "feat(crm): timeline datata dei fatti nella scheda contatto"
```

### Task 5.5: `linkApertoAt` nel route del token + commento `richiamo.ts`

**Files:**
- Modify: `src/app/i/[token]/route.ts:54` (blocco update), `src/lib/crm/richiamo.ts` (commento in testa), `src/app/admin/crm/contatti/richiamo-dialog.tsx` (onConfirm)

- [ ] **Step 1: Datare la prima apertura**

Nel route `/i/[token]`, nell'update best-effort che setta `linkAperto`/`linkAperture`, aggiungere `linkApertoAt: contact.linkApertoAt ?? new Date()` (prima apertura; non sovrascrive). Assicurarsi che la `select` del contatto includa `linkApertoAt`.

- [ ] **Step 2: `richiamo-dialog.tsx` → action richiamo**

Se `RichiamoDialog` oggi imposta `status=S11`, cambiarne l'`onConfirm` per chiamare `updateCrmContactRichiamoAction(id, { giorno, fascia })`. (Se il dialog è puramente presentazionale e il salvataggio avviene nel chiamante, adeguare il chiamante in `GiudizioSelect`.)

- [ ] **Step 3: Aggiornare il commento di `richiamo.ts`**

Sostituire il grande commento in testa (che descrive il modello S11 e le 6 write path) con la descrizione del modello a tre assi: il richiamo vive su `nextContactAt`, indipendente da `status`; la chiusura alla registrazione è ottenuta filtrando `iscrizioneComp=false`, non azzerando nelle write path. Mantenere `etichettaRichiamo`, `LABEL_FASCIA`, `OPZIONI_FASCIA`, `sogliaRichiamoDovuto`. `campiRichiamoDopoCambioStato` non è più chiamata dalle nuove action; se resta senza consumer, rimuoverla insieme al suo test, oppure lasciarla documentata come no-op legacy (scegliere in base ai consumer residui — verificare con grep).

- [ ] **Step 4: Verifica + typecheck + commit**

Grep `campiRichiamoDopoCambioStato` e `STATO_RICHIAMARE` per assicurarsi che non restino consumer rotti. Aprire un link `/i/<token>` e verificare in psql che `linkApertoAt` si popoli.

```bash
pnpm --filter piattaforma typecheck
git add src/app/i/[token]/route.ts src/lib/crm/richiamo.ts src/app/admin/crm/contatti/richiamo-dialog.tsx
git commit -m "feat(crm): linkApertoAt alla prima apertura + richiamo.ts al modello a tre assi"
```

---

## Phase 6 — Punto 3: calendario richiami + Google Calendar

### Task 6.1: Pagina `/admin/crm/richiami`

**Files:**
- Create: `src/app/admin/crm/richiami/page.tsx`, `src/app/admin/crm/richiami/client.tsx`
- Modify: la sidebar admin CRM (individuare con `grep -rn "crm/dashboard" src/` o il componente di nav dello shell CRM)

**Interfaces:**
- Consumes: `googleCalendarUrl`, `etichettaRichiamo`, `telHref`, `sogliaRichiamoDovuto`; scoping SALES via sessione.

- [ ] **Step 1: Query lato server (`page.tsx`)**

Auth `canViewCrm`. Query:

```ts
const contatti = await prisma.crmContact.findMany({
  where: {
    deletedAt: null,
    iscrizioneComp: false,
    nextContactAt: { not: null },
    ...(session.user.role === 'SALES' ? { assignedToId: session.user.id } : {}),
  },
  select: { id: true, nome: true, cat: true, tel: true, citta: true, nextContactAt: true, nextContactFascia: true },
  orderBy: { nextContactAt: 'asc' },
  take: 500,
});
```

Serializzare le date a ISO e passare al client. (Nota: include anche i futuri, non solo i "dovuti", perché è un calendario.)

- [ ] **Step 2: `client.tsx` — agenda raggruppata per giorno**

Raggruppare per giorno romano (usare `etichettaRichiamo(nextContactAt, fascia, now)` per il testo e lo stato scaduto/oggi). Sezioni: Scaduti, Oggi, poi i giorni futuri. Ogni riga:
- nome + categoria;
- telefono cliccabile (`telHref`);
- fascia (mattina/pomeriggio/indifferente);
- link "Apri contatto" (`/admin/crm/contatti?...` o apertura modale);
- `<a href={googleCalendarUrl({ nome, tel, citta, giorno: new Date(nextContactAt), fascia })} target="_blank" rel="noopener noreferrer">Aggiungi a Google Calendar</a>`.

- [ ] **Step 3: Voce in sidebar**

Individuare l'array di navigazione CRM (dove compaiono "Dashboard"/"Contatti") e aggiungere `{ href: '/admin/crm/richiami', label: 'Richiami' }` (icona calendario se il pattern lo prevede). Se lo shell CRM usa `AdminShell` per-pagina, aggiungere la voce nella stessa lista usata dalle altre pagine CRM.

- [ ] **Step 4: Link dalla lista contatti**

Nel chip "📞 Da richiamare" della toolbar contatti, o accanto, aggiungere un link a `/admin/crm/richiami` ("Vedi calendario").

- [ ] **Step 5: Verifica browser**

Aprire `/admin/crm/richiami`: i richiami sono raggruppati per giorno, con scaduti in alto. Cliccare "Aggiungi a Google Calendar" apre Google con l'evento precompilato (mattina 09-13, ecc.). Telefono cliccabile funziona.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter piattaforma typecheck
git add src/app/admin/crm/richiami
# + il file della sidebar modificato
git commit -m "feat(crm): pagina Calendario richiami + Aggiungi a Google Calendar"
```

---

## Phase 7 — Verifica end-to-end e chiusura

### Task 7.1: Suite completa + typecheck + verifica browser integrata

- [ ] **Step 1: Test completi**

Run: `cd apps/piattaforma && pnpm test`
Expected: tutti verdi (inclusi i test CRM preesistenti — attenzione a `csv-import`, `richiamo`, `email-partenza` che toccano status/richiamo).

- [ ] **Step 2: Typecheck globale**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm --filter piattaforma lint`
Expected: nessun errore nuovo.

- [ ] **Step 4: Verifica browser integrata (gesto reale)**

Con dev server pulito (uccidere eventuali zombie su :3000):
1. **Elimina massiva**: selezione multipla, "seleziona tutti i filtrati" su un filtro stretto di test, conferma, i record spariscono (+ figli in psql).
2. **tel:**: numero cliccabile in lista e "📞 Chiama" nel modale.
3. **Email multi**: modale email, 2-3 indirizzi, N invii nei log/`NotificaInviata`, contatto aggiornato una volta.
4. **Split stati**: colonna Fatti (derivata dai flag) + colonna Stato (giudizio editabile), timeline nel modale.
5. **Bug S11**: contatto con richiamo → invio email + apertura link → Fatti mostra "Link aperto" e il richiamo resta indipendente. **Confermato risolto.**
6. **Calendario**: `/admin/crm/richiami` raggruppato per giorno + "Aggiungi a Google Calendar".

- [ ] **Step 5: Aggiornare la memoria/roadmap se previsto**

Se `docs/piano-implementazione.md` traccia il progresso CRM, aggiornarlo. Aggiornare eventualmente la memoria `project_crm_stato_richiamare` per riflettere che il richiamo è passato da `status=S11` a `nextContactAt` (asse indipendente) e che esiste `giudizio`.

- [ ] **Step 6: Deploy (manuale, quando deciso)**

Ricordare: la migration `20260801120000_crm_giudizio_link_aperto_at` va applicata a mano sul DB prod (Neon **ep-solitary-night**) con `prisma migrate deploy` **prima** del push su main. Poi push main → Vercel.

---

## Self-Review (svolto in fase di stesura)

**1. Copertura spec:**
- Punto 1 (elimina massiva) → Task 4.1, 4.2. ✅
- Punto 2 (tel:) → Task 2.1. ✅
- Punto 3 (calendario + Google Calendar) → Task 1.3, 6.1. ✅
- Punto 4 (Fatti/Giudizio + storico + fix S11) → Task 0.1, 1.4, 1.5, 5.1–5.5. ✅
- Punto 5 (email multi) → Task 1.2, 3.1, 3.2. ✅

**2. Placeholder:** nessun "TBD/TODO"; le UI hanno codice concreto o istruzioni di cablaggio con anchor reali + verifica browser (i test unit coprono la logica pura e le action).

**3. Coerenza tipi:** `FiltroContatti`/`whereContatti` usati identici in 1.5/4.1/4.2/6.1; `statoFattuale`/`timelineFatti`/`ContattoFatti`/`CallFatto` coerenti fra 1.4 e 5.3/5.4; le action `updateCrmContactGiudizioAction`/`updateCrmContactRichiamoAction`/`bulkHardDeleteCrmContactsAction` hanno la stessa firma dove consumate.

**Note aperte (implementazione):**
- Il nome esatto del file della sidebar CRM è da individuare (Task 6.1 Step 3) — grep fornito.
- Verificare che `@/components/ui/button` esponga `variant="danger"`; fallback alla classe rossa del design system.
- `campiRichiamoDopoCambioStato`: decidere rimozione vs no-op legacy in base ai consumer residui (Task 5.5 Step 3).
