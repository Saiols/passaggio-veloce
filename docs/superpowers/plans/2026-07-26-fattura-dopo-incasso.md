# Fattura PV dopo l'incasso confermato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La `FATTURA_PV` verso l'agenzia nasce quando l'addebito è realmente incassato (`FeeAddebito` → `SUCCESS`), non più alla firma, e l'addebito parte dalla firma invece di aspettare il cron.

**Architecture:** Un unico `segnaFeeIncassato` diventa proprietario della transizione a `SUCCESS` (oggi duplicata fra `process.ts` e `stripe-webhook.ts`) e da lì emette la fattura, protetto da un compare-and-set che impedisce la doppia emissione. `createFatturaPv` passa a prendere in ingresso il `feeAddebitoId` e a restituire il documento creato (o `null` se esisteva già), così N53 parte una volta sola da chiamanti che non si conoscono. Una valvola su `isPaymentLive()` tiene il comportamento di oggi finché il provider di pagamento è `mock`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma + Postgres, Vitest, Stripe SEPA Direct Debit, cron Vercel.

## Global Constraints

- **Una sola migration, e solo nel Task 5.** Sui dati non serve nulla: `DocumentoFiscale.feeAddebitoId`, `statoPagamento: PAGATA` e `inviatoEmailAt` esistono già in `packages/db/prisma/schema.prisma`. Ma `NotificaInviata.tipo` è un **enum Postgres** `NotificaTipo`, quindi la N53 richiede un `ALTER TYPE ... ADD VALUE`, come ogni notifica aggiunta prima di lei (N44, N45, N46-49, N52). In tutti gli altri task una migration è il segnale che il task è sbagliato.
- **Le migration si scrivono a mano.** `pnpm db:migrate` in questo repo propone DROP di sequenze: si crea il file SQL a mano e si applica con `db:deploy`.
- **Nessun backfill** dei documenti già emessi in produzione: quei dati sono usa-e-getta.
- Comandi: `pnpm --filter piattaforma test <path>` per i test mirati, `pnpm typecheck` dalla root. Node ≥ 18 (`nvm use 22.15.0` se la shell è tornata a Node 16).
- Ogni task termina con un commit. Si lavora direttamente su `main`.
- Il codice e i commenti di questo repo sono in italiano: mantenere la lingua.
- **Nessun `catch` muto.** I `.catch` best-effort di questo piano servono a non far fallire un'operazione già committata, non a nascondere il guasto: ognuno logga con `console.error`, includendo l'id dell'entità coinvolta, nello stile di `lib/fee/retry.ts:27-29`. Un'emissione fiscale che salta senza lasciare traccia non è recuperabile da nessuno.
- Fuori scope in tutto il piano: dispute/rimborsi SEPA post-incasso, nota di credito automatica, pulsante admin di emissione manuale.

---

### Task 1: `createFatturaPv` prende il fee e restituisce il documento

Cambia il contratto senza cambiare il comportamento: la fattura continua a nascere alla firma, ma l'importo arriva dal `FeeAddebito` (quello davvero addebitato) invece che da `pratica.feeAgenziaCent`, lo stato pagamento diventa un argomento esplicito, e il ritorno serve ai task successivi per sapere chi ha creato il documento.

**Files:**
- Modify: `apps/piattaforma/src/lib/fatturazione/engine.ts:10-54`
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts:184` (variabile), `:318-332` (create del fee), `:362-371` (chiamata)
- Test: `apps/piattaforma/src/lib/fatturazione/engine.test.ts` (nuovo)

**Interfaces:**
- Produces: `createFatturaPv(input: { feeAddebitoId: string; statoPagamento: 'IN_ATTESA' | 'PAGATA' }): Promise<{ id: string } | null>` — `null` quando il fee non esiste, ha importo ≤ 0, l'agenzia non esiste, o la `FATTURA_PV` per quella pratica c'è già.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/fatturazione/engine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txMock, prismaMock, prossimoContatoreMock } = vi.hoisted(() => {
  const txMock = {
    feeAddebito: { findUnique: vi.fn() },
    documentoFiscale: { findFirst: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn() },
  };
  return {
    txMock,
    prismaMock: { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(txMock)) },
    prossimoContatoreMock: vi.fn(),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./numerazione', () => ({ prossimoContatore: prossimoContatoreMock }));
vi.mock('./pv-emittente', () => ({
  pvEmittente: () => ({ ragioneSociale: 'PV' }),
  snapshotCompany: (c: { ragioneSociale: string }) => ({ ragioneSociale: c.ragioneSociale }),
}));

import { createFatturaPv } from './engine';

const FEE = { id: 'fee-1', praticaId: 'pr-1', agenziaId: 'ag-1', importoCent: 7500 };

beforeEach(() => {
  vi.clearAllMocks();
  txMock.feeAddebito.findUnique.mockResolvedValue(FEE);
  txMock.documentoFiscale.findFirst.mockResolvedValue(null);
  txMock.company.findUnique.mockResolvedValue({ id: 'ag-1', ragioneSociale: 'Agenzia Uno' });
  txMock.documentoFiscale.create.mockResolvedValue({ id: 'doc-1' });
  prossimoContatoreMock.mockResolvedValue(3);
});

describe('createFatturaPv', () => {
  it("usa l'importo del fee, non quello previsto sulla pratica", async () => {
    txMock.feeAddebito.findUnique.mockResolvedValue({ ...FEE, importoCent: 3000 });
    await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(txMock.documentoFiscale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ importoLordoCent: 3000 }),
      }),
    );
  });

  it('propaga lo statoPagamento richiesto dal chiamante e lega il fee al documento', async () => {
    await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(txMock.documentoFiscale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statoPagamento: 'PAGATA', feeAddebitoId: 'fee-1' }),
      }),
    );
  });

  it('restituisce il documento creato', async () => {
    const out = await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'IN_ATTESA' });
    expect(out).toEqual({ id: 'doc-1' });
  });

  it('restituisce null e non crea nulla se la fattura della pratica esiste già', async () => {
    txMock.documentoFiscale.findFirst.mockResolvedValue({ id: 'doc-esistente' });
    const out = await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(out).toBeNull();
    expect(txMock.documentoFiscale.create).not.toHaveBeenCalled();
  });

  it('restituisce null su fee inesistente o importo non positivo', async () => {
    txMock.feeAddebito.findUnique.mockResolvedValue(null);
    expect(await createFatturaPv({ feeAddebitoId: 'x', statoPagamento: 'PAGATA' })).toBeNull();

    txMock.feeAddebito.findUnique.mockResolvedValue({ ...FEE, importoCent: 0 });
    expect(await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' })).toBeNull();
    expect(txMock.documentoFiscale.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/engine.test.ts`
Expected: FAIL — la firma attuale di `createFatturaPv` accetta `{ praticaId, agenziaId, feeAgenziaCent }`, quindi `txMock.feeAddebito.findUnique` non viene mai chiamata e `create` riceve `importoLordoCent: undefined`.

- [ ] **Step 3: Riscrivi `createFatturaPv`**

In `apps/piattaforma/src/lib/fatturazione/engine.ts`, sostituisci l'intera funzione `createFatturaPv` (righe 10-54) con:

