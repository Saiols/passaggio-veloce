import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, StatCard } from '@/components/ui';
import { canViewCrm } from '@/lib/auth/permissions';
import { CrmTabs } from '../tabs';
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
  sort?: 'urgente' | 'recente' | 'nome';
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
      <AppShell session={session} activePath="/admin/crm">
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
  if (sp.status && STATI.includes(sp.status as (typeof STATI)[number])) {
    where.status = sp.status as (typeof STATI)[number];
  }
  if (sp.regione) where.regione = sp.regione;
  if (sp.assigned) where.assignedToId = sp.assigned;

  // SALES vede solo i contatti a lui assegnati (decisione 7)
  if (session.user.role === 'SALES') {
    where.assignedToId = session.user.id;
  }

  // Sort
  const sort = sp.sort ?? 'urgente';
  // Engine fa orderBy semplice su date / nome; "urgente" lo ordiniamo lato client
  // perché PostgreSQL non ha un facile ranking per S6→S5→S4→...
  const orderBy: Prisma.CrmContactOrderByWithRelationInput =
    sort === 'recente'
      ? { lastContactAt: 'desc' }
      : sort === 'nome'
        ? { nome: 'asc' }
        : { createdAt: 'desc' };

  const [allContacts, salesUsers, statsCounts] = await Promise.all([
    prisma.crmContact.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        assignedTo: { select: { id: true, nome: true, cognome: true } },
      },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ['SALES_MANAGER', 'SALES'] },
        deletedAt: null,
      },
      select: { id: true, nome: true, cognome: true },
      orderBy: [{ nome: 'asc' }, { cognome: 'asc' }],
    }),
    // Conteggi globali (no filtri user) per le stat cards
    prisma.crmContact.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  // Sort "urgente" applicato lato server in memoria (lista già limitata)
  if (sort === 'urgente') {
    const URGENCY: Record<string, number> = {
      S6: 0,
      S5: 1,
      S4: 2,
      S3: 3,
      S1: 4,
      S0: 5,
      S7: 6,
      S2: 7,
      S8: 8,
      S9: 9,
      S10: 10,
    };
    allContacts.sort(
      (a, b) => (URGENCY[a.status] ?? 99) - (URGENCY[b.status] ?? 99),
    );
  }

  const counts = Object.fromEntries(
    statsCounts.map((s) => [s.status, s._count._all]),
  ) as Record<string, number>;
  const totale = statsCounts.reduce((acc, s) => acc + s._count._all, 0);

  const stats = [
    { label: 'Totale', value: totale, accent: 'navy' as const },
    {
      label: 'Da contattare',
      value: (counts.S0 ?? 0) + (counts.S1 ?? 0),
      accent: 'orange' as const,
    },
    {
      label: 'Interessati',
      value: (counts.S3 ?? 0) + (counts.S5 ?? 0),
      accent: 'green' as const,
    },
    {
      label: 'Iscritti',
      value: (counts.S7 ?? 0) + (counts.S8 ?? 0) + (counts.S9 ?? 0),
      accent: 'navy' as const,
    },
    { label: 'Attivi', value: counts.S9 ?? 0, accent: 'green' as const },
    { label: 'Churned', value: counts.S10 ?? 0, accent: 'slate' as const },
  ];

  // Serializza ai client component (Date → string ISO)
  const contacts = allContacts.map((c) => ({
    ...c,
    assignedToName: c.assignedTo
      ? `${c.assignedTo.nome} ${c.assignedTo.cognome}`.trim()
      : null,
    assignedTo: undefined,
    lastContactAt: c.lastContactAt?.toISOString() ?? null,
    nextContactAt: c.nextContactAt?.toISOString() ?? null,
    linkInviatoAt: c.linkInviatoAt?.toISOString() ?? null,
    iscrizioneAt: c.iscrizioneAt?.toISOString() ?? null,
    primaPraticaAt: c.primaPraticaAt?.toISOString() ?? null,
    lastAccessAt: c.lastAccessAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: null,
  }));

  return (
    <AppShell session={session} activePath="/admin/crm">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Pipeline lead
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Contatti pre-iscrizione lavorati dal team commerciale. Funnel S0 → S10.
          </p>
        </header>

        <CrmTabs active="pipeline" />

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <StatCard
              key={s.label}
              label={s.label}
              value={s.value}
              accent={s.accent}
            />
          ))}
        </div>

        <CrmContactsClient
          contacts={contacts}
          salesUsers={salesUsers.map((u) => ({
            id: u.id,
            name: `${u.nome} ${u.cognome}`.trim(),
          }))}
          currentUserRole={session.user.role ?? ''}
          currentUserId={session.user.id ?? ''}
          filters={{
            q: sp.q ?? '',
            cat: sp.cat ?? '',
            status: sp.status ?? '',
            regione: sp.regione ?? '',
            assigned: sp.assigned ?? '',
            sort: sort,
          }}
        />
      </div>
    </AppShell>
  );
}
