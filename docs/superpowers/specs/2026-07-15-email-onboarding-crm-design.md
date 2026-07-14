# Email di partenza CRM — onboarding broker/agenzia con codice welcome

**Data:** 2026-07-15
**Autore:** Francesco Sioli (CTO) + Claude
**Stato:** Design approvato, pronto per piano di implementazione

## Problema

Il go-to-market è telefonico: chiamiamo un potenziale cliente (broker o
agenzia), spieghiamo il servizio e, se interessato, vogliamo mandargli
**subito** un'email che gli dia tutto il necessario per registrarsi in
autonomia. Oggi manca il gesto: dopo la telefonata non c'è un bottone che
mandi al cliente il link giusto, con la checklist di cosa serve e — se
deciso in quel momento — un codice di benvenuto già incluso.

La telefonata ha già venduto. L'email **non rivende**: ricorda chi siamo,
dice cosa tenere a portata di mano, e porta a un click che precompila la
registrazione.

## Cosa esiste già (e che riusiamo)

- **Il lead**: modello `CrmContact` (`packages/db/prisma/schema.prisma:1839`)
  con categoria `cat` BROKER/AGENZIA, `email`, `tel`, pipeline `status`
  S0→S10. La telefonata "interessato" è lo stato **S3**.
- **Campi funnel già presenti ma oggi finti**: `linkInviato`, `linkInviatoAt`,
  `linkAperto`, `linkAperture` sono checkbox compilate a mano nel form di
  modifica contatto (`admin/crm/contatti/client.tsx:1248`). Nessuna riga di
  codice li scrive. Questa feature li rende reali.
- **Il pattern del link tracciato**: l'affiliazione usa `/r/[code]`
  (`app/r/[code]/route.ts`) → logga il click → `redirect 302` verso
  `/register?ref=<code>`. Lo imitiamo pari pari.
- **Il codice welcome è un `PromoCode`** (`schema.prisma:2054`), già gestito
  in `/admin/codici-promozionali` (credito in € sul wallet). Lo stato valido è
  derivato a runtime da `evaluatePromoCode()` (`lib/promo/evaluate.ts:18`).
  Riscattato allo step 4 del wizard (`register-wizard.tsx:980`) via
  `redeemPromoCode()` (`lib/promo/redeem.ts:13`), post-commit best-effort.
- **`sendNotification`** (`lib/notifiche/send.ts:268`) accetta un `Target =
  { email, userId?, companyId? }`: si può mandare a un lead **senza account** e
  avere comunque l'audit su `NotificaInviata`.
- **Layout istituzionale** (`lib/notifiche/layout.ts:71`) con footer che ha già
  `assistenza@passaggioveloce.it`, telefono e sito. `ctaButton()` per la CTA.
- **Ruolo SALES** già scoping-ato: `canEditCrmContact` + regola "solo i
  contatti a me assegnati" (`admin/crm/contatti/actions.ts:247`).

## Decisioni prese in brainstorming

1. **Punto d'invio**: solo dalla riga contatto in `/admin/crm/contatti`. Il
   lead deve esistere (form di creazione già presente). Niente creazione al
   volo, niente invio libero.
2. **Tracking**: minimo, riusando `NotificaInviata` come storico. Nessuna
   tabella nuova. 3 colonne su `CrmContact`.
