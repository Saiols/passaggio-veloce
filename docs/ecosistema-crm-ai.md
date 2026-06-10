# Passaggio Veloce — Ecosistema CRM + AI (Paper Operativo)

> **Fonte:** `PassaggioVeloce Ecosistema Paper v2.docx` (Aprile 2026)
> **Tipo documento:** paper operativo — complementare a `crm-architettura.md`
> **Relazione con `crm-architettura.md`:** questo documento descrive il **paper operativo**
> (funzionamento del bot, invio multi-canale, pagine CRM, chatbot). Il file
> `crm-architettura.md` descrive l'**integrazione tecnica** (webhook, schema, matching).
> **Collocazione roadmap:** estensioni alla FASE 10 del `piano-implementazione.md`

---

## 1. Visione

Passaggio Veloce è un ecosistema commerciale con **4 componenti interconnesse**:

1. **AI Sales Agent** (chiamate vocali outbound — Vapi.ai)
2. **CRM Operativo** (3 pagine: Contatti / Sales / Chatbot)
3. **Tracking + Piattaforma** (pixel, webhook bidirezionali)
4. **Chatbot testuale** (sito, WhatsApp inbound, mail)

Ogni evento in un componente genera reazioni automatiche negli altri. Il **CRM è il
sistema nervoso centrale** — lettura pre-azione e scrittura post-azione per ogni
componente.

---

## 2. AI Sales Agent — chiamate outbound

### 2.1 Funzionamento base

- **50+ chiamate simultanee** su numeri VoIP dedicati (Twilio)
- **Script dinamico**: il bot legge lo stato CRM prima di chiamare e adatta il messaggio
- **Gestione obiezioni**: database Q&A con minimo 80–100 voci
- **Multi-sales**: più agenti con voci/accenti/lingue diverse, selezionabili per campagna
- **Dashboard live**: chiamate effettuate, tasso risposta per giorno/ora, blacklist auto

### 2.2 Function Calling — raccolta dati in tempo reale

Vapi.ai supporta function calling nativo: durante la conversazione vocale, il bot può
invocare API esterne **in tempo reale senza interrompere il dialogo**. È il meccanismo
che risolve il problema del numero fisso senza mail né WhatsApp.

**Scenario email in chiamata:**
1. Bot: "Ha una mail su cui inviarle il link di iscrizione?"
2. Utente: spelling verbale (es. "marco punto rossi chiocciola gmail punto com")
3. Bot: riconosce l'email e la **ripete ad alta voce** per conferma
4. **Function call istantanea** → scrive `email` nel profilo CRM
5. Make rileva il nuovo campo → fa partire la mail con link tracciato

**Scenario WhatsApp in chiamata:**
1. Bot: "Ha un numero WhatsApp su cui preferisce ricevere il link?"
2. Utente: fornisce numero (può essere diverso dal fisso chiamato)
3. Bot: ripete per conferma verbale
4. **Function call istantanea** → scrive `telefono_whatsapp` nel CRM
5. Make rileva il nuovo campo → parte messaggio WhatsApp

Tutto in 2–3 secondi, senza intervento umano. **Questo è il motivo per cui Vapi è
consigliato rispetto ad alternative che richiedono aggiornamento manuale.**

---

## 3. Invio automatico post-chiamata (multi-canale)

Al termine di ogni chiamata con esito positivo (transizione `S0/S1 → S3`), il sistema
invia automaticamente il link di iscrizione su **tutti i canali disponibili**:

| Canale | Quando parte | Testo | Note |
|---|---|---|---|
| SMS | Sempre — numero fisso o mobile | "Ciao, ecco il link per iscriverti gratuitamente a Passaggio Veloce: [link]" | Tentativo anche su fisso. Basso costo, vale sempre provare |
| WhatsApp | Se numero WA confermato in chiamata | "Ciao, come anticipato, ecco il link: [link]. Il processo dura 2 minuti. Rispondimi qui per domande!" | Numero raccolto via function calling |
| Email | Se mail disponibile (CSV o raccolta in chiamata) | "Oggetto: Il tuo link per Passaggio Veloce — [link] + video tutorial" | Contiene pixel tracking apertura, click, visione video |

**Fallback senza recapito digitale:** se il contatto ha fornito solo il fisso (no mail
né WhatsApp), resta in **S3** e viene **richiamato dopo 48h** con uno script che riprova
esplicitamente a raccogliere un recapito digitale.

---

## 4. Le 3 pagine del CRM

### 4.1 Pagina Contatti

