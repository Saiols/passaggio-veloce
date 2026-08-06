# CRM — il tab "Tracking & Pixel" diventa automatico

**Data:** 2026-08-06
**Autore:** Francesco (CTO) + Claude
**Stato:** design approvato (in attesa review spec)

## Contesto

Il tab **Tracking & Pixel** della scheda contatto (`apps/piattaforma/src/app/admin/crm/contatti/client.tsx`,
`TabTracking`) espone 12 campi tutti **editabili a mano**. Doveva essere il referto del
funnel — cosa ha fatto il contatto — e invece è un form come gli altri. Da qui tre problemi
distinti, che questa spec chiude insieme.

### Cosa si alimenta davvero da solo (oggi)

| Campo | Scrittore automatico |
|---|---|
| `linkInviato`, `linkInviatoAt` | `sendEmailPartenzaAction` (`contatti/actions.ts:805`) |
| `linkAperto`, `linkAperture`, `linkApertoAt` | `app/i/[token]/route.ts:51` (redirect del link tracciato) |
| `iscrizioneComp`, `iscrizioneAt` | riconciliazione CRM ↔ registrati (`lib/crm/match/apply.ts:69`) |

### Cosa non si alimenta mai

`videoInviato`, `videoMin`, `mailAperta`, `smsInviato`, `waInviato`, `iscrizioneInit`:
**nessuno scrittore in tutto il repo**, esistono solo nel form e nello schema. Non è una
dimenticanza — è la decisione 8 della spec CRM (`docs/crm-spec-implementativa.md:642`):
*"Pixel tracking: solo modello dati in CRM-B, endpoint in CRM-H insieme a Vapi/Twilio"*.
Il bundle CRM-H non è mai stato fatto.

Conseguenza non ovvia: `iscrizioneInit` alimenta lo stato fattuale **S6 "Iscrizione
incompleta"** (`lib/crm/fatti.ts:75`), quindi oggi S6 è **irraggiungibile** se non
spuntando la casella a mano.

### Il bug: lost update sui campi automatici

`updateCrmContactAction` riscrive **tutti** i campi tracking dal form (`actions.ts:184-195`).
Sequenza reale e non improbabile:

1. l'operatore apre la scheda alle 10:00 (i valori del form sono quelli di quel momento);
2. il contatto clicca il link alle 10:02 → `/i/<token>` scrive `linkAperto = true`,
   `linkAperture = 1`, `linkApertoAt`;
3. l'operatore salva alle 10:05 — magari solo per correggere una nota nel tab Anagrafica —
   e il payload riporta `linkAperto: false`, `linkAperture: 0`.

L'apertura vera è persa. Peggio: `linkApertoAt` **non** è nel form e quindi sopravvive,
lasciando un contatto con `linkAperto = false` e una data di apertura valorizzata — uno
stato che nessuna logica sa più leggere. Lo stesso vale per `iscrizioneComp`, che la
riconciliazione può accendere mentre la modale è aperta.

### Come veniva usato finora

Andrea usava il tab per segnare a mano "email inviata" quando la mandava per conto suo
(Gmail). La spunta non invia niente: l'unico invio reale è `sendEmailPartenzaAction`, che
oltre al flag genera `invitoToken` (il link tracciato), `emailUnsubToken`, aggancia il
`promoCodeInviato`, avanza `status` e blocca l'invio ai già registrati / disiscritti.
Nessuna di queste cose accade con la spunta. In particolare **senza `invitoToken` non
esiste un link tracciato**, quindi quei contatti restano fuori dal funnel automatico per
sempre.

### Decisioni prese col committente

1. **Attività manuale → solo via Stato.** I campi del tab diventano tutti sola lettura. Per
   registrare qualcosa fatto fuori piattaforma si imposta lo Stato nel tab "Stato &
   Chiamate": funziona già, perché `statoFattuale` onora lo status manuale se è più avanti
   dei flag (`fatti.ts:92`). Nessun campo nuovo per questo.
