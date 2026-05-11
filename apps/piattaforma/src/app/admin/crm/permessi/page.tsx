import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewCrmPermissions } from '@/lib/auth/permissions';
import { CrmTabs } from '../tabs';

const ROLES = [
  { key: 'ADMIN_PIATTAFORMA', label: 'Admin' },
  { key: 'AD', label: 'AD' },
  { key: 'CTO', label: 'CTO' },
  { key: 'CFO', label: 'CFO' },
  { key: 'SALES_MANAGER', label: 'Sales Mgr' },
  { key: 'SALES', label: 'Sales' },
] as const;

type CellValue = '✓' | '—' | string;

const PERMISSIONS: { section: string; rows: { label: string; cells: CellValue[] }[] }[] = [
  {
    section: 'Contatti',
    rows: [
      {
        label: 'Visualizza contatti',
        cells: ['✓', '✓', '✓', '—', '✓', '✓ (assegnati)'],
      },
      {
        label: 'Aggiunge / modifica contatti',
        cells: ['✓', '✓', '✓', '—', '✓', '✓ (assegnati)'],
      },
      {
        label: 'Elimina contatti',
        cells: ['✓', '✓', '✓', '—', '✓', '—'],
      },
      {
        label: 'Import CSV bulk',
        cells: ['✓', '✓', '✓', '—', '✓', '—'],
      },
    ],
  },
  {
    section: 'Sales',
    rows: [
      {
        label: 'Configura agent / Q&A',
        cells: ['✓', '✓', '✓', '—', '✓', '—'],
      },
      {
        label: 'Crea / gestisce campagne',
        cells: ['✓', '✓', '✓', '—', '✓ (proprie)', '—'],
      },
    ],
  },
  {
    section: 'Chatbot',
    rows: [
      {
        label: 'Configura bot testuali',
        cells: ['✓', '✓', '✓', '—', '—', '—'],
      },
    ],
  },
  {
    section: 'Dashboard',
    rows: [
      {
        label: 'Dashboard operativa CRM',
        cells: ['✓', '✓', '✓', '—', '✓', '—'],
      },
      {
        label: 'Dati economici',
        cells: ['✓', '✓', '✓', 'Lettura', '—', '—'],
      },
    ],
  },
  {
    section: 'Utenti team',
    rows: [
      {
        label: 'Visualizza utenti team',
        cells: ['✓', '✓', '✓', '—', '✓ (Sales)', '—'],
      },
      {
        label: 'Crea / modifica utenti',
        cells: ['✓', '✓', '✓', '—', '✓ (Sales)', '—'],
      },
    ],
  },
  {
    section: 'Permessi',
    rows: [
      {
        label: 'Visualizza matrice',
        cells: ['✓', '✓', '✓', '—', '—', '—'],
      },
    ],
  },
];

export default async function AdminCrmPermessiPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrmPermissions(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La matrice permessi è visibile solo ai ruoli admin/AD/CTO.
          </Alert>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell session={session} activePath="/admin/crm">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Matrice permessi
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Riepilogo accessi per ruolo. La matrice è descritta autoritativamente
            in <code>docs/crm-spec-implementativa.md</code> §3 e implementata in{' '}
            <code>lib/auth/permissions.ts</code>.
          </p>
        </header>

        <CrmTabs active="permessi" />

        <div className="overflow-x-auto rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-pv-slate-200 bg-pv-slate-50">
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  Funzione
                </th>
                {ROLES.map((r) => (
                  <th
                    key={r.key}
                    className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-pv-slate-500"
                  >
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((sec) => (
                <Fragment key={sec.section}>
                  <tr>
                    <td
                      colSpan={ROLES.length + 1}
                      className="border-b border-pv-slate-100 bg-pv-slate-50/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-pv-navy-800"
                    >
                      {sec.section}
                    </td>
                  </tr>
                  {sec.rows.map((row, i) => (
                    <tr
                      key={`row-${sec.section}-${i}`}
                      className="border-b border-pv-slate-100 last:border-b-0"
                    >
                      <td className="px-4 py-3 font-semibold text-pv-navy-800">
                        {row.label}
                      </td>
                      {row.cells.map((c, j) => (
                        <td
                          key={j}
                          className="px-3 py-3 text-center text-[13px]"
                        >
                          <PermCell value={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function PermCell({ value }: { value: CellValue }) {
  if (value === '✓') {
    return <span className="font-bold text-pv-green-500">✓</span>;
  }
  if (value === '—') {
    return <span className="text-pv-slate-300">—</span>;
  }
  if (value === 'Lettura') {
    return (
      <span className="rounded-full bg-pv-amber-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-amber-500">
        Lettura
      </span>
    );
  }
  // Stringhe come "✓ (assegnati)" — render plain
  return <span className="text-[12px] text-pv-slate-700">{value}</span>;
}
