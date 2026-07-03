# Verifica manuale — Co-intestatari acquirente (Task 10)

> Checklist di verifica end-to-end per la feature "co-intestatari acquirente"
> (branch `feat/co-intestatari-acquirente`). Sostituisce un e2e Playwright
> automatizzato: vedi la sezione **Perché non è automatizzato** in fondo.

Pre-requisiti: dev server up (`pnpm --filter piattaforma dev`, Node 22 via
`nvm use 22.15.0`), DB locale seedato, login come broker
(`dealer1@passaggioveloce.it` / `DevPass123!`, vedi
`apps/piattaforma/e2e/smoke.spec.ts`).

## (a) CTA "+ Aggiungi co-intestatario" solo su SEMPLICE

1. `/pratiche/nuova` → crea una pratica **SEMPLICE** mono-veicolo, avanza fino
   allo **Step 3 (Acquirente)**.
2. Sotto il blocco "L'indirizzo di residenza è lo stesso indicato nel
   documento?" deve comparire il pulsante **"+ Aggiungi co-intestatario"**
   (bordo tratteggiato navy).
3. Torna indietro, ricomincia una pratica **MINIVOLTURA** (o cambia il tipo
   pratica nello step 1) e arriva di nuovo allo Step 3: il pulsante **non**
   deve comparire (né gli eventuali blocchi "Co-intestatario N" già aggiunti
   in una sessione SEMPLICE precedente — verifica che passando da SEMPLICE a
   MINIVOLTURA nello stesso draft la lista si azzeri, non resti visibile).

## (b) Tipo soggetto in cima alla card acquirente; venditore invariato

1. Step 3, blocco "Acquirente": il campo **"Tipo soggetto"** deve essere il
   **primo campo** della card (sopra nome/cognome/CF ecc. di `ParteForm`),
   con un separatore (riga grigia) subito sotto.
2. Ripeti per un blocco "Co-intestatario N" aggiunto: stesso ordine (tipo
   soggetto in cima).
3. Torna allo **Step 2 (Venditore)**: verifica che il layout del blocco
   venditore **non sia cambiato** (tipo soggetto resta dove stava prima —
   nessuna regressione di posizionamento sul venditore).

## (c) Add → fill → remove-a-middle-one → re-add non genera state bleed

Il rendering usa `key={idx}` (indice posizionale, non un id stabile) in
`renderCoAcquirente` (`apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`,
riga con `const renderCoAcquirente = (c: CoAcquirenteInput, idx: number) =>` e
`<div key={idx} ...>`), quindi è il caso a rischio principale di mixing dei
campi tra card diverse quando si rimuove un elemento intermedio.

1. Step 3 → clicca 3 volte "+ Aggiungi co-intestatario" → compaiono
   "Co-intestatario 1/2/3".
2. Compila dati **distinguibili** per ciascuno (es. nome "Uno"/"Due"/"Tre",
   tipo soggetto diverso se possibile, un upload documento diverso per
   ciascuno).
3. Clicca **"Rimuovi"** sul **Co-intestatario 2** (quello di mezzo).
4. Verifica che il **Co-intestatario 1** (ora ancora "1") mantenga i suoi
   dati originali ("Uno") e che quello che rimane come "Co-intestatario 2"
   mostri i dati che prima erano di "Tre" (non un mix, non i dati vecchi del
   2 rimosso, nessun campo "fantasma" residuo tipo upload/OCR del rimosso che
   compare nel nuovo indice 2).
5. Clicca di nuovo "+ Aggiungi co-intestatario" (ricompare "Co-intestatario
   3"): deve nascere **vuoto** (nessun campo precompilato con dati del
   vecchio "2" rimosso — in particolare upload file, OCR salvato,
   `residenzaDiversa`/indirizzo, `tipoSoggetto`).
6. Ripeti la sequenza controllando anche i toggle "residenza uguale al
   documento" (Sì/No) e l'eventuale indirizzo inserito: non devono spostarsi
   tra card dopo la remove.

## (d) Persistenza: submit con 1 co-intestatario

1. Step 3: aggiungi **1 co-intestatario**, tipo soggetto **PRIVATO** (CIE o
   cartacea), compila anagrafica, carica CI fronte/retro (stesse fixture
   usate per acquirente/venditore), residenza = uguale al documento (o
   compila l'indirizzo se diversa).
2. Completa Step 4 e invia la pratica. Verifica il redirect a
   `/pratiche/<id>`.
3. Nel dettaglio pratica, sotto il blocco Acquirente deve comparire
   **"Co-intestatari (1)"** con nome/CF (o ragione sociale/P.IVA se PG) e,
   se impostato, l'indirizzo di residenza (vedi
   `apps/piattaforma/src/app/pratiche/[id]/page.tsx`).
