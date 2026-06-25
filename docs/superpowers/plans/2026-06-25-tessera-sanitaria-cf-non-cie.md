# Tessera sanitaria / Codice fiscale obbligatoria quando non CIE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In creazione pratica, per venditore e acquirente, richiedere obbligatoriamente la tessera sanitaria / codice fiscale (solo fronte) quando il soggetto non è identificato con CIE (CI cartacea, passaporto, patente), con verifica presenza + match OCR fail-closed.

**Architecture:** Una regola unica `richiedeCodiceFiscale(tipoSoggetto, docId)` in `lib/documenti/engine.ts` è la fonte di verità. L'engine la usa per emettere il documento `CODICE_FISCALE`; `lib/kyc/parte-docs.ts` la espone via `documentiRichiestiParte` e aggiunge la verifica `verificaCodiceFiscale` (fail-closed). Wizard e Server Action raccolgono lo slot `_CF`, eseguono OCR (`lib/kyc/extract-cf`) e validano con lo stesso modulo puro.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React, TypeScript, Vitest, Prisma/Postgres, Vercel Blob (client upload), Document AI (OCR).

## Global Constraints

- **Node:** `nvm use 22.15.0` prima di qualsiasi comando pnpm (post-riavvio Node torna a 16; pnpm richiede ≥18).
- **Comandi** da `apps/piattaforma`: test mirati `pnpm exec vitest run <path>`; suite `pnpm test`; typecheck `pnpm typecheck`; lint `pnpm lint`; build `pnpm build`.
- **Nessuna migration DB:** l'enum Prisma `DocumentoTipo.CODICE_FISCALE` esiste già.
- **Regola unica (single source of truth):** `richiedeCodiceFiscale(tipoSoggetto, docId) = !(docId === 'CI' && tipoSoggetto === 'PRIVATO_ITALIANO_CIE')`. Definita in `engine.ts`, importata da `parte-docs.ts`; wizard e server la usano sempre via `documentiRichiestiParte(...).codiceFiscale`.
- **Mappatura rep PG → CIE:** per persona giuridica il documento d'identità è del legale rappresentante; il CF è richiesto solo se il rappresentante usa passaporto/patente (la sua CI è trattata come CIE).
- **Copy UI:** card "Tessera sanitaria / Codice fiscale (fronte)". Errore presenza: `Tessera sanitaria / codice fiscale mancante per <parte>`. Etichetta verdetto: `Tessera sanitaria / Codice fiscale`.
- **Slot file:** `VEND<n>_CF` (venditori), `ACQ_CF` (acquirente).
- **Spec di riferimento:** `docs/superpowers/specs/2026-06-25-tessera-sanitaria-cf-non-cie-design.md`.

---

### Task 1: Engine — regola `richiedeCodiceFiscale` + emissione `CODICE_FISCALE`

**Files:**
- Modify: `apps/piattaforma/src/lib/documenti/engine.ts` (`emettiIdentita`, ~righe 86-107)
- Test: `apps/piattaforma/src/lib/documenti/engine.test.ts`

**Interfaces:**
- Produces: `export function richiedeCodiceFiscale(tipoSoggetto: TipoSoggetto, docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE'): boolean`
- Produces: `calcolaDocumentiRichiesti` ora emette un documento `{ tipo: 'CODICE_FISCALE', parte, motivo, venditoreOrdine? }` ogni volta che `richiedeCodiceFiscale` è vero (passaporto, patente, e CI con `tipoSoggetto ≠ PRIVATO_ITALIANO_CIE`).

- [ ] **Step 1: Aggiorna il test che codifica il vecchio comportamento + aggiungi i nuovi test**

In `engine.test.ts`, **sostituisci** il test esistente (righe ~330-341) che asseriva l'assenza del CF con passaporto:

```ts
  it('CI cartacea con passaporto scelto: aggiunge comunque CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA', documentoIdentita: 'PASSAPORTO' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).toContain('CODICE_FISCALE');
  });
```

In `engine.test.ts`, **aggiungi** in fondo al describe `'calcolaDocumentiRichiesti — documento identità alternativo'`:

