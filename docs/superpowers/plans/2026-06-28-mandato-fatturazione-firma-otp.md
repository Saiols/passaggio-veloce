# Mandato fatturazione conto terzi — firma OTP al primo payout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alla prima richiesta di payout (broker o agenzia) far firmare via OTP email un «Mandato per fatturazione per conto terzi» costruito sui dati del firmatario, salvarlo sull'azienda con data, e renderlo visibile dal pannello admin.

**Architecture:** Modello dedicato `MandatoFatturazione` (1 per azienda) + OTP email (codice hashato su `User`) + PDF dinamico con `pdf-lib` (clausole verbatim) salvato su Blob. Gate in `richiediPayoutAction` che, se manca il mandato, segnala `requireMandato` alla UI → modale di firma. Sezione admin + route download.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/Postgres, `pdf-lib`, `bcryptjs`, Vercel Blob, Resend, Vitest.

## Global Constraints

- **OTP via email**: codice 6 cifre, hashato (bcrypt) su `User.mandatoOtpHash` + scadenza `User.mandatoOtpExpiresAt` (~10 min). Niente TOTP/SMS. Invio via `getEmail().send({ from: env.EMAIL_FROM, ... })` (NON `sendNotification`/enum NotificaTipo).
- **Una volta per azienda**: `MandatoFatturazione.companyId @unique`. La presenza della riga = firmato.
- **Solo ADMIN_AZIENDA firma**: `isOwner(role)` (`role === 'ADMIN_AZIENDA'`, da `@/lib/auth/permissions`).
- **Mandante** = dati del firmatario via `snapshotCompany(company)`; **Mandatario** = `pvEmittente()` (`@/lib/fatturazione/pv-emittente`); **foro** = `mandatario.citta`; rappresentante PV = `process.env.PV_RAPPRESENTANTE ?? 'Andrea Saino'`.
- **Clausole verbatim** dal `.docx` (`docs/contratti/mandato_fatturazione_conto_terzi_informativa_privacy.docx`) — incorporate in `lib/contratti/testo.ts`.
- **Storage**: `getStorage().put({ scope: 'mandati', buffer, mimeType: 'application/pdf', originalFilename })` → `{ storageKey, storageProvider, sizeBytes, ... }`. `assertSafeScope` accetta qualsiasi `[a-z0-9_\-/]+`, quindi `mandati` è valido.
- **Download admin**: `storageGetBuffer(storageKey)` da `@/lib/providers/storage`.
- Branch: `main`. Migration additiva da `migrate deploy` al rilascio.

**Comandi:**
- Test file: `pnpm --filter piattaforma exec vitest run <path>`
- Typecheck: `pnpm --filter piattaforma run typecheck`
- Suite: `pnpm --filter piattaforma test`
- Prisma generate: `pnpm --filter @pv/db exec prisma generate`

---

## File Structure

- **Modify** `packages/db/prisma/schema.prisma` + migration — modello `MandatoFatturazione`, relazioni Company/User, campi OTP su User.
- **Create** `apps/piattaforma/src/lib/contratti/testo.ts` (clausole) + test.
- **Create** `apps/piattaforma/src/lib/contratti/otp.ts` (genera/scadenza OTP) + test.
- **Create** `apps/piattaforma/src/lib/contratti/mandato-pdf.ts` (PDF) + test.
- **Modify** `apps/piattaforma/src/lib/auth/email-templates.ts` — template OTP.
- **Modify** `apps/piattaforma/src/app/wallet/actions.ts` — `PayoutResult` + gate; **Create** `app/wallet/mandato-actions.ts` (inviaOtp/firma) + test gate.
- **Create** `apps/piattaforma/src/app/wallet/mandato-firma-modal.tsx`; **Modify** `app/wallet/payout-button.tsx` + la pagina wallet che lo renderizza.
- **Modify** `apps/piattaforma/src/app/admin/companies/[id]/page.tsx` + **Create** `app/api/admin/mandato/[companyId]/pdf/route.ts`.

**7 task** sequenziali.

---

## Task 1: Schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260628160000_mandato_fatturazione/migration.sql`

**Interfaces:**
- Produces: modello Prisma `MandatoFatturazione`; `Company.mandatoFatturazione: MandatoFatturazione?`; `User.mandatiFirmati: MandatoFatturazione[]`, `User.mandatoOtpHash: String?`, `User.mandatoOtpExpiresAt: DateTime?`.

- [ ] **Step 1: Aggiungere il modello + relazioni**

In `schema.prisma`, aggiungi il modello (vicino agli altri modelli "azienda"/wallet):

```prisma
model MandatoFatturazione {
  id        String  @id @default(uuid()) @db.Uuid
  companyId String  @unique @db.Uuid
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  firmatarioUserId String @db.Uuid
  firmatario       User   @relation("MandatiFirmati", fields: [firmatarioUserId], references: [id])
  firmatoAt        DateTime @default(now())

  storageKey      String
  storageProvider String @default("local")
  mimeType        String @default("application/pdf")
  sizeBytes       Int

  datiSnapshot Json

  ip              String?
  userAgent       String?
  otpVerificatoAt DateTime

  createdAt DateTime @default(now())

  @@map("mandati_fatturazione")
}
```

In `model Company`, aggiungi la relazione inversa (tra le relazioni esistenti):

```prisma
  mandatoFatturazione MandatoFatturazione?
```

In `model User`, aggiungi la relazione inversa + i campi OTP:

```prisma
  mandatiFirmati MandatoFatturazione[] @relation("MandatiFirmati")

  // OTP email per firma mandato fatturazione (ephemeral, hashato)
  mandatoOtpHash      String?
  mandatoOtpExpiresAt DateTime?
```

