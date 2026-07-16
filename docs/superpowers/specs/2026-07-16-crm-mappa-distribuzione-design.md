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
| Chiave API | **Due chiavi**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (pubblica, referrer-restricted) per Places/Maps nel browser; `GOOGLE_GEOCODING_API_KEY` (dedicata, server-only, no referrer, ristretta a Geocoding) per le chiamate server. Vedi §"Prerequisiti" |
| Libreria mappa | Google Maps JS (`@googlemaps/js-api-loader`, già presente) + `@googlemaps/markerclusterer` (nuova dep) |
| Stile cluster | Due layer separati: blu (broker) + arancione (agenzie), indipendenti, con toggle |
| Unità del puntino | Ogni `Sede` (la sede madre è già una `Sede`: la registrazione ne crea sempre almeno una — vedi sotto) |
| Collocazione | Voce dedicata "Mappa" nel gruppo CRM (`/admin/crm/mappa`), non nella dashboard |
| Infowindow al click | Sì (nome sede / città-provincia / tipo) |

Alternative valutate e scartate: Leaflet+OSM (introdurrebbe un provider di tile
inutile, abbiamo già Google), centroidi comune offline (nessuna precisione reale
— esclusa), cluster "donut" bicolore unico (più lavoro), un-puntino-per-azienda
(perde le sedi distaccate).

## Architettura

### 1. Modello dati (`packages/db/prisma/schema.prisma`)

Le coordinate vanno **solo su `Sede`**, non su `Company`. Motivo di correttezza:
la registrazione (`app/(auth)/actions.ts`) crea **sempre almeno una `Sede`** —
le sedi dello step wizard, oppure una singola sede derivata 1:1 dall'indirizzo
azienda. Quindi ogni luogo fisico (HQ incluso) è già una `Sede`; mettere le
coordinate anche sulla `Company` madre farebbe **doppioni** dell'HQ sulla mappa.
Come bonus, la logica geografica futura (`lib/distribuzione/tick.ts`) lavora già
per `Sede`, quindi coordinate a livello di `Sede` sono anche il livello giusto per
il "agenzie entro X km".

Aggiungere a **`Sede`** tre campi nullable:

```prisma
lat        Float?
lng        Float?
geocodedAt DateTime?
```

Nullable perché: (a) il geocoding può fallire o essere in coda; (b) il backfill è
progressivo. `geocodedAt` = timestamp dell'ultima geolocalizzazione **riuscita**;
resta `null` se non è mai riuscita, così il backfill (che seleziona `lat: null`)
ci riprova ai giri successivi senza dover distinguere casi.

**Migration a mano** (additiva, `ALTER TABLE ... ADD COLUMN`). NON usare
`prisma migrate dev` — su questo schema propone DROP SEQUENCE distruttive. Si
scrive lo SQL a mano e si applica con `migrate deploy`.

### 2. Geocoding — cattura in scrittura (client)

`apps/piattaforma/src/components/address-autocomplete.tsx`:

- `fetchFields({ fields: ['addressComponents', 'location'] })`.
- Estendere `AddressParts` con `lat?: number; lng?: number` letti da
  `place.location?.lat()` / `.lng()`.
- Cablaggio (solo dove è economico threadare le coordinate come campi
  passthrough, senza toccare gli schemi zod di validazione):
  - `app/sedi/sede-create-form.tsx` + `createSedeAction` → sede creata a mano
  - `app/sedi/[id]/sede-edit.tsx` + `updateSedeAction` → sede modificata
  - Il **register-wizard** (file grande, sedi create in transazione) NON viene
    threadato: le sedi nuove da registrazione si geocodano **post-commit**
    server-side (vedi §3), fuori dalla transazione. `app/pratiche/nuova/wizard.tsx`
    usa l'autocomplete per l'indirizzo *pratica* → invariato.

### 3. Geocoding — server (backbone di copertura)

`apps/piattaforma/src/lib/geo/geocode.ts`:

- `geocodeAddress(parts): Promise<{ lat: number; lng: number } | null>` — wrapper
  sulla Google Geocoding REST API (`https://maps.googleapis.com/maps/api/geocode/json`),
  chiave letta da `process.env.GOOGLE_GEOCODING_API_KEY`, con fallback su
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` per gli ambienti dove la dedicata non è
  configurata (il fallback funziona solo se quella chiave non ha restrizioni
  referrer).
- Tollerante: ritorna `null` su `ZERO_RESULTS`, errore di rete, quota, o chiave
  mancante. Mai lancia verso il chiamante.
- **Geocode-on-save (mai in transazione)**: garantisce la copertura di tutte le
  sedi nuove indipendentemente dal client.
  - `createSedeAction` / `updateSedeAction`: se il client ha fornito lat/lng
    (Places) le usa; altrimenti (o se l'indirizzo è cambiato) chiama
    `geocodeAddress` best-effort prima di scrivere. Fallimento → coord null, il
    salvataggio non si blocca.
  - Registrazione (`app/(auth)/actions.ts`): **dopo** il commit del `$transaction`,
    geocodifica best-effort le sedi appena create e le aggiorna (nessuna chiamata
    di rete dentro la transazione).

### 4. Backfill sedi già registrate

`apps/piattaforma/scripts/geocode-backfill.ts`:

- Itera le **Sede** con `lat` null, geocoda l'indirizzo, scrive lat/lng +
  `geocodedAt`.
- Rate-limited (pausa tra le chiamate) e **idempotente** (ri-eseguibile: salta chi
  ha già `geocodedAt`).
- Logga esiti: geocodati / falliti (con indirizzo), così i falliti sono visibili e
  correggibili a mano.
- Va lanciato una volta sulle sedi broker/agenzia esistenti. Testato prima sul DB
  locale (che è copia di prod).

### 5. Query punti mappa

`apps/piattaforma/src/lib/crm/mappa-points.ts`:

- `getMappaPoints()` → una `Sede` = un punto, per le sole **aziende iscritte**
  (Sede non cancellata, Company madre non cancellata) con `lat`/`lng` non null.
- Ogni punto: `{ id, type: 'DEALER' | 'AGENZIA', lat, lng, nome, citta, provincia }`.
- Ritorna anche il **conteggio delle sedi non geolocalizzate** (coord null), da
  mostrare in chiaro nella pagina (niente troncamenti silenziosi).
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
  - Pallini colorati per tipo; **infowindow** al click (nome sede,
    città/provincia, tipo).
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

- Abilitare **Maps JavaScript API** e **Geocoding API** sul progetto (prima era
  attiva solo Places).
- **Due chiavi distinte** (deciso in corsa, 2026-07-16, dopo il fallimento del
  primo backfill in prod):
  - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — pubblica (finisce nel bundle del
    browser), **mantiene la restrizione per referrer HTTP**. Usata da Places
    (autocomplete) e Maps JS (rendering mappa). La cattura client delle
    coordinate funziona con questa.
  - `GOOGLE_GEOCODING_API_KEY` — **dedicata, server-only** (nessun prefisso
    `NEXT_PUBLIC`, mai esposta al browser): restrizione applicazione "Nessuna"
    (o per IP) e restrizione API alla **sola Geocoding API**. Usata dal
    geocoder server (`geocode-core.ts`), dal fallback su create/edit sede, dal
    geocode post-commit in registrazione e dallo script di backfill.

  **Perché due e non una**: la prima ipotesi era riusare la chiave pubblica
  allargandone le restrizioni. Provato in prod: Google risponde
  `REQUEST_DENIED — "API keys with referer restrictions cannot be used with
  this API"`. Per usarla server-side bisognerebbe toglierle la restrizione
  referrer — ma è una chiave già pubblica nel bundle, quindi chiunque la
  peschi potrebbe consumare Geocoding (a pagamento) sul nostro budget. La
  chiave server separata risolve entrambi i lati: la pubblica resta protetta
  dal referrer, la server non è mai esposta.

## Error handling

- Geocoding fallito → coord null → punto escluso dalla mappa e conteggiato nella
  nota "non geolocalizzate". Nessun crash.
- Chiave mappa mancante → empty-state pulito.
- Rate-limit nel backfill → pausa/retry.

## Test & verifica

- **Unit**: `geocode.ts` (mock fetch: hit / ZERO_RESULTS / errore / chiave
  assente), mappatura tipo→colore, `getMappaPoints` (una Sede = un punto,
  esclusione dei null e delle sedi/aziende cancellate, conteggio non-geolocalizzati).
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