4. Verifica DB: `pnpm --filter @pv/db db:studio` (Node 22 attivo).
   - Tabella **`co_acquirenti`**: deve esserci 1 riga con `praticaId` =
     l'id della pratica appena creata, `ordine = 1`, campi anagrafici
     coerenti con quanto inserito.
   - Tabella **`documenti`**: le righe caricate per il co-intestatario
     (CI fronte/retro, eventuale CF) devono avere **`coAcquirenteId`**
     valorizzato con l'id della riga `co_acquirenti` appena creata (e
     `venditoreId`/altri owner FK a `null` per quelle righe).
5. (Opzionale, robustezza) Ripeti con **2 co-intestatari** e verifica che
   entrambe le righe `co_acquirenti` abbiano `ordine` 1 e 2 rispettivamente,
   e che i documenti di ciascuno puntino al `coAcquirenteId` corretto (nessun
   incrocio tra i documenti del co-intestatario 1 e quelli del 2).

## (e) Dettaglio pratica mostra i co-intestatari

Coperto anche da (d).3: la sezione **"Co-intestatari (N)"** con elenco
nome/CF (o ragione sociale/P.IVA) ed eventuale residenza deve comparire nel
box Acquirente di `/pratiche/<id>`. Se `N = 0` (nessun co-intestatario), la
sezione non deve comparire affatto (verifica anche questo caso su una
pratica SEMPLICE senza co-intestatari, per assicurarsi che non compaia un
blocco vuoto).

---

## Perché non è automatizzato (e2e Playwright)

`apps/piattaforma/e2e/` contiene solo `smoke.spec.ts` e `login-2fa.spec.ts`:
non esiste un e2e esistente che crei una pratica, e costruirne uno per questo
flusso si è rivelato **strutturalmente bloccato** dal provider OCR di
sviluppo, non solo "scomodo":

- Il gate dello step 2→3 (`canStep2`, in
  `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`) richiede
  `verdettiVenditori[i].ok === true`, calcolato da `validaParte`/
  `verificaDocumentaleParte` (`apps/piattaforma/src/lib/kyc/parte-docs.ts`),
  che a sua volta richiede un verdetto `MATCH` sull'identità estratta via OCR
  (`extractCi`/`extractCf`, che cercano righe `NOME`/`COGNOME` nel testo
  OCR).
- Con `OCR_PROVIDER=mock` (default locale/dev, vedi `.env.example` e
  `apps/piattaforma/src/env.ts`), `MockOcrProvider.extractText`
  (`apps/piattaforma/src/lib/providers/ocr/mock.ts`) **non legge il
  contenuto del file**: restituisce sempre un placeholder fisso
  (`` `MOCK OCR TEXT\nhash=${hash}\nbytes=${...}` ``, derivato solo
  dall'hash dei byte, non da un vero OCR). Questo testo non matcha mai i
  pattern `NOME`/`COGNOME` attesi da `extractCi` → il verdetto è sempre
  `ILLEGGIBILE` → `canStep2` resta `false` per qualunque file caricato.
- Diversamente, `extractLibretto` (usato allo step 1 per il veicolo) nel
  mock **restituisce dati strutturati finti ma completi** (targa, telaio,
  proprietario…), quindi lo step 1 è superabile in automatico; è lo step 2
  (documenti d'identità venditore, propedeutico allo step 3 dove vivono i
  co-intestatari) il bottleneck reale.
- Non esiste, nel codice attuale, alcun bypass/flag (tipo `DEMO_MODE` o
  `NODE_ENV=test`) che aggiri questa verifica per l'identità nel wizard
  pratiche: `DEMO_MODE` copre solo strumenti admin (cron/email demo), non il
  KYC/OCR dei documenti — anzi il KYC è stato di recente portato "LIVE IN
  PROD" proprio per essere fail-closed e reale.

Costruire un e2e affidabile richiederebbe quindi una delle due strade, entrambe
sproporzionate per questo task time-boxed:
1. Introdurre nel codice di prodotto un bypass/OCR-fixture-provider dedicato
   ai test (rischio: introduce un percorso "non reale" in un'area
   volutamente fail-closed/anti-frode, da NON fare senza discussione
   esplicita di design).
2. Intercettare via `page.route` le Server Action POST del wizard per
   restituire risposte finte — fragile (id azione cifrati, cambiano ad ogni
   build) e a sua volta una porzione notevole di nuova infrastruttura di
   test, non "leggera".

Per questo si è scelto di **non** scrivere un e2e Playwright fragile o
mock-pesante, e di fornire invece questa checklist manuale, concreta e
puntuale sui file/righe di codice coinvolti. La logica pura riusata dalla
feature (`residenzaOk`, `validaParte`/`verificaDocumentaleParte`) è già
coperta da vitest esistente (`residenza.test.ts`, `parte-docs.test.ts`); non
è stata forzata l'estrazione di nuovi moduli puri dalla UI/gate solo per
avere "un test in più", perché la logica "solo SEMPLICE"/CTA/gate step3 vive
inline in `wizard.tsx` (JSX + closure sullo state) e non in una forma
facilmente estraibile senza un refactor non richiesto da questo task.
