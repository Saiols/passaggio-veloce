import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatRelative } from '@/lib/format';
import { AssistenteEditForm } from './edit-form';
import { ResetAssistentePassword } from './reset-password';

export default async function AdminAssistenteEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) redirect('/dashboard');

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      nome: true,
      cognome: true,
      role: true,
      status: true,
      lastLoginAt: true,
    },
  });

  if (!target || target.role !== 'ASSISTENTE') notFound();

  return (
    <AppShell session={session} activePath="/admin/assistenti">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href="/admin/assistenti"
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Tutti gli assistenti
        </Link>

        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Modifica assistente
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            {target.nome} {target.cognome}
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {target.email} ·{' '}
            {target.lastLoginAt
              ? `Ultimo accesso ${formatRelative(target.lastLoginAt)}`
              : 'Mai entrato'}
          </p>
        </header>

        <Card className="mb-5">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Dati anagrafici
          </h2>
          <div className="mt-4">
            <AssistenteEditForm
              userId={target.id}
              defaultEmail={target.email}
              defaultNome={target.nome}
              defaultCognome={target.cognome}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Reset password
          </h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            La nuova password viene mostrata <strong>una sola volta</strong>:
            copiala e comunicala all&apos;assistente fuori piattaforma.
          </p>
          <ResetAssistentePassword userId={target.id} />
        </Card>
      </div>
    </AppShell>
  );
}