Lista principale ordinata per Regione con filtri rapidi. Ogni riga = un contatto, ogni
contatto ha una scheda dettagliata.

- **Filtri:** regione, provincia, tipologia (agenzia/broker), stato S0–S10, tag, sales
  assegnato, data ultimo contatto
- **Scheda contatto:** campi anagrafici + storico chiamate + note AI + trascrizioni +
  tracking pixel (vedi `crm-architettura.md` §3)
- **Aggiornamento automatico** da bot AI (function calling) e piattaforma (webhook)
- **Aggiunta/modifica manuale** sempre disponibile per casi edge

### 4.2 Pagina Sales

Configurazione e controllo degli agenti AI e delle campagne di chiamata.

**Configurazione Sales Agent:**
- Nome e identità dell'agente
- Voce / accento / lingua (clonata o da libreria ElevenLabs)
- Prompt base (chi è, cosa fa, obiettivo)
- Script per fase (primo contatto / follow-up / ricontatto dopo X giorni)
- Database Q&A gestione obiezioni (agenzie e broker **separati**)
- Comportamento post-chiamata (cosa invia, su quali canali, con quali testi)

**Creazione Campagna:**

| Parametro | Descrizione |
|---|---|
| Selezione contatti | Filtro per tag: regione, tipologia, stato CRM, non risponde, ecc. |
| Sales agent | Quale agente AI conduce le chiamate (più agenti su campagne diverse) |
| Max tentativi/giorno | Es. 3 tentativi/giorno per contatto con intervallo minimo 60 min |
| Orari consentiti | Es. 9:00–12:00 e 15:00–18:00 — l'AI non chiama fuori da questi orari |
| Giorni attivi | Giorni della settimana in cui la campagna è operativa |
| Comportamento se non risponde | Richiama mattina → se no → pomeriggio → pausa 24h |
| Comportamento se risponde | Campagna si interrompe sul contatto, aggiorna CRM, invia link |
| Chiusura automatica | Quando tutti i contatti hanno risposto o raggiunto max tentativi |
| Blacklist automatica | Chi dice stop viene escluso per sempre |

### 4.3 Pagina Chatbot

Configurazione e gestione dei **bot testuali**. Il chatbot è separato dal Sales Agent
vocale ma alimentato dagli stessi dati CRM.

- **Creazione/configurazione bot:** prompt, tono, obiettivo, Q&A specifiche per agenzie
  e broker
- **Multi-bot:** versioni diverse per sito / WhatsApp / assistenza post-iscrizione —
  ciascuna configurabile
- **Chat live sul sito:** icona sempre visibile, risponde durante navigazione e wizard
- **WhatsApp:** risponde ai messaggi in entrata dopo invio link dal Sales Agent
- **Mail automatica:** risponde a mail in entrata con risposte preimpostate
- **Dashboard conversazioni:** storico chat, domande più frequenti, escalation a umano

