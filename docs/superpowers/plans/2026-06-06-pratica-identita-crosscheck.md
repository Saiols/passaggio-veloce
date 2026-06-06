# Pratica (A): identità per parte + cross-check venditore + riordino + permesso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Documento d'identità (CI/passaporto/patente) caricato in ogni passo parte con OCR che pre-compila il form; estrazione proprietario dal libretto + cross-check del venditore (blocco su mismatch); riordino step venditore→acquirente; permesso opzionale (obbligatorio stranieri).

**Architecture:** Moduli puri (estrazione identità, proprietario libretto, cross-check, esclusione card identità, engine per-identità) testati a unità; il wizard cattura l'identità nel passo parte e blocca sul cross-check; l'action ricalcola engine, valida e persiste (→ ZIP). Venditore singolo (co-intestatari = tappa B).

**Tech Stack:** Next.js 16, TypeScript, Vitest, Prisma. OCR = Google Document AI.

**Spec:** `docs/superpowers/specs/2026-06-06-pratica-identita-crosscheck-design.md`. Branch: `feat/tipi-pratica-multiveicolo`.

**Comandi:** test `pnpm --filter piattaforma test` · typecheck `pnpm --filter piattaforma typecheck` · lint `pnpm --filter piattaforma lint` · build `pnpm --filter piattaforma build`. NON eseguire il typecheck globale finché wizard/action non sono migrati (task tardivi): è atteso rosso sui consumer dell'enum/engine fino ad allora.

---

### Task A1: Enum PASSAPORTO/PATENTE (Prisma + engine type) + migration

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/20260606120000_doc_passaporto_patente/migration.sql`; Modify `apps/piattaforma/src/lib/documenti/engine.ts` (solo il type `DocumentoTipoEngine`)

- [ ] **Step 1:** In `schema.prisma`, nel `enum DocumentoTipo`, aggiungi due valori `PASSAPORTO` e `PATENTE` (in fondo all'enum).
- [ ] **Step 2:** In `engine.ts`, aggiungi `'PASSAPORTO' | 'PATENTE'` al type `DocumentoTipoEngine`.
- [ ] **Step 3:** `pnpm --filter @pv/db exec prisma db push` (locale) + `pnpm --filter @pv/db exec prisma generate`. Se `db push` vuole ricreare l'enum, è ok in locale.
- [ ] **Step 4:** Crea la migration prod `packages/db/prisma/migrations/20260606120000_doc_passaporto_patente/migration.sql`:
```sql
-- Documenti d'identità alternativi alla CI.
ALTER TYPE "DocumentoTipo" ADD VALUE IF NOT EXISTS 'PASSAPORTO';
ALTER TYPE "DocumentoTipo" ADD VALUE IF NOT EXISTS 'PATENTE';
```
> NB: `ALTER TYPE ... ADD VALUE` non può girare in una transazione con altre operazioni in vecchie versioni PG; da solo va bene su Neon (PG15). Lo applichiamo a prod col deploy in blocco.
- [ ] **Step 5:** `pnpm --filter @pv/db exec prisma validate` OK. Commit:
```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260606120000_doc_passaporto_patente/ apps/piattaforma/src/lib/documenti/engine.ts
git commit -m "feat(db): DocumentoTipo PASSAPORTO/PATENTE + migration"
```

---

### Task A2: Estrazione identità (`extract-identita.ts`)

**Files:** Create `apps/piattaforma/src/lib/kyc/extract-identita.ts`; Create `apps/piattaforma/src/lib/kyc/extract-identita.test.ts`

Riusa `extractCi` (→ `{nome?,cognome?,rawText}`) ed `extractCf` (→ `{codiceFiscale?,rawText}`) da `./extract-ci`/`./extract-cf`.

- [ ] **Step 1: Test** — `extract-identita.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractIdentita } from './extract-identita';

