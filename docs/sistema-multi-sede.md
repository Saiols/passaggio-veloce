# Sistema Multi-Sede (Azienda Madre → N Sedi)

> Spec di design — 2026-06-24
> Stato: APPROVATA (design), in attesa di piano di implementazione.
> Owner: Francesco Sioli (CTO). Stakeholder prodotto: Andrea Saino (CEO).

## 1. Contesto e obiettivo

Oggi la piattaforma assume **1 registrazione = 1 broker / 1 agenzia**: il modello
`Company` rappresenta sia il soggetto giuridico sia l'unità operativa, e ogni
`User` appartiene a una sola `Company` (vedi `packages/db/prisma/schema.prisma`,
modelli `Company` righe 288-422 e `User` righe 424-487).

Vogliamo passare a **1 registrazione = N broker / N agenzie**: un'**azienda madre**
(unico soggetto giuridico) che raggruppa più **sedi** operative. Esempio reale:
"AutoScout" gestisce ~20 agenzie fisiche diverse sotto la stessa P.IVA.

I flussi pratica restano identici (un broker che interagisce con una singola
agenzia): cambia solo che sopra broker e agenzia c'è un'azienda madre che vede i
risultati aggregati di tutte le sue sedi e di quelle delle altre madri legate a lei
(affiliazione). **Le relazioni 1:1 continuano a esistere** come caso particolare
(madre con una sola sede).

## 2. Decisioni di prodotto (input dello stakeholder)

| # | Tema | Decisione |
|---|------|-----------|
| D1 | Struttura legale | **P.IVA unica (filiali)**: la madre è l'unico soggetto giuridico; le sedi NON hanno P.IVA propria. KYC, mandato SEPA, fatturazione, regime fiscale, fee fanno capo alla madre. |
| D2 | Ruolo madre | **Solo supervisione**: la madre non crea/riceve pratiche. Nel caso 1:1 coincide automaticamente con la sua unica sede operativa. |
| D3 | Tipi | **Single-type**: una madre è un gruppo di soli broker (DEALER) *oppure* sole agenzie (AGENZIA). Mai misto. |
| D4 | Accesso utenti | **Login multi-sede**: un utente può operare su un sottoinsieme di sedi (relazione utente↔sedi molti-a-molti). |
| D5 | Wallet/payout | **Wallet per sede** + payout all'IBAN della sede (fallback IBAN madre). La madre ha un wallet dedicato per le commissioni di affiliazione + reportistica aggregata. |
| D6 | Affiliazione | **Codice referral per sede** → la commissione è accreditata alla **madre**, con attribuzione alla sede che ha affiliato (classifica "chi affilia di più"). L'affiliazione è sempre **madre → madre**. |
| D7 | Gestione utenti | **Admin di sede delegabile**: oltre al proprietario madre, una sede può avere un proprio admin che gestisce utenti/impostazioni di QUELLA sede. |

### Vincoli confermati (out of scope)
- Una sede **non** può cambiare madre.
- Una sede **non** è condivisa tra due madri.
- Una madre **non** è mai mista (broker + agenzie insieme).
- La madre **non** opera direttamente (niente pratiche in capo alla madre).
- Le sedi **non** hanno P.IVA / fatturazione / mandato SEPA propri.

## 3. Terminologia

- **Azienda madre** (`Company`): soggetto giuridico/fiscale. Tiene P.IVA, KYC,
  SEPA, fatturazione, regime fiscale, IBAN di default, ruolo di affiliazione.
- **Sede** (`Sede`, nuovo modello): unità operativa senza P.IVA propria. Eredita
  il `type` (DEALER/AGENZIA) dalla madre. È l'entità su cui si agganciano pratiche,
  assegnazione, calendario, wallet, valutazioni, referral.
- **Proprietario** (`User` con `role = ADMIN_AZIENDA`): admin della madre, accesso
  implicito a **tutte** le sedi.
- **Admin di sede** (`UserSede.ruolo = ADMIN_SEDE`): gestisce utenti/impostazioni
  della/e sua/e sede/i.
