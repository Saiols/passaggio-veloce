# "Impostazioni sede" per ADMIN_SEDE + follow-up review

> Spec di design — 2026-07-07
> Stato: APPROVATA (design). Owner: Francesco Sioli (CTO).
> Estende: `docs/superpowers/specs/2026-07-07-multi-sede-revisione-autonomia-sedi-design.md`.

## 1. Contesto

La revisione multi-sede ha reso l'ADMIN_SEDE titolare autonomo della propria sede e ha
**autorizzato** `updateSedeAction` (anagrafica/IBAN/soglia) per lui, ma senza un
**percorso UI**: le pagine `/sedi` e `/sedi/[id]` restano owner-only. Questa estensione dà
all'ADMIN_SEDE una pagina dedicata per le impostazioni della propria sede, e sistema i
follow-up minori emersi dalla review finale.

## 2. Decisioni (approvate con l'utente)

- **D1 — Route dedicata `/impostazioni-sede`** scopata alla **sede operativa corrente**
  (paradigma di `/wallet` e `/orari`), NON riuso di `/sedi/[id]`. Href statico → nessun id
  sede da passare al client shell; nessun bottone owner-only da nascondere.
- **D2 — Orari separati**: la pagina rimanda a `/orari` (che resta la pagina degli orari),
  non li duplica.
- **D3 — `revokeInvitationAction`** passa da `Promise<void>` a un risultato con errore
  visibile; il `RevokeButton` mostra l'errore.
- CRUD sedi (crea/sospendi/riattiva) resta **owner-only** su `/sedi`.
- **Nessun cambio schema/migration.** Solo logica + UI.

## 3. Componenti

### 3.1 Route `/impostazioni-sede` (`app/impostazioni-sede/page.tsx`, server)
- Risolve `getOperatingSede()`. Se null → notice "Seleziona una sede dal menù in alto".
- Gate: `canEditSedeSettings(await getSedeRole(sede.id))` (OWNER|ADMIN_SEDE); altrimenti
  `redirect('/dashboard')`.
- Carica la sede (`prisma.sede.findFirst({ where: { id: sede.id, deletedAt: null } })`) e
  renderizza `<SedeEdit sedeId={sede.id} data={...}>` (riuso del componente di `/sedi/[id]`:
  anagrafica/telefono/email/codiceInterno/**IBAN**/**soglia payout** → `updateSedeAction`).
- Card **link affiliazione** della sede (informativa, come in `/sedi/[id]`).
- Per le AGENZIE: rimando testuale/link a `/orari` per gli orari di apertura.
- `activePath="/impostazioni-sede"`. Nessun sospendi/riattiva, nessun crea.

### 3.2 Voce nav (`components/broker/broker-shell.tsx`, `components/agenzia/agenzia-shell.tsx`)
- Gruppo "Impostazioni": `{ href: '/impostazioni-sede', label: 'Impostazioni sede' }` mostrata
  quando **`!isAdminAzienda && canManageTeam`** (= admin di sede non-owner). L'owner tiene
  "Sedi" (invariato); l'ADMIN_SEDE vede "Impostazioni sede".

## 4. Follow-up

- **F1 — `cache()` su `getSessionContext`** (`lib/auth/session-context.ts`): avvolgere il corpo
  in `cache()` di React (import da `'react'`). `auth()`/`cookies()` sono request-scoped → dedup
  per-request sicuro; nessun cambio di comportamento. `getSedeRole`/`getManageableSedi`/
  `getOperatingSede` ne beneficiano (una sola risoluzione per request).
- **F2 — scoping `findFirst`** (`app/team/[userId]/edit/page.tsx`): aggiungere
  `sedeId: { in: manageableIds }` alla `prisma.userSede.findFirst` usata per l'autorizzazione
  (deterministico, allineato a `authorizeTeamTargetUser` in `team/actions.ts`).
- **F3 — test action-level** (nuovo `app/sedi/actions.authz.test.ts` + casi in
  `app/wallet/actions.test.ts` e nuovo `app/orari/actions.authz.test.ts`): per
  `updateSedeAction`/`updatePayoutThresholdAction`/`updateOrariAction` — OPERATORE negato
  (nessuna scrittura), ADMIN_SEDE della sede consentito (scrittura), ruolo null/cross-sede negato.
  Mock di `getSedeRole`/`getOperatingSede` + prisma.
- **F4 — pulizia minori:**
  - #1: spostare in cima al file il secondo blocco `import` di `lib/sedi/scope.test.ts`.
  - #3/#4: `authorizeTeamCreate` (in `team/actions.ts`) ritorna anche `userId` (da
    `ctx.user.id`); `createInvitationAction` usa `authz.userId` per `invitedById`, eliminando
    la seconda `auth()` e il `session!.user!.id!`.
  - #5: `revokeInvitationAction` → `Promise<{ ok: true } | { ok: false; error: string }>`;
    `RevokeButton` mostra l'errore (stato locale + testo).
  - #8: uniformare `isOwner(session.user.role)` (senza cast) tra `wallet/actions.ts` e
    `wallet/page.tsx`.

## 5. Testing
- F3 come sopra (gate sede). Nuova route: gate coperto dagli unit dei suoi primitivi
  (`getSedeRole`/`canEditSedeSettings`, già testati) + il gate action-level di F3.
- Regressione: suite completa verde, typecheck, lint, build.

## 6. Fuori scope
- Cambi schema/migration; CRUD sedi per ADMIN_SEDE; duplicazione orari nella nuova route.