describe('extractIdentita', () => {
  it('CI: nome/cognome/CF dai campi etichettati', () => {
    const r = extractIdentita('COGNOME\nROSSI\nNOME\nMARIO\nCODICE FISCALE\nRSSMRA80A01H501U', 'CI');
    expect(r.cognome).toBe('ROSSI'); expect(r.nome).toBe('MARIO'); expect(r.codiceFiscale).toBe('RSSMRA80A01H501U');
  });
  it('PASSAPORTO: cognome/nome da MRZ', () => {
    const mrz = 'P<ITAROSSI<<MARIO<<<<<<<<<<<<<<<<<<<<<<<<<<\nYA1234567ITA8001011M3001011<<<<<<<<<<<<<<04';
    const r = extractIdentita(mrz, 'PASSAPORTO');
    expect(r.cognome).toBe('ROSSI'); expect(r.nome).toBe('MARIO');
  });
  it('PATENTE: cognome/nome dai campi 1/2', () => {
    const r = extractIdentita('PATENTE DI GUIDA\n1. ROSSI\n2. MARIO\n3. 01.01.1980 ROMA', 'PATENTE');
    expect(r.cognome).toBe('ROSSI'); expect(r.nome).toBe('MARIO');
  });
  it('campi assenti → undefined senza lanciare', () => {
    expect(extractIdentita('testo', 'PASSAPORTO').cognome).toBeUndefined();
  });
});
```
- [ ] **Step 2: Run, FAIL** — `pnpm --filter piattaforma test -- extract-identita`
- [ ] **Step 3: Implement** — `apps/piattaforma/src/lib/kyc/extract-identita.ts`:
```ts
import { extractCi } from './extract-ci';
import { extractCf } from './extract-cf';

export type IdentitaTipo = 'CI' | 'PASSAPORTO' | 'PATENTE';
export type IdentitaData = { nome?: string; cognome?: string; codiceFiscale?: string };

/** MRZ TD3 (passaporto): riga 1 "P<ISOSURNAME<<GIVEN<NAMES<<<". */
function parsePassaporto(text: string): IdentitaData {
  const up = text.toUpperCase();
  const m = /P[<A-Z][A-Z]{3}([A-Z]+(?:<[A-Z]+)*)<<([A-Z]+(?:<[A-Z]+)*)/.exec(up.replace(/\s/g, ''));
  if (!m) return {};
  const cognome = m[1]!.replace(/</g, ' ').trim();
  const nome = m[2]!.replace(/</g, ' ').trim();
  return { cognome: cognome || undefined, nome: nome || undefined };
}

