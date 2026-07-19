# Giustificativo interno costo promo ("Documento 2") — Design

- **Data:** 2026-07-19
- **Autore:** Francesco Sioli (CTO) + Claude
- **Stato:** approvato, pronto per il piano implementativo
- **Ambito:** fatturazione / wallet / payout

## 1. Contesto e problema

Un broker può iscriversi con un **codice promozionale** che accredita un bonus sul
wallet (es. €200). Quando raggiunge la soglia di payout (es. €500) e preleva, il
bonifico è composto da due nature contabili **diverse**:

- **Compenso reale** delle pratiche/affiliazione → reddito del broker → documento
  conto terzi (emesso da PV per suo conto).
- **Bonus promozionale** → **non è una prestazione del broker verso PV**, è una
  promozione di PV verso il broker → costo di marketing di PV, deducibile ex
  **art. 108 TUIR**. Non può stare nella fattura del broker (non c'è controparte:
  l'agenzia non ha comprato €200 in più, e PV non può ricevere fattura per un
  bonus che regala essa stessa).

La regola vale **solo al payout che incassa il bonus** — in pratica il primo,
perché il bonus è accreditato una volta sola in registrazione.

## 2. Cosa esiste già in prod ("Documento 1", i €300)

Il wallet è **già tipizzato per natura del credito** e il payout separa già le due
cose nel modo corretto:

- `TransazioneWalletTipo` (schema.prisma ~224): `CREDITO_PRATICA`,
  `CREDITO_AFFILIAZIONE`, `CREDITO_PROMO`, `PENALE_BROKER`, ecc.
- `apps/piattaforma/src/lib/wallet/payout-exec.ts:20`
  `TIPI_CREDITO_COMPENSO = ['CREDITO_PRATICA','CREDITO_AFFILIAZIONE']`. Al payout si
  eroga **l'intero saldo** (unico bonifico) ma si agganciano al payout **solo** i
  crediti-compenso (`payout-exec.ts:92-95`). Promo e penali restano con
  `payoutId` null, concorrono solo alla cassa erogata.
- `apps/piattaforma/src/lib/fatturazione/engine.ts:81-84`: `createDocBroker`
  somma **solo** `CREDITO_PRATICA + CREDITO_AFFILIAZIONE` (`lordo`), con guard
  `if (lordo <= 0) return`; lo split regime IVA/ritenuta (`engine.ts:86-87`) si
  applica **solo** al lordo compenso. Il promo è **già fuori** dalla fattura e
  non passa mai dal pipeline regime.

**Conclusione:** il "Documento 1" è già costruito e nel modo pulito (per tipo di
transazione, non con un ramo "primo payout").

## 3. Il gap: "Documento 2" (i €200)

Oggi il promo viene *escluso* dalla fattura ma **non generiamo nessun documento
interno** per quei €200. Serve un **giustificativo interno di costo** ex art. 108
TUIR: NON una nota di addebito, NON un'autofattura, **non va allo SdI**. Materia
prima già presente: `PromoCodeRedemption` (log iscrizione + accredito) è collegato
alla transazione via `transazioneWalletId` (`lib/promo/redeem.ts:47-55`;
asserito in `redeem.test.ts:47`), quindi dalla riga `CREDITO_PROMO` si risale a
codice, data iscrizione e importo.

## 4. Decisioni prese

1. **Storage:** tabella **separata** `GiustificativoInterno` (non estendere
   `DocumentoFiscale`). Motivo: il giustificativo è one-sided (nessuna controparte
   reale), senza numerazione fiscale, fuori SdI, e **non deve mai comparire su
   `/fatturazione` del broker**. Estendere `DocumentoFiscale` avrebbe richiesto di
   tenerlo fuori a mano da numerazione fiscale, filtri emissione e `access.ts` in
   più punti fragili.
2. **Scope prima release:** record generato al payout + **pagina admin dedicata**
   con lista + **export CSV** + **numerazione interna progressiva**. PDF per-voce
   rimandato.
3. **`righe` come JSON** (snapshot dei redemption inclusi) invece di FK multipli.
4. **Pagina `/admin/costi-promozionali` a sé**, non un tab dentro
   `/admin/fatturazione` (mondi fiscale vs costo interno tenuti separati).
5. Il giustificativo copre il **promo lordo** incassato anche in presenza di penali.

## 5. Design

### 5.1 Principio (innesco)

Il giustificativo si genera **in `settlePayout`, quando il payout incassa credito
`CREDITO_PROMO`** — non con un ramo "primo payout". Il bonus è accreditato una
volta sola, quindi tocca naturalmente solo il payout che lo consuma: il
"una volta sola" cade da sé. Payout senza promo → nessun giustificativo.

### 5.2 Modello dati

```prisma
enum GiustificativoInternoTipo { COSTO_PROMO }   // estendibile a futuri costi interni

model GiustificativoInterno {
  id   String                    @id @default(uuid()) @db.Uuid
  tipo GiustificativoInternoTipo @default(COSTO_PROMO)

  // Numerazione INTERNA progressiva — NON fiscale, NON SdI, registro a parte
  numeroProgressivo Int
  anno              Int
  numeroStr         String @unique   // es. "GI-2026-00001"

  importoCent Int      // sempre positivo (costo promozionale erogato)
  causale     String   // "Bonus promozionale iscrizione — <ragioneSociale> — <data>"

  payoutId String @unique @db.Uuid   // 1 giustificativo per payout (idempotenza)
  payout   Payout @relation(fields: [payoutId], references: [id])

  beneficiarioCompanyId String?  @db.Uuid       // per query/filtri admin
  beneficiarioCompany   Company? @relation(fields: [beneficiarioCompanyId], references: [id])
  datiBeneficiario      Json     // snapshot immutabile: ragione sociale, p.iva…

  righe Json   // il "log": [{ code, dataIscrizione, amountCent, redemptionId }]

  emessoAt  DateTime @default(now())
  createdAt DateTime @default(now())

  @@unique([anno, numeroProgressivo])
  @@map("giustificativi_interni")
}
```

