import Link from 'next/link';
import { prisma } from '@pv/db';
import { StatCard } from '@/components/ui';

export async function AdminDashboard() {
  const [pratiche, dealer, agenzie, escalation] = await Promise.all([
    prisma.pratica.count({ where: { deletedAt: null } }),
    prisma.company.count({ where: { type: 'DEALER', deletedAt: null } }),
    prisma.company.count({ where: { type: 'AGENZIA', deletedAt: null } }),
    prisma.pratica.count({ where: { stato: 'IN_ESCALATION', deletedAt: null } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
      <header className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Admin piattaforma
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Overview
        </h1>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pratiche totali" value={pratiche} accent="navy" />
        <StatCard label="Dealer attivi" value={dealer} accent="navy" />
        <StatCard label="Agenzie attive" value={agenzie} accent="navy" />
        <StatCard label="Escalation" value={escalation} hint="Richiedono intervento" accent="red" />
      </div>

      <section className="rounded-[16px] border border-pv-slate-200 bg-white p-6 shadow-[var(--pv-shadow-card)]">
        <h2 className="text-[15px] font-bold text-pv-navy-800">Strumenti admin</h2>
        <p className="mt-1 text-[13px] text-pv-slate-500">
          Le sezioni di amministrazione verranno attivate in Fase 9.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link
            href="/admin/pratiche"
            className="rounded-[12px] border border-pv-slate-200 p-4 text-[13px] font-semibold text-pv-navy-700 transition-colors hover:bg-pv-slate-50"
          >
            Gestione pratiche →
          </Link>
          <Link
            href="/admin/utenti"
            className="rounded-[12px] border border-pv-slate-200 p-4 text-[13px] font-semibold text-pv-navy-700 transition-colors hover:bg-pv-slate-50"
          >
            Gestione utenti →
          </Link>
          <Link
            href="/admin/escalation"
            className="rounded-[12px] border border-pv-slate-200 p-4 text-[13px] font-semibold text-pv-navy-700 transition-colors hover:bg-pv-slate-50"
          >
            Escalation →
          </Link>
        </div>
      </section>
    </div>
  );
}
