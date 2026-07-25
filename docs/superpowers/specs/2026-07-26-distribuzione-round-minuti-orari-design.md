# Distribuzione: durata round in minuti, calendario piattaforma, copertura diagnosticabile

**Data:** 2026-07-26
**Stato:** approvato
**Sostituisce parzialmente:** `2026-07-25-distribuzione-round-config-design.md`

## Problema

Il motore di distribuzione è il cuore del prodotto e deve essere governabile senza
toccare il codice. Quattro richieste, dopo il caso reale di una pratica creata a
Corsico che non ha mai raggiunto la sede di Assago pur rientrando nel raggio
massimo:

1. La durata del round si configura in **minuti** (1–60), non più in ore.
2. Giorni e orari in cui la logica si allarga li decide **la piattaforma**, non le
   agenzie: fuori da quella finestra parte solo il primo round e l'espansione
   riprende alla successiva apertura.
3. Verificare che gli scatti funzionino e che la produzione sia configurata per
   far girare il cron.
4. Le agenzie dei cerchi già contattati devono mantenere la richiesta viva finché
   qualcuno non accetta.

## Cosa era già a posto

L'indagine ha mostrato che due dei quattro punti non richiedono modifiche, e vale
la pena metterlo a verbale perché cambia la dimensione della release.

**Punto 4 — già garantito.** Nessun job scrive mai `TIMEOUT`: l'esito esiste
nell'enum come residuo del motore a countdown, ma nel motore v3 nessun percorso di
codice lo produce. `/inbox` elenca tutte le `PraticaAssegnazione` con
`esito = PENDING` senza filtro temporale, e `countdownFineAt` non viene nemmeno
più valorizzato da `creaAssegnazioni`. Chi accetta per primo vince: la
transazione in `inbox/actions.ts` prende un row lock `FOR UPDATE` sulla pratica e
chiude tutte le altre `PENDING` in `ASSEGNATA_ALTRO`. Una sede del round 1 resta
quindi in gara anche mentre si notificano i round 5 e 6.

**Punto 2 — metà già implementato.** Il gate "orario piattaforma" esiste in
`lib/distribuzione/orario-piattaforma.ts`, è Rome-aware e legge la config
singleton; `avviaRound1ForPratica` lo **ignora deliberatamente**, quindi il primo
round di una pratica inviata alle 00:20 parte subito. Gli orari dichiarati dalle
agenzie (`OrariApertura`) **non sono già oggi** letti da nessun file del motore.
Quel che manca è solo rendere giorni e orari editabili: oggi vivono in un box
"Altri parametri (fissi, sola lettura)" di `/admin/distribuzione`.

## Diagnosi produzione (punto 3)

**Il cron gira.** Runtime log di produzione, finestra 24 h: 144 richieste su
`/api/jobs/distribuzione-tick`, cioè esattamente 6/ora. `apps/piattaforma/vercel.json`
viene letto nonostante sia in una sottocartella del monorepo, e `CRON_SECRET` è
valido — un segreto errato produrrebbe 403, non esecuzioni.

Ne segue che il caso Assago non è un cron fermo. Le cause possibili sono cinque, e
**quattro su cinque agiscono in silenzio**: `candidatiEntro` le esclude con una
`where`, senza lasciare traccia da nessuna parte.

| Causa | Filtro in `candidatiEntro` | Silenziosa |
|---|---|---|
| Coordinate mancanti | `lat: { not: null }` | sì |
| Visura oltre 180 giorni | `visuraCameraleData > limiteVisuraUtc(now)` | sì |
| Sede o azienda sospesa | `suspendedAt: null` | sì |
| Blocco pagamento | `bloccoPagamentoAt: null` | sì |
| Attesa legittima del round | — | no (visibile in "Round distribuzione") |

