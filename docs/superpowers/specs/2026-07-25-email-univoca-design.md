# Email univoca sull'intera piattaforma

**Data:** 2026-07-25
**Stato:** approvato
**Ambito:** modello `User` — registrazione azienda, utenze team, assistenti e
utenti team di piattaforma, cambio email dal profilo.

## Problema

È possibile registrare due account con la stessa email. Non è una regressione:
è una scelta deliberata del 2026-05 che va revocata.

La migration `20260505224500_team_email_per_company` ha rimosso l'unique globale
su `users.email` e l'ha sostituito con due indici:

```sql
CREATE UNIQUE INDEX "users_companyId_email_key" ON "users"("companyId", "email");
CREATE UNIQUE INDEX "users_email_admin_platform_key"
  ON "users"("email") WHERE "companyId" IS NULL;
```

Il razionale scritto nella migration: «la stessa email puo' esistere in piu'
aziende (es. fra dealer e agenzia)». Il partial index serve perché in PostgreSQL
due righe `(NULL, 'x@y')` non sono duplicati, quindi senza di esso due admin di
piattaforma potrebbero condividere l'email.

Conseguenza diretta: la registrazione (`app/(auth)/actions.ts:450`) blocca
l'email **solo** se collide con un admin di piattaforma.

```ts
const existingAdmin = await prisma.user.findFirst({
  where: { email: emailLower, companyId: null },
});
```

Due aziende diverse si registrano quindi con la stessa email senza che nulla lo
impedisca.

### La scelta si è propagata nei read path

Non è un solo `where` da stringere. Il resto del codice è stato scritto
assumendo N account per email:

- `auth.ts:37` — `authorize` fa `findMany` sui candidati attivi e prova
  `bcrypt.compare` **contro ognuno**, con tie-break `companyId asc, createdAt asc`
  e l'admin di piattaforma che prevale.
- `app/(auth)/actions.ts:92` — il pre-check di `loginAction` (decide se serve il
  2FA) ripete lo stesso pattern sulla query condivisa
  `activeUserCredentialsQuery`.
- `app/(auth)/actions.ts:722` — la verifica email fa `updateMany` su *tutti* gli
  User `PENDING_EMAIL_VERIFICATION` con quell'email.
- `app/(auth)/actions.ts:1114` — il reset password fa `updateMany` su *tutti* gli
  User con quell'email.
- `app/profilo/personale/actions.ts:113` — il cambio password dal profilo, idem.

### Stato del dato

Sulla copia locale di prod: **29 utenti, 29 email distinte, 0 duplicati, 0
soft-deleted, 0 email non-lowercase**. La multi-tenancy dell'email non è mai
stata usata davvero, quindi non c'è niente da consolidare — solo da vincolare.

Nessun codice applicativo referenzia la chiave composta `companyId_email`: il
compound unique compare solo nella SQL della migration. Il cambio di schema è
quindi contenuto.

## Obiettivo

Un'email identifica **un solo account** su tutta la piattaforma: aziende, utenti
team, admin e assistenti condividono lo stesso spazio dei nomi. Il login
ridiventa deterministico — un'email, un account, un `bcrypt.compare`.

## Decisioni prese

1. **Unicità globale, staff incluso.** Nessuna eccezione per gli admin di
   piattaforma. È la lettura letterale del requisito ed è ciò che rende il login
   non ambiguo.
2. **L'eliminazione di un utente NON libera l'email da subito.** Vincolo secco
   sul check applicativo e sul DB, senza filtro su `deletedAt`: l'email resta
   occupata finché il job di purge GDPR non anonimizza l'utente (fino a 90
   giorni, vedi "Conseguenze accettate" per il dettaglio e il prezzo nel
   frattempo).
3. **Nessun backfill né periodo di grazia.** I dati in prod sono usa-e-getta
   (tutti si ri-registrano): niente eccezioni per i record esistenti.

## Design

### 1. Schema e migration

In `packages/db/prisma/schema.prisma`:

- `email String @unique` (era `email String`)
- rimuovere `@@unique([companyId, email])` (`:620`)
- rimuovere `@@index([email])` (`:623`) — l'indice unique lo rende ridondante e
  un secondo btree sulla stessa colonna costa solo scritture

Migration `20260725140000_user_email_unique`:

```sql
DROP INDEX IF EXISTS "users_companyId_email_key";
DROP INDEX IF EXISTS "users_email_admin_platform_key";
DROP INDEX IF EXISTS "users_email_idx";

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK (email = lower(email));
```

**Perché il `CHECK`.** Un unique btree è case-sensitive: `Mario@x.it` e
`mario@x.it` resterebbero due account distinti, cioè esattamente il bug che
stiamo chiudendo, per un'altra strada. Tutti i write path fanno già
`.toLowerCase()`; il vincolo garantisce che un path futuro non possa
dimenticarsene. Se succede è un 500 invece di un messaggio gentile — il
comportamento giusto per un bug di programmazione, non per un errore d'utente.

