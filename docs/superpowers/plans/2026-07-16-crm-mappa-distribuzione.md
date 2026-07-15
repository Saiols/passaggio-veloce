# CRM — Mappa distribuzione iscrizioni — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere `/admin/crm/mappa`: una mappa d'Italia con un puntino per ogni Sede delle aziende iscritte (blu = broker/DEALER, arancione = agenzia/AGENZIA), con cluster raggruppati che si aprono zoommando.

**Architecture:** Le coordinate non esistono nel DB → si introducono su `Sede` (la sede madre è già una `Sede`, quindi niente doppioni). Le popoliamo via Google Geocoding (cattura client da Places dove economico + geocode-on-save server come backbone + script di backfill per l'esistente). La pagina server interroga le sedi geocodate e passa i punti a un client component Google Maps con due layer di clustering.

**Tech Stack:** Next.js 16 (App Router), Prisma + Postgres, `@googlemaps/js-api-loader` (già presente) + `@googlemaps/markerclusterer` (nuova dep), Vitest.

## Global Constraints

- **Node:** pnpm richiede Node ≥18. Se dopo un riavvio la shell torna a Node 16, eseguire `nvm use 22.15.0` prima di ogni comando pnpm.
- **Migration:** MAI `prisma migrate dev`/`pnpm db:migrate` su questo schema (propone DROP SEQUENCE distruttivi). Migration SQL scritta a mano + `pnpm --filter @pv/db db:deploy`.
- **Coordinate solo su `Sede`**, mai su `Company` (eviterebbe doppioni dell'HQ).
- **Chiave Google:** riuso `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` anche lato server (env leggibile server-side a prescindere dal prefisso). Nessuna nuova env var.
- **Prereq Google Cloud (config esterna, non codice):** abilitare *Maps JavaScript API* + *Geocoding API* sul progetto e allargare le restrizioni della chiave perché le chiamate server (senza HTTP referrer) passino.
- **Test:** mock Prisma col pattern `vi.hoisted` + `vi.mock('@pv/db', ...)`; mock `server-only` con `vi.mock('server-only', () => ({}))`. Girare i test con `pnpm --filter piattaforma test <path>`.
- **Form:** i `<form>` con validazione client usano `noValidate` (già così nei form toccati).
- **Colori marker:** i marker canvas di Google Maps non accettano classi Tailwind → colori hex inline nel client component (unica eccezione al no-hardcoded-colors, commentata).
- **Commit:** ogni task chiude con un commit. Firma i commit con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Si sviluppa direttamente su `main`.

---

### Task 1: Coordinate su `Sede` (schema + migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Sede`, ~riga 637-642)
- Create: `packages/db/prisma/migrations/20260716120000_sede_coordinate/migration.sql`

**Interfaces:**
- Produces: colonne `Sede.lat Float?`, `Sede.lng Float?`, `Sede.geocodedAt DateTime?` + client Prisma rigenerato.

- [ ] **Step 1: Aggiungere i campi al modello `Sede`**

In `schema.prisma`, dentro `model Sede { ... }`, dopo la riga `email     String?` (riga ~637) aggiungere:

```prisma
  // Coordinate geografiche (Google Geocoding). Nullable: il geocoding è
  // progressivo e best-effort. geocodedAt = ultima geolocalizzazione riuscita
  // (null se mai riuscita → il backfill che filtra lat:null ci riprova).
  lat        Float?
  lng        Float?
  geocodedAt DateTime?
```

- [ ] **Step 2: Scrivere la migration SQL a mano**

Creare `packages/db/prisma/migrations/20260716120000_sede_coordinate/migration.sql`:

```sql
-- Coordinate geografiche sulle sedi (per la mappa CRM e usi geo futuri).
ALTER TABLE "sedi"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "geocodedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Applicare la migration in locale e rigenerare il client**

Run:
```bash
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db db:generate
```
Expected: `db:deploy` stampa `1 migration found` e la applica senza errori; `db:generate` rigenera senza errori. (DB locale = copia di prod.)

- [ ] **Step 4: Verificare che le colonne esistano**

Run:
```bash
pnpm --filter @pv/db exec prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='sedi' AND column_name IN ('lat','lng','geocodedAt');
SQL
```
Expected: elenca `lat`, `lng`, `geocodedAt`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260716120000_sede_coordinate/
git commit -m "feat(db): coordinate lat/lng/geocodedAt su Sede (mappa CRM)"
```

---

### Task 2: Utility geo (geocoder server + parse coordinate)

**Files:**
- Create: `apps/piattaforma/src/lib/geo/coords.ts`
- Create: `apps/piattaforma/src/lib/geo/coords.test.ts`
- Create: `apps/piattaforma/src/lib/geo/geocode.ts`
- Create: `apps/piattaforma/src/lib/geo/geocode.test.ts`

**Interfaces:**
- Produces:
  - `parseCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null` (da `coords.ts`, puro, browser-safe)
  - `type GeocodeInput = { indirizzo: string; civico?: string | null; citta: string; cap: string; provincia: string }`
  - `formatAddress(a: GeocodeInput): string` (da `geocode.ts`)
  - `geocodeAddress(a: GeocodeInput): Promise<{ lat: number; lng: number } | null>` (da `geocode.ts`, server-only)

- [ ] **Step 1: Test di `parseCoords`**

Create `apps/piattaforma/src/lib/geo/coords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCoords } from './coords';

describe('parseCoords', () => {
  it('parse-a stringhe valide', () => {
    expect(parseCoords('45.4642', '9.19')).toEqual({ lat: 45.4642, lng: 9.19 });
  });
  it('null se non numerico o vuoto', () => {
    expect(parseCoords('', '')).toBeNull();
    expect(parseCoords('abc', '9')).toBeNull();
    expect(parseCoords(null, null)).toBeNull();
  });
  it('null se fuori range', () => {
    expect(parseCoords('91', '9')).toBeNull();
    expect(parseCoords('45', '181')).toBeNull();
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm --filter piattaforma test src/lib/geo/coords.test.ts`
Expected: FAIL — `Cannot find module './coords'`.

- [ ] **Step 3: Implementare `coords.ts`**

Create `apps/piattaforma/src/lib/geo/coords.ts`:

```ts
/**
 * Parsing difensivo di una coppia di coordinate (da FormData o querystring).
 * Puro e browser-safe (nessun import server-only): usato sia dal client che
 * dalle server action. Ritorna null se non finite o fuori dai range terrestri.
 */
export function parseCoords(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  const la = typeof lat === 'string' || typeof lat === 'number' ? Number(lat) : NaN;
  const ln = typeof lng === 'string' || typeof lng === 'number' ? Number(lng) : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}
```

Nota: `Number('')` è `0` (finito) ma `''` non è `'string'` valida qui? Attenzione: `Number('')===0`. Per questo il test "vuoto → null" va garantito: aggiungere il guard sulla stringa vuota.

Correggere l'implementazione per gestire la stringa vuota:

```ts
export function parseCoords(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  const norm = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  };
  const la = norm(lat);
  const ln = norm(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}
```

- [ ] **Step 4: Verificare che passi**

Run: `pnpm --filter piattaforma test src/lib/geo/coords.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Test di `formatAddress` e `geocodeAddress`**

Create `apps/piattaforma/src/lib/geo/geocode.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { formatAddress, geocodeAddress } from './geocode';

const ADDR = { indirizzo: 'Via Roma', civico: '10', citta: 'Milano', cap: '20100', provincia: 'MI' };

describe('formatAddress', () => {
  it('compone via civico, cap città, provincia, Italia', () => {
    expect(formatAddress(ADDR)).toBe('Via Roma 10, 20100 Milano, MI, Italia');
  });
  it('omette il civico se assente', () => {
    expect(formatAddress({ ...ADDR, civico: null })).toBe('Via Roma, 20100 Milano, MI, Italia');
  });
});

describe('geocodeAddress', () => {
  const OLD = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = OLD;
    vi.unstubAllGlobals();
  });

  it('ritorna lat/lng dal primo risultato OK', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 45.4, lng: 9.1 } } }] }),
    });
    expect(await geocodeAddress(ADDR)).toEqual({ lat: 45.4, lng: 9.1 });
  });

  it('ritorna null su ZERO_RESULTS', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    });
    expect(await geocodeAddress(ADDR)).toBeNull();
  });

  it('ritorna null su errore di rete', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    expect(await geocodeAddress(ADDR)).toBeNull();
  });

  it('senza chiave ritorna null e non chiama fetch', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    expect(await geocodeAddress(ADDR)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Verificare che fallisca**

Run: `pnpm --filter piattaforma test src/lib/geo/geocode.test.ts`
Expected: FAIL — `Cannot find module './geocode'`.

- [ ] **Step 7: Implementare `geocode.ts`**

Create `apps/piattaforma/src/lib/geo/geocode.ts`:

```ts
import 'server-only';

export type GeocodeInput = {
  indirizzo: string;
  civico?: string | null;
  citta: string;
  cap: string;
  provincia: string;
};

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Compone l'indirizzo in una singola stringa per la query di geocoding. */
export function formatAddress(a: GeocodeInput): string {
  const via = [a.indirizzo, a.civico].filter(Boolean).join(' ').trim();
  return [via, `${a.cap} ${a.citta}`.trim(), a.provincia, 'Italia']
    .filter((s) => s && s.length > 0)
    .join(', ');
}

/**
 * Geocoda un indirizzo con la Google Geocoding API. Tollerante: ritorna null su
 * chiave mancante, ZERO_RESULTS, risposta non-OK, errore di rete/quota. Non
 * lancia mai — il chiamante tratta null come "coordinate non disponibili".
 */
export async function geocodeAddress(
  a: GeocodeInput,
): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const url = `${ENDPOINT}?address=${encodeURIComponent(formatAddress(a))}&region=it&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };
    if (data.status !== 'OK') return null;
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Verificare che passi**

Run: `pnpm --filter piattaforma test src/lib/geo/geocode.test.ts src/lib/geo/coords.test.ts`
Expected: PASS (tutti i test).

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/lib/geo/
git commit -m "feat(geo): geocodeAddress (Google) + parseCoords, con test"
```

---

### Task 3: Cattura + persistenza coordinate su creazione Sede

**Files:**
- Modify: `apps/piattaforma/src/components/address-autocomplete.tsx`
- Modify: `apps/piattaforma/src/app/sedi/sede-create-form.tsx`
- Modify: `apps/piattaforma/src/app/sedi/actions.ts` (`createSedeAction`, ~riga 33-99)
- Test: `apps/piattaforma/src/app/sedi/actions.createsede-coords.test.ts`

**Interfaces:**
- Consumes: `geocodeAddress` (Task 2), `parseCoords` (Task 2)
- Produces: `AddressParts` estendo con `lat?: number; lng?: number`; `createSedeAction` persiste `lat/lng/geocodedAt`.

- [ ] **Step 1: `AddressAutocomplete` cattura anche `location`**

In `address-autocomplete.tsx`, estendere il tipo `AddressParts` (riga 6-17) aggiungendo in fondo ai campi:

```ts
  /** Latitudine (Google Places location), se disponibile. */
  lat?: number;
  /** Longitudine (Google Places location), se disponibile. */
  lng?: number;
```

E in `handleSelect` (riga 155-169) sostituire il blocco `try`:

```ts
    try {
      const place = pred.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'location'] });
      const parts = parseComponents(place.addressComponents ?? undefined);
      const loc = place.location;
      onSelectRef.current({
        ...parts,
        lat: typeof loc?.lat === 'function' ? loc.lat() : undefined,
        lng: typeof loc?.lng === 'function' ? loc.lng() : undefined,
      });
    } catch {
      /* ignora: l'utente può compilare i campi a mano */
    }
