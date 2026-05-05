# Passaggio Veloce — Bug Fix & Feature List (Release 2026-05)

> Sorgente: `docs/PV BugFix FeatureList.docx` (emesso 2026-05-04 dai soci dopo demo 2026-05-01).
> Owner: CTO Francesco Sioli. Target: portare a termine tutti gli item in 1-2 sessioni di lavoro.
> Source of truth della release. Il piano-implementazione.md rimane source of truth per le fasi.

---

## Legenda stato
- [ ] Da fare
- [~] In corso
- [x] Completato
- [!] Bloccato (vedi note)

---

## Roadmap di lavorazione (ordine consigliato)

L'ordine minimizza rework: prima schema/migrazioni, poi backend, poi UI, poi cross-cutting.

| # | Item | Tipo | Effort | Blocca | Bundle |
|---|------|------|--------|--------|--------|
| 11 | Stato `PROCESSATA` nel workflow | Schema + UX | M | 8, 16 | A |
| 08 | Bottoni stato cliccabili da lista + lampeggio | UX | S | — | A |
| 16 | Admin pratiche: filtri + riga cliccabile | UX | S | — | A |
| 02 | Broker: nascondere Round/coda | Visibility | S | — | B |
| 09 | Agenzia "da gestire": niente Round labels | Visibility | XS | — | B |
| 10 | Pratiche attive: rimuovere filtri R1/R2/R3 + Escalation | Visibility | XS | — | B |
| 13 | Escalation admin: stelle agenzie nella selezione | UX | S | — | B |
| 07 | Bug mail duplicata su creazione utente team | Bug critico | M | 14 | C |
| 14 | Stesso bug + edit assistente admin | Bug | S | dipende 07 | C |
| 01 | Modifica utente team + admin vede credenziali | Feature | M | dipende 07 | C |
| 04 | Modifica profilo Admin (dealer + agenzia) | Feature | S | — | C |
| 05 | Registrazione: split flussi separati | UX | S | — | D |
| 03 | Wallet: dashboard rendimento annuale | Feature | M | — | E |
| 06 | Agenzia: grafico earnings affiliazione | Feature | S | dipende 03 | E |
| 12 | Soglia payout automatico configurabile | Feature | M | — | E |
| 15 | Finanze admin: dashboard finanziaria completa | Feature | M | dipende 03 | F |
| 17 | Eliminazione definitiva account + email auto | Feature | M | — | F |
| 18 | Pagina Contatti → CRM | UX/rename | XS | — | F |
| 19 | Admin: nuova pagina Affiliazioni completa | Feature | L | — | F |

Bundle suggeriti per commit logici:
- **Bundle A — Workflow pratica** (11, 08, 16): schema enum + UI azioni rapide
- **Bundle B — Pulizia visibilità** (02, 09, 10, 13): UI filtri/labels round
- **Bundle C — Team & utenti** (07, 14, 01, 04): modello + UI gestione
- **Bundle D — Registrazione split** (05): UX entry-point
- **Bundle E — Wallet & dashboard performance** (03, 06, 12): metrics + payout
- **Bundle F — Admin tools** (15, 17, 18, 19): dashboard, lifecycle account, CRM rename, affiliazioni

---

## BUNDLE A — Workflow pratica

### 11. Nuovo stato `PROCESSATA` nel workflow pratica  [Feature]
- [ ] Aggiungere `PROCESSATA` all'enum `PraticaStato` in `packages/db/prisma/schema.prisma` (tra `ACCETTATA` e `FIRMATA`)
- [ ] Migrazione Prisma `add_pratica_stato_processata`
- [ ] Server action `markPraticaProcessataAction` (solo agenzia assegnata, transizione `ACCETTATA → PROCESSATA`)
- [ ] Aggiornare `markFirmaAvvenutaAction` per accettare anche `PROCESSATA → FIRMATA` (mantenere retro-compat `ACCETTATA → FIRMATA` se serve, da decidere)
- [ ] Notifica nuova `N13_PRATICA_PROCESSATA` al broker (template breve: "L'agenzia ha completato la lavorazione, attendi conferma firma")
- [ ] UI dettaglio pratica: bottone "Pratica Processata" visibile in stato `ACCETTATA` (solo agenzia assegnata)
- [ ] Badge pratica: nuovo colore/label per `PROCESSATA` (warm/orange? slate-700?)
- [ ] Aggiornare label e colori in `packages/db/prisma/seed*.ts` se ci sono fixture
- [ ] Test e2e: creazione → accettazione → processata → firmata
- **Apri B-NEW-1**: la transizione `ACCETTATA → FIRMATA` diretta resta possibile, o si forza il passaggio per `PROCESSATA`? Vedi sezione "Dubbi aperti".

