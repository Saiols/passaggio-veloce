# Pratica (B): co-intestatari — N venditori + cross-check insiemistico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Supportare N venditori (co-intestatari) per pratica: modello `Venditore[]`, rilevamento N proprietari dal libretto, N form venditore con identità/OCR, e cross-check insiemistico venditori↔proprietari (blocco, relax su procura).

**Architecture:** Mirror del pattern `Veicolo` (modello n-per-pratica, migration con backfill+drop, ripple consumer). Moduli puri (libretto multi-owner, cross-check insiemistico, engine per-venditore, docKey) testati a unità; wizard con N form venditore; action persiste e ricontrolla.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Prisma. **Branch:** feat/tipi-pratica-multiveicolo.

**Spec:** `docs/superpowers/specs/2026-06-06-pratica-cointestatari-design.md`. Processo DB: locale `db push`; prod migration manuale al deploy in blocco. NON eseguire il typecheck globale finché wizard/action/consumer non sono migrati (rosso atteso fino ad allora).

---

### Task B1: Modello `Venditore` + `Documento.venditoreId` + migration

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/20260606140000_cointestatari_venditori/migration.sql`

- [ ] **Step 1:** In `schema.prisma`:
  (a) Nuovo modello `Venditore`:
```prisma
model Venditore {
  id String @id @default(uuid()) @db.Uuid
  praticaId String @db.Uuid
  pratica Pratica @relation(fields:[praticaId],references:[id],onDelete:Cascade)
  ordine Int
  nome String?
  cognome String?
  cf String?
  isPersonaGiuridica Boolean @default(false)
  ragioneSociale String?
  piva String?
  telefono String?
  email String?
  tipoSoggetto TipoSoggetto?
  visuraData DateTime? @db.Date
  permessoData DateTime? @db.Date
  documentoIdentita String?
  documenti Documento[] @relation("DocumentiVenditore")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([praticaId])
  @@map("venditori")
}
```
  (b) In `Pratica`: RIMUOVI i campi venditore denormalizzati (`venditoreNome`, `venditoreCognome`, `venditoreCF`, `venditoreIsPersonaGiuridica`, `venditoreRagioneSociale`, `venditorePIVA`, `venditoreTelefono`, `venditoreEmail`, `venditoreTipoSoggetto`, `venditoreVisuraData`, `venditorePermessoData`). MANTIENI tutti gli `acquirente*`. Aggiungi `venditori Venditore[]`. (Verifica i nomi esatti con la Grep tool prima di rimuovere.)
  (c) In `Documento`: aggiungi `venditoreId String? @db.Uuid` + `venditore Venditore? @relation("DocumentiVenditore", fields:[venditoreId], references:[id], onDelete:SetNull)` + `@@index([venditoreId])`.

- [ ] **Step 2:** `pnpm --filter @pv/db exec prisma db push` (locale; `--accept-data-loss` se richiesto) + `prisma generate`.

- [ ] **Step 3:** Crea la migration prod (verifica i nomi colonna reali; stile come `*_tipi_pratica_multiveicolo`):
```sql
-- Co-intestatari: N venditori per pratica.
CREATE TABLE "venditori" (
  "id" UUID NOT NULL,
  "praticaId" UUID NOT NULL,
  "ordine" INTEGER NOT NULL,
  "nome" TEXT, "cognome" TEXT, "cf" TEXT,
  "isPersonaGiuridica" BOOLEAN NOT NULL DEFAULT false,
  "ragioneSociale" TEXT, "piva" TEXT, "telefono" TEXT, "email" TEXT,
  "tipoSoggetto" "TipoSoggetto",
  "visuraData" DATE, "permessoData" DATE,
  "documentoIdentita" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "venditori_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "venditori_praticaId_idx" ON "venditori"("praticaId");
ALTER TABLE "venditori" ADD CONSTRAINT "venditori_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documenti" ADD COLUMN "venditoreId" UUID;
CREATE INDEX "documenti_venditoreId_idx" ON "documenti"("venditoreId");
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_venditoreId_fkey" FOREIGN KEY ("venditoreId") REFERENCES "venditori"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill 1 venditore/pratica dai campi denormalizzati
INSERT INTO "venditori" ("id","praticaId","ordine","nome","cognome","cf","isPersonaGiuridica","ragioneSociale","piva","telefono","email","tipoSoggetto","visuraData","permessoData","createdAt","updatedAt")
SELECT gen_random_uuid(), p."id", 1, p."venditoreNome", p."venditoreCognome", p."venditoreCF", p."venditoreIsPersonaGiuridica", p."venditoreRagioneSociale", p."venditorePIVA", p."venditoreTelefono", p."venditoreEmail", p."venditoreTipoSoggetto", p."venditoreVisuraData", p."venditorePermessoData", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pratiche" p;

-- Collega i documenti venditore esistenti al venditore della pratica
UPDATE "documenti" d SET "venditoreId" = v."id"
FROM "venditori" v
WHERE v."praticaId" = d."praticaId" AND d."owner" = 'VENDITORE';

-- Droppa le colonne venditore da pratiche
ALTER TABLE "pratiche"
  DROP COLUMN "venditoreNome", DROP COLUMN "venditoreCognome", DROP COLUMN "venditoreCF",
  DROP COLUMN "venditoreIsPersonaGiuridica", DROP COLUMN "venditoreRagioneSociale", DROP COLUMN "venditorePIVA",
  DROP COLUMN "venditoreTelefono", DROP COLUMN "venditoreEmail", DROP COLUMN "venditoreTipoSoggetto",
  DROP COLUMN "venditoreVisuraData", DROP COLUMN "venditorePermessoData";
```
Backfill PRIMA dei drop. NON applicare a prod.
- [ ] **Step 4:** `prisma validate` OK. Commit:
```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606140000_cointestatari_venditori/
git commit -m "feat(db): modello Venditore (co-intestatari) + migration"
```

---

### Task B2: Libretto multi-proprietario (`proprietari[]`)

**Files:** Modify `apps/piattaforma/src/lib/providers/ocr/types.ts` (type `LibrettoCircolazioneData`); Modify `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts` (+ test)

- [ ] **Step 1:** In `types.ts`, aggiungi a `LibrettoCircolazioneData` il campo `proprietari?: string[]` (mantieni `proprietarioAttuale`).
- [ ] **Step 2: Test** — in `libretto-parser.test.ts`:
```ts
it('estrae più proprietari (cointestazione)', () => {
  const r = parseLibrettoText('INTESTATO A ROSSI MARIO\nCOINTESTATARIO BIANCHI LUCA\nA) AB123CD', 0.9);
  expect(r.proprietari).toEqual(['ROSSI MARIO', 'BIANCHI LUCA']);
  expect(r.proprietarioAttuale).toBe('ROSSI MARIO');
});
it('un solo proprietario', () => {
  const r = parseLibrettoText('INTESTATO A ROSSI MARIO\nA) AB123CD', 0.9);
  expect(r.proprietari).toEqual(['ROSSI MARIO']);
});
```
- [ ] **Step 3: Run, FAIL** — `pnpm --filter piattaforma test -- libretto-parser`
- [ ] **Step 4: Implement** — in `parseLibrettoText`, estrai TUTTI i nominativi dopo i marcatori intestatario/cointestatario (regex globale, riga per riga):
```ts
  const owners: string[] = [];
  const ownerRe = /(?:INTESTAT[OA] A|INTESTATARIO|COINTESTATARIO|C1\.1\)?)[^\S\n]*([A-ZÀ-Ù'’]+(?:[^\S\n]+[A-ZÀ-Ù'’]+){1,3})/g;
  let mm: RegExpExecArray | null;
  while ((mm = ownerRe.exec(upper)) !== null) owners.push(mm[1]!.trim());
  const proprietari = owners.length ? Array.from(new Set(owners)) : undefined;
  const proprietarioAttuale = proprietari?.[0];
