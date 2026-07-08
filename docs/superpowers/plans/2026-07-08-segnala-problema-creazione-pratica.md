# "Segnala un problema" nella creazione pratica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una CTA discreta in ogni step del wizard pratica apre un popup con cui il broker ci segnala un problema; salviamo uno snapshot dei dati + copie dei file caricati, senza toccare la sua bozza; noi la gestiamo in area admin e rispondiamo via email.

**Architecture:** Modello dedicato `SegnalazioneCreazione` (NON una `Pratica`, così non può comparire nella lista broker). I file caricati nel wizard sono già su Blob: creare le righe `Documento` è solo metadata (`storageKey = blobRef.key`), agganciate alla segnalazione. Due server action (invia lato broker, gestisci lato admin), un popup client (ricablaggio di `RevisioneManualePopup`), una pagina admin `/admin/segnalazioni` (gemella di `/admin/revisioni`). Il vecchio flusso "revisione manuale" (montato senza trigger, mai usato) viene ritirato.

**Tech Stack:** Next.js 16 App Router (Server Actions, Server Components), Prisma 5.22, Vitest, Postgres 17, Vercel Blob, sistema notifiche interno (`lib/notifiche`).

Spec: `docs/superpowers/specs/2026-07-08-segnala-problema-creazione-pratica-design.md`

## Global Constraints

- **La segnalazione NON valida i dati come una pratica**: l'utente può essere allo step 1 con solo una targa. Si accetta il payload così com'è; l'unica validazione di business è su `descrizione` (trim, 20..1000) e `step` (1..4).
- **Non crea alcuna `Pratica`** e **non tocca la bozza** in localStorage (è client-side).
- **Fire-and-forget**: dopo l'invio l'utente resta nel wizard.
- I `Documento` di segnalazione hanno `segnalazioneId` valorizzato, `praticaId`/`companyId` null.
- `inviaSegnalazioneCreazioneAction`: authz **broker** (`companyType === 'DEALER'`), fail-closed.
- `gestisciSegnalazioneCreazioneAction`: authz **ADMIN_PIATTAFORMA**, fail-closed.
- Migration solo additiva (nuovo modello + enum + colonna nullable). Nessun DDL distruttivo, nessun campo esistente rimosso.
- I campi `Pratica.richiedeRevisioneManuale/motivoRevisione/noteRevisione/revisioneCompletata` **restano** (letti da `lib/pratiche/stato-extra.ts`): non rimuoverli.
- `pnpm --filter piattaforma typecheck` e `pnpm --filter piattaforma test` verdi a ogni commit. Nessun colore hardcoded, nessun restyling fuori scope.
- Non fare `git push` (un push su main deploya in produzione). Committa e basta.

## File Structure

| File | Responsabilità |
|---|---|
| `packages/db/prisma/schema.prisma` | Modello `SegnalazioneCreazione`, enum `SegnalazioneCreazioneStato` + `TipoProblemaSegnalazione`, `Documento.segnalazioneId`, relazioni inverse su Company/User/Sede/Documento |
| `packages/db/prisma/migrations/<ts>_segnalazione_creazione/migration.sql` | Migration additiva |
| `apps/piattaforma/src/lib/segnalazioni/creazione.ts` | **Nuovo.** Le due server action + helper puri (`buildDatiSnapshot`, `documentiDaBlobRefs`) |
| `apps/piattaforma/src/lib/segnalazioni/creazione.test.ts` | **Nuovo.** Unit sugli helper + authz/comportamento delle action |
| `apps/piattaforma/src/lib/notifiche/templates.ts` | Due template: `N41` (admin, nuova segnalazione) e `N42` (broker, risposta) |
| `apps/piattaforma/src/lib/notifiche/send.ts` | Wiring dei due nuovi tipi notifica |
| `apps/piattaforma/src/components/revisione-manuale-popup.tsx` | Ricablato → `SegnalaProblemaPopup` (nuovo nome file `segnala-problema-popup.tsx`) |
| `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` | CTA in ogni step + trigger del popup + invio del payload |
| `apps/piattaforma/src/app/admin/segnalazioni/page.tsx` | **Nuovo.** Lista + dettaglio |
| `apps/piattaforma/src/app/admin/segnalazioni/gestisci-form.tsx` | **Nuovo.** Form client di gestione |
| `apps/piattaforma/src/lib/documenti/revisione.ts` + `.authz.test.ts` | **Rimossi** (Task 8) |
| `apps/piattaforma/src/app/admin/revisioni/` | **Rimossa** (Task 8) |

---

### Task 1: Modello dati

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_segnalazione_creazione/migration.sql`

**Interfaces:**
- Produces: modello `SegnalazioneCreazione`, enum `SegnalazioneCreazioneStato` (`APERTA`|`GESTITA`) e `TipoProblemaSegnalazione` (`LETTURA_DATI`|`COMPILAZIONE`|`ALTRO`), campo `Documento.segnalazioneId`. Usati da tutti i task successivi.

> Nota: la spec §1 non elencava una colonna `tipo`, ma il popup (§2) raccoglie un "tipo problema". È una svista della spec: qui il tipo è una colonna enum `TipoProblemaSegnalazione`.

- [ ] **Step 1: aggiungere enum e modello allo schema**

In `packages/db/prisma/schema.prisma`, aggiungere gli enum accanto agli altri enum e il modello accanto agli altri modelli:

```prisma
enum SegnalazioneCreazioneStato {
  APERTA
  GESTITA
}

