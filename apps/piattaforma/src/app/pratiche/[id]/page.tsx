import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Button, Card, StatusChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatDate, formatDateTime } from '@/lib/format';
import { markFirmaAvvenutaAction, annullaPraticaAction } from '../actions';

export default async function PraticaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ firmata?: string; annullata?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const companyType = session.user.companyType;
  const companyId = session.user.companyId;

  const pratica = await prisma.pratica.findFirst({
    where: {
      id,
      deletedAt: null,
      OR: [
        { brokerId: companyId ?? '__none__' },
        { agenziaAssegnataId: companyId ?? '__none__' },
        ...(session.user.role === 'ADMIN_PIATTAFORMA' ? [{}] : []),
      ],
    },
    include: {
      broker: { select: { ragioneSociale: true, citta: true, provincia: true } },
      agenziaAssegnata: { select: { ragioneSociale: true, citta: true } },
      assegnazioni: {
        include: { agenzia: { select: { ragioneSociale: true, citta: true } } },
        orderBy: [{ round: 'asc' }, { invioAt: 'asc' }],
      },
      documenti: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      valutazione: true,
    },
  });

  if (!pratica) notFound();

  const backHref = companyType === 'AGENZIA' ? '/pratiche' : '/pratiche';

  const canFirma =
    companyType === 'AGENZIA' &&
    pratica.agenziaAssegnataId === companyId &&
    pratica.stato === 'ACCETTATA';

  const canAnnulla =
    companyType === 'DEALER' &&
    pratica.brokerId === companyId &&
    pratica.stato !== 'FIRMATA' &&
    pratica.stato !== 'ANNULLATA' &&
    pratica.stato !== 'SCADUTA';

  const firmaBound = markFirmaAvvenutaAction.bind(null, pratica.id);
  const annullaBound = annullaPraticaAction.bind(null, pratica.id);

  return (
    <AppShell session={session} activePath="/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href={backHref}
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Tutte le pratiche
        </Link>

        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[13px] font-semibold text-pv-slate-500">
              {pratica.codicePratica ?? 'BOZZA'}
            </p>
            <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              <span>{pratica.targa ?? 'Pratica senza targa'}</span>
              <StatusChip stato={pratica.stato as PraticaStato} />
            </h1>
            <p className="mt-1 text-[14px] text-pv-slate-500">
              {labelTipo(pratica.tipo)} · {pratica.comune ?? '—'}
              {pratica.provincia ? ` (${pratica.provincia})` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canFirma && (
              <form action={firmaBound}>
                <Button type="submit" size="sm">
                  Firma avvenuta
                </Button>
              </form>
            )}
            {canAnnulla && (
              <form action={annullaBound}>
                <Button type="submit" size="sm" variant="danger">
                  Annulla pratica
                </Button>
              </form>
            )}
            <Link
              href="#"
              className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
            >
              Scarica ZIP
            </Link>
          </div>
        </header>

        {sp.firmata && (
          <div className="mb-5">
            <Alert variant="success" title="Firma registrata">
              Credito accreditato al broker, auto-addebito programmato.
            </Alert>
          </div>
        )}
        {sp.annullata && (
          <div className="mb-5">
            <Alert variant="info" title="Pratica annullata">
              Tutte le assegnazioni pending sono state chiuse.
            </Alert>
          </div>
        )}
        {sp.error && (
          <div className="mb-5">
            <Alert variant="error">{sp.error}</Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Dati veicolo</h2>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                <InfoRow label="Targa" value={pratica.targa} />
                <InfoRow label="Telaio" value={pratica.telaio} mono />
                <InfoRow label="Proprietario attuale" value={pratica.proprietarioAttuale} />
                <InfoRow label="Immatricolazione" value={formatDate(pratica.dataImmatricolazione)} />
                <InfoRow label="Pre-2015" value={pratica.preImm2015 ? 'Sì' : 'No'} />
                <InfoRow label="Comodato d'uso" value={pratica.flagComodatoDuso ? 'Sì' : 'No'} />
              </dl>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Parti coinvolte</h2>
              <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Venditore
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.venditoreIsPersonaGiuridica
                      ? pratica.venditoreRagioneSociale ?? '—'
                      : `${pratica.venditoreNome ?? ''} ${pratica.venditoreCognome ?? ''}`.trim() || '—'}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.venditoreIsPersonaGiuridica ? pratica.venditorePIVA ?? '—' : pratica.venditoreCF ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Acquirente
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.acquirenteIsPersonaGiuridica
                      ? pratica.acquirenteRagioneSociale ?? '—'
                      : `${pratica.acquirenteNome ?? ''} ${pratica.acquirenteCognome ?? ''}`.trim() || '—'}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.acquirenteIsPersonaGiuridica
                      ? pratica.acquirentePIVA ?? '—'
                      : pratica.acquirenteCF ?? '—'}
                  </p>
                </div>
              </div>
              {(pratica.flagCointestazione || pratica.flagMinivoltura || pratica.flagProcura) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {pratica.flagCointestazione && <Flag>Cointestazione</Flag>}
                  {pratica.flagMinivoltura && <Flag>Minivoltura</Flag>}
                  {pratica.flagProcura && <Flag>Procura</Flag>}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Documenti</h2>
              {pratica.documenti.length === 0 ? (
                <p className="mt-3 text-[13px] text-pv-slate-500">
                  Nessun documento caricato
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {pratica.documenti.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-[10px] border border-pv-slate-200 px-3 py-2 text-[13px]"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-pv-navy-800">{labelDocumento(d.tipo)}</p>
                        <p className="truncate text-[12px] text-pv-slate-500">{d.originalFilename}</p>
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                        {d.gatingStato === 'PASSED'
                          ? '✓ ok'
                          : d.gatingStato === 'FAILED'
                            ? '✗ scartato'
                            : d.gatingStato.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <aside className="space-y-5">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Parti commerciali</h2>
              <dl className="mt-4 space-y-3 text-[13px]">
                <InfoRow label="Broker" value={pratica.broker.ragioneSociale} />
                <InfoRow
                  label="Agenzia assegnata"
                  value={pratica.agenziaAssegnata?.ragioneSociale ?? '—'}
                />
                <InfoRow label="Comune" value={pratica.comune} />
                <InfoRow
                  label="Fee agenzia"
                  value={pratica.feeAgenziaCent > 0 ? formatCurrencyCent(pratica.feeAgenziaCent) : '—'}
                />
                <InfoRow
                  label="Credito broker"
                  value={
                    pratica.creditoBrokerCent > 0 ? formatCurrencyCent(pratica.creditoBrokerCent) : '—'
                  }
                />
                <InfoRow label="Codice interno" value={pratica.codiceAgenziaInterno} />
              </dl>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Timeline</h2>
              <Timeline pratica={pratica} />
            </Card>

            {pratica.assegnazioni.length > 0 && (
              <Card>
                <h2 className="text-[15px] font-bold text-pv-navy-800">Round distribuzione</h2>
                <ul className="mt-3 space-y-2 text-[13px]">
                  {pratica.assegnazioni.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-pv-navy-800">
                          {a.agenzia.ragioneSociale}
                        </p>
                        <p className="text-[11px] text-pv-slate-500">
                          R{a.round} · {formatDateTime(a.invioAt)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                        {a.esito.toLowerCase().replace('_', ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 text-pv-slate-900 ${mono ? 'font-mono text-[12.5px]' : 'text-[13px]'}`}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-pv-orange-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
      {children}
    </span>
  );
}

function labelTipo(t: string): string {
  if (t === 'TRAPASSO_NETTO') return 'Trapasso netto';
  if (t === 'MINIVOLTURA') return 'Minivoltura';
  if (t === 'LOTTO_MASSIVO') return 'Lotto massivo';
  return t;
}

function labelDocumento(t: string): string {
  const map: Record<string, string> = {
    LIBRETTO_CIRCOLAZIONE: 'Libretto circolazione',
    CI_FRONTE: 'CI fronte',
    CI_RETRO: 'CI retro',
    CODICE_FISCALE: 'Codice fiscale',
    PROCURA: 'Procura',
    PERMESSO_SOGGIORNO: 'Permesso di soggiorno',
    VISURA_CAMERALE: 'Visura camerale',
    CERTIFICATO_PROPRIETA: 'Certificato di proprietà',
    ALTRO: 'Altro',
  };
  return map[t] ?? t;
}

type TimelineStep = { label: string; at: Date | null | undefined; active?: boolean };

function Timeline({
  pratica,
}: {
  pratica: {
    createdAt: Date;
    submittedAt: Date | null;
    round1StartedAt: Date | null;
    round2StartedAt: Date | null;
    round3StartedAt: Date | null;
    escalationAt: Date | null;
    accettataAt: Date | null;
    firmaAvvenutaAt: Date | null;
    autoAddebitoAt: Date | null;
    scadutaAt: Date | null;
    annullataAt: Date | null;
  };
}) {
  const steps: TimelineStep[] = [
    { label: 'Creazione pratica', at: pratica.createdAt },
    { label: 'Inviata alle agenzie', at: pratica.submittedAt },
    { label: 'Round 1 — comune', at: pratica.round1StartedAt },
    { label: 'Round 2 — limitrofi', at: pratica.round2StartedAt },
    { label: 'Round 3 — provincia', at: pratica.round3StartedAt },
    { label: 'Escalation admin', at: pratica.escalationAt },
    { label: 'Accettata', at: pratica.accettataAt },
    { label: 'Firma avvenuta', at: pratica.firmaAvvenutaAt },
    { label: 'Auto-addebito giorno 20', at: pratica.autoAddebitoAt },
    { label: 'Scaduta', at: pratica.scadutaAt },
    { label: 'Annullata', at: pratica.annullataAt },
  ].filter((s) => s.at);

  if (steps.length === 0) {
    return <p className="mt-3 text-[13px] text-pv-slate-500">Nessun evento ancora</p>;
  }

  return (
    <ol className="relative mt-4 space-y-3 pl-5">
      <span className="absolute left-[5px] top-1 bottom-1 w-[2px] bg-pv-slate-200" aria-hidden />
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span className="absolute left-[-20px] top-1.5 h-3 w-3 rounded-full border-2 border-pv-navy-700 bg-white" />
          <p className="text-[13px] font-semibold text-pv-navy-800">{s.label}</p>
          <p className="text-[11px] text-pv-slate-500">{formatDateTime(s.at)}</p>
        </li>
      ))}
    </ol>
  );
}