```

- [ ] **Step 2: `sede-create-form.tsx` porta lat/lng nella FormData**

In `sede-create-form.tsx`:

Estendere `EMPTY` (riga 12-22) aggiungendo:
```ts
  lat: '',
  lng: '',
```

Estendere `applyAddress` (riga 31-39) per copiare le coordinate (o svuotarle se il nuovo indirizzo non le ha):
```ts
  const applyAddress = (p: AddressParts) =>
    setF((s) => ({
      ...s,
      indirizzo: p.indirizzo,
      civico: p.civico,
      citta: p.citta,
      cap: p.cap,
      provincia: p.provincia,
      lat: p.lat != null ? String(p.lat) : '',
      lng: p.lng != null ? String(p.lng) : '',
    }));
```

Nessun altro cambio: `onValid` fa già `for (const [k, v] of Object.entries(f)) fd.set(k, v)`, quindi `lat`/`lng` finiscono in FormData. `zodFieldErrors(registerSedeSchema, f)` ignora le chiavi extra (zod strippa gli sconosciuti) → nessuna modifica agli schemi.

- [ ] **Step 3: Test dell'azione (fallisce)**

Create `apps/piattaforma/src/app/sedi/actions.createsede-coords.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, redirectMock, geocodeMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findUnique: vi.fn() },
    sede: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  geocodeMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/geo/geocode', () => ({ geocodeAddress: geocodeMock }));

