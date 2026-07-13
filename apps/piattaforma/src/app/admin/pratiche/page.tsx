import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatusChip, TipoPraticaChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';
import { AdminPraticheFilters } from './filters';
import { PRATICHE_GRID, PRATICHE_TABLE_MIN_W } from '@/lib/pratiche/table-grid';
import { filtroSede, SEDE_NON_ASSEGNATA } from '@/lib/pratiche/colonna-sede';
import { opzioniSedeAgenziaTutte } from '@/lib/pratiche/opzioni-sede';
import { SedeCell } from '@/components/sede/sede-cell';
import { whereStato, SINGOLI_ADMIN, contaGruppi } from '@/lib/pratiche/stati';
import { tabsPraticheAdmin, tabAttivo, hrefPaginaPratiche } from '@/lib/pratiche/tabs';
import { PraticheTabs } from '@/app/pratiche/tabs';

const BASE_PATH = '/admin/pratiche';
const PAGE_SIZE = 15;

/**
 * Stati selezionabili dalla select. Più fini dei tab: l'admin è l'unico a vedere
 * i round di distribuzione (il broker no, sono dettagli interni del motore).
 * `whereStato` li accetta solo passando `SINGOLI_ADMIN`.
 */
const STATI: { value: string; label: string }[] = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'IN_ESCALATION', label: 'Escalation' },
  { value: 'IN_ATTESA_ROUND_1', label: 'In attesa · R1' },
  { value: 'IN_ATTESA_ROUND_2', label: 'In attesa · R2' },
  { value: 'IN_ATTESA_ROUND_3', label: 'In attesa · R3' },
  { value: 'ACCETTATA', label: 'Accettata' },
  { value: 'PROCESSATA', label: 'Processata' },
  { value: 'FIRMATA', label: 'Firmata' },
  { value: 'BOZZA', label: 'Bozza' },
  { value: 'SCADUTA', label: 'Scaduta' },
  { value: 'ANNULLATA', label: 'Annullata' },
];

type SearchParams = { q?: string; stato?: string; sede?: string; page?: string };

