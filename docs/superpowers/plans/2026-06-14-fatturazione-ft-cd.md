# Fatturazione — Fasi FT-C + FT-D (parte sotto nostro controllo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Admin KPI + export CSV (FT-C) e, di FT-D, le parti che dipendono da noi: PDF del documento on-the-fly e azione "segna trasmesso SDI" (broker). L'XML FatturaPA + trasmissione SDI restano in standby (dipendono dal commercialista, B1).

**Architecture:** KPI/aggregati da `DocumentoFiscale` nel pannello admin + route CSV; PDF generato on-demand con pdf-lib in un route handler access-controlled; server action per il flag SDI.

**Tech Stack:** Next.js (route handler, server actions), Prisma, pdf-lib, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-14-fatturazione-completa-design.md`

---

## Task 1: FT-C — KPI admin + export CSV

**Files:**
- Modify: `apps/piattaforma/src/app/admin/fatturazione/page.tsx` (KPI cards)
- Create: `apps/piattaforma/src/app/api/admin/fatturazione/export/route.ts` (CSV)

- [ ] **Step 1: KPI cards** — nella pagina admin, prima della lista, calcolare aggregati con `prisma.documentoFiscale.aggregate`/`groupBy` (rispettando filtri q/tipo):
  - Fatture PV: count + Σ imponibile + Σ IVA (where tipo FATTURA_PV).
  - Documenti broker: count + Σ lordo (tipo DOC_BROKER).
  - Note di credito: count + Σ lordo (tipo NOTA_VARIAZIONE, negativo).
  Render come `StatCard`/`Card` ("Flussi — documenti emessi"), etichettati come dati documentali (la P&L definitiva è del commercialista, B1).
- [ ] **Step 2: Export CSV** — route `GET /api/admin/fatturazione/export` (admin-only) che ritorna un CSV dei documenti (data, numero, tipo, emittente, destinatario, imponibile, iva, lordo, codice pratica), con `Content-Disposition: attachment; filename="fatture.csv"`. Link "Esporta CSV" nella pagina admin.
- [ ] **Step 3: Typecheck + commit**
```bash
git add apps/piattaforma/src/app/admin/fatturazione/page.tsx apps/piattaforma/src/app/api/admin/fatturazione/export/route.ts
git commit -m "feat(fatturazione): KPI admin + export CSV (FT-C)"
```

---

## Task 2: FT-D — PDF documento on-the-fly

**Files:**
- Create: `apps/piattaforma/src/lib/fatturazione/pdf.ts` (builder pdf-lib)
- Create: `apps/piattaforma/src/app/api/fatturazione/[id]/pdf/route.ts` (route)
- Modify: `apps/piattaforma/src/app/fatturazione/[id]/page.tsx` (link "Scarica PDF")

- [ ] **Step 1: Builder `buildDocumentoPdf`** — funzione che, dato il documento + snapshot emittente/destinatario + importi + riferimenti, produce un `Uint8Array` PDF A4 con pdf-lib: intestazione (tipo + n° + data), blocco emittente/destinatario, tabella riga (descrizione + imponibile/IVA/totale), totale, dicitura regime (se forfettario: "Operazione senza IVA art. 1 c.54-89 L.190/2014"). Layout semplice (StandardFonts.Helvetica).
- [ ] **Step 2: Route** `GET /api/fatturazione/[id]/pdf` — `auth()`; carica il documento; **access control** identico al dettaglio (admin / emittente / destinatario); genera il PDF; `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="<numero>-<tipo>.pdf"`.
- [ ] **Step 3: Link** — nel dettaglio `/fatturazione/[id]` aggiungere "Scarica PDF" → `/api/fatturazione/[id]/pdf`.
- [ ] **Step 4: Typecheck + commit**
```bash
git add apps/piattaforma/src/lib/fatturazione/pdf.ts "apps/piattaforma/src/app/api/fatturazione/[id]/pdf/route.ts" "apps/piattaforma/src/app/fatturazione/[id]/page.tsx"
git commit -m "feat(fatturazione): PDF documento on-the-fly (pdf-lib) + download (FT-D)"
```

---

## Task 3: FT-D — "Segna trasmesso SDI" (broker)

**Files:**
- Create: `apps/piattaforma/src/app/fatturazione/actions.ts` (server action)
- Create: `apps/piattaforma/src/app/fatturazione/[id]/segna-trasmesso-button.tsx` (client)
- Modify: `apps/piattaforma/src/app/fatturazione/[id]/page.tsx` (mostra stato + bottone)

- [ ] **Step 1: Action** `segnaTrasmessoSdiAction(documentoId)` — `auth()`; carica il documento; consentita solo se `tipo === 'DOC_BROKER'` e `emittenteCompanyId === session.companyId` (il broker); imposta `trasmessoSdiAt = now`, `trasmessoSdiBy = userId`; `revalidatePath`. Ritorna `{ ok }`.
- [ ] **Step 2: Bottone client** con `useTransition` + toast su successo (riusa `useToast`); visibile solo al broker emittente quando `trasmessoSdiAt` è null.
- [ ] **Step 3: Dettaglio** — mostrare lo stato SDI (Trasmesso il … / Non trasmesso) e, per il broker emittente, il bottone.
- [ ] **Step 4: Typecheck + commit**
```bash
git add apps/piattaforma/src/app/fatturazione/actions.ts "apps/piattaforma/src/app/fatturazione/[id]/segna-trasmesso-button.tsx" "apps/piattaforma/src/app/fatturazione/[id]/page.tsx"
git commit -m "feat(fatturazione): segna trasmesso SDI (broker) sul documento (FT-D)"
```

---

## Task 4: Verifica finale
- [ ] `pnpm test` verde · `pnpm typecheck` verde · `pnpm build` OK (route /api/fatturazione/[id]/pdf, /api/admin/fatturazione/export).
- [ ] Manuale: admin vede KPI + esporta CSV; scarica il PDF di un documento; il broker segna "trasmesso" e lo stato si aggiorna.

## Standby (NON in questo round — dipende dal commercialista B1)
- XML FatturaPA (TD01/TD06/TD04) e trasmissione SDI automatica: correttezza fiscale da validare con commercialista prima di costruirli.

## Self-Review
- FT-C KPI + CSV → Task 1 ✓ · FT-D PDF → Task 2 ✓ · FT-D segna trasmesso → Task 3 ✓ · XML deferito (B1) ✓
