import Link from 'next/link';
import { prisma } from '@pv/db';
import { Alert, StatCard, StatusChip, type PraticaStato } from '@/components/ui';
import { formatRelative, formatCurrencyCent } from '@/lib/format';
import { computeGiorniResidui, countdownLevel } from '@/lib/pratiche/countdown';

export async function AgenziaDashboard({ scopeIds }: { scopeIds: string[] }) {
  const [inArrivo, inCorso, firmateMese, rating, assegnazioniRecenti, prossimiAddebiti] = await Promise.all([
    prisma.praticaAssegnazione.count({
      where: { sedeId: { in: scopeIds }, esito: 'PENDING' },
    }),
    prisma.pratica.count({
      where: { agenziaSedeId: { in: scopeIds }, stato: 'ACCETTATA', deletedAt: null },
    }),
    prisma.pratica.count({
      where: {
        agenziaSedeId: { in: scopeIds },
        stato: 'FIRMATA',
        firmaAvvenutaAt: { gte: monthStart() },
      },
    }),
    prisma.valutazione.aggregate({
      where: { agenziaSedeId: { in: scopeIds } },
      _avg: { stelle: true },
      _count: { _all: true },
    }),
    prisma.praticaAssegnazione.findMany({
      where: { sedeId: { in: scopeIds }, esito: 'PENDING' },
      orderBy: { invioAt: 'desc' },
      take: 5,
      include: {
        pratica: {
          include: {
            broker: { select: { ragioneSociale: true, citta: true } },
            veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, proprietarioAttuale: true } },
          },
        },
      },
    }),
    // LISTINI DISABILITATI (feature nascosta 2026-06-12) — riattivare insieme a /profilo/listino:
    // A1: presenza listino per banner "Pubblica il tuo listino"
    // prisma.listino.findFirst({
    //   where: { sedeId: { in: scopeIds } },
    //   select: { id: true, formato: true },
    // }),
    prisma.feeAddebito.findMany({
      where: { agenziaSedeId: { in: scopeIds }, stato: 'SCHEDULED', scheduledAt: { not: null } },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
      include: { pratica: { select: { id: true, codicePratica: true } } },
    }),
  ]);

  const ratingValue = rating._count._all >= 5 && rating._avg.stelle
    ? `${rating._avg.stelle.toFixed(1)} ⭐`
    : '—';
  const ratingHint =
    rating._count._all >= 5
      ? `${rating._count._all} valutazioni`
      : `${rating._count._all}/5 min per attivare ranking`;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
      <header className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Dashboard agenzia
        </p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Pratiche da gestire
        </h1>
      </header>

      {(inArrivo > 0 || inCorso > 0) && (
        <div className="mb-6">
          <Alert variant={inArrivo > 0 ? 'warning' : 'info'} title="Cosa fare ora">
            {inArrivo > 0 && (
              <>
                <strong>{inArrivo}</strong> in attesa di risposta —{' '}
                <Link href="/inbox" className="font-semibold underline">
                  vai all&apos;inbox →
                </Link>
                {inCorso > 0 ? ' · ' : ''}
              </>
            )}
            {inCorso > 0 && (
              <>
                <strong>{inCorso}</strong> accettate da completare —{' '}
                <Link href="/pratiche" className="font-semibold underline">
                  gestisci →
                </Link>
              </>
            )}
          </Alert>
        </div>
      )}

      {/* LISTINI DISABILITATI (feature nascosta 2026-06-12) — banner "Pubblica il tuo listino", riattivare insieme a /profilo/listino:
      {!listino && (
        <div className="mb-6 rounded-[16px] border-[1.5px] border-pv-orange-500/40 bg-pv-orange-50/40 p-5 shadow-[var(--pv-shadow-card)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
                📋 Pubblica il tuo listino
              </p>
              <h2 className="mt-1 text-[18px] font-bold text-pv-navy-900">
                Aiuta l&apos;Osservatorio Prezzi e attira nuovi clienti
              </h2>
              <p className="mt-1 text-[12.5px] text-pv-slate-700">
                Inserisci i prezzi base trapasso/minivoltura e le province coperte:
                comparirai nel benchmark e i broker potranno valutarti meglio. I tuoi
                prezzi sono mostrati solo in forma aggregata.
              </p>
            </div>
            <Link
              href="/profilo/listino"
              className="shrink-0 rounded-[10px] bg-pv-orange-500 px-4 py-2 text-[13px] font-bold text-white hover:brightness-95"
            >
              Pubblica ora →
            </Link>
          </div>
        </div>
      )}
      */}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="In arrivo" value={inArrivo} hint="Da accettare/rifiutare" icon={<InboxIcon />} accent="orange" />
        <StatCard label="Accettate" value={inCorso} hint="In corso di completamento" icon={<PlayIcon />} accent="navy" />
        <StatCard label="Firmate / mese" value={firmateMese} icon={<CheckIcon />} accent="green" />
        <StatCard label="Rating" value={ratingValue} hint={ratingHint} icon={<StarIcon />} accent="navy" href="/feedback" />
      </div>

      {prossimiAddebiti.length > 0 && (
        <section className="mb-6 rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Prossimi addebiti</h2>
            <Link href="/addebiti" className="text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4">
              Vedi tutti →
            </Link>
          </header>
          <ul className="divide-y divide-pv-slate-200">
            {prossimiAddebiti.map((f) => {
              const giorni = computeGiorniResidui(f.scheduledAt, new Date());
              const level = countdownLevel(giorni);
              const badge =
                level === 'overdue' ? 'text-pv-red-500'
                : level === 'urgent' ? 'text-pv-orange-500'
                : level === 'warn' ? 'text-pv-amber-500'
                : 'text-pv-slate-500';
              return (
                <li key={f.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <Link href={`/pratiche/${f.praticaId}`} className="font-mono font-semibold text-pv-navy-800 hover:underline">
                    {f.pratica?.codicePratica ?? '—'}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-pv-navy-800">{formatCurrencyCent(f.importoCent)}</span>
                    <span className={`text-[12px] font-bold ${badge}`}>
                      {giorni === null ? '—' : giorni < 0 ? `scaduto ${-giorni}g` : `tra ${giorni}g`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
        <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
          <h2 className="text-[15px] font-bold text-pv-navy-800">Pratiche in arrivo</h2>
          <Link
            href="/inbox"
            className="text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
          >
            Vai all&apos;Inbox →
          </Link>
        </header>
        {assegnazioniRecenti.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[14px] text-pv-slate-500">Nessuna pratica in arrivo al momento.</p>
          </div>
        ) : (
          <ul className="divide-y divide-pv-slate-200">
            {assegnazioniRecenti.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/inbox/${a.praticaId}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-pv-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-pv-navy-800">
                        {a.pratica.codicePratica ?? '—'}
                      </span>
                      <StatusChip
                        stato={a.pratica.stato as PraticaStato}
                        viewerRole="AGENZIA"
                      />
                    </div>
                    <p className="mt-1 truncate text-[13px] text-pv-slate-700">
                      {a.pratica.veicoli[0]?.targa && (
                        <span className="font-semibold">
                          {a.pratica.veicoli[0].targa}
                          {a.pratica.veicoli.length > 1 ? ` +${a.pratica.veicoli.length - 1}` : ''}
                        </span>
                      )}
                      {a.pratica.veicoli[0]?.targa && ' · '}
                      {a.pratica.veicoli[0]?.proprietarioAttuale ?? '—'}
                      {' · '}
                      <span className="text-pv-slate-500">da {a.pratica.broker.ragioneSociale}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] text-pv-slate-500">{formatRelative(a.invioAt)}</p>
                    <p className="text-[12px] font-semibold text-pv-slate-700">
                      {a.pratica.comune ?? '—'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M4 13V6a2 2 0 012-2h12a2 2 0 012 2v7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M4 13h5l2 3h2l2-3h5v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M10 9l5 3-5 3V9z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5L12 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
