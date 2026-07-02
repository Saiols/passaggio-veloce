# Co-intestatari acquirente + tipo soggetto in cima — Design

**Data:** 2026-07-03
**Area:** Creazione pratica (`apps/piattaforma/src/app/pratiche/nuova`)
**Stato:** approvato in brainstorming, in attesa review spec

## Contesto e stato attuale

Nel wizard di creazione pratica lo **step 3 (Acquirente)** gestisce un **unico**
acquirente, modellato come record *embedded* sulla `Pratica`:

- Campi client: `acquirente: Parte`, `acquirenteDocId`, `acquirenteIdentita`,
  `acquirenteResidenzaDiversa`, `acquirenteIndirizzoResidenza`.
- Campi DB (`model Pratica`): `acquirenteNome/Cognome/CF/IsPersonaGiuridica/
  RagioneSociale/PIVA/Telefono/Email/IndirizzoResidenza/TipoSoggetto/VisuraData/
  PermessoData`.
- Documenti identità: `Documento.owner = ACQUIRENTE`, slot blob prefissati `ACQ_*`
  (`ACQ_ID_FRONTE`, `ACQ_ID_RETRO`, `ACQ_ID`, `ACQ_PERMESSO`, `ACQ_VISURA`,
  `ACQ_CF`, `ACQ_CF_RETRO`).

Lo **step 2 (Venditore)** gestisce invece **N venditori** (co-intestatari del
libretto), modellati come tabella dedicata `Venditore` (`model Venditore`, FK
`praticaId` + `veicoloId` opzionale), con documenti linkati via
`Documento.venditoreId` e slot `VEND<n>_*`. La UI usa una CTA
"aggiungi venditore" che ripropone `ParteForm` + `IdentitaSection`.

**Layout attuale step 3:** card "Acquirente" con `ParteForm` (anagrafica +
contatti) → `IdentitaSection` (che **contiene** il selettore "Tipo soggetto" in
cima, seguito da tipo documento + upload) → card "Residenza". Poiché il tipo
soggetto pilota `isPG` (privato → nome/cognome/CF; azienda → ragione sociale/
P.IVA), sceglierlo *dopo* i campi fa cambiare l'anagrafica "sopra": UX poco
lineare.

## Obiettivi

1. **Tipo soggetto in cima** — **solo** nello step acquirente, il selettore
   "Tipo soggetto" va spostato **sopra** i dati dell'acquirente. Il venditore
   resta invariato (tipo soggetto dove è ora, prima degli upload).
2. **Co-intestatari acquirente** — anche l'acquirente può avere co-intestatari.
   CTA "aggiungi co-intestatario" (come per il venditore) che ripropone lo
   stesso blocco di inserimento, con le stesse logiche di verifica documentale
   (OCR del documento che combacia coi dati inseriti). **Solo pratiche SEMPLICE.**

## Non obiettivi (out of scope)

- Co-intestatari per la **MINIVOLTURA** (resta acquirente unico commerciante).
- Migrazione dei dati acquirente esistenti: l'acquirente **principale** resta sui
  campi `Pratica` (retrocompatibilità totale, zero backfill).
- Cross-check insiemistico acquirente ↔ libretto (è logica venditore).
- Generazione documenti finali/atto: fuori da questo lavoro se non per la
  visualizzazione dei co-intestatari (vedi §Downstream).

---

## Punto 1 — Tipo soggetto in cima allo step acquirente

### Modifica a `IdentitaSection`
Aggiungere il prop opzionale `hideTipoSoggetto?: boolean` (default `false`).
Quando `true`, `IdentitaSection` **non** renderizza il `Field "Tipo soggetto"` né
il divider immediatamente successivo; parte direttamente da "Tipo documento".
Il **venditore** non passa il prop → comportamento identico a oggi.

### Layout nuovo step acquirente
Dentro la card "Acquirente", **prima** di `ParteForm`, renderizzare il selettore
"Tipo soggetto" (stessa `Select` con `acquirenteTipiSoggetto`) + un divider,
riusando lo **stesso** handler `onTipoSoggetto` già presente al call-site (righe
~1826-1835 di `wizard.tsx`): imposta `tipoSoggetto`, deriva `isPG`, azzera
`visuraOcr`/`permessoOcr` quando non pertinenti.
`IdentitaSection` sotto riceve `hideTipoSoggetto`.

Nessun cambiamento a `ParteForm`, allo stato o al submit per questo punto: solo
riposizionamento del controllo.

---

## Punto 2 — Co-intestatari acquirente (solo SEMPLICE)

### 2.1 Stato client
Nuovo tipo `CoAcquirenteInput` = `Parte` + campi identità/residenza, analogo a
`VenditoreInput` ma **senza** `veicoloOrdine` (i co-intestatari sono a livello
pratica, non per veicolo):

