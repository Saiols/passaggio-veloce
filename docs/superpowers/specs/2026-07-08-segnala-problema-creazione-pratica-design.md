# "Segnala un problema" nella creazione pratica — Design

> Stato: approvato (brainstorming 2026-07-08). Prossimo passo: piano di implementazione.

## Obiettivo

Dare al broker un modo **non invasivo** di segnalarci un problema mentre compila una
pratica — un dato letto male dall'OCR, un caso che non sa come compilare, un errore
qualsiasi — **senza interrompere il suo lavoro**. Noi riceviamo una fotografia di
quel momento (dati inseriti + file caricati) per capire se è un bug nostro o un
errore suo, e gli rispondiamo.

Sostituisce il flusso "revisione manuale" (Schema Documentale v7, bundle SD-C):
montato in codice ma **senza alcun trigger** (`setShowRevisione(true)` non esiste in
tutto il repo → il popup non si apre mai; mai usato in produzione).

## Decisioni prese (brainstorming)

1. **Fire-and-forget**: l'utente segnala e **resta nel wizard**, continua a lavorare.
   Non è un flusso bloccante. La sua bozza in corso non viene toccata.
2. **Modello dati dedicato** (non riuso di `Pratica`): l'artefatto NON è una pratica,
   quindi per costruzione non può comparire nella lista `/pratiche` del broker
   (nessun rischio doppione, nessun flag di esclusione da mantenere ovunque).
3. **Solo nel wizard di creazione pratica** (`/pratiche/nuova`), non piattaforma-wide.
4. **Dati + file**: la segnalazione include sia lo snapshot dei dati sia copie dei
   file caricati finora (servono a diagnosticare un OCR letto male).
5. **Chiusura con risposta**: stato `APERTA → GESTITA`; gestendo si scrive una nota
   e parte un'email all'utente.

## Non-obiettivi (YAGNI)

- Nessuna CTA globale "segnala bug" fuori dal wizard (eventuale secondo tipo in futuro).
- Nessuna chat/thread di risposta: una nota di gestione + una email, punto.
- Nessuna auto-cancellazione dei file nell'MVP (vedi Retention).

---

## 1. Modello dati

### Nuovo modello `SegnalazioneCreazione`

Nome scelto per non collidere con "segnalazione" del Sistema Penali
(`segnalaPraticaAction`, `Pratica.flagSegnalata`) né con "revisione" del vecchio flusso.

```prisma
enum SegnalazioneCreazioneStato {
  APERTA
  GESTITA
}

model SegnalazioneCreazione {
  id String @id @default(uuid()) @db.Uuid

  // Chi l'ha aperta. companyId + userId sempre presenti; sedeId dalla sede
  // operativa in sessione (può mancare per l'owner in vista aggregata).
  companyId String  @db.Uuid
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  userId    String  @db.Uuid
  user      User    @relation(fields: [userId], references: [id])
  sedeId    String? @db.Uuid
  sede      Sede?   @relation(fields: [sedeId], references: [id])

  // A che step del wizard era (1..4).
  step Int

  // Testo del broker (min 20, max 1000 char, validato server-side).
  descrizione String

  // Fotografia leggibile dei dati inseriti al momento della segnalazione:
  // { tipoPratica, multiplo, veicoli: [{ targa, telaio, ocr }], venditori: [...],
  //   acquirente, coAcquirenti, comune }. Forma esatta = sottoinsieme serializzabile
  //   dello stato wizard (dettaglio nel piano). NON contiene i file, solo i metadati.
  datiSnapshot Json

  // Ciclo di vita + risposta.
  stato        SegnalazioneCreazioneStato @default(APERTA)
  notaGestione String?                    // la nostra risposta, inviata via email
  gestitaAt    DateTime?
  gestitaDaId  String?                    @db.Uuid
  gestitaDa    User?                      @relation("SegnalazioneGestore", fields: [gestitaDaId], references: [id])

  documenti Documento[] @relation("DocumentiSegnalazione")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([stato, createdAt])
  @@index([companyId])
  @@map("segnalazioni_creazione")
}
```

### Estensione di `Documento`

I file caricati nel wizard sono già su Blob (area `pratiche-staging`); creare le righe
`Documento` è **solo metadata**, nessun byte trasferito (`storageKey = blobRef.key`, come
al submit normale). Agganciarli alla segnalazione li rende "posseduti" (robusti anche se
un domani si ripuliscono i blob orfani) e scaricabili con le route admin esistenti.

```prisma
model Documento {
  // ...campi esistenti invariati...
  segnalazioneId String?                @db.Uuid
  segnalazione   SegnalazioneCreazione? @relation("DocumentiSegnalazione", fields: [segnalazioneId], references: [id], onDelete: Cascade)
}
```

