# Riconciliazione CRM ↔ aziende registrate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riconoscere quali righe della lista CRM importata corrispondono ad aziende e sedi già registrate, agganciarle e portarne lo stato al punto reale del funnel (S7/S8/S9).

**Architecture:** Un motore unico sotto `apps/piattaforma/src/lib/crm/match/`: quattro moduli puri (normalizzazione, identità, punteggio, assegnazione) e due moduli server (lettura dal DB in dry-run, scrittura). Tre chiamanti: la registrazione, il cron `crm-sync` e una pagina admin con anteprima. Le chiavi normalizzate dei contatti vivono su colonne indicizzate di `crm_contacts`, scritte da un helper unico.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Postgres, vitest, TypeScript strict, Tailwind (design system `components/ui`).

**Spec:** `docs/superpowers/specs/2026-07-27-crm-riconciliazione-design.md`

## Global Constraints

- Branch di lavoro: `feat/crm-riconciliazione`. Un'altra sessione lavora su `main`: non fare rebase/merge senza chiedere.
- Node: `nvm use 22.15.0` prima di qualsiasi `pnpm` (post-riavvio la shell torna a Node 16).
- Test: `pnpm --filter @pv/piattaforma test` (vitest, `run` non watch). Typecheck: `pnpm typecheck`.
- **Mai** `pnpm db:migrate` (`prisma migrate dev` propone DROP distruttivi su questo schema): migration scritta a mano + `pnpm --filter @pv/db db:deploy`.
- Ogni modulo puro (niente `server-only`, niente Prisma) sta in file separati da quelli server: i test dei puri non devono mockare nulla.
- Testi UI in italiano. Nessun colore hardcoded: usare le classi `pv-*` del design system.
- Commit in italiano, uno per task, con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Il DB locale è una copia di prod: 19.103 contatti CRM, 19 company, 22 sedi. Query di verifica:
  `docker exec pv-postgres psql -U pv -d passaggio_veloce -c "<sql>"`.

---

### Task 1: Normalizzatori (modulo puro)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/normalize.ts`
- Test: `apps/piattaforma/src/lib/crm/match/normalize.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `normalizeTel(raw: string|null|undefined): string`, `normalizeEmail`, `normalizePiva`, `normalizeNome`, `normalizeIndirizzo`, `normalizeCitta`, `normalizeCap` — stessa firma per tutte, ritornano `''` quando il valore non è utilizzabile come chiave.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/match/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeTel,
  normalizeEmail,
  normalizePiva,
  normalizeNome,
  normalizeIndirizzo,
  normalizeCitta,
  normalizeCap,
} from './normalize';

describe('normalizeTel', () => {
  it('riduce alla stessa chiave le tre scritture dello stesso fisso', () => {
    expect(normalizeTel('+39 02 447 8712')).toBe('024478712');
    expect(normalizeTel('024478712')).toBe('024478712');
    expect(normalizeTel('0039 02 4478712')).toBe('024478712');
  });

  it('toglie il prefisso 39 dai cellulari con internazionale', () => {
    expect(normalizeTel('+39 346 287 7310')).toBe('3462877310');
  });

  it('NON tocca i cellulari 39x a 10 cifre', () => {
    expect(normalizeTel('3912345678')).toBe('3912345678');
  });

  it('scarta i valori troppo corti per essere una prova', () => {
    expect(normalizeTel('N/D')).toBe('');
    expect(normalizeTel('1234567')).toBe('');
    expect(normalizeTel('')).toBe('');
    expect(normalizeTel(null)).toBe('');
  });
});

describe('normalizeEmail', () => {
  it('trim + minuscolo', () => {
    expect(normalizeEmail('  Info@Agenzia.IT ')).toBe('info@agenzia.it');
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('normalizePiva', () => {
  it('tiene solo le cifre e pretende 11 caratteri', () => {
    expect(normalizePiva('IT 06199680155')).toBe('06199680155');
    expect(normalizePiva('123')).toBe('');
    expect(normalizePiva(null)).toBe('');
  });
});

describe('normalizeNome', () => {
  it('toglie forma societaria, accenti e punteggiatura', () => {
    expect(normalizeNome('Dimensione Auto Milano S.r.l.')).toBe('dimensione auto milano');
    expect(normalizeNome('Dimensione Auto Milano Srls')).toBe('dimensione auto milano');
    expect(normalizeNome("Città Auto S.p.A.")).toBe('citta auto');
  });

  it('ritorna stringa vuota se non resta nulla', () => {
    expect(normalizeNome('S.r.l.')).toBe('');
    expect(normalizeNome(null)).toBe('');
  });
});

describe('normalizeIndirizzo', () => {
  it('rende uguali indirizzo con e senza civico', () => {
    expect(normalizeIndirizzo('Via Fiume 6')).toBe('via fiume');
    expect(normalizeIndirizzo('Via Fiume')).toBe('via fiume');
    expect(normalizeIndirizzo('Via di Madonna Bianca, 3/b')).toBe('via di madonna bianca');
  });

  it('scioglie le abbreviazioni', () => {
    expect(normalizeIndirizzo('V.le Italia 19')).toBe('viale italia');
    expect(normalizeIndirizzo('P.zza Cavour')).toBe('piazza cavour');
  });

  it('non mangia i numeri che fanno parte del nome della via', () => {
    expect(normalizeIndirizzo('Via 25 Aprile')).toBe('via 25 aprile');
  });
});

describe('normalizeCitta / normalizeCap', () => {
  it('normalizza città e pretende un CAP a 5 cifre', () => {
    expect(normalizeCitta(' Trezzano sul Naviglio ')).toBe('trezzano sul naviglio');
    expect(normalizeCap('20094')).toBe('20094');
    expect(normalizeCap('209')).toBe('');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "./normalize"`.

- [ ] **Step 3: Implementa i normalizzatori**

Crea `apps/piattaforma/src/lib/crm/match/normalize.ts`:

```ts
/**
 * Normalizzazione dei campi con cui si riconosce un'azienda registrata dentro
 * la lista CRM. Modulo PURO: niente server-only, niente Prisma.
 *
 * È la FONTE UNICA. Prima esistevano due `normalizePhone` divergenti
 * (`lib/crm/util.ts` e `lib/crm/phone.ts`) e il match telefonico non scattava
 * mai, perché il numero normalizzato veniva confrontato con `CrmContact.tel`
 * grezzo ("+39 02 447 8712").
 *
 * Convenzione: `''` significa "non utilizzabile come chiave" e non deve MAI
 * essere considerato uguale a un altro `''`.
 */

const SOLO_CIFRE = /\D/g;

/**
 * Telefono → chiave. Solo cifre, prefisso internazionale italiano rimosso:
 * '+39 02 447 8712', '0039 02 4478712' e '02 4478712' danno '024478712'.
 * Il taglio del '39' iniziale scatta solo oltre le 10 cifre, così i cellulari
 * 39x (391/392/393…) restano interi. Sotto le 8 cifre la chiave è troppo debole
 * per fare da prova d'identità (in lista ci sono 19 righe 'N/D').
 */
export function normalizeTel(raw: string | null | undefined): string {
  if (!raw) return '';
  let d = raw.replace(SOLO_CIFRE, '');
  if (d.startsWith('0039')) d = d.slice(4);
  else if (d.startsWith('39') && d.length > 10) d = d.slice(2);
  return d.length >= 8 ? d : '';
}

export function normalizeEmail(raw: string | null | undefined): string {
  return raw ? raw.trim().toLowerCase() : '';
}

/** P.IVA → 11 cifre, altrimenti nessuna chiave. */
export function normalizePiva(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(SOLO_CIFRE, '');
  return d.length === 11 ? d : '';
}

/** Minuscolo, accenti sciolti, trim. Base comune degli altri normalizzatori. */
function base(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const FORME_SOCIETARIE =
  /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc(?:ieta)?\s*coop(?:erativa)?|s\.?c\.?)\b/g;

const PUNTEGGIATURA = /[^a-z0-9]+/g;

/** Ragione sociale → chiave: senza forma societaria né punteggiatura. */
export function normalizeNome(raw: string | null | undefined): string {
  return base(raw)
    .replace(FORME_SOCIETARIE, ' ')
    .replace(PUNTEGGIATURA, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const ABBREVIAZIONI: Array<[RegExp, string]> = [
  [/\bv\.?le\b/g, 'viale'],
  [/\bp\.?zz?a\b/g, 'piazza'],
  [/\bc\.?so\b/g, 'corso'],
  [/\bv\.\s*/g, 'via '],
];

/**
 * Indirizzo → chiave, senza civico finale: in lista l'indirizzo è "Via Fiume 6",
 * in piattaforma via e civico sono due campi ("Via Fiume" + "6").
 */
export function normalizeIndirizzo(raw: string | null | undefined): string {
  let s = base(raw);
  for (const [re, to] of ABBREVIAZIONI) s = s.replace(re, to);
  s = s.replace(PUNTEGGIATURA, ' ').trim().replace(/\s+/g, ' ');
  // Civico finale: numero eventualmente seguito da lettera ("12 e", "3 b").
  s = s.replace(/\s+\d+(?:\s+[a-z])?$/, '');
  return s.trim();
}

export function normalizeCitta(raw: string | null | undefined): string {
  return base(raw).replace(PUNTEGGIATURA, ' ').trim().replace(/\s+/g, ' ');
}

export function normalizeCap(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(SOLO_CIFRE, '');
  return d.length === 5 ? d : '';
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/normalize.test.ts`
Expected: PASS, tutti i casi.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/normalize.ts apps/piattaforma/src/lib/crm/match/normalize.test.ts
git commit -m "feat(crm): normalizzatori unici per il match CRM"
```

---

### Task 2: Una sola implementazione di normalizePhone

Elimina la divergenza: `lib/crm/phone.ts` e `normalizePhone` in `lib/crm/util.ts` spariscono, i consumer passano a `normalizeTel`.

**Files:**
- Delete: `apps/piattaforma/src/lib/crm/phone.ts`, `apps/piattaforma/src/lib/crm/phone.test.ts`
- Modify: `apps/piattaforma/src/lib/crm/util.ts` (rimuove `normalizePhone`, resta `isPreIscrizione`)
- Modify: `apps/piattaforma/src/lib/crm/sync.ts:3-5` (import e re-export)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts:16` (import)
- Modify: `apps/piattaforma/src/lib/crm/sync.test.ts` (toglie i test di `normalizePhone`)

**Interfaces:**
- Consumes: `normalizeTel` (Task 1).
- Produces: nessuna API nuova. Dopo questo task `normalizePhone` non esiste più in nessun file.

- [ ] **Step 1: Trova tutti i consumer**

Run: `grep -rn "normalizePhone\|crm/phone" apps/piattaforma/src --include=*.ts --include=*.tsx`
Expected: import in `sync.ts`, `util.ts`, `contatti/actions.ts` (riga 16, usato a 215/223/380/390), i due file di test.

- [ ] **Step 2: Aggiorna i test perché falliscano sulla nuova realtà**

