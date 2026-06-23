# Sistema Multi-Sede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passare da "1 registrazione = 1 broker/1 agenzia" a "1 registrazione (azienda madre, P.IVA unica) = N sedi operative", preservando identico il caso 1:1.

**Architecture:** `Company` resta il soggetto giuridico/fiscale; nuovo modello `Sede` per le unità operative. I sottosistemi operativi (pratiche, assegnazione, calendario, wallet, valutazioni, referral) si agganciano a `Sede`; fatturazione/SEPA/KYC restano sulla `Company` madre. Migrazione **expand → backfill → (sviluppo branch) → contract** in coda.

**Tech Stack:** Next.js 16 (App Router, Server Actions), NextAuth v5, Prisma 5.22 + Postgres, Vitest 4 (unit test con `vi.mock('@pv/db')`), pnpm + Turborepo. Spec di riferimento: `docs/sistema-multi-sede.md`.

## Global Constraints

- Node ≥ 22 (`nvm use 22.15.0` post-riavvio). pnpm ≥ 10.
- Comandi (dalla root): test = `pnpm --filter piattaforma run test -- <file>`; typecheck = `pnpm typecheck`; migrate dev = `pnpm --filter @pv/db db:migrate`; create-only = `pnpm --filter @pv/db exec prisma migrate dev --create-only --name <name>`; seed = `pnpm --filter @pv/db db:seed`; DB locale = `pnpm db:up` (docker compose Postgres).
- Branch di lavoro: `feat/multi-sede`. Merge su `main` solo a feature completa e validata.
- TDD: dalla Fase 2 in poi ogni logica pura è guidata da test Vitest (pattern repo: mock di `@pv/db`, file `*.test.ts` accanto al sorgente). La Fase 1 (schema/migrazione/seed) è verificata integration-style sul DB locale (migrate pulito + typecheck + script di verifica invarianti) perché il repo NON ha harness DB di test.
- Invarianti dati (devono valere dopo migrazione E dopo seed): ogni `Company` ha ≥1 `Sede`; ogni `Pratica` non-bozza ha `brokerSedeId`; ogni `Wallet` operativo ha `sedeId` (companyId NULL); ogni `User` con `companyId` ha ≥1 riga `UserSede`.
- Le colonne vecchie (`Pratica.brokerId`, `agenziaAssegnataId`, `*.agenziaId`, `Wallet.companyId` NOT NULL, ecc.) **restano** fino alla Fase 8 (contract). Niente DROP né NOT NULL sulle nuove colonne in Fase 1.

---

## Mappa file (decisa qui, lockata per le fasi)

**Fase 1 (questa):**
- Modifica: `packages/db/prisma/schema.prisma` — nuovi modelli `Sede`/`UserSede`, enum `RuoloSede`, `Wallet` polimorfico, nuove colonne FK nullable + relazioni (vecchie mantenute).
- Crea: `packages/db/prisma/migrations/<ts>_multi_sede_expand/migration.sql` — schema diff Prisma + backfill SQL hand-edited.
- Modifica: `packages/db/prisma/seed.ts` — blocco backfill in coda a `main()` che genera 1 sede/azienda + popola le nuove colonne + crea `UserSede` + sposta ownership wallet.
- Crea: `packages/db/prisma/verify-multi-sede.ts` — script di verifica invarianti (assert + exit code).

**Fasi 2-8:** mappa file dettagliata all'inizio di ciascuna fase quando la si pianifica (vedi §Roadmap in fondo).

---

## FASE 1 — Schema & Migrazione (expand + backfill)

