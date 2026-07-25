# Distribuzione: raggio in linea d'aria, round configurabili, metrica di accettazione

**Data:** 2026-07-25
**Stato:** approvato
**Sostituisce parzialmente:** `2026-07-21-distribuzione-raggio-v2-design.md`

## Problema

Il motore v2 in prod (dal 2026-07-22) espande il raggio in modo continuo — 500 m,
+200 m ogni 10 minuti, fino a 10 km — misurando la **distanza stradale reale**
(Google Distance Matrix, con cache e fail-open su Haversine). Non esiste più un
concetto di "round": `PraticaAssegnazione.round` è cablato a `1`.

Quattro richieste:

1. Il raggio è **in linea d'aria**: la distanza di percorso non serve.
2. Un round senza nemmeno un'agenzia deve passare **subito** al successivo, senza
   consumare il tempo di attesa.
3. Sulla pratica va salvato **il round in cui è stata accettata**, visibile solo
   all'admin, per calcolarne la media ("entro quanto vengono accettate").
4. L'admin deve poter regolare **raggio massimo (km)** e **durata del round (h)**.

## Decisioni

### Round = ordinale della notifica, non del raggio

Il round avanza **solo quando parte un batch di notifiche reale**. Gli anelli
vuoti fanno avanzare il raggio ma non il round e non consumano tempo. Ne segue
l'identità che rende utile la metrica:

```
round N  ≈  (N − 1) × durata_round
```

Una pratica accettata al round 1 è stata accettata entro la prima finestra,
indipendentemente dal fatto che l'anello utile fosse a 1 km o a 7 km. È la
domanda a cui il punto 3 vuole rispondere ("entro quanto"), non "a che distanza"
— la distanza resta comunque leggibile da `PraticaAssegnazione.raggioMetri`.

### Parametri e default

| Parametro | Colonna DB | Default nuovo | Default v2 |
|---|---|---|---|
| Raggio iniziale | `raggioStartM` | 1000 m | 500 m |
| Passo per round | `stepM` | 1000 m | 200 m |
| Raggio massimo | `raggioMaxM` | 10000 m | 10000 m |
| Durata round | `intervalloMin` | 60 min | 10 min |

Fino a 10 round che coprono ~una giornata lavorativa (orario piattaforma 9–19,
lun–ven, invariato). Il DB continua a memorizzare **metri e minuti**: la
conversione in km/ore avviene nel form admin. Nessuna colonna nuova sulla
config, nessuna ambiguità di unità nel motore.

## Architettura

### 1 · Distanza in linea d'aria

`candidatiEntro()` (in `lib/distribuzione/tick.ts`) calcola `distanzaM` con
`distanceKm(origine, sede) * 1000` e tiene le sedi con `distanzaM <= sogliaM`.
Cade il doppio passaggio "prefiltro Haversine → chiamata provider": una sola
passata sulle sedi idonee.

**Rimossi:**

- `lib/geo/road-distance.ts` + `road-distance.test.ts`
- `lib/geo/providers/distance-google.ts`, `lib/geo/providers/distance-mock.ts`
- modello Prisma `RoadDistanceCache` (`DROP TABLE road_distance_cache`)

Restano `lib/geo/coords.ts` (Haversine) e la env `GOOGLE_GEOCODING_API_KEY`, che
serve al geocoding delle sedi e alla mappa CRM — API diversa da Distance Matrix.

**La struttura anti-P2028 di `tickPratica` non cambia.** Senza chiamate di rete
il rischio di timeout della transazione interattiva sparisce, ma la sequenza
"candidati fuori tx → tx corta con compare-and-set su `raggioCorrenteM` /
`distribuzioneCiclo`" è ciò che protegge dalle accettazioni e revoche in race.
Resta invariata.

### 2 · Contatore di round

Nuove colonne su `Pratica`:

```prisma
roundCorrente     Int  @default(0)   // round dell'ultimo batch notificato
roundAccettazione Int?               // round in cui la pratica è stata accettata
```

