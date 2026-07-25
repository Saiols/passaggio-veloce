# Email univoca sull'intera piattaforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un'email identifica un solo account su tutta la piattaforma; oggi due aziende diverse possono registrarsi con la stessa email.

**Architecture:** Un vincolo `UNIQUE(email)` sul DB è la garanzia reale; un modulo condiviso (`lib/auth/email-univoca.ts`) è l'unica fonte della regola applicativa e viene chiamato dai 10 punti di scrittura; i read path che oggi gestiscono N account per email vengono semplificati a riga singola.

**Tech Stack:** Next.js 16 App Router (Server Actions), Prisma 5.22 + PostgreSQL 17, Auth.js (Credentials + JWT), vitest, pnpm/Turborepo.

**Spec:** `docs/superpowers/specs/2026-07-25-email-univoca-design.md`

## Global Constraints

- **Node:** dopo un riavvio la shell torna a Node 16. Eseguire `nvm use 22.15.0` prima di qualunque comando `pnpm` (pnpm richiede ≥18).
- **Comandi dalla root** `C:\Users\fsiol\Desktop\passaggio_veloce` salvo indicazione diversa.
- **Test:** `pnpm --filter piattaforma test` (vitest run). Un singolo file: `pnpm --filter piattaforma test <path>`.
- **Typecheck:** `pnpm typecheck` funziona solo a cache calda (col `tsbuildinfo`). A cache fredda `tsc` va in stack overflow / falsi errori Prisma: non trattare un fallimento a freddo come un errore reale del codice.
- **`pnpm db:migrate` è vietato**: `prisma migrate dev` propone DROP SEQUENCE distruttivi. Migration scritte a mano + `pnpm --filter @pv/db db:deploy`.
- **DB locale:** container `pv-postgres` (postgres:17-alpine), database `passaggio_veloce`, utente `pv`. Accesso: `docker exec pv-postgres psql -U pv -d passaggio_veloce -c "<SQL>"`. La tabella si chiama **`users`** (minuscolo, `@@map`), non `User`.
- **Testi degli errori, esatti e verbatim:**
  - `EMAIL_GIA_IN_USO` = `Questa email è già associata a un account Passaggio Veloce`
  - `EMAIL_GIA_REGISTRATA` = `Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.`
- **Il check applicativo NON filtra su `deletedAt`**: un utente eliminato continua a occupare la sua email (decisione esplicita della spec).
- **Il check applicativo NON filtra su `companyId`**: nessuna eccezione per azienda o per staff di piattaforma.
- **Commit:** in italiano, prefisso convenzionale (`fix:`, `feat:`, `refactor:`, `test:`). Chiudere ogni commit con:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Creati:**
- `apps/piattaforma/src/lib/auth/email-univoca.ts` — fonte unica della regola: normalizzazione, messaggi, check di esistenza, riconoscimento P2002.
- `apps/piattaforma/src/lib/auth/email-univoca.test.ts` — test del modulo.
- `packages/db/prisma/migrations/20260725140000_user_email_unique/migration.sql` — vincolo DB.

**Modificati:**
- `packages/db/prisma/schema.prisma:518-625` — modello `User`.
- `apps/piattaforma/src/app/(auth)/actions.ts` — registrazione (check + P2002), login pre-check, verifica email, reset password.
- `apps/piattaforma/src/app/(auth)/actions.test.ts` — regressione registrazione + adeguamento test login.
- `apps/piattaforma/src/auth.ts:26-52` — `authorize`.
- `apps/piattaforma/src/app/team/actions.ts` — 4 call site.
- `apps/piattaforma/src/app/team/actions.authz.test.ts`, `permessi.authz.test.ts` — mock adeguati.
- `apps/piattaforma/src/app/admin/assistenti/actions.ts` — 2 call site.
- `apps/piattaforma/src/app/admin/crm/utenti/actions.ts` — 2 call site.
- `apps/piattaforma/src/app/profilo/personale/actions.ts` — cambio email + cambio password.

---

### Task 1: Modulo condiviso `email-univoca.ts`

**Files:**
- Create: `apps/piattaforma/src/lib/auth/email-univoca.ts`
- Test: `apps/piattaforma/src/lib/auth/email-univoca.test.ts`

**Interfaces:**
- Consumes: `prisma` e `Prisma` da `@pv/db`.
- Produces — tutti i task successivi importano da `@/lib/auth/email-univoca`:
  - `normalizzaEmail(raw: string): string`
  - `EMAIL_GIA_IN_USO: string`
  - `EMAIL_GIA_REGISTRATA: string`
  - `emailGiaInUso(emailLower: string, opts?: { escludiUserId?: string }): Promise<boolean>`
  - `isViolazioneEmailUnica(error: unknown): boolean`
  - `scriviUtente<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }>`

- [ ] **Step 1: Scrivi il test (fallisce: il modulo non esiste)**

Crea `apps/piattaforma/src/lib/auth/email-univoca.test.ts`.

Nota sul mock: qui serve il **vero** namespace `Prisma` (altrimenti `instanceof PrismaClientKnownRequestError` non funziona), quindi si mocka solo `prisma` tenendo il resto reale via `importOriginal`. È diverso da `(auth)/actions.test.ts`, che mocka l'intero modulo.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { user: { findFirst: vi.fn() } },
}));

// Solo `prisma` è mockato: `Prisma` resta quello vero, altrimenti
// `instanceof PrismaClientKnownRequestError` sarebbe sempre false.
vi.mock('@pv/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: prismaMock };
});

import { Prisma } from '@pv/db';
import {
  normalizzaEmail,
  emailGiaInUso,
  isViolazioneEmailUnica,
  scriviUtente,
} from './email-univoca';

function p2002(target: string[] | string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

beforeEach(() => {
  prismaMock.user.findFirst.mockReset();
  prismaMock.user.findFirst.mockResolvedValue(null);
});

describe('normalizzaEmail', () => {
  it('taglia gli spazi e abbassa le maiuscole', () => {
    expect(normalizzaEmail('  Mario@Example.COM ')).toBe('mario@example.com');
  });
});

describe('emailGiaInUso', () => {
  it('cerca su TUTTA la piattaforma: nessun filtro companyId, nessun filtro deletedAt', async () => {
    await emailGiaInUso('mario@example.com');

    const where = prismaMock.user.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ email: 'mario@example.com' });
    // Espliciti, perché sono le due esclusioni volute dalla spec:
    expect(where).not.toHaveProperty('companyId');
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('true quando esiste un utente con quella email', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u1' });
    expect(await emailGiaInUso('mario@example.com')).toBe(true);
  });

  it('false quando non esiste nessuno', async () => {
    expect(await emailGiaInUso('nuovo@example.com')).toBe(false);
  });

  it('escludiUserId esclude se stessi dal confronto', async () => {
    await emailGiaInUso('mario@example.com', { escludiUserId: 'u1' });

    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toEqual({
      email: 'mario@example.com',
      NOT: { id: 'u1' },
    });
  });
});