3. **Contenuto**: la frase di contesto broker/agenzia è fissa (nessun campo di
   testo libero al momento dell'invio).
4. **Reply-To**: no-reply istituzionale; i contatti stanno già nel footer.
5. **Nessuna anteprima nel modale d'invio** (si taglia dal primo giro).
6. **Nessun invio in massa**: solo il tasto per riga. Uso a discrezione
   dell'admin (accesso ristretto alla pagina). Il bulk resta deliberatamente
   non implementato.

## L'email (contenuto)

Un solo template, parametrizzato broker/agenzia. Oggetto:
**"Passaggio Veloce — il link per registrarti"**. Layout `emailLayout`, CTA
arancione (`ctaButton`), footer legale + contatti + unsubscribe.

```
Buongiorno {nomeReferente},

come d'accordo nella nostra telefonata, ecco il link per attivare
{ragioneSociale} su Passaggio Veloce. Bastano circa 5 minuti.

   {frase di contesto broker/agenzia}

            [ {CTA} ]     ← link tracciato /i/<token>

── Cosa tenere a portata di mano
   • Carta d'identità e tessera sanitaria del titolare (fronte e retro)
   • Visura camerale in PDF (dal Registro Imprese)
   • P.IVA, PEC, codice SDI e regime fiscale
   • IBAN aziendale

── [blocco SOLO se è stato scelto un codice]
   🎁  Hai {importo} € di credito di benvenuto.
       Il codice {CODE} è già incluso nel link: lo troverai precompilato
       all'ultimo passaggio, non devi ricordartelo.

Per qualsiasi cosa trovi i nostri contatti qui sotto.
```

La checklist "cosa tenere a portata di mano" rispecchia i documenti realmente
richiesti in registrazione (step 3 KYC + step 2 azienda + step 4 pagamento):
CI fronte/retro, tessera sanitaria/CF fronte/retro, visura camerale PDF, P.IVA,
PEC, codice SDI, regime fiscale, IBAN.

**Differenze broker vs agenzia** (il resto è identico):

| | Broker (concessionaria) | Agenzia pratiche |
|---|---|---|
| `{CTA}` | "Registra la tua concessionaria" | "Registra la tua agenzia" |
| Destinazione redirect | `/register/dealer` | `/register/agenzia` |
| `{frase di contesto}` | "Carichi la pratica in 2 minuti, un'agenzia della tua zona la prende in carico e la segui in tempo reale." | "Ricevi pratiche già complete e verificate dalla tua provincia, e decidi tu quali accettare." |

Il tipo (broker/agenzia) è deciso da `CrmContact.cat`, non chiesto all'admin.

**Nessun numero di vendita nell'email** (prezzi, soglie payout): la landing e i
Termini oggi si contraddicono sulla soglia payout (1.000€ vs 500€) — l'email non
deve propagare il disallineamento. *(Nota fuori scope: segnalare a parte la
discordanza landing `page.tsx:183` vs Termini per bonificarla.)*

## UX — il gesto dell'admin

Sulla riga del contatto in `/admin/crm/contatti`, nuova azione **"Invia email
di partenza"**. Apre un modale minimale, senza scrittura libera:

1. **A chi**: `contact.email`, sola lettura. Se il contatto non ha email, il
   bottone è **disabilitato** con tooltip "manca l'email".
2. **Nome referente**: precompilato con `contact.nome`, **editabile** — `nome`
   può essere una ragione sociale ("Autosalone Rossi Srl") o un nominativo, per
   ambiguità nota dell'import CSV (`lib/crm/csv-import.ts:105`). L'admin, che ha
   la persona al telefono, è la fonte più affidabile.
3. **Codice di benvenuto**: select dei `PromoCode` **validi** (attivi, non
   scaduti, non esauriti — filtro coerente con `evaluatePromoCode`), con
   importo accanto ("BENVENUTO50 — 50 €"). **Default: nessun codice** (regalare
   credito è una scelta consapevole, non un click distratto).

Bottone **Invia**. Nessuna anteprima.

**Guardrail:**
- Se già inviata (`linkInviato=true`), il bottone/etichetta diventa "Reinvia" e
  il modale mostra lo stato ("già inviata il {data}, {aperta/mai aperta}").
- Se il lead si è disiscritto (`emailOptOutAt` valorizzato), l'invio è bloccato.

**Permessi**: stesso guard di `updateCrmContactAction` — `canEditCrmContact`, e
un utente `SALES` può inviare solo ai contatti a lui assegnati.

## Effetti sulla pipeline (finalmente automatici)

| Evento | Effetto su `CrmContact` |
|---|---|
| Invio riuscito | `linkInviato=true`, `linkInviatoAt=now`, `promoCodeInviatoId=…`, `invitoToken=…`; `status` → **S4** solo se attuale ∈ {S0,S1,S2,S3} (mai declassa da stati più avanzati) |
| Cliente clicca il link | `linkAperto=true`, `linkAperture++`, `status` → **S5** solo se attuale ∈ {S4} (o comunque ≤ S5) |
| Cliente completa iscrizione | gestito da `lib/crm/sync.ts` (match email→tel→P.IVA) → S6/S7 come oggi |

Le transizioni di stato usano una regola "avanza-non-declassa": si applica il
nuovo stato solo se rappresenta un avanzamento nel funnel, mai un passo
indietro.

## Cosa cambia sotto — architettura

### 1. Migration Prisma — 4 colonne su `CrmContact`

```prisma
invitoToken        String?   @unique   // token opaco del link /i/<token>, riscritto a ogni reinvio
emailUnsubToken    String?   @unique   // token STABILE per l'unsubscribe del lead
promoCodeInviatoId String?             // ultimo PromoCode inviato (relazione)
emailOptOutAt      DateTime?           // disiscrizione del lead → blocca invii
```

`invitoToken`: generato all'invio (es. `crypto.randomUUID()` o token base64url
casuale), unico, riscritto a ogni (re)invio. Il codice **non viaggia** nel link:
si risolve server-side da `promoCodeInviatoId`. Reinviare con un codice diverso
aggiorna anche il vecchio link ancora nella casella del cliente.