**Pre-flight su Neon prod (`ep-solitary-night`), obbligatorio prima di
`migrate deploy`.** La copia locale ha qualche giorno e la migration fallisce a
metà se il dato non è pulito:

```sql
SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
SELECT id, email FROM users WHERE email <> lower(email);
```

Entrambe devono restituire zero righe. Se non lo fanno, si decide caso per caso
prima di procedere — non si forza.

`pnpm db:migrate` non va usato: propone DROP distruttivi. Migration scritta a
mano + `db:deploy`.

### 2. Modulo condiviso `src/lib/auth/email-univoca.ts`

Fonte unica della regola. Espone:

- `normalizzaEmail(raw: string): string` — trim + lowercase, un solo posto.
- `EMAIL_GIA_IN_USO` — messaggio per i path interni (chi è già autenticato).
- `EMAIL_GIA_REGISTRATA` — variante per la registrazione pubblica, dove
  l'utente è anonimo e serve dirgli cosa fare. Vedi §3.
- `emailGiaInUso(emailLower, opts?: { escludiUserId?: string }): Promise<boolean>`
  — check **globale**: nessun filtro su `companyId`, **nessun filtro su
  `deletedAt`** (coerente con la decisione 2). `escludiUserId` serve ai path di
  modifica, dove l'utente non deve collidere con sé stesso.
- `isViolazioneEmailUnica(error: unknown): boolean` — riconosce P2002 su
  `users_email_key` leggendo `error.meta.target`.

I consumer devono **chiamare** l'helper, non ricopiarne la `where`: aggiungere
una regola qui non deve poter sparire in silenzio da un call site che ha
duplicato la query.

### 3. I punti di scrittura da stringere

| File | Oggi blocca se… | Dopo |
|---|---|---|
| `app/(auth)/actions.ts:450` registrazione | collide con admin platform | globale |
| `app/team/actions.ts:213` invito | stessa azienda | globale |
| `app/team/actions.ts:305` accetta invito | stessa azienda | globale |
| `app/team/actions.ts:386` creazione diretta | stessa azienda | globale |
| `app/team/actions.ts:493` modifica email | stessa azienda | globale |
| `app/admin/assistenti/actions.ts:51` crea assistente | `companyId = null` | globale |
| `app/admin/assistenti/actions.ts:134` modifica assistente | `companyId = null` | globale |
| `app/admin/crm/utenti/actions.ts:89` crea utente team | `companyId = null` | globale |
| `app/admin/crm/utenti/actions.ts:164` modifica utente team | `companyId = null` | globale |
| `app/profilo/personale/actions.ts:42` cambio email | scope-aware | globale |

**Messaggi.** Due soli testi, a seconda che chi legge sia autenticato o no.

I nove path interni convergono su `EMAIL_GIA_IN_USO`:

> Questa email è già associata a un account Passaggio Veloce

Cinque di questi oggi dicono «nella tua azienda». Diventerebbe **falso** nel caso
nuovo più comune: un admin che crea un utente la cui email esiste in un'azienda
che lui non può vedere leggerebbe un messaggio che descrive una collisione
inesistente nel suo perimetro, e cercherebbe l'utente dove non c'è.

Non riveliamo *quale* azienda: sarebbe enumerazione di anagrafica altrui.

La registrazione usa invece `EMAIL_GIA_REGISTRATA`, che porta una via d'uscita
perché lì l'utente è anonimo e non ha modo di sapere cosa fare:

> Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.

Il campo resta `account.email`, così il wizard evidenzia il punto giusto.

### 4. Le race le chiude il DB, non il check

Il controllo applicativo è TOCTOU: due registrazioni simultanee con la stessa
email passano entrambe il `findFirst` e arrivano entrambe alla `create`. Il
vincolo unique è l'unica garanzia reale; il check applicativo esiste solo per
dare un messaggio decente nel caso normale.

Ogni `create`/`update` di User cattura quindi P2002 via `isViolazioneEmailUnica`
e risponde con lo stesso messaggio del check applicativo, sul campo giusto,
invece di propagare un 500. L'utente non deve poter distinguere il caso normale
dalla race.

In registrazione il catch P2002 **esiste già** (`app/(auth)/actions.ts:763`) ma
risponde `'Dato gia esistente'` **senza `field`**, quindi il wizard non evidenzia
nulla e l'utente non sa quale campo correggere. Va letto `error.meta.target` per
distinguere `users_email_key` (→ `account.email`) da
`companies_partitaIva_key` (→ `company.partitaIva`).

### 5. Read path da semplificare

Con l'unicità globale la gestione multi-candidato descrive uno stato che il
write path non può più produrre. Va rimossa, non lasciata a documentare un mondo
che non esiste:

- `auth.ts:37` — `findMany` + loop `bcrypt.compare` → `findFirst`. Cade anche il
  tie-break `companyId asc`. Effetto collaterale positivo: il login fa
  esattamente un `bcrypt.compare` invece di N.
- `app/(auth)/actions.ts:92` — pre-check 2FA, idem.
- `app/(auth)/actions.ts:722` — verifica email: `updateMany` → riga singola.
- `app/(auth)/actions.ts:1114` — reset password: `updateMany` → riga singola.
- `app/profilo/personale/actions.ts:113` — cambio password: `updateMany` → riga
  singola.

