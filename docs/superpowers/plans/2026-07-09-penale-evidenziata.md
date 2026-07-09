# Penale evidenziata nei movimenti wallet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far riconoscere a colpo d'occhio una penale nella lista movimenti del wallet, in entrambe le viste che la mostrano.

**Architecture:** L'importo è già rosso per *ogni* movimento negativo, payout compresi: il colore da solo non distingue una penale. Serve un secondo segnale — bordo sinistro rosso e fondo tenue sulla riga. La conoscenza di "cos'è una penale" e "che aspetto ha" finisce in un modulo condiviso (`app/wallet/movimenti.ts`), insieme a `labelTipoTx` che oggi è una funzione privata di `page.tsx`. La vista aggregata torna a ricevere il **tipo grezzo** invece dell'etichetta, così può decidere anche lei.

**Tech Stack:** Next.js 16 (App Router, Server Components), Tailwind CSS v4, vitest.

**Spec di riferimento:** `docs/superpowers/specs/2026-07-09-penale-evidenziata-design.md`

## Global Constraints

- **Node**: `nvm use 22.15.0` prima di qualunque comando `pnpm` — dopo un riavvio la shell non ha `node` sul PATH.
- **Si evidenzia solo `PENALE_BROKER`.** Lo `STORNO` che a volte l'accompagna nel flusso penale è il recupero di un compenso già accreditato, non una sanzione. Una `RETTIFICA_ADMIN` negativa può essere una semplice correzione contabile. **Evidenziare per errore è peggio che non evidenziare.**
- **Nessun colore hardcoded**: solo i token `pv-*` del design system (`pv-red-500`, `pv-red-50`).
- **Nessun testo aggiuntivo** nella riga: l'etichetta dice già "Penale segnalazione" e la vista per sede mostra il motivo sotto. Il colore non è l'unico veicolo dell'informazione, quindi un chip sarebbe ridondante.
- **Il fondo colorato resta dentro il padding della lista.** Niente margini negativi da accordare al padding della `Card`, che è `p-5 sm:p-6` e cambia al breakpoint.
- Nessuna migration, nessun cambio di schema, nessuna query nuova.
- `pnpm typecheck` a cache fredda è inaffidabile (falsi errori Prisma / stack overflow).
- **Commit** in italiano, conventional commits, con trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **NON fare push.** Push su `main` = deploy in produzione.

## File Structure

Nuovi:

| File | Responsabilità |
|---|---|
| `apps/piattaforma/src/app/wallet/movimenti.ts` | Presentazione dei movimenti: etichetta, "è una penale?", classi della riga. Nient'altro. |
| `apps/piattaforma/src/app/wallet/movimenti.test.ts` | Blinda l'insieme dei tipi evidenziati e la copertura delle etichette contro l'enum reale. |

Modificati:

| File | Modifica |
|---|---|
| `apps/piattaforma/src/app/wallet/page.tsx` | rimuove `labelTipoTx` privata, importa dal modulo; evidenzia la riga; passa il tipo grezzo alla vista aggregata |
| `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx` | etichetta al render; evidenzia la riga |

---

### Task 1: Il modulo condiviso

Refactor puro: nessun cambiamento visibile. `labelTipoTx` si sposta, e nascono `isPenale` e la costante delle classi che il Task 2 userà.

