# Blocco agenzia su addebito fee fallito + rimedio — Design

**Data:** 2026-06-28
**Branch:** main
**Stato:** approvato (design confermato dall'utente)

## Obiettivo

Quando alla chiusura di una pratica l'addebito della fee all'agenzia (SEPA) **non
riesce**, il sistema deve:
1. **bloccare l'agenzia** (non può più operare),
2. inviarle un'**email** che la invita ad aggiornare l'IBAN,
3. darle la possibilità, **da loggata**, di **cambiare l'IBAN** oppure
   **richiedere un nuovo tentativo** di addebito (se ha sistemato con la banca
   senza cambiare IBAN),
4. ad ogni azione, **ritentare** l'addebito scoperto; se l'addebito è confermato
   con successo l'agenzia si **sblocca**, se fallisce ancora **si ricomincia**.

## Decisioni di prodotto (confermate)

- **Blocco "soft"**: l'agenzia **può ancora fare login**, ma è confinata alla
  schermata di rimedio finché l'addebito non riesce. È uno stato **separato**
  dalla sospensione admin esistente (che invece impedisce il login).
- **Sblocco solo a conferma definitiva** (`SUCCESS` del fee): con SEPA reale
  arriva via webhook anche dopo giorni; nel frattempo l'agenzia resta bloccata e
  vede "addebito in elaborazione".
- **Trigger su qualsiasi mancato incasso**: il blocco scatta su `FAILED`
  (definitivo) **e** su `RETRY` (oggi il job non ri-prova da solo, quindi un
  RETRY resterebbe comunque non incassato).

## Contesto esistente (verificato)

- **Creazione fee** (firma): `app/pratiche/actions.ts` → `markFirmaAvvenutaAction`
  crea `FeeAddebito(stato SCHEDULED, scheduledAt=now)` + email `N8_AGENZIA_ADDEBITO`.
- **Addebito reale** (job): `lib/jobs/process-fee-scheduled.ts` prende i
  `SCHEDULED` con `scheduledAt<=now` → `IN_LAVORAZIONE` → `payment.chargeFee()` →
  outcome (`SUCCESS` | `PENDING` resta IN_LAVORAZIONE | `RETRY` | `FAILED`).
- **Webhook** `lib/jobs/stripe-webhook.ts`: `payment_intent.succeeded` → `SUCCESS`;
  `payment_intent.payment_failed` → `FAILED`. (Esiste anche `setup_intent.*` per
  riconciliare il mandato.)
- **Provider** `lib/providers/payment/types.ts`: `chargeFee(input) → PaymentResult`
  (`{ok:true, providerRef, pending?}` | `{ok:false, error, retryable}`). `stripe.ts`
  usa `idempotencyKey: charge-fee:${feeAddebitoId}` e richiede `sepaMandateStatus==='ACTIVE'`.
  `mock.ts` ritorna sempre success.
- **Mandato SEPA** è **server-side da stringa IBAN**: `lib/providers/payment/stripe-mandate.ts`
  → `applySepaMandateToAgency({ companyId, iban, name, email, ip, userAgent })`
  crea Customer + SetupIntent(`sepa_debit.iban`) e aggiorna
  `Company.{stripeCustomerId, stripePaymentMethodId, sepaMandateId, sepaMandateStatus}`.
  → **ri-setup con nuovo IBAN è fattibile** richiamando la stessa funzione.
- **Modelli**: `FeeAddebito` (campi `stato`, `tipo`, `importoCent`, `scheduledAt`,
  `executedAt`, `errorMessage`, `providerRef`, `agenziaId`, `praticaId`); enum
  `FeeAddebitoStato { SCHEDULED, IN_LAVORAZIONE, SUCCESS, FAILED, RETRY, ANNULLATO }`.
  `Company.iban`, mandato SEPA, e `suspendedAt`/`suspensionLastNote` (sospensione admin).
- **Sospensione admin** (`app/admin/suspension-actions.ts`): setta `Company.suspendedAt`
  + `User.status='SUSPENDED'`; l'enforcement è in `lib/auth/credentials-query.ts`
  (gli utenti SUSPENDED **non passano il login**). → **non riusabile** per questa
  feature, che richiede login attivo.
- **NESSUNA gestione fallimento esistente**: oggi un fee FAILED/RETRY è solo
  tracciato (niente blocco, niente notifica, niente retry).

## Architettura

### A. Stato di blocco (nuovo, separato)

Campi su `Company`:
- `bloccoPagamentoAt DateTime?` — `null` = operativa; valorizzato = bloccata per
  addebito fallito.
- `bloccoPagamentoMotivo String?` — audit (es. messaggio errore Stripe).

**Non** tocca `User.status` né `suspendedAt`: il login resta possibile.

### B. Handler centralizzati (nuovo modulo `lib/fee/blocco.ts`, server-only)

- `bloccaAgenziaPerAddebito(feeId, motivo)`: carica il fee → se l'agenzia non è
  già bloccata, setta `bloccoPagamentoAt=now` + `bloccoPagamentoMotivo=motivo` e
  invia l'email `N9_AGENZIA_ADDEBITO_FALLITO`. Best-effort, idempotente.
- `rivalutaBloccoAgenzia(agenziaId)`: se l'agenzia è bloccata e **non** ha più
  alcun `FeeAddebito` in `{FAILED, RETRY, IN_LAVORAZIONE}` (nessun addebito
  scoperto né in volo), azzera `bloccoPagamentoAt`/`bloccoPagamentoMotivo`
  (sblocco). Best-effort, idempotente.

### C. Agganci ai punti di transizione del fee

- `process-fee-scheduled.ts`: ramo `RETRY|FAILED` → `bloccaAgenziaPerAddebito`;
  ramo `SUCCESS` → `rivalutaBloccoAgenzia`.
- `stripe-webhook.ts`: `payment_intent.payment_failed` → `bloccaAgenziaPerAddebito`;
  `payment_intent.succeeded` → `rivalutaBloccoAgenzia`.

### D. Riuso del processing per-fee

Estrarre dal job una funzione `processFeeAddebito(feeId): Promise<FeeOutcomeStatus>`
(transizione IN_LAVORAZIONE → `chargeFee` → update stato/outcome + chiamata agli
handler blocco/rivaluta). Usata sia dal loop del job sia dall'azione di retry,
così la logica di addebito vive in un punto solo (DRY).

### E. Idempotency per-tentativo

`FeeAddebito.tentativi Int @default(0)`. `ChargeFeeInput` guadagna `tentativo: number`;
`stripe.ts` usa `idempotencyKey: charge-fee:${feeAddebitoId}:${tentativo}` così ogni
retry crea un nuovo PaymentIntent invece di restituire quello fallito in cache.
`mock.ts` ignora il campo (firma aggiornata).

### F. Email `N9_AGENZIA_ADDEBITO_FALLITO`

Nuovo template puro in `lib/notifiche/templates.ts` + voce in union/`render()` di
`send.ts` + valore enum `NotificaTipo` (migration). Transazionale (no OPTIONAL_TIPI).
Destinatario: l'agenzia. Copy:
> «Non ha funzionato l'addebito automatico, il tuo account è stato momentaneamente
> sospeso. Aggiorna l'IBAN inserito nella piattaforma.»
+ CTA alla pagina di rimedio `/blocco-pagamento`.

### G. Enforcement del blocco ("non può operare")

- `lib/auth/session-context.ts` espone `bloccoPagamentoAt` dell'azienda.
- **Gate** nell'area agenzia (layout/shell): un'agenzia con `bloccoPagamentoAt`
  valorizzato viene **redirezionata a `/blocco-pagamento`** su qualsiasi rotta,
  tranne la pagina di rimedio stessa e il logout.
- **Guardie difensive** server-side nelle azioni operative: `acceptPratica`
  (inbox), `markPraticaProcessataAction`, `markFirmaAvvenutaAction` → rifiutano se
  l'agenzia è bloccata.
- **Esclusione dalla distribuzione**: l'engine (`lib/distribuzione/`) non assegna
  pratiche a sedi/agenzie con `bloccoPagamentoAt` valorizzato.

### H. Pagina di rimedio `/blocco-pagamento`

Server component che carica lo stato (bloccata? IBAN attuale? c'è un addebito in
elaborazione?) + client con due azioni:
- **Aggiorna IBAN**: `aggiornaIbanERitentaAction(nuovoIban)` → salva `Company.iban`
  (validazione come `updateCompanyProfileAction`) → `applySepaMandateToAgency` col
  nuovo IBAN → poi ritenta (vedi sotto).
- **Riprova addebito**: `ritentaAddebitoAction()` → ritenta col mandato esistente.

**Ritento**: per ogni `FeeAddebito` scoperto dell'agenzia (stato `FAILED|RETRY`),
riportalo a `SCHEDULED`, `tentativi += 1`, `scheduledAt=now`, poi
`processFeeAddebito(feeId)` (charge sincrono → feedback immediato). Esiti:
- charge `SUCCESS` (mock/instant) → `rivalutaBloccoAgenzia` sblocca;
- charge `PENDING`/processing (SEPA reale) → resta bloccata, stato "in elaborazione"
  finché il webhook conferma;
- charge `FAILED`/`RETRY` → resta bloccata, l'agenzia può ritentare di nuovo.

**Stato "in elaborazione"**: se l'agenzia è bloccata e ha un fee `IN_LAVORAZIONE`
ma nessun `FAILED|RETRY`, la pagina mostra «addebito in elaborazione, attendi
conferma» e **disabilita** un nuovo tentativo (no doppio addebito).

**Mandato PENDING dopo cambio IBAN**: `chargeFee` richiede mandato `ACTIVE`. Se il
ri-setup ritorna `PENDING`, il charge fallisce (non retryable) → resta bloccata e
la pagina mostra «mandato in attivazione, riprova tra poco»; la conferma del
mandato arriva via webhook `setup_intent.succeeded` (esistente) che lo porta ad
`ACTIVE`. (In TEST mode il setup è di norma `succeeded` subito → `ACTIVE`.)

### I. Schema / migration (una sola)

`Company.bloccoPagamentoAt`, `Company.bloccoPagamentoMotivo`,
`FeeAddebito.tentativi Int @default(0)`, enum `NotificaTipo += N9_AGENZIA_ADDEBITO_FALLITO`.
Da applicare a prod con `prisma migrate deploy`.

## Edge cases

- **Più fee scoperti** (più pratiche fallite): il blocco è a livello agenzia; il
  retry ri-processa **tutti** i fee `FAILED|RETRY`; lo sblocco avviene solo quando
  nessuno resta scoperto/in volo.
- **Mock provider** (sempre success): il percorso di fallimento non scatta in
  mock → testato con uno **stub provider** che fallisce negli unit test. In prod
  scatta col webhook reale a Stripe live.
- **Doppio blocco**: `bloccaAgenziaPerAddebito` è idempotente (non sovrascrive
  `bloccoPagamentoAt` se già settato; aggiorna solo il motivo).
- **Sospensione admin concorrente**: indipendente (`suspendedAt` separato). Un'
  agenzia può essere sia admin-suspended sia payment-blocked senza conflitti.

## Test

- Unit `lib/fee/blocco.ts`: `bloccaAgenziaPerAddebito` (set + email, idempotente),
  `rivalutaBloccoAgenzia` (sblocca solo se nessun fee scoperto/in volo) — mock prisma.
- Unit `processFeeAddebito` con **stub provider** (success/pending/retry/failed) →
  transizioni stato corrette + chiamate blocco/rivaluta.
- Unit template `tplN9...` (copy presente, CTA).
- Unit guardie azioni (rifiuto se bloccata) ove testabili in pattern repo
  (server-action mock come `sedi/actions.test.ts`).
- Verifica visiva manuale della pagina `/blocco-pagamento` e del gate.

## File toccati (sintesi)

- `packages/db/prisma/schema.prisma` + nuova migration.
- `apps/piattaforma/src/lib/fee/blocco.ts` (**nuovo**) + test.
- `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts` (estrai `processFeeAddebito` + hook).
- `apps/piattaforma/src/lib/jobs/stripe-webhook.ts` (hook blocco/rivaluta).
- `apps/piattaforma/src/lib/providers/payment/{types,stripe,mock}.ts` (`tentativo` + idempotency).
- `apps/piattaforma/src/lib/notifiche/{templates,send}.ts` (N9).
- `apps/piattaforma/src/lib/auth/session-context.ts` (espone `bloccoPagamentoAt`).
- `apps/piattaforma/src/app/blocco-pagamento/` (**nuovo**: page + client + actions).
- gate area agenzia (layout/shell) + guardie in `app/inbox/actions.ts`,
  `app/pratiche/actions.ts` + esclusione distribuzione in `lib/distribuzione/`.

## Non in scope

- Auto-retry programmato dei RETRY (oltre al retry manuale dell'agenzia).
- Email di sblocco (non richiesta).
- Gestione fee `AUTO_ADDEBITO_GIORNO_20` (non implementato a monte).
