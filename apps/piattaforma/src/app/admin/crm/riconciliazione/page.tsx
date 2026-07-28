import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canRunCrmReconciliation } from '@/lib/auth/permissions';
import { calcolaProposte } from '@/lib/crm/match/engine';
import { RiconciliazioneClient } from './client';
import { propostaPerVista } from './vista';

export const metadata = { title: 'Riconciliazione · CRM' };

const ANTEPRIMA_MAX = 100;

export default async function AdminCrmRiconciliazionePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canRunCrmReconciliation(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/riconciliazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La riconciliazione CRM è riservata a Admin / AD / CTO.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const proposte = await calcolaProposte();
  const broker = proposte.filter((p) => p.cat === 'BROKER').length;
  const agenzia = proposte.length - broker;
  const ambigue = proposte.filter((p) => p.ambigua).length;
  // In anteprima si mostrano solo le prime ANTEPRIMA_MAX: le ambigue vanno in
  // testa, perché sono le uniche che il cron non applica da solo e quindi le
  // sole per cui questa pagina è indispensabile. Ordinamento stabile: dentro
  // ciascun gruppo resta l'ordine del motore (punteggio decrescente).
  const inAnteprima = [...proposte].sort(
    (a, b) => Number(b.ambigua) - Number(a.ambigua),
  );

  return (
    <AppShell session={session} activePath="/admin/crm/riconciliazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Riconciliazione
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Righe della lista che corrispondono ad aziende già registrate. Ogni
            proposta ha almeno un identificativo forte in comune: P.IVA, email,
            PEC o telefono.
          </p>
        </header>

        <RiconciliazioneClient
          // propostaPerVista toglie `sorgente` (vedi vista.ts): non deve mai
          // attraversare il confine col Client Component.
          proposte={inAnteprima.slice(0, ANTEPRIMA_MAX).map(propostaPerVista)}
          totale={proposte.length}
          broker={broker}
          agenzia={agenzia}
          ambigue={ambigue}
          mostrate={Math.min(proposte.length, ANTEPRIMA_MAX)}
        />
      </div>
    </AppShell>
  );
}
