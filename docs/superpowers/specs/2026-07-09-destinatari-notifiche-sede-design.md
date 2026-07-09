# Destinatari delle notifiche pratica: dall'azienda alla sede

Data: 2026-07-09

## Problema

Segnalazione: *"All'operatore di una sede di un broker arriva solo la prima email e non le
restanti 3; però arrivano alla mail della sede principale."*

Riprodotto leggendo il codice. Le email del ciclo di vita di una pratica risolvono il
destinatario **per azienda**, non per sede:

| Email | Destinatario oggi | File |
|---|---|---|
| N1 invio pratica | l'utente che invia (`userId` di sessione) | `app/pratiche/nuova/actions.ts` |
| N2 accettata | `broker.users[0]` con `role: ADMIN_AZIENDA` | `app/inbox/actions.ts` |
| N13 processata | idem | `app/pratiche/actions.ts` |
| N3 sollecito | idem | `lib/jobs/send-solleciti.ts` |
| N4 firma + credito | idem | `app/pratiche/actions.ts` |
| N11 escalation | idem | `lib/distribuzione/tick.ts` |
| N31 valuta agenzia | idem | `app/pratiche/actions.ts` |

Solo **N1** conosce l'operatore, perché è l'unica inviata mentre lui è loggato. Tutte le
altre partono più tardi — quando l'agenzia accetta, processa, firma — e a quel punto
**nessuno sa più chi fosse l'operatore**: la tabella `Pratica` non registra chi l'ha creata.
Ha solo `brokerSedeId`. Il codice ripiega quindi sull'unico recapito che conosce, l'admin
azienda, cioè la casella della sede principale. Una su quattro, esattamente il sintomo.

