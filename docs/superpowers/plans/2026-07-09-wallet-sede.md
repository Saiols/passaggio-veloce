# Wallet: gate payout, penale sul wallet di sede, vista aggregata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere una falla di autorizzazione sul payout, far finire la penale broker sul wallet della sede (così tutti i membri vedono lo stesso saldo) e dare al proprietario una vista aggregata dei wallet di tutte le sue sedi.

**Architecture:** Il wallet operativo appartiene alla **sede** dal 24 giugno (migration `20260624013750_multi_sede_expand`), ma il flusso penale risolve ancora il wallet per `companyId` e ne crea uno "madre" nuovo. Un helper server-only centralizza la risoluzione del wallet di una pratica; una migration dati sposta le transazioni finite sul wallet sbagliato con aggiustamenti a **delta** (mai ricalcoli globali). Il gate del payout riusa il predicato già esistente per la soglia (`canEditSedeSettings`). La vista aggregata è una variante **in sola lettura** della pagina wallet, attiva quando il proprietario non ha selezionato una sede.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma + Postgres, vitest.

**Spec di riferimento:** `docs/superpowers/specs/2026-07-09-wallet-sede-design.md`

## Global Constraints

- **Node**: `nvm use 22.15.0` prima di qualunque comando `pnpm`.
- **Il gate di autorizzazione vive sul server.** Nascondere un bottone è cortesia, non sicurezza: la Server Action deve rifiutare comunque.
- **Il wallet è della sede.** Tutti i membri di una sede vedono lo stesso saldo e gli stessi movimenti. Il wallet madre (`companyId`) esiste solo per le **commissioni di affiliazione** ed è visibile/incassabile dal solo proprietario.
- **`saldoCent` = somma delle `importoCent` delle sue transazioni.** Verificato: il payout registra una transazione negativa oltre a decrementare il saldo. La migration dati deve mantenere l'invariante.
- **`saldoPostCent` NON si riscrive**: è il saldo *al momento* della transazione, un dato di audit storico.
- **La migration dati usa delta, non ricalcoli globali.** Un `UPDATE wallets SET saldoCent = (SELECT SUM(...))` "aggiusterebbe" silenziosamente anche drift preesistenti che non abbiamo indagato.
- **Non toccare** `CREDITO_AFFILIAZIONE` né i `payouts`.
- **N17 non va toccata**: il payload passa `saldoBroker: newSaldo`, cioè il saldo del wallet appena aggiornato, quindi si corregge da sola. Resta indirizzata all'admin azienda perché è un'email amministrativa.
- **Migration dati idempotente**: rieseguirla non deve spostare nulla una seconda volta.
- **Applicare la migration SOLO al Postgres locale in Docker** (`pv-postgres`). MAI a Neon: il rilascio in prod è un passo separato deciso dall'utente.
- `pnpm typecheck` a cache fredda è inaffidabile (falsi errori Prisma / stack overflow).
- **Commit** in italiano, conventional commits, con trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **NON fare push.** Push su `main` = deploy in produzione.

## File Structure

Nuovi:

| File | Responsabilità |
|---|---|
| `apps/piattaforma/src/app/wallet/actions.authz.test.ts` | Blinda il gate del payout: operatore rifiutato, admin di sede ammesso. |
| `apps/piattaforma/src/lib/wallet/wallet-pratica.ts` | `walletBrokerDellaPratica`: unico posto che sa quale wallet è di una pratica. |
| `apps/piattaforma/src/lib/wallet/wallet-pratica.test.ts` | Verifica gli **argomenti** della query, non solo il risultato. |
| `packages/db/prisma/migrations/20260709190000_penale_su_wallet_sede/migration.sql` | Migration dati. |
| `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx` | Vista sola lettura dei wallet di tutte le sedi. |

Modificati:

| File | Modifica |
|---|---|
| `apps/piattaforma/src/app/wallet/actions.ts` | gate su `richiediPayoutAction` |
| `apps/piattaforma/src/app/wallet/page.tsx` | nasconde il blocco payout; ramo aggregato |
| `apps/piattaforma/src/lib/penali/segnalazione.ts` | usa l'helper invece dell'upsert per `companyId` |

---

### Task 1: Il payout lo chiede solo chi può

Falla di autorizzazione **live in produzione**: `richiediPayoutAction` non controlla il ruolo, e il `PayoutButton` è renderizzato per tutti. Un operatore di sede può incassare il wallet.

Questa task è autonoma: si può rilasciare da sola.

**Files:**
- Test: `apps/piattaforma/src/app/wallet/actions.authz.test.ts`
- Modify: `apps/piattaforma/src/app/wallet/actions.ts` (`richiediPayoutAction`)
- Modify: `apps/piattaforma/src/app/wallet/page.tsx` (blocco "Payout")

**Interfaces:**
- Consumes: `getOperatingSede()`, `getSedeRole(sedeId)` da `@/lib/auth/session-context`; `canEditSedeSettings(role)` da `@/lib/sedi/scope` (ritorna true per `'OWNER'` e `'ADMIN_SEDE'`).

- [ ] **Step 1: Scrivi il test che fallisce**

