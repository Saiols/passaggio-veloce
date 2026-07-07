# "Impostazioni sede" + follow-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dare all'ADMIN_SEDE una pagina `/impostazioni-sede` per editare la propria sede, e chiudere i follow-up della review (cache getSessionContext, scoping findFirst, test action-level, pulizie minori).

**Architecture:** Nuova route server-component scopata alla sede operativa (paradigma `/wallet`,`/orari`), che riusa `SedeEdit` + `updateSedeAction` (già aperto ad ADMIN_SEDE). Voce nav condizionata nelle shell client. Follow-up chirurgici su file esistenti.

**Tech Stack:** Next.js 16 App Router, Prisma 5, Vitest, TypeScript.

## Global Constraints
- **Nessun cambio schema Prisma / nessuna migration.** Solo logica + UI.
- Test singolo file: `pnpm --filter piattaforma exec vitest run <path>`. Suite: `pnpm --filter piattaforma test`. Typecheck: `pnpm --filter piattaforma typecheck`.
- Commit dopo ogni task verde. Branch: `feat/multi-sede-impostazioni-sede`. Commit in italiano, prefisso `feat(multi-sede):`/`refactor(multi-sede):`/`test(multi-sede):`.
- Se `pnpm` lamenta la versione Node: `nvm use 22.15.0`. Postgres locale può essere down: i test sono unit con mock, nessun DB.
- Spec: `docs/superpowers/specs/2026-07-07-impostazioni-sede-follow-up-design.md`.
- Interfacce esistenti (dalla revisione multi-sede): `getSessionContext()`/`getOperatingSede()`/`getSedeRole()`/`getManageableSedi()` in `@/lib/auth/session-context`; `canEditSedeSettings(role)`/`manageableSedi(...)` in `@/lib/sedi/scope`; `isOwner(role)` in `@/lib/auth/permissions`; componente `SedeEdit` in `app/sedi/[id]/sede-edit.tsx`.

---

## Task 1: Route `/impostazioni-sede` + voce nav

**Files:**
- Create: `apps/piattaforma/src/app/impostazioni-sede/page.tsx`
- Modify: `apps/piattaforma/src/components/broker/broker-shell.tsx`
- Modify: `apps/piattaforma/src/components/agenzia/agenzia-shell.tsx`

**Interfaces:**
- Consumes: `getOperatingSede`, `getSedeRole`, `canEditSedeSettings`, `SedeEdit`.

- [ ] **Step 1: Crea la pagina**

Crea `apps/piattaforma/src/app/impostazioni-sede/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getOperatingSede, getSedeRole } from '@/lib/auth/session-context';
import { canEditSedeSettings } from '@/lib/sedi/scope';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { SedeEdit } from '../sedi/[id]/sede-edit';

export default async function ImpostazioniSedePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const sede = await getOperatingSede();
  if (!sede) {
    return (
      <AppShell session={session} activePath="/impostazioni-sede">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Seleziona una sede dal menù in alto per gestirne le impostazioni.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) redirect('/dashboard');

  const row = await prisma.sede.findFirst({ where: { id: sede.id, deletedAt: null } });
  if (!row) redirect('/dashboard');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = row.referralCode ? `${appUrl}/r/${row.referralCode}` : null;

  return (
    <AppShell session={session} activePath="/impostazioni-sede">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Sede</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Impostazioni sede
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Gestisci anagrafica, IBAN e soglia payout di {row.nome}.
          </p>
        </header>

        <SedeEdit
          sedeId={row.id}
          data={{
            nome: row.nome,
            indirizzo: row.indirizzo,
            civico: row.civico ?? '',
            citta: row.citta,
            cap: row.cap,
            provincia: row.provincia,
            telefono: row.telefono ?? '',
            email: row.email ?? '',
            codiceInterno: row.codiceInterno ?? '',
            iban: row.iban ?? '',
            payoutThresholdCent: row.payoutThresholdCent,
          }}
        />

        {row.type === 'AGENZIA' && (
          <Card className="mb-5">
            <h2 className="mb-2 text-[15px] font-bold text-pv-navy-800">Orari di apertura</h2>
            <p className="text-[12.5px] text-pv-slate-500">
              Gli orari di apertura di questa sede si gestiscono nella pagina dedicata.
            </p>
            <Link
              href="/orari"
              className="mt-3 inline-block text-[13px] font-semibold text-pv-navy-600 hover:underline"
            >
              Vai agli orari →
            </Link>
          </Card>
        )}

        <Card>
          <h2 className="mb-2 text-[15px] font-bold text-pv-navy-800">Affiliazione</h2>
          <p className="text-[12.5px] text-pv-slate-500">
            Link di affiliazione di questa sede. Le iscrizioni tramite questo link vengono
            attribuite alla sede; la commissione va all’azienda madre.
          </p>
          <code className="mt-3 block truncate rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
            {link ?? 'Codice referral non disponibile'}
          </code>
        </Card>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Aggiungi la voce nav nelle due shell**

In `apps/piattaforma/src/components/broker/broker-shell.tsx` e
`apps/piattaforma/src/components/agenzia/agenzia-shell.tsx`, nel gruppo "Impostazioni",
subito dopo la riga che aggiunge `/sedi` per l'owner, aggiungi la voce per l'admin di sede
non-owner (entrambe le shell già importano `IconAgenzie` e ricevono `canManageTeam`):

```ts
        ...(!isAdminAzienda && canManageTeam
          ? [{ href: '/impostazioni-sede', label: 'Impostazioni sede', icon: IconAgenzie }]
          : []),
