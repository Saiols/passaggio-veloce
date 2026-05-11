import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { RevokeButton } from './revoke-button';
import { DisableTeamUserButton } from './disable-button';
import { TeamPageClient } from './team-page-client';
import { formatRelative } from '@/lib/format';

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') redirect('/dashboard');
  const companyId = session.user.companyId!;

  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, nome: true, cognome: true,
        role: true, status: true, lastLoginAt: true,
      },
    }),
    prisma.invitation.findMany({
      where: { companyId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, createdAt: true, expiresAt: true },
    }),
  ]);

  return (
    <AppShell session={session} activePath="/team">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Azienda
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Team
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Gestisci gli utenti che possono operare per conto della tua azienda.
            </p>
          </div>
          <TeamPageClient />
        </header>

        <section className="rounded-2xl border border-pv-slate-200 bg-white p-6 mb-6">
          <h2 className="text-base font-bold text-pv-navy-900">
            Utenti attivi ({users.length})
          </h2>
          <ul className="mt-3 divide-y divide-pv-slate-100">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-pv-navy-900">
                    {u.nome} {u.cognome}
                  </p>
                  <p className="truncate text-xs text-pv-slate-500">
                    {u.email} · {u.role === 'ADMIN_AZIENDA' ? 'Admin' : 'Utente'}
                  </p>
                </div>
                <span className="text-xs text-pv-slate-500 hidden sm:inline">
                  {u.lastLoginAt
                    ? `Ultimo accesso ${formatRelative(u.lastLoginAt)}`
                    : 'Mai entrato'}
                </span>
                {u.id !== session.user.id && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/team/${u.id}/edit`}
                      className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                    >
                      Modifica
                    </Link>
                    <DisableTeamUserButton
                      userId={u.id}
                      nome={u.nome}
                      cognome={u.cognome}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {invitations.length > 0 && (
          <section className="rounded-2xl border border-pv-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-pv-navy-900">Inviti in attesa</h2>
            <ul className="mt-3 divide-y divide-pv-slate-100">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-semibold text-pv-navy-900">{inv.email}</p>
                    <p className="text-xs text-pv-slate-500">
                      Inviato {formatRelative(inv.createdAt)} · scade {formatRelative(inv.expiresAt)}
                    </p>
                  </div>
                  <RevokeButton invitationId={inv.id} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