Il mock segue la convenzione di `apps/piattaforma/src/app/team/actions.authz.test.ts` (`vi.hoisted` + `vi.mock`).

Crea `apps/piattaforma/src/app/wallet/actions.authz.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOperatingSedeMock, getSedeRoleMock, eseguiPayoutMock, prismaMock } = vi.hoisted(() => ({
  getOperatingSedeMock: vi.fn(),
  getSedeRoleMock: vi.fn(),
  eseguiPayoutMock: vi.fn(() => Promise.resolve({ ok: true })),
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })) },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/auth', () => ({
  auth: vi.fn(() =>
    Promise.resolve({ user: { id: 'u1', role: 'UTENTE_AZIENDA', companyId: 'c1', companyType: 'DEALER' } }),
  ),
}));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getOperatingSede: getOperatingSedeMock, getSedeRole: getSedeRoleMock };
});
vi.mock('@/lib/wallet/payout-exec', () => ({ eseguiPayoutImmediato: eseguiPayoutMock }));

import { richiediPayoutAction } from './actions';

const SEDE = { id: 's1', nome: 'Filiale', type: 'DEALER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  getOperatingSedeMock.mockResolvedValue(SEDE);
  // Saldo ampiamente sopra la soglia minima: il gate NON deve dipendere dal saldo.
  prismaMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 100_000_00 });
  prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
  eseguiPayoutMock.mockResolvedValue({ ok: true });
});

describe('richiediPayoutAction — chi può incassare', () => {
  it('operatore di sede: rifiutato, e NESSUN payout viene eseguito', async () => {
    getSedeRoleMock.mockResolvedValue('OPERATORE');

    const res = await richiediPayoutAction();

    expect(res).toEqual({ ok: false, error: expect.stringContaining('permessi') });
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });

  it('admin della sede: ammesso', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');

    await expect(richiediPayoutAction()).resolves.toEqual({ ok: true });
    expect(eseguiPayoutMock).toHaveBeenCalledTimes(1);
  });

  it('proprietario: ammesso', async () => {
    getSedeRoleMock.mockResolvedValue('OWNER');

    await expect(richiediPayoutAction()).resolves.toEqual({ ok: true });
  });

  it('nessuna sede selezionata: rifiutato prima di leggere qualunque wallet', async () => {
    getOperatingSedeMock.mockResolvedValue(null);

    const res = await richiediPayoutAction();

    expect(res).toEqual({ ok: false, error: expect.stringContaining('Seleziona una sede') });
    expect(prismaMock.wallet.findUnique).not.toHaveBeenCalled();
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });

  it('il gate viene valutato sulla sede operativa', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');

    await richiediPayoutAction();

    expect(getSedeRoleMock).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
nvm use 22.15.0
pnpm --filter piattaforma exec vitest run src/app/wallet/actions.authz.test.ts
```

Atteso: FAIL. In particolare il caso *"operatore di sede"* deve fallire perché oggi l'action **esegue il payout** (`eseguiPayoutMock` chiamato) e ritorna `{ ok: true }`. È la dimostrazione della falla.

- [ ] **Step 3: Aggiungi il gate**

In `apps/piattaforma/src/app/wallet/actions.ts`, dentro `richiediPayoutAction`, sostituisci:

```ts
  const sede = await getOperatingSede();
  const includeAffiliazione = isOwner(session.user.role);
```

con:

```ts
  const sede = await getOperatingSede();
  if (!sede) {
    return { ok: false, error: 'Seleziona una sede per richiedere il payout' };
  }
  // Il payout è un'operazione finanziaria della sede: la chiede il titolare o
  // l'admin di quella sede, non un operatore. Stesso predicato usato per la
  // soglia payout (updatePayoutThresholdAction, poco più sotto).
  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) {
    return { ok: false, error: 'Non hai i permessi per richiedere il payout di questa sede' };
  }

  const includeAffiliazione = isOwner(session.user.role);
```

Ora `sede` non è più nullable: nel `Promise.all` subito sotto, il ramo `sede ? … : null` diventa la sola `prisma.wallet.findUnique({ where: { sedeId: sede.id }, select: { id: true, saldoCent: true } })`.