import { createSedeAction } from './actions';

function fd(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    nome: 'Sede Nuova', indirizzo: 'Via Roma', civico: '1', citta: 'Milano',
    cap: '20100', provincia: 'MI', telefono: '', email: '', codiceInterno: '',
    iban: '', payoutThresholdEuro: '', lat: '', lng: '',
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN_AZIENDA', companyId: 'c-1' } });
  prismaMock.company.findUnique.mockResolvedValue({ type: 'AGENZIA' });
  prismaMock.sede.findFirst.mockResolvedValue(null); // nessuna sede sanzionata
  prismaMock.sede.findUnique.mockResolvedValue(null); // nessuna collisione referralCode
  prismaMock.sede.create.mockResolvedValue({});
});

describe('createSedeAction — coordinate', () => {
  it('usa le coordinate dal client (Places) e NON chiama il geocoder', async () => {
    await createSedeAction(fd({ lat: '45.46', lng: '9.19' }));
    expect(geocodeMock).not.toHaveBeenCalled();
    const data = prismaMock.sede.create.mock.calls[0][0].data;
    expect(data.lat).toBe(45.46);
    expect(data.lng).toBe(9.19);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('senza coordinate client geocoda server-side e le persiste', async () => {
    geocodeMock.mockResolvedValue({ lat: 41.9, lng: 12.5 });
    await createSedeAction(fd());
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.sede.create.mock.calls[0][0].data;
    expect(data.lat).toBe(41.9);
    expect(data.lng).toBe(12.5);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('se il geocoding fallisce salva comunque con coord null e geocodedAt null', async () => {
    geocodeMock.mockResolvedValue(null);
    await createSedeAction(fd());
    const data = prismaMock.sede.create.mock.calls[0][0].data;
    expect(data.lat).toBeNull();
    expect(data.lng).toBeNull();
    expect(data.geocodedAt).toBeNull();
  });
});
```

Run: `pnpm --filter piattaforma test src/app/sedi/actions.createsede-coords.test.ts`
Expected: FAIL — `data.lat` è `undefined` (l'azione non scrive ancora le coordinate).

- [ ] **Step 4: Persistere le coordinate in `createSedeAction`**

In `apps/piattaforma/src/app/sedi/actions.ts`:

Aggiungere gli import in cima al file (accanto agli altri import):
```ts
import { geocodeAddress } from '@/lib/geo/geocode';
import { parseCoords } from '@/lib/geo/coords';
```

Dentro `createSedeAction`, dopo `const f = parsed.data;` (riga ~65) e prima del blocco referralCode, calcolare le coordinate:
```ts
  // Coordinate: preferisci quelle catturate dal client (Google Places); se
  // assenti (indirizzo digitato a mano) geocoda server-side best-effort.
  const coords =
    parseCoords(formData.get('lat'), formData.get('lng')) ??
    (await geocodeAddress({
      indirizzo: f.indirizzo,
      civico: f.civico,
      citta: f.citta,
      cap: f.cap,
      provincia: f.provincia,
    }));
```

Nel `prisma.sede.create({ data: { ... } })` (riga ~78-95) aggiungere in fondo all'oggetto `data`:
```ts
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      geocodedAt: coords ? new Date() : null,
```

- [ ] **Step 5: Verificare che passi**

Run: `pnpm --filter piattaforma test src/app/sedi/actions.createsede-coords.test.ts`
Expected: PASS (3 test).

- [ ] **Step 6: Non regredire l'anti-abuso esistente**

Run: `pnpm --filter piattaforma test src/app/sedi/actions.createsede-antiabuso.test.ts`
Expected: PASS (i test esistenti non si rompono).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/components/address-autocomplete.tsx apps/piattaforma/src/app/sedi/sede-create-form.tsx apps/piattaforma/src/app/sedi/actions.ts apps/piattaforma/src/app/sedi/actions.createsede-coords.test.ts
git commit -m "feat(sedi): cattura+persistenza coordinate su creazione sede"
```

---

### Task 4: Persistenza coordinate su modifica Sede

**Files:**
- Modify: `apps/piattaforma/src/app/sedi/[id]/sede-edit.tsx`
- Modify: `apps/piattaforma/src/app/sedi/actions.ts` (`updateSedeAction`, ~riga 116-165)
- Test: `apps/piattaforma/src/app/sedi/actions.updatesede-coords.test.ts`

**Interfaces:**
- Consumes: `geocodeAddress`, `parseCoords`
- Produces: `updateSedeAction` aggiorna `lat/lng/geocodedAt` quando cambia l'indirizzo o arrivano coord dal client.

- [ ] **Step 1: Aggiungere lat/lng al form di modifica**

In `sede-edit.tsx`, replicare il pattern di `sede-create-form.tsx`:
- aggiungere `lat: ''` e `lng: ''` allo stato iniziale del form;
- nell'handler `applyAddress` (quello passato a `<AddressAutocomplete onSelect={...} />`) copiare `lat`/`lng` da `AddressParts` come stringhe (o `''` se assenti);
- assicurarsi che la FormData inviata a `updateSedeAction` includa `lat` e `lng` (se il form usa un loop `Object.entries`, sono già inclusi; altrimenti aggiungere `fd.set('lat', f.lat); fd.set('lng', f.lng);`).

- [ ] **Step 2: Test dell'azione (fallisce)**

Create `apps/piattaforma/src/app/sedi/actions.updatesede-coords.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, geocodeMock, ctxMock, permMock } = vi.hoisted(() => ({
  prismaMock: { sede: { update: vi.fn() } },
  geocodeMock: vi.fn(),
  ctxMock: vi.fn(),
  permMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/geo/geocode', () => ({ geocodeAddress: geocodeMock }));
// Gate permesso + scope: importa i nomi reali usati da updateSedeAction e mockali.
vi.mock('@/lib/auth/permessi/guard', () => ({ requirePermesso: permMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: ctxMock }));

import { updateSedeAction } from './actions';

function fd(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    nome: 'Sede', indirizzo: 'Via Milano', civico: '2', citta: 'Torino',
    cap: '10100', provincia: 'TO', telefono: '', email: '', codiceInterno: '',
    iban: '', payoutThresholdEuro: '', lat: '', lng: '',
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ ok: true });
  ctxMock.mockResolvedValue({ isOwner: true, accessibleSedi: [{ id: 's-1' }] });
  prismaMock.sede.update.mockResolvedValue({});
});

describe('updateSedeAction — coordinate', () => {
  it('usa le coordinate dal client se presenti', async () => {
    await updateSedeAction('s-1', fd({ lat: '45.07', lng: '7.68' }));
    expect(geocodeMock).not.toHaveBeenCalled();
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data.lat).toBe(45.07);
    expect(data.lng).toBe(7.68);
    expect(data.geocodedAt).toBeInstanceOf(Date);
  });

  it('senza coord client geocoda e persiste', async () => {
    geocodeMock.mockResolvedValue({ lat: 45.07, lng: 7.68 });
    await updateSedeAction('s-1', fd());
    expect(geocodeMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.sede.update.mock.calls[0][0].data;
    expect(data.lat).toBe(45.07);
  });
});
```

> NOTA per l'implementatore: prima di scrivere il test, aprire `actions.ts` e verificare i **path reali** degli import di `requirePermesso` e `getSessionContext` (righe ~121 e ~128) e allineare i `vi.mock(...)` sopra a quei path esatti.

Run: `pnpm --filter piattaforma test src/app/sedi/actions.updatesede-coords.test.ts`
Expected: FAIL — `data.lat` è `undefined`.

- [ ] **Step 3: Persistere le coordinate in `updateSedeAction`**

In `updateSedeAction`, dopo `const f = parsed.data;` (riga ~141) calcolare le coordinate come nel create:
```ts
  const coords =
    parseCoords(formData.get('lat'), formData.get('lng')) ??
    (await geocodeAddress({
      indirizzo: f.indirizzo,
      civico: f.civico,
      citta: f.citta,
      cap: f.cap,
      provincia: f.provincia,
    }));
```
e nel `prisma.sede.update({ where, data: { ... } })` (riga ~143-159) aggiungere in fondo all'oggetto `data` (fuori dallo spread condizionale IBAN):
```ts
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      geocodedAt: coords ? new Date() : null,
```

- [ ] **Step 4: Verificare che passi**

Run: `pnpm --filter piattaforma test src/app/sedi/actions.updatesede-coords.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/sedi/[id]/sede-edit.tsx apps/piattaforma/src/app/sedi/actions.ts apps/piattaforma/src/app/sedi/actions.updatesede-coords.test.ts
git commit -m "feat(sedi): coordinate su modifica sede (client o geocode)"
```

---

### Task 5: Geocode post-commit delle sedi in registrazione

**Files:**
- Create: `apps/piattaforma/src/lib/geo/geocode-sedi.ts`
- Create: `apps/piattaforma/src/lib/geo/geocode-sedi.test.ts`
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts` (blocco post-commit, ~riga 603-611)

**Interfaces:**
- Consumes: `geocodeAddress` (Task 2), `prisma`
- Produces: `geocodeCompanySedi(companyId: string): Promise<void>` — geocoda best-effort le sedi non ancora geolocalizzate di una company.

- [ ] **Step 1: Test di `geocodeCompanySedi` (fallisce)**

Create `apps/piattaforma/src/lib/geo/geocode-sedi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { prismaMock, geocodeMock } = vi.hoisted(() => ({
  prismaMock: { sede: { findMany: vi.fn(), update: vi.fn() } },
  geocodeMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./geocode', () => ({ geocodeAddress: geocodeMock }));

import { geocodeCompanySedi } from './geocode-sedi';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.sede.update.mockResolvedValue({});
});

describe('geocodeCompanySedi', () => {
  it('geocoda e aggiorna solo le sedi con coordinate ottenute', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      { id: 's-1', indirizzo: 'Via A', civico: '1', citta: 'Roma', cap: '00100', provincia: 'RM' },
      { id: 's-2', indirizzo: 'Via B', civico: null, citta: 'X', cap: '00000', provincia: 'ZZ' },
    ]);
    geocodeMock.mockResolvedValueOnce({ lat: 41.9, lng: 12.5 }).mockResolvedValueOnce(null);

    await geocodeCompanySedi('c-1');

    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.sede.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's-1' });
    expect(call.data.lat).toBe(41.9);
    expect(call.data.geocodedAt).toBeInstanceOf(Date);
  });

  it('non lancia se il DB va in errore', async () => {
    prismaMock.sede.findMany.mockRejectedValue(new Error('db'));
    await expect(geocodeCompanySedi('c-1')).resolves.toBeUndefined();
  });
});
```

Run: `pnpm --filter piattaforma test src/lib/geo/geocode-sedi.test.ts`
Expected: FAIL — `Cannot find module './geocode-sedi'`.

- [ ] **Step 2: Implementare `geocode-sedi.ts`**

Create `apps/piattaforma/src/lib/geo/geocode-sedi.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { geocodeAddress } from './geocode';

