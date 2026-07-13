import Link from 'next/link';

export type TabFattura = { value: '' | 'DA_EMETTERE' | 'EMESSA'; label: string; count: number };

/**
 * Tab della lista fatture: `<Link>` GET sullo stesso `?emissione=` dei filtri,
 * nessuno stato client (stesso pattern di app/pratiche/tabs.tsx).
 */
export function FattureTabs({
  tabs,
  attivo,
  queryBase,
}: {
  tabs: TabFattura[];
  attivo: string;
  /** Query-string degli altri filtri attivi, da preservare (senza `emissione`). */
  queryBase: string;
}) {
  const href = (value: string): string => {
    const qs = new URLSearchParams(queryBase);
    qs.delete('emissione');
    if (value) qs.set('emissione', value);
    const s = qs.toString();
    return s ? `/admin/fatturazione?${s}` : '/admin/fatturazione';
  };

  return (
    <nav
      aria-label="Filtri rapidi fatture"
      className="mb-3 flex flex-wrap gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
    >
      {tabs.map((t) => {
        const selezionato = attivo === t.value;
        return (
          <Link
            key={t.value || 'tutte'}
            href={href(t.value)}
            aria-current={selezionato ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[13px] font-semibold transition ${
              selezionato
                ? 'bg-pv-navy-800 text-white'
                : 'text-pv-slate-500 hover:bg-pv-slate-50 hover:text-pv-navy-800'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                selezionato ? 'bg-white/20 text-white' : 'bg-pv-slate-100 text-pv-slate-500'
              }`}
            >
              {t.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
