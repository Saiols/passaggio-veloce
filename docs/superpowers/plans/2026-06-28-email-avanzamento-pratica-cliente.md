# Email avanzamento pratica per acquirente/venditore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inviare email generiche di avanzamento pratica (5 milestone) ad acquirente e venditori, da `noreply`, distinte da quelle di broker/agenzia.

**Architecture:** Un nuovo tipo notifica parametrico `N40_CLIENTE_AVANZAMENTO` (payload con `stato` + `ruolo`) con un template puro unico. Un orchestratore server-only `notifyClientiAvanzamento(praticaId, stato)` carica la pratica, costruisce e deduplica i destinatari (acquirente + tutti i venditori) tramite un helper puro, e invia una notifica per destinatario via `sendNotification` esistente (fire-and-log). Cinque call-site (uno per milestone) accanto alle notifiche broker/agenzia già presenti.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma/Postgres (`@pv/db`), Resend (provider email), Vitest (test), TypeScript.

## Global Constraints

- Mittente: sempre `env.EMAIL_FROM` (`noreply@passaggioveloce.it`) — già il default di `sendNotification`. Non passare `from` custom.
- **Zero dati commerciali** nelle email cliente: niente fee, importi, saldo wallet, nome o contatti dell'agenzia.
- Contenuto consentito: `codicePratica`, descrizione veicolo (targa, multi-veicolo `"<targa> +<n-1>"`), nome destinatario, messaggio di stato.
- Tutte le invocazioni dell'orchestratore ai call-site sono **fire-and-log**: mai propagare errori al flusso di transizione di stato (suffisso `.catch(() => undefined)`, e l'orchestratore è già best-effort internamente).
- **Non** aggiungere `N40_CLIENTE_AVANZAMENTO` a `OPTIONAL_TIPI` in `preferences.ts`: è transazionale. (I destinatari non hanno `userId`, quindi il gating preferenze è comunque saltato a monte.)
- Test runner: Vitest. Test co-locati `*.test.ts` accanto al sorgente.
- Dedup destinatari per email `trim().toLowerCase()`; in caso di coincidenza vince il primo inserito (acquirente prima dei venditori).
- Guardia ANNULLATA: inviare l'email "annullata" solo se lo stato precedente all'annullamento **non** era `BOZZA` (clienti mai avvisati di "avviata" → niente "annullata").
- I tre file di server action importano `sendNotification` da `@/lib/notifiche` (barrel): aggiungere `notifyClientiAvanzamento` allo stesso import e ri-esportarlo dal barrel.

**Comandi di riferimento** (dalla root del monorepo):
- Test singolo file: `pnpm --filter piattaforma exec vitest run <path>`
- Typecheck: `pnpm --filter piattaforma run typecheck`
- Intera suite del package: `pnpm --filter piattaforma test`

---

## File Structure

- **Create** `apps/piattaforma/src/lib/notifiche/cliente-recipients.ts` — helper **puri** (no DB, no server-only): `nomeParte`, `veicoloDescrizione`, `buildClienteRecipients`, tipi `ClienteRecipient`/`ClientiInput`.
- **Create** `apps/piattaforma/src/lib/notifiche/cliente-recipients.test.ts` — unit dei puri.
- **Create** `apps/piattaforma/src/lib/notifiche/cliente.ts` — orchestratore `server-only` `notifyClientiAvanzamento`.
- **Create** `apps/piattaforma/src/lib/notifiche/cliente.test.ts` — unit orchestratore (mock `@pv/db` + `./send`).
- **Modify** `apps/piattaforma/src/lib/notifiche/templates.ts` — tipi `ClienteAvanzamentoStato`/`ClienteAvanzamentoRuolo`/`N40ClienteAvanzamentoPayload` + `tplN40ClienteAvanzamento`.
- **Modify** `apps/piattaforma/src/lib/notifiche/templates.test.ts` — test del template N40.
- **Modify** `apps/piattaforma/src/lib/notifiche/send.ts` — import, membro union, case in `render()`.
- **Modify** `apps/piattaforma/src/lib/notifiche/index.ts` — `export { notifyClientiAvanzamento } from './cliente';`.
- **Modify** `apps/piattaforma/src/app/pratiche/nuova/actions.ts` — trigger AVVIATA.
- **Modify** `apps/piattaforma/src/app/inbox/actions.ts` — trigger PRESA_IN_CARICO.
- **Modify** `apps/piattaforma/src/app/pratiche/actions.ts` — trigger PRONTA_FIRMA / COMPLETATA / ANNULLATA.