- [ ] **Step 2: Creare la migration**

Crea `packages/db/prisma/migrations/20260628160000_mandato_fatturazione/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "mandatoOtpHash" TEXT;
ALTER TABLE "users" ADD COLUMN "mandatoOtpExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mandati_fatturazione" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "firmatarioUserId" UUID NOT NULL,
    "firmatoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "datiSnapshot" JSONB NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "otpVerificatoAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mandati_fatturazione_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mandati_fatturazione_companyId_key" ON "mandati_fatturazione"("companyId");

-- AddForeignKey
ALTER TABLE "mandati_fatturazione" ADD CONSTRAINT "mandati_fatturazione_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mandati_fatturazione" ADD CONSTRAINT "mandati_fatturazione_firmatarioUserId_fkey" FOREIGN KEY ("firmatarioUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

> Verifica il nome reale della tabella `User` nello schema (probabile `@@map("users")`) e `Company` (`@@map("companies")` — confermato). Se i nomi differiscono, adegua le `ALTER TABLE`/`REFERENCES`. In alternativa, se hai un DB di sviluppo, genera la migration con `prisma migrate dev --create-only --name mandato_fatturazione` e usa l'SQL prodotto.

- [ ] **Step 3: Generate + typecheck**

Run: `pnpm --filter @pv/db exec prisma generate` → ok.
Run: `pnpm --filter piattaforma run typecheck` → PASS (nessun consumer ancora).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260628160000_mandato_fatturazione
git commit -m "feat(db): modello MandatoFatturazione + campi OTP mandato su User"
```

---

## Task 2: Testo clausole (`lib/contratti/testo.ts`)

**Files:**
- Create: `apps/piattaforma/src/lib/contratti/testo.ts`
- Test: `apps/piattaforma/src/lib/contratti/testo.test.ts`

**Interfaces:**
- Produces: `MANDATO_TITOLO: string`, `MANDATO_CLAUSOLE: { heading: string; body: string }[]` (le 10 sezioni verbatim).

- [ ] **Step 1: Scrivere il test (RED)**

Crea `apps/piattaforma/src/lib/contratti/testo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MANDATO_TITOLO, MANDATO_CLAUSOLE } from './testo';

describe('testo mandato', () => {
  it('titolo corretto', () => {
    expect(MANDATO_TITOLO).toContain('Mandato per fatturazione per conto terzi');
  });
  it('contiene le 10 sezioni con le intestazioni attese', () => {
    const headings = MANDATO_CLAUSOLE.map((c) => c.heading);
    expect(MANDATO_CLAUSOLE).toHaveLength(10);
    expect(headings).toContain('1. Oggetto del mandato');
    expect(headings).toContain('7. Trattamento dei dati personali');
    expect(headings).toContain('10. Sottoscrizione');
  });
  it('il corpo GDPR cita il Regolamento UE 2016/679', () => {
    const gdpr = MANDATO_CLAUSOLE.find((c) => c.heading.startsWith('7.'))!;
    expect(gdpr.body).toContain('2016/679');
  });
});
```

