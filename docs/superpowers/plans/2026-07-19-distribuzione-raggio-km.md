# Distribuzione pratiche a raggio-km — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribuire una nuova pratica alle agenzie in base a un raggio-km reale dalle coordinate del luogo scelto (Google autocomplete), con raggi 2/5/10 km su round 1/2/3, tutte le sedi nell'anello, anelli incrementali e cascade su anello vuoto.

**Architecture:** Le coordinate arrivano già dall'autocomplete e vengono persistite su `Pratica.lat/lng`. Il motore `avviaRound` (`lib/distribuzione/tick.ts`) è riscritto: seleziona le sedi agenzia idonee **con coordinate**, calcola la distanza Haversine e prende **tutte** quelle entro il raggio del round (no cap, no ranking-selection); gli anelli incrementali nascono dall'esclusione delle già contattate; un anello vuoto avanza subito al raggio successivo, fino a escalation. La distribuzione per provincia (`province-limitrofe.ts`) è rimossa.

**Tech Stack:** Next.js 16 (App Router, RSC + client wizard), Prisma + Postgres, TypeScript, Vitest, pnpm/Turborepo, Google Places (autocomplete già integrato).

## Global Constraints

- Node: `nvm use 22.15.0` prima di ogni comando pnpm. Se `node: not found` persiste, usare il path reale della versione: `export PATH="/c/Users/fsiol/AppData/Local/nvm/v22.15.0:$PATH"`.
- Migration **a mano** (file SQL) + `pnpm --filter @pv/db db:deploy` sul DB **locale** (mai `pnpm db:migrate`, distruttivo). Dopo lo schema: `pnpm db:generate`. Il `.env` di `packages/db` punta al locale.
- Test: `pnpm --filter piattaforma test <path>` (vitest run; NON typecheck). Typecheck warm: `pnpm --filter piattaforma typecheck`.
- Solo commit locali, **nessun push** (main è avanti a origin con lavoro non deployabile).
- Distanze in km (Float, Haversine R=6371). Colori solo `pv-*` (no hardcoded).
- **Precondizione operativa:** la distribuzione a raggio richiede `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` presente (in prod c'è): senza, lo step luogo non produce coordinate e il submit è bloccato (per scelta: nessun fallback provincia).
- `comune`/`provincia` sulla Pratica **restano** (notifiche/monitoraggio); non guidano più la distribuzione.

---

## File Structure

- `apps/piattaforma/src/lib/geo/coords.ts` — nuovo `distanceKm` (Haversine).
- `packages/db/prisma/schema.prisma` + migration — `Pratica.lat/lng`.
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — zod richiede lat/lng, salva su create.
- `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — cattura coord dall'autocomplete, append FormData, blocco submit.
- `apps/piattaforma/src/lib/distribuzione/constants.ts` — `RAGGI_KM`, finestre; via cap.
- `apps/piattaforma/src/lib/distribuzione/tick.ts` — riscrittura `avviaRound` (raggio + cascade) + adattamento chiamanti.
- `apps/piattaforma/src/lib/distribuzione/province-limitrofe.ts` (+ test) — rimossi.
- `apps/piattaforma/src/app/admin/sedi-non-geocodate/page.tsx` — visibilità admin.
- Test affiancati.

---

## Task 1: Helper `distanceKm` (Haversine)

**Files:**
- Modify: `apps/piattaforma/src/lib/geo/coords.ts`
- Test: `apps/piattaforma/src/lib/geo/coords.test.ts`

**Interfaces:**
- Produces: `distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number` — distanza in km.

- [ ] **Step 1: Test che fallisce**

Aggiungere in `coords.test.ts`:

```ts
import { distanceKm } from './coords';

describe('distanceKm', () => {
  it('0 su punto identico', () => {
    expect(distanceKm({ lat: 45, lng: 9 }, { lat: 45, lng: 9 })).toBe(0);
  });
  it('simmetrica', () => {
    const a = { lat: 45.4642, lng: 9.19 }; // Milano
    const b = { lat: 45.0703, lng: 7.6869 }; // Torino
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 6);
  });
  it('Milano–Torino ~ 126 km (±3)', () => {
    const d = distanceKm({ lat: 45.4642, lng: 9.19 }, { lat: 45.0703, lng: 7.6869 });
    expect(d).toBeGreaterThan(123);
    expect(d).toBeLessThan(129);
  });
  it('~1 km a piccola scala', () => {
    // ~0.009° di latitudine ≈ 1 km
    const d = distanceKm({ lat: 45.0, lng: 9.0 }, { lat: 45.009, lng: 9.0 });
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
  });
});
```

- [ ] **Step 2: Lancia → fallisce**

Run: `pnpm --filter piattaforma test src/lib/geo/coords.test.ts`
Expected: FAIL (`distanceKm is not a function`).

- [ ] **Step 3: Implementa**

In `coords.ts` (in fondo, resta puro/browser-safe):

```ts
/** Distanza in km tra due coordinate (Haversine, R=6371 km). */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

