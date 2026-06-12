import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { OPTIONAL_TIPI, OPTIONAL_TIPI_LABELS, shouldSend } from '@/lib/notifiche/preferences';
import { updateNotifPrefsAction } from './actions';
import { SalvaPreferenzeButton } from './save-button';

export const dynamic = 'force-dynamic';

export default async function NotifichePreferenzePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notifPrefs: true },
  });
  const prefs = (user?.notifPrefs as Record<string, boolean> | null) ?? null;

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Profilo</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Preferenze notifiche
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Le notifiche transazionali (pratiche, firme, addebiti) sono sempre attive. Qui gestisci solo quelle facoltative.
          </p>
        </header>

        <Card>
          <form action={updateNotifPrefsAction} className="space-y-4">
            {[...OPTIONAL_TIPI].map((tipo) => (
              <label key={tipo} className="flex items-center justify-between gap-4">
                <span className="text-[14px] text-pv-navy-800">{OPTIONAL_TIPI_LABELS[tipo] ?? tipo}</span>
                <input
                  type="checkbox"
                  name={tipo}
                  defaultChecked={shouldSend(tipo, prefs)}
                  className="h-5 w-5 accent-pv-navy-700"
                />
              </label>
            ))}
            <div className="border-t border-pv-slate-200 pt-4">
              <SalvaPreferenzeButton />
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