Le coordinate sono il sospetto principale: il geocoding in registrazione è
best-effort (`geocodeCompanySedi` non lancia mai) e il recupero è affidato a uno
script manuale, `scripts/geocode-backfill.ts`, che nessun cron invoca. Una sede
che nasce senza `lat` resta invisibile alla distribuzione a tempo indeterminato,
senza che nessuno se ne accorga.

La conferma sul caso specifico richiede il DB di produzione: la copia locale è
anteriore e contiene Corsico ma non Assago. La diagnosi puntuale è quindi ancora
**aperta**; la sezione 6 di questa spec rende il problema autodiagnosticabile
d'ora in avanti, indipendentemente da quale delle quattro cause sia stata.

## Decisioni

### La durata del round è tempo *lavorativo*, non di calendario

Il gate di attesa non è più `now − ultimaEspansioneAt` ma la somma dei minuti che
cadono dentro le finestre di apertura. Con round da 60 minuti, una pratica inviata
alle 00:20 e apertura alle 09:00 fa scattare il round 2 alle **10:00**, non alle
09:00.

La ragione è di equità fra i cerchi: le agenzie del primo raggio hanno ricevuto la
notifica di notte e, con l'attesa di calendario, si vedrebbero arrivare i
concorrenti nell'istante stesso in cui aprono, senza un minuto utile per
rispondere. Con l'attesa lavorativa ogni cerchio ha sempre la sua finestra piena,
ovunque cada l'invio.

### Il calendario è della piattaforma, non della singola agenzia

Tre livelli, valutati in quest'ordine su `now` in ora di Roma:

1. il giorno è **attivo**?
2. la data non è un **festivo**?
3. l'ora cade nella **fascia** di quel giorno?

Se una qualsiasi risposta è no, il tick è un `noop` e quei minuti valgono zero nel
conteggio dell'attesa. `avviaRound1ForPratica` continua a ignorare tutti e tre i
livelli: il primo round parte sempre, a qualunque ora e in qualunque giorno.

La sezione "Orari" delle agenzie resta in piattaforma ma non ha alcun effetto
sulla distribuzione — è già così oggi, questa spec non la cambia.

## Architettura

### 1 · Config: fasce per giorno e festivi

Due colonne nuove sulla riga singleton `distribuzione_config`, entrambe `JSONB`:

```jsonc
// orariSettimana
{ "LUN": { "attivo": true,  "inizio": "09:00", "fine": "19:00" },
  "MAR": { "attivo": true,  "inizio": "09:00", "fine": "19:00" },
  "MER": { "attivo": true,  "inizio": "09:00", "fine": "19:00" },
  "GIO": { "attivo": true,  "inizio": "09:00", "fine": "19:00" },
  "VEN": { "attivo": true,  "inizio": "09:00", "fine": "19:00" },
  "SAB": { "attivo": false, "inizio": "09:00", "fine": "13:00" },
  "DOM": { "attivo": false, "inizio": "09:00", "fine": "19:00" } }

// festivi
[ { "data": "2026-08-15", "nome": "Ferragosto" },
  { "data": "2026-12-25", "nome": "Natale" } ]
```

Sostituiscono `orarioInizio`, `orarioFine` e `giorni`, che vengono droppate.
`intervalloMin` **resta invariata**: il DB memorizza già i minuti, era solo il
form a mostrare le ore. Il valore in produzione, 60, è valido anche nel nuovo
range senza alcuna correzione dei dati.

La migration converte la configurazione attuale **così com'è** — LUN-VEN
09:00–19:00, sabato e domenica inattivi — e non introduce il sabato corto di sua
iniziativa: cambiare la finestra operativa è una decisione da prendere dal
pannello, dove ora basta un click. Le fasce dei giorni inattivi sono comunque
popolate con un valore sensato, così attivarli non richiede di digitare anche gli
orari.

Il DTO diventa:

```ts
export type FasciaGiorno = { attivo: boolean; inizio: string; fine: string };
export type Festivo = { data: string; nome: string };

export type DistribuzioneConfigDTO = {
  raggioStartM: number;
  stepM: number;
  raggioMaxM: number;
  intervalloMin: number;
  orariSettimana: Record<GiornoSettimana, FasciaGiorno>;
  festivi: Festivo[];
};
```

**Parsing difensivo e fail-open**, nello spirito di `parseGiorni` e del `try/catch`
già presente in `getDistribuzioneConfig`: una fascia malformata ricade sul default
di *quel* giorno, non su "chiuso". Interpretare un JSON storto come chiusura
fermerebbe l'espansione di ogni pratica in piattaforma — un errore di lettura non
deve avere conseguenze peggiori di un DB irraggiungibile, che oggi degrada ai
default. Un festivo con `data` non conforme a `YYYY-MM-DD` (validata con
`parseYmd`) viene scartato singolarmente, senza invalidare la lista.

### 2 · Motore: gate a tre livelli e attesa lavorativa

`orario-piattaforma.ts` mantiene la firma pubblica esistente e ne aggiunge una:

```ts
isOrarioLavorativo(now: Date, cfg: DistribuzioneConfigDTO): boolean
minutiLavorativiTra(da: Date, a: Date, cfg: DistribuzioneConfigDTO, cap: number): number
```

`minutiLavorativiTra` itera per giorno di calendario romano da `da` ad `a`,
somma per ciascuno l'intersezione fra `[da, a]` e la fascia del giorno (zero se
il giorno è inattivo o festivo) e **si ferma appena il totale supera `cap`**: al
chiamante interessa solo se la soglia è raggiunta, e senza early-exit una pratica
ferma da tre settimane costerebbe 21 iterazioni a ogni tick, per ogni pratica.

Il gate nel tick diventa:

```ts
if (
  pratica.ultimaEspansioneAt &&
  minutiLavorativiTra(pratica.ultimaEspansioneAt, now, cfg, cfg.intervalloMin) <
    cfg.intervalloMin - ESPANSIONE_GRACE_MIN
) {
  return noop('durata round non trascorsa');
}
```

**Fuso e DST.** Gli estremi della fascia di un giorno si costruiscono con la
conversione wall-clock→UTC **già esistente e già corretta** in
`lib/date/rome-day.ts`: `romeWallClockToUtc` risolve il caso di transizione con un
doppio passaggio sull'offset. Oggi è privata: va **esportata**, non riscritta in
una seconda copia dentro `orario-piattaforma.ts`. Il confronto con i festivi usa
`romeYmd` dallo stesso modulo, così "che giorno è" ha una sola definizione in
tutto il progetto.

**Grazia.** `ESPANSIONE_GRACE_MIN` scende da `1` a `0,2` (12 secondi). Il valore
attuale assorbiva il jitter di un cron ogni 10 minuti; con round da 2 minuti
lascerebbe passare un round ogni minuto, dimezzando ogni durata configurata sotto
i 2 minuti.

### 3 · Cron al minuto

In `apps/piattaforma/vercel.json`, solo per `distribuzione-tick`:

```diff
-      "schedule": "*/10 * * * *"
+      "schedule": "* * * * *"
```

Gli altri nove cron restano invariati. Il tick è già difeso per essere invocato
di frequente: esce con un `noop` prima di qualsiasi scrittura se non c'è nulla da
fare, isola gli errori per-pratica, e la tx corta con compare-and-set su
`raggioCorrenteM`/`distribuzioneCiclo` neutralizza due tick sovrapposti (il
secondo trova lo stato cambiato e non scrive). Il costo passa da 144 a 1.440
invocazioni al giorno, trascurabile sul piano Pro.