Obiettivo: schema esteso, migrazione con backfill sui dati esistenti, seed che genera la nuova forma, script di verifica. Nessun codice applicativo cambia (l'app continua a girare sulle colonne vecchie).

### Task 1.1: Schema Prisma — nuovi modelli ed enum

**Files:**
- Modifica: `packages/db/prisma/schema.prisma`

**Interfaces (Produces):** modelli Prisma `Sede`, `UserSede`, enum `RuoloSede`; relazioni `Company.sedi`, `Company.referenteSede`, `User.sediMembership`; campi FK nullable su `Pratica`/`PraticaAssegnazione`/`OrariApertura`/`ChiusuraStraordinaria`/`Listino`/`Valutazione`/`FeeAddebito`/`ReferralClick`/`EventoPratica`/`Invitation`/`CommissioneAffiliazione`; `Wallet` con `sedeId?`/`companyId?`.

- [ ] **Step 1: Aggiungere enum + modelli `Sede` e `UserSede`**

In `schema.prisma`, dopo l'enum `InvitationStatus` (zona enum identità) aggiungere:

```prisma
enum RuoloSede {
  ADMIN_SEDE
  OPERATORE
}
```

Nella sezione MODELS — identità (dopo `Company`/`User`), aggiungere:

```prisma
model Sede {
  id        String      @id @default(uuid()) @db.Uuid
  companyId String      @db.Uuid
  company   Company     @relation("CompanySedi", fields: [companyId], references: [id], onDelete: Cascade)
  type      CompanyType

  nome      String
  indirizzo String
  civico    String?
  citta     String
  cap       String
  provincia String
  telefono  String?
  email     String?

  iban                String?
  payoutThresholdCent Int     @default(100000)
  referralCode        String? @unique
  codiceInterno       String?

  suspendedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  praticheBroker        Pratica[]                 @relation("PraticheBrokerSede")
  praticheAgenzia       Pratica[]                 @relation("PraticheAgenziaSede")
  assegnazioni          PraticaAssegnazione[]
  orariApertura         OrariApertura[]
  chiusureStraordinarie ChiusuraStraordinaria[]
  listini               Listino[]
  valutazioniRicevute   Valutazione[]             @relation("ValutazioniAgenziaSede")
  valutazioniFatte      Valutazione[]             @relation("ValutazioniBrokerSede")
  wallet                Wallet?                   @relation("WalletSede")
  feeAddebiti           FeeAddebito[]
  referralClicks        ReferralClick[]
  membership            UserSede[]
  eventi                EventoPratica[]
  notifiche             NotificaInviata[]
  commissioniAttribuite CommissioneAffiliazione[] @relation("SedeAffiliante")
  companiesAffiliate    Company[]                 @relation("SedeReferral")

  @@index([companyId])
  @@index([type])
  @@index([citta])
  @@index([provincia])
  @@map("sedi")
}

model UserSede {
  id     String    @id @default(uuid()) @db.Uuid
  userId String    @db.Uuid
  user   User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  sedeId String    @db.Uuid
  sede   Sede      @relation(fields: [sedeId], references: [id], onDelete: Cascade)
  ruolo  RuoloSede @default(OPERATORE)

  createdAt DateTime @default(now())

  @@unique([userId, sedeId])
  @@index([sedeId])
  @@index([userId])
  @@map("user_sedi")
}
```

- [ ] **Step 2: Aggiungere le relazioni inverse su `Company` e `User`**

In `model Company`, aggiungere (mantenendo tutto il resto):
```prisma
  sedi            Sede[]   @relation("CompanySedi")
  referenteSedeId String?  @db.Uuid
  referenteSede   Sede?    @relation("SedeReferral", fields: [referenteSedeId], references: [id])
```
In `model User`, aggiungere:
```prisma
  sediMembership UserSede[]
```

- [ ] **Step 3: `Wallet` polimorfico (sede | madre)**

Sostituire in `model Wallet` la riga `companyId String @unique @db.Uuid` + relativa relation con:
```prisma
  sedeId    String?  @unique @db.Uuid
  sede      Sede?    @relation("WalletSede", fields: [sedeId], references: [id], onDelete: Cascade)
  companyId String?  @unique @db.Uuid
  company   Company? @relation(fields: [companyId], references: [id], onDelete: Cascade)
```
(La relation `wallet Wallet?` su `Company` resta: ora rappresenta il wallet affiliazione madre.)

- [ ] **Step 4: Nuove colonne FK nullable sui modelli operativi (vecchie mantenute)**

Aggiungere, accanto ai campi esistenti, senza rimuovere nulla:

```prisma
// model Pratica
  brokerSedeId  String? @db.Uuid
  brokerSede    Sede?   @relation("PraticheBrokerSede", fields: [brokerSedeId], references: [id])
  agenziaSedeId String? @db.Uuid
  agenziaSede   Sede?   @relation("PraticheAgenziaSede", fields: [agenziaSedeId], references: [id])
// + @@index([brokerSedeId]) @@index([agenziaSedeId])

// model PraticaAssegnazione
  sedeId String? @db.Uuid
  sede   Sede?   @relation(fields: [sedeId], references: [id])
// + @@index([sedeId])

// model OrariApertura
  sedeId String? @db.Uuid
  sede   Sede?   @relation(fields: [sedeId], references: [id])

// model ChiusuraStraordinaria
  sedeId String? @db.Uuid
  sede   Sede?   @relation(fields: [sedeId], references: [id])

// model Listino
  sedeId String? @db.Uuid
  sede   Sede?   @relation(fields: [sedeId], references: [id])

// model Valutazione
  agenziaSedeId String? @db.Uuid
  agenziaSede   Sede?   @relation("ValutazioniAgenziaSede", fields: [agenziaSedeId], references: [id])
  brokerSedeId  String? @db.Uuid
  brokerSede    Sede?   @relation("ValutazioniBrokerSede", fields: [brokerSedeId], references: [id])

// model FeeAddebito
  agenziaSedeId String? @db.Uuid
  agenziaSede   Sede?   @relation(fields: [agenziaSedeId], references: [id])
// + @@index([agenziaSedeId])

// model ReferralClick
  sedeId String? @db.Uuid
  sede   Sede?   @relation(fields: [sedeId], references: [id])

// model EventoPratica
  targetSedeId String? @db.Uuid
  targetSede   Sede?   @relation(fields: [targetSedeId], references: [id])

// model Invitation
  sedeId    String?   @db.Uuid
  ruoloSede RuoloSede @default(OPERATORE)

// model CommissioneAffiliazione
  referenteSedeId String? @db.Uuid
  referenteSede   Sede?   @relation("SedeAffiliante", fields: [referenteSedeId], references: [id])
```

- [ ] **Step 5: Validare lo schema e rigenerare il client**

Run: `pnpm --filter @pv/db exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `pnpm --filter @pv/db db:generate`
Expected: `Generated Prisma Client` senza errori.

- [ ] **Step 6: Typecheck del package db**

Run: `pnpm --filter @pv/db typecheck`
Expected: nessun errore (il seed compila ancora: usa solo colonne vecchie, che esistono).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(multi-sede): schema Sede/UserSede + colonne operative (expand)"
```

### Task 1.2: Migrazione con backfill

**Files:**
- Crea: `packages/db/prisma/migrations/<timestamp>_multi_sede_expand/migration.sql`

**Interfaces (Consumes):** modelli/colonne dal Task 1.1.

- [ ] **Step 1: Generare la migrazione SENZA applicarla**

Assicurarsi che il DB locale sia su e con dati seed (`pnpm db:up` poi, se serve, `pnpm --filter @pv/db db:seed`).

Run: `pnpm --filter @pv/db exec prisma migrate dev --create-only --name multi_sede_expand`
Expected: crea `prisma/migrations/<ts>_multi_sede_expand/migration.sql` (CREATE TABLE sedi/user_sedi, ALTER ADD COLUMN, indici, FK, enum `RuoloSede`) e NON applica.

- [ ] **Step 2: Aggiungere il backfill in coda alla `migration.sql`**

Aprire la `migration.sql` generata e **appendere in fondo** (dopo tutte le CREATE/ALTER/FK):

```sql
-- ============================================================
-- BACKFILL multi-sede: 1 sede per company esistente + re-pointing FK
-- ============================================================

-- 1) Una Sede "specchio" per ogni Company esistente (mappa via companyId).
INSERT INTO "sedi" (
  "id","companyId","type","nome","indirizzo","civico","citta","cap","provincia",
  "telefono","email","iban","payoutThresholdCent","referralCode",
  "createdAt","updatedAt","deletedAt"
)
SELECT
  gen_random_uuid(), c."id", c."type", c."ragioneSociale", c."indirizzo", c."civico",
  c."citta", c."cap", c."provincia", c."telefono", c."email", c."iban",
  c."payoutThresholdCent", c."referralCode",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, c."deletedAt"
FROM "companies" c;

-- 2) Pratiche: broker e agenzia → sede (1 sede per company ⇒ join univoco).
UPDATE "pratiche" p SET "brokerSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = p."brokerId";
UPDATE "pratiche" p SET "agenziaSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = p."agenziaAssegnataId" AND p."agenziaAssegnataId" IS NOT NULL;

-- 3) Assegnazioni, calendario, listini, valutazioni, fee, referral, eventi.
UPDATE "pratiche_assegnazioni" pa SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = pa."agenziaId";
UPDATE "orari_apertura" o SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = o."agenziaId";
UPDATE "chiusure_straordinarie" ch SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = ch."agenziaId";
UPDATE "listini" l SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = l."agenziaId";
UPDATE "valutazioni" v SET "agenziaSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = v."agenziaId";
UPDATE "valutazioni" v SET "brokerSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = v."dealerId";
UPDATE "fee_addebiti" f SET "agenziaSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = f."agenziaId";
UPDATE "referral_clicks" rc SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = rc."companyId";
UPDATE "eventi_pratica" e SET "targetSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = e."targetCompanyId";

-- 4) Wallet operativo: sposta ownership da company a sede.
UPDATE "wallets" w SET "sedeId" = s."id", "companyId" = NULL
  FROM "sedi" s WHERE s."companyId" = w."companyId";

-- 5) Affiliazione: referenteSede della company = sede della madre referente.
UPDATE "companies" c SET "referenteSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = c."referenteId" AND c."referenteId" IS NOT NULL;
UPDATE "commissioni_affiliazione" ca SET "referenteSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = ca."referenteId";

-- 6) UserSede: una membership per ogni utente con companyId.
INSERT INTO "user_sedi" ("id","userId","sedeId","ruolo","createdAt")
SELECT
  gen_random_uuid(), u."id", s."id",
  CASE WHEN u."role" = 'ADMIN_AZIENDA' THEN 'ADMIN_SEDE'::"RuoloSede" ELSE 'OPERATORE'::"RuoloSede" END,
  CURRENT_TIMESTAMP
FROM "users" u
JOIN "sedi" s ON s."companyId" = u."companyId"
WHERE u."companyId" IS NOT NULL;
```

> NB: non aggiungere `NOT NULL` né `DROP COLUMN` qui (fase expand). Verranno fatti in Fase 8.

- [ ] **Step 3: Applicare la migrazione**

Run: `pnpm --filter @pv/db db:migrate`
Expected: applica `multi_sede_expand`, `Already in sync`/`migration applied`, rigenera il client senza errori.

- [ ] **Step 4: Sanity check rapido via psql/Studio**

Run: `pnpm db:studio` (oppure una query) e verificare a vista che la tabella `sedi` abbia 1 riga per ogni company e che alcune `pratiche` abbiano `brokerSedeId` valorizzato.
Expected: conteggio `sedi` == conteggio `companies`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(multi-sede): migrazione expand + backfill 1 sede per company"
```

### Task 1.3: Seed — genera la nuova forma (1 sede/azienda + new FK)

Il backfill SQL vale solo per i dati già presenti al momento della migrazione. Un DB fresco (`migrate reset` + seed) crea aziende SENZA sedi: il seed deve generare la nuova forma. Lo facciamo con un blocco riusabile in coda a `main()` (DRY: stessa logica del backfill, in TypeScript), così non tocchiamo le decine di `create` esistenti.

**Files:**
- Modifica: `packages/db/prisma/seed.ts` (in coda a `main()`, prima di `console.log` finali)

**Interfaces (Consumes):** client Prisma con i nuovi modelli (Task 1.1/1.2 applicati).

- [ ] **Step 1: Aggiungere il blocco backfill idempotente in coda a `main()`**

Inserire prima della chiusura di `main()`:

```typescript
  // ============================================================
  // MULTI-SEDE: 1 sede "specchio" per ogni company + re-pointing FK.
  // Idempotente: salta le company che hanno già una sede.
  // ============================================================
  console.log('');
  console.log('  [MULTI-SEDE backfill seed]');

  const allCompanies = await prisma.company.findMany();
  for (const c of allCompanies) {
    const existing = await prisma.sede.findFirst({ where: { companyId: c.id } });
    if (existing) continue;

    const sede = await prisma.sede.create({
      data: {
        companyId: c.id,
        type: c.type,
        nome: c.ragioneSociale,
        indirizzo: c.indirizzo,
        civico: c.civico,
        citta: c.citta,
        cap: c.cap,
        provincia: c.provincia,
        telefono: c.telefono,
        email: c.email,
        iban: c.iban,
        payoutThresholdCent: c.payoutThresholdCent,
        referralCode: c.referralCode,
        deletedAt: c.deletedAt,
      },
    });

    // Re-pointing FK operative verso la sede appena creata.
    await prisma.pratica.updateMany({ where: { brokerId: c.id }, data: { brokerSedeId: sede.id } });
    await prisma.pratica.updateMany({ where: { agenziaAssegnataId: c.id }, data: { agenziaSedeId: sede.id } });
    await prisma.praticaAssegnazione.updateMany({ where: { agenziaId: c.id }, data: { sedeId: sede.id } });
    await prisma.orariApertura.updateMany({ where: { agenziaId: c.id }, data: { sedeId: sede.id } });
    await prisma.chiusuraStraordinaria.updateMany({ where: { agenziaId: c.id }, data: { sedeId: sede.id } });
    await prisma.listino.updateMany({ where: { agenziaId: c.id }, data: { sedeId: sede.id } });
    await prisma.valutazione.updateMany({ where: { agenziaId: c.id }, data: { agenziaSedeId: sede.id } });
    await prisma.valutazione.updateMany({ where: { dealerId: c.id }, data: { brokerSedeId: sede.id } });
    await prisma.feeAddebito.updateMany({ where: { agenziaId: c.id }, data: { agenziaSedeId: sede.id } });
    await prisma.referralClick.updateMany({ where: { companyId: c.id }, data: { sedeId: sede.id } });
    await prisma.eventoPratica.updateMany({ where: { targetCompanyId: c.id }, data: { targetSedeId: sede.id } });

    // Wallet operativo: sposta ownership company → sede.
    const w = await prisma.wallet.findFirst({ where: { companyId: c.id } });
    if (w) {
      await prisma.wallet.update({ where: { id: w.id }, data: { sedeId: sede.id, companyId: null } });
    }

    // UserSede per gli utenti della company.
    const users = await prisma.user.findMany({ where: { companyId: c.id } });
    for (const u of users) {
      await prisma.userSede.upsert({
        where: { userId_sedeId: { userId: u.id, sedeId: sede.id } },
        update: {},
        create: {
          userId: u.id,
          sedeId: sede.id,
          ruolo: u.role === 'ADMIN_AZIENDA' ? 'ADMIN_SEDE' : 'OPERATORE',
        },
      });
    }
  }

  // Affiliazione: referenteSede = sede della madre referente.
  const refed = await prisma.company.findMany({ where: { referenteId: { not: null } } });
  for (const c of refed) {
    const refSede = await prisma.sede.findFirst({ where: { companyId: c.referenteId! } });
    if (refSede) await prisma.company.update({ where: { id: c.id }, data: { referenteSedeId: refSede.id } });
  }
  console.log(`  · sedi backfill: ${allCompanies.length} company processate`);
```

- [ ] **Step 2: Eseguire un reset completo + seed sul DB locale**

Run: `pnpm --filter @pv/db exec prisma migrate reset --force`
Expected: droppa, riapplica tutte le migrazioni (inclusa `multi_sede_expand`), esegue il seed; termina senza errori e stampa `[MULTI-SEDE backfill seed]`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pv/db typecheck`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(multi-sede): seed genera 1 sede per azienda + UserSede + wallet sede"
```

### Task 1.4: Script di verifica invarianti

**Files:**
- Crea: `packages/db/prisma/verify-multi-sede.ts`

**Interfaces (Produces):** script eseguibile via `tsx` che asserisce le invarianti dati e ritorna exit code 1 su violazione.

- [ ] **Step 1: Scrivere lo script di verifica**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const errors: string[] = [];

  const companies = await prisma.company.count();
  const sedi = await prisma.sede.count();
  if (sedi < companies) errors.push(`sedi (${sedi}) < companies (${companies}): qualche company senza sede`);

  const companiesNoSede = await prisma.company.findMany({
    where: { sedi: { none: {} } },
    select: { id: true, ragioneSociale: true },
  });
  if (companiesNoSede.length) errors.push(`Company senza sede: ${companiesNoSede.map((c) => c.ragioneSociale).join(', ')}`);

  const praticheNoBrokerSede = await prisma.pratica.count({ where: { brokerSedeId: null } });
  if (praticheNoBrokerSede) errors.push(`${praticheNoBrokerSede} pratiche senza brokerSedeId`);

  const walletNoSede = await prisma.wallet.count({ where: { sedeId: null, companyId: null } });
  if (walletNoSede) errors.push(`${walletNoSede} wallet orfani (né sede né company)`);

  const usersWithCompany = await prisma.user.count({ where: { companyId: { not: null } } });
  const usersWithMembership = await prisma.user.count({
    where: { companyId: { not: null }, sediMembership: { some: {} } },
  });
  if (usersWithMembership < usersWithCompany) {
    errors.push(`UserSede mancanti: ${usersWithCompany - usersWithMembership} utenti con companyId senza membership`);
  }

  if (errors.length) {
    console.error('❌ Invarianti multi-sede VIOLATE:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('✅ Invarianti multi-sede OK', { companies, sedi });
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Eseguire lo script sul DB locale (post reset+seed)**

Run: `pnpm --filter @pv/db exec tsx prisma/verify-multi-sede.ts`
Expected: `✅ Invarianti multi-sede OK { companies: N, sedi: N }` ed exit code 0.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/verify-multi-sede.ts
git commit -m "test(multi-sede): script verifica invarianti dati"
```

### Exit criteria Fase 1
- `prisma validate` ok, client generato, `pnpm typecheck` verde.
- `migrate reset --force` (migrazioni + seed) gira pulito.
- `verify-multi-sede.ts` esce 0 con tutte le invarianti soddisfatte.
- App ancora funzionante sulle colonne vecchie (nessun codice applicativo toccato).

---

## ROADMAP fasi 2-8 (da dettagliare bite-sized all'inizio di ciascuna)

Ogni fase produce software testabile e chiude con i suoi test. Da qui in poi vale la TDD Vitest piena (logica pura in `apps/piattaforma/src`, test `*.test.ts` con mock `@pv/db`). Mappa esplicita spec → fase per garantire copertura.

### Fase 2 — Auth & contesto sede (spec §8)
- **File chiave:** `apps/piattaforma/src/auth.ts`, `auth.config.ts`, nuovo `src/lib/auth/session-context.ts` (`getSessionContext()`), nuovo `src/lib/sedi/scope.ts` (`assertSedeAccess`, risoluzione `accessibleSedi`/`currentSede` da cookie `pv_sede`), `src/lib/auth/permissions.ts` (helper `isOwner`).
- **Test:** unit su risoluzione contesto (proprietario→tutte; admin/operatore→membership; sede singola→fissa; `'ALL'` solo proprietario); `assertSedeAccess` nega sedi fuori membership.
- **Exit:** `getSessionContext()` usato come unica fonte di scoping; cookie `pv_sede` validato server-side.

### Fase 3 — Re-pointing operativo (spec §5.4)
- **File chiave:** `apps/piattaforma/src/app/pratiche/**` (queries `brokerId`→`brokerSedeId`, `agenziaAssegnataId`→`agenziaSedeId`), motore di distribuzione/assegnazione (round 1/2/3) → `sedeId`, calendario agenzia (`OrariApertura`/`ChiusuraStraordinaria`), `Valutazione`, `Wallet` (per sede), `EventoPratica` (`targetSedeId`). Da localizzare con precisione il file del motore di distribuzione.
- **Test:** unit su selezione agenzia (ora sede) per geografia/calendario; scoping pratiche per `currentSede`.
- **Exit:** flussi pratica/assegnazione/calendario operano su `Sede`; app gira su colonne nuove (vecchie ancora presenti ma non più lette nei path toccati).

### Fase 4 — Registrazione (spec §7)
- **File chiave:** `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (step "Sedi"), `(auth)/actions.ts` (`registerAction`: crea N `Sede` + referral per sede; risoluzione `?ref=` su `Sede.referralCode` → `referenteId`=madre, `referenteSedeId`=sede), `src/lib/auth/schemas.ts` (schema sedi).
- **Test:** unit su validazione step sedi (≥1, derivazione auto caso 1:1); risoluzione referral per sede.
- **Exit:** registrazione crea madre + sedi; caso 1 sede con UX invariata.

### Fase 5 — UI loggata (spec §9)
- **File chiave:** `apps/piattaforma/src/components/app-shell.tsx` (selettore sede), `app/dashboard/page.tsx` (vista proprietario aggregata + breakdown per sede + classifica affiliazione), nuova area gestione sedi (CRUD), `app/team/**` (inviti con `sedeId`/`ruoloSede`, accettazione crea `UserSede`).
- **Test:** unit su aggregazione KPI multi-sede; gating inviti (proprietario tutte le sedi, admin di sede solo la propria).
- **Exit:** proprietario vede tutto+drill-down; operatori scoped; inviti per sede.

### Fase 6 — Affiliazione (spec §10)
- **File chiave:** `src/lib/affiliazione/accredit.ts` (referente via `brokerSede.company.referente`, accredito al wallet madre, `referenteSedeId` su commissione), `check.ts` (anti-collusione a granularità madre), `app/affiliazione/page.tsx` (link/QR per sede + classifica), `lib/jobs/affiliation-monthly-recap.ts` (recap con classifica sedi), risolutore `/r/[code]` (lookup `Sede.referralCode`, fallback legacy `Company.referralCode`).
- **Test:** unit su attribuzione commissione (madre riceve, sede attribuita); anti-collusione non flagga sedi della stessa madre.
- **Exit:** affiliazione per sede → commissione madre + classifica; anti-collusione corretto.

### Fase 7 — Wallet/payout & fee (spec §5.5, §11)
- **File chiave:** `app/wallet/page.tsx` (wallet per sede + wallet affiliazione madre), payout (IBAN sede→fallback madre), `FeeAddebito` (addebito SEPA via mandato madre, attribuzione sede), soglie payout per sede.
- **Test:** unit su risoluzione IBAN payout (sede ?? madre); risoluzione mandato SEPA fee (sede→madre); soglia per sede.
- **Exit:** payout per sede; fee addebitata via mandato madre con attribuzione sede.

### Fase 8 — Contract & hardening (spec §6 Fase D, §12)
- **File chiave:** nuova migrazione `multi_sede_contract` (`NOT NULL` su `Pratica.brokerSedeId` ecc.; DROP colonne vecchie `brokerId`/`agenziaAssegnataId`/`*.agenziaId`/`Wallet.companyId`-legacy/`Company.referralCode` se confermato); rimozione relazioni vecchie da `schema.prisma`; audit scoping su tutte le server action.
- **Test:** ri-eseguire `verify-multi-sede.ts`; suite unit completa; E2E (registrazione multi-sede, selettore, vista proprietario, operatore scoped, affiliazione, payout, fee, caso 1:1 invariato).
- **Exit:** schema pulito (solo colonne nuove), invarianti verdi, E2E passati. Pronto per merge su `main` + `prisma migrate deploy` in prod.

---

## Self-review (coverage spec → piano)
- spec §5 (modello dati) → Task 1.1; §6 (migrazione) → Task 1.2/1.3 (expand+backfill+seed) e Fase 8 (contract); §7 (registrazione) → Fase 4; §8 (auth/contesto) → Fase 2; §9 (UI) → Fase 5; §5.4 (re-pointing) → Fase 3; §10 (affiliazione) → Fase 6; §5.5/§11 (wallet/fee/fatturazione) → Fase 7; §12 (autorizzazione) → Fasi 2/8; §13 (casi limite) → coperti nei test delle rispettive fasi; §15 (testing) → exit criteria di ogni fase. Nessuna sezione spec senza fase.
