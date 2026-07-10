import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { assertPermesso, hasPermesso } from '@/lib/auth/permessi/guard';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Button, StatusChip, TipoPraticaChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';
import { PraticheFilters } from './filters';
import { QuickActionButton } from './quick-action-button';
import { DownloadDocumentiButton } from './download-documenti-button';
import { redirectSeAgenziaBloccata } from '@/lib/fee/gate';
import { StatoExtraInfo } from './stato-extra-info';
import { statoExtra } from '@/lib/pratiche/stato-extra';
import { PRATICHE_GRID, PRATICHE_TABLE_MIN_W } from '@/lib/pratiche/table-grid';
import { mostraColonnaSede, filtroSede, SEDE_NON_ASSEGNATA } from '@/lib/pratiche/colonna-sede';
import { opzioniSedeProprie, opzioniSedeAgenziaDaPratiche } from '@/lib/pratiche/opzioni-sede';
import { SedeCell } from '@/components/sede/sede-cell';

const PAGE_SIZE = 15;

// Filtri stato per la lista pratiche broker/agenzia (item 10 release 2026-05).
// Niente R1/R2/R3 ne "Escalation": questi dettagli sono interni al motore di
// distribuzione e non devono apparire all'utente. Lato admin la lista
// completa rimane in /admin/pratiche.
const STATI_USER: { value: string; label: string }[] = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'BOZZA', label: 'Bozza' },
  { value: 'IN_ATTESA', label: 'In attesa' },
  { value: 'ACCETTATA', label: 'Accettata' },
  { value: 'PROCESSATA', label: 'Processata' },
  { value: 'FIRMATA', label: 'Firmata' },
  { value: 'SCADUTA', label: 'Scaduta' },
  { value: 'ANNULLATA', label: 'Annullata' },
];

// Mappatura del valore aggregato "IN_ATTESA" sui valori reali del DB.
const STATI_IN_ATTESA = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
  'IN_ESCALATION',
] as const;