In `apps/piattaforma/src/lib/crm/sync.test.ts` sostituisci l'import e cancella il blocco `describe('normalizePhone', …)` (Task 1 lo copre in `normalize.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { isPreIscrizione } from './util';
```

Cancella `apps/piattaforma/src/lib/crm/phone.test.ts`.

- [ ] **Step 3: Esegui la suite e verifica il fallimento atteso**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm`
Expected: FAIL — `phone.ts` è ancora importato da `actions.ts`, oppure `util.ts` esporta ancora `normalizePhone` (a seconda dell'ordine). Serve a dimostrare che i consumer sono davvero agganciati.

- [ ] **Step 4: Rimuovi le implementazioni doppie e aggiorna i consumer**

`apps/piattaforma/src/lib/crm/util.ts` diventa:

```ts
/**
 * Helper puri condivisi del modulo CRM. Niente import server-only qui:
 * questo file deve restare unit-testable senza setup Node/Prisma.
 *
 * La normalizzazione del telefono vive in `match/normalize.ts` (fonte unica).
 */

/** Stati pre-iscrizione (S0..S6). */
export function isPreIscrizione(status: string): boolean {
  return ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'].includes(status);
}
```

Cancella `apps/piattaforma/src/lib/crm/phone.ts` e `phone.test.ts`.

In `apps/piattaforma/src/lib/crm/sync.ts` sostituisci le righe 3-5 con:

```ts
import { isPreIscrizione } from './util';
import { normalizeTel } from './match/normalize';
```

e sostituisci l'uso a riga 77 (`tel: normalizePhone(company.telefono)`) con `tel: normalizeTel(company.telefono)`. (Il match resta rotto fino al Task 9, che riscrive la funzione: qui si sistema solo la duplicazione.)

In `apps/piattaforma/src/app/admin/crm/contatti/actions.ts` sostituisci l'import di riga 16 con:

```ts
import { normalizeTel } from '@/lib/crm/match/normalize';
```

e rinomina le quattro chiamate `normalizePhone(` → `normalizeTel(` (righe 215, 223, 380, 390).

- [ ] **Step 5: Verifica che non resti nessun riferimento**

Run: `grep -rn "normalizePhone\|crm/phone" apps/piattaforma/src --include=*.ts --include=*.tsx`
Expected: nessun risultato.

- [ ] **Step 6: Esegui test e typecheck**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm && pnpm typecheck`
Expected: PASS entrambi.

- [ ] **Step 7: Commit**

```bash
git add -A apps/piattaforma/src/lib/crm apps/piattaforma/src/app/admin/crm/contatti/actions.ts
git commit -m "refactor(crm): una sola normalizzazione del telefono"
```

---

### Task 3: Colonne normalizzate su crm_contacts (migration + write path)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `CrmContact` ~riga 2190, model `Sede` ~riga 656)
- Create: `packages/db/prisma/migrations/20260727150000_crm_match_normalizzato/migration.sql`
- Create: `apps/piattaforma/src/lib/crm/match/norm-fields.ts`
- Create: `apps/piattaforma/src/lib/crm/match/norm-fields.test.ts`
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts` (`dataFromInput` ~riga 129, `bulkImportCrmContactsAction` ~riga 398)

**Interfaces:**
- Consumes: `normalizeTel`, `normalizeEmail`, `normalizePiva` (Task 1).
- Produces: `crmNormFields(input: { tel?: string|null; wa?: string|null; email?: string|null; piva?: string|null }): { telNorm: string|null; waNorm: string|null; emailNorm: string|null; pivaNorm: string|null }`; colonne `telNorm/waNorm/emailNorm/pivaNorm/sedeId/matchVia/matchedAt` su `crm_contacts`.

- [ ] **Step 1: Scrivi il test dell'helper**

Crea `apps/piattaforma/src/lib/crm/match/norm-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { crmNormFields } from './norm-fields';

describe('crmNormFields', () => {
  it('produce le quattro colonne normalizzate', () => {
    expect(
      crmNormFields({
        tel: '+39 02 447 8712',
        wa: '+39 346 287 7310',
        email: ' Info@Agenzia.IT ',
        piva: 'IT 06199680155',
      }),
    ).toEqual({
      telNorm: '024478712',
      waNorm: '3462877310',
      emailNorm: 'info@agenzia.it',
      pivaNorm: '06199680155',
    });
  });

  it('mette null (non stringa vuota) quando il valore non è una chiave', () => {
    expect(crmNormFields({ tel: 'N/D', wa: null, email: '', piva: '123' })).toEqual({
      telNorm: null,
      waNorm: null,
      emailNorm: null,
      pivaNorm: null,
    });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/norm-fields.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementa l'helper**

Crea `apps/piattaforma/src/lib/crm/match/norm-fields.ts`:

```ts
/**
 * Colonne normalizzate di CrmContact. Un solo posto che le calcola: ogni write
 * path che tocca tel/wa/email/piva DEVE passare di qui, altrimenti le colonne
 * si desincronizzano in silenzio e il match torna a non trovare nulla.
 *
 * `null` e non `''`: in SQL la stringa vuota sarebbe una chiave uguale per
 * tutte le righe senza dato.
 */
import { normalizeTel, normalizeEmail, normalizePiva } from './normalize';

export type CrmNormFields = {
  telNorm: string | null;
  waNorm: string | null;
  emailNorm: string | null;
  pivaNorm: string | null;
};

const nullSeVuoto = (s: string): string | null => (s === '' ? null : s);

export function crmNormFields(input: {
  tel?: string | null;
  wa?: string | null;
  email?: string | null;
  piva?: string | null;
}): CrmNormFields {
  return {
    telNorm: nullSeVuoto(normalizeTel(input.tel)),
    waNorm: nullSeVuoto(normalizeTel(input.wa)),
    emailNorm: nullSeVuoto(normalizeEmail(input.email)),
    pivaNorm: nullSeVuoto(normalizePiva(input.piva)),
  };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/norm-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiorna lo schema Prisma**

In `packages/db/prisma/schema.prisma`, dentro `model CrmContact`, sotto il blocco "Match con Company piattaforma", aggiungi:

```prisma
  // Chiavi normalizzate per il match (fonte: lib/crm/match/norm-fields.ts).
  telNorm   String?
  waNorm    String?
  emailNorm String?
  pivaNorm  String?

  // Sede specifica che ha fatto match (null = azienda madre).
  sedeId    String?   @db.Uuid
  sede      Sede?     @relation("CrmContactSede", fields: [sedeId], references: [id], onDelete: SetNull)
  matchVia  String? // campi che hanno prodotto l'aggancio, es. "tel+indirizzo"
  matchedAt DateTime?
```

e nel blocco degli `@@index` dello stesso model:

```prisma
  @@index([telNorm])
  @@index([waNorm])
  @@index([emailNorm])
  @@index([pivaNorm])
  @@index([sedeId])
```

In `model Sede`, accanto alle altre relazioni (dopo `segnalazioniCreazione`):

```prisma
  crmContactMatches     CrmContact[]              @relation("CrmContactSede")
```

- [ ] **Step 6: Scrivi la migration a mano**

Crea `packages/db/prisma/migrations/20260727150000_crm_match_normalizzato/migration.sql`:

```sql
-- Riconciliazione CRM ↔ aziende registrate (spec 2026-07-27).
--
-- Il match per telefono non poteva scattare: si confrontava il numero
-- normalizzato della Company con `crm_contacts.tel` grezzo ("+39 02 447 8712").
-- Da qui in avanti le chiavi di confronto sono colonne indicizzate, scritte
-- dall'helper unico lib/crm/match/norm-fields.ts.
--
-- ⚠️ MIGRATION DI SOLA ESPANSIONE, colonne NULLABLE: va lanciata PRIMA del
-- deploy del codice nuovo ed è compatibile con quello vecchio, che le ignora.
ALTER TABLE "crm_contacts" ADD COLUMN "telNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "waNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "emailNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "pivaNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "sedeId" UUID;
ALTER TABLE "crm_contacts" ADD COLUMN "matchVia" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "matchedAt" TIMESTAMP(3);

CREATE INDEX "crm_contacts_telNorm_idx" ON "crm_contacts"("telNorm");
CREATE INDEX "crm_contacts_waNorm_idx" ON "crm_contacts"("waNorm");
CREATE INDEX "crm_contacts_emailNorm_idx" ON "crm_contacts"("emailNorm");
CREATE INDEX "crm_contacts_pivaNorm_idx" ON "crm_contacts"("pivaNorm");
CREATE INDEX "crm_contacts_sedeId_idx" ON "crm_contacts"("sedeId");

ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_sedeId_fkey"
  FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: stessa logica di normalizeTel/normalizeEmail/normalizePiva.
UPDATE "crm_contacts" SET "telNorm" = CASE
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "waNorm" = CASE
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "telNorm" = NULL WHERE length(COALESCE("telNorm", '')) < 8;
UPDATE "crm_contacts" SET "waNorm" = NULL WHERE length(COALESCE("waNorm", '')) < 8;

UPDATE "crm_contacts" SET "emailNorm" = NULLIF(lower(btrim(COALESCE("email", ''))), '');

UPDATE "crm_contacts" SET "pivaNorm" = regexp_replace(COALESCE("piva", ''), '[^0-9]', '', 'g');
UPDATE "crm_contacts" SET "pivaNorm" = NULL WHERE length(COALESCE("pivaNorm", '')) <> 11;
```

- [ ] **Step 7: Applica la migration in locale e rigenera il client**

Run: `pnpm --filter @pv/db db:deploy && pnpm --filter @pv/db db:generate`
Expected: "1 migration applied" senza prompt distruttivi.

- [ ] **Step 8: Verifica il backfill sul DB reale**

Run:
```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "select count(*) tot, count(\"telNorm\") tel_norm, count(\"emailNorm\") email_norm, count(\"pivaNorm\") piva_norm from crm_contacts where \"deletedAt\" is null;"
```
Expected: `tot` 19103, `tel_norm` ≈ 19084 (le righe `N/D` restano NULL), `email_norm` 244, `piva_norm` 0.

Run:
```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "select nome, tel, \"telNorm\" from crm_contacts where \"telNorm\" = '024478712';"
```
Expected: compare `Agenzia Corsico Pratiche Auto` — è la riga che dovrà agganciarsi.

- [ ] **Step 9: Aggancia l'helper ai write path**

In `apps/piattaforma/src/app/admin/crm/contatti/actions.ts`:

import in cima (accanto agli altri `@/lib/crm/...`):

```ts
import { crmNormFields } from '@/lib/crm/match/norm-fields';
```

in `dataFromInput` (~riga 129), dentro l'oggetto ritornato, subito dopo `piva: emptyToNull(d.piva),`:

```ts
    ...crmNormFields({ tel: d.tel, wa: d.wa, email: d.email, piva: d.piva }),
```

in `bulkImportCrmContactsAction` (~riga 398), dentro `data:` della create, dopo `regione: row.regione,`:

```ts
          ...crmNormFields({
            tel: row.tel,
            wa: row.wa,
            email: row.email,
            piva: row.piva,
          }),
```

- [ ] **Step 10: Il dedup smette di caricare tutta la lista**

`createCrmContactAction` carica oggi tutti i contatti (19k righe) per cercare un
duplicato. Con le colonne indicizzate diventa una query. In
`apps/piattaforma/src/app/admin/crm/contatti/actions.ts` sostituisci il blocco
anti-duplicato (~righe 210-230) con:

```ts
  // Anti-duplicato: query indicizzata sulle colonne normalizzate. Niente
  // overwrite: si modifica l'esistente dalla scheda.
  const norm = crmNormFields({ tel: parsed.data.tel, email: parsed.data.email });
  const orDup: Prisma.CrmContactWhereInput[] = [];
  if (norm.emailNorm) orDup.push({ emailNorm: norm.emailNorm });
  if (norm.telNorm) orDup.push({ telNorm: norm.telNorm });
  const dup =
    orDup.length > 0
      ? await prisma.crmContact.findFirst({
          where: { deletedAt: null, OR: orDup },
          select: { id: true },
        })
      : null;
  if (dup) {
    return {
      ok: false,
      error: 'Esiste già un contatto con questa email o questo telefono.',
    };
  }
```

In `bulkImportCrmContactsAction` la lettura unica di tutta la lista resta (per un
CSV è più efficiente di una query per riga), ma legge le colonne già pronte:
sostituisci la `findMany` di ~riga 372 e la costruzione dei Set con

```ts
  const existing = await prisma.crmContact.findMany({
    where: { deletedAt: null },
    select: { emailNorm: true, telNorm: true },
  });
  const emailSet = new Set(
    existing.map((c) => c.emailNorm).filter((e): e is string => !!e),
  );
  const telSet = new Set(
    existing.map((c) => c.telNorm).filter((t): t is string => !!t),
  );
```

e dentro il ciclo usa `const telNorm = normalizeTel(row.tel);` (già presente dopo
il Task 2) e `const emailNorm = normalizeEmail(row.email);` per i confronti con i
due Set — importa `normalizeEmail` da `@/lib/crm/match/normalize` e confronta
`emailNorm` invece di `row.email`.

Run: `pnpm typecheck`
Expected: 0 errori.

- [ ] **Step 11: Test di presidio sul write path**

Aggiungi in coda a `apps/piattaforma/src/lib/crm/match/norm-fields.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('write path CRM', () => {
  it('actions.ts calcola le colonne normalizzate su create e import CSV', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/admin/crm/contatti/actions.ts'),
      'utf8',
    );
    // Due punti di scrittura: dataFromInput (create/update) e il bulk import.
    const occorrenze = src.match(/crmNormFields\(/g) ?? [];
    expect(occorrenze.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 12: Esegui test e typecheck**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm && pnpm typecheck`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/db/prisma apps/piattaforma/src/lib/crm/match apps/piattaforma/src/app/admin/crm/contatti/actions.ts
git commit -m "feat(crm): colonne normalizzate e sedeId su crm_contacts"
```

---

### Task 4: Identità confrontabili (modulo puro)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/identita.ts`
- Test: `apps/piattaforma/src/lib/crm/match/identita.test.ts`

**Interfaces:**
- Consumes: i normalizzatori (Task 1).
- Produces:
  - `type Identita = { companyId: string; sedeId: string|null; cat: 'BROKER'|'AGENZIA'; telKeys: string[]; emailKeys: string[]; pivaKeys: string[]; nomeKeys: string[]; indirizzoKey: string; cittaKey: string; capKey: string; registrataAt: Date }`
  - `type CompanyGrezza` / `type SedeGrezza` (shape della select Prisma)
  - `identitaDaCompany(c: CompanyGrezza): Identita[]`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/match/identita.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { identitaDaCompany, type CompanyGrezza } from './identita';

const MADRE: CompanyGrezza = {
  id: 'c1',
  type: 'AGENZIA',
  ragioneSociale: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
  partitaIva: '06199680155',
  email: 'Info@AgenziaCorsico.it',
  pec: 'agenziacorsico@pec.it',
  telefono: '024478712',
  indirizzo: 'Via Fiume',
  civico: '6',
  citta: 'Corsico',
  cap: '20094',
  createdAt: new Date('2026-01-10T10:00:00Z'),
  sedi: [],
};

describe('identitaDaCompany', () => {
  it('produce una identità per la madre con chiavi normalizzate', () => {
    const [madre, ...resto] = identitaDaCompany(MADRE);
    expect(resto).toHaveLength(0);
    expect(madre).toMatchObject({
      companyId: 'c1',
      sedeId: null,
      cat: 'AGENZIA',
      telKeys: ['024478712'],
      pivaKeys: ['06199680155'],
      indirizzoKey: 'via fiume',
      cittaKey: 'corsico',
      capKey: '20094',
    });
    expect(madre!.emailKeys).toEqual(['info@agenziacorsico.it', 'agenziacorsico@pec.it']);
    expect(madre!.nomeKeys).toEqual(['agenzia corsico di ciavarella antonio']);
  });

  it('mappa DEALER su BROKER', () => {
    const [id] = identitaDaCompany({ ...MADRE, type: 'DEALER' });
    expect(id!.cat).toBe('BROKER');
  });

  it('produce una identità per ogni sede, con la P.IVA della madre', () => {
    const ids = identitaDaCompany({
      ...MADRE,
      sedi: [
        {
          id: 's1',
          type: 'AGENZIA',
          nome: 'Filiale Buccinasco',
          telefono: '+39 02 4408 011',
          email: null,
          indirizzo: 'Via Verdi',
          civico: '5',
          citta: 'Buccinasco',
          cap: '20090',
          createdAt: new Date('2026-02-01T10:00:00Z'),
        },
      ],
    });
    expect(ids).toHaveLength(2);
    const sede = ids.find((i) => i.sedeId === 's1')!;
    expect(sede.telKeys).toEqual(['024408011']);
    expect(sede.pivaKeys).toEqual(['06199680155']);
    // Il punto vendita in lista porta l'insegna della madre: entrambi i nomi.
    expect(sede.nomeKeys).toContain('filiale buccinasco');
    expect(sede.nomeKeys).toContain('agenzia corsico di ciavarella antonio');
    expect(sede.registrataAt).toEqual(new Date('2026-02-01T10:00:00Z'));
  });

  it('non produce chiavi vuote', () => {
    const [id] = identitaDaCompany({ ...MADRE, telefono: null, partitaIva: '' });
    expect(id!.telKeys).toEqual([]);
    expect(id!.pivaKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/identita.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementa il modulo**

Crea `apps/piattaforma/src/lib/crm/match/identita.ts`:

```ts
/**
 * Da un'azienda registrata alle sue "identità" confrontabili con la lista CRM.
 * Modulo PURO.
 *
 * La lista è fatta di punti vendita: è la SEDE che assomiglia alla riga, non
 * l'azienda madre. Ogni sede è quindi un'identità a sé (spec D3) e può
 * agganciare una riga diversa; il contatto resta comunque legato alla madre
 * via `companyId`, con `sedeId` a dire quale sede ha fatto match.
 */
import {
  normalizeTel,
  normalizeEmail,
  normalizePiva,
  normalizeNome,
  normalizeIndirizzo,
  normalizeCitta,
  normalizeCap,
} from './normalize';

export type CatIdentita = 'BROKER' | 'AGENZIA';

export type SedeGrezza = {
  id: string;
  type: 'DEALER' | 'AGENZIA';
  nome: string;
  telefono: string | null;
  email: string | null;
  indirizzo: string;
  civico: string | null;
  citta: string;
  cap: string;
  createdAt: Date;
};

export type CompanyGrezza = {
  id: string;
  type: 'DEALER' | 'AGENZIA';
  ragioneSociale: string;
  partitaIva: string;
  email: string;
  pec: string;
  telefono: string | null;
  indirizzo: string;
  civico: string | null;
  citta: string;
  cap: string;
  createdAt: Date;
  sedi: SedeGrezza[];
};

export type Identita = {
  companyId: string;
  sedeId: string | null;
  cat: CatIdentita;
  telKeys: string[];
  emailKeys: string[];
  pivaKeys: string[];
  nomeKeys: string[];
  indirizzoKey: string;
  cittaKey: string;
  capKey: string;
  registrataAt: Date;
};

const catDaType = (t: 'DEALER' | 'AGENZIA'): CatIdentita =>
  t === 'AGENZIA' ? 'AGENZIA' : 'BROKER';

/** Toglie i vuoti e i duplicati: una chiave vuota non deve mai fare match. */
const chiavi = (...valori: string[]): string[] =>
  [...new Set(valori.filter((v) => v !== ''))];

export function identitaDaCompany(c: CompanyGrezza): Identita[] {
  const pivaKeys = chiavi(normalizePiva(c.partitaIva));
  const nomeMadre = normalizeNome(c.ragioneSociale);

  const madre: Identita = {
    companyId: c.id,
    sedeId: null,
    cat: catDaType(c.type),
    telKeys: chiavi(normalizeTel(c.telefono)),
    emailKeys: chiavi(normalizeEmail(c.email), normalizeEmail(c.pec)),
    pivaKeys,
    nomeKeys: chiavi(nomeMadre),
    indirizzoKey: normalizeIndirizzo(c.indirizzo),
    cittaKey: normalizeCitta(c.citta),
    capKey: normalizeCap(c.cap),
    registrataAt: c.createdAt,
  };

  const sedi = c.sedi.map(
    (s): Identita => ({
      companyId: c.id,
      sedeId: s.id,
      cat: catDaType(s.type),
      telKeys: chiavi(normalizeTel(s.telefono)),
      emailKeys: chiavi(normalizeEmail(s.email)),
      pivaKeys,
      // Il punto vendita in lista può portare l'insegna della madre.
      nomeKeys: chiavi(normalizeNome(s.nome), nomeMadre),
      indirizzoKey: normalizeIndirizzo(s.indirizzo),
      cittaKey: normalizeCitta(s.citta),
      capKey: normalizeCap(s.cap),
      registrataAt: s.createdAt,
    }),
  );

  return [madre, ...sedi];
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/identita.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/identita.ts apps/piattaforma/src/lib/crm/match/identita.test.ts
git commit -m "feat(crm): identità confrontabili da azienda e sedi"
```

---

### Task 5: Ammissione e punteggio (modulo puro)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/score.ts`
- Test: `apps/piattaforma/src/lib/crm/match/score.test.ts`

**Interfaces:**
- Consumes: `Identita` (Task 4), normalizzatori (Task 1).
- Produces:
  - `type ContattoGrezzo = { id: string; cat: 'BROKER'|'AGENZIA'; nome: string; tel: string|null; indirizzo: string|null; citta: string|null; cap: string|null; telNorm: string|null; waNorm: string|null; emailNorm: string|null; pivaNorm: string|null; createdAt: Date }`
  - `type ContattoPerMatch` (grezzo + chiavi già normalizzate)
  - `preparaContatto(r: ContattoGrezzo): ContattoPerMatch`
  - `valuta(id: Identita, c: ContattoPerMatch): { ammesso: boolean; punteggio: number; campi: string[] }`
  - `PESI`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/match/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { identitaDaCompany, type CompanyGrezza } from './identita';
import { preparaContatto, valuta, type ContattoGrezzo } from './score';

const AGENZIA: CompanyGrezza = {
  id: 'c1',
  type: 'AGENZIA',
  ragioneSociale: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
  partitaIva: '06199680155',
  email: 'info@agenziacorsico.it',
  pec: 'agenziacorsico@pec.it',
  telefono: '024478712',
  indirizzo: 'Via Fiume',
  civico: '6',
  citta: 'Corsico',
  cap: '20094',
  createdAt: new Date('2026-01-10T10:00:00Z'),
  sedi: [],
};

const contatto = (over: Partial<ContattoGrezzo> = {}) =>
  preparaContatto({
    id: 'x1',
    cat: 'AGENZIA',
    nome: 'Agenzia Corsico Pratiche Auto',
    tel: '+39 02 447 8712',
    indirizzo: 'Via Fiume 6',
    citta: 'Corsico',
    cap: '20094',
    telNorm: '024478712',
    waNorm: null,
    emailNorm: null,
    pivaNorm: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  });

const identita = () => identitaDaCompany(AGENZIA)[0]!;

describe('valuta', () => {
  it('caso reale Corsico: telefono + indirizzo + città + CAP', () => {
    const v = valuta(identita(), contatto());
    expect(v.ammesso).toBe(true);
    expect(v.campi).toEqual(expect.arrayContaining(['tel', 'indirizzo', 'citta', 'cap']));
    expect(v.punteggio).toBe(80); // 50 tel + 20 indirizzo + 5 citta + 5 cap
  });

  it('la sola prova forte basta se la categoria coincide', () => {
    const v = valuta(
      identita(),
      contatto({ indirizzo: 'Via Altra', citta: 'Milano', cap: '20100', nome: 'Altro Nome' }),
    );
    expect(v.ammesso).toBe(true);
    expect(v.campi).toEqual(['tel']);
  });

  it('nessuna prova forte: mai ammesso, per quanti campi deboli combacino', () => {
    const v = valuta(identita(), contatto({ telNorm: null, tel: null }));
    expect(v.ammesso).toBe(false);
    expect(v.campi).not.toContain('tel');
  });

  it('categoria discorde: la prova forte da sola non basta', () => {
    const soloTel = contatto({
      cat: 'BROKER',
      indirizzo: 'Via Altra',
      citta: 'Milano',
      cap: '20100',
      nome: 'Altro Nome',
    });
    expect(valuta(identita(), soloTel).ammesso).toBe(false);
    // con un secondo indizio passa
    expect(valuta(identita(), contatto({ cat: 'BROKER' })).ammesso).toBe(true);
  });

  it('P.IVA pesa più di tutto', () => {
    const v = valuta(
      identita(),
      contatto({
        pivaNorm: '06199680155',
        telNorm: null,
        tel: null,
        indirizzo: null,
        citta: null,
        cap: null,
        nome: 'Sconosciuta',
      }),
    );
    expect(v.punteggio).toBe(100);
    expect(v.ammesso).toBe(true);
  });

  it('nome identico vale più del nome contenuto', () => {
    const esatto = valuta(
      identita(),
      contatto({ nome: 'Agenzia Corsico di Ciavarella Antonio S.r.l.' }),
    );
    expect(esatto.campi).toContain('nome');
    const parziale = valuta(identita(), contatto({ nome: 'Agenzia Corsico' }));
    expect(parziale.campi).toContain('nome~');
  });

  it('campi vuoti da entrambe le parti non contano come uguali', () => {
    const senzaDeboli = valuta(
      identita(),
      contatto({ indirizzo: null, citta: null, cap: null, nome: '' }),
    );
    expect(senzaDeboli.campi).toEqual(['tel']);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/score.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementa il modulo**

Crea `apps/piattaforma/src/lib/crm/match/score.ts`:

```ts
/**
 * Ammissione e punteggio di una coppia (identità registrata, contatto CRM).
 * Modulo PURO.
 *
 * Regola (spec D1): serve almeno una PROVA FORTE — P.IVA, email/PEC,
 * telefono/WhatsApp. Nome, indirizzo, città e CAP non bastano mai da soli:
 * mezza Trento condivide città e CAP.
 *
 * Eccezione categoria: se la riga è BROKER e l'azienda è AGENZIA (o viceversa)
 * la prova forte da sola non basta — serve un secondo campo in comune. È la
 * protezione contro i centralini di gruppo condivisi da attività diverse.
 *
 * Il punteggio serve solo a ordinare le proposte: "più campi uguali vince".
 */
import type { Identita } from './identita';
import {
  normalizeNome,
  normalizeIndirizzo,
  normalizeCitta,
  normalizeCap,
} from './normalize';

export const PESI = {
  piva: 100,
  email: 60,
  tel: 50,
  nome: 25,
  indirizzo: 20,
  nomeParziale: 15,
  cap: 5,
  citta: 5,
} as const;

export type ContattoGrezzo = {
  id: string;
  cat: 'BROKER' | 'AGENZIA';
  nome: string;
  tel: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  telNorm: string | null;
  waNorm: string | null;
  emailNorm: string | null;
  pivaNorm: string | null;
  createdAt: Date;
};

export type ContattoPerMatch = {
  id: string;
  cat: 'BROKER' | 'AGENZIA';
  createdAt: Date;
  /** Grezzi, per la UI dell'anteprima. */
  nome: string;
  tel: string | null;
  citta: string | null;
  /** Chiavi, calcolate una volta sola. */
  telKeys: string[];
  emailKeys: string[];
  pivaKeys: string[];
  nomeKey: string;
  indirizzoKey: string;
  cittaKey: string;
  capKey: string;
};

const chiavi = (...valori: Array<string | null>): string[] =>
  [...new Set(valori.filter((v): v is string => !!v && v !== ''))];

/**
 * Normalizza una volta sola i campi deboli del contatto: `valuta` viene
 * chiamata migliaia di volte e non deve rifare il lavoro a ogni giro.
 */
export function preparaContatto(r: ContattoGrezzo): ContattoPerMatch {
  return {
    id: r.id,
    cat: r.cat,
    createdAt: r.createdAt,
    nome: r.nome,
    tel: r.tel,
    citta: r.citta,
    telKeys: chiavi(r.telNorm, r.waNorm),
    emailKeys: chiavi(r.emailNorm),
    pivaKeys: chiavi(r.pivaNorm),
    nomeKey: normalizeNome(r.nome),
    indirizzoKey: normalizeIndirizzo(r.indirizzo),
    cittaKey: normalizeCitta(r.citta),
    capKey: normalizeCap(r.cap),
  };
}

export type Valutazione = {
  ammesso: boolean;
  punteggio: number;
  campi: string[];
};

const intersecano = (a: string[], b: string[]): boolean =>
  a.some((x) => x !== '' && b.includes(x));

const ugualiNonVuote = (a: string, b: string): boolean => a !== '' && a === b;

/** `contenuto` compare per parole intere dentro `contenitore` (min. 2 parole). */
function contieneParole(contenitore: string, contenuto: string): boolean {
  if (contenitore === '' || contenuto === '') return false;
  if (contenuto.split(' ').length < 2) return false;
  return ` ${contenitore} `.includes(` ${contenuto} `);
}

export function valuta(id: Identita, c: ContattoPerMatch): Valutazione {
  const campi: string[] = [];
  let punteggio = 0;

  if (intersecano(id.pivaKeys, c.pivaKeys)) {
    campi.push('piva');
    punteggio += PESI.piva;
  }
  if (intersecano(id.emailKeys, c.emailKeys)) {
    campi.push('email');
    punteggio += PESI.email;
  }
  if (intersecano(id.telKeys, c.telKeys)) {
    campi.push('tel');
    punteggio += PESI.tel;
  }
  if (id.nomeKeys.some((n) => ugualiNonVuote(n, c.nomeKey))) {
    campi.push('nome');
    punteggio += PESI.nome;
  } else if (
    id.nomeKeys.some(
      (n) => contieneParole(n, c.nomeKey) || contieneParole(c.nomeKey, n),
    )
  ) {
    campi.push('nome~');
    punteggio += PESI.nomeParziale;
  }
  if (ugualiNonVuote(id.indirizzoKey, c.indirizzoKey)) {
    campi.push('indirizzo');
    punteggio += PESI.indirizzo;
  }
  if (ugualiNonVuote(id.capKey, c.capKey)) {
    campi.push('cap');
    punteggio += PESI.cap;
  }
  if (ugualiNonVuote(id.cittaKey, c.cittaKey)) {
    campi.push('citta');
    punteggio += PESI.citta;
  }

  const forte = campi.some((k) => k === 'piva' || k === 'email' || k === 'tel');
  const catCoerente = id.cat === c.cat;
  const ammesso = forte && (catCoerente || campi.length >= 2);

  return { ammesso, punteggio, campi };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/score.ts apps/piattaforma/src/lib/crm/match/score.test.ts
git commit -m "feat(crm): ammissione e punteggio del match CRM"
```

---

### Task 6: Assegnazione senza conflitti (modulo puro)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/assign.ts`
- Test: `apps/piattaforma/src/lib/crm/match/assign.test.ts`

**Interfaces:**
- Consumes: `Identita` (Task 4), `ContattoPerMatch` + `valuta` (Task 5).
- Produces:
  - `type Coppia = { identita: Identita; contatto: ContattoPerMatch; punteggio: number; campi: string[] }`
  - `assegna(identita: Identita[], contatti: ContattoPerMatch[]): Coppia[]`
  - `chiaveIdentita(i: Identita): string` — formato `"<companyId>:<sedeId|madre>"`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/match/assign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assegna, chiaveIdentita } from './assign';
import type { Identita } from './identita';
import { preparaContatto, type ContattoGrezzo } from './score';

const ident = (over: Partial<Identita> = {}): Identita => ({
  companyId: 'c1',
  sedeId: null,
  cat: 'BROKER',
  telKeys: ['024478712'],
  emailKeys: [],
  pivaKeys: [],
  nomeKeys: ['auto rossi'],
  indirizzoKey: 'via fiume',
  cittaKey: 'corsico',
  capKey: '20094',
  registrataAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const cont = (over: Partial<ContattoGrezzo> = {}) =>
  preparaContatto({
    id: 'x1',
    cat: 'BROKER',
    nome: 'Auto Rossi',
    tel: '+39 02 447 8712',
    indirizzo: 'Via Fiume 6',
    citta: 'Corsico',
    cap: '20094',
    telNorm: '024478712',
    waNorm: null,
    emailNorm: null,
    pivaNorm: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  });

describe('assegna', () => {
  it('una identità prende solo il contatto col punteggio più alto', () => {
    const scarso = cont({ id: 'x2', nome: 'Altro', indirizzo: null, citta: null, cap: null });
    const ricco = cont({ id: 'x1' });
    const out = assegna([ident()], [scarso, ricco]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('x1');
  });

  it('a parità di punteggio vince il contatto più vecchio', () => {
    const vecchio = cont({ id: 'vecchio', createdAt: new Date('2026-01-01T00:00:00Z') });
    const nuovo = cont({ id: 'nuovo', createdAt: new Date('2026-06-01T00:00:00Z') });
    const out = assegna([ident()], [nuovo, vecchio]);
    expect(out[0]!.contatto.id).toBe('vecchio');
  });

  it('un contatto conteso da due identità va a una sola', () => {
    const a = ident({ companyId: 'c1' });
    const b = ident({ companyId: 'c2', cittaKey: 'milano', capKey: '20100' });
    const out = assegna([a, b], [cont()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.identita.companyId).toBe('c1'); // più campi in comune
  });

  it('madre e sedi agganciano righe diverse', () => {
    const madre = ident({ sedeId: null });
    const sede = ident({
      sedeId: 's1',
      telKeys: ['0244073411'],
      indirizzoKey: 'viale italia',
      nomeKeys: ['autotorino'],
    });
    const rigaMadre = cont({ id: 'm' });
    const rigaSede = cont({
      id: 's',
      nome: 'Autotorino',
      tel: '+39 02 4407 3411',
      telNorm: '0244073411',
      indirizzo: 'Viale Italia 19',
    });
    const out = assegna([madre, sede], [rigaMadre, rigaSede]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.identita.sedeId).sort()).toEqual([null, 's1']);
  });

  it('scarta le coppie non ammesse', () => {
    const out = assegna([ident()], [cont({ telNorm: null, tel: null })]);
    expect(out).toEqual([]);
  });

  it('chiaveIdentita distingue madre e sede', () => {
    expect(chiaveIdentita(ident())).toBe('c1:madre');
    expect(chiaveIdentita(ident({ sedeId: 's1' }))).toBe('c1:s1');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/assign.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementa il modulo**

Crea `apps/piattaforma/src/lib/crm/match/assign.ts`:

```ts
/**
 * Assegnazione greedy senza conflitti fra identità registrate e righe CRM.
 * Modulo PURO.
 *
 * Un contatto va a una sola identità e un'identità prende un solo contatto
 * (spec D2): sui 19k della lista il 30% condivide il telefono con un'altra
 * riga, quindi la concorrenza è la norma, non l'eccezione.
 *
 * L'ordine è deterministico — punteggio desc, poi contatto più vecchio, poi id
 * — così due esecuzioni sulla stessa fotografia del DB danno lo stesso esito.
 *
 * Costo: i candidati si prendono da un indice sulle chiavi forti, non dal
 * prodotto cartesiano (19k contatti × N identità sarebbe insostenibile).
 */
import type { Identita } from './identita';
import { valuta, type ContattoPerMatch } from './score';

export type Coppia = {
  identita: Identita;
  contatto: ContattoPerMatch;
  punteggio: number;
  campi: string[];
};

export function chiaveIdentita(i: Identita): string {
  return `${i.companyId}:${i.sedeId ?? 'madre'}`;
}

function indicizza(
  contatti: ContattoPerMatch[],
  chiaviDi: (c: ContattoPerMatch) => string[],
): Map<string, ContattoPerMatch[]> {
  const m = new Map<string, ContattoPerMatch[]>();
  for (const c of contatti) {
    for (const k of chiaviDi(c)) {
      const arr = m.get(k);
      if (arr) arr.push(c);
      else m.set(k, [c]);
    }
  }
  return m;
}

export function assegna(
  identita: Identita[],
  contatti: ContattoPerMatch[],
): Coppia[] {
  const perTel = indicizza(contatti, (c) => c.telKeys);
  const perEmail = indicizza(contatti, (c) => c.emailKeys);
  const perPiva = indicizza(contatti, (c) => c.pivaKeys);

  const coppie: Coppia[] = [];
  for (const id of identita) {
    const candidati = new Map<string, ContattoPerMatch>();
    const raccogli = (mappa: Map<string, ContattoPerMatch[]>, keys: string[]) => {
      for (const k of keys) {
        for (const c of mappa.get(k) ?? []) candidati.set(c.id, c);
      }
    };
    raccogli(perTel, id.telKeys);
    raccogli(perEmail, id.emailKeys);
    raccogli(perPiva, id.pivaKeys);

    for (const c of candidati.values()) {
      const v = valuta(id, c);
      if (v.ammesso) {
        coppie.push({ identita: id, contatto: c, punteggio: v.punteggio, campi: v.campi });
      }
    }
  }

  coppie.sort(
    (a, b) =>
      b.punteggio - a.punteggio ||
      a.contatto.createdAt.getTime() - b.contatto.createdAt.getTime() ||
      a.contatto.id.localeCompare(b.contatto.id) ||
      chiaveIdentita(a.identita).localeCompare(chiaveIdentita(b.identita)),
  );

  const contattiPresi = new Set<string>();
  const identitaPrese = new Set<string>();
  const scelte: Coppia[] = [];
  for (const co of coppie) {
    const ik = chiaveIdentita(co.identita);
    if (contattiPresi.has(co.contatto.id) || identitaPrese.has(ik)) continue;
    contattiPresi.add(co.contatto.id);
    identitaPrese.add(ik);
    scelte.push(co);
  }
  return scelte;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/assign.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/assign.ts apps/piattaforma/src/lib/crm/match/assign.test.ts
git commit -m "feat(crm): assegnazione greedy senza conflitti"
```

---

### Task 7: Motore dry-run (server)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/engine.ts`
- Test: `apps/piattaforma/src/lib/crm/match/engine.test.ts`

**Interfaces:**
- Consumes: `identitaDaCompany` (Task 4), `preparaContatto` (Task 5), `assegna`/`chiaveIdentita` (Task 6), colonne normalizzate (Task 3).
- Produces:
  - `type Proposta = { contactId: string; contactNome: string; contactTel: string|null; contactCitta: string|null; companyId: string; companyNome: string; sedeId: string|null; sedeNome: string|null; cat: 'BROKER'|'AGENZIA'; punteggio: number; campi: string[] }`
  - `calcolaProposte(opts?: { companyId?: string }): Promise<Proposta[]>`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/match/engine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const companyFindMany = vi.fn();
const contactFindMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    crmContact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
  },
}));

import { calcolaProposte } from './engine';

const COMPANY = {
  id: 'c1',
  type: 'AGENZIA',
  ragioneSociale: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
  partitaIva: '06199680155',
  email: 'info@agenziacorsico.it',
  pec: 'agenziacorsico@pec.it',
  telefono: '024478712',
  indirizzo: 'Via Fiume',
  civico: '6',
  citta: 'Corsico',
  cap: '20094',
  createdAt: new Date('2026-01-10T00:00:00Z'),
  sedi: [],
};

const CONTATTO = {
  id: 'x1',
  cat: 'AGENZIA',
  nome: 'Agenzia Corsico Pratiche Auto',
  tel: '+39 02 447 8712',
  indirizzo: 'Via Fiume 6',
  citta: 'Corsico',
  cap: '20094',
  telNorm: '024478712',
  waNorm: null,
  emailNorm: null,
  pivaNorm: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
};

/** Prima findMany su crmContact = identità già coperte, seconda = candidati. */
function mockDb(opts: { coperte?: Array<{ companyId: string; sedeId: string | null }>; contatti?: unknown[] }) {
  companyFindMany.mockResolvedValue([COMPANY]);
  contactFindMany
    .mockResolvedValueOnce(opts.coperte ?? [])
    .mockResolvedValueOnce(opts.contatti ?? [CONTATTO]);
}

describe('calcolaProposte', () => {
  beforeEach(() => {
    companyFindMany.mockReset();
    contactFindMany.mockReset();
  });

  it('propone il match reale Corsico con i campi della prova', async () => {
    mockDb({});
    const proposte = await calcolaProposte();
    expect(proposte).toHaveLength(1);
    expect(proposte[0]).toMatchObject({
      contactId: 'x1',
      companyId: 'c1',
      sedeId: null,
      companyNome: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
      cat: 'AGENZIA',
      punteggio: 80,
    });
    expect(proposte[0]!.campi).toContain('tel');
  });

  it('salta le identità già agganciate', async () => {
    mockDb({ coperte: [{ companyId: 'c1', sedeId: null }] });
    expect(await calcolaProposte()).toEqual([]);
    // niente seconda query: senza identità libere non si caricano i candidati
    expect(contactFindMany).toHaveBeenCalledTimes(1);
  });

  it('filtra su una sola azienda quando arriva companyId', async () => {
    mockDb({});
    await calcolaProposte({ companyId: 'c1' });
    expect(companyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'c1' }) }),
    );
  });

  it('nessuna azienda registrata → nessuna query sui contatti', async () => {
    companyFindMany.mockResolvedValue([]);
    expect(await calcolaProposte()).toEqual([]);
    expect(contactFindMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/engine.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementa il motore**

Crea `apps/piattaforma/src/lib/crm/match/engine.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { identitaDaCompany, type CompanyGrezza } from './identita';
import { preparaContatto } from './score';
import { assegna, chiaveIdentita } from './assign';

/**
 * Calcolo delle proposte di aggancio (DRY-RUN: non scrive nulla).
 *
 * Tre letture: le aziende con le loro sedi, le identità già coperte (per non
 * riassegnare ciò che è già agganciato → idempotenza) e i contatti candidati,
 * cioè i lead liberi con almeno una chiave forte valorizzata.
 */

export type Proposta = {
  contactId: string;
  contactNome: string;
  contactTel: string | null;
  contactCitta: string | null;
  companyId: string;
  companyNome: string;
  sedeId: string | null;
  sedeNome: string | null;
  cat: 'BROKER' | 'AGENZIA';
  punteggio: number;
  campi: string[];
};

const SELECT_COMPANY = {
  id: true,
  type: true,
  ragioneSociale: true,
  partitaIva: true,
  email: true,
  pec: true,
  telefono: true,
  indirizzo: true,
  civico: true,
  citta: true,
  cap: true,
  createdAt: true,
  sedi: {
    where: { deletedAt: null },
    select: {
      id: true,
      type: true,
      nome: true,
      telefono: true,
      email: true,
      indirizzo: true,
      civico: true,
      citta: true,
      cap: true,
      createdAt: true,
    },
  },
} as const;

export async function calcolaProposte(
  opts: { companyId?: string } = {},
): Promise<Proposta[]> {
  const companies = (await prisma.company.findMany({
    where: {
      deletedAt: null,
      ...(opts.companyId ? { id: opts.companyId } : {}),
    },
    select: SELECT_COMPANY,
  })) as unknown as CompanyGrezza[];
  if (companies.length === 0) return [];

  const agganciati = await prisma.crmContact.findMany({
    where: { deletedAt: null, companyId: { not: null } },
    select: { companyId: true, sedeId: true },
  });
  const coperte = new Set(
    agganciati.map((a) => `${a.companyId}:${a.sedeId ?? 'madre'}`),
  );

  const identita = companies
    .flatMap(identitaDaCompany)
    .filter((i) => !coperte.has(chiaveIdentita(i)));
  if (identita.length === 0) return [];

  const grezzi = await prisma.crmContact.findMany({
    where: {
      deletedAt: null,
      companyId: null,
      OR: [
        { telNorm: { not: null } },
        { waNorm: { not: null } },
        { emailNorm: { not: null } },
        { pivaNorm: { not: null } },
      ],
    },
    select: {
      id: true,
      cat: true,
      nome: true,
      tel: true,
      indirizzo: true,
      citta: true,
      cap: true,
      telNorm: true,
      waNorm: true,
      emailNorm: true,
      pivaNorm: true,
      createdAt: true,
    },
  });
  if (grezzi.length === 0) return [];

  const contatti = grezzi.map(preparaContatto);
  const coppie = assegna(identita, contatti);

  const nomeCompany = new Map(companies.map((c) => [c.id, c.ragioneSociale]));
  const nomeSede = new Map(
    companies.flatMap((c) => c.sedi.map((s) => [s.id, s.nome] as const)),
  );

  return coppie.map((co) => ({
    contactId: co.contatto.id,
    contactNome: co.contatto.nome,
    contactTel: co.contatto.tel,
    contactCitta: co.contatto.citta,
    companyId: co.identita.companyId,
    companyNome: nomeCompany.get(co.identita.companyId) ?? '—',
    sedeId: co.identita.sedeId,
    sedeNome: co.identita.sedeId ? (nomeSede.get(co.identita.sedeId) ?? null) : null,
    cat: co.identita.cat,
    punteggio: co.punteggio,
    campi: co.campi,
  }));
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Prova sul DB reale (script temporaneo, non committato)**

Crea `apps/piattaforma/scripts/dryrun-riconciliazione.ts` (file di lavoro, cancellato a fine task):

```ts
import { calcolaProposte } from '../src/lib/crm/match/engine';

async function main() {
  const p = await calcolaProposte();
  console.log(`proposte: ${p.length}`);
  for (const x of p.slice(0, 20)) {
    console.log(
      `${x.punteggio}\t[${x.campi.join('+')}]\t${x.contactNome} → ${x.companyNome}${x.sedeNome ? ` (${x.sedeNome})` : ''}`,
    );
  }
}
void main();
```

Run: `cd apps/piattaforma && npx tsx scripts/dryrun-riconciliazione.ts`
Expected: almeno la riga `Agenzia Corsico Pratiche Auto → AGENZIA CORSICO DI CIAVARELLA ANTONIO`. Nessun accoppiamento palesemente assurdo (aziende in province diverse agganciate solo per città).
Poi: `rm apps/piattaforma/scripts/dryrun-riconciliazione.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/engine.ts apps/piattaforma/src/lib/crm/match/engine.test.ts
git commit -m "feat(crm): motore dry-run delle proposte di aggancio"
```

---

### Task 8: Applicazione dell'aggancio e stato allineato (server)

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/apply.ts`
- Test: `apps/piattaforma/src/lib/crm/match/apply.test.ts`

**Interfaces:**
- Consumes: `Proposta` + `calcolaProposte` (Task 7).
- Produces:
  - `statoAllineato(attuale: string, firmate: number): string` (puro, esportato per i test)
  - `applicaProposte(proposte: Proposta[]): Promise<{ agganciati: number; errori: number }>`
  - `riconciliaTutto(): Promise<{ proposte: number; agganciati: number; errori: number }>`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/match/apply.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const companyFindUnique = vi.fn();
const praticaCount = vi.fn();
const praticaFindFirst = vi.fn();
const contactFindUnique = vi.fn();
const contactUpdateMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    pratica: {
      count: (...a: unknown[]) => praticaCount(...a),
      findFirst: (...a: unknown[]) => praticaFindFirst(...a),
    },
    crmContact: {
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
      updateMany: (...a: unknown[]) => contactUpdateMany(...a),
    },
  },
  CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' },
}));
vi.mock('./engine', () => ({ calcolaProposte: vi.fn() }));

import { applicaProposte, statoAllineato } from './apply';

const PROPOSTA = {
  contactId: 'x1',
  contactNome: 'Agenzia Corsico Pratiche Auto',
  contactTel: '+39 02 447 8712',
  contactCitta: 'Corsico',
  companyId: 'c1',
  companyNome: 'AGENZIA CORSICO',
  sedeId: null,
  sedeNome: null,
  cat: 'AGENZIA' as const,
  punteggio: 80,
  campi: ['tel', 'indirizzo'],
};

describe('statoAllineato', () => {
  it('mappa il numero di firmate sul funnel', () => {
    expect(statoAllineato('S0', 0)).toBe('S7');
    expect(statoAllineato('S0', 1)).toBe('S8');
    expect(statoAllineato('S0', 5)).toBe('S9');
  });

  it('non retrocede mai', () => {
    expect(statoAllineato('S9', 0)).toBe('S9');
    expect(statoAllineato('S8', 1)).toBe('S8');
  });

  it('non tocca il churn', () => {
    expect(statoAllineato('S10', 3)).toBe('S10');
  });
});

describe('applicaProposte', () => {
  beforeEach(() => {
    companyFindUnique.mockReset();
    praticaCount.mockReset();
    praticaFindFirst.mockReset();
    contactFindUnique.mockReset();
    contactUpdateMany.mockReset();
    contactFindUnique.mockResolvedValue({ status: 'S0' });
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: null,
      deletedAt: null,
      referenteId: null,
    });
    praticaCount.mockResolvedValue(0);
    praticaFindFirst.mockResolvedValue(null);
    contactUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('scrive aggancio, stato e provenienza del match', async () => {
    const esito = await applicaProposte([PROPOSTA]);
    expect(esito).toEqual({ agganciati: 1, errori: 0 });
    const args = contactUpdateMany.mock.calls[0]![0];
    // compare-and-set: si scrive solo se il contatto è ancora libero
    expect(args.where).toEqual({ id: 'x1', companyId: null });
    expect(args.data).toMatchObject({
      companyId: 'c1',
      sedeId: null,
      status: 'S7',
      iscrizioneComp: true,
      platStatus: 'INATTIVO',
      matchVia: 'tel+indirizzo',
    });
    expect(args.data.iscrizioneAt).toEqual(new Date('2026-01-10T00:00:00Z'));
    expect(args.data.fonte).toBeUndefined(); // storico del lead preservato
  });

  it('conta le pratiche di un AGENZIA su agenziaAssegnataId', async () => {
    await applicaProposte([PROPOSTA]);
    expect(praticaCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agenziaAssegnataId: 'c1', stato: 'FIRMATA' }),
      }),
    );
  });

  it('conta le pratiche di un BROKER su brokerId', async () => {
    await applicaProposte([{ ...PROPOSTA, cat: 'BROKER' }]);
    expect(praticaCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brokerId: 'c1', stato: 'FIRMATA' }),
      }),
    );
  });

  it('azienda già operativa: stato S9, platStatus ATTIVO, prima pratica valorizzata', async () => {
    praticaCount.mockResolvedValue(4);
    praticaFindFirst.mockResolvedValue({ firmaAvvenutaAt: new Date('2026-02-02T00:00:00Z') });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data).toMatchObject({
      status: 'S9',
      platStatus: 'ATTIVO',
      primaPratica: true,
      primaPraticaAt: new Date('2026-02-02T00:00:00Z'),
    });
  });

  it('azienda sospesa → platStatus SOSPESO', async () => {
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: new Date('2026-05-01T00:00:00Z'),
      deletedAt: null,
      referenteId: null,
    });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.platStatus).toBe('SOSPESO');
  });

  it('company arrivata da referral → fonte REFERRAL (comportamento già vivo)', async () => {
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: null,
      deletedAt: null,
      referenteId: 'c9',
    });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.fonte).toBe('REFERRAL');
  });

  it('un contatto già S9 non retrocede a S7', async () => {
    contactFindUnique.mockResolvedValue({ status: 'S9' });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.status).toBe('S9');
  });

  it('contatto già preso da un altro giro: non conta come agganciato', async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    expect(await applicaProposte([PROPOSTA])).toEqual({ agganciati: 0, errori: 0 });
  });

  it('un errore su una proposta non ferma le altre', async () => {
    contactUpdateMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ count: 1 });
    const esito = await applicaProposte([PROPOSTA, { ...PROPOSTA, contactId: 'x2' }]);
    expect(esito).toEqual({ agganciati: 1, errori: 1 });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/apply.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementa l'applicazione**

