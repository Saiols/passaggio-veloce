import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import {
  parseGiustificativoFiltri,
  giustificativoWhere,
} from '@/lib/fatturazione/giustificativo-filtri';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

export const dynamic = 'force-dynamic';

export default async function CostiPromozionaliPage({
  searchParams,
}: {
  searchParams: Promise<{ dataDa?: string; dataA?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/costi-promozionali">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin piattaforma possono consultare i costi promozionali.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const filtri = parseGiustificativoFiltri(sp);
  const where = giustificativoWhere(filtri);

  const [docs, aggregato] = await Promise.all([
    prisma.giustificativoInterno.findMany({ where, orderBy: { emessoAt: 'desc' }, take: 200 }),
    prisma.giustificativoInterno.aggregate({
      where,
      _sum: { importoCent: true },
      _count: { _all: true },
    }),
  ]);

  // Query-string per "Esporta CSV": usa i filtri già normalizzati/validati
  // (non i raw searchParams) così il link non porta mai valori sporchi.
  const exportQs = new URLSearchParams(
    Object.entries({ dataDa: filtri.dataDa, dataA: filtri.dataA }).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  ).toString();

  return (
    <AppShell session={session} activePath="/admin/costi-promozionali">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Costi promozionali
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-pv-slate-500">
            Giustificativi interni dei bonus promozionali erogati nei payout (art. 108 TUIR).
            Documenti non fiscali, non trasmessi allo SdI.
          </p>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
          <StatCard label="Giustificativi" value={aggregato._count._all} />
          <StatCard label="Totale costo" value={formatCurrencyCent(aggregato._sum.importoCent ?? 0)} />
        </div>

        <form
          className="mb-5 flex flex-wrap items-end gap-2"
          action="/admin/costi-promozionali"
          method="get"
        >
          <label className="flex items-center gap-1 text-[12px] text-pv-slate-500">
            Dal
            <input
              type="date"
              name="dataDa"
              defaultValue={filtri.dataDa ?? ''}
              className="rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-2 py-2 text-[13px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[12px] text-pv-slate-500">
            Al
            <input
              type="date"
              name="dataA"
              defaultValue={filtri.dataA ?? ''}
              className="rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-2 py-2 text-[13px]"
            />
          </label>
          <button
            type="submit"
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Filtra
          </button>
          {(filtri.dataDa || filtri.dataA) && (
            <Link
              href="/admin/costi-promozionali"
              className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-pv-slate-600 hover:bg-pv-slate-50"
            >
              Azzera
            </Link>
          )}
          <a
            href={`/api/admin/costi-promozionali/export${exportQs ? `?${exportQs}` : ''}`}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            Esporta CSV
          </a>
        </form>

        {docs.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[14px] text-pv-slate-500">
              Nessun costo promozionale nel periodo selezionato.
            </p>
          </Card>
        ) : (
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2.5">Data</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Numero</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Beneficiario</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Codici promo</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">Importo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
                  {docs.map((d) => {
                    const b = d.datiBeneficiario as unknown as DatiFiscali;
                    const righe = (d.righe as unknown as { code: string }[]) ?? [];
                    return (
                      <tr key={d.id} className="hover:bg-pv-slate-50">
                        <td className="whitespace-nowrap px-3 py-2.5">{formatDate(d.emessoAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-pv-navy-900">
                          {d.numeroStr}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="max-w-[220px] truncate" title={b?.ragioneSociale ?? ''}>
                            {b?.ragioneSociale ?? '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{righe.map((r) => r.code).join(', ') || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-pv-navy-900">
                          {formatCurrencyCent(d.importoCent)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
