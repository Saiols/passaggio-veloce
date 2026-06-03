# Restyle layout email istituzionale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rifare header/footer condivisi delle email transazionali (banda navy + logo PNG due-toni + keyline arancio + footer istituzionale) mantenendo invariati i corpi dei ~28 template.

**Architecture:** Nuovo modulo `lib/notifiche/layout.ts` (`emailLayout`, `ctaButton`, `unsubscribeFooterLine`) table-based (compatibile Outlook). `wrap()` in `templates.ts` delega a `emailLayout` → firma invariata, zero modifiche ai template. Dati legali centralizzati in `lib/seo/brand.ts`. La riga disiscrizione/preferenze viene iniettata nel footer da `send.ts` via token placeholder, solo per le notifiche opzionali.

**Tech Stack:** TypeScript, Next.js, Vitest. Email HTML inline-styled, table-based. Logo PNG generato da SVG.

**Spec:** `docs/superpowers/specs/2026-06-03-email-layout-istituzionale-design.md`

---

## File Structure

- Modify `apps/piattaforma/src/lib/seo/brand.ts` — aggiunge `piva`, `sede`, `supportEmail`, `tel`.
- Modify `apps/piattaforma/src/lib/seo/brand.test.ts` — asserisce i nuovi campi.
- Create `apps/piattaforma/src/lib/notifiche/layout.ts` — `emailLayout`, `ctaButton`, `unsubscribeFooterLine`, header/footer interni.
- Create `apps/piattaforma/src/lib/notifiche/layout.test.ts` — test struttura layout.
- Modify `apps/piattaforma/src/lib/notifiche/templates.ts` — `wrap()` delega a `emailLayout`; N31 usa `ctaButton`; rimuove vecchi `header`/`footer`/`wrap` interni.
- Modify `apps/piattaforma/src/lib/notifiche/send.ts` — inietta `unsubscribeFooterLine` nel token `<!--PV_UNSUB-->` (solo opzionali) e aggiunge link Preferenze.
- Create `apps/piattaforma/public/brand/logo-email.svg` — artwork due-toni su navy.
- Create `apps/piattaforma/public/brand/logo-email.png` — raster @2x del precedente.

---

## Task 1: Dati legali/contatti in brand.ts

**Files:**
- Modify: `apps/piattaforma/src/lib/seo/brand.ts`
- Test: `apps/piattaforma/src/lib/seo/brand.test.ts`

- [ ] **Step 1: Leggi brand.ts** per vedere la forma esatta dell'oggetto `BRAND` (campi esistenti `legalName`, `shortName`, `url`, `description`) e lo stile (`as const`).

- [ ] **Step 2: Scrivi il test (RED)** — aggiungi a `brand.test.ts`:

```ts
it('espone i dati legali/contatti per il footer email', () => {
  expect(BRAND.legalName).toBe('Passaggio Veloce SRL');
  expect(BRAND.piva).toBe('14688390963');
  expect(BRAND.sede).toBe('Via delle Querce 5 — 20057 Assago (MI)');
  expect(BRAND.supportEmail).toBe('assistenza@passaggioveloce.it');
  expect(BRAND.tel).toBe('+39 346 287 7310');
});
```

- [ ] **Step 3: Run test (verifica fallimento)**

Run: `pnpm --filter piattaforma test -- src/lib/seo/brand.test.ts`
Expected: FAIL (proprietà undefined).

- [ ] **Step 4: Implementa** — aggiungi i campi all'oggetto `BRAND` (mantieni `as const` e i campi esistenti):

```ts
  piva: '14688390963',
  sede: 'Via delle Querce 5 — 20057 Assago (MI)',
  supportEmail: 'assistenza@passaggioveloce.it',
  tel: '+39 346 287 7310',
```

- [ ] **Step 5: Run test (verifica successo)**

Run: `pnpm --filter piattaforma test -- src/lib/seo/brand.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/seo/brand.ts apps/piattaforma/src/lib/seo/brand.test.ts
git commit -m "feat(brand): dati legali/contatti per footer email"
```

---

## Task 2: Modulo layout.ts (emailLayout + ctaButton + unsubscribeFooterLine)