Gli import di `getSedeRole` e `canEditSedeSettings` sono **già presenti** in cima al file.

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/app/wallet/actions.authz.test.ts
```

Atteso: PASS, 5 test.

- [ ] **Step 5: Nascondi il blocco payout a chi non può usarlo**

In `apps/piattaforma/src/app/wallet/page.tsx` c'è una `<div className="mb-5 rounded-2xl border border-pv-slate-200 bg-white p-6">` il cui primo figlio è `<h2 …>Payout</h2>`. Oggi è renderizzata sempre.

Non riscrivere il suo contenuto. Fai due sole modifiche testuali:

1. **prima** di quella `<div>` inserisci `{canEditSedeSettings(sedeRole) && (`
2. **dopo** la sua `</div>` di chiusura inserisci `)}`

`sedeRole` è già calcolato poco sopra (`const sedeRole = await getSedeRole(sede.id);`) e `canEditSedeSettings` è già importato in cima al file. La card contiene già al suo interno un `{canEditSedeSettings(sedeRole) && …}` per la soglia payout: dopo questa modifica quel controllo interno è ridondante, ma **lasciacelo** — rimuoverlo non serve e allarga il diff.

⚠️ Il banner `saldoNegativo` sta **fuori** da questa card, più in alto nella pagina: non spostarlo e non avvolgerlo. L'operatore deve continuare a vedere *perché* il wallet è in rosso, anche se non può incassare.

- [ ] **Step 6: Verifica**

```bash
nvm use 22.15.0
pnpm --filter piattaforma test
pnpm typecheck
```

Atteso: suite verde, typecheck pulito.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/wallet/actions.authz.test.ts apps/piattaforma/src/app/wallet/actions.ts apps/piattaforma/src/app/wallet/page.tsx
git commit -m "$(cat <<'EOF'
fix(wallet): il payout lo richiede solo titolare o admin di sede

richiediPayoutAction non aveva alcun controllo di ruolo: un operatore di sede
poteva incassare il wallet, e il bottone era renderizzato per tutti (isTitolare
serviva solo al testo della modale). Gate sul server con lo stesso predicato
gia' usato per la soglia payout; il bottone sparisce a chi non puo' usarlo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: La penale va sul wallet della sede

**Files:**
- Create: `apps/piattaforma/src/lib/wallet/wallet-pratica.ts`
- Test: `apps/piattaforma/src/lib/wallet/wallet-pratica.test.ts`
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts` (dentro `confermaAnnullamentoConPenaleAction`)

**Interfaces:**
- Produces: `walletBrokerDellaPratica(tx, pratica: { brokerId: string; brokerSedeId: string | null }): Promise<{ id: string; saldoCent: number }>`

- [ ] **Step 1: Scrivi il test che fallisce**

Il test verifica gli **argomenti** della query, non solo il risultato: un mock restituisce il valore preconfezionato qualunque `where` gli passi, quindi asserire solo l'output non proteggerebbe da una regressione sul campo di ricerca — che è esattamente il bug che stiamo chiudendo.

Crea `apps/piattaforma/src/lib/wallet/wallet-pratica.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { walletBrokerDellaPratica } from './wallet-pratica';

const upsert = vi.fn();
const tx = { wallet: { upsert } } as unknown as Parameters<typeof walletBrokerDellaPratica>[0];

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ id: 'w1', saldoCent: 0 });
});

describe('walletBrokerDellaPratica', () => {
  it('pratica con sede: usa il wallet della SEDE, mai quello della madre', async () => {
    await walletBrokerDellaPratica(tx, { brokerId: 'c1', brokerSedeId: 's1' });

    expect(upsert).toHaveBeenCalledWith({
      where: { sedeId: 's1' },
      update: {},
      create: { sedeId: 's1', saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
  });

  it('pratica legacy senza sede: ricade sul wallet della madre', async () => {
    await walletBrokerDellaPratica(tx, { brokerId: 'c1', brokerSedeId: null });

    expect(upsert).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      update: {},
      create: { companyId: 'c1', saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
  });

  it('restituisce id e saldo del wallet risolto', async () => {
    upsert.mockResolvedValue({ id: 'w9', saldoCent: 4200 });

    await expect(walletBrokerDellaPratica(tx, { brokerId: 'c1', brokerSedeId: 's1' })).resolves.toEqual({
      id: 'w9',
      saldoCent: 4200,
    });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
nvm use 22.15.0
pnpm --filter piattaforma exec vitest run src/lib/wallet/wallet-pratica.test.ts
```

Atteso: FAIL — `Failed to resolve import "./wallet-pratica"`.

- [ ] **Step 3: Scrivi l'helper**

Crea `apps/piattaforma/src/lib/wallet/wallet-pratica.ts`:

```ts
import 'server-only';
import type { Prisma } from '@pv/db';

/**
 * Il wallet operativo del broker per questa pratica.
 *
 * Dal 24 giugno (migration `20260624013750_multi_sede_expand`) il wallet
 * operativo appartiene alla SEDE, non all'azienda: `UPDATE wallets SET sedeId =
 * …, companyId = NULL`. Chi cerca ancora per `companyId` non trova nulla e —
 * con un upsert — si ritrova a creare un wallet "madre" nuovo di zecca, che la
 * pagina wallet mostra al solo proprietario. È così che la penale spariva agli
 * occhi dell'operatore.
 *
 * Il wallet madre resta legittimo per le pratiche legacy senza `brokerSedeId`:
 * lì non c'è una sede a cui attribuire il movimento.
 */
export async function walletBrokerDellaPratica(
  tx: Prisma.TransactionClient,
  pratica: { brokerId: string; brokerSedeId: string | null },
): Promise<{ id: string; saldoCent: number }> {
  if (pratica.brokerSedeId) {
    return tx.wallet.upsert({
      where: { sedeId: pratica.brokerSedeId },
      update: {},
      create: { sedeId: pratica.brokerSedeId, saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
  }

  return tx.wallet.upsert({
    where: { companyId: pratica.brokerId },
    update: {},
    create: { companyId: pratica.brokerId, saldoCent: 0 },
    select: { id: true, saldoCent: true },
  });
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/wallet/wallet-pratica.test.ts
```

Atteso: PASS, 3 test.

