# Revisione Termini + allineamento penali/sospensione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riscrivere le clausole 5, 10 e 11 dei Termini e allineare il codice affinché ogni affermazione del contratto sia vera.

**Architecture:** Il testo contrattuale è la fonte; il codice si adegua. Tre discrepanze accertate vanno sanate prima che il testo vada online: la penale è dichiarata «per veicolo» ma addebitata flat; la segnalazione non registra quali veicoli siano affetti; l'auto-sospensione anti-abuso è revocabile dall'utente stesso. Si aggiunge inoltre la liquidazione del wallet residuo sotto soglia alla cessazione, oggi impossibile perché `MIN_PAYOUT_CENT` gatea anche l'admin.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma + Postgres, Vitest, Tailwind (design system PV).

**Spec:** `docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md`

## Global Constraints

- **Migration a mano.** `pnpm db:migrate` (`prisma migrate dev`) è **distruttivo** su questo repo: propone `DROP SEQUENCE`. Si scrive `migration.sql` a mano e si applica con `pnpm --filter @pv/db db:deploy`, poi `pnpm db:generate`.
- **Test:** `pnpm --filter piattaforma test <path>` (vitest run). Prisma è **mockato** nei test unit (`vi.mock('@pv/db')`).
- **Node:** `nvm use 22.15.0` prima di qualunque comando pnpm.
- **Nessun colore hardcoded**: usare i token del design system (`pv-*`).
- **Penale**: `PENALI.PENALE_BROKER_DEFAULT_CENT` (2_500 = €25). **Mai** hardcodare 2500 o «25» nel copy: derivarlo dalla costante.
- **Importi**: sempre in **cent** (`Int`), mai float.
- **La lista clausole vessatorie (cl. 17) resta `3,5,7,8,10,11,12,16`** → **non** toccare `lib/auth/schemas.ts`, la registrazione, né alcuna migration sull'accettazione.
- **Fallback penale**: se l'insieme dei veicoli segnalati è vuoto (dati legacy) la penale si calcola su **1 veicolo** — mai 0, mai tutti.

---

### Task 1: Schema — `Veicolo.segnalato` (+ migration)

Serve a sapere **quali** veicoli sono affetti: oggi il dato non esiste (spec §D3).

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Veicolo`, ~1023-1047)
- Create: `packages/db/prisma/migrations/20260711120000_veicolo_segnalato/migration.sql`

**Interfaces:**
- Produces: `Veicolo.segnalato: boolean` (default `false`) — consumato dai Task 2, 4, 5, 6.

- [ ] **Step 1: Aggiungere il campo al modello `Veicolo`**

In `packages/db/prisma/schema.prisma`, dentro `model Veicolo`, subito dopo `flagDelegaVendita`:

```prisma
  /// Sistema Penali Broker: true se questo veicolo è oggetto della segnalazione
  /// attiva sulla pratica. La penale è €25 × (veicoli segnalati) — mai sui
  /// veicoli sani (penale sproporzionata, cfr. art. 1384 c.c.).
  /// Resettato a false quando la segnalazione viene RESPINTA.
  segnalato            Boolean              @default(false)
```

- [ ] **Step 2: Scrivere la migration a mano**

Creare `packages/db/prisma/migrations/20260711120000_veicolo_segnalato/migration.sql`:

```sql
-- Sistema Penali Broker: quali veicoli sono oggetto della segnalazione.
ALTER TABLE "veicoli" ADD COLUMN "segnalato" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Applicare e rigenerare**

```bash
nvm use 22.15.0
pnpm --filter @pv/db db:deploy
pnpm db:generate
```

Expected: `db:deploy` stampa `Applying migration 20260711120000_veicolo_segnalato` e termina senza errori. Nessun prompt, nessun `DROP`.

- [ ] **Step 4: Verificare la colonna sul DB locale**

```bash
docker compose exec -T db psql -U postgres -d passaggio_veloce -c "\d veicoli" | grep segnalato
```

Expected: una riga contenente `segnalato | boolean | not null | false`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260711120000_veicolo_segnalato
git commit -m "feat(penali): campo Veicolo.segnalato per la penale per-veicolo"
```

---

### Task 2: `segnalaPraticaAction` accetta e persiste i veicoli segnalati

**Files:**
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts` (`segnalaPraticaAction`, ~35-139)
- Create: `apps/piattaforma/src/lib/penali/segnalazione.veicoli.test.ts`

