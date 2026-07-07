# Revisione Multi-Sede: sedi autonome + distribuzione per sede

> Spec di design — 2026-07-07
> Stato: APPROVATA (design), in attesa di piano di implementazione.
> Owner: Francesco Sioli (CTO). Stakeholder prodotto: Andrea Saino (CEO).
> Revisione di: `docs/sistema-multi-sede.md` (design originale, deployato 2026-06-25/28).

## 1. Contesto e obiettivo

Il multi-sede è già in produzione (azienda madre `Company` con P.IVA unica → N
`Sede` operative). Rispetto alla visione dello stakeholder emergono **due
disallineamenti** da correggere. Il resto del modello (soggetto giuridico sulla
madre, wallet/calendario/pratiche/valutazioni per sede, selettore sede,
impersonazione del proprietario) resta valido e **non** viene toccato.

**Visione target (parole dello stakeholder):**

> Ogni sede deve funzionare **esattamente come la singola agenzia / il singolo
> broker prima del multi-sede**: ha il suo admin, può creare altre login, vede e
> gestisce pratiche, richiede payout. Rimane la figura del **proprietario** (la
> casa madre): una sola login superadmin, legata alla registrazione, che vede
> l'andamento aggregato di tutte le sedi, filtra per sede, o opera lui stesso
> **impersonando** una sede. Il superadmin crea le sedi e vi associa le login
> admin; l'admin di sede — che vede solo la propria sede — aggiunge altri account
> di gestione **per quella sede in esclusiva**. La pratica arriva a **tutte le
> sedi in zona**; la prima che accetta la gestisce (NON una sola sede per gruppo).

### 1.1 I due gap confermati nel codice

| # | Gap | Dov'è oggi | Cosa non va |
|---|-----|-----------|-------------|
| **G1** | Distribuzione "una sede per madre" | `apps/piattaforma/src/lib/distribuzione/index.ts` (`avviaRound`), `dedupe.ts` (`dedupeByMadre`) | Le agenzie già contattate sono tracciate **per madre** (`giaContattate` = insieme di `agenziaId`/companyId) e `dedupeByMadre` tiene **una sola sede per gruppo**. Un gruppo con 5 filiali in zona ne riceve **una sola**; le altre 4 restano escluse in tutti i round. |
| **G2** | Sede senza autonomia gestionale | `apps/piattaforma/src/app/team/actions.ts`, `apps/piattaforma/src/app/wallet/actions.ts` (`updatePayoutThresholdAction`) | Le azioni team (crea utente, invita, reset password, disabilita) e la soglia payout sono **hard-gated su `role === 'ADMIN_AZIENDA'`** (il superadmin). `UserSede.ruolo = ADMIN_SEDE` non viene **mai** consultato → l'admin di sede non può gestire il team né le impostazioni della propria sede. |

### 1.2 Cosa è già allineato (non si tocca)

- Payout della sede: `richiediPayoutAction` NON è riservato al superadmin — un
  utente loggato sulla sede può già richiederlo per il wallet della sede corrente.
- Selettore sede ("Tutte le sedi" + elenco) + impersonazione operativa del
  proprietario via `getOperatingSede()`.
- In creazione utente il superadmin sceglie già `sede + ruoloSede`
  (`createUserDirectAction`, `createInvitationAction`).
- Modello dati (`Sede`, `UserSede`, colonne sede su pratiche/wallet/ecc.).

## 2. Decisioni di prodotto (questa revisione)