```ts
  it('venditore passaporto (CIE): PASSAPORTO + CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PASSAPORTO' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('venditore patente: PATENTE + CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PATENTE' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PATENTE');
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('acquirente patente: PATENTE + CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ acquirenteDocumentoIdentita: 'PATENTE' }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAcq = r.documentiRichiesti.filter((d) => d.parte === 'ACQUIRENTE').map((d) => d.tipo);
    expect(tipiAcq).toContain('PATENTE');
    expect(tipiAcq).toContain('CODICE_FISCALE');
  });

  it('CIE + CI: nessun CODICE_FISCALE (venditore e acquirente)', () => {
    const r = calcolaDocumentiRichiesti(baseInput());
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.documentiRichiesti.map((d) => d.tipo)).not.toContain('CODICE_FISCALE');
  });

  it('straniero extra-UE + CI: CODICE_FISCALE richiesto', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'STRANIERO_EXTRA_UE', documentoIdentita: 'CI' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('rep azienda con CI: nessun CODICE_FISCALE (CI del rappresentante trattata come CIE)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'AZIENDA', documentoIdentita: 'CI' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAmm = r.documentiRichiesti
      .filter((d) => d.parte === 'AMMINISTRATORE_VENDITORE')
      .map((d) => d.tipo);
    expect(tipiAmm).not.toContain('CODICE_FISCALE');
  });

  it('rep operatore auto con passaporto: CODICE_FISCALE richiesto', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'OPERATORE_AUTO', documentoIdentita: 'PASSAPORTO' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAmm = r.documentiRichiesti
      .filter((d) => d.parte === 'AMMINISTRATORE_VENDITORE')
      .map((d) => d.tipo);
    expect(tipiAmm).toContain('CODICE_FISCALE');
  });
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd apps/piattaforma && pnpm exec vitest run src/lib/documenti/engine.test.ts`
Expected: FAIL — i nuovi test su CODICE_FISCALE falliscono (l'engine oggi emette CF solo per CARTACEA+CI), incluso il test invertito CARTACEA+PASSAPORTO.

- [ ] **Step 3: Implementa la regola e l'emissione**

In `engine.ts`, **aggiungi** la funzione esportata subito sopra `emettiIdentita` (dopo i tipi, ~riga 85):

```ts
/**
 * Regola unica tessera sanitaria / codice fiscale: richiesto SEMPRE tranne
 * quando il documento è una CI e il soggetto è identificato con CIE (la CIE
 * contiene già il codice fiscale). Vale per passaporto/patente di qualsiasi
 * soggetto e per la CI cartacea. Single source of truth condivisa con
 * lib/kyc/parte-docs.
 */
export function richiedeCodiceFiscale(
  tipoSoggetto: TipoSoggetto,
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
): boolean {
  return !(docIdentita === 'CI' && tipoSoggetto === 'PRIVATO_ITALIANO_CIE');
}
```

**Sostituisci** l'intero corpo di `emettiIdentita` (righe ~86-107) con:

```ts
function emettiIdentita(
  out: DocumentoRichiesto[],
  parte: ParteDocumento,
  motivoPrefix: string,
  tipoSoggetto: TipoSoggetto,
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
  venditoreOrdine?: number,
): void {
  if (docIdentita === 'PASSAPORTO') {
    out.push({ tipo: 'PASSAPORTO', parte, motivo: `${motivoPrefix}: passaporto`, venditoreOrdine });
  } else if (docIdentita === 'PATENTE') {
    out.push({ tipo: 'PATENTE', parte, motivo: `${motivoPrefix}: patente`, venditoreOrdine });
  } else {
    out.push({ tipo: 'CI_FRONTE', parte, motivo: `${motivoPrefix}: CI fronte`, venditoreOrdine });
    out.push({ tipo: 'CI_RETRO', parte, motivo: `${motivoPrefix}: CI retro`, venditoreOrdine });
  }
  if (richiedeCodiceFiscale(tipoSoggetto, docIdentita)) {
    out.push({
      tipo: 'CODICE_FISCALE',
      parte,
      motivo: `${motivoPrefix}: tessera sanitaria / codice fiscale`,
      venditoreOrdine,
    });
  }
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `cd apps/piattaforma && pnpm exec vitest run src/lib/documenti/engine.test.ts`
Expected: PASS (tutti, inclusi i test base che continuano a NON contenere CODICE_FISCALE per CIE+CI).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/documenti/engine.ts apps/piattaforma/src/lib/documenti/engine.test.ts
git commit -m "feat(documenti): CODICE_FISCALE richiesto quando l'identificazione non è CIE"
```

---

### Task 2: parte-docs — requisito + verifica `verificaCodiceFiscale` fail-closed

**Files:**
- Modify: `apps/piattaforma/src/lib/kyc/parte-docs.ts`
- Test: `apps/piattaforma/src/lib/kyc/parte-docs.test.ts`

**Interfaces:**
- Consumes: `richiedeCodiceFiscale` da `../documenti/engine` (Task 1).
- Produces: `ParteDati.documentoIdentita?: 'CI' | 'PASSAPORTO' | 'PATENTE'`.
- Produces: `DocRequisiti.codiceFiscale: boolean`.
- Produces: `OcrParte.codiceFiscale?: { codiceFiscale?: string }`.
- Produces: `export function verificaCodiceFiscale(expectedCf: string | undefined, e: { codiceFiscale?: string } | undefined): Verdetto`.
- Produces: `validaParte` blocca (problemi non vuoti) quando `req.codiceFiscale` e il CF è assente/illeggibile o non corrisponde.

- [ ] **Step 1: Aggiorna i test della matrice esistenti + aggiungi i nuovi test**

In `parte-docs.test.ts`, **sostituisci** il describe `'documentiRichiestiParte'` (righe ~33-44) con:

```ts
describe('documentiRichiestiParte', () => {
  it('privato CIE+CI → identità, niente CF', () => {
    expect(documentiRichiestiParte(PRIVATO)).toEqual({
      identita: true, visura: false, permesso: false, codiceFiscale: false,
    });
  });
  it('privato cartacea+CI → CF richiesto', () => {
    expect(
      documentiRichiestiParte({ ...PRIVATO, tipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA' }).codiceFiscale,
    ).toBe(true);
  });
  it('privato CIE + passaporto → CF richiesto', () => {
    expect(documentiRichiestiParte({ ...PRIVATO, documentoIdentita: 'PASSAPORTO' }).codiceFiscale).toBe(true);
  });
  it('privato CIE + patente → CF richiesto', () => {
    expect(documentiRichiestiParte({ ...PRIVATO, documentoIdentita: 'PATENTE' }).codiceFiscale).toBe(true);
  });
  it('straniero (default CI) → identità + permesso + CF', () => {
    expect(documentiRichiestiParte(STRANIERO)).toEqual({
      identita: true, visura: false, permesso: true, codiceFiscale: true,
    });
  });
  it('azienda rep CI → identità + visura, niente CF', () => {
    expect(documentiRichiestiParte(AZIENDA)).toEqual({
      identita: true, visura: true, permesso: false, codiceFiscale: false,
    });
    expect(documentiRichiestiParte({ ...AZIENDA, tipoSoggetto: 'OPERATORE_AUTO' }).visura).toBe(true);
  });
  it('azienda rep passaporto → CF richiesto', () => {
    expect(documentiRichiestiParte({ ...AZIENDA, documentoIdentita: 'PASSAPORTO' }).codiceFiscale).toBe(true);
  });
});
```

In `parte-docs.test.ts`, **aggiorna l'import** in cima per includere `verificaCodiceFiscale`:

```ts
import {
  documentiRichiestiParte,
  verificaIdentita,
  verificaVisura,
  verificaPermesso,
  verificaCodiceFiscale,
  validaParte,
  type ParteDati,
} from './parte-docs';
```

In `parte-docs.test.ts`, **sostituisci** il test esistente `'straniero: identità + permesso validi → ok'` (righe ~116-123) con (ora serve anche il CF, perché lo straniero non è CIE):

```ts
  it('straniero: identità + permesso + CF validi → ok', () => {
    const r = validaParte(
      STRANIERO,
      {
        identita: { nome: 'John', cognome: 'Smith' },
        permesso: { nome: 'John', cognome: 'Smith', scadenza: '2027-01-01' },
        codiceFiscale: { codiceFiscale: 'SMTJHN80A01Z404X' },
      },
      NOW,
    );
    expect(r.ok).toBe(true);
  });
```

In `parte-docs.test.ts`, **aggiungi** un nuovo describe in fondo al file:

```ts
describe('verificaCodiceFiscale', () => {
  it('CF estratto uguale a quello inserito → MATCH', () => {
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', { codiceFiscale: 'rssmra80a01f205z' })).toBe('MATCH');
  });
  it('CF estratto diverso → MISMATCH', () => {
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', { codiceFiscale: 'BNCLNZ70A01F205X' })).toBe('MISMATCH');
  });
  it('niente CF estratto → ILLEGGIBILE', () => {
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', undefined)).toBe('ILLEGGIBILE');
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', {})).toBe('ILLEGGIBILE');
  });
  it('CF atteso assente (rep PG senza CF anagrafico) ma estratto leggibile → MATCH', () => {
    expect(verificaCodiceFiscale(undefined, { codiceFiscale: 'RSSMRA80A01F205Z' })).toBe('MATCH');
  });
});

describe('validaParte — tessera sanitaria / CF fail-closed', () => {
  const CARTACEA: ParteDati = {
    isPersonaGiuridica: false,
    tipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA',
    documentoIdentita: 'CI',
    nome: 'Mario',
    cognome: 'Rossi',
    cf: 'RSSMRA80A01F205Z',
  };
  it('CF richiesto ma mancante → blocco', () => {
    const r = validaParte(CARTACEA, { identita: { codiceFiscale: 'RSSMRA80A01F205Z' } }, NOW);
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/Tessera sanitaria/);
  });
  it('CF presente ma di altra persona → blocco', () => {
    const r = validaParte(
      CARTACEA,
      { identita: { codiceFiscale: 'RSSMRA80A01F205Z' }, codiceFiscale: { codiceFiscale: 'BNCLNZ70A01F205X' } },
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/Tessera sanitaria/);
  });
  it('CI + CF corrispondenti → ok', () => {
    const r = validaParte(
      CARTACEA,
      { identita: { codiceFiscale: 'RSSMRA80A01F205Z' }, codiceFiscale: { codiceFiscale: 'RSSMRA80A01F205Z' } },
      NOW,
    );
    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd apps/piattaforma && pnpm exec vitest run src/lib/kyc/parte-docs.test.ts`
Expected: FAIL — `verificaCodiceFiscale` non esiste (errore di import) e `documentiRichiestiParte` non ha `codiceFiscale`.

- [ ] **Step 3: Implementa requisito + verifica**

In `parte-docs.ts`, **aggiungi l'import** in cima (sotto gli import esistenti):

```ts
import { richiedeCodiceFiscale } from '../documenti/engine';
```

**Aggiungi** `documentoIdentita` al tipo `ParteDati` (dopo `tipoSoggetto`):

```ts
export type ParteDati = {
  isPersonaGiuridica: boolean;
  tipoSoggetto: TipoSoggettoParte;
  documentoIdentita?: 'CI' | 'PASSAPORTO' | 'PATENTE';
  nome?: string;
  cognome?: string;
  cf?: string;
  ragioneSociale?: string;
  piva?: string;
};
```

**Aggiungi** `codiceFiscale` al tipo `OcrParte`:

```ts
export type OcrParte = {
  identita?: IdentitaEstratta;
  visura?: VisuraEstratta;
  permesso?: PermessoEstratto;
  codiceFiscale?: { codiceFiscale?: string };
};
```

**Aggiungi** `codiceFiscale` al tipo `DocRequisiti`:

```ts
export type DocRequisiti = { identita: boolean; visura: boolean; permesso: boolean; codiceFiscale: boolean };
```

**Sostituisci** `documentiRichiestiParte` con:

```ts
/** Documenti richiesti per la parte in base al tipo soggetto + documento scelto. */
export function documentiRichiestiParte(p: ParteDati): DocRequisiti {
  const pg = isPG(p);
  // Per la PG il documento d'identità è del legale rappresentante: la sua CI è
  // trattata come CIE (niente CF), ma passaporto/patente richiedono comunque il CF.
  const tipoEffettivo = pg ? 'PRIVATO_ITALIANO_CIE' : (p.tipoSoggetto ?? 'PRIVATO_ITALIANO_CIE');
  return {
    identita: true,
    visura: pg,
    permesso: p.tipoSoggetto === 'STRANIERO_EXTRA_UE',
    codiceFiscale: richiedeCodiceFiscale(tipoEffettivo, p.documentoIdentita ?? 'CI'),
  };
}
```

**Aggiungi** la funzione `verificaCodiceFiscale` subito dopo `verificaIdentita`:

```ts
/**
 * Verifica la tessera sanitaria / codice fiscale estratta. Presenza + match
 * fail-closed: senza CF estratto → ILLEGGIBILE; se è atteso un CF (persona
 * fisica: CF inserito; rep PG: CF amministratore della visura) il match è
 * vincolante; senza CF atteso bastano presenza + leggibilità.
 */
export function verificaCodiceFiscale(
  expectedCf: string | undefined,
  e: { codiceFiscale?: string } | undefined,
): Verdetto {
  if (!e || !e.codiceFiscale) return 'ILLEGGIBILE';
  if (!expectedCf) return 'MATCH';
  return normalizeCf(expectedCf) === normalizeCf(e.codiceFiscale) ? 'MATCH' : 'MISMATCH';
}
```

In `messaggio()` non serve modifica (gestisce già qualsiasi `label`).

In `validaParte`, dentro il ramo `if (req.visura) { ... }`, **subito prima della chiusura `}` del blocco** (dopo i controlli identità del rappresentante), aggiungi:

```ts
    if (req.codiceFiscale) {
      push(
        'Tessera sanitaria / Codice fiscale',
        verificaCodiceFiscale(ocr.visura?.amministratore?.codiceFiscale, ocr.codiceFiscale),
      );
    }
```

In `validaParte`, dentro il ramo `else { ... }` (persona fisica), **dopo** `push("Documento d'identità", verificaIdentita(p, ocr.identita));`, aggiungi:

```ts
    if (req.codiceFiscale) {
      push('Tessera sanitaria / Codice fiscale', verificaCodiceFiscale(p.cf, ocr.codiceFiscale));
    }
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `cd apps/piattaforma && pnpm exec vitest run src/lib/kyc/parte-docs.test.ts`
Expected: PASS (inclusi i test ATECO/azienda esistenti, invariati).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/kyc/parte-docs.ts apps/piattaforma/src/lib/kyc/parte-docs.test.ts
git commit -m "feat(kyc): requisito + verifica fail-closed tessera sanitaria/CF in parte-docs"
```

---

### Task 3: Server Action `extractCodiceFiscaleAction`

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (aggiungi action dopo `extractPermessoAction`, ~riga 273; aggiungi import)

**Interfaces:**
- Consumes: `extractCf` da `@/lib/kyc/extract-cf`.
- Produces: `export async function extractCodiceFiscaleAction(ref: FileRef): Promise<ExtractCodiceFiscaleResult>` con `ExtractCodiceFiscaleResult = { ok: true; data: { codiceFiscale?: string } } | { ok: false; error: string }`.

- [ ] **Step 1: Aggiungi l'import di `extractCf`**

In `actions.ts`, vicino agli altri import `@/lib/kyc/*` (dopo la riga 35 `} from '@/lib/kyc/parte-docs';`), aggiungi:

```ts
import { extractCf } from '@/lib/kyc/extract-cf';
```

- [ ] **Step 2: Aggiungi la Server Action**

In `actions.ts`, **subito dopo** la fine di `extractPermessoAction` (riga ~273), aggiungi:

```ts
export type ExtractCodiceFiscaleResult =
  | { ok: true; data: { codiceFiscale?: string } }
  | { ok: false; error: string };

/**
 * OCR della tessera sanitaria / codice fiscale (fronte). Estrae il CF per il
 * cross-check col soggetto (parte-docs). Richiesto quando l'identificazione non
 * è CIE (CI cartacea, passaporto, patente).
 */
export async function extractCodiceFiscaleAction(ref: FileRef): Promise<ExtractCodiceFiscaleResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  if (!ref?.key || ref.size === 0) return { ok: false, error: 'File tessera sanitaria mancante' };
  if (ref.size > MAX_LIBRETTO_BYTES) return { ok: false, error: 'File troppo grande (max 10 MB)' };
  if (!ACCEPTED_MIME.includes(ref.type)) return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG)' };
  try {
    const buffer = await storageGetBuffer(ref.key);
    const ocr = await getOcr();
    const text = (await ocr.extractText({ buffer, mimeType: ref.type, originalFilename: ref.name })).text;
    return { ok: true, data: { codiceFiscale: extractCf(text).codiceFiscale } };
  } catch (e) {
    console.error('[ocr] extractCodiceFiscale failed:', (e as Error).message);
    return { ok: false, error: 'OCR non riuscito sulla tessera sanitaria. Ricarica un file leggibile.' };
  }
}
```

- [ ] **Step 3: Verifica typecheck e lint**

Run: `cd apps/piattaforma && pnpm typecheck && pnpm lint`
Expected: PASS (nessun errore).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): extractCodiceFiscaleAction (OCR tessera sanitaria/CF)"
```

---

### Task 4: Wizard — card upload tessera sanitaria, OCR, completezza, submit

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

**Interfaces:**
- Consumes: `extractCodiceFiscaleAction` (Task 3), `documentiRichiestiParte` (Task 2, già importato).
- Produces: slot `IdentitaFiles.codiceFiscale`, campo `Parte.codiceFiscaleOcr`, slot submit `VEND<n>_CF` / `ACQ_CF`. Nessuna interfaccia consumata da altri task.

- [ ] **Step 1: Aggiungi l'import della nuova action**

In `wizard.tsx`, nell'import da `'./actions'` (righe ~38-43), aggiungi `extractCodiceFiscaleAction,` accanto a `extractPermessoAction,`.

- [ ] **Step 2: Estendi i tipi e gli helper di stato**

In `IdentitaFiles` (righe ~76-83) aggiungi lo slot:

```ts
type IdentitaFiles = {
  fronte?: BlobSlot;
  retro?: BlobSlot;
  single?: BlobSlot;
  permesso?: BlobSlot;
  /** Visura camerale (solo AZIENDA / OPERATORE_AUTO). */
  visura?: BlobSlot;
  /** Tessera sanitaria / codice fiscale (fronte), quando l'identificazione non è CIE. */
  codiceFiscale?: BlobSlot;
};
```

In `identitaUploading` (righe ~104-112) aggiungi lo slot al check:

```ts
function identitaUploading(files: IdentitaFiles): boolean {
  return (
    slotUploading(files.fronte) ||
    slotUploading(files.retro) ||
    slotUploading(files.single) ||
    slotUploading(files.permesso) ||
    slotUploading(files.visura) ||
    slotUploading(files.codiceFiscale)
  );
}
```

In `identitaForStorage` (righe ~244-252) aggiungi la persistenza dello slot prima del `return out;`:

```ts
  if (f.codiceFiscale) out.codiceFiscale = slotForStorage(f.codiceFiscale);
