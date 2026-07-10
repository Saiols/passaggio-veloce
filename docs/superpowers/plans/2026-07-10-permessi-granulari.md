# Permessi granulari per le utenze azienda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere a chi crea o modifica un'utenza azienda di scegliere puntualmente cosa quell'utente può fare, con 23 permessi per i dealer e 31 per le agenzie.

**Architecture:** Si aggiunge un terzo asse di autorizzazione (capability per utente) accanto a `UserRole` e `RuoloSede`, senza toccare la semantica dei due esistenti: `RuoloSede` + `SedeScope` continuano a rispondere a «su quali record», i permessi rispondono a «quali azioni». I permessi vivono in `User.permessi` (scalar list Postgres) come snapshot esplicito, si risolvono nel `SessionContext` a ogni richiesta e si applicano su cinque livelli: sidebar, pagina, server action, route API, componente.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 5.22 + Postgres 17, NextAuth v5, Vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-07-10-permessi-granulari-design.md`

**Branch:** `feat/permessi-granulari` (già creato, contiene il commit della spec)

## Global Constraints

- **Node 22.15.0.** Dopo un riavvio la shell torna a Node 16: lanciare `nvm use 22.15.0` prima di qualunque comando pnpm.
- **Test:** `pnpm --filter piattaforma exec vitest run <path>` per un singolo file, `pnpm --filter piattaforma test` per tutta la suite.
- **`vitest.config.ts` raccoglie solo `src/**/*.test.ts` con `environment: 'node'`.** Un file `.test.tsx` verrebbe ignorato in silenzio. Niente component test: la logica sta in moduli puri. Non toccare la config.
- **`__dirname` non esiste** nei test (ESM): usare `path.dirname(fileURLToPath(import.meta.url))`.
- **`Permesso` è una union letterale**, non `string`. Un refuso in un gate non deve compilare.
- **Typecheck:** `pnpm typecheck` funziona solo a cache calda (con `tsbuildinfo`). A cache fredda `tsc` va in stack overflow e produce falsi errori Prisma: non fidarsi di un typecheck lanciato da zero.
- **DB locale:** container `postgres:17-alpine` (`pnpm db:up`), è una copia di prod. Le password del seed **non** valgono.
- **Migration:** `pnpm --filter @pv/db db:migrate` in locale; in prod `db:deploy` a mano.
- **Nessun colore hardcodato:** usare la palette Trust Blue e i componenti di `apps/piattaforma/src/components/ui`.
- **Fail-closed sempre:** un permesso assente o sconosciuto nega. Mai filtrare silenziosamente un set non consentito: rifiutare con errore.
- **Ordine dei controlli in ogni server action:** autenticazione → permesso → scope.
- Commit in italiano, uno per task, con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

**Creati**

| File | Responsabilità |
|---|---|
| `apps/piattaforma/src/lib/auth/permessi/catalogo.ts` | chiavi, categorie, etichette IT, dipendenze, filtro per `companyType` |
| `apps/piattaforma/src/lib/auth/permessi/preset.ts` | i tre preset per dealer e agenzia, riconoscimento del preset |
| `apps/piattaforma/src/lib/auth/permessi/backfill.ts` | set di permessi per gli utenti già esistenti |
| `apps/piattaforma/src/lib/auth/permessi/check.ts` | `can()`, `assignablePermessi()`, `validaPermessi()` |
| `apps/piattaforma/src/lib/auth/permessi/guard.ts` | `requirePermesso()`, `assertPermesso()` (`server-only`) |
| `apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.ts` | ogni server action azienda → permesso che la protegge |
| `apps/piattaforma/src/components/permessi/nav-filter.ts` | filtro puro delle voci di sidebar |
| `apps/piattaforma/src/components/permessi/matrice-logic.ts` | cascata delle dipendenze della matrice, pura |
| `apps/piattaforma/src/components/permessi/matrice-permessi.tsx` | la matrice a accordion, guscio client |
| `apps/piattaforma/scripts/backfill-permessi.ts` | script one-shot di popolamento |

**Modificati**

| File | Modifica |
|---|---|
| `packages/db/prisma/schema.prisma` | `permessi String[]` su `User` e `Invitation` |
| `apps/piattaforma/src/lib/auth/session-context.ts` | carica `permessi` nel context |
| `apps/piattaforma/src/lib/sedi/scope.ts` | `canEditSedeSettings`/`canManageSedeTeam` degradati a scope |
| `apps/piattaforma/src/app/team/actions.ts` | accetta e valida i permessi, anti-escalation |
| `apps/piattaforma/src/app/{wallet,sedi,orari,pratiche,inbox,fatturazione,blocco-pagamento}/actions.ts` | `requirePermesso` |
| `apps/piattaforma/src/app/**/page.tsx` (aree azienda) | `assertPermesso` |
| `apps/piattaforma/src/app/api/{fatturazione,pratiche,documenti}/**/route.ts` | gate esplicito, `403` |
| `apps/piattaforma/src/components/{broker/broker-shell,agenzia/agenzia-shell,app-shell}.tsx` | voci filtrate per permesso |
| `apps/piattaforma/src/app/team/{create-user-form,invite-form}.tsx`, `team/[userId]/edit/edit-form.tsx` | integrano la matrice |

---

### Task 1: Catalogo dei permessi

**Files:**
- Create: `apps/piattaforma/src/lib/auth/permessi/catalogo.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/catalogo.test.ts`

**Interfaces:**
- Consumes: nulla.
- Produces: `type Permesso`, `type CompanyTypeP = 'DEALER' | 'AGENZIA'`, `type PermessoDef`, `type CategoriaDef`, `CATALOGO: CategoriaDef[]`, `catalogoPerTipo(t): CategoriaDef[]`, `permessiPerTipo(t): Permesso[]`, `isPermesso(x): x is Permesso`, `dipendenzaDi(p): Permesso | undefined`, `conDipendenze(ps): Permesso[]`.

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/lib/auth/permessi/catalogo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CATALOGO,
  PERMESSI,
  catalogoPerTipo,
  permessiPerTipo,
  isPermesso,
  dipendenzaDi,
  conDipendenze,
} from './catalogo';

describe('catalogo permessi', () => {
  it('un dealer ha 23 permessi, un agenzia 31', () => {
    expect(permessiPerTipo('DEALER')).toHaveLength(23);
    expect(permessiPerTipo('AGENZIA')).toHaveLength(31);
  });

  it('le categorie solo-agenzia non compaiono per un dealer', () => {
    const idsDealer = catalogoPerTipo('DEALER').map((c) => c.id);
    expect(idsDealer).not.toContain('inbox');
    expect(idsDealer).not.toContain('pagamenti');
    expect(catalogoPerTipo('AGENZIA').map((c) => c.id)).toContain('inbox');
  });

  it('i permessi solo-dealer non compaiono per un agenzia', () => {
    expect(permessiPerTipo('AGENZIA')).not.toContain('pratiche.create');
    expect(permessiPerTipo('DEALER')).toContain('pratiche.create');
    expect(permessiPerTipo('DEALER')).not.toContain('pratiche.firma');
  });

  it('ogni chiave del catalogo è unica', () => {
    const chiavi = CATALOGO.flatMap((c) => c.permessi.map((p) => p.chiave));
    expect(new Set(chiavi).size).toBe(chiavi.length);
  });

  it('PERMESSI e CATALOGO non divergono', () => {
    // `Permesso` deriva dalla tupla PERMESSI; il CATALOGO è la sua descrizione.
    // Se le due liste si separano, il tipo mente. Questo test lo impedisce.
    const chiavi = CATALOGO.flatMap((c) => c.permessi.map((p) => p.chiave));
    expect([...chiavi].sort()).toEqual([...PERMESSI].sort());
  });

  it('ogni dipendenza punta a una chiave esistente e dello stesso companyType', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      const chiavi = permessiPerTipo(t);
      for (const p of chiavi) {
        const dip = dipendenzaDi(p);
        if (dip) expect(chiavi).toContain(dip);
      }
    }
  });

  it('isPermesso rifiuta una chiave inventata', () => {
    expect(isPermesso('pratiche.view')).toBe(true);
    expect(isPermesso('pratiche.tuttofare')).toBe(false);
  });

  it('conDipendenze risale la catena fino alla radice', () => {
    // sede.iban → sede.edit → sede.view
    expect(conDipendenze(['sede.iban']).sort()).toEqual(
      ['sede.edit', 'sede.iban', 'sede.view'].sort(),
    );
    // fatture.download → fatture.view
    expect(conDipendenze(['fatture.download']).sort()).toEqual(
      ['fatture.download', 'fatture.view'].sort(),
    );
  });

  it('le sei azioni sensibili sono marcate', () => {
    const sensibili = CATALOGO.flatMap((c) => c.permessi)
      .filter((p) => p.sensibile)
      .map((p) => p.chiave)
      .sort();
    expect(sensibili).toEqual(
      [
        'pagamenti.iban',
        'pratiche.firma',
        'pratiche.segnala',
        'sede.iban',
        'team.permessi',
        'wallet.payout',
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/catalogo.test.ts`
Expected: FAIL — `Failed to resolve import "./catalogo"`.

- [ ] **Step 3: Scrivere il catalogo**

File `apps/piattaforma/src/lib/auth/permessi/catalogo.ts`. Nessun `server-only`: la matrice UI lo importa lato client.

```ts
/**
 * Catalogo dei permessi granulari per gli utenti azienda (dealer/agenzia).
 * Unica fonte di verità: chiavi, etichette, dipendenze e appartenenza al
 * companyType. Spec: docs/superpowers/specs/2026-07-10-permessi-granulari-design.md
 *
 * I poteri owner-only (creare sedi, firmare il mandato, anagrafica azienda,
 * rendiconto madre) NON stanno qui: non sono delegabili.
 */

export type CompanyTypeP = 'DEALER' | 'AGENZIA';

/**
 * Le 30 chiavi valide. `Permesso` deriva da qui, non dal CATALOGO: le voci senza
 * `soloPer` non hanno la proprietà sotto `as const`, e ogni accesso diventerebbe
 * un `'soloPer' in p`. Il test «PERMESSI e CATALOGO non divergono» tiene allineate
 * le due liste.
 */
export const PERMESSI = [
  'pratiche.view',
  'pratiche.download',
  'pratiche.create',
  'pratiche.annulla',
  'pratiche.valuta',
  'pratiche.processa',
  'pratiche.firma',
  'pratiche.segnala',
  'inbox.view',
  'inbox.gestisci',
  'wallet.view',
  'wallet.payout',
  'wallet.soglia',
  'fatture.view',
  'fatture.download',
  'fatture.xml',
  'addebiti.view',
  'pagamenti.ritenta',
  'pagamenti.iban',
  'affiliazione.view',
  'feedback.view',
  'sede.view',
  'sede.edit',
  'sede.iban',
  'orari.view',
  'orari.edit',
  'team.view',
  'team.invita',
  'team.crea',
  'team.modifica',
  'team.reset_password',
  'team.disabilita',
  'team.permessi',
  'notifiche.view',
] as const;

/** Un refuso in un gate — `requirePermesso('wallet.payuot')` — non compila. */
export type Permesso = (typeof PERMESSI)[number];

export type PermessoDef = {
  chiave: Permesso;
  etichetta: string;
  /** Mostrata accanto alla casella: spiega la conseguenza di un'azione sensibile. */
  nota?: string;
  sensibile?: boolean;
  /** Permesso padre: concederlo implica concedere il padre. Tipizzato: niente refusi. */
  richiede?: Permesso;
  /** Se assente, il permesso vale per entrambi i companyType. */
  soloPer?: CompanyTypeP;
};

export type CategoriaDef = {
  id: string;
  etichetta: string;
  soloPer?: CompanyTypeP;
  permessi: PermessoDef[];
};

export const CATALOGO: CategoriaDef[] = [
  {
    id: 'pratiche',
    etichetta: 'Pratiche',
    permessi: [
      { chiave: 'pratiche.view', etichetta: 'Vede le pratiche della sua sede' },
      { chiave: 'pratiche.download', etichetta: 'Scarica documenti in PDF e ZIP', richiede: 'pratiche.view' },
      { chiave: 'pratiche.create', etichetta: 'Crea e invia pratiche', richiede: 'pratiche.view', soloPer: 'DEALER' },
      { chiave: 'pratiche.annulla', etichetta: 'Annulla una pratica', richiede: 'pratiche.view', soloPer: 'DEALER' },
      { chiave: 'pratiche.valuta', etichetta: "Valuta l'agenzia", richiede: 'pratiche.view', soloPer: 'DEALER' },
      { chiave: 'pratiche.processa', etichetta: 'Segna una pratica processata', richiede: 'pratiche.view', soloPer: 'AGENZIA' },
      {
        chiave: 'pratiche.firma',
        etichetta: 'Segna una pratica firmata',
        nota: 'accredita il wallet e genera la fattura',
        sensibile: true,
        richiede: 'pratiche.view',
        soloPer: 'AGENZIA',
      },
      {
        chiave: 'pratiche.segnala',
        etichetta: 'Segnala un problema sulla pratica',
        nota: 'apre una penale di €25 al broker',
        sensibile: true,
        richiede: 'pratiche.view',
        soloPer: 'AGENZIA',
      },
    ],
  },
  {
    id: 'inbox',
    etichetta: 'Inbox',
    soloPer: 'AGENZIA',
    permessi: [
      { chiave: 'inbox.view', etichetta: 'Vede le pratiche in arrivo' },
      { chiave: 'inbox.gestisci', etichetta: 'Accetta o rifiuta le assegnazioni', richiede: 'inbox.view' },
    ],
  },
  {
    id: 'wallet',
    etichetta: 'Wallet',
    permessi: [
      { chiave: 'wallet.view', etichetta: 'Vede saldo e movimenti' },
      {
        chiave: 'wallet.payout',
        etichetta: 'Richiede il payout',
        nota: 'preleva denaro reale dal wallet',
        sensibile: true,
        richiede: 'wallet.view',
      },
      { chiave: 'wallet.soglia', etichetta: 'Modifica la soglia di auto-payout', richiede: 'wallet.view' },
    ],
  },
  {
    id: 'fatture',
    etichetta: 'Fatture',
    permessi: [
      { chiave: 'fatture.view', etichetta: 'Vede la sezione fatture' },
      { chiave: 'fatture.download', etichetta: 'Scarica PDF e ZIP', richiede: 'fatture.view' },
      { chiave: 'fatture.xml', etichetta: 'Scarica XML FatturaPA', nota: 'per il commercialista', richiede: 'fatture.view' },
    ],
  },
  {
    id: 'pagamenti',
    etichetta: 'Addebiti e pagamenti',
    soloPer: 'AGENZIA',
    permessi: [
      { chiave: 'addebiti.view', etichetta: 'Vede lo storico degli addebiti' },
      { chiave: 'pagamenti.ritenta', etichetta: 'Ritenta un addebito fallito' },
      {
        chiave: 'pagamenti.iban',
        etichetta: "Cambia l'IBAN e ricrea il mandato SEPA",
        nota: 'cambia il conto addebitato',
        sensibile: true,
        richiede: 'pagamenti.ritenta',
      },
    ],
  },
  {
    id: 'crescita',
    etichetta: 'Crescita',
    permessi: [
      { chiave: 'affiliazione.view', etichetta: 'Vede link e statistiche di affiliazione' },
      { chiave: 'feedback.view', etichetta: 'Vede le valutazioni ricevute', soloPer: 'AGENZIA' },
    ],
  },
  {
    id: 'sede',
    etichetta: 'Sede',
    permessi: [
      { chiave: 'sede.view', etichetta: 'Vede le impostazioni della sede' },
      { chiave: 'sede.edit', etichetta: 'Modifica anagrafica e soglia payout', richiede: 'sede.view' },
      {
        chiave: 'sede.iban',
        etichetta: "Modifica l'IBAN della sede",
        nota: 'cambia il conto su cui arrivano i payout',
        sensibile: true,
        richiede: 'sede.edit',
      },
      { chiave: 'orari.view', etichetta: 'Vede gli orari di apertura', soloPer: 'AGENZIA' },
      { chiave: 'orari.edit', etichetta: 'Modifica gli orari di apertura', richiede: 'orari.view', soloPer: 'AGENZIA' },
    ],
  },
  {
    id: 'team',
    etichetta: 'Team',
    permessi: [
      { chiave: 'team.view', etichetta: 'Vede la sezione team' },
      { chiave: 'team.invita', etichetta: 'Invia inviti via email', richiede: 'team.view' },
      { chiave: 'team.crea', etichetta: 'Crea utenti con password impostata', richiede: 'team.view' },
      { chiave: 'team.modifica', etichetta: 'Modifica i dati di un utente', richiede: 'team.view' },
      { chiave: 'team.reset_password', etichetta: 'Genera una password temporanea', richiede: 'team.view' },
      { chiave: 'team.disabilita', etichetta: 'Disabilita utenti e revoca inviti', richiede: 'team.view' },
      {
        chiave: 'team.permessi',
        etichetta: 'Assegna permessi ad altri utenti',
        nota: 'permette di delegare i propri poteri',
        sensibile: true,
        richiede: 'team.view',
      },
    ],
  },
  {
    id: 'notifiche',
    etichetta: 'Notifiche',
    permessi: [{ chiave: 'notifiche.view', etichetta: "Vede lo storico notifiche dell'azienda" }],
  },
];

const TUTTE_LE_DEF: PermessoDef[] = CATALOGO.flatMap((c) =>
  c.permessi.map((p) => ({ ...p, soloPer: p.soloPer ?? c.soloPer })),
);

const BY_CHIAVE = new Map<string, PermessoDef>(TUTTE_LE_DEF.map((p) => [p.chiave, p]));

/** Narrowing al confine: righe del DB e campi dei form arrivano come `string`. */
export function isPermesso(x: string): x is Permesso {
  return BY_CHIAVE.has(x);
}

export function dipendenzaDi(p: Permesso): Permesso | undefined {
  return BY_CHIAVE.get(p)?.richiede;
}

function vale(def: { soloPer?: CompanyTypeP }, t: CompanyTypeP): boolean {
  return def.soloPer === undefined || def.soloPer === t;
}

export function catalogoPerTipo(t: CompanyTypeP): CategoriaDef[] {
  return CATALOGO.filter((c) => vale(c, t))
    .map((c) => ({ ...c, permessi: c.permessi.filter((p) => vale({ soloPer: p.soloPer ?? c.soloPer }, t)) }))
    .filter((c) => c.permessi.length > 0);
}

export function permessiPerTipo(t: CompanyTypeP): Permesso[] {
  return catalogoPerTipo(t).flatMap((c) => c.permessi.map((p) => p.chiave));
}

/** Chiude il set risalendo la catena dei padri: `sede.iban` → `sede.edit` → `sede.view`. */
export function conDipendenze(permessi: Permesso[]): Permesso[] {
  const out = new Set<Permesso>();
  for (const p of permessi) {
    let cur: Permesso | undefined = p;
    while (cur && !out.has(cur)) {
      out.add(cur);
      cur = dipendenzaDi(cur);
    }
  }
  return [...out];
}

/** Figli diretti di un permesso: usati dalla UI per spegnere a cascata. */
export function figliDi(p: Permesso): Permesso[] {
  return TUTTE_LE_DEF.filter((d) => d.richiede === p).map((d) => d.chiave);
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/catalogo.test.ts`
Expected: PASS, 9 test.

