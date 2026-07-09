# Wallet: penale sul wallet sbagliato, payout senza gate, vista aggregata

Data: 2026-07-09

## Tre problemi, uno dei quali è una falla di autorizzazione

1. **Saldi divergenti.** Titolare e operatore della stessa sede vedono saldi e movimenti
   diversi; all'operatore non risulta la penale di −25 €.
2. **Chiunque può incassare.** `richiediPayoutAction` non ha alcun controllo di ruolo: un
   operatore di sede può richiedere il payout. È live in produzione.
3. **Il titolare non vede il totale.** In vista "tutte le sedi" la pagina wallet mostra solo
   un banner *"Seleziona una sede"*.

## 1. Saldi divergenti — causa

Il modello prevede **due tipi di wallet**, esattamente uno dei due campi valorizzato:

```prisma
sedeId    String? @unique  // wallet operativo: compensi delle pratiche
companyId String? @unique  // wallet madre: commissioni di affiliazione
```

La migration `20260624013750_multi_sede_expand` ha spostato i wallet operativi esistenti
dall'azienda alla sede:

```sql
-- 4) Wallet operativo: sposta ownership da company a sede.
UPDATE "wallets" w SET "sedeId" = s."id", "companyId" = NULL
```

**`confermaAnnullamentoConPenaleAction` (`lib/penali/segnalazione.ts`) non è mai stata
aggiornata.** Risolve ancora il wallet con `where: { companyId: pratica.brokerId }`. Per un
broker quel wallet non esiste più, quindi l'`upsert` **ne crea uno nuovo di tipo madre** e ci
addebita la penale.

La pagina wallet carica il wallet madre solo se `isOwner(session.user.role)`, perché nasce per
l'affiliazione. Da qui il sintomo esatto: il titolare vede `saldo sede + saldo madre` (penale
inclusa), l'operatore vede solo `saldo sede`.

Non è una regressione della penale: `companyId: pratica.brokerId` è lì dal commit che ha creato
la feature (`9bbfaa3`), **prima** del multi-sede. È il multi-sede ad averla lasciata indietro.

### Due conseguenze non ancora osservate, dello stesso errore

- **Lo storno del compenso pratica è morto.** Nello stesso blocco, il `findFirst` che cerca il
  `CREDITO_PRATICA` da stornare filtra su `walletId: wallet.id` — il wallet madre appena creato.
  Il credito però sta sul wallet di sede: non lo troverà **mai**. Il ramo difensivo (impatto
  −50 €) non scatta.
- **La N17 mente al broker.** L'email della penale mostra `saldoWalletCent` del wallet madre,
  non il saldo reale della sede.

### Perché i dati locali sembrano a posto

L'unica penale nel DB locale è del 2026-06-19, cioè **prima** della migration multi-sede del 24:
allora il wallet del broker era ancora `companyId`, e la migration lo ha poi ri-puntato alla sede
portandosi dietro la transazione. Il bug colpisce solo le penali applicate dopo il 24 giugno.

## 2. Payout senza gate — causa

`richiediPayoutAction` (`app/wallet/actions.ts`) controlla solo `companyType` e `companyId`.
Nessun controllo di ruolo. Il `PayoutButton` è renderizzato per tutti, con `disabled` legato al
solo saldo; la prop `isTitolare` serve al testo della modale, **non** è un gate.

Il pattern corretto esiste già venti righe più sotto, in `updatePayoutThresholdAction`:

```ts
const role = await getSedeRole(sede.id);
if (!canEditSedeSettings(role)) return { ok: false, error: '…' };
```

`canEditSedeSettings` è `OWNER || ADMIN_SEDE`.

## 3. Vista aggregata — causa

La pagina fa `const sede = await getOperatingSede()` e, se `null`, mostra il banner.
`resolveOperatingSede` ritorna `null` per il proprietario in vista `ALL` con più di una sede.

## Vincoli

- **Il wallet è della sede.** Tutti i membri di una sede devono vedere lo stesso saldo e gli
  stessi movimenti. Il wallet madre resta ciò per cui è nato: le commissioni di affiliazione,
  visibili al solo proprietario.
- **`saldoCent` = somma delle `importoCent` delle sue transazioni.** Verificato: il payout
  registra una transazione negativa (`PAYOUT_MANUALE`/`PAYOUT_AUTOMATICO`) oltre a decrementare
  il saldo. La migration dati manterrà l'invariante.
- **`saldoPostCent` non si riscrive.** È il saldo *al momento* della transazione: un dato di
  audit storico, non un valore da ricalcolare.
- Migration dati **idempotente** e limitata alle sole righe sbagliate.
- Il gate di autorizzazione vive sul **server**. Nascondere il bottone è cortesia, non sicurezza.

## Design

### A. La penale va sul wallet della sede

Helper server-only, riusabile e testabile:

```ts
/** Wallet operativo del broker per questa pratica: quello della sua sede. */
walletBrokerDellaPratica(tx, pratica: { brokerId: string; brokerSedeId: string | null })
```

