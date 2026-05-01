import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatDate, formatRelative } from '@/lib/format';
import { CreateAssistenteForm } from './create-form';
import { SuspendButton } from '../suspend-button';

export default async function AdminAssistentiPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/assistenti">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione degli assistenti è riservata all&apos;Admin
            piattaforma.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const assistenti = await prisma.user.findMany({
    where: { role: 'ASSISTENTE', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      nome: true,
      cognome: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return (
    <AppShell session={session} activePath="/admin/assistenti">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Assistenti
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Account operativi con accesso a pratiche, anagrafiche, wallet,
            catalogo contatti ed escalation. Non vedono la dashboard
            finanziaria aggregata (riservata a te).
          </p>
        </header>

        <Card className="mb-6">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Crea nuovo assistente
          </h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Imposti tu email e password iniziale. Comunichi le credenziali
            all&apos;assistente fuori piattaforma. L&apos;account è attivo da
            subito.
          </p>
          <CreateAssistenteForm />
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Assistenti esistenti ({assistenti.length})
          </h2>
          {assistenti.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Nessun assistente ancora creato.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-pv-slate-100">
              {assistenti.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-pv-navy-900">
                      {a.nome} {a.cognome}
                      {a.status === 'SUSPENDED' && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500">
                          Sospeso
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-pv-slate-500">
                      {a.email} · creato {formatDate(a.createdAt)}
                      {a.lastLoginAt
                        ? ` · ultimo accesso ${formatRelative(a.lastLoginAt)}`
                        : ' · mai entrato'}
                    </p>
                  </div>
                  <SuspendButton
                    target={{ kind: 'user', id: a.id }}
                    suspended={a.status === 'SUSPENDED'}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
