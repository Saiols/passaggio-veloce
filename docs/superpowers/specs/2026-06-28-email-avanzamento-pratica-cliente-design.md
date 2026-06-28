# Email avanzamento pratica per acquirente e venditore — Design

**Data:** 2026-06-28
**Branch:** feat/multi-sede
**Stato:** approvato (in attesa review spec)

## Obiettivo

Acquirente e venditore di una pratica devono ricevere email sull'andamento
della pratica. Sono email **diverse e più generiche** rispetto a quelle che
ricevono broker e agenzia: comunicano il cambio di stato e il proseguimento
della pratica, senza alcun dato commerciale. Mittente: `noreply@passaggioveloce.it`.

## Decisioni di prodotto (confermate)

- **Eventi notificati — 5 momenti chiave:** avviata, presa in carico da
  un'agenzia, pronta per la firma, completata, annullata. Round ed escalation
  restano meccanica interna: **non** generano email al cliente.
- **Destinatari lato vendita — tutti i co-intestatari** con email presente,
  più l'acquirente. Dedup degli indirizzi coincidenti.
- **Contenuto — numero pratica + veicolo.** Stato, `codicePratica`,
  targa/descrizione veicolo. **Nessun dato commerciale**: niente fee, importi,
  saldo wallet, nome o contatti dell'agenzia.

## Contesto del sistema esistente

Sistema notifiche email già in produzione (Resend EU, fire-and-log):

- Invio centralizzato: `sendNotification(input)` in
  `apps/piattaforma/src/lib/notifiche/send.ts`. Audit su tabella
  `NotificaInviata` (SCHEDULED → SENT | FAILED | SKIPPED). Errori provider non
  bloccano il flusso chiamante.
- Template puri (no DB) in `apps/piattaforma/src/lib/notifiche/templates.ts`,
  uno per evento (`tplN1…tplN31`), ognuno ritorna `{ subject, html, text }`
  usando `wrap()` / `emailLayout` da `layout.ts`.
- Union discriminata `SendInput` + `render()` switch in `send.ts`.
- Mittente: `env.EMAIL_FROM` = `noreply@passaggioveloce.it`.
- Gating preferenze + footer disiscrizione: applicato **solo** se
  `isOptionalTipo(tipo) && target.userId`. I destinatari client non hanno
  `userId` → il gating è saltato a monte: le loro email sono di fatto
  transazionali, senza footer di disiscrizione.
- `Target = { email; userId?; companyId? }`; `NotificaInviata` accetta
  `userId`/`companyId` null.

Stati pratica (`PraticaStato`) e transizioni rilevanti:

| Stato cliente | Transizione DB | File / funzione | Notifica broker/agenzia affiancata |
|---|---|---|---|
| AVVIATA | BOZZA → IN_ATTESA_ROUND_1 | `pratiche/nuova/actions.ts` → `submitNuovaPraticaAction` (dopo `avviaRound1ForPratica`) | N1 |
| PRESA_IN_CARICO | IN_ATTESA_* → ACCETTATA | `inbox/actions.ts` → `acceptPratica` | N2 |
| PRONTA_FIRMA | ACCETTATA → PROCESSATA | `pratiche/actions.ts` → `markPraticaProcessataAction` | N13 |
| COMPLETATA | PROCESSATA → FIRMATA | `pratiche/actions.ts` → `markFirmaAvvenutaAction` | N4 |
| ANNULLATA | * (≠FIRMATA) → ANNULLATA | `pratiche/actions.ts` → `annullaPraticaAction` | evento annulla |

Dati parti:
- **Acquirente:** campi diretti su `Pratica` (`acquirenteEmail`,
  `acquirenteNome`, `acquirenteCognome`, `acquirenteIsPersonaGiuridica`,
  `acquirenteRagioneSociale`). Email resa obbligatoria in creazione da commit
  recente.
- **Venditori:** relazione `Pratica.venditori: Venditore[]` (co-intestatari),
  ciascuno con `email`, `nome`, `cognome`, `isPersonaGiuridica`,
  `ragioneSociale`.
- **Veicoli:** relazione `Pratica.veicoli` (n veicoli per pratica), con targa.

## Architettura della soluzione

### Approccio: tipo unico parametrico (approccio A)

Un solo tipo notifica `N40_CLIENTE_AVANZAMENTO`. Il payload porta `stato` e
`ruolo`; un'unica funzione template fa lo switch interno. Tutta la copy
client-facing vive in un punto solo → tono coerente e manutenzione semplice.
Il dettaglio del milestone resta tracciato in `NotificaInviata.payload.stato`.

(Alternativa scartata: 5 tipi separati N40…N44 — più aderente alla convenzione
"un tipo = un evento" e filtrabile per milestone in audit, ma 5× le entry in
union/render/import. Non giustificato per copy condivisa.)

### Componenti (tutti in `apps/piattaforma/src/lib/notifiche/`)

1. **Template puro** `tplN40ClienteAvanzamento(payload)` in `templates.ts`.
   - Tipi payload:
     ```ts
     export type ClienteAvanzamentoStato =
       | 'AVVIATA' | 'PRESA_IN_CARICO' | 'PRONTA_FIRMA' | 'COMPLETATA' | 'ANNULLATA';
     export type ClienteAvanzamentoRuolo = 'ACQUIRENTE' | 'VENDITORE';
     export type N40ClienteAvanzamentoPayload = {
       codicePratica: string;
       veicoloDescrizione: string | null; // es. "AB123CD" o "AB123CD +2"
       nomeDestinatario: string;
       ruolo: ClienteAvanzamentoRuolo;
       stato: ClienteAvanzamentoStato;
     };
     ```
   - `switch (stato)` per subject + corpo; micro-variazione su `ruolo`
     ("passaggio di proprietà in acquisto" vs "in vendita").
   - Nessun accesso DB. Usa `wrap()` / `emailLayout`. HTML escape su tutti i
     campi dinamici (come gli altri template via `escapeHtml`).

