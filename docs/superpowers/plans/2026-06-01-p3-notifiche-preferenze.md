# P3 · Notifiche & preferenze — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Dare agli utenti il controllo sulle notifiche non obbligatorie (preferenze + unsubscribe one-click) e aggiungere la notifica proattiva al dealer post-firma per valutare l'agenzia (`N31_VALUTA_AGENZIA`).

**Architecture:** Classificazione obbligatorie/opzionali in un helper puro. Il gating + l'append del footer di unsubscribe avvengono **centralmente** in `sendNotification` (solo per i tipi opzionali → zero impatto sui transazionali). Nuovo tipo `N31` cablato con lo stesso pattern degli altri (enum + template + union/render). UI: pagina preferenze + pagina pubblica unsubscribe.

**Tech Stack:** Next.js 16, Prisma (migrazione additiva), Vitest. Base URL email da `env.NEXT_PUBLIC_APP_URL`.

Spec: `docs/superpowers/specs/2026-06-01-completamenti-locali-design.md` (§P3).

## Repo facts (verificati)
- `sendNotification(input)` in `apps/piattaforma/src/lib/notifiche/send.ts`: discriminated union `SendInput` (`{ tipo, target:{email,userId?,companyId?}, payload }`), `render()` switch, crea `NotificaInviata` (stato SCHEDULED→SENT/FAILED) e invia via `getEmail()`. `input.tipo` (stringa) coincide col nome enum `NotificaTipo`.
- Template puri in `apps/piattaforma/src/lib/notifiche/templates.ts`: payload type + funzione `tplX(p): NotificaContent` (`{subject,html,text}`); helper `wrap(body)` per l'HTML branded. `index.ts` ri-esporta entrambi.
- Enum (`packages/db/prisma/schema.prisma`): `NotificaTipo` (riga 230, fino a `N25_MONTHLY_AFFILIATION_RECAP` riga 254), `NotificaStato` (riga 263: SCHEDULED/SENT/FAILED/READ). `model User` (riga 379).
- Firma: `completaPratica` in `apps/piattaforma/src/app/pratiche/actions.ts`; blocco post-commit (righe ~303-322) invia N4 al `brokerUser` (`{email, nome, id}`) con `full.agenziaAssegnata?.ragioneSociale` disponibile.
- DB scripts (workspace `@pv/db`): `pnpm --filter @pv/db db:generate` (prisma generate → tipi client), `pnpm --filter @pv/db db:push` (applica a DB locale).
- Tipi opzionali (non obbligatori): `N3_BROKER_SOLLECITO`, `N7_AGENZIA_PROMEMORIA_COUNTDOWN`, `N25_MONTHLY_AFFILIATION_RECAP`, `N31_VALUTA_AGENZIA`. Tutti gli altri sono transazionali → sempre inviati.

## File Structure
- Modify `packages/db/prisma/schema.prisma` — enum N31 + SKIPPED, campi User.
- Create `apps/piattaforma/src/lib/notifiche/preferences.ts` + test — classificazione + shouldSend.
- Modify `apps/piattaforma/src/lib/notifiche/templates.ts` — payload + tplN31.
- Modify `apps/piattaforma/src/lib/notifiche/send.ts` — union/render N31 + gating opzionali + footer unsubscribe.
- Modify `apps/piattaforma/src/app/pratiche/actions.ts` — trigger N31 post-firma.
- Create `apps/piattaforma/src/app/profilo/notifiche/page.tsx` + `actions.ts` — preferenze.
- Create `apps/piattaforma/src/app/unsubscribe/page.tsx` — unsubscribe pubblico.
- Modify landing-gate + `/notifiche` page — link + path pubblico.

---

### Task 1: Schema (enum + campi User) + generate

**Files:** Modify `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enum values**

In `enum NotificaTipo`, dopo `N25_MONTHLY_AFFILIATION_RECAP`:
```prisma
  N31_VALUTA_AGENZIA
