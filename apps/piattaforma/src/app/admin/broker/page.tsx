import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatCard } from '@/components/ui';
import { TextSearchFilter } from '@/components/text-search-filter';
import { SuspendButton } from '../suspend-button';

type SearchParams = { q?: string };

export default async function AdminBrokerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const q = sp.q?.trim();

  const where: Prisma.CompanyWhereInput = { type: 'DEALER', deletedAt: null };
  if (q) {
    where.OR = [
      { ragioneSociale: { contains: q, mode: 'insensitive' } },
      { citta: { contains: q, mode: 'insensitive' } },
      { provincia: { contains: q, mode: 'insensitive' } },
      { partitaIva: { contains: q } },
    ];
  }

  const broker = await prisma.company.findMany({
    where,
    orderBy: { ragioneSociale: 'asc' },
    include: {
      _count: { select: { praticheCreate: true, users: true } },
    },
  });

  const sospesi = broker.filter((b) => b.suspendedAt !== null);

  return (
    <AppShell session={session!} activePath="/admin/broker">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Broker
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Concessionari e commercianti che inviano pratiche alla piattaforma.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Totali" value={broker.length} accent="navy" />
          <StatCard
            label="Attivi"
            value={broker.length - sospesi.length}
            accent="green"
          />
          <StatCard label="Sospesi" value={sospesi.length} accent="red" />
        </div>

        <TextSearchFilter
          action="/admin/broker"
          q={q}
          placeholder="Cerca per ragione sociale, città, provincia o P.IVA…"
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {broker.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessun broker trovato.</p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="px-5 py-3">Broker</th>
                  <th className="px-5 py-3 hidden sm:table-cell">Provincia</th>
                  <th className="px-5 py-3 hidden md:table-cell">P.IVA</th>
                  <th className="px-5 py-3 hidden lg:table-cell">Pratiche</th>
                  <th className="px-5 py-3 hidden lg:table-cell">Utenti</th>
                  <th className="px-5 py-3 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-200">
                {broker.map((b) => (
                  <tr key={b.id} className="transition-colors hover:bg-pv-slate-50">
                    <td className="px-5 py-3 font-semibold text-pv-navy-800">
                      {b.ragioneSociale}
                      {b.suspendedAt && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500">
                          Sospeso admin
                        </span>
                      )}
                      <p className="text-[11px] font-normal text-pv-slate-500">
                        {b.citta}
                      </p>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                      {b.provincia}
                    </td>
                    <td className="px-5 py-3 hidden font-mono text-pv-slate-700 md:table-cell">
                      {b.partitaIva}
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 lg:table-cell">
                      {b._count.praticheCreate}
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 lg:table-cell">
                      {b._count.users}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <SuspendButton
                        target={{ kind: 'company', id: b.id }}
                        suspended={b.suspendedAt !== null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
