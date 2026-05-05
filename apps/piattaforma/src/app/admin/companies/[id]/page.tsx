import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { CompanyEditForm } from '@/components/company-edit-form';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatDate, formatRelative } from '@/lib/format';
import { updateCompanyAdminAction } from '../actions';
import { SuspendButton } from '../../suspend-button';

export default async function AdminCompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) redirect('/dashboard');

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      users: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      wallet: true,
      referente: { select: { id: true, ragioneSociale: true } },
      _count: {
        select: {
          praticheCreate: true,
          praticheAssegnate: true,
          referrals: true,
          commissioniGenerate: true,
        },
      },
    },
  });

  if (!company || company.deletedAt) notFound();

  const tipoLabel = company.type === 'DEALER' ? 'Broker' : 'Agenzia';
  const listaHref = company.type === 'DEALER' ? '/admin/broker' : '/admin/agenzie';
  const numPratiche =
    company.type === 'DEALER'
      ? company._count.praticheCreate
      : company._count.praticheAssegnate;

  // Action bound al companyId — il form è generico e accetta una funzione.
  const updateBound = updateCompanyAdminAction.bind(null, company.id);

  return (
    <AppShell session={session} activePath={listaHref}>
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href={listaHref}
          className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← {tipoLabel === 'Broker' ? 'Tutti i broker' : 'Tutte le agenzie'}
        </Link>

        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              {tipoLabel}
            </p>
            <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              <span>{company.ragioneSociale}</span>
              {company.suspendedAt && (
                <span className="inline-flex items-center rounded-full bg-pv-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-red-500">
                  Sospesa admin
                </span>
              )}
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              P.IVA <span className="font-mono">{company.partitaIva}</span> ·
              iscritta {formatDate(company.createdAt)}
              {company.referente && (
                <>
                  {' · '}referente:{' '}
                  <Link
                    href={`/admin/companies/${company.referente.id}`}
                    className="font-semibold text-pv-navy-700 hover:underline"
                  >
                    {company.referente.ragioneSociale}
                  </Link>
                </>
              )}
            </p>
          </div>
          <SuspendButton
            target={{ kind: 'company', id: company.id }}
            suspended={company.suspendedAt !== null}
          />
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Utenti aziendali" value={company.users.length} accent="navy" />
          <StatCard label="Pratiche" value={numPratiche} accent="navy" />
          <StatCard
            label="Wallet"
            value={formatCurrencyCent(company.wallet?.saldoCent ?? 0)}
            accent="green"
          />
          <StatCard
            label="Referrals portati"
            value={company._count.referrals}
            accent="orange"
          />
        </div>

        {company.suspendedAt && (
          <div className="mb-5">
            <Alert variant="warning" title="Azienda sospesa">
              Tutti gli utenti aziendali hanno status SUSPENDED e non possono
              accedere. Riattiva dall&apos;header per ripristinarli in massa.
            </Alert>
          </div>
        )}

        <Card className="mb-6">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Dati aziendali
          </h2>
          <p className="mt-1 mb-4 text-[12.5px] text-pv-slate-500">
            P.IVA non modificabile da qui (richiede flow legale dedicato).
          </p>
          <CompanyEditForm
            defaults={{
              ragioneSociale: company.ragioneSociale,
              codiceSdi: company.codiceSdi,
              pec: company.pec,
              email: company.email,
              telefono: company.telefono,
              indirizzo: company.indirizzo,
              citta: company.citta,
              cap: company.cap,
              provincia: company.provincia,
              iban: company.iban,
              payoutThresholdCent: company.payoutThresholdCent,
            }}
            action={updateBound}
            cancelHref={listaHref}
            successMessage="Dati aziendali aggiornati."
            showPayoutThreshold={session.user.role === 'ADMIN_PIATTAFORMA'}
          />
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Utenti aziendali ({company.users.length})
          </h2>
          {company.users.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Nessun utente associato.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-pv-slate-100 text-[13px]">
              {company.users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-pv-navy-900">
                      {u.nome} {u.cognome}
                      {u.role === 'ADMIN_AZIENDA' && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-pv-navy-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-navy-700">
                          Admin
                        </span>
                      )}
                      {u.status === 'SUSPENDED' && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500">
                          Sospeso
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-pv-slate-500">
                      {u.email}
                      {u.lastLoginAt
                        ? ` · ultimo accesso ${formatRelative(u.lastLoginAt)}`
                        : ' · mai entrato'}
                    </p>
                  </div>
                  <SuspendButton
                    target={{ kind: 'user', id: u.id }}
                    suspended={u.status === 'SUSPENDED'}
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