Crea `apps/piattaforma/src/lib/crm/match/apply.ts`:

```ts
import 'server-only';
import { prisma, CrmFonteAcquisizione, type Prisma } from '@pv/db';
import { calcolaProposte, type Proposta } from './engine';

/**
 * Scrittura degli agganci proposti dal motore.
 *
 * Lo stato non viene messo a S7 e basta: un'azienda che opera da mesi verrebbe
 * mostrata come "iscritto inattivo" (spec D4). Si guarda lo storico reale —
 * quante pratiche ha firmato — e si allinea il funnel, solo in salita.
 */

const ORDINE = [
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
] as const;

/**
 * Stato del contatto dato lo stato attuale e le pratiche firmate dall'azienda.
 * Mai indietro; S10 (churn, decisione umana) non si tocca.
 */
export function statoAllineato(attuale: string, firmate: number): string {
  if (attuale === 'S10') return 'S10';
  const target = firmate === 0 ? 'S7' : firmate === 1 ? 'S8' : 'S9';
  const iAttuale = ORDINE.indexOf(attuale as (typeof ORDINE)[number]);
  const iTarget = ORDINE.indexOf(target as (typeof ORDINE)[number]);
  if (iAttuale === -1) return target;
  return iAttuale > iTarget ? attuale : target;
}

type Storico = {
  registrataAt: Date;
  firmate: number;
  primaPraticaAt: Date | null;
  sospesa: boolean;
  referral: boolean;
};

async function storicoAzienda(
  companyId: string,
  cat: 'BROKER' | 'AGENZIA',
): Promise<Storico | null> {
  // Le pratiche di un'agenzia stanno su agenziaAssegnataId, non su brokerId.
  const wherePratica =
    cat === 'AGENZIA' ? { agenziaAssegnataId: companyId } : { brokerId: companyId };

  const [company, firmate, prima] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        createdAt: true,
        suspendedAt: true,
        deletedAt: true,
        referenteId: true,
      },
    }),
    prisma.pratica.count({
      where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
    }),
    prisma.pratica.findFirst({
      where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
      orderBy: { firmaAvvenutaAt: 'asc' },
      select: { firmaAvvenutaAt: true },
    }),
  ]);
  if (!company) return null;

  return {
    registrataAt: company.createdAt,
    firmate,
    primaPraticaAt: prima?.firmaAvvenutaAt ?? null,
    sospesa: !!company.suspendedAt || !!company.deletedAt,
    referral: !!company.referenteId,
  };
}

export async function applicaProposte(
  proposte: Proposta[],
): Promise<{ agganciati: number; errori: number }> {
  let agganciati = 0;
  let errori = 0;

  for (const p of proposte) {
    try {
      // Lo stato attuale serve per non retrocedere: `updateMany` non lo legge.
      const attuale = await prisma.crmContact.findUnique({
        where: { id: p.contactId },
        select: { status: true },
      });
      if (!attuale) continue;

      const storico = await storicoAzienda(p.companyId, p.cat);
      if (!storico) continue;

      const data: Prisma.CrmContactUncheckedUpdateManyInput = {
        companyId: p.companyId,
        sedeId: p.sedeId,
        matchVia: p.campi.join('+'),
        matchedAt: new Date(),
        iscrizioneComp: true,
        iscrizioneAt: storico.registrataAt,
        status: statoAllineato(
          attuale.status,
          storico.firmate,
        ) as Prisma.CrmContactUncheckedUpdateManyInput['status'],
        platStatus: storico.sospesa
          ? 'SOSPESO'
          : storico.firmate > 0
            ? 'ATTIVO'
            : 'INATTIVO',
        primaPratica: storico.firmate > 0,
        primaPraticaAt: storico.primaPraticaAt,
      };
      // Arricchimento già vivo prima di questo lavoro: se la Company è arrivata
      // da un referral la fonte diventa REFERRAL. Altrimenti `fonte` non si
      // tocca, per non perdere lo storico del lead (es. CSV_INIZIALE).
      if (storico.referral) data.fonte = CrmFonteAcquisizione.REFERRAL;

      // Compare-and-set: si scrive solo se nessun altro giro l'ha già preso.
      const res = await prisma.crmContact.updateMany({
        where: { id: p.contactId, companyId: null },
        data,
      });
      if (res.count > 0) agganciati++;
    } catch {
      errori++;
    }
  }

  return { agganciati, errori };
}

/** Passata completa: calcola e applica. Usata dal cron e dall'azione admin. */
export async function riconciliaTutto(): Promise<{
  proposte: number;
  agganciati: number;
  errori: number;
}> {
  const proposte = await calcolaProposte();
  const esito = await applicaProposte(proposte);
  return { proposte: proposte.length, ...esito };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/match/apply.test.ts`
