# Migliorie wizard creazione pratica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (T1) riportare il "Tipo soggetto" del venditore con i suoi dati; (T2) bordi rossi live+reveal sui campi/card problematici dei 4 step; (T3) upload opzionale (solo allegato) del libretto originale nel caso foglio complementare.

**Architecture:** T2 introduce un context locale `FieldErrors` (touched-set + reveal-per-step + helper puro `computeInvalid`) e collega i prop `invalid` già esistenti dei componenti UI. T1 sposta solo il punto di rendering. T3 aggiunge slot/handler senza OCR e riusa i tipi Documento esistenti (nessuna migration).

**Tech Stack:** Next.js 16 (client component wizard), Prisma 5, Vitest, TypeScript.

## Global Constraints
- File principale: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` (~3400 righe, client component) + `actions.ts` (submit) + `upload-card.tsx`.
- **Nessun cambio schema Prisma / nessuna migration** (T3 riusa i tipi Documento `LIBRETTO_CIRCOLAZIONE`/`_RETRO`/`FOGLIO_COMPLEMENTARE` esistenti).
- Test singolo file: `pnpm --filter piattaforma exec vitest run <path>`; suite: `pnpm --filter piattaforma test`; typecheck: `pnpm --filter piattaforma typecheck`; lint: `pnpm --filter piattaforma lint`.
- Se `pnpm` lamenta Node: `export PATH="/c/nvm4w/nodejs:$PATH"` (o `nvm use 22.15.0`).
- Commit dopo ogni task verde. Branch `feat/wizard-pratica-migliorie`. Commit italiano, prefisso `feat(pratiche):`/`fix(pratiche):`/`refactor(pratiche):`.
- Componenti con prop `invalid` già disponibili: `Input`, `Select`, `NumberInput` (`@/components/ui`), `UploadCard` (`./upload-card`). `Field` ha `error`.
- Spec: `docs/superpowers/specs/2026-07-07-wizard-pratica-migliorie-design.md`.
- **Vincolo UX T2:** la pagina non deve MAI aprirsi con bordi rossi. `invalid = (touched || reveal) && !valid`; upload card obbligatorie: solo `reveal && mancante` (mai "touched").

---

## Task 1: Tipo soggetto del venditore con i dati (mirror acquirente)

**Files:** Modify `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`.

Contesto: in `renderVenditore` la card dati mostra `<ParteForm parte={v} .../>` SENZA tipo soggetto, e la successiva `<IdentitaSection .../>` mostra il tipo soggetto INLINE (default). Acquirente/co-acquirente invece mettono un `<Field label="Tipo soggetto">` in cima alla card dati e passano `hideTipoSoggetto` alla IdentitaSection.

- [ ] **Step 1: Sposta il selettore nel venditore**

In `renderVenditore`, dentro la card dati (il `<div>` che contiene `<ParteForm parte={v} .../>`, ~righe 1490-1510), inserisci PRIMA di `<ParteForm ...>` il selettore, replicando la logica già passata come `onTipoSoggetto` alla IdentitaSection del venditore:

```tsx
        <Field label="Tipo soggetto" required>
          <Select
            value={v.tipoSoggetto ?? ''}
            onChange={(e) => {
              const next = e.target.value as TipoSoggetto;
              const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
              updateVenditore(v.id, {
                tipoSoggetto: next,
                isPG,
                visuraOcr: isPG ? v.visuraOcr : undefined,
                permessoOcr: next === 'STRANIERO_EXTRA_UE' ? v.permessoOcr : undefined,
              });
            }}
          >
            <option value="" disabled>
              Seleziona tipo…
            </option>
            {TIPI_SOGGETTO_VENDITORE.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="my-3 h-px bg-pv-slate-200" />
```

- [ ] **Step 2: Passa `hideTipoSoggetto` alla IdentitaSection del venditore**

Nella `<IdentitaSection>` del venditore (~riga 1512), aggiungi il prop `hideTipoSoggetto` (come fanno acquirente/co-acquirente). Lascia invariati gli altri prop (incluso `onTipoSoggetto`, ancora usato internamente se il selettore fosse mostrato, ma ora nascosto).

- [ ] **Step 3: Aggiorna i commenti stale**

- In `IdentitaSection` (~riga 2990-2992) il commento "Default: mostrato inline (venditore)" non è più vero: aggiorna a "Il tipo soggetto è reso esternamente sopra i dati per tutte le parti (venditore/acquirente/co-acquirente); qui `hideTipoSoggetto` lo nasconde sempre."
- In `ParteForm` (~riga 2867-2870) il commento dice che il tipo soggetto è scelto nella IdentitaSection: aggiorna a "il tipo soggetto è scelto in cima a questa card (fuori da ParteForm); qui restano anagrafica e contatti."

- [ ] **Step 4: Typecheck + verifica**

Run: `pnpm --filter piattaforma typecheck` → clean. Verifica di ragionamento: il valore `v.tipoSoggetto` è lo stesso stato di prima → submit e documenti richiesti invariati; cambia solo dove appare il selettore.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/fsiol/Desktop/passaggio_veloce add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git -C /c/Users/fsiol/Desktop/passaggio_veloce commit -m "feat(pratiche): tipo soggetto del venditore in cima ai dati (come acquirente)"
```

---

## Task 2: Meccanismo FieldErrors + wiring Step 4

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/nuova/field-errors.tsx`
- Create test: `apps/piattaforma/src/app/pratiche/nuova/field-errors.test.ts`
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`

**Interfaces (Produces):**
- `computeInvalid({ touched, reveal, valid }): boolean`
- `FieldErrorsProvider` (React context provider)
- `useFieldErrors(): { isInvalid(key, valid): boolean; touch(key): void; reveal(): void; resetReveal(): void }`

- [ ] **Step 1: Test puro `computeInvalid` (TDD)**

Crea `apps/piattaforma/src/app/pratiche/nuova/field-errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeInvalid } from './field-errors';

describe('computeInvalid', () => {
  it('mai invalid se non toccato e non reveal (apertura pagina)', () => {
    expect(computeInvalid({ touched: false, reveal: false, valid: false })).toBe(false);
    expect(computeInvalid({ touched: false, reveal: false, valid: true })).toBe(false);
  });
  it('invalid se toccato e non valido', () => {
    expect(computeInvalid({ touched: true, reveal: false, valid: false })).toBe(true);
  });
  it('non invalid se toccato ma valido', () => {
    expect(computeInvalid({ touched: true, reveal: false, valid: true })).toBe(false);
  });
  it('invalid se reveal e non valido, anche non toccato', () => {
    expect(computeInvalid({ touched: false, reveal: true, valid: false })).toBe(true);
  });
  it('non invalid se reveal ma valido', () => {
    expect(computeInvalid({ touched: false, reveal: true, valid: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/field-errors.test.ts` → FAIL (modulo non esiste).

- [ ] **Step 3: Implementa `field-errors.tsx`**

Crea `apps/piattaforma/src/app/pratiche/nuova/field-errors.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** Un campo è "in errore" solo se è stato toccato (blur) oppure se lo step è in
 *  reveal (clic sul CTA disabilitato), e non è valido. Alla prima apertura
 *  (né touched né reveal) nessun campo è in errore. Puro, testabile. */
export function computeInvalid(args: { touched: boolean; reveal: boolean; valid: boolean }): boolean {
  return (args.touched || args.reveal) && !args.valid;
}

type FieldErrorsCtx = {
  isInvalid: (key: string, valid: boolean) => boolean;
  touch: (key: string) => void;
  reveal: () => void;
  resetReveal: () => void;
};

const Ctx = createContext<FieldErrorsCtx | null>(null);

/** Provider a livello wizard. `reveal` vale per lo step corrente (si azzera al
 *  cambio step via `resetReveal`). `touched` persiste per l'intera sessione. */
export function FieldErrorsProvider({ children }: { children: ReactNode }) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);

  const touch = useCallback((key: string) => {
    setTouched((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const reveal = useCallback(() => setRevealed(true), []);
  const resetReveal = useCallback(() => setRevealed(false), []);
  const isInvalid = useCallback(
    (key: string, valid: boolean) => computeInvalid({ touched: touched.has(key), reveal: revealed, valid }),
    [touched, revealed],
  );

  const value = useMemo(
    () => ({ isInvalid, touch, reveal, resetReveal }),
    [isInvalid, touch, reveal, resetReveal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFieldErrors(): FieldErrorsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFieldErrors deve stare dentro FieldErrorsProvider');
  return ctx;
}
```

- [ ] **Step 4: Verifica pass**

Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/field-errors.test.ts` → PASS (5/5).

- [ ] **Step 5: Avvolgi il wizard nel provider + reveal/reset**

In `wizard.tsx`:
- Import: `import { FieldErrorsProvider, useFieldErrors } from './field-errors';`.
- Avvolgi il contenuto renderizzato dal componente wizard nel `<FieldErrorsProvider>`. Se il componente principale è quello che tiene lo stato (`step`, ecc.), estrai il corpo in un sotto-componente interno che usa `useFieldErrors()`, oppure aggiungi il provider al top del return e usa il context nei sotto-componenti. **Approccio consigliato**: rendere il provider il wrapper più esterno del `return (<> … </>)` del wizard, e leggere il context nei punti di rendering tramite un piccolo hook `const fe = useFieldErrors();` all'inizio del corpo (il corpo del wizard deve quindi stare in un componente figlio del provider — estrai `WizardBody`). Documenta la scelta nel report se estrai `WizardBody`.
- Negli `onClick` dei bottoni "Avanti/Invia" che oggi fanno `if (!canStepN) return avvisaMancanze(mancanzeStepN());` (righe ~2056, 2185, 2403, 2542), aggiungi la chiamata `fe.reveal();` PRIMA del `return avvisaMancanze(...)`. Es.:

```tsx
                onClick={() => {
                  if (!canStep2) { fe.reveal(); return avvisaMancanze(mancanzeStep2()); }
                  setStep(3);
                }}
```

- In `setStep` (o dove si cambia step), chiama `fe.resetReveal()` quando lo step cambia. Se `setStep` è il setter di stato diretto, crea un wrapper `const goStep = (s: number) => { fe.resetReveal(); setStep(s); }` e usalo nei bottoni di navigazione (Avanti/Indietro), oppure aggiungi un `useEffect(() => { resetReveal(); }, [step])` nel WizardBody.

- [ ] **Step 6: Wiring Step 4 (sede/comune/provincia) — prova end-to-end del meccanismo**

Nello step 4 (~righe 2400-2540), collega `invalid` ai 3 campi (il selettore sede è già `invalid={!brokerSedeId}` a riga 2428 — sostituiscilo col meccanismo):
- Sede (`brokerSedeId`): `invalid={fe.isInvalid('step4:sede', brokerSedeId.length > 0)}` (nessun touch: si accende solo al reveal, come le select/campi obbligatori — oppure aggiungi `onBlur={() => fe.touch('step4:sede')}` se è un Select).
- Comune (Input): `invalid={fe.isInvalid('step4:comune', comune.trim().length > 0)}` + `onBlur={() => fe.touch('step4:comune')}`.
- Provincia (Input): `invalid={fe.isInvalid('step4:provincia', /^[A-Za-z]{2}$/.test(provincia.trim()))}` + `onBlur={() => fe.touch('step4:provincia')}`.

- [ ] **Step 7: Typecheck + test**

Run: `pnpm --filter piattaforma typecheck` → clean.
Run: `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova/field-errors.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git -C /c/Users/fsiol/Desktop/passaggio_veloce add apps/piattaforma/src/app/pratiche/nuova/field-errors.tsx apps/piattaforma/src/app/pratiche/nuova/field-errors.test.ts apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git -C /c/Users/fsiol/Desktop/passaggio_veloce commit -m "feat(pratiche): meccanismo bordi rossi (FieldErrors live+reveal) + wiring step 4"
```

---

## Task 3: Wiring bordi Step 1 (card veicolo)

**Files:** Modify `wizard.tsx` (il componente card veicolo, ~riga 2620+, e le sue chiamate).

Il componente card veicolo riceve `veicolo`, `ordine`, ecc. Aggiungi un prefisso chiave `veic:${ordine}` (o l'indice) e collega `invalid` ai campi già in `mancanzeStep1`. Usa `const fe = useFieldErrors();` nel componente (è figlio del provider).

- [ ] **Step 1: Campi anagrafici veicolo (mostrati quando `mostraCampi`)**

Per ciascun input della sezione dati veicolo (targa/telaio/proprietario/data immatricolazione/prezzo), aggiungi `invalid` + `onBlur` con la chiave `veic:${ordine}:<campo>` e il predicato di validità di `mancanzeStep1`:
- `targa`: valid = `veicolo.targa.length >= 5`.
- `telaio`: valid = `veicolo.telaio.length >= 11`.
- `proprietarioAttuale`: valid = `!!veicolo.proprietarioAttuale.trim()`.
- `dataImmatricolazione`: valid = `/^\d{4}-\d{2}-\d{2}$/.test(veicolo.dataImmatricolazione)`.
- `prezzoVendita`: valid = `Number(veicolo.prezzoVendita) > 0`.

Pattern (esempio targa):

```tsx
<Input
  value={veicolo.targa}
  onChange={/* invariato */}
  onBlur={() => fe.touch(`veic:${ordine}:targa`)}
  invalid={fe.isInvalid(`veic:${ordine}:targa`, veicolo.targa.length >= 5)}
/>
```

(Leggi la sezione `mostraCampi` ~righe 2767+ per gli input esatti e i loro handler `onChange`; NON toccare gli `onChange`, aggiungi solo `onBlur`+`invalid`.)

- [ ] **Step 2: Card documento mancante (solo reveal)**

Le UploadCard del documento veicolo si accendono solo al reveal (mancante):
- Modalità libretto: `<UploadCard label="Libretto — fronte" ... invalid={fe.isInvalid(\`veic:${ordine}:libFronte\`, !!veicolo.libretto.ref)} />` e analogo per il retro (`!!veicolo.librettoRetro.ref`). NON chiamare `touch` per gli upload.
- Modalità foglio: `<UploadCard label="Foglio complementare" ... invalid={fe.isInvalid(\`veic:${ordine}:foglio\`, !!veicolo.foglioComplementare.ref)} />`.

(Nota: l'`erroreUpload` accende già il rosso da sé; il prop `invalid` aggiunge il caso "obbligatorio mancante al reveal".)

- [ ] **Step 3: Certificato di proprietà (se `preImm2015`)**

Se esiste una UploadCard dedicata al certificato di proprietà per veicoli `preImm2015` (vedi `cdpDocKey`), collega `invalid={fe.isInvalid(\`veic:${ordine}:cdp\`, !!documenti[cdpDocKey(ordine)]?.ref)}` (solo reveal). Se il certificato è gestito altrove nel wizard e non in questa card, applica lo stesso pattern nel punto di rendering corretto (cerca `cdpDocKey`/`certificato di proprietà`).

- [ ] **Step 4: Typecheck + verifica**

Run: `pnpm --filter piattaforma typecheck` → clean. Verifica: aprendo lo step 1 nessun bordo rosso; digitando una targa corta e uscendo → rosso; clic "Avanti" con documento mancante → card rossa.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/fsiol/Desktop/passaggio_veloce add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git -C /c/Users/fsiol/Desktop/passaggio_veloce commit -m "feat(pratiche): bordi rossi step 1 (dati veicolo + card documento)"
```

---

## Task 4: Wiring bordi Step 2/3 (ParteForm + IdentitaSection)

**Files:** Modify `wizard.tsx` (`ParteForm`, `IdentitaSection`, e le loro chiamate in renderVenditore/step acquirente/renderCoAcquirente).

Strategia: aggiungere un prop `fieldPrefix: string` a `ParteForm` e `IdentitaSection`; ogni chiamante passa un prefisso univoco (`vend:${v.id}`, `acq`, `co:${c.id}`). I componenti usano `const fe = useFieldErrors();`.

- [ ] **Step 1: `ParteForm` con `fieldPrefix` + invalid**

Aggiorna `ParteForm` (~2860) firma → `{ parte, onChange, fieldPrefix }: { parte: Parte; onChange: (p: Parte) => void; fieldPrefix: string }`. Aggiungi `const fe = useFieldErrors();` e collega ogni Input:
- `ragioneSociale`: valid = `!!parte.ragioneSociale.trim()`, key `${fieldPrefix}:ragioneSociale`.
- `piva`: valid = `parte.piva.length === 11`, key `${fieldPrefix}:piva`.
- `nome`: valid = `!!parte.nome.trim()`, key `${fieldPrefix}:nome`.
- `cognome`: valid = `!!parte.cognome.trim()`, key `${fieldPrefix}:cognome`.
- `cf`: valid = `parte.cf.trim().length === 16`, key `${fieldPrefix}:cf`.
- `telefono`: valid = `!!parte.telefono.trim()`, key `${fieldPrefix}:telefono`.
- `email`: valid = `EMAIL_RE.test(parte.email.trim())`, key `${fieldPrefix}:email`.

Per ciascun `<Input>` aggiungi `onBlur={() => fe.touch('<key>')}` e `invalid={fe.isInvalid('<key>', <valid>)}` (senza toccare l'`onChange`). `EMAIL_RE` è già in `wizard.tsx` (usato in `mancanzeParte`).

- [ ] **Step 2: Selettori "Tipo soggetto" esterni (venditore/acquirente/co-acquirente)**

Per i 3 `<Select>` del tipo soggetto (venditore da Task 1, acquirente ~2213, co-acquirente ~1616), aggiungi `invalid={fe.isInvalid('${prefix}:tipoSoggetto', !!<parte>.tipoSoggetto)}` (Select accende solo al reveal; opzionale `onBlur` per touch). Prefissi: `vend:${v.id}`, `acq`, `co:${c.id}`.

- [ ] **Step 3: Upload in `IdentitaSection` (solo reveal)**

Aggiungi a `IdentitaSection` il prop `fieldPrefix: string`, `const fe = useFieldErrors();`, e collega `invalid` alle UploadCard obbligatorie in base a cosa è richiesto (`documentiRichiestiParte` è già calcolato nel componente: `mostraVisura`, `mostraPermesso`, `mostraCodiceFiscale`):
- Documento identità (fronte/single): `invalid={fe.isInvalid(\`${fieldPrefix}:idFronte\`, /* ref presente */)}`.
- Codice fiscale fronte/retro (se `mostraCodiceFiscale`): key `${fieldPrefix}:cfFronte`/`:cfRetro`.
- Visura (se `mostraVisura`): key `${fieldPrefix}:visura`.
- Permesso (se `mostraPermesso`): key `${fieldPrefix}:permesso`.
Usa `!!files.<campo>?.ref` come predicato di validità. Solo reveal (nessun touch sugli upload).

- [ ] **Step 4: Passa `fieldPrefix` dai 3 chiamanti**

- `renderVenditore`: `<ParteForm parte={v} onChange=... fieldPrefix={\`vend:${v.id}\`} />` e `<IdentitaSection ... fieldPrefix={\`vend:${v.id}\`} />`.
- Step acquirente (~2239, 2242): `<ParteForm parte={acquirente} ... fieldPrefix="acq" />` e `<IdentitaSection ... fieldPrefix="acq" />`.
- `renderCoAcquirente` (~1641, 1644): `fieldPrefix={\`co:${c.id}\`}` su entrambi.

- [ ] **Step 5: Indirizzo residenza (se "residenza diversa")**

Dove si rende l'input dell'indirizzo di residenza (per acquirente/co-acquirente quando `residenzaDiversa`), collega `invalid={fe.isInvalid('${prefix}:residenza', !!<indirizzo>.trim())}` + `onBlur`. (Cerca `indirizzoResidenza`/`residenzaDiversa` nel render.)

- [ ] **Step 6: Typecheck + verifica**

Run: `pnpm --filter piattaforma typecheck` → clean. Verifica: nessun bordo all'apertura di step 2/3; CF a 10 caratteri + blur → rosso; clic "Avanti" con email vuota → rosso.

- [ ] **Step 7: Commit**

```bash
git -C /c/Users/fsiol/Desktop/passaggio_veloce add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git -C /c/Users/fsiol/Desktop/passaggio_veloce commit -m "feat(pratiche): bordi rossi step 2/3 (parte + documenti)"
```

---

## Task 5: Libretto originale opzionale nel foglio complementare

**Files:** Modify `wizard.tsx` (tipo `VeicoloInput`, init, handler upload, card veicolo, submit) e `actions.ts` (parse ref + creazione Documento).

- [ ] **Step 1: Slot nel tipo `VeicoloInput` + init**

In `VeicoloInput` (~riga 137) aggiungi due campi: `librettoOrigFronte: BlobSlot;` e `librettoOrigRetro: BlobSlot;`. Nella factory che crea un veicolo (~riga 166, dove si init `libretto: emptySlot()`, ecc.) aggiungi `librettoOrigFronte: emptySlot(), librettoOrigRetro: emptySlot()`. In `slotForStorage` (~riga 330) includi anche i due slot orig se là si serializzano per la bozza.

- [ ] **Step 2: Handler upload SENZA OCR**

Aggiungi due handler (accanto a `onFronte`/`onRetro`, ~riga 848-947) `onLibrettoOrigFronte(idx, file)` / `onLibrettoOrigRetro(idx, file)` che caricano su Blob e aggiornano gli slot `librettoOrigFronte`/`librettoOrigRetro`, MA **non** chiamano `runLibrettoOcr` (copia la struttura di `onFronte` rimuovendo il blocco OCR). Al remove (file undefined) azzerano lo slot. Reset degli slot orig quando si torna a "Libretto" (nel punto ~riga 1035-1044 dove si azzerano `libretto`/`librettoRetro` sul cambio `tipoDocumento`: azzera anche `librettoOrigFronte`/`librettoOrigRetro`).

- [ ] **Step 3: UI nel ramo foglio**

Nel ramo `isFoglio` della card veicolo (~riga 2682-2698), dopo l'UploadCard del foglio, aggiungi due UploadCard **opzionali**:

```tsx
          <p className="mt-4 mb-2 text-[12.5px] text-pv-slate-500">
            Facoltativo: puoi allegare anche il <strong>libretto originale</strong> (fronte/retro),
            se ne sei in possesso. Non è obbligatorio e non viene letto automaticamente.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UploadCard
              label="Libretto originale — fronte (facoltativo)"
              slot={veicolo.librettoOrigFronte}
              onSelect={(f) => onLibrettoOrigFronte(ordine - 1, f ?? undefined)}
              onRemove={() => onLibrettoOrigFronte(ordine - 1, undefined)}
            />
            <UploadCard
              label="Libretto originale — retro (facoltativo)"
              slot={veicolo.librettoOrigRetro}
              onSelect={(f) => onLibrettoOrigRetro(ordine - 1, f ?? undefined)}
              onRemove={() => onLibrettoOrigRetro(ordine - 1, undefined)}
            />
          </div>
```

(Adatta `ordine - 1`/idx alla firma reale degli handler della card. NON entrano in `canStep1`/`mancanzeStep1`.)

- [ ] **Step 4: Submit — invia i blob opzionali**

Nel submit (dove si costruisce `blobRefs`, ~riga 1244-1249), quando il veicolo è foglio e gli slot orig hanno `ref`, aggiungi:

```ts
        if (v.librettoOrigFronte.ref) blobRefs[`LIBRETTO_ORIGINALE_${i + 1}_FRONTE`] = v.librettoOrigFronte.ref;
        if (v.librettoOrigRetro.ref) blobRefs[`LIBRETTO_ORIGINALE_${i + 1}_RETRO`] = v.librettoOrigRetro.ref;
```

(Solo nel ramo foglio; in modalità libretto restano gli slot `LIBRETTO_${i+1}_FRONTE/RETRO` esistenti.)

- [ ] **Step 5: Backend — parse + Documento (actions.ts)**

In `actions.ts`, nel ramo `FOGLIO_COMPLEMENTARE` della costruzione `veicoloDocRefs` (~riga 658-667), estendi la variante per portare gli allegati opzionali:

```ts
  type VeicoloDocRef =
    | { tipo: 'LIBRETTO'; fronte: FileRef; retro: FileRef }
    | { tipo: 'FOGLIO_COMPLEMENTARE'; foglio: FileRef; libOrigFronte?: FileRef; libOrigRetro?: FileRef };
```

Nel ramo foglio, dopo aver ottenuto `rFoglio`, leggi (opzionali, senza redirect se assenti) `getRef(\`LIBRETTO_ORIGINALE_${i}_FRONTE\`)` / `_RETRO`, valida solo la size se presenti, e passali nel push. Poi nella creazione Documento del foglio (~riga 1334-1353), DOPO la `tx.documento.create` del foglio (prima del `continue`), crea le righe opzionali riusando i tipi esistenti:

```ts
        if (docUp.libOrigFronte) {
          await tx.documento.create({
            data: {
              tipo: 'LIBRETTO_CIRCOLAZIONE',
              praticaId: created.id,
              veicoloId: veicolo.id,
              storageKey: docUp.libOrigFronte.storageKey,
              storageProvider: docUp.libOrigFronte.storageProvider,
              mimeType: docUp.libOrigFronte.mimeType,
              sizeBytes: docUp.libOrigFronte.sizeBytes,
              originalFilename: docUp.libOrigFronte.originalFilename,
              uploadedById: userId,
              ocrStato: 'NONE',
              gatingStato: 'PASSED',
            },
          });
        }
        if (docUp.libOrigRetro) {
          await tx.documento.create({
            data: {
              tipo: 'LIBRETTO_CIRCOLAZIONE_RETRO',
              praticaId: created.id,
              veicoloId: veicolo.id,
              storageKey: docUp.libOrigRetro.storageKey,
              storageProvider: docUp.libOrigRetro.storageProvider,
              mimeType: docUp.libOrigRetro.mimeType,
              sizeBytes: docUp.libOrigRetro.sizeBytes,
              originalFilename: docUp.libOrigRetro.originalFilename,
              uploadedById: userId,
              ocrStato: 'NONE',
              gatingStato: 'PASSED',
            },
          });
        }
```

(Verifica il nome esatto del campo `FileRef` → `refToPut(...)` come per gli altri: se il codice usa `refToPut(vd.foglio)` per ottenere lo storage, applica lo stesso a `libOrigFronte`/`libOrigRetro`. Segui il pattern esatto già presente nella `create` del foglio.)

- [ ] **Step 6: Typecheck + verifica**

Run: `pnpm --filter piattaforma typecheck` → clean. Verifica di ragionamento: in modalità libretto nulla cambia; in modalità foglio i due upload sono opzionali, non bloccano l'avanzamento, e al submit generano righe Documento LIBRETTO_CIRCOLAZIONE(_RETRO) solo se presenti.

- [ ] **Step 7: Commit**

```bash
git -C /c/Users/fsiol/Desktop/passaggio_veloce add apps/piattaforma/src/app/pratiche/nuova/wizard.tsx apps/piattaforma/src/app/pratiche/nuova/actions.ts
git -C /c/Users/fsiol/Desktop/passaggio_veloce commit -m "feat(pratiche): upload opzionale libretto originale nel foglio complementare (allegato, no OCR)"
```

---

## Task 6: Regressione finale
- [ ] Run `pnpm --filter piattaforma exec vitest run src/app/pratiche/nuova` → verde (incl. field-errors + i test wizard esistenti veicolo-doc/venditori-prefill).
- [ ] Run `pnpm --filter piattaforma test` → tutti verdi.
- [ ] Run `pnpm --filter piattaforma typecheck` → clean.
- [ ] Run `pnpm --filter piattaforma lint` → 0 errori (warning pre-esistente register-wizard tollerato).
- [ ] Run `pnpm --filter piattaforma build` → OK.

## Self-Review (esito)
- Spec §3 (T1) → Task 1; §4 (T2 meccanismo+copertura) → Task 2 (mecc.+step4) + Task 3 (step1) + Task 4 (step2/3); §5 (T3) → Task 5. Testing §6 → test computeInvalid (Task 2) + regressione (Task 6).
- Nessun placeholder di logica: `computeInvalid`, `field-errors.tsx`, e i pattern di wiring sono codice reale; le enumerazioni di campi mappano 1:1 alle predicati già in `mancanze*`. I punti "verifica il pattern esatto" (T3 refToPut) indicano di seguire il codice adiacente già presente, non un TODO.
- Tipi coerenti: `computeInvalid`/`useFieldErrors`/`isInvalid` usati identici tra field-errors.tsx e i call site; `VeicoloDocRef` esteso in modo additivo.
- **Nota per l'esecutore:** le righe citate (~NNNN) sono indicative sul file da ~3400 righe; localizza per contenuto (nomi di funzioni/variabili) non per numero di riga.
