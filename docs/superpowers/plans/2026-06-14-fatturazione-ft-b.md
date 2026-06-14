# Fatturazione — Fase FT-B (sezioni "Fatture" + cross-ref + ricerca) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Sezioni "Fatture" per agenzia, broker e admin, con liste dei documenti, riferimento bidirezionale pratica↔documento, vista dettaglio documento e ricerca/filtri. (PDF/XML → fase FT-D.)

**Architecture:** Pagina `/fatturazione` role-adaptive (agenzia = FATTURA_PV ricevute; broker = DOC_BROKER emessi), `/fatturazione/[id]` dettaglio documento access-controlled, `/admin/fatturazione` lista globale. Voce nav "Fatture". Blocco "Documenti fiscali" nel dettaglio pratica. Dati da `DocumentoFiscale` (FT-A).

**Tech Stack:** Next.js App Router (server components), Prisma, TypeScript, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-14-fatturazione-completa-design.md`

---

## Task 1: Helper formato documento

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/format.ts`
- Test: `apps/piattaforma/src/lib/fatturazione/format.test.ts`

- [ ] **Step 1: Test**
```ts
import { describe, it, expect } from 'vitest';
import { numeroDocumento, labelTipoDocumento } from './format';

describe('numeroDocumento', () => {
  it('formatta numero/anno', () => {
    expect(numeroDocumento({ numeroProgressivo: 7, anno: 2026 })).toBe('7/2026');
  });
});
describe('labelTipoDocumento', () => {
  it('mappa i tipi', () => {
    expect(labelTipoDocumento('FATTURA_PV')).toBe('Fattura');
    expect(labelTipoDocumento('DOC_BROKER')).toBe('Compenso intermediazione');
    expect(labelTipoDocumento('NOTA_VARIAZIONE')).toBe('Nota di credito');
    expect(labelTipoDocumento('PENALE_BROKER')).toBe('Penale');
  });
});
```

- [ ] **Step 2: Implementazione**
```ts
import type { DocumentoFiscaleTipo } from '@pv/db';

export function numeroDocumento(d: { numeroProgressivo: number; anno: number }): string {
  return `${d.numeroProgressivo}/${d.anno}`;
}

const LABELS: Record<DocumentoFiscaleTipo, string> = {
  FATTURA_PV: 'Fattura',
  DOC_BROKER: 'Compenso intermediazione',
  NOTA_VARIAZIONE: 'Nota di credito',
  PENALE_BROKER: 'Penale',
};
export function labelTipoDocumento(tipo: DocumentoFiscaleTipo): string {
  return LABELS[tipo];
}
```

- [ ] **Step 3: Run test → PASS** (`pnpm test -- fatturazione/format`). **Step 4: Commit**
```bash
git add apps/piattaforma/src/lib/fatturazione/format.ts apps/piattaforma/src/lib/fatturazione/format.test.ts
git commit -m "feat(fatturazione): helper formato numero/tipo documento (testato)"
```

---

## Task 2: Pagina `/fatturazione` (agenzia + broker, role-adaptive) + ricerca

**Files:**
- Create: `apps/piattaforma/src/app/fatturazione/page.tsx`

Server component. `auth()`; redirect login se assente. Legge `searchParams.q` (ricerca). Per ruolo:
- **AGENZIA**: `documentoFiscale.findMany({ where: { destinatarioCompanyId: agenziaId, ...(q ? OR su numero/pratica.codicePratica) }, include: { pratica: { select: { id, codicePratica } } }, orderBy: { emessoAt: 'desc' } })`. Colonne: data (`formatDate(emessoAt)`), n° (`numeroDocumento`), tipo (`labelTipoDocumento`), **codice pratica → `<Link href="/pratiche/[id]">`**, lordo (`formatCurrencyCent`), stato pagamento. Importi negativi (note credito) in rosso.
- **DEALER (broker)**: `where: { emittenteCompanyId: brokerId }, include: { payout: { select: { id, eseguitoAt, transazioni: { where: { tipo: 'CREDITO_PRATICA' }, select: { praticaId } } } } }`. Colonne: data, n°, "N pratiche", importo, stato SDI (`trasmessoSdiAt ? 'Trasmesso' : 'Non trasmesso'`). Riga → `<Link href="/fatturazione/[id]">`.
- Altri ruoli → messaggio "non disponibile".
- Header con campo **ricerca** (form GET `?q=`) per codice pratica / n° documento. Empty state.
- Avvolta in `AppShell activePath="/fatturazione"`.

- [ ] Implementare la pagina (codice completo seguendo i pattern di `/feedback` e `/pratiche`).
- [ ] Typecheck → commit:
```bash
git add apps/piattaforma/src/app/fatturazione/page.tsx
git commit -m "feat(fatturazione): pagina /fatturazione (agenzia + broker) con ricerca e cross-ref pratica"
```

---

