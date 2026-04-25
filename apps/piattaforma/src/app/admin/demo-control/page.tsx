import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { env } from '@/env';
import { AppShell } from '@/components/app-shell';
import { Counters } from './counters';

export default async function DemoControlPage() {
  if (!env.DEMO_MODE) notFound();
  const session = await auth();

  return (
    <AppShell session={session!} activePath="/admin/demo-control">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · Modalità DEMO
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Demo Control
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Centro operazioni per orchestrare cron, ispezionare email simulate
            e demo dei flussi di pagamento.
          </p>
        </header>

        <section className="mb-6">
          <Counters />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <p className="text-sm text-pv-slate-500">[Inbox Demo: vedi Task 26]</p>
          </section>
          <section>
            <p className="text-sm text-pv-slate-500">[Job Buttons: vedi Task 27]</p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