- [ ] **Step 4: Lancia → passa**

Run: `pnpm --filter piattaforma test src/lib/geo/coords.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/geo/coords.ts apps/piattaforma/src/lib/geo/coords.test.ts
git commit -m "feat(geo): distanceKm (Haversine)"
```

---

## Task 2: Schema `Pratica.lat/lng` + migration + client

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (modello `Pratica`, vicino a `comune`/`provincia`)
- Create: `packages/db/prisma/migrations/20260719130000_pratica_coordinate/migration.sql`

**Interfaces:**
- Produces: `Pratica.lat: Float?`, `Pratica.lng: Float?` sul client Prisma.

- [ ] **Step 1: Schema**

Nel modello `Pratica`, accanto ai campi di localizzazione (`comune`/`provincia`), aggiungere:

```prisma
  // Coordinate del luogo di consegna (Google Places autocomplete). Nullable:
  // le bozze non le hanno; valorizzate al submit (obbligatorie lato action).
  // Guidano la distribuzione a raggio (lib/distribuzione). comune/provincia
  // restano come metadati (notifiche/monitoraggio) ma non guidano più la scelta.
  lat Float?
  lng Float?
```

- [ ] **Step 2: Migration a mano**

Creare `packages/db/prisma/migrations/20260719130000_pratica_coordinate/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "pratiche" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "pratiche" ADD COLUMN "lng" DOUBLE PRECISION;
```

