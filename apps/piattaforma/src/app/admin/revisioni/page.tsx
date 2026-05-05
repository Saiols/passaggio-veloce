import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatRelative } from '@/lib/format';
import { ChiudiRevisioneForm } from './chiudi-form';

const MOTIVO_LABEL: Record<string, string> = {
  DOCUMENTO_NON_STANDARD: 'Documento non standard',
  CASO_NON_PREVISTO_DA_SCHEMA: 'Caso non previsto dallo schema',
  RICHIESTA_BROKER: 'Richiesta esplicita del broker',
};

export default async function AdminRevisioniPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/revisioni">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione revisioni manuali è riservata all&apos;Admin
            piattaforma.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const pratiche = await prisma.pratica.findMany({
    where: {
      richiedeRevisioneManuale: true,
      revisioneCompletata: false,
    },
    orderBy: { createdAt: 'asc' },
    include: {
      broker: {
        select: {
          id: true,
          ragioneSociale: true,
          email: true,
          telefono: true,
        },
      },
    },
  });

  return (
    <AppShell session={session} activePath="/admin/revisioni">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · Schema Documentale v7
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Revisioni manuali
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Pratiche per cui il broker ha richiesto un controllo manuale del
            team (caso non riconosciuto dall&apos;engine documentale).
            Risposta attesa entro 24-48 ore.
          </p>
        </header>

        {pratiche.length === 0 ? (
          <Alert variant="success" title="Nessuna revisione attiva">
            Tutte le revisioni manuali sono state chiuse.
          </Alert>
        ) : (
          <div className="space-y-4">
            {pratiche.map((p) => (
              <Card
                key={p.id}
                className="border-pv-amber-500/40 bg-pv-amber-50/40"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/pratiche/${p.id}`}
                      className="font-mono text-[14px] font-bold text-pv-navy-700 hover:underline"
                    >
                      {p.codicePratica ?? '(bozza)'}
                    </Link>
                    {p.targa && (
                      <span className="ml-2 text-[12px] text-pv-slate-500">
                        {p.targa}
                      </span>
                    )}
                    <p className="mt-1 text-[12px] text-pv-slate-700">
                      <strong>Motivo:</strong>{' '}
                      <span className="rounded-full bg-pv-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-amber-500">
                        {MOTIVO_LABEL[p.motivoRevisione ?? ''] ?? '—'}
                      </span>
                    </p>
                    {p.noteRevisione && (
                      <p className="mt-2 whitespace-pre-wrap rounded-[10px] border border-pv-slate-200 bg-white px-3 py-2 text-[12.5px] italic text-pv-slate-700">
                        {p.noteRevisione}
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-pv-slate-500">
                      Broker:{' '}
                      <Link
                        href={`/admin/companies/${p.broker.id}`}
                        className="font-semibold text-pv-navy-700 hover:underline"
                      >
                        {p.broker.ragioneSociale}
                      </Link>{' '}
                      · {p.broker.email}
                      {p.broker.telefono ? ` · ${p.broker.telefono}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-pv-slate-500">
                      Richiesta {formatRelative(p.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 border-t border-pv-amber-500/30 pt-3">
                  <ChiudiRevisioneForm praticaId={p.id} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
