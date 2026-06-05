import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { AtecoClient } from './client';

export default async function AdminAtecoPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/ateco">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono gestire i codici ATECO ammessi.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const codes = await prisma.atecoAllowedCode.findMany({
    orderBy: [{ companyType: 'asc' }, { code: 'asc' }],
  });

  return (
    <AppShell session={session} activePath="/admin/ateco">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Codici ATECO ammessi
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Allowlist dei codici ATECO usata dal controllo KYC in registrazione: la visura deve iniziare con un
          codice ammesso e attivo per il tipo di azienda.
        </p>
        <AtecoClient codes={codes} />
      </div>
    </AppShell>
  );
}
