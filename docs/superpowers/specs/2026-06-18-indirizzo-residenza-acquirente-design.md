# Indirizzo di residenza acquirente (override documento) — Design

**Data:** 2026-06-18
**Area:** Wizard creazione pratica, step Acquirente (`apps/piattaforma/src/app/pratiche/nuova`)
**Stato:** Approvato — pronto per implementation plan

## Contesto

Capita che l'acquirente abbia cambiato residenza da poco e il documento
d'identità riporti ancora il vecchio indirizzo. L'agenzia deve poter intestare
il passaggio al **nuovo** indirizzo corretto. Oggi il wizard non raccoglie un
indirizzo di residenza dell'acquirente (i dati acquirente su `Pratica` non
includono l'indirizzo).

## Obiettivo

Allo step Acquirente, dopo il documento d'identità, chiedere:
> *"L'indirizzo di residenza è lo stesso indicato nel documento?"*

- Default **Sì** (pre-selezionato) → flusso invariato.
- **No** → compare un campo indirizzo **obbligatorio** con Google Autocomplete;
  l'indirizzo inserito viene persistito sulla pratica e mostrato nel dettaglio
  (broker e agenzia), così l'agenzia intesta al nuovo indirizzo.

## Decisioni (fissate con l'utente)

- **Solo acquirente** (non venditore).
- **Due bottoni espliciti Sì/No**, default Sì (stesso pattern UI della delega a vendere).
- **Campo obbligatorio se No** (solo presenza, nessuna validazione di contenuto).
- **Modello dati: una sola stringa formattata** su `Pratica` (`null` = stesso del
  documento). Niente colonna booleana né campi strutturati.

## Modello dati e migration

`packages/db/prisma/schema.prisma`, `model Pratica`, accanto agli altri campi
acquirente (dopo `acquirenteEmail`):

```prisma
  acquirenteEmail              String?
  acquirenteIndirizzoResidenza String?   // null = stesso del documento; valorizzato = residenza diversa
```

Migration additiva e sicura: `ALTER TABLE "pratiche" ADD COLUMN "acquirenteIndirizzoResidenza" TEXT;`
(colonna nullable, nessun backfill). Generata con `prisma migrate dev`.

## Stato wizard

`apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (componente principale):

- `const [acquirenteResidenzaDiversa, setAcquirenteResidenzaDiversa] = useState(false);`
  (default false = "Sì, stesso del documento") — guida i bottoni e la comparsa del campo.
- `const [acquirenteIndirizzoResidenza, setAcquirenteIndirizzoResidenza] = useState('');`
  la stringa indirizzo (popolata dall'autocomplete o dall'input manuale di fallback).

Formattazione indirizzo da `AddressParts` → stringa unica, helper locale puro:

```ts
function formatIndirizzo(p: AddressParts): string {
  const via = [p.indirizzo, p.civico].filter(Boolean).join(' ');
  const citta = [p.cap, p.citta].filter(Boolean).join(' ');
  const prov = p.provincia ? `(${p.provincia})` : '';
  return [via, citta, prov].filter(Boolean).join(', ').replace(/, \(/, ' (');
}
// es. { indirizzo:'Via Roma', civico:'12', cap:'20100', citta:'Milano', provincia:'MI' }
//   → "Via Roma 12, 20100 Milano (MI)"
```

## UI — step 3 (Acquirente)

Subito DOPO `IdentitaSection` dell'acquirente e PRIMA del blocco verdetto/nav,
una card con la domanda e i due bottoni:

- Titolo/domanda: *"L'indirizzo di residenza è lo stesso indicato nel documento?"*
- Due bottoni segmented **Sì** / **No** (stesso stile dei bottoni delega a vendere,
  token design-system `pv-navy-*`/`pv-slate-*`/`text-white`):
  - **Sì** → `setAcquirenteResidenzaDiversa(false)` e svuota l'indirizzo
    (`setAcquirenteIndirizzoResidenza('')`).
  - **No** → `setAcquirenteResidenzaDiversa(true)`.
- Quando `acquirenteResidenzaDiversa` è true, mostra il campo indirizzo:
  - se `hasMaps` (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` presente): `AddressAutocomplete`
    con `onSelect={(p) => setAcquirenteIndirizzoResidenza(formatIndirizzo(p))}`;
    sotto, conferma "Indirizzo selezionato: <…>" se valorizzato.
  - fallback senza maps key: un `Input` manuale legato a
    `acquirenteIndirizzoResidenza` (stesso pattern del fallback comune allo step 4).
  - label: "Nuovo indirizzo di residenza", obbligatorio.

## Gating "obbligatorio se No"

**Client (`canStep3`)** — aggiungere la condizione: se `acquirenteResidenzaDiversa`,
`acquirenteIndirizzoResidenza.trim().length > 0`.

```ts
const residenzaOk = !acquirenteResidenzaDiversa || acquirenteIndirizzoResidenza.trim().length > 0;
// canStep3 = (...condizioni esistenti...) && residenzaOk
```

Quando manca, "Avanti" disabilitato + hint inline (Alert) coerente con lo step.

**Nessun check server-side** (a differenza della delega): non si invia un flag
separato, solo la stringa indirizzo quando valorizzata. Il caso limite "No +
indirizzo vuoto" (bypass del gate client) degrada in modo **benigno** a `null`
= "stesso del documento", uno stato valido e innocuo (nessun dato rotto, nessun
documento legale mancante). Il gate client basta per il requisito "obbligatorio
se No".

## Submit + persistenza

**Submit (`wizard.tsx`)**: nel builder FormData aggiungere il campo solo se
"No": `if (acquirenteResidenzaDiversa && acquirenteIndirizzoResidenza.trim()) fd.append('acquirenteIndirizzoResidenza', acquirenteIndirizzoResidenza.trim());`

**Schema (`actions.ts`)**: nello schema FormData/zod dell'azione aggiungere
`acquirenteIndirizzoResidenza: z.string().trim().min(1).max(250).optional()` (o
`z.string().optional()` con normalizzazione), letta dalla FormData.

**Persistenza (`actions.ts`)**: in `tx.pratica.create({ data: { ... } })`, accanto
agli altri campi acquirente:
`acquirenteIndirizzoResidenza: d.acquirenteIndirizzoResidenza ?? null,`

## Vista dettaglio (broker + agenzia)

Nella sezione/anagrafica acquirente di:
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx`
- `apps/piattaforma/src/app/inbox/[id]/page.tsx`

aggiungere, **solo se valorizzato**, una riga:
> **Residenza acquirente (diversa dal documento):** &lt;acquirenteIndirizzoResidenza&gt;

(usando il componente `InfoRow`/markup già presente in quelle pagine). Va incluso
nel `select` Prisma della query pratica se quest'ultima limita i campi.

## Fuori scope

- Venditore (la feature è solo lato acquirente).
- Validazione/normalizzazione dell'indirizzo oltre la presenza.
- Campi strutturati (via/civico/CAP/città/provincia separati): si salva una sola stringa.
- OCR / verifica dell'indirizzo contro il documento.

## Test

- **Pura**: helper `formatIndirizzo` (unit test su composizione + parti mancanti),
  se estratto in modulo testabile.
- **Engine/altro**: nessun impatto.
- Server action: non unit-testata in questo repo (come per la delega) → verifica
  via typecheck/lint/build.

## File toccati (riepilogo)

- `packages/db/prisma/schema.prisma` (+ migration)
- `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts`
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx`
- `apps/piattaforma/src/app/inbox/[id]/page.tsx`
- (eventuale) modulo helper `formatIndirizzo` + test
