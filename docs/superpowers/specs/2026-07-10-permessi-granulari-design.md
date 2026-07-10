# Permessi granulari per le utenze azienda

**Data:** 2026-07-10
**Stato:** design approvato, da implementare
**Perimetro:** utenti di aziende (dealer e agenzie). Il team interno PV (`ADMIN_PIATTAFORMA`, `ASSISTENTE`, ruoli CRM) resta fuori.

## Problema

Oggi un utente azienda può fare o non fare una cosa in base a due soli assi:

- `UserRole` globale (`ADMIN_AZIENDA` = proprietario, `UTENTE_AZIENDA` = tutti gli altri);
- `RuoloSede` sulla membership `UserSede` (`ADMIN_SEDE` oppure `OPERATORE`).

Non esiste modo di dire «questo operatore vede le fatture ma non le scarica». Ogni capability è hardcodata nei gate (`canEditSedeSettings`, `canManageSedeTeam`, controlli su `companyType`), quindi due operatori della stessa sede hanno per forza gli stessi poteri.

Da questa rigidità discende anche un buco reale: in `app/blocco-pagamento/actions.ts:53` l'unico controllo è `companyType === 'AGENZIA'`, perciò **qualunque** utente di un'agenzia può cambiare l'IBAN aziendale e ricreare il mandato SEPA.

## Obiettivo

Introdurre un terzo asse — **le capability per utente** — configurabile da chi crea o modifica l'utenza, senza toccare la semantica dei due assi esistenti.

## Decisioni di design

| # | Decisione | Motivo |
|---|---|---|
| D1 | I permessi si attaccano allo `User` | Un utente non-owner appartiene a esattamente una sede: `updateTeamUserAction` (`team/actions.ts:438-441`) collassa già le membership a una sola. Attaccarli a `UserSede` non aggiungerebbe nulla. |
| D2 | Snapshot esplicito, nessuna eredità dinamica | Guardando un utente si vede esattamente cosa può fare. Cambiare un preset domani non altera gli utenti già creati. Un bug di autorizzazione si diagnostica leggendo una riga. |
| D3 | Il ruolo di sede è un **preset**, non una capability | In creazione utenza il ruolo pre-spunta le caselle; ciò che viene salvato è la lista esplicita. |
| D4 | Owner (`ADMIN_AZIENDA`) ha sempre tutto, non editabile | Nessuno può chiudersi fuori dalla propria azienda. |
| D5 | `OPERATORE` e `ADMIN_SEDE` hanno permessi editabili | Anche un admin di sede può essere limitato (es. non vede il wallet). |
| D6 | Preset di sistema in codice, nessun profilo salvabile | YAGNI: i profili per azienda reintrodurrebbero l'eredità dinamica esclusa da D2. Sono additivi in futuro. |
| D7 | Fail-closed nella UI: sezione nascosta, azione nascosta | Senza permesso la voce sparisce dalla sidebar e la rotta fa redirect; il bottone non viene renderizzato. |
| D8 | Permessi risolti nel `SessionContext`, non nel JWT | Il token dura settimane: nel JWT una revoca non avrebbe effetto fino al re-login. |

## Catalogo dei permessi

Chiavi stringa `area.azione`, definite in codice come unica fonte di verità e filtrate per `companyType`.

### Comuni a dealer e agenzia (20)

| Chiave | Significato |
|---|---|
| `pratiche.view` | vede la sezione e la lista, scoped sulla sua sede |
| `pratiche.download` | scarica PDF e ZIP dei documenti, singoli e massivi |
| `fatture.view` | vede la sezione fatture |
| `fatture.download` | scarica PDF e ZIP |
| `fatture.xml` | scarica l'XML FatturaPA |
| `wallet.view` | saldo, movimenti, rendimento |
| `wallet.payout` | **preleva denaro reale dal wallet** |
| `wallet.soglia` | modifica la soglia di auto-payout |
| `affiliazione.view` | link, QR e statistiche della sede |
| `notifiche.view` | storico notifiche dell'azienda |
| `sede.view` | vede le impostazioni della propria sede |
| `sede.edit` | modifica anagrafica e soglia payout della sede |
| `sede.iban` | **cambia il conto su cui arrivano i payout** |
| `team.view` | vede la sezione team |
| `team.invita` | invia inviti via email |
| `team.crea` | crea utenti con password impostata |
| `team.modifica` | modifica dati di un utente del team |
| `team.reset_password` | genera una password temporanea |
| `team.disabilita` | disabilita un utente e revoca inviti |
| `team.permessi` | **assegna permessi ad altri utenti** |

