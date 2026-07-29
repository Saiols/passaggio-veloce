# Passaggio Veloce — CRM Interno (Spec Implementativa)

> **Sorgente autoritativa:** prototipo HTML standalone di Alberto (ora in `docs/crm-prototipo-alberto.html` — sorgente integrale nel commit Git).
> **Documenti correlati:** `docs/ecosistema-crm-ai.md` (paper operativo), `docs/crm-architettura.md` (integrazione tecnica), `docs/CRM Struttura Ruoli Permessi.docx`.
> **Data spec:** 2026-05-06.
> **Owner:** CTO Francesco Sioli.

Questo documento traduce il prototipo in **bundle implementativi** sequenziali per il CRM nativo Passaggio Veloce. Sostituisce il placeholder "FASE 14 — CRM nativo differito" della release post-demo.

---

## 1. Posizionamento architetturale

### Cosa è il CRM
Strumento **interno platform** usato dal team Passaggio Veloce (Alberto + Andrea + sales) per:
- Acquisire lead pre-iscrizione (broker e agenzie target)
- Pianificare campagne di chiamate AI outbound
- Tracciare il funnel S0→S11 di ogni contatto
- Gestire i bot vocali (Vapi) e testuali (sito/WhatsApp/mail)
- Misurare conversione e revenue

### Cosa NON è
- Non è multi-tenant (broker/agenzie clienti **non** lo vedono)
- Non sostituisce le anagrafiche `Company` della piattaforma — vive accanto
- Non è un duplicato del "Catalogo contatti" esistente in `/admin/crm` (vedi §2)

### Coesistenza con `/admin/crm` esistente
Oggi `/admin/crm` (rinominato da "Contatti" a "CRM" nella release post-demo) mostra il **catalogo contatti** dedupli­cato di venditori/acquirenti già transitati nelle pratiche. È un **asset commerciale post-iscrizione**, alimentato dai dati operativi.

Il **CRM lead pipeline** descritto qui invece è un **modulo pre-iscrizione**: contatti acquisiti da CSV/scraping/referral, lavorati via chiamata AI fino all'iscrizione.

**Decisione:** i due viaggiano in parallelo come moduli distinti dentro `/admin/crm`:
- **Tab "Pipeline lead"** → questa spec
- **Tab "Contatti operativi"** → pagina attuale (catalogo dedupli­cato)

Le due tab condividono header e nav admin ma hanno entità DB separate (`CrmContact` vs `CatalogoContatto` derivato dalle `Pratica`).

---

## 2. Entità e schema DB

Tutte le entità sono in scope **platform**: nessuna `companyId` o multi-tenant.

### 2.1 `CrmContact` (lead pipeline)

```prisma
model CrmContact {
  id String @id @default(uuid()) @db.Uuid

  // Anagrafica
  nome             String                  // Ragione sociale (mai cognome — qui sono aziende)
  cat              CrmContactCategoria     // BROKER | AGENZIA
  tel              String                  // Telefono fisso (sempre presente)
  wa               String?                 // WhatsApp (raccolto da bot via function calling)
  email            String?
  piva             String?
  indirizzo        String?
  citta            String?
  cap              String?
  regione          String?                 // 20 regioni IT

  // Funnel CRM
  status           CrmStatoContatto        @default(S0)
  fonte            CrmFonteAcquisizione    // CSV_INIZIALE | ISCRIZIONE_DIRETTA | REFERRAL | ALTRO
  assignedToId     String?                 @db.Uuid
  assignedTo       User?                   @relation(fields: [assignedToId], references: [id])
  lastContactAt    DateTime?
  nextContactAt    DateTime?
  nextContactFascia  CrmFasciaContatto?  // null = indifferente

  // Chiamate
  callCount        Int                     @default(0)
  callEsito        CrmCallEsito?           // NON_RISPONDE | NON_INTERESSATO | INTERESSATO | RICHIAMA | ISCRITTO
  sentiment        CrmSentiment?           // POSITIVO | NEUTRO | NEGATIVO
  obiezioni        String?                 // CSV di tag (es. "dubbio prezzo, vuole video")
  noteAI           String?                 // Riassunto AI post-chiamata
  trascrizione     String?                 // Trascrizione verbatim
  noteManuali      String?                 // Note del sales

  // Tracking pixel
  linkInviato      Boolean                 @default(false)
  linkInviatoAt    DateTime?
  linkAperto       Boolean                 @default(false)
  linkAperture     Int                     @default(0)
  videoInviato     Boolean                 @default(false)
  videoMin         Int                     @default(0)
  mailAperta       Boolean                 @default(false)
  smsInviato       Boolean                 @default(false)
  waInviato        Boolean                 @default(false)
  iscrizioneInit   Boolean                 @default(false)
  iscrizioneComp   Boolean                 @default(false)
  iscrizioneAt     DateTime?

  // Aggancio all'azienda registrata — motore `lib/crm/match/`, vedi §12.
  // Si popola alla registrazione, dal cron e dalla pagina admin di
  // riconciliazione. NON è una cascata su un campo solo: serve una prova
  // forte e vince il punteggio più alto.
  companyId        String?                 @db.Uuid
  company          Company?                @relation(fields: [companyId], references: [id], onDelete: SetNull)
  sedeId           String?                 @db.Uuid   // sede che ha fatto match (null = azienda madre)
  sede             Sede?                   @relation(fields: [sedeId], references: [id], onDelete: SetNull)
  matchVia         String?                 // campi che hanno prodotto l'aggancio, es. "tel+indirizzo+cap"
  matchedAt        DateTime?
  // Chiavi normalizzate per il match: le scrive SOLO `match/norm-fields.ts`.
  telNorm          String?
  waNorm           String?
  emailNorm        String?
  pivaNorm         String?
  platStatus       CrmPlatStatus?          // ATTIVO | INATTIVO | SOSPESO
  primaPratica     Boolean                 @default(false)
  primaPraticaAt   DateTime?
  praticheTotal    Int                     @default(0)
  praticheMonth    Int                     @default(0)
  lastAccessAt     DateTime?
  tassoComp        Int                     @default(0)        // 0-100 percentuale completamento

  createdAt        DateTime                @default(now())
  updatedAt        DateTime                @updatedAt
  deletedAt        DateTime?

  campaignAssegnazioni CrmCampaignAssegnazione[]

  @@index([cat])
  @@index([status])
  @@index([regione])
  @@index([assignedToId])
  @@index([companyId])
  @@index([linkAperto])
  @@index([telNorm])
  @@index([waNorm])
  @@index([emailNorm])
  @@index([pivaNorm])
  @@index([sedeId])
  // + indice UNIQUE PARZIALE (companyId, sedeId) NULLS NOT DISTINCT, che
  // vive solo nella migration: Prisma 5 non sa esprimerlo nel DSL. Vedi §12.
  @@map("crm_contacts")
}

enum CrmContactCategoria {
  BROKER
  AGENZIA
}

enum CrmStatoContatto {
  S0  // Non contattato
  S1  // Non risponde
  S2  // Non interessato
  S3  // Interessato
  S4  // Link non aperto
  S5  // Link aperto, non iscritto
  S6  // Iscrizione incompleta
  S7  // Iscritto, non attivo
  S8  // Prima pratica
  S9  // Attivo ricorrente
  S10 // Churned
  S11 // Richiamare — richiamo programmato (giorno + fascia)
}

enum CrmFonteAcquisizione {
  CSV_INIZIALE
  ISCRIZIONE_DIRETTA
  REFERRAL
  ALTRO
}

enum CrmCallEsito {
  NON_RISPONDE
  NON_INTERESSATO
  INTERESSATO
  RICHIAMA
  ISCRITTO
}

enum CrmSentiment {
  POSITIVO
  NEUTRO
  NEGATIVO
}

enum CrmPlatStatus {
  ATTIVO
  INATTIVO
  SOSPESO
}
```

