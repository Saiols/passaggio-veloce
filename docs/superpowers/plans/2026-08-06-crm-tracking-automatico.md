# CRM Tracking & Pixel automatico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il tab "Tracking & Pixel" della scheda contatto CRM smette di essere un form editabile e diventa un referto in sola lettura, alimentato solo da eventi misurati — chiudendo il lost update che oggi cancella le aperture vere, e aggiungendo i due tracker mancanti (webhook Resend, iscrizione iniziata).

**Architecture:** I campi tracking escono da `CRM_CONTACT_INPUT`, quindi nessun percorso di codice può più scriverli da un form. Un webhook Resend firmato Svix scrive `mailAperta` e `emailBouncedAt`, correlando l'evento al contatto tramite `NotificaInviata.providerRef` → nuova colonna `crmContactId`. `iscrizioneInit` si accende allo step Account del wizard di registrazione, per match sull'email digitata.

**Tech Stack:** Next.js 16 (App Router), Prisma + Postgres, Zod, Vitest, Resend + `svix`, Tailwind (design system PV).

**Spec di riferimento:** `docs/superpowers/specs/2026-08-06-crm-tracking-automatico-design.md`

## Global Constraints

- **Migration a mano.** Mai `pnpm db:migrate` (propone DROP SEQUENCE su questo schema). Si scrive il file SQL e si applica con `pnpm db:deploy`.
- **Niente colori hardcoded.** Solo classi del design system (`pv-slate-*`, `pv-navy-*`, `pv-red-*`).
- **Apostrofi tipografici nei testi utente.** Il repo scrive `'L’indirizzo…'` — apostrofo curvo U+2019 dentro una stringa ad apici singoli (vedi `client.tsx:1007`). **È sintatticamente valido**: `’` non chiude una stringa delimitata da `'`. Non "correggerlo": non è un errore di sintassi. Se il tuo editor te lo segnala come tale, sbaglia lui.
- **Nomi tabella:** `crm_contacts`, `notifiche_inviate`. Le colonne sono camelCase, senza `@map`.
- **Test:** `pnpm --filter piattaforma test` (vitest). Typecheck: `pnpm --filter piattaforma typecheck`.
- **Categoria tag Resend dell'email di partenza:** `N26_EMAIL_PARTENZA` (valore di `NotificaTipo`, invariato da `sanitizeTagValue`).
- **Troncamento motivo bounce:** 500 caratteri.
- **`??=` semantico:** le date di primo evento (`mailApertaAt`, `iscrizioneInitAt`) non si sovrascrivono mai una volta valorizzate.
- **Ordine dei task obbligatorio fra 4 e 5:** la UI smette di usare i campi *prima* che spariscano dallo schema Zod, altrimenti il progetto non compila fra un task e l'altro.

---

### Task 1: Schema Prisma + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `CrmContact` ~2244-2260, model `NotificaInviata` ~2051-2060)
- Create: `packages/db/prisma/migrations/20260806120000_crm_tracking_automatico/migration.sql`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: campi Prisma `CrmContact.mailApertaAt`, `CrmContact.iscrizioneInitAt`, `CrmContact.emailBouncedAt`, `CrmContact.emailBounceMotivo`, `NotificaInviata.crmContactId` — tutti nullable, tutti usati dai task successivi.

- [ ] **Step 1: Aggiungere i campi a `CrmContact`**

Nel blocco `// Pixel/funnel tracking`, subito dopo `mailAperta`:

```prisma
  mailAperta     Boolean   @default(false)
  /// Prima apertura della mail di partenza (webhook Resend `email.opened`).
  /// Le aperture successive NON la sovrascrivono.
  mailApertaAt   DateTime?
```

Subito dopo `iscrizioneInit`:

```prisma
  iscrizioneInit Boolean   @default(false)
  /// Quando è iniziata l'iscrizione (step Account del wizard): è la data di S6.
  /// `iscrizioneAt` invece è la data di iscrizione COMPLETATA (S7).
  iscrizioneInitAt DateTime?
```

E in fondo al blocco, dopo `iscrizioneAt`:

```prisma
  /// Bounce DEFINITIVO (`subType = hard`) dell'ultima email di partenza.
  /// null = indirizzo utilizzabile. Si azzera da solo quando l'email cambia.
  emailBouncedAt    DateTime?
  /// Messaggio del server destinatario, troncato a 500 char.
  emailBounceMotivo String?
```

- [ ] **Step 2: Aggiungere `crmContactId` a `NotificaInviata`**

Dopo `providerRef` / `errorMessage`:

```prisma
  /// Contatto CRM destinatario (valorizzato solo per N26_EMAIL_PARTENZA).
  /// Riferimento SOFT (scalare, niente FK), come `EventoPratica.praticaId`:
  /// il contatto può essere eliminato senza trascinarsi dietro il log di audit.
  crmContactId String? @db.Uuid
```

E fra gli indici del model:

```prisma
  @@index([crmContactId])
  @@index([providerRef])
```

- [ ] **Step 3: Scrivere la migration SQL**

`packages/db/prisma/migrations/20260806120000_crm_tracking_automatico/migration.sql`:

```sql
-- AlterTable: referto tracking CRM
ALTER TABLE "crm_contacts" ADD COLUMN "mailApertaAt" TIMESTAMP(3);
ALTER TABLE "crm_contacts" ADD COLUMN "iscrizioneInitAt" TIMESTAMP(3);
ALTER TABLE "crm_contacts" ADD COLUMN "emailBouncedAt" TIMESTAMP(3);
ALTER TABLE "crm_contacts" ADD COLUMN "emailBounceMotivo" TEXT;

-- AlterTable: correlazione webhook Resend -> contatto CRM
ALTER TABLE "notifiche_inviate" ADD COLUMN "crmContactId" UUID;

-- CreateIndex
CREATE INDEX "notifiche_inviate_crmContactId_idx" ON "notifiche_inviate"("crmContactId");
CREATE INDEX "notifiche_inviate_providerRef_idx" ON "notifiche_inviate"("providerRef");
```

Nessun backfill: i dati di produzione sono usa-e-getta e non esiste una fonte da cui ricostruire aperture passate.

- [ ] **Step 4: Applicare la migration e rigenerare il client**

```bash
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db exec prisma generate
```

Atteso: `1 migration applied`, generate senza errori.

⚠️ `pnpm db:deploy` **alla radice non esiste**: il root package.json espone `db:migrate`, `db:generate` e `db:studio`, ma non `db:deploy` — che vive solo in `packages/db`. Va invocato col `--filter`.

- [ ] **Step 5: Verificare sul DB reale che le colonne esistano**

```bash
docker exec -i pv-postgres psql -U pv -d passaggio_veloce -c "\d crm_contacts" | grep -E "mailApertaAt|iscrizioneInitAt|emailBounce"
docker exec -i pv-postgres psql -U pv -d passaggio_veloce -c "\d notifiche_inviate" | grep -E "crmContactId|providerRef"
```