```
In `enum NotificaStato`, dopo `READ`:
```prisma
  SKIPPED
```

- [ ] **Step 2: Add User fields**

Nel `model User`, accanto agli altri campi scalari (prima delle relazioni), aggiungi:
```prisma
  /// Preferenze notifiche opzionali: mappa { "<NotificaTipo>": boolean }. Default opt-in (assenza = true).
  notifPrefs Json?
  /// Token per unsubscribe one-click via link email (generato lazy al primo invio opzionale).
  unsubscribeToken String? @unique
```

- [ ] **Step 3: Generate client + push to local DB**

Run: `pnpm --filter @pv/db db:generate`
Expected: prisma generate OK (client tipizza N31, SKIPPED, notifPrefs, unsubscribeToken).
Run: `pnpm --filter @pv/db db:push`
Expected: schema applicato al DB locale. **Se il DB non è raggiungibile**, riporta DONE_WITH_CONCERNS annotando che `db:push` va eseguito quando il Postgres locale è attivo (il generate è sufficiente per typecheck).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(schema): NotificaTipo N31 + NotificaStato SKIPPED + User notifPrefs/unsubscribeToken"
```

---

### Task 2: Helper preferenze (puro, TDD)

**Files:**
- Create `apps/piattaforma/src/lib/notifiche/preferences.ts`
- Test `apps/piattaforma/src/lib/notifiche/preferences.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isOptionalTipo, shouldSend, OPTIONAL_TIPI } from './preferences';

describe('isOptionalTipo', () => {
  it('marks solleciti/promemoria/recap/valuta as optional', () => {
    expect(isOptionalTipo('N3_BROKER_SOLLECITO')).toBe(true);
    expect(isOptionalTipo('N31_VALUTA_AGENZIA')).toBe(true);
  });
  it('marks transactional notifications as non-optional', () => {
    expect(isOptionalTipo('N1_BROKER_INVIO_PRATICA')).toBe(false);
    expect(isOptionalTipo('N4_BROKER_FIRMA_E_CREDITO')).toBe(false);
  });
});

describe('shouldSend', () => {
  it('always sends mandatory notifications regardless of prefs', () => {
    expect(shouldSend('N4_BROKER_FIRMA_E_CREDITO', { N4_BROKER_FIRMA_E_CREDITO: false })).toBe(true);
  });
  it('sends optional by default (opt-in) when prefs missing', () => {
    expect(shouldSend('N31_VALUTA_AGENZIA', null)).toBe(true);
    expect(shouldSend('N31_VALUTA_AGENZIA', {})).toBe(true);
  });
  it('skips optional when explicitly disabled', () => {
    expect(shouldSend('N31_VALUTA_AGENZIA', { N31_VALUTA_AGENZIA: false })).toBe(false);
  });
  it('keeps optional when explicitly enabled', () => {
    expect(shouldSend('N3_BROKER_SOLLECITO', { N3_BROKER_SOLLECITO: true })).toBe(true);
  });
});

describe('OPTIONAL_TIPI', () => {
  it('contains exactly the 4 optional types', () => {
    expect([...OPTIONAL_TIPI].sort()).toEqual(
      ['N25_MONTHLY_AFFILIATION_RECAP', 'N31_VALUTA_AGENZIA', 'N3_BROKER_SOLLECITO', 'N7_AGENZIA_PROMEMORIA_COUNTDOWN'].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `pnpm --filter piattaforma test -- preferences`

- [ ] **Step 3: Implement**

```ts
/**
 * Preferenze notifiche: classificazione obbligatorie vs opzionali e gating.
 * Le notifiche transazionali (conferme, firme, addebiti, escalation, account)
 * sono sempre inviate. Solo le opzionali rispettano le preferenze utente.
 */

export const OPTIONAL_TIPI: ReadonlySet<string> = new Set([
  'N3_BROKER_SOLLECITO',
  'N7_AGENZIA_PROMEMORIA_COUNTDOWN',
  'N25_MONTHLY_AFFILIATION_RECAP',
  'N31_VALUTA_AGENZIA',
]);