describe('isViolazioneEmailUnica', () => {
  it('riconosce il target come array di campi', () => {
    expect(isViolazioneEmailUnica(p2002(['email']))).toBe(true);
  });

  it('riconosce il target come nome dell indice', () => {
    expect(isViolazioneEmailUnica(p2002('users_email_key'))).toBe(true);
  });

  it('NON scatta sulla P.IVA', () => {
    expect(isViolazioneEmailUnica(p2002(['partitaIva']))).toBe(false);
  });

  it('NON scatta su crm_contacts_emailUnsubToken_key (il nome contiene "email")', () => {
    // Trappola reale: un match generico su /email/ classificherebbe male
    // questo indice, che esiste davvero sul DB.
    expect(isViolazioneEmailUnica(p2002('crm_contacts_emailUnsubToken_key'))).toBe(false);
    expect(isViolazioneEmailUnica(p2002(['emailUnsubToken']))).toBe(false);
  });

  it('false su altri codici Prisma e su errori qualunque', () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
    expect(isViolazioneEmailUnica(p2025)).toBe(false);
    expect(isViolazioneEmailUnica(new Error('boom'))).toBe(false);
    expect(isViolazioneEmailUnica(null)).toBe(false);
  });
});

describe('scriviUtente', () => {
  it('restituisce il valore quando la scrittura riesce', async () => {
    const res = await scriviUtente(async () => ({ id: 'u1' }));
    expect(res).toEqual({ ok: true, value: { id: 'u1' } });
  });

  it('traduce la violazione unique sull email in errore applicativo', async () => {
    const res = await scriviUtente(async () => {
      throw p2002(['email']);
    });
    expect(res).toEqual({
      ok: false,
      error: 'Questa email è già associata a un account Passaggio Veloce',
    });
  });

  it('rilancia qualunque altro errore: non maschera i bug', async () => {
    await expect(
      scriviUtente(async () => {
        throw new Error('connessione persa');
      }),
    ).rejects.toThrow('connessione persa');

    await expect(
      scriviUtente(async () => {
        throw p2002(['partitaIva']);
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm --filter piattaforma test src/lib/auth/email-univoca.test.ts
```

Atteso: FAIL — `Failed to resolve import "./email-univoca"`.

- [ ] **Step 3: Scrivi il modulo**

Crea `apps/piattaforma/src/lib/auth/email-univoca.ts`:

```ts
import { Prisma, prisma } from '@pv/db';

/**
 * Unicità dell'email su TUTTA la piattaforma (spec 2026-07-25).
 *
 * Fonte unica della regola: i call site devono CHIAMARE queste funzioni, non
 * ricopiarne la `where`. Una regola aggiunta qui e non letta dai consumer
 * sparisce in silenzio.
 */

/** trim + lowercase. Unico posto in cui la normalizzazione è scritta. */
export function normalizzaEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Messaggio per i path interni (chi legge è già autenticato). */
export const EMAIL_GIA_IN_USO =
  'Questa email è già associata a un account Passaggio Veloce';

/**
 * Messaggio per la registrazione pubblica: l'utente è anonimo e non ha modo
 * di sapere cosa fare, quindi il testo porta una via d'uscita.
 */
export const EMAIL_GIA_REGISTRATA =
  "Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.";

/**
 * True se l'email appartiene già a un account, ovunque sulla piattaforma.
 *
 * Nessun filtro su `companyId`: aziende e staff condividono lo spazio dei nomi.
 * Nessun filtro su `deletedAt`: un utente eliminato continua a occupare la sua
 * email (decisione della spec — l'eliminazione non la libera).
 *
 * È un check best-effort: fra questa query e la scrittura c'è una finestra
 * TOCTOU. La garanzia vera è il vincolo `users_email_key` sul DB, da
 * intercettare con `isViolazioneEmailUnica`.
 */
export async function emailGiaInUso(
  emailLower: string,
  opts?: { escludiUserId?: string },
): Promise<boolean> {
  const found = await prisma.user.findFirst({
    where: {
      email: emailLower,
      ...(opts?.escludiUserId ? { NOT: { id: opts.escludiUserId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * True se l'errore è la violazione del vincolo di unicità sull'email.
 *
 * Match esatto e non per sottostringa: `meta.target` può arrivare come array
 * di campi (`['email']`) o come nome dell'indice (`'users_email_key'`), e sul
 * DB esiste `crm_contacts_emailUnsubToken_key`, che un match generico su
 * "email" classificherebbe male.
 */
export function isViolazioneEmailUnica(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const parts = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return parts.some((p) => p === 'email' || p === 'users_email_key');
}

/**
 * Esegue una scrittura su User traducendo la violazione del vincolo unique
 * sull'email in un errore applicativo, invece di lasciarla propagare come 500.
 *
 * Serve a chiudere la finestra TOCTOU fra `emailGiaInUso` e la scrittura: in
 * quella finestra un'altra registrazione puo' prendersi l'email, e l'utente
 * non deve vedere una schermata di errore diversa dal caso normale.
 *
 * Qualunque altro errore viene rilanciato: questo helper non maschera bug.
 */
export async function scriviUtente<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isViolazioneEmailUnica(e)) return { ok: false, error: EMAIL_GIA_IN_USO };
    throw e;
  }
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma test src/lib/auth/email-univoca.test.ts
```

Atteso: PASS, 14 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/email-univoca.ts apps/piattaforma/src/lib/auth/email-univoca.test.ts
git commit -m "feat(auth): modulo condiviso per l'unicita' globale dell'email

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Vincolo sul database

**Files:**
- Modify: `packages/db/prisma/schema.prisma:518-625` (modello `User`)
- Create: `packages/db/prisma/migrations/20260725140000_user_email_unique/migration.sql`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces: indice `users_email_key` e constraint `users_email_lowercase` sul DB; il tipo Prisma `UserWhereUniqueInput` accetta `{ email }`.

- [ ] **Step 1: Verifica che il dato locale sia pulito**

Il vincolo non si può creare se esistono duplicati. Controlla prima:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;"
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "SELECT id, email FROM users WHERE email <> lower(email);"
```

Atteso: `(0 rows)` per entrambe. Se non lo è, **fermati e segnala**: la spec vuole che si decida caso per caso, non che si forzi.

- [ ] **Step 2: Modifica lo schema Prisma**

In `packages/db/prisma/schema.prisma`, nel modello `User`:

Sostituisci il blocco di commento + campo email (righe ~520-525):

```prisma
  // Multi-tenancy email scope-company (item 07 release 2026-05): la stessa
  // email puo' esistere in piu' aziende (es. consulente esterno). Unique
  // compound (companyId, email). Per gli admin platform (companyId=null)
  // un partial index garantisce comunque l'unicita' tra di loro: vedi
  // migration team_email_per_company.
  email           String
```

con:

```prisma
  // Email univoca su TUTTA la piattaforma (spec 2026-07-25): un'email = un
  // account, aziende e staff nello stesso spazio dei nomi. Revoca la
  // multi-tenancy introdotta da team_email_per_company (2026-05).
  // L'eliminazione (deletedAt) NON libera l'email.
  // Il DB impone anche `email = lower(email)`: vedi migration user_email_unique.
  email           String    @unique
```

Poi, in fondo al modello (righe ~620-624), rimuovi `@@unique([companyId, email])` e `@@index([email])` — l'indice unique copre già i lookup per email:

```prisma
  @@index([companyId])
  @@index([status])
  @@map("users")
}
```

- [ ] **Step 3: Scrivi la migration a mano**

Crea `packages/db/prisma/migrations/20260725140000_user_email_unique/migration.sql`:

```sql
-- Email univoca su tutta la piattaforma (spec 2026-07-25).
-- Revoca la multi-tenancy dell'email introdotta da team_email_per_company
-- (20260505224500), che permetteva a due aziende diverse di registrarsi con
-- la stessa email.

-- Il compound e il partial index diventano ridondanti: li sostituisce un
-- unique secco. `users_email_idx` cade perche' l'indice unique serve gia' i
-- lookup per email, e un secondo btree sulla stessa colonna costa scritture.
DROP INDEX IF EXISTS "users_companyId_email_key";
DROP INDEX IF EXISTS "users_email_admin_platform_key";
DROP INDEX IF EXISTS "users_email_idx";

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Un unique btree e' case-sensitive: senza questo, 'Mario@x.it' e 'mario@x.it'
-- resterebbero due account distinti, cioe' lo stesso bug per un'altra strada.
-- Tutti i write path normalizzano gia' in lowercase; il vincolo garantisce che
-- un path futuro non possa dimenticarsene.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK (email = lower(email));
```

- [ ] **Step 4: Applica la migration e rigenera il client**

```bash
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db db:generate
```

Atteso: `1 migration found` / `Applied`. **Non usare `pnpm db:migrate`** (vedi Global Constraints).

- [ ] **Step 5: Verifica il vincolo sul DB vero, non sui mock**

I test unitari mockano Prisma, quindi da soli non provano che il vincolo esista. Verifica gli indici e prova a violarlo davvero:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "SELECT indexname FROM pg_indexes WHERE tablename='users' ORDER BY 1;"
```

Atteso: c'è `users_email_key`; **non** ci sono più `users_companyId_email_key`, `users_email_admin_platform_key`, `users_email_idx`.

Ora i tre tentativi di violazione (ognuno deve dare errore, e il `ROLLBACK` non lascia sporcizia):

```bash
# 1. Duplicato cross-company: deve fallire con "users_email_key"
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "BEGIN; INSERT INTO users (id, email, \"passwordHash\", nome, cognome, role, status, \"companyId\", \"createdAt\", \"updatedAt\") SELECT gen_random_uuid(), email, 'x', 'A', 'B', 'UTENTE_AZIENDA', 'ACTIVE', NULL, now(), now() FROM users LIMIT 1; ROLLBACK;"

# 2. Stessa email con case diverso: deve fallire sul CHECK users_email_lowercase
docker exec pv-postgres psql -U pv -d passaggio_veloce -c "BEGIN; INSERT INTO users (id, email, \"passwordHash\", nome, cognome, role, status, \"companyId\", \"createdAt\", \"updatedAt\") SELECT gen_random_uuid(), upper(email), 'x', 'A', 'B', 'UTENTE_AZIENDA', 'ACTIVE', NULL, now(), now() FROM users LIMIT 1; ROLLBACK;"
```

Atteso 1: `ERROR: duplicate key value violates unique constraint "users_email_key"`.
Atteso 2: `ERROR: new row for relation "users" violates check constraint "users_email_lowercase"`.

Se uno dei due **riesce**, il vincolo non è attivo: fermati e indaga.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260725140000_user_email_unique
git commit -m "feat(db): unique globale su users.email + check lowercase

Revoca il compound (companyId, email) e il partial index sugli admin
platform introdotti da team_email_per_company.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Registrazione azienda

Il bug che l'utente ha segnalato. Oggi `registerAction` blocca l'email solo se collide con un admin di piattaforma, quindi due aziende si registrano con la stessa.

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts:443-455` (check) e `:762-767` (catch P2002)
- Test: `apps/piattaforma/src/app/(auth)/actions.test.ts` (blocco `describe('registerAction (early returns)')`, riga ~117)

**Interfaces:**
- Consumes: `normalizzaEmail`, `emailGiaInUso`, `EMAIL_GIA_REGISTRATA`, `isViolazioneEmailUnica` da `@/lib/auth/email-univoca` (Task 1).
- Produces: niente per i task successivi.

- [ ] **Step 1: Scrivi il test di regressione**

In `apps/piattaforma/src/app/(auth)/actions.test.ts`, aggiungi dentro `describe('registerAction (early returns)')` (dopo il test `fallisce se manca un documento`, riga ~131):

**Attenzione al mock.** Il mock di `prisma.user.findFirst` deve *discriminare sulla `where`*, altrimenti il test passa anche col codice vecchio (che chiama `findFirst` a sua volta) e non prova niente:

```ts
  it('rifiuta un email gia usata da un utente di un ALTRA azienda', async () => {
    // Il mock simula il DB: esiste un utente con questa email, in un'azienda
    // qualunque. Discrimina sulla `where` — il codice vecchio cerca solo fra
    // gli admin platform (companyId: null) e NON deve trovarlo, altrimenti il
    // test passerebbe anche senza il fix e non proverebbe nulla.
    vi.mocked(prisma.user.findFirst).mockImplementation((async (args: {
      where?: { email?: string; companyId?: string | null };
    }) => {
      const where = args?.where ?? {};
      if (where.email !== 'mario@example.com') return null;
      if (where.companyId === null) return null; // nessun admin platform con quell'email
      return { id: 'u-altra-azienda' };
    }) as never);

    const r = await registerAction(fdWith(validPayload));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.",
      );
      expect(r.field).toBe('account.email');
    }
    expect(txMock).not.toHaveBeenCalled();
  });
```

Aggiungi anche il reset del mock nel `beforeEach` del describe (riga ~118), che oggi resetta solo `txMock`:

```ts
  beforeEach(() => {
    txMock.mockReset();
    vi.mocked(prisma.user.findFirst).mockReset();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm --filter piattaforma test src/app/\(auth\)/actions.test.ts
```

Atteso: FAIL sul nuovo test. Il codice vecchio non trova l'admin platform, prosegue oltre il check e va a sbattere più avanti (`prisma.company` è `{}` nel mock) — l'errore concreto può variare, l'importante è che **questo test sia rosso**. Se è verde, il mock non sta discriminando: correggilo prima di andare avanti.

- [ ] **Step 3: Sostituisci il check in `registerAction`**

In `apps/piattaforma/src/app/(auth)/actions.ts`, sostituisci le righe 443-455:

```ts
  const emailLower = account.email.toLowerCase();

  // Multi-tenancy email scope-company (item 07 release 2026-05): la stessa
  // email puo' registrarsi in piu' aziende (stesso utente come dealer e come
  // agenzia, o consulente esterno con piu' clienti). Qui blocchiamo solo se
  // collide con un admin platform (companyId=null) per evitare ambiguita'
  // di login con account amministrativi.
  const existingAdmin = await prisma.user.findFirst({
    where: { email: emailLower, companyId: null },
  });
  if (existingAdmin) {
    return { ok: false, error: 'Email gia registrata', field: 'account.email' };
  }
```

con:

```ts
  const emailLower = normalizzaEmail(account.email);

  // Email univoca su tutta la piattaforma (spec 2026-07-25): nessuna eccezione
  // per azienda o ruolo. Check best-effort — la garanzia e' il vincolo unique
  // sul DB, intercettato come P2002 nel catch in fondo alla funzione.
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_REGISTRATA, field: 'account.email' };
  }
```

Aggiungi l'import in cima al file (dopo la riga 21, `activeUserCredentialsQuery`):

```ts
import {
  normalizzaEmail,
  emailGiaInUso,
  EMAIL_GIA_REGISTRATA,
  isViolazioneEmailUnica,
} from '@/lib/auth/email-univoca';
```

- [ ] **Step 4: Rendi utile il catch P2002**

Oggi (riga 762-767) risponde `'Dato gia esistente'` **senza `field`**, quindi il wizard non evidenzia nulla e l'utente non sa cosa correggere. Sostituisci:

```ts
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Dato gia esistente' };
    }
    throw error;
  }
```

con:

```ts
  } catch (error) {
    // Race: fra il check sopra e la create un'altra registrazione ha preso
    // l'email (o la P.IVA). L'utente non deve distinguere questo caso dal
    // normale, quindi stesso messaggio e stesso campo evidenziato.
    if (isViolazioneEmailUnica(error)) {
      return { ok: false, error: EMAIL_GIA_REGISTRATA, field: 'account.email' };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const parts = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
      if (parts.some((p) => p === 'partitaIva' || p === 'companies_partitaIva_key')) {
        return { ok: false, error: 'P.IVA gia registrata', field: 'company.partitaIva' };
      }
      return { ok: false, error: 'Dato gia esistente' };
    }
    throw error;
  }
```

- [ ] **Step 5: Esegui i test e verifica che passino**

```bash
pnpm --filter piattaforma test src/app/\(auth\)/actions.test.ts
```

Atteso: PASS, incluso il nuovo test. Se altri test dello stesso file falliscono, sono da adeguare qui.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/\(auth\)/actions.ts apps/piattaforma/src/app/\(auth\)/actions.test.ts
git commit -m "fix(registrazione): email univoca su tutta la piattaforma

Il check bloccava solo le collisioni con gli admin di piattaforma: due
aziende diverse potevano registrarsi con la stessa email. Il catch P2002
ora distingue email da P.IVA e valorizza il campo per il wizard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Utenze team azienda (4 call site)

**Files:**
- Modify: `apps/piattaforma/src/app/team/actions.ts` righe 210-220, 302-307, 385-393, 491-501
- Test: `apps/piattaforma/src/app/team/actions.authz.test.ts`, `apps/piattaforma/src/app/team/permessi.authz.test.ts`

**Interfaces:**
- Consumes: `normalizzaEmail`, `emailGiaInUso`, `EMAIL_GIA_IN_USO` da `@/lib/auth/email-univoca` (Task 1).
- Produces: niente per i task successivi.

- [ ] **Step 1: Scrivi il test di regressione**

In `apps/piattaforma/src/app/team/actions.authz.test.ts`, aggiungi in fondo al file:

```ts
describe('unicita email globale (spec 2026-07-25)', () => {
  it('createUserDirectAction rifiuta un email presa in un ALTRA azienda', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxSede({
        accessibleSedi: [sede('s1')],
        membershipRuoli: { s1: 'ADMIN_SEDE' },
        permessi: PERMESSI_TEAM_COMPLETI,
      }),
    );
    // Il mock discrimina sulla where: col codice vecchio la query porta
    // companyId: 'c1' e non deve trovare nulla, altrimenti il test sarebbe
    // verde anche senza il fix.
    prismaMock.user.findFirst.mockImplementation(async (args: {
      where?: { email?: string; companyId?: string };
    }) => {
      const where = args?.where ?? {};
      if (where.email !== 'x@y.it') return null;
      if (where.companyId !== undefined) return null;
      return { id: 'u-altrove' };
    });

    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');

    expect(res).toEqual({
      ok: false,
      error: 'Questa email è già associata a un account Passaggio Veloce',
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm --filter piattaforma test src/app/team/actions.authz.test.ts
```

Atteso: FAIL — `res` è `{ ok: true }`, perché il codice vecchio cerca solo dentro `companyId`.

- [ ] **Step 3: Sostituisci i quattro check**

In `apps/piattaforma/src/app/team/actions.ts`, aggiungi l'import in cima:

```ts
import { normalizzaEmail, emailGiaInUso, EMAIL_GIA_IN_USO } from '@/lib/auth/email-univoca';
```

**3a — `createInvitationAction` (righe 210-220).** Non invitare chi ha già un account altrove. Sostituisci:

```ts
  // Multi-tenancy: il blocco vale solo se l'email e' gia' usata IN QUESTA azienda
  // (item 07 release 2026-05). La stessa email puo' esistere in altre aziende.
  const existingUser = await prisma.user.findFirst({
    where: { email: emailLower, companyId },
  });
  if (existingUser) {
    return {
      ok: false,
      error: 'Esiste già un utente con questa email nella tua azienda',
    };
  }
```

con:

```ts
  // Email univoca su tutta la piattaforma (spec 2026-07-25): non si invita
  // qualcuno che ha gia' un account, nemmeno in un'altra azienda.
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }
```

Nella stessa funzione, riga 205, sostituisci `const emailLower = email.toLowerCase().trim();` con `const emailLower = normalizzaEmail(email);`.

Il check sugli inviti `PENDING` duplicati subito sotto (righe 222-227) è **già globale**: lascialo com'è.

**3b — `acceptInvitationAction` (righe 302-307).** Fra invio e accettazione l'email può essere stata presa. Sostituisci:

```ts
  // Scope-company: l'invito e' stato emesso per l'azienda invitation.companyId,
  // quindi l'email puo' duplicare altrove ma non in quella stessa azienda.
  const exists = await prisma.user.findFirst({
    where: { email: invitation.email, companyId: invitation.companyId },
  });
  if (exists) return { ok: false, error: 'Email già registrata in questa azienda' };
```

con:

```ts
  // Ri-verifica al momento dell'accettazione: fra l'invio dell'invito e ora
  // l'email puo' essere stata presa da un'altra registrazione.
  if (await emailGiaInUso(invitation.email)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }
```

**3c — `createUserDirectAction` (righe 385-393).** Sostituisci:

```ts
  const existing = await prisma.user.findFirst({
    where: { email: emailLower, companyId },
  });
  if (existing) {
    return {
      ok: false,
      error: 'Esiste già un utente con questa email nella tua azienda',
    };
  }
```

con:

```ts
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }
```

Riga 371: `const emailLower = normalizzaEmail(email);`.

Nota: `companyId` resta usato più avanti nella funzione (la `create`), quindi non va rimosso dalla destrutturazione.

**3d — `updateTeamUserAction` (righe 491-501).** Sostituisci:

```ts
  if (emailLower !== target.email) {
    const conflict = await prisma.user.findFirst({
      where: { email: emailLower, companyId, NOT: { id: userId } },
    });
    if (conflict) {
      return {
        ok: false,
        error: 'Esiste già un altro utente con questa email nella tua azienda',
      };
    }
  }
```

con:

```ts
  if (emailLower !== target.email) {
    if (await emailGiaInUso(emailLower, { escludiUserId: userId })) {
      return { ok: false, error: EMAIL_GIA_IN_USO };
    }
  }
```

Riga 469: `const emailLower = normalizzaEmail(email);`.

- [ ] **Step 4: Proteggi le tre scritture dalla race**

Fra il check e la scrittura un'altra registrazione può prendersi l'email: senza guardia diventa un 500. Aggiungi `scriviUtente` all'import del Task 4 e avvolgi le tre scritture che creano o rinominano un User.

**4a — `acceptInvitationAction` (righe ~318-341).** Sostituisci `await prisma.$transaction(async (tx) => { … });` con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          nome: nome.trim(),
          cognome: cognome.trim(),
          role: invitation.role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          companyId: invitation.companyId,
          permessi: invitation.permessi,
        },
      });
      if (sedeId) {
        await tx.userSede.create({
          data: { userId: user.id, sedeId, ruolo: invitation.ruoloSede },
        });
      }
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    }),
  );
  if (!scritto.ok) return scritto;
```

**4b — `createUserDirectAction` (righe ~396-413).** Sostituisci `await prisma.$transaction(async (tx) => { … });` con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: emailLower,
          passwordHash,
          nome: nome.trim(),
          cognome: cognome.trim(),
          role: 'UTENTE_AZIENDA',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          companyId,
          permessi: perm.permessi,
        },
      });
      await tx.userSede.create({
        data: { userId: user.id, sedeId: authz.sedeId, ruolo: authz.ruolo },
      });
    }),
  );
  if (!scritto.ok) return scritto;
```

**4c — `updateTeamUserAction` (righe ~528-545).** Sostituisci `await prisma.$transaction(async (tx) => { … });` con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { email: emailLower, nome: nome.trim(), cognome: cognome.trim(), ...permessiData },
      });
      if (aggiornaMembership) {
        // Modello "una sede per utente": l'utente appartiene a una sola sede. Per
        // evitare conflitti con @@unique([userId, sedeId]) quando si sposta sede,
        // collassiamo a un'unica membership con la sede/ruolo scelti.
        const existing = await tx.userSede.findFirst({ where: { userId } });
        if (existing && existing.sedeId === sedeId) {
          await tx.userSede.update({ where: { id: existing.id }, data: { ruolo } });
        } else {
          await tx.userSede.deleteMany({ where: { userId } });
          await tx.userSede.create({ data: { userId, sedeId: sedeId!, ruolo } });
        }
      }
    }),
  );
  if (!scritto.ok) return scritto;
```

- [ ] **Step 5: Esegui i test e verifica che passino**

```bash
pnpm --filter piattaforma test src/app/team/
```

Atteso: PASS. Se `permessi.authz.test.ts` fallisce perché asserisce sulla `where` di `user.findFirst`, adegua l'asserzione alla nuova forma (`{ email }`, senza `companyId`) — l'asserzione documenta la regola, e la regola è cambiata.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/team/
git commit -m "fix(team): email univoca globale su invito, accettazione, creazione e modifica

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Assistenti e utenti team di piattaforma (4 call site)

Oggi questi path bloccano solo le collisioni con altri account `companyId = null`: un assistente può prendere l'email di un utente azienda.

**Files:**
- Modify: `apps/piattaforma/src/app/admin/assistenti/actions.ts:47-58` e `:132-142`
- Modify: `apps/piattaforma/src/app/admin/crm/utenti/actions.ts:86-96` e `:161-174`

**Interfaces:**
- Consumes: `normalizzaEmail`, `emailGiaInUso`, `EMAIL_GIA_IN_USO` da `@/lib/auth/email-univoca` (Task 1).
- Produces: niente per i task successivi.

- [ ] **Step 1: `createAssistenteAction`**

In `apps/piattaforma/src/app/admin/assistenti/actions.ts`, aggiungi l'import:

```ts
import { normalizzaEmail, emailGiaInUso, EMAIL_GIA_IN_USO } from '@/lib/auth/email-univoca';
```

Sostituisci le righe 47-58:

```ts
  // Scope-platform: blocchiamo solo conflitti con altri admin platform o
  // assistenti (companyId=null). La stessa email puo' esistere come admin
  // di azienda dealer/agenzia senza conflitti (item 14 release 2026-05).
  const existing = await prisma.user.findFirst({
    where: { email: emailLower, companyId: null },
  });
  if (existing) {
    return {
      ok: false,
      error: 'Esiste già un assistente o admin con questa email',
    };
  }
```

con:

```ts
  // Email univoca su tutta la piattaforma (spec 2026-07-25): staff e aziende
  // condividono lo spazio dei nomi, niente eccezione per companyId=null.
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }
```

Riga 33: `const emailLower = normalizzaEmail(email);`.

- [ ] **Step 2: `updateAssistenteAction`**

Nello stesso file, sostituisci le righe 132-142:

```ts
  if (emailLower !== target.email) {
    const conflict = await prisma.user.findFirst({
      where: { email: emailLower, companyId: null, NOT: { id: userId } },
    });
    if (conflict) {
      return {
        ok: false,
        error: 'Esiste già un altro assistente o admin con questa email',
      };
    }
  }