### Solo dealer (3)

| Chiave | Significato |
|---|---|
| `pratiche.create` | wizard, OCR e invio pratica |
| `pratiche.annulla` | annulla una pratica non ancora firmata |
| `pratiche.valuta` | valuta l'agenzia a pratica firmata |

### Solo agenzia (11)

| Chiave | Significato |
|---|---|
| `pratiche.processa` | segna una pratica come processata |
| `pratiche.firma` | **segna firmata: accredita il wallet broker, genera fee e fattura** |
| `pratiche.segnala` | **segnala un problema: apre una penale di €25 al broker** |
| `inbox.view` | vede le assegnazioni in arrivo |
| `inbox.gestisci` | accetta o rifiuta un'assegnazione |
| `addebiti.view` | storico delle fee addebitate |
| `pagamenti.ritenta` | ritenta un addebito fallito |
| `pagamenti.iban` | **cambia IBAN e ricrea il mandato SEPA** |
| `orari.view` | vede gli orari di apertura |
| `orari.edit` | modifica gli orari di apertura |
| `feedback.view` | valutazioni ricevute |

Totale: 23 permessi per un dealer, 31 per un'agenzia.

`inbox.gestisci` copre sia accetta sia rifiuta: sono le due facce della stessa decisione e un operatore che può solo accettare non è una configurazione sensata.

### Dipendenze

Un permesso figlio implica il padre. La UI le risolve da sola, il server rifiuta comunque un set incoerente.

- ogni `pratiche.*` → `pratiche.view`
- `fatture.download`, `fatture.xml` → `fatture.view`
- `wallet.payout`, `wallet.soglia` → `wallet.view`
- `inbox.gestisci` → `inbox.view`
- `orari.edit` → `orari.view`
- `sede.edit` → `sede.view` · `sede.iban` → `sede.edit`
- ogni `team.*` → `team.view`

`pagamenti.ritenta` e `pagamenti.iban` non hanno dipendenze: la pagina `/blocco-pagamento` è raggiungibile da chiunque quando l'agenzia è bloccata. Chi non ha i permessi la vede in sola lettura, con l'invito a contattare il titolare.

### Poteri owner-only, non delegabili

Riguardano l'entità legale, non l'operatività. Non compaiono nella matrice.

| Potere | File |
|---|---|
| Creare, sospendere, riattivare sedi | `sedi/actions.ts:33,145,149` |
| Firmare il mandato di fatturazione (OTP) | `wallet/mandato-actions.ts:29,53` |
| Scaricare il rendiconto della madre | `api/wallet/rendiconto` |
| Modificare l'anagrafica azienda (P.IVA, IBAN azienda) | `profilo/azienda/actions.ts:32` |
| Vedere wallet affiliazione e classifica sedi | `wallet/page.tsx`, `affiliazione/page.tsx` |

### Mai un permesso

Dashboard, profilo personale, 2FA, preferenze notifiche, guide, logout, cambio sede corrente: ogni utente li ha sempre. La dashboard però nasconde i riquadri economici a chi non ha `wallet.view`.

La sezione `profilo/listino` è una feature parcheggiata (route 404): non riceve permessi.

## Preset di sistema

Definiti in codice, dipendono da `companyType`. Sono un punto di partenza: appena si tocca una casella lo stato passa a «Personalizzato».

**Dealer**

- `OPERATORE_BASE`: `pratiche.view`, `pratiche.create`, `pratiche.download`, `notifiche.view`
- `OPERATORE_COMPLETO`: base + `pratiche.annulla`, `pratiche.valuta`, `fatture.view`, `fatture.download`, `wallet.view`, `affiliazione.view`
- `ADMIN_SEDE`: tutti e 23

**Agenzia**