## Task 3: Dettaglio documento `/fatturazione/[id]`

**Files:**
- Create: `apps/piattaforma/src/app/fatturazione/[id]/page.tsx`

Server component. Carica il documento con `emittenteCompany`/`destinatarioCompany`, `pratica` (id, codicePratica), `payout` (+ transazioni CREDITO_PRATICA con pratica id/codice), `notaVariazionePer`/`notaVariazioneFiglie`. **Access control**: admin, oppure session.companyId ∈ {emittenteCompanyId, destinatarioCompanyId}; altrimenti `notFound()`.
Render: intestazione (tipo + n° + data + stato), **emittente/destinatario** dallo snapshot (`datiEmittente`/`datiDestinatario`: ragione sociale, P.IVA, indirizzo, SDI/PEC), importi (imponibile/IVA/lordo), e i **riferimenti**:
- FATTURA_PV → link alla **pratica** (`/pratiche/[id]`).
- DOC_BROKER → **elenco pratiche** del payout (ognuna → link dettaglio) + data payout.
- NOTA_VARIAZIONE → link al documento originale.
Avvolto in `AppShell activePath="/fatturazione"`.

- [ ] Implementare. Typecheck → commit:
```bash
git add "apps/piattaforma/src/app/fatturazione/[id]/page.tsx"
git commit -m "feat(fatturazione): dettaglio documento con snapshot, importi e riferimenti pratica/payout"
```

---

## Task 4: Admin `/admin/fatturazione` (lista globale + ricerca/filtri)

**Files:**
- Create: `apps/piattaforma/src/app/admin/fatturazione/page.tsx`

Server component. Guard `isAdminPiattaforma`. Lista **tutti** i documenti (paginazione semplice/limit 100), filtri per tipo (FATTURA_PV/DOC_BROKER/NOTA_VARIAZIONE) e ricerca `?q` (numero o codice pratica), con emittente/destinatario (ragione sociale dallo snapshot), importo, data, link a `/fatturazione/[id]` e alla pratica. Avvolta in `AdminShell` (via AppShell early-return admin).

- [ ] Implementare. Typecheck → commit:
```bash
git add apps/piattaforma/src/app/admin/fatturazione/page.tsx
git commit -m "feat(fatturazione): admin /admin/fatturazione lista globale + ricerca/filtri"
```

---

## Task 5: Voce nav "Fatture" + blocco nel dettaglio pratica

**Files:**
- Modify: `apps/piattaforma/src/components/app-shell.tsx` (nav agenzia + broker)
- Modify: `apps/piattaforma/src/components/admin/admin-shell.tsx` (NAV_GROUPS)
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx` (blocco "Documenti fiscali")

- [ ] **Step 1: Nav broker + agenzia** — in `getNavLinks`, aggiungere `{ href: '/fatturazione', label: 'Fatture' }` ai due rami (AGENZIA dopo "Feedback"/"Wallet"; DEALER dopo "Wallet").
- [ ] **Step 2: Nav admin** — in `NAV_GROUPS`, gruppo "Panoramica", dopo "Finanze": `{ href: '/admin/fatturazione', label: 'Fatture', icon: IconFinance, adminOnly: true }`.
- [ ] **Step 3: Dettaglio pratica** — caricare `pratica.documentiFiscali` (id, tipo, numeroProgressivo, anno, importoLordoCent) nella query della pagina; renderizzare un blocco "Documenti fiscali" con i documenti (link a `/fatturazione/[id]`). Se vuoto, nessun blocco.
- [ ] Typecheck → commit:
```bash
git add apps/piattaforma/src/components/app-shell.tsx apps/piattaforma/src/components/admin/admin-shell.tsx "apps/piattaforma/src/app/pratiche/[id]/page.tsx"
git commit -m "feat(fatturazione): voce nav Fatture + blocco documenti fiscali nel dettaglio pratica"
```

---

## Task 6: Verifica finale FT-B
- [ ] `pnpm test` verde · `pnpm typecheck` (app) verde · `pnpm build` OK (route /fatturazione, /fatturazione/[id], /admin/fatturazione presenti).
- [ ] Manuale: dopo una firma/payout (dati FT-A), l'agenzia vede la FATTURA_PV con link pratica; il broker vede il DOC_BROKER con le pratiche; admin vede tutto; ricerca per codice pratica/n°; dal dettaglio pratica si raggiunge il documento e viceversa.

## Self-Review (coverage)
- Sezioni Fatture agenzia/broker/admin → Task 2/4 ✓
- Cross-ref bidirezionale (doc→pratica, pratica→doc) → Task 2/3/5 ✓
- Ricerca per codice pratica / n° documento → Task 2/4 ✓
- Dettaglio documento ricostruibile (snapshot + importi + riferimenti) → Task 3 ✓
- Voce nav per i 3 ruoli → Task 5 ✓
- PDF/XML/SDI → fuori FT-B (FT-D) ✓