/**
 * Geocoda best-effort le sedi non ancora geolocalizzate (lat null) di una
 * company. Usata post-commit in registrazione: mai dentro una transazione
 * (fa chiamate di rete). Non lancia: un fallimento lascia la sede senza
 * coordinate, che il backfill riprenderà.
 */
export async function geocodeCompanySedi(companyId: string): Promise<void> {
  try {
    const sedi = await prisma.sede.findMany({
      where: { companyId, lat: null, deletedAt: null },
      select: { id: true, indirizzo: true, civico: true, citta: true, cap: true, provincia: true },
    });
    for (const s of sedi) {
      const coords = await geocodeAddress(s);
      if (!coords) continue;
      await prisma.sede.update({
        where: { id: s.id },
        data: { lat: coords.lat, lng: coords.lng, geocodedAt: new Date() },
      });
    }
  } catch (e) {
    console.warn('[geocode] geocodeCompanySedi fallito', (e as Error).message);
  }
}
```

- [ ] **Step 3: Verificare che passi**

Run: `pnpm --filter piattaforma test src/lib/geo/geocode-sedi.test.ts`
Expected: PASS (2 test).

- [ ] **Step 4: Agganciare la chiamata post-commit in registrazione**

In `apps/piattaforma/src/app/(auth)/actions.ts`:

Aggiungere l'import in cima:
```ts
import { geocodeCompanySedi } from '@/lib/geo/geocode-sedi';
```

Nel blocco best-effort post-commit, dopo `void tryMatchCrmContact(createdCompanyId);` / `void notifyReferralSignup(createdCompanyId);` (riga ~607-610), aggiungere — stesso pattern fire-and-forget già usato lì:
```ts
      // Geocoda le sedi appena create (best-effort, fuori dalla transazione).
      // Se non fa in tempo/fallisce, il backfill le riprende (lat null).
      void geocodeCompanySedi(createdCompanyId);