**Differenza chiave Sales Agent vs Chatbot:** Sales Agent fa **chiamate outbound** (è lui
che chiama). Chatbot risponde a **conversazioni inbound** (è l'utente che scrive).
Tecnicamente sono sistemi distinti ma si coordinano tramite CRM.

---

## 5. Stati CRM S0–S10 e trigger

| Stato | Descrizione | Trigger | Azione automatica |
|---|---|---|---|
| S0 | Non contattato | Avvio campagna | Chiamata AI outbound |
| S1 | Non risponde | 24h / 48h / 72h | Richiamata orario diverso; SMS neutro a 72h |
| S2 | Non interessato | 60 giorni | Ricontatto con aggiornamento piattaforma |
| S3 | Interessato | Fine chiamata < 5 min | SMS + WhatsApp + Mail con link tracciato + video |
| S4 | Link non aperto | 24h / 48h / 7gg | SMS reminder, chiamata AI, SMS finale |
| S5 | Link aperto / non iscritto | 48h | Chiamata AI pixel-aware |
| S6 | Iscrizione incompleta | 2h / 24h | SMS tecnico + Chatbot supporto + chiamata AI |
| S7 | Iscritto / non attivo | 3gg / 7gg | Mail guida + chiamata AI attivazione |
| S8 | Prima pratica | Immediato / 7gg | Mail celebrativa + chiamata feedback |
| S9 | Attivo ricorrente | Mensile / trimestrale | Report automatico + account review call |
| S10 | Churned | 30gg / 45gg / 60gg | Mail + chiamata AI + offerta riattivazione |

---

## 6. Stack tecnologico completo

| Funzione | Tool | Note |
|---|---|---|
| Sales Agent (voce) | Vapi.ai | Function calling nativo R/W CRM real-time |
| Function Calling | Vapi + API CRM | Raccolta email/WA in chiamata |
| TTS (voce AI) | ElevenLabs | Voice cloning, supporto italiano |
| STT (trascrizione) | Deepgram | Alta accuratezza in italiano, bassa latenza |
| CRM | HubSpot / Custom | 3 pagine: Contatti, Sales, Chatbot |
| Orchestratore | Make (Integromat) | Connette tutti i sistemi, gestisce trigger |
| SMS + VoIP | Twilio | Numeri italiani dedicati, SMS su fisso e mobile |
| Mail tracking | Lemlist | Pixel apertura, tracking click, sequenze |
| Video tracking | Wistia | Webhook per minuto visto |
| Chatbot WhatsApp/sito | Manychat / WATI | API WhatsApp Business ufficiale |

---

## 7. Roadmap implementazione (derivata dal doc)

**Fase 1 — CRM Setup**
- Scegliere architettura CRM (HubSpot o custom)
- Creare le 3 pagine: Contatti, Sales, Chatbot
- Importare i 584 contatti CSV Veneto già disponibili
- Configurare stati S0–S10 + campi custom

**Fase 2 — Integrazioni**
- Connettere Vapi.ai al CRM tramite function calling (R pre-chiamata + W post)
- Configurare invio multi-canale SMS/WhatsApp/Mail post-chiamata via Make
- Configurare webhook piattaforma → Make per ogni nuova iscrizione
- Logica matching CRM ↔ Piattaforma (email → tel → P.IVA)
- Pixel tracking su link iscrizione + webhook Wistia

**Fase 3 — Test e go-live**
- Test end-to-end su campione 20–30 contatti
- Verifica function calling (raccolta email/WA in chiamata)
- Verifica invio multi-canale post-chiamata
- Verifica matching dati CRM ↔ Piattaforma
- Go-live database completo Veneto

---

## 8. Osservazioni CTO — rischi, gap, proposte

> Questa sezione **non è nel .docx originale**: raccoglie il review CTO sul paper v2
> per allineamento con Alberto / Andrea / legal / budget owner.

### 8.1 Qualità italiano del bot — test obbligatorio prima del go-live

ElevenLabs + Deepgram funzionano in italiano, ma l'accento regionale veneto/lombardo
della base prospect può generare errori STT, **soprattutto nello spelling verbale
di email**. Una singola lettera sbagliata = link che non arriva = conversione persa.

**Proposta:** benchmark dedicato con 30–50 chiamate reali registrate prima del go-live,
misurando tasso di riconoscimento spelling (target ≥95%). Se <90%, valutare fallback
"le mandiamo un SMS con link dove inserire la mail" invece di raccoglierla in chiamata.

### 8.2 GDPR + Garante Privacy — chiamate AI outbound

Chiamare 584 prospect con bot AI è trattamento di dati personali + registrazione
audio. Rischi reali:

- **Basi giuridiche:** legittimo interesse va documentato + registro trattamenti aggiornato
- **Informativa verbale:** il bot deve identificarsi come AI nelle prime 10 parole (best practice post-sentenze Garante 2024–2025)
- **Registrazione:** consenso esplicito all'inizio o, se declinato, la chiamata prosegue senza registrazione
- **Opt-out facile:** "dire stop" deve funzionare → blacklist immediata + conferma scritta
- **Numero veneto in liste opt-out (Registro Pubblico Opposizioni):** check obbligatorio prima di chiamare

**Dipendenza:** coordinamento con il DPO/legal prima del go-live.

### 8.3 Costi Vapi — budget da validare

Stima realistica su 584 contatti × 3 tentativi medi × 3 min chiamata = ~1750 chiamate × 3 min = ~88 ore di chiamata/campagna.

Costi per minuto (listino 2026):
- Vapi ~$0.05 + ElevenLabs ~$0.08 + Deepgram ~$0.01 + Twilio ~$0.025 = **~$0.165/min**
- 88 ore × 60 × $0.165 = **~$870 per campagna completa** (solo costi bot, esclusa piattaforma Make/HubSpot/Lemlist)

Con campagna mensile + re-engagement S2/S10: **~€1.000–1.500/mese in infrastruttura AI**.

**Proposta:** budget dedicato + soft cap su tentativi/contatto. Monitoraggio cost/lead attivo dal primo giorno.

### 8.4 Function calling latency — risk concreto

Il bot deve chiamare API CRM durante la conversazione. Latency totale >2s rompe il flow conversazionale. HubSpot API può avere risposte 800–1200ms sotto carico.

**Proposta:** layer proxy serverless (Cloudflare Worker / Vercel Edge Function) tra
Vapi e CRM che:
- fa scritture async (fire-and-forget) al CRM e risponde subito al bot
- ha retry locale in caso di timeout CRM
- cachea le letture pre-chiamata (ridotto a una singola chiamata API per gestione stato)

Oppure scrivere su Airtable (latency tipica 200–400ms) se la scelta cade lì.

### 8.5 Chatbot WhatsApp Business — compliance Meta

La policy Meta per WhatsApp Business ha limiti forti:

- **Outbound a freddo vietato** (solo messaggi da template pre-approvati, processo lungo)
- **Finestra di conversazione 24h** dopo messaggio inbound del cliente — oltre serve template
- **Costo per conversazione** con tariffazione per paese (IT ~€0.04–0.06/messaggio)
- **Numero business verified** obbligatorio (tempo di verifica ~1–2 settimane)

**Proposta:** il chatbot WA **risponde solo inbound** (fino a 24h). Outbound post-chiamata AI **non usa chatbot** ma invio diretto tramite Twilio/WATI con template approvato.

### 8.6 Chatbot sito prima del bot vocale — rovesciare le priorità

Chi visita passaggioveloce.it ha **già interesse attivo** (search intent). Un chatbot
testuale che risponde alle domande in wizard (documenti accettati, costi, tempi) ha
ROI significativamente più alto di una chiamata a freddo.

Il bot vocale è un **amplificatore**, il chatbot sito è un **conversion optimizer**. Implementazione del chatbot sito è anche più rapida (no TTS/STT, no function calling critico, no compliance telefonica).

**Proposta:** Fase 1 = chatbot sito → Fase 2 = bot vocale outbound → Fase 3 = chatbot WA inbound.

### 8.7 Database Q&A — sforzo da quantificare

"Minimo 80–100 voci obiezioni" è un lavoro di copywriting da 2–3 settimane dedicate
(ricerca obiezioni reali da sales già parlanti con agenzie, varianti risposta, tone of voice). Il doc menziona "Sales + marketing" come owner, ma senza un owner dedicato questa attività slitta all'infinito.

**Proposta:** raccolta obiezioni reali tramite 20–30 chiamate sales umane di briefing **prima** di addestrare il bot. Poi 2 settimane con un copywriter per scrivere il DB Q&A.

### 8.8 Paternità lead — affiliazione vs CRM vs outbound

Con il sistema di affiliazione (vedi `sistema-affiliazione.md`) un lead può arrivare
da: (a) CRM outbound, (b) link referral di un utente attivo, (c) ricerca organica. Se
un lead è già stato toccato dal bot AI (stato S3) e poi arriva via link affiliazione,
chi ha la paternità?

**Proposta:** tie-breaker esplicito nelle regole attribuzione:
1. Se stato CRM ≥ S3 → paternità CRM/sales (niente commissione referral)
2. Se stato CRM ∈ {S0, S1, S2} → paternità referrer
3. Se contatto non esiste in CRM → paternità referrer, creazione nuovo record

Da formalizzare insieme alla policy pixel della §4 del doc affiliazione.

### 8.9 Sezione §5 e §6 del .docx

Nel `.docx` v2 le sezioni "5. Stati CRM S0-S10 e trigger" e "6. Stack tecnologico
completo" hanno solo il titolo + tabella (nessun testo narrativo). Non è un gap
informativo perché le tabelle sono self-contained, ma va segnalato se il doc deve
essere condiviso con stakeholder esterni.

### 8.10 Sinergia con affiliazione — unify inbound tracking

Il sistema affiliazione (landing `/r/:token`) e il sistema CRM (landing con UTM)
devono condividere la stessa infrastruttura di tracking client-side. Altrimenti si
duplica codice/pixel/attribution. Integrazione proposta: unico endpoint
`/api/track/visit` che accetta sia token affiliazione sia utm_contact, e scrive
nella stessa tabella `TrackingVisit` con source distintivo.

---

## 9. Riferimenti e documenti collegati

- `docs/crm-architettura.md` — integrazione tecnica CRM ↔ piattaforma (schema, webhook, matching)
- `docs/sistema-affiliazione.md` — programma affiliazione (paternità lead §8.8)
- `docs/piano-implementazione.md` — FASE 10 estesa con sotto-sezioni di questo paper
