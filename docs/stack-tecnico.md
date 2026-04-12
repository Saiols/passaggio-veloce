# Passaggio Veloce - Stack Tecnico e Specifiche di Implementazione

> Documento di riferimento rapido sullo stack scelto, motivazioni, e convenzioni.
> Ultimo aggiornamento: 2026-04-12

---

## 1. Visione tecnica generale

Passaggio Veloce è un SaaS B2B web-only. Niente app mobile native (responsive web sufficiente). Architettura monolitica modulare in fase MVP, splittabile in servizi solo se/quando il volume lo giustificherà. Priorità: velocità di sviluppo, type-safety end-to-end, zero-ops in fase iniziale.

---

## 2. Stack tecnologico

### 2.1 Linguaggio e framework principale
| Componente | Scelta | Versione | Motivazione |
|-----------|--------|----------|-------------|
| Linguaggio | **TypeScript** | 5.x | Type-safety end-to-end (DB → API → UI) |
| Framework | **Next.js** | 15 (App Router) | Frontend + backend in unico progetto, React Server Components, Server Actions, ottimo DX |
| Runtime | **Node.js** | 22 LTS | LTS aggiornato |
| Package manager | **pnpm** | 10.x | Veloce, efficiente con monorepo, lockfile deterministico |
| Build orchestrator | **Turborepo** | latest | Build cache, gestione monorepo, task graph |

### 2.2 Database e ORM
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Database | **PostgreSQL 16** | Standard relazionale, JSON nativo, full-text search |
| ORM | **Prisma** 5.x | Type-safety, migrazioni versionate, DX eccellente |
| Provider hosted | **Neon** (preferito) o Supabase | Serverless Postgres con branching, ottimo per dev/staging |

### 2.3 Auth e sicurezza
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Auth | **Auth.js (NextAuth v5)** | Standard de-facto Next.js, supporta credentials + magic link + OAuth futuri |
| Hash password | **argon2id** | Più sicuro di bcrypt, raccomandato OWASP |
| Sessioni | JWT firmati + refresh token | Stateless, scalabile |
| 2FA | TOTP (futuro) | Implementabile con `otplib` |
| RBAC | Custom su tabella `roles` + middleware Next.js | Multi-utente azienda + ruoli CRM (6 livelli) |

### 2.4 UI e frontend
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| CSS | **Tailwind CSS** 4.x | Utility-first, no CSS-in-JS overhead |
| Componenti | **shadcn/ui** | Componenti accessibili, copia-incolla, full ownership |
| Form | **React Hook Form** + **Zod** | Validazione type-safe condivisa client/server |
| Tabelle | **TanStack Table** | Standard per tabelle ricche (admin) |
| Icone | **Lucide React** | Set coerente con shadcn |
| Date | **date-fns** + **date-fns-tz** | Lightweight, tree-shakeable, gestione timezone |
| Toast | **sonner** | Integrato con shadcn |

### 2.5 Storage documenti
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Object storage | **AWS S3** o **Cloudflare R2** | R2 più economico (no egress fees), API S3-compatibile |
| Encryption at rest | SSE-S3 / SSE-KMS | Obbligo GDPR per documenti sensibili |
| Upload diretto | Presigned URL | Evita carico backend, upload client → S3 |
| Antivirus | **ClamAV** server-side post-upload (futuro) | Precauzione su file da terzi |

### 2.6 IA, OCR, validazione documenti
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| OCR libretto strutturato | **Google Document AI** (Custom Extractor) | Più preciso su documenti italiani strutturati |
| Classificazione documenti | **GPT-4o Vision** o **Claude Sonnet 4.6 Vision** | Verifica "questa è davvero una CI?" |
| Fallback manuale | UI di correzione | Sempre necessario per OCR |
| Validazione documenti | Pipeline custom: classificazione → estrazione → check completezza | Killer feature, blocca invio pratiche incomplete |

> **Decisione rimandata:** benchmark Document AI vs Textract vs claude/openai diretto su set di libretti reali, prima di finalizzare provider.

### 2.7 Pagamenti
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Provider | **Stripe** | SEPA Direct Debit, Connect per payout, fatturazione integrata |
| Addebiti agenzie | Stripe SEPA + mandato firmato in registrazione | Auto-addebito al giorno 20 |
| Wallet broker | Stripe Connect Custom | Gestione saldi, payout manuali e automatici |
| Webhook | Endpoint dedicato `/api/webhooks/stripe` con verifica firma | Sincronizzazione eventi |

