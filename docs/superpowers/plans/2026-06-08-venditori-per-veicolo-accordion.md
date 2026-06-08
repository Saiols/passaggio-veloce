# Venditori per-veicolo + accordion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans. Step con checkbox (`- [ ]`).

**Goal:** Nei passaggi multipli i venditori sono organizzati per veicolo (accordion), legati al veicolo nel DB, con "aggiungi co-intestatario" per veicolo e cross-check per-veicolo.

**Architecture:** `Venditore.veicoloId` (migration additiva). Wizard: ogni `VenditoreInput` ha `veicoloOrdine`; rigenerazione automatica per-veicolo (no dedup) dagli intestatari del rispettivo libretto; accordion solo per multiplo. Cross-check e submit per-veicolo. Engine/parte-docs invariati.

**Tech Stack:** Next 16, React 19, Prisma/Postgres (Neon), Vitest. Spec: `docs/superpowers/specs/2026-06-08-venditori-per-veicolo-accordion-design.md`.

---

## File structure
- MOD `packages/db/prisma/schema.prisma` — `Venditore.veicoloId` + relazione; `Veicolo.venditori`.
- NEW `packages/db/prisma/migrations/20260608120000_venditore_veicolo/migration.sql` — ADD COLUMN + FK + index.
- MOD `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — `veicoloOrdine`, rigenerazione per-veicolo, add per veicolo, accordion, cross-check per-veicolo, submit payload.
- MOD `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — `venditoreSchema.veicoloOrdine`, persistenza `veicoloId`, cross-check per-veicolo.
- NEW `apps/piattaforma/src/app/pratiche/nuova/venditori-per-veicolo.ts` — helper PURI (rigenerazione + cross-check per-veicolo) + test.

---

## Task 1: Migration `Venditore.veicoloId`

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260608120000_venditore_veicolo/migration.sql`

- [ ] **Step 1: Schema** — nel model `Venditore` aggiungi dopo `praticaId`/relazione:

```prisma
  veicoloId String? @db.Uuid
  veicolo   Veicolo? @relation("VeicoloVenditori", fields: [veicoloId], references: [id], onDelete: SetNull)
```
e `@@index([veicoloId])`. Nel model `Veicolo` aggiungi: `venditori Venditore[] @relation("VeicoloVenditori")`.

- [ ] **Step 2: Migration SQL**

```sql
ALTER TABLE "venditori" ADD COLUMN "veicoloId" UUID;
CREATE INDEX "venditori_veicoloId_idx" ON "venditori"("veicoloId");
ALTER TABLE "venditori" ADD CONSTRAINT "venditori_veicoloId_fkey" FOREIGN KEY ("veicoloId") REFERENCES "veicoli"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3:** `pnpm --filter @pv/db db:generate` → typecheck. Commit (schema + migration). NON applicare a prod ora (deploy in blocco).

---

## Task 2: Helper puri per-veicolo + test

**Files:** NEW `apps/piattaforma/src/app/pratiche/nuova/venditori-per-veicolo.ts` (+ `.test.ts`)

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { intestatariPerVeicolo, crossCheckPerVeicolo } from './venditori-per-veicolo';

const v1 = { ocr: { proprietariInfo: [
  { isPersonaGiuridica: false, cognome: 'ROSSI', nome: 'MARIO', display: 'ROSSI MARIO' },
  { isPersonaGiuridica: false, cognome: 'ROSSI', nome: 'LUCIA', display: 'ROSSI LUCIA' },
] } };
const v2 = { ocr: { proprietariInfo: [
  { isPersonaGiuridica: true, ragioneSociale: 'ACME SRL', piva: '12345678901', display: 'ACME SRL' },
] } };

describe('intestatariPerVeicolo', () => {
  it('un venditore per intestatario di ciascun veicolo, taggato veicoloOrdine', () => {
    const r = intestatariPerVeicolo([v1 as any, v2 as any]);
    expect(r.map((x) => x.veicoloOrdine)).toEqual([1, 1, 2]);
    expect(r[0]).toMatchObject({ cognome: 'ROSSI', nome: 'MARIO', isPersonaGiuridica: false, veicoloOrdine: 1 });
    expect(r[2]).toMatchObject({ ragioneSociale: 'ACME SRL', piva: '12345678901', isPersonaGiuridica: true, veicoloOrdine: 2 });
  });
});