```ts
/**
 * FATTURA_PV verso l'agenzia. Importo = `FeeAddebito.importoCent`, cioè quello
 * davvero addebitato: se l'addebito è stato modificato dopo la firma, la
 * fattura segue lui e non il preventivo scritto sulla pratica.
 *
 * `statoPagamento` è a carico del chiamante e non è un dettaglio: `PAGATA` sul
 * percorso d'incasso (i soldi ci sono), `IN_ATTESA` sulla valvola che emette
 * alla firma quando il provider di pagamento non è live.
 *
 * Ritorna il documento creato, oppure `null` se non c'era niente da creare —
 * fee assente, importo non positivo, agenzia assente, o fattura già esistente
 * per quella pratica. Il `null` è il segnale che fa partire la N53 una volta
 * sola da chiamanti che non si conoscono (percorso d'incasso e riconciliazione).
 *
 * Idempotente per pratica: è la seconda rete sotto il compare-and-set di
 * `segnaFeeIncassato`.
 */
export async function createFatturaPv(input: {
  feeAddebitoId: string;
  statoPagamento: 'IN_ATTESA' | 'PAGATA';
}): Promise<{ id: string } | null> {
  const anno = new Date().getFullYear();
  return prisma.$transaction(async (tx) => {
    const fee = await tx.feeAddebito.findUnique({ where: { id: input.feeAddebitoId } });
    if (!fee || fee.importoCent <= 0) return null;

    const esiste = await tx.documentoFiscale.findFirst({
      where: { praticaId: fee.praticaId, tipo: 'FATTURA_PV' },
      select: { id: true },
    });
    if (esiste) return null;

    const agenzia = await tx.company.findUnique({ where: { id: fee.agenziaId } });
    if (!agenzia) return null;

    const split = splitImporto(fee.importoCent, 'ORDINARIO');
    const num = await prossimoContatore(tx, ID_SOGGETTO_PV, 'FATTURA_PV', anno);
    const numeroStr = numeroDocumento({ tipo: 'FATTURA_PV', numeroProgressivo: num, anno });

    return tx.documentoFiscale.create({
      data: {
        tipo: 'FATTURA_PV',
        fatturaPaTipo: 'TD01',
        praticaId: fee.praticaId,
        // Legame documento ↔ incasso: il campo esisteva in schema ma non veniva
        // mai scritto. Serve alla lettura admin, non alla riconciliazione (che
        // interroga per praticaId, l'unico dei due che ha un indice).
        feeAddebitoId: fee.id,
        emittenteCompanyId: null,
        destinatarioCompanyId: agenzia.id,
        datiEmittente: pvEmittente() as unknown as Prisma.InputJsonValue,
        datiDestinatario: snapshotCompany(agenzia) as unknown as Prisma.InputJsonValue,
        numeroProgressivo: num,
        anno,
        numeroDocumentoStr: numeroStr,
        importoLordoCent: fee.importoCent,
        imponibileCent: split.imponibileCent,
        ivaCent: split.ivaCent,
        aliquotaIvaPct: split.aliquotaIvaPct,
        statoPagamento: input.statoPagamento,
      },
      select: { id: true },
    });
  });
}
```

Nota su `anno`: resta `new Date().getFullYear()`, quindi dal Task 3 in poi è l'anno dell'**incasso**. Una pratica firmata il 30 dicembre e incassata il 4 gennaio prende un numero dell'anno nuovo. È corretto (data documento = data emissione) ed è una conseguenza voluta.

- [ ] **Step 4: Aggiorna il chiamante in `firma-engine.ts`**

Il motore deve tenersi l'id del fee appena creato. In `apps/piattaforma/src/lib/pratiche/firma-engine.ts`:

Sostituisci la dichiarazione a riga 184:

```ts
  let feeAgenziaCentFattura = 0;
```

con:

```ts
  // Id del FeeAddebito creato nella transazione di firma: è l'ingresso sia
  // della fattura sia dell'addebito.
  let feeAddebitoIdCreato: string | null = null;
```

Elimina l'assegnazione `feeAgenziaCentFattura = pratica.feeAgenziaCent;` (riga 239).

Sostituisci il blocco di creazione del fee (righe 318-332) con:

```ts
      if (pratica.feeAgenziaCent > 0) {
        const feeCreato = await tx.feeAddebito.create({
          data: {
            praticaId: pratica.id,
            agenziaId: agenziaIdEffettivo,
            // Multi-sede: l'addebito appartiene alla SEDE che ha lavorato la pratica.
            // Senza questo, /addebiti (scopato per sede) non vedrebbe la riga.
            agenziaSedeId: pratica.agenziaSedeId,
            importoCent: pratica.feeAgenziaCent,
            tipo: 'ADDEBITO_FIRMA',
            stato: 'SCHEDULED',
            scheduledAt: autoAddebitoAt,
          },
          select: { id: true },
        });
        feeAddebitoIdCreato = feeCreato.id;
      }
```

Sostituisci la chiamata alla fattura (righe 362-371) con:

```ts
  // FT-A: genera la fattura PV verso l'agenzia. ATTESA (era fire-and-forget):
  // il PDF della fattura va allegato alla N8, quindi deve esistere prima di
  // costruire l'allegato. Resta best-effort — la firma è già committata, un
  // errore qui non blocca nulla e la N8 partirà comunque (eventualmente senza
  // allegato).
  if (feeAddebitoIdCreato) {
    await createFatturaPv({
      feeAddebitoId: feeAddebitoIdCreato,
      statoPagamento: 'IN_ATTESA',
    }).catch(() => null);
  }
```

- [ ] **Step 5: Esegui i test e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/engine.test.ts src/lib/pratiche/firma-engine.test.ts src/app/pratiche`
Expected: PASS. Se `firma-engine.test.ts` o `actions.*.test.ts` falliscono sul mock di `@/lib/fatturazione/engine`, aggiorna il mock a `createFatturaPv: vi.fn(() => Promise.resolve(null))` (già così in `firma-engine.test.ts:63`, `actions.authz.test.ts:59`, `actions.n4-n31.test.ts:69`) e fai in modo che `prismaMock.feeAddebito.create` restituisca `{ id: 'fee-1' }`.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/fatturazione/engine.ts apps/piattaforma/src/lib/fatturazione/engine.test.ts apps/piattaforma/src/lib/pratiche/firma-engine.ts apps/piattaforma/src/lib/pratiche/firma-engine.test.ts apps/piattaforma/src/app/pratiche
git commit -m "refactor(fatturazione): createFatturaPv prende il fee e restituisce il documento"
```

---

### Task 2: `segnaFeeIncassato`, unico punto di transizione a SUCCESS

Oggi un fee diventa `SUCCESS` in due posti che duplicano la stessa coppia di azioni. Questo task li fa convergere su una funzione sola e ci aggancia l'emissione della fattura. Da qui in poi la fattura nasce sia alla firma sia all'incasso: l'idempotenza per pratica fa sì che ne resti una — è il Task 3 a togliere la prima.

