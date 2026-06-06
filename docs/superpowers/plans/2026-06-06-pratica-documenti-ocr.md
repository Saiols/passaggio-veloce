# Pratica documenti a card + OCR libretto + blocco comodato + CdP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Step documenti della creazione pratica a card guidate dai documenti richiesti (obbligatori) + banner promemoria + blocco rigido sul comodato d'uso rilevato dall'OCR libretto + campo Certificato di Proprietà condizionale per veicoli pre-2015.

**Architecture:** Un modulo puro `lib/documenti/richiesti.ts` deriva da `EsitoSchemaDocumentale` le card di upload (chiave stabile, label, mapping parte→owner). Il wizard usa quel modulo + un `DocCard` condiviso (estratto dalla registrazione) per renderizzare le card obbligatorie; il `VeicoloSection` blocca sul comodato. L'action ricalcola l'engine server-side, valida la presenza di tutti i documenti richiesti e li persiste.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Prisma. OCR libretto = Google Document AI (già unificato).

**Spec:** `docs/superpowers/specs/2026-06-06-pratica-documenti-ocr-design.md`. Branch: `feat/tipi-pratica-multiveicolo`.

**Comandi:** test `pnpm --filter piattaforma test` · typecheck `pnpm --filter piattaforma typecheck` · lint `pnpm --filter piattaforma lint` · build `pnpm --filter piattaforma build`.

---

### Task 1: Modulo puro `richiesti.ts` (docKey, label, parteToOwner, requiredUploadDocs)

**Files:** Create `apps/piattaforma/src/lib/documenti/richiesti.ts`; Create `apps/piattaforma/src/lib/documenti/richiesti.test.ts`

- [ ] **Step 1: Test** — Create `richiesti.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { docKey, parteToOwner, requiredUploadDocs, docLabel } from './richiesti';
import type { DocumentoRichiesto } from './engine';

const libretto: DocumentoRichiesto = { tipo: 'LIBRETTO_CIRCOLAZIONE', parte: 'VEICOLO', motivo: '', veicoloOrdine: 1 };
const cdp: DocumentoRichiesto = { tipo: 'CERTIFICATO_PROPRIETA', parte: 'VEICOLO', motivo: '', veicoloOrdine: 2 };
const ciVend: DocumentoRichiesto = { tipo: 'CI_FRONTE', parte: 'VENDITORE', motivo: '' };

describe('docKey', () => {
  it('chiave stabile tipo__parte__veicoloOrdine', () => {
    expect(docKey(cdp)).toBe('CERTIFICATO_PROPRIETA__VEICOLO__2');
    expect(docKey(ciVend)).toBe('CI_FRONTE__VENDITORE__0');
  });
});

describe('requiredUploadDocs', () => {
  it('esclude il libretto (caricato nello step veicolo) e tiene il resto', () => {
    const esito = { kind: 'OK' as const, documentiRichiesti: [libretto, cdp, ciVend] };
    const r = requiredUploadDocs(esito);
    expect(r.map((d) => d.tipo)).toEqual(['CERTIFICATO_PROPRIETA', 'CI_FRONTE']);
  });
  it('ritorna [] se esito non è OK', () => {
    expect(requiredUploadDocs({ kind: 'BLOCCO', motivo: 'x', soluzione: 'y' })).toEqual([]);
  });
});

describe('parteToOwner', () => {
  it('mappa al lato corretto', () => {
    expect(parteToOwner('VENDITORE')).toBe('VENDITORE');
    expect(parteToOwner('AMMINISTRATORE_VENDITORE')).toBe('VENDITORE');
    expect(parteToOwner('ACQUIRENTE')).toBe('ACQUIRENTE');
    expect(parteToOwner('AMMINISTRATORE_ACQUIRENTE')).toBe('ACQUIRENTE');
    expect(parteToOwner('VEICOLO')).toBeNull();
    expect(parteToOwner('PROCURATORE')).toBeNull();
  });
});

describe('docLabel', () => {
  it('etichetta leggibile, con numero veicolo per i doc veicolo', () => {
    expect(docLabel(cdp)).toBe('Certificato di Proprietà — Veicolo 2');
    expect(docLabel(ciVend)).toBe("Carta d'identità (fronte) — Venditore");
  });
});
```

- [ ] **Step 2: Run, FAIL** — `pnpm --filter piattaforma test -- documenti/richiesti`