**Files:**
- Create: `apps/piattaforma/src/lib/notifiche/layout.ts`
- Test: `apps/piattaforma/src/lib/notifiche/layout.test.ts`

- [ ] **Step 1: Scrivi i test (RED)** — `layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emailLayout, ctaButton, unsubscribeFooterLine } from './layout';

describe('emailLayout', () => {
  const out = emailLayout('<h1>Ciao</h1>');

  it('inserisce il corpo dentro la card', () => {
    expect(out).toContain('<h1>Ciao</h1>');
  });
  it('usa header navy + keyline arancio (table-based, niente flex)', () => {
    expect(out).toContain('#0a2540');
    expect(out).toContain('#ff7a00');
    expect(out).not.toContain('display:flex');
  });
  it('referenzia il logo PNG via URL assoluto con alt', () => {
    expect(out).toContain('https://passaggioveloce.it/brand/logo-email.png');
    expect(out).toContain('alt="Passaggio Veloce"');
  });
  it('footer con dati legali completi', () => {
    expect(out).toContain('Passaggio Veloce SRL');
    expect(out).toContain('14688390963');
    expect(out).toContain('Via delle Querce 5');
    expect(out).toContain('assistenza@passaggioveloce.it');
    expect(out).toContain('+39 346 287 7310');
  });
  it('include il token unsubscribe per iniezione da send.ts', () => {
    expect(out).toContain('<!--PV_UNSUB-->');
  });
});

describe('ctaButton', () => {
  it('rende un bottone arancio con href e label', () => {
    const b = ctaButton('https://x.it/p', 'Valuta →');
    expect(b).toContain('https://x.it/p');
    expect(b).toContain('Valuta →');
    expect(b).toContain('#ff7a00');
  });
  it('fa escaping di href e label', () => {
    const b = ctaButton('https://x.it/?a=1&b=2', '<script>');
    expect(b).toContain('a=1&amp;b=2');
    expect(b).not.toContain('<script>');
  });
});

describe('unsubscribeFooterLine', () => {
  it('contiene link disiscrizione e preferenze', () => {
    const l = unsubscribeFooterLine('https://x.it/u?t=1', 'https://x.it/profilo/notifiche');
    expect(l).toContain('https://x.it/u?t=1');
    expect(l).toContain('https://x.it/profilo/notifiche');
    expect(l).toContain('Disiscriviti');
    expect(l).toContain('Preferenze');
  });
});
```

- [ ] **Step 2: Run test (verifica fallimento)**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/layout.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementa `layout.ts`**:

```ts
import { BRAND } from '@/lib/seo/brand';

const LOGO_URL = `${BRAND.url}/brand/logo-email.png`;
const NAVY = '#0a2540';
const ORANGE = '#ff7a00';
const BORDER = '#e2e8f0';
const hostLabel = BRAND.url.replace(/^https?:\/\//, '');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="border-radius:8px;background:${ORANGE}">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

export function unsubscribeFooterLine(unsubscribeUrl: string, preferencesUrl: string): string {
  return `<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid ${BORDER};font-size:11px;color:#94a3b8">Non vuoi più ricevere queste email? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8">Disiscriviti</a> · <a href="${escapeHtml(preferencesUrl)}" style="color:#94a3b8">Preferenze</a></p>`;
}

const headerCell = `<td style="background:${NAVY};border-radius:12px 12px 0 0;padding:16px 24px">
  <img src="${LOGO_URL}" alt="Passaggio Veloce" height="28" style="display:block;border:0;height:28px;width:auto">
</td>`;

const footerCell = `<td style="background:#f8fafc;border:1px solid ${BORDER};border-top:0;border-radius:0 0 12px 12px;padding:18px 24px;text-align:center">
  <p style="margin:0 0 6px;font-size:12px;color:#334155;font-weight:600">${BRAND.legalName} · P.IVA ${BRAND.piva}</p>
  <p style="margin:0 0 2px;font-size:11.5px;color:#64748b">${BRAND.sede}</p>
  <p style="margin:0 0 2px;font-size:11.5px;color:#64748b"><a href="mailto:${BRAND.supportEmail}" style="color:#0054a6;text-decoration:none">${BRAND.supportEmail}</a> · ${BRAND.tel}</p>
  <p style="margin:0;font-size:11.5px;color:#64748b"><a href="${BRAND.url}" style="color:#0054a6;text-decoration:none">${hostLabel}</a></p>
  <!--PV_UNSUB-->
</td>`;

