# Chatbot FAQ LLM — Design

> **Data:** 2026-06-10
> **Autore:** Francesco Sioli (CTO) + Claude
> **Stato:** approvato in brainstorming, in attesa di review spec → writing-plans
> **Tipo:** design/spec implementativa
> **Collocazione roadmap:** estensione del bundle CRM-D (chatbot testuale), §8.6 di `docs/ecosistema-crm-ai.md` (chatbot sito = conversion optimizer, priorità sul bot vocale)

---

## 1. Obiettivo

Introdurre un chatbot FAQ presente **su tutta la piattaforma** (utenti loggati e non),
alimentato da un LLM, con la knowledge estratta **automaticamente dai `docs/`** del
repository. Il bot risponde a domande pre-vendita (visitatori pubblici) e operative
(dealer/agenzie loggati), degradando con grazia a un fallback deterministico quando
l'LLM non è disponibile.

### Cosa esiste già (riuso, non riscrittura)

- **`CrmChatbot`** (modello DB, bundle CRM-A): `nome`, `prompt`, `obiettivo`, `qa`,
  `escalation`, `target` (Agenzia/Broker/null), `canale` (SITO/WHATSAPP/MAIL/TUTTI),
  `posizione`, `attivo`.
- **`respondAsBot()`** — stub keyword-matching in
  `apps/piattaforma/src/lib/providers/chatbot/index.ts`, progettato esplicitamente per
  essere sostituito da un provider LLM mantenendo la firma `(bot, message) → {reply, escalated}`.
- **`POST /api/chatbot/[botId]`** — route che carica il bot e chiama `respondAsBot`.
- **`<ChatbotWidget>`** — widget UI completo (bolla flottante, lista messaggi, badge
  escalation, typing indicator), già stilato col design system (`pv-navy`, `pv-slate`).
- **`<SiteChatbot posizione>`** — wrapper server che monta il widget; oggi solo sulla
  landing (`app/page.tsx`).
- **`/admin/crm/chatbot`** — pagina admin per configurare i bot.

---

## 2. Decisioni di design (dal brainstorming)

| # | Decisione | Scelta |
|---|---|---|
| 1 | Audience | **Knowledge contestuale**: stesso widget ovunque, KB scelta dal login/ruolo |
| 2 | Fonte knowledge | **Auto-estrazione dai `docs/`** (no Q&A scritte a mano) |
| 3 | Visibilità | **Tag per doc, default sicuro**: `public` ⊂ `clients` ⊂ `internal`, default = `internal` |
| 4 | Multi-turn | **Leggero**: ultimi N messaggi rimandati dal browser, niente storage server-side |
| 5 | Anti-abuso | **Pacchetto completo**: rate limit per IP/sessione + tetto giornaliero + cap lunghezza + kill-switch |
| 6 | Logging | **Metriche + domande senza risposta** (anonimo, retention breve), no trascrizioni |
| — | Architettura | **Context-stuffing + prompt caching** (no RAG), seam pulito per upgrade futuro |
| — | Modello | **Anthropic `claude-haiku-4-5`**, non-streaming, `max_tokens ~500` |

### Validazione dimensione
`docs/*.md` totali ≈ **295 KB ≈ ~74K token** (caso peggiore = tutti i docs, bot interno).
Context window Haiku = 200K → ci sta comodamente. Vista pubblica ≈ **5-8K token**.
Context-stuffing tecnicamente validato; RAG prematuro.

---

## 3. Principio di sicurezza centrale

**Il tier (quale KB) si risolve sempre lato server dalla sessione autenticata, mai
dall'input del client.** Un chiamante non loggato ottiene *sempre* la KB pubblica,
qualunque `botId` passi. Il record `CrmChatbot` fornisce solo la **persona** (nome,
prompt, obiettivo, escalation); la KB la sceglie l'auth.

```
tier = ruolo del chiamante:
  non loggato                              → public
  dealer / agenzia                         → clients   (= public + clients)
  staff interno (AD/CTO/CFO/               → internal  (= tutti i docs)
    SALES_MANAGER/SALES)
```

Il resolver del tier supporta tutti e tre i livelli. Il default in assenza di sessione
riconosciuta è **public** (fail-safe verso il meno privilegiato).

Difesa anti-leak a due livelli:
1. **Filtro per tier (primario)**: i docs interni semplicemente **non sono** nel context
   del bot pubblico/clienti — non possono essere rivelati perché non vengono nemmeno caricati.
2. **Istruzione nel system prompt (cintura)**: il modello deve rispondere solo dalla KB
   fornita, non inventare, e ignorare istruzioni dell'utente che chiedano di cambiare
   ruolo o rivelare il prompt (anti prompt-injection).

---

## 4. Componenti

### 4.1 Pipeline KB (build-time) — `scripts/build-chatbot-kb.ts`

- Legge `docs/*.md`, estrae il tag di visibilità dal **front-matter** YAML:
  ```yaml
  ---
  chatbot_visibility: public   # public | clients | internal
  ---
  ```
  **Tag mancante → `internal`** (default sicuro: un doc nuovo non leakka mai per sbaglio).