---

## Task 1: Template N40 + tipi payload

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts`
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts`

**Interfaces:**
- Produces:
  - `type ClienteAvanzamentoStato = 'AVVIATA' | 'PRESA_IN_CARICO' | 'PRONTA_FIRMA' | 'COMPLETATA' | 'ANNULLATA'`
  - `type ClienteAvanzamentoRuolo = 'ACQUIRENTE' | 'VENDITORE'`
  - `type N40ClienteAvanzamentoPayload = { codicePratica: string; veicoloDescrizione: string | null; nomeDestinatario: string; ruolo: ClienteAvanzamentoRuolo; stato: ClienteAvanzamentoStato }`
  - `function tplN40ClienteAvanzamento(p: N40ClienteAvanzamentoPayload): NotificaContent`
- Consumes (esistenti in `templates.ts`): `wrap()`, `escapeHtml`, `NotificaContent`.

- [ ] **Step 1: Scrivere i test (falliscono)**

Aggiungi in coda a `apps/piattaforma/src/lib/notifiche/templates.test.ts`:

```typescript
import { tplN40ClienteAvanzamento } from './templates';
import type { ClienteAvanzamentoStato, ClienteAvanzamentoRuolo } from './templates';

describe('N40 cliente avanzamento', () => {
  const STATI: ClienteAvanzamentoStato[] = [
    'AVVIATA', 'PRESA_IN_CARICO', 'PRONTA_FIRMA', 'COMPLETATA', 'ANNULLATA',
  ];
  const RUOLI: ClienteAvanzamentoRuolo[] = ['ACQUIRENTE', 'VENDITORE'];

  it('per ogni stato/ruolo: subject e text valorizzati, niente dati commerciali', () => {
    for (const stato of STATI) {
      for (const ruolo of RUOLI) {
        const { subject, text, html } = tplN40ClienteAvanzamento({
          codicePratica: 'PV-2026-001',
          veicoloDescrizione: 'AB123CD',
          nomeDestinatario: 'Mario Rossi',
          ruolo,
          stato,
        });
        expect(subject.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
        expect(subject).toContain('PV-2026-001');
        expect(text).toContain('PV-2026-001');
        // niente dati commerciali
        const haystack = `${subject}\n${text}\n${html}`.toLowerCase();
        expect(haystack).not.toContain('€');
        expect(haystack).not.toContain('fee');
        expect(haystack).not.toContain('wallet');
        expect(haystack).not.toContain('saldo');
        expect(haystack).not.toContain('agenzia '); // niente nome/contatti agenzia
      }
    }
  });

  it('differenzia acquisto vs vendita all-avvio', () => {
    const base = {
      codicePratica: 'PV-1', veicoloDescrizione: 'AB123CD', nomeDestinatario: 'Mario',
      stato: 'AVVIATA' as const,
    };
    const acq = tplN40ClienteAvanzamento({ ...base, ruolo: 'ACQUIRENTE' });
    const ven = tplN40ClienteAvanzamento({ ...base, ruolo: 'VENDITORE' });
    expect(acq.text.toLowerCase()).toContain('acquisto');
    expect(ven.text.toLowerCase()).toContain('vendita');
  });

  it('gestisce veicoloDescrizione null senza rompere', () => {
    const { text } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-1', veicoloDescrizione: null, nomeDestinatario: 'Mario',
      ruolo: 'ACQUIRENTE', stato: 'COMPLETATA',
    });
    expect(text).toContain('PV-1');
    expect(text).not.toContain('null');
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/templates.test.ts`
Expected: FAIL — `tplN40ClienteAvanzamento` non esportato.

- [ ] **Step 3: Implementare tipi + template**

In `apps/piattaforma/src/lib/notifiche/templates.ts`, aggiungi i tipi vicino agli altri `export type N…Payload` (es. dopo `N13BrokerPraticaProcessataPayload`):