- [ ] **Step 3: Implement** — Create `apps/piattaforma/src/lib/documenti/richiesti.ts`:
```ts
import type { DocumentoRichiesto, EsitoSchemaDocumentale, DocumentoTipoEngine, ParteDocumento } from './engine';

/** Chiave stabile per identificare un documento richiesto negli slot upload. */
export function docKey(d: DocumentoRichiesto): string {
  return `${d.tipo}__${d.parte}__${d.veicoloOrdine ?? 0}`;
}

/** Documenti da caricare a card: tutti i richiesti TRANNE il libretto (che si
 * carica nello step veicolo). [] se l'esito non è OK. */
export function requiredUploadDocs(esito: EsitoSchemaDocumentale): DocumentoRichiesto[] {
  if (esito.kind !== 'OK') return [];
  return esito.documentiRichiesti.filter((d) => d.tipo !== 'LIBRETTO_CIRCOLAZIONE');
}

/** Owner DB per il documento (per la persistenza). null per VEICOLO (usa veicoloId)
 * e per parti senza owner dedicato (procuratore/erede/tutore). */
export function parteToOwner(parte: ParteDocumento): 'VENDITORE' | 'ACQUIRENTE' | null {
  if (parte === 'VENDITORE' || parte === 'AMMINISTRATORE_VENDITORE') return 'VENDITORE';
  if (parte === 'ACQUIRENTE' || parte === 'AMMINISTRATORE_ACQUIRENTE') return 'ACQUIRENTE';
  return null;
}

const TIPO_LABEL: Record<DocumentoTipoEngine, string> = {
  LIBRETTO_CIRCOLAZIONE: 'Libretto di circolazione',
  CI_FRONTE: "Carta d'identità (fronte)",
  CI_RETRO: "Carta d'identità (retro)",
  CODICE_FISCALE: 'Codice fiscale / Tessera sanitaria',
  PROCURA: 'Procura',
  PERMESSO_SOGGIORNO: 'Permesso di soggiorno',
  VISURA_CAMERALE: 'Visura camerale',
  CERTIFICATO_PROPRIETA: 'Certificato di Proprietà',
  REVOCA_COMODATO: 'Revoca comodato',
  CERTIFICATO_MORTE: 'Certificato di morte',
  ATTO_ACCETTAZIONE_EREDITA: 'Atto di accettazione eredità',
  DICHIARAZIONE_QUALITA_EREDE: 'Dichiarazione qualità di erede',
  AUTORIZZAZIONE_TUTORE: 'Autorizzazione del tutore',
};

const PARTE_LABEL: Record<Exclude<ParteDocumento, 'VEICOLO'>, string> = {
  VENDITORE: 'Venditore',
  ACQUIRENTE: 'Acquirente',
  PROCURATORE: 'Procuratore',
  EREDE: 'Erede',
  TUTORE: 'Tutore',
  AMMINISTRATORE_VENDITORE: 'Amministratore (venditore)',
  AMMINISTRATORE_ACQUIRENTE: 'Amministratore (acquirente)',
};

/** Etichetta leggibile per la card. */
export function docLabel(d: DocumentoRichiesto): string {
  const tipo = TIPO_LABEL[d.tipo];
  if (d.parte === 'VEICOLO') return `${tipo} — Veicolo ${d.veicoloOrdine ?? 1}`;
  return `${tipo} — ${PARTE_LABEL[d.parte]}`;
}
```

- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- documenti/richiesti`
- [ ] **Step 5: Commit** — `git add apps/piattaforma/src/lib/documenti/richiesti.ts apps/piattaforma/src/lib/documenti/richiesti.test.ts && git commit -m "feat(pratiche): modulo richiesti (docKey/label/parteToOwner/requiredUploadDocs)"`

---

### Task 2: Estrai `DocCard` in componente condiviso

**Files:** Create `apps/piattaforma/src/components/doc-card.tsx`; Modify `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`

- [ ] **Step 1:** Crea `apps/piattaforma/src/components/doc-card.tsx` con `'use client'` in cima ed esporta `DocCard` copiando ESATTAMENTE la funzione `DocCard` attualmente in `register-wizard.tsx` (righe ~483-590: props `{ label, file, onChange, invalid? }`, preview immagine via `useMemo`/`useEffect`, stati Caricato/Da caricare, Sostituisci/Rimuovi, input file `accept="application/pdf,image/jpeg,image/png"` max 10MB). Aggiungi gli import necessari (`useMemo`, `useEffect` da 'react').

- [ ] **Step 2:** In `register-wizard.tsx`: RIMUOVI la definizione locale di `DocCard` e aggiungi `import { DocCard } from '@/components/doc-card';`. Nessun altro cambiamento.

- [ ] **Step 3: Verifica** — `pnpm --filter piattaforma typecheck` (registrazione) e `pnpm --filter piattaforma build` → la registrazione builda e si comporta come prima. `pnpm --filter piattaforma test` → 282+ pass.

- [ ] **Step 4: Commit** — `git add apps/piattaforma/src/components/doc-card.tsx "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx" && git commit -m "refactor(ui): estrai DocCard condiviso"`

---

### Task 3: Blocco comodato nel `VeicoloSection`

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

- [ ] **Step 1:** In `VeicoloSection` (la card veicolo): quando `veicolo.flagComodatoDuso` è `true`, mostra in cima alla card un `<Alert variant="error">` con testo: *"Veicolo in comodato d'uso: è obbligatorio recarsi in agenzia per farlo revocare prima di procedere. Non è possibile creare la pratica con un veicolo in comodato."*

- [ ] **Step 2:** Rendi il checkbox "Comodato d'uso rilevato" **disabled** quando il valore proviene dall'OCR (cioè `veicolo.ocr?.flagComodatoDuso === true`): aggiungi `disabled={veicolo.ocr?.flagComodatoDuso === true}` al `Checkbox`. (Nel percorso manuale `veicolo.ocr` è assente → resta settabile.)

- [ ] **Step 3:** Blocca l'avanzamento: nel componente wizard, dove è definito `canStep2`/`veicoliValidi` (riga ~464-474), aggiungi la condizione che NESSUN veicolo sia in comodato:
```ts
  const comodatoBloccante = veicoli.some((v) => v.flagComodatoDuso);
  const canStep2 = veicoliValidi && !comodatoBloccante;
```
E in cima allo step 1 (o sopra i bottoni di navigazione dello step veicoli) mostra un Alert error riepilogativo se `comodatoBloccante` (così il blocco è evidente anche con più veicoli). Il pulsante "Avanti" dello step veicoli usa `disabled={!canStep2}`.

- [ ] **Step 4: Verifica** — `pnpm --filter piattaforma typecheck` + `lint` puliti; `pnpm --filter piattaforma build` PASS.
- [ ] **Step 5: Commit** — `git add "apps/piattaforma/src/app/pratiche/nuova/wizard.tsx" && git commit -m "feat(pratiche): blocco rigido comodato d'uso allo step veicolo"`

---

### Task 4: Step documenti a card (banner + griglia + obbligatorietà) nel wizard

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

Obiettivo: sostituire l'upload documenti per-parte (`DocumentiUploader` dentro `ParteForm`) con uno step documenti a card guidato da `requiredUploadDocs(esitoSchema)`, obbligatorio, con banner.

- [ ] **Step 1: Stato documenti.** Aggiungi nel componente wizard `const [documenti, setDocumenti] = useState<Record<string, File>>({});` (chiave = `docKey`). Importa `import { DocCard } from '@/components/doc-card';` e `import { docKey, docLabel, requiredUploadDocs } from '@/lib/documenti/richiesti';`.

- [ ] **Step 2: Card grid + banner.** Nello step documenti (vedi Step 4 sotto per la collocazione), renderizza:
  - Un banner fisso: `<Alert variant="info">Ricorda: tutti i documenti richiesti vanno portati in originale, fisicamente in agenzia, al momento della firma.</Alert>`
  - Se `esitoSchema.kind === 'BLOCCO'` → mostra l'Alert error con `motivo`/`soluzione` e nessuna card.
  - Altrimenti, `const docs = requiredUploadDocs(esitoSchema);` e una griglia `grid grid-cols-1 sm:grid-cols-2 gap-3` di `<DocCard>` — una per `d` in `docs`, con `key={docKey(d)}`, `label={docLabel(d)}`, `file={documenti[docKey(d)] ?? null}`, `onChange={(f) => setDocumenti((m) => { const n = { ...m }; const k = docKey(d); if (f) n[k] = f; else delete n[k]; return n; })}`.
  - Contatore "N/M documenti caricati".

- [ ] **Step 3: Rimuovi `DocumentiUploader` dalle parti.** In `ParteForm` togli `<DocumentiUploader .../>` (riga ~1086) e i relativi `documenti` per-parte non più usati (lascia i dati anagrafici/tipoSoggetto). Rimuovi anche dallo state `Parte` il campo `documenti` se diventa inutilizzato e l'append `venditore_<t>`/`acquirente_<t>` nel submit (Step 5). Se `DOC_TIPI`/`DocumentiUploader` restano orfani, eliminali.

- [ ] **Step 4: Step "Documenti".** Aggiungi uno step dedicato. Nell'array `STEPS` inserisci tra "Parti" e l'ultimo step un elemento `{ id: <n>, label: 'Documenti', title: 'Documenti richiesti', hint: 'Carica i documenti richiesti. La firma avviene in agenzia con gli originali.' }` e rinumera gli step successivi. Aggiungi il blocco `step === <n>` che renderizza banner+griglia (Step 2). Aggiorna i bottoni Avanti/Indietro e gli indici `canStepX` di conseguenza. **Obbligatorietà**: definisci `const docsValidi = esitoSchema.kind === 'OK' && requiredUploadDocs(esitoSchema).every((d) => !!documenti[docKey(d)]);` e usalo per abilitare l'Avanti dello step documenti.

- [ ] **Step 5: Submit.** In `handleFinalSubmit`: rimuovi gli append `venditore_<t>`/`acquirente_<t>`; aggiungi i file documenti come slot `DOC__<docKey>`:
```ts
  for (const [key, f] of Object.entries(documenti)) {
    fd.append(`DOC__${key}`, f);
  }
