import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewCrmDashboard } from '@/lib/auth/permissions';
import { getMappaPoints } from '@/lib/crm/mappa-points';
import { MappaClient } from './mappa-client';

export const metadata = { title: 'Mappa iscrizioni · CRM' };

export default async function AdminCrmMappaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrmDashboard(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/mappa">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La mappa CRM è riservata a Admin / AD / CTO / Sales Manager.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const { points, nonGeolocalizzate } = await getMappaPoints();

  return (
    <AppShell session={session} activePath="/admin/crm/mappa">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-pv-slate-900">Distribuzione iscrizioni</h1>
        <p className="mt-1 text-[13px] text-pv-slate-500">
          Ogni punto è una sede iscritta. Blu = broker, arancione = agenzia.
          Zooma per aprire i raggruppamenti.
        </p>
        <div className="mt-4">
          <MappaClient points={points} nonGeolocalizzate={nonGeolocalizzate} />
        </div>
      </div>
    </AppShell>
  );
}