2. **Campi morti → fuori dalla UI**, colonne conservate sul DB per CRM-H.
3. **`iscrizioneInit` → match sull'email digitata** allo step Account del wizard. Copre
   anche chi si registra senza passare dal link CRM, coerentemente con `iscrizioneComp`
   che già si basa sul match.
4. **Webhook Resend: `email.opened` e `email.bounced`.** Niente `delivered` né
   `complained`.
5. **Bounce definitivo → blocca il reinvio** finché l'email non viene corretta. I bounce
   temporanei restano informativi.
6. **Correlazione webhook → contatto: colonna `crmContactId` su `NotificaInviata`.**

---

## Principio di progetto

Il tab Tracking & Pixel è un **referto**: sola lettura, scritto solo da eventi misurati.
Ciò che l'operatore *dichiara* vive nel tab Stato & Chiamate. Oggi i due piani sono
mescolati, ed è esattamente per questo che è possibile cancellare per sbaglio un fatto
misurato.

---

## Punto 1 — Modello dati

### `CrmContact` — tre campi nuovi, nessuno rimosso

```prisma
mailApertaAt     DateTime?  /// prima apertura della mail (le successive non la sovrascrivono)
emailBouncedAt   DateTime?  /// bounce DEFINITIVO (hard); null = indirizzo utilizzabile
emailBounceMotivo String?   /// messaggio del server destinatario, troncato a 500 char
```

- `mailAperta` è oggi un booleano senza data: il referto direbbe "sì" senza dire quando.
  Stessa semantica di `linkApertoAt`.
- Nessun booleano `emailBounced` affiancato a `emailBouncedAt`: `!= null` **è** il flag.
  Due campi che dicono la stessa cosa prima o poi divergono.

### `CrmContact` — un quarto campo, che chiude un buco preesistente

```prisma
iscrizioneInitAt DateTime?  /// quando è iniziata l'iscrizione (data di S6)
```

`fatti.ts:77` usa `iscrizioneAt` come data di S6, ma `iscrizioneAt` viene scritto solo a
**iscrizione completata**: oggi un S6 avrebbe sempre data vuota. Con il campo nuovo S6
acquista la sua data.

### `NotificaInviata`

```prisma
crmContactId String? @db.Uuid   /// contatto CRM destinatario (solo N26), per i webhook

@@index([crmContactId])
@@index([providerRef])
```

Riferimento **soft** (scalare, niente FK), come già fa `EventoPratica`: il contatto può
essere eliminato senza trascinarsi dietro il log di audit delle notifiche.
L'indice su `providerRef` oggi non c'è ed è la chiave di lettura del webhook.

### Migration

SQL scritto a mano + `pnpm db:deploy`. **Non** `pnpm db:migrate`: su questo schema
`migrate dev` propone DROP SEQUENCE.

---

## Punto 2 — Il fix del lost update

`CRM_CONTACT_INPUT` (`contatti/actions.ts:91-110`) perde tutti e 12 i campi tracking, e
`dataFromInput` smette di scriverli (`actions.ts:184-195`).

È il cuore dell'intervento. Finché quei campi arrivano dal form, **qualunque** salvataggio
della scheda può sovrascrivere un fatto misurato con uno snapshot vecchio. Rimossi
dall'input, il problema non è mitigato: non esiste più, perché non c'è più un percorso di
codice che ci passa.

`createCrmContactAction` usa lo stesso `dataFromInput` e continua a funzionare senza
modifiche: i default Prisma coprono (`@default(false)`, `@default(0)`).

---

## Punto 3 — Il tab diventa un referto

`TabTracking` (`client.tsx:1779`) diventa sola lettura, con la stessa nota introduttiva
che ha già `TabPiattaforma` (`client.tsx:1866`):

> *Referto automatico. Per registrare un'attività fatta fuori piattaforma, usa lo Stato nel
> tab "Stato & Chiamate".*

Righe mostrate:

| Riga | Fonte |
|---|---|
| Link inviato + data | `linkInviato`, `linkInviatoAt` |
| Link aperto + data + n. aperture | `linkAperto`, `linkApertoAt`, `linkAperture` |
| Mail aperta + data | `mailAperta`, `mailApertaAt` |
| Iscrizione iniziata + data | `iscrizioneInit`, `iscrizioneInitAt` |
| Iscrizione completata + data | `iscrizioneComp`, `iscrizioneAt` |
| Indirizzo email | badge "rimbalzato" + motivo, **solo se** `emailBouncedAt != null` |