Risolve `sedeId: pratica.brokerSedeId`; se `brokerSedeId` è `null` (pratiche legacy pre
multi-sede) ricade su `companyId: pratica.brokerId`, che è il comportamento storico corretto per
quelle righe. Lazy-create come oggi.

`confermaAnnullamentoConPenaleAction` lo usa per lo storno, per la penale e per l'update del
saldo. Il `findFirst` del `CREDITO_PRATICA` punta allora al wallet giusto e il ramo difensivo
torna vivo.

**La N17 si corregge da sola**: il payload passa `saldoBroker: newSaldo`, cioè il saldo del wallet
appena aggiornato. Cambiando il wallet cambia il numero. Non serve toccare la notifica — e non va
toccata, resta indirizzata all'admin azienda perché è un'email amministrativa.

### B. Migration dati

Sposta le transazioni finite sul wallet madre per colpa del bug, con **delta** sui saldi (non
ricalcolo globale: non dipende dall'invariante altrove e non "aggiusta" silenziosamente drift
preesistenti).

1. Crea i wallet di sede mancanti per le sedi coinvolte (`ON CONFLICT ("sedeId") DO NOTHING`).
2. Sposta le `PENALE_BROKER` e le `STORNO` che hanno un `praticaId` la cui pratica ha
   `brokerSedeId`, dal wallet madre al wallet di quella sede.
3. Applica i delta: `saldoCent` del madre `+= |importi spostati|`, del sede `-= |importi|`
   (gli importi sono negativi, quindi in SQL è una somma algebrica).
4. Elimina i wallet madre rimasti **senza transazioni, senza payout e con saldo 0**: sono quelli
   creati dal solo bug. Un wallet madre con affiliazione reale non viene toccato.

Le transazioni di affiliazione (`CREDITO_AFFILIAZIONE`) e i payout **non si toccano mai**.

### C. Payout: gate

In `richiediPayoutAction`, subito dopo `getOperatingSede()`:

- `sede == null` → `{ ok: false, error: 'Seleziona una sede per richiedere il payout' }`;
- `canEditSedeSettings(await getSedeRole(sede.id))` falso → errore di permessi.

Il wallet madre continua a essere incassato insieme, ma **solo** dal proprietario (`isOwner`),
come oggi. In pagina, il blocco Payout si mostra solo a chi supera il gate; agli altri resta il
wallet in sola lettura.

### D. Vista aggregata del proprietario

Quando `getOperatingSede()` è `null` e l'utente è proprietario, la pagina rende una variante
**in sola lettura**:

- **Totale**: somma dei saldi dei wallet di tutte le sedi accessibili + saldo del wallet madre.
- **Dettaglio per sede**: una riga per sede con il suo saldo.
- **Movimenti recenti**: ultimi 20 uniti da tutti i wallet, con la sede di provenienza.
- **Grafico rendimento**: incluso. `getRendimento` accetta già `string[]` di walletId, quindi
  aggregarlo costa una riga.
- **Nessun payout, nessuna soglia**, con l'indicazione di selezionare una sede per incassare.

## Casi limite

- **Proprietario con una sola sede**: `resolveOperatingSede` gli restituisce quella sede anche in
  vista `ALL` → vede la pagina normale, con payout. Nessun cambiamento.
- **Pratica senza `brokerSedeId`** (legacy): la penale ricade sul wallet madre, come prima. La
  migration non tocca quelle righe, perché non saprebbe a quale sede attribuirle.
- **Sede senza wallet** al momento della penale: lazy-create, come oggi.
- **Wallet madre con affiliazione reale + penale del bug**: le penali si spostano, il wallet resta
  con le sole commissioni. Non viene eliminato.
- **Saldo negativo**: il banner e il blocco payout esistenti continuano a funzionare, ma ora sul
  wallet giusto — quindi l'operatore *vede* perché il payout è bloccato.

## File toccati

Nuovi:
- `apps/piattaforma/src/lib/wallet/wallet-pratica.ts` — `walletBrokerDellaPratica` + test
- `packages/db/prisma/migrations/<ts>_penale_su_wallet_sede/migration.sql`
- componente della vista aggregata (`app/wallet/wallet-aggregato.tsx`)

Modificati:
- `apps/piattaforma/src/lib/penali/segnalazione.ts` — usa l'helper
- `apps/piattaforma/src/app/wallet/actions.ts` — gate su `richiediPayoutAction`
- `apps/piattaforma/src/app/wallet/page.tsx` — gate UI del blocco payout + ramo aggregato

## Verifica

- **Unit** sull'helper: sede presente → wallet di sede; `brokerSedeId` null → wallet madre.
- **Authz** su `richiediPayoutAction`: operatore → errore; admin di sede → ok; titolare senza
  sede selezionata → errore. È il test che blinda la falla.
- **Migration dati**: eseguirla su una copia locale e verificare che, per ogni wallet toccato,
  `saldoCent` resti uguale alla somma delle sue transazioni; che nessuna `CREDITO_AFFILIAZIONE`
  si sia mossa; che nessun payout sia stato toccato.
- **Query su DB reale, read-only** (i test mockano Prisma): contare quante `PENALE_BROKER`/`STORNO`
  sono su wallet madre prima e dopo.