const PERIODI = [
  { value: '', label: 'Qualsiasi periodo' },
  { value: '7d', label: 'Ultimi 7 giorni' },
  { value: '30d', label: 'Ultimi 30 giorni' },
  { value: '90d', label: 'Ultimi 90 giorni' },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

type SearchParams = {
  stato?: string;
  q?: string;
  periodo?: string;
  sede?: string;
  page?: string;
};

export default async function PratichePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  await assertPermesso('pratiche.view');

  await redirectSeAgenziaBloccata();

  const sp = await searchParams;
  const companyType = session.user.companyType;
  const companyId = session.user.companyId;
  const isAgenzia = companyType === 'AGENZIA';

  // Quick-action e download: renderizzati solo se l'utente ha la capability
  // corrispondente. Un bottone nascosto non è una difesa (i gate reali stanno
  // nelle server action), ma evita di mostrare un'azione che fallirebbe.
  const canCreare = await hasPermesso('pratiche.create');
  const canScaricare = await hasPermesso('pratiche.download');
  const canProcessaQuick = await hasPermesso('pratiche.processa');
  const canFirmaQuick = await hasPermesso('pratiche.firma');

  if (!companyId) {
    return (
      <AppShell session={session} activePath="/pratiche">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">Account non associato a un&apos;azienda.</p>
        </div>
      </AppShell>
    );
  }

  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where: Prisma.PraticaWhereInput = {
    deletedAt: null,
  };

  // Multi-sede: scoping per sede corrente (ONE) o tutte le sedi della madre
  // (ALL, proprietario). `scopeIds` vuoto ⇒ nessuna pratica visibile.
  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];
  if (isAgenzia) {
    where.agenziaSedeId = { in: scopeIds };
  } else {
    where.brokerSedeId = { in: scopeIds };
  }

  // Colonna Sede: sempre la sede dell'agenzia assegnataria. Il broker la vede
  // sempre; l'agenzia solo se il suo scope copre più di una sede propria.
  const mostraSede = mostraColonnaSede({ companyType, scopeIds });

  const sediDisponibili = !mostraSede
    ? []
    : isAgenzia
      ? await opzioniSedeProprie(scopeIds)
      : await opzioniSedeAgenziaDaPratiche({ deletedAt: null, brokerSedeId: { in: scopeIds } });

  const fSede = filtroSede({
    selezione: sp.sede,
    opzioniIds: sediDisponibili.map((o) => o.value),
    // Per l'agenzia `agenziaSedeId` È lo scope: il filtro deve intersecarlo.
    scopeIds: isAgenzia ? scopeIds : null,
    consentiNonAssegnata: !isAgenzia,
  });
  if (fSede.tipo === 'sede') where.agenziaSedeId = { in: fSede.sedeIds };
  else if (fSede.tipo === 'nonAssegnata') where.agenziaSedeId = null;

  const sediSelect = mostraSede
    ? [
        { value: '', label: 'Tutte le sedi' },
        ...(isAgenzia ? [] : [{ value: SEDE_NON_ASSEGNATA, label: 'Non assegnate' }]),
        ...sediDisponibili,
      ]
    : [];

  const grid = mostraSede ? PRATICHE_GRID.utenteConSede : PRATICHE_GRID.utenteSenzaSede;

  if (sp.stato && STATI_USER.some((s) => s.value === sp.stato)) {
    if (sp.stato === 'IN_ATTESA') {
      where.stato = { in: STATI_IN_ATTESA as unknown as PraticaStato[] };
    } else {
      where.stato = sp.stato as PraticaStato;
    }
  }

  if (sp.periodo === '7d') where.submittedAt = { gte: daysAgo(7) };
  else if (sp.periodo === '30d') where.submittedAt = { gte: daysAgo(30) };
  else if (sp.periodo === '90d') where.submittedAt = { gte: daysAgo(90) };

  const q = sp.q?.trim();
  if (q) {
    where.OR = [
      { codicePratica: { contains: q, mode: 'insensitive' } },
      { veicoli: { some: { targa: { contains: q, mode: 'insensitive' } } } },
      { veicoli: { some: { proprietarioAttuale: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.pratica.findMany({
      where,
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip,
      take: PAGE_SIZE,
      include: {
        agenziaAssegnata: { select: { ragioneSociale: true, citta: true } },
        broker: { select: { ragioneSociale: true } },
        agenziaSede: { select: { nome: true, citta: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, proprietarioAttuale: true } },
      },
    }),
    prisma.pratica.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell session={session} activePath="/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              {isAgenzia ? 'Pratiche assegnate' : 'Le tue pratiche'}
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Pratiche
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              {total} risultat{total === 1 ? 'o' : 'i'}
              {sp.stato || sp.periodo || sp.sede || q ? ' · filtri attivi' : ''}
            </p>
          </div>
          {!isAgenzia && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Bundle ZIP di tutti i documenti delle pratiche del broker,
                  una cartella per codice pratica (+ toast al click). */}
              {canScaricare && <DownloadDocumentiButton />}
              {canCreare && (
                <Link href="/pratiche/nuova">
                  <Button size="md">+ Nuova pratica</Button>
                </Link>
              )}
            </div>
          )}
        </header>

        <PraticheFilters
          q={q}
          stato={sp.stato}
          periodo={sp.periodo}
          sede={sp.sede}
          stati={STATI_USER}
          periodi={PERIODI}
          sedi={sediSelect}
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {items.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica trovata.</p>
              {!isAgenzia && canCreare && (
                <Link href="/pratiche/nuova" className="mt-3 inline-block">
                  <Button size="sm">Crea la prima</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={`${PRATICHE_TABLE_MIN_W} text-[13px]`}>
                <div
                  className={`grid ${grid} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="hidden px-3 py-3 sm:block">Proprietario</div>
                  <div className="hidden px-3 py-3 md:block">
                    {isAgenzia ? 'Broker' : 'Agenzia'}
                  </div>
                  {mostraSede && <div className="hidden px-3 py-3 lg:block">Sede</div>}
                  <div className="px-3 py-3">Stato</div>
                  <div className="hidden px-3 py-3 lg:block">Fee</div>
                  <div className="py-3 pl-3 pr-5 text-right">Quando</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {items.map((p) => {
                    const extra = statoExtra({
                      stato: p.stato as PraticaStato,
                      flagSegnalata: p.flagSegnalata,
                      segnalazioneStato: p.segnalazioneStato,
                      tipoSegnalazione: p.tipoSegnalazione,
                      notaSegnalazione: p.notaSegnalazione,
                      penaleAddebitatoCent: p.penaleAddebitatoCent,
                      revisioneCompletata: p.revisioneCompletata,
                      richiedeRevisioneManuale: p.richiedeRevisioneManuale,
                    });
                    return (
                      <div
                        key={p.id}
                        className={`relative grid ${grid} items-center transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50`}
                      >
                        {/* Anchor a tutta riga: block-level parent → containing block
                            affidabile su ogni browser (fix iOS). Resta un vero <a>,
                            quindi overlay di navigazione, apri-in-nuova-scheda e
                            focus da tastiera continuano a funzionare. */}
                        <Link
                          href={`/pratiche/${p.id}`}
                          aria-label={`Apri pratica ${p.codicePratica ?? 'in bozza'}`}
                          className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
                        />
                        <div className="min-w-0 py-3 pl-5 pr-3">
                          <div className="truncate font-mono font-semibold text-pv-navy-800">
                            {p.codicePratica ?? 'BOZZA'}
                          </div>
                          <TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} className="mt-1" />
                        </div>
                        <div className="min-w-0 truncate px-3 py-3 font-semibold text-pv-slate-900">
                          {p.veicoli[0]?.targa
                            ? p.veicoli.length > 1
                              ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                              : p.veicoli[0].targa
                            : '—'}
                        </div>
                        <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 sm:block">
                          {p.veicoli[0]?.proprietarioAttuale ?? '—'}
                        </div>
                        <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 md:block">
                          {isAgenzia
                            ? p.broker.ragioneSociale
                            : p.agenziaAssegnata?.ragioneSociale ?? '—'}
                        </div>
                        {mostraSede && (
                          <div className="hidden min-w-0 px-3 py-3 lg:block">
                            <SedeCell
                              sede={p.agenziaSede}
                              agenzia={p.agenziaAssegnata?.ragioneSociale}
                            />
                          </div>
                        )}
                        <div className="min-w-0 px-3 py-3">
                          {/* z-10 per stare SOPRA lo stretched-link: chip, info e i
                              pulsanti azione restano cliccabili senza navigare.
                              flex-wrap: il pulsante va a capo invece di allargare
                              la traccia e disallineare la colonna. */}
                          <span className="relative z-10 inline-flex flex-wrap items-center gap-2">
                            <StatusChip
                              stato={p.stato as PraticaStato}
                              tone={extra?.kind === 'ANNULLATA_TEAM' ? 'danger' : undefined}
                              viewerRole={isAgenzia ? 'AGENZIA' : 'BROKER'}
                            />
                            <StatoExtraInfo extra={extra} />
                            {isAgenzia &&
                              canProcessaQuick &&
                              p.agenziaAssegnataId === companyId &&
                              p.stato === 'ACCETTATA' && (
                                <QuickActionButton praticaId={p.id} action="processata" />
                              )}
                            {isAgenzia &&
                              canFirmaQuick &&
                              p.agenziaAssegnataId === companyId &&
                              p.stato === 'PROCESSATA' && (
                                <QuickActionButton praticaId={p.id} action="firma" />
                              )}
                          </span>
                        </div>
                        <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 lg:block">
                          {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                        </div>
                        <div className="min-w-0 truncate py-3 pl-3 pr-5 text-right text-pv-slate-500">
                          {formatRelative(p.submittedAt ?? p.createdAt)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <Pagination current={page} total={totalPages} sp={sp} />
        )}
      </div>
    </AppShell>
  );
}

function Pagination({
  current,
  total,
  sp,
}: {
  current: number;
  total: number;
  sp: SearchParams;
}) {
  const makeHref = (p: number): string => {
    const params = new URLSearchParams();
    if (sp.stato) params.set('stato', sp.stato);
    if (sp.q) params.set('q', sp.q);
    if (sp.periodo) params.set('periodo', sp.periodo);
    if (sp.sede) params.set('sede', sp.sede);
    if (p > 1) params.set('page', String(p));
    const s = params.toString();
    return s ? `/pratiche?${s}` : '/pratiche';
  };

  return (
    <nav className="mt-5 flex items-center justify-between">
      <p className="text-[12px] text-pv-slate-500">
        Pagina {current} di {total}
      </p>
      <div className="flex gap-2">
        {current > 1 && (
          <Link
            href={makeHref(current - 1)}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            ← Indietro
          </Link>
        )}
        {current < total && (
          <Link
            href={makeHref(current + 1)}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
          >
            Avanti →
          </Link>
        )}
      </div>
    </nav>
  );
}