Atteso: 4 righe dalla prima query, e dalla seconda la colonna `crmContactId` più i due indici. Se il nome del container differisce, ricavarlo con `docker ps`.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter piattaforma typecheck
```

Atteso: PASS. (Se a cache fredda dà stack overflow o errori Prisma fasulli, rilanciarlo: passa col `tsbuildinfo` caldo.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260806120000_crm_tracking_automatico
git commit -m "feat(crm): campi referto tracking + correlazione notifica-contatto"
```

---

### Task 2: `fatti.ts` — S6 acquista la sua data

**Files:**
- Modify: `apps/piattaforma/src/lib/crm/fatti.ts:3-18` (interfaccia), `:75-77` (ramo S6)
- Modify: `apps/piattaforma/src/lib/crm/fatti.test.ts:5-20` (oggetto `vuoto`)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx:92-110` (`fattiDaRow`), `:34-89` (`ContactRow`)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/page.tsx:154-174` (serializzazione)

**Interfaces:**
- Consumes: campi Prisma del Task 1.
- Produces: `ContattoFatti` con `iscrizioneInitAt: Date | null`; `ContactRow` con `mailApertaAt`, `iscrizioneInitAt`, `emailBouncedAt`, `emailBounceMotivo` (tutti `string | null`, ISO). I task 4 e 5 leggono da qui.

Oggi `statoFattuale` per S6 usa `c.iscrizioneAt` come data, ma `iscrizioneAt` viene scritto solo a iscrizione **completata**: un S6 avrebbe sempre data `null`. Questo task lo corregge.

- [ ] **Step 1: Scrivere il test che fallisce**

In `apps/piattaforma/src/lib/crm/fatti.test.ts`, aggiungere `iscrizioneInitAt: null` all'oggetto `vuoto` (accanto a `iscrizioneInit: false`) e aggiungere questo test dentro `describe('statoFattuale')`:

```ts
  it('S6 riporta la data di iscrizione INIZIATA, non quella di completamento', () => {
    const at = new Date('2026-08-01T10:00:00Z');
    const r = statoFattuale({
      ...vuoto,
      linkInviato: true,
      linkAperto: true,
      iscrizioneInit: true,
      iscrizioneInitAt: at,
    });
    expect(r.codice).toBe('S6');
    expect(r.at).toEqual(at);
  });
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test -- fatti.test.ts
```

Atteso: FAIL. Prima l'errore è di tipo (`iscrizioneInitAt` non esiste su `ContattoFatti`); una volta aggiunto il campo all'interfaccia, l'asserzione su `r.at` fallisce perché torna `null`.

- [ ] **Step 3: Aggiungere il campo all'interfaccia**

In `fatti.ts`, dentro `ContattoFatti`, subito dopo `iscrizioneInit: boolean;`:

```ts
  iscrizioneInitAt: Date | null;
```

- [ ] **Step 4: Usarlo nel ramo S6**

In `statoFattuale`, sostituire il ramo:

```ts
  } else if (c.iscrizioneInit) {
    flag = 'S6';
    flagAt = c.iscrizioneInitAt;
  } else if (c.linkAperto) {
```

- [ ] **Step 5: Allineare i costruttori di `ContattoFatti`**

`ContattoFatti` è costruito in un solo punto di produzione: `fattiDaRow` in `client.tsx:92`. Aggiungere, dopo `iscrizioneInit: c.iscrizioneInit,`:

```ts
    iscrizioneInitAt: d(c.iscrizioneInitAt),
```

Nello stesso file, aggiungere a `ContactRow` (dopo `iscrizioneAt: string | null;`) i quattro campi nuovi — servono anche ai Task 4 e 5:

```ts
  mailApertaAt: string | null;
  iscrizioneInitAt: string | null;
  emailBouncedAt: string | null;
  emailBounceMotivo: string | null;
```

- [ ] **Step 6: Serializzare le nuove date nella page**

In `apps/piattaforma/src/app/admin/crm/contatti/page.tsx`, nel `.map()` che serializza (accanto a `iscrizioneAt: c.iscrizioneAt?.toISOString() ?? null,`):

```ts
    mailApertaAt: c.mailApertaAt?.toISOString() ?? null,
    iscrizioneInitAt: c.iscrizioneInitAt?.toISOString() ?? null,
    emailBouncedAt: c.emailBouncedAt?.toISOString() ?? null,
```

`emailBounceMotivo` è una stringa e arriva già dallo spread `...c`: la query usa `include` (page.tsx:87-97), non `select`, quindi tutti gli scalari nuovi fluiscono da soli — vanno convertite a mano solo le `Date`.

- [ ] **Step 7: Lanciare i test e il typecheck**

```bash
pnpm --filter piattaforma test -- fatti.test.ts
pnpm --filter piattaforma typecheck
```

