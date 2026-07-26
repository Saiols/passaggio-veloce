# Fattura PV emessa dopo l'incasso confermato

**Data:** 2026-07-26
**Stato:** approvato, da pianificare

## Problema

Oggi la `FATTURA_PV` verso l'agenzia nasce **alla firma**, prima che sia stato
tentato un solo centesimo di addebito.

1. La firma porta la pratica a `FIRMATA` e crea il `FeeAddebito` in stato
   `SCHEDULED` nella stessa transazione (`firma-engine.ts:257-332`).
2. Subito dopo il commit, `createFatturaPv` genera il documento fiscale,
   numerato sul contatore, e il PDF viene allegato alla N8 (`firma-engine.ts:367`).
3. Il prelievo parte solo dal cron `/api/jobs/process-fee-scheduled`, oggi
   schedulato `0 5 * * *` — **una volta al giorno** (`vercel.json:12-15`).
4. L'addebito SEPA è asincrono: il PaymentIntent torna `processing`
   (`stripe.ts:53-54`), il fee resta `IN_LAVORAZIONE` (`process.ts:38-40`) e la
   conferma arriva giorni dopo dal webhook `payment_intent.succeeded`.

Due conseguenze oltre alla tempistica:

- **Il documento non sa nulla dell'incasso.** `statoPagamento` è scritto solo
  alla create come `IN_ATTESA` (`engine.ts:50`) e non diventa mai `PAGATA`:
  nessun percorso aggiorna il documento quando Stripe conferma.
- **Se l'addebito fallisce, la fattura resta in piedi.** `createNotaCredito`
  esiste (`engine.ts:123`) ma non è chiamata da nessun percorso di produzione.

Fiscalmente, per una prestazione di servizi il momento impositivo è il pagamento
(art. 6 D.P.R. 633/1972). Emettere alla firma è una fattura anticipata:
legittima, ma rende l'IVA esigibile su denaro che può non arrivare mai, e senza
nota di credito quell'IVA non si recupera.

## Decisione

La `FATTURA_PV` nasce quando il `FeeAddebito` passa a `SUCCESS`, cioè a incasso
confermato. Contestualmente l'addebito smette di aspettare il cron e parte dalla
firma.

## 1. Un solo punto di transizione a SUCCESS

Oggi un fee diventa `SUCCESS` in due posti — l'esito sincrono
(`process.ts:32-37`) e il webhook (`stripe-webhook.ts:15-21`) — che già
duplicano la stessa coppia di azioni (update a `SUCCESS` +
`rivalutaBloccoAgenzia`). Appendere l'emissione a entrambi significa
garantire che il prossimo intervento la dimentichi in uno dei due.

Nuovo modulo `lib/fee/incasso.ts`, unico proprietario della transizione:

```
segnaFeeIncassato(feeId, providerRef):
  1. compare-and-set del fee a SUCCESS (updateMany con stato: { not: 'SUCCESS' })
  2. se count === 0 → esce: qualcun altro ha già incassato, niente seconda fattura
  3. rivalutaBloccoAgenzia(agenziaId)
  4. createFatturaPv({ feeAddebitoId, statoPagamento: 'PAGATA' })
  5. se il documento è stato creato ora → N53 + inviatoEmailAt
```

Il CAS è la garanzia anti-doppia-emissione: emette solo la transizione che vince
la corsa. `process.ts` e `stripe-webhook.ts` diventano due chiamate a questa
funzione. Copre anche la doppia consegna dello stesso evento da parte di Stripe.

## 2. `createFatturaPv`

- **Ingresso**: `feeAddebitoId` al posto di `(praticaId, agenziaId, feeAgenziaCent)`.
  Da lì legge `praticaId`, `agenziaId` e **`importoCent`**: la fattura vale
  quello che è stato realmente addebitato, non quello che era previsto alla firma.
