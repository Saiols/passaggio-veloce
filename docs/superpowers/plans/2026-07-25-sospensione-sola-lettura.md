# Sospensione account in sola lettura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un utente o un'azienda sospesi conservano la lettura dei propri dati (storico pratiche, wallet, fatture, addebiti) e perdono ogni operazione di scrittura: non creano, non firmano, non prelevano.

**Architecture:** la sola lettura è un'**intersezione del set di permessi** con una whitelist di 14 chiavi di lettura, applicata in `getSessionContext` e valutata da `can()` **prima** dello short-circuit sull'owner. Da lì discendono senza altro lavoro il rifiuto di tutte le server action gated (`requirePermesso`), il redirect delle pagine precluse (`assertPermesso`) e la sparizione delle CTA nelle ~40 pagine che già derivano la loro visibilità da `hasPermesso`. Tre superfici non coperte dall'intersezione si chiudono a mano: le action senza permesso delegabile, il motore payout, tre pagine con form editabili gated su un permesso di lettura.

**Tech Stack:** Next.js 16 App Router (Server Components + server action), Prisma/Postgres, Auth.js v5 (sessione JWT), vitest, Tailwind + design system in `src/components/ui`.

**Spec:** `docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md`

## Global Constraints

- **Nessuna migration.** Tutti i campi usati esistono già: `User.status` (enum `UserStatus`, valore `SUSPENDED`), `User.suspensionLastNote` (`schema.prisma:542`), `Company.suspendedAt`, `Company.suspensionLastNote` (`schema.prisma:411`). Se ti trovi a scrivere SQL, hai sbagliato strada.
- **Node 22.15.0.** Dopo un riavvio la shell torna a Node 16: `nvm use 22.15.0` prima di qualsiasi comando pnpm.
- **Comando test per un singolo file:** `pnpm --filter piattaforma exec vitest run <path-relativo-a-apps/piattaforma>`. Verificato funzionante.
- **Suite completa:** `pnpm --filter piattaforma test`.
- **`pnpm typecheck`** dal root passa solo col `tsbuildinfo` esistente: a cache fredda va in stack overflow con falsi errori Prisma. Non è una regressione tua, non inseguirla.
- **Staff di piattaforma fuori scope.** `ADMIN_PIATTAFORMA`, `ASSISTENTE` e i ruoli CRM non sono toccati da questo piano: hanno `companyId` null, `getSessionContext` esce prima, e le loro autorizzazioni passano da funzioni pure sul ruolo in `permissions.ts`. Il buco su quegli account resta aperto per scelta, spec separata.
- **Nessun colore hardcodato.** Usa i componenti di `src/components/ui` e i token del design system.
- **Il motivo della sospensione è testo libero scritto dall'admin.** Va reso solo come figlio JSX. Mai `dangerouslySetInnerHTML`, in nessun punto di questo piano.
- **`soloLettura` su `PermessiCtx` è OBBLIGATORIO** (`soloLettura: boolean`), e la conversione da `SessionContext` passa da un **unico** adattatore esportato `toPermessiCtx()` in `permessi/guard.ts`.

  Il piano diceva l'opposto («opzionale, per non rompere le fixture di test»). La review del Task 3 ha dimostrato che quel vincolo era sbagliato: esistono **quattro** adattatori verso `PermessiCtx` in produzione, il Task 3 ne aggiornò uno, e poiché il campo era opzionale il compilatore non poteva segnalare i tre mancanti. Conseguenza reale: un titolare (`ADMIN_AZIENDA`) sospeso conservava l'amministrazione completa del modulo team — creare utenti, resettare password, disabilitare, riassegnare permessi — perché il suo set di permessi è vuoto per progetto e quindi l'intersezione non lo fermava. Decisione del committente (2026-07-25): il campo diventa obbligatorio e l'adattatore unico, così il compilatore enumera ogni sito residuo. Le fixture si aggiornano di conseguenza; non è la produzione a doversi adattare ai test.

---

### Task 1: Partizione delle 31 chiavi in lettura e scrittura

**Files:**
- Create: `apps/piattaforma/src/lib/auth/permessi/sola-lettura.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/sola-lettura.test.ts`

**Interfaces:**
- Consumes: `PERMESSI` e il tipo `Permesso` da `./catalogo`
- Produces: `PERMESSI_LETTURA: readonly Permesso[]`, `PERMESSI_SCRITTURA: readonly Permesso[]`, `isLettura(p: Permesso): boolean`, `filtraSoloLettura(permessi: Set<Permesso>): Set<Permesso>`

Le due liste sono **entrambe esplicite**, non una derivata per complemento dall'altra. La ragione è il test dello step 1: se `PERMESSI_SCRITTURA` fosse il complemento, aggiungere una chiave al catalogo senza classificarla la renderebbe automaticamente di scrittura e nessun test diventerebbe rosso. A runtime `isLettura` resta comunque fail-closed (non nella whitelist ⇒ scrittura), così un errore in produzione blocca invece di concedere.

- [ ] **Step 1: Scrivi il test che fallisce**

`apps/piattaforma/src/lib/auth/permessi/sola-lettura.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PERMESSI, type Permesso } from './catalogo';
import {
  PERMESSI_LETTURA,
  PERMESSI_SCRITTURA,
  isLettura,
  filtraSoloLettura,
} from './sola-lettura';

describe('partizione lettura/scrittura', () => {
  it('lettura e scrittura insieme coprono esattamente il catalogo', () => {
    const unione = [...PERMESSI_LETTURA, ...PERMESSI_SCRITTURA].sort();
    expect(
      unione,
      'Hai aggiunto o rimosso una chiave in catalogo.ts senza classificarla in ' +
        'sola-lettura.ts. Decidi se un utente SOSPESO deve conservarla (PERMESSI_LETTURA) ' +
        'o perderla (PERMESSI_SCRITTURA).',
    ).toEqual([...PERMESSI].sort());
  });

  it('nessuna chiave sta in entrambe le liste', () => {
    const lettura = new Set<Permesso>(PERMESSI_LETTURA);
    const doppie = PERMESSI_SCRITTURA.filter((p) => lettura.has(p));
    expect(doppie).toEqual([]);
  });

  it('le chiavi di scrittura note sono classificate come tali', () => {
    expect(isLettura('pratiche.create')).toBe(false);
    expect(isLettura('pratiche.firma')).toBe(false);
    expect(isLettura('wallet.payout')).toBe(false);
    expect(isLettura('team.permessi')).toBe(false);
  });

  it('le chiavi di lettura note sono classificate come tali', () => {
    expect(isLettura('pratiche.view')).toBe(true);
    expect(isLettura('pratiche.download')).toBe(true);
    expect(isLettura('wallet.view')).toBe(true);
    expect(isLettura('fatture.xml')).toBe(true);
  });

  it('una chiave fuori catalogo è trattata come scrittura (fail-closed)', () => {
    expect(isLettura('pratiche.tuttofare' as Permesso)).toBe(false);
  });

  it('filtraSoloLettura tiene le chiavi di lettura e scarta le altre', () => {
    const dato = new Set<Permesso>(['pratiche.view', 'pratiche.create', 'wallet.view', 'wallet.payout']);
    expect([...filtraSoloLettura(dato)].sort()).toEqual(['pratiche.view', 'wallet.view']);
  });

  it('filtraSoloLettura non muta il set in ingresso', () => {
    const dato = new Set<Permesso>(['pratiche.view', 'pratiche.create']);
    filtraSoloLettura(dato);
    expect(dato.has('pratiche.create')).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/sola-lettura.test.ts`