```

- [ ] **Step 5: Verifica non-regressione registrazione**

Run: `pnpm --filter piattaforma test src/app/(auth)`
Expected: PASS (i test esistenti dell'area auth non si rompono).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/geo/geocode-sedi.ts apps/piattaforma/src/lib/geo/geocode-sedi.test.ts "apps/piattaforma/src/app/(auth)/actions.ts"
git commit -m "feat(registrazione): geocode post-commit delle sedi nuove"
```

---

### Task 6: Script di backfill geocoding sedi esistenti

**Files:**
- Create: `apps/piattaforma/scripts/geocode-backfill.ts`

**Interfaces:**
- Consumes: `geocodeAddress` (Task 2), `prisma`
- Produces: script eseguibile via `tsx` che geocoda tutte le sedi con `lat` null.

- [ ] **Step 1: Scrivere lo script**

Create `apps/piattaforma/scripts/geocode-backfill.ts`:

```ts
/**
 * Backfill coordinate sedi: geocoda tutte le Sede con lat null e le aggiorna.
 * Idempotente (rieseguibile: salta chi ha già lat). Rate-limited. Logga gli
 * esiti — i falliti restano lat null e verranno ritentati alla prossima run.
 *
 * Uso: pnpm --filter piattaforma exec tsx scripts/geocode-backfill.ts
 * Richiede NEXT_PUBLIC_GOOGLE_MAPS_API_KEY nell'ambiente.
 */
import { prisma } from '@pv/db';
import { geocodeAddress } from '../src/lib/geo/geocode';

const SLEEP_MS = 120; // ~8 req/s, sotto i limiti Google

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const sedi = await prisma.sede.findMany({
    where: { lat: null, deletedAt: null },
    select: { id: true, nome: true, indirizzo: true, civico: true, citta: true, cap: true, provincia: true },
  });
  console.log(`[backfill] ${sedi.length} sedi da geocodare`);

  let ok = 0;
  let ko = 0;
  for (const s of sedi) {
    const coords = await geocodeAddress(s);
    if (coords) {
      await prisma.sede.update({
        where: { id: s.id },
        data: { lat: coords.lat, lng: coords.lng, geocodedAt: new Date() },
      });
      ok++;
    } else {
      ko++;
      console.warn(`[backfill] KO ${s.nome} — ${s.indirizzo} ${s.civico ?? ''} ${s.cap} ${s.citta} ${s.provincia}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log(`[backfill] fatto: ${ok} geocodate, ${ko} fallite`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-check di compilazione (senza chiavi, non deve girare davvero)**

Run: `pnpm --filter piattaforma exec tsx --eval "import('./scripts/geocode-backfill.ts').catch(e=>{console.log('import ok se non è errore di sintassi:', e.message)})"`
Expected: nessun errore di sintassi/tipi TS all'import. (Non lanciare la geocodifica reale finché la chiave non ha i permessi Geocoding e non si è pronti a scrivere sul DB locale.)

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/scripts/geocode-backfill.ts
git commit -m "feat(geo): script backfill geocoding sedi esistenti"
```

- [ ] **Step 4 (esecuzione, manuale — dopo prereq Google):** una volta abilitata la Geocoding API sulla chiave, eseguire il backfill sul DB **locale** (copia di prod) e leggere il log:

```bash
pnpm --filter piattaforma exec tsx scripts/geocode-backfill.ts
```
Expected: log `N sedi da geocodare` → `X geocodate, Y fallite`. Annotare le fallite per correzione indirizzo. (Il backfill su prod si esegue col DATABASE_URL di prod, in accordo col processo di rilascio.)

---

### Task 7: Query punti mappa

**Files:**
- Create: `apps/piattaforma/src/lib/crm/mappa-points.ts`
- Create: `apps/piattaforma/src/lib/crm/mappa-points.test.ts`

**Interfaces:**
- Consumes: `prisma`
- Produces:
  - `type MappaPoint = { id: string; type: 'DEALER' | 'AGENZIA'; lat: number; lng: number; nome: string; citta: string; provincia: string }`
  - `type MappaData = { points: MappaPoint[]; nonGeolocalizzate: number }`
  - `getMappaPoints(): Promise<MappaData>`

- [ ] **Step 1: Test (fallisce)**

Create `apps/piattaforma/src/lib/crm/mappa-points.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { sede: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));

import { getMappaPoints } from './mappa-points';

beforeEach(() => vi.clearAllMocks());

