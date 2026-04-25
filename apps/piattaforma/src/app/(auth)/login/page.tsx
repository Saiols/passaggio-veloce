import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; invited?: string }>;
}) {
  const { reset, invited } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-12 sm:px-6 sm:py-16">
      {reset === 'success' && (
        <div className="mb-4 rounded-lg bg-pv-green-50 border border-pv-green-500 p-3 text-sm text-pv-navy-900">
          ✅ Password reimpostata. Ora puoi accedere.
        </div>
      )}
      {invited === 'success' && (
        <div className="mb-4 rounded-lg bg-pv-green-50 border border-pv-green-500 p-3 text-sm text-pv-navy-900">
          ✅ Account attivato. Accedi con la tua nuova password.
        </div>
      )}
      <LoginForm />
    </div>
  );
}
