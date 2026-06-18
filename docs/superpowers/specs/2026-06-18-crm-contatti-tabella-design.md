# Tabella contatti CRM (paginata + stato inline + ingresso unificato) — Design

**Data:** 2026-06-18
**Area:** Admin CRM → Pipeline lead (`apps/piattaforma/src/app/admin/crm/contatti`)
**Stato:** Approvato — pronto per implementation plan

## Contesto

La lista contatti CRM oggi è a **card** (`ContactCard`), carica `take: 500`
(nessuna pagination reale) e ordina "urgente" in memoria sui 500. Con
"tantissime righe" non regge. I filtri (ricerca + cat/status/regione/assegnato +
sort) sono già server-side via `searchParams`. Il dettaglio è una modale a 4 tab
(`ContactModal`). L'ingresso è due controlli sparsi: `CsvImportButton` (con
dropdown cat) + "+ Nuovo contatto".

`CrmContact.status` ∈ `S0..S10` (funnel), campo semplice senza side-effect.
Permessi: `canViewCrm` = `canEditCrmContact` (stesso set) → chi vede la pagina può
editare; **SALES** può editare solo i contatti a lui assegnati.

## Obiettivo

Trasformare la lista in una **tabella paginata** con colonne chiare e filtrabili,
una colonna **Stato editabile inline** (dropdown, salvataggio immediato) e una
colonna **Dettaglio** (CTA → modale esistente). Unificare l'ingresso CSV/Nuovo in
una sola CTA con scelta successiva. **Nessuna modifica DB.**

## Decisioni (fissate con l'utente)

- **Colonne (Essenziale, 8)**: Azienda · Tipo · Città (Regione) · Telefono ·
  Assegnato · Ultimo contatto · **Stato (dropdown inline)** · **Dettaglio (CTA)**.
- **Pagination server-side**, **25 righe/pagina**, con conteggio totale.
- **Sort**: default **"Ultimo contatto" (desc)** + "Nome" (A→Z), entrambi SQL-native.
  L'ordinamento "urgente" in memoria viene **rimosso** (incompatibile con la
  pagination). La triage per urgenza resta via il filtro Stato + un **chip
  "🔴 Urgenti"** (preset gruppo stati caldi).
- **Filtri**: si **tengono** ricerca generale + cat/status/regione/assegnato
  (già server-side). Si **rimuove** il vecchio `sort=urgente` in memoria.
- **Stato inline**: nuova azione mirata `updateCrmContactStatusAction(id, status)`,
  salvataggio al cambio, rispetto permessi (SALES solo propri assegnati).
- **Ingresso unificato**: una CTA "+ Aggiungi contatti" → menu con "Nuovo
  contatto" (modale create) e "Importa da CSV" (dialog con selettore
  Rivenditori/Agenzie + file). Riuso `ContactModal` e `bulkImportCrmContactsAction`.
- **Nessuna migration** (nessun campo nuovo).

## Server: `page.tsx` — pagination + filtri + sort

`apps/piattaforma/src/app/admin/crm/contatti/page.tsx`:

- `searchParams` aggiunge `page?: string` (1-based) e `preset?: 'urgenti'`.
  Si **rimuove** `sort: 'urgente'` (restano `recente`/`nome`; default `recente`).
- `where` invariato per q/cat/regione/assigned + `deletedAt: null` + scope SALES.
  - `status`: se `preset === 'urgenti'` → `where.status = { in: ['S6','S5','S4','S3'] }`
    (precede il dropdown status). Altrimenti il filtro `status` singolo come oggi.
- `orderBy`:
  - `sort === 'nome'` → `{ nome: 'asc' }`
  - default/`recente` → `[{ lastContactAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]`
  - **niente** ordinamento in memoria (rimosso il blocco URGENCY).
- Pagination:
  - `const PAGE_SIZE = 25;`
  - `const page = Math.max(1, Number(sp.page) || 1);`
  - query: `prisma.crmContact.findMany({ where, orderBy, skip: (page-1)*PAGE_SIZE, take: PAGE_SIZE, include: { assignedTo... } })`
  - `const total = await prisma.crmContact.count({ where });` (in `Promise.all`)
  - `const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));`
- Le **stat card** restano sui conteggi globali (`groupBy` invariato).
- Serializzazione righe invariata (la modale usa tutti i campi → si continua a
  fornire la riga completa, solo 25 per pagina).
- Passa a `CrmContactsClient`: `page`, `totalPages`, `total`, `pageSize`, e
  `filters` esteso con `preset`. `canEdit` non serve (sempre true per chi vede).

## Server: `actions.ts` — azione stato mirata

