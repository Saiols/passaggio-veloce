# Attestazione tracciabile dell'informativa ai terzi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare la spunta pre-invio sull'informativa ai terzi da dichiarazione a **prova**: due attestazioni distinte, testo persistito, scrittura atomica con la pratica, consultabile dall'admin.

**Architecture:** Un registro versionato di testi letterali (`lib/legal/attestazioni.ts`) diventa la fonte unica: la modale lo renderizza, il server ne persiste le stringhe accanto al record. La `create` della `BrokerDichiarazione` si sposta dentro la transazione che crea la pratica, eliminando il `try/catch` best-effort. Una card admin-only sul dettaglio pratica rende il record leggibile.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma + Postgres, vitest (`environment: 'node'`, `happy-dom` per i componenti via direttiva per-file), Tailwind + design system `pv-*`.

**Spec:** `docs/superpowers/specs/2026-07-27-attestazione-privacy-terzi-design.md`

## Global Constraints

- **Nessuna modifica a `/termini` e `/privacy`.** L'art. 23.2 già impone la garanzia; questa è la prova, non una clausola nuova. Non toccare `TERMS_VERSION`, non rigenerare la KB del chatbot.
- **L'IP resta anonimizzato a 3 ottetti.** `anonimizeIp()` in `actions.ts:63` non si tocca: la `/privacy` pubblica dichiara l'anonimizzazione (`app/privacy/page.tsx:105`) e de-anonimizzare renderebbe falso un documento pubblicato.
- **Testi delle attestazioni: stringhe letterali.** Mai interpolare `ART_DATI_TERZI` dentro il testo di una versione — cambierebbe in silenzio il significato di record già persistiti.
- **Colori solo dal design system** (`pv-navy-*`, `pv-slate-*`, `pv-amber-*`): la regola no-hardcoded-colors è attiva in lint.
- **Migration scritta a mano**, mai `pnpm db:migrate` (propone `DROP SEQUENCE`). Applicare con `pnpm --filter @pv/db db:deploy`.
- **Nomi colonna in camelCase quotato** (`"testoAttestazioni"`), come le colonne esistenti di `broker_dichiarazioni`.
- Comandi test dalla root: `pnpm --filter piattaforma test <path>`. Typecheck: `pnpm --filter piattaforma typecheck`.
- Node ≥ 18 per pnpm: se la shell è appena stata riavviata, `nvm use 22.15.0` prima di ogni comando.

---

### Task 1: Registro versionato delle attestazioni

Fonte unica dei testi. Include le versioni storiche `v3.0` e `v3.1`, senza le quali la card admin non saprebbe rendere i record già scritti in prod dal go-live (22/07) a oggi.

**Files:**
- Create: `apps/piattaforma/src/lib/legal/attestazioni.ts`
- Test: `apps/piattaforma/src/lib/legal/attestazioni.test.ts`

**Interfaces:**
- Consumes: `ART_DATI_TERZI` da `@/lib/legal/clausole-vessatorie`
- Produces:
  - `ATTESTAZIONI_VERSION: string` (= `'v4.0'`)
  - `type IdAttestazione = 'CUMULATIVA' | 'RESPONSABILITA' | 'TERZI'`
  - `type Attestazione = { id: IdAttestazione; testo: string; link?: { href: string; label: string } }`
  - `REGISTRO_ATTESTAZIONI: Record<string, readonly Attestazione[]>`
  - `attestazioniPerVersione(v: string): readonly Attestazione[] | null`
  - `attestazioniCorrenti(): readonly Attestazione[]`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/legal/attestazioni.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ATTESTAZIONI_VERSION,
  REGISTRO_ATTESTAZIONI,
  attestazioniPerVersione,
  attestazioniCorrenti,
} from './attestazioni';
import { ART_DATI_TERZI } from './clausole-vessatorie';

