# Passaggio Veloce — Architettura CRM operativo

> Versione markdown del documento `PassaggioVeloce CRM Architettura.docx` (Aprile 2026).
> Questo documento descrive il **CRM vendite/marketing** (esterno alla piattaforma),
> non l'Admin Panel interno (vedi Fase 9 del `piano-implementazione.md`).

---

## 1. Scopo

Il CRM è il **sistema nervoso commerciale** di Passaggio Veloce. Non è un archivio
contatti passivo: è un sistema vivo, aggiornato in tempo reale, collegato a:

- **Bot AI vocale** (Vapi.ai) per chiamate outbound automatiche
- **Pixel di tracking** su link, mail e video tutorial
- **Piattaforma Passaggio Veloce** (webhook bidirezionali su signup / eventi chiave)
- **SMS e mail automatiche** con trigger stato-based
- **Team sales** che riceve contesto completo prima di ogni contatto umano

---

## 2. Tipologie di contatto

Due profili con logiche parzialmente diverse:

| Dimensione | Agenzia pratiche auto | Broker / Commerciante |
|---|---|---|
| Ruolo | Riceve pratiche, le completa, viene pagata | Carica pratiche, paga fee, riceve servizio |
| Obiettivo | Iscriversi come fornitrice | Iscriversi come cliente |
| Messaggio chiave | Più pratiche in entrata, già documentate, zero rimbalzi | Risparmio tempo, prezzo standard, zero burocrazia |
| KPI post-iscrizione | Pratiche accettate/completate mensili | Pratiche caricate mensili + tasso completamento |
| Trigger specifici | Onboarding tecnico piattaforma, verifica profilo | Prima pratica guidata, feedback post-completamento |

---

## 3. Struttura dati (campi per contatto)

### 3.1 Anagrafica base

| Campo | Tipo | Note |
|---|---|---|
| Nome / Ragione sociale * | Testo | — |
| Tipo contatto * | Enum | Agenzia / Broker |
| Provincia * | Enum | Venete espandibili |
| Città | Testo | — |
| Telefono primario * | Numero | Da cui/a cui è stato contattato |
| Telefono WhatsApp | Numero | Può divergere — raccolto dal bot |
| Email * | Email | Spelling e conferma verbale |
| Partita IVA | Testo | Opzionale in prospect, obbligatoria all'iscrizione |
| Sito web | URL | Se disponibile |
| Fonte acquisizione | Enum | CSV iniziale / Iscrizione diretta / Referral / Altro |

### 3.2 Stato funnel

| Campo | Tipo | Note |
|---|---|---|
| Stato attuale * | Enum `S0`–`S10` | Aggiornato da bot e automazioni |
| Data primo contatto | Timestamp | Automatico |
| Data ultimo contatto * | Timestamp | Aggiornato ad ogni interazione |
| Canale ultimo contatto | Enum | Chiamata AI / SMS / Mail / Sales umano / Iscrizione diretta |
| Data prossimo contatto | Timestamp | Impostato da trigger |
| Assegnato a sales | Testo | Sales umano responsabile |
| Priorità | Enum | Alta / Media / Bassa |

### 3.3 Tracking chiamate

| Campo | Tipo | Note |
|---|---|---|
| Numero totale chiamate | Intero | Contatore |
| Esito ultima chiamata | Enum | Non risponde / Non interessato / Interessato / Richiama / Iscritto |
| Obiezioni sollevate | Array tag | Dubbio prezzo, vuole video, ha già agenzia, richiama fra X, ecc. |
| Note chiamata (riassunto AI) | Testo | 3-5 righe generate dall'LLM post-chiamata |
| Trascrizione completa | Testo | Archiviata per ogni chiamata con timestamp |
| Sentiment | Enum | Positivo / Neutro / Negativo |

### 3.4 Tracking comportamentale (pixel)

| Campo | Tipo | Sorgente |
|---|---|---|
| Link iscrizione inviato | Bool + ts | Automatico post-chiamata interessato |
| Link iscrizione aperto | Bool + ts | Pixel sul link personalizzato |
| Numero aperture link | Intero | — |
| Video tutorial inviato | Bool + ts | — |
| Video aperto | Bool + ts | Webhook video host |
| Minuti video visti | Intero | Minuto per minuto |
| % video vista | % | Calcolata |
| Iscrizione iniziata | Bool + ts | Evento piattaforma |
| Iscrizione completata | Bool + ts | Evento piattaforma |
| Mail apertura | Bool + ts | Pixel mail (Lemlist/Customer.io) |

### 3.5 Dati post-iscrizione (operativi)