Un `Documento` di segnalazione ha `segnalazioneId` valorizzato e `praticaId`/`companyId`
null. Mantiene il suo `DocumentoTipo` originale (LIBRETTO_CIRCOLAZIONE, CI_FRONTE, …):
nessun nuovo valore d'enum.

**Migration:** enum `SegnalazioneCreazioneStato` + tabella `segnalazioni_creazione` +
colonna `Documento.segnalazioneId`. Additiva, nessun impatto sui dati esistenti.

---

## 2. Lato utente (wizard)

### CTA

Testo discreto (link, non bottone appariscente), in fondo al contenuto di **ogni step**
del wizard:

> *Hai riscontrato un errore nella lettura automatica dei dati o nella compilazione?*
> *[Segnalacelo]*

Al click apre il popup. La CTA è sempre presente dallo step 1 (non c'è dipendenza dallo
step: un OCR letto male si vede già allo step 1).

### Popup (riuso e ricablaggio di `RevisioneManualePopup`)

- Select "tipo problema" (le tre voci attuali restano valide: dato letto male /
  compilazione / altro) + textarea descrizione (min 20, max 1000).
- Bottone "Invia segnalazione".
- Al successo: messaggio *"Grazie, abbiamo ricevuto la segnalazione. Ti risponderemo via*
  *email. Puoi continuare la compilazione."* → chiusura. **L'utente resta nel wizard.**

### Server action `inviaSegnalazioneCreazioneAction`

Firma (dettaglio dei tipi nel piano):

```
inviaSegnalazioneCreazioneAction(input: {
  step: number,
  tipo: TipoProblema,
  descrizione: string,
  veicoli: VeicoloPayload[],      // stesso shape del submit pratica
  venditori: VenditorePayload[],
  acquirente: AcquirentePayload,
  coAcquirenti: CoAcquirentePayload[],
  blobRefs: Record<string, BlobRef>,   // gli stessi che il submit invia
  comune?: string,
}): Promise<{ ok: true } | { ok: false; error: string }>
```

Comportamento:
1. Auth: broker (`companyType === 'DEALER'`) loggato. Scope sede dalla sessione
   (`getSessionContext` → `resolveSubmittedSede`/sede operativa), come per la bozza
   placeholder del vecchio flusso.
2. Valida `descrizione` (trim, 20..1000). `step` in 1..4.
3. Costruisce `datiSnapshot` dal payload (metadati leggibili + esito OCR per veicolo).
4. In transazione: crea `SegnalazioneCreazione` (APERTA) + una riga `Documento` per ogni
   `blobRef` presente, con `segnalazioneId`, il `DocumentoTipo` corrispondente allo slot,
   `storageKey = ref.key`, `mimeType`/`sizeBytes` da `ref`.
5. **Non tocca** la bozza (è client-side in localStorage) né crea alcuna `Pratica`.
6. Best-effort dopo il commit: notifica **N20** agli admin.

Il client riusa il payload che già costruisce per il submit (veicoli/venditori/
coAcquirenti/blobRefs sono già serializzati lì): la segnalazione ne manda una copia con
in più `step`, `tipo`, `descrizione`.

---

## 3. Lato admin

### Pagina `/admin/segnalazioni`

Layout gemello dell'attuale `/admin/revisioni` (che verrà rimossa, §4).

- **Lista**: filtro stato (APERTA / GESTITA / tutte), ordinata per `createdAt` desc.
  Ogni riga: azienda + utente, step, targhe (dallo snapshot), estratto descrizione, stato,
  data.
- **Dettaglio**: descrizione completa, `datiSnapshot` reso leggibile (tipo pratica, per
  ogni veicolo targa/telaio + **esito OCR**, parti), e i **file scaricabili** (route admin
  documenti esistente, che già autorizza `ADMIN_PIATTAFORMA`).
- **Azione "Gestisci"**: textarea nota di risposta → `stato = GESTITA`, `gestitaAt`,
  `gestitaDaId`, e invio email all'utente. Fail-closed: solo `ADMIN_PIATTAFORMA`.

### Server action `gestisciSegnalazioneCreazioneAction`

```
gestisciSegnalazioneCreazioneAction(id: string, nota: string):
  Promise<{ ok: true } | { ok: false; error: string }>
```