describe('registro delle attestazioni', () => {
  it('la versione corrente esiste nel registro', () => {
    expect(attestazioniPerVersione(ATTESTAZIONI_VERSION)).not.toBeNull();
  });

  // Il testo cita la clausola per NUMERO, scritto a mano nella stringa. Se i
  // Termini vengono rinumerati, questo test diventa rosso e obbliga ad aprire
  // una versione nuova invece di riscrivere in silenzio un testo gia'
  // persistito in migliaia di record.
  it('la versione corrente cita il numero di clausola attuale dei Termini', () => {
    const terzi = attestazioniCorrenti().find((a) => a.id === 'TERZI');
    expect(terzi).toBeDefined();
    expect(terzi!.testo).toContain(`clausola ${ART_DATI_TERZI} dei Termini`);
  });

  it('la versione corrente ha esattamente le due spunte separate', () => {
    expect(attestazioniCorrenti().map((a) => a.id)).toEqual(['RESPONSABILITA', 'TERZI']);
  });

  it("l'attestazione sui terzi rimanda all'informativa clienti", () => {
    const terzi = attestazioniCorrenti().find((a) => a.id === 'TERZI')!;
    expect(terzi.link?.href).toBe('/privacy/clienti');
    expect(terzi.testo).toContain('passaggioveloce.it/privacy/clienti');
  });

  it('ogni versione ha id univoci', () => {
    for (const [versione, atts] of Object.entries(REGISTRO_ATTESTAZIONI)) {
      const ids = atts.map((a) => a.id);
      expect(new Set(ids).size, `id duplicati in ${versione}`).toBe(ids.length);
    }
  });

  it('CUMULATIVA esiste solo nelle versioni storiche, mai in quella corrente', () => {
    expect(attestazioniCorrenti().some((a) => a.id === 'CUMULATIVA')).toBe(false);
    expect(attestazioniPerVersione('v3.1')!.map((a) => a.id)).toEqual(['CUMULATIVA']);
  });

  // Snapshot: le versioni storiche descrivono cosa un utente HA GIA' letto e
  // spuntato. Modificarle riscriverebbe il passato.
  it('v3.0 e v3.1 sono congelate e citano clausole diverse', () => {
    expect(attestazioniPerVersione('v3.0')![0].testo).toContain('clausola 17 dei Termini');
    expect(attestazioniPerVersione('v3.1')![0].testo).toContain('clausola 23 dei Termini');
  });

  it('una versione sconosciuta non viene inventata', () => {
    expect(attestazioniPerVersione('v9.9')).toBeNull();
    expect(attestazioniPerVersione('')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/legal/attestazioni.test.ts`
Expected: FAIL — `Failed to resolve import "./attestazioni"`.

- [ ] **Step 3: Scrivi il modulo**

Crea `apps/piattaforma/src/lib/legal/attestazioni.ts`:

```ts
/**
 * FONTE UNICA dei testi delle attestazioni spuntate dal broker prima di
 * inviare una pratica (modale `components/dichiarazione-popup.tsx`).
 *
 * Il record `BrokerDichiarazione` persiste la VERSIONE e, dalla v4.0, anche il
 * TESTO. Il registro tiene comunque tutte le versioni storiche: e' l'unico modo
 * di rendere leggibili i record scritti prima che il testo fosse persistito.
 *
 * ⚠️ I testi sono stringhe LETTERALI. Non interpolare mai `ART_DATI_TERZI`:
 * una rinumerazione dei Termini cambierebbe retroattivamente il significato di
 * una versione gia' persistita. Al suo posto, `attestazioni.test.ts` verifica
 * che il testo corrente citi il numero attuale — cosi' una rinumerazione
 * rompe il test e obbliga a una versione nuova.
 *
 * Storico delle versioni (prima viveva in `lib/penali/config.ts`, lontano dal
 * testo che descriveva):
 *  - v2.0 (2026-07-11) penale €25 per veicolo segnalato, non per pratica.
 *  - v3.0 (2026-07-14) aggiunta la conferma di aver informato venditore e
 *    acquirente (allora clausola 17 dei Termini).
 *  - v3.1 (2026-07-26) stesso testo, clausola rinumerata 17 → 23 col merge del
 *    documento v8.
 *  - v4.0 (2026-07-27) la spunta si divide in DUE: responsabilita' sul veicolo
 *    e attestazione sull'informativa ai terzi, con rimando all'Informativa per
 *    venditori e acquirenti. Da questa versione il testo e' persistito.
 */

export const ATTESTAZIONI_VERSION = 'v4.0';

/** `CUMULATIVA` esiste solo nelle versioni ≤ v3.1, dove la spunta era una sola. */
export type IdAttestazione = 'CUMULATIVA' | 'RESPONSABILITA' | 'TERZI';

export type Attestazione = {
  id: IdAttestazione;
  /** Testo integrale reso a schermo e persistito. Stringa letterale. */
  testo: string;
  /** Rimando cliccabile mostrato sotto la spunta. Non fa parte del testo persistito. */
  link?: { href: string; label: string };
};

export const REGISTRO_ATTESTAZIONI: Record<string, readonly Attestazione[]> = {
  // Storiche, congelate: servono solo a rendere leggibili i record gia' scritti.
  'v3.0': [
    {
      id: 'CUMULATIVA',
      testo:
        'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
        'acquirente sul trattamento dei loro dati (clausola 17 dei Termini) e mi assumo ' +
        'piena responsabilità',
    },
  ],
  'v3.1': [
    {
      id: 'CUMULATIVA',
      testo:
        'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
        'acquirente sul trattamento dei loro dati (clausola 23 dei Termini) e mi assumo ' +
        'piena responsabilità',
    },
  ],
  'v4.0': [
    {
      id: 'RESPONSABILITA',
      testo:
        'Confermo di aver verificato quanto sopra (assenza di fermi amministrativi, ' +
        'ipoteche o vincoli iscritti al PRA, autenticità dei documenti caricati) e mi ' +
        'assumo piena responsabilità.',
    },
    {
      id: 'TERZI',
      testo:
        "Dichiaro di aver informato il venditore e l'acquirente che i loro documenti e " +
        'dati personali saranno trattati da Passaggio Veloce S.r.l. per la gestione della ' +
        "presente pratica, ai sensi dell'Informativa Privacy per venditori e acquirenti " +
        '(passaggioveloce.it/privacy/clienti) e della clausola 23 dei Termini.',
      link: { href: '/privacy/clienti', label: 'Informativa per venditori e acquirenti' },
    },
  ],
};

/**
 * Testi di una versione, o `null` se sconosciuta. Il chiamante server DEVE
 * trattare `null` come richiesta da rifiutare: registrare un'attestazione di
 * cui non conosciamo il contenuto non e' una prova.
 */
export function attestazioniPerVersione(versione: string): readonly Attestazione[] | null {
  return REGISTRO_ATTESTAZIONI[versione] ?? null;
}

/** Le attestazioni da rendere adesso nella modale. */
export function attestazioniCorrenti(): readonly Attestazione[] {
  return REGISTRO_ATTESTAZIONI[ATTESTAZIONI_VERSION]!;
}
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/legal/attestazioni.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/legal/attestazioni.ts apps/piattaforma/src/lib/legal/attestazioni.test.ts
git commit -m "feat(legal): registro versionato dei testi delle attestazioni pre-invio"
```

---

### Task 2: La modale a due spunte + wiring wizard

Popup e wizard cambiano insieme: la modifica delle props del componente rompe il chiamante, quindi non possono atterrare separati.

**Files:**
- Modify: `apps/piattaforma/src/components/dichiarazione-popup.tsx` (riscrittura di props e blocco checkbox)
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx:832` (stato), `:1628-1630` (payload), `:2923-2933` (render)
- Test: `apps/piattaforma/src/components/dichiarazione-popup.test.tsx` (nuovo)

**Interfaces:**
- Consumes: `attestazioniCorrenti`, `ATTESTAZIONI_VERSION`, `type IdAttestazione` (Task 1)
- Produces:
  - `DichiarazionePopup({ open, accettate, pending, onToggle, onConfirm, onClose })` dove
    `accettate: Partial<Record<IdAttestazione, boolean>>` e `onToggle: (id: IdAttestazione, v: boolean) => void`
  - payload FormData: `dichiarazioneAccettata`, `attestazioneTerziAccettata`, `dichiarazionePopupVersion`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/components/dichiarazione-popup.test.tsx`. Segue il pattern già in uso in `cookie-banner.test.tsx` (happy-dom + `createRoot`/`act`, click reali sul DOM): due bug React recenti erano invisibili ai test che non toccavano il DOM.

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DichiarazionePopup } from './dichiarazione-popup';
import type { IdAttestazione } from '@/lib/legal/attestazioni';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function bottoneInvia(): HTMLButtonElement {
  const b = [...document.querySelectorAll('button')].find((x) =>
    x.textContent?.includes('Conferma e invia'),
  );
  if (!b) throw new Error('Bottone "Conferma e invia" non trovato');
  return b as HTMLButtonElement;
}

function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderPopup(accettate: Partial<Record<IdAttestazione, boolean>>, onToggle = vi.fn()) {
  render(
    <DichiarazionePopup
      open
      accettate={accettate}
      pending={false}
      onToggle={onToggle}
      onConfirm={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return onToggle;
}

describe('DichiarazionePopup', () => {
  it('rende una checkbox per ogni attestazione corrente', () => {
    renderPopup({});
    expect(checkboxes()).toHaveLength(2);
    expect(document.body.textContent).toContain('assenza di fermi amministrativi');
    expect(document.body.textContent).toContain("Dichiaro di aver informato il venditore");
  });

  it('con nessuna spunta il bottone di invio e disabilitato', () => {
    renderPopup({});
    expect(bottoneInvia().disabled).toBe(true);
  });

  // Il punto della release: l'attestazione privacy non e' piu' assorbita da
  // un'altra spunta. Una sola non basta.
  it('con una sola spunta il bottone di invio resta disabilitato', () => {
    renderPopup({ RESPONSABILITA: true });
    expect(bottoneInvia().disabled).toBe(true);
  });

  it('con una sola spunta (solo terzi) il bottone di invio resta disabilitato', () => {
    renderPopup({ TERZI: true });
    expect(bottoneInvia().disabled).toBe(true);
  });

  it('con entrambe le spunte il bottone di invio si abilita', () => {
    renderPopup({ RESPONSABILITA: true, TERZI: true });
    expect(bottoneInvia().disabled).toBe(false);
  });

  it('spuntare una casella notifica il suo id al chiamante', () => {
    const onToggle = renderPopup({});
    act(() => {
      checkboxes()[1].click();
    });
    expect(onToggle).toHaveBeenCalledWith('TERZI', true);
  });

  it("mostra il rimando all'informativa per venditori e acquirenti", () => {
    renderPopup({});
    const link = [...document.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === '/privacy/clienti',
    );
    expect(link).toBeDefined();
  });

  it('chiuso non rende nulla', () => {
    render(
      <DichiarazionePopup
        open={false}
        accettate={{ RESPONSABILITA: true, TERZI: true }}
        pending={false}
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(checkboxes()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/components/dichiarazione-popup.test.tsx`
Expected: FAIL — il componente accetta ancora `accepted`/`onAcceptedChange`, quindi le prop `accettate`/`onToggle` non hanno effetto e i test sul numero di checkbox e sul bottone falliscono.

- [ ] **Step 3: Riscrivi le props e il blocco checkbox del popup**

In `apps/piattaforma/src/components/dichiarazione-popup.tsx`:

Aggiungi gli import e sostituisci la firma:

```tsx
import Link from 'next/link';
import { attestazioniCorrenti, type IdAttestazione } from '@/lib/legal/attestazioni';
```

```tsx
export function DichiarazionePopup({
  open,
  accettate,
  pending,
  onToggle,
  onConfirm,
  onClose,
}: {
  open: boolean;
  accettate: Partial<Record<IdAttestazione, boolean>>;
  pending: boolean;
  onToggle: (id: IdAttestazione, valore: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const attestazioni = attestazioniCorrenti();
  const tutteAccettate = attestazioni.every((a) => accettate[a.id] === true);
```

Rimuovi l'import ora inutilizzato `ART_DATI_TERZI` (il numero di clausola vive nel testo del registro).

Sostituisci l'intero blocco `<label className="mb-5 …">…</label>` (righe 130-142) con:

```tsx
        <div className="mb-5 space-y-2.5">
          {attestazioni.map((a) => (
            <div key={a.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-4 py-3 transition-colors hover:bg-pv-slate-100">
                <input
                  type="checkbox"
                  checked={accettate[a.id] === true}
                  onChange={(e) => onToggle(a.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-pv-navy-700"
                />
                <span className="text-[13px] font-semibold text-pv-navy-800">{a.testo}</span>
              </label>
              {a.link && (
                <Link
                  href={a.link.href}
                  target="_blank"
                  className="mt-1 ml-11 inline-block text-[12px] font-semibold text-pv-navy-700 hover:underline"
                >
                  {a.link.label} ↗
                </Link>
              )}
            </div>
          ))}
        </div>
```

Sostituisci `disabled={!accepted || pending}` con `disabled={!tutteAccettate || pending}` nel bottone "Conferma e invia".

Elimina il quarto `<li>` dell'elenco puntato (righe 86-93, «Hai **informato venditore e acquirente**…»): con la spunta dedicata due righe più sotto sarebbe una ripetizione.

Aggiorna il commento di intestazione del file: il caller mantiene lo stato **delle attestazioni** e passa `ATTESTAZIONI_VERSION` (non più `POPUP_VERSION`) al submit.

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/components/dichiarazione-popup.test.tsx`
Expected: PASS, 8 test.

- [ ] **Step 5: Aggiorna il wizard**

In `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`:

Import (accanto agli altri import di lib):

```tsx
import { ATTESTAZIONI_VERSION, type IdAttestazione } from '@/lib/legal/attestazioni';
```

Riga 832 — sostituisci lo stato booleano:

```tsx
  const [attestazioni, setAttestazioni] = useState<Partial<Record<IdAttestazione, boolean>>>({});
```

Righe 1628-1630 — sostituisci il payload:

```tsx
    // Attestazioni pre-invio: due spunte distinte + la versione del testo che
    // l'utente ha effettivamente letto (il bundle in pagina puo' essere di una
    // release precedente: e' quel testo che va registrato, non l'ultimo).
    fd.append('dichiarazioneAccettata', 'true');
    fd.append('attestazioneTerziAccettata', 'true');
    fd.append('dichiarazionePopupVersion', ATTESTAZIONI_VERSION);
```

Righe 2923-2933 — sostituisci le prop del render:

```tsx
      <DichiarazionePopup
        open={showDichiarazione}
        accettate={attestazioni}
        pending={submitting}
        onToggle={(id, valore) => setAttestazioni((prev) => ({ ...prev, [id]: valore }))}
        onConfirm={() => {
          setShowDichiarazione(false);
          handleFinalSubmit();
        }}
        onClose={() => setShowDichiarazione(false)}
      />
```

Rimuovi l'import `import { PENALI } from '@/lib/penali/config';` (riga 9): la riga 1630 era l'unico uso in questo file, e lasciarlo fa fallire il lint.

- [ ] **Step 6: Verifica typecheck e suite**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore. Se `tsc` va in stack overflow o segnala errori Prisma inventati, è la cache fredda: rilancia una seconda volta (il `tsbuildinfo` risolve).

Run: `pnpm --filter piattaforma test src/components src/lib/legal`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/components/dichiarazione-popup.tsx apps/piattaforma/src/components/dichiarazione-popup.test.tsx apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(pratiche): due attestazioni distinte nella modale pre-invio"
```

---

### Task 3: Schema Prisma e migration

Colonne nullable: i record `v3.0`/`v3.1` già in prod restano validi e leggibili dal registro. Nessun backfill.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:984-1002` (model `BrokerDichiarazione`)
- Create: `packages/db/prisma/migrations/20260727120000_attestazioni_testo_persistito/migration.sql`

**Interfaces:**
- Produces: `BrokerDichiarazione.testoAttestazioni: Prisma.JsonValue | null`, `BrokerDichiarazione.clausolaTerzi: number | null`

- [ ] **Step 1: Aggiungi i campi allo schema**

In `packages/db/prisma/schema.prisma`, dentro `model BrokerDichiarazione`, dopo `popupVersion`:

```prisma
  popupVersion String // "v1.0", "v1.1" — audit se il testo cambia

  /// Copia del testo effettivamente reso a schermo: [{ id, testo }].
  /// Null nei record <= v3.1, leggibili dal registro tramite popupVersion.
  testoAttestazioni Json?

  /// Numero della clausola dei Termini sui dati dei terzi al momento della spunta.
  clausolaTerzi Int?
```

- [ ] **Step 2: Scrivi la migration a mano**

Crea `packages/db/prisma/migrations/20260727120000_attestazioni_testo_persistito/migration.sql`:

```sql
-- Attestazione tracciabile dell'informativa ai terzi (spec 2026-07-27).
--
-- Il record `broker_dichiarazioni` persisteva solo `popupVersion`: il testo era
-- ricostruibile solo risalendo al commit giusto, e solo finche' nessuno
-- modificava il copy dimenticando di bumpare la versione. Da qui in avanti il
-- record porta con se' il testo che l'utente ha letto.
--
-- ⚠️ MIGRATION DI SOLA ESPANSIONE, colonne NULLABLE: va lanciata PRIMA del
-- deploy del codice nuovo ed e' compatibile con quello vecchio, che le ignora.
--
-- Nessun backfill. I record gia' scritti (dal go-live del 2026-07-22) sono in
-- v3.0 e v3.1, entrambe presenti nel registro `lib/legal/attestazioni.ts` col
-- loro testo storico: la card admin li rende per intero partendo dalla
-- versione. Inventare un testo per righe gia' scritte sarebbe il contrario di
-- una prova.
ALTER TABLE "broker_dichiarazioni" ADD COLUMN "testoAttestazioni" JSONB;
ALTER TABLE "broker_dichiarazioni" ADD COLUMN "clausolaTerzi" INTEGER;
```

- [ ] **Step 3: Applica la migration in locale e rigenera il client**

Run: `pnpm --filter @pv/db db:deploy`
Expected: `Applying migration '20260727120000_attestazioni_testo_persistito'` e `1 migration applied`.

Run: `pnpm --filter @pv/db db:generate`
Expected: `Generated Prisma Client`.

> Non usare `pnpm db:migrate`: `prisma migrate dev` propone `DROP SEQUENCE` su questo schema.

- [ ] **Step 4: Verifica che le colonne esistano davvero**

Run:
```bash
docker exec -i pv-postgres psql -U postgres -d passaggio_veloce -c "\d broker_dichiarazioni"
```
Expected: nell'elenco compaiono `testoAttestazioni | jsonb` e `clausolaTerzi | integer`.

Se il nome del container differisce, ricavalo con `docker ps --format '{{.Names}}'`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260727120000_attestazioni_testo_persistito/migration.sql
git commit -m "feat(db): il record di attestazione porta con se il testo spuntato"
```

---

### Task 4: Server action — validazione versione e scrittura atomica

Il cuore della release. Tre cambi in `submitNuovaPraticaAction`: la versione va validata contro il registro, i testi si leggono dal registro (mai dal payload), la `create` entra nella transazione.

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts:574-576` (schema), `:753-758` (guardia), `:1344` + `:1672-1688` (transazione)
- Test: `apps/piattaforma/src/app/pratiche/nuova/actions.attestazioni.test.ts` (nuovo)

**Interfaces:**
- Consumes: `attestazioniPerVersione` (Task 1), colonne `testoAttestazioni`/`clausolaTerzi` (Task 3)
- Produces: nessuna API nuova — cambia il comportamento di `submitNuovaPraticaAction`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/app/pratiche/nuova/actions.attestazioni.test.ts`. Copia da `actions.submit-distribuzione.test.ts` (che mocka già sessione, permessi, OCR, gating documentale, pricing, notifiche e distribuzione):

- l'intero blocco `vi.hoisted` (righe 29-179) e tutti i `vi.mock` (righe ~120-195);
- gli helper `sessionCtx()` (riga 180), `ref()` (riga 196) e `buildValidFormData()` (riga 209).

Nel `buildValidFormData` copiato, **due modifiche**: aggiungi `attestazioneTerziAccettata: 'true'` accanto a `dichiarazioneAccettata`, e porta `dichiarazionePopupVersion` da `'v1'` a `'v4.0'` (`'v1'` non è nel registro — è proprio il caso che stiamo per rifiutare).

Sostituisci inoltre il mock di `next/headers` (riga 134), che restituisce `new Headers()` vuoto: senza `x-forwarded-for` l'IP registrato è stringa vuota e l'ultimo test non misurerebbe nulla.

```ts
vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers({ 'x-forwarded-for': '93.45.201.77', 'user-agent': 'vitest' }),
  ),
}));
```

Poi aggiungi in coda:

```ts
import { attestazioniPerVersione } from '@/lib/legal/attestazioni';

async function submit(fd: FormData): Promise<string | null> {
  const { submitNuovaPraticaAction } = await import('./actions');
  try {
    await submitNuovaPraticaAction(fd);
    return null;
  } catch (e) {
    const m = /^__REDIRECT__:(.*)$/.exec((e as Error).message);
    if (m) return m[1]!;
    throw e;
  }
}

describe('attestazioni pre-invio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('senza la spunta sui terzi la pratica non parte', async () => {
    const url = await submit(buildValidFormData({ attestazioneTerziAccettata: 'false' }));
    expect(url).toContain('error=');
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  it('senza la spunta di responsabilita la pratica non parte', async () => {
    const url = await submit(buildValidFormData({ dichiarazioneAccettata: 'false' }));
    expect(url).toContain('error=');
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  // Registrare un'attestazione di cui non conosciamo il testo non e' una prova:
  // meglio rifiutare l'invio e far ricaricare la pagina.
  it('una versione fuori registro viene rifiutata', async () => {
    const url = await submit(buildValidFormData({ dichiarazionePopupVersion: 'v9.9' }));
    expect(url).toContain('error=');
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  it('persiste i testi del registro, la versione e il numero di clausola', async () => {
    await submit(buildValidFormData());
    expect(prismaMock.brokerDichiarazione.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(data.popupVersion).toBe('v4.0');
    expect(data.clausolaTerzi).toBe(23);
    expect(data.testoAttestazioni).toEqual(
      attestazioniPerVersione('v4.0')!.map((a) => ({ id: a.id, testo: a.testo })),
    );
  });

  // Il testo e' merce del server. Un payload manomesso non deve poter scrivere
  // nel record una dichiarazione diversa da quella resa a schermo.
  it('ignora un testo iniettato dal client', async () => {
    await submit(buildValidFormData({ testoAttestazioni: '[{"id":"TERZI","testo":"nulla"}]' }));
    const { data } = prismaMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(JSON.stringify(data.testoAttestazioni)).not.toContain('nulla');
  });

  // IL test della release: prima era un log best-effort in un catch vuoto, e
  // una pratica poteva partire senza la sua prova senza che nessuno lo sapesse.
  it('se la scrittura della prova fallisce, la pratica non esiste', async () => {
    prismaMock.brokerDichiarazione.create.mockRejectedValueOnce(new Error('db down'));
    await expect(submit(buildValidFormData())).rejects.toThrow('db down');
    expect(avviaRound1ForPraticaMock).not.toHaveBeenCalled();
  });

  it("l'IP registrato resta anonimizzato a 3 ottetti", async () => {
    await submit(buildValidFormData());
    const { data } = prismaMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(data.ip).toMatch(/\.x$/);
  });
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca, e per quali motivi**

Run: `pnpm --filter piattaforma test src/app/pratiche/nuova/actions.attestazioni.test.ts`
Expected: FAIL. Attesi in particolare:
- «senza la spunta sui terzi» fallisce perché il campo non esiste ancora nello schema zod (la pratica viene creata lo stesso);
- «versione fuori registro» fallisce (oggi qualunque stringa 1-20 char passa);
- «persiste i testi» fallisce (`data.testoAttestazioni` è `undefined`);
- «se la scrittura della prova fallisce, la pratica non esiste» fallisce perché il `catch` vuoto ingoia l'errore e `avviaRound1ForPratica` viene invocata comunque.

Annota quali falliscono: sono la prova che i test misurano qualcosa.

- [ ] **Step 3: Estendi lo schema zod**

In `apps/piattaforma/src/app/pratiche/nuova/actions.ts`, righe 574-576:

```ts
  // Attestazioni pre-invio (spec 2026-07-27): due spunte distinte + la versione
  // del testo reso a schermo. La versione arriva dal client di proposito — dopo
  // un deploy il browser puo' avere ancora il bundle precedente, ed e' QUEL
  // testo che l'utente ha letto. E' validata contro il registro piu' sotto.
  dichiarazioneAccettata: formBool,
  attestazioneTerziAccettata: formBool,
  dichiarazionePopupVersion: z.string().trim().min(1).max(20),
});
```

- [ ] **Step 4: Estendi la guardia bloccante**

Sostituisci le righe 753-758:

```ts
  // Attestazioni pre-invio: entrambe obbligatorie. Il wizard scrive i flag di
  // suo (il gate sul gesto e' il bottone disabilitato), quindi qui non stiamo
  // verificando il click: stiamo rifiutando una richiesta malformata.
  if (!d.dichiarazioneAccettata || !d.attestazioneTerziAccettata) {
    redirect(
      '/pratiche/nuova?error=Devi%20accettare%20entrambe%20le%20dichiarazioni%20prima%20di%20inviare',
    );
  }

  // Versione fuori registro: rifiutiamo l'invio invece di registrare
  // un'attestazione di cui non conosciamo il testo.
  const attestazioniRese = attestazioniPerVersione(d.dichiarazionePopupVersion);
  if (!attestazioniRese) {
    redirect(
      '/pratiche/nuova?error=La%20pagina%20non%20e%20aggiornata%3A%20ricarica%20e%20riprova',
    );
  }
```

Aggiungi l'import in cima al file, accanto agli altri `@/lib`:

```ts
import { attestazioniPerVersione } from '@/lib/legal/attestazioni';
import { ART_DATI_TERZI } from '@/lib/legal/clausole-vessatorie';
```

- [ ] **Step 5: Sposta la create dentro la transazione**

Prima della riga 1344 (`const pratica = await prisma.$transaction(...)`), leggi i metadati di richiesta:

```ts
  // Fuori dalla transazione: `headers()` e' async e non ha ragione di tenere
  // aperta una connessione al DB.
  const metaRichiesta = await getRequestMetadata();
```

Dentro il callback della transazione, **subito prima di `return created;`** (riga 1669):

```ts
    // La prova dell'attestazione nasce e muore con la pratica: nessuna pratica
    // inviata senza prova, nessuna prova senza pratica. Era un log best-effort
    // in un catch vuoto — se falliva, la pratica partiva comunque e la prova
    // non esisteva, senza che nessuno se ne accorgesse.
    await tx.brokerDichiarazione.create({
      data: {
        praticaId: created.id,
        userId,
        ip: metaRichiesta.ip || null,
        userAgent: metaRichiesta.userAgent || null,
        popupVersion: d.dichiarazionePopupVersion,
        testoAttestazioni: attestazioniRese.map((a) => ({ id: a.id, testo: a.testo })),
        clausolaTerzi: ART_DATI_TERZI,
      },
    });

    return created;
```

Elimina interamente il blocco `try { … } catch { … }` delle righe 1672-1688, commento incluso.

- [ ] **Step 6: Lancia i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/app/pratiche/nuova/`
Expected: PASS — sia il file nuovo sia `actions.submit-distribuzione.test.ts` e `actions.authz.test.ts`, che mockano già `brokerDichiarazione.create` e un `$transaction` che invoca il callback con `prismaMock`.

Se `actions.submit-distribuzione.test.ts` fallisce sulla validazione, aggiungi `attestazioneTerziAccettata: 'true'` al suo form di base (riga ~252) e porta `dichiarazionePopupVersion` da `'v1'` a `'v4.0'`: `'v1'` non è nel registro, ed è esattamente il rifiuto che abbiamo appena implementato.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts apps/piattaforma/src/app/pratiche/nuova/actions.attestazioni.test.ts apps/piattaforma/src/app/pratiche/nuova/actions.submit-distribuzione.test.ts
git commit -m "fix(pratiche): la prova dell'attestazione e atomica con la pratica

Era un log best-effort in un catch vuoto: se falliva, la pratica
partiva senza prova e nessuno se ne accorgeva."
```

---

### Task 5: Card admin sul dettaglio pratica

**Files:**
- Create: `apps/piattaforma/src/app/pratiche/[id]/attestazione-card.tsx`
- Modify: `apps/piattaforma/src/lib/date/rome-day.ts` (aggiunta `romeDataOraLeggibile`)
- Modify: `apps/piattaforma/src/lib/date/rome-day.test.ts`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx:158-164` (query), `:841` (render)

**Interfaces:**
- Consumes: `attestazioniPerVersione` (Task 1), colonne del record (Task 3)
- Produces:
  - `romeDataOraLeggibile(instant: Date): string`
  - `AttestazioneCard({ dichiarazione })` con
    `dichiarazione: { createdAt: Date; ip: string | null; userAgent: string | null; popupVersion: string; testoAttestazioni: unknown; clausolaTerzi: number | null; user: { nome: string | null; cognome: string | null; email: string } }`

- [ ] **Step 1: Scrivi il test del formatter (che fallisce)**

In coda a `apps/piattaforma/src/lib/date/rome-day.test.ts`:

```ts
describe('romeDataOraLeggibile', () => {
  // Il timestamp di un'attestazione e' una prova: mostrarlo in UTC su un server
  // Vercel significa dichiarare un'ora che l'utente non ha mai visto.
  it("rende l'ora italiana, non quella del server", () => {
    // 2026-07-15T12:00:00Z = 14:00 a Roma (CEST, UTC+2)
    const s = romeDataOraLeggibile(new Date('2026-07-15T12:00:00Z'));
    expect(s).toContain('14:00');
  });

  it('rende l ora italiana anche in ora solare', () => {
    // 2026-01-15T12:00:00Z = 13:00 a Roma (CET, UTC+1)
    const s = romeDataOraLeggibile(new Date('2026-01-15T12:00:00Z'));
    expect(s).toContain('13:00');
  });
});
```

Aggiungi `romeDataOraLeggibile` all'import esistente in cima al file di test.

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/date/rome-day.test.ts`
Expected: FAIL — `romeDataOraLeggibile is not a function`.

- [ ] **Step 3: Aggiungi il formatter**

In `apps/piattaforma/src/lib/date/rome-day.ts`, sotto `romeDataLeggibile`:

```ts
/**
 * Data e ora leggibili in fuso italiano: "15 lug 2026, 14:32".
 *
 * `formatDateTime` di `lib/format.ts` non fissa il timeZone e su Vercel (server
 * UTC) rende l'ora sbagliata. Per le 32 UI che lo usano e' un dettaglio; per un
 * timestamp che deve fare da prova legale e' un difetto proprio nella cosa che
 * si sta dimostrando. Quello resta com'e': questa e' la variante da usare dove
 * l'ora conta.
 */
export function romeDataOraLeggibile(instant: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: ROME_TZ,
  }).format(instant);
}
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/date/rome-day.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivi la card**

Crea `apps/piattaforma/src/app/pratiche/[id]/attestazione-card.tsx`:

```tsx
import { Card } from '@/components/ui';
import { romeDataOraLeggibile } from '@/lib/date/rome-day';
import { attestazioniPerVersione } from '@/lib/legal/attestazioni';

type Dichiarazione = {
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
  popupVersion: string;
  testoAttestazioni: unknown;
  clausolaTerzi: number | null;
  user: { nome: string | null; cognome: string | null; email: string };
};

/** `testoAttestazioni` e' Json: stringente in lettura, il DB non lo tipizza. */
function testiPersistiti(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const testi = v
    .map((x) => (x && typeof x === 'object' && 'testo' in x ? String(x.testo) : null))
    .filter((t): t is string => t !== null);
  return testi.length > 0 ? testi : null;
}

/**
 * Prova dell'attestazione resa dal broker prima dell'invio (Termini 23.2).
 * Admin-only: contiene l'IP dell'utente, che e' un dato personale — a differenza
 * della diagnostica di copertura, qui non basta essere staff.
 */
export function AttestazioneCard({ dichiarazione }: { dichiarazione: Dichiarazione }) {
  const nome = [dichiarazione.user.nome, dichiarazione.user.cognome].filter(Boolean).join(' ');

  // Testo dal record; per i record <= v3.1 (scritti prima che venisse
  // persistito) si ricade sul registro tramite la versione.
  const dalRegistro = attestazioniPerVersione(dichiarazione.popupVersion);
  const testi = testiPersistiti(dichiarazione.testoAttestazioni) ?? dalRegistro?.map((a) => a.testo) ?? null;

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-pv-navy-800">Attestazione del broker</h2>
      <p className="mt-1 text-[12px] text-pv-slate-500">
        Dichiarazione resa prima dell&apos;invio (Termini, clausola{' '}
        {dichiarazione.clausolaTerzi ?? 23}). Versione testo {dichiarazione.popupVersion}.
      </p>

      <dl className="mt-3 space-y-1 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-pv-slate-500">Data e ora</dt>
          <dd className="font-semibold text-pv-navy-800">
            {romeDataOraLeggibile(dichiarazione.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-pv-slate-500">Utente</dt>
          <dd className="truncate font-semibold text-pv-navy-800">
            {nome || dichiarazione.user.email}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-pv-slate-500">IP</dt>
          <dd className="font-semibold text-pv-navy-800">{dichiarazione.ip ?? '—'}</dd>
        </div>
      </dl>

      {testi ? (
        <ul className="mt-3 space-y-2">
          {testi.map((t, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-[10px] border border-pv-slate-200 px-3 py-2 text-[12.5px] text-pv-navy-800"
            >
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-pv-navy-700">
                ✓
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : (
        // Un blocco vuoto si leggerebbe come "nessuna attestazione", che e' la
        // conclusione opposta a quella vera.
        <p className="mt-3 rounded-[10px] bg-pv-amber-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
          Testo non ricostruibile: la versione <strong>{dichiarazione.popupVersion}</strong> non è
          nel registro delle attestazioni. L&apos;attestazione è stata resa, ma il testo va
          recuperato dallo storico del codice.
        </p>
      )}

      {dichiarazione.userAgent && (
        <p className="mt-3 truncate text-[11px] text-pv-slate-500" title={dichiarazione.userAgent}>
          {dichiarazione.userAgent}
        </p>
      )}
    </Card>
  );
}
```

- [ ] **Step 6: Aggancia la card alla pagina**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx`, dopo il blocco `firmaForzataDaUser` (riga 164):

```tsx
  // Prova dell'attestazione pre-invio (Termini 23.2). Query separata e
  // admin-only: contiene l'IP del broker, e non serve a broker e agenzia.
  // Una pratica ha una sola dichiarazione, ma la relazione e' una lista:
  // si prende la piu' recente.
  const attestazione = isAdminPiattaforma(session.user.role)
    ? await prisma.brokerDichiarazione.findFirst({
        where: { praticaId: pratica.id },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          ip: true,
          userAgent: true,
          popupVersion: true,
          testoAttestazioni: true,
          clausolaTerzi: true,
          user: { select: { nome: true, cognome: true, email: true } },
        },
      })
    : null;