- [ ] **Step 2: Eseguire il test (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/contratti/testo.test.ts`
Expected: FAIL — `./testo` inesistente.

- [ ] **Step 3: Implementare il testo verbatim**

Crea `apps/piattaforma/src/lib/contratti/testo.ts` (testo dal `.docx`):

```typescript
/**
 * Testo legale verbatim del «Mandato per fatturazione per conto terzi e
 * informativa privacy». Fonte: docs/contratti/mandato_fatturazione_conto_terzi_informativa_privacy.docx
 * Le parti (Mandante/Mandatario), il foro e la firma sono compilati dinamicamente
 * dal generatore PDF (mandato-pdf.ts); qui restano solo le clausole fisse.
 */
export const MANDATO_TITOLO = 'Mandato per fatturazione per conto terzi e informativa privacy';

export const MANDATO_CLAUSOLE: { heading: string; body: string }[] = [
  {
    heading: '1. Oggetto del mandato',
    body: 'Il Mandante conferisce al Mandatario, che accetta, mandato a svolgere attività di fatturazione per conto terzi, nei limiti e secondo le istruzioni impartite dal Mandante, relativamente alle operazioni commerciali, amministrative e contabili indicate o comunicate dal Mandante stesso.',
  },
  {
    heading: '2. Attività autorizzate',
    body: 'Il Mandatario è autorizzato a: predisporre, emettere, trasmettere e gestire fatture e documenti contabili per conto del Mandante; utilizzare i dati fiscali, anagrafici e commerciali necessari all’esecuzione del mandato; interfacciarsi, ove necessario, con clienti, fornitori, intermediari, consulenti, sistemi informatici e piattaforme di fatturazione elettronica; conservare copia della documentazione prodotta nei limiti di legge e delle istruzioni ricevute.',
  },
  {
    heading: '3. Obblighi del Mandante',
    body: 'Il Mandante si impegna a fornire al Mandatario dati, documenti e istruzioni completi, veritieri, aggiornati e conformi alla normativa applicabile. Il Mandante resta responsabile della correttezza sostanziale delle operazioni commerciali sottostanti, dei dati trasmessi e delle indicazioni fornite al Mandatario.',
  },
  {
    heading: '4. Obblighi del Mandatario',
    body: 'Il Mandatario si impegna a eseguire il mandato con diligenza professionale, attenendosi alle istruzioni ricevute dal Mandante e adottando misure organizzative e tecniche adeguate a garantire la riservatezza, l’integrità e la sicurezza dei dati trattati e della documentazione gestita.',
  },
  {
    heading: '5. Durata, revoca e cessazione',
    body: 'Il presente mandato decorre dalla data di sottoscrizione e resta valido fino a revoca scritta del Mandante o rinuncia scritta del Mandatario, salvo diverso accordo tra le parti. La cessazione del mandato non pregiudica gli obblighi di riservatezza, conservazione documentale e adempimento degli obblighi di legge maturati durante il rapporto.',
  },
  {
    heading: '6. Responsabilità',
    body: 'Il Mandatario non risponde di errori, omissioni, ritardi o irregolarità derivanti da dati inesatti, incompleti o tardivamente comunicati dal Mandante. Resta ferma la responsabilità del Mandatario per eventuali inadempimenti direttamente imputabili alla propria condotta dolosa o colposa.',
  },
  {
    heading: '7. Trattamento dei dati personali',
    body: 'Le parti dichiarano di trattare i dati personali nel rispetto del Regolamento UE 2016/679 (“GDPR”) e della normativa nazionale applicabile in materia di protezione dei dati personali. Il trattamento dei dati avviene per finalità connesse all’esecuzione del presente mandato, all’adempimento di obblighi contrattuali, fiscali, contabili e di legge, nonché alla gestione dei rapporti amministrativi tra le parti. I dati trattati possono includere dati anagrafici, fiscali, contabili, amministrativi, recapiti, dati relativi a clienti, fornitori, prestazioni, beni o servizi fatturati e ogni ulteriore informazione necessaria alla corretta esecuzione del mandato. La base giuridica del trattamento è costituita dall’esecuzione del contratto o di misure precontrattuali, dall’adempimento di obblighi di legge e, ove applicabile, dal legittimo interesse delle parti alla corretta gestione del rapporto. Il conferimento dei dati è necessario per l’esecuzione del mandato; l’eventuale mancato conferimento può impedire lo svolgimento delle attività richieste. I dati potranno essere comunicati a soggetti autorizzati, consulenti, intermediari, fornitori di servizi informatici, piattaforme di fatturazione elettronica, autorità pubbliche e altri soggetti nei limiti necessari all’esecuzione del mandato e degli obblighi normativi. I dati saranno conservati per il tempo necessario allo svolgimento del mandato e successivamente per i periodi previsti dalla normativa fiscale, contabile e civilistica applicabile. L’interessato può esercitare i diritti previsti dagli artt. 15-22 del GDPR, tra cui accesso, rettifica, cancellazione, limitazione, opposizione e portabilità dei dati, scrivendo ai recapiti indicati dalle parti. Resta salvo il diritto di proporre reclamo all’Autorità Garante per la protezione dei dati personali.',
  },
  {
    heading: '8. Riservatezza',
    body: 'Le parti si impegnano a mantenere riservate tutte le informazioni, i dati, i documenti e le credenziali di cui vengano a conoscenza in occasione dell’esecuzione del presente mandato, salvo quanto necessario per l’adempimento degli obblighi contrattuali o di legge.',
  },
  {
    heading: '9. Legge applicabile e foro competente',
    body: 'Il presente mandato è regolato dalla legge italiana. Per ogni controversia relativa alla validità, interpretazione, esecuzione o cessazione del presente accordo sarà competente il Foro di {{FORO}}, salvo diverso foro inderogabile previsto dalla legge.',
  },
  {
    heading: '10. Sottoscrizione',
    body: 'Le parti dichiarano di aver letto e compreso integralmente il presente mandato e di accettarne tutte le clausole. La sottoscrizione del Mandante avviene mediante firma elettronica con codice OTP inviato e verificato dalla piattaforma.',
  },
];
```

- [ ] **Step 4: Test (GREEN)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/contratti/testo.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/contratti/testo.ts apps/piattaforma/src/lib/contratti/testo.test.ts
git commit -m "feat(contratti): testo verbatim mandato fatturazione conto terzi"
```

---

## Task 3: OTP module (`lib/contratti/otp.ts`)

**Files:**
- Create: `apps/piattaforma/src/lib/contratti/otp.ts`
- Test: `apps/piattaforma/src/lib/contratti/otp.test.ts`

**Interfaces:**
- Produces: `generaCodiceOtp(): string` (6 cifre), `OTP_TTL_MS: number`, `otpScaduto(expiresAt: Date | null | undefined, now?: Date): boolean`.

- [ ] **Step 1: Scrivere il test (RED)**

Crea `apps/piattaforma/src/lib/contratti/otp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generaCodiceOtp, otpScaduto, OTP_TTL_MS } from './otp';

describe('OTP mandato', () => {
  it('genera un codice di 6 cifre numeriche', () => {
    for (let i = 0; i < 50; i++) {
      const c = generaCodiceOtp();
      expect(c).toMatch(/^\d{6}$/);
    }
  });
  it('OTP_TTL_MS è ~10 minuti', () => {
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
  });
  it('otpScaduto: true se null, true se passato, false se futuro', () => {
    const now = new Date('2026-06-28T12:00:00Z');
    expect(otpScaduto(null, now)).toBe(true);
    expect(otpScaduto(new Date('2026-06-28T11:59:00Z'), now)).toBe(true);
    expect(otpScaduto(new Date('2026-06-28T12:05:00Z'), now)).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire il test (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/contratti/otp.test.ts`
Expected: FAIL — `./otp` inesistente.

- [ ] **Step 3: Implementare**

Crea `apps/piattaforma/src/lib/contratti/otp.ts`:

```typescript
import { randomInt } from 'node:crypto';

/** Durata di validità del codice OTP (10 minuti). */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** Genera un codice OTP numerico a 6 cifre (con eventuali zeri iniziali). */
export function generaCodiceOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** True se il codice è scaduto (o assente). */
export function otpScaduto(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}
```

- [ ] **Step 4: Test (GREEN)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/contratti/otp.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/contratti/otp.ts apps/piattaforma/src/lib/contratti/otp.test.ts
git commit -m "feat(contratti): generazione/scadenza OTP firma mandato"
```

---

## Task 4: PDF builder (`lib/contratti/mandato-pdf.ts`)

**Files:**
- Create: `apps/piattaforma/src/lib/contratti/mandato-pdf.ts`
- Test: `apps/piattaforma/src/lib/contratti/mandato-pdf.test.ts`

**Interfaces:**
- Consumes: `MANDATO_TITOLO`/`MANDATO_CLAUSOLE` (Task 2); `DatiFiscali` (`@/lib/fatturazione/pv-emittente`); `wrapText` (`@/lib/fatturazione/pdf`); `winAnsiSafe` (`@/lib/pdf/winansi`).
- Produces:
  - `type MandatoPdfInput = { mandante: DatiFiscali; mandanteRappresentante: string; mandatario: DatiFiscali; mandatarioRappresentante: string; foro: string; firmatoAt: Date; otpAudit: { ip: string | null } }`
  - `buildMandatoFatturazionePdf(input: MandatoPdfInput): Promise<Uint8Array>`

- [ ] **Step 1: Scrivere il test (RED)**

Crea `apps/piattaforma/src/lib/contratti/mandato-pdf.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildMandatoFatturazionePdf } from './mandato-pdf';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

