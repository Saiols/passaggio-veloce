import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { formatDate } from '@/lib/format';
import { TextSearchFilter } from '@/components/text-search-filter';
import { SuspendButton } from '../suspend-button';

type SearchParams = { q?: string };

export default async function AdminUtentiPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const q = sp.q?.trim();

  const where: Prisma.UserWhereInput = { deletedAt: null };
  if (q) {
    where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { cognome: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { company: { ragioneSociale: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    include: { company: { select: { ragioneSociale: true, type: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <AppShell session={session!} activePath="/admin/utenti">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Gestione utenti
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {users.length} utent{users.length === 1 ? 'e' : 'i'}
            {q ? ' (filtro attivo)' : ' nel sistema'}.
          </p>
        </header>

        <TextSearchFilter
          action="/admin/utenti"
          q={q}
          placeholder="Cerca per nome, email o azienda…"
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full text-[13px]">
            <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="px-5 py-3">Nome</th>
                <th className="px-5 py-3 hidden sm:table-cell">Email</th>
                <th className="px-5 py-3 hidden md:table-cell">Azienda</th>
                <th className="px-5 py-3">Ruolo</th>
                <th className="px-5 py-3">Stato</th>
                <th className="px-5 py-3 hidden lg:table-cell">Ultimo accesso</th>
                <th className="px-5 py-3 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-200">
              {users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-pv-slate-50">
                  <td className="px-5 py-3 font-semibold text-pv-navy-800">
                    {u.nome} {u.cognome}
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                    {u.email}
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                    {u.company?.ragioneSociale ?? '—'}
                    {u.company?.type && (
                      <span className="ml-2 rounded-full bg-pv-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-slate-500">
                        {u.company.type.toLowerCase()}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-pv-slate-700">
                    <span className="text-[11px] font-bold uppercase tracking-wider">
                      {u.role.toLowerCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                        u.status === 'ACTIVE'
                          ? 'bg-pv-green-50 text-pv-green-500'
                          : u.status === 'SUSPENDED'
                            ? 'bg-pv-red-50 text-pv-red-500'
                            : 'bg-pv-slate-100 text-pv-slate-500'
                      }`}
                    >
                      {u.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-500 lg:table-cell">
                    {formatDate(u.lastLoginAt)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {u.role !== 'ADMIN_PIATTAFORMA' && (
                      <SuspendButton
                        target={{ kind: 'user', id: u.id }}
                        suspended={u.status === 'SUSPENDED'}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
