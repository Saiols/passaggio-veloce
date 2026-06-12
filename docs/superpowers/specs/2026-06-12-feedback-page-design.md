# Pagina Feedback ricevuti (agenzia) + rimozione segnalazione abuso prezzo — Design

Data: 2026-06-12
Autore: Francesco Sioli (CTO) + Claude
Stato: approvato

## Problema / obiettivo

1. **Feedback page**: l'agenzia non ha una vista d'insieme dei feedback ricevuti;
   oggi li vede solo entrando nel dettaglio di ogni pratica. Serve una pagina
   dedicata `/feedback` che raggruppi tutte le valutazioni ricevute (stelle, testo,
   autore, numero pratica con link al dettaglio). Il blocco "Rating" nella dashboard
   agenzia deve diventare cliccabile e atterrare su questa pagina.
2. **Rimozione abuso prezzo**: eliminare completamente la feature "segnalazione
   abuso prezzo" (`segnalazioneAbuso` su `Valutazione`) — sia il rilascio che la
   visualizzazione.

## Decisioni approvate

- Accesso pagina: card dashboard **+** voce sidebar "Feedback" (agenzia).
- Flag abuso: **rimosso del tutto** (vedi Parte B).
- Header riepilogo: **sì** (media stelle + numero feedback).
- Lista: **recente-first, senza filtri** (no paginazione in v1).
- Campo DB `segnalazioneAbuso`: **DROP COLUMN con migration**.

## Contesto tecnico

- **Modello `Valutazione`** (`packages/db/prisma/schema.prisma`): `praticaId` (unique),
  `agenziaId`→Company, `dealerId`→Company (= autore del feedback), `stelle` (1..5),
  `note` (String?), `segnalazioneAbuso` (Boolean, **da rimuovere**), `createdAt`.
- **Dashboard agenzia** (`app/dashboard/agenzia-dashboard.tsx`): card "Rating" via
  `<StatCard label="Rating" value={ratingValue} hint={ratingHint} .../>`; il valore
  mostra `—` finché `< 5` valutazioni (soglia ranking), ma i singoli feedback vanno
  mostrati sempre.
- **`StatCard`** (`components/ui/stat-card.tsx`): è un `<div>` senza `href`.
- **Nav agenzia**: `app-shell.tsx` → `getNavLinks`, ramo `companyType === 'AGENZIA'`.
- **Guard agency-only**: pattern `auth()` → `redirect('/login')` se non loggato →
  redirect/Alert se non AGENZIA (vedi `orari/page.tsx`).
- **Dettaglio pratica** `/pratiche/[id]`: già accessibile all'agenzia assegnata
  (gestisce viewer AGENZIA), quindi il link "numero pratica → dettaglio" funziona.
- **Punti di scrittura/lettura di `segnalazioneAbuso`** (da rimuovere):
  - `app/pratiche/[id]/valutazione-form.tsx`: stato `abuso`, checkbox, append FormData.
  - `app/pratiche/actions.ts`: campo zod, destructure, `data.create`.
  - `app/pratiche/[id]/page.tsx`: blocco display "Segnalata per abuso prezzo".
  - `packages/db/prisma/seed.ts`: parametro e uso (valutazione demo con abuso).
  - `packages/db/prisma/schema.prisma`: definizione campo.
- **NON toccare**: anti-abuso ranking (`lib/distribuzione/*`) e anti-abuso chatbot
  (rate-limit) — feature diverse e indipendenti. L'admin-view "gestione segnalazioni
  abusi" non è mai stata implementata (TODO non spuntato), nessun consumer da rimuovere.

## Architettura — Parte A (Feedback page)

### Route `app/feedback/page.tsx` (server component)
- Guard: `auth()`; non loggato → `redirect('/login')`; `companyType !== 'AGENZIA'`
  → `redirect('/dashboard')`.
- Query:
  - `valutazioni = prisma.valutazione.findMany({ where: { agenziaId }, orderBy: { createdAt: 'desc' }, include: { dealer: { select: { ragioneSociale: true } }, pratica: { select: { id: true, codicePratica: true } } } })`
  - `agg = prisma.valutazione.aggregate({ where: { agenziaId }, _avg: { stelle: true }, _count: { _all: true } })`
