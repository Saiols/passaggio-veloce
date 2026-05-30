import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { WizardNuovaPratica } from './wizard';

// Vercel function timeout: 60s su Hobby plan (max), 300s su Pro.
// L'OCR Mindee V2 (enqueueAndGetResult) fa polling async che può superare
// i default 10s, quindi richiediamo esplicitamente il massimo.
export const maxDuration = 60;

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
