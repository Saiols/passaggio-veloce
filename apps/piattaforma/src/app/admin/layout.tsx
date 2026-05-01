import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // ADMIN_PIATTAFORMA + ASSISTENTE hanno entrambi accesso alle route admin.
  // Le route che richiedono solo ADMIN_PIATTAFORMA (es. dashboard finanziaria)
  // applicano un ulteriore guard via canViewAggregatedFinancials().
  if (!isAdminOrAssistente(session.user.role)) redirect('/dashboard');
  return <>{children}</>;
}