Expected: PASS, incluso il caso "non retrocede".

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/apply.ts apps/piattaforma/src/lib/crm/match/apply.test.ts
git commit -m "feat(crm): applicazione aggancio con stato allineato allo storico"
```

---

### Task 9: La registrazione usa il motore nuovo

**Files:**
- Modify: `apps/piattaforma/src/lib/crm/sync.ts:29-123` (`MatchResult`, `tryMatchCrmContact`)
- Test: `apps/piattaforma/src/lib/crm/sync-match.test.ts` (nuovo)

**Interfaces:**
- Consumes: `calcolaProposte` (Task 7), `applicaProposte` (Task 8).
- Produces: `tryMatchCrmContact(companyId: string): Promise<MatchResult>` con `MatchResult = { matched: true; contactId: string; via: string } | { matched: false }` (`via` diventa `string`: elenca i campi, non più solo `'email'|'tel'|'piva'`).

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/sync-match.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calcolaProposte = vi.fn();
const applicaProposte = vi.fn();
vi.mock('./match/engine', () => ({ calcolaProposte: (...a: unknown[]) => calcolaProposte(...a) }));
vi.mock('./match/apply', () => ({ applicaProposte: (...a: unknown[]) => applicaProposte(...a) }));
vi.mock('@pv/db', () => ({ prisma: {}, CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' } }));

import { tryMatchCrmContact } from './sync';

const PROPOSTA = {
  contactId: 'x1',
  contactNome: 'Agenzia Corsico Pratiche Auto',
  contactTel: null,
  contactCitta: null,
  companyId: 'c1',
  companyNome: 'AGENZIA CORSICO',
  sedeId: null,
  sedeNome: null,
  cat: 'AGENZIA',
  punteggio: 80,
  campi: ['tel', 'indirizzo'],
};

describe('tryMatchCrmContact', () => {
  beforeEach(() => {
    calcolaProposte.mockReset();
    applicaProposte.mockReset();
  });

  it('cerca solo per quella company e applica', async () => {
    calcolaProposte.mockResolvedValue([PROPOSTA]);
    applicaProposte.mockResolvedValue({ agganciati: 1, errori: 0 });
    const res = await tryMatchCrmContact('c1');
    expect(calcolaProposte).toHaveBeenCalledWith({ companyId: 'c1' });
    expect(res).toEqual({ matched: true, contactId: 'x1', via: 'tel+indirizzo' });
  });

  it('nessuna proposta → matched false, nessuna scrittura', async () => {
    calcolaProposte.mockResolvedValue([]);
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
    expect(applicaProposte).not.toHaveBeenCalled();
  });

  it('proposta non applicata (contatto preso nel frattempo) → matched false', async () => {
    calcolaProposte.mockResolvedValue([PROPOSTA]);
    applicaProposte.mockResolvedValue({ agganciati: 0, errori: 0 });
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
  });

  it('best-effort: un errore non risale alla registrazione', async () => {
    calcolaProposte.mockRejectedValue(new Error('db giù'));
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/sync-match.test.ts`
Expected: FAIL — `tryMatchCrmContact` fa ancora la cascade e non chiama `calcolaProposte`.

