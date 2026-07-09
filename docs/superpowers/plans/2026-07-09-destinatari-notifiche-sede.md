# Destinatari notifiche pratica per sede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recapitare le email del ciclo di vita di una pratica a chi la lavora davvero — il creatore lato broker, la sede assegnataria e chi accetta lato agenzia — invece che sempre all'admin dell'azienda madre.

**Architecture:** Due colonne nullable su `Pratica` (`creatoDaUserId`, `accettataDaUserId`) registrano chi ha creato e chi ha accettato. Un risolutore **puro** applica una catena di fallback (preferito → membri della sede → admin azienda → email azienda) e ritorna una lista deduplicata; il primo livello si allarga ai membri della sede quando a operare è il **super admin**, così la filiale da cui ha lavorato non resta all'oscuro. Un orchestratore **server-only** carica i candidati dal DB e delega al risolutore. Le email amministrative (addebito, fattura, credito wallet, penale) restano all'azienda madre e non passano dal risolutore.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma + Postgres, vitest.

**Spec di riferimento:** `docs/superpowers/specs/2026-07-09-destinatari-notifiche-sede-design.md`

## Global Constraints

- **Node**: `nvm use 22.15.0` prima di qualunque comando `pnpm` — dopo un riavvio la shell non ha `node` sul PATH.
- **Nessuna notifica può sparire in silenzio.** Se un livello della catena è vuoto si scende al successivo; l'ultimo livello è `Company.email`. Mai `return` senza inviare perché "il destinatario preferito non c'è".
- **Chi opera decide l'ampiezza.** Un membro del team di sede (admin di sede o operatore) che crea o accetta una pratica la riceve **da solo**. Il **super admin** (`role: ADMIN_AZIENDA`) la fa ricevere **a sé e a tutti i membri della sede da cui ha operato**, così la filiale non resta all'oscuro. `isOwner` guarda il ruolo di piattaforma, **non** `UserSede.ruolo`.
- **Le email amministrative restano all'azienda madre e NON vanno toccate**: `N4_BROKER_FIRMA_E_CREDITO` (espone `creditoCent`/`saldoCent` del wallet), `N17_BROKER_PENALE_ADDEBITATA`, `N8_AGENZIA_ADDEBITO` (allega la fattura PDF), `N9_AGENZIA_ADDEBITO_FALLITO` (blocca i pagamenti).
- **`N1_BROKER_INVIO_PRATICA` passa dal risolutore** come le altre, così la regola del super admin vale anche per la conferma di invio. La ragione per cui l'email va letta dal DB e non dalla sessione (commit `b99d847`) resta valida: il risolutore legge `User.email` dal database.
- **Migration additiva**: solo colonne nullable + FK. Nessun campo esistente rimosso o modificato.
- **Le pratiche storiche NON restano identiche.** Hanno entrambe le colonne `null`, ma tutte e 16 hanno già `brokerSedeId`: la catena si ferma ai **membri della sede**, non all'admin azienda. Verificato sul DB che nessuno perde email — i 4 `ADMIN_AZIENDA` dealer hanno una membership `ADMIN_SEDE` — e che gli operatori si aggiungono. È il comportamento voluto: non "aggiustarlo" facendo scendere la catena all'admin.
- **Logica pura separata dall'IO**: `pratica-recipients.ts` non importa Prisma né `server-only`; `pratica.ts` sì. È il pattern già presente (`cliente-recipients.ts` / `cliente.ts`).
- **I test mockano Prisma**: una query valida per TypeScript può essere sbagliata per il DB. La Task 6 le esegue in sola lettura contro il Postgres locale.
- **`pnpm typecheck` a cache fredda è inaffidabile** (stack overflow / falsi errori Prisma). Se esplode con errori assurdi sui tipi Prisma è la cache, non la modifica.
- **Commit** in italiano, conventional commits, con trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **NON fare push.** Push su `main` = deploy in produzione.
- **Non applicare migration a Neon (prod).** Solo al Postgres locale in Docker (`pv-postgres`).

## File Structure

Nuovi:

| File | Responsabilità |
|---|---|
| `apps/piattaforma/src/lib/notifiche/pratica-recipients.ts` | Catena di fallback e dedup. Logica pura, niente IO. |
| `apps/piattaforma/src/lib/notifiche/pratica-recipients.test.ts` | Test del risolutore, incluso il caso "pratica storica". |
| `apps/piattaforma/src/lib/notifiche/pratica.ts` | Orchestratore server-only: carica i candidati dal DB, delega al risolutore. |
| `apps/piattaforma/src/lib/notifiche/pratica.test.ts` | Test dell'orchestratore con Prisma mockato. |
| `apps/piattaforma/src/lib/notifiche/pratica-schema.test.ts` | Contratto di schema: le due colonne esistono con la FK giusta. |
| `packages/db/prisma/migrations/20260709120000_pratica_creato_accettata_da/migration.sql` | Migration additiva. |

Modificati:

| File | Modifica |
|---|---|
| `packages/db/prisma/schema.prisma` | 2 colonne + 2 relazioni su `Pratica`, 2 relazioni inverse su `User` |
| `apps/piattaforma/src/app/pratiche/nuova/actions.ts` | scrive `creatoDaUserId`; N1 → risolutore |
| `apps/piattaforma/src/app/inbox/actions.ts` | scrive `accettataDaUserId`; N2 → creatore |
| `apps/piattaforma/src/app/pratiche/actions.ts` | N13 e N31 → creatore (N4 e N8 invariati) |
| `apps/piattaforma/src/lib/jobs/send-solleciti.ts` | N3 → creatore; N7 → accettante |
| `apps/piattaforma/src/lib/distribuzione/tick.ts` | N6 → membri sede; N11 → creatore |
| `apps/piattaforma/src/app/admin/escalation/actions.ts` | N6 → membri sede |
| `apps/piattaforma/src/lib/penali/segnalazione.ts` | N18 → accettante |

---

### Task 1: Risolutore puro della catena di destinatari

**Files:**
- Create: `apps/piattaforma/src/lib/notifiche/pratica-recipients.ts`
- Test: `apps/piattaforma/src/lib/notifiche/pratica-recipients.test.ts`

**Interfaces:**
- Produces:
  - `type Destinatario = { email: string; userId: string | null; nome: string }`
  - `type Preferito = Destinatario & { isOwner: boolean }`
  - `destinatariPratica(args: { preferito: Preferito | null; membriSede: Destinatario[]; adminAzienda: Destinatario | null; emailAzienda: string | null; ragioneSociale: string }): Destinatario[]`

#### La regola che governa il primo livello

Chi ha operato decide **quanto si allarga** il recapito:

- un **membro del team di sede** (admin di sede oppure operatore) che crea o accetta una pratica la
  riceve **da solo**: sta seguendo lui quella pratica;
- il **super admin** (`role: ADMIN_AZIENDA`, il proprietario) che opera da una filiale la fa ricevere
  **a sé e a tutti i membri di quella sede**, così la filiale non resta all'oscuro e può proseguire.

`isOwner` guarda il **ruolo di piattaforma** (`ADMIN_AZIENDA`), non `UserSede.ruolo`: un `ADMIN_SEDE`
è admin della filiale, non dell'azienda, quindi riceve solo lui.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/notifiche/pratica-recipients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { destinatariPratica, type Destinatario, type Preferito } from './pratica-recipients';

