# Pratiche in attesa di firma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'admin di piattaforma un tab per vedere le pratiche ferme in attesa della sola firma (con l'anzianità dell'attesa e i recapiti per sollecitare), il potere di attestare la firma al posto dell'agenzia con motivazione tracciata, e la clausola contrattuale che rende quel potere opponibile.

**Architecture:** Il tab vive nella pagina `/admin/pratiche` esistente, con un filtro composito (`stato = PROCESSATA AND flagSegnalata = false`) che `whereStato` da sola non sa esprimere. L'attestazione admin **riusa il motore della firma esistente** (`firmaPraticaCore`, ~340 righe di effetti a cascata) tramite un parametro `attore`: gli effetti non vengono mai duplicati. I gate condivisi vengono estratti in una funzione pura e testabile.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma + Postgres, Vitest, Tailwind (design system interno `components/ui`).

**Spec di riferimento:** `docs/superpowers/specs/2026-07-13-attesa-firma-admin-design.md`

## Global Constraints

- ⚠️ **Node NON gira su Git Bash in questo ambiente.** Test, typecheck, lint e build vanno lanciati **da PowerShell**, col PATH nvm in testa:
  ```powershell
  $env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test src/lib/...
  ```
  Il package si chiama **`piattaforma`**. Un comando lanciato da Bash fallisce con "node not found" — non è il tuo codice.
- ⚠️ **PowerShell 5.1 corrompe le lettere accentate** quando riscrive un file: usare **Edit/Write**, mai `Set-Content`/`Out-File` per il sorgente. (Questo repo è pieno di italiano accentato.)
- **Test verdi NON implicano typecheck verde** (vitest non typecheck-a): lanciare **sempre entrambi**. Nessun test va dichiarato verde senza averlo visto **prima rosso**.
- **Typecheck**: a cache fredda `tsc` è inaffidabile (stack overflow / falsi errori Prisma). Se esplode senza che tu abbia toccato i tipi, rilancialo — non inseguire un fantasma.
- **MAI `pnpm db:migrate`** (`prisma migrate dev`): propone DROP SEQUENCE ed è distruttivo. Le migration si scrivono **a mano** e si applicano con `pnpm --filter @pv/db db:deploy`, poi `pnpm db:generate`.
- **Convenzione nome migration**: `packages/db/prisma/migrations/YYYYMMDDHHMMSS_snake_case_name/migration.sql`.
- ⚠️ **Token colore realmente esistenti** (verificati in `globals.css` — le altre tonalità NON esistono e non colorano nulla):
  - `pv-amber`: solo **50** e **500**
  - `pv-green`: solo **50** e **500**
  - `pv-red`: solo **50** e **500**
  - `pv-slate`: **50, 100, 200, 300, 500, 700, 900** — **NON esiste `slate-600`**
  Coppie canoniche, come le usa `StatusChip`: `bg-pv-red-50 text-pv-red-500`, `bg-pv-amber-50 text-pv-amber-500`, `bg-pv-green-50 text-pv-green-500`, `bg-pv-slate-100 text-pv-slate-700`.
  Mai hardcodare un hex nel JSX.
- **Nessuna email di sollecito**: fuori perimetro per decisione esplicita. Non aggiungere template N-nuovi.
- **Solo `ADMIN_PIATTAFORMA`** può attestare la firma. `ASSISTENTE` vede la lista ma non attesta.

---

### Task 1: Fonte unica dei numeri delle clausole vessatorie

Oggi l'elenco è scritto a mano in due posti (pagina Termini e checkbox di registrazione). Aggiungendo una clausola vessatoria, i due divergono. Questa task crea la fonte unica **prima** di toccare il testo.

**Files:**
- Create: `apps/piattaforma/src/lib/legal/clausole-vessatorie.ts`
- Test: `apps/piattaforma/src/lib/legal/clausole-vessatorie.test.ts`

**Interfaces:**
- Produces: `ART_APPROVAZIONE_SPECIFICA: 18`, `CLAUSOLE_VESSATORIE: readonly number[]`, `TERMS_VERSION: string`, `elencoClausoleVessatorie(): string`

- [ ] **Step 1: Write the failing test**

`apps/piattaforma/src/lib/legal/clausole-vessatorie.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ART_APPROVAZIONE_SPECIFICA,
  CLAUSOLE_VESSATORIE,
  TERMS_VERSION,
  elencoClausoleVessatorie,
} from './clausole-vessatorie';

describe('clausole vessatorie', () => {
  it('elenca le clausole approvate specificamente ex 1341/1342', () => {
    expect([...CLAUSOLE_VESSATORIE]).toEqual([3, 5, 7, 8, 10, 11, 12, 13, 17]);
  });

  it('l’articolo di approvazione specifica è il 18', () => {
    expect(ART_APPROVAZIONE_SPECIFICA).toBe(18);
  });

  it('nessuna clausola vessatoria coincide o supera l’articolo di approvazione', () => {
    // Un elenco che citasse se stesso (o un articolo inesistente) sarebbe un
    // contratto che si contraddice: qui si rompe il test, non il contratto.
    for (const n of CLAUSOLE_VESSATORIE) {
      expect(n).toBeLessThan(ART_APPROVAZIONE_SPECIFICA);
      expect(n).toBeGreaterThan(0);
    }
  });

  it('l’elenco è ordinato e senza duplicati', () => {
    const arr = [...CLAUSOLE_VESSATORIE];
    expect(arr).toEqual([...new Set(arr)].sort((a, b) => a - b));
  });

  it('rende l’elenco come stringa leggibile per la checkbox', () => {
    expect(elencoClausoleVessatorie()).toBe('3, 5, 7, 8, 10, 11, 12, 13, 17');
  });

  it('la versione dei Termini è una data ISO', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma test src/lib/legal/clausole-vessatorie.test.ts`
Expected: FAIL — "Failed to resolve import './clausole-vessatorie'"

- [ ] **Step 3: Write minimal implementation**

`apps/piattaforma/src/lib/legal/clausole-vessatorie.ts`:

```ts
/**
 * FONTE UNICA dei numeri delle clausole dei Termini citati altrove.
 *
 * Prima esistevano due elenchi scritti a mano — nel testo dell'articolo di
 * approvazione specifica (`app/termini/page.tsx`) e nella checkbox di
 * registrazione (`register-wizard.tsx`) — più nove occorrenze del rimando
 * "v. clausola N" sparse nel testo. Aggiungere una clausola vessatoria
 * significava tenere allineati a mano undici punti: la ricetta esatta per un
 * contratto che si contraddice da solo.
 */

/** Numero dell'articolo di approvazione specifica ex artt. 1341-1342 c.c. */
export const ART_APPROVAZIONE_SPECIFICA = 18;

/**
 * Clausole che l'Utente approva specificamente con la seconda spunta in
 * registrazione. Ordinate, senza duplicati, tutte < ART_APPROVAZIONE_SPECIFICA.
 */
export const CLAUSOLE_VESSATORIE = [3, 5, 7, 8, 10, 11, 12, 13, 17] as const;

/**
 * Versione dei Termini in vigore, persistita su `Company.termsVersion` al
 * momento dell'accettazione: senza, non sappiamo QUALE testo l'utente ha
 * accettato. Aggiornare a ogni modifica sostanziale della pagina /termini.
 */
export const TERMS_VERSION = '2026-07-13';

/** L'elenco come lo legge l'utente: "3, 5, 7, 8, 10, 11, 12, 13, 17". */
export function elencoClausoleVessatorie(): string {
  return CLAUSOLE_VESSATORIE.join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma test src/lib/legal/clausole-vessatorie.test.ts`
Expected: PASS (6 test)

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/legal/
git commit -m "feat(legal): fonte unica per i numeri delle clausole vessatorie"
```

---

### Task 2: Termini — nuovo art. 11 e rinumerazione 11→18

Il cuore del rischio. Gli articoli da 11 in poi slittano di uno, **e i numeri sono citati dentro il testo delle altre clausole**: 12 punti da correggere. Nove di questi (il rimando "v. clausola 17") diventano interpolazioni della fonte unica del Task 1 e non potranno più divergere.

**Files:**
- Modify: `apps/piattaforma/src/app/termini/page.tsx`
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx:1058-1059`

**Interfaces:**
- Consumes: `ART_APPROVAZIONE_SPECIFICA`, `CLAUSOLE_VESSATORIE`, `elencoClausoleVessatorie()` da Task 1

- [ ] **Step 1: Importare la fonte unica nella pagina Termini**

In testa a `app/termini/page.tsx`:

```ts
import {
  ART_APPROVAZIONE_SPECIFICA,
  CLAUSOLE_VESSATORIE,
} from '@/lib/legal/clausole-vessatorie';
```

- [ ] **Step 2: Sostituire le NOVE occorrenze del rimando "v. clausola 17"**

Sono alle righe **108, 145, 178, 195, 241, 317, 332, 373** del testo più la riga **21** (commento JSDoc). Ognuna ha la forma `(clausola vessatoria: v. clausola 17).` o `v. clausola 17`.

Sostituire il numero letterale con l'interpolazione. Esempio, riga 107-108:

```tsx
// PRIMA
L&apos;agenzia accetta espressamente tale facoltà di variazione (clausola vessatoria: v.
clausola 17).

// DOPO
L&apos;agenzia accetta espressamente tale facoltà di variazione (clausola vessatoria: v.
clausola {ART_APPROVAZIONE_SPECIFICA}).
```

⚠️ **Attenzione — righe con due riferimenti.** Le righe **145**, **194-195** e **241** citano *anche* una clausola ≤ 10, che **non cambia**:
- riga 145: cita la clausola **10** (invariata) *e* la 17 (→ interpolazione)
- riga 194-195: cita la clausola **6** (invariata) *e* la 17 (→ interpolazione)
- riga 241: cita la clausola **3** (invariata) *e* la 17 (→ interpolazione)

Tocca **solo** il rimando alla 17. Il commento JSDoc di riga 21 (`elencate alla clausola 17`) è testo di commento: scrivi `clausola 18` a mano lì, non puoi interpolare in un commento.

- [ ] **Step 3: Verificare che non resti nessun "clausola 17" letterale**

Run: `grep -n "clausola 17" apps/piattaforma/src/app/termini/page.tsx`
Expected: **nessun output**. Se ne resta uno, non hai finito.

- [ ] **Step 4: Correggere i tre riferimenti incrociati one-off**

| Riga | Da | A |
|---|---|---|
| 20 (commento JSDoc) | `limitazioni di responsabilità (12)` | `limitazioni di responsabilità (13)` |
| 238 | `sospensione ai sensi della clausola 11` | `sospensione ai sensi della clausola 12` |
| 426 | `clausola 13` | `clausola 14` |

Run per verificare che nessun altro riferimento ≥11 sia rimasto indietro:
`grep -n "clausola 1[1-9]" apps/piattaforma/src/app/termini/page.tsx`
Expected: solo le occorrenze **nuove e corrette** (12, 14) — nessuna 11, 13, 15, 16, 17.

- [ ] **Step 5: Rinumerare i titoli delle Section da 11 in poi**

I titoli sono le prop `title` del componente locale `Section`. In ordine, **partendo dal fondo per non creare collisioni**:

| Ora | Diventa |
|---|---|
| `17. Approvazione specifica delle clausole (artt. 1341 e 1342 c.c.)` | `18. …` |
| `16. Legge applicabile e foro competente` | `17. …` |
| `15. Trattamento dei dati personali` | `16. …` |
| `14. Durata e recesso` | `15. …` |
| `13. Modifiche ai Termini` | `14. …` |
| `12. Limitazioni di responsabilità` | `13. …` |
| `11. Limitazione operativa, sospensione e cancellazione dell'account` | `12. …` |

- [ ] **Step 6: Inserire la nuova Section 11, subito dopo la Section 10 (Segnalazioni e penali)**

```tsx
<Section title="11. Attestazione della firma da parte del Gestore">
  <p>
    Completata la lavorazione da parte dell&apos;Agenzia, la pratica resta in attesa che
    venga segnalata sulla Piattaforma l&apos;avvenuta sottoscrizione da parte del cliente.
    Il Gestore monitora le pratiche in attesa e può sollecitare Broker e Agenzia affinché
    vi provvedano.
  </p>
  <p>
    Qualora il Gestore acquisisca, per qualunque via (dichiarazione dell&apos;Agenzia o del
    Broker, documentazione ricevuta, riscontro presso gli uffici competenti), la conoscenza
    che la sottoscrizione è già intervenuta,{' '}
    <strong>
      può attestarla direttamente sulla Piattaforma in luogo dell&apos;Agenzia
    </strong>
    .
  </p>
  <p>
    L&apos;attestazione produce <strong>tutti gli effetti della segnalazione ordinaria</strong>:
    perfezionamento della pratica, maturazione del compenso del Broker, addebito della fee a
    carico dell&apos;Agenzia ed emissione della relativa fattura.
  </p>
  <p>
    Il Gestore registra data, autore e motivazione dell&apos;attestazione e ne dà evidenza a
    Broker e Agenzia. L&apos;Agenzia che ritenga l&apos;attestazione erronea può contestarla,
    con comunicazione motivata all&apos;indirizzo di assistenza,{' '}
    <strong>entro 15 giorni</strong> dalla comunicazione della stessa; in caso di
    contestazione fondata il Gestore procede allo storno dell&apos;addebito e
    all&apos;emissione di nota di credito.
  </p>
  <p>
    L&apos;Utente approva espressamente il presente potere di attestazione (clausola
    vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
  </p>
</Section>
```

- [ ] **Step 7: Rendere l'elenco dell'art. 18 generato dalla fonte unica**

Nella Section `18. Approvazione specifica…`, l'elenco delle clausole non deve più essere scritto a mano. Sostituire l'elenco letterale con un rendering da `CLAUSOLE_VESSATORIE`, mantenendo le descrizioni. Le descrizioni restano testo, i **numeri** vengono dalla fonte unica:

```tsx
<ul className="list-disc space-y-1 pl-5">
  {CLAUSOLE_VESSATORIE.map((n) => (
    <li key={n}>
      <strong>Clausola {n}</strong> — {DESCRIZIONI_VESSATORIE[n]}
    </li>
  ))}
</ul>
```

con, in cima al file (fuori dal componente):

```tsx
/** Descrizione sintetica di ogni clausola vessatoria. Le CHIAVI devono coprire
 *  esattamente CLAUSOLE_VESSATORIE: se aggiungi un numero là e non qui, il
 *  render mostra `undefined` — il test di Task 1 non lo cattura, l'occhio sì. */
const DESCRIZIONI_VESSATORIE: Record<number, string> = {
  3: 'variazione del prezzo del servizio a discrezione del Gestore',
  5: 'condizioni e soglia di prelievo del wallet (payout)',
  7: 'determinazione differenziata del compenso in base al regime fiscale',
  8: 'manleva in materia di visura camerale',
  10: 'sistema di segnalazioni e penali',
  11: 'potere di attestazione della firma da parte del Gestore',
  12: 'limitazione operativa, sospensione e cancellazione dell’account',
  13: 'limitazioni di responsabilità',
  17: 'deroga alla competenza territoriale (foro esclusivo)',
};
```

Verifica **sul DOM renderizzato**, non sui byte: se una chiave manca, in pagina compare `undefined`.

- [ ] **Step 8: Aggiornare la data di ultimo aggiornamento in pagina (riga ~47)**

Da `2026-07-11` a `2026-07-13` (deve combaciare con `TERMS_VERSION` del Task 1).

- [ ] **Step 9: Aggiornare la checkbox di registrazione perché legga la fonte unica**

`app/(auth)/register/register-wizard.tsx`, righe 1058-1059. Il file è `'use client'`: l'import di un modulo di sole costanti è sicuro.

```tsx
// import in testa al file
import { elencoClausoleVessatorie } from '@/lib/legal/clausole-vessatorie';

// PRIMA (righe 1058-1059)
Ai sensi degli artt. 1341-1342 c.c. approvo specificamente le clausole nn. 3, 5, 7, 8, 10,
11, 12, 16 dei{' '}

// DOPO
Ai sensi degli artt. 1341-1342 c.c. approvo specificamente le clausole nn.{' '}
{elencoClausoleVessatorie()} dei{' '}
```

- [ ] **Step 10: Typecheck + verifica sul DOM**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma dev
```

Aprire `http://localhost:3000/termini` e **leggere la pagina**:
- i titoli vanno da 1 a 18 senza salti né duplicati;
- ogni "v. clausola 18" punta davvero alla Section 18;
- la Section 18 elenca 9 clausole, nessuna con descrizione `undefined`;
- la clausola 10.7 rimanda alla 12 (Limitazione operativa), non alla 11.

Aprire `http://localhost:3000/register` fino allo step 4 e leggere la seconda spunta: deve dire "clausole nn. 3, 5, 7, 8, 10, 11, 12, 13, 17".

- [ ] **Step 11: Commit**

```bash
git add apps/piattaforma/src/app/termini/page.tsx apps/piattaforma/src/app/\(auth\)/register/register-wizard.tsx
git commit -m "feat(termini): art. 11 sull'attestazione della firma, rinumerazione 11-18"
```

---

### Task 3: Persistere l'approvazione delle clausole vessatorie

Oggi `clausoleVessatorieAccepted` è validata da Zod e **buttata via**: sul DB c'è solo `termsAcceptedAt`. Senza prova dell'approvazione specifica e della versione accettata, la clausola del Task 2 è carta straccia.

**Files:**
- Create: `packages/db/prisma/migrations/20260713100000_company_clausole_vessatorie/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (model `Company`, vicino a `termsAcceptedAt`, riga ~376)
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts:459`

**Interfaces:**
- Consumes: `TERMS_VERSION` da Task 1
- Produces: colonne `Company.clausoleVessatorieAcceptedAt`, `Company.termsVersion`

- [ ] **Step 1: Scrivere la migration a mano**

`packages/db/prisma/migrations/20260713100000_company_clausole_vessatorie/migration.sql`:

```sql
-- Approvazione specifica delle clausole vessatorie ex artt. 1341-1342 c.c.
-- Finora la seconda spunta della registrazione veniva validata e poi scartata:
-- nessuna prova dell'approvazione, né della versione dei Termini accettata.
-- Nullable e senza backfill: le aziende registrate prima restano a NULL, che è
-- la verità (non hanno approvato QUESTA versione).
ALTER TABLE "companies" ADD COLUMN "clausoleVessatorieAcceptedAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "termsVersion" TEXT;
```

