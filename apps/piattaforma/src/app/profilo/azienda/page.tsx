import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { CompanyEditForm } from '@/components/company-edit-form';
import { updateCompanyProfileAction } from './actions';

export default async function ModificaProfiloAziendalePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') redirect('/profilo');
  const companyId = session.user.companyId;
  if (!companyId) redirect('/profilo');

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) redirect('/profilo');

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Profilo azienda
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Modifica dati azienda
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Aggiorna i dati di {company.ragioneSociale}. La P.IVA non è
            modificabile da qui — contatta il supporto in caso di necessità.
          </p>
        </header>

        <Alert variant="info" className="mb-5">
          Le modifiche sono effettive da subito sui prossimi documenti generati
          (fatture, mandati, mail). I documenti già emessi mantengono i dati
          al momento dell&apos;emissione.
        </Alert>

        <Card>
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
            }}
            action={updateCompanyProfileAction}
            cancelHref="/profilo"
          />
        </Card>
      </div>
    </AppShell>
  );
}
