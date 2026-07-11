# Revisione Termini e Condizioni — penali, sospensione, prelievo

> Data: 2026-07-11 · Owner: CTO Francesco Sioli
> Interviene su: `apps/piattaforma/src/app/termini/page.tsx` (cl. 5, 10, 11) +
> allineamento del codice che rende vere le clausole.
> Sostituisce parzialmente `docs/superpowers/specs/2026-07-07-termini-condizioni-design.md`
> (che resta valido per le clausole non toccate).

## 1. Motivazione

I Termini deployati il 2026-07-07 sono un draft tecnico. Tre punti sono
insufficienti e vanno riscritti:

1. **Clausola 5** — «Il prelievo è disponibile solo al raggiungimento di un saldo
   minimo di 500 €» è formulata come una barriera. Oltre a essere ostile, è
   **attaccabile**: una soglia di prelievo priva di garanzia di non-decadenza
   espone all'accusa di ritenzione indebita di somme altrui.
2. **Clausola 10** (segnalazioni e penali) — rinvia genericamente alle «regole
   indicate in Piattaforma». Non dice **quali** penali, **quanto**, **quando**,
   **chi decide**. Una clausola penale indeterminata è debole.
3. **Clausola 11** (sospensione) — accorpa in un unico paragrafo **tre misure
   diverse** con presupposti ed effetti incompatibili, e dichiara come
   «sospensione» ciò che nel sistema **non blocca affatto il login**.

## 2. Stato reale del sistema (accertato sul codice, 2026-07-11)

Fonte di verità per il testo contrattuale. Il contratto non deve promettere
né minacciare nulla che il sistema non faccia.

### Penali
- **Unica penale monetaria**: `PENALI.PENALE_BROKER_DEFAULT_CENT = 2_500` (€25),
  in `lib/penali/config.ts`.
- Presupposto: l'**agenzia assegnataria** segnala un'anomalia **pre-firma**
  (stati `ACCETTATA` / `PROCESSATA`) — tipi `FERMO_AMMINISTRATIVO`, `IPOTECA`,
  `DOCUMENTO_NON_VALIDO`, `ALTRO` — e **un admin conferma**. Mai automatica,
  mai post-firma (`segnalazione.ts` blocca la conferma se `stato = FIRMATA`).
- Effetti conferma: pratica `ANNULLATA`, penale sul wallet broker, `FeeAddebito`
  dell'agenzia annullato (nessun addebito all'agenzia).
- Il **compenso** della pratica **non è stornato**: essendo la segnalazione
  pre-firma, il `CREDITO_PRATICA` non esiste ancora → il broker semplicemente
  **non lo matura**. Lo storno è un ramo difensivo per l'edge case.
- Wallet **può andare negativo**; blocca solo il payout, non l'operatività.
- `MAX_PENALI_BEFORE_ALERT = 2` → alert admin per valutare la sospensione.
- La **fee agenzia (1–200 €) NON è una penale**: è il corrispettivo (cl. 3).
- `TransazioneWalletTipo` include `RETTIFICA_ADMIN` → esistono aggiustamenti
  manuali del wallet. Una clausola di tassatività assoluta sarebbe **falsa**.

### Sospensione / limitazione / cancellazione — i casi reali
1. **Sospensione manuale** (`suspendCompanyAction` / `suspendUserAction`):
   blocca il login, reversibile, salva `suspensionLastNote`, notifica **N14 con
   il motivo**.
2. **Auto-sospensione anti-abuso** (`checkAutoSuspendForSedi`): dopo
   `ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD = 5` **TIMEOUT consecutivi**
   (assegnazioni ignorate) è sospesa la **singola sede** (`Sede.suspendedAt`).
   Le altre sedi restano attive, gli utenti **non** sono toccati. Il **rifiuto
   espresso non concorre** alla soglia (incide solo sul ranking via
   `REJECT_DECAY_PER_REJECT`).
3. **Blocco pagamento "soft"** (`bloccaAgenziaPerAddebito`, `Company.bloccoPagamentoAt`):
   su addebito SEPA fallito. **NON è una sospensione**: il login resta. L'agenzia
   è esclusa dalla distribuzione e confinata a `/blocco-pagamento`, dove aggiorna
   l'IBAN o ritenta. **Sblocco automatico** quando nessun `FeeAddebito` è in
   `{FAILED, RETRY, IN_LAVORAZIONE}`. Oggi **dormiente** (`PAYMENT_PROVIDER=mock`).