enum TipoProblemaSegnalazione {
  LETTURA_DATI   // l'OCR ha letto male un dato
  COMPILAZIONE   // non sa come compilare un campo/caso
  ALTRO
}

model SegnalazioneCreazione {
  id String @id @default(uuid()) @db.Uuid

  companyId String  @db.Uuid
  company   Company @relation("SegnalazioniCreazione", fields: [companyId], references: [id], onDelete: Cascade)
  userId    String  @db.Uuid
  user      User    @relation("SegnalazioniCreazioneAutore", fields: [userId], references: [id])
  sedeId    String? @db.Uuid
  sede      Sede?   @relation("SegnalazioniCreazioneSede", fields: [sedeId], references: [id])

  step        Int
  tipo        TipoProblemaSegnalazione
  descrizione String

  /// Fotografia leggibile dei dati inseriti (metadati, NON i file):
  /// { tipoPratica, multiplo, veicoli:[{targa,telaio,ocr}], venditori, acquirente,
  ///   coAcquirenti, comune, allegati:[{slot,filename,mimeType}] }.
  datiSnapshot Json

  stato        SegnalazioneCreazioneStato @default(APERTA)
  notaGestione String?
  gestitaAt    DateTime?
  gestitaDaId  String?                    @db.Uuid
  gestitaDa    User?                      @relation("SegnalazioneCreazioneGestore", fields: [gestitaDaId], references: [id])

  documenti Documento[] @relation("DocumentiSegnalazione")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([stato, createdAt])
  @@index([companyId])
  @@map("segnalazioni_creazione")
}
```

- [ ] **Step 2: aggiungere il campo a `Documento` e le relazioni inverse**

Nel modello `Documento`, aggiungere accanto agli altri campi relazione:

```prisma
  segnalazioneId String?                @db.Uuid
  segnalazione   SegnalazioneCreazione? @relation("DocumentiSegnalazione", fields: [segnalazioneId], references: [id], onDelete: Cascade)
```

Nel modello `Company` aggiungere: `segnalazioniCreazione SegnalazioneCreazione[] @relation("SegnalazioniCreazione")`
Nel modello `User` aggiungere: `segnalazioniCreazione SegnalazioneCreazione[] @relation("SegnalazioniCreazioneAutore")` e `segnalazioniCreazioneGestite SegnalazioneCreazione[] @relation("SegnalazioneCreazioneGestore")`
Nel modello `Sede` aggiungere: `segnalazioniCreazione SegnalazioneCreazione[] @relation("SegnalazioniCreazioneSede")`

- [ ] **Step 3: generare la migration**

Run: `cd packages/db && npx prisma format --schema prisma/schema.prisma && npx prisma validate --schema prisma/schema.prisma`
Expected: "The schema at prisma\schema.prisma is valid 🚀"

Poiché Docker può essere spento, generare la migration a mano (non `migrate dev`). Creare `packages/db/prisma/migrations/<timestamp>_segnalazione_creazione/migration.sql` (timestamp nel formato `AAAAMMGGHHMMSS`, successivo all'ultima migration esistente):

```sql
-- CreateEnum
CREATE TYPE "SegnalazioneCreazioneStato" AS ENUM ('APERTA', 'GESTITA');
CREATE TYPE "TipoProblemaSegnalazione" AS ENUM ('LETTURA_DATI', 'COMPILAZIONE', 'ALTRO');

-- CreateTable
CREATE TABLE "segnalazioni_creazione" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sedeId" UUID,
    "step" INTEGER NOT NULL,
    "tipo" "TipoProblemaSegnalazione" NOT NULL,
    "descrizione" TEXT NOT NULL,
    "datiSnapshot" JSONB NOT NULL,
    "stato" "SegnalazioneCreazioneStato" NOT NULL DEFAULT 'APERTA',
    "notaGestione" TEXT,
    "gestitaAt" TIMESTAMP(3),
    "gestitaDaId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segnalazioni_creazione_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segnalazioni_creazione_stato_createdAt_idx" ON "segnalazioni_creazione"("stato", "createdAt");
CREATE INDEX "segnalazioni_creazione_companyId_idx" ON "segnalazioni_creazione"("companyId");

-- AlterTable
ALTER TABLE "documenti" ADD COLUMN "segnalazioneId" UUID;

-- CreateIndex
CREATE INDEX "documenti_segnalazioneId_idx" ON "documenti"("segnalazioneId");

-- AddForeignKey
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_gestitaDaId_fkey" FOREIGN KEY ("gestitaDaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_segnalazioneId_fkey" FOREIGN KEY ("segnalazioneId") REFERENCES "segnalazioni_creazione"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Verificare i nomi tabella reali con `@@map` nello schema: `companies`, `users`, `sedi`, `documenti`. Se un nome differisce, correggerlo nella FK.

- [ ] **Step 4: rigenerare il client e verificare i tipi**

