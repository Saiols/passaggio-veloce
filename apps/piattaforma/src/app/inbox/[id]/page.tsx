import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Button, Card, StatusChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatDate, formatDateTime } from '@/lib/format';
import { acceptAndRedirect, rejectAndRedirect } from '../actions';

export default async function InboxDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (session.user.companyType !== 'AGENZIA') {
    redirect('/dashboard');
  }

  const agenziaId = session.user.companyId!;

  const [assegnazione, pratica] = await Promise.all([
    prisma.praticaAssegnazione.findFirst({
      where: { praticaId: id, agenziaId },
      orderBy: { invioAt: 'desc' },
    }),
    prisma.pratica.findFirst({
      where: { id, deletedAt: null },
      include: {
        broker: { select: { ragioneSociale: true, citta: true, telefono: true, email: true } },
        documenti: { where: { deletedAt: null } },
      },
    }),
  ]);

  if (!assegnazione || !pratica) notFound();

  const canDecide = assegnazione.esito === 'PENDING';

  const acceptBound = acceptAndRedirect.bind(null, pratica.id);
  const rejectBound = rejectAndRedirect.bind(null, pratica.id);

  return (
    <AppShell session={session} activePath="/inbox">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href="/inbox"
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Inbox
        </Link>

        <header className="mb-6">
          <p className="font-mono text-[13px] font-semibold text-pv-slate-500">
            {pratica.codicePratica ?? '—'} · Round {assegnazione.round}
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            <span>{pratica.targa ?? 'Pratica'}</span>
            <StatusChip stato={pratica.stato as PraticaStato} />
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            {labelTipo(pratica.tipo)} · {pratica.comune ?? '—'}
            {pratica.provincia ? ` (${pratica.provincia})` : ''}
          </p>
        </header>

        {error && (
          <div className="mb-5">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {canDecide && (
          <Card className="mb-6 border-pv-orange-500/40 bg-[color-mix(in_srgb,#ff7a00_8%,white)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
                  Decisione richiesta
                </p>
                <p className="mt-1 text-[15px] font-bold text-pv-navy-800">
                  Accetti questa pratica per {formatCurrencyCent(pratica.feeAgenziaCent)}?
                </p>
                <p className="mt-0.5 text-[12px] text-pv-slate-500">
                  Prima dell&apos;accettazione, verifica che il dossier sia completo. In
                  caso di rifiuto, puoi lasciare una nota.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <form action={acceptBound}>
                  <Button type="submit" size="md">
                    Accetta pratica
                  </Button>
                </form>
                <form action={rejectBound} className="flex flex-col gap-2">
                  <input
                    type="text"
                    name="nota"
                    maxLength={500}
                    placeholder="Nota rifiuto (opzionale)"
                    className="rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-2 text-[13px] focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
                  />
                  <Button type="submit" size="md" variant="secondary">
                    Rifiuta
                  </Button>
                </form>
              </div>
            </div>
          </Card>
        )}

        {!canDecide && (
          <Alert
            variant={assegnazione.esito === 'ACCETTATA' ? 'success' : 'info'}
            title={labelEsitoLong(assegnazione.esito)}
            className="mb-5"
          >
            {assegnazione.esitoAt ? `Esito: ${formatDateTime(assegnazione.esitoAt)}` : ''}
            {assegnazione.notaRifiuto ? ` · Nota: ${assegnazione.notaRifiuto}` : ''}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Veicolo</h2>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                <InfoRow label="Targa" value={pratica.targa} />
                <InfoRow label="Telaio" value={pratica.telaio} mono />
                <InfoRow label="Proprietario" value={pratica.proprietarioAttuale} />
                <InfoRow label="Immatricolazione" value={formatDate(pratica.dataImmatricolazione)} />
                <InfoRow label="Pre-2015" value={pratica.preImm2015 ? 'Sì' : 'No'} />
                <InfoRow label="Comodato d'uso" value={pratica.flagComodatoDuso ? 'Sì' : 'No'} />
              </dl>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Parti</h2>
              <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Venditore
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.venditoreIsPersonaGiuridica
                      ? pratica.venditoreRagioneSociale ?? '—'
                      : `${pratica.venditoreNome ?? ''} ${pratica.venditoreCognome ?? ''}`.trim() ||
                        '—'}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.venditoreIsPersonaGiuridica
                      ? pratica.venditorePIVA ?? '—'
                      : pratica.venditoreCF ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Acquirente
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.acquirenteIsPersonaGiuridica
                      ? pratica.acquirenteRagioneSociale ?? '—'
                      : `${pratica.acquirenteNome ?? ''} ${pratica.acquirenteCognome ?? ''}`.trim() ||
                        '—'}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.acquirenteIsPersonaGiuridica
                      ? pratica.acquirentePIVA ?? '—'
                      : pratica.acquirenteCF ?? '—'}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">
                Documenti ({pratica.documenti.length})
              </h2>
              {pratica.documenti.length === 0 ? (
                <p className="mt-3 text-[13px] text-pv-slate-500">Nessun documento caricato.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-[13px]">
                  {pratica.documenti.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-[10px] border border-pv-slate-200 px-3 py-2"
                    >
                      <span className="truncate font-semibold text-pv-navy-800">
                        {labelDocumento(d.tipo)}
                      </span>
                      <span className="text-[11px] text-pv-slate-500">
                        {d.gatingStato === 'PASSED' ? '✓ ok' : d.gatingStato.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <aside className="space-y-5">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Broker</h2>
              <dl className="mt-3 space-y-2 text-[13px]">
                <InfoRow label="Ragione sociale" value={pratica.broker.ragioneSociale} />
                <InfoRow label="Città" value={pratica.broker.citta} />
                <InfoRow label="Email" value={pratica.broker.email} />
                <InfoRow label="Telefono" value={pratica.broker.telefono} />
              </dl>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Economics</h2>
              <dl className="mt-3 space-y-2 text-[13px]">
                <InfoRow
                  label="Fee per te"
                  value={
                    pratica.feeAgenziaCent > 0 ? formatCurrencyCent(pratica.feeAgenziaCent) : '—'
                  }
                />
                <InfoRow label="Round" value={String(assegnazione.round)} />
                <InfoRow label="Inviata" value={formatDateTime(assegnazione.invioAt)} />
              </dl>
            </Card>
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

function labelEsitoLong(e: string): string {
  if (e === 'ACCETTATA') return 'Hai accettato questa pratica';
  if (e === 'RIFIUTATA') return 'Hai rifiutato questa pratica';
  if (e === 'TIMEOUT') return 'Tempo scaduto — la pratica è stata girata ad altre agenzie';
  if (e === 'ASSEGNATA_ALTRO') return 'La pratica è stata assegnata ad un altra agenzia';
  return e;
}
