# Monitoraggio pratiche ferme + revoca e ricircolo — Design

Data: 2026-07-17 · Autore: Francesco (CTO) + Claude · Stato: approvato

## Obiettivo

Dare al super-admin uno strumento per **tenere d'occhio le pratiche che un'agenzia ha
accettato ma non sta lavorando** (stato `ACCETTATA` che non avanza a `PROCESSATA`), e
per intervenire a discrezione:

- **Vederle tutte** ordinate per anzianità, con **evidenza rossa a partire da 3 giorni**
  fermi (aiuto visivo; la soglia non blocca né automatizza nulla).
- A discrezione: non agire (contatto off-platform con l'agenzia) **oppure**
  **revocare l'assegnazione e rimettere la pratica in circolo** sulla sua zona
  (comune/provincia), **senza notificare l'agenzia revocata** nel nuovo giro.
- Alla revoca parte un giro di email: (1) l'agenzia revocata è informata di aver perso
  la gestione, (2) il broker e i venditori/acquirenti sono informati dell'accaduto,
  (3) le agenzie in zona ricevono il classico popup e il flusso normale riparte.
- Ogni cambio di stato della pratica è registrato in un **log durevole a DB**, così la
  storia della pratica è ricostruibile.

## Decisioni (Q&A con l'utente)

1. **Ricircolo → quali agenzie ricontattare**: **ripartenza pulita** — ridistribuzione
   da Round 1 sulla provincia della pratica ricontattando **tutte** le agenzie idonee in
   zona; l'agenzia revocata è **esclusa in modo permanente** e non riceve alcuna notifica.
2. **Ampiezza dello storico**: **log completo di tutte le transizioni** di stato (non solo
   quelle di questa feature), scritto d'ora in avanti in tutti i punti del ciclo di vita.
3. **Soglia rossa**: **giorni di calendario**, soglia **fissa a 3** (costante nel codice,
   facilmente modificabile). Ambra a 2 giorni come pre-avviso soft.
4. **Collocazione UI**: **nuova pagina dedicata `/admin/monitoraggio`** (non un tab dentro
   `/admin/pratiche`).

Decisioni prese in fase di design e confermate dall'utente ("mi torna"):

- L'azione di revoca è disponibile su **ogni** riga `ACCETTATA` non lavorata (discrezione
  admin), non solo su quelle rosse: il rosso è solo l'aiuto visivo.
- Revoca riservata al **super-admin** (`ADMIN_PIATTAFORMA`); l'intera pagina è super-admin.
- **Nessuno storno economico**: a `ACCETTATA` non è stato addebitato nulla (fee alla firma,
  credito broker e commissioni affiliazione maturano alla firma) → niente da stornare.

## Stato attuale (dal mapping del codice)

- L'admin vede già tutte le pratiche a `/admin/pratiche` (stato, agenzia, sede, timestamp,
  tab/filtri). Esiste già il precedente di una cella "in attesa da N giorni" nel tab
  *In attesa di firma* (`AttesaCell`, conteggio da `processataAt`).
- **Non esiste** alcuna azione di revoca / rimessa-in-circolo per una pratica già
  `ACCETTATA`: è codice netto nuovo (le uniche uscite da `ACCETTATA` oggi sono
  `PROCESSATA`, `ANNULLATA`).
- **Non esiste** un log durevole delle transizioni di stato: solo colonne timestamp
  in-place sulla `Pratica` (`accettataAt`, `processataAt`, …) e `PraticaAssegnazione` come
  traccia dei tentativi di distribuzione.
- L'engine di distribuzione (`avviaRound`) seleziona **sedi** agenzia per provincia e sa
  già escludere le sedi già contattate (`sediContattate`).
- Le email sono ben fattorizzate: `NotificaTipo` → `templates.ts` → `send.ts`; le email
  ai clienti (venditori + acquirenti) passano da `notifyClientiAvanzamento(praticaId, stato)`.

## 1. Modello dati (schema Prisma + migration)

### 1.1 Nuova tabella `PraticaStatoLog` (`pratica_stato_log`)

Append-only, fonte di verità dello storico. Soft-ref sull'attore (come gli altri log), FK
sulla pratica per integrità/cascade.

```prisma
model PraticaStatoLog {
  id        String  @id @default(uuid()) @db.Uuid
  praticaId String  @db.Uuid
  pratica   Pratica @relation(fields: [praticaId], references: [id], onDelete: Cascade)

  statoDa PraticaStato? // null alla creazione (BOZZA)
  statoA  PraticaStato

  /// Nota/motivo leggibile (es. la nota admin della revoca). Opzionale.
  motivo String?

  /// Chi ha causato la transizione. null = sistema/cron (es. avanzamento round).
  attoreUserId String? @db.Uuid

  /// Contesto extra non normalizzato: { round?, ciclo?, sedeId?, tipoEvento? }.
  meta Json?

  createdAt DateTime @default(now())

  @@index([praticaId, createdAt])
  @@map("pratica_stato_log")
}
```