**Rimossi dalla UI** (colonne conservate sul DB per CRM-H): `videoInviato`, `videoMin`,
`smsInviato`, `waInviato`.

Sulla riga "Mail aperta" va una nota esplicita: **è un indizio, non una prova**. L'apertura
si misura con un pixel, e Gmail lo pre-carica sui suoi proxy mentre Apple Mail Privacy
Protection lo apre per tutti i suoi utenti a prescindere dal comportamento reale. Se non è
scritto lì, prima o poi qualcuno costruirà una decisione commerciale su un numero gonfiato.

In **lista contatti**: badge "email rimbalzata" sulla riga, per vederli senza aprire le
schede una per una.

---

## Punto 4 — Webhook Resend

### Route

`POST /api/webhooks/resend` — `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

Il middleware esclude già tutto `/api` dal gate auth (`middleware.ts:10`): nessun lavoro di
sgating. Va invece registrata in `lib/auth/permessi/mappa-api.ts` con valore `null` e la
motivazione — c'è un test che impone che ogni route API sia nella mappa. Formula analoga
allo Stripe: *autenticata via firma Svix (`RESEND_WEBHOOK_SECRET`), non da un permesso*.

### Verifica della firma

Resend firma con **Svix**: header `svix-id`, `svix-timestamp`, `svix-signature`, segreto
`whsec_...` dalla dashboard. Si usa il pacchetto **`svix`** (via documentata), che gestisce
anche la tolleranza sul timestamp e quindi il replay. Nuova dipendenza di
`apps/piattaforma`.

Il corpo va letto **raw** (`await req.text()`) prima di qualunque parsing: la firma è
calcolata sui byte esatti.

La verifica sta in un modulo suo, `lib/webhooks/resend-signature.ts`, con una sola funzione
esportata — così è testabile in isolamento e la route non sa nulla di crittografia.

### Flusso

```
firma Svix non valida ─────────────────────► 401
type ∉ {email.opened, email.bounced} ──────► 200, no-op
data.tags.categoria ≠ N26_EMAIL_PARTENZA ──► 200, no-op
providerRef = data.email_id → NotificaInviata → crmContactId
   ├─ opened   → mailAperta = true, mailApertaAt ??= now
   │             NotificaInviata.readAt ??= now
   └─ bounced  → SOLO se data.bounce.type === 'Permanent'
                 E l'indirizzo rimbalzato == l'email del contatto:
                 emailBouncedAt = now
                 emailBounceMotivo = data.bounce.message troncato a 500