4. **Cancellazione** (`deleteCompanyAction`): solo `ADMIN_PIATTAFORMA`, soft-delete
   + conferma della ragione sociale.
5. **Rating basso** (`LOW_RATING_THRESHOLD = 2.5`): **solo evidenza visiva**
   all'admin. **Nessun effetto operativo** — non sospende.

### Payout
- `WALLET.MIN_PAYOUT_CENT = 50_000` (500 €) — prelievo manuale.
- Auto-payout: default 100_000 (1.000 €), range 1.000–5.000 €.
- ⚠️ La soglia è applicata **anche al payout eseguito dall'admin**
  (`payout-exec.ts:144`, `wallet/actions.ts:66`).

## 3. Discrepanze accertate (il motivo per cui questo non è un lavoro di sola scrittura)

### D1 — Penale «per veicolo» promessa, «per pratica» addebitata ⚠️
`dichiarazione-popup.tsx` — testo **loggato con versione** come dichiarazione
contrattuale (`BrokerDichiarazione`) — dichiara al broker:

> «ti verrà addebitata una penale di **€25,00 lordi _per veicolo_** dal tuo wallet»

Ma `segnalazione.ts:217` addebita **flat**:

```ts
const importoPenaleCent = PENALI.PENALE_BROKER_DEFAULT_CENT;  // €25, per pratica
```

Su una pratica multi-veicolo il popup minaccia €25 × N, il codice addebita €25.
Il «per veicolo» è stato **aggiunto deliberatamente** al popup (commit `c587501`)
senza adeguare la logica di addebito: **l'intenzione era per-veicolo,
l'implementazione è rimasta flat**.

La discrepanza è *a favore* del broker (addebitiamo meno del dichiarato), quindi
non è un rischio di sovra-addebito — ma il contratto non può che contraddire una
delle due. **Va sanata.**

### D2 — «Lordi» non corrisponde a nulla
Il popup dice «€25,00 **lordi**», ma nel codice l'addebito è secco sul wallet:
**nessuna IVA viene mai calcolata**. Il termine è ambiguo e privo di referente.
(Già segnalato come punto aperto in `docs/sistema-penali-broker.md` §B-LEGAL.2.)

### D3 — La segnalazione non sa quali veicoli siano affetti
Lo schema tiene la segnalazione **a livello di pratica** (`flagSegnalata`,
`tipoSegnalazione`, `notaSegnalazione` su `Pratica`). **Nessun collegamento ai
singoli `Veicolo`.** Una penale «per veicolo segnalato» oggi **non è calcolabile**.

### D4 — L'auto-sospensione anti-abuso è auto-revocabile dall'utente ⚠️⚠️
`setSedeSuspended` (`app/sedi/actions.ts:151-173`) verifica **soltanto** che il
chiamante sia `ADMIN_AZIENDA` della propria azienda, poi scrive
`suspendedAt: null`. E usa **lo stesso identico campo `Sede.suspendedAt`** che
l'anti-abuso (`checkAutoSuspendForSedi`) usa per l'auto-sospensione.

**Non esiste alcuna distinzione tra sospensione volontaria dell'utente** (es. sede
chiusa per ferie) **e auto-sospensione sanzionatoria.**

> Conseguenza: l'agenzia auto-sospesa per 5 no-show consecutivi apre `/sedi/[id]`,
> clicca **«Riattiva»**, e rientra in distribuzione **immediatamente**, senza alcun
> intervento né conoscenza da parte di Passaggio Veloce.

**L'anti-abuso oggi non ha denti**: è una sanzione che il sanzionato annulla da sé
con un clic, quante volte vuole. Impatto contrattuale: una clausola 11.2 che
descrivesse una revoca «previa verifica di Passaggio Veloce» sarebbe **falsa**.

## 4. Decisioni prese (utente, 2026-07-11)