```

con:

```ts
  if (emailLower !== target.email) {
    if (await emailGiaInUso(emailLower, { escludiUserId: userId })) {
      return { ok: false, error: EMAIL_GIA_IN_USO };
    }
  }
```

Riga 124: `const emailLower = normalizzaEmail(email);`.

- [ ] **Step 3: `createCrmTeamUserAction`**

In `apps/piattaforma/src/app/admin/crm/utenti/actions.ts`, aggiungi l'import:

```ts
import { normalizzaEmail, emailGiaInUso, EMAIL_GIA_IN_USO } from '@/lib/auth/email-univoca';
```

Sostituisci le righe 86-96:

```ts
  // Email univoca tra utenti team interno (companyId NULL)
  const emailLower = d.email.toLowerCase();
  const existing = await prisma.user.findFirst({
    where: { email: emailLower, companyId: null },
  });
  if (existing) {
    return {
      ok: false,
      error: 'Esiste già un utente team con questa email',
    };
  }
```

con:

```ts
  // Email univoca su tutta la piattaforma (spec 2026-07-25).
  const emailLower = normalizzaEmail(d.email);
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }
```

- [ ] **Step 4: `updateCrmTeamUserAction`**

Nello stesso file, sostituisci le righe 161-174:

```ts
  const emailLower = d.email.toLowerCase();
  const conflict = await prisma.user.findFirst({
    where: {
      email: emailLower,
      companyId: null,
      NOT: { id },
    },
  });
  if (conflict) {
    return {
      ok: false,
      error: 'Esiste già un altro utente team con questa email',
    };
  }