const mandante: DatiFiscali = {
  ragioneSociale: 'Auto Rossi S.r.l.', partitaIva: '12345678901', codiceSdi: null, pec: 'rossi@pec.it',
  indirizzo: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'RM',
};
const mandatario: DatiFiscali = {
  ragioneSociale: 'Passaggio Veloce SRL', partitaIva: '14688390963', codiceSdi: null, pec: null,
  indirizzo: 'Via PV 1', cap: '20100', citta: 'Milano', provincia: 'MI',
};

describe('buildMandatoFatturazionePdf', () => {
  it('produce un PDF valido e non banale', async () => {
    const bytes = await buildMandatoFatturazionePdf({
      mandante, mandanteRappresentante: 'Mario Rossi',
      mandatario, mandatarioRappresentante: 'Andrea Saino',
      foro: 'Milano', firmatoAt: new Date('2026-06-28T10:00:00Z'),
      otpAudit: { ip: '1.2.3.4' },
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1500);
    // header PDF
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
  });

  it('non lancia con campi minimi / ip null', async () => {
    await expect(
      buildMandatoFatturazionePdf({
        mandante, mandanteRappresentante: '', mandatario, mandatarioRappresentante: 'X',
        foro: 'Milano', firmatoAt: new Date(), otpAudit: { ip: null },
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 2: Eseguire il test (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/lib/contratti/mandato-pdf.test.ts`
Expected: FAIL — `./mandato-pdf` inesistente.

- [ ] **Step 3: Implementare il builder**

Crea `apps/piattaforma/src/lib/contratti/mandato-pdf.ts`:

```typescript
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { wrapText } from '@/lib/fatturazione/pdf';
import { winAnsiSafe } from '@/lib/pdf/winansi';
import { MANDATO_TITOLO, MANDATO_CLAUSOLE } from './testo';

export type MandatoPdfInput = {
  mandante: DatiFiscali;
  mandanteRappresentante: string;
  mandatario: DatiFiscali;
  mandatarioRappresentante: string;
  foro: string;
  firmatoAt: Date;
  otpAudit: { ip: string | null };
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const NAVY = rgb(0.04, 0.15, 0.25);
const SLATE = rgb(0.2, 0.25, 0.33);

function indirizzo(d: DatiFiscali): string {
  return [d.indirizzo, [d.cap, d.citta].filter(Boolean).join(' '), d.provincia ? `(${d.provincia})` : '']
    .filter(Boolean)
    .join(', ');
}

function formatData(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function buildMandatoFatturazionePdf(input: MandatoPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Mandato fatturazione conto terzi');
  pdf.setAuthor('Passaggio Veloce');
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxW = PAGE_W - 2 * MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const draw = (t: string, font: PDFFont, size: number, color = SLATE) => {
    const lines = wrapText(t, font, size, maxW);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(winAnsiSafe(line), { x: MARGIN, y, size, font, color });
      y -= size + 4;
    }
  };
  const gap = (h: number) => { y -= h; };

  // Titolo
  draw(MANDATO_TITOLO, bold, 15, NAVY);
  gap(8);
  draw('Tra le parti sotto indicate:', helv, 10);
  gap(4);

  // Parti
  draw(
    `Mandante: ${input.mandante.ragioneSociale}, con sede in ${indirizzo(input.mandante)}, ` +
    `C.F./P. IVA ${input.mandante.partitaIva}, in persona di ${input.mandanteRappresentante || '—'}, di seguito “Mandante”.`,
    helv, 10,
  );
  gap(2);
  draw(
    `Mandatario: ${input.mandatario.ragioneSociale}, con sede in ${indirizzo(input.mandatario)}, ` +
    `C.F./P. IVA ${input.mandatario.partitaIva}, in persona di ${input.mandatarioRappresentante}, di seguito “Mandatario”.`,
    helv, 10,
  );
  gap(10);

  // Clausole
  for (const c of MANDATO_CLAUSOLE) {
    draw(c.heading, bold, 11, NAVY);
    gap(2);
    draw(c.body.replace('{{FORO}}', input.foro), helv, 10);
    gap(8);
  }

  // Sottoscrizione
  gap(6);
  draw(`Luogo e data: ${input.mandatario.citta}, ${formatData(input.firmatoAt)}`, helv, 10);
  gap(4);
  draw(
    `Firma del Mandante: ${input.mandanteRappresentante || '—'} — firmato elettronicamente via codice OTP ` +
    `il ${formatData(input.firmatoAt)}${input.otpAudit.ip ? ` (IP ${input.otpAudit.ip})` : ''}, codice verificato.`,
    helv, 10, NAVY,
  );
  gap(2);
  draw(`Firma del Mandatario: ${input.mandatarioRappresentante} per ${input.mandatario.ragioneSociale}.`, helv, 10);

  return await pdf.save();
}
```

> Verifica che `wrapText` sia esportato da `@/lib/fatturazione/pdf` e `winAnsiSafe` da `@/lib/pdf/winansi` (entrambi confermati nel codice esistente). Se le firme differiscono, adegua.

- [ ] **Step 4: Test (GREEN) + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/contratti/mandato-pdf.test.ts` → PASS.
Run: `pnpm --filter piattaforma run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/contratti/mandato-pdf.ts apps/piattaforma/src/lib/contratti/mandato-pdf.test.ts
git commit -m "feat(contratti): generatore PDF mandato fatturazione (clausole + firma OTP)"
```

---

## Task 5: Email OTP + gate payout

**Files:**
- Modify: `apps/piattaforma/src/lib/auth/email-templates.ts` (template OTP)
- Modify: `apps/piattaforma/src/app/wallet/actions.ts` (`PayoutResult` + gate)
- Test: `apps/piattaforma/src/app/wallet/actions.test.ts` (gate)

**Interfaces:**
- Produces: `tplOtpMandato(p: { codice: string }): EmailContent`; `PayoutResult` guadagna `| { ok: false; requireMandato: true }`.

- [ ] **Step 1: Template email OTP**

In `email-templates.ts`, aggiungi (usa `authLayout` già presente; mostra il codice, NON un link):

```typescript
export function tplOtpMandato(p: { codice: string }): EmailContent {
  const subject = 'Passaggio Veloce — Codice per la firma del mandato';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Codice di firma</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Per firmare il «Mandato per fatturazione per conto terzi» usa questo codice:</p>
    <p style="margin:0 0 14px;font-size:28px;font-weight:800;letter-spacing:6px;color:#0a2540">${p.codice}</p>
    <p style="margin:8px 0 0;font-size:12px;color:#64748b">Il codice è valido 10 minuti. Se non hai richiesto la firma, ignora questa email.</p>
  `);
  const text = `Codice per firmare il mandato fatturazione (valido 10 minuti): ${p.codice}`;
  return { subject, html, text };
}
```

- [ ] **Step 2: Scrivere il test del gate (RED)**

Crea/aggiorna `apps/piattaforma/src/app/wallet/actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getOperatingSedeMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getOperatingSedeMock: vi.fn(),
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({ getOperatingSede: getOperatingSedeMock }));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error('REDIRECT:' + u); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { richiediPayoutAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { companyType: 'DEALER', companyId: 'c1' } });
  getOperatingSedeMock.mockResolvedValue({ id: 's1' });
  prismaMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
  prismaMock.payout.findFirst.mockResolvedValue(null);
  prismaMock.payout.create.mockResolvedValue({});
});

describe('richiediPayoutAction — gate mandato', () => {
  it('senza mandato → requireMandato, niente payout', async () => {
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue(null);
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: false, requireMandato: true });
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });
  it('con mandato → crea il payout', async () => {
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: true });
    expect(prismaMock.payout.create).toHaveBeenCalledTimes(1);
  });
});
```

> Verifica gli specifier reali di import in `actions.ts` (`@/auth`, `getOperatingSede` da `@/lib/auth/session-context`, `prisma` da `@pv/db`) e allinea i `vi.mock`. Se `actions.ts` importa `WALLET` da `@/lib/wallet/config`, il valore reale (`MIN_PAYOUT_CENT=50000`) rende il saldo 80_000 sufficiente.

- [ ] **Step 3: Eseguire (RED)**

Run: `pnpm --filter piattaforma exec vitest run src/app/wallet/actions.test.ts`
Expected: FAIL — il gate non esiste, `requireMandato` non ritornato.

- [ ] **Step 4: Implementare il gate**

In `actions.ts`, estendi il tipo:

```typescript
export type PayoutResult = { ok: true } | { ok: false; error: string } | { ok: false; requireMandato: true };
```

In `richiediPayoutAction`, **dopo** il check `inflight` e **prima** di `prisma.payout.create`, aggiungi:

```typescript
  // Gate mandato fatturazione: alla PRIMA richiesta payout serve il contratto firmato.
  const mandato = await prisma.mandatoFatturazione.findUnique({
    where: { companyId: session.user.companyId! },
    select: { id: true },
  });
  if (!mandato) return { ok: false, requireMandato: true };