**Acceptance:**
- L'agenzia in pratica accettata vede il bottone "Pratica Processata"
- Click → stato pratica diventa `PROCESSATA`
- L'agenzia (e solo lei) vede poi "Pratica Firmata"
- Il broker riceve notifica al cambio `PROCESSATA`
- Cron timeout / SLA round non sono toccati (solo finestra fino ad accettazione)

### 08. Bottoni stato cliccabili da lista pratiche + lampeggio  [Feature/UX]
- [ ] Componente `<PraticaQuickActions>` riusabile per riga lista
- [ ] Lista pratiche broker: visibile bottone "Pratica Firmata" (se stato `ACCETTATA` o `PROCESSATA` e broker è owner)
- [ ] Lista pratiche agenzia: visibile "Pratica Processata" (stato `ACCETTATA`) e "Pratica Firmata" (stato `PROCESSATA`)
- [ ] Lista admin pratiche: visibili azioni admin coerenti con permission
- [ ] Animazione `animate-pulse` (Tailwind) o keyframe custom su bottoni che fanno avanzare workflow + generano notifiche
- [ ] Le azioni inline aprono dialog di conferma (no submit silente)

**Acceptance:**
- Da `/pratiche` (broker o agenzia) si può cliccare il bottone di avanzamento senza aprire dettaglio
- Il bottone pulsa con effetto chiaramente visibile
- Toast/feedback dopo successo, riga si aggiorna ottimisticamente

### 16. Admin gestione pratiche: filtri allineati + riga intera cliccabile  [Feature/UX]
- [ ] Aggiornare `<select name="stato">` di `/admin/pratiche` con tutti i nuovi stati (incluso `PROCESSATA`)
- [ ] Allineare label/colori badge a quelli broker/agenzia
- [ ] Riga lista: l'intera area `<tr>` apre il dettaglio (`onClick`) — usare `cursor-pointer` + `hover:bg-pv-slate-50`
- [ ] Mantenere accessibilità: keyboard `Enter` su riga focusata
- [ ] Estendere stessa logica anche a lista pratiche broker/agenzia (per coerenza)

---

## BUNDLE B — Pulizia visibilità Round/Escalation

### 02. Broker: nascondere Round e coda  [Bug/Visibility]
- [ ] Nella lista pratiche broker, rimuovere ogni riferimento a `Round 1/2/3` e numero agenzie in coda
- [ ] Stati visibili broker: `BOZZA`, `IN_ATTESA`, `ACCETTATA`, `PROCESSATA`, `FIRMATA`, `SCADUTA`, `ANNULLATA`
- [ ] Mappa `IN_ATTESA_ROUND_1/2/3 → IN_ATTESA` in helper `formatPraticaStatoForBroker(...)`
- [ ] `IN_ESCALATION` per il broker mostra solo "In gestione team Passaggio Veloce" (mai "escalation")
- [ ] Dettaglio pratica broker: nasconde panel `RoundDistribution` / `Coda agenzie`
- [ ] Mostra solo agenzia assegnata se stato ≥ `ACCETTATA`

**Acceptance:** Un broker non vede mai parole "Round 1/2/3", nomi agenzie in coda, escalation.

### 09. Agenzia "Pratiche da gestire": niente label Round  [Bug/Visibility]
- [ ] Nella lista pratiche disponibili agenzia, rimuovere badge `Round 1/2/3`
- [ ] Mostrare solo timestamp invio + tempo restante (ore lavorative)
- [ ] L'agenzia non sa "in che round si trova"

### 10. Pratiche attive: rimuovere filtri Round + Escalation  [Bug/Visibility]
- [ ] In `/pratiche` rimuovere opzioni `In attesa R1`, `R2`, `R3`, `Escalation` dal filtro stato
- [ ] Mantenere solo: `Tutti`, `Bozza`, `In attesa`, `Accettata`, `Processata`, `Firmata`, `Scaduta`, `Annullata`
- [ ] Applica sia broker che agenzia che admin (tranne admin che vede ancora `IN_ESCALATION` per gestire override)

