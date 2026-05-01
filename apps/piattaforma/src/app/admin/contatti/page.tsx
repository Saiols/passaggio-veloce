import { auth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { StatCard } from '@/components/ui';
import { TextSearchFilter } from '@/components/text-search-filter';
import { formatRelative } from '@/lib/format';
import { buildCatalogoContatti } from '@/lib/catalogo-contatti';

type SearchParams = { q?: string };

export default async function AdminContattiPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const q = sp.q?.trim();

  const contatti = await buildCatalogoContatti(q);
  const venditori = contatti.filter((c) => c.ruolo === 'VENDITORE').length;
  const acquirenti = contatti.filter((c) => c.ruolo === 'ACQUIRENTE').length;

  const exportHref = q ? `/api/admin/contatti/export?q=${encodeURIComponent(q)}` : '/api/admin/contatti/export';

  return (
    <AppShell session={session!} activePath="/admin/contatti">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Admin
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Catalogo contatti
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Tutti i venditori e acquirenti che sono passati dalla piattaforma.
              Asset commerciale dedupli­cato per email, telefono, CF o P.IVA.
            </p>
          </div>
          <a
            href={exportHref}
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
          >
            Esporta CSV
          </a>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Contatti totali" value={contatti.length} accent="navy" />
          <StatCard label="Venditori" value={venditori} accent="orange" />
          <StatCard label="Acquirenti" value={acquirenti} accent="green" />
        </div>

        <TextSearchFilter
          action="/admin/contatti"
          q={q}
          placeholder="Cerca per nome, email, telefono o CF/P.IVA…"
        />

        <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
          {contatti.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-[14px] text-pv-slate-500">
                Nessun contatto trovato{q ? ' con il filtro corrente' : ''}.
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
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-slate-200">
                {contatti.map((c) => (
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
