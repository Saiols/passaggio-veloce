import Link from 'next/link';

export default function ResetPasswordPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">Recupero password</h2>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Il flusso di reset password sarà attivato in Fase 6 quando avremo configurato
        l&apos;email transazionale (Resend). Per ora contatta il supporto.
      </div>
      <Link
        href="/login"
        className="block w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Torna al login
      </Link>
    </div>
  );
}