`emailUnsubToken`: generato **una volta** al primo invio e **mai riscritto**,
così il link di disiscrizione resta valido anche in email vecchie dopo un
reinvio (l'`invitoToken` no: cambia, quindi non va usato per l'unsub).

Relazione opzionale `promoCodeInviato PromoCode? @relation(...)` +
back-relation su `PromoCode`. Migration a mano + `db:deploy` (mai
`migrate dev`: proporrebbe DROP — vedi memoria "prisma migrate distruttivo").

### 2. Route handler `/i/[token]` — gemella di `/r/[code]`

`app/i/[token]/route.ts`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

- Lookup `CrmContact` per `invitoToken`.
- Se trovato: best-effort marca `linkAperto=true`, `linkAperture++`, avanza
  `status` a S5 (regola avanza-non-declassa). Errore nel tracking **non**
  blocca il redirect (come `/r`).
- Risolve `promoCodeInviatoId` → `code` (se ancora valido).
- Redirect `302` a `/register/dealer` o `/register/agenzia` (in base a `cat`)
  con `?promo=<code>` se presente. Se token invalido: redirect a `/register`
  neutro (non si rompe nulla), coerente col comportamento tollerante di `/r`.

Path `/i/` scelto per non collidere con `/invito/[token]` (inviti di team, già
esistente) né con `/r/` (affiliazione).

### 3. Wizard — leggere `?promo=` e auto-applicare

`register-wizard.tsx` legge già `?ref=` (`:101`). Aggiungere lettura di
`?promo=`. Poiché il campo promo allo step 4 richiede oggi il click su "Applica"
(`:988`), va aggiunta un'**auto-validazione su mount** quando `?promo=` è
presente: precompila lo state `promoCode` ed esegue `checkPromoCodeAction`
automaticamente, così all'ultimo passaggio il cliente trova già
"✓ {CODE} applicato — {importo} € di credito" senza dover fare nulla.

Il **riscatto effettivo resta invariato** (`redeem.ts`, post-commit): questa
feature tocca solo la *precompilazione*, non la meccanica del credito.

Il redirect di `/i/` punta direttamente a `/register/dealer|agenzia`, quindi il
`?promo=` arriva dritto al wizard montato con `forcedCompanyType` (salta la
pagina di scelta, che non ripropaga i param).

### 4. Nuova notifica N26

Nuovo `NotificaTipo` **N26** (numero libero) — i 4 tocchi consueti:
1. enum in `schema.prisma:289` (+ migration)
2. `type N26EmailPartenzaPayload` + `tplN26EmailPartenza()` in `templates.ts`
   (parametrizzato broker/agenzia + blocco codice condizionale)
3. variante nella union `SendInput` (`send.ts:79`)
4. `case` nello switch `render()` (`send.ts:197`)

Payload: `{ nomeReferente, ragioneSociale, categoria: 'BROKER'|'AGENZIA',
linkUrl, codice?: { code, importoEuro } }`. L'audit di ogni invio (destinatario,
oggetto, data, payload col codice) finisce in `NotificaInviata`: **è lì lo
storico**, nessuna tabella dedicata.

Questa notifica è **transazionale/commerciale a freddo**: NON passa dal gating
preferenze (che richiede `userId`, assente per un lead). Il footer unsubscribe
va però garantito comunque (punto 6).

### 5. Server action d'invio

