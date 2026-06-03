# Email di registrazione + allineamento email auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inviare un'email di conferma registrazione (benvenuto differenziato dealer/agenzia + link verifica) e allineare reset-password e invito-team al layout email istituzionale.

**Architecture:** Nuovo modulo `lib/auth/email-templates.ts` con funzioni pure `(payload) => {subject,html,text}` costruite con `emailLayout`/`ctaButton` (da `@/lib/notifiche/layout`). I call-site (`registerAction`, `requestPasswordResetAction`, `team/actions.ts`) usano queste funzioni. Invio registrazione best-effort non bloccante.

**Tech Stack:** TypeScript, Next.js server actions, Vitest. Provider email Resend (prod).

**Spec:** `docs/superpowers/specs/2026-06-03-email-registrazione-design.md`

---

## File Structure

- Create `apps/piattaforma/src/lib/auth/email-templates.ts` — `tplRegistrazioneConferma`, `tplResetPassword`, `tplInvitoTeam`, helper `authLayout`.
- Create `apps/piattaforma/src/lib/auth/email-templates.test.ts` — unit puri.
- Modify `apps/piattaforma/src/app/(auth)/actions.ts` — invio email registrazione (best-effort) + reset usa `tplResetPassword`.
- Modify `apps/piattaforma/src/app/team/actions.ts` — invito usa `tplInvitoTeam`.

---

## Task 1: Modulo email-templates.ts (3 template auth)

**Files:**
- Create: `apps/piattaforma/src/lib/auth/email-templates.ts`
- Test: `apps/piattaforma/src/lib/auth/email-templates.test.ts`

- [ ] **Step 1: Scrivi i test (RED)** — `email-templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tplRegistrazioneConferma, tplResetPassword, tplInvitoTeam } from './email-templates';

describe('tplRegistrazioneConferma', () => {
  const base = {
    nome: 'Mario', ragioneSociale: 'Rossi Auto', verifyUrl: 'https://pv.it/verify-email?token=abc',
    loginUrl: 'https://pv.it/login',
  } as const;

  it('usa il layout istituzionale e i dati utente, senza token unsub', () => {
    const { html, subject } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: true });
    expect(subject).toContain('Rossi Auto');
    expect(html).toContain('logo-email.png');
    expect(html).toContain('Passaggio Veloce SRL');
    expect(html).toContain('Mario');
    expect(html).not.toContain('<!--PV_UNSUB-->');
  });

  it('DEALER mostra il copy dealer e non quello agenzia', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: true });
    expect(html).toContain('creare pratiche');
    expect(html).not.toContain('ricevi le pratiche dei dealer');
  });

  it('AGENZIA mostra il copy agenzia e non quello dealer', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'AGENZIA', needsVerification: true });
    expect(html).toContain('ricevi le pratiche dei dealer');
    expect(html).not.toContain('creare pratiche');
  });

  it('needsVerification=true → CTA verso verifyUrl con label di conferma', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: true });
    expect(html).toContain('https://pv.it/verify-email?token=abc');
    expect(html).toContain('Conferma');
    expect(html).toContain('24 ore');
  });

  it('needsVerification=false → CTA verso login + nota account attivo', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: false });
    expect(html).toContain('https://pv.it/login');
    expect(html).toContain('già attivo');
    expect(html).not.toContain('verify-email');
  });
});

describe('tplResetPassword', () => {
  it('layout + CTA verso resetUrl, niente token unsub', () => {
    const { html, subject } = tplResetPassword({ resetUrl: 'https://pv.it/reset-password?token=z' });
    expect(subject).toContain('password');
    expect(html).toContain('logo-email.png');
    expect(html).toContain('https://pv.it/reset-password?token=z');
    expect(html).not.toContain('<!--PV_UNSUB-->');
  });
});

describe('tplInvitoTeam', () => {
  it('layout + CTA verso inviteUrl + ragione sociale', () => {
    const { html, subject } = tplInvitoTeam({ ragioneSociale: 'Rossi Auto', inviteUrl: 'https://pv.it/invito/t' });
    expect(subject).toContain('Rossi Auto');
    expect(html).toContain('https://pv.it/invito/t');
    expect(html).toContain('Rossi Auto');
    expect(html).not.toContain('<!--PV_UNSUB-->');
  });
});
```

- [ ] **Step 2: Run test (RED)**

Run: `pnpm --filter piattaforma test -- src/lib/auth/email-templates.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementa `email-templates.ts`**:

```ts
import { emailLayout, ctaButton } from '@/lib/notifiche/layout';
import { escapeHtml } from '@/lib/escape-html';

export type EmailContent = { subject: string; html: string; text: string };

/** Layout per email auth/transazionali: niente riga disiscrizione → rimuove il token footer. */
function authLayout(body: string): string {
  return emailLayout(body).replace('<!--PV_UNSUB-->', '');
}

