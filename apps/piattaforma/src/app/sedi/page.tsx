import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { suspendSedeAction, reactivateSedeAction } from './actions';
import { SedeCreateForm } from './sede-create-form';

export default async function SediPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') redirect('/dashboard');
  const companyId = session.user.companyId!;
  const sp = await searchParams;

  const sedi = await prisma.sede.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      nome: true,
      citta: true,
      provincia: true,
      iban: true,
      referralCode: true,
      suspendedAt: true,
    },
  });

  return (
    <AppShell session={session} activePath="/sedi">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Azienda</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Sedi
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Gestisci le sedi operative della tua azienda. Ogni sede ha un proprio link di
            affiliazione e può avere un IBAN dedicato per i payout.
          </p>
        </header>

        {sp.saved && (
          <div className="mb-5">
            <Alert variant="success">Sede salvata.</Alert>
          </div>
        )}
        {sp.error && (
          <div className="mb-5">
            <Alert variant="error">{sp.error}</Alert>
          </div>
        )}

        <section className="mb-6 rounded-2xl border border-pv-slate-200 bg-white p-6">
          <h2 className="mb-3 text-base font-bold text-pv-navy-900">Sedi attive ({sedi.length})</h2>
          <ul className="divide-y divide-pv-slate-100">
            {sedi.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-pv-navy-900">
                    {s.nome}
                    {s.suspendedAt && (
                      <span className="ml-2 rounded-full bg-pv-red-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-red-600">
                        Sospesa
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-pv-slate-500">
                    {s.citta} ({s.provincia}) · ref: {s.referralCode ?? '—'}
                    {s.iban ? ` · IBAN dedicato` : ' · IBAN madre'}
                  </p>
                </div>
                <form
                  action={async () => {
                    'use server';
                    if (s.suspendedAt) await reactivateSedeAction(s.id);
                    else await suspendSedeAction(s.id);
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                  >
                    {s.suspendedAt ? 'Riattiva' : 'Sospendi'}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-pv-slate-200 bg-white p-6">
          <h2 className="mb-4 text-base font-bold text-pv-navy-900">Aggiungi una sede</h2>
          <SedeCreateForm />
        </section>
      </div>
    </AppShell>
  );
}