**Interfaces:**
- Consumes: `Veicolo.segnalato` (Task 1).
- Produces: `segnalaPraticaAction(praticaId: string, tipo: SegnalazioneTipo, nota: string, veicoliIds: string[]): Promise<SegnalaPraticaResult>` — la firma guadagna un **4° parametro**. Consumato dal Task 3 (UI).

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `apps/piattaforma/src/lib/penali/segnalazione.veicoli.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `segnalaPraticaAction` deve persistere QUALI veicoli sono segnalati: è la base
 * di calcolo della penale (€25 × veicoli segnalati). Senza questi test, un
 * `veicoliIds` ignorato passerebbe inosservato — l'azione tornerebbe comunque
 * { ok: true } e la penale ricadrebbe muta sul fallback a 1 veicolo.
 */

const { prismaMock, authMock, redirectMock, requirePermessoMock, getSessionContextMock } =
  vi.hoisted(() => ({
    prismaMock: {
      pratica: { findUnique: vi.fn(), update: vi.fn() },
      veicolo: { updateMany: vi.fn() },
      $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
    },
    authMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    requirePermessoMock: vi.fn(),
    getSessionContextMock: vi.fn(),
  }));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/permessi/guard', () => ({ requirePermesso: requirePermessoMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/lib/sedi/scope-filters', () => ({
  toSedeScope: vi.fn(() => ({ kind: 'ALL' })),
  NO_SEDE_SCOPE: { kind: 'NONE' },
}));
vi.mock('@/lib/pratiche/access', () => ({ canAccessPratica: vi.fn(() => true) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariAgenzia: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventiPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaPenale: vi.fn(() => ({})) }));

import { segnalaPraticaAction } from './segnalazione';

const PID = '33333333-3333-4333-8333-333333333333';
const AGENZIA_ID = 'ag-1';
const V1 = 'veicolo-1';
const V2 = 'veicolo-2';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u-1', companyId: AGENZIA_ID, companyType: 'AGENZIA', role: 'ADMIN_AZIENDA' },
  });
  requirePermessoMock.mockResolvedValue({ ok: true });
  getSessionContextMock.mockResolvedValue({});
  prismaMock.pratica.findUnique.mockResolvedValue({
    id: PID,
    stato: 'ACCETTATA',
    agenziaAssegnataId: AGENZIA_ID,
    brokerId: 'br-1',
    brokerSedeId: 'sede-br',
    agenziaSedeId: 'sede-ag',
    flagSegnalata: false,
    codicePratica: 'PV-42',
    veicoli: [
      { id: V1, targa: 'AA000AA' },
      { id: V2, targa: 'BB111BB' },
    ],
    broker: { ragioneSociale: 'Broker SRL' },
    agenziaAssegnata: { ragioneSociale: 'Agenzia SRL' },
  });
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.veicolo.updateMany.mockResolvedValue({ count: 1 });
});

describe('segnalaPraticaAction — veicoli segnalati', () => {
  it('marca segnalato=true SOLO sui veicoli indicati', async () => {
    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', '', [V2]);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.veicolo.updateMany).toHaveBeenCalledWith({
      where: { praticaId: PID, id: { in: [V2] } },
      data: { segnalato: true },
    });
  });

  it('rifiuta se non è indicato alcun veicolo', async () => {
    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', '', []);

    expect(res).toEqual({ ok: false, error: 'Seleziona almeno un veicolo' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.veicolo.updateMany).not.toHaveBeenCalled();
  });

  it('rifiuta veicoli che non appartengono alla pratica (forgiatura POST)', async () => {
    const res = await segnalaPraticaAction(PID, 'IPOTECA', '', ['veicolo-di-un-altro']);

    expect(res).toEqual({ ok: false, error: 'Veicolo non appartenente alla pratica' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.veicolo.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che FALLISCANO**

```bash
pnpm --filter piattaforma test src/lib/penali/segnalazione.veicoli.test.ts
```

Expected: FAIL. `segnalaPraticaAction` ignora il 4° argomento → `veicolo.updateMany` mai chiamato, e i due test di rifiuto tornano `{ ok: true }`.

- [ ] **Step 3: Implementare**

In `apps/piattaforma/src/lib/penali/segnalazione.ts`:

Cambiare la firma (riga ~35):

```ts
export async function segnalaPraticaAction(
  praticaId: string,
  tipo: SegnalazioneTipo,
  nota: string,
  veicoliIds: string[],
): Promise<SegnalaPraticaResult> {
```

Nella `select` della `findUnique` (riga ~67), aggiungere l'`id` dei veicoli:

```ts
      veicoli: { orderBy: { ordine: 'asc' }, select: { id: true, targa: true } },
```

Subito **dopo** il guard `if (pratica.flagSegnalata)` (riga ~92), aggiungere la validazione:

```ts
  // Base di calcolo della penale (€25 × veicoli segnalati): va validata qui,
  // non lato client. Un POST forgiato con veicoli altrui gonfierebbe la penale
  // di un broker a piacere.
  if (veicoliIds.length === 0) {
    return { ok: false, error: 'Seleziona almeno un veicolo' };
  }
  const idsPratica = new Set(pratica.veicoli.map((v) => v.id));
  if (!veicoliIds.every((id) => idsPratica.has(id))) {
    return { ok: false, error: 'Veicolo non appartenente alla pratica' };
  }
```

Sostituire la `prisma.pratica.update(...)` (riga ~96) con una transazione che marca anche i veicoli:

```ts
  await prisma.$transaction([
    prisma.pratica.update({
      where: { id: praticaId },
      data: {
        flagSegnalata: true,
        tipoSegnalazione: tipo,
        notaSegnalazione: cleanNota,
        segnalataAt: new Date(),
        segnalataDaUserId: userId,
        segnalazioneStato: 'RICEVUTA',
      },
    }),
    prisma.veicolo.updateMany({
      where: { praticaId, id: { in: veicoliIds } },
      data: { segnalato: true },
    }),
  ]);
```

- [ ] **Step 4: Eseguire i test e verificare che PASSINO**

```bash
pnpm --filter piattaforma test src/lib/penali/segnalazione.veicoli.test.ts
```

Expected: PASS, 3 test.

- [ ] **Step 5: Verificare che i test esistenti non siano rotti**

```bash
pnpm --filter piattaforma test src/lib/penali/
```

Expected: PASS. `segnalazione.authz.test.ts` chiama `segnalaPraticaAction` con 3 argomenti: se fallisce sul nuovo guard «Seleziona almeno un veicolo», aggiornare **quelle** chiamate passando un array di veicoli valido coerente con la sua fixture.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/penali/
git commit -m "feat(penali): la segnalazione registra quali veicoli sono affetti"
```

---

### Task 3: UI — selezione dei veicoli nel form di segnalazione

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/[id]/segnala-button.tsx`
- Modify: `apps/piattaforma/src/app/pratiche/[id]/page.tsx:344`

**Interfaces:**
- Consumes: `segnalaPraticaAction(praticaId, tipo, nota, veicoliIds)` (Task 2).
- Produces: `<SegnalaProblemaButton praticaId veicoli={[{id, targa}]} />`.

- [ ] **Step 1: Estendere il componente**

In `segnala-button.tsx`, cambiare la firma e aggiungere lo stato. Sostituire la dichiarazione del componente (riga ~24) con:

```tsx
export type VeicoloSegnalabile = { id: string; targa: string | null };

export function SegnalaProblemaButton({
  praticaId,
  veicoli,
}: {
  praticaId: string;
  veicoli: VeicoloSegnalabile[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<SegnalazioneTipo>('FERMO_AMMINISTRATIVO');
  const [nota, setNota] = useState('');
  // Monoveicolo: preselezionato e non modificabile — non c'è nulla da scegliere.
  const [selected, setSelected] = useState<string[]>(
    veicoli.length === 1 ? [veicoli[0].id] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
```

- [ ] **Step 2: Passare i veicoli alla server action**

Sostituire `handleConfirm` (riga ~51):

```tsx
  const handleConfirm = (): void => {
    setError(null);
    if (selected.length === 0) {
      setError('Seleziona almeno un veicolo');
      return;
    }
    startTransition(async () => {
      const res = await segnalaPraticaAction(praticaId, tipo, nota, selected);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setNota('');
      toast('Segnalazione inviata', 'success');
      router.refresh();
    });
  };

  const toggle = (id: string): void => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
```

- [ ] **Step 3: Aggiungere il selettore alla modale**

Nel blocco `<div className="mt-4 space-y-3">` (riga ~81), **prima** della label «Tipo problema», inserire — solo se ci sono più veicoli:

```tsx
          {veicoli.length > 1 && (
            <fieldset className="block">
              <legend className="text-[12px] font-semibold text-pv-slate-700">
                Veicoli interessati
              </legend>
              <p className="mt-0.5 text-[11px] text-pv-slate-500">
                La penale a carico del broker è calcolata sui soli veicoli che
                selezioni.
              </p>
              <div className="mt-1.5 space-y-1.5">
                {veicoli.map((v) => (
                  <label
                    key={v.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-3 py-2 transition-colors hover:bg-pv-slate-100"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(v.id)}
                      onChange={() => toggle(v.id)}
                      className="h-4 w-4 shrink-0 accent-pv-navy-700"
                    />
                    <span className="text-[13px] font-semibold text-pv-navy-800">
                      {v.targa ?? 'Targa non indicata'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
```

- [ ] **Step 4: Aggiornare il call-site**

In `apps/piattaforma/src/app/pratiche/[id]/page.tsx:344`:

```tsx
            {canSegnalare && (
              <SegnalaProblemaButton
                praticaId={pratica.id}
                veicoli={pratica.veicoli.map((v) => ({ id: v.id, targa: v.targa }))}
              />
            )}
```

Verificare che la query della pagina selezioni `id` e `targa` dei veicoli; se `pratica.veicoli` non li include, aggiungerli alla `select`/`include`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter piattaforma typecheck
```

Expected: nessun errore. (NB: se il tsbuildinfo è freddo `tsc` può dare falsi errori Prisma — rilanciare.)

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/
git commit -m "feat(penali): selezione dei veicoli interessati nel form di segnalazione"
```

---

### Task 4: Penale = €25 × veicoli segnalati

Il cuore della spec (§D1). Oggi `segnalazione.ts:217` addebita flat.

**Files:**
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts` (`confermaAnnullamentoConPenaleAction`, ~180-320)
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.conferma.test.ts`

**Interfaces:**
- Consumes: `Veicolo.segnalato` (Task 1), popolato dal Task 2.
- Produces: `Pratica.penaleAddebitatoCent` = importo **totale** addebitato.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `segnalazione.conferma.test.ts`:

```ts
describe('confermaAnnullamentoConPenaleAction — penale per veicolo segnalato', () => {
  it('3 veicoli, 2 segnalati → penale = 2 × €25 (i veicoli sani non si pagano)', async () => {
    txMock.pratica.findUnique.mockResolvedValue(
      praticaFixture({
        veicoli: [
          { targa: 'AA000AA', segnalato: true },
          { targa: 'BB111BB', segnalato: true },
          { targa: 'CC222CC', segnalato: false },
        ],
      }),
    );
    txMock.wallet.upsert.mockResolvedValue({ id: 'w-1', saldoCent: 0 });

    const res = await confermaAnnullamentoConPenaleAction(PID);
    expect(res).toEqual({ ok: true });

    const atteso = 2 * PENALI.PENALE_BROKER_DEFAULT_CENT;
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'PENALE_BROKER',
          importoCent: -atteso,
          saldoPostCent: -atteso,
        }),
      }),
    );
    expect(txMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ penaleAddebitatoCent: atteso }),
      }),
    );
  });

  it('nessun veicolo segnalato (dati legacy) → fallback su 1 veicolo, mai 0', async () => {
    txMock.pratica.findUnique.mockResolvedValue(
      praticaFixture({
        veicoli: [
          { targa: 'AA000AA', segnalato: false },
          { targa: 'BB111BB', segnalato: false },
        ],
      }),
    );
    txMock.wallet.upsert.mockResolvedValue({ id: 'w-1', saldoCent: 0 });

    const res = await confermaAnnullamentoConPenaleAction(PID);
    expect(res).toEqual({ ok: true });

    // Mai 0 (non addebiteremmo nulla), mai 2 (addebiteremmo veicoli sani).
    expect(txMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          penaleAddebitatoCent: PENALI.PENALE_BROKER_DEFAULT_CENT,
        }),
      }),
    );
  });
});
```

Aggiornare `praticaFixture` (riga ~77) perché i veicoli abbiano il nuovo campo:

```ts
    veicoli: [{ targa: 'AA000AA', segnalato: true }],