```
e usa `proprietari` + `proprietarioAttuale` nell'oggetto ritornato.
- [ ] **Step 5: Run, PASS**. Commit:
```
git add apps/piattaforma/src/lib/providers/ocr/types.ts apps/piattaforma/src/lib/providers/ocr/libretto-parser.* && git commit -m "feat(ocr): libretto multi-proprietario (proprietari[])"
```

---

### Task B3: Cross-check insiemistico (`venditoriCrossCheck`)

**Files:** Modify `apps/piattaforma/src/lib/kyc/match.ts` (+ test)

- [ ] **Step 1: Test** — in `match.test.ts`:
```ts
import { venditoriCrossCheck } from './match';
const v = (nome: string, cognome: string) => ({ isPersonaGiuridica: false, nome, cognome });
describe('venditoriCrossCheck', () => {
  it('OK: insieme combacia', () => {
    expect(venditoriCrossCheck([v('Mario','Rossi'), v('Luca','Bianchi')], ['ROSSI MARIO','BIANCHI LUCA'], { flagProcura: false })).toBe('OK');
  });
  it('MISMATCH: proprietario non coperto', () => {
    expect(venditoriCrossCheck([v('Mario','Rossi')], ['ROSSI MARIO','BIANCHI LUCA'], { flagProcura: false })).toBe('MISMATCH');
  });
  it('MISMATCH: venditore estraneo', () => {
    expect(venditoriCrossCheck([v('Mario','Rossi'), v('Anna','Verdi')], ['ROSSI MARIO'], { flagProcura: false })).toBe('MISMATCH');
  });
  it('procura: rilassato (basta un venditore corrispondente)', () => {
    expect(venditoriCrossCheck([v('Mario','Rossi')], ['ROSSI MARIO','BIANCHI LUCA'], { flagProcura: true })).toBe('OK');
  });
  it('SCONOSCIUTO: nessun proprietario estratto', () => {
    expect(venditoriCrossCheck([v('Mario','Rossi')], [], { flagProcura: false })).toBe('SCONOSCIUTO');
  });
});
```
- [ ] **Step 2: Run, FAIL** — `pnpm --filter piattaforma test -- kyc/match`
- [ ] **Step 3: Implement** — in `match.ts` (riusa `proprietarioCrossCheck`/`nameMatches`):
```ts
export function venditoriCrossCheck(
  venditori: { isPersonaGiuridica: boolean; nome?: string; cognome?: string; ragioneSociale?: string }[],
  proprietari: string[],
  opts: { flagProcura: boolean },
): 'OK' | 'MISMATCH' | 'SCONOSCIUTO' {
  if (!proprietari.length) return 'SCONOSCIUTO';
  const matchesOwner = (vend: typeof venditori[number], owner: string) =>
    proprietarioCrossCheck(vend, owner) === 'MATCH';
  if (opts.flagProcura) {
    // basta che almeno un venditore corrisponda a un proprietario
    return venditori.some((vd) => proprietari.some((o) => matchesOwner(vd, o))) ? 'OK' : 'MISMATCH';
  }
  // ogni proprietario coperto da un venditore
  const ownersCovered = proprietari.every((o) => venditori.some((vd) => matchesOwner(vd, o)));
  // nessun venditore estraneo
  const noExtraneous = venditori.every((vd) => proprietari.some((o) => matchesOwner(vd, o)));
  return ownersCovered && noExtraneous ? 'OK' : 'MISMATCH';
}
```
- [ ] **Step 4: Run, PASS**. Commit:
```
git add apps/piattaforma/src/lib/kyc/match.* && git commit -m "feat(kyc): cross-check insiemistico venditori↔proprietari"
```

---

### Task B4: `richiesti` docKey con venditoreOrdine

**Files:** Modify `apps/piattaforma/src/lib/documenti/engine.ts` (type `DocumentoRichiesto`); Modify `apps/piattaforma/src/lib/documenti/richiesti.ts` (+ test)

- [ ] **Step 1:** In `engine.ts`, aggiungi `venditoreOrdine?: number` a `DocumentoRichiesto`.
- [ ] **Step 2: Test** — in `richiesti.test.ts` aggiorna il test `docKey`:
```ts
it('docKey include veicoloOrdine e venditoreOrdine', () => {
  expect(docKey({ tipo:'VISURA_CAMERALE', parte:'VENDITORE', motivo:'', venditoreOrdine: 2 })).toBe('VISURA_CAMERALE__VENDITORE__0__2');
  expect(docKey({ tipo:'CERTIFICATO_PROPRIETA', parte:'VEICOLO', motivo:'', veicoloOrdine: 3 })).toBe('CERTIFICATO_PROPRIETA__VEICOLO__3__0');
});
```
- [ ] **Step 3: Run, FAIL** — `pnpm --filter piattaforma test -- documenti/richiesti`
- [ ] **Step 4: Implement** — in `richiesti.ts`:
```ts
export function docKey(d: DocumentoRichiesto): string {
  return `${d.tipo}__${d.parte}__${d.veicoloOrdine ?? 0}__${d.venditoreOrdine ?? 0}`;
}
```
e in `docLabel`, per i doc con `venditoreOrdine` (parte VENDITORE/AMMINISTRATORE_VENDITORE), appendi " — Venditore N".
- [ ] **Step 5: Run, PASS**. Commit:
```
git add apps/piattaforma/src/lib/documenti/engine.ts apps/piattaforma/src/lib/documenti/richiesti.* && git commit -m "feat(pratiche): docKey/label con venditoreOrdine"
```

---

### Task B5: Engine — venditori[] per-venditore

**Files:** Modify `apps/piattaforma/src/lib/documenti/engine.ts` (+ test)

- [ ] **Step 1:** In `SchemaDocumentaleInput` sostituisci i campi venditore singoli (`venditoreTipoSoggetto`, `venditoreVisuraData`, `venditorePermessoData`, `venditoreDocumentoIdentita`) con:
```ts
  venditori: { ordine: number; tipoSoggetto: TipoSoggetto | null; documentoIdentita: 'CI'|'PASSAPORTO'|'PATENTE'; visuraData: Date | null; permessoData: Date | null }[];
