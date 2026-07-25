# Sospensione account in sola lettura

**Data:** 2026-07-25
**Stato:** approvato
**Ambito:** utenti azienda (broker e agenzie). Lo staff di piattaforma è escluso
per scelta, vedi "Fuori scope".

## Problema

Sospendere un account da admin non toglie l'operatività. Un broker sospeso con
una sessione già aperta continua a creare pratiche, e nessun controllo lo ferma.

Le due azioni admin esistenti (`src/app/admin/suspension-actions.ts`) scrivono:

- `suspendUserAction` → `User.status = SUSPENDED` + `suspensionLastNote` + email N45
- `suspendCompanyAction` → `Company.suspendedAt` + `suspensionLastNote` + tutti gli
  utenti a `SUSPENDED` + email N14

Il solo effetto reale sull'utente è il **gate di login**:
`activeUserCredentialsQuery` filtra `status: 'ACTIVE'`, quindi `authorize` in
`auth.ts` rifiuta. Nessun effetto su una sessione già emessa, per tre ragioni che
si sommano:

1. La sessione è **JWT** (`auth.config.ts:13-15`): non c'è nessuna riga di
   sessione da invalidare lato server.
2. Il gate del middleware (`authorized()`, `auth.config.ts:37,64`) controlla
   **solo `isLoggedIn`**, mai `status`.
3. `token.status` viene riletto dal DB **solo** su `trigger === 'update'`
   (`auth.ts:108-118`), cioè quando l'app chiama `unstable_update` — cosa che un
   utente sospeso non innesca.

Nessuna server action e nessuna pagina rileggono `status` o `suspendedAt` prima
di scrivere: `getSessionContext` va sul DB per company e permessi, ma non guarda
né l'uno né l'altro.

Risultato: pieni poteri fino alla scadenza naturale del JWT (default Auth.js: 30
giorni) o al logout volontario. Il testo del modale admin
(`suspend-button.tsx:123`, «non potranno più accedere») descrive il login
successivo, non la sessione in corso.

Gli unici effetti che oggi funzionano davvero sono quelli **server-side** della
sospensione *aziendale*, perché leggono `suspendedAt` dal DB per conto proprio e
non dipendono dalla sessione: esclusione dalla distribuzione
(`lib/distribuzione/tick.ts:96-102`), job di preavviso visura e recap
affiliazione saltati, contatto CRM marcato `SOSPESO` (`lib/crm/sync.ts:226`).
Nota che il filtro della distribuzione è sulle **agenzie candidate**: un broker
sospeso continua a immettere pratiche che vengono regolarmente distribuite.

## Obiettivo

La sospensione toglie l'**operatività**, non l'accesso ai propri dati. L'utente
sospeso vede storico pratiche, wallet, fatture e addebiti; non crea, non firma,
non preleva.

## Decisioni

### Sola lettura come intersezione dei permessi, non come guard sparsi

`lib/auth/permessi/catalogo.ts` definisce 31 chiavi già separabili in lettura e
scrittura, e **ogni CTA di scrittura nella UI è già derivata da
`hasPermesso(...)`** — `pratiche/page.tsx:69-72`, `inbox/page.tsx:35`,
`wallet/page.tsx:405-406`, `orari/page.tsx:75`, e così via.

Quindi: se la sospensione **interseca** il set dei permessi effettivi con una
whitelist di sole chiavi di lettura, l'enforcement e la UI si risolvono nello
stesso punto. Le action gated si rifiutano da sole via `requirePermesso`, le
pagine precluse redirigono via `assertPermesso`, e le CTA spariscono in ~40
pagine senza toccarne nessuna.

La ragione della scelta non è la brevità: è che la copertura diventa **derivata
anziché ricordata**. Un guard per action (`requireNonSospeso()` in cima a ognuna)
è corretto finché qualcuno si ricorda di aggiungere la riga — lo stesso
fallimento che `mappa-enforcement.ts` è stato scritto per prevenire.