```

Import accanto a `CoperturaCard` (riga 34):

```tsx
import { AttestazioneCard } from './attestazione-card';
```

Render nell'`<aside>`, dopo `{copertura && <CoperturaCard … />}` (riga 841):

```tsx
            {attestazione && <AttestazioneCard dichiarazione={attestazione} />}
```

- [ ] **Step 7: Verifica typecheck e suite completa**

Run: `pnpm --filter piattaforma typecheck`
Expected: nessun errore. Se `testoAttestazioni` dà errore di tipo, è il `Prisma.JsonValue`: la card lo accetta come `unknown`, quindi il problema è un `db:generate` non rilanciato dopo il Task 3.

Run: `pnpm --filter piattaforma test`
Expected: PASS, intera suite.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/[id]/attestazione-card.tsx apps/piattaforma/src/app/pratiche/[id]/page.tsx apps/piattaforma/src/lib/date/rome-day.ts apps/piattaforma/src/lib/date/rome-day.test.ts
git commit -m "feat(admin): card con la prova dell'attestazione sul dettaglio pratica"
```

---

### Task 6: Pulizia di `POPUP_VERSION` e verifica nel browser

I test non vedono due classi di bug che questa release può introdurre: una checkbox React che non si spegne, e un timestamp reso in UTC. Vanno guardati.