### 13. Escalation admin: ranking stelle agenzie nella selezione manuale  [Feature/UX]
- [ ] Nella `/admin/escalation/[id]` (o equivalente) la dropdown `<select>` agenzie mostra `${ragioneSociale} · ★ 4.7 (32)` con rating + numero pratiche valutate
- [ ] Ordinare lista per ranking discendente
- [ ] Se nessun rating ancora → "★ — (nuova)"

---

## BUNDLE C — Team & gestione utenti

### 07. Bug mail duplicata su creazione utente team  [Bug critico]

**Contesto:** oggi `User.email` è `@unique` globale. Quando si crea un utente team con email già usata altrove, il DB lo rifiuta.

**Soluzione concettuale:** distinguere "account login piattaforma" (registrazione azienda) vs "membro team interno" (gestione operativa, può anche non avere login proprio o averne uno scope-azienda).

**Decisione tecnica proposta** (da confermare in "Dubbi aperti"):
- Opzione (A) — Quick: rimuovere `@unique` su `User.email`, aggiungere `@@unique([companyId, email])`. Login resta possibile, ma una stessa email può esistere in più aziende. La login deve risolvere l'azienda (ad es. user sceglie a quale azienda accedere se >1 match, oppure si forza dominio email diverso).
- Opzione (B) — Pulita: separare `TeamMember` (no login, solo gestione interna) da `User` (login). Stesso modello `User` ma flag `isLoginUser` o relazione `Account` separata.

**Sotto-task (con opzione A):**
- [ ] Rimuovere `email @unique` da `User`, aggiungere `@@unique([companyId, email])`
- [ ] Aggiornare `prisma/schema.prisma` + migrazione `team_email_per_company`
- [ ] Auth: in `signIn`, se >1 match per email → richiedere companySelector (form aggiuntivo) o fallback "stesso utente, scegli azienda"
- [ ] Aggiornare `team/actions.ts` per cercare conflitto solo nello scope `companyId`
- [ ] Test e2e: creazione team in azienda A con email che già esiste in azienda B

### 14. Assistente admin: stesso bug mail + edit assistente  [Bug]
- [ ] Aggiornare `assistenti/actions.ts` con stessa logica dell'item 07 (assistenti hanno `companyId = null`, conflitto solo tra admin platform stessi)
- [ ] Aggiungere route `/admin/assistenti/[id]/edit` con form analogo a company-edit-form
- [ ] Server action `updateAssistenteAction` (campi: nome, cognome, email, status)

### 01. Modifica utente team + admin vede credenziali  [Feature]
- [ ] Route `/team/[userId]/edit` per admin azienda
- [ ] Form: nome, cognome, email (con validazione unique scope-azienda), role
- [ ] Server action `updateTeamUserAction` (guard: deve essere admin/owner della stessa company)
- [ ] **Visibilità password:** la password non è mai memorizzata in chiaro. Soluzione proposta:
  - Alla creazione utente, mostrare la password generata in un alert one-time (con bottone "Copia")
  - Aggiungere bottone "Reset password" sulla pagina edit che genera nuova password e la mostra una sola volta
  - **No** visualizzazione persistente password (anti-pattern di sicurezza, GDPR-rischio)
- [ ] L'email di invito (se in flusso "invita") resta valida; in opzione B "crea account diretto" si mostra password generata
- [ ] Audit log: chi ha resettato password di chi e quando (campo `Audit.action = 'PASSWORD_RESET'`)

### 04. Modifica profilo Admin dealer/agenzia  [Feature]
- [ ] Route `/profilo/edit` (per admin azienda) o estensione a `/profilo`
- [ ] Form modifica dati personali: nome, cognome, email, telefono
- [ ] Form modifica company: ragione sociale, indirizzo, città, telefono, email azienda (riusare `<CompanyEditForm>` esistente, oggi usato solo da admin platform)
- [ ] Server action `updateOwnProfileAction` + `updateOwnCompanyAction`

---

## BUNDLE D — Registrazione split

### 05. Registrazione: split in 2 flussi separati  [Feature/UX]
- [ ] Pagina `/register` rifatta come scelta tra due card grandi: "Sono un Dealer Auto" / "Sono un'Agenzia di pratiche"
- [ ] Click su Dealer → `/register/dealer` (wizard pre-impostato `companyType = DEALER`)
- [ ] Click su Agenzia → `/register/agenzia` (wizard `companyType = AGENZIA`)
- [ ] Il wizard interno mostra solo i campi rilevanti al tipo (es. agenzia: orari di lavoro; dealer: dati fatturazione veicolo)
- [ ] Mantenere URL `/register?ref=<code>` funzionante: passare `ref` ai due flussi
- [ ] Copy diversificato per i due percorsi (titolo, sottotitolo, CTA)

