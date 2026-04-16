import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatusChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';

export default async function AdminPratichePage() {
  const session = await auth();
  const pratiche = await prisma.pratica.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
    },
  });

  return (
    <AppShell session={session!} activePath="/admin/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Gestione pratiche
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Ultime {pratiche.length} pratiche nel sistema.
          </p>
        </header>

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full text-[13px]">
            <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="px-5 py-3">Codice</th>
                <th className="px-5 py-3">Targa</th>
                <th className="px-5 py-3 hidden md:table-cell">Broker</th>
                <th className="px-5 py-3 hidden md:table-cell">Agenzia</th>
                <th className="px-5 py-3">Stato</th>
                <th className="px-5 py-3 hidden lg:table-cell">Fee</th>
                <th className="px-5 py-3 text-right">Quando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-200">
              {pratiche.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-pv-slate-50">
                  <td className="px-5 py-3 font-mono font-semibold text-pv-navy-800">
                    <Link href={`/pratiche/${p.id}`} className="hover:underline">
                      {p.codicePratica ?? 'BOZZA'}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{p.targa ?? '—'}</td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                    {p.broker.ragioneSociale}
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                    {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                  </td>
                  <td className="px-5 py-3">
                    <StatusChip stato={p.stato as PraticaStato} />
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 lg:table-cell">
                    {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                  </td>
                  <td className="px-5 py-3 text-right text-pv-slate-500">
                    {formatRelative(p.submittedAt ?? p.createdAt)}
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