```

Il filtro sul tag `categoria` è gratis: `ResendEmailProvider` tagga **già** ogni email con
`categoria = <NotificaTipo>` (`lib/providers/email/resend.ts:34-36`), Resend rimanda i tag
nel payload, e `N26_EMAIL_PARTENZA` sopravvive intatto a `sanitizeTagValue` (solo lettere,
cifre e underscore). **Non è però questo filtro a garantire** che una mail transazionale
aperta da una persona che è anche un contatto CRM non sporchi il funnel: quella garanzia è
`NotificaInviata.crmContactId`, colonna scritta da un solo chiamante in tutto il repo
(`sendEmailPartenzaAction` via `sendNotification`) — nessuna notifica non-N26 può averla
valorizzata, a prescindere dal tag. Il filtro sul tag è un'ottimizzazione che risparmia le
due query quando l'evento non è nemmeno un'email di partenza, non l'unica barriera contro la
contaminazione. Per questo l'handler logga quando lo scarto avviene per questo filtro:
Resend documenta i tag in uscita come array e qui li leggiamo come oggetto, un'asimmetria
verificata ma della stessa forma di rischio già costata un giro di fix con `subType`.

Sul bounce, il blocco scatta **solo se l'indirizzo rimbalzato è quello del contatto**: gli
"indirizzi aggiuntivi" digitati a mano dall'operatore condividono lo stesso `crmContactId`
(l'attribuzione larga è corretta per le aperture, non per i bounce) e sono i più esposti agli
hard bounce di tutto il sistema, perché nessuno li valida mai. Bloccare il contatto per il
rimbalzo di un indirizzo che non è il suo metterebbe il badge e il messaggio di blocco su
un'email che non c'entra.

### Tre scelte, e perché

**`??=` ovunque.** I webhook si ripetono: Svix ritenta finché non riceve 200, e lo stesso
evento può arrivare due volte. Non sovrascrivendo mai la prima data, la ripetizione diventa
innocua — senza bisogno di una tabella di deduplica degli eventi.

**500 sugli errori dell'handler; 200 solo sui no-op genuini; 401 sulla firma; 400 sul segreto
mancante.** `handleResendEvent` esce con un semplice `return` (mai un `throw`) su ogni caso
"non c'è niente da fare" — tipo non gestito, tag diverso da N26, `providerRef` sconosciuto,
contatto eliminato: quegli eventi raggiungono comunque un 200, senza passare dal `catch`. Le
uniche eccezioni che il `catch` della route intercetta davvero sono errori Prisma o di
infrastruttura — cioè proprio la categoria per cui esistono i retry di Svix. Rispondere 200
anche lì significherebbe perdere per sempre un evento per un hiccup del DB. Decisione presa
in review (finding I-2 del 2026-08-06): un hiccup transitorio deve poter essere ritentato,
quindi la route risponde **500** quando l'handler lancia.

**Solo i bounce `Permanent` bloccano.** Casella piena o server momentaneamente giù
(`Temporary`) si registrano ma non impediscono il reinvio: bloccare un cliente valido
perché aveva la casella piena martedì è il danno peggiore dei due.

### Dove vive il blocco

Due punti già esistenti, nessuna astrazione nuova:

- **`sendEmailPartenzaAction`**: rifiuta se `emailBouncedAt != null`, accanto al controllo
  `emailOptOutAt` (`actions.ts:731`) e nella stessa forma. Messaggio: *"L'indirizzo ha
  rifiutato l'ultima email: correggilo prima di riprovare."*
- **`updateCrmContactAction`**: azzera `emailBouncedAt` e `emailBounceMotivo` quando
  l'email del contatto cambia. Correggere l'indirizzo **è** il rimedio: non serve un
  pulsante "sblocca".

### Popolamento di `crmContactId`

`sendEmailPartenzaAction` passa il contatto a `sendNotification` per ognuno dei destinatari
(il loop a `actions.ts:787`). Servono due modifiche in `send.ts`, e la seconda non è
scontata:

1. estendere il terzo parametro `opts` (`send.ts:340`) con `crmContactId?: string`;
2. **scriverlo dentro `prisma.notificaInviata.create` (`send.ts:425`)**.

Il secondo passo va detto esplicitamente perché il precedente più simile inganna:
`opts.praticaId` **non viene persistito** — serve solo a iniettare il blocco "Sede della
firma" nel template (`send.ts:394`). Il canale `opts` esiste, la persistenza no.

Così l'attribuzione è esatta **anche per gli "indirizzi aggiuntivi"**: se il titolare apre
l'email dalla sua casella personale — che non è l'email del contatto — il contatto giusto
si aggiorna comunque.

---

## Punto 5 — Iscrizione iniziata

In `checkEmailDisponibileAction` (`app/(auth)/actions.ts:873`), dopo il check di
disponibilità e prima del return: se l'email normalizzata corrisponde a un `CrmContact` non
eliminato e non ancora registrato (`iscrizioneComp = false`), accende `iscrizioneInit` e
`iscrizioneInitAt ??= now`.

Il punto di aggancio è giusto: l'action è chiamata al click su "Avanti" dello step Account
(`register-wizard.tsx:606`), una volta per tentativo — non a ogni tasto. Significa
letteralmente "ha compilato le credenziali e sta proseguendo".

Tutto in `try/catch` che ingoia: **un errore del CRM non deve mai bloccare una
registrazione in corso**. Vale anche per il ramo di rate limit, che ritorna prima: in
throttle il contatto semplicemente non viene marcato.

Poi `fatti.ts` usa `iscrizioneInitAt` come data di S6 al posto di `iscrizioneAt`.

---

## Test

**`lib/crm/fatti.ts`**
- S6 riporta `iscrizioneInitAt` come data (oggi sarebbe `null`).

**Webhook** (`api/webhooks/resend`)
- firma non valida → 401, nessuna scrittura;
- `tags.categoria` diverso da N26 → nessuna scrittura (no-op: l'evento non è un'email di
  partenza; la garanzia anti-contaminazione vera è `crmContactId`, testata a parte);
- tipo non gestito → 200, nessuna scrittura;
- stesso `email.opened` due volte → `mailApertaAt` invariato dopo il secondo;
- `bounce.type = 'Temporary'` → nessun blocco;
- `bounce.type = 'Permanent'` sull'email del contatto → `emailBouncedAt` valorizzato;
- `bounce.type = 'Permanent'` su un indirizzo diverso da quello del contatto (indirizzo
  aggiuntivo) → nessun blocco;
- `crmContactId` assente sulla notifica trovata → nessuna scrittura;
- `providerRef` sconosciuto → 200, nessuna eccezione;
- handler che lancia (errore Prisma/infrastruttura) → 500, non 200.

**Verifica firma** (`lib/webhooks/resend-signature.ts`)
- payload valido → true; body alterato di un byte → false.

**`contatti/actions.ts`**
- **regressione lost update**: salvare la scheda non tocca i campi tracking. È il bug da cui
  siamo partiti; il test deve tornare rosso se qualcuno rimette i campi nel form.
- `sendEmailPartenzaAction` rifiuta su `emailBouncedAt` valorizzato;
- `updateCrmContactAction` azzera il bounce quando l'email cambia, e **non** lo azzera
  quando l'email resta uguale;
- `sendEmailPartenzaAction` valorizza `crmContactId` su ogni `NotificaInviata`, indirizzi
  aggiuntivi compresi.

**`app/(auth)/actions.ts`**
- `checkEmailDisponibileAction` accende `iscrizioneInit` su un contatto corrispondente;
- non tocca un contatto già `iscrizioneComp`;
- se la query CRM lancia, l'action risponde comunque normalmente (il wizard non si rompe).

Verifica finale **sul browser**, non solo con i test: la modale in sola lettura e il badge
in lista vanno guardati nel DOM.

---

## Da fare a mano, fuori dal codice

1. 🛑 **Migration SQL applicata a mano su Neon, PRIMA del deploy.** Raggio d'azione: NON è
   solo il CRM. `send.ts` scrive `crmContactId` nella `create` di **ogni** `NotificaInviata`
   (fuori dal blocco `try`, incondizionato), quindi se il deploy precede la migration
   **tutte le email transazionali della piattaforma** falliscono a creare la riga di audit, e
   `/admin/crm/contatti` va in 500 per la colonna mancante.
2. **Resend → Webhooks**: creare l'endpoint verso `https://<app>/api/webhooks/resend`,
   eventi `email.opened` e `email.bounced`.