```

In `Parte` (righe ~198-201) aggiungi il campo OCR dopo `permessoOcr?`:

```ts
  permessoOcr?: PermessoEstratto;
  /** OCR tessera sanitaria / codice fiscale (fail-closed) per validaParte. */
  codiceFiscaleOcr?: { codiceFiscale?: string };
```

In `emptyParte` (righe ~203-216) aggiungi `codiceFiscaleOcr: undefined,` dopo `permessoOcr: undefined,`.

- [ ] **Step 3: Aggiungi `runCfOcr`**

In `wizard.tsx`, subito dopo `runPermessoOcr` (chiude ~riga 782), aggiungi:

```ts
  // Verifica documentale — OCR tessera sanitaria / codice fiscale. Salva il
  // risultato grezzo (`codiceFiscaleOcr`) per validaParte. Re-OCR solo al cambio file.
  const runCfOcr = async <P extends Parte>(
    ref: BlobRef,
    onChange: (updater: (p: P) => P) => void,
  ) => {
    try {
      const res = await extractCodiceFiscaleAction(ref);
      if (!res.ok) return;
      onChange((prev) => ({ ...prev, codiceFiscaleOcr: { codiceFiscale: res.data.codiceFiscale } }));
    } catch {
      // best-effort: il verdetto resterà ILLEGGIBILE finché non si ricarica
    }
  };
