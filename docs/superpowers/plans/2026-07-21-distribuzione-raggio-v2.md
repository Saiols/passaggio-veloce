# Motore Distribuzione v2 — Raggio incrementale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il motore distribuzione a 3 round fissi con un'espansione continua del raggio (500m→10km, +200m/10min) su distanza stradale reale, notifiche cumulative eterne, pausa notturna e stato terminale "zona non coperta".

**Architecture:** Cron ogni 10 min che, in orario lavorativo, espande il raggio di una pratica `IN_DISTRIBUZIONE` di un anello non vuoto per volta (skippando istantaneamente gli anelli vuoti), notificando cumulativamente le sedi entro il raggio stradale corrente. Distanza ibrida: prefiltro Haversine → Google Distance Matrix sui candidati (cache + fail-open). Accettazione con lock pessimistico (primo atomico). Config in DB editabile da admin.

**Tech Stack:** Next.js 16 (Server Actions, RSC), Prisma + Postgres (Neon EU), pnpm monorepo, Vitest, Google Distance Matrix API.

**Spec:** `docs/superpowers/specs/2026-07-21-distribuzione-raggio-v2-design.md` — fonte di verità per ogni requisito.

## Global Constraints

- **Distanza ibrida, fail-open:** prefiltro Haversine (`distanceKm`, condizione necessaria strada≥linea d'aria) → `roadDistancesM` (Google). Qualunque errore/quota/timeout provider → fallback Haversine transitorio (NON cachato). La distribuzione non si blocca MAI. Nei test: provider **mock** (zero chiamate reali).
- **Orario:** finestra da `DistribuzioneConfig` (default LUN-VEN 09:00–19:00). L'espansione (tick) rispetta l'orario; il **primo anello al submit ignora l'orario** (parte a qualsiasi ora).
- **`ultimaEspansioneAt` si valorizza SOLO quando una notifica viene realmente inviata** (anello non vuoto). Gli anelli vuoti skippati non lo toccano. Governa il gate dei 10 min.
- **Cache stradale:** si persistono in `RoadDistanceCache` SOLO i risultati reali del provider Google. I fallback Haversine non si cachano (ritenta il tick dopo).
- **Accettazione:** `SELECT … FOR UPDATE` sulla riga `pratiche` a inizio transazione → primo atomico. Niente logica "vince il raggio minore".
- **Stato unico `IN_DISTRIBUZIONE`** (i `IN_ATTESA_ROUND_1/2/3` restano nell'enum per i log, non più prodotti).
- **Parametri SEMPRE da `getDistribuzioneConfig()` (DB)**, mai da costanti hardcoded.
- **Auto-suspend no-show rimosso** (le notifiche non scadono → niente TIMEOUT trigger).
- **Migration Neon a mano** (`prisma migrate dev` è distruttivo: propone DROP SEQUENCE). SQL scritto a mano + `prisma migrate deploy` locale.
- **Design system:** nessun colore hardcoded (token `pv-*`), componenti in `src/components/ui`.
- **Test:** i test mockano Prisma; per query nuove verificarle anche sul DB locale reale. Vitest NON fa typecheck → `pnpm typecheck` a parte.
- **Toolchain:** Node 22 (`nvm use 22.15.0`), pnpm.

---

## File Structure

**Nuovi:**
- `apps/piattaforma/src/lib/distribuzione/config.ts` — accessor config DB + default + tipi.
- `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.ts` — `isOrarioLavorativo`.
- `apps/piattaforma/src/lib/distribuzione/anelli.ts` — logica pura `prossimoAnello` (selezione anello).
- `apps/piattaforma/src/lib/geo/road-distance.ts` — servizio distanza stradale + provider.
- `apps/piattaforma/src/lib/geo/providers/distance-google.ts` — GoogleDistanceMatrixProvider.
- `apps/piattaforma/src/lib/geo/providers/distance-mock.ts` — MockProvider (Haversine).
- `apps/piattaforma/src/app/admin/distribuzione/page.tsx` + `actions.ts` — config admin.
- migration SQL in `packages/db/prisma/migrations/…`.

**Modificati:**
- `packages/db/prisma/schema.prisma` — enum + Pratica + PraticaAssegnazione + 2 modelli.
- `apps/piattaforma/src/lib/distribuzione/tick.ts` — riscrittura motore.
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — submit → IN_DISTRIBUZIONE + ring1.
- `apps/piattaforma/src/app/inbox/actions.ts` — lock FOR UPDATE + check stato.
- `apps/piattaforma/src/lib/pratiche/stati.ts` + `tabs.ts` — classificano IN_DISTRIBUZIONE.
- `apps/piattaforma/src/app/admin/monitoraggio/*` — etichette/filtri + zona non coperta.
- `apps/piattaforma/src/lib/notifiche/templates.ts` + registry tipi + `layout.ts` — N52.
- componente modale evento "nuova pratica" — pulsazione.
- `apps/piattaforma/src/app/admin/admin-shell.tsx` — voce nav config distribuzione.

**Rimossi:**
- `apps/piattaforma/src/lib/distribuzione/auto-suspend.ts` (+ test) e call-site.
- `apps/piattaforma/src/lib/distribuzione/constants.ts` `DISTRIBUZIONE`/`ANTI_ABUSO` (config sostituisce).
- logica countdown 4h / `riarmaPendingScadute` in tick.

---

## Global naming (interfacce condivise tra i task)

```ts
// config.ts
export type DistribuzioneConfigDTO = {
  raggioStartM: number; stepM: number; raggioMaxM: number;
  intervalloMin: number; orarioInizio: string; orarioFine: string;
  giorni: GiornoSettimana[]; // parse da CSV
};
export function getDistribuzioneConfig(tx?): Promise<DistribuzioneConfigDTO>;
export const DISTRIBUZIONE_DEFAULT: DistribuzioneConfigDTO;

// orario-piattaforma.ts
export function isOrarioLavorativo(now: Date, cfg: DistribuzioneConfigDTO): boolean;

// road-distance.ts
export type LatLng = { lat: number; lng: number };
export function roadDistancesM(praticaId: string, origin: LatLng,
  dests: { sedeId: string; coord: LatLng }[], tx?): Promise<Map<string, number>>;

// anelli.ts
export type SedeConDistanza = { sedeId: string; companyId: string; distanzaM: number };
export type ProssimoAnello =
  | { tipo: 'notifica'; raggioRaggiuntoM: number; sedi: SedeConDistanza[] }
  | { tipo: 'zona-non-coperta'; raggioRaggiuntoM: number };
export function prossimoAnello(
  sediInMaxRaggio: SedeConDistanza[], // già filtrate: stradale ≤ raggioMaxM, non contattate
  raggioCorrenteM: number,
  cfg: DistribuzioneConfigDTO,
): ProssimoAnello;
```

---

### Task 1: Schema + migration + config accessor

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260721120000_distribuzione_v2/migration.sql`
- Create: `apps/piattaforma/src/lib/distribuzione/config.ts`
- Test: `apps/piattaforma/src/lib/distribuzione/config.test.ts`

**Interfaces:**
- Produces: modelli `DistribuzioneConfig`, `RoadDistanceCache`; enum value `IN_DISTRIBUZIONE`; `Pratica.raggioCorrenteM/ultimaEspansioneAt/zonaNonCopertaAt`; `PraticaAssegnazione.raggioMetri`; `getDistribuzioneConfig()`, `DISTRIBUZIONE_DEFAULT`, `DistribuzioneConfigDTO`, parse giorni.

- [ ] **Step 1: Schema Prisma** — in `schema.prisma`:
  - enum `PraticaStato`: aggiungi `IN_DISTRIBUZIONE` (dopo `IN_ESCALATION`).
  - model `Pratica`: aggiungi `raggioCorrenteM Int?`, `ultimaEspansioneAt DateTime?`, `zonaNonCopertaAt DateTime?`.
  - model `PraticaAssegnazione`: aggiungi `raggioMetri Int @default(0)`.
  - nuovi modelli:
```prisma
model DistribuzioneConfig {
  id            String   @id @default("singleton")
  raggioStartM  Int      @default(500)
  stepM         Int      @default(200)
  raggioMaxM    Int      @default(10000)
  intervalloMin Int      @default(10)
  orarioInizio  String   @default("09:00")
  orarioFine    String   @default("19:00")
  giorni        String   @default("LUN,MAR,MER,GIO,VEN")
  updatedAt     DateTime @updatedAt
  @@map("distribuzione_config")
}

model RoadDistanceCache {
  id         String   @id @default(uuid()) @db.Uuid
  praticaId  String   @db.Uuid
  sedeId     String   @db.Uuid
  distanzaM  Int
  computedAt DateTime @default(now())
  @@unique([praticaId, sedeId])
  @@index([praticaId])
  @@map("road_distance_cache")
}
```

- [ ] **Step 2: Migration SQL a mano** — `migration.sql`:
```sql
ALTER TYPE "PraticaStato" ADD VALUE IF NOT EXISTS 'IN_DISTRIBUZIONE';
ALTER TABLE "pratiche"
  ADD COLUMN "raggioCorrenteM" INTEGER,
  ADD COLUMN "ultimaEspansioneAt" TIMESTAMP(3),
  ADD COLUMN "zonaNonCopertaAt" TIMESTAMP(3);
ALTER TABLE "pratiche_assegnazioni"
  ADD COLUMN "raggioMetri" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "distribuzione_config" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "raggioStartM" INTEGER NOT NULL DEFAULT 500,
  "stepM" INTEGER NOT NULL DEFAULT 200,
  "raggioMaxM" INTEGER NOT NULL DEFAULT 10000,
  "intervalloMin" INTEGER NOT NULL DEFAULT 10,
  "orarioInizio" TEXT NOT NULL DEFAULT '09:00',
  "orarioFine" TEXT NOT NULL DEFAULT '19:00',
  "giorni" TEXT NOT NULL DEFAULT 'LUN,MAR,MER,GIO,VEN',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribuzione_config_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "road_distance_cache" (
  "id" UUID NOT NULL,
  "praticaId" UUID NOT NULL,
  "sedeId" UUID NOT NULL,
  "distanzaM" INTEGER NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "road_distance_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "road_distance_cache_praticaId_sedeId_key" ON "road_distance_cache"("praticaId","sedeId");
CREATE INDEX "road_distance_cache_praticaId_idx" ON "road_distance_cache"("praticaId");
INSERT INTO "distribuzione_config" ("id","updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
```
  Nota: `ALTER TYPE … ADD VALUE` non può stare in transazione con usi successivi dello stesso enum → tenerlo come **prima** statement isolata (Prisma esegue le migration statement-by-statement; se dà errore, splittare in due file `…_a`/`…_b`).

- [ ] **Step 3: Applica migration (locale)** — `cd packages/db`; `pnpm prisma migrate deploy`; poi `pnpm prisma generate`. Verifica: nessun drift, tabelle create, riga singleton presente.

- [ ] **Step 4: Test config (fallisce)** — `config.test.ts`: mock del client Prisma che ritorna una riga `distribuzione_config` → `getDistribuzioneConfig()` mappa i campi e fa `parseGiorni('LUN,MAR')→['LUN','MAR']`; se la tabella è vuota ritorna `DISTRIBUZIONE_DEFAULT`. Run: FAIL (modulo assente).

- [ ] **Step 5: Implementa `config.ts`** — `DISTRIBUZIONE_DEFAULT`, `parseGiorni`, `getDistribuzioneConfig(tx?)` che legge `findFirst` su `distribuzioneConfig` (fallback default se null), cache in-modulo con TTL breve (pattern `getTariffarioCorrente`). Tipi `DistribuzioneConfigDTO`.

- [ ] **Step 6: Test verde + commit** — `pnpm vitest run config.test.ts`; `pnpm typecheck`. Commit: `feat(distribuzione): schema v2 + config DB (migration + accessor)`.

---

### Task 2: Orario piattaforma

**Files:**
- Create: `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.ts`
- Test: `apps/piattaforma/src/lib/distribuzione/orario-piattaforma.test.ts`

**Interfaces:**
- Consumes: `DistribuzioneConfigDTO`; primitive di `ore-lavorative.ts` (`GiornoSettimana`, parse HH:MM).
- Produces: `isOrarioLavorativo(now, cfg): boolean`.

- [ ] **Step 1: Test (fallisce)** — casi: mercoledì 10:00 (LUN-VEN 9-19) → true; mercoledì 20:00 → false; mercoledì 08:59 → false; sabato 10:00 → false; bordo 09:00 → true, 19:00 → false (fine esclusa). Config con `giorni` che include SAB → sabato true. Usa date fisse costruite in-test (no `Date.now()`).

- [ ] **Step 2: Implementa** — `isOrarioLavorativo(now, cfg)`: giorno-settimana di `now` ∈ `cfg.giorni`; minuti-del-giorno di `now` ∈ `[parse(orarioInizio), parse(orarioFine))`. Riusa `GiornoSettimana`/mapping da `ore-lavorative.ts`. Puro, nessun DB.

- [ ] **Step 3: Verde + commit** — vitest + typecheck. Commit: `feat(distribuzione): gate orario lavorativo piattaforma`.

---

### Task 3: Servizio distanza stradale + provider

**Files:**
- Create: `apps/piattaforma/src/lib/geo/road-distance.ts`, `providers/distance-google.ts`, `providers/distance-mock.ts`
- Test: `apps/piattaforma/src/lib/geo/road-distance.test.ts`

**Interfaces:**
- Consumes: `distanceKm` (Haversine, `lib/geo/coords.ts`); Prisma `roadDistanceCache`.
- Produces: `roadDistancesM(praticaId, origin, dests, tx?): Promise<Map<sedeId, number>>` (metri), `RoadDistanceProvider`, `getDistanceProvider()`.

- [ ] **Step 1: Test (fallisce)** — con provider **mock** iniettato:
  - cache miss → chiama provider → risultati scritti in `roadDistanceCache` → mappa completa.
  - cache hit → nessuna chiamata provider per le sedi già cachate.
  - provider lancia (simula API down) → `roadDistancesM` NON lancia; ritorna Haversine*1000 (metri) per i mancanti; **nessuna scrittura in cache** per i fallback.
  - `dests` vuoto → mappa vuota, nessuna chiamata.
  Mock Prisma per `roadDistanceCache.findMany/createMany`. Run: FAIL.

- [ ] **Step 2: Provider interface + mock** — `RoadDistanceProvider.distances(origin, dests)`. `MockProvider`: ritorna `Haversine(origin,coord)*1000` arrotondato (metri) per ogni dest.

- [ ] **Step 3: Google provider** — `GoogleDistanceMatrixProvider`: batch dest ≤25/richiesta a `https://maps.googleapis.com/maps/api/distancematrix/json` (`origins`, `destinations`, `key`, `mode=driving`), parse `rows[0].elements[].distance.value` (metri); elementi `status!='OK'` → omessi dalla mappa (→ chi manca ricade su Haversine a monte). Timeout esplicito (es. `AbortController` 8s). Key: `process.env.GOOGLE_DISTANCE_MATRIX_API_KEY ?? process.env.GOOGLE_GEOCODING_API_KEY`.

- [ ] **Step 4: `getDistanceProvider()`** — `DISTANCE_PROVIDER==='google'` **e** key presente → Google; altrimenti Mock. Default (dev/test) Mock.

- [ ] **Step 5: `roadDistancesM`** — legge cache (`findMany` per `praticaId`+`sedeId in`), per i mancanti chiama `provider.distances` in **try/catch**: successo → `createMany` in cache + merge; errore o sedi non ritornate → Haversine*1000 transitorio (no cache). Ritorna mappa `sedeId→metri` per tutte le `dests`.

- [ ] **Step 6: Verde + commit** — vitest + typecheck. Commit: `feat(geo): distanza stradale ibrida (Google + cache + fail-open Haversine)`.

---

### Task 4: Notifica broker "zona non coperta" (N52)

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (+ tipo nel registry) e i tipi payload
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts`

**Interfaces:**
- Produces: tipo notifica `N52_BROKER_ZONA_NON_COPERTA` con payload `{ codicePratica, targa, nomeBroker, raggioMaxKm }`, template email (subject + body via `layout.ts`).

- [ ] **Step 1: Verifica numero libero** — grep `N5` in `templates.ts`/schema per confermare che `N52` non è già usato (N50/N51 = monitoraggio). Se occupato, usa il primo libero e aggiorna il piano nel brief.

- [ ] **Step 2: Test (fallisce)** — il template N52 rende subject e body contenenti `codicePratica` e il raggio in km; passa per `layout.ts` (istituzionale). Assert su presenza campi e assenza di HTML non-escaped nei campi utente (coerente coi template esistenti).

- [ ] **Step 3: Implementa** — aggiungi il tipo al registry notifiche (stesso pattern di `N11_BROKER_ESCALATION`), payload tipizzato, funzione template. Testo: "Nessuna agenzia disponibile entro N km dal luogo indicato per la pratica X. Puoi contattare direttamente un'agenzia di fiducia; la richiesta resta comunque attiva."

- [ ] **Step 4: Verde + commit** — vitest + typecheck. Commit: `feat(notifiche): N52 broker zona non coperta`.

---

### Task 5: Logica pura selezione anello (`anelli.ts`)

**Files:**
- Create: `apps/piattaforma/src/lib/distribuzione/anelli.ts`
- Test: `apps/piattaforma/src/lib/distribuzione/anelli.test.ts`

**Interfaces:**
- Consumes: `DistribuzioneConfigDTO`, `SedeConDistanza`.
- Produces: `prossimoAnello(sediInMaxRaggio, raggioCorrenteM, cfg): ProssimoAnello`.

- [ ] **Step 1: Test (fallisce)** — dato `cfg` default (start 500, step 200, max 10000):
  - `raggioCorrente=500`, sede a 650m → `{tipo:'notifica', raggioRaggiuntoM:700, sedi:[650]}` (700 è il primo anello che la include).
  - anello vuoto poi pieno: sede unica a 1150m, `raggioCorrente=500` → skippa 700,900,1100 (vuoti) e ritorna `raggioRaggiuntoM:1300` con quella sede (1300 ≥ 1150). Cioè avanza a step finché l'anello contiene ≥1 sede non contattata.
  - nessuna sede entro max: `sediInMaxRaggio=[]` → `{tipo:'zona-non-coperta', raggioRaggiuntoM: raggioMaxM}`.
  - `raggioCorrente` già a `raggioMaxM` con sedi residue oltre → non può avanzare → zona-non-coperta.
  Puro, nessun DB/Date.

- [ ] **Step 2: Implementa** —
```ts
export function prossimoAnello(sedi, raggioCorrenteM, cfg): ProssimoAnello {
  let raggio = raggioCorrenteM;
  while (raggio < cfg.raggioMaxM) {
    raggio = Math.min(raggio + cfg.stepM, cfg.raggioMaxM);
    const inRing = sedi.filter((s) => s.distanzaM <= raggio); // 'sedi' già escl. contattate
    if (inRing.length > 0) return { tipo: 'notifica', raggioRaggiuntoM: raggio, sedi: inRing };
  }
  return { tipo: 'zona-non-coperta', raggioRaggiuntoM: cfg.raggioMaxM };
}
```
  (Le `sedi` in input sono già solo le non-contattate con `distanzaM ≤ raggioMaxM`; l'espansione a step garantisce l'anello incrementale.)

- [ ] **Step 3: Verde + commit** — vitest + typecheck. Commit: `feat(distribuzione): logica pura selezione anello incrementale`.

---

### Task 6: Riscrittura motore `tick.ts`

**Files:**
- Rewrite: `apps/piattaforma/src/lib/distribuzione/tick.ts`
- Rewrite: `apps/piattaforma/src/lib/distribuzione/tick.test.ts`

**Interfaces:**
- Consumes: `getDistribuzioneConfig`, `isOrarioLavorativo`, `roadDistancesM`, `prossimoAnello`, `sediDaEscludere`, `distanceKm`, `limiteVisuraUtc`, N6 emit + `eventoNuovaPratica` (invariati), N52 (Task 4), `logCambioStato`.
- Produces: `tickPratica(praticaId)`, `avviaRing1ForPratica(praticaId)`, `tickAllPraticheInDistribuzione()`. Rimuove `avviaRound`/`escalatePratica`/`riarmaPendingScadute`.

- [ ] **Step 1: Test (fallisce)** — riscrivi `tick.test.ts`. Casi (mock Prisma + provider mock + orario forzato):
  - fuori orario → `noop('fuori orario')`, nessuna scrittura.
  - in orario, `ultimaEspansioneAt` 3 min fa → `noop('finestra 10min')`.
  - in orario, gate passato, anello successivo con sedi → crea assegnazioni (`raggioMetri` = raggio raggiunto, `esito PENDING`), aggiorna `raggioCorrenteM`/`ultimaEspansioneAt`, coda N6.
  - anelli vuoti intermedi → skip, `raggioCorrenteM` avanza fino al primo non vuoto senza toccare `ultimaEspansioneAt` per gli skip.
  - nessuna sede fino a max → `zonaNonCopertaAt` set + coda N52; PENDING preesistenti restano.
  - pratica già `ACCETTATA`/terminale → closed/noop.
  - pratica senza `lat/lng` → zona non coperta (guardia, non crash).

- [ ] **Step 2: `tickPratica`** — transazione:
  1. carica pratica (+assegnazioni) e `cfg = getDistribuzioneConfig(tx)`.
  2. terminale/accettata → return closed/noop; stato ≠ `IN_DISTRIBUZIONE` → noop; `zonaNonCopertaAt` set → noop; coord mancanti → zona non coperta.
  3. `if (!isOrarioLavorativo(now, cfg)) return noop('fuori orario')`.
  4. `if (ultimaEspansioneAt && minuti(now-ultimaEspansioneAt) < cfg.intervalloMin) return noop('finestra 10min')`.
  5. costruisci candidati: `sediIdonee` (query invariata: AGENZIA, non deleted/suspended, coord non null, company ok visura/blocco, `id notIn sediDaEscludere`) → prefiltro `distanceKm(origine,sede) ≤ raggioMaxM` → `roadDistancesM` → `SedeConDistanza[]` con `distanzaM ≤ raggioMaxM`.
  6. `res = prossimoAnello(candidati, raggioCorrenteM ?? cfg.raggioStartM, cfg)`.
  7. `notifica` → crea assegnazioni (`raggioMetri = res.raggioRaggiuntoM`), `pratica.update({ raggioCorrenteM: res.raggioRaggiuntoM, ultimaEspansioneAt: now })`, `logCambioStato(ROUND_ADVANCE, meta:{raggioM})`, jobs N6.
  8. `zona-non-coperta` → `pratica.update({ raggioCorrenteM: cfg.raggioMaxM, zonaNonCopertaAt: now })`, log, job N52.
  - post-commit: N6 + eventi modale (riusa `emitN6ForAssegnazioni`), N52 broker.

- [ ] **Step 3: `avviaRing1ForPratica`** — submit: transazione: `stato=IN_DISTRIBUZIONE`, `raggioCorrenteM=cfg.raggioStartM`; candidati come sopra ma soglia `= raggioStartM`; se sedi → crea assegnazioni (`raggioMetri=raggioStartM`), `ultimaEspansioneAt=now`, jobs N6; se nessuna → nessuna notifica, `ultimaEspansioneAt=null` (il primo tick espande). **Ignora `isOrarioLavorativo`.** Log `SUBMIT`.

- [ ] **Step 4: `tickAllPraticheInDistribuzione`** — `findMany` where `stato='IN_DISTRIBUZIONE'`, `zonaNonCopertaAt: null`, `deletedAt: null`, `take` ragionevole (paginazione difensiva, es. 500); loop `tickPratica`. Counters.

- [ ] **Step 5: Verde** — `pnpm vitest run tick.test.ts`; `pnpm typecheck`.

- [ ] **Step 6: Query reale** — esegui in read-only sul DB locale la query candidati con una pratica reale (memoria: query nuove vanno provate sul DB reale) e verifica che non esploda e usi gli indici.

- [ ] **Step 7: Commit** — `feat(distribuzione): motore espansione raggio incrementale + zona non coperta`.

---

### Task 7: Wiring submit pratica

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`
- Test: aggiorna `apps/piattaforma/src/app/pratiche/nuova/actions.coords.test.ts` (o affine)

**Interfaces:**
- Consumes: `avviaRing1ForPratica` (Task 6).

- [ ] **Step 1: Individua** il punto attuale che chiama `avviaRound1ForPratica` (o imposta lo stato di distribuzione al submit) e i test relativi.
- [ ] **Step 2: Test (fallisce)** — dopo submit valido con coord, la pratica risulta `IN_DISTRIBUZIONE` con `raggioCorrenteM=500` e viene invocato ring1 (mock). Submit senza coord → errore di validazione invariato.
- [ ] **Step 3: Implementa** — sostituisci la chiamata con `avviaRing1ForPratica`; assicurati che lo stato al submit sia `IN_DISTRIBUZIONE` (non `IN_ATTESA_ROUND_1`).
- [ ] **Step 4: Verde + commit** — vitest + typecheck. Commit: `feat(pratiche): submit avvia distribuzione v2 (ring1 immediato)`.

---

### Task 8: Accettazione con lock pessimistico

**Files:**
- Modify: `apps/piattaforma/src/app/inbox/actions.ts` (`acceptPratica`)
- Test: `apps/piattaforma/src/app/inbox/actions.authz.test.ts` (+ eventuale nuovo test lock)

**Interfaces:**
- Consumes: nulla di nuovo; usa `$queryRaw` per il lock.

- [ ] **Step 1: Test (fallisce)** — (a) accept su pratica `IN_DISTRIBUZIONE` PENDING per la propria sede → ACCETTATA, altre PENDING → ASSEGNATA_ALTRO, pratica ACCETTATA. (b) pratica in stato non-distribuzione → "non più in distribuzione". Il lock in sé è difficile da unit-testare (race reale); asserire almeno che la query FOR UPDATE viene eseguita (spy sul `$queryRaw`) e che il check stato usa `IN_DISTRIBUZIONE`.
- [ ] **Step 2: Implementa** — a inizio `$transaction`, prima del `findFirst`:
```ts
await tx.$queryRaw`SELECT id FROM "pratiche" WHERE id = ${praticaId}::uuid FOR UPDATE`;
```
  e cambia il check stato da `IN_ATTESA_ROUND_1/2/3` a `stato !== 'IN_DISTRIBUZIONE'` → "Pratica non più in distribuzione".
- [ ] **Step 3: Verde + commit** — vitest + typecheck. Commit: `fix(inbox): accept con lock FOR UPDATE (primo atomico) + stato IN_DISTRIBUZIONE`.

---

### Task 9: Consumer dello stato (stati/tabs/monitoraggio)

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/stati.ts`, `apps/piattaforma/src/lib/pratiche/tabs.ts`
- Modify: `apps/piattaforma/src/components/ui/status-chip.tsx` (union `PraticaStato` duplicata a mano + mappa `styles` per-stato → va aggiunto `IN_DISTRIBUZIONE` + reso difensivo)
- Modify: `apps/piattaforma/src/app/admin/monitoraggio/*` (page/data/label)
- Test: `apps/piattaforma/src/lib/pratiche/stati.test.ts`, `tabs.test.ts` (+ monitoraggio se presente); test/verifica `status-chip`
- **Vincolo:** al termine di questo task **la suite INTERA deve tornare verde** (i 3 fail in `stati.test.ts` introdotti dal Task 1 vanno chiusi qui).

**Interfaces:**
- Consumes: enum `IN_DISTRIBUZIONE` (da `@pv/db`).

- [ ] **Step 1: Test (fallisce)** — `stati.ts`/`tabs.ts`: `IN_DISTRIBUZIONE` classificato come "in corso / in distribuzione" (stesso gruppo dei vecchi ROUND). Ogni nuovo valore enum va classificato (memoria: fonte unica `stati.ts` → il test di esaustività è già rosso dal Task 1, deve tornare verde). Monitoraggio: pratiche `IN_DISTRIBUZIONE` compaiono tra le "in distribuzione"; `zonaNonCopertaAt` mostrata con etichetta dedicata.
- [ ] **Step 2: `stati.ts`/`tabs.ts`** — aggiungi `IN_DISTRIBUZIONE` alle mappe/label (fonte unica). Mantieni i 3 ROUND legacy (difensivo).
- [ ] **Step 3: `status-chip.tsx` (bug-fix di correttezza)** — `components/ui/status-chip.tsx` ha una union `PraticaStato` duplicata (10 literal) e `styles[stato].cls`: con l'enum a 11 valori, una pratica `IN_DISTRIBUZIONE` renderizzerebbe `styles['IN_DISTRIBUZIONE'].cls` → `undefined.cls` → **TypeError** su ~8 pagine (pratiche/inbox/dashboard/admin). Fix: (a) aggiungi la voce di stile per `IN_DISTRIBUZIONE` (+ etichetta/colore coerenti col gruppo "in distribuzione", token `pv-*`); (b) rendi la lookup **difensiva** — `const s = styles[stato] ?? NEUTRAL` — così un futuro enum non classificato degrada a chip neutro invece di crashare. Preferibile derivare la union da `@pv/db` (`PraticaStato`) per intercettare a compile-time i prossimi valori. Test: rendering con `IN_DISTRIBUZIONE` → chip valido (no throw); stato ignoto → chip neutro.
- [ ] **Step 4: Monitoraggio** — filtro/etichetta "Zona non coperta" per `zonaNonCopertaAt != null`; label leggibile per lo stato `IN_DISTRIBUZIONE`.
- [ ] **Step 5: Verde intero + commit** — `pnpm vitest run` (SUITE COMPLETA verde, i 3 fail di `stati.test.ts` chiusi) + typecheck. Commit: `feat(pratiche): classifica IN_DISTRIBUZIONE (stati/tabs/chip/monitoraggio) + zona non coperta`.

---

### Task 10: Config admin distribuzione

**Files:**
- Create: `apps/piattaforma/src/app/admin/distribuzione/page.tsx`, `actions.ts`
- Modify: `apps/piattaforma/src/app/admin/admin-shell.tsx` (voce nav)
- Test: `apps/piattaforma/src/app/admin/distribuzione/actions.test.ts`

**Interfaces:**
- Consumes: `getDistribuzioneConfig`; permessi admin (super-admin, come `/admin/tariffe`/`monitoraggio`).

- [ ] **Step 1: Test (fallisce)** — l'action `salvaConfigDistribuzione` richiede permesso admin; valida `raggioMaxM` (es. 500..50000, multiplo/positivo) con `noValidate` + field-errors pattern; scrive la riga singleton (`upsert` id `singleton`); invalida la cache config.
- [ ] **Step 2: Implementa page** — form con `raggioMaxM` editabile (gli altri campi read-only o editabili opzionali), pattern `components/forms/` (useFieldErrorsState, mai rossi all'apertura, SubmitButton con spinner). Rispetta design system.
- [ ] **Step 3: Implementa action** — gate permesso, zod, `upsert`, invalida cache di `getDistribuzioneConfig`, `revalidatePath`.
- [ ] **Step 4: Nav** — voce in `admin-shell.tsx` (NAV_GROUPS) verso `/admin/distribuzione` (evita pagina orfana — memoria).
- [ ] **Step 5: Verde + commit** — vitest + typecheck. Commit: `feat(admin): configurazione raggio distribuzione`.

---

### Task 11: Modale "nuova pratica" pulsante

**Files:**
- Modify: componente modale evento nuova-pratica (individua via `eventoNuovaPratica`/`tipi.ts` consumer, lato client)
- Test: se esiste test del componente, aggiorna; altrimenti verifica visiva (nota nel report)

**Interfaces:**
- Nessuna nuova interfaccia.

- [ ] **Step 1: Individua** il componente client che apre la modale dagli `EventoPratica` tipo nuova-pratica (watcher eventi 10s).
- [ ] **Step 2: Implementa** — animazione pulsante (glow/scale) sulla modale e/o sul bottone "Accetta". Solo token `pv-*` (no colori hardcoded). Usa `motion-safe:` per rispettare `prefers-reduced-motion`. Keyframe in `tailwind.config`/CSS globale se serve una pulsazione custom oltre `animate-pulse`.
- [ ] **Step 3: Verifica browser** — la pulsazione è visibile e non rompe il layout/focus (memoria: bug React visibili solo nel browser). Annota nel report.
- [ ] **Step 4: Commit** — `feat(inbox): modale nuova pratica pulsante per invogliare l'accettazione`.

---

### Task 12: Cleanup codice morto

**Files:**
- Delete: `apps/piattaforma/src/lib/distribuzione/auto-suspend.ts` (+ eventuale test)
- Modify: `apps/piattaforma/src/lib/distribuzione/constants.ts` (rimuovi `DISTRIBUZIONE`, `ANTI_ABUSO`; tieni `RANKING` se usato), `index.ts`
- Modify: eventuali residui countdown 4h non più referenziati

**Interfaces:** nessuna (solo rimozioni).

- [ ] **Step 1: Grep usi** — verifica che `auto-suspend`, `ANTI_ABUSO`, `DISTRIBUZIONE` (costanti), `riarmaPendingScadute`, `computeCountdown` (se orfano) non siano più referenziati dopo i task precedenti. `checkAutoSuspendForSedi` non deve avere più call-site.
- [ ] **Step 2: Rimuovi** i file/simboli orfani. Se `countdown.ts` resta usato solo da codice morto, rimuovilo; `ore-lavorative.ts` resta (riusato da orario piattaforma).
- [ ] **Step 3: Verde** — `pnpm typecheck` (0 errori: prova che non ci sono riferimenti pendenti), `pnpm vitest run` (suite intera verde), build.
- [ ] **Step 4: Commit** — `refactor(distribuzione): rimuovi auto-suspend no-show + costanti/countdown morti`.

---

## Self-Review (autore piano)

- **Copertura spec:** stato unico (T1,T8,T9), config DB (T1,T10), orario (T2,T6), distanza ibrida+fail-open (T3,T6), selezione anello/skip (T5,T6), zona non coperta+N52 (T4,T6,T9), accept lock (T8), submit ring1 (T7), modale pulsante (T11), cleanup auto-suspend/countdown (T12). ✅
- **Interfacce coerenti:** `DistribuzioneConfigDTO`, `SedeConDistanza`, `ProssimoAnello`, `roadDistancesM`, `isOrarioLavorativo`, `prossimoAnello` definite in "Global naming" e consumate coi nomi identici nei task. ✅
- **No placeholder:** ogni step ha file esatti, SQL/codice per le parti non banali, casi di test concreti. ✅
- **Ordine dipendenze:** T1→(T2,T3,T4,T5)→T6→(T7,T8)→T9→T10→T11→T12. ✅
- **Rischi noti:** `ALTER TYPE ADD VALUE` in migration (Step T1.2) può richiedere split in due statement/file; il lock FOR UPDATE non è unit-testabile a fondo (asserire l'esecuzione, race verificata in review); modale/pulsazione richiede verifica browser.
