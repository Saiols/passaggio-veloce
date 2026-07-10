# Filtri pagina Feedback — range date (tutti) + sede (owner)

**Data:** 2026-07-10
**Pagina:** `apps/piattaforma/src/app/feedback/page.tsx`

## Obiettivo

Nella pagina dei feedback ricevuti da un'agenzia:

1. **Per tutte le utenze** dell'agenzia: un filtro per **range di date** sui feedback.
2. **Solo per il proprietario dell'agenzia** (`ADMIN_AZIENDA`, `ctx.isOwner` — il
   "superadmin" che vede tutte le sedi in aggregato): in aggiunta un **filtro per
   sede** e la **sede di riferimento mostrata nella card** di ogni feedback.

Gli utenti non-owner (`UTENTE_AZIENDA`, scopati alle loro sedi) NON vedono il
filtro sede né la label sede: per loro cambia solo l'aggiunta del filtro date.

## Contesto attuale

- La pagina è solo-agenzia (`companyType === 'AGENZIA'`), server component
  `force-dynamic`. Blocca gli altri tipi con un messaggio.
- Legge `Valutazione` con `whereValutazione(toSedeScope(ctx), agenziaId)` e mostra
  media + conteggio in header, calcolati sullo **stesso** `where` della lista
  (coerenza voluta: media e conteggio devono riflettere l'insieme mostrato).
- `Valutazione` ha `agenziaSedeId String?` → relazione `agenziaSede Sede?`
  (`Sede.nome`). Alcune righe legacy hanno `agenziaSedeId = null`.
- Il selettore-sede globale (`SedeSwitcher`, cookie `pv_sede`) **non** è mostrato
  su `/feedback` (non è nei `SEDE_SCOPED_PATHS`), ma la pagina eredita comunque
  il valore del cookie via `getSessionContext`. Su questa pagina l'owner oggi non
  ha quindi alcun controllo esplicito sulla sede.
- Pattern filtri di riferimento: `apps/piattaforma/src/app/admin/pratiche/filters.tsx`
  — form `method="get"` client, select con apply `onChange`, testo con debounce;
  il `GlobalNavOverlay` del layout root copre il caricamento della navigazione GET.

## Decisioni (confermate con l'utente)

- **"superadmin" = proprietario agenzia** (`ADMIN_AZIENDA` / `ctx.isOwner`). NON
  l'admin di piattaforma. Nessuna vista cross-agenzia.
- **Il filtro sede in pagina è la fonte di verità** per l'owner: su `/feedback`
  l'owner parte SEMPRE da "tutte le sedi" (base aggregata, ignora il cookie
  `pv_sede`) e il nuovo select è l'unico controllo. Comportamento esplicito e
  prevedibile, indipendente da cosa è stato impostato su altre pagine.

## Comportamento per ruolo

| | Filtro date | Filtro sede | Sede in card |
|---|:---:|:---:|:---:|
| Owner (`ADMIN_AZIENDA`) | ✅ | ✅ | ✅ |
| Utente sede (`UTENTE_AZIENDA`) | ✅ | ❌ | ❌ |

## Data flow / scoping

Query param supportati (tutti opzionali):
- `da` — data inizio, formato `YYYY-MM-DD`.
- `a` — data fine, formato `YYYY-MM-DD`.
- `sede` — id sede (solo owner; ignorato per non-owner).

Composizione del `where` (`Prisma.ValutazioneWhereInput`):

1. **Base per sede:**
   - Costruisco uno scope esplicito: `{ scopeIds: ctx.scopeIds, aggregate: ctx.isOwner, isOwner: ctx.isOwner }`.
     - Owner → `aggregate = true` ⇒ `whereValutazione` ritorna `{ agenziaId }`
       (tutte le sedi, incluse le righe legacy `agenziaSedeId = null`). Ignora
       di fatto il cookie.
     - Non-owner → `aggregate = false` ⇒ `{ agenziaId, agenziaSedeId: { in: scopeIds } }`
       (invariato rispetto a oggi).
   - Riuso `whereValutazione(scope, agenziaId)` per entrambi.
