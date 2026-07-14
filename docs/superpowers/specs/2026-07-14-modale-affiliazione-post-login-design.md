# Modale affiliazione post-login — design

> **Data:** 2026-07-14
> **Obiettivo business:** il programma di affiliazione è un motore di crescita
> organica (autoalimenta le registrazioni) ed è anche uno strumento di guadagno
> per broker e agenzie. Oggi vive dietro una voce di sidebar e rischia di passare
> in sordina. Va pubblicizzato attivamente a chi ha il permesso di usarlo.

---

## 1. Comportamento

Dopo il login compare una modale che sponsorizza il programma di affiliazione.

- Contiene una checkbox **"Non mostrare più"**. Se spuntata alla chiusura, la
  presa visione è data per assodata e la modale non riappare mai più per
  quell'utente.
- Se non spuntata, la modale **riappare al login successivo** (non a ogni
  navigazione: vedi §4).

## 2. Pubblico

Vedono la modale gli utenti che hanno **`affiliazione.view`** e la cui azienda è
**DEALER o AGENZIA**. In pratica: proprietario azienda (owner: permesso
implicito), `ADMIN_SEDE`, `OPERATORE_COMPLETO`. **Non** `OPERATORE_BASE`, **non**
gli admin di piattaforma o gli assistenti.

Scelta deliberata di massima diffusione: anche un operatore può condividere il
link della propria sede, e click/registrazioni vengono attribuiti a quella sede.

**Vincolo di onestà sulla copy:** la commissione si accredita sul **wallet della
madre**, che solo il proprietario vede e incassa (`wallet/page.tsx:246-248`). La
copy deve quindi dire *"sul wallet della tua azienda"*, mai *"ti bonifichiamo"*.
Un operatore che si aspetta un pagamento personale è una promessa non
mantenuta.

## 3. Contenuto della modale

| Blocco | Contenuto |
|---|---|
| Titolo | "Invita un collega, guadagna su ogni sua pratica" |
| Tre numeri | Commissione passaggio semplice (per veicolo) · commissione minivoltura (per veicolo) · "Per sempre" |
| Come funziona | 1. Condividi il link · 2. Il collega si registra · 3. Ogni sua pratica firmata accredita la commissione |
| Il tuo link | Link della sede, già pronto, con bottone **Copia** e bottone **WhatsApp** (messaggio precompilato) |
| Small print | "Le commissioni si accreditano sul wallet della tua azienda. Il payout si richiede da €500." |
| Footer | checkbox "Non mostrare più" · **Chiudi** · CTA primaria **"Scopri il programma"** → `/affiliazione` |

**Gli importi NON sono hardcodati.** Il listino autorevole è il tariffario
editabile da `/admin/tariffe` (`docs/sistema-affiliazione.md:36`); i valori si
derivano da `computeFees(...).costoAffiliazioneTotaleCent` con
`getTariffarioCorrente()`, esattamente come la tabella commissioni della pagina
`/affiliazione`. Un popup che promette €10 mentre il tariffario dice altro è una
promessa falsa.

Lo **share WhatsApp** era previsto dalla spec di affiliazione (§5.3) e non è mai
stato implementato: è l'attrito più basso possibile tra "ho visto il popup" e
"ho invitato qualcuno".

## 4. Persistenza — due livelli distinti

Il vincolo che detta il design: **la chrome autenticata rimonta a ogni cambio
rotta** (commento esplicito in `sidebar-shell.tsx:88-90` — non esiste un layout
autenticato persistente). Una modale con solo `useState` riapparirebbe a ogni
click.

| Livello | Meccanismo | Effetto |
|---|---|---|
| "una volta per login" | cookie di sessione `pv_aff_spot` (no `Max-Age`, leggibile da JS) | il client, se il cookie c'è, non fa nemmeno la fetch; la modale non riappare navigando |
| "non mostrare più" | colonna `User.affiliazioneSpotDismissedAt DateTime?` | gate server-side permanente, cross-device |

Il cookie viene settato **dalla risposta della GET**, sempre — anche quando la
risposta è `show: false`. Altrimenti un utente senza permesso rifarebbe la fetch
a ogni navigazione.

`loginAction` **cancella** il cookie prima di `signIn()`: un nuovo login
rimostra la modale. Essendo un cookie di sessione, muore anche alla chiusura del
browser.

## 5. Architettura

```
lib/affiliazione/spot-cookie.ts   const AFF_SPOT_COOKIE  (no 'server-only': lo legge anche il client)
lib/affiliazione/link.ts          resolveReferralLink()  ← FONTE UNICA del link referral
lib/affiliazione/spot.ts          getAffiliazioneSpot()  ← gate + payload
app/api/affiliazione/spot/route.ts  GET (payload + set cookie) · POST (dismiss definitivo)
components/affiliazione/affiliazione-spot.tsx  client, riusa <Modal> da @/components/ui
```

**`resolveReferralLink()` è un'estrazione, non una copia.** La logica "sede
operativa, altrimenti prima sede accessibile, altrimenti `Company.referralCode`
legacy" vive oggi inline in `app/affiliazione/page.tsx:59-70,190-194`. Viene
spostata nell'helper e la pagina la **legge** da lì. Duplicarla significherebbe
che il giorno che cambia la risoluzione del link, il popup e la pagina mostrano
link diversi.

**Gate di `getAffiliazioneSpot()`** (tutti necessari, fail-closed):
1. sessione con `companyId`
2. `companyType` ∈ {DEALER, AGENZIA}
3. `hasPermesso('affiliazione.view')`
4. `user.affiliazioneSpotDismissedAt === null`
5. link referral risolvibile

**Mount:** `<AffiliazioneSpot />` in `broker-shell.tsx` e `agenzia-shell.tsx`,
accanto a `<EventoPraticaWatcher />` dentro il `ToastProvider`. **Non** in
`AdminShell` (che tra l'altro non monta nemmeno il ToastProvider).

## 6. Migration

Additiva e nullable, zero rischio sui dati esistenti:

```sql
ALTER TABLE "users" ADD COLUMN "affiliazioneSpotDismissedAt" TIMESTAMP(3);
```

Scritta a mano (`pnpm db:migrate` propone DROP SEQUENCE) e applicata con
`db:deploy`, come da processo di rilascio.

## 7. Verifica

**Test automatici**
- `spot.test.ts` — il gate: permesso mancante, companyType admin, già dismesso,
  sede senza `referralCode`, happy path.
- `route.test.ts` — la GET setta il cookie anche con `show: false`; la POST
  scrive `affiliazioneSpotDismissedAt`.
- component test — chiusura con checkbox → POST; chiusura senza checkbox → nessun
  POST.

**Verifica nel browser (non opzionale).** I due bug che questa feature può
introdurre — modale che riappare a ogni click, focus rubato dal modale — sono
entrambi invisibili ai test unitari. Sequenza: login → appare; navigo tra pagine
→ non riappare; logout + login → riappare; spunto la checkbox e chiudo → non
riappare più, nemmeno dopo un nuovo login.

## 8. Fuori scope

- Metriche di conversione del popup (quanti hanno copiato il link / cliccato la
  CTA). Il flag `affiliazioneSpotDismissedAt` è già interrogabile per sapere
  quanti l'hanno silenziato; il resto è una feature a parte.
- Video tutorial (previsto dalla spec §5.2, tuttora mancante anche sulla pagina).
