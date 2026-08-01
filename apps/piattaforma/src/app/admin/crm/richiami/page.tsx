import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewCrm } from '@/lib/auth/permissions';
import { RichiamiClient } from './client';

export default async function AdminCrmRichiamiPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrm(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/richiami">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Il calendario richiami CRM è riservato al team interno Passaggio Veloce.
          </Alert>
        </div>
      </AppShell>
    );
  }

  // Tutti i richiami programmati (anche futuri: è un calendario) di chi non si è
  // ancora registrato. Scoping SALES ai propri.
  const contatti = await prisma.crmContact.findMany({
    where: {
      deletedAt: null,
      iscrizioneComp: false,
      nextContactAt: { not: null },
      ...(session.user.role === 'SALES' ? { assignedToId: session.user.id } : {}),
    },
    select: {
      id: true,
      nome: true,
      cat: true,
      tel: true,
      citta: true,
      nextContactAt: true,
      nextContactFascia: true,
    },
    orderBy: [{ nextContactAt: 'asc' }, { nextContactFascia: 'asc' }],
    take: 500,
  });

  const righe = contatti.map((c) => ({
    id: c.id,
    nome: c.nome,
    cat: c.cat,
    tel: c.tel,
    citta: c.citta,
    nextContactAt: c.nextContactAt!.toISOString(),
    nextContactFascia: c.nextContactFascia,
  }));

  return (
    <AppShell session={session} activePath="/admin/crm/richiami">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Calendario richiami
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            I contatti da richiamare, per giorno e fascia. Aggiungili al tuo Google Calendar con un
            clic.
          </p>
        </header>

        <RichiamiClient righe={righe} />
      </div>
    </AppShell>
  );
}
