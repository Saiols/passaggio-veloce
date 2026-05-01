import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { canViewAggregatedFinancials } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatRelative } from '@/lib/format';

type Periodo = 'settimana' | 'mese' | 'anno';
type TipoFiltro = '' | 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';

type SearchParams = { periodo?: Periodo; tipo?: TipoFiltro };

function startOfPeriodo(p: Periodo): Date {
  const d = new Date();
  if (p === 'settimana') d.setDate(d.getDate() - 7);
  else if (p === 'mese') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

function periodoLabel(p: Periodo): string {
  if (p === 'settimana') return 'Ultima settimana';
  if (p === 'mese') return 'Ultimo mese';
  return 'Ultimo anno';
}

const STATI_DISTRIBUZIONE = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
] as const;

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewAggregatedFinancials(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/dashboard">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La dashboard finanziaria aggregata è riservata all&apos;Admin
            piattaforma. L&apos;Assistente vede pratiche, anagrafiche e
            wallet ma non le metriche aggregate.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const periodo: Periodo = sp.periodo ?? 'mese';
  const tipo: TipoFiltro = sp.tipo ?? '';
  const since = startOfPeriodo(periodo);

  const where: Prisma.PraticaWhereInput = {
    deletedAt: null,
    createdAt: { gte: since },
  };
  if (tipo) where.tipo = tipo;

  const [
    totale,
    firmate,
    inDistribuzione,
    inEscalation,
    annullate,
    feeFirmateAgg,
    creditoBrokerAgg,
  ] = await Promise.all([
    prisma.pratica.count({ where }),
    prisma.pratica.count({ where: { ...where, stato: 'FIRMATA' } }),
    prisma.pratica.count({
      where: { ...where, stato: { in: [...STATI_DISTRIBUZIONE] } },
    }),
    prisma.pratica.count({ where: { ...where, stato: 'IN_ESCALATION' } }),
    prisma.pratica.count({ where: { ...where, stato: 'ANNULLATA' } }),
    prisma.pratica.aggregate({
      where: { ...where, stato: 'FIRMATA' },
      _sum: { feeAgenziaCent: true },
    }),
    prisma.pratica.aggregate({
      where: { ...where, stato: 'FIRMATA' },
      _sum: { creditoBrokerCent: true },
    }),
  ]);

  // Income calculation:
  // - feeAgenziaCent = quanto detraiamo all'agenzia per pratica
  // - creditoBrokerCent = quanto va al broker
  // - nostro = feeAgenziaCent - creditoBrokerCent
  const feeTotaleCent = feeFirmateAgg._sum.feeAgenziaCent ?? 0;
  const creditoBrokerTotaleCent = creditoBrokerAgg._sum.creditoBrokerCent ?? 0;
  const nostroLordoCent = feeTotaleCent - creditoBrokerTotaleCent;

  // Top 5 broker per pratiche firmate
  const topBroker = await prisma.pratica.groupBy({
    by: ['brokerId'],
    where: { ...where, stato: 'FIRMATA' },
    _count: { _all: true },
    _sum: { creditoBrokerCent: true },
    orderBy: { _count: { brokerId: 'desc' } },
    take: 5,
  });
  const brokerIds = topBroker.map((t) => t.brokerId);
  const brokerNames = brokerIds.length
    ? await prisma.company.findMany({
        where: { id: { in: brokerIds } },
        select: { id: true, ragioneSociale: true },
      })
    : [];
  const brokerNameById = new Map(brokerNames.map((b) => [b.id, b.ragioneSociale]));

  const exportHref = `/api/admin/dashboard/export?periodo=${periodo}${tipo ? `&tipo=${tipo}` : ''}`;

  return (
    <AppShell session={session} activePath="/admin/dashboard">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Admin · finanziario
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Dashboard
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              {periodoLabel(periodo)}
              {tipo ? ` · solo ${tipo === 'PASSAGGIO_PRIVATO' ? 'Passaggio privato' : 'Minivolture multiple'}` : ' · tutti i tipi'}
            </p>
          </div>
          <a
            href={exportHref}
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
          >
            Esporta CSV
          </a>
        </header>

        <PeriodoTabs current={periodo} tipo={tipo} />
        <TipoTabs current={tipo} periodo={periodo} />

        <div className="mt-5 mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Totali" value={totale} accent="navy" />
          <StatCard label="Firmate" value={firmate} accent="green" />
          <StatCard label="In distribuzione" value={inDistribuzione} accent="orange" />
          <StatCard label="Escalation" value={inEscalation} accent="red" />
          <StatCard label="Annullate" value={annullate} accent="slate" />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Nostro lordo (firmate)
            </p>
            <p className="mt-2 text-[24px] font-extrabold text-pv-navy-900">
              {formatCurrencyCent(nostroLordoCent)}
            </p>
            <p className="mt-1 text-[11px] text-pv-slate-500">
              fee agenzie {formatCurrencyCent(feeTotaleCent)} − credito broker{' '}
              {formatCurrencyCent(creditoBrokerTotaleCent)}
            </p>
          </Card>
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Fee agenzie (somma)
            </p>
            <p className="mt-2 text-[24px] font-extrabold text-pv-navy-900">
              {formatCurrencyCent(feeTotaleCent)}
            </p>
            <p className="mt-1 text-[11px] text-pv-slate-500">
              addebitate alle agenzie sulle pratiche firmate
            </p>
          </Card>
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Crediti broker (somma)
            </p>
            <p className="mt-2 text-[24px] font-extrabold text-pv-navy-900">
              {formatCurrencyCent(creditoBrokerTotaleCent)}
            </p>
            <p className="mt-1 text-[11px] text-pv-slate-500">
              accreditati ai broker (passaggi privati firmati)
            </p>
          </Card>
        </div>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Top broker per pratiche firmate
          </h2>
          {topBroker.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Nessuna pratica firmata nel periodo selezionato.
            </p>
          ) : (
            <table className="mt-3 w-full text-[13px]">
              <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="py-2">Broker</th>
                  <th className="py-2">Pratiche</th>
                  <th className="py-2 text-right">Credito accreditato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-100">
                {topBroker.map((t) => (
                  <tr key={t.brokerId}>
                    <td className="py-2 font-semibold text-pv-navy-800">
                      {brokerNameById.get(t.brokerId) ?? '—'}
                    </td>
                    <td className="py-2 text-pv-slate-700">{t._count._all}</td>
                    <td className="py-2 text-right text-pv-slate-700">
                      {formatCurrencyCent(t._sum.creditoBrokerCent ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <p className="mt-6 text-[11px] text-pv-slate-500">
          Aggiornato {formatRelative(new Date())}. Le metriche includono solo
          pratiche create nel periodo selezionato. Le commissioni di
          affiliazione (FASE 13) non sono ancora incluse.
        </p>
      </div>
    </AppShell>
  );
}

function PeriodoTabs({ current, tipo }: { current: Periodo; tipo: TipoFiltro }) {
  const periodi: Periodo[] = ['settimana', 'mese', 'anno'];
  return (
    <div className="flex gap-2 border-b border-pv-slate-200">
      {periodi.map((p) => {
        const params = new URLSearchParams({ periodo: p });
        if (tipo) params.set('tipo', tipo);
        const active = p === current;
        return (
          <a
            key={p}
            href={`/admin/dashboard?${params.toString()}`}
            className={
              active
                ? 'border-b-2 border-pv-navy-700 px-3 py-2 text-[13px] font-bold text-pv-navy-700'
                : 'px-3 py-2 text-[13px] font-semibold text-pv-slate-500 hover:text-pv-navy-700'
            }
          >
            {periodoLabel(p)}
          </a>
        );
      })}
    </div>
  );
}

function TipoTabs({ current, periodo }: { current: TipoFiltro; periodo: Periodo }) {
  const opzioni: { value: TipoFiltro; label: string }[] = [
    { value: '', label: 'Tutti i tipi' },
    { value: 'PASSAGGIO_PRIVATO', label: 'Passaggio privato' },
    { value: 'MINIVOLTURE_MULTIPLE', label: 'Minivolture multiple' },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {opzioni.map((o) => {
        const params = new URLSearchParams({ periodo });
        if (o.value) params.set('tipo', o.value);
        const active = o.value === current;
        return (
          <a
            key={o.value || 'all'}
            href={`/admin/dashboard?${params.toString()}`}
            className={
              active
                ? 'rounded-full bg-pv-navy-700 px-3 py-1 text-[12px] font-semibold text-white'
                : 'rounded-full border border-pv-slate-300 px-3 py-1 text-[12px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50'
            }
          >
            {o.label}
          </a>
        );
      })}
    </div>
  );
}