Expected: FAIL — `Failed to resolve import "./sola-lettura"`.

- [ ] **Step 3: Scrivi l'implementazione minima**

`apps/piattaforma/src/lib/auth/permessi/sola-lettura.ts`:

```ts
import { type Permesso } from './catalogo';

/**
 * Partizione delle 31 chiavi del catalogo fra ciò che un utente SOSPESO
 * conserva e ciò che perde. Spec:
 * docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md
 *
 * Le due liste sono entrambe esplicite di proposito: se la seconda fosse il
 * complemento della prima, una chiave nuova nel catalogo diventerebbe di
 * scrittura in silenzio e nessun test diventerebbe rosso. Il test
 * «lettura e scrittura insieme coprono esattamente il catalogo» costringe a
 * decidere. A runtime `isLettura` resta comunque fail-closed.
 */
export const PERMESSI_LETTURA = [
  'pratiche.view',
  'pratiche.download',
  'inbox.view',
  'wallet.view',
  'fatture.view',
  'fatture.download',
  'fatture.xml',
  'addebiti.view',
  'affiliazione.view',
  'feedback.view',
  'sede.view',
  'orari.view',
  'team.view',
  'notifiche.view',
] as const satisfies readonly Permesso[];

/**
 * I download restano in lettura (`pratiche.download`, `fatture.download`,
 * `fatture.xml`): sono dati propri dell'azienda, e negarne l'estrazione durante
 * una sospensione sarebbe difficile da difendere anche sul piano GDPR.
 */
export const PERMESSI_SCRITTURA = [
  'pratiche.create',
  'pratiche.annulla',
  'pratiche.valuta',
  'pratiche.processa',
  'pratiche.firma',
  'pratiche.segnala',
  'inbox.gestisci',
  'wallet.payout',
  'wallet.soglia',
  'sede.edit',
  'orari.edit',
  'team.invita',
  'team.crea',
  'team.modifica',
  'team.reset_password',
  'team.disabilita',
  'team.permessi',
] as const satisfies readonly Permesso[];

const LETTURA: ReadonlySet<Permesso> = new Set<Permesso>(PERMESSI_LETTURA);

/** Fail-closed: ciò che non è nella whitelist è scrittura, chiavi ignote comprese. */
export function isLettura(p: Permesso): boolean {
  return LETTURA.has(p);
}

/** Nuovo set con le sole chiavi di lettura. Non muta l'ingresso. */
export function filtraSoloLettura(permessi: Set<Permesso>): Set<Permesso> {
  return new Set([...permessi].filter((p) => LETTURA.has(p)));
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/sola-lettura.test.ts`
Expected: PASS, 7 test.

Se il primo test fallisce con una differenza di chiavi, **non aggiustare la lista a caso**: leggi quale chiave manca o è di troppo e classificala secondo il criterio "un sospeso può farlo o no".

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/sola-lettura.ts apps/piattaforma/src/lib/auth/permessi/sola-lettura.test.ts
git commit -m "feat(sospensione): partizione delle 31 chiavi permessi in lettura e scrittura"
```

---

### Task 2: `can()` nega le chiavi di scrittura in sola lettura, owner compreso

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/permessi/check.ts:5-19`
- Test: `apps/piattaforma/src/lib/auth/permessi/check.test.ts` (aggiunta a file esistente)

**Interfaces:**
- Consumes: `isLettura` da `./sola-lettura` (Task 1)
- Produces: `PermessiCtx` con il campo opzionale `soloLettura?: boolean`

Il punto critico è **l'ordine**: `can()` oggi fa `if (ctx.isOwner) return true` come prima istruzione. Nella maggior parte delle aziende clienti l'`ADMIN_AZIENDA` è l'unica utenza, quindi un controllo posto dopo lo short-circuit lascerebbe la sospensione senza alcun effetto nel caso più comune.

- [ ] **Step 1: Scrivi il test che fallisce**

In coda al `describe('can', ...)` esistente in `check.test.ts`, aggiungi:

```ts
describe('can — sola lettura da sospensione', () => {
  const ownerSospeso: PermessiCtx = {
    userId: 'owner1',
    isOwner: true,
    permessi: new Set(),
    soloLettura: true,
  };

  it("il titolare sospeso perde le chiavi di scrittura malgrado isOwner", () => {
    expect(can(ownerSospeso, 'pratiche.create')).toBe(false);
    expect(can(ownerSospeso, 'pratiche.firma')).toBe(false);
    expect(can(ownerSospeso, 'wallet.payout')).toBe(false);
    expect(can(ownerSospeso, 'sede.edit')).toBe(false);
    expect(can(ownerSospeso, 'team.permessi')).toBe(false);
  });

  it('il titolare sospeso conserva le chiavi di lettura', () => {
    expect(can(ownerSospeso, 'pratiche.view')).toBe(true);
    expect(can(ownerSospeso, 'wallet.view')).toBe(true);
    expect(can(ownerSospeso, 'fatture.xml')).toBe(true);
  });

  it('un non-owner sospeso conserva solo le chiavi di lettura che possedeva', () => {
    const ctx: PermessiCtx = {
      userId: 'u1',
      isOwner: false,
      permessi: new Set(['pratiche.view', 'pratiche.create']),
      soloLettura: true,
    };
    expect(can(ctx, 'pratiche.view')).toBe(true);
    expect(can(ctx, 'pratiche.create')).toBe(false);
  });

  it('un non-owner sospeso non guadagna chiavi di lettura che non aveva', () => {
    const ctx: PermessiCtx = {
      userId: 'u1',
      isOwner: false,
      permessi: new Set(['pratiche.view']),
      soloLettura: true,
    };
    expect(can(ctx, 'wallet.view')).toBe(false);
  });

  it('senza il flag il comportamento è identico a prima (non regredire)', () => {
    const ctx: PermessiCtx = { userId: 'owner1', isOwner: true, permessi: new Set() };
    expect(can(ctx, 'wallet.payout')).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/check.test.ts`
Expected: FAIL — errore di tipo su `soloLettura` non presente in `PermessiCtx`, e i primi due test rossi perché il titolare può ancora tutto.

- [ ] **Step 3: Scrivi l'implementazione minima**

In `check.ts`, aggiungi l'import e modifica tipo e funzione:

```ts
import { dipendenzaDi, isPermesso, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';
import { isLettura } from './sola-lettura';
import { preset } from './preset';
import type { Role } from '@/lib/auth/permissions';

export type PermessiCtx = {
  userId: string;
  isOwner: boolean;
  permessi: Set<Permesso>;
  /**
   * Utente o azienda sospesi: sopravvivono solo le chiavi di lettura.
   * Opzionale perché le fixture di test esistenti costruiscono il contesto
   * con tre sole chiavi. Assente = operativo.
   */
  soloLettura?: boolean;
};

/**
 * Owner: sempre vero. Altrimenti la chiave dev'essere nel set E nel catalogo.
 * Il secondo controllo non è ridondante: difende dalle righe vecchie del DB, in
 * cui può essere rimasta una chiave che il catalogo non conosce più.
 *
 * La sola lettura si valuta PRIMA dello short-circuit sull'owner: nella maggior
 * parte delle aziende clienti l'ADMIN_AZIENDA è l'UNICA utenza, quindi esentarlo
 * lascerebbe la sospensione senza effetto nel caso più comune.
 */
export function can(ctx: PermessiCtx, p: Permesso): boolean {
  if (ctx.soloLettura && !isLettura(p)) return false;
  if (ctx.isOwner) return true;
  return isPermesso(p) && ctx.permessi.has(p);
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/check.test.ts`
Expected: PASS, tutti i test (i 19 preesistenti + i 5 nuovi).

- [ ] **Step 5: Esegui la suite intera per scoprire fixture rotte**

Run: `pnpm --filter piattaforma test`
Expected: PASS. Se qualcosa è rosso, è un `PermessiCtx` costruito da qualche parte con un campo in più o in meno: aggiustalo, non allargare il tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/check.ts apps/piattaforma/src/lib/auth/permessi/check.test.ts
git commit -m "feat(sospensione): can() nega la scrittura in sola lettura, titolare compreso"
```

---

### Task 3: Stato di sospensione e innesto in `getSessionContext`

**Files:**
- Create: `apps/piattaforma/src/lib/auth/sospensione.ts` (puro, nessuna dipendenza async)
- Create: `apps/piattaforma/src/lib/auth/sospensione-guard.ts` (accessori async)
- Modify: `apps/piattaforma/src/lib/auth/session-context.ts:31-46` (tipo) e `:75-116` (query e ritorno)
- Modify: `apps/piattaforma/src/lib/auth/permessi/guard.ts:8-26`
- Test: `apps/piattaforma/src/lib/auth/sospensione.test.ts`

**Interfaces:**
- Consumes: `filtraSoloLettura` da `permessi/sola-lettura` (Task 1)
- Produces:
  - da `sospensione.ts`: `type OrigineSospensione = 'UTENTE' | 'AZIENDA'`; `type StatoSospensione`; `NON_SOSPESO: StatoSospensione`; `ERRORE_SOSPENSIONE: string`; `calcolaSospensione(input): StatoSospensione`
  - da `sospensione-guard.ts`: `statoSospensione(): Promise<StatoSospensione>`; `requireOperativita(): Promise<{ ok: true } | { ok: false; error: string }>`; `assertOperativita(): Promise<void>`
  - `SessionContext` guadagna `sospensione: StatoSospensione`

**Perché due file e non uno:** `session-context.ts` deve importare `calcolaSospensione`, e gli accessori async devono importare `getSessionContext` da `session-context.ts`. In un solo modulo sarebbe un ciclo di import. Il file puro non importa nulla del contesto; quello guard importa entrambi.

- [ ] **Step 1: Scrivi il test che fallisce**

`apps/piattaforma/src/lib/auth/sospensione.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcolaSospensione, NON_SOSPESO } from './sospensione';

const ATTIVO = {
  userStatus: 'ACTIVE',
  userNote: null,
  companySuspendedAt: null,
  companyNote: null,
};