- `OPERATORE_BASE`: `pratiche.view`, `pratiche.processa`, `pratiche.download`, `inbox.view`, `inbox.gestisci`, `notifiche.view`
- `OPERATORE_COMPLETO`: base + `pratiche.firma`, `pratiche.segnala`, `fatture.view`, `fatture.download`, `wallet.view`, `addebiti.view`, `affiliazione.view`, `feedback.view`, `orari.view`
- `ADMIN_SEDE`: tutti e 31

## Modello dati

```prisma
model User {
  // ...
  /// Snapshot esplicito delle capability (chiavi del catalogo).
  /// Ignorato per ADMIN_AZIENDA (owner: pieni poteri impliciti).
  permessi String[] @default([])
}

model Invitation {
  // ...
  /// Permessi che l'utente riceverà accettando l'invito.
  permessi String[] @default([])
}
```

Scalar list Postgres invece di `Json`: è tipizzata e interrogabile (`has`), e per ~30 chiavi su una riga per utente una tabella ponte sarebbe sovrastruttura.

`Invitation.permessi` è necessario perché l'invito porta già `sedeId` e `ruoloSede`: senza di esso chi accetta un invito nascerebbe senza poteri.

## Risoluzione a runtime

I permessi entrano nel `SessionContext` (`lib/auth/session-context.ts`), che è già `cache()`-ato per richiesta. La lettura si aggiunge al `Promise.all` esistente (riga 68): una query in più, una volta sola per request.

```ts
export type SessionContext = {
  // ...esistenti
  permessi: Set<Permesso>; // vuoto per l'owner: non viene mai letto
};
```

Regola di `can()`: **owner → sempre vero; altrimenti la chiave dev'essere nel set**. Chiave sconosciuta → falso. Fail-closed per costruzione, come già fa `scopeIds` vuoto.

### Convivenza con gli admin di piattaforma

`can()` risponde solo agli utenti azienda. Dove un endpoint è condiviso il gate è esplicito, senza ereditarietà silenziosa:

```ts
if (!isAdminOrAssistente(role) && !can(ctx, 'pratiche.download')) return 403;
```

## Moduli

Sotto `src/lib/auth/permessi/`, separati perché la logica sia testabile senza DB.

| File | Contenuto | Puro |
|---|---|---|
| `catalogo.ts` | chiavi, macro-categorie, etichette IT, dipendenze, filtro per `companyType` | sì |
| `preset.ts` | i tre preset per dealer e agenzia | sì |
| `check.ts` | `can()`, `assignablePermessi()`, `validaPermessi()` | sì |
| `guard.ts` | `requirePermesso()` per le action, `assertPermesso()` per le pagine | no (`server-only`) |
| `mappa-enforcement.ts` | ogni server action azienda → permesso che la protegge (o `null` motivato) | sì |

## Enforcement

I due assi esistenti non cambiano: `RuoloSede` e `SedeScope` rispondono a «su quali record», i permessi a «quali azioni». `manageableSedi()` resta com'è perché è scope.

Cambia il significato di `canEditSedeSettings()` e `canManageSedeTeam()`: oggi fanno entrambe le cose, vengono degradati a puro scope e la capability passa a `can()`.

Ordine dei controlli in ogni server action: **autenticazione → permesso → scope**.

| Livello | File | Cosa cambia |
|---|---|---|
| Sidebar | `broker-shell.tsx`, `agenzia-shell.tsx`, `app-shell.tsx` | ogni voce dichiara il permesso richiesto; `canManageTeam` → `can('team.view')` |
| Pagina | i `page.tsx` di ogni area | prima riga `await assertPermesso('wallet.view')` → redirect a `/dashboard` |
| Server action | gli `actions.ts` di ogni area | dopo `auth()`, `requirePermesso('wallet.payout')` |
| Route API | `/api/fatturazione/*`, `/api/pratiche/*`, `/api/documenti/[id]` | check esplicito, risposta `403` |
| Componente | card e bottoni | non renderizzati |

Il livello 5 è cosmetico. I livelli 3 e 4 sono la difesa vera: un bottone nascosto non protegge da una richiesta replicata a mano.

### Il caso `updateSedeAction`

