import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { auth } from '@/auth';
import { assertPermesso } from '@/lib/auth/permessi/guard';
import { getSessionContext, getOperatingSede } from '@/lib/auth/session-context';
import { toSedeScope } from '@/lib/sedi/scope-filters';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card, StatCard } from '@/components/ui';
import { formatCurrencyCent, formatDate, formatRelative } from '@/lib/format';
import { computeFees } from '@/lib/pricing';
import { getTariffarioCorrente } from '@/lib/tariffario';
import { CopyLinkButton } from './copy-link-button';
import { getRendimento } from '@/app/wallet/rendimento';
import { RendimentoChart } from '@/app/wallet/rendimento-chart';
import { MovimentiReferral, type RigaMovimentoAffiliazione } from './movimenti-referral';

// Righe della tabella commissioni affiliazione, una per tipo pratica gestito.
// Gli importi sono DERIVATI da computeFees (lib/pricing) così restano allineati
// ai prezzi reali: costo affiliazione per veicolo, diviso 50/50 se la pratica
// ha due referral (broker + agenzia).
const COMMISSIONI_TABELLA = [
  { label: 'Passaggio di proprietà semplice', tipo: 'SEMPLICE', multiplo: false },
  { label: 'Passaggio di proprietà semplice multiplo', tipo: 'SEMPLICE', multiplo: true },
  { label: 'Minivoltura singola', tipo: 'MINIVOLTURA', multiplo: false },
  { label: 'Minivoltura multipla', tipo: 'MINIVOLTURA', multiplo: true },
] as const;

