# Finanze: tab periodo personalizzato (range di date)

Data: 2026-07-27
Stato: design approvato, da implementare

## Problema

La pagina Finanze (`/admin/dashboard`) filtra le metriche con quattro tab a
finestra mobile — Ultime 24h, Ultima settimana, Ultimo mese, Ultimo anno — che
producono solo un estremo inferiore (`createdAt >= adesso − N`). Non c'è modo di
chiedere «giugno 2026» o «dal 3 al 17 luglio»: l'admin che vuole chiudere un
mese deve esportare tutto e filtrare a mano nel foglio di calcolo.

Serve un quinto tab **Personalizzato** con due campi data che filtri le stesse
metriche in un intervallo chiuso.

## Difetto preesistente che questo lavoro chiude

La pagina e la route di export **duplicano** il calcolo del periodo, e le due
copie sono già divergenti:

- `apps/piattaforma/src/app/admin/dashboard/page.tsx:10` — `Periodo` include
  `'giorno'`.
- `apps/piattaforma/src/app/api/admin/dashboard/export/route.ts:9-17` —
  `Periodo` è `'settimana' | 'mese' | 'anno'` e `startOfPeriodo` chiude con un
  `else` che cattura tutto.

Conseguenza in produzione oggi: dal tab **Ultime 24h**, il bottone *Esporta CSV*
scarica **l'ultimo anno**, senza alcun segnale. Il valore `giorno` arriva alla
route, non corrisponde a nessun ramo e finisce nell'`else` di `anno`.

Aggiungere `custom` alla sola pagina replicherebbe lo stesso difetto sul nuovo
valore. Il design quindi estrae un risolutore unico e lo fa **leggere** da
entrambi i consumer — non ricopiare.

## 1. Modulo `lib/finanze/periodo.ts` (puro, niente IO)

Fonte unica del periodo per la pagina e per l'export.

```ts
export type Periodo = 'giorno' | 'settimana' | 'mese' | 'anno' | 'custom';

export type PeriodoRisolto = {
  gte?: Date;          // estremo inferiore (assente = aperto a sinistra)
  lte?: Date;          // estremo superiore (solo su 'custom')
  label: string;       // "Ultimo mese" | "Dal 01/06/2026 al 30/06/2026"
  da: string;          // 'YYYY-MM-DD' ri-emesso se valido, altrimenti ''
  a: string;
};

export function parsePeriodo(value: string | undefined): Periodo;   // default 'mese'
export function resolvePeriodo(args: {
  periodo: Periodo;
  da?: string;
  a?: string;
  now?: Date;                                                        // iniettabile per i test
}): PeriodoRisolto;
export function defaultCustomRange(now: Date): { da: string; a: string };
```

Regole:

- I quattro periodi mobili conservano **esattamente** il comportamento attuale
  (`gte = now − N`, nessun `lte`). Nessuna metrica esistente si sposta.
- `custom` delega a `resolveDayRange(da, a)` di `lib/date/rome-day.ts`: giorni
  interi in Europe/Rome (`00:00:00.000` → `23:59:59.999`), DST e date impossibili
  già gestiti e testati lì. Non nasce una seconda implementazione del fuso.
- Estremo singolo ammesso: solo `da` significa «da lì in poi», solo `a`
  significa «fino a lì». Estremo malformato ignorato in silenzio, come in
  `resolveDayRange`.
- `parsePeriodo` di un valore sconosciuto torna `'mese'` (il default di oggi),
  non l'ultimo ramo di una catena di `if`.

### `defaultCustomRange`

Il tab nasce precompilato con l'ultimo mese: `a` = oggi a Roma, `da` = stesso
giorno del mese precedente. La sottrazione **clampa all'ultimo giorno del mese
di destinazione**: da 31 marzo si ottiene 28 (o 29) febbraio, non il 3 marzo che
darebbe `setMonth` da solo. Il giorno "oggi" viene da `romeYmd(now)`, non da
`getDate()`: il runtime su Vercel è UTC e fino all'una di notte italiana
sbaglierebbe giorno.

