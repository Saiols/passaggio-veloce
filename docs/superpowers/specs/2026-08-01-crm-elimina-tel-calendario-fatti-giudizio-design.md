# CRM — eliminazione massiva, telefono cliccabile, calendario richiami, split Fatti/Giudizio

**Data:** 2026-08-01
**Autore:** Francesco (CTO) + Claude
**Stato:** design approvato (in attesa review spec)

## Contesto

Quattro interventi sull'area contatti del CRM (`apps/piattaforma/src/app/admin/crm/contatti`).
Il quarto è anche la radice di un bug segnalato: un contatto "da richiamare" (oggi
`status = S11`) non riflette mail inviata / link aperto, perché un **unico** campo
`status` sta portando insieme tre cose diverse — fatti oggettivi, giudizio soggettivo,
e un promemoria di richiamo.

### Modello attuale (rilevante)

- `CrmContact.status: CrmStatoContatto` (S0..S11) — enum unico che mescola:
  - **fatti** (S4 link inviato, S5 link aperto, S6/S7 iscrizione, S8 prima pratica, S9 attivo, S10 churn);
  - **giudizi** (S2 non interessato, S3 interessato);
  - **richiamo** (S11, con `nextContactAt` + `nextContactFascia`).
- I fatti sono **già** su campi propri e vengono aggiornati anche quando `status` resta
  incastrato: `linkInviato/linkInviatoAt`, `linkAperto/linkAperture`, `mailAperta`,
  `iscrizioneInit/iscrizioneComp/iscrizioneAt`, `primaPratica/primaPraticaAt`,
  `praticheTotal`, `lastAccessAt`, `matchedAt`.
- Le **write path** che scrivono `status`: 2 manuali (`updateCrmContactAction`,
  `updateCrmContactStatusAction`) + 4 automatiche (`sendEmailPartenzaAction` → S4,
  `app/i/[token]/route.ts` → S5, `lib/crm/match/apply.ts` e `lib/crm/sync.ts` →
  S7/S8/S9 via `datiFunnel`). **Le 4 automatiche producono solo stati FATTUALI**:
  non scrivono mai S2/S3/S11. Questo è il fatto che rende il punto 4 a basso rischio.
- `CrmCall` è già uno storico chiamate datato (`startedAt`, `esito`, `sentiment`,
  `summary`) con `onDelete: Cascade` sul contatto. Anche `CrmCampaignAssegnazione`
  è `onDelete: Cascade`.
- Permessi (`lib/auth/permissions.ts`): `canDeleteCrmContact` / `canBulkImportCrm`
  = ADMIN_PIATTAFORMA / AD / CTO / SALES_MANAGER (SALES escluso).
  `canViewCrm` / `canEditCrmContact` includono anche SALES (scoped ai propri).

### Decisioni prese col committente

1. Eliminazione = **hard delete** effettivo da DB. "Seleziona tutti" agisce su **tutti
   i contatti che corrispondono ai filtri correnti** (tutte le pagine, non la sola pagina).
