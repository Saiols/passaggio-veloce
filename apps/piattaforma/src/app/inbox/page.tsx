import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { assertPermesso, hasPermesso } from '@/lib/auth/permessi/guard';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatusChip, SubmitButton, TipoPraticaChip, type PraticaStato } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { acceptAndRedirect, rejectAndRedirect } from './actions';
import { redirectSeAgenziaBloccata } from '@/lib/fee/gate';
import { STORICO_ESITI, storicoCutoff, labelEsito } from './storico';
import { VisuraBanner } from '@/components/visura-banner';

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  await assertPermesso('inbox.view');

  await redirectSeAgenziaBloccata();

  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/inbox">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">L&apos;inbox è disponibile solo per le agenzie.</p>
        </div>
      </AppShell>
    );
  }

  // Quick-action: i pulsanti Accetta/Rifiuta compaiono solo con inbox.gestisci.
  const canGestisci = await hasPermesso('inbox.gestisci');

  // Multi-sede: inbox scoped alle sedi accessibili (sede corrente o tutte, owner).
  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];

  const [pending, recenti] = await Promise.all([
    prisma.praticaAssegnazione.findMany({
      where: { sedeId: { in: scopeIds }, esito: 'PENDING' },
      orderBy: { invioAt: 'desc' },
      include: {
        pratica: {
          include: {
            broker: { select: { ragioneSociale: true, citta: true } },
            veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, proprietarioAttuale: true } },
          },
        },
      },
    }),
    prisma.praticaAssegnazione.findMany({
      // Storico decisioni: accettate + rifiutate/non vinte degli ultimi 7 giorni.
      where: {
        sedeId: { in: scopeIds },
        esito: { in: [...STORICO_ESITI] },
        esitoAt: { gte: storicoCutoff(new Date()) },
      },
      orderBy: { esitoAt: 'desc' },
      take: 50,
      include: {
        pratica: {
          include: {
            broker: { select: { ragioneSociale: true } },
            veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
          },
        },
      },
    }),
  ]);

  return (
    <AppShell session={session} activePath="/inbox">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        {session.user.companyId && (
          <div className="mb-6">
            <VisuraBanner companyId={session.user.companyId} companyType="AGENZIA" />
          </div>
        )}
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
                        <StatusChip
                          stato={a.pratica.stato as PraticaStato}
                          viewerRole="AGENZIA"
                        />
                        <TipoPraticaChip tipo={a.pratica.tipo} numeroVeicoli={a.pratica.numeroVeicoli} />
                        <span className="text-[11px] text-pv-slate-500">
                          {formatRelative(a.invioAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-[14px] font-semibold text-pv-slate-900">
                        {a.pratica.veicoli[0]?.targa
                          ? a.pratica.veicoli.length > 1
                            ? `${a.pratica.veicoli[0].targa} +${a.pratica.veicoli.length - 1}`
                            : a.pratica.veicoli[0].targa
                          : '—'}{' '}
                        · {a.pratica.veicoli[0]?.proprietarioAttuale ?? '—'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-pv-slate-500">
                        da <span className="font-semibold">{a.pratica.broker.ragioneSociale}</span>
                        {' · '}
                        {a.pratica.comune ?? '—'}
                        {a.pratica.provincia ? ` (${a.pratica.provincia})` : ''}
                      </p>
                    </Link>
                    {canGestisci && (
                      <div className="flex gap-2 sm:shrink-0">
                        <form action={acceptBound}>
                          <SubmitButton size="sm" loadingLabel="Conferma…">
                            Accetta
                          </SubmitButton>
                        </form>
                        <form action={rejectBound}>
                          <SubmitButton size="sm" variant="secondary" loadingLabel="Rifiuto…">
                            Rifiuta
                          </SubmitButton>
                        </form>
                      </div>
                    )}
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
                    <TipoPraticaChip tipo={a.pratica.tipo} numeroVeicoli={a.pratica.numeroVeicoli} className="mb-1" />
                    <p className="truncate font-semibold text-pv-navy-800">
                      {a.pratica.codicePratica ?? '—'} ·{' '}
                      {a.pratica.veicoli[0]?.targa
                        ? a.pratica.veicoli.length > 1
                          ? `${a.pratica.veicoli[0].targa} +${a.pratica.veicoli.length - 1}`
                          : a.pratica.veicoli[0].targa
                        : '—'}
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