Una sola action modifica anagrafica, soglia payout e IBAN. Avendo separato `sede.edit` da `sede.iban`:

```ts
requirePermesso('sede.edit');
if (ibanInArrivo !== sede.ibanAttuale) requirePermesso('sede.iban');
```

Il permesso sull'IBAN scatta solo se l'IBAN cambia davvero, altrimenti chi ha `sede.edit` non potrebbe salvare il form lasciando l'IBAN intatto.

### Anti-escalation

Quattro regole, tutte server-side, tutte in `check.ts`.

1. **Non concedi ciò che non hai.** `assignablePermessi(ctx)` = tutti i permessi se owner, altrimenti esattamente i propri.
2. **Serve `team.permessi` per scegliere.** Chi ha `team.crea` senza `team.permessi` crea utenti col preset base intersecato ai propri permessi, e non vede la matrice.
3. **Non modifichi te stesso.**
4. **Non tocchi l'owner.** Già vero per `disableTeamUserAction`, esteso ai permessi.

La validazione **rifiuta** un set non consentito con un errore, non lo filtra silenziosamente: una chiave non assegnabile è un tentativo di escalation, non un refuso da ripulire.

## UI

Un solo componente client, `src/components/permessi/matrice-permessi.tsx`, riusato in `create-user-form.tsx`, `invite-form.tsx` e `team/[userId]/edit/edit-form.tsx`.

Accordion per macro-categoria con selettore di preset in testa. La tabella a due colonne è illeggibile su mobile; una lista piatta di 31 caselle fa perdere l'orientamento. L'accordion mostra il contatore per categoria, così lo stato si legge anche da chiuso.

```
┌─ Permessi ──────────────────────────────────────────────┐
│  [ Operatore base ][ Operatore completo ][ Admin sede ]  │
│                                        Personalizzato ●  │
│                                                          │
│  ▸ ⊟ Pratiche                                      4/5   │
│  ▾ ⊟ Fatture                                       1/3   │
│      ☑ Vede la sezione fatture                           │
│      ☐ Scarica PDF e ZIP                                 │
│      ☐ Scarica XML FatturaPA    per il commercialista    │
│  ▸ ☐ Wallet                                        0/3   │
│  ▸ ⊟ Team                                          2/7   │
└──────────────────────────────────────────────────────────┘
```

- Checkbox di categoria **tri-state** (pieno, parziale, vuoto); cliccarlo accende o spegne l'intera categoria.
- Toccare una casella fa scattare il preset su «Personalizzato».
- Le dipendenze si risolvono automaticamente in entrambe le direzioni.
- I permessi che il chiamante non possiede sono disabilitati, con la ragione a fianco: «Non puoi concedere un permesso che non hai».
- Le categorie non pertinenti al `companyType` non compaiono.

### Le azioni sensibili si dichiarano

Sei caselle portano un'etichetta che ne spiega la conseguenza.

| Permesso | Etichetta |
|---|---|
| `pratiche.firma` | accredita il wallet e genera la fattura |
| `pratiche.segnala` | apre una penale di €25 al broker |
| `wallet.payout` | preleva denaro reale dal wallet |
| `sede.iban` | cambia il conto su cui arrivano i payout |
| `pagamenti.iban` | cambia il conto addebitato |
| `team.permessi` | permette di assegnare permessi ad altri |

### Dettagli

Quando chi crea non ha `team.permessi`, la matrice non viene renderizzata: al suo posto la riga «L'utente riceverà i permessi di base. Per personalizzarli, chiedi al titolare».

Nella lista team ogni utente mostra il nome del preset se il set coincide esattamente con uno di essi, altrimenti `Personalizzato · 12 permessi`. Nella pagina di modifica la matrice arriva precompilata con lo stato reale.

Si usano i componenti di `src/components/ui` e la palette Trust Blue, nessun colore hardcodato; il salvataggio passa da `SubmitButton`.

## Migrazione

Additiva, in tre passi ordinati, senza downtime.

