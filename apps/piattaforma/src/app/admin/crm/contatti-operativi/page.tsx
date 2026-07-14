import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { StatCard } from '@/components/ui';
import { TextSearchFilter } from '@/components/text-search-filter';
import { formatRelative, formatDateTime } from '@/lib/format';
import { buildCatalogoContatti } from '@/lib/catalogo-contatti';
import { OpposizioneCatalogoButton } from './opposizione-button';
import { RevocaOpposizioneCatalogoButton } from './revoca-opposizione-button';

type Ruolo = 'VENDITORE' | 'ACQUIRENTE';
type SearchParams = { q?: string; ruolo?: string };

const BASE_PATH = '/admin/crm/contatti-operativi';

/**
 * "Contatti operativi" — catalogo dedupli­cato di venditori/acquirenti emersi
 * dalle pratiche piattaforma. Asset commerciale post-iscrizione.
 *
 * Convive con la "Pipeline lead" (CrmContact) come secondo tab dell'hub
 * /admin/crm. Vedi docs/crm-spec-implementativa.md §1.
 */
export default async function AdminCRMContattiOperativiPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const q = sp.q?.trim();
  const ruoloFilter: Ruolo | null =
    sp.ruolo === 'VENDITORE' || sp.ruolo === 'ACQUIRENTE' ? sp.ruolo : null;

  const [contatti, opposizioni] = await Promise.all([
    buildCatalogoContatti(q),
    // GDPR art. 21: elenco opposizioni registrate (attive + revocate, per
    // audit). Volume atteso basso (evento raro), niente paginazione.
    prisma.opposizioneCatalogo.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        registrataDa: { select: { nome: true, cognome: true } },
        revocataDa: { select: { nome: true, cognome: true } },
      },
    }),
  ]);
  const venditori = contatti.filter((c) => c.ruolo === 'VENDITORE').length;
  const acquirenti = contatti.filter((c) => c.ruolo === 'ACQUIRENTE').length;
  // Filtro per tipologia (acquirente/venditore) sulla lista mostrata.
  const filtered = ruoloFilter ? contatti.filter((c) => c.ruolo === ruoloFilter) : contatti;

  // Href che preservano i parametri attivi (q + ruolo).
  const buildHref = (ruolo: Ruolo | null): string => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (ruolo) params.set('ruolo', ruolo);
    const qs = params.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  };
  const exportParams = new URLSearchParams();
  if (q) exportParams.set('q', q);
  if (ruoloFilter) exportParams.set('ruolo', ruoloFilter);
  const exportQs = exportParams.toString();
  const exportHref = exportQs
    ? `/api/admin/contatti/export?${exportQs}`
    : '/api/admin/contatti/export';

  return (
    <AppShell session={session!} activePath="/admin/crm/contatti-operativi">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Admin · CRM
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Acquirenti / venditori
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Catalogo dedupli­cato dei venditori/acquirenti emersi dalle pratiche.
            </p>
          </div>
          <a
            href={exportHref}
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
          >
            Esporta CSV
          </a>
        </header>

        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Contatti totali" value={contatti.length} accent="navy" />
          <StatCard label="Venditori" value={venditori} accent="orange" />
          <StatCard label="Acquirenti" value={acquirenti} accent="green" />
        </div>

        {/* Filtro per tipologia (acquirente/venditore). Preserva la ricerca testo. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Tipologia
          </span>
          {([
            { key: null, label: 'Tutti' },
            { key: 'VENDITORE', label: 'Venditori' },
            { key: 'ACQUIRENTE', label: 'Acquirenti' },
          ] as const).map((opt) => {
            const active = ruoloFilter === opt.key;
            return (
              <Link
                key={opt.label}
                href={buildHref(opt.key)}
                aria-pressed={active}
                className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-pv-navy-700 text-white'
                    : 'bg-pv-slate-100 text-pv-slate-700 hover:bg-pv-slate-200'
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>

        <TextSearchFilter
          action={BASE_PATH}
          q={q}
          placeholder="Cerca per nome, email, telefono o CF/P.IVA…"
          hidden={ruoloFilter ? { ruolo: ruoloFilter } : undefined}
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">
                Nessun contatto trovato{q || ruoloFilter ? ' con i filtri correnti' : ''}.
              </p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                <tr>
                  <th className="px-5 py-3">Nominativo</th>
                  <th className="px-5 py-3 hidden sm:table-cell">Ruolo</th>
                  <th className="px-5 py-3 hidden md:table-cell">Telefono</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3 hidden lg:table-cell">CF / P.IVA</th>
                  <th className="px-5 py-3 hidden lg:table-cell">Pratiche</th>
                  <th className="px-5 py-3 text-right">Ultima</th>
                  <th className="px-5 py-3 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-200">
                {filtered.map((c) => (
                  <tr key={c.key} className="hover:bg-pv-slate-50">
                    <td className="px-5 py-3 font-semibold text-pv-navy-800">
                      {c.nominativo}
                      {c.isPersonaGiuridica && (
                        <span className="ml-2 rounded-full bg-pv-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-slate-500">
                          PG
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 sm:table-cell">
                      {c.ruolo === 'VENDITORE' ? 'Venditore' : 'Acquirente'}
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                      {c.telefono ? (
                        <a className="hover:underline" href={`tel:${c.telefono}`}>
                          {c.telefono}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 text-pv-slate-700">
                      {c.email ? (
                        <a className="hover:underline" href={`mailto:${c.email}`}>
                          {c.email}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 hidden font-mono text-[12px] text-pv-slate-700 lg:table-cell">
                      {c.identificativoFiscale ?? '—'}
                    </td>
                    <td className="px-5 py-3 hidden text-pv-slate-700 lg:table-cell">
                      {c.numeroPratiche}
                    </td>
                    <td className="px-5 py-3 text-right text-pv-slate-500">
                      {formatRelative(c.ultimoVistoAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <OpposizioneCatalogoButton chiave={c.key} nominativo={c.nominativo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* GDPR art. 21 — opposizioni registrate sul catalogo (attive + revocate,
            per audit). Chi si oppone lascia il catalogo/export CSV; una revoca
            legittima lo fa rientrare. */}
        <div className="mt-8">
          <h2 className="text-[15px] font-extrabold tracking-tight text-pv-navy-900">
            Opposizioni registrate (art. 21 GDPR)
          </h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Contatti esclusi dal catalogo su richiesta esplicita a privacy@passaggioveloce.it.
          </p>

          <div className="mt-3 overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
            {opposizioni.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13px] text-pv-slate-500">Nessuna opposizione registrata.</p>
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <tr>
                    <th className="px-5 py-3">Nominativo</th>
                    <th className="px-5 py-3 hidden md:table-cell">Nota</th>
                    <th className="px-5 py-3 hidden sm:table-cell">Registrata</th>
                    <th className="px-5 py-3">Stato</th>
                    <th className="px-5 py-3 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pv-slate-200">
                  {opposizioni.map((o) => {
                    const attiva = o.revocataAt === null;
                    const registrataDaNome = `${o.registrataDa.nome} ${o.registrataDa.cognome}`.trim();
                    return (
                      <tr key={o.id} className="hover:bg-pv-slate-50">
                        <td className="px-5 py-3 font-semibold text-pv-navy-800">
                          {o.nominativo ?? '—'}
                        </td>
                        <td className="px-5 py-3 hidden text-pv-slate-700 md:table-cell">
                          {o.note ?? '—'}
                        </td>
                        <td className="px-5 py-3 hidden text-pv-slate-500 sm:table-cell">
                          {formatDateTime(o.createdAt)} · {registrataDaNome}
                        </td>
                        <td className="px-5 py-3">
                          {attiva ? (
                            <span className="inline-flex items-center rounded-full bg-pv-red-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-red-500">
                              Attiva
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-pv-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                              Revocata
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {attiva && <RevocaOpposizioneCatalogoButton id={o.id} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
