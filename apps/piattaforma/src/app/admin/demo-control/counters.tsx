import { prisma } from '@pv/db';
import { STATI_IN_DISTRIBUZIONE } from '@/lib/pratiche/stati';

export async function Counters() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 3600_000);

  const [feeScheduled, feeOverdue, payoutsRichiesti, praticheAttesa, praticheEscalation, emails24h] =
    await Promise.all([
      prisma.feeAddebito.count({ where: { stato: 'SCHEDULED' } }),
      prisma.feeAddebito.count({
        where: { stato: 'SCHEDULED', scheduledAt: { lte: now } },
      }),
      prisma.payout.count({ where: { stato: 'RICHIESTO' } }),
      prisma.pratica.count({
        where: { stato: { in: [...STATI_IN_DISTRIBUZIONE] } },
      }),
      prisma.pratica.count({ where: { stato: 'IN_ESCALATION' } }),
      prisma.notificaInviata.count({ where: { sentAt: { gte: last24h } } }),
    ]);

  const cards = [
    { label: 'Addebiti SCHEDULED', value: feeScheduled, hint: `${feeOverdue} pronti` },
    { label: 'Payout RICHIESTI', value: payoutsRichiesti, hint: 'da processare' },
    { label: 'Pratiche in attesa', value: praticheAttesa, hint: 'round legacy + distribuzione v2' },
    { label: 'In escalation', value: praticheEscalation, hint: 'gestione manuale' },
    { label: 'Email ultime 24h', value: emails24h, hint: 'inviate' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-pv-slate-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-pv-slate-500">
            {c.label}
          </p>
          <p className="mt-1 text-2xl font-extrabold text-pv-navy-900">{c.value}</p>
          <p className="text-[11px] text-pv-slate-500">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}