export default async function AffiliazionePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  await assertPermesso('affiliazione.view');
  if (
    session.user.companyType !== 'DEALER' &&
    session.user.companyType !== 'AGENZIA'
  ) {
    return (
      <AppShell session={session} activePath="/affiliazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Il programma affiliazione è dedicato a broker e agenzie.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const companyId = session.user.companyId!;

  // Multi-sede: il link di affiliazione è quello della sede operativa e resta
  // sempre visibile (è lo strumento di lavoro di chiunque). Referral,
  // commissioni e click invece si restringono alla sede quando non si è in
  // vista aggregata: `filtroSede`/`filtroClick` sono {} solo per il
  // proprietario in vista ALL (scope.aggregate), altrimenti filtrano per
  // `scope.scopeIds` (fail-closed: [] ⇒ nessuna riga).
  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/login');
  const scope = toSedeScope(ctx);
  const operatingSede = await getOperatingSede();

  // Per il proprietario in vista aggregata con PIÙ sedi `getOperatingSede()`
  // ritorna null (per una scrittura dovrebbe prima sceglierne una). Il link
  // affiliazione però è una lettura e deve esserci sempre: ricadiamo sulla prima
  // sede accessibile e diciamo nella card di quale sede è il link (gli altri li
  // elenca la classifica sedi più sotto). Senza questo fallback si ripiegava su
  // `Company.referralCode`, colonna deprecata mai valorizzata per le aziende
  // registrate dopo il multi-sede: il proprietario vedeva "Codice referral non
  // disponibile" sul PROPRIO link.
  const sedeLink = operatingSede ?? ctx.accessibleSedi[0] ?? null;
  const sedeLinkNome = !operatingSede && sedeLink ? sedeLink.nome : null;

  const filtroSede = scope.aggregate ? {} : { referenteSedeId: { in: scope.scopeIds } };
  const filtroClick = scope.aggregate ? {} : { sedeId: { in: scope.scopeIds } };

  const [company, affWallet, sedeRow, referrals, commissioni, clickCount, mieCommissioni] =
    await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          ragioneSociale: true,
          referralCode: true,
        },
      }),
      // Il wallet affiliazione è della madre (companyId, sedeId null): il suo
      // rendimento resta al proprietario, in qualunque vista sia (isOwner, non
      // aggregate — vedi nota nel blocco JSX più sotto).
      scope.isOwner
        ? prisma.wallet.findUnique({ where: { companyId }, select: { id: true } })
        : Promise.resolve(null),
      sedeLink
        ? prisma.sede.findUnique({ where: { id: sedeLink.id }, select: { referralCode: true } })
        : Promise.resolve(null),
      prisma.company.findMany({
        where: { referenteId: companyId, deletedAt: null, ...filtroSede },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ragioneSociale: true,
          type: true,
          citta: true,
          provincia: true,
          suspendedAt: true,
          createdAt: true,
        },
      }),
      prisma.commissioneAffiliazione.aggregate({
        where: { referenteId: companyId, stato: 'ACCREDITATA', ...filtroSede },
        _sum: { importoNettoCent: true },
        _count: { _all: true },
      }),
      prisma.referralClick.count({ where: { companyId, ...filtroClick } }),
      // Le MIE commissioni (referente = io) con il broker/agenzia della pratica:
      // servono ad attribuire ogni commissione al referral che l'ha generata.
      // Stesso filtroSede di `referrals`: sono la stessa lista di referral,
      // devono restare coerenti (altrimenti la tabella mostra importi di
      // referral che la lista sopra non elenca più).
      prisma.commissioneAffiliazione.findMany({
        where: { referenteId: companyId, ...filtroSede },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          stato: true,
          importoNettoCent: true,
          pratica: {
            select: { id: true, codicePratica: true, brokerId: true, agenziaAssegnataId: true },
          },
        },
      }),
    ]);

  if (!company) redirect('/profilo');

  const tariffario = await getTariffarioCorrente();

  // Aggregato commissioni PER REFERRAL. Una commissione (referente = io) nasce
  // dalla pratica del referral, lato broker o agenzia: la attribuisco alla/e
  // company referral coinvolta/e (intersezione con i miei referral).
  const myReferralIds = new Set(referrals.map((r) => r.id));
  const commPerReferral = new Map<string, { tot: number; accr: number; accrNetCent: number }>();
  // Movimenti (le singole commissioni) per referral: stessa attribuzione dei
  // contatori sopra, mostrati sotto ogni referral nello stile card wallet.
  const movimentiPerReferral = new Map<string, RigaMovimentoAffiliazione[]>();
  const bumpComm = (id: string | null, stato: string, netCent: number | null): void => {
    if (!id || !myReferralIds.has(id)) return;
    const e = commPerReferral.get(id) ?? { tot: 0, accr: 0, accrNetCent: 0 };
    e.tot += 1;
    if (stato === 'ACCREDITATA') {
      e.accr += 1;
      e.accrNetCent += netCent ?? 0;
    }
    commPerReferral.set(id, e);
  };
  const pushMov = (id: string | null, c: (typeof mieCommissioni)[number]): void => {
    if (!id || !myReferralIds.has(id)) return;
    const arr = movimentiPerReferral.get(id) ?? [];
    arr.push({
      id: c.id,
      createdAt: c.createdAt,
      importoNettoCent: c.importoNettoCent,
      stato: c.stato,
      codicePratica: c.pratica?.codicePratica ?? null,
      praticaId: c.pratica?.id ?? null,
    });
    movimentiPerReferral.set(id, arr);
  };
  for (const c of mieCommissioni) {
    bumpComm(c.pratica?.brokerId ?? null, c.stato, c.importoNettoCent);
    bumpComm(c.pratica?.agenziaAssegnataId ?? null, c.stato, c.importoNettoCent);
    pushMov(c.pratica?.brokerId ?? null, c);
    pushMov(c.pratica?.agenziaAssegnataId ?? null, c);
  }

  const totaleAccreditatoCent = commissioni._sum.importoNettoCent ?? 0;
  const numCommissioni = commissioni._count._all;

  // Rendimento del wallet affiliazione (madre): riservato al proprietario, in
  // qualunque vista (isOwner) — NON gattato su scope.aggregate: il proprietario
  // che seleziona una sede nello switcher non deve perdere i propri incassi di
  // affiliazione, che sono suoi indipendentemente dalla vista corrente.
  const earningsRendimento = affWallet
    ? await getRendimento(affWallet.id, '12m', ['CREDITO_AFFILIAZIONE'])
    : null;

  // Base URL per il link di affiliazione: priorità env, fallback host attuale.
  // Punta a /r/<code> (non /register?ref=) per fare pixel tracking del click
  // prima del redirect al wizard.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  // Codice referral della sede del link (operativa, o la prima accessibile per il
  // proprietario in vista aggregata). Fallback: legacy Company.referralCode.
  const referralCode = sedeRow?.referralCode ?? company.referralCode ?? null;
  const link = referralCode ? `${appUrl}/r/${referralCode}` : null;

  // QR code generato server-side come data URL (no dipendenza da servizi esterni).
  const qrDataUrl = link
    ? await QRCode.toDataURL(link, {
        margin: 1,
        width: 240,
        color: { dark: '#0a2540', light: '#ffffff' },
      })
    : null;

  // Multi-sede: classifica delle sedi per affiliazione ("chi affilia di più").
  // Confronto TRA sedi: ha senso solo per chi le vede tutte insieme, cioè il
  // proprietario in vista aggregata (scope.aggregate). Per un ADMIN_SEDE
  // sarebbe una finestra sui numeri dei colleghi delle altre sedi.
  const sediMadre = scope.aggregate
    ? await prisma.sede.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, nome: true, referralCode: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const [clicksBySede, commBySede] = scope.aggregate
    ? await Promise.all([
        prisma.referralClick.groupBy({
          by: ['sedeId'],
          where: { companyId, sedeId: { not: null } },
          _count: { _all: true },
        }),
        prisma.commissioneAffiliazione.groupBy({
          by: ['referenteSedeId'],
          where: { referenteId: companyId, stato: 'ACCREDITATA' },
          _sum: { importoNettoCent: true },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const clickMap = new Map(clicksBySede.map((c) => [c.sedeId, c._count._all]));
  const commMap = new Map(
    commBySede.map((c) => [c.referenteSedeId, c._sum.importoNettoCent ?? 0]),
  );
  const sedeLeaderboard = sediMadre
    .map((s) => ({
      id: s.id,
      nome: s.nome,
      link: s.referralCode ? `${appUrl}/r/${s.referralCode}` : null,
      clicks: clickMap.get(s.id) ?? 0,
      commCent: commMap.get(s.id) ?? 0,
    }))
    .sort((a, b) => b.commCent - a.commCent || b.clicks - a.clicks);

  return (
    <AppShell session={session} activePath="/affiliazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Programma affiliazione
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Guadagna invitando colleghi
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Per ogni pratica completata da chi hai portato in piattaforma
            ricevi una commissione automatica. Per sempre, finché il referral
            resta attivo.
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Click sul link" value={clickCount} accent="slate" />
          <StatCard label="Referral attivi" value={referrals.filter((r) => !r.suspendedAt).length} accent="navy" />
          <StatCard label="Commissioni accreditate" value={numCommissioni} accent="green" />
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Totale guadagnato
            </p>
            <p className="mt-2 text-[24px] font-extrabold text-pv-navy-900">
              {formatCurrencyCent(totaleAccreditatoCent)}
            </p>
            <p className="mt-1 text-[11px] text-pv-slate-500">
              dalle pratiche completate dei tuoi referral
            </p>
          </Card>
        </div>

        <Card className="mb-6">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Il tuo link affiliazione
          </h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Condividi questo link con colleghi che vogliono iscriversi a
            Passaggio Veloce. Quando completano la registrazione vengono
            associati a te in modo permanente.
          </p>
          {link ? (
            <>
              {sedeLinkNome && (
                <p className="mt-2 text-[12px] text-pv-slate-500">
                  Stai vedendo il link della sede{' '}
                  <span className="font-semibold text-pv-navy-800">{sedeLinkNome}</span>.
                  Ogni sede ha un proprio link: li trovi tutti nella classifica sedi
                  qui sotto.
                </p>
              )}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="flex-1 truncate rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
                  {link}
                </code>
                <CopyLinkButton link={link} />
              </div>
              {qrDataUrl && (
                <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="QR code link affiliazione"
                    width={120}
                    height={120}
                    className="rounded-[10px] border border-pv-slate-200 bg-white p-2"
                  />
                  <div className="text-[12.5px] text-pv-slate-500">
                    <p className="font-semibold text-pv-navy-800">Codice QR pronto da condividere</p>
                    <p className="mt-1">
                      Stampa il QR su biglietti da visita, brochure o
                      mostralo dal telefono. Chi lo scansiona arriva
                      direttamente al form di registrazione associato a te.
                    </p>
                    <p className="mt-2">
                      <a
                        href={qrDataUrl}
                        download={`pv-affiliazione-${referralCode}.png`}
                        className="font-semibold text-pv-navy-700 hover:underline"
                      >
                        Scarica PNG
                      </a>
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-[13px] text-pv-red-500">
              Codice referral non disponibile. Contatta il supporto.
            </p>
          )}
        </Card>

        {scope.aggregate && sedeLeaderboard.length > 1 && (
          <Card className="mb-6">
            <h2 className="text-[15px] font-bold text-pv-navy-800">Classifica sedi</h2>
            <p className="mt-1 text-[12.5px] text-pv-slate-500">
              Quanto sta affiliando ciascuna sede della tua azienda. Ogni sede ha un proprio link.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-pv-slate-200 text-[11px] uppercase tracking-wider text-pv-slate-500">
                    <th className="py-2 pr-3 font-bold">Sede</th>
                    <th className="py-2 pr-3 font-bold">Click</th>
                    <th className="py-2 pr-3 font-bold">Commissioni</th>
                    <th className="py-2 font-bold">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {sedeLeaderboard.map((s, i) => (
                    <tr key={s.id} className="border-b border-pv-slate-100">
                      <td className="py-2 pr-3 font-semibold text-pv-navy-900">
                        {i === 0 && s.commCent > 0 ? '🏆 ' : ''}
                        {s.nome}
                      </td>
                      <td className="py-2 pr-3 text-pv-slate-600">{s.clicks}</td>
                      <td className="py-2 pr-3 font-semibold text-pv-navy-800">
                        {formatCurrencyCent(s.commCent)}
                      </td>
                      <td className="py-2 max-w-[260px] truncate text-[12px] text-pv-slate-500">
                        {s.link ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {earningsRendimento && earningsRendimento.count > 0 && (
          <Card className="mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-bold text-pv-navy-800">
                  Earnings affiliazione · ultimi 12 mesi
                </h2>
                <p className="mt-1 text-[12.5px] text-pv-slate-500">
                  Solo commissioni accreditate dai tuoi referral.
                </p>
                {/*
                  Il grafico legge il wallet affiliazione della madre: mostra
                  sempre tutte le sedi, anche quando lo switcher ne ha
                  selezionata una sola (le StatCard invece sono sede-scoped).
                  È voluto — senza didascalia sembra un errore di calcolo.
                */}
                {!scope.aggregate && (
                  <p className="mt-1 text-[12px] text-pv-slate-500">
                    Include tutte le sedi: gli incassi di affiliazione sono
                    dell&apos;azienda, non della sede selezionata.
                  </p>
                )}
              </div>
              <p className="text-[20px] font-extrabold text-pv-navy-900">
                {formatCurrencyCent(earningsRendimento.totalCent)}
              </p>
            </div>
            <RendimentoChart
              buckets={earningsRendimento.buckets}
              accent="orange"
            />
          </Card>
        )}

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Tabella commissioni
          </h2>
          <table className="mt-3 w-full text-[13px]">
            <thead className="text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              <tr>
                <th className="py-2">Tipo pratica</th>
                <th className="py-2">Solo tuo referral</th>
                <th className="py-2">Tuo referral + altro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-slate-100 text-pv-slate-700">
              {COMMISSIONI_TABELLA.map((r) => {
                const base = computeFees({
                  tipo: r.tipo,
                  numeroVeicoli: 1,
                }, tariffario).costoAffiliazioneTotaleCent;
                const suffix = r.multiplo ? ' × N veicoli' : '';
                return (
                  <tr key={r.label}>
                    <td className="py-2 font-semibold text-pv-navy-800">
                      {r.label}
                    </td>
                    <td className="py-2">
                      {formatCurrencyCent(base)}
                      {suffix}
                    </td>
                    <td className="py-2">
                      {formatCurrencyCent(Math.floor(base / 2))}
                      {suffix}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11.5px] text-pv-slate-500">
            La commissione è per veicolo. Il bonus di una pratica è fisso (max
            10€ per il passaggio semplice, 5€ per la minivoltura): lo prendi
            intero se sei l&apos;unico affiliante coinvolto, oppure diviso 50/50
            con un altro affiliante se il broker e l&apos;agenzia della pratica
            sono stati portati da due affilianti diversi.
          </p>
        </Card>

        <Card className="mt-6">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Tuoi referral ({referrals.length})
          </h2>
          {referrals.length === 0 ? (
            <p className="mt-3 text-[13px] text-pv-slate-500">
              Non hai ancora portato nessuno. Condividi il tuo link per iniziare.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-pv-slate-100 text-[13px]">
              {referrals.map((r) => {
                const agg = commPerReferral.get(r.id);
                const accr = agg?.accr ?? 0;
                const inRevisione = (agg?.tot ?? 0) - accr;
                const movimenti = movimentiPerReferral.get(r.id) ?? [];
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-pv-navy-900">
                          {r.ragioneSociale}
                          {r.suspendedAt && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-pv-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-red-500">
                              Sospeso
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-pv-slate-500">
                          {r.type === 'DEALER' ? 'Broker' : 'Agenzia'} · {r.citta} ({r.provincia})
                          · iscritto {formatDate(r.createdAt)}
                        </p>
                      </div>
                      <p className="text-[12px] text-pv-slate-500 sm:text-right">
                        {accr > 0 ? (
                          <>
                            <span className="font-bold text-pv-navy-800">
                              {formatCurrencyCent(agg?.accrNetCent ?? 0)}
                            </span>{' '}
                            · {accr} commission{accr === 1 ? 'e' : 'i'} accreditat
                            {accr === 1 ? 'a' : 'e'}
                          </>
                        ) : (
                          'Nessuna commissione ancora'
                        )}
                        {inRevisione > 0 ? ` · ${inRevisione} in revisione` : ''}
                        {r.suspendedAt ? ` · sospeso ${formatRelative(r.suspendedAt)}` : ''}
                      </p>
                    </div>
                    {movimenti.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer list-none text-[12px] font-semibold text-pv-navy-600 hover:underline">
                          Vedi i movimenti ({movimenti.length})
                        </summary>
                        <div className="mt-2 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50/40 px-3">
                          <MovimentiReferral righe={movimenti} />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