---

## BUNDLE E — Wallet & dashboard performance

### 03. Wallet: dashboard rendimento annuale  [Feature]
- [ ] Aggiungere a `/wallet` un grafico (libreria già in stack? altrimenti Recharts: package leggero React-friendly)
- [ ] Filtri: `7d`, `30d`, `mese corrente`, `anno`, `range custom`
- [ ] Dati: somma `TransazioneWallet` di tipo `ACCREDITO_PRATICA` + `CREDITO_AFFILIAZIONE` per periodo
- [ ] Vista mobile: line chart compatto + KPI cards (totale, media giornaliera)
- [ ] Endpoint server-side che calcola aggregato (cached per 5 min se serve)

### 06. Agenzia: grafico earnings affiliazione  [Feature]
- [ ] Su `/affiliazione` aggiungere mini-grafico (sparkline o bar chart) earnings ultimi 6 mesi
- [ ] Solo `CommissioneAffiliazione.stato = ACCREDITATA` aggregato per mese
- [ ] Estensibile anche a broker per coerenza (item dice "agenzia" ma broker hanno la stessa pagina affiliazione)

### 12. Soglia payout automatico configurabile  [Feature]
- [ ] Aggiungere a `Company` campo `payoutThresholdCent Int @default(100000)` (€1000 default)
- [ ] Validazione lato server: min 100000 (€1000), max 500000 (€5000)
- [ ] UI utente azienda: in `/wallet/impostazioni` slider/input con range 1000-5000
- [ ] UI admin: campo modificabile in `/admin/companies/[id]` form (override per ogni utente della rete)
- [ ] Cron payout (FASE 5) consuma il valore dalla company invece della costante globale
- [ ] Aggiornare `lib/wallet/config.ts` per fallback default
- **Conflitto memo D-05?** Memory dice "soglie payout uguali" — verificare che fosse riferito a "default uguali" (broker/agenzia hanno stesso default), non "non configurabili". Il documento ora chiede configurabile → procedo, segnalo a Francesco.

---

## BUNDLE F — Admin tools

### 15. Finanze admin: dashboard finanziaria completa  [Feature]
- [ ] Refactor di `/admin/dashboard` (financial dashboard già esistente):
  - [ ] Aggiungere grafico rendimento (line chart) filtrabile `giorno/settimana/mese/anno`
  - [ ] Bottone "Esporta CSV" con range filtrato (esiste già export csv? verificare)
  - [ ] Quadretti separati: **Già erogato** (cron payout completato) vs **Da erogare** (wallet positivo non ancora pagato)
  - [ ] Dettaglio drill-in per categoria: per pratiche / per affiliazione
- [ ] Calcolo "da erogare" = somma `Wallet.balanceCent` di tutte le aziende non sospese
- [ ] Calcolo "già erogato" = somma `Payout.amountCent` con stato `EROGATO`
- [ ] Anti-doppi-pagamenti: query bloccata su transazione, idempotenza già garantita da `payoutId`