- [ ] **Step 5: Usa l'helper nel flusso penale**

In `apps/piattaforma/src/lib/penali/segnalazione.ts`, dentro `confermaAnnullamentoConPenaleAction`, aggiungi l'import:

```ts
import { walletBrokerDellaPratica } from '@/lib/wallet/wallet-pratica';
```

e sostituisci:

```ts
      // Wallet broker (lazy create)
      const wallet = await tx.wallet.upsert({
        where: { companyId: pratica.brokerId },
        update: {},
        create: { companyId: pratica.brokerId, saldoCent: 0 },
      });
      let saldo = wallet.saldoCent;
```

con:

```ts
      // Wallet operativo della pratica: quello della SEDE del broker. Cercarlo
      // per companyId ne creava uno nuovo "madre", invisibile a operatori e
      // admin di sede — e lo storno qui sotto non trovava mai il credito.
      const wallet = await walletBrokerDellaPratica(tx, pratica);
      let saldo = wallet.saldoCent;
```

`pratica` viene da una `tx.pratica.findUnique({ include: … })`, che restituisce tutti gli scalari: `brokerId` e `brokerSedeId` sono già disponibili, non serve toccare la query.

**Non toccare altro in questo file.** Il `findFirst` dello storno filtra già su `walletId: wallet.id`: cambiando il wallet, inizia a trovare davvero il `CREDITO_PRATICA`. E la N17 legge `saldoBroker: newSaldo`, quindi si corregge da sola.

- [ ] **Step 6: Verifica**

```bash
nvm use 22.15.0
pnpm --filter piattaforma test
pnpm typecheck
```

Atteso: suite verde, typecheck pulito. Se un test esistente di `penali` mocka `tx.wallet.upsert` aspettandosi `companyId`, **aggiornalo**: l'aspettativa vecchia codificava il bug.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/wallet/wallet-pratica.ts apps/piattaforma/src/lib/wallet/wallet-pratica.test.ts apps/piattaforma/src/lib/penali/segnalazione.ts
git commit -m "$(cat <<'EOF'
fix(wallet): la penale broker va sul wallet della sede della pratica

La migration multi-sede ha spostato i wallet operativi da company a sede, ma il
flusso penale cercava ancora per companyId: l'upsert creava un wallet "madre"
nuovo, che la pagina mostra al solo proprietario. Da qui i saldi divergenti fra
titolare e operatore, e la penale invisibile a chi lavora in sede.

Effetto collaterale: lo storno del CREDITO_PRATICA cercava sul wallet appena
creato e non lo trovava mai. Ora punta al wallet giusto.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration dati — sposta le penali già finite sul wallet sbagliato

Il Task 2 sistema il futuro. Questo sistema il passato.

**Files:**
- Create: `packages/db/prisma/migrations/20260709190000_penale_su_wallet_sede/migration.sql`

**Interfaces:** nessuna (SQL puro).

- [ ] **Step 1: Fotografa lo stato PRIMA, sul DB locale**

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT t.tipo, CASE WHEN w.\"sedeId\" IS NOT NULL THEN 'SEDE' ELSE 'MADRE' END dove, count(*), sum(t.\"importoCent\") FROM transazioni_wallet t JOIN wallets w ON w.id=t.\"walletId\" GROUP BY 1,2 ORDER BY 1,2;"
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT w.id, w.\"saldoCent\", COALESCE(SUM(t.\"importoCent\"),0) somma_tx FROM wallets w LEFT JOIN transazioni_wallet t ON t.\"walletId\"=w.id GROUP BY w.id, w.\"saldoCent\";"
```

Salva l'output nel report: serve come termine di paragone.

- [ ] **Step 2: Scrivi la migration**

Crea `packages/db/prisma/migrations/20260709190000_penale_su_wallet_sede/migration.sql`:

```sql
-- Migration DATI (nessun cambio di schema).
--
-- Dal 2026-06-24 il wallet operativo appartiene alla SEDE (vedi
-- 20260624013750_multi_sede_expand, punto 4). Il flusso penale ha continuato a
-- risolvere il wallet per companyId, creando wallet "madre" nuovi e
-- addebitandoci PENALE_BROKER (e l'eventuale STORNO). Quei wallet la pagina li
-- mostra al solo proprietario: operatori e admin di sede non vedevano la penale.
--
-- Qui spostiamo quelle transazioni sul wallet della sede della pratica e
-- correggiamo i saldi con DELTA (non ricalcoli globali: un ricalcolo
-- "aggiusterebbe" in silenzio anche drift che non abbiamo indagato).
--
-- Idempotente: dopo lo spostamento le righe non soddisfano più il join su
-- wallets.companyId, quindi una riesecuzione non fa nulla.
--
-- Non tocchiamo mai: CREDITO_AFFILIAZIONE, payouts, saldoPostCent (audit
-- storico: è il saldo *in quel momento*, non un valore da ricalcolare).

-- 1) Wallet di sede mancanti per le sedi coinvolte.
INSERT INTO "wallets" ("id", "sedeId", "saldoCent", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."brokerSedeId", 0, now(), now()
FROM "transazioni_wallet" t
JOIN "wallets" wm ON wm."id" = t."walletId" AND wm."companyId" IS NOT NULL
JOIN "pratiche" p ON p."id" = t."praticaId"
WHERE t."tipo" IN ('PENALE_BROKER', 'STORNO')
  AND p."brokerSedeId" IS NOT NULL
GROUP BY p."brokerSedeId"
ON CONFLICT ("sedeId") DO NOTHING;

-- 2) Il wallet madre perde l'effetto delle transazioni che se ne vanno.
--    Gli importi sono negativi, quindi sottrarne la somma alza il saldo.
UPDATE "wallets" w
SET "saldoCent" = w."saldoCent" - x."delta", "updatedAt" = now()
FROM (
  SELECT t."walletId" AS wid, SUM(t."importoCent") AS delta
  FROM "transazioni_wallet" t
  JOIN "wallets" wm ON wm."id" = t."walletId" AND wm."companyId" IS NOT NULL
  JOIN "pratiche" p ON p."id" = t."praticaId"
  JOIN "wallets" ws ON ws."sedeId" = p."brokerSedeId"
  WHERE t."tipo" IN ('PENALE_BROKER', 'STORNO')
  GROUP BY t."walletId"
) x
WHERE w."id" = x."wid";

