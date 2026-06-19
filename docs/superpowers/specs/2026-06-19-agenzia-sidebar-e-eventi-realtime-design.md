# Sidebar agenzia + eventi pratica real-time — Design

Data: 2026-06-19 · Autore: Francesco (CTO) + Claude · Stato: approvato (modalità autonoma)

## Obiettivo

Due interventi UX sull'area **agenzia** (e cross-party):

- **Part A** — La top-bar dell'agenzia ha 11 voci e non è più usabile. Replicare il
  pattern già adottato per l'admin: **sidebar a colonna con voci raggruppate per
  sezione logica**, responsive (drawer su mobile).
- **Part B** — Rendere **istantanea** la consapevolezza dei passaggi di una pratica:
  ogni operazione chiave su una pratica mostra alla **controparte** una **modale
  centrata** (ovunque si trovi nell'app) che descrive l'evento e offre una CTA verso
  il prossimo step (o semplice chiusura).

## Decisioni (Q&A con l'utente)

1. **Scope sidebar**: solo **AGENZIA** (il dealer ha 7 voci, top-bar ancora ok; estendibile dopo).
2. **Transport real-time**: **polling ~10s** (visibility-aware), nessun websocket — coerente con `NavBadge` esistente e con Vercel serverless.
3. **Eventi per il broker**: **solo passaggi chiave** (accettata / lavorata / firmata / nessuna agenzia). I rifiuti dei singoli round restano interni (niente spam).
4. **Comportamento modale**: **chiusura = vista per sempre**; più eventi in **coda** uno alla volta, dal più recente.

## Part A — Architettura sidebar

`AdminShell` (in prod, funzionante) contiene già tutta la chrome a sidebar. La
generalizziamo per riuso senza duplicazione e senza regressioni:

- **`SidebarShell`** (nuovo, presentazionale puro): riceve `groups: NavGroup[]`,
  dati utente (nome, ruolo-label), `homeHref`, `scrollKey`, `extra?` (slot per
  contenuti globali come il watcher eventi), `children`. Contiene tutta la JSX
  attuale di AdminShell (drawer mobile, scroll-persist via sessionStorage, footer).
- **`AdminShell`** → wrapper sottile: costruisce i NAV_GROUPS admin (con filtro
  `adminOnly`), passa a `SidebarShell`. API esterna invariata → admin non cambia.
- **`AgenziaShell`** → wrapper sottile: NAV_GROUPS agenzia, wrappa i children in
  `ToastProvider` (i toast/guida B2 sono usati dall'agenzia) e monta il watcher eventi.
- **`AppShell`** → oltre all'early-return admin/assistente, ora early-returna ad
  `AgenziaShell` per `companyType === 'AGENZIA'`. Il **DEALER** resta sulla top-bar
  storica (ma con il watcher eventi montato, vedi Part B).

### Raggruppamento voci agenzia

| Sezione | Voci |
|---|---|
| Panoramica | Dashboard |
| Operatività | Inbox (+badge), Pratiche attive |
| Finanze | Wallet, Addebiti, Fatture |
| Crescita | Affiliazione, Feedback |
| Impostazioni | Orari, Notifiche, Profilo, Team (solo ADMIN_AZIENDA) |

Icone: riuso da `admin-icons.tsx` dove esistono (Dashboard, Pratiche, Finance,
Affiliazioni, Utenti); aggiungo le mancanti (Inbox, Wallet, Addebiti, Fatture,
Notifiche, Profilo, Orari, Feedback) nello stesso file.

## Part B — Eventi pratica real-time

### Modello dati (nuova tabella)

`EventoPratica` — feed di eventi in-app, separato dal log email `NotificaInviata`:

```
model EventoPratica {
  id              String    @id @default(uuid()) @db.Uuid
  praticaId       String?   @db.Uuid           // scalare, NO FK (soft ref, come log)
  targetCompanyId String    @db.Uuid           // azienda che deve vedere la modale
  tipo            String                         // costante app-level (no enum churn)
  titolo          String
  testo           String
  ctaLabel        String?
  ctaHref         String?
  seenAt          DateTime?
  seenByUserId    String?   @db.Uuid
  createdAt       DateTime  @default(now())
  @@index([targetCompanyId, seenAt])
  @@index([praticaId])
  @@map("eventi_pratica")
}
```

Soft-ref (niente relazioni Prisma) per non toccare i modelli `Pratica`/`Company` e
limitare la migration a una sola tabella nuova. `tipo` è una stringa con costanti
in `lib/eventi/tipi.ts` (es. `PRATICA_ACCETTATA`) → nessun churn di enum.

### Emissione lato server

Helper `emitEventoPratica(client, {...})` + builder per tipo in
`lib/eventi/pratica-eventi.ts`. Agganci alle transizioni (dentro la stessa tx o
post-commit best-effort, come le email), **target = controparte**:

| Evento | Sorgente | Target | tipo | CTA |
|---|---|---|---|---|
| Nuova pratica disponibile | `avviaRound()` (distribuzione) | ogni agenzia assegnata | `NUOVA_PRATICA` | → /inbox |
| Pratica accettata | `acceptPratica()` | broker | `PRATICA_ACCETTATA` | → /pratiche/{id} |
| Pratica lavorata | `markPraticaProcessataAction()` | broker | `PRATICA_LAVORATA` | → /pratiche/{id} |
| Firma avvenuta | `markFirmaAvvenutaAction()` | broker | `PRATICA_FIRMATA` | → /pratiche/{id} |
| Nessuna agenzia (escalation) | `tickPratica()` escalation | broker | `PRATICA_ESCALATION` | → /pratiche/{id} |
| Assegnata da admin | `assegnaEscalationAction()` | agenzia | `PRATICA_ASSEGNATA` | → /inbox |
| Annullata dopo accettazione | `annullaPraticaAction()` | agenzia assegnata | `PRATICA_ANNULLATA` | chiudi |
| Penale confermata | conferma segnalazione admin | broker + agenzia | `PRATICA_PENALE` | → /pratiche/{id} |

I rifiuti di singola agenzia (`rejectPratica`) **non** generano eventi (decisione Q3).
Quando un'agenzia accetta, gli eventi `NUOVA_PRATICA` ancora non visti delle altre
agenzie per quella pratica vengono marcati visti (auto-dismiss del lavoro non più disponibile).

### Client

- `GET /api/eventi/pending` → eventi non visti per la company in sessione, newest-first, limit.
- `POST /api/eventi/seen` → marca `seenAt`/`seenByUserId` (solo se `targetCompanyId` = company in sessione).
- **`EventoPraticaWatcher`** (client): polling ~10s visibility-aware (pattern `NavBadge`),
  coda in stato locale, **modale centrata** (overlay, titolo, testo, CTA primaria se
  `ctaHref` + "Chiudi"). Chiusura/CTA → `POST seen` → avanza coda. La CTA naviga via
  `router.push`. Montato in `AgenziaShell` e nel ramo dealer di `AppShell` (eventi a
  entrambe le figure; admin fuori scope).

Coesiste con il sistema esistente (toast/guida B2 = azioni proprie dell'utente; la
modale = eventi della controparte) e con le **email** (invariate).

## Verifica

- Unit test sui builder evento (`pratica-eventi.ts`) e sul filtro pending.
- `tsc`, `eslint`, suite vitest, `next build`.
- Smoke manuale dell'utente in prod: ogni transizione mostra la modale corretta alla controparte; navigazione di tutte le voci sidebar agenzia.

## Out of scope (per ora)

- Sidebar dealer (estendibile riusando `SidebarShell`).
- Eventi non-pratica (account, payout affiliazione) nella modale.
- Allineamento delle email "giorno 20/programmato" (`notifiche/templates.ts`) — separato.