1. Migration: `permessi String[] @default([])` su `User` e `Invitation`.
2. **Backfill**, prima che i gate entrino in vigore:
   - **owner** → array vuoto (non viene mai letto);
   - **admin di sede** → tutti i permessi del suo `companyType`;
   - **operatore** → ciò che può fare oggi (sotto), **meno** `pagamenti.iban` e `pagamenti.ritenta`;
   - **utenti PV** (`companyId = null`) → array vuoto.
3. Deploy del codice con i gate attivi.

Invertire 2 e 3 lascerebbe ogni operatore senza poteri per la durata del deploy. Sul flusso Vercel del progetto i due passi vanno coordinati a mano.

**Backfill operatore dealer:** `pratiche.view`, `pratiche.create`, `pratiche.annulla`, `pratiche.valuta`, `pratiche.download`, `fatture.view`, `fatture.download`, `fatture.xml`, `wallet.view`, `affiliazione.view`, `notifiche.view`.

**Backfill operatore agenzia:** `pratiche.view`, `pratiche.processa`, `pratiche.firma`, `pratiche.segnala`, `pratiche.download`, `inbox.view`, `inbox.gestisci`, `fatture.view`, `fatture.download`, `fatture.xml`, `wallet.view`, `addebiti.view`, `affiliazione.view`, `feedback.view`, `orari.view`, `notifiche.view`.

L'esclusione di `pagamenti.iban` e `pagamenti.ritenta` è una **restrizione voluta** rispetto al comportamento attuale: chiude il buco descritto in *Problema*. Dopo il rilascio, solo owner e admin di sede possono cambiare l'IBAN dell'agenzia.

### Il costo del fail-closed

Ogni permesso introdotto in futuro nascerà spento per tutti tranne l'owner. È il comportamento sicuro, ma va messo in conto: ogni nuovo permesso richiede una decisione esplicita nel rilascio — concederlo in backfill a chi ha già il permesso «parente», oppure lasciarlo spento e comunicarlo agli admin.

## Test

- `check.test.ts` — puro: `can()`, le quattro regole anti-escalation, fail-closed su chiave ignota.
- `catalogo.test.ts` — ogni preset contiene solo chiavi valide per il suo `companyType`; ogni dipendenza punta a una chiave esistente.
- Estensione degli `*.authz.test.ts` esistenti (`team`, `sedi`, `orari`, `wallet`, `pratiche`) con il caso «utente senza permesso → rifiuto».
- `backfill.test.ts` — un operatore agenzia esistente riceve esattamente il set atteso, senza `pagamenti.iban`.
- **Guardia anti-drift**: un test confronta gli export reali degli `actions.ts` delle aree azienda con `mappa-enforcement.ts`. Se qualcuno aggiunge una server action e non la classifica, il test è rosso. Serve a rendere rumorosa l'unica omissione che in un sistema di permessi non ti accorgi di aver fatto.
- Verifica manuale end-to-end: operatore con solo `fatture.view` → nessun bottone di download, e `GET /api/fatturazione/<id>/pdf` risponde `403`.

## Fuori scope

- Profili di permessi salvabili per azienda (additivi in futuro, vedi D6).
- Permessi granulari per il team interno PV (assistenti, CRM): restano a ruoli fissi.
- Audit trail delle modifiche ai permessi: non esiste una tabella di audit generica nel progetto.
- Permessi per la sezione `profilo/listino`, feature parcheggiata.

## Criteri di accettazione

1. Un operatore con `fatture.view` e senza `fatture.download` vede la sezione fatture, non vede alcun bottone di download, e una richiesta diretta a `/api/fatturazione/<id>/pdf` risponde `403`.
2. Un operatore senza `wallet.view` non vede la voce Wallet in sidebar, `/wallet` lo rimanda a `/dashboard`, e la dashboard non mostra riquadri economici.
3. Un admin di sede senza `fatture.xml` non riesce a concedere `fatture.xml` a un operatore: la server action rifiuta con errore.
4. Un utente non può modificare i propri permessi né quelli dell'owner.
5. Dopo il backfill, nessun operatore di agenzia ha `pagamenti.iban`; owner e admin di sede sì.
6. Un invito accettato produce un utente con esattamente i permessi scelti al momento dell'invito.
7. Tutti i test elencati passano, guardia anti-drift inclusa.