- Render dentro `<AppShell session activePath="/feedback">`:
  - **Header**: titolo "Feedback ricevuti"; se `count > 0` riepilogo "media `X.X` ★ ·
    `N` feedback"; altrimenti niente riepilogo.
  - **Lista**: se vuota → empty state "Nessun feedback ricevuto ancora."; altrimenti
    una `Card` per valutazione con:
    - `<Stars n={stelle} />` + `stelle/5`
    - `note` tra virgolette se presente
    - riga meta: `dealer.ragioneSociale` · `<Link href={`/pratiche/${pratica.id}`}>` con
      `pratica.codicePratica` · data (`formatRelative(createdAt)`).

### Componente `Stars`
- File: `app/feedback/stars.tsx` (o helper inline). Presentazionale: rende `n` ★ piene
  (arancio) + `5-n` vuote (slate). Riusabile, una sola responsabilità.

### Dashboard rating card cliccabile
- `StatCard`: aggiungere prop opzionale `href?: string`. Se presente, l'intera card è
  un `<Link href>` con affordance hover (`hover:border`/`hover:shadow`); altrimenti
  resta un `<div>`. Niente impatto sugli usi esistenti.
- `agenzia-dashboard.tsx`: la card "Rating" riceve `href="/feedback"`.

### Sidebar
- `app-shell.tsx` `getNavLinks`, ramo AGENZIA: aggiungere
  `{ href: '/feedback', label: 'Feedback' }` (dopo "Pratiche attive").

## Architettura — Parte B (rimozione abuso prezzo)

- `valutazione-form.tsx`: rimuovere stato `abuso`, blocco checkbox, e
  `if (abuso) fd.append('segnalazioneAbuso', 'true')`. Rimuovere import `Checkbox` se
  non più usato.
- `pratiche/actions.ts`: rimuovere `segnalazioneAbuso` da zod schema, dal destructure
  e dal `prisma.valutazione.create({ data: { ... } })`.
- `pratiche/[id]/page.tsx`: rimuovere il blocco `{pratica.valutazione.segnalazioneAbuso && (...)}`.
- `seed.ts`: rimuovere il parametro `segnalazioneAbuso` dalla helper di creazione
  valutazioni e l'uso; la valutazione demo "con abuso" diventa una normale valutazione.
- `schema.prisma`: rimuovere la riga `segnalazioneAbuso Boolean @default(false)`.
- **Migration**: `prisma migrate dev --name drop_segnalazione_abuso` (genera `DROP COLUMN`).
  In prod si applicherà con `migrate deploy` (vedi processo di rilascio).
- Doc: aggiornare `piano-implementazione.md` (righe TODO 398/436) segnando la feature
  rimossa.

## Data flow / error handling
- Solo lettura per la pagina feedback; nessuna mutazione nuova. Le valutazioni restano
  create dalla `submitValutazioneAction` (senza più `segnalazioneAbuso`).
- Empty/zero-feedback gestito esplicitamente. Guard di accesso fail-safe (redirect).

## Testing
- `typecheck` + `build` + i 459 test esistenti (verifica che `seed.ts` compili).
- Nessun test esistente referenzia `segnalazioneAbuso` in modo da rompersi (verificare;
  in caso aggiornarli).
- Pagina feedback: presentazionale, nessun unit test dedicato; eventuale piccolo test
  solo se si estrae logica (es. formattazione media) — YAGNI, probabilmente no.
- Verifica manuale: dashboard agenzia → click card Rating → `/feedback`; lista con
  stelle/testo/autore/pratica; link pratica apre il dettaglio; voce sidebar attiva.

## Piano commit (logici)
1. Parte B — rimozione abuso prezzo (UI + action + display + seed + schema + migration + doc).
2. `StatCard` href + dashboard card link.
3. Pagina `/feedback` + componente `Stars`.
4. Voce sidebar agenzia.