**Files:**
- Create: `apps/piattaforma/src/lib/fee/incasso.ts`
- Test: `apps/piattaforma/src/lib/fee/incasso.test.ts` (nuovo)
- Modify: `apps/piattaforma/src/lib/fee/process.ts:32-37`
- Modify: `apps/piattaforma/src/lib/jobs/stripe-webhook.ts:11-28`
- Modify: `apps/piattaforma/src/lib/fee/process.test.ts`, `apps/piattaforma/src/lib/jobs/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: `createFatturaPv({ feeAddebitoId, statoPagamento })` dal Task 1.
- Produces: `segnaFeeIncassato(feeId: string, providerRef: string): Promise<boolean>` — `true` se questa chiamata ha vinto il compare-and-set (e quindi ha fatto tutto il resto), `false` se il fee era già `SUCCESS` o `ANNULLATO`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/fee/incasso.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, feeFindUnique, rivaluta, createFatturaPvMock } = vi.hoisted(() => ({
  feeUpdateMany: vi.fn(),
  feeFindUnique: vi.fn(),
  rivaluta: vi.fn(),
  createFatturaPvMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { feeAddebito: { updateMany: feeUpdateMany, findUnique: feeFindUnique } },
}));
vi.mock('./blocco', () => ({ rivalutaBloccoAgenzia: rivaluta }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));

import { segnaFeeIncassato } from './incasso';

beforeEach(() => {
  vi.clearAllMocks();
  feeUpdateMany.mockResolvedValue({ count: 1 });
  feeFindUnique.mockResolvedValue({ agenziaId: 'ag-1' });
  rivaluta.mockResolvedValue(undefined);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
});

describe('segnaFeeIncassato', () => {
  it('vince il CAS: marca SUCCESS, rivaluta il blocco ed emette la fattura PAGATA', async () => {
    const out = await segnaFeeIncassato('fee-1', 'pi_1');
    expect(out).toBe(true);
    expect(rivaluta).toHaveBeenCalledWith('ag-1');
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'PAGATA',
    });
  });

  it('perde il CAS: nessuna seconda fattura, nessuna rivalutazione', async () => {
    feeUpdateMany.mockResolvedValue({ count: 0 });
    const out = await segnaFeeIncassato('fee-1', 'pi_1');
    expect(out).toBe(false);
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(rivaluta).not.toHaveBeenCalled();
  });

  it('non porta a SUCCESS un fee ANNULLATO', async () => {
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(feeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'fee-1', stato: { notIn: ['SUCCESS', 'ANNULLATO'] } },
      data: {
        stato: 'SUCCESS',
        providerRef: 'pi_1',
        executedAt: expect.any(Date),
        errorMessage: null,
      },
    });
  });

  it("un errore in emissione non annulla l'incasso", async () => {
    createFatturaPvMock.mockRejectedValue(new Error('contatore ko'));
    await expect(segnaFeeIncassato('fee-1', 'pi_1')).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/fee/incasso.test.ts`
Expected: FAIL — "Failed to resolve import ./incasso".

- [ ] **Step 3: Scrivi `lib/fee/incasso.ts`**

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { rivalutaBloccoAgenzia } from './blocco';
import { createFatturaPv } from '@/lib/fatturazione/engine';

/**
 * UNICO punto in cui un FeeAddebito diventa SUCCESS.
 *
 * Prima esistevano due percorsi che scrivevano lo stesso stato e chiamavano lo
 * stesso `rivalutaBloccoAgenzia` in copia: l'esito sincrono di `chargeFee`
 * (process.ts) e il webhook `payment_intent.succeeded` per il settlement SEPA
 * asincrono (stripe-webhook.ts). Appendere l'emissione della fattura a
 * entrambi significava garantire che il prossimo intervento la dimenticasse in
 * uno dei due.
 *
 * Il compare-and-set NON è un dettaglio di concorrenza: è ciò che impedisce la
 * doppia fattura. Stripe può consegnare lo stesso evento più volte, e l'esito
 * sincrono può correre contro il webhook. Emette solo chi vince l'UPDATE.
 *
 * `ANNULLATO` resta escluso: un webhook in ritardo su un fee annullato non
 * deve resuscitarlo, tanto meno fatturarlo.
 *
 * Ritorna `true` se questa chiamata ha vinto (e quindi ha fatto tutto il resto).
 */