## 2. Consumer

### Pagina `admin/dashboard/page.tsx`

- `const { gte, lte, label, da, a } = resolvePeriodo({ periodo, da: sp.da, a: sp.a })`.
- `where.createdAt` diventa `{ gte, ...(lte ? { lte } : {}) }`; identico per
  `payout.eseguitoAt` nella card "Già erogato".
- Il sottotitolo dell'header e l'etichetta della card "Già erogato" usano `label`.
- La card **"Da erogare (saldo wallet aperti)"** resta fuori dal filtro: è lo
  snapshot dei saldi correnti, non un aggregato di periodo. Invariata.

### Route `api/admin/dashboard/export/route.ts`

- Cancella il suo `startOfPeriodo` e il suo tipo `Periodo` locali; importa il
  modulo condiviso e propaga `da`/`a` dalla query.
- Il nome del file scaricato riporta il range su `custom`
  (`pratiche-2026-06-01_2026-06-30-...csv`) invece della parola `custom`, che
  non direbbe nulla una volta salvato sul disco.

## 3. UI

- **Quinto tab** «Personalizzato» nella riga esistente `PeriodoTabs`. Il suo
  href porta già le date: `?periodo=custom&da=…&a=…` da `defaultCustomRange`.
  Precompilare solo il `defaultValue` degli input lascerebbe i campi a dire una
  cosa e le card a mostrarne un'altra finché non si tocca un input.
- Quando `periodo === 'custom'`, sotto i tab compare una fascia con i due campi
  `type="date"`. Client component sul modello di `app/addebiti/filters.tsx`:
  form GET su `/admin/dashboard`, `requestSubmit()` su `onChange`, `periodo` e
  `tipo` come campi hidden per non perdere il filtro tipo pratica al submit.
- `TipoTabs` propaga `da`/`a` quando il periodo è `custom`, altrimenti
  cambiare tipo pratica riporterebbe al periodo di default.
- L'href dell'export propaga `da`/`a`.

## Edge case

- **Range invertito** (`da` > `a`): nessuna eccezione, Prisma torna zero righe.
  La pagina mostra gli stati vuoti già esistenti ("Nessuna pratica firmata nel
  periodo selezionato"). Non aggiungiamo validazione: il caso si vede e si
  corregge da sé.
- **Numeri diversi da "Ultimo mese"**: il custom precompilato prende giorni
  interi (00:00 → 23:59:59), il tab mobile parte dall'istante di 30 giorni fa.
  Uno scarto di poche pratiche al bordo è atteso e corretto.
- **Solo `a` valorizzato**: `gte` assente, quindi rientra tutto lo storico fino
  a quella data. Voluto.

## Test

- Unit su `resolvePeriodo` con `now` iniettata: i quattro periodi mobili
  restituiscono gli stessi bound di prima; `custom` con entrambi gli estremi,
  con uno solo, con input malformato.
- Unit su `defaultCustomRange`: caso normale, clamp da 31 marzo a fine
  febbraio, anno bisestile, cambio d'anno (gennaio → dicembre precedente).
- **Test di non-divergenza**: a parità di query string, i bound calcolati dalla
  route export coincidono con quelli della pagina. È la regressione che ha
  prodotto il bug del CSV a 24h e che non deve poter tornare.

## File toccati

- `apps/piattaforma/src/lib/finanze/periodo.ts` — **nuovo**, risolutore condiviso
- `apps/piattaforma/src/lib/finanze/periodo.test.ts` — **nuovo**
- `apps/piattaforma/src/app/admin/dashboard/page.tsx` — usa il risolutore, quinto
  tab, propagazione `da`/`a`
- `apps/piattaforma/src/app/admin/dashboard/filtri-periodo.tsx` — **nuovo**,
  client component con i due campi data
- `apps/piattaforma/src/app/api/admin/dashboard/export/route.ts` — usa il
  risolutore, chiude il bug del periodo `giorno`

Nessuna migration, nessuna variabile d'ambiente, nessun impatto sui dati.