-- 3) Il wallet di sede acquisisce quell'effetto.
UPDATE "wallets" w
SET "saldoCent" = w."saldoCent" + x."delta", "updatedAt" = now()
FROM (
  SELECT ws."id" AS wid, SUM(t."importoCent") AS delta
  FROM "transazioni_wallet" t
  JOIN "wallets" wm ON wm."id" = t."walletId" AND wm."companyId" IS NOT NULL
  JOIN "pratiche" p ON p."id" = t."praticaId"
  JOIN "wallets" ws ON ws."sedeId" = p."brokerSedeId"
  WHERE t."tipo" IN ('PENALE_BROKER', 'STORNO')
  GROUP BY ws."id"
) x
WHERE w."id" = x."wid";

-- 4) Sposta le transazioni. DEVE venire dopo i due UPDATE: quelli leggono
--    ancora le righe sul wallet madre.
UPDATE "transazioni_wallet" t
SET "walletId" = ws."id"
FROM "wallets" wm, "pratiche" p, "wallets" ws
WHERE t."walletId" = wm."id"
  AND wm."companyId" IS NOT NULL
  AND p."id" = t."praticaId"
  AND ws."sedeId" = p."brokerSedeId"
  AND t."tipo" IN ('PENALE_BROKER', 'STORNO');