```

- [ ] **Step 5: Test (GREEN) + typecheck + suite**

Run: `pnpm --filter piattaforma exec vitest run src/app/wallet/actions.test.ts` → PASS.
Run: `pnpm --filter piattaforma run typecheck` → PASS.
Run: `pnpm --filter piattaforma test` → green.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/auth/email-templates.ts apps/piattaforma/src/app/wallet/actions.ts apps/piattaforma/src/app/wallet/actions.test.ts
git commit -m "feat(wallet): gate mandato al primo payout + email OTP firma"
```

---

## Task 6: Azioni firma + modale

**Files:**
- Create: `apps/piattaforma/src/app/wallet/mandato-actions.ts`
- Create: `apps/piattaforma/src/app/wallet/mandato-firma-modal.tsx`
- Modify: `apps/piattaforma/src/app/wallet/payout-button.tsx`
- Modify: la pagina che renderizza `PayoutButton` (`app/wallet/page.tsx`) per passare i dati azienda + `isOwner`.

**Interfaces:**
- Consumes: `buildMandatoFatturazionePdf` (Task 4), `generaCodiceOtp`/`otpScaduto`/`OTP_TTL_MS` (Task 3), `tplOtpMandato` (Task 5), `pvEmittente`/`snapshotCompany` (`@/lib/fatturazione/pv-emittente`), `getStorage`/`storageGetBuffer` (`@/lib/providers/storage`), `getEmail` (`@/lib/providers/email`), `hashPassword`/`verifyPassword` (`@/lib/auth/password`), `isOwner` (`@/lib/auth/permissions`), `BRAND` (`@/lib/seo/brand`), `env`.
- Produces:
  - `inviaOtpMandatoAction(): Promise<{ ok: true } | { ok: false; error: string }>`
  - `firmaMandatoAction(codice: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Server actions**

Crea `apps/piattaforma/src/app/wallet/mandato-actions.ts`:

```typescript
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { env } from '@/env';
import { isOwner } from '@/lib/auth/permissions';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { getEmail } from '@/lib/providers/email';
import { getStorage } from '@/lib/providers/storage';
import { generaCodiceOtp, otpScaduto, OTP_TTL_MS } from '@/lib/contratti/otp';
import { buildMandatoFatturazionePdf } from '@/lib/contratti/mandato-pdf';
import { tplOtpMandato } from '@/lib/auth/email-templates';
import { pvEmittente, snapshotCompany } from '@/lib/fatturazione/pv-emittente';

