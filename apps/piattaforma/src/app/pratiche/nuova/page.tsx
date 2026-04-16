import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { WizardNuovaPratica } from './wizard';

export default async function NuovaPraticaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'DEALER') redirect('/dashboard');

  const sp = await searchParams;

  return (
    <AppShell session={session} activePath="/pratiche">
      <WizardNuovaPratica error={sp.error} />
    </AppShell>
  );
}
