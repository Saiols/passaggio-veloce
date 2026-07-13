---
chatbot_visibility: internal
---

# Strumenti di gestione admin piattaforma

Spec di tre interventi sull'area admin, richiesti il 2026-07-13. Nessuno dei tre
richiede migration: i dati esistono già, manca la UI che li espone.

1. **Documenti aziendali scaricabili** dalla scheda azienda (CI, codice fiscale,
   visura, mandato).
2. **Fatture da emettere** evidenziate nella lista admin (tab + chip), per farle
   lavorare al commercialista.
3. **Tab di filtro nella lista pratiche admin**, come già esistono per broker e
   agenzia.

---

## 1. Documenti aziendali nella scheda azienda

### Stato attuale

I documenti caricati in registrazione (KYC) sono righe del modello `Documento`
con `companyId` valorizzato e `praticaId` a `null` — le due chiavi sono
mutuamente esclusive (verificato sul DB di prod: 98 documenti di pratica, 16
aziendali, zero righe con entrambe). I tipi effettivamente prodotti dal wizard
di registrazione sono `CI_FRONTE`, `CI_RETRO`, `CODICE_FISCALE`,
`CODICE_FISCALE_RETRO` e `VISURA_CAMERALE` (`(auth)/actions.ts:553-565`).

La route di download `/api/documenti/[id]` **esiste già e autorizza già
l'admin** (`lib/pratiche/access.ts:87`). Il gap è puramente di UI: nessuna
pagina espone gli id di questi documenti, quindi di fatto sono irraggiungibili.
La scheda azienda `admin/companies/[id]/page.tsx` mostra oggi solo il mandato di
fatturazione (`:189-213`).

### Intervento

Nuova sezione **"Documenti aziendali"** in `admin/companies/[id]/page.tsx`,
sotto la sezione del mandato. Una riga per documento con etichetta leggibile,
data di caricamento, dimensione e link di download a `/api/documenti/[id]`. Se
l'azienda non ha documenti (possibile: aziende create prima del KYC), stato
vuoto esplicito, non una sezione vuota muta.

Sopra la lista, un bottone **"Scarica tutti (ZIP)"** → nuova route
`GET /api/admin/companies/[id]/documenti-zip`, che impacchetta i documenti KYC
**più il PDF del mandato firmato**, se presente. Nome file:
`<RagioneSociale>_documenti_<YYYY-MM-DD>.zip`.

### Riuso

`lib/documenti/zip.ts` espone oggi `buildPraticaZip()` (`:30`), specifico per le
pratiche. Si estrae un builder generico `buildDocumentiZip(entries)` e
`buildPraticaZip` viene riscritto sopra di esso: un solo posto che sa di JSZip,
DEFLATE e naming delle entry.

### Decisione: gli assistenti NON scaricano i documenti d'identità

La pagina è oggi accessibile anche al ruolo Assistente (`isAdminOrAssistente`,
`admin/companies/[id]/page.tsx:23`) e la route `/api/documenti/[id]` concede allo
staff di piattaforma un bypass dei permessi (`api/documenti/[id]/route.ts:71`).
Poiché si tratta di documenti d'identità dei legali rappresentanti:

- la nuova sezione e la nuova route ZIP sono gated a **`isAdminPiattaforma`**;
- `canAccessDocumento` (`lib/pratiche/access.ts`) viene ristretta: per i
  documenti **aziendali** (`companyId` valorizzato) l'accesso è del solo
  `ADMIN_PIATTAFORMA`, non dell'Assistente. I documenti di **pratica** restano
  accessibili all'Assistente come oggi.

Non è una regressione osservabile: nessuna UI esponeva quegli id, quindi
l'assistente non poteva già arrivarci se non indovinando un UUID.

---

## 2. Fatture da emettere: tab + chip

### Stato attuale