```
Mantieni invariati gli append esistenti (tipo/veicoli/parti/flag/localizzazione/dichiarazione).

- [ ] **Step 6: Verifica** — `pnpm --filter piattaforma typecheck` + `lint` puliti; `pnpm --filter piattaforma build` PASS; `pnpm --filter piattaforma test` ancora verde.
- [ ] **Step 7: Commit** — `git add "apps/piattaforma/src/app/pratiche/nuova/wizard.tsx" && git commit -m "feat(pratiche): step documenti a card obbligatorie + banner"`

---

### Task 5: Action — validazione + persistenza documenti per chiave

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

- [ ] **Step 1: Ricalcola engine + valida presenza.** In `submitNuovaPraticaAction`, dopo aver parse-ato i dati parti/veicoli, calcola `const esito = calcolaDocumentiRichiesti({ veicoli: ..., venditoreTipoSoggetto: ..., ... })` (usa gli stessi input già usati per il pricing/engine). Se `esito.kind !== 'OK'` → ritorna errore (BLOCCO: messaggio `esito.motivo`; INPUT_INCOMPLETO: "Dati incompleti"). Importa `requiredUploadDocs, docKey, parteToOwner` da `@/lib/documenti/richiesti`.

- [ ] **Step 2: Estrai i file documenti.** Per ogni `d` di `requiredUploadDocs(esito)`: leggi `const f = formData.get('DOC__' + docKey(d));`. Se `!(f instanceof File) || f.size === 0` → ritorna errore "Manca il documento: <docLabel(d)>" (importa anche `docLabel`). Valida MIME/size col gating esistente (riusa `classifyDocumento`/`findBlockingDocuments` come fa già l'action per altri file, se presente).

- [ ] **Step 3: Persisti.** Dentro la transazione di creazione pratica, dopo aver creato `Pratica` e i `Veicolo` (mappa `veicoloOrdine`→`veicolo.id`), per ogni documento richiesto carica il file su storage e crea il `Documento`:
```ts
  // d = documento richiesto; f = file
  const put = await storage.put({ scope: `pratica/${pratica.id}`, buffer, originalFilename: f.name, mimeType: f.type });
  await tx.documento.create({
    data: {
      tipo: d.tipo,
      owner: parteToOwner(d.parte),
      praticaId: pratica.id,
      veicoloId: d.parte === 'VEICOLO' && d.veicoloOrdine ? veicoloIdByOrdine.get(d.veicoloOrdine) ?? null : null,
      storageKey: put.storageKey, storageProvider: put.storageProvider,
      mimeType: put.mimeType, sizeBytes: put.sizeBytes, originalFilename: put.originalFilename,
      uploadedById: <broker user id, come per il libretto>,
      ocrStato: 'NONE', gatingStato: 'PASSED',
    },
  });