- **`statoPagamento`**: argomento esplicito del chiamante (`PAGATA` sul percorso
  d'incasso, `IN_ATTESA` sulla valvola). Sparisce la stortura per cui nessun
  documento diventava mai `PAGATA`.
- **`feeAddebitoId`** valorizzato sul documento: il campo esiste in schema
  (`documenti_fiscali`) ma oggi non viene mai scritto. Diventa il legame
  documento ↔ incasso, per tracciabilità e lettura in admin. Non è indicizzato e
  la riconciliazione non ci passa: interroga per `praticaId`, che l'indice ce
  l'ha, così non serve una migration.
- **Ritorno**: il documento creato, oppure `null` se esisteva già. Serve a far
  partire la N53 esattamente una volta da due chiamanti indipendenti.
- Resta idempotente per pratica (`findFirst` su `praticaId` + `FATTURA_PV`),
  seconda rete sotto il CAS.

**Conseguenza sulla numerazione:** numero progressivo e anno si prendono
all'emissione, quindi all'incasso. Una pratica firmata il 30 dicembre e
incassata il 4 gennaio prende un numero dell'anno nuovo. È corretto (data
documento = data emissione) ma è un cambiamento rispetto a oggi.

## 3. L'addebito parte dalla firma

- `firma-engine.ts`: post-commit, best-effort, accanto alle altre chiamate della
  stessa zona → `processFeeAddebito(feeId)`. Se fallisce, la firma è già
  committata e il fee resta `SCHEDULED`.
- Il gate `isPaymentLive()` si sposta **dentro `processFeeAddebito`** (ritorna
  `SKIPPED`). Oggi vive solo nel job, quindi `ritentaAddebitiAgenzia`
  (`retry.ts:26`) in mock porterebbe soldi finti fino a `SUCCESS`. Con il gate
  nel motore, i tre chiamanti — firma, cron, retry — si comportano allo stesso modo.
- `vercel.json`: `process-fee-scheduled` passa da `0 5 * * *` a `0 * * * *`.
  Il cron smette di essere l'esecutore e diventa rete di recupero; continua a
  servire per il reaper (`process-fee-scheduled.ts:23-37`), i retry orfani e le
  chiamate dalla firma che non sono partite.
- **Riconciliazione**, nuovo compito dello stesso cron: fee `SUCCESS` senza
  `FATTURA_PV` → emette; documento con `inviatoEmailAt` null → rimanda solo la
  N53. La query parte dai `FeeAddebito` con `stato: SUCCESS` ed `executedAt`
  negli ultimi 7 giorni, a batch limitato come già fa il job (`BATCH_SIZE`), e
  controlla i documenti per `praticaId`. Partire dai fee, e non dai documenti,
  la rende automaticamente innocua in mock: lì nessun fee arriva mai a `SUCCESS`.

## 4. La valvola sul provider

Una sola condizione, in un punto solo: `isPaymentLive()`.

| | `PAYMENT_PROVIDER=stripe` | `PAYMENT_PROVIDER=mock` |
|---|---|---|
| Chi emette | `segnaFeeIncassato`, all'incasso | `firma-engine`, alla firma (come oggi) |
| `statoPagamento` | `PAGATA` | `IN_ATTESA` |
| N8 | senza allegato | con allegato (invariata) |

La valvola chiama la stessa `createFatturaPv` con lo stesso `feeAddebitoId` — la
riga fee esiste già, creata nella transazione di firma — passando
`statoPagamento: 'IN_ATTESA'`. Nessun ramo duplicato: cambia solo chi chiama e
quando. La valvola si chiude da sola il giorno del go-live Stripe.

Sul percorso valvola la N8 **è** la consegna della fattura, quindi valorizza
`inviatoEmailAt` come farebbe la N53. Serve per il giorno in cui il provider
passa da mock a stripe: gli addebiti arretrati arrivano a `SUCCESS`,
`createFatturaPv` torna `null` perché il documento esiste già, e senza quel
timestamp la riconciliazione manderebbe una N53 per fatture che l'agenzia ha già
ricevuto in allegato alla N8.

