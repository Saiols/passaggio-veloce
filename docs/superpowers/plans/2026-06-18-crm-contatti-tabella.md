# Tabella contatti CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare la lista contatti CRM da card a tabella paginata (25/pagina) con colonne filtrabili, colonna Stato editabile inline (salvataggio immediato) e colonna Dettaglio, unificando l'ingresso CSV/Nuovo in una sola CTA.

**Architecture:** Pagination + sort + filtri server-side in `page.tsx` (skip/take + count, default sort "Ultimo contatto", preset "urgenti"). Una server action mirata `updateCrmContactStatusAction` per il cambio stato inline. Client `client.tsx`: tabella (8 colonne) + `StatusSelect` inline + controlli pagination + barra filtri (incl. chip Urgenti) + menu unico "+ Aggiungi". Un helper puro per costruire le querystring di filtro/pagination. Nessuna modifica DB.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React client component, Prisma 5.22, Vitest, TypeScript.

## Global Constraints

- App package `piattaforma`. Verifiche: `pnpm --filter piattaforma run typecheck` · `lint` · `test` · `build`.
- Node tooling: se errore versione, `nvm use 22.15.0` (PowerShell); pnpm è globale.
- Niente colori hardcoded: token design system (`pv-navy-*`, `pv-slate-*`, `pv-green-*`, ecc.). TypeScript no `any`.
- **Nessuna modifica DB / migration.**
- Stati `S0..S10`. Permessi: chi vede la pagina (`canViewCrm`) può editare (`canEditCrmContact`); **SALES** solo i propri assegnati.
- Colonne (Essenziale): Azienda · Tipo · Città (Regione) · Telefono · Assegnato · Ultimo contatto · **Stato (dropdown inline, salva al cambio)** · **Dettaglio (CTA → modale esistente)**.
- Pagination **25/pagina**, server-side. Default sort **"Ultimo contatto" desc** (value `recente`); sort alternativo **"Nome"** (`nome`). Sort `urgente` in memoria **rimosso**.
- Filtri tenuti: ricerca + cat + status + regione + assegnato. Chip **"🔴 Urgenti"** = preset gruppo `S6,S5,S4,S3` (mutuamente esclusivo col dropdown status).
- Ingresso unificato: una CTA "+ Aggiungi contatti" → "Nuovo contatto" / "Importa da CSV".

---

### Task 1: Helper puro `buildContactsQuery` (querystring filtri/pagination)

**Files:**
- Create: `apps/piattaforma/src/app/admin/crm/contatti/query.ts`
- Test: `apps/piattaforma/src/app/admin/crm/contatti/query.test.ts`

**Interfaces:**
- Produces:
  - `type ContactsQueryParams = { q?: string; cat?: string; status?: string; regione?: string; assigned?: string; sort?: string; preset?: string; page?: number }`
  - `buildContactsQuery(p: ContactsQueryParams): string` — querystring senza `?`, omette vuoti, `sort='recente'` e `page<=1`.

- [ ] **Step 1: Write the failing test**

Create `apps/piattaforma/src/app/admin/crm/contatti/query.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildContactsQuery } from './query';

describe('buildContactsQuery', () => {
  it('vuoto → stringa vuota', () => {
    expect(buildContactsQuery({})).toBe('');
  });

  it('omette sort di default (recente) e page 1', () => {
    expect(buildContactsQuery({ sort: 'recente', page: 1 })).toBe('');
  });

  it('include sort non-default e page > 1', () => {
    const qs = buildContactsQuery({ sort: 'nome', page: 3 });
    expect(qs).toContain('sort=nome');
    expect(qs).toContain('page=3');
  });

  it('include i filtri valorizzati e il preset', () => {
    const qs = buildContactsQuery({
      q: 'rossi', cat: 'BROKER', status: 'S3', regione: 'Lombardia',
      assigned: 'u1', preset: 'urgenti',
    });
    expect(qs).toContain('q=rossi');
    expect(qs).toContain('cat=BROKER');
    expect(qs).toContain('status=S3');
    expect(qs).toContain('regione=Lombardia');
    expect(qs).toContain('assigned=u1');
    expect(qs).toContain('preset=urgenti');
  });

  it('omette valori vuoti', () => {
    expect(buildContactsQuery({ q: '', cat: '', status: '' })).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter piattaforma exec vitest run src/app/admin/crm/contatti/query.test.ts`