type Esito = { ok: true } | { ok: false; error: string };

async function utenteTitolare() {
  const session = await auth();
  const u = session?.user;
  if (!u || !u.companyId) return null;
  if (!isOwner(u.role as string)) return null;
  return { id: u.id as string, email: u.email as string, companyId: u.companyId as string };
}

/** Genera e invia un codice OTP all'email del titolare per firmare il mandato. */
export async function inviaOtpMandatoAction(): Promise<Esito> {
  const u = await utenteTitolare();
  if (!u) return { ok: false, error: 'Solo il titolare può firmare il mandato' };

  const codice = generaCodiceOtp();
  const hash = await hashPassword(codice);
  await prisma.user.update({
    where: { id: u.id },
    data: { mandatoOtpHash: hash, mandatoOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  const content = tplOtpMandato({ codice });
  await getEmail().send({
    to: u.email,
    from: env.EMAIL_FROM,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tag: 'OTP_MANDATO',
  });
  return { ok: true };
}

/** Verifica l'OTP, genera il PDF del mandato, lo salva e crea il record firmato. */
export async function firmaMandatoAction(codice: string): Promise<Esito> {
  const u = await utenteTitolare();
  if (!u) return { ok: false, error: 'Solo il titolare può firmare il mandato' };

  // Idempotente: se già firmato, ok.
  const esistente = await prisma.mandatoFatturazione.findUnique({ where: { companyId: u.companyId }, select: { id: true } });
  if (esistente) {
    revalidatePath('/wallet');
    return { ok: true };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: u.id },
    select: { nome: true, cognome: true, mandatoOtpHash: true, mandatoOtpExpiresAt: true },
  });
  if (!dbUser?.mandatoOtpHash || otpScaduto(dbUser.mandatoOtpExpiresAt)) {
    return { ok: false, error: 'Codice scaduto: richiedine uno nuovo' };
  }
  if (!(await verifyPassword(codice.trim(), dbUser.mandatoOtpHash))) {
    return { ok: false, error: 'Codice non valido' };
  }

  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: { ragioneSociale: true, partitaIva: true, codiceSdi: true, pec: true, indirizzo: true, cap: true, citta: true, provincia: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };

  const mandante = snapshotCompany(company);
  const mandatario = pvEmittente();
  const rappresentante = `${dbUser.nome ?? ''} ${dbUser.cognome ?? ''}`.trim();
  const pvRappresentante = process.env.PV_RAPPRESENTANTE ?? 'Andrea Saino';
  const foro = mandatario.citta || 'Milano';
  const firmatoAt = new Date();

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip');

  const pdfBytes = await buildMandatoFatturazionePdf({
    mandante, mandanteRappresentante: rappresentante,
    mandatario, mandatarioRappresentante: pvRappresentante,
    foro, firmatoAt, otpAudit: { ip: ip ?? null },
  });

  const stored = await getStorage().put({
    scope: 'mandati',
    buffer: Buffer.from(pdfBytes),
    mimeType: 'application/pdf',
    originalFilename: `mandato-fatturazione-${u.companyId}.pdf`,
  });

  await prisma.mandatoFatturazione.create({
    data: {
      companyId: u.companyId,
      firmatarioUserId: u.id,
      firmatoAt,
      storageKey: stored.storageKey,
      storageProvider: stored.storageProvider,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      datiSnapshot: { mandante, mandatario, firmatario: { nome: dbUser.nome, cognome: dbUser.cognome }, foro },
      ip: ip ?? null,
      userAgent: hdrs.get('user-agent'),
      otpVerificatoAt: firmatoAt,
    },
  });

  // Consuma l'OTP.
  await prisma.user.update({ where: { id: u.id }, data: { mandatoOtpHash: null, mandatoOtpExpiresAt: null } });
  revalidatePath('/wallet');
  return { ok: true };
}
```

> Verifica la firma reale di `getStorage().put(...)` (input `StoragePutInput`: `{ scope, buffer, mimeType, originalFilename }`, output `{ storageKey, storageProvider, sizeBytes, ... }`) e adegua i nomi campo se differiscono. Verifica che `session.user` esponga `id`, `email`, `role`, `companyId` (usati altrove nel repo).

- [ ] **Step 2: Modale firma (client)**

Crea `apps/piattaforma/src/app/wallet/mandato-firma-modal.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviaOtpMandatoAction, firmaMandatoAction } from './mandato-actions';