**Files:**
- Create: `apps/piattaforma/src/app/wallet/movimenti.ts`
- Test: `apps/piattaforma/src/app/wallet/movimenti.test.ts`
- Modify: `apps/piattaforma/src/app/wallet/page.tsx` (rimuove la `labelTipoTx` privata, aggiunge l'import)

**Interfaces:**
- Produces:
  - `labelTipoTx(tipo: string): string`
  - `isPenale(tipo: string): boolean`
  - `CLASSI_RIGA_PENALE: string`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/app/wallet/movimenti.test.ts`.

L'ultimo `describe` legge `schema.prisma` invece di fidarsi di una lista scritta a mano: è lo stesso pattern di `apps/piattaforma/src/lib/distribuzione/assegnazione-unique.test.ts`. Serve perché se domani qualcuno aggiunge un valore a `TransazioneWalletTipo` e si dimentica l'etichetta, nessun altro test se ne accorgerebbe.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelTipoTx, isPenale, CLASSI_RIGA_PENALE } from './movimenti';

/** I valori dell'enum Prisma `TransazioneWalletTipo`, al 2026-07-09. */
const TIPI = [
  'CREDITO_PRATICA',
  'CREDITO_AFFILIAZIONE',
  'PAYOUT_AUTOMATICO',
  'PAYOUT_MANUALE',
  'RETTIFICA_ADMIN',
  'STORNO',
  'PENALE_BROKER',
  'CREDITO_PROMO',
] as const;

describe('isPenale — si evidenzia solo la sanzione', () => {
  it('vero per PENALE_BROKER', () => {
    expect(isPenale('PENALE_BROKER')).toBe(true);
  });

  it.each(TIPI.filter((t) => t !== 'PENALE_BROKER'))('falso per %s', (tipo) => {
    expect(isPenale(tipo)).toBe(false);
  });

  // Lo storno nasce insieme alla penale, ma è il recupero di un compenso già
  // accreditato: due righe rosse per un evento solo sarebbero fuorvianti.
  it('lo STORNO non è una penale', () => {
    expect(isPenale('STORNO')).toBe(false);
  });

  it('un tipo sconosciuto non viene evidenziato', () => {
    expect(isPenale('TIPO_CHE_NON_ESISTE')).toBe(false);
  });
});

describe('labelTipoTx', () => {
  it('etichetta i tipi noti', () => {
    expect(labelTipoTx('PENALE_BROKER')).toBe('Penale segnalazione');
    expect(labelTipoTx('CREDITO_PRATICA')).toBe('Credito pratica firmata');
    expect(labelTipoTx('PAYOUT_MANUALE')).toBe('Payout manuale');
  });

  it('ricade sul valore grezzo per un tipo sconosciuto', () => {
    expect(labelTipoTx('TIPO_CHE_NON_ESISTE')).toBe('TIPO_CHE_NON_ESISTE');
  });
});

describe('CLASSI_RIGA_PENALE', () => {
  it('usa i token del design system, non colori hardcoded', () => {
    expect(CLASSI_RIGA_PENALE).toContain('border-pv-red-500');
    expect(CLASSI_RIGA_PENALE).toContain('bg-pv-red-50');
    expect(CLASSI_RIGA_PENALE).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('contratto con lo schema: ogni tipo ha un\'etichetta', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const SCHEMA_PATH = path.resolve(here, '../../../../../packages/db/prisma/schema.prisma');
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const match = schema.match(/enum TransazioneWalletTipo \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('enum TransazioneWalletTipo non trovato in schema.prisma');
  const valoriSchema = match[1]
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !r.startsWith('//'));

  it('la lista di questo test è allineata allo schema', () => {
    expect([...valoriSchema].sort()).toEqual([...TIPI].sort());
  });

  it.each(valoriSchema)('%s ha un\'etichetta leggibile, non il valore grezzo', (tipo) => {
    expect(labelTipoTx(tipo)).not.toBe(tipo);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
nvm use 22.15.0
pnpm --filter piattaforma exec vitest run src/app/wallet/movimenti.test.ts
```

Atteso: FAIL — `Failed to resolve import "./movimenti"`.

- [ ] **Step 3: Crea il modulo**

Crea `apps/piattaforma/src/app/wallet/movimenti.ts`:

```ts
/**
 * Presentazione dei movimenti wallet, condivisa dalle due viste che li elencano:
 * `page.tsx` (singola sede) e `wallet-aggregato.tsx` (proprietario).
 *
 * Sta qui perché "cos'è una penale" e "che aspetto ha" devono avere una fonte
 * sola: due copie divergono al primo tipo nuovo.
 */

/** Etichetta leggibile del tipo di movimento; ricade sul valore grezzo se sconosciuto. */
export function labelTipoTx(tipo: string): string {
  if (tipo === 'CREDITO_PRATICA') return 'Credito pratica firmata';
  if (tipo === 'CREDITO_AFFILIAZIONE') return 'Commissione affiliazione';
  if (tipo === 'CREDITO_PROMO') return 'Bonus promozionale';
  if (tipo === 'PAYOUT_AUTOMATICO') return 'Payout automatico';
  if (tipo === 'PAYOUT_MANUALE') return 'Payout manuale';
  if (tipo === 'RETTIFICA_ADMIN') return 'Rettifica admin';
  if (tipo === 'STORNO') return 'Storno';
  if (tipo === 'PENALE_BROKER') return 'Penale segnalazione';
  return tipo;
}

/**
 * Solo l'addebito della sanzione.
 *
 * Lo `STORNO` che a volte l'accompagna nel flusso penale è il recupero di un
 * compenso già accreditato, non una sanzione; e una `RETTIFICA_ADMIN` negativa
 * può essere una semplice correzione contabile. Evidenziare per errore è peggio
 * che non evidenziare, quindi un tipo nuovo resta non evidenziato finché
 * qualcuno non lo dichiara qui.
 */
export function isPenale(tipo: string): boolean {
  return tipo === 'PENALE_BROKER';
}

/**
 * Classi della riga di una penale.
 *
 * L'importo è già rosso per OGNI movimento negativo, payout compresi: senza un
 * secondo segnale una sanzione non si distingue da un incasso. Il fondo resta
 * dentro il padding della lista — niente margini negativi da accordare al
 * padding della `Card`, che è `p-5 sm:p-6` e cambia al breakpoint.
 */
export const CLASSI_RIGA_PENALE =
  'border-l-2 border-pv-red-500 bg-pv-red-50/40 pl-3 pr-2 rounded-r-[6px]';
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm --filter piattaforma exec vitest run src/app/wallet/movimenti.test.ts
```

Atteso: PASS. Sono 1 + 7 (`it.each`) + 1 + 1 + 2 + 1 + 1 + 8 (`it.each` sullo schema) = 22 test.

- [ ] **Step 5: `page.tsx` usa il modulo**

In `apps/piattaforma/src/app/wallet/page.tsx`:

1. **Cancella** la funzione privata `labelTipoTx` in fondo al file (comincia con `function labelTipoTx(t: string): string {` e finisce con la sua `}`). **Non toccare** `motivoMovimento`, che le sta accanto: riguarda la nota e la pratica, non il tipo.
2. Aggiungi l'import accanto agli altri import locali:

```ts
import { labelTipoTx } from './movimenti';
```

Nient'altro cambia in questo task: le chiamate a `labelTipoTx(...)` restano identiche, ora risolte dall'import. È un refactor puro, l'aspetto della pagina non si muove.

- [ ] **Step 6: Verifica che nulla sia cambiato**

```bash
nvm use 22.15.0
pnpm typecheck
pnpm --filter piattaforma test
pnpm --filter piattaforma lint
```

Atteso: typecheck pulito, suite verde, lint senza errori (4 warning preesistenti in `register-wizard.tsx` e `api/badges/route.test.ts` sono attesi).

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/wallet/movimenti.ts apps/piattaforma/src/app/wallet/movimenti.test.ts apps/piattaforma/src/app/wallet/page.tsx
git commit -m "$(cat <<'EOF'
refactor(wallet): estrae la presentazione dei movimenti in un modulo condiviso

labelTipoTx era privata di page.tsx, ma le viste dei movimenti sono due. Insieme
a lei nascono isPenale e le classi della riga penale, che il prossimo commit usa:
"cos'e' una penale" e "che aspetto ha" devono avere una fonte sola.

Un test legge schema.prisma e verifica che ogni valore di TransazioneWalletTipo
abbia un'etichetta: se qualcuno aggiunge un tipo e la dimentica, diventa rosso.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: La riga della penale si vede

**Files:**
- Modify: `apps/piattaforma/src/app/wallet/page.tsx` (la `<li>` dei movimenti; il ramo aggregato)
- Modify: `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx`

**Interfaces:**
- Consumes: `labelTipoTx(tipo: string): string`, `isPenale(tipo: string): boolean`, `CLASSI_RIGA_PENALE: string` da `./movimenti` (Task 1).

- [ ] **Step 1: Evidenzia la riga nella vista per sede**

In `apps/piattaforma/src/app/wallet/page.tsx`, estendi l'import:

```ts
import { labelTipoTx, isPenale, CLASSI_RIGA_PENALE } from './movimenti';
```

Nella lista "Movimenti", la riga è oggi:

```tsx
<li key={t.id} className="flex items-center justify-between py-3">
```

Diventa:

```tsx
<li
  key={t.id}
  className={`flex items-center justify-between py-3 ${
    isPenale(t.tipo) ? CLASSI_RIGA_PENALE : ''
  }`}
>
```

`t.tipo` qui è il **tipo grezzo**: la lista renderizza direttamente le righe Prisma. Nient'altro nella `<li>` cambia.

- [ ] **Step 2: Il ramo aggregato passa il tipo grezzo**

Sempre in `page.tsx`, nel ramo della vista aggregata (quello attivo quando `getOperatingSede()` è `null` e l'utente è proprietario), l'array `movimenti` viene costruito in **due** punti con `tipo: labelTipoTx(t.tipo)`. Entrambi diventano:

```ts
        tipo: t.tipo,
```

L'etichetta la applicherà il componente. Nessun cast: `t.tipo` è già una stringa dal punto di vista del consumatore.

⚠️ Attenzione: `labelTipoTx` resta usata **nella vista per sede** (riga `{labelTipoTx(t.tipo)}` dentro la `<li>`), quindi l'import serve ancora. Non rimuoverlo.

- [ ] **Step 3: Il componente aggregato etichetta ed evidenzia**

In `apps/piattaforma/src/app/wallet/wallet-aggregato.tsx`, aggiungi l'import:

```ts
import { labelTipoTx, isPenale, CLASSI_RIGA_PENALE } from './movimenti';
```

Aggiorna il commento del campo nel tipo, perché ora contiene il valore dell'enum e non l'etichetta:

```ts
export type MovimentoAggregato = {
  id: string;
  createdAt: Date;
  /** Tipo grezzo (`TransazioneWalletTipo`): l'etichetta la applica questo componente. */
  tipo: string;
  importoCent: number;
  /** Nome della sede, oppure `null` per il wallet madre (affiliazione). */
  origine: string | null;
};
```

Sostituisci la riga del movimento:

```tsx
              <div key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-pv-slate-700">{m.tipo}</p>
```

con:

```tsx
              <div
                key={m.id}
                className={`flex items-center justify-between gap-3 py-3 ${
                  isPenale(m.tipo) ? CLASSI_RIGA_PENALE : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-pv-slate-700">
                    {labelTipoTx(m.tipo)}
                  </p>
```

Il resto della riga (data, origine, importo) non cambia.

- [ ] **Step 4: Verifica**

```bash
nvm use 22.15.0
pnpm typecheck
pnpm --filter piattaforma test
pnpm --filter piattaforma lint
```

Atteso: typecheck pulito, suite verde, lint senza errori.

⚠️ Tailwind v4 non risolve nomi di classe costruiti a runtime, ma qui non se ne costruiscono: `CLASSI_RIGA_PENALE` è una stringa **letterale** in un file `.ts` sorgente, quindi lo scanner la vede. Se dopo un `pnpm --filter piattaforma build` le classi non comparissero nel CSS generato, sarebbe questo il sospetto — ma non dovrebbe accadere.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/wallet/page.tsx apps/piattaforma/src/app/wallet/wallet-aggregato.tsx
git commit -m "$(cat <<'EOF'
feat(wallet): la penale si riconosce a colpo d'occhio nei movimenti

L'importo e' gia' rosso per ogni movimento negativo, payout compresi: il colore
da solo non distingue una sanzione. Bordo sinistro rosso e fondo tenue sulla
riga, in entrambe le viste che elencano i movimenti.

La vista aggregata torna a ricevere il tipo grezzo ed etichetta al render: prima
riceveva l'etichetta e non sapeva piu' cosa stesse mostrando.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Verifica finale

**Files:** nessuno (solo verifica), salvo fix emersi.

- [ ] **Step 1: Suite, typecheck, lint**

```bash
nvm use 22.15.0
pnpm --filter piattaforma test
pnpm typecheck
pnpm --filter piattaforma lint
```

- [ ] **Step 2: Le classi finiscono davvero nel CSS**

Il rischio numero uno di una classe Tailwind che vive in un `.ts` invece che in un `.tsx`: che lo scanner non la raccolga.

```bash
nvm use 22.15.0
pnpm --filter piattaforma build
```

Poi cerca nel CSS generato (`apps/piattaforma/.next/static/css/*.css`) le regole corrispondenti a `border-pv-red-500` e a `bg-pv-red-50/40`. Se non ci sono, la riga della penale non avrà alcuno stile a runtime e il task **non è fatto**: riporta.

⚠️ Nota ambientale: su questa macchina `next build` può crashare in "Collecting page data" con `spawn ...node.exe ENOENT`. È un quirk di nvm4w/Windows che avviene **dopo** la generazione del CSS: se lo incontri, il controllo sul CSS è comunque valido. Riporta fin dove è arrivato.

- [ ] **Step 3: A video**

```bash
pnpm --filter piattaforma dev
```

Serve un wallet che contenga **sia** una penale sia un payout, per vedere che si distinguono.

1. Vista per singola sede: la riga "Penale segnalazione" ha bordo e fondo rossi; la riga "Payout manuale", pur avendo l'importo rosso, no.
2. Vista aggregata (proprietario senza sede selezionata): stessa cosa, e la colonna origine continua a dire da quale sede arriva.
3. I separatori `divide-y` non si rompono, e il fondo colorato non sborda dalla `Card`.

---

## Note per chi implementa

- **Non aggiungere un chip "Penale"**: l'etichetta dice già "Penale segnalazione", e nella vista per sede sotto compare il motivo. Il colore non è l'unico veicolo dell'informazione, quindi un badge sarebbe rumore.
- **Non evidenziare lo `STORNO`.** È una decisione presa, non una svista: nel flusso penale nasce insieme all'addebito, ma è il recupero di un compenso già accreditato. Due righe rosse per un evento solo sarebbero fuorvianti.
- Se il fondo colorato ti sembra troppo timido a video, cambia l'opacità in `CLASSI_RIGA_PENALE` (`/40` → `/60`). È un solo posto, per questo la costante esiste.