```

- [ ] **Step 4: Aggiungi la card nel componente `IdentitaSection`**

In `IdentitaSection`, **aggiungi due prop** alla firma (dopo `onInvalidatePermesso`):

Nella destrutturazione dei parametri (righe ~2268-2282) aggiungi `onCfRef,` e `onInvalidateCf,`.
Nel tipo delle props (righe ~2282-2296) aggiungi:

```ts
  onCfRef: (ref: BlobRef) => void;
  onInvalidateCf: () => void;
```

Dopo `const mostraPermesso = ...` (riga ~2299) aggiungi:

```ts
  const mostraCodiceFiscale = documentiRichiestiParte({
    isPersonaGiuridica: isPG,
    tipoSoggetto,
    documentoIdentita: docId,
  }).codiceFiscale;
```

Subito **dopo** il blocco `<div className="mt-4 grid ...">...</div>` del documento principale (chiude ~riga 2388, prima del commento `{/* Visura camerale ... */}`), aggiungi:

```tsx
      {/* Tessera sanitaria / codice fiscale: quando l'identificazione non è CIE
          (CI cartacea, passaporto, patente). Basta il fronte. L'OCR alimenta il
          match fail-closed col CF inserito (validaParte). */}
      {mostraCodiceFiscale && (
        <div className="mt-3">
          <UploadCard
            label="Tessera sanitaria / Codice fiscale (fronte)"
            slot={files.codiceFiscale}
            onSelect={(f) => handleField('codiceFiscale', f, onCfRef, onInvalidateCf)}
            onRemove={() => handleField('codiceFiscale', null, onCfRef, onInvalidateCf)}
          />
        </div>
      )}
