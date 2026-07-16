# Ciclo di vita della visura camerale — design

**Data:** 2026-07-16
**Stato:** approvato in brainstorming, da implementare
**Fonte:** flusso definito da Francesco con Alberto e Andrea, più le decisioni prese in sessione.

## Obiettivo

La visura camerale serve a Passaggio Veloce per **fatturare correttamente** a broker e agenzie.
Una visura vecchia certifica dati che potrebbero non essere più veri (ragione sociale, sede
legale). Oggi la visura viene controllata **solo in registrazione**, e poi mai più: un'azienda
può operare per anni su una visura del 2024. Questo design introduce un **ciclo di vita** della
visura, con validità di 180 giorni, preavviso, aggiornamento e conseguenze differenziate.

## La regola — fonte unica

Nuovo modulo puro `lib/visura/validita.ts`:

```ts
export const VISURA_VALIDITA_GIORNI = 180;
export const PREAVVISO_GIORNI = 5;

giorniTrascorsi(emissione: Date, oggi: Date): number
isVisuraScaduta(emissione: Date, oggi: Date): boolean   // giorniTrascorsi >= 180
isInPreavviso(emissione: Date, oggi: Date): boolean      // 175 <= giorniTrascorsi <= 179
```

- **Scaduta ⟺ `giorniTrascorsi >= 180`** (il giorno 180 è già scaduto).
- **Preavviso ⟺ giorni 175→179** (5 giorni, coerente con `180 − 5`).
- Confronto a **granularità di giorno**: `visuraCameraleData` è `@db.Date`. Il "giorno di oggi"
  va preso con `lib/date/rome-day.ts` (helper esistente), **non** con la mezzanotte UTC:
  l'azienda opera in Italia e una notte di differenza sposta il confine di un giorno intero.

Questa costante è l'**unica** fonte. Vanno eliminate le due divergenti di oggi:

| Dove | Oggi | Destino |
|---|---|---|
| `lib/kyc/verify.ts:11` | `VISURA_MAX_AGE_MONTHS = 5` | **rimossa** (punto 1) |
| `lib/auth/document-validation.ts:27` | `VISURA_MAX_AGE_MONTHS = 6` | **rimossa** — è codice morto |

`validateVisuraData` (`document-validation.ts:49`) è chiamata **solo dal suo test**: nessun
consumatore in produzione (verificato con grep). Va via insieme a `subtractMonthsUtcDay` e ai
relativi test. `isVisuraDateValid` resta solo se serve altrove, altrimenti va via anch'essa:
con i giorni netti l'aritmetica sui mesi non serve più.

## Nessuna migration

Il blocco è **derivato**: `Company.visuraCameraleData` + oggi. Nessun flag, nessuna colonna,
nessun job che mantenga lo stato allineato, nessuna deriva possibile. Lo sblocco è gratis:
salvata la nuova data, il blocco cade da solo.

Verificato sul DB reale:
- `companies.visuraCameraleData` (`date`) **esiste già** ed è popolata in registrazione.
- `documenti` **non ha vincoli unique** su `(companyId, tipo)` — solo btree semplici. Più righe
  `VISURA_CAMERALE` per azienda sono già ammesse: *add non replace* funziona nativamente.
- `documenti.createdAt` dà l'ordine ("l'ultimo foglio vince"), `deletedAt` va filtrato.

Uniche eccezioni: i nuovi tipi di `NotificaTipo` (enum Prisma) richiedono una migration.

---

## Punto 1 — Registrazione: nessun blocco sulla data

**Rimuovere** da `lib/kyc/verify.ts`:
- la regola `VISURA_SCADUTA` e il ramo `if (args.company.type === 'DEALER' && ...)` (righe 86-89)
- la costante `VISURA_MAX_AGE_MONTHS = 5`

**Restano tutti gli altri gate**, per entrambi i tipi:

| Regola | Perché resta |
|---|---|
| `ATECO_NON_IDONEO` | è l'unico blocco richiesto: ATECO da backoffice, per categoria |
| `AZIENDA_MISMATCH` | senza, chiunque si registra con la visura pubblica di un'altra azienda |
| `CI_MISMATCH` / `CF_MISMATCH` | legano chi si registra all'amministratore che risulta in visura |
| `ILLEGGIBILE` | **senza data leggibile non c'è ciclo**: è un blocco sulla leggibilità, non sulla data |