export function emailLayout(body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
    <tr><td style="padding:20px">
      <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto">
        <tr>${headerCell}</tr>
        <tr><td style="height:3px;background:${ORANGE};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="background:#ffffff;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">${body}</td></tr>
        <tr>${footerCell}</tr>
      </table>
    </td></tr>
  </table>`;
}
```

- [ ] **Step 4: Run test (verifica successo)**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/layout.ts apps/piattaforma/src/lib/notifiche/layout.test.ts
git commit -m "feat(notifiche): layout email istituzionale (emailLayout + ctaButton + unsubscribe)"
```

---

## Task 3: `wrap()` delega a `emailLayout`; N31 usa `ctaButton`

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts`

- [ ] **Step 1: Scrivi il test (RED)** — crea `apps/piattaforma/src/lib/notifiche/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tplN1BrokerInvio, tplN31ValutaAgenzia } from './templates';

describe('templates usano il nuovo layout', () => {
  it('N1 contiene header navy, logo, footer legale', () => {
    const { html } = tplN1BrokerInvio({
      codicePratica: 'PV-1', targa: 'AB123CD', comune: 'Milano', provincia: 'MI',
      numeroAgenzie: 5, nomeBroker: 'Mario',
    });
    expect(html).toContain('logo-email.png');
    expect(html).toContain('Passaggio Veloce SRL');
    expect(html).toContain('<!--PV_UNSUB-->');
  });

  it('N31 usa il bottone CTA arancio verso praticaUrl', () => {
    const { html } = tplN31ValutaAgenzia({
      codicePratica: 'PV-1', targa: null, agenziaNome: 'Ag', nomeBroker: 'Mario',
      praticaUrl: 'https://passaggioveloce.it/pratiche/1',
    });
    expect(html).toContain('https://passaggioveloce.it/pratiche/1');
    expect(html).toContain('#ff7a00');
  });
});
```

- [ ] **Step 2: Run test (verifica fallimento)**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/templates.test.ts`
Expected: FAIL (il vecchio `wrap()` non contiene `logo-email.png` né il token).

- [ ] **Step 3: Implementa** — in `templates.ts`:
  1. In cima, importa: `import { emailLayout, ctaButton } from './layout';`
  2. **Rimuovi** le costanti `header`, `footer` e il vecchio corpo di `wrap` (le `const header = ...`, `const footer = ...`).
  3. Sostituisci `wrap` con:

```ts
function wrap(body: string): string {
  return emailLayout(body);
}
```

  4. In `tplN31ValutaAgenzia`, sostituisci il blocco `<p>...<a ...>Valuta l'agenzia →</a></p>` con:

```ts
    ${ctaButton(p.praticaUrl, "Valuta l'agenzia →")}
```

  (Nota: `escapeHtml` locale in templates.ts resta, è usato altrove.)

- [ ] **Step 4: Run test (verifica successo)**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/templates.test.ts
git commit -m "feat(notifiche): wrap() delega a emailLayout + N31 con ctaButton"
```

---

## Task 4: Iniezione unsubscribe/preferenze nel footer (send.ts)

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts` (zona ~212-248, gating opzionali)

- [ ] **Step 1: Leggi send.ts** zona 205-275 per vedere il blocco attuale che appende l'unsubscribe (`html = html + '<p ...>'`) e come ottiene `url`, `token`, `env.NEXT_PUBLIC_APP_URL`.

- [ ] **Step 2: Implementa** — modifica il blocco opzionali:
  1. Importa in cima: `import { unsubscribeFooterLine } from './layout';`
  2. Dentro il ramo opzionale (dove oggi calcola `url`), sostituisci le due righe che appendono html/text con:

```ts
    const prefUrl = `${env.NEXT_PUBLIC_APP_URL}/profilo/notifiche`;
    html = html.replace('<!--PV_UNSUB-->', unsubscribeFooterLine(url, prefUrl));
    text = text + `\n\nPer non ricevere più queste email: ${url}\nGestisci le preferenze: ${prefUrl}`;
```

  3. Dopo l'intero blocco gating (prima dell'invio), rimuovi il token residuo per le notifiche NON opzionali:

