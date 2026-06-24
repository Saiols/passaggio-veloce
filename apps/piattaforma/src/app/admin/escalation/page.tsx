import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { AssignForm } from './assign-form';

export default async function AdminEscalationPage() {
  const session = await auth();
  const pratiche = await prisma.pratica.findMany({
    where: { stato: 'IN_ESCALATION', deletedAt: null },
    orderBy: { escalationAt: 'desc' },
    include: {
      broker: { select: { ragioneSociale: true, email: true, telefono: true } },
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      assegnazioni: {
        include: { agenzia: { select: { ragioneSociale: true } } },
      },
    },
  });

  // Precarichiamo le agenzie attive per ogni provincia presente nelle pratiche.
  // Aggiungiamo rating (media stelle + numero valutazioni) cosi' l'admin
  // identifica subito le agenzie piu' affidabili (item 13 release 2026-05).
  const province = Array.from(
    new Set(pratiche.map((p) => p.provincia).filter(Boolean) as string[]),
  );
  type AgenziaPick = {
    id: string;
    ragioneSociale: string;
    avgStars: number | null;
    numValutazioni: number;
  };
  const agenzieByProvincia = new Map<string, AgenziaPick[]>();
  for (const prov of province) {
    // Multi-sede: l'assegnazione manuale è verso una SEDE agenzia (attiva).
    const sedi = await prisma.sede.findMany({
      where: { type: 'AGENZIA', deletedAt: null, suspendedAt: null, provincia: prov },
      select: { id: true, nome: true },
    });
    if (sedi.length === 0) {
      agenzieByProvincia.set(prov, []);
      continue;
    }
    const ratings = await prisma.valutazione.groupBy({
      by: ['agenziaSedeId'],
      where: { agenziaSedeId: { in: sedi.map((s) => s.id) } },
      _avg: { stelle: true },
      _count: { _all: true },
    });
    const ratingMap = new Map(ratings.map((r) => [r.agenziaSedeId, r]));
    const enriched: AgenziaPick[] = sedi.map((s) => {
      const r = ratingMap.get(s.id);
      return {
        id: s.id,
        ragioneSociale: s.nome,
        avgStars: r?._avg.stelle ?? null,
        numValutazioni: r?._count._all ?? 0,
      };
    });
    // Ordina per ranking discendente (migliori in cima); a parita' alfabetico.
    enriched.sort((a, b) => {
      const sa = a.avgStars ?? -1;
      const sb = b.avgStars ?? -1;
      if (sa !== sb) return sb - sa;
      return a.ragioneSociale.localeCompare(b.ragioneSociale);
    });
    agenzieByProvincia.set(prov, enriched);
  }

  return (
    <AppShell session={session!} activePath="/admin/escalation">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Pratiche in escalation
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Pratiche che hanno esaurito tutti i round di distribuzione senza accettazione.
            Richiedono assegnazione manuale a partner di fiducia o contatto con il broker.
          </p>
        </header>

        {pratiche.length === 0 ? (
          <Alert variant="success" title="Nessuna escalation attiva">
            Tutte le pratiche sono assegnate o in corso di distribuzione.
          </Alert>
        ) : (
          <div className="space-y-4">
            {pratiche.map((p) => (
              <div
                key={p.id}
                className="rounded-[16px] border border-pv-red-500/30 bg-pv-red-50/40 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Link
                      href={`/pratiche/${p.id}`}
                      className="font-mono text-[14px] font-bold text-pv-navy-800 hover:underline"
                    >
                      {p.codicePratica ?? '—'}
                    </Link>
                    <p className="mt-1 text-[14px] font-semibold text-pv-navy-800">
                      {p.veicoli[0]?.targa
                        ? p.veicoli.length > 1
                          ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                          : p.veicoli[0].targa
                        : '—'}{' '}
                      · {p.comune ?? '—'} ({p.provincia ?? '—'})
                    </p>
                    <p className="mt-0.5 text-[12px] text-pv-slate-500">
                      Broker: {p.broker.ragioneSociale} · {p.broker.email}
                      {p.broker.telefono ? ` · ${p.broker.telefono}` : ''}
                    </p>
                    <p className="mt-0.5 text-[12px] text-pv-slate-500">
                      Escalation: {formatRelative(p.escalationAt)} ·{' '}
                      {p.assegnazioni.length} tentativi
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-pv-red-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                    Azione richiesta
                  </span>
                </div>
                <div className="mt-4 border-t border-pv-red-500/30 pt-3">
                  <p className="text-xs font-semibold text-pv-slate-700">Assegna manualmente</p>
                  <div className="mt-2">
                    <AssignForm
                      praticaId={p.id}
                      agenzie={agenzieByProvincia.get(p.provincia ?? '') ?? []}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