export type RegistrazioneConfermaPayload = {
  nome: string;
  ragioneSociale: string;
  tipo: 'DEALER' | 'AGENZIA';
  verifyUrl: string;
  loginUrl: string;
  needsVerification: boolean;
};

export function tplRegistrazioneConferma(p: RegistrazioneConfermaPayload): EmailContent {
  const subject = `Benvenuto in Passaggio Veloce, ${p.ragioneSociale}`;
  const ruoloBlock =
    p.tipo === 'DEALER'
      ? "Da ora puoi creare pratiche di passaggio di proprietà e affidarle alle agenzie della tua zona: carichi il libretto, l'IA prepara il dossier e ricevi gli aggiornamenti fino alla firma."
      : 'Da ora ricevi le pratiche dei dealer nella tua zona: accetti quelle che ti interessano, le lavori e confermi la firma per incassare la fee.';
  const cta = p.needsVerification
    ? ctaButton(p.verifyUrl, 'Conferma il tuo indirizzo email →')
    : ctaButton(p.loginUrl, 'Vai al login →');
  const ctaNote = p.needsVerification ? 'Il link è valido 24 ore.' : 'Il tuo account è già attivo.';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Benvenuto in Passaggio Veloce</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nome)}</strong>,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">la registrazione di <strong>${escapeHtml(p.ragioneSociale)}</strong> è andata a buon fine. ${ruoloBlock}</p>
    ${cta}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">${ctaNote}</p>
  `);
  const text =
    `Ciao ${p.nome},\n` +
    `la registrazione di ${p.ragioneSociale} è andata a buon fine. ${ruoloBlock}\n\n` +
    (p.needsVerification
      ? `Conferma il tuo indirizzo email (valido 24 ore): ${p.verifyUrl}`
      : `Il tuo account è già attivo. Accedi: ${p.loginUrl}`);
  return { subject, html, text };
}

export function tplResetPassword(p: { resetUrl: string }): EmailContent {
  const subject = 'Passaggio Veloce — Reimposta la tua password';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Reimposta la password</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">Hai richiesto di reimpostare la password del tuo account Passaggio Veloce.</p>
    ${ctaButton(p.resetUrl, 'Reimposta la password →')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Il link è valido 2 ore. Se non sei stato tu, ignora questa email.</p>
  `);
  const text = `Reimposta la password del tuo account Passaggio Veloce (valido 2 ore): ${p.resetUrl}\nSe non sei stato tu, ignora questa email.`;
  return { subject, html, text };
}

