import Link from 'next/link';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Accedi</h2>
        <p className="mt-1 text-sm text-slate-600">
          Inserisci le tue credenziali per accedere alla piattaforma.
        </p>
      </div>

      <LoginForm />

      <div className="space-y-2 text-center text-sm text-slate-600">
        <p>
          Non hai un account?{' '}
          <Link href="/register" className="font-medium text-blue-600 hover:underline">
            Registra la tua azienda
          </Link>
        </p>
        <p>
          <Link
            href="/reset-password"
            className="font-medium text-blue-600 hover:underline"
          >
            Password dimenticata?
          </Link>
        </p>
      </div>
    </div>
  );
}
