import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { formatRelative } from '@/lib/format';
import { GestisciSegnalazione } from './gestisci-form';

const TIPO_LABEL: Record<string, string> = {
  LETTURA_DATI: 'Dato letto/precompilato male (OCR)',
  COMPILAZIONE: 'Dubbio di compilazione',
  ALTRO: 'Altro',
};

/**
 * `datiSnapshot` è un Json opaco (fotografia non validata dello stato del
 * wizard al momento della segnalazione, vedi wizard.tsx `buildSegnalazionePayload`
 * e `segnala-problema-popup.tsx`). Accesso sempre difensivo: nessun campo è
 * garantito presente, i nomi chiave possono anche divergere leggermente da
 * quanto documentato nello schema (es. `tipo` vs `tipoPratica`).
 */
type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

type VeicoloSnap = { targa: string; telaio: string; ocr: boolean };

function veicoliDaSnapshot(snap: Json): VeicoloSnap[] {
  return asArr(snap.veicoli).map((raw) => {
    const v = asObj(raw);
    return {
      targa: asStr(v.targa) ?? '—',
      telaio: asStr(v.telaio) ?? '—',
      ocr: v.ocr != null || v.ocrData != null,
    };
  });
}

/** Nome leggibile di una parte (venditore/acquirente/co-acquirente): PF o PG. */
function nomeSoggetto(raw: unknown): string {
  const v = asObj(raw);
  const ragioneSociale = asStr(v.ragioneSociale);
  if (ragioneSociale) return ragioneSociale;
  const nome = asStr(v.nome);
  const cognome = asStr(v.cognome);
  if (nome || cognome) return [nome, cognome].filter(Boolean).join(' ');
  return '—';
}

export default async function AdminSegnalazioniCreazionePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/segnalazioni-creazione">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            La gestione delle segnalazioni in creazione pratica è riservata
            all&apos;Admin piattaforma.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const segnalazioni = await prisma.segnalazioneCreazione.findMany({
    orderBy: [{ stato: 'asc' }, { createdAt: 'desc' }],
    include: {
      company: { select: { ragioneSociale: true } },
      user: { select: { nome: true, email: true } },
      sede: { select: { nome: true } },
      documenti: { select: { id: true, originalFilename: true, mimeType: true } },
      gestitaDa: { select: { nome: true } },
    },
  });

  return (
    <AppShell session={session} activePath="/admin/segnalazioni-creazione">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Admin · Creazione pratica
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Problemi in creazione pratica
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            Segnalazioni inviate dai broker durante la compilazione del
            wizard (dati letti male, dubbi di compilazione, altro). Ogni
            segnalazione include una fotografia dei dati inseriti finora ed
            eventuali file allegati.
          </p>
        </header>

        {segnalazioni.length === 0 ? (
          <Alert variant="success" title="Nessuna segnalazione">
            Non ci sono segnalazioni da creazione pratica.
          </Alert>
        ) : (
          <div className="space-y-4">
            {segnalazioni.map((s) => {
              const snap = asObj(s.datiSnapshot);
              const tipoPratica = asStr(snap.tipo) ?? asStr(snap.tipoPratica) ?? '—';
              const comune = asStr(snap.comune);
              const veicoli = veicoliDaSnapshot(snap);
              const venditori = asArr(snap.venditori);
              const coAcquirenti = asArr(snap.coAcquirenti);
              const acquirente = snap.acquirente != null ? nomeSoggetto(snap.acquirente) : '—';
              const aperta = s.stato === 'APERTA';

              return (
                <Card
                  key={s.id}
                  className={aperta ? 'border-pv-amber-500/40 bg-pv-amber-50/40' : undefined}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ' +
                            (aperta
                              ? 'bg-pv-amber-500/20 text-pv-amber-500'
                              : 'bg-pv-green-50 text-pv-green-500')
                          }
                        >
                          {aperta ? 'Aperta' : 'Gestita'}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                          Step {s.step}
                        </span>
                        <span className="rounded-full bg-pv-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-pv-slate-700">
                          {TIPO_LABEL[s.tipo] ?? s.tipo}
                        </span>
                      </div>

                      <p className="mt-2 text-[14px] font-semibold text-pv-navy-800">
                        {s.company.ragioneSociale}
                        {s.sede?.nome ? ` · ${s.sede.nome}` : ''}
                      </p>
                      <p className="text-[11px] text-pv-slate-500">
                        {s.user.nome ?? '—'} · {s.user.email}
                      </p>

                      <p className="mt-2 whitespace-pre-wrap rounded-[10px] border border-pv-slate-200 bg-white px-3 py-2 text-[12.5px] text-pv-slate-700">
                        {s.descrizione}
                      </p>

                      <div className="mt-3 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2 text-[12px] text-pv-slate-700">
                        <p>
                          <strong>Tipo pratica:</strong> {tipoPratica}
                          {comune ? ` · ${comune}` : ''}
                        </p>
                        {veicoli.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {veicoli.map((v, i) => (
                              <li key={i}>
                                Veicolo {i + 1}: targa{' '}
                                <span className="font-mono">{v.targa}</span>, telaio{' '}
                                <span className="font-mono">{v.telaio}</span> — OCR{' '}
                                {v.ocr ? 'presente' : 'assente'}
                              </li>
                            ))}
                          </ul>
                        )}
                        {venditori.length > 0 && (
                          <p className="mt-1">
                            <strong>Venditori:</strong>{' '}
                            {venditori.map((v) => nomeSoggetto(v)).join(', ')}
                          </p>
                        )}
                        {snap.acquirente != null && (
                          <p className="mt-1">
                            <strong>Acquirente:</strong> {acquirente}
                          </p>
                        )}
                        {coAcquirenti.length > 0 && (
                          <p className="mt-1">
                            <strong>Co-acquirenti:</strong>{' '}
                            {coAcquirenti.map((c) => nomeSoggetto(c)).join(', ')}
                          </p>
                        )}
                      </div>

                      {s.documenti.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                            Allegati
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {s.documenti.map((d) => (
                              <li key={d.id}>
                                <a
                                  href={`/api/documenti/${d.id}`}
                                  className="text-[12.5px] font-semibold text-pv-navy-700 hover:underline"
                                >
                                  {d.originalFilename}
                                </a>
                                <span className="ml-1 text-[11px] text-pv-slate-500">
                                  ({d.mimeType})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <p className="mt-2 text-[11px] text-pv-slate-500">
                        Inviata {formatRelative(s.createdAt)}
                      </p>
                    </div>
                  </div>

                  {aperta ? (
                    <div className="mt-4 border-t border-pv-amber-500/30 pt-3">
                      <GestisciSegnalazione id={s.id} />
                    </div>
                  ) : (
                    <div className="mt-4 border-t border-pv-slate-200 pt-3">
                      <p className="text-[12px] font-semibold text-pv-slate-700">
                        Risposta inviata al broker:
                      </p>
                      <p className="mt-1 whitespace-pre-wrap rounded-[10px] border border-pv-slate-200 bg-white px-3 py-2 text-[12.5px] text-pv-slate-700">
                        {s.notaGestione}
                      </p>
                      <p className="mt-1 text-[11px] text-pv-slate-500">
                        {s.gestitaDa?.nome ?? '—'}
                        {s.gestitaAt ? ` · ${formatRelative(s.gestitaAt)}` : ''}
                      </p>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
