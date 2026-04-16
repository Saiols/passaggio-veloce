import Image from 'next/image';
import { auth } from '@/auth';
import { Button, Card } from '@/components/ui';
import { logoutAction } from '@/app/(auth)/actions';

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-pv-slate-50">
      <header className="sticky top-0 z-20 bg-pv-navy-800 text-white shadow-[0_2px_12px_rgb(10_37_64_/_0.25)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white">
              <Image src="/brand/logo.svg" alt="" width={18} height={18} className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[14px] font-extrabold tracking-tight">Passaggio Veloce</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-[#b8cdea] sm:inline">
              {session?.user?.email}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-[10px] border border-[1.5px] border-white/20 bg-white/5 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
              >
                Esci
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-500">
              Dashboard
            </p>
            <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[30px]">
              Benvenuto, {session?.user?.name ?? 'utente'}
            </h1>
          </div>
          <Button size="sm">Nuova pratica</Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-pv-slate-500">
              Account
            </p>
            <p className="mt-2 text-[15px] font-bold text-pv-navy-800">
              {session?.user?.email ?? '—'}
            </p>
            <p className="mt-0.5 text-[13px] text-pv-slate-500">
              Ruolo: {session?.user?.role ?? '—'}
            </p>
          </Card>
          <Card>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-pv-slate-500">
              Azienda
            </p>
            <p className="mt-2 text-[15px] font-bold text-pv-navy-800">
              {session?.user?.companyType ?? '—'}
            </p>
            <p className="mt-0.5 text-[13px] text-pv-slate-500">
              Tipo profilo attivo
            </p>
          </Card>
          <Card>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-pv-slate-500">
              Pratiche attive
            </p>
            <p className="mt-2 text-[15px] font-bold text-pv-navy-800">0</p>
            <p className="mt-0.5 text-[13px] text-pv-slate-500">In attesa di Fase 2</p>
          </Card>
        </div>

        <Card className="mt-6">
          <h2 className="text-[16px] font-bold text-pv-navy-800">
            Le funzionalità arriveranno nelle prossime fasi
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-pv-slate-500">
            In Fase 2 attiveremo creazione pratiche, upload documenti e KYC. Vedi{' '}
            <code className="rounded bg-pv-navy-100 px-1.5 py-0.5 text-[12px] text-pv-navy-700">
              docs/piano-implementazione.md
            </code>{' '}
            per il roadmap completo.
          </p>
        </Card>
      </main>
    </div>
  );
}