`sendEmailPartenzaAction(contactId, { nomeReferente, promoCodeId? })` in
`admin/crm/contatti/actions.ts`:
- Guard `canEditCrmContact` + scoping SALES (come `updateCrmContactAction`).
- Carica contatto; errore se manca email o se `emailOptOutAt` valorizzato.
- Se `promoCodeId`: rivalida con `evaluatePromoCode` (il codice potrebbe essere
  stato disattivato tra apertura modale e invio) → 'valido' obbligatorio.
- Genera/riscrive `invitoToken`; costruisce `linkUrl = {BRAND.url}/i/{token}`.
- `sendNotification({ tipo: 'N26...', target: { email }, payload })`.
- Su esito email OK: aggiorna `linkInviato`, `linkInviatoAt`,
  `promoCodeInviatoId`, `invitoToken`, avanza `status` a S4
  (avanza-non-declassa). `revalidatePath`.

### 6. Unsubscribe per lead

`app/unsubscribe/page.tsx` (`:14`) oggi cerca solo `User.unsubscribeToken`.
Aggiungere un ramo: se il token non matcha uno `User`, cercarlo su
`CrmContact.emailUnsubToken` (token **stabile**, non l'`invitoToken` che cambia
a ogni reinvio) → valorizza `emailOptOutAt`. Il footer di N26 include **sempre**
il link di
disiscrizione, indipendentemente dalle preferenze utente (che per un lead non
esistono). Questo copre l'obbligo di opt-out sull'unica email commerciale a
freddo che mandiamo.

## Unità e confini

- **Route `/i/[token]`**: input = token in URL; output = redirect + side-effect
  di tracking best-effort. Testabile in isolamento (token valido/invalido/
  scaduto → destinazione + stato contatto atteso).
- **`sendEmailPartenzaAction`**: input = (contactId, nomeReferente, promoCodeId?)
  + sessione; output = invio + mutazione contatto. Confini: permessi, validità
  codice, presenza email, opt-out.
- **`tplN26EmailPartenza`**: funzione pura payload → `{subject, html, text}`.
  Testabile senza I/O (broker vs agenzia, con/senza codice).
- **Auto-apply promo nel wizard**: isolato dietro presenza di `?promo=`; non
  tocca il resto del wizard né il riscatto.

## Testing

- **Unit puro** `tplN26EmailPartenza`: 4 combinazioni (broker/agenzia ×
  con/senza codice) — subject, presenza CTA giusta, blocco codice condizionale,
  link corretto.
- **Route `/i/[token]`**: token valido broker → redirect `/register/dealer?promo=`
  + stato S5; token valido senza codice → nessun `?promo=`; token invalido →
  `/register` neutro; verifica avanza-non-declassa.
- **`sendEmailPartenzaAction`** (Prisma mockato + query reale in read-only sul DB
  locale per la select codici, da memoria "query su DB reale"): email mancante →
  errore; opt-out → bloccato; codice non più valido → errore; happy path →
  mutazioni attese.
- **Auto-apply wizard**: verifica su DOM/gesto (da memoria "verifica sul DOM"):
  `?promo=CODE` → allo step 4 il codice risulta già applicato senza click.
- **Unsubscribe lead**: token contatto → `emailOptOutAt` valorizzato; invio
  successivo bloccato.

## Fuori scope (YAGNI)

- Invio in massa / selezione multipla.
- Anteprima dell'email nel modale.
- Pixel di apertura email (`mailAperta` resta manuale come oggi).
- Campo di testo libero personalizzato per invio.
- Tabella `CrmInvito` dedicata / timeline multi-invio.
- Scadenza/revoca esplicita del link invito.
- Reply-To verso l'operatore.

## Rischi e note

- **Discordanza soglia payout** landing vs Termini: non introdotta nell'email
  (nessun numero), ma da bonificare a parte.
- **GDPR email commerciale a freddo**: l'unsubscribe per lead (punto 6) è
  requisito, non opzionale. Il footer deve avere il link sempre.
- **Migration in prod**: a mano + `db:deploy`, mai `migrate dev` (distruttivo).
- **Token unsub stabile**: risolto — `emailUnsubToken` separato e mai
  riscritto, così un link di disiscrizione in un'email vecchia resta valido
  anche dopo un reinvio (l'`invitoToken` cambia a ogni reinvio e non va usato
  per l'unsub).