```

- [ ] **Step 5: Cabla le prop ai call site (venditore + acquirente)**

Nel call site venditore di `IdentitaSection` (~righe 1003-1044), **dopo** `onInvalidatePermesso={...}` aggiungi:

```tsx
        onCfRef={(ref) =>
          runCfOcr<VenditoreInput>(ref, (upd) =>
            setVenditori((prev) => prev.map((vv, i) => (i === idx ? upd(vv) : vv))),
          )
        }
        onInvalidateCf={() =>
          setVenditori((prev) =>
            prev.map((vv, i) => (i === idx ? { ...vv, codiceFiscaleOcr: undefined } : vv)),
          )
        }
```

Nel call site acquirente (~righe 1498-1530), **dopo** `onInvalidatePermesso={...}` aggiungi:

```tsx
              onCfRef={(ref) =>
                runCfOcr(ref, (updater) => setAcquirente((prev) => updater(prev)))
              }
              onInvalidateCf={() =>
                setAcquirente((prev) => ({ ...prev, codiceFiscaleOcr: undefined }))
              }
```

- [ ] **Step 6: Aggiorna `parteCompleta`, `mancanzeParte`, `verificaDocumentaleParte`**

In `parteCompleta` (righe ~2446-2457) **sostituisci** la costruzione di `req` e aggiungi il check CF:

```ts
  const req = documentiRichiestiParte({
    isPersonaGiuridica: p.isPG,
    tipoSoggetto: p.tipoSoggetto,
    documentoIdentita: docId,
  });
  if (req.identita && !identitaPresente(docId, identita)) return false;
  if (req.codiceFiscale && !identita.codiceFiscale?.ref) return false;
  if (req.visura && !identita.visura?.ref) return false;
  if (req.permesso && !identita.permesso?.ref) return false;
  return true;
