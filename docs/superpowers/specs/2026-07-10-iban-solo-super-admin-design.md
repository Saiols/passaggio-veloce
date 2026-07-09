# IBAN modificabile dal solo super admin dell'organizzazione

> Spec di design — 2026-07-10
> Stato: APPROVATA (design). Owner: Francesco Sioli (CTO).
> **Rettifica**: `docs/superpowers/specs/2026-07-07-impostazioni-sede-follow-up-design.md` §3.1,
> che assegnava esplicitamente **IBAN** e **soglia payout** all'ADMIN_SEDE via `SedeEdit`.
> Da qui in avanti quei due campi sono riservati al proprietario dell'azienda madre.

## 1. Contesto

L'IBAN è il campo dove finiscono i soldi: payout dei compensi maturati (broker e agenzia) e,
lato agenzia, conto su cui si appoggia il mandato SEPA per gli addebiti fee. Chi lo modifica
può dirottare l'incasso dell'intera organizzazione.

L'audit delle superfici di scrittura ha trovato **tre** percorsi che lo consentono a chi non è
il proprietario:

| # | Superficie | Cosa scrive | Gate attuale | Chi passa |
|---|---|---|---|---|
| 1 | `updateSedeAction` (`app/sedi/actions.ts:86`) | `Sede.iban`, `Sede.payoutThresholdCent` | `canEditSedeSettings` | OWNER **e ADMIN_SEDE** |
| 2 | `aggiornaIbanERitentaAction` (`app/blocco-pagamento/actions.ts:53`) | `Company.iban` **della madre** + ricrea il mandato SEPA | `companyType === 'AGENZIA'` | **qualsiasi** utente dell'agenzia, OPERATORE incluso |
| 3 | `updateCompanyAdminAction` (`app/admin/companies/actions.ts:38`) | `Company.iban` di qualsiasi azienda | `isAdminOrAssistente` | staff PV, **ASSISTENTE** incluso |

Il #2 è il più grave: quando l'account agenzia è bloccato per addebito fallito, un operatore di
sede qualunque può riscrivere l'IBAN della madre e far ripartire il mandato SEPA su un conto
scelto da lui.

Il #3 è incoerente con sé stesso: nella *stessa* action la soglia payout è già ristretta a
`isAdminPiattaforma` (riga 63), l'IBAN no. La decisione D-02 (soci 2026-05-01) qualifica
l'ASSISTENTE come ruolo operativo che non tocca leve finanziarie.

Già corrette e da non toccare: `updateCompanyProfileAction` (`/profilo/azienda`) e
`createSedeAction`, entrambe già `role === 'ADMIN_AZIENDA'`.

## 2. Decisioni (approvate con l'utente)

- **D1 — La capability è del solo `User.role === 'ADMIN_AZIENDA'`** (proprietario della madre,
  `isOwner()` in `lib/auth/permissions.ts`). Nessuna membership di sede la conferisce: né
  `ADMIN_SEDE`, né `OPERATORE`.
- **D2 — La restrizione copre anche `Sede.payoutThresholdCent`.** IBAN e soglia formano insieme
  le "impostazioni di incasso" della sede: l'intera card *Pagamenti* diventa owner-only in
  scrittura.
- **D3 — L'IBAN resta visibile in chiaro in lettura** a chi apre `/impostazioni-sede`
  (l'ADMIN_SEDE deve poter verificare su che conto arrivano i payout della sua sede senza
  chiamare il titolare). Nessun mascheramento.
- **D4 — `/blocco-pagamento` per i non-titolari**: il form IBAN sparisce e lascia un'informativa
  ("Solo il titolare dell'account può aggiornare l'IBAN"); il bottone **"Riprova l'addebito"
  resta a tutti** — non tocca né IBAN né importi, rilancia un addebito già dovuto, e sblocca il
  caso più frequente (banca sistemata, IBAN invariato).
- **D5 — `updateCompanyAdminAction`**: l'IBAN passa da `isAdminOrAssistente` a
  `isAdminPiattaforma`, con la stessa carve-out già in uso per la soglia payout. L'ASSISTENTE
  continua a modificare tutto il resto dell'anagrafica.
- **Nessun cambio schema, nessuna migration.** Solo logica + UI + test.

## 3. Componenti

### 3.1 `lib/sedi/scope.ts` — predicato puro

```ts
/** Impostazioni di incasso (IBAN, soglia payout): solo il proprietario della madre. */
export function canEditPaymentSettings(role: SedeRole): boolean {
  return role === 'OWNER';
}
```

Vive accanto a `canEditSedeSettings`/`canManageSedeTeam`, che restano invariate (OWNER |
ADMIN_SEDE): l'ADMIN_SEDE continua a gestire anagrafica e team della sua sede. Zero IO.