/** Etichette UI per le notifiche opzionali (pagina preferenze). */
export const OPTIONAL_TIPI_LABELS: Record<string, string> = {
  N3_BROKER_SOLLECITO: 'Solleciti pratiche non firmate',
  N7_AGENZIA_PROMEMORIA_COUNTDOWN: 'Promemoria countdown addebito',
  N25_MONTHLY_AFFILIATION_RECAP: 'Recap mensile affiliazione',
  N31_VALUTA_AGENZIA: 'Inviti a valutare l’agenzia',
};

export function isOptionalTipo(tipo: string): boolean {
  return OPTIONAL_TIPI.has(tipo);
}

/**
 * Decide se inviare. Le obbligatorie passano sempre. Le opzionali sono
 * opt-in di default: inviate salvo `prefs[tipo] === false`.
 */
export function shouldSend(
  tipo: string,
  prefs: Record<string, boolean> | null | undefined,
): boolean {
  if (!isOptionalTipo(tipo)) return true;
  return prefs?.[tipo] !== false;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `pnpm --filter piattaforma test -- preferences`

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/preferences.ts apps/piattaforma/src/lib/notifiche/preferences.test.ts
git commit -m "feat(notifiche): helper preferenze opzionali/obbligatorie + shouldSend"
```

---

### Task 3: Template N31

**Files:** Modify `apps/piattaforma/src/lib/notifiche/templates.ts`

- [ ] **Step 1: Add the payload type** (vicino agli altri payload type, dopo `N25MonthlyAffiliationRecapPayload`):

```ts
export type N31ValutaAgenziaPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  nomeBroker: string;
  /** URL assoluto alla pagina pratica dove valutare. */
  praticaUrl: string;
};
```

- [ ] **Step 2: Add the template function** (in fondo, accanto agli altri `tplX`):

```ts
export function tplN31ValutaAgenzia(p: N31ValutaAgenziaPayload): NotificaContent {
  const subject = `Com'è andata con ${p.agenziaNome}? Lascia una valutazione`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata completata da ` +
    `${p.agenziaNome}. La tua valutazione aiuta gli altri broker e migliora il servizio.\n` +
    `Valuta qui: ${p.praticaUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Valuta l'agenzia</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è stata
      completata da <strong>${p.agenziaNome}</strong>. La tua valutazione aiuta gli altri broker.
    </p>
    <p style="margin:0 0 4px">
      <a href="${p.praticaUrl}" style="display:inline-block;background:#0054a6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">
        Valuta l'agenzia →
      </a>
    </p>
  `);
  return { subject, html, text };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts
git commit -m "feat(notifiche): template N31 valuta agenzia"
```

---

### Task 4: Wire N31 in send.ts + gating opzionali + footer unsubscribe

**Files:** Modify `apps/piattaforma/src/lib/notifiche/send.ts`

- [ ] **Step 1: Imports**

Aggiungi al blocco import templates: `tplN31ValutaAgenzia` e il type `N31ValutaAgenziaPayload`. Aggiungi inoltre in testa:
```ts
import { env } from '@/env';
import { isOptionalTipo, shouldSend } from './preferences';
```
(`env` potrebbe già essere importato — non duplicare.)

- [ ] **Step 2: Union branch** — aggiungi a `SendInput`:
```ts
  | {
      tipo: 'N31_VALUTA_AGENZIA';
      target: Target;
      payload: N31ValutaAgenziaPayload;
    };
```
(spostando il `;` finale dell'ultima alternativa correttamente — l'ultima diventa N31.)

- [ ] **Step 3: render case** — aggiungi nello switch di `render()`:
```ts
    case 'N31_VALUTA_AGENZIA':
      return tplN31ValutaAgenzia(input.payload);
```

- [ ] **Step 4: Gating + unsubscribe in `sendNotification`**

All'inizio di `sendNotification`, DOPO `const content = render(input);` e PRIMA della create di `NotificaInviata`, inserisci il blocco che gestisce SOLO i tipi opzionali (i transazionali restano invariati):

```ts
  // P3: gating preferenze + footer unsubscribe SOLO per le notifiche opzionali.
  // Le transazionali saltano interamente questo blocco (comportamento invariato).
  let html = content.html;
  let text = content.text;
  if (isOptionalTipo(input.tipo) && input.target.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.target.userId },
      select: { notifPrefs: true, unsubscribeToken: true },
    });
    const prefs = (user?.notifPrefs as Record<string, boolean> | null) ?? null;
    if (!shouldSend(input.tipo, prefs)) {
      // Utente ha disattivato questo tipo: registra SKIPPED e non inviare.
      await prisma.notificaInviata.create({
        data: {
          tipo: input.tipo,
          canale: 'EMAIL',
          stato: 'SKIPPED',
          userId: input.target.userId,
          companyId: input.target.companyId ?? null,
          destinazione: input.target.email,
          subject: content.subject,
          bodyPreview: content.text.slice(0, 200),
          payload: JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue,
        },
      });
      return;
    }
    // Garantisce un token unsubscribe e appende il footer one-click.
    let token = user?.unsubscribeToken ?? null;
    if (!token) {
      token = crypto.randomUUID();
      await prisma.user.update({
        where: { id: input.target.userId },
        data: { unsubscribeToken: token },
      });
    }
    const url = `${env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${token}`;
    html = html + `<p style="margin:16px 0 0;font-size:11px;color:#94a3b8;text-align:center">Non vuoi più ricevere queste email? <a href="${url}" style="color:#94a3b8">Disattiva</a></p>`;
    text = text + `\n\nPer non ricevere più queste email: ${url}`;
  }
```

Poi nella create di `NotificaInviata` (ramo normale) e nell'invio `email.send`, usa `html` e `text` (le variabili locali) invece di `content.html`/`content.text`. Cioè:
- `email.send({ ..., html, text, ... })`
- la `bodyPreview` resta `content.text.slice(0, 200)`.

> Nota: `crypto.randomUUID()` è globale in Node 18+/Next runtime — nessun import necessario. `Prisma` è già importato in send.ts.

- [ ] **Step 5: Typecheck + full test**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma test`
Expected: PASS (nessuna regressione; i test esistenti non chiamano sendNotification con tipi opzionali+userId).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/send.ts
git commit -m "feat(notifiche): N31 in send + gating opzionali (SKIPPED) + footer unsubscribe"
```

---

### Task 5: Trigger N31 post-firma

**Files:** Modify `apps/piattaforma/src/app/pratiche/actions.ts`

Nel blocco post-commit di `completaPratica`, dove viene inviata N4 al `brokerUser` (dentro `if (brokerUser) { ... }`, dopo la chiamata `sendNotification` N4), aggiungi l'invio N31 al dealer.

- [ ] **Step 1: Ensure env import**

In cima al file, se non già presente, aggiungi: `import { env } from '@/env';` (verifica prima leggendo gli import esistenti).

- [ ] **Step 2: Add the N31 send** subito dopo il blocco `await sendNotification({ tipo: 'N4_BROKER_FIRMA_E_CREDITO', ... }).catch(...)` (resta dentro `if (brokerUser)`):

```ts
        await sendNotification({
          tipo: 'N31_VALUTA_AGENZIA',
          target: {
            email: brokerUser.email,
            userId: brokerUser.id,
            companyId: full.broker.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            targa: full.targa,
            agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
            nomeBroker: brokerUser.nome,
            praticaUrl: `${env.NEXT_PUBLIC_APP_URL}/pratiche/${praticaId}`,
          },
        }).catch(() => undefined);
```

> Idempotenza: `completaPratica` transiziona la pratica a FIRMATA una sola volta (la transazione fallisce se già firmata), quindi questo blocco post-commit gira una volta sola per pratica → una sola N31.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/actions.ts
git commit -m "feat(notifiche): invio N31 valuta agenzia al dealer post-firma"
```

---

### Task 6: Pagina preferenze `/profilo/notifiche` + server action

**Files:**
- Create `apps/piattaforma/src/app/profilo/notifiche/page.tsx`
- Create `apps/piattaforma/src/app/profilo/notifiche/actions.ts`

- [ ] **Step 1: Server action**

```ts
// apps/piattaforma/src/app/profilo/notifiche/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { OPTIONAL_TIPI } from '@/lib/notifiche/preferences';

export async function updateNotifPrefsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  // Ogni checkbox presente nel form (name=tipo, value="on") = abilitato.
  const prefs: Record<string, boolean> = {};
  for (const tipo of OPTIONAL_TIPI) {
    prefs[tipo] = formData.get(tipo) === 'on';
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { notifPrefs: prefs },
  });
  revalidatePath('/profilo/notifiche');
}
```

- [ ] **Step 2: Page**

```tsx
// apps/piattaforma/src/app/profilo/notifiche/page.tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { OPTIONAL_TIPI, OPTIONAL_TIPI_LABELS, shouldSend } from '@/lib/notifiche/preferences';
import { updateNotifPrefsAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function NotifichePreferenzePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notifPrefs: true },
  });
  const prefs = (user?.notifPrefs as Record<string, boolean> | null) ?? null;

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Profilo</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Preferenze notifiche
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Le notifiche transazionali (pratiche, firme, addebiti) sono sempre attive. Qui gestisci solo quelle facoltative.
          </p>
        </header>

        <Card>
          <form action={updateNotifPrefsAction} className="space-y-4">
            {[...OPTIONAL_TIPI].map((tipo) => (
              <label key={tipo} className="flex items-center justify-between gap-4">
                <span className="text-[14px] text-pv-navy-800">{OPTIONAL_TIPI_LABELS[tipo] ?? tipo}</span>
                <input
                  type="checkbox"
                  name={tipo}
                  defaultChecked={shouldSend(tipo, prefs)}
                  className="h-5 w-5 accent-pv-navy-700"
                />
              </label>
            ))}
            <div className="border-t border-pv-slate-200 pt-4">
              <button
                type="submit"
                className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
              >
                Salva preferenze
              </button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