> **Decisione esplicita.** "L'unico blocco riguarda l'ATECO" è stato chiarito come *"l'unico
> blocco **legato alla data**"*. I controlli d'identità restano: rimuoverli aprirebbe una frode
> d'identità (le visure sono documenti pubblici acquistabili per pochi euro) e porterebbe a
> fatturare a soggetti che non hanno mai aderito.

**La data continua a essere salvata** su `visuraCameraleData` (comportamento già presente,
`app/(auth)/actions.ts:483`), per entrambi i tipi.

**Visura già ≥ 180 giorni al momento della registrazione:** non blocca, ma **avvisa**.
Conseguenza logica di "niente blocco su data" + "blocco duro a 180": un'agenzia può iscriversi
e risultare bloccata dal primo minuto, senza aver mai ricevuto un preavviso (finestra 175-179
già passata). L'avviso deve dire chiaramente cosa succederà.

> **Da decidere in fase di piano.** Il server conosce l'età della visura solo *dopo* il submit
> (l'OCR gira dentro la register action). Quindi:
> - **opzione economica**: avviso nella schermata di esito registrazione + banner al primo accesso;
> - **opzione fedele** ("in fondo allo step 3"): richiede una chiamata OCR di *pre-flight* prima
>   del submit → un'estrazione Document AI in più per ogni registrazione.
>
> Valutare il costo OCR. Il banner al primo accesso compare comunque, in automatico.

---

## Punto 2 — Ciclo 180 giorni e aggiornamento

Vale per **entrambi** i tipi (broker e agenzia).

### Sezione di aggiornamento

Nuova route (proposta: **`/visura`**), raggiungibile da entrambi i tipi e dal banner.
**Solo il titolare** (`ADMIN_AZIENDA`, via `isOwner`) può caricare: la visura è un atto
anagrafico dell'azienda, coerente con la linea owner-only già adottata per l'IBAN.
Gli altri utenti vedono la sezione in sola lettura ("contatta il titolare").

### Controlli sul documento caricato

Stesse letture OCR della registrazione (`extractVisura`, `lib/kyc/visura-parser.ts`):

1. **Leggibilità** — campi chiave estraibili, altrimenti rifiuto (come `ILLEGGIBILE`).
2. **`AZIENDA_MISMATCH`** — P.IVA / ragione sociale devono corrispondere a **questa** azienda.
3. **Età** — la nuova visura deve avere `giorniTrascorsi < 180`, altrimenti non sblocca nulla.
4. **ATECO non più ammesso → NON blocca**: la visura viene accettata (data aggiornata, blocco
   rimosso) e viene **segnalato all'admin** (N49). Bloccare qui creerebbe un vicolo cieco:
   l'azienda resterebbe bloccata senza alcuna via d'uscita autonoma.

**Niente cross-match CI/CF** in aggiornamento: l'amministratore può essere legittimamente
cambiato in 180 giorni, e rifiutare una visura nuova perché l'admin non è più quello della
registrazione sarebbe un falso positivo. (In registrazione il cross-match resta.)

### Cosa aggiorna

| Campo | Azione |
|---|---|
| `visuraCameraleData` | **sempre** sovrascritta con la nuova data di emissione |
| `ragioneSociale` | aggiornata se cambiata (finisce in fattura) |
| sede legale (`indirizzo`, `civico`, `cap`, `citta`, `provincia`) | aggiornata se cambiata |
| **`partitaIva`** | **MAI** — una P.IVA diversa è un altro soggetto: quello è `AZIENDA_MISMATCH`, non un aggiornamento |
| `regimeFiscale` | **MAI** — non è un dato camerale, è una scelta fiscale |

> ⚠️ I dati aggiornati finiscono su **fatture elettroniche numerate e trasmesse a SdI**. Un OCR
> sbagliato che riscrive la ragione sociale è un problema fiscale, non estetico. Limitare la
> superficie ai due campi sopra è deliberato.

### Storico documenti — add, non replace

Ogni caricamento **aggiunge** una riga `Documento` (`tipo = VISURA_CAMERALE`, `companyId`).
Le precedenti **restano**. La visura "che conta" è la più recente:
`ORDER BY createdAt DESC` con `deletedAt IS NULL`.

> ⚠️ **Le visure storiche non vanno mai soft-deletate.** Esiste il cron
> `purge-deleted-documenti`: un `deletedAt` valorizzato equivale a cancellarle definitivamente.

---

## Punto 3 — Preavviso email

**Cron giornaliero** `/api/jobs/preavviso-visura` (decimo cron). In `vercel.json` ci sono già
**9 cron giornalieri**, ben oltre il limite del piano Hobby (2): il progetto è quindi su Pro e
un decimo cron non pone problemi di piano. *(Dedotto dalla config, non verificato sul billing:
confermare prima di dare per scontato lo slot.)*

Nuovi `NotificaTipo`:

| Tipo | Quando | Destinatari | Frequenza |
|---|---|---|---|
| `N46_VISURA_IN_SCADENZA` | giorni **175→179** | broker **e** agenzia | **1 al giorno** → 5 email |
| `N47_VISURA_SCADUTA` | giorno **≥ 180** | broker **e** agenzia | **una sola volta** per data visura |
| `N48_BROKER_PRATICA_CONGELATA` | agenzia bloccata con pratiche in volo | broker della pratica | una volta per pratica/ciclo |
| `N49_ADMIN_ATECO_NON_IDONEO` | aggiornamento con ATECO non ammesso | admin piattaforma | a evento |

**Destinatario** = email dell'`ADMIN_AZIENDA` attivo, letta **dal DB** (mai `session.user.email`
né `Company.email`) — come fa già `lib/fee/blocco.ts:33-38`.

