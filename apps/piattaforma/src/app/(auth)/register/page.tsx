import Link from 'next/link';
import { RegisterWizard } from './register-wizard';

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Registra la tua azienda</h2>
        <p className="mt-1 text-sm text-slate-600">
          Solo aziende. La registrazione è gratuita e l&apos;account è subito attivo.
        </p>
      </div>

      <RegisterWizard />

      <p className="text-center text-sm text-slate-600">
        Hai gia un account?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Accedi
        </Link>
      </p>
    </div>
  );
}