3. **Resend → dominio: abilitare l'open tracking** — 🛑 **BLOCCATO** dalla voce LIA qui
   sotto: non abilitare finché il trattamento non è coperto da LIA e informativa. Senza,
   comunque, `email.opened` non arriva mai.
4. ⚠️ **NON abilitare il click tracking.** Riscriverebbe gli URL dentro le email, e il
   conteggio delle aperture del link passa già da `/i/<token>`: lo falserebbe.
5. `RESEND_WEBHOOK_SECRET` su Vercel (in `env.ts` **opzionale**, come
   `STRIPE_WEBHOOK_SECRET`).

---

## Voce aperta — da chiudere con la revisione legale

L'open tracking è un **trattamento nuovo**: un pixel che registra quando una persona apre
una mail. Il documento LIA (`docs/legale/`) elenca i trattamenti uno per uno e questo non
c'è. Questa spec non lo tocca e non lo decide, ma lo segnala: è il caso tipico in cui il
codice rende falso un documento pubblicato. Da riconciliare con LIA e informativa prima di
considerare chiusa la feature.

---

## Stato del rilascio

Implementato sul branch `feat/crm-tracking-automatico` il 2026-08-06, in 11 task con review
per task. Piano: `docs/superpowers/plans/2026-08-06-crm-tracking-automatico.md`.