Relation da aggiungere su `Pratica`: `storicoStato PraticaStatoLog[]`.

Il campo `meta.tipoEvento` è una stringa app-level (es. `SUBMIT`, `ROUND_ADVANCE`,
`ACCEPT`, `PROCESS`, `SIGN`, `CANCEL`, `ADMIN_REVOKE`, `RECIRCULATE`) definita come
costanti in `lib/pratiche/stato-log.ts` — nessun enum nuovo, nessun churn.

### 1.2 Marcatore di ciclo di distribuzione

Serve per la "ripartenza pulita" senza perdere lo storico dei tentativi precedenti.

- `Pratica.distribuzioneCiclo Int @default(1)` — ciclo di distribuzione corrente.
- `PraticaAssegnazione.ciclo Int @default(1)` — a quale ciclo appartiene il tentativo.

### 1.3 Nuovi valori enum

- `AssegnazioneEsito.REVOCATA_ADMIN` — marca la vecchia assegnazione vincente revocata
  dall'admin (audit + segnale di esclusione permanente della sede).
- `NotificaTipo.N50_AGENZIA_PRATICA_REVOCATA`
- `NotificaTipo.N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO`

Le email ai clienti **non** introducono un nuovo `NotificaTipo`: riusano
`N40_CLIENTE_AVANZAMENTO` con un nuovo valore `ClienteAvanzamentoStato = 'RIMESSA_IN_CIRCOLO'`.

### 1.4 Migration

Migration SQL a mano (mai `prisma migrate dev`, che propone DROP distruttivi — cfr.
`project_prisma_migrate_distruttivo`): `CREATE TABLE pratica_stato_log` + indice,
`ALTER TABLE pratiche ADD COLUMN distribuzione_ciclo`, `ALTER TABLE pratiche_assegnazioni
ADD COLUMN ciclo`, `ALTER TYPE "AssegnazioneEsito" ADD VALUE 'REVOCATA_ADMIN'`,
`ALTER TYPE "NotificaTipo" ADD VALUE ...` (×2). **Nessun backfill**: i dati prod sono
usa-e-getta (cfr. `project_db_prod_temporaneo`), il log parte da ora in avanti.

## 2. Storico stato (cross-cutting)

Helper `logCambioStato(tx, { praticaId, statoDa, statoA, motivo?, attoreUserId?, meta? })`
in `lib/pratiche/stato-log.ts`. Chiamato **dentro la stessa transazione** accanto a ognuno
dei punti che oggi scrivono `stato:` su una pratica:

| File | Transizione | tipoEvento |
|---|---|---|
| `lib/distribuzione/tick.ts` | → `IN_ATTESA_ROUND_1/2/3`, → `IN_ESCALATION` | `ROUND_ADVANCE` / `ESCALATION` |
| `app/pratiche/nuova/actions.ts` (via `avviaRound1ForPratica`) | `BOZZA` → `IN_ATTESA_ROUND_1` | `SUBMIT` |
| `app/inbox/actions.ts` | → `ACCETTATA` | `ACCEPT` |
| `app/admin/escalation/actions.ts` | → `ACCETTATA` | `ADMIN_ASSIGN` |
| `app/pratiche/actions.ts` | → `PROCESSATA`, → `ANNULLATA` | `PROCESS` / `CANCEL` |
| `lib/pratiche/firma-engine.ts` | `PROCESSATA` → `FIRMATA` | `SIGN` |
| `lib/penali/segnalazione.ts` | → `ANNULLATA` | `CANCEL` |
| **nuovo** `app/admin/monitoraggio/actions.ts` | `ACCETTATA` → `IN_ATTESA_ROUND_1` | `ADMIN_REVOKE` + `RECIRCULATE` |

**Scelta**: chiamata `logCambioStato` co-locata a ogni write, **non** un refactor che forza
tutte le transizioni attraverso un unico choke-point `setPraticaStato`. Stesso risultato di
audit, ma rischio di regressione molto più basso su `tick.ts` e `firma-engine.ts` (percorsi
critici, con compare-and-set). Il costo è ricordarsi la chiamata ai (pochi) punti noti,
tutti elencati sopra.

## 3. Pagina `/admin/monitoraggio` (solo super-admin)

