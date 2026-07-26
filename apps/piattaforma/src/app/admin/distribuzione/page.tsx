import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { romeYmd } from '@/lib/date/rome-day';
import { getDistribuzioneConfig } from '@/lib/distribuzione/config';
import { getStatisticheRound } from '@/lib/distribuzione/statistiche';
import { DistribuzioneConfigClient } from './client';
import { RoundStats } from './round-stats';

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

  const [config, stats] = await Promise.all([getDistribuzioneConfig(), getStatisticheRound()]);

  // Il giorno di Roma, non quello del browser dell'admin: è lo stesso giorno
  // che l'editor dei festivi usa per distinguere "passato" da "futuro" e per
  // valutare l'avviso di calendario in scadenza.
  const [y, m, d] = romeYmd(new Date());
  const oggiIso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <AppShell session={session} activePath="/admin/distribuzione">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Distribuzione pratiche
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Il motore cerca agenzie in un raggio in linea d&apos;aria che si allarga a ogni
          round, finché una accetta o si raggiunge il raggio massimo (&quot;zona non
          coperta&quot;). Le modifiche valgono dal prossimo tick di distribuzione.
        </p>
        <div className="mt-6">
          <RoundStats stats={stats} intervalloMin={config.intervalloMin} />
        </div>
        <div className="mt-6">
          <DistribuzioneConfigClient config={config} oggiIso={oggiIso} />
        </div>
      </div>
    </AppShell>
  );
}