### 2.2 `CrmSalesAgent` (configurazione bot Vapi)

```prisma
model CrmSalesAgent {
  id          String  @id @default(uuid()) @db.Uuid
  nome        String                          // es. "Simona — Veneto/Nord"
  lingua      CrmAgentLingua                  // ITALIANO | ENGLISH | ESPANOL
  voce        CrmAgentVoce                    // FEMMINILE_NATURALE | MASCHILE_NATURALE | CLONATA
  accento     CrmAgentAccento                 // NEUTRO_ITALIANO | NORD_ITALIA | CENTRO_ITALIA | SUD_ITALIA

  prompt          String                      // Identità + obiettivo bot
  scriptPrimo     String                      // Script primo contatto (S0)
  scriptFollowup  String                      // Script follow-up (S4/S5)
  qa              String                      // Q&A obiezioni (testo libero)
  postCall        String                      // Comportamento post-chiamata

  // Integrazione esterna (FASE 14+ con Vapi)
  vapiAgentId     String?                     // ID dell'assistente Vapi associato

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  campaigns   CrmCampaign[]

  @@map("crm_sales_agents")
}

enum CrmAgentLingua    { ITALIANO ENGLISH ESPANOL }
enum CrmAgentVoce      { FEMMINILE_NATURALE MASCHILE_NATURALE CLONATA }
enum CrmAgentAccento   { NEUTRO_ITALIANO NORD_ITALIA CENTRO_ITALIA SUD_ITALIA }
```

### 2.3 `CrmCampaign` (campagna di chiamate)

```prisma
model CrmCampaign {
  id              String                @id @default(uuid()) @db.Uuid
  nome            String

  agentId         String                @db.Uuid
  agent           CrmSalesAgent         @relation(fields: [agentId], references: [id])

  // Filtri target
  regione         String?               // null = tutte
  cat             CrmContactCategoria?  // null = tutte
  statoTarget     CrmStatoContatto?     // null = tutti

  // Parametri chiamata
  maxTry          Int                   @default(3)
  intervalMin     Int                   @default(60)        // minuti tra tentativi
  oraStart        String                @default("09:00")   // HH:MM
  oraEnd          String                @default("18:00")
  giorniAttivi   CrmCampaignGiorni     @default(LUN_VEN)

  status          CrmCampaignStato      @default(ATTIVA)
  note            String?

  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt
  deletedAt       DateTime?

  assegnazioni    CrmCampaignAssegnazione[]

  @@index([agentId])
  @@index([status])
  @@map("crm_campaigns")
}

enum CrmCampaignGiorni { LUN_VEN LUN_SAB TUTTI }
enum CrmCampaignStato  { ATTIVA PAUSATA CHIUSA }

model CrmCampaignAssegnazione {
  id            String       @id @default(uuid()) @db.Uuid
  campaignId    String       @db.Uuid
  contactId     String       @db.Uuid
  campaign      CrmCampaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact       CrmContact   @relation(fields: [contactId], references: [id], onDelete: Cascade)

  tentativi     Int          @default(0)
  esitoUltimo   CrmCallEsito?
  ultimaChiamataAt DateTime?
  createdAt     DateTime     @default(now())

  @@unique([campaignId, contactId])
  @@index([campaignId])
  @@map("crm_campaign_assegnazioni")
}
```