**Non è una regressione.** Tre commit hanno toccato queste righe per altri motivi:
`b99d847` (N1 legge l'email fresca dal DB invece che dalla sessione), `94be688` (fallback su
`Company.email` perché le notifiche non spariscano in silenzio), `1086d43` (uniforma il
destinatario sull'admin azienda). Nessuno ha mai considerato la sede: il recapito notifiche
è più vecchio del multi-sede e non è mai stato aggiornato.

### Lo stesso difetto, peggiore, lato agenzia

`N6_AGENZIA_NUOVA_PRATICA` (`lib/distribuzione/tick.ts`) va all'admin dell'agenzia madre,
mentre la riga `PraticaAssegnazione` porta un `sedeId`: **l'assegnataria è la sede**. Oggi
una filiale non riceve alcuna email quando le viene assegnata una pratica. Stesso discorso
per `N7_AGENZIA_PROMEMORIA_COUNTDOWN` (che parte da `accettataAt + soglia`, quindi dopo
l'accettazione) e per `N18_AGENZIA_SEGNALAZIONE_CONFERMATA`.

## Vincoli

- **Le email amministrative restano all'entità legale.** `N8_AGENZIA_ADDEBITO` allega la
  fattura PDF, `N9_AGENZIA_ADDEBITO_FALLITO` blocca i pagamenti, `N4_BROKER_FIRMA_E_CREDITO`
  espone `creditoCent` e `saldoCent` del wallet, `N17_BROKER_PENALE_ADDEBITATA` è un addebito.
  IBAN, fatture e blocchi riguardano l'azienda, non l'operatore.
- **Nessuna notifica può sparire in silenzio.** È la regola introdotta da `94be688`: se il
  destinatario preferito non è raggiungibile si scende di livello, non si annulla l'invio.
- **Retrocompatibilità.** Le pratiche storiche non hanno i campi nuovi; devono continuare a
  comportarsi esattamente come oggi.
- **Migration additiva.** Solo colonne nullable; nessun campo esistente rimosso o modificato.

## Design

### Due colonne su `Pratica`

```prisma
creatoDaUserId    String? @db.Uuid
creatoDa          User?   @relation("PraticheCreate", fields: [creatoDaUserId], references: [id], onDelete: SetNull)
accettataDaUserId String? @db.Uuid
accettataDa       User?   @relation("PraticheAccettate", fields: [accettataDaUserId], references: [id], onDelete: SetNull)
```

Relazioni vere, non scalari nudi: `Pratica.segnalataDaUserId` è oggi un `Uuid` senza FK, ed è
un precedente da **non** replicare — perde integrità e non permette l'`include`.
`onDelete: SetNull` perché la cancellazione utente è soft (`deletedAt`), ma se un giorno
diventasse fisica la pratica non deve sparire con lei.

Scritte in due punti soli:
- `creatoDaUserId` = `userId` alla `prisma.pratica.create` in `app/pratiche/nuova/actions.ts`;
- `accettataDaUserId` = `session.user.id` nella `tx.pratica.update` che imposta `accettataAt`
  in `app/inbox/actions.ts`.

### Un solo risolutore, puro

`lib/notifiche/pratica-recipients.ts` — logica pura, niente IO, testabile in isolamento.
Segue il pattern già presente nel codebase: `cliente-recipients.ts` è puro e
`cliente.ts` fa il caricamento DB.

```ts
export type Destinatario = { email: string; userId: string | null };

export function destinatariPratica(args: {
  /** Creatore o accettante, già filtrato ACTIVE + non cancellato. `null` se assente. */
  preferito: Destinatario | null;
  /** Membri di `user_sedi` della sede della pratica. */
  membriSede: Destinatario[];
  adminAzienda: Destinatario | null;
  emailAzienda: string | null;
}): Destinatario[];
```

Catena, primo livello non vuoto vince:

```
preferito → membriSede → adminAzienda → emailAzienda → []
```

Ritorna una **lista** deduplicata per email (trim + lowercase), come `buildClienteRecipients`.

La `N6` non ha un preferito — nessuno ha ancora preso in carico la pratica — quindi ricade
naturalmente sui membri della sede. Non serve un secondo risolutore: è lo stesso, con
`preferito: null`.

Il preferito viene cercato con `status: 'ACTIVE', deletedAt: null`. Un creatore uscito
dall'azienda o sospeso semplicemente non c'è, e la catena scende da sola.

### Instradamento

| Email | Destinatario | Preferito passato al risolutore |
|---|---|---|
| N1 invio | invariato: l'utente che invia | — (non usa il risolutore) |
| N2 accettata, N13 processata, N3 sollecito, N11 escalation, N31 valuta agenzia | creatore | `creatoDaUserId` |
| N6 nuova pratica assegnata | membri della sede assegnataria | `null` |
| N7 promemoria firma, N18 segnalazione confermata | chi ha accettato | `accettataDaUserId` |
| N4 firma+credito, N17 penale, N8 addebito, N9 addebito fallito | invariato: admin azienda | — (non usa il risolutore) |

Sede di riferimento: `brokerSedeId` per le email al broker, `agenziaSedeId` per quelle
all'agenzia. Per la N6, che precede l'accettazione, la sede è `PraticaAssegnazione.sedeId`.

## Casi limite

- **Assegnazione manuale dell'admin** (`app/admin/escalation/actions.ts`): porta la pratica in
  `ACCETTATA` senza che nessuno in agenzia accetti, quindi `accettataDaUserId` resta `null` e
  la N7 ricade sui membri della sede. Corretto: è esattamente il livello successivo. La N6 che
  quella action invia va anch'essa ai membri della sede (l'`sedeId` è già noto lì).
- **Pratiche storiche**: entrambe le colonne `null`, nessuna sede su righe legacy
  (`brokerSedeId`/`agenziaSedeId` nullable) → la catena scende ad `adminAzienda`, cioè il
  comportamento di oggi. Nessuna email persa, nessun cambiamento percepito.
- **Sede senza membri**: `membriSede` vuoto → si scende ad `adminAzienda`.
- **Più destinatari**: la N6 può ora produrre più email (una per membro della sede). Oggi le
  sedi dealer hanno 7 membri su 5 sedi, le agenzie 1 su 1: nessuna esplosione.
- **Preferenze e disiscrizione**: `sendNotification` valuta `shouldSend` solo se
  `target.userId` è valorizzato. I membri della sede hanno uno `userId`, quindi le loro
  preferenze vengono rispettate; il fallback su `Company.email` resta senza `userId`, come
  già oggi.

## File toccati

Nuovi, con gli stessi nomi del gemello già in `lib/notifiche` (`cliente.ts` orchestra,
`cliente-recipients.ts` è puro):
- `apps/piattaforma/src/lib/notifiche/pratica-recipients.ts` + `.test.ts` — risolutore puro
- `apps/piattaforma/src/lib/notifiche/pratica.ts` — orchestratore server-only: carica dal DB
  preferito, membri sede e admin azienda, poi delega la scelta al risolutore puro
- migration additiva `packages/db/prisma/migrations/<timestamp>_pratica_creato_accettata_da/`

Modificati:
- `packages/db/prisma/schema.prisma` — due colonne + relazioni inverse su `User`
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — scrive `creatoDaUserId`
- `apps/piattaforma/src/app/inbox/actions.ts` — scrive `accettataDaUserId`; N2 → creatore
- `apps/piattaforma/src/app/pratiche/actions.ts` — N13, N31 → creatore (N4 invariato)
- `apps/piattaforma/src/lib/jobs/send-solleciti.ts` — N3 → creatore; N7 → accettante
- `apps/piattaforma/src/lib/distribuzione/tick.ts` — N6 → membri sede; N11 → creatore
- `apps/piattaforma/src/app/admin/escalation/actions.ts` — N6 → membri sede
- `apps/piattaforma/src/lib/penali/segnalazione.ts` — N18 → accettante. Questo modulo riceve
  oggi `agenziaEmail`/`agenziaUserId` già risolti dal chiamante, ma ha `praticaId` e legge già
  `agenziaSedeId`: il contesto per usare il risolutore c'è.

## Verifica

- **Unit (vitest)** su `pratica-recipients.ts`: ogni livello della catena, salto dei livelli
  vuoti, dedup per email case-insensitive, lista vuota quando non c'è nulla.
- **Query su DB reale, in sola lettura** (regola appresa: i test mockano Prisma): eseguire le
  query nuove — `user_sedi` per sede, `include` del creatore — contro il Postgres locale, e
  verificare che un filtro che deve restringere discrimini davvero.
- **A video**: creare una pratica come operatore di sede dealer, farla accettare, e controllare
  in `apps/piattaforma/.dev-emails/` che le N2/N13/N4 escano al recapito atteso.
- **Regressione**: le pratiche storiche (colonne `null`) devono continuare a notificare
  l'admin azienda. Coperto da un test del risolutore con `preferito: null, membriSede: []`.