describe('getMappaPoints', () => {
  it('mappa le sedi geocodate in punti e conta le non geolocalizzate', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      { id: 's-1', type: 'DEALER', lat: 45.4, lng: 9.1, nome: 'HQ', citta: 'Milano', provincia: 'MI' },
      { id: 's-2', type: 'AGENZIA', lat: 41.9, lng: 12.5, nome: 'Roma', citta: 'Roma', provincia: 'RM' },
    ]);
    prismaMock.sede.count.mockResolvedValue(3);

    const res = await getMappaPoints();

    expect(res.points).toHaveLength(2);
    expect(res.points[0]).toEqual({
      id: 's-1', type: 'DEALER', lat: 45.4, lng: 9.1, nome: 'HQ', citta: 'Milano', provincia: 'MI',
    });
    expect(res.nonGeolocalizzate).toBe(3);
  });

  it('filtra su sedi non cancellate, con coordinate, di aziende non cancellate', async () => {
    prismaMock.sede.findMany.mockResolvedValue([]);
    prismaMock.sede.count.mockResolvedValue(0);
    await getMappaPoints();
    const where = prismaMock.sede.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.lat).toEqual({ not: null });
    expect(where.company).toEqual({ deletedAt: null });
  });
});
```

Run: `pnpm --filter piattaforma test src/lib/crm/mappa-points.test.ts`
Expected: FAIL — `Cannot find module './mappa-points'`.

- [ ] **Step 2: Implementare `mappa-points.ts`**

Create `apps/piattaforma/src/lib/crm/mappa-points.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';

export type MappaPoint = {
  id: string;
  type: 'DEALER' | 'AGENZIA';
  lat: number;
  lng: number;
  nome: string;
  citta: string;
  provincia: string;
};

export type MappaData = {
  points: MappaPoint[];
  nonGeolocalizzate: number;
};

/**
 * Punti per la mappa CRM: una Sede = un punto. Solo aziende iscritte
 * (Sede non cancellata, Company madre non cancellata) con coordinate valide.
 * Ritorna anche quante sedi restano senza coordinate (per la nota in pagina).
 */
export async function getMappaPoints(): Promise<MappaData> {
  const [rows, nonGeolocalizzate] = await Promise.all([
    prisma.sede.findMany({
      where: {
        deletedAt: null,
        lat: { not: null },
        lng: { not: null },
        company: { deletedAt: null },
      },
      select: {
        id: true, type: true, lat: true, lng: true,
        nome: true, citta: true, provincia: true,
      },
    }),
    prisma.sede.count({
      where: { deletedAt: null, lat: null, company: { deletedAt: null } },
    }),
  ]);

  const points: MappaPoint[] = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue; // guard: il where già filtra
    points.push({
      id: r.id,
      type: r.type as 'DEALER' | 'AGENZIA',
      lat: r.lat,
      lng: r.lng,
      nome: r.nome,
      citta: r.citta,
      provincia: r.provincia,
    });
  }

  return { points, nonGeolocalizzate };
}
```

- [ ] **Step 3: Verificare che passi**

Run: `pnpm --filter piattaforma test src/lib/crm/mappa-points.test.ts`
Expected: PASS (2 test).

- [ ] **Step 4: Provare la query sul DB reale (read-only)**

Run:
```bash
pnpm --filter @pv/db exec prisma db execute --stdin <<'SQL'
SELECT s.type, count(*) AS con_coord
FROM "sedi" s JOIN "companies" c ON c.id = s."companyId"
WHERE s."deletedAt" IS NULL AND c."deletedAt" IS NULL AND s.lat IS NOT NULL
GROUP BY s.type;
SQL
```
Expected: nessun errore; conteggi coerenti (0 finché non gira il backfill — atteso). Serve a validare che i nomi colonna/relazione siano corretti.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/mappa-points.ts apps/piattaforma/src/lib/crm/mappa-points.test.ts
git commit -m "feat(crm): query punti mappa (sedi geocodate) + test"
```

---

### Task 8: UI mappa (pagina + client Google Maps + sidebar)

**Files:**
- Modify: `apps/piattaforma/package.json` (dep `@googlemaps/markerclusterer`)
- Create: `apps/piattaforma/src/lib/crm/mappa-colors.ts`
- Create: `apps/piattaforma/src/lib/crm/mappa-colors.test.ts`
- Create: `apps/piattaforma/src/app/admin/crm/mappa/page.tsx`
- Create: `apps/piattaforma/src/app/admin/crm/mappa/mappa-client.tsx`
- Modify: `apps/piattaforma/src/components/admin/admin-icons.tsx` (nuova `IconMappa`)
- Modify: `apps/piattaforma/src/components/admin/admin-shell.tsx` (voce CRM → Mappa)

**Interfaces:**
- Consumes: `getMappaPoints`, `MappaPoint`, `MappaData` (Task 7)
- Produces: rotta `/admin/crm/mappa`; helper `pointColor(type): string`.

- [ ] **Step 1: Installare la libreria di clustering**

Run: `pnpm --filter piattaforma add @googlemaps/markerclusterer`
Expected: aggiunta a `dependencies` in `apps/piattaforma/package.json`, install ok.

- [ ] **Step 2: Test del color helper (fallisce)**

Create `apps/piattaforma/src/lib/crm/mappa-colors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pointColor, DEALER_COLOR, AGENZIA_COLOR } from './mappa-colors';

describe('pointColor', () => {
  it('blu per i broker (DEALER)', () => {
    expect(pointColor('DEALER')).toBe(DEALER_COLOR);
  });
  it('arancione per le agenzie (AGENZIA)', () => {
    expect(pointColor('AGENZIA')).toBe(AGENZIA_COLOR);
  });
});
```

Run: `pnpm --filter piattaforma test src/lib/crm/mappa-colors.test.ts`
Expected: FAIL — modulo assente.

- [ ] **Step 3: Implementare il color helper**

Create `apps/piattaforma/src/lib/crm/mappa-colors.ts`:

```ts
// Colori dei marker/cluster sulla mappa. Hex inline: Google Maps disegna i
// marker su canvas e non accetta classi Tailwind. Blu ≈ brand (broker),
// arancione per le agenzie.
export const DEALER_COLOR = '#1D4ED8';
export const AGENZIA_COLOR = '#EA580C';

export function pointColor(type: 'DEALER' | 'AGENZIA'): string {
  return type === 'DEALER' ? DEALER_COLOR : AGENZIA_COLOR;
}
```

