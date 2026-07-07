import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getOperatingSede, getSedeRole } from '@/lib/auth/session-context';
import { canEditSedeSettings } from '@/lib/sedi/scope';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { SedeEdit } from '../sedi/[id]/sede-edit';

export default async function ImpostazioniSedePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const sede = await getOperatingSede();
  if (!sede) {
    return (
      <AppShell session={session} activePath="/impostazioni-sede">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Seleziona una sede dal menù in alto per gestirne le impostazioni.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) redirect('/dashboard');

  const row = await prisma.sede.findFirst({ where: { id: sede.id, deletedAt: null } });
  if (!row) redirect('/dashboard');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = row.referralCode ? `${appUrl}/r/${row.referralCode}` : null;

  return (
    <AppShell session={session} activePath="/impostazioni-sede">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Sede</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Impostazioni sede
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Gestisci anagrafica, IBAN e soglia payout di {row.nome}.
          </p>
        </header>

        <SedeEdit
          sedeId={row.id}
          data={{
            nome: row.nome,
            indirizzo: row.indirizzo,
            civico: row.civico ?? '',
            citta: row.citta,
            cap: row.cap,
            provincia: row.provincia,
            telefono: row.telefono ?? '',
            email: row.email ?? '',
            codiceInterno: row.codiceInterno ?? '',
            iban: row.iban ?? '',
            payoutThresholdCent: row.payoutThresholdCent,
          }}
        />

        {row.type === 'AGENZIA' && (
          <Card className="mb-5">
            <h2 className="mb-2 text-[15px] font-bold text-pv-navy-800">Orari di apertura</h2>
            <p className="text-[12.5px] text-pv-slate-500">
              Gli orari di apertura di questa sede si gestiscono nella pagina dedicata.
            </p>
            <Link
              href="/orari"
              className="mt-3 inline-block text-[13px] font-semibold text-pv-navy-600 hover:underline"
            >
              Vai agli orari →
            </Link>
          </Card>
        )}

        <Card>
          <h2 className="mb-2 text-[15px] font-bold text-pv-navy-800">Affiliazione</h2>
          <p className="text-[12.5px] text-pv-slate-500">
            Link di affiliazione di questa sede. Le iscrizioni tramite questo link vengono
            attribuite alla sede; la commissione va all’azienda madre.
          </p>
          <code className="mt-3 block truncate rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
            {link ?? 'Codice referral non disponibile'}
          </code>
        </Card>
      </div>
    </AppShell>
  );
}
