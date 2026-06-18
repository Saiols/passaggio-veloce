'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button } from '@/components/ui';
import {
  createCrmContactAction,
  updateCrmContactAction,
  deleteCrmContactAction,
  bulkImportCrmContactsAction,
  updateCrmContactStatusAction,
  type CrmContactInput,
} from './actions';
import { buildContactsQuery } from './query';

type ContactRow = {
  id: string;
  nome: string;
  cat: 'BROKER' | 'AGENZIA';
  tel: string;
  wa: string | null;
  email: string | null;
  piva: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  regione: string | null;
  status: string;
  fonte: string;
  assignedToId: string | null;
  assignedToName: string | null;
  lastContactAt: string | null;
  nextContactAt: string | null;
  callCount: number;
  callEsito: string | null;
  sentiment: string | null;
  obiezioni: string | null;
  noteAI: string | null;
  trascrizione: string | null;
  noteManuali: string | null;
  linkInviato: boolean;
  linkInviatoAt: string | null;
  linkAperto: boolean;
  linkAperture: number;
  videoInviato: boolean;
  videoMin: number;
  mailAperta: boolean;
  smsInviato: boolean;
  waInviato: boolean;
  iscrizioneInit: boolean;
  iscrizioneComp: boolean;
  iscrizioneAt: string | null;
  platStatus: string | null;
  primaPratica: boolean;
  primaPraticaAt: string | null;
  praticheTotal: number;
  praticheMonth: number;
  lastAccessAt: string | null;
  tassoComp: number;
};

type SalesUser = { id: string; name: string };

type Filters = {
  q: string;
  cat: string;
  status: string;
  regione: string;
  assigned: string;
  sort: 'recente' | 'nome';
  preset: string;
};

const REGIONI = [
  'Abruzzo',
  'Basilicata',
  'Calabria',
  'Campania',
  'Emilia-Romagna',
  'Friuli-Venezia Giulia',
  'Lazio',
  'Liguria',
  'Lombardia',
  'Marche',
  'Molise',
  'Piemonte',
  'Puglia',
  'Sardegna',
  'Sicilia',
  'Toscana',
  'Trentino-Alto Adige',
  'Umbria',
  "Valle d'Aosta",
  'Veneto',
];

const STATI_LABEL: Record<string, string> = {
  S0: 'Non contattato',
  S1: 'Non risponde',
  S2: 'Non interessato',
  S3: 'Interessato',
  S4: 'Link non aperto',
  S5: 'Link aperto',
  S6: 'Iscriz. incompleta',
  S7: 'Iscritto inattivo',
  S8: 'Prima pratica',
  S9: 'Attivo',
  S10: 'Churned',
};

const STATI_COLOR: Record<string, string> = {
  S0: 'bg-pv-slate-100 text-pv-slate-700',
  S1: 'bg-pv-amber-50 text-pv-amber-500',
  S2: 'bg-pv-red-50 text-pv-red-500',
  S3: 'bg-pv-green-50 text-pv-green-500',
  S4: 'bg-pv-amber-50 text-pv-amber-500',
  S5: 'bg-orange-50 text-pv-orange-500',
  S6: 'bg-purple-50 text-purple-700',
  S7: 'bg-blue-50 text-blue-700',
  S8: 'bg-pv-green-50 text-pv-green-500',
  S9: 'bg-emerald-100 text-emerald-700',
  S10: 'bg-pv-slate-100 text-pv-slate-500',
};

