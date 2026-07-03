# Tariffario piattaforma editabile dal backoffice

**Data:** 2026-07-03
**Stato:** design approvato, pronto per il piano di implementazione

## Obiettivo

Oggi i prezzi delle pratiche (fee agenzia + commissione broker + costo affiliazione)
per i tipi **SEMPLICE** e **MINIVOLTURA** sono hard-coded in `lib/pricing.ts`
(costante `PER_VEICOLO`) e ripetuti come testo in vari punti (chatbot KB, guide,
wizard, notifiche).

Vogliamo:

1. Una sezione nel **backoffice admin** dove modificare, per ciascun tipo, il
   **costo** (fee agenzia), la **commissione** (credito broker) e il **costo di
   affiliazione**, in base ad andamento del mercato e stagionalità.
2. Che ogni modifica si propaghi **ovunque** il dato compaia nell'applicativo.
3. Che **anche i bot** (chatbot LLM) prendano il dato aggiornato **in tempo reale**,
   senza rigenerare la KB né ri-deployare.

## Decisioni prese (brainstorming)

- **Parametri editabili per tipo:** costo agenzia + commissione broker + costo
  affiliazione. Il **ricavo lordo PV NON è un campo**: è sempre derivato come
  `feeAgenzia − creditoBroker`.
- **Timing:** modifica **immediata** (attiva da subito per le pratiche nuove) +
  **storico** delle versioni passate (audit chi/quando). Niente scheduling con
  date di validità futura (fuori scope, YAGNI).
- **Bot:** **iniezione live dal DB** nel system prompt del chatbot; i numeri fissi
  vengono rimossi dai markdown KB per avere un'unica fonte di verità.
- **Tier bot:** il blocco listino viene iniettato **solo nei tier `clients` e
  `internal`** (dove i numeri B2B già vivono), **non** nel tier `public`. I €75/€15
  sono fee B2B agenzia/broker e non vanno spacciati come prezzo al consumatore
  finale sul canale pubblico.

## Stato attuale del codice (mappa)

- **Fonte di calcolo:** `apps/piattaforma/src/lib/pricing.ts` — `PER_VEICOLO`
  (SEMPLICE 7500/2500/5000/1000 cent; MINIVOLTURA 1500/0/1500/500 cent) e
  `computeFees({ tipo, numeroVeicoli })` (funzione pura sincrona).
