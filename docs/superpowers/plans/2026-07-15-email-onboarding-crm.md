# Email di partenza CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'admin CRM un tasto "Invia email di partenza" per riga contatto che manda al lead (broker/agenzia) un'email di onboarding con checklist documenti e un link `/i/<token>` che precompila la registrazione, opzionalmente con un codice welcome.

**Architecture:** Riusa il modello `CrmContact` (aggiungendo 4 colonne), il sistema notifiche (`sendNotification` + nuovo template N26), il pattern del link tracciato `/r/[code]` (nuova route gemella `/i/[token]`), e il campo promo del wizard (auto-apply da `?promo=`). Nessuna tabella nuova: lo storico invii vive in `NotificaInviata`.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Postgres, vitest, TypeScript, Tailwind (design system pv-*), Resend (via provider astratto).

## Global Constraints

- **Node:** usare `nvm use 22.15.0` prima di qualunque comando pnpm (post-riavvio la shell torna a Node 16).
- **Migration:** SEMPRE a mano + `pnpm --filter @pv/db db:deploy`. MAI `db:migrate` (`prisma migrate dev` è distruttivo: propone DROP SEQUENCE). Naming cartella: `packages/db/prisma/migrations/YYYYMMDDHHMMSS_<slug>/migration.sql`.
- **Test runner:** `pnpm --filter piattaforma test` (vitest run). Singolo file: `pnpm --filter piattaforma test -- <path>`.
- **Notifica N26:** riusa il numero libero N26 (N26–N30 sono liberi nell'enum). 4 tocchi per una notifica: enum `schema.prisma` → `type`+`tpl` in `templates.ts` → variante `SendInput` in `send.ts` → `case` nello `switch render()` in `send.ts`.
- **Nessun dato commerciale nell'email** oltre al credito welcome: niente prezzi pratica, niente soglie payout (landing e Termini oggi si contraddicono su quel numero).
- **`sendNotification` non blocca mai il chiamante**: fire-and-log. L'esito email si legge dal ritorno solo se serve gate-are le mutazioni (vedi Task 6).
- **Escape HTML:** ogni dato dinamico che entra nell'HTML passa da `escapeHtml` (`@/lib/escape-html`), come negli altri template.
- **Copy CTA/contesto verbatim** (dalla spec):
  - Broker CTA: `Registra la tua concessionaria` · dest `/register/dealer`
  - Agenzia CTA: `Registra la tua agenzia` · dest `/register/agenzia`
  - Contesto broker: `Carichi la pratica in 2 minuti, un'agenzia della tua zona la prende in carico e la segui in tempo reale.`
  - Contesto agenzia: `Ricevi pratiche già complete e verificate dalla tua provincia, e decidi tu quali accettare.`

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/20260715120000_crm_email_partenza/migration.sql` — 4 colonne su `crm_contacts` + FK a `promo_codes`.
- `apps/piattaforma/src/app/i/[token]/route.ts` — route redirect+tracking del link invito.
- `apps/piattaforma/src/lib/crm/email-partenza.ts` — helper puri: regola avanza-non-declassa sullo stato (S4 su invio, S5 su apertura).
- `apps/piattaforma/src/lib/crm/email-partenza.test.ts` — unit dei puri.
- `apps/piattaforma/src/app/i/[token]/route.test.ts` — test della route (opzionale ma incluso).

**Modify:**
- `packages/db/prisma/schema.prisma` — modello `CrmContact` (4 campi + relazione), `PromoCode` (back-relation), enum `NotificaTipo` (+N26).
- `apps/piattaforma/src/lib/notifiche/templates.ts` — `type N26EmailPartenzaPayload` + `tplN26EmailPartenza()`.
- `apps/piattaforma/src/lib/notifiche/templates.test.ts` — test del template N26.
- `apps/piattaforma/src/lib/notifiche/send.ts` — variante `SendInput` + `case` nello switch + import.
- `apps/piattaforma/src/app/admin/crm/contatti/actions.ts` — `sendEmailPartenzaAction` + `listPromoCodesValidiAction`.
- `apps/piattaforma/src/app/admin/crm/contatti/page.tsx` — passare i codici promo validi + campi nuovi al client.
- `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` — bottone riga + modale d'invio.
- `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` — leggere `?promo=`, passarlo a `PaymentStep`, auto-apply su mount.
- `apps/piattaforma/src/app/unsubscribe/page.tsx` — ramo lead via `emailUnsubToken`.

---

## Task 1: Migration + schema — 4 colonne su CrmContact, +N26

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (modello `CrmContact` ~1839, `PromoCode` ~2054, enum `NotificaTipo` ~289)
- Create: `packages/db/prisma/migrations/20260715120000_crm_email_partenza/migration.sql`

**Interfaces:**
- Produces: campi Prisma `CrmContact.invitoToken: string|null`, `CrmContact.emailUnsubToken: string|null`, `CrmContact.promoCodeInviatoId: string|null`, `CrmContact.emailOptOutAt: Date|null`, relazione `CrmContact.promoCodeInviato: PromoCode|null`; enum value `NotificaTipo.N26_EMAIL_PARTENZA`.

- [ ] **Step 1: Aggiungere i campi al modello `CrmContact`**

Nel blocco `model CrmContact` (`schema.prisma`), dopo il gruppo "Match con Company piattaforma" e prima di `createdAt`, aggiungere:

```prisma
  // Email di partenza CRM (onboarding post-telefonata)
  invitoToken        String?    @unique // token opaco del link /i/<token>, riscritto a ogni reinvio
  emailUnsubToken    String?    @unique // token STABILE per l'unsubscribe del lead (mai riscritto)
  emailOptOutAt      DateTime? // disiscrizione del lead → blocca invii futuri
  promoCodeInviatoId String?    @db.Uuid // ultimo PromoCode welcome inviato
  promoCodeInviato   PromoCode? @relation("CrmContactPromoInviato", fields: [promoCodeInviatoId], references: [id], onDelete: SetNull)
```

Aggiungere anche l'indice nel blocco `@@index` esistente del modello:

```prisma
  @@index([promoCodeInviatoId])
```

- [ ] **Step 2: Back-relation su `PromoCode`**

Nel blocco `model PromoCode` (`schema.prisma:2054`), aggiungere la relazione inversa fra gli altri campi relazionali:

```prisma
  crmContattiInviati CrmContact[] @relation("CrmContactPromoInviato")
```

- [ ] **Step 3: Aggiungere il valore all'enum `NotificaTipo`**

In `enum NotificaTipo`, dopo `N25_MONTHLY_AFFILIATION_RECAP` e prima di `N31_VALUTA_AGENZIA`:

```prisma
  N26_EMAIL_PARTENZA
```

- [ ] **Step 4: Scrivere la migration SQL a mano**

Create `packages/db/prisma/migrations/20260715120000_crm_email_partenza/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N26_EMAIL_PARTENZA';

-- AlterTable
ALTER TABLE "crm_contacts"
  ADD COLUMN "invitoToken" TEXT,
  ADD COLUMN "emailUnsubToken" TEXT,
  ADD COLUMN "emailOptOutAt" TIMESTAMP(3),
  ADD COLUMN "promoCodeInviatoId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_invitoToken_key" ON "crm_contacts"("invitoToken");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_emailUnsubToken_key" ON "crm_contacts"("emailUnsubToken");

-- CreateIndex
CREATE INDEX "crm_contacts_promoCodeInviatoId_idx" ON "crm_contacts"("promoCodeInviatoId");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_promoCodeInviatoId_fkey" FOREIGN KEY ("promoCodeInviatoId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

> Nota: `ALTER TYPE ... ADD VALUE` non può girare dentro una transazione con altri statement in alcune versioni PG. Prisma esegue ogni migration in una transazione; se `db:deploy` fallisce con _"ALTER TYPE ... ADD VALUE cannot run inside a transaction block"_, splittare in due cartelle migration: prima solo l'`ALTER TYPE`, poi il resto. Verificare nel Step 6.

- [ ] **Step 5: Rigenerare il client Prisma**

Run: `nvm use 22.15.0 && pnpm --filter @pv/db db:generate`
Expected: "Generated Prisma Client" senza errori.

- [ ] **Step 6: Applicare la migration sul DB locale**

Run: `nvm use 22.15.0 && pnpm --filter @pv/db db:deploy`
Expected: "1 migration applied" (o "following migration(s) have been applied"). Se errore ALTER TYPE-in-transaction, applicare lo split descritto nello Step 4 e rilanciare.

- [ ] **Step 7: Verifica colonne sul DB reale**

Run:
```bash
docker exec -i <container-postgres> psql -U postgres -d passaggioveloce -c "\d crm_contacts" | grep -E "invitoToken|emailUnsubToken|emailOptOutAt|promoCodeInviatoId"
```
Expected: 4 righe con le colonne. (Nome container/db: vedi setup locale — memoria "copia locale DB prod". In alternativa `pnpm --filter @pv/db db:studio` e ispezionare il modello.)

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260715120000_crm_email_partenza/
git commit -m "feat(crm): schema email di partenza — 4 colonne su CrmContact + N26"
```

---

## Task 2: Helper puri — payload N26 + regola avanza-non-declassa

**Files:**
- Create: `apps/piattaforma/src/lib/crm/email-partenza.ts`
- Test: `apps/piattaforma/src/lib/crm/email-partenza.test.ts`

**Interfaces:**
- Consumes: niente (helper puri su stringhe di stato).
- Produces:
  - `nextStatoInvio(current: string): string` — ritorna `'S4'` se `current ∈ {S0,S1,S2,S3}`, altrimenti `current` (avanza-non-declassa).
  - `nextStatoApertura(current: string): string` — ritorna `'S5'` se `current ∈ {S0,S1,S2,S3,S4}`, altrimenti `current`.

Il payload N26 NON è costruito qui: il tipo vive in `templates.ts` (Task 3) e l'oggetto viene assemblato inline nell'action (Task 6). Così questo modulo resta puro e senza dipendenze verso il layer notifiche.

- [ ] **Step 1: Scrivere i test (falliscono)**

Create `apps/piattaforma/src/lib/crm/email-partenza.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { nextStatoInvio, nextStatoApertura } from './email-partenza';

describe('nextStatoInvio — avanza-non-declassa', () => {
  it('porta S0..S3 a S4', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3']) {
      expect(nextStatoInvio(s)).toBe('S4');
    }
  });
  it('non declassa stati già avanzati', () => {
    for (const s of ['S5', 'S6', 'S7', 'S8', 'S9']) {
      expect(nextStatoInvio(s)).toBe(s);
    }
  });
  it('non tocca S10 (churned)', () => {
    expect(nextStatoInvio('S10')).toBe('S10');
  });
});

