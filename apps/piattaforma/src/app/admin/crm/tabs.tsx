import Link from 'next/link';

/**
 * Tab navigator dell'hub /admin/crm.
 * - "pipeline" → /admin/crm/contatti (CrmContact pre-iscrizione)
 * - "operativi" → /admin/crm/contatti-operativi (catalogo dedupli­cato post)
 *
 * Spec: docs/crm-spec-implementativa.md §1 (coesistenza dei due moduli).
 */
export function CrmTabs({ active }: { active: 'pipeline' | 'operativi' }) {
  return (
    <nav
      role="tablist"
      className="mb-6 flex items-center gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
    >
      <Tab
        href="/admin/crm/contatti"
        label="Pipeline lead"
        hint="Pre-iscrizione · funnel S0 → S10"
        active={active === 'pipeline'}
      />
      <Tab
        href="/admin/crm/contatti-operativi"
        label="Contatti operativi"
        hint="Catalogo dedupli­cato post-iscrizione"
        active={active === 'operativi'}
      />
    </nav>
  );
}

function Tab({
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
        'flex flex-1 flex-col rounded-[10px] px-4 py-2.5 transition-colors ' +
        (active
          ? 'bg-pv-navy-700 text-white'
          : 'text-pv-slate-700 hover:bg-pv-slate-50')
      }
    >
      <span className="text-[13px] font-bold">{label}</span>
      <span
        className={
          'text-[11px] ' +
          (active ? 'text-white/70' : 'text-pv-slate-500')
        }
      >
        {hint}
      </span>
    </Link>
  );
}