describe('calcolaSospensione', () => {
  it('utente attivo e azienda attiva → non sospeso', () => {
    expect(calcolaSospensione(ATTIVO)).toEqual(NON_SOSPESO);
  });

  it('sospensione individuale → origine UTENTE, motivo dalla nota utente', () => {
    // Stato prodotto da suspendUserAction: status SUSPENDED + nota sull'utente,
    // Company.suspendedAt resta null.
    expect(
      calcolaSospensione({
        ...ATTIVO,
        userStatus: 'SUSPENDED',
        userNote: 'Uso improprio della piattaforma.',
      }),
    ).toEqual({ sospeso: true, motivo: 'Uso improprio della piattaforma.', origine: 'UTENTE' });
  });

  it('sospensione aziendale → origine AZIENDA, motivo dalla nota azienda', () => {
    // Stato prodotto da suspendCompanyAction: suspendedAt + nota sulla company,
    // e in cascata tutti gli utenti a SUSPENDED. La nota utente resta vuota.
    expect(
      calcolaSospensione({
        ...ATTIVO,
        userStatus: 'SUSPENDED',
        companySuspendedAt: new Date('2026-07-25T10:00:00Z'),
        companyNote: 'Visura non conforme.',
      }),
    ).toEqual({ sospeso: true, motivo: 'Visura non conforme.', origine: 'AZIENDA' });
  });

  it('sospensione individuale preesistente + sospensione aziendale → prevale AZIENDA', () => {
    // La misura aziendale è la più ampia, ed è il suo motivo quello che
    // l'utente ha ricevuto per email (N14).
    expect(
      calcolaSospensione({
        userStatus: 'SUSPENDED',
        userNote: 'Nota individuale precedente.',
        companySuspendedAt: new Date('2026-07-25T10:00:00Z'),
        companyNote: 'Nota aziendale.',
      }),
    ).toEqual({ sospeso: true, motivo: 'Nota aziendale.', origine: 'AZIENDA' });
  });

  it('azienda sospesa senza motivo → sospeso con motivo null, non crasha', () => {
    expect(
      calcolaSospensione({ ...ATTIVO, companySuspendedAt: new Date(), companyNote: null }),
    ).toEqual({ sospeso: true, motivo: null, origine: 'AZIENDA' });
  });

  it('status PENDING_EMAIL_VERIFICATION non è una sospensione', () => {
    // Ha già il suo gate al login: non deve diventare una sola lettura.
    expect(calcolaSospensione({ ...ATTIVO, userStatus: 'PENDING_EMAIL_VERIFICATION' })).toEqual(
      NON_SOSPESO,
    );
  });

  it('campi undefined (utente senza company) → non sospeso', () => {
    expect(
      calcolaSospensione({
        userStatus: undefined,
        userNote: undefined,
        companySuspendedAt: undefined,
        companyNote: undefined,
      }),
    ).toEqual(NON_SOSPESO);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/sospensione.test.ts`
Expected: FAIL — `Failed to resolve import "./sospensione"`.

- [ ] **Step 3: Scrivi il modulo puro**

`apps/piattaforma/src/lib/auth/sospensione.ts`:

```ts
/**
 * Stato di sospensione di un utente azienda, calcolato dalle righe DB.
 * Modulo PURO: nessun import di sessione o Prisma, così `session-context.ts`
 * può importarlo senza creare un ciclo. Gli accessori async stanno in
 * ./sospensione-guard.ts.
 *
 * Spec: docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md
 */

export type OrigineSospensione = 'UTENTE' | 'AZIENDA';

export type StatoSospensione =
  | { sospeso: false; motivo: null; origine: null }
  | { sospeso: true; motivo: string | null; origine: OrigineSospensione };

export const NON_SOSPESO: StatoSospensione = { sospeso: false, motivo: null, origine: null };

/**
 * Messaggio unico mostrato quando un'operazione viene rifiutata per
 * sospensione. Non è il generico «Non hai i permessi»: l'utente i permessi li
 * ha, gli è stata sospesa l'operatività — dirgli la cosa sbagliata lo manderebbe
 * a cercare un problema che non esiste.
 */
export const ERRORE_SOSPENSIONE =
  'Il tuo account è sospeso: puoi consultare i tuoi dati ma non svolgere operazioni. Il motivo è indicato nell\'email che hai ricevuto.';

/**
 * `SUSPENDED` sull'utente OPPURE `suspendedAt` sull'azienda.
 *
 * La misura aziendale prevale su quella individuale: è la più ampia, e il suo
 * motivo è quello che l'utente ha ricevuto per email (N14).
 * `suspendCompanyAction` porta a `SUSPENDED` anche gli utenti ma scrive la nota
 * solo sulla company, quindi leggere la nota utente in quel caso darebbe il
 * testo sbagliato (o nessun testo).
 *
 * `PENDING_EMAIL_VERIFICATION` NON è una sospensione: ha il suo gate al login.
 */
export function calcolaSospensione(input: {
  userStatus: string | undefined;
  userNote: string | null | undefined;
  companySuspendedAt: Date | null | undefined;
  companyNote: string | null | undefined;
}): StatoSospensione {
  if (input.companySuspendedAt) {
    return { sospeso: true, motivo: input.companyNote ?? null, origine: 'AZIENDA' };
  }
  if (input.userStatus === 'SUSPENDED') {
    return { sospeso: true, motivo: input.userNote ?? null, origine: 'UTENTE' };
  }
  return NON_SOSPESO;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/sospensione.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 5: Innesta lo stato in `getSessionContext`**

In `session-context.ts`, tre modifiche.

Import, in coda a quelli esistenti:

```ts
import { calcolaSospensione, NON_SOSPESO, type StatoSospensione } from '@/lib/auth/sospensione';
import { filtraSoloLettura } from '@/lib/auth/permessi/sola-lettura';
```

Nel tipo `SessionContext`, dopo il campo `permessi`:

```ts
  /** Sospensione in corso: `can()` nega ogni chiave di scrittura. */
  sospensione: StatoSospensione;
```

Nel ramo `if (!companyId)` (riga ~61), aggiungi al literal di ritorno:

```ts
      sospensione: NON_SOSPESO,
```

**Nota:** questo ramo è lo staff di piattaforma, fuori scope per scelta. Non trasformarlo in un controllo: le loro autorizzazioni non passano da qui.

Le due query centrali diventano — nota che quella su `user` **non è più condizionata a `isOwner`**, perché lo status serve anche al titolare:

```ts
  const [companySedi, memberships, dbUser, company] = await Promise.all([
    prisma.sede.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, nome: true, type: true, citta: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.userSede.findMany({
      where: { userId: user.id, sede: { companyId, deletedAt: null } },
      select: { sedeId: true, ruolo: true },
    }),
    // Non più saltata per l'owner: `status` e `suspensionLastNote` servono anche
    // al titolare, che senza questa lettura resterebbe pienamente operativo
    // malgrado la sospensione (ed è l'unica utenza nella maggior parte delle
    // aziende clienti). `permessi` per l'owner resta ignorato: `can()` gli dà
    // tutto comunque tramite lo short-circuit su isOwner.
    prisma.user.findUnique({
      where: { id: user.id },
      select: { permessi: true, status: true, suspensionLastNote: true },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { type: true, suspendedAt: true, suspensionLastNote: true },
    }),
  ]);
```

E il ritorno, sostituendo la sola riga `permessi:`:

```ts
  const sospensione = calcolaSospensione({
    userStatus: dbUser?.status,
    userNote: dbUser?.suspensionLastNote,
    companySuspendedAt: company?.suspendedAt,
    companyNote: company?.suspensionLastNote,
  });

  // Il confine col DB: una chiave rimossa dal catalogo non entra nel set.
  // Per l'owner il set resta vuoto — `can()` gli dà tutto tramite isOwner.
  const permessiBase = isOwner
    ? new Set<Permesso>()
    : new Set((dbUser?.permessi ?? []).filter(isPermesso));

  return {
    user,
    companyId,
    isOwner,
    accessibleSedi,
    currentSede,
    scopeIds,
    membershipRuoli,
    companyType: (company?.type ?? undefined) as CompanyTypeP | undefined,
    permessi: sospensione.sospeso ? filtraSoloLettura(permessiBase) : permessiBase,
    sospensione,
  };
```

- [ ] **Step 6: Propaga il flag a `PermessiCtx` e distingui il messaggio d'errore**

`guard.ts` diventa:

```ts
import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session-context';
import { ERRORE_SOSPENSIONE } from '@/lib/auth/sospensione';
import { can, type PermessiCtx } from './check';
import { isLettura } from './sola-lettura';
import type { Permesso } from './catalogo';

/** Il contesto ridotto che serve a `can()`. Null se non autenticato. */
export async function permessiCtx(): Promise<PermessiCtx | null> {
  const ctx = await getSessionContext();
  if (!ctx?.user) return null;
  return {
    userId: ctx.user.id,
    isOwner: ctx.isOwner,
    permessi: ctx.permessi,
    soloLettura: ctx.sospensione.sospeso,
  };
}

export async function hasPermesso(p: Permesso): Promise<boolean> {
  const ctx = await permessiCtx();
  if (!ctx) return false;
  return can(ctx, p);
}

/**
 * Gate per le server action: ritorna un result, non lancia.
 *
 * Quando il rifiuto viene dalla sospensione il messaggio è specifico: dire
 * «Non hai i permessi» a un utente che i permessi li ha lo manderebbe a
 * cercare un problema di permessi che non esiste.
 */
export async function requirePermesso(
  p: Permesso,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await permessiCtx();
  if (ctx && can(ctx, p)) return { ok: true };
  if (ctx?.soloLettura && !isLettura(p)) return { ok: false, error: ERRORE_SOSPENSIONE };
  return { ok: false, error: 'Non hai i permessi per questa azione' };
}

/** Gate per le pagine: rimanda alla dashboard. */
export async function assertPermesso(p: Permesso): Promise<void> {
  if (!(await hasPermesso(p))) redirect('/dashboard');
}
```

- [ ] **Step 7: Scrivi gli accessori async**

`apps/piattaforma/src/lib/auth/sospensione-guard.ts`:

```ts
import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session-context';
import { ERRORE_SOSPENSIONE, NON_SOSPESO, type StatoSospensione } from '@/lib/auth/sospensione';

/**
 * Stato di sospensione dell'utente corrente. Nessuna query aggiuntiva: legge
 * il contesto, che è già `cache()`-ato per richiesta.
 */
export async function statoSospensione(): Promise<StatoSospensione> {
  const ctx = await getSessionContext();
  return ctx?.sospensione ?? NON_SOSPESO;
}

/**
 * Gate per le server action che NON sono protette da una chiave del catalogo
 * (quelle a permesso `null` in mappa-enforcement.ts): l'intersezione dei
 * permessi non le intercetta, serve il controllo esplicito.
 */
export async function requireOperativita(): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await statoSospensione();
  if (!s.sospeso) return { ok: true };
  return { ok: false, error: ERRORE_SOSPENSIONE };
}

/** Gate per le pagine di sola modifica: rimanda alla dashboard, dove il banner spiega. */
export async function assertOperativita(): Promise<void> {
  const s = await statoSospensione();
  if (s.sospeso) redirect('/dashboard');
}
```

- [ ] **Step 8: Esegui la suite intera**

Run: `pnpm --filter piattaforma test`
Expected: PASS. Alcuni test mockano `getSessionContext` con un literal che ora manca `sospensione`: aggiungi `sospensione: { sospeso: false, motivo: null, origine: null }` alle fixture che il compilatore segnala. `app/orari/actions.authz.test.ts` ha un helper `ctxConPermessi` che è il posto giusto dove metterlo una volta sola.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/lib/auth/sospensione.ts apps/piattaforma/src/lib/auth/sospensione.test.ts apps/piattaforma/src/lib/auth/sospensione-guard.ts apps/piattaforma/src/lib/auth/session-context.ts apps/piattaforma/src/lib/auth/permessi/guard.ts
git add -u
git commit -m "feat(sospensione): stato in getSessionContext + intersezione permessi + messaggio dedicato"
```

---

### Task 4: Le action senza permesso delegabile

**Files:**
- Modify: `apps/piattaforma/src/app/profilo/azienda/actions.ts:32-36`
- Modify: `apps/piattaforma/src/app/sedi/actions.ts:35-40` e la funzione `setSedeSuspended`
- Modify: `apps/piattaforma/src/app/wallet/mandato-actions.ts:29-31` e `:53-55`
- Modify: `apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.test.ts` (aggiunta a file esistente)

**Interfaces:**
- Consumes: `requireOperativita` da `@/lib/auth/sospensione-guard` (Task 3)
- Produces: `MAPPA_SOSPENSIONE: Record<string, Record<string, 'BLOCCA' | 'CONSENTI'>>`

Sei action da bloccare. Restano **consentite** e non vanno toccate: tutto `profilo/personale`, `profilo/sicurezza`, `profilo/notifiche` (proprio account), `visura` e `blocco-pagamento` (rimedi per rientrare in regola), `setCurrentSedeAction` (navigazione).

`updateSedeAction` **non** è in questa lista: è gated su `sede.edit`, quindi già coperta dall'intersezione.

- [ ] **Step 1: Scrivi il test che fallisce**

In coda a `mappa-enforcement.test.ts`, dopo il `describe` esistente:

```ts
import { MAPPA_SOSPENSIONE } from './mappa-sospensione';

/** Il corpo dell'action, o di un helper diretto, cita `requireOperativita`. */
function citaGuardOperativita(src: string, corpo: string, nomeAction: string): boolean {
  if (corpo.includes('requireOperativita')) return true;
  const chiamate = [...corpo.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);
  return [...new Set(chiamate)]
    .filter((h) => h !== nomeAction)
    .some((h) => {
      const corpoHelper = corpoFunzione(src, h);
      return corpoHelper !== null && corpoHelper.includes('requireOperativita');
    });
}

describe('mappa-sospensione', () => {
  it('classifica esattamente le action senza permesso delegabile', () => {
    const attese: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      for (const [nome, permesso] of Object.entries(actions)) {
        if (permesso === null) attese.push(`${rel}:${nome}`);
      }
    }
    const dichiarate: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_SOSPENSIONE)) {
      for (const nome of Object.keys(actions)) dichiarate.push(`${rel}:${nome}`);
    }
    expect(
      dichiarate.sort(),
      'MAPPA_SOSPENSIONE deve coprire ESATTAMENTE le action a permesso null di ' +
        'MAPPA_ENFORCEMENT: quelle gated da un permesso hanno il comportamento già ' +
        'derivato dalla partizione lettura/scrittura e non vanno ripetute qui.',
    ).toEqual(attese.sort());
  });

  it("ogni action marcata BLOCCA chiama davvero requireOperativita", () => {
    const senzaGuard: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_SOSPENSIONE)) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8');
      for (const [nome, esito] of Object.entries(actions)) {
        if (esito !== 'BLOCCA') continue;
        const corpo = corpoFunzione(src, nome);
        if (corpo === null) {
          senzaGuard.push(`${rel}:${nome} (funzione non trovata nel sorgente)`);
          continue;
        }
        if (!citaGuardOperativita(src, corpo, nome)) senzaGuard.push(`${rel}:${nome}`);
      }
    }
    expect(
      senzaGuard,
      'Action marcata BLOCCA in mappa-sospensione.ts ma che non chiama ' +
        'requireOperativita() né direttamente né in un helper dichiarato nello stesso ' +
        'file:\n  ' + senzaGuard.join('\n  '),
    ).toEqual([]);
  }, 20_000);
});
```

**Il timeout di 20s sul secondo test non è facoltativo.** Quel test legge da disco un file per ogni action mappata. Il default di vitest è 5s, e il test già esistente nello stesso file — che cammina l'intero albero di `src/app` e `src/lib` — sotto la suite completa a cache fredda **sfora e diventa rosso** (osservato: 1 fallimento su 2080 alla prima esecuzione dopo il checkout, verde alla seconda). Aggiungendo un secondo test I/O-bound nello stesso file l'esposizione cresce.

Quindi, nello stesso commit, aggiungi `, 20_000` anche al test preesistente `nessun modulo di server action sfugge alla mappa (blindspot: file interamente nuovo)` (riga ~218, chiusura `});`). L'asserzione non cambia: cambia solo la pazienza. Un test che dipende dall'I/O del filesystem non deve avere il timeout pensato per un test in memoria.

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/mappa-enforcement.test.ts`
Expected: FAIL — `Failed to resolve import "./mappa-sospensione"`.