- `roundCorrente` viene incrementato dentro la tx che crea le assegnazioni, e
  vale `1` al primo batch (submit o ricircolo). Un ricircolo dopo revoca
  (`distribuzioneCiclo` incrementato) **riparte da 1**: il round è relativo al
  ciclo corrente.
- `PraticaAssegnazione.round` riceve `roundCorrente` invece del `1` cablato. La
  colonna torna a significare quello che il suo nome dice.
- `roundAccettazione` viene scritto in `accettaPratica` (`app/inbox/actions.ts`)
  copiando `assegnazione.round`, nella stessa transazione che tiene il row lock
  `FOR UPDATE` — nessuna finestra in cui la pratica è `ACCETTATA` senza round.

Perché una colonna e non un valore derivato: le assegnazioni manuali di
escalation usano `round = 99` (`ESCALATION_ROUND`), quindi un `max(round)`
sarebbe avvelenato da quelle righe. La costante si sposta da
`app/admin/escalation/actions.ts` a `lib/distribuzione/constants.ts` ed è
**esclusa dalla media** (una pratica assegnata a mano dall'admin non dice nulla
sulla velocità della distribuzione automatica).

### 3 · Round vuoto → avanti subito

`prossimoAnello()` già scansiona a step e salta gli anelli vuoti **nello stesso
tick**: il comportamento richiesto esiste per i tick di espansione.

Il buco è al primo anello. Oggi `avviaRound1ForPratica()` cerca candidati solo
entro `raggioStartM`; se non ne trova, non notifica nessuno, lascia
`ultimaEspansioneAt = null` e aspetta il primo tick del cron — fino a 10 minuti
di silenzio anche quando c'è un'agenzia a 3 km.

Nuovo comportamento: i candidati si cercano fino a `raggioMaxM` e si applica
`prossimoAnello()` partendo da 0, esattamente come in un tick. Conseguenze:

- la prima notifica parte **al submit**, al primo anello non vuoto;
- se non c'è nessuna sede entro il raggio massimo, la pratica è dichiarata
  **zona non coperta subito** (N52 al broker al submit, non al primo tick utile).

`avviaRound1ForPratica` continua a ignorare l'orario lavorativo, come oggi.

### 4 · Config admin — `/admin/distribuzione`

Quattro campi editabili in unità umane:

| Campo | Default | Limiti |
|---|---|---|
| Raggio iniziale (km) | 1 | 0,1 – deve essere < raggio massimo |
| Passo per round (km) | 1 | 0,1 – 25 |
| Raggio massimo (km) | 10 | 1 – 50 |
| Durata round (h) | 1 | 0,25 – 24 |

Il minimo di 0,25 h (15 min) è vincolato dal cron, che gira ogni 10 minuti:
sotto quella soglia la durata configurata non sarebbe rispettabile. Il massimo
di 25 km sul passo evita che un solo round copra l'intero raggio.

Validazione zod cross-field in `admin/distribuzione/validate.ts`
(`raggioStartM < raggioMaxM`), con `raggioStartM` che ora **è** un campo del
form: la cross-validazione confronta i due valori inviati insieme, non più uno
inviato e uno letto dal DB.

Conversione: il client manda km e ore, l'action converte in metri e minuti
(`Math.round(km * 1000)`, `Math.round(h * 60)`) e fa `upsert` sul singleton.

### 5 · Visibilità (solo admin)

- **`/pratiche/[id]`** — nella card "Round distribuzione", già gated su
  `ADMIN_PIATTAFORMA` / `ASSISTENTE`: riga in evidenza *"Accettata al round N ·
  4,0 km"*.
- **`/admin/distribuzione`** — card in cima con media dei round di accettazione,
  numerosità del campione e breakdown per round (1, 2, 3, 4, 5+). Sta accanto ai
  campi che serve a tarare.
- **`/admin/pratiche`** — colonna "Round".
- **CSV `/api/admin/dashboard/export`** — colonna `roundAccettazione`.