Expected: FAIL — `Cannot find module './query'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/piattaforma/src/app/admin/crm/contatti/query.ts`:

```ts
/**
 * Costruzione querystring (senza '?') per i link di filtro e pagination della
 * tabella contatti CRM. Pura e condivisa tra updateFilter, pageHref e chip.
 * Omette valori vuoti, il sort di default ('recente') e page <= 1.
 */
export type ContactsQueryParams = {
  q?: string;
  cat?: string;
  status?: string;
  regione?: string;
  assigned?: string;
  sort?: string; // 'recente' (default) | 'nome'
  preset?: string; // 'urgenti' | ''
  page?: number; // 1-based
};

export function buildContactsQuery(p: ContactsQueryParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.cat) sp.set('cat', p.cat);
  if (p.status) sp.set('status', p.status);
  if (p.regione) sp.set('regione', p.regione);
  if (p.assigned) sp.set('assigned', p.assigned);
  if (p.sort && p.sort !== 'recente') sp.set('sort', p.sort);
  if (p.preset) sp.set('preset', p.preset);
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  return sp.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter piattaforma exec vitest run src/app/admin/crm/contatti/query.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/query.ts apps/piattaforma/src/app/admin/crm/contatti/query.test.ts
git commit -m "feat(crm): helper puro buildContactsQuery (filtri/pagination contatti)"
```

---

### Task 2: Server action `updateCrmContactStatusAction`

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/actions.ts` (in coda, dopo `deleteCrmContactAction` ~riga 269)

**Interfaces:**
- Produces: `updateCrmContactStatusAction(id: string, status: string): Promise<{ ok: true } | { ok: false; error: string }>`. Consumato da Task 3 (StatusSelect).

- [ ] **Step 1: Aggiungi l'azione**

In `actions.ts`, subito DOPO la fine di `deleteCrmContactAction` (la `}` a ~riga 269) e PRIMA del commento `// ═══ CSV Import / Export`:

```ts
export async function updateCrmContactStatusAction(
  id: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canEditCrmContact(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per modificare contatti CRM' };
  }

  const STATI = [
    'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10',
  ] as const;
  if (!STATI.includes(status as (typeof STATI)[number])) {
    return { ok: false, error: 'Stato non valido' };
  }

  // SALES può modificare solo i propri assegnati (decisione 7)
  if (session.user.role === 'SALES') {
    const target = await prisma.crmContact.findUnique({
      where: { id },
      select: { assignedToId: true },
    });
    if (!target || target.assignedToId !== session.user.id) {
      return { ok: false, error: 'Puoi modificare solo i contatti a te assegnati' };
    }
  }

  await prisma.crmContact.update({
    where: { id },
    data: { status: status as (typeof STATI)[number] },
  });

  revalidatePath('/admin/crm/contatti');
  return { ok: true };
}
```

(`auth`, `redirect`, `prisma`, `canEditCrmContact`, `revalidatePath` sono già importati nel file.)

- [ ] **Step 2: Verifica typecheck + lint**

Run: `pnpm --filter piattaforma run typecheck` → nessun errore.
Run: `pnpm --filter piattaforma run lint` → 0 errori (warning pre-esistenti OK).