**Tutte transazionali, non opzionali.** Non vanno in `isOptionalTipo`: un avviso che precede la
sospensione dell'operatività non è marketing, e un utente non deve potersi disiscrivere dal
preavviso e poi ritrovarsi bloccato senza saperlo.

### Idempotenza — obbligatoria

`sendNotification` **non deduplica**: crea una riga `NotificaInviata` e spedisce, a ogni
chiamata. Un cron giornaliero senza guardia manderebbe la stessa email ogni giorno.

L'ancoraggio è la **data della visura**, così un nuovo caricamento **riarma da solo** il ciclo
(data diversa → nessun match → gli avvisi ripartono), senza stato da resettare.
`notifiche_inviate.payload` è **jsonb** (verificato), quindi l'anti-join è possibile:

- **N46**: invia se `175 ≤ età ≤ 179` **e** non esiste già un N46 con
  `payload->>'visuraData' = visuraCameraleData` **per la giornata odierna**.
- **N47 / N48**: invia se `età ≥ 180` **e** non esiste già un N47/N48 con quella `visuraData`.
  Ancorare all'`>=` e non all'uguaglianza esatta è deliberato: con `età == 180` esatto, un cron
  saltato (deploy, outage) significherebbe **nessuna email, mai**.

Forma della query, validata sul DB reale:

```sql
WHERE c.type IN ('DEALER','AGENZIA')
  AND c."visuraCameraleData" IS NOT NULL
  AND (:oggi - c."visuraCameraleData") BETWEEN 175 AND 179
  AND NOT EXISTS (
    SELECT 1 FROM notifiche_inviate n
    WHERE n."companyId" = c.id
      AND n.tipo = 'N46_VISURA_IN_SCADENZA'
      AND n.payload->>'visuraData' = c."visuraCameraleData"::text
      AND n."scheduledAt"::date = :oggi
  );
```

Payload N46/N47: `{ visuraData, giorniTrascorsi, giorniRimanenti }`.

---

## Punto 4 — Conseguenze della scadenza

Non è un lockout con redirect: l'utente **naviga la piattaforma e vede un banner**; sono le
**azioni** a essere bloccate.

### Broker (`DEALER`) — payout disabilitato

- Guard in `lib/wallet/payout-exec.ts` su **`eseguiPayoutImmediato`** (:135) e
  **`settlePayout`** (:47), più il cron `trigger-auto-payout`.
- La UI `/wallet` mostra il payout disabilitato con la ragione.
- **Il broker continua a operare**: crea e gestisce pratiche normalmente.

