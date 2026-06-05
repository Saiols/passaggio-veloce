import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatDate, formatRelative } from '@/lib/format';

type SearchParams = {
  agenzia?: string;
  pratica?: string;
  periodo?: '7d' | '30d' | '12m' | 'all';
  minImporto?: string;
  maxImporto?: string;
};

const PERIODI: { value: SearchParams['periodo']; label: string }[] = [
  { value: 'all', label: 'Tutti' },
  { value: '7d', label: '7 giorni' },
  { value: '30d', label: '30 giorni' },
  { value: '12m', label: '12 mesi' },
];

function startDate(p: SearchParams['periodo']): Date | null {
  const d = new Date();
  if (p === '7d') {
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (p === '30d') {
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (p === '12m') {
    d.setMonth(d.getMonth() - 12);
    return d;
  }
  return null;
}

export default async function AdminAffiliazioniPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/affiliazioni">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione affiliazioni è riservata all&apos;Admin piattaforma.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const periodo = (sp.periodo ?? 'all') as NonNullable<SearchParams['periodo']>;
  const minImporto = sp.minImporto ? Number(sp.minImporto) : null;
  const maxImporto = sp.maxImporto ? Number(sp.maxImporto) : null;
  const since = startDate(periodo);

  const where: Prisma.CommissioneAffiliazioneWhereInput = {};
  if (since) where.createdAt = { gte: since };
  if (sp.agenzia) where.referenteId = sp.agenzia;
  if (sp.pratica) where.praticaId = sp.pratica;
  if (minImporto !== null && Number.isFinite(minImporto)) {
    where.importoNettoCent = {
      ...(where.importoNettoCent as object),
      gte: Math.round(minImporto * 100),
    };
  }
  if (maxImporto !== null && Number.isFinite(maxImporto)) {
    where.importoNettoCent = {
      ...(where.importoNettoCent as object),
      lte: Math.round(maxImporto * 100),
    };
  }

  const [
    commissioni,
    aggregateStats,
    referralCompanies,
    clickCount,
    registrazioniDaReferral,
    primaPraticaCount,
  ] = await Promise.all([
    prisma.commissioneAffiliazione.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        pratica: {
          select: {
            id: true,
            codicePratica: true,
            veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
            broker: { select: { id: true, ragioneSociale: true, deletedAt: true } },
            agenziaAssegnata: {
              select: { id: true, ragioneSociale: true, deletedAt: true },
            },
          },
        },
        referente: {
          select: { id: true, ragioneSociale: true, type: true, deletedAt: true },
        },
      },
    }),
    prisma.commissioneAffiliazione.aggregate({
      where: { ...where, stato: 'ACCREDITATA' },
      _sum: { importoNettoCent: true },
      _count: { _all: true },
    }),
    prisma.company.findMany({
      where: { referenteId: { not: null }, deletedAt: null },
      select: { id: true, ragioneSociale: true, type: true },
      orderBy: { ragioneSociale: 'asc' },
    }),
    prisma.referralClick.count({}),
    prisma.company.count({ where: { referenteId: { not: null } } }),
    // pratiche firmate da referrals (cioe' da company che hanno un referente)
    prisma.pratica.count({
      where: {
        stato: 'FIRMATA',
        OR: [
          { broker: { referenteId: { not: null } } },
          { agenziaAssegnata: { referenteId: { not: null } } },
        ],
      },
    }),
  ]);

  const totaleCent = aggregateStats._sum.importoNettoCent ?? 0;
  const numCommissioni = aggregateStats._count._all;

  // Per filtro agenzia: lista referenti distinti delle commissioni esistenti
  // (limita la dropdown a chi ha realmente partecipato).
  const referentiDistinti = await prisma.commissioneAffiliazione.findMany({
    distinct: ['referenteId'],
    select: {
      referenteId: true,
      referente: { select: { ragioneSociale: true } },
    },
  });

  // AF-AC: count commissioni DA_REVISIONARE per il banner anti-collusione.
  // Resilience: se lo schema prod non è ancora migrato (enum mancante), il
  // banner non viene mostrato e la dashboard resta navigabile.
  let sospetteCount = 0;
  try {
    sospetteCount = await prisma.commissioneAffiliazione.count({
      where: { stato: 'DA_REVISIONARE' },
    });
  } catch {
    sospetteCount = 0;
  }

  const exportParams = new URLSearchParams();
  if (sp.periodo) exportParams.set('periodo', sp.periodo);
  if (sp.agenzia) exportParams.set('agenzia', sp.agenzia);
  if (sp.pratica) exportParams.set('pratica', sp.pratica);
  if (sp.minImporto) exportParams.set('minImporto', sp.minImporto);
  if (sp.maxImporto) exportParams.set('maxImporto', sp.maxImporto);
  const exportHref = `/api/admin/affiliazioni/export${
    exportParams.toString() ? `?${exportParams.toString()}` : ''
  }`;

  // Conversion rate: registrazioni / click
  const conversionRate =
    clickCount > 0
      ? ((registrazioniDaReferral / clickCount) * 100).toFixed(1)
      : '—';
  const firstPraticaRate =
    registrazioniDaReferral > 0
      ? ((primaPraticaCount / registrazioniDaReferral) * 100).toFixed(1)
      : '—';

  return (
    <AppShell session={session} activePath="/admin/affiliazioni">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Admin · affiliazioni
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Programma affiliazione
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Visione completa del flusso referral: click, conversioni,
              commissioni accreditate, drill-down per agenzia/pratica.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sospetteCount > 0 && (
              <Link
                href="/admin/affiliazioni/sospette"
                className="rounded-[10px] border-[1.5px] border-pv-amber-500/50 bg-pv-amber-50 px-4 py-2 text-[13px] font-semibold text-pv-amber-500 hover:bg-pv-amber-100"
              >
                ⚠ {sospetteCount} sospett{sospetteCount === 1 ? 'a' : 'e'} da revisionare
              </Link>
            )}
            <a
              href={exportHref}
              className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
            >
              Esporta CSV
            </a>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Click totali" value={clickCount} accent="slate" />
          <StatCard
            label="Registrazioni da ref"
            value={registrazioniDaReferral}
            hint={`${conversionRate}% click→reg`}
            accent="navy"
          />
          <StatCard
            label="Pratiche da ref"
            value={primaPraticaCount}
            hint={`${firstPraticaRate}% reg→pratica`}
            accent="orange"
          />
          <StatCard
            label="Commissioni"
            value={numCommissioni}
            accent="green"
          />
          <StatCard
            label="Totale accreditato"
            value={formatCurrencyCent(totaleCent)}
            accent="green"
          />
        </div>

        <Card className="mb-5">
          <h2 className="text-[15px] font-bold text-pv-navy-800">Filtri</h2>
          <form className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select
              name="periodo"
              defaultValue={periodo}
              className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            >
              {PERIODI.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              name="agenzia"
              defaultValue={sp.agenzia ?? ''}
              className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            >
              <option value="">Tutti i referenti</option>
              {referentiDistinti
                .filter((r) => r.referente)
                .map((r) => (
                  <option key={r.referenteId} value={r.referenteId}>
                    {r.referente!.ragioneSociale}
                  </option>
                ))}
            </select>
            <input
              type="text"
              name="pratica"
              placeholder="ID pratica"
              defaultValue={sp.pratica ?? ''}
              className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
            <input
              type="number"
              name="minImporto"
              placeholder="Min €"
              defaultValue={sp.minImporto ?? ''}
              min={0}
              className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
            <div className="flex gap-2">
              <input
                type="number"
                name="maxImporto"
                placeholder="Max €"
                defaultValue={sp.maxImporto ?? ''}
                min={0}
                className="flex-1 rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
              />
              <button
                type="submit"
                className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
              >
                Applica
              </button>
            </div>
          </form>
        </Card>

        <Card className="mb-5">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Affiliazioni attive ({referralCompanies.length})
          </h2>
          {referralCompanies.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Nessuna company associata a un referente.
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-pv-slate-500">
              Aziende che hanno un referente attivo.{' '}
              <Link
                href="/admin/broker"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                Apri lista broker
              </Link>{' '}
              o{' '}
              <Link
                href="/admin/agenzie"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                lista agenzie
              </Link>{' '}
              per drill-in dettaglio.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Commissioni ({commissioni.length}
            {commissioni.length === 200 ? '+' : ''})
          </h2>
          {commissioni.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Nessuna commissione con i filtri correnti.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <tr>
                    <th className="py-2">Quando</th>
                    <th className="py-2">Pratica</th>
                    <th className="py-2">Referente</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">Stato</th>
                    <th className="py-2 text-right">Importo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pv-slate-100">
                  {commissioni.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 text-pv-slate-700">
                        {formatRelative(c.createdAt)}
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/pratiche/${c.pratica.id}`}
                          className="font-mono font-semibold text-pv-navy-700 hover:underline"
                        >
                          {c.pratica.codicePratica ?? '—'}
                        </Link>
                        {c.pratica.veicoli[0]?.targa && (
                          <span className="ml-2 text-[11px] text-pv-slate-500">
                            {c.pratica.veicoli[0].targa}
                            {c.pratica.veicoli.length > 1
                              ? ` +${c.pratica.veicoli.length - 1}`
                              : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/admin/companies/${c.referente.id}`}
                          className="font-semibold text-pv-navy-800 hover:underline"
                        >
                          {c.referente.deletedAt
                            ? '(account eliminato)'
                            : c.referente.ragioneSociale}
                        </Link>
                        <p className="text-[11px] text-pv-slate-500">
                          {c.referente.type === 'DEALER' ? 'Broker' : 'Agenzia'}
                          {' · su '}
                          {c.tipo === 'REFERENTE_BROKER'
                            ? c.pratica.broker.ragioneSociale
                            : c.pratica.agenziaAssegnata?.ragioneSociale ??
                              '—'}
                        </p>
                      </td>
                      <td className="py-2 text-pv-slate-700">
                        {c.tipo === 'REFERENTE_BROKER' ? 'Broker' : 'Agenzia'}
                      </td>
                      <td className="py-2">
                        <span
                          className={
                            c.stato === 'ACCREDITATA'
                              ? 'inline-flex rounded-full bg-pv-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-green-500'
                              : c.stato === 'ANNULLATA'
                                ? 'inline-flex rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500'
                                : 'inline-flex rounded-full bg-pv-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-slate-700'
                          }
                        >
                          {c.stato}
                        </span>
                      </td>
                      <td className="py-2 text-right font-semibold text-pv-navy-900">
                        {formatCurrencyCent(c.importoNettoCent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="mt-6 text-[11px] text-pv-slate-500">
          Aggiornato {formatDate(new Date())}. Drill-down completo per ogni
          commissione: aprila dalla colonna Pratica per vedere il flusso
          firma → split commissione → wallet del referente.
        </p>
      </div>
    </AppShell>
  );
}
