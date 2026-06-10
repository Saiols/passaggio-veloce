# Passaggio Veloce — Integrazione Stripe (Fase 1: SEPA mandato + flusso denaro, TEST mode)

> Owner: CTO Francesco Sioli. Source-of-truth della feature.
> Data: 2026-06-10.
> Stato: **design approvato, pronto per il piano di implementazione.**
> Riferimenti: `docs/sistema-fatturazione.md` (modello economico), `docs/piano-implementazione.md` FASE 5,
> `docs/sistema-penali-broker.md` (wallet), `docs/sistema-affiliazione.md` (payout affiliazione).

---

## 1. Obiettivo e scope

### 1.1 Obiettivo (questa fase)
1. Le **agenzie** si registrano, inseriscono l'IBAN e **accettano un mandato SEPA Direct Debit reale via Stripe**, così PV è autorizzata ad addebitare gli importi delle pratiche.
2. Il **flusso pratica monetario è completo e validabile end-to-end** (addebito agenzia → accredito wallet broker → payout), senza muovere denaro reale.
3. Il **payout al broker** segue la **Strada B** (bonifico dal conto PV): broker a zero-attrito, esecuzione reale rimandata.

### 1.2 Strategia "nessun denaro reale" = Stripe TEST mode
Si imposta `PAYMENT_PROVIDER=stripe` con **chiavi di test** (`sk_test_…`). Questo accende `isPaymentLive()` (=`PAYMENT_PROVIDER !== 'mock'`), quindi i job di pagamento **girano davvero** ma contro l'API test di Stripe → denaro finto. Validato il flusso, il go-live è uno **swap a chiavi `sk_live`** + ri-raccolta mandati (i mandati test non sono validi in produzione).

### 1.3 Fuori scope (confermato)
- Generazione documenti fiscali (`DocumentoFiscale`, PDF, XML FatturaPA, SDI) → bloccata da B1 (commercialista), lavoro a parte (`sistema-fatturazione.md`).
- **Stripe Connect** (onboarding broker, transfer automatici) → blocco B5, non necessario con Strada B.
- Stripe.js / Elements lato client → non usato (mandato raccolto **server-side**).
- Denaro reale (chiavi live, addebiti/payout reali).

---

## 2. Decisioni prese

| # | Tema | Decisione |
|---|---|---|
| D1 | Account Stripe | Da creare ora; si parte in **TEST mode** (chiavi test immediate). |
| D2 | Modalità Fase 1 | **Stripe TEST mode ovunque**. Flusso completo, denaro finto. |
| D3 | Payout broker | **Strada B** — bonifico dal conto PV. Broker dà solo l'IBAN, nessun onboarding. `executePayout` no-op che registra; esecuzione reale (admin manuale o file SEPA XML) post-validazione. |
| D4 | Scope | Solo mandato SEPA + flusso denaro. Niente documenti fiscali. |
| D5 | Raccolta mandato | **Server-side** (`SetupIntent` + `payment_method_data` con IBAN + `mandate_data` online). Niente Stripe.js/publishable key. |
| D6 | Aggancio registrazione | **Post-commit best-effort** dentro `registerAction`, **solo `type==='AGENZIA'`** (come promo/CRM: non blocca la registrazione). |
| D7 | Footgun payout | `executePayout` ritorna `ok:true` con `providerRef='manual-bonifico:<payoutId>'`: in test mode chiude il flusso (wallet decrementato, Payout `ESEGUITO`). Al go-live si sostituisce con conferma admin / file SEPA. Loggato in modo evidente. |
| D8 | Settlement SEPA asincrono | `PaymentResult` esteso con `pending?: boolean`. SEPA `processing` ⇒ fee resta `IN_LAVORAZIONE`; il **webhook** è autoritativo per `SUCCESS`/`FAILED`. |

---

## 3. Direzione del denaro (chi paga, chi riceve)

| Ruolo (`CompanyType`) | Posizione economica | Cosa serve da Stripe |
|---|---|---|
| **AGENZIA** | **paga** la fee (€75 trapasso / €30/€20×N minivoltura) → viene **addebitata** | Stripe **Customer** + **mandato SEPA Direct Debit** |
| **DEALER** (broker) | **riceve** la propria quota in wallet → **payout** | solo **IBAN** salvato (Strada B). Nessun customer/mandato Stripe. |