export function MandatoFirmaModal({
  open, onClose, isTitolare, ragioneSociale,
}: {
  open: boolean; onClose: () => void; isTitolare: boolean; ragioneSociale: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [codice, setCodice] = useState('');
  const [otpInviato, setOtpInviato] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const inviaOtp = () => {
    setError(null);
    start(async () => {
      const r = await inviaOtpMandatoAction();
      if (!r.ok) setError(r.error);
      else setOtpInviato(true);
    });
  };
  const firma = () => {
    setError(null);
    start(async () => {
      const r = await firmaMandatoAction(codice);
      if (!r.ok) setError(r.error);
      else { setDone(true); router.refresh(); }
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-[18px] font-bold text-pv-navy-900">Mandato per fatturazione per conto terzi</h2>
        <p className="mt-2 text-[13px] text-pv-slate-600">
          Per richiedere il payout devi prendere visione e firmare il mandato che autorizza
          Passaggio Veloce a emettere fatture per conto di <strong>{ragioneSociale}</strong>.
          La firma avviene tramite codice OTP inviato alla tua email.
        </p>

        {!isTitolare ? (
          <p className="mt-4 rounded-lg bg-pv-red-50 p-3 text-[13px] text-pv-red-500">
            La firma del mandato spetta al titolare/amministratore dell&apos;azienda.
          </p>
        ) : done ? (
          <p className="mt-4 rounded-lg bg-pv-green-50 p-3 text-[13px] font-semibold text-pv-green-500">
            Mandato firmato. Ora puoi richiedere il payout.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {!otpInviato ? (
              <button type="button" onClick={inviaOtp} disabled={pending}
                className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? 'Invio…' : 'Invia codice via email'}
              </button>
            ) : (
              <>
                <p className="text-[12.5px] text-pv-slate-500">Inserisci il codice ricevuto via email.</p>
                <input value={codice} onChange={(e) => setCodice(e.target.value)} inputMode="numeric" maxLength={6}
                  placeholder="000000" disabled={pending}
                  className="w-40 rounded-lg border border-pv-slate-200 px-3 py-2 text-center text-lg tracking-widest" />
                <div className="flex gap-2">
                  <button type="button" onClick={firma} disabled={pending || codice.length < 6}
                    className="rounded-lg bg-pv-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {pending ? 'Firma…' : 'Firma il mandato'}
                  </button>
                  <button type="button" onClick={inviaOtp} disabled={pending}
                    className="rounded-lg px-3 py-2 text-sm text-pv-slate-600">Reinvia codice</button>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-[13px] text-pv-red-500">{error}</p>}
        <div className="mt-5 text-right">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-pv-slate-600">
            {done ? 'Chiudi' : 'Annulla'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Allinea le classi/colori ai token reali del design system (`pv-orange-500`, `pv-green-50`, ecc.); se un token non esiste, usa quelli realmente presenti (vedi `globals.css`).

- [ ] **Step 3: Wiring in `payout-button.tsx`**

Sostituisci `payout-button.tsx` per gestire `requireMandato` e i dati azienda:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { richiediPayoutAction } from './actions';
import { MandatoFirmaModal } from './mandato-firma-modal';

export function PayoutButton({
  disabled, isTitolare, ragioneSociale,
}: {
  disabled: boolean; isTitolare: boolean; ragioneSociale: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mandatoOpen, setMandatoOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handle() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await richiediPayoutAction();
      if (res.ok) { setSuccess("Richiesta inviata. L'admin la processerà a breve."); return; }
      if ('requireMandato' in res) { setMandatoOpen(true); return; }
      setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={handle} disabled={disabled || pending}
        className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? 'Invio…' : 'Richiedi payout'}
      </button>
      {error && <p className="text-xs text-pv-red-500">{error}</p>}
      {success && <p className="text-xs text-pv-green-500">{success}</p>}
      <MandatoFirmaModal
        open={mandatoOpen}
        onClose={() => setMandatoOpen(false)}
        isTitolare={isTitolare}
        ragioneSociale={ragioneSociale}
      />
    </div>
  );
}
```

- [ ] **Step 4: Passare i nuovi prop dalla pagina wallet**

In `app/wallet/page.tsx`, dove si renderizza `<PayoutButton disabled={...} />`, aggiungi i prop. Carica (se non già presente) la `company` dell'utente (`ragioneSociale`) e calcola `isTitolare` da `isOwner(session.user.role)`:

```tsx
  <PayoutButton
    disabled={/* esistente */ false}
    isTitolare={isOwner(session.user.role as string)}
    ragioneSociale={company.ragioneSociale}
  />
```

Importa `isOwner` da `@/lib/auth/permissions`. Recupera `company.ragioneSociale` con una query mirata se la pagina non ha già la company. (Adegua al modo in cui la pagina ottiene sessione/azienda.)

- [ ] **Step 5: Typecheck + suite**

Run: `pnpm --filter piattaforma run typecheck` → PASS.
Run: `pnpm --filter piattaforma test` → green.

> Nota: actions di firma e modale non hanno unit test dedicati (server-action con auth/PDF/storage + UI React — fuori dal pattern del repo; la logica core OTP/PDF è coperta da Task 3/4). Gate = typecheck + suite + verifica manuale (Task 7).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/wallet/mandato-actions.ts apps/piattaforma/src/app/wallet/mandato-firma-modal.tsx apps/piattaforma/src/app/wallet/payout-button.tsx apps/piattaforma/src/app/wallet/page.tsx
git commit -m "feat(wallet): modale firma mandato OTP al primo payout"
```

---

## Task 7: Pannello admin + download

**Files:**
- Modify: `apps/piattaforma/src/app/admin/companies/[id]/page.tsx`
- Create: `apps/piattaforma/src/app/api/admin/mandato/[companyId]/pdf/route.ts`

**Interfaces:**
- Consumes: `storageGetBuffer` (`@/lib/providers/storage`), `isAdminPiattaforma`/auth admin guard (pattern esistente nelle route admin).

- [ ] **Step 1: Caricare il mandato nella pagina admin**

In `admin/companies/[id]/page.tsx`, aggiungi `mandatoFatturazione` all'`include` della `company.findUnique`:

```typescript
    mandatoFatturazione: {
      include: { firmatario: { select: { nome: true, cognome: true, email: true } } },
    },
```

- [ ] **Step 2: Renderizzare la sezione mandato**

Dopo la sezione dati aziendali, aggiungi una card (usa i componenti `Card`/markup già presenti nella pagina):

```tsx
  <section className="mt-6 rounded-2xl border border-pv-slate-200 bg-white p-5">
    <h2 className="text-[13px] font-bold uppercase tracking-wider text-pv-slate-500">
      Mandato fatturazione conto terzi
    </h2>
    {company.mandatoFatturazione ? (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-pv-slate-700">
        <div>
          <p className="font-semibold text-pv-green-600">Firmato</p>
          <p className="text-pv-slate-500">
            da {company.mandatoFatturazione.firmatario.nome} {company.mandatoFatturazione.firmatario.cognome}
            {' · '}il {formatDate(company.mandatoFatturazione.firmatoAt)}
          </p>
        </div>
        <a
          href={`/api/admin/mandato/${company.id}/pdf`}
          className="rounded-lg bg-pv-navy-700 px-3 py-1.5 text-sm font-semibold text-white"
        >
          Scarica PDF
        </a>
      </div>
    ) : (
      <p className="mt-3 text-[13px] text-pv-slate-500">Non ancora firmato.</p>
    )}
  </section>
```

> Usa l'helper `formatDate` già importato nella pagina (o `@/lib/format`).

- [ ] **Step 3: Route download admin-only**

Crea `apps/piattaforma/src/app/api/admin/mandato/[companyId]/pdf/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { storageGetBuffer } from '@/lib/providers/storage';

export async function GET(_req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user.role as string)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { companyId } = await params;
  const mandato = await prisma.mandatoFatturazione.findUnique({
    where: { companyId },
    select: { storageKey: true },
  });
  if (!mandato) return new NextResponse('Not found', { status: 404 });

  const buffer = await storageGetBuffer(mandato.storageKey);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="mandato-${companyId}.pdf"`,
    },
  });
}
```

> Verifica il nome reale del guard admin (`isAdminPiattaforma` in `@/lib/auth/permissions` — usato nelle action admin come `risolviRevisioneAction`). Se il nome differisce, adegua.

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm --filter piattaforma run typecheck` → PASS.
Run: `pnpm --filter piattaforma test` → green.

- [ ] **Step 5: Verifica manuale (deferibile a preview/prod)**

Con provider console (dev): come broker (titolare) richiedi il payout senza mandato → compare la modale → «Invia codice» (codice in console) → inserisci → «Firma» → record creato, payout sbloccato. Ripeti come agenzia. Da `/admin/companies/[id]` verifica la sezione "Mandato firmato" + download del PDF. Verifica che un non-titolare veda il messaggio di blocco.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/companies/[id]/page.tsx "apps/piattaforma/src/app/api/admin/mandato/[companyId]/pdf/route.ts"
git commit -m "feat(admin): sezione mandato firmato + download PDF"
```

---

## Self-Review (eseguita in fase di scrittura)

**Spec coverage:**
- Modale obbligatoria al primo payout (broker+agenzia, stesso flusso) → Task 5 (gate) + Task 6 (modale). ✓
- Contratto dinamico sui dati del firmatario → Task 4 (PDF da snapshot) + Task 2 (clausole). ✓
- Firma via OTP email → Task 3 (OTP) + Task 5 (email) + Task 6 (azioni). ✓
- Salvato sull'utenza con data → Task 1 (`MandatoFatturazione`) + Task 6 (create con firmatoAt/snapshot/audit). ✓
- Visibile da pannello admin → Task 7. ✓
- Una volta per azienda (`companyId @unique`) → Task 1 + idempotenza in firmaMandatoAction. ✓
- Solo titolare firma (`isOwner`) → Task 6 (utenteTitolare) + modale. ✓
- Documento nel progetto → `.docx` copiato in `docs/contratti` (commit spec) + testo in `testo.ts`. ✓

**Placeholder scan:** nessun TBD; ogni step ha codice/comando. Le note "verifica il nome reale di X" sono istruzioni di integrazione con anchor precisi, non placeholder logici.

**Type consistency:** `MandatoPdfInput`/`buildMandatoFatturazionePdf`, `generaCodiceOtp`/`otpScaduto`/`OTP_TTL_MS`, `tplOtpMandato`, `PayoutResult` (+requireMandato), `inviaOtpMandatoAction`/`firmaMandatoAction`, modello `MandatoFatturazione` (campi) usati coerentemente tra i task. ✓
