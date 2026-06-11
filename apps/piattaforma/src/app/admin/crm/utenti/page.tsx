import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import {
  canViewCrmTeamUsers,
  canManageCrmTeamUser,
  creatableCrmRoles,
} from '@/lib/auth/permissions';
import { CrmUsersClient } from './client';

export default async function AdminCrmUtentiPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewCrmTeamUsers(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/crm/utenti">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione utenti team CRM è riservata ai ruoli admin/AD/CTO/Sales
            Manager.
          </Alert>
        </div>
      </AppShell>
    );
  }

  // Filtraggio: tutti gli utenti team interno (companyId NULL e role in lista CRM).
  // SALES_MANAGER vede solo SALES + se stesso.
  const where: Prisma.UserWhereInput = {
    companyId: null,
    deletedAt: null,
    role: {
      in: ['ADMIN_PIATTAFORMA', 'AD', 'CTO', 'CFO', 'SALES_MANAGER', 'SALES'],
    },
  };
  if (session.user.role === 'SALES_MANAGER') {
    where.OR = [{ role: 'SALES' }, { id: session.user.id }];
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ role: 'asc' }, { nome: 'asc' }, { cognome: 'asc' }],
    select: {
      id: true,
      nome: true,
      cognome: true,
      email: true,
      role: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  // Pre-calcola can-manage per ogni riga (server-side autoritativo)
  const rows = users.map((u) => ({
    id: u.id,
    nome: u.nome,
    cognome: u.cognome,
    email: u.email,
    role: u.role,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    canManage: canManageCrmTeamUser(session.user.role, session.user.id, {
      id: u.id,
      role: u.role,
    }),
  }));

  const allowedRoles = creatableCrmRoles(session.user.role);

  return (
    <AppShell session={session} activePath="/admin/crm/utenti">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · CRM
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Utenti team interno
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Account interni Passaggio Veloce abilitati al CRM. Le aziende
            broker/agenzie hanno la propria gestione in{' '}
            <strong>/admin/utenti</strong>.
          </p>
        </header>

        <CrmUsersClient
          users={rows}
          allowedRoles={allowedRoles}
          currentUserId={session.user.id ?? ''}
        />
      </div>
    </AppShell>
  );
}