| Campo | Tipo | Note |
|---|---|---|
| ID utente piattaforma | Stringa univoca | **Chiave di matching** CRM ↔ piattaforma |
| Data iscrizione | Timestamp | — |
| Prima pratica caricata/ricevuta | Bool + data | — |
| Numero pratiche totali | Intero | Aggiornato dalla piattaforma |
| Volume pratiche ultimo mese | Intero | — |
| Ultimo accesso piattaforma | Timestamp | — |
| Tasso completamento pratiche | % | Solo agenzie |
| Status account | Enum | Attivo / Inattivo / Sospeso |

---

## 4. Matching dati CRM ↔ Piattaforma

### Caso A — Contatto già nel CRM si iscrive
1. La piattaforma invia webhook POST al CRM/Make con email + telefono dell'iscrizione.
2. Make cerca record con email o telefono corrispondente.
3. Se trovato: aggiorna profilo con `platformUserId`, data iscrizione, stato → `S7`.
4. Trigger onboarding attivati (mail guida, chiamata attivazione +7gg).

### Caso B — Nuovo iscritto non presente
1. Webhook con tutti i dati dell'iscrizione.
2. Make crea nuovo record, fonte = `Iscrizione diretta`, stato = `S7`.
3. Trigger onboarding standard.

### Chiavi di matching (ordine di priorità)
1. **Email** (chiave primaria, univoca)
2. **Telefono** (chiave secondaria)
3. **P.IVA** (chiave terziaria, deduplicazione)

In caso di conflitto → alert manuale al sales.

---

## 5. Integrazione bot AI

### 5.1 Prima della chiamata — lettura dal CRM
- Stato attuale (S0–S10)
- Esiti e note chiamate precedenti
- Obiezioni storiche
- Tracking comportamentale (link aperto? video visto? iscrizione iniziata?)
- Nome, tipo, provincia (per personalizzare apertura)

→ Il bot adatta lo script dinamicamente: un contatto al primo approccio riceve
un copione diverso da uno che ha già aperto il link 3 volte senza iscriversi.

### 5.2 Durante la chiamata — raccolta dati
- Email con spelling fonetico + conferma verbale
- WhatsApp alternativo (campo separato)
- Obiezioni taggate in tempo reale
- Preferenze (orario migliore, volume pratiche attuale)

### 5.3 Dopo la chiamata — scrittura su CRM
- Aggiornamento stato (S0 → S3 se interessato)
- Riassunto LLM (3-5 righe)
- Trascrizione completa archiviata
- Array obiezioni aggiornato
- Sentiment
- Prossimo contatto pianificato (se concordato)
- Trigger attivati (SMS + mail)

---

## 6. Automazioni (Make / n8n)

| Evento | Stato | Ritardo | Azione |
|---|---|---|---|
| Fine chiamata positiva | S0/S1 → S3 | < 5 min | SMS + mail con link tracciato + video |
| Link non aperto | S4 | 24h | SMS reminder |
| Link non aperto | S4 | 48h | Chiamata AI con menzione del link |
| Link non aperto | S4 | 7gg | SMS finale — chiusura ciclo |
| Link aperto / non iscritto | S5 | 48h | Chiamata AI con script pixel-aware |
| Iscrizione iniziata / non completata | S6 | 2h | SMS supporto tecnico |
| Iscrizione iniziata / non completata | S6 | 24h | Chiamata AI supporto |
| Iscrizione completata | S7 | Immediato | Mail benvenuto + onboarding |
| Iscritto inattivo | S7 | 3gg | Mail guida prima pratica |
| Iscritto inattivo | S7 | 7gg | Chiamata AI attivazione |
| Prima pratica completata | S7 → S8 | Immediato | Mail celebrativa + consigli |
| Prima pratica completata | S8 | 7gg | Chiamata AI feedback |
| Inattività operativa | S9 → S10 | 30gg senza pratiche | Mail re-engagement |
| Inattività operativa | S10 | 45gg | Chiamata AI riattivazione |
| Non interessato | S2 | 60gg | Chiamata AI con aggiornamento piattaforma |

---

## 7. Flusso "nuovo iscritto non in CRM"

| # | Step | Dettaglio |
|---|---|---|
| 1 | Evento iscrizione | Piattaforma → webhook POST → endpoint CRM (o Make) |
| 2 | Payload | `{email, telefono, nome, tipo, piva, provincia, platformUserId}` |
| 3 | Match lookup | Make cerca record per email → telefono → P.IVA |
| 4a | Match | Aggiorna record: stato → S7 + platformUserId + data iscrizione |
| 4b | No match | Crea nuovo record, fonte = Iscrizione diretta, stato = S7 |
| 5 | Trigger | Sequenza onboarding: mail + chiamata AI a 7gg |
| 6 | Notifica | Alert sales: nuovo iscritto da qualificare |

