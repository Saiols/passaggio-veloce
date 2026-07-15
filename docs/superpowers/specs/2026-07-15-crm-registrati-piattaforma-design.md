# Design — Registrati piattaforma nella dashboard CRM

Data: 2026-07-15
Stato: approvato in brainstorming, in attesa di piano di implementazione

## Contesto

La dashboard CRM admin (`/admin/crm/dashboard`) è oggi alimentata **solo dai contatti
della lista CRM** (modello `CrmContact`): tutte le metriche contano righe di `CrmContact`
e il loro funnel S0→S10. Un'azienda che si registra in autonomia (passaparola) **e che non
era in lista** non ha alcun `CrmContact` → è **invisibile** alla dashboard.

L'obiettivo è aggiungere un dato **informativo** di contesto: quante aziende sono
**registrate sulla piattaforma** per tipo (broker / agenzie), distinguendo quelle arrivate
dalla lista CRM da quelle organiche. Sono numeri "che fanno numero": **non entrano nelle
metriche di conversione** del funnel, che restano invariate.

## Cosa NON facciamo (già esistente / fuori scope)

**La riconciliazione delle auto-registrazioni esiste già ed è in produzione** — nessun
lavoro su questo fronte (decisione utente: lasciare com'è).

Motore `apps/piattaforma/src/lib/crm/sync.ts`, tre agganci verificati:
- `tryMatchCrmContact(companyId)` — chiamato in registrazione (`app/(auth)/actions.ts:607`,
  best-effort post-commit). Cerca un lead CRM non ancora agganciato con cascade
  **email → telefono → P.IVA**; se lo trova, valorizza `CrmContact.companyId` e auto-promuove
  lo stato a **S7 "Iscritto inattivo"** (solo se il lead era in fase pre-iscrizione S0..S6).
- `onPraticaFirmata(praticaId)` — `lib/pratiche/firma-engine.ts:339`. S7→S8 (prima pratica),
  poi S8→S9 (ricorrente).
- `syncCrmFromPlatform()` — cron `app/api/jobs/crm-sync/route.ts`. Ricalcola aggregati
  (`platStatus`, `praticheTotal`, `praticheMonth`, `lastAccessAt`, `tassoComp`) per i contatti
  già agganciati a una Company.

Il match usa la **P.IVA** (identità legale univoca) e non la ragione sociale: scelta
mantenuta di proposito per evitare falsi positivi/negativi da nomi simili o forme societarie
diverse.

Altro fuori scope: nessun elenco nominativo delle aziende organiche (solo conteggi); nessuna
nuova permission; nessuna migration; nessuna modifica alle query/metriche del funnel esistenti.

## Fatti tecnici verificati (letti nel codice)

- `Company.type` è l'enum `CompanyType { DEALER, AGENZIA }` (`schema.prisma:20-22`).
  **DEALER = Broker**, **AGENZIA = Agenzie**.
- Relazione: su `Company` c'è `crmContactMatches CrmContact[] @relation("CrmContactCompany")`
  (`schema.prisma:467`); su `CrmContact` c'è `company Company? @relation("CrmContactCompany",
  fields: [companyId] …)` (`schema.prisma:1886`). `CrmContact.companyId` viene valorizzato
  **solo** da `tryMatchCrmContact` (nessun form manuale lo setta) ⇒ "Company con contatto
  agganciato" ⟺ "era nella lista CRM prima di registrarsi".
- Dashboard: `app/admin/crm/dashboard/page.tsx`, server component, gate
  `canViewCrmDashboard(session.user.role)`. Le aggregazioni sono in un unico `Promise.all`.

## Definizioni (il cuore del design)

Per ciascun tipo (`DEALER` → Broker, `AGENZIA` → Agenzie):

- **Registrati (totale)** = `Company` con `deletedAt: null`, raggruppati per `type`.
  I **sospesi sono inclusi** (restano registrati); i **cancellati** (`deletedAt` valorizzato)
  sono esclusi.
- **Da lista CRM** = Company (`deletedAt: null`) che ha **almeno un** `CrmContact` agganciato,
  filtro relazione `crmContactMatches: { some: {} }`. Include anche il caso in cui il contatto
  sia stato poi soft-deleted: rappresenta il fatto storico "è arrivata dalla nostra lista",
  che non cambia se il lead viene poi archiviato.
- **Organici / passaparola** = `Registrati − Da lista`. Matematicamente ≥ 0 (è un
  sottoinsieme), con guard difensivo `max(0, …)`.

## Componenti

### `lib/crm/platform-stats.ts` (nuovo)
Funzione isolata e testabile:

```ts
export type TipoRegistrati = { tot: number; daLista: number; organici: number };
export type PlatformRegistrationStats = {
  broker: TipoRegistrati;   // Company.type = DEALER
  agenzia: TipoRegistrati;  // Company.type = AGENZIA
};
export async function getPlatformRegistrationStats(): Promise<PlatformRegistrationStats>;
```

Implementazione: due `prisma.company.groupBy({ by: ['type'], where: { … }, _count: { _all } })`
in un `Promise.all`:
1. totali per tipo — `where: { deletedAt: null }`;
2. da-lista per tipo — `where: { deletedAt: null, crmContactMatches: { some: {} } }`.

Lo split (`organici = max(0, tot − daLista)`) si calcola in memoria. `DEALER`→`broker`,
`AGENZIA`→`agenzia`; tipi assenti dai gruppi ⇒ zeri.

### `app/admin/crm/dashboard/page.tsx` (modifica)
- Importa `getPlatformRegistrationStats` e la aggiunge al `Promise.all` esistente.
- Rende una nuova `<section>` **"Registrati sulla piattaforma"** subito **sotto le stat-card
  del funnel** e **prima** di "Raggiungimento obiettivo".
- Nessun cambiamento alle query/metriche esistenti.

## UI

- Titolo sezione: **"Registrati sulla piattaforma"**.
- Sottotitolo esplicito: *"Dato informativo — non incide sulle metriche di conversione del
  funnel."*
- Due blocchi affiancati (**Broker** / **Agenzie**); per ciascuno:
  - **Totale** in evidenza (numero grande);
  - due righe **"Da lista CRM"** e **"Organici / passaparola"** con valore + mini-barra di
    proporzione sul totale.
- Riusa i componenti/stile `pv-*` e i pattern già presenti nella pagina (card, barre, tipografia).
  Nessun colore hardcoded (design system).

## Test

- **Unit** su `getPlatformRegistrationStats` (mock Prisma):
  - totali e da-lista mappati correttamente su broker/agenzia;
  - `organici = tot − daLista` e mai negativo (anche con dati incoerenti → guard `max(0, …)`);
  - tipo assente nei gruppi → `{ tot: 0, daLista: 0, organici: 0 }`.
- **Prova sul DB locale reale** (convenzione progetto): eseguire le due `groupBy` in read-only
  sul postgres locale e confrontare i conteggi con `SELECT type, count(*)` diretti, per validare
  il filtro di relazione `crmContactMatches: { some: {} }`.
- **Verifica browser** della dashboard (gesto reale): la sezione compare, i numeri tornano, il
  gate `canViewCrmDashboard` resta rispettato.

## Rilascio

- Nessuna migration (feature di sola lettura su modelli esistenti).
- Deploy = commit su `main` + push (Vercel), secondo il processo standard.