- **Operatore** (`UserSede.ruolo = OPERATORE`): operatività sulla/e sua/e sede/i.

## 4. Approccio architetturale

**Scelto: nuovo modello `Sede` con `Company` come madre.** La `Company` resta il
soggetto giuridico/fiscale (logica fatturazione/SEPA/KYC **invariata**, è in
produzione e va toccata il meno possibile). I sottosistemi **operativi** si
ri-agganciano alla `Sede`; quelli **legali/fiscali** restano sulla `Company`.

Scartato: self-relation su `Company` (`parentId`). Renderebbe `partitaIva` (oggi
`@unique`, obbligatoria) fittizia sulle figlie, ambiguo il wallet 1:1, e
costringerebbe fatturazione/SEPA/KYC a "risalire al padre" con semantica confusa.

## 5. Modello dati (Prisma)

Sorgente: `packages/db/prisma/schema.prisma`.

### 5.1 Nuovi enum/modelli

```prisma
enum RuoloSede {
  ADMIN_SEDE
  OPERATORE
}

model Sede {
  id        String  @id @default(uuid()) @db.Uuid
  companyId String  @db.Uuid
  company   Company @relation("CompanySedi", fields: [companyId], references: [id], onDelete: Cascade)

  // Tipo ereditato dalla madre (denormalizzato per scoping/query veloci).
  // Invariante D3: tutte le sedi di una madre hanno lo stesso type della madre.
  type CompanyType

  // Identità operativa
  nome      String  // insegna/etichetta sede (può differire da ragioneSociale madre)
  indirizzo String
  civico    String?
  citta     String
  cap       String
  provincia String
  telefono  String?
  email     String? // email operativa sede (notifiche operative)

  // Pagamenti
  iban                String? // null → usa Company.iban (madre)
  payoutThresholdCent Int     @default(100000) // default come Company attuale

  // Affiliazione (D6): codice referral per sede
  referralCode String? @unique

  codiceInterno String?

  // Stato
  suspendedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  // Relations operative (re-pointing dei modelli esistenti)
  praticheBroker        Pratica[]                 @relation("PraticheBrokerSede")
  praticheAgenzia       Pratica[]                 @relation("PraticheAgenziaSede")
  assegnazioni          PraticaAssegnazione[]
  orariApertura         OrariApertura[]
  chiusureStraordinarie ChiusuraStraordinaria[]
  listini               Listino[]
  valutazioniRicevute   Valutazione[]             @relation("ValutazioniAgenziaSede")
  valutazioniFatte      Valutazione[]             @relation("ValutazioniBrokerSede")
  wallet                Wallet?                   @relation("WalletSede")
  feeAddebiti           FeeAddebito[]
  referralClicks        ReferralClick[]
  membership            UserSede[]
  eventi                EventoPratica[]
  notifiche             NotificaInviata[]
  commissioniAttribuite CommissioneAffiliazione[] @relation("SedeAffiliante")
  companiesAffiliate    Company[]                 @relation("SedeReferral")

  @@index([companyId])
  @@index([type])
  @@index([citta])
  @@index([provincia])
  @@map("sedi")
}

model UserSede {
  id     String    @id @default(uuid()) @db.Uuid
  userId String    @db.Uuid
  user   User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  sedeId String    @db.Uuid
  sede   Sede      @relation(fields: [sedeId], references: [id], onDelete: Cascade)
  ruolo  RuoloSede @default(OPERATORE)

  createdAt DateTime @default(now())

  @@unique([userId, sedeId])
  @@index([sedeId])
  @@index([userId])
  @@map("user_sedi")
}
```

> Nota sul proprietario: `ADMIN_AZIENDA` ha accesso implicito a TUTTE le sedi della
> sua madre — NON richiede righe `UserSede`. Le righe `UserSede` esistono solo per
> utenti non-proprietari (operatori e admin di sede) scoped a sedi specifiche.

### 5.2 Modifiche a `Company` (madre)

