# Distribuzione pratiche a raggio-km — Design

- **Data:** 2026-07-19
- **Autore:** Francesco Sioli (CTO) + Claude
- **Stato:** approvato, pronto per il piano
- **Ambito:** distribuzione pratiche (`lib/distribuzione`), wizard nuova pratica, geo, schema Pratica

## 1. Contesto e problema

Oggi la distribuzione di una nuova pratica alle agenzie è **per provincia**
(`lib/distribuzione/tick.ts` → `avviaRound`): round 1 = stessa provincia (top 5
per ranking), round 2 = province confinanti (`province-limitrofe.ts`), round 3 =
di nuovo la provincia (fino a 15 totali), poi escalation. Non usa distanza reale.

Vogliamo passare a una distribuzione **a raggio-km reale** dalle coordinate del
luogo scelto dal broker, che è molto più precisa (soprattutto vicino ai confini
provinciali).

## 2. Cosa esiste già (de-risk)

- **L'autocomplete cattura già le coordinate.** `components/address-autocomplete.tsx`
  (righe 166-173) fa `fetchFields({ fields: ['addressComponents', 'location'] })`
  e passa `lat`/`lng` nel callback `onSelect` (`AddressParts.lat/lng`). Oggi il
  wizard le **scarta** (la Pratica non ha campi per salvarle).
- **Le sedi hanno già `lat`/`lng`** (`Sede.lat/lng/geocodedAt`, schema ~649-654),
  best-effort. Geocoding a monte già esistente: `lib/geo/geocode-sedi.ts`
  `geocodeCompanySedi()` (post-registrazione), `scripts/geocode-backfill.ts`, e le
  server action di create/update sede salvano le coord (`app/sedi/actions.ts` +
  test `actions.createsede-coords`/`updatesede-coords`).
- **`lib/geo/coords.ts`** ha `parseCoords` (parse difensivo, puro). Manca solo un
  helper distanza.
- Il meccanismo di **esclusione per ciclo/revoca** (`sediDaEscludere`,
  `distribuzioneCiclo`, revoca admin) è indipendente dalla selezione geografica e
  va riusato tale e quale.

## 3. Il gap

- La **Pratica non ha `lat`/`lng`** (solo `comune`/`provincia`) → vanno aggiunti e
  persistiti al submit.
- Il motore usa provincia/cap/ranking → va riscritto a raggio.
- Serve un helper **distanza Haversine**.
- Serve rendere **obbligatoria la selezione del luogo** (coord garantite).
- Serve gestire le **sedi senza coord** (escluse) e la loro visibilità admin.

## 4. Decisioni prese