- Authz `ADMIN_PIATTAFORMA` (fail-closed).
- Valida `nota` (non vuota, max ~2000).
- Aggiorna la segnalazione a GESTITA con nota/timestamp/gestore.
- Invia email all'utente (nuovo template, modellato su
  `N21_BROKER_REVISIONE_COMPLETATA`): *"Riguardo alla tua segnalazione durante la*
  *creazione di una pratica: {nota}"*. Recapito dal DB (email di registrazione), coerente
  con la regola destinatari esistente.

### Notifiche

Il vecchio flusso revisione è ritirato (§4), quindi i suoi due template restano liberi e
vengono **ri-scopati** a questo flusso (stessa infrastruttura, testo adattato):

- **All'apertura → admin platform**: `N20` (era "revisione richiesta"), ri-testata a
  "nuova segnalazione da creazione pratica", con link a `/admin/segnalazioni`. Payload
  adattato (azienda, step, estratto descrizione).
- **Alla gestione → broker**: `N21` (era "revisione completata"), ri-testata a "risposta
  alla tua segnalazione", con la nota di gestione nel corpo.

L'alternativa (coniare id nuovi e ritirare N20/N21) è equivalente; la scelta id-vs-riuso è
dettaglio di piano. Ciò che il design fissa: due notifiche, admin all'apertura e broker
alla gestione, sull'infrastruttura esistente.

---

## 4. Ritiro del vecchio flusso "revisione manuale"

Codice montato ma senza trigger (mai attivo in prod). Viene **rimosso** e sostituito da
questo (un solo sistema, meno codice morto):

- `richiediRevisioneManualeAction`, `risolviRevisioneAction` (`lib/documenti/revisione.ts`)
- `RevisioneManualePopup` (uso corrente) → il file viene **ricablato** come nuovo popup
  segnalazione (non un secondo componente).
- pagina `/admin/revisioni`
- notifiche `N20`/`N21`: **ri-scopate** al nuovo flusso (vedi §3 Notifiche), non rimosse.
- Campi `Pratica.richiedeRevisioneManuale/motivoRevisione/noteRevisione/revisioneCompletata`
  e l'helper `statoExtra`: **da verificare in fase di piano** se sono letti solo dal
  vecchio flusso; se sì, rimossi con la relativa migration; se hanno altri usi, lasciati.

**Sequencing.** Il branch `fix/scoping-write-side` (scoping per sede delle scritture
pratica — chiude falle di sicurezza reali) tocca `richiediRevisioneManualeAction` e va
**rilasciato prima**. Questa feature lo rimpiazza dopo. Il resto di quel branch (scoping
delle altre action) resta valido a prescindere.

## 5. Retention (decisione esplicita)

Lo snapshot include **copie di documenti d'identità reali** di venditori/acquirenti,
scollegati da una pratica. Decisione:

- **MVP**: i file restano come `Documento` finché la segnalazione esiste. Nessuna
  auto-cancellazione.
- **Follow-up documentato (non MVP)**: TTL post-gestione — un job che, N giorni dopo che
  una segnalazione è GESTITA, cancella i suoi `Documento` (+ blob) mantenendo lo snapshot
  testuale come storico. Da dimensionare con criterio privacy prima di attivarlo.

Motivazione: l'MVP resta semplice (YAGNI), ma il tema è flaggato e non lasciato implicito.

---

## 6. Testing

- **Unit** `inviaSegnalazioneCreazioneAction`: snapshot costruito dai dati; una riga
  `Documento` per blobRef con `segnalazioneId` e tipo corretti; **nessuna `Pratica`
  creata**; authz broker; validazione descrizione (troppo corta → errore).
- **Unit** `gestisciSegnalazioneCreazioneAction`: stato → GESTITA con nota/timestamp/
  gestore; email inviata; authz admin-only (non-admin → errore, nessuna mutazione).
- **Verifica manuale** (UI, come per lo scoping): CTA visibile in ogni step; invio
  mantiene la bozza e lascia l'utente nel wizard; la segnalazione **non** appare in
  `/pratiche`; dettaglio admin mostra dati + file scaricabili; "Gestisci" invia l'email.

## Componenti e confini

| Unità | Responsabilità | Dipende da |
|---|---|---|
| `SegnalazioneCreazione` (Prisma) | Stato dell'artefatto | — |
| `inviaSegnalazioneCreazioneAction` | Crea segnalazione + Documenti dai blobRef | getSessionContext, prisma, N20 |
| `gestisciSegnalazioneCreazioneAction` | Gestione + risposta email | permissions, prisma, email |
| Popup segnalazione (ex `RevisioneManualePopup`) | Raccoglie tipo + descrizione | inviaSegnalazione…Action |
| CTA wizard | Apre il popup in ogni step | popup |
| `/admin/segnalazioni` (lista + dettaglio) | Triage e gestione | gestisci…Action, route download documenti |