```

- [ ] **Step 2: Eseguire i test e verificare che FALLISCANO**

```bash
pnpm --filter piattaforma test src/lib/penali/segnalazione.conferma.test.ts
```

Expected: FAIL. Il primo test attende `-5000` ma riceve `-2500` (flat).

- [ ] **Step 3: Implementare**

In `segnalazione.ts`, nella `include` della `findUnique` dentro la transazione (riga ~202), selezionare anche `segnalato`:

```ts
          veicoli: {
            orderBy: { ordine: 'asc' },
            select: { targa: true, segnalato: true },
          },
```

Sostituire la riga ~217 (`const importoPenaleCent = PENALI.PENALE_BROKER_DEFAULT_CENT;`) con:

```ts
      // Penale = €25 × veicoli SEGNALATI. Mai sui veicoli sani: sarebbe una
      // penale sproporzionata rispetto all'inadempimento (riducibile ex art.
      // 1384 c.c.) e contraddirebbe il presupposto dichiarato nel popup.
      // Fallback su 1 per le segnalazioni legacy (create prima che il campo
      // `segnalato` esistesse): mai 0 — non addebiteremmo nulla.
      const veicoliSegnalati = pratica.veicoli.filter((v) => v.segnalato).length;
      const nPenali = veicoliSegnalati > 0 ? veicoliSegnalati : 1;
      const importoPenaleCent = PENALI.PENALE_BROKER_DEFAULT_CENT * nPenali;
```

Il resto dell'azione usa già `importoPenaleCent` per la transazione wallet e per `penaleAddebitatoCent`: nessun'altra modifica.

- [ ] **Step 4: Aggiornare la notifica N17 con l'importo reale**

Nel blocco post-commit (riga ~339), `importoPenaleCent: PENALI.PENALE_BROKER_DEFAULT_CENT` è ora **sbagliato** (manda sempre €25). Il valore va portato fuori dalla transazione: aggiungere `importoPenaleCent` e `veicoliSegnalatiTarghe` al `return` della transazione (riga ~298) e al tipo di `payload` (riga ~163):

```ts
  let payload: {
    codicePratica: string;
    targa: string | null;
    tipoSegnalazione: SegnalazioneTipo;
    importoPenaleCent: number;
    veicoliSegnalatiTarghe: string[];
    saldoBroker: number;
    brokerEmail: string | null;
    brokerUserId: string | null;
    brokerCompanyId: string;
    brokerSedeId: string | null;
    brokerNome: string;
    agenziaCompanyId: string | null;
    agenziaSedeId: string | null;
    agenziaNome: string;
  } | null = null;