| # | Tema | Decisione |
|---|------|-----------|
| R1 | Meccanismo distribuzione | **Mantenere l'impianto a round/ranking/cap-per-round/countdown/escalation**; cambiare solo il tracking da **madre → sede** e rimuovere `dedupeByMadre`. "Zona" = la geografia a round attuale (provincia → limitrofe → provincia). Più filiali dello stesso gruppo diventano candidati indipendenti; la prima che accetta vince. |
| R2 | Poteri `ADMIN_SEDE` | Titolare a tutti gli effetti della **propria** sede: crea/gestisce `OPERATORE` **e** altri `ADMIN_SEDE`; modifica impostazioni operative (calendario/orari/chiusure, anagrafica, codice interno); modifica **IBAN + soglia payout** della propria sede. Sempre confinato alla sua sede. |
| R3 | Superadmin | Una sola login da registrazione (`ADMIN_AZIENDA`): supervisione aggregata + drill-down + impersonazione. Crea sedi e vi assegna admin di qualsiasi ruolo. |
| R4 | Registrazione | **Mantenere l'auto-creazione di una sede "principale"** alla registrazione → caso 1:1 identico a prima (zero attrito). Le altre sedi le aggiunge il superadmin da `/sedi`. |
| R5 | Wallet affiliazione | Il payout del wallet **madre** (commissioni affiliazione) è riservato al **superadmin**. Gli utenti di sede incassano solo il wallet della **loro** sede. (Correzione: oggi `richiediPayoutAction` incassa anche il wallet madre a chiunque.) |

### Vincoli confermati (invariati dal design originale)
Restano fuori scope: sede che cambia madre; sedi condivise tra madri; madri miste
(broker+agenzie); P.IVA/fatturazione/mandato SEPA per-sede; madre operativa
(pratiche in capo alla madre); gerarchie a più di 2 livelli.

## 3. Approccio architetturale

**Decisione portante: autorizzazione "sede-aware", nessun nuovo ruolo di
piattaforma.** L'enum `UserRole` (`User.role`) **non** cambia; il livello "admin
di sede" resta espresso da `UserSede.ruolo` (già esistente). Il problema è che
l'autorizzazione oggi guarda solo `User.role` e ignora `UserSede.ruolo`.

Introduciamo un helper centrale che risolve il ruolo effettivo dell'utente **su
una sede specifica**:

```
getSedeRole(ctx, sedeId): 'OWNER' | 'ADMIN_SEDE' | 'OPERATORE' | null
```

- `OWNER` se `ctx.user.role === 'ADMIN_AZIENDA'` e la sede appartiene alla sua
  madre (accesso implicito a tutte le sedi, nessuna riga `UserSede` richiesta).
- altrimenti il valore di `UserSede.ruolo` per `(userId, sedeId)`.
- `null` se l'utente non ha accesso a quella sede.

