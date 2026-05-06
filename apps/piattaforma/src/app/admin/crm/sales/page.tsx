import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import {
  canViewSales,
  canManageSalesAgent,
  canManageCrmCampaign,
} from '@/lib/auth/permissions';
import { CrmTabs } from '../tabs';
import { CrmSalesClient } from './client';

export default async function AdminCrmSalesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewSales(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione Sales CRM è riservata a Admin/AD/CTO/Sales Manager.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const [agents, campaigns] = await Promise.all([
    prisma.crmSalesAgent.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { campaigns: { where: { deletedAt: null } } } },
      },
    }),
    prisma.crmCampaign.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        agent: { select: { id: true, nome: true } },
        owner: { select: { id: true, nome: true, cognome: true } },
        _count: { select: { assegnazioni: true } },
      },
    }),
  ]);

  // Pre-calcola can-manage per ogni campagna server-side
  const campaignsWithPerms = campaigns.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: null,
    canManage: canManageCrmCampaign(
      session.user!.role,
      c.ownerId,
      session.user!.id,
    ),
    ownerName: c.owner
      ? `${c.owner.nome} ${c.owner.cognome}`.trim()
      : '—',
    agentName: c.agent?.nome ?? '—',
    assegnatiCount: c._count.assegnazioni,
  }));

  const agentsSerializable = agents.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    deletedAt: null,
    campaignCount: a._count.campaigns,
  }));

  return (
    <AppShell session={session} activePath="/admin/crm">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Sales AI
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Configura gli agent vocali (Vapi.ai) e le campagne di chiamata
            outbound. La chiamata AI reale arriva con CRM-H (account Vapi).
          </p>
        </header>

        <CrmTabs active="sales" />

        <CrmSalesClient
          agents={agentsSerializable}
          campaigns={campaignsWithPerms}
          canManageAgent={canManageSalesAgent(session.user.role)}
        />
      </div>
    </AppShell>
  );
}