```

Risultato: owner → "Sedi"; ADMIN_SEDE → "Impostazioni sede"; OPERATORE → nessuna delle due.

- [ ] **Step 3: Typecheck + verifica manuale**

Run: `pnpm --filter piattaforma typecheck` → clean.
Verifica di ragionamento: un OPERATORE che apre `/impostazioni-sede` viene rediretto
(`getSedeRole` → 'OPERATORE' → `canEditSedeSettings` false); un ADMIN_SEDE vede il form.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/impostazioni-sede/ apps/piattaforma/src/components/broker/broker-shell.tsx apps/piattaforma/src/components/agenzia/agenzia-shell.tsx
git commit -m "feat(multi-sede): pagina /impostazioni-sede per l'admin di sede + voce nav"
```

---

## Task 2: Follow-up F1 (cache getSessionContext) + F2 (scoping findFirst edit)

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/session-context.ts`
- Modify: `apps/piattaforma/src/app/team/[userId]/edit/page.tsx`

- [ ] **Step 1: Avvolgi `getSessionContext` in `cache()`**

In `apps/piattaforma/src/lib/auth/session-context.ts`:
- Aggiungi l'import: `import { cache } from 'react';`
- Cambia la dichiarazione da `export async function getSessionContext(): Promise<SessionContext | null> {` a:

```ts
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
```

- Chiudi la funzione con `});` invece di `}` (è ora un'arrow passata a `cache`).
- `getSedeRole`/`getManageableSedi`/`getOperatingSede` restano invariate (chiamano `getSessionContext`, ora deduplicata per-request). `auth()`/`cookies()` sono request-scoped → `cache()` è sicuro.

- [ ] **Step 2: Scoping della `findFirst` nella pagina edit team**

In `apps/piattaforma/src/app/team/[userId]/edit/page.tsx`, la `prisma.userSede.findFirst` usata
per l'autorizzazione/membership: aggiungi il filtro `sedeId: { in: manageableIds }`:

```ts
  const membership = await prisma.userSede.findFirst({
    where: { userId, sedeId: { in: manageableIds } },
    select: { sedeId: true, ruolo: true },
  });
```

(Deterministico: per l'owner `manageableIds` = tutte le sedi azienda → trova comunque; per il
non-owner restringe alle sedi gestite, fail-closed. I check successivi restano invariati.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma typecheck` → clean.

- [ ] **Step 4: Test rapido di regressione mirato**

Run: `pnpm --filter piattaforma exec vitest run src/lib/sedi src/app/team` → verde (nessuna regressione sugli helper/azioni scoped).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/session-context.ts apps/piattaforma/src/app/team/[userId]/edit/page.tsx
git commit -m "refactor(multi-sede): cache() su getSessionContext (dedup per-request) + scoping findFirst edit team"
```

---

## Task 3: Pulizie minori team (#3/#4 userId, #5 revoke result, #1 import, #8 cast)

**Files:**
- Modify: `apps/piattaforma/src/app/team/actions.ts`
- Modify: `apps/piattaforma/src/app/team/revoke-button.tsx`
- Modify: `apps/piattaforma/src/lib/sedi/scope.test.ts`
- Modify: `apps/piattaforma/src/app/wallet/actions.ts`, `apps/piattaforma/src/app/wallet/page.tsx`

- [ ] **Step 1: `authorizeTeamCreate` ritorna `userId`; `createInvitationAction` lo usa (#3/#4)**

In `team/actions.ts`, nel tipo di ritorno OK di `authorizeTeamCreate` aggiungi `userId`, e
valorizzalo da `ctx.user.id`:

```ts
): Promise<
  | { ok: true; companyId: string; sedeId: string; ruolo: RuoloSedeInput; userId: string }
  | { ok: false; error: string }