```

Nel `return` della transazione, aggiungere i due campi:

```ts
        importoPenaleCent,
        veicoliSegnalatiTarghe: pratica.veicoli
          .filter((v) => v.segnalato)
          .map((v) => v.targa ?? '—'),
```

E nella `sendNotification` N17 (riga ~339) sostituire:

```ts
          importoPenaleCent: payload.importoPenaleCent,
          veicoliSegnalati: payload.veicoliSegnalatiTarghe,
```

- [ ] **Step 5: Eseguire i test e verificare che PASSINO**

```bash
pnpm --filter piattaforma test src/lib/penali/
```

Expected: PASS. (Il campo `veicoliSegnalati` nel payload N17 farà fallire il **typecheck** finché il Task 6 non estende il tipo: è atteso, si sistema lì. Se preferisci un albero sempre verde, esegui il Task 6 subito dopo questo e committa insieme.)

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/penali/
git commit -m "fix(penali): penale = 25€ x veicoli segnalati (era flat per pratica)"
```

---

### Task 5: `respingiSegnalazioneAction` resetta i veicoli

Senza questo, una segnalazione respinta lascia `segnalato=true`: la segnalazione **successiva** sulla stessa pratica calcolerebbe la penale su veicoli mai segnalati.

**Files:**
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.ts` (`respingiSegnalazioneAction`)
- Modify: `apps/piattaforma/src/lib/penali/segnalazione.conferma.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere a `segnalazione.conferma.test.ts` (importando l'azione in cima al file insieme all'altra):

```ts
describe('respingiSegnalazioneAction — reset dei veicoli segnalati', () => {
  it('azzera segnalato sui veicoli della pratica, altrimenti la prossima segnalazione eredita la penale', async () => {
    txMock.pratica.findUnique.mockResolvedValue(praticaFixture());

    const res = await respingiSegnalazioneAction(PID, 'Fermo non riscontrato');

    expect(res).toEqual({ ok: true });
    expect(txMock.veicolo.updateMany).toHaveBeenCalledWith({
      where: { praticaId: PID },
      data: { segnalato: false },
    });
  });
});
```

Aggiungere `veicolo: { updateMany: vi.fn() }` al `txMock` (riga ~21) e `txMock.veicolo.updateMany.mockResolvedValue({ count: 0 });` nel `beforeEach`.

- [ ] **Step 2: Eseguire e verificare il FAIL**

```bash
pnpm --filter piattaforma test src/lib/penali/segnalazione.conferma.test.ts -t "reset dei veicoli"
```

Expected: FAIL — `veicolo.updateMany` mai chiamato.

- [ ] **Step 3: Implementare**

In `respingiSegnalazioneAction`, dentro la transazione, accanto alla `pratica.update` che resetta `flagSegnalata`, aggiungere:

```ts
      // Reset dei veicoli: una segnalazione respinta non deve lasciare traccia,
      // altrimenti la successiva calcolerebbe la penale su veicoli mai segnalati.
      await tx.veicolo.updateMany({
        where: { praticaId },
        data: { segnalato: false },
      });
```

Se `respingiSegnalazioneAction` non usa già `$transaction`, avvolgere le due update in una.

- [ ] **Step 4: Eseguire e verificare il PASS**

```bash
pnpm --filter piattaforma test src/lib/penali/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/penali/
git commit -m "fix(penali): il respingimento azzera i veicoli segnalati"
```

---

### Task 6: N17 — mostrare i veicoli su cui è calcolata la penale

Il broker deve poter **verificare** il calcolo della penale che gli abbiamo addebitato.

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (`N17BrokerPenaleAddebitataPayload` ~146, `tplN17BrokerPenaleAddebitata` ~674)

- [ ] **Step 1: Estendere il payload**

```ts
export type N17BrokerPenaleAddebitataPayload = {
  nomeBroker: string;
  codicePratica: string;
  targa: string | null;
  tipoSegnalazione: 'FERMO_AMMINISTRATIVO' | 'IPOTECA' | 'DOCUMENTO_NON_VALIDO' | 'ALTRO';
  importoPenaleCent: number;
  /** Targhe dei veicoli su cui è calcolata la penale (€25 ciascuno). */
  veicoliSegnalati: string[];
  saldoWalletCent: number;
};
```

- [ ] **Step 2: Mostrare il dettaglio nel template + correggere il tag rotto**

In `tplN17BrokerPenaleAddebitata`, nel `text`, dopo la riga «Sono stati detratti…»:

```ts
    (p.veicoliSegnalati.length > 0
      ? `Veicoli segnalati (${p.veicoliSegnalati.length}): ${p.veicoliSegnalati.join(', ')}.\n`
      : '') +
```

E nel blocco HTML del riquadro rosso (riga ~697-700), sostituire il contenuto con:

```ts
    <div style="background:#fef2f2;border:1px solid #dc262633;border-radius:10px;padding:14px;font-size:13px;color:#0a2540">
      <strong style="color:#dc2626">−${formatCurrencyCent(p.importoPenaleCent)}</strong> detratti dal tuo wallet.<br>
      ${
        p.veicoliSegnalati.length > 0
          ? `Veicoli segnalati (${p.veicoliSegnalati.length}): <strong>${p.veicoliSegnalati.join(', ')}</strong><br>`
          : ''
      }
      Saldo attuale: <strong>${formatCurrencyCent(p.saldoWalletCent)}</strong>
    </div>
```

**Bug preesistente da correggere nello stesso passaggio** — riga ~693 chiude con `<\strong>` (backslash) invece di `</strong>`:

```ts
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter piattaforma typecheck
```

Expected: nessun errore (si chiude anche il buco lasciato dal Task 4 Step 4).

- [ ] **Step 4: Eseguire l'intera suite penali/notifiche**

```bash
pnpm --filter piattaforma test src/lib/penali/ src/lib/notifiche/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts
git commit -m "feat(notifiche): N17 mostra i veicoli su cui e' calcolata la penale"
```

