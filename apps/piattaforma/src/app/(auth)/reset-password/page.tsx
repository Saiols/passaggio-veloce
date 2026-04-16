import Link from 'next/link';
import { Alert, Button } from '@/components/ui';

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-12 sm:px-6 sm:py-16">
      <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        Account
      </p>
      <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
        Recupero password
      </h1>

      <div className="mt-6 space-y-4">
        <Alert variant="warning" title="Disponibile in Fase 6">
          Il flusso di reset password sarà attivato quando avremo configurato
          l&apos;email transazionale (Resend). Per ora contatta il supporto.
        </Alert>
        <Link href="/login" className="block">
          <Button variant="secondary" fullWidth>
            Torna al login
          </Button>
        </Link>
      </div>
    </div>
  );
}