```
Adatta i nomi (`storage`, buffer reading, `uploadedById`) a come l'action crea già il `Documento` del libretto. Rimuovi la vecchia raccolta `venditore_<t>`/`acquirente_<t>`.

- [ ] **Step 4: Verifica** — `pnpm --filter piattaforma typecheck` + `lint`; `pnpm --filter piattaforma test` verde (aggiorna eventuali fixture dell'action toccate). `pnpm --filter piattaforma build` PASS.
- [ ] **Step 5: Commit** — `git add "apps/piattaforma/src/app/pratiche/nuova/actions.ts" && git commit -m "feat(pratiche): valida e persiste i documenti richiesti per chiave"`

---

### Task 6: Rifinisci il parser comodato del libretto

**Files:** Modify `apps/piattaforma/src/lib/providers/ocr/libretto-parser.ts`; Modify `apps/piattaforma/src/lib/providers/ocr/libretto-parser.test.ts`

- [ ] **Step 1: Test** — in `libretto-parser.test.ts` aggiungi casi per le varianti reali:
```ts
it('rileva comodato in varie formulazioni', () => {
  expect(parseLibrettoText('... COMODATO D\'USO ...', 0.9).flagComodatoDuso).toBe(true);
  expect(parseLibrettoText('... locazione/comodato ...', 0.9).flagComodatoDuso).toBe(true);
  expect(parseLibrettoText('... CONTRATTO DI COMODATO ...', 0.9).flagComodatoDuso).toBe(true);
});
it('non segnala comodato se assente', () => {
  expect(parseLibrettoText('CARTA DI CIRCOLAZIONE targa AB123CD', 0.9).flagComodatoDuso).toBe(false);
});
```

- [ ] **Step 2: Run, FAIL** se la regex attuale non copre i casi — `pnpm --filter piattaforma test -- libretto-parser`. (La regex attuale `/COMODATO/` su testo uppercase copre già "COMODATO"; verifica che i casi passino. Se passano già, mantieni i test come regressione e salta lo Step 3.)

- [ ] **Step 3: Implement (se serve)** — in `libretto-parser.ts` assicura il match case-insensitive su "COMODATO" (già fa `text.toUpperCase()` poi `/COMODATO/`). Nessuna modifica se i test passano.

- [ ] **Step 4: Run, PASS** — `pnpm --filter piattaforma test -- libretto-parser`.
- [ ] **Step 5: Commit** — `git add apps/piattaforma/src/lib/providers/ocr/libretto-parser.* && git commit -m "test(ocr): copertura rilevamento comodato libretto"`

---

### Task 7: Verifica finale
- [ ] `pnpm --filter piattaforma test` → tutti PASS.
- [ ] `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && pnpm --filter piattaforma build` → PASS.
- [ ] Commit fix eventuali: `git add -A && git commit -m "chore: verifica finale documenti pratica"`.

---

## Note deploy (insieme al deploy tipi-pratica)
Nessuna nuova migration (i documenti usano il modello `Documento` esistente + `veicoloId` già aggiunto). Si deploya insieme al branch tipi-pratica. E2E (chrome-devtools): libretto con comodato → blocco; veicolo pre-2015 → card CdP; submit bloccato se manca un documento richiesto.

## Self-review (eseguita)
- **Copertura spec:** banner (T4), DocCard condiviso (T2), blocco comodato (T3), step documenti a card obbligatorie (T4) guidato da richiesti.ts (T1), CdP condizionale (T1 requiredUploadDocs + engine già emette CERTIFICATO_PROPRIETA per pre-2015 → card automatica), action validazione+persistenza (T5), OCR reale/parser comodato (T6). ✔
- **Tipi coerenti:** `docKey`/`docLabel`/`parteToOwner`/`requiredUploadDocs` usati identici in T1/T4/T5; slot `DOC__<docKey>` coerente tra wizard (T4) e action (T5). ✔
- **Rischi:** rinumerazione step nel wizard (T4) — l'implementer deve aggiornare tutti gli indici `step`/`canStepX`/STEPS coerentemente; mapping parte→owner perde il dettaglio amministratore/procuratore (owner null/lato) — accettato in spec.