Run: `cd packages/db && npx prisma generate --schema prisma/schema.prisma`
Poi: `pnpm --filter piattaforma typecheck`
Expected: 0 errori (i nuovi tipi Prisma esistono; nessun consumer li usa ancora).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(segnalazioni): modello SegnalazioneCreazione + Documento.segnalazioneId"
```

---

### Task 2: Notifiche (template admin + broker)

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts`
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts`
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts` (se esiste; altrimenti creare)

**Interfaces:**
- Produces: due tipi notifica utilizzabili via `sendNotification`:
  - `N41_ADMIN_NUOVA_SEGNALAZIONE_CREAZIONE` — payload `{ segnalazioneId: string; ragioneSociale: string; step: number; tipo: string; estratto: string }`
  - `N42_BROKER_SEGNALAZIONE_GESTITA` — payload `{ nota: string; nomeBroker: string }`

- [ ] **Step 1: Write the failing test**

Aggiungere in coda a `apps/piattaforma/src/lib/notifiche/templates.test.ts` (se il file non esiste, crearlo con l'import del modulo). I template ritornano `NotificaContent = { subject; html; text }`:

```ts
import { describe, it, expect } from 'vitest';
import { tplN41AdminNuovaSegnalazione, tplN42BrokerSegnalazioneGestita } from './templates';

describe('N41 admin nuova segnalazione creazione', () => {
  it('mette oggetto + link admin e cita azienda e step', () => {
    const out = tplN41AdminNuovaSegnalazione({
      segnalazioneId: 's1',
      ragioneSociale: 'Auto Rossi',
      step: 2,
      tipo: 'LETTURA_DATI',
      estratto: 'La targa è stata letta male',
    });
    expect(out.subject).toMatch(/segnalazione/i);
    expect(out.html).toContain('Auto Rossi');
    expect(out.html).toContain('/admin/segnalazioni');
  });
});

describe('N42 broker segnalazione gestita', () => {
  it('include la nota di risposta', () => {
    const out = tplN42BrokerSegnalazioneGestita({ nota: 'La targa corretta è AB123CD', nomeBroker: 'Mario' });
    expect(out.html).toContain('La targa corretta è AB123CD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/piattaforma && npx vitest run src/lib/notifiche/templates.test.ts`
Expected: FAIL — `tplN41…`/`tplN42…` non esportate.

- [ ] **Step 3: implementare i template**

In `templates.ts`, seguendo esattamente lo stile di `tplN20AdminRevisioneRichiesta`/`tplN21BrokerRevisioneCompletata`: helper locale `wrap(body)` (= `emailLayout`) per l'HTML, stile inline, `escapeHtml` sui valori dinamici, link admin come **path testuale** (`/admin/segnalazioni`, nessun base URL — è così che fa N20), ritorno `NotificaContent = { subject, html, text }`. Definire anche i payload tipizzati accanto agli altri (`N41…Payload`, `N42…Payload`).

```ts
export type N41AdminNuovaSegnalazionePayload = {
  segnalazioneId: string;
  ragioneSociale: string;
  step: number;
  tipo: string;
  estratto: string;
};
export type N42BrokerSegnalazioneGestitaPayload = { nota: string; nomeBroker: string };

export function tplN41AdminNuovaSegnalazione(p: N41AdminNuovaSegnalazionePayload): NotificaContent {
  const subject = 'Nuova segnalazione da creazione pratica';
  const text =
    `${p.ragioneSociale} ha segnalato un problema in creazione pratica.\n` +
    `Step: ${p.step} — Tipo: ${p.tipo}\n${p.estratto}\n` +
    `Apri /admin/segnalazioni per rispondere.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Nuova segnalazione</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.ragioneSociale)}</strong> ha segnalato un problema durante
      la creazione di una pratica (step ${p.step}, tipo: ${escapeHtml(p.tipo)}).
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <em>${escapeHtml(p.estratto)}</em>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Apri <strong>/admin/segnalazioni</strong> per rispondere.
    </p>
  `);
  return { subject, html, text };
}

export function tplN42BrokerSegnalazioneGestita(p: N42BrokerSegnalazioneGestitaPayload): NotificaContent {
  const subject = 'Risposta alla tua segnalazione';
  const saluto = p.nomeBroker ? `Ciao ${escapeHtml(p.nomeBroker)},` : 'Ciao,';
  const text =
    `${p.nomeBroker || ''}\nRiguardo alla tua segnalazione in creazione pratica:\n` +
    `${p.nota}\nPer dubbi rispondi pure a questa email.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Risposta alla tua segnalazione</h1>
    <p style="margin:0 0 12px;color:#334155;font-size:14px">${saluto}</p>
    <p style="margin:0 0 12px;color:#334155;font-size:14px">
      riguardo alla segnalazione inviata durante la creazione di una pratica:
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      ${escapeHtml(p.nota)}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Per dubbi rispondi pure a questa email.</p>
  `);
  return { subject, html, text };
}
```

`wrap`, `escapeHtml` e il tipo `NotificaContent` sono già importati/definiti nel file (usati da tutti i template). Non reintrodurli.

- [ ] **Step 4: wiring in `send.ts`**

Aggiungere i due tipi all'unione dei tipi notifica (accanto a `N20_…`/`N21_…`), i relativi payload tipizzati, e i due `case` nello switch che instrada al template:

```ts
    case 'N41_ADMIN_NUOVA_SEGNALAZIONE_CREAZIONE':
      return tplN41AdminNuovaSegnalazione(input.payload);
    case 'N42_BROKER_SEGNALAZIONE_GESTITA':
      return tplN42BrokerSegnalazioneGestita(input.payload);
```

Importare le due funzioni in cima a `send.ts`.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/piattaforma && npx vitest run src/lib/notifiche/templates.test.ts && cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck`
Expected: test verdi, 0 errori tsc.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche
git commit -m "feat(notifiche): N41 admin nuova segnalazione + N42 broker gestita"
```

---

### Task 3: Action `inviaSegnalazioneCreazioneAction` + helper

**Files:**
- Create: `apps/piattaforma/src/lib/segnalazioni/creazione.ts`
- Test: `apps/piattaforma/src/lib/segnalazioni/creazione.test.ts`

**Interfaces:**
- Consumes: modello Task 1; notifica `N41` Task 2; `getSessionContext`/`resolveSubmittedSede` (`lib/auth/session-context`, `lib/sedi/scope`); `getStorage().name`.
- Produces:
  - `type BlobRefInput = { key: string; name: string; size: number; type: string }`
  - `type InviaSegnalazioneInput = { step: number; tipo: TipoProblemaSegnalazione; descrizione: string; datiGrezzi: unknown; blobRefs: Record<string, BlobRefInput>; brokerSedeId?: string | null }`
  - `buildDatiSnapshot(datiGrezzi: unknown, blobRefs: Record<string, BlobRefInput>): Prisma.JsonObject` (puro)
  - `documentiDaBlobRefs(blobRefs, ctx: { userId: string; storageProvider: string }): DocumentoCreateInput[]` (puro; `tipo: 'ALTRO'`, la mappa slot→file vive nello snapshot)
  - `inviaSegnalazioneCreazioneAction(input: InviaSegnalazioneInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test (helper puri + action)**

```ts
// apps/piattaforma/src/lib/segnalazioni/creazione.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, getSessionContextMock } = vi.hoisted(() => ({
  prismaMock: {
    segnalazioneCreazione: { create: vi.fn() },
    documento: { createMany: vi.fn() },
    pratica: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw new Error(`__REDIRECT__:${u}`); }) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([{ email: 'a@pv.it', userId: 'adm' }])),
}));
vi.mock('@/lib/providers/storage', () => ({ getStorage: () => ({ name: 'vercel-blob' }) }));

import {
  buildDatiSnapshot,
  documentiDaBlobRefs,
  inviaSegnalazioneCreazioneAction,
} from './creazione';

const BROKER = 'br-1';
const SEDE = 'sede-1';
const REFS = {
  LIBRETTO_1_FRONTE: { key: 'k1', name: 'libretto.jpg', size: 111, type: 'image/jpeg' },
};