-- 5) Elimina i wallet madre rimasti vuoti: sono quelli nati dal solo bug.
--    Un wallet madre con commissioni di affiliazione reali ha transazioni e non
--    viene toccato. Uno vuoto viene ricreato al primo accredito, se serve.
DELETE FROM "wallets" w
WHERE w."companyId" IS NOT NULL
  AND w."saldoCent" = 0
  AND NOT EXISTS (SELECT 1 FROM "transazioni_wallet" t WHERE t."walletId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "payouts" p WHERE p."walletId" = w."id");
```

- [ ] **Step 3: Applica al DB locale**

```bash
nvm use 22.15.0
pnpm -F @pv/db exec prisma migrate deploy
```

Atteso: `Applying migration 20260709190000_penale_su_wallet_sede` e `All migrations have been successfully applied.`

⚠️ Se Prisma segnala **drift** o propone un reset del database, **FERMATI e chiedi**: il DB locale è una copia dei dati di produzione e non va resettato.

- [ ] **Step 4: Verifica gli invarianti DOPO**

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT count(*) FROM transazioni_wallet t JOIN wallets w ON w.id=t.\"walletId\" WHERE w.\"companyId\" IS NOT NULL AND t.tipo IN ('PENALE_BROKER','STORNO');"
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT w.id, w.\"saldoCent\", COALESCE(SUM(t.\"importoCent\"),0) somma, w.\"saldoCent\" = COALESCE(SUM(t.\"importoCent\"),0) AS invariante_ok FROM wallets w LEFT JOIN transazioni_wallet t ON t.\"walletId\"=w.id GROUP BY w.id, w.\"saldoCent\";"
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT count(*) FROM transazioni_wallet t JOIN wallets w ON w.id=t.\"walletId\" WHERE t.tipo='CREDITO_AFFILIAZIONE' AND w.\"sedeId\" IS NOT NULL;"
```

Attese, in ordine:
1. **0** — nessuna penale/storno resta su un wallet madre (a meno di pratiche legacy senza `brokerSedeId`: se il numero non è 0, controlla che *tutte* le righe rimaste abbiano `pratiche.brokerSedeId IS NULL`, ed è corretto);
2. `invariante_ok = t` per **ogni** wallet;
3. **0** — nessuna commissione di affiliazione è finita su un wallet di sede.

- [ ] **Step 5: Verifica l'idempotenza**

Ri-eseguire la migration non è possibile con `migrate deploy` (è già registrata). Eseguila una seconda volta a mano contro il DB locale e verifica che **non cambi nulla**:

```bash
docker exec -i pv-postgres psql -U pv -d passaggio_veloce < packages/db/prisma/migrations/20260709190000_penale_su_wallet_sede/migration.sql
```

Poi ripeti le tre query dello Step 4: gli invarianti devono reggere identici. Se un saldo cambia, la migration **non** è idempotente e va corretta.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/migrations/20260709190000_penale_su_wallet_sede/migration.sql
git commit -m "$(cat <<'EOF'
fix(wallet): migration dati, sposta le penali sul wallet della sede

Le PENALE_BROKER (e gli STORNO) applicati dopo il 24 giugno sono finiti su
wallet "madre" creati dal bug. Qui si spostano sul wallet della sede della
pratica, con delta sui saldi anziche' ricalcoli globali, e si eliminano i wallet
madre rimasti vuoti. Idempotente. Non tocca affiliazione, payout, saldoPostCent.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Vista aggregata per il proprietario

Oggi il proprietario in vista "tutte le sedi" vede solo un banner *"Seleziona una sede"*: `getOperatingSede()` ritorna `null` quando ha più di una sede e nessuna è selezionata.

**Files:**
- Create: `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx`
- Modify: `apps/piattaforma/src/app/wallet/page.tsx` (il ramo `if (!sede)`)

**Interfaces:**
- Consumes: `getSessionContext()` da `@/lib/auth/session-context` (espone `accessibleSedi: { id, nome, type }[]`, `isOwner`, `companyId`); `getRendimento(walletId: string | string[] | null, period: RendimentoPeriod, types?: readonly string[])` da `./rendimento`; `RendimentoChart({ buckets, accent })` da `./rendimento-chart`; `formatCurrencyCent`, `formatDateTime` da `@/lib/format`.
- Firme verificate: `StatCard({ label, value, hint?, icon?, accent?, href? })`, `Card({ className?, children, padded? })` da `@/components/ui`.

- [ ] **Step 1: Crea il componente della vista aggregata**

Crea `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx`. È un **server component** (nessun `'use client'`).

```tsx
import { formatCurrencyCent, formatDateTime } from '@/lib/format';
import { Card, StatCard } from '@/components/ui';

export type RigaSede = { sedeId: string; nome: string; saldoCent: number };
export type MovimentoAggregato = {
  id: string;
  createdAt: Date;
  tipo: string;
  importoCent: number;
  /** Nome della sede, oppure `null` per il wallet madre (affiliazione). */
  origine: string | null;
};

/**
 * Wallet in vista aggregata: il proprietario non ha selezionato una sede, quindi
 * vede la somma di tutte. È di sola lettura — per incassare bisogna scegliere
 * una sede, perché il payout è un'operazione di quella sede.
 */
export function WalletAggregato({
  totaleCent,
  saldoAffiliazioneCent,
  righe,
  movimenti,
}: {
  totaleCent: number;
  saldoAffiliazioneCent: number;
  righe: RigaSede[];
  movimenti: MovimentoAggregato[];
}) {
  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Totale di tutte le sedi" value={formatCurrencyCent(totaleCent)} />
        <StatCard
          label="di cui commissioni affiliazione"
          value={formatCurrencyCent(saldoAffiliazioneCent)}
        />
      </div>

      <Card className="mb-6">
        <h2 className="text-base font-bold text-pv-navy-900">Saldo per sede</h2>
        <p className="mt-1 text-sm text-pv-slate-500">
          Seleziona una sede dal menù in alto per vederne i movimenti e richiedere il payout.
        </p>
        <div className="mt-4 divide-y divide-pv-slate-200">
          {righe.map((r) => (
            <div key={r.sedeId} className="flex items-center justify-between py-3">
              <span className="text-sm font-medium text-pv-slate-700">{r.nome}</span>
              <span
                className={`text-sm font-semibold ${
                  r.saldoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-800'
                }`}
              >
                {formatCurrencyCent(r.saldoCent)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-bold text-pv-navy-900">Movimenti recenti</h2>
        <div className="mt-4 divide-y divide-pv-slate-200">
          {movimenti.length === 0 ? (
            <p className="py-6 text-center text-sm text-pv-slate-500">Nessun movimento.</p>
          ) : (
            movimenti.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-pv-slate-700">{m.tipo}</p>
                  <p className="text-[12px] text-pv-slate-500">
                    {formatDateTime(m.createdAt)}
                    {m.origine ? ` · ${m.origine}` : ' · Affiliazione'}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold ${
                    m.importoCent < 0 ? 'text-pv-red-500' : 'text-pv-green-500'
                  }`}
                >
                  {formatCurrencyCent(m.importoCent)}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
```

Le firme di `Card` e `StatCard` sono già state verificate contro `apps/piattaforma/src/components/ui`: `StatCard({ label, value, … })` e `Card({ className, children, … })` accettano esattamente le prop usate qui. Non modificare i componenti condivisi.

Il grafico del rendimento **non** sta dentro questo componente: la pagina lo renderizza già con `<RendimentoChart buckets={…} accent="navy" />`, e nella vista aggregata lo riusiamo così com'è (vedi Step 2).

- [ ] **Step 2: Aggancia il ramo aggregato nella pagina**

In `apps/piattaforma/src/app/wallet/page.tsx`, sostituisci il ramo:

```tsx
  const sede = await getOperatingSede();
  if (!sede) {
    return (
      <AppShell session={session} activePath="/wallet">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Seleziona una sede dal menù in alto per vederne il wallet.
          </Alert>
        </div>
      </AppShell>
    );
  }
