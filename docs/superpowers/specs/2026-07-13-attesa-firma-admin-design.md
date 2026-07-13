# Pratiche in attesa di firma: monitoraggio admin e attestazione della firma

Data: 2026-07-13
Stato: design approvato, da implementare

## Problema

La firma del cliente è il trigger economico dell'intera piattaforma: finché l'agenzia
non segnala "firma avvenuta", Passaggio Veloce **non incassa nulla** (nessun addebito
all'agenzia, nessuna fattura, nessun credito al broker, nessun payout).

Oggi non abbiamo modo di sapere quali pratiche sono ferme su quello scalino, né da
quanto. Peggio: il job dei solleciti (`lib/jobs/send-solleciti.ts`, cron 09:00) filtra
`stato: 'ACCETTATA'` e **non copre affatto lo stato `PROCESSATA`** — proprio le pratiche
in attesa di firma non ricevono alcun sollecito automatico.

Serve quindi: (1) vederle, ordinate per anzianità; (2) avere i recapiti per sollecitare
broker e agenzia; (3) poter attestare noi la firma quando veniamo a sapere che è già
avvenuta; (4) avere questo potere scritto nel contratto e approvato specificamente.

## Fatti accertati sul codice esistente

Verificati leggendo il codice, non riportati.

- **"Manca solo la firma" = `stato = PROCESSATA`**. Enum `PraticaStato` in
  `packages/db/prisma/schema.prisma:83`. Timestamp dello step: `Pratica.processataAt`.
- **Una pratica segnalata NON cambia stato.** Il sistema penali (`lib/penali/segnalazione.ts`)
  scrive colonne piatte su `Pratica` (`flagSegnalata`, `segnalazioneStato`, …,
  `schema.prisma:814-834`) e lascia lo `stato` invariato. Quindi "processate e non ferme
  per segnalazioni" ⇒ `stato = PROCESSATA AND flagSegnalata = false`.
  Sul write path, una `PROCESSATA` con `flagSegnalata = true` implica sempre
  `segnalazioneStato = 'RICEVUTA'` (la conferma porta ad `ANNULLATA`, il respingimento
  rimette `flagSegnalata = false`): il solo `flagSegnalata` è quindi sufficiente.
- **Bug preesistente**: nessun gate impedisce di firmare una pratica con segnalazione
  aperta (`firmaPraticaCore` controlla solo `stato !== 'PROCESSATA'`,
  `app/pratiche/actions.ts:309`). Se ciò accade, la segnalazione resta appesa per sempre
  nella coda admin, perché `confermaAnnullamentoConPenaleAction` rifiuta le `FIRMATA`.
- **Non esiste un audit log di azioni.** `/admin/audit-log` è un log di *accessi*
  (legge `User.lastLoginAt`); nessun modello `AuditLog` in schema. Il pattern in casa per
  tracciare un'azione è: colonne `...DaUserId` + `...At` + nota sul record
  (cfr. `segnalazioneEsitaDaId`).
- **Invariante dei tab** (documentata in `lib/pratiche/tabs.ts:110-121`, blindata da
  `tabs.test.ts`): ogni valore che un tab scrive in `?stato=` **deve esistere anche come
  `<option>` in `opzioniStatoAdmin()`**. Altrimenti il `defaultValue` della select non
  combacia, il browser seleziona "Tutti gli stati" e il form ad auto-submit rimanda
  `stato=""` al primo tocco di un altro filtro: **il tab sparisce senza errori**.
- **`whereStato()` filtra solo il campo `stato`** (`lib/pratiche/stati.ts:70`) e su un
  valore non riconosciuto ritorna `undefined`, cioè *nessun filtro*. Un tab il cui
  criterio non è solo lo stato non può passare da lì: mostrerebbe tutte le pratiche.
- **`contaGruppi()`** riduce un `groupBy(['stato'])` ed è usata anche da `/pratiche` e
  dalla dashboard broker: non va cambiata di firma.
- **La `firmaPraticaCore` è un motore da ~340 righe** (`app/pratiche/actions.ts:264-602`)
  con effetti a cascata: transazione (stato `FIRMATA` + `firmaAvvenutaAt` + `autoAddebitoAt`,
  credito wallet broker + `TransazioneWallet`, `FeeAddebito ADDEBITO_FIRMA`, commissioni
  affiliazione) e post-commit (sync CRM, `createFatturaPv`, notifiche affiliazione,
  email N4/N8/N12, `EventoPratica`, email cliente, payout automatico).

## Decisioni prese

| Tema | Decisione |
|---|---|
| Dove sta la vista | Nuovo tab in `/admin/pratiche`, **nessuna pagina nuova** |
| Perimetro | Solo `PROCESSATA` non segnalate |
| Sollecito | **Solo recapiti in chiaro**: nessuna email di sollecito dalla piattaforma |
| Chi può attestare la firma | **Solo `ADMIN`** di piattaforma. L'`ASSISTENTE` vede la lista ma non attesta |
| Prova richiesta | **Motivazione libera obbligatoria** (textarea) |
| Email alle parti | N4/N8 dicono che la firma è stata attestata da noi, **senza riportare la motivazione** |
| Termini | Nuova clausola come **art. 11**, con rinumerazione 11→18. Nessuna re-accettazione forzata per gli utenti esistenti |
| Finestra di contestazione | **15 giorni** |

## Componente 1 — Tab "In attesa di firma" in `/admin/pratiche`

### Filtro (`lib/pratiche/stati.ts`)

`whereStato` non basta (filtra solo `stato`). Si aggiunge:

```ts
/** Il criterio del tab "In attesa di firma": lavorata, non segnalata, ferma sulla firma. */
export const WHERE_ATTESA_FIRMA = {
  stato: 'PROCESSATA',
  flagSegnalata: false,
} as const;

/**
 * Filtro Prisma di un tab. Superset di `whereStato`: i tab il cui criterio è solo
 * lo stato delegano a lei, ATTESA_FIRMA aggiunge la condizione sulla segnalazione.
 */
export function whereTabPratiche(
  param: string | undefined,
  ammessi: readonly PraticaStato[] = SINGOLI,
): Prisma.PraticaWhereInput {
  if (param === 'ATTESA_FIRMA') return { ...WHERE_ATTESA_FIRMA };
  const stato = whereStato(param, ammessi);
  return stato ? { stato } : {};
}
```

`whereStato` resta pubblica e invariata (la usano `/pratiche` e i badge): la nuova
funzione la **legge**, non la ricopia.

### Conteggio del badge

`contaGruppi` resta intatta (`groupBy(['stato'])`, invariante del test preservata). Il
conteggio del nuovo tab è un `prisma.pratica.count({ where: { ...whereBase, ...WHERE_ATTESA_FIRMA } })`
aggiunto al `Promise.all` già presente in `app/admin/pratiche/page.tsx:78`, dove
`whereBase` sono i filtri attivi **meno** lo stato (così il badge combacia con ciò che
vedi cliccandolo — invariante già rispettata dalla pagina).

`tabsPraticheAdmin` cambia firma: `tabsPraticheAdmin(conteggi: ConteggiTab, attesaFirma: number)`.
TypeScript costringe il chiamante a fornire il numero: non può essere dimenticato.

### Le tre modifiche che devono restare allineate (o il tab muore in silenzio)

1. `ValoreTab` (`tabs.ts:9`) → aggiungere `'ATTESA_FIRMA'`
2. `tabAttivo()` (`tabs.ts:57`) → riconoscere `'ATTESA_FIRMA'`
3. `opzioniStatoAdmin()` (`tabs.ts:123`) → aggiungere `{ value: 'ATTESA_FIRMA', label: 'In attesa di firma' }`

Il punto 3 è l'invariante blindata da `tabs.test.ts`. Il test esistente confronta i due
elenchi e diventerà rosso da solo se il punto 3 viene saltato: **non aggirarlo**.

Posizione del tab: fra "In corso" e "In escalation" (è una coda operativa, come
l'escalation, e come quella si sovrappone di proposito a "In corso").

### Tabella, in questo tab soltanto

- **Ordinamento**: `processataAt` crescente (le più vecchie in cima). Negli altri tab
  resta `createdAt` decrescente.
- **Colonna "Quando" → "In attesa da"**: giorni da `processataAt`, con chip colorato.
  Soglie: `≤3g` neutro, `4-7g` warn, `>7g` urgent. Riusa `countdownLevel`
  (`lib/pratiche/countdown.ts`) — se le soglie non combaciano, aggiungere una funzione
  dedicata lì, non duplicare la logica in pagina.
- **Recapiti**: nelle celle Broker e Agenzia, seconda riga con il telefono.
  **Testo semplice, non link**: la riga della tabella è già un `<a>` a tutta riga e un
  `<a href="tel:">` annidato è HTML invalido.
  Fonti: `Company.telefono` per il broker; per l'agenzia `Sede.telefono` con fallback
  `Company.telefono` (la sede che lavora la pratica è quella da chiamare).
- **La grid condivisa `PRATICHE_GRID.admin` non si tocca**: stesso numero di colonne,
  cambia solo il contenuto di una cella. Zero rischio per gli altri tab (e per il test
  `table-grid.test.ts`, che conta tracce vs celle visibili per breakpoint).

I recapiti cliccabili (`tel:` / `mailto:`) stanno nel dettaglio pratica, non in lista.

## Componente 2 — Attestazione della firma da parte dell'admin

### Refactor: un solo motore

`firmaPraticaCore` oggi mescola *gate del percorso agenzia* e *motore degli effetti*. Si
estrae il motore:

```ts
type AttoreFirma =
  | { tipo: 'AGENZIA'; agenziaId: string; scope: SedeScope }
  | { tipo: 'ADMIN'; userId: string; motivo: string };

async function eseguiFirma(praticaId: string, attore: AttoreFirma): Promise<QuickActionResult>
```

**Gli effetti (transazione + post-commit) NON vengono duplicati.** Copiarli
significherebbe, prima o poi, una fattura che non parte o un payout che non scatta.
I due percorsi si distinguono solo nei gate e in cosa scrivono in più.

Dentro la transazione, dopo il `findUnique` della pratica:

- **Gate comuni** (entrambi i percorsi):
  - pratica esistente;
  - `stato === 'PROCESSATA'`;
  - **`flagSegnalata === false`** — gate nuovo, chiude il bug preesistente. Messaggio:
    "Pratica con segnalazione in verifica: non puoi firmarla finché il team non ha deciso."
- **Gate del solo percorso AGENZIA** (restano nel wrapper o nella transazione come oggi):
  `requirePermesso('pratiche.firma')`, `companyType === 'AGENZIA'`, `isAgenziaBloccata`,
  `pratica.agenziaAssegnataId === attore.agenziaId`, `assertSedeInScope`.
- **Gate del solo percorso ADMIN**: `isAdminPiattaforma(session.user.role)` — **`ASSISTENTE`
  escluso**; `motivo` non vuoto (già validato lato client, ri-validato lato server);
  `pratica.agenziaAssegnataId` non nullo.

`agenziaId` (usato nel `FeeAddebito` e in `createFatturaPv`) va letto da
`pratica.agenziaAssegnataId`, non dalla sessione: per il percorso agenzia è lo stesso
valore (lo garantisce il gate di appartenenza), per l'admin è l'unico disponibile.

L'update della pratica, nel solo percorso ADMIN, scrive anche i tre campi di traccia.

### Migration

Tre colonne su `Pratica` (pattern già in casa: `segnalazioneEsitaDaId` + `...At` + nota):

```prisma
firmaForzataDaId    String?   @db.Uuid
firmaForzataAt      DateTime?
firmaForzataMotivo  String?
```

Nullable, nessun backfill. Migration a mano + `db:deploy` (mai `pnpm db:migrate`, che
propone DROP SEQUENCE).

### Server action

`forzaFirmaAdminAction(praticaId: string, motivo: string): Promise<QuickActionResult>`
in `app/admin/pratiche/actions.ts` (nuovo file). Ritorna `{ ok: true } | { ok: false; error }`,
come le altre azioni admin.

### UI: il popup di conferma

Nel dettaglio pratica (`/pratiche/[id]`, che l'admin già usa — non esiste una detail admin
separata). CTA visibile solo se `isAdminPiattaforma(role) && stato === 'PROCESSATA' && !flagSegnalata`.

`Modal` del design system (`components/ui/modal.tsx`, pattern di `logout-button.tsx`),
contenente:

- **Gli effetti economici reali di quella pratica**, con gli importi presi dal record:
  "Verranno addebitati **€X** all'agenzia *Nome*, accreditati **€Y** al broker *Nome*,
  emessa fattura e sbloccato il payout." Non un generico "sei sicuro?".
- **Textarea di motivazione obbligatoria**, bottone disabilitato finché è vuota (stesso
  pattern del respingimento segnalazione, `admin/segnalazioni/gestione-form.tsx:65-107`).
- Bottone `variant="danger"`, `useTransition` + `LoadingOverlay`, `Alert` sull'errore.

### Traccia e trasparenza verso le parti

- **Timeline della pratica**: riga "Firma attestata dal team Passaggio Veloce il *data*",
  visibile a broker e agenzia, non solo a noi. La motivazione è visibile **solo all'admin**.
- **Email N4 (broker) e N8 (agenzia, con fattura allegata)**: partono come sempre, con una
  riga condizionale in più quando la firma è stata attestata da noi — **senza la
  motivazione**. Nessun template nuovo: un flag nel payload
  (`firmaAttestataDaPv: boolean`) e un blocco condizionale in `lib/notifiche/templates.ts`
  (`tplN4BrokerFirma:310`, `tplN8AgenziaAddebito:362`).
- **`EventoPratica`**: si riusa il tipo esistente `PRATICA_FIRMATA` (nessun tipo nuovo).

## Componente 3 — Termini e Condizioni

### Nuova clausola (bozza — da rivedere col legale, come tutta la pagina)

**Art. 11 — Attestazione della firma da parte del Gestore.**

> Completata la lavorazione da parte dell'Agenzia, la pratica resta in attesa che venga
> segnalata sulla piattaforma l'avvenuta sottoscrizione da parte del cliente. Il Gestore
> monitora le pratiche in attesa e può sollecitare Broker e Agenzia affinché provvedano.
>
> Qualora il Gestore acquisisca, per qualunque via (dichiarazione dell'Agenzia o del
> Broker, documentazione ricevuta, riscontro presso gli uffici competenti), la conoscenza
> che la sottoscrizione è già intervenuta, **può attestarla direttamente sulla piattaforma
> in luogo dell'Agenzia**.
>
> L'attestazione produce **tutti gli effetti della segnalazione ordinaria**: perfezionamento
> della pratica, maturazione del compenso del Broker, addebito della fee a carico
> dell'Agenzia ed emissione della relativa fattura.
>
> Il Gestore registra data, autore e motivazione dell'attestazione e ne dà evidenza a
> Broker e Agenzia. L'Agenzia che ritenga l'attestazione erronea può contestarla, con
> comunicazione motivata all'indirizzo di assistenza, **entro 15 giorni** dalla sua
> comunicazione; in caso di contestazione fondata il Gestore procede allo storno
> dell'addebito e all'emissione di nota di credito.
>
> L'Utente approva espressamente il presente potere di attestazione (clausola vessatoria:
> v. clausola 18).

La finestra di contestazione è **testo contrattuale, non un flusso software**: si gestisce
via email di assistenza. Nessuna implementazione.

### Rinumerazione: 12 punti da correggere

Gli articoli da 11 in poi slittano di uno. Non basta rinumerare i titoli: **i numeri sono
citati dentro il testo delle altre clausole.** Elenco completo (riferito a
`app/termini/page.tsx` allo stato attuale):

| Riga | Testo attuale | Diventa |
|---|---|---|
| 20 | commento JSDoc: `limitazioni di responsabilità (12)` | `(13)` |
| 21 | commento JSDoc: `elencate alla clausola 17` | `clausola 18` |
| 108 | `v. clausola 17` | `18` |
| 145 | `v. clausola 17` | `18` |
| 178 | `v. clausola 17` | `18` |
| 195 | `v. clausola 17` | `18` |
| 238 | `sospensione ai sensi della clausola 11` | `clausola 12` |
| 241 | `v. clausola 17` | `18` |
| 317 | `v. clausola 17` | `18` |
| 332 | `v. clausola 17` | `18` |
| 373 | `v. clausola 17` | `18` |
| 426 | `clausola 13` | `clausola 14` |

Titoli: 11→12 (Limitazione operativa), 12→13 (Limitazioni di responsabilità), 13→14
(Modifiche), 14→15 (Durata), 15→16 (Dati personali), 16→17 (Legge e foro),
17→18 (Approvazione specifica).

Riferimenti a clausole ≤ 10 (righe 18, 19, 24, 136, 139, 145, 194, 235, 250, 269, 301,
341): **invariati**, non toccarli.

Attenzione: alcune righe contengono **due** riferimenti. La riga 145 cita sia la clausola 10
(invariata) sia la 17 (→18); la 241 cita la 3 (invariata) e la 17 (→18); la 194-195 cita la 6
(invariata) e la 17 (→18). Correggere solo il secondo, non entrambi.

### Fonte unica dei numeri: `lib/legal/clausole-vessatorie.ts` (nuovo)

Oggi l'elenco dei numeri vessatori è scritto a mano in **due posti**: nel testo dell'art. 17
(`app/termini/page.tsx:377`) e nella checkbox di registrazione
(`register-wizard.tsx:1058`, "clausole nn. 3, 5, 7, 8, 10, 11, 12, 16"). Aggiungendo una
clausola vessatoria, due posti da tenere allineati a mano — la ricetta esatta per un
contratto che si contraddice.

```ts
/** Numero dell'articolo di approvazione specifica ex artt. 1341-1342 c.c. */
export const ART_APPROVAZIONE_SPECIFICA = 18;

/** Clausole vessatorie da approvare specificamente. Ordinate. */
export const CLAUSOLE_VESSATORIE = [3, 5, 7, 8, 10, 11, 12, 13, 17] as const;

/** Versione dei Termini accettata, persistita su Company.termsVersion. */
export const TERMS_VERSION = '2026-07-13';
```

- Le **9 occorrenze** di "v. clausola 17" nel testo diventano interpolazioni di
  `ART_APPROVAZIONE_SPECIFICA`: quel numero non può più divergere.
- L'elenco nell'art. 18 e quello nella checkbox del wizard sono **entrambi renderizzati da
  `CLAUSOLE_VESSATORIE`**: non possono più divergere.
- Test (`clausole-vessatorie.test.ts`): l'elenco è ordinato, senza duplicati, e ogni numero
  è ≤ `ART_APPROVAZIONE_SPECIFICA - 1`.

### Persistenza dell'approvazione (il pezzo che rende la clausola opponibile)

Oggi `clausoleVessatorieAccepted` è validata da Zod (`lib/auth/schemas.ts:87`) e poi
**buttata via**: sul DB c'è solo `Company.termsAcceptedAt` (`schema.prisma:376`). In una
contestazione non abbiamo prova né dell'approvazione specifica ex 1341, né di *quale
versione* dei Termini l'utente ha accettato. Senza questo, la clausola nuova è carta
straccia.

Migration, su `Company`:

```prisma
clausoleVessatorieAcceptedAt DateTime?
termsVersion                 String?
```

Scritte in `app/(auth)/actions.ts:459`, dove già si scrive `termsAcceptedAt`.
`termsVersion` prende `TERMS_VERSION`. Nullable + nessun backfill: le aziende già
registrate restano a `null`, il che è la verità (non hanno approvato *questa* versione).

Nessuna re-accettazione forzata per gli utenti esistenti: si applica l'art. 14 (Modifiche
ai Termini), come deciso.