Nota: verificare il nome tabella reale del modello `Pratica` (`@@map`). Se non è `"pratiche"`, usare quello corretto (controllare `@@map` nel modello prima di scrivere l'SQL).

- [ ] **Step 3: Applica in locale + rigenera**

Run:
```bash
nvm use 22.15.0
pnpm --filter @pv/db db:deploy
pnpm db:generate
```
Expected: `Applying migration 20260719130000_pratica_coordinate` senza errori; client rigenerato.

- [ ] **Step 4: Smoke**

Run:
```bash
node -e "const{PrismaClient}=require('./node_modules/@prisma/client');const p=new PrismaClient();console.log('lat' in (p.pratica.fields ?? {}))" 2>/dev/null || echo "verifica manuale: campo lat presente nel client"
```
Expected: il comando non deve errorare; in alternativa la verifica reale è il typecheck del Task 3/5 (che usa `pratica.lat`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260719130000_pratica_coordinate/
git commit -m "feat(db): Pratica.lat/lng per la distribuzione a raggio"
```

---

## Task 3: Action — richiede e persiste lat/lng

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (zod schema ~554; `pratica.create` ~1317-1347)
- Test: `apps/piattaforma/src/app/pratiche/nuova/actions.coords.test.ts` (nuovo)

**Interfaces:**
- Consumes: `Pratica.lat/lng` (Task 2), `parseCoords` (esistente in `lib/geo/coords`).
- Produces: submit rifiutato senza coord valide; `Pratica.lat/lng` salvate su create.

- [ ] **Step 1: Test che fallisce**

Il submit parte da `FormData`. Verificare come lo schema legge oggi i campi (probabilmente via un `parse` dello schema zod su un oggetto costruito da `FormData`). Il test valida a livello di **schema zod**: aggiungere due campi `lat`/`lng` (stringhe da FormData) coerced a numero e obbligatori. Creare `actions.coords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { praticaCoordsSchema } from './actions';

describe('coordinate obbligatorie al submit', () => {
  it('accetta lat/lng validi (stringa da FormData)', () => {
    const r = praticaCoordsSchema.safeParse({ lat: '45.4642', lng: '9.19' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ lat: 45.4642, lng: 9.19 });
  });
  it('rifiuta lat/lng mancanti', () => {
    expect(praticaCoordsSchema.safeParse({}).success).toBe(false);
  });
  it('rifiuta valori fuori range', () => {
    expect(praticaCoordsSchema.safeParse({ lat: '999', lng: '9' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Lancia → fallisce**

Run: `pnpm --filter piattaforma test src/app/pratiche/nuova/actions.coords.test.ts`
Expected: FAIL (`praticaCoordsSchema` non esiste).

- [ ] **Step 3: Implementa (schema + persistenza)**

In `actions.ts`:

1. In cima (import), assicurarsi di avere `z` (già presente). Esportare uno schema riusabile per le coordinate, e integrarlo nello schema del submit (accanto a `comune`/`provincia`, ~riga 554):

```ts
// Coordinate del luogo di consegna: obbligatorie al submit (guidano la
// distribuzione a raggio). Da FormData arrivano come stringhe → coerce + range.
export const praticaCoordsSchema = z.object({
  lat: z.coerce.number().refine((n) => n >= -90 && n <= 90, 'lat fuori range'),
  lng: z.coerce.number().refine((n) => n >= -180 && n <= 180, 'lng fuori range'),
});
```

Nello schema principale del submit (l'oggetto zod che contiene `comune`/`provincia`), aggiungere i campi:

```ts
  comune: z.string().trim().min(1).max(100),
  provincia: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  lat: z.coerce.number().refine((n) => n >= -90 && n <= 90, 'lat fuori range'),
  lng: z.coerce.number().refine((n) => n >= -180 && n <= 180, 'lng fuori range'),
```

2. Nella `prisma.pratica.create` (~1318), accanto a `comune: d.comune` (~1347) aggiungere:

```ts
      comune: d.comune,
      provincia: d.provincia,
      lat: d.lat,
      lng: d.lng,
```

(Se il submit costruisce `d` da `FormData`, i campi `lat`/`lng` vanno letti dal FormData come le altre chiavi — vengono aggiunti dal wizard nel Task 4.)

- [ ] **Step 4: Lancia → passa**

Run: `pnpm --filter piattaforma test src/app/pratiche/nuova/actions.coords.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: exit 0 (l'accesso a `d.lat`/`d.lng` e `Pratica.lat/lng` compila).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts apps/piattaforma/src/app/pratiche/nuova/actions.coords.test.ts
git commit -m "feat(pratiche): coordinate obbligatorie al submit + persistenza su Pratica"
```

---

## Task 4: Wizard — cattura coord + blocco submit

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (state ~626-628; onSelect luogo ~2750; FormData ~1599; validazione submit)

**Interfaces:**
- Consumes: `AddressAutocomplete` (fornisce `p.lat`/`p.lng`), la action (Task 3) che richiede lat/lng.

- [ ] **Step 1: Stato coordinate**

Accanto a `const [comune, setComune] = useState('')` / `provincia` (~626-627), aggiungere:

```tsx
  const [luogoCoords, setLuogoCoords] = useState<{ lat: number; lng: number } | null>(null);
```

- [ ] **Step 2: Cattura nell'onSelect del luogo**

Nel campo luogo (~2750), estendere l'`onSelect` per salvare anche le coordinate:

```tsx
                    onSelect={(p) => {
                      if (p.citta) setComune(p.citta);
                      if (p.provincia) setProvincia(p.provincia);
                      setLuogoCoords(
                        typeof p.lat === 'number' && typeof p.lng === 'number'
                          ? { lat: p.lat, lng: p.lng }
                          : null,
                      );
                    }}
```

- [ ] **Step 3: Append alla FormData**

Dove si appendono `comune`/`provincia` (~1599-1600), aggiungere:

```tsx
    fd.append('comune', comune);
    fd.append('provincia', provincia);
    if (luogoCoords) {
      fd.append('lat', String(luogoCoords.lat));
      fd.append('lng', String(luogoCoords.lng));
    }
```

- [ ] **Step 4: Blocco submit senza coordinate**

Nella funzione di submit, PRIMA di costruire la FormData (dove ci sono già le altre guardie tipo `docsPronti`), aggiungere una guardia sulle coordinate e un avviso all'utente (usare lo stesso meccanismo di avviso già presente, es. `avvisaMancanze` / lo stato errori del wizard):

```tsx
    if (!luogoCoords) {
      // Senza selezione dall'autocomplete non abbiamo coordinate → la
      // distribuzione a raggio non può partire. Chiediamo di selezionare il luogo.
      avvisaMancanze(['Seleziona il luogo dall’elenco (serve per assegnare le agenzie più vicine).']);
      return;
    }
```

(Adattare `avvisaMancanze`/messaggistica al pattern reale del wizard per gli avvisi di step. Il punto: submit interrotto con messaggio chiaro se `luogoCoords` è null.)

Nota `!hasMaps`: nel ramo senza chiave Maps (input manuali comune/provincia) NON si ottengono coordinate → la guardia sopra blocca il submit. In prod la chiave c'è; in dev senza chiave il flusso pratica non è completabile (atteso, coord obbligatorie). Se serve, mostrare nel ramo `!hasMaps` un avviso "servizio mappe non disponibile: impossibile creare la pratica senza selezione del luogo".

- [ ] **Step 5: Verifica browser**

Run: `nvm use 22.15.0 && pnpm --filter piattaforma dev`, login broker, wizard nuova pratica fino allo step luogo:
- selezionando un comune dall'autocomplete → il submit prosegue e la pratica viene creata con lat/lng (verificabile in `/wallet`? no → via query DB, vedi Task 8, o log);
- senza selezionare (campo vuoto) → submit bloccato col messaggio.

Expected: coord catturate e salvate; blocco senza selezione. (Verifica loggata completa in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): cattura coordinate luogo dall'autocomplete + blocco submit"
```

---

## Task 5: Motore — `avviaRound` a raggio + cascade

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/constants.ts`
- Modify: `apps/piattaforma/src/lib/distribuzione/tick.ts` (`avviaRound`, chiamanti `tickPratica`/`avviaRound1ForPratica`, rimozione `handleNoCandidates`)
- Test: `apps/piattaforma/src/lib/distribuzione/tick.test.ts` (estendere/adeguare)

**Interfaces:**
- Consumes: `distanceKm` (Task 1), `Pratica.lat/lng` (Task 2), `sediDaEscludere` (esistente).
- Produces: `avviaRound(tx, pratica, round)` con `pratica` che include `lat`/`lng`, ritorno `{ count, newAssegnazioniIds, escalated, round }` (nuovo campo `round` = round effettivamente assegnato, o 3 se escalation).

- [ ] **Step 1: Costanti**

In `constants.ts`, sostituire il blocco `DISTRIBUZIONE`:

```ts
export const DISTRIBUZIONE = {
  RAGGI_KM: [2, 5, 10] as const, // raggi round 1 / 2 / 3 (km)
  T1_HOURS: 8, // finestra round 1
  T2_HOURS: 8, // finestra round 2
  T3_HOURS: 8, // finestra round 3
} as const;
```

(Rimossi `N_PER_ROUND` e `N_MAX`. `RANKING`/`ANTI_ABUSO` restano invariati.)

- [ ] **Step 2: Test che fallisce (comportamento nuovo)**

In `tick.test.ts` adeguare/aggiungere. Il file mocka già `prisma`/`tx`. Aggiungere casi per `avviaRound` via `avviaRound1ForPratica` (o testando `avviaRound` direttamente se esportata). Casi chiave (usare il pattern di mock già presente nel file — `tx.sede.findMany`, `tx.praticaAssegnazione.create`, `tx.pratica.update`, `loadOrariPerSedi`):

```ts
// Esempio di intento (adattare al mock harness del file):
// 1) round 1: seleziona TUTTE le sedi entro 2 km, nessun cap
//    - sedi a 0.5/1.5/3 km → assegnate solo le due entro 2 km
// 2) esclude le sedi senza coord (lat/lng null non tornano dalla query where)
// 3) cascade: 0 sedi entro 2 km ma 1 entro 5 km → assegna al round 2 (raggio 5)
// 4) escalation: nessuna sede entro 10 km → escalated true, stato IN_ESCALATION
// 5) anello incrementale: le sedi già in sediDaEscludere non sono ricandidate
```

Scrivere almeno i casi 1, 3, 4 come test concreti con assert su `tx.praticaAssegnazione.create` (quante volte, con quali `round`/`sedeId`) e su `tx.pratica.update` (stato). Il filtro distanza si verifica passando sedi mockate con coord note e `pratica.lat/lng` note.

Run: `pnpm --filter piattaforma test src/lib/distribuzione/tick.test.ts`
Expected: FAIL (comportamento vecchio per provincia).

- [ ] **Step 3: Riscrivi `avviaRound`**

In `tick.ts`:

1. Import: rimuovere `provinceLimitrofe`, `attachRating`, `rankCandidates`; aggiungere `distanceKm`:
```ts
import { distanceKm } from '@/lib/geo/coords';
```
Mantenere `sediDaEscludere`, `computeCountdown`, `loadOrariPerSedi`, `limiteVisuraUtc`, `checkAutoSuspendForSedi`, ecc.

2. `ROUND_TO_HOURS` resta invariato (usa T1/T2/T3).

3. Sostituire l'intera funzione `avviaRound` (e RIMUOVERE `handleNoCandidates`) con:

```ts
export async function avviaRound(
  tx: Prisma.TransactionClient,
  pratica: {
    id: string;
    lat: number | null;
    lng: number | null;
    distribuzioneCiclo: number;
    assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
  },
  round: 1 | 2 | 3,
): Promise<{ count: number; newAssegnazioniIds: string[]; escalated: boolean; round: 1 | 2 | 3 }> {
  const now = new Date();
  const sediContattate = sediDaEscludere(pratica);

  // Senza coordinate della pratica non possiamo calcolare distanze → escalation.
  // (Non dovrebbe accadere: il submit le rende obbligatorie; guardia difensiva.)
  if (pratica.lat == null || pratica.lng == null) {
    await tx.pratica.update({
      where: { id: pratica.id },
      data: { stato: 'IN_ESCALATION', escalationAt: now },
    });
    return { count: 0, newAssegnazioniIds: [], escalated: true, round: 3 };
  }
  const origine = { lat: pratica.lat, lng: pratica.lng };

  // Sedi agenzia idonee CON coordinate, non ancora contattate nel ciclo.
  const sediIdonee = await tx.sede.findMany({
    where: {
      type: 'AGENZIA',
      deletedAt: null,
      suspendedAt: null,
      lat: { not: null },
      lng: { not: null },
      id: { notIn: sediContattate },
      company: {
        deletedAt: null,
        suspendedAt: null,
        bloccoPagamentoAt: null,
        OR: [
          { visuraCameraleData: null },
          { visuraCameraleData: { gt: limiteVisuraUtc(now) } },
        ],
      },
    },
    select: { id: true, lat: true, lng: true, companyId: true },
  });

  // Cascade: dal round richiesto fino al 3, il primo anello non vuoto vince
  // (anello incrementale: le sedi dei round precedenti sono già escluse).
  for (let r = round; r <= 3; r++) {
    const raggio = DISTRIBUZIONE.RAGGI_KM[r - 1];
    const inRing = sediIdonee.filter(
      (s) =>
        s.lat != null &&
        s.lng != null &&
        distanceKm(origine, { lat: s.lat, lng: s.lng }) <= raggio,
    );
    if (inRing.length === 0) continue;

    const orariMap = await loadOrariPerSedi(inRing.map((s) => s.id), tx);
    const hours = ROUND_TO_HOURS[r as 1 | 2 | 3];
    const newIds: string[] = [];
    for (const s of inRing) {
      const orari = orariMap.get(s.id) ?? { fasce: {}, chiusure: [] };
      const { inizio, fine } = computeCountdown(now, hours, orari);
      const created = await tx.praticaAssegnazione.create({
        data: {
          praticaId: pratica.id,
          agenziaId: s.companyId, // madre (colonna legacy, NOT NULL)
          sedeId: s.id,
          round: r,
          ciclo: pratica.distribuzioneCiclo,
          esito: 'PENDING',
          invioAt: now,
          countdownInizioAt: inizio,
          countdownFineAt: fine,
        },
      });
      newIds.push(created.id);
    }
    await tx.pratica.update({
      where: { id: pratica.id },
      data: statoPerRound(r as 1 | 2 | 3, now),
    });
    return { count: inRing.length, newAssegnazioniIds: newIds, escalated: false, round: r as 1 | 2 | 3 };
  }

  // Nessuna sede fino a 10 km → escalation.
  await tx.pratica.update({
    where: { id: pratica.id },
    data: { stato: 'IN_ESCALATION', escalationAt: now },
  });
  return { count: 0, newAssegnazioniIds: [], escalated: true, round: 3 };
}
```

- [ ] **Step 4: Adatta i chiamanti al nuovo ritorno (`round`)**

In `tickPratica`, il ramo `if (currentRound < 3)` (~102-119) usa il round effettivamente raggiunto:

```ts
    if (currentRound < 3) {
      const nextRound = (currentRound + 1) as 1 | 2 | 3;
      const { count, newAssegnazioniIds, escalated, round: reached } = await avviaRound(tx, pratica, nextRound);
      await logCambioStato(tx, {
        praticaId,
        statoDa: pratica.stato,
        statoA: escalated ? 'IN_ESCALATION' : statoNomePerRound(reached),
        tipoEvento: escalated ? STATO_EVENTO.ESCALATION : STATO_EVENTO.ROUND_ADVANCE,
        meta: { round: escalated ? currentRound : reached, ciclo: pratica.distribuzioneCiclo },
      });
      return {
        result: escalated
          ? { status: 'escalated' as const }
          : { status: 'advanced-round' as const, nextRound: reached, assegnazioni: count },
        jobs: {
          newAssegnazioniIds,
          escalationPraticaId: escalated ? praticaId : null,
        },
      };
    }
```

In `avviaRound1ForPratica` (~470-494), usare il `round`/`escalated` ritornati per il log (già legge `updated.stato`; assicurarsi che `meta.round` usi il round raggiunto):

```ts
    const r = await avviaRound(tx, pratica, 1);
    const updated = await tx.pratica.findUnique({ where: { id: praticaId }, select: { stato: true } });
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: updated!.stato,
      tipoEvento: r.escalated ? STATO_EVENTO.ESCALATION : STATO_EVENTO.SUBMIT,
      meta: { round: r.round, ciclo: pratica.distribuzioneCiclo },
    });
```

Verificare che `pratica` passata ad `avviaRound` includa `lat`/`lng`: entrambe le `findUnique` dei chiamanti non usano `select` sui campi scalari base (o lo estendono) → i campi scalari `lat`/`lng` sono presenti. In `avviaRound1ForPratica` la `findUnique` usa `include: { assegnazioni: {...} }` senza `select` → tutti gli scalari (incl. lat/lng) ci sono. In `tickPratica` idem. Nessun cambio necessario lì, ma confermare col typecheck.

- [ ] **Step 5: Lancia i test → passano**

Run: `pnpm --filter piattaforma test src/lib/distribuzione/tick.test.ts`
Expected: PASS (nuovi casi + i preesistenti adeguati; nessun test vecchio "per provincia" rimasto verde per caso).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/distribuzione/constants.ts apps/piattaforma/src/lib/distribuzione/tick.ts apps/piattaforma/src/lib/distribuzione/tick.test.ts
git commit -m "feat(distribuzione): selezione a raggio-km + cascade su anello vuoto"
```

---

## Task 6: Rimozione `province-limitrofe`

**Files:**
- Delete: `apps/piattaforma/src/lib/distribuzione/province-limitrofe.ts`
- Delete: eventuale `apps/piattaforma/src/lib/distribuzione/province-limitrofe.test.ts` (se esiste)

- [ ] **Step 1: Verifica nessun consumer residuo**

Run (Grep): cercare `province-limitrofe` e `provinceLimitrofe` in `apps/piattaforma/src`.
Expected: nessun import residuo dopo il Task 5 (solo eventuali riferimenti nel file da cancellare).

- [ ] **Step 2: Rimuovi i file**

```bash
git rm apps/piattaforma/src/lib/distribuzione/province-limitrofe.ts
git rm apps/piattaforma/src/lib/distribuzione/province-limitrofe.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Typecheck + test suite di distribuzione**

Run:
```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test src/lib/distribuzione/
```
Expected: typecheck exit 0; test verdi (nessun riferimento rotto).

- [ ] **Step 4: Commit**

```bash
git add -A apps/piattaforma/src/lib/distribuzione/
git commit -m "chore(distribuzione): rimuove province-limitrofe (motore ora a raggio)"
```

---

## Task 7: Visibilità admin sedi non geocodate

**Files:**
- Create: `apps/piattaforma/src/app/admin/sedi-non-geocodate/page.tsx`

**Interfaces:**
- Consumes: `isAdminPiattaforma`, `AppShell`, `Card`, `Alert` (design system), `prisma.sede`.

- [ ] **Step 1: Pagina**

Creare la pagina (mirando al pattern di `app/admin/costi-promozionali/page.tsx`: guard `isAdminPiattaforma`, `AppShell`, `Card`, token `pv-*` reali — allinearsi ai componenti effettivi):

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function SediNonGeocodatePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/sedi-non-geocodate">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">Solo gli admin piattaforma.</Alert>
        </div>
      </AppShell>
    );
  }

  // Sedi AGENZIA attive senza coordinate: NON ricevono pratiche (motore a raggio).
  const sedi = await prisma.sede.findMany({
    where: { type: 'AGENZIA', deletedAt: null, suspendedAt: null, lat: null },
    select: {
      id: true, nome: true, citta: true, provincia: true,
      company: { select: { ragioneSociale: true } },
    },
    orderBy: [{ provincia: 'asc' }, { citta: 'asc' }],
    take: 500,
  });

  return (
    <AppShell session={session} activePath="/admin/sedi-non-geocodate">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <h1 className="text-[22px] font-bold text-pv-navy-900">Sedi senza coordinate</h1>
        <p className="mt-1 text-[14px] text-pv-slate-600">
          Queste agenzie non hanno coordinate geografiche e quindi <strong>non ricevono nuove
          pratiche</strong> (la distribuzione è a raggio). Aggiornane l'indirizzo o rilancia il
          geocoding.
        </p>
        {sedi.length === 0 ? (
          <Alert variant="success" title="Tutto geocodato" >Nessuna sede agenzia attiva senza coordinate.</Alert>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full border-collapse">
              <thead className="border-b border-pv-slate-100 bg-pv-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-[12px] font-semibold text-pv-slate-500">Azienda</th>
                  <th className="px-3 py-2 text-left text-[12px] font-semibold text-pv-slate-500">Sede</th>
                  <th className="px-3 py-2 text-left text-[12px] font-semibold text-pv-slate-500">Città</th>
                  <th className="px-3 py-2 text-left text-[12px] font-semibold text-pv-slate-500">Prov.</th>
                </tr>
              </thead>
              <tbody>
                {sedi.map((s) => (
                  <tr key={s.id} className="border-b border-pv-slate-50">
                    <td className="px-3 py-2 text-[13px] text-pv-navy-900">{s.company.ragioneSociale}</td>
                    <td className="px-3 py-2 text-[13px] text-pv-navy-900">{s.nome}</td>
                    <td className="px-3 py-2 text-[13px] text-pv-navy-900">{s.citta}</td>
                    <td className="px-3 py-2 text-[13px] text-pv-navy-900">{s.provincia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
```

Nota: verificare i nomi reali dei componenti `@/components/ui` (`Card`, `Alert`, `AppShell`) e i token `pv-*` contro una pagina admin esistente (`admin/costi-promozionali/page.tsx` o `admin/fatturazione/page.tsx`); adeguare props/token a quelli reali.

- [ ] **Step 2: Verifica browser (route monta)**

Run: dev server + apri `/admin/sedi-non-geocodate` da non autenticato → 307/redirect a `/login` (route monta). Loggato admin → tabella/empty-state. (Verifica loggata completa in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/admin/sedi-non-geocodate/
git commit -m "feat(admin): elenco sedi agenzia senza coordinate (non ricevono pratiche)"
```

- [ ] **Step 4: Backfill geocoding (ops, non codice)**

Eseguire il backfill esistente sulle sedi agenzia non ancora geocodate del DB locale, per verificare copertura:
Run: `nvm use 22.15.0 && pnpm --filter piattaforma exec tsx scripts/geocode-backfill.ts` (verificare nome/uso reale dello script prima di lanciarlo; richiede la chiave Geocoding server-side).
Expected: le sedi con indirizzo valido ottengono lat/lng; la pagina del Task 7 si svuota. Se lo script richiede una chiave non disponibile in locale, annotarlo e rimandare l'esecuzione (non blocca il codice).

---

## Task 8: Verifica end-to-end + memoria

**Files:** nessuna modifica — verifica su DB locale + memoria.

- [ ] **Step 1: Suite + typecheck**

Run:
```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test src/lib/geo/ src/lib/distribuzione/ src/app/pratiche/nuova/
```
Expected: typecheck 0; test verdi.

- [ ] **Step 2: Verifica flusso reale (browser + DB)**

Con dev server e login broker: creare una pratica selezionando un comune dall'autocomplete. Poi in sola lettura sul DB locale:
```sql
SELECT "codicePratica", "comune", "provincia", "lat", "lng", "stato" FROM "pratiche" ORDER BY "createdAt" DESC LIMIT 3;
SELECT a."round", a."sedeId", s."citta"
FROM "pratica_assegnazioni" a JOIN "sedi" s ON s.id = a."sedeId"
WHERE a."praticaId" = '<id pratica>' ORDER BY a."round";
```
(Verificare i nomi reali delle tabelle/colonne via `@@map`.) Expected: la pratica ha lat/lng; le assegnazioni sono solo sedi entro il raggio del round raggiunto.

- [ ] **Step 3: Aggiorna memoria**

Aggiornare la memoria di progetto sulla distribuzione: da "per provincia" a "a raggio-km (2/5/10, tutte le sedi nell'anello, anelli incrementali, cascade, escalation); coordinate su Pratica dall'autocomplete; sedi senza coord escluse + pagina admin; province-limitrofe rimosso". Segnalare: precondizione chiave Maps in prod, e backfill geocoding agenzie come parte del go-live.

---

## Self-Review (compilata durante la stesura)

**Spec coverage:**
- Haversine → Task 1. Pratica.lat/lng → Task 2. Obbligo+persistenza → Task 3 (server) + 4 (client). Motore raggio + anelli incrementali + cascade + escalation → Task 5. Sedi senza coord escluse + visibilità admin + backfill → Task 5 (where lat not null) + 7. province-limitrofe rimosso → Task 6. Verifica → Task 8. ✓
- Raggi 2/5/10, finestre 8/8/8, no cap/ranking → Task 5 constants + avviaRound. ✓

**Placeholder scan:** codice concreto in ogni step. I punti "verificare nomi reali" (tabella `@@map`, componenti UI, script backfill) sono allineamenti a codice esistente citato, non placeholder di logica.

**Type consistency:** `distanceKm({lat,lng},{lat,lng})` def. Task 1, usato Task 5; `Pratica.lat/lng` def. Task 2, usati Task 3/5; `avviaRound` ritorna `{...round}` (nuovo) in Task 5, consumato dai chiamanti nello stesso task; `praticaCoordsSchema` def./usato Task 3.

**Rischi noti (per la review finale):**
- Task 4/5 hanno verifica browser (client wizard + flusso) non coperta da unit test → Task 8.
- Copertura geocoding agenzie: le sedi senza coord non ricevono pratiche (per scelta) → Task 7 + backfill sono parte della release.
- `!hasMaps` (dev senza chiave) non può creare pratiche (coord obbligatorie): atteso.