```ts
  html = html.replace('<!--PV_UNSUB-->', '');
```

- [ ] **Step 3: Scrivi/aggiorna test** — se esiste `send.test.ts`, aggiungi un caso che verifica: per una notifica opzionale l'html finale contiene il link unsubscribe DENTRO il footer (dopo `assistenza@`), e per una non-opzionale NON contiene `<!--PV_UNSUB-->` né "Disiscriviti". Se non esiste un test agevole (richiede mock prisma pesante), aggiungi almeno un test puro che verifica `String.replace('<!--PV_UNSUB-->', ...)` produce l'output atteso usando `emailLayout('<p>x</p>')` + `unsubscribeFooterLine(...)`.

```ts
import { describe, it, expect } from 'vitest';
import { emailLayout, unsubscribeFooterLine } from './layout';

it('il token unsubscribe viene rimpiazzato dentro il footer', () => {
  const base = emailLayout('<p>x</p>');
  const withUnsub = base.replace('<!--PV_UNSUB-->', unsubscribeFooterLine('https://x/u', 'https://x/p'));
  expect(withUnsub).not.toContain('<!--PV_UNSUB-->');
  expect(withUnsub).toContain('Disiscriviti');
  const stripped = base.replace('<!--PV_UNSUB-->', '');
  expect(stripped).not.toContain('<!--PV_UNSUB-->');
  expect(stripped).not.toContain('Disiscriviti');
});
```