> **Da validare con commercialista** prima dello sviluppo del modulo pagamenti.

### 2.8 Email transazionale
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Provider | **Resend** | DX eccellente, template React, prezzo competitivo |
| Template | **React Email** | Componenti React per email, anteprima dev |
| Domini | SPF + DKIM + DMARC su `passaggioveloce.it` | Deliverability |

### 2.9 Scheduler e job ricorrenti
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Cron jobs | **Vercel Cron** in fase MVP | Zero ops, integrato |
| Code asincrone | **Inngest** o **Trigger.dev** se servono workflow complessi | Da valutare quando il volume cresce |

Job previsti:
- Sollecito broker ogni 5 giorni (N3)
- Auto-addebito agenzia al giorno 20 (N8)
- Payout automatico wallet ≥1000 EUR (N5)
- Avanzamento round fallback (vedi piano-implementazione.md §0.5, futuro)

### 2.10 Mappe e geocoding
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Geocoding | **Google Maps API** o **Mapbox** | Ricerca comuni, calcolo distanze raggi fallback |
| Visualizzazione | Mapbox GL JS o Google Maps embed | Da decidere in base a costi |

### 2.11 Fatturazione elettronica SDI
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Provider | **Fatture in Cloud API** o **Aruba Fatturazione** | Decisione rimandabile a Fase 5 |

### 2.12 Hosting e infrastruttura
| Componente | Scelta MVP | Migrazione futura |
|-----------|-----------|-------------------|
| App | **Vercel** | AWS ECS / Fly.io quando volume cresce |
| Database | **Neon** | RDS Postgres |
| Storage | **Cloudflare R2** o S3 | S3 |
| DNS | **Cloudflare** | — |
| Email | Resend | — |

### 2.13 Monitoring, logging, observability
| Componente | Scelta | Motivazione |
|-----------|--------|-------------|
| Error tracking | **Sentry** | Standard, integrazione Next.js nativa |
| Logging | **pino** + Vercel logs | Strutturato, leggero |
| Analytics prodotto | **PostHog** (self-hosted o cloud) | Open source, privacy-friendly |
| Uptime | **Better Uptime** o **UptimeRobot** | Monitoring esterno |

### 2.14 Testing
| Tipo | Tool | Quando |
|------|------|--------|
| Unit | **Vitest** | Logica pura (algoritmo distribuzione, calcoli wallet) |
| Integration | **Vitest** + Prisma test DB | API routes, server actions |
| E2E | **Playwright** | Flussi critici (registrazione, invio pratica, accettazione) |
| Test IA/OCR | Set di documenti reali anonimizzati | Validazione gating documentale |

### 2.15 Code quality
| Tool | Scopo |
|------|-------|
| **ESLint** + `@typescript-eslint` | Linting |
| **Prettier** | Formatting |
| **TypeScript strict mode** | Massima safety |
| **Husky** + **lint-staged** | Hook pre-commit |
| **commitlint** + Conventional Commits | Standard messaggi commit |

---

## 3. Architettura repository

### 3.1 Struttura monorepo

```
passaggio-veloce/
├── apps/
│   ├── piattaforma/        # Next.js - dealer + agenzia + admin (passaggioveloce.it)
│   └── crm-interno/        # Next.js - team Sales (crm.passaggioveloce.it)
├── packages/
│   ├── db/                 # Prisma schema condiviso, client esportato
│   ├── ui/                 # Componenti shadcn condivisi
│   ├── email/              # Template React Email condivisi
│   ├── lib/                # Utility condivise (validazione Zod, helpers)
│   └── config/             # eslint, tsconfig, tailwind preset condivisi
├── docs/                   # Documentazione progetto
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── README.md
```

### 3.2 Convenzioni
- **Branching:** trunk-based con `main` protetto, feature branch `feat/`, fix `fix/`, refactor `refactor/`
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)
- **Naming file:** kebab-case per file e cartelle, PascalCase per componenti React
- **Server vs Client components:** Server di default, `'use client'` solo dove serve interattività
- **Server Actions:** preferite a API routes quando l'azione è chiamata da UI; API routes per webhook esterni
- **Validazione:** Zod schemas condivisi tra client e server (package `@pv/lib`)
- **Errori:** mai lanciare stringhe, sempre Error tipizzati; mai esporre stack trace al client