> {
  ...
  return { ok: true, companyId: ctx.companyId, sedeId: target.sedeId, ruolo, userId: ctx.user.id };
}
```

In `createInvitationAction`, sostituisci il recupero di `invitedById` (oggi
`const session = await auth(); const invitedById = session!.user!.id!;`) con:

```ts
  const invitedById = authz.userId;
```

Poi verifica se `import { auth } from '@/auth'` è ancora usato altrove nel file
(`acceptInvitationAction` NON lo usa): se è diventato inutilizzato, rimuovi l'import; se serve
ancora, lascialo. Idem per `redirect` dopo lo Step 2.

- [ ] **Step 2: `revokeInvitationAction` ritorna un esito (#5)**

In `team/actions.ts`, cambia `revokeInvitationAction`:

```ts
export type RevokeInviteResult = { ok: true } | { ok: false; error: string };

export async function revokeInvitationAction(invitationId: string): Promise<RevokeInviteResult> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.companyId !== ctx.companyId || inv.status !== 'PENDING') {
    return { ok: false, error: 'Invito non trovato o non più valido' };
  }
  if (!ctx.isOwner && (!inv.sedeId || !manageable.some((s) => s.id === inv.sedeId))) {
    return { ok: false, error: 'Non hai i permessi per revocare questo invito' };
  }
  await prisma.invitation.update({ where: { id: invitationId }, data: { status: 'REVOKED' } });
  revalidatePath('/team');
  return { ok: true };
}
```

- [ ] **Step 3: `RevokeButton` mostra l'errore (#5)**

Sostituisci `apps/piattaforma/src/app/team/revoke-button.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { InlineSpinner } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { revokeInvitationAction } from './actions';

