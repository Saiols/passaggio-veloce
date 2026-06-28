import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getOperatingSede } from '@/lib/auth/session-context';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { PayoutButton } from './payout-button';
import { formatCurrencyCent, formatDateTime } from '@/lib/format';
import { WALLET } from '@/lib/wallet/config';
import { getRendimento, type RendimentoPeriod } from './rendimento';
import { RendimentoChart } from './rendimento-chart';
import { PayoutThresholdForm } from './payout-threshold-form';
import { RendicontoCard } from './rendiconto-card';

const THRESHOLD_PAYOUT_MIN_CENT = WALLET.MIN_PAYOUT_CENT;

const PERIOD_OPTIONS: { value: RendimentoPeriod; label: string }[] = [
  { value: '7d', label: '7 giorni' },
  { value: '30d', label: '30 giorni' },
  { value: '12m', label: '12 mesi' },
  { value: 'ytd', label: 'Anno corrente' },
];

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ rendimento?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (
    session.user.companyType !== 'DEALER' &&
    session.user.companyType !== 'AGENZIA'
  ) {
    return (
      <AppShell session={session} activePath="/wallet">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Il wallet è disponibile per broker e agenzie.
          </Alert>
        </div>
      </AppShell>
    );
  }

  // Multi-sede: il wallet operativo è quello della sede corrente.
  const sede = await getOperatingSede();
  if (!sede) {
    return (
      <AppShell session={session} activePath="/wallet">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Seleziona una sede dal menù in alto per vederne il wallet.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const [wallet, sedeRow] = await Promise.all([
    prisma.wallet.findUnique({
      where: { sedeId: sede.id },
      include: {
        transazioni: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            pratica: {
              select: {
                id: true,
                codicePratica: true,
                veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
              },
            },
          },
        },
        payouts: {
          orderBy: { richiestoAt: 'desc' },
          take: 10,
        },
      },
    }),
    prisma.sede.findUnique({
      where: { id: sede.id },
      select: { payoutThresholdCent: true },
    }),
  ]);

  const saldoCent = wallet?.saldoCent ?? 0;
  const thresholdAutoCent =
    sedeRow?.payoutThresholdCent ?? WALLET.AUTO_PAYOUT_DEFAULT_CENT;

  const statusPayout =
    saldoCent >= thresholdAutoCent
      ? 'auto'
      : saldoCent >= THRESHOLD_PAYOUT_MIN_CENT
        ? 'manual'
        : 'below';

  // Sistema Penali Broker — SP-C: il wallet può andare in negativo se sono
  // state addebitate penali superiori al saldo. In tal caso mostriamo banner
  // dedicato che invita a reintegrare per sbloccare i payout.
  const saldoNegativo = saldoCent < 0;

  // Rendimento periodo (item 03 release 2026-05). Default 30d.
  const rendimentoPeriod: RendimentoPeriod = PERIOD_OPTIONS.some(
    (o) => o.value === sp.rendimento,
  )
    ? (sp.rendimento as RendimentoPeriod)
    : '30d';
  const rendimento = await getRendimento(wallet?.id ?? null, rendimentoPeriod, [
    'CREDITO_PRATICA',
    'CREDITO_AFFILIAZIONE',
  ]);
  const isAdminAzienda = session.user.role === 'ADMIN_AZIENDA';

  return (
    <AppShell session={session} activePath="/wallet">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Area finanziaria
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Wallet
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Accrediti maturati dalle pratiche firmate. Payout automatico al raggiungimento di{' '}
            {formatCurrencyCent(thresholdAutoCent)}.
          </p>
        </header>

        {saldoNegativo && (
          <div className="mb-6">
            <Alert variant="warning" title="Saldo wallet negativo">
              Il tuo saldo è sotto zero a causa di una o più penali addebitate.
              I payout sono bloccati finché il saldo non torna positivo. Le
              pratiche successive accumuleranno credito normalmente fino al
              riallineamento.
            </Alert>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Saldo disponibile"
            value={formatCurrencyCent(saldoCent)}
            accent="navy"
          />
          <StatCard
            label="Soglia payout auto"
            value={formatCurrencyCent(thresholdAutoCent)}
            hint={
              statusPayout === 'auto'
                ? 'Superata — payout automatico al prossimo ciclo'
                : `Mancano ${formatCurrencyCent(
                    thresholdAutoCent - saldoCent,
                  )}`
            }
            accent={statusPayout === 'auto' ? 'green' : 'slate'}
          />
          <StatCard
            label="Rendimento periodo"
            value={formatCurrencyCent(rendimento.totalCent)}
            hint={`${rendimento.count} movimenti · ${PERIOD_OPTIONS.find((o) => o.value === rendimentoPeriod)?.label}`}
            accent="green"
          />
        </div>

        <Card className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-pv-navy-800">
                Rendimento
              </h2>
              <p className="mt-1 text-[12.5px] text-pv-slate-500">
                Crediti pratiche + commissioni affiliazione, aggregati per
                periodo.
              </p>
            </div>
            <form className="flex shrink-0 gap-1">
              {PERIOD_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="submit"
                  name="rendimento"
                  value={o.value}
                  className={`rounded-[8px] border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    o.value === rendimentoPeriod
                      ? 'border-pv-navy-700 bg-pv-navy-700 text-white'
                      : 'border-pv-slate-300 bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </form>
          </div>
          <RendimentoChart buckets={rendimento.buckets} accent="navy" />
        </Card>

        <div className="mb-5 rounded-2xl border border-pv-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-pv-navy-900">Payout</h2>
          <p className="mt-1 text-sm text-pv-slate-500">
            Richiesta manuale da {formatCurrencyCent(WALLET.MIN_PAYOUT_CENT)} ·
            Soglia automatica {formatCurrencyCent(thresholdAutoCent)}
          </p>
          <div className="mt-4">
            <PayoutButton disabled={saldoCent < WALLET.MIN_PAYOUT_CENT} />
          </div>
          {saldoNegativo && (
            <p className="mt-2 text-xs font-semibold text-pv-amber-500">
              ⚠️ Saldo negativo: reintegra prima di poter richiedere payout.
            </p>
          )}
          {!saldoNegativo && saldoCent >= thresholdAutoCent && (
            <p className="mt-2 text-xs text-pv-slate-500">
              🎯 Sei sopra la soglia automatica. In DEMO il payout si attiva via Demo Control.
            </p>
          )}
          {isAdminAzienda && (
            <div className="mt-5 border-t border-pv-slate-200 pt-4">
              <h3 className="text-[13px] font-bold text-pv-navy-800">
                Soglia payout automatico
              </h3>
              <p className="mt-1 text-[12px] text-pv-slate-500">
                Configurabile tra {formatCurrencyCent(WALLET.AUTO_PAYOUT_MIN_CENT)} e{' '}
                {formatCurrencyCent(WALLET.AUTO_PAYOUT_MAX_CENT)}.
              </p>
              <div className="mt-3">
                <PayoutThresholdForm
                  defaultValueCent={thresholdAutoCent}
                  minCent={WALLET.AUTO_PAYOUT_MIN_CENT}
                  maxCent={WALLET.AUTO_PAYOUT_MAX_CENT}
                />
              </div>
            </div>
          )}
        </div>

        <div className="mb-5">
          <RendicontoCard minYear={2026} />
        </div>

        <Card className="mb-5">
          <h2 className="text-[15px] font-bold text-pv-navy-800">Movimenti</h2>
          {wallet?.transazioni.length ? (
            <ul className="mt-3 divide-y divide-pv-slate-200 text-[13px]">
              {wallet.transazioni.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-pv-navy-800">
                      {labelTipoTx(t.tipo)}
                      {t.pratica?.codicePratica && (
                        <span className="ml-2 font-mono text-[12px] font-normal text-pv-slate-500">
                          <Link
                            href={`/pratiche/${t.pratica.id}`}
                            className="font-semibold text-pv-navy-600 hover:underline"
                          >
                            {t.pratica.codicePratica}
                          </Link>
                          {t.pratica.veicoli[0]?.targa
                            ? ` · ${t.pratica.veicoli[0].targa}${
                                t.pratica.veicoli.length > 1
                                  ? ` +${t.pratica.veicoli.length - 1}`
                                  : ''
                              }`
                            : ''}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-pv-slate-500">
                      {formatDateTime(t.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-bold ${
                        t.importoCent >= 0 ? 'text-pv-green-500' : 'text-pv-red-500'
                      }`}
                    >
                      {t.importoCent >= 0 ? '+' : ''}
                      {formatCurrencyCent(t.importoCent)}
                    </p>
                    <p className="text-[11px] text-pv-slate-500">
                      saldo {formatCurrencyCent(t.saldoPostCent)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Nessun movimento ancora. Il primo credito arriverà alla firma della tua prima
              pratica.
            </p>
          )}
        </Card>

        {wallet?.payouts.length ? (
          <Card>
            <h2 className="text-[15px] font-bold text-pv-navy-800">Payout</h2>
            <ul className="mt-3 divide-y divide-pv-slate-200 text-[13px]">
              {wallet.payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-semibold text-pv-navy-800">
                      {formatCurrencyCent(p.importoCent)}
                      {p.automatico && (
                        <span className="ml-2 rounded-full bg-pv-navy-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-navy-700">
                          auto
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-pv-slate-500">
                      {formatDateTime(p.richiestoAt)}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    {p.stato.toLowerCase().replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}

function labelTipoTx(t: string): string {
  if (t === 'CREDITO_PRATICA') return 'Credito pratica firmata';
  if (t === 'CREDITO_AFFILIAZIONE') return 'Commissione affiliazione';
  if (t === 'PAYOUT_AUTOMATICO') return 'Payout automatico';
  if (t === 'PAYOUT_MANUALE') return 'Payout manuale';
  if (t === 'RETTIFICA_ADMIN') return 'Rettifica admin';
  if (t === 'STORNO') return 'Storno';
  if (t === 'PENALE_BROKER') return 'Penale segnalazione';
  return t;
}
