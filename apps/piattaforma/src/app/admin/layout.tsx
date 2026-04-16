import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_PIATTAFORMA') redirect('/dashboard');
  return <>{children}</>;
}