Atteso: entrambi PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/crm/fatti.ts apps/piattaforma/src/lib/crm/fatti.test.ts apps/piattaforma/src/app/admin/crm/contatti/client.tsx apps/piattaforma/src/app/admin/crm/contatti/page.tsx
git commit -m "fix(crm): lo stato S6 usa la data di iscrizione iniziata"
```

---

### Task 3: `crmContactId` end-to-end sulle notifiche

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts:338-341` (firma `opts`), `:425-437` (create)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts:787-800` (loop invii)
- Test: `apps/piattaforma/src/app/admin/crm/contatti/email-partenza.action.test.ts`

**Interfaces:**
- Consumes: `NotificaInviata.crmContactId` (Task 1).
- Produces: `sendNotification(input, opts?)` accetta `opts.crmContactId?: string` e lo persiste. Il Task 5 (handler webhook) legge quella colonna.

⚠️ **Attenzione al precedente ingannevole:** `opts.praticaId` **non viene persistito** — serve solo a iniettare il blocco "Sede della firma" nel template (`send.ts:394`). Il canale `opts` esiste, la persistenza no: va aggiunta.

⚠️ **Servono DUE test, non uno.** Il test qui sotto vive in un file dove `sendNotification` è mockata: dimostra che `actions.ts` passa l'argomento, ma non esegue mai la `create` dentro `send.ts`. La metà "e persisterlo" del requisito resterebbe a copertura **zero**, e un refactor che la togliesse non farebbe diventare rosso nulla — il sintomo comparirebbe solo in produzione, come "le aperture email non si registrano mai". Serve anche un test focalizzato su `sendNotification` stessa (mockando `@pv/db` e il provider email, **non** `sendNotification`) che asserisca `data.crmContactId` sulla `create`, più il caso senza `opts` che deve dare `null`.

- [ ] **Step 1: Scrivere il test che fallisce**

In `email-partenza.action.test.ts`, aggiungere:

```ts
  it('valorizza crmContactId su OGNI notifica, indirizzi aggiuntivi compresi', async () => {
    findUnique.mockResolvedValue({
      id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it',
      emailOptOutAt: null, nome: 'X', emailUnsubToken: null, companyId: null,
    });
    update.mockResolvedValue({});
    await sendEmailPartenzaAction({
      contactId: 'c1',
      nomeReferente: 'Mario',
      messaggio: MSG,
      emailAggiuntive: ['titolare@personale.it'],
    });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    for (const call of sendNotification.mock.calls) {
      expect(call[1]?.crmContactId).toBe('c1');
    }
  });
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test -- email-partenza.action.test.ts
```

Atteso: FAIL — `call[1]` è `undefined` (oggi `sendNotification` è chiamata con un solo argomento).

- [ ] **Step 3: Estendere `opts` e persistere il campo**

In `send.ts`, la firma:

```ts
export async function sendNotification(
  input: SendInput,
  opts?: { attachments?: EmailAttachment[]; praticaId?: string; crmContactId?: string },
): Promise<void> {
```

E nel `prisma.notificaInviata.create` (`send.ts:425`), dentro `data`, dopo `payload,`:

```ts
      crmContactId: opts?.crmContactId ?? null,
```

- [ ] **Step 4: Passarlo dall'invio dell'email di partenza**

In `contatti/actions.ts`, nel loop `for (const email of destinatari)`, aggiungere il secondo argomento alla chiamata:

```ts
    await sendNotification(
      {
        tipo: 'N26_EMAIL_PARTENZA',
        target: { email },
        payload: {
          nomeReferente: input.nomeReferente.trim() || contact.nome,
          messaggio,
          categoria: contact.cat as 'BROKER' | 'AGENZIA',
          linkUrl,
          unsubUrl,
          codice,
        },
      },
      { crmContactId: contact.id },
    );
```

- [ ] **Step 5: Lanciare i test**

```bash
pnpm --filter piattaforma test -- email-partenza.action.test.ts
```

Atteso: PASS (tutti i test del file, non solo il nuovo).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/send.ts apps/piattaforma/src/app/admin/crm/contatti/actions.ts apps/piattaforma/src/app/admin/crm/contatti/email-partenza.action.test.ts
git commit -m "feat(crm): la notifica email di partenza porta l'id del contatto"
```

---

### Task 4: Il tab diventa un referto in sola lettura

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx:1779-1861` (`TabTracking`), `:1200-1202` (call site)

**Interfaces:**
- Consumes: `ContactRow` esteso (Task 2).
- Produces: `TabTracking({ contact })` — non riceve più `data`/`set`/`readOnly`. Il Task 5 rimuove i campi dallo schema Zod contando su questo.

⚠️ **Questo task viene PRIMA del Task 5**: la UI deve smettere di usare `data.linkInviato` & co. prima che quei campi spariscano da `CrmContactInput`, altrimenti il progetto non compila.

- [ ] **Step 1: Aggiungere il componente riga del referto**

In `client.tsx`, subito prima di `function TabTracking`:

```tsx
/**
 * Una riga del referto tracking: sola lettura per costruzione — non riceve
 * `onChange`, quindi non c'è modo di scriverla da qui nemmeno per sbaglio.
 */
function RigaReferto({
  label,
  fatto,
  quando,
  dettaglio,
  nota,
  allarme,
}: {
  label: string;
  fatto: boolean;
  quando?: string | null;
  dettaglio?: string;
  nota?: string;
  allarme?: boolean;
}) {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
  return (
    <div className="rounded-[10px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          {label}
        </span>
        <span
          className={
            'text-[12.5px] font-bold ' +
            (allarme
              ? 'text-pv-red-500'
              : fatto
                ? 'text-pv-navy-800'
                : 'text-pv-slate-400')
          }
        >
          {fatto ? (quando ? fmt(quando) : 'sì') : '—'}
        </span>
      </div>
      {fatto && dettaglio ? (
        <p className="mt-0.5 text-[11.5px] text-pv-slate-600">{dettaglio}</p>
      ) : null}
      {nota ? <p className="mt-0.5 text-[10.5px] text-pv-slate-500">{nota}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Riscrivere `TabTracking`**

Sostituire l'intera funzione `TabTracking` (client.tsx:1779-1861) con:

```tsx
function TabTracking({ contact }: { contact: ContactRow | null }) {
  if (!contact) {
    return (
      <p className="text-[12.5px] text-pv-slate-500">
        Nessun fatto registrato: il referto si popola dopo il salvataggio del contatto e
        l&apos;invio dell&apos;email di partenza.
      </p>
    );
  }
  return (
    <>
      <p className="mb-3 text-[12px] text-pv-slate-500">
        Referto automatico: questi dati li scrive il sistema. Per registrare
        un&apos;attività fatta fuori piattaforma, usa lo Stato nel tab «Stato &amp;
        Chiamate».
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TimelineFatti contact={contact} />
        <RigaReferto
          label="Link inviato"
          fatto={contact.linkInviato}
          quando={contact.linkInviatoAt}
        />
        <RigaReferto
          label="Link aperto"
          fatto={contact.linkAperto}
          quando={contact.linkApertoAt}
          dettaglio={
            contact.linkAperture > 1 ? `${contact.linkAperture} aperture` : undefined
          }
        />
        <RigaReferto
          label="Mail aperta"
          fatto={contact.mailAperta}
          quando={contact.mailApertaAt}
          nota="Indizio, non prova: Gmail e Apple Mail caricano il pixel da soli."
        />
        <RigaReferto
          label="Iscrizione iniziata"
          fatto={contact.iscrizioneInit}
          quando={contact.iscrizioneInitAt}
        />
        <RigaReferto
          label="Iscrizione completata"
          fatto={contact.iscrizioneComp}
          quando={contact.iscrizioneAt}
        />
        {contact.emailBouncedAt ? (
          <RigaReferto
            label="Indirizzo email"
            fatto
            quando={contact.emailBouncedAt}
            dettaglio={contact.emailBounceMotivo ?? 'Email rimbalzata'}
            nota="L'invio resta bloccato finché l'indirizzo non viene corretto."
            allarme
          />
        ) : null}
      </div>
    </>
  );
}
```

Nota: `TimelineFatti` resta dentro la griglia e conserva il suo `sm:col-span-2`, esattamente come prima.

- [ ] **Step 3: Aggiornare il call site**

A client.tsx:1200-1202, sostituire:

```tsx
          {tab === 'tracking' && <TabTracking contact={contact} />}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter piattaforma typecheck
```

Atteso: PASS. Se compare "`data` is declared but never read" o simili, significa che è rimasto un riferimento al vecchio `TabProps`: rimuoverlo.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): il tab Tracking diventa un referto in sola lettura"
```

---

### Task 5: Chiudere il lost update

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts:90-110` (schema Zod), `:184-195` (`dataFromInput`)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx:1275-1290` (`initialData`)
- Test: `apps/piattaforma/src/app/admin/crm/contatti/tracking-non-scrivibile.test.ts` (nuovo)

**Interfaces:**
- Consumes: `TabTracking` che non usa più `data`/`set` (Task 4).
- Produces: `CrmContactInput` senza i 12 campi tracking. Nessun task successivo dipende da questo tipo.

Questo è il cuore dell'intervento: rimossi dall'input, i campi non sono più *raggiungibili* da un form. Il bug non è mitigato, è irrappresentabile.

- [ ] **Step 1: Scrivere il test di regressione che fallisce**

Creare `apps/piattaforma/src/app/admin/crm/contatti/tracking-non-scrivibile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: () => Promise.resolve({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } }),
}));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const findUnique = vi.fn();
const update = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: {
    crmContact: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { updateCrmContactAction } from './actions';

/**
 * Regressione del lost update: la scheda contatto poteva riscrivere i campi
 * del funnel con lo snapshot che aveva all'apertura, cancellando un'apertura
 * del link avvenuta nel frattempo. Se qualcuno rimette i campi tracking nel
 * form, questo test torna rosso.
 */
describe('updateCrmContactAction — i campi tracking non sono scrivibili', () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    findUnique.mockResolvedValue({ assignedToId: null, status: 'S4', arricchitoDa: null });
    update.mockResolvedValue({});
  });

  const base = {
    nome: 'Autofficina Rossi',
    cat: 'BROKER',
    tel: '3331234567',
    status: 'S4',
    fonte: 'CSV',
  };

  const CAMPI_TRACKING = [
    'linkInviato', 'linkInviatoAt', 'linkAperto', 'linkAperture',
    'videoInviato', 'videoMin', 'mailAperta', 'smsInviato', 'waInviato',
    'iscrizioneInit', 'iscrizioneComp', 'iscrizioneAt',
  ] as const;

  it('un salvataggio normale non tocca nessun campo tracking', async () => {
    const res = await updateCrmContactAction('c1', base);
    expect(res.ok).toBe(true);
    const data = update.mock.calls[0][0].data;
    for (const campo of CAMPI_TRACKING) {
      expect(data).not.toHaveProperty(campo);
    }
  });

  it('anche se il client li manda a forza, non finiscono sul DB', async () => {
    await updateCrmContactAction('c1', {
      ...base,
      linkAperto: false,
      linkAperture: 0,
      iscrizioneComp: false,
      mailAperta: false,
    });
    const data = update.mock.calls[0][0].data;
    for (const campo of CAMPI_TRACKING) {
      expect(data).not.toHaveProperty(campo);
    }
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test -- tracking-non-scrivibile.test.ts
```

Atteso: FAIL su entrambi — oggi `data` contiene tutti e 12 i campi.

- [ ] **Step 3: Rimuovere i campi dallo schema Zod**

In `actions.ts`, eliminare l'intero blocco `// Tracking` da `linkInviato:` fino a `iscrizioneAt: ...` compreso (righe ~90-110), lasciando intatto il blocco `platStatus` e successivi che segue.

- [ ] **Step 4: Rimuoverli da `dataFromInput`**

Eliminare le 12 righe da `linkInviato: d.linkInviato,` a `iscrizioneAt: parseDate(d.iscrizioneAt),` (righe ~184-195). `platStatus` e successivi restano.

- [ ] **Step 5: Rimuoverli dall'inizializzatore del form**

In `client.tsx`, dentro `initialData`, eliminare le righe che inizializzano i 12 campi (`linkInviato`, `linkInviatoAt`, `linkAperto`, `linkAperture`, `videoInviato`, `videoMin`, `mailAperta`, `smsInviato`, `waInviato`, `iscrizioneInit`, `iscrizioneComp`, `iscrizioneAt`).

- [ ] **Step 6: Lanciare test e typecheck**

```bash
pnpm --filter piattaforma test -- tracking-non-scrivibile.test.ts
pnpm --filter piattaforma typecheck
```

Atteso: test PASS, typecheck PASS. Il typecheck è il vero controllo di completezza: segnala ogni riferimento residuo ai campi rimossi.

- [ ] **Step 7: Lanciare la suite intera**

```bash
pnpm --filter piattaforma test
```

Atteso: PASS. Se un test esistente costruiva un `CrmContactInput` con i campi tracking, va ripulito qui.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/actions.ts apps/piattaforma/src/app/admin/crm/contatti/client.tsx apps/piattaforma/src/app/admin/crm/contatti/tracking-non-scrivibile.test.ts
git commit -m "fix(crm): i campi tracking escono dal form (chiude il lost update)"
```

---

### Task 6: Badge "email rimbalzata" in lista

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx:561` (cella email della riga)

**Interfaces:**
- Consumes: `ContactRow.emailBouncedAt` (Task 2).
- Produces: niente per i task successivi.

- [ ] **Step 1: Sostituire la cella email**

A client.tsx:561, sostituire:

```tsx
                  <td className="px-4 py-2.5 text-pv-slate-700">{c.email ?? '—'}</td>
```

con:

```tsx
                  <td className="px-4 py-2.5 text-pv-slate-700">
                    {c.email ?? '—'}
                    {c.emailBouncedAt && (
                      <span
                        title={c.emailBounceMotivo ?? 'L’indirizzo ha rifiutato l’ultima email'}
                        className="ml-1.5 whitespace-nowrap rounded-full bg-pv-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500"
                      >
                        rimbalzata
                      </span>
                    )}
                  </td>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter piattaforma typecheck
```

Atteso: PASS. `bg-pv-red-50` e `text-pv-red-500` sono entrambi token del design system (`globals.css:27-28`, esposti a Tailwind alle righe 68-69): usarli così com'è.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): badge email rimbalzata nella lista contatti"
```

---

### Task 7: Verifica della firma Svix

**Files:**
- Create: `apps/piattaforma/src/lib/webhooks/resend-signature.ts`
- Create: `apps/piattaforma/src/lib/webhooks/resend-signature.test.ts`
- Modify: `apps/piattaforma/src/env.ts:39` (schema), `:90` (runtimeEnv)
- Modify: `apps/piattaforma/package.json` (dipendenza `svix`)

**Interfaces:**
- Consumes: niente.
- Produces: `verificaFirmaResend(rawBody: string, headers: Record<string, string>, secret: string): unknown | null` — ritorna il payload verificato, `null` se la firma non è valida. Il Task 8 la usa nella route.

- [ ] **Step 1: Installare `svix`**

```bash
pnpm --filter piattaforma add svix
```

- [ ] **Step 2: Aggiungere la variabile d'ambiente**

In `env.ts`, nello schema server (accanto a `STRIPE_WEBHOOK_SECRET`):

```ts
    RESEND_WEBHOOK_SECRET: z.string().optional(),
```

E nel blocco `runtimeEnv`:

```ts
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
```

Opzionale come lo Stripe: senza segreto il webhook risponde "non configurato", non rompe il build.

- [ ] **Step 3: Scrivere il test che fallisce**

Creare `apps/piattaforma/src/lib/webhooks/resend-signature.test.ts`. La firma di prova è costruita **a mano** con lo schema Svix documentato, non con la libreria: così il test verifica davvero che il modulo accetti firme Svix reali, invece di limitarsi a un round-trip con sé stesso.

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verificaFirmaResend } from './resend-signature';

// Segreto d'esempio della documentazione Svix (formato `whsec_<base64>`).
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

/**
 * Schema Svix: si firma `${id}.${timestamp}.${body}` con HMAC-SHA256, usando
 * come chiave i byte base64-decodificati del segreto (senza il prefisso
 * `whsec_`). L'header porta `v1,<firma base64>`.
 */
function headersFirmati(body: string, id = 'msg_test'): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const firma = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${firma}`,
  };
}