- [ ] **Step 3: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/actions.ts
git commit -m "feat(crm): azione mirata updateCrmContactStatusAction (stato inline)"
```

---

### Task 3: Tabella paginata (server `page.tsx` + client `client.tsx`)

Server e client cambiano insieme (contratto props) per restare typecheck-clean.

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/page.tsx`
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx`

**Interfaces:**
- Consumes (Task 1): `buildContactsQuery`, `ContactsQueryParams`.
- Consumes (Task 2): `updateCrmContactStatusAction`.
- Produces: props `page: number`, `totalPages: number`, `total: number`, `pageSize: number`, e `filters.preset: string`, `filters.sort: 'recente' | 'nome'` passati a `CrmContactsClient`.

#### page.tsx

- [ ] **Step 1: SearchParams — page + preset, sort senza urgente**

Sostituisci il `type SearchParams` (~righe 24-31) con:

```ts
type SearchParams = {
  q?: string;
  cat?: 'BROKER' | 'AGENZIA' | '';
  status?: (typeof STATI)[number] | '';
  regione?: string;
  assigned?: string;
  sort?: 'recente' | 'nome';
  preset?: 'urgenti' | '';
  page?: string;
};
```

- [ ] **Step 2: where — preset urgenti**

Sostituisci il blocco `if (sp.status && STATI.includes(...)) { ... }` (~righe 66-68) con:

```ts
  if (sp.preset === 'urgenti') {
    where.status = { in: ['S6', 'S5', 'S4', 'S3'] };
  } else if (sp.status && STATI.includes(sp.status as (typeof STATI)[number])) {
    where.status = sp.status as (typeof STATI)[number];
  }
```

- [ ] **Step 3: orderBy SQL-native + rimozione urgenza in memoria**

Sostituisci il blocco sort (~righe 78-86, da `const sort = sp.sort ?? 'urgente';` fino alla chiusura dell'`orderBy`) con:

```ts
  const sort = sp.sort ?? 'recente';
  const orderBy: Prisma.CrmContactOrderByWithRelationInput[] =
    sort === 'nome'
      ? [{ nome: 'asc' }]
      : [{ lastContactAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];

  const PAGE_SIZE = 25;
  const page = Math.max(1, Number(sp.page) || 1);
```

- [ ] **Step 4: Query paginata + count, niente sort in memoria**

Sostituisci il blocco `const [allContacts, salesUsers, statsCounts] = await Promise.all([...])` (~righe 88-111) con:

```ts
  const [pageContacts, total, salesUsers, statsCounts] = await Promise.all([
    prisma.crmContact.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        assignedTo: { select: { id: true, nome: true, cognome: true } },
      },
    }),
    prisma.crmContact.count({ where }),
    prisma.user.findMany({
      where: {
        role: { in: ['SALES_MANAGER', 'SALES'] },
        deletedAt: null,
      },
      select: { id: true, nome: true, cognome: true },
      orderBy: [{ nome: 'asc' }, { cognome: 'asc' }],
    }),
    prisma.crmContact.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
```

Poi **RIMUOVI INTERAMENTE** il blocco `// Sort "urgente" applicato lato server in memoria ...` con l'oggetto `URGENCY` e `allContacts.sort(...)` (~righe 113-131).

- [ ] **Step 5: Serializzazione su `pageContacts`**

Nel `const contacts = allContacts.map(...)` (~riga 160) sostituisci `allContacts` con `pageContacts`:

```ts
  const contacts = pageContacts.map((c) => ({
```

(il resto del map invariato.)

- [ ] **Step 6: Passa le props pagination + preset al client**

Sostituisci il blocco `<CrmContactsClient ... />` (~righe 205-221) con:

```tsx
        <CrmContactsClient
          contacts={contacts}
          salesUsers={salesUsers.map((u) => ({
            id: u.id,
            name: `${u.nome} ${u.cognome}`.trim(),
          }))}
          currentUserRole={session.user.role ?? ''}
          currentUserId={session.user.id ?? ''}
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          filters={{
            q: sp.q ?? '',
            cat: sp.cat ?? '',
            status: sp.status ?? '',
            regione: sp.regione ?? '',
            assigned: sp.assigned ?? '',
            sort: sort,
            preset: sp.preset ?? '',
          }}
        />
```

#### client.tsx

- [ ] **Step 7: Import helper + azione stato**

In cima al file, nell'import da `./actions`, aggiungi `updateCrmContactStatusAction`; aggiungi l'import del helper:

```ts
import {
  createCrmContactAction,
  updateCrmContactAction,
  deleteCrmContactAction,
  bulkImportCrmContactsAction,
  updateCrmContactStatusAction,
  type CrmContactInput,
} from './actions';
import { buildContactsQuery } from './query';
```

- [ ] **Step 8: Filters type + props del componente**

Sostituisci il `type Filters` (~righe 62-69) con:

```ts
type Filters = {
  q: string;
  cat: string;
  status: string;
  regione: string;
  assigned: string;
  sort: 'recente' | 'nome';
  preset: string;
};
```

Aggiorna la firma di `CrmContactsClient` (~righe 125-137) aggiungendo le props pagination:

```tsx
export function CrmContactsClient({
  contacts,
  salesUsers,
  currentUserRole,
  currentUserId,
  page,
  totalPages,
  total,
  pageSize,
  filters,
}: {
  contacts: ContactRow[];
  salesUsers: SalesUser[];
  currentUserRole: string;
  currentUserId: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  filters: Filters;
}) {
```

- [ ] **Step 9: updateFilter via helper (reset page) + clearFilters**

Sostituisci `updateFilter` e `clearFilters` (~righe 145-160) con:

```tsx
  const updateFilter = (key: keyof Filters, value: string): void => {
    const next = { ...filters, [key]: value };
    // Filtro status singolo e chip preset sono mutuamente esclusivi.
    if (key === 'status' && value) next.preset = '';
    if (key === 'preset' && value) next.status = '';
    const qs = buildContactsQuery({ ...next, page: 1 });
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const toggleUrgenti = (): void => {
    updateFilter('preset', filters.preset === 'urgenti' ? '' : 'urgenti');
  };

  const pageHref = (n: number): string => {
    const qs = buildContactsQuery({ ...filters, page: n });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const clearFilters = (): void => {
    router.push(pathname);
  };
```

- [ ] **Step 10: Barra filtri — sort senza urgente + chip Urgenti**

Sostituisci il `<select value={filters.sort} ...>` (~righe 221-229) con:

```tsx
        <select
          value={filters.sort}
          onChange={(e) => updateFilter('sort', e.target.value)}
          className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        >
          <option value="recente">Ultimo contatto</option>
          <option value="nome">Nome A→Z</option>
        </select>
        <button
          type="button"
          onClick={toggleUrgenti}
          className={
            'rounded-[10px] border-[1.5px] px-3 py-2 text-[13px] font-semibold transition ' +
            (filters.preset === 'urgenti'
              ? 'border-pv-red-500 bg-pv-red-50 text-pv-red-500'
              : 'border-pv-slate-300 bg-white text-pv-slate-700 hover:bg-pv-slate-50')
          }
        >
          🔴 Urgenti
        </button>
```

(Quando il chip è attivo il dropdown `status` resta selezionabile ma `updateFilter` azzera il preset; coerente con la mutua esclusione.)

- [ ] **Step 11: Sostituisci la lista card con la TABELLA + pagination**

Sostituisci il blocco da `{contacts.length === 0 ? (` fino al `)}` che chiude la lista (~righe 247-257, il blocco con `<div className="space-y-2">{contacts.map(...ContactCard...)}</div>`) con:

```tsx
      {contacts.length === 0 ? (
        <div className="rounded-[16px] border border-pv-slate-200 bg-white px-5 py-12 text-center text-[13px] text-pv-slate-500 shadow-[var(--pv-shadow-card)]">
          Nessun contatto trovato.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-pv-slate-200 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <th className="px-4 py-3">Azienda</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Città</th>
                <th className="px-4 py-3">Telefono</th>
                <th className="px-4 py-3">Assegnato</th>
                <th className="px-4 py-3">Ultimo contatto</th>
                <th className="px-4 py-3">Stato</th>
                <th className="px-4 py-3 text-right">Dettaglio</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-pv-slate-100 last:border-0 hover:bg-pv-slate-50"
                >
                  <td className="px-4 py-2.5 font-semibold text-pv-navy-900">{c.nome}</td>
                  <td className="px-4 py-2.5 text-pv-slate-700">
                    {c.cat === 'BROKER' ? 'Broker' : 'Agenzia'}
                  </td>
                  <td className="px-4 py-2.5 text-pv-slate-700">
                    {c.citta ?? '—'}
                    {c.regione ? ` (${c.regione})` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-pv-slate-700">{c.tel}</td>
                  <td className="px-4 py-2.5 text-pv-slate-700">
                    {c.assignedToName ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-pv-slate-700">
                    {c.lastContactAt
                      ? new Date(c.lastContactAt).toLocaleDateString('it-IT')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusSelect
                      contact={c}
                      currentUserRole={currentUserRole}
                      currentUserId={currentUserId}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="rounded-[8px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                    >
                      Apri
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-pv-slate-500">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} di {total}
          </p>
          <div className="flex items-center gap-1">
            <PageLink href={pageHref(page - 1)} disabled={page <= 1} label="‹ Prec" />
            <span className="px-2 text-[12.5px] font-semibold text-pv-slate-700">
              {page} / {totalPages}
            </span>
            <PageLink
              href={pageHref(page + 1)}
              disabled={page >= totalPages}
              label="Succ ›"
            />
          </div>
        </div>
      )}
```

