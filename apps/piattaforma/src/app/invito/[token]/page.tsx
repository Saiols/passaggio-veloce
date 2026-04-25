import { prisma } from '@pv/db';
import { AcceptForm } from './accept-form';

export default async function InvitoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { company: { select: { ragioneSociale: true } } },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-pv-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-pv-slate-200 bg-white p-8 shadow-sm">
        {!invitation ? (
          <ErrorBox message="Invito non trovato." />
        ) : invitation.status !== 'PENDING' ? (
          <ErrorBox message={`Invito ${labelStatus(invitation.status)}.`} />
        ) : invitation.expiresAt < new Date() ? (
          <ErrorBox message="Invito scaduto." />
        ) : (
          <>
            <h1 className="text-2xl font-extrabold text-pv-navy-900">
              Benvenuto in {invitation.company.ragioneSociale}
            </h1>
            <p className="mt-1 text-sm text-pv-slate-500">
              Imposta nome, cognome e password per attivare il tuo account.
            </p>
            <p className="mt-2 text-xs text-pv-slate-500">
              Email: <strong>{invitation.email}</strong>
            </p>
            <AcceptForm token={token} />
          </>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-pv-red-50 border border-pv-red-500 p-4 text-sm text-pv-red-500">
      {message} <a href="/login" className="underline">Vai al login</a>
    </div>
  );
}

function labelStatus(s: string): string {
  return ({ ACCEPTED: 'già accettato', REVOKED: 'revocato', EXPIRED: 'scaduto' } as Record<string, string>)[s] ?? s;
}
