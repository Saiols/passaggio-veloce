import Link from 'next/link';
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

// Priorità per ordinamento "rosse / in accettazione in cima" (Q-12).
// Più alto = mostrato prima.
const PRIORITY: Record<string, number> = {
  IN_ESCALATION: 100,
  IN_ATTESA_ROUND_1: 80,
  IN_ATTESA_ROUND_2: 80,
  IN_ATTESA_ROUND_3: 80,
  ACCETTATA: 60,
  PROCESSATA: 50,
  FIRMATA: 30,
  BOZZA: 10,
  SCADUTA: 5,
  ANNULLATA: 5,
};

type SearchParams = { q?: string; stato?: string; sede?: string };

export default async function AdminPratichePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;

  const where: Prisma.PraticaWhereInput = { deletedAt: null };

  if (sp.stato && STATI.some((s) => s.value === sp.stato)) {
    where.stato = sp.stato as PraticaStato;
  }

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

  const pratiche = await prisma.pratica.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
      agenziaSede: { select: { nome: true, citta: true } },
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
    },
  });

  // Ordinamento secondario in memoria: priorità stato, poi data desc.
  const sorted = [...pratiche].sort((a, b) => {
    const pa = PRIORITY[a.stato] ?? 0;
    const pb = PRIORITY[b.stato] ?? 0;
    if (pa !== pb) return pb - pa;
    const da = (a.submittedAt ?? a.createdAt).getTime();
    const db = (b.submittedAt ?? b.createdAt).getTime();
    return db - da;
  });

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
            {sorted.length} pratic{sorted.length === 1 ? 'a' : 'he'}
            {q || sp.stato || sp.sede ? ' (filtri attivi)' : ' (più recenti, escalation in cima)'}
          </p>
        </header>

        <AdminPraticheFilters q={q} stato={sp.stato} sede={sp.sede} stati={STATI} sedi={sediSelect} />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {sorted.length === 0 ? (
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
                  {sorted.map((p) => (
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
                        <TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} className="mt-1 relative z-10" />
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
      </div>
    </AppShell>
  );
}
