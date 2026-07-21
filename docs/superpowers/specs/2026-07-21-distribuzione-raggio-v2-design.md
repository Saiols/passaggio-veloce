# Motore Distribuzione v2 — Raggio incrementale + distanza stradale — Design

**Data:** 2026-07-21
**Fonte:** paper Alberto `docs/PassaggioVeloce RaggioAgenzie.docx` ("Algoritmo Matching Geografico — Agenzie", brief CTO Luglio 2026)
**Sostituisce:** `docs/superpowers/specs/2026-07-19-distribuzione-raggio-km-design.md` (v1: 3 round 500/750/1000m @ 4h, Haversine) — **deployata in prod ma da rimpiazzare.**

## Contesto

La distribuzione pratica→agenzia oggi in prod usa 3 round a raggio fisso (500/750/1000 m) con finestre 4h e distanza in **linea d'aria** (Haversine). Il nuovo brief la ridisegna in un'**espansione continua** del raggio con **distanza stradale reale**, notifiche cumulative eterne, pausa notturna e stato terminale "zona non coperta". È una riscrittura del motore, non un ritocco di parametri.

## Decisioni bloccate (con Francesco, 2026-07-21)

1. **Distanza:** ibrido — pre-filtro Haversine (condizione necessaria: strada ≥ linea d'aria) → **Google Distance Matrix** solo sui candidati, con cache per (pratica, sede). **Fail-open** su Haversine se la key manca o l'API è down.
2. **Orario lavorativo:** Lun-Ven 09:00–19:00 (platform-level, configurabile). Il **primo anello (500m) parte al submit a qualsiasi ora**; l'espansione successiva gira solo in orario e si mette in **pausa la notte**, riprendendo dal raggio corrente.
3. **Click simultaneo:** "primo atomico" — `SELECT … FOR UPDATE` sulla pratica in accettazione. Override del §6 del paper (niente "vince il raggio minore anche se clicca dopo"). Coerente con la landing pubblica ("la prima che accetta vince").
4. **Raggio massimo:** default globale **10 km**, editabile da admin. Il "per zona geografica" del paper è **fase 2** (YAGNI).

**OK espliciti su 3 conseguenze:**
- **Stato unico `IN_DISTRIBUZIONE`** al posto di `IN_ATTESA_ROUND_1/2/3`.
- **Auto-sospensione anti-abuso no-show disabilitata** (le notifiche non scadono più → niente TIMEOUT → niente trigger).
- **Distance Matrix API** da abilitare sul progetto Google esistente (server-side key).

## Parametri (da `DistribuzioneConfig`, con default)

| Parametro | Default | Note |
|---|---|---|
| `raggioStartM` | 500 | primo anello |
| `stepM` | 200 | incremento per step |
| `raggioMaxM` | 10000 | editabile admin; oltre → zona non coperta |
| `intervalloMin` | 10 | attesa tra step con anello non vuoto |
| `orarioInizio` / `orarioFine` | `09:00` / `19:00` | finestra espansione |
| `giorni` | `LUN,MAR,MER,GIO,VEN` | giorni attivi |

## Architettura

### Macchina a stati

`Pratica.stato`: nuovo valore **`IN_DISTRIBUZIONE`** (unico stato di distribuzione). I tre `IN_ATTESA_ROUND_1/2/3` restano **nell'enum** (log storici / righe legacy) ma **non vengono più prodotti**. Il raggio raggiunto vive su `Pratica`:

- `raggioCorrenteM Int?` — raggio corrente raggiunto (metri).
- `ultimaEspansioneAt DateTime?` — istante dell'ultima **notifica** inviata (valorizzato SOLO quando un anello non vuoto è stato notificato; gli anelli vuoti "skippati" non lo toccano). Governa il gate dei 10 minuti.
- `zonaNonCopertaAt DateTime?` — raggio max raggiunto senza accettazione.

Stati terminali/di uscita dalla distribuzione: `ACCETTATA`, `ANNULLATA`, `SCADUTA`, `FIRMATA` (invariati). `IN_ESCALATION` non è più prodotto da questo flusso (resta nell'enum; il concetto è sostituito da "zona non coperta").

### Ciclo di espansione (`tickPratica`)

Il cron `/api/jobs/distribuzione-tick` gira già ogni 10 min. Per ogni pratica `IN_DISTRIBUZIONE` (non accettata, non `zonaNonCopertaAt`):

1. **Gate orario:** se `now` è fuori `giorni`/`orario` → `noop('fuori orario')` (pausa; nessuno stato cambia).
2. **Gate 10 min:** se `ultimaEspansioneAt != null` e `minuti(now - ultimaEspansioneAt) < intervalloMin` → `noop('finestra 10min aperta')`.
3. **Espansione con skip degli anelli vuoti** (loop, dentro una transazione):
   - `next = raggioCorrenteM + stepM`.
   - se `next > raggioMaxM` → **zona non coperta**: `zonaNonCopertaAt = now`, log, coda email broker `N52`; `break`. Le notifiche pendenti **restano attive**.
   - trova le sedi candidate nel nuovo anello (vedi *Selezione candidati*) con **distanza stradale ≤ next**, non ancora contattate.
   - se **ce ne sono** → crea le `PraticaAssegnazione` (`raggioMetri = next`, `esito PENDING`, `invioAt = now`), `raggioCorrenteM = next`, `ultimaEspansioneAt = now`, log step, coda N6 + evento modale; `break` (avanzato di un anello notificato).
   - se **nessuna** → `raggioCorrenteM = next` (nessuna notifica, `ultimaEspansioneAt` invariato), `continue` (salta subito all'anello successivo, stesso tick).
4. Post-commit: invio N6 + eventi modale per le nuove assegnazioni; email broker `N52` se zona non coperta.

**Cadenza risultante:** un anello non vuoto notificato per tick (ogni 10 min in orario); gli anelli vuoti vengono attraversati istantaneamente nello stesso tick. La notte l'espansione è ferma; riprende la mattina dal `raggioCorrenteM` salvato.

### Primo anello al submit (`avviaRing1ForPratica`)

Al submit (qualsiasi ora, **ignora il gate orario**): `stato = IN_DISTRIBUZIONE`, `raggioCorrenteM = raggioStartM` (500). Cerca le sedi entro 500m (stradale):
- se ce ne sono → notifica (N6 + evento modale), `ultimaEspansioneAt = now`;
- se nessuna → nessuna notifica, `ultimaEspansioneAt = null` (il primo tick in orario espanderà subito).

**Nessuna espansione oltre il primo anello al submit** (l'espansione è compito del cron, in orario).

### Selezione candidati (invariata nella sostanza + prefiltro stradale)

Sede idonea = `type AGENZIA`, `deletedAt/suspendedAt null`, coordinate presenti, company non bloccata (pagamento/visura come oggi), **non** in `sediDaEscludere(pratica)` (esclude già-contattate nel ciclo + `REVOCATA_ADMIN` permanenti). Cumulatività e ciclo/revoca **invariati**.

Prefiltro distanza (due passaggi, per contenere il costo API):
1. **Haversine ≤ next** in memoria sulle sedi idonee (superset garantito: `strada ≥ linea d'aria`).
2. **`roadDistancesM`** (cache + provider) sul superset → tieni quelle con **stradale ≤ next**.

### Distanza stradale — `lib/geo/road-distance.ts`

```ts
type LatLng = { lat: number; lng: number };
interface RoadDistanceProvider {
  // metri stradali per sede; assente dalla mappa = non calcolabile
  distances(origin: LatLng, dests: { sedeId: string; coord: LatLng }[]): Promise<Map<string, number>>;
}
// GoogleDistanceMatrixProvider (batch ≤25 dest/richiesta) | MockProvider (Haversine*1000)
export async function roadDistancesM(
  praticaId: string,
  origin: LatLng,
  dests: { sedeId: string; coord: LatLng }[],
): Promise<Map<string, number>>; // legge cache → provider sui mancanti → scrive cache → fail-open Haversine
```

- **Cache** (`RoadDistanceCache`, unique `(praticaId, sedeId)`): si persistono **solo i risultati reali del provider Google** (le coord di pratica e sede sono fisse → cache valida indefinitamente, anche tra cicli/revoca). I **fallback Haversine NON si cachano** (così il tick successivo ritenta l'API).
- **Provider selection:** `DISTANCE_PROVIDER=google|mock`. `google` solo se `DISTANCE_PROVIDER=google` **e** key presente; altrimenti `mock`. In dev/test default `mock` (nessuna chiamata reale).
- **Fail-open:** qualunque errore/timeout/quota del provider → per quel batch si usa Haversine (metri) transitoriamente, senza cache. La distribuzione **non si blocca mai**.
- **Env:** `GOOGLE_DISTANCE_MATRIX_API_KEY` (opzionale; fallback su `GOOGLE_GEOCODING_API_KEY`, la server-key esistente). Richiede *Distance Matrix API* abilitata sul progetto.

### Accettazione — lock pessimistico (`inbox/actions.ts::acceptPratica`)

All'inizio della transazione, **prima** di leggere assegnazione/pratica:
```ts
await tx.$queryRaw`SELECT id FROM pratiche WHERE id = ${praticaId}::uuid FOR UPDATE`;
```
Poi il check stato (`=== 'IN_DISTRIBUZIONE'`) intercetta il perdente della corsa (il secondo si blocca sul lock, rilegge `ACCETTATA`, riceve *"Pratica già assegnata"*). Il resto resta com'è: assegnazione vincente → `ACCETTATA`; tutte le altre PENDING → `ASSEGNATA_ALTRO`; pratica → `ACCETTATA` con `agenziaAssegnata/Sede`, `accettataDaUserId`. Il check stato passa da `IN_ATTESA_ROUND_1/2/3` a `IN_DISTRIBUZIONE`.

### Zona non coperta

A `next > raggioMaxM` senza accettazione: `zonaNonCopertaAt = now`, **email broker `N52`** (nessuna agenzia entro il raggio massimo, suggerimento di contatto diretto) + evento modale broker. **Non è un vicolo cieco:** le PENDING restano attive (accettazione tardiva sempre possibile); l'espansione si ferma. Il monitoraggio admin mostra queste pratiche.

### Config admin

`DistribuzioneConfig` singleton (riga `id="singleton"`), letta via `getDistribuzioneConfig()` cache-aware (pattern `getTariffarioCorrente`). Pagina admin (area impostazioni distribuzione) edita **`raggioMaxM`** (gli altri campi esposti read-only o editabili, opzionale). Propagazione live come il tariffario.

### Modale pulsante

L'evento in-app "nuova pratica" (`eventoNuovaPratica`) apre una modale per l'agenzia. Aggiungere un'**animazione pulsante** (glow/scale, token design-system `pv-*`, nessun colore hardcoded) alla modale e/o al bottone "Accetta" per invogliare l'accettazione. Puro CSS/UI, indipendente dal motore.

## Modello dati (migration Neon, a mano — `prisma migrate dev` è distruttivo)

```prisma
enum PraticaStato { …; IN_DISTRIBUZIONE; … }   // aggiunto (i ROUND_* restano)

model Pratica {
  …
  raggioCorrenteM     Int?
  ultimaEspansioneAt  DateTime?
  zonaNonCopertaAt    DateTime?
}

model PraticaAssegnazione {
  …
  raggioMetri Int @default(0)   // anello d'ingresso (metri); countdown* diventano inutilizzati
}

model DistribuzioneConfig {
  id            String @id @default("singleton")
  raggioStartM  Int    @default(500)
  stepM         Int    @default(200)
  raggioMaxM    Int    @default(10000)
  intervalloMin Int    @default(10)
  orarioInizio  String @default("09:00")
  orarioFine    String @default("19:00")
  giorni        String @default("LUN,MAR,MER,GIO,VEN")
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
Migration: aggiunge enum value + colonne + 2 tabelle + seed riga `DistribuzioneConfig` singleton. Prod è usa-e-getta → nessun backfill obbligatorio delle pratiche esistenti (opz.: `UPDATE pratiche SET stato='IN_DISTRIBUZIONE' WHERE stato LIKE 'IN_ATTESA_ROUND_%'`). `raggioMetri` default 0 sulle righe storiche.

## Moduli

**Riscritti/modificati**
- `lib/distribuzione/tick.ts` — espansione a N anelli + skip vuoti + gate orario + zona non coperta; rimosse `escalatePratica`/`riarmaPendingScadute`/logica countdown 4h.
- `lib/distribuzione/constants.ts` → sostituito da `DistribuzioneConfig` DB (resta `RANKING` se ancora usato; `ANTI_ABUSO` rimosso).
- `app/inbox/actions.ts` — lock `FOR UPDATE` + check `IN_DISTRIBUZIONE`.
- `app/pratiche/nuova/actions.ts` — submit imposta `IN_DISTRIBUZIONE` + ring1.
- `lib/pratiche/stati.ts` + `lib/pratiche/tabs.ts` — mappano `IN_DISTRIBUZIONE` (fonte unica) dove prima i 3 ROUND.
- `app/admin/monitoraggio/*` — filtri/etichette su `IN_DISTRIBUZIONE` + "zona non coperta".
- componente modale evento "nuova pratica" — animazione pulsante.

**Nuovi**
- `lib/geo/road-distance.ts` + provider Google/Mock.
- `lib/distribuzione/orario-piattaforma.ts` — `isOrarioLavorativo(now, config)` (riusa primitive di `ore-lavorative.ts`).
- `lib/distribuzione/config.ts` — `getDistribuzioneConfig()` + default.
- pagina admin config distribuzione + action.
- template notifica `N52_BROKER_ZONA_NON_COPERTA` (in `lib/notifiche/templates.ts` + registry tipi + `layout.ts`).
- migration SQL + modelli Prisma.

**Rimossi (cleanup)**
- `lib/distribuzione/auto-suspend.ts` (+ test) e i suoi call-site — anti-abuso no-show non più raggiungibile.
- `countdown.ts` finestre 4h / `riarmaPendingScadute` (l'aritmetica business `ore-lavorative.ts` resta, riusata dall'orario piattaforma).

**Invariati**
- pool cumulativo, `sediDaEscludere` (ciclo + `REVOCATA_ADMIN`), N6 + `eventoNuovaPratica`, `PraticaStatoLog`, revoca/ricircolo admin, destinatari notifiche per sede.

## Edge case

- **Pratica senza coordinate:** guardia difensiva (il submit le rende obbligatorie). Senza coord → non calcolabile → zona non coperta immediata + log (non deve crashare il tick).
- **Nessuna agenzia in tutto il raggio max:** skip attraversa tutti gli anelli in un tick → zona non coperta.
- **API Google down all'espansione:** fallback Haversine (metri), nessuna cache → ritenta al tick dopo; la pratica avanza comunque.
- **Submit notturno, 500m vuoto:** nessuna notifica, `ultimaEspansioneAt=null` → primo tick in orario espande subito.
- **Accettazione dopo zona non coperta:** consentita (PENDING attive) → accept normale con lock.
- **Revoca admin (ciclo++):** riparte pulito (`raggioCorrenteM` riparte da 500 nel nuovo ciclo; `zonaNonCopertaAt` azzerato); sedi `REVOCATA_ADMIN` restano escluse; cache stradale riusabile.

## Test

- **Espansione:** anello vuoto→skip immediato; anello non vuoto→notifica+attesa 10min; cumulatività (anelli precedenti restano PENDING); max→zona non coperta; ripresa dopo pausa dal raggio corrente.
- **Distanza ibrida:** prefiltro Haversine è superset corretto; cache hit/miss; solo Google cachato, fallback no; provider mock nei test (zero chiamate reali).
- **Orario:** `isOrarioLavorativo` (dentro/fuori finestra, weekend); primo anello ignora l'orario; espansione lo rispetta.
- **Accettazione:** due accept concorrenti → uno vince, l'altro "già assegnata" (lock); assegnazioni altrui → `ASSEGNATA_ALTRO`.
- **Config:** parametri presi da DB (non da costanti); raggio max editato cambia il comportamento.
- Riscrivere `lib/distribuzione/tick.test.ts` sui nuovi comportamenti.

## Non-goal (fase 2)

- Raggio max **per zona geografica** (ora default globale editabile).
- Dashboard costi/quota Distance Matrix.
- Penali/leve anti-abuso alternative al no-show (rimosso per ora).

## Go-live

Feature su branch `feat/distribuzione-raggio-v2`. Prerequisiti deploy: migration Neon (prima del codice), `DISTANCE_PROVIDER=google` + key con Distance Matrix API abilitata su Vercel, backfill geocoding agenzie invariato. Poi riprende il runbook go-live sospeso (Stripe → apertura dominio).