---

### Task 7: Popup pre-invio — copy corretto + `POPUP_VERSION` v2.0

Il popup è **loggato con versione** (`BrokerDichiarazione`): cambiandone il testo **si deve** bumpare la versione, altrimenti l'audit associa il testo nuovo a dichiarazioni vecchie.

**Files:**
- Modify: `apps/piattaforma/src/lib/penali/config.ts` (`POPUP_VERSION`)
- Modify: `apps/piattaforma/src/components/dichiarazione-popup.tsx` (~100-107)

- [ ] **Step 1: Bump della versione**

In `config.ts`:

```ts
  POPUP_VERSION: 'v2.0',
```

Aggiornare il commento sopra la costante:

```ts
  /**
   * Versione corrente del testo del popup di responsabilità. Cambiarla
   * quando si modifica il copy del popup, in modo che il log
   * BrokerDichiarazione preservi la traccia esatta del testo accettato.
   *
   * v2.0 (2026-07-11): la penale è €25 per ciascun VEICOLO SEGNALATO (non per
   * pratica) e non è soggetta a IVA — rimosso «lordi», che non corrispondeva
   * ad alcun calcolo. Vedi docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md
   */
```

- [ ] **Step 2: Correggere il copy del riquadro ambra**

In `dichiarazione-popup.tsx`, sostituire il blocco alle righe ~100-107:

```tsx
        <div className="mb-5 rounded-[12px] border border-pv-amber-500/40 bg-pv-amber-50 px-4 py-3 text-[12.5px] text-pv-navy-800">
          Se un veicolo di questa pratica risulta soggetto a fermo o ipoteca, la
          pratica verrà annullata e ti verrà addebitata dal wallet una penale di{' '}
          <strong>
            €{(PENALI.PENALE_BROKER_DEFAULT_CENT / 100).toFixed(2).replace('.', ',')}
          </strong>{' '}
          <strong>per ciascun veicolo segnalato</strong> (i veicoli regolari non
          vengono addebitati). La penale non è soggetta a IVA. Perderai inoltre il
          compenso previsto per la pratica annullata.
        </div>
```

- [ ] **Step 3: Verificare che la versione sia effettivamente propagata al log**

```bash
grep -rn "POPUP_VERSION" apps/piattaforma/src --include=*.ts --include=*.tsx
```

Expected: la costante è letta dal wizard e passata al submit che crea `BrokerDichiarazione`. Se il wizard **hardcoda** `'v1.0'`, sostituirlo con `PENALI.POPUP_VERSION`.

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test src/lib/penali/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/penali/config.ts apps/piattaforma/src/components/dichiarazione-popup.tsx
git commit -m "fix(penali): popup allineato (penale per veicolo segnalato, no IVA) + POPUP_VERSION v2.0"
```

---

### Task 8: Schema — origine della sospensione di sede (+ migration)

Spec §D4: oggi l'agenzia auto-sospesa **si riattiva da sola** con un clic, perché sospensione volontaria e sanzione condividono `Sede.suspendedAt`.

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Sede`)
- Create: `packages/db/prisma/migrations/20260711130000_sede_suspension_origin/migration.sql`

**Interfaces:**
- Produces: `Sede.suspensionOrigin: 'UTENTE' | 'ANTI_ABUSO' | null` — consumato dai Task 9.

- [ ] **Step 1: Aggiungere enum e campo**

In `schema.prisma`, accanto agli altri enum:

```prisma
/// Chi ha disposto la sospensione di una sede. Determina chi può revocarla:
/// UTENTE → self-service; ANTI_ABUSO → solo Passaggio Veloce (è una sanzione).
enum SedeSuspensionOrigin {
  UTENTE
  ANTI_ABUSO
}
```

Nel `model Sede`, accanto a `suspendedAt`:

```prisma
  suspensionOrigin SedeSuspensionOrigin?
```

- [ ] **Step 2: Scrivere la migration a mano**

Creare `packages/db/prisma/migrations/20260711130000_sede_suspension_origin/migration.sql`:

```sql
-- Origine della sospensione di sede: una sanzione anti-abuso non deve essere
-- revocabile dal sanzionato (prima lo era: stesso campo suspendedAt).
CREATE TYPE "SedeSuspensionOrigin" AS ENUM ('UTENTE', 'ANTI_ABUSO');

ALTER TABLE "sedi" ADD COLUMN "suspensionOrigin" "SedeSuspensionOrigin";

-- Backfill: le sedi già sospese sono attribuite all'UTENTE. È la scelta
-- conservativa — non trasformiamo retroattivamente in sanzioni (irrevocabili
-- dall'utente) sospensioni che l'utente potrebbe essersi disposto da sé.
UPDATE "sedi" SET "suspensionOrigin" = 'UTENTE' WHERE "suspendedAt" IS NOT NULL;
```

⚠️ Verificare che la tabella si chiami davvero `sedi` (`@@map` nel model `Sede`) prima di applicare.

- [ ] **Step 3: Applicare e rigenerare**

```bash
nvm use 22.15.0
pnpm --filter @pv/db db:deploy
pnpm db:generate
```

Expected: migration applicata, nessun prompt.

- [ ] **Step 4: Verificare sul DB locale**

```bash
docker compose exec -T db psql -U postgres -d passaggio_veloce -c "\d sedi" | grep suspensionOrigin
```

Expected: la colonna esiste, tipo `SedeSuspensionOrigin`, nullable.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260711130000_sede_suspension_origin
git commit -m "feat(anti-abuso): Sede.suspensionOrigin per distinguere sanzione e sospensione volontaria"
```

---

### Task 9: L'anti-abuso non è più auto-revocabile

**Files:**
- Modify: `apps/piattaforma/src/lib/distribuzione/auto-suspend.ts:45`
- Modify: `apps/piattaforma/src/app/sedi/actions.ts` (`setSedeSuspended`, ~151-181)
- Create: `apps/piattaforma/src/app/sedi/actions.antiabuso.test.ts`
- Modify: `apps/piattaforma/src/app/admin/suspension-actions.ts` (nuova azione admin)

**Interfaces:**
- Consumes: `Sede.suspensionOrigin` (Task 8).
- Produces: `reactivateSedeAntiAbusoAction(sedeId: string): Promise<SuspensionResult>` — riservata a `ADMIN_PIATTAFORMA`/`ASSISTENTE`.

- [ ] **Step 1: Marcare l'origine nell'auto-sospensione**

In `auto-suspend.ts`, sostituire la `tx.sede.update` (riga ~45):

```ts
    await tx.sede.update({
      where: { id },
      data: { suspendedAt: new Date(), suspensionOrigin: 'ANTI_ABUSO' },
    });