- [ ] **Step 3: Riscrivi tryMatchCrmContact**

In `apps/piattaforma/src/lib/crm/sync.ts` sostituisci l'intero blocco da `export type MatchResult` fino alla chiusura di `tryMatchCrmContact` (righe 29-123) con:

```ts
export type MatchResult =
  | { matched: true; contactId: string; via: string }
  | { matched: false };

/**
 * Match alla registrazione: stesse regole della riconciliazione retroattiva,
 * limitate all'azienda appena creata (e alle sue sedi).
 *
 * Best-effort: chiamata dopo la tx di registrazione, non deve mai farla
 * fallire. Prima qui viveva una cascade email → tel → P.IVA che confrontava il
 * telefono normalizzato con `CrmContact.tel` grezzo e quindi non trovava mai
 * nulla; ora la logica è una sola, in lib/crm/match/.
 */
export async function tryMatchCrmContact(
  companyId: string,
): Promise<MatchResult> {
  try {
    const proposte = await calcolaProposte({ companyId });
    if (proposte.length === 0) return { matched: false };
    const esito = await applicaProposte(proposte);
    if (esito.agganciati === 0) return { matched: false };
    const prima = proposte[0]!;
    return { matched: true, contactId: prima.contactId, via: prima.campi.join('+') };
  } catch {
    return { matched: false };
  }
}
```

