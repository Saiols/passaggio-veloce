import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { ProfiloPersonaleForm } from './form';

export default async function ProfiloPersonalePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      nome: true,
      cognome: true,
      codiceFiscale: true,
    },
  });

  if (!user) redirect('/profilo');

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href="/profilo"
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Torna al profilo
        </Link>
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Profilo
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Modifica i tuoi dati
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Aggiorna nome, cognome ed email del tuo account.
          </p>
        </header>

        <Card>
          <ProfiloPersonaleForm
            defaultEmail={user.email}
            defaultNome={user.nome}
            defaultCognome={user.cognome}
            defaultCodiceFiscale={user.codiceFiscale ?? ''}
          />
        </Card>
      </div>
    </AppShell>
  );
}