Caso invariato nei due mondi: con `feeAgenziaCent` a 0 non nasce nessun
`FeeAddebito` (`firma-engine.ts:318`) e quindi nessuna fattura, esattamente come
oggi dove `createFatturaPv` esce subito su importo ≤ 0.

## 5. Notifiche

**N8** prende un flag nel payload (`fatturaAllegata`): con allegato e testo
attuale in mock; senza allegato e con una riga che spiega che la fattura seguirà
l'incasso quando il provider è live.

**N53 — "Fattura disponibile"**, nuovo template (l'ultimo in uso è N52), con il
PDF allegato via `fatturaPvAttachment`. Destinatario: l'`ADMIN_AZIENDA`
dell'agenzia madre, **non** il risolutore per sede — le email che portano
fattura o saldo restano alla madre, coerente con la N8 di oggi.

Parte da chi ha davvero creato il documento (ritorno non-`null` di
`createFatturaPv`), che valorizza anche `inviatoEmailAt`. Così percorso
d'incasso e riconciliazione notificano una volta sola senza conoscersi.

## 6. Errori

Ogni anello ha la sua rete e nessuno rolla indietro l'anello sopra:

- `processFeeAddebito` alla firma fallisce → firma già committata, fee
  `SCHEDULED`, il cron orario lo raccoglie.
- `createFatturaPv` fallisce dentro `segnaFeeIncassato` → il fee resta `SUCCESS`
  perché i soldi sono arrivati davvero; la riconciliazione emette entro l'ora.
  Non si annulla un incasso perché un PDF è andato storto.
- La N53 fallisce → il documento è comunque in `/fatturazione` e
  `inviatoEmailAt` resta `null`: la riconciliazione la rimanda.
- Webhook consegnato due volte → il CAS ne fa vincere uno solo.

## 7. Test

1. **`segnaFeeIncassato`**: due chiamate → una sola fattura (decide il CAS);
   stesso esito dal percorso sincrono e dal webhook.
2. **`firma-engine`**: live → non emette e la N8 non ha allegato; mock → emette
   con allegato. È il test che protegge la valvola.
3. **`processFeeAddebito`**: in mock → `SKIPPED` senza toccare il provider
   (protegge il retry, che oggi il gate non ce l'ha).
4. **Riconciliazione**: fee `SUCCESS` senza documento → emette; con documento →
   no-op; documento con `inviatoEmailAt` null → rimanda solo l'email.
5. **`createFatturaPv`**: usa `fee.importoCent` e non `pratica.feeAgenziaCent`;
   nasce `PAGATA` sul percorso d'incasso; scrive `feeAddebitoId`.
6. **Browser**: `/fatturazione` lato agenzia e lato admin, e il PDF allegato
   alla N53 aperto davvero. I test non vedono quello che vede solo il browser.

## Fuori scope

- Dispute e rimborsi SEPA post-incasso: gestione manuale con il commercialista,
  come oggi. Il webhook non intercetta `charge.dispute.*` né `charge.refunded`.
- Nota di credito automatica: `createNotaCredito` resta il codice non agganciato
  che è oggi.
- Nessun backfill dei documenti già emessi in produzione: quei dati sono
  usa-e-getta, tutti gli account si ri-registrano.

## Da presidiare

- **Nessuna migration Prisma**: `feeAddebitoId`, `statoPagamento: PAGATA` e
  `inviatoEmailAt` esistono già tutti in schema.
- **Valore di `PAYMENT_PROVIDER` in produzione** da confermare su Vercel. Con la
  valvola il deploy è sicuro in entrambi i casi, ma cambia cosa si osserva dopo.
- **Termini da riallineare**: la clausola 11 elenca fra gli effetti
  dell'attestazione "addebito della fee ed emissione della relativa fattura" e
  la clausola 9 rimanda alle "tempistiche indicate in Piattaforma". Restano
  vere, ma la tempistica reale cambia: il testo va rivisto, altrimenti il codice
  rende falso il contratto. La KB del chatbot si riallinea da sola al prebuild
  una volta aggiornati i docs.
