import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900">
          Passaggio Veloce
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Broker digitale per i passaggi di proprietà di veicoli in Italia.
          Connettiamo dealer e agenzie pratiche auto in modo semplice e veloce.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="rounded-md bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            Accedi
          </Link>
          <Link
            href="/register"
            className="rounded-md border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Registra la tua azienda
          </Link>
        </div>
      </div>
    </main>
  );
}