### Agenzia (`AGENZIA`) — operatività bloccata

- **Non gestisce pratiche**: guard nelle Server Actions, negli stessi punti dove è già
  agganciato `isAgenziaBloccata` — `app/pratiche/actions.ts:39`, `app/inbox/actions.ts:33`,
  `lib/pratiche/firma-engine.ts:164`.
- **Non riceve nuove pratiche**: `lib/distribuzione/tick.ts:164`. I candidati sono **SEDI**
  filtrate per madre; la visura sta sulla madre, quindi tutte le sedi escono insieme
  (coerente col multi-sede). Filtro:

  ```ts
  company: {
    deletedAt: null, suspendedAt: null, bloccoPagamentoAt: null,
    OR: [
      { visuraCameraleData: null },                    // null = esente
      { visuraCameraleData: { gt: limiteVisura } },    // limiteVisura = oggi − 180gg
    ],
  }
  ```

  Verificato sul DB reale: esclude la sola agenzia scaduta, lascia idonee le altre.
- **Non esegue payout**: stesse guard del broker.

### Pratiche già in volo — congelate

Le pratiche già assegnate **restano assegnate** ma non sono lavorabili. Il **broker** della
pratica riceve `N48` per sapere perché la sua pratica è ferma. Non vengono riassegnate.

> ⚠️ **Conseguenza accettata consapevolmente:** il cliente finale attende un passaggio di
> proprietà fermo per un adempimento burocratico dell'agenzia. Va tenuto d'occhio: se capitasse
> spesso, la riassegnazione automatica diventa la scelta giusta.

### Banner

| Stato | Banner | Chi |
|---|---|---|
| giorni **175→179** | **giallo**, countdown "la visura scade fra N giorni" + CTA aggiorna | broker + agenzia |
| giorni **≥ 180** | **rosso**, spiega *perché* le operazioni sono bloccate + CTA aggiorna | broker + agenzia |

Il banner rosso deve dire cosa è bloccato **per quel tipo** (payout vs operatività) e che la
visura aggiornata serve per la corretta fatturazione. Entrambi calcolati dalla stessa funzione
pura, nessuna infrastruttura aggiuntiva.

---

## Punto 5 — Termini e condizioni

I ganci **esistono già** in `lib/legal/clausole-vessatorie.ts`, tutti già fra le
`CLAUSOLE_VESSATORIE` con doppia accettazione ex artt. 1341-1342 c.c.:

| # | Clausola | Estensione |
|---|---|---|
| **8** | *manleva in materia di visura camerale* | + obbligo di visura aggiornata, validità **180 giorni**, obbligo di aggiornamento |
| **5** | *condizioni e soglia di prelievo del wallet (payout)* | + sospensione del payout a visura scaduta (broker e agenzia) |
| **12** | *limitazione operativa, sospensione e cancellazione dell'account* | + blocco operatività agenzia a visura scaduta |

**Estendere, non inserire.** Una clausola nuova in mezzo rinumera tutto ciò che segue, e
`ART_DATI_TERZI = 17` **è citato dentro record persistiti** (`BrokerDichiarazione`): le
dichiarazioni già firmate citerebbero per sempre la clausola sbagliata. Il file avverte che è
già successo (foro 17→18, approvazione 18→19).

**Perché devono restare vessatorie:** "sospendere l'esecuzione del contratto" è vessatoria per
legge (art. 1341 c.c. co. 2). Non basta scriverlo nel testo corrente: senza approvazione
specifica la clausola è inefficace — cioè il blocco è contestabile.

### Da fare

- Aggiornare il testo di `app/termini/page.tsx` (clausole 8, 5, 12).
- **Bumpare `TERMS_VERSION`** (oggi `'2026-07-14'`).
- La KB del chatbot è **generata dai docs al prebuild**: si rigenera da sé, ma va verificata.

> ⚠️ **`Company.termsVersion` registra quale testo l'utente ha accettato.** Chi ha accettato la
> `2026-07-14` **non ha mai sottoscritto** la sospensione per visura scaduta: applicargliela è
> contestabile. Con l'attuale DB di prod (temporaneo, di test — tutti si ri-registreranno) il
> problema non si pone. **Quando i dati saranno reali, servirà la ri-accettazione prima di
> poter far mordere il blocco su utenti pre-esistenti.**