Il modello è `DocumentoFiscale` (`schema.prisma:1484`). **Non esiste un enum di
stato di emissione**: l'emissione allo SdI avviene fuori piattaforma (il
commercialista scarica PDF/XML ed emette in autonomia) e la piattaforma tiene
solo un flag di tracciamento, `trasmessoSdiAt`, che l'admin alza a mano con
`segnaTrasmessoSdiAction` (`app/fatturazione/actions.ts:19`).

La lista admin `/admin/fatturazione` **non mostra alcuno stato**: la colonna non
esiste. La lista broker/agenzia mostra un testo grezzo "Gestito / In attesa"
(`app/fatturazione/page.tsx:306`).

### Il terzo stato: fuori campo SdI

`trasmessoSdiAt IS NULL` **non basta** a definire "da emettere". Il campo
`fatturaPaTipo` è nullable, e vale `null` quando il documento **non deve** finire
allo SdI (`lib/fatturazione/calcolo.ts:31-47`):

- `DOC_BROKER` di un broker in regime **PRIVATO** — nessuna fattura;
- `PENALE_BROKER` — fuori campo IVA ex art. 15 D.P.R. 633/1972, clausola 10.4(b)
  dei Termini.

Contarli tra i "da emettere" manderebbe il commercialista a emettere documenti
che per legge non devono esistere. Oggi in prod non ce ne sono (le 12 righe sono
tutte `FATTURA_PV` TD01, tutte non emesse), ma il write path li può produrre.

Si definiscono quindi **tre** stati, in un modulo unico
`lib/fatturazione/emissione.ts`:

| Stato          | Condizione                                     | Chip     |
| -------------- | ---------------------------------------------- | -------- |
| `DA_EMETTERE`  | `fatturaPaTipo != null && trasmessoSdiAt == null` | ambra    |
| `EMESSA`       | `trasmessoSdiAt != null`                        | verde    |
| `FUORI_SDI`    | `fatturaPaTipo == null`                         | grigio   |

Il modulo esporta `statoEmissione(doc)` e `whereEmissione(param)`, usati da chip,
filtro e conteggi. Il nome `StatoEmissione` evita la collisione con `StatoSdi`,
già esportato da `lib/fatturazione/provider/types.ts` con tutt'altro significato
(gli stati di trasmissione del provider, oggi codice non raggiunto).

### Intervento

- `lib/fatturazione/filtri.ts` — fonte unica dei filtri, usata da lista, export
  CSV e ZIP: si aggiunge `emissione` a `FatturaFiltri`, a `parseFatturaFiltri`
  (param `?emissione=`), a `fatturaWhereFiltri` e a `fatturaFiltriToQuery`. Il
  filtro si propaga così a CSV e ZIP senza altro lavoro: quello che vedi è
  quello che scarichi. Vincolo già documentato nel file e da rispettare: lo
  scope del ruolo e i filtri si compongono con `{ AND: [...] }`, mai con lo
  spread.
- `admin/fatturazione/page.tsx` — tre tab (**Tutte · Da emettere · Emesse**) con
  conteggi, in stile `/pratiche`: link `GET`, nessuno stato client. I conteggi
  vengono da `count()` su un `whereBase` che contiene tutti i filtri **tranne**
  `emissione`, altrimenti ogni tab mostrerebbe il proprio numero.
- Nuova colonna **Stato** nella tabella admin, con il chip.
- `components/ui/stato-emissione-chip.tsx` — stessa forma di `TipoPraticaChip`,
  esportato dal barrel `components/ui/index.ts`.
- `app/fatturazione/page.tsx:306` — il testo "Gestito / In attesa" viene
  sostituito dallo stesso chip.

### Fuori scope

Nessuna trasmissione automatica allo SdI, nessun lavoro sul provider A-Cube.
Questo intervento serve a *far vedere* l'arretrato, non a emetterlo.

---

## 3. Tab di filtro nella lista pratiche admin

### Stato attuale

I tab di broker e agenzia (`app/pratiche/page.tsx`) **non sono un filtro
client-side**: sono link `GET` sul search param `?stato=`, risolti server-side
in Prisma. La classificazione vive in `lib/pratiche/stati.ts`, blindata da un
test che impone a ogni valore dell'enum di cadere in esattamente un gruppo.