### 2.4 `CrmChatbot` (configurazione bot testuale)

```prisma
model CrmChatbot {
  id            String                @id @default(uuid()) @db.Uuid
  nome          String

  target        CrmContactCategoria?  // null = tutti
  canale        CrmChatbotCanale      // SITO | WHATSAPP | MAIL | TUTTI
  posizione     String?               // es. "Pagina iscrizione", "Homepage"
  attivo        Boolean               @default(true)

  prompt        String                // Identità e tono
  obiettivo     String                // Obiettivo principale
  qa            String                // Q&A (testo libero, formato D:/R:)
  escalation    String                // Messaggio escalation

  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  deletedAt     DateTime?

  @@map("crm_chatbots")
}

enum CrmChatbotCanale { SITO WHATSAPP MAIL TUTTI }
```

### 2.5 Estensione `User` — nuovi ruoli interni

```prisma
enum UserRole {
  ADMIN_PIATTAFORMA   // esistente
  ASSISTENTE          // esistente
  ADMIN_AZIENDA       // esistente
  UTENTE_AZIENDA      // esistente
  // Nuovi ruoli CRM team interno PV
  AD                  // Amministratore delegato (Andrea)
  CTO                 // Chief Technology Officer (Francesco)
  CFO                 // Chief Financial Officer
  SALES_MANAGER       // Manager team commerciale
  SALES               // Sales operativo
}
```

> **Nota mapping con prototipo:** `admin` del prototipo = `ADMIN_PIATTAFORMA` esistente. Aggiungiamo i 5 nuovi ruoli.

---

## 3. Matrice permessi (autoritativa)

| Funzione | ADMIN_PIATTAFORMA | AD | CTO | CFO | SALES_MANAGER | SALES |
|---|---|---|---|---|---|---|
| Contatti — visualizza | ✓ | ✓ | ✓ | — | ✓ | ✓ (assegnati) |
| Contatti — aggiunge/modifica | ✓ | ✓ | ✓ | — | ✓ | ✓ (assegnati) |
| Contatti — elimina | ✓ | ✓ | ✓ | — | ✓ | — |
| Sales — configura agent | ✓ | ✓ | ✓ | — | ✓ | — |
| Sales — crea campagne | ✓ | ✓ | ✓ | — | ✓ | — |
| Chatbot — configura | ✓ | ✓ | ✓ | — | — | — |
| Dashboard — operativa | ✓ | ✓ | ✓ | — | ✓ | — |
| Dashboard — dati economici | ✓ | ✓ | ✓ | Lettura | — | — |
| Utenti — visualizza | ✓ | ✓ | ✓ | — | ✓ (solo SALES) | — |
| Utenti — crea/modifica | ✓ | ✓ | ✓ | — | ✓ (solo SALES) | — |
| Permessi — visualizza | ✓ | ✓ | ✓ | — | — | — |

**Regole di management utenti:**
- `SALES_MANAGER` può gestire solo `SALES`
- `AD/CTO` non possono gestire `ADMIN_PIATTAFORMA`
- Nessun ruolo può gestire se stesso (no self-edit/delete)
- Solo `ADMIN_PIATTAFORMA` può gestire altri `ADMIN_PIATTAFORMA`

`ASSISTENTE` (ruolo esistente) **non** ha accesso al CRM (è ruolo operativo piattaforma, non commerciale).

---

## 4. Pagine e route