`righe` porta dentro sé il log promo (n redemption, di norma 1) — stessa filosofia
snapshot di `DocumentoFiscale.datiEmittente`. Non tocca `DocumentoFiscale` né la
sua numerazione.

### 5.3 Innesto in `settlePayout` + engine

- Nella tx di settlement (`payout-exec.ts:89-118`), oltre ai compensi si
  **agganciano al payout anche le righe `CREDITO_PROMO`** (`payoutId`) per
  tracciabilità.
- `createDocBroker` **resta identico**: filtra esplicitamente per
  `CREDITO_PRATICA/AFFILIAZIONE` (`engine.ts:82`), quindi la promo resta fuori
  dalla fattura anche dopo l'aggancio. **È il punto che i test devono blindare.**
- Nuovo `createGiustificativoPromo({ payoutId })`, chiamato dopo la tx come
  `createDocBroker` (`payout-exec.ts:121`), **best-effort e idempotente**: somma le
  `CREDITO_PROMO` del payout; se `> 0` crea il giustificativo con numero interno
  atomico e risale ai `PromoCodeRedemption` via `transazioneWalletId` per popolare
  `righe` e `datiBeneficiario`.

### 5.4 Numerazione interna

**Riuso** dell'infrastruttura atomica esistente `prossimoContatore(tx, idSoggetto,
tipo, anno)` (`lib/fatturazione/numerazione.ts`), che è già generica e chiavata su
`(idSoggetto, tipoDocumento, anno)` (`ContatoreFiscale`,
`@@unique([idSoggetto, tipoDocumento, anno])`). Il registro "GI" si ottiene con:
- un **nuovo valore `ContatoreFiscaleTipo`** (es. `GIUSTIFICATIVO_INTERNO`);
- un **`idSoggetto` fisso PV** (il giustificativo è di PV verso sé stessa).

Così il registro è **logicamente separato** dal fiscale (chiave distinta) senza
duplicare tabella né logica di incremento. Reset annuale ereditato dal pattern.
Formato stringa `GI-<anno>-<progressivo 5 cifre>`, congelato in `numeroStr`.
La numerazione va consumata **dentro** la stessa tx che crea il
`GiustificativoInterno` (come per i documenti fiscali), così un fallimento fa
rollback e il numero non resta buco.

### 5.5 Superficie admin

Pagina `/admin/costi-promozionali`: lista (data, beneficiario, importo, numero GI,
codice promo) + filtro intervallo date + **export CSV** importabile dal
commercialista. Nessuna esposizione lato broker/agenzia.

## 6. Edge case & non-goal

- **compenso = 0, promo > 0** (soglia raggiunta quasi solo col bonus, o
  liquidazione di cessazione): `createDocBroker` non emette nulla (guard
  `lordo<=0` già presente) e si emette **solo** il giustificativo.
- **Penali:** `payout = compenso + promo − penali`. Il giustificativo documenta il
  **promo lordo** incassato (le penali sono voce a sé, non erodono il costo
  promozionale). Nota di riconciliazione, non un bug: `fattura + giustificativo`
  non uguaglia il bonifico quando ci sono penali.
- **Idempotenza:** `payoutId` unique ⇒ retry di `createGiustificativoPromo` non
  duplica.
- **Fuori scope ora:** PDF per-voce (dato + CSV bastano); trasmissione SdI (N/A per
  definizione, il documento è fuori campo).

## 7. Test

- Engine `createGiustificativoPromo`: somma promo del payout, guard zero
  (nessun promo → nessun record), idempotenza per payout, `righe`/`datiBeneficiario`
  popolati dai redemption.
- **Regressione chiave:** `createDocBroker` resta invariato dopo l'aggancio delle
  promo al payout — la fattura non deve mai inglobare il bonus.
- Numerazione interna atomica sotto concorrenza (nessun buco/duplicato del
  progressivo).
- Filtri + export CSV della pagina admin.
- Edge: payout con `compenso = 0` e `promo > 0` → nessun `DOC_BROKER`, un solo
  giustificativo.

## 8. Open item NON-codice (Francesco → commercialista)

- Classificazione del bonus ex art. 108: portare "**costo promozionale /
  incentivo commerciale**", non "liberalità" (deducibilità diversa).
- Confermare che l'**affiliazione fatturata come compenso conto terzi** (già così
  nel codice, `CREDITO_AFFILIAZIONE` dentro `TIPI_CREDITO_COMPENSO`) sia il
  trattamento voluto.

## 9. File previsti (indicativo, da dettagliare nel piano)

- `packages/db/prisma/schema.prisma` — modello `GiustificativoInterno` + enum
  `GiustificativoInternoTipo` + nuovo valore `ContatoreFiscaleTipo.GIUSTIFICATIVO_INTERNO`
  + relazioni (`Payout`, `Company`); migration a mano.
- `apps/piattaforma/src/lib/fatturazione/giustificativo-promo.ts` (nuovo engine).
- `apps/piattaforma/src/lib/fatturazione/numerazione.ts` — nessuna modifica
  strutturale: si riusa `prossimoContatore` col nuovo tipo + `idSoggetto` PV.
- `apps/piattaforma/src/lib/wallet/payout-exec.ts` — aggancio `CREDITO_PROMO` +
  chiamata all'engine.
- `apps/piattaforma/src/app/admin/costi-promozionali/**` — pagina + CSV.
- Test affiancati ai moduli sopra.