> **Emendamento 2026-07-19 (pre-merge):** raggi ridotti a **500/750/1000 m**,
> finestre a **4h**, e **pool cumulativo** — le agenzie dei round precedenti
> restano accettabili (non vanno più in TIMEOUT all'avanzamento). Punti 1, 6, 8
> aggiornati sotto.

1. **Raggi per round:** round 1 = **500 m**, round 2 = **750 m**, round 3 =
   **1000 m** (`RAGGI_KM = [0.5, 0.75, 1]`), poi escalation.
2. **Anelli incrementali:** ogni round contatta solo le sedi **nuove** che entrano
   nel raggio allargato (le interne hanno già l'assegnazione del round precedente,
   che ora resta accettabile — vedi punto 8).
3. **Pratica senza coord:** il broker **deve** selezionare un luogo dall'autocomplete
   → coord garantite. **Nessun fallback provincia**, motore solo a raggio.
4. **Sedi senza coord:** **escluse** dal raggio + geocoding a monte (già esistente) +
   visibilità admin sulle non geocodate.
5. **Distanza in JS (Haversine)**, non in SQL (agenzie poche; semplice e testabile;
   pre-filtro bounding-box SQL rimandato a scala molto maggiore).
6. **Finestre 4h/4h/4h** lavorative (~12h totali), non più 8h.
7. **Anello vuoto → salto immediato al raggio successivo** (niente attesa se
   nell'anello non ci sono sedi nuove; se anche 1 km è vuoto → escalation immediata).
8. **Pool cumulativo + scadenza allineata:** al passaggio di round le agenzie **già
   contattate restano `PENDING`** (continuano a vedere e poter accettare — l'azione
   di accettazione le supporta già). L'avanzamento è **guidato dal tempo**: alla
   scadenza della finestra corrente, si aprono le sedi **nuove** dell'anello E si
   **ri-armano** le agenzie PENDING scadute con una finestra fresca (4h, sugli orari
   di ciascuna sede) → tutto il pool condivide la scadenza corrente, che avanza. Le
   agenzie che hanno **rifiutato** restano fuori. Le agenzie precedenti **non**
   vengono ri-notificate via email all'allargamento (restano nella loro inbox); solo
   le nuove ricevono la N6. **Escalation** solo alla scadenza della finestra del
   round 3 con nessuno che ha accettato → allora TIMEOUT a tutti + escalation.

## 5. Design

### 5.1 Modello dati (Pratica)

```prisma
// Coordinate del luogo di consegna (da Google Places autocomplete). Nullable:
// le bozze non le hanno ancora; valorizzate al submit (obbligatorie, vedi 5.2).
// Guidano la distribuzione a raggio. `comune`/`provincia` restano (notifiche/
// monitoraggio) ma NON guidano più la distribuzione.
lat Float?
lng Float?
```
Migration a mano (additiva). NON serve `geocodedAt` sulla pratica: le coord
arrivano dirette dalla selezione, non da un geocoding.

### 5.2 Cattura & persistenza coord nel wizard

- Il campo luogo del wizard usa già `AddressAutocomplete`; nello stato del wizard
  si tengono anche `lat`/`lng` dalla selezione (oltre a comune/provincia già
  gestiti).
- **Submit obbligato:** la validazione del submit richiede `lat`/`lng` presenti e
  valide (via `parseCoords`). Se mancano → errore di campo sul luogo ("Seleziona
  il luogo dall'elenco"), submit bloccato. Cioè: non basta digitare comune/provincia
  a mano, va scelto un risultato dell'autocomplete.
- La create-action (`app/pratiche/nuova/actions.ts`) aggiunge `lat`/`lng` allo zod
  schema e le salva su `Pratica`.

### 5.3 Helper distanza

In `lib/geo/coords.ts` (puro, browser-safe), nuovo:
```ts
export function distanceKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number
```
Formula Haversine (raggio terrestre 6371 km). Con test (distanze note + simmetria +
zero su punto identico).

### 5.4 Motore (`lib/distribuzione`)

**`constants.ts`** — sostituire i parametri di selezione:
```ts
export const DISTRIBUZIONE = {
  RAGGI_KM: [0.5, 0.75, 1], // round 1 / 2 / 3 = 500/750/1000 m
  T1_HOURS: 4, T2_HOURS: 4, T3_HOURS: 4,
} as const;
```
Spariscono `N_PER_ROUND` e `N_MAX` (niente cap: tutte le sedi nell'anello).
`RANKING`/`ANTI_ABUSO` restano (auto-suspend, decay) ma il ranking **non seleziona
più** i candidati.

**`avviaRound` (riscrittura selezione)** — per il round `r`:
1. Carica le sedi agenzia **idonee** con gli stessi filtri di oggi (type AGENZIA,
   non `deletedAt`/`suspendedAt`, madre non bloccata/sospesa, **visura valida**),
   **con `lat`/`lng` non null**, ed **escludendo** `sediDaEscludere(pratica)` (già
   contattate nel ciclo + revocate permanenti).
2. Filtra per `distanceKm(pratica, sede) <= RAGGI_KM[r-1]`.
3. **Tutte** le sedi risultanti ricevono l'assegnazione (nessun cap, nessuna
   selezione per ranking). Finestra countdown = `T{r}_HOURS` (4h), con gli orari
   di apertura della sede (invariato, `computeCountdown`).
4. **Anello incrementale gratis:** siccome `sediDaEscludere` esclude già le sedi
   dei round precedenti, "entro il raggio r meno le già contattate" = la corona tra
   il raggio r-1 e r.
5. **Cascade su anello vuoto:** se al round `r` non ci sono sedi nuove, si avanza
   **subito** al round `r+1` (raggio maggiore) nello stesso tick; se `r=3` e vuoto
   → escalation immediata.

**`tickPratica` (pool cumulativo — riscrittura avanzamento):** non è più "timeout
del round corrente → avanza". Ora:
- si guardano **tutte** le assegnazioni `PENDING` (di qualunque round), non solo
  quelle del round corrente;
- se qualcuna è `ACCETTATA` → risolto (noop);
- se **tutte** le `PENDING` hanno la finestra ancora aperta (`countdownFineAt > now`)
  → attesa;
- se **tutte** le `PENDING` hanno la finestra scaduta e nessuno ha accettato:
  - `round < 3` → **avanza**: `avviaRound(nextRound)` (apre le sedi nuove
    dell'anello) **e ri-arma** le `PENDING` scadute con una finestra fresca
    (`computeCountdown(now, 4h, orariSede)` per sede) — **nessun TIMEOUT**, restano
    accettabili;
  - `round = 3` → **escalation**: TIMEOUT a **tutte** le `PENDING` + `IN_ESCALATION`
    + notifiche N10/N11 (qui l'anti-abuso `checkAutoSuspendForSedi` scatta sui
    no-show, come prima ma tutto in una volta).

Accettazione (`inbox/actions.ts`): **invariata** — cerca già `esito: 'PENDING'` di
qualunque round, quindi un'agenzia early che è ancora PENDING può accettare.
Revoca/ricircolo (`distribuzioneCiclo`) invariato: al nuovo ciclo si riparte dal
round 1 (500 m) escludendo le sedi revocate permanenti.

### 5.5 Sedi senza coordinate

- Escluse dalla distribuzione (punto 5.4.1, `lat`/`lng` not null).
- Geocoding a monte già presente (`geocodeCompanySedi`, backfill, actions sede):
  assicurarsi che copra le **agenzie** e lanciare il backfill sulle esistenti.
- **Visibilità admin:** indicatore/conteggio delle sedi agenzia attive **non
  geocodate** (lat null), così l'admin sa chi non riceve pratiche e può sanare.
  Superficie minima (conteggio + lista), non un flusso nuovo.

### 5.6 Pulizia

`province-limitrofe.ts` (+ test) esce dal motore → rimosso (codice morto dopo la
riscrittura). `comune`/`provincia` sulla Pratica **restano** come metadati.

## 6. Edge case & non-goal

- **Pratica in bozza**: `lat`/`lng` null finché non si seleziona il luogo; il submit
  li rende obbligatori. Nessuna pratica **submitted** priva di coord (per costruzione).
- **Nessuna sede entro 1 km**: escalation (come oggi quando la zona è scoperta).
- **Sede geocodata tra un round e l'altro**: entra al round successivo (nessun
  trattamento speciale — il filtro coord è valutato ad ogni round).
- **Ri-arma**: al passaggio di round si ri-arma solo le `PENDING` **scadute** (le
  nuove hanno già finestra fresca); i `RIFIUTATA` restano fuori (non tornano in
  gioco). Le `PENDING` di round diversi condividono così una scadenza che avanza.
- **Fuori scope ora:** raggi/finestre editabili da admin (restano costanti,
  predisposti); pre-filtro distanza in SQL/PostGIS (solo a scala molto maggiore);
  ranking come tie-break (non serve: tutte ricevono).

## 7. Test

- `distanceKm`: distanze note (es. due punti a ~X km), simmetria, 0 su identico.
- `avviaRound` (riscritto): seleziona tutte le sedi entro il raggio del round
  (500/750/1000 m); esclude quelle senza coord; esclude le già contattate (anello
  incrementale); cascade su anello vuoto (0 nuove → avanza subito); escalation dopo
  round 3; visura scaduta / sospese / bloccate restano escluse.
- `tickPratica` (pool cumulativo): all'avanzamento le PENDING dei round precedenti
  **NON** vanno in TIMEOUT (restano accettabili) e vengono **ri-armate** con finestra
  fresca; l'avanzamento scatta quando **tutte** le PENDING sono scadute; l'escalation
  (solo a round 3) mette in TIMEOUT **tutte** le PENDING. Un'agenzia early PENDING
  può accettare mentre la pratica è in un round successivo.
- Wizard/action: submit senza coord → bloccato con errore sul luogo; submit con
  coord → salvate su Pratica.
- Regressione: revoca/ricircolo riparte dal raggio 2 km escludendo le revocate.

## 8. Rischi / open

- **Copertura geocoding agenzie**: se molte agenzie reali non sono geocodate,
  ricevono zero pratiche → il backfill + la visibilità admin (5.5) sono parte della
  release, non un dopo.
- **UX obbligo selezione**: il broker deve scegliere dall'autocomplete; verificare
  che il flusso resti fluido (comune/provincia si auto-compilano dalla selezione).
- **Volume notifiche in zone dense**: senza cap (per scelta), in un'area urbana con
  molte agenzie entro 2 km partono altrettante assegnazioni/email N6 in una volta.
  Accettato ora; se diventasse un problema si valuterà un cap alto di sicurezza.

## 9. File previsti (indicativo)

- `packages/db/prisma/schema.prisma` — `Pratica.lat/lng` + migration a mano.
- `lib/geo/coords.ts` — `distanceKm` (+ test).
- `app/pratiche/nuova/wizard.tsx` + `actions.ts` — cattura/persistenza coord +
  obbligo selezione.
- `lib/distribuzione/constants.ts` — `RAGGI_KM`, finestre; via `N_PER_ROUND`/`N_MAX`.
- `lib/distribuzione/tick.ts` — riscrittura selezione in `avviaRound` + cascade.
- `lib/distribuzione/province-limitrofe.ts` (+ test) — rimossi.
- Admin: visibilità sedi agenzia non geocodate.
- Backfill geocoding sedi agenzia esistenti.