**Due limiti da dichiarare, non da nascondere.** Vercel non garantisce il trigger
al secondo: una durata di 1 minuto è realisticamente 1–2 minuti, e l'hint del
pannello deve dirlo. Se lo schedule al minuto venisse rifiutato in fase di deploy,
il ripiego è cron-job.org con lo stesso header `Bearer CRON_SECRET`, che
`requireAdminOrCron` accetta già senza modifiche al codice.

### 4 · Pannello `/admin/distribuzione`

Il campo "Durata round (ore)" diventa **"Durata round (minuti)"**, range 1–60,
step 1, e il form smette di dividere e moltiplicare per 60: manda direttamente i
minuti che il DB già usa.

I limiti in `validate.ts` cambiano di conseguenza:

| Costante | Prima | Dopo |
|---|---|---|
| `DURATA_ROUND_ORE_MIN` / `_MAX` | 0,25 – 24 h | rimosse |
| `DURATA_ROUND_MIN_MIN` / `_MAX` | — | 1 – 60 min |
| `STEP_ORE_INPUT` | 0,25 | rimossa (`step` = 1) |

Il box "Altri parametri (fissi, sola lettura)" sparisce, sostituito da due
sezioni editabili:

- **Giorni e orari** — sette righe: checkbox "attivo", ora di inizio, ora di
  fine. Validazione: `fine > inizio` su ogni giorno attivo, e **almeno un giorno
  attivo** (zero giorni attivi congelerebbe ogni pratica dopo il primo round,
  senza che nulla lo segnali).
- **Festivi** — elenco di date con etichetta, ordinato, con aggiunta e rimozione.
  Le date passate restano visibili ma in grigio: nasconderle darebbe l'impressione
  che la lista sia stata svuotata.

La frase di riepilogo passa ai minuti lavorativi: *"al più 10 round, cioè circa
9 ore di orario lavorativo"*.