```

In `mancanzeParte` (righe ~2471-2478) **sostituisci** la costruzione di `req` e aggiungi la voce CF:

```ts
  const req = documentiRichiestiParte({
    isPersonaGiuridica: p.isPG,
    tipoSoggetto: p.tipoSoggetto,
    documentoIdentita: docId,
  });
  if (req.identita && !identitaPresente(docId, identita)) m.push("documento d'identità");
  if (req.codiceFiscale && !identita.codiceFiscale?.ref) m.push('tessera sanitaria / codice fiscale');
  if (req.visura && !identita.visura?.ref) m.push('visura camerale');
  if (req.permesso && !identita.permesso?.ref) m.push('permesso di soggiorno');
  if (identitaUploading(identita)) m.push('caricamento documenti in corso');
  return m;
```

**Sostituisci** la firma e il corpo di `verificaDocumentaleParte` (righe ~2488-2508) per accettare `docId` e passare l'OCR del CF:

```ts
function verificaDocumentaleParte(
  p: Parte,
  docId: DocIdTipo,
  now: Date,
  atecoAllowed?: AllowedAteco[],
): { ok: boolean; problemi: string[] } {
  const parteDati: ParteDati = {
    isPersonaGiuridica: p.isPG,
    tipoSoggetto: p.tipoSoggetto,
    documentoIdentita: docId,
    nome: p.nome,
    cognome: p.cognome,
    cf: p.cf,
    ragioneSociale: p.ragioneSociale,
    piva: p.piva,
  };
  const ocr: OcrParte = {
    identita: p.identitaOcr,
    visura: p.visuraOcr,
    permesso: p.permessoOcr,
    codiceFiscale: p.codiceFiscaleOcr,
  };
  return validaParte(parteDati, ocr, now, atecoAllowed ? { atecoAllowed } : undefined);
}
```

Aggiorna i due call site (righe ~966-972):

```ts
  const verdettiVenditori = venditori.map((v) => verificaDocumentaleParte(v, v.docId, now));
  const verdettoAcquirente = verificaDocumentaleParte(
    acquirente,
    acquirenteDocId,
    now,
    tipo === 'MINIVOLTURA' ? atecoAllowed : undefined,
  );
