import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, type Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card, StatoEmissioneChip } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import { SedeCell } from '@/components/fatturazione/sede-cell';
import { BannerFatturazioneAutomatica } from '@/components/fatturazione/banner-fatturazione-automatica';
import { DownloadDocumentiButton } from '@/app/pratiche/download-documenti-button';
import { getSessionContext } from '@/lib/auth/session-context';
import { assertPermesso, hasPermesso } from '@/lib/auth/permessi/guard';
import { toSedeScope, whereDocumentoFiscale, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import {
  TIPI_DOC,
  parseFatturaFiltri,
  fatturaWhereFiltri,
  fatturaFiltriToQuery,
  type FatturaFiltri,
} from '@/lib/fatturazione/filtri';

export const dynamic = 'force-dynamic';

const sedeSelect = { select: { nome: true, citta: true, provincia: true } } as const;

type SedeOpt = { id: string; nome: string; citta: string };

function FiltriBar({ filtri, sedi }: { filtri: FatturaFiltri; sedi: SedeOpt[] }) {
  const attivi = !!(filtri.q || filtri.tipo || filtri.sedeId || filtri.dataDa || filtri.dataA);
  const input =
    'rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none';
  return (
    <form className="mb-5 flex flex-wrap items-end gap-2" action="/fatturazione" method="get">
      <input
        type="text"
        name="q"
        defaultValue={filtri.q}
        placeholder="Cerca per codice pratica o n° documento…"
        className={`min-w-[200px] flex-1 ${input}`}
      />
      <select name="tipo" defaultValue={filtri.tipo ?? ''} className={input}>
        <option value="">Tutti i tipi</option>
        {TIPI_DOC.map((t) => (
          <option key={t} value={t}>
            {labelTipoDocumento(t)}
          </option>
        ))}
      </select>
      {sedi.length > 1 && (
        <select name="sede" defaultValue={filtri.sedeId ?? ''} className={`max-w-[200px] ${input}`}>
          <option value="">Tutte le sedi</option>
          {sedi.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
              {s.citta ? ` (${s.citta})` : ''}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1 text-[12px] text-pv-slate-500">
        Dal
        <input type="date" name="dataDa" defaultValue={filtri.dataDa ?? ''} className={input} />
      </label>
      <label className="flex items-center gap-1 text-[12px] text-pv-slate-500">
        Al
        <input type="date" name="dataA" defaultValue={filtri.dataA ?? ''} className={input} />
      </label>
      <button
        type="submit"
        className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
      >
        Filtra
      </button>
      {attivi && (
        <Link
          href="/fatturazione"
          className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-pv-slate-600 hover:bg-pv-slate-50"
        >
          Azzera
        </Link>
      )}
    </form>
  );
}

export default async function FatturazionePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tipo?: string; dataDa?: string; dataA?: string; sede?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  await assertPermesso('fatture.view');

  const companyId = session.user.companyId;
  const tipo = session.user.companyType;

  if ((tipo !== 'AGENZIA' && tipo !== 'DEALER') || !companyId) {
    return (
      <AppShell session={session} activePath="/fatturazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">Le fatture sono disponibili per agenzie e broker.</p>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const filtri = parseFatturaFiltri(sp);

  // Multi-sede: lo scope sede restringe la madre (mai la sostituisce). L'owner
  // in vista aggregata (ALL) vede tutta la madre; il selettore sede della
  // FiltriBar mostra solo le sedi accessibili, non l'intero elenco azienda.
  const ctx = await getSessionContext();
  const sedeScope = ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;
  const [sedi, company] = await Promise.all([
    prisma.sede.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(sedeScope.aggregate ? {} : { id: { in: sedeScope.scopeIds } }),
      },
      select: { id: true, nome: true, citta: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Il regime fiscale sta sulla madre (P.IVA unica) e decide se il documento del
    // broker vada o meno allo SdI: è quello che il banner può promettere o no.
    prisma.company.findUnique({ where: { id: companyId }, select: { regimeFiscale: true } }),
  ]);
  const scope = whereDocumentoFiscale(sedeScope, { companyId, ruolo: tipo });
  // NON usare `{ ...scope, ...fatturaWhereFiltri(filtri) }`: entrambi possono
  // restituire una chiave `AND`, e lo spread la sovrascriverebbe silenziosamente
  // (i filtri utente cancellerebbero lo scope sede ⇒ leak). Combinare in AND.
  const where: Prisma.DocumentoFiscaleWhereInput = { AND: [scope, fatturaWhereFiltri(filtri)] };
  const exportQs = fatturaFiltriToQuery(filtri);
  const canScaricare = await hasPermesso('fatture.download');

  return (
    <AppShell session={session} activePath="/fatturazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              {tipo === 'AGENZIA' ? 'Agenzia' : 'Broker'}
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Fatture
            </h1>
          </div>
          {canScaricare && (
            <DownloadDocumentiButton
              href={`/api/fatturazione/zip${exportQs ? `?${exportQs}` : ''}`}
              label="Scarica fatture (ZIP)"
              className="shrink-0 rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
            />
          )}
        </header>

        {/* Senza regime non sappiamo se il documento vada allo SdI: meglio nessun
            banner che un banner che promette il cassetto fiscale a caso. */}
        {company && <BannerFatturazioneAutomatica ruolo={tipo} regime={company.regimeFiscale} />}

        <FiltriBar filtri={filtri} sedi={sedi} />

        {tipo === 'AGENZIA' ? await ListaAgenzia({ where }) : await ListaBroker({ where })}
      </div>
    </AppShell>
  );
}

const TH = 'whitespace-nowrap px-3 py-2.5';
const TD = 'whitespace-nowrap px-3 py-2.5';

async function ListaAgenzia({ where }: { where: Prisma.DocumentoFiscaleWhereInput }) {
  const docs = await prisma.documentoFiscale.findMany({
    where,
    orderBy: { emessoAt: 'desc' },
    include: {
      pratica: { select: { id: true, codicePratica: true, agenziaSede: sedeSelect, brokerSede: sedeSelect } },
    },
  });

  if (docs.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-[14px] text-pv-slate-500">
          Nessuna fattura con i filtri correnti.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="border-b border-pv-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            <tr>
              <th className={TH}>Data</th>
              <th className={TH}>N°</th>
              <th className={TH}>Tipo</th>
              <th className={TH}>Pratica</th>
              <th className={TH}>Sede</th>
              <th className={`${TH} text-right`}>Imponibile</th>
              <th className={`${TH} text-right`}>IVA</th>
              <th className={`${TH} text-right`}>Totale</th>
              <th className={TH}>Stato</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-pv-slate-50">
                <td className={TD}>{formatDate(d.emessoAt)}</td>
                <td className={TD}>
                  <Link href={`/fatturazione/${d.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                    {d.numeroDocumentoStr}
                  </Link>
                </td>
                <td className={TD}>{labelTipoDocumento(d.tipo)}</td>
                <td className={TD}>
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
                <td className={TD}>
                  <SedeCell doc={d} />
                </td>
                <td className={`${TD} text-right`}>{formatCurrencyCent(d.imponibileCent ?? 0)}</td>
                <td className={`${TD} text-right`}>{formatCurrencyCent(d.ivaCent ?? 0)}</td>
                <td
                  className={`${TD} text-right font-semibold ${d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}`}
                >
                  {formatCurrencyCent(d.importoLordoCent)}
                </td>
                <td className={`${TD} text-[12px] text-pv-slate-500`}>{d.statoPagamento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function ListaBroker({ where }: { where: Prisma.DocumentoFiscaleWhereInput }) {
  const docs = await prisma.documentoFiscale.findMany({
    where,
    orderBy: { emessoAt: 'desc' },
    include: {
      payout: {
        select: {
          id: true,
          eseguitoAt: true,
          transazioni: { where: { tipo: 'CREDITO_PRATICA' }, select: { praticaId: true } },
          wallet: { select: { sede: sedeSelect } },
        },
      },
    },
  });

  if (docs.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-[14px] text-pv-slate-500">
          Nessun documento con i filtri correnti.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead className="border-b border-pv-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            <tr>
              <th className={TH}>Data</th>
              <th className={TH}>N°</th>
              <th className={TH}>Tipo</th>
              <th className={TH}>Pratiche</th>
              <th className={TH}>Sede</th>
              <th className={`${TH} text-right`}>Totale</th>
              <th className={TH}>Stato</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-pv-slate-50">
                <td className={TD}>{formatDate(d.emessoAt)}</td>
                <td className={TD}>
                  <Link href={`/fatturazione/${d.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                    {d.numeroDocumentoStr}
                  </Link>
                </td>
                <td className={TD}>{labelTipoDocumento(d.tipo)}</td>
                <td className={TD}>{d.payout?.transazioni.length ?? 0}</td>
                <td className={TD}>
                  <SedeCell doc={d} />
                </td>
                <td
                  className={`${TD} text-right font-semibold ${d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}`}
                >
                  {formatCurrencyCent(d.importoLordoCent)}
                </td>
                <td className={TD}>
                  <StatoEmissioneChip doc={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