- [ ] **Step 12: Componenti `StatusSelect` e `PageLink` + rimozione `ContactCard`**

In `client.tsx`, **rimuovi** la funzione `ContactCard` (~righe 284-392, l'intero blocco `// Contact Card` + `function ContactCard(...) { ... }`). Al suo posto (stessa zona, dopo `CrmContactsClient`) aggiungi:

```tsx
// ════════════════════════════════════════════════════════
// Status inline select (salvataggio immediato)
// ════════════════════════════════════════════════════════
function StatusSelect({
  contact,
  currentUserRole,
  currentUserId,
}: {
  contact: ContactRow;
  currentUserRole: string;
  currentUserId: string;
}) {
  const [value, setValue] = useState(contact.status);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const disabled =
    currentUserRole === 'SALES' && contact.assignedToId !== currentUserId;

  const onChange = (next: string): void => {
    const prev = value;
    setValue(next); // ottimistico
    startTransition(async () => {
      const res = await updateCrmContactStatusAction(contact.id, next);
      if (!res.ok) {
        setValue(prev); // revert
        alert(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <select
      value={value}
      disabled={disabled || pending}
      onChange={(e) => onChange(e.target.value)}
      title={STATI_LABEL[value] ?? value}
      className={
        'rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wider disabled:opacity-60 ' +
        (STATI_COLOR[value] ?? 'bg-pv-slate-100 text-pv-slate-700')
      }
    >
      {Object.entries(STATI_LABEL).map(([k, l]) => (
        <option key={k} value={k}>
          {k} — {l}
        </option>
      ))}
    </select>
  );
}

// ════════════════════════════════════════════════════════
// Pagination link
// ════════════════════════════════════════════════════════
function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="rounded-[8px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-3 py-1 text-[12.5px] font-semibold text-pv-slate-400">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-[8px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
    >
      {label}
    </Link>
  );
}
```

Aggiungi l'import di `Link` in cima al file: `import Link from 'next/link';` (accanto agli altri import di `next/navigation`).

- [ ] **Step 13: Verifica typecheck + lint + build**

Run: `pnpm --filter piattaforma run typecheck` → nessun errore.
Run: `pnpm --filter piattaforma run lint` → 0 errori (warning pre-esistenti OK).
Run: `pnpm --filter piattaforma run build` → build OK.

- [ ] **Step 14: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/page.tsx apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): tabella contatti paginata + stato inline + chip Urgenti"
```

---

### Task 4: Ingresso unificato "+ Aggiungi contatti" + verifica finale

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (header controlli ~righe 237-244)

**Interfaces:**
- Consumes: `CsvImportButton` (esistente, riusato dentro il menu), `setCreating`, `canBulk`.

- [ ] **Step 1: Sostituisci i due controlli con il menu "+ Aggiungi"**

Sostituisci il blocco `<div className="ml-auto flex gap-2"> ... </div>` che contiene `{canBulk && <CsvImportButton .../>}` e `<Button ...>+ Nuovo contatto</Button>` (~righe 237-244) con:

```tsx
        <div className="ml-auto">
          <AddContactsMenu
            canBulk={canBulk}
            onNew={() => setCreating(true)}
            onImported={() => router.refresh()}
          />
        </div>
