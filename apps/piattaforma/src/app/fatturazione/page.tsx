import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, type Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { numeroDocumento, labelTipoDocumento } from '@/lib/fatturazione/format';

export const dynamic = 'force-dynamic';

function SearchBar({ q }: { q: string }) {
  return (
    <form className="mb-5 flex gap-2" action="/fatturazione" method="get">
      <input
        type="text"
        name="q"
        defaultValue={q}
        placeholder="Cerca per codice pratica o n° documento…"
        className="flex-1 rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
      >
        Cerca
      </button>
    </form>
  );
}

export default async function FatturazionePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const { q = '' } = await searchParams;
  const companyId = session.user.companyId;
  const tipo = session.user.companyType;

  if ((tipo !== 'AGENZIA' && tipo !== 'DEALER') || !companyId) {
    return (
      <AppShell session={session} activePath="/fatturazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">
            Le fatture sono disponibili per agenzie e broker.
          </p>
        </div>
      </AppShell>
    );
  }

  const qTrim = q.trim();
  const numQ = /^\d+$/.test(qTrim) ? Number(qTrim) : null;

  return (
    <AppShell session={session} activePath="/fatturazione">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            {tipo === 'AGENZIA' ? 'Agenzia' : 'Broker'}
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Fatture
          </h1>
        </header>

        <SearchBar q={q} />

        {tipo === 'AGENZIA'
          ? await ListaAgenzia({ agenziaId: companyId, q: qTrim, numQ })
          : await ListaBroker({ brokerId: companyId, numQ })}
      </div>
    </AppShell>
  );
}

async function ListaAgenzia({
  agenziaId,
  q,
  numQ,
}: {
  agenziaId: string;
  q: string;
  numQ: number | null;
}) {
  const where: Prisma.DocumentoFiscaleWhereInput = {
    destinatarioCompanyId: agenziaId,
    ...(q
      ? {
          OR: [
            { pratica: { codicePratica: { contains: q, mode: 'insensitive' } } },
            ...(numQ !== null ? [{ numeroProgressivo: numQ }] : []),
          ],
        }
      : {}),
  };
  const docs = await prisma.documentoFiscale.findMany({
    where,
    orderBy: { emessoAt: 'desc' },
    include: { pratica: { select: { id: true, codicePratica: true } } },
  });

  if (docs.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-[14px] text-pv-slate-500">
          Nessuna fattura{q ? ' per questa ricerca' : ' ricevuta finora'}.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          <tr>
            <th className="py-2">Data</th>
            <th className="py-2">N°</th>
            <th className="py-2">Tipo</th>
            <th className="py-2">Pratica</th>
            <th className="py-2 text-right">Imponibile</th>
            <th className="py-2 text-right">IVA</th>
            <th className="py-2 text-right">Totale</th>
            <th className="py-2">Stato</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
          {docs.map((d) => (
            <tr key={d.id}>
              <td className="py-2">{formatDate(d.emessoAt)}</td>
              <td className="py-2">
                <Link href={`/fatturazione/${d.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                  {numeroDocumento(d)}
                </Link>
              </td>
              <td className="py-2">{labelTipoDocumento(d.tipo)}</td>
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
              <td className="py-2 text-right">{formatCurrencyCent(d.imponibileCent ?? 0)}</td>
              <td className="py-2 text-right">{formatCurrencyCent(d.ivaCent ?? 0)}</td>
              <td
                className={`py-2 text-right font-semibold ${d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}`}
              >
                {formatCurrencyCent(d.importoLordoCent)}
              </td>
              <td className="py-2 text-[12px] text-pv-slate-500">{d.statoPagamento}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function ListaBroker({ brokerId, numQ }: { brokerId: string; numQ: number | null }) {
  const docs = await prisma.documentoFiscale.findMany({
    where: {
      emittenteCompanyId: brokerId,
      ...(numQ !== null ? { numeroProgressivo: numQ } : {}),
    },
    orderBy: { emessoAt: 'desc' },
    include: {
      payout: {
        select: {
          id: true,
          eseguitoAt: true,
          transazioni: { where: { tipo: 'CREDITO_PRATICA' }, select: { praticaId: true } },
        },
      },
    },
  });

  if (docs.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-[14px] text-pv-slate-500">
          Nessun documento emesso finora.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          <tr>
            <th className="py-2">Data</th>
            <th className="py-2">N°</th>
            <th className="py-2">Tipo</th>
            <th className="py-2">Pratiche</th>
            <th className="py-2 text-right">Totale</th>
            <th className="py-2">Stato</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
          {docs.map((d) => (
            <tr key={d.id}>
              <td className="py-2">{formatDate(d.emessoAt)}</td>
              <td className="py-2">
                <Link href={`/fatturazione/${d.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                  {numeroDocumento(d)}
                </Link>
              </td>
              <td className="py-2">{labelTipoDocumento(d.tipo)}</td>
              <td className="py-2">{d.payout?.transazioni.length ?? 0}</td>
              <td
                className={`py-2 text-right font-semibold ${d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}`}
              >
                {formatCurrencyCent(d.importoLordoCent)}
              </td>
              <td className="py-2 text-[12px] text-pv-slate-500">
                {d.trasmessoSdiAt ? 'Gestito' : 'In attesa'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
