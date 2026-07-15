import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewCrm } from '@/lib/auth/permissions';
import { regioneVarianti } from '@/lib/crm/regione';
import { listPromoCodesValidiAction } from './actions';
import { CrmContactsClient } from './client';

const STATI = [
  'S0',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
  'S10',
] as const;

type SearchParams = {
  q?: string;
  cat?: 'BROKER' | 'AGENZIA' | '';
  status?: (typeof STATI)[number] | '';
  regione?: string;
  assigned?: string;
  sort?: 'recente' | 'nome';
  preset?: 'urgenti' | '';
  page?: string;
};

export default async function AdminCrmPipelinePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrm(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/contatti">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La pipeline lead CRM è riservata al team interno Passaggio Veloce.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;

  // Filtri server-side
  const where: Prisma.CrmContactWhereInput = { deletedAt: null };
  if (sp.q) {
    const q = sp.q.trim();
    where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { citta: { contains: q, mode: 'insensitive' } },
      { tel: { contains: q } },
    ];
  }
  if (sp.cat) where.cat = sp.cat;
  if (sp.preset === 'urgenti') {
    where.status = { in: ['S6', 'S5', 'S4', 'S3'] };
  } else if (sp.status && STATI.includes(sp.status as (typeof STATI)[number])) {
    where.status = sp.status as (typeof STATI)[number];
  }
  // Match tollerante: i dati import hanno regioni in forme diverse (case,
  // trattino/spazio) — vedi lib/crm/regione.
  if (sp.regione) where.regione = { in: regioneVarianti(sp.regione) };
  if (sp.assigned) where.assignedToId = sp.assigned;

  // SALES vede solo i contatti a lui assegnati (decisione 7)
  if (session.user.role === 'SALES') {
    where.assignedToId = session.user.id;
  }

  // Sort
  const sort = sp.sort ?? 'recente';
  const orderBy: Prisma.CrmContactOrderByWithRelationInput[] =
    sort === 'nome'
      ? [{ nome: 'asc' }]
      : [{ lastContactAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];

  const PAGE_SIZE = 25;
  const page = Math.max(1, Number(sp.page) || 1);

  const [pageContacts, total, salesUsers, statsCounts, promoCodes] = await Promise.all([
    prisma.crmContact.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        assignedTo: { select: { id: true, nome: true, cognome: true } },
      },
    }),
    prisma.crmContact.count({ where }),
    prisma.user.findMany({
      where: {
        role: { in: ['SALES_MANAGER', 'SALES'] },
        deletedAt: null,
      },
      select: { id: true, nome: true, cognome: true },
      orderBy: [{ nome: 'asc' }, { cognome: 'asc' }],
    }),
    prisma.crmContact.groupBy({
      by: ['status', 'cat'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    listPromoCodesValidiAction(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Riepilogo per metrica con split broker/agenzia (oltre al totale globale).
  const sumFor = (statuses: readonly string[], cat?: 'BROKER' | 'AGENZIA'): number =>
    statsCounts
      .filter((r) => statuses.includes(r.status) && (!cat || r.cat === cat))
      .reduce((acc, r) => acc + r._count._all, 0);
  const metric = (label: string, statuses: readonly string[]) => ({
    label,
    total: sumFor(statuses),
    broker: sumFor(statuses, 'BROKER'),
    agenzia: sumFor(statuses, 'AGENZIA'),
  });
  const stats = [
    metric('Totale', STATI),
    metric('Da contattare', ['S0', 'S1']),
    metric('Interessati', ['S3', 'S5']),
    metric('Iscritti', ['S7', 'S8', 'S9']),
    metric('Attivi', ['S9']),
    metric('Churned', ['S10']),
  ];

  // Serializza ai client component (Date → string ISO)
  const contacts = pageContacts.map((c) => ({
    ...c,
    assignedToName: c.assignedTo
      ? `${c.assignedTo.nome} ${c.assignedTo.cognome}`.trim()
      : null,
    assignedTo: undefined,
    lastContactAt: c.lastContactAt?.toISOString() ?? null,
    nextContactAt: c.nextContactAt?.toISOString() ?? null,
    linkInviatoAt: c.linkInviatoAt?.toISOString() ?? null,
    emailOptOutAt: c.emailOptOutAt?.toISOString() ?? null,
    iscrizioneAt: c.iscrizioneAt?.toISOString() ?? null,
    primaPraticaAt: c.primaPraticaAt?.toISOString() ?? null,
    lastAccessAt: c.lastAccessAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: null,
  }));

  return (
    <AppShell session={session} activePath="/admin/crm/contatti">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Contatti
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Lead pre-iscrizione lavorati dal team commerciale. Funnel S0 → S10.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <CategoryStatCard
              key={s.label}
              label={s.label}
              total={s.total}
              broker={s.broker}
              agenzia={s.agenzia}
            />
          ))}
        </div>

        <CrmContactsClient
          contacts={contacts}
          salesUsers={salesUsers.map((u) => ({
            id: u.id,
            name: `${u.nome} ${u.cognome}`.trim(),
          }))}
          promoCodes={promoCodes}
          currentUserRole={session.user.role ?? ''}
          currentUserId={session.user.id ?? ''}
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          filters={{
            q: sp.q ?? '',
            cat: sp.cat ?? '',
            status: sp.status ?? '',
            regione: sp.regione ?? '',
            assigned: sp.assigned ?? '',
            sort: sort,
            preset: sp.preset ?? '',
          }}
        />
      </div>
    </AppShell>
  );
}

/** Card riepilogo: valore globale + split Broker (blu) / Agenzie (arancio). */
function CategoryStatCard({
  label,
  total,
  broker,
  agenzia,
}: {
  label: string;
  total: number;
  broker: number;
  agenzia: number;
}) {
  return (
    <div className="rounded-[14px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)]">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-pv-navy-900">
        {total.toLocaleString('it-IT')}
      </p>
      <div className="mt-3 flex items-center gap-4 border-t border-pv-slate-100 pt-2.5 text-[12px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-pv-slate-500">Broker</span>
          <span className="font-bold text-pv-navy-900">{broker.toLocaleString('it-IT')}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-pv-orange-500" />
          <span className="text-pv-slate-500">Agenzie</span>
          <span className="font-bold text-pv-navy-900">{agenzia.toLocaleString('it-IT')}</span>
        </span>
      </div>
    </div>
  );
}