const ROLE_CAN_DELETE = ['ADMIN_PIATTAFORMA', 'AD', 'CTO', 'SALES_MANAGER'];
const ROLE_CAN_BULK = ['ADMIN_PIATTAFORMA', 'AD', 'CTO', 'SALES_MANAGER'];

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
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [creating, setCreating] = useState(false);
  const canDelete = ROLE_CAN_DELETE.includes(currentUserRole);
  const canBulk = ROLE_CAN_BULK.includes(currentUserRole);

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

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          defaultValue={filters.q}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateFilter('q', (e.target as HTMLInputElement).value);
            }
          }}
          placeholder="🔍 Cerca nome, email, città, telefono…"
          className="flex-1 min-w-[200px] rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
        <select
          value={filters.cat}
          onChange={(e) => updateFilter('cat', e.target.value)}
          className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        >
          <option value="">Tutti i tipi</option>
          <option value="BROKER">Broker</option>
          <option value="AGENZIA">Agenzia</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        >
          <option value="">Tutti gli stati</option>
          {Object.entries(STATI_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {k} — {l}
            </option>
          ))}
        </select>
        <select
          value={filters.regione}
          onChange={(e) => updateFilter('regione', e.target.value)}
          className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        >
          <option value="">Tutte le regioni</option>
          {REGIONI.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={filters.assigned}
          onChange={(e) => updateFilter('assigned', e.target.value)}
          className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        >
          <option value="">Tutti gli assegnati</option>
          {salesUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
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
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50"
        >
          Reset
        </button>
        <div className="ml-auto">
          <AddContactsMenu
            canBulk={canBulk}
            onNew={() => setCreating(true)}
            onImported={() => router.refresh()}
          />
        </div>
      </div>

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

      {(editing || creating) && (
        <ContactModal
          contact={editing}
          salesUsers={salesUsers}
          canDelete={canDelete}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

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

// ════════════════════════════════════════════════════════
// Contact Modal (4 tab)
// ════════════════════════════════════════════════════════
type Tab = 'anagrafica' | 'stato' | 'tracking' | 'piattaforma';

function ContactModal({
  contact,
  salesUsers,
  canDelete,
  currentUserRole,
  currentUserId,
  onClose,
  onSaved,
}: {
  contact: ContactRow | null;
  salesUsers: SalesUser[];
  canDelete: boolean;
  currentUserRole: string;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !contact;
  const [tab, setTab] = useState<Tab>('anagrafica');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Form state
  const [data, setData] = useState<CrmContactInput>(() => initialData(contact));

  // Permessi specifici
  const canEditPiattaforma =
    !['SALES'].includes(currentUserRole); // SALES legge solo (decisione 7 + tab Piattaforma readonly)
  const isReadOnlyForSales =
    currentUserRole === 'SALES' &&
    contact !== null &&
    contact.assignedToId !== currentUserId;

  const set = <K extends keyof CrmContactInput>(
    k: K,
    v: CrmContactInput[K],
  ): void => {
    setData((d) => ({ ...d, [k]: v }));
  };

  const handleSave = (): void => {
    setError(null);
    startTransition(async () => {
      const res = isCreate
        ? await createCrmContactAction(data)
        : await updateCrmContactAction(contact!.id, data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  const handleDelete = (): void => {
    if (!contact) return;
    if (!confirm(`Eliminare il contatto "${contact.nome}"?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCrmContactAction(contact.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-[16px] bg-white shadow-[var(--pv-shadow-card-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
          <h2 className="text-[16px] font-extrabold text-pv-navy-900">
            {isCreate ? 'Nuovo contatto' : contact!.nome}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[22px] leading-none text-pv-slate-500 hover:text-pv-navy-900"
            aria-label="Chiudi"
          >
            ×
          </button>
        </header>

        <nav
          role="tablist"
          className="flex gap-1 border-b border-pv-slate-100 bg-pv-slate-50 px-3 py-2"
        >
          {(
            [
              ['anagrafica', 'Anagrafica'],
              ['stato', 'Stato & Chiamate'],
              ['tracking', 'Tracking & Pixel'],
              ['piattaforma', 'Piattaforma'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={
                'rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ' +
                (tab === k
                  ? 'bg-white text-pv-navy-900 shadow-[var(--pv-shadow-card)]'
                  : 'text-pv-slate-700 hover:bg-pv-slate-100')
              }
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'anagrafica' && (
            <TabAnagrafica
              data={data}
              set={set}
              salesUsers={salesUsers}
              readOnly={isReadOnlyForSales}
            />
          )}
          {tab === 'stato' && (
            <TabStato data={data} set={set} readOnly={isReadOnlyForSales} />
          )}
          {tab === 'tracking' && (
            <TabTracking data={data} set={set} readOnly={isReadOnlyForSales} />
          )}
          {tab === 'piattaforma' && (
            <TabPiattaforma
              data={data}
              set={set}
              readOnly={isReadOnlyForSales || !canEditPiattaforma}
            />
          )}
          {error && (
            <div className="mt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-pv-slate-200 px-5 py-3">
          {!isCreate && canDelete ? (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={pending}
            >
              Elimina contatto
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Annulla
            </Button>
            {!isReadOnlyForSales && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={pending}
                loading={pending}
                loadingLabel="Salvataggio…"
              >
                Salva
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function initialData(c: ContactRow | null): CrmContactInput {
  return {
    nome: c?.nome ?? '',
    cat: (c?.cat ?? 'AGENZIA') as 'BROKER' | 'AGENZIA',
    tel: c?.tel ?? '',
    wa: c?.wa ?? '',
    email: c?.email ?? '',
    piva: c?.piva ?? '',
    indirizzo: c?.indirizzo ?? '',
    citta: c?.citta ?? '',
    cap: c?.cap ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    regione: (c?.regione ?? '') as any,
    status: (c?.status ?? 'S0') as CrmContactInput['status'],
    fonte: (c?.fonte ?? 'CSV_INIZIALE') as CrmContactInput['fonte'],
    assignedToId: c?.assignedToId ?? '',
    lastContactAt: c?.lastContactAt?.slice(0, 10) ?? '',
    nextContactAt: c?.nextContactAt?.slice(0, 10) ?? '',
    callCount: c?.callCount ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callEsito: (c?.callEsito ?? '') as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sentiment: (c?.sentiment ?? '') as any,
    obiezioni: c?.obiezioni ?? '',
    noteAI: c?.noteAI ?? '',
    trascrizione: c?.trascrizione ?? '',
    noteManuali: c?.noteManuali ?? '',
    linkInviato: c?.linkInviato ?? false,
    linkInviatoAt: c?.linkInviatoAt?.slice(0, 10) ?? '',
    linkAperto: c?.linkAperto ?? false,
    linkAperture: c?.linkAperture ?? 0,
    videoInviato: c?.videoInviato ?? false,
    videoMin: c?.videoMin ?? 0,
    mailAperta: c?.mailAperta ?? false,
    smsInviato: c?.smsInviato ?? false,
    waInviato: c?.waInviato ?? false,
    iscrizioneInit: c?.iscrizioneInit ?? false,
    iscrizioneComp: c?.iscrizioneComp ?? false,
    iscrizioneAt: c?.iscrizioneAt?.slice(0, 10) ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    platStatus: (c?.platStatus ?? '') as any,
    primaPratica: c?.primaPratica ?? false,
    primaPraticaAt: c?.primaPraticaAt?.slice(0, 10) ?? '',
    praticheTotal: c?.praticheTotal ?? 0,
    praticheMonth: c?.praticheMonth ?? 0,
    lastAccessAt: c?.lastAccessAt?.slice(0, 10) ?? '',
    tassoComp: c?.tassoComp ?? 0,
  };
}

// ════════════════════════════════════════════════════════
// TABS
// ════════════════════════════════════════════════════════
type TabProps = {
  data: CrmContactInput;
  set: <K extends keyof CrmContactInput>(k: K, v: CrmContactInput[K]) => void;
  readOnly?: boolean;
};

function FieldText({
  label,
  value,
  required,
  readOnly,
  type = 'text',
  onChange,
  hint,
}: {
  label: string;
  value: string;
  required?: boolean;
  readOnly?: boolean;
  type?: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] disabled:bg-pv-slate-50 disabled:text-pv-slate-500"
      />
      {hint && (
        <span className="mt-0.5 block text-[10.5px] text-pv-slate-500">{hint}</span>
      )}
    </label>
  );
}

function FieldSelect({
  label,
  value,
  required,
  readOnly,
  options,
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  readOnly?: boolean;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
        {required ? ' *' : ''}
      </span>
      <select
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] disabled:bg-pv-slate-50 disabled:text-pv-slate-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldBool({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: boolean;
  readOnly?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]">
      <input
        type="checkbox"
        checked={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-pv-navy-700"
      />
      <span className="font-semibold text-pv-slate-700">{label}</span>
    </label>
  );
}

function FieldTextarea({
  label,
  value,
  readOnly,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        disabled={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] disabled:bg-pv-slate-50 disabled:text-pv-slate-500"
      />
    </label>
  );
}

function TabAnagrafica({
  data,
  set,
  salesUsers,
  readOnly,
}: TabProps & { salesUsers: SalesUser[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FieldText
          label="Nome azienda"
          value={data.nome}
          required
          readOnly={readOnly}
          onChange={(v) => set('nome', v)}
        />
      </div>
      <FieldSelect
        label="Tipo"
        value={data.cat}
        required
        readOnly={readOnly}
        onChange={(v) => set('cat', v as 'BROKER' | 'AGENZIA')}
        options={[
          { value: 'BROKER', label: 'Broker' },
          { value: 'AGENZIA', label: 'Agenzia' },
        ]}
      />
      <FieldText
        label="Telefono fisso"
        value={data.tel}
        required
        readOnly={readOnly}
        onChange={(v) => set('tel', v)}
        hint="Sempre obbligatorio"
      />
      <FieldText
        label="WhatsApp"
        value={data.wa ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('wa', v)}
      />
      <FieldText
        label="Email"
        type="email"
        value={data.email ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('email', v)}
      />
      <FieldText
        label="P.IVA"
        value={data.piva ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('piva', v)}
      />
      <FieldText
        label="Indirizzo"
        value={data.indirizzo ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('indirizzo', v)}
      />
      <FieldText
        label="Città"
        value={data.citta ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('citta', v)}
      />
      <FieldText
        label="CAP"
        value={data.cap ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('cap', v)}
      />
      <FieldSelect
        label="Regione"
        value={(data.regione as string) ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('regione', v as never)}
        options={[
          { value: '', label: '— Nessuna' },
          ...REGIONI.map((r) => ({ value: r, label: r })),
        ]}
      />
      <FieldSelect
        label="Assegnato a"
        value={(data.assignedToId as string) ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('assignedToId', v)}
        options={[
          { value: '', label: '— Non assegnato' },
          ...salesUsers.map((u) => ({ value: u.id, label: u.name })),
        ]}
      />
      <FieldSelect
        label="Fonte acquisizione"
        value={data.fonte}
        readOnly={readOnly}
        onChange={(v) => set('fonte', v as CrmContactInput['fonte'])}
        options={[
          { value: 'CSV_INIZIALE', label: 'CSV iniziale' },
          { value: 'ISCRIZIONE_DIRETTA', label: 'Iscrizione diretta' },
          { value: 'REFERRAL', label: 'Referral' },
          { value: 'ALTRO', label: 'Altro' },
        ]}
      />
    </div>
  );
}

function TabStato({ data, set, readOnly }: TabProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FieldSelect
        label="Stato CRM"
        value={data.status}
        required
        readOnly={readOnly}
        onChange={(v) => set('status', v as CrmContactInput['status'])}
        options={Object.entries(STATI_LABEL).map(([k, l]) => ({
          value: k,
          label: `${k} — ${l}`,
        }))}
      />
      <FieldText
        label="Ultimo contatto"
        type="date"
        value={data.lastContactAt ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('lastContactAt', v)}
      />
      <FieldText
        label="Prossimo contatto pianificato"
        type="date"
        value={data.nextContactAt ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('nextContactAt', v)}
      />
      <FieldText
        label="N. chiamate totali"
        type="number"
        value={String(data.callCount ?? 0)}
        readOnly={readOnly}
        onChange={(v) => set('callCount', Number(v))}
      />
      <FieldSelect
        label="Esito ultima chiamata"
        value={(data.callEsito as string) ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('callEsito', v as never)}
        options={[
          { value: '', label: '—' },
          { value: 'NON_RISPONDE', label: 'Non risponde' },
          { value: 'NON_INTERESSATO', label: 'Non interessato' },
          { value: 'INTERESSATO', label: 'Interessato' },
          { value: 'RICHIAMA', label: 'Richiama' },
          { value: 'ISCRITTO', label: 'Iscritto' },
        ]}
      />
      <FieldSelect
        label="Sentiment"
        value={(data.sentiment as string) ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('sentiment', v as never)}
        options={[
          { value: '', label: '—' },
          { value: 'POSITIVO', label: 'Positivo' },
          { value: 'NEUTRO', label: 'Neutro' },
          { value: 'NEGATIVO', label: 'Negativo' },
        ]}
      />
      <div className="sm:col-span-2">
        <FieldText
          label="Obiezioni sollevate (tag separati da virgola)"
          value={data.obiezioni ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('obiezioni', v)}
          hint="Es. dubbio prezzo, vuole video, ha già agenzia"
        />
      </div>
      <div className="sm:col-span-2">
        <FieldTextarea
          label="Note AI — riassunto ultima chiamata"
          value={data.noteAI ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('noteAI', v)}
        />
      </div>
      <div className="sm:col-span-2">
        <FieldTextarea
          label="Trascrizione completa"
          value={data.trascrizione ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('trascrizione', v)}
          rows={5}
        />
      </div>
      <div className="sm:col-span-2">
        <FieldTextarea
          label="Note manuali"
          value={data.noteManuali ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('noteManuali', v)}
          rows={3}
        />
      </div>
    </div>
  );
}

function TabTracking({ data, set, readOnly }: TabProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FieldBool
        label="Link inviato"
        value={data.linkInviato}
        readOnly={readOnly}
        onChange={(v) => set('linkInviato', v)}
      />
      <FieldText
        label="Data invio link"
        type="date"
        value={data.linkInviatoAt ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('linkInviatoAt', v)}
      />
      <FieldBool
        label="Link aperto"
        value={data.linkAperto}
        readOnly={readOnly}
        onChange={(v) => set('linkAperto', v)}
      />
      <FieldText
        label="N. aperture link"
        type="number"
        value={String(data.linkAperture ?? 0)}
        readOnly={readOnly}
        onChange={(v) => set('linkAperture', Number(v))}
      />
      <FieldBool
        label="Video tutorial inviato"
        value={data.videoInviato}
        readOnly={readOnly}
        onChange={(v) => set('videoInviato', v)}
      />
      <FieldText
        label="Minuti video visti"
        type="number"
        value={String(data.videoMin ?? 0)}
        readOnly={readOnly}
        onChange={(v) => set('videoMin', Number(v))}
      />
      <FieldBool
        label="Mail aperta"
        value={data.mailAperta}
        readOnly={readOnly}
        onChange={(v) => set('mailAperta', v)}
      />
      <FieldBool
        label="SMS inviato"
        value={data.smsInviato}
        readOnly={readOnly}
        onChange={(v) => set('smsInviato', v)}
      />
      <FieldBool
        label="WhatsApp inviato"
        value={data.waInviato}
        readOnly={readOnly}
        onChange={(v) => set('waInviato', v)}
      />
      <FieldBool
        label="Iscrizione iniziata"
        value={data.iscrizioneInit}
        readOnly={readOnly}
        onChange={(v) => set('iscrizioneInit', v)}
      />
      <FieldBool
        label="Iscrizione completata"
        value={data.iscrizioneComp}
        readOnly={readOnly}
        onChange={(v) => set('iscrizioneComp', v)}
      />
      <FieldText
        label="Data iscrizione"
        type="date"
        value={data.iscrizioneAt ?? ''}
        readOnly={readOnly}
        onChange={(v) => set('iscrizioneAt', v)}
      />
    </div>
  );
}

function TabPiattaforma({ data, set, readOnly }: TabProps) {
  return (
    <>
      <p className="mb-3 text-[12px] text-pv-slate-500">
        Dati popolati automaticamente dal cron sync con la piattaforma. Modifica
        manuale solo per casi eccezionali (override admin).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldSelect
          label="Status account piattaforma"
          value={(data.platStatus as string) ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('platStatus', v as never)}
          options={[
            { value: '', label: '—' },
            { value: 'ATTIVO', label: 'Attivo' },
            { value: 'INATTIVO', label: 'Inattivo' },
            { value: 'SOSPESO', label: 'Sospeso' },
          ]}
        />
        <FieldBool
          label="Prima pratica completata"
          value={data.primaPratica}
          readOnly={readOnly}
          onChange={(v) => set('primaPratica', v)}
        />
        <FieldText
          label="Data prima pratica"
          type="date"
          value={data.primaPraticaAt ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('primaPraticaAt', v)}
        />
        <FieldText
          label="Pratiche totali"
          type="number"
          value={String(data.praticheTotal ?? 0)}
          readOnly={readOnly}
          onChange={(v) => set('praticheTotal', Number(v))}
        />
        <FieldText
          label="Pratiche ultimo mese"
          type="number"
          value={String(data.praticheMonth ?? 0)}
          readOnly={readOnly}
          onChange={(v) => set('praticheMonth', Number(v))}
        />
        <FieldText
          label="Ultimo accesso piattaforma"
          type="date"
          value={data.lastAccessAt ?? ''}
          readOnly={readOnly}
          onChange={(v) => set('lastAccessAt', v)}
        />
        <FieldText
          label="Tasso completamento %"
          type="number"
          value={String(data.tassoComp ?? 0)}
          readOnly={readOnly}
          onChange={(v) => set('tassoComp', Number(v))}
        />
      </div>
    </>
  );
}