> ⚠️ `/termini` è ancora **DRAFT in attesa di revisione legale**. Queste clausole sospendono un
> servizio a pagamento: vanno nel giro col legale insieme al resto.

---

## Organizzazioni con `visuraCameraleData = NULL` — esenti

Senza data non si calcola nulla: nessun preavviso, nessun blocco, per sempre.

Il null è **strutturale**: la colonna si popola solo se il gate KYC passa, quindi
`null` ⟺ registrazione in `DEMO_MODE` **oppure** account creato da seed/admin. Dato che la data
illeggibile blocca la registrazione (punto 1), **da oggi in poi ogni registrazione reale ha per
forza la data**: il buco non si allarga.

Stato attuale (copia locale del DB prod, 2026-07-16): 8 broker su 10 e 9 agenzie su 10 hanno
`null`, e sono account demo/seed — servono per le presentazioni e non vanno bloccati.

## Rollout

**Nessuna gestione speciale.** Il DB di prod è temporaneo/di test: le organizzazioni presenti
si ri-registreranno. Nessun periodo di grazia, nessun backfill, nessuna eccezione nel codice.

Per riferimento, chi sarebbe colpito oggi:

| Azienda | Visura | Età | Effetto |
|---|---|---|---|
| AGENZIA CORSICO DI CIAVARELLA | 2024-12-13 | 580 gg | blocco operatività (ignorata: si ri-registrerà) |
| Dimensione Auto Milano Srls | 2026-03-02 | 136 gg | preavviso dal 30/07, payout off dal 29/08 |
| Concessionaria Demo SRL | 2026-05-01 | 76 gg | nessuno |

## Cosa NON facciamo

- Nessun blocco sulla data in registrazione (né broker né agenzia).
- Nessun controllo di età differenziato per tipo: **180 giorni per tutti**.
- Nessuna riassegnazione automatica delle pratiche di un'agenzia bloccata.
- Nessun redirect/lockout: banner + guard sulle azioni.
- Nessun backfill dei `null`.
- Nessuna sovrascrittura di P.IVA o regime fiscale dall'OCR.

## Fatti verificati (non assunti)

| Fatto | Come |
|---|---|
| `validateVisuraData` è codice morto (solo il suo test la chiama) | grep su `apps/piattaforma/src` |
| Il gate reale in registrazione è **5 mesi, solo DEALER** | `lib/kyc/verify.ts:11,86-89` |
| Le agenzie non hanno **alcun** controllo di età (nemmeno data futura) | `verify.ts:84-89` |
| `documenti` non ha unique su `(companyId, tipo)` → add non replace già possibile | `\d documenti` |
| `notifiche_inviate.payload` è `jsonb` → anti-join possibile | `information_schema.columns` |
| Il filtro distribuzione esclude solo le scadute e lascia i null | query su `sedi ⋈ companies` |
| 9 cron giornalieri già configurati — oltre il limite Hobby (2) → **dedotto** piano Pro, non verificato sul billing | `apps/piattaforma/vercel.json` |
| I candidati distribuzione sono **SEDI** filtrate per madre | `lib/distribuzione/tick.ts:157-165` |

## Rischi noti

1. **Fatturazione.** L'aggiornamento riscrive dati che finiscono su fatture elettroniche
   trasmesse a SdI. La superficie è volutamente minima (ragione sociale + sede legale).
2. **Contratto e codice si falsificano a vicenda.** Ogni scostamento fra le clausole 5/8/12 e il
   comportamento reale rende falso uno dei due. Vanno modificati insieme.
3. **Pratiche congelate.** Un cliente finale può restare in attesa per un adempimento
   dell'agenzia. Accettato ora, da monitorare.
4. **Costo OCR** se si sceglie l'avviso inline allo step 3 (pre-flight su ogni registrazione).
5. **Registrazione che accetta ciò che punisce.** Un'agenzia con visura ≥180 si iscrive ed è
   subito bloccata. Mitigato dall'avviso, non eliminato: è insito nel flusso richiesto.
