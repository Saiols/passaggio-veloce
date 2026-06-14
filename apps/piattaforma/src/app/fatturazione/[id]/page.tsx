import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { numeroDocumento, labelTipoDocumento } from '@/lib/fatturazione/format';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { SegnaTrasmessoButton } from './segna-trasmesso-button';

export const dynamic = 'force-dynamic';

function Parte({ titolo, dati }: { titolo: string; dati: DatiFiscali }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-pv-slate-500">{titolo}</p>
      <p className="mt-1 text-[14px] font-bold text-pv-navy-900">{dati.ragioneSociale}</p>
      <p className="text-[12.5px] text-pv-slate-600">P.IVA {dati.partitaIva}</p>
      {(dati.indirizzo || dati.citta) && (
        <p className="text-[12.5px] text-pv-slate-600">
          {[dati.indirizzo, [dati.cap, dati.citta].filter(Boolean).join(' '), dati.provincia ? `(${dati.provincia})` : '']
            .filter(Boolean)
            .join(', ')}
        </p>
      )}
      {dati.codiceSdi && <p className="text-[12.5px] text-pv-slate-600">SDI {dati.codiceSdi}</p>}
      {dati.pec && <p className="text-[12.5px] text-pv-slate-600">PEC {dati.pec}</p>}
    </div>
  );
}

export default async function DocumentoFiscaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const { id } = await params;

  const doc = await prisma.documentoFiscale.findUnique({
    where: { id },
    include: {
      pratica: { select: { id: true, codicePratica: true } },
      payout: {
        select: {
          id: true,
          eseguitoAt: true,
          transazioni: {
            where: { tipo: 'CREDITO_PRATICA' },
            select: { pratica: { select: { id: true, codicePratica: true } } },
          },
        },
      },
      notaVariazionePer: { select: { id: true, numeroProgressivo: true, anno: true } },
      notaVariazioneFiglie: { select: { id: true, numeroProgressivo: true, anno: true } },
    },
  });
  if (!doc) notFound();

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const cid = session.user.companyId;
  const allowed =
    isAdmin ||
    (doc.emittenteCompanyId && doc.emittenteCompanyId === cid) ||
    (doc.destinatarioCompanyId && doc.destinatarioCompanyId === cid);
  if (!allowed) notFound();

  const emittente = doc.datiEmittente as unknown as DatiFiscali;
  const destinatario = doc.datiDestinatario as unknown as DatiFiscali;
  const negativa = doc.importoLordoCent < 0;
  const isBrokerEmittente = doc.tipo === 'DOC_BROKER' && doc.emittenteCompanyId === cid;

  return (
    <AppShell session={session} activePath="/fatturazione">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href="/fatturazione"
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline"
        >
          ← Tutte le fatture
        </Link>

        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              {labelTipoDocumento(doc.tipo)}
              {doc.fatturaPaTipo ? ` · ${doc.fatturaPaTipo}` : ''}
            </p>
            <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-pv-navy-900">
              N° {numeroDocumento(doc)}
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">Emesso il {formatDate(doc.emessoAt)}</p>
          </div>
          <a
            href={`/api/fatturazione/${doc.id}/pdf`}
            className="shrink-0 rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            Scarica PDF
          </a>
        </header>

        <Card className="mb-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Parte titolo="Emittente" dati={emittente} />
            <Parte titolo="Destinatario" dati={destinatario} />
          </div>
        </Card>

        <Card className="mb-5">
          <dl className="grid grid-cols-3 gap-3 text-[13px]">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-pv-slate-500">Imponibile</dt>
              <dd className="font-semibold text-pv-navy-900">{formatCurrencyCent(doc.imponibileCent ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-pv-slate-500">
                IVA {doc.aliquotaIvaPct ? `${doc.aliquotaIvaPct}%` : ''}
              </dt>
              <dd className="font-semibold text-pv-navy-900">{formatCurrencyCent(doc.ivaCent ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-pv-slate-500">Totale</dt>
              <dd className={`font-extrabold ${negativa ? 'text-pv-red-500' : 'text-pv-navy-900'}`}>
                {formatCurrencyCent(doc.importoLordoCent)}
              </dd>
            </div>
          </dl>
        </Card>

        {doc.tipo === 'DOC_BROKER' && (
          <Card className="mb-5">
            <h2 className="text-[14px] font-bold text-pv-navy-800">Trasmissione SDI</h2>
            <p className="mt-1 text-[13px] text-pv-slate-600">
              {doc.trasmessoSdiAt ? (
                <>
                  Trasmesso allo SDI il{' '}
                  <span className="font-semibold text-pv-navy-900">{formatDate(doc.trasmessoSdiAt)}</span>.
                </>
              ) : (
                'Non ancora trasmesso allo SDI.'
              )}
            </p>
            {isBrokerEmittente && !doc.trasmessoSdiAt && (
              <div className="mt-3">
                <SegnaTrasmessoButton documentoId={doc.id} />
                <p className="mt-2 text-[11px] text-pv-slate-500">
                  Scarica il PDF e trasmetti il documento allo SDI tramite il tuo gestionale, poi
                  segnalo qui come trasmesso.
                </p>
              </div>
            )}
          </Card>
        )}

        <Card>
          <h2 className="text-[14px] font-bold text-pv-navy-800">Riferimenti</h2>
          <div className="mt-2 space-y-1 text-[13px] text-pv-slate-700">
            {doc.pratica && (
              <p>
                Pratica:{' '}
                <Link href={`/pratiche/${doc.pratica.id}`} className="font-mono font-semibold text-pv-navy-600 hover:underline">
                  {doc.pratica.codicePratica ?? '—'}
                </Link>
              </p>
            )}
            {doc.payout && (
              <div>
                <p>
                  Payout del {doc.payout.eseguitoAt ? formatDate(doc.payout.eseguitoAt) : '—'} ·{' '}
                  {doc.payout.transazioni.length} pratiche:
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {doc.payout.transazioni.map(
                    (t) =>
                      t.pratica && (
                        <li key={t.pratica.id}>
                          <Link
                            href={`/pratiche/${t.pratica.id}`}
                            className="font-mono font-semibold text-pv-navy-600 hover:underline"
                          >
                            {t.pratica.codicePratica ?? '—'}
                          </Link>
                        </li>
                      ),
                  )}
                </ul>
              </div>
            )}
            {doc.notaVariazionePer && (
              <p>
                Rettifica del documento{' '}
                <Link href={`/fatturazione/${doc.notaVariazionePer.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                  N° {numeroDocumento(doc.notaVariazionePer)}
                </Link>
              </p>
            )}
            {doc.notaVariazioneFiglie.map((n) => (
              <p key={n.id}>
                Stornato da nota di credito{' '}
                <Link href={`/fatturazione/${n.id}`} className="font-semibold text-pv-navy-600 hover:underline">
                  N° {numeroDocumento(n)}
                </Link>
              </p>
            ))}
            {!doc.pratica && !doc.payout && !doc.notaVariazionePer && doc.notaVariazioneFiglie.length === 0 && (
              <p className="text-pv-slate-500">Nessun riferimento.</p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