Aggiorna gli import in cima al file: `isPreIscrizione` e `normalizeTel` non servono più a `tryMatchCrmContact` — verifica con `grep -n "isPreIscrizione\|normalizeTel" apps/piattaforma/src/lib/crm/sync.ts` e togli quelli rimasti senza uso. Aggiungi:

```ts
import { calcolaProposte } from './match/engine';
import { applicaProposte } from './match/apply';
```

Mantieni l'export di compatibilità solo se ancora usato altrove: `grep -rn "from '@/lib/crm/sync'" apps/piattaforma/src`.

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter @pv/piattaforma test`
Expected: suite intera verde. `(auth)/actions.test.ts` mocka già `tryMatchCrmContact`, quindi non risente della riscrittura (le parentesi nel path rompono il filtro da shell: qui si esegue tutto).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errori (il tipo di `via` è cambiato: se qualche chiamante lo confronta con `'email'` il compilatore lo segnala).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/crm/sync.ts apps/piattaforma/src/lib/crm/sync-match.test.ts
git commit -m "feat(crm): la registrazione usa il motore di match unico"
```

---

### Task 10: Cron — riconciliazione automatica e aggregati per le agenzie

**Files:**
- Modify: `apps/piattaforma/src/lib/crm/sync.ts` (`syncCrmFromPlatform`, ~righe 173-243)
- Modify: `apps/piattaforma/src/app/api/jobs/crm-sync/route.ts`
- Test: `apps/piattaforma/src/lib/crm/sync-aggregati.test.ts` (nuovo)

