import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { formatDateTime } from '@/lib/format';

const LABELS: Record<string, string> = {
  N1_BROKER_INVIO_PRATICA: 'Pratica inviata',
  N2_BROKER_ACCETTATA: 'Pratica accettata',
  N3_BROKER_SOLLECITO: 'Sollecito firma',
  N4_BROKER_FIRMA_E_CREDITO: 'Firma confermata',
  N5_BROKER_PAYOUT: 'Payout eseguito',
  N6_AGENZIA_NUOVA_PRATICA: 'Nuova pratica in arrivo',
  N7_AGENZIA_PROMEMORIA_COUNTDOWN: 'Promemoria scadenza',
  N8_AGENZIA_ADDEBITO: 'Addebito pratica',
  N10_ADMIN_ESCALATION: 'Escalation — admin',
  N11_BROKER_ESCALATION: 'Pratica in escalation',
};

export default async function NotifichePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id!;
  const companyId = session.user.companyId;

  const where: Prisma.NotificaInviataWhereInput = companyId
    ? { OR: [{ userId }, { companyId }] }
    : { userId };

  const notifiche = await prisma.notificaInviata.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <AppShell session={session} activePath="/notifiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Storico comunicazioni
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Notifiche
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Email e SMS che ti abbiamo inviato. Ultime {notifiche.length} mostrate.
            </p>
          </div>
          <Link
            href="/profilo/notifiche"
            className="shrink-0 text-[13px] font-bold text-pv-navy-700 hover:brightness-110"
          >
            Preferenze →
          </Link>
        </header>

        {notifiche.length === 0 ? (
          <div className="rounded-[16px] border border-pv-slate-200 bg-white p-8 text-center shadow-[var(--pv-shadow-card)]">
            <p className="text-[14px] text-pv-slate-500">Non hai ancora ricevuto notifiche.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {notifiche.map((n) => (
              <li
                key={n.id}
                className="rounded-[14px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-pv-navy-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-navy-700">
                        {LABELS[n.tipo] ?? n.tipo}
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                        {n.canale.toLowerCase()}
                      </span>
                      <StatoChip stato={n.stato} />
                    </div>
                    <p className="mt-2 text-[14px] font-semibold text-pv-navy-800">
                      {n.subject ?? '—'}
                    </p>
                    {n.bodyPreview && (
                      <p className="mt-1 text-[13px] text-pv-slate-700 line-clamp-2">
                        {n.bodyPreview}
                      </p>
                    )}
                    {n.errorMessage && (
                      <p className="mt-1 text-[12px] text-pv-red-500">
                        Errore: {n.errorMessage}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-pv-slate-500">
                    <p>{formatDateTime(n.createdAt)}</p>
                    <p className="truncate">{n.destinazione}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function StatoChip({ stato }: { stato: string }) {
  const map: Record<string, string> = {
    SENT: 'bg-pv-green-50 text-pv-green-500',
    SCHEDULED: 'bg-pv-slate-100 text-pv-slate-700',
    FAILED: 'bg-pv-red-50 text-pv-red-500',
    READ: 'bg-pv-navy-100 text-pv-navy-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${map[stato] ?? 'bg-pv-slate-100 text-pv-slate-500'}`}
    >
      {stato.toLowerCase()}
    </span>
  );
}