Scartato il blocco nel middleware: gira su edge con `auth.config.ts`, che non ha
Prisma, e il JWT non porta lo stato aggiornato — è la causa del bug di partenza.
In più le server action non hanno un path distinguibile, quindi il middleware non
saprebbe dire se una POST è una lettura o una scrittura.

### Verifica per-richiesta contro il DB

Ne discende una proprietà che vale dichiarare: la riattivazione ha effetto
**immediato**, senza re-login. Qualsiasi soluzione basata sul token avrebbe una
finestra in cui il token mente — la stessa che causa il bug.

## Architettura

### 1. Fonte unica dello stato — `lib/auth/sospensione.ts`

```
sospensioneUtente() → { sospeso: boolean, motivo: string | null, origine: 'UTENTE' | 'AZIENDA' }
```

Sospeso se `User.status === 'SUSPENDED'` **oppure** `Company.suspendedAt != null`.
Entrambi gli stati sono producibili dal write path: `suspendUserAction` scrive solo
il primo, `suspendCompanyAction` entrambi.

`origine` serve al banner per dire la cosa giusta («il tuo utente» vs «l'account
della tua azienda»). `motivo` viene da `suspensionLastNote`.

Costo in query: quasi zero. `getSessionContext` interroga già `company` (basta
aggiungere `suspendedAt` al `select`) e già interroga `user` per i permessi.
L'unica differenza è che quella lettura oggi viene **saltata per il titolare**
(`session-context.ts:86-88`) e va resa incondizionata: una query in più per i soli
owner, dentro una funzione già `cache()`-ata per richiesta.

### 2. Partizione delle 31 chiavi — `lib/auth/permessi/sola-lettura.ts`

**14 di lettura**, sopravvivono: `pratiche.view`, `pratiche.download`,
`inbox.view`, `wallet.view`, `fatture.view`, `fatture.download`, `fatture.xml`,
`addebiti.view`, `affiliazione.view`, `feedback.view`, `sede.view`, `orari.view`,
`team.view`, `notifiche.view`.

**17 di scrittura**, cadono: `pratiche.create`, `pratiche.annulla`,
`pratiche.valuta`, `pratiche.processa`, `pratiche.firma`, `pratiche.segnala`,
`inbox.gestisci`, `wallet.payout`, `wallet.soglia`, `sede.edit`, `orari.edit`,
`team.invita`, `team.crea`, `team.modifica`, `team.reset_password`,
`team.disabilita`, `team.permessi`.

I download restano attivi (`pratiche.download`, `fatture.download`,
`fatture.xml`): sono dati propri dell'azienda, e negarne l'estrazione durante una
sospensione sarebbe difficile da difendere anche sul piano GDPR.

### 3. Il flag nel contesto e in `can()`

`getSessionContext` interseca `permessi` con la whitelist e aggiunge
`soloLettura: true` a `SessionContext` e a `PermessiCtx`. In `check.ts`, `can()`
valuta il flag **prima** dello short-circuit sull'owner:

```ts
export function can(ctx: PermessiCtx, p: Permesso): boolean {
  if (ctx.soloLettura && !isLettura(p)) return false;   // ← anche per l'owner
  if (ctx.isOwner) return true;
  return isPermesso(p) && ctx.permessi.has(p);
}
```

L'ordine è la parte critica: `if (ctx.isOwner) return true` (`check.ts:17`)
darebbe altrimenti al titolare tutti i poteri malgrado la sospensione, e nella
maggior parte delle aziende clienti il titolare è l'unica utenza.

## Superfici che l'intersezione non copre

### A. Action senza permesso delegabile

Sono le voci con `permesso: null` in `mappa-enforcement.ts`.

| Action | Sotto sospensione | Perché |
|---|---|---|
| `profilo/personale`: profilo, password | consentita | sicurezza del proprio account, non operatività |
| `profilo/sicurezza`: 2FA setup/conferma/disattiva | consentita | idem |
| `profilo/notifiche`: preferenze | consentita | idem |
| `visura`: verifica, aggiorna | consentita | rimedio: permette di presentarsi al riesame già in regola |
| `blocco-pagamento`: ritenta addebito, IBAN + ritenta | consentita | rimedio |
| `lib/sedi`: cambio sede corrente | consentita | navigazione, non scrittura di dominio |
| `profilo/azienda`: anagrafica fiscale | **bloccata** | atto societario |
| `sedi`: crea, sospendi, riattiva sede | **bloccata** | creare una sede da sospesi è espansione, cioè operatività |
| `wallet/mandato-actions`: OTP + firma mandato | **bloccata** | serve al payout, che è comunque bloccato |