```
(I campi acquirente restano singoli.)
- [ ] **Step 2:** Aggiorna `calcolaDocumentiRichiesti`: i blocchi venditore (permesso/visura) e l'emissione documenti girano in un loop su `input.venditori`. Per ogni venditore: i blocchi come oggi (permesso scaduto/visura non fresca → BLOCCO) e `aggiungiDocumentiPersona(out, 'VENDITORE', 'AMMINISTRATORE_VENDITORE', v.tipoSoggetto!, 'Venditore', v.documentoIdentita)` con i `DocumentoRichiesto` taggati `venditoreOrdine: v.ordine`. Per fare ciò, estendi `aggiungiDocumentiPersona`/`emettiIdentita` ad accettare e propagare `venditoreOrdine` su ogni push (parametro opzionale; per l'acquirente resta undefined). L'INPUT_INCOMPLETO controlla che ogni venditore abbia `tipoSoggetto`.
- [ ] **Step 3: Test** — in `engine.test.ts`: aggiorna `baseInput()` a `venditori: [{ ordine:1, tipoSoggetto:'PRIVATO_ITALIANO_CIE', documentoIdentita:'CI', visuraData:null, permessoData:null }]` (al posto dei campi venditore singoli). I test esistenti devono restare verdi. AGGIUNGI:
```ts
it('due venditori: documenti per ciascuno con venditoreOrdine', () => {
  const r = calcolaDocumentiRichiesti({ ...baseInput(), venditori: [
    { ordine:1, tipoSoggetto:'PRIVATO_ITALIANO_CIE', documentoIdentita:'CI', visuraData:null, permessoData:null },
    { ordine:2, tipoSoggetto:'PRIVATO_ITALIANO_CIE', documentoIdentita:'CI', visuraData:null, permessoData:null },
  ]});
  if (r.kind === 'OK') {
    const vendCI = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE' && d.tipo === 'CI_FRONTE');
    expect(vendCI.map((d) => d.venditoreOrdine)).toEqual([1, 2]);
  }
});
```
- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- documenti/engine`. Commit:
```
git add apps/piattaforma/src/lib/documenti/engine.* && git commit -m "feat(engine): documenti per-venditore (co-intestatari)"
```

