import Link from 'next/link';
import { verifyEmailAction } from '../actions';

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Verifica email</h2>
        <p className="text-sm text-slate-600">Token mancante nel link.</p>
      </div>
    );
  }

  const result = await verifyEmailAction(token);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">Verifica email</h2>
      {result.ok ? (
        <>
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Email verificata con successo. Il tuo account è ora attivo.
          </div>
          <Link
            href="/login"
            className="block w-full rounded-md bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
          >
            Vai al login
          </Link>
        </>
      ) : (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {result.error}
        </div>
      )}
    </div>
  );
}