- [ ] **Step 3: Scrivi la mappa**

`apps/piattaforma/src/lib/auth/permessi/mappa-sospensione.ts`:

```ts
/**
 * Comportamento sotto sospensione delle sole server action che NON sono
 * protette da una chiave del catalogo (permesso `null` in ./mappa-enforcement).
 *
 * Le action gated NON vanno elencate qui: il loro comportamento è già derivato
 * dalla partizione in ./sola-lettura (chiave di scrittura ⇒ bloccata). Il test
 * verifica l'uguaglianza esatta degli insiemi, quindi aggiungerne una fa
 * fallire la suite.
 *
 * Spec: docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md
 */
export const MAPPA_SOSPENSIONE: Record<string, Record<string, 'BLOCCA' | 'CONSENTI'>> = {
  'src/app/wallet/mandato-actions.ts': {
    // Il mandato serve al payout, che sotto sospensione è comunque bloccato.
    inviaOtpMandatoAction: 'BLOCCA',
    firmaMandatoAction: 'BLOCCA',
  },
  'src/app/fatturazione/actions.ts': {
    segnaTrasmessoSdiAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA: staff, fuori scope
  },
  'src/app/blocco-pagamento/actions.ts': {
    // Rimedi: permettono di rientrare in regola e presentarsi al riesame.
    ritentaAddebitoAction: 'CONSENTI',
    aggiornaIbanERitentaAction: 'CONSENTI',
  },
  'src/app/visura/actions.ts': {
    verificaVisuraAction: 'CONSENTI', // rimedio
    aggiornaVisuraAction: 'CONSENTI', // rimedio
  },
  'src/app/sedi/actions.ts': {
    // Creare o riorganizzare sedi da sospesi è espansione, cioè operatività.
    createSedeAction: 'BLOCCA',
    suspendSedeAction: 'BLOCCA',
    reactivateSedeAction: 'BLOCCA',
  },
  'src/app/team/actions.ts': {
    acceptInvitationAction: 'CONSENTI', // flusso pubblico: l'invitato non ha sessione
  },
  'src/app/profilo/personale/actions.ts': {
    // Proprio account: bloccare il cambio password a un utente le cui
    // credenziali potrebbero essere compromesse fa danno senza portare nulla.
    updateOwnProfileAction: 'CONSENTI',
    changeOwnPasswordAction: 'CONSENTI',
  },
  'src/app/profilo/azienda/actions.ts': {
    updateCompanyProfileAction: 'BLOCCA', // atto societario: identità fiscale
  },
  'src/app/profilo/sicurezza/actions.ts': {
    start2faSetupAction: 'CONSENTI', // proprio account
    confirm2faSetupAction: 'CONSENTI',
    disable2faAction: 'CONSENTI',
  },
  'src/app/profilo/notifiche/actions.ts': {
    updateNotifPrefsAction: 'CONSENTI', // proprio account
  },
  'src/app/profilo/listino/actions.ts': {
    // Feature parcheggiata: route 404 (vedi project_listini_parcheggiati).
    saveListinoFormAction: 'CONSENTI',
    uploadListinoFileAction: 'CONSENTI',
    deleteListinoAction: 'CONSENTI',
  },
  'src/lib/sedi/actions.ts': {
    setCurrentSedeAction: 'CONSENTI', // navigazione, non scrittura di dominio
  },
  'src/lib/penali/segnalazione.ts': {
    confermaAnnullamentoConPenaleAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA
    respingiSegnalazioneAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA
  },
  'src/lib/segnalazioni/creazione.ts': {
    gestisciSegnalazioneCreazioneAction: 'CONSENTI', // gated ADMIN_PIATTAFORMA
  },
};
```

