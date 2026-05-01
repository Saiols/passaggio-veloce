import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Button, StatusChip, type PraticaStato } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { acceptAndRedirect, rejectAndRedirect } from './actions';

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/inbox">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">L&apos;inbox è disponibile solo per le agenzie.</p>
        </div>
      </AppShell>
    );
  }

  const agenziaId = session.user.companyId!;

  const [pending, recenti] = await Promise.all([
    prisma.praticaAssegnazione.findMany({
      where: { agenziaId, esito: 'PENDING' },
      orderBy: { invioAt: 'desc' },
      include: {
        pratica: {
          include: {
            broker: { select: { ragioneSociale: true, citta: true } },
          },
        },
      },
    }),
    prisma.praticaAssegnazione.findMany({
      where: { agenziaId, esito: { in: ['RIFIUTATA', 'ASSEGNATA_ALTRO', 'TIMEOUT'] } },
      orderBy: { esitoAt: 'desc' },
      take: 10,
      include: {
        pratica: {
          include: {
            broker: { select: { ragioneSociale: true } },
          },
        },
      },
    }),
  ]);

  return (
    <AppShell session={session} activePath="/inbox">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Inbox agenzia
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Pratiche da gestire
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {pending.length} pratic{pending.length === 1 ? 'a' : 'he'} in attesa della tua decisione
          </p>
        </header>

        <section className="mb-8 overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <header className="border-b border-pv-slate-200 bg-pv-slate-50 px-5 py-3">
            <h2 className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-700">
              In arrivo · da decidere
            </h2>
          </header>
          {pending.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica in arrivo al momento.</p>
            </div>
          ) : (
            <ul className="divide-y divide-pv-slate-200">
              {pending.map((a) => {
                const acceptBound = acceptAndRedirect.bind(null, a.praticaId);
                const rejectBound = rejectAndRedirect.bind(null, a.praticaId);
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-pv-slate-50 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <Link
                      href={`/inbox/${a.praticaId}`}
                      className="min-w-0 flex-1"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-pv-navy-800">
                          {a.pratica.codicePratica ?? '—'}
                        </span>
                        <StatusChip stato={a.pratica.stato as PraticaStato} />
                        <span className="text-[11px] text-pv-slate-500">
                          {formatRelative(a.invioAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-[14px] font-semibold text-pv-slate-900">
                        {a.pratica.targa ?? '—'} · {a.pratica.proprietarioAttuale ?? '—'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-pv-slate-500">
                        da <span className="font-semibold">{a.pratica.broker.ragioneSociale}</span>
                        {' · '}
                        {a.pratica.comune ?? '—'}
                        {a.pratica.provincia ? ` (${a.pratica.provincia})` : ''}
                      </p>
                    </Link>
                    <div className="flex gap-2 sm:shrink-0">
                      <form action={acceptBound}>
                        <Button type="submit" size="sm">
                          Accetta
                        </Button>
                      </form>
                      <form action={rejectBound}>
                        <Button type="submit" size="sm" variant="secondary">
                          Rifiuta
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {recenti.length > 0 && (
          <section className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
            <header className="border-b border-pv-slate-200 bg-pv-slate-50 px-5 py-3">
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-700">
                Storico decisioni recenti
              </h2>
            </header>
            <ul className="divide-y divide-pv-slate-200 text-[13px]">
              {recenti.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between px-5 py-3 text-pv-slate-700"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-pv-navy-800">
                      {a.pratica.codicePratica ?? '—'} · {a.pratica.targa ?? '—'}
                    </p>
                    <p className="text-[11px] text-pv-slate-500">
                      {a.pratica.broker.ragioneSociale}
                    </p>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                      {labelEsito(a.esito)}
                    </span>
                    <span className="text-[11px] text-pv-slate-500">
                      {formatRelative(a.esitoAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function labelEsito(e: string): string {
  if (e === 'ACCETTATA') return 'Accettata';
  if (e === 'RIFIUTATA') return 'Rifiutata';
  if (e === 'TIMEOUT') return 'Scaduta';
  if (e === 'ASSEGNATA_ALTRO') return 'Ad altra';
  return e.toLowerCase();
}
