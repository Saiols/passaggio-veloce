import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, StatCard } from '@/components/ui';
import { RANKING } from '@/lib/distribuzione';

export default async function AdminAgenziePage() {
  const session = await auth();

  const agenzie = await prisma.company.findMany({
    where: { type: 'AGENZIA', deletedAt: null },
    orderBy: { ragioneSociale: 'asc' },
  });

  const ratings = await prisma.valutazione.groupBy({
    by: ['agenziaId'],
    _avg: { stelle: true },
    _count: { _all: true },
  });
  const byId = new Map(
    ratings.map((r) => [r.agenziaId, { avg: r._avg.stelle, count: r._count._all }]),
  );

  type Row = typeof agenzie[number] & {
    ratingAvg: number | null;
    ratingCount: number;
    stato: 'attiva-rankata' | 'attiva-nonrank' | 'sospesa';
  };
  const rows: Row[] = agenzie.map((a) => {
    const r = byId.get(a.id);
    const ratingAvg = r?.avg ?? null;
    const ratingCount = r?.count ?? 0;
    const ranked = ratingCount >= RANKING.MIN_RATINGS_FOR_RANK;
    const sospesa = ranked && (ratingAvg ?? 0) < RANKING.MIN_AVG_TO_STAY_ACTIVE;
    return {
      ...a,
      ratingAvg,
      ratingCount,
      stato: sospesa ? 'sospesa' : ranked ? 'attiva-rankata' : 'attiva-nonrank',
    };
  });

  // Ordine: sospese prima (rosso in cima), poi rankate desc, poi non rankate
  rows.sort((a, b) => {
    if (a.stato === 'sospesa' && b.stato !== 'sospesa') return -1;
    if (b.stato === 'sospesa' && a.stato !== 'sospesa') return 1;
    if (a.stato === 'attiva-rankata' && b.stato === 'attiva-rankata') {
      return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
    }
    if (a.stato === 'attiva-rankata') return -1;
    if (b.stato === 'attiva-rankata') return 1;
    return a.ragioneSociale.localeCompare(b.ragioneSociale);
  });

  const sospese = rows.filter((r) => r.stato === 'sospesa');
  const rankate = rows.filter((r) => r.stato === 'attiva-rankata');

  return (
    <AppShell session={session!} activePath="/admin/agenzie">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Agenzie
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Ranking calcolato su minimo {RANKING.MIN_RATINGS_FOR_RANK} valutazioni.
            Soglia sospensione automatica: rating medio sotto{' '}
            {RANKING.MIN_AVG_TO_STAY_ACTIVE}.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Totali" value={rows.length} accent="navy" />
          <StatCard label="Rankate" value={rankate.length} accent="green" />
          <StatCard
            label="Non rankate"
            value={rows.length - rankate.length - sospese.length}
            hint="< 5 valutazioni"
            accent="slate"
          />
          <StatCard label="Sospese" value={sospese.length} accent="red" />
        </div>

        {sospese.length > 0 && (
          <div className="mb-5">
            <Alert variant="warning" title={`${sospese.length} agenzie sospese`}>
              Sono escluse automaticamente dalla distribuzione finché l&apos;admin non
              interviene manualmente.
            </Alert>
          </div>
        )}

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full text-[13px]">
            <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="px-5 py-3">Agenzia</th>
                <th className="px-5 py-3 hidden sm:table-cell">Provincia</th>
                <th className="px-5 py-3">Rating</th>
                <th className="px-5 py-3 hidden sm:table-cell">Valutazioni</th>
                <th className="px-5 py-3">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-200">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-pv-slate-50">
                  <td className="px-5 py-3 font-semibold text-pv-navy-800">
                    {r.ragioneSociale}
                    <p className="text-[11px] font-normal text-pv-slate-500">
                      {r.citta}
                    </p>
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                    {r.provincia}
                  </td>
                  <td className="px-5 py-3 text-pv-slate-700">
                    {r.ratingAvg !== null ? (
                      <span>
                        <span className="text-pv-orange-500">★</span>{' '}
                        {r.ratingAvg.toFixed(1)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                    {r.ratingCount}
                  </td>
                  <td className="px-5 py-3">
                    <StatoChip stato={r.stato} />
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

function StatoChip({
  stato,
}: {
  stato: 'attiva-rankata' | 'attiva-nonrank' | 'sospesa';
}) {
  const map: Record<typeof stato, { label: string; cls: string }> = {
    'attiva-rankata': { label: 'Attiva · rankata', cls: 'bg-pv-green-50 text-pv-green-500' },
    'attiva-nonrank': {
      label: 'Attiva · non rankata',
      cls: 'bg-pv-slate-100 text-pv-slate-700',
    },
    sospesa: { label: 'Sospesa', cls: 'bg-pv-red-50 text-pv-red-500' },
  };
  const s = map[stato];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