Se il primo test fallisce con voci mancanti o di troppo, **allinea questa mappa a `MAPPA_ENFORCEMENT`**: l'elenco sopra riflette lo stato del file al momento della scrittura del piano, e nel frattempo può essere cambiato.

- [ ] **Step 4: Esegui il test — il primo passa, il secondo fallisce**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/mappa-enforcement.test.ts`
Expected: il test di copertura PASSA; quello sul guard FALLISCE elencando le 6 action `BLOCCA` che non chiamano ancora `requireOperativita`.

- [ ] **Step 5: Aggiungi il guard alle sei action**

In `app/profilo/azienda/actions.ts`, subito dopo il controllo di ruolo esistente:

```ts
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può modificare il profilo" };
  }
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };
```

In `app/wallet/mandato-actions.ts`, in entrambe le action dopo il controllo `utenteTitolare()`:

```ts
export async function inviaOtpMandatoAction(): Promise<Esito> {
  const u = await utenteTitolare();
  if (!u) return { ok: false, error: 'Solo il titolare può firmare il mandato' };
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };
```

```ts
export async function firmaMandatoAction(codice: string): Promise<Esito> {
  const u = await utenteTitolare();
  if (!u) return { ok: false, error: 'Solo il titolare può firmare il mandato' };
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };
```

In `app/sedi/actions.ts`, in `createSedeAction` dopo il controllo di ruolo:

```ts
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può aggiungere sedi' };
  }
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };
```

`suspendSedeAction` e `reactivateSedeAction` sono wrapper di una riga su `setSedeSuspended`: il guard va **dentro `setSedeSuspended`**, così copre entrambe. Il test segue un livello di indirezione verso gli helper dichiarati nello stesso file, quindi lo riconosce.

```ts
async function setSedeSuspended(sedeId: string, suspended: boolean): Promise<SedeActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può gestire le sedi' };
  }
  // Copre sia suspendSedeAction sia reactivateSedeAction, che sono wrapper di
  // una riga su questa funzione.
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };

  const companyId = session.user.companyId!;
  // ... resto invariato
```

L'import da aggiungere in tutti e tre i file:

```ts
import { requireOperativita } from '@/lib/auth/sospensione-guard';
```

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/mappa-enforcement.test.ts`
Expected: PASS, tutti i test del file.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/mappa-sospensione.ts apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.test.ts apps/piattaforma/src/app/profilo/azienda/actions.ts apps/piattaforma/src/app/sedi/actions.ts apps/piattaforma/src/app/wallet/mandato-actions.ts
git commit -m "feat(sospensione): blocco delle action senza permesso delegabile + censimento test-enforced"
```

---

### Task 5: Il motore payout rifiuta per azienda sospesa

**Files:**
- Modify: `apps/piattaforma/src/lib/wallet/payout-exec.ts:176-189`
- Test: `apps/piattaforma/src/lib/wallet/payout-exec.sospensione.test.ts`

**Interfaces:**
- Consumes: nulla dai task precedenti — è un guard indipendente, sul DB e non sulla sessione
- Produces: nessuna nuova export

Il guard va **qui e non nell'action** perché tutti i percorsi di payout convergono su `eseguiPayoutImmediato`: manuale, auto-payout a soglia in tempo reale (`lib/wallet/auto-payout.ts:45`) e cron di sicurezza. Un blocco sull'action sarebbe cosmetico — l'auto-payout partirebbe comunque, senza che il sospeso tocchi nulla. Il caso è concreto: le pratiche già inviate da un broker sospeso continuano a essere firmate dalle agenzie e ad accreditargli il wallet.

**Asimmetria deliberata:** il guard controlla la sospensione **aziendale**, non quella individuale. Un payout è un movimento di denaro dell'azienda: se un solo utente è sospeso, i colleghi restano legittimati e l'auto-payout deve continuare a funzionare. L'utente sospeso singolarmente non può comunque richiederlo, perché `wallet.payout` è una chiave di scrittura.

- [ ] **Step 1: Scrivi il test che fallisce**

`apps/piattaforma/src/lib/wallet/payout-exec.sospensione.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il guard sta nel motore, non nell'action: manuale, auto-payout a soglia e
 * cron passano tutti da qui. Vedi lib/wallet/auto-payout.ts:45.
 */

const WALLET_ID = 'wallet-1';

const { prismaMock, isVisuraScadutaMock } = vi.hoisted(() => ({
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  isVisuraScadutaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/visura/validita', () => ({
  isVisuraScadutaCompany: isVisuraScadutaMock,
  limiteVisuraUtc: vi.fn(() => new Date('2026-01-01T00:00:00Z')),
}));

import { eseguiPayoutImmediato } from './payout-exec';

beforeEach(() => {
  vi.clearAllMocks();
  isVisuraScadutaMock.mockResolvedValue(false);
  // La reserve fallisce per saldo non erogabile. `eseguiPayoutImmediato` fa
  // `if (!reserve.ok) return reserve` (payout-exec.ts:258), quindi la funzione
  // torna subito dopo i guard senza mai raggiungere il provider di pagamento.
  // Senza questo mock `$transaction` risolverebbe `undefined` e il test che
  // verifica l'esenzione `ignoraSoglia` lancerebbe invece di asserire.
  prismaMock.$transaction.mockResolvedValue({ ok: false, error: 'Saldo non erogabile' });
});