export async function segnaFeeIncassato(feeId: string, providerRef: string): Promise<boolean> {
  const claim = await prisma.feeAddebito.updateMany({
    where: { id: feeId, stato: { notIn: ['SUCCESS', 'ANNULLATO'] } },
    data: { stato: 'SUCCESS', providerRef, executedAt: new Date(), errorMessage: null },
  });
  if (claim.count === 0) return false;

  const fee = await prisma.feeAddebito.findUnique({
    where: { id: feeId },
    select: { agenziaId: true },
  });
  if (fee) await rivalutaBloccoAgenzia(fee.agenziaId);

  // I soldi sono arrivati: qualunque cosa vada storta nell'emissione, il fee
  // resta SUCCESS. La riconciliazione oraria recupera il documento mancante.
  await createFatturaPv({ feeAddebitoId: feeId, statoPagamento: 'PAGATA' }).catch(() => null);

  return true;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/fee/incasso.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Aggancia `process.ts`**

In `apps/piattaforma/src/lib/fee/process.ts`, sostituisci l'import di riga 5 e il ramo `SUCCESS` (righe 32-37).

Import da aggiungere sotto quelli esistenti:

```ts
import { segnaFeeIncassato } from './incasso';
```

Ramo `SUCCESS`:

```ts
  if (outcome.status === 'SUCCESS') {
    // Transizione + sblocco + fattura: tutto dentro segnaFeeIncassato, che è
    // l'unico proprietario del passaggio a SUCCESS (v. incasso.ts).
    await segnaFeeIncassato(feeId, outcome.providerRef);
  } else if (outcome.status === 'PENDING') {
```

Rimuovi da `process.ts` l'import di `rivalutaBloccoAgenzia` se non più usato (resta usato `bloccaAgenziaPerAddebito`): la riga 5 diventa
`import { bloccaAgenziaPerAddebito } from './blocco';`.

- [ ] **Step 6: Aggancia `stripe-webhook.ts`**

In `apps/piattaforma/src/lib/jobs/stripe-webhook.ts`, sostituisci il case `payment_intent.succeeded` (righe 11-29) con:

```ts
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        const vinto = await segnaFeeIncassato(feeId, pi.id);
        if (!vinto) {
          console.warn(`[stripe-webhook] succeeded: nessun FeeAddebito aggiornato (id=${feeId}, pi=${pi.id})`);
        }
      } else {
        console.warn(`[stripe-webhook] payment_intent.succeeded senza metadata.feeAddebitoId (pi=${pi.id})`);
      }
      break;
    }
```

Aggiorna gli import in testa al file: aggiungi `import { segnaFeeIncassato } from '@/lib/fee/incasso';` e togli `rivalutaBloccoAgenzia` da quello di `@/lib/fee/blocco` (resta `bloccaAgenziaPerAddebito`).

- [ ] **Step 7: Aggiorna i test dei due chiamanti**

In `apps/piattaforma/src/lib/fee/process.test.ts`: aggiungi al blocco `vi.hoisted` un `segnaIncassato: vi.fn()`, il mock `vi.mock('./incasso', () => ({ segnaFeeIncassato: segnaIncassato }))`, e in `beforeEach` `segnaIncassato.mockResolvedValue(true)`.

Il test `'SUCCESS: marca SUCCESS e rivaluta lo sblocco'` ora descrive una responsabilità che non è più sua: rinominalo in `'SUCCESS: delega la transizione a segnaFeeIncassato'` e sostituisci l'asserzione `expect(rivaluta).toHaveBeenCalledWith('a1')` con:

```ts
  expect(segnaIncassato).toHaveBeenCalledWith('f1', 'pi_1');
```

`rivaluta` resta nei mock del file: lo usa ancora il ramo di fallimento tramite `blocco.ts`.

In `apps/piattaforma/src/lib/jobs/stripe-webhook.test.ts`: aggiungi `segnaIncassato: vi.fn()` al `vi.hoisted`, `vi.mock('@/lib/fee/incasso', () => ({ segnaFeeIncassato: segnaIncassato }))`, e in `beforeEach` `segnaIncassato.mockResolvedValue(true)`. Sostituisci l'asserzione del test `payment_intent.succeeded` con:

```ts
    expect(segnaIncassato).toHaveBeenCalledWith('fee-1', 'pi_1');
```

- [ ] **Step 8: Esegui tutti i test toccati e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/fee src/lib/jobs/stripe-webhook.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/lib/fee apps/piattaforma/src/lib/jobs/stripe-webhook.ts apps/piattaforma/src/lib/jobs/stripe-webhook.test.ts
git commit -m "feat(fee): segnaFeeIncassato unico punto di transizione a SUCCESS + emissione fattura"
```

---

### Task 3: La valvola — chi emette dipende da `isPaymentLive()`

Questo è il task che sposta davvero l'emissione. Con provider live la firma smette di fatturare; con `mock` resta tutto com'era, perché in mock nessun addebito parte e la fattura non nascerebbe mai. Nello stesso task il gate `isPaymentLive()` scende dentro `processFeeAddebito`, così anche `ritentaAddebitiAgenzia` smette di poter portare a `SUCCESS` soldi finti.

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts` (blocco fattura del Task 1)
- Modify: `apps/piattaforma/src/lib/fee/process.ts:14`
- Test: `apps/piattaforma/src/lib/pratiche/firma-engine.fattura-addebito.test.ts` (nuovo)
- Modify: `apps/piattaforma/src/lib/fee/process.test.ts`

**Interfaces:**
- Consumes: `isPaymentLive(): boolean` da `@/lib/jobs/payment-live`; `createFatturaPv` dal Task 1.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/pratiche/firma-engine.fattura-addebito.test.ts`. Lo stile dei mock ricalca `firma-engine.test.ts`; qui però si esercita l'happy path, quindi `prismaMock` deve rispondere a tutta la transazione.

**Si firma come ADMIN, non come agenzia.** Il ramo `AGENZIA` passa da `assertSedeInScope` (`firma-engine.ts:62-75`), che con uno scope sede vuoto lancia `Pratica non assegnata alla tua sede` e il test morirebbe in setup prima di arrivare a fattura e addebito. Il ramo ADMIN (attestazione, Termini art. 11) salta scope e permessi azienda ed esegue esattamente lo stesso codice di emissione.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chi emette la fattura e chi fa partire l'addebito, al variare di
 * isPaymentLive(). È il test che protegge la valvola: se sparisce, un deploy
 * con PAYMENT_PROVIDER=mock smette di produrre fatture senza che nulla lo dica.
 */

const { prismaMock, authMock, redirectMock, createFatturaPvMock, processFeeMock, isPaymentLiveMock } =
  vi.hoisted(() => {
    const prismaMock = {
      pratica: { findUnique: vi.fn(), updateMany: vi.fn() },
      feeAddebito: { create: vi.fn() },
      praticaStatoLog: { create: vi.fn() },
      wallet: { upsert: vi.fn(), update: vi.fn() },
      transazioneWallet: { create: vi.fn() },
      commissioneAffiliazione: { findMany: vi.fn() },
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
    };
    return {
      prismaMock,
      authMock: vi.fn(),
      redirectMock: vi.fn((url: string) => {
        throw new Error(`__REDIRECT__:${url}`);
      }),
      createFatturaPvMock: vi.fn(),
      processFeeMock: vi.fn(),
      isPaymentLiveMock: vi.fn(),
    };
  });

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/permessi/guard', () => ({ requirePermesso: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/auth/permissions', () => ({ isAdminPiattaforma: () => true }));
vi.mock('@/lib/fee/blocco', () => ({ isAgenziaBloccata: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/lib/affiliazione/accredit', () => ({
  accreditCommissioniAffiliazione: vi.fn(() => Promise.resolve({ accrediti: [] })),
}));
vi.mock('@/lib/affiliazione/notifications', () => ({
  notifyReferralFirstPratica: vi.fn(() => Promise.resolve()),
  notifyPayoutThresholdCrossed: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/crm/sync', () => ({ onPraticaFirmata: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));
vi.mock('@/lib/fatturazione/documento-pdf', () => ({ fatturaPvAttachment: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/wallet/auto-payout', () => ({ autoPayoutBrokerDopoFirma: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaFirmata: vi.fn(() => ({})) }));
vi.mock('@/lib/jobs/payment-live', () => ({ isPaymentLive: isPaymentLiveMock }));
vi.mock('@/lib/fee/process', () => ({ processFeeAddebito: processFeeMock }));

import { firmaPraticaCore } from './firma-engine';

const PRATICA = {
  id: 'pr-1',
  stato: 'PROCESSATA',
  flagSegnalata: false,
  agenziaAssegnataId: 'ag-1',
  agenziaSedeId: 'sede-1',
  brokerSedeId: null,
  feeAgenziaCent: 7500,
  creditoBrokerCent: 0,
  numeroVeicoli: 1,
  tipo: 'SEMPLICE',
  brokerId: 'br-1',
  broker: { referente: null, referenteSedeId: null },
  agenziaAssegnata: { referente: null, referenteSedeId: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.pratica.findUnique.mockResolvedValue(PRATICA);
  prismaMock.pratica.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.praticaStatoLog.create.mockResolvedValue({});
  prismaMock.feeAddebito.create.mockResolvedValue({ id: 'fee-1' });
  prismaMock.commissioneAffiliazione.findMany.mockResolvedValue([]);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  processFeeMock.mockResolvedValue('SUCCESS');
});

describe('emissione fattura alla firma', () => {
  it('provider live: la firma NON emette la fattura (la emette l’incasso)', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(createFatturaPvMock).not.toHaveBeenCalled();
  });

  it('provider mock: la valvola emette alla firma, IN_ATTESA', async () => {
    isPaymentLiveMock.mockReturnValue(false);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'IN_ATTESA',
    });
  });
});
```

Se la `findUnique` della sezione notifiche (il secondo `prisma.pratica.findUnique` post-commit) restituisce lo stesso oggetto e manda in errore il blocco email, va bene: quel blocco è già `try/catch` nel motore e non deve influenzare queste asserzioni. Se invece rompe il test, fai restituire `null` alla seconda chiamata con `mockResolvedValueOnce(PRATICA).mockResolvedValueOnce(null)`.

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/pratiche/firma-engine.fattura-addebito.test.ts`
Expected: FAIL sul primo test — oggi la firma emette sempre, quindi `createFatturaPvMock` risulta chiamato anche con provider live.

- [ ] **Step 3: Metti la valvola in `firma-engine.ts`**

Aggiungi l'import:

```ts
import { isPaymentLive } from '@/lib/jobs/payment-live';
```

e sostituisci il blocco fattura scritto nel Task 1 con:

```ts
  // FT-A: la fattura PV nasce all'INCASSO confermato (lib/fee/incasso.ts), non
  // qui: emetterla alla firma la renderebbe una fattura anticipata, con l'IVA
  // esigibile su denaro che può non arrivare mai.
  //
  // VALVOLA: con provider di pagamento `mock` nessun addebito parte (il gate è
  // in processFeeAddebito), quindi nessun fee arriverà mai a SUCCESS e la
  // fattura non nascerebbe affatto. In quel caso resta emessa qui, IN_ATTESA,
  // esattamente come prima di questo cambio. La valvola si chiude da sola il
  // giorno del go-live Stripe.
  if (feeAddebitoIdCreato && !isPaymentLive()) {
    await createFatturaPv({
      feeAddebitoId: feeAddebitoIdCreato,
      statoPagamento: 'IN_ATTESA',
    }).catch((err) => {
      console.error(
        `[firmaPratica] createFatturaPv fallita per fee ${feeAddebitoIdCreato} (pratica ${praticaId}):`,
        err,
      );
      return null;
    });
  }
```

- [ ] **Step 4: Sposta il gate dentro `processFeeAddebito`**

In `apps/piattaforma/src/lib/fee/process.ts`, aggiungi l'import `import { isPaymentLive } from '@/lib/jobs/payment-live';` e apri la funzione con:

```ts
export async function processFeeAddebito(feeId: string): Promise<ProcessFeeStatus> {
  // Gate unico per i tre chiamanti (firma, cron, retry manuale). Prima viveva
  // solo nel job: `ritentaAddebitiAgenzia` poteva così portare a SUCCESS soldi
  // finti del provider mock — e ora un SUCCESS emette una fattura.
  if (!isPaymentLive()) return 'SKIPPED';

  const fee = await prisma.feeAddebito.findUnique({ where: { id: feeId } });
```

- [ ] **Step 5: Aggiungi il test del gate in `process.test.ts`**

Aggiungi al `vi.hoisted` un `isPaymentLiveMock: vi.fn()`, il mock
`vi.mock('@/lib/jobs/payment-live', () => ({ isPaymentLive: isPaymentLiveMock }))`,
e in `beforeEach` `isPaymentLiveMock.mockReturnValue(true)` (gli altri test restano verdi). Poi:

```ts
it('SKIPPED: provider non live, non tocca il provider di pagamento', async () => {
  isPaymentLiveMock.mockReturnValue(false);
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SKIPPED');
  expect(chargeFee).not.toHaveBeenCalled();
  expect(feeUpdateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Esegui i test e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/pratiche src/lib/fee`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche apps/piattaforma/src/lib/fee
git commit -m "feat(fatturazione): la fattura PV nasce all'incasso, valvola sul provider mock"
```

---

### Task 4: L'addebito parte dalla firma, il cron diventa rete di recupero

Il `FeeAddebito` nasce già con `scheduledAt = now` ("addebito istantaneo", commit `0d245ff`), ma il tentativo lo faceva solo il cron giornaliero: fino a 24 ore di attesa morta prima ancora che il settlement SEPA cominciasse. Ora parte dalla firma.

**Files:**
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts` (dopo il blocco valvola)
- Modify: `apps/piattaforma/vercel.json:12-15`
- Modify: `apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts:8` (commento sbagliato: dice "ogni 6h")
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.fattura-addebito.test.ts`

**Interfaces:**
- Consumes: `processFeeAddebito(feeId: string): Promise<ProcessFeeStatus>` da `@/lib/fee/process`.

- [ ] **Step 1: Scrivi il test che fallisce**

Aggiungi in fondo a `firma-engine.fattura-addebito.test.ts`:

```ts
describe('avvio addebito alla firma', () => {
  it('provider live: chiama processFeeAddebito col fee appena creato', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(processFeeMock).toHaveBeenCalledWith('fee-1');
  });

  it('un addebito che esplode non fa fallire la firma', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    processFeeMock.mockRejectedValue(new Error('stripe giù'));
    const out = await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(out.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/pratiche/firma-engine.fattura-addebito.test.ts`
Expected: FAIL — `processFeeMock` non è mai chiamato.

- [ ] **Step 3: Fai partire l'addebito dalla firma**

In `firma-engine.ts`, aggiungi l'import `import { processFeeAddebito } from '@/lib/fee/process';` e inserisci subito **dopo** il blocco valvola del Task 3:

```ts
  // L'addebito parte da qui, non dal cron: `scheduledAt` è già `now` dal commit
  // 0d245ff ("addebito istantaneo"), ma il tentativo lo faceva solo il job
  // giornaliero — fino a 24h di attesa prima ancora che il settlement SEPA
  // cominciasse.
  //
  // ATTESO, non fire-and-forget: su Vercel una promise lasciata pendente può
  // morire quando la response parte. Best-effort comunque — la firma è già
  // committata e se questa chiamata fallisce il fee resta SCHEDULED, che è
  // esattamente ciò che il cron orario raccoglie.
  if (feeAddebitoIdCreato) {
    await processFeeAddebito(feeAddebitoIdCreato).catch((err) => {
      console.error(
        `[firmaPratica] avvio addebito fallito per fee ${feeAddebitoIdCreato} (pratica ${praticaId}):`,
        err,
      );
      return undefined;
    });
  }
```

- [ ] **Step 4: Porta il cron a cadenza oraria**

In `apps/piattaforma/vercel.json`, cambia la voce `process-fee-scheduled`:

```json
    {
      "path": "/api/jobs/process-fee-scheduled",
      "schedule": "0 * * * *"
    },
```

In `apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts`, correggi il commento di riga 7-9 (oggi dichiara "ogni 6h", che era già falso):

```ts
/**
 * Rete di recupero degli addebiti: l'addebito normale parte dalla firma
 * (firma-engine.ts). Qui restano il reaper, i retry orfani e i fee la cui
 * chiamata dalla firma non è mai partita. Schedule cron Vercel: ogni ora.
 */
```

- [ ] **Step 5: Esegui i test e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/pratiche`
Expected: PASS (4 test nel file nuovo).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/pratiche apps/piattaforma/vercel.json apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts
git commit -m "feat(fee): addebito avviato alla firma, cron orario come rete di recupero"
```

---

### Task 5: Notifiche — N8 senza allegato, N53 all'incasso

N8 e N53 devono atterrare insieme: se N8 perde l'allegato senza che N53 esista, in modalità live l'agenzia non riceve la fattura da nessuna parte.

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (payload N8 ~riga 70, `tplN8AgenziaAddebito` ~riga 462, nuovo N53 in fondo)
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts` (import, union `SendInput`, `render`)
- Create: `apps/piattaforma/src/lib/fatturazione/notifica-fattura.ts`
- Modify: `apps/piattaforma/src/lib/fee/incasso.ts`
- Modify: `apps/piattaforma/src/lib/pratiche/firma-engine.ts:469-493` (blocco N8)
- Test: `apps/piattaforma/src/lib/fatturazione/notifica-fattura.test.ts` (nuovo)
- Modify: `apps/piattaforma/src/lib/fee/incasso.test.ts`

**Interfaces:**
- Produces: `notificaFatturaDisponibile(documentoId: string): Promise<void>` — invia N53 con PDF allegato e valorizza `inviatoEmailAt`; no-op se `inviatoEmailAt` è già valorizzato.
- Produces: `N53AgenziaFatturaDisponibilePayload = { nomeAgenzia: string; codicePratica: string; numeroDocumento: string; importoCent: number; fatturaUrl: string }`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/fatturazione/notifica-fattura.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { docFindUnique, docUpdate, sendMock, attachmentMock } = vi.hoisted(() => ({
  docFindUnique: vi.fn(),
  docUpdate: vi.fn(),
  sendMock: vi.fn(),
  attachmentMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { documentoFiscale: { findUnique: docFindUnique, update: docUpdate } },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));
vi.mock('./documento-pdf', () => ({ fatturaPvAttachment: attachmentMock }));

import { notificaFatturaDisponibile } from './notifica-fattura';

const DOC = {
  id: 'doc-1',
  praticaId: 'pr-1',
  numeroDocumentoStr: 'PV-2026-00003',
  importoLordoCent: 7500,
  inviatoEmailAt: null,
  pratica: { codicePratica: 'PV-0001' },
  destinatarioCompany: {
    id: 'ag-1',
    ragioneSociale: 'Agenzia Uno',
    email: 'azienda@agenzia.it',
    users: [{ id: 'u-1', email: 'admin@agenzia.it' }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  docFindUnique.mockResolvedValue(DOC);
  docUpdate.mockResolvedValue({});
  sendMock.mockResolvedValue(undefined);
  attachmentMock.mockResolvedValue({ filename: 'f.pdf', content: 'x', contentType: 'application/pdf' });
});

describe('notificaFatturaDisponibile', () => {
  it("manda la N53 all'admin azienda con il PDF allegato e segna inviatoEmailAt", async () => {
    await notificaFatturaDisponibile('doc-1');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE',
        target: expect.objectContaining({ email: 'admin@agenzia.it', companyId: 'ag-1' }),
        payload: expect.objectContaining({ numeroDocumento: 'PV-2026-00003', importoCent: 7500 }),
      }),
      expect.objectContaining({ attachments: [expect.objectContaining({ filename: 'f.pdf' })] }),
    );
    expect(docUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { inviatoEmailAt: expect.any(Date) },
    });
  });

  it('non rimanda una fattura già inviata', async () => {
    docFindUnique.mockResolvedValue({ ...DOC, inviatoEmailAt: new Date() });
    await notificaFatturaDisponibile('doc-1');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("ripiega sull'email azienda se non c'è un admin attivo", async () => {
    docFindUnique.mockResolvedValue({
      ...DOC,
      destinatarioCompany: { ...DOC.destinatarioCompany, users: [] },
    });
    await notificaFatturaDisponibile('doc-1');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ email: 'azienda@agenzia.it' }) }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/notifica-fattura.test.ts`
Expected: FAIL — "Failed to resolve import ./notifica-fattura".

- [ ] **Step 3: Aggiungi il template N53**

In `apps/piattaforma/src/lib/notifiche/templates.ts`, aggiungi il tipo payload accanto agli altri (dopo `N52BrokerZonaNonCopertaPayload`):

```ts
export type N53AgenziaFatturaDisponibilePayload = {
  nomeAgenzia: string;
  codicePratica: string;
  numeroDocumento: string;
  importoCent: number;
  fatturaUrl: string;
};
```

e in fondo al file il template:

```ts
/**
 * La fattura esiste solo ora perché l'addebito è stato incassato ora: fino al
 * settlement SEPA non c'era nulla da fatturare (v. lib/fee/incasso.ts).
 */
export function tplN53AgenziaFatturaDisponibile(
  p: N53AgenziaFatturaDisponibilePayload,
): NotificaContent {
  const subject = `Fattura ${p.numeroDocumento} — pratica ${p.codicePratica}`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `l'addebito di ${formatCurrencyCent(p.importoCent)} per la pratica ${p.codicePratica} ` +
    `è stato incassato e la fattura ${p.numeroDocumento} è stata emessa.\n` +
    `La trovi in allegato e nella sezione Fatturazione: ${p.fatturaUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Fattura disponibile</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      l&apos;addebito per la pratica <strong>${escapeHtml(p.codicePratica)}</strong> è stato incassato
      e la fattura è stata emessa.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Numero: <strong>${escapeHtml(p.numeroDocumento)}</strong><br>
      Importo: <strong>${formatCurrencyCent(p.importoCent)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:13px;color:#334155">
      La trovi in allegato e nella sezione <a href="${p.fatturaUrl}">Fatturazione</a>.
    </p>
  `);
  return { subject, html, text };
}
```

In `apps/piattaforma/src/lib/notifiche/send.ts`: aggiungi `tplN53AgenziaFatturaDisponibile` e `type N53AgenziaFatturaDisponibilePayload` agli import da `./templates`, il ramo alla union `SendInput`:

```ts
  | { tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE'; target: Target; payload: N53AgenziaFatturaDisponibilePayload }
```

e il `case` in `render`:

```ts
    case 'N53_AGENZIA_FATTURA_DISPONIBILE':
      return tplN53AgenziaFatturaDisponibile(input.payload);
```

N53 è transazionale: **non** va aggiunta alla lista delle notifiche opzionali in `preferences.ts`.

- [ ] **Step 4: Scrivi `notifica-fattura.ts`**

Crea `apps/piattaforma/src/lib/fatturazione/notifica-fattura.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';
import { fatturaPvAttachment } from './documento-pdf';

/**
 * N53 "fattura disponibile" per una FATTURA_PV appena emessa.
 *
 * Recapito: admin azienda della MADRE, non il risolutore per sede. Le email che
 * portano un documento fiscale seguono la stessa regola della N8 — l'entità
 * legale, non chi ha lavorato la pratica.
 *
 * `inviatoEmailAt` è il guardiano dell'unicità: il percorso d'incasso e la
 * riconciliazione oraria chiamano questa funzione senza conoscersi.
 */
export async function notificaFatturaDisponibile(documentoId: string): Promise<void> {
  const doc = await prisma.documentoFiscale.findUnique({
    where: { id: documentoId },
    select: {
      id: true,
      praticaId: true,
      numeroDocumentoStr: true,
      importoLordoCent: true,
      inviatoEmailAt: true,
      pratica: { select: { codicePratica: true } },
      destinatarioCompany: {
        select: {
          id: true,
          ragioneSociale: true,
          email: true,
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
            select: { id: true, email: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!doc || doc.inviatoEmailAt || !doc.destinatarioCompany || !doc.praticaId) return;

  const admin = doc.destinatarioCompany.users[0];
  // Ripiego sull'email azienda come fanno N3/N6/N8/N9: una fattura non deve
  // sparire in silenzio perché manca un admin attivo.
  const email = admin?.email ?? doc.destinatarioCompany.email;
  if (!email) return;

  const allegato = await fatturaPvAttachment(doc.praticaId).catch(() => null);

  await sendNotification(
    {
      tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE',
      target: { email, userId: admin?.id ?? null, companyId: doc.destinatarioCompany.id },
      payload: {
        nomeAgenzia: doc.destinatarioCompany.ragioneSociale,
        codicePratica: doc.pratica?.codicePratica ?? '—',
        numeroDocumento: doc.numeroDocumentoStr ?? '—',
        importoCent: doc.importoLordoCent,
        // Link funzionale: NEXT_PUBLIC_APP_URL, mai BRAND.url (dominio marketing).
        fatturaUrl: `${env.NEXT_PUBLIC_APP_URL}/fatturazione`,
      },
    },
    { praticaId: doc.praticaId, ...(allegato ? { attachments: [allegato] } : {}) },
  );

  await prisma.documentoFiscale.update({
    where: { id: doc.id },
    data: { inviatoEmailAt: new Date() },
  });
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/notifica-fattura.test.ts`
Expected: PASS (3 test).

- [ ] **Step 6: Aggancia la N53 all'incasso**

In `apps/piattaforma/src/lib/fee/incasso.ts`, sostituisci la riga della fattura con:

```ts
  // I soldi sono arrivati: qualunque cosa vada storta nell'emissione, il fee
  // resta SUCCESS. La riconciliazione oraria recupera il documento mancante.
  const documento = await createFatturaPv({
    feeAddebitoId: feeId,
    statoPagamento: 'PAGATA',
  }).catch((err) => {
    console.error(`[segnaFeeIncassato] createFatturaPv fallita per fee ${feeId}:`, err);
    return null;
  });

  // Solo chi ha davvero creato il documento notifica: `null` significa che
  // esisteva già, e la sua N53 è partita a suo tempo.
  if (documento) {
    await notificaFatturaDisponibile(documento.id).catch((err) => {
      console.error(`[segnaFeeIncassato] N53 fallita per documento ${documento.id}:`, err);
    });
  }
```

con l'import `import { notificaFatturaDisponibile } from '@/lib/fatturazione/notifica-fattura';`.

In `incasso.test.ts` aggiungi il mock `vi.mock('@/lib/fatturazione/notifica-fattura', () => ({ notificaFatturaDisponibile: notificaMock }))` (con `notificaMock: vi.fn()` nel `vi.hoisted` e `notificaMock.mockResolvedValue(undefined)` nel `beforeEach`) e due test:

```ts
  it('notifica la fattura appena creata', async () => {
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
  });

  it('fattura già esistente: nessuna seconda N53', async () => {
    createFatturaPvMock.mockResolvedValue(null);
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(notificaMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 7: Togli l'allegato dalla N8 in modalità live**

In `templates.ts`, aggiungi al payload N8 il flag:

```ts
export type N8AgenziaAddebitoPayload = {
  codicePratica: string;
  feeCent: number;
  autoAddebitoAt: Date;
  nomeAgenzia: string;
  /** Firma attestata dal Gestore (Termini art. 11), non segnalata dall'agenzia. */
  attestataDaPv?: boolean;
  /** Data dell'attestazione (Termini art. 11) — v. N4BrokerFirmaPayload. */
  attestataDaPvAt?: Date | null;
  /**
   * La fattura viaggia allegata a questa email (provider mock, emissione alla
   * firma) oppure arriverà con la N53 quando l'addebito sarà incassato.
   */
  fatturaAllegata: boolean;
};
```

In `tplN8AgenziaAddebito` cambiano due frasi. Nel `text`, la riga
`` `In caso di "firma avvenuta" anticipata l'addebito avviene al momento.` `` diventa:

```ts
    (p.fatturaAllegata
      ? `Trovi la fattura in allegato.`
      : `La fattura sarà emessa e inviata quando l'addebito risulterà incassato.`) +
```

e nell'`html` il paragrafo `L'integrazione pagamenti SEPA sarà attiva in una fase successiva.` — falso da quando Stripe è configurato — diventa:

```ts
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">${
      p.fatturaAllegata
        ? 'Trovi la fattura in allegato.'
        : "La fattura sarà emessa e inviata quando l'addebito risulterà incassato."
    }</p>
```

In `firma-engine.ts`, blocco N8 (righe 469-493), sostituisci con:

```ts
      if (full.agenziaAssegnata && agenziaEmail && full.autoAddebitoAt) {
        // Con provider live la fattura non esiste ancora: nasce all'incasso e
        // viaggia con la N53. Solo la valvola (provider mock) la allega qui.
        const fatturaPdf = isPaymentLive()
          ? null
          : await fatturaPvAttachment(praticaId).catch(() => null);
        await sendNotification(
          {
            tipo: 'N8_AGENZIA_ADDEBITO',
            target: {
              email: agenziaEmail,
              userId: agenziaUser?.id ?? null,
              companyId: full.agenziaAssegnata.id,
            },
            payload: {
              codicePratica: full.codicePratica ?? '—',
              feeCent: full.feeAgenziaCent,
              autoAddebitoAt: full.autoAddebitoAt,
              nomeAgenzia: full.agenziaAssegnata.ragioneSociale,
              // Vedi la N4 sopra: `Boolean`, non `!== null`.
              attestataDaPv: Boolean(full.firmaForzataAt),
              attestataDaPvAt: full.firmaForzataAt ?? null,
              fatturaAllegata: fatturaPdf != null,
            },
          },
          { praticaId, ...(fatturaPdf ? { attachments: [fatturaPdf] } : {}) },
        ).catch(() => undefined);
        // Sul percorso valvola la N8 È la consegna della fattura: senza questo
        // timestamp, il giorno in cui il provider passa da mock a stripe gli
        // addebiti arretrati arriverebbero a SUCCESS e la riconciliazione
        // manderebbe una N53 per fatture già ricevute in allegato.
        if (fatturaPdf) {
          await prisma.documentoFiscale
            .updateMany({
              where: { praticaId, tipo: 'FATTURA_PV', inviatoEmailAt: null },
              data: { inviatoEmailAt: new Date() },
            })
            .catch((err) => {
              console.error(`[firmaPratica] inviatoEmailAt non scritto per pratica ${praticaId}:`, err);
              return undefined;
            });
        }
      }
```

- [ ] **Step 8: Esegui i test e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/notifiche src/lib/fatturazione src/lib/fee src/lib/pratiche`
Expected: PASS. `templates.test.ts` potrebbe costruire un payload N8: aggiungi `fatturaAllegata: true` dove il compilatore lo richiede.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche apps/piattaforma/src/lib/fatturazione apps/piattaforma/src/lib/fee apps/piattaforma/src/lib/pratiche
git commit -m "feat(notifiche): N53 fattura disponibile all'incasso, N8 senza allegato in live"
```

---

### Task 6: Riconciliazione nel cron orario

Rete per i due modi in cui l'incasso può restare senza la sua email: `createFatturaPv` fallita dopo un `SUCCESS`, o N53 non partita.

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/riconcilia-fatture.ts`
- Test: `apps/piattaforma/src/lib/jobs/riconcilia-fatture.test.ts` (nuovo)
- Modify: `apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts:13-14`

**Interfaces:**
- Consumes: `createFatturaPv` (Task 1), `notificaFatturaDisponibile` (Task 5).
- Produces: `riconciliaFattureIncassate(): Promise<{ emesse: number; notificate: number }>`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `apps/piattaforma/src/lib/jobs/riconcilia-fatture.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindMany, docFindFirst, createFatturaPvMock, notificaMock } = vi.hoisted(() => ({
  feeFindMany: vi.fn(),
  docFindFirst: vi.fn(),
  createFatturaPvMock: vi.fn(),
  notificaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { feeAddebito: { findMany: feeFindMany }, documentoFiscale: { findFirst: docFindFirst } },
}));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));
vi.mock('@/lib/fatturazione/notifica-fattura', () => ({ notificaFatturaDisponibile: notificaMock }));

import { riconciliaFattureIncassate } from './riconcilia-fatture';

beforeEach(() => {
  vi.clearAllMocks();
  feeFindMany.mockResolvedValue([{ id: 'fee-1', praticaId: 'pr-1' }]);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  notificaMock.mockResolvedValue(undefined);
});

describe('riconciliaFattureIncassate', () => {
  it('fee SUCCESS senza fattura: la emette PAGATA e la notifica', async () => {
    docFindFirst.mockResolvedValue(null);
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'PAGATA',
    });
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
    expect(out).toEqual({ emesse: 1, notificate: 1 });
  });

  it('fattura già presente e già inviata: no-op', async () => {
    docFindFirst.mockResolvedValue({ id: 'doc-1', inviatoEmailAt: new Date() });
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(notificaMock).not.toHaveBeenCalled();
    expect(out).toEqual({ emesse: 0, notificate: 0 });
  });

  it('fattura presente ma email mai partita: rimanda solo la N53', async () => {
    docFindFirst.mockResolvedValue({ id: 'doc-1', inviatoEmailAt: null });
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
    expect(out).toEqual({ emesse: 0, notificate: 1 });
  });

  it('guarda solo i fee SUCCESS di una finestra recente', async () => {
    docFindFirst.mockResolvedValue(null);
    await riconciliaFattureIncassate();
    expect(feeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stato: 'SUCCESS', executedAt: { gte: expect.any(Date) } },
      }),
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/jobs/riconcilia-fatture.test.ts`
Expected: FAIL — "Failed to resolve import ./riconcilia-fatture".

- [ ] **Step 3: Scrivi `riconcilia-fatture.ts`**

```ts
import 'server-only';
import { prisma } from '@pv/db';
import { createFatturaPv } from '@/lib/fatturazione/engine';
import { notificaFatturaDisponibile } from '@/lib/fatturazione/notifica-fattura';

const FINESTRA_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 30;

/**
 * Rete per gli incassi rimasti senza il loro documento o senza la loro email:
 * `createFatturaPv` fallita dopo un SUCCESS, oppure N53 non partita. Non si
 * annulla un incasso perché un PDF è andato storto — si recupera qui.
 *
 * Parte dai FEE e non dai documenti: così in modalità mock è automaticamente
 * inerte, perché lì nessun fee arriva mai a SUCCESS e la fattura è già stata
 * emessa alla firma dalla valvola.
 *
 * Interroga i documenti per `praticaId` (che ha un indice) e non per
 * `feeAddebitoId` (che non ce l'ha): niente migration.
 */
export async function riconciliaFattureIncassate(): Promise<{
  emesse: number;
  notificate: number;
}> {
  const da = new Date(Date.now() - FINESTRA_MS);
  const fees = await prisma.feeAddebito.findMany({
    where: { stato: 'SUCCESS', executedAt: { gte: da } },
    take: BATCH_SIZE,
    orderBy: { executedAt: 'asc' },
    select: { id: true, praticaId: true },
  });

  let emesse = 0;
  let notificate = 0;

  for (const fee of fees) {
    const doc = await prisma.documentoFiscale.findFirst({
      where: { praticaId: fee.praticaId, tipo: 'FATTURA_PV' },
      select: { id: true, inviatoEmailAt: true },
    });

    if (!doc) {
      const creato = await createFatturaPv({
        feeAddebitoId: fee.id,
        statoPagamento: 'PAGATA',
      }).catch((err) => {
        console.error(`[riconciliaFatture] emissione fallita per fee ${fee.id}:`, err);
        return null;
      });
      if (creato) {
        emesse++;
        await notificaFatturaDisponibile(creato.id).catch((err) => {
          console.error(`[riconciliaFatture] N53 fallita per documento ${creato.id}:`, err);
        });
        notificate++;
      }
      continue;
    }

    if (!doc.inviatoEmailAt) {
      await notificaFatturaDisponibile(doc.id).catch((err) => {
        console.error(`[riconciliaFatture] N53 fallita per documento ${doc.id}:`, err);
      });
      notificate++;
    }
  }

  return { emesse, notificate };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/jobs/riconcilia-fatture.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Chiamala dal cron**

In `apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts`:

```ts
import { riconciliaFattureIncassate } from '@/lib/jobs/riconcilia-fatture';
```

e nel corpo di `run`:

```ts
  const result = await processFeeScheduled();
  // Stessa passata: gli incassi appena chiusi qui sopra sono già coperti dal
  // percorso normale, questa raccoglie quelli rimasti indietro.
  const riconciliazione = await riconciliaFattureIncassate();
  return NextResponse.json({ ok: true, ...result, ...riconciliazione });
```

- [ ] **Step 6: Esegui la suite completa e il typecheck**

Run: `pnpm --filter piattaforma test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Verifica nel browser**

I test non vedono quello che vede solo il browser. Con `PAYMENT_PROVIDER=stripe` e chiavi di test in `.env.local`, avvia `pnpm dev` e:

1. Firma una pratica come agenzia → in `/fatturazione` **non** deve comparire una FATTURA_PV.
2. Controlla nella mailbox di test che la N8 sia arrivata **senza** allegato e con la frase sulla fattura che seguirà.
3. Forza l'incasso: `POST /api/jobs/process-fee-scheduled` con il bearer del cron, oppure simula `payment_intent.succeeded` con la Stripe CLI passando `metadata.feeAddebitoId`.
4. Ricarica `/fatturazione`: la fattura deve esserci, con stato pagamento **Pagata**, e la N53 deve essere arrivata con il PDF. Apri il PDF davvero.
5. Ripeti il passo 3: nessuna seconda fattura, nessuna seconda N53.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/jobs apps/piattaforma/src/app/api/jobs/process-fee-scheduled/route.ts
git commit -m "feat(jobs): riconciliazione oraria delle fatture da incasso"
```

---

## Dopo il piano — fuori dal codice

Da fare separatamente, non sono task di implementazione:

1. **Applicare la migration su Neon PRIMA del deploy del codice**: `20260726150000_notifica_n53_fattura_disponibile` (`ALTER TYPE "NotificaTipo" ADD VALUE 'N53_AGENZIA_FATTURA_DISPONIBILE'`). Se il codice arriva per primo, il primo tentativo di scrivere una N53 fallisce con enum sconosciuto — e fallirebbe proprio nel momento in cui l'agenzia dovrebbe ricevere la fattura.
2. **Verificare `PAYMENT_PROVIDER` in produzione** su Vercel. Con la valvola il deploy è sicuro in entrambi i casi, ma determina se dopo il rilascio le fatture nascono alla firma o all'incasso.
3. **Riallineare i Termini**: la clausola 11 elenca fra gli effetti dell'attestazione "addebito della fee ed emissione della relativa fattura", la clausola 9 rimanda alle "tempistiche indicate in Piattaforma". Restano vere ma la tempistica reale cambia — da rivedere con il legale. La KB del chatbot si riallinea da sola al prebuild una volta aggiornati i docs.
4. **Aggiornare `docs/sistema-fatturazione.md` §1.2-1.3**, dove le tabelle mettono la generazione fattura (step 2) prima dell'addebito (step 4).