`/admin/pratiche` è invece rimasta indietro: nessun tab, filtro per stato a match
esatto (`page.tsx:54`), `take: 100` senza `skip` e senza `count`, e un riordino
in memoria per priorità che fa galleggiare le escalation (`page.tsx:101-108`).
L'intestazione mostra il numero di righe caricate come se fosse il totale: oltre
le 100, **mente**.

### Intervento

Cinque tab: **Tutte · In corso · In escalation · Bozze · Concluse**. "In
escalation" è l'unica coda su cui l'admin deve davvero agire, e non esiste per
broker/agenzia.

- `lib/pratiche/stati.ts`
  - `SINGOLI` resta la lista dei valori `?stato=` ammessi per broker/agenzia
    (R1/R2/R3 ed escalation sono dettagli interni del motore di distribuzione e
    non vanno esposti al broker).
  - si aggiunge `SINGOLI_ADMIN`, che estende `SINGOLI` con gli stati interni, e
    `whereStato` accetta l'insieme ammesso come parametro. **Attenzione alla
    regressione**: oggi l'admin filtra con un match esatto e quindi `IN_ESCALATION`
    *funziona*; passare a `whereStato` senza `SINGOLI_ADMIN` lo romperebbe in
    silenzio (`whereStato` ignora i valori non riconosciuti e restituisce
    `undefined`, cioè "nessun filtro").
  - `ConteggiTab` guadagna `escalation`, calcolato da `contaGruppi`. È un
    **sottoinsieme** di `inCorso`: non va sommato due volte in `tutte`.
- `lib/pratiche/tabs.ts` — `hrefTab` e `hrefPaginaPratiche` oggi hardcodano
  `/pratiche` (`:53`): prendono un `basePath`. Si aggiunge `tabsPraticheAdmin`.
- `app/pratiche/tabs.tsx` — il componente (Server Component, solo `<Link>`) prende
  il `basePath` e viene riusato dall'admin invece di essere duplicato.
- `admin/pratiche/page.tsx` — paginazione a 15 come la lista broker (`skip`/`take`
  + `count` + redirect se `page` eccede il totale), conteggi da `groupBy` sul
  `whereBase` (tutti i filtri tranne lo stato), e `whereStato(sp.stato,
  SINGOLI_ADMIN)` al posto del match esatto.
- La select dei 10 stati singoli (`admin/pratiche/filters.tsx`) resta: i tab sono
  gli aggregati, la select è il filtro fine.

### Il riordino per priorità viene rimosso

Il sort in memoria per `PRIORITY` (`admin/pratiche/page.tsx:29-40`, `:101-108`) è
incompatibile con la paginazione — ordina solo i 100 record già caricati, e non è
esprimibile in SQL senza una raw query. Viene rimosso: il tab "In escalation" fa
lo stesso lavoro in modo esplicito, invece di far galleggiare le urgenze dentro
una lista troncata.

---

## Test

- `lib/pratiche/stati.test.ts` — estendere l'invariante esistente; coprire
  `whereStato` con l'insieme admin (in particolare che `IN_ESCALATION` filtri
  davvero, cioè la regressione descritta sopra) e il conteggio `escalation` come
  sottoinsieme di `inCorso`.
- `lib/fatturazione/emissione.test.ts` (nuovo) — i tre stati, **incluso**
  `FUORI_SDI` con `fatturaPaTipo` a `null`, e le clausole Prisma di
  `whereEmissione`.
- `lib/fatturazione/filtri` — round-trip parse → query con il nuovo param.
- `lib/documenti/zip` — `buildDocumentiZip` generico e `buildPraticaZip` ancora
  verde sopra di esso.

I test unitari mockano Prisma: le query nuove (conteggi tab, `groupBy`, where
dell'emissione) vanno provate in read-only sul Postgres locale prima di chiudere.