**Mail N6 all'agenzia:** il template stampa oggi `Round ${p.round}` (sempre
"Round 1", essendo cablato). Con i round veri direbbe all'agenzia che non era la
prima scelta, mentre il dato deve restare admin-only: `round` esce dal payload
`N6AgenziaNuovaPayload` e dal template.

## Statistica

Una sola query aggregata in `lib/distribuzione/statistiche.ts`:

```ts
getStatisticheRound(): Promise<{
  media: number | null;      // null se campione vuoto
  campione: number;
  perRound: { round: number; count: number }[];  // round 5 = "5+"
}>
```

Filtro: `stato ∈ {ACCETTATA, FIRMATA}` — una pratica accettata e poi firmata
resta nel campione — `roundAccettazione != null`, `roundAccettazione < 99`,
`deletedAt: null`. Nessun filtro temporale: il campione è piccolo e serve tutto.

## Migration — due finestre, non una

SQL a mano + `db:deploy` (mai `db:migrate`, che propone `DROP SEQUENCE`). La
migration è **spezzata in due** perché contiene sia parti additive sia un DROP,
e i due tipi vanno in direzioni opposte rispetto al deploy:

| Quando | Migration | Contenuto |
|---|---|---|
| **Prima** del push | `20260725120000_distribuzione_round_config` | `ADD COLUMN` ×2, `SET DEFAULT` ×3, `UPDATE` del singleton |
| **Dopo** il deploy | `20260725130000_drop_road_distance_cache` | `DROP TABLE road_distance_cache` |

La parte additiva deve precedere il codice: il nuovo codice legge
`roundCorrente`/`roundAccettazione` dal primo request.

Il DROP deve **seguirlo**: il codice della release precedente legge
`road_distance_cache` in `roadDistancesM` con una `findMany` **non protetta da
try/catch**. Finché quella versione è viva, droppare la tabella farebbe lanciare
`avviaRound1ForPratica` — che al submit (`pratiche/nuova/actions.ts`) non è
catturato, quindi **la creazione pratica crasherebbe** — e farebbe accumulare
errori silenziosi nel cron (`tickAllPraticheInDistribuzione` cattura per-pratica
e conta, senza espandere nulla).

Il `SET DEFAULT` non tocca la riga già esistente: il singleton creato da
`20260721120000_distribuzione_v2` ha ancora 500/200/10, da cui l'`UPDATE`
esplicito. `raggioMaxM` è volutamente escluso: se l'admin l'ha già cambiato
dalla UI, il suo valore resta.

**Nessun backfill.** Il DB di prod è usa-e-getta: le pratiche già accettate
restano con `roundAccettazione = null`, mostrano "—" e sono fuori dal campione
della media.

## Test

- `anelli.test.ts` — invariato nella sostanza (il modulo non cambia), verificato
  con i nuovi valori di step.
- `tick.test.ts` — sparisce il mock di `roadDistancesM`; nuovi casi: il round
  incrementa solo sul batch notificato, non sugli anelli saltati; il ricircolo
  riparte da round 1; `avviaRound1ForPratica` notifica oltre `raggioStartM` al
  primo anello non vuoto; nessuna sede entro il massimo → zona non coperta al
  submit.
- `admin/distribuzione/actions.test.ts` — gate ruolo invariato, salvataggio dei
  quattro campi, conversione km/ore → metri/minuti, cross-validazione
  start < max.
- `statistiche.test.ts` — media, campione vuoto, esclusione del round 99,
  bucket "5+".
- `inbox/actions` — l'accettazione scrive `roundAccettazione` dal round
  dell'assegnazione.

## Fuori scope

- `/admin/escalation` e `ESCALATION_ROUND = 99` restano come sono: la
  costante si sposta di file, la funzionalità non si tocca.
- Orario piattaforma (9–19 lun–ven) e notifiche cumulative: invariati.
- Nessun filtro temporale o per zona sulla statistica.