Tutto sotto `/admin/crm/*` (l'attuale pagina `/admin/crm` diventa hub con tab).

| Route | Permesso minimo | Descrizione |
|---|---|---|
| `/admin/crm` | view_crm | Hub con 2 tab: "Pipeline lead" (default) e "Contatti operativi" (catalogo esistente) |
| `/admin/crm/contatti` | view_crm | Lista contatti pipeline + filtri + stat cards |
| `/admin/crm/contatti/[id]` | view_crm | Dettaglio contatto con 4 tab modale |
| `/admin/crm/sales` | view_sales (no SALES) | Sales agents + campagne |
| `/admin/crm/chatbot` | view_chatbot | Configurazione bot testuali |
| `/admin/crm/dashboard` | view_dashboard | Dashboard CRM (KPI + charts) |
| `/admin/crm/utenti` | view_users | Gestione utenti team interno |
| `/admin/crm/permessi` | view_perms | Matrice readonly |

L'esistente `/admin/utenti` (gestione utenti delle aziende dealer/agenzie) resta separato. `/admin/crm/utenti` gestisce SOLO utenti team PV (`ADMIN_PIATTAFORMA`, `AD`, `CTO`, `CFO`, `SALES_MANAGER`, `SALES`).

---

## 5. UI dettagliata

### 5.1 Tab Pipeline Lead — `/admin/crm/contatti`

**Stat cards (6):**
- Totale contatti
- Da contattare = `S0 + S1`
- Interessati = `S3 + S5`
- Iscritti = `S7 + S8 + S9`
- Attivi = `S9`
- Churned = `S10`

**Filtri:**
- Search (nome, email, città)
- Categoria: tutti | BROKER | AGENZIA
- Stato: tutti | S0..S11
- Regione: tutte | 20 regioni IT
- Assegnato a: tutti | lista user con ruolo `SALES_MANAGER` o `SALES`
- Sort: 🔴 Più urgenti (default) | Più recenti | Nome A→Z
- Chip "📞 Da richiamare": status S11 con giorno ≤ oggi (fuso di Roma), ordinati dal più arretrato

**Ordinamento "urgenti"** (priorità decrescente):
```
S6 → S5 → S4 → S3 → S1 → S0 → S7 → S2 → S8 → S9 → S10
```

**Lista (card per contatto):**
- Avatar iniziali (colore deterministico da `nome.charCodeAt(0)`)
- Nome azienda
- Categoria · Città · Regione · Telefono
- Pixel indicators inline:
  - 🔗 link aperto / 🔗 link inviato (giallo)
  - ▶ {n}' video
  - ✅ iscritto / ⚡ iscrizione avviata
- Tag obiezioni (chip)
- Badge stato S0..S11 con colore
- Nome assegnatario
- Data ultimo contatto
- Azioni: Modifica, Elimina (se permesso)

**Bottoni header:**
- "+ Nuovo contatto" (se `add_contact`)
- "↓ CSV" (export)

### 5.2 Modale Dettaglio Contatto — 4 tab

**Tab 1 — Anagrafica:**
- Nome azienda *
- Tipo * (BROKER/AGENZIA)
- Telefono fisso *
- WhatsApp
- Email
- P.IVA
- Indirizzo, Città, CAP, Regione (select 20)
- Assegnato a (select sales)
- Fonte acquisizione (CSV_INIZIALE/ISCRIZIONE_DIRETTA/REFERRAL/ALTRO)

**Tab 2 — Stato & Chiamate:**
- Stato CRM * (S0..S11)
- Ultimo contatto (date)
- Prossimo contatto pianificato (date)
- N. chiamate totali
- Esito ultima chiamata
- Sentiment rilevato
- Obiezioni sollevate (CSV tag)
- Note AI (textarea — riassunto post-chiamata)
- Trascrizione completa (textarea verbatim)
- Note manuali

**Tab 3 — Tracking & Pixel:**
- Link inviato? (sì/no) + data invio
- Link aperto? + n. aperture
- Video tutorial inviato? + minuti visti
- Mail aperta?
- SMS inviato?
- WhatsApp inviato?
- Iscrizione iniziata?
- Iscrizione completata? + data

**Tab 4 — Piattaforma:**
- ID piattaforma (Company.id matching, readonly se popolato)
- Status account (ATTIVO/INATTIVO/SOSPESO, da Company.suspendedAt + lastLoginAt)
- Prima pratica completata? + data
- Pratiche totali
- Pratiche ultimo mese
- Ultimo accesso piattaforma
- Tasso completamento pratiche % (0-100)

I campi tab 4 sono **readonly per i sales**, **read+write per admin** (override manuale). Sono popolati automaticamente da un cron sync (vedi §7).

### 5.3 Sales Agents — `/admin/crm/sales`

**Layout 2 colonne:**

**Colonna sinistra — Sales Agent:**
- Bottone "+ Nuovo agent"
- Card per agent: nome, lingua/voce/accento, prompt preview, [Modifica] [Elimina]

**Colonna destra — Campagne:**
- Bottone "+ Nuova campagna"
- Card per campagna: nome, agent, filtri (regione/tipo/stato), badge status (Attiva/Pausata/Chiusa), parametri (max tentativi, intervallo, orari, giorni)

**Modale Nuovo Sales Agent:**
- Nome *
- Lingua, Voce, Accento (dropdown)
- Prompt — identità e obiettivo (textarea)
- Script primo contatto S0 (textarea)
- Script follow-up S4/S5 (textarea)
- Q&A obiezioni (textarea)
- Comportamento post-chiamata (textarea)

**Modale Nuova Campagna:**
- Nome *
- Sales agent * (dropdown agents)
- Filtro regione, tipo, stato CRM (dropdown)
- Max tentativi/giorno (default 3, range 1-10)
- Intervallo tra tentativi min (default 60, min 15)
- Orario inizio/fine
- Giorni attivi (LUN_VEN/LUN_SAB/TUTTI)
- Stato campagna (Attiva/Pausata/Chiusa)
- Note

**"Lancia campagna"** = crea record + popola `CrmCampaignAssegnazione` con tutti i contatti che matchano i filtri al momento del lancio.

### 5.4 Chatbot — `/admin/crm/chatbot`

Lista bot configurati, ognuno con:
- Nome
- Badge canale (Sito/WhatsApp/Mail) con colore
- Badge target (Agenzia/Broker)
- Badge posizione (Homepage/Pagina iscrizione/...)
- Badge attivo/inattivo
- Obiettivo (preview testo)
- [Modifica] [Elimina]

**Modale Nuovo Chatbot:**
- Nome *
- Target (Agenzia/Broker/Tutti)
- Canale principale (Sito/WhatsApp/Mail/Tutti)
- Posizione sul sito (libero o select da preset)
- Attivo (sì/no)
- Prompt — identità e tono (textarea)
- Obiettivo principale (textarea)
- Q&A principali (textarea, formato `D: ... / R: ...` una per riga)
- Messaggio escalation a umano (input)

### 5.5 Dashboard CRM — `/admin/crm/dashboard`

**Stat cards (6):**
- Totale contatti
- Iscritti attivi (S8+S9)
- In conversione (S3+S5+S6)
- Link aperti (count `linkAperto=true`)
- Sales agent (count)
- Campagne attive (count `status=ATTIVA`)

**2 grafici affiancati:**
- **Contatti per mese** — bar chart degli ultimi 6 mesi (riusa `RendimentoChart`)
- **Distribuzione per stato** — progress bars S0..S11 con percentuale

**Sezione Dati Economici** (visibile solo a `view_financials`):
- Revenue mese (€)
- Pratiche mese
- Wallet broker (saldo aggregato)
- Revenue per pratica

### 5.6 Utenti Team — `/admin/crm/utenti`

Tabella con: Utente, Ruolo (badge colorato), Email, Azioni (Modifica/Elimina se `canManageUser`).

Filtraggio implicito: `SALES_MANAGER` vede solo `SALES` + se stesso. Altri ruoli ammessi vedono tutti.

**Modale Nuovo Utente:**
- Nome completo *
- Email *
- Ruolo * (lista filtrata da `creatableRoles()`)
- Password * (min 6 char, obbligatoria solo in creazione)

**Modale Modifica Utente:**
- Nome, Email, Ruolo
- Nuova password (vuoto = invariata)

### 5.7 Matrice Permessi — `/admin/crm/permessi`

Tabella readonly con tutti i ruoli e tutte le funzioni — vedi §3.

---

## 6. Bundle implementativi

### Bundle CRM-A — Schema + ruoli + migrazione

1. Migrazione Prisma: 5 nuove enum CRM (CrmContactCategoria, CrmStatoContatto, CrmFonteAcquisizione, CrmCallEsito, CrmSentiment, CrmPlatStatus, CrmAgentLingua/Voce/Accento, CrmCampaignGiorni/Stato, CrmChatbotCanale)
2. Migrazione: 4 modelli (CrmContact, CrmSalesAgent, CrmCampaign + CrmCampaignAssegnazione, CrmChatbot)
3. Estensione `UserRole` enum con AD, CTO, CFO, SALES_MANAGER, SALES
4. Helper `lib/auth/permissions.ts`: `canViewCrm()`, `canEditCrm()`, `canDeleteCrmContact()`, `canViewSales()`, `canViewChatbot()`, `canViewCrmDashboard()`, `canViewFinancials()`, `canManageUserCrm()`, `creatableCrmRoles()`
5. Seed: aggiunge 5 utenti team test con i nuovi ruoli (per dev locale)

### Bundle CRM-B — Pagina contatti + modale 4 tab

1. Refactor `/admin/crm/page.tsx` → diventa hub con 2 tab. Sposta il catalogo esistente sotto `/admin/crm/contatti-operativi`.
2. Nuova route `/admin/crm/contatti` con stat cards, filtri, lista.
3. Server actions: `createCrmContact`, `updateCrmContact`, `deleteCrmContact`, `bulkImportCrmContactsFromCsv`
4. Componente `<CrmContactCard>` (avatar, pixel indicators, status pill, obiezioni tag)
5. Modale dettaglio con 4 tab (Anagrafica/Stato&Chiamate/Tracking&Pixel/Piattaforma)
6. Export CSV server action
7. Update sidebar admin aggiunge sub-voci sotto "CRM"

### Bundle CRM-C — Sales Agents + Campagne

1. Pagina `/admin/crm/sales` con 2 colonne
2. Server actions: `createSalesAgent`, `updateSalesAgent`, `deleteSalesAgent`, `createCampaign`, `updateCampaign`, `pauseCampaign`, `resumeCampaign`, `closeCampaign`
3. Modale Sales Agent
4. Modale Campagna — al "Lancia" popola `CrmCampaignAssegnazione` per tutti i `CrmContact` matchanti
5. Cron stub `crm-campaign-tick` (no-op finché Vapi non è integrato)

### Bundle CRM-D — Chatbot

1. Pagina `/admin/crm/chatbot`
2. Server actions: `createChatbot`, `updateChatbot`, `toggleChatbotActive`, `deleteChatbot`
3. Modale Chatbot
4. Stub provider in `lib/providers/chatbot/` (no implementazione reale finché non si attiva Manychat/WATI)

### Bundle CRM-E — Dashboard CRM

1. Pagina `/admin/crm/dashboard`
2. Server-side aggregazioni: contatti/mese, distribuzione stato, count attivi/in-conversione/iscritti
3. Riusa `<RendimentoChart>` (refactor light: prende `RendimentoBucket[]`, già parametrico)
4. Sezione "Dati economici" gated da `canViewFinancials()` — riprende metriche dalla `/admin/dashboard` esistente (già su `Pratica` e `Payout`)

### Bundle CRM-F — Utenti team interno

1. Pagina `/admin/crm/utenti`
2. Server actions: `createCrmUser`, `updateCrmUser`, `resetCrmUserPassword`, `deleteCrmUser`
3. Modale Utente con ruolo dropdown filtrato
4. Logica `creatableCrmRoles()` server-side autoritativa
5. Pagina `/admin/crm/permessi` (readonly tabella)

### Bundle CRM-G — Sync con piattaforma (cron)

1. Cron `syncCrmFromPlatform`:
   - Per ogni `CrmContact` con `companyId != null`: aggiorna `platStatus`, `praticheTotal`, `praticheMonth`, `lastAccessAt`, `tassoComp` da `Company` + `Pratica` + `User.lastLoginAt`
   - Poi passa il motore di riconciliazione su tutta la lista, per agganciare chi si è registrato nel frattempo — **vedi §12**, che è la descrizione autoritativa del match
2. Alla registrazione, `tryMatchCrmContact(companyId)` cerca il lead di quella sola azienda
3. Webhook su `Pratica.create` con stato `FIRMATA` aggiorna stato CRM:
   - Se prima pratica del broker referente: `S7 → S8` + set `primaPratica=true`
   - Se ricorrente: `S8 → S9`

### Bundle CRM-H (futuro, dopo account Vapi/Twilio)

1. Provider `lib/providers/vapi.ts` — wrapper SDK Vapi
2. Endpoint API `/api/crm/vapi/function-call` per function calling in chiamata (raccolta email/WA real-time)
3. Webhook Vapi `/api/crm/vapi/webhook` per trascrizione + esito post-chiamata
4. Integrazione Twilio per SMS post-chiamata
5. Pixel tracking server `/api/crm/pixel/[contactId]/[event]` per link/video/iscrizione
6. Mail tracking via Lemlist webhook

---

## 7. Decisioni prese (default applicato — confermare con feedback)

Per non bloccarmi su tutto, ho applicato i miei default. Correggimi solo dove serve:

| # | Tema | Default applicato |
|---|---|---|
| 1 | Posizionamento `/admin/crm` esistente vs nuovo | **2 tab nello stesso hub**: "Pipeline lead" (nuovo) + "Contatti operativi" (catalogo esistente). Niente rotta separata. |
| 2 | Ruoli CRM nel `UserRole` enum | **Estendo** `UserRole` aggiungendo AD/CTO/CFO/SALES_MANAGER/SALES (oggi: ADMIN_PIATTAFORMA, ASSISTENTE, ADMIN_AZIENDA, UTENTE_AZIENDA). |
| 3 | Login dei ruoli interni | **Riusano `/login` esistente** — niente login separato. RBAC fa il resto. |
| 4 | CrmContact vs Company | **Entità separata**. Match post-iscrizione popola `companyId` su CrmContact. |
| 5 | Multi-CrmContact con stessa email | Permesso (es. broker che cambia email). Match privilegia il più recente. |
| 6 | Import CSV | **Sì in CRM-B**. Mappatura colonne fissa (nome, cat, tel, wa, email, piva, indirizzo, città, cap, regione). Errori gestiti per riga. |
| 7 | Vapi function calling | **Bundle CRM-H differito**: solo modello dati + UI nei bundle A-G. Chiamate reali dopo account Vapi. |
| 8 | Pixel tracking | **Solo modello dati** in CRM-B (campi su CrmContact). Endpoint pixel implementato in CRM-H insieme a Vapi/Twilio. |
| 9 | "Catalogo contatti" (rinominato CRM nella release post-demo) | **Diventa tab "Contatti operativi"** — non si tocca la logica catalogo, solo embedding. |
| 10 | `RendimentoChart` riuso | **Riusabile** — già parametrico. Nessuna modifica. |
| 11 | Stati S0-S10 di Pratica vs CRM | Sono **due dimensioni diverse**: `PraticaStato` resta su Pratica, `CrmStatoContatto` è su CrmContact. Non confondibili. |
| 12 | Match webhook iscrizione | ~~Cascata email → tel → P.IVA~~ — **superato il 2026-07-27**: la cascata non agganciava mai nulla (vedi §12). Oggi: prova forte + punteggio, sedi comprese. Se nessun match: nessun aggiornamento (resta lead non agganciato). |

---

## 8. Decisioni prese (2026-05-06)

Tutte le 12 domande aperte sono state risolte con CTO. Sintesi:

| # | Tema | Decisione |
|---|---|---|
| 1 | `ADMIN_PIATTAFORMA` vs nuovo `ADMIN` | **Stesso ruolo** — `ADMIN_PIATTAFORMA = admin` del prototipo. Nessun nuovo ruolo. |
| 2 | AD/CTO accesso CRM | **Uso quotidiano** — UX completa, non supervisione. |
| 3 | ASSISTENTE | **Fuori dal CRM** per ora. Read-only in fase futura se servirà. |
| 4 | Eliminazione contatto | **Soft delete** + cron purge a 90gg (compliance GDPR). |
| 5 | CSV import | **Admin + Sales Manager**. Permission `bulk_import_crm`. |
| 6 | Sales Manager | **Owner della campagna** — gestisce solo le sue campagne + utenti SALES. |
| 7 | Filtro contatti SALES | **Strict** — `assignedToId === currentUser.id`. Nessun override. |
| 8 | Delete agent con campagne attive | **Blocco** — non si può eliminare agent se ha campagne ATTIVA/PAUSATA. |
| 9 | Chatbot embed sito | **Stessa Next app** — component inline, no iframe/script embeddable. |
| 10 | Dati economici dashboard CRM | **Stesso aggregato** della `/admin/dashboard` — riuso engine esistente. |
| 11 | Telefono fisso obbligatorio | **Sempre** — anche per iscrizione diretta. |
| 12 | Storico chiamate | **Tabella `CrmCall` separata** — sblocca Vapi webhook + analytics. |

### Conseguenze schema (aggiornate)

Aggiunto modello `CrmCall`:

```prisma
model CrmCall {
  id          String        @id @default(uuid()) @db.Uuid

  contactId   String        @db.Uuid
  contact     CrmContact    @relation(fields: [contactId], references: [id], onDelete: Cascade)

  campaignId  String?       @db.Uuid
  campaign    CrmCampaign?  @relation(fields: [campaignId], references: [id], onDelete: SetNull)

  agentId     String?       @db.Uuid
  agent       CrmSalesAgent? @relation(fields: [agentId], references: [id], onDelete: SetNull)

  // Esecuzione
  startedAt   DateTime
  endedAt     DateTime?
  duration    Int?          // secondi
  esito       CrmCallEsito?
  sentiment   CrmSentiment?

  // Output AI
  summary     String?       // riassunto generato post-chiamata
  transcript  String?       // verbatim
  obiezioniTags String?     // CSV tag rilevati

  // Integrazione esterna (CRM-H)
  vapiCallId   String?      @unique
  recordingUrl String?

  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([contactId])
  @@index([campaignId])
  @@index([startedAt])
  @@map("crm_calls")
}
```

Aggregati `CrmContact.callCount` e `callEsito` restano denormalizzati (per query veloce su lista) e sono aggiornati via trigger applicativo a ogni `CrmCall.create`. Stesso pattern su `CrmCampaignAssegnazione.tentativi` e `esitoUltimo`.

### Owner della campagna

Aggiungo a `CrmCampaign`:
```prisma
ownerId String @db.Uuid
owner   User   @relation(fields: [ownerId], references: [id])
```

Permission `manage_campaign(c)` = `currentUser.role in [ADMIN_PIATTAFORMA, AD, CTO]` OR `c.ownerId === currentUser.id`.

### Soft delete agent con cascade pause

Server action `deleteSalesAgent`:
```typescript
const activeCount = await prisma.crmCampaign.count({
  where: { agentId, status: { in: ['ATTIVA', 'PAUSATA'] }, deletedAt: null }
});
if (activeCount > 0) {
  return { ok: false, error: `Agent usato in ${activeCount} campagne attive/pausate. Chiudile prima di eliminare.` };
}
```

---

## 8b. Domande aperte (storiche, prima di 2026-05-06)

> Risolte tutte. Lascio la sezione come audit trail.

1. **`ADMIN_PIATTAFORMA` esistente vs nuovo `ADMIN`**: oggi abbiamo `ADMIN_PIATTAFORMA` (Alberto/Andrea). Nel prototipo è chiamato `admin`. Confermi che `ADMIN_PIATTAFORMA = admin` del prototipo? Senza creare un nuovo ruolo `ADMIN`?

2. **`AD` e `CTO` con accesso CRM completo**: il prototipo dà accesso CRM completo ad AD/CTO. Sono effettivamente operativi sul CRM (uso quotidiano) o lo aprono solo per supervisione? Implica scelte di UX (notifiche, mobile, ecc.).

3. **`ASSISTENTE` esistente fuori dal CRM**: confermi che il ruolo `ASSISTENTE` (operativo piattaforma) non vede il CRM? Oppure va aggiunto come `view_crm` readonly?

4. **Eliminazione contatto CRM**: hard delete o soft delete? Per coerenza con `Company.deletedAt` propongo soft delete + cron purge a 90gg. OK?

5. **CSV import**: chi lo fa abitualmente — solo admin o anche sales_manager? Permission `bulk_import_crm`?

6. **Sales Manager**: nel prototipo gestisce solo utenti `SALES`. Confermi che non gestisce campagne fatte da AD/CTO ma può gestire le SUE? Modello "owner della campagna"?

7. **Filtro contatti per `SALES`**: nel prototipo il sales vede solo i contatti `assigned === currentUser.id`. Confermi che è strict (no override)? E se un sales vede una pratica con un contatto non assegnato a lui, può segnalarlo per riassegnazione?

8. **Campagne attive**: cosa succede se l'agent associato viene eliminato? Blocco delete agent se ha campagne attive, o cascade pause?

9. **Chatbot — dove va embedded?**: il bot "Sito" deve essere mostrato nel sito pubblico (es. `passaggioveloce.it` landing). Oggi il sito pubblico è la stessa Next app o un sito separato? Se separato, il chatbot deve essere implementato come iframe/script embeddable.

10. **Dati economici nella dashboard CRM**: sono gli stessi della `/admin/dashboard` esistente o un sottoinsieme? Propongo: stesso aggregato già fatto, riuso engine `lib/dashboard/financials.ts`.

11. **Telefono fisso obbligatorio**: il prototipo lo segna `*`. È SEMPRE obbligatorio anche per iscrizione diretta? (es. broker che si iscrive online → potrebbe non avere telefono, ma email e P.IVA sì)

12. **Storico chiamate per contatto**: il prototipo memorizza solo `callCount + callEsito`. Vogliamo una **tabella `CrmCall` separata** per ogni chiamata (timestamp, durata, esito, transcript) o teniamo aggregato? La tabella separata sblocca il bundle Vapi e analytics avanzate.

---

## 9. Ordine di implementazione consigliato

```
CRM-A (schema)
  ↓
CRM-B (contatti + modale)              ← lo zoccolo, senza questo niente funziona
  ↓
CRM-F (utenti team + permessi)         ← serve admin abbia gli utenti per assegnare contatti
  ↓
CRM-C (sales + campagne)               ← richiede contatti già funzionanti per filtri target
  ↓
CRM-D (chatbot)                        ← indipendente
  ↓
CRM-E (dashboard CRM)                  ← richiede dati popolati
  ↓
CRM-G (sync con piattaforma)           ← richiede tutto pronto, popola tab Piattaforma
  ↓
CRM-H (Vapi/Twilio/Pixel reali)        ← differito, dopo account esterni
```

Stima: A+B+F+C+D+E+G in 4-6 giorni di lavoro pieno (estimate large).
H separato dopo apertura account.

---

## 10. Migrazioni necessarie

1. `crm_initial_schema` (A) — 4 modelli + ~10 enum
2. `crm_user_roles_extension` (A) — 5 valori a `UserRole`
3. `crm_sync_indexes` (G) — index su `companyId`, indici per cron sync se serve

---

## 11. Note di rilascio

- Ogni bundle = 1 commit logico convenzionale `feat(crm): ...`
- Test e2e finale sui bundle A-G prima di pushare
- Migrazioni applicate prima a dev locale, poi a Neon prod come da pattern
- Demo a soci dopo CRM-G (intero CRM senza Vapi reale)
- CRM-H è una fase a sé con account esterno e budget separato

---

## 12. Riconciliazione CRM ↔ aziende registrate (2026-07-27)

> **Questa sezione è autoritativa sul match.** Dove il resto del documento (o
> `crm-architettura.md`, o `ecosistema-crm-ai.md`) parla di "cascata
> email → telefono → P.IVA", parla di un meccanismo **sostituito**.

### 12.1 Perché la cascata è stata rimossa

Il vecchio `tryMatchCrmContact` non ha mai agganciato **nemmeno un contatto**.
Due difetti indipendenti:

1. confrontava il telefono **normalizzato** della `Company` con `CrmContact.tel`
   **grezzo** (`+39 02 447 8712`) — non poteva coincidere mai;
2. la cascata era tarata su campi che la lista importata non ha. Su 19.103
   righe reali: telefono **100%**, email **1,3%**, P.IVA **0%**.

Risultato prima dell'intervento: **0 contatti agganciati**, quindi la dashboard
CRM mostrava 0 iscritti anche con 19 aziende registrate.

### 12.2 Come funziona oggi

Motore in `apps/piattaforma/src/lib/crm/match/`, a stadi, tutto puro tranne
l'ultimo:

| Modulo | Ruolo |
|---|---|
| `normalize.ts` | **Fonte unica** delle chiavi. Telefono → sole cifre, via `0039`/`39` di prefisso, scarta sotto le 8 cifre. Nome senza forme societarie, indirizzo senza civico finale. |
| `identita.ts` | Da una `Company` ricava **più identità**: la madre + **una per sede**. La lista CRM è fatta di punti vendita, non di ragioni sociali. |
| `score.ts` | Ammissione + punteggio della coppia (identità, contatto). |
| `assign.ts` | Assegnazione greedy con indice sulle chiavi forti, ordinamento deterministico. |
| `engine.ts` | Solo lettura: calcola le proposte (dry-run per l'anteprima). |
| `apply.ts` | Scrive, con compare-and-set. |
| `stato.ts` / `storico.ts` | Fonte unica dell'ordine del funnel e del conteggio pratiche. |

**Ammissione** — serve almeno una **prova forte**: P.IVA, email/PEC,
telefono/WhatsApp. Nome, indirizzo, città e CAP non bastano mai da soli.

**Eccezione categoria** — se la riga è `BROKER` e l'azienda è `AGENZIA` (o
viceversa), la prova forte da sola non basta: serve un **secondo indizio
identificante**. `nome~` (parziale), città e CAP **non** contano: sono proprio i
campi che non discriminano nel caso che la regola deve proteggere — due attività
diverse con lo stesso centralino nella stessa città.

**Punteggio** (`PESI`, serve solo a ordinare: "più campi uguali vince"):
P.IVA 100 · email 60 · telefono 50 · nome 25 · indirizzo 20 · nome parziale 15 ·
CAP 5 · città 5.

**Pari merito** — se due identità diverse si contendono lo stesso contatto la
proposta è marcata **ambigua**. Un'eccezione: madre e sua sede non sono
ambigue (è la stessa azienda) e a parità **vince la sede**.

**Stato del funnel** — allineato allo storico reale, mai a indovinare:
`S7` registrata, `S8` almeno una pratica firmata, `S9` ricorrente. Solo in
salita; **`S10` non viene mai assegnato dal motore**.

### 12.3 I tre canali

| Canale | Quando | Ambigue |
|---|---|---|
| Registrazione (`tryMatchCrmContact`) | alla creazione della `Company` | **non** applicate (ma vedi il limite qui sotto) |
| Cron `crm-sync` | notturno, su tutta la lista | **non** applicate |
| `/admin/crm/riconciliazione` | a mano, anteprima + Applica (permesso CRM full) | **applicate** — c'è una persona che ha appena visto l'anteprima |

⚠️ **Limite noto del canale di registrazione**: il calcolo è ristretto
all'azienda appena creata, quindi delle due clausole di ambiguità scatta solo
"più contatti per la stessa identità". La clausola "più aziende diverse si
contendono lo stesso contatto" non può scattare — in quell'insieme c'è una sola
azienda. Se una riga ancora libera è contesa a pari punteggio fra chi si sta
registrando e un'altra azienda già registrata, viene assegnata alla prima senza
essere marcata ambigua, e il cron non lo ripara (la riga non è più libera).
Caso raro, richiede un pareggio esatto; documentato invece che nascosto.

**Non esiste uno sgancio.** Cancellare il contatto sbagliato non ferma il
ciclo: torna libero e la notte dopo aggancia il secondo migliore. Se un aggancio
è sbagliato va corretto il dato che l'ha prodotto.

### 12.4 Invarianti a livello DB

- Colonne `telNorm/waNorm/emailNorm/pivaNorm` indicizzate, scritte **solo** da
  `match/norm-fields.ts`: ogni nuovo write path su `CrmContact` deve passare
  di lì, altrimenti il contatto diventa invisibile al match.
- Indice **unique parziale** `(companyId, sedeId) NULLS NOT DISTINCT WHERE
  companyId IS NOT NULL AND deletedAt IS NULL`: impedisce a due passate
  concorrenti di agganciare due righe alla stessa identità. Il compare-and-set
  applicativo protegge il *contatto*; questo indice protegge l'*identità*.

### 12.5 Conseguenza sulle campagne del sales agent

Da quando il match aggancia davvero, una campagna lanciata senza filtro di stato
includerebbe anche i contatti a `S7/S8/S9`: il bot vocale telefonerebbe a
clienti **già a bordo** per proporgli di iscriversi.

`createCampaignAction` quindi **esclude sempre dal target i contatti con
`companyId` valorizzato**, qualunque filtro sia stato scelto. L'esclusione non è
silenziosa: il modale di lancio riporta quanti contatti sono stati esclusi
perché già registrati. Vedi anche `ecosistema-crm-ai.md` §10.
