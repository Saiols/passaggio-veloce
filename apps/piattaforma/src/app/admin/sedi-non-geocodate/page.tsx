import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function SediNonGeocodatePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/sedi-non-geocodate">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin piattaforma possono consultare le sedi non geocodate.
          </Alert>
        </div>
      </AppShell>
    );
  }

  // Sedi AGENZIA attive (non sospese, non cancellate) senza coordinate: il
  // motore di distribuzione a raggio le esclude in silenzio, quindi non
  // ricevono mai nuove pratiche finché non vengono geocodate.
  const sedi = await prisma.sede.findMany({
    where: {
      type: 'AGENZIA',
      deletedAt: null,
      suspendedAt: null,
      OR: [{ lat: null }, { lng: null }],
    },
    select: {
      id: true,
      nome: true,
      citta: true,
      provincia: true,
      company: { select: { ragioneSociale: true } },
    },
    orderBy: [{ provincia: 'asc' }, { citta: 'asc' }],
    take: 500,
  });

  return (
    <AppShell session={session} activePath="/admin/sedi-non-geocodate">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Sedi senza coordinate
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-pv-slate-500">
            Queste agenzie non hanno coordinate geografiche e quindi <strong>non ricevono nuove
            pratiche</strong> (la distribuzione è a raggio dalla sede del broker). Aggiornane
            l&apos;indirizzo o rilancia il geocoding.
          </p>
        </header>

        {sedi.length === 0 ? (
          <Alert variant="success" title="Tutto geocodato">
            Nessuna sede agenzia attiva è priva di coordinate.
          </Alert>
        ) : (
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2.5">Azienda</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Sede</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Città</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Prov.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
                  {sedi.map((s) => (
                    <tr key={s.id} className="hover:bg-pv-slate-50">
                      <td className="px-3 py-2.5 font-semibold text-pv-navy-900">
                        {s.company.ragioneSociale}
                      </td>
                      <td className="px-3 py-2.5">{s.nome}</td>
                      <td className="px-3 py-2.5">{s.citta}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{s.provincia}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
