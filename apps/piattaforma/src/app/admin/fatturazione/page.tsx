import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, type Prisma, type DocumentoFiscaleTipo } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard, StatoEmissioneChip } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { labelTipoDocumento, messaggioTroncamento } from '@/lib/fatturazione/format';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { whereEmissione } from '@/lib/fatturazione/emissione';
import { SedeCell } from '@/components/fatturazione/sede-cell';
import { DownloadDocumentiButton } from '@/app/pratiche/download-documenti-button';
import {
  TIPI_DOC,
  parseFatturaFiltri,
  fatturaWhereFiltri,
  fatturaFiltriToQuery,
} from '@/lib/fatturazione/filtri';
import { FattureTabs, type TabFattura } from './tabs';

export const dynamic = 'force-dynamic';

const sedeSelect = { select: { nome: true, citta: true, provincia: true } } as const;

export default async function AdminFatturazionePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tipo?: string;
    dataDa?: string;
    dataA?: string;
    sede?: string;
    emissione?: string;
  }>;
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

  const sp = await searchParams;
  const filtri = parseFatturaFiltri(sp);
  const where: Prisma.DocumentoFiscaleWhereInput = fatturaWhereFiltri(filtri);

  // I conteggi dei tab usano gli STESSI filtri della lista MENO l'emissione: il
  // numero sul tab è esattamente quello che ottieni cliccandolo. Con `where`
  // (che include l'emissione) ogni tab mostrerebbe il proprio numero.
  const whereBase: Prisma.DocumentoFiscaleWhereInput = fatturaWhereFiltri({
    ...filtri,
    emissione: null,
  });

  // Opzioni del filtro "Sede" (tutte le sedi attive, con azienda madre).
  const sediOpzioni = await prisma.sede.findMany({
    where: { deletedAt: null },
    select: { id: true, nome: true, citta: true, company: { select: { ragioneSociale: true } } },
    orderBy: [{ company: { ragioneSociale: 'asc' } }, { nome: 'asc' }],
  });

  const [docs, kpi, countDaEmettere, countEmesse, countTutte, countFiltrati] = await Promise.all([
    prisma.documentoFiscale.findMany({
      where,
      orderBy: { emessoAt: 'desc' },
      take: 100,
      include: {
        pratica: { select: { id: true, codicePratica: true, agenziaSede: sedeSelect, brokerSede: sedeSelect } },
        payout: { select: { wallet: { select: { sede: sedeSelect } } } },
      },
    }),
    // KPI (rispetta i filtri correnti). Dati documentali; la P&L definitiva è del commercialista.
    prisma.documentoFiscale.groupBy({
      by: ['tipo'],
      where,
      _count: { _all: true },
      _sum: { imponibileCent: true, ivaCent: true, importoLordoCent: true },
    }),
    prisma.documentoFiscale.count({
      where: { AND: [whereBase, whereEmissione('DA_EMETTERE')!] },
    }),
    prisma.documentoFiscale.count({
      where: { AND: [whereBase, whereEmissione('EMESSA')!] },
    }),
    prisma.documentoFiscale.count({ where: whereBase }),
    // Totale che rispetta `where` (filtri correnti, emissione inclusa): serve
    // SOLO per sapere se `take: 100` sta troncando (M-1), non è un conteggio
    // di tab. Senza questo, oltre le 100 righe la tabella mentirebbe in
    // silenzio mentre i tab sopra mostrano il numero vero.
    prisma.documentoFiscale.count({ where }),
  ]);
  const truncMsg = messaggioTroncamento(docs.length, countFiltrati);

  const tabs: TabFattura[] = [
    { value: '', label: 'Tutte', count: countTutte },
    { value: 'DA_EMETTERE', label: 'Da emettere', count: countDaEmettere },
    { value: 'EMESSA', label: 'Emesse', count: countEmesse },
  ];
  // Query-string degli altri filtri, per i link dei tab.
  const queryBase = fatturaFiltriToQuery({ ...filtri, emissione: null });

  const byTipo = (t: DocumentoFiscaleTipo) => kpi.find((k) => k.tipo === t);
  const fpv = byTipo('FATTURA_PV');
  const dbk = byTipo('DOC_BROKER');
  const ncr = byTipo('NOTA_VARIAZIONE');
  const exportQs = fatturaFiltriToQuery(filtri);

  return (
    <AppShell session={session} activePath="/admin/fatturazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Fatturazione
          </h1>
          <Link
            href="/admin/costi-promozionali"
            className="mt-2 inline-block text-[13px] font-semibold text-pv-navy-600 hover:underline"
          >
            → Costi promozionali (giustificativi interni)
          </Link>
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

        <FattureTabs tabs={tabs} attivo={filtri.emissione ?? ''} queryBase={queryBase} />

        <form className="mb-5 flex flex-wrap items-end gap-2" action="/admin/fatturazione" method="get">
          {filtri.emissione && <input type="hidden" name="emissione" value={filtri.emissione} />}
          <input
            type="text"
            name="q"
            defaultValue={filtri.q}
            placeholder="Cerca codice pratica o n° documento…"
            className="min-w-[200px] flex-1 rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none"
          />
          <select
            name="tipo"
            defaultValue={filtri.tipo ?? ''}
            className="rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px]"
          >
            <option value="">Tutti i tipi</option>
            {TIPI_DOC.map((t) => (
              <option key={t} value={t}>
                {labelTipoDocumento(t)}
              </option>
            ))}
          </select>
          <select
            name="sede"
            defaultValue={filtri.sedeId ?? ''}
            className="max-w-[240px] rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px]"
          >
            <option value="">Tutte le sedi</option>
            {sediOpzioni.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company.ragioneSociale} — {s.nome}
                {s.citta ? ` (${s.citta})` : ''}
              </option>
            ))}
          </select>
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
          {(filtri.q || filtri.tipo || filtri.sedeId || filtri.dataDa || filtri.dataA || filtri.emissione) && (
            <Link
              href="/admin/fatturazione"
              className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-pv-slate-600 hover:bg-pv-slate-50"
            >
              Azzera
            </Link>
          )}
        </form>

        {truncMsg && (
          <Alert variant="warning" className="mb-4">
            {truncMsg}
          </Alert>
        )}

        {docs.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[14px] text-pv-slate-500">Nessun documento.</p>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-[13px]">
                <thead className="border-b border-pv-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2.5">Data</th>
                    <th className="whitespace-nowrap px-3 py-2.5">N°</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Tipo</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Stato</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Emittente</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Destinatario</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Pratica</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Sede</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">Totale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
                  {docs.map((d) => {
                    const em = d.datiEmittente as unknown as DatiFiscali;
                    const de = d.datiDestinatario as unknown as DatiFiscali;
                    return (
                      <tr key={d.id} className="hover:bg-pv-slate-50">
                        <td className="whitespace-nowrap px-3 py-2.5">{formatDate(d.emessoAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <Link href={`/fatturazione/${d.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                            {d.numeroDocumentoStr}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">{labelTipoDocumento(d.tipo)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <StatoEmissioneChip doc={d} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="max-w-[180px] truncate" title={em?.ragioneSociale ?? ''}>
                            {em?.ragioneSociale ?? '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="max-w-[180px] truncate" title={de?.ragioneSociale ?? ''}>
                            {de?.ragioneSociale ?? '—'}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
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
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <SedeCell doc={d} />
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold ${d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}`}
                        >
                          {formatCurrencyCent(d.importoLordoCent)}
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