const creatore: Preferito = { email: 'operatore@dealer.it', userId: 'u1', nome: 'Luca', isOwner: false };
const membro1: Destinatario = { email: 'sede1@dealer.it', userId: 'u2', nome: 'Anna' };
const membro2: Destinatario = { email: 'sede2@dealer.it', userId: 'u3', nome: 'Marco' };
const admin: Destinatario = { email: 'admin@dealer.it', userId: 'u4', nome: 'Titolare' };

/** Il preferito restituito è un Destinatario puro: `isOwner` non esce dal risolutore. */
const soloDestinatario = ({ email, userId, nome }: Preferito): Destinatario => ({ email, userId, nome });

const vuoto = {
  preferito: null,
  membriSede: [],
  adminAzienda: null,
  emailAzienda: null,
  ragioneSociale: 'ROSSI SRL',
};

describe('destinatariPratica — chi opera decide l\'ampiezza', () => {
  it('operatore di sede: riceve solo lui, non i colleghi', () => {
    expect(
      destinatariPratica({ ...vuoto, preferito: creatore, membriSede: [membro1, membro2] }),
    ).toEqual([soloDestinatario(creatore)]);
  });

  it('admin di sede: è admin della filiale, non dell\'azienda → riceve solo lui', () => {
    const adminSede: Preferito = { email: 'as@dealer.it', userId: 'u7', nome: 'Elena', isOwner: false };
    expect(
      destinatariPratica({ ...vuoto, preferito: adminSede, membriSede: [membro1] }),
    ).toEqual([soloDestinatario(adminSede)]);
  });

  it('super admin: ricevono lui e tutti i membri della sede da cui ha operato', () => {
    const owner: Preferito = { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare', isOwner: true };
    expect(
      destinatariPratica({ ...vuoto, preferito: owner, membriSede: [membro1, membro2] }),
    ).toEqual([soloDestinatario(owner), membro1, membro2]);
  });

  it('super admin già membro della sede: compare una volta sola', () => {
    const owner: Preferito = { email: 'Titolare@Dealer.it ', userId: 'u4', nome: 'Titolare', isOwner: true };
    const stessoOwner: Destinatario = { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare' };
    expect(
      destinatariPratica({ ...vuoto, preferito: owner, membriSede: [stessoOwner, membro1] }),
    ).toEqual([{ email: 'Titolare@Dealer.it ', userId: 'u4', nome: 'Titolare' }, membro1]);
  });

  it('super admin senza sede (pratica legacy): riceve solo lui', () => {
    const owner: Preferito = { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare', isOwner: true };
    expect(destinatariPratica({ ...vuoto, preferito: owner })).toEqual([soloDestinatario(owner)]);
  });
});

describe('destinatariPratica — la catena si ferma al primo livello non vuoto', () => {
  it('il preferito vince su membri e admin', () => {
    expect(
      destinatariPratica({ ...vuoto, preferito: creatore, membriSede: [membro1], adminAzienda: admin }),
    ).toEqual([soloDestinatario(creatore)]);
  });

  it('senza preferito: tutti i membri della sede', () => {
    expect(
      destinatariPratica({ ...vuoto, membriSede: [membro1, membro2], adminAzienda: admin }),
    ).toEqual([membro1, membro2]);
  });

  it('sede senza membri: l\'admin azienda', () => {
    expect(destinatariPratica({ ...vuoto, adminAzienda: admin })).toEqual([admin]);
  });

  it('nessun utente: l\'email azienda, con la ragione sociale come nome', () => {
    expect(destinatariPratica({ ...vuoto, emailAzienda: 'info@rossi.it' })).toEqual([
      { email: 'info@rossi.it', userId: null, nome: 'ROSSI SRL' },
    ]);
  });

  it('nulla di nulla: lista vuota, il chiamante non invia', () => {
    expect(destinatariPratica(vuoto)).toEqual([]);
  });
});

describe('destinatariPratica — pratica storica (colonne null)', () => {
  // Le pratiche create prima di questa feature non hanno creatoDaUserId né sede:
  // devono continuare a notificare l'admin azienda, esattamente come oggi.
  it('senza preferito e senza sede ricade sull\'admin azienda', () => {
    expect(destinatariPratica({ ...vuoto, adminAzienda: admin })).toEqual([admin]);
  });
});

describe('destinatariPratica — igiene degli indirizzi', () => {
  it('deduplica i membri per email, ignorando maiuscole e spazi', () => {
    const dup: Destinatario = { email: '  SEDE1@Dealer.it ', userId: 'u9', nome: 'Doppione' };
    expect(destinatariPratica({ ...vuoto, membriSede: [membro1, dup, membro2] })).toEqual([
      membro1,
      membro2,
    ]);
  });

  it('scarta i candidati con email vuota invece di inviare al nulla', () => {
    const rotto: Preferito = { email: '   ', userId: 'u8', nome: 'Rotto', isOwner: false };
    expect(destinatariPratica({ ...vuoto, preferito: rotto, adminAzienda: admin })).toEqual([admin]);
  });

  it('l\'email azienda viene ripulita dagli spazi', () => {
    expect(destinatariPratica({ ...vuoto, emailAzienda: '  info@rossi.it  ' })).toEqual([
      { email: 'info@rossi.it', userId: null, nome: 'ROSSI SRL' },
    ]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
nvm use 22.15.0
pnpm --filter piattaforma exec vitest run src/lib/notifiche/pratica-recipients.test.ts
```

Atteso: FAIL — `Failed to resolve import "./pratica-recipients"`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `apps/piattaforma/src/lib/notifiche/pratica-recipients.ts`:

```ts
/**
 * Chi riceve le email del ciclo di vita di una pratica — logica pura, niente IO.
 * L'orchestratore che carica i candidati dal DB è `pratica.ts` (stesso rapporto
 * fra `cliente-recipients.ts` e `cliente.ts`).
 *
 * Le email del ciclo di vita nascono per azienda ma vengono lavorate da una
 * SEDE: il destinatario giusto è chi ha in mano la pratica. Quando quella
 * persona non è raggiungibile si scende di livello — mai si annulla l'invio.
 */

export type Destinatario = { email: string; userId: string | null; nome: string };

/** Il preferito porta con sé il ruolo: decide quanto si allarga il primo livello. */
export type Preferito = Destinatario & { isOwner: boolean };

/** Un indirizzo è utilizzabile solo se, ripulito, non è vuoto. */
function emailValida(email: string): boolean {
  return email.trim().length > 0;
}

/**
 * Deduplica per email normalizzata (trim + lowercase), preservando l'ordine, e
 * normalizza la forma: `isOwner` è un dettaglio del risolutore e non deve
 * uscirne.
 */
function dedup(candidati: Destinatario[]): Destinatario[] {
  const visti = new Set<string>();
  const out: Destinatario[] = [];
  for (const c of candidati) {
    if (!emailValida(c.email)) continue;
    const chiave = c.email.trim().toLowerCase();
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    out.push({ email: c.email, userId: c.userId, nome: c.nome });
  }
  return out;
}

/**
 * Catena di fallback, vince il primo livello non vuoto:
 *
 *   preferito → membri della sede → admin azienda → email azienda → []
 *
 * `preferito` è il creatore (lato broker) o chi ha accettato (lato agenzia),
 * già filtrato ACTIVE e non cancellato dal chiamante: se è uscito dall'azienda
 * o è sospeso semplicemente non arriva qui, e la catena scende da sola.
 *
 * Chi ha operato decide l'ampiezza del primo livello. Un membro del team di
 * sede — admin di sede o operatore — segue lui quella pratica e la riceve da
 * solo. Il super admin, invece, opera *da* una filiale: se ricevesse solo lui,
 * quella filiale resterebbe all'oscuro di una pratica che dovrà proseguire.
 * Quindi con lui ricevono anche tutti i membri della sede su cui ha operato.
 * `isOwner` è il ruolo di piattaforma `ADMIN_AZIENDA`, non `UserSede.ruolo`.
 *
 * La N6 "nuova pratica assegnata" parte prima che qualcuno prenda in carico la
 * pratica: passa `preferito: null` e ricade sui membri della sede. Non serve un
 * secondo risolutore.
 */
export function destinatariPratica(args: {
  preferito: Preferito | null;
  membriSede: Destinatario[];
  adminAzienda: Destinatario | null;
  emailAzienda: string | null;
  ragioneSociale: string;
}): Destinatario[] {
  if (args.preferito) {
    // Il super admin porta con sé la sua filiale; chi è di sede resta solo.
    const primoLivello = args.preferito.isOwner
      ? [args.preferito as Destinatario, ...args.membriSede]
      : [args.preferito as Destinatario];
    const p = dedup(primoLivello);
    if (p.length > 0) return p;
  }

  const membri = dedup(args.membriSede);
  if (membri.length > 0) return membri;

  if (args.adminAzienda) {
    const a = dedup([args.adminAzienda]);
    if (a.length > 0) return a;
  }

  const azienda = args.emailAzienda?.trim();
  if (azienda) return [{ email: azienda, userId: null, nome: args.ragioneSociale }];

  return [];
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/notifiche/pratica-recipients.test.ts
```

Atteso: PASS, 14 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/pratica-recipients.ts apps/piattaforma/src/lib/notifiche/pratica-recipients.test.ts
git commit -m "$(cat <<'EOF'
feat(notifiche): risolutore puro dei destinatari di una pratica

Catena preferito -> membri sede -> admin azienda -> email azienda, con dedup
per email normalizzata. Nessun livello vuoto interrompe l'invio: e' la regola
per cui una notifica non deve mai sparire in silenzio.

Chi opera decide l'ampiezza del primo livello: un membro del team di sede
riceve da solo, il super admin fa ricevere anche tutti i membri della sede da
cui ha operato, cosi' la filiale non resta all'oscuro di una pratica che dovra'
proseguire.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Colonne `creatoDaUserId` e `accettataDaUserId`

Registrano chi ha creato e chi ha accettato. Senza di esse il risolutore non ha nessun "preferito" da preferire.

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Pratica`, model `User`)
- Create: `packages/db/prisma/migrations/20260709120000_pratica_creato_accettata_da/migration.sql`
- Test: `apps/piattaforma/src/lib/notifiche/pratica-schema.test.ts`
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (la `tx.pratica.create`, intorno a riga 1283)
- Modify: `apps/piattaforma/src/app/inbox/actions.ts` (la `tx.pratica.update` che imposta `accettataAt`)

**Interfaces:**
- Produces: `Pratica.creatoDaUserId`, `Pratica.creatoDa`, `Pratica.accettataDaUserId`, `Pratica.accettataDa` (usati dalla Task 3).

- [ ] **Step 1: Scrivi il test di contratto che fallisce**

Il codebase ha già questo pattern in `apps/piattaforma/src/lib/distribuzione/assegnazione-unique.test.ts`: i mock di Prisma non applicano i vincoli, quindi un test che legge lo schema è l'unico modo per bloccare un disallineamento codice↔DB.

Crea `apps/piattaforma/src/lib/notifiche/pratica-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contratto di schema: la pratica sa CHI l'ha creata e CHI l'ha accettata.
 *
 * Senza queste colonne le email successive alla creazione non hanno modo di
 * risalire all'operatore e ricadono sull'admin dell'azienda madre — il bug che
 * questa feature chiude. I mock di Prisma nei test non se ne accorgerebbero.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(here, '../../../../../packages/db/prisma/schema.prisma');

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`model ${model} non trovato in schema.prisma`);
  return match[0];
}

const schema = readFileSync(SCHEMA_PATH, 'utf8');

describe('schema Pratica — tracciabilità di chi lavora la pratica', () => {
  const block = modelBlock(schema, 'Pratica');

  it('registra chi ha creato la pratica', () => {
    expect(block).toContain('creatoDaUserId');
  });

  it('registra chi ha accettato la pratica', () => {
    expect(block).toContain('accettataDaUserId');
  });

  // Le asserzioni ignorano la spaziatura: `prisma format` riallinea le colonne.
  it('sono relazioni vere verso User, non uuid nudi', () => {
    expect(block).toMatch(/creatoDa\s+User\?\s+@relation\("PraticheCreate"/);
    expect(block).toMatch(/accettataDa\s+User\?\s+@relation\("PraticheAccettate"/);
  });

  it('la cancellazione di un utente non porta via la pratica', () => {
    expect(block).toMatch(/@relation\("PraticheCreate"[^)]*onDelete: SetNull/);
    expect(block).toMatch(/@relation\("PraticheAccettate"[^)]*onDelete: SetNull/);
  });
});

describe('schema User — relazioni inverse', () => {
  const block = modelBlock(schema, 'User');

  it('espone le pratiche create e quelle accettate', () => {
    expect(block).toContain('PraticheCreate');
    expect(block).toContain('PraticheAccettate');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
nvm use 22.15.0
pnpm --filter piattaforma exec vitest run src/lib/notifiche/pratica-schema.test.ts
```

Atteso: FAIL su tutte e 5 le asserzioni (`expected '...' to contain 'creatoDaUserId'`).

- [ ] **Step 3: Aggiungi le colonne allo schema**

In `packages/db/prisma/schema.prisma`, nel model `Pratica`, subito **sotto** la riga `segnalataDaUserId     String?                   @db.Uuid`, aggiungi:

```prisma
  // Chi ha creato la pratica e chi l'ha accettata: le email del ciclo di vita
  // partono dopo, quando la sessione di quelle persone non esiste più. Senza
  // queste due colonne l'unico recapito noto resta l'admin dell'azienda madre.
  creatoDaUserId    String? @db.Uuid
  creatoDa          User?   @relation("PraticheCreate", fields: [creatoDaUserId], references: [id], onDelete: SetNull)
  accettataDaUserId String? @db.Uuid
  accettataDa       User?   @relation("PraticheAccettate", fields: [accettataDaUserId], references: [id], onDelete: SetNull)
```

Nel model `User`, subito **sotto** la riga `segnalazioniCreazioneGestite SegnalazioneCreazione[] @relation("SegnalazioneCreazioneGestore")`, aggiungi:

```prisma
  // Pratiche create da questo utente e pratiche che ha accettato per la sua agenzia.
  praticheCreate    Pratica[] @relation("PraticheCreate")
  praticheAccettate Pratica[] @relation("PraticheAccettate")
```

- [ ] **Step 4: Scrivi la migration a mano**

Crea `packages/db/prisma/migrations/20260709120000_pratica_creato_accettata_da/migration.sql`:

```sql
-- Chi ha creato la pratica e chi l'ha accettata.
-- Additiva: due colonne nullable. Le pratiche esistenti restano a NULL e le
-- loro notifiche continuano a ricadere sull'admin azienda, come prima.
ALTER TABLE "pratiche" ADD COLUMN "creatoDaUserId" UUID;
ALTER TABLE "pratiche" ADD COLUMN "accettataDaUserId" UUID;

-- SET NULL: la cancellazione fisica di un utente non deve portarsi via la pratica.
ALTER TABLE "pratiche"
  ADD CONSTRAINT "pratiche_creatoDaUserId_fkey"
  FOREIGN KEY ("creatoDaUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pratiche"
  ADD CONSTRAINT "pratiche_accettataDaUserId_fkey"
  FOREIGN KEY ("accettataDaUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Nessun indice: le query risalgono sempre dalla pratica all'utente (`pratiche.creatoDaUserId → users.id`, che usa la PK), mai al contrario.

- [ ] **Step 5: Valida schema e migration, applica al Postgres locale**

```bash
nvm use 22.15.0
pnpm -F @pv/db exec prisma validate
pnpm -F @pv/db exec prisma migrate deploy
pnpm -F @pv/db exec prisma generate
```

Atteso: `The schema at prisma\schema.prisma is valid`, poi `1 migration found` / `Applied migration`, poi `Generated Prisma Client`.

⚠️ `prisma migrate deploy` scrive sul Postgres **locale** in Docker (`pv-postgres`). Non puntare mai a Neon.
Se `prisma format` riallinea whitespace in blocchi non correlati, è cosmetico: verifica che le righe siano solo appaiate e prosegui.

- [ ] **Step 6: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/notifiche/pratica-schema.test.ts
```

Atteso: PASS, 5 test.

- [ ] **Step 7: Scrivi `creatoDaUserId` alla creazione della pratica**

In `apps/piattaforma/src/app/pratiche/nuova/actions.ts`, nella `tx.pratica.create({ data: { ... } })` (intorno a riga 1283), aggiungi una riga subito dopo `stato: 'BOZZA',`:

```ts
      stato: 'BOZZA',

      // Chi sta creando la pratica. Le email successive (accettata, processata,
      // sollecito) partono quando la sua sessione non esiste più: senza questa
      // colonna finirebbero all'admin dell'azienda madre.
      creatoDaUserId: userId,
```

`userId` è già in scope in quella funzione (lo usano `brokerDichiarazione.create` e la notifica N1).

- [ ] **Step 8: Scrivi `accettataDaUserId` all'accettazione**

In `apps/piattaforma/src/app/inbox/actions.ts`, nella `tx.pratica.update` che imposta `accettataAt`, aggiungi il campo:

```ts
      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'ACCETTATA',
          agenziaAssegnataId: assegnazione.agenziaId,
          agenziaSedeId: assegnazione.sedeId,
          accettataAt: now,
          // Chi accetta è chi seguirà la pratica: le email successive (promemoria
          // firma, segnalazione confermata) devono arrivare a lui, non alla madre.
          accettataDaUserId: session.user.id,
        },
      });
```

`session` è già in scope (`const session = await auth()` a inizio funzione, con il guard `if (!session?.user)`).

- [ ] **Step 9: Verifica che tutto compili e la suite resti verde**

```bash
pnpm typecheck
pnpm --filter piattaforma test
```

Atteso: typecheck senza errori; suite verde (i test esistenti non toccano le colonne nuove).

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260709120000_pratica_creato_accettata_da/migration.sql apps/piattaforma/src/lib/notifiche/pratica-schema.test.ts apps/piattaforma/src/app/pratiche/nuova/actions.ts apps/piattaforma/src/app/inbox/actions.ts
git commit -m "$(cat <<'EOF'
feat(pratiche): registra chi crea e chi accetta la pratica

Le email del ciclo di vita partono quando la sessione di chi ha creato o
accettato non esiste piu': senza queste colonne l'unico recapito noto e'
l'admin dell'azienda madre. Migration additiva, colonne nullable: le pratiche
storiche restano a NULL e si comportano come prima.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Orchestratore server-only

Carica i candidati dal DB e delega la scelta al risolutore puro.

**Files:**
- Create: `apps/piattaforma/src/lib/notifiche/pratica.ts`
- Test: `apps/piattaforma/src/lib/notifiche/pratica.test.ts`

**Interfaces:**
- Consumes: `destinatariPratica`, `type Destinatario` da `./pratica-recipients` (Task 1); `Pratica.creatoDaUserId`, `Pratica.accettataDaUserId` (Task 2).
- Produces:
  - `destinatariBroker(praticaId: string): Promise<Destinatario[]>`
  - `destinatariAgenzia(praticaId: string): Promise<Destinatario[]>`
  - `destinatariSedeAgenzia(sedeId: string): Promise<Destinatario[]>`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/notifiche/pratica.test.ts`. Il mock di Prisma segue la convenzione di `apps/piattaforma/src/app/api/badges/route.test.ts` (`vi.hoisted` + `vi.mock('@pv/db')`).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn() },
    sede: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    userSede: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('server-only', () => ({}));

import { destinatariBroker, destinatariAgenzia, destinatariSedeAgenzia } from './pratica';

const AZIENDA = { email: 'info@dealer.it', ragioneSociale: 'ROSSI SRL' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.userSede.findMany.mockResolvedValue([]);
  prismaMock.company.findUnique.mockResolvedValue(AZIENDA);
});

describe('destinatariBroker', () => {
  it('operatore che ha creato la pratica: riceve solo lui', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u1',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'op@dealer.it',
      nome: 'Luca',
      role: 'UTENTE_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'u2', email: 'collega@dealer.it', nome: 'Anna', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'op@dealer.it', userId: 'u1', nome: 'Luca' },
    ]);
  });

  it('super admin che ha creato la pratica: lui e tutta la sede da cui ha operato', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u4',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u4',
      email: 'titolare@dealer.it',
      nome: 'Titolare',
      role: 'ADMIN_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'u4', email: 'titolare@dealer.it', nome: 'Titolare', role: 'ADMIN_AZIENDA' } },
      { user: { id: 'u2', email: 'anna@dealer.it', nome: 'Anna', role: 'UTENTE_AZIENDA' } },
    ]);

    // il titolare compare una volta sola: la dedup lo riconosce fra i membri
    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare' },
      { email: 'anna@dealer.it', userId: 'u2', nome: 'Anna' },
    ]);
  });

  it('creatore non più attivo → membri della sede', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u1',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    // il findFirst del creatore filtra ACTIVE: non lo trova
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'u2', email: 'anna@dealer.it', nome: 'Anna', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'anna@dealer.it', userId: 'u2', nome: 'Anna' },
    ]);
  });

  it('pratica storica (nessun creatore, nessuna sede) → admin azienda', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: null,
      brokerSedeId: null,
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u4',
      email: 'admin@dealer.it',
      nome: 'Titolare',
      role: 'ADMIN_AZIENDA',
    });

    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'admin@dealer.it', userId: 'u4', nome: 'Titolare' },
    ]);
    // senza sede non si interroga user_sedi
    expect(prismaMock.userSede.findMany).not.toHaveBeenCalled();
  });

  it('pratica inesistente → nessun destinatario, nessuna query a valle', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(null);
    await expect(destinatariBroker('p1')).resolves.toEqual([]);
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
  });
});

describe('destinatariAgenzia', () => {
  it('operatore che ha accettato: riceve solo lui', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: 'a1',
      agenziaSedeId: 's9',
      agenziaAssegnataId: 'c9',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'a1',
      email: 'acc@ag.it',
      nome: 'Sara',
      role: 'UTENTE_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'collega@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariAgenzia('p1')).resolves.toEqual([
      { email: 'acc@ag.it', userId: 'a1', nome: 'Sara' },
    ]);
  });

  it('super admin che ha accettato: lui e tutta la sede assegnataria', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: 'a0',
      agenziaSedeId: 's9',
      agenziaAssegnataId: 'c9',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'a0',
      email: 'titolare@ag.it',
      nome: 'Titolare',
      role: 'ADMIN_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'gino@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariAgenzia('p1')).resolves.toEqual([
      { email: 'titolare@ag.it', userId: 'a0', nome: 'Titolare' },
      { email: 'gino@ag.it', userId: 'a2', nome: 'Gino' },
    ]);
  });

  it('assegnazione manuale admin (accettata senza accettante) → membri della sede', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: null,
      agenziaSedeId: 's9',
      agenziaAssegnataId: 'c9',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'sede@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariAgenzia('p1')).resolves.toEqual([
      { email: 'sede@ag.it', userId: 'a2', nome: 'Gino' },
    ]);
  });

  it('pratica non ancora assegnata → nessun destinatario', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: null,
      agenziaSedeId: null,
      agenziaAssegnataId: null,
    });
    await expect(destinatariAgenzia('p1')).resolves.toEqual([]);
  });
});

describe('destinatariSedeAgenzia', () => {
  it('membri della sede: nessun preferito, la pratica non è ancora presa in carico', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ companyId: 'c9' });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'sede@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariSedeAgenzia('s9')).resolves.toEqual([
      { email: 'sede@ag.it', userId: 'a2', nome: 'Gino' },
    ]);
    // Nessun "preferito" da cercare: l'unica findFirst è quella dell'admin azienda.
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('sede senza membri → admin azienda, poi email azienda', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ companyId: 'c9' });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.company.findUnique.mockResolvedValue({ email: 'info@ag.it', ragioneSociale: 'AG SRL' });

    await expect(destinatariSedeAgenzia('s9')).resolves.toEqual([
      { email: 'info@ag.it', userId: null, nome: 'AG SRL' },
    ]);
  });

  it('sede inesistente → lista vuota', async () => {
    prismaMock.sede.findUnique.mockResolvedValue(null);
    await expect(destinatariSedeAgenzia('s9')).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm --filter piattaforma exec vitest run src/lib/notifiche/pratica.test.ts
```

Atteso: FAIL — `Failed to resolve import "./pratica"`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `apps/piattaforma/src/lib/notifiche/pratica.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { destinatariPratica, type Destinatario, type Preferito } from './pratica-recipients';

/**
 * Chi riceve le email del ciclo di vita di una pratica: carica i candidati dal
 * DB e delega la scelta al risolutore puro `pratica-recipients.ts`.
 *
 * Le email amministrative (addebito, fattura, credito wallet, penale) NON
 * passano di qui: restano all'admin dell'azienda madre, perché IBAN, fatture e
 * blocchi di pagamento riguardano l'entità legale, non chi lavora la pratica.
 */

const SELECT_UTENTE = { id: true, email: true, nome: true, role: true } as const;

type UtenteDb = { id: string; email: string; nome: string | null; role: string };

function toDestinatario(u: UtenteDb, fallbackNome: string): Destinatario {
  return { email: u.email, userId: u.id, nome: u.nome?.trim() || fallbackNome };
}

/**
 * `isOwner` è il ruolo di PIATTAFORMA, non `UserSede.ruolo`: un `ADMIN_SEDE` è
 * admin della filiale, non dell'azienda. Stessa definizione di
 * `lib/auth/permissions.ts#isOwner`.
 */
function toPreferito(u: UtenteDb, fallbackNome: string): Preferito {
  return { ...toDestinatario(u, fallbackNome), isOwner: u.role === 'ADMIN_AZIENDA' };
}

/**
 * L'utente "preferito" (creatore o accettante) conta solo se è ancora
 * raggiungibile: se è uscito dall'azienda o è sospeso non lo si trova, e la
 * catena scende da sola al livello successivo.
 */
async function preferitoAttivo(userId: string | null): Promise<UtenteDb | null> {
  if (!userId) return null;
  return prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', deletedAt: null },
    select: SELECT_UTENTE,
  });
}

async function membriDellaSede(sedeId: string | null): Promise<UtenteDb[]> {
  if (!sedeId) return [];
  const righe = await prisma.userSede.findMany({
    where: { sedeId, user: { status: 'ACTIVE', deletedAt: null } },
    select: { user: { select: SELECT_UTENTE } },
    orderBy: { createdAt: 'asc' },
  });
  return righe.map((r) => r.user);
}

async function adminDellAzienda(companyId: string): Promise<UtenteDb | null> {
  return prisma.user.findFirst({
    where: { companyId, role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
    select: SELECT_UTENTE,
  });
}

/** Risolve la catena completa per una company, con o senza utente preferito. */
async function risolvi(args: {
  preferitoUserId: string | null;
  sedeId: string | null;
  companyId: string;
}): Promise<Destinatario[]> {
  const azienda = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { email: true, ragioneSociale: true },
  });
  if (!azienda) return [];

  const [preferito, membri, admin] = await Promise.all([
    preferitoAttivo(args.preferitoUserId),
    membriDellaSede(args.sedeId),
    adminDellAzienda(args.companyId),
  ]);

  return destinatariPratica({
    preferito: preferito ? toPreferito(preferito, azienda.ragioneSociale) : null,
    membriSede: membri.map((m) => toDestinatario(m, azienda.ragioneSociale)),
    adminAzienda: admin ? toDestinatario(admin, azienda.ragioneSociale) : null,
    emailAzienda: azienda.email,
    ragioneSociale: azienda.ragioneSociale,
  });
}

/** Destinatari lato broker: chi ha creato la pratica, poi la sua sede. */
export async function destinatariBroker(praticaId: string): Promise<Destinatario[]> {
  const p = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: { creatoDaUserId: true, brokerSedeId: true, brokerId: true },
  });
  if (!p) return [];
  return risolvi({
    preferitoUserId: p.creatoDaUserId,
    sedeId: p.brokerSedeId,
    companyId: p.brokerId,
  });
}

/**
 * Destinatari lato agenzia DOPO l'accettazione: chi l'ha accettata, poi la sede
 * assegnataria. L'assegnazione manuale dell'admin porta la pratica in ACCETTATA
 * senza che nessuno in agenzia accetti: lì `accettataDaUserId` resta null e si
 * ricade — correttamente — sui membri della sede.
 */
export async function destinatariAgenzia(praticaId: string): Promise<Destinatario[]> {
  const p = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: { accettataDaUserId: true, agenziaSedeId: true, agenziaAssegnataId: true },
  });
  if (!p?.agenziaAssegnataId) return [];
  return risolvi({
    preferitoUserId: p.accettataDaUserId,
    sedeId: p.agenziaSedeId,
    companyId: p.agenziaAssegnataId,
  });
}

/**
 * Destinatari di una SEDE agenzia PRIMA dell'accettazione (N6 "nuova pratica
 * assegnata"): nessuno l'ha ancora presa in carico, quindi nessun preferito.
 */
export async function destinatariSedeAgenzia(sedeId: string): Promise<Destinatario[]> {
  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { companyId: true },
  });
  if (!sede) return [];
  return risolvi({ preferitoUserId: null, sedeId, companyId: sede.companyId });
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/lib/notifiche/pratica.test.ts
```

Atteso: PASS, 12 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/pratica.ts apps/piattaforma/src/lib/notifiche/pratica.test.ts
git commit -m "$(cat <<'EOF'
feat(notifiche): orchestratore server-only dei destinatari pratica

destinatariBroker / destinatariAgenzia / destinatariSedeAgenzia caricano i
candidati dal DB e delegano la catena al risolutore puro. Il preferito viene
cercato ACTIVE e non cancellato: se e' uscito dall'azienda la catena scende.
Il suo ruolo di piattaforma viaggia col preferito: se e' ADMIN_AZIENDA ricevono
anche i membri della sede da cui ha operato.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Reinstrada le email al broker

N1, N2, N13, N3, N11, N31 → creatore (e, se è il super admin, anche i membri della sua sede).
**N4 e N17 restano invariate.**

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/actions.ts` (blocco N2)
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts` (blocchi N13 e N31)
- Modify: `apps/piattaforma/src/lib/jobs/send-solleciti.ts` (blocco N3)
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts` (blocco N11, in `emitEscalationNotifications`)
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (blocco N1)