/** Wallet di sede la cui company è sospesa. */
function walletDiCompanySospesa() {
  prismaMock.wallet.findUnique.mockResolvedValue({
    companyId: null,
    company: null,
    sede: { companyId: 'c1', company: { suspendedAt: new Date('2026-07-25T10:00:00Z') } },
  });
}

describe('eseguiPayoutImmediato — azienda sospesa', () => {
  it('rifiuta senza aprire la transazione di reserve', async () => {
    walletDiCompanySospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sospes/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rifiuta anche il payout automatico (soglia e cron passano da qui)', async () => {
    walletDiCompanySospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID, { automatico: true });

    expect(res.ok).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('NON rifiuta sotto ignoraSoglia: la liquidazione di cessazione resta possibile', async () => {
    // Clausola 12.4 dei Termini: alla cessazione il saldo residuo è liquidato
    // integralmente. `deleteCompanyAction` marca suspendedAt E deletedAt, quindi
    // senza questa esenzione il denaro dovuto resterebbe intrappolato per sempre.
    walletDiCompanySospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID, { ignoraSoglia: true });

    // Il guard NON ha corto-circuitato: si è arrivati alla reserve, e l'errore
    // che torna è quello del saldo, non quello della sospensione.
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toMatch(/sospes/i);
  });

  it('wallet di company madre non sospesa → prosegue verso il guard visura', async () => {
    prismaMock.wallet.findUnique.mockResolvedValue({
      companyId: 'c1',
      company: { suspendedAt: null },
      sede: null,
    });
    isVisuraScadutaMock.mockResolvedValue(true);

    const res = await eseguiPayoutImmediato(WALLET_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/visura/i);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/wallet/payout-exec.sospensione.test.ts`
Expected: FAIL. I primi due test non vedono il rifiuto per sospensione; possono anche fallire per mock incompleti a valle — in quel caso completa i mock **senza toccare l'ordine dei guard**.

- [ ] **Step 3: Aggiungi il guard**

In `payout-exec.ts`, dentro il blocco `if (!ignoraSoglia)` esistente, estendi il `select` già presente e inserisci il controllo **prima** di quello sulla visura:

```ts
  if (!ignoraSoglia) {
    const walletOwner = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        companyId: true,
        company: { select: { suspendedAt: true } },
        sede: { select: { companyId: true, company: { select: { suspendedAt: true } } } },
      },
    });
    const ownerCompanyId = walletOwner?.companyId ?? walletOwner?.sede?.companyId ?? null;

    // Sospensione dell'AZIENDA (non dell'utente): un payout è un movimento di
    // denaro aziendale, e se è sospeso un solo utente i colleghi restano
    // legittimati. L'utente sospeso singolarmente non può comunque arrivare
    // qui dall'action, perché `wallet.payout` è una chiave di scrittura.
    //
    // Come il guard visura sotto, è escluso da `ignoraSoglia`: la liquidazione
    // di cessazione (clausola 12.4) deve restare possibile, e `deleteCompanyAction`
    // marca `suspendedAt` insieme a `deletedAt` — bloccare qui intrappolerebbe
    // per sempre il denaro dovuto.
    const suspendedAt =
      walletOwner?.company?.suspendedAt ?? walletOwner?.sede?.company?.suspendedAt ?? null;
    if (suspendedAt) {
      return {
        ok: false,
        error:
          'Il tuo account è sospeso: i prelievi dal wallet sono bloccati finché la sospensione non viene revocata. Il saldo resta a tuo credito.',
      };
    }

    if (ownerCompanyId && (await isVisuraScadutaCompany(ownerCompanyId))) {
      return {
        ok: false,
        error:
          'La visura camerale della tua azienda è scaduta: i prelievi sono sospesi finché non la aggiorni.',
      };
    }
  }
```

Nessuna query aggiuntiva: `Wallet` ha entrambe le relazioni `company` e `sede` (`schema.prisma`, model `Wallet`), quindi `suspendedAt` arriva con la lettura che c'era già.

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/wallet/payout-exec.sospensione.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 5: Verifica di non aver rotto i test payout esistenti**

Run: `pnpm --filter piattaforma exec vitest run src/lib/wallet`
Expected: PASS. I test esistenti mockano `wallet.findUnique` con la forma vecchia del `select`: i campi in più tornano `undefined`, che l'operatore `??` tratta come "non sospeso". Se qualcosa è rosso, aggiungi `company: null` / `sede: { companyId: 'x', company: null }` alle fixture.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/wallet/payout-exec.ts apps/piattaforma/src/lib/wallet/payout-exec.sospensione.test.ts
git add -u apps/piattaforma/src/lib/wallet
git commit -m "feat(sospensione): blocco payout nel motore (copre manuale, soglia e cron)"
```

---

### Task 6: Banner, pagine con form editabili, verifica nel browser

**Files:**
- Create: `apps/piattaforma/src/components/suspension-banner.tsx`
- Modify: `apps/piattaforma/src/app/dashboard/page.tsx` (accanto a `VisuraBanner`, riga ~39)
- Modify: `apps/piattaforma/src/app/pratiche/page.tsx` (riga ~191)
- Modify: `apps/piattaforma/src/app/inbox/page.tsx` (riga ~79)
- Modify: `apps/piattaforma/src/app/wallet/page.tsx` (righe ~230 e ~427)
- Modify: `apps/piattaforma/src/app/fatturazione/page.tsx`
- Modify: `apps/piattaforma/src/app/affiliazione/page.tsx`
- Modify: `apps/piattaforma/src/app/team/[userId]/edit/page.tsx:30`
- Modify: `apps/piattaforma/src/app/sedi/[id]/sede-edit.tsx:36-41` e `:130-137`
- Modify: `apps/piattaforma/src/app/sedi/[id]/page.tsx:64` e `apps/piattaforma/src/app/impostazioni-sede/page.tsx:58`

**Interfaces:**
- Consumes: `statoSospensione` e `assertOperativita` da `@/lib/auth/sospensione-guard` (Task 3)
- Produces: `<SuspensionBanner />` (Server Component, nessuna prop)

Tre pagine contengono form editabili ma sono gated su un permesso di **lettura**, quindi restano raggiungibili sotto sospensione e mostrerebbero un form che poi rifiuta al submit:

| Pagina | Gate attuale | Rimedio |
|---|---|---|
| `/team/[userId]/edit` | `team.view` | `assertOperativita()`: è solo un form, non c'è nulla da leggere |
| `/sedi/[id]` | `sede.view` | prop `soloLettura` a `SedeEdit`: nasconde il tasto "Modifica", la vista resta leggibile |
| `/impostazioni-sede` | `sede.view` | idem |

- [ ] **Step 1: Scrivi il banner**

`apps/piattaforma/src/components/suspension-banner.tsx`:

```ts
import { Alert } from '@/components/ui';
import { statoSospensione } from '@/lib/auth/sospensione-guard';

/**
 * Banner della sospensione. Server Component senza prop: legge il contesto,
 * già `cache()`-ato per richiesta, e si auto-annulla quando non c'è nulla da
 * dire — come VisuraBanner e DemoBanner.
 *
 * Il motivo è testo libero scritto dall'admin: va reso SOLO come figlio JSX
 * (React lo escapa). Mai `dangerouslySetInnerHTML`.
 */
export async function SuspensionBanner() {
  const s = await statoSospensione();
  if (!s.sospeso) return null;

  const soggetto =
    s.origine === 'AZIENDA'
      ? "L'account della tua azienda è sospeso"
      : 'La tua utenza è sospesa';

  return (
    <Alert variant="error" title={`${soggetto} — operazioni bloccate`}>
      Puoi consultare lo storico delle pratiche, il wallet, le fatture e gli addebiti, ma non puoi
      creare o gestire pratiche, prelevare dal wallet o modificare le impostazioni. Il saldo del
      wallet resta a tuo credito.{' '}
      {s.motivo ? <>Motivo indicato da Passaggio Veloce: «{s.motivo}».{' '}</> : null}
      Per chiedere il riesame della misura rispondi all&apos;email che hai ricevuto.
    </Alert>
  );
}
```

Attenzione agli spazi fra elementi JSX: i `{' '}` sopra non sono decorativi. In questo repo il JSX ha già incollato 21 parole in una pagina legale senza che nessun test lo vedesse. Li verifichi allo Step 6, leggendo il DOM.

- [ ] **Step 2: Monta il banner**

In ciascuna delle pagine elencate, aggiungi l'import e il componente **immediatamente sopra** il `VisuraBanner` esistente (o, dove non c'è, come primo elemento del contenitore principale):

