import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { BrokerDashboard } from './broker-dashboard';
import { AgenziaDashboard } from './agenzia-dashboard';
import { AdminDashboard } from './admin-dashboard';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    tick?: string;
    scanned?: string;
    timeouts?: string;
    advanced?: string;
    escalated?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = session.user.role;
  const companyType = session.user.companyType;
  const companyId = session.user.companyId;

  return (
    <AppShell session={session} activePath="/dashboard">
      {/* Admin e Assistente condividono l'overview operativa (conteggi pratiche/
          anagrafiche/escalation). I dati finanziari aggregati restano riservati
          all'Admin nella pagina dedicata /admin/dashboard (canViewAggregatedFinancials). */}
      {isAdminOrAssistente(role) ? (
        <AdminDashboard
          tickBanner={
            sp.tick === '1'
              ? {
                  scanned: sp.scanned,
                  timeouts: sp.timeouts,
                  advanced: sp.advanced,
                  escalated: sp.escalated,
                }
              : undefined
          }
        />
      ) : companyType === 'AGENZIA' && companyId ? (
        <AgenziaDashboard companyId={companyId} />
      ) : companyType === 'DEALER' && companyId ? (
        <BrokerDashboard companyId={companyId} userName={session.user.name ?? undefined} />
      ) : (
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">Account non configurato. Contatta il supporto.</p>
        </div>
      )}
    </AppShell>
  );
}