Bloccare il cambio password a un utente le cui credenziali potrebbero essere
compromesse farebbe danno senza portare nulla: le action del proprio account
agiscono su `session.user.id` e non toccano dati aziendali.

Per le tre bloccate serve un guard esplicito `requireOperativita()`, esportato da
`lib/auth/sospensione.ts`, con la stessa forma di ritorno di `requirePermesso`
(`{ ok: true } | { ok: false; error: string }`).

Perché la tabella non resti affidata alla memoria, `mappa-enforcement.ts` prende
una seconda mappa `MAPPA_SOSPENSIONE` con le **sole** action a permesso `null`, e
un test verifica l'**uguaglianza esatta degli insiemi di chiavi**: una action
nuova senza permesso che non venga classificata fa fallire il test. Le action
gated non vanno ripetute — il loro comportamento è già derivato dalla whitelist —
e il test impedisce di aggiungerle per errore.

### B. Motore payout

Tutti i percorsi di payout — action manuale, auto-payout a soglia in tempo reale,
cron di sicurezza — passano da `eseguiPayoutImmediato`
(`lib/wallet/auto-payout.ts:45`). Un blocco solo sull'action sarebbe **cosmetico**:
l'auto-payout partirebbe comunque, senza che il sospeso tocchi nulla. Il caso è
concreto, perché le pratiche già inviate da un broker sospeso continuano a essere
firmate dalle agenzie e ad accreditargli il wallet.

Guard in `eseguiPayoutImmediato`, accanto a quello della visura
(`payout-exec.ts:176-189`) e con la stessa struttura, **esente sotto
`ignoraSoglia`** — la liquidazione di cessazione (clausola 12.4: «il saldo residuo
è liquidato integralmente») deve restare possibile. Costo in query: **zero**, quel
guard risolve già la company proprietaria del wallet (`payout-exec.ts:177-181`) e
basta leggere `suspendedAt` nello stesso `select`.

Il saldo resta e continua a maturare; si sblocca alla riattivazione.

## Interfaccia