---

## 8. Stack consigliato

| Funzione | Tool | Note |
|---|---|---|
| CRM core | **HubSpot** (free/starter) o **Airtable** | HubSpot = automazioni native, API robusta, pipeline visuali. Airtable = più flessibile custom. |
| Orchestratore | **Make** (ex Integromat) | Connette CRM, bot AI, mail, SMS, piattaforma |
| Bot AI voce | **Vapi.ai** | Function calling nativo per R/W CRM real-time in chiamata |
| Mail tracking | **Lemlist** | Pixel apertura, click, sequenze, integrazione Make |
| Video tracking | **Wistia** | Webhook per minuto visto |
| SMS outbound | **Twilio** | Numeri italiani |
| VoIP chiamate | **Twilio** | Stesso provider, più numeri in parallelo |

---

## 9. Roadmap implementazione CRM (3-4 settimane)

### Fase CRM-1 — Setup CRM (settimana 1)
- Scelta tra HubSpot e Airtable (decisione CTO)
- Creazione campi custom di §3
- Import prospect esistenti (~600 contatti Veneto)
- Configurazione pipeline S0–S10

### Fase CRM-2 — Integrazione piattaforma (settimana 1-2)
- Webhook piattaforma → Make per ogni evento chiave
- Logica di matching email → telefono → P.IVA
- Test Caso A e Caso B su utenti di test

### Fase CRM-3 — Bot AI + tracking (settimana 2-3)
- Vapi.ai function calling verso CRM
- Pixel su link iscrizione (UTM univoci per contatto)
- Webhook Wistia
- Implementazione trigger su Make

### Fase CRM-4 — Test & go-live (settimana 3-4)
- Test end-to-end su campione 20-30 contatti
- Verifica trascrizioni + qualità riassunti AI
- Verifica matching
- Go-live database completo

---

## 10. Cosa deve fare la piattaforma (impatto su codebase)

La piattaforma Passaggio Veloce è **fornitore di eventi** per il CRM esterno.
Non ospita il CRM stesso: deve solo emettere webhook e accettare query API.

### 10.1 Webhook in uscita da emettere

| Evento piattaforma | Endpoint Make | Payload |
|---|---|---|
| `user.signup.started` | POST `/crm/signup-started` | `{utmContactId?, email, tipo, ts}` |
| `user.signup.completed` | POST `/crm/signup-completed` | `{platformUserId, email, telefono, nome, tipo, piva, provincia, ts}` |
| `pratica.first.created` (broker) | POST `/crm/first-practice` | `{platformUserId, praticaId, ts}` |
| `pratica.first.accepted` (agenzia) | POST `/crm/first-accepted` | `{platformUserId, praticaId, ts}` |
| `pratica.completed` | POST `/crm/practice-completed` | `{platformUserId, praticaId, ruolo, ts}` |
| `user.inactive.30d` | POST `/crm/user-inactive` | `{platformUserId, ultimoAccesso, ts}` |

Firma: HMAC-SHA256 con shared secret nell'header `X-PV-Signature`, idempotency-key per
retry sicuri. Retry con backoff esponenziale se Make risponde non-2xx.

### 10.2 Endpoint API read-only da esporre per Make

- `GET /api/crm/user/{platformUserId}/state` → stato account, ultimo accesso, volume
  pratiche ultimo mese, tasso completamento (per agenzie), praticheTotali.
- Protezione: API key + IP allowlist Make.

### 10.3 UTM capture su signup

- Homepage e `/register` devono accettare parametri `?utm_source=crm&utm_contact={id}&utm_medium=...`
- `utm_contact` salvato su `User.crmContactId` (nullable) all'iscrizione e rimandato
  indietro nel webhook `signup.completed` → permette matching deterministico.

### 10.4 Impatti schema DB (incrementali)

```prisma
model User {
  // ...campi esistenti...
  crmContactId       String?   @unique  // da UTM, nullable
  crmSyncedAt        DateTime?          // ultimo sync verso CRM
}

model CrmOutboundEvent {          // outbox pattern per webhook affidabili
  id              String   @id @default(cuid())
  eventType       String
  payload         Json
  userId          String?
  status          String   // pending | sent | failed
  attempts        Int      @default(0)
  lastAttemptAt   DateTime?
  lastError       String?
  createdAt       DateTime @default(now())
  @@index([status, createdAt])
}
```

---

## 11. Riferimenti

- Documento originale: `docs/PassaggioVeloce CRM Architettura.docx`
- Briefing tecnico bot vocale: documento separato (da integrare)
- Testi SMS/mail/script per stato: documento complementare (da integrare)
