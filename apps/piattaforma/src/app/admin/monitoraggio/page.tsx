import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { TipoPraticaChip } from '@/components/ui';
import { SedeCell } from '@/components/sede/sede-cell';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { giorniCalendarioTrascorsi, fermaLevel } from '@/lib/monitoraggio/giorni-fermi';
import { RevocaButton } from './revoca-button';

const GRID = 'grid-cols-[1.3fr_0.9fr_1.1fr_1.4fr_0.7fr_0.9fr]';

export default async function MonitoraggioPage() {
  const session = await auth();
  if (!isAdminPiattaforma(session?.user?.role)) redirect('/admin/pratiche');

  const pratiche = await prisma.pratica.findMany({
    where: { stato: 'ACCETTATA', processataAt: null, deletedAt: null },
    orderBy: { accettataAt: 'asc' },
    include: {
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
      agenziaSede: { select: { nome: true, citta: true, telefono: true } },
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
    },
  });

  const now = new Date();

  return (
    <AppShell session={session!} activePath="/admin/monitoraggio">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Monitoraggio pratiche ferme
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {pratiche.length} pratic{pratiche.length === 1 ? 'a' : 'he'} accettat
            {pratiche.length === 1 ? 'a' : 'e'} ma non ancora lavorat{pratiche.length === 1 ? 'a' : 'e'}.
            In rosso quelle ferme da 3 giorni o più.
          </p>
        </header>

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {pratiche.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica ferma. 🎉</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[880px] text-[13px]">
                <div
                  className={`grid ${GRID} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="px-3 py-3">Broker</div>
                  <div className="px-3 py-3">Agenzia · Sede</div>
                  <div className="px-3 py-3 text-right">Ferma da</div>
                  <div className="py-3 pl-3 pr-5 text-right">Azione</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {pratiche.map((p) => {
                    const giorni = giorniCalendarioTrascorsi(p.accettataAt, now);
                    const level = fermaLevel(giorni);
                    const rowTone = level === 'urgent' ? 'bg-pv-red-50' : level === 'warn' ? 'bg-pv-amber-50' : '';
                    const badgeTone =
                      level === 'urgent'
                        ? 'bg-pv-red-50 text-pv-red-500'
                        : level === 'warn'
                          ? 'bg-pv-amber-50 text-pv-amber-500'
                          : 'bg-pv-slate-100 text-pv-slate-700';
                    const targa = p.veicoli[0]?.targa
                      ? p.veicoli.length > 1
                        ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
                        : p.veicoli[0].targa
                      : '—';
                    return (
                      <div key={p.id} className={`grid ${GRID} items-center ${rowTone}`}>
                        <div className="min-w-0 py-3 pl-5 pr-3">
                          <Link
                            href={`/pratiche/${p.id}`}
                            className="block truncate font-mono font-semibold text-pv-navy-800 hover:underline"
                          >
                            {p.codicePratica ?? 'BOZZA'}
                          </Link>
                          <TipoPraticaChip tipo={p.tipo} numeroVeicoli={p.numeroVeicoli} className="mt-1" />
                        </div>
                        <div className="min-w-0 truncate px-3 py-3">{targa}</div>
                        <div className="min-w-0 truncate px-3 py-3 text-pv-slate-700">{p.broker.ragioneSociale}</div>
                        <div className="min-w-0 px-3 py-3">
                          <SedeCell sede={p.agenziaSede} agenzia={p.agenziaAssegnata?.ragioneSociale} />
                        </div>
                        <div className="px-3 py-3 text-right">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold ${badgeTone}`}>
                            {giorni === null ? '—' : giorni === 0 ? 'oggi' : `${giorni} g`}
                          </span>
                        </div>
                        <div className="py-3 pl-3 pr-5 text-right">
                          <RevocaButton
                            praticaId={p.id}
                            codicePratica={p.codicePratica ?? 'questa pratica'}
                            agenzia={p.agenziaSede?.nome ?? p.agenziaAssegnata?.ragioneSociale ?? "l'agenzia"}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