```

con:

```ts
  const emailLower = normalizzaEmail(d.email);
  if (await emailGiaInUso(emailLower, { escludiUserId: id })) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }
```

- [ ] **Step 5: Proteggi le quattro scritture dalla race**

Aggiungi `scriviUtente` agli import di entrambi i file e avvolgi ogni scrittura.

**5a — `createAssistenteAction` (righe ~61-72).** Sostituisci `await prisma.user.create({ … });` con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.user.create({
      data: {
        email: emailLower,
        passwordHash,
        nome: nome.trim(),
        cognome: cognome.trim(),
        role: 'ASSISTENTE',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        companyId: null,
      },
    }),
  );
  if (!scritto.ok) return scritto;
```

**5b — `updateAssistenteAction` (righe ~144-151).** Sostituisci `await prisma.user.update({ … });` con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.user.update({
      where: { id: userId },
      data: {
        email: emailLower,
        nome: nome.trim(),
        cognome: cognome.trim(),
      },
    }),
  );
  if (!scritto.ok) return scritto;
```

**5c — `createCrmTeamUserAction` (righe ~99-111).** Qui serve l'id creato, quindi si usa `scritto.value`:

```ts
  const scritto = await scriviUtente(() =>
    prisma.user.create({
      data: {
        email: emailLower,
        passwordHash,
        nome: d.nome,
        cognome: d.cognome,
        role: d.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        companyId: null,
      },
      select: { id: true },
    }),
  );
  if (!scritto.ok) return scritto;
  const created = scritto.value;
