import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { SicurezzaClient } from './client';

export default async function SicurezzaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true, email: true },
  });

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Profilo · Sicurezza
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Autenticazione a due fattori
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Aggiungi un secondo passaggio al login con un&apos;app authenticator
            (Google Authenticator, Authy, 1Password, ecc.). Riduce il rischio
            di accessi non autorizzati anche in caso di password compromessa.
          </p>
        </header>

        <Card>
          <SicurezzaClient
            email={user?.email ?? ''}
            enabled={user?.twoFactorEnabled ?? false}
          />
        </Card>
      </div>
    </AppShell>
  );
}