**Interfaces:**
- Consumes: `riconciliaTutto` (Task 8).
- Produces: `syncCrmFromPlatform()` invariata nella firma (`{ scanned, updated }`), ma conta le pratiche in base al tipo di azienda; la route ritorna anche `riconciliazione`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/crm/sync-aggregati.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactFindMany = vi.fn();
const contactUpdate = vi.fn();
const companyFindUnique = vi.fn();
const praticaCount = vi.fn();
const userFindFirst = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    crmContact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    pratica: { count: (...a: unknown[]) => praticaCount(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
  },
  CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' },
}));
vi.mock('./match/engine', () => ({ calcolaProposte: vi.fn() }));
vi.mock('./match/apply', () => ({ applicaProposte: vi.fn() }));

import { syncCrmFromPlatform } from './sync';

describe('syncCrmFromPlatform', () => {
  beforeEach(() => {
    contactFindMany.mockReset();
    contactUpdate.mockReset();
    companyFindUnique.mockReset();
    praticaCount.mockReset();
    userFindFirst.mockReset();
    contactFindMany.mockResolvedValue([{ id: 'k1', companyId: 'c1' }]);
    contactUpdate.mockResolvedValue({});
    praticaCount.mockResolvedValue(0);
    userFindFirst.mockResolvedValue(null);
  });

  it("conta le pratiche di un'agenzia su agenziaAssegnataId", async () => {
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA',
      suspendedAt: null,
      deletedAt: null,
    });
    await syncCrmFromPlatform();
    for (const call of praticaCount.mock.calls) {
      expect(call[0].where).toHaveProperty('agenziaAssegnataId', 'c1');
    }
  });

  it('conta le pratiche di un broker su brokerId', async () => {
    companyFindUnique.mockResolvedValue({
      type: 'DEALER',
      suspendedAt: null,
      deletedAt: null,
    });
    await syncCrmFromPlatform();
    for (const call of praticaCount.mock.calls) {
      expect(call[0].where).toHaveProperty('brokerId', 'c1');
    }
  });

  it('agenzia con pratiche firmate → platStatus ATTIVO', async () => {
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA',
      suspendedAt: null,
      deletedAt: null,
    });
    praticaCount.mockResolvedValue(3);
    await syncCrmFromPlatform();
    expect(contactUpdate.mock.calls[0]![0].data).toMatchObject({
      platStatus: 'ATTIVO',
      praticheTotal: 3,
    });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/sync-aggregati.test.ts`
Expected: FAIL sul caso agenzia — oggi tutte le count usano `brokerId`.

- [ ] **Step 3: Correggi gli aggregati**

In `apps/piattaforma/src/lib/crm/sync.ts`, dentro `syncCrmFromPlatform`, sostituisci il blocco `Promise.all` con una lettura preliminare della company e un `where` dipendente dal tipo:

```ts
    const company = await prisma.company.findUnique({
      where: { id: c.companyId },
      select: { type: true, suspendedAt: true, deletedAt: true },
    });
    if (!company) continue;

    // Le pratiche di un'agenzia stanno su agenziaAssegnataId: contarle su
    // brokerId lasciava ogni agenzia agganciata a 0 pratiche e INATTIVO.
    const wherePratica =
      company.type === 'AGENZIA'
        ? { agenziaAssegnataId: c.companyId }
        : { brokerId: c.companyId };

    const [totalAgg, monthAgg, firmateAgg, lastUser] = await Promise.all([
      prisma.pratica.count({ where: { ...wherePratica, deletedAt: null } }),
      prisma.pratica.count({
        where: { ...wherePratica, deletedAt: null, createdAt: { gte: startOfMonth } },
      }),
      prisma.pratica.count({
        where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
      }),
      prisma.user.findFirst({
        where: { companyId: c.companyId, deletedAt: null },
        orderBy: { lastLoginAt: 'desc' },
        select: { lastLoginAt: true },
      }),
    ]);
```

Il resto della funzione (calcolo `tassoComp`, `platStatus`, update) resta identico; togli il vecchio `if (!company) continue;` rimasto più in basso.

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm/sync-aggregati.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungi la passata di riconciliazione al cron**

`apps/piattaforma/src/app/api/jobs/crm-sync/route.ts` diventa:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { syncCrmFromPlatform } from '@/lib/crm/sync';
import { riconciliaTutto } from '@/lib/crm/match/apply';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Sync CRM ↔ piattaforma. Schedule cron Vercel: 1x/giorno (vercel.json).
 * Auth: bearer CRON_SECRET (Vercel Cron) OR sessione ADMIN_PIATTAFORMA.
 *
 * Due passate: prima si agganciano le righe della lista alle aziende
 * registrate (idempotente: chi è già agganciato non viene rivisto), poi si
 * aggiornano gli aggregati dei contatti agganciati.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const riconciliazione = await riconciliaTutto();
  const result = await syncCrmFromPlatform();
  return NextResponse.json({ ok: true, riconciliazione, ...result });
}

export const GET = run;
export const POST = run;
```

- [ ] **Step 6: Esegui suite CRM e typecheck**

Run: `pnpm --filter @pv/piattaforma test src/lib/crm && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/crm/sync.ts apps/piattaforma/src/lib/crm/sync-aggregati.test.ts apps/piattaforma/src/app/api/jobs/crm-sync/route.ts
git commit -m "fix(crm): aggregati per le agenzie e riconciliazione nel cron"
```

---

### Task 11: Pagina admin di riconciliazione

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/permissions.ts` (dopo `canViewCrmPermissions`, ~riga 117)
- Create: `apps/piattaforma/src/app/admin/crm/riconciliazione/page.tsx`
- Create: `apps/piattaforma/src/app/admin/crm/riconciliazione/client.tsx`
- Create: `apps/piattaforma/src/app/admin/crm/riconciliazione/actions.ts`
- Modify: `apps/piattaforma/src/components/admin/admin-shell.tsx` (gruppo `CRM` in `NAV_GROUPS`, ~riga 104)
- Test: `apps/piattaforma/src/app/admin/crm/riconciliazione/actions.test.ts`

**Interfaces:**
- Consumes: `calcolaProposte` (Task 7), `riconciliaTutto` (Task 8).
- Produces: `canRunCrmReconciliation(role: string|undefined): boolean`; server action `applicaRiconciliazioneAction(): Promise<{ ok: true; agganciati: number; errori: number } | { ok: false; error: string }>`.

- [ ] **Step 1: Scrivi il test dell'azione**

Crea `apps/piattaforma/src/app/admin/crm/riconciliazione/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = vi.fn();
const riconciliaTutto = vi.fn();
vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/crm/match/apply', () => ({
  riconciliaTutto: (...a: unknown[]) => riconciliaTutto(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT');
  },
}));

import { applicaRiconciliazioneAction } from './actions';