```

Il `return { ok: true, id: created.id }` in fondo alla funzione resta invariato.

**5d — `updateCrmTeamUserAction` (righe ~176-184).** Sostituisci `await prisma.user.update({ … });` con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.user.update({
      where: { id },
      data: {
        nome: d.nome,
        cognome: d.cognome,
        email: emailLower,
        role: d.role,
      },
    }),
  );
  if (!scritto.ok) return scritto;
```

- [ ] **Step 6: Verifica che non sia rimasto nessun check scope-company**

```bash
grep -rn "companyId: null" apps/piattaforma/src/app/admin/assistenti/actions.ts apps/piattaforma/src/app/admin/crm/utenti/actions.ts
```

Atteso: restano solo le occorrenze nei `data:` delle `create` (l'assistente/utente team **è** un account senza azienda) e nel controllo `target.companyId !== null` di `updateCrmTeamUserAction` (verifica che il target sia effettivamente uno staff). **Nessuna** occorrenza dentro una `where` di ricerca per email.

- [ ] **Step 7: Esegui la suite e committa**

```bash
pnpm --filter piattaforma test
```

Atteso: PASS.

```bash
git add apps/piattaforma/src/app/admin/assistenti/actions.ts apps/piattaforma/src/app/admin/crm/utenti/actions.ts
git commit -m "fix(admin): email univoca globale per assistenti e utenti team

Un account di piattaforma non puo' piu' prendere l'email di un utente
azienda: lo spazio dei nomi e' unico.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Cambio email dal profilo

**Files:**
- Modify: `apps/piattaforma/src/app/profilo/personale/actions.ts:13-55`

**Interfaces:**
- Consumes: `normalizzaEmail`, `emailGiaInUso`, `EMAIL_GIA_IN_USO` da `@/lib/auth/email-univoca` (Task 1).
- Produces: niente per i task successivi.

- [ ] **Step 1: Sostituisci il check**

Aggiungi l'import:

```ts
import { normalizzaEmail, emailGiaInUso, EMAIL_GIA_IN_USO } from '@/lib/auth/email-univoca';
```

Sostituisci il commento della funzione (righe 13-17) — «Email scope-company» ora è falso:

```ts
/**
 * Modifica i dati personali del proprio User account (item 04 release
 * 2026-05). Funziona per qualsiasi ruolo. Email univoca su tutta la
 * piattaforma (spec 2026-07-25): la nuova email non deve appartenere a
 * nessun altro account, in nessuna azienda.
 */
```

Sostituisci le righe 39-55:

```ts
  if (emailLower !== me.email) {
    const conflict = await prisma.user.findFirst({
      where: {
        email: emailLower,
        companyId: me.companyId,
        NOT: { id: userId },
      },
    });
    if (conflict) {
      return {
        ok: false,
        error: me.companyId
          ? 'Esiste già un altro utente con questa email nella tua azienda'
          : 'Esiste già un altro account amministrativo con questa email',
      };
    }
  }
```

con:

```ts
  if (emailLower !== me.email) {
    if (await emailGiaInUso(emailLower, { escludiUserId: userId })) {
      return { ok: false, error: EMAIL_GIA_IN_USO };
    }
  }
```

Riga 31: `const emailLower = normalizzaEmail(email);`.

- [ ] **Step 2: Proteggi la scrittura dalla race**

Aggiungi `scriviUtente` all'import e sostituisci `await prisma.user.update({ … });` (righe ~57-65) con:

```ts
  const scritto = await scriviUtente(() =>
    prisma.user.update({
      where: { id: userId },
      data: {
        email: emailLower,
        nome: nome.trim(),
        cognome: cognome.trim(),
        codiceFiscale: codiceFiscale.trim() || null,
      },
    }),
  );
  if (!scritto.ok) return scritto;
```

L'`unstable_update` della sessione subito sotto resta invariato: si esegue solo se la scrittura è andata a buon fine.

- [ ] **Step 3: Esegui la suite**

```bash
pnpm --filter piattaforma test
```

Atteso: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/profilo/personale/actions.ts
git commit -m "fix(profilo): il cambio email verifica l'unicita' globale

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Semplificazione dei read path

Con l'unicità globale, la gestione multi-candidato descrive uno stato che il write path non può più produrre. Va rimossa, non lasciata a documentare un mondo che non esiste. Effetto collaterale: il login fa **un** `bcrypt.compare` invece di N.

**Files:**
- Modify: `apps/piattaforma/src/auth.ts:26-52`
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts:89-124`, `:718-728`, `:900-913`, `:1104-1117`
- Modify: `apps/piattaforma/src/app/profilo/personale/actions.ts:106-115`
- Test: `apps/piattaforma/src/app/(auth)/actions.test.ts` (blocco `describe('loginAction')`, riga ~134, e `describe('rate limit …')`, riga ~265)

**Interfaces:**
- Consumes: `activeUserCredentialsQuery` da `@/lib/auth/credentials-query` — **resta la fonte unica** del filtro `email + deletedAt + status`, condivisa fra `auth.ts` e `loginAction`. Cambia solo il metodo di chiamata (`findMany` → `findFirst`), **non** la `where`: le due query non devono divergere.
- Produces: niente per i task successivi.

- [ ] **Step 1: Semplifica `authorize` in `auth.ts`**

Sostituisci le righe 32-52:

```ts
        // Multi-tenancy email scope-company (item 07 release 2026-05): la
        // stessa email puo' esistere su piu' User (uno per company). Cerchiamo
        // tutti i match attivi e verifichiamo la password contro ognuno.
        // L'admin platform (companyId=null) prevale per disambiguare in caso
        // di hash uguali, poi viene il primo per createdAt.
        const candidates = await prisma.user.findMany({
          ...activeUserCredentialsQuery(email.toLowerCase()),
          include: { company: true },
        });

        if (candidates.length === 0) return null;

        let matched: (typeof candidates)[number] | null = null;
        for (const c of candidates) {
          const ok = await bcrypt.compare(password, c.passwordHash);
          if (ok) {
            matched = c;
            break;
          }
        }
        if (!matched) return null;
```

con:

```ts
        // Email univoca su tutta la piattaforma (spec 2026-07-25): al piu' un
        // account per email, quindi un solo lookup e un solo bcrypt.compare.
        const matched = await prisma.user.findFirst({
          ...activeUserCredentialsQuery(email.toLowerCase()),
          include: { company: true },
        });

        if (!matched) return null;
        if (!(await bcrypt.compare(password, matched.passwordHash))) return null;
```

Il resto della funzione (2FA, `lastLoginAt`, return) usa `matched` e non cambia.

- [ ] **Step 2: Semplifica il pre-check in `loginAction`**

In `apps/piattaforma/src/app/(auth)/actions.ts`, sostituisci le righe 89-124:

```ts
  // Pre-check: individua l'utente la cui password combacia (mirror di authorize)
  // per capire se il 2FA è richiesto. Non logga: serve solo a decidere se
  // mostrare il campo codice. La password NON viene mai ritornata al client.
  const candidates = await prisma.user.findMany({
    ...activeUserCredentialsQuery(emailLower),
    select: { passwordHash: true, twoFactorEnabled: true },
  });
  let matched: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await bcrypt.compare(parsed.data.password, c.passwordHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
```

con:

```ts
  // Pre-check: individua l'utente la cui password combacia (mirror di authorize)
  // per capire se il 2FA è richiesto. Non logga: serve solo a decidere se
  // mostrare il campo codice. La password NON viene mai ritornata al client.
  const found = await prisma.user.findFirst({
    ...activeUserCredentialsQuery(emailLower),
    select: { passwordHash: true, twoFactorEnabled: true },
  });
  const matched =
    found && (await bcrypt.compare(parsed.data.password, found.passwordHash)) ? found : null;
  if (!matched) {
```

Più sotto, nello stesso blocco `if (!matched)`, sostituisci le righe 110-122:

```ts
    const pendingCandidates = await prisma.user.findMany({
      where: {
        email: emailLower,
        deletedAt: null,
        status: 'PENDING_EMAIL_VERIFICATION',
      },
      select: { passwordHash: true },
    });
    for (const c of pendingCandidates) {
      if (await bcrypt.compare(parsed.data.password, c.passwordHash)) {
        return { needsEmailVerification: true, email: emailLower };
      }
    }
```

con:

```ts
    const pending = await prisma.user.findFirst({
      where: {
        email: emailLower,
        deletedAt: null,
        status: 'PENDING_EMAIL_VERIFICATION',
      },
      select: { passwordHash: true },
    });
    if (pending && (await bcrypt.compare(parsed.data.password, pending.passwordHash))) {
      return { needsEmailVerification: true, email: emailLower };
    }
```

- [ ] **Step 3: Riga singola per verifica email e reset password**

Tre `updateMany` diventano `updateMany` su una riga sola — si tengono `updateMany` perché la `where` non è sulla chiave primaria, ma sparisce il commento che promette il fan-out multi-account.

**3a — DEMO_MODE in `registerAction` (righe 718-727).** Sostituisci il commento:

```ts
        // Multi-tenancy: colpisce solo il record con stato PENDING (quello
        // appena creato in questo flusso). Gli altri eventuali account con la
        // stessa email sono gia' ACTIVE.
```

con:

```ts
        // Email univoca: c'e' un solo account con questa email, ed e' quello
        // appena creato in questo flusso.
```

**3b — `verifyEmailAction` (righe 906-912).** Nessun cambio di codice necessario: la `where` è già corretta e con l'unicità colpisce una riga sola. Lasciala com'è.

**3c — `confirmPasswordResetAction` (righe 1109-1116).** Sostituisci il commento:

```ts
    // Multi-tenancy: la stessa email puo' avere piu' User record. Quando
    // l'utente reimposta la password, la propaghiamo a tutti i suoi account
    // (l'identita' fisica e' la stessa, e' come un "single sign-on" dal punto
    // di vista del recupero credenziali).
```

con:

```ts
    // Email univoca: un solo account per email, quindi una sola riga colpita.
    // Resta updateMany perche' la where non e' sulla chiave primaria.
```

**3d — `changeOwnPasswordAction` in `profilo/personale/actions.ts` (righe 108-111).** Sostituisci il commento:

```ts
  // Stessa semantica del reset via email (confirmPasswordResetAction): la
  // stessa persona può avere più User con la stessa email (uno per azienda).
  // La password li segue tutti, altrimenti la vecchia resterebbe valida per
  // entrare — cambiarla su un solo record darebbe una falsa sicurezza.
```

con:

```ts
  // Email univoca: un solo account per email, quindi una sola riga colpita.
  // Resta updateMany perche' la where non e' sulla chiave primaria.
```

- [ ] **Step 4: Adegua i test di `loginAction`**

In `apps/piattaforma/src/app/(auth)/actions.test.ts`, `loginAction` ora chiama `findFirst`, non più `findMany`. Sostituisci la riga 56:

```ts
const findManyMock = vi.mocked(prisma.user.findMany);
```

con:

```ts
const findFirstMock = vi.mocked(prisma.user.findFirst);
```

Poi, nei blocchi `describe('loginAction')` (righe ~134-237) e `describe('rate limit …')` (righe ~265-300), sostituisci ogni occorrenza:

| Prima | Dopo |
|---|---|
| `findManyMock.mockReset()` | `findFirstMock.mockReset()` |
| `findManyMock.mockResolvedValue([candidate(true)] as never)` | `findFirstMock.mockResolvedValue(candidate(true) as never)` |
| `findManyMock.mockResolvedValue([candidate(false)] as never)` | `findFirstMock.mockResolvedValue(candidate(false) as never)` |
| `findManyMock.mockResolvedValue([] as never)` | `findFirstMock.mockResolvedValue(null as never)` |
| `findManyMock.mockResolvedValue([{ passwordHash: 'hash', twoFactorEnabled: false }] as never)` | `findFirstMock.mockResolvedValue({ passwordHash: 'hash', twoFactorEnabled: false } as never)` |
| `expect(findManyMock).not.toHaveBeenCalled()` | `expect(findFirstMock).not.toHaveBeenCalled()` |

Il test «account PENDING» (righe 193-205) usa due chiamate in sequenza: diventa

```ts
    findFirstMock
      .mockResolvedValueOnce(null as never)                      // nessun ATTIVO
      .mockResolvedValueOnce({ passwordHash: 'hash' } as never); // uno PENDING
```

Rimuovi anche `vi.mocked(prisma.user.findFirst).mockReset();` dalla riga 271, ora ridondante con `findFirstMock.mockReset()`.

**Attenzione:** il `describe('registerAction (early returns)')` del Task 3 usa lo stesso `prisma.user.findFirst`. Verifica che i suoi `beforeEach` continuino a resettarlo — sono describe separati, quindi non c'è conflitto, ma l'ordine dei `mockResolvedValueOnce` sì.

- [ ] **Step 5: Esegui tutta la suite**

```bash
pnpm --filter piattaforma test
```

Atteso: PASS su tutti i file. `credentials-query.test.ts` deve passare **senza modifiche**: la `where` non è cambiata, solo il metodo che la consuma.

- [ ] **Step 6: Verifica che non sia rimasta logica multi-candidato**

```bash
grep -rni "candidates\|multi-tenancy\|scope-company\|scope-platform\|piu' aziende\|nella tua azienda" --include=*.ts \
  apps/piattaforma/src/auth.ts \
  "apps/piattaforma/src/app/(auth)/actions.ts" \
  apps/piattaforma/src/app/team/actions.ts \
  apps/piattaforma/src/app/admin/assistenti/actions.ts \
  apps/piattaforma/src/app/admin/crm/utenti/actions.ts \
  apps/piattaforma/src/app/profilo/personale/actions.ts
```

Atteso: nessuna occorrenza legata all'email. Restano legittime le frasi «nella tua azienda» che parlano di *appartenenza* e non di unicità dell'email — per esempio `'Utente non trovato nella tua azienda'` in `updateTeamUserAction` e `disableTeamUserAction`, che è un controllo di scoping corretto e non c'entra con questa modifica. Tutto il resto o è codice morto o è un commento che descrive il vecchio modello: rimuovilo.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/auth.ts apps/piattaforma/src/app/\(auth\)/actions.ts apps/piattaforma/src/app/\(auth\)/actions.test.ts apps/piattaforma/src/app/profilo/personale/actions.ts
git commit -m "refactor(auth): un solo account per email nei read path

Login, reset password e verifica email non gestiscono piu' N candidati
per email: lo stato non e' piu' rappresentabile. Il login fa un solo
bcrypt.compare invece di uno per candidato.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verifica end-to-end e preparazione del rilascio

I test mockano Prisma e non vedono il browser: questa task è dove si guarda il sistema vero.

**Files:** nessuna modifica prevista (solo fix se emergono difetti).

- [ ] **Step 1: Suite completa e typecheck**

```bash
pnpm --filter piattaforma test
pnpm typecheck
```

Atteso: entrambi verdi. Se `typecheck` fallisce con errori Prisma strani o stack overflow, è la cache fredda: rilancialo dopo un `pnpm --filter piattaforma build` o valuta l'output con sospetto — non è necessariamente un errore reale del codice.

- [ ] **Step 2: Prova la registrazione duplicata nel browser, col gesto reale**

Avvia l'app (`nvm use 22.15.0` poi `pnpm dev`) e apri `http://localhost:3000/register`.

1. Prendi un'email che esiste già sul DB locale:
   ```bash
   docker exec pv-postgres psql -U pv -d passaggio_veloce -t -c "SELECT email FROM users LIMIT 1;"
   ```
2. Completa il wizard di registrazione con quell'email (P.IVA nuova, non riusata).
3. **Clicca** il submit finale — non navigare per URL.

Atteso: il messaggio *«Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.»* compare **sul campo email dello step account**, non come errore generico in fondo alla pagina. Verifica il testo leggendo il DOM renderizzato, non il sorgente JSX (il JSX mangia gli spazi fra elementi adiacenti).

- [ ] **Step 3: Prova il login e il cambio email**

1. Login con un utente esistente → deve funzionare come prima.
2. Login con password sbagliata → «Credenziali non valide».
3. Da `/profilo/personale`, prova a cambiare la propria email in una già presa da un altro account → atteso *«Questa email è già associata a un account Passaggio Veloce»*.
4. Cambia la propria email in una libera → deve salvare, e l'header deve aggiornarsi senza ri-login.

- [ ] **Step 4: Verifica il pre-flight di produzione**

**Non applicare niente in prod in questa task** — solo verificare che il dato regga, perché la migration fallisce a metà se non è pulito. Contro il DB Neon di produzione (`ep-solitary-night`, fonte: `DATABASE_URL` su Vercel):

```sql
SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
SELECT id, email FROM users WHERE email <> lower(email);
```

Entrambe devono dare zero righe. Riporta l'esito. Se ci sono duplicati, **fermati e segnala**: la spec vuole che si decida caso per caso.

- [ ] **Step 5: Commit di eventuali fix e riepilogo**

Se gli step 2-3 hanno fatto emergere difetti, correggili e committa. Poi riporta:

- esito della suite e del typecheck;
- cosa hai visto nel browser (testo e posizione del messaggio);
- esito del pre-flight su prod;
- il promemoria dell'ordine di rilascio: **prima** `pnpm --filter @pv/db db:deploy` sul DB Neon di produzione, **poi** il push su `main`. Invertirli lascerebbe in prod codice che promette unicità mentre il DB non la garantisce ancora, proprio durante la finestra in cui due registrazioni concorrenti possono passare.

---

## Note per chi esegue

- **Perché i mock discriminano sulla `where`.** Nei task 3 e 4 i test di regressione usano `mockImplementation` che ispeziona `args.where` invece di un `mockResolvedValue` fisso. Con un mock fisso il test passerebbe anche col codice vecchio — che chiama `findFirst` a sua volta — e non proverebbe nulla. Se un test di regressione è verde al primo colpo, è rotto: indaga prima di proseguire.
- **`emailGiaInUso` non filtra `deletedAt`.** Non è una dimenticanza: un utente eliminato continua a occupare la sua email. Se qualcuno "sistema" questo aggiungendo `deletedAt: null`, cambia la semantica decisa nella spec.
- **Il check applicativo da solo non basta.** `emailGiaInUso` è TOCTOU: chiude il caso normale, non la race. È `scriviUtente` (più il vincolo DB del Task 2) a garantire l'unicità. Le due cose vanno insieme: un call site che chiama solo la prima resta scoperto, e il sintomo sarebbe un 500 in faccia all'utente invece di un messaggio.
- **La KB del chatbot non è coinvolta.** `scripts/build-chatbot-kb.ts:12` legge solo `docs/*.md` alla radice, non ricorsivamente: spec e piano non finiscono nella knowledge base.