Se il conteggio 23/31 fallisce, contare: dealer = pratiche 5 + wallet 3 + fatture 3 + crescita 1 + sede 3 + team 7 + notifiche 1. Agenzia = pratiche 5 + inbox 2 + wallet 3 + fatture 3 + pagamenti 3 + crescita 2 + sede 5 + team 7 + notifiche 1.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/catalogo.ts apps/piattaforma/src/lib/auth/permessi/catalogo.test.ts
git commit -m "feat(permessi): catalogo delle capability azienda con dipendenze"
```

---

### Task 2: Preset di sistema

**Files:**
- Create: `apps/piattaforma/src/lib/auth/permessi/preset.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/preset.test.ts`

**Interfaces:**
- Consumes: `permessiPerTipo`, `conDipendenze`, `type CompanyTypeP`, `type Permesso` da `./catalogo`.
- Produces: `type PresetId = 'OPERATORE_BASE' | 'OPERATORE_COMPLETO' | 'ADMIN_SEDE'`, `preset(id, t): Permesso[]`, `riconoscePreset(permessi, t): PresetId | null`, `PRESET_ETICHETTE: Record<PresetId, string>`.

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/lib/auth/permessi/preset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { preset, riconoscePreset } from './preset';
import { permessiPerTipo, dipendenzaDi } from './catalogo';

describe('preset', () => {
  it('ADMIN_SEDE contiene tutti i permessi del suo companyType', () => {
    expect(preset('ADMIN_SEDE', 'DEALER').sort()).toEqual(permessiPerTipo('DEALER').sort());
    expect(preset('ADMIN_SEDE', 'AGENZIA').sort()).toEqual(permessiPerTipo('AGENZIA').sort());
  });

  it('ogni preset contiene solo chiavi valide per il suo companyType', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      const validi = permessiPerTipo(t);
      for (const id of ['OPERATORE_BASE', 'OPERATORE_COMPLETO', 'ADMIN_SEDE'] as const) {
        for (const p of preset(id, t)) expect(validi).toContain(p);
      }
    }
  });

  it('ogni preset è chiuso rispetto alle dipendenze', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      for (const id of ['OPERATORE_BASE', 'OPERATORE_COMPLETO', 'ADMIN_SEDE'] as const) {
        const set = preset(id, t);
        for (const p of set) {
          const dip = dipendenzaDi(p);
          if (dip) expect(set).toContain(dip);
        }
      }
    }
  });

  it('OPERATORE_BASE dealer crea pratiche ma non vede il wallet', () => {
    const base = preset('OPERATORE_BASE', 'DEALER');
    expect(base).toContain('pratiche.create');
    expect(base).not.toContain('wallet.view');
    expect(base).not.toContain('team.view');
  });

  it('OPERATORE_BASE agenzia gestisce inbox ma non firma', () => {
    const base = preset('OPERATORE_BASE', 'AGENZIA');
    expect(base).toContain('inbox.gestisci');
    expect(base).toContain('pratiche.processa');
    expect(base).not.toContain('pratiche.firma');
  });

  it('OPERATORE_COMPLETO agenzia firma e segnala, ma non tocca IBAN né team', () => {
    const c = preset('OPERATORE_COMPLETO', 'AGENZIA');
    expect(c).toContain('pratiche.firma');
    expect(c).toContain('pratiche.segnala');
    expect(c).not.toContain('pagamenti.iban');
    expect(c).not.toContain('sede.iban');
    expect(c).not.toContain('team.view');
  });

  it('nessun preset di operatore contiene wallet.payout', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      expect(preset('OPERATORE_BASE', t)).not.toContain('wallet.payout');
      expect(preset('OPERATORE_COMPLETO', t)).not.toContain('wallet.payout');
    }
  });

  it('riconoscePreset identifica un set che coincide, e null altrimenti', () => {
    expect(riconoscePreset(preset('OPERATORE_BASE', 'DEALER'), 'DEALER')).toBe('OPERATORE_BASE');
    expect(riconoscePreset(preset('ADMIN_SEDE', 'AGENZIA'), 'AGENZIA')).toBe('ADMIN_SEDE');
    expect(riconoscePreset(['pratiche.view'], 'DEALER')).toBeNull();
    expect(riconoscePreset([], 'DEALER')).toBeNull();
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/preset.test.ts`
Expected: FAIL — `Failed to resolve import "./preset"`.

- [ ] **Step 3: Scrivere i preset**

File `apps/piattaforma/src/lib/auth/permessi/preset.ts`:

```ts
import { conDipendenze, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';

export type PresetId = 'OPERATORE_BASE' | 'OPERATORE_COMPLETO' | 'ADMIN_SEDE';

export const PRESET_ETICHETTE: Record<PresetId, string> = {
  OPERATORE_BASE: 'Operatore base',
  OPERATORE_COMPLETO: 'Operatore completo',
  ADMIN_SEDE: 'Admin di sede',
};

export const PRESET_IDS: PresetId[] = ['OPERATORE_BASE', 'OPERATORE_COMPLETO', 'ADMIN_SEDE'];

const BASE: Record<CompanyTypeP, Permesso[]> = {
  DEALER: ['pratiche.view', 'pratiche.create', 'pratiche.download', 'notifiche.view'],
  AGENZIA: [
    'pratiche.view',
    'pratiche.processa',
    'pratiche.download',
    'inbox.view',
    'inbox.gestisci',
    'notifiche.view',
  ],
};

const COMPLETO: Record<CompanyTypeP, Permesso[]> = {
  DEALER: [
    ...BASE.DEALER,
    'pratiche.annulla',
    'pratiche.valuta',
    'fatture.view',
    'fatture.download',
    'wallet.view',
    'affiliazione.view',
  ],
  AGENZIA: [
    ...BASE.AGENZIA,
    'pratiche.firma',
    'pratiche.segnala',
    'fatture.view',
    'fatture.download',
    'wallet.view',
    'addebiti.view',
    'affiliazione.view',
    'feedback.view',
    'orari.view',
  ],
};

/** Set di partenza in creazione utenza. Chiuso rispetto alle dipendenze. */
export function preset(id: PresetId, t: CompanyTypeP): Permesso[] {
  if (id === 'ADMIN_SEDE') return permessiPerTipo(t);
  const base = id === 'OPERATORE_BASE' ? BASE[t] : COMPLETO[t];
  return conDipendenze(base);
}

/** Il preset che coincide esattamente col set dato, altrimenti null (= personalizzato). */
export function riconoscePreset(permessi: Permesso[], t: CompanyTypeP): PresetId | null {
  const dato = [...new Set(permessi)].sort().join('|');
  if (!dato) return null;
  for (const id of PRESET_IDS) {
    if (preset(id, t).sort().join('|') === dato) return id;
  }
  return null;
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/preset.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/preset.ts apps/piattaforma/src/lib/auth/permessi/preset.test.ts
git commit -m "feat(permessi): tre preset di sistema per dealer e agenzia"
```

---

### Task 3: `check.ts` — can, assignablePermessi, validaPermessi

**Files:**
- Create: `apps/piattaforma/src/lib/auth/permessi/check.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/check.test.ts`

**Interfaces:**
- Consumes: `permessiPerTipo`, `isPermesso`, `dipendenzaDi`, `type CompanyTypeP`, `type Permesso` da `./catalogo`; `preset` da `./preset`.
- Produces:
  - `type PermessiCtx = { userId: string; isOwner: boolean; permessi: Set<string> }`
  - `can(ctx: PermessiCtx, p: Permesso): boolean`
  - `assignablePermessi(ctx: PermessiCtx, t: CompanyTypeP): Permesso[]`
  - `type ValidaResult = { ok: true; permessi: Permesso[] } | { ok: false; error: string }`
  - `validaPermessi(args: { ctx: PermessiCtx; companyType: CompanyTypeP; richiesti: string[]; targetUserId?: string; targetRole?: string }): ValidaResult`
  - `permessiPerNuovoUtente(ctx, t, richiesti?): ValidaResult`

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/lib/auth/permessi/check.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { can, assignablePermessi, validaPermessi, permessiPerNuovoUtente, type PermessiCtx } from './check';
import { permessiPerTipo, type Permesso } from './catalogo';
import { preset } from './preset';

const owner: PermessiCtx = { userId: 'owner1', isOwner: true, permessi: new Set() };
const adminSede = (permessi: Permesso[]): PermessiCtx => ({
  userId: 'admin1',
  isOwner: false,
  permessi: new Set(permessi),
});

/** Una chiave rimossa dal catalogo ma ancora presente su una riga vecchia del DB. */
const OBSOLETO = 'pratiche.tuttofare' as Permesso;

describe('can', () => {
  it("l'owner può tutto anche con il set vuoto", () => {
    expect(can(owner, 'wallet.payout')).toBe(true);
    expect(can(owner, 'sede.iban')).toBe(true);
  });

  it('un non-owner può solo ciò che ha nel set', () => {
    const ctx = adminSede(['fatture.view']);
    expect(can(ctx, 'fatture.view')).toBe(true);
    expect(can(ctx, 'fatture.download')).toBe(false);
  });

  it('una chiave non più nel catalogo è negata anche se il DB la contiene (fail-closed)', () => {
    // Un refuso scritto a mano non compila più: `can(ctx, 'wallet.payuot')` è un
    // errore di tipo. Resta il caso runtime: una riga vecchia del DB.
    expect(can(adminSede([OBSOLETO]), OBSOLETO)).toBe(false);
  });
});

describe('assignablePermessi', () => {
  it("l'owner può concedere tutto il catalogo del suo companyType", () => {
    expect(assignablePermessi(owner, 'AGENZIA').sort()).toEqual(permessiPerTipo('AGENZIA').sort());
  });

  it('un admin di sede può concedere esattamente i propri permessi', () => {
    const ctx = adminSede(['fatture.view', 'wallet.view', 'team.view', 'team.permessi']);
    expect(assignablePermessi(ctx, 'DEALER').sort()).toEqual(
      ['fatture.view', 'team.permessi', 'team.view', 'wallet.view'].sort(),
    );
  });
});