Invariante: il mandato di addebito si configura **solo per le agenzie**. Il dealer fornisce l'IBAN unicamente per ricevere i payout.

---

## 4. Schema (1 migration: `add_stripe_sepa`)

Estensione `Company`:

```prisma
model Company {
  // ... campi esistenti, inclusi:
  // iban                  String?
  // sepaMandateAccepted   Boolean   @default(false)
  // sepaMandateAcceptedAt DateTime?

  /// Stripe Customer dell'agenzia (null per dealer/broker).
  stripeCustomerId String?

  /// PaymentMethod sepa_debit salvato e usato per gli addebiti off_session.
  stripePaymentMethodId String?

  /// Id del mandato SEPA Stripe (audit legale / riferimento dichiarazioni).
  sepaMandateId String?

  /// Stato del mandato SEPA. PENDING fino a conferma Stripe, ACTIVE quando
  /// utilizzabile per addebiti, FAILED se il SetupIntent fallisce.
  sepaMandateStatus SepaMandateStatus @default(PENDING)
}

enum SepaMandateStatus {
  PENDING   // nessun setup ancora riuscito (dealer restano sempre PENDING: non li usiamo)
  ACTIVE    // mandato valido, addebiti possibili
  FAILED    // setup fallito, da riparare
}
```

> Nota: i dealer non ottengono mai un mandato; il loro `sepaMandateStatus` resta `PENDING` e non viene mai consultato (l'addebito è solo per agenzie). I campi `sepaMandateAccepted/At` esistenti restano per audit dell'accettazione UI.

`FeeAddebitoStato` (esistente, invariato): `SCHEDULED | IN_LAVORAZIONE | SUCCESS | FAILED | RETRY`.
`PayoutStato` (esistente, invariato): `RICHIESTO | IN_LAVORAZIONE | ESEGUITO | FALLITO`.

---

## 5. Componenti

### 5.1 Client Stripe singleton — `lib/providers/payment/stripe-client.ts`
- Esporta `getStripe(): Stripe` con istanza lazy singleton.
- **Asserzione runtime**: se `env.STRIPE_SECRET_KEY` manca → `throw new Error('STRIPE_SECRET_KEY mancante con PAYMENT_PROVIDER=stripe')`. (Coerente col pattern di `getPayment()` che già lancia.)
- `apiVersion` pinnata (ultima stabile dell'SDK installato).

### 5.2 Setup mandato — `lib/providers/payment/stripe-mandate.ts`
```ts
type SetupSepaMandateInput = {
  companyId: string;
  iban: string;
  name: string;        // ragione sociale agenzia
  email: string;
  ip?: string | null;        // da signupIp (registrazione)
  userAgent?: string | null; // da headers()
};

type SetupSepaMandateResult =
  | { ok: true; customerId: string; paymentMethodId: string; mandateId: string | null }
  | { ok: false; error: string };

async function setupSepaMandate(input): Promise<SetupSepaMandateResult>;
```
Implementazione:
1. `customers.create({ name, email, metadata: { companyId } })`
   — idempotency key `setup-mandate-customer:${companyId}` (no customer duplicati su retry).
2. `setupIntents.create({ customer, payment_method_types:['sepa_debit'], payment_method_data:{ type:'sepa_debit', sepa_debit:{ iban }, billing_details:{ name, email } }, mandate_data:{ customer_acceptance:{ type:'online', online:{ ip_address: ip ?? '0.0.0.0', user_agent: userAgent ?? 'unknown' } } }, confirm:true })`.
3. Ritorna `customerId`, `paymentMethodId` (= `setupIntent.payment_method`), `mandateId` (= `setupIntent.mandate`).
4. Errori Stripe → `{ ok:false, error }`.

> Il modulo **non** scrive sul DB: l'aggiornamento `Company` lo fa il chiamante (registrazione), così resta testabile in isolamento.

### 5.3 Provider — `lib/providers/payment/stripe.ts` (`StripePaymentProvider`)
Implementa `PaymentProvider` (`name='stripe'`).

**`chargeFee({ feeAddebitoId, importoCent, agenziaId })`:**
1. `prisma.company.findUnique(agenziaId)` → `stripeCustomerId`, `stripePaymentMethodId`, `sepaMandateStatus`.
2. Se mandato non `ACTIVE` o ids mancanti → `{ ok:false, error:'Mandato SEPA non configurato', retryable:false }`.
3. `paymentIntents.create({ amount: importoCent, currency:'eur', customer, payment_method, payment_method_types:['sepa_debit'], off_session:true, confirm:true, metadata:{ feeAddebitoId } })`
   — idempotency key `charge-fee:${feeAddebitoId}` (no doppio addebito su RETRY).
4. Mappa lo status del PaymentIntent:
   - `processing` → `{ ok:true, providerRef: pi.id, pending:true }`
   - `succeeded` → `{ ok:true, providerRef: pi.id }`
   - `requires_payment_method` / `canceled` → `{ ok:false, error, retryable:true }`
   - altri → `{ ok:false, error, retryable:false }`
5. `StripeError` → `{ ok:false, error: e.message, retryable: <true per errori transitori> }`.

**`executePayout({ payoutId, importoCent, iban })` (Strada B no-op):**
- `console.warn('[stripe] payout Strada B no-op (bonifico manuale): payout=… importo=… iban=…')`
- ritorna `{ ok:true, providerRef: 'manual-bonifico:' + payoutId }`.
- Al go-live: sostituire con conferma admin o generazione file SEPA XML (pain.001).

### 5.4 Estensione tipo `PaymentResult` — `lib/providers/payment/types.ts`
```ts
export type PaymentResult =
  | { ok: true; providerRef: string; pending?: boolean }   // pending: SEPA in settlement
  | { ok: false; error: string; retryable: boolean };
```
Retro-compatibile: il mock non setta `pending` → comportamento invariato.

### 5.5 `getPayment()` — `lib/providers/payment/index.ts`
Sostituire il ramo `case 'stripe': throw …` con `instance = new StripePaymentProvider()`.

### 5.6 Webhook — `app/api/webhooks/stripe/route.ts`
- `POST(req: Request)`: `const body = await req.text()` (raw body, **niente** parse JSON), header `stripe-signature`.
- `getStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)`; firma invalida → `400`.
- Eventi gestiti:
  - `payment_intent.succeeded` → `FeeAddebito` (match per `metadata.feeAddebitoId`, fallback `providerRef`) → `SUCCESS` + `executedAt`. (idempotente: skip se già `SUCCESS`).
  - `payment_intent.payment_failed` → `FeeAddebito` → `FAILED` + `errorMessage`. (alert/N futuro).
  - `setup_intent.succeeded` → `Company.sepaMandateStatus=ACTIVE` (riconciliazione).
  - `setup_intent.setup_failed` → `Company.sepaMandateStatus=FAILED`.
  - default: log + `200` (ack, no-op).
- Ritorna sempre `200` sugli eventi gestiti con successo (evita retry Stripe).
- Local dev/test: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (lo `whsec_…` stampato va in `STRIPE_WEBHOOK_SECRET`).

---

## 6. env (`apps/piattaforma/src/env.ts`)

| Var | Tipo | Note |
|---|---|---|
| `PAYMENT_PROVIDER` | `'mock' \| 'stripe'` | esistente |
| `STRIPE_SECRET_KEY` | `string?` | esistente; **richiesto** quando provider=stripe (assert runtime in `getStripe()`) |
| `STRIPE_WEBHOOK_SECRET` | `string?` | **nuovo**; richiesto runtime nel webhook |

Aggiornare anche `.env.example` con le 2 chiavi Stripe e nota TEST mode. Publishable key **non** necessaria.

---

## 7. Aggancio registrazione — `app/(auth)/actions.ts` (`registerAction`)

Dopo il commit della transazione (accanto a promo/CRM/RegistroImprese), **solo se `company.type === 'AGENZIA'`** e `PAYMENT_PROVIDER==='stripe'`:
```ts
if (createdCompanyId && company.type === 'AGENZIA' && env.PAYMENT_PROVIDER === 'stripe') {
  try {
    const userAgent = hdrs.get('user-agent');
    const r = await setupSepaMandate({
      companyId, iban: payment.iban, name: company.ragioneSociale,
      email: company.email, ip: signupIpRaw, userAgent,
    });
    if (r.ok) {
      await prisma.company.update({ where: { id: companyId }, data: {
        stripeCustomerId: r.customerId, stripePaymentMethodId: r.paymentMethodId,
        sepaMandateId: r.mandateId, sepaMandateStatus: 'ACTIVE',
      }});
    } else {
      await prisma.company.update({ where: { id: companyId }, data: { sepaMandateStatus: 'FAILED' }});
      console.warn('[registrazione] setup mandato SEPA fallito', r.error);
    }
  } catch (e) { console.warn('[registrazione] setup mandato SEPA errore', (e as Error).message); }
}
```
- **Non blocca** la registrazione: un fallimento lascia `sepaMandateStatus=FAILED`, riparabile (admin/repair futuro).
- Con `PAYMENT_PROVIDER=mock` lo step è saltato (nessuna chiamata Stripe): l'agenzia resta `PENDING`, coerente con l'attuale comportamento.

---

## 8. UI wizard — `register-wizard.tsx` (`PaymentStep`)

`PaymentStep` riceve già il ruolo via `forcedCompanyType` / `data.company.type`. Rendere il testo **role-aware**:
- **AGENZIA**: testo mandato SEPA corretto — _"Autorizzo Passaggio Veloce S.r.l. ad **addebitare** il mio conto tramite addebito diretto SEPA (SEPA Direct Debit) per gli importi delle pratiche, secondo le condizioni del servizio. Il mandato potrà essere revocato secondo lo standard SDD."_ Rimuovere l'alert "mandato reale in Fase 5" (ora reale in test mode); eventualmente sostituirlo con nota "ambiente di test" se utile.
- **DEALER**: testo invariato (_"accrediti automatici"_ / IBAN per ricevere i payout); nessun mandato di addebito.

Lo schema `registerStep4PaymentSchema` (`iban: ibanItSchema`, `sepaMandateAccepted: z.literal(true)`) resta valido per entrambi i ruoli.

---

## 9. Flusso pratica — già cablato, si completa da sé

Esiste già: `pratica FIRMATA` → `FeeAddebito` `SCHEDULED` (`scheduledAt = autoAddebitoAt`: giorno 20 prod / +5min DEMO) + accredito wallet broker (N4). Con `PAYMENT_PROVIDER=stripe` i cron esistenti completano:
- `process-fee-scheduled` → `chargeFee` → PaymentIntent SEPA (esito via webhook).
- `trigger-auto-payout` → crea `Payout` al raggiungimento soglia.
- `process-payouts` → `executePayout` (no-op Strada B).

Modifica a `process-fee-scheduled.ts`: gestire `result.pending` → lasciare il fee in `IN_LAVORAZIONE` (non `SUCCESS`) demandando al webhook la chiusura.
Opzionale (polish, non bloccante): cablare la notifica **N8_AGENZIA_ADDEBITO** (oggi TODO nel job).

---

## 10. Idempotenza e correttezza denaro
- `setupSepaMandate`: idempotency key sul customer per evitare duplicati su retry registrazione.
- `chargeFee`: idempotency key `charge-fee:${feeAddebitoId}` → un retry non genera doppio addebito.
- Webhook: handler idempotenti (skip se lo stato è già finale).
- SEPA è asincrono: il **webhook è la fonte di verità** sull'esito; lo stato `IN_LAVORAZIONE` è il transitorio "in settlement".

---

## 11. Testing

### 11.1 Unit (vitest, Stripe client mockato)
- `stripe.test.ts`: `chargeFee` → ok+pending su `processing`; ok su `succeeded`; `ok:false` non-retryable se mandato non ACTIVE/ids mancanti; mapping errori.
- `stripe-mandate.test.ts`: compone i parametri SEPA corretti; ritorna ids; gestisce errore Stripe.
- `webhook` handler: firma invalida → 400; routing eventi → update corretti; idempotenza.
- `process-fee-scheduled` con `pending` → fee resta `IN_LAVORAZIONE`.

### 11.2 E2E manuale (test mode, con `stripe listen` attivo)
1. Registra **agenzia** → su Stripe test dashboard compaiono Customer + mandato; `Company.sepaMandateStatus=ACTIVE`, ids valorizzati.
2. Crea pratica (dealer) → assegnazione → firma agenzia → `FeeAddebito` SCHEDULED + wallet broker accreditato.
3. Trigger `process-fee-scheduled` (cron o chiamata manuale alla route; in DEMO countdown +5min) → PaymentIntent SEPA `processing` → webhook `succeeded` → fee `SUCCESS`.
4. Soglia raggiunta → `trigger-auto-payout` crea Payout → `process-payouts` → `executePayout` no-op → Payout `ESEGUITO`, wallet decrementato, `providerRef='manual-bonifico:…'`.

### 11.3 IBAN di test Stripe
Usare gli IBAN di test SEPA Stripe (es. successo `DE89370400440532013000`; varianti per fallimento/disputa) per simulare gli esiti. Per la UI con IBAN IT reali in test mode, l'esito si forza dal dashboard test.

---

## 12. Elenco file (change list)

**Nuovi:**
- `apps/piattaforma/src/lib/providers/payment/stripe-client.ts`
- `apps/piattaforma/src/lib/providers/payment/stripe.ts`
- `apps/piattaforma/src/lib/providers/payment/stripe-mandate.ts`
- `apps/piattaforma/src/app/api/webhooks/stripe/route.ts`
- test: `stripe.test.ts`, `stripe-mandate.test.ts`, `stripe-webhook.test.ts` (+ eventuale `process-fee-scheduled` pending)

**Modificati:**
- `packages/db/prisma/schema.prisma` (+ campi Company, enum `SepaMandateStatus`) + migration `add_stripe_sepa`
- `apps/piattaforma/src/lib/providers/payment/types.ts` (`PaymentResult.pending`)
- `apps/piattaforma/src/lib/providers/payment/index.ts` (`case 'stripe'`)
- `apps/piattaforma/src/lib/jobs/process-fee-scheduled.ts` (gestione `pending`)
- `apps/piattaforma/src/app/(auth)/actions.ts` (setup mandato post-commit, AGENZIA)
- `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (testo mandato role-aware)
- `apps/piattaforma/src/env.ts` (+ `STRIPE_WEBHOOK_SECRET`)
- `.env.example` (chiavi Stripe + nota TEST mode)
- `apps/piattaforma/package.json` (+ `stripe`)

---

## 13. Checklist go-live (denaro reale, fuori da questa fase)
- [ ] Account Stripe verificato + chiavi `sk_live`/`whsec_live`.
- [ ] Webhook endpoint registrato su dashboard Stripe (live).
- [ ] **Ri-raccolta mandati** agenzie (i mandati test non sono validi).
- [ ] `executePayout` Strada B reale: conferma admin manuale **o** generazione file SEPA XML (pain.001) per la banca PV.
- [ ] Creditor SEPA Identifier PV configurato.
- [ ] N8 addebito + alert su fee FAILED cablati.
- [ ] Validazione commercialista (B1) per la parte fiscale (documenti) — traccia separata.

---

## 14. Rischi e note
- **Webhook mancante in dev** → fee restano `IN_LAVORAZIONE`: richiede `stripe listen` durante i test. Documentato.
- **Payout no-op** (D7): in test mode segna `ESEGUITO` senza bonifico. Mitigazione: `providerRef='manual-bonifico:'` evidente + checklist go-live. Solo test mode, denaro finto.
- **IBAN server-side**: dati bancari (non PAN carta) → trattamento server-side ammesso da Stripe; accettazione mandato registrata come `online` con IP+user-agent (già catturati in registrazione).
- **Swap mock→stripe**: con `mock` tutto resta sospeso come oggi; il rischio è isolato dietro l'env `PAYMENT_PROVIDER`.
