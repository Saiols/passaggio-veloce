# Notifiche real-time in-app — B1: badge Inbox (polling) — Design

Data: 2026-06-14
Autore: Francesco Sioli (CTO) + Claude
Stato: approvato

## Problema / obiettivo

L'agenzia non vede in tempo reale, dentro la piattaforma, l'arrivo di nuove
pratiche: deve ricaricare la pagina. Le email arrivano istantanee, ma manca
l'indicatore in-app. Obiettivo B1: un **badge real-time sulla voce Inbox** (solo
agenzie) che mostra il numero di pratiche in arrivo e si aggiorna da solo, con
**auto-refresh** della lista quando ne arrivano di nuove.

Nota architetturale: **no websocket**. Su Next/Vercel (serverless) i websocket
sono scomodi; per questo caso il **polling** client di un endpoint leggero è
"tempo reale" a sufficienza e non richiede infra aggiuntiva.

## Decisioni approvate

- Solo **B1** (badge real-time). La rifinitura UX degli step (toast/banner/CTA
  pulsanti/descrizioni) è **B2**, design separato successivo.
- Sorgente badge: **conteggio dal dominio** (`PraticaAssegnazione` PENDING), non
  un centro-notifiche IN_APP.
- Superficie v1: **solo voce Inbox agenzia**.
- Intervallo polling **~25s**, in pausa a tab nascosta, refetch al focus.
- All'**aumento** del conteggio → `router.refresh()` (auto-refresh lista).

## Contesto tecnico

- `app-shell.tsx` è un **server component**; la nav fa
  `links.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)`.
  La voce `{ href: '/inbox', label: 'Inbox' }` esiste **solo** nel ramo AGENZIA
  di `navForRole`.
- Inbox conta le pending con
  `prisma.praticaAssegnazione.findMany({ where: { agenziaId, esito: 'PENDING' } })`
  (`app/inbox/page.tsx`). Il badge usa lo stesso criterio con `count`.
- Tier/sessione: `auth()` fornisce `session.user.companyType` ('AGENZIA') e
  `companyId`.
- Enum `NotificaCanale` ha già `IN_APP` e `NotificaInviata.readAt` esiste, ma NON
  vengono usati in B1 (sono per un eventuale centro-notifiche futuro = B2).

## Architettura

### 1. Endpoint `GET /api/badges`
- File: `apps/piattaforma/src/app/api/badges/route.ts`.
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- `auth()`: se non loggato → `401`.
- Se `companyType === 'AGENZIA'` e `companyId`:
  `inbox = await prisma.praticaAssegnazione.count({ where: { agenziaId: companyId, esito: 'PENDING' } })`.
  Altrimenti `inbox = 0`.
- Risposta: `NextResponse.json({ inbox }, { headers: { 'Cache-Control': 'private, no-store' } })`.
- Endpoint generico ("badges") per poter aggiungere altri conteggi in futuro
  senza nuove route.

### 2. Componente client `NavBadge`
- File: `apps/piattaforma/src/components/nav-badge.tsx` (`'use client'`).
- Props: `{ keyName?: string }` — la chiave del conteggio da leggere dalla
  risposta (default `'inbox'`).
- Stato: `count` (number), `prevCount` (ref).
- `useEffect`:
  - `fetchCount()`: `fetch('/api/badges', { cache: 'no-store' })` → JSON → set
    `count` = `data[keyName] ?? 0`. Se il nuovo valore **> precedente** → `router.refresh()`.
  - Polling: `setInterval(fetchCount, 25_000)` **solo se** `document.visibilityState === 'visible'`; su `visibilitychange` → quando torna visibile, `fetchCount()` immediato e riavvia l'intervallo; quando nascosta, ferma l'intervallo.
  - Cleanup di interval e listener allo unmount.
- Render: se `count > 0`, un pallino (`<span>`) con il numero (es. `99+` se >99),
  stile coerente col design system (pill arancio/navy, testo bianco, piccolo);
  altrimenti `null`.
- `useRouter` da `next/navigation` per `router.refresh()`.

### 3. Integrazione nella shell
- In `app-shell.tsx`, dentro il `links.map`, accanto a `{l.label}` aggiungere:
  `{l.href === '/inbox' && <NavBadge />}`.
- Nessun dato server-side aggiunto alla shell: `NavBadge` si auto-alimenta via
  endpoint (lieve "comparsa" del badge dopo il primo fetch, accettabile).
- La voce `/inbox` esiste solo per le agenzie → il badge appare solo a loro.

## Data flow / error handling
- Solo lettura (conteggio). Nessuna mutazione.
- Errori di rete nel `fetchCount`: catch silenzioso, il badge mantiene l'ultimo
  valore noto (nessun crash UI).
- A tab nascosta non si polla (riduce invocazioni serverless).

## Testing
- `typecheck` + `build` + i test esistenti verdi.
- `NavBadge` (polling/visibility) non è unit-testabile facilmente senza RTL → no
  unit test dedicato; il conteggio è una `count` banale.
- Verifica manuale: login agenzia; quando una nuova pratica viene distribuita,
  entro ~25s (o subito al focus) compare il badge col numero e la lista Inbox/
  Dashboard si aggiorna senza reload.

## Fuori scope (→ B2)
- Toast post-azione, banner "azioni da fare", descrizioni step, CTA che pulsano.
- Centro-notifiche IN_APP a campanella (con `NotificaInviata` IN_APP + readAt).
- Badge lato broker / su altre voci.

## Piano commit
1. Endpoint `/api/badges` + componente `NavBadge`.
2. Integrazione del badge nella shell (voce Inbox).