- [ ] **Step 4: Verificare che passi**

Run: `pnpm --filter piattaforma test src/lib/crm/mappa-colors.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: Icona sidebar `IconMappa`**

In `apps/piattaforma/src/components/admin/admin-icons.tsx`, aggiungere in fondo (prima di eventuali export di tipo) una nuova icona nello stile delle altre:

```tsx
export function IconMappa({ className }: AdminIconProps) {
  return (
    <Svg className={className}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </Svg>
  );
}
```

- [ ] **Step 6: Voce "Mappa" nel gruppo CRM**

In `apps/piattaforma/src/components/admin/admin-shell.tsx`:

Aggiungere `IconMappa` all'import da `./admin-icons` (riga 7-29, lista ordinata):
```ts
  IconMappa,
```

Nel gruppo `CRM` di `NAV_GROUPS` (riga 97-108), aggiungere la voce dopo `Dashboard`:
```tsx
      { href: '/admin/crm/mappa', label: 'Mappa', icon: IconMappa },
```

- [ ] **Step 7: Pagina server `page.tsx`**

Create `apps/piattaforma/src/app/admin/crm/mappa/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewCrmDashboard } from '@/lib/auth/permissions';
import { getMappaPoints } from '@/lib/crm/mappa-points';
import { MappaClient } from './mappa-client';

export const metadata = { title: 'Mappa iscrizioni · CRM' };

export default async function AdminCrmMappaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrmDashboard(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/mappa">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La mappa CRM è riservata a Admin / AD / CTO / Sales Manager.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const { points, nonGeolocalizzate } = await getMappaPoints();

  return (
    <AppShell session={session} activePath="/admin/crm/mappa">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-pv-slate-900">Distribuzione iscrizioni</h1>
        <p className="mt-1 text-[13px] text-pv-slate-500">
          Ogni punto è una sede iscritta. Blu = broker, arancione = agenzia.
          Zooma per aprire i raggruppamenti.
        </p>
        <div className="mt-4">
          <MappaClient points={points} nonGeolocalizzate={nonGeolocalizzate} />
        </div>
      </div>
    </AppShell>
  );
}
```

> NOTA: verificare che `canViewCrmDashboard` sia esportato da `@/lib/auth/permissions` (usato identico in `admin/crm/dashboard/page.tsx`). Le classi `pv-slate-*` sono del design system esistente.

- [ ] **Step 8: Client map `mappa-client.tsx`**

Create `apps/piattaforma/src/app/admin/crm/mappa/mappa-client.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { MarkerClusterer, type Renderer } from '@googlemaps/markerclusterer';
import type { MappaPoint } from '@/lib/crm/mappa-points';
import { pointColor, DEALER_COLOR, AGENZIA_COLOR } from '@/lib/crm/mappa-colors';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const ITALY_CENTER = { lat: 42.0, lng: 12.5 };

function markerIcon(color: string): google.maps.Symbol {
  return {
    path: 0 as unknown as google.maps.SymbolPath, // CIRCLE
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 1.5,
    scale: 6,
  };
}

/** Renderer cluster colorato per tipo, con il conteggio al centro. */
function clusterRenderer(color: string): Renderer {
  return {
    render: ({ count, position }) => {
      const div = document.createElement('div');
      div.style.cssText = `background:${color};color:#fff;border-radius:9999px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)`;
      div.textContent = String(count);
      return new google.maps.marker.AdvancedMarkerElement({ position, content: div });
    },
  };
}

