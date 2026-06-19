import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatusChip, type PraticaStato } from '@/components/ui';
import { formatCurrencyCent, formatRelative } from '@/lib/format';
import { AdminPraticheFilters } from './filters';

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

type SearchParams = { q?: string; stato?: string };

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

  const pratiche = await prisma.pratica.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
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
            {q || sp.stato ? ' (filtri attivi)' : ' (più recenti, escalation in cima)'}
          </p>
        </header>

        <AdminPraticheFilters q={q} stato={sp.stato} stati={STATI} />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {sorted.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica trovata.</p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="px-5 py-3">Codice</th>
                  <th className="px-5 py-3">Targa</th>
                  <th className="px-5 py-3 hidden md:table-cell">Broker</th>
                  <th className="px-5 py-3 hidden md:table-cell">Agenzia</th>
                  <th className="px-5 py-3">Stato</th>
                  <th className="px-5 py-3 hidden lg:table-cell">Fee</th>
                  <th className="px-5 py-3 text-right">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-200">
                {sorted.map((p) => (
                  <tr
                    key={p.id}
                    className="relative cursor-pointer transition-colors hover:bg-pv-slate-50 focus-within:bg-pv-slate-50"
                  >
                    <td className="px-5 py-3 font-mono font-semibold text-pv-navy-800">
                      <Link
                        href={`/pratiche/${p.id}`}
                        className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
                      >
                        <span className="sr-only">
                          Apri pratica {p.codicePratica ?? 'in bozza'}
                        </span>
                      </Link>
                      <span>{p.codicePratica ?? 'BOZZA'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span>
                        {p.veicoli[0]?.targa
                          ? p.veicoli.length > 1
                            ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                            : p.veicoli[0].targa
                          : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                      <span>{p.broker.ragioneSociale}</span>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                      <span>
                        {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span>
                        <StatusChip stato={p.stato as PraticaStato} />
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 lg:table-cell">
                      <span>
                        {p.feeAgenziaCent > 0 ? formatCurrencyCent(p.feeAgenziaCent) : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-pv-slate-500">
                      <span>
                        {formatRelative(p.submittedAt ?? p.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
