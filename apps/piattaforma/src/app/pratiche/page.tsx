import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Button, StatusChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';
import { PraticheFilters } from './filters';
import { QuickActionButton } from './quick-action-button';

const PAGE_SIZE = 15;

// Filtri stato per la lista pratiche broker/agenzia (item 10 release 2026-05).
// Niente R1/R2/R3 ne "Escalation": questi dettagli sono interni al motore di
// distribuzione e non devono apparire all'utente. Lato admin la lista
// completa rimane in /admin/pratiche.
const STATI_USER: { value: string; label: string }[] = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'BOZZA', label: 'Bozza' },
  { value: 'IN_ATTESA', label: 'In attesa' },
  { value: 'ACCETTATA', label: 'Accettata' },
  { value: 'PROCESSATA', label: 'Processata' },
  { value: 'FIRMATA', label: 'Firmata' },
  { value: 'SCADUTA', label: 'Scaduta' },
  { value: 'ANNULLATA', label: 'Annullata' },
];

// Mappatura del valore aggregato "IN_ATTESA" sui valori reali del DB.
const STATI_IN_ATTESA = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
  'IN_ESCALATION',
] as const;

const PERIODI = [
  { value: '', label: 'Qualsiasi periodo' },
  { value: '7d', label: 'Ultimi 7 giorni' },
  { value: '30d', label: 'Ultimi 30 giorni' },
  { value: '90d', label: 'Ultimi 90 giorni' },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

type SearchParams = {
  stato?: string;
  q?: string;
  periodo?: string;
  page?: string;
};

export default async function PratichePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const sp = await searchParams;
  const companyType = session.user.companyType;
  const companyId = session.user.companyId;

  if (!companyId) {
    return (
      <AppShell session={session} activePath="/pratiche">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">Account non associato a un&apos;azienda.</p>
        </div>
      </AppShell>
    );
  }

  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where: Prisma.PraticaWhereInput = {
    deletedAt: null,
  };

  if (companyType === 'AGENZIA') {
    where.agenziaAssegnataId = companyId;
  } else {
    where.brokerId = companyId;
  }

  if (sp.stato && STATI_USER.some((s) => s.value === sp.stato)) {
    if (sp.stato === 'IN_ATTESA') {
      where.stato = { in: STATI_IN_ATTESA as unknown as PraticaStato[] };
    } else {
      where.stato = sp.stato as PraticaStato;
    }
  }

  if (sp.periodo === '7d') where.submittedAt = { gte: daysAgo(7) };
  else if (sp.periodo === '30d') where.submittedAt = { gte: daysAgo(30) };
  else if (sp.periodo === '90d') where.submittedAt = { gte: daysAgo(90) };

  const q = sp.q?.trim();
  if (q) {
    where.OR = [
      { codicePratica: { contains: q, mode: 'insensitive' } },
      { veicoli: { some: { targa: { contains: q, mode: 'insensitive' } } } },
      { veicoli: { some: { proprietarioAttuale: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.pratica.findMany({
      where,
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip,
      take: PAGE_SIZE,
      include: {
        agenziaAssegnata: { select: { ragioneSociale: true, citta: true } },
        broker: { select: { ragioneSociale: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, proprietarioAttuale: true } },
      },
    }),
    prisma.pratica.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell session={session} activePath="/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              {companyType === 'AGENZIA' ? 'Pratiche assegnate' : 'Le tue pratiche'}
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Pratiche
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              {total} risultat{total === 1 ? 'o' : 'i'}
              {sp.stato || sp.periodo || q ? ' · filtri attivi' : ''}
            </p>
          </div>
          {companyType !== 'AGENZIA' && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Bundle ZIP di tutti i documenti delle pratiche del broker,
                  una cartella per codice pratica. */}
              <a
                href="/api/pratiche/documenti-zip"
                download
                className="inline-flex items-center gap-2 rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-[18px] py-3 text-sm font-bold text-pv-navy-700 transition-colors hover:bg-pv-slate-50"
              >
                Scarica documenti (ZIP)
              </a>
              <Link href="/pratiche/nuova">
                <Button size="md">+ Nuova pratica</Button>
              </Link>
            </div>
          )}
        </header>

        <PraticheFilters
          q={q}
          stato={sp.stato}
          periodo={sp.periodo}
          stati={STATI_USER}
          periodi={PERIODI}
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {items.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica trovata.</p>
              {companyType !== 'AGENZIA' && (
                <Link href="/pratiche/nuova" className="mt-3 inline-block">
                  <Button size="sm">Crea la prima</Button>
                </Link>
              )}
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="px-5 py-3">Codice</th>
                  <th className="px-5 py-3">Targa</th>
                  <th className="px-5 py-3 hidden sm:table-cell">Proprietario</th>
                  <th className="px-5 py-3 hidden md:table-cell">
                    {companyType === 'AGENZIA' ? 'Broker' : 'Agenzia'}
                  </th>
                  <th className="px-5 py-3">Stato</th>
                  <th className="px-5 py-3 hidden lg:table-cell">Fee</th>
                  <th className="px-5 py-3 text-right">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-200">
                {items.map((p) => (
                  <tr
                    key={p.id}
                    className="relative cursor-pointer transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50"
                  >
                    <td className="px-5 py-3 font-mono font-semibold text-pv-navy-800">
                      <Link
                        href={`/pratiche/${p.id}`}
                        className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
                      >
                        <span className="sr-only">
                          Apri pratica {p.codicePratica ?? 'in bozza'}
                        </span>
                      </Link>
                      <span>{p.codicePratica ?? 'BOZZA'}</span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-pv-slate-900">
                      <span>
                        {p.veicoli[0]?.targa
                          ? p.veicoli.length > 1
                            ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                            : p.veicoli[0].targa
                          : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                      <span>{p.veicoli[0]?.proprietarioAttuale ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                      <span>
                        {companyType === 'AGENZIA'
                          ? p.broker.ragioneSociale
                          : p.agenziaAssegnata?.ragioneSociale ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-2">
                        <StatusChip
                          stato={p.stato as PraticaStato}
                          viewerRole={companyType === 'AGENZIA' ? 'AGENZIA' : 'BROKER'}
                        />
                        {companyType === 'AGENZIA' &&
                          p.agenziaAssegnataId === companyId &&
                          p.stato === 'ACCETTATA' && (
                            <QuickActionButton
                              praticaId={p.id}
                              action="processata"
                            />
                          )}
                        {companyType === 'AGENZIA' &&
                          p.agenziaAssegnataId === companyId &&
                          p.stato === 'PROCESSATA' && (
                            <QuickActionButton
                              praticaId={p.id}
                              action="firma"
                            />
                          )}
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 lg:table-cell">
                      <span>
                        {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-pv-slate-500">
                      <span>
                        {formatRelative(p.submittedAt ?? p.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <Pagination current={page} total={totalPages} sp={sp} />
        )}
      </div>
    </AppShell>
  );
}

function Pagination({
  current,
  total,
  sp,
}: {
  current: number;
  total: number;
  sp: SearchParams;
}) {
  const makeHref = (p: number): string => {
    const params = new URLSearchParams();
    if (sp.stato) params.set('stato', sp.stato);
    if (sp.q) params.set('q', sp.q);
    if (sp.periodo) params.set('periodo', sp.periodo);
    if (p > 1) params.set('page', String(p));
    const s = params.toString();
    return s ? `/pratiche?${s}` : '/pratiche';
  };

  return (
    <nav className="mt-5 flex items-center justify-between">
      <p className="text-[12px] text-pv-slate-500">
        Pagina {current} di {total}
      </p>
      <div className="flex gap-2">
        {current > 1 && (
          <Link
            href={makeHref(current - 1)}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            ← Indietro
          </Link>
        )}
        {current < total && (
          <Link
            href={makeHref(current + 1)}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            Avanti →
          </Link>
        )}
      </div>
    </nav>
  );
}