describe('nextStatoApertura — avanza-non-declassa', () => {
  it('porta S0..S4 a S5', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3', 'S4']) {
      expect(nextStatoApertura(s)).toBe('S5');
    }
  });
  it('non declassa S6/S7+', () => {
    for (const s of ['S6', 'S7', 'S8']) {
      expect(nextStatoApertura(s)).toBe(s);
    }
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm --filter piattaforma test -- src/lib/crm/email-partenza.test.ts`
Expected: FAIL — "Cannot find module './email-partenza'".

- [ ] **Step 3: Implementare gli helper**

Create `apps/piattaforma/src/lib/crm/email-partenza.ts`:

```typescript
const STATI_PRE_INVIO = new Set(['S0', 'S1', 'S2', 'S3']);
const STATI_PRE_APERTURA = new Set(['S0', 'S1', 'S2', 'S3', 'S4']);

/** Avanza lo stato a S4 (link inviato) solo se non è un declassamento. */
export function nextStatoInvio(current: string): string {
  return STATI_PRE_INVIO.has(current) ? 'S4' : current;
}

/** Avanza lo stato a S5 (link aperto) solo se non è un declassamento. */
export function nextStatoApertura(current: string): string {
  return STATI_PRE_APERTURA.has(current) ? 'S5' : current;
}
```

- [ ] **Step 4: Verificare che i test passino**

Run: `pnpm --filter piattaforma test -- src/lib/crm/email-partenza.test.ts`
Expected: PASS (modulo puro, nessuna dipendenza esterna).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/email-partenza.ts apps/piattaforma/src/lib/crm/email-partenza.test.ts
git commit -m "feat(crm): helper avanza-non-declassa + build payload email partenza"
```

---

## Task 3: Template email N26

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (aggiunta in coda, prima del barrel/export finale)
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts`

**Interfaces:**
- Consumes: `emailLayout`, `ctaButton` da `./layout`; `escapeHtml` da `@/lib/escape-html`; tipo di ritorno `NotificaContent`.
- Produces:
  - `type N26EmailPartenzaPayload = { nomeReferente: string; ragioneSociale: string; categoria: 'BROKER' | 'AGENZIA'; linkUrl: string; unsubUrl: string; codice?: { code: string; importoEuro: number } }`
  - `function tplN26EmailPartenza(p: N26EmailPartenzaPayload): NotificaContent`

- [ ] **Step 1: Scrivere i test (falliscono)**

In `apps/piattaforma/src/lib/notifiche/templates.test.ts`, aggiungere in fondo (e aggiungere `tplN26EmailPartenza` all'import esistente da `./templates`):

```typescript
describe('N26 email di partenza', () => {
  const base = {
    nomeReferente: 'Mario Rossi',
    ragioneSociale: 'Autosalone Rossi Srl',
    linkUrl: 'https://passaggioveloce.it/i/tok123',
    unsubUrl: 'https://passaggioveloce.it/unsubscribe?token=uns123',
  } as const;

  it('broker: CTA concessionaria + frase di contesto broker', () => {
    const { html, subject, text } = tplN26EmailPartenza({ ...base, categoria: 'BROKER' });
    expect(subject.toLowerCase()).toContain('registrarti');
    expect(html).toContain('Registra la tua concessionaria');
    expect(html).toContain('la prende in carico e la segui in tempo reale');
    expect(html).toContain('https://passaggioveloce.it/i/tok123');
    expect(html).toContain('logo-email.png'); // layout istituzionale
    expect(text).toContain('Autosalone Rossi Srl');
  });

  it('agenzia: CTA agenzia + frase di contesto agenzia', () => {
    const { html } = tplN26EmailPartenza({ ...base, categoria: 'AGENZIA' });
    expect(html).toContain('Registra la tua agenzia');
    expect(html).toContain('già complete e verificate dalla tua provincia');
  });

  it('senza codice: nessun blocco credito, nessun simbolo €', () => {
    const { html, text } = tplN26EmailPartenza({ ...base, categoria: 'BROKER' });
    expect(html).not.toContain('credito di benvenuto');
    expect(text).not.toContain('€');
  });

  it('con codice: blocco credito col codice e importo', () => {
    const { html, text } = tplN26EmailPartenza({
      ...base,
      categoria: 'BROKER',
      codice: { code: 'BENVENUTO50', importoEuro: 50 },
    });
    expect(html).toContain('BENVENUTO50');
    expect(html).toContain('50');
    expect(html).toContain('credito di benvenuto');
    expect(text).toContain('BENVENUTO50');
  });

  it('la checklist documenti è presente', () => {
    const { html } = tplN26EmailPartenza({ ...base, categoria: 'AGENZIA' });
    expect(html).toContain('Visura camerale');
    expect(html).toContain('IBAN');
  });

  it('include il link di disiscrizione (email a freddo)', () => {
    const { html } = tplN26EmailPartenza({ ...base, categoria: 'BROKER' });
    expect(html).toContain('https://passaggioveloce.it/unsubscribe?token=uns123');
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/templates.test.ts`
Expected: FAIL — `tplN26EmailPartenza` non esportato.

- [ ] **Step 3: Implementare tipo + funzione**

In `apps/piattaforma/src/lib/notifiche/templates.ts`, in coda (dopo l'ultima `tpl*`, seguendo il pattern di `tplN40ClienteAvanzamento`):

```typescript
export type N26EmailPartenzaPayload = {
  nomeReferente: string;
  ragioneSociale: string;
  categoria: 'BROKER' | 'AGENZIA';
  linkUrl: string;
  unsubUrl: string;
  codice?: { code: string; importoEuro: number };
};

export function tplN26EmailPartenza(p: N26EmailPartenzaPayload): NotificaContent {
  const isBroker = p.categoria === 'BROKER';
  const ctaLabel = isBroker ? 'Registra la tua concessionaria' : 'Registra la tua agenzia';
  const contesto = isBroker
    ? 'Carichi la pratica in 2 minuti, un’agenzia della tua zona la prende in carico e la segui in tempo reale.'
    : 'Ricevi pratiche già complete e verificate dalla tua provincia, e decidi tu quali accettare.';

  const nome = escapeHtml(p.nomeReferente);
  const rag = escapeHtml(p.ragioneSociale);

  const checklist = [
    'Carta d’identità e tessera sanitaria del titolare (fronte e retro)',
    'Visura camerale in PDF (dal Registro Imprese)',
    'P.IVA, PEC, codice SDI e regime fiscale',
    'IBAN aziendale',
  ];

  const checklistHtml = checklist
    .map(
      (v) =>
        `<li style="margin:0 0 6px;font-size:14px;color:#334155">${escapeHtml(v)}</li>`,
    )
    .join('');

  const codiceHtml = p.codice
    ? `<div style="margin-top:18px;background:#fff7ed;border:1px solid #f59e0b33;border-radius:10px;padding:12px 14px;font-size:14px;color:#0a2540">
        🎁 <strong>Hai ${p.codice.importoEuro} € di credito di benvenuto.</strong><br>
        Il codice <strong>${escapeHtml(p.codice.code)}</strong> è già incluso nel link: lo troverai precompilato all’ultimo passaggio, non devi ricordartelo.
      </div>`
    : '';

  const body = `
    <p style="margin:0 0 12px;font-size:15px;color:#0a2540">Buongiorno ${nome},</p>
    <p style="margin:0 0 12px;font-size:14px;color:#334155">come d’accordo nella nostra telefonata, ecco il link per attivare <strong>${rag}</strong> su Passaggio Veloce. Bastano circa 5 minuti.</p>
    <p style="margin:0 0 18px;font-size:14px;color:#334155">${escapeHtml(contesto)}</p>
    <div style="margin:0 0 18px">${ctaButton(p.linkUrl, ctaLabel)}</div>
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0a2540">Cosa tenere a portata di mano</p>
    <ul style="margin:0 0 4px;padding-left:18px">${checklistHtml}</ul>
    ${codiceHtml}
    <p style="margin:18px 0 0;font-size:13px;color:#64748b">Per qualsiasi cosa trovi i nostri contatti qui sotto.</p>
  `;

  const codiceText = p.codice
    ? `\n\nHai ${p.codice.importoEuro} € di credito di benvenuto. Il codice ${p.codice.code} è già incluso nel link e precompilato all’ultimo passaggio.`
    : '';

  const text = `Buongiorno ${p.nomeReferente},

come d’accordo nella nostra telefonata, ecco il link per attivare ${p.ragioneSociale} su Passaggio Veloce. Bastano circa 5 minuti.

${contesto}

Registrati qui: ${p.linkUrl}

Cosa tenere a portata di mano:
- ${checklist.join('\n- ')}${codiceText}

Per qualsiasi cosa trovi i nostri contatti in fondo all’email.

Per non ricevere più queste email: ${p.unsubUrl}`;

  return {
    subject: 'Passaggio Veloce — il link per registrarti',
    html: emailLayout(body),
    text,
  };
}
```

> Nota unsubscribe: N26 NON passa dal gating preferenze di `sendNotification` (che richiede `userId`). Il link di disiscrizione va quindi messo **direttamente nel corpo `text`** e nel body HTML tramite `unsubUrl`. Per l'HTML: aggiungere in fondo al `body`, prima della chiusura, una riga unsubscribe esplicita (il segnaposto `<!--PV_UNSUB-->` del layout resta non sostituito per N26). Aggiungere quindi al `body` HTML, dopo la riga contatti:
> ```
> <p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">Non vuoi più ricevere queste email? <a href="${escapeHtml(p.unsubUrl)}" style="color:#94a3b8">Disiscriviti</a></p>
> ```

- [ ] **Step 4: Verificare che i test passino**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/templates.test.ts`
Expected: PASS (tutti, inclusi i 6 nuovi N26).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/templates.test.ts
git commit -m "feat(notifiche): template N26 email di partenza broker/agenzia"
```

---

## Task 4: Wiring N26 in send.ts

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts` (import ~50-70, union `SendInput` ~79-195, switch `render()` ~197-260)

**Interfaces:**
- Consumes: `N26EmailPartenzaPayload`, `tplN26EmailPartenza` da `./templates`.
- Produces: `SendInput` accetta `{ tipo: 'N26_EMAIL_PARTENZA'; target: Target; payload: N26EmailPartenzaPayload }`; `render()` lo mappa a `tplN26EmailPartenza`.

- [ ] **Step 1: Import**

Nel blocco import da `'./templates'` (dove sono importati gli altri `type N*Payload` e le `tpl*`), aggiungere:

```typescript
  tplN26EmailPartenza,
  type N26EmailPartenzaPayload,
```

(la funzione `tplN26EmailPartenza` va nell'import delle funzioni, il `type` fra i type import — seguire come è già strutturato l'import file.)

- [ ] **Step 2: Variante nella union `SendInput`**

Nella union `type SendInput`, aggiungere una variante (accanto alle altre, es. dopo N25 o in fondo):

```typescript
  | { tipo: 'N26_EMAIL_PARTENZA'; target: Target; payload: N26EmailPartenzaPayload }
```

- [ ] **Step 3: `case` nello switch `render()`**

In `function render(input: SendInput)`, nello `switch (input.tipo)`, aggiungere:

```typescript
    case 'N26_EMAIL_PARTENZA':
      return tplN26EmailPartenza(input.payload);
```

- [ ] **Step 4: Verifica typecheck del modulo**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/templates.test.ts`
Expected: PASS (nessuna regressione). Per il typecheck completo della union serve la build; qui basta che il modulo importi correttamente. In alternativa: `pnpm --filter piattaforma exec tsc --noEmit -p tsconfig.json` se il tsbuildinfo è caldo (memoria "typecheck cache fredda").

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/send.ts
git commit -m "feat(notifiche): wiring N26 in SendInput + render switch"
```

---

## Task 5: Route `/i/[token]` — redirect + tracking apertura

**Files:**
- Create: `apps/piattaforma/src/app/i/[token]/route.ts`
- Test: `apps/piattaforma/src/app/i/[token]/route.test.ts`

**Interfaces:**
- Consumes: `prisma` da `@pv/db`; `nextStatoApertura` da `@/lib/crm/email-partenza`; `evaluatePromoCode`/`normalizePromoCode` non servono qui (il codice è già stato validato all'invio; qui basta rileggere `promoCodeInviato.code` se il PromoCode è ancora attivo).
- Produces: `GET(req, { params })` → `Response` redirect 302.

- [ ] **Step 1: Scrivere il test (fallisce)**

Create `apps/piattaforma/src/app/i/[token]/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const update = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    crmContact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { GET } from './route';

function req(url = 'https://app.test/i/tok') {
  return new Request(url) as unknown as import('next/server').NextRequest;
}

describe('GET /i/[token]', () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
  });

  it('token valido broker con codice attivo → redirect /register/dealer?promo=CODE', async () => {
    findFirst.mockResolvedValue({
      id: 'c1', cat: 'BROKER', status: 'S4',
      promoCodeInviato: { code: 'BENVENUTO50', active: true, expiresAt: null },
    });
    update.mockResolvedValue({});
    const res = await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/register/dealer');
    expect(loc).toContain('promo=BENVENUTO50');
  });

  it('token valido agenzia senza codice → /register/agenzia senza promo', async () => {
    findFirst.mockResolvedValue({ id: 'c2', cat: 'AGENZIA', status: 'S4', promoCodeInviato: null });
    update.mockResolvedValue({});
    const res = await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/register/agenzia');
    expect(loc).not.toContain('promo=');
  });

  it('token inesistente → /register neutro, nessuna update', async () => {
    findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ token: 'nope' }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/register');
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm --filter piattaforma test -- "src/app/i/[token]/route.test.ts"`
Expected: FAIL — modulo `./route` inesistente.

- [ ] **Step 3: Implementare la route**

Create `apps/piattaforma/src/app/i/[token]/route.ts`:

```typescript
/**
 * Endpoint redirect per il link "email di partenza" CRM.
 * GET /i/<invitoToken>
 *
 * 1. Se il token matcha un CrmContact, marca l'apertura (best-effort:
 *    linkAperto, linkAperture++, status → S5 avanza-non-declassa).
 * 2. Redirige a /register/dealer|agenzia in base a cat, con ?promo=<code>
 *    se il PromoCode inviato è ancora attivo. Il codice NON è nel token.
 * 3. Token invalido → /register neutro (comportamento tollerante come /r).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@pv/db';
import { nextStatoApertura } from '@/lib/crm/email-partenza';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const tok = token.trim().slice(0, 128);
  const origin = new URL(req.url).origin;

  let dest = '/register';
  let promo: string | null = null;

  try {
    const contact = await prisma.crmContact.findFirst({
      where: { invitoToken: tok },
      select: {
        id: true,
        cat: true,
        status: true,
        promoCodeInviato: { select: { code: true, active: true, expiresAt: true } },
      },
    });

    if (contact) {
      dest = contact.cat === 'BROKER' ? '/register/dealer' : '/register/agenzia';

      const pc = contact.promoCodeInviato;
      if (pc && pc.active && (!pc.expiresAt || pc.expiresAt.getTime() > Date.now())) {
        promo = pc.code;
      }

      // Tracking apertura best-effort.
      await prisma.crmContact.update({
        where: { id: contact.id },
        data: {
          linkAperto: true,
          linkAperture: { increment: 1 },
          status: nextStatoApertura(contact.status),
        },
      });
    }
  } catch {
    // best-effort: non blocchiamo il redirect
  }

  const url = new URL(dest, origin);
  if (promo) url.searchParams.set('promo', promo);
  return NextResponse.redirect(url, 302);
}
```

> Nota: `Date.now()` è consentito nella route runtime (il divieto vale solo negli script Workflow). Nel test è deterministico perché `expiresAt: null`.

- [ ] **Step 4: Verificare che i test passino**

Run: `pnpm --filter piattaforma test -- "src/app/i/[token]/route.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add "apps/piattaforma/src/app/i/[token]/route.ts" "apps/piattaforma/src/app/i/[token]/route.test.ts"
git commit -m "feat(crm): route /i/[token] redirect+tracking apertura link partenza"
```

---

## Task 6: Server action d'invio + lista codici validi

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts`

**Interfaces:**
- Consumes: `auth`, `canEditCrmContact` (già importati/usati in `actions.ts`); `prisma`; `sendNotification` da `@/lib/notifiche`; `nextStatoInvio` da `@/lib/crm/email-partenza`; `evaluatePromoCode` da `@/lib/promo/evaluate`; `BRAND` da `@/lib/seo/brand`. Il payload N26 (`N26EmailPartenzaPayload`) è tipato implicitamente dalla variante `SendInput` — costruito inline.
- Produces:
  - `listPromoCodesValidiAction(): Promise<Array<{ id: string; code: string; importoEuro: number }>>`
  - `sendEmailPartenzaAction(input: { contactId: string; nomeReferente: string; promoCodeId?: string | null }): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Scrivere il test (fallisce)**

Create/append in un nuovo file `apps/piattaforma/src/app/admin/crm/contatti/email-partenza.action.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } }) }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const findUnique = vi.fn();
const update = vi.fn();
const promoFindUnique = vi.fn();
const redemptionCount = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: {
    crmContact: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
    promoCode: { findUnique: (...a: unknown[]) => promoFindUnique(...a) },
    promoCodeRedemption: { count: (...a: unknown[]) => redemptionCount(...a) },
  },
}));

const sendNotification = vi.fn();
vi.mock('@/lib/notifiche', () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }));

import { sendEmailPartenzaAction } from './actions';

describe('sendEmailPartenzaAction', () => {
  beforeEach(() => {
    findUnique.mockReset(); update.mockReset(); sendNotification.mockReset();
    promoFindUnique.mockReset(); redemptionCount.mockReset();
  });

  it('errore se il contatto non ha email', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: null, emailOptOutAt: null });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('email') });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errore se il lead è disiscritto', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: new Date() });
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('disiscritto') });
  });

  it('happy path senza codice: invia, avanza a S4, salva token', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'AGENZIA', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    update.mockResolvedValue({});
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario Rossi' });
    expect(res).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const upd = update.mock.calls[0][0].data;
    expect(upd.linkInviato).toBe(true);
    expect(upd.status).toBe('S4');
    expect(upd.invitoToken).toBeTruthy();
    expect(upd.emailUnsubToken).toBeTruthy();
  });

  it('codice non più valido → errore, nessun invio', async () => {
    findUnique.mockResolvedValue({ id: 'c1', cat: 'BROKER', status: 'S3', email: 'a@b.it', emailOptOutAt: null, nome: 'X', emailUnsubToken: null });
    promoFindUnique.mockResolvedValue({ id: 'p1', code: 'OLD', amountCent: 5000, active: false, expiresAt: null, maxRedemptions: null });
    redemptionCount.mockResolvedValue(0);
    const res = await sendEmailPartenzaAction({ contactId: 'c1', nomeReferente: 'Mario', promoCodeId: 'p1' });
    expect(res.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm --filter piattaforma test -- src/app/admin/crm/contatti/email-partenza.action.test.ts`
Expected: FAIL — `sendEmailPartenzaAction` non esportato.

- [ ] **Step 3: Implementare le action**

In `apps/piattaforma/src/app/admin/crm/contatti/actions.ts`, aggiungere gli import mancanti in testa (verificare quali già presenti — `auth`, `canEditCrmContact`, `prisma`, `revalidatePath` ci sono già):

```typescript
import { randomUUID } from 'crypto';
import { sendNotification } from '@/lib/notifiche';
import { nextStatoInvio } from '@/lib/crm/email-partenza';
import { evaluatePromoCode } from '@/lib/promo/evaluate';
import { BRAND } from '@/lib/seo/brand';
```

Poi le due action (in fondo al file):

```typescript
/** Codici promo validi (attivi, non scaduti, non esauriti) per la select d'invio. */
export async function listPromoCodesValidiAction(): Promise<
  Array<{ id: string; code: string; importoEuro: number }>
> {
  const session = await auth();
  if (!session?.user || !canEditCrmContact(session.user.role)) return [];
  const codes = await prisma.promoCode.findMany({
    where: { active: true },
    select: {
      id: true,
      code: true,
      amountCent: true,
      expiresAt: true,
      maxRedemptions: true,
      _count: { select: { redemptions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return codes
    .filter((c) => {
      const stato = evaluatePromoCode(
        { amountCent: c.amountCent, expiresAt: c.expiresAt, active: true, maxRedemptions: c.maxRedemptions },
        c._count.redemptions,
      ).stato;
      return stato === 'valido';
    })
    .map((c) => ({ id: c.id, code: c.code, importoEuro: Math.round(c.amountCent / 100) }));
}

/** Invia l'email di partenza a un lead. Gate: permessi, email, opt-out, codice valido. */
export async function sendEmailPartenzaAction(input: {
  contactId: string;
  nomeReferente: string;
  promoCodeId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non autorizzato.' };
  }

  const contact = await prisma.crmContact.findUnique({
    where: { id: input.contactId },
    select: {
      id: true, cat: true, status: true, email: true, nome: true,
      emailOptOutAt: true, emailUnsubToken: true, assignedToId: true,
    },
  });
  if (!contact) return { ok: false, error: 'Contatto non trovato.' };

  // Scoping SALES: può inviare solo ai contatti a lui assegnati.
  if (session.user.role === 'SALES' && contact.assignedToId !== session.user.id) {
    return { ok: false, error: 'Non autorizzato su questo contatto.' };
  }

  if (!contact.email) return { ok: false, error: 'Il contatto non ha un’email.' };
  if (contact.emailOptOutAt) return { ok: false, error: 'Il contatto si è disiscritto dalle email.' };

  // Rivalida il codice (potrebbe essere stato disattivato dopo l'apertura del modale).
  let codice: { code: string; importoEuro: number } | undefined;
  let promoCodeInviatoId: string | null = null;
  if (input.promoCodeId) {
    const promo = await prisma.promoCode.findUnique({
      where: { id: input.promoCodeId },
      select: { id: true, code: true, amountCent: true, expiresAt: true, active: true, maxRedemptions: true },
    });
    if (!promo) return { ok: false, error: 'Codice non trovato.' };
    const count = await prisma.promoCodeRedemption.count({ where: { promoCodeId: promo.id } });
    if (evaluatePromoCode(promo, count).stato !== 'valido') {
      return { ok: false, error: 'Il codice selezionato non è più valido.' };
    }
    codice = { code: promo.code, importoEuro: Math.round(promo.amountCent / 100) };
    promoCodeInviatoId = promo.id;
  }

  const invitoToken = randomUUID();
  const emailUnsubToken = contact.emailUnsubToken ?? randomUUID();
  const linkUrl = `${BRAND.url}/i/${invitoToken}`;
  const unsubUrl = `${BRAND.url}/unsubscribe?token=${emailUnsubToken}`;

  await sendNotification({
    tipo: 'N26_EMAIL_PARTENZA',
    target: { email: contact.email },
    payload: {
      nomeReferente: input.nomeReferente.trim() || contact.nome,
      ragioneSociale: contact.nome,
      categoria: contact.cat as 'BROKER' | 'AGENZIA',
      linkUrl,
      unsubUrl,
      codice,
    },
  });

  await prisma.crmContact.update({
    where: { id: contact.id },
    data: {
      linkInviato: true,
      linkInviatoAt: new Date(),
      invitoToken,
      emailUnsubToken,
      promoCodeInviatoId,
      status: nextStatoInvio(contact.status),
    },
  });

  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}
```

> Nota: `sendNotification` è fire-and-log e non ritorna esito. Se in futuro serve gate-are la mutazione sull'invio effettivo, andrà cambiata la firma; per ora l'audit `NotificaInviata` (stato SENT/FAILED) è la fonte di verità dell'invio.

- [ ] **Step 4: Verificare che i test passino**

Run: `pnpm --filter piattaforma test -- src/app/admin/crm/contatti/email-partenza.action.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Provare la query select su DB reale (read-only)**

Da memoria "query su DB reale": eseguire la `findMany` dei promo in read-only per verificare che `_count.redemptions` e i campi esistano:
```bash
docker exec -i <container> psql -U postgres -d passaggioveloce -c "SELECT code, \"amountCent\", active, \"expiresAt\", \"maxRedemptions\" FROM promo_codes ORDER BY \"createdAt\" DESC LIMIT 5;"
```
Expected: righe coerenti (o vuoto se nessun codice) — nessun errore di colonna.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/actions.ts apps/piattaforma/src/app/admin/crm/contatti/email-partenza.action.test.ts
git commit -m "feat(crm): sendEmailPartenzaAction + listPromoCodesValidiAction"
```

---

## Task 7: UI — bottone riga + modale d'invio

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/page.tsx` (passare codici validi + campi nuovi)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (bottone riga ~342-349, tipo `Contact`, nuovo modale)

**Interfaces:**
- Consumes: `sendEmailPartenzaAction`, `listPromoCodesValidiAction` da `./actions`; `Button` da `@/components/ui`.
- Produces: nessuna interfaccia esterna (UI terminale).

- [ ] **Step 1: page.tsx — caricare i codici validi e i nuovi campi**

In `apps/piattaforma/src/app/admin/crm/contatti/page.tsx`, dove i contatti vengono mappati per il client (vicino a `linkInviatoAt: c.linkInviatoAt?.toISOString()`), aggiungere i campi:

```typescript
        linkInviato: c.linkInviato,
        emailOptOutAt: c.emailOptOutAt?.toISOString() ?? null,
```

(assicurarsi che la `select`/`findMany` dei contatti includa `linkInviato`, `emailOptOutAt`, `email`, `cat`, `nome` — email/cat/nome quasi certamente già inclusi.)

E caricare i codici validi da passare al client (import di `listPromoCodesValidiAction` da `./actions`):

```typescript
  const promoCodes = await listPromoCodesValidiAction();
```

passandolo come prop al componente client (es. `<ContattiClient ... promoCodes={promoCodes} />`).

- [ ] **Step 2: client.tsx — estendere il tipo `Contact` e le props**

Nel tipo `Contact` (dove ci sono `linkInviato`, `mailAperta`…), assicurarsi ci siano:

```typescript
  email: string | null;
  cat: 'BROKER' | 'AGENZIA';
  nome: string;
  linkInviato: boolean;
  emailOptOutAt: string | null;
```

Aggiungere la prop al componente lista:

```typescript
  promoCodes: Array<{ id: string; code: string; importoEuro: number }>;
```

- [ ] **Step 3: client.tsx — bottone nella riga**

Accanto al bottone "Modifica" esistente (nella `<td className="px-4 py-2.5 text-right">`, ~342-349), aggiungere il tasto d'invio. Serve uno state per il contatto selezionato all'invio:

```typescript
  const [sending, setSending] = useState<Contact | null>(null);
```

E nel `<td>` azioni, accanto a "Modifica":

```tsx
                    <button
                      type="button"
                      onClick={() => setSending(c)}
                      disabled={!c.email || !!c.emailOptOutAt}
                      title={
                        !c.email
                          ? 'Manca l’email'
                          : c.emailOptOutAt
                            ? 'Contatto disiscritto'
                            : undefined
                      }
                      className="ml-2 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold text-pv-navy-700 hover:bg-pv-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {c.linkInviato ? 'Reinvia' : 'Invia email'}
                    </button>
```

E rendere il modale (in fondo al render, accanto agli altri modali):

```tsx
      {sending && (
        <EmailPartenzaModal
          contact={sending}
          promoCodes={promoCodes}
          onClose={() => setSending(null)}
        />
      )}
```

- [ ] **Step 4: client.tsx — il modale `EmailPartenzaModal`**

Aggiungere il componente (stesso pattern del modale CSV esistente ~577+):

```tsx
function EmailPartenzaModal({
  contact,
  promoCodes,
  onClose,
}: {
  contact: Contact;
  promoCodes: Array<{ id: string; code: string; importoEuro: number }>;
  onClose: () => void;
}) {
  const [nomeReferente, setNomeReferente] = useState(contact.nome);
  const [promoCodeId, setPromoCodeId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const res = await sendEmailPartenzaAction({
      contactId: contact.id,
      nomeReferente,
      promoCodeId: promoCodeId || null,
    });
    setPending(false);
    if (res.ok) {
      onClose();
    } else {
      setError(res.error);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] bg-white p-5 shadow-[var(--pv-shadow-card-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold text-pv-navy-900">
          {contact.linkInviato ? 'Reinvia email di partenza' : 'Invia email di partenza'}
        </h3>
        <p className="mt-1 text-[12.5px] text-pv-slate-600">
          A: {contact.email} · {contact.cat === 'BROKER' ? 'Broker' : 'Agenzia'}
          {contact.linkInviato ? ' · già inviata in precedenza' : ''}
        </p>

        <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
          Nome referente
          <input
            value={nomeReferente}
            onChange={(e) => setNomeReferente(e.target.value)}
            disabled={pending}
            className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          />
        </label>

        <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
          Codice di benvenuto (opzionale)
          <select
            value={promoCodeId}
            onChange={(e) => setPromoCodeId(e.target.value)}
            disabled={pending}
            className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          >
            <option value="">Nessun codice</option>
            {promoCodes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.importoEuro} €
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="mt-3 text-[12.5px] font-medium text-pv-red-500">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Annulla
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={pending || !nomeReferente.trim()}
            loading={pending}
            loadingLabel="Invio…"
          >
            Invia
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Aggiungere `sendEmailPartenzaAction` all'import da `./actions`.

- [ ] **Step 5: Verifica sul DOM col gesto utente**

Da memoria "verifica sul DOM e col gesto utente": far partire l'app, andare su `/admin/crm/contatti`, e con Chrome DevTools MCP:
- cliccare "Invia email" su un contatto con email → il modale si apre;
- verificare che su un contatto senza email il bottone sia disabilitato (tooltip "Manca l'email");
- selezionare un codice, cliccare Invia → il modale si chiude e (in dev con provider console) l'email compare in `.dev-emails/`.

Run app: `nvm use 22.15.0 && pnpm --filter piattaforma dev` (login admin: memoria "credenziali dev locali").

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/page.tsx apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): bottone riga + modale invio email di partenza"
```

---

## Task 8: Wizard — auto-apply del codice da `?promo=`

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx` (RegisterWizard ~100-102, render PaymentStep ~390, PaymentStep ~917-960)

**Interfaces:**
- Consumes: `useSearchParams` (già usato); `checkPromoCodeAction` (già importato/usato in PaymentStep).
- Produces: nessuna interfaccia esterna. `PaymentStep` accetta una nuova prop `initialPromoCode?: string`.

- [ ] **Step 1: RegisterWizard legge `?promo=` e lo passa a PaymentStep**

In `RegisterWizard` (dove legge `const referralCode = searchParams.get('ref') ?? undefined;`), aggiungere:

```typescript
  const initialPromoCode = searchParams.get('promo') ?? undefined;
```

E nel render dello step 4 (`<PaymentStep ... />` ~390), passare la prop:

```tsx
            <PaymentStep
              defaultValues={data.payment}
              companyType={data.company?.type}
              initialPromoCode={initialPromoCode}
              onBack={() => setStep(3)}
              onSubmit={handlePayment}
              isSubmitting={false}
            />
```

- [ ] **Step 2: PaymentStep accetta la prop e auto-applica su mount**

Nella firma di `PaymentStep`, aggiungere `initialPromoCode?: string` ai props destrutturati e al tipo. Cambiare l'init dello state e aggiungere un `useEffect` che valida al mount:

```typescript
  const [promoCode, setPromoCode] = useState(initialPromoCode ?? '');
  const [promoState, setPromoState] = useState<PromoCheckResult | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  // Auto-apply: se arriviamo dal link /i/<token> con ?promo=, validiamo subito
  // così il credito risulta già applicato senza click.
  useEffect(() => {
    if (!initialPromoCode) return;
    let alive = true;
    setCheckingPromo(true);
    checkPromoCodeAction(initialPromoCode)
      .then((s) => { if (alive) setPromoState(s); })
      .finally(() => { if (alive) setCheckingPromo(false); });
    return () => { alive = false; };
  }, [initialPromoCode]);
```

Assicurarsi che `useEffect` sia importato da `react` in cima al file (probabile che `useState` lo sia già; aggiungere `useEffect` all'import).

- [ ] **Step 3: Verifica sul DOM col gesto utente**

Aprire nel browser `/register/dealer?promo=<CODICE_VALIDO>` (usare un codice reale dal DB locale). Arrivare allo step 4 (Pagamento) e verificare che sotto il campo codice compaia già "Codice valido: X € verranno accreditati…" **senza** aver cliccato "Applica". Con un `?promo=INESISTENTE` deve comparire "Codice inesistente." e la registrazione deve poter proseguire comunque (il codice non è bloccante).

- [ ] **Step 4: Commit**

```bash
git add "apps/piattaforma/src/app/(auth)/register/register-wizard.tsx"
git commit -m "feat(register): auto-apply codice promo da ?promo= (link email partenza)"
```

---

## Task 9: Unsubscribe per lead

**Files:**
- Modify: `apps/piattaforma/src/app/unsubscribe/page.tsx`

**Interfaces:**
- Consumes: `prisma`.
- Produces: nessuna interfaccia esterna.

- [ ] **Step 1: Aggiungere il ramo lead**

In `apps/piattaforma/src/app/unsubscribe/page.tsx`, dopo il blocco che cerca `User.unsubscribeToken` e prima del `return`, aggiungere il fallback su `CrmContact` quando lo user non è stato trovato:

```typescript
  if (token && !ok) {
    const contact = await prisma.crmContact.findUnique({
      where: { emailUnsubToken: token },
      select: { id: true, emailOptOutAt: true },
    });
    if (contact) {
      if (!contact.emailOptOutAt) {
        await prisma.crmContact.update({
          where: { id: contact.id },
          data: { emailOptOutAt: new Date() },
        });
      }
      ok = true;
    }
  }
```

> Nota: il testo "Preferenze aggiornate / Non riceverai più le notifiche facoltative…" resta adeguato anche per il lead (non riceverà più email commerciali). Nessuna modifica al copy necessaria.

- [ ] **Step 2: Verifica sul DOM**

Con un `emailUnsubToken` reale (da un contatto a cui è stata inviata l'email nel Task 7), aprire `/unsubscribe?token=<emailUnsubToken>` → pagina "Preferenze aggiornate". Verificare sul DB che `crm_contacts.emailOptOutAt` sia valorizzato:
```bash
docker exec -i <container> psql -U postgres -d passaggioveloce -c "SELECT nome, \"emailOptOutAt\" FROM crm_contacts WHERE \"emailUnsubToken\" = '<token>';"
```
Poi tornare su `/admin/crm/contatti` e verificare che il bottone "Invia email" per quel contatto sia disabilitato (tooltip "Contatto disiscritto").

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/unsubscribe/page.tsx
git commit -m "feat(crm): unsubscribe per lead via emailUnsubToken"
```

---

## Task 10: Verifica end-to-end + suite completa

**Files:** nessuna modifica (solo verifica).

- [ ] **Step 1: Suite unit completa**

Run: `nvm use 22.15.0 && pnpm --filter piattaforma test`
Expected: tutti verdi (inclusi i nuovi: email-partenza, templates N26, route /i, action).

- [ ] **Step 2: Flusso reale end-to-end (browser, gesto utente)**

Con app in dev + provider email console:
1. `/admin/crm/contatti` → creare (o usare) un contatto BROKER con email.
2. "Invia email" → selezionare un codice welcome → Invia.
3. Aprire l'email generata in `.dev-emails/` → verificare CTA "Registra la tua concessionaria", checklist, blocco codice, link `/i/<token>`, link unsubscribe.
4. Copiare il link `/i/<token>` e aprirlo → deve redirigere a `/register/dealer?promo=<CODE>` e sul contatto `linkAperto=true`, `status=S5`.
5. Allo step 4 del wizard il codice risulta già applicato.
6. Verificare su `/admin/crm/contatti` che il contatto sia passato a S5 e "Invia" sia diventato "Reinvia".

- [ ] **Step 3: Verifica audit**

Query read-only:
```bash
docker exec -i <container> psql -U postgres -d passaggioveloce -c "SELECT tipo, stato, destinazione, subject FROM notifiche_inviate WHERE tipo = 'N26_EMAIL_PARTENZA' ORDER BY \"createdAt\" DESC LIMIT 3;"
```
Expected: una riga N26 con destinazione = email del contatto.

- [ ] **Step 4: Commit finale (se servono fix)**

```bash
git add -A && git commit -m "test(crm): verifica e2e email di partenza"
```

---

## Note di rilascio (fuori dai task di codice)

- **Prod:** applicare la migration a mano su Neod prod con `db:deploy` (mai `migrate dev`). Deploy = push su main.
- **Discordanza soglia payout** landing (`page.tsx:183` "1.000€") vs Termini (500€): NON toccata da questa feature; segnalare a parte per bonifica.
- **GDPR:** l'unsubscribe per lead è requisito, coperto dal Task 9. Il footer N26 ha sempre il link (Task 3).