### 3.3 Variabili d'ambiente
- `.env.example` versionato, `.env.local` ignorato
- Validate runtime con Zod (`@t3-oss/env-nextjs`)
- Segreti produzione su Vercel encrypted env vars

---

## 4. Modello dati - principi

- **PostgreSQL** con schema normalizzato
- **Soft delete** su entità sensibili (utenti, pratiche) con campo `deleted_at`
- **Audit trail** su entità critiche (pratiche, transazioni wallet, addebiti)
- **UUID v7** come primary key (ordinati nel tempo, indicizzabili)
- **Timestamps** `created_at` / `updated_at` automatici via Prisma
- **Tenant separation:** ogni record collegato a `company_id`, query sempre filtrate
- **Index** su tutte le foreign key e sui campi di ricerca frequente

Schema dettagliato in `packages/db/prisma/schema.prisma` (in costruzione).

---

## 5. Sicurezza e GDPR

- **HTTPS obbligatorio**, HSTS abilitato
- **CSP headers** restrittive
- **Rate limiting** su login, upload, API pubbliche (Upstash Redis o Vercel KV)
- **Input validation** sempre con Zod prima di toccare DB
- **SQL injection:** impossibile via Prisma (parametrizzazione automatica)
- **XSS:** React escape automatico, no `dangerouslySetInnerHTML` su input utente
- **CSRF:** Auth.js gestisce token CSRF
- **Encryption at rest:** documenti su S3/R2 con SSE
- **Data retention:** documenti pratica conservati N anni post-completamento (TBD legale)
- **DPA con fornitori:** Vercel, Neon, Stripe, Resend, AWS/Cloudflare, Google
- **Backup:** snapshot DB giornalieri con retention 30 giorni
- **Audit log:** ogni accesso a dati sensibili tracciato

---

## 6. Decisioni rimandate / da approfondire

| # | Decisione | Quando |
|---|-----------|--------|
| D1 | S3 vs Cloudflare R2 | Prima di Fase 3 (storage) |
| D2 | Document AI vs Textract vs Vision LLM | Benchmark prima di Fase 3.3 |
| D3 | Fatture in Cloud vs Aruba SDI | Prima di Fase 5.3 |
| D4 | Inngest vs Vercel Cron puro | Prima di Fase 6 |
| D5 | Mapbox vs Google Maps | Prima di Fase 4 |
| D6 | PostHog cloud vs self-hosted | Prima del lancio |
| D7 | Migrazione hosting da Vercel | Quando i costi lo giustificano (post-MVP) |

---

## 7. Comandi rapidi

```bash
# Installa dipendenze
pnpm install

# Dev (tutti gli apps)
pnpm dev

# Dev solo piattaforma
pnpm --filter piattaforma dev

# Build
pnpm build

# Lint
pnpm lint

# Type check
pnpm typecheck

# Migrazioni DB
pnpm --filter @pv/db prisma migrate dev
pnpm --filter @pv/db prisma studio
```

---

## 8. Risposte rapide (FAQ tecnica per stakeholder)

**Q: Perché Next.js e non Spring/Django/Rails?**
A: Team piccolo, time-to-market critico, type-safety end-to-end, zero context switching tra frontend e backend, ottimo ecosistema serverless.

**Q: Perché monorepo?**
A: Piattaforma e CRM interno condividono modello dati, componenti UI, template email. Monorepo evita duplicazione e tiene tutto coerente.

**Q: Perché PostgreSQL e non MongoDB?**
A: Dominio relazionale (utenti, aziende, pratiche, transazioni, wallet), ACID necessario per pagamenti, JSON nativo Postgres copre i casi semi-strutturati.

**Q: Cosa succede se Vercel diventa troppo caro?**
A: Next.js si autodeploya ovunque (Docker, Node server, AWS, Fly.io). La migrazione è prevista come opzione futura, non blocca nulla.

**Q: Come gestiamo la scalabilità?**
A: Postgres + Next.js scalano serenamente fino a milioni di richieste/giorno con i provider scelti. Quando arriveremo a problemi di scala saremo grati di averli.

**Q: Il codice è proprietario?**
A: Sì, repository privato. Nessuna dipendenza copyleft (GPL) usata: solo MIT/Apache/BSD.