---

### Task B6: Wizard — N form venditore + cross-check insiemistico

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

READ il file. Oggi lo step 2 (Venditore) ha un singolo `venditore` + identità. Trasformalo in N venditori.

- [ ] **Step 1: Stato** — sostituisci lo stato `venditore` singolo con `venditori: VenditoreInput[]` (ognuno: i campi parte + `docId` + `identita` files + `permesso`). Default 1 venditore. Funzioni add/remove venditore.
- [ ] **Step 2: Auto-popolamento** — quando il libretto del primo veicolo viene OCR-ato e ha `proprietari` (>1), pre-crea un `VenditoreInput` per proprietario (best-effort: spezza nome/cognome dal nominativo). L'utente può aggiungere/rimuovere.
- [ ] **Step 3: UI** — nello step Venditore, renderizza la lista di venditori: per ciascuno `ParteForm` + `IdentitaSection` (riusa A) + rimuovi/aggiungi. Header "Venditore N".
- [ ] **Step 4: Cross-check insiemistico** — `const proprietari = veicoli[0]?.ocr?.proprietari ?? (veicoli[0]?.proprietarioAttuale ? [veicoli[0].proprietarioAttuale] : []);` poi `const cc = venditoriCrossCheck(venditori.map(v => ({ isPersonaGiuridica: v.isPG, nome: v.nome, cognome: v.cognome, ragioneSociale: v.ragioneSociale })), proprietari, { flagProcura });`. Se `cc === 'MISMATCH'` → Alert error + blocco `canStepVenditore`. Importa `venditoriCrossCheck` da `@/lib/kyc/match`.
- [ ] **Step 5: esitoSchema** — l'input engine ora usa `venditori: venditori.map((v,i) => ({ ordine:i+1, tipoSoggetto:v.tipoSoggetto, documentoIdentita:v.docId, visuraData:..., permessoData:... }))`.
- [ ] **Step 6: Submit** — slot identità per-venditore: `VEND${i+1}_ID_FRONTE`/`_RETRO`/`VEND${i+1}_ID`/`VEND${i+1}_PERMESSO`; e `venditori` come JSON array (dati parte + docId). Rimuovi i vecchi append `venditore*` singoli.
- [ ] **Step 7: Verifica** — typecheck/lint/build/test (residui solo su action/consumer = task successivi). Commit:
```
git add "apps/piattaforma/src/app/pratiche/nuova/wizard.tsx" && git commit -m "feat(pratiche): N form venditore (co-intestatari) + cross-check insiemistico"
```