2. **Narrowing sede (solo owner):** se `sede` è presente **e** ∈ `ctx.accessibleSedi`
   (fail-closed: id non valido ⇒ trattato come "Tutte"), aggiungo
   `agenziaSedeId = sede`. Per i non-owner `sede` è ignorato del tutto.
3. **Range date (tutti):** se `da`/`a` validi, aggiungo `createdAt` con `gte`/`lte`.
   - `da` → `gte` inizio giornata; `a` → `lte` fine giornata.
   - Parsing giorno→istante in `Europe/Rome` (vedi Edge cases). Data malformata
     ⇒ ignorata (fail-open sul singolo bound, nessun 500).

Il **medesimo** `where` alimenta sia `findMany` (lista) sia `aggregate`
(media + conteggio), preservando la coerenza esistente.

## Componenti

### `feedback/filters.tsx` (nuovo, client)

Mirror di `AdminPraticheFilters`, adattato:
- `form method="get" action="/feedback"`.
- Due `<input type="date">` **Da** / **A** (`name="da"`, `name="a"`), apply
  `onChange` via `requestSubmit()`.
- `<select name="sede">` con `"Tutte le sedi"` + le sedi accessibili — reso
  **solo** se la prop `sedi` è passata (owner). Per i non-owner il select non
  esiste nel DOM.
- Layout: una riga (date + eventuale select) come la barra admin; a colonna su
  mobile (grid responsive).
- Props: `{ da?: string; a?: string; sede?: string; sedi?: {value; label}[] }`.

### `feedback/page.tsx` (modifica)

- Firma con `searchParams: Promise<{ da?; a?; sede? }>`.
- Calcola `where` come sopra.
- `findMany` include **sempre** `agenziaSede: { select: { nome: true } }` (join
  banale, costo trascurabile); la label viene **renderizzata in card solo se owner**.
- Rende `<FeedbackFilters ... sedi={owner ? opzioniSedi : undefined} />`.
- Nella card, se owner, mostra la sede: `v.agenziaSede?.nome ?? 'Sede non assegnata'`
  nella riga meta accanto a dealer/codice pratica.
- Header count + empty-state adattati a "filtri attivi" / "nel periodo selezionato".

## Edge cases

- **Righe legacy `agenziaSedeId = null`**: label fallback `"Sede non assegnata"`;
  visibili sotto "Tutte le sedi"; escluse quando si filtra su una sede specifica.
- **`sede` non valido / non tra le sedi accessibili**: trattato come "Tutte"
  (fail-closed sul privilegio, non 500).
- **Date malformate** (`da`/`a` non `YYYY-MM-DD`): il bound viene ignorato.
- **`da > a`**: nessun risultato (legittimo), niente errore.
- **Timezone**: parsing dei bound giorno in `Europe/Rome` per evitare che un
  feedback delle 23:30 finisca nel giorno sbagliato. Implementazione: costruire
  gli istanti UTC corrispondenti a `00:00:00` e `23:59:59.999` ora italiana.
- **Non-owner con più sedi in membership**: continua a NON avere il filtro sede
  né la label (scelta di scope: sede = solo owner).

## Testing

- Unit sulla logica di composizione `where` (estratta in helper puro se serve):
  owner senza filtri → `{ agenziaId }`; owner con `sede` valido → aggiunge
  `agenziaSedeId`; `sede` non valido → ignorato; non-owner → mai `sede`; date →
  `createdAt` gte/lte corretti; date malformate → ignorate.
- Verifica manuale sul DB locale (read-only) che le query con i nuovi filtri
  ritornino ciò che ci si aspetta (cfr. prassi "prova le query nuove sul DB reale").
- E2E leggero a fine fase: owner vede select sede + label; utente sede vede solo
  le date; filtro date restringe lista + media/conteggio coerenti.

## Fuori scope (YAGNI)

- Paginazione, export CSV, filtro per numero stelle.
- Opzione "Non assegnate" nel select sede.
- Vista feedback per l'admin di piattaforma (cross-agenzia).
- Persistenza dei filtri oltre i query param dell'URL.
