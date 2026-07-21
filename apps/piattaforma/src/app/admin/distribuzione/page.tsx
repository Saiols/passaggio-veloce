import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { getDistribuzioneConfig } from '@/lib/distribuzione/config';
import { DistribuzioneConfigClient } from './client';

export default async function AdminDistribuzionePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/distribuzione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono modificare la configurazione di distribuzione.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const config = await getDistribuzioneConfig();

  return (
    <AppShell session={session} activePath="/admin/distribuzione">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Distribuzione pratiche
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Il raggio massimo di ricerca agenzie: entro quanti metri il motore cerca
          un&apos;agenzia prima di dichiarare la pratica &quot;zona non coperta&quot;. Vale da
          subito per il prossimo tick di distribuzione.
        </p>
        <div className="mt-6">
          <DistribuzioneConfigClient config={config} />
        </div>
      </div>
    </AppShell>
  );
}