**Avviso di scadenza del calendario.** Se nessun festivo configurato cade nei
prossimi 60 giorni, il pannello mostra un avviso ("l'ultimo festivo configurato è
il 26/12/2026 — aggiungi quelli dell'anno prossimo"). Senza, la lista si svuota di
fatto a ogni cambio d'anno e la piattaforma torna ad allargare il raggio a Natale,
in silenzio.

### 5 · Seed dei festivi nazionali

La migration popola i festivi nazionali italiani **futuri** — dal 2026-08-01 in
avanti — e tutto il 2027: Capodanno, Epifania, Pasquetta, Liberazione, Festa del
Lavoro, Repubblica, Ferragosto, Ognissanti, Immacolata, Natale, Santo Stefano.

Le date di Pasquetta sono calcolate con il computus gregoriano, non ricordate a
memoria: **6 aprile 2026**, **29 marzo 2027**. La domenica di Pasqua non è in
elenco perché la domenica è già un giorno inattivo.

I patroni locali sono fuori scope: la finestra è unica per tutta la piattaforma,
non per provincia.

### 6 · Box "Copertura" sulla pratica

Nuovo modulo `lib/distribuzione/copertura.ts`:

```ts
getCoperturaPratica(praticaId: string): Promise<{
  raggioMaxM: number;
  sedi: {
    sedeId: string; nome: string; citta: string; distanzaM: number;
    stato: 'contattata' | 'in-attesa' | 'esclusa';
    round: number | null;       // se contattata
    esito: string | null;       // se contattata
    motivo: MotivoEsclusione | null;  // se esclusa
  }[];
  senzaCoordinate: { sedeId: string; nome: string; citta: string }[];
}>
```

Esegue la stessa query di `candidatiEntro` **senza i filtri di idoneità**, poi
classifica ogni sede confrontandola con le assegnazioni della pratica e con i
motivi di esclusione, che diventano un'enumerazione esplicita:
`COORDINATE_MANCANTI`, `VISURA_SCADUTA`, `SEDE_SOSPESA`, `AZIENDA_SOSPESA`,
`BLOCCO_PAGAMENTO`, `REVOCATA_ADMIN`.

Le sedi senza coordinate **non hanno una distanza**, quindi non è possibile dire
se siano in zona: vanno in una lista separata, dichiarata come "posizione ignota".
Attribuire loro una distanza inventata renderebbe il box meno affidabile del
problema che deve diagnosticare.

Va nella colonna destra di `pratiche/[id]`, accanto alla card "Round
distribuzione", con lo stesso gate `ADMIN_PIATTAFORMA` / `ASSISTENTE` già
applicato lì: la classifica delle agenzie in zona non è un dato da broker.

## Migration — due finestre

SQL a mano più `db:deploy`, mai `db:migrate` (propone `DROP SEQUENCE`).

| Quando | Migration | Contenuto |
|---|---|---|
| **Prima** del push | `20260726120000_distribuzione_calendario` | `ADD COLUMN orariSettimana JSONB`, `ADD COLUMN festivi JSONB`, `UPDATE` del singleton con le fasce convertite dalle colonne vecchie e il seed dei festivi |
| **Dopo** il deploy | `20260726130000_drop_orario_legacy` | `DROP COLUMN orarioInizio, orarioFine, giorni` |

L'additiva precede il codice, che legge le colonne nuove dal primo request. Il
DROP lo segue: finché la versione precedente è viva, `getDistribuzioneConfig`
legge le tre colonne vecchie, e droppandole prima cadrebbe nel `catch` fail-open
ricadendo sui default 09–19 LUN-VEN — non un crash, ma una finestra in cui la
configurazione reale viene ignorata senza che nulla lo segnali.

Nessun backfill sulle pratiche: `ultimaEspansioneAt` mantiene lo stesso
significato, cambia solo il modo di misurarne la distanza da adesso.

## Test

- **`orario-piattaforma.test.ts`** — fascia per giorno (sabato corto), giorno
  inattivo, festivo dentro un giorno altrimenti attivo, estremo di fine escluso
  (invariato), transizioni DST di marzo e ottobre.
- **`minutiLavorativiTra`** — attraversamento della notte, del weekend e di un
  festivo; `da` e `a` entrambi fuori finestra; early-exit sul `cap` verificato
  contando le iterazioni, non solo il risultato; `da > a` → 0.
- **`config.test.ts`** — parsing difensivo: fascia malformata → default di quel
  giorno; festivo con data impossibile (`2026-02-30`) scartato senza invalidare
  gli altri; JSON non oggetto → default completi.
- **`tick.test.ts`** — il gate usa i minuti lavorativi: pratica inviata fuori
  orario che **non** avanza all'apertura ma dopo `intervalloMin` di finestra;
  round successivi a cadenza piena; primo round che parte comunque di domenica e
  a Ferragosto.
- **`validate.test.ts`** — range 1–60 minuti, `step` dell'input coerente col
  minimo (la trappola `min + n·step` già costata un campo invalido), `fine >
  inizio`, rifiuto di zero giorni attivi.
- **`copertura.test.ts`** — un caso per ciascun motivo di esclusione, sede
  contattata con round ed esito, sede in attesa oltre il raggio corrente, sede
  senza coordinate nella lista separata.

I test sui minuti lavorativi vanno scritti **prima** della funzione: è la parte
con più casi limite e meno osservabile a occhio dell'intera release.

## Fuori scope

- **Backfill del geocoding.** Resta uno script manuale: il box copertura mostra
  una sede senza coordinate, non la ripara. Schedularlo come cron e avvisare
  l'admin è una release a sé.
- **Patroni locali e fasce multiple per giorno** (pausa pranzo): la finestra è
  una sola per giorno, uguale per tutta la piattaforma.
- **`OrariApertura` e `ChiusuraStraordinaria` delle agenzie:** restano dove sono,
  senza effetto sulla distribuzione, come già oggi.
- **Diagnosi puntuale del caso Assago:** richiede il DB di produzione ed è
  tracciata separatamente da questa spec.