/** Patente: campi numerati "1. COGNOME" / "2. NOME". */
function parsePatente(text: string): IdentitaData {
  const cogn = /(?:^|\n)\s*1\.?\s*([A-ZÀ-Ù'’ ]{2,})/i.exec(text);
  const nome = /(?:^|\n)\s*2\.?\s*([A-ZÀ-Ù'’ ]{2,})/i.exec(text);
  return {
    cognome: cogn?.[1]?.trim().toUpperCase(),
    nome: nome?.[1]?.trim().toUpperCase(),
  };
}

export function extractIdentita(text: string, tipo: IdentitaTipo): IdentitaData {
  if (tipo === 'CI') {
    const ci = extractCi(text);
    const cf = extractCf(text);
    return { nome: ci.nome, cognome: ci.cognome, codiceFiscale: cf.codiceFiscale };
  }
  if (tipo === 'PASSAPORTO') return parsePassaporto(text);
  return parsePatente(text);
}
```
> Baseline regex; calibrare su documenti reali (come per la visura). Far passare i test senza indebolire le asserzioni.
- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- extract-identita`. Commit:
```
git add apps/piattaforma/src/lib/kyc/extract-identita.* && git commit -m "feat(kyc): estrazione identità CI/passaporto/patente"
```

---

### Task A3: Estrazione proprietario dal libretto

**Files:** Modify `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts`; Modify `apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts`

- [ ] **Step 1: Test** — aggiungi a `libretto-parser.test.ts`:
```ts
it('estrae il proprietario (intestatario)', () => {
  const r = parseLibrettoText('CARTA DI CIRCOLAZIONE\nINTESTATO A ROSSI MARIO\nA) AB123CD', 0.9);
  expect(r.proprietarioAttuale).toBe('ROSSI MARIO');
});
it('proprietario undefined se non riconosciuto', () => {
  expect(parseLibrettoText('targa AB123CD', 0.9).proprietarioAttuale).toBeUndefined();
});
```
- [ ] **Step 2: Run, FAIL** — `pnpm --filter piattaforma test -- libretto-parser`
- [ ] **Step 3: Implement** — in `parseLibrettoText`, sostituisci `proprietarioAttuale: undefined` con un'estrazione best-effort:
```ts
  const propM = /(?:INTESTAT[OA] A|INTESTATARIO|C1\.1\)?\s*)\s*([A-ZÀ-Ù'’]+(?:\s+[A-ZÀ-Ù'’]+){1,3})/.exec(upper);
  const proprietarioAttuale = propM ? propM[1]!.trim() : undefined;
```
e usa `proprietarioAttuale` nell'oggetto ritornato.
> Baseline; calibrare su libretti reali. Non deve produrre falsi nomi da testo casuale (il test "undefined" lo verifica).
- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- libretto-parser`. Commit:
```
git add apps/piattaforma/src/lib/providers/ocr/libretto-parser.* && git commit -m "feat(ocr): estrazione proprietario dal libretto"
```

---

### Task A4: `richiesti.ts` esclude i documenti d'identità personali

**Files:** Modify `apps/piattaforma/src/lib/documenti/richiesti.ts`; Modify `apps/piattaforma/src/lib/documenti/richiesti.test.ts`

- [ ] **Step 1: Aggiorna il test** — in `richiesti.test.ts`, il test di `requiredUploadDocs` cambia: i tipi identità sono esclusi. Sostituisci il test esistente con:
```ts
describe('requiredUploadDocs', () => {
  it('esclude libretto + documenti identità personali, tiene il resto', () => {
    const visura: DocumentoRichiesto = { tipo: 'VISURA_CAMERALE', parte: 'VENDITORE', motivo: '' };
    const r = requiredUploadDocs({ kind: 'OK', documentiRichiesti: [libretto, cdp, ciVend, visura] });
    expect(r.map((d) => d.tipo)).toEqual(['CERTIFICATO_PROPRIETA', 'VISURA_CAMERALE']);
  });
  it('[] se non OK', () => {
    expect(requiredUploadDocs({ kind: 'BLOCCO', motivo: 'x', soluzione: 'y' })).toEqual([]);
  });
});
```
(`ciVend` è CI_FRONTE → ora escluso; `visura` resta.)
- [ ] **Step 2: Run, FAIL** — `pnpm --filter piattaforma test -- documenti/richiesti`
- [ ] **Step 3: Implement** — in `richiesti.ts`, aggiungi il set dei tipi identità e filtralo in `requiredUploadDocs`:
```ts
const TIPI_IDENTITA: ReadonlySet<string> = new Set([
  'LIBRETTO_CIRCOLAZIONE', 'CI_FRONTE', 'CI_RETRO', 'CODICE_FISCALE', 'PASSAPORTO', 'PATENTE', 'PERMESSO_SOGGIORNO',
]);

export function requiredUploadDocs(esito: EsitoSchemaDocumentale): DocumentoRichiesto[] {
  if (esito.kind !== 'OK') return [];
  return esito.documentiRichiesti.filter((d) => !TIPI_IDENTITA.has(d.tipo));
}
```
- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- documenti/richiesti`. Commit:
```
git add apps/piattaforma/src/lib/documenti/richiesti.* && git commit -m "feat(pratiche): card documenti escludono i doc identità (catturati nel passo parte)"
```

---

### Task A5: Engine — `documentoIdentita` per persona

**Files:** Modify `apps/piattaforma/src/lib/documenti/engine.ts`; Modify `apps/piattaforma/src/lib/documenti/engine.test.ts`

- [ ] **Step 1:** Estendi `SchemaDocumentaleInput` con il tipo documento identità per parte:
```ts
  venditoreDocumentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE';
  acquirenteDocumentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE';
```
(Il `PRIVATO_ITALIANO_CIE/CARTACEA` resta per distinguere se serve il CODICE_FISCALE separato quando l'identità è CI.)

- [ ] **Step 2:** Modifica `aggiungiDocumentiPersona` aggiungendo un parametro `docIdentita: 'CI'|'PASSAPORTO'|'PATENTE'` e, per i rami persona fisica/straniero, emetti l'identità scelta:
```ts
  function emettiIdentita(out, parteCI, motivoPrefix, tipoSoggetto, docIdentita) {
    if (docIdentita === 'PASSAPORTO') { out.push({ tipo:'PASSAPORTO', parte: parteCI, motivo: `${motivoPrefix}: passaporto` }); return; }
    if (docIdentita === 'PATENTE') { out.push({ tipo:'PATENTE', parte: parteCI, motivo: `${motivoPrefix}: patente` }); return; }
    // CI:
    out.push({ tipo:'CI_FRONTE', parte: parteCI, motivo: `${motivoPrefix}: CI fronte` });
    out.push({ tipo:'CI_RETRO', parte: parteCI, motivo: `${motivoPrefix}: CI retro` });
    if (tipoSoggetto === 'PRIVATO_ITALIANO_CARTACEA') out.push({ tipo:'CODICE_FISCALE', parte: parteCI, motivo: `${motivoPrefix}: tessera CF` });
  }
```
Per i rami:
  - PRIVATO_ITALIANO_CIE/CARTACEA → `emettiIdentita(... docIdentita)`.
  - STRANIERO_EXTRA_UE → `emettiIdentita(...)` + PERMESSO_SOGGIORNO (come oggi) + blocco se scaduto.
  - AZIENDA/OPERATORE_AUTO → VISURA_CAMERALE (parte CI) + `emettiIdentita(out, parteAmministratore, ..., docIdentita)` per l'amministratore.
Passa `input.venditoreDocumentoIdentita`/`input.acquirenteDocumentoIdentita` nelle due chiamate a `aggiungiDocumentiPersona`.

- [ ] **Step 3:** Aggiorna `engine.test.ts`: tutti i test esistenti devono passare `venditoreDocumentoIdentita: 'CI'` e `acquirenteDocumentoIdentita: 'CI'` (default), così l'output CI resta invariato. AGGIUNGI:
```ts
it('venditore con passaporto: richiede PASSAPORTO non CI', () => {
  const r = calcolaDocumentiRichiesti({ ...baseInput(), venditoreDocumentoIdentita: 'PASSAPORTO' });
  if (r.kind === 'OK') {
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).not.toContain('CI_FRONTE');
  }
});
```
(Adatta `baseInput()` per includere i due nuovi campi default 'CI'.)

- [ ] **Step 4:** `pnpm --filter piattaforma test -- documenti/engine` → PASS. Commit:
```
git add apps/piattaforma/src/lib/documenti/engine.* && git commit -m "feat(engine): documento identità alternativo (CI/passaporto/patente) per parte"
```

---

### Task A6: Cross-check venditore↔proprietario (puro)

**Files:** Modify `apps/piattaforma/src/lib/kyc/match.ts`; Modify `apps/piattaforma/src/lib/kyc/match.test.ts`

- [ ] **Step 1: Test** — in `match.test.ts` aggiungi:
```ts
import { proprietarioCrossCheck } from './match';
describe('proprietarioCrossCheck', () => {
  it('MATCH persona', () => {
    expect(proprietarioCrossCheck({ isPersonaGiuridica: false, nome: 'Mario', cognome: 'Rossi' }, 'ROSSI MARIO')).toBe('MATCH');
  });
  it('MISMATCH persona', () => {
    expect(proprietarioCrossCheck({ isPersonaGiuridica: false, nome: 'Luca', cognome: 'Bianchi' }, 'ROSSI MARIO')).toBe('MISMATCH');
  });
  it('MATCH azienda per ragione sociale', () => {
    expect(proprietarioCrossCheck({ isPersonaGiuridica: true, ragioneSociale: 'Rossi Auto SRL' }, 'ROSSI AUTO')).toBe('MATCH');
  });
  it('SCONOSCIUTO se proprietario non estratto', () => {
    expect(proprietarioCrossCheck({ isPersonaGiuridica: false, nome: 'Mario', cognome: 'Rossi' }, undefined)).toBe('SCONOSCIUTO');
  });
});
```
- [ ] **Step 2: Run, FAIL** — `pnpm --filter piattaforma test -- kyc/match`
- [ ] **Step 3: Implement** — in `match.ts` aggiungi (riusa `nameMatches`, `normalizeCompanyName`):
```ts
export function proprietarioCrossCheck(
  venditore: { isPersonaGiuridica: boolean; nome?: string; cognome?: string; ragioneSociale?: string },
  proprietario: string | undefined,
): 'MATCH' | 'MISMATCH' | 'SCONOSCIUTO' {
  if (!proprietario || !proprietario.trim()) return 'SCONOSCIUTO';
  if (venditore.isPersonaGiuridica) {
    if (!venditore.ragioneSociale) return 'SCONOSCIUTO';
    return normalizeCompanyName(venditore.ragioneSociale) === normalizeCompanyName(proprietario)
      || nameMatches(venditore.ragioneSociale, proprietario) ? 'MATCH' : 'MISMATCH';
  }
  const full = `${venditore.nome ?? ''} ${venditore.cognome ?? ''}`.trim();
  if (!full) return 'SCONOSCIUTO';
  return nameMatches(full, proprietario) ? 'MATCH' : 'MISMATCH';
}
```
- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- kyc/match`. Commit:
```
git add apps/piattaforma/src/lib/kyc/match.* && git commit -m "feat(kyc): cross-check venditore↔proprietario libretto"
```

---

### Task A7: Wizard — riordino step + identità per parte + cross-check venditore

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

READ il file (post task documenti). Step attuali: 1 Tipo&veicoli, 2 Parti (venditore+acquirente insieme), 3 Documenti, 4 Invio.

- [ ] **Step 1: Riordino** — `STEPS` → `1 Tipo & veicoli`, `2 Venditore`, `3 Acquirente`, `4 Documenti`, `5 Invio`. Separa lo step 2 in due: `step===2` mostra il `ParteForm` venditore, `step===3` quello acquirente. Rinumera i blocchi `step===N` (Documenti→4, Invio→5), i `setStep`, e i gate. `canStep2` (venditore) = `parteValida(venditore) && identitaVenditoreValida && crossCheckOk`; `canStep3` (acquirente) = `parteValida(acquirente) && identitaAcquirenteValida`; lo step Documenti diventa step 4 (gate `docsValidi`), Invio step 5 (gate `canSubmit`).

- [ ] **Step 2: Sezione identità** — in ciascuno step parte, sotto il `ParteForm`, aggiungi una sezione "Documento d'identità":
  - Selettore `documentoIdentita: 'CI'|'PASSAPORTO'|'PATENTE'` (Select). Stato per parte (es. `venditoreDocId`, `acquirenteDocId`, default 'CI').
  - CI → due `DocCard` (Fronte, Retro). PASSAPORTO/PATENTE → una `DocCard` singola. (Usa il `DocCard` condiviso da `@/components/doc-card`.)
  - Permesso di soggiorno → una `DocCard` opzionale.
  - All'upload del documento identità principale (fronte per CI, o il singolo): chiama una nuova action OCR identità (vedi Step 3) e pre-compila i campi del `ParteForm` (nome/cognome/CF) della parte.
  - Stato file: `venditoreIdentita: { fronte?: File; retro?: File; single?: File; permesso?: File }` e analogo acquirente.

- [ ] **Step 3: Action OCR identità** — aggiungi in `actions.ts` (e importala nel wizard) `extractIdentitaAction(formData)` che riceve `{ file, tipo }`, fa `getOcr().extractText(buffer)` + `extractIdentita(text, tipo)` e ritorna `{ ok:true, data:{nome,cognome,codiceFiscale} } | { ok:false, error }`. Il wizard la chiama all'upload identità per pre-compilare. (Mirror di `extractLibrettoAction`.)

- [ ] **Step 4: Cross-check venditore** — calcola il proprietario dal primo veicolo: `const proprietario = veicoli[0]?.proprietarioAttuale` (dall'OCR libretto, già nello state veicolo). `const cc = proprietarioCrossCheck({ isPersonaGiuridica: venditore.isPG, nome: venditore.nome, cognome: venditore.cognome, ragioneSociale: venditore.ragioneSociale }, proprietario);`. Se `cc === 'MISMATCH'` → Alert error nello step venditore ("Il venditore non corrisponde all'intestatario del libretto") e `canStep2 = false`. `MATCH`/`SCONOSCIUTO` → ok. Importa `proprietarioCrossCheck` da `@/lib/kyc/match`.

- [ ] **Step 5: Submit** — in `handleFinalSubmit` aggiungi: `fd.append('venditoreDocumentoIdentita', venditoreDocId)`, idem acquirente; i file identità come slot `VEND_ID_FRONTE`/`VEND_ID_RETRO`/`VEND_ID`/`VEND_PERMESSO` e `ACQ_*`. Mantieni gli altri append (DOC__ per le card non-identità, ecc.).

- [ ] **Step 6: Verifica** — `pnpm --filter piattaforma typecheck` + `lint` puliti; `pnpm --filter piattaforma build` PASS; test verde. Commit:
```
git add "apps/piattaforma/src/app/pratiche/nuova/wizard.tsx" "apps/piattaforma/src/app/pratiche/nuova/actions.ts"
git commit -m "feat(pratiche): riordino step + identità per parte (OCR pre-fill) + cross-check venditore"
```

---

### Task A8: Action — persistenza identità/permesso + cross-check server-side

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

- [ ] **Step 1:** Parse dei nuovi campi: `venditoreDocumentoIdentita`/`acquirenteDocumentoIdentita` (enum CI/PASSAPORTO/PATENTE) e i file slot `VEND_ID_*`/`ACQ_*`/`*_PERMESSO`.
- [ ] **Step 2: Engine input** — passa `venditoreDocumentoIdentita`/`acquirenteDocumentoIdentita` a `calcolaDocumentiRichiesti` (campi aggiunti in A5). L'esito ora include i doc identità per parte (PASSAPORTO/PATENTE/CI_*).
- [ ] **Step 3: Valida identità presente** — per ciascuna parte, in base al `documentoIdentita`: CI → richiedi `*_ID_FRONTE` + `*_ID_RETRO` (file presenti); PASSAPORTO/PATENTE → `*_ID`. Per stranieri → richiedi anche il permesso (se l'engine lo richiede). File mancante → errore "Documento d'identità mancante per <parte>".
- [ ] **Step 4: Cross-check server** — `proprietarioCrossCheck({...venditore}, primoVeicolo.proprietarioAttuale)`; se `MISMATCH` → errore "Il venditore non corrisponde all'intestatario del libretto" (no creazione). (`proprietarioAttuale` arriva dal payload veicoli OCR.)
- [ ] **Step 5: Persisti** — carica i file identità/permesso su storage e crea `Documento` con `tipo` (CI_FRONTE/CI_RETRO/PASSAPORTO/PATENTE/CODICE_FISCALE se cartacea/PERMESSO_SOGGIORNO), `owner` (VENDITORE/ACQUIRENTE), `praticaId`, dentro la transazione (mirror della persistenza doc esistente). Niente `veicoloId` (sono doc parte).
- [ ] **Step 6: Verifica** — typecheck/lint/build/test. Commit:
```
git add "apps/piattaforma/src/app/pratiche/nuova/actions.ts"
git commit -m "feat(pratiche): persisti identità/permesso + cross-check venditore server-side"
```

---

### Task A9: Verifica finale
- [ ] `pnpm --filter piattaforma test` → PASS.
- [ ] `pnpm --filter piattaforma typecheck && lint && build` → PASS.
- [ ] Commit fix eventuali.

---

## Note deploy (col deploy in blocco del branch)
Migration `20260606120000_doc_passaporto_patente` (ADD VALUE) + la migration tipi-pratica. ZIP già include i nuovi Documento. E2E: venditore mismatch → blocco; passaporto → pre-fill; permesso opzionale.

## Self-review (eseguita)
- **Copertura spec:** enum/migration (A1), extract-identita (A2), libretto owner (A3), card escludono identità (A4), engine documentoIdentita (A5), cross-check (A6), wizard riordino+identità+cross-check (A7), action persistenza+cross-check (A8). ✔
- **Tipi coerenti:** `IdentitaTipo`/`documentoIdentita` ('CI'|'PASSAPORTO'|'PATENTE'), `proprietarioCrossCheck` ('MATCH'|'MISMATCH'|'SCONOSCIUTO'), slot `VEND_ID_*`/`ACQ_*` coerenti wizard↔action. ✔
- **Rischi:** calibrazione OCR (libretto owner, passaporto MRZ, patente) su documenti reali; rinumerazione step (A7) — aggiornare tutti gli indici; engine `baseInput()` test va esteso coi due nuovi campi default 'CI'.
