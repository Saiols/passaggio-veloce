import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { canViewAggregatedFinancials } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { flagLabel, type CollusionFlag } from '@/lib/affiliazione/check-util';
import { SospetteClient } from './client';

export default async function SospettePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewAggregatedFinancials(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/affiliazioni">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin piattaforma possono revisionare le commissioni
            sospette.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const commissioni = await prisma.commissioneAffiliazione.findMany({
    where: { stato: 'DA_REVISIONARE' },
    orderBy: { createdAt: 'desc' },
    include: {
      pratica: {
        select: {
          id: true,
          codicePratica: true,
          targa: true,
          brokerId: true,
          agenziaAssegnataId: true,
          tipo: true,
        },
      },
      referente: {
        select: {
          id: true,
          ragioneSociale: true,
          type: true,
        },
      },
    },
  });

  // Hydrate referral company per ogni commissione (broker o agenzia in
  // base a tipo) per mostrarne ragione sociale + ulteriori dettagli.
  const referralIds = Array.from(
    new Set(
      commissioni
        .map((c): string | null =>
          c.tipo === 'REFERENTE_BROKER'
            ? c.pratica.brokerId
            : c.pratica.agenziaAssegnataId,
        )
        .filter((id): id is string => id !== null),
    ),
  );
  const referrals = referralIds.length
    ? await prisma.company.findMany({
        where: { id: { in: referralIds } },
        select: {
          id: true,
          ragioneSociale: true,
          type: true,
          email: true,
          iban: true,
          signupIp: true,
        },
      })
    : [];
  const refMap = new Map(referrals.map((r) => [r.id, r]));

  const items = commissioni.map((c) => {
    const referralId =
      c.tipo === 'REFERENTE_BROKER'
        ? c.pratica.brokerId
        : c.pratica.agenziaAssegnataId;
    const referral = referralId ? refMap.get(referralId) : undefined;
    const flags = (c.flagsDetected?.split(',').filter(Boolean) ??
      []) as CollusionFlag[];
    return {
      id: c.id,
      praticaCodice: c.pratica.codicePratica ?? c.pratica.id.slice(0, 8),
      praticaTarga: c.pratica.targa,
      referenteRagioneSociale: c.referente.ragioneSociale,
      referenteTipo: c.referente.type,
      referralRagioneSociale: referral?.ragioneSociale ?? '—',
      referralTipo: referral?.type ?? null,
      importoCent: c.importoNettoCent,
      flags,
      flagsLabels: flags.map((f) => flagLabel(f)),
      createdAtIso: c.createdAt.toISOString(),
      createdAtLabel: formatDate(c.createdAt),
    };
  });

  return (
    <AppShell session={session} activePath="/admin/affiliazioni">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · Affiliazioni
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Commissioni sospette
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Commissioni di affiliazione bloccate dal check anti-collusione.
            Approva per accreditare il wallet o rifiuta per annullare.
          </p>
          <Link
            href="/admin/affiliazioni"
            className="mt-3 inline-flex items-center text-[12px] font-semibold text-pv-navy-700 hover:underline"
          >
            ← Torna alla dashboard affiliazione
          </Link>
        </header>

        {items.length === 0 ? (
          <div className="rounded-[12px] border border-pv-slate-200 bg-white px-4 py-12 text-center text-[13px] text-pv-slate-500">
            ✅ Nessuna commissione sospetta da revisionare.
          </div>
        ) : (
          <SospetteClient items={items} totale={items.length} />
        )}
      </div>
    </AppShell>
  );
}

