import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { getSessionContext, getManageableSedi } from '@/lib/auth/session-context';
import { Card } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { TeamEditForm } from './edit-form';
import { ResetPasswordSection } from './reset-password';

export default async function TeamUserEditPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/dashboard');
  const manageable = await getManageableSedi();
  if (manageable.length === 0) redirect('/dashboard');
  const companyId = ctx.companyId;
  const manageableIds = manageable.map((s) => s.id);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, nome: true, cognome: true,
      role: true, status: true, companyId: true, lastLoginAt: true, createdAt: true,
    },
  });
  if (!target || target.companyId !== companyId) notFound();

  const isOwnerTarget = target.role === 'ADMIN_AZIENDA';
  const membership = await prisma.userSede.findFirst({
    where: { userId },
    select: { sedeId: true, ruolo: true },
  });
  // Un ADMIN_SEDE può modificare solo utenti di una sede che amministra; mai il proprietario.
  if (!ctx.isOwner) {
    if (isOwnerTarget) notFound();
    if (!membership || !manageableIds.includes(membership.sedeId)) notFound();
  }
  // Selettore sede: il proprietario vede tutte le sedi; l'admin di sede solo le sue.
  const sedi = ctx.isOwner
    ? await prisma.sede.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, nome: true },
        orderBy: { createdAt: 'asc' },
      })
    : manageable.map((s) => ({ id: s.id, nome: s.nome }));

  return (
    <AppShell session={session} activePath="/team">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href="/team"
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Torna al team
        </Link>

        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Modifica utente team
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            {target.nome} {target.cognome}
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {target.email} · {target.role === 'ADMIN_AZIENDA' ? 'Admin' : 'Utente'} ·{' '}
            {target.lastLoginAt
              ? `Ultimo accesso ${formatRelative(target.lastLoginAt)}`
              : 'Mai entrato'}
          </p>
        </header>

        <Card className="mb-5">
          <h2 className="text-[15px] font-bold text-pv-navy-800">Dati anagrafici</h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            {isOwnerTarget
              ? 'Aggiorna nome, cognome ed email. Le modifiche sono immediate.'
              : 'Aggiorna nome, cognome, email, sede di appartenenza e ruolo. Le modifiche sono immediate.'}
          </p>
          <div className="mt-4">
            <TeamEditForm
              userId={target.id}
              defaultEmail={target.email}
              defaultNome={target.nome}
              defaultCognome={target.cognome}
              isOwner={isOwnerTarget}
              sedi={sedi}
              defaultSedeId={membership?.sedeId ?? ''}
              defaultRuolo={membership?.ruolo ?? 'OPERATORE'}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">Reset password</h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Genera una nuova password per questo utente. Per motivi di sicurezza
            (e GDPR) la password viene mostrata <strong>una sola volta</strong>:
            copiala e comunicala al dipendente fuori piattaforma. Non e&apos;
            recuperabile in seguito.
          </p>
          <ResetPasswordSection userId={target.id} />
        </Card>
      </div>
    </AppShell>
  );
}