Helper derivati per i punti di autorizzazione:
- `canManageSedeTeam(ctx, sedeId)` → `OWNER` o `ADMIN_SEDE` su `sedeId`.
- `canEditSedeSettings(ctx, sedeId)` → idem.
- `assignableSedeRoles(ctx, sedeId)` → `['ADMIN_SEDE','OPERATORE']` per OWNER e
  ADMIN_SEDE (l'admin di sede può nominare altri admin della sua sede, R2).

Tutti i check `session.user.role !== 'ADMIN_AZIENDA'` nelle server action
operative/di-gestione passano da questi helper. Scarto motivato: un nuovo
`UserRole = 'ADMIN_SEDE'` duplicherebbe la semantica già coperta da
`UserSede.ruolo` e complicherebbe il caso multi-sede (un utente potrebbe essere
admin di una sede e operatore di un'altra — solo `UserSede` lo esprime).

## 4. Sezione 1 — Distribuzione per sede (G1 / R1)

File: `apps/piattaforma/src/lib/distribuzione/index.ts`, `dedupe.ts`,
`dedupe.test.ts`, `tick.ts` (+ i suoi test), `auto-suspend.ts`.

Modifiche:
1. **Tracking per sede.** In `avviaRound` e `avviaRound1ForPratica`/`tickPratica`,
   `giaContattate` diventa un `Set<sedeId>` costruito da
   `pratica.assegnazioni.map(a => a.sedeId)` (oggi legge `agenziaId`). Le include
   che caricano `assegnazioni` selezionano `sedeId` invece di/oltre `agenziaId`.
2. **Filtro candidati per sede.** La query `tx.sede.findMany` esclude
   `id: { notIn: [...giaContattate] }` invece di
   `companyId: { notIn: [...madriContattate] }`.
3. **Rimozione `dedupeByMadre`.** Eliminare la chiamata in `avviaRound`, la
   funzione `dedupe.ts` e `dedupe.test.ts`. I candidati restano ordinati per
   ranking e tagliati a `maxPerRound`.
4. **Invariati:** `rankCandidates`/`attachRating`, `N_PER_ROUND`/`N_MAX`,
   `computeCountdown` per-sede, geografia (`provinceLimitrofe`), stati/round,
   escalation admin, `checkAutoSuspendForSedi` (già per sede),
   `PraticaAssegnazione.sedeId` scritto (già presente).

Conseguenza attesa (voluta): un gruppo con più filiali idonee nella stessa zona
occupa più slot del round in base al ranking delle singole sedi; la prima sede che
accetta chiude le altre (comportamento intra-round già esistente). Il conteggio
`altreAgenzie` nella notifica N6 riflette il batch reale.

## 5. Sezione 2 — Autonomia della sede (G2 / R2)

### 5.1 Gestione team sede-aware
File: `apps/piattaforma/src/app/team/actions.ts`, `page.tsx`,
`team-page-client.tsx`, `create-user-form.tsx`, `invite-form.tsx`,
`add-user-modal.tsx`, `[userId]/edit/*`.

- Sostituire il gate `session.user.role !== 'ADMIN_AZIENDA'` in
  `createUserDirectAction`, `createInvitationAction`, `updateTeamUserAction`,
  `resetTeamUserPasswordAction`, `disableTeamUserAction`, `revokeInvitationAction`
  con `canManageSedeTeam(ctx, targetSedeId)`.
- **ADMIN_SEDE**: la sede del nuovo utente è **forzata** alla sua sede (non può
  sceglierne un'altra); `ruoloSede` scelto tra `assignableSedeRoles` = ADMIN_SEDE
  o OPERATORE. Vede/gestisce solo utenti la cui `UserSede.sedeId` è la sua sede.
- **Superadmin**: invariato — sceglie sede + ruolo su qualsiasi sede; vede tutti
  gli utenti, filtrabili per sede.
- **OPERATORE**: nessun accesso a `/team` (nav + guard server-side).
- Guard su `updateTeamUserAction`/`disableTeamUserAction`: un ADMIN_SEDE non può
  toccare utenti fuori dalla propria sede né spostare un utente su un'altra sede;
  non può disabilitare sé stesso (già presente) né il superadmin.
- `/team` (nav + pagina): esporre anche ad ADMIN_SEDE (oggi presumibilmente
  gateato all'owner) con la lista scopata alla sua sede.

### 5.2 Impostazioni sede
File: `apps/piattaforma/src/app/wallet/actions.ts` (`updatePayoutThresholdAction`),
`app/sedi/actions.ts`, `app/(calendario/orari)/...` (orari/chiusure), form
anagrafica/IBAN sede.

- `updatePayoutThresholdAction`: aprire ad ADMIN_SEDE sulla sede corrente
  (`canEditSedeSettings(ctx, sede.id)`), non più solo ADMIN_AZIENDA.
- IBAN sede, anagrafica sede (indirizzo/telefono/email), codice interno,
  calendario/orari/chiusure: modificabili da ADMIN_SEDE sulla **propria** sede e
  dal superadmin su tutte, via lo stesso helper.
- CRUD sedi in sé (aggiungi/sospendi/elimina sede) **resta solo al superadmin**:
  è un atto sulla struttura della madre, non sull'operatività di una sede.

## 6. Sezione 3 — Superadmin / proprietario (R3 / R4 / R5)

- **Login unica** da registrazione (`ADMIN_AZIENDA`): supervisione aggregata,
  drill-down per sede, impersonazione operativa. Già presente, nessun cambio.
- **Registrazione** (`app/(auth)/actions.ts`, `register-wizard.tsx`): mantiene
  l'auto-creazione di **una sede principale** che specchia i dati azienda → caso
  1:1 invariato. Nessuna modifica al flusso di registrazione in questa revisione.
- **Wallet affiliazione (R5)** — `richiediPayoutAction`
  (`apps/piattaforma/src/app/wallet/actions.ts`): oggi incassa in un colpo sia il
  wallet sede sia il wallet madre (affiliazione) per chiunque. Correzione: il
  wallet **madre** entra tra gli `eleggibili` **solo se `isOwner(ctx)`**; gli
  utenti non-owner incassano esclusivamente il wallet della sede operativa. La
  UI `/wallet` mostra la sezione affiliazione/payout-madre solo al superadmin.

## 7. Sezione 4 — Dati e migrazione

- **Nessun cambio di schema Prisma** e **nessuna migrazione dati**: la revisione è
  logica di autorizzazione (Sez. 5–6) + distribuzione (Sez. 4). `UserSede.ruolo` e
  le colonne sede esistono già.
- **Da confermare in fase di piano:** che `getSessionContext()` /
  `getOperatingSede()` (`lib/auth/session-context.ts`, `lib/sedi/scope.ts`)
  espongano la `UserSede.ruolo` per la sede operativa corrente. Se non presente,
  aggiungerla al contesto di sessione (derivata da DB, **non** nel JWT — le
  membership cambiano senza re-login), non allo schema.

## 8. Sezione 5 — Testing

- **Distribuzione (unit/integrazione):** due sedi dello stesso gruppo nella stessa
  provincia vengono **entrambe** candidate/contattate; il tracking esclude solo le
  sedi già contattate (non le sorelle); prima-accetta-vince chiude le altre;
  escalation invariata quando nessuno accetta; rimozione `dedupeByMadre` senza
  regressioni sul ranking/cap.
- **Autorizzazione team (unit):** `getSedeRole` per OWNER / ADMIN_SEDE /
  OPERATORE / estraneo; ADMIN_SEDE crea operatori e admin **solo** sulla propria
  sede; non modifica/disabilita utenti di altre sedi né sposta utenti fuori sede;
  OPERATORE escluso; superadmin ovunque.
- **Impostazioni (unit):** ADMIN_SEDE modifica soglia payout/IBAN/orari solo della
  propria sede; CRUD sedi resta al superadmin.
- **Payout (unit):** utente di sede incassa solo il wallet sede; solo il
  superadmin incassa il wallet affiliazione madre.
- **Regressione 1:1 (e2e/integrazione):** madre con una sola sede → comportamento
  identico a oggi (selettore nascosto, superadmin opera la sede unica, team come
  prima).
- Coerenza con "Corpus regressione reale": aggiungere i discriminatori critici
  (tracking distribuzione per sede; scoping autorizzazione per sede).

## 9. Fasi di implementazione (sequencing per il piano)

1. **Helper autorizzazione sede-aware** (Sez. 3): `getSedeRole` + derivati, con
   esposizione della `ruolo` per sede nel session-context se mancante. Test unit.
2. **Distribuzione per sede** (Sez. 4): tracking per `sedeId`, rimozione
   `dedupeByMadre`. Test.
3. **Team sede-aware** (Sez. 5.1): server action + guard + UI (lista scopata,
   sede forzata per ADMIN_SEDE, ruoli assegnabili). Test.
4. **Impostazioni sede** (Sez. 5.2): soglia payout/IBAN/anagrafica/calendario
   aperti ad ADMIN_SEDE; CRUD sedi al superadmin. Test.
5. **Wallet affiliazione** (Sez. 6/R5): payout madre solo superadmin + UI. Test.
6. **Hardening/e2e**: regressione 1:1, scenari multi-sede.

Ogni fase chiude con i suoi test prima della successiva.

## 10. YAGNI / esplicitamente fuori scope

- Modifiche allo schema dati o migrazioni.
- Nuovi `UserRole` di piattaforma.
- Modifiche al flusso di registrazione oltre al mantenimento dell'auto-sede.
- Tutto ciò che era già fuori scope nel design originale (Sez. 2, vincoli).
