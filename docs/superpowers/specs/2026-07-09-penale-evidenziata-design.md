# Evidenziare le penali nella lista movimenti wallet

Data: 2026-07-09

## Problema

Nella lista dei movimenti del wallet una penale non si distingue a colpo d'occhio da un
qualunque altro addebito. L'importo **è già rosso per ogni movimento negativo** — quindi
anche per un payout — e il colore da solo non porta l'informazione.

## Perimetro

Le liste di transazioni wallet sono **due**, non "in ogni schermata":

- `apps/piattaforma/src/app/wallet/page.tsx` — vista per singola sede;
- `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx` — vista aggregata del proprietario.

`app/fatturazione/page.tsx` nomina le transazioni ma non le elenca: conta i crediti agganciati
a un payout. Il **rendiconto PDF** (`api/wallet/rendiconto/route.ts`) è l'estratto conto del
wallet **madre**, che dal fix del 2026-07-09 contiene solo commissioni di affiliazione: una
`PENALE_BROKER` non può più finirci. Fuori perimetro **per costruzione**, non per scelta.

## Cosa evidenziare

Solo `PENALE_BROKER`. Lo `STORNO` che a volte l'accompagna nel flusso penale è il recupero di
un compenso già accreditato, non una sanzione, e resta un movimento negativo normale. Le
`RETTIFICA_ADMIN` negative possono essere semplici correzioni contabili: evidenziarle
allarmerebbe a sproposito.

## Il nodo tecnico

`wallet-aggregato.tsx` riceve oggi `tipo` **già trasformato in etichetta** (`"Penale
segnalazione"`), perché la pagina chiama `labelTipoTx` mentre costruisce l'array. Il componente
non sa più che transazione stia mostrando, quindi non può decidere di evidenziarla.

La vista normale invece ha ancora il tipo grezzo, perché renderizza direttamente le righe Prisma.

## Design

### Un modulo condiviso

Nuovo file `apps/piattaforma/src/app/wallet/movimenti.ts`:

```ts
/** Etichetta leggibile del tipo di movimento. */
export function labelTipoTx(tipo: string): string

/** Solo l'addebito della sanzione: lo storno che l'accompagna non è una penale. */
export function isPenale(tipo: string): boolean

/** Classi della riga di una penale, uguali nelle due viste. */
export const CLASSI_RIGA_PENALE: string
```

`labelTipoTx` **si sposta** da `page.tsx`, dov'è oggi una funzione privata. Diventa la fonte
unica per entrambe le viste, insieme a `isPenale` e alla stringa di classi: così "cos'è una
penale" e "che aspetto ha" vivono in un posto solo.

### La vista aggregata torna a ricevere il tipo grezzo

`MovimentoAggregato.tipo` passa da etichetta a **tipo grezzo**, e `wallet-aggregato.tsx` chiama
`labelTipoTx` al momento del render. È anche la separazione corretta: la presentazione appartiene
al componente, non alla pagina che carica i dati.

### Aspetto

Sulla riga della penale:

```
border-l-2 border-pv-red-500 bg-pv-red-50/40 pl-3 pr-2 rounded-r-[6px]
```

Il fondo **non** sborda fino ai bordi della card: resta dentro il padding della lista. È la scelta
meno invasiva — niente margini negativi da accordare al padding della `Card`, che è
`p-5 sm:p-6` e cambia al breakpoint. `pl-3` stacca il testo dal bordo, `rounded-r` chiude la
forma a destra.

Stesso linguaggio già usato in `app/admin/agenzie/page.tsx:142`, che tinge una riga con
`bg-pv-red-50/40`.

Nessun testo aggiuntivo: l'etichetta dice già "Penale segnalazione", e nella vista normale sotto
compare il motivo ("Fermo amministrativo"). **Il colore non è l'unico veicolo
dell'informazione**, quindi un chip sarebbe ridondante.

## Casi limite

- **Movimento senza penale**: nessuna classe aggiuntiva, la riga resta com'è oggi.
- **Penale in vista aggregata**: la riga si evidenzia anche lì, e la colonna "origine" continua a
  dire da quale sede arriva.
- **Un tipo nuovo aggiunto all'enum**: `isPenale` resta falso finché qualcuno non lo dichiara
  esplicitamente. È voluto: evidenziare per errore è peggio che non evidenziare.
- **`divide-y` della lista**: la riga evidenziata non deve rompere i separatori né sbordare dalla
  card. Da verificare a video.

## File toccati

Nuovi:
- `apps/piattaforma/src/app/wallet/movimenti.ts` + `movimenti.test.ts`

Modificati:
- `apps/piattaforma/src/app/wallet/page.tsx` — rimuove `labelTipoTx` privata, importa dal modulo,
  applica le classi alla riga, passa il tipo grezzo alla vista aggregata
- `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx` — etichetta al render, applica le classi

Nessuna migration, nessun cambio di schema, nessuna query nuova.

## Verifica

- **Unit (vitest)**: `isPenale` vero solo per `PENALE_BROKER` e falso per gli altri sette valori
  di `TransazioneWalletTipo`; `labelTipoTx` restituisce le etichette attese e ricade sul valore
  grezzo per un tipo sconosciuto.
- **A video**: una penale evidenziata e un payout non evidenziato, nella stessa lista, in
  entrambe le viste; i separatori `divide-y` intatti; il fondo colorato che non sborda dalla card.
