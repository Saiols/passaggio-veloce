import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { suspendSedeAction, reactivateSedeAction } from '../actions';

export default async function SedeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') redirect('/dashboard');
  const companyId = session.user.companyId!;

  const sede = await prisma.sede.findFirst({
    where: { id, companyId, deletedAt: null },
  });
  if (!sede) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = sede.referralCode ? `${appUrl}/r/${sede.referralCode}` : null;

  return (
    <AppShell session={session} activePath="/sedi">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6 sm:py-10">
        <Link href="/sedi" className="text-[13px] font-semibold text-pv-navy-600 hover:underline">
          ← Tutte le sedi
        </Link>

        <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              {sede.nome}
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              {sede.type === 'AGENZIA' ? 'Agenzia' : 'Broker / Dealer'} · creata{' '}
              {formatDate(sede.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {sede.suspendedAt ? (
              <span className="rounded-full bg-pv-red-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-red-600">
                Sospesa
              </span>
            ) : (
              <span className="rounded-full bg-pv-green-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-green-600">
                Attiva
              </span>
            )}
            <form
              action={async () => {
                'use server';
                if (sede.suspendedAt) await reactivateSedeAction(sede.id);
                else await suspendSedeAction(sede.id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                {sede.suspendedAt ? 'Riattiva' : 'Sospendi'}
              </button>
            </form>
          </div>
        </header>

        <Card className="mb-5">
          <h2 className="mb-4 text-[15px] font-bold text-pv-navy-800">Anagrafica</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="Nome sede" value={sede.nome} />
            <Row label="Indirizzo" value={[sede.indirizzo, sede.civico].filter(Boolean).join(', ')} />
            <Row label="Città" value={`${sede.citta} (${sede.provincia})`} />
            <Row label="CAP" value={sede.cap} />
            <Row label="Telefono" value={sede.telefono ?? '—'} />
            <Row label="Email operativa" value={sede.email ?? '—'} />
            <Row label="Codice interno" value={sede.codiceInterno ?? '—'} />
          </dl>
        </Card>

        <Card className="mb-5">
          <h2 className="mb-4 text-[15px] font-bold text-pv-navy-800">Pagamenti</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row
              label="IBAN"
              value={sede.iban ?? 'Usa l’IBAN aziendale (madre)'}
            />
            <Row
              label="Soglia payout automatico"
              value={formatCurrencyCent(sede.payoutThresholdCent)}
            />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-2 text-[15px] font-bold text-pv-navy-800">Affiliazione</h2>
          <p className="text-[12.5px] text-pv-slate-500">
            Link di affiliazione di questa sede. Le iscrizioni tramite questo link vengono attribuite
            alla sede; la commissione va all’azienda madre.
          </p>
          <code className="mt-3 block truncate rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
            {link ?? 'Codice referral non disponibile'}
          </code>
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[14px] text-pv-navy-900">{value}</dd>
    </div>
  );
}
