import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { PayoutButton } from './payout-button';
import { formatCurrencyCent, formatDateTime } from '@/lib/format';

const THRESHOLD_PAYOUT_AUTO_CENT = 100_000; // 1.000 €
const THRESHOLD_PAYOUT_MIN_CENT = 50_000; // 500 €

export default async function WalletPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (session.user.companyType !== 'DEALER') {
    return (
      <AppShell session={session} activePath="/wallet">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">Il wallet è disponibile solo per i broker.</Alert>
        </div>
      </AppShell>
    );
  }

  const companyId = session.user.companyId!;

  const wallet = await prisma.wallet.findUnique({
    where: { companyId },
    include: {
      transazioni: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          pratica: { select: { codicePratica: true, targa: true } },
        },
      },
      payouts: {
        orderBy: { richiestoAt: 'desc' },
        take: 10,
      },
    },
  });

  const saldoCent = wallet?.saldoCent ?? 0;

  const statusPayout =
    saldoCent >= THRESHOLD_PAYOUT_AUTO_CENT
      ? 'auto'
      : saldoCent >= THRESHOLD_PAYOUT_MIN_CENT
        ? 'manual'
        : 'below';

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
            {formatCurrencyCent(THRESHOLD_PAYOUT_AUTO_CENT)}.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Saldo disponibile"
            value={formatCurrencyCent(saldoCent)}
            accent="navy"
          />
          <StatCard
            label="Soglia payout auto"
            value={formatCurrencyCent(THRESHOLD_PAYOUT_AUTO_CENT)}
            hint={
              statusPayout === 'auto'
                ? 'Superata — payout automatico al prossimo ciclo'
                : `Mancano ${formatCurrencyCent(
                    THRESHOLD_PAYOUT_AUTO_CENT - saldoCent,
                  )}`
            }
            accent={statusPayout === 'auto' ? 'green' : 'slate'}
          />
          <StatCard
            label="Movimenti"
            value={wallet?.transazioni.length ?? 0}
            hint="Ultimi 20 mostrati"
            accent="slate"
          />
        </div>

        <div className="mb-5 rounded-2xl border border-pv-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-pv-navy-900">Payout</h2>
          <p className="mt-1 text-sm text-pv-slate-500">
            Soglia minima 500€ · Soglia auto 1.000€
          </p>
          <div className="mt-4">
            <PayoutButton disabled={saldoCent < 50_000} />
          </div>
          {saldoCent >= 100_000 && (
            <p className="mt-2 text-xs text-pv-slate-500">
              🎯 Sei sopra la soglia automatica. In DEMO il payout si attiva via Demo Control.
            </p>
          )}
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
                          {t.pratica.codicePratica}
                          {t.pratica.targa ? ` · ${t.pratica.targa}` : ''}
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
  if (t === 'PAYOUT_AUTOMATICO') return 'Payout automatico';
  if (t === 'PAYOUT_MANUALE') return 'Payout manuale';
  if (t === 'RETTIFICA_ADMIN') return 'Rettifica admin';
  if (t === 'STORNO') return 'Storno';
  return t;
}
