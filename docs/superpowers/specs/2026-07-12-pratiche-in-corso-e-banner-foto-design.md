# Pratiche in corso (tab + evidenza) e banner qualità foto — Design

Data: 2026-07-12
Stato: approvato (Francesco), pronto per il piano di implementazione

## Contesto

Due richieste indipendenti, entrambe sulla "sezione pratiche":

1. **Lista pratiche** (`/pratiche`, condivisa da broker/dealer e agenzia): le pratiche
   ancora da seguire si perdono in mezzo all'archivio. Servono un'evidenza visiva
   nella lista completa e un accesso rapido tramite tab.
2. **Wizard di creazione pratica**: aggiungere un avviso sulla qualità delle foto dei
   documenti, che dica anche che da telefono si può scattare la foto direttamente.

### Premessa corretta durante il brainstorming

La richiesta iniziale parlava di «un banner che chiede di caricare le foto in alta
qualità» già esistente nel wizard. **Quel banner non esiste** (verificato su tutto
`apps/piattaforma/src` e sulla history git): negli step con upload l'unico Alert è
«I documenti vanno portati in agenzia» (`wizard.tsx:2338` e `:2467`). Esistono solo
messaggi d'errore OCR a posteriori. Il banner va quindi **creato da zero**.

## Feature 1 — Pratiche in corso

### 1.1 Definizione di "in corso" (fonte unica)

Oggi la definizione di "pratica attiva" vive solo dentro `api/badges/route.ts:17`,
come lista di stati esclusi:

```ts
const STATI_ESCLUSI = ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'];
```

Adottiamo **la stessa** definizione per i tab (decisione presa: annullate e scadute
NON sono "in corso") e la estraiamo in un modulo condiviso, così badge e tab non
possono divergere.

Nuovo file `apps/piattaforma/src/lib/pratiche/stati.ts`:

| Gruppo | Stati |
|---|---|
| `BOZZA` (a sé) | `BOZZA` |
| `STATI_IN_CORSO` | `IN_ATTESA_ROUND_1`, `IN_ATTESA_ROUND_2`, `IN_ATTESA_ROUND_3`, `IN_ESCALATION`, `ACCETTATA`, `PROCESSATA` |
| `STATI_CONCLUSI` | `FIRMATA`, `ANNULLATA`, `SCADUTA` |

API esportata:

- `STATI_IN_CORSO`, `STATI_CONCLUSI` (readonly tuple di `PraticaStato`)
- `isInCorso(stato: PraticaStato): boolean`
- `whereStato(param: string | undefined): Prisma.PraticaWhereInput['stato'] | undefined`
  — traduce il valore di `?stato=` nel filtro Prisma, gestendo i valori aggregati
  (`IN_CORSO`, `CONCLUSE`, `IN_ATTESA`) e i valori singoli; ritorna `undefined` per
  valore assente o non riconosciuto (nessun filtro, come oggi).

`api/badges/route.ts` viene rifattorizzato per derivare il conteggio da
`STATI_IN_CORSO` (`stato: { in: STATI_IN_CORSO }`) invece che dalla lista di esclusi.
Attenzione a non confondersi con `wherePraticaAttiva()` di `lib/sedi/scope-filters.ts`:
quella riguarda lo **scoping per sede**, non lo stato, e resta invariata.

`STATI_IN_ATTESA` in `pratiche/page.tsx:39` viene rimosso e derivato da `stati.ts`.

### 1.2 Tab

I tab sono **link GET** che scrivono sullo **stesso** parametro `?stato=` già esistente,
usando due nuovi valori aggregati `IN_CORSO` e `CONCLUSE` (stesso pattern del valore
aggregato `IN_ATTESA` già in uso). Nessun parametro nuovo: impossibile avere tab e
select in conflitto, e i deep-link restano condivisibili.

Set di tab **per ruolo**:

- **Broker/dealer**: `Tutte` · `In corso · N` · `Bozze · N` · `Concluse · N`
- **Agenzia**: `Tutte` · `In corso · N` · `Concluse · N`

Il tab "Bozze" non esiste per l'agenzia: `agenziaSedeId` viene scritto solo
all'accettazione (`inbox/actions.ts:92`), quindi la lista di un'agenzia non contiene
mai pratiche in `BOZZA` (né in attesa) e il tab sarebbe sempre a zero.

Comportamento:

- Tab attivo = derivato da `sp.stato`: `IN_CORSO` → "In corso", `BOZZA` → "Bozze",
  `CONCLUSE` → "Concluse", assente → "Tutte". Un valore granulare selezionato dalla
  select (es. `PROCESSATA`) **non** attiva nessun tab (nessuno appare selezionato):
  è un filtro più fine di qualunque tab.
- I link dei tab **preservano** gli altri filtri attivi (`q`, `periodo`, `sede`) e
  **azzerano** `page` (cambiare tab riporta a pagina 1).
- Default all'apertura di `/pratiche` senza parametri: **Tutte** (comportamento attuale
  invariato; nessun bookmark cambia semantica).
- La select "Stato" resta e si sincronizza: include i nuovi valori aggregati
  `In corso` e `Concluse` in cima, così `defaultValue={sp.stato}` mostra sempre il
  valore corretto quando arrivi da un tab.

### 1.3 Contatori