**Interfaces:**
- Consumes: `destinatariBroker(praticaId): Promise<Destinatario[]>` dove `Destinatario = { email: string; userId: string | null; nome: string }` (Task 3).

#### La trasformazione, identica in tutti e quattro i punti

**Non riscrivere i payload.** In ogni sito l'edit è meccanico e riguarda solo tre cose:

1. **Import** — aggiungi `import { destinatariBroker } from '@/lib/notifiche/pratica';`
2. **Risoluzione del destinatario** — cancella le righe che calcolano `brokerUser` / `brokerEmail`
   e mettici `const destinatari = await destinatariBroker(<praticaId>);`
3. **Invio** — avvolgi la `sendNotification({...})` esistente in `for (const d of destinatari) { ... }`
   e sostituisci **solo** queste chiavi, lasciando ogni altro campo del payload esattamente com'è:

   | prima | dopo |
   |---|---|
   | `email: brokerEmail` | `email: d.email` |
   | `userId: brokerUser?.id ?? null` | `userId: d.userId` |
   | `nomeBroker: brokerUser?.nome ?? <fallback>` | `nomeBroker: d.nome` |

   La guardia `if (... && brokerEmail)` diventa `if (... && destinatari.length > 0)`, oppure sparisce:
   un `for` su lista vuota non invia nulla.

