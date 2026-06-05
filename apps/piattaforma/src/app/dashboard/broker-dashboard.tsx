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
  const [byStato, ultime, wallet, daValutare] = await Promise.all([
    prisma.pratica.groupBy({
      by: ['stato'],
      where: { brokerId: companyId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.pratica.findMany({
      where: { brokerId: companyId, deletedAt: null },
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 5,
      include: {
        agenziaAssegnata: { select: { ragioneSociale: true, citta: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, proprietarioAttuale: true } },
      },
    }),
    prisma.wallet.findUnique({ where: { companyId } }),
    // A7 banner valuta post-firma: pratiche FIRMATA del broker per cui
    // non esiste ancora una Valutazione, ordinate dalla più recente.
    prisma.pratica.findMany({
      where: {
        brokerId: companyId,
        deletedAt: null,
        stato: 'FIRMATA',
        valutazione: null,
      },
      orderBy: { firmaAvvenutaAt: 'desc' },
      take: 5,
      select: {
        id: true,
        codicePratica: true,
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
        firmaAvvenutaAt: true,
        agenziaAssegnata: { select: { ragioneSociale: true } },
      },
    }),
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

      {daValutare.length > 0 && (
        <div className="mb-6 rounded-[16px] border-[1.5px] border-pv-orange-500/40 bg-pv-orange-50/40 p-5 shadow-[var(--pv-shadow-card)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
                ⭐ Da valutare
              </p>
              <h2 className="mt-1 text-[18px] font-bold text-pv-navy-900">
                {daValutare.length === 1
                  ? '1 pratica firmata in attesa della tua valutazione'
                  : `${daValutare.length} pratiche firmate in attesa della tua valutazione`}
              </h2>
              <p className="mt-1 text-[12.5px] text-pv-slate-700">
                La tua valutazione conta: aiuta gli altri dealer a scegliere le agenzie migliori e fa contare il tuo feedback nel ranking.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {daValutare.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-1 rounded-[10px] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-pv-navy-900">
                    {p.codicePratica ?? p.id.slice(0, 8)}
                    {p.veicoli[0]?.targa && (
                      <span className="ml-2 text-pv-slate-500">
                        ({p.veicoli[0].targa}
                        {p.veicoli.length > 1 ? ` +${p.veicoli.length - 1}` : ''})
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-pv-slate-500">
                    Agenzia: {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                    {p.firmaAvvenutaAt && ` · firmata ${formatRelative(p.firmaAvvenutaAt)}`}
                  </p>
                </div>
                <Link
                  href={`/pratiche/${p.id}`}
                  className="shrink-0 rounded-[10px] bg-pv-orange-500 px-3 py-1.5 text-[12px] font-bold text-white hover:brightness-95"
                >
                  Valuta ora →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                      <StatusChip stato={p.stato as PraticaStato} viewerRole="BROKER" />
                    </div>
                    <p className="mt-1 truncate text-[13px] text-pv-slate-700">
                      {p.veicoli[0]?.targa && (
                        <span className="font-semibold">
                          {p.veicoli[0].targa}
                          {p.veicoli.length > 1 ? ` +${p.veicoli.length - 1}` : ''}
                        </span>
                      )}
                      {p.veicoli[0]?.targa && ' · '}
                      {p.veicoli[0]?.proprietarioAttuale ?? '—'}
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