### 17. Eliminazione definitiva account broker/agenzia + email automatiche  [Feature]
- [ ] Bottone "Elimina definitivamente" in `/admin/companies/[id]` (oggi c'è solo sospendi)
- [ ] Server action `deleteCompanyAction`:
  - [ ] Soft delete: `Company.deletedAt = now()`, set tutti `User.deletedAt = now()`, sospensione totale
  - [ ] Hard delete dei dati personali (GDPR): scheduling cron a 90gg per purge documenti, anonimizzazione record pratiche (sostituire nominativi con placeholder)
  - [ ] Pratiche storiche restano per audit/contabilità ma anonimizzate
- [ ] Confirmation dialog con testo digitato (es. utente deve scrivere ragione sociale per confermare)
- [ ] **Email automatiche** (template Resend già pattern N*):
  - [ ] `N14_ACCOUNT_SOSPESO` (al sospendi)
  - [ ] `N15_ACCOUNT_RIATTIVATO` (al riattiva)
  - [ ] `N16_ACCOUNT_ELIMINATO` (al delete)
- [ ] Hook su `suspendCompanyAction` + `unsuspendCompanyAction` per inviare le email (oggi inviano notifica in-app?)

### 18. Admin: pagina Contatti → CRM  [UX/rename]
- [ ] Rinominare voce menu "Contatti" → "CRM" in admin sidebar
- [ ] Route `/admin/contatti` → `/admin/crm` (redirect 301 dalla vecchia)
- [ ] La pagina diventa landing del modulo CRM (oggi mostra catalogo contatti con CSV export)
- [ ] Aggiungere card "Apri Dashboard CRM completa" come placeholder verso CRM nativo (memo D-03 dice "CRM nativo differito")
- [ ] La card può rimandare a HubSpot/Airtable esterno se Alberto decide il provider esterno, o mostrare "Coming soon (FASE 14)"
- **Da chiarire con Alberto:** la "dashboard CRM completa" è il CRM nativo (quindi dipendiamo dalla FASE 14 differita) o un link a strumento esterno tipo HubSpot? Vedi "Dubbi aperti".

### 19. Admin: nuova pagina Affiliazioni completa  [Feature]
- [ ] Nuova route `/admin/affiliazioni`
- [ ] Sezioni:
  - [ ] **Lista affiliazioni attive**: ogni `Company.referente != null` con stato, data iscrizione, numero pratiche, totale generato per il referente
  - [ ] **Tabella commissioni**: ogni `CommissioneAffiliazione` con drill-down: pratica → broker/agenzia → referente → importo → stato
  - [ ] **Statistiche aggregate**: totale click, conversione click→registrazione, conversione registrazione→prima pratica, totale commissioni accreditate
  - [ ] **Filtri**: per agenzia referente, per pratica, per periodo, per importo (min/max)
  - [ ] **Export CSV** della tabella commissioni filtrata
- [ ] Permessi: solo `ADMIN_PIATTAFORMA` (escluso `ASSISTENTE` perché ha visibilità dati finanziari)
- [ ] Link cross-page: da `/admin/companies/[id]` se ha referenti → bottone "Vedi affiliazioni" che filtra questa lista

---

## Schema impacts riassuntivi

Modifiche `packages/db/prisma/schema.prisma`:

```prisma
// Nuovo stato pratica
enum PraticaStato {
  BOZZA
  IN_ATTESA_ROUND_1
  IN_ATTESA_ROUND_2
  IN_ATTESA_ROUND_3
  IN_ESCALATION
  ACCETTATA
  PROCESSATA   // NEW
  FIRMATA
  SCADUTA
  // ...
}

// Email scope-azienda
model User {
  // email String @unique  ← rimosso
  email String
  // ...
  @@unique([companyId, email]) // NEW (con scope companyId, null safe se admin platform)
}

// Soglia payout configurabile
model Company {
  // ...
  payoutThresholdCent Int @default(100000) // NEW: €1000 default, range 1000-5000
}

// Nuove notifiche (in NotificaTipo)
enum NotificaTipo {
  // ...
  N13_PRATICA_PROCESSATA       // NEW
  N14_ACCOUNT_SOSPESO          // NEW
  N15_ACCOUNT_RIATTIVATO       // NEW
  N16_ACCOUNT_ELIMINATO        // NEW
}
```

Migrazioni stimate: 3-4 (`add_pratica_processata`, `team_email_per_company`, `add_payout_threshold`, `add_account_lifecycle_notif`).

---

## Decisioni prese (2026-05-05)

> Tutti i dubbi risolti con CTO. Lavoriamo in autonomia sul resto.

1. **Item 11 — workflow:** transizione **forzata** `ACCETTATA → PROCESSATA → FIRMATA`. No shortcut.
2. **Item 07/14 — email duplicate:** approccio **multi-tenancy unique scope-company**.
   - `User.email` non più unique globale, sostituito con `@@unique([companyId, email])`
   - Login con email ambigua → utente sceglie azienda dalla lista
   - Stesso "essere umano" può avere User separati per ogni azienda
   - (Opzione "TeamMember senza login" non sensata: i dipendenti devono loggare per usare la piattaforma)
3. **Item 01 — visibilità password:** alla creazione/reset mostrata **una sola volta** in alert + bottone copia. Mai visualizzata persistentemente. CTO si fa carico di spiegare il vincolo GDPR ad Alberto.
4. **Item 12 — soglia payout:** **default uguali** broker/agenzia (€1000), **configurabili** per utente nel range 1000-5000. Memo D-05 reinterpretato come "default uguali, non non-configurabili".
5. **Item 18 — CRM:** rename pagina + placeholder "Dashboard completa in arrivo (FASE 14)". CRM nativo resta differito ma magari oggi se ne inizia uno scaffolding base.
6. **Item 17 — eliminazione definitiva:** soft delete immediato + hard delete documenti personali a 90gg via cron (compliance GDPR retention). Pratiche storiche restano per audit ma anonimizzate. **Attenzione cross-cutting:** ovunque si renderizza ragione sociale / nominativo da company eliminata, deve esistere fallback ("(Account eliminato)") senza errori 500.

---

## Dubbi aperti per Alberto / soci

> Da chiarire prima di codare i bundle relativi. Tutti gli altri item procedo in autonomia.

1. **[Item 11 — workflow]** Quando aggiungo lo stato `PROCESSATA`:
   - L'agenzia DEVE passare da `ACCETTATA → PROCESSATA → FIRMATA` (forzato, no shortcut)?
   - Oppure può ancora andare `ACCETTATA → FIRMATA` direttamente (es. quando processazione è istantanea)?
   - **Mio suggerimento:** forzare il passaggio per non perdere il segnale operativo, ma chiarire all'agenzia che "Processata" significa "ho preparato/elaborato la pratica, manca solo la firma del cliente".

2. **[Item 07/14 — email duplicate]** Ho due strade:
   - **(A)** Stessa email permessa su company diverse, login chiede di scegliere azienda quando ambigua
   - **(B)** Separare modello `TeamMember` (no login proprio) da `User` (account login). Più pulito ma riscrittura più ampia.
   - **Mio suggerimento:** opzione **A** per consegna in giornata. Opzione B come refactor strutturale futuro.

3. **[Item 01 — visibilità password]** "Admin deve vedere mail e password assegnata" → la password è hashata, non recuperabile in chiaro. Soluzione tecnica:
   - Generare password al momento della creazione, mostrarla in alert **una sola volta** + tasto "copia"
   - Bottone "Reset password" che ne genera una nuova, mostrata una sola volta
   - Visualizzare la password persistentemente sarebbe un anti-pattern di sicurezza (chiunque acceda all'admin la vede + GDPR risk).
   - **Conferma necessaria che questa interpretazione è ok per Alberto.**

4. **[Item 12 — soglia payout]** Memo D-05 (decisioni post-demo 2026-05-01) dice "soglie payout uguali". Questo nuovo item chiede di renderle configurabili per utente. Conflitto?
   - **Mia interpretazione:** D-05 si riferiva al *default* uguale tra broker e agenzia, non a "non personalizzabile". Procedo a rendere configurabile per utente come da item 12 con default unico. Conferma rapida da Francesco.

5. **[Item 18 — CRM]** "Pagina Contatti rinominata CRM con dashboard CRM completa" entra in tensione con D-03 ("CRM nativo differito"):
   - La dashboard CRM completa è la **FASE 14** (CRM nativo che era stato differito)?
   - Oppure è un **link a strumento esterno** tipo HubSpot già scelto?
   - **Mio suggerimento:** rename pagina + placeholder "Dashboard completa in arrivo (FASE 14)". Implementazione effettiva del CRM nativo resta differita.

6. **[Item 17 — eliminazione definitiva]** Hard delete completo o soft delete + purge cron a 90gg?
   - **Mio suggerimento:** soft delete immediato (utente non accede più, dati anonimizzati nel UI), hard delete documenti personali a 90gg via cron (compliance GDPR + retention). Le pratiche storiche restano per audit, ma con nominativi sostituiti.

---

## Stato avanzamento (aggiorna durante sessione)

- [ ] Bundle A — Workflow pratica (3 item)
- [ ] Bundle B — Pulizia visibilità (4 item)
- [ ] Bundle C — Team & utenti (4 item)
- [ ] Bundle D — Registrazione split (1 item)
- [ ] Bundle E — Wallet & dashboard performance (3 item)
- [ ] Bundle F — Admin tools (4 item)

**Totale:** 19/19 item

---

## Note di rilascio

- Ogni bundle viene committato come singola feature/fix in convenzione `feat(area): ...` o `fix(area): ...`
- Migrazioni Prisma applicate prima a dev (Postgres docker), poi a prod (Neon) post-validazione
- Test e2e per workflow pratica con nuovo stato `PROCESSATA` (Chrome DevTools MCP)
- Demo finale ai soci dopo completamento tutti i bundle (recap by email)