### Verificato sul browser (non solo dai test)

- **Il tab non contiene più campi scrivibili.** Letto il DOM della modale: gli unici elementi
  interattivi sono la chiusura, i 4 tab e i 3 bottoni in fondo. Nessun `input`, `select` o
  `textarea` nel pannello Tracking — assenti, non disabilitati.
- **Il lost update è chiuso.** Su un contatto di prova con `linkAperture = 3`: modificata la
  città, salvato, e riletto il DB → `citta = 'Roma'` (il salvataggio è avvenuto davvero) con
  `linkAperture` ancora **3**, `linkAperto` ancora `true`, `linkApertoAt` intatto. Prima di
  questo lavoro lo stesso salvataggio avrebbe scritto `false` e `0`.
- **Il badge "rimbalzata"** compare in lista accanto all'email, e nel tab compare la riga rossa
  «Indirizzo email» col motivo e la nota sul blocco.
- **Il reset del bounce è mirato.** Salvataggio con email invariata → `emailBouncedAt` resta.
  Salvataggio con email corretta → `emailBouncedAt` e `emailBounceMotivo` diventano `NULL`.
- Il contatto di prova è stato eliminato; il totale contatti è tornato al valore iniziale.

### ⚠️ Da fare a mano prima che serva davvero

1. 🛑 **Migration applicata a mano su Neon, PRIMA del deploy.** Non riguarda solo il CRM:
   `send.ts` scrive `crmContactId` nella `create` di **ogni** `NotificaInviata` (fuori dal
   `try`, per qualunque tipo di notifica). Se il deploy precede la migration, tutte le email
   transazionali della piattaforma falliscono e `/admin/crm/contatti` va in 500.
2. **Resend → Webhooks**: creare l'endpoint verso `https://<app>/api/webhooks/resend`, eventi
   `email.opened` e `email.bounced`.
3. **Resend → dominio: abilitare l'open tracking** — 🛑 **BLOCCATO dal punto 6 (voce LIA)**:
   non abilitare finché il trattamento non è coperto da LIA e informativa. Senza, comunque,
   `email.opened` non arriva mai.
4. ⚠️ **NON abilitare il click tracking**: riscriverebbe gli URL nelle email e falserebbe il
   conteggio aperture, che passa già da `/i/<token>`.
5. **`RESEND_WEBHOOK_SECRET` su Vercel** (production). Senza, il webhook risponde "non
   configurato" e gli eventi si perdono — il log aggiunto nella route subito prima di quel
   400 è ciò che rende visibile questo caso invece di lasciarlo muto (il log nel `catch`
   della verifica firma non c'entra: con il segreto assente si esce prima ancora di chiamare
   `verificaFirmaResend`, quindi quel log non scatta mai per questo caso).
6. 🛑 Voce LIA aperta: l'open tracking è un trattamento nuovo, non ancora coperto da LIA e
   informativa — **blocca il punto 3**.

### Correzione rispetto a questa spec

Il campo che distingue un rimbalzo definitivo da uno temporaneo **non** è `bounce.subType`
(che vale `Suppressed` / `MessageRejected` / `General`) ma **`bounce.type`** (`Permanent` /
`Temporary`). La spec diceva `subType === 'hard'`: non avrebbe fatto match mai, e nessun
indirizzo sarebbe mai stato bloccato — in silenzio. Verificato sul payload d'esempio della
documentazione Resend e corretto nel piano e nel codice.

---

## Fuori scope (esplicito)

- Video tutorial, SMS, WhatsApp: restano senza tracker. Sono il bundle **CRM-H** (Twilio +
  player video), le colonne restano sul DB pronte.
- Eventi `email.delivered` ed `email.complained`: non gestiti in questo giro.
- Vista/filtro dedicato "indirizzi da correggere" in lista: c'è il badge, non il filtro.
