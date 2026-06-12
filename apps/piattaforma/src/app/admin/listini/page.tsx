import { notFound } from 'next/navigation';

// ============================================================================
// LISTINI DISABILITATI (feature nascosta 2026-06-12)
// Route /admin/listini resa non invocabile: restituisce 404 (notFound).
// Tutto il codice originale è conservato commentato qui sotto: per riattivare,
// rimuovere lo stub seguente e questo wrapper di commento.
// ============================================================================
export default function AdminListiniPage() {
  notFound();
}

/* ===== CODICE ORIGINALE (riattivare) =======================================
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, StatCard } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatCurrencyCent } from '@/lib/format';
import { statsAllProvincie } from '@/lib/listini/observatory';

export default async function AdminListiniPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/listini">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono consultare l&apos;osservatorio.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const [stats, totaleListini, listiniStrutturati, listiniUpload] = await Promise.all([
    statsAllProvincie(),
    prisma.listino.count(),
    prisma.listino.count({ where: { formato: 'FORM_STRUTTURATO' } }),
    prisma.listino.count({ where: { formato: 'UPLOAD_FILE' } }),
  ]);

  const totaleProvince = stats.length;
  const trapassiTotali = stats.reduce((s, p) => s + (p.trapasso?.count ?? 0), 0);
  const minivolTotali = stats.reduce((s, p) => s + (p.minivoltura?.count ?? 0), 0);

  return (
    <AppShell session={session} activePath="/admin/listini">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Osservatorio Prezzi
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Aggregati per provincia delle tariffe agenzie. Mostrati solo
            in forma aggregata: i prezzi delle singole agenzie restano
            confidenziali.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Listini pubblicati" value={totaleListini} accent="navy" />
          <StatCard
            label="Strutturati"
            value={listiniStrutturati}
            hint="Form analitico"
            accent="navy"
          />
          <StatCard
            label="Upload PDF/img"
            value={listiniUpload}
            hint="File grezzo"
            accent="slate"
          />
          <StatCard
            label="Province coperte"
            value={totaleProvince}
            accent="green"
          />
        </div>

        {stats.length === 0 ? (
          <div className="rounded-[12px] border border-pv-slate-200 bg-white px-4 py-12 text-center text-[13px] text-pv-slate-500">
            Nessun listino strutturato pubblicato. L&apos;osservatorio mostrerà
            dati appena le agenzie inizieranno a pubblicare i loro prezzi
            da <span className="font-semibold">/profilo/listino</span>.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
            <table className="w-full text-[13px]">
              <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="px-5 py-3" rowSpan={2}>
                    Provincia
                  </th>
                  <th className="px-5 py-3 text-center" colSpan={4}>
                    Trapasso netto
                  </th>
                  <th className="px-5 py-3 text-center" colSpan={4}>
                    Minivoltura
                  </th>
                </tr>
                <tr>
                  <th className="px-3 py-1 text-right">N</th>
                  <th className="px-3 py-1 text-right">Min</th>
                  <th className="px-3 py-1 text-right">Media</th>
                  <th className="px-3 py-1 text-right">Max</th>
                  <th className="px-3 py-1 text-right">N</th>
                  <th className="px-3 py-1 text-right">Min</th>
                  <th className="px-3 py-1 text-right">Media</th>
                  <th className="px-3 py-1 text-right">Max</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-200">
                {stats.map((p) => (
                  <tr key={p.provincia} className="hover:bg-pv-slate-50">
                    <td className="px-5 py-3 font-bold text-pv-navy-900">
                      {p.provincia}
                    </td>
                    <StatCells stat={p.trapasso} />
                    <StatCells stat={p.minivoltura} />
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-pv-slate-50 text-[11.5px] text-pv-slate-500">
                <tr>
                  <td className="px-5 py-2" colSpan={9}>
                    Totale rilevazioni: {trapassiTotali} trapassi · {minivolTotali} minivolture
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCells({
  stat,
}: {
  stat: { count: number; mediaCent: number; minCent: number; maxCent: number } | null;
}) {
  if (!stat) {
    return (
      <>
        <td className="px-3 py-3 text-right text-pv-slate-300">—</td>
        <td className="px-3 py-3 text-right text-pv-slate-300">—</td>
        <td className="px-3 py-3 text-right text-pv-slate-300">—</td>
        <td className="px-3 py-3 text-right text-pv-slate-300">—</td>
      </>
    );
  }
  return (
    <>
      <td className="px-3 py-3 text-right text-pv-slate-700">{stat.count}</td>
      <td className="px-3 py-3 text-right text-pv-slate-700">
        {formatCurrencyCent(stat.minCent)}
      </td>
      <td className="px-3 py-3 text-right font-bold text-pv-navy-900">
        {formatCurrencyCent(stat.mediaCent)}
      </td>
      <td className="px-3 py-3 text-right text-pv-slate-700">
        {formatCurrencyCent(stat.maxCent)}
      </td>
    </>
  );
}
============================================================================ */
