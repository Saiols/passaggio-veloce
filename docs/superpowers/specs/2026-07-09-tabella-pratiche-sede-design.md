# Tabella lista pratiche: fix allineamento colonne + colonna/filtro Sede

Data: 2026-07-09

## Problema

**1. Le colonne non combaciano con l'intestazione**, per ogni utenza (broker, agenzia,
admin di piattaforma, operatori).

Header e righe non appartengono alla stessa griglia CSS: la costante `GRID_COLS` viene
applicata a un `<div class="grid">` per l'header e a un `<div class="grid">` **per ogni
riga**. Le tracce sono definite come `minmax(6rem, auto)`, e `auto` dimensiona la traccia
sul contenuto *di quella singola griglia*. Quindi:

- l'header dimensiona `Stato` sulla parola `STATO` (≈ 7rem);
- una riga `ACCETTATA` dell'agenzia contiene chip + icona info + `QuickActionButton` e
  dimensiona la stessa traccia a ≈ 15rem;
- una riga `FIRMATA` la dimensiona a ≈ 8rem.

Il `minmax(0,1fr)` peggiora il quadro: lo spazio residuo che distribuisce dipende dalle
tracce `auto` accanto, quindi cambia riga per riga. Il disallineamento è **strutturale**,
non un valore sbagliato da correggere.

Il codice duplicato aggrava: `GRID_COLS` esiste in due copie
(`app/pratiche/page.tsx` e `app/admin/pratiche/page.tsx`) con un commento che rimanda
"al gemello".

**2. Manca la colonna Sede.** Con il multi-sede in produzione non si vede quale filiale
dell'agenzia sta lavorando la pratica, né si può filtrare per essa.

## Vincoli

- Le righe **devono restare block-level** (`<div>`, non `<tr>`/`<td>`). I commenti nel
  codice documentano che iOS Safari/WebKit non onora `position: relative` sugli elementi
  interni di tabella, rompendo lo stretched-link della riga (tap che apre la pratica
  sbagliata, righe non cliccabili in landscape). Tornare a `<table>` è escluso.
- Il filtro per sede **restringe** lo scope, non lo sostituisce: vale la regola di
  `lib/sedi/scope-filters.ts` — una sede non può mai leggere dati di un'altra azienda.

## Design

### Parte 1 — Allineamento

Tracce **deterministiche**: nessun `auto`. Due griglie di uguale larghezza con tracce
indipendenti dal contenuto calcolano necessariamente le stesse colonne. È l'equivalente
di `table-layout: fixed` senza reintrodurre `<table>`.

- Colonne a contenuto prevedibile → larghezza fissa in `rem`: Codice `8.5rem` (regge
  `PV-2026-00042` in mono), Targa `6.5rem`, Fee `5rem`, Quando `7rem`.
- Colonne testuali (Proprietario, Controparte, Sede) → `minmax(0,1fr)` con `min-w-0` e
  `truncate`.
- Colonna Stato → larghezza fissa (partenza: `9.5rem`) dimensionata perché chip e icona
  info stiano sulla prima riga; il contenitore interno prende `flex-wrap` così il
  `QuickActionButton` (solo agenzia) va a capo invece di allargare la traccia.

I valori sopra sono il punto di partenza; si rifiniscono guardando la pagina nel browser
ai tre breakpoint, non a tavolino.

**Densità.** Il padding cella passa da `px-5` a `px-3`, con padding maggiore sui bordi del
contenitore (`pl-5` sulla cella Codice, `pr-5` su Quando). Con 8 colonne su `lg` il
padding attuale consumerebbe 320px di larghezza utile.

⚠️ Le classi di bordo vanno messe **esplicitamente** su quelle due celle, non con le
varianti `first:` / `last:`. Nelle righe il primo figlio DOM è il `<Link>` dello
stretched-link, quindi `:first-child` non è la cella Codice. (Il `<Link>` è
`position: absolute`, dunque fuori dal flusso e non occupa una traccia: il conteggio delle
colonne resta corretto, ma i selettori posizionali no.)

**Overflow.** Il contenitore passa da `overflow-hidden` a `overflow-x-auto` con una
`min-w` pari alla somma delle tracce. Oggi su schermi molto stretti le colonne vengono
tagliate in silenzio; così scorrono. La `min-w` sta sul contenitore che avvolge header e
righe insieme, così tutte le griglie restano larghe uguale.

**Modulo condiviso** `src/lib/pratiche/table-grid.ts`: esporta le stringhe di classe
**letterali complete** (Tailwind non risolve nomi costruiti a runtime) per le tre varianti:

| Variante | Colonne |
|---|---|
| `utenteConSede` | Codice, Targa, Proprietario (sm+), Controparte (md+), Sede (lg+), Stato, Fee (lg+), Quando |
| `utenteSenzaSede` | come sopra, senza Sede |
| `admin` | Codice, Targa, Broker (md+), Agenzia (md+), Sede (lg+), Stato, Fee (lg+), Quando |

Il numero di tracce per breakpoint deve combaciare con il numero di celle **visibili** a
quel breakpoint: le celle nascoste hanno `display:none` e non occupano traccia.

### Parte 2 — Colonna Sede

**Contenuto.** Sempre `agenziaSede`, cioè la filiale dell'agenzia assegnataria — la sede
dove la pratica si svolge. `—` quando `agenziaSedeId` è `null` (bozza, o in attesa di
assegnazione). Cella su due righe: nome sede, sotto la città in grigio piccolo, per
disambiguare i nomi ripetuti tra agenzie diverse (`Sede centrale` è comune). Componente
`src/components/sede/sede-cell.tsx`, accanto agli altri componenti sede.