⚠️ Verifica il nome reale della tabella in `schema.prisma` (`@@map`) prima di eseguire: se il model `Company` mappa su un nome diverso da `companies`, correggi la SQL.

- [ ] **Step 2: Aggiornare lo schema Prisma**

In `model Company`, subito sotto `termsAcceptedAt`:

```prisma
  /** Approvazione specifica ex artt. 1341-1342 c.c. (seconda spunta, separata). */
  clausoleVessatorieAcceptedAt DateTime?
  /** Versione dei Termini accettata (lib/legal/clausole-vessatorie.ts TERMS_VERSION). */
  termsVersion                 String?
```

- [ ] **Step 3: Applicare la migration e rigenerare il client**

```bash
pnpm --filter @pv/db db:deploy
pnpm db:generate
```

Expected: `db:deploy` stampa "1 migration applied". **Non** usare `db:migrate`.

- [ ] **Step 4: Verificare che le colonne esistano davvero sul DB locale**

```bash
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c "\d companies" | grep -E "clausoleVessatorie|termsVersion"
```

Expected: due righe. Se non stampa nulla, la migration non è passata — non proseguire.

- [ ] **Step 5: Scrivere i campi in registrazione**

`app/(auth)/actions.ts`, nel `data` del `company.create` (riga 459, dove già c'è `termsAcceptedAt`):

```ts
// import in testa al file
import { TERMS_VERSION } from '@/lib/legal/clausole-vessatorie';

// nel data:
          termsAcceptedAt: new Date(),
          // La seconda spunta (artt. 1341-1342) è validata da
          // registerStep4PaymentSchema come z.literal(true): se siamo qui,
          // l'utente l'ha messa. Prima veniva scartata e non lasciava traccia.
          clausoleVessatorieAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma apps/piattaforma/src/app/\(auth\)/actions.ts
git commit -m "feat(legal): persisti approvazione clausole vessatorie e versione Termini"
```

---

### Task 4: Gate della firma, estratto e testabile

I gate comuni ai due percorsi (agenzia e admin) diventano una funzione **pura**: si testa senza mockare né auth né Prisma, e non può divergere fra i due chiamanti. Include il gate nuovo sulla segnalazione aperta, che chiude un bug preesistente (oggi si può firmare una pratica segnalata, e la segnalazione resta appesa per sempre nella coda admin).

**Files:**
- Create: `apps/piattaforma/src/lib/pratiche/firma-gate.ts`
- Test: `apps/piattaforma/src/lib/pratiche/firma-gate.test.ts`

**Interfaces:**
- Produces: `type PraticaFirmabile`, `function motivoBloccoFirma(p: PraticaFirmabile): string | null` — ritorna `null` se la firma è ammessa, altrimenti il messaggio d'errore da mostrare.

- [ ] **Step 1: Write the failing test**

`apps/piattaforma/src/lib/pratiche/firma-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { motivoBloccoFirma, type PraticaFirmabile } from './firma-gate';

const ok: PraticaFirmabile = {
  stato: 'PROCESSATA',
  flagSegnalata: false,
  agenziaAssegnataId: 'age-1',
};

describe('motivoBloccoFirma', () => {
  it('una pratica processata, non segnalata e assegnata è firmabile', () => {
    expect(motivoBloccoFirma(ok)).toBeNull();
  });

  it('blocca se la pratica non è ancora processata', () => {
    expect(motivoBloccoFirma({ ...ok, stato: 'ACCETTATA' })).toBe(
      'La pratica deve essere prima processata',
    );
  });

  it('blocca se la pratica è già firmata', () => {
    expect(motivoBloccoFirma({ ...ok, stato: 'FIRMATA' })).toBe(
      'La pratica deve essere prima processata',
    );
  });

  it('blocca se c’è una segnalazione in verifica', () => {
    // Bug preesistente: prima di questo gate una pratica segnalata poteva
    // essere firmata, e la segnalazione restava appesa per sempre nella coda
    // admin (confermaAnnullamentoConPenale rifiuta le FIRMATA).
    expect(motivoBloccoFirma({ ...ok, flagSegnalata: true })).toBe(
      'Pratica con segnalazione in verifica: non puoi firmarla finché il team non ha deciso.',
    );
  });

  it('blocca se non c’è un’agenzia assegnata', () => {
    expect(motivoBloccoFirma({ ...ok, agenziaAssegnataId: null })).toBe(
      'Pratica senza agenzia assegnata',
    );
  });

  it('lo stato viene controllato prima della segnalazione', () => {
    // Una pratica ANNULLATA con flagSegnalata deve dire "non processata",
    // non "segnalazione in verifica": il messaggio deve descrivere il vero
    // motivo per cui l'utente non può procedere.
    expect(motivoBloccoFirma({ stato: 'ANNULLATA', flagSegnalata: true, agenziaAssegnataId: 'age-1' }))
      .toBe('La pratica deve essere prima processata');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma test src/lib/pratiche/firma-gate.test.ts`
Expected: FAIL — "Failed to resolve import './firma-gate'"

- [ ] **Step 3: Write minimal implementation**

`apps/piattaforma/src/lib/pratiche/firma-gate.ts`:

```ts
import type { PraticaStato } from '@pv/db';

/** Il minimo che serve per decidere se una pratica può essere firmata. */
export type PraticaFirmabile = {
  stato: PraticaStato;
  flagSegnalata: boolean;
  agenziaAssegnataId: string | null;
};

/**
 * Gate COMUNI ai due percorsi di firma: quello dell'agenzia assegnata e quello
 * dell'attestazione da parte dell'admin. Puro: si testa senza auth né Prisma, e
 * i due chiamanti non possono divergere.
 *
 * NON contiene i gate specifici di un percorso (permesso `pratiche.firma`,
 * companyType, scope sede, blocco insoluti per l'agenzia; ruolo ADMIN e
 * motivazione per l'admin): quelli restano dove sono, perché non sono comuni.
 *
 * @returns null se la firma è ammessa, altrimenti il messaggio d'errore.
 */
export function motivoBloccoFirma(p: PraticaFirmabile): string | null {
  if (p.stato !== 'PROCESSATA') {
    return 'La pratica deve essere prima processata';
  }
  if (p.flagSegnalata) {
    return 'Pratica con segnalazione in verifica: non puoi firmarla finché il team non ha deciso.';
  }
  if (!p.agenziaAssegnataId) {
    return 'Pratica senza agenzia assegnata';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma test src/lib/pratiche/firma-gate.test.ts`
Expected: PASS (6 test)

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/firma-gate.ts apps/piattaforma/src/lib/pratiche/firma-gate.test.ts
git commit -m "feat(pratiche): gate firma estratto e puro, blocca le pratiche segnalate"
```

---

### Task 5: Anzianità dell'attesa

`countdownLevel` esistente misura giorni **residui** (meno = peggio). Qui serve l'opposto: giorni **trascorsi** (più = peggio). Usare `countdownLevel` darebbe colori invertiti: serve una funzione dedicata, nello stesso modulo.

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/countdown.ts`
- Test: `apps/piattaforma/src/lib/pratiche/countdown.test.ts` (crealo se non esiste)

**Interfaces:**
- Produces: `giorniTrascorsi(from: Date | null, now: Date): number | null`, `type AttesaLevel = 'none' | 'ok' | 'warn' | 'urgent'`, `attesaLevel(giorni: number | null): AttesaLevel`

- [ ] **Step 1: Write the failing test**

Aggiungere in `apps/piattaforma/src/lib/pratiche/countdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { giorniTrascorsi, attesaLevel } from './countdown';

const NOW = new Date('2026-07-13T12:00:00Z');
const giorniFa = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('giorniTrascorsi', () => {
  it('conta i giorni interi passati da una data', () => {
    expect(giorniTrascorsi(giorniFa(5), NOW)).toBe(5);
  });

  it('oggi stesso è 0 giorni', () => {
    expect(giorniTrascorsi(NOW, NOW)).toBe(0);
  });

  it('tronca le frazioni di giorno (18 ore = 0 giorni pieni)', () => {
    const diciottoOreFa = new Date(NOW.getTime() - 18 * 60 * 60 * 1000);
    expect(giorniTrascorsi(diciottoOreFa, NOW)).toBe(0);
  });

  it('null se la data non c’è', () => {
    expect(giorniTrascorsi(null, NOW)).toBeNull();
  });
});

describe('attesaLevel', () => {
  it.each([
    [0, 'ok'],
    [3, 'ok'],
    [4, 'warn'],
    [7, 'warn'],
    [8, 'urgent'],
    [40, 'urgent'],
  ])('%i giorni di attesa → %s', (giorni, atteso) => {
    expect(attesaLevel(giorni as number)).toBe(atteso);
  });

  it('null → none', () => {
    expect(attesaLevel(null)).toBe('none');
  });

  it('è l’INVERSO di countdownLevel: più giorni = più grave', () => {
    // countdownLevel conta i giorni RESIDUI (meno = peggio). Se qualcuno
    // riusasse quella per l'attesa, i colori sarebbero invertiti.
    expect(attesaLevel(1)).toBe('ok');
    expect(attesaLevel(30)).toBe('urgent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma test src/lib/pratiche/countdown.test.ts`
Expected: FAIL — "giorniTrascorsi is not a function" / import error

- [ ] **Step 3: Write minimal implementation**

Aggiungere in fondo a `apps/piattaforma/src/lib/pratiche/countdown.ts`:

```ts
/** Livello UI dell'ATTESA (giorni trascorsi): più tempo passa, più è grave. */
export type AttesaLevel = 'none' | 'ok' | 'warn' | 'urgent';

/**
 * Giorni interi trascorsi da `from` (troncati per difetto: 18 ore = 0 giorni).
 * null se `from` è null.
 */
export function giorniTrascorsi(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Soglie dell'attesa di firma: ≤3g ok, 4-7g warn, >7g urgent.
 *
 * ATTENZIONE: NON è `countdownLevel`. Quella misura i giorni RESIDUI (meno =
 * peggio); questa i giorni TRASCORSI (più = peggio). Riusare l'altra qui
 * invertirebbe i colori: una pratica ferma da un mese apparirebbe verde.
 */
export function attesaLevel(giorni: number | null): AttesaLevel {
  if (giorni === null) return 'none';
  if (giorni > 7) return 'urgent';
  if (giorni > 3) return 'warn';
  return 'ok';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma test src/lib/pratiche/countdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/countdown.ts apps/piattaforma/src/lib/pratiche/countdown.test.ts
git commit -m "feat(pratiche): livello di anzianita' dell'attesa (inverso del countdown)"
```

---

### Task 6: Il filtro e il tab "In attesa di firma"

Il criterio del tab non è solo lo stato (`PROCESSATA` **e** non segnalata), e `whereStato` sa filtrare **solo** il campo `stato`: su un valore che non riconosce ritorna `undefined`, cioè *nessun filtro*. Passare `ATTESA_FIRMA` a `whereStato` mostrerebbe **tutte** le pratiche, in silenzio. Serve una funzione che ritorni un `WhereInput` e che **legga** `whereStato` invece di ricopiarla.

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/stati.ts`
- Modify: `apps/piattaforma/src/lib/pratiche/tabs.ts`
- Test: `apps/piattaforma/src/lib/pratiche/stati.test.ts`, `apps/piattaforma/src/lib/pratiche/tabs.test.ts`

**Interfaces:**
- Produces: `WHERE_ATTESA_FIRMA`, `whereTabPratiche(param, ammessi): Prisma.PraticaWhereInput`, `ValoreTab` esteso con `'ATTESA_FIRMA'`, `tabsPraticheAdmin(conteggi, attesaFirma)`

- [ ] **Step 1: Write the failing tests**

Aggiungere in `stati.test.ts`:

```ts
import { whereTabPratiche, WHERE_ATTESA_FIRMA } from './stati';

describe('whereTabPratiche', () => {
  it('ATTESA_FIRMA = processata E non segnalata', () => {
    // Non basta lo stato: una PROCESSATA con segnalazione aperta è ferma in
    // coda admin, non in attesa di firma.
    expect(whereTabPratiche('ATTESA_FIRMA', SINGOLI_ADMIN)).toEqual({
      stato: 'PROCESSATA',
      flagSegnalata: false,
    });
  });

  it('delega a whereStato per gli aggregati', () => {
    expect(whereTabPratiche('IN_CORSO', SINGOLI_ADMIN)).toEqual({
      stato: { in: [...STATI_IN_CORSO] },
    });
  });

  it('delega a whereStato per gli stati singoli', () => {
    expect(whereTabPratiche('PROCESSATA', SINGOLI_ADMIN)).toEqual({ stato: 'PROCESSATA' });
  });

  it('nessun parametro → nessun filtro', () => {
    expect(whereTabPratiche(undefined, SINGOLI_ADMIN)).toEqual({});
  });

  it('valore ignoto → nessun filtro (come whereStato)', () => {
    expect(whereTabPratiche('PIPPO', SINGOLI_ADMIN)).toEqual({});
  });

  it('ATTESA_FIRMA non è uno stato: whereStato da sola non lo filtrerebbe', () => {
    // Questo è il motivo per cui whereTabPratiche esiste. Se qualcuno usasse
    // whereStato per il tab, vedrebbe TUTTE le pratiche senza alcun errore.
    expect(whereStato('ATTESA_FIRMA', SINGOLI_ADMIN)).toBeUndefined();
  });
});
```

Aggiungere in `tabs.test.ts` (dentro `describe('tabsPraticheAdmin')`):

```ts
it('include il tab In attesa di firma col suo conteggio', () => {
  const conteggi = { tutte: 20, inCorso: 8, escalation: 1, bozze: 2, concluse: 10 };
  const tabs = tabsPraticheAdmin(conteggi, 5);
  expect(tabs.map((t) => t.value)).toEqual([
    '',
    'IN_CORSO',
    'ATTESA_FIRMA',
    'IN_ESCALATION',
    'BOZZA',
    'CONCLUSE',
  ]);
  expect(tabs.find((t) => t.value === 'ATTESA_FIRMA')?.count).toBe(5);
});

it('tabAttivo riconosce ATTESA_FIRMA', () => {
  expect(tabAttivo('ATTESA_FIRMA')).toBe('ATTESA_FIRMA');
});
```

⚠️ Il test **già esistente** in `tabs.test.ts` che confronta i valori dei tab con `opzioniStatoAdmin()` diventerà rosso da solo appena aggiungi `ATTESA_FIRMA` ai tab senza aggiungere l'`<option>`. **È il punto:** guardalo diventare rosso prima di sistemarlo. Se aggiri quel test, il tab funzionerà finché non tocchi un altro filtro, poi sparirà **senza errori**.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter piattaforma test src/lib/pratiche/stati.test.ts src/lib/pratiche/tabs.test.ts`
Expected: FAIL — `whereTabPratiche is not a function`, e `tabsPraticheAdmin` con 2 argomenti non compila.

- [ ] **Step 3: Implementare il filtro in `stati.ts`**

```ts
// modificare l'import in testa
import type { PraticaStato, Prisma } from '@pv/db';

// aggiungere in fondo al file
/**
 * Il criterio del tab "In attesa di firma": lavorata dall'agenzia, non ferma
 * per una segnalazione, in attesa della sola firma del cliente.
 *
 * `flagSegnalata` basta da solo: sul write path, una PROCESSATA con
 * `flagSegnalata = true` ha sempre `segnalazioneStato = 'RICEVUTA'` (la conferma
 * porta ad ANNULLATA, il respingimento rimette flagSegnalata a false).
 */
export const WHERE_ATTESA_FIRMA = {
  stato: 'PROCESSATA',
  flagSegnalata: false,
} as const satisfies Prisma.PraticaWhereInput;

/**
 * Filtro Prisma di un tab. Superset di `whereStato`: i tab il cui criterio è il
 * solo stato delegano a lei; ATTESA_FIRMA aggiunge la condizione sulla
 * segnalazione, che `whereStato` non sa esprimere (filtra solo `stato`).
 *
 * Senza questa funzione, `whereStato('ATTESA_FIRMA')` tornerebbe `undefined` =
 * NESSUN filtro: il tab mostrerebbe tutte le pratiche, in silenzio.
 */
export function whereTabPratiche(
  param: string | undefined,
  ammessi: readonly PraticaStato[] = SINGOLI,
): Prisma.PraticaWhereInput {
  if (param === 'ATTESA_FIRMA') return { ...WHERE_ATTESA_FIRMA };
  const stato = whereStato(param, ammessi);
  return stato ? { stato } : {};
}
```

- [ ] **Step 4: Estendere i tab in `tabs.ts`**

Tre punti, **tutti e tre obbligatori**:

```ts
// 1. ValoreTab (riga 9)
export type ValoreTab =
  | ''
  | 'IN_CORSO'
  | 'ATTESA_FIRMA'
  | 'IN_ESCALATION'
  | 'BOZZA'
  | 'CONCLUSE';

// 2. tabsPraticheAdmin (riga 42) — nuova firma: il conteggio NON si ricava da
//    ConteggiTab (che riduce un groupBy per stato e non sa nulla della
//    segnalazione), quindi arriva dal chiamante. TypeScript lo rende obbligatorio.
/**
 * Tab della lista admin.
 *
 * `escalation` e `attesaFirma` sono SOTTOINSIEMI di `inCorso`: i tab si
 * sovrappongono di proposito — cliccando "In corso" vedi anche quelle.
 *
 * @param attesaFirma conteggio delle PROCESSATA non segnalate. Non deriva da
 *   `conteggi` perché il criterio non è solo lo stato: lo calcola il chiamante
 *   con un count su WHERE_ATTESA_FIRMA.
 */
export function tabsPraticheAdmin(
  conteggi: ConteggiTab,
  attesaFirma: number,
): TabPratiche[] {
  return [
    { value: '', label: 'Tutte', count: conteggi.tutte },
    { value: 'IN_CORSO', label: 'In corso', count: conteggi.inCorso },
    { value: 'ATTESA_FIRMA', label: 'In attesa di firma', count: attesaFirma },
    { value: 'IN_ESCALATION', label: 'In escalation', count: conteggi.escalation },
    { value: 'BOZZA', label: 'Bozze', count: conteggi.bozze },
    { value: 'CONCLUSE', label: 'Concluse', count: conteggi.concluse },
  ];
}

// 3. tabAttivo (riga 57)
export function tabAttivo(stato: string | undefined): ValoreTab | null {
  if (!stato) return '';
  if (
    stato === 'IN_CORSO' ||
    stato === 'ATTESA_FIRMA' ||
    stato === 'IN_ESCALATION' ||
    stato === 'BOZZA' ||
    stato === 'CONCLUSE'
  ) {
    return stato;
  }
  return null;
}
```

- [ ] **Step 5: Aggiungere l'`<option>` in `opzioniStatoAdmin()` — è l'invariante**

`tabs.ts:123`, subito dopo `CONCLUSE`:

```ts
    { value: 'ATTESA_FIRMA', label: 'In attesa di firma' },
```

Senza questa riga, il `defaultValue` della select non combacia col tab cliccato, il browser seleziona "Tutti gli stati" e il form ad auto-submit rimanda `stato=""` al primo tocco di un altro filtro: **il tab sparisce senza errori**. È l'invariante documentata a `tabs.ts:110-121` e blindata dal test.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter piattaforma test src/lib/pratiche/`
Expected: PASS — inclusa l'invariante tab↔select.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche/stati.ts apps/piattaforma/src/lib/pratiche/tabs.ts apps/piattaforma/src/lib/pratiche/stati.test.ts apps/piattaforma/src/lib/pratiche/tabs.test.ts
git commit -m "feat(admin,pratiche): tab In attesa di firma (processate non segnalate)"
```

---

### Task 7: La pagina `/admin/pratiche`

Wiring del tab, ordinamento per anzianità, colonna "In attesa da" e recapiti per il sollecito. **La grid condivisa `PRATICHE_GRID.admin` non si tocca**: stesso numero di colonne, cambia solo il contenuto di due celle quando il tab è attivo.

**Files:**
- Modify: `apps/piattaforma/src/app/admin/pratiche/page.tsx`

**Interfaces:**
- Consumes: `whereTabPratiche`, `WHERE_ATTESA_FIRMA` (Task 6), `tabsPraticheAdmin(conteggi, attesaFirma)` (Task 6), `giorniTrascorsi`, `attesaLevel` (Task 5)

- [ ] **Step 1: Sostituire il filtro stato con il filtro tab**

Righe 68-76. `whereStato` ritorna un valore per il campo `stato`; `whereTabPratiche` ritorna un `WhereInput` da fondere.

```ts
// PRIMA
const filtroStato = whereStato(sp.stato, SINGOLI_ADMIN);
const whereBase: Prisma.PraticaWhereInput = { ...where };
if (filtroStato !== undefined) where.stato = filtroStato;

// DOPO
// `whereTabPratiche` (non `whereStato`): il tab "In attesa di firma" filtra
// anche sulla segnalazione, che `whereStato` non sa esprimere.
const filtroTab = whereTabPratiche(sp.stato, SINGOLI_ADMIN);
// I conteggi dei tab usano gli STESSI filtri della lista MENO lo stato: il
// numero sul tab è esattamente quello che ottieni cliccandolo.
const whereBase: Prisma.PraticaWhereInput = { ...where };
Object.assign(where, filtroTab);
```

Aggiornare gli import (riga 13):

```ts
import { whereTabPratiche, WHERE_ATTESA_FIRMA, SINGOLI_ADMIN, contaGruppi } from '@/lib/pratiche/stati';
import { giorniTrascorsi, attesaLevel } from '@/lib/pratiche/countdown';
```

- [ ] **Step 2: Aggiungere il flag di tab, l'ordinamento e i campi che servono**

Prima del `Promise.all`:

```ts
const isTabAttesaFirma = sp.stato === 'ATTESA_FIRMA';

// In attesa di firma: le più marce in cima (processataAt crescente). Negli
// altri tab resta l'ordine cronologico inverso di invio.
const orderBy: Prisma.PraticaOrderByWithRelationInput[] = isTabAttesaFirma
  ? [{ processataAt: { sort: 'asc', nulls: 'last' } }]
  : [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
```

Nel `findMany`, sostituire `orderBy: [...]` con `orderBy`, e ampliare l'`include` per i recapiti:

```ts
      include: {
        broker: { select: { ragioneSociale: true, telefono: true } },
        agenziaAssegnata: { select: { ragioneSociale: true, telefono: true } },
        agenziaSede: { select: { nome: true, citta: true, telefono: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
```

- [ ] **Step 3: Aggiungere il conteggio del tab al `Promise.all`**

```ts
  const [pratiche, total, gruppi, attesaFirmaCount] = await Promise.all([
    prisma.pratica.findMany({ /* … */ }),
    prisma.pratica.count({ where }),
    prisma.pratica.groupBy({ by: ['stato'], where: whereBase, _count: { _all: true } }),
    // Il conteggio del tab "In attesa di firma" non deriva dal groupBy per
    // stato: il criterio include la segnalazione. Stessi filtri della lista
    // MENO lo stato (whereBase), come gli altri badge.
    prisma.pratica.count({ where: { ...whereBase, ...WHERE_ATTESA_FIRMA } }),
  ]);

  const conteggi = contaGruppi(gruppi);
  const tabs = tabsPraticheAdmin(conteggi, attesaFirmaCount);
```

- [ ] **Step 4: Colonna "Quando" → "In attesa da" nel tab**

Header, riga 151:

```tsx
<div className="py-3 pl-3 pr-5 text-right">
  {isTabAttesaFirma ? 'In attesa da' : 'Quando'}
</div>
```

Cella, righe 196-198. Serve un `now` stabile calcolato **una volta** prima del `map` (altrimenti ogni riga usa un istante diverso):

```tsx
// prima del return, insieme agli altri calcoli:
const now = new Date();
```

```tsx
<div className="min-w-0 truncate py-3 pl-3 pr-5 text-right text-pv-slate-500">
  {isTabAttesaFirma ? <AttesaCell from={p.processataAt} now={now} /> : formatRelative(p.submittedAt ?? p.createdAt)}
</div>
```

E in fondo al file, un componente locale (server, nessun `'use client'`):

```tsx
/** Da quanto la pratica aspetta la firma. Più tempo passa, più è grave. */
function AttesaCell({ from, now }: { from: Date | null; now: Date }) {
  const giorni = giorniTrascorsi(from, now);
  if (giorni === null) return <span>—</span>;
  const level = attesaLevel(giorni);
  // Stesse coppie di StatusChip. NON usare -600/-700 su amber/red né slate-600:
  // quelle tonalità non esistono in globals.css e non colorano nulla.
  const tone =
    level === 'urgent'
      ? 'bg-pv-red-50 text-pv-red-500'
      : level === 'warn'
        ? 'bg-pv-amber-50 text-pv-amber-500'
        : 'bg-pv-slate-100 text-pv-slate-700';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold ${tone}`}>
      {giorni === 0 ? 'oggi' : `${giorni} g`}
    </span>
  );
}
```

- [ ] **Step 5: Recapiti nelle celle Broker e Agenzia (solo in questo tab)**

Righe 179-187. **Testo semplice, NON link**: la riga è già un `<a>` a tutta riga (riga 161-165) e un `<a href="tel:">` annidato è HTML invalido. I recapiti cliccabili stanno nel dettaglio.

```tsx
<div className="hidden min-w-0 px-3 py-3 text-pv-slate-700 md:block">
  <div className="truncate">{p.broker.ragioneSociale}</div>
  {isTabAttesaFirma && p.broker.telefono && (
    <div className="truncate font-mono text-[11px] text-pv-slate-500">{p.broker.telefono}</div>
  )}
</div>
<div className="hidden min-w-0 px-3 py-3 text-pv-slate-700 md:block">
  <div className="truncate">{p.agenziaAssegnata?.ragioneSociale ?? '—'}</div>
  {isTabAttesaFirma && (p.agenziaSede?.telefono ?? p.agenziaAssegnata?.telefono) && (
    <div className="truncate font-mono text-[11px] text-pv-slate-500">
      {p.agenziaSede?.telefono ?? p.agenziaAssegnata?.telefono}
    </div>
  )}
</div>
```

Il telefono della **sede** ha la precedenza su quello della madre: è la sede che lavora la pratica, ed è chi va chiamato.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 7: Verifica sul DB locale, prima di guardare la UI**

La query del tab, in read-only, sul postgres locale (copia di prod):

```bash
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c \
  "SELECT \"codicePratica\", \"processataAt\", \"flagSegnalata\" FROM pratiche WHERE stato='PROCESSATA' AND \"deletedAt\" IS NULL ORDER BY \"processataAt\" ASC NULLS LAST LIMIT 20;"
```

Confronta il numero di righe con `flagSegnalata = false` col badge che vedrai sul tab: devono coincidere.

- [ ] **Step 8: Verifica nel browser, cliccando davvero**

`pnpm --filter piattaforma dev`, login come admin, `/admin/pratiche`.

- **Clicca** il tab "In attesa di firma" (non navigare per URL: la soft-nav di Next è un'altra cosa dal click).
- Il badge combacia col numero di righe.
- Le pratiche più vecchie sono in cima; le colonne mostrano i giorni con il chip colorato.
- **Poi cambia un altro filtro** (es. la sede) e verifica che il tab **resti selezionato**: è il test dell'invariante tab↔select. Se il tab si spegne, hai saltato lo Step 5 del Task 6.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/admin/pratiche/page.tsx
git commit -m "feat(admin,pratiche): tab attesa firma con anzianita' e recapiti per il sollecito"
```

---

### Task 8: Migration `firmaForzata*` e refactor del motore della firma

`firmaPraticaCore` mescola i gate del percorso agenzia e il motore degli effetti (transazione + fattura + email + payout, ~340 righe). Per far attestare la firma all'admin **non si duplica nulla**: si parametrizza l'attore.

**Files:**
- Create: `packages/db/prisma/migrations/20260713110000_pratica_firma_forzata/migration.sql`
- Create: `apps/piattaforma/src/lib/pratiche/firma-engine.ts` (il motore, **spostato** da `actions.ts`)
- Modify: `packages/db/prisma/schema.prisma` (model `Pratica`, sezione Timeline, righe ~804-836)
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts:264-618` (restano i soli wrapper)

**Interfaces:**
- Consumes: `motivoBloccoFirma`, `PraticaFirmabile` (Task 4)
- Produces: `export async function firmaPraticaCore(praticaId: string, attore: AttoreFirma): Promise<QuickActionResult>` e `export type AttoreFirma`, entrambi da `lib/pratiche/firma-engine.ts`

**Perché un modulo nuovo e non `actions.ts`:** in un file `'use server'` **ogni export è un endpoint HTTP**. Il motore deve essere importabile sia dalle action dell'agenzia sia da quelle dell'admin: esportarlo da un file `'use server'` lo esporrebbe come endpoint invocabile dal client. `firma-engine.ts` è un modulo normale (niente `'use server'`), quindi resta interno.

- [ ] **Step 1: Scrivere la migration a mano**

`packages/db/prisma/migrations/20260713110000_pratica_firma_forzata/migration.sql`:

```sql
-- Attestazione della firma da parte del Gestore (Termini, art. 11).
-- Non esiste un audit log di azioni in piattaforma: si usa il pattern gia' in
-- casa (colonna ...DaId + ...At + nota), come per segnalazioneEsitaDaId.
ALTER TABLE "pratiche" ADD COLUMN "firmaForzataDaId" UUID;
ALTER TABLE "pratiche" ADD COLUMN "firmaForzataAt" TIMESTAMP(3);
ALTER TABLE "pratiche" ADD COLUMN "firmaForzataMotivo" TEXT;
```

⚠️ Verifica il nome reale della tabella (`@@map` del model `Pratica`) prima di eseguire.

- [ ] **Step 2: Aggiornare lo schema Prisma**

In `model Pratica`, nella sezione Timeline vicino a `firmaAvvenutaAt`:

```prisma
  /** Attestazione admin (Termini art. 11): chi, quando, perché. NULL = firma
   *  segnalata normalmente dall'agenzia. */
  firmaForzataDaId   String?   @db.Uuid
  firmaForzataAt     DateTime?
  firmaForzataMotivo String?
```

- [ ] **Step 3: Applicare e verificare**

```bash
pnpm --filter @pv/db db:deploy
pnpm db:generate
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c "\d pratiche" | grep firmaForzata
```

Expected: tre righe. Se non stampa nulla, non proseguire.

- [ ] **Step 4: Spostare il motore in `firma-engine.ts` e parametrizzarlo sull'attore**

Taglia l'**intera** `firmaPraticaCore` (righe 264-602 di `actions.ts`) e incollala in `apps/piattaforma/src/lib/pratiche/firma-engine.ts`, portandoti dietro gli import che usa (`prisma`, `auth`, `redirect`, `requirePermesso`, `isAgenziaBloccata`, `sedeScopeCorrente`, `assertSedeInScope`, `accreditCommissioniAffiliazione`, `createFatturaPv`, `sendNotification`, `destinatariBroker`, `emitEventoPratica`, `eventoPraticaFirmata`, `fatturaPvAttachment`, `notifyClientiAvanzamento`, `notifyAffiliationPostFirma`, `autoPayoutBrokerDopoFirma`, `onPraticaFirmata`, `revalidatePath`, `env`, i tipi `QuickActionResult` e `AccreditoEseguito`).

Il file **non** ha la direttiva `'use server'`.

Poi sostituisci la firma e i gate (le prime ~50 righe), **lasciando intatto tutto il resto del corpo**:

```ts
import { motivoBloccoFirma } from '@/lib/pratiche/firma-gate';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

/**
 * Chi sta firmando. Il MOTORE degli effetti (wallet, addebito, fattura,
 * affiliazione, email, payout) è lo stesso per entrambi: duplicarlo
 * significherebbe, prima o poi, una fattura che non parte o un payout che non
 * scatta. Cambiano solo i gate e ciò che si scrive in più.
 */
export type AttoreFirma =
  | { tipo: 'AGENZIA' }
  | { tipo: 'ADMIN'; userId: string; motivo: string };

export async function firmaPraticaCore(
  praticaId: string,
  attore: AttoreFirma,
): Promise<QuickActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Gate specifici del percorso AGENZIA. Non sono comuni: l'admin non ha
  // companyId, non ha permessi azienda e non ha scope sede.
  let agenziaSessione: string | null = null;
  let scope: Awaited<ReturnType<typeof sedeScopeCorrente>> | null = null;

  if (attore.tipo === 'AGENZIA') {
    const gate = await requirePermesso('pratiche.firma');
    if (!gate.ok) return gate;
    if (session.user.companyType !== 'AGENZIA') redirect('/dashboard');
    agenziaSessione = session.user.companyId!;
    if (await isAgenziaBloccata(agenziaSessione)) redirect('/blocco-pagamento');
    scope = await sedeScopeCorrente();
  } else {
    // Attestazione admin (Termini art. 11). ASSISTENTE escluso: l'azione muove
    // denaro (addebito all'agenzia, credito al broker, fattura, payout).
    if (!isAdminPiattaforma(session.user.role)) redirect('/dashboard');
    if (!attore.motivo.trim()) {
      return { ok: false, error: 'La motivazione è obbligatoria' };
    }
  }

  let accreditiResult: AccreditoEseguito[] = [];
  let feeAgenziaCentFattura = 0;
  // L'agenzia da addebitare/fatturare: sempre quella ASSEGNATA alla pratica,
  // non quella in sessione (l'admin non ne ha una).
  let agenziaIdEffettivo = '';

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: {
          /* … include invariato … */
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');

      // Gate COMUNI ai due percorsi (stato, segnalazione, agenzia assegnata).
      const blocco = motivoBloccoFirma({
        stato: pratica.stato,
        flagSegnalata: pratica.flagSegnalata,
        agenziaAssegnataId: pratica.agenziaAssegnataId,
      });
      if (blocco) throw new Error(blocco);

      if (attore.tipo === 'AGENZIA') {
        if (pratica.agenziaAssegnataId !== agenziaSessione) {
          throw new Error('Pratica non assegnata a questa agenzia');
        }
        assertSedeInScope(pratica, agenziaSessione!, scope!);
      }

      agenziaIdEffettivo = pratica.agenziaAssegnataId!; // garantito da motivoBloccoFirma

      const now = new Date();
      const autoAddebitoAt = now;
      feeAgenziaCentFattura = pratica.feeAgenziaCent;

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'FIRMATA',
          firmaAvvenutaAt: now,
          autoAddebitoAt,
          ...(attore.tipo === 'ADMIN'
            ? {
                firmaForzataDaId: attore.userId,
                firmaForzataAt: now,
                firmaForzataMotivo: attore.motivo.trim().slice(0, 500),
              }
            : {}),
        },
      });

      /* … TUTTO il resto del corpo della transazione resta identico … */
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  /* … tutto il post-commit resta identico … */
}
```

**Sostituzioni obbligatorie nel resto del corpo** (dove prima si usava `agenziaId` dalla sessione):
- riga ~359, nel `tx.feeAddebito.create`: `agenziaId` → `agenziaId: agenziaIdEffettivo`
- riga ~399, in `createFatturaPv({ … })`: `agenziaId` → `agenziaId: agenziaIdEffettivo`

Verifica con `grep -n "agenziaId" apps/piattaforma/src/app/pratiche/actions.ts` che non resti nessun uso della variabile vecchia.

- [ ] **Step 5: Aggiornare i due wrapper esistenti dell'agenzia**

In `app/pratiche/actions.ts` (dove prima stava il core) restano **solo** i wrapper, che ora importano il motore:

```ts
import { firmaPraticaCore } from '@/lib/pratiche/firma-engine';

/** Wrapper per il DETTAGLIO pratica (form action): redirect + toast come prima. */
export async function markFirmaAvvenutaAction(praticaId: string): Promise<void> {
  const res = await firmaPraticaCore(praticaId, { tipo: 'AGENZIA' });
  if (!res.ok) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/pratiche/${praticaId}?firmata=1`);
}

/** Wrapper per la LISTA pratiche: NON naviga, ritorna l'esito (toast lato client). */
export async function firmaFromListaAction(praticaId: string): Promise<QuickActionResult> {
  return firmaPraticaCore(praticaId, { tipo: 'AGENZIA' });
}
```

- [ ] **Step 6: Typecheck e test**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test src/lib/pratiche/
```

Expected: nessun errore, test verdi.

- [ ] **Step 7: Verificare che il gate nuovo morda davvero (percorso agenzia)**

Sul DB locale, prendi una pratica `PROCESSATA` e segnalala (o forza `flagSegnalata = true` con una UPDATE su una pratica di test), poi prova a firmarla dal dettaglio come agenzia assegnata: deve comparire l'errore "Pratica con segnalazione in verifica…". Prima di questa modifica, la firma passava.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma apps/piattaforma/src/app/pratiche/actions.ts
git commit -m "refactor(pratiche): motore firma parametrico sull'attore + gate segnalazione"
```

---

### Task 9: La server action di attestazione admin

**Files:**
- Create: `apps/piattaforma/src/app/admin/pratiche/actions.ts`

**Interfaces:**
- Consumes: `firmaPraticaCore(praticaId, attore)` e `AttoreFirma` da `lib/pratiche/firma-engine.ts` (Task 8)
- Produces: `attestaFirmaAdminAction(praticaId: string, motivo: string): Promise<QuickActionResult>`

- [ ] **Step 1: Scrivere la server action admin**

`apps/piattaforma/src/app/admin/pratiche/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { firmaPraticaCore } from '@/lib/pratiche/firma-engine';
import type { QuickActionResult } from '@/lib/pratiche/quick-action';

/**
 * Attestazione della firma da parte del Gestore (Termini, art. 11).
 *
 * Produce ESATTAMENTE gli stessi effetti della firma segnalata dall'agenzia —
 * addebito, fattura, credito al broker, payout — perché usa lo stesso motore.
 * Cambia solo l'attore, e che restiamo tracciati: chi, quando, perché.
 *
 * Riservata ad ADMIN_PIATTAFORMA: l'ASSISTENTE non ha leve finanziarie.
 */
export async function attestaFirmaAdminAction(
  praticaId: string,
  motivo: string,
): Promise<QuickActionResult> {
  const session = await auth();
  if (!isAdminPiattaforma(session?.user?.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  if (!motivo.trim()) {
    return { ok: false, error: 'La motivazione è obbligatoria' };
  }

  const res = await firmaPraticaCore(praticaId, {
    tipo: 'ADMIN',
    userId: session!.user.id,
    motivo,
  });
  if (!res.ok) return res;

  revalidatePath('/admin/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}
```

⚠️ Verifica il path reale del tipo `QuickActionResult` (`grep -rn "QuickActionResult" apps/piattaforma/src`) e importalo da lì: non inventare il modulo.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/admin/pratiche/actions.ts
git commit -m "feat(admin,pratiche): server action di attestazione firma (solo ADMIN)"
```

---

### Task 10: Il popup di conferma nel dettaglio pratica

Il modale non chiede "sei sicuro?" a vuoto: mostra **gli importi reali di quella pratica** e pretende una motivazione scritta.

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/[id]/attesta-firma-button.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (header azioni, righe 346-360; `canFirma`, righe 238-242; timeline, righe ~865-904)

**Interfaces:**
- Consumes: `attestaFirmaAdminAction` (Task 9), `Modal`, `Button`, `Alert`, `LoadingOverlay` dal design system

- [ ] **Step 1: Scrivere il componente client**

`apps/piattaforma/src/app/pratiche/[id]/attesta-firma-button.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { formatCurrencyCent } from '@/lib/format';
import { attestaFirmaAdminAction } from '@/app/admin/pratiche/actions';

/**
 * Attestazione della firma da parte del Gestore (Termini, art. 11).
 *
 * Il modale elenca gli EFFETTI ECONOMICI REALI di questa pratica, con gli
 * importi presi dal record: chi preme deve vedere quanti soldi muove, non un
 * generico "sei sicuro?". La motivazione è obbligatoria — è la nostra prova.
 */
export function AttestaFirmaButton({
  praticaId,
  feeAgenziaCent,
  creditoBrokerCent,
  nomeAgenzia,
  nomeBroker,
}: {
  praticaId: string;
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  nomeAgenzia: string;
  nomeBroker: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleConferma = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await attestaFirmaAdminAction(praticaId, motivo);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Attesta firma avvenuta
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Attestare la firma al posto dell'agenzia?"
        description="La pratica si perfeziona immediatamente e produce tutti gli effetti economici. Operazione non reversibile."
        size="md"
      >
        <div className="space-y-4">
          <Alert variant="warning" title="Cosa succede quando confermi">
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px]">
              <li>
                Addebito di <strong>{formatCurrencyCent(feeAgenziaCent)}</strong> a{' '}
                <strong>{nomeAgenzia}</strong>
              </li>
              <li>
                Accredito di <strong>{formatCurrencyCent(creditoBrokerCent)}</strong> sul wallet
                di <strong>{nomeBroker}</strong>
              </li>
              <li>Emissione della fattura verso l&apos;agenzia</li>
              <li>Sblocco del payout automatico al broker</li>
            </ul>
          </Alert>

          <label className="block">
            <span className="text-[12px] font-semibold text-pv-slate-700">
              Motivazione (obbligatoria, max 500 caratteri)
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Es. Firma confermata telefonicamente da Rossi (agenzia) il 13/07; copia dell'atto ricevuta via email."
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
            <span className="mt-1 block text-[11px] text-pv-slate-500">
              Resta registrata insieme al tuo nome e alla data. Non viene mostrata a broker e
              agenzia, che vedranno solo che la firma è stata attestata dal team.
            </span>
          </label>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConferma}
              disabled={pending || !motivo.trim()}
              loading={pending}
              loadingLabel="Attesto…"
            >
              Conferma attestazione
            </Button>
          </div>
        </div>
        <LoadingOverlay show={pending} label="Attestazione in corso…" />
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Allineare `canFirma` al nuovo gate server (percorso agenzia)**

`page.tsx`, righe 238-242. Il server è la difesa vera, ma la UI non deve offrire un bottone che fallirà:

```tsx
  const canFirma =
    canFirmaPermesso &&
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    pratica.stato === 'PROCESSATA' &&
    // Una segnalazione in verifica blocca la firma (il guard in
    // firmaPraticaCore resta la difesa vera).
    !pratica.flagSegnalata;
```

- [ ] **Step 3: Montare il bottone nell'header azioni**

`page.tsx`, dentro il `<div className="flex flex-wrap items-center gap-y-2">` (riga 346):

```tsx
{isAdminPiattaforma(session.user.role) &&
  pratica.stato === 'PROCESSATA' &&
  !pratica.flagSegnalata &&
  pratica.agenziaAssegnata && (
    <AttestaFirmaButton
      praticaId={pratica.id}
      feeAgenziaCent={pratica.feeAgenziaCent}
      creditoBrokerCent={pratica.creditoBrokerCent}
      nomeAgenzia={pratica.agenziaAssegnata.ragioneSociale}
      nomeBroker={pratica.broker.ragioneSociale}
    />
  )}
```

Import: `import { isAdminPiattaforma } from '@/lib/auth/permissions';` e `import { AttestaFirmaButton } from './attesta-firma-button';`.

⚠️ `isStaff` (già presente nel file) include l'`ASSISTENTE`: **non usarlo qui**. Serve `isAdminPiattaforma`.

- [ ] **Step 4: Mostrare l'attestazione nella timeline, a tutti**

Nella timeline (righe ~865-904), accanto alla riga della firma, quando `pratica.firmaForzataAt` è valorizzato:

```tsx
{pratica.firmaForzataAt && (
  <p className="text-[12px] text-pv-slate-500">
    Firma attestata dal team Passaggio Veloce il {formatDate(pratica.firmaForzataAt)}
  </p>
)}
```

Visibile a broker e agenzia: la trasparenza è ciò che rende difendibile la clausola 11. **La motivazione no** — quella resta interna. Se vuoi mostrarla all'admin, avvolgila in `isStaff && …` come blocco separato.

- [ ] **Step 5: Verifica end-to-end nel browser**

Con `pnpm --filter piattaforma dev`:

1. Come **admin**, apri una pratica `PROCESSATA` dal tab "In attesa di firma". Il bottone "Attesta firma avvenuta" c'è.
2. Cliccalo: il modale mostra gli **importi reali** di quella pratica (confrontali col record). Il bottone di conferma è **disabilitato** finché la textarea è vuota.
3. Scrivi una motivazione e conferma. La pratica passa a `FIRMATA`.
4. Verifica sul DB che gli effetti siano tutti scattati:

```bash
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c \
  "SELECT p.\"codicePratica\", p.stato, p.\"firmaForzataAt\", p.\"firmaForzataMotivo\",
          (SELECT count(*) FROM fee_addebiti f WHERE f.\"praticaId\"=p.id) AS addebiti,
          (SELECT count(*) FROM transazioni_wallet t WHERE t.\"praticaId\"=p.id) AS transazioni,
          (SELECT count(*) FROM documenti_fiscali d WHERE d.\"praticaId\"=p.id) AS fatture
   FROM pratiche p WHERE p.id='<ID>';"
```

Expected: `stato = FIRMATA`, `firmaForzataAt` e motivo valorizzati, **addebiti ≥ 1, transazioni ≥ 1, fatture ≥ 1**. Se una di queste è 0, il refactor del Task 8 ha perso un effetto — è il bug più costoso possibile, fermati e indaga.

⚠️ Verifica i nomi reali delle tabelle (`fee_addebiti`, `transazioni_wallet`, `documenti_fiscali`) in `schema.prisma` prima di eseguire la query.

5. Come **assistente**, apri la stessa vista: il bottone **non deve esserci**.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/\[id\]/
git commit -m "feat(admin,pratiche): modale di attestazione firma con effetti economici e motivazione"
```

---

### Task 11: Le email dicono la verità

La N4 oggi scrive letteralmente **"*Nome agenzia* ha confermato la firma"**. Se la firma l'abbiamo attestata noi, quella frase è **falsa**. Non basta aggiungere una riga: va sostituita.

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (tipi righe 35-61, `tplN4BrokerFirma:310`, `tplN8AgenziaAddebito:362`)
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts` (payload N4/N8 nel post-commit)
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts` (crealo se non esiste)

**Interfaces:**
- Consumes: `firmaForzataAt` sulla Pratica (Task 8)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { tplN4BrokerFirma, tplN8AgenziaAddebito } from './templates';

const n4 = {
  codicePratica: 'PV-001',
  targa: 'AB123CD',
  agenziaNome: 'Agenzia Rossi',
  creditoCent: 5000,
  saldoCent: 12000,
  nomeBroker: 'Mario',
};

describe('N4 — firma attestata dal Gestore', () => {
  it('firma normale: dice che l’agenzia ha confermato', () => {
    const out = tplN4BrokerFirma(n4);
    expect(out.text).toContain('Agenzia Rossi ha confermato la firma');
    expect(out.text).not.toContain('team Passaggio Veloce');
  });

  it('firma attestata: NON dice che l’agenzia ha confermato (sarebbe falso)', () => {
    const out = tplN4BrokerFirma({ ...n4, attestataDaPv: true });
    expect(out.text).not.toContain('Agenzia Rossi ha confermato');
    expect(out.text).toContain('team Passaggio Veloce');
    expect(out.html).toContain('team Passaggio Veloce');
  });

  it('firma attestata: non espone la motivazione interna', () => {
    const out = tplN4BrokerFirma({ ...n4, attestataDaPv: true });
    expect(out.text).not.toContain('motivo');
  });
});

describe('N8 — addebito con firma attestata', () => {
  const n8 = {
    codicePratica: 'PV-001',
    feeCent: 3000,
    autoAddebitoAt: new Date('2026-07-13T10:00:00Z'),
    nomeAgenzia: 'Agenzia Rossi',
  };

  it('firma normale: nessuna menzione dell’attestazione', () => {
    expect(tplN8AgenziaAddebito(n8).text).not.toContain('team Passaggio Veloce');
  });

  it('firma attestata: l’agenzia viene informata di chi ha registrato la firma', () => {
    const out = tplN8AgenziaAddebito({ ...n8, attestataDaPv: true });
    expect(out.text).toContain('team Passaggio Veloce');
    expect(out.html).toContain('team Passaggio Veloce');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma test src/lib/notifiche/templates.test.ts`
Expected: FAIL — il test "firma attestata" trova ancora "Agenzia Rossi ha confermato".

- [ ] **Step 3: Estendere i payload (campo opzionale, retrocompatibile)**

`templates.ts`, righe 35-61:

```ts
export type N4BrokerFirmaPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  creditoCent: number;
  saldoCent: number;
  nomeBroker: string;
  /** Firma attestata dal Gestore (Termini art. 11), non segnalata dall'agenzia. */
  attestataDaPv?: boolean;
};

export type N8AgenziaAddebitoPayload = {
  codicePratica: string;
  feeCent: number;
  autoAddebitoAt: Date;
  nomeAgenzia: string;
  /** Firma attestata dal Gestore (Termini art. 11), non segnalata dall'agenzia. */
  attestataDaPv?: boolean;
};
```

- [ ] **Step 4: Correggere la N4 (`tplN4BrokerFirma`, riga 310)**

La frase sull'agenzia è la parte da rendere condizionale — non un'aggiunta:

```ts
export function tplN4BrokerFirma(p: N4BrokerFirmaPayload): NotificaContent {
  const subject = `Firma avvenuta — pratica ${p.codicePratica} · +${formatCurrencyCent(p.creditoCent)}`;
  // Se la firma l'abbiamo attestata noi, dire che "l'agenzia ha confermato" è
  // falso: la frase va sostituita, non integrata.
  const chiHaConfermatoText = p.attestataDaPv
    ? `Il team Passaggio Veloce ha registrato la firma della pratica ${p.codicePratica}, avendone avuto conferma.`
    : `${p.agenziaNome} ha confermato la firma della pratica ${p.codicePratica}.`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `${chiHaConfermatoText} ` +
    `Abbiamo accreditato ${formatCurrencyCent(p.creditoCent)} al tuo wallet. ` +
    `Saldo: ${formatCurrencyCent(p.saldoCent)}.`;
  const chiHaConfermatoHtml = p.attestataDaPv
    ? `Il <strong>team Passaggio Veloce</strong> ha registrato la firma della pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}, avendone avuto conferma.`
    : `<strong>${p.agenziaNome}</strong> ha confermato la firma della pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Firma confermata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">${chiHaConfermatoHtml}</p>
    <div style="background:#ecfdf5;border:1px solid #16a34a33;border-radius:10px;padding:14px;font-size:14px;color:#0a2540">
      <strong style="color:#16a34a">+${formatCurrencyCent(p.creditoCent)}</strong> accreditati sul tuo wallet.<br>
      Saldo attuale: <strong>${formatCurrencyCent(p.saldoCent)}</strong>
    </div>
  `);
  return { subject, html, text };
}
```

- [ ] **Step 5: Aggiungere la riga alla N8 (`tplN8AgenziaAddebito`, riga 362)**

Qui è un'aggiunta: l'agenzia si vede addebitare una fee per una firma che non ha segnato lei, e deve sapere perché.

```ts
  const attestazioneText = p.attestataDaPv
    ? `\nLa firma è stata registrata dal team Passaggio Veloce sulla base delle informazioni in nostro possesso (v. clausola 11 dei Termini). Se ritieni che si tratti di un errore, puoi contestarlo entro 15 giorni scrivendo all'assistenza.`
    : '';
  // …aggiungere `attestazioneText` in coda a `text`

  const attestazioneHtml = p.attestataDaPv
    ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">La firma è stata registrata dal <strong>team Passaggio Veloce</strong> sulla base delle informazioni in nostro possesso (v. clausola 11 dei Termini). Se ritieni che si tratti di un errore, puoi contestarlo entro 15 giorni scrivendo all&apos;assistenza.</p>`
    : '';
  // …aggiungere `attestazioneHtml` in coda al blocco passato a wrap()
```

- [ ] **Step 6: Passare il flag dal motore della firma**

In `lib/pratiche/firma-engine.ts`, nel post-commit: la `findUnique` (riga ~409) rilegge la pratica **dopo** il commit, quindi `full.firmaForzataAt` è già valorizzato. Nessun flag da propagare a mano:

```ts
// payload N4 (riga ~456)
          payload: {
            /* … campi invariati … */
            attestataDaPv: full.firmaForzataAt !== null,
          },

// payload N8 (riga ~505)
            payload: {
              /* … campi invariati … */
              attestataDaPv: full.firmaForzataAt !== null,
            },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter piattaforma test src/lib/notifiche/templates.test.ts`
Expected: PASS (5 test)

- [ ] **Step 8: Verifica end-to-end sulle email reali**

Rifai l'attestazione del Task 10 Step 5 e leggi la riga registrata in `notifiche_inviate`:

```bash
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c \
  "SELECT tipo, destinazione, subject, \"bodyPreview\" FROM notifiche_inviate WHERE payload->>'praticaId' = '<ID>' OR \"praticaId\" = '<ID>' ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Expected: la N4 **non** contiene "ha confermato la firma" riferito all'agenzia; la N8 contiene la menzione del team. Verifica il nome reale della colonna che lega la notifica alla pratica in `schema.prisma`.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/ apps/piattaforma/src/lib/pratiche/firma-engine.ts
git commit -m "feat(notifiche): N4/N8 dichiarano la firma attestata dal team, senza la motivazione"
```

---

## Chiusura

- [ ] **Suite completa verde**

```bash
pnpm --filter piattaforma test
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma lint
```

- [ ] **Le due migration vanno applicate a mano su prod** (Neon `ep-solitary-night`), **prima** che il deploy arrivi: il deploy Vercel parte dal push su `main` e il codice nuovo legge colonne che su prod ancora non esistono.

```bash
# con DATABASE_URL puntato a prod
pnpm --filter @pv/db db:deploy
```

Migration da applicare: `20260713100000_company_clausole_vessatorie`, `20260713110000_pratica_firma_forzata`.

- [ ] **Aggiornare `docs/piano-implementazione.md`** (source of truth di progress e prossimi step).

## Follow-up, fuori da questo piano

Il job `send-solleciti` (`lib/jobs/send-solleciti.ts`, cron 09:00) filtra `stato: 'ACCETTATA'` e **non copre `PROCESSATA`**: le pratiche in attesa di firma non ricevono alcun sollecito automatico. È la ragione per cui oggi il sollecito va fatto a mano. Da valutare a parte.
