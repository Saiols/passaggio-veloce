# Passaggio Veloce

SaaS B2B che fa da broker digitale tra dealer/commercianti auto e agenzie di pratiche per i passaggi di proprietà di veicoli in Italia.

## Documentazione

- [Riassunto progetto](docs/riassunto-progetto.md)
- [Analisi completa](docs/analisi-progetto.md)
- [Piano di implementazione](docs/piano-implementazione.md)
- [Stack tecnico](docs/stack-tecnico.md)

## 🧪 Demo

URL deploy: **https://passaggio-veloce-piattaforma.vercel.app** (in attivazione)

### Account demo precostituiti

Password unica: `DemoPass2026!`

| Email | Ruolo | Note |
|---|---|---|
| `admin@demo.passaggioveloce.it` | Admin piattaforma | Accesso a `/admin/demo-control` |
| `dealer@demo.passaggioveloce.it` | Dealer admin | Saldo wallet 1.250€, può richiedere payout |
| `dealer-junior@demo.passaggioveloce.it` | Dealer utente secondario | Per testare multi-utente |
| `agenzia@demo.passaggioveloce.it` | Agenzia admin | 16 valutazioni storiche, rating 4.5⭐ |

### Modalità DEMO

In modalità DEMO (env `DEMO_MODE=true`):
- **Email**: simulate, visibili in `/admin/demo-control` (Inbox Demo) — niente Resend
- **OCR libretto**: dati generati deterministicamente da hash buffer
- **Pagamenti**: simulati via `MockPaymentProvider`, processati manualmente da `/admin/demo-control` → "Esegui job"
- **Auto-addebito firma**: 5 minuti (anziché 20 giorni in produzione)
- **Solleciti pratiche**: 5 minuti (anziché 5 giorni)
- **Storage documenti**: Vercel Blob (in produzione/staging) o filesystem locale (dev)
- **Verifica email**: auto-completata alla registrazione, link comunque mostrato in pagina

### Procedura primo deploy

1. Setup Neon Postgres + Vercel Blob (vedi `docs/superpowers/specs/2026-04-25-demo-ready-design.md`)
2. Variabili d'ambiente Vercel: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `STORAGE_PROVIDER=vercel-blob`, `EMAIL_PROVIDER=console`, `OCR_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, `DEMO_MODE=true`
3. Migrazioni: `DATABASE_URL=<neon-direct> DIRECT_URL=<neon-direct> pnpm --filter @pv/db prisma migrate deploy`
4. Seed: `DATABASE_URL=<neon-direct> DIRECT_URL=<neon-direct> STORAGE_PROVIDER=vercel-blob BLOB_READ_WRITE_TOKEN=<token> pnpm --filter @pv/db db:seed`

## Quick start (locale)

Requisiti: Node.js 22+, pnpm 10+, Docker.

```bash
docker compose up -d   # Postgres locale
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev               # http://localhost:3000
```

Login con utenti seed dev (`admin@passaggioveloce.it` / `DevPass123!`) o crea il tuo via `/register`.

## Struttura monorepo

```
apps/
  piattaforma/   # Next.js - dealer + agenzia + admin
  crm-interno/   # Next.js - team Sales
packages/
  db/            # Prisma schema
  ui/            # shadcn/ui condivisi
  email/         # template React Email
  lib/           # utility e schemi Zod condivisi
  config/        # config condivisi (eslint, tsconfig)
```

## Team

- **Alberto De Vivo** — Fondatore Strategico
- **Andrea Saino** — CEO
- **Francesco Sioli** — CTO
