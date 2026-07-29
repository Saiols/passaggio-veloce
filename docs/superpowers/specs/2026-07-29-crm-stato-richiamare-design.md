# CRM — stato «Richiamare» con giorno e fascia

**Data:** 2026-07-29
**Area:** `/admin/crm/contatti` (vista contatti CRM)
**Stato:** design approvato, da implementare

---

## 1. Problema

Dopo una telefonata il sales aggiorna lo stato del contatto dalla tendina della
colonna *Stato*. Gli stati disponibili (S0…S10) coprono l'esito «non risponde»,
«non interessato», «interessato», ma non il caso più frequente di tutti: **il
cliente ha chiesto di essere richiamato**, e ha detto quando.

Oggi quell'informazione non ha un posto dove stare. C'è un campo
`nextContactAt` («Prossimo contatto pianificato») sepolto nella scheda del
contatto, che nessuna vista mostra e nessun filtro interroga: si compila e si
dimentica. Il risultato è che i richiami vivono nella testa di chi ha fatto la
telefonata.

Serve che «da richiamare giovedì mattina» sia uno stato visibile in lista,
filtrabile, e che venga a galla il giorno in cui è dovuto.

## 2. Decisioni prese

| # | Domanda | Decisione |
|---|---------|-----------|
| D1 | «Richiamare» sostituisce lo stato o gli si affianca? | **Sostituisce**: è un nuovo stato del funnel, `S11`. La tendina resta a scelta singola |
| D2 | Giorno e fascia sono obbligatori? | **Giorno sì, fascia no**: Mattina / Pomeriggio / Indifferente (default) |
| D3 | Come emerge un richiamo dovuto? | **Chip dedicato** `📞 Da richiamare`, separato da `🔴 Urgenti` |
| D4 | Serve un campo data nuovo? | **No**: si riusa `nextContactAt`, che si azzera quando il richiamo si chiude |

### Perché S11 e non un flag ortogonale

Il funnel CRM mescola già posizione e esito di telefonata: `S1` è «non
risponde», `S2` «non interessato», `S3` «interessato». `S11` sta in quella
stessa famiglia e non introduce un'incoerenza nuova. Il prezzo è che portando
un contatto da `S3` a `S11` si perde il fatto che era interessato: quel dato
resta nel campo «Esito ultima chiamata» e nelle note, che è dove il sales lo
cerca comunque.

L'alternativa — richiamo come promemoria sovrapposto allo stato — costava due
controlli invece di uno nella riga di tabella, sulla superficie che il sales usa
decine di volte al giorno.

## 3. Modello dati

```prisma
enum CrmStatoContatto {
  …
  S10 // Churned
  S11 // Richiamare — richiamo programmato in nextContactAt + nextContactFascia
}

enum CrmFasciaContatto {
  MATTINA
  POMERIGGIO
}

model CrmContact {
  …
  nextContactAt     DateTime?           // già esistente: giorno del richiamo
  nextContactFascia CrmFasciaContatto?  // null = indifferente

  @@index([status, nextContactAt])
}
```

**«Indifferente» è l'assenza di fascia, non un terzo valore dell'enum.** L'enum
descrive solo ciò che esiste davvero (mattina, pomeriggio) e le righe esistenti
non hanno niente da migrare.

L'indice composto serve al filtro del chip e al suo conteggio, che girano a ogni
apertura della pagina.

### Migration

Scritte a mano e applicate con `pnpm db:deploy` — **mai** `prisma migrate dev`,
che su questo schema propone DROP distruttivi.

**Due file separati**, perché Postgres non permette di *usare* un valore enum
nella stessa transazione in cui lo aggiunge, e Prisma esegue ogni migration in
una transazione:

1. `ALTER TYPE "CrmStatoContatto" ADD VALUE 'S11';`
2. `CREATE TYPE "CrmFasciaContatto" AS ENUM ('MATTINA', 'POMERIGGIO');`
   `ALTER TABLE "crm_contacts" ADD COLUMN "nextContactFascia" "CrmFasciaContatto";`
   `CREATE INDEX "crm_contacts_status_nextContactAt_idx" ON "crm_contacts" ("status", "nextContactAt");`

Entrambe additive: nessun backfill, nessun downtime, il codice vecchio continua
a funzionare contro lo schema nuovo (utile perché su Neon la migration va
applicata **prima** del push).

### Fuso orario: il giorno resta a mezzanotte UTC

`nextContactAt` continua a essere scritto con `parseDate()` (mezzanotte UTC),
come ogni altro campo data di questa scheda. È il **confronto** «dovuto oggi o
prima» a usare `romeEndOfDay` di `lib/date/rome-day.ts`.

