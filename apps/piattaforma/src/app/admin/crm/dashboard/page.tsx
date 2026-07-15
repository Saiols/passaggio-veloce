import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import {
  canViewCrmDashboard,
  canViewCrmFinancials,
} from '@/lib/auth/permissions';
import { formatCurrencyCent } from '@/lib/format';
import { RendimentoChart } from '../../../wallet/rendimento-chart';
import { getPlatformRegistrationStats } from '@/lib/crm/platform-stats';

const STATI_ORDER = [
  'S0',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
  'S10',
] as const;

const STATI_LABEL: Record<string, string> = {
  S0: 'Non contattato',
  S1: 'Non risponde',
  S2: 'Non interessato',
  S3: 'Interessato',
  S4: 'Link non aperto',
  S5: 'Link aperto',
  S6: 'Iscrizione iniziata',
  S7: 'Iscritto inattivo',
  S8: 'Prima pratica',
  S9: 'Ricorrente',
  S10: 'Churned',
};

const MONTH_LABELS = [
  'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
];

export default async function AdminCrmDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrmDashboard(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/dashboard">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La dashboard CRM è riservata a Admin / AD / CTO / Sales Manager.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const showFinancials = canViewCrmFinancials(session.user.role);

  // ─── Aggregazioni base contatti CRM ────────────────────────────────
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [
    totaleContatti,
    iscrittiAttivi,
    inConversione,
    linkAperti,
    salesAgentCount,
    campagneAttive,
    contactsByStato,
    contactsByStatoCat,
    contactsLast6m,
    platformStats,
  ] = await Promise.all([
    prisma.crmContact.count({ where: { deletedAt: null } }),
    prisma.crmContact.count({
      where: { deletedAt: null, status: { in: ['S8', 'S9'] } },
    }),
    prisma.crmContact.count({
      where: { deletedAt: null, status: { in: ['S3', 'S5', 'S6'] } },
    }),
    prisma.crmContact.count({
      where: { deletedAt: null, linkAperto: true },
    }),
    prisma.crmSalesAgent.count({ where: { deletedAt: null } }),
    prisma.crmCampaign.count({
      where: { deletedAt: null, status: 'ATTIVA' },
    }),
    prisma.crmContact.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.crmContact.groupBy({
      by: ['status', 'cat'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.crmContact.findMany({
      where: { deletedAt: null, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
    getPlatformRegistrationStats(),
  ]);

  // ─── Bucket contatti per mese (ultimi 6) ───────────────────────────
  const buckets: { label: string; importoCent: number }[] = [];
  const cursor = new Date(sixMonthsAgo);
  const now = new Date();
  while (
    cursor.getFullYear() < now.getFullYear() ||
    (cursor.getFullYear() === now.getFullYear() &&
      cursor.getMonth() <= now.getMonth())
  ) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const count = contactsLast6m.filter(
      (c) => c.createdAt.getFullYear() === y && c.createdAt.getMonth() === m,
    ).length;
    // RendimentoChart accetta `importoCent` come numero generico:
    // qui rappresenta il count di contatti nel mese.
    buckets.push({ label: MONTH_LABELS[m] ?? String(m), importoCent: count });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // ─── Distribuzione per stato (ordinata S0..S10) ────────────────────
  const distribuzione = STATI_ORDER.map((s) => {
    const item = contactsByStato.find((c) => c.status === s);
    const count = item?._count._all ?? 0;
    const pct = totaleContatti > 0 ? (count / totaleContatti) * 100 : 0;
    return { stato: s, label: STATI_LABEL[s] ?? s, count, pct };
  });

  // ─── Raggiungimento obiettivo per categoria (contattati / iscritti) ────
  const obiettivo = (cat: 'BROKER' | 'AGENZIA') => {
    const rows = contactsByStatoCat.filter((r) => r.cat === cat);
    const tot = rows.reduce((a, r) => a + r._count._all, 0);
    const nonContattati = rows
      .filter((r) => r.status === 'S0')
      .reduce((a, r) => a + r._count._all, 0);
    const iscritti = rows
      .filter((r) => r.status === 'S7' || r.status === 'S8' || r.status === 'S9')
      .reduce((a, r) => a + r._count._all, 0);
    return { tot, contattati: tot - nonContattati, iscritti };
  };
  const obBroker = obiettivo('BROKER');
  const obAgenzie = obiettivo('AGENZIA');

  // ─── Sezione Dati Economici (gated) ────────────────────────────────
  let financials: {
    revenueCent: number;
    praticheCount: number;
    walletAggregateCent: number;
    revenuePerPraticaCent: number;
  } | null = null;

  if (showFinancials) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [feeAgg, brokerAgg, praticheCount, walletsAgg] = await Promise.all([
      prisma.pratica.aggregate({
        where: {
          deletedAt: null,
          stato: 'FIRMATA',
          createdAt: { gte: startOfMonth },
        },
        _sum: { feeAgenziaCent: true },
      }),
      prisma.pratica.aggregate({
        where: {
          deletedAt: null,
          stato: 'FIRMATA',
          createdAt: { gte: startOfMonth },
        },
        _sum: { creditoBrokerCent: true },
      }),
      prisma.pratica.count({
        where: {
          deletedAt: null,
          stato: 'FIRMATA',
          createdAt: { gte: startOfMonth },
        },
      }),
      prisma.wallet.aggregate({
        where: {
          company: {
            deletedAt: null,
            suspendedAt: null,
            type: 'DEALER',
          },
        },
        _sum: { saldoCent: true },
      }),
    ]);
    const revenueCent =
      (feeAgg._sum.feeAgenziaCent ?? 0) -
      (brokerAgg._sum.creditoBrokerCent ?? 0);
    financials = {
      revenueCent,
      praticheCount,
      walletAggregateCent: walletsAgg._sum?.saldoCent ?? 0,
      revenuePerPraticaCent:
        praticheCount > 0 ? Math.round(revenueCent / praticheCount) : 0,
    };
  }

  return (
    <AppShell session={session} activePath="/admin/crm/dashboard">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Dashboard
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Stato del funnel lead → iscritto. Aggiornato in tempo reale.
          </p>
        </header>

        {/* Stat cards */}
        <section className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Totale contatti" value={totaleContatti} icon="👥" />
          <StatCard
            label="Iscritti attivi"
            value={iscrittiAttivi}
            hint="S8 + S9"
            icon="✅"
            tone="green"
          />
          <StatCard
            label="In conversione"
            value={inConversione}
            hint="S3 + S5 + S6"
            icon="🎯"
            tone="orange"
          />
          <StatCard
            label="Link aperti"
            value={linkAperti}
            hint="Click tracking"
            icon="🔗"
          />
          <StatCard
            label="Sales agent"
            value={salesAgentCount}
            hint="Configurati"
            icon="🤖"
          />
          <StatCard
            label="Campagne attive"
            value={campagneAttive}
            hint="Status ATTIVA"
            icon="📣"
            tone="green"
          />
        </section>

        {/* Registrati sulla piattaforma — dato informativo, NON metriche funnel */}
        <section className="mt-6 rounded-[12px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
          <h2 className="text-[14px] font-bold text-pv-navy-900">
            Registrati sulla piattaforma
          </h2>
          <p className="text-[11.5px] text-pv-slate-500">
            Dato informativo — non incide sulle metriche di conversione del funnel.
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <RegistratiBlock
              titolo="Broker"
              d={platformStats.broker}
              dot="bg-blue-500"
              bar="bg-blue-500"
            />
            <RegistratiBlock
              titolo="Agenzie"
              d={platformStats.agenzia}
              dot="bg-pv-orange-500"
              bar="bg-pv-orange-500"
            />
          </div>
        </section>

        {/* Raggiungimento obiettivo (contattati / iscritti per categoria) */}
        <section className="mt-6 rounded-[12px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
          <h2 className="text-[14px] font-bold text-pv-navy-900">Raggiungimento obiettivo</h2>
          <p className="text-[11.5px] text-pv-slate-500">
            Quota di broker e agenzie contattati e iscritti sul totale dei lead.
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {[
              { titolo: 'Broker', m: obBroker, dot: 'bg-blue-500', bar: 'bg-blue-500' },
              { titolo: 'Agenzie', m: obAgenzie, dot: 'bg-pv-orange-500', bar: 'bg-pv-orange-500' },
            ].map(({ titolo, m, dot, bar }) => (
              <div key={titolo}>
                <p className="flex items-center gap-2 text-[12.5px] font-bold text-pv-navy-900">
                  <span className={'h-2 w-2 rounded-full ' + dot} />
                  {titolo}
                  <span className="ml-auto text-[11.5px] font-normal text-pv-slate-500">
                    {m.tot.toLocaleString('it-IT')} lead
                  </span>
                </p>
                <div className="mt-3 space-y-3">
                  <ObiettivoBar label="Contattati" value={m.contattati} tot={m.tot} barClass={bar} />
                  <ObiettivoBar label="Iscritti" value={m.iscritti} tot={m.tot} barClass={bar} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2 grafici affiancati */}
        <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-[12px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
            <h2 className="text-[14px] font-bold text-pv-navy-900">
              Contatti per mese
            </h2>
            <p className="text-[11.5px] text-pv-slate-500">
              Ultimi 6 mesi · count nuovi lead acquisiti
            </p>
            <RendimentoChart
              buckets={buckets}
              accent="navy"
              formatValue={(n) => `${n} contatt${n === 1 ? 'o' : 'i'}`}
            />
          </div>

          <div className="rounded-[12px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
            <h2 className="text-[14px] font-bold text-pv-navy-900">
              Distribuzione per stato
            </h2>
            <p className="text-[11.5px] text-pv-slate-500">
              Funnel S0 → S10 con percentuale sul totale
            </p>
            <div className="mt-4 space-y-2">
              {distribuzione.map((d) => (
                <div key={d.stato}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[12px] text-pv-navy-900">
                      <span className="font-bold">{d.stato}</span>
                      <span className="ml-2 text-pv-slate-500">{d.label}</span>
                    </p>
                    <p className="shrink-0 text-[11.5px] text-pv-slate-500">
                      {d.count} ·{' '}
                      <span className="font-semibold text-pv-navy-900">
                        {d.pct.toFixed(1)}%
                      </span>
                    </p>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-pv-slate-100">
                    <div
                      className="h-full bg-pv-navy-700 transition-all"
                      style={{ width: `${Math.min(d.pct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Sezione Dati Economici (gated) */}
        {financials && (
          <section className="mt-6 rounded-[12px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-[14px] font-bold text-pv-navy-900">
                Dati economici
              </h2>
              <span className="rounded-full bg-pv-orange-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-orange-500">
                Riservato
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FinanceCard
                label="Revenue mese"
                value={formatCurrencyCent(financials.revenueCent)}
                hint="Lordo PV (fee − credito broker)"
              />
              <FinanceCard
                label="Pratiche mese"
                value={String(financials.praticheCount)}
                hint="Stato FIRMATA"
              />
              <FinanceCard
                label="Wallet broker"
                value={formatCurrencyCent(financials.walletAggregateCent)}
                hint="Saldo aggregato broker attivi"
              />
              <FinanceCard
                label="Revenue / pratica"
                value={formatCurrencyCent(financials.revenuePerPraticaCent)}
                hint="Media del mese"
              />
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: string;
  tone?: 'green' | 'orange';
}) {
  const tint =
    tone === 'green'
      ? 'border-pv-green-500/30 bg-pv-green-50/30'
      : tone === 'orange'
        ? 'border-pv-orange-500/30 bg-pv-orange-50/30'
        : 'border-pv-slate-200 bg-white';
  return (
    <div
      className={
        'rounded-[12px] border-[1.5px] px-4 py-3 shadow-[var(--pv-shadow-card)] ' +
        tint
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-pv-slate-500">
          {label}
        </p>
        {icon && <span className="text-[16px]">{icon}</span>}
      </div>
      <p className="mt-1 text-[24px] font-extrabold tracking-tight text-pv-navy-900">
        {value.toLocaleString('it-IT')}
      </p>
      {hint && <p className="text-[10.5px] text-pv-slate-500">{hint}</p>}
    </div>
  );
}

function FinanceCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[10px] bg-pv-slate-50 px-4 py-3">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-extrabold tracking-tight text-pv-navy-900">
        {value}
      </p>
      {hint && <p className="text-[10.5px] text-pv-slate-500">{hint}</p>}
    </div>
  );
}

function RegistratiBlock({
  titolo,
  d,
  dot,
  bar,
}: {
  titolo: string;
  d: { tot: number; daLista: number; organici: number };
  dot: string;
  bar: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[12.5px] font-bold text-pv-navy-900">
        <span className={'h-2 w-2 rounded-full ' + dot} />
        {titolo}
        <span className="ml-auto text-[18px] font-extrabold tracking-tight text-pv-navy-900">
          {d.tot.toLocaleString('it-IT')}
        </span>
      </p>
      <div className="mt-3 space-y-3">
        <ObiettivoBar label="Da lista CRM" value={d.daLista} tot={d.tot} barClass={bar} />
        <ObiettivoBar
          label="Organici / passaparola"
          value={d.organici}
          tot={d.tot}
          barClass={bar}
        />
      </div>
    </div>
  );
}

function ObiettivoBar({
  label,
  value,
  tot,
  barClass,
}: {
  label: string;
  value: number;
  tot: number;
  barClass: string;
}) {
  const pct = tot > 0 ? (value / tot) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-pv-slate-600">{label}</span>
        <span className="shrink-0 text-pv-slate-500">
          {value.toLocaleString('it-IT')}/{tot.toLocaleString('it-IT')} ·{' '}
          <span className="font-bold text-pv-navy-900">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-pv-slate-100">
        <div
          className={'h-full transition-all ' + barClass}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
