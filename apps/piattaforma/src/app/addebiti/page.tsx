import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { groupFeeByMonth, type FeeRow } from '@/lib/fee/recap';

export const dynamic = 'force-dynamic';

function statoLabel(s: string): string {
  switch (s) {
    case 'SCHEDULED': return 'In coda';
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

  const rowsAnno = rows.filter((r) => r.refDate.getUTCFullYear() === now.getUTCFullYear());
  const totaleAnno = rowsAnno.reduce((s, r) => s + r.importoCent, 0);
  const countAnno = rowsAnno.length;
  const totaleMese = rowsAnno
    .filter((r) => r.refDate.getUTCMonth() === now.getUTCMonth())
    .reduce((s, r) => s + r.importoCent, 0);

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
            Le fee delle pratiche gestite, addebitate automaticamente alla firma.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label={`Addebiti ${now.getUTCFullYear()}`} value={String(countAnno)} hint="Pratiche addebitate" accent="navy" />
          <StatCard label={`Totale ${now.getUTCFullYear()}`} value={formatCurrencyCent(totaleAnno)} accent="green" />
          <StatCard label="Questo mese" value={formatCurrencyCent(totaleMese)} accent="orange" />
        </div>

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
