import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, StatCard } from '@/components/ui';
import { RANKING } from '@/lib/distribuzione';
import { TextSearchFilter } from '@/components/text-search-filter';
import { SuspendButton } from '../suspend-button';
import { ReactivateSedeButton } from '../reactivate-sede-button';

type SearchParams = { q?: string };

export default async function AdminAgenziePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const q = sp.q?.trim();

  const where: Prisma.CompanyWhereInput = { type: 'AGENZIA', deletedAt: null };
  if (q) {
    where.OR = [
      { ragioneSociale: { contains: q, mode: 'insensitive' } },
      { citta: { contains: q, mode: 'insensitive' } },
      { provincia: { contains: q, mode: 'insensitive' } },
    ];
  }

  const agenzie = await prisma.company.findMany({
    where,
    orderBy: { ragioneSociale: 'asc' },
    include: {
      sedi: {
        where: { deletedAt: null },
        select: { id: true, nome: true, suspendedAt: true, suspensionOrigin: true },
      },
    },
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
    stato: 'attiva-rankata' | 'attiva-nonrank' | 'rating-basso';
  };
  const rows: Row[] = agenzie.map((a) => {
    const r = byId.get(a.id);
    const ratingAvg = r?.avg ?? null;
    const ratingCount = r?.count ?? 0;
    const ranked = ratingCount >= RANKING.MIN_RATINGS_FOR_RANK;
    // Rating basso = solo segnalazione visiva per l'admin (nessuna sospensione).
    const ratingBasso = ranked && (ratingAvg ?? 0) < RANKING.LOW_RATING_THRESHOLD;
    return {
      ...a,
      ratingAvg,
      ratingCount,
      stato: ratingBasso ? 'rating-basso' : ranked ? 'attiva-rankata' : 'attiva-nonrank',
    };
  });

  // Ordine: rating basso in cima (così l'admin le nota subito e può contattarle),
  // poi rankate desc, poi non rankate.
  rows.sort((a, b) => {
    if (a.stato === 'rating-basso' && b.stato !== 'rating-basso') return -1;
    if (b.stato === 'rating-basso' && a.stato !== 'rating-basso') return 1;
    if (a.stato === 'attiva-rankata' && b.stato === 'attiva-rankata') {
      return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
    }
    if (a.stato === 'attiva-rankata') return -1;
    if (b.stato === 'attiva-rankata') return 1;
    return a.ragioneSociale.localeCompare(b.ragioneSociale);
  });

  const ratingBasse = rows.filter((r) => r.stato === 'rating-basso');
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
            Rating medio sotto {RANKING.LOW_RATING_THRESHOLD} = agenzia evidenziata
            (qualità da attenzionare). Nessuna sospensione automatica.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Totali" value={rows.length} accent="navy" />
          <StatCard label="Rankate" value={rankate.length} accent="green" />
          <StatCard
            label="Non rankate"
            value={rows.length - rankate.length - ratingBasse.length}
            hint="< 5 valutazioni"
            accent="slate"
          />
          <StatCard label="Rating basso" value={ratingBasse.length} accent="red" />
        </div>

        {ratingBasse.length > 0 && (
          <div className="mb-5">
            <Alert variant="warning" title={`${ratingBasse.length} agenzie con rating basso`}>
              Rating medio sotto {RANKING.LOW_RATING_THRESHOLD}: nessun effetto
              automatico (restano nella distribuzione), ma conviene contattarle per
              capire e migliorare il servizio — o valutare una sospensione manuale.
            </Alert>
          </div>
        )}

        <TextSearchFilter
          action="/admin/agenzie"
          q={q}
          placeholder="Cerca per ragione sociale, città o provincia…"
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <table className="w-full text-[13px]">
            <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="px-5 py-3">Agenzia</th>
                <th className="px-5 py-3 hidden sm:table-cell">Provincia</th>
                <th className="px-5 py-3">Rating</th>
                <th className="px-5 py-3 hidden sm:table-cell">Valutazioni</th>
                <th className="px-5 py-3">Stato</th>
                <th className="px-5 py-3 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-200">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`transition-colors hover:bg-pv-slate-50 ${
                    r.stato === 'rating-basso' ? 'bg-pv-red-50/40' : ''
                  }`}
                >
                  <td
                    className={`px-5 py-3 font-semibold text-pv-navy-800 ${
                      r.stato === 'rating-basso' ? 'border-l-4 border-pv-red-500' : ''
                    }`}
                  >
                    <Link
                      href={`/admin/companies/${r.id}`}
                      className="hover:underline"
                    >
                      {r.ragioneSociale}
                    </Link>
                    {r.suspendedAt && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500">
                        Sospesa admin
                      </span>
                    )}
                    <p className="text-[11px] font-normal text-pv-slate-500">
                      {r.citta}
                    </p>
                    {r.sedi
                      .filter((s) => s.suspendedAt !== null && s.suspensionOrigin === 'ANTI_ABUSO')
                      .map((s) => (
                        <div
                          key={s.id}
                          className="mt-1.5 flex flex-wrap items-center gap-2"
                        >
                          <span className="inline-flex items-center rounded-full bg-pv-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-orange-500">
                            Sede sospesa · anti-abuso
                          </span>
                          <span className="text-[11px] text-pv-slate-500">{s.nome}</span>
                          <ReactivateSedeButton sedeId={s.id} />
                        </div>
                      ))}
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
                  <td className="px-5 py-3 text-right">
                    <SuspendButton
                      target={{ kind: 'company', id: r.id }}
                      suspended={r.suspendedAt !== null}
                    />
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
  stato: 'attiva-rankata' | 'attiva-nonrank' | 'rating-basso';
}) {
  const map: Record<typeof stato, { label: string; cls: string }> = {
    'attiva-rankata': { label: 'Attiva · rankata', cls: 'bg-pv-green-50 text-pv-green-500' },
    'attiva-nonrank': {
      label: 'Attiva · non rankata',
      cls: 'bg-pv-slate-100 text-pv-slate-700',
    },
    'rating-basso': { label: '⚠ Rating basso', cls: 'bg-pv-red-50 text-pv-red-500' },
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