```typescript
export type ClienteAvanzamentoStato =
  | 'AVVIATA' | 'PRESA_IN_CARICO' | 'PRONTA_FIRMA' | 'COMPLETATA' | 'ANNULLATA';
export type ClienteAvanzamentoRuolo = 'ACQUIRENTE' | 'VENDITORE';
export type N40ClienteAvanzamentoPayload = {
  codicePratica: string;
  veicoloDescrizione: string | null;
  nomeDestinatario: string;
  ruolo: ClienteAvanzamentoRuolo;
  stato: ClienteAvanzamentoStato;
};
```

E aggiungi la funzione template (vicino agli altri `tpl…`, es. dopo `tplN13BrokerPraticaProcessata`):

```typescript
export function tplN40ClienteAvanzamento(p: N40ClienteAvanzamentoPayload): NotificaContent {
  // Frammento veicolo (raw, usato nella prosa). La targa è alfanumerica;
  // l'escape avviene a valle quando la prosa entra nell'HTML.
  const veic = p.veicoloDescrizione ? ` del veicolo ${p.veicoloDescrizione}` : '';
  const operazione = p.ruolo === 'ACQUIRENTE' ? "l'acquisto" : 'la vendita';

  const M: Record<ClienteAvanzamentoStato, { titolo: string; subject: string; corpo: string }> = {
    AVVIATA: {
      titolo: 'Pratica avviata',
      subject: `Pratica ${p.codicePratica} avviata`,
      corpo: `abbiamo avviato la pratica per ${operazione}${veic}. Ti terremo aggiornato sui prossimi passaggi.`,
    },
    PRESA_IN_CARICO: {
      titolo: 'Pratica presa in carico',
      subject: `Pratica ${p.codicePratica} presa in carico`,
      corpo: `un'agenzia partner ha preso in carico la pratica${veic} e si occuperà degli adempimenti.`,
    },
    PRONTA_FIRMA: {
      titolo: 'Documenti pronti per la firma',
      subject: `Pratica ${p.codicePratica}: documenti pronti per la firma`,
      corpo: `i documenti della pratica${veic} sono pronti: a breve verrai contattato per la firma.`,
    },
    COMPLETATA: {
      titolo: 'Passaggio di proprietà completato',
      subject: `Pratica ${p.codicePratica} completata`,
      corpo: `il passaggio di proprietà${veic} è stato completato con successo. Grazie per aver scelto Passaggio Veloce.`,
    },
    ANNULLATA: {
      titolo: 'Pratica annullata',
      subject: `Pratica ${p.codicePratica} annullata`,
      corpo: `la pratica${veic} è stata annullata. Per maggiori informazioni puoi contattare il tuo riferimento.`,
    },
  };

  const m = M[p.stato];
  const text =
    `Ciao ${p.nomeDestinatario},\n` +
    `${m.corpo}\n` +
    `Numero pratica: ${p.codicePratica}.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">${escapeHtml(m.titolo)}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeDestinatario)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">${escapeHtml(m.corpo)}</p>
    <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Numero pratica: <strong>${escapeHtml(p.codicePratica)}</strong>
    </div>
  `);
  return { subject: m.subject, html, text };
}
```

> Nota: `escapeHtml` è già importato in `templates.ts`. Se per qualche motivo non lo fosse, l'import è `import { escapeHtml } from '@/lib/escape-html';`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/templates.test.ts`
Expected: PASS (inclusi i test preesistenti del file).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/templates.test.ts
git commit -m "feat(notifiche): template N40 avanzamento pratica per cliente"
```

---

## Task 2: Helper puri destinatari + veicolo

**Files:**
- Create: `apps/piattaforma/src/lib/notifiche/cliente-recipients.ts`
- Test: `apps/piattaforma/src/lib/notifiche/cliente-recipients.test.ts`

**Interfaces:**
- Consumes: `ClienteAvanzamentoRuolo` (Task 1).
- Produces:
  - `type ClienteRecipient = { email: string; ruolo: ClienteAvanzamentoRuolo; nomeDestinatario: string }`
  - `type ClientiInput = { acquirenteEmail: string | null; acquirenteNome: string | null; acquirenteCognome: string | null; acquirenteIsPersonaGiuridica: boolean; acquirenteRagioneSociale: string | null; venditori: { email: string | null; nome: string | null; cognome: string | null; isPersonaGiuridica: boolean; ragioneSociale: string | null }[] }`
  - `function veicoloDescrizione(veicoli: { targa: string | null }[]): string | null`
  - `function buildClienteRecipients(input: ClientiInput): ClienteRecipient[]`

- [ ] **Step 1: Scrivere i test (falliscono)**

Crea `apps/piattaforma/src/lib/notifiche/cliente-recipients.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildClienteRecipients, veicoloDescrizione } from './cliente-recipients';