describe('applicaRiconciliazioneAction', () => {
  beforeEach(() => {
    auth.mockReset();
    riconciliaTutto.mockReset();
    riconciliaTutto.mockResolvedValue({ proposte: 3, agganciati: 3, errori: 0 });
  });

  it('applica per ADMIN_PIATTAFORMA', async () => {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
    expect(await applicaRiconciliazioneAction()).toEqual({
      ok: true,
      agganciati: 3,
      errori: 0,
    });
  });

  it('rifiuta SALES_MANAGER: è un\'operazione di massa', async () => {
    auth.mockResolvedValue({ user: { id: 'u2', role: 'SALES_MANAGER' } });
    const res = await applicaRiconciliazioneAction();
    expect(res).toMatchObject({ ok: false });
    expect(riconciliaTutto).not.toHaveBeenCalled();
  });

  it('rifiuta SALES', async () => {
    auth.mockResolvedValue({ user: { id: 'u3', role: 'SALES' } });
    expect(await applicaRiconciliazioneAction()).toMatchObject({ ok: false });
    expect(riconciliaTutto).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter @pv/piattaforma test src/app/admin/crm/riconciliazione`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Aggiungi il permesso**

In `apps/piattaforma/src/lib/auth/permissions.ts`, dopo `canViewCrmPermissions`:

```ts
/**
 * Riconciliazione CRM ↔ aziende registrate: vista e applicazione. Operazione
 * di massa sull'intera lista → solo CRM full (ADMIN/AD/CTO), fuori portata di
 * SALES_MANAGER e SALES.
 */
export function canRunCrmReconciliation(role: string | undefined): boolean {
  return inSet(CRM_FULL, role);
}
```

- [ ] **Step 4: Scrivi la server action**

Crea `apps/piattaforma/src/app/admin/crm/riconciliazione/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canRunCrmReconciliation } from '@/lib/auth/permissions';
import { riconciliaTutto } from '@/lib/crm/match/apply';

export type EsitoRiconciliazione =
  | { ok: true; agganciati: number; errori: number }
  | { ok: false; error: string };

/**
 * Applica la riconciliazione. Le proposte si ricalcolano qui: quelle mostrate
 * in anteprima non tornano indietro dal client, così non c'è modo di far
 * agganciare al server una coppia che l'algoritmo non avrebbe scelto.
 */
export async function applicaRiconciliazioneAction(): Promise<EsitoRiconciliazione> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canRunCrmReconciliation(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per la riconciliazione CRM' };
  }

  const esito = await riconciliaTutto();
  revalidatePath('/admin/crm/riconciliazione');
  revalidatePath('/admin/crm/contatti');
  revalidatePath('/admin/crm/dashboard');
  return { ok: true, agganciati: esito.agganciati, errori: esito.errori };
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `pnpm --filter @pv/piattaforma test src/app/admin/crm/riconciliazione`
Expected: PASS.

- [ ] **Step 6: Scrivi la pagina**

Crea `apps/piattaforma/src/app/admin/crm/riconciliazione/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canRunCrmReconciliation } from '@/lib/auth/permissions';
import { calcolaProposte } from '@/lib/crm/match/engine';
import { RiconciliazioneClient } from './client';

export const metadata = { title: 'Riconciliazione · CRM' };

const ANTEPRIMA_MAX = 100;

export default async function AdminCrmRiconciliazionePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canRunCrmReconciliation(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/riconciliazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La riconciliazione CRM è riservata a Admin / AD / CTO.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const proposte = await calcolaProposte();
  const broker = proposte.filter((p) => p.cat === 'BROKER').length;
  const agenzia = proposte.length - broker;

  return (
    <AppShell session={session} activePath="/admin/crm/riconciliazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Riconciliazione
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Righe della lista che corrispondono ad aziende già registrate. Ogni
            proposta ha almeno un identificativo forte in comune: P.IVA, email,
            PEC o telefono.
          </p>
        </header>

        <RiconciliazioneClient
          proposte={proposte.slice(0, ANTEPRIMA_MAX)}
          totale={proposte.length}
          broker={broker}
          agenzia={agenzia}
          mostrate={Math.min(proposte.length, ANTEPRIMA_MAX)}
        />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 7: Scrivi il client**

Crea `apps/piattaforma/src/app/admin/crm/riconciliazione/client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, useActionOverlay } from '@/components/ui';
import type { Proposta } from '@/lib/crm/match/engine';
import { applicaRiconciliazioneAction } from './actions';

const ETICHETTE: Record<string, string> = {
  piva: 'P.IVA',
  email: 'Email',
  tel: 'Telefono',
  nome: 'Nome',
  'nome~': 'Nome simile',
  indirizzo: 'Indirizzo',
  cap: 'CAP',
  citta: 'Città',
};

export function RiconciliazioneClient({
  proposte,
  totale,
  broker,
  agenzia,
  mostrate,
}: {
  proposte: Proposta[];
  totale: number;
  broker: number;
  agenzia: number;
  mostrate: number;
}) {
  const router = useRouter();
  const [esito, setEsito] = useState<string | null>(null);
  const { run, pending, overlay } = useActionOverlay('Aggancio in corso…');

  const applica = () =>
    run(async () => {
      const res = await applicaRiconciliazioneAction();
      setEsito(
        res.ok
          ? `${res.agganciati} righe agganciate${res.errori > 0 ? `, ${res.errori} errori` : ''}.`
          : res.error,
      );
      router.refresh();
    });

  if (totale === 0) {
    return (
      <Alert variant="info" title="Nessuna proposta">
        Ogni azienda registrata è già agganciata alla sua riga, oppure nessuna
        riga della lista condivide un identificativo forte con le aziende
        registrate.
      </Alert>
    );
  }

  return (
    <>
      {overlay}
      {esito ? (
        <div className="mb-4">
          <Alert variant="info" title="Esito">
            {esito}
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)]">
        <p className="text-[13px] text-pv-slate-700">
          <span className="font-bold text-pv-navy-900">{totale}</span> righe
          verranno agganciate — {broker} broker, {agenzia} agenzie.
          {mostrate < totale ? ` In anteprima le prime ${mostrate}.` : ''}
        </p>
        <Button onClick={applica} disabled={pending}>
          Applica
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
        <table className="w-full min-w-[880px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-pv-slate-200 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <th className="px-4 py-3">Riga in lista</th>
              <th className="px-4 py-3">Azienda registrata</th>
              <th className="px-4 py-3">Campi in comune</th>
              <th className="px-4 py-3 text-right">Punteggio</th>
            </tr>
          </thead>
          <tbody>
            {proposte.map((p) => (
              <tr
                key={p.contactId}
                className="border-b border-pv-slate-100 last:border-0"
              >
                <td className="px-4 py-2.5">
                  <span className="font-semibold text-pv-navy-900">{p.contactNome}</span>
                  <span className="block text-[12px] text-pv-slate-500">
                    {[p.contactTel, p.contactCitta].filter(Boolean).join(' · ') || '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-semibold text-pv-navy-900">{p.companyNome}</span>
                  <span className="block text-[12px] text-pv-slate-500">
                    {p.sedeNome ? `Sede: ${p.sedeNome}` : 'Sede principale'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {p.campi.map((c) => (
                      <span
                        key={c}
                        className="rounded-[6px] bg-pv-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-pv-navy-700"
                      >
                        {ETICHETTE[c] ?? c}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-pv-navy-900">
                  {p.punteggio}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

Verifica che `useActionOverlay` sia esportato da `@/components/ui`:
Run: `grep -n "use-action-overlay\|useActionOverlay" apps/piattaforma/src/components/ui/index.ts`
Se non c'è, importalo direttamente da `@/components/ui/use-action-overlay`.

- [ ] **Step 8: Aggiungi la voce di navigazione**

In `apps/piattaforma/src/components/admin/admin-shell.tsx`, nel gruppo `CRM` di `NAV_GROUPS`, dopo la voce `Contatti`:

```tsx
      { href: '/admin/crm/riconciliazione', label: 'Riconciliazione', icon: IconCrm },
```

- [ ] **Step 9: Test, typecheck e lint**

Run: `pnpm --filter @pv/piattaforma test && pnpm typecheck && pnpm lint`
Expected: PASS, 0 errori.

- [ ] **Step 10: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/riconciliazione apps/piattaforma/src/lib/auth/permissions.ts apps/piattaforma/src/components/admin/admin-shell.tsx
git commit -m "feat(crm): pagina admin di riconciliazione con anteprima"
```

---

### Task 12: Badge "registrata" nella lista contatti

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/page.tsx:94-160` (include + serializzazione)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx:22-67` (tipo `ContactRow`) e `:332` (cella nome)

**Interfaces:**
- Consumes: le colonne `companyId`/`sedeId` scritte dal Task 8.
- Produces: nessuna API nuova.

- [ ] **Step 1: Porta azienda e sede fino alla riga**

In `apps/piattaforma/src/app/admin/crm/contatti/page.tsx`, nella `findMany` dei contatti (~riga 95), estendi `include`:

```ts
      include: {
        assignedTo: { select: { id: true, nome: true, cognome: true } },
        company: { select: { ragioneSociale: true } },
        sede: { select: { nome: true } },
      },
```

e nella serializzazione (~riga 144) aggiungi due campi, togliendo gli oggetti relazione:

```ts
  const contacts = pageContacts.map((c) => ({
    ...c,
    assignedToName: c.assignedTo
      ? `${c.assignedTo.nome} ${c.assignedTo.cognome}`.trim()
      : null,
    assignedTo: undefined,
    aziendaNome: c.company?.ragioneSociale ?? null,
    sedeNome: c.sede?.nome ?? null,
    company: undefined,
    sede: undefined,
```

(il resto della mappatura resta invariato)

- [ ] **Step 2: Estendi il tipo della riga**

In `apps/piattaforma/src/app/admin/crm/contatti/client.tsx`, dentro `type ContactRow` (dopo `tassoComp: number;`):

```ts
  companyId: string | null;
  aziendaNome: string | null;
  sedeNome: string | null;
```

- [ ] **Step 3: Mostra il badge**

Sostituisci la cella del nome (riga 332):

```tsx
                  <td className="px-4 py-2.5 font-semibold text-pv-navy-900">
                    {c.nome}
                    {c.aziendaNome ? (
                      <span
                        className="mt-1 block text-[11.5px] font-semibold text-pv-green-700"
                        title={
                          c.sedeNome
                            ? `Registrata: ${c.aziendaNome} — ${c.sedeNome}`
                            : `Registrata: ${c.aziendaNome}`
                        }
                      >
                        ● Registrata · {c.aziendaNome}
                        {c.sedeNome ? ` (${c.sedeNome})` : ''}
                      </span>
                    ) : null}
                  </td>
```

Verifica che la classe di colore esista nel design system:
Run: `grep -rn "pv-green-700" apps/piattaforma/src --include=*.tsx | head -3`
Se non esiste, usa la classe di successo già in uso nel progetto (cerca `text-pv-` in `components/ui/alert.tsx`).

- [ ] **Step 4: Typecheck e lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errori.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/page.tsx apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): badge azienda registrata nella lista contatti"
```

---

### Task 13: Verifica end-to-end sul DB reale e nel browser

Nessun codice nuovo: è il task che dimostra che il lavoro funziona sui 19.103 contatti veri.

**Files:**
- Nessuno (eventuali correzioni emerse qui vanno committate a parte)

- [ ] **Step 1: Fotografia prima**

Run:
```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "select count(*) filter (where \"companyId\" is not null) agganciati, count(*) filter (where status in ('S7','S8','S9')) iscritti from crm_contacts where \"deletedAt\" is null;"
```
Expected: `agganciati` 0, `iscritti` 0. Annota i valori.

- [ ] **Step 2: Avvia il dev server**

Run: `nvm use 22.15.0 && pnpm --filter @pv/piattaforma dev`
Expected: server su :3000. Se la porta è occupata da un processo zombie, uccidilo prima (`netstat -ano | findstr :3000`), altrimenti servirai codice vecchio.

- [ ] **Step 3: Apri la pagina e leggi l'anteprima**

Vai su `http://localhost:3000/admin/crm/riconciliazione` con un utente ADMIN_PIATTAFORMA.
Expected: la tabella mostra almeno `Agenzia Corsico Pratiche Auto → AGENZIA CORSICO DI CIAVARELLA ANTONIO` con i chip `Telefono`, `Indirizzo`, `CAP`, `Città`.
**Leggi le prime 20 righe una per una**: se compare una coppia palesemente sbagliata (aziende in province diverse, nomi senza alcuna relazione), fermati e riporta il caso invece di applicare.

- [ ] **Step 4: Applica e verifica il cambiamento di stato**

Clicca «Applica» (il click vero, non una navigazione per URL).
Expected: messaggio con il numero di righe agganciate.

Run:
```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "select status, count(*) from crm_contacts where \"companyId\" is not null and \"deletedAt\" is null group by status order by 1;"
```
Expected: righe in S7/S8/S9 coerenti con le pratiche firmate delle aziende agganciate.

- [ ] **Step 5: Verifica che i numeri crescano dove l'utente li guarda**

Apri `/admin/crm/contatti`: la card «Iscritti» non è più a zero e le righe agganciate mostrano il badge verde.
Apri `/admin/crm/dashboard`: la sezione "Registrati sulla piattaforma" mostra il conteggio "da lista" diverso da zero.

- [ ] **Step 6: Verifica l'idempotenza**

Ricarica `/admin/crm/riconciliazione` e clicca di nuovo «Applica».
Expected: 0 nuovi agganci, nessun errore, nessuno stato che retrocede.

Run:
```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "select count(*) from crm_contacts where \"companyId\" is not null and \"deletedAt\" is null;"
```
Expected: identico al passo 4.

- [ ] **Step 7: Suite completa**

Run: `pnpm --filter @pv/piattaforma test && pnpm typecheck && pnpm lint`
Expected: suite verde, 0 errori tsc, 0 warning eslint.

- [ ] **Step 8: Riepilogo per il rilascio**

Scrivi nel messaggio finale: numero di righe agganciate sul DB locale, distribuzione degli stati, e il promemoria che **la migration `20260727150000_crm_match_normalizzato` va applicata a mano su Neon (ep-solitary-night) PRIMA del deploy del codice**.

---

## Note di rilascio

- Ordine obbligato: **migration su Neon prima del push**. Le colonne sono nullable e il codice vecchio le ignora, quindi la finestra intermedia è sicura.
- Dopo il deploy, la prima passata del cron `crm-sync` riconcilia da sola; l'anteprima admin serve a controllare prima, non a far partire il processo.
- Nessuna variabile d'ambiente nuova.