```
type CoAcquirenteInput = Parte & {
  docId: DocIdTipo;
  identita: IdentitaFiles;
  residenzaDiversa: boolean;
  indirizzoResidenza: string;
};
```

Nuovo stato `const [coAcquirenti, setCoAcquirenti] = useState<CoAcquirenteInput[]>([])`
(default vuoto: la maggior parte delle pratiche ha un solo acquirente), con helper
`addCoAcquirente()` (append di un `emptyParte()` esteso), `removeCoAcquirente(idx)`,
`updateCoAcquirente(idx, patch)`, modellati sugli equivalenti venditore.

I co-intestatari entrano nella **bozza** (`wizard-draft.ts`): salvataggio con
`identitaForStorage` per gli slot file (come `acquirenteIdentita`/venditori) e
ripristino in hydration.

### 2.2 UI
Sotto il blocco acquirente principale e sotto la card residenza del principale:

- La lista dei co-intestatari, ciascuno reso da un nuovo `renderCoAcquirente(idx)`
  che ripropone **lo stesso blocco del principale**:
  card `[Tipo soggetto in cima + ParteForm]` → `IdentitaSection` con
  `hideTipoSoggetto` → card Residenza ("residenza uguale al documento?" +
  eventuale `AddressAutocomplete`). Header con titolo "Co-intestatario N" e
  bottone "Rimuovi".
- CTA **"+ Aggiungi co-intestatario"** in fondo, che chiama `addCoAcquirente()`.
- Tutto il blocco co-intestatari (lista + CTA) è visibile **solo se
  `tipo === 'SEMPLICE'`**. Se l'utente cambia tipo pratica in MINIVOLTURA con
  co-intestatari già inseriti, questi vanno azzerati (come si azzerano i rami non
  pertinenti altrove), per non trascinarli nel submit.

`IdentitaSection` per i co-intestatari usa `acquirenteTipiSoggetto` (stessi tipi
del principale) e gli stessi handler OCR (`runIdentitaOcr`, `runVisuraOcr`,
`runPermessoOcr`, `runCfOcr`) instradati su `setCoAcquirenti(prev => prev.map(...))`.

### 2.3 Validazione / gate
Le "logiche di controllo" richieste = la **verifica documentale per-parte** già
esistente (`verificaDocumentaleParte`/`validaParte`): l'OCR del documento
d'identità deve combaciare con nome/cognome/CF inseriti; per le PG visura fresca;
per gli stranieri permesso valido. **Nessun** cross-check col libretto.

Estendere `canStep3` così: oltre al principale, **ogni** co-intestatario deve
essere `parteValida` + `identitaPresente` + `!identitaUploading` + verdetto
documentale OK + residenza valida (se "residenza diversa" → indirizzo non vuoto).
Aggiornare anche `mancanzeStep3()` per elencare le mancanze per co-intestatario
(taggate "co-intestatario N").

### 2.4 Submit (client → FormData)
Modellato sui venditori:

- Nuovo campo FormData `coAcquirenti`: JSON array con, per ciascuno, `ordine`,
  anagrafica (`isPG`, `nome`, `cognome`, `cf`, `ragioneSociale`, `piva`,
  `telefono`, `email`), `tipoSoggetto`, `docId`, `residenza` (`indirizzoResidenza`
  o null se uguale al documento). Nessun file nel JSON.
- Slot blob `COACQ<n>_*` per i documenti d'identità di ciascuno, con lo **stesso
  schema di suffissi** di `ACQ_*`/`VEND<n>_*`: `_ID_FRONTE`, `_ID_RETRO`, `_ID`,
  `_PERMESSO`, `_VISURA`, `_CF`, `_CF_RETRO`.

### 2.5 Server (`actions.ts`)
- **Zod**: nuovo `coAcquirenteSchema` (analogo a `venditoreSchema`) e campo
  `coAcquirenti` che fa `JSON.parse` + validazione (default `[]`). Se
  `tipo !== 'SEMPLICE'` i co-intestatari vengono **ignorati** (non persistiti):
  il client già li nasconde/azzera fuori da SEMPLICE, quindi il server è
  difensivo e non introduce un percorso d'errore aggiuntivo.
- **Raccolta identità**: generalizzare `collectIdentita`. Oggi ha
  `owner: 'VENDITORE' | 'ACQUIRENTE'` + `venditoreOrdine?`. Aggiungere un
  `coAcquirenteOrdine?` (parallelo a `venditoreOrdine`) che tagga gli
  `identitaCandidates` per il linkage successivo. Chiamata:
  `collectIdentita('ACQUIRENTE', 'COACQ' + n, docId, label, richiedeCf, undefined, n)`.