```

> Verifica: che `Card` esista in `@/components/ui` (sì, usato altrove) e che `accent-pv-navy-700`/`bg-pv-navy-700` siano classi valide (grep altre pagine; se `pv-navy-700` non esiste usa la variante navy presente, es. `pv-navy-800`).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/profilo/notifiche/page.tsx apps/piattaforma/src/app/profilo/notifiche/actions.ts
git commit -m "feat(profilo): pagina preferenze notifiche con toggle opzionali"
```

---

### Task 7: Pagina pubblica `/unsubscribe` + path pubblico + link da `/notifiche`

**Files:**
- Create `apps/piattaforma/src/app/unsubscribe/page.tsx`
- Modify `apps/piattaforma/src/lib/landing-gate.ts` (PUBLIC_PATHS)
- Modify `apps/piattaforma/src/app/notifiche/page.tsx` (link alle preferenze)

- [ ] **Step 1: Unsubscribe page (no auth, token-based)**

```tsx
// apps/piattaforma/src/app/unsubscribe/page.tsx
import { prisma } from '@pv/db';
import { OPTIONAL_TIPI } from '@/lib/notifiche/preferences';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let ok = false;
  if (token) {
    const user = await prisma.user.findUnique({
      where: { unsubscribeToken: token },
      select: { id: true, notifPrefs: true },
    });
    if (user) {
      const prefs = (user.notifPrefs as Record<string, boolean> | null) ?? {};
      for (const tipo of OPTIONAL_TIPI) prefs[tipo] = false;
      await prisma.user.update({ where: { id: user.id }, data: { notifPrefs: prefs } });
      ok = true;
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '80px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, color: '#0a2540' }}>
        {ok ? 'Preferenze aggiornate' : 'Link non valido'}
      </h1>
      <p style={{ color: '#334155', fontSize: 14, lineHeight: 1.6 }}>
        {ok
          ? 'Non riceverai più le notifiche facoltative (solleciti, promemoria, recap, inviti a valutare). Le comunicazioni essenziali sulle tue pratiche restano attive. Puoi riattivarle in qualsiasi momento dalla pagina Profilo → Preferenze notifiche.'
          : 'Il link di disiscrizione non è valido o è scaduto. Gestisci le preferenze dalla tua area riservata, in Profilo → Preferenze notifiche.'}
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Make `/unsubscribe` public**

Leggi `apps/piattaforma/src/lib/landing-gate.ts`. Individua l'array/funzione dei path pubblici (es. `PUBLIC_PATHS` o `isPublicPath`). Aggiungi `/unsubscribe` ai path pubblici, mirando lo stesso stile delle voci esistenti (es. `/privacy`, `/cookie`). Se la logica usa un prefix-match helper, aggiungi `'/unsubscribe'` all'elenco.

- [ ] **Step 3: Link dalle preferenze nella pagina `/notifiche`**

Leggi `apps/piattaforma/src/app/notifiche/page.tsx`. Nell'header della pagina aggiungi un link a `/profilo/notifiche`, es. accanto al titolo:
```tsx
            <a href="/profilo/notifiche" className="text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4">
              Preferenze →
            </a>