describe('crossCheckPerVeicolo', () => {
  it('OK se ogni veicolo combacia', () => {
    const venditori = [
      { veicoloOrdine: 1, isPG: false, nome: 'MARIO', cognome: 'ROSSI' },
      { veicoloOrdine: 2, isPG: true, ragioneSociale: 'ACME SRL' },
    ];
    const proprietariPerVeicolo = { 1: ['ROSSI MARIO'], 2: ['ACME SRL'] };
    expect(crossCheckPerVeicolo(venditori as any, proprietariPerVeicolo)).toBe('OK');
  });
  it('MISMATCH se un veicolo non combacia', () => {
    const venditori = [{ veicoloOrdine: 1, isPG: false, nome: 'LUCA', cognome: 'BIANCHI' }];
    expect(crossCheckPerVeicolo(venditori as any, { 1: ['ROSSI MARIO'] })).toBe('MISMATCH');
  });
});
```

- [ ] **Step 2:** verifica fallimento (`pnpm --filter piattaforma test -- venditori-per-veicolo`).

- [ ] **Step 3: Implementazione**

```ts
import type { OwnerInfo } from '@/lib/providers/ocr/types';
import { venditoriCrossCheck } from '@/lib/kyc/match';

export type IntestatarioPrefill = OwnerInfo & { veicoloOrdine: number };

/** Un intestatario-prefill per ciascun proprietario di ciascun veicolo (no dedup),
 * taggato col veicoloOrdine (1..n). */
export function intestatariPerVeicolo(
  veicoli: { ocr?: { proprietariInfo?: OwnerInfo[] } }[],
): IntestatarioPrefill[] {
  const out: IntestatarioPrefill[] = [];
  veicoli.forEach((v, i) => {
    for (const o of v.ocr?.proprietariInfo ?? []) out.push({ ...o, veicoloOrdine: i + 1 });
  });
  return out;
}

type VendMin = {
  veicoloOrdine: number;
  isPG: boolean;
  nome?: string | null;
  cognome?: string | null;
  ragioneSociale?: string | null;
};

/** Cross-check insiemistico applicato PER VEICOLO. 'MISMATCH' se un qualsiasi
 * veicolo (con proprietari noti) non combacia; altrimenti 'OK'. */
export function crossCheckPerVeicolo(
  venditori: VendMin[],
  proprietariPerVeicolo: Record<number, string[]>,
): 'OK' | 'MISMATCH' | 'SCONOSCIUTO' {
  const ordini = new Set(venditori.map((v) => v.veicoloOrdine));
  let qualcheNoto = false;
  for (const ord of ordini) {
    const proprietari = proprietariPerVeicolo[ord] ?? [];
    if (!proprietari.length) continue;
    qualcheNoto = true;
    const gruppo = venditori
      .filter((v) => v.veicoloOrdine === ord)
      .map((v) => ({
        isPersonaGiuridica: v.isPG,
        nome: v.nome ?? undefined,
        cognome: v.cognome ?? undefined,
        ragioneSociale: v.ragioneSociale ?? undefined,
      }));
    if (venditoriCrossCheck(gruppo, proprietari, { flagProcura: false }) === 'MISMATCH') return 'MISMATCH';
  }
  return qualcheNoto ? 'OK' : 'SCONOSCIUTO';
}
```

- [ ] **Step 4:** test verdi. Commit.

---

## Task 3: Wizard — stato `veicoloOrdine` + rigenerazione per-veicolo + add per veicolo

**Files:** `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

- [ ] **Step 1:** `VenditoreInput` → aggiungi `veicoloOrdine: number`. `emptyVenditore(veicoloOrdine = 1)` lo imposta. Stato iniziale `[emptyVenditore(1)]`.
- [ ] **Step 2:** sostituisci l'effect di rigenerazione (oggi unione dedup) con `intestatariPerVeicolo(veicoli)` (da Task 2): firma = lista `display#veicoloOrdine`; quando cambia, `setVenditori(prefill.map((o) => ({ ...emptyVenditore(o.veicoloOrdine), isPG: o.isPersonaGiuridica, tipoSoggetto: o.isPersonaGiuridica ? 'AZIENDA' : null, nome: o.nome ?? '', cognome: o.cognome ?? '', cf: (o.cf ?? '').toUpperCase(), ragioneSociale: o.ragioneSociale ?? '', piva: o.piva ?? '' })))`.
- [ ] **Step 3:** `addVenditore(veicoloOrdine: number)` → append `emptyVenditore(veicoloOrdine)`. `removeVenditore(idx)` invariato.
- [ ] **Step 4:** typecheck. Commit.