describe('verificaFirmaResend', () => {
  const body = JSON.stringify({ type: 'email.opened', data: { email_id: 'e1' } });

  it('accetta una firma valida e ritorna il payload', () => {
    const out = verificaFirmaResend(body, headersFirmati(body), SECRET);
    expect(out).toMatchObject({ type: 'email.opened' });
  });

  it('rifiuta se il body è stato alterato di un byte', () => {
    const headers = headersFirmati(body);
    const out = verificaFirmaResend(body.replace('e1', 'e2'), headers, SECRET);
    expect(out).toBeNull();
  });

  it('rifiuta headers assenti o spazzatura senza lanciare', () => {
    expect(verificaFirmaResend(body, {}, SECRET)).toBeNull();
    expect(
      verificaFirmaResend(
        body,
        { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,zzz' },
        SECRET,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 4: Lanciare il test e verificare che fallisca**

```bash
pnpm --filter piattaforma test -- resend-signature.test.ts
```

Atteso: FAIL — il modulo non esiste.

- [ ] **Step 5: Scrivere il modulo**

Creare `apps/piattaforma/src/lib/webhooks/resend-signature.ts`:

```ts
import 'server-only';
import { Webhook } from 'svix';

/**
 * Verifica la firma Svix di un webhook Resend (header `svix-id`,
 * `svix-timestamp`, `svix-signature`).
 *
 * Sta in un modulo suo perché la route non deve sapere nulla di crittografia:
 * qui c'è l'unico punto in cui si decide se un payload è autentico, ed è
 * testabile in isolamento. `svix` gestisce anche la tolleranza sul timestamp,
 * quindi un replay vecchio viene rifiutato senza codice nostro.
 *
 * Ritorna il payload verificato, oppure `null` — mai un throw: il chiamante
 * deve poter rispondere 401 senza avvolgere tutto in un try.
 */
export function verificaFirmaResend(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): unknown | null {
  try {
    return new Webhook(secret).verify(rawBody, headers);
  } catch (e) {
    // Il messaggio della libreria distingue cause opposte: segreto vuoto o
    // base64 rotto (misconfigurazione), timestamp troppo vecchio (replay o
    // clock disallineato), firma non corrispondente (payload non autentico).
    // Senza questo log collassano tutte in `null`, e un `whsec_` sbagliato in
    // produzione diventa indistinguibile da un attacco: 401 identici, nessun
    // segnale, e il tracking aperture muore in silenzio. Si logga SOLO il
    // messaggio della libreria — mai body, header o segreto — così nessun
    // dato controllato dall'attaccante finisce nei log.
    console.warn(
      '[resend-webhook] firma rifiutata:',
      e instanceof Error ? e.message : 'errore sconosciuto',
    );
    return null;
  }
}
```

- [ ] **Step 6: Lanciare il test**

```bash
pnpm --filter piattaforma test -- resend-signature.test.ts
```

Atteso: PASS su tutti e tre.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/lib/webhooks apps/piattaforma/src/env.ts apps/piattaforma/package.json pnpm-lock.yaml
git commit -m "feat(crm): verifica firma Svix per i webhook Resend"
```

---

### Task 8: Handler del webhook + route

**Files:**
- Create: `apps/piattaforma/src/lib/jobs/resend-webhook.ts`
- Create: `apps/piattaforma/src/lib/jobs/resend-webhook.test.ts`
- Create: `apps/piattaforma/src/app/api/webhooks/resend/route.ts`
- Modify: `apps/piattaforma/src/lib/auth/permessi/mappa-api.ts:56-58`

**Interfaces:**
- Consumes: `NotificaInviata.crmContactId` (Task 1), `sendNotification` che lo popola (Task 3), `verificaFirmaResend` (Task 7).
- Produces: `handleResendEvent(evento: unknown): Promise<void>`.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `apps/piattaforma/src/lib/jobs/resend-webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notificaFindFirst = vi.fn();
const notificaUpdate = vi.fn();
const contactFindUnique = vi.fn();
const contactUpdate = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    notificaInviata: {
      findFirst: (...a: unknown[]) => notificaFindFirst(...a),
      update: (...a: unknown[]) => notificaUpdate(...a),
    },
    crmContact: {
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
  },
}));

import { handleResendEvent } from './resend-webhook';

const opened = (tags: Record<string, string> = { categoria: 'N26_EMAIL_PARTENZA' }) => ({
  type: 'email.opened',
  data: { email_id: 'em-1', tags },
});

const bounced = (subType: string) => ({
  type: 'email.bounced',
  data: {
    email_id: 'em-1',
    tags: { categoria: 'N26_EMAIL_PARTENZA' },
    bounce: { subType, message: 'mailbox unavailable' },
  },
});

describe('handleResendEvent', () => {
  beforeEach(() => {
    notificaFindFirst.mockReset();
    notificaUpdate.mockReset();
    contactFindUnique.mockReset();
    contactUpdate.mockReset();
    notificaFindFirst.mockResolvedValue({ id: 'n1', crmContactId: 'c1', readAt: null });
    contactFindUnique.mockResolvedValue({ id: 'c1', mailApertaAt: null });
    contactUpdate.mockResolvedValue({});
    notificaUpdate.mockResolvedValue({});
  });

  it('email.opened accende mailAperta e fissa la data', async () => {
    await handleResendEvent(opened());
    const data = contactUpdate.mock.calls[0][0].data;
    expect(data.mailAperta).toBe(true);
    expect(data.mailApertaAt).toBeInstanceOf(Date);
  });

  // Svix ritenta finché non riceve 200: lo stesso evento arriva più volte.
  it('una seconda apertura non sposta la data della prima', async () => {
    const prima = new Date('2026-08-01T09:00:00Z');
    contactFindUnique.mockResolvedValue({ id: 'c1', mailApertaAt: prima });
    await handleResendEvent(opened());
    expect(contactUpdate.mock.calls[0][0].data.mailApertaAt).toEqual(prima);
  });

  // La garanzia anti-contaminazione: una mail transazionale aperta da una
  // persona che è anche un contatto CRM non deve sporcare il funnel.
  it("ignora le email che non sono l'email di partenza", async () => {
    await handleResendEvent(opened({ categoria: 'N3_PRATICA_ACCETTATA' }));
    expect(notificaFindFirst).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('ignora i tipi di evento non gestiti', async () => {
    await handleResendEvent({ type: 'email.delivered', data: { email_id: 'em-1' } });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('bounce soft: registrato ma nessun blocco', async () => {
    await handleResendEvent(bounced('soft'));
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("bounce hard: blocca l'indirizzo con il motivo", async () => {
    await handleResendEvent(bounced('hard'));
    const data = contactUpdate.mock.calls[0][0].data;
    expect(data.emailBouncedAt).toBeInstanceOf(Date);
    expect(data.emailBounceMotivo).toBe('mailbox unavailable');
  });

  it('providerRef sconosciuto: nessuna scrittura, nessuna eccezione', async () => {
    notificaFindFirst.mockResolvedValue(null);
    await expect(handleResendEvent(opened())).resolves.toBeUndefined();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('payload malformato: non lancia', async () => {
    await expect(handleResendEvent(null)).resolves.toBeUndefined();
    await expect(handleResendEvent({ type: 'email.opened' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

```bash
pnpm --filter piattaforma test -- resend-webhook.test.ts
```

Atteso: FAIL — il modulo non esiste.

- [ ] **Step 3: Scrivere l'handler**

Creare `apps/piattaforma/src/lib/jobs/resend-webhook.ts`:

```ts
import 'server-only';
import { prisma } from '@pv/db';

/**
 * Solo l'email di partenza CRM alimenta il funnel. Il tag `categoria` lo mette
 * già `ResendEmailProvider` a ogni invio (valore = NotificaTipo) e Resend lo
 * rimanda nel payload del webhook: senza questo filtro, una qualsiasi email
 * transazionale aperta da una persona che è anche un contatto CRM
 * accenderebbe `mailAperta`.
 */
const CATEGORIA_EMAIL_PARTENZA = 'N26_EMAIL_PARTENZA';
const MOTIVO_MAX = 500;

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    tags?: Record<string, string>;
    bounce?: { subType?: string; message?: string };
  };
};

/**
 * Applica un evento Resend già verificato al contatto CRM corrispondente.
 *
 * Idempotente per costruzione: le date di primo evento non vengono mai
 * sovrascritte, così la ripetizione di un evento (Svix ritenta finché non
 * riceve 200) è innocua senza bisogno di una tabella di deduplica.
 */
export async function handleResendEvent(evento: unknown): Promise<void> {
  const e = (evento ?? {}) as ResendEvent;
  const tipo = e.type;
  if (tipo !== 'email.opened' && tipo !== 'email.bounced') return;
  if (e.data?.tags?.categoria !== CATEGORIA_EMAIL_PARTENZA) return;

  const emailId = e.data?.email_id;
  if (!emailId) return;

  const notifica = await prisma.notificaInviata.findFirst({
    where: { providerRef: emailId },
    select: { id: true, crmContactId: true, readAt: true },
  });
  if (!notifica?.crmContactId) return;

  const contatto = await prisma.crmContact.findUnique({
    where: { id: notifica.crmContactId },
    select: { id: true, mailApertaAt: true },
  });
  if (!contatto) return;

  const ora = new Date();

  if (tipo === 'email.opened') {
    await prisma.crmContact.update({
      where: { id: contatto.id },
      data: { mailAperta: true, mailApertaAt: contatto.mailApertaAt ?? ora },
    });
    if (!notifica.readAt) {
      await prisma.notificaInviata.update({
        where: { id: notifica.id },
        data: { readAt: ora },
      });
    }
    return;
  }

  // Solo i bounce definitivi bloccano: casella piena o server temporaneamente
  // giù (`soft`) non devono impedire il reinvio a un cliente valido.
  const subType = e.data?.bounce?.subType?.toLowerCase();
  if (!subType) {
    console.warn('[resend-webhook] bounce senza subType, ignorato', emailId);
    return;
  }
  if (subType !== 'hard') return;

  await prisma.crmContact.update({
    where: { id: contatto.id },
    data: {
      emailBouncedAt: ora,
      emailBounceMotivo: (e.data?.bounce?.message ?? '').slice(0, MOTIVO_MAX) || null,
    },
  });
}
```

- [ ] **Step 4: Lanciare i test**

```bash
pnpm --filter piattaforma test -- resend-webhook.test.ts
```

Atteso: PASS su tutti e otto.

- [ ] **Step 5: Scrivere la route**

Creare `apps/piattaforma/src/app/api/webhooks/resend/route.ts`:

```ts
import { env } from '@/env';
import { verificaFirmaResend } from '@/lib/webhooks/resend-signature';
import { handleResendEvent } from '@/lib/jobs/resend-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return new Response('Webhook non configurato', { status: 400 });
  }

  // Raw body obbligatorio: la firma è calcolata sui byte esatti.
  const body = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  const evento = verificaFirmaResend(body, headers, env.RESEND_WEBHOOK_SECRET);
  if (!evento) return new Response('Firma non valida', { status: 401 });

  try {
    await handleResendEvent(evento);
  } catch (e) {
    // 200 anche in errore applicativo: un 5xx farebbe ritentare a Svix per ore
    // un evento che non andrà mai a buon fine (contatto eliminato, ecc.).
    console.error('[resend-webhook] handler error', (e as Error).message);
  }
  return new Response('ok', { status: 200 });
}
```

- [ ] **Step 6: Registrare la route nella mappa permessi**

In `mappa-api.ts`, nella sezione `// --- Webhook / diagnostica / metadati, nessun dato azienda ---`, accanto alla voce Stripe:

```ts
  'src/app/api/webhooks/resend/route.ts': null, // autenticato via firma Svix (RESEND_WEBHOOK_SECRET), non da un permesso
```

Aggiornare anche il conteggio nel commento in testa al file. ⚠️ Il numero scritto lì (33) era **già disallineato** prima di questo lavoro: le route reali sono 38 dopo l'aggiunta. **Contare, non incrementare** — sia i file `route.ts` sotto `src/app/api` sia le chiavi di `MAPPA_API`, e verificare che i due numeri combacino (se non combaciano, c'è una route scoperta, ed è quello il problema serio).

- [ ] **Step 7: Lanciare la suite e il typecheck**

```bash
pnpm --filter piattaforma test
pnpm --filter piattaforma typecheck
```

Atteso: PASS. `mappa-api.test.ts` in particolare deve passare: fallisce se la route non è mappata.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/jobs/resend-webhook.ts apps/piattaforma/src/lib/jobs/resend-webhook.test.ts apps/piattaforma/src/app/api/webhooks/resend apps/piattaforma/src/lib/auth/permessi/mappa-api.ts
git commit -m "feat(crm): webhook Resend per mail aperta e indirizzo rimbalzato"
```

---

### Task 9: Il bounce blocca il reinvio, la correzione lo sblocca

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts:728-733` (guardie invio), `:291-321` (update)
- Test: `apps/piattaforma/src/app/admin/crm/contatti/email-partenza.action.test.ts`, `apps/piattaforma/src/app/admin/crm/contatti/tracking-non-scrivibile.test.ts`

**Interfaces:**
- Consumes: `CrmContact.emailBouncedAt` (Task 1), scritto dal Task 8.
- Produces: niente per i task successivi.

- [ ] **Step 1: Scrivere i test che falliscono**

In `email-partenza.action.test.ts`:

```ts
  it("errore se l'indirizzo ha rimbalzato", async () => {
    findUnique.mockResolvedValue({
      id: 'c1', cat: 'BROKER', status: 'S4', email: 'a@b.it',
      emailOptOutAt: null, nome: 'X', emailUnsubToken: null, companyId: null,
      emailBouncedAt: new Date(),
    });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', messaggio: MSG });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('rifiutato') });
    expect(sendNotification).not.toHaveBeenCalled();
  });
```

In `tracking-non-scrivibile.test.ts`, un nuovo `describe`:

```ts
describe("updateCrmContactAction — il bounce si azzera correggendo l'email", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    update.mockResolvedValue({});
  });

  const base = {
    nome: 'Autofficina Rossi', cat: 'BROKER', tel: '3331234567',
    status: 'S4', fonte: 'CSV',
  };

  it('email cambiata: azzera emailBouncedAt e il motivo', async () => {
    findUnique.mockResolvedValue({
      assignedToId: null, status: 'S4', arricchitoDa: null,
      email: 'vecchia@b.it', emailBouncedAt: new Date(),
    });
    await updateCrmContactAction('c1', { ...base, email: 'nuova@b.it' });
    const data = update.mock.calls[0][0].data;
    expect(data.emailBouncedAt).toBeNull();
    expect(data.emailBounceMotivo).toBeNull();
  });

  it('email invariata: il blocco resta', async () => {
    findUnique.mockResolvedValue({
      assignedToId: null, status: 'S4', arricchitoDa: null,
      email: 'vecchia@b.it', emailBouncedAt: new Date(),
    });
    await updateCrmContactAction('c1', { ...base, email: 'vecchia@b.it' });
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('emailBouncedAt');
  });
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

```bash
pnpm --filter piattaforma test -- email-partenza.action.test.ts tracking-non-scrivibile.test.ts
```

Atteso: FAIL sui tre nuovi.

- [ ] **Step 3: Bloccare l'invio su bounce**

In `sendEmailPartenzaAction`, aggiungere `emailBouncedAt: true` al `select` del `findUnique` del contatto, e subito dopo la guardia `emailOptOutAt`:

```ts
  if (contact.emailOptOutAt)
    return { ok: false, error: 'Il contatto si è disiscritto dalle email.' };
  // Un indirizzo che ha rimbalzato in modo definitivo non va ritentato: Resend
  // penalizza la reputazione del dominio se il tasso di bounce sale. Il rimedio
  // è correggere l'email, che azzera il blocco da sola (updateCrmContactAction).
  if (contact.emailBouncedAt) {
    return {
      ok: false,
      error: 'L’indirizzo ha rifiutato l’ultima email: correggilo prima di riprovare.',
    };
  }
```

- [ ] **Step 4: Azzerare il blocco al cambio email**

In `updateCrmContactAction`, aggiungere **solo** `emailBouncedAt: true` al `select` del `findUnique` iniziale: `email` arriva già da `SELECT_ARRICCHIMENTO` (`lib/crm/match/arricchimento.ts:34-38`), riscriverla darebbe una chiave duplicata.

Poi, dopo la riga `Object.assign(data, campiRichiamoDopoCambioStato(...))`:

```ts
  // Correggere l'indirizzo È il rimedio al bounce: non serve un pulsante
  // "sblocca". Il confronto è sul valore come finisce sul DB — si legge `data`,
  // che dataFromInput ha già normalizzato (lowercase, '' → null), non l'input
  // grezzo. Stessa ragione per cui lo fa il blocco arricchimento qui sotto.
  const emailScritta = typeof data.email === 'string' ? data.email : null;
  if (attuale?.emailBouncedAt && emailScritta !== attuale.email) {
    data.emailBouncedAt = null;
    data.emailBounceMotivo = null;
  }
```

`data.email` è tipato `string | null | Prisma.StringFieldUpdateOperationsInput`: il `typeof` non è difensivismo, senza quello il confronto non compila.

- [ ] **Step 5: Lanciare i test**

```bash
pnpm --filter piattaforma test -- email-partenza.action.test.ts tracking-non-scrivibile.test.ts
```

Atteso: PASS su tutti i file.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/actions.ts apps/piattaforma/src/app/admin/crm/contatti/email-partenza.action.test.ts apps/piattaforma/src/app/admin/crm/contatti/tracking-non-scrivibile.test.ts
git commit -m "feat(crm): il bounce definitivo blocca il reinvio, correggere l'email lo sblocca"
```

---

### Task 10: Iscrizione iniziata dallo step Account

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts:873-892` (`checkEmailDisponibileAction`)
- Test: `apps/piattaforma/src/app/(auth)/iscrizione-init.test.ts` (nuovo)

**Interfaces:**
- Consumes: `CrmContact.iscrizioneInit`, `iscrizioneInitAt` (Task 1); `statoFattuale` che li legge (Task 2).
- Produces: niente per i task successivi.

Il punto di aggancio è corretto: l'action è chiamata al click su "Avanti" dello step Account (`register-wizard.tsx:606`), **una volta per tentativo**, non a ogni tasto.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `apps/piattaforma/src/app/(auth)/iscrizione-init.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/rate-limit/durable', () => ({
  rateLimit: () => Promise.resolve({ allowed: true }),
  resetRateLimit: () => Promise.resolve(),
}));
vi.mock('@/lib/rate-limit/client-ip', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/auth/email-univoca', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  emailGiaInUso: () => Promise.resolve(false),
}));

const updateMany = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: { crmContact: { updateMany: (...a: unknown[]) => updateMany(...a) } },
}));

import { checkEmailDisponibileAction } from './actions';

describe('checkEmailDisponibileAction — accende iscrizioneInit', () => {
  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('marca il contatto CRM corrispondente', async () => {
    const res = await checkEmailDisponibileAction('Mario@Rossi.IT');
    expect(res).toEqual({ disponibile: true });
    const args = updateMany.mock.calls[0][0];
    expect(args.where.emailNorm).toBe('mario@rossi.it');
    expect(args.where.iscrizioneComp).toBe(false);
    expect(args.where.deletedAt).toBeNull();
    // "Vince la prima data": chi ce l'ha già non deve nemmeno matchare.
    expect(args.where.iscrizioneInitAt).toBeNull();
    expect(args.data.iscrizioneInit).toBe(true);
    expect(args.data.iscrizioneInitAt).toBeInstanceOf(Date);
  });

  // Il CRM è un effetto collaterale: se cade, la registrazione prosegue.
  it("se il CRM lancia, l'action risponde comunque", async () => {
    updateMany.mockRejectedValue(new Error('db giù'));
    await expect(checkEmailDisponibileAction('mario@rossi.it')).resolves.toEqual({
      disponibile: true,
    });
  });

  it('email malformata: nessuna scrittura', async () => {
    await checkEmailDisponibileAction('');
    expect(updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lanciare i test e verificare che falliscano**

```bash
pnpm --filter piattaforma test -- iscrizione-init.test.ts
```

Atteso: FAIL — `updateMany` non viene mai chiamata.

- [ ] **Step 3: Implementare**

In `app/(auth)/actions.ts`, dentro `checkEmailDisponibileAction`, dopo il check `emailGiaInUso` e prima del `return { disponibile: true }` finale:

```ts
  await segnaIscrizioneIniziataCrm(emailLower);
  return { disponibile: true };
}

/**
 * Funnel CRM: chi arriva allo step successivo dell'Account ha *iniziato*
 * l'iscrizione. Marca il contatto corrispondente (match sull'email, come già
 * fa la riconciliazione per l'iscrizione completata), così lo stato S6
 * "Iscrizione incompleta" smette di essere irraggiungibile.
 *
 * `updateMany` e non `update`: la where non è su una chiave unica, e più
 * contatti possono condividere l'email (una persona, due aziende).
 *
 * Best-effort assoluto: un errore del CRM non deve MAI bloccare una
 * registrazione in corso.
 */
async function segnaIscrizioneIniziataCrm(emailLower: string): Promise<void> {
  try {
    await prisma.crmContact.updateMany({
      // `iscrizioneInitAt: null` nella where, non solo nei data: senza, ogni
      // tentativo dello step Account risposterebbe la data in avanti e la
      // regola "vince la prima" sarebbe violata. Con questa clausola il
      // secondo tentativo semplicemente non matcha.
      where: {
        emailNorm: emailLower,
        deletedAt: null,
        iscrizioneComp: false,
        iscrizioneInitAt: null,
      },
      data: { iscrizioneInit: true, iscrizioneInitAt: new Date() },
    });
  } catch (e) {
    console.warn('[crm] iscrizioneInit non aggiornato', (e as Error).message);
  }
}
```

- [ ] **Step 4: Lanciare i test**

```bash
pnpm --filter piattaforma test -- iscrizione-init.test.ts
```

Atteso: PASS su tutti e tre.

- [ ] **Step 5: Lanciare la suite completa e il typecheck**

```bash
pnpm --filter piattaforma test
pnpm --filter piattaforma typecheck
```

Atteso: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/piattaforma/src/app/(auth)/actions.ts" "apps/piattaforma/src/app/(auth)/iscrizione-init.test.ts"
git commit -m "feat(crm): iscrizione iniziata dallo step Account del wizard"
```

---

### Task 11: Verifica sul browser e checklist di rilascio

**Files:** nessuna modifica di codice attesa (se emergono bug, si correggono qui).

**Interfaces:**
- Consumes: tutto.
- Produces: la conferma che quello che i test dicono è anche ciò che si vede.

I test non vedono i bug React, e il DOM non è deducibile dai byte del sorgente. Questa verifica non è opzionale.

- [ ] **Step 1: Avviare l'app**

```bash
pnpm --filter piattaforma dev
```

⚠️ Se la porta 3000 serve codice vecchio, c'è un dev server zombie: va ucciso il processo Node, non basta fermare il task.

- [ ] **Step 2: Verificare il tab referto**

Login admin → `/admin/crm/contatti` → aprire un contatto che ha ricevuto l'email di partenza → tab "Tracking & Pixel". Controllare **nel DOM**, non a occhio:
- non esiste nessun `<input>` o `<select>` dentro il pannello;
- le righe Video / SMS / WhatsApp non ci sono più;
- la nota introduttiva è leggibile e **non ha parole incollate** (JSX mangia gli spazi fra tag e testo);
- la timeline "Storico fatti" è ancora al suo posto.

- [ ] **Step 3: Verificare che il salvataggio non azzeri più nulla**

Con la scheda di un contatto che ha `linkAperture > 0`: aprire la modale, cambiare una nota nel tab Anagrafica, salvare, riaprire. Il numero di aperture deve essere **invariato**. È il bug di partenza: se qui torna a zero, il Task 5 non è completo.

- [ ] **Step 4: Verificare il badge in lista**

Su un contatto con `emailBouncedAt` valorizzato a mano sul DB locale:

```bash
docker exec -i pv-postgres psql -U pv -d passaggio_veloce -c "UPDATE crm_contacts SET \"emailBouncedAt\" = now(), \"emailBounceMotivo\" = 'mailbox unavailable' WHERE id = '<id>';"
```

Ricaricare la lista: badge "rimbalzata" accanto all'email, e nel tab la riga rossa. Poi correggere l'email dalla scheda e salvare: il badge sparisce.

- [ ] **Step 5: Ripristinare il dato di prova**

```bash
docker exec -i pv-postgres psql -U pv -d passaggio_veloce -c "UPDATE crm_contacts SET \"emailBouncedAt\" = NULL, \"emailBounceMotivo\" = NULL WHERE id = '<id>';"
```

- [ ] **Step 6: Scrivere la checklist di rilascio**

Aggiungere in coda alla spec (`docs/superpowers/specs/2026-08-06-crm-tracking-automatico-design.md`) una sezione "Stato del rilascio" con le voci da spuntare a mano, che **non** sono automatizzabili:

1. Resend → Webhooks: endpoint `https://<app>/api/webhooks/resend`, eventi `email.opened` + `email.bounced`.
2. Resend → dominio: **abilitare l'open tracking** (senza, `email.opened` non arriva mai).
3. ⚠️ Resend → dominio: **NON abilitare il click tracking** — riscrive gli URL nelle email e falserebbe il conteggio aperture, che passa già da `/i/<token>`.
4. `RESEND_WEBHOOK_SECRET` su Vercel (production).
5. Migration applicata a mano su Neon **prima** del deploy.
6. Voce LIA aperta: l'open tracking è un trattamento nuovo, da riconciliare con il documento legale.

- [ ] **Step 7: Commit finale**

```bash
git add docs/superpowers/specs/2026-08-06-crm-tracking-automatico-design.md
git commit -m "docs(crm): checklist di rilascio del tracking automatico"
```

---

## Note per chi implementa

**Il conteggio aperture del link e la mail aperta sono cose diverse.** `linkAperture` conta i click sul link tracciato `/i/<token>` (segnale forte, è un'azione umana). `mailAperta` viene dal pixel (segnale debole). Non vanno mai sommati né presentati come la stessa metrica.

**I contatti marcati a mano finora non hanno `invitoToken`.** Restano fuori dal funnel automatico anche dopo questo lavoro: il tracking vale da qui in avanti, non retroattivamente. Non serve un backfill — non esiste una fonte da cui ricostruire il dato.

**Se `bounce.subType` non arriva nel payload reale**, l'handler logga `[resend-webhook] bounce senza subType` e non blocca nulla (fail-safe corretto). In quel caso, confrontare il payload vero con la doc e correggere il path del campo: è l'unico punto del piano che dipende da una forma di payload non verificata su dati reali.