- Route nuova `app/admin/monitoraggio/page.tsx` (server component), sotto la guardia di
  `app/admin/layout.tsx`; in più la pagina richiede `isAdminPiattaforma` (super-admin).
- Query: `prisma.pratica.findMany({ where: { stato: 'ACCETTATA', processataAt: null,
  deletedAt: null }, include: { broker, agenziaAssegnata, agenziaSede, veicoli },
  orderBy: { accettataAt: 'asc' } })` — le più vecchie in cima. Mostra **tutte** le
  accettate-non-lavorate, non solo le rosse.
- `giorniFermi` = giorni **di calendario** tra `accettataAt` e ora. Helper riusabile
  `lib/date/rome-day.ts` per il conteggio a mezzanotte Europe/Rome (coerente con il resto).
- Evidenza riga: **rossa a `giorniFermi >= 3`**, **ambra a `giorniFermi == 2`**, neutra
  sotto. Soglie come costanti in cima al modulo.
- Colonne: Codice (+ chip tipo), Targa, Broker, Agenzia · Sede, Accettata (relativo),
  **Giorni fermi** (badge colorato), Azione. Riuso dei componenti tabella di
  `/admin/pratiche` (`table-grid`, `StatusChip`, `SedeCell`).
- Nav: nuovo item nel gruppo **Operatività** di `NAV_GROUPS` in
  `components/admin/admin-shell.tsx` (con `adminOnly: true`) + icona in `admin-icons.tsx`.
  Opzionale: badge live con il conteggio delle rosse via `/api/badges`.
- Azione **"Revoca e rimetti in circolo"** su ogni riga → **modale di conferma** (client
  component) con textarea **nota opzionale**. La conferma chiama la server action.

## 4. Azione revoca + ricircolo (engine)

`revocaERimettiInCircoloAction(praticaId, motivo?)` in `app/admin/monitoraggio/actions.ts`.

- `'use server'`; guard `isAdminPiattaforma` (redirect/​errore tipizzato altrimenti).
- In `prisma.$transaction`:
  1. **Compare-and-set**: carica la pratica `where { id, stato: 'ACCETTATA',
     processataAt: null }`. Se non trovata → ritorna errore (niente doppia revoca in race,
     stesso pattern di `firma-engine`).
  2. Vecchia assegnazione vincente (ciclo corrente, `esito: 'ACCETTATA'`) →
     `esito: 'REVOCATA_ADMIN'`, `esitoAt: now`, `notaRifiuto: motivo`.
  3. Pratica: azzera `agenziaAssegnataId`, `agenziaSedeId`, `accettataAt`,
     `accettataDaUserId`; `distribuzioneCiclo: { increment: 1 }`; reset dei timestamp di
     round del ciclo concluso (`round1/2/3StartedAt`, `escalationAt` → null).
  4. `logCambioStato(tx, ACCETTATA → …, motivo, attore=admin, meta={ tipoEvento:'ADMIN_REVOKE' })`.
  5. `avviaRound(tx, pratica, 1)` sul **nuovo** ciclo → crea le nuove `PraticaAssegnazione`
     Round 1 (con `ciclo = distribuzioneCiclo` nuovo), imposta `stato: 'IN_ATTESA_ROUND_1'`
     + `round1StartedAt`, e logga la transizione (`RECIRCULATE`).
- **Post-commit best-effort** (fuori transazione, come le altre azioni): email + eventi
  (§5) + emissione `N6`/popup per le nuove sedi (già gestita dal percorso post-commit di
  `avviaRound1ForPratica` — la action riusa lo stesso meccanismo) + `revalidatePath('/admin/monitoraggio')`.

### Modifica mirata all'engine (`avviaRound`, `tick.ts`)

- `sediContattate` diventa: **sedi contattate nel ciclo corrente** (`ciclo =
  pratica.distribuzioneCiclo`) **∪** sedi con una riga `esito: 'REVOCATA_ADMIN'` su questa
  pratica (qualunque ciclo → esclusione permanente).
- `avviaRound` scrive `ciclo: pratica.distribuzioneCiclo` sulle nuove `PraticaAssegnazione`.
- **Invariante di non-regressione**: per una pratica mai revocata `distribuzioneCiclo` è
  sempre 1 e tutte le sue righe hanno `ciclo = 1` → `sediContattate` coincide con l'insieme
  odierno. Nessun cambiamento di comportamento sul flusso normale.
- Una **seconda** revoca (nuova agenzia che accetta e si ferma di nuovo) incrementa ancora
  il ciclo ed esclude anche la seconda sede: le esclusioni permanenti si accumulano, il
  resto della zona viene ricontattato.

## 5. Email e eventi in-app (post-commit, best-effort)

