import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { formatDate } from '@/lib/format';

export default async function ProfiloPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id!;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: true },
  });

  if (!user) {
    return (
      <AppShell session={session} activePath="/profilo">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="error">Utente non trovato.</Alert>
        </div>
      </AppShell>
    );
  }

  const company = user.company;

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Account
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Profilo
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Dati personali e aziendali. L&apos;admin azienda può modificare i
            dati dell&apos;azienda dalla sezione dedicata.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-bold text-pv-navy-800">Utente</h2>
              <Link
                href="/profilo/personale"
                className="rounded-[8px] border border-pv-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Modifica
              </Link>
            </div>
            <dl className="mt-4 space-y-3 text-[13px]">
              <InfoRow label="Nome" value={`${user.nome} ${user.cognome}`} />
              <InfoRow label="Email" value={user.email} />
              <InfoRow label="Ruolo" value={labelRole(user.role)} />
              <InfoRow label="Codice fiscale" value={user.codiceFiscale} mono />
              <InfoRow label="Data nascita" value={formatDate(user.dataNascita)} />
              <InfoRow label="Luogo nascita" value={user.luogoNascita} />
              <InfoRow label="Ultimo accesso" value={formatDate(user.lastLoginAt)} />
              <InfoRow
                label="Stato"
                value={user.status === 'ACTIVE' ? 'Attivo' : user.status}
              />
            </dl>
          </Card>

          {company ? (
            <Card>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[15px] font-bold text-pv-navy-800">
                  Azienda · {labelCompanyType(company.type)}
                </h2>
                {user.role === 'ADMIN_AZIENDA' && (
                  <Link
                    href="/profilo/azienda"
                    className="rounded-[8px] border border-pv-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                  >
                    Modifica
                  </Link>
                )}
              </div>
              <dl className="mt-4 space-y-3 text-[13px]">
                <InfoRow label="Ragione sociale" value={company.ragioneSociale} />
                <InfoRow label="Partita IVA" value={company.partitaIva} mono />
                <InfoRow label="Codice SDI" value={company.codiceSdi} mono />
                <InfoRow label="PEC" value={company.pec} />
                <InfoRow label="Email aziendale" value={company.email} />
                <InfoRow label="Telefono" value={company.telefono} />
                <InfoRow
                  label="Sede"
                  value={`${company.indirizzo}, ${company.citta} ${company.cap} (${company.provincia})`}
                />
                <InfoRow label="IBAN" value={company.iban} mono />
                <InfoRow
                  label="Mandato SEPA"
                  value={
                    company.sepaMandateAccepted
                      ? `Accettato ${formatDate(company.sepaMandateAcceptedAt)}`
                      : 'Non accettato'
                  }
                />
                <InfoRow
                  label="T&C"
                  value={
                    company.termsAcceptedAt
                      ? `Accettati ${formatDate(company.termsAcceptedAt)}`
                      : 'Non accettati'
                  }
                />
              </dl>
            </Card>
          ) : (
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Azienda</h2>
              <p className="mt-3 text-[13px] text-pv-slate-500">
                Questo account non è associato a un&apos;azienda.
              </p>
            </Card>
          )}

          {company?.type === 'AGENZIA' && (
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold text-pv-navy-800">
                    Listino prezzi
                  </h2>
                  <p className="mt-1 text-[12.5px] text-pv-slate-500">
                    Pubblica i tuoi prezzi base e contribuisci all&apos;Osservatorio.
                  </p>
                </div>
                <Link
                  href="/profilo/listino"
                  className="rounded-[8px] border border-pv-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                >
                  Gestisci
                </Link>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-pv-navy-800">
                  Sicurezza account
                </h2>
                <p className="mt-1 text-[12.5px] text-pv-slate-500">
                  Autenticazione a due fattori (TOTP), password.
                </p>
              </div>
              <Link
                href="/profilo/sicurezza"
                className="rounded-[8px] border border-pv-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Gestisci
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right text-pv-slate-900 ${mono ? 'font-mono text-[12px]' : ''}`}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function labelRole(r: string): string {
  if (r === 'ADMIN_AZIENDA') return 'Amministratore azienda';
  if (r === 'UTENTE_AZIENDA') return 'Utente azienda';
  if (r === 'ADMIN_PIATTAFORMA') return 'Admin piattaforma';
  return r;
}

function labelCompanyType(t: string): string {
  if (t === 'DEALER') return 'Dealer / commerciante';
  if (t === 'AGENZIA') return 'Agenzia pratiche auto';
  return t;
}