Aggiungere:

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
  const STATI = ['S0','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10'] as const;
  if (!STATI.includes(status as (typeof STATI)[number])) {
    return { ok: false, error: 'Stato non valido' };
  }
  // SALES può modificare solo i propri assegnati (decisione 7)
  if (session.user.role === 'SALES') {
    const target = await prisma.crmContact.findUnique({
      where: { id }, select: { assignedToId: true },
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

(`createCrmContactAction` / `updateCrmContactAction` / `deleteCrmContactAction` /
`bulkImportCrmContactsAction` invariate.)

## Client: `client.tsx` — tabella, stato inline, ingresso, pagination

`apps/piattaforma/src/app/admin/crm/contatti/client.tsx`:

- **Barra filtri** sopra la tabella: invariata per ricerca/cat/status/regione/
  assegnato + Reset. Il `select` sort offre solo **"Ultimo contatto"** (default,
  value `recente`) e **"Nome A→Z"** (`nome`); rimosso "urgente". Aggiungere un
  **chip toggle "🔴 Urgenti"** che setta/azzera `preset=urgenti` (mutuamente
  esclusivo col dropdown `status`: attivare il chip azzera `status`, selezionare
  uno `status` azzera il chip). `updateFilter` resetta sempre `page` a 1.
- **Tabella** (sostituisce `space-y-2` di card): `<table>` con header
  Azienda/Tipo/Città/Telefono/Assegnato/Ultimo contatto/Stato/(azione). Righe:
  - Azienda: nome (+ eventuale avatar iniziali piccolo, opzionale).
  - Tipo: "Broker"/"Agenzia".
  - Città (Regione): `citta` + `(regione)`.
  - Telefono: `tel`.
  - Assegnato: `assignedToName ?? '—'`.
  - Ultimo contatto: data IT o '—'.
  - **Stato**: componente `StatusSelect` (sotto).
  - Azione: bottone "Apri" → `setEditing(c)` (riuso modale).
  - Stile design-system (`pv-slate`/`pv-navy`), header sticky opzionale, scroll-x
    su mobile (`overflow-x-auto`).
- **`StatusSelect`** (nuovo componente nel file): `<select>` con S0..S10
  (label `STATI_LABEL`), valore corrente, colore badge dal `STATI_COLOR`.
  - `disabled` se `currentUserRole === 'SALES' && contact.assignedToId !== currentUserId`.
  - `onChange`: stato locale ottimistico + `useTransition` →
    `updateCrmContactStatusAction(id, value)`; on error → revert + `alert`/inline.
    `router.refresh()` non necessario (ottimistico + revalidate server).
- **Pagination** (sotto la tabella): "Mostrati X–Y di Z" + Prev/Next +
  numeri pagina compatti; ogni link preserva i filtri correnti e cambia solo
  `page`. Helper `pageHref(n)` costruisce la query da `filters` + `page=n`.
- **Ingresso unificato**: sostituire i due controlli (CsvImportButton + "+ Nuovo
  contatto") con **un bottone "+ Aggiungi contatti"** che apre un piccolo menu
  (popover/dropdown) con:
  - "Nuovo contatto" → `setCreating(true)` (modale create).
  - "Importa da CSV" → apre il dialog import (riuso della UI/logica
    `CsvImportButton`: selettore Rivenditori/Agenzie + file picker +
    `bulkImportCrmContactsAction`). Visibile solo se `canBulk`.
- `ContactModal`, `CsvImport` (logica), `STATI_LABEL`, `STATI_COLOR`, `REGIONI`
  restano e si riusano. Le card (`ContactCard`) vengono rimosse.

## Vista / componenti riusati

- **Modale dettaglio/create**: `ContactModal` invariata (dettaglio = stesso
  componente del create, già 4 tab).
- **Import CSV**: stessa logica, re-incapsulata dentro il menu "+ Aggiungi".

## Fuori scope

- Modifiche al modello `CrmContact` / migration (nessuna).
- Ordinamento per urgenza a livello SQL grezzo (sostituito da default "Ultimo
  contatto" + chip "Urgenti").
- Sort cliccabile su ogni colonna (solo i 2 sort esistenti via dropdown).
- L'altra pagina `admin/contatti` (non è la CRM pipeline; fuori scope).

## Test

- **Server action** `updateCrmContactStatusAction`: il repo non unit-testa le
  server action CRM con DB; verifica via typecheck/lint/build. (Le parti pure —
  es. `pageHref`/costruzione query se estratte — possono avere un test unitario.)
- Verifica completa app: typecheck/lint/test/build.
- Verifica manuale: pagination, filtri, chip Urgenti, cambio stato inline
  (salvataggio immediato + permesso SALES), menu "+ Aggiungi" (Nuovo/Import),
  CTA dettaglio.

## File toccati (riepilogo)

- `apps/piattaforma/src/app/admin/crm/contatti/page.tsx`
- `apps/piattaforma/src/app/admin/crm/contatti/client.tsx`
- `apps/piattaforma/src/app/admin/crm/contatti/actions.ts`
