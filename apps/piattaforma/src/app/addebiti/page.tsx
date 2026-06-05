import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { computeGiorniResidui, countdownLevel, type CountdownLevel } from '@/lib/pratiche/countdown';
import { groupFeeByMonth, type FeeRow } from '@/lib/fee/recap';

export const dynamic = 'force-dynamic';

const LEVEL_BADGE: Record<CountdownLevel, string> = {
  none: 'bg-pv-slate-100 text-pv-slate-500',
  ok: 'bg-pv-green-50 text-pv-green-500',
  warn: 'bg-pv-amber-50 text-pv-amber-500',
  urgent: 'bg-pv-amber-50 text-pv-orange-500',
  overdue: 'bg-pv-red-50 text-pv-red-500',
};

function statoLabel(s: string): string {
  switch (s) {
    case 'SCHEDULED': return 'Programmato';
    case 'IN_LAVORAZIONE': return 'In lavorazione';
    case 'SUCCESS': return 'Addebitato';
    case 'FAILED': return 'Fallito';
    case 'RETRY': return 'Nuovo tentativo';
    case 'ANNULLATO': return 'Annullato';
    default: return s;
  }
}

type StoricoRow = FeeRow & {
  id: string;
  praticaId: string | null;
  codice: string | null;
  targa: string | null;
  scheduledAt: Date | null;
  executedAt: Date | null;
};

export default async function AddebitiPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/addebiti">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">La sezione addebiti è disponibile per le agenzie.</Alert>
        </div>
      </AppShell>
    );
  }
  const companyId = session.user.companyId!;
  const now = new Date();

  const fees = await prisma.feeAddebito.findMany({
    where: { agenziaId: companyId },
    orderBy: { createdAt: 'desc' },
    include: {
      pratica: {
        select: {
          id: true,
          codicePratica: true,
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
        },
      },
    },
  });

  const upcoming = fees
    .filter((f) => f.stato === 'SCHEDULED' && f.scheduledAt)
    .map((f) => ({ fee: f, giorni: computeGiorniResidui(f.scheduledAt, now) }))
    .sort((a, b) => (a.giorni ?? 0) - (b.giorni ?? 0));

  const rows: StoricoRow[] = fees.map((f) => {
    const veicoli = f.pratica?.veicoli ?? [];
    const targa0 = veicoli[0]?.targa ?? null;
    const targa = targa0 && veicoli.length > 1 ? `${targa0} +${veicoli.length - 1}` : targa0;
    return {
      id: f.id,
      praticaId: f.pratica?.id ?? null,
      importoCent: f.importoCent,
      stato: f.stato,
      refDate: f.scheduledAt ?? f.createdAt,
      codice: f.pratica?.codicePratica ?? null,
      targa,
      scheduledAt: f.scheduledAt,
      executedAt: f.executedAt,
    };
  });
  const groups = groupFeeByMonth(rows);

  const totaleAnno = rows
    .filter((r) => r.refDate.getUTCFullYear() === now.getUTCFullYear())
    .reduce((s, r) => s + r.importoCent, 0);
  const totaleSchedulato = upcoming.reduce((s, u) => s + u.fee.importoCent, 0);

  return (
    <AppShell session={session} activePath="/addebiti">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Area finanziaria
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Addebiti
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Le fee delle pratiche gestite e gli auto-addebiti programmati al giorno 20.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Programmati" value={String(upcoming.length)} hint="In attesa di addebito" accent="orange" />
          <StatCard label="Totale programmato" value={formatCurrencyCent(totaleSchedulato)} accent="navy" />
          <StatCard label={`Totale ${now.getUTCFullYear()}`} value={formatCurrencyCent(totaleAnno)} accent="green" />
        </div>

        {upcoming.length > 0 && (
          <Card className="mb-5">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Prossimi addebiti</h2>
            <ul className="mt-3 divide-y divide-pv-slate-200 text-[13px]">
              {upcoming.map(({ fee, giorni }) => {
                const level = countdownLevel(giorni);
                return (
                  <li key={fee.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <Link href={`/pratiche/${fee.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                        {fee.pratica?.codicePratica ?? '—'}
                      </Link>
                      <p className="text-[11px] text-pv-slate-500">
                        Addebito previsto {formatDate(fee.scheduledAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-pv-navy-800">{formatCurrencyCent(fee.importoCent)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LEVEL_BADGE[level]}`}>
                        {giorni === null ? '—' : giorni < 0 ? `scaduto ${-giorni}g` : `${giorni}g`}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">Storico per mese</h2>
          {groups.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">Nessun addebito registrato.</p>
          ) : (
            <div className="mt-3 space-y-5">
              {groups.map((g) => (
                <div key={g.month}>
                  <div className="flex items-center justify-between border-b border-pv-slate-200 pb-1.5">
                    <p className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-500">{g.month}</p>
                    <p className="text-[13px] font-bold text-pv-navy-800">{formatCurrencyCent(g.totaleCent)}</p>
                  </div>
                  <ul className="divide-y divide-pv-slate-100 text-[13px]">
                    {g.rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          {r.praticaId ? (
                            <Link href={`/pratiche/${r.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                              {r.codice ?? '—'}
                            </Link>
                          ) : (
                            <span className="font-mono font-semibold text-pv-navy-800">{r.codice ?? '—'}</span>
                          )}
                          {r.targa ? <span className="ml-2 text-[12px] text-pv-slate-500">{r.targa}</span> : null}
                          <p className="text-[11px] text-pv-slate-500">
                            {statoLabel(r.stato)} · {formatDate(r.executedAt ?? r.scheduledAt)}
                          </p>
                        </div>
                        <span className="font-semibold text-pv-navy-800">{formatCurrencyCent(r.importoCent)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