Una **sola** query aggiuntiva, `prisma.pratica.groupBy({ by: ['stato'], _count: true })`,
con la stessa `where` della lista **meno** il filtro `stato` (quindi con ricerca,
periodo e sede applicati). I conteggi dei tab riflettono esattamente ciò che ottieni
cliccandoli con i filtri correnti. La query gira in parallelo (`Promise.all`) con
`findMany` + `count` già presenti.

`Tutte` mostra il totale = somma di tutti i gruppi.

### 1.4 Evidenza delle righe in corso

Barra accento navy a sinistra della riga, sulle pratiche in corso, in **tutti** i tab
(compreso "Tutte", dove serve di più).

Implementazione: **tutte** le righe ricevono `border-l-[3px]`, con
`border-transparent` sulle non-in-corso e `border-pv-navy-600` sulle in corso. Così
non c'è scostamento di 3px tra riga evidenziata e non evidenziata.

**La riga header** (`pratiche/page.tsx:242`) deve ricevere lo stesso
`border-l-[3px] border-transparent`, altrimenti le colonne dell'header si disallineano
di 3px rispetto a quelle delle righe.

Accessibilità: il significato non è affidato al solo colore — lo stato resta scritto
in chiaro nello `StatusChip` della stessa riga. La barra è decorativa.

### 1.5 Fuori scope (feature 1)

- `/admin/pratiche`: invariata (ha già l'ordinamento per priorità con escalation in cima).
- Nessun riordino della lista utente: le pratiche in corso restano al loro posto
  cronologico (`submittedAt desc`), solo evidenziate.
- Nessun cambio alla dashboard o all'inbox.

## Feature 2 — Banner qualità foto nel wizard

Nuovo `<Alert variant="info" title="Come fotografare i documenti">` (componente
`components/ui/alert.tsx`, già esistente), con lista puntata — stesso pattern degli
Alert con bullet già usati a `wizard.tsx:1840`.

Contenuto:

> - Foto **nitide e ben illuminate**, con il documento **intero** nell'inquadratura.
> - Evita riflessi, ombre e foto storte: se il testo non si legge, i dati non vengono
>   compilati in automatico.
> - **Da telefono puoi scattare la foto direttamente**: tocca "Carica file" e scegli
>   la fotocamera. Poi puoi ritagliarla e raddrizzarla nell'editor.

Posizionamento: **una volta per step** (non una per persona/veicolo), sopra l'area di
upload, negli step che contengono upload — step 1 (libretto / foglio complementare),
step 2 (documenti venditore), step 3 (documenti acquirente) e la sezione co-intestatari.

Il warning esistente «I documenti vanno portati in agenzia» resta dov'è e non viene
toccato: i due banner dicono cose diverse e convivono.

Per evitare la duplicazione del markup in 4 punti, il banner è un piccolo componente
locale (es. `BannerFotoDocumenti`) definito una volta e usato negli step.

### 2.1 Perché NON aggiungiamo `capture="environment"`

L'input file del wizard (`upload-card.tsx:185`) accetta già
`application/pdf,image/jpeg,image/png,image/jpg`: su iOS e Android il menu nativo
mostra quindi **già** "Scatta foto / Fotocamera" accanto a galleria e file. Il messaggio
descrive una capacità che esiste oggi, senza toccare la logica di upload.

Aggiungere l'attributo `capture` **peggiorerebbe** la situazione: su molti browser
mobile forza la fotocamera e **rimuove** la scelta della galleria, penalizzando chi la
foto ce l'ha già scattata. Decisione: nessun `capture`, nessun pulsante "Scatta foto"
dedicato.

## Test

- `lib/pratiche/stati.test.ts`
  - **Invariante di partizione**: ogni valore dell'enum `PraticaStato` cade in
    **esattamente uno** tra `BOZZA` / `STATI_IN_CORSO` / `STATI_CONCLUSI`. Se domani
    viene aggiunto uno stato all'enum senza classificarlo, il test diventa rosso invece
    di farlo sparire silenziosamente dai tab e dai conteggi. (Stesso spirito del test di
    invarianza già presente in `lib/pratiche/table-grid.test.ts`.)
  - `whereStato()`: valori aggregati (`IN_CORSO`, `CONCLUSE`, `IN_ATTESA`) → `{ in: [...] }`;
    valore singolo → uguaglianza; valore assente o spazzatura → `undefined`.
  - `isInCorso()` sui casi limite (`BOZZA` no, `IN_ESCALATION` sì, `ANNULLATA` no).
- Coerenza badge/tab: test che il conteggio del badge e il gruppo `IN_CORSO` usino la
  stessa costante (il refactor di `api/badges/route.ts` rende la cosa strutturale, il
  test la blocca).
- Verifica manuale in locale (DB copia di prod) su entrambi i ruoli: broker (4 tab) e
  agenzia (3 tab), contatori coerenti coi filtri attivi, allineamento colonne header
  con la barra accento, wizard su viewport mobile.

## Rischi noti

- **Nessuna migration**: solo lettura, nessun cambio di schema.
- La select "Stato" per l'agenzia continua a esporre valori che per lei danno sempre
  zero risultati (`Bozza`, `In attesa`, `Scaduta`). È un difetto **preesistente** e resta
  fuori scope; se lo si vuole sistemare, è una riga (filtrare `STATI_USER` per ruolo)
  ma va deciso a parte.
