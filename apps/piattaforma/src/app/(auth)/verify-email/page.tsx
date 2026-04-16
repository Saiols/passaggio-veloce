import Link from 'next/link';
import { Alert, Button } from '@/components/ui';
import { verifyEmailAction } from '../actions';

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { token } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-12 sm:px-6 sm:py-16">
      <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        Verifica
      </p>
      <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
        Conferma email
      </h1>

      <div className="mt-6 space-y-4">
        {!token && <Alert variant="error">Token mancante nel link.</Alert>}
        {token && <VerifyResult token={token} />}
      </div>
    </div>
  );
}

async function VerifyResult({ token }: { token: string }) {
  const result = await verifyEmailAction(token);

  if (result.ok) {
    return (
      <>
        <Alert variant="success">
          Email verificata con successo. Il tuo account è ora attivo.
        </Alert>
        <Link href="/login" className="block">
          <Button fullWidth>Vai al login</Button>
        </Link>
      </>
    );
  }

  return <Alert variant="error">{result.error}</Alert>;
}