```

- [ ] **Step 2: Aggiungi il componente `AddContactsMenu`**

In `client.tsx`, subito DOPO `CrmContactsClient` (prima di `StatusSelect`), aggiungi:

```tsx
// ════════════════════════════════════════════════════════
// Menu unico "+ Aggiungi contatti" (Nuovo / Importa CSV)
// ════════════════════════════════════════════════════════
function AddContactsMenu({
  canBulk,
  onNew,
  onImported,
}: {
  canBulk: boolean;
  onNew: () => void;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)}>
        + Aggiungi contatti
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-[12px] border border-pv-slate-200 bg-white py-1 shadow-[var(--pv-shadow-card-lg)]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="block w-full px-4 py-2 text-left text-[13px] font-semibold text-pv-navy-800 hover:bg-pv-slate-50"
            >
              Nuovo contatto
            </button>
            {canBulk && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setImporting(true);
                }}
                className="block w-full px-4 py-2 text-left text-[13px] font-semibold text-pv-navy-800 hover:bg-pv-slate-50"
              >
                Importa da CSV
              </button>
            )}
          </div>
        </>
      )}
      {importing && (
        <CsvImportDialog
          onClose={() => setImporting(false)}
          onComplete={() => {
            setImporting(false);
            onImported();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Trasforma `CsvImportButton` in `CsvImportDialog` (apertura controllata)**

Sostituisci l'intera funzione `CsvImportButton` (~righe 397-484) con un `CsvImportDialog` che apre subito il dialog (selettore categoria + file) invece del bottone inline:

```tsx
// ════════════════════════════════════════════════════════
// CSV Import dialog (categoria + file)
// ════════════════════════════════════════════════════════
function CsvImportDialog({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [defaultCat, setDefaultCat] = useState<'BROKER' | 'AGENZIA'>('BROKER');

  const handleFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? '');
      startTransition(async () => {
        const res = await bulkImportCrmContactsAction(text, defaultCat);
        if (!res.ok) {
          setResult(res.error);
          return;
        }
        setResult(
          `✓ Importati: ${res.created} · Saltati: ${res.skipped}` +
            (res.errors.length ? `\n\n${res.errors.slice(0, 5).join('\n')}` : ''),
        );
        onComplete();
      });
    };
    reader.readAsText(file);
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
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        <h3 className="text-[15px] font-bold text-pv-navy-900">Importa contatti da CSV</h3>
        {result ? (
          <>
            <pre className="mt-3 whitespace-pre-wrap rounded-[10px] bg-pv-slate-50 px-3 py-2 text-[12px] text-pv-slate-700">
              {result}
            </pre>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={onClose}>
                Chiudi
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
              Categoria per le righe senza colonna &quot;cat&quot;
              <select
                value={defaultCat}
                onChange={(e) => setDefaultCat(e.target.value as 'BROKER' | 'AGENZIA')}
                disabled={pending}
                className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
              >
                <option value="BROKER">Rivenditori</option>
                <option value="AGENZIA">Agenzie</option>
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
                Annulla
              </Button>
              <Button
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={pending}
                loading={pending}
                loadingLabel="Import…"
              >
                Scegli file CSV
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verifica completa app**

Run: `pnpm --filter piattaforma run typecheck` → nessun errore.
Run: `pnpm --filter piattaforma run lint` → 0 errori (warning pre-esistenti OK).
Run: `pnpm --filter piattaforma run test` → tutti i test PASS (inclusi i 5 di `query.test.ts`).
Run: `pnpm --filter piattaforma run build` → build OK.

- [ ] **Step 5: Verifica manuale (dev) — opzionale, gestita dal controller**

`pnpm --filter piattaforma run dev` → `/admin/crm/contatti`: tabella paginata (25/pag), filtri + chip Urgenti, cambio stato inline (salva subito; SALES disabilitato sui non-propri), CTA "Apri" dettaglio, menu "+ Aggiungi contatti" (Nuovo / Importa CSV).

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti/client.tsx
git commit -m "feat(crm): ingresso unificato + Aggiungi contatti (Nuovo / Importa CSV)"
```

---

## Note finali

- **Nessuna migration** — nessun campo nuovo; il deploy è push-only (nessun `migrate deploy`).
- **Altre pagine non toccate** (`admin/contatti`, modale dettaglio invariata).
- **CrmTabs / stat cards** invariati.