## Cosa NON è in questo lavoro

- **Nessuna email di sollecito** dall'admin (deciso: solo recapiti in chiaro).
- **Nessun flusso di contestazione** software: la finestra di 15 giorni è contrattuale.
- **Nessun modello `AuditLog` generico**: si usa il pattern a colonne già in casa.
- **Nessuna re-accettazione forzata** dei Termini per gli utenti esistenti.
- **Non si estende il job `send-solleciti` allo stato `PROCESSATA`.** È un buco reale
  (le pratiche in attesa di firma non ricevono alcun sollecito automatico) ma è fuori
  perimetro: **follow-up da valutare a parte.**

## Verifica

Test unitari:
- `stati.test.ts`: `whereTabPratiche('ATTESA_FIRMA')` ⇒ `{ stato: 'PROCESSATA', flagSegnalata: false }`;
  delega a `whereStato` per gli altri valori; valore ignoto ⇒ `{}` (nessun filtro).
- `tabs.test.ts`: l'invariante esistente (ogni valore dei tab esiste in `opzioniStatoAdmin`)
  deve continuare a passare **con `ATTESA_FIRMA` incluso**. Va vista rossa prima di
  aggiungere l'`<option>`, altrimenti non dimostra nulla.
- `clausole-vessatorie.test.ts`: elenco ordinato, senza duplicati, coerente con
  `ART_APPROVAZIONE_SPECIFICA`.