```

- [ ] **Step 2: Scrivere i test che falliscono**

Creare `apps/piattaforma/src/app/sedi/actions.antiabuso.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La sanzione anti-abuso non deve essere revocabile dal sanzionato. Prima lo
 * era: `setSedeSuspended` scriveva `suspendedAt: null` per chiunque fosse
 * ADMIN_AZIENDA della propria azienda, e sospensione volontaria e sanzione
 * condividevano lo stesso campo. L'agenzia auto-sospesa per 5 no-show apriva
 * /sedi/[id], cliccava "Riattiva" e rientrava in distribuzione.
 */

const { prismaMock, authMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    sede: { findUnique: vi.fn(), update: vi.fn() },
  },
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { reactivateSedeAction, suspendSedeAction } from './actions';

const SEDE = 'sede-1';
const COMPANY = 'company-1';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u-1', role: 'ADMIN_AZIENDA', companyId: COMPANY },
  });
  prismaMock.sede.update.mockResolvedValue({});
});

describe('reactivateSedeAction — sanzione anti-abuso', () => {
  it('sede sospesa dall_ANTI_ABUSO: l_utente NON può riattivarla', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: 'ANTI_ABUSO',
    });

    const res = await reactivateSedeAction(SEDE);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('sede sospesa dall_UTENTE: la può riattivare da sé', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: 'UTENTE',
    });

    const res = await reactivateSedeAction(SEDE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.update).toHaveBeenCalledWith({
      where: { id: SEDE },
      data: { suspendedAt: null, suspensionOrigin: null },
    });
  });

  it('sospensione volontaria: marca origine UTENTE', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: null,
    });

    const res = await suspendSedeAction(SEDE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.update).toHaveBeenCalledWith({
      where: { id: SEDE },
      data: { suspendedAt: expect.any(Date), suspensionOrigin: 'UTENTE' },
    });
  });
});
```

- [ ] **Step 3: Eseguire e verificare il FAIL**

```bash
pnpm --filter piattaforma test src/app/sedi/actions.antiabuso.test.ts
```

Expected: FAIL — il primo test riceve `{ ok: true }` e `sede.update` **viene** chiamato (è esattamente il buco).

- [ ] **Step 4: Implementare**

In `apps/piattaforma/src/app/sedi/actions.ts`, sostituire `setSedeSuspended` (~151-173):

```ts
async function setSedeSuspended(sedeId: string, suspended: boolean): Promise<SedeActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Solo il proprietario può gestire le sedi' };
  }
  const companyId = session.user.companyId!;

  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { companyId: true, suspensionOrigin: true },
  });
  if (!sede || sede.companyId !== companyId) {
    return { ok: false, error: 'Sede non trovata' };
  }

  // Una sanzione non è revocabile dal sanzionato. La sede sospesa dal sistema
  // anti-abuso (5 no-show consecutivi) può essere riattivata solo da Passaggio
  // Veloce: altrimenti la misura non avrebbe alcun effetto — l'agenzia si
  // riattiverebbe da sé, ogni volta.
  if (!suspended && sede.suspensionOrigin === 'ANTI_ABUSO') {
    return {
      ok: false,
      error:
        'Questa sede è stata sospesa da Passaggio Veloce per mancate risposte reiterate. Scrivi ad assistenza@passaggioveloce.it per chiederne la riattivazione.',
    };
  }

  await prisma.sede.update({
    where: { id: sedeId },
    data: suspended
      ? { suspendedAt: new Date(), suspensionOrigin: 'UTENTE' }
      : { suspendedAt: null, suspensionOrigin: null },
  });
  revalidatePath('/sedi');
  return { ok: true };
}
```

- [ ] **Step 5: Eseguire e verificare il PASS**

```bash
pnpm --filter piattaforma test src/app/sedi/
```

Expected: PASS (i 3 nuovi + quelli esistenti).

- [ ] **Step 6: Aggiungere l'azione admin di revoca**

In `apps/piattaforma/src/app/admin/suspension-actions.ts`, in fondo:

```ts
/**
 * Revoca la sospensione anti-abuso di una SEDE (5 no-show consecutivi).
 * È l'unico modo per riattivarla: `setSedeSuspended` la rifiuta al titolare.
 * Cfr. clausola 11.2 dei Termini (revoca previa verifica di Passaggio Veloce).
 */
export async function reactivateSedeAntiAbusoAction(
  sedeId: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }

  await prisma.sede.update({
    where: { id: sedeId },
    data: { suspendedAt: null, suspensionOrigin: null },
  });

  revalidatePath('/admin/agenzie');
  revalidatePath('/sedi');
  return { ok: true };
}
```

- [ ] **Step 7: Esporre la revoca nell'area admin**

In `apps/piattaforma/src/app/admin/agenzie/page.tsx`, per ogni sede con `suspendedAt != null && suspensionOrigin === 'ANTI_ABUSO'`, mostrare un badge e un bottone «Riattiva sede» che invoca `reactivateSedeAntiAbusoAction(sede.id)`. Seguire il pattern già usato da `admin/suspend-button.tsx` (client component, `useTransition`, `InlineSpinner`). La query della pagina deve selezionare `sedi: { select: { id, nome, suspendedAt, suspensionOrigin } }`.

- [ ] **Step 8: Typecheck + suite**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test src/app/sedi/ src/lib/distribuzione/
```

Expected: PASS. Se `tick.test.ts` asserisce gli argomenti di `sede.update`, aggiornarlo con `suspensionOrigin: 'ANTI_ABUSO'`.

- [ ] **Step 9: Commit**

```bash
git add apps/piattaforma/src/app/sedi/ apps/piattaforma/src/app/admin/ apps/piattaforma/src/lib/distribuzione/auto-suspend.ts
git commit -m "fix(anti-abuso): la sospensione sanzionatoria non e' piu' revocabile dal sanzionato"
```

---

### Task 10: Liquidazione del wallet residuo alla cessazione (sotto soglia)

Senza questo, le clausole 5 e 11.4 sono **inadempibili**: `MIN_PAYOUT_CENT` gatea anche l'admin (`payout-exec.ts:144`).