const acquirente = {
  acquirenteEmail: 'buyer@x.it',
  acquirenteNome: 'Mario',
  acquirenteCognome: 'Rossi',
  acquirenteIsPersonaGiuridica: false,
  acquirenteRagioneSociale: null,
};

describe('veicoloDescrizione', () => {
  it('singolo veicolo: targa', () => {
    expect(veicoloDescrizione([{ targa: 'AB123CD' }])).toBe('AB123CD');
  });
  it('piu veicoli: targa + contatore', () => {
    expect(veicoloDescrizione([{ targa: 'AB123CD' }, { targa: 'EF456GH' }])).toBe('AB123CD +1');
  });
  it('nessuna targa: null', () => {
    expect(veicoloDescrizione([{ targa: null }])).toBeNull();
    expect(veicoloDescrizione([])).toBeNull();
  });
});

describe('buildClienteRecipients', () => {
  it('acquirente + venditori, ruoli corretti', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'seller1@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'seller2@x.it', nome: 'Luca', cognome: 'Verdi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r).toEqual([
      { email: 'buyer@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Mario Rossi' },
      { email: 'seller1@x.it', ruolo: 'VENDITORE', nomeDestinatario: 'Anna Bianchi' },
      { email: 'seller2@x.it', ruolo: 'VENDITORE', nomeDestinatario: 'Luca Verdi' },
    ]);
  });

  it('dedup per email case-insensitive, vince il primo (acquirente)', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'BUYER@x.it', nome: 'Dup', cognome: 'Persona', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'seller@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r.map((x) => x.email)).toEqual(['buyer@x.it', 'seller@x.it']);
    expect(r[0]!.ruolo).toBe('ACQUIRENTE');
  });

  it('filtra email mancanti/vuote', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      acquirenteEmail: null,
      venditori: [
        { email: '  ', nome: 'A', cognome: 'B', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'ok@x.it', nome: 'C', cognome: 'D', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r.map((x) => x.email)).toEqual(['ok@x.it']);
  });

  it('persona giuridica: usa ragione sociale', () => {
    const r = buildClienteRecipients({
      acquirenteEmail: 'pg@x.it', acquirenteNome: null, acquirenteCognome: null,
      acquirenteIsPersonaGiuridica: true, acquirenteRagioneSociale: 'ACME Srl',
      venditori: [],
    });
    expect(r[0]!.nomeDestinatario).toBe('ACME Srl');
  });

  it('nome assente: fallback Cliente', () => {
    const r = buildClienteRecipients({
      acquirenteEmail: 'x@x.it', acquirenteNome: null, acquirenteCognome: null,
      acquirenteIsPersonaGiuridica: false, acquirenteRagioneSociale: null,
      venditori: [],
    });
    expect(r[0]!.nomeDestinatario).toBe('Cliente');
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/cliente-recipients.test.ts`
Expected: FAIL — modulo `./cliente-recipients` inesistente.

- [ ] **Step 3: Implementare gli helper puri**

Crea `apps/piattaforma/src/lib/notifiche/cliente-recipients.ts`:

```typescript
/**
 * Helper PURI (no DB, no server-only) per costruire la lista dei destinatari
 * "cliente" (acquirente + venditori) delle email di avanzamento pratica.
 * Testabili in isolamento; l'orchestratore (cliente.ts) fa il caricamento DB.
 */
import type { ClienteAvanzamentoRuolo } from './templates';

export type ClienteRecipient = {
  email: string;
  ruolo: ClienteAvanzamentoRuolo;
  nomeDestinatario: string;
};

type ParteBase = {
  isPersonaGiuridica: boolean;
  ragioneSociale: string | null;
  nome: string | null;
  cognome: string | null;
};

export type ClientiInput = {
  acquirenteEmail: string | null;
  acquirenteNome: string | null;
  acquirenteCognome: string | null;
  acquirenteIsPersonaGiuridica: boolean;
  acquirenteRagioneSociale: string | null;
  venditori: {
    email: string | null;
    nome: string | null;
    cognome: string | null;
    isPersonaGiuridica: boolean;
    ragioneSociale: string | null;
  }[];
};

/** Nome visualizzato della parte: ragione sociale (PG) o nome+cognome, con fallback. */
export function nomeParte(p: ParteBase): string {
  if (p.isPersonaGiuridica) return p.ragioneSociale?.trim() || 'Cliente';
  const full = [p.nome, p.cognome].map((s) => s?.trim()).filter(Boolean).join(' ');
  return full || 'Cliente';
}

/** Targa del primo veicolo; se piu di uno, "<targa> +<n-1>"; null se nessuna targa. */
export function veicoloDescrizione(veicoli: { targa: string | null }[]): string | null {
  const prima = veicoli[0]?.targa?.trim();
  if (!prima) return null;
  return veicoli.length > 1 ? `${prima} +${veicoli.length - 1}` : prima;
}

/** Lista destinatari deduplicata per email (lowercased+trim); acquirente prima dei venditori. */
export function buildClienteRecipients(input: ClientiInput): ClienteRecipient[] {
  const out: ClienteRecipient[] = [];
  const seen = new Set<string>();
  const push = (email: string | null, ruolo: ClienteAvanzamentoRuolo, nome: string) => {
    const norm = email?.trim().toLowerCase();
    if (!norm) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push({ email: email!.trim(), ruolo, nomeDestinatario: nome });
  };
  push(
    input.acquirenteEmail,
    'ACQUIRENTE',
    nomeParte({
      isPersonaGiuridica: input.acquirenteIsPersonaGiuridica,
      ragioneSociale: input.acquirenteRagioneSociale,
      nome: input.acquirenteNome,
      cognome: input.acquirenteCognome,
    }),
  );
  for (const v of input.venditori) {
    push(v.email, 'VENDITORE', nomeParte(v));
  }
  return out;
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/cliente-recipients.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/cliente-recipients.ts apps/piattaforma/src/lib/notifiche/cliente-recipients.test.ts
git commit -m "feat(notifiche): helper puri destinatari cliente (dedup + veicolo)"
```

---

## Task 3: Registrare il tipo N40 in send.ts + barrel

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/send.ts`
- Modify: `apps/piattaforma/src/lib/notifiche/index.ts`

**Interfaces:**
- Consumes: `tplN40ClienteAvanzamento`, `N40ClienteAvanzamentoPayload` (Task 1); `notifyClientiAvanzamento` (Task 4 — l'export dal barrel viene aggiunto qui ma il modulo `./cliente` è creato in Task 4; vedi nota sotto).
- Produces: il tipo `'N40_CLIENTE_AVANZAMENTO'` invocabile via `sendNotification`.

> Nota ordine: il barrel ri-esporta `./cliente`, creato in Task 4. Per evitare un import rotto tra Task 3 e Task 4, l'export del barrel viene aggiunto **in Task 4** (Step dedicato). In Task 3 si tocca solo `send.ts`. Questo Step di `index.ts` resta elencato qui per chiarezza ma è marcato come "in Task 4".

- [ ] **Step 1: Aggiungere import in `send.ts`**

In `apps/piattaforma/src/lib/notifiche/send.ts`, nell'import block da `'./templates'`, aggiungi la funzione e il tipo:

```typescript
  tplN31ValutaAgenzia,
  tplN40ClienteAvanzamento,           // <-- aggiungere
  tplN1BrokerInvio,
```

e tra i `type …Payload`:

```typescript
  type N31ValutaAgenziaPayload,
  type N40ClienteAvanzamentoPayload,  // <-- aggiungere
  type N1BrokerInvioPayload,
```

- [ ] **Step 2: Aggiungere il membro alla union `SendInput`**

Subito dopo il ramo `N31_VALUTA_AGENZIA` (l'ultimo della union), aggiungi:

```typescript
  | {
      tipo: 'N40_CLIENTE_AVANZAMENTO';
      target: Target;
      payload: N40ClienteAvanzamentoPayload;
    };
```

(Sposta il `;` finale: il ramo N31 termina con `}` seguito da `;` di chiusura union — porta il `;` sul nuovo ultimo ramo N40.)

- [ ] **Step 3: Aggiungere il case in `render()`**

Nel `switch (input.tipo)` di `render`, dopo il case `N31_VALUTA_AGENZIA`:

```typescript
    case 'N40_CLIENTE_AVANZAMENTO':
      return tplN40ClienteAvanzamento(input.payload);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS. (Se manca il case, `render` non sarebbe esaustivo e il tipo di ritorno `NotificaContent` fallirebbe: è la verifica che il cablaggio è completo.)

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/send.ts
git commit -m "feat(notifiche): registra tipo N40_CLIENTE_AVANZAMENTO in send"
```

---

## Task 4: Orchestratore notifyClientiAvanzamento

**Files:**
- Create: `apps/piattaforma/src/lib/notifiche/cliente.ts`
- Test: `apps/piattaforma/src/lib/notifiche/cliente.test.ts`
- Modify: `apps/piattaforma/src/lib/notifiche/index.ts`

**Interfaces:**
- Consumes: `prisma` (`@pv/db`), `sendNotification` (`./send`), `buildClienteRecipients`/`veicoloDescrizione` (`./cliente-recipients`), `ClienteAvanzamentoStato` (`./templates`).
- Produces: `function notifyClientiAvanzamento(praticaId: string, stato: ClienteAvanzamentoStato): Promise<void>`

- [ ] **Step 1: Scrivere il test (fallisce)**

Crea `apps/piattaforma/src/lib/notifiche/cliente.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, sendMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: { pratica: { findUnique: findUniqueMock } } }));
vi.mock('./send', () => ({ sendNotification: sendMock }));

import { notifyClientiAvanzamento } from './cliente';

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue(undefined);
});

const praticaPiena = {
  codicePratica: 'PV-2026-001',
  acquirenteEmail: 'buyer@x.it',
  acquirenteNome: 'Mario',
  acquirenteCognome: 'Rossi',
  acquirenteIsPersonaGiuridica: false,
  acquirenteRagioneSociale: null,
  venditori: [
    { email: 'seller@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
    { email: 'BUYER@x.it', nome: 'Dup', cognome: 'X', isPersonaGiuridica: false, ragioneSociale: null },
  ],
  veicoli: [{ targa: 'AB123CD' }],
};

describe('notifyClientiAvanzamento', () => {
  it('invia una N40 per destinatario deduplicato con payload corretto', async () => {
    findUniqueMock.mockResolvedValue(praticaPiena);
    await notifyClientiAvanzamento('p1', 'COMPLETATA');

    expect(sendMock).toHaveBeenCalledTimes(2); // buyer + seller, duplicato saltato
    const tos = sendMock.mock.calls.map((c) => c[0].target.email);
    expect(tos).toEqual(['buyer@x.it', 'seller@x.it']);
    const first = sendMock.mock.calls[0]![0];
    expect(first.tipo).toBe('N40_CLIENTE_AVANZAMENTO');
    expect(first.payload.stato).toBe('COMPLETATA');
    expect(first.payload.codicePratica).toBe('PV-2026-001');
    expect(first.payload.veicoloDescrizione).toBe('AB123CD');
    expect(first.payload.ruolo).toBe('ACQUIRENTE');
  });

  it('non invia se la pratica e in bozza (codicePratica null)', async () => {
    findUniqueMock.mockResolvedValue({ ...praticaPiena, codicePratica: null });
    await notifyClientiAvanzamento('p1', 'AVVIATA');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non invia se nessun destinatario ha email', async () => {
    findUniqueMock.mockResolvedValue({
      ...praticaPiena, acquirenteEmail: null, venditori: [],
    });
    await notifyClientiAvanzamento('p1', 'AVVIATA');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non propaga errori del provider (best-effort)', async () => {
    findUniqueMock.mockResolvedValue(praticaPiena);
    sendMock.mockRejectedValue(new Error('provider down'));
    await expect(notifyClientiAvanzamento('p1', 'AVVIATA')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/cliente.test.ts`
Expected: FAIL — modulo `./cliente` inesistente.

- [ ] **Step 3: Implementare l'orchestratore**

Crea `apps/piattaforma/src/lib/notifiche/cliente.ts`:

```typescript
import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from './send';
import { buildClienteRecipients, veicoloDescrizione } from './cliente-recipients';
import type { ClienteAvanzamentoStato } from './templates';

/**
 * Invia le email generiche di avanzamento pratica ad acquirente e venditori.
 * Carica la pratica, costruisce/deduplica i destinatari, invia una N40 per
 * ciascuno. Best-effort: nessun errore viene propagato al chiamante (un guasto
 * email non deve mai bloccare la transizione di stato).
 */
export async function notifyClientiAvanzamento(
  praticaId: string,
  stato: ClienteAvanzamentoStato,
): Promise<void> {
  try {
    const pratica = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: {
        codicePratica: true,
        acquirenteEmail: true,
        acquirenteNome: true,
        acquirenteCognome: true,
        acquirenteIsPersonaGiuridica: true,
        acquirenteRagioneSociale: true,
        venditori: {
          select: {
            email: true,
            nome: true,
            cognome: true,
            isPersonaGiuridica: true,
            ragioneSociale: true,
          },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    });
    if (!pratica?.codicePratica) return;

    const recipients = buildClienteRecipients(pratica);
    if (recipients.length === 0) return;

    const veicolo = veicoloDescrizione(pratica.veicoli);
    const codicePratica = pratica.codicePratica;

    await Promise.all(
      recipients.map((r) =>
        sendNotification({
          tipo: 'N40_CLIENTE_AVANZAMENTO',
          target: { email: r.email },
          payload: {
            codicePratica,
            veicoloDescrizione: veicolo,
            nomeDestinatario: r.nomeDestinatario,
            ruolo: r.ruolo,
            stato,
          },
        }).catch(() => undefined),
      ),
    );
  } catch {
    // best-effort: non blocca il flusso chiamante
  }
}
```

- [ ] **Step 4: Esportare dal barrel `index.ts`**

In `apps/piattaforma/src/lib/notifiche/index.ts`, aggiungi:

```typescript
export { notifyClientiAvanzamento } from './cliente';
```

- [ ] **Step 5: Eseguire test + typecheck**

Run: `pnpm --filter piattaforma exec vitest run src/lib/notifiche/cliente.test.ts`
Expected: PASS.

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/cliente.ts apps/piattaforma/src/lib/notifiche/cliente.test.ts apps/piattaforma/src/lib/notifiche/index.ts
git commit -m "feat(notifiche): orchestratore notifyClientiAvanzamento + export barrel"
```

---

## Task 5: Cablaggio dei 5 trigger ai call-site

**Files:**
- Modify: `apps/piattaforma/src/app/pratiche/nuova/actions.ts` (AVVIATA)
- Modify: `apps/piattaforma/src/app/inbox/actions.ts` (PRESA_IN_CARICO)
- Modify: `apps/piattaforma/src/app/pratiche/actions.ts` (PRONTA_FIRMA, COMPLETATA, ANNULLATA)

**Interfaces:**
- Consumes: `notifyClientiAvanzamento` da `@/lib/notifiche` (barrel, Task 4).

- [ ] **Step 1: AVVIATA — `pratiche/nuova/actions.ts`**

Aggiorna l'import esistente (riga ~20):

```typescript
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
```

In `submitNuovaPraticaAction`, subito dopo la chiusura del blocco `if (round1.assegnazioni > 0) { … }` (quello che invia N1) e prima di `revalidatePath('/dashboard');`, inserisci (incondizionato: la pratica ha lasciato BOZZA, ha `codicePratica`):

```typescript
  // Email cliente (acquirente + venditori): pratica avviata.
  await notifyClientiAvanzamento(pratica.id, 'AVVIATA').catch(() => undefined);
```

- [ ] **Step 2: PRESA_IN_CARICO — `inbox/actions.ts`**

Aggiorna l'import esistente (riga ~9):

```typescript
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
```

In `acceptPratica`, dopo la chiusura del blocco `try { … } catch { // best-effort, non blocca }` che invia N2 (subito prima del commento `// Evento in-app (modale) per il broker …`), inserisci:

```typescript
  // Email cliente: un'agenzia ha preso in carico la pratica.
  await notifyClientiAvanzamento(praticaId, 'PRESA_IN_CARICO').catch(() => undefined);
```

- [ ] **Step 3: PRONTA_FIRMA + COMPLETATA — `pratiche/actions.ts` (import + due trigger)**

Aggiorna l'import esistente (riga ~8):

```typescript
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
```

In `markPraticaProcessataAction`, dopo la chiusura del blocco `try { … } catch { // best-effort }` che invia N13 (subito prima di `revalidatePath('/dashboard');`), inserisci:

```typescript
  // Email cliente: documenti pronti, si procede alla firma.
  await notifyClientiAvanzamento(praticaId, 'PRONTA_FIRMA').catch(() => undefined);
```

In `markFirmaAvvenutaAction`, dopo la chiusura del blocco best-effort delle notifiche post-firma (N4/N31/N8/evento firmata) e prima del primo `revalidatePath('/dashboard')` di questa funzione, inserisci:

```typescript
  // Email cliente: passaggio di proprietà completato.
  await notifyClientiAvanzamento(praticaId, 'COMPLETATA').catch(() => undefined);
```

- [ ] **Step 4: ANNULLATA — `pratiche/actions.ts` (`annullaPraticaAction`, con guardia BOZZA)**

In `annullaPraticaAction`, dichiara un flag nello scope esterno, prima del `try { await prisma.$transaction(...) }`:

```typescript
  let eraBozza = false;
```

Dentro la transaction, dopo i due controlli che lanciano (`'Non puoi annullare una pratica già firmata'` e `'Pratica già annullata'`) e prima di `const now = new Date();`, aggiungi:

```typescript
      eraBozza = pratica.stato === 'BOZZA';
```

Dopo la chiusura del blocco `try { … } catch { // best-effort }` che emette `eventoPraticaAnnullata`, e prima di `revalidatePath('/dashboard');`, inserisci la guardia:

```typescript
  // Email cliente: pratica annullata. Solo se era stata realmente inviata
  // (mai notificato "avviata" per le bozze -> niente "annullata").
  if (!eraBozza) {
    await notifyClientiAvanzamento(praticaId, 'ANNULLATA').catch(() => undefined);
  }
```

- [ ] **Step 5: Typecheck + intera suite**

Run: `pnpm --filter piattaforma run typecheck`
Expected: PASS.

Run: `pnpm --filter piattaforma test`
Expected: PASS (tutta la suite del package verde).

- [ ] **Step 6: Verifica manuale con provider console (dev)**

Con `EMAIL_PROVIDER=console` (default dev), eseguendo un ciclo pratica completo (crea/invia → accetta → processa → firma; e separatamente annulla una pratica già inviata) devono comparire, accanto alle email broker/agenzia, le email `N40_CLIENTE_AVANZAMENTO` per acquirente e venditori (controlla la console o `./.dev-emails`). Verifica: mittente `noreply@passaggioveloce.it`, niente fee/importi/nome agenzia, presenza `codicePratica` + targa.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/app/pratiche/nuova/actions.ts apps/piattaforma/src/app/inbox/actions.ts apps/piattaforma/src/app/pratiche/actions.ts
git commit -m "feat(notifiche): trigger email avanzamento pratica a cliente nei 5 step"
```

---

## Self-Review (eseguita in fase di scrittura)

**Spec coverage:**
- 5 milestone → Task 1 (template con 5 `stato`) + Task 5 (5 trigger). ✓
- Tipo unico parametrico `N40_CLIENTE_AVANZAMENTO` → Task 1/Task 3. ✓
- Destinatari acquirente + tutti i venditori, dedup → Task 2 (`buildClienteRecipients`) + test. ✓
- Contenuto numero pratica + veicolo, no dati commerciali → Task 1 (copy + test "niente dati commerciali"). ✓
- Mittente noreply → ereditato da `sendNotification`/`EMAIL_FROM` (Global Constraints). ✓
- Transazionale (no OPTIONAL_TIPI, no userId) → Global Constraints, nessuna modifica a `preferences.ts`. ✓
- Edge: email mancante → Task 2 (filtro) + test. ✓
- Edge: ANNULLATA da BOZZA → Task 5 Step 4 (guardia `eraBozza`). ✓
- Edge: multi-veicolo → Task 2 (`veicoloDescrizione`) + test. ✓
- Edge: fire-and-log → orchestratore try/catch (Task 4) + `.catch` ai call-site (Task 5) + test "non propaga errori". ✓
- Broker anche parte → accettato, nessuna logica speciale (coerente con spec). ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice o comando concreto. ✓

**Type consistency:** `ClienteAvanzamentoStato`/`ClienteAvanzamentoRuolo`/`N40ClienteAvanzamentoPayload` definiti in Task 1 e usati coerentemente in Task 2/3/4; `buildClienteRecipients`/`veicoloDescrizione`/`notifyClientiAvanzamento` con firme identiche tra "Produces" e implementazione. ✓