```tsx
import { SuspensionBanner } from '@/components/suspension-banner';
```

```tsx
<SuspensionBanner />
```

`/dashboard` è la più importante: è dove arriva chi viene rimandato da `assertPermesso` e `assertOperativita`. Se ne monti una sola, quella.

- [ ] **Step 3: Blocca la pagina di modifica utente team**

In `app/team/[userId]/edit/page.tsx`, dopo la riga 30:

```ts
  await assertPermesso('team.view');
  // Pagina di sola modifica: sotto sospensione non c'è nulla da leggere qui, e
  // il form rifiuterebbe al submit. Rimanda alla dashboard, dove il banner spiega.
  await assertOperativita();
```

Con l'import:

```ts
import { assertOperativita } from '@/lib/auth/sospensione-guard';
```

- [ ] **Step 4: Rendi `SedeEdit` consapevole della sola lettura**

In `sede-edit.tsx`, aggiungi la prop:

```tsx
export function SedeEdit({
  sedeId,
  data,
  canEditPagamenti,
  soloLettura = false,
}: {
  sedeId: string;
  data: SedeEditData;
  canEditPagamenti: boolean;
  /** Account sospeso: la vista resta leggibile, il tasto "Modifica" non compare. */
  soloLettura?: boolean;
}) {
```

Poi, nel blocco della vista non-editing (riga ~129), condiziona il tasto. Il componente è già progettato come «vista in sola lettura con toggle Modifica»: togliendo il toggle resta esattamente una vista.

```tsx
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Anagrafica</h2>
            {!soloLettura && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Modifica
              </button>
            )}
          </div>
```

Non aggiungere classi né colori: il `className` sopra è quello esistente, copiato invariato.

Nelle due pagine che lo usano, passa la prop leggendo lo stato:

```tsx
const sospensione = await statoSospensione();
// ...
<SedeEdit sedeId={...} data={...} canEditPagamenti={canEditPagamenti} soloLettura={sospensione.sospeso} />
```

- [ ] **Step 5: Esegui la suite intera**

Run: `pnpm --filter piattaforma test`
Expected: PASS.

- [ ] **Step 6: Verifica nel browser — obbligatoria, non sostituibile**

I test unitari coprono le funzioni pure e i guard. **Non** coprono il cablaggio dentro `getSessionContext` (una `select` a cui manca un campo passa tutti i test) né il rendering del banner. In questo repo i test non hanno mai visto due bug React né 21 parole incollate: questa verifica è la prova, il resto sono indizi.

Sul DB locale:

1. Trova un broker con pratiche e un wallet non vuoto, e prendi nota del suo `id` e della sua email.
2. Fai login **prima** di sospendere e lascia la sessione aperta: è lo scenario esatto del bug.
3. Da un'altra sessione admin, sospendi l'utente da `/admin/utenti` con un motivo riconoscibile.
4. Nella sessione del broker, **ricarica** e verifica una per una:
   - il banner compare, con il motivo scritto al punto 3;
   - leggi il testo del banner **dal DOM**, non dal sorgente: nessuna parola incollata;
   - `/pratiche` è raggiungibile e la CTA "Nuova pratica" **non c'è**;
   - `/pratiche/nuova` per URL diretto rimanda a `/dashboard`;
   - su `/wallet` il tasto di payout **non c'è**, e il saldo si vede ancora;
   - su `/pratiche/<id>` di una pratica sua, i tasti di annullamento non ci sono;
   - `/team/<userId>/edit` per URL diretto rimanda a `/dashboard`;
   - `/impostazioni-sede` è leggibile e il tasto "Modifica" non c'è;
   - cambio password da `/profilo/sicurezza` **funziona** (è consentito).
5. Ripeti i punti 3-4 sospendendo l'**azienda** da `/admin/broker`, e verifica che il banner dica «L'account della tua azienda è sospeso».
6. Riattiva e verifica che l'operatività torni **senza** rifare login: è la proprietà che giustifica l'intera architettura.

Il punto 4 va fatto **cliccando**, non navigando per URL: una soft navigation non è un clic, e un pulsante nascosto male resta cliccabile.

- [ ] **Step 7: Verifica le query sul DB reale**

I test mockano Prisma. Esegui in read-only sul Postgres locale la lettura che `getSessionContext` ora fa, e controlla che i campi esistano e siano popolati come previsto:

```sql
SELECT u.id, u.status, u."suspensionLastNote", c."suspendedAt", c."suspensionLastNote"
FROM users u JOIN companies c ON c.id = u."companyId"
WHERE u.status = 'SUSPENDED' OR c."suspendedAt" IS NOT NULL
LIMIT 20;
```

Se i nomi di colonna non corrispondono, sono i `@map` dello schema: prendili da `packages/db/prisma/schema.prisma`, non tirare a indovinare.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/components/suspension-banner.tsx
git add -u apps/piattaforma/src
git commit -m "feat(sospensione): banner con motivo + pagine con form editabili in sola lettura"
```

---

## Note di chiusura per chi implementa

**Cosa NON fare:**

- Non toccare `credentials-query.ts`: il gate di login funziona già e non c'entra.
- Non abbassare `session.maxAge`: il controllo per-richiesta lo rende inutile.
- Non aggiungere controlli nel middleware o in `auth.config.ts`: gira su edge, non ha Prisma, e non sa distinguere una lettura da una scrittura. È la causa del bug, non la cura.
- Non estendere il lavoro allo staff di piattaforma: è fuori scope per decisione esplicita.
- Non revocare automaticamente le pratiche accettate di un'agenzia sospesa: lo fa l'admin da `/admin/monitoraggio`.

**Follow-up noto, non introdotto da questo lavoro:** `reactivateCompanyAction` riattiva *tutti* gli utenti `SUSPENDED` della company, revocando in silenzio anche una sospensione individuale motivata (già documentato in `suspension-actions.ts:222-243`). Serve `User.suspensionSource` e una migration. Con la sola lettura in vigore la conseguenza diventa più visibile, ma resta un lavoro a parte.
