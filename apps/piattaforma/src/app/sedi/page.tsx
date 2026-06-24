import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { SediClient, type SedeRow } from './sedi-client';

export default async function SediPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') redirect('/dashboard');
  const companyId = session.user.companyId!;

  const sediRaw = await prisma.sede.findMany({
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
  const sedi: SedeRow[] = sediRaw.map((s) => ({
    ...s,
    suspendedAt: s.suspendedAt ? s.suspendedAt.toISOString() : null,
  }));

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

        <SediClient sedi={sedi} />
      </div>
    </AppShell>
  );
}