Query: aggiungere `agenziaSede: { select: { nome: true, citta: true } }` all'`include` di
`prisma.pratica.findMany` in entrambe le pagine.

**Visibilità** — helper puro `src/lib/pratiche/colonna-sede.ts`:

| Utenza | Mostra |
|---|---|
| Broker, qualsiasi ruolo di sede | sempre |
| Agenzia, owner con ≥2 sedi in vista aggregata | sì |
| Agenzia, admin di sede o operatore | no |
| Agenzia, owner con una sola sede | no |
| Admin di piattaforma | sempre |

Firma: `mostraColonnaSede({ companyType, scopeIds }): boolean`. La pagina admin non la
chiama: la colonna c'è sempre. "Sempre" qui significa *presente nella variante di griglia*;
resta comunque nascosta sotto `lg`, come Fee.

Le righe dell'agenzia collassano in una condizione sola: `scopeIds.length > 1`. Non serve
ispezionare il ruolo, perché `resolveCurrentSede` restituisce sempre `ONE` ai non-owner:
"essere associato esclusivamente a quella sede" e "vederne una sola" sono già la stessa
cosa nel contesto di sessione. Anche l'owner con una filiale unica vedrebbe tutte le righe
identiche, quindi la colonna sparisce pure a lui.

Per il broker la colonna resta sempre utile: le sedi agenzia variano riga per riga
indipendentemente dallo scope del broker.

### Parte 3 — Filtro Sede

Parametro `?sede=<uuid>`, una `<select>` accanto a stato e periodo. Il form filtri guadagna
una traccia `auto` quando la select è presente: `/pratiche` da
`sm:grid-cols-[1fr_auto_auto]` a `sm:grid-cols-[1fr_auto_auto_auto]`, `/admin/pratiche` da
`sm:grid-cols-[1fr_auto]` a `sm:grid-cols-[1fr_auto_auto]`. Anche qui le due stringhe
devono essere letterali, non costruite a runtime.

**Sorgente delle opzioni**, diversa per utenza:

- **agenzia** → le proprie sedi in `scopeIds`, etichetta `Nome (Città)`;
- **broker** → solo le sedi agenzia che compaiono davvero nelle sue pratiche, con una
  query sola via relazione:
  `prisma.sede.findMany({ where: { type: 'AGENZIA', deletedAt: null, praticheAgenzia: { some: whereBase } }, select: { id, nome, citta, company: { select: { ragioneSociale } } } })`,
  etichetta `Ragione sociale · Nome sede`;
- **admin** → tutte le sedi `type: 'AGENZIA'` non cancellate, stessa etichetta.

**Applicazione, fail-closed.** Il valore arriva dalla querystring, quindi:

1. si valida contro l'insieme degli id ammessi per quell'utenza; un valore non ammesso
   viene ignorato (nessun filtro), non applicato alla cieca;
2. per l'**agenzia** si **interseca** con `scopeIds` invece di sostituirlo:
   `where.agenziaSedeId = { in: scopeIds.filter((id) => id === sedeSel) }`.
   Un `sede=<uuid di un'altra azienda>` produce lista vuota, mai dati altrui.

L'opzione **"Non assegnate"** (`agenziaSedeId: null`) esiste solo per broker e admin. Per
l'agenzia sarebbe contraddittoria: sovrascriverebbe il vincolo `{ in: scopeIds }`, e una
pratica senza sede assegnata non è comunque sua.

**Paginazione.** `Pagination.makeHref` in `app/pratiche/page.tsx` ricostruisce la
querystring a mano e propaga solo `stato`, `q`, `periodo`. Va aggiunto `sede`, altrimenti
il filtro si perde cambiando pagina. `/admin/pratiche` non ha paginazione (`take: 100`).

## File toccati

Nuovi:

- `src/lib/pratiche/table-grid.ts` — stringhe di classe delle tre varianti
- `src/lib/pratiche/colonna-sede.ts` + `colonna-sede.test.ts` — visibilità colonna e
  risoluzione del filtro (logica pura, niente IO)
- `src/components/sede/sede-cell.tsx` — cella nome + città

Modificati:

- `src/app/pratiche/page.tsx` — griglia, colonna, query, filtro, paginazione
- `src/app/pratiche/filters.tsx` — select sede
- `src/app/admin/pratiche/page.tsx` — griglia, colonna, query, filtro
- `src/app/admin/pratiche/filters.tsx` — select sede

Nessuna migration: `Pratica.agenziaSedeId` e la relazione `agenziaSede` esistono già, con
indice su `agenziaSedeId`.

## Verifica

- **Unit (vitest)** su `colonna-sede.ts`, a fianco degli altri `lib/pratiche/*.test.ts`:
  visibilità per le cinque utenze della tabella; risoluzione del filtro per agenzia
  (intersezione con `scopeIds`), per broker e admin (uguaglianza semplice); id non ammesso
  → nessun filtro; `nessuna` → `null` solo per broker/admin.
- **A video**, che è il motivo per cui siamo qui: allineamento header/righe ai breakpoint
  base, `sm`, `md`, `lg` su `/pratiche` (broker e agenzia, con e senza colonna Sede) e su
  `/admin/pratiche`. Da controllare in particolare una riga agenzia in stato `ACCETTATA` o
  `PROCESSATA`, che è quella col pulsante azione.
- Stretched-link ancora funzionante: click sulla riga apre la pratica, click su chip,
  icona info e pulsante azione no.