| Destinatario | Canale | Contenuto |
|---|---|---|
| Agenzia revocata | `N50_AGENZIA_PRATICA_REVOCATA` + evento in-app `PRATICA_REVOCATA` | Ha perso la gestione della pratica X |
| Broker | `N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO` | La pratica è stata rimessa in circolo |
| Venditori + acquirenti | `N40_CLIENTE_AVANZAMENTO` con `stato = 'RIMESSA_IN_CIRCOLO'` | La pratica è in fase di riassegnazione a una nuova agenzia |
| Agenzie in zona | `N6_AGENZIA_NUOVA_PRATICA` + popup `NUOVA_PRATICA` | Emessi automaticamente da `avviaRound` — nessun codice nuovo |

- Destinatari agenzia revocata / broker via i resolver esistenti
  (`destinatariSedeAgenzia(sedeId)` / recipient broker in `pratica-recipients.ts`).
- Clienti via `notifyClientiAvanzamento` + nuovo arm nel template `N40` (riusa
  `buildClienteRecipients`, dedup email).
- L'agenzia revocata **non** riceve `N6` per il nuovo ciclo perché è esclusa dalla
  selezione candidati (esclusione permanente).
- Wiring nuove notifiche: valore enum in `schema.prisma` → `NxxPayload` + `tplNxx` in
  `templates.ts` → arm in `SendInput` + `case` in `render()` in `send.ts` → chiamata
  `sendNotification` dalla action. Nuovo tipo evento in-app in `lib/eventi/tipi.ts` +
  builder in `lib/eventi/pratica-eventi.ts`.

## 6. Assunzioni

- A `ACCETTATA` non ci sono addebiti/crediti/penali/commissioni da stornare (§Decisioni).
- Il monitoraggio copre **solo** `ACCETTATA` → `PROCESSATA` (accettata-non-lavorata). Lo
  stallo `PROCESSATA` → `FIRMATA` ha già il tab *In attesa di firma* e resta fuori scope.
- Sono monitorate anche le pratiche assegnate via escalation admin
  (`assegnaEscalationAction` → `ACCETTATA`), perché il filtro è sullo stato, non su come
  ci è arrivata; il conteggio giorni usa `accettataAt`.

## 7. Non-obiettivi (YAGNI)

- Nessuna revoca automatica alla soglia: l'azione è sempre manuale e a discrezione.
- Nessuna soglia configurabile da UI (costante nel codice; DB-driven rimandato).
- Nessun refactor a choke-point unico delle transizioni di stato.
- Nessuna pagina di dettaglio dedicata del log: lo storico è a DB e ricostruibile; una vista
  UI dello storico è un possibile follow-up.

## 8. Test

- **Unit**: conteggio `giorniFermi` e mappatura soglia→colore; builder destinatari email
  revoca; `logCambioStato` scrive la riga attesa.
- **Engine**: `sediContattate` con ciclo — (a) pratica mai revocata: insieme invariato;
  (b) dopo revoca: ripartenza ricontatta tutta la zona **tranne** la revocata; (c) seconda
  revoca: esclude anche la seconda sede. Query provate sul DB reale in read-only
  (cfr. `feedback_query_su_db_reale`).
- **Browser** (login super-admin, area gated): la pagina lista le accettate-non-lavorate
  con l'evidenza rossa/ambra corretta; l'azione revoca apre la modale, conferma, e la
  pratica sparisce dalla lista + ricompare in distribuzione; verifica DOM/gesto utente
  (cfr. `feedback_verifica_sul_dom_e_gesto_utente`).

## 9. File toccati (mappa d'integrazione)

- `packages/db/prisma/schema.prisma` + nuova migration in `packages/db/prisma/migrations/`
- `apps/piattaforma/src/lib/pratiche/stato-log.ts` (nuovo: helper + costanti tipoEvento)
- `apps/piattaforma/src/lib/distribuzione/tick.ts` (`sediContattate` + `ciclo` sulle nuove righe)
- Punti transizione stato (§2) per le chiamate `logCambioStato`
- `apps/piattaforma/src/app/admin/monitoraggio/page.tsx` + `filters`/`table` + `actions.ts` (nuovi)
- `apps/piattaforma/src/components/admin/admin-shell.tsx` + `admin-icons.tsx` (nav + icona)
- `apps/piattaforma/src/lib/notifiche/templates.ts` + `send.ts` (N50, N51, arm N40)
- `apps/piattaforma/src/lib/notifiche/cliente.ts` (nuovo `stato` RIMESSA_IN_CIRCOLO)
- `apps/piattaforma/src/lib/eventi/tipi.ts` + `pratica-eventi.ts` (evento `PRATICA_REVOCATA`)