**Files:**
- Modify: `apps/piattaforma/src/lib/wallet/payout-exec.ts` (`eseguiPayoutImmediato`, ~134-167)
- Create: `apps/piattaforma/src/lib/wallet/payout-liquidazione.test.ts`
- Modify: `apps/piattaforma/src/app/admin/suspension-actions.ts`

**Interfaces:**
- Produces: `eseguiPayoutImmediato(walletId, { automatico?, ignoraSoglia? })` — `ignoraSoglia` **non** è esposto all'utente: lo usa solo la liquidazione alla cessazione.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `apps/piattaforma/src/lib/wallet/payout-liquidazione.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Clausole 5 e 11.4 dei Termini: alla cessazione del rapporto il saldo residuo
 * è liquidato integralmente ANCHE se inferiore a 500 €. Oggi MIN_PAYOUT_CENT
 * gatea anche l'admin, quindi la promessa contrattuale sarebbe ineseguibile.
 * `ignoraSoglia` è il solo modo di onorarla — e NON deve essere raggiungibile
 * dal path utente.
 */

const { prismaMock, txMock, settlePayoutMock } = vi.hoisted(() => {
  const txMock = {
    wallet: { findUnique: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      payout: { update: vi.fn() },
      wallet: { update: vi.fn() },
      transazioneWallet: { create: vi.fn() },
    },
    settlePayoutMock: vi.fn(() => Promise.resolve({ ok: true, providerRef: 'ref-1' })),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./settle', () => ({ settlePayout: settlePayoutMock }));
vi.mock('@/lib/fatturazione/doc-broker', () => ({
  createDocBroker: vi.fn(() => Promise.resolve()),
}));

import { eseguiPayoutImmediato } from './payout-exec';
import { WALLET } from './config';

const W = 'wallet-1';
const SOTTO_SOGLIA = WALLET.MIN_PAYOUT_CENT - 1; // 499,99 €

beforeEach(() => {
  vi.clearAllMocks();
  txMock.wallet.findUnique.mockResolvedValue({ id: W, saldoCent: SOTTO_SOGLIA });
  txMock.payout.findFirst.mockResolvedValue(null);
  txMock.payout.create.mockResolvedValue({ id: 'payout-1' });
});

describe('eseguiPayoutImmediato — liquidazione alla cessazione', () => {
  it('saldo sotto soglia SENZA ignoraSoglia → rifiutato (comportamento utente invariato)', async () => {
    const res = await eseguiPayoutImmediato(W);

    expect(res.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });

  it('saldo sotto soglia CON ignoraSoglia → eseguito per l_intero residuo', async () => {
    const res = await eseguiPayoutImmediato(W, { ignoraSoglia: true });

    expect(res.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ importoCent: SOTTO_SOGLIA }),
      }),
    );
  });

  it('saldo NEGATIVO con ignoraSoglia → comunque rifiutato (non si bonifica un debito)', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: W, saldoCent: -5_000 });

    const res = await eseguiPayoutImmediato(W, { ignoraSoglia: true });

    expect(res.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Eseguire e verificare il FAIL**

```bash
pnpm --filter piattaforma test src/lib/wallet/payout-liquidazione.test.ts
```

Expected: FAIL sul 2° test — `ignoraSoglia` non esiste, il saldo sotto soglia viene rifiutato.

- [ ] **Step 3: Implementare**

In `payout-exec.ts`, cambiare la firma (~134):

```ts
export async function eseguiPayoutImmediato(
  walletId: string,
  opts: { automatico?: boolean; ignoraSoglia?: boolean } = {},
): Promise<EseguiPayoutResult> {
  const automatico = opts.automatico ?? false;
  // Solo per la liquidazione del residuo alla cessazione del rapporto
  // (clausole 5 e 11.4 dei Termini). NON raggiungibile dal path utente.
  const ignoraSoglia = opts.ignoraSoglia ?? false;
```

Sostituire il gate (~144):

```ts
      // Un saldo <= 0 non è mai erogabile, nemmeno alla cessazione: non si
      // bonifica un debito.
      if (wallet.saldoCent <= 0) {
        return { ok: false, error: 'Saldo non erogabile' };
      }
      if (!ignoraSoglia && wallet.saldoCent < WALLET.MIN_PAYOUT_CENT) {
        return {
          ok: false,
          error: `Saldo sotto la soglia minima di ${WALLET.MIN_PAYOUT_CENT / 100}€`,
        };
      }
```

- [ ] **Step 4: Eseguire e verificare il PASS**

```bash
pnpm --filter piattaforma test src/lib/wallet/
```

Expected: PASS (nuovi + esistenti).

- [ ] **Step 5: Liquidare il residuo alla cancellazione dell'account**

In `apps/piattaforma/src/app/admin/suspension-actions.ts`, dentro `deleteCompanyAction`, **prima** del soft-delete (riga ~211, subito dopo la notifica N16), aggiungere:

```ts
  // Clausola 11.4 dei Termini: alla cessazione il saldo residuo è liquidato
  // integralmente, ANCHE se inferiore a 500 €. Best-effort: un fallimento
  // dell'erogazione non deve bloccare la cancellazione — resta il credito a
  // registro, che l'admin liquida a mano.
  try {
    const wallets = await prisma.wallet.findMany({
      where: {
        OR: [{ companyId }, { sede: { companyId } }],
        saldoCent: { gt: 0 },
      },
      select: { id: true },
    });
    for (const w of wallets) {
      await eseguiPayoutImmediato(w.id, { ignoraSoglia: true }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }
```

Aggiungere l'import in cima al file:

```ts
import { eseguiPayoutImmediato } from '@/lib/wallet/payout-exec';
```

⚠️ Verificare che la relazione `Wallet.sede` esista con quel nome nello schema; in caso contrario ricavare i wallet delle sedi con una query separata su `Sede`.

- [ ] **Step 6: Typecheck + suite**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma test src/lib/wallet/ src/app/admin/
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/wallet/ apps/piattaforma/src/app/admin/suspension-actions.ts
git commit -m "feat(wallet): liquidazione del residuo alla cessazione anche sotto la soglia di 500 euro"
```

---

### Task 11: Copy `/wallet` — «i compensi non si perdono»

Coerenza tra il contratto (cl. 5) e ciò che l'utente legge nel prodotto.

**Files:**
- Modify: `apps/piattaforma/src/app/wallet/page.tsx:475`

- [ ] **Step 1: Riformulare il messaggio di soglia**

Alla riga ~475 il testo cita `formatCurrencyCent(WALLET.MIN_PAYOUT_CENT)` come vincolo. Riformularlo come accumulo (leggere il contesto e adattare la frase circostante):

```tsx
            I compensi si accumulano e restano sempre tuoi: puoi richiedere il
            prelievo al raggiungimento di {formatCurrencyCent(WALLET.MIN_PAYOUT_CENT)}.
            Nulla va perduto sotto questa soglia — se chiudi l&apos;account ti
            liquidiamo comunque l&apos;intero saldo residuo.
```

- [ ] **Step 2: Verificare a schermo**

```bash
pnpm --filter piattaforma dev
```

Aprire `http://localhost:3000/wallet` con un utente il cui saldo è **sotto** i 500 € e verificare che il messaggio compaia nella forma nuova e non sia troncato nel layout della card.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/wallet/page.tsx
git commit -m "feat(wallet): copy della soglia payout allineato ai Termini (accumulo, non barriera)"
```

---

### Task 12: Il nuovo testo dei Termini (clausole 5, 10, 11)

**Files:**
- Modify: `apps/piattaforma/src/app/termini/page.tsx`

- [ ] **Step 1: Aggiornare la data e il commento di testata**

Riga ~39: `Ultimo aggiornamento: 2026-07-11`.

Nel commento JSDoc del componente (~16-23), aggiungere:

```
 * Revisione 2026-07-11: riscritte le clausole 5 (prelievo — soglia di accumulo,
 * nessuna decadenza, liquidazione del residuo alla cessazione), 10 (penali —
 * esaustiva e tassativa) e 11 (limitazione / sospensione / cancellazione —
 * tre misure distinte, motivi tassativi). Spec:
 * docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md
```

- [ ] **Step 2: Sostituire le clausole 5, 10 e 11**

Riportare **integralmente** il testo approvato nella spec §5 (`docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md`), rispettando i pattern del file:
- ogni clausola in un `<Section title="...">`;
- paragrafi in `<p>`, elenchi in `<ul className="mt-2 list-disc space-y-1 pl-5">`;
- apostrofi ed entità come nel resto del file (`&apos;`, `&laquo;`, `&raquo;`, `&mdash;`);
- enfasi con `<strong>`, **nessun colore hardcoded**;
- l'importo della penale va scritto come **€ 25,00** nel testo (il contratto è un documento, non deve importare `PENALI`) — ma **deve** coincidere con `PENALE_BROKER_DEFAULT_CENT`. Se un giorno la costante cambia, questo testo va aggiornato: annotarlo con un commento sopra la Section 10.

La clausola 10 va strutturata in 8 sotto-punti (10.1…10.8) e la 11 in 5 (11.1…11.5), come da spec.

- [ ] **Step 3: Verificare che l'elenco delle vessatorie (cl. 17) resti invariato**

La lista deve restare `3, 5, 7, 8, 10, 11, 12, 16`. **Non** toccare `lib/auth/schemas.ts` né la registrazione: le clausole riscritte erano già nell'elenco.

```bash
grep -n "clausoleVessatorieAccepted" -r apps/piattaforma/src/lib/auth/schemas.ts
```

Expected: invariato rispetto a `main` (`git diff --stat apps/piattaforma/src/lib/auth/schemas.ts` → vuoto).

- [ ] **Step 4: Typecheck + lint + build**

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma lint
pnpm --filter piattaforma build
```

Expected: nessun errore.

- [ ] **Step 5: Verificare a schermo**

```bash
pnpm --filter piattaforma dev
```

Aprire `http://localhost:3000/termini` e rileggere le clausole 5, 10 e 11: numerazione corretta e continua, nessun carattere rotto, elenchi resi correttamente, nessun riferimento incrociato sbagliato (la 10.7 rinvia alla 11; la 11.1 rinvia alla 3; la 11.3 rinvia alla 10 e alla 11.1; la 11.4 rinvia alla 11.3).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/termini/page.tsx
git commit -m "feat(termini): riscrittura clausole 5 (prelievo), 10 (penali), 11 (sospensione)"
```

---

## Verifica finale (dopo l'ultimo task)

- [ ] **Suite completa**

```bash
pnpm --filter piattaforma test
pnpm typecheck
pnpm --filter piattaforma build
```

- [ ] **Walkthrough end-to-end sul DB locale** (il percorso che il contratto descrive):
  1. Broker crea una pratica **multi-veicolo** (3 veicoli) → il popup mostra «€25 per ciascun veicolo segnalato», **senza** «lordi».
  2. Agenzia accetta, poi «Segnala problema» → seleziona **1 solo** dei 3 veicoli.
  3. Admin conferma la segnalazione → il wallet del broker scende di **€25**, non di €75. `penaleAddebitatoCent = 2500`.
  4. La mail **N17** elenca la targa del solo veicolo segnalato.
  5. Ripetere selezionando **2** veicoli su 3 → addebito **€50**.
  6. Agenzia auto-sospesa per anti-abuso: `/sedi/[id]` → «Riattiva» **rifiuta** con il messaggio di rinvio all'assistenza. L'admin la riattiva da `/admin/agenzie`.
  7. `deleteCompanyAction` su una company con saldo **< 500 €** → il residuo viene liquidato.

- [ ] **Aggiornare la memoria di progetto**: `project_termini_condizioni.md` (nuove clausole), `project_sistema_penali_broker.md` (penale ora **per veicolo segnalato**; l'impatto «−€50» non è più la regola).

- [ ] **Documentazione**: aggiornare `docs/sistema-penali-broker.md` (§Decisioni #7 e §B-LEGAL 2 e 4) e chiudere i punti aperti risolti.

## Note per chi esegue

- **La spec è la fonte del testo legale.** Non riscrivere le clausole «a senso»: vanno riportate **alla lettera** da `docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md` §5. Ogni parola è stata scelta (in particolare il 10.8 sulla tassatività e l'11.5 sulla non-perdita dei compensi maturati).
- **Non introdurre** interessi di mora, diritti di compensazione o ritenzione del payout: sono stati **esclusi** per decisione esplicita (spec §7). Il contratto descrive solo ciò che il sistema fa.
- **Non** aggiungere «wallet negativo > 30gg → sospensione»: contraddirebbe il 10.6 e l'11.1 (spec §7).