```
(adatta il wrapper all'header esistente; se l'header non ha un contenitore flex, racchiudi titolo + link come fa `wallet/page.tsx`/`agenzia-dashboard.tsx`.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/unsubscribe/page.tsx apps/piattaforma/src/lib/landing-gate.ts apps/piattaforma/src/app/notifiche/page.tsx
git commit -m "feat(notifiche): pagina unsubscribe pubblica + link preferenze"
```

---

### Task 8: Verifica complessiva

- [ ] **Step 1:** `pnpm --filter piattaforma test` → verde (incl. preferences).
- [ ] **Step 2:** `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint` → PASS.
- [ ] **Step 3 (manuale, se DB attivo):** firma una pratica → il dealer riceve N31 (in dev `.dev-emails/*.html`) con CTA valuta + footer unsubscribe. Disattiva "Inviti a valutare" in `/profilo/notifiche` → ri-firmando un'altra pratica la N31 risulta `SKIPPED` in `/notifiche`. Apri il link unsubscribe → conferma + tutte le opzionali disattivate.

---

## Self-Review

**Spec coverage (§P3):**
- Preferenze opzionali + modello → Task 1 (campi) + Task 2 (helper) + Task 4 (gating SKIPPED). ✓
- Unsubscribe one-click + link in email opzionali → Task 4 (footer/token) + Task 7 (pagina pubblica + path). ✓
- UI preferenze → Task 6. ✓
- N31 proattiva → Task 1 (enum) + Task 3 (template) + Task 4 (union/render) + Task 5 (trigger). ✓

**Placeholder scan:** nessun TBD. Le "Verifica/Nota" richiedono controlli espliciti (classi colore, struttura header, PUBLIC_PATHS).

**Type consistency:** `OPTIONAL_TIPI`/`isOptionalTipo`/`shouldSend`/`OPTIONAL_TIPI_LABELS` (Task 2) usati in Task 4/6/7; `N31ValutaAgenziaPayload`/`tplN31ValutaAgenzia` (Task 3) usati in send.ts (Task 4); `'N31_VALUTA_AGENZIA'`/`'SKIPPED'` enum (Task 1) usati ovunque. `env.NEXT_PUBLIC_APP_URL` per i link.

**Rischi:** (1) `db:push` richiede DB locale attivo — fallback documentato in Task 1. (2) modifica a `sendNotification` è load-bearing: il gating è confinato dietro `isOptionalTipo(...) && userId`, i transazionali restano invariati — da verificare in review. (3) classi colore design system — verifica nei task UI.