**Files:**
- Modify: `apps/piattaforma/src/lib/penali/config.ts:31-52`
- Verifica: nessun file

- [ ] **Step 1: Deprecare `POPUP_VERSION`**

In `apps/piattaforma/src/lib/penali/config.ts`, sostituisci il commento e la costante (righe 31-52) con:

```ts
  /**
   * @deprecated Sostituita da `ATTESTAZIONI_VERSION` in `lib/legal/attestazioni.ts`,
   * dove la versione vive accanto al testo che descrive (qui era lontana da esso,
   * ed e' per questo che il testo poteva cambiare senza che la versione seguisse).
   * Lasciata per i record storici: NON usarla in codice nuovo.
   */
  POPUP_VERSION: 'v3.1',
```

Sposta il changelog delle versioni (v2.0/v3.0/v3.1) nel commento di intestazione di `lib/legal/attestazioni.ts` se non l'hai già fatto nel Task 1.

- [ ] **Step 2: Verifica che nessuno la usi più**

Run: `grep -rn "POPUP_VERSION" apps/piattaforma/src --include=*.ts --include=*.tsx`
Expected: solo la definizione in `lib/penali/config.ts`. Se compare in `wizard.tsx`, il Task 2 non è completo.

- [ ] **Step 3: Avvia il dev server**

