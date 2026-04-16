import Link from 'next/link';
import { prisma } from '@pv/db';
import { Button, StatCard, StatusChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';

export async function BrokerDashboard({
  companyId,
  userName,
}: {
  companyId: string;
  userName?: string;
}) {
  const [byStato, ultime, wallet] = await Promise.all([
    prisma.pratica.groupBy({
      by: ['stato'],
      where: { brokerId: companyId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.pratica.findMany({
      where: { brokerId: companyId, deletedAt: null },
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 5,
      include: { agenziaAssegnata: { select: { ragioneSociale: true, citta: true } } },
    }),
    prisma.wallet.findUnique({ where: { companyId } }),
  ]);

  const count = (s: PraticaStato): number =>
    byStato.find((g) => g.stato === s)?._count._all ?? 0;

  const totale =
    count('BOZZA') +
    count('IN_ATTESA_ROUND_1') +
    count('IN_ATTESA_ROUND_2') +
    count('IN_ATTESA_ROUND_3') +
    count('IN_ESCALATION') +
    count('ACCETTATA') +
    count('FIRMATA') +
    count('SCADUTA') +
    count('ANNULLATA');

  const inAttesa =
    count('IN_ATTESA_ROUND_1') +
    count('IN_ATTESA_ROUND_2') +
    count('IN_ATTESA_ROUND_3') +
    count('IN_ESCALATION');

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
      <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Dashboard broker
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Bentornato{userName ? `, ${userName.split(' ')[0]}` : ''}
          </h1>
        </div>
        <Link href="/pratiche/nuova">
          <Button size="md" leadingIcon={<PlusIcon />}>
            Nuova pratica
          </Button>
        </Link>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pratiche totali" value={totale} icon={<DocsIcon />} accent="navy" />
        <StatCard
          label="In attesa"
          value={inAttesa}
          hint="In distribuzione o escalation"
          icon={<ClockIcon />}
          accent="orange"
        />
        <StatCard
          label="Firmate"
          value={count('FIRMATA')}
          hint="Credito maturato"
          icon={<CheckIcon />}
          accent="green"
        />
        <StatCard
          label="Wallet"
          value={formatCurrencyCent(wallet?.saldoCent ?? 0)}
          hint="Saldo disponibile"
          icon={<WalletIcon />}
          accent="navy"
        />
      </div>

      <section className="rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
        <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
          <h2 className="text-[15px] font-bold text-pv-navy-800">Ultime pratiche</h2>
          <Link
            href="/pratiche"
            className="text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
          >
            Vedi tutte →
          </Link>
        </header>
        {ultime.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[14px] text-pv-slate-500">Non hai ancora caricato nessuna pratica.</p>
            <Link href="/pratiche/nuova" className="mt-3 inline-block">
              <Button size="sm">Crea la prima</Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-pv-slate-200">
            {ultime.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pratiche/${p.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-pv-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-pv-navy-800">
                        {p.codicePratica ?? 'BOZZA'}
                      </span>
                      <StatusChip stato={p.stato as PraticaStato} />
                    </div>
                    <p className="mt-1 truncate text-[13px] text-pv-slate-700">
                      {p.targa && <span className="font-semibold">{p.targa}</span>}
                      {p.targa && ' · '}
                      {p.proprietarioAttuale ?? '—'}
                      {p.agenziaAssegnata && (
                        <>
                          {' · '}
                          <span className="text-pv-slate-500">
                            {p.agenziaAssegnata.ragioneSociale}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] text-pv-slate-500">
                      {formatRelative(p.submittedAt ?? p.createdAt)}
                    </p>
                    <p className="text-[12px] font-semibold text-pv-slate-700">
                      {p.comune ?? '—'}
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
function DocsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 12h3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M6 6V5a2 2 0 012-2h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
