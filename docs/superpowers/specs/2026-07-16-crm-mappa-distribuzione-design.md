# CRM — Mappa distribuzione iscrizioni sul territorio

**Data:** 2026-07-16
**Stato:** design approvato, pronto per il piano

## Obiettivo

Nuova pagina `/admin/crm/mappa` (gruppo CRM della sidebar admin): una mappa
d'Italia che mostra la distribuzione territoriale delle aziende **iscritte** alla
piattaforma. Un puntino per ogni **luogo fisico** — sede madre + ogni sede
operativa — colorato per tipo:

- **blu** = broker (`CompanyType.DEALER`)
- **arancione** = agenzia (`CompanyType.AGENZIA`)

Con lo zoom impostato sull'Italia i puntini vicini si raggruppano in **cluster**
(cerchio col conteggio); zoommando, i cluster si aprono nei singoli pallini.
La mappa include sia gli iscritti **da lista CRM** sia gli **organici / auto-iscritti**
(nessun filtro sull'origine: sono tutte aziende presenti in `Company`).

## Premessa corretta rispetto alla richiesta iniziale

La richiesta assumeva *"tanto abbiamo le coordinate"*. **Non è vero**: verificato
sullo schema (`packages/db/prisma/schema.prisma`) e sull'intero codice
applicativo, **non esiste alcun campo lat/lng e nessun codice di geocoding**.
Abbiamo solo indirizzi testuali (`indirizzo/civico/citta/cap/provincia` su
`Company` e `Sede`) e la Google Places API usata *solo* per l'autocomplete
indirizzi (`address-autocomplete.tsx`, che fa `fetchFields(['addressComponents'])`
— non cattura `location`). Quindi il grosso della feature è **procurarsi le
coordinate**, non disegnare la mappa.

## Decisioni

| Tema | Scelta |
|---|---|
| Sorgente coordinate | Geocoding reale con Google (no centroidi) |
| Chiave API | Riuso `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` anche lato server, allargando le restrizioni della chiave |
| Libreria mappa | Google Maps JS (`@googlemaps/js-api-loader`, già presente) + `@googlemaps/markerclusterer` (nuova dep) |
| Stile cluster | Due layer separati: blu (broker) + arancione (agenzie), indipendenti, con toggle |
| Unità del puntino | Ogni sede operativa: Company-madre + ogni `Sede` |
| Collocazione | Voce dedicata "Mappa" nel gruppo CRM (`/admin/crm/mappa`), non nella dashboard |
| Infowindow al click | Sì (nome / indirizzo / tipo / madre-o-sede) |

Alternative valutate e scartate: Leaflet+OSM (introdurrebbe un provider di tile
inutile, abbiamo già Google), centroidi comune offline (nessuna precisione reale
— esclusa), cluster "donut" bicolore unico (più lavoro), un-puntino-per-azienda
(perde le sedi distaccate).

## Architettura

### 1. Modello dati (`packages/db/prisma/schema.prisma`)

Aggiungere a **`Company`** e a **`Sede`** tre campi nullable:

```prisma
lat        Float?
lng        Float?
geocodedAt DateTime?
```

Nullable perché: (a) il geocoding può fallire o essere in coda; (b) il backfill è
progressivo. `geocodedAt` distingue "mai geocodato" (null) da "geocodato ma senza
risultato" (valorizzato con lat/lng null) e permette ri-geocodifiche mirate.

**Migration a mano** (additiva, `ALTER TABLE ... ADD COLUMN`). NON usare
`prisma migrate dev` — su questo schema propone DROP SEQUENCE distruttive. Si
scrive lo SQL a mano e si applica con `migrate deploy`.

### 2. Geocoding — cattura in scrittura (client)

`apps/piattaforma/src/components/address-autocomplete.tsx`:

- `fetchFields({ fields: ['addressComponents', 'location'] })`.
- Estendere `AddressParts` con `lat?: number; lng?: number` letti da
  `place.location?.lat()` / `.lng()`.
- I consumatori che creano/modificano **azienda** e **sede** propagano lat/lng al
  save:
  - `app/(auth)/register/register-wizard.tsx` → indirizzo Company madre
  - `app/sedi/sede-create-form.tsx` e `app/sedi/[id]/sede-edit.tsx` → indirizzo Sede
  - (`app/pratiche/nuova/wizard.tsx` usa l'autocomplete per l'indirizzo della
    *pratica*, non serve alla mappa → invariato)

### 3. Geocoding — server + fallback

`apps/piattaforma/src/lib/geo/geocode.ts`:

- `geocodeAddress(parts): Promise<{ lat: number; lng: number } | null>` — wrapper
  sulla Google Geocoding REST API (`https://maps.googleapis.com/maps/api/geocode/json`),
  chiave letta da `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (le env var sono
  leggibili server-side a prescindere dal prefisso `NEXT_PUBLIC`).
- Tollerante: ritorna `null` su `ZERO_RESULTS`, errore di rete, quota, o chiave
  mancante. Mai lancia verso il chiamante.
- **Fallback su save**: nelle server action che creano/modificano Company e Sede,
  se il client non ha fornito lat/lng (es. indirizzo digitato a mano senza
  selezionare dal dropdown) o l'indirizzo è cambiato, chiamare `geocodeAddress`
  best-effort. Il fallimento non blocca il salvataggio (coord restano null).

### 4. Backfill sedi già registrate

`apps/piattaforma/scripts/geocode-backfill.ts`:

- Itera **Company** e **Sede** con `lat` null, geocoda l'indirizzo, scrive
  lat/lng + `geocodedAt`.
- Rate-limited (pausa tra le chiamate) e **idempotente** (ri-eseguibile: salta chi
  ha già `geocodedAt`).
- Logga esiti: geocodati / falliti (con indirizzo), così i falliti sono visibili e
  correggibili a mano.
- Va lanciato una volta sulle sedi broker/agenzia esistenti. Testato prima sul DB
  locale (che è copia di prod).

### 5. Query punti mappa

`apps/piattaforma/src/lib/crm/mappa-points.ts`:

- `getMappaPoints()` → unione dei luoghi fisici delle **aziende iscritte** con
  coordinate valide:
  - Company-madre con `lat`/`lng` non null
  - `Sede` con `lat`/`lng` non null
- Ogni punto: `{ id, kind: 'company' | 'sede', type: 'DEALER' | 'AGENZIA', lat, lng, nome, citta, provincia }`.
- Ritorna anche il **conteggio dei non geolocalizzati** (Company/Sede senza coord),
  da mostrare in chiaro nella pagina (niente troncamenti silenziosi).
- La query si prova sul DB locale read-only prima di chiudere.

### 6. Pagina + mappa client

- `app/admin/crm/mappa/page.tsx` (server component):
  - Auth-gate admin (coerente con le altre pagine CRM: `AppShell` fa early-return
    ad `AdminShell` per `ADMIN_PIATTAFORMA`/`ASSISTENTE`; gating fine come la
    dashboard CRM se serve).
  - Chiama `getMappaPoints()` e passa i punti + il conteggio non-geolocalizzati al
    client.
  - Renderizza dentro `<AppShell session={session} activePath="/admin/crm/mappa">`.
- `app/admin/crm/mappa/mappa-client.tsx` (`'use client'`):
  - Carica la libreria `maps` via `@googlemaps/js-api-loader` (import dinamico,
    stesso pattern di `address-autocomplete.tsx` per evitare l'accesso a `window`
    in SSR).
  - Mappa centrata sull'Italia (≈ lat 42, lng 12.5, zoom 5–6).
  - **Due `MarkerClusterer`** distinti (uno per DEALER, uno per AGENZIA) con
    **renderer di cluster custom** colorato (blu / arancione) che mostra il
    conteggio del proprio tipo.
  - Pallini colorati per tipo; **infowindow** al click (nome, indirizzo, tipo,
    madre-o-sede).
  - **Legenda** con conteggi live e **chip toggle** per accendere/spegnere ciascun
    layer.
  - **Nota** "N sedi non ancora geolocalizzate" quando presenti.
  - Empty-state pulito se manca `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (come fa già
    l'autocomplete che ritorna `null`).

### 7. Sidebar

`apps/piattaforma/src/components/admin/admin-shell.tsx` — nel gruppo `CRM` di
`NAV_GROUPS` aggiungere:

```tsx
{ href: '/admin/crm/mappa', label: 'Mappa', icon: IconMappa },
```

con una nuova icona in `admin-icons`.

## Prerequisiti di configurazione (Google Cloud)

- Abilitare **Maps JavaScript API** e **Geocoding API** sul progetto (oggi è attiva
  solo Places).
- **Allargare le restrizioni** della chiave `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` così
  che le chiamate server-side al Geocoding (senza HTTP referrer) passino:
  restrizione applicazione "Nessuna" o per IP, e restrizione API che includa
  Places + Maps JS + Geocoding. Nota: la chiave è già pubblica (esposta come
  `NEXT_PUBLIC` nel browser), quindi allargare l'app-restriction non cambia
  sostanzialmente l'esposizione; il contenimento del rischio è via restrizione-API
  + quota di billing.

## Error handling

- Geocoding fallito → coord null → punto escluso dalla mappa e conteggiato nella
  nota "non geolocalizzate". Nessun crash.
- Chiave mappa mancante → empty-state pulito.
- Rate-limit nel backfill → pausa/retry.

## Test & verifica

- **Unit**: `geocode.ts` (mock fetch: hit / ZERO_RESULTS / errore / chiave
  assente), mappatura tipo→colore, `getMappaPoints` (union Company+Sede,
  esclusione dei null, conteggio non-geolocalizzati).
- **DB reale**: eseguire la query punti sul DB locale (copia di prod) in read-only
  prima di chiudere.
- **Browser (obbligatorio)**: login admin → `/admin/crm/mappa` → verificare vista
  Italia, cluster blu/arancioni col numero, toggle dei layer, zoom che apre i
  cluster nei singoli pallini, infowindow al click. La sola navigazione per URL non
  basta: verifica sul DOM renderizzato.

## Costo

Geocoding ~$5/1000 richieste → backfill di poche centinaia di sedi = spiccioli.
Map load (Dynamic Maps) ~$7/1000, uso solo-admin = trascurabile.

## Fuori scope (possibili evoluzioni)

- Layer dei **lead** non ancora iscritti (`CrmContact`) come terzo tipo filtrabile.
- Filtri per periodo di iscrizione / origine (da-lista vs organico).
- Feature "agenzie entro X km" da coordinate (già prevista in
  `lib/distribuzione/province-limitrofe.ts`), abilitata dai nuovi campi lat/lng.
