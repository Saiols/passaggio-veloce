import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatusChip, TipoPraticaChip } from '@/components/ui';
import { SedeCell } from '@/components/sede/sede-cell';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import {
  giorniCalendarioTrascorsi,
  fermaLevel,
  categoriaMonitoraggio,
  dataFermaDa,
  CATEGORIA_MONITORAGGIO_LABEL,
  type CategoriaMonitoraggio,
} from '@/lib/monitoraggio/giorni-fermi';
import { RevocaButton } from './revoca-button';

const GRID = 'grid-cols-[1.15fr_0.75fr_0.95fr_1.2fr_0.95fr_0.7fr_0.9fr]';

/** Condizioni Prisma delle due categorie monitorate — fonte unica per query e conteggi. */
const COND_FERME = { stato: 'ACCETTATA', processataAt: null } satisfies Prisma.PraticaWhereInput;
const COND_ZONA_NON_COPERTA = {
  stato: 'IN_DISTRIBUZIONE',
  zonaNonCopertaAt: { not: null },
} satisfies Prisma.PraticaWhereInput;

type Vista = '' | 'ferme' | 'zona-non-coperta';

function parseVista(raw: string | undefined): Vista {
  return raw === 'ferme' || raw === 'zona-non-coperta' ? raw : '';
}

function hrefVista(vista: Vista): string {
  return vista ? `/admin/monitoraggio?vista=${vista}` : '/admin/monitoraggio';
}

export default async function MonitoraggioPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const session = await auth();
  if (!isAdminPiattaforma(session?.user?.role)) redirect('/admin/pratiche');

  const sp = await searchParams;
  const vista = parseVista(sp.vista);

  const whereVista: Prisma.PraticaWhereInput =
    vista === 'ferme' ? COND_FERME : vista === 'zona-non-coperta' ? COND_ZONA_NON_COPERTA : { OR: [COND_FERME, COND_ZONA_NON_COPERTA] };

  const [pratiche, totaleFerme, totaleZonaNonCoperta] = await Promise.all([
    prisma.pratica.findMany({
      where: { deletedAt: null, ...whereVista },
      // Le due categorie non condividono un'unica data di riferimento: ordina
      // prima le ACCETTATA ferme (accettataAt), poi fra le rimanenti (senza
      // accettataAt, cioè IN_DISTRIBUZIONE) le zona-non-coperta più vecchie.
      //
      // La chiave è `zonaNonCopertaPrimaAt`, la stessa che `dataFermaDa` usa per
      // i giorni fermi: ordinare per `zonaNonCopertaAt` spedirebbe in fondo alla
      // lista una pratica ripresa e ri-dichiarata, che il badge mostra invece
      // (correttamente) come ferma da settimane. `zonaNonCopertaAt` resta come
      // spareggio per le righe senza la colonna nuova — Prisma non ha un
      // COALESCE in `orderBy`, quindi il fallback di `dataFermaDa` si rende qui
      // come chiave successiva.
      orderBy: [
        { accettataAt: { sort: 'asc', nulls: 'last' } },
        { zonaNonCopertaPrimaAt: { sort: 'asc', nulls: 'last' } },
        { zonaNonCopertaAt: { sort: 'asc', nulls: 'last' } },
        { submittedAt: { sort: 'asc', nulls: 'last' } },
      ],
      include: {
        broker: { select: { ragioneSociale: true } },
        agenziaAssegnata: { select: { ragioneSociale: true } },
        agenziaSede: { select: { nome: true, citta: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    }),
    prisma.pratica.count({ where: { deletedAt: null, ...COND_FERME } }),
    prisma.pratica.count({ where: { deletedAt: null, ...COND_ZONA_NON_COPERTA } }),
  ]);

  const totale = totaleFerme + totaleZonaNonCoperta;
  const now = new Date();

  const VISTE: { value: Vista; label: string; count: number }[] = [
    { value: '', label: 'Tutte', count: totale },
    { value: 'ferme', label: 'Accettate ferme', count: totaleFerme },
    { value: 'zona-non-coperta', label: 'Zona non coperta', count: totaleZonaNonCoperta },
  ];

  return (
    <AppShell session={session!} activePath="/admin/monitoraggio">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">Admin</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Monitoraggio pratiche ferme
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Pratiche accettate ma non ancora lavorate (in rosso da 3 giorni o più), e pratiche in
            distribuzione per cui il motore non ha trovato nessuna agenzia entro il raggio massimo.
          </p>
        </header>

        <nav
          aria-label="Filtro categoria monitoraggio"
          className="mb-4 flex flex-wrap gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
        >
          {VISTE.map((v) => {
            const selezionato = vista === v.value;
            return (
              <Link
                key={v.value || 'tutte'}
                href={hrefVista(v.value)}
                aria-current={selezionato ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[13px] font-semibold transition ${
                  selezionato
                    ? 'bg-pv-navy-800 text-white'
                    : 'text-pv-slate-600 hover:bg-pv-slate-50 hover:text-pv-navy-800'
                }`}
              >
                {v.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                    selezionato ? 'bg-white/20 text-white' : 'bg-pv-slate-100 text-pv-slate-600'
                  }`}
                >
                  {v.count}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {pratiche.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">Nessuna pratica ferma. 🎉</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[980px] text-[13px]">
                <div
                  className={`grid ${GRID} items-center border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500`}
                >
                  <div className="py-3 pl-5 pr-3">Codice</div>
                  <div className="px-3 py-3">Targa</div>
                  <div className="px-3 py-3">Broker</div>
                  <div className="px-3 py-3">Agenzia · Sede</div>
                  <div className="px-3 py-3">Stato</div>
                  <div className="px-3 py-3 text-right">Ferma da</div>
                  <div className="py-3 pl-3 pr-5 text-right">Azione</div>
                </div>
                <div className="divide-y divide-pv-slate-200">
                  {pratiche.map((p) => {
                    // Difensivo: la query sopra filtra già solo le due categorie,
                    // ma la funzione resta pura e può tornare null se il
                    // chiamante cambia — vedi lib/monitoraggio/giorni-fermi.ts.
                    const categoria: CategoriaMonitoraggio | null = categoriaMonitoraggio(p);
                    const giorni = categoria
                      ? giorniCalendarioTrascorsi(dataFermaDa(p, categoria), now)
                      : null;
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
                        <div className="min-w-0 px-3 py-3">
                          <StatusChip stato={p.stato} viewerRole="ADMIN" />
                          {categoria === 'ZONA_NON_COPERTA' && (
                            <span className="mt-1 block w-fit rounded-full bg-pv-red-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-red-500">
                              {CATEGORIA_MONITORAGGIO_LABEL.ZONA_NON_COPERTA}
                            </span>
                          )}
                        </div>
                        <div className="px-3 py-3 text-right">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold ${badgeTone}`}>
                            {giorni === null ? '—' : giorni === 0 ? 'oggi' : `${giorni} g`}
                          </span>
                        </div>
                        <div className="py-3 pl-3 pr-5 text-right">
                          {categoria === 'ACCETTATA_FERMA' ? (
                            <RevocaButton
                              praticaId={p.id}
                              codicePratica={p.codicePratica ?? 'questa pratica'}
                              agenzia={p.agenziaSede?.nome ?? p.agenziaAssegnata?.ragioneSociale ?? "l'agenzia"}
                            />
                          ) : (
                            // Zona non coperta: nessuna agenzia assegnata da revocare.
                            // Il motore ricicla da solo; l'intervento (se serve) è
                            // manuale, fuori da questa azione rapida.
                            <span className="text-[12px] text-pv-slate-400">—</span>
                          )}
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
