import { ResetForm } from './reset-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-pv-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-pv-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-extrabold text-pv-navy-900">
          {token ? 'Imposta nuova password' : 'Password dimenticata?'}
        </h1>
        <p className="mt-1 text-sm text-pv-slate-500">
          {token
            ? 'Inserisci la nuova password (min 10 caratteri, maiuscola, minuscola, numero).'
            : 'Inserisci la tua email — ti invieremo un link per reimpostare la password.'}
        </p>
        <ResetForm token={token ?? null} />
      </div>
    </div>
  );
}