`activeUserCredentialsQuery` (`src/lib/auth/credentials-query.ts`) **resta la
fonte unica** del filtro `email + deletedAt + status`, condivisa fra `auth.ts` e
`loginAction`: cambia il metodo di chiamata, non la `where`. Le due query non
devono divergere, che è la ragione per cui quel modulo esiste.

### 6. Inviti

Nessun cambio di schema su `Invitation` (`email` non è unica, e non deve
diventarlo: un invito revocato o scaduto non deve bloccare nulla).

Il check sugli inviti pending duplicati (`app/team/actions.ts:222`) è **già
globale** e resta com'è. Quello che cambia è il check sull'esistenza dell'utente,
in due momenti:

- alla **creazione** dell'invito (`:213`), per non invitare qualcuno che ha già
  un account altrove;
- all'**accettazione** (`:305`), perché fra invio e accettazione l'email può
  essere stata presa da un'altra registrazione.

## Test

**Prima il rosso.** Il test di regressione si scrive contro il comportamento
attuale e lo si vede fallire prima del fix: registrazione con un'email già
appartenente a un utente di un'**altra** azienda → deve essere rifiutata. Un test
mai stato rosso non dimostra niente.

- `src/lib/auth/email-univoca.test.ts` — normalizzazione (spazi, maiuscole),
  check globale cross-company, esclusione di sé stessi con `escludiUserId`,
  riconoscimento P2002 sul target giusto e non su un unique diverso.
- Aggiornare `app/team/actions.authz.test.ts` e `app/team/permessi.authz.test.ts`:
  mockano Prisma e asseriscono sulla `where`, che cambia.
- Copertura dei 10 call site: ognuno rifiuta un'email presa altrove.
- **Sul DB vero, non solo sui mock** (i test mockano Prisma, quindi da soli non
  provano che il vincolo esista): applicare la migration in locale e tentare a
  mano l'inserimento di un duplicato — cross-company, admin platform, e stessa
  email con case diverso.
- **Nel browser, col gesto reale:** registrare due volte la stessa email dal
  wizard e verificare che il messaggio compaia *sul campo email*, non come errore
  generico. `pnpm typecheck` e vitest non vedono la UI.

## Conseguenze accettate

- Chi opera **sia come dealer sia come agenzia** deve usare due email diverse.
  Nessuno lo sta facendo oggi (0 duplicati in prod).
- **Eliminare un utente occupa la sua email fino a 90 giorni**, su tutta la
  piattaforma — non per sempre. `disableTeamUserAction` (`app/team/actions.ts:620`)
  fa `status: SUSPENDED` + `deletedAt: now()`, e **non esiste alcun percorso di
  riattivazione**: il rimedio a un'eliminazione sbagliata nei 90 giorni richiede
  un intervento a mano sul DB. Dopo `RETENTION_DAYS = 90`, il job
  `lib/jobs/purge-deleted-team-users.ts` (schedulato ogni giorno alle 03:00,
  vedi `vercel.json`, path `/api/jobs/purge-deleted-team-users`) anonimizza
  l'utente per conformità GDPR — riscrive l'email in
  `deleted-<id>@deleted.invalid` — e da quel momento l'email originale torna
  libera. Scelta esplicita, presa consapevolmente: il prezzo è la finestra fino
  a 90 giorni, non un blocco permanente.

## Fuori scope

- **Pulsante "riattiva utente"** che annulli l'eliminazione. Renderebbe indolore
  la conseguenza qui sopra ed è il follow-up naturale, ma è una feature a sé:
  tocca UI, permessi e semantica di `deletedAt`. Da valutare separatamente.
- Unicità di `Company.email` e `Company.pec`: sono recapiti di contatto, non
  credenziali. Non entrano.
- Scadenza degli inviti `PENDING` (un invito mai accettato blocca nuovi inviti
  alla stessa email a tempo indefinito). Pre-esistente, indipendente da questa
  modifica.

## Rilascio

Ordine obbligato, migration **prima** del codice: il codice nuovo assume il
vincolo, il codice vecchio **sopravvive** al vincolo attivo — ma non tutto allo
stesso modo. Nella finestra fra la migration e il deploy, la vecchia
`registerAction` cattura P2002 genericamente e risponde `'Dato gia esistente'`
(brutto ma innocuo), mentre `acceptInvitationAction`, `createUserDirectAction`,
`updateTeamUserAction` e le quattro action admin **non avevano alcuna
gestione di P2002**: una collisione su una di queste lancia e l'utente vede un
500. La finestra è quindi accettabile ma non benigna su tutti i path; va
tenuta il più corta possibile.

1. Pre-flight duplicati su Neon prod → deve dare zero righe.
2. `migrate deploy` su Neon prod.
3. Push su `main` (deploy Vercel).

Invertire l'ordine lascerebbe in prod codice che promette unicità senza che il
DB la garantisca, esattamente durante la finestra in cui due registrazioni
concorrenti possono passare.