2. **Registrazione tipo** in `send.ts`: voce nella union `SendInput`
   (`tipo: 'N40_CLIENTE_AVANZAMENTO'`) + case in `render()`. **Non** aggiunto a
   `OPTIONAL_TIPI` in `preferences.ts` → transazionale.

3. **Orchestratore** `notifyClientiAvanzamento(praticaId, stato)` in nuovo file
   `lib/notifiche/cliente.ts` (`import 'server-only'`):
   - Carica la pratica con `venditori`, campi `acquirente*`, `veicoli`,
     `codice`.
   - Costruisce `veicoloDescrizione` dai veicoli (targa del primo; se più di
     uno, `"<targa> +<n-1>"`; null se nessuna targa).
   - Costruisce la lista destinatari:
     - acquirente: da `acquirenteEmail`, `ruolo: 'ACQUIRENTE'`, nome da
       ragione sociale (se PG) o nome+cognome;
     - ogni venditore: da `venditore.email`, `ruolo: 'VENDITORE'`, nome
       analogo.
   - Filtra email vuote/null. **Dedup per email lowercased+trim** (in caso di
     coincidenza, primo vince).
   - Per ciascun destinatario chiama `sendNotification({ tipo:
     'N40_CLIENTE_AVANZAMENTO', target: { email }, payload })`.
   - Fire-and-log: l'intera funzione è best-effort; eventuali errori loggati,
     mai propagati al chiamante.
   - Separazione di responsabilità: l'orchestratore fa il DB load; il template
     resta puro.

4. **Trigger nei 5 punti** (una riga ciascuno, accanto alla notifica
   broker/agenzia esistente, post-commit best-effort):
   - `submitNuovaPraticaAction` → `notifyClientiAvanzamento(id, 'AVVIATA')`
   - `acceptPratica` → `'PRESA_IN_CARICO'`
   - `markPraticaProcessataAction` → `'PRONTA_FIRMA'`
   - `markFirmaAvvenutaAction` → `'COMPLETATA'`
   - `annullaPraticaAction` → `'ANNULLATA'` (vedi edge case sotto)

## Copy (bozza, rifinibile dal team sales)

Tono generico, rassicurante, niente dati commerciali. Soggetto include
`codicePratica`. Esempi corpo:

- **AVVIATA:** «La pratica per il passaggio di proprietà del veicolo
  {veicolo} è stata avviata. Ti terremo aggiornato sui prossimi passaggi.»
- **PRESA_IN_CARICO:** «Un'agenzia partner ha preso in carico la pratica e si
  occuperà degli adempimenti.»
- **PRONTA_FIRMA:** «I documenti sono pronti: a breve verrai contattato per la
  firma.»
- **COMPLETATA:** «Il passaggio di proprietà è stato completato con successo.»
- **ANNULLATA:** «La pratica è stata annullata.»

## Edge cases

- **Email mancante** (pratiche precedenti all'obbligatorietà): destinatario
  saltato in silenzio (filtro a monte).
- **ANNULLATA da BOZZA:** se la pratica non è mai stata inviata (clienti mai
  avvisati di "avviata"), **non** inviare email di annullamento. Invio
  ANNULLATA solo se lo stato precedente all'annullamento era post-submit
  (IN_ATTESA_ROUND_*, IN_ESCALATION, ACCETTATA, PROCESSATA). La guardia vive
  nel **call-site** di `annullaPraticaAction`: lì lo stato precedente è già
  letto prima dell'update, quindi `notifyClientiAvanzamento(id, 'ANNULLATA')`
  viene chiamata solo se quello stato è post-submit. L'orchestratore resta
  agnostico (non ricarica lo stato precedente).
- **Broker che è anche parte** (es. dealer venditore): riceve sia la N-mail
  broker sia la client-mail. Comportamento accettato come corretto.
- **Multi-veicolo:** `veicoloDescrizione` = targa del primo veicolo + `+N`.
- **Fire-and-log:** un errore email non blocca mai la transizione di stato.

## Test

- Unit sul builder destinatari: dedup per email, filtro null/empty,
  multi-venditore, acquirente PG vs privato (nome corretto).
- Unit sul template `tplN40ClienteAvanzamento`: per ogni combinazione
  `stato` × `ruolo` il subject e il text sono valorizzati e **non** contengono
  campi commerciali (no fee/importi/nome agenzia).
- Test della guardia ANNULLATA-da-BOZZA (nessun invio).
- Verifica e2e a fine fase secondo prassi (provider console in dev mostra le
  email generate).

## File toccati

- `apps/piattaforma/src/lib/notifiche/templates.ts` — nuovo template + tipi payload
- `apps/piattaforma/src/lib/notifiche/send.ts` — union + render case + import
- `apps/piattaforma/src/lib/notifiche/cliente.ts` — **nuovo** orchestratore
- `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — trigger AVVIATA
- `apps/piattaforma/src/app/inbox/actions.ts` — trigger PRESA_IN_CARICO
- `apps/piattaforma/src/app/pratiche/actions.ts` — trigger PRONTA_FIRMA / COMPLETATA / ANNULLATA
- Test associati (collocazione secondo prassi del repo)