export function RevokeButton({ invitationId }: { invitationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await revokeInvitationAction(invitationId);
            if (!res.ok) setError(res.error);
          })
        }
        aria-busy={pending || undefined}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-pv-red-500 px-3 py-1.5 text-xs font-semibold text-pv-red-500 hover:bg-pv-red-50 disabled:opacity-50"
      >
        {pending && <InlineSpinner className="h-3.5 w-3.5" />}
        <span>{pending ? 'Revoca…' : 'Revoca'}</span>
        <LoadingOverlay show={pending} label="Revoca…" />
      </button>
      {error && <span className="text-[11px] text-pv-red-500">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: #1 import in cima a `scope.test.ts`**

In `apps/piattaforma/src/lib/sedi/scope.test.ts`, sposta il secondo blocco `import`
(quello a metà file, che importa `resolveSedeRole`, `canManageSedeTeam`, ecc.) in cima al
file, unendolo/affiancandolo al primo blocco di import. Nessun cambio di logica dei test.

- [ ] **Step 5: #8 cast `isOwner` uniformato**

In `apps/piattaforma/src/app/wallet/page.tsx`, rimuovi il cast `as string` nelle chiamate
`isOwner(session.user.role as string)` → `isOwner(session.user.role)` (2 occorrenze:
query `walletMadre` e prop `isTitolare` del `PayoutButton`), così da allinearle a
`wallet/actions.ts` (che usa `isOwner(session.user.role)` senza cast). `isOwner` accetta
`string | undefined`.

- [ ] **Step 6: Typecheck + test mirati**

Run: `pnpm --filter piattaforma typecheck` → clean.
Run: `pnpm --filter piattaforma exec vitest run src/app/team src/app/wallet src/lib/sedi` → verde
(nessuna regressione; la firma di `revokeInvitationAction` è cambiata ma i test authz esistenti
non la asseriscono sul valore di ritorno).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/team/ apps/piattaforma/src/lib/sedi/scope.test.ts apps/piattaforma/src/app/wallet/
git commit -m "refactor(multi-sede): pulizie review (userId da authz, revoke con esito, import, cast isOwner)"
```

---

## Task 4: Test action-level gate impostazioni sede (F3)

**Files:**
- Create: `apps/piattaforma/src/app/sedi/actions.authz.test.ts`
- Modify: `apps/piattaforma/src/app/wallet/actions.test.ts`
- Create: `apps/piattaforma/src/app/orari/actions.authz.test.ts`

**Interfaces:**
- Consumes: `updateSedeAction` (`sedi/actions.ts`), `updatePayoutThresholdAction` (`wallet/actions.ts`), `updateOrariAction` (`orari/actions.ts`).

- [ ] **Step 1: Test `updateSedeAction` (sedi)**

Crea `apps/piattaforma/src/app/sedi/actions.authz.test.ts`. Mocka `@/lib/auth/session-context`
(`getSedeRole`) e `@pv/db` (`prisma.sede.update`), sul pattern dei test authz esistenti
(`app/team/actions.authz.test.ts`). Casi (per ciascuno asserisci `res.ok` E che
`prisma.sede.update` sia/NON sia chiamato):
- OPERATORE: `getSedeRole` → `'OPERATORE'` → `res.ok === false`, `sede.update` NON chiamato.
- null (sede non accessibile): `getSedeRole` → `null` → `res.ok === false`, NON chiamato.
- ADMIN_SEDE: `getSedeRole` → `'ADMIN_SEDE'` → con una `FormData` valida (nome/indirizzo/città/
  cap/provincia a 2 lettere, iban vuoto, payoutThresholdEuro numerico) `res.ok === true`,
  `sede.update` chiamato una volta.

> Nota: costruisci una `FormData` con `new FormData()` + `set(...)` per i campi richiesti da
> `parseSedeFields`. Per i casi DENY il gate corto-circuita prima del parse, quindi la FormData
> può essere vuota.

- [ ] **Step 2: Test `updatePayoutThresholdAction` (wallet)**

In `apps/piattaforma/src/app/wallet/actions.test.ts`, aggiungi casi (riusa l'harness di mock già
presente; mocka `getOperatingSede` → una sede, `getSedeRole` → ruolo, e `prisma.sede.update`):
- OPERATORE → `res.ok === false`, `sede.update` NON chiamato.
- ADMIN_SEDE → con `thresholdCent` valido, `res.ok === true`, `sede.update` chiamato.

- [ ] **Step 3: Test `updateOrariAction` (orari)**

Crea `apps/piattaforma/src/app/orari/actions.authz.test.ts`. Mocka `@/auth` (`auth` →
`session.user.companyType = 'AGENZIA'`), `getOperatingSede` → una sede, `getSedeRole` → ruolo,
`@pv/db` (`prisma.orariApertura.upsert`). Casi:
- OPERATORE → `res.ok === false` (messaggio "Solo l'admin di sede…"), `orariApertura.upsert` NON chiamato.
- ADMIN_SEDE → con una `FormData` di orari valida, `res.ok === true`, `upsert` chiamato.

- [ ] **Step 4: Esegui i nuovi test + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/app/sedi/actions.authz.test.ts src/app/wallet/actions.test.ts src/app/orari/actions.authz.test.ts` → verde.
Run: `pnpm --filter piattaforma typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/sedi/actions.authz.test.ts apps/piattaforma/src/app/wallet/actions.test.ts apps/piattaforma/src/app/orari/actions.authz.test.ts
git commit -m "test(multi-sede): copertura authz gate impostazioni sede (updateSede/soglia/orari)"
```

---

## Task 5: Regressione finale
- [ ] Run `pnpm --filter piattaforma test` → tutti verdi.
- [ ] Run `pnpm --filter piattaforma typecheck` → clean.
- [ ] Run `pnpm --filter piattaforma lint` → 0 errori (il warning pre-esistente in register-wizard.tsx è tollerato).
- [ ] Run `pnpm --filter piattaforma build` → OK (nuova route `/impostazioni-sede` nel manifest).

## Self-Review (esito)
- Spec §3.1 route → Task 1; §3.2 nav → Task 1; §4 F1 → Task 2 Step 1; F2 → Task 2 Step 2; F3 → Task 4; F4 #1/#3/#4/#5/#8 → Task 3. Copertura completa.
- Nessun placeholder; codice reale per route/nav/revoke/cache/findFirst; test descritti con casi concreti e mock pattern esistente.
- Tipi coerenti: `RevokeInviteResult` usato in `actions.ts` + `revoke-button.tsx`; `authorizeTeamCreate` OK-return con `userId` consumato in `createInvitationAction`.