---

### Task B7: Action — persisti N venditori + cross-check server

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

- [ ] **Step 1:** Parse `venditori` (JSON array) + gli slot identità per-venditore `VEND<n>_*`. Rimuovi il parsing venditore singolo.
- [ ] **Step 2:** Engine input `venditori[]` (mappa ordine/tipoSoggetto/docId/visura/permesso). 
- [ ] **Step 3:** Cross-check server: `venditoriCrossCheck(venditori, proprietari del primo veicolo, { flagProcura })` → MISMATCH = errore.
- [ ] **Step 4:** Crea N `Venditore` in transazione (ordine 1..n); crea i loro `Documento` identità con `venditoreId`. (Il venditore "primario" non è più su Pratica.)
- [ ] **Step 5:** Adatta tutto ciò che leggeva i campi venditore di Pratica nell'action (es. notifiche) a `venditori[0]`.
- [ ] **Step 6:** typecheck/lint/test. Commit:
```
git add "apps/piattaforma/src/app/pratiche/nuova/actions.ts" && git commit -m "feat(pratiche): persisti N venditori + cross-check insiemistico server"
```

---

### Task B8: Consumer ripple (lettura venditori[0])

**Files:** vari (run `pnpm --filter piattaforma typecheck` per la lista)

- [ ] **Step 1:** `pnpm --filter piattaforma typecheck` → elenca gli errori sui consumer che leggono `pratica.venditoreNome/Cognome/CF/RagioneSociale/IsPersonaGiuridica/PIVA/Telefono/Email/TipoSoggetto/…`.
- [ ] **Step 2:** Per ogni file (inbox, admin pratiche/escalation/revisioni/segnalazioni, dashboard broker/agenzia, export CSV, pdf/rendiconto, zip naming, [id]/page, pratiche/page, ecc.): aggiungi `venditori: { orderBy:{ordine:'asc'} }` (o select dei campi) alle query Prisma e leggi da `pratica.venditori[0]` (primario), con "+N" dove sensato per display/ricerca. Mappa i filtri ricerca su `venditori: { some: {...} }`. (Stesso pattern usato per Veicolo.)
- [ ] **Step 3:** `pnpm --filter piattaforma typecheck && lint && build` puliti; `test` verde.
- [ ] **Step 4:** Commit:
```
git add -A && git commit -m "refactor(pratiche): consumer leggono venditori[] (co-intestatari)"
```

---

### Task B9: Seed
**Files:** Modify `packages/db/prisma/seed.ts`
- [ ] Sostituisci i campi venditore inline delle pratiche con la creazione di `Venditore` collegati (almeno 1; per qualche esempio 2 co-intestatari). `prisma db seed` OK. Commit `feat(seed): venditori (co-intestatari)`.

---

### Task B10: Verifica finale
- [ ] `pnpm --filter piattaforma test` PASS · `typecheck && lint && build` PASS. Commit fix eventuali.

---

## Note deploy (col blocco)
Migration `20260606140000_cointestatari_venditori` + le altre del branch. E2E: libretto cointestato → N form venditore; mismatch → blocco; procura → relax.

## Self-review (eseguita)
- **Copertura spec:** modello+migration (B1), libretto multi-owner (B2), cross-check insiemistico (B3), docKey venditoreOrdine (B4), engine per-venditore (B5), wizard N venditori (B6), action (B7), ripple (B8), seed (B9). ✔
- **Tipi coerenti:** `venditori[]` engine input, `venditoreOrdine` su DocumentoRichiesto+docKey, `venditoriCrossCheck` ('OK'|'MISMATCH'|'SCONOSCIUTO'), slot `VEND<n>_*` wizard↔action. ✔
- **Rischi:** ripple ampio (B8) come per Veicolo; migration drop colonne venditore (backfill prima); calibrazione OCR multi-owner; engine `baseInput()` test va riscritto con `venditori[]`.