| # | Tema | Decisione | Conseguenza |
|---|---|---|---|
| D-a | Soglia 500 € | **Mantenuta**, ma riformulata come soglia di **accumulo**: nessuna perdita, e **liquidazione del residuo alla cessazione anche sotto soglia** | serve override admin al payout sotto soglia |
| D-b | Tutele difensive nuove | **Solo ciò che il sistema fa**. Niente interessi di mora, niente compensazione extra, niente ritenzione del payout in pendenza di verifiche | il testo resta aderente all'implementazione |
| D-c | Base della penale | **€25 × veicoli effettivamente segnalati** (l'agenzia li seleziona) | fix codice + migration + UI |
| D-d | IVA sulla penale | **Fuori campo IVA** (art. 15 co. 1 n. 1 D.P.R. 633/1972); via «lordi» dal popup | qualificazione fiscale corretta |
| D-e | Auto-sospensione anti-abuso auto-revocabile (**D4**) | **Si sistema il codice**: distinguere l'**origine** della sospensione; quella anti-abuso è revocabile **solo da Passaggio Veloce** | migration + logica + azione/UI admin |

**Perché D-c e non «tutti i veicoli della pratica»** (che sarebbe costato una riga):
addebitare €25 anche per veicoli **privi di qualsiasi vizio** rende la penale
sproporzionata rispetto all'inadempimento — **riducibile dal giudice ex art. 1384
c.c.** — e contraddice il presupposto dichiarato dal popup stesso («veicolo
soggetto a fermo o ipoteca»). Era il punto più attaccabile che stavamo per creare.

## 5. Testo delle clausole (approvato)

### Clausola 5 — Wallet, compensi e condizioni di prelievo (payout)

> I compensi maturati dall'Utente sono accreditati sul wallet **alla firma** della
> relativa pratica. **Il saldo del wallet è in ogni momento e integralmente di
> spettanza dell'Utente: non è soggetto a scadenza, decadenza, né ad alcuna forma
> di decurtazione, qualunque sia il suo importo.**
>
> I compensi **si accumulano liberamente** sul wallet. La **richiesta di prelievo**
> può essere presentata una volta raggiunto un saldo di **500 €**; al di sotto di
> tale importo i compensi **restano accreditati e continuano ad accumularsi senza
> alcuna perdita**. Al raggiungimento della soglia di payout automatico configurata
> dall'Utente (di regola 1.000 €, impostabile tra 1.000 € e 5.000 €) l'erogazione è
> avviata automaticamente. L'erogazione avviene mediante bonifico sull'IBAN indicato.
>
> **In ogni caso di cessazione del rapporto** (recesso di una delle parti, chiusura
> o cancellazione dell'account) **il saldo residuo è liquidato integralmente
> all'Utente anche se inferiore a 500 €**, previa emissione dei documenti fiscali.
>
> In caso di penali (clausola 10) il saldo può risultare negativo: in tale ipotesi i
> prelievi sono sospesi fino al ripristino di un saldo positivo, mentre i compensi
> successivi continuano ad accreditarsi a compensazione. **L'operatività dell'Utente
> resta invariata.**

### Clausola 10 — Sistema di segnalazioni e penali

> **10.1 — Verifica preventiva a carico del broker.** Passaggio Veloce **non
> effettua visure PRA**. Prima dell'invio di ogni pratica il broker verifica
> personalmente, **per ciascun veicolo**, che: (a) non sussistano fermi
> amministrativi; (b) non sussistano ipoteche o vincoli iscritti al PRA; (c) i
> documenti caricati siano autentici e corrispondenti al veicolo. Tale verifica
> forma oggetto di **dichiarazione espressa** resa in Piattaforma prima di ogni
> invio, registrata con data, ora e versione del testo accettato.
>
> **10.2 — Segnalazione dell'agenzia.** La sola **agenzia assegnataria** può
> segnalare, **esclusivamente prima della firma** (pratica in stato «Accettata» o
> «Processata»): **fermo amministrativo**, **ipoteca o vincolo PRA**, **documento
> non valido**, **altro** (con nota). L'agenzia **indica i veicoli interessati**.
> Dopo la firma la pratica è chiusa e non è più segnalabile.
>
> **10.3 — Verifica di Passaggio Veloce. Nessuna penale è mai applicata
> automaticamente.** Ogni segnalazione è verificata da Passaggio Veloce, che può
> **confermarla** (pratica annullata, penale addebitata) o **respingerla** (pratica
> prosegue, nessun addebito). L'esito è comunicato via email a entrambe le parti.
>
> **10.4 — Penale: unica penale prevista.** In caso di segnalazione **confermata**
> è addebitata al broker una penale di **€ 25,00 per ciascun veicolo oggetto della
> segnalazione confermata**. La penale: (a) è addebitata sul wallet del broker;
> (b) **non è soggetta a IVA**, costituendo somma dovuta a titolo di penalità,
> esclusa dalla base imponibile ai sensi dell'**art. 15, co. 1, n. 1, D.P.R.
> 633/1972**; (c) **non si applica ai veicoli non segnalati** della medesima pratica.
>
> *Esempio: pratica con 3 veicoli, di cui 1 con fermo confermato → penale € 25,00
> (un solo veicolo), non € 75,00.*
>
> **10.5 — Effetti della conferma.** (a) la pratica è **annullata**; (b) il compenso
> della pratica **non è maturato** dal broker, poiché matura solo alla firma (se già
> eccezionalmente accreditato, è stornato); (c) all'agenzia segnalante **non è
> addebitata alcuna fee**.
>
> **10.6 — Saldo negativo.** L'addebito può portare il wallet a saldo negativo. In
> tal caso i prelievi sono sospesi fino al ripristino, i compensi successivi si
> accreditano a compensazione, e **l'operatività resta invariata**: il broker può
> continuare a caricare e gestire pratiche.
>
> **10.7 — Reiterazione.** Al raggiungimento di **2 penali confermate**, la posizione
> del broker è sottoposta a valutazione ai fini della sospensione ai sensi della
> clausola 11.
>
> **10.8 — Tassatività.** La penale di cui al punto 10.4 è **l'unica penale**
> applicata da Passaggio Veloce. Oltre ad essa e al corrispettivo di cui alla
> clausola 3, **nessun altro importo è addebitato all'Utente a titolo di penale,
> sanzione o costo**. Restano salve le sole **rettifiche contabili** volte a
> correggere accrediti o addebiti erronei, prive di natura sanzionatoria e sempre
> motivate e tracciate nel wallet.

> **Nota di drafting (10.8).** La riserva sulle rettifiche contabili non è
> pleonastica: `TransazioneWalletTipo.RETTIFICA_ADMIN` esiste e consente
> aggiustamenti manuali del wallet. Senza quella riserva la clausola di tassatività
> sarebbe **falsa** e, una volta smentita in giudizio, indebolirebbe l'intera
> clausola 10.

### Clausola 11 — Limitazione operativa, sospensione e cancellazione dell'account

> Passaggio Veloce adotta **tre misure distinte**, di gravità crescente, di seguito
> elencate **in modo tassativo**.
>
> **11.1 — Limitazione operativa per mancato incasso della fee (solo agenzie).**
> *Presupposto:* l'addebito SEPA della fee (clausola 3) non va a buon fine.
> *Effetto:* l'agenzia **conserva l'accesso alla Piattaforma** — **l'account NON è
> sospeso** — ma è esclusa dalla distribuzione di nuove pratiche e non può accettare,
> lavorare o portare a firma pratiche fino alla regolarizzazione.
> *Rimedio:* l'agenzia può in ogni momento **aggiornare l'IBAN** o **richiedere un
> nuovo tentativo di addebito** dall'apposita sezione.
> *Revoca:* **automatica**, non appena non risultino più addebiti insoluti o in
> corso. Non è discrezionale.
>
> **11.2 — Sospensione automatica per mancate risposte reiterate (solo agenzie).**
> *Presupposto:* **5 assegnazioni consecutive lasciate scadere senza alcuna
> risposta** (né accettazione né rifiuto).
> *Effetto:* è sospesa la **singola sede** interessata, esclusa dalla distribuzione.
> **Le altre sedi restano attive e gli utenti non sono disabilitati.**
> *Precisazione:* il **rifiuto espresso** di una pratica **non concorre** a questa
> soglia — incide solo sull'ordinamento in distribuzione. Rileva **unicamente la
> mancata risposta**.
> *Revoca:* la sospensione disposta dal sistema anti-abuso è revocata **da Passaggio
> Veloce**, su richiesta dell'Utente e previa verifica. Resta ferma e impregiudicata
> la facoltà dell'Utente di **sospendere e riattivare autonomamente** le proprie sedi
> per esigenze organizzative: tale facoltà **non consente** di revocare la sospensione
> disposta ai sensi del presente punto.
>
> **11.3 — Sospensione dell'account.**
> *Effetto:* l'accesso alla Piattaforma è inibito per l'azienda e per tutte le sue
> utenze. La misura è **reversibile**.
> *Motivi tassativi* — la sospensione può essere disposta **esclusivamente** per uno
> dei seguenti motivi:
> 1. **frode o tentativo di frode** ai danni di Passaggio Veloce, di altri Utenti o
>    di terzi;
> 2. **falsità o alterazione** di dati aziendali, documenti d'identità, documenti del
>    veicolo o della pratica;
> 3. **abuso del programma di affiliazione**: iscrizioni fittizie, account multipli
>    riconducibili al medesimo soggetto, collusione tra referente e referito, o altre
>    condotte volte a generare commissioni non corrispondenti a pratiche reali;
> 4. **raggiungimento di 2 penali confermate** ai sensi della clausola 10;
> 5. **mancata regolarizzazione** della limitazione di cui al punto 11.1 nonostante i
>    solleciti;
> 6. **violazione grave o reiterata** dei presenti Termini;
> 7. **uso della Piattaforma per finalità illecite** o in violazione di legge;
> 8. **richiesta dell'Autorità** giudiziaria o amministrativa, o obbligo di legge;
> 9. **venir meno dei requisiti soggettivi**: cessazione della partita IVA,
>    cancellazione dal Registro delle Imprese, cessazione dell'attività d'impresa;
> 10. **condotta gravemente lesiva** verso altri Utenti o il personale di Passaggio
>     Veloce.
>
> *Comunicazione e riesame:* la sospensione è **comunicata via email con indicazione
> del motivo**. L'Utente può presentare osservazioni e chiedere il **riesame**
> scrivendo ad assistenza@passaggioveloce.it; Passaggio Veloce riscontra entro **15
> giorni**. Venuto meno il motivo, l'account è riattivato.
>
> *Effetti economici:* **la sospensione non comporta in alcun caso la perdita dei
> compensi già maturati**, che restano accreditati sul wallet e sono liquidati ai
> sensi della clausola 5.
>
> **11.4 — Cancellazione dell'account.**
> *Su richiesta dell'Utente:* scrivendo ad assistenza@passaggioveloce.it.
> *Su iniziativa di Passaggio Veloce:* **solo** nelle ipotesi di cui al punto 11.3 di
> **particolare gravità** (frode accertata, falsità documentale, illecito, ordine
> dell'Autorità) **oppure** in caso di perdurante sospensione senza regolarizzazione.
> *Effetti:* disattivazione dell'account e cancellazione dei dati secondo
> l'Informativa Privacy, fatti salvi gli obblighi di conservazione di legge (in
> particolare fiscali e contabili) e le esigenze di audit sulle pratiche già eseguite.
> *Effetti economici:* restano dovuti gli importi maturati fino alla cessazione; **il
> saldo residuo del wallet è liquidato integralmente all'Utente, anche se inferiore a
> 500 €**, previa emissione dei documenti fiscali e regolarizzazione di quanto
> eventualmente dovuto a Passaggio Veloce.
>
> **11.5 — Tassatività.** Al di fuori delle ipotesi elencate nella presente clausola,
> Passaggio Veloce **non adotta alcuna misura limitativa, sospensiva o interruttiva**
> dell'account. **In nessun caso** la limitazione, la sospensione o la cancellazione
> comportano **la perdita dei compensi già maturati** dall'Utente.

## 6. Modifiche al codice (perché il contratto sia vero)

| # | Intervento | File | Motivo |
|---|---|---|---|
| C1 | Penale = €25 × **veicoli segnalati** | `lib/penali/segnalazione.ts` (~217) | oggi flat €25 (**D1**) |
| C2 | Persistere **quali veicoli** sono segnalati | `packages/db/prisma/schema.prisma` + **migration** | il dato non esiste (**D3**) |
| C3 | Selezione veicoli nel form di segnalazione | UI agenzia (`/pratiche/[id]`) | alimenta C2 |
| C4 | Popup: via «lordi», «per ciascun veicolo segnalato», `POPUP_VERSION` → `v2.0` | `components/dichiarazione-popup.tsx`, `lib/penali/config.ts` | **D1**, **D2**; il testo dichiarato cambia → nuova versione per l'audit di `BrokerDichiarazione` |
| C5 | **Payout sotto soglia alla cessazione** (override admin) | `lib/wallet/payout-exec.ts:144`, `app/wallet/actions.ts:66` | senza questo, cl. 5 e 11.4 sono **inadempibili**: `MIN_PAYOUT_CENT` blocca anche l'admin |
| C6 | **Origine della sospensione di sede**: l'anti-abuso è revocabile **solo da PV** | `packages/db/prisma/schema.prisma` + **migration**, `app/sedi/actions.ts` (`setSedeSuspended`), `lib/distribuzione/auto-suspend.ts`, azione + UI admin | **D4**: oggi il sanzionato si auto-revoca la sanzione con un clic. Senza questo l'11.2 è **falso** e l'anti-abuso è inutile |
| C7 | Copy `/wallet` allineato al «non si perde nulla» | `app/wallet/page.tsx` | coerenza contratto ↔ prodotto |
| C8 | Nuovo testo delle clausole 5, 10, 11 | `app/termini/page.tsx` | — |

### Regole di determinismo sulla penale (C1–C3)

Senza queste, `€25 × n` è indeterminato negli edge case:

- Il form di segnalazione **richiede almeno un veicolo** (`min 1`). Su pratica
  **monoveicolo** il veicolo è **preselezionato** e non modificabile.
- Penale = `PENALE_BROKER_DEFAULT_CENT × (n. veicoli segnalati)`.
- **Fallback difensivo**: se per qualunque motivo l'insieme dei veicoli segnalati
  risultasse **vuoto** (segnalazioni **legacy** create prima di C2, o dato corrotto),
  la penale è calcolata su **1 veicolo** — **mai 0** (non addebiteremmo nulla) e
  **mai tutti** (addebiteremmo veicoli sani, cfr. art. 1384 c.c.).
- `Pratica.penaleAddebitatoCent` continua a registrare l'importo **totale**
  effettivamente addebitato (audit).
- I veicoli segnalati vanno mostrati nella mail **N17** al broker, altrimenti non
  può verificare il calcolo della penale che gli abbiamo addebitato.

**Clausole vessatorie:** l'elenco (cl. 17) resta `3, 5, 7, 8, 10, 11, 12, 16`.
Le clausole riscritte erano **già** nell'elenco → **nessuna modifica alla
registrazione, nessuna migration sull'accettazione** (`termsAccepted` /
`clausoleVessatorieAccepted` invariati).

**Dormienza:** l'11.1 descrive un meccanismo implementato ma **inattivo** finché
`PAYMENT_PROVIDER=mock`. La regola è scritta correttamente e si attiverà al
go-live Stripe. Non è una promessa falsa: è una regola non ancora sollecitata.

## 7. Esclusioni deliberate

- **«Wallet negativo > 30gg → sospensione»** (punto aperto in
  `docs/sistema-penali-broker.md` §B-LEGAL.4): **escluso**. Il sistema non lo fa e
  **contraddirebbe** il 10.6 e l'11.1, dove garantiamo che l'operatività resta
  invariata. Per introdurlo servirebbe implementarlo **e** riscrivere il 10.6.
- **Interessi di mora (D.Lgs. 231/2002), spese di recupero credito, diritto di
  compensazione generale, ritenzione del payout in pendenza di verifiche
  antifrode**: **esclusi** per decisione D-b (aderenza stretta all'implementato).
  Restano disponibili come rafforzamento futuro, ma vanno **prima implementati**.
- **Rating basso come causa di sospensione**: **escluso** — nel sistema il rating
  basso è **solo** un'evidenza visiva per l'admin, senza alcun effetto operativo.

## 8. Follow-up aperti

- ⚠️ **REVISIONE LEGALE**: il documento resta un draft tecnico. Va validato da un
  avvocato, con attenzione a cl. 3 (variazione prezzo illimitata), cl. 8 (manleva),
  cl. 12 (limitazioni di responsabilità) — **non toccate** da questa revisione.
- **Impegni operativi assunti dal testo** (vanno onorati, non solo scritti):
  liquidazione del residuo alla cessazione (C5), riscontro al riesame entro 15
  giorni (11.3), revoca della sospensione di sede su richiesta (C6).
- Valutare il versionamento dei T&C + colonna dedicata `clausoleVessatorieAcceptedAt`
  per una prova rafforzata dell'accettazione (già proposto nella spec del 2026-07-07).