Run: `pnpm --filter piattaforma dev`

> Se la porta 3000 serve codice vecchio, il server precedente è ancora vivo: fermare il task non uccide Next. Chiudilo davvero prima (`netstat -ano | findstr :3000` → `taskkill /PID <pid> /F`).

- [ ] **Step 4: Verifica la modale col gesto reale**

Nel browser, come broker: crea una pratica fino all'ultimo step e apri la modale pre-invio. Verifica **cliccando**, non navigando:

1. Le checkbox sono **due**, e l'elenco puntato sopra **non** ripete più «Hai informato venditore e acquirente».
2. Con zero spunte, "Conferma e invia" è disabilitato.
3. Spunta solo la prima → il bottone resta disabilitato.
4. Spunta anche la seconda → si abilita. Togli la prima → torna disabilitato.
5. Il link «Informativa per venditori e acquirenti ↗» apre `/privacy/clienti` in una scheda nuova.
6. Leggi il testo reso a schermo, non il sorgente: JSX collassa gli spazi, e in un testo legale «dell'Informativa Privacyper venditori» è già successo altrove.

Poi invia la pratica e verifica che venga creata.

- [ ] **Step 5: Verifica la card admin**

Come `ADMIN_PIATTAFORMA`, apri il dettaglio della pratica appena creata:

1. La card «Attestazione del broker» c'è, in fondo alla colonna destra.
2. L'ora mostrata è **l'ora italiana** in cui hai inviato, non quella UTC.
3. I due testi spuntati sono riportati per intero.
4. L'IP finisce per `.x` (in locale può essere vuoto: `x-forwarded-for` non è impostato dal dev server — in quel caso mostra `—`, ed è corretto).

Poi apri come broker la stessa pratica: la card **non** deve comparire.

- [ ] **Step 6: Verifica un record storico**

Con `psql`, degrada a mano un record per simulare quelli in prod:

```bash
docker exec -i pv-postgres psql -U postgres -d passaggio_veloce -c \
  "UPDATE \"broker_dichiarazioni\" SET \"popupVersion\"='v3.1', \"testoAttestazioni\"=NULL, \"clausolaTerzi\"=NULL WHERE \"praticaId\"='<id-pratica>';"
```

Ricarica la pagina admin: la card deve mostrare **una** attestazione, con il testo cumulativo storico letto dal registro, e «Versione testo v3.1». È lo scenario dei record già in prod: se qui vedi un blocco vuoto, il fallback sul registro non funziona.

Poi rimetti il record com'era ricreando la pratica, o lascia stare: è il DB locale.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/penali/config.ts
git commit -m "chore(penali): POPUP_VERSION deprecata in favore di ATTESTAZIONI_VERSION"
```

---

## Rollout in produzione

Ordine obbligato — le colonne devono esistere **prima** che il codice che le scrive vada online:

1. Applica la migration su Neon **ep-solitary-night** (fonte: `DATABASE_URL` su Vercel), con `prisma migrate deploy`.
2. Verifica le colonne: `\d broker_dichiarazioni` deve mostrare `testoAttestazioni` e `clausolaTerzi`.
3. `git push origin main` → Vercel deploya.
4. Sul primo invio pratica reale, apri la card admin e controlla che il record sia in `v4.0` col testo persistito.

Il passo 4 non è cosmetico: da questa release un fallimento nella scrittura della prova **blocca la creazione della pratica**. Se qualcosa è storto (colonne mancanti, client Prisma non rigenerato), il sintomo sarà un broker che non riesce a inviare — non un errore silenzioso.