- Gate della firma: pratica con `flagSegnalata` ⇒ rifiutata su **entrambi** i percorsi;
  `ASSISTENTE` ⇒ rifiutato sul percorso admin.

Verifica manuale sul DB locale (copia di prod), prima di chiudere:
- la query del tab in read-only su postgres locale, per vedere che restituisce davvero
  le pratiche attese e non quelle segnalate;
- una forzatura end-to-end su una pratica `PROCESSATA` di test: controllare che nascano
  `FeeAddebito`, `TransazioneWallet`, `DocumentoFiscale`, e che le email N4/N8 riportino
  la riga sull'attestazione.

I riferimenti incrociati dei Termini vanno verificati **sul DOM renderizzato**, non sui
byte del sorgente.

## Rischi

1. **Il tab che sparisce in silenzio.** Se si dimentica l'`<option>` in `opzioniStatoAdmin`,
   il tab funziona finché non tocchi un altro filtro, poi svanisce senza errori. Mitigato
   dal test esistente in `tabs.test.ts`.
2. **La rinumerazione dei Termini.** 12 punti; sbagliarne uno rende il contratto
   auto-contraddittorio. Mitigato dalla fonte unica per l'occorrenza più ripetuta (9 su 12).
3. **La KB del chatbot è generata dai docs al prebuild** (`lib/providers/chatbot/kb/kb.generated.ts`):
   dopo la modifica ai Termini va rigenerata, o il chatbot cita i numeri vecchi.
4. **Duplicare gli effetti della firma invece di estrarre il motore.** Sarebbe il bug più
   costoso possibile: una fattura non emessa o un payout non scattato. Il refactor a
   `eseguiFirma` non è opzionale.