```

con un ramo che, per il proprietario, mostra la vista aggregata. Serve `getSessionContext` (import da `@/lib/auth/session-context`) e `WalletAggregato`:

```tsx
  const sede = await getOperatingSede();
  if (!sede) {
    const ctx = await getSessionContext();
    // Solo il proprietario può trovarsi senza sede operativa (vista "tutte le
    // sedi"). Per chiunque altro `resolveOperatingSede` restituisce una sede.
    if (!ctx?.isOwner || ctx.accessibleSedi.length === 0) {
      return (
        <AppShell session={session} activePath="/wallet">
          <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
            <Alert variant="info">
              Seleziona una sede dal menù in alto per vederne il wallet.
            </Alert>
          </div>
        </AppShell>
      );
    }

    const sedeIds = ctx.accessibleSedi.map((s) => s.id);
    const nomeSede = new Map(ctx.accessibleSedi.map((s) => [s.id, s.nome]));

    const [walletsSede, walletMadreAgg] = await Promise.all([
      prisma.wallet.findMany({
        where: { sedeId: { in: sedeIds } },
        include: { transazioni: { orderBy: { createdAt: 'desc' }, take: 20 } },
      }),
      ctx.companyId
        ? prisma.wallet.findUnique({
            where: { companyId: ctx.companyId },
            include: { transazioni: { orderBy: { createdAt: 'desc' }, take: 20 } },
          })
        : null,
    ]);

    const saldoAffiliazioneCent = walletMadreAgg?.saldoCent ?? 0;
    const totaleCent =
      walletsSede.reduce((acc, w) => acc + w.saldoCent, 0) + saldoAffiliazioneCent;

    // Una riga per OGNI sede accessibile, anche senza wallet: saldo 0.
    const righe = ctx.accessibleSedi.map((s) => ({
      sedeId: s.id,
      nome: s.nome,
      saldoCent: walletsSede.find((w) => w.sedeId === s.id)?.saldoCent ?? 0,
    }));

    const movimenti = [
      ...walletsSede.flatMap((w) =>
        w.transazioni.map((t) => ({
          id: t.id,
          createdAt: t.createdAt,
          tipo: labelTipoTx(t.tipo),
          importoCent: t.importoCent,
          origine: nomeSede.get(w.sedeId!) ?? null,
        })),
      ),
      ...(walletMadreAgg?.transazioni ?? []).map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        tipo: labelTipoTx(t.tipo),
        importoCent: t.importoCent,
        origine: null,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20);

    // Rendimento aggregato: `getRendimento` accetta già una lista di walletId,
    // quindi aggregare i wallet di tutte le sedi costa una riga.
    const periodAgg: RendimentoPeriod = PERIOD_OPTIONS.some((o) => o.value === sp.rendimento)
      ? (sp.rendimento as RendimentoPeriod)
      : '30d';
    const rendimentoAgg = await getRendimento(
      [...walletsSede.map((w) => w.id), walletMadreAgg?.id].filter((x): x is string => !!x),
      periodAgg,
      ['CREDITO_PRATICA', 'CREDITO_AFFILIAZIONE'],
    );

    return (
      <AppShell session={session} activePath="/wallet">
        <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
          <header className="mb-7">
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Area finanziaria
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Wallet · tutte le sedi
            </h1>
            <p className="mt-1 text-[14px] text-pv-slate-500">
              Vista di sola lettura. Per richiedere un payout seleziona la sede.
            </p>
          </header>

          <WalletAggregato
            totaleCent={totaleCent}
            saldoAffiliazioneCent={saldoAffiliazioneCent}
            righe={righe}
            movimenti={movimenti}
          />

          <Card className="mt-6">
            <h2 className="text-base font-bold text-pv-navy-900">Rendimento</h2>
            <div className="mt-4">
              <RendimentoChart buckets={rendimentoAgg.buckets} accent="navy" />
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }
```

`Card`, `RendimentoChart`, `getRendimento`, `PERIOD_OPTIONS` e `RendimentoPeriod` sono **già importati** in `page.tsx`. `sp` (i `searchParams`) è già in scope.

Nota: `w.sedeId!` è sicuro perché la query filtra `sedeId: { in: sedeIds }`.

- [ ] **Step 3: Verifica**

```bash
nvm use 22.15.0
pnpm typecheck
pnpm --filter piattaforma test
pnpm --filter piattaforma lint
```

Atteso: typecheck pulito, suite verde, lint senza errori (4 warning preesistenti in `register-wizard.tsx` e `api/badges/route.test.ts` sono attesi).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/wallet/wallet-aggregato.tsx apps/piattaforma/src/app/wallet/page.tsx
git commit -m "$(cat <<'EOF'
feat(wallet): vista aggregata di tutte le sedi per il proprietario

In vista "tutte le sedi" il wallet mostrava solo un banner. Ora: totale
complessivo, saldo per sede e movimenti recenti uniti. Sola lettura: il payout
resta un'operazione della singola sede, quindi va selezionata.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verifica finale

**Files:** nessuno (solo verifica), salvo fix emersi.

- [ ] **Step 1: Suite, typecheck, lint**

```bash
nvm use 22.15.0
pnpm --filter piattaforma test
pnpm typecheck
pnpm --filter piattaforma lint
```

- [ ] **Step 2: Le query nuove contro il DB reale, in sola lettura**

I test mockano Prisma: una query valida per TypeScript può essere sbagliata per il DB. Crea `packages/db/__tmp_wallet_check.mjs` (lì risolve `@prisma/client`), eseguilo, poi **cancellalo**.

```js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// La query della vista aggregata
const sedi = await prisma.sede.findMany({ where: { type: 'DEALER', deletedAt: null }, select: { id: true } });
const ws = await prisma.wallet.findMany({
  where: { sedeId: { in: sedi.map((s) => s.id) } },
  include: { transazioni: { orderBy: { createdAt: 'desc' }, take: 20 } },
});
console.log('wallet di sede:', ws.length, '| transazioni caricate:', ws.reduce((a, w) => a + w.transazioni.length, 0));

// Controprova: sede inesistente deve dare 0 (una query rotta darebbe 0 uguale)
const zero = await prisma.wallet.count({ where: { sedeId: { in: ['00000000-0000-0000-0000-000000000000'] } } });
console.log('controprova sede inesistente:', zero, '(deve essere 0)');

// L'invariante saldo == somma transazioni, dopo la migration
for (const w of await prisma.wallet.findMany({ select: { id: true, saldoCent: true } })) {
  const agg = await prisma.transazioneWallet.aggregate({ where: { walletId: w.id }, _sum: { importoCent: true } });
  const somma = agg._sum.importoCent ?? 0;
  console.log(w.id, 'saldo', w.saldoCent, 'somma', somma, w.saldoCent === somma ? 'OK' : '✗ DISALLINEATO');
}
await prisma.$disconnect();
```

```bash
nvm use 22.15.0
cd packages/db && node __tmp_wallet_check.mjs && rm __tmp_wallet_check.mjs
```

Attenzione: una query rotta e una query giusta senza dati restituiscono **entrambe 0**. La controprova con la sede inesistente serve a distinguerle.

- [ ] **Step 3: Prova a video**

```bash
pnpm --filter piattaforma dev
```

1. Come **operatore** di una sede dealer: la pagina wallet mostra il saldo; il blocco Payout **non c'è**.
2. Come **admin di sede**: il blocco Payout c'è.
3. Come **proprietario** con più sedi, senza sede selezionata: vista aggregata con totale, righe per sede e movimenti; nessun payout.
4. Come proprietario, selezionando una sede: pagina normale, payout presente.

- [ ] **Step 4: Rilascio — l'ordine è INVERSO rispetto al solito**

⚠️ **Correzione dopo la review finale.** La regola di progetto "migration prima del push" vale per le
migration di **schema**: il codice nuovo ha bisogno delle colonne nuove. Questa è una migration di
**dati**, e il bug che ripara è chiuso dal codice che esce nello stesso rilascio. Se la applichi a
Neon mentre il codice **vecchio** è ancora live, una penale confermata in quella finestra crea di
nuovo un wallet madre — e la migration, già eseguita, non lo spazzerà mai. Ricreeresti in silenzio
la deriva che hai appena pulito.

Sequenza corretta:

1. **Prima il codice**: merge in `main` e push. Da quel momento le penali nuove finiscono sul wallet
   di sede. Le penali storiche mal attribuite restano visibili al solo proprietario: innocuo, e
   comunque meglio di prima.
2. **Pre-flight su Neon** (sola lettura): verifica che ogni `brokerSedeId` appartenga davvero alla
   company della pratica, altrimenti la migration sposterebbe denaro fra aziende diverse.
   ```sql
   SELECT count(*) FROM pratiche p LEFT JOIN sedi s ON s.id = p."brokerSedeId"
   WHERE p."brokerSedeId" IS NOT NULL AND s."companyId" IS DISTINCT FROM p."brokerId";
   ```
   Deve dare **0**. In locale dà 0 su 16 pratiche. Se in prod non desse 0, **fermarsi**.
3. **Poi la migration**: `prisma migrate deploy` contro Neon.
4. Ri-eseguire le tre query di verifica dello Step 4 del Task 3 contro Neon.
5. La migration è **idempotente**: se una penale è passata durante la finestra di deploy, rieseguire
   l'SQL a mano la spazza.
6. Ruotare le credenziali Neon.

---

## Note per chi implementa

- **Non "ottimizzare" la migration dati con un ricalcolo globale** del tipo `UPDATE wallets SET saldoCent = (SELECT SUM(importoCent) …)`. Sembra più semplice, ma silenziosamente riscriverebbe i saldi di wallet che non c'entrano nulla, mascherando eventuali drift che nessuno ha ancora indagato.
- Il Task 1 è indipendente dagli altri e chiude una falla live: se qualcosa si complica nei task successivi, quello è comunque rilasciabile da solo.
- Se un test esistente si aspettava `tx.wallet.upsert({ where: { companyId } })` nel flusso penale, quell'aspettativa **codificava il bug**: va aggiornata, non aggirata.
