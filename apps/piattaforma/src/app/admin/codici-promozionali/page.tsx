import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { PromoCodiClient } from './client';

export default async function AdminCodiciPromoPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/codici-promozionali">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono gestire i codici promozionali.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const codici = await prisma.promoCode.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, code: true, amountCent: true, expiresAt: true, maxRedemptions: true,
      active: true, createdAt: true, _count: { select: { redemptions: true } },
    },
  });

  const rows = codici.map((c) => ({
    id: c.id,
    code: c.code,
    amountCent: c.amountCent,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    maxRedemptions: c.maxRedemptions,
    active: c.active,
    redemptions: c._count.redemptions,
  }));

  return (
    <AppShell session={session} activePath="/admin/codici-promozionali">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Codici promozionali
        </h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Crea codici riscattabili in registrazione: l&apos;importo viene accreditato sul wallet della nuova azienda.
        </p>
        <PromoCodiClient rows={rows} />
      </div>
    </AppShell>
  );
}
