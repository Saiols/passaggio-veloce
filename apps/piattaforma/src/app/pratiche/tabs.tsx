import Link from 'next/link';
import { hrefTab, type FiltriTab, type TabPratiche, type ValoreTab } from '@/lib/pratiche/tabs';

/**
 * Accesso rapido ai gruppi della lista. Sono `<Link>` GET sullo stesso `?stato=`
 * usato dalla select: niente stato client, niente parametro nuovo.
 */
export function PraticheTabs({
  tabs,
  attivo,
  filtri,
}: {
  tabs: TabPratiche[];
  /** `null` quando è attivo un filtro fine dalla select: nessun tab selezionato. */
  attivo: ValoreTab | null;
  filtri: FiltriTab;
}) {
  return (
    <nav
      aria-label="Filtri rapidi pratiche"
      className="mb-3 flex flex-wrap gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
    >
      {tabs.map((t) => {
        const selezionato = attivo === t.value;
        return (
          <Link
            key={t.value || 'tutte'}
            href={hrefTab(t.value, filtri)}
            aria-current={selezionato ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[13px] font-semibold transition ${
              selezionato
                ? 'bg-pv-navy-800 text-white'
                : 'text-pv-slate-600 hover:bg-pv-slate-50 hover:text-pv-navy-800'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                selezionato ? 'bg-white/20 text-white' : 'bg-pv-slate-100 text-pv-slate-600'
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
