import { auth } from '@/auth';
import { logoutAction } from '@/app/(auth)/actions';

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Esci
            </button>
          </form>
        </header>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Benvenuto, {session?.user?.name}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Email: {session?.user?.email}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Ruolo: {session?.user?.role}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Tipo azienda: {session?.user?.companyType ?? '-'}
          </p>
        </div>

        <p className="mt-6 text-sm text-slate-500">
          Le funzionalità della piattaforma verranno aggiunte nelle prossime fasi
          (vedi <code>docs/piano-implementazione.md</code>).
        </p>
      </div>
    </div>
  );
}
