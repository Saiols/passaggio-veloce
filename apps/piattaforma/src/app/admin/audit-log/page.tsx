import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, StatCard } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatDateTime, formatRelative } from '@/lib/format';

const PAGE_SIZE = 50;

const ROLE_FILTERS = [
  { value: '', label: 'Tutti i ruoli' },
  { value: 'ADMIN_PIATTAFORMA', label: 'Admin platform' },
  { value: 'ASSISTENTE', label: 'Assistente' },
  { value: 'AD', label: 'AD' },
  { value: 'CTO', label: 'CTO' },
  { value: 'CFO', label: 'CFO' },
  { value: 'SALES_MANAGER', label: 'Sales manager' },
  { value: 'SALES', label: 'Sales' },
  { value: 'ADMIN_AZIENDA', label: 'Admin azienda' },
  { value: 'UTENTE_AZIENDA', label: 'Utente azienda' },
] as const;

type SearchParams = {
  role?: string;
  q?: string;
  page?: string;
};

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/audit-log">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono consultare l&apos;audit log accessi.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const role = sp.role ?? '';
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1'));

  const where: Prisma.UserWhereInput = { deletedAt: null };
  if (role) where.role = role as Prisma.UserWhereInput['role'];
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { nome: { contains: q, mode: 'insensitive' } },
      { cognome: { contains: q, mode: 'insensitive' } },
      { company: { ragioneSociale: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [users, total, statsLast7d, statsToday, statsNever] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        company: { select: { ragioneSociale: true, type: true } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({
      where: { deletedAt: null, lastLoginAt: { gte: sevenDaysAgo } },
    }),
    prisma.user.count({
      where: { deletedAt: null, lastLoginAt: { gte: todayStart } },
    }),
    prisma.user.count({
      where: { deletedAt: null, lastLoginAt: null },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (overrides: Partial<SearchParams>): string => {
    const params = new URLSearchParams();
    const merged: SearchParams = { role, q, page: String(page), ...overrides };
    if (merged.role) params.set('role', merged.role);
    if (merged.q) params.set('q', merged.q);
    if (merged.page && merged.page !== '1') params.set('page', merged.page);
    const qs = params.toString();
    return qs ? `/admin/audit-log?${qs}` : '/admin/audit-log';
  };

  return (
    <AppShell session={session} activePath="/admin/audit-log">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Audit log accessi
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Ultimi accessi degli utenti. Utile per audit GDPR e investigazione
            problemi di accesso.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Utenti totali" value={total} accent="navy" />
          <StatCard
            label="Login oggi"
            value={statsToday}
            hint="Dalla mezzanotte"
            accent="green"
          />
          <StatCard
            label="Login ultimi 7gg"
            value={statsLast7d}
            hint="Attività recente"
            accent="navy"
          />
          <StatCard
            label="Mai loggati"
            value={statsNever}
            hint="Account inattivi"
            accent="slate"
          />
        </div>

        <form
          action="/admin/audit-log"
          method="GET"
          className="mb-4 flex flex-wrap items-end gap-2 rounded-[12px] border border-pv-slate-200 bg-white p-3 shadow-[var(--pv-shadow-card)]"
        >
          <label className="block flex-1 min-w-[200px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Cerca
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Email, nome, cognome o ragione sociale…"
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Ruolo
            </span>
            <select
              name="role"
              defaultValue={role}
              className="mt-1 rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            >
              {ROLE_FILTERS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
          >
            Filtra
          </button>
          {(role || q) && (
            <Link
              href="/admin/audit-log"
              className="text-[13px] font-semibold text-pv-slate-500 hover:text-pv-navy-900"
            >
              Reset
            </Link>
          )}
        </form>

        <div className="overflow-hidden rounded-[12px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full text-[13px]">
            <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="px-5 py-3">Utente</th>
                <th className="px-5 py-3">Ruolo</th>
                <th className="px-5 py-3 hidden sm:table-cell">Azienda</th>
                <th className="px-5 py-3">Ultimo accesso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-200">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-pv-slate-500">
                    Nessun utente con questi filtri.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-pv-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-pv-navy-900">
                        {u.nome} {u.cognome}
                      </p>
                      <p className="text-[11px] text-pv-slate-500">{u.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full bg-pv-slate-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-slate-700">
                        {labelRuolo(u.role)}
                      </span>
                      {u.status !== 'ACTIVE' && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-red-500">
                          {u.status}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                      {u.company?.ragioneSociale ?? (
                        <span className="text-pv-slate-400">— team interno</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {u.lastLoginAt ? (
                        <>
                          <p className="text-pv-navy-900">
                            {formatRelative(u.lastLoginAt)}
                          </p>
                          <p className="text-[10.5px] text-pv-slate-500">
                            {formatDateTime(u.lastLoginAt)}
                          </p>
                        </>
                      ) : (
                        <span className="text-[12px] text-pv-slate-400">
                          Mai
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <nav className="mt-4 flex items-center justify-between text-[12px] text-pv-slate-500">
            <p>
              Pagina <strong className="text-pv-navy-900">{page}</strong> di{' '}
              {totalPages} · {total} utenti
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={buildHref({ page: String(page - 1) })}
                  className="rounded-[10px] border border-pv-slate-300 px-3 py-1.5 font-semibold hover:bg-pv-slate-50"
                >
                  ← Precedente
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  className="rounded-[10px] border border-pv-slate-300 px-3 py-1.5 font-semibold hover:bg-pv-slate-50"
                >
                  Successiva →
                </Link>
              )}
            </div>
          </nav>
        )}
      </div>
    </AppShell>
  );
}

function labelRuolo(role: string): string {
  const map: Record<string, string> = {
    ADMIN_PIATTAFORMA: 'Admin',
    ASSISTENTE: 'Assistente',
    AD: 'AD',
    CTO: 'CTO',
    CFO: 'CFO',
    SALES_MANAGER: 'Sales mgr',
    SALES: 'Sales',
    ADMIN_AZIENDA: 'Admin azienda',
    UTENTE_AZIENDA: 'Utente',
  };
  return map[role] ?? role;
}