```

- [ ] **Step 7: Mappa lo slot CF nel submit**

In `handleFinalSubmit`, nel blocco per-venditore (dopo `if (v.identita.visura?.ref) ...`, ~riga 878) aggiungi:

```ts
      if (v.identita.codiceFiscale?.ref) blobRefs[`VEND${n}_CF`] = v.identita.codiceFiscale.ref;
```

Nel blocco acquirente (dopo `if (acquirenteIdentita.visura?.ref) ...`, ~riga 890) aggiungi:

```ts
    if (acquirenteIdentita.codiceFiscale?.ref) blobRefs['ACQ_CF'] = acquirenteIdentita.codiceFiscale.ref;
```

- [ ] **Step 8: Verifica typecheck, lint e build**

Run: `cd apps/piattaforma && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): upload + OCR tessera sanitaria/CF nel wizard (non-CIE)"
```

---

### Task 5: Server — raccolta, OCR autoritativo e persistenza del CF

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts`

**Interfaces:**
- Consumes: `documentiRichiestiParte` (Task 2), `extractCf` (già importato in Task 3), slot `VEND<n>_CF`/`ACQ_CF` (Task 4).
- Produces: riga `Documento` con `tipo: 'CODICE_FISCALE'` collegata a `owner`/`venditoreId`; verdetto fail-closed lato server.

- [ ] **Step 1: Importa `documentiRichiestiParte`**

In `actions.ts`, nell'import da `'@/lib/kyc/parte-docs'` (righe ~30-35) aggiungi `documentiRichiestiParte,`.

- [ ] **Step 2: Estendi il tipo candidato identità e la raccolta**

In `IdentitaDocCandidate.tipo` (riga ~618) aggiungi `'CODICE_FISCALE'`:

```ts
    tipo: 'CI_FRONTE' | 'CI_RETRO' | 'PASSAPORTO' | 'PATENTE' | 'CODICE_FISCALE' | 'PERMESSO_SOGGIORNO' | 'VISURA_CAMERALE';
```

In `collectIdentita`, **aggiorna la firma** (righe ~645-651) aggiungendo `richiedeCf: boolean`:

```ts
  const collectIdentita = (
    owner: 'VENDITORE' | 'ACQUIRENTE',
    prefix: string,
    documentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
    labelParte: string,
    richiedeCf: boolean,
    venditoreOrdine?: number,
  ): void => {
```

Dentro `collectIdentita`, **subito prima** del blocco `const permesso = getRef(...)` (riga ~686), aggiungi:

```ts
    if (richiedeCf) {
      const cf = getRef(`${prefix}_CF`);
      if (!cf || cf.size === 0) {
        redirect(
          `/pratiche/nuova?error=${encodeURIComponent(
            `Tessera sanitaria / codice fiscale mancante per ${labelParte}`,
          )}`,
        );
      }
      identitaCandidates.push({
        tipo: 'CODICE_FISCALE',
        owner,
        venditoreOrdine,
        ref: validateIdentitaRef(cf!, 'tessera sanitaria / codice fiscale'),
      });
    }
```

- [ ] **Step 3: Calcola `richiedeCf` ai call site di `collectIdentita`**

**Sostituisci** il loop venditori + la chiamata acquirente (righe ~709-715) con:

```ts
  // Un blocco di file identità per ciascun venditore (slot VEND<ordine>_*).
  for (const v of venditori) {
    const label =
      venditori.length > 1 ? `il venditore ${v.ordine}` : 'il venditore';
    const richiedeCf = documentiRichiestiParte({
      isPersonaGiuridica: v.isPG,
      tipoSoggetto: v.tipoSoggetto ?? null,
      documentoIdentita: v.docId,
    }).codiceFiscale;
    collectIdentita('VENDITORE', `VEND${v.ordine}`, v.docId, label, richiedeCf, v.ordine);
  }
  const richiedeCfAcq = documentiRichiestiParte({
    isPersonaGiuridica: d.acquirenteIsPG,
    tipoSoggetto: d.acquirenteTipoSoggetto ?? null,
    documentoIdentita: d.acquirenteDocumentoIdentita,
  }).codiceFiscale;
  collectIdentita('ACQUIRENTE', 'ACQ', d.acquirenteDocumentoIdentita, "l'acquirente", richiedeCfAcq);
```

- [ ] **Step 4: OCR autoritativo del CF in `ocrParteServer`**

In `ocrParteServer`, **subito prima** di `return out;` (riga ~788) aggiungi:

```ts
    const cfRef = getRef(`${prefix}_CF`);
    if (cfRef) {
      const text = (
        await (await getOcr()).extractText({
          buffer: await storageGetBuffer(cfRef.key),
          mimeType: cfRef.type,
          originalFilename: cfRef.name,
        })
      ).text;
      out.codiceFiscale = { codiceFiscale: extractCf(text).codiceFiscale };
    }
```

