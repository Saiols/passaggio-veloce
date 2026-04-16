import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { formatRelative } from '@/lib/format';

export default async function AdminEscalationPage() {
  const session = await auth();
  const pratiche = await prisma.pratica.findMany({
    where: { stato: 'IN_ESCALATION', deletedAt: null },
    orderBy: { escalationAt: 'desc' },
    include: {
      broker: { select: { ragioneSociale: true, email: true, telefono: true } },
      assegnazioni: {
        include: { agenzia: { select: { ragioneSociale: true } } },
      },
    },
  });

  return (
    <AppShell session={session!} activePath="/admin/escalation">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Pratiche in escalation
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Pratiche che hanno esaurito tutti i round di distribuzione senza accettazione.
            Richiedono assegnazione manuale a partner di fiducia o contatto con il broker.
          </p>
        </header>

        {pratiche.length === 0 ? (
          <Alert variant="success" title="Nessuna escalation attiva">
            Tutte le pratiche sono assegnate o in corso di distribuzione.
          </Alert>
        ) : (
          <div className="space-y-4">
            {pratiche.map((p) => (
              <div
                key={p.id}
                className="rounded-[16px] border border-pv-red-500/30 bg-pv-red-50/40 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Link
                      href={`/pratiche/${p.id}`}
                      className="font-mono text-[14px] font-bold text-pv-navy-800 hover:underline"
                    >
                      {p.codicePratica ?? '—'}
                    </Link>
                    <p className="mt-1 text-[14px] font-semibold text-pv-navy-800">
                      {p.targa ?? '—'} · {p.comune ?? '—'} ({p.provincia ?? '—'})
                    </p>
                    <p className="mt-0.5 text-[12px] text-pv-slate-500">
                      Broker: {p.broker.ragioneSociale} · {p.broker.email}
                      {p.broker.telefono ? ` · ${p.broker.telefono}` : ''}
                    </p>
                    <p className="mt-0.5 text-[12px] text-pv-slate-500">
                      Escalation: {formatRelative(p.escalationAt)} ·{' '}
                      {p.assegnazioni.length} tentativi
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-pv-red-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                    Azione richiesta
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