export function MappaClient({
  points,
  nonGeolocalizzate,
}: {
  points: MappaPoint[];
  nonGeolocalizzate: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [showDealer, setShowDealer] = useState(true);
  const [showAgenzia, setShowAgenzia] = useState(true);

  const dealerClustererRef = useRef<MarkerClusterer | null>(null);
  const agenziaClustererRef = useRef<MarkerClusterer | null>(null);
  const dealerMarkersRef = useRef<google.maps.Marker[]>([]);
  const agenziaMarkersRef = useRef<google.maps.Marker[]>([]);

  const nDealer = points.filter((p) => p.type === 'DEALER').length;
  const nAgenzia = points.filter((p) => p.type === 'AGENZIA').length;

  useEffect(() => {
    if (!API_KEY || !mapRef.current) return;
    let cancelled = false;

    void (async () => {
      const { setOptions, importLibrary } = await import('@googlemaps/js-api-loader');
      setOptions({ key: API_KEY, v: 'weekly' });
      const { Map, InfoWindow } = (await importLibrary('maps')) as google.maps.MapsLibrary;
      await importLibrary('marker'); // per AdvancedMarkerElement usato nei cluster
      if (cancelled || !mapRef.current) return;

      const map = new Map(mapRef.current, {
        center: ITALY_CENTER,
        zoom: 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      const info = new InfoWindow();

      const makeMarkers = (type: 'DEALER' | 'AGENZIA') =>
        points
          .filter((p) => p.type === type)
          .map((p) => {
            const m = new google.maps.Marker({
              position: { lat: p.lat, lng: p.lng },
              icon: markerIcon(pointColor(type)),
              title: p.nome,
            });
            m.addListener('click', () => {
              info.setContent(
                `<div style="font-size:13px"><strong>${p.nome}</strong><br/>${p.citta} (${p.provincia})<br/>${type === 'DEALER' ? 'Broker' : 'Agenzia'}</div>`,
              );
              info.open(map, m);
            });
            return m;
          });

      dealerMarkersRef.current = makeMarkers('DEALER');
      agenziaMarkersRef.current = makeMarkers('AGENZIA');

      dealerClustererRef.current = new MarkerClusterer({
        map,
        markers: dealerMarkersRef.current,
        renderer: clusterRenderer(DEALER_COLOR),
      });
      agenziaClustererRef.current = new MarkerClusterer({
        map,
        markers: agenziaMarkersRef.current,
        renderer: clusterRenderer(AGENZIA_COLOR),
      });
    })();

    return () => {
      cancelled = true;
      dealerClustererRef.current?.clearMarkers();
      agenziaClustererRef.current?.clearMarkers();
    };
  }, [points]);

  // Toggle layer: aggiungi/rimuovi i marker dal rispettivo clusterer.
  useEffect(() => {
    const c = dealerClustererRef.current;
    if (!c) return;
    c.clearMarkers();
    if (showDealer) c.addMarkers(dealerMarkersRef.current);
  }, [showDealer]);

  useEffect(() => {
    const c = agenziaClustererRef.current;
    if (!c) return;
    c.clearMarkers();
    if (showAgenzia) c.addMarkers(agenziaMarkersRef.current);
  }, [showAgenzia]);

  if (!API_KEY) {
    return (
      <div className="rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-6 text-[13px] text-pv-slate-500">
        Mappa non disponibile: manca la chiave Google Maps.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowDealer((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium ${showDealer ? 'border-pv-slate-300 text-pv-slate-900' : 'border-pv-slate-200 text-pv-slate-400'}`}
        >
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: DEALER_COLOR, opacity: showDealer ? 1 : 0.4 }} />
          Broker · {nDealer}
        </button>
        <button
          type="button"
          onClick={() => setShowAgenzia((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium ${showAgenzia ? 'border-pv-slate-300 text-pv-slate-900' : 'border-pv-slate-200 text-pv-slate-400'}`}
        >
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: AGENZIA_COLOR, opacity: showAgenzia ? 1 : 0.4 }} />
          Agenzie · {nAgenzia}
        </button>
      </div>

      <div ref={mapRef} className="h-[70vh] w-full overflow-hidden rounded-[12px] border border-pv-slate-200" />

      {nonGeolocalizzate > 0 && (
        <p className="text-[12px] text-pv-slate-500">
          {nonGeolocalizzate} sedi non ancora geolocalizzate (indirizzo non trovato): non compaiono sulla mappa.
        </p>
      )}
    </div>
  );
}
```

> NOTE tecniche per l'implementatore:
> - `markerIcon` usa `google.maps.SymbolPath.CIRCLE`. Se il cast `0 as unknown as ...` dà noia ai tipi, sostituire con `path: google.maps.SymbolPath.CIRCLE` una volta che `google` è caricato (o importare `SymbolPath` dalla libreria). Verificare a runtime che i pallini siano cerchi pieni colorati.
> - `@googlemaps/markerclusterer` espone `MarkerClusterer`, `Renderer`, `clearMarkers()`, `addMarkers()`. Verificare i nomi con `pnpm --filter piattaforma exec node -e "console.log(Object.keys(require('@googlemaps/markerclusterer')))"` e allineare l'import se necessario.
> - Il renderer del cluster usa `AdvancedMarkerElement` (serve `importLibrary('marker')`, già incluso). Se in futuro richiede un `mapId`, aggiungerne uno o usare un renderer basato su `google.maps.Marker` con icona SVG.

- [ ] **Step 9: Typecheck del pacchetto**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore introdotto dai nuovi file. (Se a cache fredda `tsc` dà falsi errori Prisma/stack overflow — problema noto — rieseguire dopo un `build`/con tsbuildinfo caldo, oppure valutare i soli errori nei file toccati.)

- [ ] **Step 10: Verifica browser (obbligatoria)**

Avviare la dev (`pnpm --filter piattaforma dev`), fare login come admin (ruolo Admin/AD/CTO/Sales Manager), e con `chrome-devtools` MCP:
1. Navigare a `/admin/crm/mappa`.
2. `take_snapshot` → confermare che la voce **Mappa** è nella sidebar CRM e la pagina renderizza la mappa d'Italia.
3. Se il DB locale ha sedi geocodate (post-backfill): confermare i **cluster** blu/arancioni col numero; zoomando (`click`/interazione) i cluster si aprono in pallini; click su un pallino apre l'**infowindow**; i **toggle** Broker/Agenzie accendono/spengono i layer e i conteggi in legenda sono corretti.
4. Se il DB non ha ancora coordinate: confermare che la mappa carica centrata sull'Italia, la legenda mostra i conteggi (anche 0), e — se applicabile — la nota "N sedi non ancora geolocalizzate". Poi rieseguire dopo il backfill (Task 6, Step 4).

Verificare sul DOM renderizzato, non solo per URL.

- [ ] **Step 11: Commit**

```bash
git add apps/piattaforma/package.json apps/piattaforma/src/lib/crm/mappa-colors.ts apps/piattaforma/src/lib/crm/mappa-colors.test.ts apps/piattaforma/src/app/admin/crm/mappa/ apps/piattaforma/src/components/admin/admin-icons.tsx apps/piattaforma/src/components/admin/admin-shell.tsx
git commit -m "feat(crm): pagina /admin/crm/mappa con mappa clusterizzata iscrizioni"
```

---

## Self-Review

**Spec coverage:**
- §1 Modello dati → Task 1 ✅
- §2 Cattura client (AddressAutocomplete + sede create/edit) → Task 3, Task 4 ✅
- §3 Geocoder server + geocode-on-save + post-commit registrazione → Task 2 (geocodeAddress), Task 3/4 (on-save), Task 5 (post-commit) ✅
- §4 Backfill → Task 6 ✅
- §5 Query punti → Task 7 ✅
- §6 Pagina + client map (2 layer cluster, toggle, infowindow, nota non-geolocalizzate) → Task 8 ✅
- §7 Sidebar → Task 8 (Step 5-6) ✅
- Error handling (geocode null-safe, empty-state chiave assente) → Task 2 + Task 8 (Step 8) ✅
- Test & verifica (unit + DB reale + browser) → Task 2/3/4/5/7 (unit), Task 7 Step 4 (DB reale), Task 8 Step 10 (browser) ✅
- Prereq Google Cloud → Global Constraints ✅

**Type consistency:** `GeocodeInput`, `geocodeAddress`, `parseCoords`, `geocodeCompanySedi`, `MappaPoint`, `MappaData`, `getMappaPoints`, `pointColor`/`DEALER_COLOR`/`AGENZIA_COLOR` usati con firme identiche tra i task che li producono e li consumano. ✅

**Placeholder scan:** nessun TODO/TBD; ogni step con codice mostra il codice. Le uniche note "verificare il path reale" (Task 4 gate permesso, Task 8 nomi API markerclusterer) sono verifiche di allineamento a codice esistente, non placeholder di implementazione. ✅
