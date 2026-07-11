import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatRelative, formatDate, formatCurrencyCent } from '@/lib/format';
import { PENALI, calcolaPenaleBrokerCent } from '@/lib/penali/config';
import { GestioneSegnalazione } from './gestione-form';

const TIPO_LABEL: Record<string, string> = {
  FERMO_AMMINISTRATIVO: 'Fermo amministrativo',
  IPOTECA: 'Ipoteca / vincolo',
  DOCUMENTO_NON_VALIDO: 'Documento non valido',
  ALTRO: 'Altro',
};

export default async function AdminSegnalazioniPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/segnalazioni">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione segnalazioni è riservata all&apos;Admin piattaforma.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const [pendenti, storico] = await Promise.all([
    prisma.pratica.findMany({
      where: { flagSegnalata: true, segnalazioneStato: 'RICEVUTA' },
      orderBy: { segnalataAt: 'asc' },
      include: {
        broker: {
          select: { id: true, ragioneSociale: true, telefono: true, email: true },
        },
        agenziaAssegnata: {
          select: { id: true, ragioneSociale: true, telefono: true, email: true },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, segnalato: true } },
      },
    }),
    // Storico (sola lettura): segnalazioni già gestite. Filtra per stato perché
    // su "respinta" flagSegnalata torna false.
    prisma.pratica.findMany({
      where: { segnalazioneStato: { in: ['CONFERMATA', 'RESPINTA'] } },
      orderBy: { segnalazioneEsitaAt: 'desc' },
      take: 50,
      include: {
        broker: { select: { ragioneSociale: true } },
        agenziaAssegnata: { select: { ragioneSociale: true } },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true, segnalato: true } },
      },
    }),
  ]);

  return (
    <AppShell session={session} activePath="/admin/segnalazioni">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Segnalazioni broker
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Pratiche segnalate dalle agenzie per fermi amministrativi, ipoteche
            o documenti non validi. Conferma per annullare con penale broker di{' '}
            {formatCurrencyCent(PENALI.PENALE_BROKER_DEFAULT_CENT)} per ciascun
            veicolo segnalato, oppure respingi se la verifica esclude il
            problema.
          </p>
        </header>

        {pendenti.length === 0 ? (
          <Alert variant="success" title="Nessuna segnalazione attiva">
            Tutte le segnalazioni sono state gestite.
          </Alert>
        ) : (
          <div className="space-y-4">
            {pendenti.map((p) => {
              const veicoliSegnalati = p.veicoli.filter((v) => v.segnalato);
              const importoPenaleCent = calcolaPenaleBrokerCent(p.veicoli);
              return (
                <Card
                  key={p.id}
                  className="border-pv-amber-500/40 bg-pv-amber-50/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Link
                        href={`/pratiche/${p.id}`}
                        className="font-mono text-[14px] font-bold text-pv-navy-700 hover:underline"
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
                      <p className="mt-0.5 text-[12px] text-pv-slate-700">
                        <strong>Tipo:</strong>{' '}
                        <span className="rounded-full bg-pv-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-amber-500">
                          {TIPO_LABEL[p.tipoSegnalazione ?? 'ALTRO']}
                        </span>
                      </p>
                      <p className="mt-2 rounded-[10px] border border-pv-red-500/30 bg-white px-3 py-2 text-[12px] text-pv-navy-800">
                        <strong>Veicoli segnalati:</strong>{' '}
                        {veicoliSegnalati.length > 0
                          ? veicoliSegnalati.map((v) => v.targa ?? '—').join(', ')
                          : 'nessuno indicato (segnalazione legacy, fallback 1 veicolo)'}
                        {' · '}
                        <strong>Penale reale:</strong>{' '}
                        <span className="font-bold text-pv-red-500">
                          {formatCurrencyCent(importoPenaleCent)}
                        </span>
                      </p>
                      {p.notaSegnalazione && (
                        <p className="mt-2 rounded-[10px] border border-pv-slate-200 bg-white px-3 py-2 text-[12.5px] italic text-pv-slate-700">
                          “{p.notaSegnalazione}”
                        </p>
                      )}
                      <p className="mt-2 text-[11px] text-pv-slate-500">
                        Broker:{' '}
                        <Link
                          href={`/admin/companies/${p.broker.id}`}
                          className="font-semibold text-pv-navy-700 hover:underline"
                        >
                          {p.broker.ragioneSociale}
                        </Link>{' '}
                        · {p.broker.email}
                      </p>
                      <p className="text-[11px] text-pv-slate-500">
                        Agenzia:{' '}
                        <Link
                          href={`/admin/companies/${p.agenziaAssegnata?.id}`}
                          className="font-semibold text-pv-navy-700 hover:underline"
                        >
                          {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                        </Link>
                      </p>
                      <p className="mt-1 text-[11px] text-pv-slate-500">
                        Segnalata {formatRelative(p.segnalataAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-pv-amber-500/30 pt-3">
                    <GestioneSegnalazione
                      praticaId={p.id}
                      importoPenaleCent={importoPenaleCent}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {storico.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">
              Storico segnalazioni gestite
            </h2>
            <div className="overflow-x-auto rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <tr>
                    <th className="px-4 py-3">Pratica</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3 hidden md:table-cell">Broker</th>
                    <th className="px-4 py-3 hidden md:table-cell">Agenzia</th>
                    <th className="px-4 py-3">Esito</th>
                    <th className="px-4 py-3 text-right">Gestita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pv-slate-100">
                  {storico.map((p) => {
                    const confermata = p.segnalazioneStato === 'CONFERMATA';
                    return (
                      <tr key={p.id} className="hover:bg-pv-slate-50">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/pratiche/${p.id}`}
                            className="font-mono font-semibold text-pv-navy-700 hover:underline"
                          >
                            {p.codicePratica ?? '—'}
                          </Link>
                          <span className="ml-2 text-pv-slate-500">{p.veicoli[0]?.targa ?? '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-pv-slate-700">
                          {TIPO_LABEL[p.tipoSegnalazione ?? 'ALTRO']}
                        </td>
                        <td className="px-4 py-2.5 hidden text-pv-slate-700 md:table-cell">
                          {p.broker.ragioneSociale}
                        </td>
                        <td className="px-4 py-2.5 hidden text-pv-slate-700 md:table-cell">
                          {p.agenziaAssegnata?.ragioneSociale ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ' +
                              (confermata
                                ? 'bg-pv-red-50 text-pv-red-500'
                                : 'bg-pv-slate-100 text-pv-slate-700')
                            }
                          >
                            {confermata
                              ? `Penale${p.penaleAddebitatoCent ? ' ' + formatCurrencyCent(p.penaleAddebitatoCent) : ''}`
                              : 'Respinta'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-pv-slate-500">
                          {p.segnalazioneEsitaAt ? formatDate(p.segnalazioneEsitaAt) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