---

## Task 4: Wizard — accordion (multiplo) + cross-check per-veicolo

**Files:** `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

- [ ] **Step 1: Cross-check per-veicolo** — costruisci `proprietariPerVeicolo: Record<number,string[]>` da `veicoli[i].ocr?.proprietari ?? [proprietarioAttuale]`. Sostituisci l'attuale `ccVend` (unione) con `crossCheckPerVeicolo(venditori, proprietariPerVeicolo)` per il gate globale, e calcola anche per-veicolo per mostrare l'alert nel gruppo giusto: `ccPerVeicolo[ord] = venditoriCrossCheck(gruppo, proprietariPerVeicolo[ord], {flagProcura:false})`.
- [ ] **Step 2: Render step 2** — se `multiplo`: per ogni veicolo (ordine 1..n) una voce **accordion** (stato aperto/chiuso locale, prima aperta) con header `Veicolo {ordine} — {targa}`; corpo = i `venditori.filter(v=>v.veicoloOrdine===ordine)` renderizzati come ora (blocco venditore: header "Venditore"/"Venditore N", ParteForm, IdentitaSection con i suoi handler, alert `verdettiVenditori[idx]`), + alert cross-check del veicolo (`ccPerVeicolo[ordine]==='MISMATCH'`), + bottone "**+ Aggiungi co-intestatario**" → `addVenditore(ordine)`. Se `!multiplo`: layout attuale invariato (`venditori.map` diretto). NB: gli indici globali `idx` restano quelli dell'array `venditori` (per gli handler `updateVenditore(idx,...)` e gli slot `VEND<idx+1>_*`).
- [ ] **Step 3:** `canStep2` usa il cross-check globale per-veicolo (no MISMATCH) + i gate esistenti (parteValida, identitaPresente, no upload, verdetto.ok per ogni venditore).
- [ ] **Step 4:** typecheck + lint. Commit.

Componente accordion: semplice `useState<number|null>(1)` per la voce aperta (o un Set per multi-open); riusa `Button`/`Alert`. Header cliccabile con chevron.

---

## Task 5: Submit — `veicoloOrdine` + persistenza `veicoloId` + cross-check server

**Files:** `apps/piattaforma/src/app/pratiche/nuova/actions.ts`, `wizard.tsx` (payload)

- [ ] **Step 1:** `venditoreSchema` → aggiungi `veicoloOrdine: z.coerce.number().int().min(1).max(50)`.
- [ ] **Step 2:** `handleFinalSubmit` (wizard) → nel JSON `venditori` includi `veicoloOrdine: v.veicoloOrdine`.
- [ ] **Step 3:** transazione `tx.venditore.create` → `veicoloId: veicoloIdByOrdine.get(v.veicoloOrdine) ?? null`.
- [ ] **Step 4:** cross-check server per-veicolo: costruisci `proprietariPerVeicolo` da `veicoli[i].ocrData?.proprietari` (+ fallback `proprietarioAttuale`), poi `crossCheckPerVeicolo(venditori, proprietariPerVeicolo) === 'MISMATCH'` → redirect blocco (sostituisce l'attuale cross-check unione).
- [ ] **Step 5:** typecheck. Commit.

---

## Task 6: Gate + deploy
- [ ] `pnpm --filter piattaforma typecheck && lint && test && build` tutto verde.
- [ ] Deploy in blocco: **migration su prod** `solitary-night` (`migrate deploy`, additiva) → push main → verifica `/api/version` + E2E.

---

## Self-review
- **Copertura spec:** modello+migration (T1), rigenerazione+cross-check puri (T2), stato+add per veicolo (T3), accordion+cross-check UI (T4), submit+veicoloId+cross-check server (T5), deploy+migration (T6). ✓
- **Placeholder:** nessuno; codice reale nei puri/schema/submit; l'accordion è descritto con struttura esatta (riuso componenti esistenti).
- **Coerenza tipi:** `IntestatarioPrefill` (OwnerInfo + veicoloOrdine), `crossCheckPerVeicolo(VendMin[], Record<number,string[]>)`, `VenditoreInput.veicoloOrdine`, `emptyVenditore(veicoloOrdine)`, `addVenditore(veicoloOrdine)` — coerenti tra T2/T3/T4/T5. Slot `VEND<idx+1>_*` con `idx` globale invariati.
