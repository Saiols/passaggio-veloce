# Passaggio Veloce

SaaS B2B che fa da broker digitale tra dealer/commercianti auto e agenzie di pratiche per i passaggi di proprietà di veicoli in Italia.

## Documentazione

- [Riassunto progetto](docs/riassunto-progetto.md)
- [Analisi completa](docs/analisi-progetto.md)
- [Piano di implementazione](docs/piano-implementazione.md)
- [Stack tecnico](docs/stack-tecnico.md)

## Quick start

Requisiti: Node.js 22+, pnpm 10+.

```bash
pnpm install
pnpm dev
```

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