### 3.2 `app/sedi/actions.ts` — `updateSedeAction`

Il gate d'ingresso resta `canEditSedeSettings` (chi non lo passa non salva nulla). In più, i
campi di pagamento **non entrano nell'oggetto `data`** se chi salva non è OWNER:

```ts
const role = await getSedeRole(sedeId);
if (!canEditSedeSettings(role)) return { ok: false, error: '…' };

const data: Prisma.SedeUpdateInput = {
  nome: f.nome, indirizzo: f.indirizzo, civico: f.civico, citta: f.citta,
  cap: f.cap, provincia: f.provincia, telefono: f.telefono, email: f.email,
  codiceInterno: f.codiceInterno,
};
if (canEditPaymentSettings(role)) {
  data.iban = f.iban;
  data.payoutThresholdCent = f.payoutThresholdCent;
}
await prisma.sede.update({ where: { id: sedeId }, data });
```

Omettere invece di validare chiude **due** falle con un solo meccanismo:

1. un ADMIN_SEDE che forgia la POST a mano con `iban=IT…` non scrive niente;
2. un ADMIN_SEDE che salva la sola anagrafica **non azzera** l'IBAN della sede. Questa è la
   trappola: `parseSedeFields` mappa `'' → null`, quindi limitarsi a nascondere il campo nella
   UI cancellerebbe l'IBAN al primo salvataggio.

`parseSedeFields` (`lib/sedi/form.ts`) resta invariata: continua a parsare tutto, è l'action a
decidere cosa persistere. Con i campi assenti dalla FormData produce `iban: null` e
`payoutThresholdCent: DEFAULT_PAYOUT_CENT` — valori che l'action semplicemente ignora.

`createSedeAction` non cambia: è già `role === 'ADMIN_AZIENDA'`.

### 3.3 `app/sedi/[id]/sede-edit.tsx` — `SedeEdit`

Nuova prop obbligatoria `canEditPagamenti: boolean`.

- **Vista in lettura**: la card *Pagamenti* si mostra come oggi a chiunque raggiunga la pagina
  (IBAN in chiaro, soglia formattata). Se `!canEditPagamenti`, sotto le due righe compare la
  nota "Solo il titolare dell'account può modificare queste impostazioni".
- **Form di modifica**: i `<Field>` di IBAN e soglia sono renderizzati solo se
  `canEditPagamenti`. Il bottone "Modifica" resta visibile a chi passa `canEditSedeSettings`
  (OWNER e ADMIN_SEDE): l'anagrafica resta editabile da entrambi.
- **`submit()`**: `iban` e `payoutThresholdEuro` vengono appesi alla `FormData` solo se
  `canEditPagamenti`.
- **Validazione client**: `ibanOk` e `payoutOk` valgono `true` quando i rispettivi campi non
  sono renderizzati, così non bloccano il submit dell'anagrafica.

Chiamanti:
- `app/sedi/[id]/page.tsx` → `canEditPagamenti={true}` (la pagina è già `ADMIN_AZIENDA`-only).
- `app/impostazioni-sede/page.tsx` → `canEditPagamenti={canEditPaymentSettings(role)}`, dove
  `role` è già calcolato per il gate `canEditSedeSettings`.

### 3.4 `app/blocco-pagamento/actions.ts` — `aggiornaIbanERitentaAction`

```ts
const session = await auth();
if (!isOwner(session?.user?.role)) {
  return { ok: false, error: "Solo il titolare dell'account può aggiornare l'IBAN" };
}
```

Il controllo si aggiunge (non sostituisce) a `getAgenziaIdLoggata()`, che continua a garantire
`companyType === 'AGENZIA'` e la presenza di `companyId`. `ritentaAddebitoAction` resta
invariata e accessibile a tutta l'agenzia (D4).

### 3.5 `app/blocco-pagamento/page.tsx` + `client.tsx`

La pagina calcola `isOwner(u.role)` e lo passa a `BloccoPagamentoClient`. `ibanAttuale` viene
passato **solo** al titolare (stringa vuota altrimenti): non c'è ragione di serializzare l'IBAN
aziendale nel payload RSC di un operatore.

Nel client, quando `!isOwner` e `!inElaborazione`, il `<form>` di aggiornamento IBAN è
sostituito da un `<Alert variant="info">` con il messaggio di D4; il blocco "Riprova l'addebito"
resta identico.

### 3.6 `app/admin/companies/actions.ts` — `updateCompanyAdminAction`

Il gate d'ingresso della action resta `isAdminOrAssistente` (l'ASSISTENTE continua a modificare
l'anagrafica). L'IBAN adotta lo stesso pattern spread-condizionale che la riga sotto usa già per
`payoutThresholdCent`:

```ts
// riga 94, oggi:  iban: d.iban ? d.iban.toUpperCase() : null,
...(isAdminPiattaforma(session.user.role) ? { iban: d.iban ? d.iban.toUpperCase() : null } : {}),
...(payoutThresholdCent !== undefined ? { payoutThresholdCent } : {}),
```

**Qui il trap del wipe è identico a quello della sede** e va evitato con la stessa cura: lo zod
`updateSchema` dichiara `iban` come `.optional().or(z.literal(''))`, quindi un form ASSISTENTE
che non invia il campo produce `d.iban === undefined` → `iban: null` → **IBAN aziendale
azzerato**. Omettere la chiave è l'unica correzione sicura; nascondere il campo nella UI da solo
sarebbe una regressione peggiore del buco che chiude.

### 3.7 `components/company-edit-form.tsx` — `CompanyEditForm`

Il componente è condiviso da `/profilo/azienda` e `/admin/companies/[id]`. Nuova prop
`showIban?: boolean` **default `true`**, gemella della `showPayoutThreshold` già presente:

- `/profilo/azienda` non cambia call-site (pagina owner-only → IBAN sempre mostrato);
- `/admin/companies/[id]` passa `showIban={session.user.role === 'ADMIN_PIATTAFORMA'}`, esattamente
  come già fa per `showPayoutThreshold`.

## 4. Error handling

Tutte le negazioni restituiscono `{ ok: false, error }` — pattern esistente delle server action
del progetto — e non sollevano eccezioni. Nessuna action fa `redirect` per motivi di
autorizzazione, salvo quelle a livello di pagina che già lo fanno per utente non loggato.

Il messaggio d'errore nomina il ruolo che serve ("Solo il titolare dell'account…"), così un
ADMIN_SEDE che incappa nel gate capisce chi chiamare invece di aprire un ticket.

## 5. Test

Nessun test e2e: la superficie è tutta server action + predicato puro.

**`lib/sedi/scope.test.ts`** (esiste) — `canEditPaymentSettings`: `OWNER → true`;
`ADMIN_SEDE → false`; `OPERATORE → false`; `null → false`.

**`app/sedi/actions.authz.test.ts`** (esiste) — estendere:
- `OWNER` salva → `sede.update` chiamato con `iban` e `payoutThresholdCent` nei `data`;
- `ADMIN_SEDE` salva → `sede.update` chiamato **una volta**, con i `data` **privi** delle chiavi
  `iban` e `payoutThresholdCent` (asserzione su `expect(data).not.toHaveProperty('iban')`, non
  su un valore);
- **caso wipe**: `ADMIN_SEDE` con `iban: ''` in FormData → `sede.update` non porta `iban`, quindi
  il valore a DB sopravvive;
- **caso forgiatura**: `ADMIN_SEDE` con `iban: 'IT99…'` in FormData → idem, il valore è ignorato.

**`app/blocco-pagamento/actions.authz.test.ts`** (nuovo) — mock di `@pv/db`, `@/auth`,
`@/lib/fee/retry`, `@/lib/providers/payment/stripe-mandate`:
- `UTENTE_AZIENDA` di un'agenzia → `aggiornaIbanERitentaAction` nega, e **né `company.update` né
  `applySepaMandateToAgency`** vengono chiamati;
- `ADMIN_AZIENDA` di un'agenzia con IBAN valido → passa;
- `ritentaAddebitoAction` resta consentita a `UTENTE_AZIENDA`.

La FormData dei casi DENY deve contenere un IBAN **strutturalmente valido** (checksum MOD97
incluso): altrimenti il test passerebbe per il parse-error e non per il gate. Stessa cautela già
documentata in `sedi/actions.authz.test.ts`.

**`app/profilo/azienda/actions.authz.test.ts`** (nuovo) — regressione: `UTENTE_AZIENDA` →
`updateCompanyProfileAction` nega, `company.update` non chiamato.

**`app/admin/companies/actions.authz.test.ts`** (nuovo) — `ASSISTENTE` salva → `company.update`
chiamato con i `data` **privi della chiave** `iban` (di nuovo `not.toHaveProperty`, così il test
fallisce anche sul wipe a `null`); `ADMIN_PIATTAFORMA` → `iban` presente e uppercased.

## 6. Superficie esplicitamente non toccata

- **Registrazione** (`app/(auth)/actions.ts`): non c'è sessione, l'IBAN lo inserisce chi apre
  l'account e diventa l'`ADMIN_AZIENDA`. Corretto così.
- **`payout-exec.ts`**: legge l'IBAN (`Sede.iban ?? Company.iban`), non lo scrive. Invariato.
- **`canEditSedeSettings` / `canManageSedeTeam`**: l'autonomia dell'ADMIN_SEDE su anagrafica,
  team e orari della sua sede resta intatta (spec 2026-07-07). Questa spec ne ritaglia i soli
  campi di incasso.