Scrivere invece l'inizio-giornata romano (`2026-08-03T22:00Z` per il 4 agosto)
romperebbe la lettura `nextContactAt.slice(0, 10)` che riempie
l'`<input type="date">` in `initialData()`: mostrerebbe il **giorno prima**.
Con la mezzanotte UTC entrambe le direzioni sono corrette, perché il valore del
giorno *D* cade sempre dentro la giornata romana *D* (02:00 d'estate, 01:00
d'inverno) e resta `≤ romeEndOfDay(D)` e `> romeEndOfDay(D-1)`.

## 4. Fonte unica: `lib/crm/richiamo.ts`

Modulo **puro**, senza IO. È il pezzo che tiene insieme il resto:

```ts
export const LABEL_FASCIA: Record<CrmFasciaContatto, string>
export const OPZIONI_FASCIA: Array<{ value: string; label: string }>
  // '' → 'Indifferente' | 'MATTINA' → 'Mattina' | 'POMERIGGIO' → 'Pomeriggio'

/** Azzera giorno e fascia SOLO sulla transizione S11 → altro stato. */
export function campiRichiamoDopoCambioStato(
  precedente: string,
  nuovo: string,
): { nextContactAt?: null; nextContactFascia?: null }

/** Etichetta di riga: "gio 4 ago · mattina", con scaduto/oggi calcolati a Roma. */
export function etichettaRichiamo(
  giorno: Date | string,
  fascia: string | null,
  adesso: Date,
): { testo: string; scaduto: boolean; oggi: boolean }

/** Bound `lte` per «richiamo dovuto oggi o prima». */
export function sogliaRichiamoDovuto(adesso: Date): Date
```

**L'azzeramento è sulla transizione, non sullo stato finale.** Se azzerassimo
ogni volta che lo stato salvato non è `S11`, un salvataggio qualsiasi della
scheda cancellerebbe una data che l'admin ha messo a mano su un contatto `S3`.
Azzerando solo quando si *esce* da `S11` il richiamo si chiude quando è stato
fatto, e il resto non viene toccato.

### I write path che toccano `status` sono quattro, non due

Questa è la ragione per cui la regola vive in un modulo e non dentro un'action:

| Write path | Cosa fa | Cosa deve fare in più |
|---|---|---|
| `updateCrmContactStatusAction` | tendina di riga | azzera se esce da S11 |
| `updateCrmContactAction` | salvataggio scheda | azzera se esce da S11 |
| `lib/crm/match/apply.ts` | aggancio contatto ↔ azienda registrata | azzera se esce da S11 |
| `lib/crm/sync.ts#allineaContattiAgganciati` | firma di una pratica | azzera se esce da S11 |

Gli ultimi due passano da `datiFunnel()` (`match/stato.ts`), che per uno stato
fuori da `ORDINE` — ed `S11` lo è, di proposito, come `S10` — restituisce
direttamente il target `S7`/`S8`/`S9`. Quindi **un contatto in «Richiamare» che
si registra davvero esce da S11 senza passare dalle action**: se l'azzeramento
vivesse solo lì, resterebbe un richiamo fantasma su un cliente già a bordo, che
continuerebbe a comparire nel chip «Da richiamare» finché qualcuno non lo tocca
a mano.

`S11` **non** entra in `ORDINE`: non è un gradino del funnel, è una parentesi.
Metterlo nella scala renderebbe `statoAllineato` capace di «retrocedere» a S11 o
di rifiutare un avanzamento legittimo.

## 5. Superficie UI

### 5.1 Tendina di riga (tabella)

Scegliendo `S11` **non si salva subito**: si apre un mini-modale.

```
┌─ Richiamare questo contatto ──────────────┐
│                                            │
│  Giorno *   [ 04/08/2026 ]                 │
│  Fascia     (•) Indifferente               │
│             ( ) Mattina  ( ) Pomeriggio    │
│                                            │
│               [Annulla]  [Programma]       │
└────────────────────────────────────────────┘
```

- **Conferma** → una sola scrittura con stato + giorno + fascia insieme. Non
  esiste un istante in cui il contatto è `S11` senza giorno.
- **Annulla** → la tendina torna al valore precedente. Lo stato ottimistico di
  `StatusSelect` non viene toccato finché il modale non conferma.
- Tutti gli altri stati continuano a salvare immediatamente, come oggi.

Sotto la tendina, **solo per gli `S11`**, una riga cliccabile che riapre il
modale per riprogrammare:

```
┌──────────────────┐
│ S11 — RICHIAMARE │
└──────────────────┘
📞 gio 4 ago · mattina
```

Rossa se scaduta, evidenziata se è oggi, normale se è futura. Riaprendo il
modale da qui, giorno e fascia arrivano **precompilati** con quelli già
programmati: riprogrammare significa spostare un appuntamento, non riscriverlo
da zero.

### 5.2 Scheda contatto — tab *Stato & Chiamate*

Un `FieldSelect` «Fascia» accanto al campo «Prossimo contatto pianificato» già
presente. Se lo stato è `S11` e il giorno è vuoto: errore di campo con il
primitivo `useFieldErrorsState` (mai rosso all'apertura, si rivela al CTA), e
comunque rifiutato dal server.

### 5.3 Chip «Da richiamare»

```
[🔍 Cerca…] [Tutti i tipi ▾] [Tutti gli stati ▾] … [🔴 Urgenti] [📞 Da richiamare · 7] [Reset]
```

- Filtro: `status = 'S11' AND nextContactAt <= sogliaRichiamoDovuto(now)`.
- Ordinamento: `nextContactAt` crescente (il più arretrato in cima), poi fascia
  (`MATTINA` prima di `POMERIGGIO`, indifferente in fondo).
- Il **conteggio nel chip** usa lo stesso scoping del listato: un `SALES` vede
  il numero dei *suoi* richiami, non di tutti. Il chip c'è sempre; il numero
  compare solo quando è maggiore di zero, così un «· 0» non chiede attenzione
  per niente.
- Mutuamente esclusivo con `Urgenti` e col filtro per stato — la regola esiste
  già in `updateFilter`, basta estenderla al nuovo preset.

`🔴 Urgenti` resta **invariato** (`status in S6/S5/S4/S3`): mescolarci dentro una
condizione di scadenza farebbe fare a un chip solo due lavori diversi.

## 6. Allineamenti

- **Dashboard CRM**: `S11` nell'array degli stati, label «Richiamare», colore
  dedicato. Entra nel *Totale* e in **nessun'altra** metrica: non è né «da
  contattare» né «interessato», e infilarlo in una delle due falserebbe numeri
  che qualcuno guarda.
- **Campagne sales** (`statoTarget`): accetta `S11`, così si può lanciare una
  campagna sui soli da richiamare.
- **Import CSV** (`STATUS_SET`, tipo `CrmStatus`): accetta `S11`.
- **`docs/crm-spec-implementativa.md`**: enum, elenco filtri e funnel aggiornati.
  Il documento alimenta la KB del chatbot generata al prebuild → dopo la modifica
  `pnpm --filter piattaforma kb:build` e `leak.test.ts` verde.

### Due automatismi che restano invariati, verificati

`nextStatoInvio` e `nextStatoApertura` (`lib/crm/email-partenza.ts`) fanno
avanzare lo stato solo da `S0`–`S3` / `S0`–`S4`. `S11` non è in quei set:
**inviare l'email di partenza a un contatto da richiamare non lo sposta**, e il
richiamo programmato sopravvive all'invio del link. È il comportamento giusto —
il richiamo è ancora dovuto — e non richiede codice.

## 7. Test

**`richiamo.test.ts`** (puro, il grosso della copertura):
- azzeramento solo sulla transizione `S11 → altro`; `S3 → S3`, `S3 → S9` e
  `S11 → S11` non toccano niente;
- `scaduto`/`oggi` sui bordi di giornata **romani**: 23:59 del giorno stesso →
  dovuto, non scaduto; 00:01 del giorno dopo → scaduto. Un test con l'ora legale
  e uno senza;
- fascia nulla → etichetta senza suffisso.

**Action**:
- `S11` senza giorno → errore, niente scrittura;
- `S11 → S3` azzera giorno e fascia;
- salvataggio scheda `S3 → S3` con data compilata a mano → la data resta;
- scoping `SALES` invariato su entrambe le action.

**Vista**: il chip filtra e conta con lo scoping `SALES`; il preset è mutuamente
esclusivo con `Urgenti` e con il filtro per stato.

**Browser** (quello che i test non vedono): Annulla sul modale riporta la tendina
allo stato precedente senza salvare; confermando, riga e chip si aggiornano; la
riga `📞` non compare sugli stati diversi da `S11`.

## 8. Fuori scope

- notifiche o email di promemoria al sales quando il richiamo scade;
- orario preciso invece della fascia;
- richiami ricorrenti;
- storico dei richiami passati (resta l'ultimo programmato).