- **Verifica per-parte**: aggiungere i co-intestatari a `partiDaVerificare` con
  `prefix: 'COACQ'+n`, `label: 'Co-intestatario '+n`, `richiedeOperatoreAuto:false`.
  Riusa il loop `validaParte(ocrParteServer(prefix, docId), …)` già presente:
  fail-closed identico al principale.
- **Persistenza (transazione)**: creare le righe `CoAcquirente` (FK `praticaId`,
  `ordine`, anagrafica, `tipoSoggetto`, `indirizzoResidenza`, `documentoIdentita`)
  e linkare i `Documento` identità con `owner = ACQUIRENTE` + nuova FK
  `coAcquirenteId`, mappando i candidati taggati con `coAcquirenteOrdine` alla
  riga creata (stesso pattern del linkage venditori tramite `venditoreOrdine`).

### 2.6 Schema DB + migration
Nuovo modello, mirror di `Venditore` senza `veicoloId`:

```prisma
model CoAcquirente {
  id                 String        @id @default(uuid()) @db.Uuid
  praticaId          String        @db.Uuid
  pratica            Pratica       @relation(fields: [praticaId], references: [id], onDelete: Cascade)
  ordine             Int
  nome               String?
  cognome            String?
  cf                 String?
  isPersonaGiuridica Boolean       @default(false)
  ragioneSociale     String?
  piva               String?
  telefono           String?
  email              String?
  tipoSoggetto       TipoSoggetto?
  visuraData         DateTime?     @db.Date
  permessoData       DateTime?     @db.Date
  documentoIdentita  String?
  indirizzoResidenza String?       // null = stesso del documento
  documenti          Documento[]   @relation("DocumentiCoAcquirente")
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@index([praticaId])
  @@map("co_acquirenti")
}
```

Aggiunte:
- `model Pratica`: relazione inversa `coAcquirenti CoAcquirente[]`.
- `model Documento`: FK nullable `coAcquirenteId String? @db.Uuid` + relazione
  `coAcquirente CoAcquirente? @relation("DocumentiCoAcquirente", fields:[coAcquirenteId], references:[id], onDelete: SetNull)` + `@@index([coAcquirenteId])`.
- Enum `DocumentoOwner`: **invariato** (si riusa `ACQUIRENTE`).

Migration SQL: `CREATE TABLE co_acquirenti (...)`, `ALTER TABLE documenti ADD
COLUMN "coAcquirenteId" uuid NULL` + FK + indici. Applicata a mano su prod
(Neon `ep-solitary-night`) via `prisma migrate deploy`, come da processo.

### 2.7 Downstream
- **Dettaglio pratica** (`apps/piattaforma/src/app/pratiche/[id]`): mostrare i
  co-intestatari acquirente accanto all'acquirente principale (lettura dalla nuova
  relazione). Item finale del piano.
- **ZIP/notifiche/altri consumer** che elencano "l'acquirente": il piano
  includerà uno step di ricognizione (grep sui consumer di `acquirenteNome`/
  `owner: ACQUIRENTE`) per estendere quelli che devono elencare tutti gli
  intestatari; i co-intestatari sono comunque persistiti e queryabili dalla
  relazione, quindi l'estensione è puramente di presentazione.

---

## Testing

- **Unit (vitest)**: helper puri che introduciamo per il gate co-intestatari
  (es. una funzione tipo `coAcquirentiValidi(...)` estratta e testata, come già
  fatto per `docVeicoloMancante`/`crossCheckPerVeicolo`); parsing/validazione
  `coAcquirenteSchema`.
- **Server**: test del ramo di verifica per-parte esteso (un co-intestatario con
  documento non combaciante → blocco) se la struttura attuale lo consente; almeno
  copertura della validazione zod e del rifiuto in MINIVOLTURA.
- **E2E (Playwright), end-of-phase**: pratica SEMPLICE con 1 co-intestatario,
  upload documenti, verifica gate e persistenza (riga `co_acquirenti` + documenti
  linkati). Coerente con la preferenza "test e2e a fine fase".

## Rischi / note

- **Refactor `collectIdentita`**: tocca un percorso condiviso venditore/acquirente
  → attenzione a non regredire i venditori. Coprire con typecheck + e2e esistente.
- **Prefissi slot**: `COACQ<n>` non deve collidere con `ACQ`/`VEND<n>`: ok, sono
  distinti.
- **Bozza**: includere `coAcquirenti` nel salvataggio/idratazione per non perdere
  i dati al refresh; allineare eventuali "firme" di hydration se presenti.
- **Migration prod**: additiva e nullable → sicura (nessun blocco su righe
  esistenti). Ruotare/curare le credenziali Neon come da processo.