2. Telefono cliccabile: **solo `tel:`** (niente WhatsApp).
3. Google Calendar: **vista in-app + link "Aggiungi a Google Calendar"** (zero OAuth,
   nessun dato inviato a Google finché l'operatore non clicca).
4. Split stati: **enum invariato** + campo `giudizio` ortogonale (variante "4b"). Vedi
   sotto per la realizzazione a **tre assi**.

---

## Punto 1 — Eliminazione massiva (hard delete)

### UI (lista contatti, `client.tsx`)
- Colonna checkbox per riga + checkbox header ("tutti in pagina").
- Stato di selezione client: `selezionatiPagina: Set<string>` **oppure** modalità
  `tuttiIFiltrati` (flag) con `escludi: Set<string>` per eventuali deselezioni.
- Quando l'intera pagina è selezionata, banner tipo Gmail:
  *"Selezionati 25 in pagina · **Seleziona tutti i N** che corrispondono ai filtri"*
  (N = conteggio totale filtrato, già disponibile lato server).
- Barra azioni (compare con ≥1 selezionato), gated a `canDeleteCrmContact`:
  bottone rosso **"Elimina definitivamente (N)"**.
- Dialog di conferma: mostra il conteggio esatto; avverte che è **irreversibile** e
  rimuove anche chiamate e assegnazioni campagne collegate; checkbox
  "Capisco che è irreversibile" da spuntare prima di abilitare il bottone.

### Server action (`actions.ts`)
`bulkHardDeleteCrmContactsAction(input)`:
- Auth: `auth()` + `canDeleteCrmContact(role)` (SALES escluso). Nessuno scoping per
  sede: chi ha il permesso vede/elimina tutto (coerente con il delete soft attuale).
- `input`:
  - `{ modo: 'ids', ids: string[] }` — `deleteMany({ where: { id: { in: ids } } })`.
  - `{ modo: 'filtro', filtro: FiltroContatti, escludi: string[] }` — ricostruisce lato
    server **lo stesso `where`** usato da `page.tsx` (stesso helper, vedi sotto), aggiunge
    `id: { notIn: escludi }`, poi `deleteMany`.
- Ritorna `{ eliminati: number }`. La cascade DB porta via `CrmCall` e
  `CrmCampaignAssegnazione`.
- **Refactor di supporto:** estrarre la costruzione del `where` da `page.tsx` in un
  helper puro condiviso (`lib/crm/contatti-filtro.ts` → `whereContatti(filtro)`), così
  lista e delete-per-filtro non divergono. La `page.tsx` lo consuma; l'action pure.

### Note
- Il partial-unique index `(companyId, sedeId) WHERE ... deletedAt IS NULL` non è
  toccato dal problema: rimuovere una riga non può violare un vincolo di unicità
  (semmai lo allenta). Nessuna azione necessaria.
- DB prod è temporaneo/usa-e-getta: hard delete senza grazia è accettabile.

### Test
- Unit su `whereContatti`: preset `urgenti`/`richiamo`, filtri cat/regione/assegnato/testo.
- Unit action (Prisma mockato): modo `ids` chiama `deleteMany` con gli id giusti;
  modo `filtro` applica `notIn escludi`; permesso negato per SALES.
- La query nuova va provata read-only sul postgres locale (non solo mock).

---

## Punto 2 — Telefono cliccabile (`tel:`)

- Helper puro `telHref(tel: string): string` in `lib/crm/tel.ts`: normalizza (rimuove
  spazi e caratteri non `+`/cifra) e ritorna `tel:<normalizzato>`. Se vuoto → nessun link.
- Lista `client.tsx:403`: `{c.tel}` → `<a href={telHref(c.tel)} className="...">{c.tel}</a>`
  (stop propagation per non aprire il modale). Fallback a testo se `tel` vuoto.
- Scheda/modale (`TabAnagrafica`): accanto al campo "Telefono fisso" (input editabile),
  bottone/anchor **"📞 Chiama"** con `href={telHref(data.tel)}`, disabilitato se vuoto.
- Test: unit su `telHref` (spazi, prefisso `+`, stringa vuota, caratteri sporchi).

---

## Punto 3 — Calendario richiami + "Aggiungi a Google Calendar"

### Vista in-app
- Nuova pagina `app/admin/crm/richiami/page.tsx` (+ `client.tsx`).
- Fonte dati: contatti con **richiamo programmato** — `nextContactAt IS NOT NULL`
  (vedi Punto 4: il richiamo è un asse a sé, non più `status = S11`) e **non ancora
  registrati** (`iscrizioneComp = false`), scoping come la lista.
- Layout: agenda **raggruppata per giorno** (romano), ordinata per data; badge
  scaduto/oggi/futuro (riuso `etichettaRichiamo` da `lib/crm/richiamo.ts`). Sezioni
  "Scaduti", "Oggi", poi i giorni futuri.
- Ogni riga: nome + categoria, **telefono cliccabile** (`telHref`), fascia
  (mattina/pomeriggio/indifferente), link "Apri contatto", bottone
  **"Aggiungi a Google Calendar"**.
- Voce in sidebar CRM ("Richiami"/"Calendario") + link dal chip "Da richiamare"
  della lista contatti verso questa pagina.

### Helper "Aggiungi a Google Calendar"
- Puro: `googleCalendarUrl({ nome, tel, citta, giorno, fascia }): string` in
  `lib/crm/google-calendar.ts`.
- Costruisce `https://calendar.google.com/calendar/render?action=TEMPLATE` con:
  - `text` = `Richiamare <nome>`;
  - `dates` = intervallo in `YYYYMMDDTHHMMSS` (ora locale) + `ctz=Europe/Rome`.
    Fasce: **Mattina 09:00–13:00**, **Pomeriggio 15:00–19:00**,
    **Indifferente** → evento *tutto il giorno* (`YYYYMMDD/YYYYMMDD+1`);
  - `details` = essenziale (tel, città) per contenere l'esposizione dati.
- Nessun OAuth, nessuno storage: il dato lascia PV solo quando l'operatore clicca.
- Test: unit su `googleCalendarUrl` (le tre fasce, tutto-il-giorno, encoding).

---

## Punto 4 — Split Fatti / Giudizio + storico + fix bug S11

### Modello a tre assi (realizzazione della variante 4b)

Un singolo `status` non può reggere insieme "cosa è successo", "cosa penso" e "quando
richiamare". Li separiamo in **tre assi ortogonali**, senza toccare l'enum né le 4 write
path automatiche:

| Asse | Dove vive | Chi scrive | In UI |
|---|---|---|---|
| **Fatti** (funnel oggettivo) | `status` + flag/timestamp esistenti | automazione (4 path) + override admin nel modale | colonna "Fatti" (sola lettura) + timeline |
| **Giudizio** (soggettivo) | **nuovo** `giudizio: CrmGiudizio?` | solo operatore | colonna "Stato" (pill editabile) |
| **Richiamo** (promemoria) | `nextContactAt` + `nextContactFascia` (già esistenti) | operatore | chip "📞" + pagina Richiami (Punto 3) |

- **Nuovo enum** `CrmGiudizio { INTERESSATO, NON_INTERESSATO }` (nullable = nessun
  giudizio). NON include "da richiamare": quello è l'asse Richiamo, così un contatto può
  essere *Interessato* **e** avere un richiamo insieme.
- **Nuovo campo** `CrmContact.giudizio: CrmGiudizio?`.
- **Nuovo campo** `CrmContact.linkApertoAt: DateTime?` — unico buco reale della timeline
  (oggi l'apertura link ha solo bool+contatore, niente data). Valorizzato in
  `app/i/[token]/route.ts` alla **prima** apertura (`?? new Date()`), additivo.
- **Enum `CrmStatoContatto` invariato**: i valori S2/S3/S11 restano definiti per la
  migration/compatibilità, ma il codice nuovo non li **scrive** più (le superfici manuali
  scrivono `giudizio`/richiamo; le automatiche già scrivevano solo stati fattuali).

### Perché il bug sparisce

Oggi `status = S11` blocca la vista del funnel. Con il modello a tre assi:
- il richiamo non è più `status = S11` ma `nextContactAt`, quindi `status` avanza
  normalmente con l'automazione (mail → S4, apertura → S5);
- la colonna **Fatti** è comunque derivata dai **flag** (`statoFattuale(contact)`), non da
  `status`, quindi mostra "Link aperto · oggi" anche se per qualsiasi motivo `status`
  non fosse avanzato.

Nessuna delle 4 write path automatiche viene toccata nella sua logica di `status`.

### Colonna "Fatti" (sola lettura)
- Funzione pura `statoFattuale(contact): { codice, label, at }` in `lib/crm/fatti.ts`:
  ritorna il traguardo di funnel **più avanzato** in base ai flag/timestamp
  (primaPratica → S8/S9 by `praticheTotal`; iscrizioneComp → S7; iscrizioneInit → S6;
  linkAperto → S5; linkInviato → S4; else S0), con la data associata.
- In lista: badge "Registrato · 2g", "Link aperto · 5g", ecc.; click → apre il modale
  sulla tab tracking (timeline).

### Storico datato (timeline)
- Funzione pura `timelineFatti(contact, calls): Evento[]` in `lib/crm/fatti.ts` che unisce
  e ordina per data:
  - `createdAt` → "Contatto creato";
  - `linkInviatoAt` → "Email inviata";
  - `linkApertoAt` → "Link aperto";
  - `iscrizioneAt` → "Registrazione completata";
  - `primaPraticaAt` → "Prima pratica";
  - `matchedAt` → "Agganciato ad azienda";
  - righe `CrmCall` → "Chiamata: <esito>" (+ sentiment).
- Mostra il **delta** tra eventi ("+3 giorni"). Vive nella tab tracking del modale
  (`TabTracking`), sopra i campi esistenti. Il modale carica le `calls` del contatto
  (nuova include o fetch on-open).
- Nessuna nuova tabella evento: la timeline è derivata (i timestamp + `CrmCall` bastano).
  DB prod è temporaneo → nessun backfill dedicato necessario.

### Colonna "Stato" (giudizio, editabile)
- Nuovo componente `GiudizioSelect` (pill) al posto dell'attuale `StatusSelect` in lista:
  opzioni — / Interessato / Non interessato. Scrive via
  `updateCrmContactGiudizioAction(id, giudizio)` (ottimistico, come oggi lo status).
- Il chip "📞 richiamo" (data+fascia) resta mostrato sotto, ora legato a `nextContactAt`.
- Un'azione rapida "Programma richiamo" apre `RichiamoDialog` (invariato) e imposta
  `nextContactAt`/`nextContactFascia` via `updateCrmContactRichiamoAction(id, {giorno, fascia})`
  — **decoupled da `status`**. "Rimuovi richiamo" azzera i due campi.

### Server actions (`actions.ts`)
- `updateCrmContactGiudizioAction(id, giudizio | null)`: auth `canEditCrmContact`
  (SALES own-only, errori offuscati come oggi); scrive solo `giudizio`.
- `updateCrmContactRichiamoAction(id, { giorno, fascia } | null)`: valida il giorno
  (riuso della validazione S11 attuale), scrive `nextContactAt`/`nextContactFascia`;
  `null` li azzera. NON tocca `status`.
- `updateCrmContactStatusAction` (esistente): resta come **override admin** dei fatti;
  le opzioni offerte si restringono ai codici fattuali (S0,S1,S4–S10), non più S2/S3/S11.
- `updateCrmContactAction` (modale full): include `giudizio` nei dati salvati; nel
  `TabStato` compaiono i tre controlli (status fattuale, giudizio, richiamo) come sezioni
  distinte; niente più S2/S3/S11 tra le opzioni di `status`.

### Superfici del richiamo che passano da `status=S11` a `nextContactAt`
- `page.tsx` preset `richiamo` e conteggio `richiamiDovuti`: da
  `status=S11 AND nextContactAt<=soglia` a
  `nextContactAt<=soglia AND iscrizioneComp=false`.
- Chip per-riga e chip filtro: invariati come rendering, cambiano solo la condizione dati.
- `richiamo-dialog.tsx`: onConfirm chiama `updateCrmContactRichiamoAction` invece di
  settare `status=S11`.
- `lib/crm/richiamo.ts`: `campiRichiamoDopoCambioStato` (legata all'uscita da S11) diventa
  non più necessaria per la chiusura automatica; la chiusura del richiamo alla
  registrazione è ottenuta **filtrando** (`iscrizioneComp=false`) invece di azzerare nelle
  write path → le 4 automatiche restano intatte. Mantengo `etichettaRichiamo`,
  `LABEL_FASCIA`, `OPZIONI_FASCIA`, `sogliaRichiamoDovuto`. Aggiorno il grande commento
  in testa al file per riflettere il nuovo modello (niente più caveat sulle 6 write path).

### Migration (data + schema)
- Schema: `giudizio CrmGiudizio?`, `linkApertoAt DateTime?`, enum `CrmGiudizio`. Indice
  su `giudizio` opzionale (basso valore; skip salvo necessità). Il progetto scrive le
  migration **a mano** e applica con `prisma migrate deploy` (mai `migrate dev`).
- Data migration (SQL nella stessa migration), su DB prod temporaneo:
  - `status='S3'` → `giudizio='INTERESSATO'`;
  - `status='S2'` → `giudizio='NON_INTERESSATO'`;
  - per S2/S3/S11: `status` ricalcolato al traguardo fattuale (stessa logica di
    `statoFattuale`, espressa in SQL sui flag) — così non resta un valore soggettivo in
    `status`. S11 mantiene `nextContactAt`/`nextContactFascia` (il richiamo sopravvive
    come asse indipendente).

### Test (Punto 4)
- `statoFattuale`: ogni traguardo dai flag, data corretta, S0 di default.
- `timelineFatti`: merge/ordinamento, delta tra eventi, inclusione `CrmCall`.
- Nuove action (Prisma mockato): `giudizio` scrive solo `giudizio`; `richiamo` scrive
  solo i due campi e li azzera con `null`; permessi/scoping SALES.
- Regressione richiami: preset e conteggio con la nuova condizione
  (`nextContactAt<=soglia AND iscrizioneComp=false`), incluso il caso "registrato → sparisce".
- Riprova sul DB locale reale le query nuove (preset richiamo, delete-per-filtro).

---

## File nuovi / toccati (indicativo)

**Nuovi**
- `lib/crm/tel.ts` (+ test) — `telHref`.
- `lib/crm/google-calendar.ts` (+ test) — `googleCalendarUrl`.
- `lib/crm/fatti.ts` (+ test) — `statoFattuale`, `timelineFatti`.
- `lib/crm/contatti-filtro.ts` (+ test) — `whereContatti`, `FiltroContatti`.
- `app/admin/crm/richiami/page.tsx` + `client.tsx` — vista calendario richiami.

**Toccati**
- `packages/db/prisma/schema.prisma` + nuova migration a mano (enum + 2 campi + data).
- `app/admin/crm/contatti/actions.ts` — `bulkHardDeleteCrmContactsAction`,
  `updateCrmContactGiudizioAction`, `updateCrmContactRichiamoAction`; restrizione opzioni
  status; `giudizio` in update; consumo di `whereContatti`.
- `app/admin/crm/contatti/client.tsx` — selezione multipla + barra azioni + dialog
  conferma; `tel:` in lista; due colonne (Fatti + Stato/giudizio); `GiudizioSelect`;
  chip richiamo su `nextContactAt`; timeline in `TabTracking`; "📞 Chiama" nel modale.
- `app/admin/crm/contatti/page.tsx` — `whereContatti`; preset/conteggio richiami su
  `nextContactAt`; passaggio nuovi campi al client.
- `app/i/[token]/route.ts` — set `linkApertoAt` alla prima apertura.
- `lib/crm/richiamo.ts` — commento aggiornato; helper di label invariati.
- Sidebar admin CRM — voce "Richiami".

## Ordine di esecuzione consigliato

1. Schema + migration (`giudizio`, `linkApertoAt`, enum, data migration) → base per tutto.
2. Helper puri con test (`tel`, `google-calendar`, `fatti`, `contatti-filtro`).
3. Punto 2 (tel:) — piccolo, sblocca abitudine.
4. Punto 1 (bulk hard delete).
5. Punto 4 (colonne Fatti/Giudizio + timeline + superfici richiamo) — chiude il bug.
6. Punto 3 (pagina Richiami + Google Calendar) — dipende dal richiamo decoupled.
7. Verifica e2e sul browser (selezione+delete, tel:, calendario, split stati, bug S11).

## Rischi / attenzioni

- Le query nuove vanno provate sul **DB locale reale** (i test mockano Prisma).
- `client.tsx` è già ~1800 righe: estrarre i nuovi componenti (selezione, GiudizioSelect,
  timeline) in file separati sotto `contatti/` per non gonfiarlo oltre.
- Migration a mano + `db:deploy` (mai `migrate dev`, distruttivo su questo schema).
- Verifica browser obbligatoria: bug React invisibili ai test; navigare per URL non è
  cliccare.