export default async function AdminPratichePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.PraticaWhereInput = { deletedAt: null };

  const q = sp.q?.trim();
  if (q) {
    where.OR = [
      { codicePratica: { contains: q, mode: 'insensitive' } },
      { veicoli: { some: { targa: { contains: q, mode: 'insensitive' } } } },
      { veicoli: { some: { proprietarioAttuale: { contains: q, mode: 'insensitive' } } } },
      { comune: { contains: q, mode: 'insensitive' } },
      { broker: { ragioneSociale: { contains: q, mode: 'insensitive' } } },
      { agenziaAssegnata: { ragioneSociale: { contains: q, mode: 'insensitive' } } },
    ];
  }

  // L'admin di piattaforma non è associato a nessuna sede: nessuno scope da
  // intersecare, e le pratiche non ancora assegnate sono un filtro legittimo.
  const sediDisponibili = await opzioniSedeAgenziaTutte();
  const fSede = filtroSede({
    selezione: sp.sede,
    opzioniIds: sediDisponibili.map((o) => o.value),
    scopeIds: null,
    consentiNonAssegnata: true,
  });
  if (fSede.tipo === 'sede') where.agenziaSedeId = { in: fSede.sedeIds };
  else if (fSede.tipo === 'nonAssegnata') where.agenziaSedeId = null;

  const sediSelect = [
    { value: '', label: 'Tutte le sedi' },
    { value: SEDE_NON_ASSEGNATA, label: 'Non assegnate' },
    ...sediDisponibili,
  ];

  // `SINGOLI_ADMIN` (non il default): l'admin filtra anche per R1/R2/R3 ed
  // escalation. Col default, quei valori tornerebbero `undefined` = nessun
  // filtro, e la select mentirebbe in silenzio.
  const filtroStato = whereStato(sp.stato, SINGOLI_ADMIN);

  // I conteggi dei tab usano gli STESSI filtri della lista MENO lo stato: il
  // numero sul tab è esattamente quello che ottieni cliccandolo.
  const whereBase: Prisma.PraticaWhereInput = { ...where };
  if (filtroStato !== undefined) where.stato = filtroStato;

  const [pratiche, total, gruppi] = await Promise.all([
    prisma.pratica.findMany({
      where,
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        broker: { select: { ragioneSociale: true } },
        agenziaAssegnata: { select: { ragioneSociale: true } },
        agenziaSede: { select: { nome: true, citta: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    }),
    prisma.pratica.count({ where }),
    prisma.pratica.groupBy({ by: ['stato'], where: whereBase, _count: { _all: true } }),
  ]);

  const conteggi = contaGruppi(gruppi);
  const tabs = tabsPraticheAdmin(conteggi);
  const attivo = tabAttivo(sp.stato);
  const filtriTab = { q, sede: sp.sede };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // `?page=` fuori range: senza redirect la lista è vuota mentre intestazione e
  // pager riportano ancora i totali reali — una schermata che si contraddice.
  if (page > totalPages) {
    redirect(hrefPaginaPratiche(totalPages, { stato: sp.stato, q: sp.q, sede: sp.sede }, BASE_PATH));
  }

  return (
    <AppShell session={session!} activePath="/admin/pratiche">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Gestione pratiche
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {total} pratic{total === 1 ? 'a' : 'he'}
            {q || sp.stato || sp.sede ? ' · filtri attivi' : ''}
          </p>
        </header>

        <PraticheTabs tabs={tabs} attivo={attivo} filtri={filtriTab} basePath={BASE_PATH} />

        <AdminPraticheFilters q={q} stato={sp.stato} sede={sp.sede} stati={STATI} sedi={sediSelect} />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {pratiche.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica trovata.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={`${PRATICHE_TABLE_MIN_W} text-[13px]`}>
                <div
                  className={`grid ${PRATICHE_GRID.admin} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="hidden px-3 py-3 md:block">Broker</div>
                  <div className="hidden px-3 py-3 md:block">Agenzia</div>
                  <div className="hidden px-3 py-3 lg:block">Sede</div>
                  <div className="px-3 py-3">Stato</div>
                  <div className="hidden px-3 py-3 lg:block">Fee</div>
                  <div className="py-3 pl-3 pr-5 text-right">Quando</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {pratiche.map((p) => (
                    <div
                      key={p.id}
                      className={`relative grid ${PRATICHE_GRID.admin} items-center transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50`}
                    >
                      {/* Anchor a tutta riga su parent block-level: containing
                          block affidabile su iOS Safari (fix tap/landscape). */}
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
                      <div className="min-w-0 truncate px-3 py-3">
                        {p.veicoli[0]?.targa
                          ? p.veicoli.length > 1
                            ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                            : p.veicoli[0].targa
                          : '—'}
                      </div>
                      <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 md:block">
                        {p.broker.ragioneSociale}
                      </div>
                      <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 md:block">
                        {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                      </div>
                      <div className="hidden min-w-0 px-3 py-3 lg:block">
                        <SedeCell sede={p.agenziaSede} agenzia={p.agenziaAssegnata?.ragioneSociale} />
                      </div>
                      <div className="min-w-0 px-3 py-3">
                        <span className="relative z-10 inline-flex flex-wrap items-center gap-2">
                          <StatusChip stato={p.stato as PraticaStato} />
                        </span>
                      </div>
                      <div className="hidden min-w-0 truncate px-3 py-3 text-pv-slate-700 lg:block">
                        {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                      </div>
                      <div className="min-w-0 truncate py-3 pl-3 pr-5 text-right text-pv-slate-500">
                        {formatRelative(p.submittedAt ?? p.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <nav className="mt-5 flex items-center justify-between">
            <p className="text-[12px] text-pv-slate-500">
              Pagina {page} di {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={hrefPaginaPratiche(page - 1, { stato: sp.stato, q: sp.q, sede: sp.sede }, BASE_PATH)}
                  className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                >
                  ← Indietro
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={hrefPaginaPratiche(page + 1, { stato: sp.stato, q: sp.q, sede: sp.sede }, BASE_PATH)}
                  className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                >
                  Avanti →
                </Link>
              )}
            </div>
          </nav>
        )}
      </div>
    </AppShell>
  );
}
