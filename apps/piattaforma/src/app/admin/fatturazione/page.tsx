import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, type Prisma, type DocumentoFiscaleTipo } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { SedeCell } from '@/components/fatturazione/sede-cell';
import { DownloadDocumentiButton } from '@/app/pratiche/download-documenti-button';

export const dynamic = 'force-dynamic';

const TIPI: DocumentoFiscaleTipo[] = ['FATTURA_PV', 'DOC_BROKER', 'NOTA_VARIAZIONE', 'PENALE_BROKER'];
const sedeSelect = { select: { nome: true, citta: true, provincia: true } } as const;

export default async function AdminFatturazionePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tipo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/fatturazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin piattaforma possono consultare la fatturazione.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const { q = '', tipo = '' } = await searchParams;
  const qTrim = q.trim();
  const numQ = /^\d+$/.test(qTrim) ? Number(qTrim) : null;
  const tipoFilter = TIPI.includes(tipo as DocumentoFiscaleTipo)
    ? (tipo as DocumentoFiscaleTipo)
    : null;

  const where: Prisma.DocumentoFiscaleWhereInput = {
    ...(tipoFilter ? { tipo: tipoFilter } : {}),
    ...(qTrim
      ? {
          OR: [
            { pratica: { codicePratica: { contains: qTrim, mode: 'insensitive' } } },
            ...(numQ !== null ? [{ numeroProgressivo: numQ }] : []),
          ],
        }
      : {}),
  };

  const docs = await prisma.documentoFiscale.findMany({
    where,
    orderBy: { emessoAt: 'desc' },
    take: 100,
    include: {
      pratica: { select: { id: true, codicePratica: true, agenziaSede: sedeSelect, brokerSede: sedeSelect } },
      payout: { select: { wallet: { select: { sede: sedeSelect } } } },
    },
  });

  // KPI (rispetta i filtri correnti). Dati documentali; la P&L definitiva è del commercialista.
  const kpi = await prisma.documentoFiscale.groupBy({
    by: ['tipo'],
    where,
    _count: { _all: true },
    _sum: { imponibileCent: true, ivaCent: true, importoLordoCent: true },
  });
  const byTipo = (t: DocumentoFiscaleTipo) => kpi.find((k) => k.tipo === t);
  const fpv = byTipo('FATTURA_PV');
  const dbk = byTipo('DOC_BROKER');
  const ncr = byTipo('NOTA_VARIAZIONE');
  const exportQs = new URLSearchParams({ ...(qTrim ? { q: qTrim } : {}), ...(tipoFilter ? { tipo: tipoFilter } : {}) }).toString();

  return (
    <AppShell session={session} activePath="/admin/fatturazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Fatturazione
          </h1>
        </header>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Fatture PV"
            value={fpv?._count._all ?? 0}
            hint={`Tot ${formatCurrencyCent((fpv?._sum.imponibileCent ?? 0) + (fpv?._sum.ivaCent ?? 0))} · imp. ${formatCurrencyCent(fpv?._sum.imponibileCent ?? 0)}`}
            accent="navy"
          />
          <StatCard
            label="Documenti broker"
            value={dbk?._count._all ?? 0}
            hint={formatCurrencyCent(dbk?._sum.importoLordoCent ?? 0)}
            accent="slate"
          />
          <StatCard
            label="Note di credito"
            value={ncr?._count._all ?? 0}
            hint={formatCurrencyCent(ncr?._sum.importoLordoCent ?? 0)}
            accent="red"
          />
        </div>
        <p className="mb-4 text-[11px] text-pv-slate-500">
          Aggregati documentali (rispettano i filtri). La separazione contabile definitiva è a
          cura del commercialista.
        </p>

        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <DownloadDocumentiButton
            href={`/api/fatturazione/zip${exportQs ? `?${exportQs}` : ''}`}
            label="Scarica PDF (ZIP)"
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          />
          <a
            href={`/api/admin/fatturazione/export${exportQs ? `?${exportQs}` : ''}`}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            Esporta CSV
          </a>
        </div>

        <form className="mb-5 flex flex-wrap gap-2" action="/admin/fatturazione" method="get">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Cerca codice pratica o n° documento…"
            className="min-w-[220px] flex-1 rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none"
          />
          <select
            name="tipo"
            defaultValue={tipo}
            className="rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px]"
          >
            <option value="">Tutti i tipi</option>
            {TIPI.map((t) => (
              <option key={t} value={t}>
                {labelTipoDocumento(t)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Filtra
          </button>
        </form>

        {docs.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[14px] text-pv-slate-500">Nessun documento.</p>
          </Card>
        ) : (
          <Card>
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="py-2">Data</th>
                  <th className="py-2">N°</th>
                  <th className="py-2">Tipo</th>
                  <th className="py-2">Emittente</th>
                  <th className="py-2">Destinatario</th>
                  <th className="py-2">Pratica</th>
                  <th className="py-2">Sede</th>
                  <th className="py-2 text-right">Totale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
                {docs.map((d) => {
                  const em = d.datiEmittente as unknown as DatiFiscali;
                  const de = d.datiDestinatario as unknown as DatiFiscali;
                  return (
                    <tr key={d.id}>
                      <td className="py-2">{formatDate(d.emessoAt)}</td>
                      <td className="py-2">
                        <Link href={`/fatturazione/${d.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                          {d.numeroDocumentoStr}
                        </Link>
                      </td>
                      <td className="py-2">{labelTipoDocumento(d.tipo)}</td>
                      <td className="py-2">{em?.ragioneSociale ?? '—'}</td>
                      <td className="py-2">{de?.ragioneSociale ?? '—'}</td>
                      <td className="py-2">
                        {d.pratica ? (
                          <Link
                            href={`/pratiche/${d.pratica.id}`}
                            className="font-mono font-semibold text-pv-navy-600 hover:underline"
                          >
                            {d.pratica.codicePratica ?? '—'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2">
                        <SedeCell doc={d} />
                      </td>
                      <td
                        className={`py-2 text-right font-semibold ${d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}`}
                      >
                        {formatCurrencyCent(d.importoLordoCent)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
