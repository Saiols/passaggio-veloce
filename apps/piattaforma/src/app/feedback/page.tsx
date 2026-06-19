import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { Stars } from './stars';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/feedback">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">
            I feedback sono disponibili solo per le agenzie.
          </p>
        </div>
      </AppShell>
    );
  }

  const agenziaId = session.user.companyId!;

  const [valutazioni, agg] = await Promise.all([
    prisma.valutazione.findMany({
      where: { agenziaId },
      orderBy: { createdAt: 'desc' },
      include: {
        dealer: { select: { ragioneSociale: true } },
        pratica: { select: { id: true, codicePratica: true } },
      },
    }),
    prisma.valutazione.aggregate({
      where: { agenziaId },
      _avg: { stelle: true },
      _count: { _all: true },
    }),
  ]);

  const count = agg._count._all;
  const media = agg._avg.stelle;

  return (
    <AppShell session={session} activePath="/feedback">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Agenzia
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Feedback ricevuti
          </h1>
          {count > 0 && media !== null && (
            <p className="mt-1 text-[14px] text-pv-slate-500">
              Media <span className="font-bold text-pv-navy-800">{media.toFixed(1)} ★</span> ·{' '}
              {count} feedback ricevut{count === 1 ? 'o' : 'i'}
            </p>
          )}
        </header>

        {valutazioni.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[14px] text-pv-slate-500">
              Nessun feedback ricevuto ancora.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {valutazioni.map((v) => (
              <li key={v.id}>
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <Stars n={v.stelle} />
                    <span className="text-[12px] text-pv-slate-500">
                      {formatRelative(v.createdAt)}
                    </span>
                  </div>
                  {v.note && (
                    <p className="mt-2 text-[13.5px] text-pv-slate-700">
                      &ldquo;{v.note}&rdquo;
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-pv-slate-500">
                    <span className="font-semibold text-pv-navy-700">
                      {v.dealer.ragioneSociale}
                    </span>
                    <span>·</span>
                    <Link
                      href={`/pratiche/${v.pratica.id}`}
                      className="font-mono font-semibold text-pv-navy-600 hover:underline"
                    >
                      {v.pratica.codicePratica ?? '—'}
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
