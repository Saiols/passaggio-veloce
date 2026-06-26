import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { prisma, type PraticaTipo } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatusChip, SubmitButton, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatDate, formatDateTime } from '@/lib/format';
import {
  markFirmaAvvenutaAction,
  markPraticaProcessataAction,
} from '../actions';
import { SegnalaProblemaButton } from './segnala-button';
import { AnnullaPraticaButton } from './annulla-button';
import { ValutazioneForm } from './valutazione-form';
import { guidaStep, type GuidaRuolo } from '@/lib/pratiche/guida-step';
import { GuidaStepCard } from './guida-step-card';
import { numeroDocumento, labelTipoDocumento } from '@/lib/fatturazione/format';
import { PraticaToasts } from './pratica-toasts';
import { BackButton } from '@/components/back-button';
import { OverrideGatingButton } from '@/app/admin/documenti/override-gating-button';

export default async function PraticaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const companyType = session.user.companyType;
  const companyId = session.user.companyId;
  // Lo staff di piattaforma (admin/assistente) vede qualsiasi pratica per id.
  // Broker/agenzia vedono solo le proprie (per company). Niente sentinella
  // '__none__' nei filtri: brokerId/agenziaAssegnataId sono colonne uuid e
  // castare '__none__' farebbe lanciare Postgres ("invalid input syntax for
  // type uuid") → 500 sul dettaglio per gli admin (companyId null).
  const isStaff =
    session.user.role === 'ADMIN_PIATTAFORMA' || session.user.role === 'ASSISTENTE';
  if (!isStaff && !companyId) notFound();

  // Multi-sede: l'accesso non-staff è scoped alle sedi (broker o agenzia).
  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];
  const inScope = (sedeId: string | null): boolean => sedeId != null && scopeIds.includes(sedeId);

  const pratica = await prisma.pratica.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(isStaff
        ? {}
        : { OR: [{ brokerSedeId: { in: scopeIds } }, { agenziaSedeId: { in: scopeIds } }] }),
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
      documentiFiscali: {
        select: { id: true, tipo: true, numeroProgressivo: true, anno: true, importoLordoCent: true },
        orderBy: { emessoAt: 'desc' },
      },
      veicoli: { orderBy: { ordine: 'asc' } },
      venditori: { orderBy: { ordine: 'asc' } },
    },
  });

  if (!pratica) notFound();

  const backHref = companyType === 'AGENZIA' ? '/pratiche' : '/pratiche';

  const canProcessata =
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    pratica.stato === 'ACCETTATA';

  const canFirma =
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    pratica.stato === 'PROCESSATA';

  const canAnnulla =
    companyType === 'DEALER' &&
    inScope(pratica.brokerSedeId) &&
    pratica.stato !== 'FIRMATA' &&
    pratica.stato !== 'ANNULLATA' &&
    pratica.stato !== 'SCADUTA';

  const firmaBound = markFirmaAvvenutaAction.bind(null, pratica.id);
  const processataBound = markPraticaProcessataAction.bind(null, pratica.id);

  const canValutare =
    companyType === 'DEALER' &&
    inScope(pratica.brokerSedeId) &&
    pratica.stato === 'FIRMATA' &&
    !pratica.valutazione &&
    !!pratica.agenziaAssegnata;

  // Sistema Penali Broker (SP-B): l'agenzia assegnata può segnalare un
  // problema solo prima della firma (ACCETTATA o PROCESSATA) e una sola
  // volta per pratica.
  const canSegnalare =
    companyType === 'AGENZIA' &&
    inScope(pratica.agenziaSedeId) &&
    (pratica.stato === 'ACCETTATA' || pratica.stato === 'PROCESSATA') &&
    !pratica.flagSegnalata;

  // Spec §1.4 demo: il prezzo è informativo solo dopo la firma (dashboard
  // economica). Per agenzie e broker, prima della firma non viene mostrato.
  const showFee = pratica.firmaAvvenutaAt !== null;

  const ruolo: GuidaRuolo =
    companyType === 'AGENZIA' ? 'AGENZIA' : companyType === 'DEALER' ? 'DEALER' : 'ALTRO';
  const guida = guidaStep({
    stato: pratica.stato as PraticaStato,
    ruolo,
    hasValutazione: !!pratica.valutazione,
  });

  return (
    <AppShell session={session} activePath="/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        {isStaff ? (
          <BackButton fallbackHref="/admin/pratiche" />
        ) : (
          <Link
            href={backHref}
            className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
          >
            ← Tutte le pratiche
          </Link>
        )}

        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[13px] font-semibold text-pv-slate-500">
              {pratica.codicePratica ?? 'BOZZA'}
            </p>
            <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              <span>
                {pratica.veicoli[0]?.targa
                  ? pratica.veicoli.length > 1
                    ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
                    : pratica.veicoli[0].targa
                  : 'Pratica senza targa'}
              </span>
              <StatusChip
                stato={pratica.stato as PraticaStato}
                viewerRole={
                  session.user.role === 'ADMIN_PIATTAFORMA' ||
                  session.user.role === 'ASSISTENTE'
                    ? 'ADMIN'
                    : companyType === 'AGENZIA'
                      ? 'AGENZIA'
                      : 'BROKER'
                }
              />
            </h1>
            <p className="mt-1 text-[14px] text-pv-slate-500">
              {labelTipo(pratica.tipo, pratica.numeroVeicoli)} · {pratica.comune ?? '—'}
              {pratica.provincia ? ` (${pratica.provincia})` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-y-2">
            {canSegnalare && <SegnalaProblemaButton praticaId={pratica.id} />}
            {canAnnulla && <AnnullaPraticaButton praticaId={pratica.id} />}
            {pratica.documenti.length > 0 && (
              <a
                href={`/api/pratiche/${pratica.id}/pdf`}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Scarica PDF
              </a>
            )}
          </div>
        </header>

        <GuidaStepCard
          guida={guida}
          cta={
            guida.cta === 'processata' && canProcessata ? (
              <form action={processataBound}>
                <SubmitButton size="sm" className="animate-pulse-soft" loadingLabel="Aggiornamento…">
                  Pratica processata
                </SubmitButton>
              </form>
            ) : guida.cta === 'firma' && canFirma ? (
              <form action={firmaBound}>
                <SubmitButton size="sm" className="animate-pulse-soft" loadingLabel="Aggiornamento…">
                  Firma avvenuta
                </SubmitButton>
              </form>
            ) : null
          }
        />

        {pratica.flagSegnalata && pratica.segnalazioneStato === 'RICEVUTA' && (
          <div className="mb-5">
            <Alert variant="warning" title="Segnalazione in verifica">
              {companyType === 'AGENZIA'
                ? 'La tua segnalazione è in fase di verifica dal team. Riceverai un aggiornamento appena gestita.'
                : 'È stata aperta una segnalazione su questa pratica. Il team la sta verificando.'}
            </Alert>
          </div>
        )}
        <PraticaToasts />

        {pratica.documentiFiscali.length > 0 && (
          <Card className="mb-5">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Documenti fiscali</h2>
            <ul className="mt-2 divide-y divide-pv-slate-100 text-[13px]">
              {pratica.documentiFiscali.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <Link
                    href={`/fatturazione/${d.id}`}
                    className="font-semibold text-pv-navy-600 hover:underline"
                  >
                    {labelTipoDocumento(d.tipo)} · N° {numeroDocumento(d)}
                  </Link>
                  <span
                    className={d.importoLordoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-900'}
                  >
                    {formatCurrencyCent(d.importoLordoCent)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {canValutare && pratica.agenziaAssegnata && (
          <div className="mb-5">
            <ValutazioneForm
              praticaId={pratica.id}
              agenziaNome={pratica.agenziaAssegnata.ragioneSociale}
            />
          </div>
        )}

        {pratica.valutazione && (
          <div className="mb-5">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Valutazione
                  </p>
                  <p className="mt-1 text-[18px] font-bold text-pv-navy-800">
                    {'★'.repeat(pratica.valutazione.stelle)}
                    <span className="text-pv-slate-300">
                      {'★'.repeat(5 - pratica.valutazione.stelle)}
                    </span>
                    <span className="ml-2 text-[13px] font-normal text-pv-slate-500">
                      {pratica.valutazione.stelle}/5
                    </span>
                  </p>
                  {pratica.valutazione.note && (
                    <p className="mt-1 text-[13px] text-pv-slate-700">
                      &ldquo;{pratica.valutazione.note}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">
                {pratica.veicoli.length > 1 ? `Veicoli (${pratica.veicoli.length})` : 'Dati veicolo'}
              </h2>
              {pratica.veicoli.length === 0 ? (
                <p className="mt-3 text-[13px] text-pv-slate-500">Nessun veicolo</p>
              ) : (
                <div className="mt-4 space-y-5">
                  {pratica.veicoli.map((v) => (
                    <div key={v.id}>
                      {pratica.veicoli.length > 1 && (
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                          Veicolo {v.ordine}
                        </p>
                      )}
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                        <InfoRow label="Targa" value={v.targa} />
                        <InfoRow label="Telaio" value={v.telaio} mono />
                        <InfoRow label="Proprietario attuale" value={v.proprietarioAttuale} />
                        <InfoRow label="Immatricolazione" value={formatDate(v.dataImmatricolazione)} />
                        <InfoRow label="Pre-2015" value={v.preImm2015 ? 'Sì' : 'No'} />
                        <InfoRow label="Comodato d'uso" value={v.flagComodatoDuso ? 'Sì' : 'No'} />
                        <InfoRow
                          label="Prezzo di vendita"
                          value={
                            v.prezzoVenditaCent != null
                              ? formatCurrencyCent(v.prezzoVenditaCent)
                              : null
                          }
                        />
                      </dl>
                    </div>
                  ))}
                </div>
              )}
              {pratica.veicoli.length > 1 && (
                <p className="mt-3 text-[11px] text-pv-slate-500">
                  Totale veicoli: {pratica.numeroVeicoli}
                </p>
              )}
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Parti coinvolte</h2>
              <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    {pratica.venditori.length > 1
                      ? `Venditori (${pratica.venditori.length})`
                      : 'Venditore'}
                  </p>
                  <p className="mt-1.5 text-[14px] font-semibold text-pv-navy-800">
                    {pratica.venditori[0]?.isPersonaGiuridica
                      ? pratica.venditori[0]?.ragioneSociale ?? '—'
                      : `${pratica.venditori[0]?.nome ?? ''} ${pratica.venditori[0]?.cognome ?? ''}`.trim() || '—'}
                    {pratica.venditori.length > 1 ? ` +${pratica.venditori.length - 1}` : ''}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {pratica.venditori[0]?.isPersonaGiuridica
                      ? pratica.venditori[0]?.piva ?? '—'
                      : pratica.venditori[0]?.cf ?? '—'}
                  </p>
                  {(pratica.venditori[0]?.telefono || pratica.venditori[0]?.email) && (
                    <ContattiParte
                      telefono={pratica.venditori[0]?.telefono ?? null}
                      email={pratica.venditori[0]?.email ?? null}
                    />
                  )}
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
                  {(pratica.acquirenteTelefono || pratica.acquirenteEmail) && (
                    <ContattiParte
                      telefono={pratica.acquirenteTelefono}
                      email={pratica.acquirenteEmail}
                    />
                  )}
                  {pratica.acquirenteIndirizzoResidenza && (
                    <p className="mt-1.5 text-[12px] text-pv-slate-700">
                      <span className="font-semibold">Residenza acquirente (diversa dal documento):</span>{' '}
                      {pratica.acquirenteIndirizzoResidenza}
                    </p>
                  )}
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
                  {pratica.documenti.map((d) => {
                    const failed = d.gatingStato === 'FAILED';
                    const overridden = d.gatingStato === 'OVERRIDDEN';
                    return (
                      <li
                        key={d.id}
                        className={
                          'rounded-[10px] border px-3 py-2 text-[13px] ' +
                          (failed
                            ? 'border-pv-red-500/30 bg-pv-red-50/30'
                            : 'border-pv-slate-200')
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-pv-navy-800">
                              {labelDocumento(d.tipo)}
                              {d.owner ? ` — ${labelOwner(d.owner)}` : ''}
                            </p>
                            <p className="truncate text-[12px] text-pv-slate-500">
                              {d.originalFilename} · {formatBytes(d.sizeBytes)}
                            </p>
                          </div>
                          <div className="ml-3 flex shrink-0 items-center gap-2">
                            <GatingBadge stato={d.gatingStato} />
                            <a
                              href={`/api/documenti/${d.id}`}
                              className="rounded-lg border border-pv-slate-300 px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                            >
                              Scarica
                            </a>
                          </div>
                        </div>
                        {failed && d.gatingError && (
                          <p className="mt-2 rounded-[6px] bg-pv-red-50 px-2 py-1 text-[11.5px] text-pv-red-500">
                            ⚠ {d.gatingError}
                          </p>
                        )}
                        {overridden && (
                          <p className="mt-2 text-[11px] text-pv-orange-500">
                            ⓘ Validazione forzata da admin
                          </p>
                        )}
                        {failed && session.user.role === 'ADMIN_PIATTAFORMA' && (
                          <div className="mt-2">
                            <OverrideGatingButton documentoId={d.id} />
                          </div>
                        )}
                      </li>
                    );
                  })}
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
                {showFee && (
                  <>
                    <InfoRow
                      label="Fee agenzia"
                      value={
                        pratica.feeAgenziaCent > 0
                          ? formatCurrencyCent(pratica.feeAgenziaCent)
                          : '—'
                      }
                    />
                    <InfoRow
                      label="Credito broker"
                      value={
                        pratica.creditoBrokerCent > 0
                          ? formatCurrencyCent(pratica.creditoBrokerCent)
                          : '—'
                      }
                    />
                  </>
                )}
                <InfoRow label="Codice interno" value={pratica.codiceAgenziaInterno} />
              </dl>
            </Card>

            <Card>
              <h2 className="text-[15px] font-bold text-pv-navy-800">Timeline</h2>
              <Timeline
                pratica={pratica}
                showInternals={
                  session.user.role === 'ADMIN_PIATTAFORMA' ||
                  session.user.role === 'ASSISTENTE'
                }
              />
            </Card>

            {/* Item 02 release 2026-05: il broker non vede il dettaglio dei
                round e della coda agenzie. Visibile solo all'admin platform. */}
            {pratica.assegnazioni.length > 0 &&
              (session.user.role === 'ADMIN_PIATTAFORMA' ||
                session.user.role === 'ASSISTENTE') && (
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

function ContattiParte({
  telefono,
  email,
}: {
  telefono: string | null;
  email: string | null;
}) {
  return (
    <p className="mt-1 text-[12px] text-pv-slate-700">
      {telefono && (
        <span>
          <span className="font-semibold text-pv-slate-500">Tel:</span>{' '}
          <a className="hover:underline" href={`tel:${telefono}`}>
            {telefono}
          </a>
        </span>
      )}
      {telefono && email && <span className="mx-1.5 text-pv-slate-400">·</span>}
      {email && (
        <span>
          <span className="font-semibold text-pv-slate-500">Email:</span>{' '}
          <a className="hover:underline" href={`mailto:${email}`}>
            {email}
          </a>
        </span>
      )}
    </p>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-pv-orange-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
      {children}
    </span>
  );
}

function labelTipo(tipo: PraticaTipo, numeroVeicoli: number): string {
  const base = tipo === 'SEMPLICE' ? 'Passaggio di proprietà semplice' : 'Minivoltura';
  return numeroVeicoli > 1 ? `${base} (multiplo, ${numeroVeicoli} veicoli)` : base;
}

function labelDocumento(t: string): string {
  const map: Record<string, string> = {
    LIBRETTO_CIRCOLAZIONE: 'Libretto circolazione',
    CI_FRONTE: 'CI fronte',
    CI_RETRO: 'CI retro',
    CODICE_FISCALE: 'Codice fiscale (fronte)',
    CODICE_FISCALE_RETRO: 'Codice fiscale (retro)',
    PROCURA: 'Procura',
    PERMESSO_SOGGIORNO: 'Permesso di soggiorno',
    VISURA_CAMERALE: 'Visura camerale',
    CERTIFICATO_PROPRIETA: 'Certificato di proprietà',
    ALTRO: 'Altro',
    DELEGA_VENDITA: 'Procura a vendere',
    DOCUMENTO_DELEGATO: 'Documento delegato',
    PATENTE_RETRO: 'Patente (retro)',
    LIBRETTO_CIRCOLAZIONE_RETRO: 'Libretto (retro)',
  };
  return map[t] ?? t;
}

function labelOwner(o: string): string {
  const map: Record<string, string> = {
    VENDITORE: 'venditore',
    ACQUIRENTE: 'acquirente',
    AMMINISTRATORE: 'amministratore',
    AZIENDA: 'azienda',
  };
  return map[o] ?? o;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function GatingBadge({ stato }: { stato: string }): React.ReactElement {
  const map: Record<string, { label: string; cls: string }> = {
    PASSED: { label: '✓ ok', cls: 'bg-pv-green-50 text-pv-green-500' },
    FAILED: { label: '✗ scartato', cls: 'bg-pv-red-50 text-pv-red-500' },
    OVERRIDDEN: { label: '⓿ override', cls: 'bg-pv-orange-50 text-pv-orange-500' },
    PENDING: { label: 'pending', cls: 'bg-pv-slate-100 text-pv-slate-500' },
    NONE: { label: '—', cls: 'bg-pv-slate-100 text-pv-slate-500' },
  };
  const m = map[stato] ?? map.NONE!;
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ' +
        m.cls
      }
    >
      {m.label}
    </span>
  );
}

type TimelineStep = { label: string; at: Date | null | undefined; active?: boolean };

function Timeline({
  pratica,
  showInternals,
}: {
  pratica: {
    createdAt: Date;
    submittedAt: Date | null;
    round1StartedAt: Date | null;
    round2StartedAt: Date | null;
    round3StartedAt: Date | null;
    escalationAt: Date | null;
    accettataAt: Date | null;
    processataAt: Date | null;
    firmaAvvenutaAt: Date | null;
    autoAddebitoAt: Date | null;
    scadutaAt: Date | null;
    annullataAt: Date | null;
  };
  /**
   * Lato broker e agenzia (item 02 release 2026-05) gli step di routing
   * (round/escalation) sono dettagli operativi interni: vanno mostrati solo
   * all'admin platform.
   */
  showInternals: boolean;
}) {
  const steps: TimelineStep[] = [
    { label: 'Creazione pratica', at: pratica.createdAt },
    { label: 'Inviata alle agenzie', at: pratica.submittedAt },
    ...(showInternals
      ? [
          { label: 'Round 1 — comune', at: pratica.round1StartedAt },
          { label: 'Round 2 — limitrofi', at: pratica.round2StartedAt },
          { label: 'Round 3 — provincia', at: pratica.round3StartedAt },
          { label: 'Escalation admin', at: pratica.escalationAt },
        ]
      : []),
    { label: 'Accettata', at: pratica.accettataAt },
    { label: 'Processata', at: pratica.processataAt },
    { label: 'Firma avvenuta', at: pratica.firmaAvvenutaAt },
    { label: 'Fee addebitata', at: pratica.autoAddebitoAt },
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