4. **Query** — se togli `users: { where: { role: 'ADMIN_AZIENDA', ... } }` da una `include` perché non
   serve più al destinatario, **controlla prima** che nessun campo del payload la stesse usando.
   Nel dubbio lasciala: una `include` in più non fa danno, un payload rotto sì.

- [ ] **Step 1: N2 — inbox/actions.ts**

Import in cima al file:

```ts
import { destinatariBroker } from '@/lib/notifiche/pratica';
```

Nel blocco `N2_BROKER_ACCETTATA` applica la trasformazione qui sopra. Il `praticaId` è già in scope
(parametro dell'action). Righe da cancellare:

```ts
    const brokerUser = broker?.users[0];
    const brokerEmail = brokerUser?.email ?? broker?.email;
```

Righe che le sostituiscono:

```ts
    // Recapito: chi ha creato la pratica; se non è più raggiungibile la catena
    // scende alla sua sede, poi all'admin azienda. Vedi lib/notifiche/pratica.ts.
    const destinatari = await destinatariBroker(praticaId);
```

La guardia `if (full && broker && brokerEmail && agenzia)` diventa
`if (full && broker && agenzia && destinatari.length > 0)`, e dentro ci va
`for (const d of destinatari) { ... }` che avvolge la `sendNotification` già presente. Il payload
resta identico salvo `nomeBroker: brokerUser?.nome ?? broker.ragioneSociale` → `nomeBroker: d.nome`.

- [ ] **Step 2: N13 — pratiche/actions.ts**

Import `destinatariBroker`. Nel blocco `N13_BROKER_PRATICA_PROCESSATA`, stessa trasformazione:
cancella `const brokerUser = full?.broker.users[0];` e `const brokerEmail = brokerUser?.email ?? full?.broker.email;`,
mettici `const destinatari = await destinatariBroker(praticaId);`, avvolgi la `sendNotification` in
`for (const d of destinatari)`, e sostituisci `email`, `userId`, `nomeBroker` come da tabella.

**NON toccare** `N8_AGENZIA_ADDEBITO` nello stesso file.

- [ ] **Step 3: N31 — pratiche/actions.ts, separandola da N4**

N4 e N31 vengono inviate nello stesso blocco e oggi condividono `brokerEmail`/`brokerUser`.
Vanno separate:

- **N4_BROKER_FIRMA_E_CREDITO**: lascia tutto com'è. Continua a usare `brokerEmail`/`brokerUser`,
  quindi **non cancellare** quelle due variabili né la `include` degli `users`. Espone `creditoCent`
  e `saldoCent` del wallet: resta all'admin azienda.
- **N31_VALUTA_AGENZIA**: aggiungi sopra di essa `const destinatari = await destinatariBroker(praticaId);`
  e avvolgila in `for (const d of destinatari)`, sostituendo `email`, `userId` e `nomeBroker`.

Dopo questo step, nello stesso blocco convivono due destinatari diversi: è voluto.

- [ ] **Step 4: N3 — send-solleciti.ts**

Import `destinatariBroker`. Nel blocco `N3_BROKER_SOLLECITO`, cancella:

```ts
      const brokerUser = p.broker.users[0];
      const brokerEmail = brokerUser?.email ?? p.broker.email;
      const nomeBroker = brokerUser?.nome ?? p.broker.ragioneSociale;
```

e mettici `const destinatari = await destinatariBroker(p.id);`. Avvolgi la `sendNotification` in
`for (const d of destinatari)` e usa `d.email`, `d.userId`, `d.nome`. `agenziaNome` resta com'è.

⚠️ `nomeBroker` è una variabile locale, non una chiave del payload: cercala anche più sotto nel
blocco prima di cancellarla.

- [ ] **Step 5: N11 — tick.ts**

Import `destinatariBroker`. In `emitEscalationNotifications`, cancella:

```ts
  const brokerUser = pratica.broker.users[0];
  const brokerEmail = brokerUser?.email ?? pratica.broker.email;
```

e mettici `const destinatari = await destinatariBroker(praticaId);`. La guardia `if (brokerEmail)`
diventa il `for (const d of destinatari)`. Payload invariato salvo `nomeBroker: d.nome`.

La `include` degli `users` del broker in `emitEscalationNotifications` può restare: la N10 admin
nello stesso file non la usa, ma toglierla non serve a nulla e rischia di rompere il payload.

- [ ] **Step 6: N1 — pratiche/nuova/actions.ts**

Oggi la N1 interroga direttamente `prisma.user.findUnique({ where: { id: userId } })` e invia a
quell'indirizzo. Ora deve passare dal risolutore, così la regola del super admin vale anche per la
conferma di invio: se a creare è il titolare, la sua sede lo sa subito.

La colonna `creatoDaUserId` è già stata scritta (Task 2) dentro la transazione che crea la pratica,
quindi al momento della N1 è persistita e `destinatariBroker` la trova.

Import `destinatariBroker`. Sostituisci il blocco:

```ts
  if (round1.assegnazioni > 0) {
    const dest = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, nome: true },
    });
    if (dest?.email) {
      await sendNotification({ /* ... */ }).catch(() => undefined);
    }
  }
```

con:

```ts
  if (round1.assegnazioni > 0) {
    // Recapito dal DB, non dalla sessione (il JWT porta l'email congelata al
    // login). Il risolutore lo garantisce, e applica la regola del super admin:
    // se a creare è il titolare, riceve anche la sede da cui ha operato.
    const destinatari = await destinatariBroker(pratica.id);
    for (const d of destinatari) {
      await sendNotification({
        tipo: 'N1_BROKER_INVIO_PRATICA',
        target: { email: d.email, userId: d.userId, companyId: brokerId },
        // payload identico a quello attuale, con:
        //   nomeBroker: dest.nome?.split(' ')[0] ?? 'utente'
        //     → nomeBroker: d.nome.split(' ')[0]
      }).catch(() => undefined);
    }
  }
```

⚠️ Il commento sopra la vecchia N1 spiega perché l'email va letta dal DB e non dalla sessione: quella
ragione **resta valida**, il risolutore fa esattamente questo. Riscrivi il commento, non cancellarlo.

- [ ] **Step 7: Verifica**

```bash
nvm use 22.15.0
pnpm typecheck
pnpm --filter piattaforma test
```

Atteso: typecheck pulito; suite verde. Se un test esistente mocka `@pv/db` e ora fallisce perché `pratica.ts` interroga tabelle non mockate (`userSede`, `company`, `sede`), aggiungi i mock mancanti a quel test — non cambiare il codice di produzione per compiacere un mock.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/inbox/actions.ts apps/piattaforma/src/app/pratiche/actions.ts apps/piattaforma/src/app/pratiche/nuova/actions.ts apps/piattaforma/src/lib/jobs/send-solleciti.ts apps/piattaforma/src/lib/distribuzione/tick.ts
git commit -m "$(cat <<'EOF'
fix(notifiche): le email al broker vanno a chi ha creato la pratica

N1 invio, N2 accettata, N13 processata, N3 sollecito, N11 escalation e N31
valuta agenzia usano ora destinatariBroker(): creatore -> membri della sua sede
-> admin azienda -> email azienda. Se a creare e' il super admin ricevono anche
i membri della sede da cui ha operato. N4 (credito e saldo wallet) e N17
(penale) restano all'azienda madre: riguardano l'entita' legale.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Reinstrada le email all'agenzia

N6 → membri della sede assegnataria. N7, N18 → chi ha accettato. **N8 e N9 restano invariate.**

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts` (blocco N6, intorno a riga 268-300)
- Modify: `apps/piattaforma/src/app/admin/escalation/actions.ts` (blocco N6)
- Modify: `apps/piattaforma/src/lib/jobs/send-solleciti.ts` (blocco N7)
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts` (blocco N18)

**Interfaces:**
- Consumes: `destinatariSedeAgenzia(sedeId)`, `destinatariAgenzia(praticaId)` (Task 3); `sendNotifications(inputs: readonly SendInput[])` da `@/lib/notifiche/send`.

- [ ] **Step 1: N6 — tick.ts**

La `praticaAssegnazione.findMany` che alimenta N6 deve selezionare `sedeId` (l'assegnataria è la sede) e `praticaId`. Poi, per ogni assegnazione, i destinatari sono i membri di quella sede.

Import:

```ts
import { destinatariSedeAgenzia } from '@/lib/notifiche/pratica';
```

Oggi `inputs` è un `assegnazioni.map(...)` che produce **una** notifica per assegnazione. Diventa un
`map` asincrono che ne produce **una per membro della sede**, appiattito con `.flat()`. Il `payload`
si ricopia identico da com'è ora: cambia solo `target`.

```ts
  const batchTotal = assegnazioni.length;

  // L'assegnataria è la SEDE: la N6 va a chi lavora in quella filiale, non
  // all'admin della madre. Nessun preferito: nessuno l'ha ancora presa in carico.
  // Le righe legacy senza sedeId ricadono sul comportamento storico.
  const inputs = (
    await Promise.all(
      assegnazioni.map(async (a) => {
        const destinatari = a.sedeId
          ? await destinatariSedeAgenzia(a.sedeId)
          : [
              {
                email: a.agenzia.users[0]?.email ?? a.agenzia.email,
                userId: a.agenzia.users[0]?.id ?? null,
                nome: a.agenzia.ragioneSociale,
              },
            ];

        return destinatari.map((d) => ({
          tipo: 'N6_AGENZIA_NUOVA_PRATICA' as const,
          target: { email: d.email, userId: d.userId, companyId: a.agenzia.id },
          // payload: ricopia ESATTAMENTE l'oggetto payload già presente nel map attuale.
          payload: PAYLOAD_ATTUALE_INVARIATO,
        }));
      }),
    )
  ).flat();
```

Sostituisci `PAYLOAD_ATTUALE_INVARIATO` con l'oggetto `payload` che il `map` costruisce oggi, senza
modificarne un solo campo. La `include` di `agenzia.users` **resta**: serve al ramo legacy qui sopra.
Assicurati che la `praticaAssegnazione.findMany` selezioni `sedeId` (l'assegnazione ce l'ha già:
`@@unique([praticaId, sedeId, round])`).

- [ ] **Step 2: N6 — admin/escalation/actions.ts**

L'assegnazione manuale conosce già `sede.id` e lo mette in `notificaData.agenziaSedeId`. Import:

```ts
import { destinatariSedeAgenzia } from '@/lib/notifiche/pratica';
```

Dentro il `try` che invia la N6, sostituisci il `target` e avvolgi la `sendNotification` esistente in
un ciclo. Il `payload` si ricopia identico.

```ts
    try {
      const destinatari = await destinatariSedeAgenzia(notificaData.agenziaSedeId);
      for (const d of destinatari) {
        // sendNotification già presente, con target sostituito:
        //   email: notificaData.agenziaEmail   → email: d.email
        //   userId: notificaData.agenziaUserId → userId: d.userId
        // companyId e payload restano identici.
      }
    } catch {
      // swallow notification errors — assegnazione già avvenuta
    }
```

`notificaData.agenziaSedeId` è già valorizzato (`agenziaSedeId: sede.id`) ed è di tipo `string`, non
nullable: nessuna guardia serve. I campi `agenziaEmail`/`agenziaUserId` di `NotificaData` diventano
inutilizzati: rimuovili dal tipo e dalla sua costruzione.

- [ ] **Step 3: N7 — send-solleciti.ts**

N7 parte da `accettataAt + soglia`, quindi **dopo** l'accettazione: il destinatario è chi ha accettato.

Import `destinatariAgenzia` da `@/lib/notifiche/pratica`. Nel blocco `N7_AGENZIA_PROMEMORIA_COUNTDOWN`,
cancella `const agenziaUser = p.agenziaAssegnata.users[0];` e
`const agenziaEmail = agenziaUser?.email ?? p.agenziaAssegnata.email;`, mettici
`const destinatari = await destinatariAgenzia(p.id);`, e avvolgi la `sendNotification` esistente in
`for (const d of destinatari)` sostituendo:

| prima | dopo |
|---|---|
| `email: agenziaEmail` | `email: d.email` |
| `userId: agenziaUser?.id ?? null` | `userId: d.userId` |

`nomeAgenzia` nel payload è la **ragione sociale dell'agenzia**, non il nome del destinatario: lascialo
com'è (`p.agenziaAssegnata.ragioneSociale`).

- [ ] **Step 4: N18 — penali/segnalazione.ts**

Il modulo riceve oggi `agenziaEmail`/`agenziaUserId` già risolti dal chiamante, ma ha `praticaId` in
firma. Import `destinatariAgenzia`. Sostituisci la guardia `if (payload.agenziaEmail)` con:

```ts
    const destinatariAg = await destinatariAgenzia(praticaId);
    for (const d of destinatariAg) {
      // sendNotification N18 già presente, con target sostituito:
      //   email: payload.agenziaEmail   → email: d.email
      //   userId: payload.agenziaUserId → userId: d.userId
      // companyId: payload.agenziaCompanyId e payload restano identici.
    }
```

**NON toccare** `N8_AGENZIA_ADDEBITO` (`app/pratiche/actions.ts`, allega la fattura PDF) né `N9_AGENZIA_ADDEBITO_FALLITO` (`lib/fee/blocco.ts`, blocca i pagamenti): restano all'admin azienda.

- [ ] **Step 5: Verifica**

```bash
nvm use 22.15.0
pnpm typecheck
pnpm --filter piattaforma test
```

Atteso: typecheck pulito; suite verde. `tick.test.ts` mocka Prisma: aggiungi i mock di `sede`, `userSede`, `company`, `user` se il test fallisce per query non mockate.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/tick.ts apps/piattaforma/src/app/admin/escalation/actions.ts apps/piattaforma/src/lib/jobs/send-solleciti.ts apps/piattaforma/src/lib/penali/segnalazione.ts
git commit -m "$(cat <<'EOF'
fix(notifiche): le email all'agenzia vanno alla sede assegnataria

N6 "nuova pratica assegnata" va ai membri della sede che riceve l'assegnazione
(l'assegnataria e' la SEDE, non la madre); N7 promemoria firma e N18
segnalazione confermata vanno a chi ha accettato. N8 addebito con fattura e N9
addebito fallito restano all'admin azienda.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verifica finale, incluse le query su DB reale

**Files:** nessuno (solo verifica), salvo eventuali fix emersi.

- [ ] **Step 1: Suite, typecheck, lint**

```bash
nvm use 22.15.0
pnpm --filter piattaforma test
pnpm typecheck
pnpm --filter piattaforma lint
```

Atteso: suite verde, typecheck pulito, lint senza errori (4 warning preesistenti in `register-wizard.tsx` e `api/badges/route.test.ts` sono attesi).

- [ ] **Step 2: Esegui le query nuove contro il Postgres locale, in sola lettura**

I test mockano Prisma: una query valida per TypeScript può essere sbagliata per il DB. Crea `packages/db/__tmp_recipients_check.mjs` (lì risolvono `@prisma/client` e `bcryptjs`, non da `apps/piattaforma/`), eseguilo, poi **cancellalo**.

```js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const sede = await prisma.sede.findFirst({ where: { type: 'DEALER' }, select: { id: true, companyId: true } });
console.log('sede dealer:', sede?.id ?? 'NESSUNA');

// membri della sede: la query dell'orchestratore
const membri = await prisma.userSede.findMany({
  where: { sedeId: sede.id, user: { status: 'ACTIVE', deletedAt: null } },
  select: { user: { select: { id: true, email: true, nome: true } } },
  orderBy: { createdAt: 'asc' },
});
console.log('membri attivi:', membri.length, '(deve essere > 0: la relazione funziona)');

// controprova: una sede inesistente deve dare 0, altrimenti la where non filtra
const zero = await prisma.userSede.count({ where: { sedeId: '00000000-0000-0000-0000-000000000000' } });
console.log('controprova sede inesistente:', zero, '(deve essere 0)');

// le colonne nuove esistono e sono leggibili
const p = await prisma.pratica.findFirst({
  where: { deletedAt: null },
  select: { id: true, creatoDaUserId: true, accettataDaUserId: true, brokerSedeId: true },
});
console.log('colonne nuove leggibili:', JSON.stringify(p));

// pratiche storiche: entrambe null → devono ricadere sull'admin azienda
const storiche = await prisma.pratica.count({ where: { deletedAt: null, creatoDaUserId: null } });
console.log('pratiche storiche senza creatore:', storiche);

await prisma.$disconnect();
```

```bash
nvm use 22.15.0
cd packages/db && node __tmp_recipients_check.mjs && rm __tmp_recipients_check.mjs
```

Attenzione al punto 2: una query rotta e una query giusta senza dati restituiscono **entrambe 0**. La controprova con la sede inesistente serve a distinguerle.

- [ ] **Step 3: Prova end-to-end sulle email di sviluppo**

Le notifiche in locale finiscono come file HTML in `apps/piattaforma/.dev-emails/` (gitignored).

```bash
pnpm --filter piattaforma dev
```

1. Crea una pratica come **operatore di una sede dealer** (non come admin azienda).
2. Verifica in `.dev-emails/` che la N1 sia indirizzata all'operatore.
3. Accetta la pratica come agenzia e verifica che la **N2** sia indirizzata all'operatore, non all'admin azienda.
4. Verifica che la N6 (nuova pratica assegnata) sia indirizzata ai membri della sede agenzia.
5. Porta la pratica a `FIRMATA` e verifica che la **N4** (credito e saldo) sia ancora indirizzata all'admin azienda.

- [ ] **Step 4: Regressione sulle pratiche storiche**

Tutte le pratiche esistenti hanno `creatoDaUserId IS NULL` **e** `brokerSedeId` valorizzato, quindi
notificheranno i **membri della loro sede**, non l'admin azienda. Nessuno perde email, perché ogni
`ADMIN_AZIENDA` dealer ha una membership `ADMIN_SEDE`. Verificalo prima di dichiarare finito:

```bash
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT count(*) FILTER (WHERE \"brokerSedeId\" IS NULL) senza_sede, count(*) tot FROM pratiche WHERE \"deletedAt\" IS NULL AND \"creatoDaUserId\" IS NULL;"
docker exec pv-postgres psql -U pv -d passaggio_veloce -t -A -F'|' -c "SELECT u.email, count(us.id) FROM users u JOIN companies c ON c.id=u.\"companyId\" LEFT JOIN user_sedi us ON us.\"userId\"=u.id WHERE u.role='ADMIN_AZIENDA' AND c.type='DEALER' AND u.\"deletedAt\" IS NULL GROUP BY u.email;"
```

Atteso: la seconda query non deve mostrare **nessun** admin con `0` membership. Se ne compare uno,
quell'admin smetterebbe di ricevere le email delle pratiche della sua azienda: fermati e riportalo.

Il ramo `adminAzienda` della catena resta comunque coperto dai test
`pratica.test.ts` → *"pratica storica (nessun creatore, nessuna sede) → admin azienda"* e
`pratica-recipients.test.ts` → *"sede senza membri: l'admin azienda"*.

- [ ] **Step 5: Nessuna migration su Neon**

Verificare che la migration `20260709120000_pratica_creato_accettata_da` **non** sia stata applicata a produzione: il rilascio è una decisione separata dell'utente (push su `main` = deploy). Riportare che va applicata a Neon **prima** del push, altrimenti il codice nuovo interroga colonne inesistenti.

---

## Note per chi implementa

- I payload delle notifiche vanno **ricopiati invariati** dal codice esistente: nel piano sono abbreviati con `/* invariato */` solo per non ripetere decine di righe. L'unico campo che cambia è il nome del destinatario (`nomeBroker` / `nomeAgenzia`), che diventa `d.nome`.
- Se togli `users: { where: { role: 'ADMIN_AZIENDA' ... } }` da una query perché non serve più al destinatario, controlla che nessun **payload** lo stesse usando (es. `nomeBroker`).
- `sendNotification` valuta le preferenze di disiscrizione solo quando `target.userId` è valorizzato. I membri della sede hanno uno `userId`, quindi le loro preferenze vengono rispettate; il fallback su `Company.email` resta senza `userId`, come già oggi.
- La N6 può ora produrre più email per assegnazione (una per membro della sede). Sui dati attuali le sedi dealer hanno 7 membri su 5 sedi e le agenzie 1 su 1: nessuna esplosione.