`components/suspension-banner.tsx`, Server Component sullo schema di
`VisuraBanner`: si auto-annulla quando non c'è nulla da dire, `Alert
variant="error"`, dice qual è la misura (utente o azienda), riporta il motivo,
elenca cosa resta possibile e indica come chiedere il riesame (clausola 12.3-bis
dei Termini: la misura è comunicata col motivo, e il riesame è un diritto).

Montato **per-pagina** come già fa `VisuraBanner` — dashboard, pratiche, inbox,
wallet, più fatture e affiliazione. È la convenzione del progetto: la shell è
per-pagina, non c'è un layout dove montarlo una volta sola.

Due accortezze che vengono da errori già commessi in questo repo:

- il motivo è **testo libero scritto dall'admin**, va reso solo come figlio JSX;
  mai `dangerouslySetInnerHTML`;
- il testo del banner va riletto **sul DOM**, non nel sorgente: il JSX mangia gli
  spazi tra elementi.

### Pagine gated su un solo permesso di scrittura

`assertPermesso` redirige a `/dashboard`. Le pagine il cui unico gate è un
permesso di scrittura diventano quindi irraggiungibili — `/pratiche/nuova`
(`pratiche.create`) è il caso principale. Un redirect muto è confuso, ma la
dashboard è anche il posto dove il banner spiega perché: è il comportamento
accettato, non un effetto collaterale da correggere. Le pagine gated su un
permesso di lettura (`/wallet`, `/pratiche`, `/fatturazione`, `/inbox`) restano
raggiungibili, con le sole CTA di scrittura assenti.

### Messaggio d'errore lato server

Anche senza CTA, una POST costruita a mano arriva a `requirePermesso`. Il
messaggio non deve essere il generico «Non hai i permessi per questa azione»:
sarebbe fuorviante, l'utente i permessi li ha. `requirePermesso` distingue il
rifiuto da sospensione e restituisce un messaggio proprio.

## Pratiche in corso di un'agenzia sospesa

La sospensione toglie subito `pratiche.processa` e `pratiche.firma`. Le pratiche
già accettate restano ferme finché l'admin non le revoca e non le rimette in
ricircolo da `/admin/monitoraggio` — strumento che esiste già (revoca +
`distribuzioneCiclo`, con notifiche N50/N51/N40).

L'alternativa era una "coda di chiusura" (completare solo le pratiche già
accettate). Scartata: `pratiche.firma` è marcata `sensibile` nel catalogo perché
«accredita il wallet e genera la fattura», quindi permetterla vorrebbe dire che la
sola lettura non è tale. L'invariante che si vuole tenere è: **sospeso = zero
scritture**.

## Test e verifica

Unitari:

- `can()` con `soloLettura`, per owner e non-owner
- esaustività della partizione contro il `CATALOGO`: una chiave nuova non
  classificata fa fallire il test
- uguaglianza degli insiemi `MAPPA_SOSPENSIONE` ↔ voci a permesso `null`
- `eseguiPayoutImmediato`: rifiuta per azienda sospesa **e** non rifiuta sotto
  `ignoraSoglia`
- `getSessionContext` nei tre stati producibili: solo utente sospeso, solo azienda
  sospesa, entrambi

Verifica a mano, non automatizzabile: login come broker sospeso sul DB locale e
**clic reale** sulle CTA, più lettura del banner sul DOM. In questo repo i test non
hanno mai visto due bug React né 21 parole incollate in una pagina legale; un
banner che non si monta o una CTA che resta cliccabile sono la stessa categoria di
difetto.

Le query nuove vanno eseguite in read-only sul Postgres locale prima di chiudere:
i test mockano Prisma.

## Fuori scope

- **Staff di piattaforma** (`ADMIN_PIATTAFORMA`, `ASSISTENTE`, ruoli CRM). Il buco
  esiste e su questi account è più grave, perché sono i più privilegiati: sono
  sospendibili da `/admin/assistenti` e `/admin/crm/utenti` e con una sessione
  aperta mantengono tutti i poteri. Ma non è riducibile a questo meccanismo: le
  loro autorizzazioni passano da `permissions.ts`, che sono funzioni **pure sul
  ruolo** e non possono leggere il DB, e non esiste un layout admin condiviso dove
  innestare un guard. Sono 165 punti di chiamata in 62 file. Spec separata.
- **Abbassare `session.maxAge`**: reso inutile dal controllo per-richiesta.
- **Revoca automatica delle pratiche accettate** alla sospensione: la fa l'admin
  con lo strumento esistente.
- **Fermare la distribuzione delle pratiche già in circolo** di un broker
  sospeso: sono state create legittimamente prima della misura, e interromperne il
  giro lascerebbe a metà anche l'agenzia che le sta valutando. Il broker sospeso
  semplicemente non ne crea di nuove.
- **Migration**: nessuna. Tutti i campi usati (`User.status`,
  `Company.suspendedAt`, `suspensionLastNote`) esistono già.

## Correzione collaterale

`suspensionLastNote` sulla company è già scritto da `suspendCompanyAction`
(`suspension-actions.ts:208`), quindi il banner ha il motivo in entrambi i rami
senza modifiche allo schema.

Resta aperto il follow-up già documentato in `suspension-actions.ts:222-243`:
`reactivateCompanyAction` riattiva **tutti** gli utenti `SUSPENDED` della company,
revocando in silenzio anche una sospensione individuale motivata. Non è introdotto
da questo lavoro e non è risolto qui — richiede `User.suspensionSource` e una
migration — ma con la sola lettura in vigore la conseguenza diventa più visibile:
una riattivazione aziendale restituisce l'operatività anche a chi era stato
sospeso singolarmente.