export function tplInvitoTeam(p: { ragioneSociale: string; inviteUrl: string }): EmailContent {
  const subject = `Sei stato invitato in ${p.ragioneSociale}`;
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Invito a ${escapeHtml(p.ragioneSociale)}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">Sei stato invitato a unirti a <strong>${escapeHtml(p.ragioneSociale)}</strong> su Passaggio Veloce. Imposta la tua password per accedere.</p>
    ${ctaButton(p.inviteUrl, 'Attiva il tuo account →')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Il link è valido 7 giorni.</p>
  `);
  const text = `Sei stato invitato in ${p.ragioneSociale} su Passaggio Veloce. Attiva il tuo account (valido 7 giorni): ${p.inviteUrl}`;
  return { subject, html, text };
}
```

- [ ] **Step 4: Run test (GREEN) + typecheck + lint**

Run: `pnpm --filter piattaforma test -- src/lib/auth/email-templates.test.ts && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/auth/email-templates.ts apps/piattaforma/src/lib/auth/email-templates.test.ts
git commit -m "feat(auth): template email registrazione/reset/invito con layout istituzionale"
```
(trailer: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>)

Self-review, report STATUS.

---

## Task 2: Invio email registrazione in registerAction (best-effort)

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts` (blocco finale di `registerAction`, ~404-408)

- [ ] **Step 1: Leggi** la fine di `registerAction` (~380-415) per confermare che a quel punto sono in scope: `account.nome`, `company.type` (valore `'DEALER' | 'AGENZIA'`), `company.ragioneSociale`, `emailLower`, `verificationToken`, e `env`.

- [ ] **Step 2: Implementa** — sostituisci il blocco commento TODO (`// TODO Fase 6 ...` fino a prima di `return { ok: true, emailVerificationToken: verificationToken };`) con un invio best-effort:

```ts
    // Email di conferma registrazione (best-effort: un errore non blocca la registrazione).
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const { getEmail } = await import('@/lib/providers/email');
      const { tplRegistrazioneConferma } = await import('@/lib/auth/email-templates');
      const mail = tplRegistrazioneConferma({
        nome: account.nome,
        ragioneSociale: company.ragioneSociale,
        tipo: company.type,
        verifyUrl: `${appUrl}/verify-email?token=${verificationToken}`,
        loginUrl: `${appUrl}/login`,
        needsVerification: !env.DEMO_MODE,
      });
      await getEmail().send({
        to: emailLower,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tag: 'registrazione',
      });
    } catch (e) {
      console.warn('[registrazione] invio email conferma fallito', (e as Error).message);
    }

    return { ok: true, emailVerificationToken: verificationToken };
```

   - If `company.type` is typed more loosely than `'DEALER' | 'AGENZIA'`, narrow/cast appropriately (it comes from the validated registration schema — check the schema's enum). Keep typecheck clean.

- [ ] **Step 3: Run** full suite + typecheck + lint.

Run: `pnpm --filter piattaforma test && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: existing tests still PASS (the early-return tests in actions.test.ts don't reach this block), typecheck/lint clean.

Note: a full happy-path integration test of `registerAction` is intentionally NOT added — the existing `actions.test.ts` covers only early returns and mocking the entire transaction + storage + tokens for this one best-effort send is disproportionate and brittle. The send is covered by Task 1 template unit tests, the best-effort guard is trivial `try/catch`, and Task 5 validates with a real Resend send. (Documented deviation from spec's optional test.)

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/actions.ts
git commit -m "feat(auth): invia email conferma registrazione (best-effort) in registerAction"
```
(trailer as above)

Self-review (confirm best-effort: send errors are caught; return value unchanged). Report STATUS.

---

## Task 3: Reset password usa tplResetPassword

**Files:**
- Modify: `apps/piattaforma/src/app/(auth)/actions.ts` (`requestPasswordResetAction`, ~494-510)

- [ ] **Step 1: Implementa** — nella `requestPasswordResetAction`, dopo aver calcolato `link` (= `${appUrl}/reset-password?token=${token}`), sostituisci l'oggetto inline passato a `getEmail().send({...})` con l'uso del template:

```ts
  const { getEmail } = await import('@/lib/providers/email');
  const { tplResetPassword } = await import('@/lib/auth/email-templates');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${appUrl}/reset-password?token=${token}`;
  const mail = tplResetPassword({ resetUrl: link });
  await getEmail().send({ to: emailLower, subject: mail.subject, html: mail.html, text: mail.text, tag: 'password-reset' });
```

   (Rimuovi l'HTML inline precedente. Mantieni invariata la logica intorno: creazione token, ritorno `demoToken`.)

- [ ] **Step 2: Run** full suite + typecheck + lint → verde.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/(auth)/actions.ts
git commit -m "refactor(auth): reset password usa template con layout istituzionale"
```

Self-review, report STATUS.

---

## Task 4: Invito team usa tplInvitoTeam

**Files:**
- Modify: `apps/piattaforma/src/app/team/actions.ts` (~67-81)

- [ ] **Step 1: Implementa** — sostituisci l'oggetto inline `getEmail().send({...})` con:

```ts
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${appUrl}/invito/${token}`;
  const { tplInvitoTeam } = await import('@/lib/auth/email-templates');
  const mail = tplInvitoTeam({
    ragioneSociale: company?.ragioneSociale ?? 'Passaggio Veloce',
    inviteUrl: link,
  });
  await getEmail().send({ to: emailLower, subject: mail.subject, html: mail.html, text: mail.text, tag: 'invitation' });
```

   (`getEmail` è già importato in team/actions.ts; rimuovi l'HTML inline. Mantieni `revalidatePath` e il ritorno `demoLink`.)

- [ ] **Step 2: Run** full suite + typecheck + lint → verde.

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/team/actions.ts
git commit -m "refactor(team): invito team usa template con layout istituzionale"
```

Self-review, report STATUS.

---

## Task 5: Verifica finale + preview + invio reale + deploy

- [ ] **Step 1: Suite completa**

Run: `pnpm --filter piattaforma test && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: tutto verde.

- [ ] **Step 2: Preview HTML reale** — genera (via test usa-e-getta come fatto per il layout, che risolve gli alias `@/` e mocka server-only) un `email-preview.html` con i 3 template renderizzati (`tplRegistrazioneConferma` DEALER+verify, AGENZIA+verify, e needsVerification=false; `tplResetPassword`; `tplInvitoTeam`), sostituendo l'URL logo prod col file locale. Apri e verifica visivamente. Rimuovi il test generatore e il file html dopo.

- [ ] **Step 3: Deploy** — questo lavoro è su un branch dedicato; merge → `main` → push (deploy Vercel). Nessuna migrazione DB.

- [ ] **Step 4: Invio reale di prova** — dopo il deploy (logo già online), invia di prova a `assistenza@passaggioveloce.it` la `tplRegistrazioneConferma` (DEALER, needsVerification=true) via Resend (genera html con test usa-e-getta → script node `--env-file=.env.local` con SDK Resend, come fatto per il layout). Verifica inbox: logo, copy dealer, CTA verifica. Rimuovi gli script usa-e-getta.

---

## Note esecuzione
- DRY: tutto l'HTML email auth in `email-templates.ts`, costruito con `emailLayout`/`ctaButton`. YAGNI: niente seconda email post-verifica. TDD: test prima su Task 1. Commit per task. Branch dedicato → merge → deploy come da [[project-prod-release-process]].