(Mettilo in `layout.test.ts`.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter piattaforma test -- src/lib/notifiche/layout.test.ts && pnpm --filter piattaforma typecheck`
Expected: PASS + typecheck pulito.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/send.ts apps/piattaforma/src/lib/notifiche/layout.test.ts
git commit -m "feat(notifiche): unsubscribe+preferenze integrati nel footer email"
```

---

## Task 5: Asset logo email (SVG + PNG)

**Files:**
- Create: `apps/piattaforma/public/brand/logo-email.svg`
- Create: `apps/piattaforma/public/brand/logo-email.png`

- [ ] **Step 1: Crea `logo-email.svg`** (artwork due-toni su navy: contorno documento bianco, linee documento arancio, saetta arancio, "Passaggio" bianco / "Veloce" arancio):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 64" role="img" aria-label="Passaggio Veloce">
  <g>
    <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#ffffff"/>
    <rect x="21" y="27" width="22" height="2" rx="1" fill="#ff7a00" opacity=".9"/>
    <rect x="21" y="33" width="26" height="2" rx="1" fill="#ff7a00" opacity=".9"/>
    <rect x="21" y="39" width="16" height="2" rx="1" fill="#ff7a00" opacity=".9"/>
    <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ff7a00" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
  </g>
  <g transform="translate(68 0) skewX(-6)">
    <text y="44" font-family="Geist, Inter, 'Helvetica Neue', Arial, sans-serif" font-style="italic" font-weight="900" font-size="30" letter-spacing="-0.5">
      <tspan fill="#ffffff">Passaggio</tspan><tspan fill="#ff7a00">Veloce</tspan>
    </text>
  </g>
</svg>
```

- [ ] **Step 2: Genera il PNG @2x** — crea uno script usa-e-getta `apps/piattaforma/gen-logo.mjs` e usa `sharp` (aggiungilo se serve: `pnpm --filter piattaforma add -D sharp`):

```js
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/brand/logo-email.svg');
// viewBox 380x64 → @2x ad altezza 64px reali = width ~380
await sharp(svg, { density: 384 }).resize({ height: 64 }).png().toFile('public/brand/logo-email.png');
console.log('logo-email.png generato');
```

Run: `cd apps/piattaforma && node gen-logo.mjs`

- [ ] **Step 3: Verifica visiva del PNG** — apri `apps/piattaforma/public/brand/logo-email.png` e conferma: sfondo trasparente, documento bianco, linee+saetta arancio, "Passaggio" bianco / "Veloce" arancio, testo nitido.
  - **Se il wordmark non rende il font** (testo mancante/sbagliato): fallback → rendi l'SVG nel browser (es. aprendolo) e cattura, oppure converti il `<text>` in tracciati. Il PNG deve risultare leggibile su fondo navy.

- [ ] **Step 4: Rimuovi lo script usa-e-getta**

Run: `rm apps/piattaforma/gen-logo.mjs`

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/public/brand/logo-email.svg apps/piattaforma/public/brand/logo-email.png apps/piattaforma/package.json pnpm-lock.yaml
git commit -m "feat(brand): asset logo-email (SVG + PNG @2x) per header email"
```

---

## Task 6: Preview HTML reale (verifica end-to-end visiva)

**Files:**
- Modify: `email-preview.html` (usa-e-getta, NON committato)

- [ ] **Step 1: Rigenera il preview dai template reali** — crea `apps/piattaforma/gen-preview.mjs` usa-e-getta che importa i template compilati e scrive l'HTML. Poiché i template importano `server-only`/`@/...`, è più semplice generare via `tsx` con alias; in alternativa aggiorna manualmente `email-preview.html` perché ora rispecchia esattamente l'output di `emailLayout` (header `<img>` → in locale il PNG è su disco: usa percorso assoluto `file://.../public/brand/logo-email.png` o l'URL prod). Obiettivo: vedere il rendering reale di N1, N4, N31, N6, N17.

- [ ] **Step 2: Apri e verifica** `email-preview.html` nel browser: header con logo, keyline, card, box semantici, CTA arancio (N31), footer istituzionale + riga disiscrizione su N31.

- [ ] **Step 3: (nessun commit)** — `email-preview.html` resta non tracciato/usa-e-getta.

---

## Task 7: Verifica finale + invio reale + deploy

- [ ] **Step 1: Suite completa**

Run: `pnpm --filter piattaforma test && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: tutto verde.

- [ ] **Step 2: Invio reale di prova via Resend** — con `apps/piattaforma/.env.local` (EMAIL_PROVIDER=resend già impostato), crea uno script usa-e-getta che chiama `getEmail().send()` con l'html di un template (es. `tplN1BrokerInvio(...).html`) verso `assistenza@passaggioveloce.it`. Nota: `getEmail`/template importano `server-only` → eseguire con `tsx` e config che neutralizza `server-only`, oppure replicare l'invio raw con l'SDK Resend passando `tplN1BrokerInvio(...).html`. Verifica che arrivi in inbox col nuovo layout (logo via URL `https://passaggioveloce.it/brand/logo-email.png` — quindi serve che il PNG sia già deployato: in alternativa fai questo step DOPO lo Step 4 di deploy, oppure usa un URL temporaneo).
  - **Ordine consigliato**: poiché il logo è referenziato via URL prod, fai prima il deploy (Step 4) così il PNG è raggiungibile, poi l'invio di prova (Step 5).
  - Rimuovi lo script usa-e-getta dopo.

- [ ] **Step 3: Rimuovi `email-preview.html`**

Run: `rm email-preview.html`

- [ ] **Step 4: Deploy** — commit eventuali residui, poi:

```bash
git push origin main
```

Vercel deploya in automatico (vedi `project-prod-release-process`). Nessuna migrazione DB.

- [ ] **Step 5: Verifica prod + invio reale** — conferma che `https://passaggioveloce.it/brand/logo-email.png` risponde 200, poi esegui l'invio di prova (Step 2) verso `assistenza@` e verifica inbox: logo visibile, layout corretto. Rimuovi lo script.

---

## Note esecuzione
- DRY: header/footer/CTA vivono solo in `layout.ts`. YAGNI: niente preheader per-template ora. TDD: test prima dell'implementazione su brand/layout/templates. Commit frequenti per task.
- Blast radius minimo: `wrap()` mantiene la firma → i 28 template non cambiano.