- **Chiamanti di `computeFees`:**
  - `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (~riga 1122): calcolo in
    creazione pratica → i valori vengono **congelati** su `Pratica.feeAgenziaCent`
    e `Pratica.creditoBrokerCent` (schema righe 738-739).
  - `apps/piattaforma/src/lib/affiliazione/accredit.ts` (~riga 75): calcolo del
    `costoAffiliazioneTotaleCent` all'accredito → snapshot su
    `CommissioneAffiliazione.importoLordoCent/importoNettoCent`.
  - `apps/piattaforma/src/app/affiliazione/page.tsx` (~riga 336): display derivato.
- **Snapshot già corretto:** le pratiche passate non cambiano al variare dei
  prezzi, perché fee/credito sono persistiti alla creazione. Da preservare.
- **Chatbot:**
  - KB generata staticamente: `apps/piattaforma/src/lib/providers/chatbot/kb/kb.generated.ts`
    (AUTO-GENERATO da `apps/piattaforma/scripts/build-chatbot-kb.ts` a partire dai
    markdown in `docs/*.md`; rigenera con `pnpm --filter piattaforma kb:build`).
  - Tier cumulativi via front-matter `chatbot_visibility: public|clients|internal`
    (`kb/assemble.ts`), esposti da `kbForTier(tier)` (`kb/index.ts`).
  - System prompt costruito in `kb/../llm.ts` `buildSystem(bot, kb)`; il dispatcher
    `chatbot/dispatch.ts` (~riga 30) chiama
    `respondWithLlm(bot, kbForTier(tier), history)`.
  - I numeri di costo pratica vivono oggi in `docs/kb-clienti.md`
    (`chatbot_visibility: clients`) e in altri doc dei tier clients/internal.
- **Backoffice admin:** sidebar in `apps/piattaforma/src/components/admin/admin-shell.tsx`
  (gruppi Panoramica / Operatività / Anagrafiche / CRM / Crescita / **Sistema**).
- **Attenzione:** `/admin/listini` è l'osservatorio listini agenzie, **feature
  parcheggiata (404, da non toccare)**. Il modello Prisma `Listino` è il listino
  retail delle agenzie: concetto **diverso** dalle fee di piattaforma. Non riusare.

## Architettura proposta

### 1. Modello dati — `TariffaPiattaforma`

Tabella **append-only versionata**: ogni riga è uno **snapshot completo** del
listino (entrambi i tipi). **Esattamente una riga `attivo=true`** rappresenta il
listino corrente. Salvare una modifica = inserire una nuova riga attiva e
disattivare la precedente (nessun update distruttivo → storico e audit gratis).

```prisma
model TariffaPiattaforma {
  id String @id @default(uuid()) @db.Uuid

  // SEMPLICE — per veicolo, in centesimi
  sempliceFeeAgenziaCent    Int
  sempliceCreditoBrokerCent Int
  sempliceAffiliazioneCent  Int

  // MINIVOLTURA — per veicolo, in centesimi
  minivolturaFeeAgenziaCent    Int
  minivolturaCreditoBrokerCent Int
  minivolturaAffiliazioneCent  Int

  attivo Boolean @default(false) // invariante: esattamente una riga true
  note   String?

  createdAt   DateTime @default(now())
  createdById String?  @db.Uuid
  createdBy   User?    @relation("TariffaCreatedBy", fields: [createdById], references: [id])

  @@index([attivo])
  @@index([createdAt])
  @@map("tariffe_piattaforma")
}
```

- Il **ricavo lordo PV** non è una colonna: derivato = `feeAgenzia − creditoBroker`.
- **Seed / migrazione dati:** inserire la riga iniziale attiva con i valori legacy
  (SEMPLICE 7500/2500/1000; MINIVOLTURA 1500/0/500). Va fatto sia nel `seed.ts` sia
  come step dati nella migration di prod (insert idempotente se la tabella è vuota).

### 2. Engine pricing (resta puro e testabile)

`lib/pricing.ts`:

```ts
export type PraticaTipoEconomico = 'SEMPLICE' | 'MINIVOLTURA';

export type TariffaUnit = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  affiliazioneCent: number;
};
export type Tariffario = Record<PraticaTipoEconomico, TariffaUnit>;

export const DEFAULT_TARIFFARIO: Tariffario = {
  SEMPLICE:    { feeAgenziaCent: 7500, creditoBrokerCent: 2500, affiliazioneCent: 1000 },
  MINIVOLTURA: { feeAgenziaCent: 1500, creditoBrokerCent: 0,    affiliazioneCent: 500 },
};

export function computeFees(
  input: { tipo: PraticaTipoEconomico; numeroVeicoli: number },
  tariffario: Tariffario,
): FeeBreakdown; // ricavoLordo derivato = fee − credito, tutto ×numeroVeicoli
```

- `computeFees` diventa **puro con tariffario esplicito** (nessun accesso DB dentro
  la funzione → resta unit-testabile).
- Nuovo modulo server `lib/pricing/tariffario.ts`:
  - `getTariffarioCorrente(): Promise<Tariffario>` — legge la riga `attivo=true`,
    fallback a `DEFAULT_TARIFFARIO` se assente. Avvolta in React `cache()` per
    dedup **per-request**. **Nessuna cache persistente** → il bot e l'app riflettono
    subito la modifica.
  - mapper riga DB ⇄ `Tariffario`.
- Aggiornare i 3 chiamanti: caricano `getTariffarioCorrente()` e lo passano a
  `computeFees(input, tariffario)`.
- **Nota timing affiliazione:** l'accredito usa il tariffario **al momento
  dell'accredito** (DOC_BROKER), non alla creazione pratica. È il comportamento
  attuale (`accredit.ts` già chiama `computeFees` all'accredito) e lo manteniamo:
  accettabile perché la finestra è breve e il valore viene comunque snapshot-ato
  in `CommissioneAffiliazione`. Da documentare, non da cambiare.

### 3. Sezione backoffice — `/admin/tariffe`

- **Route nuova** `apps/piattaforma/src/app/admin/tariffe/page.tsx` (NON `/admin/listini`).
- **Voce sidebar** "Tariffe" nel gruppo **Sistema** di `admin-shell.tsx`, `adminOnly: true`.
- **Permessi:** `isAdminPiattaforma(session.user.role)` (stesso gate delle altre
  sezioni admin-only). Reject non-admin.
- **Server component** carica: tariffario corrente + storico (ultime N versioni con
  `createdBy`/`createdAt`). Usa `AdminShell`.
- **Form (client)** con 6 input in **euro** (convertiti in centesimi al submit),
  raggruppati SEMPLICE / MINIVOLTURA, con **ricavo lordo derivato mostrato live**
  mentre si digita.
- **Server action** `salvaTariffario`:
  - Valida: interi ≥ 0; per ogni tipo `creditoBrokerCent ≤ feeAgenziaCent` (lordo ≥ 0).
  - In transazione: `updateMany({ attivo: true } → { attivo: false })` + `create`
    nuova riga `attivo: true` con `createdById = session.user.id`.
  - `revalidatePath` dei path che mostrano prezzi (es. `/admin/tariffe`,
    `/affiliazione`, wizard) — la freschezza dei bot è già garantita (no cache).
- **Pannello storico:** tabella versioni passate (valori + chi + quando), sola lettura.
- **Feedback UI:** coerente con le convenzioni esistenti (SubmitButton/spinner,
  LoadingOverlay dove serve — vedi memoria feedback caricamento).

### 4. Propagazione ai bot (iniezione live)

- Nuovo `buildListinoBlock(tariffario): string` (in `chatbot/kb/` o `chatbot/`):
  genera un blocco testo autorevole, es.:

  ```
  LISTINO UFFICIALE (fonte autorevole, aggiornato):
  - Passaggio SEMPLICE: costo agenzia €X, commissione broker €Y per veicolo.
  - Minivoltura: costo agenzia €Z, commissione broker €0 per veicolo.
  ```

- `dispatch.ts`: quando `tier ∈ {clients, internal}`, carica
  `getTariffarioCorrente()` e passa il blocco a `respondWithLlm`. Per `tier=public`
  **non** iniettare il blocco.
- `llm.ts` `buildSystem`: aggiunge il blocco listino come **system block separato,
  NON cached** (la KB grande resta con `cache_control: ephemeral`; il listino
  piccolo cambia e sta fuori dalla cache), con istruzione esplicita:
  *"Per costi e commissioni delle pratiche usa SEMPRE il LISTINO UFFICIALE qui
  sotto: prevale su qualsiasi importo presente nella knowledge base."*
- **Scrub KB:** rimuovere/neutralizzare i numeri fissi di **costo pratica e
  commissione** nei markdown KB dei tier clients/internal (es. `docs/kb-clienti.md`),
  sostituendoli con rimando al listino ufficiale. Lasciare invariati altri importi
  non-listino (penali €25, soglia payout €500/€1.000, ecc.). Poi rigenerare con
  `pnpm --filter piattaforma kb:build` e committare `kb.generated.ts`.

### 5. Test

- `lib/pricing.test.ts`: aggiornato per passare il tariffario esplicito; verifica
  la derivazione del ricavo lordo; verifica che `DEFAULT_TARIFFARIO` produca i
  valori legacy (75/25/50/10 e 15/0/15/5) — evita regressioni economiche.
- `lib/pricing/tariffario.test.ts`: `getTariffarioCorrente` legge la riga attiva;
  fallback a `DEFAULT_TARIFFARIO` quando la tabella è vuota; mapping DB⇄Tariffario.
- Test `buildListinoBlock`: rende i valori correnti; formattazione euro.
- Test server action `salvaTariffario`: validazione (rifiuta credito > fee, valori
  negativi); crea nuova riga attiva e disattiva la precedente (una sola attiva).
- Dispatcher: il blocco listino viene iniettato per clients/internal e **non** per
  public (aggiornare/estendere `dispatch.test.ts`).

## Fuori scope (non implementare ora)

- Scheduling con date di validità futura (listini stagionali auto-attivanti).
- Editabilità del ricavo lordo come campo indipendente.
- Prezzi consumer/retail sul canale pubblico del chatbot.
- Ripristino dell'osservatorio `/admin/listini`.

## Rischi / note

- **Numeri fissi residui altrove:** wizard nuova pratica, pagine `guide/`, dashboard
  e `notifiche/templates.ts` possono contenere importi hard-coded. Durante il piano
  va fatto un censimento: quelli che rappresentano il listino vanno derivati da
  `getTariffarioCorrente()`/`computeFees`; quelli consumer/statici restano.
- **Invariante "una sola riga attiva":** garantita a livello applicativo dalla
  server action in transazione (non da un constraint DB parziale, per semplicità).
- **`computeFees` diventa chiamato in contesti async:** i 3 call site sono già in
  funzioni async (server actions / accredit) → nessun problema.