function brokerSession(): void {
  authMock.mockResolvedValue({ user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' } });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: BROKER, isOwner: false,
    accessibleSedi: [{ id: SEDE, nome: 'Mia', type: 'DEALER' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE, nome: 'Mia', type: 'DEALER' } },
    scopeIds: [SEDE], membershipRuoli: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.segnalazioneCreazione.create.mockResolvedValue({ id: 'seg1' });
  prismaMock.documento.createMany.mockResolvedValue({ count: 1 });
});

describe('buildDatiSnapshot', () => {
  it('include gli allegati come mappa slot→file', () => {
    const snap = buildDatiSnapshot({ tipo: 'SEMPLICE' }, REFS) as Record<string, unknown>;
    expect(snap.allegati).toEqual([
      { slot: 'LIBRETTO_1_FRONTE', filename: 'libretto.jpg', mimeType: 'image/jpeg' },
    ]);
  });
});

describe('documentiDaBlobRefs', () => {
  it('una riga per blobRef, tipo ALTRO, campi dal ref', () => {
    const docs = documentiDaBlobRefs(REFS, { userId: 'u1', storageProvider: 'vercel-blob' });
    expect(docs).toEqual([
      {
        tipo: 'ALTRO',
        storageKey: 'k1',
        storageProvider: 'vercel-blob',
        mimeType: 'image/jpeg',
        sizeBytes: 111,
        originalFilename: 'libretto.jpg',
        uploadedById: 'u1',
      },
    ]);
  });
});

describe('inviaSegnalazioneCreazioneAction', () => {
  const base = { step: 1, tipo: 'LETTURA_DATI' as const, datiGrezzi: { tipo: 'SEMPLICE' }, blobRefs: REFS };

  it('rifiuta descrizione troppo corta (nessuna scrittura)', async () => {
    brokerSession();
    const res = await inviaSegnalazioneCreazioneAction({ ...base, descrizione: 'corta' });
    expect(res.ok).toBe(false);
    expect(prismaMock.segnalazioneCreazione.create).not.toHaveBeenCalled();
  });

  it('crea la segnalazione e i documenti, NON crea una Pratica', async () => {
    brokerSession();
    const res = await inviaSegnalazioneCreazioneAction({
      ...base,
      descrizione: 'La targa del libretto è stata letta male dall OCR',
    });
    expect(res).toEqual({ ok: true, id: 'seg1' });
    expect(prismaMock.segnalazioneCreazione.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.documento.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  it('rifiuta un non-broker (agenzia)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', companyId: 'ag', companyType: 'AGENZIA', role: 'OPERATORE' } });
    getSessionContextMock.mockResolvedValue({ companyId: 'ag', isOwner: false, accessibleSedi: [], currentSede: null, scopeIds: [], membershipRuoli: {}, user: {} });
    const res = await inviaSegnalazioneCreazioneAction({ ...base, descrizione: 'x'.repeat(25) });
    expect(res.ok).toBe(false);
    expect(prismaMock.segnalazioneCreazione.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/piattaforma && npx vitest run src/lib/segnalazioni/creazione.test.ts`
Expected: FAIL — modulo `./creazione` inesistente.

- [ ] **Step 3: implementare**

```ts
// apps/piattaforma/src/lib/segnalazioni/creazione.ts
'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, type Prisma, type TipoProblemaSegnalazione } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import { resolveSubmittedSede } from '@/lib/sedi/scope';
import { getStorage } from '@/lib/providers/storage';
import { sendNotification, getAdminEmails } from '@/lib/notifiche';

export type BlobRefInput = { key: string; name: string; size: number; type: string };

export type InviaSegnalazioneInput = {
  step: number;
  tipo: TipoProblemaSegnalazione;
  descrizione: string;
  /** Payload grezzo dello stato wizard (veicoli/venditori/acquirente/…), non validato. */
  datiGrezzi: unknown;
  blobRefs: Record<string, BlobRefInput>;
  brokerSedeId?: string | null;
};

/** Snapshot leggibile: i dati grezzi + la mappa slot→file (i byte stanno nei Documenti). */
export function buildDatiSnapshot(
  datiGrezzi: unknown,
  blobRefs: Record<string, BlobRefInput>,
): Prisma.JsonObject {
  const allegati = Object.entries(blobRefs).map(([slot, r]) => ({
    slot,
    filename: r.name,
    mimeType: r.type,
  }));
  const base =
    datiGrezzi && typeof datiGrezzi === 'object' ? (datiGrezzi as Record<string, unknown>) : {};
  return { ...base, allegati } as Prisma.JsonObject;
}

/** Una riga Documento per blobRef. tipo ALTRO: la mappa slot→file vive nello snapshot. */
export function documentiDaBlobRefs(
  blobRefs: Record<string, BlobRefInput>,
  ctx: { userId: string; storageProvider: string },
) {
  return Object.values(blobRefs)
    .filter((r) => r && typeof r.key === 'string' && r.key.length > 0)
    .map((r) => ({
      tipo: 'ALTRO' as const,
      storageKey: r.key,
      storageProvider: ctx.storageProvider,
      mimeType: r.type,
      sizeBytes: r.size,
      originalFilename: r.name,
      uploadedById: ctx.userId,
    }));
}

export async function inviaSegnalazioneCreazioneAction(
  input: InviaSegnalazioneInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    return { ok: false, error: 'Solo i broker possono inviare segnalazioni' };
  }
  const companyId = session.user.companyId;
  const userId = session.user.id;
  if (!companyId) return { ok: false, error: 'Azienda non associata' };

  const descrizione = input.descrizione.trim().slice(0, 1000);
  if (descrizione.length < 20) {
    return { ok: false, error: 'Descrivi il problema con almeno 20 caratteri' };
  }
  const step = Number.isInteger(input.step) && input.step >= 1 && input.step <= 4 ? input.step : 1;

  const ctx = await getSessionContext();
  const sede = ctx
    ? resolveSubmittedSede({
        submittedId: input.brokerSedeId ?? null,
        currentSede: ctx.currentSede,
        accessibleSedi: ctx.accessibleSedi,
      })
    : null;

  const datiSnapshot = buildDatiSnapshot(input.datiGrezzi, input.blobRefs);
  const documenti = documentiDaBlobRefs(input.blobRefs, {
    userId,
    storageProvider: getStorage().name,
  });

  const seg = await prisma.$transaction(async (tx) => {
    const created = await tx.segnalazioneCreazione.create({
      data: {
        companyId,
        userId,
        sedeId: sede?.id ?? null,
        step,
        tipo: input.tipo,
        descrizione,
        datiSnapshot,
      },
      select: { id: true },
    });
    if (documenti.length > 0) {
      await tx.documento.createMany({
        data: documenti.map((d) => ({ ...d, segnalazioneId: created.id })),
      });
    }
    return created;
  });

  // Notifica admin — best effort (non blocca l'invio).
  try {
    const admins = await getAdminEmails();
    for (const a of admins) {
      await sendNotification({
        tipo: 'N41_ADMIN_NUOVA_SEGNALAZIONE_CREAZIONE',
        target: { email: a.email, userId: a.userId },
        payload: {
          segnalazioneId: seg.id,
          ragioneSociale: session.user.companyName ?? '—',
          step,
          tipo: input.tipo,
          estratto: descrizione.slice(0, 200),
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  return { ok: true, id: seg.id };
}
```

Nota: `session.user.companyName` esiste (valorizzato in `auth.ts` = `company.ragioneSociale`), quindi il payload N41 lo usa direttamente con fallback `'—'`.

- [ ] **Step 4: Run test + typecheck**

Run: `cd apps/piattaforma && npx vitest run src/lib/segnalazioni/creazione.test.ts && cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck`
Expected: test verdi, 0 errori.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/segnalazioni
git commit -m "feat(segnalazioni): inviaSegnalazioneCreazioneAction + snapshot/documenti da blobRef"
```

---

### Task 4: Action `gestisciSegnalazioneCreazioneAction`

**Files:**
- Modify: `apps/piattaforma/src/lib/segnalazioni/creazione.ts`
- Modify: `apps/piattaforma/src/lib/segnalazioni/creazione.test.ts`

**Interfaces:**
- Consumes: modello Task 1; notifica `N42` Task 2; `isAdminPiattaforma` (`lib/auth/permissions`); recapito broker dal DB.
- Produces: `gestisciSegnalazioneCreazioneAction(id: string, nota: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test**

Aggiungere a `creazione.test.ts` (estendere il blocco `vi.hoisted` del Task 3 con `segnalazioneCreazione.findUnique` e `segnalazioneCreazione.update`; il recapito broker arriva via `include` nel `findUnique`, non serve un mock `user.findUnique` separato):

```ts
describe('gestisciSegnalazioneCreazioneAction', () => {
  it('rifiuta un non-admin (nessuna mutazione)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'OPERATORE', companyType: 'DEALER' } });
    const res = await gestisciSegnalazioneCreazioneAction('seg1', 'La targa corretta è AB123CD');
    expect(res.ok).toBe(false);
    expect(prismaMock.segnalazioneCreazione.update).not.toHaveBeenCalled();
  });

  it('admin: marca GESTITA, invia email al broker', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    prismaMock.segnalazioneCreazione.findUnique.mockResolvedValue({
      id: 'seg1', stato: 'APERTA', userId: 'u1',
      user: { email: 'broker@x.it', nome: 'Mario' },
    });
    prismaMock.segnalazioneCreazione.update.mockResolvedValue({});
    const res = await gestisciSegnalazioneCreazioneAction('seg1', 'La targa corretta è AB123CD');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.segnalazioneCreazione.update).toHaveBeenCalledTimes(1);
    const arg = prismaMock.segnalazioneCreazione.update.mock.calls[0][0];
    expect(arg.data.stato).toBe('GESTITA');
    expect(arg.data.notaGestione).toContain('AB123CD');
  });

  it('rifiuta nota vuota', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    const res = await gestisciSegnalazioneCreazioneAction('seg1', '   ');
    expect(res.ok).toBe(false);
  });
});
```

Aggiungere `gestisciSegnalazioneCreazioneAction` all'import in cima al test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/piattaforma && npx vitest run src/lib/segnalazioni/creazione.test.ts`
Expected: FAIL — `gestisciSegnalazioneCreazioneAction` non esportata.

- [ ] **Step 3: implementare**

Aggiungere a `creazione.ts` (import `isAdminPiattaforma` da `@/lib/auth/permissions`):

```ts
export async function gestisciSegnalazioneCreazioneAction(
  id: string,
  nota: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: "Solo l'admin piattaforma può gestire le segnalazioni" };
  }
  const notaClean = nota.trim().slice(0, 2000);
  if (notaClean.length === 0) {
    return { ok: false, error: 'Scrivi una risposta prima di chiudere la segnalazione' };
  }

  const seg = await prisma.segnalazioneCreazione.findUnique({
    where: { id },
    select: { id: true, stato: true, user: { select: { email: true, nome: true } } },
  });
  if (!seg) return { ok: false, error: 'Segnalazione non trovata' };
  if (seg.stato === 'GESTITA') return { ok: false, error: 'Segnalazione già gestita' };

  await prisma.segnalazioneCreazione.update({
    where: { id },
    data: {
      stato: 'GESTITA',
      notaGestione: notaClean,
      gestitaAt: new Date(),
      gestitaDaId: session.user.id,
    },
  });

  // Risposta al broker — best effort.
  if (seg.user?.email) {
    await sendNotification({
      tipo: 'N42_BROKER_SEGNALAZIONE_GESTITA',
      target: { email: seg.user.email, userId: seg.id },
      payload: { nota: notaClean, nomeBroker: seg.user.nome ?? '' },
    }).catch(() => undefined);
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd apps/piattaforma && npx vitest run src/lib/segnalazioni/creazione.test.ts && cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck`
Expected: tutti verdi, 0 errori.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/segnalazioni
git commit -m "feat(segnalazioni): gestisciSegnalazioneCreazioneAction + risposta broker"
```

---

### Task 5: Popup + CTA nel wizard

**Files:**
- Create: `apps/piattaforma/src/components/segnala-problema-popup.tsx` (dal contenuto di `revisione-manuale-popup.tsx`)
- Modify: `apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`
- Delete: `apps/piattaforma/src/components/revisione-manuale-popup.tsx` (nel Task 8; qui si crea il nuovo accanto)

**Interfaces:**
- Consumes: `inviaSegnalazioneCreazioneAction` (Task 3). Lo stato wizard: il payload `veicoli/venditori/acquirente/coAcquirenti/blobRefs` che il wizard già costruisce nel submit, e `brokerSedeId`, `tipo` pratica, `step` corrente.

- [ ] **Step 1: creare il popup**

Copiare `revisione-manuale-popup.tsx` in `segnala-problema-popup.tsx` e adattarlo:
- Rinominare in `SegnalaProblemaPopup`.
- Props: `{ open: boolean; onClose: () => void; step: number; buildPayload: () => { veicoli; venditori; acquirente; coAcquirenti; blobRefs; brokerSedeId }; }` — il wizard passa una closure che costruisce il payload corrente (riusa la stessa logica del submit).
- Il select "tipo" usa `TipoProblemaSegnalazione`: opzioni `LETTURA_DATI` ("Un dato è stato letto/precompilato male"), `COMPILAZIONE` ("Non so come compilare un campo o un caso"), `ALTRO` ("Altro problema").
- `handleSubmit` chiama:
```ts
const payload = buildPayload();
const res = await inviaSegnalazioneCreazioneAction({
  step, tipo, descrizione: note,
  datiGrezzi: { tipo: payload.tipoPratica, veicoli: payload.veicoli, venditori: payload.venditori, acquirente: payload.acquirente, coAcquirenti: payload.coAcquirenti },
  blobRefs: payload.blobRefs,
  brokerSedeId: payload.brokerSedeId,
});
```
- Al successo: messaggio "Grazie, ti risponderemo via email. Puoi continuare la compilazione." + `onClose()`. **Non** chiamare `router.refresh()` né navigare: l'utente resta nel wizard.
- Testo del titolo: "Hai riscontrato un problema?".

- [ ] **Step 2: CTA + trigger nel wizard**

In `wizard.tsx`:
- Sostituire l'import e l'uso di `RevisioneManualePopup` con `SegnalaProblemaPopup`.
- Aggiungere, in fondo al contenitore di ogni step (o nel footer comune del wizard, se esiste un punto unico renderizzato per tutti gli step), una CTA discreta:
```tsx
<button
  type="button"
  onClick={() => setShowRevisione(true)}
  className="text-[12px] text-pv-slate-500 underline underline-offset-2 hover:text-pv-navy-700"
>
  Hai riscontrato un errore nella lettura automatica o nella compilazione? Segnalacelo.
</button>
```
  Riusare lo stato `showRevisione` già presente (`wizard.tsx:819`) — è quello che oggi non ha trigger. Ora `onClick` lo mette a `true`.
- Passare al popup `step={step}` (lo step corrente del wizard) e una `buildPayload` che costruisce `{ tipoPratica, veicoli, venditori, acquirente, coAcquirenti, blobRefs, brokerSedeId }` con la STESSA logica del submit (estrarre quella costruzione in una funzione riusabile se serve, per non duplicare).

- [ ] **Step 3: typecheck + lint + build**

Run: `cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && npx turbo run build --filter=piattaforma`
Expected: tutti verdi (la build è l'unica che intercetta gli errori di confine server/client sulle props del popup).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/components/segnala-problema-popup.tsx apps/piattaforma/src/app/pratiche/nuova/wizard.tsx
git commit -m "feat(segnalazioni): CTA 'segnala un problema' + popup in ogni step del wizard"
```

---

### Task 6: Pagina admin `/admin/segnalazioni`

**Files:**
- Create: `apps/piattaforma/src/app/admin/segnalazioni/page.tsx`
- Create: `apps/piattaforma/src/app/admin/segnalazioni/gestisci-form.tsx`

**Interfaces:**
- Consumes: `gestisciSegnalazioneCreazioneAction` (Task 4); route download documenti esistente (`/api/documenti/[id]`, già `ADMIN_PIATTAFORMA`).

- [ ] **Step 1: pagina lista + dettaglio**

Clonare la struttura di `apps/piattaforma/src/app/admin/revisioni/page.tsx` (guardia `isAdminPiattaforma` + `AppShell` + `Card`), cambiando la query:

```tsx
const segnalazioni = await prisma.segnalazioneCreazione.findMany({
  orderBy: [{ stato: 'asc' }, { createdAt: 'desc' }],
  include: {
    company: { select: { ragioneSociale: true } },
    user: { select: { nome: true, email: true } },
    sede: { select: { nome: true } },
    documenti: { select: { id: true, originalFilename: true, mimeType: true } },
    gestitaDa: { select: { nome: true } },
  },
});
```

Per ogni segnalazione mostrare: azienda + utente, `stato` (badge), `step`, `tipo`, `createdAt` (`formatRelative`), `descrizione`, i dati dello snapshot resi leggibili (targhe/telai/ocr dallo `datiSnapshot` — accedere come `Record<string, unknown>` con guardie), e la lista file con link `/api/documenti/<id>` (download). Per le APERTE, includere `<GestisciSegnalazioneForm id={s.id} />`. Per le GESTITE, mostrare `notaGestione` + chi/quando.

Non introdurre colori hardcoded: usare i token/varianti già in uso in `/admin/revisioni`.

- [ ] **Step 2: form di gestione (client)**

Clonare `apps/piattaforma/src/app/admin/revisioni/chiudi-form.tsx` in `gestisci-form.tsx`:
- Una textarea "risposta al broker" + bottone "Segna gestita e invia risposta".
- `handleSubmit` chiama `gestisciSegnalazioneCreazioneAction(id, nota)`; al successo `router.refresh()`; su errore mostra l'`Alert`.
- Disabilitare il bottone se la nota è vuota.

- [ ] **Step 3: link nella nav admin**

La voce "Revisioni" → `/admin/revisioni` è linkata in **due** punti:
- `apps/piattaforma/src/components/admin/admin-shell.tsx:70` (con icona `IconRevisioni`)
- `apps/piattaforma/src/components/app-shell.tsx:49`

Cambiare entrambi in label "Segnalazioni" → `/admin/segnalazioni` (riusare `IconRevisioni` per la sidebar, o rinominarla se preferito — non introdurre nuovi asset). La pagina `/admin/revisioni` viene rimossa nel Task 8, quindi questo link non deve più puntarci.

- [ ] **Step 4: typecheck + lint + build**

Run: `cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && npx turbo run build --filter=piattaforma`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/admin/segnalazioni apps/piattaforma/src/components
git commit -m "feat(segnalazioni): area admin /admin/segnalazioni (lista + dettaglio + gestione)"
```

---

### Task 7: Verifica end-to-end (locale)

**Files:** nessuno (solo verifica).

- [ ] **Step 1: suite + typecheck + lint + build**

Run: `cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && cd apps/piattaforma && npx vitest run && cd .. .. && npx turbo run build --filter=piattaforma`
Expected: 4 comandi verdi.

- [ ] **Step 2: verifica manuale su DB locale**

Avviare Docker + `pnpm --filter @pv/db db:deploy`. Come broker, aprire il wizard, caricare un libretto, cliccare la CTA "Segnalacelo", inviare. Verificare:
| Verifica | Atteso |
|---|---|
| Dopo l'invio | messaggio di conferma, popup si chiude, **si resta nel wizard** coi dati intatti |
| `/pratiche` (broker) | **nessuna** nuova bozza comparsa |
| `/admin/segnalazioni` (admin) | la segnalazione appare, con targhe/OCR nello snapshot e il libretto scaricabile |
| "Segna gestita" con una nota | stato → GESTITA, email al broker (console/Resend), nota visibile |

- [ ] **Step 3: Commit** (se sono servite correzioni durante la verifica)

---

### Task 8: Ritiro del vecchio flusso "revisione manuale"

Da fare **dopo** che il nuovo flusso è completo e verificato: rimuovere il vecchio, che il nuovo sostituisce.

**Files:**
- Delete: `apps/piattaforma/src/lib/documenti/revisione.ts`, `apps/piattaforma/src/lib/documenti/revisione.authz.test.ts`
- Delete: `apps/piattaforma/src/components/revisione-manuale-popup.tsx`
- Delete: `apps/piattaforma/src/app/admin/revisioni/` (page + chiudi-form)

**Interfaces:**
- Nessuna nuova. Si verifica che nessun riferimento residuo punti ai simboli rimossi.

- [ ] **Step 1: trovare tutti i riferimenti**

Run: `grep -rn "revisione-manuale-popup\|richiediRevisioneManualeAction\|risolviRevisioneAction\|admin/revisioni\|RevisioneManualePopup" apps/piattaforma/src`
Ogni hit va risolto: import da rimuovere, link nav da riportare a `/admin/segnalazioni`. Il wizard non deve più importare `RevisioneManualePopup` (già sostituito nel Task 5).

- [ ] **Step 2: rimuovere i file**

```bash
git rm apps/piattaforma/src/lib/documenti/revisione.ts apps/piattaforma/src/lib/documenti/revisione.authz.test.ts apps/piattaforma/src/components/revisione-manuale-popup.tsx
git rm -r apps/piattaforma/src/app/admin/revisioni
```

- [ ] **Step 3: pulire i riferimenti residui**

Rimuovere ogni import orfano trovato allo Step 1. **Non** toccare i campi `Pratica.richiedeRevisioneManuale/…` né `lib/pratiche/stato-extra.ts` (restano, dormienti — li legge il badge stato). **Non** toccare le notifiche N20/N21 se erano usate solo dal vecchio flusso: se `grep -rn "N20_ADMIN_REVISIONE\|N21_BROKER_REVISIONE" apps/piattaforma/src` non trova altri usi, lasciarle definite (codice inerte, rimozione fuori scope) — non è un errore lasciarle.

- [ ] **Step 4: suite + typecheck + lint + build**

Run: `cd /c/Users/fsiol/Desktop/passaggio_veloce && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint && cd apps/piattaforma && npx vitest run && cd .. .. && npx turbo run build --filter=piattaforma`
Expected: tutti verdi (il conteggio test cala di quelli di `revisione.authz.test.ts`, atteso).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(segnalazioni): ritira il flusso revisione manuale (sostituito da segnala problema)"
```

---

## Note di rilascio (fuori dai task, per il controller)

- La migration del Task 1 va applicata a Neon prod (`prisma migrate deploy`) **prima** del push del codice, come per i rilasci precedenti. È additiva → retrocompatibile col codice in prod.
- Env var `PV_*`/`STORAGE_PROVIDER`/`BLOB_READ_WRITE_TOKEN`: già presenti in prod (usati dal submit pratica). Nessuna nuova env richiesta.
- Retention (spec §5): l'MVP non auto-cancella i file di segnalazione. Il TTL post-gestione resta un follow-up documentato.
