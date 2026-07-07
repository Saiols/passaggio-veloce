# Migliorie wizard creazione pratica (3 interventi)

> Spec di design — 2026-07-07
> Stato: APPROVATA (design). Owner: Francesco Sioli (CTO).
> File principale: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (~3400 righe).

## 1. Contesto e obiettivo

Tre migliorie al wizard di creazione pratica (`/pratiche/nuova`, 4 step:
1 Tipo & veicoli · 2 Venditore · 3 Acquirente · 4 Invio):

1. Riportare il "Tipo soggetto" del venditore insieme ai suoi dati (come già per l'acquirente).
2. Aggiungere bordi rossi sui campi/card problematici, senza mai mostrarli all'apertura.
3. Nel caso "foglio complementare", permettere l'upload opzionale di fronte/retro del libretto originale.

## 2. Decisioni (approvate con l'utente)

- **T1**: il selettore "Tipo soggetto" del venditore va **in cima alla card dati** del venditore
  (prima di `ParteForm`), rispecchiando acquirente/co-acquirente; la `IdentitaSection` del
  venditore riceve `hideTipoSoggetto`.
- **T2 trigger**: `invalid = (toccato || revealStep) && !valido`. Bordo rosso **live** appena un
  campo è toccato ed è mancante/errato; i campi mai toccati restano neutri; il clic sul CTA
  disabilitato ("Avanti"/"Invia") **rivela tutti** i campi problematici rimasti (oltre al motivo
  testuale già mostrato). La pagina non si apre mai con bordi rossi.
- **T2 copertura**: **tutti** i campi già validati dalle funzioni `mancanze*`/`parteCompleta` dei 4
  step (dettaglio §4).
- **T3**: il libretto originale nel ramo foglio è **solo allegato logic-less**: nessun OCR, nessun
  auto-fill (i dati veicolo restano inseriti a mano dal foglio), **non obbligatorio**.

## 3. T1 — Tipo soggetto venditore

File: `wizard.tsx`, `renderVenditore` (card dati venditore + `IdentitaSection`) e `IdentitaSection`
(prop `hideTipoSoggetto`).

- Nel `renderVenditore`: aggiungere il `<Field label="Tipo soggetto" required>` con `<Select>` in
  cima alla card dati (prima di `<ParteForm parte={v} .../>`), usando la stessa logica di
  `onTipoSoggetto` già passata alla IdentitaSection (set `tipoSoggetto`/`isPG`/reset visura/permesso).
- Passare `hideTipoSoggetto` alla `IdentitaSection` del venditore.
- Aggiornare il commento di `IdentitaSection` (oggi dice "inline = venditore, esterno = solo
  acquirente"): ora tutte le parti rendono il tipo soggetto esternamente.
- Nessun cambio di stato/OCR/submit: si sposta solo il punto di rendering.

## 4. T2 — Bordi rossi (live + reveal)

File: `wizard.tsx` (+ eventuale nuovo helper `field-errors.tsx` locale nella cartella `nuova/`).

### 4.1 Meccanismo
- Nuovo stato nel wizard: `touched: Set<string>` e `revealStep: Record<1|2|3|4, boolean>` (o un
  singolo `reveal` per lo step corrente). Un piccolo **context** (`FieldErrorsProvider`) espone:
  `touch(key)`, `isInvalid(key, valid)` = `(touched.has(key) || revealForCurrentStep) && !valid`,
  e `reveal()`.
- **Touch**: gli input di testo/numero registrano il touch su `onBlur`; i `Select` su `onChange`.
- **Reveal al click**: negli onClick "Avanti/Invia" dove oggi, se lo step è incompleto, si chiama
  `avvisaMancanze(...)`, aggiungere una chiamata `reveal()` per lo step corrente → accende tutti i
  bordi mancanti. `reveal` dello step si azzera quando si entra/cambia step (`setStep`).
- **Upload card obbligatorie**: `invalid` = solo `reveal && mancante` (nessun touch nel typing).
  L'errore di upload resta già rosso da sé (`erroreUpload`).
- Si riusano i prop `invalid` esistenti di `Input`/`Select`/`NumberInput`/`UploadCard`.

### 4.2 Copertura per step (campi già in `mancanze*`)
- **Step 1** (card veicolo): `targa` (<5), `telaio` (<11), `proprietarioAttuale` (vuoto),
  `dataImmatricolazione` (regex), `prezzoVendita` (≤0); card documento: libretto fronte/retro
  oppure foglio mancante; certificato di proprietà se `preImm2015`.
- **Step 2/3** (`ParteForm` + `IdentitaSection`, per venditore/acquirente/co-acquirente): tipo
  soggetto; se PG: ragione sociale, P.IVA (≠11); se PF: nome, cognome, CF (≠16); telefono, email
  (regex); upload identità/CF fronte+retro/visura/permesso quando richiesti; indirizzo residenza se
  "residenza diversa".
- **Step 4**: sede di partenza (se multi-sede), comune, provincia (2 lettere).
- I verdetti OCR fail-closed restano `Alert` dedicati (invariati).

### 4.3 Chiavi campo
Chiavi stabili e uniche per istanza (venditori/co-acquirenti sono liste): es.
`vend:<id>:cf`, `acq:cf`, `co:<id>:email`, `veic:<idx>:targa`, `step4:comune`. Il context vive
per l'intera sessione wizard; le chiavi includono l'id di parte/veicolo per non collidere.

## 5. T3 — Libretto originale opzionale nel foglio

File: `wizard.tsx` (tipo `VeicoloInput`, card veicolo, submit) e `actions.ts` (mappatura
blob→Documento) — da verificare in fase di piano.

- Aggiungere a `VeicoloInput` due slot: `librettoOrigFronte: BlobSlot`, `librettoOrigRetro: BlobSlot`
  (init `emptySlot()`), separati dagli slot `libretto`/`librettoRetro` (che restano azzerati in
  modalità foglio, come oggi).
- Nel ramo `isFoglio` della card veicolo, dopo l'UploadCard del foglio, aggiungere due UploadCard
  **opzionali** "Libretto originale — fronte / retro" con handler di upload dedicati che **non**
  avviano OCR (nessun `runLibrettoOcr`).
- **Non** entrano in `canStep1`/`mancanzeStep1` (opzionali).
- Al submit, quando `isFoglio` e gli slot hanno `ref`, aggiungere i blob agli allegati veicolo
  (chiavi dedicate, es. `LIBRETTO_ORIGINALE_<i>_FRONTE/RETRO`), mappati a `Documento` come allegati
  di supporto. In fase di piano: confermare che `actions.ts` accetti chiavi documento generiche o
  aggiungere il mapping (additivo, senza migration se il modello `Documento` è già generico).
- Reset degli slot orig quando si torna a "Libretto" (coerente con l'azzeramento attuale).

## 6. Testing
- **T1**: verifica manuale/render — il tipo soggetto compare in cima ai dati venditore; l'invio
  resta identico (il valore `tipoSoggetto` è lo stesso stato).
- **T2**: unit test puro dell'helper `isInvalid(key, valid)` (mai invalid se non toccato e non
  reveal; invalid se toccato+non valido o reveal+non valido); verifica reveal-on-click + reset al
  cambio step. Verifica manuale: apertura pagina senza bordi.
- **T3**: unit sui parser/submit non necessari (logic-less); verifica che gli slot orig NON entrino
  in `canStep1`; test/asserzione che al submit foglio+libretto orig i blob attesi siano inclusi;
  verifica manuale upload opzionale.
- Regressione: suite completa, typecheck, lint, build.

## 7. Fuori scope
- OCR/auto-fill dal libretto originale nel caso foglio.
- Ridisegno della validazione aggregata (`canStep*`/`mancanze*` restano; T2 aggiunge solo il
  livello per-campo).
- Cambi schema/migration (salvo mapping documento additivo se necessario per T3).