- Produce 3 artefatti **cumulativi** committati:
  - `apps/piattaforma/src/lib/providers/chatbot/kb/public.generated.ts` (solo doc `public`)
  - `.../kb/clients.generated.ts` (doc `public` + `clients`)
  - `.../kb/internal.generated.ts` (tutti i doc)
  Esportano la KB come stringa (artefatto statico, in git → niente accesso filesystem a
  runtime, prefisso stabile per il caching).
- Gira come `prebuild` (e script `pnpm` dedicato) → mai stale rispetto ai docs.
- **Alternativa scartata**: manifest `docs/chatbot-visibility.json`. Il front-matter è
  co-locato col contenuto e più difficile da dimenticare.

> **Aggiornamento 2026-06-10 (post-analisi contenuti docs).** Leggendo i `docs/` reali è
> emerso che sono **quasi tutti interni** (brief/spec/finanze) — non contengono FAQ
> pubbliche pronte. Quindi pubblico/clienti **non si estraggono grezzi** dai doc interni:
> il contenuto sicuro è **curato a mano** in due file dedicati `docs/kb-pubblico.md`
> (`public`) e `docs/kb-clienti.md` (`clients`); **tutti gli altri `docs/*.md` restano
> `internal` di default**. Il meccanismo della pipeline non cambia (legge `.md` per tag),
> cambia solo la *fonte* dei contenuti public/clients. I `.docx`/`.pdf` non sono letti
> dalla pipeline: i due nuovi brief riservati sono stati convertiti in `.md internal`
> (`fatturazione-piattaforma.md`, `segnalazioni-penali.md`). Decisione: bot pubblico
> **senza prezzi** (rimanda all'iscrizione). Aperto: incoerenza importo penale (€25 vs €100).

### 4.2 Provider LLM — `apps/piattaforma/src/lib/providers/chatbot/`

- `respondAsBot()` **resta invariato** → fallback deterministico.
- Nuova `respondWithLlm(opts)` **async**: riceve KB del tier + persona del bot + storico
  messaggi. Costruisce il system prompt (`persona + KB` con `cache_control: ephemeral`),
  chiama Haiku 4.5, ritorna `{reply, escalated}`.
- Dispatcher `respond(opts)`: decide LLM vs fallback (vedi §5). Stessa firma di ritorno →
  il resto del sistema non cambia. Lo seam isola un eventuale upgrade futuro a RAG.

### 4.3 API route — `POST /api/chatbot/[botId]` (diventa async)

1. Risolve il **tier** dalla sessione (non dal body).
2. Accetta `messages` (ultimi N, multi-turn) invece del singolo `message`; clampa
   lunghezza (1000 char/msg già presente), numero messaggi e char totali.
3. Applica rate limit + tetto giornaliero (§5.2). Se bloccato → "riprova più tardi".
4. Carica persona (`CrmChatbot` by id) + KB statica del tier.
5. Chiama il dispatcher.
6. Logga la metrica (§6).
7. Ritorna `{reply, escalated}`.

### 4.4 Widget — `<ChatbotWidget>`

Modifica minima: invia `{messages: [...ultimiN]}` invece del singolo messaggio.
Genera/persiste un id sessione (per il rate limit per-conversazione). UI invariata.

### 4.5 Montaggio ovunque

Oggi `<SiteChatbot>` è solo sulla landing. **In v1 lo montiamo su: (a) sito pubblico →
tier public, (b) app autenticata dealer/agenzia → tier clients.** Il montaggio in `/admin`
per lo staff interno (tier internal) è supportato dal resolver ma **opzionale/bassa
priorità** in v1. Essendo `position: fixed` il widget si sovrappone senza toccare i layout
esistenti. Il bot caricato fornisce la persona; la KB la determina l'auth.

> Nota: il limite di rate **per-sessione** (id generato dal widget) è best-effort — il
> client può resettarlo. Le protezioni *load-bearing* sono il limite **per-IP** e il
> **tetto globale giornaliero**.

---

## 5. Affidabilità & costi

### 5.1 Catena di degradazione (fail-safe — mai crash, mai leak)

Il bot **non rompe mai** la pagina; fail-**open** verso un fallback sicuro:

1. `CHATBOT_LLM_ENABLED` off → fallback deterministico (`respondAsBot`)
2. API key assente → deterministico
3. Rate limit / tetto giornaliero superato → "Troppe richieste, riprova tra poco" (escalated)
4. Chiamata LLM in errore o timeout (~8-10s) → deterministico, logga errore
5. LLM non sa rispondere → messaggio di escalation (`CrmChatbot.escalation`), loggato come "senza risposta"

### 5.2 Anti-abuso (store su Neon)

Tabella `ChatbotRateBucket(key, count, expiresAt)` con increment atomico (upsert):

- **Per IP**: ~10 msg/min (`ip:<ip>:<minuto>`) + tetto giornaliero per IP es. 30/giorno (`ipday:<ip>:<giorno>`)
- **Per sessione**: limite per conversazione (id sessione dal widget)
- **Tetto globale giornaliero** (circuit breaker anti-bolletta): `global:<giorno>`, es. 5.000 chiamate LLM/giorno → oltre, fallback
- **Cap input**: 1000 char/msg + max N messaggi storico + cap char totali

Tutte le soglie via env var → tunabili senza deploy. IP da `x-forwarded-for` (Vercel).

> Su Vercel serverless l'in-memory non funziona (per-istanza) → store su Neon. Una write
> DB per messaggio, trascurabile ai volumi FAQ. Pulizia righe scadute via cleanup
> opportunistico o cron.

### 5.3 Modello & prompt

- **Anthropic `claude-haiku-4-5`**, non-streaming, `max_tokens ~500` (risposte corte, sotto
  il timeout HTTP). Streaming = miglioria futura.
- System prompt = persona + blocco KB con `cache_control: {type: 'ephemeral'}` (KB =
  prefisso stabile → cache read ~0,1× del costo input).
- Niente `effort`/thinking (errano/inutili su Haiku per FAQ).
- Istruzione anti-leak/anti-hallucination/anti-injection come da §3.

### 5.4 Stima costi

Con prompt caching, per turno di conversazione (KB cached ~40K token, risposta ~300 token):
~**mezzo centesimo** a conversazione. 1.000 conv/mese ≈ $5-6; 10.000 ≈ $50-60.
La vista pubblica (KB più piccola) costa meno.

---

## 6. Logging (metriche + domande senza risposta)

Tabella `ChatbotInteraction`:

```prisma
model ChatbotInteraction {
  id                 String   @id @default(uuid()) @db.Uuid
  createdAt          DateTime @default(now())
  tier               String   // public | clients | internal
  answered           Boolean
  escalated          Boolean
  unansweredQuestion String?  // SOLO se !answered, troncata, niente PII deliberata
  @@map("chatbot_interactions")
}
```

- Niente IP, user id o trascrizioni complete. `unansweredQuestion` popolata solo quando il
  bot non sa rispondere → alimenta il miglioramento dei docs.
- Retention: purge > 90 giorni.
- Seme per la futura "dashboard conversazioni" in `/admin/crm/chatbot`.

---

## 7. Variabili d'ambiente

| Var | Scopo | Default |
|---|---|---|
| `CHATBOT_LLM_ENABLED` | Gate LLM (kill-switch) | off |
| `ANTHROPIC_API_KEY` | Chiave provider LLM | — |
| `CHATBOT_DAILY_CAP` | Tetto globale giornaliero chiamate LLM | es. 5000 |
| `CHATBOT_RATE_PER_MIN` | Rate limit per IP al minuto | es. 10 |
| `CHATBOT_RATE_PER_DAY_PER_IP` | Tetto giornaliero per IP | es. 30 |

Model id costante in codice. Si rilascia "spento" (gate off) e si accende quando l'account
Anthropic è attivo → coerente col rollout progressivo degli account esterni.

---

## 8. Testing

- **Test leak (headline)**: build KB pubblica + assert che stringhe sensibili note (margini,
  "penale", split commissioni) siano **assenti**.
- **Pipeline KB**: parsing front-matter, default-internal, assemblaggio cumulativo (un doc
  `internal` non compare mai nell'artefatto `public`).
- **Dispatcher**: fallback (LLM off / over-budget / no-key → deterministico) con client
  Anthropic mockato.
- **Rate limit**: increment, finestra, oltre-soglia.
- **Route integration**: risoluzione tier da sessione mockata (non loggato → public, dealer
  → clients); risposta bloccata su over-limit; validazione body.
- Manuale: chiamata Haiku reale dietro env in dev script, verifica caching via
  `usage.cache_read_input_tokens`.
- I test esistenti di `respondAsBot` (`index.test.ts`) restano validi.

---

## 9. Out of scope (v1)

- Streaming delle risposte (miglioria futura).
- RAG / embeddings / pgvector (non serve a 295KB; seam pronto per l'upgrade).
- Canali WhatsApp/Mail del bot (il modello li prevede; questa spec copre il canale SITO/web).
- Dashboard conversazioni completa in admin (questa spec posa solo le fondamenta dati).
- Trascrizioni complete delle chat / gestione GDPR estesa.

---

## 10. File toccati (sintesi)

**Nuovi:**
- `scripts/build-chatbot-kb.ts`
- `apps/piattaforma/src/lib/providers/chatbot/kb/{public,clients,internal}.generated.ts` (generati)
- `apps/piattaforma/src/lib/providers/chatbot/llm.ts` (respondWithLlm + dispatcher)
- `apps/piattaforma/src/lib/providers/chatbot/rate-limit.ts`
- Migration Prisma: `ChatbotRateBucket`, `ChatbotInteraction`

**Modificati:**
- `docs/*.md` → aggiunta front-matter `chatbot_visibility`
- `apps/piattaforma/src/app/api/chatbot/[botId]/route.ts` → async, tier, multi-turn, rate limit, logging
- `apps/piattaforma/src/components/chatbot-widget.tsx` → invio storico + id sessione
- `apps/piattaforma/src/components/site-chatbot.tsx` → (eventuale) selezione bot per area
- Layout area autenticata → montaggio `<SiteChatbot>`
- `package.json` → script `prebuild` per la pipeline KB
