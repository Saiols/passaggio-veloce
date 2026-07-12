# Ruolo e sede dell'utente loggato nella sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nella card utente della sidebar, mostrare con che **ruolo** si sta operando e su quale **sede** — con la sede nascosta quando il titolare opera in vista aggregata su più sedi.

**Architecture:** Due moduli puri e testabili (`lib/auth/permessi/ruoli.ts` per l'etichetta del ruolo, `lib/sedi/etichetta-sede.ts` per quella della sede) calcolati una volta sola in `app-shell.tsx` (che già chiama `getSessionContext()`) e passati come prop a `SidebarShell`. Il ruolo **segue la sede corrente**: per i non-owner non sta in `User.role` (sempre `UTENTE_AZIENDA`) ma nella membership della sede, quindi si usa `resolveSedeRole()` che già esiste.

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma + Postgres, Tailwind, vitest (`environment: 'node'`), pnpm monorepo Turborepo.

## Global Constraints

- **Nessuna migration**: si legge una colonna (`Sede.citta`) che esiste già; nessun cambio di schema.
- ⚠️ **Node NON gira su Git Bash in questa macchina.** Test/lint/typecheck/build vanno lanciati **solo da PowerShell**, con Node in PATH:
  ```powershell
  $env:Path = "C:\Users\fsiol\AppData\Local\nvm\v22.15.0;" + $env:Path; pnpm --filter piattaforma test
  ```
  Gli esempi in sintassi bash qui sotto vanno tradotti così. Il package si chiama `piattaforma` (non `@pv/piattaforma`).
- ⚠️ **`pnpm test` verde NON implica typecheck verde** (vitest non typecheck-a): **lanciare sempre anche `pnpm --filter piattaforma typecheck`**. In un lavoro precedente sono stati committati 3 errori TS con tutti i test verdi.
- ⚠️ **Non riscrivere file di testo con PowerShell 5.1** (`Get-Content -Raw` + `Set-Content`): legge come ANSI e corrompe le accentate italiane (`già` → `giÃ `). Usare gli strumenti di edit, o `sed` da Git Bash.
- ⚠️ **JSX mangia lo spazio letterale a ridosso di un tag** quando c'è un a-capo subito dopo (`</strong>\n testo` → "testotesto"). Se serve uno spazio lì, usare `{' '}` esplicito, e **verificare il testo nel DOM**, non nel sorgente.
- **vitest gira in `environment: 'node'` e NON c'è testing-library**: si testano moduli **puri**, mai il markup dei componenti. Non introdurre test di rendering, non aggiungere dipendenze.
- **Etichette dei ruoli** (decise in spec, verbatim): `Titolare` · `Admin di sede` · `Operatore` · `Admin piattaforma` · `Assistente` · `Staff`.
- **Palette**: solo token del design system già usati nella sidebar (`text-[#8aa6cd]`, `text-white`, …). Nessun colore nuovo hardcoded. Tailwind non risolve classi costruite a runtime.
- Commit in italiano, formato `tipo(scope): descrizione`, senza `--no-verify`.

---

### Task 1: Etichetta del ruolo (modulo puro)

Crea la mappa unica delle etichette di ruolo. Oggi sono sparse in 6 punti con parole discordanti; questa diventa la fonte da cui la sidebar legge.

**Files:**
- Create: `apps/piattaforma/src/lib/auth/permessi/ruoli.ts`
- Test: `apps/piattaforma/src/lib/auth/permessi/ruoli.test.ts`

**Interfaces:**
- Consumes: `SedeRole` da `@/lib/sedi/scope` — è `'OWNER' | 'ADMIN_SEDE' | 'OPERATORE' | null` (`scope.ts:133`). `UserRole` da `@pv/db` (enum Prisma, esportato anche come **valore runtime**: 9 valori — `ADMIN_AZIENDA, UTENTE_AZIENDA, ADMIN_PIATTAFORMA, ASSISTENTE, AD, CTO, CFO, SALES_MANAGER, SALES`).
- Produces:
  - `type RuoloVisualizzato = 'Titolare' | 'Admin di sede' | 'Operatore' | 'Admin piattaforma' | 'Assistente' | 'Staff'`
  - `etichettaRuolo(args: { role: string | undefined; sedeRole: SedeRole }): RuoloVisualizzato`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `apps/piattaforma/src/lib/auth/permessi/ruoli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { UserRole } from '@pv/db';
import { etichettaRuolo } from './ruoli';

const TUTTI_I_RUOLI = Object.values(UserRole) as string[];

describe('etichettaRuolo — azienda (broker/agenzia)', () => {
  it("il proprietario è 'Titolare', qualunque sede stia guardando", () => {
    expect(etichettaRuolo({ role: 'ADMIN_AZIENDA', sedeRole: 'OWNER' })).toBe('Titolare');
  });

  it("il proprietario resta 'Titolare' anche senza sede corrente (vista aggregata)", () => {
    // In vista ALL non c'è una sede su cui calcolare il ruolo di membership:
    // sedeRole è null, ma il titolare non diventa per questo un operatore.
    expect(etichettaRuolo({ role: 'ADMIN_AZIENDA', sedeRole: null })).toBe('Titolare');
  });

  it('il ruolo di un non-owner viene dalla membership della sede, non da User.role', () => {
    // User.role è UTENTE_AZIENDA per TUTTI i non-owner: da solo non distingue
    // un admin di sede da un operatore. La distinzione sta in UserSede.ruolo.
    expect(etichettaRuolo({ role: 'UTENTE_AZIENDA', sedeRole: 'ADMIN_SEDE' })).toBe('Admin di sede');
    expect(etichettaRuolo({ role: 'UTENTE_AZIENDA', sedeRole: 'OPERATORE' })).toBe('Operatore');
  });

  it("un non-owner senza sede accessibile ricade su 'Operatore'", () => {
    expect(etichettaRuolo({ role: 'UTENTE_AZIENDA', sedeRole: null })).toBe('Operatore');
  });
});

describe('etichettaRuolo — staff di piattaforma', () => {
  it('admin e assistente hanno le proprie etichette', () => {
    expect(etichettaRuolo({ role: 'ADMIN_PIATTAFORMA', sedeRole: null })).toBe('Admin piattaforma');
    expect(etichettaRuolo({ role: 'ASSISTENTE', sedeRole: null })).toBe('Assistente');
  });

  it("i ruoli CRM interni sono 'Staff'", () => {
    for (const r of ['AD', 'CTO', 'CFO', 'SALES_MANAGER', 'SALES']) {
      expect(etichettaRuolo({ role: r, sedeRole: null })).toBe('Staff');
    }
  });

  it("lo staff non eredita mai il ruolo di sede (non ne ha una)", () => {
    // Difesa: anche passando per errore un sedeRole, l'admin resta admin.
    expect(etichettaRuolo({ role: 'ADMIN_PIATTAFORMA', sedeRole: 'OPERATORE' })).toBe(
      'Admin piattaforma',
    );
  });
});

describe('invariante: nessun ruolo può produrre una card vuota', () => {
  // Se domani si aggiunge un valore a UserRole e nessuno lo classifica qui,
  // la sidebar mostrerebbe una riga vuota. Questo test diventa rosso prima.
  it.each(TUTTI_I_RUOLI)("%s produce un'etichetta non vuota", (role) => {
    const label = etichettaRuolo({ role, sedeRole: null });
    expect(label).toBeTruthy();
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it('anche un ruolo sconosciuto (dato sporco) non lascia la card vuota', () => {
    expect(etichettaRuolo({ role: 'PIPPO', sedeRole: null })).toBeTruthy();
    expect(etichettaRuolo({ role: undefined, sedeRole: null })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test -- ruoli
```

Atteso: FAIL — `Failed to resolve import "./ruoli"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementare il modulo**

Crea `apps/piattaforma/src/lib/auth/permessi/ruoli.ts`:

```ts
import type { SedeRole } from '@/lib/sedi/scope';

/**
 * Etichette dei ruoli mostrate all'utente. FONTE UNICA: prima erano sparse in
 * sei punti con parole discordanti ("Admin piattaforma" nella sidebar admin,
 * "Admin"/"Utente" nella pagina Team, "Admin di sede"/"Operatore" nei form di
 * invito), e nessuna era riusabile.
 *
 * Il vocabolario riusa le parole già presenti nel Team ("Admin di sede",
 * "Operatore"). Il proprietario è "Titolare" e non "Admin" perché quest'ultimo
 * si confonde con l'admin di piattaforma.
 */
export type RuoloVisualizzato =
  | 'Titolare'
  | 'Admin di sede'
  | 'Operatore'
  | 'Admin piattaforma'
  | 'Assistente'
  | 'Staff';

/**
 * Il ruolo con cui l'utente sta operando ORA.
 *
 * Attenzione: per i non-owner `User.role` è sempre `UTENTE_AZIENDA` e NON dice
 * nulla — il ruolo utile sta nella membership della sede corrente
 * (`UserSede.ruolo`), già risolta da `resolveSedeRole()`. La stessa persona può
 * essere admin in una sede e operatore in un'altra: l'etichetta segue la sede
 * selezionata, non l'utente in astratto.
 */
export function etichettaRuolo(args: {
  role: string | undefined;
  sedeRole: SedeRole;
}): RuoloVisualizzato {
  const { role, sedeRole } = args;

  // Lo staff di piattaforma non ha sedi: si decide sul solo User.role.
  if (role === 'ADMIN_PIATTAFORMA') return 'Admin piattaforma';
  if (role === 'ASSISTENTE') return 'Assistente';
  if (role === 'AD' || role === 'CTO' || role === 'CFO' || role === 'SALES_MANAGER' || role === 'SALES') {
    return 'Staff';
  }

  // Azienda: il proprietario resta Titolare anche in vista aggregata, dove non
  // esiste una sede corrente su cui calcolare un ruolo di membership.
  if (role === 'ADMIN_AZIENDA' || sedeRole === 'OWNER') return 'Titolare';

  if (sedeRole === 'ADMIN_SEDE') return 'Admin di sede';

  // OPERATORE, oppure nessuna sede accessibile / ruolo sconosciuto: il livello
  // minimo. Mai stringa vuota: una card senza ruolo sembrerebbe un bug.
  return 'Operatore';
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

```bash
pnpm --filter piattaforma test -- ruoli
```

Atteso: PASS (tutti i test del file).

- [ ] **Step 5: Typecheck e lint**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma lint
```

Atteso: typecheck exit 0, lint 0 errori. (`pnpm test` verde non basta: vitest non typecheck-a.)

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/auth/permessi/ruoli.ts apps/piattaforma/src/lib/auth/permessi/ruoli.test.ts
git commit -m "feat(permessi): fonte unica per le etichette di ruolo"
```

---

### Task 2: Etichetta della sede (modulo puro) + `citta` nel contesto

Calcola il testo della sede da mostrare, e aggiunge il campo `citta` a `SedeRef` (oggi assente) perché serve come fallback quando il nome della sede coincide con la ragione sociale.

**Files:**
- Modify: `apps/piattaforma/src/lib/sedi/scope.ts:11-15` (aggiunge `citta` a `SedeRef`)
- Modify: `apps/piattaforma/src/lib/auth/session-context.ts:78` (aggiunge `citta` alla select Prisma)
- Create: `apps/piattaforma/src/lib/sedi/etichetta-sede.ts`
- Test: `apps/piattaforma/src/lib/sedi/etichetta-sede.test.ts`

**Interfaces:**
- Consumes: `CurrentSede` da `@/lib/sedi/scope` — è `{ kind: 'ALL' } | { kind: 'ONE'; sede: SedeRef }` (`scope.ts:20`). `nomeSedeDistintivo(nome, ragioneSociale): string | null` da `@/lib/pratiche/colonna-sede` (`colonna-sede.ts:38`) — ritorna `null` quando il nome della sede coincide con la ragione sociale.
- Produces: `etichettaSede(args: { currentSede: CurrentSede | null; accessibleSediCount: number; ragioneSociale: string | null | undefined; sedeUnica?: SedeRef | null }): string | null`
  (`sedeUnica` serve solo nel caso `ALL` con una sola sede accessibile: è quella sede.)

- [ ] **Step 1: Aggiungere `citta` a `SedeRef`**

In `apps/piattaforma/src/lib/sedi/scope.ts`, righe 11-15:

```ts
export type SedeRef = {
  id: string;
  nome: string;
  type: SedeType;
  /** Serve come etichetta quando `nome` coincide con la ragione sociale. */
  citta: string;
};
```

E in `apps/piattaforma/src/lib/auth/session-context.ts`, riga 78, la select Prisma diventa:

```ts
      select: { id: true, nome: true, type: true, citta: true },
```

`Sede.citta` esiste già nello schema (`packages/db/prisma/schema.prisma`, model `Sede`): è `String` NOT NULL. Nessuna migration.

- [ ] **Step 2: Scrivere il test che fallisce**

Crea `apps/piattaforma/src/lib/sedi/etichetta-sede.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { etichettaSede } from './etichetta-sede';
import type { SedeRef } from './scope';

const AZIENDA = 'Dimensione Auto Milano Srls';

// Caso normale: alla registrazione la sede eredita il nome dell'azienda.
const SEDE_OMONIMA: SedeRef = {
  id: 's1',
  nome: 'Dimensione Auto Milano Srls',
  type: 'DEALER',
  citta: 'Buccinasco',
};

// Sede con nome proprio, data dall'azienda quando apre una filiale.
const SEDE_PROPRIA: SedeRef = {
  id: 's2',
  nome: 'Dimensione Auto Corsico',
  type: 'DEALER',
  citta: 'Corsico',
};

describe('etichettaSede — sede selezionata (kind ONE)', () => {
  it('col nome che ripete la ragione sociale mostra la città, non il nome', () => {
    // Altrimenti la card direbbe due volte "Dimensione Auto Milano Srls":
    // una come azienda e una come sede.
    expect(
      etichettaSede({
        currentSede: { kind: 'ONE', sede: SEDE_OMONIMA },
        accessibleSediCount: 2,
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Buccinasco');
  });

  it('col nome proprio mostra il nome (è quello che l\'utente ha scelto nel selettore)', () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ONE', sede: SEDE_PROPRIA },
        accessibleSediCount: 2,
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Dimensione Auto Corsico');
  });
});

describe('etichettaSede — vista aggregata (kind ALL, solo il titolare)', () => {
  it('con più sedi dice "Tutte le sedi": non deve sembrare di essere su una sola', () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSediCount: 2,
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Tutte le sedi');
  });

  it('con UNA sola sede mostra quella sede', () => {
    // Il titolare resta in ALL finché non seleziona una sede, e con una sede
    // sola non può nemmeno farlo (il selettore compare solo da 2 sedi in su).
    // Applicare la regola alla lettera lo lascerebbe senza sede per sempre:
    // ma con una sede sola "aggregato" e "quella sede" sono la stessa cosa.
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSediCount: 1,
        ragioneSociale: AZIENDA,
        sedeUnica: SEDE_OMONIMA,
      }),
    ).toBe('Buccinasco');
  });

  it('con una sola sede dal nome proprio mostra quel nome', () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSediCount: 1,
        ragioneSociale: AZIENDA,
        sedeUnica: SEDE_PROPRIA,
      }),
    ).toBe('Dimensione Auto Corsico');
  });
});

describe('etichettaSede — nessuna sede', () => {
  it('senza sede corrente non mostra nulla (staff di piattaforma)', () => {
    expect(
      etichettaSede({ currentSede: null, accessibleSediCount: 0, ragioneSociale: null }),
    ).toBeNull();
  });

  it('in ALL senza sedi accessibili non inventa un\'etichetta', () => {
    expect(
      etichettaSede({ currentSede: { kind: 'ALL' }, accessibleSediCount: 0, ragioneSociale: AZIENDA }),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test -- etichetta-sede
```

Atteso: FAIL — `Failed to resolve import "./etichetta-sede"`.

- [ ] **Step 4: Implementare il modulo**

Crea `apps/piattaforma/src/lib/sedi/etichetta-sede.ts`:

```ts
import { nomeSedeDistintivo } from '@/lib/pratiche/colonna-sede';
import type { CurrentSede, SedeRef } from './scope';

/**
 * Testo della sede per la card utente in sidebar. `null` = non mostrare nulla.
 *
 * Regole (decise in spec):
 * - sede selezionata (ONE) → quella sede;
 * - vista aggregata (ALL, solo il titolare) con più sedi → "Tutte le sedi":
 *   mostrare UNA sede mentre se ne stanno guardando N sarebbe una bugia;
 * - vista aggregata con UNA sola sede → quella sede. Il titolare resta in ALL
 *   finché non ne seleziona una, e con una sede sola non può nemmeno farlo (il
 *   selettore compare solo da 2 sedi in su): la regola letterale lo lascerebbe
 *   senza sede per sempre, ed è il caso più comune (4 aziende su 5 in prod).
 *   Con una sede sola "aggregato" e "quella sede" coincidono: non c'è bugia.
 *
 * Il nome passa da `nomeSedeDistintivo`: alla registrazione la sede eredita il
 * nome dell'azienda, quindi quasi sempre coincidono e ripeterlo nella card lo
 * direbbe due volte. In quel caso resta la città, che è ciò che identifica
 * davvero la filiale (stessa scelta della colonna Sede della lista pratiche).
 */
export function etichettaSede(args: {
  currentSede: CurrentSede | null;
  accessibleSediCount: number;
  ragioneSociale: string | null | undefined;
  /** L'unica sede accessibile: serve solo nel caso ALL con una sede sola. */
  sedeUnica?: SedeRef | null;
}): string | null {
  const { currentSede, accessibleSediCount, ragioneSociale, sedeUnica } = args;

  if (!currentSede) return null;

  if (currentSede.kind === 'ONE') {
    return labelSede(currentSede.sede, ragioneSociale);
  }

  // kind === 'ALL'
  if (accessibleSediCount === 1 && sedeUnica) {
    return labelSede(sedeUnica, ragioneSociale);
  }
  if (accessibleSediCount === 0) return null;
  return 'Tutte le sedi';
}

function labelSede(sede: SedeRef, ragioneSociale: string | null | undefined): string {
  return nomeSedeDistintivo(sede.nome, ragioneSociale) ?? sede.citta;
}
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

```bash
pnpm --filter piattaforma test -- etichetta-sede
```

Atteso: PASS.

- [ ] **Step 6: Verificare che l'aggiunta di `citta` non abbia rotto nulla**

`SedeRef` è un tipo centrale: lo usano `scope.ts`, `scope-filters.ts`, `session-context.ts`, il selettore di sede e i loro test. L'aggiunta di un campo **obbligatorio** rompe qualunque letterale `SedeRef` che non lo passi — tipicamente le fixture dei test.

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test
```

Atteso: **typecheck exit 0** e suite completa verde. Se il typecheck segnala fixture di test senza `citta`, aggiungi il campo a quelle fixture (è un dato di test, scegli una città plausibile). **Non** rendere `citta` opzionale per aggirare il problema: renderebbe il fallback della label silenziosamente `undefined`.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/sedi/etichetta-sede.ts apps/piattaforma/src/lib/sedi/etichetta-sede.test.ts apps/piattaforma/src/lib/sedi/scope.ts apps/piattaforma/src/lib/auth/session-context.ts
git commit -m "feat(sedi): etichetta della sede per la card utente (+ citta in SedeRef)"
```

---

### Task 3: La card utente mostra ruolo e sede

Rinomina la prop fuorviante e collega i due moduli puri alla sidebar.

**Files:**
- Modify: `apps/piattaforma/src/components/sidebar-shell.tsx` (props righe 52-75; card riga 217-220; footer riga 267)
- Modify: `apps/piattaforma/src/components/broker/broker-shell.tsx` (righe 67-79)
- Modify: `apps/piattaforma/src/components/agenzia/agenzia-shell.tsx` (blocco gemello del broker)
- Modify: `apps/piattaforma/src/components/admin/admin-shell.tsx` (righe 128-132 e 153-164)
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (righe 113-179)

**Interfaces:**
- Consumes: da Task 1 `etichettaRuolo({ role, sedeRole })`; da Task 2 `etichettaSede({ currentSede, accessibleSediCount, ragioneSociale, sedeUnica })`. Da `@/lib/sedi/scope`: `resolveSedeRole({ isOwner, accessibleSedi, membershipRuoli, sedeId }): SedeRole`.
- Produces: `SidebarShell` con props `companyLabel: string | null`, `ruoloLabel: string`, `sedeLabel: string | null` (la vecchia `roleLabel` non esiste più).

- [ ] **Step 1: Rinominare la prop e aggiungerne due in `SidebarShell`**

⚠️ **Perché la rinomina è obbligatoria e non cosmetica:** la prop si chiama `roleLabel` ma per broker e agenzia **contiene la ragione sociale** (`broker-shell.tsx:75`: `roleLabel={companyName || 'Broker'}`). Aggiungere accanto una prop col ruolo *vero* senza rinominare lascerebbe due prop dai nomi indistinguibili, una delle quali mente.

In `apps/piattaforma/src/components/sidebar-shell.tsx`, la firma (righe 52-75) diventa:

```tsx
export function SidebarShell({
  groups,
  userName,
  userEmail,
  companyLabel,
  ruoloLabel,
  sedeLabel,
  homeHref = '/dashboard',
  activePath,
  buildSha,
  scrollKey,
  demoBanner,
  children,
}: {
  groups: SidebarNavGroup[];
  userName: string;
  userEmail?: string | null;
  /** Ragione sociale. `null` per lo staff di piattaforma, che non ha azienda. */
  companyLabel: string | null;
  /** Ruolo con cui l'utente sta operando ora (segue la sede corrente). */
  ruoloLabel: string;
  /** Sede corrente. `null` = non mostrarla (staff, o nessuna sede accessibile). */
  sedeLabel: string | null;
  homeHref?: string;
  activePath?: string;
  buildSha?: string;
  /** Chiave sessionStorage per conservare lo scroll della sidebar (univoca per shell). */
  scrollKey: string;
  demoBanner?: ReactNode;
  children: ReactNode;
}) {
```

- [ ] **Step 2: Aggiornare la card utente**

Sempre in `sidebar-shell.tsx`, il blocco righe 217-220 diventa:

```tsx
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold leading-tight text-white">{userName}</p>
              {companyLabel && (
                <p className="truncate text-[11px] text-[#8aa6cd]">{companyLabel}</p>
              )}
              <p className="truncate text-[11px] text-[#8aa6cd]">
                {sedeLabel ? `${ruoloLabel} · ${sedeLabel}` : ruoloLabel}
              </p>
            </div>
```

La stringa si compone in JS (template literal), **non** con testo JSX attorno a un tag: così il separatore ` · ` non rischia di essere mangiato dal collasso degli spazi JSX.

- [ ] **Step 3: Aggiornare il footer**

Sempre in `sidebar-shell.tsx`, riga 267. Il footer mostra oggi `{roleLabel}`, che per broker/agenzia è l'azienda e per l'admin è il ruolo. Preserva **esattamente** questo comportamento con il fallback:

```tsx
              <span className="font-semibold text-pv-slate-700">{companyLabel ?? ruoloLabel}</span>
```

(Lo staff di piattaforma non ha azienda: mostrargli il ruolo è ciò che il footer fa già oggi.)

- [ ] **Step 4: Aggiornare `AdminShell`**

In `apps/piattaforma/src/components/admin/admin-shell.tsx`: **cancella** la funzione locale `roleLabel()` (righe 128-132) — la sostituisce la fonte unica di Task 1 — e aggiungi l'import:

```ts
import { etichettaRuolo } from '@/lib/auth/permessi/ruoli';
```

Le prop passate a `SidebarShell` (righe 156-164) diventano:

```tsx
    <SidebarShell
      groups={groups}
      userName={name}
      userEmail={session.user.email}
      companyLabel={null}
      ruoloLabel={etichettaRuolo({ role: session.user.role, sedeRole: null })}
      sedeLabel={null}
      activePath={activePath}
      buildSha={buildSha}
      scrollKey="pv-admin-sidebar-scroll"
      demoBanner={demoBanner}
```

(Lo staff di piattaforma non ha né azienda né sedi: `companyLabel` e `sedeLabel` sono `null`, e il footer ricade sul ruolo, come oggi.)

- [ ] **Step 5: Calcolare ruolo e sede in `AppShell` e passarli alle shell azienda**

In `apps/piattaforma/src/components/app-shell.tsx`, aggiungi gli import:

```ts
import { etichettaRuolo } from '@/lib/auth/permessi/ruoli';
import { etichettaSede } from '@/lib/sedi/etichetta-sede';
import { resolveSedeRole } from '@/lib/sedi/scope';
```

Subito **dopo** `const permessi = ctx ? [...ctx.permessi] : [];` (riga 140), aggiungi:

```ts
  // Ruolo e sede della card utente. Il ruolo SEGUE la sede corrente: per i
  // non-owner `User.role` è sempre UTENTE_AZIENDA e non distingue un admin di
  // sede da un operatore — la distinzione sta nella membership della sede.
  // In vista aggregata non c'è una sede corrente, quindi nessun ruolo di
  // membership: `sedeRole` resta null e `etichettaRuolo` tiene il Titolare.
  const currentSede = ctx?.currentSede ?? null;
  const sedeRole =
    ctx && currentSede?.kind === 'ONE'
      ? resolveSedeRole({
          isOwner: ctx.isOwner,
          accessibleSedi: ctx.accessibleSedi,
          membershipRuoli: ctx.membershipRuoli,
          sedeId: currentSede.sede.id,
        })
      : null;
  const ruoloLabel = etichettaRuolo({ role: session.user.role, sedeRole });
  const sedeLabel = etichettaSede({
    currentSede,
    accessibleSediCount: ctx?.accessibleSedi.length ?? 0,
    ragioneSociale: session.user.companyName,
    sedeUnica: ctx?.accessibleSedi[0] ?? null,
  });
```

⚠️ Questo blocco va **dopo** il ramo che fa early-return su `AdminShell` (riga 115-127): l'admin non ha contesto sede e la sua shell si configura da sé (Step 4).

Poi passa le due nuove prop a `AgenziaShell` (riga 146-154) e a `BrokerShell` (riga 166-174), aggiungendo a entrambe:

```tsx
        ruoloLabel={ruoloLabel}
        sedeLabel={sedeLabel}
```

- [ ] **Step 6: Aggiornare `BrokerShell` e `AgenziaShell`**

In `apps/piattaforma/src/components/broker/broker-shell.tsx`, aggiungi `ruoloLabel: string` e `sedeLabel: string | null` al tipo delle props del componente, e sostituisci la riga 75:

```tsx
      roleLabel={companyName || 'Broker'}
```

con:

```tsx
      companyLabel={companyName || 'Broker'}
      ruoloLabel={ruoloLabel}
      sedeLabel={sedeLabel}
```

In `apps/piattaforma/src/components/agenzia/agenzia-shell.tsx` fai la modifica gemella; lì il fallback della ragione sociale è `'Agenzia'` invece di `'Broker'`:

```tsx
      companyLabel={companyName || 'Agenzia'}
      ruoloLabel={ruoloLabel}
      sedeLabel={sedeLabel}
```

- [ ] **Step 7: Verificare typecheck, lint e suite completa**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma lint
pnpm --filter piattaforma test
```

Atteso: typecheck **exit 0** (è il controllo che intercetta una prop dimenticata in una delle tre shell: `roleLabel` non esiste più, quindi ogni chiamante non aggiornato diventa rosso), lint 0 errori, suite completa verde.

Questo task **non aggiunge test**: è markup e cablaggio, e nel progetto non c'è testing-library (vitest gira in `environment: 'node'`). La logica testabile sta già nei moduli puri dei Task 1 e 2. **Non** introdurre test di rendering, **non** aggiungere dipendenze.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/components/sidebar-shell.tsx apps/piattaforma/src/components/broker/broker-shell.tsx apps/piattaforma/src/components/agenzia/agenzia-shell.tsx apps/piattaforma/src/components/admin/admin-shell.tsx apps/piattaforma/src/components/app-shell.tsx
git commit -m "feat(sidebar): ruolo e sede nella card utente"
```

---

### Task 4: Verifica end-to-end sull'app reale

I test coprono i moduli puri, non la sidebar. Qui si guida l'app vera. Il DB locale è una **copia di produzione**: le password del seed non funzionano.

**Files:** nessuno (solo verifica). Eventuali fix scoperti qui vanno committati a parte.

- [ ] **Step 1: Suite, typecheck, lint, build**

```bash
pnpm --filter piattaforma test
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma lint
pnpm --filter piattaforma build
```

Atteso: tutti exit 0.

- [ ] **Step 2: Preparare gli utenti di test**

Il DB locale (container Docker `pv-postgres`, db `passaggio_veloce`, utente `pv`) è una copia di prod: gli utenti hanno le password reali. Per accedere, **salva l'hash originale**, sovrascrivilo con un bcrypt noto, e **ripristinalo alla fine**.

```bash
# snapshot (da conservare: serve per il ripristino)
echo 'SELECT id, email, "passwordHash" FROM users WHERE email IN ($$dimensioneautomilano@gmail.com$$, $$info@agenziacorsico.it$$);' \
  | docker exec -i pv-postgres psql -U pv -d passaggio_veloce -A -F'|'
```

Genera un hash noto (`bcryptjs` risolve da `packages/db/`):

```bash
cd packages/db && node -e "console.log(require('bcryptjs').hashSync('DevPass123!', 10))"
```

Poi `UPDATE users SET "passwordHash"='<hash>' WHERE email IN (…)`.

⚠️ **Ripristina gli hash originali a fine verifica** e confermalo con un diff contro lo snapshot.

- [ ] **Step 3: Verificare il titolare mono-sede**

`dimensioneautomilano@gmail.com` è ADMIN_AZIENDA di "Dimensione Auto Milano Srls", che ha **2 sedi** (Buccinasco e Corsico). `info@agenziacorsico.it` è ADMIN_AZIENDA di un'agenzia con **1 sola sede** (Corsico).

Login come **agenzia** (1 sede) su `http://localhost:3000` (`pnpm --filter piattaforma dev`), guarda la card in fondo alla sidebar.
Atteso: `Titolare · Corsico` (la città, perché il nome della sede coincide con la ragione sociale).
⚠️ Non c'è nessun selettore di sede per lei (compare solo da 2 sedi in su): è esattamente il caso che la regola letterale avrebbe lasciato senza sede.

- [ ] **Step 4: Verificare il titolare multi-sede, nelle due modalità**

Login come **broker** (2 sedi). All'apertura è in vista aggregata.
Atteso: `Titolare · Tutte le sedi`.

Ora usa il selettore "SEDE" in alto (visibile su `/dashboard`, `/pratiche`, …) e scegli una sede.
Atteso: la card diventa `Titolare · Buccinasco` (o `Titolare · Dimensione Auto Corsico` per l'altra sede, che ha un nome proprio distinto dalla ragione sociale).
Rimetti "Tutte le sedi": la card torna a `Titolare · Tutte le sedi`.

- [ ] **Step 5: Verificare che il ruolo segua la sede (il caso che vale il task)**

Serve un utente **non-owner** con membership su due sedi e ruoli diversi. Creane uno temporaneo nel DB (broker "Dimensione Auto Milano Srls", `companyId` = `f0ca551b-395e-439b-92a0-a73e8dddf1eb`): `User` con `role='UTENTE_AZIENDA'` e due righe `user_sedi`, una `ADMIN_SEDE` e una `OPERATORE`.

Atteso: cambiando sede col selettore, la card passa da `Admin di sede · <sede A>` a `Operatore · <sede B>`. È l'invariante di design del task: il ruolo non è dell'utente, è dell'utente **su quella sede**.

⚠️ **Cancella l'utente di test** (e le sue righe `user_sedi`) a fine verifica.

- [ ] **Step 6: Verificare l'admin di piattaforma**

Login come `admin@passaggioveloce.it` (stesso trucco dell'hash).
Atteso nella card: nome + `Admin piattaforma`, **nessuna riga azienda** e **nessuna sede**. Nel footer: `© 2026 Passaggio Veloce · Admin piattaforma` (invariato rispetto a oggi).

- [ ] **Step 7: Verificare che la card non trabocchi**

Con la sidebar stretta (viewport ~1280px) e una sede dal nome lungo, la terza riga deve **troncare** con l'ellissi, non mandare a capo né allargare la sidebar. Controlla anche il drawer mobile (viewport 390px).

- [ ] **Step 8: Ripristinare il DB**

Rimetti gli hash originali dallo snapshot dello Step 2, cancella l'utente di test dello Step 5, e verifica con un `diff` che utenti e membership siano tornati identici.

- [ ] **Step 9: Commit di eventuali fix**

Solo se la verifica ha scoperto problemi.

---

## Note per chi implementa

- **Non toccare la top-bar di fallback** (`app-shell.tsx:181+`): la usano solo i ruoli CRM interni senza `companyType`, ed è fuori scope.
- **Non toccare il selettore di sede** (`components/sede/sede-switcher.tsx`): fuori scope.
- **Non rendere `citta` opzionale** in `SedeRef` per far passare il typecheck: se una fixture di test non lo passa, aggiungilo alla fixture.
- La pagina Team e i form di invito continuano ad avere le loro etichette inline: **ricollegarli alla fonte unica è fuori scope** in questo piano (non tocchiamo file che non servono al task). È un follow-up naturale.
