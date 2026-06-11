import Link from 'next/link';

/**
 * Sotto-tab della sezione **Contatti** del CRM: Pipeline lead (pre-iscrizione)
 * vs Catalogo operativo (post-iscrizione).
 *
 * La navigazione principale del CRM (Contatti / Sales / Chatbot / Dashboard /
 * Utenti team / Permessi) vive ora nella sidebar admin (gruppo "CRM") — vedi
 * `components/admin/admin-shell.tsx`. Qui restano solo le due viste di Contatti.
 */
export type CrmContattiTab = 'pipeline' | 'operativi';

export function CrmTabs({ active }: { active: CrmContattiTab }) {
  return (
    <nav
      role="tablist"
      className="mb-6 flex items-center gap-1 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-1"
    >
      <SubTab
        href="/admin/crm/contatti"
        label="Pipeline lead"
        hint="Pre-iscrizione · funnel S0 → S10"
        active={active === 'pipeline'}
      />
      <SubTab
        href="/admin/crm/contatti-operativi"
        label="Contatti operativi"
        hint="Catalogo deduplicato post-iscrizione"
        active={active === 'operativi'}
      />
    </nav>
  );
}

function SubTab({
  href,
  label,
  hint,
  active,
}: {
  href: string;
  label: string;
  hint: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={
        'flex flex-1 flex-col rounded-[8px] px-3 py-2 transition-colors ' +
        (active
          ? 'bg-white text-pv-navy-900 shadow-[var(--pv-shadow-card)]'
          : 'text-pv-slate-700 hover:bg-white')
      }
    >
      <span className="text-[12.5px] font-bold">{label}</span>
      <span className="text-[10.5px] text-pv-slate-500">{hint}</span>
    </Link>
  );
}