Aggiungere:
```prisma
  sedi            Sede[]   @relation("CompanySedi")

  // Affiliazione: la sede (della madre referente) che ha condiviso il link.
  // referenteId resta e punta SEMPRE a una madre (affiliazione madre→madre, D6).
  referenteSedeId String?  @db.Uuid
  referenteSede   Sede?    @relation("SedeReferral", fields: [referenteSedeId], references: [id])

  // Wallet affiliazione della madre (D5). 1:1 dedicato alle commissioni.
  // (la relation `wallet` esistente viene ridefinita: vedi §5.5)
```

`Company.referralCode` (riga 350): **deprecato** come sorgente primaria. Il valore
esistente migra sulla sede auto-creata (§6). Mantenuto in sola lettura per
risolvere vecchi link `/r/<code>` (lookup fallback). Nessuna nuova generazione su
`Company`.

`Company.type` resta la fonte del tipo (single-type, D3); `Sede.type` lo denormalizza.

### 5.3 Modifiche a `User` / inviti

`User.companyId` **resta** (l'utente appartiene alla madre). Aggiungere relation:
```prisma
  sediMembership UserSede[]
```

`Invitation` (righe 506-528): aggiungere il target sede + ruolo sede.
```prisma
  // Sede di destinazione dell'invito (null = invito a livello madre, solo per ADMIN_AZIENDA)
  sedeId    String?   @db.Uuid
  ruoloSede RuoloSede @default(OPERATORE)
```
L'accettazione invito crea lo `User` **e** la membership `UserSede` corrispondente.

### 5.4 Re-pointing dei modelli operativi (Company → Sede)

| Modello | Campo attuale (→ Company) | Nuovo campo (→ Sede) |
|---|---|---|
| `Pratica` | `brokerId` / `broker` | `brokerSedeId` / `brokerSede` (`@relation("PraticheBrokerSede")`) |
| `Pratica` | `agenziaAssegnataId` / `agenziaAssegnata` | `agenziaSedeId` / `agenziaSede` (`@relation("PraticheAgenziaSede")`) |
| `PraticaAssegnazione` | `agenziaId` / `agenzia` | `sedeId` / `sede` |
| `OrariApertura` | `agenziaId` | `sedeId` |
| `ChiusuraStraordinaria` | `agenziaId` | `sedeId` |
| `Listino` | `agenziaId` | `sedeId` |
| `Valutazione` | `agenziaId` (ric.) / `dealerId` (fatta) | `agenziaSedeId` / `brokerSedeId` |
| `Wallet` | `companyId @unique` | vedi §5.5 |
| `FeeAddebito` | `agenziaId` | `agenziaSedeId` (attribuzione; addebito via mandato madre, §11) |
| `ReferralClick` | `companyId` | `sedeId` |
| `EventoPratica` | `targetCompanyId` | `targetSedeId` |

`Documento` (713-768): i documenti pratica seguono la pratica (nessun cambio); i
documenti **anagrafici aziendali** (`companyId`, visura/CI amministratore) restano
sulla **madre** (KYC madre). Nessun re-pointing per i documenti.

`DocumentoFiscale` (1114-1171): **invariato**. Emittente/destinatario restano
`Company` (madre). All'emissione si risolve la madre dalla sede della pratica
(`pratica.brokerSede.company` / `pratica.agenziaSede.company`).

> Non denormalizziamo `companyId` su `Pratica`: la madre si deriva via
> `brokerSede.company`. La dashboard madre interroga le pratiche con
> `brokerSedeId in (sedi della madre)` (lista sedi in sessione, query `in`).

### 5.5 Wallet (per sede + wallet affiliazione madre)

Il `Wallet` diventa polimorfico: appartiene a una **sede** (crediti pratica broker)
*oppure* a una **madre** (commissioni affiliazione). Esattamente uno tra `sedeId` e
`companyId` è valorizzato.

```prisma
model Wallet {
  id        String   @id @default(uuid()) @db.Uuid

  // Wallet operativo di una sede broker (crediti pratica)...
  sedeId    String?  @unique @db.Uuid
  sede      Sede?    @relation("WalletSede", fields: [sedeId], references: [id], onDelete: Cascade)

  // ...OPPURE wallet affiliazione della madre (D5/D6).
  companyId String?  @unique @db.Uuid
  company   Company? @relation(fields: [companyId], references: [id], onDelete: Cascade)

  saldoCent Int @default(0)
  transazioni TransazioneWallet[]
  payouts     Payout[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("wallets")
}
```

- `Wallet` sede: creato lazy al primo `CREDITO_PRATICA` della sede broker. Payout
  verso `sede.iban` (fallback `company.iban`).
- `Wallet` madre: creato lazy alla prima `CREDITO_AFFILIAZIONE`. Payout verso
  `company.iban`.
- `payoutThresholdCent`: per le sedi vive su `Sede`; per il wallet madre si usa
  `Company.payoutThresholdCent` (resta su Company).
- `TransazioneWallet` / `Payout`: invariati, seguono `walletId`.

## 6. Migrazione dati (prod live — Neon `ep-solitary-night`)

Strategia **expand → backfill → cutover → contract**. DB prod è live: nessuna
perdita di saldi/storico.

### Fase E (expand, additiva — non rompe nulla)
1. `CREATE TABLE sedi`, `user_sedi`; nuovo enum `RuoloSede`.
2. Aggiungere le **nuove colonne FK nullable** ai modelli operativi (§5.4) e
   `Wallet.sedeId`, `Wallet.companyId` (la `companyId` esiste già: si aggiunge
   `sedeId` e si rende `companyId` nullable), `Company.referenteSedeId`,
   `Invitation.sedeId`/`ruoloSede`.

### Fase B (backfill SQL nella stessa migration)
3. Per ogni `Company`: creare **una `Sede`** che la specchia:
   `nome = ragioneSociale`, indirizzo/città/cap/provincia dalla company,
   `type = company.type`, `iban = company.iban`, `referralCode = company.referralCode`,
   `payoutThresholdCent = company.payoutThresholdCent`.
4. Backfill FK operative verso la sede auto-creata:
   - `Pratica.brokerSedeId` = sede della `broker` (per pratiche dove la company è broker).
   - `Pratica.agenziaSedeId` = sede della `agenziaAssegnata` (dove valorizzata).
   - `PraticaAssegnazione.sedeId`, `OrariApertura.sedeId`, `ChiusuraStraordinaria.sedeId`,
     `Listino.sedeId`, `Valutazione.agenziaSedeId`/`brokerSedeId`,
     `FeeAddebito.agenziaSedeId`, `ReferralClick.sedeId`, `EventoPratica.targetSedeId`.
   - `Wallet`: spostare l'ownership dal `companyId` al `sedeId` della sede
     auto-creata (set `sedeId`, `companyId = NULL`). Il wallet esistente
     (saldo + storico, anche commissioni affiliazione passate) resta sulla sede.
     Il wallet affiliazione madre nasce vuoto e riceve solo le **future** commissioni.
5. Backfill `UserSede`: ogni `User` con `companyId` → membership verso la sede
   auto-creata, `ruolo = ADMIN_SEDE` se `role = ADMIN_AZIENDA`, altrimenti `OPERATORE`.
   (Il proprietario `ADMIN_AZIENDA` resta comunque con accesso implicito a tutte
   le sedi: la riga `ADMIN_SEDE` è ridondante ma innocua e utile per i 1:1.)

### Fase C (cutover codice)
6. Rilascio applicativo che legge/scrive le **nuove** colonne. `NOT NULL` su
   `Pratica.brokerSedeId` (e altri obbligatori) dopo il backfill.

### Fase D (contract — release successiva, dopo verifica)
7. Drop colonne vecchie (`Pratica.brokerId`, `agenziaAssegnataId`, ecc.) e
   `Company.referralCode` se confermato che nessun vecchio link è più necessario
   (altrimenti mantenere read-only). Mantenere il gap di una release per rollback.

> Deploy: push `main` (Vercel) + `prisma migrate deploy` a mano (vedi memoria
> "Processo rilascio prod"). Backfill incluso nella migration SQL.

## 7. Registrazione

File: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`,
`apps/piattaforma/src/app/(auth)/actions.ts` (`registerAction`, righe ~204-627),
`apps/piattaforma/src/lib/auth/schemas.ts`.

- Gli step madre restano: 1) account, 2) azienda (P.IVA/regime), 3) KYC documenti,
  4) pagamento (IBAN madre, mandato SEPA solo AGENZIA, terms).
- **Nuovo step "Sedi"** (dopo il pagamento): si definisce **≥1 sede**
  (`nome`, indirizzo, città, cap, provincia, `iban?`). Per il caso a una sede,
  pre-compilato dai dati azienda → **UX invariata per il solo operatore**.
- `registerAction` crea, in transazione: `Company` (madre) → N `Sede` (con
  `referralCode` generato per ciascuna, retry su collisione come oggi righe
  407-415) → primo `User` (`ADMIN_AZIENDA`, proprietario). Nessuna `UserSede` per il
  proprietario (accesso implicito a tutte).
- Referral in ingresso: il `?ref=` (oggi risolto su `Company.referralCode`,
  righe 340-352) ora risolve una **`Sede.referralCode`**; imposta
  `newCompany.referenteId = sede.companyId` (madre) e
  `newCompany.referenteSedeId = sede.id`. Fallback legacy su `Company.referralCode`.
- AGENZIA: il calendario (`OrariApertura`) della/e sede/i può essere configurato
  dopo dal pannello; default ragionevole alla creazione.

## 8. Autenticazione, sessione e contesto sede

File: `apps/piattaforma/src/auth.ts`, `auth.config.ts`, `middleware.ts`,
`lib/auth/credentials-query.ts`, `lib/auth/permissions.ts`.

- La sessione (`session.user`) continua a portare `companyId` (madre), `role`,
  `companyType`, `companyName`. Aggiungere `isOwner` (= `role === ADMIN_AZIENDA`).
- **Sede corrente**: cookie `pv_sede` con la sede attiva per le operazioni.
  Validata **server-side** ad ogni richiesta contro le membership dell'utente
  (o, per il proprietario, contro le sedi della madre). Niente lista sedi nel JWT
  (le membership cambiano senza re-login).
- Nuovo helper centrale `getSessionContext()` (in `lib/auth/`):
  restituisce `{ user, company (madre), accessibleSedi[], currentSede | 'ALL', flags }`.
  - Proprietario: `accessibleSedi` = tutte le sedi non eliminate della madre;
    può selezionare `'ALL'` (vista aggregata) o una sede specifica.
  - Admin di sede / operatore: `accessibleSedi` = sedi da `UserSede`.
  - Sede singola → `currentSede` fissa, selettore nascosto (UX 1:1 invariata).
- Tutte le query operative scoped usano `currentSede` (o l'insieme `accessibleSedi`
  per le viste aggregate), **non** più direttamente `companyId`.

### Modello ruoli (riepilogo)
- `ADMIN_PIATTAFORMA` / `ASSISTENTE`: invariati (area `/admin`).
- `ADMIN_AZIENDA`: **proprietario madre** — vista globale, gestione sedi, creazione
  login, assegnazione utenti↔sedi, wallet affiliazione, dashboard aggregata.
- `UserSede.ruolo = ADMIN_SEDE`: gestione utenti/impostazioni della sua sede.
- `UserSede.ruolo = OPERATORE`: operatività sulla sua sede.

L'enum `UserRole` **non** cambia: il livello "admin di sede" è espresso da
`UserSede.ruolo`, non da un nuovo `UserRole`.

## 9. Aree loggate (UI)

File: `apps/piattaforma/src/app/dashboard/page.tsx` (routing per ruolo),
`apps/piattaforma/src/components/app-shell.tsx` (`AdminShell`/`AgenziaShell`/`BrokerShell`).

- **Selettore di sede** nello shell (visibile solo se l'utente ha >1 sede o è
  proprietario): "Tutte le sedi" (solo proprietario) + elenco sedi accessibili.
  Imposta il cookie `pv_sede`.
- **Dashboard proprietario** (vista "Tutte le sedi"): KPI aggregati su tutte le
  sedi (pratiche, crediti/fee, conversioni) + **breakdown per sede** + **classifica
  affiliazione per sede** (D6).
- **Operatività scoped**: con una sede selezionata, i flussi pratica/wallet/
  calendario sono identici a oggi ma filtrati sulla `currentSede`.
- **Gestione sedi** (proprietario): CRUD sedi (aggiungi/sospendi/modifica IBAN,
  anagrafica, calendario, codice interno).
- **Gestione utenti** (`/team`, file `apps/piattaforma/src/app/team/`): il
  proprietario invita utenti scegliendo sede/i + ruolo sede; l'admin di sede invita
  solo nella propria sede. L'`Invitation` porta `sedeId`/`ruoloSede`.

## 10. Affiliazione

File: `apps/piattaforma/src/app/affiliazione/page.tsx`,
`apps/piattaforma/src/lib/affiliazione/accredit.ts` (`accreditCommissioniAffiliazione`),
`check.ts` (`detectCollusion`), `check-util.ts`, `notifications.ts`,
`apps/piattaforma/src/app/admin/affiliazioni/sospette/page.tsx`,
`apps/piattaforma/src/lib/jobs/affiliation-monthly-recap.ts`,
risolutore link `/r/[code]`.

- **Codice referral per sede** (D6): ogni sede ha `Sede.referralCode`; la pagina
  `/affiliazione` mostra il link/QR della **sede corrente** (o, per il proprietario,
  per ogni sede + aggregato). Lo storico click (`ReferralClick`) è per sede.
- **Commissione alla madre**: in `accreditCommissioniAffiliazione`, il referente di
  broker/agenzia ora si risolve come `pratica.brokerSede.company.referente`
  (una madre) con attribuzione `pratica.brokerSede.company.referenteSede`
  (analogo lato agenzia). La commissione è accreditata al **wallet affiliazione
  della madre referente**.
- `CommissioneAffiliazione`: aggiungere `referenteSedeId` (attribuzione sede, per
  classifica). `referenteId` resta = madre che riceve. Enum `tipo`
  (`REFERENTE_BROKER`/`REFERENTE_AGENZIA`) invariato. Split §1.2 (1 vs 2 referenti)
  invariato.
  ```prisma
    referenteSedeId String? @db.Uuid
    referenteSede   Sede?   @relation("SedeAffiliante", fields: [referenteSedeId], references: [id])
  ```
- **Anti-collusione** (`detectCollusion`): opera a granularità **madre** (referral è
  sempre madre→madre, D6). `SAME_IBAN` confronta gli IBAN madre + eventuali IBAN
  delle sedi; `SAME_IP_SIGNUP`/`SAME_ADMIN`/`SAME_EMAIL_DOMAIN` sulle madri. Sedi
  della stessa madre non generano mai flag (stesso soggetto giuridico).
- **Recap mensile** (N25) e notifiche (N22/N23/N24): destinatario = proprietario
  madre; il recap include la classifica per sede.

## 11. Fatturazione, SEPA, fee

**Restano a livello madre** (D1) — minimo impatto sul sottosistema fiscale in prod.

- `FeeAddebito.agenziaSedeId`: attribuzione della fee alla sede che ha gestito la
  pratica; l'addebito SEPA effettivo usa il **mandato della madre**
  (`sede.company.stripePaymentMethodId` / `sepaMandateId`). Risoluzione
  `sede → company` al momento dell'esecuzione.
- `DocumentoFiscale`: emittente/destinatario = madre, risolti dalla sede della
  pratica. Numeratore progressivo e regime fiscale restano su `Company`.
- Mandato SEPA in registrazione (solo AGENZIA): invariato, a livello madre.

## 12. Autorizzazione / sicurezza

- Ogni query operativa deve filtrare per `currentSede` o per `accessibleSedi`
  (mai fidarsi del solo `companyId`). Centralizzare in `getSessionContext()` +
  helper di scoping (es. `assertSedeAccess(sedeId, ctx)`).
- Il proprietario può agire su qualsiasi sede della madre; admin di sede/operatore
  solo sulle proprie membership. Verifica server-side su tutte le server action
  pratica/wallet/calendario/sede/team.
- Cross-madre: i flussi pratica tra broker-sede e agenzia-sede di madri diverse
  sono normali; nessuna restrizione aggiuntiva (la madre è solo un raggruppamento).

## 13. Casi limite

- **Sospensione/eliminazione sede**: una sede sospesa non riceve nuove
  assegnazioni e non compare nel selettore operativo; lo storico resta. La madre
  sospesa (oggi `Company.suspendedAt`) sospende tutte le sedi.
- **Sede senza IBAN**: payout verso IBAN madre.
- **Utente rimosso da una sede**: revoca `UserSede`; se perde l'ultima sede e non è
  proprietario, non ha più accesso operativo.
- **1:1 legacy**: madre con una sola sede → selettore nascosto, comportamento
  identico ad oggi.
- **Affiliazione di una madre verso se stessa** (sede A invita, ma l'iscritto è la
  stessa madre): impossibile per definizione (l'iscritto è una nuova madre); i
  check anti-collusione restano a tutela.

## 14. Fasi di implementazione (sequencing per il piano)

1. **Schema & migrazione** (§5-6): nuovi modelli, re-pointing additivo, backfill SQL,
   test di migrazione (seed vecchio formato → migrate → asserzioni).
2. **Auth & contesto sede** (§8): `getSessionContext()`, cookie `pv_sede`, helper di
   scoping, `isOwner`.
3. **Re-pointing operativo** (§5.4): pratiche, assegnazione/distribuzione, calendario,
   valutazioni, wallet, eventi — query e server action passano alla sede.
4. **Registrazione** (§7): step Sedi, creazione N sedi, referral per sede.
5. **UI loggata** (§9): selettore sede, dashboard proprietario aggregata + breakdown,
   gestione sedi, gestione utenti↔sedi.
6. **Affiliazione** (§10): referral per sede, commissione madre + attribuzione,
   anti-collusione su madri, recap/classifica.
7. **Wallet/payout** (§5.5/§11): wallet per sede, wallet affiliazione madre, payout
   per IBAN sede/madre, fee attribuita a sede via mandato madre.
8. **Contract migration** (§6 Fase D) + hardening.

Ogni fase chiude con test (vedi §15) prima della successiva.

## 15. Testing

- **Unit**: `getSessionContext()` e helper di scoping (proprietario vs admin sede vs
  operatore; sede singola vs multi; `currentSede` vs `ALL`); split commissioni con
  attribuzione sede; risoluzione IBAN payout (sede → fallback madre); risoluzione
  mandato SEPA fee (sede → madre).
- **Migrazione**: fixture DB vecchio formato (broker+agenzia+pratiche+wallet+
  referral+utenti) → migrate → assert sede auto-creata, FK re-pointed, wallet
  spostato, `UserSede` create, saldi invariati.
- **E2E** (fine fase): registrazione multi-sede; login multi-sede + selettore;
  vista proprietario aggregata + drill-down sede; operatore scoped (non vede altre
  sedi); affiliazione via codice sede → commissione su wallet madre + attribuzione
  sede in classifica; payout sede verso IBAN sede; fee agenzia addebitata via mandato
  madre; caso 1:1 identico ad oggi.
- Coerenza con la memoria "Corpus regressione reale": aggiungere fixture per i
  discriminatori critici (scoping sede, attribuzione affiliazione).

## 16. YAGNI / esplicitamente fuori scope

- Sede che cambia madre; sedi condivise tra madri; madri miste (broker+agenzie).
- P.IVA / fatturazione / mandato SEPA per-sede.
- Madre operativa (pratiche in capo alla madre).
- Gerarchie a più di 2 livelli (madre → sede; niente sotto-sedi).
- Payout consolidato a livello madre per i crediti pratica (scelto: per sede).
```