describe('validaPermessi — anti-escalation', () => {
  const base = { companyType: 'AGENZIA' as const, targetUserId: 'target1', targetRole: 'UTENTE_AZIENDA' };

  it('rifiuta un permesso che il chiamante non possiede', () => {
    const ctx = adminSede(['team.view', 'team.permessi', 'fatture.view']);
    const res = validaPermessi({ ...base, ctx, richiesti: ['fatture.view', 'fatture.xml'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('fatture.xml');
  });

  it('rifiuta una chiave sconosciuta', () => {
    const res = validaPermessi({ ...base, ctx: owner, richiesti: ['pratiche.tuttofare'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('sconosciuto');
  });

  it('rifiuta una chiave valida ma di un altro companyType', () => {
    const res = validaPermessi({ ...base, ctx: owner, richiesti: ['pratiche.view', 'pratiche.create'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('pratiche.create');
  });

  it('rifiuta un set con una dipendenza mancante', () => {
    const res = validaPermessi({ ...base, ctx: owner, richiesti: ['fatture.download'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('richiede');
  });

  it('rifiuta la modifica dei propri permessi', () => {
    const ctx = adminSede(['team.view', 'team.permessi', 'fatture.view']);
    const res = validaPermessi({ ...base, ctx, targetUserId: 'admin1', richiesti: ['fatture.view'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tuoi permessi');
  });

  it("rifiuta la modifica dei permessi dell'owner", () => {
    const res = validaPermessi({ ...base, ctx: owner, targetRole: 'ADMIN_AZIENDA', richiesti: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('titolare');
  });

  it('rifiuta chi non ha team.permessi', () => {
    const ctx = adminSede(['team.view', 'team.crea', 'fatture.view']);
    const res = validaPermessi({ ...base, ctx, richiesti: ['fatture.view'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('assegnare permessi');
  });

  it('accetta un set valido, deduplicato e ordinato', () => {
    const res = validaPermessi({
      ...base,
      ctx: owner,
      richiesti: ['fatture.download', 'fatture.view', 'fatture.view'],
    });
    expect(res).toEqual({ ok: true, permessi: ['fatture.download', 'fatture.view'] });
  });
});

describe('permessiPerNuovoUtente', () => {
  it('chi non ha team.permessi crea con il preset base intersecato ai propri permessi', () => {
    const ctx = adminSede(['team.view', 'team.crea', 'pratiche.view', 'pratiche.processa', 'notifiche.view']);
    const res = permessiPerNuovoUtente(ctx, 'AGENZIA');
    expect(res).toEqual({
      ok: true,
      permessi: ['notifiche.view', 'pratiche.processa', 'pratiche.view'],
    });
  });

  it('chi ha team.permessi ottiene esattamente ciò che ha chiesto', () => {
    const ctx = adminSede([...preset('ADMIN_SEDE', 'AGENZIA')]);
    const res = permessiPerNuovoUtente(ctx, 'AGENZIA', ['pratiche.view', 'pratiche.firma']);
    expect(res).toEqual({ ok: true, permessi: ['pratiche.firma', 'pratiche.view'] });
  });

  it("l'owner senza richiesta esplicita crea con il preset base completo", () => {
    const res = permessiPerNuovoUtente(owner, 'DEALER');
    expect(res).toEqual({ ok: true, permessi: preset('OPERATORE_BASE', 'DEALER').sort() });
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/check.test.ts`
Expected: FAIL — `Failed to resolve import "./check"`.

- [ ] **Step 3: Scrivere `check.ts`**

```ts
import { dipendenzaDi, isPermesso, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';
import { preset } from './preset';

export type PermessiCtx = {
  userId: string;
  isOwner: boolean;
  permessi: Set<Permesso>;
};

/**
 * Owner: sempre vero. Altrimenti la chiave dev'essere nel set E nel catalogo.
 * Il secondo controllo non è ridondante: difende dalle righe vecchie del DB, in
 * cui può essere rimasta una chiave che il catalogo non conosce più.
 */
export function can(ctx: PermessiCtx, p: Permesso): boolean {
  if (ctx.isOwner) return true;
  return isPermesso(p) && ctx.permessi.has(p);
}

/** Ciò che il chiamante può concedere: tutto se owner, altrimenti esattamente i propri. */
export function assignablePermessi(ctx: PermessiCtx, t: CompanyTypeP): Permesso[] {
  const tutti = permessiPerTipo(t);
  if (ctx.isOwner) return tutti;
  return tutti.filter((p) => ctx.permessi.has(p));
}

export type ValidaResult = { ok: true; permessi: Permesso[] } | { ok: false; error: string };

/**
 * Le quattro regole anti-escalation. Rifiuta con errore, non filtra in silenzio:
 * una chiave non assegnabile è un tentativo di escalation, non un refuso.
 */
export function validaPermessi(args: {
  ctx: PermessiCtx;
  companyType: CompanyTypeP;
  richiesti: string[];
  targetUserId?: string;
  targetRole?: string;
}): ValidaResult {
  const { ctx, companyType, richiesti, targetUserId, targetRole } = args;

  if (targetRole === 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Non puoi modificare i permessi del titolare' };
  }
  if (targetUserId && targetUserId === ctx.userId) {
    return { ok: false, error: 'Non puoi modificare i tuoi permessi' };
  }
  if (!can(ctx, 'team.permessi')) {
    return { ok: false, error: 'Non hai il permesso di assegnare permessi ad altri' };
  }

  const validi = new Set<Permesso>(permessiPerTipo(companyType));
  const assegnabili = new Set<Permesso>(assignablePermessi(ctx, companyType));
  const set = [...new Set(richiesti)].sort();

  // `richiesti` arriva da un form: è `string[]`. `isPermesso` lo restringe.
  const puliti: Permesso[] = [];
  for (const p of set) {
    if (!isPermesso(p)) return { ok: false, error: `Permesso sconosciuto: ${p}` };
    if (!validi.has(p)) return { ok: false, error: `Permesso non valido per questa azienda: ${p}` };
    if (!assegnabili.has(p)) {
      return { ok: false, error: `Non puoi concedere un permesso che non hai: ${p}` };
    }
    puliti.push(p);
  }
  for (const p of puliti) {
    const dip = dipendenzaDi(p);
    if (dip && !puliti.includes(dip)) {
      return { ok: false, error: `Il permesso ${p} richiede ${dip}` };
    }
  }
  return { ok: true, permessi: puliti };
}

/**
 * Permessi da assegnare a un utente in creazione.
 * Chi non ha `team.permessi` non sceglie: riceve il preset base intersecato
 * ai permessi del chiamante (non si concede ciò che non si ha).
 */
export function permessiPerNuovoUtente(
  ctx: PermessiCtx,
  companyType: CompanyTypeP,
  richiesti?: string[],
): ValidaResult {
  if (!can(ctx, 'team.permessi') || richiesti === undefined) {
    const assegnabili = new Set(assignablePermessi(ctx, companyType));
    const base = preset('OPERATORE_BASE', companyType).filter((p) => assegnabili.has(p));
    return { ok: true, permessi: base.sort() };
  }
  return validaPermessi({ ctx, companyType, richiesti });
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/check.test.ts`
Expected: PASS, 16 test.

Nota: nel test `permessiPerNuovoUtente` con l'owner il risultato è `preset('OPERATORE_BASE','DEALER').sort()` perché `assignablePermessi` dell'owner contiene tutto.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/check.ts apps/piattaforma/src/lib/auth/permessi/check.test.ts
git commit -m "feat(permessi): can, assignablePermessi e le quattro regole anti-escalation"
```

---

### Task 4: Migration, backfill e script

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `User`, model `Invitation`)
- Create: `apps/piattaforma/src/lib/auth/permessi/backfill.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/backfill.test.ts`
- Create: `apps/piattaforma/scripts/backfill-permessi.ts`

**Interfaces:**
- Consumes: `permessiPerTipo`, `conDipendenze`, `type CompanyTypeP`, `type Permesso` da `./catalogo`.
- Produces: `permessiBackfill(t: CompanyTypeP, ruoloSede: 'ADMIN_SEDE' | 'OPERATORE'): Permesso[]`.

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/lib/auth/permessi/backfill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { permessiBackfill } from './backfill';
import { permessiPerTipo, dipendenzaDi } from './catalogo';

describe('permessiBackfill', () => {
  it('un admin di sede riceve tutti i permessi del suo companyType', () => {
    expect(permessiBackfill('AGENZIA', 'ADMIN_SEDE').sort()).toEqual(permessiPerTipo('AGENZIA').sort());
    expect(permessiBackfill('DEALER', 'ADMIN_SEDE').sort()).toEqual(permessiPerTipo('DEALER').sort());
  });

  it("un operatore d'agenzia NON riceve pagamenti.iban né pagamenti.ritenta", () => {
    const p = permessiBackfill('AGENZIA', 'OPERATORE');
    expect(p).not.toContain('pagamenti.iban');
    expect(p).not.toContain('pagamenti.ritenta');
  });

  it("un operatore d'agenzia mantiene ciò che poteva fare: firma, segnala, inbox, xml", () => {
    const p = permessiBackfill('AGENZIA', 'OPERATORE');
    for (const k of [
      'pratiche.view',
      'pratiche.processa',
      'pratiche.firma',
      'pratiche.segnala',
      'pratiche.download',
      'inbox.view',
      'inbox.gestisci',
      'fatture.view',
      'fatture.download',
      'fatture.xml',
      'wallet.view',
      'addebiti.view',
      'affiliazione.view',
      'feedback.view',
      'orari.view',
      'notifiche.view',
    ]) {
      expect(p).toContain(k);
    }
    expect(p).toHaveLength(16);
  });

  it('un operatore dealer mantiene crea, annulla, valuta, xml', () => {
    const p = permessiBackfill('DEALER', 'OPERATORE');
    for (const k of [
      'pratiche.view',
      'pratiche.create',
      'pratiche.annulla',
      'pratiche.valuta',
      'pratiche.download',
      'fatture.view',
      'fatture.download',
      'fatture.xml',
      'wallet.view',
      'affiliazione.view',
      'notifiche.view',
    ]) {
      expect(p).toContain(k);
    }
    expect(p).toHaveLength(11);
  });

  it('nessun operatore riceve poteri gia oggi riservati: payout, soglia, sede, team, orari.edit', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      const p = permessiBackfill(t, 'OPERATORE');
      for (const k of ['wallet.payout', 'wallet.soglia', 'sede.view', 'sede.edit', 'sede.iban', 'team.view']) {
        expect(p).not.toContain(k);
      }
    }
    expect(permessiBackfill('AGENZIA', 'OPERATORE')).not.toContain('orari.edit');
  });

  it('il set di backfill è chiuso rispetto alle dipendenze', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      for (const r of ['ADMIN_SEDE', 'OPERATORE'] as const) {
        const set = permessiBackfill(t, r);
        for (const p of set) {
          const dip = dipendenzaDi(p);
          if (dip) expect(set).toContain(dip);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/backfill.test.ts`
Expected: FAIL — `Failed to resolve import "./backfill"`.

- [ ] **Step 3: Scrivere `backfill.ts`**

```ts
import { conDipendenze, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';

/**
 * Permessi da assegnare agli utenti che esistevano prima dell'introduzione del
 * sistema: fotografano ciò che potevano fare, con UNA restrizione voluta —
 * `pagamenti.iban` e `pagamenti.ritenta` non vanno agli operatori. Prima il gate
 * era il solo `companyType === 'AGENZIA'` (blocco-pagamento/actions.ts), quindi
 * qualunque operatore poteva cambiare l'IBAN dell'azienda.
 */
const OPERATORE: Record<CompanyTypeP, Permesso[]> = {
  DEALER: [
    'pratiche.view',
    'pratiche.create',
    'pratiche.annulla',
    'pratiche.valuta',
    'pratiche.download',
    'fatture.view',
    'fatture.download',
    'fatture.xml',
    'wallet.view',
    'affiliazione.view',
    'notifiche.view',
  ],
  AGENZIA: [
    'pratiche.view',
    'pratiche.processa',
    'pratiche.firma',
    'pratiche.segnala',
    'pratiche.download',
    'inbox.view',
    'inbox.gestisci',
    'fatture.view',
    'fatture.download',
    'fatture.xml',
    'wallet.view',
    'addebiti.view',
    'affiliazione.view',
    'feedback.view',
    'orari.view',
    'notifiche.view',
  ],
};

export function permessiBackfill(
  t: CompanyTypeP,
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE',
): Permesso[] {
  if (ruoloSede === 'ADMIN_SEDE') return permessiPerTipo(t);
  return conDipendenze(OPERATORE[t]);
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/backfill.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Aggiungere i campi allo schema Prisma**

In `packages/db/prisma/schema.prisma`, dentro `model User` (accanto a `notifPrefs`, riga ~524):

```prisma
  /// Permessi granulari (chiavi del catalogo lib/auth/permessi/catalogo.ts).
  /// Snapshot esplicito: nessuna eredita' dal ruolo. Ignorato per ADMIN_AZIENDA
  /// (owner: pieni poteri impliciti). Vuoto per gli utenti PV (companyId null).
  permessi String[] @default([])
```

Dentro `model Invitation`, accanto a `ruoloSede`:

```prisma
  /// Permessi che l'utente ricevera' accettando l'invito.
  permessi String[] @default([])
```

- [ ] **Step 6: Generare la migration e verificare che sia additiva**

```bash
pnpm db:up
pnpm --filter @pv/db db:migrate -- --name permessi_granulari
```

Aprire il file SQL generato sotto `packages/db/prisma/migrations/<timestamp>_permessi_granulari/migration.sql`.
Expected: solo due `ALTER TABLE ... ADD COLUMN "permessi" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`. **Nessun `DROP`.** Se compare un `DROP`, fermarsi: lo schema locale è divergente da prod.

- [ ] **Step 7: Scrivere lo script di backfill**

File `apps/piattaforma/scripts/backfill-permessi.ts`:

```ts
/**
 * Backfill one-shot dei permessi granulari. Va eseguito PRIMA del deploy del
 * codice con i gate attivi, altrimenti ogni operatore resta senza poteri per la
 * durata del rilascio.
 *
 *   pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts --dry-run
 *   pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts
 */
import { prisma } from '@pv/db';
import { permessiBackfill } from '../src/lib/auth/permessi/backfill';
import type { CompanyTypeP } from '../src/lib/auth/permessi/catalogo';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const utenti = await prisma.user.findMany({
    where: { companyId: { not: null } },
    select: {
      id: true,
      email: true,
      role: true,
      company: { select: { type: true } },
      sedi: { select: { ruolo: true } },
    },
  });

  let owner = 0;
  let aggiornati = 0;
  let saltati = 0;

  for (const u of utenti) {
    if (u.role === 'ADMIN_AZIENDA') {
      owner++;
      continue; // pieni poteri impliciti: il campo non viene mai letto
    }
    const tipo = u.company?.type as CompanyTypeP | undefined;
    if (!tipo) {
      console.warn(`SALTATO ${u.email}: azienda senza type`);
      saltati++;
      continue;
    }
    const membership = u.sedi[0];
    if (!membership) {
      console.warn(`SALTATO ${u.email}: nessuna membership di sede`);
      saltati++;
      continue;
    }
    const permessi = permessiBackfill(tipo, membership.ruolo as 'ADMIN_SEDE' | 'OPERATORE');
    console.log(`${u.email} [${tipo}/${membership.ruolo}] → ${permessi.length} permessi`);
    if (!dryRun) {
      await prisma.user.update({ where: { id: u.id }, data: { permessi } });
    }
    aggiornati++;
  }

  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}owner ignorati: ${owner} · aggiornati: ${aggiornati} · saltati: ${saltati}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Se la relazione `User.sedi` ha un nome diverso nello schema, correggere il `select`: verificarlo con `grep -n "UserSede\[\]" packages/db/prisma/schema.prisma`.

- [ ] **Step 8: Eseguire il dry-run sul DB locale**

```bash
pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts --dry-run
```

Expected: una riga per utente non-owner, con conteggio 11 per gli operatori dealer, 16 per gli operatori agenzia, 23/31 per gli admin di sede. Nessun errore. Il DB locale è una copia di prod, quindi il conteggio è indicativo di quello che accadrà.

- [ ] **Step 9: Eseguire il backfill sul DB locale e verificare**

```bash
pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c "SELECT role, cardinality(permessi) AS n, count(*) FROM \"User\" GROUP BY 1,2 ORDER BY 1,2;"
```

Il servizio si chiama `postgres` e l'utente è `pv` (vedi `docker-compose.yml`).

Expected: gli `ADMIN_AZIENDA` hanno `n = 0`, gli `UTENTE_AZIENDA` hanno `n` in {11, 16, 23, 31}.

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/piattaforma/src/lib/auth/permessi/backfill.ts apps/piattaforma/src/lib/auth/permessi/backfill.test.ts apps/piattaforma/scripts/backfill-permessi.ts
git commit -m "feat(permessi): campo User.permessi, migration additiva e script di backfill"
```

---

### Task 5: SessionContext e guard

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/session-context.ts`
- Create: `apps/piattaforma/src/lib/auth/permessi/guard.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/guard.test.ts`

**Interfaces:**
- Consumes: `getSessionContext` da `@/lib/auth/session-context`; `can` da `./check`.
- Produces:
  - `SessionContext.permessi: Set<string>` (nuovo campo)
  - `SessionContext.companyType: CompanyTypeP | undefined` (nuovo campo)
  - `permessiCtx(): Promise<PermessiCtx | null>` in `guard.ts`
  - `hasPermesso(p): Promise<boolean>`
  - `requirePermesso(p): Promise<{ ok: true } | { ok: false; error: string }>` — per le server action
  - `assertPermesso(p): Promise<void>` — per le pagine, fa `redirect('/dashboard')`

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/lib/auth/permessi/guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, redirectMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import { hasPermesso, requirePermesso, assertPermesso } from './guard';

beforeEach(() => vi.clearAllMocks());

const ctx = (over: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA',
  isOwner: false,
  permessi: new Set(['wallet.view']),
  ...over,
});

describe('hasPermesso', () => {
  it('vero se il permesso è nel set', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    expect(await hasPermesso('wallet.view')).toBe(true);
  });

  it('falso se manca', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    expect(await hasPermesso('wallet.payout')).toBe(false);
  });

  it("vero sempre per l'owner", async () => {
    getSessionContextMock.mockResolvedValue(ctx({ isOwner: true, permessi: new Set() }));
    expect(await hasPermesso('wallet.payout')).toBe(true);
  });

  it('falso se non autenticato', async () => {
    getSessionContextMock.mockResolvedValue(null);
    expect(await hasPermesso('wallet.view')).toBe(false);
  });
});

describe('requirePermesso', () => {
  it('ok quando il permesso c’è', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    expect(await requirePermesso('wallet.view')).toEqual({ ok: true });
  });

  it('errore quando manca, senza lanciare', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    const res = await requirePermesso('wallet.payout');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Non hai i permessi per questa azione');
  });

  it('errore quando non autenticato', async () => {
    getSessionContextMock.mockResolvedValue(null);
    const res = await requirePermesso('wallet.view');
    expect(res.ok).toBe(false);
  });
});

describe('assertPermesso', () => {
  it('non redirige quando il permesso c’è', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    await assertPermesso('wallet.view');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirige a /dashboard quando manca', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    await expect(assertPermesso('wallet.payout')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/guard.test.ts`
Expected: FAIL — `Failed to resolve import "./guard"`.

- [ ] **Step 3: Estendere `SessionContext`**

In `apps/piattaforma/src/lib/auth/session-context.ts`.

Aggiungere all'import di riga 4-6:

```ts
import { isPermesso, type CompanyTypeP, type Permesso } from '@/lib/auth/permessi/catalogo';
```

Estendere il type (dopo `membershipRuoli`, riga 40):

```ts
  /** Tipo azienda: filtra il catalogo dei permessi. */
  companyType: CompanyTypeP | undefined;
  /** Capability granulari. Vuoto per l'owner: `can()` gli dà tutto comunque. */
  permessi: Set<Permesso>;
```

Nel ramo `!companyId` (righe 56-66), aggiungere ai campi di ritorno:

```ts
      companyType: undefined,
      permessi: new Set<Permesso>(),
```

Sostituire il `Promise.all` di riga 68 con — quattro query in parallelo, non tre più una in coda:

```ts
  const [companySedi, memberships, dbUser, company] = await Promise.all([
    prisma.sede.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, nome: true, type: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.userSede.findMany({
      where: { userId: user.id, sede: { companyId, deletedAt: null } },
      select: { sedeId: true, ruolo: true },
    }),
    // L'owner ha pieni poteri impliciti: non serve leggere il campo.
    isOwner
      ? Promise.resolve(null)
      : prisma.user.findUnique({ where: { id: user.id }, select: { permessi: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { type: true } }),
  ]);
```

Nel `return` finale (riga 93):

```ts
  return {
    user,
    companyId,
    isOwner,
    accessibleSedi,
    currentSede,
    scopeIds,
    membershipRuoli,
    companyType: (company?.type ?? undefined) as CompanyTypeP | undefined,
    // Il confine col DB: una chiave rimossa dal catalogo non entra nel set.
    permessi: new Set((dbUser?.permessi ?? []).filter(isPermesso)),
  };
```

Nota: `session.user.companyType` esiste già nel JWT (`auth.ts:121`), ma non è affidabile per un utente la cui azienda cambi tipo; qui serve solo a filtrare il catalogo, quindi si legge dal DB nella stessa richiesta cached.

- [ ] **Step 4: Scrivere `guard.ts`**

```ts
import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session-context';
import { can, type PermessiCtx } from './check';
import type { Permesso } from './catalogo';

/** Il contesto ridotto che serve a `can()`. Null se non autenticato. */
export async function permessiCtx(): Promise<PermessiCtx | null> {
  const ctx = await getSessionContext();
  if (!ctx?.user) return null;
  return { userId: ctx.user.id, isOwner: ctx.isOwner, permessi: ctx.permessi };
}

export async function hasPermesso(p: Permesso): Promise<boolean> {
  const ctx = await permessiCtx();
  if (!ctx) return false;
  return can(ctx, p);
}

/** Gate per le server action: ritorna un result, non lancia. */
export async function requirePermesso(
  p: Permesso,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await hasPermesso(p)) return { ok: true };
  return { ok: false, error: 'Non hai i permessi per questa azione' };
}

/** Gate per le pagine: rimanda alla dashboard. */
export async function assertPermesso(p: Permesso): Promise<void> {
  if (!(await hasPermesso(p))) redirect('/dashboard');
}
```

- [ ] **Step 5: Lanciare i test e verificare che passino**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/`
Expected: PASS, tutti e quattro i file (catalogo, preset, check, backfill, guard).

- [ ] **Step 6: Verificare che i test esistenti non si rompano**

Run: `pnpm --filter piattaforma test`
Expected: PASS. Gli `*.authz.test.ts` mockano `getSessionContext` restituendo oggetti senza `permessi`: se qualcuno legge `ctx.permessi` senza guardia romperà. In questo task nessuno lo fa ancora, quindi devono passare tutti. Se falliscono, il mock va aggiornato con `permessi: new Set()` — non aggirare l'errore con `?.`.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/auth/session-context.ts apps/piattaforma/src/lib/auth/permessi/guard.ts apps/piattaforma/src/lib/auth/permessi/guard.test.ts
git commit -m "feat(permessi): risoluzione nel SessionContext e guard per action e pagine"
```

---

### Task 6: Team — assegnazione dei permessi e anti-escalation

**Files:**
- Modify: `apps/piattaforma/src/app/team/actions.ts`
- Test: `apps/piattaforma/src/app/team/actions.authz.test.ts` (estendere)
- Create: `apps/piattaforma/src/app/team/permessi.authz.test.ts`

**Interfaces:**
- Consumes: `validaPermessi`, `permessiPerNuovoUtente`, `can`, `type PermessiCtx` da `@/lib/auth/permessi/check`; `requirePermesso` da `@/lib/auth/permessi/guard`.
- Produces: firme aggiornate delle server action:
  - `createUserDirectAction(email, nome, cognome, password, sedeId?, ruoloSede?, permessi?: string[])`
  - `createInvitationAction(email, sedeId?, ruoloSede?, permessi?: string[])`
  - `updateTeamUserAction(userId, email, nome, cognome, sedeId?, ruoloSede?, permessi?: string[])`

Il parametro `permessi` è **opzionale e in ultima posizione**: i chiamanti esistenti continuano a compilare.

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/app/team/permessi.authz.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn(() => Promise.resolve({ ragioneSociale: 'Acme', type: 'AGENZIA' })) },
    sede: { findFirst: vi.fn() },
    userSede: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('@/auth', () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: 'u1' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/providers/email', () => ({ getEmail: () => ({ send: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(() => Promise.resolve('hash')) }));

import { createUserDirectAction, updateTeamUserAction, acceptInvitationAction } from './actions';

const sede = (id: string) => ({ id, nome: id, type: 'AGENZIA' as const });

const ctxAdminSede = (permessi: string[]) => ({
  user: { id: 'admin1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: false,
  accessibleSedi: [sede('s1')],
  membershipRuoli: { s1: 'ADMIN_SEDE' as const },
  permessi: new Set(permessi),
});

const ctxOwner = () => ({
  user: { id: 'owner1', role: 'ADMIN_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: true,
  accessibleSedi: [sede('s1')],
  membershipRuoli: {},
  permessi: new Set<string>(),
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' });
});

describe('createUserDirectAction — permessi', () => {
  it("l'owner crea un utente con i permessi richiesti", async () => {
    getSessionContextMock.mockResolvedValue(ctxOwner());
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE',
      ['pratiche.view', 'pratiche.firma'],
    );
    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ permessi: ['pratiche.firma', 'pratiche.view'] }),
      }),
    );
  });

  it('un admin di sede non può concedere un permesso che non ha', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.crea', 'team.permessi', 'pratiche.view']),
    );
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE',
      ['pratiche.view', 'pratiche.firma'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('pratiche.firma');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('chi non ha team.crea non crea nemmeno con permessi validi', async () => {
    getSessionContextMock.mockResolvedValue(ctxAdminSede(['team.view']));
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE', ['pratiche.view'],
    );
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('chi ha team.crea ma non team.permessi crea col preset base intersecato ai propri', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.crea', 'pratiche.view', 'pratiche.processa', 'notifiche.view']),
    );
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          permessi: ['notifiche.view', 'pratiche.processa', 'pratiche.view'],
        }),
      }),
    );
  });
});

describe('updateTeamUserAction — permessi', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'target1', companyId: 'c1', role: 'UTENTE_AZIENDA', email: 'a@y.it',
    });
    prismaMock.userSede.findFirst.mockResolvedValue({ id: 'us1', sedeId: 's1' });
    prismaMock.sede.findFirst.mockResolvedValue({ id: 's1' });
  });

  it('nessuno modifica i propri permessi', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.modifica', 'team.permessi', 'pratiche.view']),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'admin1', companyId: 'c1', role: 'UTENTE_AZIENDA', email: 'admin@y.it',
    });
    const res = await updateTeamUserAction(
      'admin1', 'admin@y.it', 'Ad', 'Min', 's1', 'ADMIN_SEDE', ['pratiche.view'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tuoi permessi');
  });

  it("nessuno modifica i permessi dell'owner", async () => {
    getSessionContextMock.mockResolvedValue(ctxOwner());
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'owner1', companyId: 'c1', role: 'ADMIN_AZIENDA', email: 'own@y.it',
    });
    const res = await updateTeamUserAction(
      'owner1', 'own@y.it', 'Ow', 'Ner', 's1', 'ADMIN_SEDE', ['pratiche.view'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('titolare');
  });

  it('omettere i permessi lascia intatti quelli esistenti', async () => {
    getSessionContextMock.mockResolvedValue(ctxOwner());
    const res = await updateTeamUserAction('target1', 'a@y.it', 'Ann', 'Bee', 's1', 'OPERATORE');
    expect(res.ok).toBe(true);
    const dati = prismaMock.user.update.mock.calls[0]?.[0]?.data ?? {};
    expect(dati).not.toHaveProperty('permessi');
  });
});

describe('acceptInvitationAction — porta i permessi scelti al momento dell’invito', () => {
  it("il nuovo utente nasce con i permessi dell'invito", async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'inv1',
      companyId: 'c1',
      email: 'nuovo@y.it',
      status: 'PENDING',
      sedeId: 's1',
      ruoloSede: 'OPERATORE',
      permessi: ['pratiche.view', 'inbox.view', 'inbox.gestisci'],
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const res = await acceptInvitationAction('token-valido', 'Password1', 'Ann', 'Bee');
    expect(res.ok).toBe(true);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          permessi: ['pratiche.view', 'inbox.view', 'inbox.gestisci'],
        }),
      }),
    );
  });
});
```

La firma di `acceptInvitationAction` va verificata: il flusso è pubblico e senza sessione, quindi non passa da `getSessionContext`. Se il lookup dell'invito avviene con `findFirst` invece di `findUnique`, adeguare il mock.

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/app/team/permessi.authz.test.ts`
Expected: FAIL — le action ignorano il settimo parametro, quindi `user.create` è chiamato senza `permessi`.

- [ ] **Step 3: Aggiungere gli helper in `team/actions.ts`**

In cima al file, dopo gli import esistenti (riga 16):

```ts
import { can, permessiPerNuovoUtente, validaPermessi, type PermessiCtx } from '@/lib/auth/permessi/check';
import type { CompanyTypeP } from '@/lib/auth/permessi/catalogo';
```

Subito dopo `type RuoloSedeInput` (riga 49):

```ts
/** Il contesto di permessi del chiamante, dal SessionContext. */
function toPermessiCtx(ctx: { user: { id: string }; isOwner: boolean; permessi: Set<string> }): PermessiCtx {
  return { userId: ctx.user.id, isOwner: ctx.isOwner, permessi: ctx.permessi };
}
```

- [ ] **Step 4: Estendere `authorizeTeamCreate` e `authorizeTeamTargetUser`**

`authorizeTeamCreate` deve restituire anche il contesto permessi e il companyType. Sostituire il suo corpo finale (righe 62-85) con:

```ts
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  if (manageable.length === 0) {
    return { ok: false, error: 'Non hai i permessi per gestire il team' };
  }
  const target = resolveTeamTargetSede({ requestedSedeId, manageable });
  if (!target.ok) return { ok: false, error: target.error };
  const role = resolveSedeRole({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
    sedeId: target.sedeId,
  });
  const ruolo = requestedRuolo ?? 'OPERATORE';
  if (!assignableSedeRoles(role).includes(ruolo)) {
    return { ok: false, error: 'Ruolo non assegnabile' };
  }
  if (!ctx.companyType) return { ok: false, error: 'Azienda senza tipo' };
  return {
    ok: true,
    companyId: ctx.companyId,
    sedeId: target.sedeId,
    ruolo,
    userId: ctx.user.id,
    permessiCtx: toPermessiCtx(ctx),
    companyType: ctx.companyType,
  };
```

E il suo tipo di ritorno:

```ts
): Promise<
  | {
      ok: true;
      companyId: string;
      sedeId: string;
      ruolo: RuoloSedeInput;
      userId: string;
      permessiCtx: PermessiCtx;
      companyType: CompanyTypeP;
    }
  | { ok: false; error: string }
>
```

Analogamente `authorizeTeamTargetUser` (righe 92-121): aggiungere al ritorno `permessiCtx: toPermessiCtx(ctx)`, `companyType: ctx.companyType`, e `targetRole: target.role`. Il tipo diventa:

```ts
): Promise<
  | {
      ok: true;
      companyId: string;
      isOwner: boolean;
      manageableIds: string[];
      permessiCtx: PermessiCtx;
      companyType: CompanyTypeP | undefined;
      targetRole: string;
    }
  | { ok: false; error: string }
>
```

- [ ] **Step 5: Applicare i gate di capability nelle action team**

In ogni action, **subito dopo** il rispettivo `authz` (che risolve lo scope), aggiungere il gate di capability. `createUserDirectAction` (riga 288):

```ts
  const authz = await authorizeTeamCreate(sedeId, ruoloSede);
  if (!authz.ok) return { ok: false, error: authz.error };
  if (!can(authz.permessiCtx, 'team.crea')) {
    return { ok: false, error: 'Non hai i permessi per creare utenti' };
  }
  const perm = permessiPerNuovoUtente(authz.permessiCtx, authz.companyType, permessi);
  if (!perm.ok) return { ok: false, error: perm.error };
  const { companyId } = authz;
```

e nella `tx.user.create` (riga 318) aggiungere ai `data`:

```ts
        permessi: perm.permessi,
```

Firma aggiornata:

```ts
export async function createUserDirectAction(
  email: string,
  nome: string,
  cognome: string,
  password: string,
  sedeId?: string,
  ruoloSede?: RuoloSedeInput,
  permessi?: string[],
): Promise<CreateUserResult> {
```

Stessa struttura per gli altri, con questi permessi:

| Action | Gate |
|---|---|
| `createInvitationAction` | `team.invita` + `permessiPerNuovoUtente` → salva in `Invitation.permessi` |
| `createUserDirectAction` | `team.crea` |
| `updateTeamUserAction` | `team.modifica`; se `permessi !== undefined` allora `validaPermessi` |
| `resetTeamUserPasswordAction` | `team.reset_password` |
| `disableTeamUserAction` | `team.disabilita` |
| `revokeInvitationAction` | `team.disabilita` |

`acceptInvitationAction` **non ha gate** (flusso pubblico senza sessione): copia `invitation.permessi` nel nuovo utente:

```ts
    const user = await tx.user.create({
      data: {
        // ...campi esistenti
        permessi: invitation.permessi,
      },
    });
```

In `updateTeamUserAction`, il blocco permessi va aggiunto dopo la validazione di email/nome (riga ~392):

```ts
  let permessiData: { permessi: string[] } | Record<string, never> = {};
  if (permessi !== undefined) {
    if (!authz.companyType) return { ok: false, error: 'Azienda senza tipo' };
    const val = validaPermessi({
      ctx: authz.permessiCtx,
      companyType: authz.companyType,
      richiesti: permessi,
      targetUserId: userId,
      targetRole: authz.targetRole,
    });
    if (!val.ok) return { ok: false, error: val.error };
    permessiData = { permessi: val.permessi };
  }
```

e `permessiData` va spread nei `data` della `prisma.user.update`. Omettere `permessi` lascia il campo intatto: è ciò che verifica il terzo test.

Attenzione all'ordine: `validaPermessi` controlla «non modifichi te stesso» e «non tocchi l'owner» **prima** di `team.permessi`, così l'errore restituito è quello giusto. Il gate `team.modifica` viene prima di tutto: chi non può modificare non arriva nemmeno a leggere i permessi.

- [ ] **Step 6: Lanciare i test e verificare che passino**

Run: `pnpm --filter piattaforma exec vitest run src/app/team/`
Expected: PASS — sia `actions.authz.test.ts` (che va aggiornato aggiungendo `permessi: new Set([...])` e `companyType: 'AGENZIA'` ai mock di `getSessionContext`, altrimenti `can()` nega tutto) sia il nuovo `permessi.authz.test.ts`.

Aggiornamento minimo dei mock esistenti in `actions.authz.test.ts`: a ogni `getSessionContextMock.mockResolvedValue({...})` aggiungere

```ts
      companyType: 'AGENZIA',
      permessi: new Set(['team.view', 'team.crea', 'team.modifica', 'team.disabilita', 'team.permessi']),
```

tranne nel test «OPERATORE non può creare account», dove il set va lasciato vuoto: `permessi: new Set()`.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/team/
git commit -m "feat(permessi): assegnazione dei permessi nelle action team con anti-escalation"
```

---

### Task 7: Wallet, sede e orari

**Files:**
- Modify: `apps/piattaforma/src/app/wallet/actions.ts` (`richiediPayoutAction` :21, `updatePayoutThresholdAction` :105)
- Modify: `apps/piattaforma/src/app/sedi/actions.ts` (`updateSedeAction` :86)
- Modify: `apps/piattaforma/src/app/orari/actions.ts` (`updateOrariAction` :29)
- Modify: `apps/piattaforma/src/app/{wallet,orari,impostazioni-sede}/page.tsx`
- Test: `apps/piattaforma/src/app/wallet/actions.authz.test.ts`, `sedi/actions.authz.test.ts`, `orari/actions.authz.test.ts` (estendere)

**Interfaces:**
- Consumes: `requirePermesso` da `@/lib/auth/permessi/guard`.
- Produces: nulla di nuovo.

- [ ] **Step 1: Scrivere il test che fallisce (payout)**

Aggiungere in `apps/piattaforma/src/app/wallet/actions.authz.test.ts` (seguendo il pattern di mock già presente nel file):

```ts
describe('richiediPayoutAction — capability', () => {
  it('un admin di sede senza wallet.payout non preleva', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [{ id: 's1', nome: 's1', type: 'AGENZIA' }],
      currentSede: { id: 's1', nome: 's1', type: 'AGENZIA' },
      scopeIds: ['s1'],
      membershipRuoli: { s1: 'ADMIN_SEDE' },
      permessi: new Set(['wallet.view']),
    });
    const res = await richiediPayoutAction();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('permessi');
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/app/wallet/actions.authz.test.ts`
Expected: FAIL — l'action oggi passa il gate perché `canEditSedeSettings('ADMIN_SEDE')` è `true`.

- [ ] **Step 3: Sostituire i gate di capability**

In `wallet/actions.ts`, dentro `richiediPayoutAction`, **prima** del check `canEditSedeSettings`:

```ts
import { requirePermesso } from '@/lib/auth/permessi/guard';

// ...
  const gate = await requirePermesso('wallet.payout');
  if (!gate.ok) return gate;
```

Il check `canEditSedeSettings` va **rimosso**: la capability ora la decide il permesso, lo scope resta dato dalla sede operativa (`getOperatingSede()`), che il codice già risolve.

Identicamente:

| File | Action | Permesso | Check da rimuovere |
|---|---|---|---|
| `wallet/actions.ts` | `richiediPayoutAction` | `wallet.payout` | `canEditSedeSettings` |
| `wallet/actions.ts` | `updatePayoutThresholdAction` | `wallet.soglia` | `canEditSedeSettings` |
| `orari/actions.ts` | `updateOrariAction` | `orari.edit` | `canEditSedeSettings` |
| `sedi/actions.ts` | `updateSedeAction` | `sede.edit` (+ `sede.iban`, vedi Step 4) | `canEditSedeSettings` |

`createSedeAction`, `suspendSedeAction`, `reactivateSedeAction` **non cambiano**: restano owner-only.

- [ ] **Step 4: Il doppio gate di `updateSedeAction`**

L'IBAN richiede un permesso in più, ma solo se cambia davvero: altrimenti chi ha `sede.edit` non potrebbe salvare il form lasciando l'IBAN intatto.

In `sedi/actions.ts`, dentro `updateSedeAction`, dopo aver caricato la sede e prima di scrivere:

```ts
  const gate = await requirePermesso('sede.edit');
  if (!gate.ok) return gate;

  const sedeCorrente = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { iban: true },
  });
  const ibanNormalizzato = (iban ?? '').replace(/\s/g, '').toUpperCase();
  const ibanAttuale = (sedeCorrente?.iban ?? '').replace(/\s/g, '').toUpperCase();
  if (ibanNormalizzato !== ibanAttuale) {
    const gateIban = await requirePermesso('sede.iban');
    if (!gateIban.ok) return { ok: false, error: "Non hai i permessi per modificare l'IBAN" };
  }
```

Il confronto normalizza spazi e maiuscole: `IT60 X054` e `it60x054` sono lo stesso IBAN e non devono far scattare il permesso.

- [ ] **Step 5: Test del doppio gate**

In `sedi/actions.authz.test.ts`, in cima al file accanto agli altri helper:

```ts
const ctxConPermessi = (permessi: string[]) => ({
  user: { id: 'u1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: false,
  accessibleSedi: [{ id: 's1', nome: 's1', type: 'AGENZIA' as const }],
  currentSede: { id: 's1', nome: 's1', type: 'AGENZIA' as const },
  scopeIds: ['s1'],
  membershipRuoli: { s1: 'ADMIN_SEDE' as const },
  permessi: new Set(permessi),
});
```

e i due casi:

```ts
describe('updateSedeAction — IBAN', () => {
  it('con sede.edit ma senza sede.iban salva se l’IBAN non cambia', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ iban: 'IT60X0542811101000000123456' });
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view', 'sede.edit']));
    const res = await updateSedeAction('s1', { nome: 'Nuova', iban: 'it60 x054 2811 1010 0000 0123 456' });
    expect(res.ok).toBe(true);
  });

  it('con sede.edit ma senza sede.iban rifiuta se l’IBAN cambia', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ iban: 'IT60X0542811101000000123456' });
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view', 'sede.edit']));
    const res = await updateSedeAction('s1', { nome: 'Nuova', iban: 'IT99Z0000000000000000000000' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('IBAN');
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });
});
```

Adattare `ctxConPermessi` e la firma di `updateSedeAction` a quelle reali del file (l'action prende `FormData` o un oggetto: verificare con `sed -n '80,120p' apps/piattaforma/src/app/sedi/actions.ts`).

- [ ] **Step 6: Guard sulle pagine**

- `wallet/page.tsx`: prima riga del componente, `await assertPermesso('wallet.view')`.
- `orari/page.tsx`: `await assertPermesso('orari.view')`.
- `impostazioni-sede/page.tsx`: sostituire il redirect basato su `canEditSedeSettings` con `await assertPermesso('sede.view')`.

Nelle card interne, sostituire le condizioni di rendering:
- blocco Payout (`wallet/page.tsx:399`): da `canEditSedeSettings(sedeRole)` a `await hasPermesso('wallet.payout')`.
- form soglia (`wallet/page.tsx:427`): a `await hasPermesso('wallet.soglia')`.
- `RendicontoCard` (`wallet/page.tsx:454`): resta `isProprietario`, è owner-only.

- [ ] **Step 7: Lanciare i test**

Run: `pnpm --filter piattaforma exec vitest run src/app/wallet src/app/sedi src/app/orari`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/wallet apps/piattaforma/src/app/sedi apps/piattaforma/src/app/orari apps/piattaforma/src/app/impostazioni-sede
git commit -m "feat(permessi): gate su wallet, sede e orari; IBAN sede con permesso dedicato"
```

---

### Task 8: Pratiche e inbox

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts`, `pratiche/nuova/actions.ts`
- Modify: `apps/piattaforma/src/app/inbox/actions.ts`
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts` (`segnalaPraticaAction` :34)
- Modify: `apps/piattaforma/src/app/{pratiche,inbox}/page.tsx`
- Test: `pratiche/actions.authz.test.ts`, `lib/penali/segnalazione.authz.test.ts` (estendere), `inbox/actions.authz.test.ts` (creare se assente)

**Interfaces:**
- Consumes: `requirePermesso`, `hasPermesso` da `@/lib/auth/permessi/guard`.

- [ ] **Step 1: Scrivere il test che fallisce**

In `apps/piattaforma/src/app/pratiche/actions.authz.test.ts`:

```ts
describe('firmaFromListaAction — capability', () => {
  it('un operatore senza pratiche.firma non firma', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [{ id: 's1', nome: 's1', type: 'AGENZIA' }],
      currentSede: { id: 's1', nome: 's1', type: 'AGENZIA' },
      scopeIds: ['s1'],
      membershipRuoli: { s1: 'OPERATORE' },
      permessi: new Set(['pratiche.view', 'pratiche.processa']),
    });
    const res = await firmaFromListaAction('p1');
    expect(res.ok).toBe(false);
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/actions.authz.test.ts`
Expected: FAIL — l'operatore firma, perché oggi il solo gate è lo scope sede.

- [ ] **Step 3: Applicare i gate**

Il pattern, identico in ogni action: dopo `auth()` e **prima** di `assertSedeInScope` (permesso prima dello scope). In `pratiche/actions.ts`:

```ts
import { requirePermesso } from '@/lib/auth/permessi/guard';

export async function firmaFromListaAction(praticaId: string) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const gate = await requirePermesso('pratiche.firma');
  if (!gate.ok) return gate;

  // ...da qui in poi il codice esistente: assertSedeInScope, ecc.
}
```

`requirePermesso` ritorna `{ ok: false; error: string }`, che combacia con il result type già usato da queste action: `return gate` typecheck-a senza adattatori.

Gli abbinamenti:

| Action | File | Permesso |
|---|---|---|
| `submitNuovaPraticaAction` | `pratiche/nuova/actions.ts:546` | `pratiche.create` |
| `extract*Action` (6 OCR) | `pratiche/nuova/actions.ts` | `pratiche.create` |
| `inviaSegnalazioneCreazioneAction` | `lib/segnalazioni/creazione.ts:13` | `pratiche.create` |
| `markPraticaProcessataAction`, `processaPraticaFromListaAction` | `pratiche/actions.ts:239,251` | `pratiche.processa` |
| `markFirmaAvvenutaAction`, `firmaFromListaAction` | `pratiche/actions.ts:592,601` | `pratiche.firma` |
| `annullaPraticaAction` | `pratiche/actions.ts:607` | `pratiche.annulla` |
| `submitValutazioneAction` | `pratiche/actions.ts:695` | `pratiche.valuta` |
| `segnalaPraticaAction` | `lib/penali/segnalazione.ts:34` | `pratiche.segnala` |
| `acceptPratica`, `rejectPratica`, `acceptAndRedirect`, `rejectAndRedirect` | `inbox/actions.ts:17,190,229,237` | `inbox.gestisci` |

Le sei action OCR condividono il gate di `pratiche.create`: chi non crea pratiche non ha motivo di far girare l'OCR (e ogni chiamata costa un'estrazione Document AI). Un solo helper in cima al file:

```ts
async function gateCreazione(): Promise<{ ok: false; error: string } | null> {
  const gate = await requirePermesso('pratiche.create');
  return gate.ok ? null : gate;
}
```

`acceptAndRedirect` e `rejectAndRedirect` sono wrapper: mettere il gate dentro `acceptPratica`/`rejectPratica` è sufficiente **solo se** i wrapper li chiamano davvero. Verificarlo (`sed -n '225,245p' apps/piattaforma/src/app/inbox/actions.ts`); se duplicano la logica, il gate va in entrambi.

- [ ] **Step 4: Guard sulle pagine e bottoni**

- `pratiche/page.tsx` e `pratiche/[id]/page.tsx`: `await assertPermesso('pratiche.view')`.
- `pratiche/nuova/page.tsx`: `await assertPermesso('pratiche.create')`.
- `inbox/page.tsx`, `inbox/[id]/page.tsx`: `await assertPermesso('inbox.view')`.
- Quick-action nella lista e nel dettaglio: renderizzare solo se `await hasPermesso(...)` per il rispettivo permesso.
- Bottoni di download (ZIP pratica, PDF unito, ZIP massivo, singolo documento): solo con `pratiche.download`.

- [ ] **Step 5: Lanciare i test**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche src/app/inbox src/lib/penali`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche apps/piattaforma/src/app/inbox apps/piattaforma/src/lib/penali apps/piattaforma/src/lib/segnalazioni
git commit -m "feat(permessi): gate su pratiche, OCR, inbox e segnalazioni"
```

---

### Task 9: Fatture, pagamenti e route API di download

**Files:**
- Modify: `apps/piattaforma/src/app/blocco-pagamento/actions.ts` (`ritentaAddebitoAction` :21, `aggiornaIbanERitentaAction` :53)
- Modify: `apps/piattaforma/src/app/api/fatturazione/[id]/pdf/route.ts`, `[id]/xml/route.ts`, `zip/route.ts`
- Modify: `apps/piattaforma/src/app/api/pratiche/[id]/pdf/route.ts`, `[id]/zip/route.ts`, `documenti-zip/route.ts`
- Modify: `apps/piattaforma/src/app/api/documenti/[id]/route.ts`
- Modify: `apps/piattaforma/src/app/{fatturazione,addebiti}/page.tsx`
- Create: `apps/piattaforma/src/app/blocco-pagamento/actions.authz.test.ts`
- Create: `apps/piattaforma/src/app/api/fatturazione/route.authz.test.ts`

**Interfaces:**
- Consumes: `hasPermesso` da `@/lib/auth/permessi/guard`; `isAdminOrAssistente` da `@/lib/auth/permissions`.

- [ ] **Step 1: Scrivere il test che fallisce (il buco IBAN)**

File `apps/piattaforma/src/app/blocco-pagamento/actions.authz.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: { company: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/auth', () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: 'u1', companyType: 'AGENZIA', companyId: 'c1' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { aggiornaIbanERitentaAction } from './actions';

beforeEach(() => vi.clearAllMocks());

const ctx = (permessi: string[]) => ({
  user: { id: 'u1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: false,
  accessibleSedi: [],
  currentSede: null,
  scopeIds: [],
  membershipRuoli: { s1: 'OPERATORE' as const },
  permessi: new Set(permessi),
});

describe('aggiornaIbanERitentaAction — il buco storico', () => {
  it("un operatore d'agenzia NON può cambiare l'IBAN", async () => {
    getSessionContextMock.mockResolvedValue(ctx(['addebiti.view']));
    const res = await aggiornaIbanERitentaAction('IT60X0542811101000000123456');
    expect(res.ok).toBe(false);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  it("con pagamenti.iban l'IBAN si cambia", async () => {
    getSessionContextMock.mockResolvedValue(ctx(['addebiti.view', 'pagamenti.ritenta', 'pagamenti.iban']));
    prismaMock.company.findUnique.mockResolvedValue({ id: 'c1', iban: 'IT00' });
    const res = await aggiornaIbanERitentaAction('IT60X0542811101000000123456');
    expect(res.ok).toBe(true);
  });
});
```

Il secondo test richiede il mock di `applySepaMandateToAgency`: aggiungere `vi.mock('@/lib/stripe/sepa', () => ({ applySepaMandateToAgency: vi.fn(() => Promise.resolve({ ok: true })) }))` con il percorso reale, da verificare in cima a `blocco-pagamento/actions.ts`.

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/app/blocco-pagamento/actions.authz.test.ts`
Expected: FAIL sul primo test — l'operatore cambia l'IBAN, perché oggi il gate è il solo `companyType`.

- [ ] **Step 3: Chiudere il buco**

In `blocco-pagamento/actions.ts`, dopo il check su `companyType`:

```ts
  const gate = await requirePermesso('pagamenti.ritenta'); // in ritentaAddebitoAction
  if (!gate.ok) return gate;
```

```ts
  const gate = await requirePermesso('pagamenti.iban');    // in aggiornaIbanERitentaAction
  if (!gate.ok) return gate;
```

- [ ] **Step 4: Gate sulle route API**

Il pattern, identico in tutte. In `api/fatturazione/[id]/pdf/route.ts`, dopo il check `canViewDocumentoFiscale` esistente:

```ts
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

// ...
  if (!isAdminOrAssistente(session.user.role) && !(await hasPermesso('fatture.download'))) {
    return new Response('Forbidden', { status: 403 });
  }
```

Il permesso non **sostituisce** `canViewDocumentoFiscale`: quello resta e continua a decidere *quale* documento è visibile (scope). Il permesso decide *se* l'utente può scaricare.

| Route | Permesso |
|---|---|
| `api/fatturazione/[id]/pdf` | `fatture.download` |
| `api/fatturazione/zip` | `fatture.download` |
| `api/fatturazione/[id]/xml` | `fatture.xml` |
| `api/pratiche/[id]/pdf`, `api/pratiche/[id]/zip`, `api/pratiche/documenti-zip` | `pratiche.download` |
| `api/documenti/[id]` | `pratiche.download` |

`api/wallet/rendiconto` **non cambia**: resta `ctx.isOwner`, è owner-only.

- [ ] **Step 5: Guard sulle pagine e bottoni**

- `fatturazione/page.tsx`, `fatturazione/[id]/page.tsx`: `await assertPermesso('fatture.view')`.
- `addebiti/page.tsx`: `await assertPermesso('addebiti.view')`.
- Bottoni «Scarica PDF» / «Scarica ZIP»: solo con `fatture.download`. Bottone «Scarica XML»: solo con `fatture.xml`.
- `blocco-pagamento/page.tsx`: **niente `assertPermesso`** — la pagina resta raggiungibile da chiunque quando l'agenzia è bloccata. I form si mostrano solo con i rispettivi permessi; altrimenti compare il testo: «Il pagamento è sospeso. Contatta il titolare dell'azienda per aggiornare i dati di pagamento.»

- [ ] **Step 6: Lanciare i test**

Run: `pnpm --filter piattaforma exec vitest run src/app/blocco-pagamento src/app/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/blocco-pagamento apps/piattaforma/src/app/api apps/piattaforma/src/app/fatturazione apps/piattaforma/src/app/addebiti
git commit -m "fix(permessi): chiude il buco IBAN agenzia e mette i gate sui download"
```

---

### Task 10: Sidebar e navigazione

**Files:**
- Create: `apps/piattaforma/src/components/permessi/nav-filter.ts`
- Test: `apps/piattaforma/src/components/permessi/nav-filter.test.ts`
- Modify: `apps/piattaforma/src/components/app-shell.tsx`
- Modify: `apps/piattaforma/src/components/broker/broker-shell.tsx`
- Modify: `apps/piattaforma/src/components/agenzia/agenzia-shell.tsx`

**Interfaces:**
- Consumes: `SessionContext.permessi`, `SessionContext.isOwner`; `getManageableSedi()` da `@/lib/auth/session-context`; `type Permesso` da `@/lib/auth/permessi/catalogo`.
- Produces:
  - `type NavCtx = { isOwner: boolean; permessi: readonly Permesso[] }`
  - `vede(ctx: NavCtx, p?: Permesso): boolean` — senza permesso richiesto è sempre `true`
  - `filtraGruppi<T extends { permesso?: Permesso }>(gruppi: { label: string; items: T[] }[], ctx: NavCtx): { label: string; items: T[] }[]` — scarta le voci negate e i gruppi rimasti vuoti
  - le shell accettano `puoGestireTeam: boolean` oltre a `isOwner` e `permessi`

**Decisione presa in corso d'opera (2026-07-10).** `team.*` ha effetto solo per owner e `ADMIN_SEDE`: `manageableSedi()` filtra sul ruolo di sede, e per un `OPERATORE` ritorna sempre `[]`. Il permesso da solo non basta. Quindi la voce **Team compare solo se `can('team.view')` E ci sono sedi gestibili**: altrimenti un operatore con `team.view` vedrebbe la voce e verrebbe rimbalzato alla dashboard. `puoGestireTeam` viene da `(await getManageableSedi()).length > 0`, che `app-shell.tsx` già calcola oggi come `canManageTeam`.

Il repo non ha component test e `vitest.config.ts` raccoglie solo `src/**/*.test.ts` con `environment: 'node'`: la logica del filtro vive in un modulo puro, le shell restano JSX dichiarativo. `filtraGruppi` è generico sulla forma della voce, così si testa senza icone né React.

`permessi` viaggia come array e non come `Set`: attraversa il boundary server→client, e un array è il formato che il resto del codebase già usa per i props.

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/components/permessi/nav-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { vede, filtraGruppi, type NavCtx } from './nav-filter';

const operatore: NavCtx = { isOwner: false, permessi: ['pratiche.view', 'fatture.view'] };
const owner: NavCtx = { isOwner: true, permessi: [] };

describe('vede', () => {
  it('una voce senza permesso richiesto è sempre visibile', () => {
    expect(vede(operatore, undefined)).toBe(true);
  });

  it('una voce col permesso posseduto è visibile', () => {
    expect(vede(operatore, 'pratiche.view')).toBe(true);
  });

  it('una voce col permesso mancante è nascosta', () => {
    expect(vede(operatore, 'wallet.view')).toBe(false);
  });

  it("l'owner vede tutto, anche con l'elenco vuoto", () => {
    expect(vede(owner, 'wallet.payout')).toBe(true);
  });
});

describe('filtraGruppi', () => {
  const gruppi = [
    { label: 'Panoramica', items: [{ href: '/dashboard' }] },
    {
      label: 'Finanze',
      items: [
        { href: '/wallet', permesso: 'wallet.view' as const },
        { href: '/fatturazione', permesso: 'fatture.view' as const },
      ],
    },
    { label: 'Crescita', items: [{ href: '/affiliazione', permesso: 'affiliazione.view' as const }] },
  ];

  it('scarta le voci negate e conserva le altre', () => {
    const out = filtraGruppi(gruppi, operatore);
    expect(out.find((g) => g.label === 'Finanze')?.items.map((i) => i.href)).toEqual(['/fatturazione']);
  });

  it('elimina i gruppi rimasti senza voci', () => {
    // «Crescita» conteneva solo affiliazione.view, che l'operatore non ha:
    // una label senza voci sotto sarebbe un buco nella sidebar.
    expect(filtraGruppi(gruppi, operatore).map((g) => g.label)).toEqual(['Panoramica', 'Finanze']);
  });

  it("all'owner non toglie nulla", () => {
    expect(filtraGruppi(gruppi, owner)).toEqual(gruppi);
  });

  it('non muta i gruppi in ingresso', () => {
    const prima = JSON.stringify(gruppi);
    filtraGruppi(gruppi, operatore);
    expect(JSON.stringify(gruppi)).toBe(prima);
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/components/permessi/nav-filter.test.ts`
Expected: FAIL — `Failed to resolve import "./nav-filter"`.

- [ ] **Step 3: Scrivere `nav-filter.ts`**

```ts
import type { Permesso } from '@/lib/auth/permessi/catalogo';

export type NavCtx = { isOwner: boolean; permessi: readonly Permesso[] };

/** Voce senza `permesso`: visibile a tutti (Dashboard, Profilo). */
export function vede(ctx: NavCtx, p?: Permesso): boolean {
  if (p === undefined) return true;
  return ctx.isOwner || ctx.permessi.includes(p);
}

/** Scarta le voci negate, poi i gruppi rimasti vuoti. Non muta l'input. */
export function filtraGruppi<T extends { permesso?: Permesso }>(
  gruppi: { label: string; items: T[] }[],
  ctx: NavCtx,
): { label: string; items: T[] }[] {
  return gruppi
    .map((g) => ({ ...g, items: g.items.filter((i) => vede(ctx, i.permesso)) }))
    .filter((g) => g.items.length > 0);
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

Run: `pnpm --filter piattaforma exec vitest run src/components/permessi/nav-filter.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Riscrivere le voci di `broker-shell.tsx`**

```tsx
import { filtraGruppi } from '@/components/permessi/nav-filter';
import type { Permesso } from '@/lib/auth/permessi/catalogo';

export function BrokerShell({
  session,
  activePath,
  buildSha,
  isOwner = false,
  permessi = [],
  demoBanner,
  children,
}: {
  session: BrokerShellSession;
  activePath?: string;
  buildSha?: string;
  isOwner?: boolean;
  permessi?: Permesso[];
  demoBanner?: ReactNode;
  children: ReactNode;
}) {
  // Ogni voce dichiara il permesso che la rende visibile; `filtraGruppi` scarta
  // le voci negate e i gruppi rimasti senza voci. Dashboard e Profilo non hanno
  // permesso: ce li hanno tutti.
  const groups: SidebarNavGroup[] = filtraGruppi(
    [
      {
        label: 'Panoramica',
        items: [{ href: '/dashboard', label: 'Dashboard', icon: IconDashboard }],
      },
      {
        label: 'Operatività',
        items: [
          {
            href: '/pratiche',
            label: 'Pratiche',
            icon: IconPratiche,
            badge: <NavBadge keyName="praticheAttive" />,
            permesso: 'pratiche.view' as const,
          },
        ],
      },
      {
        label: 'Finanze',
        items: [
          { href: '/wallet', label: 'Wallet', icon: IconWallet, permesso: 'wallet.view' as const },
          {
            href: '/fatturazione',
            label: 'Fatture',
            icon: IconFattura,
            permesso: 'fatture.view' as const,
          },
        ],
      },
      {
        label: 'Crescita',
        items: [
          {
            href: '/affiliazione',
            label: 'Affiliazione',
            icon: IconAffiliazioni,
            permesso: 'affiliazione.view' as const,
          },
        ],
      },
      {
        label: 'Impostazioni',
        items: [
          {
            href: '/notifiche',
            label: 'Notifiche',
            icon: IconNotifiche,
            permesso: 'notifiche.view' as const,
          },
          { href: '/profilo', label: 'Profilo', icon: IconProfilo },
          // Sedi: owner-only e non delegabile, quindi non è un permesso del catalogo.
          ...(isOwner ? [{ href: '/sedi', label: 'Sedi', icon: IconAgenzie }] : []),
          ...(!isOwner
            ? [
                {
                  href: '/impostazioni-sede',
                  label: 'Impostazioni sede',
                  icon: IconAgenzie,
                  permesso: 'sede.view' as const,
                },
              ]
            : []),
          // Team: serve il permesso E una sede gestibile. `manageableSedi()` filtra sul
          // ruolo di sede, quindi per un OPERATORE è vuoto: mostrargli la voce
          // significherebbe rimbalzarlo alla dashboard al primo click.
          ...(puoGestireTeam
            ? [{ href: '/team', label: 'Team', icon: IconUtenti, permesso: 'team.view' as const }]
            : []),
        ],
      },
    ],
    { isOwner, permessi },
  );
  // ...il resto invariato
```

`puoGestireTeam` è un prop booleano, accanto a `isOwner` e `permessi`.

- [ ] **Step 6: Fare lo stesso su `agenzia-shell.tsx`**

Stessa meccanica — voci dichiarative dentro `filtraGruppi` — con in più queste quattro voci, da inserire nei rispettivi gruppi:

```tsx
  // gruppo Operatività, prima di Pratiche
  { href: '/inbox', label: 'Inbox', icon: IconInbox, badge: <NavBadge keyName="inbox" />, permesso: 'inbox.view' as const },
  // gruppo Finanze, dopo Fatture
  { href: '/addebiti', label: 'Addebiti', icon: IconFattura, permesso: 'addebiti.view' as const },
  // gruppo Crescita, dopo Affiliazione
  { href: '/feedback', label: 'Feedback', icon: IconFeedback, permesso: 'feedback.view' as const },
  // gruppo Impostazioni, prima di Notifiche
  { href: '/orari', label: 'Orari', icon: IconOrari, permesso: 'orari.view' as const },
```

Mantenere i nomi delle icone già importati nel file.

- [ ] **Step 7: Aggiornare `app-shell.tsx`**

Sostituire il calcolo di `canManageTeam` con la lettura del context, e passare i nuovi props:

```tsx
  const ctx = await getSessionContext();
  const permessi = ctx ? [...ctx.permessi] : [];
  const isOwner = ctx?.isOwner ?? false;
  // ...
  return <BrokerShell session={session} isOwner={isOwner} permessi={permessi} {...rest}>{children}</BrokerShell>;
```

Rimuovere l'import di `getManageableSedi` se non serve più altrove nel file.

- [ ] **Step 8: Lanciare i test**

Run: `pnpm --filter piattaforma exec vitest run src/components/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/components/
git commit -m "feat(permessi): sidebar filtrata per permesso, gruppi vuoti nascosti"
```

---

### Task 11: Mappa di enforcement e guardia anti-drift

**Files:**
- Create: `apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.test.ts`

**Interfaces:**
- Consumes: `type Permesso` da `./catalogo`.
- Produces: `MAPPA_ENFORCEMENT: Record<string, Record<string, Permesso | null>>` — file → action → permesso (o `null` motivato).

Il rischio di questo sistema non è oggi: è fra sei mesi, quando qualcuno aggiunge una server action e dimentica il `requirePermesso`. Nessun test fallisce, il buco resta. Questa mappa rende rumorosa l'omissione.

- [ ] **Step 1: Scrivere la mappa**

```ts
/**
 * Ogni server action delle aree azienda, col permesso che la protegge.
 * `null` = volutamente senza permesso, con la ragione accanto.
 *
 * Aggiungendo una server action a uno di questi file, il test
 * `mappa-enforcement.test.ts` fallisce finché non la classifichi qui.
 * Non è burocrazia: è l'unico modo di accorgersi di un gate mancante.
 */
import type { Permesso } from './catalogo';

export const MAPPA_ENFORCEMENT: Record<string, Record<string, Permesso | null>> = {
  'src/app/pratiche/actions.ts': {
    processaPraticaFromListaAction: 'pratiche.processa',
    markPraticaProcessataAction: 'pratiche.processa',
    markFirmaAvvenutaAction: 'pratiche.firma',
    firmaFromListaAction: 'pratiche.firma',
    annullaPraticaAction: 'pratiche.annulla',
    submitValutazioneAction: 'pratiche.valuta',
  },
  'src/app/pratiche/nuova/actions.ts': {
    submitNuovaPraticaAction: 'pratiche.create',
    extractLibrettoAction: 'pratiche.create',
    extractFoglioComplementareAction: 'pratiche.create',
    extractIdentitaAction: 'pratiche.create',
    extractVisuraAction: 'pratiche.create',
    extractPermessoAction: 'pratiche.create',
    extractCodiceFiscaleAction: 'pratiche.create',
  },
  'src/app/inbox/actions.ts': {
    acceptPratica: 'inbox.gestisci',
    rejectPratica: 'inbox.gestisci',
    acceptAndRedirect: 'inbox.gestisci',
    rejectAndRedirect: 'inbox.gestisci',
  },
  'src/app/wallet/actions.ts': {
    richiediPayoutAction: 'wallet.payout',
    updatePayoutThresholdAction: 'wallet.soglia',
  },
  'src/app/wallet/mandato-actions.ts': {
    inviaOtpMandatoAction: null, // owner-only: firma contrattuale del titolare
    firmaMandatoAction: null, // owner-only: firma contrattuale del titolare
  },
  'src/app/fatturazione/actions.ts': {
    segnaTrasmessoSdiAction: null, // gated ADMIN_PIATTAFORMA, non è un'azione azienda
  },
  'src/app/blocco-pagamento/actions.ts': {
    ritentaAddebitoAction: null, // D4: aperta a tutta l'agenzia, non tocca IBAN né importi
    aggiornaIbanERitentaAction: null, // D1: owner-only, l'IBAN è del solo titolare
  },
  'src/app/orari/actions.ts': {
    updateOrariAction: 'orari.edit',
  },
  'src/app/sedi/actions.ts': {
    createSedeAction: null, // owner-only: struttura dell'azienda
    updateSedeAction: 'sede.edit', // iban e payoutThresholdCent OMESSI dai data se non owner (D1/D2)
    suspendSedeAction: null, // owner-only
    reactivateSedeAction: null, // owner-only
  },
  'src/app/team/actions.ts': {
    createInvitationAction: 'team.invita',
    acceptInvitationAction: null, // flusso pubblico: l'invitato non ha sessione
    createUserDirectAction: 'team.crea',
    updateTeamUserAction: 'team.modifica',
    resetTeamUserPasswordAction: 'team.reset_password',
    disableTeamUserAction: 'team.disabilita',
    revokeInvitationAction: 'team.disabilita',
  },
  'src/app/profilo/personale/actions.ts': {
    updateOwnProfileAction: null, // proprio account
  },
  'src/app/profilo/azienda/actions.ts': {
    updateCompanyProfileAction: null, // owner-only: identità fiscale
  },
  'src/app/profilo/sicurezza/actions.ts': {
    start2faSetupAction: null, // proprio account
    confirm2faSetupAction: null, // proprio account
    disable2faAction: null, // proprio account
  },
  'src/app/profilo/notifiche/actions.ts': {
    updateNotifPrefsAction: null, // proprio account
  },
  'src/app/profilo/listino/actions.ts': {
    saveListinoFormAction: null, // feature parcheggiata: route 404
    uploadListinoFileAction: null, // feature parcheggiata
    deleteListinoAction: null, // feature parcheggiata
  },
  'src/lib/sedi/actions.ts': {
    setCurrentSedeAction: null, // cambio sede corrente: gated da canSelectSede
  },
  'src/lib/penali/segnalazione.ts': {
    segnalaPraticaAction: 'pratiche.segnala',
    respingiSegnalazioneAction: null, // gated ADMIN_PIATTAFORMA
  },
  'src/lib/segnalazioni/creazione.ts': {
    inviaSegnalazioneCreazioneAction: 'pratiche.create',
    gestisciSegnalazioneCreazioneAction: null, // gated ADMIN_PIATTAFORMA
  },
};
```

Tipizzare i valori come `Permesso | null` invece di `string | null` sposta al compilatore la verifica «il permesso citato esiste»: un refuso nella mappa non compila. Per questo il test qui sotto non lo ricontrolla a runtime.

- [ ] **Step 2: Scrivere il test anti-drift**

File `apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPPA_ENFORCEMENT } from './mappa-enforcement';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di
// src/lib/notifiche/pratica-schema.test.ts e degli altri test che leggono file.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'); // apps/piattaforma

/** Nomi delle server action esportate: `export async function nome(`. */
function actionEsportate(rel: string): string[] {
  const src = readFileSync(resolve(ROOT, rel), 'utf8');
  return [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
}

describe('mappa-enforcement', () => {
  it('ogni file mappato esiste', () => {
    for (const rel of Object.keys(MAPPA_ENFORCEMENT)) {
      expect(existsSync(resolve(ROOT, rel)), `manca ${rel}`).toBe(true);
    }
  });

  it('ogni server action esportata è classificata nella mappa', () => {
    const mancanti: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      for (const nome of actionEsportate(rel)) {
        if (!(nome in actions)) mancanti.push(`${rel}:${nome}`);
      }
    }
    expect(
      mancanti,
      `Server action senza classificazione. Aggiungile a mappa-enforcement.ts col permesso ` +
        `che le protegge, oppure con null e la ragione:\n  ${mancanti.join('\n  ')}`,
    ).toEqual([]);
  });

  it('ogni action classificata con un permesso lo invoca davvero nel sorgente', () => {
    const senzaGate: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8');
      for (const [nome, permesso] of Object.entries(actions)) {
        if (permesso === null) continue;
        if (!src.includes(`'${permesso}'`)) senzaGate.push(`${rel}:${nome} → ${permesso}`);
      }
    }
    expect(senzaGate, `Permesso dichiarato ma mai citato nel file:\n  ${senzaGate.join('\n  ')}`).toEqual([]);
  });
});
```

Il quarto test è volutamente grossolano: cerca la stringa del permesso nel file, non verifica che il gate sia sul percorso giusto. Prende il caso che conta — permesso dichiarato in mappa e mai applicato — senza costruire un parser AST.

- [ ] **Step 3: Lanciare il test**

Run: `pnpm --filter piattaforma exec vitest run src/lib/auth/permessi/mappa-enforcement.test.ts`
Expected: PASS, 3 test. Se il secondo test elenca action mancanti, sono server action aggiunte al repo dopo la stesura di questo piano: classificarle nella mappa, col permesso che le protegge o con `null` e la ragione.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.ts apps/piattaforma/src/lib/auth/permessi/mappa-enforcement.test.ts
git commit -m "test(permessi): guardia anti-drift sulle server action azienda"
```

---

### Task 12: La matrice permessi nella UI

**Files:**
- Create: `apps/piattaforma/src/components/permessi/matrice-logic.ts`
- Test: `apps/piattaforma/src/components/permessi/matrice-logic.test.ts`
- Create: `apps/piattaforma/src/components/permessi/matrice-permessi.tsx`
- Modify: `apps/piattaforma/src/app/team/create-user-form.tsx`
- Modify: `apps/piattaforma/src/app/team/invite-form.tsx`
- Modify: `apps/piattaforma/src/app/team/[userId]/edit/edit-form.tsx`
- Modify: `apps/piattaforma/src/app/team/page.tsx` (badge preset), `team/team-page-client.tsx`

**Interfaces:**
- Consumes: `catalogoPerTipo`, `conDipendenze`, `figliDi`, `type CompanyTypeP`, `type Permesso` da `@/lib/auth/permessi/catalogo`; `preset`, `riconoscePreset`, `PRESET_ETICHETTE`, `PRESET_IDS` da `@/lib/auth/permessi/preset`.
- Produces:
  - in `matrice-logic.ts` (puro): `toggle(value, chiave, puoi): Permesso[]`, `toggleCategoria(value, categoriaId, companyType, puoi): Permesso[]`, `applicaPreset(id, companyType, puoi): Permesso[]`, `permessiConcedibili(assegnabili, ruoloSede): Set<Permesso>`
  - in `matrice-permessi.tsx`: `<MatricePermessi companyType ruoloSede value onChange assegnabili />` — componente controllato, `value: Permesso[]`, `onChange(v: Permesso[])`

La cascata delle dipendenze è la parte che può rompersi, ed è pura: sta in `matrice-logic.ts` e si testa senza DOM. Il `.tsx` resta un guscio che disegna caselle e inoltra i click.

**Decisione presa in corso d'opera (2026-07-10): `team.*` non ha effetto su un operatore.** `manageableSedi()` filtra sul ruolo di sede e per un `OPERATORE` ritorna `[]`, quindi le action di team lo bloccano sullo scope anche se ha il permesso. Spuntare «Crea utenti» per un operatore sarebbe una promessa non mantenuta.

Quindi `permessiConcedibili(assegnabili, ruoloSede)` toglie dai concedibili tutte le chiavi `team.*` quando `ruoloSede === 'OPERATORE'`. Il componente usa quel `Set` come `puoi`: le caselle Team appaiono **disabilitate**, e `applicaPreset` non le accende mai. Sopra la categoria compare la riga: «I permessi Team richiedono il ruolo Admin di sede».

Cambiando il ruolo nella select, il set dei concedibili si ricalcola e i `team.*` eventualmente accesi spariscono. È il motivo per cui `permessiConcedibili` è una funzione pura testabile e non un `if` sepolto nel JSX.

- [ ] **Step 1: Scrivere il test che fallisce**

File `apps/piattaforma/src/components/permessi/matrice-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toggle, toggleCategoria, applicaPreset, permessiConcedibili } from './matrice-logic';
import { permessiPerTipo, type Permesso } from '@/lib/auth/permessi/catalogo';
import { preset } from '@/lib/auth/permessi/preset';

const tutti = new Set<Permesso>(permessiPerTipo('AGENZIA'));

describe('toggle', () => {
  it('accendendo un figlio si accende il padre', () => {
    expect(toggle([], 'fatture.download', tutti)).toEqual(['fatture.download', 'fatture.view']);
  });

  it('accendendo un figlio si accende il padre anche in altre categorie', () => {
    expect(toggle([], 'sede.edit', tutti)).toEqual(['sede.edit', 'sede.view']);
  });

  it('spegnendo il padre si spengono i figli', () => {
    // `sede.iban` è uscito dai delegabili (2026-07-10): nel catalogo non esistono
    // più catene a tre livelli. La cascata resta ricorsiva, ma qui la si esercita
    // su due livelli, gli unici che il catalogo offre.
    expect(toggle(['sede.view', 'sede.edit'], 'sede.view', tutti)).toEqual([]);
    expect(toggle(['orari.view', 'orari.edit'], 'orari.view', tutti)).toEqual([]);
  });

  it('spegnendo un figlio non tocca il padre', () => {
    expect(toggle(['fatture.view', 'fatture.download'], 'fatture.download', tutti)).toEqual([
      'fatture.view',
    ]);
  });

  it('non concede un figlio se il padre non è assegnabile', () => {
    // Chi non può dare `fatture.view` non può dare `fatture.download`: il set
    // risultante sarebbe incoerente e il server lo rifiuterebbe comunque.
    const puoi = new Set<Permesso>(permessiPerTipo('AGENZIA').filter((p) => p !== 'fatture.view'));
    expect(toggle([], 'fatture.download', puoi)).toEqual([]);
  });

  it('non muta il valore in ingresso', () => {
    const value: Permesso[] = ['fatture.view'];
    toggle(value, 'fatture.download', tutti);
    expect(value).toEqual(['fatture.view']);
  });
});

describe('toggleCategoria', () => {
  it('accende tutta la categoria coi suoi padri', () => {
    const out = toggleCategoria([], 'fatture', 'AGENZIA', tutti);
    expect(out).toEqual(['fatture.download', 'fatture.view', 'fatture.xml']);
  });

  it('se è già tutta accesa la spegne', () => {
    const piena: Permesso[] = ['fatture.view', 'fatture.download', 'fatture.xml'];
    expect(toggleCategoria(piena, 'fatture', 'AGENZIA', tutti)).toEqual([]);
  });

  it('da parziale accende il resto', () => {
    expect(toggleCategoria(['fatture.view'], 'fatture', 'AGENZIA', tutti)).toEqual([
      'fatture.download',
      'fatture.view',
      'fatture.xml',
    ]);
  });

  it('salta i permessi non assegnabili', () => {
    const puoi = new Set<Permesso>(permessiPerTipo('AGENZIA').filter((p) => p !== 'fatture.xml'));
    expect(toggleCategoria([], 'fatture', 'AGENZIA', puoi)).toEqual([
      'fatture.download',
      'fatture.view',
    ]);
  });

  it('una categoria inesistente lascia il valore intatto', () => {
    expect(toggleCategoria(['fatture.view'], 'inbox', 'DEALER', tutti)).toEqual(['fatture.view']);
  });
});

describe('applicaPreset', () => {
  it('applica il preset intero quando tutto è assegnabile', () => {
    expect(applicaPreset('OPERATORE_BASE', 'AGENZIA', tutti)).toEqual(
      [...preset('OPERATORE_BASE', 'AGENZIA')].sort(),
    );
  });

  it('scarta dal preset ciò che il chiamante non può concedere', () => {
    const puoi = new Set<Permesso>(permessiPerTipo('AGENZIA').filter((p) => p !== 'inbox.gestisci'));
    expect(applicaPreset('OPERATORE_BASE', 'AGENZIA', puoi)).not.toContain('inbox.gestisci');
  });
});

describe('permessiConcedibili', () => {
  it("a un OPERATORE non si possono concedere permessi team: manageableSedi() lo blocca comunque", () => {
    const out = permessiConcedibili([...tutti], 'OPERATORE');
    expect([...out].filter((p) => p.startsWith('team.'))).toEqual([]);
    expect(out.has('pratiche.view')).toBe(true);
  });

  it('a un ADMIN_SEDE i permessi team restano concedibili', () => {
    const out = permessiConcedibili([...tutti], 'ADMIN_SEDE');
    expect(out.has('team.crea')).toBe(true);
    expect(out.has('team.permessi')).toBe(true);
  });

  it('non aggiunge nulla che il chiamante non avesse già', () => {
    const parziale: Permesso[] = ['pratiche.view', 'team.view'];
    expect([...permessiConcedibili(parziale, 'ADMIN_SEDE')].sort()).toEqual(parziale.sort());
  });

  it('applicaPreset ADMIN_SEDE su un operatore non accende i team.*', () => {
    const puoi = permessiConcedibili([...tutti], 'OPERATORE');
    expect(applicaPreset('ADMIN_SEDE', 'AGENZIA', puoi).filter((p) => p.startsWith('team.'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/components/permessi/matrice-logic.test.ts`
Expected: FAIL — `Failed to resolve import "./matrice-logic"`.

- [ ] **Step 3: Scrivere `matrice-logic.ts`**

```ts
import {
  catalogoPerTipo,
  conDipendenze,
  figliDi,
  type CompanyTypeP,
  type Permesso,
} from '@/lib/auth/permessi/catalogo';
import { preset, type PresetId } from '@/lib/auth/permessi/preset';

/**
 * Le dipendenze si risolvono qui per comodità di chi compila il form; il server
 * rifiuta comunque un set incoerente (`validaPermessi`). Questa è UI, non difesa.
 */
export function toggle(
  value: readonly Permesso[],
  chiave: Permesso,
  puoi: ReadonlySet<Permesso>,
): Permesso[] {
  const next = new Set(value);
  if (next.has(chiave)) {
    next.delete(chiave);
    const coda = [...figliDi(chiave)];
    while (coda.length) {
      const figlio = coda.pop()!;
      if (next.delete(figlio)) coda.push(...figliDi(figlio));
    }
  } else {
    const chiusura = conDipendenze([chiave]);
    // Senza un padre concedibile il figlio non è concedibile: non fare nulla.
    if (chiusura.some((p) => !puoi.has(p))) return [...value].sort();
    for (const p of chiusura) next.add(p);
  }
  return [...next].sort();
}

export function toggleCategoria(
  value: readonly Permesso[],
  categoriaId: string,
  companyType: CompanyTypeP,
  puoi: ReadonlySet<Permesso>,
): Permesso[] {
  const cat = catalogoPerTipo(companyType).find((c) => c.id === categoriaId);
  if (!cat) return [...value].sort();

  const chiavi = cat.permessi.map((p) => p.chiave).filter((p) => puoi.has(p));
  const tutteAttive = chiavi.length > 0 && chiavi.every((p) => value.includes(p));

  if (tutteAttive) {
    // Spegnere passando da `toggle` propaga la cascata anche ai figli fuori categoria.
    let out: Permesso[] = [...value];
    for (const p of chiavi) if (out.includes(p)) out = toggle(out, p, puoi);
    return out;
  }

  const next = new Set(value);
  for (const p of chiavi) for (const d of conDipendenze([p])) if (puoi.has(d)) next.add(d);
  return [...next].sort();
}

export function applicaPreset(
  id: PresetId,
  companyType: CompanyTypeP,
  puoi: ReadonlySet<Permesso>,
): Permesso[] {
  return preset(id, companyType)
    .filter((p) => puoi.has(p))
    .sort();
}

/**
 * I permessi realmente concedibili a un utente con questo ruolo di sede.
 *
 * `team.*` non ha effetto su un OPERATORE: `manageableSedi()` (lib/sedi/scope.ts)
 * filtra sul ruolo di sede e per lui ritorna sempre `[]`, quindi le action di team
 * lo bloccano sullo scope anche col permesso in mano. Spuntare quelle caselle
 * sarebbe una promessa non mantenuta.
 */
export function permessiConcedibili(
  assegnabili: readonly Permesso[],
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE',
): Set<Permesso> {
  const out = new Set(assegnabili);
  if (ruoloSede === 'OPERATORE') {
    for (const p of out) if (p.startsWith('team.')) out.delete(p);
  }
  return out;
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

Run: `pnpm --filter piattaforma exec vitest run src/components/permessi/matrice-logic.test.ts`
Expected: PASS, 17 test.

Il catalogo non ha più catene a tre livelli da quando `sede.iban` è uscito dai delegabili: la cascata di `toggle` resta ricorsiva, ma i test la esercitano su due livelli, gli unici che il catalogo offre.

- [ ] **Step 5: Scrivere il componente**

File `apps/piattaforma/src/components/permessi/matrice-permessi.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { catalogoPerTipo, type CompanyTypeP, type Permesso } from '@/lib/auth/permessi/catalogo';
import { riconoscePreset, PRESET_ETICHETTE, PRESET_IDS } from '@/lib/auth/permessi/preset';
import { applicaPreset, permessiConcedibili, toggle, toggleCategoria } from './matrice-logic';

/**
 * Matrice a accordion: una categoria per riga, contatore visibile da chiusa.
 * Nessuna logica qui dentro: la cascata delle dipendenze vive in `matrice-logic.ts`,
 * dove si testa senza DOM.
 */
export function MatricePermessi({
  companyType,
  ruoloSede,
  value,
  onChange,
  assegnabili,
}: {
  companyType: CompanyTypeP;
  /** Un OPERATORE non può gestire il team: le caselle `team.*` restano disabilitate. */
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE';
  value: Permesso[];
  onChange: (v: Permesso[]) => void;
  /** Ciò che il chiamante può concedere: il resto appare disabilitato. */
  assegnabili: Permesso[];
}) {
  const categorie = catalogoPerTipo(companyType);
  const [aperte, setAperte] = useState<Set<string>>(new Set());
  const attivo = new Set(value);
  const puoi = permessiConcedibili(assegnabili, ruoloSede);
  const presetCorrente = riconoscePreset(value, companyType);
  const teamBloccato = ruoloSede === 'OPERATORE';

  return (
    <fieldset className="rounded-xl border border-pv-slate-200 p-4">
      <legend className="px-2 text-sm font-semibold text-pv-navy-700">Permessi</legend>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(applicaPreset(id, companyType, puoi))}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              presetCorrente === id
                ? 'border-pv-navy-700 bg-pv-navy-700 text-white'
                : 'border-pv-slate-300 text-pv-slate-700 hover:border-pv-navy-700'
            }`}
          >
            {PRESET_ETICHETTE[id]}
          </button>
        ))}
        {presetCorrente === null && (
          <span className="text-xs text-pv-slate-500">Personalizzato · {value.length} permessi</span>
        )}
      </div>

      <div className="space-y-1">
        {categorie.map((cat) => {
          const chiavi = cat.permessi.map((p) => p.chiave);
          const n = chiavi.filter((p) => attivo.has(p)).length;
          const aperta = aperte.has(cat.id);
          return (
            <div key={cat.id} className="rounded-lg border border-pv-slate-200">
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Tutti i permessi ${cat.etichetta}`}
                  checked={n === chiavi.length && n > 0}
                  ref={(el) => {
                    if (el) el.indeterminate = n > 0 && n < chiavi.length;
                  }}
                  onChange={() => onChange(toggleCategoria(value, cat.id, companyType, puoi))}
                />
                <button
                  type="button"
                  onClick={() =>
                    setAperte((s) => {
                      const next = new Set(s);
                      if (next.has(cat.id)) next.delete(cat.id);
                      else next.add(cat.id);
                      return next;
                    })
                  }
                  className="flex flex-1 items-center justify-between text-left text-sm font-medium text-pv-navy-700"
                  aria-expanded={aperta}
                >
                  <span>{cat.etichetta}</span>
                  <span className="text-xs text-pv-slate-500">
                    {n}/{chiavi.length}
                  </span>
                </button>
              </div>

              {aperta && (
                <div className="space-y-2 border-t border-pv-slate-200 px-3 py-2 pl-9">
                  {cat.id === 'team' && teamBloccato && (
                    <p className="text-xs text-pv-slate-500">
                      I permessi Team richiedono il ruolo «Admin di sede».
                    </p>
                  )}
                  {cat.permessi.map((p) => (
                    <label key={p.chiave} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={p.etichetta}
                        checked={attivo.has(p.chiave)}
                        disabled={!puoi.has(p.chiave)}
                        onChange={() => onChange(toggle(value, p.chiave, puoi))}
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className={p.sensibile ? 'font-medium text-pv-navy-700' : ''}>
                          {p.etichetta}
                        </span>
                        {p.nota && <span className="ml-2 text-xs text-pv-slate-500">{p.nota}</span>}
                        {!puoi.has(p.chiave) && (
                          <span className="ml-2 text-xs text-pv-slate-400">
                            Non puoi concedere un permesso che non hai
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
```

Le classi di colore (`pv-navy-700`, `pv-slate-*`) sono quelle già usate da `create-user-form.tsx`: nessun colore hardcodato.

- [ ] **Step 6: Integrare in `create-user-form.tsx`**

Il form diventa controllato per il solo campo permessi:

```tsx
export function CreateUserForm({
  onSuccess,
  sedi = [],
  companyType,
  assegnabili,
  puoScegliere,
}: {
  onSuccess?: () => void;
  sedi?: { id: string; nome: string }[];
  companyType: CompanyTypeP;
  assegnabili: Permesso[];
  /** Il chiamante ha `team.permessi`. Se no, la matrice non si mostra. */
  puoScegliere: boolean;
}) {
  const puoi = new Set(assegnabili);
  const [permessi, setPermessi] = useState<Permesso[]>(
    applicaPreset('OPERATORE_BASE', companyType, puoi),
  );
  // ...
      const res = await createUserDirectAction(
        email, nome, cognome, password, sedeId, ruoloSede,
        puoScegliere ? permessi : undefined,
      );
```

e nel JSX, prima del bottone di submit:

```tsx
      {puoScegliere ? (
        <div className="sm:col-span-2">
          <MatricePermessi
            companyType={companyType}
            value={permessi}
            onChange={setPermessi}
            assegnabili={assegnabili}
          />
        </div>
      ) : (
        <p className="text-sm text-pv-slate-500 sm:col-span-2">
          L&apos;utente riceverà i permessi di base. Per personalizzarli, chiedi al titolare.
        </p>
      )}
```

Il ruolo di sede deve stare **nello stato React**, non solo nella `FormData`: la matrice ne ha bisogno per disabilitare la categoria Team.

```tsx
  const [ruoloSede, setRuoloSede] = useState<'ADMIN_SEDE' | 'OPERATORE'>('OPERATORE');
  const puoi = permessiConcedibili(assegnabili, ruoloSede);

  function onRuoloChange(r: 'ADMIN_SEDE' | 'OPERATORE') {
    setRuoloSede(r);
    // Il set concedibile cambia col ruolo: ricalcolare il preset con i NUOVI concedibili,
    // altrimenti passando ad «Operatore» resterebbero accesi dei team.* inerti.
    setPermessi(
      applicaPreset(
        r === 'ADMIN_SEDE' ? 'ADMIN_SEDE' : 'OPERATORE_BASE',
        companyType,
        permessiConcedibili(assegnabili, r),
      ),
    );
  }
```

La `select` del ruolo chiama `onRuoloChange`, e resta `name="ruoloSede"` per la `FormData`. La matrice riceve `ruoloSede={ruoloSede}`.

Import necessari: `applicaPreset` e `permessiConcedibili` da `@/components/permessi/matrice-logic`, `MatricePermessi` da `@/components/permessi/matrice-permessi`, `type CompanyTypeP` e `type Permesso` da `@/lib/auth/permessi/catalogo`.

Lo stesso vale per `invite-form.tsx` e per `edit-form.tsx`: entrambi hanno la select del ruolo e devono passarlo alla matrice. In `edit-form.tsx` il valore iniziale è il ruolo attuale dell'utente, letto dal DB.

- [ ] **Step 7: Passare i props da `team/page.tsx`**

```tsx
  const ctx = await getSessionContext();
  const permessiCtx = { userId: ctx.user.id, isOwner: ctx.isOwner, permessi: ctx.permessi };
  const assegnabili = assignablePermessi(permessiCtx, ctx.companyType!);
  const puoScegliere = can(permessiCtx, 'team.permessi');
```

e passarli a `TeamPageClient` → `CreateUserForm` / `InviteForm`.

Nella lista utenti, il badge:

```tsx
  const etichetta = riconoscePreset(u.permessi.filter(isPermesso), companyType);
  // → PRESET_ETICHETTE[etichetta] oppure `Personalizzato · ${u.permessi.length} permessi`
```

`team/page.tsx` deve selezionare `permessi: true` nella query degli utenti.

- [ ] **Step 8: Integrare in `invite-form.tsx`**

Il form di invito riceve gli stessi tre props e li passa come settimo argomento:

```tsx
export function InviteForm({
  sedi = [],
  companyType,
  assegnabili,
  puoScegliere,
}: {
  sedi?: { id: string; nome: string }[];
  companyType: CompanyTypeP;
  assegnabili: Permesso[];
  puoScegliere: boolean;
}) {
  const puoi = new Set(assegnabili);
  const [permessi, setPermessi] = useState<Permesso[]>(
    applicaPreset('OPERATORE_BASE', companyType, puoi),
  );

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createInvitationAction(
        String(formData.get('email') ?? ''),
        String(formData.get('sedeId') ?? '') || undefined,
        String(formData.get('ruoloSede') ?? 'OPERATORE') as 'ADMIN_SEDE' | 'OPERATORE',
        puoScegliere ? permessi : undefined,
      );
      // ...gestione di res invariata
    });
  }
  // ...nel JSX, prima del bottone di submit, lo stesso blocco condizionale del create-user-form:
  //   puoScegliere ? <MatricePermessi .../> : <p>L'utente riceverà i permessi di base…</p>
}
```

- [ ] **Step 9: Integrare in `[userId]/edit/edit-form.tsx`**

Qui il valore iniziale sono i **permessi attuali dell'utente**, non un preset: aprire il form di modifica non deve resettare i poteri di chi già lavora.

```tsx
export function EditForm({
  utente,
  sedi,
  companyType,
  assegnabili,
  puoScegliere,
}: {
  utente: { id: string; email: string; nome: string; cognome: string; role: string; permessi: Permesso[] };
  sedi: { id: string; nome: string }[];
  companyType: CompanyTypeP;
  assegnabili: Permesso[];
  puoScegliere: boolean;
}) {
  const [permessi, setPermessi] = useState<Permesso[]>(utente.permessi);
  const { data: session } = useSession();

  // Il server rifiuterebbe comunque (validaPermessi): mostrare la matrice
  // sarebbe una promessa non mantenuta.
  const modificabile =
    puoScegliere && utente.role !== 'ADMIN_AZIENDA' && utente.id !== session?.user?.id;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await updateTeamUserAction(
        utente.id,
        String(formData.get('email') ?? ''),
        String(formData.get('nome') ?? ''),
        String(formData.get('cognome') ?? ''),
        String(formData.get('sedeId') ?? '') || undefined,
        String(formData.get('ruoloSede') ?? 'OPERATORE') as 'ADMIN_SEDE' | 'OPERATORE',
        modificabile ? permessi : undefined, // undefined = lascia intatti
      );
      // ...gestione di res invariata
    });
  }

  return (
    <form action={handleSubmit}>
      {/* ...campi esistenti */}
      {modificabile && (
        <MatricePermessi
          companyType={companyType}
          value={permessi}
          onChange={setPermessi}
          assegnabili={assegnabili}
        />
      )}
    </form>
  );
}
```

Passare `undefined` quando `modificabile` è falso è ciò che fa scattare il ramo «omettere i permessi lascia intatti quelli esistenti» testato nel Task 6.

Se `useSession` non è già usato in quel file, l'id dell'utente corrente si può passare come prop da `page.tsx` (che ha `getSessionContext()`): è più economico di montare il client provider.

`team/[userId]/edit/page.tsx` deve selezionare `permessi: true` e `role: true` nella query dell'utente, e restringere il campo prima di passarlo: `permessi: utente.permessi.filter(isPermesso)`. Il DB restituisce `string[]`, il componente vuole `Permesso[]`. È lo stesso confine che `session-context.ts` attraversa con lo stesso guard.

- [ ] **Step 10: Lanciare tutta la suite**

Run: `pnpm --filter piattaforma test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/piattaforma/src/components/permessi apps/piattaforma/src/app/team
git commit -m "feat(permessi): matrice a accordion in creazione, invito e modifica utenza"
```

---

### Task 13: Verifica end-to-end e checklist di rilascio

**Files:**
- Modify: `docs/piano-implementazione.md` (registrare la feature)
- Nessun codice nuovo.

- [ ] **Step 1: Typecheck e suite completa**

```bash
pnpm --filter piattaforma test
pnpm typecheck
```

Expected: entrambi verdi. Se `typecheck` esplode con errori Prisma assurdi, è la cache fredda: rilanciare dopo `pnpm --filter piattaforma exec tsc --noEmit` una prima volta.

- [ ] **Step 2: Avviare l'app e creare un operatore limitato**

```bash
pnpm db:up
pnpm dev
```

Con un account owner di agenzia:
1. `/team` → Crea utente → preset «Operatore base» → togliere tutto tranne `fatture.view`.
2. Salvare, fare logout, entrare col nuovo operatore.

- [ ] **Step 3: Verificare il fail-closed a mano**

| Verifica | Atteso |
|---|---|
| Sidebar | Solo Dashboard, Fatture, Profilo. Niente Wallet, Pratiche, Inbox, Team |
| `/wallet` | redirect a `/dashboard` |
| Dashboard | nessun riquadro economico |
| `/fatturazione` | lista visibile, **nessun bottone** di download |
| `GET /api/fatturazione/<id>/pdf` da barra indirizzi | `403 Forbidden` |
| `GET /api/fatturazione/<id>/xml` | `403 Forbidden` |

L'ultima riga è quella che conta: un bottone nascosto non è una difesa. Se risponde `200`, il gate di Task 9 non è applicato.

- [ ] **Step 4: Verificare l'anti-escalation a mano**

1. Con l'owner, dare a un utente `team.view`, `team.crea`, `team.permessi` e `fatture.view` (ma **non** `fatture.xml`), ruolo `ADMIN_SEDE`.
2. Entrare con quell'utente, andare in `/team` → Crea utente.
3. Atteso: la casella «Scarica XML FatturaPA» è disabilitata, con la nota «Non puoi concedere un permesso che non hai».
4. Atteso: nella lista team, l'owner non ha il bottone di modifica permessi; aprendo la modifica del proprio utente, la matrice non compare.

- [ ] **Step 5: Verificare il buco IBAN chiuso**

Con un operatore di agenzia bloccata (`bloccoPagamentoAt` valorizzato a mano sul DB locale):

```bash
docker compose exec -T postgres psql -U pv -d passaggio_veloce -c "UPDATE \"Company\" SET \"bloccoPagamentoAt\" = now() WHERE id = (SELECT id FROM \"Company\" WHERE type = 'AGENZIA' LIMIT 1);"
```

(`UPDATE ... LIMIT` non esiste in Postgres: serve la sottoquery.)

Aprire `/blocco-pagamento` da operatore. Atteso: la pagina si vede, i form no, compare «Contatta il titolare dell'azienda». Ripristinare poi con `UPDATE "Company" SET "bloccoPagamentoAt" = NULL;`.

- [ ] **Step 6: Aggiornare la roadmap**

In `docs/piano-implementazione.md`, aggiungere la voce sotto la fase corrente:

```markdown
- [x] Permessi granulari utenze azienda — 23 permessi dealer / 31 agenzia, matrice in creazione e modifica utenza, anti-escalation. Chiude il buco IBAN operatore agenzia. Spec: `docs/superpowers/specs/2026-07-10-permessi-granulari-design.md`
```

- [ ] **Step 7: Commit e checklist di rilascio**

```bash
git add docs/piano-implementazione.md
git commit -m "docs(permessi): registra i permessi granulari nella roadmap"
```

**Ordine obbligato in produzione** (il deploy Vercel parte dal push su `main`, quindi i due passi vanno separati nel tempo):

1. Applicare la migration su Neon: `DATABASE_URL=<prod> pnpm --filter @pv/db db:deploy`
   → aggiunge le colonne con default `[]`, il codice in prod le ignora: nessun effetto.
2. Eseguire il backfill in dry-run contro prod e **leggere l'output**:
   `DATABASE_URL=<prod> pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts --dry-run`
3. Eseguirlo per davvero:
   `DATABASE_URL=<prod> pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts`
4. Solo ora: merge su `main` e push. Il deploy attiva i gate su utenti che hanno già i permessi giusti.

Invertire 3 e 4 lascia ogni operatore senza poteri finché il backfill non gira. Non c'è downtime, ma c'è una finestra in cui l'app è inutilizzabile per i non-owner.

**Dopo il rilascio:** comunicare agli admin delle agenzie che gli operatori non possono più cambiare l'IBAN. È l'unica regressione funzionale voluta.

---

## Note per chi implementa

**I numeri di riga in questo piano vengono da una scansione del 2026-07-10.** Se non corrispondono, cercare il nome della funzione: i nomi sono stabili, le righe no.

**Se un test esistente si rompe perché `ctx.permessi` è `undefined`**, il mock di `getSessionContext` in quel file va aggiornato con `permessi: new Set([...])` e `companyType: 'AGENZIA' | 'DEALER'`. Non aggirare con `?? new Set()` nel codice di produzione: un context senza permessi è un bug, non un caso da tollerare.

**`Permesso` è una union letterale, derivata dalla tupla `PERMESSI`.** Un refuso in un gate — `requirePermesso('wallet.payuot')` — non compila. Senza union compilerebbe, negherebbe sempre, e nessun test diventerebbe rosso: il fail-closed nasconderebbe il bug. Le chiavi arrivano come `string` da due soli confini, il DB e i form: entrambi passano da `isPermesso`, che è un type guard. Non servono cast altrove.

**La logica della UI sta in moduli puri** (`matrice-logic.ts`, `nav-filter.ts`), testati con vitest come tutto il resto. Il repo non ha component test e `vitest.config.ts` raccoglie solo `src/**/*.test.ts`: introdurre `@testing-library` per due file non vale il prezzo. Il JSX resta un guscio senza logica.
