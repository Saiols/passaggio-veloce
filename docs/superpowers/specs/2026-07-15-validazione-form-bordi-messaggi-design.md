# Validazione form: bordi rossi + messaggi-motivo (design)

Data: 2026-07-15
Stato: design approvato, in attesa di piano di implementazione.

## Obiettivo

Ovunque ci sia un form **da validare**, un campo obbligatorio lasciato vuoto o
con un valore non conforme deve essere segnalato con **bordo rosso** e, quando
serve, un **messaggio-motivo in rosso sotto** (es. «Codice fiscale non valido»,
«La P.IVA deve essere di 11 cifre»).

Vincolo di UX: **la pagina non si apre mai tutta rossa** solo perché è vuota.
L'errore compare secondo una logica precisa (vedi «Regola di visibilità»), e
tutto ciò che impedisce al tasto di procedere deve diventare **visibile con
bordo + motivo** quando l'utente prova a procedere.

Non-obiettivo: riscrivere la validazione server (resta invariata), unificare in
un unico schema il wizard `/pratiche/nuova`, o toccare barre filtri / ricerche /
toggle (vedi «Fuori scope»).

## Contesto: cosa esiste già (da riusare, non reinventare)

- **`packages/lib/src/validators.ts`** — validatori Zod condivisi client+server
  (commento esplicito «usati sia client che server») con messaggi italiani già
  scritti: `partitaIvaSchema` («La P.IVA deve essere di 11 cifre»),
  `codiceFiscaleSchema` («Codice fiscale non valido»), `ibanItSchema`,
  `capSchema`, `pecSchema`, `passwordSchema` (≥8, maiuscola, minuscola, numero).
- **`apps/piattaforma/src/lib/auth/schemas.ts`** — schemi Zod per-form composti
  dai precedenti, con messaggi per-campo (login, registrazione 4 step, sede).
  I server action li usano già.
- **`apps/piattaforma/src/components/ui/field.tsx`** — `Field` rende già il
  **messaggio rosso sotto** via prop `error` (`text-pv-red-500`).
- **`input.tsx` / `select.tsx` / `number-input.tsx` / `password-input.tsx`** —
  supportano già `invalid` → **bordo rosso** (`border-pv-red-500`, ring errore).
- **`apps/piattaforma/src/app/pratiche/nuova/field-errors.tsx`** — la logica
  `invalid = (touched || reveal) && !valid` già provata nel wizard, ma isolata
  lì e limitata al **solo bordo** (nessun messaggio).

I mattoni di rendering ci sono. Manca: (1) il collante riusabile fuori dal
wizard, (2) il legame regola→**messaggio** sul campo, (3) la conversione dei
form.

## Regola di visibilità (invariata dal wizard, estesa al messaggio)

Un campo mostra bordo rosso + messaggio **solo se** è stato **toccato** (blur)
**oppure** lo step/form è in **reveal**, e non è valido:

```
mostraErrore(campo) = (touched(campo) || revealed) && messaggio(campo) != null
```

- All'apertura (né touched né reveal) **nessun** campo è in errore.
- `touched` si accende sul **blur** del singolo campo e persiste.
- `revealed` si accende al **submit** del CTA e resta finché il form/step è quello.

## Modello del CTA: sempre attivo → reveal al submit

Il tasto «Procedi / Avanti / Salva» resta **sempre attivo** (nessuno stato
grigio-disabilitato). Al clic:

1. `reveal()` — accende tutti i campi bloccanti rimasti;
2. `schema.safeParse(values)` — se ci sono errori, **`preventDefault` / non
   chiama la server action**; bordi + motivi compaiono;
3. se valido, procede normalmente.

Un solo helper incapsula il flusso: `gatedSubmit(schema, values, { onValid })`.

## Architettura del primitivo

Fonte di verità della validazione = **Zod**, lo stesso schema che il server usa
già → messaggi identici client/server, nessun drift. Per i form che non hanno
ancora uno schema si scrive uno schemino colocato che ricompone i validatori di
`@pv/lib`.

Nuovo modulo **`apps/piattaforma/src/components/forms/`** (generalizza e assorbe
`field-errors.tsx` del wizard, che viene ri-esportato da qui — niente due copie):

1. **`FieldErrorsProvider` + `useFieldErrors`** — stato di gruppo:
   - `touched: Set<string>` (blur), `revealed: boolean` (submit);
   - `reveal()`, `resetReveal()` (per il cambio-step dei wizard);
   - novità rispetto al wizard: il provider tiene/espone il **messaggio** per
     campo, non solo il booleano.
2. **Adapter `zodFieldErrors(schema, values) → Record<campo, messaggio>`** —
   funzione **pura**: fa `safeParse`, mappa la **prima** issue per `path[0]` sul
   nome del campo. Testabile senza browser.
3. **Flusso del messaggio.** Il form calcola a ogni render
   `const errors = zodFieldErrors(schema, values)` e lo passa al provider
   (`<FieldErrorsProvider errors={errors}>`). Il provider **non** conosce Zod:
   riceve la mappa campo→messaggio già pronta e vi applica la regola di
   visibilità. Così `useField(key)` resta pulito e i wizard con predicati a mano
   possono passare la loro mappa senza Zod.