- [ ] **Step 5: Passa `documentoIdentita` in `partiDaVerificare`**

Nei due literal `ParteDati` di `partiDaVerificare`: nel map venditori (righe ~810-819) aggiungi `documentoIdentita: v.docId,` dopo `tipoSoggetto`; nell'oggetto acquirente (righe ~824-833) aggiungi `documentoIdentita: d.acquirenteDocumentoIdentita,` dopo `tipoSoggetto`.

(La persistenza non richiede modifiche: il loop `identitaUploads` esistente crea già la riga `Documento` per ogni candidato, incluso il nuovo `tipo: 'CODICE_FISCALE'`, con `owner` e `venditoreId`.)

- [ ] **Step 6: Verifica typecheck e lint**

Run: `cd apps/piattaforma && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts
git commit -m "feat(pratiche): raccolta + OCR autoritativo + persistenza tessera sanitaria/CF"
```

---

### Task 6: Verifica finale (suite completa + smoke end-to-end)

**Files:** nessuna modifica di codice attesa (solo eventuali fix emersi).

- [ ] **Step 1: Suite unit completa**

Run: `cd apps/piattaforma && pnpm test`
Expected: PASS (tutti, inclusi engine.test.ts e parte-docs.test.ts).

- [ ] **Step 2: Typecheck + lint + build**

Run: `cd apps/piattaforma && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Smoke manuale (dev)**

Run: `nvm use 22.15.0 && cd apps/piattaforma && pnpm dev` (o dalla root `pnpm dev`).
Checklist (con un utente broker del seed):
1. Nuova pratica → Venditore con tipo soggetto "Privato italiano · CIE elettronica" + documento "Carta d'identità" → la card "Tessera sanitaria / Codice fiscale (fronte)" **non** compare.
2. Cambia documento in "Passaporto" → la card **compare**; idem con "Patente".
3. Cambia tipo soggetto in "Privato italiano · CI cartacea" + documento "Carta d'identità" → la card **compare**.
4. Senza caricare la tessera sanitaria, prova ad avanzare/inviare → il gate segnala "tessera sanitaria / codice fiscale" mancante.
5. Carica un fronte tessera sanitaria con CF coerente col CF inserito → il verdetto documentale diventa valido e l'invio prosegue.
6. Ripeti i punti 1-5 lato Acquirente.
7. (Facoltativo) Azienda venditore con rappresentante "Passaporto" → la card compare nella sezione identità del rappresentante.

- [ ] **Step 4: Commit finale (se ci sono fix)**

```bash
git add -A
git commit -m "test(pratiche): verifica end-to-end tessera sanitaria/CF non-CIE"
```

---

## Self-Review

**Spec coverage:**
- Regola `richiedeCodiceFiscale` (single source of truth) → Task 1. ✓
- Engine emette CODICE_FISCALE per passaporto/patente/CI-non-CIE → Task 1. ✓
- `ParteDati.documentoIdentita`, `DocRequisiti.codiceFiscale`, `OcrParte.codiceFiscale`, `verificaCodiceFiscale`, `validaParte` fail-closed (persona fisica + rep PG) → Task 2. ✓
- `extractCodiceFiscaleAction` → Task 3. ✓
- Wizard: slot, card condizionale, runCfOcr, completezza/uploading/storage, submit `_CF`, verificaDocumentaleParte+docId → Task 4. ✓
- Server: collectIdentita (+presenza), ocrParteServer, partiDaVerificare, persistenza Documento CODICE_FISCALE → Task 5. ✓
- `richiesti.ts` invariato (CODICE_FISCALE resta in TIPI_RACCOLTI_NELLA_PARTE) → nessuna modifica necessaria, coperto dalla raccolta nello step parte. ✓
- Boundary rep-PG con CI → no CF (mappatura rep→CIE) → Task 1 (hardcode esistente) + Task 2 (tipoEffettivo). ✓
- Verifica testing engine + parte-docs → Task 1, Task 2; smoke end-to-end → Task 6. ✓
- Nessuna migration → Global Constraints. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step di codice mostra il codice completo. ✓

**Type consistency:** `richiedeCodiceFiscale(tipoSoggetto, docIdentita)` con union `'CI'|'PASSAPORTO'|'PATENTE'` coerente in engine/parte-docs/wizard/server; `OcrParte.codiceFiscale: { codiceFiscale?: string }` coerente tra produttore (`extractCodiceFiscaleAction`/`ocrParteServer`) e consumatore (`verificaCodiceFiscale`); `DocRequisiti.codiceFiscale: boolean` usato in wizard/server via `documentiRichiestiParte(...).codiceFiscale`; slot `VEND<n>_CF`/`ACQ_CF` coerenti tra submit (Task 4) e raccolta (Task 5). ✓

**Nota transitoria (intermedi tra commit):** tra Task 2 e Task 5 la verifica `validaParte` impone il CF mentre UI/raccolta non sono complete; ogni commit resta verde su unit test + typecheck, e il flusso end-to-end è validato in Task 6. Atteso e accettato per una feature trasversale a più file.