4. **Hook `useField(key)` → `{ invalid, error, onBlur }`** — legge dal provider
   `errors[key]` + `touched`/`revealed`; `invalid`/`error` sono vuoti finché
   `!(touched||revealed)`; `onBlur` marca il campo come toccato. Rende la
   conversione di un campo quasi meccanica.
5. **Rendering — nessun componente nuovo:** si riusano `Field` (`error=`) e
   `Input/Select/NumberInput/PasswordInput` (`invalid=`).

### Esempio di campo convertito

```tsx
const cf = useField('codiceFiscale');
<Field label="Codice fiscale" required error={cf.error}>
  <Input name="codiceFiscale" invalid={cf.invalid} onBlur={cf.onBlur}
         value={v} onChange={(e) => setV(e.target.value)} />
</Field>
// cf.error === 'Codice fiscale non valido' solo dopo blur o dopo submit
```

## I tre archetipi di form

**A — design-system a server action** (`login`, `reset`, `invito`,
`payout-threshold`, `password-form`, ecc.): usano già `Field`/`Input`.
Conversione: valori in state React → wrap in `FieldErrorsProvider` → submit via
`gatedSubmit`. Il server continua a validare (difesa in profondità, invariato).

**B — raw-HTML** (`create-user-form` e simili): oggi `<input className="border…">`
con solo `required` del browser. Prima si **normalizzano** su
`Field`/`Input`/`Select`, poi come A.

**C — wizard** (`register-wizard`, `/pratiche/nuova`): hanno già `reveal` sul
cambio step.
- `register-wizard`: **ha già** gli schemi Zod per step → si agganciano i
  messaggi per-campo quasi gratis.
- `/pratiche/nuova`: usa predicati `mancanze*` fatti a mano (~3400 righe, niente
  schema). **Decisione approvata: NON si riscrive in Zod.** Resta il bordo rosso
  già funzionante; si aggiungono **solo i messaggi** ai predicati esistenti.

### Errori solo-server

Errori che solo il server conosce (es. email già registrata) vengono già
ritornati dalla server action: si **mappano sullo stesso display** del campo
(stesso bordo + messaggio) invece dell'`Alert` in cima. Dove non esiste un campo
naturale (errore globale) resta l'`Alert`.

## Piano a ondate

Ogni ondata è un commit/step verificabile a sé (build del primitivo inclusa
nell'Ondata 1).

- **Ondata 1 — primitivo + prova rappresentativa:** modulo `components/forms/`
  (provider, `useField`, `zodFieldErrors`, `gatedSubmit`) + unit test.
  Conversione: `login`, `reset-password`, `invito/accept`,
  `profilo/personale/password-form` (A), `wallet/payout-threshold` (A numerico),
  `team/create-user-form` (**B**, prova la normalizzazione raw-HTML).
- **Ondata 2 — onboarding + azienda/sedi:** `register-wizard` (C, Zod per step),
  `sedi/create` + `sedi/[id]/edit`, `company-edit-form`, `profilo/azienda`,
  `team/invite`, `team/[userId]/edit`, `blocco-pagamento` (IBAN),
  `admin/assistenti/create` + `edit`, `profilo/personale/form`.
- **Ondata 3 — `/pratiche/nuova`:** solo aggiunta messaggi ai predicati esistenti.
- **Ondata 4 — sweep form data-entry admin/CRM residui** (`contatti-operativi`,
  `orari`, ecc.).

## Fuori scope (il bordo rosso qui sarebbe sbagliato)

Non sono form «da validare con un valore obbligatorio»: barre filtri
(`pratiche/filters`, `admin/pratiche/filters`, `addebiti/filters`,
`feedback/filters`, `text-search-filter`), input di ricerca, form a singolo
bottone-azione (logout, approva/rifiuta), toggle di `profilo/notifiche`, input
del chatbot.

## Test e verifica

- **Unit (vitest, puri):** `computeInvalid` (già esistente), `zodFieldErrors`
  (mappatura issue→campo, incl. path annidati e prima-issue-vince), decisione di
  `gatedSubmit` (valido → onValid; invalido → reveal + niente onValid).
- **Verifica browser per ogni ondata** (obbligatoria — «solo il browser lo
  vede», serve il gesto utente sul DOM, non i byte del sorgente):
  1. apertura → **nessun** bordo rosso;
  2. blur su un obbligatorio vuoto → **solo quel** campo rosso + messaggio;
  3. clic submit con errori → **tutti** i bloccanti rossi + messaggi, **niente**
     invio/navigazione;
  4. compilo valido → il submit procede.
- **Typecheck** a cache calda (caveat tsbuildinfo noto: a cache fredda `tsc` dà
  falsi errori).

## Rischi e note

- **Coerenza messaggi client↔server:** garantita usando lo **stesso** schema
  Zod; non duplicare i messaggi a mano.
- **`register-wizard` grande:** conversione in Ondata 2 (non 1) per tenere
  l'Ondata 1 piccola e verificabile.
- **`/pratiche/nuova`:** rischio di divergenza tra predicato (validità) e
  messaggio; il messaggio deve derivare **dallo stesso predicato** che gata lo
  step, non da una regola parallela.
- **`field-errors.tsx` del wizard:** va ri-esportato dal nuovo modulo per
  evitare due implementazioni della stessa logica.
